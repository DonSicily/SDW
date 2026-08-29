const User = require('../models/User');
const Ride = require('../models/Ride');
const { setDriverLocation, removeDriver } = require('../services/redisService');

// @desc    Toggle driver online/offline status
// @route   PUT /api/drivers/status
exports.toggleStatus = async (req, res) => {
  try {
    const { isOnline } = req.body;
    const driverId = req.user.id;

    const user = await User.findById(driverId);
    if (!user || user.role !== 'driver') {
      return res.status(403).json({ message: 'Not authorized as driver' });
    }

    user.driverDetails.isOnline = !!isOnline;
    if (isOnline && req.body.location) {
      const { lat, lng } = req.body.location;
      if (typeof lat === 'number' && typeof lng === 'number') {
        user.driverDetails.currentLocation = { lat, lng };
      }
    }
    await user.save();

    // P1: keep Redis GEO in sync so nearest-driver matching works without a socket heartbeat
    if (isOnline) {
      const loc = user.driverDetails.currentLocation;
      if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
        await setDriverLocation(driverId, loc.lng, loc.lat, { source: 'http' });
      }
    } else {
      await removeDriver(driverId);
    }

    // Scoped notification — only useful for admin dashboards via rooms if needed later
    const io = req.app.get('io');
    if (io) {
      const event = isOnline ? 'driver:online' : 'driver:offline';
      // Prefer private room over global broadcast
      io.to(`user:${driverId}`).emit(event, {
        userId: driverId,
        location: user.driverDetails.currentLocation || null
      });
    }

    res.json({
      success: true,
      isOnline: user.driverDetails.isOnline,
      message: isOnline ? 'Driver is now online' : 'Driver is now offline'
    });
  } catch (error) {
    console.error('Toggle status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get driver earnings
// @route   GET /api/drivers/earnings
exports.getEarnings = async (req, res) => {
  try {
    const driverId = req.user.id;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rides = await Ride.find({
      driverId,
      status: 'completed',
      createdAt: { $gte: today }
    });

    const totalEarnings = rides.reduce(
      (sum, ride) => sum + (ride.finalFare || ride.fare?.standard || 0),
      0
    );
    const totalTrips = rides.length;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const weeklyRides = await Ride.find({
      driverId,
      status: 'completed',
      createdAt: { $gte: sevenDaysAgo }
    });

    const weeklyEarnings = weeklyRides.reduce(
      (sum, ride) => sum + (ride.finalFare || ride.fare?.standard || 0),
      0
    );

    res.json({
      today: {
        earnings: totalEarnings,
        trips: totalTrips
      },
      weekly: {
        earnings: weeklyEarnings,
        trips: weeklyRides.length
      },
      totalTrips: await Ride.countDocuments({ driverId, status: 'completed' })
    });
  } catch (error) {
    console.error('Earnings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Update driver location (manual update)
// @route   PUT /api/drivers/location
exports.updateLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const driverId = req.user.id;

    await User.findByIdAndUpdate(driverId, {
      'driverDetails.currentLocation': { lat, lng },
      'driverDetails.isOnline': true
    });

    // P1: Redis GEO sync
    await setDriverLocation(driverId, lng, lat, { source: 'http' });

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${driverId}`).emit('driver:location-update', { userId: driverId, lat, lng });
    }

    res.json({ success: true, message: 'Location updated' });
  } catch (error) {
    console.error('Location error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
