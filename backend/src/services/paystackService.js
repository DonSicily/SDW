const axios = require('axios');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

const paystackClient = axios.create({
  baseURL: PAYSTACK_BASE_URL,
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  }
});

// Initialize a transaction. Amount is passed in Naira and converted to kobo (Paystack's base unit).
// Always quantize to whole Naira first so floating-point fares never produce fractional kobo.
const initializeTransaction = async ({ email, amountNaira, reference, metadata = {}, callback_url }) => {
  const naira = Math.round(Number(amountNaira) || 0);
  if (naira <= 0) {
    throw new Error('Payment amount must be a positive whole number of Naira');
  }
  const payload = {
    email,
    amount: naira * 100, // kobo — exact integer
    reference,
    metadata,
    currency: 'NGN'
  };
  if (callback_url) payload.callback_url = callback_url;

  const { data } = await paystackClient.post('/transaction/initialize', payload);
  return data; // { status, message, data: { authorization_url, access_code, reference } }
};

// Verify a transaction by its reference
const verifyTransaction = async (reference) => {
  const { data } = await paystackClient.get(`/transaction/verify/${encodeURIComponent(reference)}`);
  return data; // { status, message, data: { status: 'success'|'failed', amount, reference, ... } }
};

module.exports = { initializeTransaction, verifyTransaction };
