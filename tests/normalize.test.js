const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePhone, normalizeCode, parseFormTimestamp, formatVnd, formatIsoVN,
} = require('../src/rules.js');

test('normalizePhone keeps a valid 10-digit phone', () => {
  assert.equal(normalizePhone('0397192888'), '0397192888');
});

test('normalizePhone restores the leading 0 on 9-digit numbers', () => {
  assert.equal(normalizePhone(397192888), '0397192888');
  assert.equal(normalizePhone('397192888'), '0397192888');
});

test('normalizePhone strips apostrophe, spaces, dots and dashes', () => {
  assert.equal(normalizePhone("'0397 192.888"), '0397192888');
});

test('normalizePhone converts +84 / 84 prefix', () => {
  assert.equal(normalizePhone('+84 397-192-888'), '0397192888');
  assert.equal(normalizePhone('84397192888'), '0397192888');
});

test('normalizePhone rejects invalid values', () => {
  assert.equal(normalizePhone('03971928'), null);
  assert.equal(normalizePhone('abc0397192888'), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(null), null);
});

test('normalizeCode trims and uppercases', () => {
  assert.equal(normalizeCode(' 260102193vs1hu '), '260102193VS1HU');
  assert.equal(normalizeCode(null), '');
});

test('parseFormTimestamp reads dd/MM/yyyy HH:mm:ss as Vietnam time', () => {
  assert.equal(parseFormTimestamp('04/01/2026 09:52:54').toISOString(), '2026-01-04T02:52:54.000Z');
});

test('parseFormTimestamp orders chronologically, not lexically', () => {
  assert.ok(parseFormTimestamp('10/02/2026 08:00:00') > parseFormTimestamp('09/12/2025 23:00:00'));
});

test('parseFormTimestamp passes Dates through and rejects garbage', () => {
  const d = new Date('2026-01-01T00:00:00Z');
  assert.equal(parseFormTimestamp(d).getTime(), d.getTime());
  assert.equal(parseFormTimestamp('xx'), null);
});

test('formatVnd uses comma thousands separators', () => {
  assert.equal(formatVnd(4340000), '4,340,000');
  assert.equal(formatVnd(0), '0');
});

test('formatIsoVN renders +07:00 local time', () => {
  assert.equal(formatIsoVN(new Date('2026-08-21T11:14:05Z')), '2026-08-21T18:14:05+07:00');
});
