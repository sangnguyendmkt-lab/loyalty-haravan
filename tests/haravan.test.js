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
