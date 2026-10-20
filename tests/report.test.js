const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../src/rules.js');

const z = () => new Array(12).fill(0);
function entry(phone, channel, claimedAt, value, points) {
  return { code: 'X', phone, channel, claimedAt: new Date(claimedAt), value, points };
}

test('buildReport aggregates by claim month and channel, AOV = value / distinct phones', () => {
  const r = buildReport([
    entry('0901', 'Shopee', '2026-01-10T03:00:00Z', 1000000, 10),
    entry('0901', 'shopee', '2026-01-20T03:00:00Z', 500000, 5),
    entry('0902', 'Tiktok', '2026-02-05T03:00:00Z', 300000, 3),
    entry('0903', 'Tiktok', '2025-12-05T03:00:00Z', 999, 9),
  ], 2026);
  const shopee = { phones: z(), value: z(), points: z(), pointValue: z(), aov: z() };
  shopee.phones[0] = 1; shopee.value[0] = 1500000; shopee.points[0] = 15; shopee.pointValue[0] = 15000; shopee.aov[0] = 1500000;
  const tiktok = { phones: z(), value: z(), points: z(), pointValue: z(), aov: z() };
  tiktok.phones[1] = 1; tiktok.value[1] = 300000; tiktok.points[1] = 3; tiktok.pointValue[1] = 3000; tiktok.aov[1] = 300000;
  assert.deepEqual(r.Shopee, shopee);
  assert.deepEqual(r.Tiktok, tiktok);
  assert.deepEqual(r.Total.phones.slice(0, 2), [1, 1]);
  assert.deepEqual(r.Total.value.slice(0, 2), [1500000, 300000]);
});

test('buildReport counts a phone once in Total even across channels', () => {
  const r = buildReport([
    entry('0901', 'Shopee', '2026-03-01T03:00:00Z', 100, 1),
    entry('0901', 'Tiktok', '2026-03-02T03:00:00Z', 300, 3),
  ], 2026);
  assert.equal(r.Total.phones[2], 1);
  assert.equal(r.Total.aov[2], 400);
});

test('buildReport uses Vietnam month boundaries', () => {
  const r = buildReport([entry('0901', 'Shopee', '2026-01-31T18:00:00Z', 100, 1)], 2026); // 01:00 on 1 Feb VN
  assert.equal(r.Shopee.value[1], 100);
});
