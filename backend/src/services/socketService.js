const jwt = require('jsonwebtoken');
const Ride = require('../models/Ride');
const User = require('../models/User');
const { sendPushNotification } = require('./pushService');
const {
  isRedisAvailable,
  setDriverLocation,
  removeDriver,
  findNearestDrivers
} = require('./redisService');

// In-memory fallback when Redis is down
// socketId → { userId, location: {lat, lng}, isOnline, updatedAt }
const driverSockets = {};
const pendingRideSockets = {};

const toRad = (deg) => (deg * Math.PI) / 180;

const initSocket = (io) => {
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        (socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Reject non-access tokens (e.g. if a typed JWT is ever reused)
      if (decoded.type && decoded.type !== 'access') {
        return next(new Error('Invalid token type'));
      }
      const user = await User.findById(decoded.id).select('-password');

      if (!user) return next(new Error('User not found'));
      if (user.status === 'suspended') return next(new Error('Account suspended'));

      socket.user = {
        id: String(user._id),
        role: user.role,
        fullName: user.fullName
      };
      next();
    } catch (err) {
      console.error('Socket auth failed:', err.message);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Authenticated connection: ${socket.id} (user ${socket.user.id}, role ${socket.user.role})`);
    socket.join(`user:${socket.user.id}`);

    // --- DRIVER EVENTS ---

    socket.on('driver:location', async (data) => {
      if (socket.user.role !== 'driver') {
        return socket.emit('driver:error', { message: 'Driver role required' });
      }

      const { lat, lng } = data || {};
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return socket.emit('driver:error', { message: 'Valid lat/lng required' });
      }
      // Basic geo sanity (world bounds)
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return socket.emit('driver:error', { message: 'lat/lng out of range' });
      }
      // Soft Nigeria-centric bound (reject clearly impossible jumps for this market)
      // Allow a generous box so border ops still work; not a hard geo-fence.
      if (lat < 3.5 || lat > 14.5 || lng < 2.0 || lng > 15.5) {
        return socket.emit('driver:error', {
          message: 'Location outside supported service area'
        });
      }

      const userId = socket.user.id;
      const prev = driverSockets[socket.id];

      // Anti-spoof: reject impossible speed (> ~200 km/h between updates)
      if (prev?.location && prev.updatedAt) {
        const dtSec = (Date.now() - prev.updatedAt) / 1000;
        if (dtSec > 0 && dtSec < 600) {
          const dLat = toRad(lat - prev.location.lat);
          const dLng = toRad(lng - prev.location.lng);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(prev.location.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
          const distKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const speedKmh = (distKm / dtSec) * 3600;
          if (speedKmh > 200) {
            return socket.emit('driver:error', {
              message: 'Implausible location jump rejected',
              code: 'LOCATION_SPOOF'
            });
          }
        }
      }

      // Always keep a local map for this process (needed for socketId targeting)
      driverSockets[socket.id] = {
        userId,
        location: { lat, lng },
        isOnline: true,
        updatedAt: Date.now()
      };

      // Redis GEO for cross-instance nearest-driver queries
      await setDriverLocation(userId, lng, lat, { socketId: socket.id });

      await User.findByIdAndUpdate(userId, {
        'driverDetails.currentLocation': { lat, lng },
        'driverDetails.isOnline': true
      });
    });

    socket.on('driver:offline', async () => {
      if (socket.user.role !== 'driver') return;
      const userId = socket.user.id;
      delete driverSockets[socket.id];
      await removeDriver(userId);
      await User.findByIdAndUpdate(userId, { 'driverDetails.isOnline': false });
    });

    socket.on('driver:accept', async ({ rideId }) => {
      if (socket.user.role !== 'driver') {
        return socket.emit('driver:error', { message: 'Driver role required' });
      }

      try {
        const driverId = socket.user.id;

        // P0: atomic claim — only one driver can win the race
        const ride = await Ride.findOneAndUpdate(
          { _id: rideId, status: 'pending', driverId: null },
          { $set: { driverId, status: 'accepted' } },
          { new: true }
        );

        if (!ride) {
          // Distinguish not-found vs already-taken
          const existing = await Ride.findById(rideId).select('status driverId');
          if (!existing) {
            return socket.emit('driver:error', { message: 'Ride not found' });
          }
          return socket.emit('driver:error', {
            message: existing.driverId
              ? 'Ride already assigned'
              : `Ride is already ${existing.status}`
          });
        }

        const payload = {
          rideId: ride._id,
          driverLocation: driverSockets[socket.id]?.location || null,
          driverId,
          message: 'Your driver is on the way!'
        };

        // Scoped to rider room only
        io.to(`user:${ride.riderId}`).emit('rider:ride-accepted', payload);

        const riderSocketId = pendingRideSockets[String(rideId)];
        if (riderSocketId) {
          io.to(riderSocketId).emit('rider:ride-accepted', payload);
          delete pendingRideSockets[String(rideId)];
        }

        const rider = await User.findById(ride.riderId).select('pushToken');
        if (rider?.pushToken) {
          sendPushNotification(
            rider.pushToken,
            'Driver found!',
            'Your driver has accepted the ride and is on the way.',
            { type: 'ride-accepted', rideId: String(ride._id) }
          );
        }

        socket.emit('driver:accept-success', { rideId: ride._id });
      } catch (error) {
        console.error('Accept error:', error);
        socket.emit('driver:error', { message: 'Failed to accept ride' });
      }
    });

    socket.on('driver:reject', async ({ rideId }) => {
      if (socket.user.role !== 'driver') return;
      socket.emit('driver:reject-success', { rideId });
    });

    // --- RIDER EVENTS ---
    // Ride creation is HTTP-only (POST /api/rides/request). No rider:request handler.

    socket.on('rider:cancel', async ({ rideId }) => {
      if (socket.user.role !== 'rider') return;
      try {
        const ride = await Ride.findById(rideId);
        if (!ride) return socket.emit('rider:error', { message: 'Ride not found' });
        if (String(ride.riderId) !== socket.user.id) {
          return socket.emit('rider:error', { message: 'You can only cancel your own rides' });
        }
        if (!['pending', 'accepted'].includes(ride.status)) {
          return socket.emit('rider:error', { message: `Cannot cancel a ride that is ${ride.status}` });
        }

        ride.status = 'cancelled';
        await ride.save();
        delete pendingRideSockets[String(rideId)];

        if (ride.driverId) {
          io.to(`user:${ride.driverId}`).emit('driver:ride-cancelled', { rideId });
        }
        socket.emit('rider:cancel-success', { rideId });
      } catch (error) {
        console.error('Cancel error:', error);
        socket.emit('rider:error', { message: 'Failed to cancel ride' });
      }
    });

    socket.on('disconnect', async () => {
      if (driverSockets[socket.id]) {
        const { userId } = driverSockets[socket.id];
        delete driverSockets[socket.id];
        await removeDriver(userId);
        await User.findByIdAndUpdate(userId, {
          'driverDetails.isOnline': false
        }).catch(() => {});
      }
      if (socket.data?.pendingRideId) {
        delete pendingRideSockets[socket.data.pendingRideId];
      }
    });
  });
};

/**
 * Prefer Redis GEO; fall back to in-memory Euclidean search.
 */
const findNearestDriver = async (riderLat, riderLng) => {
  // Redis path
  const geo = await findNearestDrivers(riderLng, riderLat, 15, 5);
  if (geo && geo.length > 0) {
    // Prefer a driver whose socket is still live on this (or any) node.
    // Meta stores socketId from the process that last updated location.
    for (const candidate of geo) {
      const socketId = candidate.meta?.socketId;
      // If we have a local socket, use it; otherwise emit via user room
      if (socketId && driverSockets[socketId]) {
        return {
          socketId,
          userId: candidate.driverId,
          location: driverSockets[socketId].location,
          distanceKm: candidate.distanceKm
        };
      }
      // Cross-node: target the driver's private room
      return {
        socketId: null,
        userRoom: `user:${candidate.driverId}`,
        userId: candidate.driverId,
        distanceKm: candidate.distanceKm
      };
    }
  }

  // In-memory fallback
  let minDist = Infinity;
  let nearest = null;
  for (const [socketId, driver] of Object.entries(driverSockets)) {
    if (!driver.isOnline || !driver.location) continue;
    const dist = Math.hypot(
      driver.location.lat - riderLat,
      driver.location.lng - riderLng
    );
    if (dist < minDist) {
      minDist = dist;
      nearest = { socketId, ...driver };
    }
  }
  return nearest;
};

const notifyNearestDriver = async (io, { rideId, pickup, dropoff, fare, distance, duration }) => {
  const nearest = await findNearestDriver(pickup.lat, pickup.lng);
  if (!nearest) return { found: false };

  const payload = {
    rideId,
    pickup,
    dropoff,
    fare,
    distance,
    duration
  };

  if (nearest.socketId) {
    io.to(nearest.socketId).emit('driver:new-ride', payload);
  } else if (nearest.userRoom) {
    io.to(nearest.userRoom).emit('driver:new-ride', payload);
  }

  try {
    const driverUser = await User.findById(nearest.userId).select('pushToken');
    if (driverUser?.pushToken) {
      sendPushNotification(
        driverUser.pushToken,
        'New ride request',
        `Pickup at ${pickup.address || 'nearby'} — ₦${fare}`,
        { type: 'new-ride', rideId: String(rideId) }
      );
    }
  } catch (err) {
    console.error('Push to driver failed:', err.message);
  }

  return { found: true, driverId: nearest.userId };
};

module.exports = { initSocket, notifyNearestDriver };
