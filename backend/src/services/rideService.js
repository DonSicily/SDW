/**
 * Single source of truth for creating a ride request.
 * Used by HTTP POST /api/rides/request (and any future callers).
 * Socket path no longer creates rides — clients must use the HTTP API.
 */
const Ride = require('../models/Ride');
const User = require('../models/User');
const { calculateFare } = require('./pricingService');
const { notifyNearestDriver } = require('./socketService');
const { countOnlineDrivers, isRedisAvailable } = require('./redisService');

const PENDING_TIMEOUT_MS = parseInt(process.env.RIDE_PENDING_TIMEOUT_MS || String(3 * 60 * 1000), 10); // 3 min

/**
 * Estimate how "busy" the fleet is (0–100).
 * busy / online * 100, capped. Used by pricing for scarcity bonus.
 */
async function computeDriverUtilization() {
  try {
    let online = null;
    if (isRedisAvailable()) {
      online = await countOnlineDrivers();
    }
    if (online == null) {
      online = await User.countDocuments({
        role: 'driver',
        'driverDetails.isOnline': true
      });
    }
    if (!online || online <= 0) return 50;

    const busy = await Ride.countDocuments({
      status: { $in: ['accepted', 'arrived', 'started'] }
    });
    const pct = Math.round((busy / online) * 100);
    return Math.max(0, Math.min(100, pct));
  } catch (err) {
    console.warn('computeDriverUtilization failed:', err.message);
    return 50;
  }
}

/**
 * Create a pending ride with server-side fare and attempt driver match.
 *
 * @param {object} opts
 * @param {string} opts.riderId
 * @param {object} opts.pickup  { lat, lng, address }
 * @param {object} opts.dropoff { lat, lng, address }
 * @param {string} [opts.paymentMethod]
 * @param {object} opts.io     Socket.IO server instance
 * @returns {Promise<{ ride, match, serverFare }>}
 */
async function createRideRequest({ riderId, pickup, dropoff, paymentMethod, io }) {
  if (!pickup?.lat || !pickup?.lng || !dropoff?.lat || !dropoff?.lng) {
    const err = new Error('Valid pickup and dropoff coordinates are required');
    err.status = 400;
    throw err;
  }
  if (!pickup?.address || !dropoff?.address) {
    const err = new Error('Pickup and dropoff addresses are required');
    err.status = 400;
    throw err;
  }

  // Reject if rider already has an open ride (prevents concurrent requests)
  const openStatuses = ['pending', 'accepted', 'arrived', 'started'];
  const existingOpen = await Ride.findOne({
    riderId,
    status: { $in: openStatuses }
  }).select('_id status');
  if (existingOpen) {
    const err = new Error(
      `You already have an active ride (${existingOpen.status}). Cancel or complete it before requesting another.`
    );
    err.status = 409;
    err.existingRideId = existingOpen._id;
    throw err;
  }

  // Live utilization: % of drivers currently online that are busy on a trip.
  // Falls back to a neutral 50 when counts are unavailable.
  const driverUtilization = await computeDriverUtilization();
  const serverFare = await calculateFare(pickup, dropoff, driverUtilization);

  const ride = await Ride.create({
    riderId,
    pickup,
    dropoff,
    fare: {
      standard: serverFare.standard,
      minBid: serverFare.minBid
    },
    distanceKm: serverFare.distanceKm,
    durationMin: serverFare.durationMin,
    paymentMethod: paymentMethod || 'cash',
    status: 'pending'
  });

  const match = await notifyNearestDriver(io, {
    rideId: ride._id,
    pickup,
    dropoff,
    fare: serverFare.standard,
    distance: serverFare.distanceKm,
    duration: serverFare.durationMin
  });

  if (io) {
    io.to(`user:${riderId}`).emit('rider:searching', {
      rideId: ride._id,
      fare: {
        standard: serverFare.standard,
        minBid: serverFare.minBid,
        distanceKm: serverFare.distanceKm,
        durationMin: serverFare.durationMin
      },
      message: match.found
        ? 'Searching for nearest driver...'
        : 'No drivers available at the moment. Please try again.'
    });
  }

  if (!match.found) {
    await Ride.findByIdAndUpdate(ride._id, { status: 'cancelled' });
    ride.status = 'cancelled';
  }

  return { ride, match, serverFare };
}

/**
 * Allowed status transitions (from → to[]).
 * complete is handled separately with fare logic.
 */
const TRANSITIONS = {
  pending: ['cancelled'],
  accepted: ['arrived', 'cancelled'],
  arrived: ['started', 'cancelled'],
  started: ['completed'], // completed via completeRide
  completed: [],
  cancelled: []
};

/**
 * Cancel abandoned pending rides older than PENDING_TIMEOUT_MS.
 * Safe to call on an interval.
 */
async function expirePendingRides(io) {
  const cutoff = new Date(Date.now() - PENDING_TIMEOUT_MS);
  const stale = await Ride.find({
    status: 'pending',
    createdAt: { $lt: cutoff }
  }).select('_id riderId');

  if (stale.length === 0) return 0;

  const ids = stale.map((r) => r._id);
  await Ride.updateMany(
    { _id: { $in: ids }, status: 'pending' },
    { $set: { status: 'cancelled' } }
  );

  if (io) {
    for (const r of stale) {
      io.to(`user:${r.riderId}`).emit('rider:ride-expired', {
        rideId: r._id,
        message: 'No driver accepted in time. Please request again.'
      });
    }
  }

  return stale.length;
}

function startPendingRideJanitor(io) {
  const intervalMs = Math.min(PENDING_TIMEOUT_MS, 60 * 1000); // at least every minute
  const timer = setInterval(async () => {
    try {
      const n = await expirePendingRides(io);
      if (n > 0) console.log(`🧹 Expired ${n} pending ride(s)`);
    } catch (err) {
      console.error('Pending ride janitor error:', err.message);
    }
  }, intervalMs);

  // Don't keep process alive solely for the timer in tests
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  createRideRequest,
  computeDriverUtilization,
  TRANSITIONS,
  expirePendingRides,
  startPendingRideJanitor,
  PENDING_TIMEOUT_MS
};
