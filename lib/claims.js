'use strict';

const STAGE_RANK = {
  unknown: 0,
  requested: 1,
  accepted: 2,
  hold: 2,
  awaiting_pickup: 2,
  pickup_booked: 3,
  collected: 4,
  received: 5,
  reship_ready: 6,
  processing: 6,
  refund_pending: 7,
  completed: 8,
  canceled: 9
};

function cafe24ClaimStage(code) {
  const value = String(code || '').toUpperCase();
  if (/^[ER]00$/.test(value)) return 'requested';
  if (/^[ER]10$/.test(value)) return 'accepted';
  if (/^[ER]12$/.test(value)) return 'hold';
  if (/^R30$/.test(value)) return 'awaiting_pickup';
  if (/^(E13|E31|R13|R20|R31)$/.test(value)) return 'collected';
  if (/^(E11|E41|E50|E51|R11)$/.test(value)) return 'canceled';
  if (/^E40$/.test(value) || /^R40$/.test(value)) return 'completed';
  if (/^R4[123]$/.test(value)) return 'refund_pending';
  if (/^(E20|E30|E3[2-6]|R3[246])$/.test(value)) return 'processing';
  return 'unknown';
}

function statusForFlowState(flowState) {
  if (flowState === 'completed') return '완료';
  if (flowState === 'canceled') return '취소됨';
  if (['pickup_booked', 'collected'].includes(flowState)) return '회수중';
  if (['received', 'reship_ready', 'processing', 'refund_pending'].includes(flowState)) return '처리중';
  return '대기';
}

function appendClaimEvent(ret, event, source, detail, at) {
  if (!Array.isArray(ret.events)) ret.events = [];
  const row = {
    at: at || new Date().toISOString(),
    event: String(event || ''),
    source: String(source || ''),
    detail: String(detail || '')
  };
  const last = ret.events[ret.events.length - 1];
  if (!last || last.event !== row.event || last.source !== row.source || last.detail !== row.detail) ret.events.push(row);
  if (ret.events.length > 50) ret.events = ret.events.slice(-50);
  return row;
}

function returnLineItems(ret) {
  if (Array.isArray(ret.items)) return ret.items;
  return [{
    orderItemCode: String(ret.orderItemCode || ''),
    variantCode: String(ret.variantCode || ''),
    sourceProductNo: ret.sourceProductNo || null,
    sku: String(ret.sku || ''),
    product: String(ret.product || ''),
    option: String(ret.option || ''),
    color: String(ret.color || ''),
    size: String(ret.size || ''),
    qty: Math.max(1, Number(ret.qty) || 1),
    exchangeProduct: String(ret.exchangeProduct || ''),
    exchangeSku: String(ret.exchangeSku || ''),
    exchangeVariantCode: String(ret.exchangeVariantCode || ''),
    exchangeProductNo: ret.exchangeProductNo || null,
    exchangeColor: String(ret.exchangeColor || ''),
    exchangeSize: String(ret.exchangeSize || '')
  }];
}

function upsertReturnLine(ret, parsed, sourceOrder) {
  const lines = returnLineItems(ret).filter(row => row.orderItemCode || row.product);
  const orderItemCode = String(parsed.orderItemCode || '');
  let line = lines.find(row => orderItemCode && String(row.orderItemCode || '') === orderItemCode);
  if (!line) {
    line = {};
    lines.push(line);
  }
  const clearExchange = parsed._exchangeTargetResolved === false;
  Object.assign(line, {
    orderItemCode,
    variantCode: String(parsed.variantCode || line.variantCode || ''),
    sourceProductNo: parsed.productNo || line.sourceProductNo || null,
    sku: String(sourceOrder && sourceOrder.sku || parsed.sku || line.sku || ''),
    product: String(parsed.product || line.product || ''),
    option: String([parsed.color, parsed.size].filter(Boolean).join(', ') || parsed.option || line.option || ''),
    color: String(parsed.color || line.color || ''),
    size: String(parsed.size || line.size || ''),
    qty: Math.max(1, Number(parsed.qty) || Number(line.qty) || 1),
    exchangeProduct: clearExchange ? '' : String(parsed._exchangeProduct || line.exchangeProduct || ''),
    exchangeSku: clearExchange ? '' : String(parsed._exchangeSku || line.exchangeSku || ''),
    exchangeVariantCode: clearExchange ? '' : String(parsed._exchangeVariantCode || line.exchangeVariantCode || ''),
    exchangeProductNo: clearExchange ? null : parsed._exchangeProductNo || line.exchangeProductNo || null,
    exchangeColor: clearExchange ? '' : String(parsed._exchangeColor || line.exchangeColor || ''),
    exchangeSize: clearExchange ? '' : String(parsed._exchangeSize || line.exchangeSize || '')
  });
  if (clearExchange) {
    ret.exchangeProduct = '';
    ret.exchangeSku = '';
    ret.exchangeVariantCode = '';
    ret.exchangeProductNo = null;
    ret.exchangeColor = '';
    ret.exchangeSize = '';
  }
  ret.items = lines;
  const first = lines[0] || line;
  ret.orderItemCode = String(first.orderItemCode || '');
  ret.variantCode = String(first.variantCode || '');
  ret.sourceProductNo = first.sourceProductNo || null;
  ret.sku = String(first.sku || '');
  ret.product = lines.map(row => row.product).filter(Boolean).join('\n');
  ret.option = lines.map(row => row.option).filter(Boolean).join('\n');
  ret.qty = lines.reduce((sum, row) => sum + Math.max(1, Number(row.qty) || 1), 0);
  ret.exchangeProduct = lines.map(row => row.exchangeProduct).filter(Boolean).join('\n') || (clearExchange ? '' : ret.exchangeProduct || '');
  return line;
}

function applyCafe24ClaimSnapshot(ret, snapshot, at) {
  const previous = ret.flowState || '';
  const incoming = cafe24ClaimStage(snapshot.orderStatus);
  ret.cafe24ClaimCode = String(snapshot.claimCode || ret.cafe24ClaimCode || '');
  ret.cafe24OrderStatus = String(snapshot.orderStatus || ret.cafe24OrderStatus || '');
  ret.cafe24ClaimReasonType = String(snapshot.reasonType || ret.cafe24ClaimReasonType || '');
  ret.cafe24SyncedAt = at || new Date().toISOString();
  if (snapshot.reason) ret.reason = String(snapshot.reason);
  if (snapshot.invoice && !ret.invoice) ret.invoice = String(snapshot.invoice);
  if (snapshot.carrierId) ret.cafe24CarrierId = String(snapshot.carrierId);
  if (snapshot.pickupState !== undefined) {
    ret.cafe24PickupState = String(snapshot.pickupState || '');
    ret.externalPickupActive = cafe24PickupActive(ret.cafe24PickupState) && !ret.epost;
  }
  if (snapshot.orderItemCode) ret.orderItemCode = String(snapshot.orderItemCode);
  if (snapshot.variantCode) ret.variantCode = String(snapshot.variantCode);
  if (snapshot.exchangeVariantCode) ret.exchangeVariantCode = String(snapshot.exchangeVariantCode);
  if (snapshot.exchangeProduct) ret.exchangeProduct = String(snapshot.exchangeProduct);
  if (Number(snapshot.qty) > 0) ret.qty = Number(snapshot.qty);
  if (!ret.localCompleted && !['collected', 'completed'].includes(previous)) {
    for (const field of ['name', 'phone', 'zip', 'addr']) {
      if (snapshot[field]) ret[field] = String(snapshot[field]);
    }
  }
  let next = incoming;
  if (ret.externalPickupActive && ['requested', 'accepted'].includes(incoming)) next = 'awaiting_pickup';
  if (previous === 'canceled') next = 'canceled';
  if (!['completed', 'canceled'].includes(incoming) && (STAGE_RANK[previous] || 0) > (STAGE_RANK[incoming] || 0)) next = previous;
  if (incoming === 'unknown') next = previous || 'requested';
  if (incoming === 'completed' && !ret.inspectionAt && !['completed', 'canceled'].includes(previous)) ret.stockReviewNeeded = true;
  if (incoming === 'canceled') ret.stockReviewNeeded = false;
  ret.flowState = next;
  ret.status = statusForFlowState(next);
  if (previous !== next) appendClaimEvent(ret, next, 'cafe24', ret.cafe24OrderStatus, ret.cafe24SyncedAt);
  return ret;
}

function claimItem(ret, row, includeExchange) {
  const item = {
    order_item_code: String(row.orderItemCode || '').trim(),
    quantity: Math.max(1, Number(row.qty) || 1)
  };
  if (includeExchange) {
    item.exchange_variant_code = String(row.exchangeVariantCode || '').trim();
    const sourceProductNo = row.sourceProductNo;
    const exchangeProductNo = row.exchangeProductNo;
    item.same_product = sourceProductNo && exchangeProductNo && String(sourceProductNo) !== String(exchangeProductNo) ? 'F' : 'T';
  }
  return item;
}

function claimUpdateItems(ret) {
  return returnLineItems(ret).map(row => ({ order_item_code: String(row.orderItemCode || '').trim() })).filter(row => row.order_item_code);
}

function hasValidClaimLines(ret) {
  const lines = returnLineItems(ret);
  return lines.length > 0 && lines.every(row => String(row.orderItemCode || '').trim());
}

function hasValidExchangeTargets(ret) {
  const lines = returnLineItems(ret);
  return lines.length > 0 && lines.every(row => String(row.exchangeVariantCode || '').trim());
}

function buildCafe24ClaimCreate(ret) {
  const isExchange = ret.kind === '교환';
  const items = returnLineItems(ret).map(row => claimItem(ret, row, isExchange)).filter(row => row.order_item_code);
  const request = {
    status: 'accepted',
    recover_inventory: 'F',
    add_memo_too: 'T',
    items
  };
  if (isExchange) return { shop_no: 1, request };
  request.pickup_completed = 'F';
  request.request_pickup = 'F';
  request.reason = String(ret.reason || '배송도우미에서 반품 접수');
  request.claim_reason_type = String(ret.cafe24ClaimReasonType || 'I');
  return { shop_no: 1, request };
}

function buildCafe24ClaimUpdate(ret, action, options) {
  const values = options || {};
  const request = {};
  if (action === 'invoice') {
    request.pickup_completed = 'F';
    request.return_invoice_no = String(values.invoice || ret.invoice || '');
    request.return_shipping_company_name = '우체국택배';
    request.return_invoice_success = 'T';
    if (values.carrierId) request.carrier_id = String(values.carrierId);
  } else if (action === 'collected') {
    request.pickup_completed = 'T';
    request.recover_inventory = 'F';
    request.items = claimUpdateItems(ret);
    if (ret.kind !== '교환') request.status = 'processing';
    if (ret.invoice) {
      request.return_invoice_no = String(ret.invoice);
      request.return_shipping_company_name = '우체국택배';
      request.return_invoice_success = 'T';
      if (values.carrierId) request.carrier_id = String(values.carrierId);
    }
  } else if (action === 'complete') {
    request.status = ret.kind === '교환' ? 'exchanged' : 'returned';
    request.pickup_completed = 'T';
    request.recover_inventory = 'F';
    request.items = claimUpdateItems(ret);
  } else if (action === 'cancel') {
    request.undone = 'T';
    request.recover_inventory = 'F';
    request.add_memo_too = 'T';
    request.undone_reason_type = 'I';
    request.undone_reason = String(values.reason || '배송도우미에서 접수 취소');
    request.expose_order_detail = 'F';
    request.items = claimUpdateItems(ret);
  }
  return { shop_no: 1, request };
}

function extractCafe24ClaimCode(kind, json, fallback) {
  const key = kind === '교환' ? 'exchange' : 'return';
  const value = json && json[key];
  if (Array.isArray(value)) return String((value[0] && value[0].claim_code) || fallback || '');
  return String((value && value.claim_code) || fallback || '');
}

function claimOperationKey(ret, action, values) {
  return [ret.rmaNo || 'RMA-' + ret.id, action, JSON.stringify(values || {})].join(':');
}

function isClaimPostAction(action) {
  return action === 'create' || action === 'accept';
}

function activeRmaConflict(rows, candidate) {
  const itemCode = String(candidate.orderItemCode || '');
  const sourceId = Number(candidate.sourceId) || null;
  return (rows || []).find(row => {
    if (['completed', 'canceled'].includes(row.flowState)) return false;
    const sameItem = itemCode && returnLineItems(row).some(item => String(item.orderItemCode || '') === itemCode);
    const sameSource = sourceId && Number(row.sourceId) === sourceId;
    return !!(sameItem || sameSource);
  }) || null;
}

function pickupRmaConflict(rows, current) {
  const orderNo = String(current.originalOrderNo || '');
  return (rows || []).find(row => {
    if (row.id === current.id) return false;
    const pickupActive = !!row.externalPickupActive || !!row.epost || !!(row.pickupOp && ['pending', 'unknown', 'success'].includes(row.pickupOp.state));
    if (!pickupActive && ['completed', 'canceled'].includes(row.flowState)) return false;
    return pickupActive && orderNo && String(row.originalOrderNo || '') === orderNo;
  }) || null;
}

function legacyRmaMatch(rows, parsed) {
  const clean = value => String(value || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const optionKey = value => {
    let key = clean(value);
    const aliases = {
      스카이블루: 'skyblue', 라이트블루: 'lightblue', 인디고블루: 'indigoblue',
      네이비: 'navy', 블랙: 'black', 화이트: 'white', 아이보리: 'ivory', 브라운: 'brown',
      베이지: 'beige', 그레이: 'gray', 카키: 'khaki', 블루: 'blue', 연청: 'lightblue', 진청: 'darkblue'
    };
    for (const [from, to] of Object.entries(aliases)) key = key.replaceAll(from, to);
    return key;
  };
  const phone = String(parsed.phone || '').replace(/\D/g, '');
  const name = clean(parsed.name);
  const product = clean(parsed.product);
  const address = clean(parsed.addr);
  const option = optionKey([parsed.color, parsed.size].filter(Boolean).join(' ') || parsed.option);
  const qty = Math.max(1, Number(parsed.qty) || 1);
  if (!phone || !name || !product || !address || !option) return null;
  const candidates = (rows || []).filter(row => {
    if (row.kind !== parsed._retKind || row.cafe24ClaimCode || row.originalOrderNo || row.epost || row.pickupOp || row.localCompleted) return false;
    if (!['cafe24', ''].includes(String(row.sourceChannel || '')) || ['completed', 'canceled'].includes(row.flowState)) return false;
    const sameCustomer = clean(row.name) === name && String(row.phone || '').replace(/\D/g, '') === phone && clean(row.addr) === address;
    const sameLine = returnLineItems(row).some(item => clean(item.product) === product &&
      optionKey([item.color, item.size].filter(Boolean).join(' ') || item.option || row.option) === option &&
      Math.max(1, Number(item.qty) || 1) === qty);
    return sameCustomer && sameLine;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function prepareLegacyRma(ret, parsed) {
  ret.kind = parsed._retKind || ret.kind;
  ret.originalOrderNo = String(parsed.orderNo || ret.originalOrderNo || '');
  ret.items = [];
  ret.orderItemCode = '';
  ret.product = '';
  ret.option = '';
  ret.qty = 0;
  return ret;
}

function findExchangeTarget(rows, orderItemCode, allowSingleFallback, originalItem) {
  const list = Array.isArray(rows) ? rows : [];
  const code = String(orderItemCode || '');
  const exact = list.filter(row => String(row.origin_order_item_code || row.original_order_item_code || '') === code);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return {};
  const itemNo = String(originalItem && originalItem.item_no || '');
  if (itemNo) {
    const linked = list.filter(row => {
      const values = Array.isArray(row.original_item_no) ? row.original_item_no : [row.original_item_no];
      return values.some(value => String(value || '') === itemNo);
    });
    const productNo = String(originalItem && originalItem.product_no || '');
    const sameProduct = productNo
      ? linked.filter(row => String(row.product_no || '') === productNo)
      : [];
    if (sameProduct.length === 1) return sameProduct[0];
    if (sameProduct.length > 1) return {};
    if (linked.length === 1) return linked[0];
  }
  return allowSingleFallback && list.length === 1 ? list[0] : {};
}

function allowSingleExchangeFallback(items, current) {
  const claimCode = String(current && current.claim_code || '');
  const itemCode = String(current && current.order_item_code || '');
  if (!claimCode || !itemCode) return false;
  const matches = (items || []).filter(row =>
    String(row.order_status || '').startsWith('E') && String(row.claim_code || '') === claimCode
  );
  return matches.length === 1 && String(matches[0].order_item_code || '') === itemCode;
}

function findCafe24ClaimDetail(rows, claimCode) {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const code = String(claimCode || '');
  if (code) {
    const exact = list.filter(row => String(row.claim_code || '') === code);
    return exact.length === 1 ? exact[0] : {};
  }
  return {};
}

function resolveClaimCodeFromItems(orderItems, expectedItemCodes) {
  const raw = (expectedItemCodes || []).map(value => String(value || '').trim());
  if (!raw.length || raw.some(value => !value)) return { claimCode: '', orderStatus: '' };
  const expected = new Set(raw);
  if (!expected.size) return { claimCode: '', orderStatus: '' };
  const matches = (orderItems || []).filter(row => expected.has(String(row.order_item_code || '')));
  if (matches.length !== expected.size) return { claimCode: '', orderStatus: '' };
  const codes = new Set(matches.map(row => String(row.claim_code || '')).filter(Boolean));
  if (codes.size !== 1 || matches.some(row => !String(row.claim_code || ''))) return { claimCode: '', orderStatus: '' };
  const statuses = [...new Set(matches.map(row => String(row.order_status || '')).filter(Boolean))];
  return { claimCode: [...codes][0], orderStatus: statuses.length === 1 ? statuses[0] : '' };
}

function pickupOperationUnresolved(ret) {
  return !ret.epost && !!(ret.pickupOp && ['pending', 'unknown'].includes(ret.pickupOp.state) && ret.pickupOp.orderNo);
}

function canCompleteRma(ret) {
  if (!ret || ret.flowState === 'canceled') return false;
  if (ret.localCompleted) return ['received', 'reship_ready', 'processing', 'refund_pending', 'completed'].includes(ret.flowState);
  if (ret.flowState === 'completed' && ret.stockReviewNeeded) return true;
  return ['pickup_booked', 'collected'].includes(ret.flowState);
}

function shouldApplyPickupProgress(ret) {
  return !!ret && ret.flowState !== 'canceled' && !ret.needsEpostCancel;
}

function pickupCanceledFlowState(ret) {
  if (ret && (ret.flowState === 'canceled' || ret.needsEpostCancel)) return 'canceled';
  return cafe24ClaimStage(ret && ret.cafe24OrderStatus) === 'canceled' ? 'canceled' : 'requested';
}

function shouldCancelRecoveredPickup(ret) {
  return !!ret && ret.flowState === 'canceled' && (!!ret.epost || pickupOperationUnresolved(ret));
}

function claimCancelUnresolved(ret) {
  const state = ret && ret.syncOps && ret.syncOps.cancel && ret.syncOps.cancel.state;
  return !!ret && ret.flowState !== 'canceled' && ['pending', 'unknown', 'failed'].includes(state);
}

function missingCafe24ExchangeTargets(ret) {
  if (!ret || ret.sourceChannel !== 'cafe24' || ret.kind !== '교환') return [];
  return returnLineItems(ret).filter(row => !String(row.exchangeVariantCode || '').trim());
}

function returnCompletionSafety(ret, options) {
  const values = options || {};
  const blocked = (code, message, nextAction) => ({
    ready: false, safeStop: true, changed: false, code, message, nextAction
  });
  if (!ret) return blocked('NOT_FOUND', '해당 교환·반품 건을 찾지 못했어요.', '화면을 새로고침해 주세요.');
  if (ret.duplicateOf) return blocked('DUPLICATE', '이미 다른 교환·반품 기록에 합쳐진 중복 건이에요.', '교환·반품 목록을 새로고침해 주세요.');
  if (ret.localCompleted && ['completed', 'refund_pending'].includes(ret.flowState) && !(ret.syncIssues || []).length) {
    return blocked('ALREADY_COMPLETED', '이미 안전하게 처리된 교환·반품 건이에요.', '추가로 누르지 않아도 됩니다.');
  }
  if (!canCompleteRma(ret)) {
    return blocked('NOT_COLLECTED', '아직 물건 도착 처리할 단계가 아니에요.', '회수 진행상태를 먼저 확인해 주세요.');
  }
  if (ret.sourceChannel === 'cafe24' &&
      (!String(ret.originalOrderNo || '').trim() || !String(ret.cafe24ClaimCode || '').trim() || !hasValidClaimLines(ret))) {
    return blocked('MISSING_CAFE24_LINK', '카페24 원주문·접수번호·품목 연결을 모두 확인하지 못했어요.',
      '[전체 연동 다시 확인]을 눌러 주세요.');
  }
  const targets = missingCafe24ExchangeTargets(ret);
  if (targets.length) {
    const names = targets.map(row => row.product || row.orderItemCode || '상품 정보 없음').join(', ');
    return blocked('MISSING_EXCHANGE_TARGET', '카페24 교환 목표 상품·옵션을 확인하지 못했어요: ' + names,
      '[전체 연동 다시 확인]을 눌러 주세요.');
  }
  const stockMissing = Array.isArray(values.stockMissing) ? values.stockMissing : [];
  if (values.restock !== false && stockMissing.length) {
    const names = stockMissing.map(row => [row.product, row.option].filter(Boolean).join(' / ')).join(', ');
    return blocked('MISSING_STOCK', '재고에서 정확한 상품·컬러·사이즈를 찾지 못했어요: ' + names,
      '[재고]에서 해당 옵션을 확인해 주세요.');
  }
  return { ready: true, safeStop: false, changed: false, code: 'READY', message: '', nextAction: '' };
}

function cafe24PickupActive(state) {
  return ['W', 'S', 'T'].includes(String(state || '').toUpperCase());
}

module.exports = {
  cafe24ClaimStage,
  statusForFlowState,
  appendClaimEvent,
  returnLineItems,
  upsertReturnLine,
  applyCafe24ClaimSnapshot,
  buildCafe24ClaimCreate,
  buildCafe24ClaimUpdate,
  hasValidClaimLines,
  hasValidExchangeTargets,
  extractCafe24ClaimCode,
  claimOperationKey,
  isClaimPostAction,
  activeRmaConflict,
  pickupRmaConflict,
  legacyRmaMatch,
  prepareLegacyRma,
  findExchangeTarget,
  allowSingleExchangeFallback,
  cafe24PickupActive,
  findCafe24ClaimDetail,
  resolveClaimCodeFromItems,
  pickupOperationUnresolved,
  canCompleteRma,
  shouldApplyPickupProgress,
  pickupCanceledFlowState,
  shouldCancelRecoveredPickup,
  claimCancelUnresolved,
  missingCafe24ExchangeTargets,
  returnCompletionSafety
};
