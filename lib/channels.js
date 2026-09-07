'use strict';
// 판매채널(29CM·무신사·GS샵) 주문 엑셀 열 매핑 + 채널 송장 등록 엑셀 만들기 순수 로직.
// 채널마다 열 이름이 다르고 예고 없이 바뀌므로: ① 저장된 매핑을 먼저 쓰고 ② 없으면 기본 사전으로 찾는다.
// (실제 채널 엑셀 샘플이 아직 없어 사전은 흔한 표기를 모아 둔 것 — 첫 파일에서 설정 화면으로 확정한다.)

const CHANNEL_LABELS = {
  cafe24: '카페24', '29cm': '29CM', musinsa: '무신사', gsshop: 'GS샵',
  other: '기타 채널', seeding: '시딩', direct: '직접', exchange: '교환 재발송'
};

// 필수 10개 항목 — 화면 매핑 UI도 이 순서·이름을 쓴다
const CHANNEL_FIELDS = [
  { key: 'orderNo', label: '주문번호' },
  { key: 'lineNo', label: '품목번호' },
  { key: 'name', label: '수령인' },
  { key: 'phone', label: '연락처' },
  { key: 'zip', label: '우편번호' },
  { key: 'addr', label: '주소' },
  { key: 'product', label: '상품명' },
  { key: 'option', label: '옵션' },
  { key: 'qty', label: '수량' },
  { key: 'msg', label: '배송메시지' }
];

// 채널별 열 이름 동의어 (앞에 있을수록 우선)
const CHANNEL_DICTIONARY = {
  '29cm': {
    orderNo: ['주문번호', '주문 번호'],
    lineNo: ['품목번호', '섹션번호'],
    name: ['수령인', '수취인', '받는분'],
    phone: ['수령인 연락처', '휴대폰', '연락처'],
    zip: ['우편번호'],
    addr: ['주소', '배송지'],
    product: ['상품명', '품목명'],
    option: ['옵션명', '옵션', '색상/사이즈'],
    qty: ['수량'],
    msg: ['배송메시지', '배송메모', '요청사항']
  },
  musinsa: {
    orderNo: ['주문번호'],
    lineNo: ['품목주문번호', '주문상세번호'],
    name: ['수취인', '수령인'],
    phone: ['휴대폰', '연락처'],
    zip: ['우편번호'],
    addr: ['주소'],
    product: ['상품명', '상품'],
    option: ['옵션정보', '옵션', '단품명'],
    qty: ['수량'],
    msg: ['배송메시지', '배송요청']
  },
  gsshop: {
    orderNo: ['발주번호', '주문번호'],
    lineNo: ['상세번호', '주문상세번호', '순번'],
    name: ['수취인', '수령인', '고객명'],
    phone: ['전화번호', '휴대폰', '연락처'],
    zip: ['우편번호'],
    addr: ['주소'],
    product: ['상품명', '상품'],
    option: ['단품명', '옵션', '규격'],
    qty: ['수량'],
    msg: ['배송요청', '배송메시지', '메모']
  }
};

// 이 항목들이 없으면 주문을 만들 수 없다 → 화면이 매핑 UI 를 띄운다
const REQUIRED_FIELDS = ['name', 'phone', 'addr'];

const DEFAULT_INVOICE_TEMPLATE = {
  headers: ['주문번호', '품목번호', '택배사', '송장번호'],
  orderNoCol: '주문번호',
  lineNoCol: '품목번호',
  courierCol: '택배사',
  invoiceCol: '송장번호',
  courierName: '우체국택배'
};

function isChannelWithDictionary(channel) {
  return Object.prototype.hasOwnProperty.call(CHANNEL_DICTIONARY, String(channel || '').toLowerCase());
}

function normHeader(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[\s_()\[\]·.\-\/]+/g, '');
}

// 헤더 행 찾기 — 앞 10행 중 사전에 걸리는 열이 가장 많은 행 (최소 3개)
function findChannelHeaderRow(rows, channel) {
  const dict = CHANNEL_DICTIONARY[String(channel || '').toLowerCase()];
  if (!dict || !Array.isArray(rows)) return -1;
  let best = -1;
  let bestScore = 0;
  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i++) {
    const header = Array.isArray(rows[i]) ? rows[i] : [];
    let score = 0;
    for (const field of CHANNEL_FIELDS) {
      if (findHeaderColumn(header, dict[field.key] || []) >= 0) score++;
    }
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore >= 3 ? best : -1;
}

// 정확히 같은 이름을 먼저 찾고, 없으면 "포함"으로 한 번 더 (예: '수령인 연락처' ↔ '연락처')
// used: 다른 필드가 이미 가져간 열 번호(같은 열이 두 필드에 배정되지 않게) · exactOnly: 정확 일치만
function findHeaderColumn(header, names, used, exactOnly) {
  const cells = (Array.isArray(header) ? header : []).map(normHeader);
  const taken = used instanceof Set ? used : new Set();
  for (const name of names) {
    const wanted = normHeader(name);
    if (!wanted) continue;
    const exact = cells.findIndex((cell, i) => cell === wanted && !taken.has(i));
    if (exact >= 0) return exact;
  }
  if (exactOnly) return -1;
  for (const name of names) {
    const wanted = normHeader(name);
    if (!wanted) continue;
    const partial = cells.findIndex((cell, i) => cell && cell.includes(wanted) && !taken.has(i));
    if (partial >= 0) return partial;
  }
  return -1;
}

// 저장된 매핑(headers: {필드: '실제 열 이름'}) 우선, 없으면 사전
// 한 열은 한 필드에만 배정한다: ① 모든 필드의 정확 일치를 먼저 끝내고 ② 남은 필드만 부분 일치로 채운다.
// (그래야 '수령인 연락처' 열이 연락처에 붙고, 수령인은 잘못 채워지는 대신 미매핑으로 남는다)
function resolveChannelHeaders(channel, header, savedMapping) {
  const dict = CHANNEL_DICTIONARY[String(channel || '').toLowerCase()] || {};
  const saved = (savedMapping && savedMapping.headers) || {};
  const columns = {};
  const headers = {};
  const unmapped = [];
  const used = new Set();
  const namesOf = field => {
    const savedName = String(saved[field.key] || '').trim();
    return (savedName ? [savedName] : []).concat(dict[field.key] || []);
  };
  for (const exactOnly of [true, false]) {
    for (const field of CHANNEL_FIELDS) {
      if (columns[field.key] >= 0) continue;
      const index = findHeaderColumn(header, namesOf(field), used, exactOnly);
      if (index < 0) continue;
      columns[field.key] = index;
      used.add(index);
    }
  }
  for (const field of CHANNEL_FIELDS) {
    const index = columns[field.key];
    if (!(index >= 0)) { unmapped.push(field.key); continue; }
    headers[field.key] = String((header || [])[index] == null ? '' : (header || [])[index]).trim();
  }
  const ok = REQUIRED_FIELDS.every(key => columns[key] >= 0);
  return { columns, headers, unmapped, ok, usedSaved: Object.keys(saved).length > 0 };
}

// 미매핑 필드 키 → 사람이 읽는 한국어 라벨 (업로드 응답·화면 배너가 같은 말을 쓰게)
function channelFieldLabels(keys) {
  const byKey = new Map(CHANNEL_FIELDS.map(field => [field.key, field.label]));
  return (keys || []).map(key => byKey.get(key) || String(key));
}

function cell(row, index) {
  if (index == null || index < 0) return '';
  const value = (row || [])[index];
  return String(value == null ? '' : value).trim();
}

// 엑셀 행 → 주문 항목 (server.js mergeOrders 가 그대로 받는 모양)
function mapChannelRows(rows, headerIndex, resolved) {
  const items = [];
  const columns = resolved.columns || {};
  for (let r = Number(headerIndex) + 1; r < (rows || []).length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const name = cell(row, columns.name);
    const phone = cell(row, columns.phone);
    if (!name || phone.replace(/\D/g, '').length < 9) continue;
    const qty = Math.round(Number(cell(row, columns.qty)));
    items.push({
      orderNo: cell(row, columns.orderNo),
      lineNo: cell(row, columns.lineNo),
      name,
      phone,
      zip: cell(row, columns.zip).replace(/[^0-9]/g, '').slice(0, 5),
      addr: cell(row, columns.addr),
      product: cell(row, columns.product),
      color: '', size: '',
      option: cell(row, columns.option),
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      msg: cell(row, columns.msg),
      courier: '', invoice: '', sentDate: ''
    });
  }
  return items;
}

// 채널 엑셀 한 장을 통째로 읽어 주문 항목까지 (server.js 라우트는 이 결과만 쓴다)
function parseChannelSheet(rows, channel, savedMapping) {
  const sampleHeaders = [];
  const headerIndex = findChannelHeaderRow(rows, channel);
  if (headerIndex < 0) {
    const first = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : [];
    for (const value of first) sampleHeaders.push(String(value == null ? '' : value).trim());
    return {
      error: '엑셀에서 주문 열(수령인·주소)을 찾지 못했어요. 설정에서 열 매핑을 정해 주세요.',
      headerIndex: -1, sampleHeaders, unmapped: CHANNEL_FIELDS.map(f => f.key), items: []
    };
  }
  const header = rows[headerIndex];
  for (const value of header) sampleHeaders.push(String(value == null ? '' : value).trim());
  const resolved = resolveChannelHeaders(channel, header, savedMapping);
  if (!resolved.ok) {
    return {
      error: '주문 엑셀에서 수령인·연락처·주소 열을 찾지 못했어요. 설정에서 열 매핑을 정해 주세요.',
      headerIndex, sampleHeaders, unmapped: resolved.unmapped, headers: resolved.headers, items: []
    };
  }
  return {
    headerIndex, sampleHeaders,
    unmapped: resolved.unmapped,
    headers: resolved.headers,
    items: mapChannelRows(rows, headerIndex, resolved)
  };
}

// 미리보기용 첫 3행 (설정 화면 매핑 UI)
function previewChannelSheet(rows, channel, savedMapping) {
  let headerIndex = findChannelHeaderRow(rows, channel);
  if (headerIndex < 0) headerIndex = 0;
  const header = (Array.isArray(rows) && Array.isArray(rows[headerIndex]) ? rows[headerIndex] : [])
    .map(value => String(value == null ? '' : value).trim());
  const sample = [];
  for (let r = headerIndex + 1; r < rows.length && sample.length < 3; r++) {
    const row = rows[r];
    if (!Array.isArray(row) || row.every(value => String(value == null ? '' : value).trim() === '')) continue;
    const obj = {};
    header.forEach((name, i) => { obj[name || ('열' + (i + 1))] = String(row[i] == null ? '' : row[i]).trim(); });
    sample.push(obj);
  }
  const resolved = resolveChannelHeaders(channel, header, savedMapping);
  return { headers: header, sample, suggested: resolved.headers, unmapped: resolved.unmapped };
}

// 우리 장부의 주문번호에서 채널 접두어를 뗀다 (채널에 다시 올릴 땐 원래 번호여야 함)
function channelOrderNo(orderNo, channel) {
  const prefix = String(channel || '').toUpperCase() + '-';
  const text = String(orderNo || '');
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

function normalizeInvoiceTemplate(template) {
  const src = template && typeof template === 'object' ? template : {};
  const headers = Array.isArray(src.headers) && src.headers.length
    ? src.headers.map(value => String(value == null ? '' : value).trim()).filter(Boolean)
    : DEFAULT_INVOICE_TEMPLATE.headers.slice();
  const pick = (value, fallback) => {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
  };
  return {
    headers,
    orderNoCol: pick(src.orderNoCol, DEFAULT_INVOICE_TEMPLATE.orderNoCol),
    lineNoCol: pick(src.lineNoCol, DEFAULT_INVOICE_TEMPLATE.lineNoCol),
    courierCol: pick(src.courierCol, DEFAULT_INVOICE_TEMPLATE.courierCol),
    invoiceCol: pick(src.invoiceCol, DEFAULT_INVOICE_TEMPLATE.invoiceCol),
    courierName: pick(src.courierName, DEFAULT_INVOICE_TEMPLATE.courierName)
  };
}

// 채널 송장 등록 엑셀의 행 만들기 — 템플릿 열 순서대로
function buildInvoiceRows(items, channel, template) {
  const t = normalizeInvoiceTemplate(template);
  const rows = (items || []).map(item => t.headers.map(column => {
    if (column === t.orderNoCol) return channelOrderNo(item.orderNo, channel);
    if (column === t.lineNoCol) return String(item.lineNo || item.orderItemCode || '');
    if (column === t.courierCol) return t.courierName;
    if (column === t.invoiceCol) return String(item.invoice || '');
    return '';
  }));
  return { columns: t.headers, rows, template: t };
}

// 매핑 저장 입력 다듬기 (모르는 필드는 버린다)
function normalizeMapping(body) {
  const headers = {};
  const given = (body && body.headers) || {};
  for (const field of CHANNEL_FIELDS) {
    const value = String(given[field.key] == null ? '' : given[field.key]).trim();
    if (value) headers[field.key] = value.slice(0, 60);
  }
  return {
    headers,
    invoiceTemplate: normalizeInvoiceTemplate(body && body.invoiceTemplate),
    savedAt: new Date().toISOString()
  };
}

module.exports = {
  CHANNEL_LABELS,
  isChannelWithDictionary,
  resolveChannelHeaders,
  channelFieldLabels,
  parseChannelSheet,
  previewChannelSheet,
  channelOrderNo,
  normalizeInvoiceTemplate,
  buildInvoiceRows,
  normalizeMapping
};
