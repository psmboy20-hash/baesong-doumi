const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  channelStockPolicy,
  stockInitialized,
  reservedBySku,
  availableQty,
  availableList,
  planCafe24Push,
  channelDirtyCount,
  channelFailedCount,
  pushCafe24Stock
} = require('../lib/channel-stock');

const NOW = new Date('2026-09-07T09:00:00+09:00');

// 재고 3줄: 카페24 옵션 2줄 + 실사 필요 1줄
function baseDb() {
  return {
    settings: { channelStock: { enabled: true, cafe24: true, reserve: 0, autoAfterChange: true } },
    inventory: [
      { id: 1, name: 'Margot Denim Pants', color: '인디고', size: 'S', qty: 10, sku: 'C24V-11', productNo: 5, variantCode: '000A', cafe24StockTracked: true, cafe24Qty: 10 },
      { id: 2, name: 'Margot Denim Pants', color: '인디고', size: 'M', qty: 4, sku: 'C24V-12', productNo: 5, variantCode: '000B', cafe24StockTracked: true, cafe24Qty: 9 },
      { id: 3, name: 'Margot Denim Pants', color: '인디고', size: 'L', qty: 7, sku: 'C24V-13', productNo: 5, variantCode: '000C', cafe24StockTracked: true, cafe24Qty: 7, needsCount: true }
    ],
    orders: [],
    seeding: [],
    stockLog: [],
    channelSyncLog: []
  };
}

function order(extra) {
  return Object.assign({
    id: 100, orderNo: 'A1', name: '홍길동', status: '대기',
    product: 'Margot Denim Pants (인디고)', color: '인디고', size: 'M', qty: 1, variantCode: '000B'
  }, extra);
}

// ── 1. 예약(대기·접수중) 수량 ───────────────────────────────────────────────
test('예약: 대기·접수중만 세고 발송완료·취소는 빼며 보류 건도 잡아둔다', () => {
  const db = baseDb();
  db.orders = [
    order({ id: 101, status: '대기', qty: 1 }),
    order({ id: 102, status: '접수중', qty: 2 }),
    order({ id: 103, status: '대기', qty: 5, hold: true, holdReason: '재고 확인' }), // 보류도 아직 나갈 물량
    order({ id: 104, status: '발송완료', qty: 9 }),   // 이미 실물에서 빠짐
    order({ id: 105, status: '취소됨', qty: 7 })
  ];
  const reserved = reservedBySku(db);
  assert.equal(reserved.get('C24V-12'), 8); // 1 + 2 + 5
  assert.equal(reserved.get('C24V-11'), undefined);
});

test('예약: 시딩도 같이 세고, 재고 줄과 못 맞춘 항목은 빼놓는다', () => {
  const db = baseDb();
  db.orders = [order({ id: 101, status: '대기', qty: 1 })];
  db.seeding = [
    { id: 201, status: '대기', product: 'Margot Denim Pants', color: '인디고', size: 'S', qty: 3, variantCode: '000A' },
    { id: 202, status: '대기', product: '알 수 없는 상품', color: '', size: '', qty: 4 }
  ];
  const reserved = reservedBySku(db);
  assert.equal(reserved.get('C24V-11'), 3);
  assert.equal(reserved.get('C24V-12'), 1);
  assert.equal(reserved.size, 2);
});

test('예약: 옵션품번이 없어도 이름+컬러+사이즈로 재고 줄을 찾는다 (출고 차감과 같은 규칙)', () => {
  const db = baseDb();
  db.orders = [order({ id: 101, status: '대기', qty: 2, variantCode: '', sku: '' })];
  assert.equal(reservedBySku(db).get('C24V-12'), 2);
});

// ── 2. 가용 수량 ────────────────────────────────────────────────────────────
test('가용: 실물 − 예약 − 예비, 음수는 0으로 자른다', () => {
  const inv = { id: 1, qty: 10 };
  assert.equal(availableQty(inv, 3, { reserve: 0 }), 7);
  assert.equal(availableQty(inv, 3, { reserve: 2 }), 5);
  assert.equal(availableQty(inv, 12, { reserve: 2 }), 0);
  assert.equal(availableQty(inv, 0, {}), 10);
});

test('가용: 실사 필요·수량 미상·집계 줄은 null (반영 대상 아님)', () => {
  assert.equal(availableQty({ id: 1, qty: 5, needsCount: true }, 0, {}), null);
  assert.equal(availableQty({ id: 2, qty: null }, 0, {}), null);
  assert.equal(availableQty({ id: 3, qty: 5, retiredAggregate: true }, 0, {}), null);
  assert.equal(availableQty(null, 0, {}), null);
});

test('설정: 기본값과 예비 수량 0~99 자르기', () => {
  assert.deepEqual(channelStockPolicy({}), { enabled: false, cafe24: true, reserve: 0, autoAfterChange: true });
  assert.equal(channelStockPolicy({ settings: { channelStock: { reserve: 500 } } }).reserve, 99);
  assert.equal(channelStockPolicy({ settings: { channelStock: { reserve: -3 } } }).reserve, 0);
  assert.equal(channelStockPolicy({ settings: { channelStock: { reserve: '4' } } }).reserve, 4);
  assert.equal(channelStockPolicy({ settings: { channelStock: { enabled: true } } }).enabled, true);
});

// ── 3. 반영 계획 ────────────────────────────────────────────────────────────
test('계획: 수량이 같은 줄·미추적 줄·옵션품번 없는 줄은 건너뛴다', () => {
  const db = baseDb();
  db.inventory.push(
    { id: 4, name: '로컬상품', color: '', size: '', qty: 3, sku: 'LOCAL-X-NONE-NONE' },                                     // 옵션품번 없음
    { id: 5, name: '재고관리안함', color: '', size: '', qty: 3, sku: 'C24V-15', productNo: 6, variantCode: '000E', cafe24StockTracked: false },
    { id: 6, name: '없어진옵션', color: '', size: '', qty: 3, sku: 'C24V-16', productNo: 6, variantCode: '000F', cafe24StockTracked: true, cafe24VariantActive: false }
  );
  const plan = planCafe24Push(db, channelStockPolicy(db));
  assert.deepEqual(plan.rows.map(r => r.id), [2]); // 1은 같은 값(10=10), 3은 실사 필요
  assert.deepEqual(plan.skipped, { noVariant: 2, notTracked: 1, needsCount: 1, same: 1 });
  assert.deepEqual(plan.rows[0], {
    id: 2, sku: 'C24V-12', name: 'Margot Denim Pants', color: '인디고', size: 'M',
    physical: 4, reserved: 0, available: 4, cafe24Qty: 9, delta: -5
  });
});

test('계획: 예약·예비를 뺀 값으로 카페24와 비교한다', () => {
  const db = baseDb();
  db.orders = [order({ id: 101, status: '대기', qty: 3, variantCode: '000A', size: 'S' })];
  db.settings.channelStock.reserve = 2;
  const plan = planCafe24Push(db, channelStockPolicy(db));
  const row = plan.rows.find(r => r.id === 1);
  assert.equal(row.reserved, 3);
  assert.equal(row.available, 5); // 10 − 3 − 2
  assert.equal(row.delta, -5);
});

test('가용 목록: 채널 엑셀용으로 셀 수 있는 줄만 낸다', () => {
  const db = baseDb();
  const rows = availableList(db, channelStockPolicy(db));
  assert.deepEqual(rows.map(r => r.id), [1, 2]);
  assert.equal(rows[0].available, 10);
});

// ── 4. 초기화 가드 ──────────────────────────────────────────────────────────
test('초기화 가드: 실물 합계 0 + 실사 기록 없음이면 false', () => {
  assert.equal(stockInitialized({ inventory: [{ qty: 0 }, { qty: null }] }), false);
  assert.equal(stockInitialized({ inventory: [] }), false);
  assert.equal(stockInitialized({}), false);
});

test('초기화 가드: 실물이 있거나 실사 기록이 1건이라도 있으면 true', () => {
  assert.equal(stockInitialized({ inventory: [{ qty: 0 }, { qty: 2 }] }), true);
  assert.equal(stockInitialized({ inventory: [{ qty: 0 }], stocktakes: [{ at: NOW.toISOString() }] }), true);
});

// ── 5. 카페24 반영 (send 주입) ──────────────────────────────────────────────
const noWait = () => Promise.resolve();

test('반영 성공: 카페24 수량·반영 시각을 기록하고 반영 대기 표시를 지운다', async () => {
  const db = baseDb();
  db.inventory[1].channelDirty = true;
  db.inventory[1].channelSyncError = '지난번 실패';
  db.inventory[1].channelSyncFails = 2;
  const calls = [];
  const plan = planCafe24Push(db, channelStockPolicy(db));
  const result = await pushCafe24Stock(db, plan.rows, {
    trigger: 'manual', wait: noWait, now: NOW,
    send: (inv, qty) => { calls.push([inv.variantCode, qty]); return Promise.resolve({ status: 200, json: { inventory: {} }, text: '' }); }
  });
  assert.deepEqual(calls, [['000B', 4]]);
  assert.equal(result.pushed, 1);
  assert.deepEqual(result.failed, []);
  const inv = db.inventory[1];
  assert.equal(inv.cafe24Qty, 4);
  assert.equal(inv.cafe24PushedQty, 4);
  assert.equal(inv.cafe24PushedAt, NOW.toISOString());
  assert.equal(inv.channelDirty, undefined);
  assert.equal(inv.channelSyncError, undefined);
  assert.equal(inv.channelSyncFails, undefined);
  assert.deepEqual(db.channelSyncLog, [{
    ts: NOW.toISOString(), channel: 'cafe24', sku: 'C24V-12', name: 'Margot Denim Pants 인디고 M',
    from: 9, to: 4, ok: true, error: '', trigger: 'manual'
  }]);
  assert.equal(channelDirtyCount(db), 0);
});

test('반영 실패: 오류를 줄에 남기고 실패 횟수를 올리며 다음 줄은 계속 보낸다', async () => {
  const db = baseDb();
  db.inventory[0].qty = 6; // 1번 줄도 차이가 나게
  db.inventory[1].channelSyncFails = 1;
  const plan = planCafe24Push(db, channelStockPolicy(db));
  assert.deepEqual(plan.rows.map(r => r.id), [1, 2]);
  const result = await pushCafe24Stock(db, plan.rows, {
    trigger: 'auto', wait: noWait, now: NOW,
    send: inv => Promise.resolve(inv.id === 1
      ? { status: 422, json: { error: { message: '수량이 올바르지 않습니다.' } }, text: '' }
      : { status: 200, json: {}, text: '' })
  });
  assert.equal(result.pushed, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].sku, 'C24V-11');
  assert.match(result.failed[0].error, /수량이 올바르지 않습니다\. \(422\)/);
  assert.equal(db.inventory[0].channelSyncFails, 1);
  assert.match(db.inventory[0].channelSyncError, /수량이 올바르지 않습니다/);
  assert.equal(db.inventory[1].channelSyncFails, undefined);
  assert.equal(channelFailedCount(db), 1);
  assert.deepEqual(db.channelSyncLog.map(r => [r.sku, r.ok, r.trigger]), [['C24V-11', false, 'auto'], ['C24V-12', true, 'auto']]);
  assert.equal(db.channelStockScopeMissing, undefined);
});

test('반영 실패: send 가 예외를 던져도 다음 줄로 넘어간다', async () => {
  const db = baseDb();
  db.inventory[0].qty = 6;
  const plan = planCafe24Push(db, channelStockPolicy(db));
  const result = await pushCafe24Stock(db, plan.rows, {
    wait: noWait, now: NOW,
    send: inv => inv.id === 1 ? Promise.reject(new Error('연결이 끊겼어요')) : Promise.resolve({ status: 200, json: {} })
  });
  assert.equal(result.pushed, 1);
  assert.deepEqual(result.failed.map(f => f.error), ['연결이 끊겼어요']);
});

test('반영 권한부족: 403/insufficient_scope 면 표시를 남기고 그 뒤로는 보내지 않는다', async () => {
  const db = baseDb();
  db.inventory[0].qty = 6;
  const plan = planCafe24Push(db, channelStockPolicy(db));
  const calls = [];
  const result = await pushCafe24Stock(db, plan.rows, {
    wait: noWait, now: NOW,
    send: inv => {
      calls.push(inv.id);
      return Promise.resolve({ status: 403, json: { error: { code: 'insufficient_scope' } }, text: 'insufficient_scope' });
    }
  });
  assert.deepEqual(calls, [1]); // 첫 줄에서 멈춤
  assert.equal(result.scopeMissing, true);
  assert.equal(db.channelStockScopeMissing, true);
  assert.equal(result.pushed, 0);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /권한/);

  // 표시가 남아 있으면 다음 호출은 아예 시작하지 않는다 (재연결 전까지 중단)
  const again = await pushCafe24Stock(db, plan.rows, { wait: noWait, now: NOW, send: () => { throw new Error('불려서는 안 됨'); } });
  assert.deepEqual(again, { pushed: 0, failed: [], scopeMissing: true });
});

test('반영: 한 번에 최대 100건까지만 보낸다', async () => {
  const db = { inventory: [], settings: {} };
  const rows = [];
  for (let i = 1; i <= 130; i++) {
    db.inventory.push({ id: i, name: '상품' + i, qty: 1, sku: 'C24V-' + i, productNo: 1, variantCode: 'V' + i, cafe24StockTracked: true, cafe24Qty: 0 });
    rows.push({ id: i, sku: 'C24V-' + i, available: 1 });
  }
  let sent = 0;
  const result = await pushCafe24Stock(db, rows, { wait: noWait, now: NOW, send: () => { sent++; return Promise.resolve({ status: 200, json: {} }); } });
  assert.equal(sent, 100);
  assert.equal(result.pushed, 100);
});

// ── 6. 라우트 (격리 서버 · 카페24 토큰 없음) ────────────────────────────────
const PORT = 8886;
const BASE = 'http://127.0.0.1:' + PORT;

function fixtureDb(initialized) {
  const db = baseDb();
  db.rev = 1;
  db.nextId = 900;
  db.returns = [];
  db.inventoryHidden = [];
  db.settings = Object.assign({ channelStock: { enabled: false, cafe24: true, reserve: 0, autoAfterChange: true } });
  if (!initialized) for (const inv of db.inventory) inv.qty = 0;
  return db;
}

async function startServer(db) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ham-channel-stock-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      HAM_PORT: String(PORT), HAM_DATA_DIR: dir, HAM_ALLOW_LOCAL: '1', HAM_DISABLE_SYNC: '1', HAM_VIEW: ''
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const stop = () => new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(BASE + '/healthz');
      if (r.ok) return { dir, stop };
    } catch (e) { /* 아직 안 떴음 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await stop();
  throw new Error('격리 서버가 뜨지 않았어요.');
}

const post = (p, body) => fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
}).then(r => r.json());
const get = p => fetch(BASE + p).then(r => r.json());

test('라우트: 실물 재고를 안 채웠으면 자동 반영을 켤 수도, 수동으로 밀 수도 없다', async () => {
  const server = await startServer(fixtureDb(false));
  try {
    const status = await get('/api/status');
    assert.deepEqual(status.status.channelStock, { enabled: false, dirty: 0, failed: 0, lastPushAt: null, scopeMissing: false });

    const preview = await get('/api/channel-stock/preview');
    assert.equal(preview.ok, true);
    assert.equal(preview.initialized, false);
    assert.equal(preview.enabled, false);

    const push = await post('/api/channel-stock/push', { all: true, trigger: 'manual' });
    assert.match(push.error, /실물 재고를 먼저 채워/);
    assert.equal(push.ok, undefined);

    const on = await post('/api/channel-stock/settings', { enabled: true });
    assert.match(on.error, /실물 재고를 먼저 채운 뒤/);

    const off = await post('/api/channel-stock/settings', { enabled: false, reserve: 3 });
    assert.equal(off.ok, true);
    assert.equal(off.db.settings.channelStock.reserve, 3);

    const bad = await post('/api/channel-stock/settings', { reserve: 200 });
    assert.match(bad.error, /0~99/);
  } finally { await server.stop(); }
});

test('라우트: 카페24가 연결돼 있지 않으면 수동 반영이 안내로 멈춘다', async () => {
  const server = await startServer(fixtureDb(true));
  try {
    const preview = await get('/api/channel-stock/preview');
    assert.equal(preview.initialized, true);
    assert.equal(preview.connected, false);
    assert.deepEqual(preview.plan.rows.map(r => r.id), [2]);
    assert.equal(preview.plan.rows[0].available, 4);
    assert.equal(preview.failCount, 0);

    const push = await post('/api/channel-stock/push', { all: true, trigger: 'manual' });
    assert.match(push.error, /카페24가 아직 연결되지 않았어요/);

    const on = await post('/api/channel-stock/settings', { enabled: true, reserve: 1, autoAfterChange: true });
    assert.equal(on.ok, true);
    assert.equal(on.db.settings.channelStock.enabled, true);

    // 예비 1개를 빼면 가용이 하나 줄어든다
    const after = await get('/api/channel-stock/preview');
    assert.equal(after.enabled, true);
    assert.equal(after.plan.rows.find(r => r.id === 2).available, 3);

    const log = await get('/api/channel-stock/log?limit=5');
    assert.deepEqual(log, { ok: true, log: [] });
  } finally { await server.stop(); }
});

test('라우트: 재고를 조정하면 반영 대기 표시가 남고 상태에 개수가 뜬다', async () => {
  const server = await startServer(fixtureDb(true));
  try {
    const r = await post('/api/inventory/adjust', { id: 1, delta: -2, reason: '샘플 출고' });
    assert.equal(r.ok, true);
    assert.equal(r.db.inventory.find(i => i.id === 1).channelDirty, true);
    const status = await get('/api/status');
    assert.equal(status.status.channelStock.dirty, 1);
  } finally { await server.stop(); }
});

test('라우트: 채널 재고 엑셀은 알 수 없는 채널을 거절한다', async () => {
  const server = await startServer(fixtureDb(true));
  try {
    const bad = await fetch(BASE + '/api/export/channel-stock.xlsx?channel=cafe24').then(r => r.json());
    assert.match(bad.error, /판매채널이 아니에요/);
    const ok = await fetch(BASE + '/api/export/channel-stock.xlsx?channel=29cm');
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /spreadsheetml/);
    assert.ok((await ok.arrayBuffer()).byteLength > 0);
  } finally { await server.stop(); }
});
