'use strict';
// 월별 통계(판매·발송·상품·클레임) 순수 로직 — 화면은 이 결과만 그린다.
// 기준: 발송한 달(sentDate) 의 발송완료 건. 교환·반품은 접수한 달(regDate) 기준.

const { matchQ } = require('./customers');
const { CHANNEL_LABELS } = require('./channels');

const SHIP_STATUS = '발송완료';

function ymOf(value, fallback) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  const base = fallback instanceof Date && !isNaN(fallback) ? fallback : new Date();
  return base.getFullYear() + '-' + String(base.getMonth() + 1).padStart(2, '0');
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// 우체국 요금은 '3,500' · '3,500원' 처럼 문자로 들어오기도 한다 — 숫자·부호만 남기고 읽는다
function priceNum(value) {
  if (value == null || value === '') return null;
  const text = String(value).replace(/[^0-9.-]/g, '');
  return text ? num(text) : null;   // '원'만 있던 값은 '' → 모름
}
function epostPrice(item) {
  return priceNum(item && item.epost && item.epost.price);
}

function share(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function channelOf(type, item) {
  if (item.sourceChannel) return String(item.sourceChannel);
  return type === 'seeding' ? 'seeding' : 'direct';
}

// 택배 1건 단위 키 — 우체국 접수번호(같은 포장은 같은 번호) → 송장 → 항목 순으로 묶는다
function parcelKey(type, item) {
  const op = item.epost && item.epost.orderNo ? String(item.epost.orderNo).trim() : '';
  if (op) return 'epost|' + op;
  if (item.invoice) return 'inv|' + String(item.invoice).trim();
  return type + '|' + item.id;
}

function shippedItems(db, ym) {
  const out = [];
  for (const [list, type] of [[(db && db.orders) || [], 'order'], [(db && db.seeding) || [], 'seeding']]) {
    for (const item of list) {
      if (item.status !== SHIP_STATUS) continue;
      // 보낸 날짜가 없으면 어느 달 실적인지 알 수 없다 — 접수일로 대신 세지 않고 뺀다
      const date = String(item.sentDate || '').slice(0, 10);
      if (!date || !date.startsWith(ym)) continue;
      out.push({ type, item, date });
    }
  }
  return out;
}

function topRows(map, limit) {
  const total = [...map.values()].reduce((sum, row) => sum + row.units, 0);
  return [...map.values()]
    .sort((a, b) => b.units - a.units)
    .slice(0, limit)
    .map(row => Object.assign({}, row, { share: share(row.units, total) }));
}

function monthlyStats(db, ymValue, options = {}) {
  const ym = ymOf(ymValue, options.now);
  const rows = shippedItems(db, ym);

  // ── 판매 ──
  // 먼저 주문(orderNo) 단위로 모은다. 금액은 주문마다 한 번만:
  // 그 주문의 모든 품목에 품목가(price)가 있으면 품목합, 하나라도 없으면 결제금액(orderAmount)을 한 번.
  // (0원 사은품처럼 price 가 없는 품목이 섞이면 품목합 + 주문금액으로 이중 계산되던 것을 막는다)
  const orderMap = new Map();
  let units = 0;
  for (const { type, item } of rows) {
    const channel = channelOf(type, item);
    const key = channel + '|' + (item.orderNo ? 'no:' + item.orderNo : 'id:' + type + ':' + item.id);
    const qty = Number(item.qty) || 1;
    units += qty;
    if (!orderMap.has(key)) orderMap.set(key, { channel, units: 0, allPriced: true, priceSum: 0, orderAmount: null });
    const order = orderMap.get(key);
    order.units += qty;
    const price = num(item.price);
    if (price == null) order.allPriced = false;
    else order.priceSum += price * qty;
    if (order.orderAmount == null) order.orderAmount = num(item.orderAmount);
  }
  const byChannel = new Map();
  let amountKnown = false;
  let amount = 0;
  for (const order of orderMap.values()) {
    if (!byChannel.has(order.channel)) byChannel.set(order.channel, { orders: 0, units: 0, amount: 0, amountKnown: false });
    const ch = byChannel.get(order.channel);
    ch.orders += 1;
    ch.units += order.units;
    const value = order.allPriced ? order.priceSum : order.orderAmount;
    if (value == null) continue;
    amountKnown = true; ch.amountKnown = true;
    amount += value;
    ch.amount += value;
  }
  const sales = {
    orders: orderMap.size,
    units,
    amount: amountKnown ? Math.round(amount) : null,
    byChannel: {}
  };
  for (const [channel, value] of byChannel) {
    sales.byChannel[channel] = {
      orders: value.orders,
      units: value.units,
      amount: value.amountKnown ? Math.round(value.amount) : null
    };
  }

  // ── 발송(택배비) ──
  const parcels = new Map();
  for (const { type, item, date } of rows) {
    const key = parcelKey(type, item);
    if (parcels.has(key)) continue;
    parcels.set(key, { date, price: epostPrice(item) });
  }
  let epostCost = 0;
  let pricedParcels = 0;
  const byDayMap = new Map();
  for (const parcel of parcels.values()) {
    if (parcel.price != null) { epostCost += parcel.price; pricedParcels += 1; }
    byDayMap.set(parcel.date, (byDayMap.get(parcel.date) || 0) + 1);
  }
  const shipping = {
    parcels: parcels.size,
    epostCost: Math.round(epostCost),
    avgCost: pricedParcels ? Math.round(epostCost / pricedParcels) : 0,
    byDay: [...byDayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, n]) => ({ date, parcels: n }))
  };

  // ── 상품·사이즈 ──
  const productMap = new Map();
  const sizeMap = new Map();
  for (const { item } of rows) {
    const name = String(item.product || '').trim() || '(이름 없음)';
    const color = String(item.color || '').trim();
    const size = String(item.size || '').trim();
    const qty = Number(item.qty) || 1;
    const pKey = [name, color, size].join('|');
    if (!productMap.has(pKey)) productMap.set(pKey, { name, color, size, units: 0 });
    productMap.get(pKey).units += qty;
    const sKey = size || '미지정';
    if (!sizeMap.has(sKey)) sizeMap.set(sKey, { size: sKey, units: 0 });
    sizeMap.get(sKey).units += qty;
  }
  const products = topRows(productMap, 20);
  const sizes = topRows(sizeMap, 20);

  // ── 교환·반품 ──
  const claimRows = ((db && db.returns) || []).filter(ret => String(ret.regDate || '').slice(0, 7) === ym);
  const reasonMap = new Map();
  const claimProductMap = new Map();
  let exchanges = 0;
  let returnsN = 0;
  for (const ret of claimRows) {
    if (ret.kind === '교환') exchanges += 1; else returnsN += 1;
    const reason = String(ret.reason || '').trim().slice(0, 40) || '사유 없음';
    reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
    const name = String(ret.product || '').trim() || '(이름 없음)';
    claimProductMap.set(name, (claimProductMap.get(name) || 0) + 1);
  }
  const claims = {
    total: claimRows.length,
    exchanges,
    returns: returnsN,
    byReason: [...reasonMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, n]) => ({ reason, n })),
    byProduct: [...claimProductMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, n]) => ({ name, n }))
  };

  return { ym, sales, shipping, products, sizes, claims };
}

// 우체국 청구서 대조용 — 택배 1건당 한 줄 (날짜, 이름, 송장, 요금)
function shippingCostRows(db, ymValue, options = {}) {
  const ym = ymOf(ymValue, options.now);
  const seen = new Set();
  const rows = [];
  for (const { type, item, date } of shippedItems(db, ym)) {
    const key = parcelKey(type, item);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      date,
      name: item.name || '',
      invoice: item.invoice || '',
      price: epostPrice(item) == null ? '' : epostPrice(item)
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

const SHIPPING_COST_COLUMNS = [
  { key: 'date', label: '날짜' },
  { key: 'name', label: '이름' },
  { key: 'invoice', label: '송장' },
  { key: 'price', label: '요금' }
];

// ── 발송 내역 CSV (배송 확인 화면의 세그먼트·검색과 같은 기준) ──
function shipmentFilterFn(filter) {
  const f = String(filter || 'all');
  if (f === 'pending') return x => x.status === '대기' || x.status === '접수중';
  if (f === 'moving') return x => x.status === '발송완료' && !x.delivered;
  if (f === 'done') return x => x.status === '발송완료' && !!x.delivered;
  if (f === 'canceled') return x => x.status === '취소됨';
  return () => true;
}

function shipmentKind(type, item) {
  if (type === 'seeding') return '시딩';
  if (item.exchange || item.sourceChannel === 'exchange') return '교환 재발송';
  return '주문';
}

function shipmentCsvRows(db, options = {}) {
  const from = String(options.from || '').trim();
  const to = String(options.to || '').trim();
  const q = String(options.q || '').trim();
  const keep = shipmentFilterFn(options.filter);
  const rows = [];
  for (const [list, type] of [[(db && db.orders) || [], 'order'], [(db && db.seeding) || [], 'seeding']]) {
    for (const item of list) {
      const date = String(item.sentDate || item.regDate || '').slice(0, 10);
      if (from && date && date < from) continue;
      if (to && date && date > to) continue;
      if (!keep(item)) continue;
      if (q && !matchQ([item.name, item.phone, item.invoice, item.product, item.orderNo, item.addr].filter(Boolean).join(' '), q)) continue;
      rows.push({
        date,
        kind: shipmentKind(type, item),
        channel: CHANNEL_LABELS[channelOf(type, item)] || channelOf(type, item),
        orderNo: item.orderNo || '',
        name: item.name || '',
        phone: item.phone || '',
        zip: item.zip || '',
        addr: item.addr || '',
        product: item.product || '',
        color: item.color || '',
        size: item.size || '',
        qty: Number(item.qty) || 1,
        status: item.delivered ? '배달완료' : (item.status || ''),
        courier: item.courier || '',
        invoice: item.invoice || '',
        deliveredDate: item.deliveredDate || '',
        price: epostPrice(item) == null ? '' : epostPrice(item),
        memo: item.memo || ''
      });
    }
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return rows;
}

const SHIPMENT_COLUMNS = [
  { key: 'date', label: '보낸날' },
  { key: 'kind', label: '구분' },
  { key: 'channel', label: '채널' },
  { key: 'orderNo', label: '주문번호' },
  { key: 'name', label: '이름' },
  { key: 'phone', label: '전화' },
  { key: 'zip', label: '우편번호' },
  { key: 'addr', label: '주소' },
  { key: 'product', label: '상품' },
  { key: 'color', label: '컬러' },
  { key: 'size', label: '사이즈' },
  { key: 'qty', label: '수량' },
  { key: 'status', label: '상태' },
  { key: 'courier', label: '택배사' },
  { key: 'invoice', label: '송장' },
  { key: 'deliveredDate', label: '배달완료일' },
  { key: 'price', label: '택배비' },
  { key: 'memo', label: '메모' }
];

module.exports = {
  monthlyStats,
  shippingCostRows,
  shipmentCsvRows,
  SHIPPING_COST_COLUMNS,
  SHIPMENT_COLUMNS,
  ymOf
};
