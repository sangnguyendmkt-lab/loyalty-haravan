const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../src/rules.js');
const { reportToRows } = require('../src/sheets.js');

test('reportToRows lays out the order-month table then the form-month table, Shopee | Tiktok', () => {
  const rows = reportToRows(buildReport([{ code: 'A', phone: '0901', channel: 'Shopee',
    claimedAt: new Date('2026-02-10T03:00:00Z'), orderCreatedAt: new Date('2026-01-10T03:00:00Z'), points: 15 }]));
  rows.forEach(r => assert.equal(r.length, 9));
  assert.match(rows[0][0], /ĐẶT ĐƠN/);
  assert.deepEqual(rows[1], ['Tháng', 'Shopee', '', '', '', 'Tiktok', '', '', '']);
  assert.deepEqual(rows[2], ['', 'Số đơn', 'Trong đó đang chờ', 'Số khách', 'Điểm thưởng', 'Số đơn', 'Trong đó đang chờ', 'Số khách', 'Điểm thưởng']);
  assert.deepEqual(rows[3], ['01/2026', 1, 0, 1, 15, 0, 0, 0, 0]);
  assert.deepEqual(rows[4], ['Tổng cộng', 1, 0, 1, 15, 0, 0, 0, 0]);
  assert.deepEqual(rows[5], ['', '', '', '', '', '', '', '', '']);
  assert.match(rows[6][0], /ĐIỀN FORM/);
  assert.deepEqual(rows[9], ['02/2026', 1, 0, 1, 15, 0, 0, 0, 0]);
  assert.match(rows.find(r => /^Shopee:/.test(r[0]))[0], /ĐẶT.*ĐIỀN FORM/);
});

test('reportToRows adds one order-month x form-month table per channel below the guide', () => {
  const d = s => new Date(s + 'T03:00:00Z');
  const ledger = [
    { code: 'A', phone: '0901', channel: 'Shopee', orderCreatedAt: d('2026-01-05'), claimedAt: d('2026-01-20'), points: 1 },
    { code: 'B', phone: '0902', channel: 'Shopee', orderCreatedAt: d('2026-01-25'), claimedAt: d('2026-03-02'), points: 1 },
    { code: 'C', phone: '0903', channel: 'Tiktok', orderCreatedAt: d('2026-02-01'), claimedAt: d('2026-02-03'), points: 1 },
    { code: 'D', phone: '0904', channel: 'Shopee', orderCreatedAt: d('2025-12-20'), claimedAt: d('2026-01-03'), points: 1 },
    { code: 'E', phone: '0905', channel: 'Shopee', orderCreatedAt: d('2026-01-09'), claimedAt: null, points: 1 },
  ];
  const report = buildReport(ledger, new Map(), '2026-01');
  assert.deepEqual(report.cross.orderMonths, ['2026-01', '2026-02']);
  assert.deepEqual(report.cross.claimMonths, ['2026-01', '2026-02', '2026-03']);
  const rows = reportToRows(report);
  const width = rows[0].length;
  rows.forEach(r => assert.equal(r.length, width));
  const at = rows.findIndex(r => /^Shopee:/.test(r[0]));
  assert.ok(at > require('../src/sheets.js').REPORT_GUIDE.length);
  assert.deepEqual(rows[at + 1].slice(0, 5), ['Tháng đặt ↓ / điền →', '01/2026', '02/2026', '03/2026', 'Tổng']);
  assert.deepEqual(rows[at + 2].slice(0, 5), ['01/2026', 1, '', 1, 2]);
  assert.deepEqual(rows[at + 3].slice(0, 5), ['02/2026', '', '', '', '']);
  assert.deepEqual(rows[at + 4].slice(0, 5), ['Tổng cộng', 1, '', 1, 2]);
  const tk = rows.findIndex(r => /^Tiktok:/.test(r[0]));
  assert.deepEqual(rows[tk + 3].slice(0, 5), ['02/2026', '', 1, '', 1]);
});

test('placedOrdersByMonth counts non-voided orders per channel and month', () => {
  const { placedOrdersByMonth } = require('../src/sheets.js');
  const row = (created, voided, source) => ['1', '#1', '', '', created, '', 'FALSE', voided, 0, '', '', source];
  const out = placedOrdersByMonth([
    row('2026-01-10T03:00:00Z', 'FALSE', 'shopee'),
    row('2026-01-11T03:00:00Z', 'TRUE', 'shopee'),
    row('2026-01-12T03:00:00Z', 'FALSE', 'Tiktok Shop'),
    row('2025-12-12T03:00:00Z', 'FALSE', 'shopee'),
    row('2026-01-12T03:00:00Z', 'FALSE', 'web'),
  ], '2026-01');
  assert.deepEqual(out, { Shopee: { '2026-01': 1 }, Tiktok: { '2026-01': 1 } });
});

test('cross table adds placed orders and the two rates after Tổng', () => {
  const d = s => new Date(s + 'T03:00:00Z');
  const ledger = [
    { code: 'A', phone: '1', channel: 'Shopee', orderCreatedAt: d('2026-01-05'), claimedAt: d('2026-01-20'), points: 1 },
    { code: 'B', phone: '2', channel: 'Shopee', orderCreatedAt: d('2026-01-25'), claimedAt: d('2026-02-02'), points: 1 },
  ];
  const report = buildReport(ledger, new Map(), '2026-01');
  report.placed = { Shopee: { '2026-01': 8 }, Tiktok: {} };
  const rows = reportToRows(report);
  const at = rows.findIndex(r => /^Shopee:/.test(r[0]));
  assert.deepEqual(rows[at + 1].slice(3, 7), ['Tổng', 'Tổng đơn phát sinh (trừ huỷ/hoàn)', 'Tỷ lệ điền form trong tháng', 'Tỷ lệ điền form / đơn phát sinh']);
  assert.deepEqual(rows[at + 2].slice(0, 7), ['01/2026', 1, 1, 2, 8, 0.5, 0.25]);
  assert.deepEqual(rows[at + 3].slice(0, 7), ['Tổng cộng', 1, 1, 2, 8, 0.5, 0.25]);
});

test('reviewRowsToPendingEntries keeps only waiting rows and reads Vietnam time', () => {
  const { reviewRowsToPendingEntries } = require('../src/sheets.js');
  const out = reviewRowsToPendingEntries([
    [5, '2026-10-01 06:30:00', 'Shopee', '0901234567', 'abc123456789', 'Đang chờ', 'Chờ giao', '', '', 0],
    [6, '2026-10-01 06:30:00', 'Shopee', '0901234567', 'XYZ123456789', 'Cần xem', 'Không tìm thấy', '', '', 1],
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].code, 'ABC123456789');
  assert.equal(out[0].pending, true);
  assert.equal(out[0].claimedAt.toISOString(), '2026-09-30T23:30:00.000Z');
});
