const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { issueTokenPair, generateAccessToken } = require('../utils/jwt');
const { sendOtp, verifyOtp } = require('../services/otpService');
const { audit } = require('../utils/audit');
const { normalizePhone } = require('../utils/phone');

/**
 * P2: After at least one admin exists, further admin self-registration is locked
 * unless ALLOW_ADMIN_SETUP=true is explicitly set (emergency / migration only).
 */
async function assertAdminSetupAllowed(adminSetupKey) {
  if (!process.env.ADMIN_SETUP_KEY || adminSetupKey !== process.env.ADMIN_SETUP_KEY) {
    const err = new Error('Invalid admin setup key');
    err.status = 403;
    throw err;
  }
  const allow = process.env.ALLOW_ADMIN_SETUP;
  // Explicit override for ops
  if (allow === 'true' || allow === '1') return;
  // In test, allow unless explicitly disabled
  if (process.env.NODE_ENV === 'test' && allow !== 'false') return;

  const existingAdmins = await User.countDocuments({ role: 'admin' });
  if (existingAdmins > 0) {
    const err = new Error(
      'Admin registration is locked. An admin already exists. Set ALLOW_ADMIN_SETUP=true to override.'
    );
    err.status = 403;
    throw err;
  }
}


function clientMeta(req) {
  return {
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.headers['x-forwarded-for']
  };
}

async function respondWithTokens(res, user, req, status = 200) {
  const tokens = await issueTokenPair(user, clientMeta(req));
  return res.status(status).json({
    _id: user._id,
    phone: user.phone,
    fullName: user.fullName,
    role: user.role,
    phoneVerified: user.phoneVerified,
    driverDetails: user.driverDetails,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    refreshExpiresAt: tokens.refreshExpiresAt,
    // Back-compat for existing mobile clients that still read `token`
    token: tokens.accessToken
  });
}

// @desc    Send OTP to phone (Termii)
// @route   POST /api/auth/send-otp
exports.sendOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) {
      return res.status(400).json({ message: 'Valid phone is required' });
    }

    const result = await sendOtp(phone);
    if (!result.success) {
      audit({ req, action: 'otp.send_failed', resource: 'auth', metadata: { phone, rateLimited: !!result.rateLimited }, success: false });
      if (result.rateLimited) {
        res.set('Retry-After', String(result.retryAfterSec || 60));
        return res.status(429).json({
          message: result.error || 'Too many OTP requests for this number',
          retryAfterSec: result.retryAfterSec
        });
      }
      return res.status(502).json({ message: result.error || 'Failed to send OTP' });
    }

    audit({ req, action: 'otp.sent', resource: 'auth', metadata: { phone } });
    res.json({
      success: true,
      message: 'OTP sent',
      expiresIn: result.expiresIn,
      ...(result.debugCode ? { debugCode: result.debugCode } : {})
    });
  } catch (error) {
    console.error('sendOtp error:', error);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
};

// @desc    Verify OTP → login existing user or register a new one
// @route   POST /api/auth/verify-otp
// @body    { phone, code, fullName?, role?, adminSetupKey? }
exports.verifyOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { code, fullName, role, adminSetupKey, password } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ message: 'phone and code are required' });
    }

    const check = await verifyOtp(phone, code);
    if (!check.valid) {
      audit({ req, action: 'otp.verify_failed', resource: 'auth', metadata: { phone }, success: false });
      return res.status(401).json({ message: check.reason });
    }

    let user = await User.findOne({ phone }).select('+password');

    if (!user) {
      // New account — fullName required for first-time registration
      if (!fullName || !String(fullName).trim()) {
        return res.status(400).json({
          message: 'fullName is required to create a new account'
        });
      }

      let finalRole = role || 'rider';
      if (finalRole === 'admin') {
        try {
          await assertAdminSetupAllowed(adminSetupKey);
        } catch (e) {
          return res.status(e.status || 403).json({ message: e.message });
        }
      }

      const userData = {
        phone,
        fullName: String(fullName).trim(),
        role: finalRole,
        phoneVerified: true
      };
      // Optional password — same strength rules as password register
      if (password != null && String(password).length > 0) {
        const pw = String(password);
        if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
          return res.status(400).json({
            message:
              'Password must be at least 8 characters and include a letter and a number'
          });
        }
        userData.password = pw;
      }

      user = await User.create(userData);
      audit({ req, action: 'user.registered_otp', resource: 'user', resourceId: user._id, metadata: { role: finalRole } });
    } else {
      if (user.status === 'suspended') {
        return res.status(403).json({ message: 'This account has been suspended' });
      }
      if (!user.phoneVerified) {
        user.phoneVerified = true;
        await user.save();
      }
      audit({ req, action: 'user.login_otp', resource: 'user', resourceId: user._id });
    }

    return respondWithTokens(res, user, req, 200);
  } catch (error) {
    console.error('verifyOtp error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'User already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Register with password. Requires a valid OTP so the phone is verified
//          before any tokens are issued. Prefer POST /api/auth/verify-otp for
//          OTP-only registration; this path is for accounts that also want a password.
// @route   POST /api/auth/register
// @body    { phone, password, fullName, role?, vehicleDetails?, adminSetupKey?, otpCode }
exports.register = async (req, res) => {
  try {
    const { password, fullName, role, vehicleDetails, adminSetupKey, otpCode } = req.body;
    const phone = normalizePhone(req.body.phone);
    if (!phone) {
      return res.status(400).json({ message: 'Valid phone is required' });
    }

    // P0: require a successful OTP before creating the account / issuing tokens
    if (!otpCode) {
      return res.status(400).json({
        message: 'otpCode is required. Call POST /api/auth/send-otp first, then register with the code.'
      });
    }
    const check = await verifyOtp(phone, otpCode);
    if (!check.valid) {
      audit({
        req,
        action: 'user.register_otp_failed',
        resource: 'auth',
        metadata: { phone },
        success: false
      });
      return res.status(401).json({ message: check.reason || 'Invalid or expired OTP' });
    }

    const userExists = await User.findOne({ phone });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    let finalRole = role || 'rider';
    if (finalRole === 'admin') {
      try {
        await assertAdminSetupAllowed(adminSetupKey);
      } catch (e) {
        return res.status(e.status || 403).json({ message: e.message });
      }
    }

    const userData = {
      phone,
      password,
      fullName: String(fullName).trim(),
      role: finalRole,
      phoneVerified: true // OTP just verified
    };

    if (finalRole === 'driver' && vehicleDetails?.vehicleId) {
      userData.driverDetails = { vehicleId: vehicleDetails.vehicleId };
    }

    const user = await User.create(userData);

    audit({
      req,
      action: 'user.registered',
      resource: 'user',
      resourceId: user._id,
      metadata: { role: finalRole }
    });
    return respondWithTokens(res, user, req, 201);
  } catch (error) {
    console.error('Register error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'User already exists' });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Login with phone + password
// @route   POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { password } = req.body;
    if (!phone) {
      return res.status(400).json({ message: 'Valid phone is required' });
    }

    const user = await User.findOne({ phone }).select('+password');
    if (!user) {
      await audit({
        req,
        action: 'user.login_failed',
        resource: 'auth',
        metadata: { phone },
        success: false,
        awaitWrite: true
      });
      return res.status(401).json({ message: 'Invalid phone or password' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      await audit({
        req,
        action: 'user.login_failed',
        resource: 'auth',
        metadata: { phone },
        success: false,
        awaitWrite: true
      });
      return res.status(401).json({ message: 'Invalid phone or password' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ message: 'This account has been suspended' });
    }

    await audit({
      req,
      action: 'user.login',
      resource: 'user',
      resourceId: user._id,
      awaitWrite: true
    });
    return respondWithTokens(res, user, req);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Exchange refresh token for a new access + refresh pair (rotation)
// @route   POST /api/auth/refresh
exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'refreshToken is required' });
    }

    const result = await RefreshToken.rotate(refreshToken, clientMeta(req));
    if (result.error) {
      audit({ req, action: 'token.refresh_failed', resource: 'auth', metadata: { reason: result.error }, success: false });
      return res.status(401).json({ message: result.error });
    }

    const user = await User.findById(result.userId);
    if (!user || user.status === 'suspended') {
      return res.status(401).json({ message: 'User not found or suspended' });
    }

    const accessToken = generateAccessToken(user._id, user.role);
    audit({ req, action: 'token.refreshed', resource: 'user', resourceId: user._id });

    res.json({
      accessToken,
      refreshToken: result.raw,
      refreshExpiresAt: result.expiresAt,
      token: accessToken // back-compat
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ message: 'Failed to refresh token' });
  }
};

// @desc    Logout — revoke the presented refresh token (or all sessions)
// @route   POST /api/auth/logout
// Body: { refreshToken?, all? }
// - Always revoke the presented refreshToken when supplied (no auth required).
// - all: true requires a valid Bearer access token (optionalProtect) and
//   revokes every refresh token for that user.
exports.logout = async (req, res) => {
  try {
    const { refreshToken, all } = req.body || {};

    if (all) {
      if (!req.user) {
        return res.status(401).json({
          message: 'Authentication required to revoke all sessions'
        });
      }
      await RefreshToken.revokeAllForUser(req.user.id);
      // Also revoke the single token if provided (redundant but harmless)
      if (refreshToken) {
        await RefreshToken.revoke(refreshToken);
      }
      audit({ req, action: 'user.logout_all', resource: 'user', resourceId: req.user.id });
      return res.json({ success: true, revoked: 'all' });
    }

    if (refreshToken) {
      await RefreshToken.revoke(refreshToken);
      audit({ req, action: 'user.logout', resource: 'auth' });
      return res.json({ success: true, revoked: 'one' });
    }

    return res.status(400).json({
      message: 'Provide refreshToken to revoke, or all: true with a Bearer token'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Logout failed' });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password')
      .populate('driverDetails.vehicleId');

    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Register (or clear) this device's Expo push token
// @route   PUT /api/auth/push-token
exports.updatePushToken = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { pushToken: req.body.token || null });
    res.json({ success: true });
  } catch (error) {
    console.error('Push token update error:', error);
    res.status(500).json({ message: 'Failed to save push token' });
  }
};
