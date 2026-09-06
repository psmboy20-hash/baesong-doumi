const test = require('node:test');
const assert = require('node:assert/strict');
const {
  initFromCafe24,
  applyStocktake,
  lowStock,
  minQtyOf,
  ledgerSummary,
  toCsv,
  normalizeReason,
  LEDGER_COLUMNS,
  STOCKLOG_COLUMNS
} = require('../lib/stock-ledger');
const { ensureOperationalFields } = require('../lib/operations');

const NOW = new Date('2026-09-06T10:20:30+09:00');
const DATE = (() => { // 서버 today() 와 같은 방식(로컬 날짜)이라 테스트도 같은 계산으로 기대값을 만든다
  const p = n => String(n).padStart(2, '0');
  return `${NOW.getFullYear()}-${p(NOW.getMonth() + 1)}-${p(NOW.getDate())}`;
})();

function baseDb() {
  return {
    inventory: [
      { id: 1, name: '코트', color: '블랙', size: 'S', qty: 0, sku: 'C24V-1', cafe24Qty: 5 },
      { id: 2, name: '코트', color: '블랙', size: 'M', qty: 3, sku: 'C24V-2', cafe24Qty: 9 },
      { id: 3, name: '코트', color: '블랙', size: 'L', qty: 4, needsCount: true, sku: 'C24V-3', cafe24Qty: 7, stockIssue: '수량 확인 필요' },
      { id: 4, name: '옛코트', color: '', size: '', qty: 0, sku: 'C24-9', cafe24Qty: 12, retiredAggregate: true },
      { id: 5, name: '단종셔츠', color: '화이트', size: 'S', qty: 0, sku: 'C24V-5', cafe24Qty: 2, cafe24VariantActive: false },
      { id: 6, name: '스냅없음', color: '', size: '', qty: 0, sku: 'LOCAL-X-NONE-NONE', cafe24Qty: null },
      { id: 7, name: '재고관리안함', color: '', size: '', qty: 0, sku: 'C24V-7', cafe24Qty: 4, cafe24StockTracked: false }
    ],
    stockLog: []
  };
}

// ── 1. 기초재고 가져오기 ────────────────────────────────────────────────────
test('기초재고: 실물 0 또는 확인필요인 줄만 카페24 수량으로 채우고 나머지는 건너뛴다', () => {
  const db = baseDb();
  const r = initFromCafe24(db, { now: NOW });
  assert.equal(r.applied, 2); // id 1(0개) · id 3(확인 필요)
  assert.deepEqual(r.rows, [{ id: 1, sku: 'C24V-1', qty: 5 }, { id: 3, sku: 'C24V-3', qty: 7 }]);
  assert.equal(r.skipped, 1); // id 2 는 이미 실물 3개
  assert.equal(db.inventory[0].qty, 5);
  assert.equal(db.inventory[1].qty, 3, '이미 수량이 있는 줄은 그대로');
  assert.equal(db.inventory[2].qty, 7);
  assert.equal(db.inventory[2].needsCount, false);
  assert.equal('stockIssue' in db.inventory[2], false);
  assert.equal(db.inventory[3].qty, 0, '은퇴 줄은 대상 아님');
  assert.equal(db.inventory[4].qty, 0, '카페24에서 내린 옵션은 대상 아님');
  assert.equal(db.inventory[5].qty, 0, '카페24 수량 스냅샷이 없으면 대상 아님');
  assert.equal(db.inventory[6].qty, 0, '카페24가 재고관리를 안 하는 옵션은 수량이 뜻이 없어 대상 아님');
  assert.equal(db.stockLog.length, 2);
  assert.deepEqual(
    db.stockLog.map(e => [e.sku, e.delta, e.left, e.reason, e.ref, e.date]),
    [['C24V-1', 5, 5, '기초 재고', '카페24 수량 기준', DATE], ['C24V-3', 3, 7, '기초 재고', '카페24 수량 기준', DATE]]
  );
});

test('기초재고: ids 를 주면 그 줄만 보고, 대상이 아니면 skipped 로 센다', () => {
  const db = baseDb();
  const r = initFromCafe24(db, { ids: [1, 4], now: NOW });
  assert.equal(r.applied, 1);
  assert.equal(r.skipped, 1); // id 4 는 은퇴 줄
  assert.equal(db.inventory[0].qty, 5);
  assert.equal(db.inventory[2].qty, 4, 'ids 밖의 줄은 손대지 않는다');
  assert.equal(db.stockLog.length, 1);
});

// ── 2. 재고 실사 ────────────────────────────────────────────────────────────
test('실사: ± 차이는 재고 조정으로 기록하고 차이 0은 조정 없이 확인만 남긴다', () => {
  const db = baseDb();
  const r = applyStocktake(db, [
    { id: 2, counted: 5 },   // +2
    { id: 3, counted: 1 },   // -3
    { id: 1, counted: 0 }    // 변동 없음
  ], { memo: '월말 실사', now: NOW });
  assert.equal(r.unchanged, 1);
  assert.equal(r.adjusted.length, 2);
  assert.deepEqual(r.adjusted[0], { id: 2, sku: 'C24V-2', name: '코트', color: '블랙', size: 'M', before: 3, after: 5, diff: 2 });
  assert.deepEqual(r.adjusted[1], { id: 3, sku: 'C24V-3', name: '코트', color: '블랙', size: 'L', before: 4, after: 1, diff: -3 });
  assert.deepEqual(db.stockLog.map(e => [e.reason, e.delta, e.left, e.ref, e.note]), [
    ['재고 조정 (+)', 2, 5, `실사 ${DATE}`, '월말 실사'],
    ['재고 조정 (−)', -3, 1, `실사 ${DATE}`, '월말 실사']
  ]);
  assert.equal(db.inventory[0].qty, 0);
  assert.equal(db.inventory[0].needsCount, false);
  assert.equal(db.inventory[0].lastCountedAt, NOW.toISOString(), '차이가 없어도 실사 시각은 남는다');
  assert.equal(db.stocktakes.length, 1);
  assert.deepEqual(
    { at: db.stocktakes[0].at, memo: db.stocktakes[0].memo, adjusted: db.stocktakes[0].adjusted, unchanged: db.stocktakes[0].unchanged },
    { at: NOW.toISOString(), memo: '월말 실사', adjusted: 2, unchanged: 1 }
  );
});

test('실사: 없는 id·음수·소수는 건너뛰고 errors 로 알려준다', () => {
  const db = baseDb();
  const r = applyStocktake(db, [
    { id: 999, counted: 3 },
    { id: 1, counted: -1 },
    { id: 2, counted: 1.5 },
    { id: 3, counted: 4 }
  ], { now: NOW });
  assert.equal(r.errors.length, 3);
  assert.deepEqual(r.errors.map(e => e.id), [999, 1, 2]);
  assert.equal(r.adjusted.length, 0);
  assert.equal(r.unchanged, 1, 'id 3 은 4개 그대로');
  assert.equal(db.inventory[0].qty, 0, '잘못된 값은 반영되지 않는다');
  assert.equal(db.inventory[1].qty, 3);
  assert.equal(db.stockLog.length, 0);
  assert.equal(db.stocktakes[0].rows.length, 0);
});

test('실사: 메모가 없으면 ref 는 날짜만 쓴다', () => {
  const db = baseDb();
  applyStocktake(db, [{ id: 2, counted: 4 }], { now: NOW });
  assert.equal(db.stockLog[0].ref, `실사 ${DATE}`);
  assert.equal('note' in db.stockLog[0], false, '메모가 없으면 note 자체를 넣지 않는다');
});

test('실사: 세는 사이에 재고가 바뀐 줄은 덮어쓰지 않고 다시 세라고 알려준다', () => {
  const db = baseDb();
  const r = applyStocktake(db, [
    { id: 2, counted: 5, orig: 9 },  // 화면은 9개로 알고 있었는데 지금은 3개 → 그 사이 출고됨
    { id: 3, counted: 6, orig: 4 }   // 화면 값과 지금 재고가 같으니 정상 반영
  ], { now: NOW });
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.errors[0], { id: 2, error: '그 사이 재고가 3개로 바뀌었어요. 다시 세 주세요.' });
  assert.equal(db.inventory[1].qty, 3, '낡은 실사 값으로 덮어쓰지 않는다');
  assert.equal(db.inventory[1].needsCount, undefined, '건너뛴 줄은 확인한 것으로도 남기지 않는다');
  assert.deepEqual(r.adjusted.map(a => [a.id, a.before, a.after]), [[3, 4, 6]]);
  assert.equal(db.stockLog.length, 1);
});

test('실사: orig 를 보내지 않으면 지금 재고를 기준으로 그대로 반영한다', () => {
  const db = baseDb();
  const r = applyStocktake(db, [{ id: 2, counted: 5 }, { id: 3, counted: 4, orig: 4 }], { now: NOW });
  assert.equal(r.errors.length, 0);
  assert.equal(r.adjusted.length, 1);
  assert.equal(r.unchanged, 1);
  assert.equal(db.inventory[1].qty, 5);
});

test('기초재고·실사 ref 는 개인정보 정리에서 지워지지 않는다', () => {
  const db = baseDb();
  db.returns = [];
  db.orders = [];
  db.seeding = [];
  initFromCafe24(db, { now: NOW });
  applyStocktake(db, [{ id: 2, counted: 9 }], { memo: '창고 정리', now: NOW });
  db.stockLog.push({ ts: NOW.toISOString(), date: DATE, sku: 'C24V-2', name: '코트', delta: -1, left: 8, reason: '주문 출고', ref: '홍길동' });
  ensureOperationalFields(db);
  const refs = db.stockLog.map(e => e.ref);
  assert.equal(refs.filter(x => x === '카페24 수량 기준').length, 2);
  assert.equal(refs.includes(`실사 ${DATE}`), true);
  assert.equal(db.stockLog.find(e => e.reason === '재고 조정 (+)').note, '창고 정리', '사람이 적은 메모는 note 에 남는다');
  assert.equal(refs.includes('홍길동'), false, '고객 이름은 여전히 지운다');
});

// ── 3. 안전재고 ─────────────────────────────────────────────────────────────
test('안전재고: minQty > 카페24 안전재고 > 기본 2 순서로 본다', () => {
  assert.equal(minQtyOf({ qty: 1, minQty: 0 }), 0);
  assert.equal(minQtyOf({ qty: 1, minQty: 5, cafe24SafetyInventory: 3 }), 5);
  assert.equal(minQtyOf({ qty: 1, cafe24SafetyInventory: 3 }), 3);
  assert.equal(minQtyOf({ qty: 1, cafe24SafetyInventory: 0 }), 2);
  assert.equal(minQtyOf({ qty: 1 }), 2);
  assert.equal(lowStock({ qty: 2 }), true);
  assert.equal(lowStock({ qty: 3 }), false);
  assert.equal(lowStock({ qty: 0, minQty: 0 }), true);
  assert.equal(lowStock({ qty: 1, minQty: 0 }), false);
});

// ── 5. 수불 집계 ────────────────────────────────────────────────────────────
const LEDGER_LOG = [
  { date: '2026-08-20', sku: 'C24V-1', name: '코트', color: '블랙', size: 'S', delta: 10, left: 10, reason: '본사 입고' },
  { date: '2026-09-02', sku: 'C24V-1', name: '코트', color: '블랙', size: 'S', delta: -3, left: 7, reason: '출고' },
  { date: '2026-09-05', sku: 'C24V-1', name: '코트', color: '블랙', size: 'S', delta: 2, left: 9, reason: '반품 입고' },
  { date: '2026-10-01', sku: 'C24V-1', name: '코트', color: '블랙', size: 'S', delta: -4, left: 5, reason: '주문 출고' },
  { date: '2026-09-10', sku: 'C24V-2', name: '코트', color: '블랙', size: 'M', delta: -1, left: 3, reason: '시딩 출고' }
];

test('수불부: 기말은 현재 재고에서 다음 달 변동을 되감고, 기초는 당월 변동을 되감아 계산한다', () => {
  const inventory = [
    { id: 1, sku: 'C24V-1', name: '코트', color: '블랙', size: 'S', qty: 5 },
    { id: 2, sku: 'C24V-2', name: '코트', color: '블랙', size: 'M', qty: 3 },
    { id: 3, sku: 'C24V-9', name: '움직임없는코트', color: '블랙', size: 'XL', qty: 0 }
  ];
  const r = ledgerSummary(LEDGER_LOG, inventory, '2026-09');
  assert.equal(r.ym, '2026-09');
  assert.equal(r.rows.length, 2, '움직임도 없고 재고도 0인 줄은 빠진다');
  const s = r.rows.find(x => x.sku === 'C24V-1');
  assert.deepEqual(
    { start: s.start, inN: s.inN, outN: s.outN, end: s.end },
    { start: 10, inN: 2, outN: 3, end: 9 } // 기말 9 = 지금 5 − 10월 출고 −4, 기초 10 = 9 − (2−3)
  );
  assert.deepEqual(s.byReason, { '주문 출고': 3, '반품 입고': 2 }, "legacy '출고'는 '주문 출고'로 정규화");
  const m = r.rows.find(x => x.sku === 'C24V-2');
  assert.deepEqual({ start: m.start, inN: m.inN, outN: m.outN, end: m.end }, { start: 4, inN: 0, outN: 1, end: 3 });
  assert.deepEqual(r.totals, { start: 14, inN: 2, outN: 4, end: 12 });
});

test('수불부: 지난 달은 그 달 안의 변동만 세고, 장부에서 사라진 줄도 마지막 남음으로 잡는다', () => {
  const r = ledgerSummary(LEDGER_LOG, [], '2026-08');
  assert.equal(r.rows.length, 2);
  const s = r.rows.find(x => x.sku === 'C24V-1');
  assert.deepEqual(
    { start: s.start, inN: s.inN, outN: s.outN, end: s.end },
    { start: 0, inN: 10, outN: 0, end: 10 } // 재고 줄이 없으면 가장 최근 기록의 남음(5)에서 9·10월 변동을 되감음
  );
  const m = r.rows.find(x => x.sku === 'C24V-2');
  assert.deepEqual(
    { start: m.start, inN: m.inN, outN: m.outN, end: m.end },
    { start: 4, inN: 0, outN: 0, end: 4 } // 8월엔 움직임이 없어도 재고가 있으면 기초=기말로 한 줄
  );
  assert.deepEqual(s.byReason, { '본사 입고': 10 });
  assert.equal(normalizeReason('출고'), '주문 출고');
  assert.equal(normalizeReason('본사 입고'), '본사 입고');
  assert.equal(normalizeReason(''), '기타');
});

// ── 6. CSV ──────────────────────────────────────────────────────────────────
test('CSV: 엑셀용 BOM 을 붙이고 따옴표·쉼표·줄바꿈을 감싼다', () => {
  const csv = toCsv(
    [{ name: '코트, 롱', memo: '그가 "좋다"고 함', note: '두\n줄', empty: null }],
    [{ key: 'name', label: '제품' }, { key: 'memo', label: '메모' }, { key: 'note', label: '비고' }, { key: 'empty', label: '빈칸' }]
  );
  assert.equal(csv.charCodeAt(0), 0xFEFF, 'UTF-8 BOM');
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], '제품,메모,비고,빈칸');
  assert.equal(lines[1], '"코트, 롱","그가 ""좋다""고 함","두\n줄",');
  assert.equal(lines[2], '', '마지막 줄바꿈');
});

test('CSV: 수불부 열은 사유별 합계를 한 칸에 모으고 문자열 열 이름도 받는다', () => {
  const rows = ledgerSummary(LEDGER_LOG, [{ id: 1, sku: 'C24V-1', name: '코트', color: '블랙', size: 'S', qty: 5 }], '2026-09').rows;
  const csv = toCsv(rows, LEDGER_COLUMNS);
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines[0], 'SKU,제품,컬러,사이즈,기초,입고,출고,기말,사유별');
  assert.equal(lines[1], 'C24V-1,코트,블랙,S,10,2,3,9,주문 출고 3 / 반품 입고 2');
  assert.equal(toCsv([{ a: 1, b: 2 }], ['a', 'b']).slice(1), 'a,b\r\n1,2\r\n');
});

test('CSV: 입출고 내역 시각은 보는 사람 기준(로컬) 시:분이고 메모 열이 따로 있다', () => {
  const at = new Date('2026-09-06T00:30:00+09:00'); // UTC 로는 전날 15:30
  const p = n => String(n).padStart(2, '0');
  const expected = `${p(at.getHours())}:${p(at.getMinutes())}`;
  const csv = toCsv(
    [{ date: '2026-09-06', ts: at.toISOString(), reason: '출고', sku: 'C24V-1', name: '코트', color: '블랙', size: 'S', delta: -1, left: 4, ref: 'SHIP-1', note: '창고 정리' }],
    STOCKLOG_COLUMNS
  );
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines[0], '날짜,시각,구분,SKU,제품,컬러,사이즈,변동,남음,상대·메모,메모');
  assert.equal(lines[1], `2026-09-06,${expected},주문 출고,C24V-1,코트,블랙,S,-1,4,SHIP-1,창고 정리`);
  assert.equal(expected, '00:30', '한국 시간 기준으로 돌리면 자정 30분');
});

test('CSV: 엑셀 수식으로 읽힐 문자열만 앞에 따옴표를 붙이고 숫자는 그대로 둔다', () => {
  const csv = toCsv(
    [{ name: '=1+1', memo: '@here', delta: -3, left: 0 }],
    [{ key: 'name', label: '제품' }, { key: 'memo', label: '메모' }, { key: 'delta', label: '변동' }, { key: 'left', label: '남음' }]
  );
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines[1], "'=1+1,'@here,-3,0", '음수 숫자는 그대로');
});
