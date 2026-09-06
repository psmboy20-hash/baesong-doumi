
// ---------- 처음 (오늘 할 일 + 숫자 4개 + 연결 상태 + 도움말) ----------
function fmtDeadline(hhmm) {
  const parts = String(hhmm || '').split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1] || 0);
  if (!Number.isFinite(h)) return '';
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = ((h + 11) % 12) + 1;
  return `${ampm} ${h12}시${m ? ' ' + m + '분' : ''}`;
}
function todoRow(iconName, tone, title, sub, actionHtml) {
  return `<div class="row">
    <div class="ic ${tone}">${icon(iconName, 18)}</div>
    <div><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>
    ${actionHtml || ''}
  </div>`;
}
function renderHome() {
  const all = [...DB.orders, ...DB.seeding];
  const daysSince = d => d ? Math.floor((Date.now() - new Date(d)) / 86400000) : 0;

  // 오늘 할 일 계산 — 기존 renderHome/dashGrid가 쓰던 값을 그대로 재사용
  const toSendItems = all.filter(x => x.status === '대기' || x.status === '접수중');
  const toSendGroups = shipmentGroups(toSendItems);
  const toSend = toSendGroups.length;
  const toSendQty = productQuantity(toSendItems);
  const waitPickup = shipmentCount(all.filter(x => HamItemLines.epostFilterMatches(x, 'pickup')));
  const notPickedUp = shipmentCount(all.filter(x => HamItemLines.epostFilterMatches(x, 'problem')));
  const moving = shipmentCount(all.filter(x => x.status === '발송완료' && !x.delivered && !(x.epost && ['00', '01', '02', '04'].includes(x.epost.stus || '01'))));
  const overdueUnconfirmed = shipmentCount(all.filter(x => x.status === '발송완료' && !x.delivered && daysSince(x.sentDate) >= 7));
  const epostOpPending = shipmentCount(all.filter(x => epostOperationUnresolved(x)));
  // 실물재고를 아직 한 번도 입력하지 않았으면(합계 0) "부족 145개" 같은 헛경고 대신 시작 안내를 띄운다
  const activeInv = (DB.inventory || []).filter(i => !i.retiredAggregate);
  const physicalTotal = activeInv.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const stockNotStarted = activeInv.length > 0 && physicalTotal === 0 && !(DB.stocktakes || []).length;
  const minOf = i => i.minQty != null ? Number(i.minQty) : (Number(i.cafe24SafetyInventory) > 0 ? Number(i.cafe24SafetyInventory) : 2);
  const lowStockItems = stockNotStarted ? [] : activeInv.filter(i => !i.needsCount && (Number(i.qty) || 0) <= minOf(i));
  const retActive = (DB.returns || []).filter(x => !['completed', 'canceled'].includes(x.flowState)).length;
  const syncIssues = externalSyncIssues();

  // 이번 달 통계
  const _d = new Date();
  const ym = _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0');
  const sentThis = all.filter(x => x.status === '발송완료' && (x.sentDate || '').startsWith(ym));
  const sentThisCount = shipmentCount(sentThis);
  const sentProductQty = productQuantity(sentThis);
  const dlvThis = shipmentCount(sentThis.filter(x => x.delivered));
  const seenNo = new Set();
  let cost = 0;
  for (const x of sentThis) {
    if (x.epost && x.epost.orderNo && !seenNo.has(x.epost.orderNo)) {
      seenNo.add(x.epost.orderNo);
      cost += Number(x.epost.price) || 0;
    }
  }

  // 오늘 할 일 목록 (있는 것만)
  const rows = [];
  if (toSend > 0) {
    const first = toSendGroups[0] ? toSendGroups[0][0] : null;
    const sub = first ? (toSendGroups.length > 1 ? `${esc(first.name)} 외 ${toSendGroups.length - 1}건` : esc(first.name)) : '';
    rows.push(todoRow('send', 'b', `보낼 택배 ${toSend}건 (상품 ${toSendQty}개)`, sub,
      btn({ label: '우체국 접수하기', onclick: "go('send')", kind: 'primary' })));
  }
  if (notPickedUp > 0) {
    rows.push(todoRow('post', 'w', `미집하 ${notPickedUp}건`, '우체국 접수 후 3일 넘게 기사님이 못 가져갔어요',
      btn({ label: '우체국 접수 열기', onclick: "go('epost','problem')" })));
  }
  if (overdueUnconfirmed > 0) {
    rows.push(todoRow('clock', 'w', `배달 확인이 안 된 택배 ${overdueUnconfirmed}건`, '받았으면 [배달 끝 처리]로 옮겨 주세요',
      btn({ label: '배송 확인 열기', onclick: "go('shipping','moving')" })));
  }
  if (stockNotStarted) {
    rows.push(todoRow('box', 'b', '실물재고를 아직 입력하지 않았어요', '카페24 수량을 기초재고로 가져오면 바로 시작할 수 있어요',
      btn({ label: '재고 시작하기', onclick: "go('inventory')" })));
  }
  if (lowStockItems.length > 0) {
    const names = lowStockItems.slice(0, 2).map(i => esc(i.name) + (i.size ? ' ' + esc(i.size) : '')).join(' · ');
    rows.push(todoRow('alert', 'r', `재고 부족 ${lowStockItems.length}개 옵션`, names + (lowStockItems.length > 2 ? ' 외' : ''),
      btn({ label: '재고 보기', onclick: "window._invFilter='low';go('inventory')" })));
  }
  if (retActive > 0) {
    rows.push(todoRow('refresh', 'w', `교환/반품 진행 중 ${retActive}건`, '',
      btn({ label: '교환/반품 열기', onclick: "go('returns')" })));
  }
  if (epostOpPending > 0) {
    rows.push(todoRow('post', 'w', `우체국 접수 확인 중 ${epostOpPending}건`, '',
      btn({ label: '우체국 접수 열기', onclick: "go('epost')" })));
  }
  if (syncIssues.length > 0) {
    const first = syncIssues[0];
    const sysName = { cafe24: '카페24', sheet: '구글시트', epost: '우체국' }[first.issue.system] || first.issue.system;
    rows.push(todoRow('alert', 'r', `연동 오류 ${syncIssues.length}건`, `${esc(sysName)} · ${esc(first.issue.message)}`,
      btn({ label: '확인하기', onclick: "go('shipping')" })));
  }
  const todoCard = rows.length
    ? `<div class="card"><div class="todo">${rows.join('')}</div></div>`
    : `<div class="card">${emptyState({ icon: 'check', title: '오늘 할 일이 없어요', sub: '지금은 처리할 게 없어요.' })}</div>`;

  const wd = ['일', '월', '화', '수', '목', '금', '토'][_d.getDay()];
  const dl = DB.settings && DB.settings.pickupDeadline;
  const dlStr = dl ? ` · 우체국 방문수거 ${fmtDeadline(dl)}` : '';
  const header = pageHeader({
    title: '오늘 할 일',
    sub: esc(`${_d.getMonth() + 1}월 ${_d.getDate()}일 ${wd}요일`) + dlStr,
    actions: btn({ label: '지금 다시 확인', onclick: 'doSync()', icon: 'refresh' })
  });

  const kpis = kpiStrip([
    { label: '보낼 준비', value: toSend, unit: '건', tone: toSend > 0 ? 'hot' : '', onclick: "go('send')" },
    { label: '수거 기다림', value: waitPickup, unit: '건', onclick: "go('epost','pickup')" },
    { label: '가는 중', value: moving, unit: '건', onclick: "go('shipping','moving')" },
    { label: '이달 배달 끝', value: dlvThis, unit: '건', onclick: "go('shipping','done')" }
  ]);
  const monthLine = `<div class="hint" style="margin:-4px 0 16px">이번 달(${Number(ym.slice(5))}월) 보낸 택배 <b>${sentThisCount}건</b> · 상품 <b>${sentProductQty}개</b> · 택배비 <b>${cost.toLocaleString()}원</b></div>`;

  const c24ok = SYNC_STATUS && SYNC_STATUS.cafe24 && SYNC_STATUS.cafe24.ok;
  const gooOk = SYNC_STATUS && SYNC_STATUS.google && SYNC_STATUS.google.ok;
  const epOk = SYNC_STATUS && SYNC_STATUS.epost && SYNC_STATUS.epost.connected;
  const connRow = (ok, label) => `<span>${chipEl(ok ? 'ok' : 'bad', ok ? '정상' : '확인 필요')}&nbsp; ${esc(label)}</span>`;
  const connCard = `<div class="card">
    <div class="step-title">연결 상태 <button class="link-btn" style="margin-left:auto" onclick="go('settings')">설정</button></div>
    <div style="display:flex;gap:22px;flex-wrap:wrap;font-size:15px">
      ${connRow(c24ok, '카페24 주문')}
      ${connRow(gooOk, '구글시트 시딩')}
      ${connRow(epOk, '우체국 접수')}
      ${connRow(true, '클라우드 서버')}
    </div>
  </div>`;

  const guideCard = `<div class="card">
    <details>
      <summary style="font-size:15px;font-weight:700;cursor:pointer">보내는 순서 (처음이면 펼쳐 보세요)</summary>
      <div class="hint" style="margin-top:0.6rem">
        ① 주문·시딩은 <b>5분마다 저절로</b> 들어와요<br>
        ② [보내기]에서 <b>[우체국 바로 접수]</b> — 송장번호가 즉시 발급돼요<br>
        ③ [우체국 접수]에서 <b>[운송장 인쇄]</b> — 라벨기에서 뽑아 상자에 붙여요<br>
        ④ 끝. 카페24 배송처리·재고 차감·구글시트 기록은 저절로 됩니다
      </div>
    </details>
  </div>`;

  main().innerHTML = header + todoCard + kpis + monthLine + connCard + guideCard;
}
