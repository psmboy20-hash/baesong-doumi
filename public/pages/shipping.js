
// ---------- 배송 확인 ----------
function renderShipping() {
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
  const tabs = TABS.map(([k, nm]) =>
    `<button class="big-btn ${f === k ? '' : 'gray'}" style="font-size:1rem;padding:0.5rem 1rem" onclick="go('shipping','${k}')">${nm} ${cnt(k)}</button>`).join('');
  const base = all.filter(byF);
  const q = (window._shipQ || '').trim();
  const filtered = q ? base.filter(x => matchQ(x.name + ' ' + x.phone + ' ' + (x.invoice || '') + ' ' + (x.product || ''), q)) : base;
  const cutNote = filtered.length > 200 ? `<div class="hint" style="margin-top:0.6rem">최근 200건만 보여줘요. 더 찾으려면 위 검색창에 이름이나 송장번호를 넣어 주세요.</div>` : '';
  const emptyMsg = q
    ? `'${esc(q)}'(으)로 찾은 것이 없어요. <button class="link-btn" onclick="window._shipQ='';renderShipping()">🔄 전체 보기</button>`
    : f !== 'all'
      ? `이 단계에는 지금 아무것도 없어요. <button class="link-btn" onclick="go('shipping','all')">전체 보기</button>`
      : `아직 보낸 택배가 없어요.<br><button class="link-btn" onclick="go('send')">📮 보내기에서 첫 택배를 접수해 보세요</button>`;
  const rows = filtered.slice(0, 200).map(x => {
    const pp = productParts(x);
    const memo = shipmentMemoHtml(x);
    return `
    <tr>
      <td style="white-space:nowrap">${shipmentSourceLabel(x)}</td>
      <td style="white-space:nowrap">${esc(x.sentDate || '')}</td>
      <td><b>${esc(x.name)}</b></td>
      <td style="min-width:240px;max-width:480px">${pp.name}</td>
      <td>${pp.opt || '<span class="muted">-</span>'}</td>
      <td style="min-width:180px;max-width:300px">${memo || '<span class="muted">-</span>'}</td>
      <td>${chip(x.delivered ? '배달완료' : x.status)}${!x.delivered && x.status === '발송완료' && x.deliveryCheckStatus === '확인필요' ? '<br><span class="note-badge">택배사 확인 필요</span>' : ''}${!x.delivered && x.status === '발송완료' && x.sentDate && (Date.now() - new Date(x.sentDate)) / 86400000 >= 7 ? `<br><span class="note-badge" title="택배사에서 배달완료가 확인되지 않았어요. 실제로 받았다면 [✔ 배달 끝 처리]를 눌러 주세요.">⏰ ${Math.floor((Date.now() - new Date(x.sentDate)) / 86400000)}일째 배달 확인 안 됨</span>` : ''}</td>
      <td style="max-width:150px">${invoiceCell(x.invoice, x.courier)}</td>
      <td style="white-space:nowrap"><div class="btn-col">${x.status === '발송완료'
        ? `<button class="link-btn" onclick="returnFormFrom('${x._kind === '시딩' ? 'seeding' : 'orders'}',${x.id})">🔁 교환/반품</button>${!x.delivered ? `<button class="link-btn" style="font-size:0.9rem" onclick="markDelivered('${x._kind === '시딩' ? 'seeding' : 'orders'}',${x.id},'${jsq(x.name)}')">✔ 배달 끝 처리</button>` : ''}`
        : x.status === '취소됨' ? `<button class="link-btn" onclick="restoreSend('${x._kind === '시딩' ? 'seeding' : 'orders'}',${x.id},'${jsq(x.name)}')">↩️ 다시 보내기</button>` : ''}</div></td>
    </tr>`;
  }).join('');
  main().innerHTML = `
    <h1>🚚 배송 확인</h1>
    <div class="sub">택배 <b>전체 내역</b>이에요 (보낼 것 · 보낸 것 · 취소한 것 모두). <b>[배송조회 🔍]</b>를 누르면 지금 어디까지 갔는지 볼 수 있어요.</div>
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem">${tabs}</div>
    <input class="search-input" placeholder="🔍 이름이나 송장번호로 찾기" value="${esc(q)}"
      oninput="window._shipQ=this.value; renderShipping(); this.focus(); this.setSelectionRange(this.value.length,this.value.length)">
    <div class="card">
      <div class="table-wrap" style="max-height:70vh">
        <table>
          <thead><tr><th>구분</th><th>보낸 날</th><th>이름</th><th>제품</th><th>옵션</th><th>포장·비고</th><th>상태</th><th>송장번호</th><th>교환/반품</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="9" class="muted" style="font-size:1.05rem;padding:1.5rem">${emptyMsg}</td></tr>`}</tbody>
        </table>
      </div>
      ${cutNote}
    </div>`;
  injectHelp();
}
