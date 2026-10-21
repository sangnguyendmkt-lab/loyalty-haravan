const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../src/rules.js');
const { reportToRows } = require('../src/sheets.js');

test('reportToRows lays out the order-month table then the form-month table, Shopee | Tiktok', () => {
  const rows = reportToRows(buildReport([{ code: 'A', phone: '0901', channel: 'Shopee',
    claimedAt: new Date('2026-02-10T03:00:00Z'), orderCreatedAt: new Date('2026-01-10T03:00:00Z'), points: 15 }]));
  rows.forEach(r => assert.equal(r.length, 7));
  assert.match(rows[0][0], /ĐẶT ĐƠN/);
  assert.deepEqual(rows[1], ['Tháng', 'Shopee', '', '', 'Tiktok', '', '']);
  assert.deepEqual(rows[2], ['', 'Số đơn', 'Số khách', 'Điểm thưởng', 'Số đơn', 'Số khách', 'Điểm thưởng']);
  assert.deepEqual(rows[3], ['01/2026', 1, 1, 15, 0, 0, 0]);
  assert.deepEqual(rows[4], ['Tổng cộng', 1, 1, 15, 0, 0, 0]);
  assert.deepEqual(rows[5], ['', '', '', '', '', '', '']);
  assert.match(rows[6][0], /ĐIỀN FORM/);
  assert.deepEqual(rows[9], ['02/2026', 1, 1, 15, 0, 0, 0]);
  assert.equal(rows.length, 11);
});
