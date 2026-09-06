
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
    main().innerHTML = `<div class="result-box err" style="margin-top:3rem; font-size:1.2rem">⚠️ ${esc(DB.error)}<br><br>
      <button class="big-btn" onclick="location.reload()">🔄 다시 시도</button></div>`;
    return;
  }
  await refreshStatus(false);
  go('home');
  setInterval(() => refreshStatus(false), 30 * 1000);
  deadlineCheck();
  setInterval(deadlineCheck, 60 * 1000);
})();
