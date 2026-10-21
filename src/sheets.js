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
  EXCLUDED: 'Đã loại',
  FORM_STATUS: 'Form + trạng thái',
};

var HEADERS = {};
HEADERS[SHEETS.SETTINGS] = ['Mục', 'Giá trị', 'Ghi chú'];
HEADERS[SHEETS.LEDGER] = ['Mã đơn', 'ID đơn Haravan', 'SĐT', 'Kênh', 'Thời gian khai', 'Ngày tạo đơn',
  'Giá trị sau giảm', 'Hạng', 'Hệ số', 'Điểm', 'Mã đợt', 'Nguồn'];
HEADERS[SHEETS.PENDING] = HEADERS[SHEETS.LEDGER];
HEADERS[SHEETS.HISTORY] = ['Mã đợt', 'Tạo lúc', 'Người tạo', 'Số khách', 'Số đơn', 'Tổng điểm', 'Trạng thái',
  'Người xác nhận/huỷ', 'Lúc xác nhận/huỷ', 'SĐT lỗi', 'File'];
HEADERS[SHEETS.REVIEW] = ['Dòng form', 'Thời gian khai', 'Kênh', 'SĐT', 'Mã đơn', 'Loại', 'Lý do',
  'Lần đầu thấy', 'Ghi chú', 'Số đợt ✅ không thấy'];
HEADERS[SHEETS.EXCLUDED] = ['Khoá (dòng form|mã)', 'Ngày loại'];
HEADERS[SHEETS.FORM_STATUS] = ['Dòng form', 'Thời gian khai', 'Kênh', 'Họ tên', 'SĐT', 'Email', 'Mã đơn',
  'Trạng thái', 'Ngày xử lý', 'Chi tiết'];
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
  ['Báo cáo từ tháng', "'01/2026", 'Sheet Báo cáo bỏ các tháng trước tháng này (MM/yyyy)'],
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

/** "01/2026", "2026-01" or a date cell -> "yyyy-MM"; fallback when blank or unreadable. */
function monthSetting_(v, fallback) {
  if (v instanceof Date && !isNaN(v.getTime())) return vnMonthKey(v);
  var t = String(v === null || v === undefined ? '' : v).trim();
  var m = /^(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return m[2] + '-' + ('0' + m[1]).slice(-2);
  m = /^(\d{4})-(\d{2})/.exec(t);
  return m ? m[1] + '-' + m[2] : fallback;
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
    reportFromMonth: monthSetting_(byLabel['Báo cáo từ tháng'], '2026-01'),
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
      it.kind === 'warn' ? 'Cần xem' : 'Đang chờ', it.reason, old ? old[7] : todayKey, old ? old[8] : '',
      it.reason === REASONS.NOT_FOUND && old ? Number(old[9]) || 0 : 0];
  });
}

/** Review reasons dropped for good at the first ✅, and how many ✅ batches a "not found" code survives. */
var EXCLUDE_AT_CONFIRM = [REASONS.PHONE_INVALID, REASONS.TAKEN_BY_OTHER, REASONS.NOT_MARKETPLACE, REASONS.VOIDED];
var NOT_FOUND_CONFIRM_LIMIT = 5;

/** Key of one claimed code, the same for review rows and expanded submissions. */
function claimKey(row, code) { return String(row) + '|' + normalizeCode(code); }

/**
 * On ✅: "not found" rows count one more confirmed batch; rows with an EXCLUDE_AT_CONFIRM reason, or not
 * found NOT_FOUND_CONFIRM_LIMIT times, leave "Cần kiểm tra" for good. Returns {keep: rows, excluded: keys}.
 */
function planReviewOnConfirm(rows) {
  var keep = [], excluded = [];
  rows.forEach(function (r) {
    var reason = String(r[6]);
    if (EXCLUDE_AT_CONFIRM.indexOf(reason) >= 0) { excluded.push(claimKey(r[0], r[4])); return; }
    if (reason === REASONS.NOT_FOUND) {
      var n = (Number(r[9]) || 0) + 1;
      if (n >= NOT_FOUND_CONFIRM_LIMIT) { excluded.push(claimKey(r[0], r[4])); return; }
      r = r.slice(); r[9] = n;
    }
    keep.push(r);
  });
  return { keep: keep, excluded: excluded };
}

/** Ledger batch id -> processing day "dd/MM/yyyy" ("20261021-2242" or "CU-08/01/2026"). */
function batchDay_(batchId) {
  var m = /^(\d{4})(\d{2})(\d{2})-/.exec(batchId);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  m = /^CU-(\d{2}\/\d{2}\/\d{4})$/.exec(batchId);
  return m ? m[1] : '';
}

/**
 * Form answers + where each one stands, one row per form row. A code is Done when the ledger holds it
 * (or the whole cell, for migrated rows) for this row's phone; otherwise it takes its "Cần kiểm tra"
 * status, "Đã loại", or stays blank (not evaluated yet). Several codes: "Done k/n" until all are done.
 */
function formStatusRows(submissions, ledger, reviewRows, excludedKeys) {
  var done = new Map(); // code -> [{phone, day}]
  ledger.forEach(function (e) {
    if (!done.has(e.code)) done.set(e.code, []);
    done.get(e.code).push({ phone: e.phone, day: batchDay_(e.batchId) });
  });
  var review = new Map();
  reviewRows.forEach(function (r) { review.set(claimKey(r[0], r[4]), { kind: String(r[5]), reason: String(r[6]) }); });
  function doneDay(code, phone) {
    var hit = (done.get(code) || []).filter(function (x) { return x.phone === phone; })[0];
    return hit ? hit.day || '?' : null;
  }
  return submissions.slice().sort(function (a, b) { return a.row - b.row; }).map(function (s) {
    var phone = normalizePhone(s.phoneRaw) || '';
    var codes = splitCodes(s.codeRaw);
    var wholeDay = doneDay(normalizeCode(s.codeRaw), phone);
    var days = [], notes = [];
    codes.forEach(function (code) {
      var day = wholeDay || doneDay(code, phone);
      if (day) { days.push(day); return; }
      var key = claimKey(s.row, code), rv = review.get(key);
      var note = rv ? rv.kind + ': ' + rv.reason : excludedKeys.has(key) ? 'Đã loại' : 'Chưa xét';
      notes.push(codes.length > 1 ? code + ' – ' + note : note);
    });
    var status;
    if (codes.length && days.length === codes.length) status = 'Done';
    else if (days.length) status = 'Done ' + days.length + '/' + codes.length;
    else if (codes.length === 1 && notes.length) status = notes[0].split(':')[0];
    else status = notes.length ? 'Chưa xong' : '';
    var lastDay = days.sort(function (a, b) {
      var k = function (d) { return d.split('/').reverse().join(''); };
      return k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0;
    }).pop() || '';
    var ts = parseFormTimestamp(s.timestamp);
    return [s.row, ts ? formatIsoVN(ts).slice(0, 19).replace('T', ' ') : String(s.timestamp || ''), s.channel, s.name,
      String(s.phoneRaw === null || s.phoneRaw === undefined ? '' : s.phoneRaw), s.email,
      String(s.codeRaw === null || s.codeRaw === undefined ? '' : s.codeRaw), status, lastDay,
      codes.length === 1 && status !== 'Done' ? notes[0].replace(/^[^:]*: /, '') : notes.join('\n')];
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

var REPORT_COLS = ['Số đơn', 'Trong đó đang chờ', 'Số khách', 'Điểm thưởng'];
var REPORT_WIDTH = 1 + REPORT_COLS.length * REPORT_CHANNELS.length;

/**
 * "Cần kiểm tra" rows still waiting (Loại "Đang chờ": not delivered yet / waiting days) -> pending report
 * entries {code, phone, channel, claimedAt, pending}. "Thời gian khai" is Vietnam time "yyyy-MM-dd HH:mm:ss".
 */
function reviewRowsToPendingEntries(reviewRows) {
  return reviewRows.filter(function (r) { return String(r[5]) === 'Đang chờ' && normalizeCode(r[4]); }).map(function (r) {
    var t = String(r[1] || '');
    var claimedAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(t) ? new Date(t.replace(' ', 'T') + '+07:00') : toDateOrNull_(r[1]);
    return { code: normalizeCode(r[4]), phone: normalizePhone(r[3]) || String(r[3] || ''), channel: String(r[2] || ''),
      claimedAt: claimedAt, orderCreatedAt: null, points: 0, pending: true };
  });
}

/**
 * Order-cache rows -> orders placed per channel and month (Haravan "Ngày tạo"), cancelled/returned left out:
 * {channel: {"yyyy-MM": n}}. Months before fromMonth are skipped. Pass `out` to add to earlier counts.
 */
function placedOrdersByMonth(orderRows, fromMonth, out) {
  out = out || {};
  REPORT_CHANNELS.forEach(function (ch) { out[ch] = out[ch] || {}; });
  orderRows.forEach(function (r) {
    var o = rowToOrder(r);
    if (o.voided) return;
    var ch = REPORT_CHANNELS.filter(function (c) { return o.source.toLowerCase().indexOf(c.toLowerCase()) !== -1; })[0];
    var m = vnMonthKey(o.createdAt);
    if (!ch || m === UNKNOWN_MONTH || (fromMonth && m < fromMonth)) return;
    out[ch][m] = (out[ch][m] || 0) + 1;
  });
  return out;
}

/** How to read the report, written beside the tables (column K). Lines starting with "#" are headings. */
var REPORT_GUIDE = [
  '# HƯỚNG DẪN ĐỌC BÁO CÁO',
  '',
  '# Chung',
  '• Đếm mọi đơn KHÁCH ĐÃ ĐIỀN FORM và khớp đơn thật trên Haravan: đã tích điểm + đang chờ (chờ giao, chờ đủ ngày, đợt chưa ✅).',
  '• Không đếm: mã không tìm thấy, SĐT sai, đơn huỷ/hoàn, đơn người khác đã tích, đơn không phải Shopee/TikTok.',
  '• Số đơn = số đơn khách đã điền form. Trong đó đang chờ = phần chưa được tích điểm (sẽ tích khi đủ điều kiện, hoặc rơi ra nếu huỷ/hoàn).',
  '• Số khách = số SĐT khác nhau (1 khách nhiều đơn chỉ đếm 1). Điểm thưởng = chỉ điểm ĐÃ cộng thật (đơn đang chờ chưa có điểm).',
  '• Cột Số khách KHÔNG cộng dọc theo tháng được: khách mua nhiều tháng được đếm ở mỗi tháng; dòng Tổng cộng đếm mỗi khách 1 lần.',
  '• Đơn đang chờ lấy theo lần Tạo đợt gần nhất: form khách vừa điền sau lần đó sẽ vào báo cáo ở lần Tạo đợt sau.',
  '• Chỉ hiện từ tháng ghi ở Cài đặt "Báo cáo từ tháng". Đơn không xác định được ngày thì không đưa vào.',
  '• Tự cập nhật sau mỗi lần ✅ Xác nhận đã upload; bấm 🎯 Loyalty → 📊 để cập nhật tay (bấm 🔄 trước để có trạng thái huỷ/hoàn mới nhất).',
  '',
  '# Bảng 1 – Theo tháng khách ĐẶT ĐƠN',
  '• Mỗi đơn được xếp vào tháng của ngày tạo đơn trên Haravan.',
  '• Trả lời câu hỏi: "Đơn đặt trong tháng X, đến nay khách đã điền form bao nhiêu đơn?"',
  '• Ví dụ: dòng 01/2026, Shopee – Số đơn 402: khách đã điền form cho 402 đơn Shopee đặt trong tháng 1, dù điền ngay trong tháng 1 hay muộn hơn.',
  '',
  '# Bảng 2 – Theo tháng khách ĐIỀN FORM',
  '• Mỗi đơn được xếp vào tháng khách điền form tích điểm.',
  '• Trả lời câu hỏi: "Trong tháng X, khách đã điền form bao nhiêu đơn?" → dùng để xem việc điền form có tăng trưởng theo tháng không.',
  '• Ví dụ: dòng 01/2026, Shopee – Số đơn 387: trong tháng 1 khách đã khai 387 đơn Shopee, gồm cả đơn đặt từ các tháng trước.',
  '',
  '# So sánh 2 bảng',
  '• Hai bảng đếm cùng những đơn, chỉ khác cách xếp vào tháng.',
  '• Tổng cộng bảng 1 thường thấp hơn bảng 2: bảng 1 bỏ các đơn ĐẶT trước "Báo cáo từ tháng", dù khách vẫn khai chúng trong kỳ báo cáo.',
  '• Ở cùng một tháng: bảng 1 > bảng 2 → nhiều đơn của tháng đó được khai muộn sang tháng sau; bảng 2 > bảng 1 → trong tháng đó khách khai bù nhiều đơn cũ.',
  '',
  '# Bảng 3 – Tháng ĐẶT × tháng ĐIỀN FORM (mỗi kênh 1 bảng, phía dưới)',
  '• Mỗi dòng là 1 tháng đặt đơn, mỗi cột là 1 tháng khách điền form; ô = số đơn khách đã điền form (gồm đang chờ).',
  '• Đọc theo dòng: dòng 01/2026 cho biết đơn đặt tháng 1 được khách khai vào tháng 1, tháng 2, tháng 3... bao nhiêu đơn.',
  '• Ví dụ Shopee: dòng 01/2026, cột 01/2026 = 333 → khai ngay trong tháng; cột 02/2026 = 49 → khai muộn sang tháng 2.',
  '• Cột Tổng (cuối dòng) = Số đơn của tháng đó ở bảng 1 (trừ vài đơn không rõ ngày điền form). Dòng Tổng cộng (cuối bảng) = số đơn khai trong từng tháng, chỉ tính đơn đặt từ "Báo cáo từ tháng".',
  '• Tổng đơn phát sinh = số đơn của kênh tạo trong tháng trên Haravan, trừ đơn huỷ/hoàn (khách điền form hay chưa).',
  '• Tỷ lệ điền form trong tháng = đơn khai ngay trong tháng đặt ÷ cột Tổng. Ví dụ 333 ÷ 402 = 82,84%.',
  '• Tỷ lệ điền form / đơn phát sinh = cột Tổng ÷ Tổng đơn phát sinh: bao nhiêu % đơn của tháng đã được khách điền form (tính cả khai muộn).',
  '• Ô trống = 0 đơn.',
];

var CROSS_EXTRA = ['Tổng đơn phát sinh (trừ huỷ/hoàn)', 'Tỷ lệ điền form trong tháng', 'Tỷ lệ điền form / đơn phát sinh'];

/** buildReport() output -> rows for the "Báo cáo" sheet: two tables (by order month, by form month). */
function reportToRows(report) {
  var rows = [];
  function pad(r) { while (r.length < REPORT_WIDTH) r.push(''); return r; }
  function label(m) { return m === UNKNOWN_MONTH ? m : m.slice(5, 7) + '/' + m.slice(0, 4); }
  function line(first, byCh) {
    var r = [first];
    REPORT_CHANNELS.forEach(function (ch) { r.push(byCh[ch].orders, byCh[ch].pending, byCh[ch].customers, byCh[ch].points); });
    return r;
  }
  [[report.byOrder, 'Theo tháng khách ĐẶT ĐƠN (ngày tạo đơn trên Haravan)'],
   [report.byClaim, 'Theo tháng khách ĐIỀN FORM tích điểm']].forEach(function (t, k) {
    if (k) rows.push(pad([]));
    rows.push(pad([t[1]]));
    var h1 = ['Tháng'], h2 = [''];
    REPORT_CHANNELS.forEach(function (ch) { h1.push(ch, '', '', ''); h2.push.apply(h2, REPORT_COLS); });
    rows.push(h1, h2);
    t[0].months.forEach(function (m) { rows.push(line(label(m), t[0].cells[m])); });
    rows.push(line('Tổng cộng', t[0].total));
  });
  // Cross tables go below the reading guide (column I) so the two never overlap.
  var x = report.cross;
  if (x && x.orderMonths.length) {
    while (rows.length < REPORT_GUIDE.length + 1) rows.push(pad([]));
    REPORT_CHANNELS.forEach(function (ch) {
      rows.push(pad([]));
      rows.push([ch + ': đơn ĐẶT trong tháng (dòng) × tháng khách ĐIỀN FORM (cột) – số đơn khách đã điền form (gồm đang chờ)']);
      rows.push(['Tháng đặt ↓ / điền →'].concat(x.claimMonths.map(label), ['Tổng'].concat(CROSS_EXTRA)));
      var placedByMonth = (report.placed || {})[ch] || {};
      function ratio(a, b) { return b ? a / b : ''; }
      var colTotals = x.claimMonths.map(function () { return 0; }), all = 0, sameMonthAll = 0, placedAll = 0;
      x.orderMonths.forEach(function (om) {
        var byClaim = x.cells[ch][om] || {}, sum = 0;
        var r = [label(om)].concat(x.claimMonths.map(function (cm, i) {
          var n = byClaim[cm] || 0;
          sum += n; colTotals[i] += n;
          return n || '';
        }));
        var same = byClaim[om] || 0, placed = placedByMonth[om] || 0;
        all += sum; sameMonthAll += same; placedAll += placed;
        rows.push(r.concat([sum || '', placed || '', ratio(same, sum), ratio(sum, placed)]));
      });
      rows.push(['Tổng cộng'].concat(colTotals.map(function (n) { return n || ''; }),
        [all || '', placedAll || '', ratio(sameMonthAll, all), ratio(all, placedAll)]));
    });
  }
  var width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, REPORT_WIDTH);
  return rows.map(function (r) { while (r.length < width) r.push(''); return r; });
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
    if (name === SHEETS.ORDERS || name === SHEETS.PENDING || name === SHEETS.EXCLUDED) sh.hideSheet();
    if (name === SHEETS.EXCLUDED) sh.getRange('A:A').setNumberFormat('@');
    if (name === SHEETS.FORM_STATUS) sh.setFrozenRows(1);
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
function writeReport() {
  ensureSetting_('Báo cáo từ tháng');
  var settings = readSettings();
  var ledger = readLedger();
  var orderDates = backfillLedgerOrderDates_(ledger);
  // Claimed but not credited yet: still waiting in "Cần kiểm tra", or in the batch not confirmed yet.
  var credited = new Set(ledger.map(function (e) { return e.code; }));
  var pending = readPendingClaims_().filter(function (e) {
    if (!e.code || credited.has(e.code)) return false;
    credited.add(e.code);
    return true;
  });
  var waitingCodes = new Set(pending.filter(function (e) { return !e.orderCreatedAt; }).map(function (e) { return e.code; }));
  var placed = {};
  forEachOrderChunk_(function (chunk) {
    placedOrdersByMonth(chunk, settings.reportFromMonth, placed);
    if (!waitingCodes.size) return;
    filterOrderRowsByCodes(chunk, waitingCodes).forEach(function (r) {
      var o = rowToOrder(r);
      [o.name, o.marketplaceCode, o.partnerTrackingCode].forEach(function (c) {
        c = normalizeCode(c);
        if (c && waitingCodes.has(c) && o.createdAt) orderDates.set(c, o.createdAt);
      });
    });
  });
  var report = buildReport(ledger.concat(pending), orderDates, settings.reportFromMonth);
  report.placed = placed;
  var rows = reportToRows(report);
  var sh = sheet_(SHEETS.REPORT);
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  var width = rows[0].length;
  // Month labels stay text ("01/2026"), otherwise Sheets turns them into dates.
  sh.getRange(1, 1, rows.length, 1).setNumberFormat('@');
  rows.forEach(function (r, i) { if (/^Tháng đặt ↓/.test(r[0])) sh.getRange(i + 1, 1, 1, width).setNumberFormat('@'); });
  sh.getRange(1, 1, rows.length, width).setValues(rows);
  sh.getRange(1, 2, rows.length, width - 1).setNumberFormat('#,##0').setHorizontalAlignment('right');
  // The number format above turns "01/2026" header text back into dates: set those rows as text again.
  rows.forEach(function (r, i) {
    if (/^Tháng đặt ↓/.test(r[0])) sh.getRange(i + 1, 1, 1, width).setNumberFormat('@').setValues([r]);
  });
  for (var c = 2; c <= width; c++) if (sh.getColumnWidth(c) < 70) sh.setColumnWidth(c, 70);
  var tableWidth = REPORT_WIDTH;
  rows.forEach(function (r, i) {
    var at = i + 1;
    if (/^Tháng đặt ↓/.test(r[0])) {
      sh.getRange(at, 1, 1, tableWidth).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#dbe5f1').setWrap(true);
      var bodyRows = 0;
      while (rows[i + 1 + bodyRows] && rows[i + 1 + bodyRows][0] !== '') bodyRows++;
      sh.getRange(at + 1, tableWidth - 1, bodyRows, 2).setNumberFormat('0.00%');
    } else if (REPORT_CHANNELS.some(function (ch) { return r[0].indexOf(ch + ':') === 0; })) {
      tableWidth = rows[i + 1].filter(String).length;
      var bg = { Shopee: '#ee4d2d', Tiktok: '#111111' }[r[0].split(':')[0]] || '#666666';
      sh.getRange(at, 1, 1, tableWidth).merge().setBackground(bg).setFontColor('#ffffff').setFontWeight('bold');
    } else if (/^Theo tháng/.test(r[0])) {
      sh.getRange(at, 1, 1, REPORT_WIDTH).merge().setBackground('#1f3864').setFontColor('#ffffff').setFontWeight('bold');
    } else if (r[0] === 'Tháng') {
      sh.getRange(at, 1, 2, 1).merge().setVerticalAlignment('middle');
      sh.getRange(at, 1, 2, REPORT_WIDTH).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#dbe5f1');
      var colors = { Shopee: '#ee4d2d', Tiktok: '#111111' };
      REPORT_CHANNELS.forEach(function (ch, c) {
        sh.getRange(at, 2 + REPORT_COLS.length * c, 1, REPORT_COLS.length).merge().setBackground(colors[ch] || '#666666').setFontColor('#ffffff');
      });
    } else if (r[0] === 'Tổng cộng') {
      sh.getRange(at, 1, 1, tableWidth).setFontWeight('bold').setBackground('#c9daf8');
    }
  });
  sh.getRange(1, 1, rows.length, 1).setHorizontalAlignment('center');
  // Guide beside the tables; no wrap so the table rows keep their height (the text runs over empty columns).
  var guideCol = REPORT_WIDTH + 2;
  sh.getRange(1, guideCol, REPORT_GUIDE.length, 1)
    .setValues(REPORT_GUIDE.map(function (t) { return [t.replace(/^# /, '')]; })).setWrap(false)
    .setHorizontalAlignment('left').setNumberFormat('@');
  REPORT_GUIDE.forEach(function (t, i) { if (/^# /.test(t)) sh.getRange(i + 1, guideCol).setFontWeight('bold').setFontColor('#1f3864'); });
}

/**
 * Ledger entries without an order date (migrated from the old file) take Haravan's "Ngày tạo" from the
 * order cache, looked up by code; found dates are also written into the ledger's blank "Ngày tạo đơn"
 * cells, so they survive once the cache drops orders older than its retention. Returns Map<code, Date>.
 */
function backfillLedgerOrderDates_(ledger) {
  var missing = new Set(ledger.filter(function (e) { return !e.orderCreatedAt && e.code; }).map(function (e) { return e.code; }));
  var found = new Map();
  if (!missing.size) return found;
  readOrdersForCodes(missing).forEach(function (o) {
    if (!o.createdAt) return;
    [o.name, o.marketplaceCode, o.partnerTrackingCode].forEach(function (c) {
      c = normalizeCode(c);
      if (c && missing.has(c)) found.set(c, o.createdAt);
    });
  });
  if (!found.size) return found;
  var sh = sheet_(SHEETS.LEDGER);
  var last = sh.getLastRow();
  var codes = sh.getRange(2, 1, last - 1, 1).getValues();
  var range = sh.getRange(2, 6, last - 1, 1);
  var dates = range.getValues();
  var changed = false;
  codes.forEach(function (r, i) {
    var d = found.get(normalizeCode(r[0]));
    if (d && dates[i][0] === '') { dates[i][0] = d; changed = true; }
  });
  if (changed) range.setValues(dates);
  return found;
}

/** Pending report entries: "Cần kiểm tra" rows still waiting, plus the open batch's orders (not confirmed yet). */
function readPendingClaims_() {
  var out = [];
  var r = sheet_(SHEETS.REVIEW);
  if (r.getLastRow() > 1) {
    out = reviewRowsToPendingEntries(r.getRange(2, 1, r.getLastRow() - 1, HEADERS[SHEETS.REVIEW].length).getValues());
  }
  var p = sheet_(SHEETS.PENDING);
  if (p.getLastRow() > 1) {
    p.getRange(2, 1, p.getLastRow() - 1, HEADERS[SHEETS.PENDING].length).getValues().forEach(function (row) {
      if (String(row[0]).trim() === '') return;
      var e = rowToLedger(row);
      e.pending = true;
      out.push(e);
    });
  }
  return out;
}

/** Calls fn with the order cache rows, 20,000 at a time. */
function forEachOrderChunk_(fn) {
  var sh = sheet_(SHEETS.ORDERS);
  var last = sh.getLastRow();
  var width = HEADERS[SHEETS.ORDERS].length;
  for (var start = 2; start <= last; start += 20000) {
    fn(sh.getRange(start, 1, Math.min(20000, last - start + 1), width).getValues());
  }
}

/** Add a SETTINGS_DEFAULTS row missing from an older "Cài đặt" sheet. */
function ensureSetting_(label) {
  var sh = sheet_(SHEETS.SETTINGS);
  var last = sh.getLastRow();
  var labels = last < 2 ? [] : sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); });
  if (labels.indexOf(label) >= 0) return;
  var row = SETTINGS_DEFAULTS.filter(function (r) { return r[0] === label; })[0];
  if (row) sh.getRange(last + 1, 1, 1, 3).setValues([row]);
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
  REPORT_GUIDE: REPORT_GUIDE,
  placedOrdersByMonth: placedOrdersByMonth,
  reviewRowsToPendingEntries: reviewRowsToPendingEntries,
  creditsToLedgerRows: creditsToLedgerRows,
  reviewToRows: reviewToRows,
  claimKey: claimKey,
  planReviewOnConfirm: planReviewOnConfirm,
  formStatusRows: formStatusRows,
  NOT_FOUND_CONFIRM_LIMIT: NOT_FOUND_CONFIRM_LIMIT,
  batchSummaryRows: batchSummaryRows,
  rowToOrder: rowToOrder,
};
