// 코드 리뷰(2026-09-03)에서 나온 HIGH 4건의 회귀 방지 테스트
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deliveryCheckOrder,
  groupRecipientConflict,
  prepareEpostCancellation,
  setEpostCancellationState,
  finalizeEpostCancellation
} = require('../lib/operations');
const { codeMatches } = require('../lib/security');

test('취소 확정 시 카페24·시트 반영 플래그를 즉시 내려 재접수 때 새 송장이 다시 반영되게 한다', () => {
  const db = {
    inventory: [],
    orders: [{
      id: 1, orderNo: 'ORDER-1', orderItemCode: 'ITEM-1', status: '발송완료',
      invoice: '6890000000002', sentDate: '2026-09-03', cafe24Shipped: true,
      epost: { orderNo: 'HAM-C1', reqNo: 'REQ', resNo: 'RES', reqYmd: '20260903', regiNo: '6890000000002' }
    }],
    seeding: [{
      id: 2, name: '시딩', phone: '010-1111-2222', status: '발송완료', sourceRowId: 'row-9',
      invoice: '6890000000003', sentDate: '2026-09-03', sheetWritten: true,
      epost: { orderNo: 'HAM-C2', reqNo: 'REQ2', resNo: 'RES2', reqYmd: '20260903', regiNo: '6890000000003' }
    }]
  };
  for (const [type, id] of [['order', 1], ['seeding', 2]]) {
    const prepared = prepareEpostCancellation(db, type, id, '2026-09-03T12:00:00.000Z');
    setEpostCancellationState(db, prepared.orderNo, 'epost_canceled', '', '2026-09-03T12:01:00.000Z');
    finalizeEpostCancellation(db, prepared.orderNo, () => ({ missingSkus: [] }), '2026-09-03T12:02:00.000Z');
  }
  // 옛 송장 삭제 대상은 참조로 남고(재시도용), 플래그는 내려가 있어야 한다
  assert.equal(db.orders[0].canceledShipment.invoice, '6890000000002');
  assert.equal(db.orders[0].cafe24Shipped, false);
  assert.equal(db.seeding[0].canceledSheet.invoice, '6890000000003');
  assert.equal(db.seeding[0].sheetWritten, false);
});

test('배달 조회는 한 번도 안 본 것과 오래전에 본 것을 먼저 본다', () => {
  const items = [
    { id: 'a', deliveryCheckedAt: '2026-09-03T00:00:00.000Z' },
    { id: 'b' },
    { id: 'c', deliveryCheckedAt: '2026-09-01T00:00:00.000Z' },
    { id: 'd', deliveryCheckedAt: '2026-09-02T00:00:00.000Z' }
  ];
  assert.deepEqual(deliveryCheckOrder(items).map(x => x.id), ['b', 'c', 'd', 'a']);
  // 원본 배열은 건드리지 않는다
  assert.deepEqual(items.map(x => x.id), ['a', 'b', 'c', 'd']);
  // 10건 넘게 미배달이 쌓여도 새 건(미조회)이 앞 10건 안에 든다
  const many = [...Array(12)].map((_, i) => ({ id: 'old' + i, deliveryCheckedAt: '2026-09-0' + ((i % 3) + 1) + 'T00:00:00.000Z' }));
  many.push({ id: 'new' });
  assert.equal(deliveryCheckOrder(many).slice(0, 10)[0].id, 'new');
});

test('한 포장 안의 받는 사람·주소가 갈리면 접수를 막고, 같으면 통과한다', () => {
  const keyOf = it => it.name + '|' + it.addr;
  assert.equal(groupRecipientConflict([{ name: '김', addr: '서울 A' }, { name: '김', addr: '서울 A' }], keyOf), '');
  assert.match(groupRecipientConflict([{ name: '김', addr: '서울 A' }, { name: '김', addr: '부산 B' }], keyOf), /받는 사람·연락처·주소/);
  assert.equal(groupRecipientConflict([], keyOf), '');
});

test('접속 코드 비교는 길이가 달라도 안전하게 동작하고 빈 코드는 절대 통과하지 않는다', () => {
  assert.equal(codeMatches('840007', '840007'), true);
  assert.equal(codeMatches('840008', '840007'), false);
  assert.equal(codeMatches('84000', '840007'), false);
  assert.equal(codeMatches('', ''), false);
  assert.equal(codeMatches('anything', ''), false);
  assert.equal(codeMatches(undefined, '840007'), false);
});
