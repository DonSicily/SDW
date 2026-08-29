const { audit } = require('../utils/audit');
const User = require('../models/User');
const Ride = require('../models/Ride');
const Vehicle = require('../models/Vehicle');

// @desc    Dashboard summary numbers
// @route   GET /api/admin/stats
exports.getStats = async (req, res) => {
  try {
    const [totalRiders, totalDrivers, onlineDrivers, totalVehicles, totalRides, ridesByStatus, revenueAgg] =
      await Promise.all([
        User.countDocuments({ role: 'rider' }),
        User.countDocuments({ role: 'driver' }),
        User.countDocuments({ role: 'driver', 'driverDetails.isOnline': true }),
        Vehicle.countDocuments(),
        Ride.countDocuments(),
        Ride.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        Ride.aggregate([
          { $match: { paymentStatus: 'paid' } },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$finalFare', '$fare.standard'] } } } }
        ])
      ]);

    const statusCounts = ridesByStatus.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {});

    res.json({
      totalRiders,
      totalDrivers,
      onlineDrivers,
      totalVehicles,
      totalRides,
      ridesByStatus: statusCounts,
      totalRevenue: revenueAgg[0]?.total || 0
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ message: 'Failed to load stats' });
  }
};

/**
 * Cursor pagination helpers.
 * Query: ?limit=50&cursor=<ISO date or ObjectId hex>&role=...
 * Returns { items, nextCursor, hasMore }.
 */
function parseLimit(raw, defaultLimit = 50, max = 200) {
  const n = parseInt(raw || String(defaultLimit), 10);
  if (Number.isNaN(n) || n < 1) return defaultLimit;
  return Math.min(n, max);
}

function buildCursorFilter(cursor) {
  if (!cursor) return {};
  // Prefer createdAt ISO; fall back to ObjectId
  const asDate = new Date(cursor);
  if (!Number.isNaN(asDate.getTime()) && String(cursor).includes('-')) {
    return { createdAt: { $lt: asDate } };
  }
  const mongoose = require('mongoose');
  if (mongoose.Types.ObjectId.isValid(cursor)) {
    return { _id: { $lt: cursor } };
  }
  return {};
}

// @desc    List users, optionally filtered by role (cursor pagination)
// @route   GET /api/admin/users?role=rider|driver|admin&limit=50&cursor=...
exports.listUsers = async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const filter = { ...buildCursorFilter(req.query.cursor) };
    if (req.query.role) filter.role = req.query.role;

    const users = await User.find(filter)
      .select('-password')
      .populate('driverDetails.vehicleId')
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1);

    const hasMore = users.length > limit;
    const items = hasMore ? users.slice(0, limit) : users;
    const nextCursor = hasMore
      ? items[items.length - 1].createdAt.toISOString()
      : null;

    res.json({ items, nextCursor, hasMore, limit });
  } catch (error) {
    console.error('Admin listUsers error:', error);
    res.status(500).json({ message: 'Failed to load users' });
  }
};

// @desc    Suspend or reactivate a user account
// @route   PUT /api/admin/users/:id/status
// @body    { status: 'active' | 'suspended' }
exports.setUserStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ message: 'status must be active or suspended' });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    await audit({
      req,
      action: status === 'suspended' ? 'user.suspended' : 'user.reactivated',
      resource: 'user',
      resourceId: user._id,
      metadata: { status },
      awaitWrite: true
    });
    res.json(user);
  } catch (error) {
    console.error('Admin setUserStatus error:', error);
    res.status(500).json({ message: 'Failed to update user' });
  }
};

// @desc    List rides with basic filtering (cursor pagination)
// @route   GET /api/admin/rides?status=completed&limit=50&cursor=...
exports.listRides = async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const filter = { ...buildCursorFilter(req.query.cursor) };
    if (req.query.status) filter.status = req.query.status;

    const rides = await Ride.find(filter)
      .populate('riderId', 'fullName phone')
      .populate('driverId', 'fullName phone')
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1);

    const hasMore = rides.length > limit;
    const items = hasMore ? rides.slice(0, limit) : rides;
    const nextCursor = hasMore
      ? items[items.length - 1].createdAt.toISOString()
      : null;

    res.json({ items, nextCursor, hasMore, limit });
  } catch (error) {
    console.error('Admin listRides error:', error);
    res.status(500).json({ message: 'Failed to load rides' });
  }
};

// @desc    List vehicles (cursor pagination)
// @route   GET /api/admin/vehicles?limit=50&cursor=...
exports.listVehicles = async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const filter = { ...buildCursorFilter(req.query.cursor) };

    const vehicles = await Vehicle.find(filter)
      .populate('assignedTo', 'fullName phone')
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1);

    const hasMore = vehicles.length > limit;
    const items = hasMore ? vehicles.slice(0, limit) : vehicles;
    const nextCursor = hasMore
      ? items[items.length - 1].createdAt.toISOString()
      : null;

    res.json({ items, nextCursor, hasMore, limit });
  } catch (error) {
    console.error('Admin listVehicles error:', error);
    res.status(500).json({ message: 'Failed to load vehicles' });
  }
};

// Allowed fields for vehicle create / update (prevents mass-assignment)
const VEHICLE_FIELDS = [
  'plateNumber', 'make', 'model', 'year', 'color', 'type',
  'fuelType', 'batteryLevel', 'odometer', 'status', 'assignedTo'
];

const pickVehicleFields = (body) => {
  const out = {};
  for (const key of VEHICLE_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

// @desc    Create a vehicle (e.g. from the imported fleet) and optionally assign a driver
// @route   POST /api/admin/vehicles
exports.createVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.create(pickVehicleFields(req.body));
    res.status(201).json(vehicle);
  } catch (error) {
    console.error('Admin createVehicle error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Vehicle with this plate number already exists' });
    }
    res.status(500).json({ message: 'Failed to create vehicle' });
  }
};

// @desc    Update a vehicle's status or assigned driver
// @route   PUT /api/admin/vehicles/:id
exports.updateVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndUpdate(
      req.params.id,
      pickVehicleFields(req.body),
      { new: true, runValidators: true }
    );
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
    res.json(vehicle);
  } catch (error) {
    console.error('Admin updateVehicle error:', error);
    res.status(500).json({ message: 'Failed to update vehicle' });
  }
};
