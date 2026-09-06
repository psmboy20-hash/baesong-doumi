'use strict';

function normalizePostalAddress(value) {
  return String(value || '')
    .replace(/\((\d{5})\)/g, '')
    .replace(/\(우\)?\s*\d{5}\)?/g, '')
    .replace(/우편번호[:\s]*\d{5}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function postalAddressCandidates(value) {
  const full = normalizePostalAddress(value);
  const out = [];
  const seen = new Set();
  const add = (query, fallback) => {
    const text = String(query || '').replace(/\s+/g, ' ').trim();
    if (text.length < 4 || seen.has(text)) return;
    seen.add(text);
    out.push({ query: text.slice(0, 80), fallback: !!fallback });
  };

  add(full, false);
  const base = full.split(',')[0].trim();
  add(base, true);
  const tokens = base.split(/\s+/).filter(Boolean);

  const roadStart = tokens.findIndex(token => /(?:대로|로|길)$/.test(token));
  if (roadStart >= 0) {
    let end = roadStart;
    while (end + 1 < tokens.length && /^\d+(?:번)?길$/.test(tokens[end + 1])) end++;
    if (end + 1 < tokens.length && /^\d+(?:-\d+)?$/.test(tokens[end + 1])) end++;
    if (end > roadStart) {
      add(tokens.slice(0, end + 1).join(' '), false);
      add(tokens.slice(roadStart, end + 1).join(' '), true);
    }
  }

  let lotStart = -1;
  let lotNumberIndex = -1;
  for (let i = tokens.length - 2; i >= 0; i--) {
    if (!/(?:읍|면|동|리|\d가)$/.test(tokens[i])) continue;
    let numberIndex = i + 1;
    if (tokens[numberIndex] === '산') numberIndex++;
    if (numberIndex < tokens.length && /^\d+(?:-\d+)?(?:번지)?$/.test(tokens[numberIndex])) {
      lotStart = i;
      lotNumberIndex = numberIndex;
      break;
    }
  }
  if (lotStart >= 0) {
    add(tokens.slice(0, lotNumberIndex + 1).join(' '), false);
    add(tokens.slice(lotStart, lotNumberIndex + 1).join(' '), true);
  }

  return out;
}

function postalZipFromDocuments(documents) {
  if (!Array.isArray(documents) || documents.length !== 1) return '';
  const row = documents[0] || {};
  const zip = (row.road_address && row.road_address.zone_no) || (row.address && row.address.zip_code) || '';
  return /^\d{5}$/.test(String(zip)) ? String(zip) : '';
}

function postalLookupDue(item, date, addressKey, version, force) {
  if (force) return true;
  return item._zipTried !== date || item._zipTriedAddr !== addressKey || item._zipLookupVersion !== version;
}

function zipForChangedAddress(previousZip, incomingZip) {
  const oldValue = String(previousZip || '').trim();
  const newValue = String(incomingZip || '').trim();
  return /^\d{5}$/.test(newValue) && newValue !== oldValue ? newValue : '';
}

// ── 제주·도서산간 판정 ────────────────────────────────────────────────────
// 근거: 우체국 소포 "도서·산간지역 배송" 안내와 택배사 공통 도서산간 우편번호표(5자리 새 우편번호 기준).
// 섬 하나가 우편번호 한 구간을 통째로 쓰는 곳만 넣었다 — 육지와 번호를 섞어 쓰는 면은 오탐이 나므로 뺐다.
// 추가요금 안내(주소 칸 경고)용이지 요금 계산용이 아니다. 새 구간이 필요하면 여기만 고친다.
const REMOTE_AREA_RANGES = [
  { from: 63000, to: 63644, kind: '제주', note: '제주도' },                 // 제주특별자치도 전역
  { from: 40200, to: 40240, kind: '도서산간', note: '울릉도·독도' },        // 경북 울릉군
  { from: 23004, to: 23010, kind: '도서산간', note: '백령도·대청도' },      // 인천 옹진군 백령면·대청면
  { from: 23100, to: 23116, kind: '도서산간', note: '연평도' },             // 인천 옹진군 연평면
  { from: 23120, to: 23126, kind: '도서산간', note: '덕적도' },             // 인천 옹진군 덕적면
  { from: 23130, to: 23136, kind: '도서산간', note: '자월도' },             // 인천 옹진군 자월면
  { from: 33411, to: 33413, kind: '도서산간', note: '삽시도·외연도' },      // 충남 보령시 오천면 도서
  { from: 54000, to: 54005, kind: '도서산간', note: '선유도·개야도' },      // 전북 군산시 옥도면
  { from: 58760, to: 58762, kind: '도서산간', note: '가거도' },             // 전남 신안군 흑산면 가거도리
  { from: 58800, to: 58808, kind: '도서산간', note: '흑산도' },             // 전남 신안군 흑산면
  { from: 58810, to: 58816, kind: '도서산간', note: '홍도' },               // 전남 신안군 흑산면 홍도리
  { from: 58818, to: 58826, kind: '도서산간', note: '조도' },               // 전남 진도군 조도면
  { from: 59106, to: 59166, kind: '도서산간', note: '노화도·보길도·소안도' }, // 전남 완도군 노화·보길·소안면
  { from: 53031, to: 53033, kind: '도서산간', note: '한산도' },             // 경남 통영시 한산면
  { from: 53037, to: 53040, kind: '도서산간', note: '사량도' },             // 경남 통영시 사량면
  { from: 53065, to: 53067, kind: '도서산간', note: '욕지도' }              // 경남 통영시 욕지면
];

function remoteArea(zip) {
  const digits = String(zip == null ? '' : zip).replace(/\D/g, '');
  if (digits.length !== 5) return null;
  const value = Number(digits);
  for (const range of REMOTE_AREA_RANGES) {
    if (value >= range.from && value <= range.to) return { kind: range.kind, note: range.note };
  }
  return null;
}

module.exports = {
  remoteArea,
  REMOTE_AREA_RANGES,
  normalizePostalAddress,
  postalAddressCandidates,
  postalZipFromDocuments,
  postalLookupDue,
  zipForChangedAddress
};
