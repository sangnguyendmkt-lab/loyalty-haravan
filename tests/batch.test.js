const test = require('node:test');
const assert = require('node:assert/strict');
const { vnDayKey } = require('../src/rules.js');
const { creditsToLedgerRows, reviewToRows, batchSummaryRows, HEADERS, SHEETS } = require('../src/sheets.js');

test('vnDayKey uses the Vietnam calendar day', () => {
  assert.equal(vnDayKey(new Date('2026-10-20T16:59:59Z')), '2026-10-20');
  assert.equal(vnDayKey(new Date('2026-10-20T17:00:00Z')), '2026-10-21');
});

const sub = { row: 7, timestamp: '04/01/2026 09:52:54', channel: 'Shopee', name: 'An', phoneRaw: '394729963', email: '', codeRaw: ' 2601xx ' };

test('creditsToLedgerRows writes one ledger row per credited order', () => {
  const rows = creditsToLedgerRows([{
    submission: sub, phone: '0394729963', tier: 'Gold', multiplier: 3, points: 24,
    order: { id: '99', createdAt: new Date('2026-01-02T00:00:00Z'), valueAfterDiscount: 815000 },
  }], '20261021-0900');
  assert.equal(rows[0].length, HEADERS[SHEETS.LEDGER].length);
  assert.deepEqual(rows[0].slice(0, 4), ['2601XX', '99', '0394729963', 'Shopee']);
  assert.equal(rows[0][4].toISOString(), '2026-01-04T02:52:54.000Z');
  assert.deepEqual(rows[0].slice(6), [815000, 'Gold', 3, 24, '20261021-0900', 'Hệ thống']);
});

test('reviewToRows keeps first-seen date and staff notes from the previous run, warnings first', () => {
  const prev = [[7, '', '', '', '2601XX', '', '', '2026-10-14', 'Đã gọi khách']];
  const rows = reviewToRows([
    { submission: Object.assign({}, sub, { row: 8, codeRaw: 'W1' }), kind: 'wait', reason: 'Chờ giao' },
    { submission: sub, kind: 'warn', reason: 'Không tìm thấy' },
  ], prev, '2026-10-21');
  assert.deepEqual(rows[0], [7, '2026-01-04 09:52:54', 'Shopee', '394729963', '2601XX', 'Cần xem', 'Không tìm thấy', '2026-10-14', 'Đã gọi khách']);
  assert.deepEqual(rows[1].slice(4), ['W1', 'Đang chờ', 'Chờ giao', '2026-10-21', '']);
});

test('batchSummaryRows reports counts', () => {
  const rows = batchSummaryRows({ batchId: 'B1', createdAt: '2026-10-21 09:00', createdBy: 'a@x.com' },
    [{ points: 30 }, { points: 5 }], [{ points: 10 }, { points: 4 }, { points: 1 }],
    [{ kind: 'warn' }, { kind: 'wait' }, { kind: 'wait' }]);
  assert.deepEqual(rows, [
    ['Mã đợt', 'B1'], ['Tạo lúc', '2026-10-21 09:00'], ['Người tạo', 'a@x.com'],
    ['Số khách / số đơn được tích', '2 khách / 3 đơn'], ['Tổng điểm cộng thêm', 15],
    ['Cần kiểm tra / đang chờ', '1 / 2'],
  ]);
});
