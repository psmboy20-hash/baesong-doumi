
// ---------- 시작 ----------
window.addEventListener('message', async event => {
  if (event.origin !== location.origin || !event.data || event.data.type !== 'ham-label-printed') return;
  adoptDb(await api('/api/db'));
  render();
  toast(`인쇄 완료를 택배 ${Number(event.data.parcels) || 0}건에 기록했어요.`);
});

(async function init() {
  DB = await api('/api/db');
  if (DB && DB.error) {
    main().innerHTML = `<div class="result-box err" style="margin-top:3rem; font-size:1.1rem">${icon('alert', 20)} ${esc(DB.error)}<br><br>
      ${btn({ label: '다시 시도', onclick: 'location.reload()', kind: 'primary', icon: 'refresh' })}</div>`;
    return;
  }
  await refreshStatus(false);
  go('home');
  setInterval(() => refreshStatus(false), 30 * 1000);
  deadlineCheck();
  setInterval(deadlineCheck, 60 * 1000);
})();
