'use strict';
// 고객 이력(같은 사람이 낸 주문·시딩·교환반품 묶기) + 전역 검색 순수 로직.
// 화면(public/app-core.js)의 matchQ 와 같은 규칙을 서버에서도 쓴다 — 검색 결과가 화면·서버에서 달라지지 않게.

// 낱말 단위 검색: 띄어쓰기·기호를 무시하고, 물어본 낱말이 "아무 데나" 다 들어 있으면 맞음
function matchQ(text, q) {
  const norm = v => String(v || '').toLowerCase().replace(/[_#()\[\]\/·.,\-]+/g, ' ');
  const hay = norm(text); const squashed = hay.replace(/\s+/g, '');
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  return tokens.every(t => hay.includes(t) || squashed.includes(t.replace(/\s+/g, '')));
}

function normName(s) { return String(s || '').replace(/\s+/g, '').replace(/\(.*?\)/g, '').trim(); }
function phoneDigits(s) { return String(s || '').replace(/\D/g, ''); }

// 고객 키 = 전화 뒤 8자리(같은 사람이 010 표기를 다르게 적어도 묶임), 전화가 없으면 정규화한 이름
function customerKey(row) {
  const digits = phoneDigits(row && row.phone);
  if (digits.length >= 8) return digits.slice(-8);
  const name = normName(row && row.name);
  return name ? 'n:' + name : '';
}

function itemDate(x) { return String(x.sentDate || x.regDate || '').slice(0, 10); }

function pushUnique(list, value) {
  const text = String(value || '').trim();
  if (text && !list.includes(text)) list.push(text);
}

function ensureCustomer(map, key, row) {
  if (!map.has(key)) {
    map.set(key, {
      key, name: String(row.name || '').trim(),
      phones: [], addrs: [], orders: [], returns: [],
      firstAt: '', lastAt: '',
      counts: { orders: 0, seeding: 0, returns: 0, exchanges: 0 },
      note: ''
    });
  }
  const cust = map.get(key);
  if (!cust.name && row.name) cust.name = String(row.name).trim();
  pushUnique(cust.phones, row.phone);
  pushUnique(cust.addrs, row.addr);
  return cust;
}

function touchDates(cust, date) {
  if (!date) return;
  if (!cust.firstAt || date < cust.firstAt) cust.firstAt = date;
  if (!cust.lastAt || date > cust.lastAt) cust.lastAt = date;
}

// 같은 장부(db.rev)면 색인을 다시 만들지 않는다. rev 는 저장할 때마다 오르므로 낡은 색인이 남지 않는다.
// (rev 가 없는 db — 테스트·임시 객체 — 는 캐시하지 않는다)
let indexCache = { rev: null, map: null };

// db 전체를 훑어 고객별 카드를 만든다 (주문·시딩·교환반품 + 우리가 적은 메모)
function buildCustomerIndex(db) {
  const rev = db && Number.isFinite(Number(db.rev)) ? Number(db.rev) : null;
  if (rev != null && indexCache.map && indexCache.rev === rev) return indexCache.map;
  const map = new Map();
  const notes = (db && db.customerNotes) || {};
  for (const [list, type] of [[(db && db.orders) || [], 'order'], [(db && db.seeding) || [], 'seeding']]) {
    for (const x of list) {
      const key = customerKey(x);
      if (!key) continue;
      const cust = ensureCustomer(map, key, x);
      const date = itemDate(x);
      cust.orders.push({
        type, id: x.id, orderNo: x.orderNo || '', date,
        product: x.product || '', option: x.option || [x.color, x.size].filter(Boolean).join(' '),
        qty: Number(x.qty) || 1, status: x.status || '', invoice: x.invoice || '',
        sourceChannel: x.sourceChannel || (type === 'seeding' ? 'seeding' : 'direct')
      });
      if (type === 'seeding') cust.counts.seeding += 1; else cust.counts.orders += 1;
      touchDates(cust, date);
    }
  }
  for (const ret of (db && db.returns) || []) {
    const key = customerKey(ret);
    if (!key) continue;
    const cust = ensureCustomer(map, key, ret);
    const date = String(ret.regDate || '').slice(0, 10);
    cust.returns.push({
      id: ret.id, kind: ret.kind || '반품', date,
      product: ret.product || '', reason: ret.reason || '', flowState: ret.flowState || ''
    });
    if (ret.kind === '교환') cust.counts.exchanges += 1; else cust.counts.returns += 1;
    touchDates(cust, date);
  }
  for (const cust of map.values()) {
    cust.orders.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
    cust.returns.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
    const note = notes[cust.key];
    cust.note = note && note.note ? String(note.note) : '';
    cust.noteAt = note && note.at ? String(note.at) : '';
  }
  if (rev != null) indexCache = { rev, map };
  return map;
}

// 검색용 지푸라기: 이름·전화·주소·송장·주문번호를 한 줄로
function customerHaystack(cust) {
  return [
    cust.name, cust.key, ...cust.phones, ...cust.addrs,
    ...cust.orders.map(o => [o.orderNo, o.invoice, o.product, o.option].filter(Boolean).join(' ')),
    ...cust.returns.map(r => [r.product, r.reason].filter(Boolean).join(' '))
  ].filter(Boolean).join(' ');
}

function byLastAtDesc(a, b) { return String(b.lastAt || '').localeCompare(String(a.lastAt || '')); }

function searchCustomers(db, q, limit) {
  const max = Number(limit) > 0 ? Number(limit) : 50;
  const query = String(q || '').trim();
  const all = [...buildCustomerIndex(db).values()];
  const hits = query ? all.filter(cust => matchQ(customerHaystack(cust), query)) : all;
  return hits.sort(byLastAtDesc).slice(0, max).map(cust => ({
    key: cust.key,
    name: cust.name,
    phone: cust.phones[0] || '',
    lastAt: cust.lastAt,
    counts: cust.counts
  }));
}

function getCustomer(db, key) {
  const wanted = String(key || '').trim();
  if (!wanted) return null;
  return buildCustomerIndex(db).get(wanted) || null;
}

function setCustomerNote(db, key, note, at) {
  const wanted = String(key || '').trim();
  if (!wanted) return { error: '고객을 찾지 못했어요.' };
  if (!db.customerNotes || typeof db.customerNotes !== 'object') db.customerNotes = {};
  const text = String(note == null ? '' : note).trim().slice(0, 500);
  if (!text) delete db.customerNotes[wanted];
  else db.customerNotes[wanted] = { note: text, at: at || new Date().toISOString() };
  return { ok: true, note: text };
}

// 사이드바 전역 검색 — 고객 5, 발송 10, 교환반품 5
function globalSearch(db, q) {
  const query = String(q || '').trim();
  if (!query) return { customers: [], shipments: [], returns: [] };
  const customers = searchCustomers(db, query, 5);
  const shipments = [];
  for (const [list, type] of [[(db && db.orders) || [], 'order'], [(db && db.seeding) || [], 'seeding']]) {
    for (const x of list) {
      const hay = [x.name, x.phone, x.addr, x.orderNo, x.invoice, x.product, x.option].filter(Boolean).join(' ');
      if (!matchQ(hay, query)) continue;
      shipments.push({
        type, id: x.id, name: x.name || '', orderNo: x.orderNo || '',
        invoice: x.invoice || '', status: x.status || '', date: itemDate(x)
      });
    }
  }
  shipments.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
  const returns = ((db && db.returns) || []).filter(ret =>
    matchQ([ret.name, ret.phone, ret.product, ret.rmaNo, ret.originalOrderNo, ret.invoice].filter(Boolean).join(' '), query)
  ).map(ret => ({
    id: ret.id, kind: ret.kind || '반품', name: ret.name || '',
    product: ret.product || '', flowState: ret.flowState || '',
    date: String(ret.regDate || '').slice(0, 10)
  })).sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
  return { customers, shipments: shipments.slice(0, 10), returns: returns.slice(0, 5) };
}

module.exports = {
  matchQ,
  customerKey,
  buildCustomerIndex,
  searchCustomers,
  getCustomer,
  setCustomerNote,
  globalSearch
};
