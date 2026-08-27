const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cafe24ClaimStage,
  applyCafe24ClaimSnapshot,
  buildCafe24ClaimCreate,
  buildCafe24ClaimUpdate,
  extractCafe24ClaimCode,
  claimOperationKey,
  returnLineItems,
  upsertReturnLine,
  isClaimPostAction,
  activeRmaConflict,
  pickupRmaConflict,
  legacyRmaMatch,
  prepareLegacyRma,
  findExchangeTarget,
  cafe24PickupActive,
  findCafe24ClaimDetail,
  pickupOperationUnresolved,
  canCompleteRma,
  shouldApplyPickupProgress,
  pickupCanceledFlowState,
  missingCafe24ExchangeTargets,
  allowSingleExchangeFallback,
  resolveClaimCodeFromItems,
  shouldCancelRecoveredPickup,
  claimCancelUnresolved,
  hasValidClaimLines,
  hasValidExchangeTargets
} = require('../lib/claims');

test('카페24 교환 반품 상태를 하나의 RMA 단계로 바꾼다', () => {
  assert.equal(cafe24ClaimStage('R00'), 'requested');
  assert.equal(cafe24ClaimStage('R20'), 'collected');
  assert.equal(cafe24ClaimStage('R42'), 'refund_pending');
  assert.equal(cafe24ClaimStage('R40'), 'completed');
  assert.equal(cafe24ClaimStage('E31'), 'collected');
  assert.equal(cafe24ClaimStage('E30'), 'processing');
  assert.equal(cafe24ClaimStage('E40'), 'completed');
  assert.equal(cafe24ClaimStage('E50'), 'canceled');
  assert.equal(cafe24ClaimStage('E51'), 'canceled');
});

test('카페24의 이전 상태가 앱의 실물 도착 상태를 뒤로 돌리지 않는다', () => {
  const ret = { id: 3, rmaNo: 'RMA-3', flowState: 'received', status: '처리중', events: [] };
  applyCafe24ClaimSnapshot(ret, { claimCode: 'C1', orderStatus: 'E10' }, '2026-08-27T01:00:00.000Z');
  assert.equal(ret.flowState, 'received');
  assert.equal(ret.status, '처리중');
  assert.equal(ret.cafe24ClaimCode, 'C1');
});

test('카페24에서 완료된 건은 앱도 완료로 보되 재고 확인을 남긴다', () => {
  const ret = { id: 4, rmaNo: 'RMA-4', flowState: 'pickup_booked', status: '회수중', events: [] };
  applyCafe24ClaimSnapshot(ret, { claimCode: 'C2', orderStatus: 'E40' }, '2026-08-27T02:00:00.000Z');
  assert.equal(ret.flowState, 'completed');
  assert.equal(ret.status, '완료');
  assert.equal(ret.stockReviewNeeded, true);
});

test('이미 취소된 RMA는 늦게 들어온 완료 상태로 되살리지 않는다', () => {
  const ret = { id: 5, rmaNo: 'RMA-5', flowState: 'canceled', status: '취소됨', events: [] };
  applyCafe24ClaimSnapshot(ret, { claimCode: 'C3', orderStatus: 'E40' }, '2026-08-27T03:00:00.000Z');
  assert.equal(ret.flowState, 'canceled');
  assert.equal(ret.status, '취소됨');
  assert.equal(ret.stockReviewNeeded, undefined);
});

test('앱에서 만든 반품은 카페24가 회수를 다시 신청하지 않게 만든다', () => {
  const body = buildCafe24ClaimCreate({
    kind: '반품', orderItemCode: 'ITEM1', qty: 2, reason: '사이즈', cafe24ClaimReasonType: 'A'
  });
  assert.deepEqual(body.request.items, [{ order_item_code: 'ITEM1', quantity: 2 }]);
  assert.equal(body.request.request_pickup, 'F');
  assert.equal(body.request.recover_inventory, 'F');
  assert.equal(body.request.status, 'accepted');
  assert.equal(hasValidClaimLines({ items: [{ orderItemCode: '   ' }] }), false);
  assert.deepEqual(buildCafe24ClaimCreate({ kind: '반품', items: [{ orderItemCode: '   ', qty: 1 }] }).request.items, []);
});

test('교환 생성은 목표 옵션 variant와 동일상품 여부를 명시한다', () => {
  const body = buildCafe24ClaimCreate({
    kind: '교환', orderItemCode: 'ITEM2', qty: 1,
    sourceProductNo: 10, exchangeProductNo: 10, exchangeVariantCode: '  V-M  '
  });
  assert.deepEqual(body.request.items, [{
    order_item_code: 'ITEM2', quantity: 1, exchange_variant_code: 'V-M', same_product: 'T'
  }]);
  assert.deepEqual(buildCafe24ClaimCreate({
    kind: '교환', orderItemCode: 'ITEM2', exchangeVariantCode: '   '
  }).request.items, [{ order_item_code: 'ITEM2', quantity: 1, exchange_variant_code: '', same_product: 'T' }]);
  assert.equal(hasValidExchangeTargets({
    kind: '교환', orderItemCode: 'ITEM2', exchangeVariantCode: '   '
  }), false);
});

test('카페24 교환 한 건에 여러 상품을 한 claim으로 보낸다', () => {
  const ret = {
    kind: '교환',
    items: [
      { orderItemCode: 'ITEM-A', qty: 1, sourceProductNo: 10, exchangeProductNo: 10, exchangeVariantCode: 'V-A' },
      { orderItemCode: 'ITEM-B', qty: 2, sourceProductNo: 20, exchangeProductNo: 21, exchangeVariantCode: 'V-B' }
    ]
  };
  const body = buildCafe24ClaimCreate(ret);
  assert.deepEqual(body.request.items, [
    { order_item_code: 'ITEM-A', quantity: 1, exchange_variant_code: 'V-A', same_product: 'T' },
    { order_item_code: 'ITEM-B', quantity: 2, exchange_variant_code: 'V-B', same_product: 'F' }
  ]);
  assert.deepEqual(buildCafe24ClaimUpdate(ret, 'complete').request.items, [
    { order_item_code: 'ITEM-A' }, { order_item_code: 'ITEM-B' }
  ]);
});

test('예전 단일 상품 RMA도 items 한 줄로 읽는다', () => {
  assert.deepEqual(returnLineItems({ orderItemCode: 'OLD', product: 'Clara', option: 'Skyblue, M', qty: 2 }), [{
    orderItemCode: 'OLD', variantCode: '', sourceProductNo: null, sku: '', product: 'Clara', option: 'Skyblue, M', color: '', size: '', qty: 2,
    exchangeProduct: '', exchangeSku: '', exchangeVariantCode: '', exchangeProductNo: null, exchangeColor: '', exchangeSize: ''
  }]);
});

test('같은 카페24 claim의 여러 품목을 RMA 한 건 안에 누적한다', () => {
  const ret = { items: [], product: '임시 상위값', option: '', qty: 1, exchangeVariantCode: 'STALE-TARGET', exchangeSku: 'STALE-SKU', exchangeProductNo: 999 };
  upsertReturnLine(ret, {
    orderItemCode: 'A', product: 'Clara', color: 'Skyblue', size: 'M', qty: 1,
    _exchangeSku: 'SKU-A-M', _exchangeVariantCode: 'TARGET-A', _exchangeColor: 'Deepblue', _exchangeSize: 'L'
  });
  assert.equal(ret.items.length, 1);
  assert.equal(ret.qty, 1);
  assert.equal(ret.items[0].exchangeSku, 'SKU-A-M');
  assert.equal(ret.items[0].exchangeColor, 'Deepblue');
  assert.equal(ret.items[0].exchangeSize, 'L');
  upsertReturnLine(ret, { orderItemCode: 'B', product: 'Tessa', color: 'Brown', size: 'L', qty: 2 });
  upsertReturnLine(ret, { orderItemCode: 'A', product: 'Clara', color: 'Skyblue', size: 'S', qty: 1 });
  assert.equal(ret.items.length, 2);
  assert.equal(ret.qty, 3);
  assert.equal(ret.items[0].option, 'Skyblue, S');
  assert.equal(ret.product, 'Clara\nTessa');
  upsertReturnLine(ret, { orderItemCode: 'A', product: 'Clara', color: 'Skyblue', size: 'S', qty: 1, _exchangeTargetResolved: false });
  assert.equal(ret.items[0].exchangeVariantCode, '');
  assert.equal(ret.items[0].exchangeSku, '');
  assert.equal(ret.exchangeVariantCode, '');
  assert.equal(ret.exchangeSku, '');
  assert.equal(ret.exchangeProductNo, null);
  assert.equal(buildCafe24ClaimCreate({ ...ret, kind: '교환' }).request.items[0].exchange_variant_code, '');
});

test('회수 송장과 완료 요청은 PG 결제를 자동 취소하지 않는다', () => {
  const ret = { kind: '반품', orderItemCode: 'ITEM3', qty: 1, invoice: '123' };
  const invoice = buildCafe24ClaimUpdate(ret, 'invoice', { carrierId: '7' });
  assert.equal(invoice.request.return_invoice_no, '123');
  assert.equal(invoice.request.carrier_id, '7');
  const done = buildCafe24ClaimUpdate(ret, 'complete');
  assert.equal(done.request.status, 'returned');
  assert.equal(Object.hasOwn(done.request, 'payment_gateway_cancel'), false);
  assert.equal(done.request.recover_inventory, 'F');
});

test('카페24에서 이미 신청된 claim 승인도 POST 접수 계약을 쓴다', () => {
  const accepted = buildCafe24ClaimCreate({ kind: '교환', orderItemCode: 'ITEM4', exchangeVariantCode: 'V4' });
  assert.equal(accepted.request.status, 'accepted');
  assert.equal(accepted.request.recover_inventory, 'F');
  assert.deepEqual(accepted.request.items, [{ order_item_code: 'ITEM4', quantity: 1, exchange_variant_code: 'V4', same_product: 'T' }]);
  assert.equal(isClaimPostAction('accept'), true);
  assert.equal(isClaimPostAction('create'), true);
  assert.equal(isClaimPostAction('complete'), false);
});

test('활성 교환과 반품은 종류가 달라도 같은 주문 품목에 중복 생성하지 않는다', () => {
  const rows = [{ id: 1, kind: '반품', flowState: 'requested', items: [{ orderItemCode: 'ITEM-X' }] }];
  assert.equal(activeRmaConflict(rows, { kind: '교환', orderItemCode: 'ITEM-X' }).id, 1);
  rows[0].flowState = 'completed';
  assert.equal(activeRmaConflict(rows, { kind: '교환', orderItemCode: 'ITEM-X' }), null);
});

test('같은 주문의 다른 RMA에 회수가 있으면 두 번째 우체국 회수를 막는다', () => {
  const rows = [{ id: 1, flowState: 'pickup_booked', originalOrderNo: 'ORDER-1', epost: { orderNo: 'P1' } }];
  assert.equal(pickupRmaConflict(rows, { id: 2, flowState: 'requested', originalOrderNo: 'ORDER-1' }).id, 1);
});

test('연동 전 수기 교환은 고객과 제품이 정확히 같을 때만 카페24 claim에 연결한다', () => {
  const rows = [{
    id: 3, kind: '교환', sourceChannel: 'cafe24', flowState: 'requested',
    name: '홍길동', phone: '010-1111-2222', addr: '서울시 마포구 1', product: 'S#01_Clara Denim', option: 'Skyblue M', qty: 1,
    items: [{ product: 'S#01_Clara Denim', option: 'Skyblue M', qty: 1 }]
  }];
  const parsed = { _retKind: '교환', name: '홍길동', phone: '01011112222', addr: '서울시 마포구 1', product: 'S#01_Clara Denim', color: 'Sky Blue', size: 'M', qty: 1, orderNo: 'O-1' };
  assert.equal(legacyRmaMatch(rows, parsed).id, 3);
  assert.equal(legacyRmaMatch(rows, { ...parsed, product: 'B#04_Sienna Slacks' }), null);
  assert.equal(legacyRmaMatch(rows, { ...parsed, color: 'Ivory', size: 'L' }), null);
  assert.equal(legacyRmaMatch(rows, { ...parsed, addr: '서울시 마포구 2' }), null);
  assert.equal(legacyRmaMatch(rows, { ...parsed, qty: 2 }), null);
  assert.equal(legacyRmaMatch(rows, { ...parsed, phone: '019-1111-2222' }), null);
  rows.push({ ...rows[0], id: 4 });
  assert.equal(legacyRmaMatch(rows, parsed), null);
  rows.pop();
  rows[0].pickupOp = { state: 'unknown', orderNo: 'PICKUP-1' };
  assert.equal(legacyRmaMatch(rows, parsed), null);
});

test('수기 RMA를 카페24 claim에 채택할 때 기존 빈 품목을 교체한다', () => {
  const ret = { id: 3, kind: '교환', product: 'Clara', option: 'Skyblue M', qty: 1, items: [{ product: 'Clara', option: 'Skyblue M', qty: 1 }] };
  prepareLegacyRma(ret, { _retKind: '교환', orderNo: 'ORDER-1' });
  upsertReturnLine(ret, { orderItemCode: 'ITEM-1', product: 'Clara', color: 'Skyblue', size: 'M', qty: 1 });
  assert.equal(ret.originalOrderNo, 'ORDER-1');
  assert.equal(ret.items.length, 1);
  assert.equal(ret.qty, 1);
  assert.equal(ret.orderItemCode, 'ITEM-1');
});

test('교환 대상 품목은 origin_order_item_code로 정확히 연결한다', () => {
  const rows = [
    { origin_order_item_code: 'ITEM-B', exchange_variant_code: 'TARGET-B' },
    { origin_order_item_code: 'ITEM-A', exchange_variant_code: 'TARGET-A' }
  ];
  assert.equal(findExchangeTarget(rows, 'ITEM-A').exchange_variant_code, 'TARGET-A');
  assert.deepEqual(findExchangeTarget(rows, 'MISSING'), {});
  assert.deepEqual(findExchangeTarget([{ exchange_variant_code: 'ONLY' }], 'ITEM-A'), {});
  assert.equal(findExchangeTarget([{ exchange_variant_code: 'ONLY' }], 'ITEM-A', true).exchange_variant_code, 'ONLY');
  assert.deepEqual(findExchangeTarget([
    { origin_order_item_code: 'ITEM-A', exchange_variant_code: 'DUP-1' },
    { origin_order_item_code: 'ITEM-A', exchange_variant_code: 'DUP-2' }
  ], 'ITEM-A'), {});
});

test('단일 교환 target fallback은 현재 품목 자체가 유일한 claim 품목일 때만 허용한다', () => {
  const current = { order_item_code: 'ITEM-A', claim_code: 'E1', order_status: 'E10' };
  assert.equal(allowSingleExchangeFallback([current], current), true);
  assert.equal(allowSingleExchangeFallback([
    { order_item_code: 'ITEM-B', claim_code: 'E1', order_status: 'E10' }
  ], { order_item_code: 'ITEM-A', claim_code: '', order_status: 'E10' }), false);
  assert.equal(allowSingleExchangeFallback([
    current,
    { order_item_code: 'ITEM-B', claim_code: 'E1', order_status: 'E10' }
  ], current), false);
});

test('Cafe24 claim 상세는 접수번호가 정확히 하나 맞을 때만 고른다', () => {
  const rows = [{ claim_code: 'E1' }, { claim_code: 'E2' }];
  assert.equal(findCafe24ClaimDetail(rows, 'E2').claim_code, 'E2');
  assert.deepEqual(findCafe24ClaimDetail(rows, 'MISSING'), {});
  assert.deepEqual(findCafe24ClaimDetail([{ claim_code: 'ONLY' }], ''), {});
  assert.deepEqual(findCafe24ClaimDetail([{ claim_code: 'E1' }, { claim_code: 'E1' }], 'E1'), {});
});

test('claim 복구는 모든 대상 품목이 같은 접수번호를 가질 때만 채택한다', () => {
  const items = [
    { order_item_code: 'ITEM-A', claim_code: '', order_status: 'E10' },
    { order_item_code: 'ITEM-B', claim_code: 'E-B', order_status: 'E10' }
  ];
  assert.equal(resolveClaimCodeFromItems(items, ['ITEM-A', 'ITEM-B']).claimCode, '');
  items[0].claim_code = 'E-B';
  assert.equal(resolveClaimCodeFromItems(items, ['ITEM-A', 'ITEM-B']).claimCode, 'E-B');
  items[0].claim_code = 'E-A';
  assert.equal(resolveClaimCodeFromItems(items, ['ITEM-A', 'ITEM-B']).claimCode, '');
  items[0].claim_code = 'E-B';
  assert.equal(resolveClaimCodeFromItems(items, ['', 'ITEM-B']).claimCode, '');
});

test('카페24에서 이미 진행 중인 회수 상태를 구분한다', () => {
  assert.equal(cafe24PickupActive('W'), true);
  assert.equal(cafe24PickupActive('S'), true);
  assert.equal(cafe24PickupActive('T'), true);
  assert.equal(cafe24PickupActive('E'), false);
  assert.equal(cafe24PickupActive('F'), false);
  assert.equal(cafe24PickupActive('N'), false);
  const ret = { flowState: 'accepted', status: '대기', events: [] };
  applyCafe24ClaimSnapshot(ret, { orderStatus: 'E10', pickupState: 'W' });
  assert.equal(ret.externalPickupActive, true);
  assert.equal(ret.flowState, 'awaiting_pickup');
  const local = { flowState: 'pickup_booked', status: '회수중', epost: { orderNo: 'LOCAL' }, events: [] };
  applyCafe24ClaimSnapshot(local, { orderStatus: 'E10', pickupState: 'T' });
  assert.equal(local.externalPickupActive, false);
  assert.equal(local.flowState, 'pickup_booked');
});

test('취소된 이전 RMA라도 실제 회수가 살아 있으면 새 회수를 막는다', () => {
  const rows = [{ id: 1, flowState: 'canceled', originalOrderNo: 'ORDER-1', epost: { orderNo: 'OLD-PICKUP' } }];
  assert.equal(pickupRmaConflict(rows, { id: 2, originalOrderNo: 'ORDER-1' }).id, 1);
});

test('결과가 불확실한 우체국 회수 작업은 취소나 재접수 전에 먼저 확인한다', () => {
  assert.equal(pickupOperationUnresolved({ pickupOp: { state: 'unknown', orderNo: 'P1' } }), true);
  assert.equal(pickupOperationUnresolved({ pickupOp: { state: 'pending', orderNo: 'P2' } }), true);
  assert.equal(pickupOperationUnresolved({ pickupOp: { state: 'success', orderNo: 'P3' } }), false);
  assert.equal(pickupOperationUnresolved({ epost: { orderNo: 'P4' }, pickupOp: { state: 'unknown' } }), false);
});

test('취소된 건과 회수 전 건은 물건 도착 완료 API를 실행할 수 없다', () => {
  assert.equal(canCompleteRma({ flowState: 'canceled', localCompleted: false }), false);
  assert.equal(canCompleteRma({ flowState: 'requested', localCompleted: false }), false);
  assert.equal(canCompleteRma({ flowState: 'pickup_booked', localCompleted: false }), true);
  assert.equal(canCompleteRma({ flowState: 'collected', localCompleted: false }), true);
  assert.equal(canCompleteRma({ flowState: 'completed', stockReviewNeeded: true, localCompleted: false }), true);
  assert.equal(canCompleteRma({ flowState: 'reship_ready', localCompleted: true }), true);
});

test('취소 중인 회수는 우체국 집하 응답이 와도 진행 상태로 되살리지 않는다', () => {
  assert.equal(shouldApplyPickupProgress({ flowState: 'canceled', needsEpostCancel: true }), false);
  assert.equal(shouldApplyPickupProgress({ flowState: 'canceled' }), false);
  assert.equal(shouldApplyPickupProgress({ flowState: 'pickup_booked' }), true);
  assert.equal(pickupCanceledFlowState({ flowState: 'canceled', cafe24OrderStatus: 'E10' }), 'canceled');
  assert.equal(pickupCanceledFlowState({ flowState: 'pickup_booked', needsEpostCancel: true, cafe24OrderStatus: 'E10' }), 'canceled');
  assert.equal(pickupCanceledFlowState({ flowState: 'pickup_booked', cafe24OrderStatus: 'E10' }), 'requested');
  assert.equal(shouldCancelRecoveredPickup({ flowState: 'canceled', pickupOp: { state: 'unknown', orderNo: 'P1' } }), true);
  assert.equal(shouldCancelRecoveredPickup({ flowState: 'canceled', epost: { orderNo: 'P2' } }), true);
});

test('Cafe24 교환은 모든 품목의 목표 variant가 있어야 완료할 수 있다', () => {
  const ret = { sourceChannel: 'cafe24', kind: '교환', items: [
    { orderItemCode: 'A', product: 'Clara', exchangeVariantCode: 'TARGET-A' },
    { orderItemCode: 'B', product: 'Tessa', exchangeVariantCode: '' }
  ] };
  assert.equal(missingCafe24ExchangeTargets(ret).length, 1);
  ret.items[1].exchangeVariantCode = 'TARGET-B';
  assert.deepEqual(missingCafe24ExchangeTargets(ret), []);
  const payload = buildCafe24ClaimCreate({
    sourceChannel: 'cafe24', kind: '교환', exchangeVariantCode: 'STALE-TOP',
    items: [
      { orderItemCode: 'A', qty: 1, exchangeVariantCode: 'TARGET-A' },
      { orderItemCode: 'B', qty: 1, exchangeVariantCode: '' }
    ]
  });
  assert.equal(payload.request.items[1].exchange_variant_code, '');
});

test('claim code 응답 모양과 작업키를 안정적으로 처리한다', () => {
  assert.equal(extractCafe24ClaimCode('교환', { exchange: { claim_code: 'E1' } }), 'E1');
  assert.equal(extractCafe24ClaimCode('반품', { return: [{ claim_code: 'R1' }] }), 'R1');
  assert.equal(claimOperationKey({ rmaNo: 'RMA-9' }, 'cancel', { reason: 'x' }), 'RMA-9:cancel:{"reason":"x"}');
  assert.equal(claimCancelUnresolved({ flowState: 'hold', syncOps: { cancel: { state: 'failed' } } }), true);
  assert.equal(claimCancelUnresolved({ flowState: 'canceled', syncOps: { cancel: { state: 'failed' } } }), false);
});
