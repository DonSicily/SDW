const AuditLog = require('../models/AuditLog');

/**
 * In-memory buffer for failed audit writes (best-effort durability).
 * Flushed periodically and on process signals when possible.
 */
const pending = [];
const MAX_PENDING = 200;
let flushTimer = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPending().catch(() => {});
  }, 5000);
  if (flushTimer.unref) flushTimer.unref();
}

async function flushPending() {
  while (pending.length > 0) {
    const entry = pending.shift();
    try {
      await AuditLog.record(entry);
    } catch {
      // Drop after one retry cycle to avoid unbounded growth
      break;
    }
  }
}

/**
 * Record an audit event.
 *
 * @param {object} opts
 * @param {object} [opts.req] - Express req (pulls actor, IP, UA)
 * @param {string} opts.action
 * @param {string} [opts.resource]
 * @param {string} [opts.resourceId]
 * @param {object} [opts.metadata]
 * @param {boolean} [opts.success=true]
 * @param {boolean} [opts.awaitWrite=false] - if true, await the DB write (critical security events)
 * @returns {Promise<void>|void}
 */
function audit({ req, action, resource, resourceId, metadata, success = true, awaitWrite = false }) {
  const entry = {
    action,
    resource,
    resourceId: resourceId ? String(resourceId) : undefined,
    metadata,
    success
  };

  if (req) {
    entry.actorId = req.user?.id || req.user?._id;
    entry.actorRole = req.user?.role;
    entry.ip = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;
    entry.userAgent = req.headers['user-agent'];
  }

  const write = async () => {
    try {
      await AuditLog.record(entry);
    } catch (err) {
      console.error('AuditLog write failed:', err.message);
      if (pending.length < MAX_PENDING) {
        pending.push(entry);
        scheduleFlush();
      }
    }
  };

  if (awaitWrite) {
    return write();
  }
  // Fire-and-forget for hot paths
  write();
}

// Best-effort flush on shutdown
function installShutdownFlush() {
  const handler = () => {
    if (pending.length === 0) return;
    // Synchronous best-effort: kick off flush (process may exit before done)
    flushPending().catch(() => {});
  };
  process.once('beforeExit', handler);
  process.once('SIGTERM', handler);
  process.once('SIGINT', handler);
}

if (process.env.NODE_ENV !== 'test') {
  installShutdownFlush();
}

module.exports = { audit, flushPending };
