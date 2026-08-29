const mongoose = require('mongoose');

const VehicleSchema = new mongoose.Schema({
  plateNumber: {
    type: String,
    required: true,
    unique: true
  },
  make: {
    type: String,
    required: true
  },
  model: {
    type: String,
    required: true
  },
  year: {
    type: Number
  },
  color: String,
  type: {
    type: String,
    enum: ['sedan', 'suv', 'minibus', 'hatchback'],
    default: 'sedan'
  },
  fuelType: {
    type: String,
    enum: ['petrol', 'diesel', 'electric'],
    required: true
  },
  batteryLevel: { // For EVs
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  odometer: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'maintenance', 'inactive'],
    default: 'active'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

module.exports = mongoose.model('Vehicle', VehicleSchema);
