
// ---------- 주문/시딩 목록 ----------
function renderSend() {
  const notDone = x => x.status !== '발송완료' && x.status !== '취소됨';
  const pending = [
    ...DB.orders.filter(notDone).map(x => ({ kind: 'orders', icon: x.exchange ? '🔁' : '🛒', x })),
    ...DB.seeding.filter(notDone).map(x => ({ kind: 'seeding', icon: '🎁', x }))
  ];
  // 엑셀로 접수 중인 건은 기본 체크 해제 (바로 접수와 겹쳐 두 번 보내는 것 방지)
  for (const p of pending) {
    if ((p.x.status === '접수중' || epostOperationUnresolved(p.x)) && p.x._sel === undefined) p.x._sel = false;
    if (p.x.shippingHold || p.x.sheetCancelHold) p.x._sel = false;
  }
  const gmap = new Map();
  for (const p of pending) {
    const key = pendingFulfillmentKey(p.kind, p.x);
    if (!gmap.has(key)) gmap.set(key, []);
    gmap.get(key).push(p);
  }
  const groupsArr = [...gmap.values()];
  const selectedGroups = groupsArr.filter(g => !g.some(p => p.x.shippingHold || p.x.sheetCancelHold) && g.every(p => p.x._sel !== false));
  const selCount = selectedGroups.length;
  const selProductQty = productQuantity(selectedGroups.flat(), entry => entry.x);
  const mergeSuggestions = HamItemLines.cafe24MergeSuggestions(
    pending,
    DB.orders.map(x => ({ kind: 'orders', x }))
  );
  const stockStates = HamItemLines.shipmentStockStates(DB.orders.filter(notDone), DB.inventory || []);
  const c24 = SYNC_STATUS && SYNC_STATUS.cafe24;
  const goo = SYNC_STATUS && SYNC_STATUS.google;
  const gline = !goo || goo.ok == null ? ''
    : goo.ok ? '🟢 구글시트(시딩) 자동 연동 중'
    : '🔴 구글시트에서 못 가져왔어요 — 인터넷과 시트 공유 설정을 확인하세요. <button class="link-btn" onclick="go(\'settings\')">설정 보기</button>';
  const c24line = window._VIEW
    ? (window._C24OWNER
      ? '🔵 노트북 모드: 매장 컴퓨터가 꺼져 있어 <b>주문 수집·접수까지 노트북이 대신하는 중</b>이에요 (매장이 켜지면 자동으로 넘겨요)'
      : '🔵 노트북 모드: 매장 컴퓨터가 켜져 있어요 — <b>시딩(🎁)은 여기서 접수 가능</b>, 주문(🛒)은 매장 화면에서')
    : !c24 || !c24.configured
    ? '⚪ 카페24 자동 연동이 아직 설정되지 않았어요. <button class="link-btn" onclick="go(\'settings\')">설정하러 가기</button>'
    : !c24.connected
      ? '🟡 카페24 연결이 필요해요. <button class="link-btn" onclick="go(\'settings\')">설정에서 연결하기</button>'
      : c24.ok === false
        ? '🔴 카페24에서 가져오기 실패: ' + esc(c24.error || '')
        : '🟢 카페24 자동 연동 중';

  const rows = groupsArr.map(g => {
    const first = g[0].x;
    const groupProductQty = productQuantity(g, entry => entry.x);
    const spec = g.map(p => p.kind + ':' + p.x.id).join(',');
    const postalPending = g.some(p => epostOperationUnresolved(p.x));
    const shippingHold = g.some(p => p.x.shippingHold);
    const sheetCancelHold = g.some(p => p.x.sheetCancelHold);
    const allSel = !postalPending && !shippingHold && !sheetCancelHold && g.every(p => p.x._sel !== false);
    const kinds = [...new Set(g.map(p => p.x.exchange ? '🔁 교환' : p.kind === 'seeding' ? seedingSourceLabel(p.x) : '🛒 주문'))].join('<br>');
    const names = g.map(p => {
      const parts = productParts(p.x);
      if (p.kind !== 'orders' || !p.x.orderNo) return `<div style="margin:0.1rem 0">${parts.name}</div>`;
      const originalRows = DB.orders.filter(row => row.orderNo === p.x.orderNo && row.status !== '취소됨');
      const canSplitOrder = originalRows.length > 1 && originalRows.every(row =>
        row.status === '대기' && !row.invoice && !row.epost && !epostOperationUnresolved(row) &&
        !row.packGroupId && !row.parcelSplitId && !row.shippingHold
      );
      const stock = stockStates.get(p.x.id) || { state: 'unknown' };
      const shortage = stock.state === 'shortage'
        ? `<span class="note-badge" style="background:#fdecea;color:#c0392b">재고 ${stock.available}개 · 필요 ${stock.needed}개</span>`
        : stock.state === 'unknown' ? `<span class="note-badge">실물재고 확인 필요</span>` : '';
      let action = '';
      if (p.x.parcelSplitId) {
        action = p.x.shippingHold
          ? `<span class="note-badge" style="background:#fff3cd;color:#8a5a00">분리배송 · 재고 기다림</span> <button class="link-btn" onclick="releaseSplit(${p.x.id},'${jsq(p.x.name)}')">재고 들어옴 · 이제 보내기</button> <button class="link-btn" onclick="undoSplit('${jsq(p.x.orderNo)}','${jsq(p.x.name)}')">원주문으로 합치기</button>`
          : `<span class="note-badge">분리배송</span> <button class="link-btn" onclick="undoSplit('${jsq(p.x.orderNo)}','${jsq(p.x.name)}')">원주문으로 합치기</button>`;
      } else if (canSplitOrder) {
        action = `${shortage} <button class="link-btn" onclick="splitForLater(${p.x.id},'${jsq(p.x.name)}','${jsq(String(p.x.product || '').split('\n')[0])}')">이 상품만 나중에 보내기</button>`;
      }
      return `<div style="margin:0.1rem 0 0.3rem">${parts.name}${action ? `<div style="margin-top:0.15rem;font-size:0.82rem">${action}</div>` : ''}</div>`;
    }).join('');
    const opts = g.map(p => `<div style="margin:0.1rem 0">${productParts(p.x).opt || '<span class="muted">-</span>'}</div>`).join('');
    const notes = g.map(p => shipmentMemoHtml(p.x)).filter(Boolean).join('');
    const noZip = !/^\d{5}$/.test(String(first.zip || '').trim()) && !matchZipInAddr(first.addr);
    const stusSet = [...new Set(g.map(p => p.x.status))];
    // 3일 넘게 그대로면: 앱 밖(우체국 창구·사이트)에서 이미 보냈는데 앱만 모르는 경우가 많다
    const staleDays = Math.max(...g.map(p => p.x.regDate ? Math.floor((Date.now() - new Date(p.x.regDate)) / 86400000) : 0));
    const staleBadge = staleDays >= 3 ? `<span class="note-badge" title="우체국 사이트·창구에서 직접 보내셨다면 [따로 보냈어요]를 눌러 정리해 주세요">⏰ ${staleDays}일째 그대로</span><br>` : '';
    // 접수 시도에서 "이미 보낸 것과 같은 내용"으로 막힌 건: 확인 후 한 번 더 보내기 허용
    const dupHere = g.filter(p => (window._dupIds || new Set()).has(p.kind + ':' + p.x.id) && !p.x.resendOk);
    const dupBadge = dupHere.length ? `<span class="note-badge" style="background:#fdecea;color:#c0392b">🚫 이미 보낸 것과 같음</span><br><button class="link-btn" style="font-size:0.85rem" onclick="resendOkGroup('${dupHere.map(p => p.kind + ':' + p.x.id).join(',')}','${jsq(first.name)}')">🔁 한 번 더 보내기</button><br>` : '';
    const mergeSuggestion = mergeSuggestions.find(s => s.entries.some(entry => g.includes(entry)));
    const mergeSpec = mergeSuggestion ? mergeSuggestion.entries.map(p => p.kind + ':' + p.x.id).join(',') : '';
    const packingAction = first.packGroupId
      ? `<br><span class="note-badge">합포장 확정</span> <button class="link-btn" style="font-size:0.82rem" onclick="packUnmerge('${jsq(first.packGroupId)}','${jsq(first.name)}')">묶음 풀기</button>`
      : mergeSuggestion
        ? `<br><button class="link-btn" style="font-size:0.82rem" onclick="packMerge('${mergeSpec}','${jsq(first.name)}')">📦 Cafe24 주문 ${mergeSuggestion.orderNos.length}건 합포하기</button>`
        : '';
    return `
    <tr class="${allSel ? 'checked-row' : ''}">
      <td><input type="checkbox" ${allSel ? 'checked' : ''} ${postalPending || shippingHold || sheetCancelHold ? 'disabled' : ''} onchange="toggleSelGroup('${spec}',this.checked)"></td>
      <td style="white-space:nowrap">${kinds}</td>
      <td><b>${esc(first.name)}</b>${first.insta ? `<br><span class="muted" style="font-size:0.85rem">${esc(first.insta)}</span>` : ''}<br><span class="note-badge">📦 택배 1건 · 상품 ${groupProductQty}개</span>${packingAction}</td>
      <td>${esc(first.phone)}</td>
      <td style="max-width:420px">${esc(first.addr)}${noZip ? `
        <div style="margin-top:0.3rem;white-space:nowrap"><span class="note-badge">⚠️ 우편번호 없음</span>
        <input id="zip-g-${g[0].kind}-${first.id}" style="width:5.5rem;font-size:0.95rem;padding:0.25rem 0.4rem;border:2px solid var(--line);border-radius:8px" placeholder="5자리" maxlength="5">
        <button class="link-btn" style="font-size:0.9rem" onclick="fixZipGroup('${spec}','zip-g-${g[0].kind}-${first.id}')">저장</button></div>
        ${first.zipLookupError
          ? `<div style="margin-top:0.25rem;color:var(--red);font-size:0.84rem">${esc(first.zipLookupError)} <button class="link-btn" onclick="retryZip('${g[0].kind}',${first.id})">다시 찾기</button></div>`
          : `<div class="muted" style="margin-top:0.25rem;font-size:0.84rem">주소로 자동 검색 중…</div>`}` : ''}</td>
      <td style="min-width:240px;max-width:480px">${names}</td>
      <td>${opts}</td>
      <td style="min-width:180px;max-width:300px">${notes || '<span class="muted">-</span>'}</td>
      <td style="white-space:nowrap">${sheetCancelHold ? `<span class="chip wait">시트 송장 정리 필요</span><br><span class="muted" style="font-size:0.8rem">기존 송장을 지우기 전 재발송 금지</span><br><button class="link-btn" style="font-weight:800" onclick="resolveLegacySheetCancel('${spec}','${jsq(first.name)}')">✓ 시트에서 기존 송장 지웠어요</button>` : shippingHold ? '<span class="chip processing">재고 기다림</span><br><span class="muted" style="font-size:0.8rem">우체국 접수에서 자동 제외</span>' : postalPending ? '<span class="chip processing">🛡 우체국 결과 확인 중</span><br><span class="muted" style="font-size:0.8rem">같은 건 재접수 금지</span><br><button class="link-btn" style="font-weight:800" onclick="epostRefresh()">🔄 접수 결과 확인</button>' : `${dupBadge}${staleBadge}${stusSet.map(s => chip(s)).join(' ')}<div class="btn-col" style="margin-top:0.3rem">${stusSet.includes('접수중') ? `<button class="link-btn" style="font-size:0.85rem" onclick="cancelExcelGroup('${spec}','${jsq(first.name)}')">↩️ 엑셀 접수 취소</button>` : ''}<button class="link-btn" style="font-size:0.85rem" onclick="manualShipGroup('${spec}','${jsq(first.name)}')">따로 보냈어요</button><button class="link-btn" style="font-size:0.85rem;color:var(--red)" onclick="cancelSendGroup('${spec}','${jsq(first.name)}')">안 보내요 ✕</button></div>`}</td>
    </tr>`;
  }).join('');

  main().innerHTML = `
    <h1>📮 보내기</h1>
    <div class="sub">카페24 주문(🛒)과 시딩 선물(🎁)을 한 번에 우체국으로 보낼 준비를 해요.</div>
    <div class="card">
      <div class="step-title"><span class="step-num">1</span> 새로 들어온 것 확인</div>
      <div class="hint">주문과 시딩 신청은 <b>5분마다 자동으로</b> 들어와요. 방금 들어온 걸 바로 보고 싶으면 버튼을 누르세요.<br>${c24line}${gline ? '<br>' + gline : ''}</div>
      <button class="big-btn" onclick="doSync()">🔄 지금 바로 확인하기</button>
      <details style="margin-top:1rem">
        <summary style="font-size:1rem;cursor:pointer;color:#5a6478">다른 판매채널 주문 엑셀 넣기 (29CM · 무신사 · 카페24 수동 · 기타)</summary>
        <div class="hint" style="margin-top:0.6rem">채널 어드민에서 내려받은 <b>주문(배송) 엑셀</b>을 그대로 넣으면 돼요. 수령인·주소·상품·수량 열은 자동으로 알아봐요. 같은 주문번호는 두 번 안 들어가요.</div>
        <div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;margin:0.5rem 0">
          <label style="font-weight:700">판매채널</label>
          <select id="upload-channel" style="font-size:1rem;padding:0.4rem 0.6rem;border:2px solid var(--line);border-radius:8px">
            <option value="29cm">29CM</option>
            <option value="musinsa">무신사</option>
            <option value="cafe24">카페24 (자동 연동이 안 될 때만)</option>
            <option value="other">기타 채널</option>
          </select>
        </div>
        <div class="dropzone" id="dz-cafe24" onclick="pickFile('orders')" style="margin-top:0.4rem">
          📂 여기에 주문 엑셀 파일을 끌어다 놓으세요
        </div>
      </details>
    </div>
    <div class="card">
      <div class="step-title"><span class="step-num">2</span> 우체국 접수하기</div>
      ${pending.length ? `
      ${mergeSuggestions.length ? `<div class="result-box" style="background:#fff7e6;border-color:#efb24a;margin-bottom:0.9rem">
        <div class="big">📦 합포 추천 ${mergeSuggestions.length}명</div>
        ${mergeSuggestions.map(s => {
          const spec = s.entries.map(entry => entry.kind + ':' + entry.x.id).join(',');
          const qty = productQuantity(s.entries, entry => entry.x);
          const u = s.units || { orders: s.orderNos.length, seeding: 0 };
          const what = [u.orders ? `주문 ${u.orders}건` : '', u.seeding ? `시딩 ${u.seeding}건` : ''].filter(Boolean).join(' + ');
          return `<div style="margin-top:0.45rem"><b>${esc(s.name)}</b>님에게 따로 나갈 택배가 ${s.orderNos.length}건(${what}) 있어요. 상품 ${qty}개를 한 비닐에 넣고 송장 1개로 보낼 수 있어요. <button class="big-btn orange" style="padding:0.35rem 0.8rem;font-size:0.88rem" onclick="packMerge('${spec}','${jsq(s.name)}')">한 비닐로 묶기</button></div>`;
        }).join('')}
      </div>` : ''}
      <div class="hint">보낼 목록이에요. 빼고 싶은 사람은 체크를 풀면 돼요. (기본은 전체 선택)</div>
      <div style="margin-bottom:0.5rem">
        <button class="link-btn" onclick="selAll(true)">✅ 전체 선택</button> ·
        <button class="link-btn" onclick="selAll(false)">⬜ 전체 해제</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>보내기</th><th>구분</th><th>이름</th><th>연락처</th><th>주소</th><th>제품</th><th>옵션</th><th>포장·비고</th><th>상태</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:1rem; display:flex; gap:0.8rem; flex-wrap:wrap">
        ${SYNC_STATUS && SYNC_STATUS.epost && SYNC_STATUS.epost.connected
          ? `<button class="big-btn green" onclick="doEpostRegister()">🚀 택배 ${selCount}건 우체국 바로 접수</button>
             <button class="big-btn gray" onclick="doExportAll()">📄 엑셀 파일로 만들기 (바로 접수가 안 될 때)</button>`
          : `<button class="big-btn green" onclick="doExportAll()">📄 택배 ${selCount}건 우체국 엑셀 만들기</button>`}
        <button class="big-btn orange" onclick="window.open('/pick.html','_blank')">📋 오늘 쌀 목록 인쇄</button>
      </div>
      <div class="hint" style="margin-top:0.9rem"><b>현재 선택:</b> 택배 <b>${selCount}건</b> · 포장할 상품 <b>${selProductQty}개</b></div>
      <div id="export-result"></div>` : `
      <div class="hint" style="font-size:1.1rem">지금은 보낼 것이 없어요. 새 주문·신청이 들어오면 여기에 자동으로 나타나요. 😊</div>`}
    </div>
    <div class="card">
      <div class="step-title"><span class="step-num">3</span> 송장번호 붙이기 <span class="note-badge">⚠️ 엑셀로 접수했을 때만</span></div>
      <div class="hint"><b>[🚀 우체국 바로 접수]</b>로 보냈다면 이 단계는 필요 없어요 — 송장번호가 자동으로 붙어요.<br>엑셀(예비)로 접수했을 때만, 우체국에서 받은 <b>송장번호 엑셀</b>을 아래 상자에 끌어다 놓으세요.<br>짝 맞추기 → 카페24 배송처리 → 재고 차감 → 구글시트 기록까지 한 번에 됩니다.</div>
      <div class="dropzone" id="dz-invoice" onclick="pickFile('invoice')">
        📥 여기에 우체국 송장 엑셀을 끌어다 놓으세요
        <span class="small">또는 이 상자를 눌러서 파일을 선택하세요</span>
      </div>
      <div id="invoice-result"></div>
    </div>`;
  setupDropzones();
  // ⚠️ 우편번호 없는 건은 즉시 자동 조회 시작
  setTimeout(() => {
    for (const g of groupsArr) {
      for (const p of g) {
        const x = p.x;
        if (!/^\d{5}$/.test(String(x.zip || '').trim()) && !matchZipInAddr(x.addr)) autoZip(p.kind, x.id);
      }
    }
  }, 100);
}

// 주소 안에 5자리 우편번호가 이미 들어있는지
function matchZipInAddr(addr) {
  const s = String(addr || '');
  return /\((\d{5})\)/.test(s) || /\(우\)?\s*\d{5}/.test(s) || /우편번호[:\s]*\d{5}/.test(s) || /(^|\s)\d{5}(\s|$|\))/.test(s);
}
// 우편번호 없는 건에 손으로 5자리 넣기
async function fixZip(kind, id) {
  const inp = document.getElementById(`zip-${kind}-${id}`);
  const z = (inp ? inp.value : '').replace(/\D/g, '');
  if (z.length !== 5) { toast('우편번호는 숫자 5자리예요. 예: 07997'); if (inp) inp.focus(); return; }
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const x = list.find(i => i.id === id);
  if (!x) return;
  x.zip = z;
  delete x.zipLookupError;
  await saveDb();
  render();
  toast('✔️ 우편번호를 저장했어요. 이제 접수할 수 있어요.');
}
// 엑셀로 만든 접수를 취소하고 다시 [보낼 준비]로
async function cancelExcel(kind, id, name) {
  if (!confirm(`${name}님 건의 엑셀 접수를 취소하고 [보낼 준비]로 되돌릴까요?\n(우체국 사이트에 이미 파일을 올렸다면 거기서도 지워 주세요)`)) return;
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const x = list.find(i => i.id === id);
  if (!x) return;
  x.status = '대기';
  await saveDb();
  render();
  toast('✔️ [보낼 준비]로 되돌렸어요.');
}

// "kind:id,kind:id" 묶음 스펙 → 실제 항목들
// 우편번호 없는 건: 화면에 뜨는 즉시 자동 조회 (건당 1회)
function zipAskKey(kind, id) {
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const item = list.find(x => x.id === id);
  return kind + ':' + id + ':' + String(item && item.addr || '').trim();
}
async function autoZip(kind, id, force = false) {
  window._zipAsked = window._zipAsked || new Set();
  const key = zipAskKey(kind, id);
  if (!force && window._zipAsked.has(key)) return;
  window._zipAsked.add(key);
  const r = await api('/api/zip/lookup', { method: 'POST', body: JSON.stringify({ type: kind, id, force }) });
  if (r && r.db) adoptDb(r.db);
  if (r && r.ok && r.zip) {
    if (PAGE === 'send') render();
    toast('✔️ 우편번호를 자동으로 찾아 넣었어요: ' + r.zip, 5000);
  } else {
    if (!(r && r.db)) {
      const list = kind === 'seeding' ? DB.seeding : DB.orders;
      const item = list.find(x => x.id === id);
      if (item) item.zipLookupError = (r && r.error) || '우편번호 조회 연결에 문제가 있어요. [다시 찾기]를 눌러 주세요.';
    }
    if (PAGE === 'send') render();
  }
  return r;
}
async function retryZip(kind, id) {
  const key = zipAskKey(kind, id);
  if (window._zipAsked) window._zipAsked.delete(key);
  const r = await autoZip(kind, id, true);
  if (!(r && r.ok && r.zip)) toast('⚠️ ' + ((r && r.error) || '주소를 확인한 뒤 다시 눌러 주세요.'), 6000);
}
// 전체 선택/해제 (보내기 목록)
function selAll(v) {
  const notDone = x => x.status !== '발송완료' && x.status !== '취소됨';
  for (const list of [DB.orders, DB.seeding]) {
    for (const x of list) if (notDone(x)) x._sel = x.shippingHold || x.sheetCancelHold ? false : v;
  }
  render();
}
function specItems(spec) {
  const out = [];
  for (const part of String(spec).split(',')) {
    const [kind, id] = part.split(':');
    const list = kind === 'seeding' ? DB.seeding : DB.orders;
    const x = list.find(i => i.id === Number(id));
    if (x) out.push({ kind, x });
  }
  return out;
}
function toggleSelGroup(spec, checked) {
  for (const { x } of specItems(spec)) x._sel = checked;
  render();
}
async function fixZipGroup(spec, inputId) {
  const inp = document.getElementById(inputId);
  const z = (inp ? inp.value : '').replace(/\D/g, '');
  if (z.length !== 5) { toast('우편번호는 숫자 5자리예요. 예: 07997'); if (inp) inp.focus(); return; }
  for (const { x } of specItems(spec)) {
    x.zip = z;
    delete x.zipLookupError;
  }
  await saveDb();
  render();
  toast('✔️ 우편번호를 저장했어요. 이제 접수할 수 있어요.');
}
async function cancelSendGroup(spec, name) {
  const items = specItems(spec);
  if (!confirm(`${name}님 건(${items.length}개)을 보내지 않기로 할까요?\n\n· 보내기 목록에서 빠져요\n· [🚚 배송 확인]에서 [다시 보내기]로 언제든 되돌릴 수 있어요`)) return;
  for (const { x } of items) { x.status = '취소됨'; x.manualCanceled = true; }
  await saveDb();
  render();
  toast('✔️ 취소했어요. 마음이 바뀌면 [배송 확인]에서 [다시 보내기]를 누르세요.', 6000);
}
async function cancelExcelGroup(spec, name) {
  if (!confirm(`${name}님 건의 엑셀 접수를 취소하고 [보낼 준비]로 되돌릴까요?\n(우체국 사이트에 이미 파일을 올렸다면 거기서도 지워 주세요)`)) return;
  for (const { x } of specItems(spec)) if (x.status === '접수중') x.status = '대기';
  await saveDb();
  render();
  toast('✔️ [보낼 준비]로 되돌렸어요.');
}
async function resolveLegacySheetCancel(spec, name) {
  if (!confirm(`${name}님 행의 예전 송장번호와 발송일을 구글시트에서 직접 지웠나요?\n\n[확인]을 누르면 재발송할 수 있고, 새 송장은 시트에 다시 기록됩니다.`)) return;
  const ids = specItems(spec).filter(entry => entry.kind === 'seeding').map(entry => entry.x.id);
  const result = await api('/api/seeding/cancel-sheet-resolved', {
    method: 'POST',
    body: JSON.stringify({ ids })
  });
  if (result.error) {
    toast('시트 정리 완료를 기록하지 못했어요. 잠시 뒤 다시 눌러 주세요.', 6000);
    return;
  }
  adoptDb(result.db);
  render();
  toast('시트 정리를 확인했어요. 이제 새 송장으로 다시 보낼 수 있어요.', 6000);
}
async function manualShipGroup(spec, name) {
  const items = specItems(spec);
  if (!confirm(`${name}님 것(${items.length}개)을 우체국 창구 등 앱 밖에서 정말 이미 보내셨나요?\n\n· [보냄 ✓]으로 확정돼요 (재고 차감 · 카페24 배송처리 · 시트 기록까지 자동)\n· 한 번 확정하면 되돌리기 어려워요`)) return;
  const inv = prompt('송장번호가 있으면 입력해 주세요.\n없으면 빈칸 그대로 [확인]을 누르세요.');
  if (inv === null) return;
  busy(true, '발송완료로 정리하는 중…');
  const first = items[0];
  const r = first
    ? await api('/api/manual-ship', { method: 'POST', body: JSON.stringify({ type: first.kind === 'seeding' ? 'seeding' : 'order', id: first.x.id, invoice: (inv || '').trim() }) })
    : { error: '처리할 포장을 찾지 못했어요.' };
  if (!r.error) adoptDb(r.db);
  busy(false);
  render();
  toast(r.error ? '⚠️ 처리하지 못했어요: ' + r.error : `✔️ ${name}님 포장 전체를 발송완료로 정리했어요.`, 7000);
}

function toggleSel(kind, id, checked) {
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const item = list.find(x => x.id === id);
  if (item) item._sel = checked;
  render();
}

// "이미 보낸 것과 같은 내용" 차단을 확인받고 풀어줌 → 다시 접수하면 한 번 더 보내진다
async function resendOkGroup(spec, name) {
  if (!confirm(`${name}님에게 같은 내용을 이미 보낸 적이 있어요.\n\n정말 한 번 더 보낼까요?\n(확인을 누르면 다음 접수 때 이 건이 정상 접수돼요)`)) return;
  for (const s of spec.split(',')) {
    const [kind, id] = s.split(':');
    const r = await api('/api/resend-ok', { method: 'POST', body: JSON.stringify({ type: kind === 'seeding' ? 'seeding' : 'order', id: Number(id) }) });
    if (r.error) { toast('⚠️ ' + r.error, 5000); return; }
    if (r.db) DB = r.db;
    if (window._dupIds) window._dupIds.delete(s);
  }
  renderSend();
  toast('✔️ 확인했어요. 이제 [우체국 바로 접수]를 누르면 한 번 더 보내져요.', 6000);
}

async function packMerge(spec, name) {
  if (!confirm(`${name}님의 서로 다른 출고를 한 비닐에 같이 넣을까요?\n\n· 송장번호는 1개만 나옵니다\n· 제품은 모두 같은 비닐에 포장해야 합니다`)) return;
  const selected = spec.split(',').filter(Boolean).map(s => {
    const [kind, id] = s.split(':');
    return { type: kind === 'seeding' ? 'seeding' : 'order', id: Number(id) };
  });
  const r = await api('/api/packing/merge', { method: 'POST', body: JSON.stringify({ selected }) });
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  DB = r.db;
  renderSend();
  toast(`✔️ 한 비닐로 묶었어요. 택배 1건에 상품 ${r.count}개가 들어갑니다.`, 6000);
}

async function packUnmerge(packGroupId, name) {
  if (!confirm(`${name}님의 합포장을 풀까요?\n각 주문·신청별로 송장이 따로 나옵니다.`)) return;
  const r = await api('/api/packing/unmerge', { method: 'POST', body: JSON.stringify({ packGroupId }) });
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  DB = r.db;
  renderSend();
  toast('✔️ 합포장을 풀었어요. 출고가 각각 따로 보입니다.', 5000);
}

async function splitForLater(id, name, product) {
  if (!confirm(`${name}님의 '${product}'만 나중에 따로 보낼까요?\n\n· 지금 보내는 상품들은 먼저 송장 1개로 나갑니다\n· 이 상품은 재고가 들어올 때까지 우체국 접수에서 빠집니다\n· 재고가 들어오면 [재고 들어옴 · 이제 보내기]를 누르면 별도 송장이 나옵니다`)) return;
  const r = await api('/api/packing/split', { method: 'POST', body: JSON.stringify({ id }) });
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  adoptDb(r.db);
  const item = DB.orders.find(row => row.id === id);
  if (item) item._sel = false;
  renderSend();
  toast('✔️ 이 상품을 분리배송 대기로 옮겼어요. 지금 우체국 접수에서는 자동으로 빠집니다.', 6000);
}

async function releaseSplit(id, name) {
  if (!confirm(`${name}님의 분리배송 상품 재고가 실제로 들어왔나요?\n\n[확인]을 누르면 보내기 체크가 켜지고, 다음 우체국 접수 때 별도 송장이 발급됩니다.`)) return;
  const r = await api('/api/packing/split/release', { method: 'POST', body: JSON.stringify({ id }) });
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  adoptDb(r.db);
  const item = DB.orders.find(row => row.id === id);
  if (item) item._sel = true;
  renderSend();
  toast('✔️ 별도 배송할 준비가 됐어요. 체크된 상태로 다음 우체국 접수에 포함됩니다.', 6000);
}

async function undoSplit(orderNo, name) {
  if (!confirm(`${name}님의 분리배송을 취소하고 원래 주문 한 송장으로 다시 합칠까요?\n모든 상품이 아직 접수 전일 때만 가능합니다.`)) return;
  const r = await api('/api/packing/split/undo', { method: 'POST', body: JSON.stringify({ orderNo }) });
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  adoptDb(r.db);
  for (const item of DB.orders.filter(row => row.orderNo === orderNo)) item._sel = true;
  renderSend();
  toast('✔️ 원래 주문 한 송장으로 다시 합쳤어요.', 5000);
}


async function doExportAll() {
  const sendable = x => x.status !== '발송완료' && x.status !== '취소됨' &&
    x.status !== '접수중' && !x.shippingHold && !x.sheetCancelHold && !epostOperationUnresolved(x) && x._sel !== false;
  const candidates = [
    ...DB.orders.filter(x => x.status !== '발송완료' && x.status !== '취소됨').map(x => ({ type: 'order', kind: 'orders', x })),
    ...DB.seeding.filter(x => x.status !== '발송완료' && x.status !== '취소됨').map(x => ({ type: 'seeding', kind: 'seeding', x }))
  ];
  const selected = HamItemLines.fullySelectedEntries(
    candidates,
    entry => pendingFulfillmentKey(entry.kind, entry.x),
    entry => sendable(entry.x)
  ).map(entry => ({ type: entry.type, id: entry.x.id }));
  if (!selected.length) { toast('선택된 사람이 없어요.'); return; }
  const parcelCount = selectedShipmentCount(selected);
  if (!confirm(`택배 ${parcelCount}건짜리 우체국 엑셀 파일을 내려받을까요?\n\n· 이 컴퓨터의 다운로드 폴더에 저장돼요.\n· 목록이 [엑셀 접수 중]으로 바뀌어요 (잘못 눌렀으면 [↩️ 엑셀 접수 취소]로 되돌려요)`)) return;
  busy(true, '우체국 엑셀을 만드는 중…');
  try {
    const response = await fetch('/api/export/epost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected })
    });
    const contentType = String(response.headers.get('Content-Type') || '');
    if (contentType.includes('application/json')) {
      const result = await response.json();
      throw new Error(result.error || '엑셀 파일을 만들지 못했어요.');
    }
    if (!response.ok) throw new Error('엑셀 파일을 만들지 못했어요.');
    const disposition = String(response.headers.get('Content-Disposition') || '');
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const filename = match ? decodeURIComponent(match[1]) : '우체국접수.xlsx';
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    adoptDb(await api('/api/db'));
    render();
    const box = $('#export-result');
    if (box) box.innerHTML = `
      <div class="result-box ok">
        <div class="big">다 됐어요. 택배 ${parcelCount}건짜리 엑셀을 내려받았어요.</div>
        이 컴퓨터의 <b>다운로드 폴더</b>에서 <b>${esc(filename)}</b> 파일을 찾으세요.<br>
        우체국에서 <b>계약소포 → 파일등록 → [찾기]</b>를 누른 뒤 이 파일을 선택하면 됩니다.
      </div>`;
    window.scrollTo(0, document.body.scrollHeight);
  } catch (error) {
    toast('⚠️ ' + (error.message || '엑셀 파일을 만들지 못했어요.'), 7000);
  } finally {
    busy(false);
  }
}

// 앱 밖에서 따로 보낸 건 정리 (우체국 창구, 다른 택배 등)
async function manualShip(kind, id, name) {
  if (!confirm(`${name}님 것을 우체국 창구 등 앱 밖에서 정말 이미 보내셨나요?\n\n· [보냄 ✓]으로 확정돼요 (재고 차감 · 카페24 배송처리 · 시트 기록까지 자동)\n· 한 번 확정하면 되돌리기 어려워요`)) return;
  const inv = prompt(`${name}님 것을 앱 밖에서 이미 보내셨군요!\n\n송장번호가 있으면 입력해 주세요.\n없으면 빈칸 그대로 [확인]을 누르세요.`);
  if (inv === null) return;
  busy(true, '발송완료로 정리하는 중…');
  const r = await api('/api/manual-ship', { method: 'POST', body: JSON.stringify({ type: kind === 'seeding' ? 'seeding' : 'order', id, invoice: (inv || '').trim() }) });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  adoptDb(r.db);
  render();
  const extras = [];
  if (r.stock && r.stock.length) extras.push('재고 차감');
  if (r.stockMissing && r.stockMissing.length) extras.push(`재고 확인 필요 ${r.stockMissing.length}개`);
  if (r.cafe24 && r.cafe24.some(c => c.ok)) extras.push('카페24 배송처리');
  if (r.sheet && r.sheet.ok) extras.push('구글시트 기록');
  toast(`✔️ ${name}님 건을 발송완료로 정리했어요.` + (extras.length ? ' (자동: ' + extras.join(' · ') + ')' : ''), 7000);
}

// 우체국 OpenAPI 바로 접수
async function doEpostRegister() {
  // '접수중'(엑셀로 이미 접수)은 제외 — 같은 사람에게 두 번 보내는 것 방지
  const sendable = x => x.status !== '발송완료' && x.status !== '취소됨' && x.status !== '접수중' &&
    !x.shippingHold && !x.sheetCancelHold && x._sel !== false;
  const candidates = [
    ...DB.orders.filter(x => x.status !== '발송완료' && x.status !== '취소됨').map(x => ({ type: 'order', kind: 'orders', x })),
    ...DB.seeding.filter(x => x.status !== '발송완료' && x.status !== '취소됨').map(x => ({ type: 'seeding', kind: 'seeding', x }))
  ];
  const selected = HamItemLines.fullySelectedEntries(
    candidates,
    entry => pendingFulfillmentKey(entry.kind, entry.x),
    entry => sendable(entry.x)
  ).map(entry => ({ type: entry.type, id: entry.x.id }));
  if (!selected.length) { toast('선택된 사람이 없어요.'); return; }
  const parcelCount = selectedShipmentCount(selected);
  if (!confirm(`택배 ${parcelCount}건을 우체국에 바로 접수할까요?\n(접수하면 송장번호가 발급되고 요금이 계산돼요)`)) return;
  busy(true, '우체국에 접수하는 중…');
  const r = await api('/api/epost/register', { method: 'POST', body: JSON.stringify({ selected }) });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 7000); return; }
  adoptDb(r.db);
  // 중복이라 막힌 건들: 목록에 [한 번 더 보내기] 버튼을 띄우기 위해 기억
  window._dupIds = new Set((r.dups || []).map(d => (d.type === 'seeding' ? 'seeding' : 'orders') + ':' + d.id));
  render();
  const ok = r.results.filter(x => x.ok);
  const fail = r.results.filter(x => !x.ok);
  let html = '';
  if (ok.length) {
    const printSel = [
      ...DB.orders.filter(x => x.epost && x.epost.label && ok.some(o => o.regiNo === x.invoice)).map(x => 'order:' + x.id),
      ...DB.seeding.filter(x => x.epost && x.epost.label && ok.some(o => o.regiNo === x.invoice)).map(x => 'seeding:' + x.id)
    ];
    html += `<div class="result-box ok"><div class="big">✅ 우체국 접수 완료! 송장번호가 나왔어요.</div>` +
      ok.map(x => `${esc(x.name)} → 송장 <b>${esc(x.regiNo)}</b>${x.price ? ' (예상요금 ' + esc(x.price) + '원)' : ''}`).join('<br>') +
      (printSel.length ? `<div style="margin-top:0.8rem"><button class="big-btn green" onclick="printLabels('${printSel.join(',')}')">🖨 운송장 인쇄</button></div>` : '') +
      `<div class="muted" style="font-size:0.95rem;font-weight:400;margin-top:0.6rem">이 내용은 [📦 우체국 접수] 화면에서 언제든 다시 볼 수 있어요.</div></div>`;
  }
  if (fail.length) {
    html += `<div class="result-box err"><div class="big">⚠️ 접수 못 한 건 ${fail.length}건</div>` +
      fail.map(x => `${esc(x.name)}: ${esc(x.error)}`).join('<br>') + '</div>';
  }
  const extra = [];
  if (r.cafe24 && r.cafe24.length) {
    const c = r.cafe24.filter(x => x.ok).length;
    if (c) extra.push(`🛒 카페24에도 송장 ${c}건 자동 등록 완료`);
    r.cafe24.filter(x => !x.ok).slice(0, 3).forEach(f => extra.push(`🛒 카페24 등록 못 함 (${esc(f.orderNo)}): ${esc(f.error)}`));
  }
  if (r.stock && r.stock.length) extra.push('📋 재고 자동 차감: ' + r.stock.map(s => `${esc(s.name)} −${s.minus}`).join(', '));
  if (r.stockMissing && r.stockMissing.length) {
    extra.push('⚠️ 재고에서 못 찾음: ' + r.stockMissing.map(s => `${esc(s.product)}${s.option ? ' (' + esc(s.option) + ')' : ''}`).join(', ') + ' — [재고]에서 SKU를 확인해 주세요.');
  }
  if (r.sheet) extra.push(r.sheet.ok ? `📝 구글시트에도 송장 ${r.sheet.count}건 기록 완료` : `📝 구글시트 기록 실패: ${esc(r.sheet.error)}`);
  if (extra.length) html += `<div class="result-box ok" style="font-weight:400">${extra.join('<br>')}</div>`;
  const box = $('#export-result');
  if (box) box.innerHTML = html;
  window.scrollTo(0, document.body.scrollHeight);
}


function pickFile(which) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls,.csv';
  input.onchange = () => { if (input.files[0]) uploadFile(which, input.files[0]); };
  input.click();
}

async function uploadFile(which, file) {
  if (file.size > 10 * 1024 * 1024) {
    toast('⚠️ 파일이 너무 커요. 10MB 이하 엑셀 또는 CSV 파일을 골라 주세요.', 7000);
    return;
  }
  // 주문 엑셀은 화면에서 고른 판매채널을 함께 보낸다 (옛 'cafe24' 드롭존 호출도 같은 경로)
  const channelSel = document.getElementById('upload-channel');
  const channel = (which === 'orders' || which === 'cafe24') ? (channelSel ? channelSel.value : 'cafe24') : '';
  if (which === 'cafe24') which = 'orders';
  busy(true, '파일을 읽는 중…');
  try {
    const buf = await file.arrayBuffer();
    const r = await api('/api/upload/' + which + (channel ? '?channel=' + encodeURIComponent(channel) : ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
      body: buf
    });
    busy(false);
    if (r.error) { toast('⚠️ ' + r.error, 7000); return; }
    adoptDb(r.db);
    if (which === 'orders') {
      render();
      const chName = { cafe24: '카페24', '29cm': '29CM', musinsa: '무신사', other: '기타 채널' }[r.channel] || '';
      toast(`✔️ ${chName} 주문 ${r.added}건을 새로 가져왔어요.` + (r.total - r.added > 0 ? ` (이미 있던 ${r.total - r.added}건은 건너뜀)` : ''), 6000);
    } else {
      render();
      const box = $('#invoice-result');
      let html = '';
      if (r.matched.length) {
        html += `<div class="result-box ok"><div class="big">✅ ${r.matched.length}건의 송장번호를 붙였어요!</div>` +
          r.matched.slice(0, 10).map(m => `${esc(m.name)} → ${esc(m.invoice)}`).join('<br>') +
          (r.matched.length > 10 ? `<br>… 외 ${r.matched.length - 10}건` : '') + '</div>';
      }
      if (r.unmatched.length) {
        html += `<div class="result-box warn"><div class="big">⚠️ 짝을 못 찾은 송장 ${r.unmatched.length}건</div>` +
          r.unmatched.slice(0, 10).map(u => `${esc(u.invoice)} (${esc(u.name || '이름 없음')}) - ${esc(u.reason)}`).join('<br>') +
          '<br><span style="font-weight:400">이미 처리됐거나 이름이 다른 경우예요. 배송 확인 화면에서 직접 확인해 주세요.</span></div>';
      }
      // 자동 후처리 결과
      const extra = [];
      if (r.cafe24 && r.cafe24.length) {
        const ok = r.cafe24.filter(c => c.ok).length;
        const fail = r.cafe24.filter(c => !c.ok);
        if (ok) extra.push(`🛒 카페24에도 송장 ${ok}건을 자동 등록하고 배송중으로 바꿨어요.`);
        for (const f of fail.slice(0, 3)) extra.push(`🛒 카페24 등록 못 함 (주문 ${esc(f.orderNo)}): ${esc(f.error)}`);
      }
      if (r.stock && r.stock.length) {
        extra.push('📋 재고에서 자동으로 뺐어요: ' + r.stock.slice(0, 6).map(s => `${esc(s.name)} −${s.minus} (남은 ${s.left}개)`).join(', '));
      }
      if (r.stockMissing && r.stockMissing.length) {
        extra.push('⚠️ 재고에서 못 찾은 제품: ' + r.stockMissing.slice(0, 6).map(s => `${esc(s.product)}${s.option ? ' (' + esc(s.option) + ')' : ''}`).join(', ') + ' — [재고]에서 SKU를 확인해 주세요.');
      }
      if (r.sheet) {
        extra.push(r.sheet.ok ? `📝 구글시트에도 송장 ${r.sheet.count}건을 자동으로 적었어요.` : `📝 구글시트 기록 실패: ${esc(r.sheet.error)}`);
      }
      if (extra.length) html += `<div class="result-box ok" style="font-weight:400">${extra.join('<br>')}</div>`;
      if (!html) html = '<div class="result-box warn">이 파일에서 송장번호를 찾지 못했어요.</div>';
      const box2 = $('#invoice-result');
      if (box2) box2.innerHTML = html;
    }
  } catch (e) {
    busy(false);
    toast('⚠️ 파일을 읽지 못했어요: ' + e.message, 7000);
  }
}

function setupDropzones() {
  const zones = [['dz-cafe24', 'cafe24'], ['dz-invoice', 'invoice']];
  for (const [id, which] of zones) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('drag');
      if (e.dataTransfer.files[0]) uploadFile(which, e.dataTransfer.files[0]);
    });
  }
}
