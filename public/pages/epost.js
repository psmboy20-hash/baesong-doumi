
// ---------- 출고 현황 ----------
// 회수(교환/반품)용 — 기사님이 고객 집으로 가는 방향 (returns.js가 이 상수를 그대로 참조한다)
const RET_STUS = { '00': ['processing', '회수 준비중'], '01': ['processing', '기사님 방문 예정'], '02': ['processing', '기사님 방문 예정'], '03': ['done', '물건 가져옴'], '04': ['wait', '아직 못 가져옴'], '05': ['wait', '취소됨'] };

// 우체국 처리코드 + 인쇄 여부 → 쉬운 말 (발송용). 인쇄가 됐는지는 우체국 코드와 별개 축이라 먼저 확인한다.
function epostStatusOf(x) {
  if (x.delivered) return ['done', '배달완료'];
  const stus = x.epost.stus || '01';
  if (stus === '03') return ['done', '수거됨'];
  if (stus === '04') return ['bad', '수거 안 됨 · 확인'];
  if (stus === '05') return ['idle', '취소됨'];
  if (x.printed) return ['processing', '출력됨 · 수거 대기'];
  if (stus === '02') return ['warn', '운송장 출력 대기'];
  if (stus === '00' || stus === '01') return ['processing', '접수됨'];
  return ['processing', '확인 필요'];
}

// ---------- 오늘 쌀 목록 (우체국 접수됐고 아직 안 걷어간 택배) ----------
function todayPickTargets() {
  const inPickStage = x => x.epost && !x.delivered && ['00', '01', '02', '04'].includes(x.epost.stus || '01');
  return [
    ...DB.orders.filter(inPickStage).map(x => ({ type: 'order', kind: 'orders', x })),
    ...DB.seeding.filter(inPickStage).map(x => ({ type: 'seeding', kind: 'seeding', x }))
  ];
}
function todayPickAggregate(targets) {
  const agg = new Map();
  for (const { x } of targets) {
    for (const line of shipmentLineItems(x)) {
      const { color, size } = parseOption(line);
      const qty = Number(line.qty) || 1;
      const matches = matchProducts(line.product);
      if (matches.length) {
        for (const p of matches) {
          const sc = splitColor(p.name);
          const finalColor = sc.color || color;
          const key = p.no + '|' + finalColor + '|' + size;
          if (!agg.has(key)) agg.set(key, { img: p.img, name: sc.base, color: finalColor, size, qty: 0 });
          agg.get(key).qty += qty;
        }
      } else {
        const key = 'raw|' + lettersOnly(line.product) + '|' + color + '|' + size;
        if (!agg.has(key)) agg.set(key, { img: '', name: line.product || '(제품명 없음)', color, size, qty: 0 });
        agg.get(key).qty += qty;
      }
    }
  }
  return [...agg.values()].sort((a, b) => b.qty - a.qty);
}
function pickSummaryTableHtml(rows) {
  if (!rows.length) return `<div class="muted" style="padding:1rem">꺼낼 제품이 없어요.</div>`;
  const total = rows.reduce((s, r) => s + r.qty, 0);
  const body = rows.map(r => `
    <tr>
      <td>${r.img ? prodImgTag(r.img) : ''}</td>
      <td><b>${esc(r.name)}</b></td>
      <td>${esc(r.color || '-')}</td>
      <td>${esc(r.size || '-')}</td>
      <td class="num">${r.qty}</td>
    </tr>`).join('');
  return `<table class="tbl">
    <thead><tr><th></th><th>상품</th><th>컬러</th><th>사이즈</th><th>개수</th></tr></thead>
    <tbody>${body}<tr><td colspan="4" style="text-align:right;font-weight:700">합계</td><td class="num" style="font-weight:700">${total}</td></tr></tbody>
  </table>`;
}
function pickParcelTableHtml(targets) {
  const groups = shipmentGroups(targets, e => e.x);
  if (!groups.length) return `<div class="muted" style="padding:1rem">택배가 없어요.</div>`;
  const body = groups.map(group => {
    const first = group[0].x;
    const isSeeding = group.every(e => e.kind === 'seeding');
    const [cls, nm] = epostStatusOf(first);
    const itemsText = group.flatMap(e => shipmentLineItems(e.x))
      .map(l => `${esc(l.product)} × ${Number(l.qty) || 1}`).join('<br>');
    return `<tr>
      <td style="white-space:nowrap">${kindTag(first, isSeeding)}</td>
      <td><b>${esc(first.name)}</b></td>
      <td>${itemsText}</td>
      <td>${chipEl(cls, nm)}</td>
    </tr>`;
  }).join('');
  return `<table class="tbl">
    <thead><tr><th>구분</th><th>받는 분</th><th>상품 × 수량</th><th>상태</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}
function pickTargetIds(targets) {
  return targets.map(t => t.type + ':' + t.x.id).join(',');
}
function printTodayPacking() {
  const targets = todayPickTargets();
  if (!targets.length) { toast('인쇄할 대상이 없어요.'); return; }
  window.open('/packing.html?ids=' + encodeURIComponent(pickTargetIds(targets)), '_blank');
}
function pickSectionHtml() {
  const targets = todayPickTargets();
  const headerActions = [
    btn({ label: '쌀 목록 인쇄', kind: 'secondary', size: 'sm', onclick: "window.open('/pick.html','_blank')" }),
    targets.length ? btn({ label: '포장 명세 인쇄', kind: 'secondary', size: 'sm', onclick: 'printTodayPacking()' }) : ''
  ].join('');
  const header = `<div class="step-title">오늘 쌀 목록<span style="margin-left:auto;display:flex;gap:8px">${headerActions}</span></div>`;
  if (!targets.length) {
    return `<div style="margin-bottom:20px">${header}<div class="card">${emptyState({ title: '오늘 접수한 택배가 없어요' })}</div></div>`;
  }
  const rows = todayPickAggregate(targets);
  return `<div style="margin-bottom:20px">${header}
    <div class="pick-grid">${tableWrap(pickSummaryTableHtml(rows))}${tableWrap(pickParcelTableHtml(targets))}</div>
  </div>`;
}

function renderEpost() {
  const allItems = [
    ...DB.orders.filter(x => x.epost).map(x => ({ kind: 'order', x })),
    ...DB.seeding.filter(x => x.epost).map(x => ({ kind: 'seeding', x }))
  ].sort((a, b) => {
    // 출력 안 한 것 먼저, 그 다음 최신순
    const ap = !a.x.printed ? 0 : 1;
    const bp = !b.x.printed ? 0 : 1;
    return ap - bp || (b.x.sentDate || '').localeCompare(a.x.sentDate || '');
  });
  const filter = window._epostFilter || 'all';
  const items = allItems.filter(entry => HamItemLines.epostFilterMatches(entry.x, filter));
  const filterCounts = {
    all: shipmentCount(allItems, entry => entry.x),
    print: shipmentCount(allItems.filter(entry => HamItemLines.epostFilterMatches(entry.x, 'print')), entry => entry.x),
    printedWait: shipmentCount(allItems.filter(entry => HamItemLines.epostFilterMatches(entry.x, 'printedWait')), entry => entry.x),
    collected: shipmentCount(allItems.filter(entry => HamItemLines.epostFilterMatches(entry.x, 'collected')), entry => entry.x),
    problem: shipmentCount(allItems.filter(entry => HamItemLines.epostFilterMatches(entry.x, 'problem')), entry => entry.x)
  };
  const filterLabelMap = { all: '전체 접수', print: '출력 대기', printedWait: '출력됨 · 수거 대기', collected: '수거됨', problem: '확인 필요', pickup: '수거 대기' };
  const filterLabel = filterLabelMap[filter] || '전체 접수';
  const parcels = shipmentGroups(items, entry => entry.x);
  const parcelSpec = group => group.map(entry => entry.kind + ':' + entry.x.id).join(',');

  const rows = parcels.map(group => {
    const { kind, x } = group[0];
    const printSpec = parcelSpec(group);
    const kindsHtml = [...new Set(group.map(entry => kindTag(entry.x, entry.kind === 'seeding')))].join('<br>');
    const productHtml = group.map(entry => {
      const pp = productParts(entry.x);
      return `<div>${pp.name}${pp.opt || ''}</div>`;
    }).join('');
    const notes = [...new Set(group.map(entry => shipmentMemoHtml(entry.x)).filter(Boolean))].join('');
    const [cls, nm] = epostStatusOf(x);
    const cancelable = !x.delivered && ['00', '01', '02'].includes(x.epost.stus || '01');
    const hasLabel = !!x.epost.label;

    let invoiceHtml;
    if (hasLabel) {
      invoiceHtml = `${x.invoice ? invoiceCell(x.invoice) : '<span class="muted">아직 없음</span>'}<div style="margin-top:4px">${btn({ label: x.printed ? '다시 인쇄' : '운송장 인쇄', onclick: `printLabels('${printSpec}')`, kind: 'text', size: 'sm' })}</div>`;
    } else {
      invoiceHtml = x.printed ? chipEl('ok', '사이트 인쇄함') : '<span class="muted">사이트 출력 대상</span>';
    }

    const actionBtns = [];
    if (!hasLabel && !x.printed) actionBtns.push(btn({ label: '출력함 표시', onclick: `confirmSitePrinted('${printSpec}','${jsq(x.name)}')`, kind: 'text', size: 'sm' }));
    if (cancelable) actionBtns.push(`<button type="button" class="btn text sm" style="color:var(--bad)" onclick="epostCancel('${kind}',${x.id},'${jsq(x.name)}')">접수 취소</button>`);
    const actionsHtml = actionBtns.length ? actionBtns.join('') : '<span class="muted">-</span>';

    return `
    <tr>
      <td style="white-space:nowrap">${kindsHtml}</td>
      <td><b>${esc(x.name)}</b></td>
      <td style="min-width:220px;max-width:440px">${productHtml}${notes}</td>
      <td style="white-space:nowrap">${esc(x.sentDate || '')}</td>
      <td>${chipEl(cls, nm)}</td>
      <td style="max-width:170px">${invoiceHtml}</td>
      <td class="acts" style="white-space:nowrap">${actionsHtml}</td>
    </tr>`;
  }).join('');

  const needP = parcels.filter(group => group[0].x.epost.label && group.some(entry => !entry.x.printed)).map(parcelSpec);
  const needSite = parcels.filter(group => !group[0].x.epost.label && group.some(entry => !entry.x.printed)).map(parcelSpec);
  const printable = parcels.filter(group => group[0].x.epost.label).map(parcelSpec);

  const headerActions = [
    btn({ label: '진행상태 새로고침', onclick: 'epostRefresh()', icon: 'refresh' }),
    printable.length && printable.length !== needP.length ? btn({ label: `전체 다시 출력 (${printable.length}장)`, onclick: `printLabels('${printable.join(',')}')` }) : '',
    needP.length ? btn({ label: `운송장 ${needP.length}장 출력`, onclick: `printLabels('${needP.join(',')}')`, kind: 'primary', icon: 'print' }) : ''
  ].join('');

  const header = pageHeader({
    title: '출고',
    sub: esc(`${filterLabel} ${parcels.length}건`),
    actions: headerActions
  });

  const segRow = `<div style="margin-bottom:16px">${seg([
    { key: 'all', label: '전체', count: filterCounts.all, on: filter === 'all', onclick: "go('epost','all')" },
    { key: 'print', label: '출력 대기', count: filterCounts.print, on: filter === 'print', onclick: "go('epost','print')" },
    { key: 'printedWait', label: '출력됨 · 수거 대기', count: filterCounts.printedWait, on: filter === 'printedWait', onclick: "go('epost','printedWait')" },
    { key: 'collected', label: '수거됨', count: filterCounts.collected, on: filter === 'collected', onclick: "go('epost','collected')" },
    { key: 'problem', label: '확인 필요', count: filterCounts.problem, on: filter === 'problem', onclick: "go('epost','problem')" }
  ])}</div>`;

  const guideCard = `<div class="card">
    <div class="step-title">우체국 사이트에서 인쇄하기</div>
    <div class="hint">라벨기가 없으면 우체국 사이트(오즈뷰어)에서 직접 인쇄할 수 있어요.${needSite.length ? ` 지금 <b>${needSite.length}장</b>이 사이트 출력 대상이에요.` : ''}</div>
    <div class="hint">로그인(아이디 ${esc((DB.settings && DB.settings.epostMemberId) || '')}) 후 <b>계약소포 → 신청정보등록</b>에서 오늘 접수 목록을 조회하고 체크한 뒤 <b>라벨인쇄</b>를 누르세요. 인쇄한 뒤에는 표의 <b>[출력함 표시]</b>를 눌러 기록해 주세요.</div>
    <div class="hint">우체국 홈페이지에서 출력했으면 [출력함 표시]는 눌러도 되고 안 눌러도 돼요. 기사님이 가져가면 자동으로 수거됨이 돼요.</div>
    <div style="margin-top:10px">${btn({ label: '우체국 사이트 열기', onclick: 'epostSitePrint()', icon: 'external' })}</div>
    <div id="epost-page-result"></div>
  </div>`;

  const tableSection = parcels.length
    ? tableWrap(`
      <table class="tbl">
        <thead><tr><th>구분</th><th>받는 분</th><th>상품</th><th>접수일</th><th>상태</th><th>송장</th><th class="acts">액션</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`)
    : `<div class="card">${emptyState({
        icon: 'post',
        title: filter === 'all' ? '접수한 택배가 없어요' : `${filterLabel}에 해당하는 택배가 없어요`,
        actionHtml: filter === 'all'
          ? btn({ label: '주문 확인 열기', onclick: "go('send')", kind: 'text' })
          : btn({ label: '전체 접수 보기', onclick: "go('epost','all')", kind: 'text' })
      })}</div>`;

  main().innerHTML = header + pickSectionHtml() + segRow + guideCard + tableSection;
}
// 우체국 사이트(오즈뷰어)로 출력: 사이트를 열고, 앱 화면에 따라할 순서를 짧게 다시 보여줌
function epostSitePrint() {
  window.open('https://biz.epost.go.kr', '_blank');
  const box = $('#epost-page-result');
  if (box) {
    box.innerHTML = `<div class="hint" style="margin-top:8px">우체국 사이트를 열었어요. 로그인 후 <b>계약소포 → 신청정보등록 → 라벨인쇄</b> 순서로 진행하세요. 화면이 다르거나 막히면 우체국 고객센터 1588-1300으로 문의하세요.</div>`;
    box.scrollIntoView({ behavior: 'smooth' });
  }
}
function printLabels(sel) {
  const opened = window.open('/label.html?print=1&sel=' + encodeURIComponent(sel), '_blank');
  if (!opened) toast('팝업이 막혀 라벨 창을 열지 못했어요. 주소창 오른쪽에서 팝업을 허용해 주세요.', 7000);
}
async function confirmSitePrinted(sel, name) {
  if (!confirm(`${name}님 운송장을 우체국 사이트에서 실제로 인쇄했나요?`)) return;
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
  toast(`택배 ${result.parcels}건을 출력 완료로 기록했어요.`);
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
  const a = document.querySelector('.side a[data-page="epost"]');
  if (!a) return;
  let b = a.querySelector('.nav-badge');
  if (n > 0) {
    if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; a.appendChild(b); }
    b.textContent = n;
  } else if (b) b.remove();
}
async function epostRefresh() {
  busy(true, '우체국에서 진행상태를 확인하는 중…');
  const r = await api('/api/epost/status', { method: 'POST' });
  busy(false);
  if (r.error) { toast(r.error, 6000); return; }
  adoptDb(r.db);
  render();
  toast(`${r.refreshed}건 상태를 새로 확인했어요.` + (r.recovered ? ` 불확실했던 접수 ${r.recovered}건도 찾았어요.` : '') + (r.released ? ` 우체국에 접수되지 않은 ${r.released}건은 다시 선택할 수 있게 풀었어요.` : '') + (r.errors && r.errors.length ? ' 일부는 아직 확인 중이에요.' : ''), 6000);
}
async function epostCancel(kind, id, name) {
  if (!confirm(`${name}님의 우체국 접수를 정말 취소할까요?\n\n· 발급된 송장번호는 무효가 돼요\n· 이 건은 [주문 확인] 목록으로 되돌아가요\n· 뺐던 재고도 다시 채워져요`)) return;
  busy(true, '우체국 접수를 취소하는 중…');
  const r = await api('/api/epost/cancel', { method: 'POST', body: JSON.stringify({ type: kind, id }) });
  busy(false);
  if (r.error) { toast(r.error, 8000); return; }
  adoptDb(r.db);
  render();
  toast('접수를 취소했어요. [주문 확인] 목록으로 돌아갔습니다.', 6000);
  if (r.warning) setTimeout(() => alert(r.warning), 300);
}
