'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const operations = require('../lib/operations');
const claims = require('../lib/claims');
const { createMutationQueue } = require('../lib/storage');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

function functions(names, globals) {
  const context = vm.createContext({ ...operations, ...claims, ...globals });
  for (const name of names) {
    const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?(?=^(?:async )?function |$(?![^]))', 'm'));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
  return context;
}
function route(pathname, next, globals) {
  const start = source.indexOf("    if (url.pathname === '" + pathname + "'");
  const end = source.indexOf("    if (url.pathname === '" + next + "'", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ ...operations, ...claims, Date, console,
    readBody: async req => Buffer.from(JSON.stringify(req.body)), sendJson: (res, code, body) => body,
    audit: () => {}, today: () => '2026-11-10', ...globals });
  vm.runInContext('async function run(body) { const req = {method:"POST", body}; const res = {}; const url = {pathname:' + JSON.stringify(pathname) + '};\n' + source.slice(start, end) + '\n}', context);
  return context.run;
}

test('문의 GET의 토큰 갱신은 시트 기록 중인 작업이 장부를 저장한 뒤 실행된다', async () => {
  const mutationQueue = createMutationQueue();
  let disk = { rev: 1, status: '대기', qty: 3 };
  const loadDb = () => structuredClone(disk);
  const saveDb = db => { assert.equal(db.rev, disk.rev, '장부 충돌'); db.rev++; disk = structuredClone(db); };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const writing = mutationQueue.run(async () => {
    const db = loadDb();
    await gate; // 외부 시트 기록 대기
    db.status = '발송완료'; db.qty--;
    saveDb(db);
  });
  const tokenStart = source.indexOf('async function cafe24TokenRequest(');
  const tokenEnd = source.indexOf('\nasync function cafe24ExchangeCode', tokenStart);
  const context = vm.createContext({ Buffer, URLSearchParams, Date, loadDb, saveDb,
    httpsJson: async () => ({ status: 200, json: { access_token: 'test-access', refresh_token: 'test-refresh' } }) });
  vm.runInContext(source.slice(tokenStart, tokenEnd), context);
  let inquiryFinished = false;
  const handle = async () => {
    await context.cafe24TokenRequest({ ...loadDb(), settings: {} }, {});
    inquiryFinished = true;
  };
  const start = source.indexOf('  const mutates = req.method');
  const end = source.indexOf('\n});', start);
  vm.runInNewContext(source.slice(start, end), { req: { method: 'GET' }, url: { pathname: '/api/cafe24/inquiries' }, mutationQueue, handle });
  await new Promise(resolve => setImmediate(resolve));
  const ranEarly = inquiryFinished;
  release();
  await writing;
  await mutationQueue.run(async () => {});
  assert.equal(ranEarly, false);
  assert.equal(disk.status, '발송완료');
  assert.equal(disk.qty, 2);
  assert.equal(disk.cafe24Token.access_token, 'test-access');
});

test('분리배송 B는 A의 송장을 가져오지 않고 품목을 확인한 경우에만 외부 송장을 가져온다', async () => {
  let shipments = [{ tracking_no: '6890000000001', items: [{ order_item_code: 'A' }] }];
  const server = functions(['cafe24ExistingShipment'], {
    cafe24Configured: () => true, cafe24EnsureToken: async () => 'test',
    cafe24Fetch: async () => ({ status: 200, json: { shipments } }) });
  const db = { cafe24Token: {} };
  assert.equal(await server.cafe24ExistingShipment(db, 'ORDER', ['B']), null);
  assert.equal((await server.cafe24ExistingShipment(db, 'ORDER', ['A'])).tracking, '6890000000001');
  for (const shape of [{ order_item_code: ['B'] }, { order_item_codes: ['B'] }, { items: [{ order_item_code: 'B' }] }]) {
    shipments = [{ tracking_no: '6890000000002', ...shape }];
    assert.equal((await server.cafe24ExistingShipment(db, 'ORDER', ['B'])).tracking, '6890000000002');
  }
  shipments = [{ tracking_no: '6890000000001', order_item_code: ['A'] }];
  await assert.rejects(server.cafe24ExistingShipment(db, 'ORDER', ['A', 'B']), /일부 상품/);
  shipments = [{ tracking_no: '6890000000001' }];
  assert.equal(await server.cafe24ExistingShipment(db, 'ORDER', ['B']), null);
});

test('수동 회수 → 전체 취소 → 다시 신청은 기존 회수 취소 확인 전 새 접수를 막는다', async () => {
  const ret = { id: 1, rmaNo: 'RMA-1', sourceChannel: 'direct', zip: '04524', flowState: 'requested', events: [] };
  const db = { returns: [ret], epost: {} };
  let bookings = 0;
  const globals = { loadDb: () => db, saveDb: () => {}, epostConfigured: () => true,
    epostInsertReturn: async () => { bookings++; return { regiNo: '6890000000002' }; } };
  const manual = route('/api/return/manual-pickup', '/api/return/cancel', globals);
  const cancel = route('/api/return/cancel', '/api/return/preflight', globals);
  const pickup = route('/api/return/pickup', '/api/return/manual-pickup', globals);
  assert.equal((await manual({ id: 1, invoice: '6890000000001' })).ok, true);
  assert.equal((await pickup({ id: 1 })).externalPickupConfirmationRequired, true);
  assert.equal((await cancel({ id: 1, scope: 'entry' })).ok, true);
  assert.equal((await cancel({ id: 1, scope: 'reopen' })).ok, true);
  assert.equal(ret.invoice, '6890000000001', '확인 전 수동 회수 송장을 잃지 않는다');
  for (const flag of [undefined, false, 'true']) {
    const blocked = await pickup({ id: 1, confirmExternalCanceled: flag });
    assert.match(blocked.error, /우체국.*취소/);
    assert.equal(blocked.externalPickupConfirmationRequired, true);
    assert.equal(bookings, 0);
  }
  assert.equal((await pickup({ id: 1, confirmExternalCanceled: true })).ok, true);
  assert.equal(bookings, 1);
  assert.equal(ret.manualPickup, undefined);
  assert.equal(ret.invoice, '6890000000002');
  assert.ok((await pickup({ id: 1 })).error);
  assert.equal(bookings, 1);
});

test('실제 우체국 접수 경로는 미발송 품목을 새로 접수하고 일부만 외부 발송된 포장은 멈춘다', async () => {
  for (const scenario of ['remainder', 'unknown', 'missing-code', 'covered', 'mixed', 'partial-missing-code', 'other-order']) {
    const order = { orderNo: '20261110-0000001', name: '고객', phone: '010-1111-2222', addr: '서울시 주소', zip: '04524', product: '코트', status: '대기' };
    const a = { ...order, id: 1, orderItemCode: 'A', status: '발송완료', invoice: '6890000000001', parcelSplitId: 'SPLIT-A' };
    const b = { ...order, id: 2, orderItemCode: 'B', product: '셔츠', parcelSplitId: 'SPLIT-B' };
    const db = { orders: [a, b], seeding: [], epost: {}, cafe24Token: {} };
    const selected = [{ type: 'order', id: 2 }];
    if (scenario === 'mixed' || scenario === 'partial-missing-code') {
      a.status = '대기'; delete a.invoice; delete a.parcelSplitId; delete b.parcelSplitId;
    }
    if (scenario === 'missing-code' || scenario === 'partial-missing-code') b.orderItemCode = '';
    if (scenario === 'other-order') {
      a.status = '대기'; delete a.invoice;
      a.orderNo = '20261110-0000002';
      a.packGroupId = b.packGroupId = 'PACK';
    }
    let bookings = 0;
    const shipments = [{ tracking_no: '6890000000001', ...(scenario === 'unknown' ? {} : { items: [{ order_item_code: scenario === 'covered' || scenario === 'other-order' ? 'B' : 'A' }] }) }];
    const server = functions(['normName', 'phoneDigits', 'cleanAddr', 'extractZip', 'buildParcelGroups', 'cafe24ExistingShipment', 'adoptExternalShipment'], {
      today: () => '2026-11-10', cafe24Configured: () => true, cafe24EnsureToken: async () => 'test',
      cafe24Fetch: async () => ({ status: 200, json: { shipments } }) });
    const run = route('/api/epost/register', '/api/resend-ok', { ...server, VIEW_ONLY: false,
      loadDb: () => db, saveDb: () => {}, epostConfigured: () => true,
      epostInsertOrder: async () => { bookings++; return { regiNo: '6890000000002' }; },
      postProcessShipped: async () => ({ stock: [], cafe24: [] }) });
    const result = await run({ selected });
    assert.equal(result.ok, true, scenario);
    if (scenario === 'mixed' || scenario === 'partial-missing-code' || scenario === 'other-order') {
      assert.equal(bookings, 0, scenario);
      assert.equal(result.results[0].safeStop, true);
      assert.equal(b.status, '대기');
      assert.equal(b.invoice, undefined);
    } else {
      assert.equal(bookings, scenario === 'covered' ? 0 : 1, scenario);
      assert.equal(b.invoice, scenario === 'covered' ? '6890000000001' : '6890000000002', scenario);
      assert.equal(b.status, '발송완료');
      assert.equal(a.invoice, '6890000000001');
    }
  }
});

test('회수 화면은 취소 확인을 거절하면 재접수하지 않고 명시적 확인일 때만 플래그를 보낸다', async () => {
  const page = fs.readFileSync(path.join(__dirname, '../public/pages/returns.js'), 'utf8');
  const start = page.indexOf('async function returnPickup(');
  const end = page.indexOf('\nasync function returnManualPickup', start);
  for (const confirmed of [false, true]) {
    const requests = [];
    let confirms = 0;
    const context = vm.createContext({ DB: { returns: [{ id: 1 }] },
      confirm: () => ++confirms === 1 || confirmed, busy: () => {}, render: () => {}, toast: () => {},
      adoptDb: () => {}, $: () => null,
      api: async (url, req) => {
        const body = JSON.parse(req.body); requests.push(body);
        return body.confirmExternalCanceled ? { ok: true, db: {} }
          : { error: '우체국에서 기존 회수를 취소해 주세요.', externalPickupConfirmationRequired: true };
      } });
    vm.runInContext(page.slice(start, end), context);
    await context.returnPickup(1, '고객');
    assert.equal(requests.length, confirmed ? 2 : 1);
    if (confirmed) assert.equal(requests[1].confirmExternalCanceled, true);
  }
});
