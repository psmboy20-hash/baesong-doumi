'use strict';
// 재고 수불(기초재고·실사·수불부·CSV) 순수 로직 — server.js 라우트는 얇게 두고 계산은 여기서 한다.
// 시간은 인자(now)로 받아 테스트에서 고정할 수 있게 한다.
const { inventorySku } = require('./operations');

const DEFAULT_MIN_QTY = 2;          // 안전재고 기본값 (카페24 안전재고가 없을 때)
const MAX_STOCK_LOG = 3000;         // server.js logStock 과 같은 보관 개수
const MAX_STOCKTAKES = 60;          // 실사 기록 보관 개수
const INIT_REASON = '기초 재고';
const INIT_REF = '카페24 수량 기준';
// 옛 데이터에 남아 있는 사유 이름을 지금 쓰는 이름으로 맞춘다
const LEGACY_REASONS = { '출고': '주문 출고' };

// server.js 의 today() 와 같은 방식 (한국 로컬 날짜 — UTC를 쓰면 오전 9시 전 기록이 전날로 찍힘)
function dateOf(now) {
  const d = now instanceof Date && !isNaN(now) ? now : new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function atOf(now) { return now instanceof Date && !isNaN(now) ? now : new Date(); }
function skuOf(inv) { return inv.sku || inventorySku(inv); }
function invKey(x) { return x.sku || [x.name, x.color || '', x.size || ''].join('|'); }

// server.js logStock 과 같은 모양의 한 줄을 남긴다 (시각만 인자로 받음)
// note 는 사람이 적은 메모 — ref(코드·시스템 근거)와 섞지 않는다 (개인정보 정리가 ref만 지우기 때문)
function logStockAt(db, inv, delta, reason, ref, now, note) {
  if (!Array.isArray(db.stockLog)) db.stockLog = [];
  const at = atOf(now);
  const row = {
    ts: at.toISOString(), date: dateOf(at),
    sku: skuOf(inv),
    name: inv.name, color: inv.color || '', size: inv.size || '',
    delta, left: inv.qty, reason, ref: ref || ''
  };
  if (note) row.note = String(note);
  db.stockLog.push(row);
  if (db.stockLog.length > MAX_STOCK_LOG) db.stockLog = db.stockLog.slice(-MAX_STOCK_LOG);
}

function normalizeReason(reason) {
  const s = String(reason == null ? '' : reason).trim();
  if (!s) return '기타';
  return LEGACY_REASONS[s] || s;
}

// ── 1. 기초재고 가져오기 (카페24 수량 → 실물 수량) ──────────────────────────
function hasCafe24Snapshot(inv) {
  const v = inv.cafe24Qty;
  if (v === null || v === undefined || v === '') return false;
  return Number.isFinite(Number(v));
}
function initCandidate(inv) {
  if (!inv || inv.retiredAggregate) return false;
  if (inv.cafe24VariantActive === false) return false;
  if (inv.cafe24StockTracked === false) return false; // 카페24가 재고관리를 안 하는 옵션은 수량이 뜻이 없다
  return hasCafe24Snapshot(inv);
}

function initFromCafe24(db, opts = {}) {
  const now = atOf(opts.now);
  const wanted = Array.isArray(opts.ids) && opts.ids.length
    ? new Set(opts.ids.map(Number).filter(Number.isFinite)) : null;
  const rows = [];
  let skipped = 0;
  for (const inv of (db.inventory || [])) {
    if (wanted && !wanted.has(Number(inv.id))) continue;
    if (!initCandidate(inv)) { if (wanted) skipped++; continue; }
    const before = Number(inv.qty) || 0;
    if (before > 0 && !inv.needsCount) { skipped++; continue; } // 이미 실물 수량이 있는 줄은 건드리지 않는다
    const next = Math.max(0, Math.round(Number(inv.cafe24Qty)));
    inv.qty = next;
    inv.needsCount = false;
    delete inv.stockIssue;
    if (!inv.sku) inv.sku = inventorySku(inv);
    if (next - before !== 0) logStockAt(db, inv, next - before, INIT_REASON, INIT_REF, now);
    rows.push({ id: inv.id, sku: skuOf(inv), qty: next });
  }
  return { applied: rows.length, skipped, rows };
}

// ── 2. 재고 실사 ────────────────────────────────────────────────────────────
function applyStocktake(db, rows, opts = {}) {
  const now = atOf(opts.now);
  const memo = String(opts.memo || '').trim().slice(0, 80);
  const ref = `실사 ${dateOf(now)}`; // 메모는 ref 가 아니라 note 로 따로 남긴다
  const adjusted = [];
  const errors = [];
  let unchanged = 0;
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const id = row == null ? null : Number(row.id);
    const inv = (db.inventory || []).find(i => Number(i.id) === id);
    if (!inv) { errors.push({ id: row && row.id, error: '해당 재고를 찾지 못했어요.' }); continue; }
    const counted = Number(row.counted);
    if (!Number.isInteger(counted) || counted < 0) {
      errors.push({ id: inv.id, error: '실사 수량은 0 이상 정수로 적어 주세요.' });
      continue;
    }
    const before = Number(inv.qty) || 0;
    // 화면이 숫자를 적는 사이에 주문 출고 등으로 재고가 바뀌었으면 덮어쓰지 않는다 (센 값이 이미 낡음)
    const orig = Number(row.orig);
    if (row.orig !== null && row.orig !== undefined && row.orig !== '' && Number.isFinite(orig) && orig !== before) {
      errors.push({ id: inv.id, error: `그 사이 재고가 ${before}개로 바뀌었어요. 다시 세 주세요.` });
      continue;
    }
    const diff = counted - before;
    inv.qty = counted;
    inv.needsCount = false;
    inv.lastCountedAt = now.toISOString();
    if (!inv.sku) inv.sku = inventorySku(inv);
    if (!diff) { unchanged++; continue; }
    logStockAt(db, inv, diff, diff > 0 ? '재고 조정 (+)' : '재고 조정 (−)', ref, now, memo);
    adjusted.push({
      id: inv.id, sku: skuOf(inv), name: inv.name, color: inv.color || '', size: inv.size || '',
      before, after: counted, diff
    });
  }
  if (adjusted.length || unchanged) {
    if (!Array.isArray(db.stocktakes)) db.stocktakes = [];
    db.stocktakes.push({ at: now.toISOString(), memo, adjusted: adjusted.length, unchanged, rows: adjusted });
    if (db.stocktakes.length > MAX_STOCKTAKES) db.stocktakes = db.stocktakes.slice(-MAX_STOCKTAKES);
  }
  return { adjusted, unchanged, errors };
}

// ── 3. 안전재고 ─────────────────────────────────────────────────────────────
function minQtyOf(inv) {
  const own = Number(inv && inv.minQty);
  if (Number.isFinite(own) && own >= 0) return Math.min(999, Math.round(own));
  const safety = Number(inv && inv.cafe24SafetyInventory);
  if (Number.isFinite(safety) && safety > 0) return Math.min(999, Math.round(safety));
  return DEFAULT_MIN_QTY;
}
function lowStock(inv) {
  return (Number(inv && inv.qty) || 0) <= minQtyOf(inv);
}

// ── 5. 수불 집계 ────────────────────────────────────────────────────────────
// 기말 = 지금 재고 − (그 달 이후 변동), 기초 = 지금 재고 − (그 달 1일 이후 변동)
function ledgerSummary(log, inventory, ym) {
  const month = String(ym || '').slice(0, 7);
  const monthStart = month + '-01';
  const monthEnd = month + '-31';
  const map = new Map();
  const blank = x => ({
    sku: x.sku || '', name: x.name || '', color: x.color || '', size: x.size || '',
    now: 0, inN: 0, outN: 0, after: 0, since: 0, byReason: {}, fromLog: false, at: ''
  });
  for (const inv of (inventory || [])) {
    const row = blank(inv);
    row.sku = inv.sku || inventorySku(inv);
    row.now = Number(inv.qty) || 0;
    map.set(invKey(inv), row);
  }
  for (const e of (log || [])) {
    const key = invKey(e);
    if (!map.has(key)) map.set(key, Object.assign(blank(e), { fromLog: true }));
    const row = map.get(key);
    // 재고 줄이 없어진(합쳐지거나 지워진) SKU는 가장 최근 기록의 '남음'을 현재 재고로 본다
    if (row.fromLog) {
      const at = String(e.ts || e.date || '');
      if (at >= row.at) { row.now = Number(e.left) || 0; row.at = at; }
    }
    const delta = Number(e.delta) || 0;
    const date = String(e.date || '');
    if (date > monthEnd) row.after += delta;
    if (date >= monthStart) row.since += delta;
    if (date.startsWith(month)) {
      if (delta > 0) row.inN += delta; else row.outN -= delta;
      const reason = normalizeReason(e.reason);
      row.byReason[reason] = (row.byReason[reason] || 0) + Math.abs(delta);
    }
  }
  const rows = [...map.values()]
    .map(row => ({
      sku: row.sku, name: row.name, color: row.color, size: row.size,
      start: row.now - row.since, inN: row.inN, outN: row.outN, end: row.now - row.after,
      byReason: row.byReason
    }))
    .filter(row => row.inN || row.outN || row.end > 0)
    .sort((a, b) => (b.inN + b.outN) - (a.inN + a.outN) || String(a.name).localeCompare(String(b.name)));
  const totals = rows.reduce((s, r) => ({
    start: s.start + r.start, inN: s.inN + r.inN, outN: s.outN + r.outN, end: s.end + r.end
  }), { start: 0, inN: 0, outN: 0, end: 0 });
  return { ym: month, rows, totals };
}

// ── 6. CSV (엑셀에서 바로 열리도록 UTF-8 BOM + CRLF) ────────────────────────
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // 엑셀 수식 주입 막기 — 숫자 값(-3 같은 음수)은 그대로 두고 문자열일 때만 앞에 ' 를 붙인다
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows, columns) {
  const cols = (columns || []).map(c => (typeof c === 'string'
    ? { key: c, label: c }
    : { key: c.key, label: c.label == null ? c.key : c.label, value: c.value }));
  const lines = [cols.map(c => csvCell(c.label)).join(',')];
  for (const row of (rows || [])) {
    lines.push(cols.map(c => csvCell(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const LEDGER_COLUMNS = [
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: '제품' },
  { key: 'color', label: '컬러' },
  { key: 'size', label: '사이즈' },
  { key: 'start', label: '기초' },
  { key: 'inN', label: '입고' },
  { key: 'outN', label: '출고' },
  { key: 'end', label: '기말' },
  { key: 'byReason', label: '사유별', value: row => Object.entries(row.byReason || {}).map(([k, n]) => `${k} ${n}`).join(' / ') }
];
// ISO 시각을 보는 사람 기준(로컬) HH:MM 으로 — ts.slice(11,16) 은 UTC 라 9시간 어긋난다
function localHm(ts) {
  const d = new Date(ts);
  if (!ts || isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
const STOCKLOG_COLUMNS = [
  { key: 'date', label: '날짜' },
  { key: 'ts', label: '시각', value: row => localHm(row.ts) },
  { key: 'reason', label: '구분', value: row => normalizeReason(row.reason) },
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: '제품' },
  { key: 'color', label: '컬러' },
  { key: 'size', label: '사이즈' },
  { key: 'delta', label: '변동' },
  { key: 'left', label: '남음' },
  { key: 'ref', label: '상대·메모' },
  { key: 'note', label: '메모' }
];

module.exports = {
  initFromCafe24,
  applyStocktake,
  lowStock,
  minQtyOf,
  ledgerSummary,
  toCsv,
  normalizeReason,
  logStockAt,
  dateOf,
  LEDGER_COLUMNS,
  STOCKLOG_COLUMNS,
  DEFAULT_MIN_QTY
};
