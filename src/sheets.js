/**
 * Loyalty Haravan — sheet layout, readers and writers (Apps Script).
 * Row <-> object mappers are pure and Node-tested; everything touching SpreadsheetApp is not.
 */
if (typeof module !== 'undefined') Object.assign(globalThis, require('./rules.js'));

var SHEETS = {
  SETTINGS: 'Cài đặt',
  BATCH: 'Đợt hiện tại',
  REVIEW: 'Cần kiểm tra',
  LEDGER: 'Sổ đơn đã tích',
  HISTORY: 'Lịch sử',
  REPORT: 'Báo cáo',
  CUSTOMERS: 'Khách hàng Haravan',
  ORDERS: 'Đơn Haravan',
  PENDING: 'Đợt - chi tiết',
};

var HEADERS = {};
HEADERS[SHEETS.SETTINGS] = ['Mục', 'Giá trị', 'Ghi chú'];
HEADERS[SHEETS.LEDGER] = ['Mã đơn', 'ID đơn Haravan', 'SĐT', 'Kênh', 'Thời gian khai', 'Ngày tạo đơn',
  'Giá trị sau giảm', 'Hạng', 'Hệ số', 'Điểm', 'Mã đợt', 'Nguồn'];
HEADERS[SHEETS.PENDING] = HEADERS[SHEETS.LEDGER];
HEADERS[SHEETS.HISTORY] = ['Mã đợt', 'Tạo lúc', 'Người tạo', 'Số khách', 'Số đơn', 'Tổng điểm', 'Trạng thái',
  'Người xác nhận/huỷ', 'Lúc xác nhận/huỷ', 'SĐT lỗi', 'File'];
HEADERS[SHEETS.REVIEW] = ['Dòng form', 'Thời gian khai', 'Kênh', 'SĐT', 'Mã đơn', 'Loại', 'Lý do',
  'Lần đầu thấy', 'Ghi chú'];
HEADERS[SHEETS.ORDERS] = ['ID', 'Mã đơn', 'Mã đơn sàn', 'Mã vận chuyển đối tác', 'Ngày tạo',
  'Ngày giao thành công', 'Đã giao', 'Huỷ/Hoàn', 'Giá trị sau giảm', 'Tỉnh', 'Cập nhật lúc', 'Nguồn đơn'];

var SETTINGS_DEFAULTS = [
  ['ID file form', '1yICSQ4bGpCQxMIJ_98PlD8ka6IRT-bt3xt6toQNGN_8', 'File Loyalty cũ chứa câu trả lời Google Form'],
  ['Tên sheet form', 'Dữ Liệu Gốc', ''],
  ['Ngày bắt đầu dữ liệu', '01/08/2025', 'Lấy đơn Haravan từ ngày này (dd/MM/yyyy)'],
  ['Số tiền mỗi điểm', 100000, 'VNĐ'],
  ['Hệ số Silver', 1, 'Khách chưa có hạng tính là Silver'],
  ['Hệ số Gold', 3, ''],
  ['Hệ số Platinum', 5, ''],
  ['Số ngày chờ sau giao', 15, 'Đơn giao thành công đủ số ngày này mới được tích'],
  ['Số ngày giữ đơn', 365, 'Chỉ lưu đơn Shopee/TikTok tạo trong số ngày gần nhất này; đơn cũ hơn tự xoá'],
  ['Nguồn khách hàng', 'sheet', 'api = lấy qua API; sheet = dán file vào sheet "Khách hàng Haravan"'],
];

function toNumber_(v) {
  if (typeof v === 'number') return v;
  var n = Number(String(v || '').replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function toDateOrNull_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  var vn = parseFormTimestamp(v); // dd/MM/yyyy first: new Date() would read it as MM/dd
  if (vn) return vn;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function ledgerToRow(e) {
  return [e.code, e.orderId || '', e.phone, e.channel || '', e.claimedAt || '', e.orderCreatedAt || '',
    e.value, e.tier || '', e.multiplier, e.points, e.batchId, e.source];
}

function rowToLedger(r) {
  return {
    code: normalizeCode(r[0]),
    orderId: String(r[1] || ''),
    phone: normalizePhone(r[2]) || String(r[2] || ''),
    channel: String(r[3] || ''),
    claimedAt: toDateOrNull_(r[4]),
    orderCreatedAt: toDateOrNull_(r[5]),
    value: toNumber_(r[6]),
    tier: String(r[7] || ''),
    multiplier: toNumber_(r[8]),
    points: toNumber_(r[9]),
    batchId: String(r[10] || ''),
    source: String(r[11] || ''),
  };
}

function parseSettingsRows(rows) {
  var byLabel = {};
  var multipliers = {};
  rows.forEach(function (r) {
    var label = String(r[0] || '').trim();
    if (!label) return;
    byLabel[label] = r[1];
    var m = /^Hệ số (.+)$/.exec(label);
    if (m) multipliers[m[1].trim()] = toNumber_(r[1]);
  });
  return {
    formSpreadsheetId: String(byLabel['ID file form'] || '').trim(),
    formSheetName: String(byLabel['Tên sheet form'] || 'Dữ Liệu Gốc').trim(),
    dataStart: toDateOrNull_(byLabel['Ngày bắt đầu dữ liệu']),
    vndPerPoint: toNumber_(byLabel['Số tiền mỗi điểm']) || 100000,
    multipliers: multipliers,
    waitDays: isNaN(parseFloat(byLabel['Số ngày chờ sau giao'])) ? 15 : toNumber_(byLabel['Số ngày chờ sau giao']),
    retentionDays: isNaN(parseFloat(byLabel['Số ngày giữ đơn'])) ? 365 : toNumber_(byLabel['Số ngày giữ đơn']),
    customerSource: String(byLabel['Nguồn khách hàng'] || 'api').trim().toLowerCase() === 'sheet' ? 'sheet' : 'api',
  };
}

function rowToSubmission(r, rowNumber) {
  return {
    row: rowNumber, timestamp: r[0], channel: String(r[1] || '').trim(), name: String(r[2] || '').trim(),
    phoneRaw: r[3], email: String(r[4] || '').trim(), codeRaw: r[5],
  };
}

function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function iso_(d) { return d ? d.toISOString() : ''; }

/** Order -> cache row; dates stored as ISO text so the sheet's timezone never shifts them. */
function orderToRow(o, updatedAt) {
  return [o.id, o.name, o.marketplaceCode, o.partnerTrackingCode, iso_(o.createdAt), iso_(o.deliveredAt),
    o.delivered, o.voided, o.valueAfterDiscount, o.province, updatedAt || '', o.source || ''];
}

function rowToOrder(r) {
  return {
    id: String(r[0]), name: String(r[1] || ''), marketplaceCode: String(r[2] || ''),
    partnerTrackingCode: String(r[3] || ''), createdAt: toDateOrNull_(r[4]), deliveredAt: toDateOrNull_(r[5]),
    delivered: bool_(r[6]), voided: bool_(r[7]), valueAfterDiscount: toNumber_(r[8]), province: String(r[9] || ''),
    source: String(r[11] || ''),
  };
}

/** Credits of a batch -> ledger rows (values only). */
function creditsToLedgerRows(credits, batchId) {
  return credits.map(function (c) {
    return ledgerToRow({
      code: normalizeCode(c.submission.codeRaw), orderId: c.order.id, phone: c.phone, channel: c.submission.channel,
      claimedAt: parseFormTimestamp(c.submission.timestamp), orderCreatedAt: c.order.createdAt,
      value: c.order.valueAfterDiscount, tier: c.tier, multiplier: c.multiplier, points: c.points,
      batchId: batchId, source: 'Hệ thống',
    });
  });
}

/** Review items -> "Cần kiểm tra" rows, keeping "Lần đầu thấy" and "Ghi chú" from the previous run (key: form row + code). */
function reviewToRows(review, previousRows, todayKey) {
  var prev = {};
  previousRows.forEach(function (r) { prev[r[0] + '|' + normalizeCode(r[4])] = r; });
  return review.slice().sort(function (a, b) {
    if (a.kind !== b.kind) return a.kind === 'warn' ? -1 : 1;
    return a.submission.row - b.submission.row;
  }).map(function (it) {
    var s = it.submission;
    var code = normalizeCode(s.codeRaw);
    var old = prev[s.row + '|' + code];
    var ts = parseFormTimestamp(s.timestamp);
    return [s.row, ts ? formatIsoVN(ts).slice(0, 19).replace('T', ' ') : String(s.timestamp || ''), s.channel,
      String(s.phoneRaw === null || s.phoneRaw === undefined ? '' : s.phoneRaw), code,
      it.kind === 'warn' ? 'Cần xem' : 'Đang chờ', it.reason, old ? old[7] : todayKey, old ? old[8] : ''];
  });
}

function batchSummaryRows(meta, exportRows, credits, review) {
  var warn = review.filter(function (r) { return r.kind === 'warn'; }).length;
  return [
    ['Mã đợt', meta.batchId], ['Tạo lúc', meta.createdAt], ['Người tạo', meta.createdBy],
    ['Số khách / số đơn được tích', exportRows.length + ' khách / ' + credits.length + ' đơn'],
    ['Tổng điểm cộng thêm', credits.reduce(function (s, c) { return s + c.points; }, 0)],
    ['Cần kiểm tra / đang chờ', warn + ' / ' + (review.length - warn)],
  ];
}

/** Keep only cache rows (B name, C marketplace code, D tracking code) whose code is in the claimed-code set. */
function filterOrderRowsByCodes(rows, codeSet) {
  return rows.filter(function (r) {
    return codeSet.has(normalizeCode(r[1])) || codeSet.has(normalizeCode(r[2])) || codeSet.has(normalizeCode(r[3]));
  });
}

/** Sorted row numbers -> [first, last] blocks; a gap larger than maxGap starts a new block. */
function planUpdateBlocks(rowNumbers, maxGap) {
  var rows = rowNumbers.slice().sort(function (a, b) { return a - b; });
  var blocks = [];
  rows.forEach(function (r) {
    var b = blocks[blocks.length - 1];
    if (b && r - b[1] <= maxGap) b[1] = r;
    else blocks.push([r, r]);
  });
  return blocks;
}

/** Only Shopee/TikTok orders are worth caching (spec R1). */
function isCacheableOrder(o) { return MARKETPLACE_SOURCE.test(o.source || ''); }

/** First order creation date to keep: the later of "Ngày bắt đầu dữ liệu" and now - "Số ngày giữ đơn". */
function syncStartDate(settings, now) {
  var byRetention = new Date(now.getTime() - settings.retentionDays * DAY_MS);
  return settings.dataStart && settings.dataStart > byRetention ? settings.dataStart : byRetention;
}

/**
 * Cache rows [source, createdAt ISO] sorted by source then date, first one at sheet row firstRow ->
 * [first, last] row blocks to delete (non-marketplace sources, or created before cutoff), bottom-up for deleteRows.
 */
function planPruneBlocks(rows, cutoff, firstRow) {
  var del = [];
  rows.forEach(function (r, i) {
    var created = new Date(r[1]);
    if (!MARKETPLACE_SOURCE.test(String(r[0] || '')) || isNaN(created.getTime()) || created < cutoff) del.push(firstRow + i);
  });
  return planUpdateBlocks(del, 1).reverse();
}

var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** buildReport() output -> rows for the "Báo cáo" sheet: one 8-row block per channel. */
function reportToRows(report, year) {
  var rows = [];
  function pad(r) { while (r.length < 13) r.push(''); return r; }
  REPORT_CHANNELS.forEach(function (ch) {
    var d = report[ch];
    rows.push(pad(['Bảng Tổng Hợp Data Khách Hàng Từ Các Kênh Ecom - ' + ch + ' - ' + year]));
    rows.push([ch].concat(MONTHS));
    rows.push(['Phone'].concat(d.phones));
    rows.push(['Giá Trị Đơn Hàng'].concat(d.value));
    rows.push(['Điểm Loyalty'].concat(d.points));
    rows.push(['Giá Trị Điểm'].concat(d.pointValue));
    rows.push(['AOV'].concat(d.aov));
    rows.push(pad([]));
  });
  return rows;
}

/**
 * Old file "Edit" rows (columns A..Q) -> ledger rows for every Done order, first occurrence per code.
 * The old sheet's processing date 08/01/2025 was a typo for 08/01/2026 (confirmed by the owner).
 */
function editRowsToLedgerRows(editRows) {
  var seen = {};
  var out = [];
  editRows.forEach(function (r) {
    if (String(r[16]).trim() !== 'Done') return;
    var code = normalizeCode(r[5]);
    if (!code || seen[code]) return;
    seen[code] = true;
    var batchDate = String(r[15] instanceof Date ? Utilities.formatDate(r[15], 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy') : r[15]);
    if (batchDate === '08/01/2025') batchDate = '08/01/2026';
    out.push([code, '', normalizePhone(r[3]) || String(r[3]), String(r[1]), r[0], '', toNumber_(r[10]),
      String(r[12] || ''), toNumber_(r[13]), toNumber_(r[14]), 'CU-' + batchDate, 'Chuyển từ file cũ']);
  });
  return out;
}

/* ---------------- Apps Script I/O (not run in Node) ---------------- */

/** One-time: copy Done orders from the old file's "Edit" sheet into the ledger (old file is only read). */
function migrateLedgerFromOldFile() {
  var sh = sheet_(SHEETS.LEDGER);
  if (sh.getLastRow() > 1) throw new Error('Sổ đơn đã tích đã có dữ liệu, không chép lại.');
  var settings = readSettings();
  var edit = SpreadsheetApp.openById(settings.formSpreadsheetId).getSheetByName('Edit');
  var rows = editRowsToLedgerRows(edit.getRange(3, 1, edit.getLastRow() - 2, 17).getValues());
  sh.getRange('A:C').setNumberFormat('@');
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  SpreadsheetApp.getUi().alert('Đã chép ' + rows.length + ' mã đơn sang "' + SHEETS.LEDGER + '".');
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Không tìm thấy sheet "' + name + '". Hãy chạy "Thiết lập file" trong menu.');
  return sh;
}

/** Create any missing sheet with its header; existing sheets and their data are left untouched. */
function setupSheets() {
  var ss = ss_();
  Object.keys(SHEETS).forEach(function (k) {
    var name = SHEETS[k];
    if (ss.getSheetByName(name)) return;
    var sh = ss.insertSheet(name);
    if (HEADERS[name]) {
      sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    if (name === SHEETS.SETTINGS) sh.getRange(2, 1, SETTINGS_DEFAULTS.length, 3).setValues(SETTINGS_DEFAULTS);
    if (name === SHEETS.LEDGER) sh.getRange('A:C').setNumberFormat('@');
    if (name === SHEETS.REVIEW) sh.getRange('D:E').setNumberFormat('@');
    if (name === SHEETS.ORDERS) sh.getRange('A:L').setNumberFormat('@');
    if (name === SHEETS.ORDERS || name === SHEETS.PENDING) sh.hideSheet();
    if (name === SHEETS.PENDING) sh.getRange('A:C').setNumberFormat('@');
  });
  var blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('Trang tính1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
}

function readSettings() {
  var sh = sheet_(SHEETS.SETTINGS);
  var last = sh.getLastRow();
  return parseSettingsRows(last < 2 ? [] : sh.getRange(2, 1, last - 1, 2).getValues());
}

function readLedger() {
  var sh = sheet_(SHEETS.LEDGER);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS[SHEETS.LEDGER].length).getValues()
    .filter(function (r) { return String(r[0]).trim() !== ''; })
    .map(rowToLedger);
}

function appendLedger(entries) {
  if (!entries.length) return;
  var sh = sheet_(SHEETS.LEDGER);
  var rows = entries.map(ledgerToRow);
  var at = sh.getLastRow() + 1;
  sh.getRange(at, 1, rows.length, 3).setNumberFormat('@');
  sh.getRange(at, 1, rows.length, rows[0].length).setValues(rows);
}

/** Read all form answers from the old file (read-only). Header on row 2, data from row 3, columns A..F. */
function readForm(settings) {
  var sh = SpreadsheetApp.openById(settings.formSpreadsheetId).getSheetByName(settings.formSheetName);
  if (!sh) throw new Error('Không tìm thấy sheet form "' + settings.formSheetName + '".');
  var last = sh.getLastRow();
  if (last < 3) return [];
  return sh.getRange(3, 1, last - 2, 6).getValues()
    .map(function (r, i) { return rowToSubmission(r, i + 3); })
    .filter(function (s) { return String(s.codeRaw || '').trim() !== '' || String(s.phoneRaw || '').trim() !== ''; });
}

/**
 * Menu 🔒 (owner): "Cài đặt" is owner-only. Ledger/history/batch sheets get warning-only protection:
 * scripts run as the person clicking, so a hard lock would stop staff from confirming a batch,
 * while the warning still prevents accidental manual edits.
 */
function protectSheets() {
  var ss = ss_();
  var ui = SpreadsheetApp.getUi();
  var owner = ss.getOwner();
  if (owner && Session.getActiveUser().getEmail() !== owner.getEmail()) { ui.alert('Chỉ chủ shop được bật phân quyền.'); return; }
  Object.keys(SHEETS).forEach(function (k) {
    var sh = ss.getSheetByName(SHEETS[k]);
    if (!sh || SHEETS[k] === SHEETS.CUSTOMERS) return;
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
    var p = sh.protect().setDescription('Loyalty: chỉ hệ thống ghi');
    if (SHEETS[k] === SHEETS.SETTINGS) {
      p.removeEditors(p.getEditors());
      if (p.canDomainEdit()) p.setDomainEdit(false);
    } else {
      if (SHEETS[k] === SHEETS.REVIEW) p.setUnprotectedRanges([sh.getRange('I2:I')]);
      p.setWarningOnly(true);
    }
  });
  ui.alert('🔒 Đã bật phân quyền: chỉ chủ shop sửa được "Cài đặt"; các sheet hệ thống sẽ cảnh báo khi sửa tay.');
}

/** Rewrite the "Báo cáo" sheet for the given year (default: current year in Vietnam). */
function writeReport(year) {
  year = year || Number(vnDayKey(new Date()).slice(0, 4));
  var rows = reportToRows(buildReport(readLedger(), year), year);
  var sh = sheet_(SHEETS.REPORT);
  sh.clear();
  sh.getRange(1, 1, rows.length, 13).setValues(rows);
  for (var i = 0; i < rows.length; i += 8) {
    sh.getRange(i + 1, 1).setFontWeight('bold');
    sh.getRange(i + 2, 1, 1, 13).setFontWeight('bold');
    sh.getRange(i + 3, 2, 5, 12).setNumberFormat('#,##0');
  }
}

/** Menu 📊 */
function refreshReport() {
  writeReport();
  SpreadsheetApp.getUi().alert('📊 Đã cập nhật sheet "' + SHEETS.REPORT + '".');
}

if (typeof module !== 'undefined') module.exports = {
  SHEETS: SHEETS,
  HEADERS: HEADERS,
  SETTINGS_DEFAULTS: SETTINGS_DEFAULTS,
  ledgerToRow: ledgerToRow,
  rowToLedger: rowToLedger,
  parseSettingsRows: parseSettingsRows,
  rowToSubmission: rowToSubmission,
  editRowsToLedgerRows: editRowsToLedgerRows,
  orderToRow: orderToRow,
  isCacheableOrder: isCacheableOrder,
  syncStartDate: syncStartDate,
  planPruneBlocks: planPruneBlocks,
  planUpdateBlocks: planUpdateBlocks,
  filterOrderRowsByCodes: filterOrderRowsByCodes,
  reportToRows: reportToRows,
  creditsToLedgerRows: creditsToLedgerRows,
  reviewToRows: reviewToRows,
  batchSummaryRows: batchSummaryRows,
  rowToOrder: rowToOrder,
};
