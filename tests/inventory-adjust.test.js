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

test('실제 수량 조정은 화면의 원래 수량이 바뀌었으면 저장하지 않는다', async () => {
  const db = { inventory: [{ id: 1, qty: 7, name: '테스트', sku: 'TEST' }] };
  const result = await adjustRoute(db)({ id: 1, target: 12, orig: 10 });
  assert.match(result.error, /그 사이 재고가 7개로 바뀌었어요/);
  assert.equal(db.inventory[0].qty, 7);
  assert.equal(db.inventory[0].stockVerifiedAt, undefined);
  assert.equal(db.stockLog, undefined);
  assert.equal(db.rev, undefined);
});

test('실제 수량 조정은 절대 수량과 서버가 계산한 차이를 기록하고 0개 확인도 남긴다', async () => {
  const db = { inventory: [{ id: 1, qty: 7, name: '테스트', sku: 'TEST' }] };
  const run = adjustRoute(db);
  for (const [orig, target, delta, reason] of [[7, 12, 5, '재고 조정 (+)'], [12, 0, -12, '재고 조정 (−)']]) {
    const result = await run({ id: 1, target, orig, delta: 99, reason: '기타 입고' });
    assert.equal(result.ok, true);
    assert.equal(db.inventory[0].qty, target);
    assert.equal(db.stockLog.at(-1).delta, delta);
    assert.equal(db.stockLog.at(-1).reason, reason);
  }
  assert.equal((await run({ id: 1, target: 0, orig: 0 })).ok, true);
  assert.ok(db.inventory[0].stockVerifiedAt);
  assert.equal(db.stockLog.length, 2);
});

test('실제 수량 조정은 음수·소수·빈값과 원래 수량 누락을 거절한다', async () => {
  const db = { inventory: [{ id: 1, qty: 7, name: '테스트', sku: 'TEST' }] };
  const run = adjustRoute(db);
  for (const body of [{ target: -1, orig: 7 }, { target: 1.5, orig: 7 }, { target: '', orig: 7 }, { target: 2 }, { target: 2, orig: null }]) {
    assert.ok((await run({ id: 1, ...body })).error);
    assert.equal(db.inventory[0].qty, 7);
  }
});

test('재고 조정 화면은 절대 수량과 사용자가 본 수량을 보내고 입출고는 차이를 보낸다', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/pages/inventory.js'), 'utf8');
  const start = source.indexOf('async function invSetQty(');
  const end = source.indexOf('// ── 입출고 내역', start);
  const requests = [];
  const db = { inventory: [{ id: 1, qty: 7, name: '테스트' }] };
  const context = vm.createContext({ DB: db, window: {}, document: { getElementById: () => null },
    api: async (url, req) => { requests.push(JSON.parse(req.body)); return { ok: true, db }; },
    adoptDb: () => {}, renderInventory: () => {}, toast: () => {}, confirm: () => true });
  vm.runInContext(source.slice(start, end), context);
  await context.invSetQty(1, '12');
  assert.equal(requests[0].target, 12);
  assert.equal(requests[0].orig, 7);
  await context.invAdjustStock(1, 3, '기타 입고', '입고');
  assert.equal(requests[1].delta, 3);
  assert.equal(requests[1].target, undefined);
});
