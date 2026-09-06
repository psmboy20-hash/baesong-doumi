
// ---------- 배송 확인 ----------
function shipDefaultDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function shipSetRange(which, val) {
  if (which === 'from') window._shipFrom = val; else window._shipTo = val;
}
async function shipDownloadCsv() {
  const f = window._shipFilter || 'all';
  const q = (window._shipQ || '').trim();
  const params = new URLSearchParams();
  params.set('filter', f);
  if (window._shipFrom) params.set('from', window._shipFrom);
  if (window._shipTo) params.set('to', window._shipTo);
  if (q) params.set('q', q);
  const r = await downloadFile('/api/master/shipments.csv?' + params.toString(), null, '발송내역.csv');
  if (!r || !r.ok) toast((r && r.error) || '발송 내역을 내려받지 못했어요.', 6000);
}
function shipInvoiceCell(x) {
  if (!x.invoice) return '<span class="muted">아직 없음</span>';
  const url = trackUrl(x.invoice, x.courier);
  const label = (x.courier && !String(x.invoice).includes(x.courier) ? x.courier + ' ' : '') + x.invoice;
  const trackBtn = url ? btn({ label: '배송조회', onclick: `window.open('${url}','_blank')`, kind: 'text', size: 'sm', icon: 'external' }) : '';
  return `${trackBtn}<div class="sub">${esc(label)}</div>`;
}
function renderShipping() {
  // 엑셀 내려받기 기간 기본값: 최근 90일
  if (!window._shipFrom) window._shipFrom = shipDefaultDate(-89);
  if (!window._shipTo) window._shipTo = shipDefaultDate(0);
  const all = [
    ...DB.orders.map(x => Object.assign({ _kind: '주문' }, x)),
    ...DB.seeding.map(x => Object.assign({ _kind: '시딩' }, x))
  ].sort((a, b) => (b.sentDate || b.regDate || '').localeCompare(a.sentDate || a.regDate || ''));
  // 단계 필터 (홈 타일에서 넘어오면 그 단계만)
  const f = window._shipFilter || 'all';
  const byF = x =>
    f === 'pending' ? (x.status === '대기' || x.status === '접수중') :
    f === 'moving' ? (x.status === '발송완료' && !x.delivered) :
    f === 'done' ? (x.status === '발송완료' && !!x.delivered) :
    f === 'canceled' ? x.status === '취소됨' : true;
  const cnt = k => shipmentCount(all.filter(x => (k === 'all' ? true : (
    k === 'pending' ? (x.status === '대기' || x.status === '접수중') :
    k === 'moving' ? (x.status === '발송완료' && !x.delivered) :
    k === 'done' ? (x.status === '발송완료' && !!x.delivered) : x.status === '취소됨'))));
  const TABS = [['all', '전체'], ['pending', '보낼 준비'], ['moving', '가는 중'], ['done', '배달 끝'], ['canceled', '취소됨']];
  const segRow = seg(TABS.map(([k, label]) => ({ key: k, label, count: cnt(k), on: f === k, onclick: `go('shipping','${k}')` })));

  const base = all.filter(byF);
  const q = (window._shipQ || '').trim();
  const filtered = q ? base.filter(x => matchQ(x.name + ' ' + x.phone + ' ' + (x.invoice || '') + ' ' + (x.product || ''), q)) : base;
  const cutNote = filtered.length > 200 ? `<div class="hint" style="margin-top:8px">최근 200건만 보여줘요. 더 찾으려면 검색창에 이름이나 송장번호를 넣어 주세요.</div>` : '';
  const emptyMsg = q
    ? `'${esc(q)}'(으)로 찾은 것이 없어요. ${btn({ label: '전체 보기', onclick: "window._shipQ='';renderShipping()", kind: 'text' })}`
    : f !== 'all'
      ? `이 단계에는 지금 아무것도 없어요. ${btn({ label: '전체 보기', onclick: "go('shipping','all')", kind: 'text' })}`
      : `아직 보낸 택배가 없어요. ${btn({ label: '주문 확인 열기', onclick: "go('send')", kind: 'text' })}`;

  const kindOf = x => x._kind === '시딩' ? 'seeding' : 'orders';
  const rows = filtered.slice(0, 200).map(x => {
    const pp = productParts(x);
    const memo = shipmentMemoHtml(x);
    const kind = kindOf(x);
    const daysLate = x.sentDate ? Math.floor((Date.now() - new Date(x.sentDate)) / 86400000) : 0;
    const noteBadges = [];
    if (!x.delivered && x.status === '발송완료' && x.deliveryCheckStatus === '확인필요') noteBadges.push('<span class="note-badge">택배사 확인 필요</span>');
    if (!x.delivered && x.status === '발송완료' && x.sentDate && daysLate >= 7) noteBadges.push(`<span class="note-badge" title="택배사에서 배달완료가 확인되지 않았어요. 실제로 받았다면 [배달 끝 처리]를 눌러 주세요.">${daysLate}일째 배달 확인 안 됨</span>`);

    let actionsHtml;
    if (x.status === '발송완료') {
      const parts = [];
      if (!x.delivered) parts.push(btn({ label: '배달 끝 처리', onclick: `markDelivered('${kind}',${x.id},'${jsq(x.name)}')`, kind: 'text', size: 'sm' }));
      parts.push(btn({ label: '교환/반품 등록', onclick: `returnFormFrom('${kind}',${x.id})`, kind: 'text', size: 'sm' }));
      actionsHtml = parts.join('');
    } else if (x.status === '취소됨') {
      actionsHtml = btn({ label: '다시 보내기', onclick: `restoreSend('${kind}',${x.id},'${jsq(x.name)}')`, kind: 'text', size: 'sm' });
    } else if (x.status === '대기') {
      actionsHtml = `<button type="button" class="btn text sm" style="color:var(--bad)" onclick="cancelSend('${kind}',${x.id},'${jsq(x.name)}')">취소</button>`;
    } else {
      actionsHtml = '<span class="muted">-</span>';
    }

    return `
    <tr>
      <td style="white-space:nowrap">${kindTag(x, x._kind === '시딩')}</td>
      <td style="white-space:nowrap">${esc(x.sentDate || '')}</td>
      <td><b>${esc(x.name)}</b></td>
      <td style="min-width:240px;max-width:480px">${pp.name}${pp.opt || ''}${memo}</td>
      <td>${chip(x.delivered ? '배달완료' : x.status)}${noteBadges.length ? '<br>' + noteBadges.join(' ') : ''}</td>
      <td style="max-width:160px">${shipInvoiceCell(x)}</td>
      <td class="acts" style="white-space:nowrap">${actionsHtml}</td>
    </tr>`;
  }).join('');

  const dateInputStyle = 'font-size:14px;padding:6px 8px;border:1px solid var(--line-strong);border-radius:8px';
  const rangeHtml = `<input type="date" value="${esc(window._shipFrom)}" onchange="shipSetRange('from',this.value)" style="${dateInputStyle}">` +
    `<span style="color:var(--text-3)">~</span>` +
    `<input type="date" value="${esc(window._shipTo)}" onchange="shipSetRange('to',this.value)" style="${dateInputStyle}">`;
  const header = pageHeader({
    title: '배송 확인',
    sub: '택배 전체 내역이에요. 보낼 것부터 취소한 것까지 모두 있어요.',
    actions: rangeHtml + btn({ kind: 'secondary', icon: 'download', label: '엑셀 내려받기', onclick: 'shipDownloadCsv()' })
  });

  main().innerHTML = header +
    `<div style="margin-bottom:16px">${segRow}</div>` +
    searchBox({
      id: 'ship-q', placeholder: '이름이나 송장번호로 찾기', value: q,
      oninput: "window._shipQ=this.value; renderShipping(); const el=document.getElementById('ship-q'); if (el) { el.focus(); el.setSelectionRange(el.value.length,el.value.length); }"
    }) +
    tableWrap(`
      <table class="tbl">
        <thead><tr><th>구분</th><th>보낸 날</th><th>이름</th><th>상품</th><th>상태</th><th>송장</th><th class="acts">액션</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="muted" style="padding:1.5rem">${emptyMsg}</td></tr>`}</tbody>
      </table>`) +
    cutNote;
}
