'use strict';

const { statusForFlowState, returnLineItems } = require('./claims');
const { splitShipmentItems } = require('../public/item-lines');

function cleanKey(value) {
  return String(value || '').trim().replace(/[^a-z0-9가-힣]/gi, '').toUpperCase();
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
  if (type === 'order' && item.orderNo) return 'order|' + item.orderNo;
  if (item.returnId) return 'return|' + item.returnId;
  return type + '|' + item.id;
}

function parcelReference(type, item) {
  if (item.packGroupId) return 'PACK-' + cleanKey(item.packGroupId).replace(/^PACK/, '');
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
  }
  for (const item of (db.seeding || [])) {
    if (item.sourceChannel !== 'seeding') { item.sourceChannel = 'seeding'; changed = true; }
    if (item.delivered && !item.deliverySource) { item.deliverySource = item.deliveredAuto ? 'legacy-auto' : 'imported'; changed = true; }
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
  sourceChannel,
  fulfillmentKey,
  parcelReference,
  selectInvoiceParcelGroup,
  inventorySku,
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
  getStockDeductions,
  recordStockDeduction,
  restoreStockDeductions,
  parseLotteDeliveryStatus,
  cafe24ReturnKey,
  stockLedgerRef,
  splitShipmentItems,
  buildReturnRestockPlan,
  selectStockMatches,
  ensureOperationalFields,
  applyCarrierDeliveryResult
};
