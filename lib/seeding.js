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

function setField(target, key, value) {
  const next = compact(value);
  if (compact(target[key]) === next) return false;
  target[key] = next;
  return true;
}

function mergeSeedingRows(db, parsed, helpers) {
  const rows = Array.isArray(parsed) ? parsed : [];
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
  const bucketCursor = new Map();
  let added = 0, updated = 0;
  for (const source of rows) {
    const sourceRowId = stableSheetRowId(source.sourceRowId);
    let existing = sourceRowId ? bySourceId.get(sourceRowId) : null;
    if (existing && usedIds.has(existing.id)) existing = null;
    if (!existing) {
      const key = seedKey(source);
      const bucket = buckets.get(key) || [];
      let cursor = bucketCursor.get(key) || 0;
      while (cursor < bucket.length && usedIds.has(bucket[cursor].id)) cursor++;
      existing = bucket[cursor] || null;
      bucketCursor.set(key, cursor + (existing ? 1 : 0));
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
      for (const field of ['name', 'phone', 'insta', 'product', 'size']) {
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
  mergeSeedingRows
};
