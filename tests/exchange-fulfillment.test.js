'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const operations = require('../lib/operations');
const itemLines = require('../public/item-lines');
const {
  fulfillmentKey, parcelReference, expandSelectedFulfillments, fulfillmentGroupConflicts,
  splitOrderLineForLater, undoSplitOrder, resolvePackingMergeSelection,
  cafe24ExistingShipmentOrderNos, sameCafe24OrderItem
} = operations;

// 서버를 켜지 않고 실제 함수만 실행한다 — 장부 저장·외부 접수는 모의 처리.
function loadFunctions(file, names, globals) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const context = vm.createContext({ ...globals });
  for (const name of names) {
    const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?(?=^(?:async )?function |$(?![^]))', 'm'));
    assert.ok(match, file + '의 ' + name + ' 함수를 찾지 못했어요');
    vm.runInContext(match[0], context);
  }
  return context;
}

function exchangeDb() {
  const common = { orderNo: '20260927-0000015', name: '고객', phone: '010-1111-2222', addr: '서울시 같은 주소', zip: '04524', product: 'Clara' };
  return {
    orders: [
      { ...common, id: 272, orderItemCode: common.orderNo + '-01', size: 'M', status: '발송완료', invoice: '6890178073141', epost: { orderNo: 'HAM-ORIGINAL' } },
      { ...common, id: 281, orderItemCode: common.orderNo + '-02', size: 'L', status: '대기', exchange: true }
    ],
    seeding: []
  };
}

function parcelFunctions() {
  return loadFunctions('server.js', ['normName', 'phoneDigits', 'cleanAddr', 'extractZip', 'buildParcelGroups', 'buildEpostRows'], operations);
}

test('교환 재발송은 발송한 원주문과 충돌하지 않고 선택 확장에서도 분리된다', () => {
  const db = exchangeDb();
  const selected = [{ type: 'order', id: 281 }];
  assert.deepEqual(fulfillmentGroupConflicts(db, selected), []);
  assert.deepEqual(expandSelectedFulfillments(db, selected), selected);
  assert.deepEqual(expandSelectedFulfillments(db, [{ type: 'order', id: 272 }]), [{ type: 'order', id: 272 }]);
});

test('같은 원주문의 교환 행들도 각각 다른 포장과 우체국 참조번호를 갖는다', () => {
  const [original, exchange] = exchangeDb().orders;
  const another = { ...exchange, id: 282, parcelSplitId: 'SPLIT-OLD' };
  const rows = [original, exchange, another];
  assert.equal(new Set(rows.map(item => fulfillmentKey('order', item))).size, 3);
  assert.equal(new Set(rows.map(item => parcelReference('order', item))).size, 3);
  assert.equal(fulfillmentKey('order', exchange), 'exchange|281');
  assert.equal(parcelReference('order', exchange), 'EXCHANGE-281');
});

test('명시적 합포장은 교환 행에서도 우선하며 일부 발송·재고 대기 차단을 유지한다', () => {
  const db = exchangeDb();
  for (const item of db.orders) item.packGroupId = 'PACK-ONE';
  assert.equal(fulfillmentKey('order', db.orders[0]), fulfillmentKey('order', db.orders[1]));
  assert.equal(parcelReference('order', db.orders[0]), parcelReference('order', db.orders[1]));
  assert.equal(expandSelectedFulfillments(db, [{ type: 'order', id: 281 }]).length, 2);
  assert.match(fulfillmentGroupConflicts(db, [{ type: 'order', id: 281 }])[0].reason, /일부 상품만 이미 발송/);
  db.orders[0] = { id: 272, status: '대기', packGroupId: 'PACK-ONE', shippingHold: true };
  assert.match(fulfillmentGroupConflicts(db, [{ type: 'order', id: 281 }])[0].reason, /재고 기다림/);
});

test('일반 주문의 일부 발송·접수중 충돌은 교환 행 유무와 관계없이 유지된다', () => {
  const db = exchangeDb();
  db.orders.push({ ...db.orders[1], id: 282, exchange: false });
  const selected = [{ type: 'order', id: 282 }];
  assert.match(fulfillmentGroupConflicts(db, selected)[0].reason, /일부 상품만 이미 발송/);
  assert.deepEqual(fulfillmentGroupConflicts(db, [{ type: 'order', id: 281 }]), []);
  db.orders[0] = { id: 272, orderNo: db.orders[0].orderNo, status: '접수중', epostOp: { state: 'unknown' } };
  assert.match(fulfillmentGroupConflicts(db, selected)[0].reason, /이미 접수 중/);
  db.orders[1].epostOp = { state: 'pending' };
  assert.match(fulfillmentGroupConflicts(db, [{ type: 'order', id: 281 }])[0].reason, /이미 접수 중/);
});

test('교환 재발송의 접수·엑셀 포장은 정상 생성되고 같은 품목 중복은 계속 차단한다', () => {
  const db = exchangeDb();
  const server = parcelFunctions();
  const selected = [{ type: 'order', id: 281 }];
  const result = server.buildParcelGroups(db, selected);
  assert.equal(result.groups.size, 1);
  assert.equal(result.dups.length, 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.pick[0].item.id, 281);
  assert.equal(sameCafe24OrderItem(db.orders[0], db.orders[1]), false);
  db.settings = { epostColumns: ['주문번호', '상품명', '상품모델'] };
  const exported = server.buildEpostRows(db, selected);
  assert.equal(exported.parcels, 1);
  assert.equal(exported.rows[0]['주문번호'], parcelReference('order', db.orders[1]));
  assert.equal(exported.rows[0]['상품모델'], 'L');
  db.orders[1].orderItemCode = db.orders[0].orderItemCode;
  const duplicate = server.buildParcelGroups(db, selected);
  assert.equal(duplicate.groups.size, 0);
  assert.equal(duplicate.dups.length, 1);
});

test('원주문 분리배송과 취소는 교환 행의 발송 상태를 형제 품목으로 보지 않는다', () => {
  const orders = [
    { id: 1, orderNo: 'ORDER-1', status: '대기' },
    { id: 2, orderNo: 'ORDER-1', status: '대기' },
    { id: 3, orderNo: 'ORDER-1', status: '발송완료', exchange: true, invoice: '123' }
  ];
  assert.equal(splitOrderLineForLater(orders, 2, 'SPLIT-2').ok, true);
  assert.equal(undoSplitOrder(orders, 'ORDER-1').ok, true);
  assert.equal(orders[1].parcelSplitId, undefined);
  assert.equal(orders[2].invoice, '123');
  orders[2].status = '대기';
  orders[2].invoice = '';
  assert.match(splitOrderLineForLater(orders, 3, 'SPLIT-3').error, /이미 별도 택배/);
});

test('교환 재발송을 합포할 때 원주문의 발송 행을 끌어오지 않는다', () => {
  const db = exchangeDb();
  db.seeding.push({ id: 300, status: '대기' });
  const result = resolvePackingMergeSelection(db, [{ type: 'order', id: 281 }, { type: 'seeding', id: 300 }]);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.picked.map(entry => entry.item.id), [281, 300]);
  db.orders[0] = { ...db.orders[0], status: '대기', invoice: '', epost: undefined };
  db.orders[1].shippingHold = true;
  const original = resolvePackingMergeSelection(db, [{ type: 'order', id: 272 }, { type: 'seeding', id: 300 }]);
  assert.equal(original.error, undefined);
  assert.deepEqual(original.picked.map(entry => entry.item.id), [272, 300]);
});

test('합포 제안과 송장 없는 발송 건수도 교환 재발송을 따로 센다', () => {
  const db = exchangeDb();
  const exchange = { ...db.orders[1], _sel: true };
  const another = { ...exchange, id: 282 };
  const entries = [exchange, another].map(x => ({ kind: 'orders', x }));
  const allEntries = [{ kind: 'orders', x: db.orders[0] }, ...entries];
  const suggestions = itemLines.cafe24MergeSuggestions(entries, allEntries);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].units.orders, 2);
  assert.deepEqual(suggestions[0].entries.map(entry => entry.x.id), [281, 282]);
  const sent = [db.orders[0], exchange, another].map(item => ({ ...item, status: '발송완료' }));
  assert.equal(new Set(sent.map(item => itemLines.sentShipmentKey(item, '고객'))).size, 3);
  for (const item of sent) item.packGroupId = 'PACK-ONE';
  assert.equal(new Set(sent.map(item => itemLines.sentShipmentKey(item, '고객'))).size, 1);
});

test('보내기 화면과 포장 명세의 그룹 규칙은 서버와 같은 교환·합포장 우선순위다', () => {
  const screen = loadFunctions('public/app-core.js', ['shipmentRecipientKey', 'shipmentKey', 'pendingFulfillmentKey'], { HamItemLines: itemLines });
  const packing = loadFunctions('public/packing.html', ['fulfillKey']);
  const rows = exchangeDb().orders.map(item => ({ ...item, status: '대기', invoice: '', epost: undefined }));
  rows.push({ ...rows[1], id: 282, parcelSplitId: 'SPLIT-OLD' });
  assert.equal(new Set(rows.map(item => screen.shipmentKey(item))).size, 3);
  for (const item of rows) {
    assert.equal(screen.pendingFulfillmentKey('orders', item), fulfillmentKey('order', item));
    assert.equal(packing.fulfillKey('order', item).replace(/:/g, '|'), fulfillmentKey('order', item));
    item.packGroupId = 'PACK-ONE';
    assert.equal(screen.shipmentKey(item), 'pending|pack|PACK-ONE');
    assert.equal(screen.pendingFulfillmentKey('orders', item), fulfillmentKey('order', item));
    assert.equal(packing.fulfillKey('order', item).replace(/:/g, '|'), fulfillmentKey('order', item));
  }
});

test('카페24 기존 송장 조회 대상은 교환 행을 제외하고 일반 주문은 중복 제거한다', () => {
  const [original, exchange] = exchangeDb().orders;
  assert.deepEqual(cafe24ExistingShipmentOrderNos([{ type: 'order', item: exchange }]), []);
  const entries = [original, { ...original, id: 273 }, exchange].map(item => ({ type: 'order', item }));
  entries.push({ type: 'seeding', item: { orderNo: '20261001-0000001' } });
  entries.push({ type: 'order', item: { orderNo: '29CM-ORDER-1' } });
  assert.deepEqual(cafe24ExistingShipmentOrderNos(entries), [original.orderNo]);
});

test('혼합 합포장에 외부 송장을 반영해도 교환 행은 원주문 송장으로 발송 처리하지 않는다', () => {
  const db = exchangeDb();
  db.orders[0] = { ...db.orders[0], status: '대기', invoice: '', epost: undefined };
  const server = loadFunctions('server.js', ['adoptExternalShipment'], { today: () => '2026-10-06' });
  server.adoptExternalShipment(db, { items: db.orders.map(item => ({ type: 'order', item })) }, { tracking: '6890178073141', carrierCode: '0012' });
  assert.equal(db.orders[0].status, '발송완료');
  assert.equal(db.orders[1].status, '대기');
  assert.equal(db.orders[1].invoice, undefined);
  assert.equal(db.orders[1].cafe24Shipped, undefined);
});

test('교환 새 송장은 카페24 -02 품목만 POST하고 원주문의 -01 송장은 그대로 둔다', async () => {
  const db = exchangeDb();
  db.orders[1].invoice = '6890000000281';
  db.orders[1].status = '발송완료';
  const calls = [];
  const server = loadFunctions('server.js', ['cafe24RegisterShipment', 'pushCafe24Shipments'], {
    ...operations,
    cafe24Configured: () => true, cafe24EnsureToken: async () => 'mock',
    cafe24PostCarrierCode: async () => '0012', saveDb: () => {},
    cafe24Fetch: async (_, __, url, method, body) => {
      calls.push({ url, method, body });
      if (url.endsWith('?embed=items')) return { status: 200, json: { order: { items: [
        { order_item_code: db.orders[0].orderItemCode, order_status: 'E40' },
        { order_item_code: db.orders[1].orderItemCode, order_status: 'N20' }
      ] } } };
      if (method === 'POST') return { status: 201 };
      return { status: 200, json: { shipments: [{ tracking_no: db.orders[0].invoice, order_item_code: [db.orders[0].orderItemCode] }] } };
    }
  });
  db.cafe24Token = 'mock';
  const results = await server.pushCafe24Shipments(db, [{ type: 'order', item: db.orders[1] }]);
  assert.equal(results[0].ok, true);
  const posted = calls.filter(call => call.method === 'POST');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].body.request.tracking_no, db.orders[1].invoice);
  assert.deepEqual(Array.from(posted[0].body.request.order_item_code), [db.orders[1].orderItemCode]);
  assert.equal(db.orders[0].invoice, '6890178073141');
  assert.equal(db.orders[0].cafe24Shipped, undefined);
  assert.equal(db.orders[1].cafe24Shipped, true);
});

test('교환 품목이 카페24 배송 가능 목록에 없으면 외부 등록만 멈추고 새 우체국 송장은 보존한다', async () => {
  const db = exchangeDb();
  const exchange = db.orders[1];
  exchange.invoice = '6890000000281';
  exchange.status = '발송완료';
  exchange.epost = { orderNo: 'HAM-EXCHANGE' };
  db.cafe24Token = 'mock';
  let posted = false;
  const server = loadFunctions('server.js', ['cafe24RegisterShipment', 'pushCafe24Shipments'], {
    ...operations,
    cafe24Configured: () => true, cafe24EnsureToken: async () => 'mock',
    cafe24PostCarrierCode: async () => '0012', saveDb: () => {},
    cafe24Fetch: async (_, __, url, method) => {
      if (method === 'POST') posted = true;
      return { status: 200, json: { order: { items: [
        { order_item_code: exchange.orderItemCode, order_status: 'E40' }
      ] } } };
    }
  });
  const results = await server.pushCafe24Shipments(db, [{ type: 'order', item: exchange }]);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /현재 배송 가능 품목/);
  assert.equal(posted, false);
  assert.equal(exchange.invoice, '6890000000281');
  assert.equal(exchange.epost.orderNo, 'HAM-EXCHANGE');
  assert.equal(exchange.cafe24Shipped, undefined);
  assert.equal(db.orders[0].invoice, '6890178073141');
});
