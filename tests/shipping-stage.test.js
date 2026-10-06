'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const shippingStage = require('../public/shipping-stage');
const { shipmentCsvRows } = require('../lib/stats');
const { EPOST_DONE_CODES, normalizeEpostStus } = require('../lib/operations');

const postal = extra => ({ status: '발송완료', invoice: '1234567890123', epost: { orderNo: 'E1', stus: '02' }, ...extra });
test('출력 전·출력 후·수거·배송완료는 서로 다른 단계와 색이다', () => {
  for (const stus of ['00', '01', '02']) {
    assert.equal(shippingStage(postal({ epost: { stus } })).key, 'ready');
    assert.equal(shippingStage(postal({ epost: { stus }, printed: true })).key, 'pickup');
  }
  const items = [postal(), postal({ printed: true }), postal({ printed: true, epost: { stus: '03' } }), postal({ delivered: true })];
  assert.deepEqual(items.map(x => shippingStage(x).label), ['배송준비', '우체국 픽업 대기', '배송중', '배송완료']);
  assert.equal(new Set(items.map(x => shippingStage(x).kind)).size, 4);
});
test('예외 상태는 출력 여부와 무관하게 유지하며 완료는 최우선이다', () => {
  for (const printed of [false, true]) {
    assert.deepEqual(shippingStage(postal({ printed, epost: { stus: '04' } })), { key: 'problem', label: '수거 안 됨 · 확인', kind: 'bad' });
    assert.equal(shippingStage(postal({ printed, epost: { stus: '05' } })).key, 'canceled');
    assert.equal(shippingStage(postal({ printed, epost: { stus: '99' } })).label, '확인 필요');
  }
  assert.equal(shippingStage(postal({ status: '취소됨' })).key, 'canceled');
  assert.equal(shippingStage(postal({ epost: { stus: '04' }, delivered: true })).key, 'done');
});
test('엑셀 접수·접수 전·다른 택배사·실제 추적 정보를 구분하고 데이터를 바꾸지 않는다', () => {
  assert.equal(shippingStage({ status: '접수중' }).key, 'ready');
  assert.equal(shippingStage({ status: '대기' }).label, '접수 전');
  assert.equal(shippingStage({ status: '발송완료', invoice: '123', courier: 'CJ대한통운' }).key, 'moving');
  // 택배 조회의 '배송중'은 '조회됨·미완료'라 우체국 접수 직후에도 붙는다 — 우체국 건은 수거(03)로만 배송중
  assert.equal(shippingStage(postal({ deliveryCheckStatus: '배송중' })).key, 'ready');
  assert.equal(shippingStage(postal({ printed: true, deliveryCheckStatus: '배송중' })).key, 'pickup');
  assert.equal(shippingStage({ status: '발송완료', invoice: '9', courier: '롯데', deliveryCheckStatus: '배송중' }).key, 'moving');
  const item = Object.freeze(postal({ deliveryCheckStatus: '배달완료', delivered: true }));
  assert.equal(shippingStage(item).label, '배송완료');
  assert.equal(item.deliveryCheckStatus, '배달완료');
  assert.equal(shippingStage(null).label, '확인 필요');
});
test('브라우저 전역과 서버 require는 같은 단계 함수를 쓴다', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/shipping-stage.js'), 'utf8'), context);
  assert.equal(context.shippingStage(postal({ printed: true })).key, shippingStage(postal({ printed: true })).key);
});
test('내려받기 단계 필터와 상태 문구도 화면과 같다', () => {
  const items = [postal(), postal({ printed: true }), postal({ epost: { stus: '03' } }), postal({ delivered: true }), postal({ epost: { stus: '04' } })];
  const db = { orders: items, seeding: [] };
  for (const key of ['ready', 'pickup', 'moving', 'done', 'problem']) {
    const rows = shipmentCsvRows(db, { filter: key });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, shippingStage(items.find(x => shippingStage(x).key === key)).label);
  }
});

// 실제 서버 함수에 우체국 응답만 주입해 외부 접수 없이 polling 흐름을 검증한다.
function statusRefresh(call) {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const start = source.indexOf('async function refreshEpostStatuses(');
  const end = source.indexOf('\n// 우체국 쪽에서', start);
  const context = vm.createContext({ EPOST_DONE_CODES, normalizeEpostStus, Date, Set,
    epostCall: call, xmlVal: (xml, key) => xml[key], today: () => '2026-10-06', VIEW_ONLY: true });
  vm.runInContext(source.slice(start, end), context);
  return context.refreshEpostStatuses;
}
test('출력한 주문과 시딩도 조회하여 03으로 갱신하며 인쇄한 송장번호는 유지한다', async () => {
  const calls = [];
  const refresh = statusRefresh(async (db, method, args) => { calls.push(args.orderNo); return { treatStusCd: '03', regiNo: 'changed' }; });
  const db = { epost: { custNo: 'test' }, orders: [postal({ printed: true })], seeding: [postal({ printed: true, epost: { orderNo: 'E2', stus: '01' } })] };
  const result = await refresh(db);
  assert.equal(result.refreshed, 2);
  assert.deepEqual(calls, ['E1', 'E2']);
  for (const x of [...db.orders, ...db.seeding]) {
    assert.equal(x.epost.stus, '03');
    assert.equal(shippingStage(x).key, 'moving');
    assert.equal(x.invoice, '1234567890123');
  }
});
test('완료·취소·배송완료는 polling에서 제외하고 회당 25건 제한을 유지한다', async () => {
  const calls = [];
  const refresh = statusRefresh(async (db, method, args) => { calls.push(args.orderNo); return { treatStusCd: '02' }; });
  const db = { epost: { custNo: 'test' }, orders: [
    postal({ delivered: true, epost: { orderNo: 'delivered', stus: '02' } }),
    postal({ epost: { orderNo: 'collected', stus: '03' } }),
    postal({ epost: { orderNo: 'canceled', stus: '05' } }),
    ...Array.from({ length: 30 }, (_, i) => postal({ printed: true, epost: { orderNo: 'E' + i, stus: '02' } }))
  ], seeding: [] };
  const result = await refresh(db);
  assert.equal(result.refreshed, 25);
  assert.equal(calls.length, 25);
  assert.deepEqual(calls, Array.from({ length: 25 }, (_, i) => 'E' + i));
});
