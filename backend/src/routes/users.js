const express = require('express');
const router = express.Router();
const { listAddresses, addAddress, deleteAddress } = require('../controllers/addressController');
const { protect } = require('../utils/jwt');
const { validate, addAddressRules, isObjectId } = require('../utils/validate');
const { param } = require('express-validator');

router.use(protect);

router.get('/addresses', listAddresses);
router.post('/addresses', addAddressRules, validate, addAddress);
router.delete(
  '/addresses/:addressId',
  param('addressId').custom(isObjectId).withMessage('Invalid address ID'),
  validate,
  deleteAddress
);

module.exports = router;
