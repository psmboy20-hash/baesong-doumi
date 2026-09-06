
// ---------- 교환/반품 ----------
const RMA_FLOW = {
  requested: ['warn', '접수됨 · 회수 전'],
  accepted: ['warn', '접수됨 · 회수 전'],
  hold: ['warn', '카페24 보류'],
  awaiting_pickup: ['processing', '회수 기다림'],
  pickup_booked: ['processing', '기사님 방문 예정'],
  collected: ['processing', '기사님 수거 완료'],
  received: ['processing', '물건 도착 · 검수'],
  reship_ready: ['processing', '교환 재발송 준비'],
  processing: ['processing', '카페24 처리 중'],
  refund_pending: ['processing', '반품 완료 · 환불 확인'],
  completed: ['done', '전체 완료'],
  canceled: ['idle', '전체 취소']
};
// RET_STUS(pages/epost.js)의 상태 문구는 예전 이모지 표기가 남아 있을 수 있어 여기서 표시 직전에 걸러낸다
function stripEmoji(s) {
  return String(s || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '').trim();
}
// 회수 신청/물건 도착 확인/취소 같은 행 액션 글자 버튼 (.tbl 규칙: kind:'text' size:'sm')
function actLink(label, onclick, danger) {
  return `<button type="button" class="btn text sm"${danger ? ' style="color:var(--bad)"' : ''} onclick="${onclick}">${label}</button>`;
}
function rmaLineItems(x) {
  return Array.isArray(x.items) && x.items.length ? x.items : [x];
}
function rmaCompletionBlock(x) {
  if (x.duplicateOf) return '이미 다른 교환·반품 기록에 합쳐진 중복 건이에요.';
  if (x.sourceChannel === 'cafe24' &&
      (!String(x.originalOrderNo || '').trim() || !String(x.cafe24ClaimCode || '').trim() ||
       rmaLineItems(x).some(row => !String(row.orderItemCode || '').trim()))) {
    return '카페24 원주문·접수번호·품목 연결을 아직 모두 확인하지 못했어요.';
  }
  if (x.kind === '교환' && x.sourceChannel === 'cafe24' &&
      rmaLineItems(x).some(row => !String(row.exchangeVariantCode || '').trim())) {
    return '카페24 교환 목표 상품·옵션을 아직 확인하지 못했어요.';
  }
  return '';
}
function showReturnSafeStop(result) {
  const box = $('#ret-result');
  if (!box) return;
  box.innerHTML = banner('warn', `<b>안전 중지 — 아무것도 변경하지 않았어요</b><br>
    ${esc(result.message || result.error || '정보를 정확히 확인하지 못해 실행을 멈췄어요.')}<br>
    <span style="font-weight:400">우체국 접수 없음 · 재고 변경 없음 · 재발송 생성 없음<br>${esc(result.nextAction || '전체 연동을 다시 확인해 주세요.')}</span>`);
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
// 상품(+옵션, 교환이면 교환 목표까지) 한 칸으로 묶어서 보여준다
function rmaCells(x) {
  const lines = rmaLineItems(x);
  return lines.map(row => {
    const parts = productParts(row);
    const target = x.kind === '교환' && row.exchangeProduct
      ? `<div class="sub rma-target">→ ${esc([row.exchangeProduct, [row.exchangeColor, row.exchangeSize].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</div>` : '';
    return `<div class="rma-line">${parts.name}${parts.opt ? `<div class="sub">${parts.opt}</div>` : ''}${target}</div>`;
  }).join('');
}
function returnRow(x, epostOn) {
  const [cls, nm] = RMA_FLOW[x.flowState] || ['wait', x.status || '확인 필요'];
  const stusNm = x.epost && x.epost.stus ? stripEmoji((RET_STUS[x.epost.stus] || [])[1] || '') : '';
  const cafe24Line = x.sourceChannel === 'cafe24'
    ? `<div class="sub">카페24 ${esc(x.cafe24OrderStatus || '연결 중')}</div>` : '';
  const issues = (x.syncIssues || []).map(row => row.message).filter(Boolean);
  const completionBlock = rmaCompletionBlock(x);
  const issueLine = completionBlock
    ? `<div class="warn-text"><b>안전 중지</b><br>${esc(completionBlock)}<br><span class="muted">발송·재고 변경 없음</span></div>`
    : issues.length ? `<div class="warn-text">${esc(issues[issues.length - 1])}</div>` : '';
  const reasonLine = x.reason ? `<div class="sub">사유: ${esc(x.reason)}</div>` : '';
  const memoLine = x.memo ? `<div class="memo-line">메모 · ${esc(x.memo)}</div>` : '';
  let btns = '';
  const cancelUnresolved = x.flowState !== 'canceled' && x.syncOps && x.syncOps.cancel && ['pending', 'unknown', 'failed'].includes(x.syncOps.cancel.state);
  if (cancelUnresolved) {
    btns = actLink('전체 취소 다시 시도', `returnCancel(${x.id},'entry','${jsq(x.name)}')`, true);
  } else if (['requested', 'accepted', 'hold', 'awaiting_pickup'].includes(x.flowState)) {
    btns = (x.externalPickupActive
      ? '<span class="chip processing">카페24에서 회수 진행 중</span>'
      : epostOn ? actLink('회수 신청', `returnPickup(${x.id},'${jsq(x.name)}')`) : '<span class="muted" style="font-size:13px">우체국 연결 필요</span>') +
      (x.sourceChannel === 'cafe24'
        ? (x.externalPickupActive
          ? actLink('취소 방법', 'externalPickupHelp()')
          : actLink('전체 취소', `returnCancel(${x.id},'entry','${jsq(x.name)}')`, true))
        : actLink('지우기', `returnCancel(${x.id},'delete','${jsq(x.name)}')`, true));
  } else if (['pickup_booked', 'collected'].includes(x.flowState)) {
    const inspectButtons = completionBlock
      ? actLink('연동 다시 확인', 'doSync()') + '<span class="muted" style="font-size:13px">완료 버튼 잠김</span>'
      : actLink('양품 · 재고로', `returnComplete(${x.id},'${jsq(x.name)}','${jsq(x.kind)}','sellable')`) +
        actLink('불량 · 폐기', `returnComplete(${x.id},'${jsq(x.name)}','${jsq(x.kind)}','damaged')`, true);
    btns = inspectButtons +
      (x.epost && ['00', '01', '02', '04'].includes(x.epost.stus || '01') ? actLink('회수만 취소', `returnCancel(${x.id},'pickup','${jsq(x.name)}')`) : '') +
      actLink('전체 취소', `returnCancel(${x.id},'entry','${jsq(x.name)}')`, true);
  } else if (x.stockReviewNeeded) {
    btns = completionBlock
      ? actLink('연동 다시 확인', 'doSync()') + '<span class="muted" style="font-size:13px">재고·재발송 잠김</span>'
      : actLink('양품 · 재고로', `returnComplete(${x.id},'${jsq(x.name)}','${jsq(x.kind)}','sellable')`) +
        actLink('불량 · 폐기', `returnComplete(${x.id},'${jsq(x.name)}','${jsq(x.kind)}','damaged')`, true);
  } else if (issues.length && x.localCompleted) {
    btns = completionBlock
      ? actLink('연동 다시 확인', 'doSync()') + '<span class="muted" style="font-size:13px">카페24 반영 잠김</span>'
      : actLink('카페24 다시 반영', `returnComplete(${x.id},'${jsq(x.name)}','${jsq(x.kind)}')`);
  } else if (x.flowState === 'canceled' && x.sourceChannel !== 'cafe24') {
    btns = actLink('다시 신청', `returnReopen(${x.id},'${jsq(x.name)}')`) +
      actLink('지우기', `returnCancel(${x.id},'delete','${jsq(x.name)}')`, true);
  } else if (x.flowState === 'completed' && x.sourceChannel !== 'cafe24') {
    btns = actLink('지우기', `returnCancel(${x.id},'delete','${jsq(x.name)}')`, true);
  }
  btns += actLink('메모', `returnMemo(${x.id},'${jsq(x.name)}')`);
  return `
    <tr>
      <td style="white-space:nowrap">${esc(x.regDate || '')}</td>
      <td><b>${esc(x.name)}</b><div class="sub">${esc(x.phone || '')}</div></td>
      <td style="min-width:220px;max-width:380px">${rmaCells(x)}${reasonLine}${memoLine}</td>
      <td style="white-space:nowrap"><b>${esc(x.kind)}</b><div class="sub">${esc(x.rmaNo || 'RMA-' + x.id)}</div>${x.sourceChannel === 'cafe24' || x._src === 'c24' ? '<span class="note-badge">카페24 연결</span>' : ''}</td>
      <td style="max-width:230px">${chipEl(cls, esc(nm))}${x.invoice ? `<div class="sub">${invoiceCell(x.invoice)}</div>` : ''}${stusNm ? `<div class="sub">${esc(stusNm)}</div>` : ''}${cafe24Line}${issueLine}</td>
      <td style="white-space:nowrap"><div class="btn-col">${btns}</div></td>
    </tr>`;
}
// flowState가 completed/canceled라도 재고·재발송 확인이나 카페24 재반영이 남아있으면 "진행 중"으로 취급한다
// (returnRow의 액션 버튼 분기 1~5와 동일한 기준)
function returnNeedsAction(x) {
  const cancelUnresolved = x.flowState !== 'canceled' && x.syncOps && x.syncOps.cancel && ['pending', 'unknown', 'failed'].includes(x.syncOps.cancel.state);
  if (cancelUnresolved) return true;
  if (['requested', 'accepted', 'hold', 'awaiting_pickup', 'pickup_booked', 'collected'].includes(x.flowState)) return true;
  if (x.stockReviewNeeded) return true;
  const issues = (x.syncIssues || []).map(row => row.message).filter(Boolean);
  if (issues.length && x.localCompleted) return true;
  return false;
}
function renderReturns() {
  const items = (DB.returns || []).filter(x => !x.duplicateOf)
    .sort((a, b) => (b.regDate || '').localeCompare(a.regDate || '') || b.id - a.id);
  const active = items.filter(returnNeedsAction);
  const history = items.filter(x => !returnNeedsAction(x));
  const epostOn = SYNC_STATUS && SYNC_STATUS.epost && SYNC_STATUS.epost.connected;

  const header = pageHeader({
    title: '교환/반품',
    sub: '카페24 접수 → 우체국 회수 → 물건 도착·재고 → 재발송/완료까지 한 화면에서 이어서 처리해요.',
    actions: btn({ label: '교환/반품 등록', onclick: 'returnForm()', kind: 'secondary', icon: 'plus' }) +
      btn({ label: '회수 진행상태 새로고침', onclick: 'epostRefresh()', kind: 'secondary', icon: 'refresh' }) +
      btn({ label: '전체 연동 다시 확인', onclick: 'doSync()', kind: 'secondary', icon: 'refresh' })
  });

  const thead = `<tr><th>신청일</th><th>고객</th><th>상품</th><th>구분</th><th>회수 단계</th><th>처리</th></tr>`;

  const activeSection = active.length
    ? tableWrap(`<table class="tbl"><thead>${thead}</thead><tbody>${active.map(x => returnRow(x, epostOn)).join('')}</tbody></table>`)
    : `<div class="card">${emptyState({
        icon: 'refresh', title: '진행 중인 교환/반품이 없어요',
        sub: '고객이 교환·반품을 원하면 위의 [교환/반품 등록]을 누르거나, [배송 확인]에서 해당 건의 [교환/반품] 버튼을 누르세요.'
      })}</div>`;

  const historySection = history.length
    ? `<div class="card" style="padding:0;overflow:hidden">
        <details>
          <summary style="padding:16px 20px;cursor:pointer;font-weight:700;font-size:15px">지난 기록 <span class="muted" style="font-weight:500">(${history.length}건)</span></summary>
          <div class="table-wrap" style="border:0;border-top:1px solid var(--line);border-radius:0">
            <table class="tbl"><thead>${thead}</thead><tbody>${history.map(x => returnRow(x, epostOn)).join('')}</tbody></table>
          </div>
        </details>
      </div>`
    : '';

  const guide = `<div class="hint">
    회수 신청은 우체국 기사님이 송장을 들고 고객 집으로 방문해요(출력 없음).<br>
    물건 도착 확인은 검수 결과에 따라 재고가 들어오고, 교환이면 [주문 확인]에 재발송 1건이 생겨요.<br>
    회수만 취소는 우체국 방문만 취소하고 교환·반품 접수는 남겨요. 전체 취소는 우체국과 카페24 접수까지 같이 취소해요.<br>
    반품 환불 결제는 돈이 움직이므로 자동 승인하지 않고 카페24의 환불 상태를 확인해 완료로 넘겨요.
  </div>`;

  main().innerHTML = header +
    `<div id="ret-form"></div><div id="ret-result"></div>` +
    activeSection + (active.length ? guide : '') + historySection;
}
function returnForm(pre) {
  const box = $('#ret-form');
  if (!box) return;
  if (!pre && box.innerHTML.trim()) { box.innerHTML = ''; return; } // 헤더 버튼으로 열려 있으면 다시 눌러서 접기
  pre = pre || {};
  window._returnSource = {
    sourceType: pre.sourceType || '', sourceId: pre.sourceId || null,
    originalOrderNo: pre.originalOrderNo || '', orderItemCode: pre.orderItemCode || '',
    variantCode: pre.variantCode || '', sourceProductNo: pre.sourceProductNo || null,
    sku: pre.sku || '', sourceChannel: pre.sourceChannel || ''
  };
  const shipped = [
    ...DB.orders.filter(x => x.status === '발송완료').map(x => ({ kind: 'orders', x })),
    ...DB.seeding.filter(x => x.status === '발송완료').map(x => ({ kind: 'seeding', x }))
  ].sort((a, b) => (b.x.sentDate || '').localeCompare(a.x.sentDate || '')).slice(0, 80);
  const pickOpts = shipped.map(({ kind, x }) =>
    `<option value="${kind}:${x.id}">${esc(x.name)} — ${esc(String(x.product || '').slice(0, 40))} (${esc(x.sentDate || '날짜없음')})</option>`).join('');
  const exchangeOpts = (DB.inventory || []).filter(x => x.variantCode && x.cafe24VariantActive !== false)
    .sort((a, b) => [a.name, a.color, a.size].join('|').localeCompare([b.name, b.color, b.size].join('|')))
    .map(x => `<option value="${esc(x.sku || '')}" ${pre.exchangeSku === x.sku ? 'selected' : ''}>${esc([x.name, x.color, x.size].filter(Boolean).join(' · '))}</option>`).join('');
  box.innerHTML = `
    <div class="card">
      <div class="step-title">교환/반품 등록</div>
      <div class="form-row"><label>보낸 것에서 고르기 — 고르면 아래 칸이 저절로 채워져요</label>
        <select id="ret-pick" onchange="retPick(this.value)">
          <option value="">직접 입력할래요</option>
          ${pickOpts}
        </select>
      </div>
      <div class="form-row"><label>구분</label>
        <div style="display:flex;gap:1.2rem;font-size:1.1rem">
          <label style="display:flex;align-items:center;gap:0.4rem"><input type="radio" name="ret-kind" value="반품" ${pre.kind === '교환' ? '' : 'checked'} onchange="document.getElementById('ret-ex-row').style.display=this.value==='교환'?'':'none'"> 반품 (돈 돌려주기)</label>
          <label style="display:flex;align-items:center;gap:0.4rem"><input type="radio" name="ret-kind" value="교환" ${pre.kind === '교환' ? 'checked' : ''} onchange="document.getElementById('ret-ex-row').style.display=this.value==='교환'?'':'none'"> 교환 (다른 걸로 보내기)</label>
        </div>
      </div>
      <div class="form-row"><label>고객 이름</label><input id="ret-name" value="${esc(pre.name || '')}"></div>
      <div class="form-row"><label>연락처</label><input id="ret-phone" value="${esc(pre.phone || '')}" placeholder="010-0000-0000"></div>
      <div class="form-row"><label>우편번호 (5자리)</label><input id="ret-zip" value="${esc(pre.zip || '')}" placeholder="예: 07997"></div>
      <div class="form-row"><label>주소 (물건을 가지러 갈 곳)</label><input id="ret-addr" value="${esc(pre.addr || '')}"></div>
      <div class="form-row"><label>돌려받을 제품</label><input id="ret-product" value="${esc(pre.product || '')}"></div>
      <div class="form-row"><label>옵션 (컬러/사이즈)</label><input id="ret-option" value="${esc(pre.option || '')}"></div>
      <div class="form-row"><label>수량</label><input id="ret-qty" type="number" min="1" value="${Number(pre.qty) || 1}"></div>
      <div class="form-row"><label>사유</label><input id="ret-reason" placeholder="예: 사이즈가 작아요"></div>
      <div class="form-row"><label>원래 보낸 송장번호 (있으면)</label><input id="ret-orig" value="${esc(pre.origInvoice || '')}"></div>
      <div class="form-row" id="ret-ex-row" style="${pre.kind === '교환' ? '' : 'display:none'}"><label>교환으로 새로 보낼 제품 · 컬러 · 사이즈</label><select id="ret-exchange-sku"><option value="">꼭 골라 주세요</option>${exchangeOpts}</select></div>
      <div style="display:flex;gap:8px">
        ${btn({ label: '등록', onclick: `returnSubmit(${pre.sourceType === 'seeding' ? "'seeding'" : pre.sourceType === 'orders' ? "'orders'" : "''"})`, kind: 'primary' })}
        ${btn({ label: '취소', onclick: "document.getElementById('ret-form').innerHTML=''", kind: 'secondary' })}
      </div>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth' });
  $('#ret-name').focus();
}
async function returnSubmit(sourceType) {
  const kind = document.querySelector('input[name="ret-kind"]:checked').value;
  const exchangeSku = kind === '교환' ? $('#ret-exchange-sku').value : '';
  const exchangeItem = exchangeSku ? (DB.inventory || []).find(x => x.sku === exchangeSku) : null;
  if (kind === '교환' && !exchangeItem) { toast('교환으로 새로 보낼 제품·컬러·사이즈를 골라 주세요.', 6000); return; }
  const body = {
    kind, sourceType: window._returnSource && window._returnSource.sourceType || sourceType,
    sourceId: window._returnSource && window._returnSource.sourceId,
    originalOrderNo: window._returnSource && window._returnSource.originalOrderNo,
    orderItemCode: window._returnSource && window._returnSource.orderItemCode,
    variantCode: window._returnSource && window._returnSource.variantCode,
    sourceProductNo: window._returnSource && window._returnSource.sourceProductNo,
    sku: window._returnSource && window._returnSource.sku,
    sourceChannel: window._returnSource && window._returnSource.sourceChannel,
    name: $('#ret-name').value, phone: $('#ret-phone').value,
    zip: $('#ret-zip').value, addr: $('#ret-addr').value,
    product: $('#ret-product').value, option: $('#ret-option').value,
    qty: $('#ret-qty').value, reason: $('#ret-reason').value,
    origInvoice: $('#ret-orig').value,
    exchangeProduct: exchangeItem ? exchangeItem.name : '',
    exchangeSku: exchangeItem ? exchangeItem.sku : '',
    exchangeVariantCode: exchangeItem ? exchangeItem.variantCode : '',
    exchangeProductNo: exchangeItem ? exchangeItem.productNo : null,
    exchangeColor: exchangeItem ? exchangeItem.color : '',
    exchangeSize: exchangeItem ? exchangeItem.size : ''
  };
  busy(true, '등록하는 중…');
  const r = await api('/api/return/create', { method: 'POST', body: JSON.stringify(body) });
  busy(false);
  if (r.error) { toast(r.error, 6000); return; }
  adoptDb(r.db);
  render();
  toast(`${kind} 건을 등록했어요. 이제 [회수 신청]을 누르면 기사님이 고객 집으로 가요.`, 6000);
  if (r.warning) setTimeout(() => alert(r.warning), 200);
}
// 폼의 "보낸 것에서 고르기" 선택 시 칸 자동 채움
function retPick(v) {
  if (!v) return;
  const [kind, id] = v.split(':');
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const x = list.find(i => i.id === Number(id));
  if (!x) return;
  window._returnSource = {
    sourceType: kind, sourceId: x.id, originalOrderNo: x.orderNo || '',
    orderItemCode: x.orderItemCode || '', variantCode: x.variantCode || '', sourceProductNo: x.productNo || null,
    sku: x.sku || '', sourceChannel: x.sourceChannel || (kind === 'seeding' ? 'seeding' : 'cafe24')
  };
  $('#ret-name').value = x.name || '';
  $('#ret-phone').value = x.phone || '';
  $('#ret-zip').value = x.zip || '';
  $('#ret-addr').value = x.addr || '';
  $('#ret-product').value = x.product || '';
  $('#ret-option').value = x.option || [x.color, x.size].filter(Boolean).join(' ');
  $('#ret-qty').value = x.qty || 1;
  $('#ret-orig').value = x.invoice || '';
}
// 발송 전 취소: 보내기 목록에서 빼기 (배송 확인에서 되돌릴 수 있음)
async function cancelSend(kind, id, name) {
  if (!confirm(`${name}님 건을 보내지 않기로 할까요?\n\n· 주문 확인 목록에서 빠져요\n· [배송 확인]에서 [다시 보내기]로 언제든 되돌릴 수 있어요`)) return;
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const x = list.find(i => i.id === id);
  if (!x) return;
  x.status = '취소됨';
  x.manualCanceled = true; // 자동 동기화가 되살리지 않게 표시
  await saveDb();
  render();
  toast('취소했어요. 마음이 바뀌면 [배송 확인]에서 [다시 보내기]를 누르세요.', 6000);
}
async function restoreSend(kind, id, name) {
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const x = list.find(i => i.id === id);
  if (!x) return;
  x.status = '대기';
  x.manualCanceled = false;
  await saveDb();
  render();
  toast(`${name}님 건을 [주문 확인] 목록으로 되돌렸어요.`, 5000);
}
// 다른 택배사 등 자동 확인이 안 되는 건을 손으로 [배달 끝] 처리
async function markDelivered(kind, id, name) {
  if (!confirm(`${name}님 택배를 [배달 끝]으로 표시할까요?`)) return;
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const x = list.find(i => i.id === id);
  if (!x) return;
  const d = new Date(), p = n => String(n).padStart(2, '0');
  x.delivered = true;
  x.deliveredDate = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  x.deliverySource = 'manual';
  x.deliveryCheckStatus = '배달완료';
  delete x.deliveredAuto;
  await saveDb();
  render();
  toast('배달 끝으로 표시했어요.');
}
// 배송 확인 화면에서 보낸 건을 바로 교환/반품으로 넘기기
function returnFormFrom(kind, id) {
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const x = list.find(i => i.id === id);
  if (!x) return;
  go('returns');
  returnForm({
    sourceType: kind,
    sourceId: x.id, originalOrderNo: x.orderNo || '', sku: x.sku || '',
    orderItemCode: x.orderItemCode || '', variantCode: x.variantCode || '', sourceProductNo: x.productNo || null,
    sourceChannel: x.sourceChannel || (kind === 'seeding' ? 'seeding' : 'cafe24'),
    name: x.name, phone: x.phone, zip: x.zip || '', addr: x.addr,
    product: x.product, option: x.option || [x.color, x.size].filter(Boolean).join(' '),
    qty: x.qty || 1, origInvoice: x.invoice || ''
  });
}
async function returnPickup(id, name) {
  if (!confirm(`${name}님 집으로 우체국 기사님을 보낼까요?\n\n· 집배원이 운송장을 갖고 방문해 물건을 회수해요\n· 회수된 물건은 우리 발송지로 배달돼요\n· 택배 요금은 우리(계약) 앞으로 청구돼요`)) return;
  busy(true, '우체국에 회수를 신청하는 중…');
  const r = await api('/api/return/pickup', { method: 'POST', body: JSON.stringify({ id }) });
  busy(false);
  if (r.error) { toast(r.error, 8000); return; }
  adoptDb(r.db);
  render();
  const box = $('#ret-result');
  if (box) box.innerHTML = banner('ok', `<b>회수 신청 완료</b><br>
    ${esc(name)}님 집으로 기사님이 갈 거예요. 회수 송장번호 <b>${esc(r.regiNo || '')}</b>${r.price ? ' · 요금 ' + esc(r.price) + '원' : ''}<br>
    <span style="font-weight:400">진행상황은 이 화면의 [회수 진행상태 새로고침]으로 확인해요.</span>`);
  toast('회수 신청 완료', 5000);
  if (r.warning) setTimeout(() => alert(r.warning), 200);
}
async function returnComplete(id, name, kind, inspection) {
  const ret = (DB.returns || []).find(x => x.id === id);
  if (ret && ret.localCompleted) {
    busy(true, '변경 전 안전 점검 중…');
    const preflight = await api('/api/return/preflight', { method: 'POST', body: JSON.stringify({ id, restock: false, inspection: ret.inspection || 'sellable' }) });
    busy(false);
    if (preflight.error || !preflight.ready) { showReturnSafeStop(preflight); return; }
    if (!confirm(`${name}님 건의 실물·재고 처리는 이미 끝났어요.\n카페24 상태 반영만 다시 시도할까요?`)) return;
    busy(true, '카페24에 다시 반영하는 중…');
    const retry = await api('/api/return/complete', { method: 'POST', body: JSON.stringify({ id, restock: false, inspection: ret.inspection || 'sellable' }) });
    busy(false);
    if (retry.error) { if (retry.safeStop) showReturnSafeStop(retry); else toast(retry.error, 7000); return; }
    adoptDb(retry.db);
    render();
    toast(retry.warning || '카페24 상태까지 다시 맞췄어요.', 8000);
    return;
  }
  const extra = kind === '교환' ? '\n· 교환이라서 [주문 확인]에 재발송 건이 새로 생겨요' : '';
  let sellable;
  if (inspection === 'sellable' || inspection === 'damaged') {
    // 도착 확인 인라인 버튼([양품 · 재고로]/[불량 · 폐기])에서 바로 넘어온 경우 — 확인만 한 번
    sellable = inspection === 'sellable';
    const q = sellable
      ? `${name}님의 회수품을 양품으로 재고에 다시 넣을까요?${extra}`
      : `${name}님의 회수품을 불량·오염으로 폐기할까요?\n\n· 재고에는 다시 넣지 않습니다${extra}`;
    if (!confirm(q)) return;
  } else {
    // 다른 진입 경로 대비 — 기존 두 번 확인 방식 유지
    sellable = confirm(`${name}님의 회수품을 검수해 주세요.\n\n정상 상품으로 다시 판매할 수 있나요?\n\n[확인] 정상 — 재고에 다시 넣기\n[취소] 불량/오염 — 재고에서 제외`);
    if (!sellable && !confirm(`불량/오염으로 처리할까요?\n\n· 재고에는 다시 넣지 않습니다${extra}`)) return;
  }
  busy(true, '변경 전 안전 점검 중…');
  const preflight = await api('/api/return/preflight', { method: 'POST', body: JSON.stringify({ id, restock: sellable, inspection: sellable ? 'sellable' : 'damaged' }) });
  busy(false);
  if (preflight.error || !preflight.ready) { showReturnSafeStop(preflight); return; }
  busy(true, '처리하는 중…');
  const r = await api('/api/return/complete', { method: 'POST', body: JSON.stringify({ id, restock: sellable, inspection: sellable ? 'sellable' : 'damaged' }) });
  busy(false);
  if (r.error) { if (r.safeStop) showReturnSafeStop(r); else toast(r.error, 6000); return; }
  adoptDb(r.db);
  render();
  let msg = '완료했어요.';
  if (r.stock && r.stock.length) msg += ' 재고 +' + r.stock.map(s => s.name + '(' + s.left + '개)').join(', ');
  if (r.resend) msg += ` / 재발송 건이 [주문 확인]에 생겼어요: ${r.resend.product}`;
  toast(msg, 8000);
  if (r.warning) setTimeout(() => alert(r.warning), 200);
}
async function returnCancel(id, scope, name) {
  const q = scope === 'delete'
    ? `${name}님의 교환/반품 기록을 완전히 지울까요?\n\n· 한 번 지우면 되돌릴 수 없어요\n· 기록만 남겨두려면 [취소]를 누르세요`
    : scope === 'pickup'
      ? `${name}님의 우체국 방문 회수만 취소할까요?\n\n· 카페24 교환·반품 접수는 그대로 남아요\n· 나중에 회수를 다시 신청할 수 있어요`
      : `${name}님의 교환·반품을 전체 취소할까요?\n\n· 우체국 회수가 있으면 함께 취소돼요\n· 카페24 접수도 함께 취소돼요`;
  if (!confirm(q)) return;
  busy(true, '처리하는 중…');
  const r = await api('/api/return/cancel', { method: 'POST', body: JSON.stringify({ id, scope }) });
  busy(false);
  if (r.error) { toast(r.error, 8000); return; }
  adoptDb(r.db);
  render();
  toast('처리했어요.', 4000);
}
// 반품/교환 항목에 우리끼리 남기는 메모 (고객 msg와 별개) — 화면에는 회색 줄로 표시
async function returnMemo(id, name) {
  const ret = (DB.returns || []).find(x => x.id === id);
  const v = prompt(`${name}님 교환/반품 건 메모`, (ret && ret.memo) || '');
  if (v === null) return;
  busy(true, '메모를 저장하는 중…');
  const r = await api('/api/memo', { method: 'POST', body: JSON.stringify({ type: 'return', id, memo: v }) });
  busy(false);
  if (r.error) { toast(r.error, 6000); return; }
  adoptDb(r.db);
  render();
  toast('메모를 저장했어요.', 3000);
}
function externalPickupHelp() {
  alert('이 회수는 카페24에서 먼저 신청해서 배송도우미에는 택배사 취소번호가 없어요.\n\n1. 카페24에서 회수 신청을 취소하세요.\n2. 카페24에서 교환·반품을 취소하세요.\n3. 배송도우미에서 [전체 연동 다시 확인]을 누르면 함께 바뀝니다.');
}
// 우체국 쪽에서 취소된(또는 앱에서 취소한) 회수 건을 다시 신청 가능 상태로
async function returnReopen(id, name) {
  if (!confirm(`${name}님 건을 다시 [회수 신청 전] 상태로 되돌릴까요?`)) return;
  busy(true, '되돌리는 중…');
  const r = await api('/api/return/cancel', { method: 'POST', body: JSON.stringify({ id, scope: 'reopen' }) });
  busy(false);
  if (r.error) { toast(r.error, 7000); return; }
  adoptDb(r.db);
  render();
  toast('되돌렸어요. [회수 신청]을 다시 누르면 됩니다.', 6000);
}
