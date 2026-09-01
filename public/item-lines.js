(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HamItemLines = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SIZE_TOKEN = '(?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|2XL|FREE|F)';
  const SIZE_ONLY = new RegExp('^' + SIZE_TOKEN + '$', 'i');
  const TRAILING_SIZE = new RegExp('(?:^|[\\s*(\\[])(?<size>' + SIZE_TOKEN + ')\\s*(?:사이즈)?\\s*[)\\]]?\\s*$', 'i');

  function sizeList(value) {
    return String(value || '')
      .split(/[,/|\n]+/)
      .map(size => size.trim().toUpperCase())
      .filter(size => SIZE_ONLY.test(size));
  }

  function lineWithSize(value) {
    const product = String(value || '').trim();
    const match = product.match(TRAILING_SIZE);
    if (!match) return { product, size: '' };
    return {
      product: product.slice(0, match.index).trim(),
      size: String(match.groups ? match.groups.size : match[1]).toUpperCase()
    };
  }

  function productTextParts(item) {
    const productLines = [];
    const noteLines = [];
    for (const line of String((item && item.product) || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
      if (/^(?:[*※]|비고\s*[:：])/.test(line)) noteLines.push(line.replace(/^(?:[*※]|비고\s*[:：])\s*/, ''));
      else productLines.push(line);
    }
    return { productLines, noteLines };
  }

  function splitShipmentItems(item) {
    const source = item || {};
    const rawLines = productTextParts(source).productLines;
    if (!rawLines.length) return [Object.assign({}, source, { product: '', qty: Number(source.qty) || 1 })];
    const lines = rawLines.map(lineWithSize);
    const sizes = sizeList(source.size);

    if (lines.length === 1 && !lines[0].size && sizes.length > 1) {
      return sizes.map(size => Object.assign({}, source, {
        product: lines[0].product,
        size,
        qty: 1,
        sku: '',
        variantCode: ''
      }));
    }

    return lines.map((line, index) => {
      const fallbackSize = sizes.length === lines.length ? sizes[index] : (sizes.length === 1 ? sizes[0] : '');
      return Object.assign({}, source, {
        product: line.product,
        size: line.size || fallbackSize,
        qty: lines.length > 1 ? 1 : (Number(source.qty) || 1),
        sku: lines.length > 1 ? '' : (source.sku || ''),
        variantCode: lines.length > 1 ? '' : (source.variantCode || '')
      });
    });
  }

  function parcelContent(items) {
    const rows = (items || []).flatMap(splitShipmentItems);
    return {
      rows,
      products: rows.map(row => String(row.product || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / '),
      models: rows.map(row =>
        [row.color, row.size].filter(Boolean).join(' ') || String(row.option || '').trim()
      ).filter(Boolean).join(' / '),
      qty: rows.reduce((sum, row) => sum + (Number(row.qty) || 1), 0)
    };
  }

  function expandSelectedEpostItems(db, selections) {
    const all = [
      ...(db && db.orders || []).map(it => ({ type: 'order', it })),
      ...(db && db.seeding || []).map(it => ({ type: 'seeding', it }))
    ];
    const byId = new Map(all.map(entry => [entry.type + ':' + entry.it.id, entry]));
    const added = new Set();
    const expandedOrders = new Set();
    const out = [];
    const add = entry => {
      const id = entry.type + ':' + entry.it.id;
      if (added.has(id)) return;
      added.add(id);
      out.push(entry);
    };
    for (const selection of (selections || [])) {
      const entry = byId.get(selection.type + ':' + Number(selection.id));
      if (!entry || !entry.it.epost) continue;
      const orderNo = String(entry.it.epost.orderNo || '').trim();
      if (!orderNo) { add(entry); continue; }
      if (expandedOrders.has(orderNo)) continue;
      expandedOrders.add(orderNo);
      for (const candidate of all) {
        if (candidate.it.epost && String(candidate.it.epost.orderNo || '').trim() === orderNo) add(candidate);
      }
    }
    return out;
  }

  function fullySelectedEntries(entries, keyOf, isSelected) {
    const groups = new Map();
    for (const entry of (entries || [])) {
      const key = keyOf(entry);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    return [...groups.values()].filter(group => group.every(isSelected)).flat();
  }

  function shipmentProductNotes(item) {
    return productTextParts(item).noteLines;
  }

  return { splitShipmentItems, parcelContent, expandSelectedEpostItems, fullySelectedEntries, shipmentProductNotes };
});
