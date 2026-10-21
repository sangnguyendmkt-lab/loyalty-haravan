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

/** Vietnam calendar day "yyyy-MM-dd" of a Date. */
function vnDayKey(d) { return formatIsoVN(d).slice(0, 10); }

/**
 * Is the pasted customer export usable? It must be from today (VN) and newer than the last confirmed upload,
 * otherwise its points no longer include what was just uploaded. Returns 'ok' | 'missing' | 'old-day' | 'before-upload'.
 */
function customersFreshness(updatedIso, lastConfirmIso, now) {
  if (!updatedIso) return 'missing';
  var updated = new Date(updatedIso);
  if (vnDayKey(updated) !== vnDayKey(now)) return 'old-day';
  if (lastConfirmIso && updated <= new Date(lastConfirmIso)) return 'before-upload';
  return 'ok';
}

var REASONS = {
  TAKEN_BY_OTHER: 'Đơn đã được người khác tích',
  PHONE_INVALID: 'SĐT sai',
  NOT_FOUND: 'Không tìm thấy (khai sai, scam, hoặc đơn trước 08/2025)',
  NOT_DELIVERED: 'Chờ giao',
  WAITING_DAYS: 'Chờ đủ N ngày',
  UNKNOWN_TIER: 'Hạng không xác định',
  VOIDED: 'Đơn đã huỷ / hoàn / trả hàng',
  NOT_MARKETPLACE: 'Không phải đơn Shopee/TikTok',
};

var MARKETPLACE_SOURCE = /shopee|tiktok/i;

var DEFAULT_TIER = 'Silver';
var DAY_MS = 24 * 60 * 60 * 1000;

/** Index orders by marketplace code, partner tracking code and Haravan order name. */
function buildOrderIndex(orders) {
  var index = new Map();
  orders.forEach(function (o) {
    [o.marketplaceCode, o.partnerTrackingCode, o.name].forEach(function (k) {
      var key = normalizeCode(k);
      if (key && (!index.has(key) || (index.get(key).voided && !o.voided))) index.set(key, o);
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
  // Ledger keys: every typed code, plus "ID:<order id>" when known, so an order is found under any of its codes.
  var ledgerPhone = new Map();
  ledger.forEach(function (e) {
    ledgerPhone.set(normalizeCode(e.code), e.phone);
    if (e.orderId) ledgerPhone.set('ID:' + e.orderId, e.phone);
  });
  function ledgerOwner(order) {
    var keys = ['ID:' + order.id, normalizeCode(order.marketplaceCode), normalizeCode(order.partnerTrackingCode), normalizeCode(order.name)];
    for (var i = 0; i < keys.length; i++) if (keys[i] && keys[i] !== 'ID:' && ledgerPhone.has(keys[i])) return ledgerPhone.get(keys[i]);
    return undefined;
  }

  var sorted = submissions.slice().sort(function (a, b) {
    var ta = parseFormTimestamp(a.timestamp), tb = parseFormTimestamp(b.timestamp);
    var diff = (ta ? ta.getTime() : 0) - (tb ? tb.getTime() : 0);
    return diff || a.row - b.row;
  });

  var claimed = new Map();      // typed code -> phone
  var claimedOrder = new Map(); // order id -> phone (first claimant wins per order, whichever code was typed)
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
    var owner = ledgerOwner(order);
    if (owner === undefined && claimedOrder.has(order.id)) owner = claimedOrder.get(order.id);
    if (owner !== undefined) {
      if (owner !== phone) warn(s, REASONS.TAKEN_BY_OTHER);
      return;
    }
    claimedOrder.set(order.id, phone);
    if (!MARKETPLACE_SOURCE.test(order.source || '')) return warn(s, REASONS.NOT_MARKETPLACE);
    if (order.voided) return warn(s, REASONS.VOIDED);
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

var EXPORT_HEADERS = ['Họ và tên', 'Số điện thoại', 'Email', 'Phường/Xã', 'Quận/Huyện', 'Tỉnh/Thành phố',
  'Chi tiêu tích luỹ trong kỳ', 'Tổng chi tiêu', 'Điểm thưởng', 'Ngày đặt hàng cuối cùng'];

function firstNonEmpty_(values) {
  for (var i = 0; i < values.length; i++) {
    if (values[i] !== null && values[i] !== undefined && String(values[i]).trim() !== '') return String(values[i]).trim();
  }
  return '';
}

/**
 * Group credits by phone and merge with current Haravan customers (spec R5, R12–R16).
 * Haravan name/email/province win; form/order values only fill blanks. Sorted by phone.
 */
function buildExportRows(credits, customersByPhone) {
  var groups = new Map();
  credits.forEach(function (c) {
    if (!groups.has(c.phone)) groups.set(c.phone, []);
    groups.get(c.phone).push(c);
  });

  var rows = [];
  groups.forEach(function (list, phone) {
    list.sort(function (a, b) {
      return parseFormTimestamp(a.submission.timestamp) - parseFormTimestamp(b.submission.timestamp);
    });
    var cust = customersByPhone.get(phone);
    var newValue = 0, newPoints = 0, lastOrderAt = (cust && cust.lastOrderAt) || null;
    list.forEach(function (c) {
      newValue += c.order.valueAfterDiscount;
      newPoints += c.points;
      if (c.order.createdAt && (!lastOrderAt || c.order.createdAt > lastOrderAt)) lastOrderAt = c.order.createdAt;
    });
    var formNames = list.map(function (c) { return c.submission.name; });
    var formEmails = list.map(function (c) { return c.submission.email; });
    var orderProvinces = list.map(function (c) { return c.order.province; });
    rows.push({
      name: firstNonEmpty_([cust && cust.name].concat(formNames)),
      phone: phone,
      email: firstNonEmpty_([cust && cust.email].concat(formEmails)),
      province: firstNonEmpty_([cust && cust.province].concat(orderProvinces)),
      periodSpent: ((cust && cust.periodSpent) || 0) + newValue,
      totalSpent: ((cust && cust.totalSpent) || 0) + newValue,
      points: ((cust && cust.points) || 0) + newPoints,
      lastOrderAt: lastOrderAt,
    });
  });
  rows.sort(function (a, b) { return a.phone < b.phone ? -1 : a.phone > b.phone ? 1 : 0; });
  return rows;
}

/** ExportRow -> the 10 cells of one upload line. */
function formatExportRow(r) {
  return [r.name, r.phone, r.email, '', '', r.province, formatVnd(r.periodSpent), formatVnd(r.totalSpent),
    r.points, r.lastOrderAt ? formatIsoVN(r.lastOrderAt) : ''];
}

/** "0394..\n868..., +84 377 227 784" -> {phones: normalized unique, invalid: raw tokens}. Separators: newline , ; */
function parsePhoneList(text) {
  var phones = [], invalid = [];
  String(text || '').split(/[\n,;]+/).forEach(function (t) {
    var tok = t.trim();
    if (!tok) return;
    var p = normalizePhone(tok);
    if (!p) invalid.push(tok);
    else if (phones.indexOf(p) < 0) phones.push(p);
  });
  return { phones: phones, invalid: invalid };
}

/** Split pending ledger rows (phone in column C) into those to keep and those whose upload failed. */
function splitPendingByFailed(rows, failedPhones) {
  var failedSet = new Set(failedPhones);
  var inBatch = new Set(rows.map(function (r) { return String(r[2]); }));
  return {
    keep: rows.filter(function (r) { return !failedSet.has(String(r[2])); }),
    failed: rows.filter(function (r) { return failedSet.has(String(r[2])); }),
    notInBatch: failedPhones.filter(function (p) { return !inBatch.has(p); }),
  };
}

var REPORT_CHANNELS = ['Total', 'Shopee', 'Tiktok'];

/**
 * Monthly report like the old "Tổng Kết" sheet, from ledger entries of the given year.
 * Month = Vietnam-time month of the form claim (claimedAt); AOV = value / distinct phones.
 */
function buildReport(ledger, year) {
  var acc = {};
  REPORT_CHANNELS.forEach(function (ch) {
    acc[ch] = { phones: [], value: [], points: [] };
    for (var m = 0; m < 12; m++) { acc[ch].phones.push(new Set()); acc[ch].value.push(0); acc[ch].points.push(0); }
  });
  ledger.forEach(function (e) {
    if (!e.claimedAt) return;
    var local = new Date(e.claimedAt.getTime() + VN_OFFSET_MS);
    if (local.getUTCFullYear() !== year) return;
    var m = local.getUTCMonth();
    var ch = String(e.channel || '').trim().toLowerCase();
    ['Total'].concat(REPORT_CHANNELS.filter(function (c) { return c.toLowerCase() === ch; })).forEach(function (c) {
      acc[c].phones[m].add(e.phone);
      acc[c].value[m] += Number(e.value) || 0;
      acc[c].points[m] += Number(e.points) || 0;
    });
  });
  var out = {};
  REPORT_CHANNELS.forEach(function (ch) {
    var a = acc[ch];
    var phones = a.phones.map(function (s) { return s.size; });
    out[ch] = {
      phones: phones,
      value: a.value,
      points: a.points,
      pointValue: a.points.map(function (p) { return p * 1000; }),
      aov: a.value.map(function (v, i) { return phones[i] ? Math.round(v / phones[i]) : 0; }),
    };
  });
  return out;
}

if (typeof module !== 'undefined') module.exports = {
  vnDayKey: vnDayKey,
  customersFreshness: customersFreshness,
  parsePhoneList: parsePhoneList,
  splitPendingByFailed: splitPendingByFailed,
  REPORT_CHANNELS: REPORT_CHANNELS,
  buildReport: buildReport,
  EXPORT_HEADERS: EXPORT_HEADERS,
  buildExportRows: buildExportRows,
  formatExportRow: formatExportRow,
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
