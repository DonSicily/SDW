/**
 * Production-safe logging helpers.
 * Always log full detail server-side; never put stack traces in API responses.
 */

function logError(context, err, extra = {}) {
  const message = err?.message || String(err);
  const stack = err?.stack;
  const payload = {
    context,
    message,
    ...extra,
    ...(process.env.NODE_ENV !== 'production' && stack ? { stack } : {})
  };
  // Single structured line for log aggregators
  console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), ...payload }));
}

function clientErrorMessage(fallback = 'Internal server error') {
  return process.env.NODE_ENV === 'production' ? fallback : undefined;
}

module.exports = { logError, clientErrorMessage };
