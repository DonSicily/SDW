const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');

function getAccessSecret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    throw new Error('JWT_SECRET is missing or too weak');
  }
  return process.env.JWT_SECRET;
}

/** Short-lived access token */
function generateAccessToken(id, role) {
  return jwt.sign(
    { id, role, type: 'access' },
    getAccessSecret(),
    { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' }
  );
}

/**
 * Issue an access + refresh token pair.
 * Returns { accessToken, refreshToken, refreshExpiresAt }
 */
async function issueTokenPair(user, meta = {}) {
  const accessToken = generateAccessToken(user._id, user.role);
  const { raw: refreshToken, expiresAt: refreshExpiresAt } =
    await RefreshToken.createToken(user._id, meta);
  return { accessToken, refreshToken, refreshExpiresAt };
}

// Middleware to protect routes (access token)
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, getAccessSecret());

      if (decoded.type && decoded.type !== 'access') {
        return res.status(401).json({ message: 'Invalid token type' });
      }

      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        return res.status(401).json({ message: 'User not found' });
      }

      if (req.user.status === 'suspended') {
        return res.status(403).json({ message: 'Account suspended' });
      }

      return next();
    } catch (error) {
      console.error('Auth error:', error.message);
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};

/**
 * Optional auth: attach req.user when a valid Bearer token is present,
 * otherwise continue without user. Used by logout so "revoke all" works
 * when authenticated while single-token revoke still works without a token.
 */
const optionalProtect = async (req, res, next) => {
  if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer')) {
    return next();
  }
  try {
    const token = req.headers.authorization.split(' ')[1];
    const decoded = jwt.verify(token, getAccessSecret());
    if (decoded.type && decoded.type !== 'access') {
      return next();
    }
    const user = await User.findById(decoded.id).select('-password');
    if (user && user.status !== 'suspended') {
      req.user = user;
    }
  } catch (_) {
    // ignore invalid token — treat as unauthenticated
  }
  return next();
};

const driverOnly = (req, res, next) => {
  if (req.user && req.user.role === 'driver') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Driver role required.' });
  }
};

const riderOnly = (req, res, next) => {
  if (req.user && req.user.role === 'rider') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Rider role required.' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied. Admin role required.' });
  }
};

module.exports = {
  protect,
  optionalProtect,
  driverOnly,
  riderOnly,
  adminOnly,
  generateAccessToken,
  issueTokenPair
};
