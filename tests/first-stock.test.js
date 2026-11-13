'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pickFirstStockFromCafe24, initFromCafe24 } = require('../lib/stock-ledger');

const row = extra => ({
  id: 1, name: 'Anna', color: '블랙', size: 'FREE', qty: null, needsCount: true,
  productNo: 156, variantCode: 'P00000GA000C', sku: 'C24V-P00000GA000C',
  cafe24Qty: 9, cafe24StockTracked: true, cafe24VariantActive: true, ...extra
});
const at = min => new Date(Date.UTC(2026, 10, 13, 10, min));

test('새 옵션 첫 수량: 카페24 숫자가 30분 동안 그대로일 때만 가져온다', () => {
  const db = { inventory: [row()], orders: [], seeding: [] };
  let r = pickFirstStockFromCafe24(db, at(0));
  assert.deepEqual(r.ready, []);
  assert.equal(r.touched, 1);
  assert.equal(db.inventory[0].cafe24FirstQtyWatch.qty, 9);

  assert.deepEqual(pickFirstStockFromCafe24(db, at(20)).ready, []);
  // 카페24에서 숫자를 고치면 처음부터 다시 기다린다
  db.inventory[0].cafe24Qty = 12;
  r = pickFirstStockFromCafe24(db, at(25));
  assert.deepEqual(r.ready, []);
  assert.equal(db.inventory[0].cafe24FirstQtyWatch.qty, 12);
  assert.deepEqual(pickFirstStockFromCafe24(db, at(50)).ready, []);
  assert.deepEqual(pickFirstStockFromCafe24(db, at(56)).ready, [1]);

  const applied = initFromCafe24(db, { ids: [1], now: at(56) });
  assert.equal(applied.applied, 1);
  assert.equal(db.inventory[0].qty, 12);
  assert.equal(db.inventory[0].needsCount, false);
  // 한 번 가져온 뒤로는 배송도우미가 기준 — 카페24 숫자가 바뀌어도 다시 가져오지 않는다
  db.inventory[0].cafe24Qty = 3;
  const after = pickFirstStockFromCafe24(db, at(120));
  assert.deepEqual(after.ready, []);
  assert.equal(db.inventory[0].cafe24FirstQtyWatch, undefined);
});

test('카페24 0개·재고관리 안 함·지운 옵션·이미 손댄 줄은 가져오지 않는다', () => {
  const db = { inventory: [
    row({ id: 1, cafe24Qty: 0 }),
    row({ id: 2, cafe24StockTracked: false }),
    row({ id: 3, cafe24VariantActive: false }),
    row({ id: 4, qty: 0, needsCount: false, stockVerifiedAt: '2026-11-01T00:00:00Z' }),
    row({ id: 5, qty: 7, needsCount: false }),
    row({ id: 6, retiredAggregate: true })
  ] };
  pickFirstStockFromCafe24(db, at(0));
  assert.deepEqual(pickFirstStockFromCafe24(db, at(40)).ready, []);
  assert.ok(db.inventory.every(i => !i.cafe24FirstQtyWatch));
});
