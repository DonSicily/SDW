const express = require('express');
const router = express.Router();
const {
  estimateRide,
  requestRide,
  getRideHistory,
  completeRide,
  rateRide,
  markArrived,
  startRide,
  cancelRide
} = require('../controllers/rideController');
const { protect, riderOnly, driverOnly } = require('../utils/jwt');
const {
  validate,
  estimateRules,
  requestRideRules,
  completeRideRules,
  rateRideRules,
  isObjectId
} = require('../utils/validate');
const { param } = require('express-validator');

const rideIdParam = param('rideId').custom(isObjectId).withMessage('Invalid ride ID');

// Any authenticated user can estimate
router.post('/estimate', protect, estimateRules, validate, estimateRide);

// Only riders may request rides or rate them
router.post('/request', protect, riderOnly, requestRideRules, validate, requestRide);
router.put('/:rideId/rate', protect, riderOnly, rateRideRules, validate, rateRide);

// History is available to both riders and drivers
router.get('/history', protect, getRideHistory);

// Lifecycle transitions
router.put('/:rideId/arrived', protect, driverOnly, rideIdParam, validate, markArrived);
router.put('/:rideId/start', protect, driverOnly, rideIdParam, validate, startRide);
router.put('/:rideId/cancel', protect, rideIdParam, validate, cancelRide);

// Only the assigned driver may complete (enforced inside controller + role guard)
router.put('/:rideId/complete', protect, driverOnly, completeRideRules, validate, completeRide);

module.exports = router;
