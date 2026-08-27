'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePostalAddress,
  postalAddressCandidates,
  postalZipFromDocuments,
  postalLookupDue,
  zipForChangedAddress
} = require('../lib/postal');

test('상세 동호수를 빼고 도로명과 건물번호로 다시 찾는다', () => {
  const candidates = postalAddressCandidates('수원시 장안구 율전로 108번길 9 604-1203');
  assert.deepEqual(candidates, [
    { query: '수원시 장안구 율전로 108번길 9 604-1203', fallback: false },
    { query: '수원시 장안구 율전로 108번길 9', fallback: false },
    { query: '율전로 108번길 9', fallback: true }
  ]);
});

test('붙어 있는 도로명과 지번 주소도 고유 후보로 만든다', () => {
  assert.deepEqual(postalAddressCandidates('강릉시 교동 원대로30번길 38, 308호'), [
    { query: '강릉시 교동 원대로30번길 38, 308호', fallback: false },
    { query: '강릉시 교동 원대로30번길 38', fallback: true },
    { query: '원대로30번길 38', fallback: true }
  ]);
  assert.ok(postalAddressCandidates('서울 강남구 역삼동 123-4 101호')
    .some(row => row.query === '역삼동 123-4' && row.fallback));
  assert.ok(postalAddressCandidates('서울 강남구 역삼동 123번지 101호')
    .some(row => row.query === '역삼동 123번지' && row.fallback));
  assert.ok(postalAddressCandidates('서울 종로구 종로1가 12-3 201호')
    .some(row => row.query === '종로1가 12-3' && row.fallback));
  assert.ok(postalAddressCandidates('파주시 창동리 산 12-3 가동')
    .some(row => row.query === '창동리 산 12-3' && row.fallback));
  assert.ok(postalAddressCandidates('강원특별자치도 평창군 봉평면 창동리 산 12-3 가동 101호')
    .some(row => row.query === '창동리 산 12-3' && row.fallback));
  assert.ok(postalAddressCandidates('경기도 파주시 문산읍 당동리 123번지 101호')
    .some(row => row.query === '당동리 123번지' && row.fallback));
});

test('주소에 들어간 기존 우편번호를 제거하고 중복 후보를 만들지 않는다', () => {
  assert.equal(normalizePostalAddress('(06234) 서울 강남구 테헤란로 123'), '서울 강남구 테헤란로 123');
  const candidates = postalAddressCandidates('서울 강남구 테헤란로 123');
  assert.equal(new Set(candidates.map(row => row.query)).size, candidates.length);
});

test('카카오 결과가 정확히 하나일 때만 우편번호를 채택한다', () => {
  const one = [{ road_address: { zone_no: '06234' } }];
  assert.equal(postalZipFromDocuments(one), '06234');
  assert.equal(postalZipFromDocuments([...one, { address: { zip_code: '12345' } }]), '');
  assert.equal(postalZipFromDocuments([]), '');
});

test('같은 주소의 당일 실패는 멈추고 주소·버전 변경과 수동 재시도는 허용한다', () => {
  const item = { _zipTried: '2026-08-27', _zipTriedAddr: 'ADDR-A', _zipLookupVersion: 2 };
  assert.equal(postalLookupDue(item, '2026-08-27', 'ADDR-A', 2, false), false);
  assert.equal(postalLookupDue(item, '2026-08-27', 'ADDR-B', 2, false), true);
  assert.equal(postalLookupDue(item, '2026-08-27', 'ADDR-A', 3, false), true);
  assert.equal(postalLookupDue(item, '2026-08-27', 'ADDR-A', 2, true), true);
});

test('주소가 바뀌면 이전과 같은 우편번호는 지우고 새 우편번호만 받는다', () => {
  assert.equal(zipForChangedAddress('11111', '11111'), '');
  assert.equal(zipForChangedAddress('11111', '22222'), '22222');
  assert.equal(zipForChangedAddress('11111', ''), '');
});
