const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSeedingPacking,
  mergeSeedingRows
} = require('../lib/seeding');

const helpers = {
  today: () => '2026-08-31',
  zipForChangedAddress: (previous, incoming) => incoming || '',
  clearZipLookupState: item => { delete item.zipLookupError; }
};

test('일반 패킹과 패키지 시딩을 작업자가 보는 두 이름으로 통일한다', () => {
  assert.equal(normalizeSeedingPacking('일반 패킹'), '시딩');
  assert.equal(normalizeSeedingPacking('일반패킹'), '시딩');
  assert.equal(normalizeSeedingPacking(''), '시딩');
  assert.equal(normalizeSeedingPacking('시딩 패키지'), '패키지 시딩');
});

test('시트 비고와 포장 구분은 발송 후 수정되거나 지워져도 최신값을 따른다', () => {
  const db = {
    nextId: 2,
    seeding: [{
      id: 1, sourceRowId: '10', name: '기존', phone: '01011112222', status: '발송완료',
      product: '이미 보낸 제품', packType: '시딩', note: '예전 비고', request: '예전 요청'
    }]
  };
  const result = mergeSeedingRows(db, [{
    sourceRowId: '10', name: '바뀐 이름', phone: '01099998888', status: '발송완료',
    product: '시트에서 바뀐 제품', packType: '시딩 패키지', note: '', request: '새 요청'
  }], helpers);
  assert.deepEqual(result, { added: 0, updated: 1, canceled: 0 });
  assert.equal(db.seeding[0].packType, '패키지 시딩');
  assert.equal(db.seeding[0].note, '');
  assert.equal(db.seeding[0].request, '새 요청');
  assert.equal(db.seeding[0].name, '기존');
  assert.equal(db.seeding[0].product, '이미 보낸 제품');
});

test('같은 사람의 시트 행 순서가 바뀌어도 고유 행 번호로 정확히 갱신한다', () => {
  const db = {
    nextId: 3,
    seeding: [
      { id: 1, sourceRowId: '101', name: '같은사람', phone: '01011112222', product: '제품 A', addr: '주소 A', zip: '11111', status: '대기' },
      { id: 2, sourceRowId: '102', name: '같은사람', phone: '01011112222', product: '제품 B', addr: '주소 B', zip: '22222', status: '대기' }
    ]
  };
  const rows = [
    { sourceRowId: '102', name: '같은사람', phone: '01011112222', product: '제품 B 수정', addr: '주소 B', zip: '22222', packType: '일반 패킹' },
    { sourceRowId: '101', name: '같은사람', phone: '01011112222', product: '제품 A 수정', addr: '주소 A', zip: '11111', packType: '시딩 패키지' }
  ];
  mergeSeedingRows(db, rows, helpers);
  assert.equal(db.seeding.find(x => x.sourceRowId === '101').product, '제품 A 수정');
  assert.equal(db.seeding.find(x => x.sourceRowId === '101').packType, '패키지 시딩');
  assert.equal(db.seeding.find(x => x.sourceRowId === '102').product, '제품 B 수정');
  assert.equal(db.seeding.find(x => x.sourceRowId === '102').packType, '시딩');
});

test('기존 장부에 고유번호가 없어도 제품과 주소로 찾아 행 순서와 섞지 않는다', () => {
  const db = {
    nextId: 3,
    seeding: [
      { id: 1, name: '같은사람', phone: '01011112222', product: '제품 A', addr: '주소 A', status: '대기' },
      { id: 2, name: '같은사람', phone: '01011112222', product: '제품 B', addr: '주소 B', status: '대기' }
    ]
  };
  mergeSeedingRows(db, [
    { sourceRowId: '102', name: '같은사람', phone: '01011112222', product: '제품 B', addr: '주소 B', packType: '일반 패킹' },
    { sourceRowId: '101', name: '같은사람', phone: '01011112222', product: '제품 A', addr: '주소 A', packType: '시딩 패키지' }
  ], helpers);
  assert.equal(db.seeding.find(x => x.id === 1).sourceRowId, '101');
  assert.equal(db.seeding.find(x => x.id === 1).product, '제품 A');
  assert.equal(db.seeding.find(x => x.id === 2).sourceRowId, '102');
  assert.equal(db.seeding.find(x => x.id === 2).product, '제품 B');
});

test('시트 행 고유번호가 없으면 기존 장부를 건드리지 않고 중지한다', () => {
  const db = { nextId: 2, seeding: [{ id: 1, name: '기존', phone: '01011112222', product: '제품 A', status: '대기' }] };
  assert.throws(() => mergeSeedingRows(db, [{ name: '기존', phone: '01011112222', product: '제품 B' }], helpers), /고유번호/);
  assert.equal(db.seeding[0].product, '제품 A');
});

test('시트를 빈 결과로 읽었을 때 기존 대기 시딩을 취소하지 않는다', () => {
  const db = { nextId: 2, seeding: [{ id: 1, name: '대기', phone: '01011112222', status: '대기' }] };
  const result = mergeSeedingRows(db, [], helpers);
  assert.equal(result.canceled, 0);
  assert.equal(db.seeding[0].status, '대기');
});

test('시트에서 고른 카페24 상품·옵션 식별자를 대기 시딩에 그대로 보존한다', () => {
  const db = {
    nextId: 2,
    seeding: [{
      id: 1, sourceRowId: '31', name: '옵션테스트', phone: '01011112222', status: '대기',
      product: '기존 제품', color: '', size: 'S', productNo: '', variantCode: ''
    }]
  };
  const result = mergeSeedingRows(db, [{
    sourceRowId: '31', name: '옵션테스트', phone: '01011112222', status: '대기',
    product: 'B#05_Tessa Pigment Pants', color: 'Brown', size: 'L',
    selectedOption: 'B#05_Tessa Pigment Pants | Brown | L',
    productNo: '83', variantCode: 'P00000DF000C', packType: '일반 패킹'
  }], helpers);

  assert.equal(result.updated, 1);
  assert.equal(db.seeding[0].product, 'B#05_Tessa Pigment Pants');
  assert.equal(db.seeding[0].color, 'Brown');
  assert.equal(db.seeding[0].size, 'L');
  assert.equal(db.seeding[0].productNo, '83');
  assert.equal(db.seeding[0].variantCode, 'P00000DF000C');
});

test('시트에서 실제로 사라진 대기 행만 취소한다', () => {
  const db = {
    nextId: 3,
    seeding: [
      { id: 1, sourceRowId: '1', name: '남음', phone: '01011112222', status: '대기' },
      { id: 2, sourceRowId: '2', name: '삭제', phone: '01033334444', status: '대기' }
    ]
  };
  const result = mergeSeedingRows(db, [{ sourceRowId: '1', name: '남음', phone: '01011112222', packType: '일반 패킹' }], helpers);
  assert.equal(result.canceled, 1);
  assert.equal(db.seeding[0].status, '대기');
  assert.equal(db.seeding[1].status, '취소됨');
});
