const express = require('express');
const router = express.Router();
const { 
  toggleStatus, 
  getEarnings, 
  updateLocation 
} = require('../controllers/driverController');
const { protect, driverOnly } = require('../utils/jwt');
const { body } = require('express-validator');
const { validate } = require('../utils/validate');

// All routes require driver role
router.use(protect);
router.use(driverOnly);

router.put(
  '/status',
  body('isOnline').isBoolean().withMessage('isOnline must be a boolean'),
  body('location.lat').optional().isFloat({ min: -90, max: 90 }),
  body('location.lng').optional().isFloat({ min: -180, max: 180 }),
  validate,
  toggleStatus
);
router.get('/earnings', getEarnings);
router.put(
  '/location',
  body('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid lat required'),
  body('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid lng required'),
  validate,
  updateLocation
);

module.exports = router;
