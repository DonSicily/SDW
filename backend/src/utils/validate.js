const { validationResult, body, param, query } = require('express-validator');
const mongoose = require('mongoose');

/**
 * Run express-validator rules and return 400 with the first error if any.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: errors.array()[0].msg,
      errors: errors.array().map((e) => ({ field: e.path, msg: e.msg }))
    });
  }
  next();
};

/** Check that a string is a valid MongoDB ObjectId */
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

// ---------- Auth ----------
const registerRules = [
  body('phone')
    .trim()
    .notEmpty().withMessage('Phone is required')
    .isLength({ min: 10, max: 15 }).withMessage('Phone must be 10–15 characters')
    .matches(/^[0-9+\-\s]+$/).withMessage('Phone contains invalid characters'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Za-z]/).withMessage('Password must contain a letter')
    .matches(/[0-9]/).withMessage('Password must contain a number'),
  body('fullName')
    .trim()
    .notEmpty().withMessage('Full name is required')
    .isLength({ max: 100 }).withMessage('Full name is too long'),
  body('role')
    .optional()
    .isIn(['rider', 'driver', 'admin']).withMessage('Invalid role')
];

const loginRules = [
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('password').notEmpty().withMessage('Password is required')
];

// ---------- Rides ----------
const estimateRules = [
  body('pickup.lat').isFloat({ min: -90, max: 90 }).withMessage('Invalid pickup latitude'),
  body('pickup.lng').isFloat({ min: -180, max: 180 }).withMessage('Invalid pickup longitude'),
  body('dropoff.lat').isFloat({ min: -90, max: 90 }).withMessage('Invalid dropoff latitude'),
  body('dropoff.lng').isFloat({ min: -180, max: 180 }).withMessage('Invalid dropoff longitude')
];

// Fare is computed server-side — do not require client-supplied fare (P0)
const requestRideRules = [
  body('pickup.lat').isFloat({ min: -90, max: 90 }).withMessage('Invalid pickup latitude'),
  body('pickup.lng').isFloat({ min: -180, max: 180 }).withMessage('Invalid pickup longitude'),
  body('pickup.address').trim().notEmpty().withMessage('Pickup address is required'),
  body('dropoff.lat').isFloat({ min: -90, max: 90 }).withMessage('Invalid dropoff latitude'),
  body('dropoff.lng').isFloat({ min: -180, max: 180 }).withMessage('Invalid dropoff longitude'),
  body('dropoff.address').trim().notEmpty().withMessage('Dropoff address is required'),
  body('paymentMethod')
    .optional()
    .isIn(['cash', 'card', 'wallet']).withMessage('Invalid payment method')
];

const completeRideRules = [
  param('rideId').custom(isObjectId).withMessage('Invalid ride ID'),
  body('distanceKm').optional().isFloat({ min: 0 }).withMessage('distanceKm must be a positive number'),
  body('durationMin').optional().isFloat({ min: 0 }).withMessage('durationMin must be a positive number'),
  body('finalFare').optional().isFloat({ min: 0 }).withMessage('finalFare must be a positive number')
];

const rateRideRules = [
  param('rideId').custom(isObjectId).withMessage('Invalid ride ID'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be an integer between 1 and 5'),
  body('review').optional().isString().isLength({ max: 500 }).withMessage('Review max 500 characters')
];

// ---------- Addresses ----------
const addAddressRules = [
  body('label').trim().notEmpty().withMessage('Label is required').isLength({ max: 50 }),
  body('address').trim().notEmpty().withMessage('Address is required').isLength({ max: 300 }),
  body('lat').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  body('lng').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude')
];

// ---------- Admin ----------
const setUserStatusRules = [
  param('id').custom(isObjectId).withMessage('Invalid user ID'),
  body('status').isIn(['active', 'suspended']).withMessage('status must be active or suspended')
];

const createVehicleRules = [
  body('plateNumber').trim().notEmpty().withMessage('Plate number is required'),
  body('make').trim().notEmpty().withMessage('Make is required'),
  body('model').trim().notEmpty().withMessage('Model is required'),
  body('fuelType').isIn(['petrol', 'diesel', 'electric']).withMessage('Invalid fuel type'),
  body('type').optional().isIn(['sedan', 'suv', 'minibus', 'hatchback']),
  body('status').optional().isIn(['active', 'maintenance', 'inactive'])
];

// ---------- Payments ----------
const initializePaymentRules = [
  body('rideId').custom(isObjectId).withMessage('Invalid ride ID')
];

module.exports = {
  validate,
  isObjectId,
  registerRules,
  loginRules,
  estimateRules,
  requestRideRules,
  completeRideRules,
  rateRideRules,
  addAddressRules,
  setUserStatusRules,
  createVehicleRules,
  initializePaymentRules
};
