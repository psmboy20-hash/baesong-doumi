
// ---------- 홈 ----------
function flowTile(icon, label, n, page, hot, sub) {
  return `
    <div class="flow-tile ${n ? (hot ? 'hot' : '') : 'zero'}" onclick="go('${page}'${sub ? `,'${sub}'` : ''})">
      <div class="f-icon">${icon}</div>
      <div class="f-num">${n}</div>
      <div class="f-label">${label}</div>
    </div>`;
}
function renderHome() {
  // 진행 흐름 보드: 물건이 지금 어느 단계에 몇 건 있는지
  const all = [...DB.orders, ...DB.seeding];
  const toSendItems = all.filter(x => x.status === '대기' || x.status === '접수중');
  const toSend = shipmentCount(toSendItems);
  // 3일 넘게 안 움직인 건 — 앱 밖에서 이미 보냈을 가능성을 먼저 물어본다
  const staleCount = shipmentCount(toSendItems.filter(x => x.regDate && (Date.now() - new Date(x.regDate)) / 86400000 >= 3));
  const waitPickup = shipmentCount(all.filter(x => HamItemLines.epostFilterMatches(x, 'pickup')));
  const problem = shipmentCount(all.filter(x => HamItemLines.epostFilterMatches(x, 'problem')));
  const delivered = shipmentCount(all.filter(x => x.status === '발송완료' && x.delivered));
  const moving = shipmentCount(all.filter(x => x.status === '발송완료' && !x.delivered && !(x.epost && ['00', '01', '02', '04'].includes(x.epost.stus || '01'))));
  const retActive = (DB.returns || []).filter(x => !['completed', 'canceled'].includes(x.flowState)).length;
  // 이번 달 통계: 발송 건수 / 택배비(우체국 접수 요금, 묶음당 1회) / 배달완료
  const _d = new Date();
  const ym = _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0');
  const sentThis = all.filter(x => x.status === '발송완료' && (x.sentDate || '').startsWith(ym));
  const sentThisCount = shipmentCount(sentThis);
  const sentProductQty = productQuantity(sentThis);
  const seenNo = new Set();
  let cost = 0;
  for (const x of sentThis) {
    if (x.epost && x.epost.orderNo && !seenNo.has(x.epost.orderNo)) {
      seenNo.add(x.epost.orderNo);
      cost += Number(x.epost.price) || 0;
    }
  }
  const dlvThis = shipmentCount(sentThis.filter(x => x.delivered));
  const retThis = (DB.returns || []).filter(x => (x.regDate || '').startsWith(ym) && x.status !== '취소됨').length;
  const lowStock = DB.inventory.filter(i => i.qty <= 2).length;
  const syncIssues = externalSyncIssues();
  // 처리가 필요한 것 허브 — 알림을 앱 안에서만 받기로 했으니, 사람이 봐야 할 일은 전부 여기 모은다
  const daysSince = d => d ? Math.floor((Date.now() - new Date(d)) / 86400000) : 0;
  const attention = [];
  for (const { item, issue } of syncIssues) attention.push({ icon: '🔌', page: 'shipping', who: item.name || item.orderNo || '배송건', what: ({ cafe24: '카페24', sheet: '구글시트', epost: '우체국' }[issue.system] || issue.system) + ' · ' + issue.message });
  for (const x of all) {
    if (x.status !== '발송완료' || x.delivered) continue;
    const d = daysSince(x.sentDate);
    if (x.epost && ['00', '01', '02'].includes(x.epost.stus) && d >= 3) attention.push({ icon: '📦', page: 'epost', who: x.name, what: `접수 ${d}일째인데 기사님이 아직 안 가져갔어요 — 상자가 매장에 있는지 확인` });
    else if (d >= 7) attention.push({ icon: '⏰', page: 'shipping', who: x.name, what: `보낸 지 ${d}일째 배달 확인이 안 돼요 — 받았다면 [배달 끝 처리]` });
    if (x.epostOp && ['pending', 'unknown'].includes(x.epostOp.state)) attention.push({ icon: '❓', page: 'epost', who: x.name, what: '우체국 접수 결과를 확인 중이에요 — [진행상태 새로고침]' });
  }
  for (const r of (DB.returns || [])) {
    if (r.status === '회수중' && daysSince(r.regDate) >= 7) attention.push({ icon: '🔁', page: 'returns', who: r.name, what: `회수 신청 ${daysSince(r.regDate)}일째 — 물건이 왔으면 [물건 도착 확인]` });
  }
  const syncIssueCard = attention.length ? `
    <div class="card" style="border:2px solid #f4b942;background:#fffaf0;margin-top:1rem">
      <div class="step-title">⚠️ 처리가 필요한 것 ${attention.length}건</div>
      ${attention.slice(0, 8).map(a => `<div class="mini-row" style="cursor:pointer" onclick="go('${a.page}')">
        <span>${a.icon}</span><span class="grow"><b>${esc(a.who)}</b> · <span class="muted">${esc(a.what)}</span></span><span class="muted">→</span>
      </div>`).join('')}
      ${attention.length > 8 ? `<div class="muted" style="font-size:0.9rem;margin-top:0.3rem">외 ${attention.length - 8}건</div>` : ''}
      <button class="big-btn" style="margin-top:0.8rem" onclick="doSync()">🔄 지금 다시 확인하기</button>
    </div>` : '';
  main().innerHTML = `
    <h1>안녕하세요! 👋</h1>
    <div class="sub">물건이 지금 어디까지 갔는지 한눈에 보여요. 칸을 누르면 그 화면으로 가요.</div>
    <div class="card">
      <div class="step-title">📊 지금 물건 흐름</div>
      <div class="flow-row">
        ${flowTile('📮', '보낼 준비', toSend, 'send', true)}
        <div class="flow-arrow">→</div>
        ${flowTile('📦', '우체국 픽업 대기중', waitPickup, 'epost', false, 'pickup')}
        <div class="flow-arrow">→</div>
        ${flowTile('🚚', '가는 중', moving, 'shipping', false, 'moving')}
        <div class="flow-arrow">→</div>
        ${flowTile('✅', '배달 끝', delivered, 'shipping', false, 'done')}
        <div class="flow-arrow" style="color:#e3e8f2">|</div>
        ${flowTile('🔁', '교환·반품', retActive, 'returns', true)}
        ${needPrintList().length ? `<div class="flow-arrow" style="color:#e3e8f2">|</div>${flowTile('🖨', '인쇄할 운송장', needPrintList().length, 'epost', true, 'print')}` : ''}
        ${problem ? `<div class="flow-arrow" style="color:#e3e8f2">|</div>${flowTile('⚠️', '기사님이 못 가져감', problem, 'epost', true, 'problem')}` : ''}
      </div>
      <div class="hint" style="margin:0.9rem 0 0; font-size:1.05rem">
        📅 <b>이번 달(${Number(ym.slice(5))}월)</b>: 보낸 택배 <b>${sentThisCount}건</b> · 상품 <b>${sentProductQty}개</b>
        · 택배비 <b>${cost.toLocaleString()}원</b> <span class="muted" style="font-size:0.85rem">(우체국 앱 접수 기준)</span>
        · 배달완료 <b>${dlvThis}건</b>${retThis ? ` · 교환/반품 <b>${retThis}건</b>` : ''}
      </div>
      ${staleCount ? `<div class="hint" style="margin:0.6rem 0 0;font-size:1.02rem;color:#b0640f">
        ⏰ <b>택배 ${staleCount}건</b>이 3일 넘게 [보낼 준비]에 그대로 있어요 — 우체국 사이트나 창구에서 <b>직접 보내셨다면</b> 앱은 몰라요.
        <button class="link-btn" onclick="go('send')">보내기에서 [따로 보냈어요] 누르기 →</button>
      </div>` : ''}
    </div>
    ${syncIssueCard}
    ${dashGrid(all)}
    <div class="card" style="margin-top:1rem">
      <details>
        <summary style="font-size:1.05rem;font-weight:800;cursor:pointer">💡 보내는 순서 (처음이면 펼쳐 보세요)</summary>
        <div class="hint" style="font-size:1.05rem;margin-top:0.6rem">
          ① 주문·시딩은 <b>5분마다 저절로</b> 들어와요<br>
          ② [📮 보내기]에서 <b>[🚀 우체국 바로 접수]</b> — 송장번호가 즉시 발급돼요<br>
          ③ [📦 우체국 접수]에서 <b>[🖨 운송장 인쇄]</b> — 라벨기에서 뽑아 상자에 붙여요<br>
          ④ 끝! 카페24 배송처리·재고 차감·구글시트 기록은 저절로 됩니다
        </div>
      </details>
    </div>`;
}

// ---------- 대시보드 (채널별 현황 · 추이 · 재고 · 교환반품 · 입출고 · 연동) ----------
function dashGrid(all) {
  const ym = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
  // 채널 구분: 앞으로 29CM·무신사 등이 여기에 늘어난다
  const tagged = [...DB.orders, ...DB.seeding];
  const channelName = x => ({ cafe24: '카페24', seeding: '시딩', exchange: '교환 재발송', direct: '직접 등록', '29cm': '29CM', musinsa: '무신사', other: '기타 채널' }[x.sourceChannel] || '직접 등록');
  // 아직 주문이 없는 외부 채널은 '연결 준비 중'으로만 보여주고, 엑셀로 주문이 들어오기 시작하면 정식 줄로 올라온다
  const extraChans = ['29CM', '무신사', '기타 채널'].filter(c => tagged.some(x => channelName(x) === c));
  const soonChans = ['29CM', '무신사'].filter(c => !extraChans.includes(c));
  const chans = ['카페24', '시딩', '교환 재발송', '직접 등록', '혼합 합포장', ...extraChans];
  const c24ok = SYNC_STATUS && SYNC_STATUS.cafe24 && SYNC_STATUS.cafe24.ok;
  const gooOk = SYNC_STATUS && SYNC_STATUS.google && SYNC_STATUS.google.ok;
  const epOk = SYNC_STATUS && SYNC_STATUS.epost && SYNC_STATUS.epost.connected;
  const chanDot = { '카페24': c24ok ? 'on' : 'off', '시딩': gooOk ? 'on' : 'off', '교환 재발송': 'na', '직접 등록': 'na', '혼합 합포장': 'na' };
  const channelOfGroup = group => {
    const sources = new Set(group.map(channelName));
    if (sources.has('카페24') && sources.has('직접 등록') && sources.size === 2) return '카페24';
    if (sources.has('시딩') && sources.has('직접 등록') && sources.size === 2) return '시딩';
    return sources.size === 1 ? [...sources][0] : '혼합 합포장';
  };
  const waitingGroups = shipmentGroups(tagged.filter(x => x.status === '대기' || x.status === '접수중'));
  const sentGroups = shipmentGroups(tagged.filter(x => x.status === '발송완료' && (x.sentDate || '').startsWith(ym)));
  const chanRows = chans.map(c => {
    const waiting = waitingGroups.filter(g => channelOfGroup(g) === c).flat();
    const sentItems = sentGroups.filter(g => channelOfGroup(g) === c).flat();
    const wait = shipmentCount(waiting);
    const sent = shipmentCount(sentItems);
    const sentQty = productQuantity(sentItems);
    return `<div class="chan-row">
      <span class="dot ${chanDot[c]}"></span><span class="cname">${c}</span>
      <span class="cstat">${wait ? `<b style="color:#b0640f">보낼 택배 ${wait}건</b> · ` : ''}이달 <b>택배 ${sent}건</b> · 상품 ${sentQty}개</span>
    </div>`;
  }).join('');
  // 7일 발송 추이
  const days = [...Array(7)].map((_, k) => {
    const d = new Date(Date.now() - (6 - k) * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  });
  const cnt = days.map(d => shipmentCount(all.filter(x => x.status === '발송완료' && x.sentDate === d)));
  const mx = Math.max(...cnt, 1);
  const bars = days.map((d, k) => `
    <div class="vbar ${k === 6 ? 'today' : ''}">
      <div class="v">${cnt[k] || ''}</div>
      <div class="bar" style="height:${Math.round(cnt[k] / mx * 62)}px"></div>
      <div class="d">${Number(d.slice(5, 7))}/${Number(d.slice(8))}</div>
    </div>`).join('');
  // 재고 경고: 1~2개 남은 것 우선, 그다음 0개
  const low = DB.inventory.filter(i => i.qty > 0 && i.qty <= 2).slice(0, 6);
  const zero = DB.inventory.filter(i => i.qty === 0).length;
  const lowRows = low.map(i => `<div class="mini-row"><span class="grow">${esc(i.name)}${i.size ? ` <b>${esc(i.size)}</b>` : ''}</span><b style="color:var(--red)">${i.qty}개</b></div>`).join('');
  // 교환/반품 진행 중
  const rets = (DB.returns || []).filter(x => !['completed', 'canceled'].includes(x.flowState)).slice(0, 5);
  const retRows = rets.map(x => {
    const [cls, label] = RMA_FLOW[x.flowState] || ['wait', x.status || '확인'];
    return `<div class="mini-row"><span>${x.kind === '교환' ? '🔄' : '↩️'}</span><span class="grow"><b>${esc(x.name)}</b> ${esc(productParts(x).name.replace(/<[^>]*>/g, '').slice(0, 24))}</span><span class="chip ${cls}">${label}</span></div>`;
  }).join('');
  // 최근 입출고
  const logs = (DB.stockLog || []).slice(-5).reverse();
  const logRows = logs.map(e => `<div class="mini-row"><span>${e.delta < 0 ? '📤' : '📥'}</span><span class="grow">${esc(e.name)}${e.size ? ` <b>${esc(e.size)}</b>` : ''}${e.ref ? ` <span class="muted">→ ${esc(e.ref)}</span>` : ''}</span><b style="color:${e.delta < 0 ? '#c0392b' : '#1e7e46'}">${e.delta > 0 ? '+' : ''}${e.delta}</b></div>`).join('');
  return `
  <div class="dash-grid">
    <div class="card">
      <div class="dash-title">🛒 판매 채널 <button class="link-btn more" onclick="go('send')">보내기 →</button></div>
      ${chanRows}
      ${soonChans.map(c => `<div class="chan-row soon" title="[보내기] 아래 '다른 판매채널 주문 엑셀 넣기'로 주문을 넣으면 여기에 집계돼요"><span class="dot na"></span><span class="cname">${c}</span><span class="cstat muted">엑셀로 넣기 가능</span></div>`).join('')}
    </div>
    <div class="card">
      <div class="dash-title">📈 최근 7일 택배 발송</div>
      <div class="vbar-wrap">${bars}</div>
    </div>
    <div class="card">
      <div class="dash-title">📋 재고 경고 <button class="link-btn more" onclick="go('inventory')">재고 →</button></div>
      ${lowRows || '<div class="muted" style="font-size:0.92rem;padding:0.3rem 0">1~2개 남은 제품이 없어요.</div>'}
      ${zero ? `<div class="mini-row"><span class="grow muted">0개(수량 미입력 포함)</span><b>${zero}종</b></div>` : ''}
    </div>
    <div class="card">
      <div class="dash-title">🔁 교환/반품 진행 중 <button class="link-btn more" onclick="go('returns')">전체 →</button></div>
      ${retRows || '<div class="muted" style="font-size:0.92rem;padding:0.3rem 0">진행 중인 건이 없어요. ✓</div>'}
    </div>
    <div class="card">
      <div class="dash-title">📜 최근 입출고 <button class="link-btn more" onclick="go('stocklog')">전체 →</button></div>
      ${logRows || '<div class="muted" style="font-size:0.92rem;padding:0.3rem 0">아직 기록이 없어요.</div>'}
    </div>
    <div class="card">
      <div class="dash-title">🔌 연동 상태</div>
      <div class="chan-row"><span class="dot ${c24ok ? 'on' : 'off'}"></span><span class="cname">카페24</span><span class="cstat">${c24ok ? '정상' : '확인 필요'}</span></div>
      <div class="chan-row"><span class="dot ${gooOk ? 'on' : 'off'}"></span><span class="cname">구글시트</span><span class="cstat">${gooOk ? '정상' : '확인 필요'}</span></div>
      <div class="chan-row"><span class="dot ${epOk ? 'on' : 'off'}"></span><span class="cname">우체국</span><span class="cstat">${epOk ? '정상' : '확인 필요'}</span></div>
      <div class="chan-row"><span class="dot on"></span><span class="cname">클라우드 서버</span><span class="cstat">24시간 가동</span></div>
    </div>
  </div>`;
}
