const test = require('node:test');
const assert = require('node:assert/strict');
const { HEADERS, SHEETS, ledgerToRow, rowToLedger, parseSettingsRows, rowToSubmission } = require('../src/sheets.js');

test('ledger row round-trips and keeps phone as text', () => {
  const e = {
    code: 'A1', orderId: '123', phone: '0901111111', channel: 'Shopee',
    claimedAt: new Date('2026-01-04T02:52:54Z'), orderCreatedAt: null, value: 2270000,
    tier: 'Silver', multiplier: 1, points: 23, batchId: 'CU-08/01/2026', source: 'Chuyển từ file cũ',
  };
  const row = ledgerToRow(e);
  assert.equal(row.length, HEADERS[SHEETS.LEDGER].length);
  assert.equal(row[2], '0901111111');
  assert.equal(row[5], '');
  assert.deepEqual(rowToLedger(row), e);
});

test('rowToLedger normalizes 9-digit phones and formatted numbers', () => {
  const e = rowToLedger(['a1', '', 901111111, 'Shopee', '', '', '2,270,000', 'Silver', 1, 23, 'X', 'Y']);
  assert.equal(e.code, 'A1');
  assert.equal(e.phone, '0901111111');
  assert.equal(e.value, 2270000);
  assert.equal(e.claimedAt, null);
});

test('parseSettingsRows reads labels, multipliers and defaults', () => {
  const s = parseSettingsRows([
    ['ID file form', 'abc'], ['Tên sheet form', 'Dữ Liệu Gốc'], ['Ngày bắt đầu dữ liệu', '01/08/2025'],
    ['Số tiền mỗi điểm', 100000], ['Hệ số Silver', 1], ['Hệ số Gold', 3], ['Hệ số Platinum', 5],
    ['Số ngày chờ sau giao', 15], ['Nguồn khách hàng', 'sheet'],
  ]);
  assert.equal(s.formSpreadsheetId, 'abc');
  assert.equal(s.formSheetName, 'Dữ Liệu Gốc');
  assert.equal(s.dataStart.toISOString(), '2025-07-31T17:00:00.000Z');
  assert.deepEqual(s.multipliers, { Silver: 1, Gold: 3, Platinum: 5 });
  assert.equal(s.vndPerPoint, 100000);
  assert.equal(s.waitDays, 15);
  assert.equal(s.customerSource, 'sheet');
});

test('rowToSubmission maps form columns A..F', () => {
  const s = rowToSubmission(['04/01/2026 09:52:54', 'Shopee', 'Trần Thuý An', '0394729963', '', '26010320YB0XAA'], 3);
  assert.deepEqual(s, { row: 3, timestamp: '04/01/2026 09:52:54', channel: 'Shopee', name: 'Trần Thuý An', phoneRaw: '0394729963', email: '', codeRaw: '26010320YB0XAA' });
});

const { editRowsToLedgerRows } = require('../src/sheets.js');

test('editRowsToLedgerRows keeps first Done row per code and fixes the 2025 batch-date typo', () => {
  //            A timestamp            B channel  C name D phone       E  F code     G  H  I  J  K value       L  M tier    N  O pts P date        Q status
  const rows = [
    ['04/01/2026 09:52:54', 'Shopee', 'An', '0394729963', '', '26010320yb0xaa', '', '', '', '', '2,270,000', '', 'Silver', 1, 23, '08/01/2025', 'Done'],
    ['04/01/2026 09:53:00', 'Shopee', 'An', '0394729963', '', '26010320YB0XAA', '', '', '', '', '2,270,000', '', 'Silver', 1, 23, '08/01/2025', 'Done'],
    ['05/01/2026 10:00:00', 'Tiktok', 'B', '0865089438', '', 'NOTDONE', '', '', '', '', '915,000', '', 'Silver', 1, 9, '', ''],
  ];
  assert.deepEqual(editRowsToLedgerRows(rows), [
    ['26010320YB0XAA', '', '0394729963', 'Shopee', '04/01/2026 09:52:54', '', 2270000, 'Silver', 1, 23, 'CU-08/01/2026', 'Chuyển từ file cũ'],
  ]);
});
