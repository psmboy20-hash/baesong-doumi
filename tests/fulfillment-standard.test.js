const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fulfillmentKey,
  inventorySku,
  ensureOperationalFields,
  applyCarrierDeliveryResult
} = require('../lib/operations');

test('같은 주문번호의 두 품목은 한 포장으로 묶는다', () => {
  const a = { id: 1, orderNo: '20260827-0001' };
  const b = { id: 2, orderNo: '20260827-0001' };
  assert.equal(fulfillmentKey('order', a), fulfillmentKey('order', b));
});

test('같은 주소여도 다른 주문은 자동 합포장하지 않는다', () => {
  const a = { id: 1, orderNo: 'ORDER-A', name: '홍길동', addr: '서울 같은 주소' };
  const b = { id: 2, orderNo: 'ORDER-B', name: '홍길동', addr: '서울 같은 주소' };
  assert.notEqual(fulfillmentKey('order', a), fulfillmentKey('order', b));
});

test('사용자가 같은 packGroupId를 지정한 출고만 합포장한다', () => {
  const a = { id: 1, orderNo: 'ORDER-A', packGroupId: 'PACK-10' };
  const b = { id: 2, orderNo: 'ORDER-B', packGroupId: 'PACK-10' };
  assert.equal(fulfillmentKey('order', a), fulfillmentKey('order', b));
});

test('SKU는 상품번호 컬러 사이즈로 안정적으로 생성된다', () => {
  const a = inventorySku({ productNo: 123, name: 'Clara Denim', color: 'Sky Blue', size: 'S' });
  const b = inventorySku({ productNo: 123, name: '이름이 바뀌어도 됨', color: 'skyblue', size: 's' });
  assert.equal(a, b);
  assert.equal(a, 'C24-123-SKYBLUE-S');
});

test('기존 장부에 출처 SKU RMA 번호를 보강한다', () => {
  const db = {
    orders: [{ id: 1, orderNo: 'O1', product: 'Clara', color: 'Skyblue', size: 'S' }],
    seeding: [{ id: 2, product: 'June' }],
    inventory: [{ id: 3, productNo: 7, name: 'Clara', color: 'Skyblue', size: 'S', qty: 2 }],
    returns: [{ id: 4, sourceType: 'orders', origInvoice: '123' }]
  };
  const changed = ensureOperationalFields(db);
  assert.equal(changed, true);
  assert.equal(db.orders[0].sourceChannel, 'cafe24');
  assert.equal(db.seeding[0].sourceChannel, 'seeding');
  assert.equal(db.inventory[0].sku, 'C24-7-SKYBLUE-S');
  assert.equal(db.returns[0].rmaNo, 'RMA-4');
  assert.equal(db.returns[0].sourceChannel, 'cafe24');
});

test('날짜가 오래돼도 택배사 완료 응답 없이는 배송완료가 되지 않는다', () => {
  const item = { delivered: false, sentDate: '2020-01-01' };
  assert.equal(applyCarrierDeliveryResult(item, { delivered: false, checked: true }), false);
  assert.equal(item.delivered, false);
  assert.equal(item.deliveryCheckStatus, '배송중');
});

test('택배사가 완료로 확인한 경우에만 배송완료로 바꾼다', () => {
  const item = { delivered: false };
  assert.equal(applyCarrierDeliveryResult(item, { delivered: true, checked: true }, '2026-08-27'), true);
  assert.equal(item.delivered, true);
  assert.equal(item.deliveredDate, '2026-08-27');
  assert.equal(item.deliverySource, 'carrier');
});
