const express = require('express');
const router = express.Router();
const {
  getStats,
  listUsers,
  setUserStatus,
  listRides,
  listVehicles,
  createVehicle,
  updateVehicle
} = require('../controllers/adminController');
const { protect, adminOnly } = require('../utils/jwt');
const {
  validate,
  setUserStatusRules,
  createVehicleRules,
  isObjectId
} = require('../utils/validate');
const { param, body } = require('express-validator');

router.use(protect);
router.use(adminOnly);

router.get('/stats', getStats);

router.get('/users', listUsers);
router.put('/users/:id/status', setUserStatusRules, validate, setUserStatus);

router.get('/rides', listRides);

router.get('/vehicles', listVehicles);
router.post('/vehicles', createVehicleRules, validate, createVehicle);
router.put(
  '/vehicles/:id',
  param('id').custom(isObjectId).withMessage('Invalid vehicle ID'),
  body('status').optional().isIn(['active', 'maintenance', 'inactive']),
  body('fuelType').optional().isIn(['petrol', 'diesel', 'electric']),
  validate,
  updateVehicle
);

module.exports = router;
