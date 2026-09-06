
// ---------- 고객 (이력 카드 + 전역 검색) ----------
let CUST_LIST = [];
let CUST_SEL = null;

function renderCustomers() {
  const q = window._custQ || '';
  const header = pageHeader({
    title: '고객',
    sub: '이름·전화·주소·송장·주문번호로 고객을 찾아 지금까지 보낸 것과 교환/반품 이력을 봐요.'
  });
  main().innerHTML = header +
    `<div class="cust-layout">
      <div class="cust-list-col">
        ${searchBox({ id: 'cust-q', placeholder: '이름, 전화, 주소, 송장, 주문번호로 검색', value: q, oninput: 'custSearchInput(this.value)' })}
        <div id="cust-list">${emptyState({ icon: 'search', title: '찾는 중…' })}</div>
      </div>
      <div class="cust-detail-col" id="cust-detail">${window._custSel
        ? emptyState({ icon: 'clock', title: '불러오는 중…' })
        : `<div class="card">${emptyState({ icon: 'users', title: '고객을 선택하세요', sub: '왼쪽 목록에서 고객을 고르면 이력이 나와요.' })}</div>`}</div>
    </div>`;
  custDoSearch(q);
  // 이전에 보고 있던 고객이 있으면(같은 세션에서 다시 들어온 경우) 이어서 보여준다
  if (window._custSel && !q) custSelect(window._custSel);
}
let _custSearchTimer = null;
function custSearchInput(v) {
  window._custQ = v;
  clearTimeout(_custSearchTimer);
  _custSearchTimer = setTimeout(() => custDoSearch(v), 250);
}
async function custDoSearch(q) {
  const box = document.getElementById('cust-list');
  if (!box) return;
  const r = await api('/api/customers?q=' + encodeURIComponent(q || ''));
  if (!box.isConnected) return; // 검색 중 다른 화면으로 이동했으면 무시
  if (!r || r.error || !r.ok) {
    box.innerHTML = emptyState({ icon: 'alert', title: '고객 목록을 불러오지 못했어요', sub: '잠시 후 다시 시도해 주세요.' });
    return;
  }
  CUST_LIST = r.list || [];
  if (!CUST_LIST.length) {
    box.innerHTML = emptyState({
      icon: 'search', title: '검색 결과가 없어요',
      sub: q ? `"${esc(q)}"에 해당하는 고객이 없어요.` : '아직 고객 기록이 없어요. 주문·시딩이 쌓이면 여기 나타나요.'
    });
    return;
  }
  box.innerHTML = `<div class="cust-rows">${CUST_LIST.map(custRowHtml).join('')}</div>`;
  // 검색어(전역 검색에서 넘어온 경우 포함)로 찾았으면 첫 결과를 바로 열어 준다
  if (q) custSelect(CUST_LIST[0].key);
}
function custRowHtml(c) {
  const on = CUST_SEL === c.key ? ' on' : '';
  const counts = c.counts || {};
  const orderN = Number(counts.orders || 0) + Number(counts.seeding || 0);
  return `<button type="button" class="cust-row${on}" onclick="custSelect('${jsq(c.key)}')">
    <div class="cr-name">${esc(c.name || '이름 없음')}</div>
    <div class="cr-sub">${esc(c.phone || '전화번호 없음')}</div>
    <div class="cr-meta">${c.lastAt ? esc(c.lastAt) + ' · ' : ''}주문·시딩 ${orderN}건</div>
  </button>`;
}
async function custSelect(key) {
  CUST_SEL = key;
  window._custSel = key;
  const listBox = document.getElementById('cust-list');
  if (listBox && listBox.querySelector('.cust-rows')) {
    listBox.innerHTML = `<div class="cust-rows">${CUST_LIST.map(custRowHtml).join('')}</div>`;
  }
  const box = document.getElementById('cust-detail');
  if (box) box.innerHTML = emptyState({ icon: 'clock', title: '불러오는 중…' });
  const r = await api('/api/customers/' + encodeURIComponent(key));
  if (!box || !box.isConnected) return;
  if (!r || r.error || !r.ok) {
    box.innerHTML = `<div class="card">${emptyState({ icon: 'alert', title: '고객 정보를 불러오지 못했어요', sub: '잠시 후 다시 시도해 주세요.' })}</div>`;
    return;
  }
  box.innerHTML = custDetailHtml(r.customer || {});
}
function custOrderRow(o) {
  const typeLabel = o.type === 'seeding' ? seedingSourceLabel(o) : (o.sourceChannel === 'exchange' ? '교환 재발송' : '주문');
  return `<tr>
    <td style="white-space:nowrap">${esc(o.date || '')}</td>
    <td>${esc(typeLabel)}</td>
    <td style="min-width:180px">${esc(o.product || '')}${o.option ? `<div class="sub">${esc(o.option)}</div>` : ''}</td>
    <td class="num">${Number(o.qty) || 1}</td>
    <td>${chip(o.status)}</td>
    <td>${o.invoice ? invoiceCell(o.invoice) : '<span class="muted">아직 없음</span>'}</td>
    <td class="acts">${o.orderNo ? btn({ label: esc(o.orderNo), onclick: `custGotoShipping('${jsq(o.orderNo)}')`, kind: 'text', size: 'sm' }) : ''}</td>
  </tr>`;
}
function custReturnRow(rt) {
  const flow = (typeof RMA_FLOW !== 'undefined' && RMA_FLOW[rt.flowState]) || ['idle', rt.flowState || '확인 필요'];
  return `<tr>
    <td style="white-space:nowrap">${esc(rt.date || '')}</td>
    <td><b>${esc(rt.kind || '')}</b></td>
    <td style="min-width:180px">${esc(rt.product || '')}</td>
    <td>${esc(rt.reason || '')}</td>
    <td>${chipEl(flow[0], esc(flow[1]))}</td>
  </tr>`;
}
function custGotoShipping(orderNo) {
  window._shipQ = orderNo;
  go('shipping');
}
function custDetailHtml(c) {
  const phones = (c.phones || []).filter(Boolean);
  const addrs = (c.addrs || []).filter(Boolean);
  const counts = c.counts || {};
  const kpis = kpiStrip([
    { label: '주문', value: Number(counts.orders || 0), unit: '건' },
    { label: '시딩', value: Number(counts.seeding || 0), unit: '건' },
    { label: '교환/반품', value: Number(counts.returns || 0), unit: '건' },
    { label: '교환', value: Number(counts.exchanges || 0), unit: '건' }
  ]);
  const orders = (c.orders || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const returns = (c.returns || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const ordersSection = orders.length
    ? tableWrap(`<table class="tbl"><thead><tr><th>날짜</th><th>구분</th><th>상품</th><th class="num">수량</th><th>상태</th><th>송장</th><th>주문번호</th></tr></thead><tbody>${orders.map(custOrderRow).join('')}</tbody></table>`)
    : `<div class="card">${emptyState({ icon: 'send', title: '주문·시딩 기록이 없어요' })}</div>`;
  const returnsSection = returns.length
    ? tableWrap(`<table class="tbl"><thead><tr><th>날짜</th><th>구분</th><th>상품</th><th>사유</th><th>단계</th></tr></thead><tbody>${returns.map(custReturnRow).join('')}</tbody></table>`)
    : `<div class="card">${emptyState({ icon: 'refresh', title: '교환·반품 기록이 없어요' })}</div>`;
  return `
    <div class="card">
      <div class="step-title">${esc(c.name || '이름 없음')}</div>
      <div class="hint" style="margin-bottom:2px">${phones.length ? esc(phones.join(', ')) : '<span class="muted">전화번호 없음</span>'}</div>
      ${addrs.length ? addrs.map(a => `<div class="hint" style="margin-bottom:2px">${esc(a)}</div>`).join('') : '<div class="hint muted">주소 정보 없음</div>'}
    </div>
    ${kpis}
    <div class="step-title">주문·시딩</div>
    ${ordersSection}
    <div class="step-title" style="margin-top:16px">교환·반품</div>
    ${returnsSection}
    <div class="card">
      <div class="step-title">메모</div>
      <textarea id="cust-note" class="cust-note-input" placeholder="이 고객과 통화·상담 내용을 적어두면 다음에 참고할 수 있어요">${esc(c.note || '')}</textarea>
      <div style="margin-top:10px">${btn({ label: '메모 저장', onclick: `custSaveNote('${jsq(c.key)}')`, kind: 'primary' })}</div>
    </div>`;
}
async function custSaveNote(key) {
  const ta = document.getElementById('cust-note');
  if (!ta) return;
  busy(true, '메모를 저장하는 중…');
  const r = await api(`/api/customers/${encodeURIComponent(key)}/note`, { method: 'POST', body: JSON.stringify({ note: ta.value }) });
  busy(false);
  if (r.error) { toast(r.error, 6000); return; }
  if (r.db) adoptDb(r.db);
  toast('메모를 저장했어요.', 3000);
}
