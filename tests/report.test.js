const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, UNKNOWN_MONTH } = require('../src/rules.js');

function entry(code, phone, channel, claimedAt, orderCreatedAt, points) {
  return { code, phone, channel, claimedAt: new Date(claimedAt), orderCreatedAt: orderCreatedAt ? new Date(orderCreatedAt) : null, points };
}

test('buildReport counts orders, distinct customers and points per month and channel, by order and by claim month', () => {
  const r = buildReport([
    entry('A', '0901', 'Shopee', '2026-02-03T03:00:00Z', '2026-01-10T03:00:00Z', 10),
    entry('B', '0901', 'shopee', '2026-02-04T03:00:00Z', '2026-01-20T03:00:00Z', 5),
    entry('C', '0902', 'Tiktok', '2026-02-05T03:00:00Z', '2026-02-01T03:00:00Z', 3),
    entry('D', '0903', 'Website', '2026-02-05T03:00:00Z', '2026-02-01T03:00:00Z', 99),
  ]);
  assert.deepEqual(r.byOrder.months, ['2026-01', '2026-02']);
  assert.deepEqual(r.byOrder.cells['2026-01'], { Shopee: { orders: 2, customers: 1, points: 15 }, Tiktok: { orders: 0, customers: 0, points: 0 } });
  assert.deepEqual(r.byOrder.cells['2026-02'].Tiktok, { orders: 1, customers: 1, points: 3 });
  assert.deepEqual(r.byClaim.months, ['2026-02']);
  assert.deepEqual(r.byClaim.cells['2026-02'], { Shopee: { orders: 2, customers: 1, points: 15 }, Tiktok: { orders: 1, customers: 1, points: 3 } });
  assert.deepEqual(r.byClaim.total, r.byOrder.total);
});

test('missing order dates come from the Haravan lookup, else "Không rõ" (listed last)', () => {
  const r = buildReport([
    entry('260110ABCDEFGH', '0901', 'Shopee', '2026-02-03T03:00:00Z', null, 1),
    entry('583927961666356425', '0902', 'Tiktok', '2026-02-03T03:00:00Z', null, 2),
  ], new Map([['260110ABCDEFGH', new Date('2025-12-31T18:00:00Z')]])); // 01:00 on 1 Jan VN
  assert.deepEqual(r.byOrder.months, ['2026-01', UNKNOWN_MONTH]);
  assert.equal(r.byOrder.cells[UNKNOWN_MONTH].Tiktok.orders, 1);
});

test('total customers are distinct over the whole period', () => {
  const r = buildReport([
    entry('A', '0901', 'Shopee', '2026-01-03T03:00:00Z', '2026-01-01T03:00:00Z', 1),
    entry('B', '0901', 'Shopee', '2026-03-03T03:00:00Z', '2026-03-01T03:00:00Z', 1),
  ]);
  assert.deepEqual(r.byClaim.total.Shopee, { orders: 2, customers: 1, points: 2 });
});

test('buildReport leaves out months before the report start month, keeps "Không rõ"', () => {
  const r = buildReport([
    entry('A', '0901', 'Shopee', '2026-01-05T03:00:00Z', '2025-12-20T03:00:00Z', 1),
    entry('B', '0902', 'Shopee', '2026-01-05T03:00:00Z', '2026-01-02T03:00:00Z', 2),
    entry('C', '0903', 'Shopee', '2026-01-05T03:00:00Z', null, 4),
  ], new Map(), '2026-01');
  assert.deepEqual(r.byOrder.months, ['2026-01', UNKNOWN_MONTH]);
  assert.deepEqual(r.byOrder.total.Shopee, { orders: 2, customers: 2, points: 6 });
  assert.deepEqual(r.byClaim.total.Shopee, { orders: 3, customers: 3, points: 7 });
});
