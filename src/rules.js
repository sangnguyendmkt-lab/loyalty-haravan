/**
 * Loyalty Haravan — pure business rules (no Google APIs, runs in Node and Apps Script).
 *
 * Shared data shapes:
 *   Submission  {row, timestamp, channel, name, phoneRaw, email, codeRaw}
 *   Order       {id, name, marketplaceCode, partnerTrackingCode, createdAt, deliveredAt,
 *                delivered, voided, valueAfterDiscount, province}
 *   Customer    {phone, name, email, province, tier, points, totalSpent, periodSpent, lastOrderAt}
 *   LedgerEntry {code, orderId, phone, channel, orderCreatedAt, value, tier, multiplier,
 *                points, batchId, source}
 *   Settings    {formSpreadsheetId, formSheetName, dataStart, vndPerPoint, multipliers,
 *                waitDays, customerSource}
 *   Credit      {submission, order, phone, tier, multiplier, points}
 *   ReviewItem  {submission, kind: 'warn'|'wait', reason}
 */

var VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Normalize a Vietnamese phone to 10 digits starting with 0, or null if invalid. */
function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  var s = String(raw).trim();
  if (/[a-zA-Z]/.test(s)) return null;
  var digits = s.replace(/\D/g, '');
  if (/^84\d{9}$/.test(digits)) digits = '0' + digits.slice(2);
  else if (/^\d{9}$/.test(digits)) digits = '0' + digits;
  return /^0\d{9}$/.test(digits) ? digits : null;
}

/** Normalize an order code: trim, remove inner spaces, uppercase. */
function normalizeCode(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/\s+/g, '').toUpperCase();
}

/** Parse a Google Form timestamp ("dd/MM/yyyy HH:mm:ss", Vietnam time) or a Date. */
function parseFormTimestamp(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(v || '').trim());
  if (!m) return null;
  var utc = Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return new Date(utc - VN_OFFSET_MS);
}

/** 4340000 -> "4,340,000" */
function formatVnd(n) {
  var s = String(Math.round(Number(n) || 0));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** Date -> "yyyy-MM-ddTHH:mm:ss+07:00" in Vietnam time. */
function formatIsoVN(d) {
  var t = new Date(d.getTime() + VN_OFFSET_MS);
  return t.getUTCFullYear() + '-' + pad2_(t.getUTCMonth() + 1) + '-' + pad2_(t.getUTCDate()) +
    'T' + pad2_(t.getUTCHours()) + ':' + pad2_(t.getUTCMinutes()) + ':' + pad2_(t.getUTCSeconds()) +
    '+07:00';
}

if (typeof module !== 'undefined') module.exports = {
  normalizePhone: normalizePhone,
  normalizeCode: normalizeCode,
  parseFormTimestamp: parseFormTimestamp,
  formatVnd: formatVnd,
  formatIsoVN: formatIsoVN,
};
