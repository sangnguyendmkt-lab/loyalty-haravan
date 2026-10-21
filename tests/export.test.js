const test = require('node:test');
const assert = require('node:assert/strict');
const { EXPORT_HEADERS, buildExportRows, formatExportRow } = require('../src/rules.js');

function credit(phone, value, points, opts) {
  opts = opts || {};
  return {
    phone: phone, points: points, tier: 'Silver', multiplier: 1,
    submission: { row: 3, timestamp: opts.ts || '01/10/2026 10:00:00', name: opts.name || 'Tên Form', email: opts.email || '', phoneRaw: phone },
    order: { valueAfterDiscount: value, createdAt: opts.createdAt || new Date('2026-06-16T05:53:16Z'), province: opts.province || 'Hà Nội' },
  };
}

test('EXPORT_HEADERS match the Haravan import file exactly', () => {
  assert.deepEqual(EXPORT_HEADERS, ['Họ và tên', 'Số điện thoại', 'Email', 'Phường/Xã', 'Quận/Huyện',
    'Tỉnh/Thành phố', 'Chi tiêu tích luỹ trong kỳ', 'Tổng chi tiêu', 'Điểm thưởng', 'Ngày đặt hàng cuối cùng']);
});

test('existing customer: adds to old values and keeps Haravan name/province, fills blank email', () => {
  const customers = new Map([['0938845942', {
    phone: '0938845942', name: 'Nguyễn Thị Trúc Linh', email: '', province: 'Thành phố Hồ Chí Minh',
    tier: 'Silver', points: 37, totalSpent: 5000000, periodSpent: 3752200, lastOrderAt: new Date('2026-09-01T00:00:00Z'),
  }]]);
  const rows = buildExportRows([credit('0938845942', 2380248, 24, { email: 'a@b.com', name: 'linh' })], customers);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.name, 'Nguyễn Thị Trúc Linh');
  assert.equal(r.email, 'a@b.com');
  assert.equal(r.province, 'Thành phố Hồ Chí Minh');
  assert.equal(r.points, 61);
  assert.equal(r.periodSpent, 6132448);
  assert.equal(r.totalSpent, 7380248);
  assert.equal(r.lastOrderAt.toISOString(), '2026-09-01T00:00:00.000Z');
});

test('existing customer keeps non-blank Haravan email', () => {
  const customers = new Map([['0901111111', { phone: '0901111111', name: 'A', email: 'old@x.com', province: '', tier: '', points: 0, totalSpent: 0, periodSpent: 0, lastOrderAt: null }]]);
  const r = buildExportRows([credit('0901111111', 100000, 1, { email: 'new@x.com', province: 'Huế' })], customers)[0];
  assert.equal(r.email, 'old@x.com');
  assert.equal(r.province, 'Huế');
  assert.equal(r.lastOrderAt.toISOString(), '2026-06-16T05:53:16.000Z');
});

test('new customer uses form name/email and order province', () => {
  const r = buildExportRows([credit('0902222222', 815000, 8, { name: 'P Nhi', email: 'n@x.com', province: 'Quảng Ninh' })], new Map())[0];
  assert.deepEqual([r.name, r.email, r.province, r.points, r.periodSpent, r.totalSpent], ['P Nhi', 'n@x.com', 'Quảng Ninh', 8, 815000, 815000]);
});

test('two credits same phone produce one summed row with latest order date', () => {
  const rows = buildExportRows([
    credit('0903333333', 1000000, 10, { createdAt: new Date('2026-03-01T00:00:00Z') }),
    credit('0903333333', 500000, 5, { createdAt: new Date('2026-05-01T00:00:00Z') }),
    credit('0901000000', 100000, 1),
  ], new Map());
  assert.deepEqual(rows.map(r => r.phone), ['0901000000', '0903333333']);
  assert.deepEqual([rows[1].points, rows[1].totalSpent, rows[1].lastOrderAt.toISOString()], [15, 1500000, '2026-05-01T00:00:00.000Z']);
});

test('formatExportRow renders the 10 upload cells', () => {
  assert.deepEqual(formatExportRow({
    name: 'Nguyễn Thị Trúc Linh', phone: '0938845942', email: '', province: 'Thành phố Hồ Chí Minh',
    periodSpent: 6132448, totalSpent: 7380248, points: 61, lastOrderAt: new Date('2026-09-01T00:00:00Z'),
  }), ['Nguyễn Thị Trúc Linh', '0938845942', '', '', '', 'Thành phố Hồ Chí Minh', '6,132,448', '7,380,248', 61, '2026-09-01T07:00:00+07:00']);
});

test('cleanEmail keeps only well-formed emails', () => {
  const { cleanEmail } = require('../src/rules.js');
  assert.equal(cleanEmail(' Phamyen401@gmail.com '), 'Phamyen401@gmail.com');
  ['', 'abc', 'a@b', 'a b@x.com', 'a@@x.com', 'x@gmail,com', null, undefined].forEach(v => assert.equal(cleanEmail(v), ''));
});

test('two new phones sharing a form email: earliest claimant keeps it, the other is left blank', () => {
  const rows = buildExportRows([
    credit('0397137618', 1124999, 11, { email: 'Phamyen401@gmail.com', ts: '26/09/2026 22:52:08' }),
    credit('0397237618', 1085000, 11, { email: 'phamyen401@gmail.com', ts: '09/09/2026 14:02:33' }),
  ], new Map());
  const byPhone = Object.fromEntries(rows.map(r => [r.phone, r.email]));
  assert.deepEqual(byPhone, { '0397137618': '', '0397237618': 'phamyen401@gmail.com' });
});

test('form email already owned on Haravan by another phone (or a phoneless customer) is not used', () => {
  const customers = new Map([['0901111111', { phone: '0901111111', name: 'A', email: 'Owner@x.com', province: '', tier: '', points: 0, totalSpent: 0, periodSpent: 0, lastOrderAt: null }]]);
  customers.emailOwners = new Map([['owner@x.com', '0901111111'], ['nophone@x.com', '']]);
  const rows = buildExportRows([
    credit('0902222222', 100000, 1, { email: 'owner@x.com' }),
    credit('0903333333', 100000, 1, { email: 'nophone@x.com' }),
    credit('0901111111', 100000, 1, { email: 'other@x.com' }),
  ], customers);
  assert.deepEqual(rows.map(r => r.email), ['Owner@x.com', '', '']);
});

test('invalid Haravan email is replaced by a valid form email; invalid form email gives blank', () => {
  const customers = new Map([['0901111111', { phone: '0901111111', name: 'A', email: 'bad-email', province: '', tier: '', points: 0, totalSpent: 0, periodSpent: 0, lastOrderAt: null }]]);
  const rows = buildExportRows([
    credit('0901111111', 100000, 1, { email: 'good@x.com' }),
    credit('0902222222', 100000, 1, { email: 'khong co' }),
  ], customers);
  assert.deepEqual(rows.map(r => r.email), ['good@x.com', '']);
});
