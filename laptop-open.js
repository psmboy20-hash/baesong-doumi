// 노트북에서 배송 도우미 열기 — 매장 PC가 켜져 있으면 매장 화면(모든 기능),
// 꺼져 있으면 노트북 보기 모드(시딩/우체국 실시간, 접수는 차단)로 자동 선택
const http = require('http');
const { spawn, exec } = require('child_process');

const STORE = 'http://100.112.253.21:8899'; // 매장 PC (Tailscale)
const LOCAL = 'http://localhost:8899';

function alive(base) {
  return new Promise(resolve => {
    const r = http.get(base + '/api/status', { timeout: 2500 }, res => { resolve(res.statusCode === 200); res.resume(); });
    r.on('timeout', () => { r.destroy(); resolve(false); });
    r.on('error', () => resolve(false));
  });
}

(async () => {
  if (await alive(STORE)) {
    console.log('✅ 매장 컴퓨터가 켜져 있어요 → 매장 실제 화면을 엽니다 (접수 포함 모든 기능 사용 가능)');
    exec('start ' + STORE);
    return;
  }
  console.log('매장 컴퓨터가 꺼져 있어요 → 노트북 보기 모드로 엽니다 (시딩·우체국 실시간, 접수는 매장에서)');
  if (await alive(LOCAL)) {
    exec('start ' + LOCAL);
    return;
  }
  exec('start ' + LOCAL);
  spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: Object.assign({}, process.env, { HAM_VIEW: '1' }),
    stdio: 'inherit'
  });
})();
