function compact(value) {
  return String(value == null ? '' : value).trim();
}

function phoneDigits(value) {
  return compact(value).replace(/\D/g, '');
}

function normName(value) {
  return compact(value).replace(/\s+/g, '').replace(/\(.*?\)/g, '');
}

function seedKey(item) {
  return normName(item && item.name) + '|' + phoneDigits(item && item.phone);
}

function normalizeSeedingPacking(value) {
  return /패키지/.test(compact(value).replace(/\s+/g, '')) ? '패키지 시딩' : '시딩';
}

function stableSheetRowId(value) {
  const id = compact(value);
  return id && id.length <= 100 ? id : '';
}

function sameText(left, right) {
  return compact(left).replace(/\s+/g, '').toLowerCase() === compact(right).replace(/\s+/g, '').toLowerCase();
}

function setField(target, key, value) {
  const next = compact(value);
  if (compact(target[key]) === next) return false;
  target[key] = next;
  return true;
}

function findExactSeedingCol(header, names) {
  const expected = new Set((names || []).map(value => compact(value).replace(/\s+/g, '').toLowerCase()));
  return (header || []).findIndex(value => expected.has(compact(value).replace(/\s+/g, '').toLowerCase()));
}

function inspectSeedingSchema(header, col, sourceIdCol) {
  const normalized = (header || []).map(value => compact(value).replace(/\s+/g, '').toLowerCase());
  const counts = new Map();
  for (const value of normalized.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
  const missing = [];
  const required = [
    ['고유번호', sourceIdCol], ['시딩 형태', col.pack], ['성명', col.name],
    ['연락처', col.phone], ['주소', col.addr], ['비고', col.note]
  ];
  for (const [label, index] of required) if (index < 0) missing.push(label);
  if (col.product < 0 && col.masterProduct < 0) missing.push('제품명');

  const auto = [
    ['상품·옵션 선택', col.selectedOption], ['상품명(자동)', col.masterProduct],
    ['컬러(자동)', col.masterColor], ['사이즈(자동)', col.masterSize],
    ['상품번호(자동)', col.masterProductNo], ['옵션품번(자동)', col.variantCode]
  ];
  const presentAuto = auto.filter(([, index]) => index >= 0);
  if (presentAuto.length && presentAuto.length !== auto.length) {
    for (const [label, index] of auto) if (index < 0) missing.push(label);
  }
  const ok = missing.length === 0 && duplicates.length === 0;
  let message = '배송 도우미와 정상적으로 연결되어 있어요.';
  if (missing.length) message = '연결에 필요한 열이 없어요: ' + missing.join(', ');
  else if (duplicates.length) message = '같은 이름의 머리글이 두 개 있어요: ' + duplicates.join(', ');
  return {
    ok,
    headerCount: normalized.filter(Boolean).length,
    headers: normalized,
    missing,
    duplicates,
    message
  };
}

function seedingProductFields(row, col) {
  const value = index => compact(index >= 0 ? row[index] : '');
  const masterProduct = value(col.masterProduct);
  const masterColor = value(col.masterColor);
  const masterSize = value(col.masterSize);
  const fields = {
    product: masterProduct || value(col.product),
    size: masterSize || value(col.size)
  };
  if (col.selectedOption >= 0) fields.selectedOption = value(col.selectedOption);
  if (col.masterColor >= 0 || col.color >= 0) fields.color = masterColor || value(col.color);
  if (col.masterProductNo >= 0) fields.productNo = value(col.masterProductNo) || null;
  if (col.variantCode >= 0) fields.variantCode = value(col.variantCode);
  return fields;
}

function mergeSeedingRows(db, parsed, helpers) {
  const rows = Array.isArray(parsed) ? parsed : [];
  if (rows.some(row => !stableSheetRowId(row.sourceRowId))) {
    throw new Error('시딩 행 고유번호가 없어 동기화를 중지했습니다.');
  }
  const bySourceId = new Map();
  const buckets = new Map();
  for (const item of (db.seeding || [])) {
    const sourceRowId = stableSheetRowId(item.sourceRowId);
    if (sourceRowId && !bySourceId.has(sourceRowId)) bySourceId.set(sourceRowId, item);
    const key = seedKey(item);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }

  const usedIds = new Set();
  let added = 0, updated = 0;
  for (const source of rows) {
    const sourceRowId = stableSheetRowId(source.sourceRowId);
    let existing = sourceRowId ? bySourceId.get(sourceRowId) : null;
    if (existing && usedIds.has(existing.id)) existing = null;
    if (!existing) {
      const key = seedKey(source);
      const bucket = buckets.get(key) || [];
      const candidates = bucket.filter(item => !usedIds.has(item.id) && !stableSheetRowId(item.sourceRowId));
      const productAndAddress = candidates.filter(item => sameText(item.product, source.product) && sameText(item.addr, source.addr));
      const productOnly = candidates.filter(item => sameText(item.product, source.product));
      const addressOnly = candidates.filter(item => sameText(item.addr, source.addr));
      existing = productAndAddress.length === 1 ? productAndAddress[0]
        : productOnly.length === 1 ? productOnly[0]
          : addressOnly.length === 1 ? addressOnly[0]
            : candidates.length === 1 ? candidates[0] : null;
    }

    if (!existing) {
      const item = Object.assign({}, source, {
        sourceRowId,
        packType: normalizeSeedingPacking(source.packType),
        id: db.nextId++,
        status: source.invoice ? '발송완료' : '대기',
        sourceChannel: 'seeding',
        regDate: helpers.today()
      });
      db.seeding.push(item);
      usedIds.add(item.id);
      if (sourceRowId && !bySourceId.has(sourceRowId)) bySourceId.set(sourceRowId, item);
      added++;
      continue;
    }

    usedIds.add(existing.id);
    let changed = false;
    if (sourceRowId && existing.sourceRowId !== sourceRowId) {
      existing.sourceRowId = sourceRowId;
      changed = true;
    }
    if (source.invoice && !existing.invoice && source.invoice !== existing.canceledInvoice) {
      existing.invoice = source.invoice;
      existing.status = '발송완료';
      existing.sentDate = source.sentDate || existing.sentDate || helpers.today();
      changed = true;
    }

    changed = setField(existing, 'packType', normalizeSeedingPacking(source.packType)) || changed;
    for (const field of ['seedType', 'request', 'note']) {
      changed = setField(existing, field, source[field]) || changed;
    }

    if (existing.status === '취소됨' && !existing.invoice && !existing.manualCanceled) {
      existing.status = '대기';
      changed = true;
    }
    if (existing.status === '대기' || existing.status === '접수중') {
      const addressChanged = compact(source.addr) !== compact(existing.addr);
      if (addressChanged) {
        const previousZip = existing.zip;
        existing.addr = compact(source.addr);
        existing.zip = helpers.zipForChangedAddress(previousZip, source.zip);
        helpers.clearZipLookupState(existing);
        changed = true;
      }
      for (const field of ['name', 'phone', 'insta', 'product', 'color', 'size', 'selectedOption', 'productNo', 'variantCode']) {
        if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
        changed = setField(existing, field, source[field]) || changed;
      }
      if (!addressChanged && compact(source.zip) !== compact(existing.zip)) {
        existing.zip = compact(source.zip);
        changed = true;
      }
    }
    if (changed) updated++;
  }

  let canceled = 0;
  if (rows.length) {
    for (const item of db.seeding) {
      if (!usedIds.has(item.id) && (item.status === '대기' || item.status === '접수중')) {
        item.status = '취소됨';
        canceled++;
      }
    }
  }
  return { added, updated, canceled };
}

module.exports = {
  seedKey,
  normalizeSeedingPacking,
  stableSheetRowId,
  findExactSeedingCol,
  inspectSeedingSchema,
  seedingProductFields,
  mergeSeedingRows
};
