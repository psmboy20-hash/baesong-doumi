'use strict';

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

function accessCodeRequiredForIp(ip) {
  const value = String(ip || '').replace(/^::ffff:/, '');
  return !['', '127.0.0.1', '::1'].includes(value);
}

module.exports = { clientJson, mergeClientDb, accessCodeRequiredForIp };
