const test = require('node:test');
const assert = require('node:assert/strict');
const { splitCodes, expandSubmissions, evaluateSubmissions } = require('../src/rules.js');

test('splitCodes: one code stays one code (spaces, case, trailing newline)', () => {
  assert.deepEqual(splitCodes('260125vgsnt7jt'), ['260125VGSNT7JT']);
  assert.deepEqual(splitCodes('260110N64RW1YR\n'), ['260110N64RW1YR']);
  assert.deepEqual(splitCodes('SPXVN 0671 6422 8091'), ['SPXVN067164228091']);
  assert.deepEqual(splitCodes(861262550856), ['861262550856']);
  assert.deepEqual(splitCodes(''), []);
});

test('splitCodes: several codes by newline, comma, slash, "và", glued', () => {
  const five = ['250721N8V17JTY', '2508075S83D8MS', '250908VRCAJ9RY', '251009KC6D9VB7', '251211410HNACJ'];
  assert.deepEqual(splitCodes(five.join('\n')), five);
  assert.deepEqual(splitCodes(five.join('')), five);
  assert.deepEqual(splitCodes('260609METDYY8B , 260620J2SX4UUN,260601ABCDEFGH'), ['260609METDYY8B', '260620J2SX4UUN', '260601ABCDEFGH']);
  assert.deepEqual(splitCodes('862260797873, ,585556733675669010'), ['862260797873', '585556733675669010']);
  assert.deepEqual(splitCodes('SPXVN067164228091 Và SPXVN067164228092'), ['SPXVN067164228091', 'SPXVN067164228092']);
  assert.deepEqual(splitCodes('583142284149753199\n583142284149753199'), ['583142284149753199']);
});

test('splitCodes: labels are dropped, junk is never cut into a fake code', () => {
  assert.deepEqual(splitCodes('Shopee: 260122P2K2SSK9'), ['260122P2K2SSK9']);
  assert.deepEqual(splitCodes('Mã đơn 861908191252'), ['861908191252']);
  assert.deepEqual(splitCodes('#2604076MX4605K'), ['2604076MX4605K']);
  assert.deepEqual(splitCodes('Mvđ: 861539800382 \nSố đơn hàng: 583300056970135319'), ['861539800382', '583300056970135319']);
  assert.deepEqual(splitCodes('X239D02861215261730'), ['X239D02861215261730']);
  assert.deepEqual(splitCodes('Mã đơn hàng tiktok'), ['MÃĐƠNHÀNGTIKTOK']);
  assert.deepEqual(splitCodes('58212200013853638'), ['58212200013853638']);
});

test('expandSubmissions: one submission per code, same row/phone, keeps the whole cell', () => {
  const out = expandSubmissions([{ row: 7, timestamp: '01/10/2026 10:00:00', phoneRaw: '0901111111', codeRaw: '260609METDYY8B\n260620J2SX4UUN' }]);
  assert.deepEqual(out.map(s => [s.row, s.phoneRaw, s.codeRaw, s.cellCode]), [
    [7, '0901111111', '260609METDYY8B', '260609METDYY8B260620J2SX4UUN'],
    [7, '0901111111', '260620J2SX4UUN', '260609METDYY8B260620J2SX4UUN'],
  ]);
});

test('a cell credited whole in the old ledger covers every code split out of it', () => {
  const subs = expandSubmissions([
    { row: 7, timestamp: '01/10/2026 10:00:00', phoneRaw: '0901111111', codeRaw: '260609METDYY8B\n260620J2SX4UUN' },
    { row: 9, timestamp: '02/10/2026 10:00:00', phoneRaw: '0902222222', codeRaw: '260609METDYY8B\n260620J2SX4UUN' },
  ]);
  const ledger = [{ code: '260609METDYY8B260620J2SX4UUN', orderId: '', phone: '0901111111' }];
  const r = evaluateSubmissions(subs, ledger, new Map(), new Map(), { waitDays: 15 }, new Date());
  assert.equal(r.credits.length, 0);
  assert.deepEqual(r.review.map(x => [x.submission.row, x.submission.codeRaw]), [[9, '260609METDYY8B'], [9, '260620J2SX4UUN']]);
});

test('splitCodes: words with a digit or two are not codes', () => {
  assert.deepEqual(splitCodes('2608100KK5BGBU package1'), ['2608100KK5BGBU']);
});
