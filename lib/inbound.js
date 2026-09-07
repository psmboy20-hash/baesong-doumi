'use strict';
// 입고 예정(발주) 순수 로직 — 등록·입고 확인(재고 반영 + 입출고 장부)·취소.
// 시간과 재고 장부 기록(logStock)은 인자로 받아 테스트에서 고정할 수 있게 한다.
const { inventorySku } = require('./operations');
const { logStockAt, dateOf } = require('./stock-ledger');

const INBOUND_REASON = '본사 입고';
const MAX_QTY = 9999;

function invList(db) { return Array.isArray(db && db.inventory) ? db.inventory : []; }
function skuOf(inv) { return inv.sku || inventorySku(inv); }

// 읽기 전용 — db 를 변형하지 않는다 (없으면 빈 배열)
function inboundList(db) {
  return Array.isArray(db && db.inbound) ? db.inbound : [];
}

function findInventory(db, target) {
  const list = invList(db);
  const id = Number(target && target.inventoryId);
  if (Number.isFinite(id) && id > 0) {
    const hit = list.find(inv => Number(inv.id) === id);
    if (hit) return hit;
  }
  const sku = String(target && target.sku || '').trim();
  if (sku) {
    const hit = list.find(inv => skuOf(inv) === sku);
    if (hit) return hit;
  }
  return null;
}

function validEta(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

// 입고 예정 등록 — 재고 줄을 찾아 이름·컬러·사이즈를 그대로 복사해 둔다(나중에 이름이 바뀌어도 표에 남게)
function addInbound(db, body, options = {}) {
  const inv = findInventory(db, body || {});
  if (!inv) return { error: '어떤 상품을 받을지 재고에서 골라 주세요.' };
  const qty = Math.round(Number(body && body.qty));
  if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) return { error: '수량은 1~9999 사이 숫자로 적어 주세요.' };
  const eta = validEta(body && body.eta);
  if (!eta) return { error: '도착 예정일을 YYYY-MM-DD 로 골라 주세요.' };
  const at = options.now instanceof Date && !isNaN(options.now) ? options.now : new Date();
  if (!db.nextId) db.nextId = 1;
  const item = {
    id: db.nextId++,
    inventoryId: inv.id,
    sku: skuOf(inv),
    name: inv.name || '', color: inv.color || '', size: inv.size || '',
    qty,
    eta,
    memo: String(body && body.memo || '').trim().slice(0, 80),
    status: 'expected',
    createdAt: at.toISOString(),
    receivedAt: null,
    receivedQty: null
  };
  if (!Array.isArray(db.inbound)) db.inbound = [];
  db.inbound.push(item);
  return { ok: true, item };
}

// 입고 확인 — 재고를 늘리고 입출고 장부에 '본사 입고' 로 한 줄 남긴다 (ref: INB-<id>)
function receiveInbound(db, body, options = {}) {
  const list = inboundList(db);
  const item = list.find(row => Number(row.id) === Number(body && body.id));
  if (!item) return { error: '입고 예정 건을 찾지 못했어요.' };
  if (item.status !== 'expected') return { error: '이미 처리한 입고 예정이에요.' };
  const inv = findInventory(db, item);
  if (!inv) return { error: '입고할 재고 줄을 찾지 못했어요. 재고 화면에서 확인해 주세요.' };
  const wanted = body && body.qty != null && String(body.qty) !== '' ? Math.round(Number(body.qty)) : item.qty;
  if (!Number.isFinite(wanted) || wanted <= 0 || wanted > MAX_QTY) return { error: '수량은 1~9999 사이 숫자로 적어 주세요.' };
  const at = options.now instanceof Date && !isNaN(options.now) ? options.now : new Date();
  inv.qty = (Number(inv.qty) || 0) + wanted;
  inv.needsCount = false;
  const ref = 'INB-' + item.id;
  if (typeof options.logStock === 'function') options.logStock(db, inv, wanted, INBOUND_REASON, ref, item.memo);
  else logStockAt(db, inv, wanted, INBOUND_REASON, ref, at, item.memo);
  item.status = 'received';
  item.receivedAt = at.toISOString();
  item.receivedDate = dateOf(at);
  item.receivedQty = wanted;
  return { ok: true, item, inv, qty: wanted, left: inv.qty };
}

function cancelInbound(db, body) {
  const item = inboundList(db).find(row => Number(row.id) === Number(body && body.id));
  if (!item) return { error: '입고 예정 건을 찾지 못했어요.' };
  if (item.status === 'received') return { error: '이미 입고 확인한 건은 취소할 수 없어요.' };
  item.status = 'canceled';
  return { ok: true, item };
}

module.exports = {
  addInbound,
  receiveInbound,
  cancelInbound,
  inboundList
};
