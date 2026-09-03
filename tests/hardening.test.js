'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const XLSX = require('xlsx');
const {
  securityHeaders,
  isSecureRequest,
  readBodyLimited,
  spreadsheetFormat,
  spreadsheetReadOptions
} = require('../lib/security');

test('보호 응답은 기본 보안 헤더를 보내고 HTTPS에서 HSTS를 추가한다', () => {
  const plain = securityHeaders(false);
  assert.equal(plain['X-Content-Type-Options'], 'nosniff');
  assert.equal(plain['X-Frame-Options'], 'DENY');
  assert.match(plain['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(plain['Strict-Transport-Security'], undefined);

  const tls = securityHeaders(true);
  assert.match(tls['Strict-Transport-Security'], /max-age=/);
});

test('직접 TLS와 신뢰 프록시의 HTTPS 요청을 구분한다', () => {
  assert.equal(isSecureRequest({ socket: { encrypted: true }, headers: {} }), true);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'https' } }), false);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'https' } }, true), true);
  assert.equal(isSecureRequest({ socket: {}, headers: { 'x-forwarded-proto': 'http' } }), false);
});

test('요청 본문은 정한 크기를 넘으면 읽기를 중단한다', async () => {
  const req = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]);
  await assert.rejects(
    readBodyLimited(req, 10),
    error => error && error.code === 'PAYLOAD_TOO_LARGE'
  );

  const exact = Readable.from([Buffer.alloc(10)]);
  assert.equal((await readBodyLimited(exact, 10)).length, 10);

  const declared = Readable.from([]);
  declared.headers = { 'content-length': '11' };
  await assert.rejects(
    readBodyLimited(declared, 10),
    error => error && error.code === 'PAYLOAD_TOO_LARGE'
  );
});

test('진짜 XLSX XLS CSV만 스프레드시트 업로드로 받는다', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['이름', '전화'], ['홍길동', '010']]), 'Sheet1');
  const xlsx = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  const xls = XLSX.write(wb, { bookType: 'xls', type: 'buffer' });
  const biff5 = XLSX.write(wb, { bookType: 'biff5', type: 'buffer' });
  assert.equal(spreadsheetFormat(xlsx, 'orders.xlsx'), 'xlsx');
  assert.equal(spreadsheetFormat(xls, 'orders.xls'), 'xls');
  assert.equal(spreadsheetFormat(biff5, 'orders.xls'), 'xls');
  assert.equal(spreadsheetFormat(Buffer.from('name,phone\n홍길동,010', 'utf8'), 'orders.csv'), 'csv');
  const cp949 = Buffer.from([0xc8, 0xab, 0xb1, 0xdb, 0x2c, 0xc0, 0xfc, 0xc8, 0xad, 0x0d, 0x0a, 0xb1, 0xe8, 0xb5, 0xbf, 0x2c, 0x30, 0x31, 0x30]);
  assert.equal(spreadsheetFormat(cp949, 'orders.csv'), 'csv');
  const cp949Book = XLSX.read(cp949, spreadsheetReadOptions(cp949, 'csv'));
  const cp949Rows = XLSX.utils.sheet_to_json(cp949Book.Sheets[cp949Book.SheetNames[0]], { header: 1 });
  assert.deepEqual(cp949Rows[0], ['홍글', '전화']);
  assert.equal(cp949Rows[1][1], '010');
  assert.equal(spreadsheetFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'orders.xlsx'), '');
  assert.equal(spreadsheetFormat(Buffer.from('<html>가짜 파일</html>', 'utf8'), 'orders.xlsx'), '');
  assert.equal(spreadsheetFormat(Buffer.from([0, 1, 2, 3]), 'orders.csv'), '');
});
