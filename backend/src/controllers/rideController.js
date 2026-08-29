const Ride = require('../models/Ride');
const User = require('../models/User');
const { calculateFare } = require('../services/pricingService');
const { sendPushNotification } = require('../services/pushService');
const { createRideRequest, TRANSITIONS } = require('../services/rideService');
const { audit } = require('../utils/audit');

// @desc    Estimate fare
// @route   POST /api/rides/estimate
exports.estimateRide = async (req, res) => {
  try {
    const { pickup, dropoff } = req.body;
    const { computeDriverUtilization } = require('../services/rideService');
    const driverUtilization = await computeDriverUtilization();
    const fare = await calculateFare(pickup, dropoff, driverUtilization);
    res.json({ ...fare, driverUtilization });
  } catch (error) {
    console.error('Estimate error:', error);
    res.status(500).json({ message: 'Failed to calculate fare' });
  }
};

// @desc    Request a ride (single path — HTTP only; sockets must not create rides)
// @route   POST /api/rides/request
exports.requestRide = async (req, res) => {
  try {
    const { pickup, dropoff, paymentMethod } = req.body;
    const riderId = req.user.id;
    const io = req.app.get('io');

    const { ride, match, serverFare } = await createRideRequest({
      riderId,
      pickup,
      dropoff,
      paymentMethod,
      io
    });

    res.status(201).json({
      success: true,
      rideId: ride._id,
      driverFound: match.found,
      fare: {
        standard: serverFare.standard,
        minBid: serverFare.minBid,
        distanceKm: serverFare.distanceKm,
        durationMin: serverFare.durationMin
      },
      status: ride.status,
      message: match.found
        ? 'Ride requested. Searching for driver.'
        : 'No drivers available at the moment.'
    });
  } catch (error) {
    if (error.status === 400 || error.status === 409) {
      return res.status(error.status).json({
        message: error.message,
        ...(error.existingRideId ? { existingRideId: error.existingRideId } : {})
      });
    }
    console.error('Request ride error:', error);
    res.status(500).json({ message: 'Failed to request ride' });
  }
};

// @desc    Get ride history for a user
// @route   GET /api/rides/history
// PII: the other party's full phone is redacted; only a masked form is returned.
exports.getRideHistory = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const rides = await Ride.find({
      $or: [{ riderId: userId }, { driverId: userId }]
    })
      .populate('riderId', 'fullName phone')
      .populate('driverId', 'fullName phone')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const maskPhone = (phone) => {
      if (!phone || typeof phone !== 'string') return undefined;
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 4) return '****';
      return '***' + digits.slice(-4);
    };

    const sanitized = rides.map((ride) => {
      const out = { ...ride };
      // Rider viewing: keep own phone, mask driver
      // Driver viewing: keep own phone, mask rider
      if (ride.riderId && typeof ride.riderId === 'object') {
        const isSelf = String(ride.riderId._id) === userId;
        out.riderId = {
          _id: ride.riderId._id,
          fullName: ride.riderId.fullName,
          phone: isSelf ? ride.riderId.phone : maskPhone(ride.riderId.phone)
        };
      }
      if (ride.driverId && typeof ride.driverId === 'object') {
        const isSelf = String(ride.driverId._id) === userId;
        out.driverId = {
          _id: ride.driverId._id,
          fullName: ride.driverId.fullName,
          phone: isSelf ? ride.driverId.phone : maskPhone(ride.driverId.phone)
        };
      }
      return out;
    });

    res.json(sanitized);
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ message: 'Failed to fetch history' });
  }
};

/**
 * Shared helper for driver status transitions: accepted → arrived → started
 * and cancel from pending/accepted/arrived.
 */
async function transitionRide({ rideId, actor, toStatus, allowedRoles }) {
  const ride = await Ride.findById(rideId);
  if (!ride) {
    const err = new Error('Ride not found');
    err.status = 404;
    throw err;
  }

  const isDriver = ride.driverId && String(ride.driverId) === String(actor.id);
  const isRider = String(ride.riderId) === String(actor.id);

  if (toStatus === 'cancelled') {
    if (isRider && ['pending', 'accepted'].includes(ride.status)) {
      // ok
    } else if (isDriver && ['accepted', 'arrived'].includes(ride.status)) {
      // ok
    } else if (actor.role === 'admin') {
      // ok
    } else {
      const err = new Error('Not authorized to cancel this ride in its current state');
      err.status = 403;
      throw err;
    }
  } else {
    // arrived / started — driver only
    if (!isDriver && actor.role !== 'admin') {
      const err = new Error('Only the assigned driver can update this status');
      err.status = 403;
      throw err;
    }
  }

  const allowed = TRANSITIONS[ride.status] || [];
  if (!allowed.includes(toStatus)) {
    const err = new Error(`Cannot move ride from '${ride.status}' to '${toStatus}'`);
    err.status = 400;
    throw err;
  }

  ride.status = toStatus;
  if (toStatus === 'started' && !ride.startTime) {
    ride.startTime = new Date();
  }
  await ride.save();
  return ride;
}

function emitStatus(io, ride, eventName) {
  if (!io) return;
  const payload = {
    rideId: ride._id,
    status: ride.status,
    riderId: String(ride.riderId),
    driverId: ride.driverId ? String(ride.driverId) : null
  };
  io.to(`user:${ride.riderId}`).emit(eventName, payload);
  if (ride.driverId) {
    io.to(`user:${ride.driverId}`).emit(eventName, payload);
  }
}

// @desc    Driver marks arrived at pickup
// @route   PUT /api/rides/:rideId/arrived
exports.markArrived = async (req, res) => {
  try {
    const ride = await transitionRide({
      rideId: req.params.rideId,
      actor: req.user,
      toStatus: 'arrived',
      allowedRoles: ['driver']
    });
    emitStatus(req.app.get('io'), ride, 'ride:status');
    audit({
      req,
      action: 'ride.arrived',
      resource: 'ride',
      resourceId: ride._id
    });
    res.json({ success: true, ride });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('markArrived error:', error);
    res.status(status).json({ message: error.message || 'Failed to update ride' });
  }
};

// @desc    Driver starts the trip
// @route   PUT /api/rides/:rideId/start
exports.startRide = async (req, res) => {
  try {
    const ride = await transitionRide({
      rideId: req.params.rideId,
      actor: req.user,
      toStatus: 'started',
      allowedRoles: ['driver']
    });
    emitStatus(req.app.get('io'), ride, 'ride:status');
    audit({
      req,
      action: 'ride.started',
      resource: 'ride',
      resourceId: ride._id
    });
    res.json({ success: true, ride });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('startRide error:', error);
    res.status(status).json({ message: error.message || 'Failed to update ride' });
  }
};

// @desc    Cancel a ride (rider or assigned driver, status-dependent)
// @route   PUT /api/rides/:rideId/cancel
exports.cancelRide = async (req, res) => {
  try {
    const ride = await transitionRide({
      rideId: req.params.rideId,
      actor: req.user,
      toStatus: 'cancelled',
      allowedRoles: ['rider', 'driver']
    });
    emitStatus(req.app.get('io'), ride, 'ride:cancelled');
    audit({
      req,
      action: 'ride.cancelled',
      resource: 'ride',
      resourceId: ride._id,
      metadata: { by: req.user.role }
    });
    res.json({ success: true, ride });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('cancelRide error:', error);
    res.status(status).json({ message: error.message || 'Failed to cancel ride' });
  }
};

// @desc    Complete a ride (driver ends trip)
// @route   PUT /api/rides/:rideId/complete
exports.completeRide = async (req, res) => {
  try {
    const { rideId } = req.params;
    const { distanceKm, durationMin, finalFare } = req.body;

    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    if (!ride.driverId || String(ride.driverId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Only the assigned driver can complete this ride' });
    }

    // Enforce started (or auto-start from arrived for a single step)
    if (ride.status === 'arrived') {
      // Convenience: treat complete-from-arrived as start + complete
      ride.status = 'started';
      if (!ride.startTime) ride.startTime = new Date();
    } else if (ride.status !== 'started') {
      return res.status(400).json({
        message: `Cannot complete a ride that is currently '${ride.status}'. Mark arrived then start first.`
      });
    }

    // P1: tighter finalFare bound — max 25% over estimate or +₦500, whichever is larger
    // Always store integer Naira so Paystack kobo conversion is exact
    const estimated = ride.fare?.standard || 0;
    let safeFinalFare = estimated;
    if (typeof finalFare === 'number' && finalFare > 0) {
      const maxAllowed = Math.max(estimated * 1.25, estimated + 500);
      const minAllowed = estimated * 0.5;
      safeFinalFare = Math.min(Math.max(finalFare, minAllowed), maxAllowed);
    }

    ride.status = 'completed';
    ride.distanceKm = typeof distanceKm === 'number' ? distanceKm : ride.distanceKm;
    ride.durationMin = typeof durationMin === 'number' ? durationMin : ride.durationMin;
    ride.finalFare = Math.round(Number(safeFinalFare) || 0);
    ride.endTime = new Date();
    if (!ride.startTime) ride.startTime = ride.endTime;
    await ride.save();

    await User.findByIdAndUpdate(ride.driverId, {
      $inc: { 'driverDetails.totalTrips': 1 }
    });

    const io = req.app.get('io');
    const completionPayload = {
      rideId: ride._id,
      riderId: String(ride.riderId),
      finalFare: ride.finalFare
    };
    io.to(`user:${ride.riderId}`).emit('rider:ride-completed', completionPayload);
    if (ride.driverId) {
      io.to(`user:${ride.driverId}`).emit('driver:ride-completed', completionPayload);
    }

    const rider = await User.findById(ride.riderId).select('pushToken');
    if (rider?.pushToken) {
      sendPushNotification(
        rider.pushToken,
        'Ride completed',
        `Your trip is done — ₦${ride.finalFare || ride.fare?.standard || 0}. Rate your driver!`,
        { type: 'ride-completed', rideId: String(ride._id) }
      );
    }

    audit({
      req,
      action: 'ride.completed',
      resource: 'ride',
      resourceId: ride._id,
      metadata: { finalFare: ride.finalFare, driverId: String(ride.driverId) }
    });

    res.json({
      success: true,
      ride,
      message: 'Ride completed successfully'
    });
  } catch (error) {
    console.error('Complete ride error:', error);
    res.status(500).json({ message: 'Failed to complete ride' });
  }
};

// @desc    Rate and review a completed ride's driver
// @route   PUT /api/rides/:rideId/rate
exports.rateRide = async (req, res) => {
  try {
    const { rideId } = req.params;
    const { rating, review } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'rating must be between 1 and 5' });
    }

    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }
    if (String(ride.riderId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'You can only rate your own rides' });
    }
    if (ride.status !== 'completed') {
      return res.status(400).json({ message: 'Only completed rides can be rated' });
    }
    if (ride.rating) {
      return res.status(400).json({ message: 'This ride has already been rated' });
    }

    ride.rating = rating;
    ride.review = review || '';
    await ride.save();

    // P2: dedicated ratingSum / ratingCount (not derived from totalTrips)
    if (ride.driverId) {
      const driver = await User.findById(ride.driverId);
      if (driver) {
        driver.applyDriverRating(rating);
        await driver.save();
      }
    }

    res.json({ success: true, ride });
  } catch (error) {
    console.error('Rate ride error:', error);
    res.status(500).json({ message: 'Failed to submit rating' });
  }
};
