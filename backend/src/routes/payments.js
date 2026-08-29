const express = require('express');
const router = express.Router();
const { initializePayment, verifyPayment } = require('../controllers/paymentController');
const { protect } = require('../utils/jwt');
const { validate, initializePaymentRules, isObjectId } = require('../utils/validate');
const { param } = require('express-validator');

// Note: the webhook route is mounted separately in server.js because it needs
// the raw request body for signature verification, before express.json() runs.

router.post('/initialize', protect, initializePaymentRules, validate, initializePayment);
router.get(
  '/verify/:reference',
  protect,
  param('reference').trim().notEmpty().withMessage('Reference is required'),
  validate,
  verifyPayment
);

module.exports = router;
