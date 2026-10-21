const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REASONS, buildOrderIndex, computePoints, evaluateSubmissions,
} = require('../src/rules.js');

const settings = {
  vndPerPoint: 100000,
  multipliers: { Silver: 1, Gold: 3, Platinum: 5 },
  waitDays: 15,
};
const NOW = new Date('2026-10-20T05:00:00Z');
const DAY = 24 * 3600 * 1000;

let rowSeq = 3;
function sub(ts, phone, code, extra) {
  return Object.assign({
    row: rowSeq++, timestamp: ts, channel: 'Shopee', name: 'Khách', phoneRaw: phone, email: '', codeRaw: code,
  }, extra || {});
}
function ord(code, opts) {
  return Object.assign({
    id: 'id-' + code, name: '#' + code, marketplaceCode: code, partnerTrackingCode: 'TRK' + code,
    createdAt: new Date('2026-09-01T03:00:00Z'), deliveredAt: new Date(NOW - 20 * DAY),
    delivered: true, voided: false, valueAfterDiscount: 1000000, province: 'Hà Nội',
  }, opts || {});
}
function run(subs, orders, ledger, customers) {
  return evaluateSubmissions(subs, ledger || [], buildOrderIndex(orders),
    new Map((customers || []).map(c => [c.phone, c])), settings, NOW);
}

test('skips claim whose code is in ledger with same phone', () => {
  const r = run([sub('01/10/2026 10:00:00', '0901111111', 'A1')], [ord('A1')],
    [{ code: 'A1', phone: '0901111111' }]);
  assert.equal(r.credits.length, 0);
  assert.equal(r.review.length, 0);
});

test('warns when ledger has code under other phone', () => {
  const r = run([sub('01/10/2026 10:00:00', '0902222222', 'A1')], [ord('A1')],
    [{ code: 'A1', phone: '0901111111' }]);
  assert.equal(r.credits.length, 0);
  assert.deepEqual(r.review.map(x => [x.kind, x.reason]), [['warn', REASONS.TAKEN_BY_OTHER]]);
});

test('first claimant in batch wins, later different phone warned', () => {
  const later = sub('05/01/2026 10:00:00', '0902222222', 'B1');
  const first = sub('04/01/2026 09:00:00', '0901111111', 'B1');
  const r = run([later, first], [ord('B1')]);
  assert.deepEqual(r.credits.map(c => c.phone), ['0901111111']);
  assert.deepEqual(r.review.map(x => [x.submission, x.reason]), [[later, REASONS.TAKEN_BY_OTHER]]);
});

test('same phone duplicate claim in batch is silently skipped', () => {
  const r = run([sub('04/01/2026 09:00:00', '0901111111', 'B2'), sub('04/01/2026 09:01:00', '0901111111', 'b2')],
    [ord('B2')]);
  assert.equal(r.credits.length, 1);
  assert.equal(r.review.length, 0);
});

test('invalid phone warned', () => {
  const r = run([sub('01/10/2026 10:00:00', '12345', 'C1')], [ord('C1')]);
  assert.deepEqual(r.review.map(x => [x.kind, x.reason]), [['warn', REASONS.PHONE_INVALID]]);
});

test('matches on partner tracking code and on lowercase/spaced code', () => {
  const r = run([
    sub('01/10/2026 10:00:00', '0901111111', 'trkd1'),
    sub('01/10/2026 10:01:00', '0901111112', ' d 2 '),
  ], [ord('D1'), ord('D2')]);
  assert.deepEqual(r.credits.map(c => c.order.id), ['id-D1', 'id-D2']);
});

test('cancelled or returned order is warned with its own reason', () => {
  const r = run([sub('01/10/2026 10:00:00', '0901111111', 'V1')], [ord('V1', { voided: true })]);
  assert.deepEqual(r.review.map(x => [x.kind, x.reason]), [['warn', REASONS.VOIDED]]);
});

test('not found warned', () => {
  const r = run([sub('01/10/2026 10:00:00', '0901111111', 'ZZZ')], [ord('E1')]);
  assert.deepEqual(r.review.map(x => [x.kind, x.reason]), [['warn', REASONS.NOT_FOUND]]);
});

test('undelivered order waits', () => {
  const r = run([sub('01/10/2026 10:00:00', '0901111111', 'F1')], [ord('F1', { delivered: false, deliveredAt: null })]);
  assert.deepEqual(r.review.map(x => [x.kind, x.reason]), [['wait', REASONS.NOT_DELIVERED]]);
});

test('delivered 14 days ago waits, 15 days ago credited', () => {
  const r = run([
    sub('01/10/2026 10:00:00', '0901111111', 'G1'),
    sub('01/10/2026 10:01:00', '0901111112', 'G2'),
  ], [ord('G1', { deliveredAt: new Date(NOW - 14 * DAY) }), ord('G2', { deliveredAt: new Date(NOW - 15 * DAY) })]);
  assert.deepEqual(r.review.map(x => [x.kind, x.reason]), [['wait', 'Chờ đủ 15 ngày']]);
  assert.deepEqual(r.credits.map(c => c.order.id), ['id-G2']);
});

test('points use current tier, no customer means Silver', () => {
  const r = run([
    sub('01/10/2026 10:00:00', '0901000001', 'H1'),
    sub('01/10/2026 10:01:00', '0901000002', 'H2'),
    sub('01/10/2026 10:02:00', '0901000003', 'H3'),
    sub('01/10/2026 10:03:00', '0901000004', 'H4'),
  ], [
    ord('H1', { valueAfterDiscount: 2270000 }), ord('H2', { valueAfterDiscount: 815000 }),
    ord('H3', { valueAfterDiscount: 915000 }), ord('H4', { valueAfterDiscount: 2270000 }),
  ], [], [
    { phone: '0901000001', tier: 'Silver' }, { phone: '0901000002', tier: 'Gold' },
    { phone: '0901000003', tier: 'Platinum' },
  ]);
  assert.deepEqual(r.credits.map(c => [c.tier, c.multiplier, c.points]),
    [['Silver', 1, 23], ['Gold', 3, 24], ['Platinum', 5, 46], ['Silver', 1, 23]]);
});

test('unknown tier warned', () => {
  const r = run([sub('01/10/2026 10:00:00', '0901000001', 'I1')], [ord('I1')], [],
    [{ phone: '0901000001', tier: 'Diamond' }]);
  assert.equal(r.credits.length, 0);
  assert.deepEqual(r.review.map(x => x.reason), [REASONS.UNKNOWN_TIER]);
});

test('computePoints rounds per order and returns null for unknown tier', () => {
  assert.deepEqual(computePoints(815000, 'Gold', settings), { multiplier: 3, points: 24 });
  assert.deepEqual(computePoints(815000, '', settings), { multiplier: 1, points: 8 });
  assert.equal(computePoints(815000, 'Diamond', settings), null);
});
