const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  // Optional when the account was created via OTP-only flow
  password: {
    type: String,
    required: false,
    select: false // never return by default
  },
  fullName: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['rider', 'driver', 'admin'],
    default: 'rider'
  },
  status: {
    type: String,
    enum: ['active', 'suspended'],
    default: 'active'
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  pushToken: {
    type: String
  },
  savedAddresses: [{
    label: { type: String, required: true },
    address: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  }],
  driverDetails: {
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle'
    },
    isOnline: {
      type: Boolean,
      default: false
    },
    currentLocation: {
      lat: Number,
      lng: Number
    },
    // Display average (derived from ratingSum / ratingCount)
    rating: {
      type: Number,
      default: 5.0,
      min: 1,
      max: 5
    },
    // P2: accurate running average without relying on totalTrips
    ratingSum: {
      type: Number,
      default: 0
    },
    ratingCount: {
      type: Number,
      default: 0
    },
    totalTrips: {
      type: Number,
      default: 0
    }
  },
  riderDetails: {
    paymentMethods: [{
      type: String,
      enum: ['cash', 'card', 'wallet']
    }]
  }
}, { timestamps: true });

// Hash password before saving (only when present and modified)
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

UserSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return bcrypt.compare(enteredPassword, this.password);
};

/**
 * Apply a new star rating to this driver's aggregate.
 * Mutates driverDetails in memory; caller must save.
 */
UserSchema.methods.applyDriverRating = function (stars) {
  if (!this.driverDetails) this.driverDetails = {};
  const sum = (this.driverDetails.ratingSum || 0) + stars;
  const count = (this.driverDetails.ratingCount || 0) + 1;
  this.driverDetails.ratingSum = sum;
  this.driverDetails.ratingCount = count;
  this.driverDetails.rating = Math.round((sum / count) * 10) / 10;
  return this.driverDetails.rating;
};

module.exports = mongoose.model('User', UserSchema);
