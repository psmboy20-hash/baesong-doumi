'use strict';

const XLSX = require('xlsx');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function buildWorkbookBuffer(sheetName, columns, rows) {
  const values = [columns].concat(rows || []);
  const sheet = XLSX.utils.aoa_to_sheet(values);
  sheet['!cols'] = columns.map(column => ({
    wch: String(column).includes('주소') ? 45 : String(column).includes('내용품') ? 30 : 14
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}

// 내려받기 응답 헤더 — 파일명이 한글이라 RFC 5987(filename*)로 보내고, 옛 브라우저용 ASCII 이름을 같이 붙인다.
function downloadHeaders(mime, asciiName, filename, length) {
  const safeName = String(filename || asciiName).replace(/[\r\n]/g, '');
  return {
    'Content-Type': mime,
    'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    'Content-Length': Number(length) || 0,
    'Cache-Control': 'no-store, max-age=0'
  };
}

function xlsxDownloadHeaders(filename, length) {
  return downloadHeaders(XLSX_MIME, 'epost.xlsx', filename, length);
}

module.exports = { buildWorkbookBuffer, xlsxDownloadHeaders, downloadHeaders };
