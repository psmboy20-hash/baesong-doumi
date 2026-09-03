'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { buildWorkbookBuffer, xlsxDownloadHeaders } = require('../lib/spreadsheet-export');

test('우체국 엑셀은 브라우저가 바로 내려받을 수 있는 정상 XLSX로 만든다', () => {
  const columns = ['주문번호', '수취인명', '수취인 우편번호', '상품명'];
  const rows = [[
    'SEED-20260903-1', '홍길동', '01234', 'S#01_Clara Denim'
  ]];
  const buffer = buildWorkbookBuffer('우체국접수', columns, rows);
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true });
  const values = XLSX.utils.sheet_to_json(workbook.Sheets['우체국접수'], { header: 1, raw: true });

  assert.ok(Buffer.isBuffer(buffer));
  assert.deepEqual(values, [columns, rows[0]]);
  assert.equal(values[1][2], '01234');

  const headers = xlsxDownloadHeaders('우체국접수_20260903.xlsx', buffer.length);
  assert.equal(headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(headers['Content-Disposition'], /^attachment;/);
  assert.match(headers['Content-Disposition'], /filename\*=UTF-8''%EC%9A%B0%EC%B2%B4%EA%B5%AD/);
  assert.equal(headers['Content-Length'], buffer.length);
});
