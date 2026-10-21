const test = require('node:test');
const assert = require('node:assert/strict');
const { isCacheableOrder, syncStartDate, planPruneBlocks, parseSettingsRows } = require('../src/sheets.js');

test('only Shopee/TikTok orders are cached', () => {
  assert.equal(isCacheableOrder({ source: 'shopee' }), true);
  assert.equal(isCacheableOrder({ source: 'tiktokshop' }), true);
  assert.equal(isCacheableOrder({ source: 'lazada' }), false);
  assert.equal(isCacheableOrder({ source: 'web' }), false);
  assert.equal(isCacheableOrder({ source: '' }), false);
});

test('retention days default to 365 and sync starts at the later of data start and now - retention', () => {
  const s = parseSettingsRows([['Ngày bắt đầu dữ liệu', '01/08/2025']]);
  assert.equal(s.retentionDays, 365);
  assert.equal(syncStartDate(s, new Date('2026-10-21T00:00:00Z')).toISOString(), '2025-10-21T00:00:00.000Z');
  const s2 = parseSettingsRows([['Ngày bắt đầu dữ liệu', '01/08/2025'], ['Số ngày giữ đơn', 1000]]);
  assert.equal(syncStartDate(s2, new Date('2026-10-21T00:00:00Z')).toISOString(), '2025-07-31T17:00:00.000Z');
});

test('planPruneBlocks finds rows to delete in a cache sorted by source then created date', () => {
  // [source, createdAt ISO] for sheet rows 2..9, sorted by source then date
  const rows = [
    ['lazada', '2026-05-01T00:00:00Z'],
    ['lazada', '2026-09-01T00:00:00Z'],
    ['shopee', '2025-09-01T00:00:00Z'],
    ['shopee', '2025-10-01T00:00:00Z'],
    ['shopee', '2026-01-01T00:00:00Z'],
    ['tiktokshop', '2025-10-20T00:00:00Z'],
    ['tiktokshop', '2026-02-01T00:00:00Z'],
    ['web', '2026-10-01T00:00:00Z'],
  ];
  // cutoff 2025-10-21: delete lazada (rows 2-3), old shopee (4-5), old tiktok (7), web (9)
  assert.deepEqual(planPruneBlocks(rows, new Date('2025-10-21T00:00:00Z'), 2), [[9, 9], [7, 7], [2, 5]]);
  assert.deepEqual(planPruneBlocks([], new Date(), 2), []);
});
