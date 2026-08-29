require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const { initSocket } = require('./services/socketService');
const { connectRedis, getAdapterClients, isRedisAvailable } = require('./services/redisService');
const { startPendingRideJanitor } = require('./services/rideService');

// Fail fast on missing critical configuration (skip strict checks in test)
if (process.env.NODE_ENV !== 'test') {
  const requiredEnv = ['DB_URL', 'JWT_SECRET'];
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      console.error(`❌ Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }
  if (process.env.JWT_SECRET.length < 16) {
    console.error('❌ JWT_SECRET must be at least 16 characters');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET === 'supersecretkey12345') {
    console.error('❌ Refusing to start with the default JWT_SECRET in production');
    process.exit(1);
  }
}

const app = express();
const server = http.createServer(app);

// ---------- CORS origins ----------
// P0: in production, CORS_ORIGINS must be an explicit allow-list (no wildcard)
const rawCors = process.env.CORS_ORIGINS || (process.env.NODE_ENV === 'production' ? '' : '*');
const allowedOrigins = rawCors
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production') {
  if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
    console.error('❌ Production requires explicit CORS_ORIGINS (comma-separated). Wildcard is not allowed.');
    process.exit(1);
  }
}

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser clients (no Origin header): mobile apps, server-to-server, health checks
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
    methods: ['GET', 'POST']
  }
});

// Trust proxy (Railway / reverse proxies) so rate-limit & req.ip work
app.set('trust proxy', 1);

// ---------- Security & logging middleware ----------
app.use(helmet({ contentSecurityPolicy: false }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}
app.use(cors(corsOptions));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 10000 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later' }
});
app.use(globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 10000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many authentication attempts, please try again later' }
});

// Paystack webhook — raw body before json parser
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  require('./controllers/paymentController').paystackWebhook
);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.set('io', io);

// ---------- Routes ----------
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/rides', require('./routes/rides'));
app.use('/api/drivers', require('./routes/drivers'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/users', require('./routes/users'));

// Admin audit log read endpoint (simple)
app.get('/api/admin/audit-logs', require('./utils/jwt').protect, require('./utils/jwt').adminOnly, async (req, res) => {
  try {
    const AuditLog = require('./models/AuditLog');
    const logs = await AuditLog.find()
      .sort('-createdAt')
      .limit(Math.min(parseInt(req.query.limit || '100', 10), 500));
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load audit logs' });
  }
});

initSocket(io);

app.get('/health', (req, res) => {
  const redisOk = isRedisAvailable();
  res.status(200).json({
    status: 'OK',
    message: 'Backend is running',
    redis: redisOk,
    // When Redis is down, OTP rate-limits and driver GEO are process-local only
    // and will diverge across multiple instances — use Redis in production.
    redisWarning: redisOk
      ? null
      : 'In-memory fallback active; multi-instance OTP/geo state will diverge',
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((err, req, res, next) => {
  if (err.message && err.message.includes('not allowed by CORS')) {
    return res.status(403).json({ message: err.message });
  }
  const requestId = req.headers['x-request-id'] || require('crypto').randomBytes(8).toString('hex');
  // Full detail server-side only — never leak stacks to clients in production
  console.error(JSON.stringify({
    level: 'error',
    context: 'unhandled',
    requestId,
    method: req.method,
    path: req.originalUrl,
    message: err.message,
    ...(process.env.NODE_ENV !== 'production' && err.stack ? { stack: err.stack } : {})
  }));
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Internal server error',
    requestId
  });
});

async function start() {
  await connectDB();
  await connectRedis();

  // Optional Socket.IO Redis adapter for multi-instance
  if (isRedisAvailable()) {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const clients = await getAdapterClients();
      if (clients) {
        io.adapter(createAdapter(clients.pubClient, clients.subClient));
        console.log('✅ Socket.IO Redis adapter enabled');
      }
    } catch (err) {
      console.warn('Socket.IO Redis adapter not enabled:', err.message);
    }
  }

  const PORT = process.env.PORT || 5000;
  if (process.env.NODE_ENV !== 'test') {
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      startPendingRideJanitor(io);
      console.log('🧹 Pending-ride janitor started');
    });
  }
}

// Export for tests; only auto-start outside test
module.exports = { app, server, io, start };

if (process.env.NODE_ENV !== 'test') {
  start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
