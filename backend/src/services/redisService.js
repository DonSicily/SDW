const Redis = require('ioredis');

let redis = null;
let redisSub = null; // for Socket.IO adapter pub/sub
let available = false;

const GEO_KEY = 'drivers:geo';
const DRIVER_META_PREFIX = 'driver:meta:'; // driverId → JSON { socketId, isOnline }

function createClient(label) {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000))
  });
  client.on('error', (err) => {
    if (available) console.warn(`[redis:${label}]`, err.message);
  });
  return client;
}

/**
 * Connect Redis. Safe to call multiple times.
 * Returns true if Redis is usable; false means fall back to in-memory.
 */
async function connectRedis() {
  if (available && redis) return true;
  try {
    redis = createClient('main');
    await redis.connect();
    await redis.ping();
    available = true;
    console.log('✅ Redis connected');
    return true;
  } catch (err) {
    available = false;
    console.warn('⚠️  Redis unavailable — using in-memory driver store:', err.message);
    if (redis) {
      try { redis.disconnect(); } catch (_) {}
      redis = null;
    }
    return false;
  }
}

function isRedisAvailable() {
  return available && redis !== null;
}

function getRedis() {
  return redis;
}

/** Dedicated pub/sub clients for Socket.IO Redis adapter */
async function getAdapterClients() {
  if (!isRedisAvailable()) return null;
  try {
    const pub = createClient('pub');
    const sub = createClient('sub');
    await Promise.all([pub.connect(), sub.connect()]);
    return { pubClient: pub, subClient: sub };
  } catch (err) {
    console.warn('Redis adapter clients failed:', err.message);
    return null;
  }
}

// ---------- Driver geo helpers ----------

async function setDriverLocation(driverId, lng, lat, meta = {}) {
  if (!isRedisAvailable()) return false;
  try {
    await redis.geoadd(GEO_KEY, lng, lat, String(driverId));
    await redis.set(
      DRIVER_META_PREFIX + driverId,
      JSON.stringify({ ...meta, isOnline: true, updatedAt: Date.now() }),
      'EX',
      3600 // auto-expire if heartbeat stops
    );
    return true;
  } catch (err) {
    console.error('setDriverLocation error:', err.message);
    return false;
  }
}

async function removeDriver(driverId) {
  if (!isRedisAvailable()) return false;
  try {
    await redis.zrem(GEO_KEY, String(driverId));
    await redis.del(DRIVER_META_PREFIX + driverId);
    return true;
  } catch (err) {
    console.error('removeDriver error:', err.message);
    return false;
  }
}

/**
 * Find nearest online drivers within radiusKm.
 * Returns [{ driverId, distanceKm, meta }]
 */
async function findNearestDrivers(lng, lat, radiusKm = 10, count = 5) {
  if (!isRedisAvailable()) return null; // signal caller to use memory fallback
  try {
    // GEORADIUS with WITHDIST, COUNT
    const results = await redis.georadius(
      GEO_KEY,
      lng,
      lat,
      radiusKm,
      'km',
      'WITHDIST',
      'ASC',
      'COUNT',
      count
    );
    // results: [[driverId, dist], ...]
    const out = [];
    for (const row of results) {
      const driverId = row[0];
      const distanceKm = parseFloat(row[1]);
      const metaRaw = await redis.get(DRIVER_META_PREFIX + driverId);
      const meta = metaRaw ? JSON.parse(metaRaw) : {};
      if (meta.isOnline === false) continue;
      out.push({ driverId, distanceKm, meta });
    }
    return out;
  } catch (err) {
    console.error('findNearestDrivers error:', err.message);
    return null;
  }
}

async function getDriverMeta(driverId) {
  if (!isRedisAvailable()) return null;
  try {
    const raw = await redis.get(DRIVER_META_PREFIX + driverId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Approximate online-driver count from the GEO set (Redis only).
 * Used for live utilization in pricing. Returns null if Redis is down.
 */
async function countOnlineDrivers() {
  if (!isRedisAvailable()) return null;
  try {
    return await redis.zcard(GEO_KEY);
  } catch {
    return null;
  }
}

module.exports = {
  connectRedis,
  isRedisAvailable,
  getRedis,
  getAdapterClients,
  setDriverLocation,
  removeDriver,
  findNearestDrivers,
  getDriverMeta,
  countOnlineDrivers,
  GEO_KEY
};
