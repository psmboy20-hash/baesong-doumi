'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { monthlyStats, shippingCostRows, shipmentCsvRows, SHIPMENT_COLUMNS } = require('../lib/stats');
const { toCsv } = require('../lib/stock-ledger');

function sampleDb() {
  return {
    orders: [
      { id: 1, name: '김하늘', phone: '010-1234-5678', orderNo: '20260901-1', product: 'Margot Denim Pants',
        color: 'Indigo', size: 'M', qty: 1, price: 89000, orderAmount: 89000, status: '발송완료',
        sentDate: '2026-09-02', invoice: '1111', courier: '우체국', sourceChannel: 'cafe24',
        epost: { orderNo: 'E1', price: 3500 }, delivered: true, deliveredDate: '2026-09-04' },
      { id: 2, name: '김하늘', phone: '010-1234-5678', orderNo: '20260901-1', product: 'Linen Shirt',
        color: 'White', size: 'M', qty: 2, price: 50000, orderAmount: 89000, status: '발송완료',
        sentDate: '2026-09-02', invoice: '1111', sourceChannel: 'cafe24', epost: { orderNo: 'E1', price: 3500 } },
      { id: 3, name: '박서준', orderNo: '29CM-77', product: 'Wool Coat', size: 'L', qty: 1, status: '발송완료',
        sentDate: '2026-09-05', invoice: '2222', sourceChannel: '29cm', epost: { orderNo: 'E2', price: 4000 } },
      { id: 4, name: '이여름', product: 'Wool Coat', size: 'L', qty: 1, status: '대기', regDate: '2026-09-06' },
      { id: 5, name: '지난달', product: 'Old Item', size: 'S', qty: 5, status: '발송완료', sentDate: '2026-08-30',
        invoice: '3333', sourceChannel: 'cafe24', epost: { orderNo: 'E3', price: 3500 } }
    ],
    seeding: [
      { id: 6, name: '인플루언서', product: 'Cotton Tee', size: 'F', qty: 3, status: '발송완료',
        sentDate: '2026-09-05', invoice: '4444', epost: { orderNo: 'E4', price: 3000 } }
    ],
    returns: [
      { id: 7, kind: '교환', product: 'Margot Denim Pants', reason: '사이즈 교환', regDate: '2026-09-03' },
      { id: 8, kind: '반품', product: 'Wool Coat', reason: '단순 변심', regDate: '2026-09-04' },
      { id: 9, kind: '반품', product: 'Wool Coat', reason: '단순 변심', regDate: '2026-08-04' }
    ]
  };
}

test('월 집계는 그 달 발송건만 세고 택배는 포장 1건으로 묶는다', () => {
  const r = monthlyStats(sampleDb(), '2026-09');
  assert.equal(r.ym, '2026-09');
  assert.equal(r.sales.orders, 3);            // cafe24 주문 1 + 29cm 1 + 시딩 1
  assert.equal(r.sales.units, 7);             // 1 + 2 + 1 + 3
  assert.equal(r.sales.amount, 189000);       // 89000 + 50000*2
  assert.deepEqual(r.sales.byChannel['29cm'], { orders: 1, units: 1, amount: null });
  assert.equal(r.sales.byChannel.cafe24.orders, 1);
  assert.equal(r.shipping.parcels, 3);        // E1(2건 한 포장) + E2 + E4
  assert.equal(r.shipping.epostCost, 10500);
  assert.equal(r.shipping.avgCost, 3500);
  assert.deepEqual(r.shipping.byDay, [{ date: '2026-09-02', parcels: 1 }, { date: '2026-09-05', parcels: 2 }]);
});

test('상품·사이즈 비중과 클레임 집계', () => {
  const r = monthlyStats(sampleDb(), '2026-09');
  assert.equal(r.products.length, 4);
  assert.equal(r.products[0].name, 'Cotton Tee');
  assert.equal(r.products[0].units, 3);
  assert.equal(r.products[0].share, 42.9);    // 3 / 7
  const sizeM = r.sizes.find(s => s.size === 'M');
  assert.equal(sizeM.units, 3);
  assert.deepEqual(r.claims.total, 2);
  assert.equal(r.claims.exchanges, 1);
  assert.equal(r.claims.returns, 1);
  assert.deepEqual(r.claims.byReason[0], { reason: '사이즈 교환', n: 1 });
  assert.ok(r.claims.byProduct.some(row => row.name === 'Wool Coat' && row.n === 1));
});

test('금액을 모르는 달은 amount 가 null 이다', () => {
  const db = sampleDb();
  for (const o of db.orders) { delete o.price; delete o.orderAmount; }
  const r = monthlyStats(db, '2026-09');
  assert.equal(r.sales.amount, null);
  assert.equal(r.sales.byChannel.cafe24.amount, null);
  assert.equal(monthlyStats(db, '2026-12').sales.orders, 0);
});

test('택배비 CSV 는 포장 1건에 한 줄', () => {
  const rows = shippingCostRows(sampleDb(), '2026-09');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { date: '2026-09-02', name: '김하늘', invoice: '1111', price: 3500 });
});

test('발송 내역 CSV 는 단계 필터·검색·기간을 그대로 따른다', () => {
  const db = sampleDb();
  assert.equal(shipmentCsvRows(db, { filter: 'all' }).length, 6);
  assert.equal(shipmentCsvRows(db, { filter: 'pending' }).length, 1);
  assert.equal(shipmentCsvRows(db, { filter: 'done' }).length, 1);
  assert.equal(shipmentCsvRows(db, { filter: 'moving' }).length, 4);
  assert.equal(shipmentCsvRows(db, { from: '2026-09-01', to: '2026-09-03' }).length, 2);
  const found = shipmentCsvRows(db, { q: '2222' });
  assert.equal(found.length, 1);
  assert.equal(found[0].channel, '29CM');
  assert.equal(found[0].kind, '주문');
  const csv = toCsv(shipmentCsvRows(db, { q: '2222' }), SHIPMENT_COLUMNS);
  assert.ok(csv.startsWith('﻿보낸날,구분,채널,'), '엑셀에서 열리도록 BOM + 한글 열이름');
  assert.ok(csv.includes('29CM-77'));
});

test('가격 있는 품목과 0원 품목이 섞인 주문은 이중 계산되지 않는다', () => {
  const db = {
    orders: [
      // 같은 주문: 본품(89,000) + 0원 사은품(price 없음) → 결제금액 89,000 한 번만
      { id: 1, orderNo: 'A-1', product: '본품', qty: 1, price: 89000, orderAmount: 89000,
        status: '발송완료', sentDate: '2026-09-02', sourceChannel: 'cafe24' },
      { id: 2, orderNo: 'A-1', product: '사은품 파우치', qty: 1, orderAmount: 89000,
        status: '발송완료', sentDate: '2026-09-02', sourceChannel: 'cafe24' },
      // 모든 품목에 품목가가 있는 주문은 품목합
      { id: 3, orderNo: 'B-1', product: '셔츠', qty: 2, price: 30000, orderAmount: 99999,
        status: '발송완료', sentDate: '2026-09-03', sourceChannel: 'cafe24' }
    ],
    seeding: [], returns: []
  };
  const r = monthlyStats(db, '2026-09');
  assert.equal(r.sales.orders, 2);
  assert.equal(r.sales.units, 4);
  assert.equal(r.sales.amount, 89000 + 60000, '사은품 때문에 89,000 + 89,000 으로 세면 안 된다');
  assert.equal(r.sales.byChannel.cafe24.amount, 149000);
});

test('보낸 날짜가 없는 발송완료 건은 그 달 통계에서 뺀다', () => {
  const db = {
    orders: [{ id: 1, orderNo: 'C-1', product: '코트', qty: 1, price: 10000, status: '발송완료', regDate: '2026-09-01' }],
    seeding: [], returns: []
  };
  const r = monthlyStats(db, '2026-09');
  assert.equal(r.sales.orders, 0);
  assert.equal(r.sales.units, 0);
  assert.deepEqual(shippingCostRows(db, '2026-09'), []);
});

test("택배비는 '3,500원' 처럼 적혀 있어도 숫자로 읽는다", () => {
  const db = {
    orders: [
      { id: 1, orderNo: 'D-1', product: '코트', qty: 1, status: '발송완료', sentDate: '2026-09-02',
        invoice: '9999', epost: { orderNo: 'E9', price: '3,500원' } }
    ],
    seeding: [], returns: []
  };
  assert.equal(monthlyStats(db, '2026-09').shipping.epostCost, 3500);
  assert.equal(shippingCostRows(db, '2026-09')[0].price, 3500);
});
