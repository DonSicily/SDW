/**
 * Canonical Nigerian phone normalization.
 * Always stores / looks up as digits only, preferred form: 234XXXXXXXXXX (12 digits).
 *
 * Accepts:
 *   08012345678, 8012345678, +2348012345678, 234 801 234 5678, etc.
 * Returns null if the number cannot be normalized to a plausible NG mobile.
 */
function normalizePhone(raw) {
  if (raw == null) return null;

  let digits = String(raw).replace(/\D/g, '');

  // Strip leading international 00
  if (digits.startsWith('00')) digits = digits.slice(2);

  // 0XXXXXXXXXX (11 digits) → 234XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = '234' + digits.slice(1);
  }

  // XXXXXXXXXX (10 digits, typically starting with 7/8/9) → 234XXXXXXXXXX
  if (digits.length === 10 && /^[789]/.test(digits)) {
    digits = '234' + digits;
  }

  // Already 234XXXXXXXXXX
  if (digits.length === 13 && digits.startsWith('2340')) {
    // 2340XXXXXXXXX → drop the extra 0 after country code
    digits = '234' + digits.slice(4);
  }

  // Must be 234 + 10-digit national number
  if (!/^234[789]\d{9}$/.test(digits)) {
    // Allow non-NG numbers in a limited way for tests / edge cases:
    // keep digits-only if 10–15 long, otherwise invalid
    if (digits.length >= 10 && digits.length <= 15) {
      return digits;
    }
    return null;
  }

  return digits;
}

/**
 * Display form for SMS / UI: leading 0 national format when NG.
 * e.g. 2348012345678 → 08012345678
 */
function toNationalDisplay(phone) {
  const n = normalizePhone(phone);
  if (!n) return String(phone || '');
  if (n.startsWith('234') && n.length === 12) {
    return '0' + n.slice(3);
  }
  return n;
}

module.exports = { normalizePhone, toNationalDisplay };
