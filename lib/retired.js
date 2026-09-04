'use strict';
// 은퇴한 로컬 서버: 매장 PC 등 옛 컴퓨터에서 켜져도 접수·동기화 없이 클라우드 주소로 안내만 한다.
// (같은 주문을 두 곳에서 접수하던 사고 방지 — cloud.json 의 retireLocal 스위치)
const http = require('http');

function pageHtml(cloudUrl) {
  return `<!DOCTYPE html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="4;url=${cloudUrl}">
<title>배송 도우미 — 새 주소로 이동</title>
<body style="font-family:'Malgun Gothic',sans-serif;text-align:center;padding-top:12vh;background:#f7f5f0;color:#222">
<div style="font-size:48px">📦</div>
<h2 style="margin:0.4em 0">이 컴퓨터의 배송 도우미는 이제 안 써요</h2>
<p style="font-size:18px;color:#555;line-height:1.6">모든 컴퓨터가 <b>하나의 클라우드 화면</b>을 같이 쓰도록 바뀌었어요.<br>잠시 후 자동으로 새 주소로 이동합니다. (즐겨찾기도 새 주소로 바꿔 주세요)</p>
<p><a href="${cloudUrl}" style="display:inline-block;margin-top:14px;padding:16px 40px;font-size:24px;background:#2f6f4f;color:#fff;border-radius:12px;text-decoration:none">새 화면 열기 →</a></p>
<p style="font-size:14px;color:#888;margin-top:30px">${cloudUrl}</p>
</body></html>`;
}

function start(cloud, port, host) {
  const cloudUrl = String(cloud && cloud.url || '').replace(/\/+$/, '');
  const server = http.createServer((req, res) => {
    const path = String(req.url || '/').split('?')[0];
    if (path === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('retired'); }
    if (path.startsWith('/api/')) {
      res.writeHead(410, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: '이 컴퓨터의 배송 도우미는 종료됐어요. 새 주소에서 써 주세요: ' + cloudUrl, retired: true, cloudUrl }));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(pageHtml(cloudUrl));
  });
  server.listen(port, host || '127.0.0.1', () => {
    console.log(`[retired] 로컬 배송 도우미는 은퇴했어요. 안내 페이지만 제공: http://127.0.0.1:${port} → ${cloudUrl}`);
  });
  return server;
}

module.exports = { start, pageHtml };
