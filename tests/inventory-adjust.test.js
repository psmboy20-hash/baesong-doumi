'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// 포트를 열지 않고 실제 라우트·장부 함수를 실행한다. 외부 동기화만 대체한다.
function adjustRoute(db) {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const reasons = source.slice(source.indexOf('const STOCK_MOVE_REASONS ='), source.indexOf('\nfunction shipmentStockReason'));
  const log = source.slice(source.indexOf('function logStock('), source.indexOf('\n// ---------- 채널 재고 자동 반영'));
  const start = source.indexOf("    if (url.pathname === '/api/inventory/adjust'");
  const route = source.slice(start, source.indexOf("    if (url.pathname === '/api/inventory/init-from-cafe24'", start));
  const context = vm.createContext({ Date, JSON, Number, String, Math,
    loadDb: () => db, saveDb: () => { db.rev = (db.rev || 0) + 1; },
    readBody: async req => Buffer.from(JSON.stringify(req.body)),
    sendJson: (res, code, body) => body, inventorySku: () => 'TEST', today: () => '2026-10-06',
    markChannelDirty: () => {}, audit: () => {} });
  vm.runInContext(reasons + '\n' + log + '\nasync function run(body) { const req = {method:"POST",body}; const res = {}; const url = {pathname:"/api/inventory/adjust"};\n' + route + '\n}', context);
  return context.run;
}

test('수동 입출고·재고 조정은 지정한 사유와 메모를 실제 장부에 남긴다', async () => {
  const db = { inventory: [{ id: 1, qty: 20, name: '테스트', sku: 'TEST' }] };
  const run = adjustRoute(db);
  for (const [delta, reason] of [[3, '기타 입고'], [-2, '기타 출고'], [10, '재고 조정 (+)'], [-10, '재고 조정 (−)']]) {
    const before = db.inventory[0].qty;
    const result = await run({ id: 1, delta, reason, memo: '검증 메모' });
    assert.equal(result.ok, true);
    assert.equal(db.inventory[0].qty, before + delta);
    assert.equal(db.stockLog.at(-1).reason, reason);
    assert.equal(db.stockLog.at(-1).note, '검증 메모');
    assert.equal(db.stockLog.at(-1).delta, delta);
  }
});
test('잘못된 수량은 변경 전에 거절하고 부족 출고는 실제 적용 수량만 기록한다', async () => {
  const db = { inventory: [{ id: 1, qty: 2, name: '테스트', sku: 'TEST' }] };
  const run = adjustRoute(db);
  for (const delta of [1.5, 'abc', Number.MAX_SAFE_INTEGER + 1]) {
    const result = await run({ id: 1, delta });
    assert.match(result.error, /정수/);
    assert.equal(db.inventory[0].qty, 2);
    assert.equal(db.stockLog, undefined);
  }
  const short = await run({ id: 1, delta: -3, reason: '기타 출고', memo: '확인' });
  assert.equal(short.ok, true);
  assert.equal(short.short, true);
  assert.equal(short.applied, -2);
  assert.equal(db.stockLog.at(-1).delta, -2);
  assert.equal(db.stockLog.at(-1).reason, '기타 출고');
});
