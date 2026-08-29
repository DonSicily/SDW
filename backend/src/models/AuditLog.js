const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  actorRole: String,
  action: {
    type: String,
    required: true,
    index: true
  },
  resource: {
    type: String, // e.g. 'ride', 'user', 'payment', 'vehicle'
    index: true
  },
  resourceId: {
    type: String,
    index: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  },
  ip: String,
  userAgent: String,
  success: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Keep logs for 90 days via TTL (optional – comment out if you need longer retention)
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

/**
 * Fire-and-forget audit writer. Never throws to the caller.
 */
AuditLogSchema.statics.record = async function (entry) {
  try {
    await this.create(entry);
  } catch (err) {
    console.error('AuditLog write failed:', err.message);
  }
};

module.exports = mongoose.model('AuditLog', AuditLogSchema);
