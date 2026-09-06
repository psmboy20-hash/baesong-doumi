'use strict';
// 채널 재고 자동 반영 — 이 앱의 실물 재고가 마스터고, 채널(카페24 등)에는 "가용 재고"를 내려보낸다.
// 가용 = 실물 − 아직 안 보낸 주문(대기·접수중) − 예비 수량.
// 계산·판정은 전부 여기(순수 함수), 실제 HTTP 는 server.js 가 send 함수로 주입한다.
const { inventorySku, inventoryCountKnown, selectStockMatches, splitShipmentItems } = require('./operations');

const DEFAULTS = { enabled: false, cafe24: true, reserve: 0, autoAfterChange: true };
const MAX_RESERVE = 99;
const MAX_PUSH = 100;            // 한 번에 보내는 최대 건수
const PUSH_INTERVAL_MS = 250;    // 카페24 호출 간격 (순차)
const MAX_SYNC_LOG = 2000;
// 아직 나갈 물량 — 보류 건도 언젠가 나가므로 잡아둔다. 발송완료는 이미 실물에서 빠졌다.
const PENDING_STATUS = new Set(['대기', '접수중']);

function channelStockPolicy(db) {
  const saved = (db && db.settings && db.settings.channelStock) || {};
  const reserve = Math.round(Number(saved.reserve));
  return {
    enabled: saved.enabled === true,
    cafe24: saved.cafe24 !== false,
    reserve: Number.isFinite(reserve) ? Math.min(MAX_RESERVE, Math.max(0, reserve)) : DEFAULTS.reserve,
    autoAfterChange: saved.autoAfterChange !== false
  };
}

// 사람이 확인한 줄만 채널에 반영한다 — 실사(lastCountedAt)·기초재고 가져오기(stockInitAt)·직접 ± 조정(stockVerifiedAt).
// 한 번도 안 만진 줄(qty 0 기본값)을 카페24로 밀면 판매가능 수량이 0으로 지워지는 사고가 나므로 절대 반영하지 않는다.
function rowVerified(inv) {
  return !!(inv && (inv.lastCountedAt || inv.stockInitAt || inv.stockVerifiedAt));
}
// 자동 반영을 켤 수 있는 조건 = 확인된 줄이 하나라도 있다
function stockInitialized(db) {
  return ((db && db.inventory) || []).some(inv => !inv.retiredAggregate && rowVerified(inv));
}

// 대기·접수중 항목이 잡아둔 수량 (항목→재고 줄 매칭은 출고 차감과 같은 규칙)
function reservedBySku(db, opts = {}) {
  const inventory = (db && db.inventory) || [];
  const map = new Map();
  const onlyChannels = Array.isArray(opts.channels) && opts.channels.length ? new Set(opts.channels) : null; // 예: ['cafe24'] 만
  for (const item of [...((db && db.orders) || []), ...((db && db.seeding) || [])]) {
    if (!PENDING_STATUS.has(String(item.status || '대기'))) continue;
    if (!item.product) continue;
    if (onlyChannels && !onlyChannels.has(String(item.sourceChannel || (item.orderNo ? 'cafe24' : 'seeding')))) continue;
    for (const line of splitShipmentItems(item)) {
      const matches = selectStockMatches(inventory, line);
      if (matches.length !== 1) continue;
      const sku = matches[0].sku || inventorySku(matches[0]);
      map.set(sku, (map.get(sku) || 0) + Math.max(0, Number(line.qty) || 1));
    }
  }
  return map;
}

function availableQty(inv, reserved, policy) {
  if (!inv || inv.retiredAggregate || !inventoryCountKnown(inv) || !rowVerified(inv)) return null; // 실사 필요·집계·미확인 줄은 반영 대상 아님
  const reserve = channelStockPolicy({ settings: { channelStock: policy || {} } }).reserve;
  return Math.max(0, (Number(inv.qty) || 0) - (Number(reserved) || 0) - reserve);
}

function skuOf(inv) { return inv.sku || inventorySku(inv); }
function cafe24QtyOf(inv) {
  const n = Number(inv.cafe24Qty);
  return inv.cafe24Qty === null || inv.cafe24Qty === undefined || inv.cafe24Qty === '' || !Number.isFinite(n) ? null : n;
}

// 채널 공통 — 셀 수 있는 줄의 가용 수량 (API 없는 채널의 재고 업로드 엑셀용)
function availableList(db, policy) {
  const reserved = reservedBySku(db);
  const rows = [];
  for (const inv of ((db && db.inventory) || [])) {
    const sku = skuOf(inv);
    const available = availableQty(inv, reserved.get(sku) || 0, policy);
    if (available === null) continue;
    rows.push({
      id: inv.id, sku, name: inv.name || '', color: inv.color || '', size: inv.size || '',
      physical: Number(inv.qty) || 0, reserved: reserved.get(sku) || 0, available
    });
  }
  return rows;
}

// 카페24에 보낼 줄만 추림 — productNo+variantCode 있고, 카페24가 재고관리 하는 옵션이고, 수량이 다른 줄
function planCafe24Push(db, policy) {
  const reserved = reservedBySku(db);
  const rows = [];
  const skipped = { noVariant: 0, notTracked: 0, needsCount: 0, unverified: 0, same: 0 };
  for (const inv of ((db && db.inventory) || [])) {
    if (!inv.productNo || !inv.variantCode || inv.cafe24VariantActive === false) { skipped.noVariant++; continue; }
    if (inv.cafe24StockTracked !== true) { skipped.notTracked++; continue; }
    const sku = skuOf(inv);
    const available = availableQty(inv, reserved.get(sku) || 0, policy);
    if (available === null) { if (inventoryCountKnown(inv) && !rowVerified(inv)) skipped.unverified++; else skipped.needsCount++; continue; }
    const cafe24Qty = cafe24QtyOf(inv);
    if (available === cafe24Qty) { skipped.same++; continue; }
    rows.push({
      id: inv.id, sku, name: inv.name || '', color: inv.color || '', size: inv.size || '',
      physical: Number(inv.qty) || 0, reserved: reserved.get(sku) || 0,
      available, cafe24Qty, delta: available - (cafe24Qty || 0)
    });
  }
  return { rows, skipped };
}

// 반영 대기 표식 정리: 카페24와 이미 같은 값이거나 애초에 반영 대상이 아닌 줄은 대기에서 뺀다 (안 하면 '반영 대기' 칩이 영원히 남음)
function clearSettledDirty(db, policy) {
  const reserved = reservedBySku(db);
  let cleared = 0;
  for (const inv of ((db && db.inventory) || [])) {
    if (!inv.channelDirty) continue;
    const target = inv.productNo && inv.variantCode && inv.cafe24VariantActive !== false && inv.cafe24StockTracked === true;
    const available = availableQty(inv, reserved.get(skuOf(inv)) || 0, policy);
    if (!target || available === null || available === cafe24QtyOf(inv)) { delete inv.channelDirty; cleared++; }
  }
  return cleared;
}
function channelDirtyCount(db) { return ((db && db.inventory) || []).filter(inv => inv.channelDirty).length; }
function channelFailedCount(db) { return ((db && db.inventory) || []).filter(inv => inv.channelSyncError).length; }
function lastPushAt(db) {
  return ((db && db.inventory) || []).reduce((last, inv) =>
    inv.cafe24PushedAt && (!last || inv.cafe24PushedAt > last) ? inv.cafe24PushedAt : last, '') || null;
}

function logChannelSync(db, row) {
  if (!Array.isArray(db.channelSyncLog)) db.channelSyncLog = [];
  db.channelSyncLog.push(row);
  if (db.channelSyncLog.length > MAX_SYNC_LOG) db.channelSyncLog = db.channelSyncLog.slice(-MAX_SYNC_LOG);
}

function responseText(res) {
  if (!res) return '';
  return [res.text || '', res.json ? JSON.stringify(res.json) : ''].join(' ');
}
// 재고 수정 권한(mall.write_product)이 없으면 카페24가 403 / insufficient_scope 로 답한다 — 재연결 전까지 더 시도하지 않는다
function scopeMissingResponse(res) {
  return !!res && (res.status === 403 || /insufficient_scope/i.test(responseText(res)));
}
function responseError(res) {
  if (!res) return '카페24 응답을 받지 못했어요.';
  const body = (res.json && (res.json.error || res.json)) || {};
  const message = body.message || body.error_description || body.error || (res.text || '');
  const text = String(typeof message === 'string' ? message : JSON.stringify(message)).trim().slice(0, 160);
  return (text || '카페24 응답 오류') + ' (' + res.status + ')';
}

// 순차 반영. send(inv, qty) 는 { status, json, text } 를 돌려주는 함수 — server.js 가 cafe24Fetch 로 주입하고 테스트는 스텁을 넣는다.
async function pushCafe24Stock(db, rows, opts = {}) {
  const trigger = opts.trigger || 'manual';
  const send = opts.send;
  const wait = opts.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = () => (opts.now ? new Date(opts.now) : new Date()).toISOString();
  const out = { pushed: 0, failed: [], scopeMissing: false };
  const list = (rows || []).slice(0, MAX_PUSH);
  for (let i = 0; i < list.length; i++) {
    if (db.channelStockScopeMissing) { out.scopeMissing = true; break; }
    const row = list[i];
    const inv = ((db && db.inventory) || []).find(entry => Number(entry.id) === Number(row.id));
    if (!inv) continue;
    if (i > 0) await wait(PUSH_INTERVAL_MS);
    const qty = Math.max(0, Number(row.available) || 0);
    const from = cafe24QtyOf(inv);
    let res = null;
    let error = '';
    try { res = await send(inv, qty); }
    catch (e) { error = String((e && e.message) || e).slice(0, 160); }
    if (!error && (!res || res.status !== 200)) {
      if (scopeMissingResponse(res)) {
        db.channelStockScopeMissing = true;
        out.scopeMissing = true;
        error = '카페24 재고 수정 권한이 없어요. 설정에서 카페24를 다시 연결해 주세요.';
      } else {
        error = responseError(res);
      }
    }
    const at = now();
    if (error) {
      inv.channelSyncError = error;
      inv.channelSyncFails = (Number(inv.channelSyncFails) || 0) + 1;
      out.failed.push({ id: inv.id, sku: skuOf(inv), name: [inv.name, inv.color, inv.size].filter(Boolean).join(' '), error });
    } else {
      inv.cafe24Qty = qty;
      inv.cafe24PushedAt = at;
      inv.cafe24PushedQty = qty;
      delete inv.channelDirty;
      delete inv.channelSyncError;
      delete inv.channelSyncFails;
      out.pushed++;
    }
    logChannelSync(db, {
      ts: at, channel: 'cafe24', sku: skuOf(inv), name: [inv.name, inv.color, inv.size].filter(Boolean).join(' '),
      from, to: qty, ok: !error, error: error || '', trigger
    });
    if (out.scopeMissing) break;
  }
  return out;
}

module.exports = { rowVerified, clearSettledDirty,
  DEFAULTS,
  MAX_PUSH,
  PUSH_INTERVAL_MS,
  channelStockPolicy,
  stockInitialized,
  reservedBySku,
  availableQty,
  availableList,
  planCafe24Push,
  channelDirtyCount,
  channelFailedCount,
  lastPushAt,
  logChannelSync,
  pushCafe24Stock
};
