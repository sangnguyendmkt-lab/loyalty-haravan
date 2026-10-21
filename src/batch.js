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
