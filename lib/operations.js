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

function inventorySku(item) {
  if (item.variantCode) return 'C24V-' + cleanKey(item.variantCode);
  const product = item.productNo ? 'C24-' + cleanKey(item.productNo) : 'LOCAL-' + cleanKey(item.name);
  return [product, cleanKey(item.color) || 'NONE', cleanKey(item.size) || 'NONE'].join('-');
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
  inventorySku,
  splitShipmentItems,
  ensureOperationalFields,
  applyCarrierDeliveryResult
};
