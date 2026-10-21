/**
 * Loyalty Haravan — pure business rules (no Google APIs, runs in Node and Apps Script).
 *
 * Shared data shapes:
 *   Submission  {row, timestamp, channel, name, phoneRaw, email, codeRaw, cellCode?}
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

/** Known code shapes (uppercase, no separators): marketplace order codes and carrier tracking codes. */
var CODE_SHAPES = [
  'SHOPEEVTPVN\\d{12}F?', 'SPE-[0-9A-F]{8}-\\d{12}', 'SPXVN\\d{11}[0-9A-C]', 'LVN\\d{12}', 'ET\\d{12}',
  '(?:J&T(?:VN)?|JT)\\d{12}', 'VNGH\\d{11,12}', 'TTVN\\d{10}', '[A-Z]{2}\\d{9}VN',
  '5[78]\\d{16}',                                              // TikTok order id
  '(?:00)?86\\d{10}',                                          // bare J&T
  '2\\d(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])[A-Z0-9]{8}',  // Shopee: YYMMDD + 8
];
var KNOWN_CODE = new RegExp('^(?:' + CODE_SHAPES.join('|') + ')$');

/** Split s into ≥1 known codes laid end to end, or null when it is not exactly such a sequence. */
function segmentKnownCodes_(s) {
  var memo = {};
  function from(i) {
    if (i === s.length) return [];
    if (memo[i] !== undefined) return memo[i];
    memo[i] = null;
    for (var len = 12; len <= 25 && i + len <= s.length; len++) {
      var piece = s.slice(i, i + len);
      if (!KNOWN_CODE.test(piece)) continue;
      var rest = from(i + len);
      if (rest) { memo[i] = [piece].concat(rest); break; }
    }
    return memo[i];
  }
  return s ? from(0) : null;
}

/**
 * One form cell -> the order codes in it. Customers put several codes in one cell (newlines, commas,
 * "/", "và"…) or add labels ("Shopee:", "Mã đơn", "#"). The whole cell is used when it is exactly a run
 * of known codes; otherwise each code-like token (≥8 chars, ≥5 digits) is kept, split further only when
 * it is exactly a run of known codes. Nothing is guessed: a cell with no such token stays one code.
 */
function splitCodes(raw) {
  var whole = normalizeCode(raw);
  if (!whole) return [];
  var clean = function (t) { return t.toUpperCase().replace(/[^A-Z0-9&-]/g, '').replace(/^-+|-+$/g, ''); };
  var all = segmentKnownCodes_(clean(String(raw)));
  var out = [];
  if (all) out = all;
  else {
    String(raw).split(/[\s,;\/|+]+/).forEach(function (t) {
      t = clean(t);
      if (t.length < 8 || (t.match(/\d/g) || []).length < 5) return;
      out = out.concat(segmentKnownCodes_(t) || [t]);
    });
  }
  out = out.filter(function (c, i) { return out.indexOf(c) === i; });
  return out.length ? out : [whole];
}

/** One submission per code in its cell; cellCode keeps the whole cell for ledger entries migrated per cell. */
function expandSubmissions(submissions) {
  var out = [];
  submissions.forEach(function (s) {
    var cellCode = normalizeCode(s.codeRaw);
    var codes = splitCodes(s.codeRaw);
    if (!codes.length) { out.push(s); return; }
    codes.forEach(function (code) {
      out.push(Object.assign({}, s, { codeRaw: code, cellCode: cellCode }));
    });
  });
  return out;
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
  NOT_FOUND: 'Không tìm thấy (khai sai, scam, hoặc đơn quá 365 ngày)',
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
    // A cell credited whole by the old process covers every code split out of it.
    if (s.cellCode && s.cellCode !== code && ledgerPhone.has(s.cellCode)) {
      if (ledgerPhone.get(s.cellCode) !== phone) warn(s, REASONS.TAKEN_BY_OTHER);
      return;
    }
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
var EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** Trimmed email if it is well-formed, else ''. */
function cleanEmail(value) {
  var e = String(value === null || value === undefined ? '' : value).trim();
  return EMAIL_RE.test(e) ? e : '';
}

/**
 * Haravan rejects an upload line whose email belongs to another customer, so the phone is the key and
 * an email is used only when it is well-formed and owned by nobody else. Haravan's own email wins; a
 * blank one is filled from the form; within one file the earliest form claimant keeps a shared email.
 * customersByPhone.emailOwners (email lowercased -> phone, '' for customers without a phone) adds the
 * owners that the phone map cannot hold.
 */
function buildExportRows(credits, customersByPhone) {
  var groups = new Map();
  credits.forEach(function (c) {
    if (!groups.has(c.phone)) groups.set(c.phone, []);
    groups.get(c.phone).push(c);
  });
  groups.forEach(function (list) {
    list.sort(function (a, b) {
      return parseFormTimestamp(a.submission.timestamp) - parseFormTimestamp(b.submission.timestamp);
    });
  });
  var phones = Array.from(groups.keys()).sort(function (a, b) {
    return parseFormTimestamp(groups.get(a)[0].submission.timestamp) - parseFormTimestamp(groups.get(b)[0].submission.timestamp);
  });

  var owner = new Map(customersByPhone.emailOwners || []);
  customersByPhone.forEach(function (cust, phone) {
    var e = cleanEmail(cust.email);
    if (e) owner.set(e.toLowerCase(), phone);
  });
  function claimEmail(candidates, phone) {
    for (var i = 0; i < candidates.length; i++) {
      var e = cleanEmail(candidates[i]);
      if (!e) continue;
      var key = e.toLowerCase();
      if (owner.has(key) && owner.get(key) !== phone) continue;
      owner.set(key, phone);
      return e;
    }
    return '';
  }

  var rows = [];
  phones.forEach(function (phone) {
    var list = groups.get(phone);
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
    var ownEmail = cust && cleanEmail(cust.email);
    rows.push({
      name: firstNonEmpty_([cust && cust.name].concat(formNames)),
      phone: phone,
      email: ownEmail || claimEmail(formEmails, phone),
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

var REPORT_CHANNELS = ['Shopee', 'Tiktok'];
var UNKNOWN_MONTH = 'Không rõ';

/** "yyyy-MM" of a date in Vietnam time, or UNKNOWN_MONTH. */
function vnMonthKey(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return UNKNOWN_MONTH;
  return vnDayKey(d).slice(0, 7);
}

/**
 * Credited orders per month and channel, twice: by the month the order was placed (Haravan "Ngày tạo")
 * and by the month the customer filled the form. orderDateByCode fills ledger entries that have no order
 * date (orders migrated from the old file). Orders without a usable date, or in a month before fromMonth
 * ("yyyy-MM"), are left out of that table and its total. Each table: {months: [...sorted, UNKNOWN_MONTH last if any],
 * cells: {month: {channel: {orders, customers, points}}}, total: {channel: {...}}}.
 */
function buildReport(ledger, orderDateByCode, fromMonth) {
  orderDateByCode = orderDateByCode || new Map();
  function table(dateOf) {
    var acc = {}, total = {};
    function cell(store, key, ch) {
      store[key] = store[key] || {};
      store[key][ch] = store[key][ch] || { orders: 0, phones: new Set(), points: 0 };
      return store[key][ch];
    }
    ledger.forEach(function (e) {
      var ch = REPORT_CHANNELS.filter(function (c) { return c.toLowerCase() === String(e.channel || '').trim().toLowerCase(); })[0];
      if (!ch) return;
      var month = vnMonthKey(dateOf(e));
      if (month === UNKNOWN_MONTH || (fromMonth && month < fromMonth)) return;
      [cell(acc, month, ch), cell(total, 'all', ch)].forEach(function (c) {
        c.orders += 1;
        c.phones.add(e.phone);
        c.points += Number(e.points) || 0;
      });
    });
    function plain(byCh) {
      var out = {};
      REPORT_CHANNELS.forEach(function (ch) {
        var c = (byCh || {})[ch];
        out[ch] = { orders: c ? c.orders : 0, customers: c ? c.phones.size : 0, points: c ? c.points : 0 };
      });
      return out;
    }
    var months = Object.keys(acc).filter(function (m) { return m !== UNKNOWN_MONTH; }).sort();
    if (acc[UNKNOWN_MONTH]) months.push(UNKNOWN_MONTH);
    var cells = {};
    months.forEach(function (m) { cells[m] = plain(acc[m]); });
    return { months: months, cells: cells, total: plain(total.all) };
  }
  return {
    byOrder: table(function (e) { return e.orderCreatedAt || orderDateByCode.get(normalizeCode(e.code)) || null; }),
    byClaim: table(function (e) { return e.claimedAt; }),
  };
}

if (typeof module !== 'undefined') module.exports = {
  vnDayKey: vnDayKey,
  MARKETPLACE_SOURCE: MARKETPLACE_SOURCE,
  DAY_MS: DAY_MS,
  customersFreshness: customersFreshness,
  parsePhoneList: parsePhoneList,
  splitPendingByFailed: splitPendingByFailed,
  REPORT_CHANNELS: REPORT_CHANNELS,
  UNKNOWN_MONTH: UNKNOWN_MONTH,
  vnMonthKey: vnMonthKey,
  buildReport: buildReport,
  EXPORT_HEADERS: EXPORT_HEADERS,
  buildExportRows: buildExportRows,
  cleanEmail: cleanEmail,
  formatExportRow: formatExportRow,
  REASONS: REASONS,
  buildOrderIndex: buildOrderIndex,
  computePoints: computePoints,
  evaluateSubmissions: evaluateSubmissions,
  normalizePhone: normalizePhone,
  normalizeCode: normalizeCode,
  splitCodes: splitCodes,
  expandSubmissions: expandSubmissions,
  parseFormTimestamp: parseFormTimestamp,
  formatVnd: formatVnd,
  formatIsoVN: formatIsoVN,
};
