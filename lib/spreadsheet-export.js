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

function xlsxDownloadHeaders(filename, length) {
  const safeName = String(filename || 'epost.xlsx').replace(/[\r\n]/g, '');
  return {
    'Content-Type': XLSX_MIME,
    'Content-Disposition': `attachment; filename="epost.xlsx"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    'Content-Length': Number(length) || 0,
    'Cache-Control': 'no-store, max-age=0'
  };
}

module.exports = { buildWorkbookBuffer, xlsxDownloadHeaders };
