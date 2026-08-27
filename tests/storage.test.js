const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeJsonAtomic, appendAudit } = require('../lib/storage');

test('장부 JSON은 임시 파일 없이 원자적으로 교체된다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ham-storage-'));
  try {
    const file = path.join(dir, 'db.json');
    writeJsonAtomic(file, { rev: 1, value: '정상' });
    writeJsonAtomic(file, { rev: 2, value: '교체' });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { rev: 2, value: '교체' });
    assert.deepEqual(fs.readdirSync(dir), ['db.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('감사 로그는 개인정보 없이 허용된 필드만 한 줄로 남긴다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ham-audit-'));
  try {
    const file = path.join(dir, 'audit.ndjson');
    appendAudit(file, { action: 'packing.merge', ref: 'PACK-1', count: 2, name: '홍길동', phone: '010' });
    const row = JSON.parse(fs.readFileSync(file, 'utf8').trim());
    assert.equal(row.action, 'packing.merge');
    assert.equal(row.ref, 'PACK-1');
    assert.equal(row.count, 2);
    assert.equal('name' in row, false);
    assert.equal('phone' in row, false);
    assert.ok(row.ts);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
