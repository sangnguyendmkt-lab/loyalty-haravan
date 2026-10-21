const test = require('node:test');
const assert = require('node:assert/strict');
const { formStatusRows } = require('../src/sheets.js');
const { REASONS } = require('../src/rules.js');

const sub = (row, phone, code) => ({ row, timestamp: '04/01/2026 09:52:54', channel: 'Shopee', name: 'A', phoneRaw: phone, email: '', codeRaw: code });
const led = (code, phone, batchId) => ({ code, phone, batchId });

test('formStatusRows: Done with day, review status, excluded, not evaluated, partial multi-code', () => {
  const rows = formStatusRows([
    sub(9, '0902222222', 'C1'),
    sub(3, '0901111111', 'A1'),
    sub(4, '0901111111', 'B1'),
    sub(5, '0901111111', '260609METDYY8B\n260620J2SX4UUN\n260601ABCDEFGH'),
    sub(6, '0903333333', 'A1'),
    sub(7, '0901111111', 'OLD1 OLD2'),
    sub(8, '0904444444', 'D1'),
  ], [
    led('A1', '0901111111', '20261021-2242'),
    led('260609METDYY8B', '0901111111', '20261021-2242'),
    led('260620J2SX4UUN', '0901111111', '20261028-1000'),
    led('OLD1OLD2', '0901111111', 'CU-08/01/2026'),
  ], [
    [4, '', '', '', 'B1', 'Đang chờ', REASONS.NOT_DELIVERED],
    [6, '', '', '', 'A1', 'Cần xem', REASONS.TAKEN_BY_OTHER],
  ], new Set(['8|D1']));
  const byRow = Object.fromEntries(rows.map(r => [r[0], r.slice(7)]));
  assert.deepEqual(rows.map(r => r[0]), [3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(byRow[3], ['Done', '21/10/2026', '']);
  assert.deepEqual(byRow[4], ['Đang chờ', '', REASONS.NOT_DELIVERED]);
  assert.deepEqual(byRow[5], ['Done 2/3', '28/10/2026', '260601ABCDEFGH – Chưa xét']);
  assert.deepEqual(byRow[6], ['Cần xem', '', REASONS.TAKEN_BY_OTHER]);
  assert.deepEqual(byRow[7], ['Done', '08/01/2026', '']);
  assert.deepEqual(byRow[8], ['Đã loại', '', 'Đã loại']);
  assert.deepEqual(byRow[9], ['Chưa xét', '', 'Chưa xét']);
});
