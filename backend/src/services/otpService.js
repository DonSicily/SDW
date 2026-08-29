const crypto = require('crypto');
const axios = require('axios');
const { getRedis, isRedisAvailable } = require('./redisService');
const { normalizePhone } = require('../utils/phone');

// In-memory OTP store as fallback when Redis is down
const memoryOtps = new Map(); // phone → { codeHash, expiresAt, attempts }

const OTP_TTL_SEC = 10 * 60; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_LENGTH = 6;

function generateCode() {
  // Cryptographically strong 6-digit code
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(OTP_LENGTH, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function otpKey(phone) {
  return `otp:${phone}`;
}

function otpRateKey(phone) {
  return `otp:rate:${phone}`;
}

// Per-phone send limits (P2)
const OTP_SEND_WINDOW_SEC = parseInt(process.env.OTP_SEND_WINDOW_SEC || '900', 10); // 15 min
const OTP_SEND_MAX = parseInt(process.env.OTP_SEND_MAX || '5', 10); // max sends per phone per window
const memorySendCounts = new Map(); // phone → { count, resetAt }

/**
 * Returns { allowed: true } or { allowed: false, retryAfterSec }.
 */
async function checkAndIncrementSendLimit(phone) {
  const now = Date.now();

  if (isRedisAvailable()) {
    const key = otpRateKey(phone);
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, OTP_SEND_WINDOW_SEC);
    }
    if (count > OTP_SEND_MAX) {
      const ttl = await redis.ttl(key);
      return { allowed: false, retryAfterSec: Math.max(ttl, 1) };
    }
    return { allowed: true, remaining: Math.max(OTP_SEND_MAX - count, 0) };
  }

  // In-memory fallback
  let entry = memorySendCounts.get(phone);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + OTP_SEND_WINDOW_SEC * 1000 };
    memorySendCounts.set(phone, entry);
  }
  entry.count += 1;
  if (entry.count > OTP_SEND_MAX) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }
  return { allowed: true, remaining: Math.max(OTP_SEND_MAX - entry.count, 0) };
}

async function storeOtp(phone, code) {
  const payload = {
    codeHash: hashCode(code),
    expiresAt: Date.now() + OTP_TTL_SEC * 1000,
    attempts: 0
  };

  if (isRedisAvailable()) {
    await getRedis().set(otpKey(phone), JSON.stringify(payload), 'EX', OTP_TTL_SEC);
  } else {
    memoryOtps.set(phone, payload);
    // Best-effort cleanup
    setTimeout(() => memoryOtps.delete(phone), OTP_TTL_SEC * 1000);
  }
}

async function readOtp(phone) {
  if (isRedisAvailable()) {
    const raw = await getRedis().get(otpKey(phone));
    return raw ? JSON.parse(raw) : null;
  }
  return memoryOtps.get(phone) || null;
}

async function clearOtp(phone) {
  if (isRedisAvailable()) {
    await getRedis().del(otpKey(phone));
  }
  memoryOtps.delete(phone);
}

async function incrementAttempts(phone, record) {
  record.attempts = (record.attempts || 0) + 1;
  if (isRedisAvailable()) {
    const ttl = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
    await getRedis().set(otpKey(phone), JSON.stringify(record), 'EX', ttl);
  } else {
    memoryOtps.set(phone, record);
  }
}

/**
 * Send OTP SMS via Termii.
 * Docs: https://developers.termii.com/messaging
 * Env: TERMII_API_KEY, TERMII_SENDER_ID (e.g. "TaxiApp")
 *
 * In development / when TERMII_API_KEY is missing, the OTP is logged
 * to the console so local testing still works.
 */
async function sendOtpSms(phone, code) {
  const apiKey = process.env.TERMII_API_KEY;
  const senderId = process.env.TERMII_SENDER_ID || 'TaxiApp';

  // Normalize to international format expected by Termii (e.g. 23480…)
  let to = String(phone).replace(/\D/g, '');
  if (to.startsWith('0')) to = '234' + to.slice(1);
  if (!to.startsWith('234') && to.length === 10) to = '234' + to;

  if (!apiKey || process.env.NODE_ENV === 'test') {
    console.log(`[OTP:dev] phone=${phone} code=${code}`);
    return { success: true, channel: 'console' };
  }

  try {
    const { data } = await axios.post(
      'https://api.ng.termii.com/api/sms/send',
      {
        to,
        from: senderId,
        sms: `Your Taxi App verification code is ${code}. Valid for 10 minutes. Do not share this code.`,
        type: 'plain',
        channel: 'generic',
        api_key: apiKey
      },
      { timeout: 15000 }
    );

    if (data?.message_id || data?.code === 'ok' || data?.message === 'Successfully Sent') {
      return { success: true, channel: 'termii', messageId: data.message_id };
    }

    // Termii sometimes returns error in body with 200
    console.error('Termii unexpected response:', data);
    return { success: false, error: data?.message || 'Termii send failed' };
  } catch (err) {
    console.error('Termii error:', err.response?.data || err.message);
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

/**
 * Generate, store, and send an OTP for the given phone.
 */
async function sendOtp(phone) {
  const canonical = normalizePhone(phone) || String(phone || '').replace(/\D/g, '');

  // P2: per-phone rate limit (independent of IP limiter on the route)
  const limit = await checkAndIncrementSendLimit(canonical);
  if (!limit.allowed) {
    return {
      success: false,
      error: `Too many OTP requests for this number. Try again in ${limit.retryAfterSec}s.`,
      retryAfterSec: limit.retryAfterSec,
      rateLimited: true
    };
  }

  const code = generateCode();
  await storeOtp(canonical, code);
  const result = await sendOtpSms(canonical, code);
  if (!result.success) {
    // Still keep the OTP so a retry of SMS doesn't need a new code immediately;
    // caller can decide whether to surface the error.
    return { success: false, error: result.error };
  }
  return {
    success: true,
    expiresIn: OTP_TTL_SEC,
    // Only returned in non-production so mobile can auto-fill during QA
    ...(process.env.NODE_ENV !== 'production' ? { debugCode: code } : {})
  };
}

/**
 * Verify a submitted OTP. Returns { valid: true } or { valid: false, reason }.
 * On success the OTP is consumed (one-time use).
 */
async function verifyOtp(phone, code) {
  const canonical = normalizePhone(phone) || String(phone || '').replace(/\D/g, '');
  const record = await readOtp(canonical);
  if (!record) {
    return { valid: false, reason: 'OTP expired or not found. Request a new one.' };
  }
  if (Date.now() > record.expiresAt) {
    await clearOtp(canonical);
    return { valid: false, reason: 'OTP has expired. Request a new one.' };
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await clearOtp(canonical);
    return { valid: false, reason: 'Too many invalid attempts. Request a new OTP.' };
  }

  if (hashCode(code) !== record.codeHash) {
    await incrementAttempts(canonical, record);
    return { valid: false, reason: 'Invalid OTP code' };
  }

  await clearOtp(canonical);
  return { valid: true };
}

module.exports = {
  sendOtp,
  verifyOtp,
  OTP_TTL_SEC,
  OTP_SEND_MAX,
  OTP_SEND_WINDOW_SEC,
  // exported for tests
  _hashCode: hashCode,
  _generateCode: generateCode
};
