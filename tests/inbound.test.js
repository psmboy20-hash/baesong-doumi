'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { addInbound, receiveInbound, cancelInbound, expectedSoon, inboundList } = require('../lib/inbound');

function sampleDb() {
  return {
    nextId: 10,
    inventory: [
      { id: 1, name: 'Margot Denim Pants', color: 'Indigo', size: 'M', qty: 3, sku: 'C24-101-INDIGO-M' }
    ],
    inbound: [],
    stockLog: []
  };
}

test('입고 예정을 등록하면 재고 줄 정보를 복사해 expected 로 남는다', () => {
  const db = sampleDb();
  const r = addInbound(db, { inventoryId: 1, qty: 12, eta: '2026-09-10', memo: '9월 발주' }, { now: new Date('2026-09-06T01:00:00Z') });
  assert.equal(r.ok, true);
  assert.equal(r.item.id, 10);
  assert.equal(r.item.sku, 'C24-101-INDIGO-M');
  assert.equal(r.item.name, 'Margot Denim Pants');
  assert.equal(r.item.size, 'M');
  assert.equal(r.item.status, 'expected');
  assert.equal(db.inbound.length, 1);
  assert.equal(db.inventory[0].qty, 3, '등록만으로는 재고가 늘지 않는다');
});

test('수량·예정일이 이상하면 등록을 막는다', () => {
  const db = sampleDb();
  assert.match(addInbound(db, { inventoryId: 99, qty: 1, eta: '2026-09-10' }).error, /재고에서 골라/);
  assert.match(addInbound(db, { inventoryId: 1, qty: 0, eta: '2026-09-10' }).error, /1~9999/);
  assert.match(addInbound(db, { inventoryId: 1, qty: 5, eta: '9월 10일' }).error, /YYYY-MM-DD/);
  assert.equal(db.inbound.length, 0);
});

test('입고 확인은 재고를 늘리고 본사 입고로 장부 한 줄을 남긴다', () => {
  const db = sampleDb();
  const added = addInbound(db, { sku: 'C24-101-INDIGO-M', qty: 12, eta: '2026-09-10', memo: '9월 발주' }, { now: new Date('2026-09-06T01:00:00Z') });
  const r = receiveInbound(db, { id: added.item.id }, { now: new Date('2026-09-09T02:00:00Z') });
  assert.equal(r.ok, true);
  assert.equal(db.inventory[0].qty, 15);
  assert.equal(r.left, 15);
  assert.equal(db.inbound[0].status, 'received');
  assert.equal(db.inbound[0].receivedQty, 12);
  assert.equal(db.stockLog.length, 1);
  assert.equal(db.stockLog[0].reason, '본사 입고');
  assert.equal(db.stockLog[0].delta, 12);
  assert.equal(db.stockLog[0].left, 15);
  assert.equal(db.stockLog[0].ref, 'INB-' + added.item.id);
  assert.equal(db.stockLog[0].note, '9월 발주');
  assert.equal(db.stockLog[0].sku, 'C24-101-INDIGO-M');
});

test('입고 확인 수량을 고쳐 넣을 수 있고, 두 번 확인하거나 확인한 건을 취소할 수는 없다', () => {
  const db = sampleDb();
  const logged = [];
  const added = addInbound(db, { inventoryId: 1, qty: 12, eta: '2026-09-10' });
  const r = receiveInbound(db, { id: added.item.id, qty: 8 }, { logStock: (dbRef, inv, delta, reason, ref) => logged.push([inv.sku, delta, reason, ref]) });
  assert.equal(r.ok, true);
  assert.equal(db.inventory[0].qty, 11);
  assert.deepEqual(logged, [['C24-101-INDIGO-M', 8, '본사 입고', 'INB-' + added.item.id]]);
  assert.match(receiveInbound(db, { id: added.item.id }).error, /이미 처리/);
  assert.match(cancelInbound(db, { id: added.item.id }).error, /이미 입고 확인/);
  assert.match(receiveInbound(db, { id: 999 }).error, /찾지 못했/);
});

test('취소한 건은 목록에 남지만 입고 대상에서 빠진다', () => {
  const db = sampleDb();
  const a = addInbound(db, { inventoryId: 1, qty: 5, eta: '2026-09-07' });
  const b = addInbound(db, { inventoryId: 1, qty: 5, eta: '2026-09-30' });
  assert.equal(cancelInbound(db, { id: a.item.id }).ok, true);
  assert.equal(db.inbound[0].status, 'canceled');
  assert.equal(expectedSoon(db, '2026-09-06', 3).length, 0);
  assert.equal(expectedSoon(db, '2026-09-06', 30).length, 1);
  assert.equal(expectedSoon(db, '2026-09-06', 30)[0].id, b.item.id);
});

test('목록 읽기는 장부를 바꾸지 않는다', () => {
  const db = { inventory: [], nextId: 1 };
  assert.deepEqual(inboundList(db), []);
  assert.equal('inbound' in db, false, 'GET 만 해도 db.inbound 가 생기면 안 된다');
  assert.deepEqual(expectedSoon(db, '2026-09-06', 3), []);
  assert.equal('inbound' in db, false);
});
