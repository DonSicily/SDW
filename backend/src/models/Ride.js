const mongoose = require('mongoose');

const RideSchema = new mongoose.Schema({
  riderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  pickup: {
    address: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  dropoff: {
    address: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  fare: {
    standard: { type: Number, required: true },
    minBid: { type: Number }
  },
  finalFare: {
    type: Number
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'arrived', 'started', 'completed', 'cancelled'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'wallet'],
    default: 'cash'
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'pending', 'paid', 'failed'],
    default: 'unpaid'
  },
  paymentReference: {
    type: String
  },
  startTime: Date,
  endTime: Date,
  distanceKm: Number,
  durationMin: Number,
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  review: {
    type: String,
    trim: true,
    maxlength: 500
  }
}, { timestamps: true });

module.exports = mongoose.model('Ride', RideSchema);
