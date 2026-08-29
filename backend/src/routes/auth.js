const express = require('express');
const router = express.Router();
const {
  register,
  login,
  getProfile,
  updatePushToken,
  sendOtp,
  verifyOtp,
  refresh,
  logout
} = require('../controllers/authController');
const { protect, optionalProtect } = require('../utils/jwt');
const { validate, registerRules, loginRules } = require('../utils/validate');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Extra-strict limiter for OTP endpoints (SMS cost + abuse)
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many OTP requests, please try again later' }
});

router.post('/send-otp', otpLimiter, body('phone').trim().notEmpty(), validate, sendOtp);
router.post(
  '/verify-otp',
  otpLimiter,
  body('phone').trim().notEmpty(),
  body('code').trim().isLength({ min: 4, max: 8 }),
  validate,
  verifyOtp
);

router.post('/register', registerRules, validate, register);
router.post('/login', loginRules, validate, login);
router.post('/refresh', body('refreshToken').notEmpty(), validate, refresh);
// optionalProtect: attaches req.user when Bearer present so "all: true" works
router.post('/logout', optionalProtect, logout);

router.get('/profile', protect, getProfile);
router.put('/push-token', protect, updatePushToken);

module.exports = router;
