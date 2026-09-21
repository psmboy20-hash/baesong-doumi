'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { linkVariantAliases, variantTargets, rowForVariant, variantCodeWrites } = require('../lib/variant-alias');
const { selectStockMatches } = require('../lib/operations');
const { planCafe24Push, reservedBySku } = require('../lib/channel-stock');

function rosieDb() {
  return {
    settings: { channelStock: { enabled: true, reserve: 0 } },
    products: [
      { no: 68, name: 'K#01_Rosie(Ivory)', customProductCode: 'SOLVERE-P68',
        variants: [{ variantCode: 'P00000CQ000A', customVariantCode: '', color: '아이보리', size: 'Free', cafe24Qty: 7, cafe24StockTracked: true }] },
      { no: 109, name: '[밀이 1st 마켓]K#01_Rosie(Ivory)', customProductCode: 'SOLVERE-P68',
        variants: [{ variantCode: 'P00000EF000A', customVariantCode: '', color: '아이보리', size: 'Free', cafe24Qty: 7, cafe24StockTracked: true }] },
      { no: 50, name: 'A#08_Ivy', customProductCode: 'SOLVERE-P50',
        variants: [{ variantCode: 'P00000BY000A', customVariantCode: '', color: '화이트', size: 'Free', cafe24Qty: 3, cafe24StockTracked: true }] }
    ],
    inventory: [
      { id: 1, sku: 'C24V-P00000CQ000A', name: 'K#01_Rosie(Ivory)', color: '아이보리', size: 'Free', qty: 7, productNo: 68, variantCode: 'P00000CQ000A', cafe24Qty: 7, cafe24StockTracked: true, stockVerifiedAt: '2026-09-21T02:11:00Z' },
      { id: 2, sku: 'C24V-P00000EF000A', name: '[밀이 1st 마켓]K#01_Rosie(Ivory)', color: '아이보리', size: 'Free', qty: null, productNo: 109, variantCode: 'P00000EF000A', cafe24Qty: 7, cafe24StockTracked: true, needsCount: true },
      { id: 3, sku: 'C24V-P00000BY000A', name: 'A#08_Ivy', color: '화이트', size: 'Free', qty: 3, productNo: 50, variantCode: 'P00000BY000A', cafe24Qty: 3, cafe24StockTracked: true, stockVerifiedAt: '2026-09-21T02:11:00Z' }
    ],
    orders: [], seeding: []
  };
}

test('상품 자체코드 + 색상·사이즈가 같으면 한 줄로 묶이고 빈 줄은 빠진다', () => {
  const db = rosieDb();
  const r = linkVariantAliases(db);
  assert.equal(r.linked, 1);
  assert.equal(r.removed, 1);
  assert.equal(db.inventory.length, 2);
  const rosie = db.inventory.find(i => i.id === 1);
  assert.equal(rosie.aliases.length, 1);
  assert.equal(rosie.aliases[0].variantCode, 'P00000EF000A');
  assert.equal(rosie.aliases[0].productNo, 109);
  // 다시 돌려도 같은 결과 (멱등)
  const again = linkVariantAliases(db);
  assert.equal(again.removed, 0);
  assert.equal(db.inventory.find(i => i.id === 1).aliases.length, 1);
});

test('수량이 잡혀 있는 중복 줄은 자동으로 합치지 않고 충돌로 알린다', () => {
  const db = rosieDb();
  db.inventory[1].qty = 2;
  db.inventory[1].stockVerifiedAt = '2026-09-21T03:00:00Z';
  const r = linkVariantAliases(db);
  assert.equal(r.conflicts.length, 1);
  assert.equal(db.inventory.length, 3);
});

test('묶인 옵션의 주문은 대표 줄에서 차감된다', () => {
  const db = rosieDb();
  linkVariantAliases(db);
  const matches = selectStockMatches(db.inventory, { product: 'Rosie', variantCode: 'P00000EF000A', qty: 1 });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 1);
  assert.equal(rowForVariant(db.inventory, 'P00000EF000A').id, 1);
  db.orders.push({ status: '대기', product: 'Rosie', variantCode: 'P00000EF000A', qty: 1, sourceChannel: 'cafe24', orderNo: 'X' });
  assert.equal(reservedBySku(db).get('C24V-P00000CQ000A'), 1);
});

test('채널 반영은 대표와 밀이 마켓 옵션 둘 다에 같은 가용 수량을 보낸다', () => {
  const db = rosieDb();
  linkVariantAliases(db);
  db.inventory.find(i => i.id === 1).qty = 5; // 실물 5 → 카페24 7과 다르니 둘 다 반영 대상
  const plan = planCafe24Push(db, { reserve: 0 });
  const rosieRows = plan.rows.filter(r => r.sku === 'C24V-P00000CQ000A');
  assert.equal(rosieRows.length, 2);
  assert.deepEqual(rosieRows.map(r => r.variantCode).sort(), ['P00000CQ000A', 'P00000EF000A']);
  assert.ok(rosieRows.every(r => r.available === 5));
  assert.equal(variantTargets(db.inventory[0]).length, 2);
});

test('품목코드 쓰기 목록은 대표 sku 를 비어 있는 옵션 전부에 넣는다', () => {
  const db = rosieDb();
  linkVariantAliases(db);
  const writes = variantCodeWrites(db);
  const rosie = writes.filter(w => w.code === 'C24V-P00000CQ000A');
  assert.deepEqual(rosie.map(w => w.variantCode).sort(), ['P00000CQ000A', 'P00000EF000A']);
  // 이미 다른 코드가 있으면 건드리지 않는다
  db.products[2].variants[0].customVariantCode = 'MY-IVY';
  assert.equal(variantCodeWrites(db).some(w => w.variantCode === 'P00000BY000A'), false);
});
