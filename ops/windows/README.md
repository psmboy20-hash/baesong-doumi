# 윈도우 노트북을 메인 서버로 (2026-11-12)

- 위치: `C:\srv\ham` (이 저장소 clone), 장부 `C:\srv\ham\data`, 운영 파일 `C:\srv\ham-ops`, 로그 `C:\srv\logs\ham.log`, `ham-update.log`
- 작업 스케줄러: `ham-server`(부팅 때 시작, `ham-runner.mjs`가 server.js를 HAM_CLOUD_WRITER=1로 돌리고 죽으면 다시 켬), `ham-update`(10분마다 `ham-update.ps1`, 맥의 update.sh와 같은 순서)
- 바깥 주소: `tailscale funnel --bg 8899` → https://jellly.tail68ac1d.ts.net (Tailscale은 unattended로 켜 둠)
- 서버만 다시 켜기: `C:\srv\ham-ops\restart.request` 파일의 수정 시각을 바꾼다
- 메인 서버는 항상 한 대만. 다른 컴퓨터에서 HAM_CLOUD_WRITER=1로 켜지 말 것 (카페24 연결이 갈라짐)
