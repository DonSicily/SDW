const User = require('../models/User');

const MAX_SAVED_ADDRESSES = 20;

// @desc    List the current user's saved addresses
// @route   GET /api/users/addresses
exports.listAddresses = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('savedAddresses');
    res.json(user.savedAddresses || []);
  } catch (error) {
    console.error('List addresses error:', error);
    res.status(500).json({ message: 'Failed to load saved addresses' });
  }
};

// @desc    Save a new favorite address
// @route   POST /api/users/addresses
// @body    { label, address, lat, lng }
exports.addAddress = async (req, res) => {
  try {
    const { label, address, lat, lng } = req.body;
    if (!label || !address || lat === undefined || lng === undefined) {
      return res.status(400).json({ message: 'label, address, lat and lng are required' });
    }

    const user = await User.findById(req.user.id);
    if (!user.savedAddresses) user.savedAddresses = [];

    // P1: cap saved addresses to prevent unbounded growth
    if (user.savedAddresses.length >= MAX_SAVED_ADDRESSES) {
      return res.status(400).json({
        message: `You can save at most ${MAX_SAVED_ADDRESSES} addresses. Delete one first.`
      });
    }

    user.savedAddresses.push({ label, address, lat, lng });
    await user.save();

    res.status(201).json(user.savedAddresses[user.savedAddresses.length - 1]);
  } catch (error) {
    console.error('Add address error:', error);
    res.status(500).json({ message: 'Failed to save address' });
  }
};

// @desc    Delete a saved address
// @route   DELETE /api/users/addresses/:addressId
exports.deleteAddress = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    user.savedAddresses = (user.savedAddresses || []).filter(
      (a) => String(a._id) !== req.params.addressId
    );
    await user.save();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({ message: 'Failed to delete address' });
  }
};

module.exports.MAX_SAVED_ADDRESSES = MAX_SAVED_ADDRESSES;
