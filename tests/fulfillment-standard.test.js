const test = require('node:test');
const assert = require('node:assert/strict');
const {
  epostOrderMissing,
  releaseMissingEpostOperations,
  fulfillmentKey,
  expandSelectedFulfillments,
  fulfillmentGroupConflicts,
  inventorySku,
  ensureOperationalFields,
  applyCarrierDeliveryResult,
  splitShipmentItems,
  parcelContent,
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
  selectStockMatches,
  splitOrderLineForLater,
  releaseSplitOrderLine,
  undoSplitOrder,
  groupCafe24ShipmentItems,
  cafe24ShipmentItemsReady,
  sameCafe24OrderItem,
  resolvePackingMergeSelection,
  markPrintedFulfillments,
  prepareEpostCancellation,
  setEpostCancellationState,
  finalizeEpostCancellation,
  flagMissingCanceledSheetSource,
  shipmentOperationKey,
  classifyCafe24Shipment,
  setExternalSyncState,
  clearExternalSyncState
} = require('../lib/operations');
const {
  expandSelectedEpostItems,
  fullySelectedEntries,
  shipmentProductNotes,
  epostFilterMatches,
  cafe24MergeSuggestions,
  shipmentStockStates,
  sentShipmentKey,
  hasVirtualPhone
} = require('../public/item-lines');

test('우체국 픽업 대기는 접수 후 기사님이 가져가기 전 송장만 포함한다', () => {
  const base = { status: '발송완료', delivered: false, epost: {} };
  for (const stus of ['00', '01', '02']) {
    assert.equal(epostFilterMatches({ ...base, epost: { stus } }, 'pickup'), true);
  }
  assert.equal(epostFilterMatches({ ...base, epost: { stus: '03' } }, 'pickup'), false);
  assert.equal(epostFilterMatches({ ...base, epost: { stus: '04' } }, 'pickup'), false);
  assert.equal(epostFilterMatches({ ...base, epost: { stus: '05' } }, 'pickup'), false);
  assert.equal(epostFilterMatches({ ...base, delivered: true, epost: { stus: '02' } }, 'pickup'), false);
  assert.equal(epostFilterMatches({ ...base, status: '대기', epost: { stus: '02' } }, 'pickup'), false);
});

test('우체국 인쇄 필요와 확인 필요 목록도 각각 해당 송장만 포함한다', () => {
  const base = { status: '발송완료', delivered: false, epost: { stus: '02', label: {} }, printed: false };
  assert.equal(epostFilterMatches(base, 'print'), true);
  assert.equal(epostFilterMatches({ ...base, printed: true }, 'print'), false);
  assert.equal(epostFilterMatches({ ...base, epost: { stus: '04', label: {} } }, 'problem'), true);
  assert.equal(epostFilterMatches({ ...base, epost: { stus: '03', label: {} } }, 'problem'), false);
  assert.equal(epostFilterMatches({ ...base, epost: { stus: '02', label: null } }, 'print'), true);
});

test('임시 가상번호 안내는 실제 번호와 다른 가상번호가 있을 때만 표시한다', () => {
  assert.equal(hasVirtualPhone({ vTelNo: '050412345678' }, '01012345678'), true);
  assert.equal(hasVirtualPhone({ vTelNo: '01012345678' }, '010-1234-5678'), false);
  assert.equal(hasVirtualPhone({}, '010-1234-5678'), false);
});

test('우체국 ERR-225는 미접수 확정으로 판단해 안전하게 재시도할 수 있다', () => {
  assert.equal(epostOrderMissing(new Error('ERR-225: 신청정보가 존재하지 않습니다.')), true);
  assert.equal(epostOrderMissing(new Error('ERR-322: 전화번호 형식 오류')), false);
  assert.equal(epostOrderMissing(new Error('우체국 접수 결과를 아직 확인하지 못했습니다.')), false);

  const missing = { epostOp: { state: 'unknown', orderNo: 'HAM-1' } };
  const other = { epostOp: { state: 'unknown', orderNo: 'HAM-2' } };
  assert.equal(releaseMissingEpostOperations([{ item: missing }], new Error('ERR-225: 신청정보가 존재하지 않습니다.'), '2026-09-01T00:00:00.000Z'), true);
  assert.equal(missing.epostOp.state, 'not_found');
  assert.equal(missing.epostOp.resolvedAt, '2026-09-01T00:00:00.000Z');
  assert.match(missing.epostOp.error, /다시 접수/);
  assert.equal(releaseMissingEpostOperations([{ item: other }], new Error('ERR-322: 전화번호 형식 오류')), false);
  assert.equal(other.epostOp.state, 'unknown');
});

test('저장돼 있던 ERR-225 잠금만 시작할 때 풀고 다른 우체국 오류는 유지한다', () => {
  const db = {
    orders: [{ id: 1, epostOp: { state: 'unknown', error: 'ERR-322: 전화번호 형식 오류' } }],
    seeding: [{ id: 2, epostOp: { state: 'unknown', error: 'ERR-225: 신청정보가 존재하지 않습니다.' } }],
    inventory: [], returns: [], stockLog: []
  };
  assert.equal(ensureOperationalFields(db), true);
  assert.equal(db.orders[0].epostOp.state, 'unknown');
  assert.equal(db.seeding[0].epostOp.state, 'not_found');
});

test('같은 주문번호의 두 품목은 한 포장으로 묶는다', () => {
  const a = { id: 1, orderNo: '20260827-0001' };
  const b = { id: 2, orderNo: '20260827-0001' };
  assert.equal(fulfillmentKey('order', a), fulfillmentKey('order', b));
});

test('같은 주문에서도 분리배송 표시가 붙은 품목은 별도 택배가 된다', () => {
  const ready = { id: 1, orderNo: 'ORDER-1' };
  const delayed = { id: 2, orderNo: 'ORDER-1', parcelSplitId: 'SPLIT-2' };
  assert.notEqual(fulfillmentKey('order', ready), fulfillmentKey('order', delayed));
  assert.match(parcelReference('order', delayed), /^ORDER-1-SPLIT-/);
});

test('사용자가 확정한 합포장은 분리배송 표시보다 우선한다', () => {
  const a = { id: 1, orderNo: 'ORDER-1', parcelSplitId: 'SPLIT-1', packGroupId: 'PACK-A' };
  const b = { id: 2, orderNo: 'ORDER-2', packGroupId: 'PACK-A' };
  assert.equal(fulfillmentKey('order', a), fulfillmentKey('order', b));
});

test('분리배송 번호가 우연히 같아도 다른 주문이나 시딩은 합쳐지지 않는다', () => {
  const a = { id: 1, orderNo: 'ORDER-A', parcelSplitId: 'SPLIT-1' };
  const b = { id: 2, orderNo: 'ORDER-B', parcelSplitId: 'SPLIT-1' };
  const seed = { id: 3, parcelSplitId: 'SPLIT-1' };
  assert.notEqual(fulfillmentKey('order', a), fulfillmentKey('order', b));
  assert.equal(fulfillmentKey('seeding', seed), 'seeding|3');
});

test('같은 수취인의 서로 다른 Cafe24 주문만 합포를 권유한다', () => {
  const common = { name: '고객', phone: '010-1111-2222', addr: '서울시 같은 주소', status: '대기' };
  const suggestions = cafe24MergeSuggestions([
    { kind: 'orders', x: { ...common, id: 1, orderNo: 'ORDER-A', product: 'Clara' } },
    { kind: 'orders', x: { ...common, id: 2, orderNo: 'ORDER-B', product: 'Tessa' } },
    { kind: 'seeding', x: { ...common, id: 3, product: 'June' } },
    { kind: 'orders', x: { ...common, id: 4, orderNo: 'ORDER-A', product: 'June' } }
  ]);
  assert.equal(suggestions.length, 1);
  assert.deepEqual(suggestions[0].orderNos, ['ORDER-A', 'ORDER-B']);
  assert.deepEqual(suggestions[0].entries.map(entry => entry.x.id), [1, 4, 2]);
});

test('한 품목이라도 분리한 주문 전체는 다른 주문과 합포로 권유하지 않는다', () => {
  const common = { name: '고객', phone: '010-1111-2222', addr: '서울시 같은 주소', status: '대기', orderNo: 'ORDER-A' };
  const suggestions = cafe24MergeSuggestions([
    { kind: 'orders', x: { ...common, id: 1, product: 'Clara' } },
    { kind: 'orders', x: { ...common, id: 2, product: 'Tessa', parcelSplitId: 'SPLIT-2', shippingHold: true } },
    { kind: 'orders', x: { ...common, id: 3, orderNo: 'ORDER-B', product: 'June' } }
  ]);
  assert.deepEqual(suggestions, []);
});

test('이미 일부 발송된 Cafe24 주문은 남은 행만 다른 주문과 합포 권유하지 않는다', () => {
  const common = { name: '고객', phone: '010-1111-2222', addr: '서울시 같은 주소' };
  const pending = [
    { kind: 'orders', x: { ...common, id: 2, orderNo: 'ORDER-A', status: '대기', product: 'Tessa' } },
    { kind: 'orders', x: { ...common, id: 3, orderNo: 'ORDER-B', status: '대기', product: 'June' } }
  ];
  const allOrders = [
    { kind: 'orders', x: { ...common, id: 1, orderNo: 'ORDER-A', status: '발송완료', invoice: '111', product: 'Clara' } },
    ...pending
  ];
  assert.deepEqual(cafe24MergeSuggestions(pending, allOrders), []);
});

test('실물재고가 부족한 Cafe24 품목만 분리배송 권장으로 표시한다', () => {
  const states = shipmentStockStates([
    { id: 1, variantCode: 'V-S', product: 'Clara', qty: 1 },
    { id: 2, variantCode: 'V-M', product: 'Tessa', qty: 1 },
    { id: 3, variantCode: 'V-L', product: 'June', qty: 1 }
  ], [
    { id: 11, variantCode: 'V-S', qty: 2, needsCount: false },
    { id: 12, variantCode: 'V-M', qty: 0, needsCount: false },
    { id: 13, variantCode: 'V-L', qty: null, needsCount: true }
  ]);
  assert.equal(states.get(1).state, 'enough');
  assert.equal(states.get(2).state, 'shortage');
  assert.equal(states.get(2).shortage, 1);
  assert.equal(states.get(3).state, 'unknown');
});

test('같은 SKU 주문이 2개이고 재고가 1개면 먼저 온 한 건만 발송 가능으로 배정한다', () => {
  const states = shipmentStockStates([
    { id: 2, variantCode: 'V-S', product: 'Clara', qty: 1, orderedAt: '2026-09-01T11:00:00+09:00' },
    { id: 1, variantCode: 'V-S', product: 'Clara', qty: 1, orderedAt: '2026-09-01T10:00:00+09:00' }
  ], [{ id: 11, variantCode: 'V-S', qty: 1, needsCount: false }]);
  assert.equal(states.get(1).state, 'enough');
  assert.equal(states.get(2).state, 'shortage');
  assert.equal(states.get(2).available, 0);
  assert.equal(states.get(2).shortage, 1);
});

test('송장번호 없는 분리배송도 분리번호별 택배 건수로 구분한다', () => {
  const common = { status: '발송완료', orderNo: 'ORDER-1', sentDate: '2026-09-01' };
  const first = sentShipmentKey({ ...common, parcelSplitId: 'SPLIT-A' }, '고객|주소');
  const second = sentShipmentKey({ ...common, parcelSplitId: 'SPLIT-B' }, '고객|주소');
  assert.notEqual(first, second);
  assert.equal(sentShipmentKey({ ...common }, '고객|주소'), sentShipmentKey({ ...common }, '다른표기'));
});

test('한 주문의 품목 하나를 나중 배송으로 떼고 입고 후 별도 송장으로 풀 수 있다', () => {
  const orders = [
    { id: 1, orderNo: 'ORDER-1', status: '대기', product: 'Clara' },
    { id: 2, orderNo: 'ORDER-1', status: '대기', product: 'Tessa' },
    { id: 3, orderNo: 'ORDER-1', status: '대기', product: 'June' }
  ];
  const split = splitOrderLineForLater(orders, 2, 'SPLIT-2');
  assert.equal(split.ok, true);
  assert.equal(orders[1].parcelSplitId, 'SPLIT-2');
  assert.equal(orders[1].shippingHold, true);
  assert.notEqual(fulfillmentKey('order', orders[0]), fulfillmentKey('order', orders[1]));

  const released = releaseSplitOrderLine(orders, 2);
  assert.equal(released.ok, true);
  assert.equal(orders[1].shippingHold, undefined);
  assert.equal(orders[1].parcelSplitId, 'SPLIT-2');
});

test('분리배송 취소는 같은 원주문의 대기 품목을 다시 한 송장으로 합친다', () => {
  const orders = [
    { id: 1, orderNo: 'ORDER-1', status: '대기' },
    { id: 2, orderNo: 'ORDER-1', status: '대기', parcelSplitId: 'SPLIT-2', shippingHold: true }
  ];
  const undone = undoSplitOrder(orders, 'ORDER-1');
  assert.equal(undone.ok, true);
  assert.equal(orders[1].parcelSplitId, undefined);
  assert.equal(orders[1].shippingHold, undefined);
  assert.equal(fulfillmentKey('order', orders[0]), fulfillmentKey('order', orders[1]));
});

test('한 품목뿐인 주문이나 이미 합포·접수된 품목은 분리배송으로 바꾸지 않는다', () => {
  assert.match(splitOrderLineForLater([{ id: 1, orderNo: 'ORDER-1', status: '대기' }], 1, 'SPLIT-1').error, /두 품목/);
  assert.match(splitOrderLineForLater([
    { id: 1, orderNo: 'ORDER-1', status: '대기', packGroupId: 'PACK-1' },
    { id: 2, orderNo: 'ORDER-1', status: '대기' }
  ], 1, 'SPLIT-1').error, /합포장/);
  assert.match(splitOrderLineForLater([
    { id: 1, orderNo: 'ORDER-1', status: '발송완료', invoice: '123' },
    { id: 2, orderNo: 'ORDER-1', status: '대기' }
  ], 1, 'SPLIT-1').error, /보낼 준비/);
  assert.match(splitOrderLineForLater([
    { id: 1, orderNo: 'ORDER-1', status: '발송완료', invoice: '123' },
    { id: 2, orderNo: 'ORDER-1', status: '대기' },
    { id: 3, orderNo: 'ORDER-1', status: '대기' }
  ], 2, 'SPLIT-2').error, /이미 접수하거나 발송/);
});

test('합포 서버는 Cafe24 주문 전체를 포함하고 부적합한 행이 하나라도 있으면 전부 거절한다', () => {
  const common = { name: '고객', phone: '010-1111-2222', addr: '서울시 같은 주소', status: '대기' };
  const db = {
    orders: [
      { ...common, id: 1, orderNo: 'ORDER-A', product: 'Clara' },
      { ...common, id: 2, orderNo: 'ORDER-A', product: 'Tessa' },
      { ...common, id: 3, orderNo: 'ORDER-B', product: 'June' }
    ],
    seeding: []
  };
  const resolved = resolvePackingMergeSelection(db, [{ type: 'order', id: 1 }, { type: 'order', id: 3 }]);
  assert.equal(resolved.error, undefined);
  assert.deepEqual(resolved.picked.map(entry => entry.item.id), [1, 2, 3]);

  db.orders[1].shippingHold = true;
  const blocked = resolvePackingMergeSelection(db, [{ type: 'order', id: 1 }, { type: 'order', id: 3 }]);
  assert.match(blocked.error, /재고 기다림|분리배송/);
  assert.deepEqual(blocked.picked, []);
});

test('재고 대기 품목이 같은 포장에 섞여 있으면 포장 전체 접수를 막는다', () => {
  const db = {
    orders: [
      { id: 1, orderNo: 'ORDER-A', packGroupId: 'PACK-1', name: '고객', status: '대기' },
      { id: 2, orderNo: 'ORDER-B', packGroupId: 'PACK-1', name: '고객', status: '대기', shippingHold: true }
    ],
    seeding: []
  };
  const conflicts = fulfillmentGroupConflicts(db, [{ type: 'order', id: 1 }]);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0].reason, /재고 기다림/);
});

test('같은 Cafe24 주문의 분리 송장 두 개는 Cafe24에도 각각 등록한다', () => {
  const groups = groupCafe24ShipmentItems([
    { type: 'order', item: { orderNo: 'ORDER-1', orderItemCode: 'ITEM-A', invoice: '111', cafe24Shipped: false } },
    { type: 'order', item: { orderNo: 'ORDER-1', orderItemCode: 'ITEM-B', invoice: '222', cafe24Shipped: false } },
    { type: 'order', item: { orderNo: 'ORDER-1', orderItemCode: 'ITEM-C', invoice: '111', cafe24Shipped: false } }
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => [group.orderNo, group.invoice, group.items.map(item => item.orderItemCode)]), [
    ['ORDER-1', '111', ['ITEM-A', 'ITEM-C']],
    ['ORDER-1', '222', ['ITEM-B']]
  ]);
});

test('같은 Cafe24 품목을 수량 때문에 여러 줄로 나눠도 송장 등록 대상이다', () => {
  assert.equal(cafe24ShipmentItemsReady([
    { orderItemCode: 'ITEM-A', qty: 1 },
    { orderItemCode: 'ITEM-A', qty: 2 }
  ]), true);
  assert.equal(cafe24ShipmentItemsReady([
    { orderItemCode: 'ITEM-A' },
    { orderItemCode: '' }
  ]), false);
});

test('카페24 송장은 주문번호 송장번호 품목코드 전체로 중복을 판정한다', () => {
  const key = shipmentOperationKey('ORDER-1', '6890-1234', ['B', 'A', 'A']);
  assert.equal(key, 'ORDER-1|68901234|A,B');
  const shipments = [
    { tracking_no: '68901234', order_item_code: ['A', 'B'] },
    { tracking_no: '77770000', order_item_code: ['C'] }
  ];
  assert.equal(classifyCafe24Shipment(shipments, '68901234', ['B', 'A']), 'exact');
  assert.equal(classifyCafe24Shipment(shipments, '68901234', ['A']), 'conflict');
  assert.equal(classifyCafe24Shipment(shipments, '99990000', ['A']), 'missing');
});

test('외부 연동 실패는 새로고침 뒤에도 남고 성공하면 해당 문제만 지운다', () => {
  const item = {};
  setExternalSyncState(item, 'cafe24', 'shipment', 'unknown', '확인 중', 'KEY-1', '2026-09-03T11:00:00.000Z');
  setExternalSyncState(item, 'sheet', 'invoice', 'failed', '기록 실패', 'KEY-2', '2026-09-03T11:01:00.000Z');
  assert.equal(item.syncOps.cafe24Shipment.state, 'unknown');
  assert.equal(item.syncIssues.length, 2);
  clearExternalSyncState(item, 'cafe24', 'shipment', 'KEY-1', '2026-09-03T11:02:00.000Z');
  assert.equal(item.syncOps.cafe24Shipment.state, 'success');
  assert.deepEqual(item.syncIssues.map(row => row.system), ['sheet']);
});

test('같은 주문·상품·옵션이어도 Cafe24 품목코드가 다르면 정상 분리배송이다', () => {
  const sent = { orderNo: 'ORDER-1', orderItemCode: 'ITEM-A', product: 'Clara', option: 'Skyblue, S' };
  const another = { orderNo: 'ORDER-1', orderItemCode: 'ITEM-B', product: 'Clara', option: 'Skyblue, S' };
  const replay = { orderNo: 'ORDER-1', orderItemCode: 'ITEM-A', product: 'Clara', option: 'Skyblue, S' };
  assert.equal(sameCafe24OrderItem(sent, another), false);
  assert.equal(sameCafe24OrderItem(sent, replay), true);
  assert.equal(sameCafe24OrderItem(
    { orderNo: 'ORDER-1', product: 'Clara', option: 'Skyblue, S' },
    { orderNo: 'ORDER-1', orderItemCode: 'ITEM-A', product: 'Clara', option: 'Skyblue, S' }
  ), true);
});

test('합포 송장은 모든 상품명 옵션 수량을 우체국 내용품으로 만든다', () => {
  const content = parcelContent([
    { product: 'Clara Denim', color: 'Skyblue', size: 'S', qty: 1 },
    { product: 'Tessa Pants', color: 'Brown', size: 'M', qty: 1 },
    { product: 'June Denim', color: 'Midblue', size: 'L', qty: 2 }
  ]);
  assert.equal(content.products, 'Clara Denim / Tessa Pants / June Denim');
  assert.equal(content.models, 'Skyblue S / Brown M / Midblue L');
  assert.equal(content.qty, 4);
  assert.equal(content.rows.length, 3);
});

test('합포 송장 인쇄는 첫 행만 선택해도 같은 우체국 주문의 상품을 전부 불러온다', () => {
  const db = {
    orders: [
      { id: 1, product: 'Clara', epost: { orderNo: 'HAM-ONE' } },
      { id: 2, product: 'Tessa', epost: { orderNo: 'HAM-ONE' } },
      { id: 3, product: 'June', epost: { orderNo: 'HAM-TWO' } }
    ],
    seeding: []
  };
  const rows = expandSelectedEpostItems(db, [{ type: 'order', id: 1 }]);
  assert.deepEqual(rows.map(row => row.it.product), ['Clara', 'Tessa']);
});

test('같은 주문의 일부 행만 선택된 상태면 화면은 접수 목록을 만들지 않는다', () => {
  const entries = [
    { x: { id: 1, orderNo: 'ORDER-1', _sel: false } },
    { x: { id: 2, orderNo: 'ORDER-1' } }
  ];
  const selected = fullySelectedEntries(entries, entry => entry.x.orderNo, entry => entry.x._sel !== false);
  assert.deepEqual(selected, []);
});

test('서버는 같은 주문의 한 행만 받아도 모든 상품 행을 한 포장으로 확장한다', () => {
  const db = {
    orders: [
      { id: 1, orderNo: 'ORDER-1', product: 'Clara' },
      { id: 2, orderNo: 'ORDER-1', product: 'Tessa' },
      { id: 3, orderNo: 'ORDER-2', product: 'June' }
    ],
    seeding: []
  };
  assert.deepEqual(expandSelectedFulfillments(db, [{ type: 'order', id: 1 }]), [
    { type: 'order', id: 1 },
    { type: 'order', id: 2 }
  ]);
});

test('라벨은 실제 인쇄 확인 뒤에만 같은 송장의 모든 상품을 인쇄 완료로 기록한다', () => {
  const db = {
    orders: [
      { id: 1, orderNo: 'ORDER-1', epost: { orderNo: 'HAM-1', regiNo: '123', label: {} } },
      { id: 2, orderNo: 'ORDER-1', epost: { orderNo: 'HAM-1', regiNo: '123', label: {} } },
      { id: 3, orderNo: 'ORDER-2' }
    ],
    seeding: []
  };

  const result = markPrintedFulfillments(db, [
    { type: 'order', id: 1 },
    { type: 'order', id: 3 }
  ], '2026-09-03T10:00:00.000Z');

  assert.deepEqual(result, { parcels: 1, items: 2 });
  assert.equal(db.orders[0].printed, true);
  assert.equal(db.orders[1].printed, true);
  assert.equal(db.orders[0].printedAt, '2026-09-03T10:00:00.000Z');
  assert.equal(db.orders[1].printedAt, '2026-09-03T10:00:00.000Z');
  assert.equal(db.orders[2].printed, undefined);
});

test('복구된 우체국 송장은 라벨 데이터가 없어도 사이트 인쇄 완료로 기록한다', () => {
  const db = {
    orders: [
      { id: 1, invoice: '6890000000001', epost: { orderNo: 'HAM-RECOVERED', regiNo: '6890000000001', label: null } },
      { id: 2, invoice: '6890000000001', epost: { orderNo: 'HAM-RECOVERED', regiNo: '6890000000001', label: null } }
    ],
    seeding: []
  };
  const result = markPrintedFulfillments(db, [{ type: 'order', id: 1 }], '2026-09-03T11:00:00.000Z');
  assert.deepEqual(result, { parcels: 1, items: 2 });
  assert.equal(db.orders[0].printed, true);
  assert.equal(db.orders[1].printed, true);
});

test('우체국 취소는 성공 상태를 저장한 뒤 로컬 장부를 한 번만 되돌린다', () => {
  const db = {
    inventory: [{ sku: 'SKU-1', qty: 4 }],
    orders: [{
      id: 1, orderNo: 'ORDER-1', orderItemCode: 'ITEM-1', status: '발송완료',
      invoice: '6890000000002', sentDate: '2026-09-03', cafe24Shipped: true,
      stockDeducted: true, stockDeductionDetails: [{ sku: 'SKU-1', qty: 1 }],
      epost: { orderNo: 'HAM-CANCEL', reqNo: 'REQ', resNo: 'RES', reqYmd: '20260903', regiNo: '6890000000002' }
    }],
    seeding: []
  };
  const prepared = prepareEpostCancellation(db, 'order', 1, '2026-09-03T12:00:00.000Z');
  assert.equal(prepared.operation.state, 'pending');
  setEpostCancellationState(db, prepared.orderNo, 'epost_canceled', '', '2026-09-03T12:01:00.000Z');
  const restore = entry => restoreStockDeductions(entry.item, db.inventory);
  const first = finalizeEpostCancellation(db, prepared.orderNo, restore, '2026-09-03T12:02:00.000Z');
  const second = finalizeEpostCancellation(db, prepared.orderNo, restore, '2026-09-03T12:03:00.000Z');
  assert.equal(first.entries.length, 1);
  assert.equal(second.entries.length, 1);
  assert.equal(db.inventory[0].qty, 5);
  assert.equal(db.orders[0].status, '대기');
  assert.equal(db.orders[0].invoice, '');
  assert.equal(db.orders[0].epost, undefined);
  assert.equal(db.orders[0].epostCancelOp.state, 'local_finalized');
  assert.equal(db.orders[0].canceledShipment.invoice, '6890000000002');
});

test('예전 시딩 행에 고유번호가 없으면 송장 삭제 실패를 숨기지 않는다', () => {
  const item = { id: 7, canceledSheet: { sourceRowId: '', invoice: '6890000000003' } };
  assert.equal(flagMissingCanceledSheetSource(item, '2026-09-03T12:00:00.000Z'), true);
  assert.equal(item.syncOps.sheetInvoiceCancel.state, 'failed');
  assert.match(item.syncIssues[0].message, /직접 지워/);
  assert.ok(item.canceledSheet);
});

test('같은 주문에서 일부 상품만 이미 발송됐으면 남은 상품의 두 번째 접수를 막는다', () => {
  const db = {
    orders: [
      { id: 1, orderNo: 'ORDER-1', name: '고객', product: 'Clara', status: '발송완료', invoice: '123' },
      { id: 2, orderNo: 'ORDER-1', name: '고객', product: 'Tessa', status: '대기' }
    ],
    seeding: []
  };
  const conflicts = fulfillmentGroupConflicts(db, [{ type: 'order', id: 2 }]);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0].reason, /일부 상품만 이미 발송/);
});

test('같은 주문의 취소 상품과 정상 대기 상품은 정상 상품만 발송할 수 있다', () => {
  const db = {
    orders: [
      { id: 1, orderNo: 'ORDER-1', product: 'Clara', status: '취소됨' },
      { id: 2, orderNo: 'ORDER-1', product: 'Tessa', status: '대기' }
    ],
    seeding: []
  };
  assert.deepEqual(fulfillmentGroupConflicts(db, [{ type: 'order', id: 2 }]), []);
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
