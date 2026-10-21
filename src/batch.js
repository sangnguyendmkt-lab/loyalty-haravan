/**
 * Loyalty Haravan — order sync and batch lifecycle (Apps Script only).
 */

var SYNC = {
  CURSOR: 'ORDERS_SYNC_CURSOR',       // ISO updated_at_min for incremental runs (set once the initial load is done)
  PAGE: 'ORDERS_SYNC_PAGE',           // next page of the run in progress
  RUN_START: 'ORDERS_SYNC_RUN_START', // when the run in progress started (becomes the next cursor)
  OVERLAP_MS: 60 * 60 * 1000,
  TRIGGER: 'continueOrderSync',
};

function props_() { return PropertiesService.getScriptProperties(); }

/**
 * Pull new/changed orders into the hidden order cache until deadlineMs.
 * First run loads everything created since Cài đặt "Ngày bắt đầu dữ liệu"; later runs only what changed.
 * Returns {done, fetched}; progress is saved after every page so an interrupted run resumes.
 */
function syncOrders(deadlineMs) {
  var p = props_();
  var settings = readSettings();
  var cursor = p.getProperty(SYNC.CURSOR);
  var page = Number(p.getProperty(SYNC.PAGE) || 1);
  var runStart = p.getProperty(SYNC.RUN_START);
  if (!runStart) { runStart = new Date().toISOString(); p.setProperty(SYNC.RUN_START, runStart); }

  var params = cursor
    ? { updated_at_min: new Date(new Date(cursor).getTime() - SYNC.OVERLAP_MS).toISOString(), status: 'any' }
    : { created_at_min: settings.dataStart.toISOString(), status: 'any' };

  var sh = sheet_(SHEETS.ORDERS);
  var last = sh.getLastRow();
  var rowById = new Map();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r, i) { rowById.set(String(r[0]), i + 2); });
  }

  var fetched = 0;
  while (true) {
    if (Date.now() > deadlineMs) return { done: false, fetched: fetched };
    var items = haravanGet('orders.json', Object.assign({ limit: 50, page: page }, params)).orders || [];
    var appends = [];
    items.forEach(function (raw) {
      var row = orderToRow(toOrder(raw), String(raw.updated_at || ''));
      var at = rowById.get(row[0]);
      if (at) sh.getRange(at, 1, 1, row.length).setValues([row]);
      else appends.push(row);
    });
    if (appends.length) {
      var start = sh.getLastRow() + 1;
      sh.getRange(start, 1, appends.length, appends[0].length).setNumberFormat('@').setValues(appends);
      appends.forEach(function (r, i) { rowById.set(String(r[0]), start + i); });
    }
    fetched += items.length;
    if (items.length < 50) break;
    page++;
    p.setProperty(SYNC.PAGE, String(page));
  }
  p.setProperty(SYNC.CURSOR, runStart);
  p.deleteProperty(SYNC.PAGE);
  p.deleteProperty(SYNC.RUN_START);
  return { done: true, fetched: fetched };
}

function readOrders() {
  var sh = sheet_(SHEETS.ORDERS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS[SHEETS.ORDERS].length).getValues().map(rowToOrder);
}

/** Time-trigger target: keeps the first big load going in the background, every 5 minutes, until done. */
function continueOrderSync() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return;
  try {
    var r = syncOrders(Date.now() + 4.5 * 60 * 1000);
    if (r.done) removeSyncTrigger_();
  } finally {
    lock.releaseLock();
  }
}

function ensureSyncTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === SYNC.TRIGGER; });
  if (!exists) ScriptApp.newTrigger(SYNC.TRIGGER).timeBased().everyMinutes(5).create();
}

function removeSyncTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === SYNC.TRIGGER) ScriptApp.deleteTrigger(t);
  });
}

/** Menu: start (or continue) the order sync; the first full load continues by itself in the background. */
function startOrderSync() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) { ui.alert('Đang có người xử lý, vui lòng chờ.'); return; }
  try {
    var r = syncOrders(Date.now() + 4.5 * 60 * 1000);
    if (r.done) {
      removeSyncTrigger_();
      ui.alert('✅ Đã cập nhật đơn hàng (' + r.fetched + ' đơn mới/thay đổi).');
    } else {
      ensureSyncTrigger_();
      ui.alert('Đã tải ' + r.fetched + ' đơn. Hệ thống sẽ tự tải tiếp mỗi 5 phút đến khi xong — bạn có thể đóng file.');
    }
  } finally {
    lock.releaseLock();
  }
}

var OPEN_BATCH_KEY = 'OPEN_BATCH';
var CUSTOMERS_UPDATED_KEY = 'CUSTOMERS_UPDATED_AT';
var BATCH_DATA_ROW = 9; // summary in rows 1-6, header in row 8, upload rows from row 9

function openBatch_() {
  var v = props_().getProperty(OPEN_BATCH_KEY);
  return v ? JSON.parse(v) : null;
}

function userEmail_() { return Session.getActiveUser().getEmail() || 'không rõ'; }

function nowText_() { return formatIsoVN(new Date()).slice(0, 16).replace('T', ' '); }

function loadCustomers_(settings) {
  if (settings.customerSource !== 'sheet') {
    throw new Error('API Haravan không có điểm thưởng/hạng. Đặt "Nguồn khách hàng" = sheet trong Cài đặt.');
  }
  var updated = props_().getProperty(CUSTOMERS_UPDATED_KEY);
  if (!updated || vnDayKey(new Date(updated)) !== vnDayKey(new Date())) {
    throw new Error('Dữ liệu khách hàng chưa được cập nhật hôm nay.\n\nHãy xuất file khách hàng mới nhất từ Haravan và dán vào sheet "' +
      SHEETS.CUSTOMERS + '" (kể cả dòng tiêu đề), rồi bấm 🚀 lại.');
  }
  return customersFromSheetRows(sheet_(SHEETS.CUSTOMERS).getDataRange().getValues());
}

function appendHistory_(row) {
  var sh = sheet_(SHEETS.HISTORY);
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

/** Update the History row of a batch: cols is {columnIndex(1-based): value}. */
function updateHistory_(batchId, cols) {
  var sh = sheet_(SHEETS.HISTORY);
  var ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (var i = ids.length - 1; i >= 1; i--) {
    if (String(ids[i][0]) === batchId) {
      Object.keys(cols).forEach(function (c) { sh.getRange(i + 1, Number(c)).setValue(cols[c]); });
      return;
    }
  }
}

function clearBatchSheets_() {
  sheet_(SHEETS.BATCH).clear();
  var pending = sheet_(SHEETS.PENDING);
  if (pending.getLastRow() > 1) pending.getRange(2, 1, pending.getLastRow() - 1, pending.getLastColumn()).clearContent();
}

/** Menu 🚀: evaluate all form claims and prepare this week's upload file (nothing is written to the ledger yet). */
function createBatch() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) { ui.alert('Đang có người xử lý, vui lòng chờ.'); return; }
  try {
    if (openBatch_()) {
      ui.alert('Đợt trước chưa được xác nhận hoặc huỷ.\n\nHãy bấm ✅ Xác nhận đã upload (nếu đã upload) hoặc ❌ Huỷ đợt.');
      return;
    }
    haravanToken_();
    var settings = readSettings();
    var customers = loadCustomers_(settings);

    var sync = syncOrders(Date.now() + 3 * 60 * 1000);
    if (!sync.done) {
      ensureSyncTrigger_();
      ui.alert('Đang tải đơn hàng từ Haravan (lần đầu có thể lâu). Hệ thống tự tải tiếp mỗi 5 phút — hãy bấm 🚀 lại sau.');
      return;
    }

    var now = new Date();
    var result = evaluateSubmissions(readForm(settings), readLedger(), buildOrderIndex(readOrders()), customers, settings, now);
    var exportRows = buildExportRows(result.credits, customers);
    var meta = { batchId: Utilities.formatDate(now, 'Asia/Ho_Chi_Minh', 'yyyyMMdd-HHmm'), createdAt: nowText_(),
      createdBy: userEmail_(), day: vnDayKey(now) };

    // Hidden per-order detail, moved to the ledger on confirm.
    clearBatchSheets_();
    var detail = creditsToLedgerRows(result.credits, meta.batchId);
    if (detail.length) sheet_(SHEETS.PENDING).getRange(2, 1, detail.length, detail[0].length).setValues(detail);

    // Visible batch sheet: summary + the 10 upload columns.
    var b = sheet_(SHEETS.BATCH);
    var summary = batchSummaryRows(meta, exportRows, result.credits, result.review);
    b.getRange(1, 1, summary.length, 2).setValues(summary);
    b.getRange(1, 1, summary.length, 1).setFontWeight('bold');
    b.getRange(BATCH_DATA_ROW - 1, 1, 1, EXPORT_HEADERS.length).setValues([EXPORT_HEADERS]).setFontWeight('bold');
    if (exportRows.length) {
      b.getRange(BATCH_DATA_ROW, 1, exportRows.length, EXPORT_HEADERS.length).setNumberFormat('@')
        .setValues(exportRows.map(formatExportRow));
      b.getRange(BATCH_DATA_ROW, 9, exportRows.length, 1).setNumberFormat('0');
    }

    // Review sheet, keeping staff notes.
    var r = sheet_(SHEETS.REVIEW);
    var prevRows = r.getLastRow() > 1 ? r.getRange(2, 1, r.getLastRow() - 1, HEADERS[SHEETS.REVIEW].length).getValues() : [];
    var reviewRows = reviewToRows(result.review, prevRows, meta.day);
    if (r.getLastRow() > 1) r.getRange(2, 1, r.getLastRow() - 1, HEADERS[SHEETS.REVIEW].length).clearContent();
    if (reviewRows.length) r.getRange(2, 1, reviewRows.length, reviewRows[0].length).setValues(reviewRows);

    props_().setProperty(OPEN_BATCH_KEY, JSON.stringify(meta));
    appendHistory_([meta.batchId, meta.createdAt, meta.createdBy, exportRows.length, result.credits.length,
      summary[4][1], 'Chờ upload', '', '', '', '']);
    b.activate();
    ui.alert('✅ Đã tạo đợt ' + meta.batchId + ': ' + exportRows.length + ' khách, ' + result.credits.length +
      ' đơn, ' + summary[4][1] + ' điểm.\n\nKiểm tra sheet "' + SHEETS.REVIEW + '", rồi bấm 📥 Tải file Excel.');
  } catch (e) {
    ui.alert('Lỗi: ' + e.message);
  } finally {
    lock.releaseLock();
  }
}
