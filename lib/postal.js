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

module.exports = {
  normalizePostalAddress,
  postalAddressCandidates,
  postalZipFromDocuments,
  postalLookupDue,
  zipForChangedAddress
};
