'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clientJson, mergeClientDb, accessCodeRequiredForIp } = require('../lib/security');

test('브라우저 응답에는 연동 비밀값과 OAuth 토큰을 넣지 않는다', () => {
  const db = {
    accessCode: '1234', cafe24Token: { access_token: 'ACCESS', refresh_token: 'REFRESH' },
    settings: {
      cafe24ClientSecret: 'C24', epostApiKey: 'EPOST', epostSecKey: 'SEC',
      sheetWebhookToken: 'WEBHOOK', sheetWebhookUrl: 'SCRIPT', kakaoRestKey: 'KAKAO', senderName: '누솔베르'
    },
    orders: [{ name: '고객' }]
  };
  const text = clientJson(db);
  for (const secret of ['1234', 'ACCESS', 'REFRESH', 'C24', 'EPOST', 'SEC', 'WEBHOOK', 'SCRIPT', 'KAKAO']) {
    assert.equal(text.includes(secret), false);
  }
  const safe = JSON.parse(text);
  assert.equal(safe.settings.senderName, '누솔베르');
  assert.equal(safe.settings.kakaoRestKey, '••••••••');
  assert.equal(safe.cafe24Token, undefined);
});

test('화면 저장은 비워서 받은 비밀값과 서버 연결상태를 지우지 않는다', () => {
  const current = {
    accessCode: '1234', cafe24Token: { access_token: 'A' }, epost: { custNo: 'C' },
    settings: { cafe24ClientSecret: 'C24', epostApiKey: 'EPOST', kakaoRestKey: 'KAKAO', senderName: '전' }
  };
  const incoming = { settings: { cafe24ClientSecret: '', epostApiKey: '••••••••', kakaoRestKey: '', senderName: '후' } };
  const merged = mergeClientDb(current, incoming);
  assert.equal(merged.settings.senderName, '후');
  assert.equal(merged.settings.cafe24ClientSecret, 'C24');
  assert.equal(merged.settings.epostApiKey, 'EPOST');
  assert.equal(merged.settings.kakaoRestKey, 'KAKAO');
  assert.deepEqual(merged.cafe24Token, { access_token: 'A' });
  assert.deepEqual(merged.epost, { custNo: 'C' });
  assert.equal(merged.accessCode, '1234');
  const injected = mergeClientDb({ settings: {} }, {
    settings: {}, accessCode: 'ATTACK', cafe24Token: { access_token: 'ATTACK' }, epost: { custNo: 'ATTACK' }
  });
  assert.equal(injected.accessCode, undefined);
  assert.equal(injected.cafe24Token, undefined);
  assert.equal(injected.epost, undefined);
});

test('접속 코드가 있으면 localhost 외 모든 컴퓨터가 로그인한다', () => {
  assert.equal(accessCodeRequiredForIp('127.0.0.1'), false);
  assert.equal(accessCodeRequiredForIp('::1'), false);
  assert.equal(accessCodeRequiredForIp('192.168.0.20'), true);
  assert.equal(accessCodeRequiredForIp('100.94.125.77'), true);
  assert.equal(accessCodeRequiredForIp('140.238.54.44'), true);
  assert.equal(accessCodeRequiredForIp('127.0.0.1', true), true);
  assert.equal(accessCodeRequiredForIp('::1', true), true);
});
