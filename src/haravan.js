/**
 * Loyalty Haravan — Haravan API client (GET only) and probe.
 * Token lives only in Script Properties under HARAVAN_TOKEN; it is never written to a cell or a log.
 */
if (typeof module !== 'undefined') Object.assign(globalThis, require('./rules.js'));

var HARAVAN_BASE = 'https://apis.haravan.com/com/';
var TOKEN_KEY = 'HARAVAN_TOKEN';
var PII_KEY = /(^|_)(name|first_name|last_name|email|phone|address\d?|company|zip)$/i;
var PII_SAFE = /^(name|source_name|gateway|carrier|tracking_company|title|variant_title|vendor|province|city|district|ward|country)$/i;

function buildQuery(params) {
  var parts = Object.keys(params || {})
    .filter(function (k) { return params[k] !== '' && params[k] !== null && params[k] !== undefined; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])); });
  return parts.length ? '?' + parts.join('&') : '';
}

/** Flatten an API object into [path, value] rows, hiding personal data. Top-level "name" (order number) is kept. */
function flattenForProbe(obj) {
  var out = [];
  (function walk(v, path, depth) {
    if (v !== null && typeof v === 'object') {
      Object.keys(v).forEach(function (k) { walk(v[k], path ? path + '.' + k : k, depth + 1); });
      return;
    }
    var key = path.split('.').pop();
    var hide = PII_KEY.test(key) && !(depth === 1 && key === 'name') && !(PII_SAFE.test(key) && key !== 'name');
    out.push([path, hide ? '[ẩn]' : String(v)]);
  })(obj, '', 0);
  return out;
}

function num_(v) {
  if (typeof v === 'number') return v;
  var n = Number(String(v === null || v === undefined ? '' : v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function date_(v) {
  if (!v) return null;
  var d = v instanceof Date ? v : (parseFormTimestamp(v) || new Date(v)); // dd/MM first: new Date() reads MM/dd
  return isNaN(d.getTime()) ? null : d;
}

/** Strict number for the customer export: "4.340.000", "1,314,999", 13 → number; anything else non-empty throws. */
function strictNum_(v, label, phone) {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  var t = String(v).trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  var n = Number(t.replace(/,/g, ''));
  if (t === '' || isNaN(n)) throw new Error('Cột "' + label + '" của SĐT ' + phone + ' không phải số: "' + v + '"');
  return n;
}

function strictDate_(v, label, phone) {
  if (v === '' || v === null || v === undefined) return null;
  var d = date_(v);
  if (!d) throw new Error('Cột "' + label + '" của SĐT ' + phone + ' không phải ngày: "' + v + '"');
  return d;
}

/** Header text normalized for matching: NFC, trimmed, lowercase, "lũy" == "luỹ". */
function headerKey_(h) {
  return String(h).normalize('NFC').trim().toLowerCase().replace(/lũy/g, 'luỹ');
}

/** Haravan order JSON -> Order. Value is total_price (after discounts); delivery comes from the carrier status. */
function toOrder(raw) {
  var fs = raw.fulfillments || [];
  var delivered = null;
  fs.forEach(function (f) { if (!delivered && f.carrier_status_code === 'delivered') delivered = f; });
  var tracking = '';
  fs.forEach(function (f) { if (!tracking && f.tracking_number) tracking = String(f.tracking_number); });
  var returned = fs.some(function (f) { return !!f.return_date || /return/i.test(f.carrier_status_code || ''); });
  return {
    id: String(raw.id),
    name: String(raw.name || ''),
    marketplaceCode: String(raw.order_number || raw.name || ''),
    partnerTrackingCode: tracking,
    createdAt: date_(raw.created_at),
    deliveredAt: delivered ? date_(delivered.delivered_date) : null,
    delivered: !!delivered,
    voided: raw.cancelled_status === 'cancelled' || !!raw.cancelled_at ||
      /refunded|voided/.test(raw.financial_status || '') || returned,
    valueAfterDiscount: num_(raw.total_price),
    source: String(raw.source_name || raw.source || '').toLowerCase(),
    province: String((raw.shipping_address && raw.shipping_address.province) || ''),
  };
}

var CUSTOMER_COLS = {
  name: 'Họ và tên', phone: 'Số điện thoại', email: 'Email', province: 'Tỉnh/Thành phố',
  totalSpent: 'Tổng chi tiêu', periodSpent: 'Chi tiêu tích luỹ trong kỳ', tier: 'Hạng thành viên',
  points: 'Điểm thưởng', lastOrderAt: 'Ngày đặt hàng cuối cùng',
};

/**
 * Rows of the pasted Haravan customer export (header found within the first 5 rows) -> Map<phone, Customer>.
 * Every column is required and every value must parse: a silent 0 here would wipe points on upload.
 */
function customersFromSheetRows(rows) {
  var phoneKey = headerKey_(CUSTOMER_COLS.phone);
  var h = -1;
  for (var i = 0; i < Math.min(rows.length, 5) && h < 0; i++) {
    if (rows[i].map(headerKey_).indexOf(phoneKey) >= 0) h = i;
  }
  if (h < 0) throw new Error('Không thấy cột "' + CUSTOMER_COLS.phone + '" trong sheet khách hàng. Hãy dán cả dòng tiêu đề của file xuất từ Haravan.');
  var header = rows[h].map(headerKey_);
  var col = {};
  var missing = [];
  Object.keys(CUSTOMER_COLS).forEach(function (k) {
    col[k] = header.indexOf(headerKey_(CUSTOMER_COLS[k]));
    if (col[k] < 0) missing.push(CUSTOMER_COLS[k]);
  });
  if (missing.length) throw new Error('File khách hàng thiếu cột: ' + missing.join(', ') + '. Hãy dán đúng file xuất từ Haravan.');
  var out = new Map();
  out.emailOwners = new Map(); // every customer's email, also those without a usable phone (see buildExportRows)
  rows.slice(h + 1).forEach(function (r) {
    var phone = normalizePhone(r[col.phone]);
    var email = cleanEmail(r[col.email]);
    if (email && !out.emailOwners.has(email.toLowerCase())) out.emailOwners.set(email.toLowerCase(), phone || '');
    if (!phone) return;
    if (out.has(phone)) throw new Error('SĐT ' + phone + ' xuất hiện 2 lần trong sheet khách hàng. Hãy xoá sạch sheet rồi dán lại file mới.');
    out.set(phone, {
      phone: phone,
      name: String(r[col.name] || '').trim(),
      email: String(r[col.email] || '').trim(),
      province: String(r[col.province] || '').trim(),
      tier: String(r[col.tier] || '').trim(),
      points: strictNum_(r[col.points], CUSTOMER_COLS.points, phone),
      totalSpent: strictNum_(r[col.totalSpent], CUSTOMER_COLS.totalSpent, phone),
      periodSpent: strictNum_(r[col.periodSpent], CUSTOMER_COLS.periodSpent, phone),
      lastOrderAt: strictDate_(r[col.lastOrderAt], CUSTOMER_COLS.lastOrderAt, phone),
    });
  });
  return out;
}

/* ---------------- Apps Script I/O (not run in Node) ---------------- */

function haravanToken_() {
  var t = PropertiesService.getScriptProperties().getProperty(TOKEN_KEY);
  if (!t) throw new Error('Chưa cài kết nối Haravan. Chủ shop vào menu Quản trị → ⚙️ Cài đặt kết nối Haravan.');
  return t;
}

/** GET one Haravan endpoint, retrying 429/5xx with 2s/4s/8s backoff. */
function haravanGet(path, params) {
  var url = HARAVAN_BASE + path + buildQuery(params);
  var options = { method: 'get', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + haravanToken_() } };
  for (var attempt = 0; ; attempt++) {
    var res = UrlFetchApp.fetch(url, options);
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return JSON.parse(res.getContentText());
    if ((code === 429 || code >= 500) && attempt < 3) { Utilities.sleep(2000 * Math.pow(2, attempt)); continue; }
    if (code === 401 || code === 403) throw new Error('Haravan: ' + code + ' token sai, hết hạn hoặc thiếu quyền.');
    throw new Error('Haravan: ' + code + ' ' + res.getContentText().slice(0, 150));
  }
}

/** Page through a list endpoint (limit 50) until a short page; onPage(items, page) is called per page. */
function haravanGetAll(path, params, key, onPage) {
  var all = [];
  for (var page = (params && params.page) || 1; ; page++) {
    var items = haravanGet(path, Object.assign({}, params, { limit: 50, page: page }))[key] || [];
    if (onPage) onPage(items, page); else all = all.concat(items);
    if (items.length < 50) return all;
  }
}

/** Owner only: store the Private App token from a prompt. */
function setupToken() {
  var ui = SpreadsheetApp.getUi();
  var owner = SpreadsheetApp.getActiveSpreadsheet().getOwner();
  if (owner && Session.getActiveUser().getEmail() !== owner.getEmail()) {
    ui.alert('Chỉ chủ shop được cài kết nối Haravan.');
    return;
  }
  var r = ui.prompt('Cài đặt kết nối Haravan', 'Dán token của ứng dụng "Loyalty Export - Chi doc":', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var token = r.getResponseText().trim();
  if (!/^[A-Za-z0-9]{20,}$/.test(token)) { ui.alert('Token không hợp lệ.'); return; }
  PropertiesService.getScriptProperties().setProperty(TOKEN_KEY, token);
  try {
    haravanGet('orders.json', { limit: 1 });
    ui.alert('✅ Đã lưu token và kết nối Haravan thành công.');
  } catch (e) {
    ui.alert('Đã lưu token nhưng kết nối lỗi: ' + e.message);
  }
}

/** Read-only probe: shows the fields of known orders and a few customers, personal data hidden. */
function probeHaravan() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Probe') || ss.insertSheet('Probe');
  sh.clear();
  var rows = [['Nguồn', 'Trường', 'Giá trị']];
  function add(label, obj) { flattenForProbe(obj).forEach(function (r) { rows.push([label, r[0], r[1]]); }); }
  // Known orders from the old "Haravan" sheet: one Shopee (marketplace code) and one with partner tracking code.
  ['1787759655', '1789506213'].forEach(function (id) {
    try { add('order ' + id, haravanGet('orders/' + id + '.json', {}).order); }
    catch (e) { rows.push(['order ' + id, 'LỖI', e.message]); }
  });
  try {
    haravanGet('orders.json', { limit: 2, status: 'any' }).orders.forEach(function (o, i) { add('order mới ' + i, o); });
  } catch (e) { rows.push(['orders', 'LỖI', e.message]); }
  try {
    haravanGet('customers.json', { limit: 2 }).customers.forEach(function (c, i) { add('customer ' + i, c); });
  } catch (e) { rows.push(['customers', 'LỖI', e.message]); }
  sh.getRange(1, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
  SpreadsheetApp.getUi().alert('Đã ghi ' + (rows.length - 1) + ' dòng vào sheet "Probe".');
}

if (typeof module !== 'undefined') module.exports = {
  buildQuery: buildQuery,
  flattenForProbe: flattenForProbe,
  toOrder: toOrder,
  customersFromSheetRows: customersFromSheetRows,
};
