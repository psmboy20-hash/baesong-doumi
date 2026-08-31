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
    if (!rawLines.length) return [];
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

  function shipmentProductNotes(item) {
    return productTextParts(item).noteLines;
  }

  return { splitShipmentItems, shipmentProductNotes };
});
