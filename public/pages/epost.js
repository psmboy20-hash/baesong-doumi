
// ---------- 우체국 접수 현황 ----------
// 우체국 처리코드 → 쉬운 말 (발송용)
const EPOST_STUS = { '00': ['processing', '접수 준비중'], '01': ['processing', '접수됨 ✓'], '02': ['processing', '접수됨 · 🖨 인쇄하세요'], '03': ['done', '기사님이 가져감 ✓'], '04': ['wait', '⚠️ 아직 못 가져감'], '05': ['wait', '취소됨 ✕'] };
// 회수(교환/반품)용 — 기사님이 고객 집으로 가는 방향
const RET_STUS = { '00': ['processing', '회수 준비중'], '01': ['processing', '기사님 방문 예정'], '02': ['processing', '기사님 방문 예정'], '03': ['done', '물건 가져옴 ✓'], '04': ['wait', '⚠️ 아직 못 가져옴'], '05': ['wait', '취소됨 ✕'] };
function renderEpost() {
  const allItems = [
    ...DB.orders.filter(x => x.epost).map(x => ({ kind: 'order', icon: '🛒', x })),
    ...DB.seeding.filter(x => x.epost).map(x => ({ kind: 'seeding', icon: '🎁', x }))
  ].sort((a, b) => {
    // 인쇄 안 한 것 먼저, 그 다음 최신순
    const ap = !a.x.printed ? 0 : 1;
    const bp = !b.x.printed ? 0 : 1;
    return ap - bp || (b.x.sentDate || '').localeCompare(a.x.sentDate || '');
  });
  const filter = window._epostFilter || 'all';
  const items = allItems.filter(entry => HamItemLines.epostFilterMatches(entry.x, filter));
  const filterCounts = {
    all: shipmentCount(allItems, entry => entry.x),
    pickup: shipmentCount(allItems.filter(entry => HamItemLines.epostFilterMatches(entry.x, 'pickup')), entry => entry.x),
    print: shipmentCount(allItems.filter(entry => HamItemLines.epostFilterMatches(entry.x, 'print')), entry => entry.x),
    problem: shipmentCount(allItems.filter(entry => HamItemLines.epostFilterMatches(entry.x, 'problem')), entry => entry.x)
  };
  const filterLabel = { all: '전체 접수', pickup: '우체국 픽업 대기중', print: '인쇄 필요', problem: '확인 필요' }[filter] || '전체 접수';
  const filterButton = (key, label) => `<button class="big-btn ${filter === key ? '' : 'gray'}" onclick="go('epost','${key}')">${label} ${filterCounts[key]}건</button>`;
  const parcels = shipmentGroups(items, entry => entry.x);
  const rows = parcels.map(group => {
    const { kind, x } = group[0];
    const printSpec = group.map(entry => entry.kind + ':' + entry.x.id).join(',');
    const kinds = [...new Set(group.map(entry => entry.kind === 'seeding' ? seedingSourceLabel(entry.x) : '🛒 주문'))].join('<br>');
    const products = group.map(entry => `<div>${productParts(entry.x).name}</div>`).join('');
    const options = group.map(entry => `<div>${productParts(entry.x).opt || '<span class="muted">-</span>'}</div>`).join('');
    const notes = group.map(entry => shipmentMemoHtml(entry.x)).filter(Boolean).join('');
    const [cls, nm] = x.delivered ? ['done', '배달완료 ✓✓'] : (EPOST_STUS[x.epost.stus] || ['processing', '확인 필요']);
    const cancelable = !x.delivered && ['00', '01', '02'].includes(x.epost.stus || '01');
    return `
    <tr>
      <td style="white-space:nowrap">${kinds}</td>
      <td><b>${esc(x.name)}</b></td>
      <td style="min-width:220px;max-width:440px">${products}</td>
      <td>${options}</td>
      <td style="min-width:180px;max-width:300px">${notes || '<span class="muted">-</span>'}</td>
      <td style="max-width:150px">${x.invoice ? invoiceCell(x.invoice) : '<span class="muted">-</span>'}</td>
      <td><span class="chip ${cls}">${nm}</span></td>
      <td style="white-space:nowrap">${esc(x.sentDate || '')}</td>
      <td style="white-space:nowrap">
        ${x.epost.label
          ? (x.printed
            ? `<span class="chip done" style="font-size:0.85rem">🖨 인쇄함 ✓</span> <button class="link-btn" style="font-size:0.9rem" onclick="printLabels('${printSpec}')">다시 인쇄</button>`
            : `<button class="link-btn" style="font-weight:800" onclick="printLabels('${printSpec}')">🖨 운송장 인쇄</button>`)
          : (x.printed
            ? `<span class="chip done" style="font-size:0.85rem">🖨 사이트 인쇄함 ✓</span>`
            : `<button class="link-btn" onclick="epostSitePrint()" title="이 건은 우체국 사이트에서 출력">🖨 사이트에서 출력</button>
               <button class="link-btn" style="font-weight:800" onclick="confirmSitePrinted('${printSpec}','${jsq(x.name)}')">✓ 인쇄 확인</button>`)}
        ${cancelable ? `<button class="link-btn" style="color:var(--red)" onclick="epostCancel('${kind}',${x.id},'${jsq(x.name)}')">취소</button>` : ''}
      </td>
    </tr>`;
  }).join('');
  const parcelSpec = group => group.map(entry => entry.kind + ':' + entry.x.id).join(',');
  const needP = parcels.filter(group => group[0].x.epost.label && group.some(entry => !entry.x.printed)).map(parcelSpec);
  const needSite = parcels.filter(group => !group[0].x.epost.label && group.some(entry => !entry.x.printed)).map(parcelSpec);
  const printable = parcels.filter(group => group[0].x.epost.label).map(parcelSpec);
  main().innerHTML = `
    <h1>📦 우체국 접수</h1>
    <div class="sub"><b>${filterLabel} ${parcels.length}건</b>을 보고 있어요. 순서: <b>① 접수</b> → <b>② [🖨 인쇄]로 운송장 출력</b> → <b>③ 상자에 붙이면 기사님이 픽업</b></div>
    <div style="display:flex; gap:0.55rem; flex-wrap:wrap; margin-bottom:0.8rem">
      ${filterButton('all', '전체')}
      ${filterButton('pickup', '우체국 픽업 대기중')}
      ${filterButton('print', '인쇄 필요')}
      ${filterButton('problem', '확인 필요')}
    </div>
    <div style="display:flex; gap:0.8rem; flex-wrap:wrap; margin-bottom:1.2rem">
      <button class="big-btn" onclick="epostRefresh()">🔄 진행상태 새로고침</button>
      ${needP.length ? `<button class="big-btn green" onclick="printLabels('${needP.join(',')}')">🖨 안 뽑은 운송장 ${needP.length}장 인쇄</button>` : ''}
      ${needSite.length ? `<button class="big-btn gray" onclick="epostSitePrint()">🖨 사이트 출력 필요한 운송장 ${needSite.length}장</button>` : ''}
      ${printable.length && printable.length !== needP.length ? `<button class="big-btn gray" onclick="printLabels('${printable.join(',')}')">전체 다시 인쇄 (${printable.length}장)</button>` : ''}
      <button class="big-btn gray" onclick="epostSitePrint()">🖨 우체국 사이트에서 출력 (오즈뷰어)</button>
    </div>
    <div class="card">
      ${parcels.length ? `
      <div class="table-wrap" style="max-height:65vh">
        <table>
          <thead><tr><th>구분</th><th>이름</th><th>제품</th><th>옵션</th><th>포장·비고</th><th>송장번호</th><th>진행상태</th><th>접수일</th><th>인쇄·취소</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="hint" style="margin-top:0.8rem">· 운송장은 <b>[🖨 운송장 인쇄]</b>로 라벨기에서 바로 뽑는 게 기본이에요<br>· 우체국 사이트(오즈뷰어)로 뽑으려면: <b>[🖨 우체국 사이트에서 출력]</b> → 로그인 → <b>계약소포 → 신청정보등록 → [라벨인쇄]</b> — 앱에서 접수한 건들이 거기 목록에 그대로 떠 있어요<br>· <b>[취소]</b>는 기사님이 가져가기 전까지 할 수 있어요 — 취소 버튼이 보이면 아직 가능해요. 취소하면 [보내기] 목록으로 돌아갑니다</div>
      ` : `<div class="hint" style="font-size:1.1rem"><b>${filterLabel}</b>에 해당하는 택배가 없어요.${filter === 'all' ? '<br>[📮 보내기]에서 <b>[🚀 우체국 바로 접수]</b>를 누르면 여기에 나타납니다.' : '<br><button class="link-btn" onclick="go(\'epost\',\'all\')">전체 접수 목록 보기</button>'}</div>`}
    </div>
    <div id="epost-page-result"></div>`;
}
// 우체국 사이트(오즈뷰어)로 출력: 사이트를 열고, 앱 화면에 따라할 순서를 크게 보여줌
function epostSitePrint() {
  window.open('https://biz.epost.go.kr', '_blank');
  const box = $('#epost-page-result');
  if (box) {
    box.innerHTML = `<div class="result-box warn" style="font-weight:400; line-height:1.9">
      <div class="big">🖨 우체국 사이트에서 운송장 출력 — 이 순서대로 하세요</div>
      ① 방금 열린 우체국 화면에서 <b>로그인</b> (아이디: <b>${esc(DB.settings.epostMemberId || '')}</b>)<br>
      ② 위쪽 메뉴에서 <b>[계약소포]</b> 클릭<br>
      ③ 왼쪽 메뉴에서 <b>[소포신청] → [신청정보등록]</b> 클릭<br>
      ④ 오늘 날짜로 <b>[조회]</b> — 앱에서 접수한 건들이 목록에 보여요<br>
      ⑤ 출력할 건에 <b>체크</b> → <b>[라벨인쇄]</b> 버튼 클릭<br>
      ⑥ 오즈뷰어 창이 뜨면 <b>[인쇄]</b> — 끝!<br>
      <span class="muted" style="font-size:0.95rem">화면이 다르거나 막히면 우체국 고객센터 ☎ 1588-1300</span>
    </div>`;
    box.scrollIntoView({ behavior: 'smooth' });
  }
}
function printLabels(sel) {
  const opened = window.open('/label.html?print=1&sel=' + encodeURIComponent(sel), '_blank');
  if (!opened) toast('팝업이 막혀 라벨 창을 열지 못했어요. 주소창 오른쪽에서 팝업을 허용해 주세요.', 7000);
}
async function confirmSitePrinted(sel, name) {
  if (!confirm(`${name}님 운송장을 우체국 사이트(오즈뷰어)에서 실제로 인쇄했나요?`)) return;
  const selected = String(sel || '').split(',').filter(Boolean).map(value => {
    const [type, id] = value.split(':');
    return { type: type === 'seeding' ? 'seeding' : 'order', id: Number(id) };
  });
  const result = await api('/api/labels/printed', {
    method: 'POST',
    body: JSON.stringify({ selected })
  });
  if (result.error) {
    toast('인쇄 확인을 장부에 기록하지 못했어요. 잠시 뒤 다시 눌러 주세요.', 6000);
    return;
  }
  adoptDb(result.db);
  render();
  toast(`택배 ${result.parcels}건을 인쇄 완료로 기록했어요.`);
}
// 인쇄가 필요한(접수됐는데 아직 안 뽑은) 건 수
function needPrintList() {
  const items = [
    ...DB.orders.filter(x => HamItemLines.epostFilterMatches(x, 'print')).map(x => ({ kind: 'order', x })),
    ...DB.seeding.filter(x => HamItemLines.epostFilterMatches(x, 'print')).map(x => ({ kind: 'seeding', x }))
  ];
  return shipmentGroups(items, entry => entry.x).map(group => group[0]);
}
function updateNavBadge() {
  const n = DB ? needPrintList().length : 0;
  const btn = document.querySelector('nav button[data-page="epost"]');
  if (!btn) return;
  let b = btn.querySelector('.nav-badge');
  if (n > 0) {
    if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; btn.appendChild(b); }
    b.textContent = n;
  } else if (b) b.remove();
}
async function epostRefresh() {
  busy(true, '우체국에서 진행상태를 확인하는 중…');
  const r = await api('/api/epost/status', { method: 'POST' });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  adoptDb(r.db);
  render();
  toast(`✔️ ${r.refreshed}건 상태를 새로 확인했어요.` + (r.recovered ? ` 불확실했던 접수 ${r.recovered}건도 찾았어요.` : '') + (r.released ? ` 우체국에 접수되지 않은 ${r.released}건은 다시 선택할 수 있게 풀었어요.` : '') + (r.errors && r.errors.length ? ' 일부는 아직 확인 중이에요.' : ''), 6000);
}
async function epostCancel(kind, id, name) {
  if (!confirm(`${name}님의 우체국 접수를 정말 취소할까요?\n\n· 발급된 송장번호는 무효가 돼요\n· 이 건은 [보내기] 목록으로 되돌아가요\n· 뺐던 재고도 다시 채워져요`)) return;
  busy(true, '우체국 접수를 취소하는 중…');
  const r = await api('/api/epost/cancel', { method: 'POST', body: JSON.stringify({ type: kind, id }) });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 8000); return; }
  adoptDb(r.db);
  render();
  toast('✔️ 접수를 취소했어요. [보내기] 목록으로 돌아갔습니다.', 6000);
  if (r.warning) setTimeout(() => alert('⚠️ ' + r.warning), 300);
}
