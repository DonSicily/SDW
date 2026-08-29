const crypto = require('crypto');
const Ride = require('../models/Ride');
const { initializeTransaction, verifyTransaction } = require('../services/paystackService');

// @desc    Start a Paystack payment for a ride
// @route   POST /api/payments/initialize
// @body    { rideId }
exports.initializePayment = async (req, res) => {
  try {
    const { rideId } = req.body;
    if (!rideId) {
      return res.status(400).json({ message: 'rideId is required' });
    }

    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }
    if (String(ride.riderId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'You can only pay for your own ride' });
    }

    // P0: only completed rides can be paid for
    if (ride.status !== 'completed') {
      return res.status(400).json({
        message: `Payment is only allowed for completed rides (current status: '${ride.status}')`
      });
    }
    if (ride.paymentStatus === 'paid') {
      return res.status(400).json({ message: 'This ride has already been paid' });
    }

    // Always integer Naira (finalFare is rounded on complete; fare.standard should be too)
    const amount = Math.round(Number(ride.finalFare || ride.fare?.standard) || 0);
    if (amount <= 0) {
      return res.status(400).json({ message: 'Ride has no payable fare yet' });
    }

    const email = req.user.email || `${req.user.phone.replace(/[^0-9]/g, '')}@taxiapp.ng`;
    const reference = `ride_${ride._id}_${Date.now()}`;

    const paystackRes = await initializeTransaction({
      email,
      amountNaira: amount,
      reference,
      metadata: { rideId: String(ride._id), riderId: String(req.user.id) }
    });

    if (!paystackRes.status) {
      return res.status(502).json({ message: paystackRes.message || 'Paystack initialization failed' });
    }

    ride.paymentReference = reference;
    ride.paymentStatus = 'pending';
    ride.paymentMethod = 'card';
    await ride.save();

    res.json({
      authorizationUrl: paystackRes.data.authorization_url,
      accessCode: paystackRes.data.access_code,
      reference
    });
  } catch (error) {
    console.error('Payment init error:', error.response?.data || error.message);
    res.status(500).json({ message: 'Failed to initialize payment' });
  }
};

// @desc    Verify a payment by reference (called by the app after checkout, or polled)
// @route   GET /api/payments/verify/:reference
exports.verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const ride = await Ride.findOne({ paymentReference: reference });
    if (!ride) {
      return res.status(404).json({ message: 'No ride found for this payment reference' });
    }
    // Only the ride's rider (or an admin) may query payment status
    if (String(ride.riderId) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'You can only verify payments for your own rides' });
    }

    const paystackRes = await verifyTransaction(reference);
    const txStatus = paystackRes.data?.status;

    if (txStatus === 'success') {
      ride.paymentStatus = 'paid';
      await ride.save();
      return res.json({ paid: true, ride });
    }

    ride.paymentStatus = txStatus === 'failed' ? 'failed' : 'pending';
    await ride.save();
    res.json({ paid: false, status: ride.paymentStatus });
  } catch (error) {
    console.error('Payment verify error:', error.response?.data || error.message);
    res.status(500).json({ message: 'Failed to verify payment' });
  }
};

// @desc    Paystack webhook — source of truth for payment confirmation
// @route   POST /api/payments/webhook
// NOTE: this route must receive the RAW request body (see server.js) so the
// signature below can be validated against exactly what Paystack sent.
exports.paystackWebhook = async (req, res) => {
  try {
    // P0: fail closed if secret is not configured
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      console.error('PAYSTACK_SECRET_KEY is not set — rejecting webhook');
      return res.status(503).send('Payment webhook not configured');
    }

    const signature = req.headers['x-paystack-signature'];
    const expected = crypto
      .createHmac('sha512', secret)
      .update(req.body) // raw Buffer
      .digest('hex');

    if (!signature || signature !== expected) {
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(req.body.toString('utf8'));

    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      const ride = await Ride.findOne({ paymentReference: reference });
      if (ride && ride.paymentStatus !== 'paid') {
        ride.paymentStatus = 'paid';
        await ride.save();
      }
    }

    // Always 200 quickly so Paystack doesn't retry unnecessarily
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error.message);
    res.sendStatus(200); // still ack to avoid repeated retries; we log the failure
  }
};
