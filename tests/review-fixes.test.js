const test = require('node:test');
const assert = require('node:assert/strict');
const { REASONS, buildOrderIndex, evaluateSubmissions } = require('../src/rules.js');
const { customersFromSheetRows, toOrder } = require('../src/haravan.js');
const { parseSettingsRows } = require('../src/sheets.js');

const settings = { vndPerPoint: 100000, multipliers: { Silver: 1, Gold: 3, Platinum: 5 }, waitDays: 15 };
const NOW = new Date('2026-10-20T05:00:00Z');
const order = {
  id: '77', name: '241020ABC', marketplaceCode: '241020ABC', partnerTrackingCode: 'SPXVN123', source: 'shopee',
  createdAt: new Date('2026-09-01T00:00:00Z'), deliveredAt: new Date('2026-09-20T00:00:00Z'), delivered: true,
  voided: false, valueAfterDiscount: 1000000, province: '',
};
let row = 3;
const sub = (ts, phone, code) => ({ row: row++, timestamp: ts, channel: 'Shopee', name: 'A', phoneRaw: phone, email: '', codeRaw: code });
const run = (subs, ledger, orders) => evaluateSubmissions(subs, ledger || [], buildOrderIndex(orders || [order]), new Map(), settings, NOW);

test('C1: same order claimed via marketplace code and tracking code in one batch is credited once', () => {
  const r = run([sub('01/10/2026 10:00:00', '0901111111', '241020abc'), sub('01/10/2026 11:00:00', '0902222222', 'spxvn123')]);
  assert.equal(r.credits.length, 1);
  assert.deepEqual(r.review.map(x => x.reason), [REASONS.TAKEN_BY_OTHER]);
});

test('C1: same customer claiming one order with both codes is credited once, silently', () => {
  const r = run([sub('01/10/2026 10:00:00', '0901111111', '241020abc'), sub('01/10/2026 11:00:00', '0901111111', 'spxvn123')]);
  assert.equal(r.credits.length, 1);
  assert.equal(r.review.length, 0);
});

test('C1: order already in ledger under its marketplace code is not credited again via tracking code', () => {
  const r = run([sub('01/10/2026 10:00:00', '0902222222', 'SPXVN123')], [{ code: '241020ABC', orderId: '', phone: '0901111111' }]);
  assert.equal(r.credits.length, 0);
  assert.deepEqual(r.review.map(x => x.reason), [REASONS.TAKEN_BY_OTHER]);
});

test('C1: order already in ledger by order id is not credited again under another code', () => {
  const r = run([sub('01/10/2026 10:00:00', '0901111111', '241020ABC')], [{ code: 'SPXVN123', orderId: '77', phone: '0901111111' }]);
  assert.equal(r.credits.length, 0);
  assert.equal(r.review.length, 0);
});

test('I1: non-Shopee/TikTok orders (website, Lazada) are not credited', () => {
  const r = run([sub('01/10/2026 10:00:00', '0901111111', '241020ABC')], [], [Object.assign({}, order, { source: 'web' })]);
  assert.equal(r.credits.length, 0);
  assert.deepEqual(r.review.map(x => x.reason), [REASONS.NOT_MARKETPLACE]);
  const t = run([sub('01/10/2026 10:00:00', '0901111111', '241020ABC')], [], [Object.assign({}, order, { source: 'tiktokshop' })]);
  assert.equal(t.credits.length, 1);
});

test('I1: toOrder keeps the order source', () => {
  assert.equal(toOrder({ id: 1, name: 'X', source_name: 'Shopee', fulfillments: [] }).source, 'shopee');
  assert.equal(toOrder({ id: 1, name: 'X', source: 'lazada', fulfillments: [] }).source, 'lazada');
});

const HEADER = ['Họ và tên', 'Số điện thoại', 'Email', 'Tỉnh/Thành phố', 'Tổng chi tiêu',
  'Chi tiêu tích luỹ trong kỳ', 'Hạng thành viên', 'Điểm thưởng', 'Ngày đặt hàng cuối cùng'];

test('C2: a missing required customer column stops the run', () => {
  const h = HEADER.slice(); h[7] = 'Điểm tích lũy';
  assert.throws(() => customersFromSheetRows([h, ['A', '0901111111', '', '', 0, 0, '', 5, '']]), /Điểm thưởng/);
});

test('C2: "lũy" spelling and NFD-encoded headers are accepted', () => {
  const h = HEADER.slice(); h[5] = 'Chi tiêu tích lũy trong kỳ'.normalize('NFD');
  const m = customersFromSheetRows([h, ['A', '0901111111', '', '', 100, 50, '', 5, '']]);
  assert.equal(m.get('0901111111').periodSpent, 50);
});

test('C2: unparseable numbers stop the run instead of becoming 0; dotted thousands are read', () => {
  assert.throws(() => customersFromSheetRows([HEADER, ['A', '0901111111', '', '', 'abc', 0, '', 5, '']]), /Tổng chi tiêu/);
  const m = customersFromSheetRows([HEADER, ['A', '0901111111', '', '', '4.340.000', '1,314,999', '', 5, '']]);
  assert.deepEqual([m.get('0901111111').totalSpent, m.get('0901111111').periodSpent], [4340000, 1314999]);
});

test('I2: customer last order date as text is read day-first', () => {
  const m = customersFromSheetRows([HEADER, ['A', '0901111111', '', '', 0, 0, '', 0, '05/10/2026 10:00']]);
  assert.equal(m.get('0901111111').lastOrderAt.toISOString(), '2026-10-05T03:00:00.000Z');
  assert.throws(() => customersFromSheetRows([HEADER, ['A', '0901111111', '', '', 0, 0, '', 0, 'hôm qua']]), /Ngày đặt hàng/);
});

test('I3: a phone appearing twice in the pasted export stops the run', () => {
  assert.throws(() => customersFromSheetRows([HEADER,
    ['A', '0901111111', '', '', 0, 0, '', 5, ''], ['A', '901111111', '', '', 0, 0, '', 9, '']]), /0901111111/);
});

test('M1: blank or invalid wait days falls back to 15', () => {
  assert.equal(parseSettingsRows([['Số ngày chờ sau giao', '']]).waitDays, 15);
  assert.equal(parseSettingsRows([['Số ngày chờ sau giao', 0]]).waitDays, 0);
});

const { customersFreshness } = require('../src/rules.js');

test('C3: customer export must be pasted today and after the last confirmed upload', () => {
  const now = new Date('2026-10-21T08:00:00Z');
  assert.equal(customersFreshness(null, null, now), 'missing');
  assert.equal(customersFreshness('2026-10-20T10:00:00Z', null, now), 'old-day');
  assert.equal(customersFreshness('2026-10-21T02:00:00Z', null, now), 'ok');
  assert.equal(customersFreshness('2026-10-21T02:00:00Z', '2026-10-21T03:00:00Z', now), 'before-upload');
  assert.equal(customersFreshness('2026-10-21T04:00:00Z', '2026-10-21T03:00:00Z', now), 'ok');
});
