const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../src/rules.js');
const { reportToRows } = require('../src/sheets.js');

test('reportToRows lays out Total/Shopee/Tiktok blocks like the old Tổng Kết sheet', () => {
  const rep = buildReport([{ phone: '0901', channel: 'Shopee', claimedAt: new Date('2026-01-10T03:00:00Z'), value: 1500000, points: 15 }], 2026);
  const rows = reportToRows(rep, 2026);
  assert.equal(rows.length, 3 * 8);
  rows.forEach(r => assert.equal(r.length, 13));
  assert.equal(rows[0][0], 'Bảng Tổng Hợp Data Khách Hàng Từ Các Kênh Ecom - Total - 2026');
  assert.deepEqual(rows[1], ['Total', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']);
  assert.deepEqual(rows[2].slice(0, 3), ['Phone', 1, 0]);
  assert.deepEqual(rows[3].slice(0, 2), ['Giá Trị Đơn Hàng', 1500000]);
  assert.deepEqual(rows[4].slice(0, 2), ['Điểm Loyalty', 15]);
  assert.deepEqual(rows[5].slice(0, 2), ['Giá Trị Điểm', 15000]);
  assert.deepEqual(rows[6].slice(0, 2), ['AOV', 1500000]);
  assert.equal(rows[8][0], 'Bảng Tổng Hợp Data Khách Hàng Từ Các Kênh Ecom - Shopee - 2026');
  assert.deepEqual(rows[18].slice(0, 2), ['Phone', 0]);
});
