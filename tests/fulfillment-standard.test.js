const test = require('node:test');
const assert = require('node:assert/strict');
const {
  epostOrderMissing,
  fulfillmentKey,
  inventorySku,
  ensureOperationalFields,
  applyCarrierDeliveryResult,
  splitShipmentItems,
  parcelReference,
  selectInvoiceParcelGroup,
  recordStockDeduction,
  getStockDeductions,
  restoreStockDeductions,
  parseLotteDeliveryStatus,
  cafe24ReturnKey,
  stockLedgerRef,
  inventoryCountKnown,
  availableStockDeduction,
  canFuzzyMergeOrders,
  variantIdentityAmbiguous,
  returnRestockAllowed,
  sheetWriteSucceeded,
  cafe24VariantInventory,
  markMissingCafe24Variants,
  variantAllocationState,
  shouldProcessStockDeduction,
  buildReturnRestockPlan,
  selectStockMatches
} = require('../lib/operations');
const { shipmentProductNotes } = require('../public/item-lines');

test('우체국 ERR-225는 미접수 확정으로 판단해 안전하게 재시도할 수 있다', () => {
  assert.equal(epostOrderMissing(new Error('ERR-225: 신청정보가 존재하지 않습니다.')), true);
  assert.equal(epostOrderMissing(new Error('ERR-322: 전화번호 형식 오류')), false);
  assert.equal(epostOrderMissing(new Error('우체국 접수 결과를 아직 확인하지 못했습니다.')), false);
});

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

test('Cafe24 variant_code가 있으면 품목코드를 최우선 SKU로 쓴다', () => {
  const sku = inventorySku({ productNo: 123, variantCode: 'P0000ABC0001', color: 'Skyblue', size: 'S' });
  assert.equal(sku, 'C24V-P0000ABC0001');
});

test('시딩 한 칸에 여러 제품이 있으면 재고 품목을 각각 나눈다', () => {
  const items = splitShipmentItems({
    product: 'W#02_June Washed Loose Denim (Midblue) S\nB#01_Claire Ivory Wide Pants(Ivory) L',
    qty: 1
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].size, 'S');
  assert.equal(items[1].size, 'L');
  assert.equal(items[0].qty, 1);
  assert.equal(items[1].qty, 1);
});

test('같은 제품 2개 주문은 한 품목 수량 2개를 유지한다', () => {
  const items = splitShipmentItems({ product: 'S#01_Clara Denim', color: 'Skyblue', size: 'S', qty: 2 });
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 2);
});

test('같은 상품의 서로 다른 사이즈는 각각 한 품목으로 분리한다', () => {
  const items = splitShipmentItems({
    product: 'B#05_Tessa Pigment Pants(Brown)\nB#05_Tessa Pigment Pants(Brown)',
    size: 'S,M',
    qty: 1
  });
  assert.deepEqual(items.map(item => ({ product: item.product, size: item.size, qty: item.qty })), [
    { product: 'B#05_Tessa Pigment Pants(Brown)', size: 'S', qty: 1 },
    { product: 'B#05_Tessa Pigment Pants(Brown)', size: 'M', qty: 1 }
  ]);
});

test('제품명 끝 괄호와 별표로 입력한 사이즈도 품목별로 분리한다', () => {
  const items = splitShipmentItems({
    product: 'S#02_Audrey Denim(Washedblue)(M)\nW#02_June Washed Loose Denim(Midblue) *S사이즈\nB#05_Tessa Pigment Pants(Brown)(L)'
  });
  assert.deepEqual(items.map(item => [item.product, item.size]), [
    ['S#02_Audrey Denim(Washedblue)', 'M'],
    ['W#02_June Washed Loose Denim(Midblue)', 'S'],
    ['B#05_Tessa Pigment Pants(Brown)', 'L']
  ]);
});

test('제품 칸의 별표 안내는 상품 수량에서 빼고 포장 비고로 분리한다', () => {
  const row = {
    product: 'S#02_Audrey Denim(Washedblue)(M)\nB#05_Tessa Pigment Pants(Brown)(S)\n*각 사이즈 확인 필요'
  };
  assert.equal(splitShipmentItems(row).length, 2);
  assert.deepEqual(shipmentProductNotes(row), ['각 사이즈 확인 필요']);
});

test('상품명이 비어도 우체국 접수 수량은 최소 한 품목을 유지한다', () => {
  const items = splitShipmentItems({ product: '', qty: 1 });
  assert.deepEqual(items.map(item => [item.product, item.qty]), [['', 1]]);
});

test('상품 한 줄에 사이즈를 여러 개 적어도 사이즈별 품목으로 분리한다', () => {
  const items = splitShipmentItems({ product: 'B#05_Tessa Pigment Pants(Brown)', size: 'S,M' });
  assert.deepEqual(items.map(item => [item.product, item.size, item.qty]), [
    ['B#05_Tessa Pigment Pants(Brown)', 'S', 1],
    ['B#05_Tessa Pigment Pants(Brown)', 'M', 1]
  ]);
});

test('기존 장부에 출처 SKU RMA 번호를 보강한다', () => {
  const db = {
    orders: [{ id: 1, orderNo: 'O1', product: 'Clara', color: 'Skyblue', size: 'S' }],
    seeding: [{ id: 2, product: 'June' }],
    inventory: [{ id: 3, productNo: 7, name: 'Clara', color: 'Skyblue', size: 'S', qty: 2 }],
    returns: [{ id: 4, sourceType: 'orders', origInvoice: '123' }],
    stockLog: [{ name: 'Clara', color: 'Skyblue', size: 'S', delta: -1 }]
  };
  const changed = ensureOperationalFields(db);
  assert.equal(changed, true);
  assert.equal(db.orders[0].sourceChannel, 'cafe24');
  assert.equal(db.seeding[0].sourceChannel, 'seeding');
  assert.equal(db.inventory[0].sku, 'C24-7-SKYBLUE-S');
  assert.equal(db.returns[0].rmaNo, 'RMA-4');
  assert.equal(db.returns[0].sourceChannel, 'cafe24');
  assert.equal(db.stockLog[0].sku, 'C24-7-SKYBLUE-S');
});

test('예전 완료 RMA는 이미 재고 반영된 건으로 이전한다', () => {
  const db = {
    orders: [], seeding: [], inventory: [], stockLog: [],
    returns: [{ id: 5, status: '완료', product: 'Clara', qty: 1 }]
  };
  ensureOperationalFields(db);
  assert.equal(db.returns[0].flowState, 'completed');
  assert.equal(db.returns[0].localCompleted, true);
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

test('송장 엑셀은 같은 고객의 다른 주문을 자동으로 합치지 않는다', () => {
  const pendings = [
    { type: 'order', item: { id: 1, orderNo: 'ORDER-A', name: '홍길동', phone: '010-1111-2222' } },
    { type: 'order', item: { id: 2, orderNo: 'ORDER-B', name: '홍길동', phone: '010-1111-2222' } }
  ];
  const ambiguous = selectInvoiceParcelGroup(pendings, { name: '홍길동', phone: '01011112222' });
  assert.equal(ambiguous.items.length, 0);
  assert.match(ambiguous.reason, /2건/);
  const exact = selectInvoiceParcelGroup(pendings, { name: '홍길동', phone: '01011112222', reference: 'ORDER-B' });
  assert.deepEqual(exact.items.map(x => x.item.id), [2]);
});

test('시딩 송장 엑셀에도 출고별 고유 참조번호를 만든다', () => {
  assert.equal(parcelReference('seeding', { id: 31 }), 'SEED-31');
});

test('여러 SKU 차감 수량을 취소 복구용으로 각각 기록한다', () => {
  const item = {};
  recordStockDeduction(item, 'SKU-A', 1);
  recordStockDeduction(item, 'SKU-B', 2);
  assert.deepEqual(getStockDeductions(item), [{ sku: 'SKU-A', qty: 1 }, { sku: 'SKU-B', qty: 2 }]);
  const inventory = [{ sku: 'SKU-A', qty: 4 }, { sku: 'SKU-B', qty: 1 }];
  const restored = restoreStockDeductions(item, inventory);
  assert.deepEqual(inventory.map(x => x.qty), [5, 3]);
  assert.equal(restored.restored, 3);
  assert.deepEqual(restored.missingSkus, []);
  assert.deepEqual(getStockDeductions(item), []);
});

test('롯데 페이지의 요약 배달결과만 배송완료로 인정한다', () => {
  const html = '<p>배달완료 안내 문구</p><table><caption>조회 테이블은 운송장 번호, 보내는 분, 받는 분, 상품명, 배달결과로 구성되어 있습니다.</caption><tbody><tr><td>123</td><td>A</td><td>B</td><td>상품인수</td></tr></tbody></table>';
  assert.deepEqual(parseLotteDeliveryStatus(html), { checked: true, delivered: false, status: '상품인수' });
  const done = html.replace('상품인수</td>', '배달완료</td>');
  assert.equal(parseLotteDeliveryStatus(done).delivered, true);
});

test('같은 상품이어도 다른 옵션의 Cafe24 RMA는 별개다', () => {
  const s = cafe24ReturnKey({ orderNo: 'O1', productNo: 10, product: 'Clara', color: 'Skyblue', size: 'S', _retKind: '교환' });
  const m = cafe24ReturnKey({ orderNo: 'O1', productNo: 10, product: 'Clara', color: 'Skyblue', size: 'M', _retKind: '교환' });
  assert.notEqual(s, m);
});

test('입출고 공개 장부 참조에는 고객 이름을 쓰지 않는다', () => {
  assert.equal(stockLedgerRef({ id: 9, name: '홍길동' }, 'seeding'), 'SEED-9');
  const db = { orders: [], seeding: [], inventory: [], returns: [], stockLog: [{ ref: '홍길동', name: 'Clara' }] };
  ensureOperationalFields(db);
  assert.equal(db.stockLog[0].ref, '');
});

test('옵션 재고는 실수량 확인 전 출고 차감 대상으로 보지 않는다', () => {
  assert.equal(inventoryCountKnown({ qty: null, needsCount: true }), false);
  assert.equal(inventoryCountKnown({ qty: 0, needsCount: false }), true);
});

test('출고 수량이 현재 재고보다 많아도 재고는 0 아래로 내려가지 않는다', () => {
  assert.deepEqual(availableStockDeduction(1, 3, 0), { deducted: 1, shortage: 2, left: 0 });
  assert.deepEqual(availableStockDeduction(5, 3, 1), { deducted: 2, shortage: 0, left: 3 });
});

test('기존 음수 재고는 0으로 보호하고 실사 필요로 표시한다', () => {
  const db = { orders: [], seeding: [], inventory: [{ id: 1, name: '테스트', qty: -1 }], returns: [], stockLog: [] };
  assert.equal(ensureOperationalFields(db), true);
  assert.equal(db.inventory[0].qty, 0);
  assert.equal(db.inventory[0].needsCount, true);
  assert.match(db.inventory[0].stockIssue, /실사/);
});

test('다른 Cafe24 주문이나 품목은 이름과 옵션이 같아도 합치지 않는다', () => {
  assert.equal(canFuzzyMergeOrders({ orderNo: 'A' }, { orderNo: 'B' }), false);
  assert.equal(canFuzzyMergeOrders({ orderNo: 'A', orderItemCode: 'I1' }, { orderNo: 'A', orderItemCode: 'I2' }), false);
  assert.equal(canFuzzyMergeOrders({ orderNo: 'A', orderItemCode: 'I1' }, { orderNo: 'A', orderItemCode: 'I1' }), true);
});

test('카페24 옵션이 같은 컬러와 사이즈로 중복되면 기존 재고를 임의 배정하지 않는다', () => {
  const variants = [
    { variantCode: 'V1', color: '', size: 'S' },
    { variantCode: 'V2', color: '', size: 'S' },
    { variantCode: 'V3', color: '', size: 'M' }
  ];
  assert.equal(variantIdentityAmbiguous(variants, variants[0]), true);
  assert.equal(variantIdentityAmbiguous(variants, variants[2]), false);
});

test('불량 회수품은 재고 복귀 요청이 있어도 입고하지 않는다', () => {
  assert.equal(returnRestockAllowed('damaged', true), false);
  assert.equal(returnRestockAllowed('sellable', false), false);
  assert.equal(returnRestockAllowed('sellable', true), true);
});

test('구글시트 기록은 성공 응답과 기록 건수가 모두 맞아야 완료로 인정한다', () => {
  assert.equal(sheetWriteSucceeded({ status: 200, json: { ok: true, written: 2 } }, 2), true);
  assert.equal(sheetWriteSucceeded({ status: 200, json: { ok: false, written: 2 } }, 2), false);
  assert.equal(sheetWriteSucceeded({ status: 200, json: { ok: true, written: 1 } }, 2), false);
});

test('카페24 재고관리 중인 옵션만 판매가능 수량으로 읽는다', () => {
  assert.deepEqual(cafe24VariantInventory({
    use_inventory: 'T', quantity: 7, safety_inventory: 2, inventory_control_type: 'A'
  }), { tracked: true, quantity: 7, safetyInventory: 2, controlType: 'A' });
  assert.deepEqual(cafe24VariantInventory({
    use_inventory: 'F', quantity: 0, inventory_control_type: 'A'
  }), { tracked: false, quantity: null, safetyInventory: null, controlType: 'A' });
  assert.deepEqual(cafe24VariantInventory({ use_inventory: 'T' }), {
    tracked: true, quantity: null, safetyInventory: null, controlType: ''
  });
  assert.deepEqual(cafe24VariantInventory({ use_inventory: 'T', quantity: null }), {
    tracked: true, quantity: null, safetyInventory: null, controlType: ''
  });
});

test('카페24 embedded inventories 값을 품목 표면 값보다 우선한다', () => {
  assert.deepEqual(cafe24VariantInventory({
    use_inventory: 'F', quantity: 0,
    inventories: { use_inventory: 'T', quantity: 11, safety_inventory: 3, inventory_control_type: 'B' }
  }), { tracked: true, quantity: 11, safetyInventory: 3, controlType: 'B' });
  assert.deepEqual(cafe24VariantInventory({
    use_inventory: 'T', quantity: 9,
    inventories: { use_inventory: 'T', quantity: null }
  }), { tracked: true, quantity: null, safetyInventory: null, controlType: '' });
});

test('카페24에서 사라진 옵션은 이전 판매가능 수량을 남기지 않는다', () => {
  const inventory = [
    { variantCode: 'KEEP', cafe24VariantActive: true, cafe24StockTracked: true, cafe24Qty: 5 },
    { variantCode: 'GONE', cafe24VariantActive: true, cafe24StockTracked: true, cafe24Qty: 9 }
  ];
  const changed = markMissingCafe24Variants(inventory, [{ variants: [{ variantCode: 'KEEP' }] }], '2026-08-27T00:00:00.000Z');
  assert.equal(changed, 1);
  assert.equal(inventory[0].cafe24Qty, 5);
  assert.deepEqual(inventory[1], {
    variantCode: 'GONE', cafe24VariantActive: false, cafe24StockTracked: false,
    cafe24Qty: null, cafe24SafetyInventory: null, cafe24StockAt: '2026-08-27T00:00:00.000Z'
  });
});

test('옵션별 재고 합계가 기존 총재고와 같을 때만 전환을 완료한다', () => {
  const aggregate = { qty: 5 };
  assert.deepEqual(variantAllocationState(aggregate, [{ qty: 2, needsCount: false }, { qty: 3, needsCount: false }]), {
    complete: true, matches: true, expected: 5, total: 5
  });
  assert.deepEqual(variantAllocationState(aggregate, [{ qty: 2, needsCount: false }, { qty: 2, needsCount: false }]), {
    complete: true, matches: false, expected: 5, total: 4
  });
  assert.deepEqual(variantAllocationState({ qty: 5, color: 'Blue' }, [
    { qty: 2, color: 'Blue', needsCount: false },
    { qty: 3, color: 'Blue', needsCount: false },
    { qty: 3, color: 'Ivory', needsCount: false }
  ]), { complete: true, matches: true, expected: 5, total: 5 });
  assert.deepEqual(variantAllocationState({ qty: 5, color: 'Blue' }, [
    { qty: 2, color: 'Ivory', needsCount: false },
    { qty: 3, color: 'Ivory', needsCount: false }
  ]), { complete: false, matches: false, expected: 5, total: 0 });
});

test('과거 출고 취소 후 재발송은 재고를 다시 차감하지 않는다', () => {
  assert.equal(shouldProcessStockDeduction({
    stockDeducted: true,
    stockDeductionIncomplete: false,
    stockDeductionDetails: [],
    legacyStockUnverified: true
  }), false);
});

test('반품 재고는 모든 품목이 정확히 매칭될 때만 한꺼번에 복귀한다', () => {
  const inv = { sku: 'SKU-A', qty: 3 };
  const items = [
    { product: 'Clara', option: 'Skyblue, M', color: 'Skyblue', size: 'M', qty: 1, sku: 'SKU-A' },
    { product: 'Tessa', option: 'Brown, L', color: 'Brown', size: 'L', qty: 1, sku: 'SKU-MISSING' }
  ];
  const plan = buildReturnRestockPlan(items, item => item.sku === 'SKU-A' ? [inv] : []);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.missing.length, 1);
  assert.equal(inv.qty, 3);
  const blank = buildReturnRestockPlan([{ product: '', option: '', qty: 1 }], () => []);
  assert.equal(blank.missing.length, 1);
  const empty = buildReturnRestockPlan([], () => []);
  assert.equal(empty.missing.length, 1);
});

test('재고 매칭은 안정된 식별자가 틀리거나 후보가 여러 개면 추측하지 않는다', () => {
  const inventory = [{ sku: 'SKU-A', variantCode: 'V-A', productNo: 10 }, { sku: 'SKU-B', variantCode: 'V-B', productNo: 20 }];
  assert.deepEqual(selectStockMatches(inventory, { sku: 'SKU-MISSING' }, () => true), []);
  assert.deepEqual(selectStockMatches(inventory, { variantCode: 'V-MISSING' }, () => true), []);
  assert.deepEqual(selectStockMatches(inventory, { product: 'same' }, () => true), []);
  assert.deepEqual(selectStockMatches(inventory, { sku: 'SKU-B' }, () => false), [inventory[1]]);
  const plan = buildReturnRestockPlan([{ product: 'same', sourceProductNo: 999, qty: 1 }], item =>
    selectStockMatches([inventory[0]], item, () => true));
  assert.equal(plan.rows.length, 0);
  assert.equal(plan.missing.length, 1);
});
