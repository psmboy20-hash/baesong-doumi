'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cafe24OptionKind } = require('../lib/operations');
const { isRetiredStockRow, stockRowForProduct } = require('../public/item-lines');

test('카페24 옵션 이름 "컬러"도 색상으로 읽는다 (새로 등록한 FW 상품들은 컬러+사이즈)', () => {
  assert.equal(cafe24OptionKind('컬러'), 'color');
  assert.equal(cafe24OptionKind('색상'), 'color');
  assert.equal(cafe24OptionKind('Color'), 'color');
  assert.equal(cafe24OptionKind('칼라'), 'color');
  assert.equal(cafe24OptionKind('사이즈'), 'size');
  assert.equal(cafe24OptionKind('SIZE'), 'size');
  assert.equal(cafe24OptionKind('각인 문구'), '');
});

test('카페24에서 지워졌고 한 번도 안 센 옵션 줄만 숨긴다', () => {
  assert.equal(isRetiredStockRow({ cafe24VariantActive: false, qty: null }), true);
  assert.equal(isRetiredStockRow({ cafe24VariantActive: false }), true);
  assert.equal(isRetiredStockRow({ retiredAggregate: true, qty: 4 }), true);
  // 센 재고가 있는 지워진 옵션은 남겨야 실물이 사라지지 않는다
  assert.equal(isRetiredStockRow({ cafe24VariantActive: false, qty: 0 }), false);
  assert.equal(isRetiredStockRow({ cafe24VariantActive: false, qty: 3 }), false);
  assert.equal(isRetiredStockRow({ cafe24VariantActive: true, qty: null }), false);
  assert.equal(isRetiredStockRow({ qty: null }), false);
});

test('이름으로 찾을 때 지워진 옛 옵션 줄 때문에 지금 옵션을 못 찾지 않는다', () => {
  const inventory = [
    { id: 418, productNo: 156, variantCode: 'P00000GA000A', color: '블랙', size: '', qty: null, cafe24VariantActive: false },
    { id: 419, productNo: 156, variantCode: 'P00000GA000B', color: '화이트', size: '', qty: null, cafe24VariantActive: false },
    { id: 472, productNo: 156, variantCode: 'P00000GA000C', color: '블랙', size: 'FREE', qty: 5, cafe24VariantActive: true },
    { id: 473, productNo: 156, variantCode: 'P00000GA000D', color: '아이보리', size: 'FREE', qty: 3, cafe24VariantActive: true }
  ];
  assert.equal(stockRowForProduct(inventory, 156, '블랙', 'FREE').id, 472);
  assert.equal(stockRowForProduct(inventory, 156, '블랙', '').id, 472);
  assert.equal(stockRowForProduct(inventory, 156, '아이보리', '').id, 473);
});

test('지운 제품 목록: 줄이 남아 있고 풀어도 새 줄이 안 생기는 제품만 푼다', () => {
  const { releasableHiddenProducts } = require('../lib/operations');
  const products = [
    { no: 151, variants: [{ variantCode: 'FV000C' }, { variantCode: 'FV000D' }] }, // 옛 옵션 줄만 지운 경우
    { no: 127, variants: [{ variantCode: 'EX000A' }, { variantCode: 'EX000B' }] }, // Olive 를 일부러 지운 경우
    { no: 102, variants: [{ variantCode: 'EN000A' }] }                              // 제품 통째로 지운 경우
  ];
  const inventory = [
    { productNo: 151, variantCode: 'FV000C', cafe24VariantActive: true },
    { productNo: 151, variantCode: 'FV000D', cafe24VariantActive: true },
    { productNo: 127, variantCode: 'EX000B', cafe24VariantActive: true }
  ];
  assert.deepEqual(releasableHiddenProducts(inventory, products, [102, 151, 151, 127, 118]), ['151']);
});
