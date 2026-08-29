const mongoose = require('mongoose');
const crypto = require('crypto');

const RefreshTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Store only a hash of the token so a DB leak doesn't give usable tokens
  tokenHash: {
    type: String,
    required: true,
    unique: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  revokedAt: {
    type: Date,
    default: null
  },
  replacedBy: {
    type: String, // hash of the successor token (rotation chain)
    default: null
  },
  userAgent: String,
  ip: String
}, { timestamps: true });

// TTL index — Mongo will auto-delete expired docs
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

RefreshTokenSchema.statics.hash = function (rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
};

RefreshTokenSchema.statics.createToken = async function (userId, { userAgent, ip } = {}) {
  const raw = crypto.randomBytes(48).toString('hex');
  const days = parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await this.create({
    userId,
    tokenHash: this.hash(raw),
    expiresAt,
    userAgent,
    ip
  });

  return { raw, expiresAt };
};

/**
 * Rotate: validate the presented token, revoke it, issue a new one.
 * Detects reuse of an already-rotated token (possible theft) and revokes
 * the entire family for that user.
 */
RefreshTokenSchema.statics.rotate = async function (rawToken, meta = {}) {
  const tokenHash = this.hash(rawToken);
  const existing = await this.findOne({ tokenHash });

  if (!existing) {
    return { error: 'Invalid refresh token' };
  }

  if (existing.revokedAt) {
    // Token reuse after rotation → possible theft: revoke all for this user
    await this.updateMany(
      { userId: existing.userId, revokedAt: null },
      { revokedAt: new Date() }
    );
    return { error: 'Refresh token reuse detected — all sessions revoked' };
  }

  if (existing.expiresAt < new Date()) {
    return { error: 'Refresh token expired' };
  }

  // Revoke current and issue replacement
  const { raw, expiresAt } = await this.createToken(existing.userId, meta);
  existing.revokedAt = new Date();
  existing.replacedBy = this.hash(raw);
  await existing.save();

  return { userId: existing.userId, raw, expiresAt };
};

RefreshTokenSchema.statics.revoke = async function (rawToken) {
  const tokenHash = this.hash(rawToken);
  await this.updateOne({ tokenHash }, { revokedAt: new Date() });
};

RefreshTokenSchema.statics.revokeAllForUser = async function (userId) {
  await this.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
};

module.exports = mongoose.model('RefreshToken', RefreshTokenSchema);
