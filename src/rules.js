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

var REASONS = {
  TAKEN_BY_OTHER: 'Đơn đã được người khác tích',
  PHONE_INVALID: 'SĐT sai',
  NOT_FOUND: 'Không tìm thấy (khai sai, scam, hoặc đơn trước 08/2025)',
  NOT_DELIVERED: 'Chờ giao',
  WAITING_DAYS: 'Chờ đủ N ngày',
  UNKNOWN_TIER: 'Hạng không xác định',
};

var DEFAULT_TIER = 'Silver';
var DAY_MS = 24 * 60 * 60 * 1000;

/** Index orders by marketplace code, partner tracking code and Haravan order name. Voided orders are skipped. */
function buildOrderIndex(orders) {
  var index = new Map();
  orders.forEach(function (o) {
    if (o.voided) return;
    [o.marketplaceCode, o.partnerTrackingCode, o.name].forEach(function (k) {
      var key = normalizeCode(k);
      if (key && !index.has(key)) index.set(key, o);
    });
  });
  return index;
}

/** Points for one order at the given tier; empty tier counts as Silver; null for an unknown tier. */
function computePoints(value, tier, settings) {
  var t = tier || DEFAULT_TIER;
  if (!Object.prototype.hasOwnProperty.call(settings.multipliers, t)) return null;
  var multiplier = settings.multipliers[t];
  return { multiplier: multiplier, points: Math.round(value / settings.vndPerPoint * multiplier) };
}

/**
 * Apply the 8 checks of spec §5 to every form claim, oldest first.
 * Returns {credits: Credit[], review: ReviewItem[]}; silently skipped claims appear in neither.
 */
function evaluateSubmissions(submissions, ledger, orderIndex, customersByPhone, settings, now) {
  var ledgerPhone = new Map();
  ledger.forEach(function (e) { ledgerPhone.set(normalizeCode(e.code), e.phone); });

  var sorted = submissions.slice().sort(function (a, b) {
    var ta = parseFormTimestamp(a.timestamp), tb = parseFormTimestamp(b.timestamp);
    var diff = (ta ? ta.getTime() : 0) - (tb ? tb.getTime() : 0);
    return diff || a.row - b.row;
  });

  var claimed = new Map();
  var credits = [];
  var review = [];
  function warn(s, reason) { review.push({ submission: s, kind: 'warn', reason: reason }); }
  function wait(s, reason) { review.push({ submission: s, kind: 'wait', reason: reason }); }

  sorted.forEach(function (s) {
    var code = normalizeCode(s.codeRaw);
    var phone = normalizePhone(s.phoneRaw);
    if (ledgerPhone.has(code)) {
      if (ledgerPhone.get(code) !== phone) warn(s, REASONS.TAKEN_BY_OTHER);
      return;
    }
    if (claimed.has(code)) {
      if (claimed.get(code) !== phone) warn(s, REASONS.TAKEN_BY_OTHER);
      return;
    }
    if (!phone) return warn(s, REASONS.PHONE_INVALID);
    claimed.set(code, phone);

    var order = orderIndex.get(code);
    if (!order) return warn(s, REASONS.NOT_FOUND);
    if (!order.delivered || !order.deliveredAt) return wait(s, REASONS.NOT_DELIVERED);
    if (now.getTime() - order.deliveredAt.getTime() < settings.waitDays * DAY_MS) {
      return wait(s, REASONS.WAITING_DAYS.replace('N', String(settings.waitDays)));
    }

    var customer = customersByPhone.get(phone);
    var tier = (customer && customer.tier) || DEFAULT_TIER;
    var p = computePoints(order.valueAfterDiscount, tier, settings);
    if (!p) return warn(s, REASONS.UNKNOWN_TIER);
    credits.push({ submission: s, order: order, phone: phone, tier: tier, multiplier: p.multiplier, points: p.points });
  });

  return { credits: credits, review: review };
}

if (typeof module !== 'undefined') module.exports = {
  REASONS: REASONS,
  buildOrderIndex: buildOrderIndex,
  computePoints: computePoints,
  evaluateSubmissions: evaluateSubmissions,
  normalizePhone: normalizePhone,
  normalizeCode: normalizeCode,
  parseFormTimestamp: parseFormTimestamp,
  formatVnd: formatVnd,
  formatIsoVN: formatIsoVN,
};
