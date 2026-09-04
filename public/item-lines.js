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

  function epostFilterMatches(item, filter) {
    const source = item || {};
    if (!source.epost) return false;
    if (!filter || filter === 'all') return true;
    if (filter === 'pickup') {
      return source.status === '발송완료' && !source.delivered &&
        ['00', '01', '02'].includes(source.epost.stus || '01');
    }
    if (filter === 'print') {
      return source.status === '발송완료' && !source.delivered &&
        !source.printed &&
        !['03', '05'].includes(source.epost.stus || '01');
    }
    if (filter === 'problem') {
      return source.status === '발송완료' && !source.delivered && source.epost.stus === '04';
    }
    return true;
  }

  function hasVirtualPhone(label, phone) {
    const virtual = String(label && label.vTelNo || '').replace(/\D/g, '');
    const actual = String(phone || '').replace(/\D/g, '');
    return Boolean(virtual && virtual !== actual);
  }

  function normalizedRecipient(item) {
    const source = item || {};
    const name = String(source.name || '').replace(/\s+/g, '').replace(/\(.*?\)/g, '').trim();
    const phone = String(source.phone || '').replace(/\D/g, '');
    const addr = String(source.addr || '')
      .replace(/\((\d{5})\)/g, '')
      .replace(/\(우\)?\s*\d{5}\)?/g, '')
      .replace(/우편번호[:\s]*\d{5}/g, '')
      .replace(/\s+/g, '')
      .trim();
    return name && phone && addr ? name + '|' + phone + '|' + addr : '';
  }

  // 받는 사람이 같은데 따로 나갈 택배(주문끼리 · 시딩끼리 · 주문+시딩)를 찾아 합포장을 권한다
  // 단위: 카페24 주문은 주문번호, 시딩은 시트 행(건) 하나
  function mergeUnitOf(entry) {
    const item = entry && entry.x;
    if (!item) return '';
    if (entry.kind === 'orders' && item.orderNo) return 'order:' + String(item.orderNo).trim();
    if (entry.kind === 'seeding') return 'seeding:' + String(item.id);
    return '';
  }
  function cafe24MergeSuggestions(entries, allEntries) {
    const blocked = new Set();
    for (const entry of (allEntries || entries || [])) {
      const item = entry && entry.x;
      const unit = mergeUnitOf(entry);
      if (!item || !unit || item.status === '취소됨') continue;
      if (item.packGroupId || item.parcelSplitId || item.shippingHold ||
          String(item.status || '대기') !== '대기' || item.epost || item.invoice ||
          item.epostOp && ['pending', 'unknown'].includes(item.epostOp.state)) {
        blocked.add(unit);
      }
    }
    const recipients = new Map();
    for (const entry of (entries || [])) {
      const item = entry && entry.x;
      const unit = mergeUnitOf(entry);
      if (!item || !unit || blocked.has(unit)) continue;
      if (String(item.status || '대기') !== '대기' || item.epost || item.invoice) continue;
      if (item.epostOp && ['pending', 'unknown'].includes(item.epostOp.state)) continue;
      const recipient = normalizedRecipient(item);
      if (!recipient) continue;
      if (!recipients.has(recipient)) recipients.set(recipient, new Map());
      const units = recipients.get(recipient);
      if (!units.has(unit)) units.set(unit, []);
      units.get(unit).push(entry);
    }
    const suggestions = [];
    for (const [recipientKey, units] of recipients) {
      if (units.size < 2) continue;
      const unitKeys = [...units.keys()];
      const groupedEntries = unitKeys.flatMap(key => units.get(key));
      suggestions.push({
        recipientKey,
        name: groupedEntries[0].x.name || '',
        orderNos: unitKeys,
        units: {
          orders: unitKeys.filter(key => key.startsWith('order:')).length,
          seeding: unitKeys.filter(key => key.startsWith('seeding:')).length
        },
        entries: groupedEntries
      });
    }
    return suggestions;
  }

  function stockIdentity(item) {
    const source = item || {};
    const variant = String(source.variantCode || '').trim().toUpperCase();
    if (variant) return 'V|' + variant;
    const sku = String(source.sku || '').trim().toUpperCase();
    return sku ? 'S|' + sku : '';
  }

  function shipmentStockStates(items, inventory) {
    const result = new Map();
    const grouped = new Map();
    for (const item of (items || [])) {
      const identity = stockIdentity(item);
      if (!identity) {
        result.set(item.id, { state: 'unknown', needed: Number(item.qty) || 1, available: null, shortage: 0 });
        continue;
      }
      if (!grouped.has(identity)) grouped.set(identity, { items: [], needed: 0 });
      const group = grouped.get(identity);
      group.items.push(item);
      group.needed += Math.max(1, Number(item.qty) || 1);
    }
    for (const [identity, group] of grouped) {
      const matches = (inventory || []).filter(row => !row.retiredAggregate && stockIdentity(row) === identity);
      const known = matches.length === 1 && !matches[0].needsCount && matches[0].qty !== null &&
        matches[0].qty !== undefined && Number.isFinite(Number(matches[0].qty));
      let remaining = known ? Math.max(0, Number(matches[0].qty)) : null;
      const ordered = [...group.items].sort((a, b) => {
        const aTime = Date.parse(a.orderedAt || a.regDate || '') || 0;
        const bTime = Date.parse(b.orderedAt || b.regDate || '') || 0;
        return aTime - bTime || Number(a.id || 0) - Number(b.id || 0);
      });
      for (const item of ordered) {
        const needed = Math.max(1, Number(item.qty) || 1);
        if (!known) {
          result.set(item.id, { state: 'unknown', needed, available: null, shortage: 0 });
          continue;
        }
        const available = remaining;
        const shortage = Math.max(0, needed - available);
        result.set(item.id, { state: shortage ? 'shortage' : 'enough', needed, available, shortage });
        remaining = Math.max(0, remaining - needed);
      }
    }
    return result;
  }

  function sentShipmentKey(item, recipientKey) {
    if (!item || item.status !== '발송완료') return '';
    if (item.packGroupId) return 'sent|pack|' + item.packGroupId;
    if (item.orderNo && item.parcelSplitId) return 'sent|split|' + item.orderNo + '|' + item.parcelSplitId;
    if (item.orderNo) return 'sent|order|' + item.orderNo;
    if (item.returnId) return 'sent|return|' + item.returnId;
    return 'sent|' + String(item.sentDate || '') + '|' + String(recipientKey || '');
  }

  return {
    splitShipmentItems,
    parcelContent,
    expandSelectedEpostItems,
    fullySelectedEntries,
    shipmentProductNotes,
    epostFilterMatches,
    hasVirtualPhone,
    cafe24MergeSuggestions,
    shipmentStockStates,
    sentShipmentKey
  };
});
