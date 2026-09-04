'use strict';

const { TextDecoder } = require('util');

const SECRET_KEYS = new Set([
  'accessCode', 'cafe24Token', 'cafe24ClientSecret',
  'epostApiKey', 'epostSecKey', 'sheetWebhookToken',
  'sheetWebhookUrl', 'kakaoRestKey'
]);

const SECRET_SETTINGS = [
  'cafe24ClientSecret', 'epostApiKey', 'epostSecKey',
  'sheetWebhookToken', 'sheetWebhookUrl', 'kakaoRestKey'
];
const MASK = '••••••••';

function clientJson(value) {
  return JSON.stringify(value, (key, item) => {
    if (!SECRET_KEYS.has(key)) return item;
    return SECRET_SETTINGS.includes(key) && item ? MASK : undefined;
  });
}

function mergeClientDb(current, incoming) {
  const next = incoming && typeof incoming === 'object' ? incoming : {};
  next.settings = Object.assign({}, current.settings || {}, next.settings || {});
  for (const key of SECRET_SETTINGS) {
    if (!String(next.settings[key] || '').trim() || next.settings[key] === MASK) next.settings[key] = current.settings && current.settings[key] || '';
  }
  for (const key of ['accessCode', 'cafe24Token', 'epost']) {
    if (Object.prototype.hasOwnProperty.call(current, key)) next[key] = current[key];
    else delete next[key];
  }
  return next;
}

function accessCodeRequiredForIp(ip, force) {
  if (force) return true;
  const value = String(ip || '').replace(/^::ffff:/, '');
  return !['', '127.0.0.1', '::1'].includes(value);
}

function securityHeaders(secure) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  };
  if (secure) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function isSecureRequest(req, trustProxy = false) {
  if (req && req.socket && req.socket.encrypted) return true;
  if (!trustProxy) return false;
  const forwarded = String(req && req.headers && req.headers['x-forwarded-proto'] || '')
    .split(',')[0].trim().toLowerCase();
  return forwarded === 'https';
}

function readBodyLimited(req, maxBytes) {
  const limit = Math.max(1, Number(maxBytes) || 1);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const declared = Number(req && req.headers && req.headers['content-length'] || 0);
    if (declared > limit) {
      const error = new Error('요청 본문이 허용 크기를 넘었습니다.');
      error.code = 'PAYLOAD_TOO_LARGE';
      fail(error);
    }
    req.on('data', chunk => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > limit) {
        chunks.length = 0;
        const error = new Error('요청 본문이 허용 크기를 넘었습니다.');
        error.code = 'PAYLOAD_TOO_LARGE';
        fail(error);
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, total));
    });
    req.on('error', fail);
  });
}

function spreadsheetFormat(buf, fileName) {
  if (!Buffer.isBuffer(buf) || !buf.length) return '';
  const name = String(fileName || '').trim().toLowerCase();
  const ext = name.match(/\.(xlsx|xls|csv)$/);
  if (name && !ext) return '';
  const requested = ext ? ext[1] : '';
  const zip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  const xlsx = zip && buf.includes(Buffer.from('[Content_Types].xml')) && buf.includes(Buffer.from('xl/'));
  const xlsMagic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const xls = buf.length >= xlsMagic.length && xlsMagic.every((value, i) => buf[i] === value) &&
    (buf.includes(Buffer.from('Workbook', 'utf16le')) || buf.includes(Buffer.from('Book', 'utf16le')));
  if (xlsx) return requested && requested !== 'xlsx' ? '' : 'xlsx';
  if (xls) return requested && requested !== 'xls' ? '' : 'xls';
  if (requested !== 'csv' || buf.includes(0)) return '';
  const hasLine = buf.includes(0x0a) || buf.includes(0x0d);
  const hasDelimiter = buf.includes(0x2c) || buf.includes(0x3b) || buf.includes(0x09);
  if (!hasLine || !hasDelimiter) return '';
  let controls = 0;
  for (const value of buf) if (value < 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0d) controls++;
  return controls <= Math.max(1, Math.floor(buf.length * 0.01)) ? 'csv' : '';
}

function spreadsheetReadOptions(buf, format) {
  const options = { type: 'buffer' };
  if (format !== 'csv') return options;
  options.raw = true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { options.codepage = 949; }
  return options;
}

// 접속 코드 비교: 길이가 달라도 시간이 같도록 해시끼리 상수시간 비교
function codeMatches(given, expected) {
  const crypto = require('crypto');
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected || '')).digest();
  return !!String(expected || '') && crypto.timingSafeEqual(a, b);
}

module.exports = {
  codeMatches,
  clientJson,
  mergeClientDb,
  accessCodeRequiredForIp,
  securityHeaders,
  isSecureRequest,
  readBodyLimited,
  spreadsheetFormat,
  spreadsheetReadOptions
};
