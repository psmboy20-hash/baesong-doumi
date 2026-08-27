'use strict';

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

function variantAllocationState(aggregate, variants) {
  const complete = variants.length > 0 && variants.every(inventoryCountKnown);
  const expected = Number(aggregate.qty) || 0;
  const total = complete ? variants.reduce((sum, item) => sum + Number(item.qty), 0) : 0;
  return { complete, matches: complete && total === expected, expected, total };
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

function splitShipmentItems(item) {
  const lines = String(item.product || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (lines.length <= 1) return [Object.assign({}, item, { qty: Number(item.qty) || 1 })];
  return lines.map(product => {
    const sizeMatch = product.match(/(?:^|\s)(XXS|XS|S|M|L|XL|XXL|2XL|FREE|F)\s*$/i);
    return Object.assign({}, item, {
      product,
      size: sizeMatch ? sizeMatch[1].toUpperCase() : '',
      qty: 1,
      sku: '',
      variantCode: ''
    });
  });
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
    const sku = inventorySku(item);
    if (item.sku !== sku) { item.sku = sku; changed = true; }
  }
  for (const item of (db.returns || [])) {
    const rmaNo = item.rmaNo || 'RMA-' + item.id;
    const src = item.sourceChannel || (item._src === 'c24' || item.sourceType === 'orders' ? 'cafe24' : item.sourceType === 'seeding' ? 'seeding' : 'direct');
    if (item.rmaNo !== rmaNo) { item.rmaNo = rmaNo; changed = true; }
    if (item.sourceChannel !== src) { item.sourceChannel = src; changed = true; }
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
  variantAllocationState,
  getStockDeductions,
  recordStockDeduction,
  restoreStockDeductions,
  parseLotteDeliveryStatus,
  cafe24ReturnKey,
  stockLedgerRef,
  splitShipmentItems,
  ensureOperationalFields,
  applyCarrierDeliveryResult
};
