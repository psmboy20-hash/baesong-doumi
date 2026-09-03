'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('클라우드 업데이트는 성공한 버전만 표시하고 실패한 버전은 다음 실행에서 재시도한다', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'ops', 'cloud-update.sh'), 'utf8');
  const installAt = script.indexOf('npm ci');
  const restartAt = script.indexOf('systemctl restart ham');
  const healthAt = script.indexOf('/healthz');
  const markerAt = script.indexOf('mv "$marker_tmp" "$DEPLOYED_SHA_FILE"');
  assert.ok(installAt >= 0 && installAt < restartAt);
  assert.ok(restartAt < healthAt);
  assert.ok(healthAt < markerAt);
  assert.match(script, /deployed_sha/);
  assert.match(script, /--retry-connrefused/);
});

test('클라우드 서비스는 공개 포트가 아니라 로컬 프록시에만 연결한다', () => {
  const unit = fs.readFileSync(path.join(__dirname, '..', 'ops', 'ham.service'), 'utf8');
  assert.match(unit, /Environment=HAM_BIND=127\.0\.0\.1/);
  assert.match(unit, /Environment=HAM_TRUST_PROXY=1/);
});
