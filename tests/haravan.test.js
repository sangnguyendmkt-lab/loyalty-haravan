const test = require('node:test');
const assert = require('node:assert/strict');
const { flattenForProbe, buildQuery } = require('../src/haravan.js');

test('flattenForProbe lists nested paths and redacts personal data', () => {
  const rows = flattenForProbe({
    id: 1, name: '#1001', email: 'a@b.com', phone: '0901',
    customer: { first_name: 'An', last_name: 'Tran', total_spent: '100' },
    shipping_address: { address1: '1 Lê Lợi', province: 'Hà Nội', phone: '0902' },
    fulfillments: [{ tracking_number: 'SPX1', status: 'success' }],
  });
  assert.deepEqual(rows, [
    ['id', '1'], ['name', '#1001'], ['email', '[ẩn]'], ['phone', '[ẩn]'],
    ['customer.first_name', '[ẩn]'], ['customer.last_name', '[ẩn]'], ['customer.total_spent', '100'],
    ['shipping_address.address1', '[ẩn]'], ['shipping_address.province', 'Hà Nội'], ['shipping_address.phone', '[ẩn]'],
    ['fulfillments.0.tracking_number', 'SPX1'], ['fulfillments.0.status', 'success'],
  ]);
});

test('buildQuery encodes params and skips empty ones', () => {
  assert.equal(buildQuery({ limit: 50, page: 2, updated_at_min: '2025-08-01T00:00:00+07:00', x: '' }),
    '?limit=50&page=2&updated_at_min=2025-08-01T00%3A00%3A00%2B07%3A00');
  assert.equal(buildQuery({}), '');
});

const { toOrder, customersFromSheetRows } = require('../src/haravan.js');

// Redacted from the probe of order 1787759655 (Shopee) and 1789506213 (Lazada).
const shopeeRaw = {
  id: 1787759655, name: '260331K73WX8Q3', order_number: '260331K73WX8Q3', created_at: '2026-03-31T12:48:04Z',
  cancelled_at: null, cancelled_status: 'uncancelled', financial_status: 'paid', fulfillment_status: 'fulfilled',
  total_price: 254000, total_discounts: 36000, subtotal_price: 290000, source_name: 'shopee',
  shipping_address: { province: 'Hà Nội' },
  fulfillments: [{ tracking_number: 'SPXVN061698231174', carrier_status_code: 'delivered',
    delivered_date: '2026-04-03T03:34:15Z', return_date: null, cancel_date: null }],
};

test('toOrder maps a delivered marketplace order', () => {
  const o = toOrder(shopeeRaw);
  assert.equal(o.id, '1787759655');
  assert.equal(o.name, '260331K73WX8Q3');
  assert.equal(o.marketplaceCode, '260331K73WX8Q3');
  assert.equal(o.partnerTrackingCode, 'SPXVN061698231174');
  assert.equal(o.createdAt.toISOString(), '2026-03-31T12:48:04.000Z');
  assert.equal(o.delivered, true);
  assert.equal(o.deliveredAt.toISOString(), '2026-04-03T03:34:15.000Z');
  assert.equal(o.voided, false);
  assert.equal(o.valueAfterDiscount, 254000);
  assert.equal(o.province, 'Hà Nội');
  assert.equal(o.source, 'shopee');
});

test('toOrder handles string money and a missing fulfillment', () => {
  const o = toOrder({ id: 1, name: 'X', created_at: '2026-10-21T00:07:13Z', total_price: '1,821,506',
    shipping_address: null, fulfillments: [] });
  assert.equal(o.valueAfterDiscount, 1821506);
  assert.equal(o.delivered, false);
  assert.equal(o.deliveredAt, null);
  assert.equal(o.partnerTrackingCode, '');
  assert.equal(o.province, '');
});

test('toOrder marks cancelled, refunded and returned orders as voided', () => {
  assert.equal(toOrder(Object.assign({}, shopeeRaw, { cancelled_status: 'cancelled' })).voided, true);
  assert.equal(toOrder(Object.assign({}, shopeeRaw, { cancelled_at: '2026-04-01T00:00:00Z' })).voided, true);
  assert.equal(toOrder(Object.assign({}, shopeeRaw, { financial_status: 'refunded' })).voided, true);
  assert.equal(toOrder(Object.assign({}, shopeeRaw, { financial_status: 'partially_refunded' })).voided, true);
  assert.equal(toOrder(Object.assign({}, shopeeRaw, {
    fulfillments: [Object.assign({}, shopeeRaw.fulfillments[0], { return_date: '2026-04-05T00:00:00Z' })] })).voided, true);
});

test('customersFromSheetRows reads the Haravan customer export by header names', () => {
  const header = ['Họ và tên', 'Số điện thoại', 'Email', 'Tỉnh/Thành phố', 'Tổng chi tiêu',
    'Chi tiêu tích luỹ trong kỳ', 'Hạng thành viên', 'Điểm thưởng', 'Ngày đặt hàng cuối cùng'];
  const m = customersFromSheetRows([
    ['Thời điểm cập nhật 15/09/2026'],
    header,
    ['Nguyễn Thị Đào', 397192888, 'dao@x.com', '', 1314999, '1,314,999', 'Silver', 13, '2026-08-16T18:42:53+07:00'],
    ['Khách mới', '0907462499', '', 'Huế', 0, 0, '', 0, ''],
    ['Không SĐT', '', 'Ha@x.com', '', 0, 0, '', 0, ''],
    ['', '', '', '', '', '', '', '', ''],
  ]);
  assert.equal(m.size, 2);
  assert.deepEqual([...m.emailOwners], [['dao@x.com', '0397192888'], ['ha@x.com', '']]);
  const c = m.get('0397192888');
  assert.deepEqual([c.name, c.email, c.tier, c.points, c.totalSpent, c.periodSpent],
    ['Nguyễn Thị Đào', 'dao@x.com', 'Silver', 13, 1314999, 1314999]);
  assert.equal(c.lastOrderAt.toISOString(), '2026-08-16T11:42:53.000Z');
  assert.equal(m.get('0907462499').lastOrderAt, null);
});

test('customersFromSheetRows fails clearly when the phone header is missing', () => {
  assert.throws(() => customersFromSheetRows([['a', 'b']]), /Số điện thoại/);
});
