'use strict';

const { statusForFlowState, returnLineItems } = require('./claims');
const { splitShipmentItems, parcelContent } = require('../public/item-lines');

function cleanKey(value) {
  return String(value || '').trim().replace(/[^a-z0-9가-힣]/gi, '').toUpperCase();
}

function epostOrderMissing(error) {
  const message = String(error && error.message || error || '').trim();
  return /^ERR-225(?:\s*:|$)/i.test(message);
}

function epostResponseRecognized(xml) {
  return !!String(xml || '').trim() &&
    /<(?:error_code|message|custNo|apprNo|officeSer|regiNo|reqNo|resNo|treatStusCd|price|vTelNo)>/i.test(String(xml));
}

function epostTreatmentStatus(xml) {
  const match = String(xml || '').match(/<treatStusCd>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/treatStusCd>/i);
  return match ? match[1].trim() : '';
}

function releaseMissingEpostOperations(entries, error, resolvedAt) {
  if (!epostOrderMissing(error)) return false;
  const at = resolvedAt || new Date().toISOString();
  for (const entry of (entries || [])) {
    const item = entry && entry.item || entry;
    if (!item || !item.epostOp) continue;
    item.epostOp.state = 'not_found';
    item.epostOp.resolvedAt = at;
    item.epostOp.error = '우체국에 접수된 기록이 없어 다시 접수할 수 있어요.';
  }
  return true;
}

function sourceChannel(type, item) {
  if (item && item.sourceChannel) return item.sourceChannel;
  if (type === 'seeding') return 'seeding';
  if (item && item.exchange) return 'exchange';
  if (item && item.orderNo) return 'cafe24';
  return 'direct';
}

function fulfillmentKey(type, item) {
  if (item.packGroupId) return 'pack|' + item.packGroupId;
  if (type === 'order' && item.orderNo && item.parcelSplitId) {
    return 'split|' + item.orderNo + '|' + item.parcelSplitId;
  }
  if (type === 'order' && item.orderNo) return 'order|' + item.orderNo;
  if (item.returnId) return 'return|' + item.returnId;
  return type + '|' + item.id;
}

function expandSelectedFulfillments(db, selected) {
  const all = [
    ...(db && db.orders || []).map(item => ({ type: 'order', item })),
    ...(db && db.seeding || []).map(item => ({ type: 'seeding', item }))
  ];
  const byId = new Map(all.map(entry => [entry.type + ':' + entry.item.id, entry]));
  const keys = [];
  for (const sel of (selected || [])) {
    const type = sel.type === 'seeding' ? 'seeding' : 'order';
    const entry = byId.get(type + ':' + Number(sel.id));
    if (!entry) continue;
    const key = fulfillmentKey(type, entry.item);
    if (!keys.includes(key)) keys.push(key);
  }
  const out = [];
  const added = new Set();
  for (const key of keys) {
    for (const entry of all) {
      if (fulfillmentKey(entry.type, entry.item) !== key) continue;
      const id = entry.type + ':' + entry.item.id;
      if (added.has(id)) continue;
      added.add(id);
      out.push({ type: entry.type, id: entry.item.id });
    }
  }
  return out;
}

function sheetCleanupHoldReason(entries) {
  const held = (entries || []).some(entry => (entry && entry.item || entry || {}).sheetCancelHold);
  return held ? '구글시트의 기존 송장을 정리하기 전에는 이 포장을 다시 발송할 수 없어요.' : '';
}

function markPrintedFulfillments(db, selected, printedAt) {
  const all = [
    ...(db && db.orders || []).map(item => ({ type: 'order', item })),
    ...(db && db.seeding || []).map(item => ({ type: 'seeding', item }))
  ];
  const byId = new Map(all.map(entry => [entry.type + ':' + entry.item.id, entry]));
  const selectedEntries = expandSelectedFulfillments(db, selected)
    .map(sel => byId.get(sel.type + ':' + Number(sel.id)))
    .filter(entry => entry && entry.item.epost && (entry.item.invoice || entry.item.epost.regiNo));
  const parcelKeys = new Set(selectedEntries.map(entry => {
    const orderNo = String(entry.item.epost.orderNo || '').trim();
    return orderNo ? 'epost|' + orderNo : entry.type + '|' + entry.item.id;
  }));
  const at = printedAt || new Date().toISOString();
  let items = 0;
  for (const entry of all) {
    if (!entry.item.epost || !(entry.item.invoice || entry.item.epost.regiNo)) continue;
    const orderNo = String(entry.item.epost.orderNo || '').trim();
    const key = orderNo ? 'epost|' + orderNo : entry.type + '|' + entry.item.id;
    if (!parcelKeys.has(key)) continue;
    entry.item.printed = true;
    entry.item.printedAt = at;
    items += 1;
  }
  return { parcels: parcelKeys.size, items };
}

function epostCancellationEntries(db, orderNo) {
  const key = String(orderNo || '').trim();
  if (!key) return [];
  return [
    ...(db && db.orders || []).map(item => ({ type: 'order', item })),
    ...(db && db.seeding || []).map(item => ({ type: 'seeding', item }))
  ].filter(entry =>
    String(entry.item.epost && entry.item.epost.orderNo || '').trim() === key ||
    String(entry.item.epostCancelOp && entry.item.epostCancelOp.orderNo || '').trim() === key
  );
}

function prepareEpostCancellation(db, type, id, at) {
  const normalizedType = type === 'seeding' ? 'seeding' : 'order';
  const list = normalizedType === 'seeding' ? db && db.seeding || [] : db && db.orders || [];
  const target = list.find(item => Number(item.id) === Number(id));
  if (!target || !target.epost || !target.epost.orderNo) return null;
  const orderNo = String(target.epost.orderNo).trim();
  const createdAt = at || new Date().toISOString();
  const operation = {
    orderNo,
    reqNo: target.epost.reqNo || '',
    resNo: target.epost.resNo || '',
    reqYmd: target.epost.reqYmd || '',
    regiNo: String(target.invoice || target.epost.regiNo || '').replace(/\D/g, ''),
    state: 'pending',
    requestedAt: createdAt
  };
  const entries = epostCancellationEntries(db, orderNo);
  for (const entry of entries) {
    const existing = entry.item.epostCancelOp || {};
    entry.item.epostCancelOp = Object.assign({}, operation, {
      state: ['epost_canceled', 'local_finalized'].includes(existing.state) ? existing.state : 'pending',
      requestedAt: existing.requestedAt || createdAt,
      epostCanceledAt: existing.epostCanceledAt,
      localFinalizedAt: existing.localFinalizedAt
    });
    setExternalSyncState(entry.item, 'epost', 'shipment-cancel', 'pending', '', orderNo, createdAt);
  }
  return { orderNo, operation: entries[0] && entries[0].item.epostCancelOp, entries };
}

function setEpostCancellationState(db, orderNo, state, message, at) {
  const stamp = at || new Date().toISOString();
  const entries = epostCancellationEntries(db, orderNo);
  for (const entry of entries) {
    if (!entry.item.epostCancelOp) continue;
    entry.item.epostCancelOp.state = state;
    if (state === 'epost_canceled') entry.item.epostCancelOp.epostCanceledAt = stamp;
    if (message) entry.item.epostCancelOp.error = String(message);
    else delete entry.item.epostCancelOp.error;
    if (state === 'failed' || state === 'unknown') {
      setExternalSyncState(entry.item, 'epost', 'shipment-cancel', state, message, orderNo, stamp);
    }
  }
  return entries;
}

function flagMissingCanceledSheetSource(item, at) {
  if (!item || !item.canceledSheet || item.canceledSheet.sourceRowId) return false;
  const message = '시트 행 고유번호가 없어 취소한 송장을 자동으로 지우지 못했어요. 구글시트에서 이 송장번호를 직접 지워 주세요.';
  const key = 'missing-source|' + String(item.canceledSheet.invoice || item.id || '');
  item.sheetCancelHold = true;
  setExternalSyncState(item, 'sheet', 'invoice-cancel', 'failed', message, key, at);
  return true;
}

function resolveMissingCanceledSheetSource(item, at) {
  if (!item || !item.sheetCancelHold || !item.canceledSheet || item.canceledSheet.sourceRowId) return false;
  const key = 'missing-source|' + String(item.canceledSheet.invoice || item.id || '');
  item.sheetWritten = false;
  item.sheetCancelHold = false;
  delete item.canceledSheet;
  clearExternalSyncState(item, 'sheet', 'invoice-cancel', key, at);
  return true;
}

function finalizeEpostCancellation(db, orderNo, restoreStock, at) {
  const stamp = at || new Date().toISOString();
  const entries = epostCancellationEntries(db, orderNo);
  const active = entries.filter(entry => entry.item.epostCancelOp &&
    ['epost_canceled', 'local_finalized'].includes(entry.item.epostCancelOp.state));
  if (!active.length) return { entries: [], stockMissing: [] };

  const cafe24Groups = new Map();
  for (const entry of active.filter(row => row.type === 'order' && row.item.cafe24Shipped)) {
    const invoice = String(entry.item.invoice || entry.item.epostCancelOp.regiNo || '');
    const key = String(entry.item.orderNo || '') + '|' + invoice;
    if (!cafe24Groups.has(key)) cafe24Groups.set(key, []);
    cafe24Groups.get(key).push(entry.item);
  }
  for (const rows of cafe24Groups.values()) {
    const ref = {
      orderNo: rows[0].orderNo,
      invoice: String(rows[0].invoice || rows[0].epostCancelOp.regiNo || ''),
      itemCodes: [...new Set(rows.map(row => String(row.orderItemCode || '').trim()).filter(Boolean))]
    };
    for (const row of rows) row.canceledShipment = ref;
  }

  const stockMissing = [];
  for (const entry of active) {
    const item = entry.item;
    if (item.epostCancelOp.state !== 'local_finalized') {
      if (entry.type === 'seeding' && item.sheetWritten) {
        item.canceledSheet = {
          sourceRowId: item.sourceRowId || '',
          invoice: String(item.invoice || item.epostCancelOp.regiNo || '')
        };
        flagMissingCanceledSheetSource(item, stamp);
      }
      const restored = typeof restoreStock === 'function' ? restoreStock(entry) : { missingSkus: [] };
      if (restored && Array.isArray(restored.missingSkus)) stockMissing.push(...restored.missingSkus);
      item.canceledInvoice = String(item.invoice || item.epostCancelOp.regiNo || '');
      item.status = '대기';
      item.invoice = '';
      item.sentDate = '';
      item.printed = false;
      delete item.printedAt;
      delete item.epost;
      item.epostCancelOp.state = 'local_finalized';
      item.epostCancelOp.localFinalizedAt = stamp;
      clearExternalSyncState(item, 'epost', 'shipment-cancel', orderNo, stamp);
    }
  }
  return { entries: active, stockMissing };
}

function fulfillmentGroupConflicts(db, selected) {
  const expanded = expandSelectedFulfillments(db, selected);
  const groups = new Map();
  for (const sel of expanded) {
    const list = sel.type === 'seeding' ? db.seeding : db.orders;
    const item = (list || []).find(row => row.id === sel.id);
    if (!item) continue;
    const key = fulfillmentKey(sel.type, item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const conflicts = [];
  for (const [key, items] of groups) {
    const cleanupHold = sheetCleanupHoldReason(items);
    if (cleanupHold) {
      conflicts.push({
        key,
        name: items[0].name || '',
        reason: cleanupHold
      });
      continue;
    }
    if (items.some(item => item.shippingHold)) {
      conflicts.push({
        key,
        name: items[0].name || '',
        reason: '재고 기다림 품목이 포함돼 있어 이 포장 전체의 우체국 접수를 막았어요.'
      });
      continue;
    }
    const active = items.filter(item => item.status !== '취소됨' && item.status !== '발송완료' && !item.epost);
    if (!active.length) continue;
    const alreadySent = items.some(item => item.status === '발송완료' || item.epost || item.invoice);
    const alreadyProcessing = items.some(item => item.status === '접수중' ||
      item.epostOp && ['pending', 'unknown'].includes(item.epostOp.state));
    if (!alreadySent && !alreadyProcessing) continue;
    conflicts.push({
      key,
      name: items[0].name || '',
      reason: alreadySent
        ? '같은 주문에서 일부 상품만 이미 발송된 기록이 있어 전체 주문을 확인해야 해요.'
        : '같은 주문이 이미 접수 중이어서 중복 접수를 막았어요.'
    });
  }
  return conflicts;
}

function parcelReference(type, item) {
  if (item.packGroupId) return 'PACK-' + cleanKey(item.packGroupId).replace(/^PACK/, '');
  if (type === 'order' && item.orderNo && item.parcelSplitId) {
    return String(item.orderNo).trim() + '-SPLIT-' + cleanKey(item.parcelSplitId).replace(/^SPLIT/, '');
  }
  if (type === 'order' && item.orderNo) return String(item.orderNo).trim();
  if (item.returnId) return 'RMA-' + cleanKey(item.returnId).replace(/^RMA/, '');
  return (type === 'seeding' ? 'SEED-' : 'SHIP-') + String(item.id);
}

function selectInvoiceParcelGroup(pendings, query) {
  const name = String(query.name || '').replace(/\s+/g, '').replace(/\(.*?\)/g, '').trim();
  const phone = String(query.phone || '').replace(/\D/g, '').slice(-8);
  const reference = String(query.reference || '').trim();
  const groups = new Map();
  for (const pending of pendings) {
    const key = fulfillmentKey(pending.type, pending.item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pending);
  }
  let candidates = [...groups.values()].filter(group => {
    const item = group[0].item;
    const itemName = String(item.name || '').replace(/\s+/g, '').replace(/\(.*?\)/g, '').trim();
    const itemPhone = String(item.phone || '').replace(/\D/g, '').slice(-8);
    return (!name || itemName === name) && (!phone || itemPhone === phone);
  });
  if (reference) candidates = candidates.filter(group =>
    group.some(pending => parcelReference(pending.type, pending.item) === reference)
  );
  if (candidates.length === 1) return { items: candidates[0], reason: '' };
  if (candidates.length > 1) return { items: [], reason: `같은 고객의 택배가 ${candidates.length}건이라 자동으로 정할 수 없어요.` };
  return { items: [], reason: '맞는 대기 택배를 찾지 못했어요.' };
}

function inventorySku(item) {
  if (item.variantCode) return 'C24V-' + cleanKey(item.variantCode);
  const product = item.productNo ? 'C24-' + cleanKey(item.productNo) : 'LOCAL-' + cleanKey(item.name);
  return [product, cleanKey(item.color) || 'NONE', cleanKey(item.size) || 'NONE'].join('-');
}

function inventoryCountKnown(item) {
  return !item.needsCount && item.qty !== null && item.qty !== undefined && Number.isFinite(Number(item.qty));
}

function availableStockDeduction(available, requested, already) {
  const onHand = Math.max(0, Number(available) || 0);
  const needed = Math.max(0, (Number(requested) || 0) - (Number(already) || 0));
  const deducted = Math.min(onHand, needed);
  return { deducted, shortage: needed - deducted, left: onHand - deducted };
}

function canFuzzyMergeOrders(existing, incoming) {
  const currentOrder = String(existing && existing.orderNo || '').trim();
  const nextOrder = String(incoming && incoming.orderNo || '').trim();
  if (currentOrder && nextOrder && currentOrder !== nextOrder) return false;
  const currentItem = String(existing && existing.orderItemCode || '').trim();
  const nextItem = String(incoming && incoming.orderItemCode || '').trim();
  return !(currentItem && nextItem && currentItem !== nextItem);
}

function orderLineChangeable(item) {
  return !!(item && item.status === '대기' && !item.invoice && !item.epost &&
    !(item.epostOp && ['pending', 'unknown'].includes(item.epostOp.state)));
}

function splitOrderLineForLater(orders, id, splitId) {
  const item = (orders || []).find(row => row.id === Number(id));
  if (!item || !item.orderNo) return { error: '카페24 주문 품목을 찾지 못했어요.' };
  if (!orderLineChangeable(item)) return { error: '보낼 준비 상태의 품목만 분리배송으로 바꿀 수 있어요.' };
  const siblings = (orders || []).filter(row => row.orderNo === item.orderNo && row.status !== '취소됨');
  if (siblings.some(row => row.packGroupId)) return { error: '합포장된 건은 먼저 [묶음 풀기]를 눌러 주세요.' };
  if (siblings.some(row => !orderLineChangeable(row))) return { error: '같은 주문에 이미 접수하거나 발송한 품목이 있어 분리배송을 바꿀 수 없어요.' };
  if (siblings.some(row => row.parcelSplitId || row.shippingHold)) return { error: '이 주문은 이미 분리배송으로 나뉘어 있어요.' };
  if (siblings.length < 2) return { error: '같은 주문에 보낼 준비 품목이 두 품목 이상일 때만 분리배송할 수 있어요.' };
  if (!String(splitId || '').trim()) return { error: '분리배송 번호를 만들지 못했어요.' };
  item.parcelSplitId = String(splitId).trim();
  item.shippingHold = true;
  return { ok: true, item, orderNo: item.orderNo };
}

function releaseSplitOrderLine(orders, id) {
  const item = (orders || []).find(row => row.id === Number(id));
  if (!item || !item.parcelSplitId) return { error: '분리배송 품목을 찾지 못했어요.' };
  if (!orderLineChangeable(item)) return { error: '이미 접수하거나 발송한 품목은 변경할 수 없어요.' };
  delete item.shippingHold;
  return { ok: true, item, orderNo: item.orderNo };
}

function undoSplitOrder(orders, orderNo) {
  const rows = (orders || []).filter(row => row.orderNo === orderNo);
  const splitRows = rows.filter(row => row.parcelSplitId);
  if (!splitRows.length) return { error: '분리배송으로 나눈 품목을 찾지 못했어요.' };
  if (rows.some(row => !orderLineChangeable(row))) return { error: '이미 접수하거나 발송한 품목이 있어 원주문으로 합칠 수 없어요.' };
  for (const row of splitRows) {
    delete row.parcelSplitId;
    delete row.shippingHold;
  }
  return { ok: true, count: splitRows.length, orderNo };
}

function groupCafe24ShipmentItems(matchedItems) {
  const grouped = new Map();
  for (const entry of (matchedItems || [])) {
    const item = entry && entry.item;
    if (!item || entry.type !== 'order' || !item.orderNo || !item.invoice || item.cafe24Shipped) continue;
    const orderNo = String(item.orderNo).trim();
    const invoice = String(item.invoice).trim();
    const key = orderNo + '|' + invoice;
    if (!grouped.has(key)) grouped.set(key, { orderNo, invoice, items: [] });
    grouped.get(key).items.push(item);
  }
  return [...grouped.values()];
}

function cafe24ShipmentItemsReady(items) {
  return (items || []).length > 0 && (items || []).every(item =>
    String(item && item.orderItemCode || '').trim()
  );
}

function shipmentOperationKey(orderNo, invoice, itemCodes) {
  const tracking = String(invoice || '').replace(/\D/g, '');
  const codes = [...new Set((itemCodes || []).map(value => String(value || '').trim()).filter(Boolean))].sort();
  return [String(orderNo || '').trim(), tracking, codes.join(',')].join('|');
}

function cafe24ShipmentCodes(shipment) {
  const direct = shipment && (shipment.order_item_code || shipment.order_item_codes);
  const values = Array.isArray(direct) ? direct : direct ? [direct] : [];
  const nested = Array.isArray(shipment && shipment.items)
    ? shipment.items.map(item => item && item.order_item_code)
    : [];
  return [...new Set(values.concat(nested).map(value => String(value || '').trim()).filter(Boolean))].sort();
}

function classifyCafe24Shipment(shipments, invoice, itemCodes) {
  const tracking = String(invoice || '').replace(/\D/g, '');
  const expected = [...new Set((itemCodes || []).map(value => String(value || '').trim()).filter(Boolean))].sort();
  const sameTracking = (shipments || []).filter(shipment =>
    String(shipment && shipment.tracking_no || '').replace(/\D/g, '') === tracking
  );
  if (!sameTracking.length) return 'missing';
  return sameTracking.some(shipment => {
    const actual = cafe24ShipmentCodes(shipment);
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  }) ? 'exact' : 'conflict';
}

function externalSyncOperationName(system, action) {
  const suffix = String(action || '').replace(/(^|[-_\s]+)(.)/g, (_, __, char) => char.toUpperCase());
  return String(system || '') + suffix;
}

function setExternalSyncState(item, system, action, state, message, key, at) {
  if (!item.syncOps || typeof item.syncOps !== 'object') item.syncOps = {};
  if (!Array.isArray(item.syncIssues)) item.syncIssues = [];
  const operation = externalSyncOperationName(system, action);
  item.syncOps[operation] = { key: String(key || ''), state, at: at || new Date().toISOString() };
  if (message) item.syncOps[operation].error = String(message);
  item.syncIssues = item.syncIssues.filter(row => !(row.system === system && row.action === action));
  if (message && state !== 'success') {
    item.syncIssues.push({ system, action, message: String(message), at: item.syncOps[operation].at });
    if (item.syncIssues.length > 20) item.syncIssues = item.syncIssues.slice(-20);
  }
  return item.syncOps[operation];
}

function clearExternalSyncState(item, system, action, key, at) {
  return setExternalSyncState(item, system, action, 'success', '', key, at);
}

function sameCafe24OrderItem(existing, incoming) {
  if (String(existing && existing.orderNo || '').trim() !== String(incoming && incoming.orderNo || '').trim()) return false;
  const existingCode = String(existing && existing.orderItemCode || '').trim();
  const incomingCode = String(incoming && incoming.orderItemCode || '').trim();
  if (existingCode && incomingCode) return existingCode === incomingCode;
  return cleanKey(existing && existing.product) === cleanKey(incoming && incoming.product) &&
    cleanKey([existing && existing.option, existing && existing.color, existing && existing.size].filter(Boolean).join('|')) ===
      cleanKey([incoming && incoming.option, incoming && incoming.color, incoming && incoming.size].filter(Boolean).join('|'));
}

function resolvePackingMergeSelection(db, selected) {
  const picked = [];
  const added = new Set();
  const expandedOrders = new Set();
  const add = (type, item) => {
    const key = type + ':' + item.id;
    if (added.has(key)) return;
    added.add(key);
    picked.push({ type, item });
  };
  const invalid = item => {
    if (item.shippingHold || item.sheetCancelHold || item.parcelSplitId) return '분리배송·재고 기다림·시트 정리 품목이 있는 주문은 합포할 수 없어요.';
    if (item.packGroupId) return '이미 합포장된 주문이 포함돼 있어요.';
    if (!orderLineChangeable(item)) return '이미 접수하거나 발송한 품목이 있는 주문은 합포할 수 없어요.';
    return '';
  };

  for (const sel of (selected || [])) {
    const type = sel.type === 'seeding' ? 'seeding' : 'order';
    const list = type === 'seeding' ? db.seeding || [] : db.orders || [];
    const item = list.find(row => row.id === Number(sel.id));
    if (!item) return { error: '선택한 출고를 찾지 못했어요.', picked: [] };
    if (type === 'order' && item.orderNo) {
      const orderNo = String(item.orderNo).trim();
      if (expandedOrders.has(orderNo)) continue;
      expandedOrders.add(orderNo);
      const siblings = (db.orders || []).filter(row => String(row.orderNo || '').trim() === orderNo && row.status !== '취소됨');
      const reason = siblings.map(invalid).find(Boolean);
      if (reason) return { error: reason, picked: [] };
      for (const sibling of siblings) add('order', sibling);
      continue;
    }
    const reason = invalid(item);
    if (reason) return { error: reason, picked: [] };
    add(type, item);
  }

  if (picked.length < 2) return { error: '묶을 출고를 두 개 이상 선택해 주세요.', picked: [] };
  if (new Set(picked.map(({ type, item }) => fulfillmentKey(type, item))).size < 2) {
    return { error: '이미 한 비닐로 묶여 있어요.', picked: [] };
  }
  return { picked };
}

function variantIdentityAmbiguous(variants, target) {
  const color = cleanKey(target && target.color);
  const size = cleanKey(target && target.size);
  return (variants || []).filter(candidate =>
    cleanKey(candidate && candidate.color) === color && cleanKey(candidate && candidate.size) === size
  ).length > 1;
}

function returnRestockAllowed(inspection, requested) {
  return inspection === 'sellable' && requested === true;
}

function sheetWriteSucceeded(response, expected) {
  return !!(response && response.status >= 200 && response.status < 300 &&
    response.json && response.json.ok === true && Number(response.json.written) === Number(expected));
}

function cafe24VariantInventory(variant) {
  const embedded = variant && variant.inventories && !Array.isArray(variant.inventories)
    ? variant.inventories : {};
  const useInventory = String(embedded.use_inventory ?? variant.use_inventory ?? '') === 'T';
  const rawQuantity = Object.prototype.hasOwnProperty.call(embedded, 'quantity')
    ? embedded.quantity : variant.quantity;
  const quantity = useInventory && rawQuantity !== '' && rawQuantity !== null && rawQuantity !== undefined && Number.isFinite(Number(rawQuantity))
    ? Number(rawQuantity) : null;
  return {
    tracked: useInventory,
    quantity,
    safetyInventory: useInventory && Number.isFinite(Number(embedded.safety_inventory ?? variant.safety_inventory))
      ? Number(embedded.safety_inventory ?? variant.safety_inventory) : null,
    controlType: String(embedded.inventory_control_type ?? variant.inventory_control_type ?? '')
  };
}

function markMissingCafe24Variants(inventory, products, stockAt) {
  const currentCodes = new Set((products || []).flatMap(product =>
    (product.variants || []).map(variant => String(variant.variantCode || '')).filter(Boolean)
  ));
  let changed = 0;
  for (const item of (inventory || [])) {
    if (!item.variantCode || currentCodes.has(String(item.variantCode))) continue;
    if (item.cafe24VariantActive !== false || item.cafe24StockTracked || item.cafe24Qty !== null) changed++;
    item.cafe24VariantActive = false;
    item.cafe24StockTracked = false;
    item.cafe24Qty = null;
    item.cafe24SafetyInventory = null;
    item.cafe24StockAt = stockAt || '';
  }
  return changed;
}

function variantAllocationState(aggregate, variants) {
  const aggregateColor = cleanKey(aggregate.color);
  const sameColor = aggregateColor ? variants.filter(item => cleanKey(item.color) === aggregateColor) : [];
  const scoped = aggregateColor ? sameColor : variants;
  const complete = scoped.length > 0 && scoped.every(inventoryCountKnown);
  const expected = Number(aggregate.qty) || 0;
  const total = complete ? scoped.reduce((sum, item) => sum + Number(item.qty), 0) : 0;
  return { complete, matches: complete && total === expected, expected, total };
}

function shouldProcessStockDeduction(item) {
  return !(item.stockDeducted && !item.stockDeductionIncomplete && getStockDeductions(item).length === 0);
}

function getStockDeductions(item) {
  return (Array.isArray(item.stockDeductionDetails) ? item.stockDeductionDetails : [])
    .map(row => ({ sku: String(row.sku || ''), qty: Number(row.qty) || 0 }))
    .filter(row => row.sku && row.qty > 0);
}

function recordStockDeduction(item, sku, qty) {
  const rows = getStockDeductions(item);
  const found = rows.find(row => row.sku === sku);
  if (found) found.qty += Number(qty) || 0;
  else rows.push({ sku, qty: Number(qty) || 0 });
  item.stockDeductionDetails = rows.filter(row => row.qty > 0);
  item.stockDeductions = item.stockDeductionDetails.map(row => row.sku);
  return item.stockDeductionDetails;
}

function restoreStockDeductions(item, inventory) {
  let restored = 0;
  const rows = [];
  const unresolved = [];
  for (const detail of getStockDeductions(item)) {
    const inv = inventory.find(entry => entry.sku === detail.sku);
    if (!inv) { unresolved.push(detail); continue; }
    inv.qty = (Number(inv.qty) || 0) + detail.qty;
    restored += detail.qty;
    rows.push({ inv, qty: detail.qty });
  }
  item.stockDeducted = unresolved.length > 0;
  item.stockDeductionIncomplete = unresolved.length > 0;
  item.stockDeductions = unresolved.map(row => row.sku);
  item.stockDeductionDetails = unresolved;
  return { restored, rows, missingSkus: unresolved.map(row => row.sku) };
}

function parseLotteDeliveryStatus(html) {
  const table = String(html || '').match(/<table[^>]*>[\s\S]*?<caption[^>]*>[\s\S]*?배달결과[\s\S]*?<\/caption>[\s\S]*?<tbody[^>]*>[\s\S]*?<tr[^>]*>([\s\S]*?)<\/tr>[\s\S]*?<\/tbody>[\s\S]*?<\/table>/i);
  if (!table) return { checked: false, delivered: false, status: '' };
  const cells = [...table[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(match => match[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim());
  if (cells.length < 4) return { checked: false, delivered: false, status: '' };
  const status = cells[3];
  return { checked: true, delivered: status.replace(/\s+/g, '') === '배달완료', status };
}

function cafe24ReturnKey(item) {
  const optionId = item.orderItemCode || item.variantCode || inventorySku(item) || cleanKey(item.product) + '-' + cleanKey(item.option);
  return ['c24', item.orderNo || '', optionId, item._retKind || ''].join(':');
}

function stockLedgerRef(item, type) {
  if (item.rmaNo) return String(item.rmaNo);
  if (item.orderNo) return String(item.orderNo);
  return (type === 'seeding' || item.sourceChannel === 'seeding' ? 'SEED-' : 'SHIP-') + String(item.id);
}

function buildReturnRestockPlan(items, resolveStock) {
  const rows = [];
  const missing = [];
  const list = Array.isArray(items) ? items : [];
  if (!list.length) missing.push({ product: '상품 정보 없음', option: '', qty: 1 });
  for (const item of list) {
    const option = String(item.option || '').trim();
    if (!String(item.product || '').trim()) {
      missing.push({ product: '상품 정보 없음', option, qty: Math.max(1, Number(item.qty) || 1) });
      continue;
    }
    const sizeMatch = option.match(/(XXS|XS|S|M|L|XL|XXL|2XL|FREE|F)\s*$/i);
    const lookup = {
      product: item.product + ' ' + option,
      color: item.color || '',
      size: item.size || (sizeMatch ? sizeMatch[1] : ''),
      qty: Math.max(1, Number(item.qty) || 1),
      sku: item.sku || '',
      variantCode: item.variantCode || '',
      productNo: item.sourceProductNo || item.productNo || null
    };
    const matches = resolveStock(lookup) || [];
    if (matches.length !== 1) {
      missing.push({ product: item.product, option, qty: lookup.qty });
      continue;
    }
    rows.push({ inv: matches[0], qty: lookup.qty, product: item.product, option });
  }
  return { rows, missing };
}

function selectStockMatches(inventory, item, matchByName) {
  const rows = Array.isArray(inventory) ? inventory : [];
  const unique = matches => matches.length === 1 ? matches : [];
  if (item.variantCode) return unique(rows.filter(inv => String(inv.variantCode || '') === String(item.variantCode)));
  if (item.sku) return unique(rows.filter(inv => String(inv.sku || '') === String(item.sku)));
  if (item.productNo) {
    const sku = inventorySku(item);
    return unique(rows.filter(inv => String(inv.sku || '') === sku));
  }
  return unique(rows.filter(inv => matchByName(inv, item)));
}

function ensureOperationalFields(db) {
  let changed = false;
  for (const item of (db.orders || [])) {
    const src = sourceChannel('order', item);
    if (item.sourceChannel !== src) { item.sourceChannel = src; changed = true; }
    if (item.delivered && !item.deliverySource) { item.deliverySource = item.deliveredAuto ? 'legacy-auto' : 'imported'; changed = true; }
    if (item.epostOp && ['pending', 'unknown'].includes(item.epostOp.state) && releaseMissingEpostOperations([item], item.epostOp.error)) changed = true;
    if (!Array.isArray(item.syncIssues)) { item.syncIssues = []; changed = true; }
    if (!item.syncOps || typeof item.syncOps !== 'object') { item.syncOps = {}; changed = true; }
  }
  for (const item of (db.seeding || [])) {
    if (item.sourceChannel !== 'seeding') { item.sourceChannel = 'seeding'; changed = true; }
    if (item.delivered && !item.deliverySource) { item.deliverySource = item.deliveredAuto ? 'legacy-auto' : 'imported'; changed = true; }
    if (item.epostOp && ['pending', 'unknown'].includes(item.epostOp.state) && releaseMissingEpostOperations([item], item.epostOp.error)) changed = true;
    if (!Array.isArray(item.syncIssues)) { item.syncIssues = []; changed = true; }
    if (!item.syncOps || typeof item.syncOps !== 'object') { item.syncOps = {}; changed = true; }
  }
  for (const item of (db.inventory || [])) {
    if (Number(item.qty) < 0) {
      item.qty = 0;
      item.needsCount = true;
      item.stockIssue = '출고 수량이 현재 재고보다 많아 실사 필요';
      changed = true;
    }
    const sku = inventorySku(item);
    if (item.sku !== sku) { item.sku = sku; changed = true; }
  }
  for (const item of (db.returns || [])) {
    const legacyLocalCompleted = !item.flowState && item.status === '완료' && !item.stockReviewNeeded;
    const rmaNo = item.rmaNo || 'RMA-' + item.id;
    const src = item.sourceChannel || (item._src === 'c24' || item.sourceType === 'orders' ? 'cafe24' : item.sourceType === 'seeding' ? 'seeding' : 'direct');
    const flowState = item.flowState || (item.status === '완료' ? 'completed' : item.status === '취소됨' ? 'canceled' : item.status === '회수중' ? 'pickup_booked' : item.status === '처리중' ? 'processing' : 'requested');
    if (item.rmaNo !== rmaNo) { item.rmaNo = rmaNo; changed = true; }
    if (item.sourceChannel !== src) { item.sourceChannel = src; changed = true; }
    if (item.flowState !== flowState) { item.flowState = flowState; changed = true; }
    const status = statusForFlowState(flowState);
    if (item.status !== status) { item.status = status; changed = true; }
    if (!Array.isArray(item.events)) { item.events = []; changed = true; }
    if (!Array.isArray(item.syncIssues)) { item.syncIssues = []; changed = true; }
    if (!Array.isArray(item.items) || !item.items.length) { item.items = returnLineItems(item); changed = true; }
    if (legacyLocalCompleted && !item.localCompleted) { item.localCompleted = true; changed = true; }
  }
  for (const row of (db.stockLog || [])) {
    if (row.sku) continue;
    const inv = (db.inventory || []).find(item =>
      cleanKey(item.name) === cleanKey(row.name) &&
      cleanKey(item.color) === cleanKey(row.color) &&
      cleanKey(item.size) === cleanKey(row.size)
    );
    row.sku = inv ? inv.sku || inventorySku(inv) : inventorySku(row);
    changed = true;
  }
  for (const row of (db.stockLog || [])) {
    if (!row.ref || /^(?:RMA|SEED|SHIP|PACK)-[A-Z0-9-]+$/i.test(String(row.ref)) || /^\d{8}-\d+$/.test(String(row.ref))) continue;
    row.ref = '';
    changed = true;
  }
  return changed;
}

function applyCarrierDeliveryResult(item, result, date) {
  item.deliveryCheckedAt = new Date().toISOString();
  if (result && result.delivered) {
    item.delivered = true;
    item.deliveredDate = date || new Date().toISOString().slice(0, 10);
    item.deliverySource = 'carrier';
    item.deliveryCheckStatus = '배달완료';
    delete item.deliveredAuto;
    return true;
  }
  item.deliveryCheckStatus = result && result.checked ? '배송중' : '확인필요';
  if (result && result.checked) delete item.deliveryCheckReason;
  return false;
}

module.exports = {
  epostOrderMissing,
  epostResponseRecognized,
  epostTreatmentStatus,
  releaseMissingEpostOperations,
  sourceChannel,
  fulfillmentKey,
  expandSelectedFulfillments,
  markPrintedFulfillments,
  epostCancellationEntries,
  prepareEpostCancellation,
  setEpostCancellationState,
  finalizeEpostCancellation,
  flagMissingCanceledSheetSource,
  resolveMissingCanceledSheetSource,
  sheetCleanupHoldReason,
  fulfillmentGroupConflicts,
  parcelReference,
  selectInvoiceParcelGroup,
  inventorySku,
  inventoryCountKnown,
  availableStockDeduction,
  canFuzzyMergeOrders,
  splitOrderLineForLater,
  releaseSplitOrderLine,
  undoSplitOrder,
  groupCafe24ShipmentItems,
  cafe24ShipmentItemsReady,
  shipmentOperationKey,
  classifyCafe24Shipment,
  setExternalSyncState,
  clearExternalSyncState,
  sameCafe24OrderItem,
  resolvePackingMergeSelection,
  variantIdentityAmbiguous,
  returnRestockAllowed,
  sheetWriteSucceeded,
  cafe24VariantInventory,
  markMissingCafe24Variants,
  variantAllocationState,
  shouldProcessStockDeduction,
  getStockDeductions,
  recordStockDeduction,
  restoreStockDeductions,
  parseLotteDeliveryStatus,
  cafe24ReturnKey,
  stockLedgerRef,
  splitShipmentItems,
  parcelContent,
  buildReturnRestockPlan,
  selectStockMatches,
  ensureOperationalFields,
  applyCarrierDeliveryResult
};
