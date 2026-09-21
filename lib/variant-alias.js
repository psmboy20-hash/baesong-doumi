'use strict';
// 같은 실물 제품이 카페24에 여러 상품(예: 기본 상품 + "[밀이 1st 마켓]" 상품)으로 올라가 있을 때
// 옵션(품목)들을 하나의 재고 줄로 묶는다. 묶는 기준은 이름이 아니라 코드:
//   1) 품목 자체코드(custom_variant_code)가 같으면 같은 물건
//   2) 아니면 상품 자체코드(custom_product_code)가 같고 색상·사이즈가 같으면 같은 물건
// 대표 줄(canonical) 하나가 실물 수량을 갖고, 나머지 옵션은 그 줄의 aliases 로 들어간다.
// 출고 차감·가용 계산은 대표 줄 하나로 하고, 채널 반영은 대표+alias 옵션 전부에 같은 가용 수량을 보낸다.

function norm(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

// 배송도우미가 자동으로 만든 품목코드(C24V-옵션코드)는 그 옵션 자기 자신만 가리킨다 — 묶기 정보가 아니므로 무시한다
function selfCode(variant) {
  return 'c24v-' + norm(variant && variant.variantCode);
}
function variantGroupKey(product, variant) {
  const custom = norm(variant && variant.customVariantCode);
  if (custom && custom !== selfCode(variant)) return 'v:' + custom;
  const productCode = norm(product && product.customProductCode);
  if (!productCode) return '';
  return 'p:' + productCode + '|' + norm(variant && variant.color) + '|' + norm(variant && variant.size);
}

// products(db.products) → Map(groupKey → [{productNo, variantCode, name, color, size, cafe24Qty, cafe24StockTracked, customVariantCode}])
function groupVariants(products) {
  const groups = new Map();
  for (const product of (products || [])) {
    for (const variant of (product.variants || [])) {
      if (!variant || !variant.variantCode) continue;
      const key = variantGroupKey(product, variant);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        productNo: product.no,
        variantCode: String(variant.variantCode),
        name: product.name || '',
        color: variant.color || '',
        size: variant.size || '',
        cafe24Qty: variant.cafe24Qty === undefined ? null : variant.cafe24Qty,
        cafe24StockTracked: variant.cafe24StockTracked === true,
        cafe24Display: variant.display,
        cafe24Selling: variant.selling,
        customVariantCode: variant.customVariantCode || ''
      });
    }
  }
  return groups;
}

function verified(inv) {
  return !!(inv && (inv.lastCountedAt || inv.stockInitAt || inv.stockVerifiedAt));
}
function hasStock(inv) {
  return !!inv && Number(inv.qty) > 0;
}

// 재고 줄에 aliases 를 채우고, 대표가 아닌 옵션의 빈 줄은 재고 목록에서 뺀다.
// 돌려주는 값: { linked: 묶인 대표 줄 수, removed: 빠진 빈 줄 수, conflicts: [{sku, canonicalSku}] (수량이 있어 자동으로 못 합친 줄) }
function linkVariantAliases(db) {
  const inventory = (db && db.inventory) || [];
  const groups = groupVariants(db && db.products);
  const byVariant = new Map(inventory.filter(i => i.variantCode).map(i => [String(i.variantCode), i]));
  const result = { linked: 0, removed: 0, conflicts: [] };
  const keep = new Set(inventory);

  // 먼저 모든 줄의 alias 를 비운다 (묶음이 바뀌었을 수 있음). 이전 alias 정보는 cafe24Qty 유지용으로 기억.
  const previous = new Map();
  for (const inv of inventory) {
    for (const alias of (inv.aliases || [])) previous.set(String(alias.variantCode), alias);
    delete inv.aliases;
  }

  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const rows = members.map(m => byVariant.get(m.variantCode)).filter(Boolean);
    // 대표: 확인된 줄 > 수량 있는 줄 > 상품번호가 가장 작은(먼저 만든) 줄
    const canonical = rows.find(verified) || rows.find(hasStock) ||
      rows.slice().sort((a, b) => Number(a.productNo) - Number(b.productNo))[0];
    if (!canonical) continue;
    const canonicalSku = canonical.sku || '';
    const aliases = [];
    for (const member of members) {
      if (member.variantCode === String(canonical.variantCode)) continue;
      const row = byVariant.get(member.variantCode);
      if (row && (verified(row) || hasStock(row))) {
        // 실물 수량이 잡혀 있는 줄은 자동으로 못 합친다 — 사람이 정리해야 한다
        result.conflicts.push({ sku: row.sku || '', canonicalSku, name: [row.name, row.color, row.size].filter(Boolean).join(' ') });
        continue;
      }
      if (row) { keep.delete(row); result.removed++; }
      const prev = previous.get(member.variantCode) || {};
      aliases.push(Object.assign({}, member, {
        cafe24PushedAt: prev.cafe24PushedAt, cafe24PushedQty: prev.cafe24PushedQty
      }));
    }
    if (aliases.length) { canonical.aliases = aliases; result.linked++; }
  }
  if (result.removed) db.inventory = inventory.filter(inv => keep.has(inv));
  return result;
}

// 재고 줄 하나가 카페24에서 담당하는 옵션 전부 (대표 + alias). 각 원소는 productNo·variantCode·cafe24Qty·cafe24StockTracked 를 가진다.
function variantTargets(inv) {
  if (!inv) return [];
  const self = {
    productNo: inv.productNo, variantCode: inv.variantCode, name: inv.name || '',
    cafe24Qty: inv.cafe24Qty, cafe24StockTracked: inv.cafe24StockTracked,
    active: inv.cafe24VariantActive !== false, alias: null
  };
  const aliases = (inv.aliases || []).map(a => ({
    productNo: a.productNo, variantCode: a.variantCode, name: a.name || '',
    cafe24Qty: a.cafe24Qty, cafe24StockTracked: a.cafe24StockTracked, active: true, alias: a
  }));
  return [self, ...aliases].filter(t => t.productNo && t.variantCode);
}

// 이 옵션코드를 담당하는 재고 줄 (대표이거나 alias 로 품고 있는 줄)
function rowForVariant(inventory, variantCode) {
  const code = String(variantCode || '');
  if (!code) return null;
  return (inventory || []).find(inv => String(inv.variantCode || '') === code ||
    (inv.aliases || []).some(a => String(a.variantCode) === code)) || null;
}

// 카페24에 써넣을 품목코드 목록: 대표 줄의 sku 를 대표+alias 옵션 모두에 넣는다 (아직 비어 있는 것만)
function variantCodeWrites(db) {
  const writes = [];
  const customByVariant = new Map();
  for (const product of ((db && db.products) || [])) {
    for (const variant of (product.variants || [])) customByVariant.set(String(variant.variantCode), variant.customVariantCode || '');
  }
  for (const inv of ((db && db.inventory) || [])) {
    if (!inv.productNo || !inv.variantCode) continue;
    const code = inv.sku || '';
    if (!code) continue;
    for (const target of variantTargets(inv)) {
      const existing = customByVariant.get(String(target.variantCode));
      if (existing === undefined) continue; // 카페24에 더 이상 없는 옵션
      if (norm(existing) === norm(code)) continue;
      // 이미 다른 코드가 들어 있으면 덮어쓰지 않는다 — 단 우리가 넣은 자기 자신 코드(C24V-옵션코드)는 대표 코드로 바꿔도 된다
      if (existing && norm(existing) !== selfCode(target)) continue;
      writes.push({ productNo: target.productNo, variantCode: target.variantCode, code, name: target.name });
    }
  }
  return writes;
}

module.exports = { variantGroupKey, groupVariants, linkVariantAliases, variantTargets, rowForVariant, variantCodeWrites };
