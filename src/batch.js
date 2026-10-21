/**
 * Loyalty Haravan — order sync and batch lifecycle (Apps Script only).
 */

var SYNC = {
  CURSOR: 'ORDERS_SYNC_CURSOR',       // ISO updated_at_min for incremental runs (set once the initial load is done)
  PAGE: 'ORDERS_SYNC_PAGE',           // next page of the run in progress
  RUN_START: 'ORDERS_SYNC_RUN_START', // when the run in progress started (becomes the next cursor)
  OVERLAP_MS: 60 * 60 * 1000,
  TRIGGER: 'continueOrderSync',
  PRUNED_DAY: 'ORDERS_PRUNED_DAY', // VN day of the last cleanup of old / non-marketplace orders
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
    : { created_at_min: syncStartDate(settings, new Date()).toISOString(), status: 'any' };

  var sh = sheet_(SHEETS.ORDERS);
  var last = sh.getLastRow();
  var rowById = new Map();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r, i) { rowById.set(String(r[0]), i + 2); });
  }

  var fetched = 0;
  var updates = new Map(); // sheet row -> new values, written in blocks (one setValues per order is far too slow)
  function flush() {
    planUpdateBlocks(Array.from(updates.keys()), 500).forEach(function (b) {
      var range = sh.getRange(b[0], 1, b[1] - b[0] + 1, HEADERS[SHEETS.ORDERS].length);
      var values = range.getValues();
      for (var r = b[0]; r <= b[1]; r++) if (updates.has(r)) values[r - b[0]] = updates.get(r);
      range.setNumberFormat('@').setValues(values);
    });
    updates.clear();
  }
  while (true) {
    if (Date.now() > deadlineMs) {
      flush();
      p.setProperty(SYNC.PAGE, String(page));
      return { done: false, fetched: fetched };
    }
    var items = haravanGet('orders.json', Object.assign({ limit: 50, page: page }, params)).orders || [];
    var appends = [];
    items.forEach(function (raw) {
      var order = toOrder(raw);
      if (!isCacheableOrder(order)) return; // only Shopee/TikTok orders are kept
      var row = orderToRow(order, String(raw.updated_at || ''));
      var at = rowById.get(row[0]);
      if (at) updates.set(at, row);
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
    if (updates.size >= 2000) flush(); // keep memory bounded; the saved page must never run ahead of written data
    if (!updates.size) p.setProperty(SYNC.PAGE, String(page));
  }
  flush();
  p.setProperty(SYNC.CURSOR, runStart);
  p.deleteProperty(SYNC.PAGE);
  p.deleteProperty(SYNC.RUN_START);
  if (p.getProperty(SYNC.PRUNED_DAY) !== vnDayKey(new Date())) pruneOrderCache(settings);
  return { done: true, fetched: fetched };
}

/**
 * Delete cached orders that are not Shopee/TikTok or older than "Số ngày giữ đơn".
 * The cache is sorted by source then creation date so the rows to delete form a few blocks.
 */
function pruneOrderCache(settings) {
  var sh = sheet_(SHEETS.ORDERS);
  var last = sh.getLastRow();
  var removed = 0;
  if (last > 1) {
    sh.getRange(2, 1, last - 1, HEADERS[SHEETS.ORDERS].length).sort([{ column: 12, ascending: true }, { column: 5, ascending: true }]);
    var src = sh.getRange(2, 12, last - 1, 1).getValues();
    var created = sh.getRange(2, 5, last - 1, 1).getValues();
    var rows = src.map(function (r, i) { return [r[0], created[i][0]]; });
    planPruneBlocks(rows, syncStartDate(settings, new Date()), 2).forEach(function (b) {
      var n = b[1] - b[0] + 1;
      if (n === last - 1) sh.getRange(2, 1, n, HEADERS[SHEETS.ORDERS].length).clearContent(); // can't delete every row
      else sh.deleteRows(b[0], n);
      removed += n;
    });
  }
  props_().setProperty(SYNC.PRUNED_DAY, vnDayKey(new Date()));
  return removed;
}

/**
 * Orders whose name / marketplace code / tracking code is in codeSet. The cache holds hundreds of thousands
 * of orders, so it is scanned in chunks and only matching rows are kept in memory.
 */
function readOrdersForCodes(codeSet) {
  var sh = sheet_(SHEETS.ORDERS);
  var last = sh.getLastRow();
  var width = HEADERS[SHEETS.ORDERS].length;
  var CHUNK = 20000;
  var out = [];
  for (var start = 2; start <= last; start += CHUNK) {
    var n = Math.min(CHUNK, last - start + 1);
    filterOrderRowsByCodes(sh.getRange(start, 1, n, width).getValues(), codeSet)
      .forEach(function (r) { out.push(rowToOrder(r)); });
  }
  return out;
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
var LAST_CONFIRM_KEY = 'LAST_CONFIRM_AT';
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
  var fresh = customersFreshness(props_().getProperty(CUSTOMERS_UPDATED_KEY), props_().getProperty(LAST_CONFIRM_KEY), new Date());
  if (fresh !== 'ok') {
    throw new Error((fresh === 'before-upload'
      ? 'Dữ liệu khách hàng được dán TRƯỚC lần upload gần nhất nên chưa có điểm vừa cộng.'
      : 'Dữ liệu khách hàng chưa được cập nhật hôm nay.') +
      '\n\nHãy xuất file khách hàng mới nhất từ Haravan, xoá sạch sheet "' + SHEETS.CUSTOMERS +
      '" rồi dán vào (kể cả dòng tiêu đề), sau đó bấm 🚀 lại.');
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
    var submissions = expandSubmissions(readForm(settings));
    var codes = new Set(submissions.map(function (x) { return normalizeCode(x.codeRaw); }).filter(Boolean));
    var result = evaluateSubmissions(submissions, readLedger(), buildOrderIndex(readOrdersForCodes(codes)), customers, settings, now);
    var exportRows = buildExportRows(result.credits, customers);
    var meta = { batchId: Utilities.formatDate(now, 'Asia/Ho_Chi_Minh', 'yyyyMMdd-HHmm'), createdAt: nowText_(),
      createdBy: userEmail_(), day: vnDayKey(now) };

    // Hidden per-order detail, moved to the ledger on confirm.
    clearBatchSheets_();
    var detail = creditsToLedgerRows(result.credits, meta.batchId);
    if (detail.length) {
      var pend = sheet_(SHEETS.PENDING);
      pend.getRange(2, 1, detail.length, 3).setNumberFormat('@');
      pend.getRange(2, 1, detail.length, detail[0].length).setValues(detail);
    }

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

function requireOpenBatch_(ui) {
  var meta = openBatch_();
  if (!meta) { ui.alert('Chưa có đợt nào đang mở. Hãy bấm 🚀 Tạo file loyalty trước.'); return null; }
  return meta;
}

function batchUploadRows_() {
  var b = sheet_(SHEETS.BATCH);
  var n = b.getLastRow() - BATCH_DATA_ROW + 1;
  if (n < 1) return [];
  return b.getRange(BATCH_DATA_ROW, 1, n, EXPORT_HEADERS.length).getValues()
    .filter(function (r) { return String(r[1]).trim() !== ''; })
    .map(function (r) {
      return r.map(function (v, i) { return i === 8 ? Number(v) || 0 : String(v); });
    });
}

function exportFolder_() {
  var it = DriveApp.getFoldersByName('Loyalty Exports');
  return it.hasNext() ? it.next() : DriveApp.createFolder('Loyalty Exports');
}

/** Menu 📥: build loyalty_yyyy-MM-dd.xlsx exactly like the file Haravan accepted, save to Drive, show a link. */
function exportBatch() {
  var ui = SpreadsheetApp.getUi();
  var meta = requireOpenBatch_(ui);
  if (!meta) return;
  if (meta.day !== vnDayKey(new Date())) {
    ui.alert('Đợt ' + meta.batchId + ' đã hết hạn (chỉ dùng trong ngày tạo).\n\nHãy ❌ Huỷ đợt rồi 🚀 tạo lại để lấy điểm mới nhất.');
    return;
  }
  var rows = batchUploadRows_();
  if (!rows.length) { ui.alert('Đợt này không có khách nào được tích điểm, không cần upload.'); return; }

  var tmp = SpreadsheetApp.create('loyalty-tmp-' + meta.batchId);
  try {
    var sh = tmp.getSheets()[0].setName('Sheet1');
    var all = [EXPORT_HEADERS].concat(rows);
    sh.getRange(1, 1, all.length, EXPORT_HEADERS.length).setNumberFormat('@');
    sh.getRange(2, 9, rows.length, 1).setNumberFormat('0');
    sh.getRange(1, 1, all.length, EXPORT_HEADERS.length).setValues(all);
    SpreadsheetApp.flush();
    var blob = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + tmp.getId() + '/export?format=xlsx', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    }).getBlob().setName('loyalty_' + meta.day + '.xlsx');
    var file = exportFolder_().createFile(blob);
    updateHistory_(meta.batchId, { 11: file.getUrl() });
    var html = HtmlService.createHtmlOutput(
      '<div style="font:14px sans-serif">' +
      '<p><b>' + rows.length + ' khách</b> — file <b>' + file.getName() + '</b></p>' +
      '<p><a href="' + file.getDownloadUrl() + '" target="_blank">📥 Tải file về máy</a></p>' +
      '<p>⚠️ Hãy upload lên Haravan <b>ngay bây giờ</b>. Điểm khách thay đổi trên Haravan sau lúc tạo đợt sẽ bị file này ghi đè.</p>' +
      '<p>Upload xong, bấm <b>✅ Xác nhận đã upload</b>.</p></div>').setWidth(420).setHeight(220);
    ui.showModalDialog(html, 'File loyalty đã sẵn sàng');
  } finally {
    DriveApp.getFileById(tmp.getId()).setTrashed(true);
  }
}

/** Menu ✅: ask whether Haravan accepted everything or only part of the file. */
function confirmBatch() {
  var ui = SpreadsheetApp.getUi();
  var meta = requireOpenBatch_(ui);
  if (!meta) return;
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px sans-serif">' +
    '<p>Đợt <b>' + meta.batchId + '</b>. Haravan đã nhận file thế nào?</p>' +
    '<label><input type="radio" name="m" value="all" checked> Thành công toàn bộ</label><br>' +
    '<label><input type="radio" name="m" value="part"> Thành công một phần</label>' +
    '<p>Nếu một phần: dán <b>số điện thoại các dòng bị lỗi</b> (mỗi dòng một số):</p>' +
    '<textarea id="t" rows="6" style="width:100%"></textarea>' +
    '<p><button id="b" onclick="go()">Xác nhận</button> <span id="s"></span></p></div>' +
    '<script>function go(){var m=document.querySelector("input[name=m]:checked").value;' +
    'var t=document.getElementById("t").value;document.getElementById("b").disabled=true;' +
    'document.getElementById("s").textContent="Đang ghi...";' +
    'google.script.run.withSuccessHandler(function(r){document.getElementById("s").textContent=r;})' +
    '.withFailureHandler(function(e){document.getElementById("s").textContent="Lỗi: "+e.message;document.getElementById("b").disabled=false;})' +
    '.confirmBatchSubmit(m,t);}</script>').setWidth(440).setHeight(360);
  ui.showModalDialog(html, '✅ Xác nhận đã upload');
}

/** Called from the confirm dialog. Moves the batch's orders into the ledger (except failed phones) and closes it. */
function confirmBatchSubmit(mode, failedText) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) throw new Error('Đang có người xử lý, vui lòng chờ.');
  try {
    var meta = openBatch_();
    if (!meta) throw new Error('Không còn đợt nào đang mở.');
    var failed = { phones: [], invalid: [] };
    if (mode === 'part') {
      failed = parsePhoneList(failedText);
      if (failed.invalid.length) throw new Error('SĐT không hợp lệ: ' + failed.invalid.join(', '));
      if (!failed.phones.length) throw new Error('Hãy dán ít nhất một SĐT bị lỗi, hoặc chọn "Thành công toàn bộ".');
    }
    var pending = sheet_(SHEETS.PENDING);
    var rows = pending.getLastRow() > 1
      ? pending.getRange(2, 1, pending.getLastRow() - 1, HEADERS[SHEETS.LEDGER].length).getValues() : [];
    var split = splitPendingByFailed(rows, failed.phones);
    if (split.notInBatch.length) throw new Error('Các SĐT này không có trong đợt: ' + split.notInBatch.join(', '));

    var ledger = sheet_(SHEETS.LEDGER);
    var already = ledger.getLastRow() > 1 && ledger.getRange(2, 11, ledger.getLastRow() - 1, 1).getValues()
      .some(function (r) { return String(r[0]) === meta.batchId; });
    if (split.keep.length && !already) { // a retry after a half-finished confirm must not append twice
      var at = ledger.getLastRow() + 1;
      ledger.getRange(at, 1, split.keep.length, 3).setNumberFormat('@');
      ledger.getRange(at, 1, split.keep.length, split.keep[0].length).setValues(split.keep);
    }
    props_().setProperty(LAST_CONFIRM_KEY, new Date().toISOString());
    updateHistory_(meta.batchId, {
      7: failed.phones.length ? 'Đã upload một phần' : 'Đã upload', 8: userEmail_(), 9: nowText_(),
      10: failed.phones.join(', '),
    });
    clearBatchSheets_();
    props_().deleteProperty(OPEN_BATCH_KEY);
    try { writeReport(); } catch (e) { /* the confirm itself succeeded; 📊 can rebuild the report */ }
    return '✅ Đã ghi ' + split.keep.length + ' đơn vào "' + SHEETS.LEDGER + '"' +
      (split.failed.length ? '; ' + split.failed.length + ' đơn của khách lỗi sẽ được xét lại đợt sau.' : '.') +
      ' Có thể đóng hộp thoại.';
  } finally {
    lock.releaseLock();
  }
}

/** Menu ❌: discard the open batch (only when it was NOT uploaded). */
function cancelBatch() {
  var ui = SpreadsheetApp.getUi();
  var meta = requireOpenBatch_(ui);
  if (!meta) return;
  var ok = ui.alert('Huỷ đợt ' + meta.batchId, 'Bạn chắc chắn CHƯA upload file này lên Haravan?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) { ui.alert('Đang có người xử lý, vui lòng chờ.'); return; }
  try {
    clearBatchSheets_();
    updateHistory_(meta.batchId, { 7: 'Đã huỷ', 8: userEmail_(), 9: nowText_() });
    props_().deleteProperty(OPEN_BATCH_KEY);
  } finally {
    lock.releaseLock();
  }
  ui.alert('Đã huỷ đợt ' + meta.batchId + '. Sổ đơn đã tích không thay đổi.');
}
