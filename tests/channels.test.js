'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isChannelWithDictionary,
  resolveChannelHeaders,
  channelFieldLabels,
  parseChannelSheet,
  previewChannelSheet,
  buildInvoiceRows,
  normalizeInvoiceTemplate,
  normalizeMapping,
  channelOrderNo
} = require('../lib/channels');
const { groupCafe24ShipmentItems } = require('../lib/operations');

const MUSINSA_ROWS = [
  ['무신사 스토어 주문 내역'],
  ['주문번호', '품목주문번호', '수취인', '휴대폰', '우편번호', '주소', '상품명', '옵션정보', '수량', '배송메시지'],
  ['M-1001', 'M-1001-1', '김하늘', '010-1234-5678', '06134', '서울 강남구 테헤란로 1', 'Margot Denim Pants', 'Indigo / M', '2', '부재 시 문 앞'],
  ['M-1002', 'M-1002-1', '박서준', '01099990000', '48058', '부산 해운대구 우동 2', 'Wool Coat', 'Black / L', '', ''],
  ['', '', '', '', '', '', '', '', '', '']
];

test('사전으로 무신사 열을 찾아 주문 항목을 만든다', () => {
  assert.equal(isChannelWithDictionary('musinsa'), true);
  assert.equal(isChannelWithDictionary('cafe24'), false);
  const parsed = parseChannelSheet(MUSINSA_ROWS, 'musinsa');
  assert.equal(parsed.headerIndex, 1);
  assert.deepEqual(parsed.unmapped, []);
  assert.equal(parsed.items.length, 2, '이름·연락처 없는 빈 줄은 건너뛴다');
  assert.deepEqual(parsed.items[0], {
    orderNo: 'M-1001', lineNo: 'M-1001-1', name: '김하늘', phone: '010-1234-5678',
    zip: '06134', addr: '서울 강남구 테헤란로 1', product: 'Margot Denim Pants',
    color: '', size: '', option: 'Indigo / M', qty: 2, msg: '부재 시 문 앞',
    courier: '', invoice: '', sentDate: ''
  });
  assert.equal(parsed.items[1].qty, 1, '수량이 비어 있으면 1');
});

test('저장한 매핑이 사전보다 먼저다', () => {
  const rows = [
    ['ORDER_ID', 'LINE_ID', '받는분', '받는분 연락처', '우편번호', '배송지', '품목명', '색상/사이즈', '수량', '요청사항'],
    ['A-1', 'A-1-1', '이여름', '010-2222-3333', '06134', '서울 강남구 1', 'Cotton Tee', 'White / S', '1', '경비실']
  ];
  const bare = parseChannelSheet(rows, '29cm');
  assert.ok(bare.unmapped.includes('orderNo'), '사전만으로는 ORDER_ID 를 못 찾는다');
  const saved = { headers: { orderNo: 'ORDER_ID', lineNo: 'LINE_ID' } };
  const parsed = parseChannelSheet(rows, '29cm', saved);
  assert.deepEqual(parsed.unmapped, []);
  assert.equal(parsed.items[0].orderNo, 'A-1');
  assert.equal(parsed.items[0].lineNo, 'A-1-1');
  assert.equal(parsed.items[0].msg, '경비실');
});

test('필수 열을 못 찾으면 못 찾은 항목과 실제 헤더를 돌려준다', () => {
  const rows = [['주문번호', '상품명', '수량'], ['G-1', 'Wool Coat', '1']];
  const parsed = parseChannelSheet(rows, 'gsshop');
  assert.equal(parsed.items.length, 0);
  assert.match(parsed.error, /열 매핑/);
  assert.deepEqual(parsed.sampleHeaders, ['주문번호', '상품명', '수량']);
  for (const key of ['name', 'phone', 'addr']) assert.ok(parsed.unmapped.includes(key));
});

test('미리보기는 헤더·첫 3행·추천 매핑을 준다', () => {
  const preview = previewChannelSheet(MUSINSA_ROWS, 'musinsa');
  assert.equal(preview.headers[0], '주문번호');
  assert.equal(preview.sample.length, 2);
  assert.equal(preview.sample[0]['수취인'], '김하늘');
  assert.equal(preview.suggested.phone, '휴대폰');
  assert.deepEqual(preview.unmapped, []);
});

test('송장 등록 엑셀은 템플릿 열 순서대로 만들고 채널 접두어를 뗀다', () => {
  const items = [
    { orderNo: 'MUSINSA-M-1001', lineNo: 'M-1001-1', invoice: '1234567890123' },
    { orderNo: 'M-1002', lineNo: 'M-1002-1', invoice: '9876543210987' }
  ];
  const basic = buildInvoiceRows(items, 'musinsa', null);
  assert.deepEqual(basic.columns, ['주문번호', '품목번호', '택배사', '송장번호']);
  assert.deepEqual(basic.rows[0], ['M-1001', 'M-1001-1', '우체국택배', '1234567890123']);
  assert.deepEqual(basic.rows[1], ['M-1002', 'M-1002-1', '우체국택배', '9876543210987']);

  const custom = buildInvoiceRows(items, 'musinsa', {
    headers: ['주문번호', '상세번호', '비고', '택배사명', '운송장번호'],
    orderNoCol: '주문번호', lineNoCol: '상세번호', courierCol: '택배사명',
    invoiceCol: '운송장번호', courierName: '우체국'
  });
  assert.deepEqual(custom.rows[0], ['M-1001', 'M-1001-1', '', '우체국', '1234567890123']);
  assert.equal(channelOrderNo('GSSHOP-77', 'gsshop'), '77');
});

test('매핑 저장 입력은 모르는 필드를 버리고 템플릿 기본값을 채운다', () => {
  const saved = normalizeMapping({
    channel: 'gsshop',
    headers: { orderNo: ' 발주번호 ', name: '수취인', hacker: '무시' },
    invoiceTemplate: { headers: ['발주번호', '송장'], invoiceCol: '송장' }
  });
  assert.deepEqual(saved.headers, { orderNo: '발주번호', name: '수취인' });
  assert.deepEqual(saved.invoiceTemplate.headers, ['발주번호', '송장']);
  assert.equal(saved.invoiceTemplate.invoiceCol, '송장');
  assert.equal(saved.invoiceTemplate.courierName, '우체국택배');
  assert.ok(saved.savedAt);
  assert.deepEqual(normalizeInvoiceTemplate(null).headers, ['주문번호', '품목번호', '택배사', '송장번호']);
});

test('채널 주문은 카페24 송장 등록 대상에서 빠진다', () => {
  const groups = groupCafe24ShipmentItems([
    { type: 'order', item: { orderNo: 'MUSINSA-M-1', lineNo: 'M-1-1', invoice: '111', sourceChannel: 'musinsa' } },
    { type: 'order', item: { orderNo: 'GSSHOP-7', lineNo: '1', invoice: '222', sourceChannel: 'gsshop' } },
    { type: 'order', item: { orderNo: '20260901-1', orderItemCode: 'ITEM-A', invoice: '333', sourceChannel: 'cafe24' } }
  ]);
  assert.deepEqual(groups.map(g => g.orderNo), ['20260901-1']);
});

test('한 열이 두 필드에 겹쳐 배정되지 않는다 (수령인 연락처 → 연락처만)', () => {
  const header = ['주문번호', '수령인 연락처', '우편번호', '주소', '상품명', '옵션', '수량'];
  const r = resolveChannelHeaders('29cm', header);
  assert.equal(r.columns.phone, 1, "'수령인 연락처'는 연락처 열이다");
  assert.equal(r.columns.name, undefined, "수령인 열은 없으므로 매핑되지 않는다");
  assert.ok(r.unmapped.includes('name'));
  assert.equal(r.unmapped.includes('phone'), false);
  assert.equal(r.ok, false, '수령인이 없으면 매핑 UI 를 띄워야 한다');
  // 나머지 열은 그대로 자기 자리에
  assert.deepEqual(
    { orderNo: r.columns.orderNo, zip: r.columns.zip, addr: r.columns.addr, product: r.columns.product, option: r.columns.option, qty: r.columns.qty },
    { orderNo: 0, zip: 2, addr: 3, product: 4, option: 5, qty: 6 }
  );
});

test('못 찾은 열은 한국어 라벨로도 알려준다', () => {
  assert.deepEqual(channelFieldLabels(['name', 'lineNo', 'msg', '없는키']), ['수령인', '품목번호', '배송메시지', '없는키']);
});
