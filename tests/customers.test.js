'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  matchQ,
  customerKey,
  buildCustomerIndex,
  searchCustomers,
  getCustomer,
  setCustomerNote,
  globalSearch
} = require('../lib/customers');

function sampleDb() {
  return {
    orders: [
      { id: 1, name: '김하늘', phone: '010-1234-5678', addr: '서울 강남구 테헤란로 1', orderNo: '20260901-0000123',
        product: 'Margot Denim Pants', color: 'Indigo', size: 'M', qty: 1, status: '발송완료',
        invoice: '1234567890123', sentDate: '2026-09-02', regDate: '2026-09-01', sourceChannel: 'cafe24' },
      { id: 2, name: '김 하늘', phone: '01012345678', addr: '서울 강남구 테헤란로 1', orderNo: '29CM-77',
        product: 'Linen Shirt', option: 'White / S', qty: 2, status: '대기', regDate: '2026-09-05', sourceChannel: '29cm' },
      { id: 3, name: '박서준', phone: '010-9999-0000', addr: '부산 해운대구', product: 'Wool Coat',
        qty: 1, status: '대기', regDate: '2026-08-20', sourceChannel: 'cafe24' }
    ],
    seeding: [
      { id: 4, name: '김하늘', phone: '010-1234-5678', addr: '서울 강남구 테헤란로 1', product: 'Cotton Tee',
        qty: 1, status: '발송완료', sentDate: '2026-09-06', regDate: '2026-09-04' }
    ],
    returns: [
      { id: 5, kind: '교환', name: '김하늘', phone: '010-1234-5678', product: 'Margot Denim Pants',
        reason: '사이즈 교환', flowState: 'requested', regDate: '2026-09-03' }
    ],
    customerNotes: { '12345678': { note: 'VIP · 문 앞 배송', at: '2026-09-05T00:00:00.000Z' } }
  };
}

test('전화 뒤 8자리로 같은 사람의 주문·시딩·교환을 한 카드로 묶는다', () => {
  const index = buildCustomerIndex(sampleDb());
  const cust = index.get('12345678');
  assert.ok(cust, '전화 뒤 8자리가 고객 키');
  assert.equal(cust.orders.length, 3);           // 주문 2 + 시딩 1
  assert.equal(cust.returns.length, 1);
  assert.deepEqual(cust.counts, { orders: 2, seeding: 1, returns: 0, exchanges: 1 });
  assert.equal(cust.firstAt, '2026-09-02');
  assert.equal(cust.lastAt, '2026-09-06');
  assert.equal(cust.note, 'VIP · 문 앞 배송');
  assert.equal(cust.orders[0].date, '2026-09-06'); // 최근순
});

test('전화가 없으면 이름으로 묶고, 이름·전화 모두 없으면 빼놓는다', () => {
  assert.equal(customerKey({ name: '이여름', phone: '' }), 'n:이여름');
  assert.equal(customerKey({ name: '', phone: '010' }), '');
  const index = buildCustomerIndex({ orders: [{ id: 9, name: '이여름', phone: '', regDate: '2026-09-01' }], seeding: [], returns: [] });
  assert.ok(index.get('n:이여름'));
});

test('검색은 이름·전화·송장·주문번호 어디에 있어도 낱말이 다 들어 있으면 맞음', () => {
  assert.equal(matchQ('Margot Denim Pants (Indigo Blue)', 'margot indigo'), true);
  assert.equal(matchQ('Margot Denim Pants', 'margot 없음'), false);
  const db = sampleDb();
  assert.deepEqual(searchCustomers(db, '1234567890123').map(c => c.key), ['12345678']);
  assert.deepEqual(searchCustomers(db, '29CM-77').map(c => c.key), ['12345678']);
  const all = searchCustomers(db, '');
  assert.deepEqual(all.map(c => c.key), ['12345678', '99990000']); // 최근 활동순
  assert.equal(all[0].phone, '010-1234-5678');
});

test('메모는 저장·삭제되고 고객 카드에 다시 실려 나온다', () => {
  const db = sampleDb();
  assert.equal(setCustomerNote(db, '99990000', '  전화 먼저  ').ok, true);
  assert.equal(getCustomer(db, '99990000').note, '전화 먼저');
  setCustomerNote(db, '99990000', '   ');
  assert.equal(db.customerNotes['99990000'], undefined);
  assert.equal(getCustomer(db, '없는키'), null);
});

test('전역 검색은 고객·발송·교환반품을 함께 돌려준다', () => {
  const found = globalSearch(sampleDb(), '김하늘');
  assert.equal(found.customers.length, 1);
  assert.equal(found.shipments.length, 3);
  assert.equal(found.shipments[0].date, '2026-09-06');
  assert.equal(found.returns.length, 1);
  assert.equal(found.returns[0].kind, '교환');
  assert.deepEqual(globalSearch(sampleDb(), '   '), { customers: [], shipments: [], returns: [] });
});
