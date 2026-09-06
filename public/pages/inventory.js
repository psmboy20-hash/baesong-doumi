
// ---------- 재고 ----------
function renderInventory() {
  const q = (window._invQ || '').trim();
  const filter = window._invFilter || 'all'; // all | diff | low | zero | unknown
  const counting = !!window._invCount;
  window._invHistOpen = window._invHistOpen || new Set();
  window._invHistCache = window._invHistCache || new Map();
  const invParts = i => {
    const parsed = splitColor(i.name);
    return { name: parsed.base, color: i.color || parsed.color };
  };
  const activeInventory = DB.inventory.filter(i => !i.retiredAggregate);
  const allGroups = new Map();
  for (const i of activeInventory) {
    const k = invParts(i).name;
    if (!allGroups.has(k)) allGroups.set(k, []);
    allGroups.get(k).push(i);
  }
  const groupTotal = g => {
    const aggregate = g.filter(i => i.needsAllocation);
    const source = aggregate.length ? aggregate : g.filter(i => !i.needsCount);
    return source.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
  };
  const c24Known = i => i.cafe24StockTracked && i.cafe24Qty !== null && i.cafe24Qty !== undefined && Number.isFinite(Number(i.cafe24Qty));
  const c24Sellable = i => c24Known(i) && i.cafe24VariantActive !== false && i.cafe24Display !== 'F' && i.cafe24Selling !== 'F';
  const c24SnapshotComplete = rows => rows.length > 0 && rows.every(i =>
    typeof i.cafe24StockTracked === 'boolean' && (!i.cafe24StockTracked || c24Known(i))
  );
  const minQtyOf = i => i.minQty != null && Number.isFinite(Number(i.minQty)) ? Number(i.minQty) : (Number(i.cafe24SafetyInventory) > 0 ? Number(i.cafe24SafetyInventory) : 2);
  const hasDiff = i => c24Known(i) && !i.needsCount && Number(i.qty) !== Number(i.cafe24Qty);
  const isLow = i => !i.needsCount && Number(i.qty) > 0 && Number(i.qty) <= minQtyOf(i);
  const isZero = i => !i.needsCount && Number(i.qty) === 0;
  const activeCafeRows = activeInventory.filter(i => i.variantCode && i.cafe24VariantActive !== false);
  const groupCafeTotal = g => g.filter(c24Sellable).reduce((sum, i) => sum + Number(i.cafe24Qty), 0);
  const totalQty = [...allGroups.values()].reduce((sum, g) => sum + groupTotal(g), 0);
  const cafeTotalQty = activeInventory.filter(c24Sellable).reduce((sum, i) => sum + Number(i.cafe24Qty), 0);
  const hasCafeSnapshot = c24SnapshotComplete(activeCafeRows);
  const diffN = activeInventory.filter(hasDiff).length;
  const lowN = activeInventory.filter(isLow).length;
  const zeroN = activeInventory.filter(isZero).length;
  const unknownN = activeInventory.filter(i => i.needsCount || i.needsAllocation).length;
  const prodN = allGroups.size;
  let items = activeInventory;
  if (!counting) {
    items = q ? items.filter(i => matchQ(i.name + ' ' + (i.color || '') + ' ' + (i.size || '') + ' ' + (i.sku || ''), q)) : items;
    if (filter === 'diff') items = items.filter(hasDiff);
    if (filter === 'low') items = items.filter(isLow);
    if (filter === 'zero') items = items.filter(isZero);
    if (filter === 'unknown') items = items.filter(i => i.needsCount || i.needsAllocation);
  }
  const findP = i => (DB.products || []).find(p => p.no === i.productNo) ||
    (DB.products || []).find(p => lettersOnly(p.name) === lettersOnly(i.name));
  const gmap = new Map();
  const groups = [];
  for (const i of items) {
    const k = invParts(i).name;
    if (!gmap.has(k)) { gmap.set(k, []); groups.push(gmap.get(k)); }
    gmap.get(k).push(i);
  }
  const stChip = i => i.cafe24VariantActive === false
    ? '<span class="chip wait">카페24 옵션 삭제됨</span>'
    : typeof i.cafe24StockTracked !== 'boolean'
    ? '<span class="chip processing">카페24 수량 미확인</span>'
    : !i.cafe24StockTracked
    ? '<span class="chip processing">카페24 재고관리 안 함</span>'
    : !c24Known(i) ? '<span class="chip processing">카페24 수량 미확인</span>'
    : i.cafe24Display === 'F' || i.cafe24Selling === 'F' ? '<span class="chip processing">판매중지</span>'
    : i.cafe24Qty === 0 ? '<span class="chip wait">판매 품절</span>'
    : i.cafe24Qty <= 2 ? '<span class="chip processing">판매재고 부족</span>'
    : '<span class="chip done">판매 가능</span>';
  const diffBadge = i => !c24Known(i) || i.needsCount ? '<span class="muted">-</span>'
    : Number(i.qty) === Number(i.cafe24Qty) ? '<span class="diff-badge zero">=</span>'
    : `<span class="diff-badge ${Number(i.qty) > Number(i.cafe24Qty) ? 'pos' : 'neg'}">${Number(i.qty) > Number(i.cafe24Qty) ? '+' : ''}${Number(i.qty) - Number(i.cafe24Qty)}</span>`;
  const histColspan = 8; // 컬러부터 관리까지 (상품명 열 제외)
  const histRowHtml = i => {
    if (!window._invHistOpen.has(i.id)) return '';
    const cache = window._invHistCache.get(i.id);
    let body;
    if (!cache) body = `<div class="loading-row">불러오는 중…</div>`;
    else if (!cache.length) body = `<div class="empty">이 옵션의 입출고 이력이 없어요.</div>`;
    else body = `<div class="inv-hist-panel"><table>
        <tr><th>날짜</th><th>구분</th><th style="text-align:center">변동</th><th style="text-align:center">남음</th><th>상대·메모</th></tr>
        ${cache.map(e => {
          const reason = normReason(e.reason);
          return `<tr>
            <td class="muted" style="white-space:nowrap">${esc(e.date)} ${esc(new Date(e.ts).toTimeString().slice(0, 5))}</td>
            <td style="white-space:nowrap">${reasonIcon(e.reason)} ${esc(reason)}</td>
            <td style="text-align:center;font-weight:800;color:${e.delta < 0 ? 'var(--out)' : 'var(--in)'}">${e.delta > 0 ? '+' : ''}${e.delta}</td>
            <td style="text-align:center">${e.left}</td>
            <td>${stockRefLabel(e)}</td>
          </tr>`;
        }).join('')}
      </table></div>`;
    return `<tr class="inv-hist-row"><td colspan="${histColspan}">${body}</td></tr>`;
  };
  const rows = groups.map(g => {
    const fullGroup = allGroups.get(invParts(g[0]).name) || g;
    const sum = groupTotal(fullGroup);
    const cafeSum = groupCafeTotal(fullGroup);
    const groupCafeRows = fullGroup.filter(i => i.variantCode && i.cafe24VariantActive !== false);
    const groupCafeComplete = c24SnapshotComplete(groupCafeRows);
    const groupCafeManaged = groupCafeRows.some(i => i.cafe24StockTracked === true);
    const groupCafeLabel = !groupCafeComplete ? '미확인' : groupCafeManaged ? `${cafeSum}개` : '관리 안 함';
    const openInGroup = g.filter(i => window._invHistOpen.has(i.id)).length;
    return g.map((i, idx) => {
      const p = findP(i);
      const display = invParts(i);
      const prodCell = idx === 0 ? `
      <td rowspan="${g.length + openInGroup}" ${g.length > 1 ? 'style="border-top:3px solid #dfe4ee"' : ''}>
        <div class="inv-prod">
          ${p && p.img ? prodImgTag(p.img).replace('class="pimg"', 'class="pimg inv-img"') : ''}
          <div>
            <div class="pname">${p ? `<span class="pname-link" onclick="window.open('${saleUrl(p.no)}','_blank')" title="판매 페이지 열기">${esc(display.name)}</span>` : esc(display.name)}</div>
            <div class="popt">카페24 <b class="${cafeSum === 0 && groupCafeComplete && groupCafeManaged ? 'inv-zero' : ''}">${groupCafeLabel}</b> · 실물 입력합계 <b>${sum}개</b></div>
          </div>
        </div>
      </td>` : '';
      const qtyCell = counting
        ? `<td class="qcell"><input type="text" inputmode="numeric" class="inv-count-input" data-id="${i.id}" data-orig="${Number(i.qty) || 0}" value="${Number(i.qty) || 0}" oninput="this.value=this.value.replace(/[^0-9]/g,'');this.dataset.touched='1';invStocktakeMark()" onfocus="this.select()">${i.needsCount ? '<span class="count-badge" title="아직 실사로 확인하지 않은 줄이에요">미확인</span>' : ''}</td>`
        : `<td class="qcell">
        <button class="qty-btn sm" onclick="invAdj(${i.id},-1)">−</button>
        <span class="qty ${i.needsCount || isLow(i) || isZero(i) ? 'low' : ''}">${i.needsCount ? '?' : i.qty}</span>
        <button class="qty-btn sm" onclick="invAdj(${i.id},1)">＋</button>
        ${i.needsAllocation ? `<span class="stock-note">${i.allocationTotal != null ? `배분 ${i.allocationTotal}/${i.allocationExpected}` : '옵션 배분 필요'}</span>` : i.needsCount ? '<span class="stock-note">실사 필요</span>' : ''}
      </td>`;
      const minCell = counting
        ? `<td style="text-align:center" class="muted">${minQtyOf(i)}개</td>`
        : `<td style="text-align:center"><button class="inv-min-btn" title="눌러서 안전재고(부족 기준)를 바꿔요" onclick="invSetMin(${i.id})">${minQtyOf(i)}개</button></td>`;
      const actsCell = counting ? `<td class="acts"></td>` : `<td class="acts">
        ${!i.size ? `<button class="del-btn" title="사이즈별 줄로 나누기 (예: S/M/L)" onclick="invSplit(${i.id})">📐</button>` : ''}
        <button class="del-btn" title="입출고 이력" onclick="invHistoryToggle(${i.id})">${window._invHistOpen.has(i.id) ? '📖' : '📜'}</button>
        <button class="del-btn" title="지우기" onclick="invDel(${i.id})">🗑️</button>
      </td>`;
      return `
    <tr class="${idx === 0 ? 'g-start' : ''}">
      ${prodCell}
      <td class="color">${esc(display.color) || '<span class="muted">-</span>'}<span class="sku-mini">${esc(i.sku || '')}</span></td>
      <td class="sz">${esc(i.size) || '<span class="muted" style="font-weight:400">-</span>'}</td>
      <td class="qcell channel-stock"><span class="qty ${c24Sellable(i) && i.cafe24Qty <= 2 ? 'low' : ''}">${c24Known(i) ? i.cafe24Qty : '-'}</span></td>
      ${qtyCell}
      <td style="text-align:center">${diffBadge(i)}</td>
      ${minCell}
      <td style="text-align:center;width:5rem">${stChip(i)}</td>
      ${actsCell}
    </tr>${histRowHtml(i)}`;
    }).join('');
  }).join('');
  const kpiInfo = (n, label, color) => `<div class="kpi"><div class="n"${color ? ` style="color:${color}"` : ''}>${n}</div><div class="l">${label}</div></div>`;
  const kpiBtn = (key, n, label, cls) => `<button class="kpi ${cls || ''} ${filter === key ? 'on' : ''}" onclick="window._invFilter='${key}';renderInventory()">
      <div class="n">${n}</div><div class="l">${label}</div></button>`;
  const seg = (key, label) => `<button class="${filter === key ? 'active' : ''}" onclick="window._invFilter='${key}';renderInventory()">${label}</button>`;
  const showBanner = !counting && totalQty === 0 && hasCafeSnapshot && activeInventory.length > 0;
  main().innerHTML = `
    <h1>📋 재고</h1>
    <div class="sub"><b>카페24 판매가능</b>은 주문 시 자동으로 바뀌고(재고관리 안 함 제외), <b>실물재고</b>는 창고에서 실제로 센 수량이에요.${DB.productsStockAt ? ` <span class="muted">최근 확인 ${new Date(DB.productsStockAt).toLocaleString('ko-KR', { hour12: false })}</span>` : ''}</div>
    <div class="kpi-strip">
      ${kpiBtn('all', prodN, '제품 종류')}
      ${kpiInfo(hasCafeSnapshot ? cafeTotalQty : '-', '카페24 판매가능 (개)', 'var(--blue)')}
      ${kpiInfo(totalQty, '실물재고 합')}
      ${kpiBtn('diff', diffN, '차이 있는 옵션', diffN ? 'warn' : '')}
      ${kpiBtn('low', lowN, '부족 (≤안전재고)', lowN ? 'warn' : '')}
      ${kpiBtn('zero', zeroN, '품절', zeroN ? 'bad' : '')}
      ${kpiBtn('unknown', unknownN, '확인 필요', unknownN ? 'warn' : '')}
    </div>
    ${showBanner ? `<div class="inv-banner">📦 아직 실물재고를 입력하지 않았어요 — 카페24 판매가능 수량을 실물 기초재고로 한 번에 가져올까요?
      <button class="btn primary" onclick="invInitFromCafe24()">⬇️ 카페24 수량을 실물 기초재고로</button></div>` : ''}
    ${invStocktakeResultHtml()}
    ${counting ? `
    <div class="inv-count-bar">
      <span>🧮 실사 중 — 바뀐 줄 <span class="cnt" id="inv-count-n">0</span>개</span>
      <input type="text" id="inv-count-memo" placeholder="메모 (선택 — 예: 9월 정기 실사)" maxlength="80">
      <button class="btn success" onclick="invStocktakeConfirm()">✔️ 실사 확정</button>
      <button class="btn ghost" onclick="invStocktakeCancel()">취소</button>
    </div>` : `
    <div style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:center; margin-bottom:0.8rem">
      <div class="seg">${seg('all', '전체')}${seg('diff', '차이 있음')}${seg('low', '부족')}${seg('zero', '품절')}${seg('unknown', '확인 필요')}</div>
      <input class="search-input" style="flex:1;min-width:200px;margin:0" placeholder="🔍 제품 이름으로 찾기" value="${esc(q)}"
        oninput="window._invQ=this.value; renderInventory(); this.focus(); this.setSelectionRange(this.value.length,this.value.length)">
    </div>
    <div style="margin-bottom:1rem; display:flex; gap:0.6rem; flex-wrap:wrap">
      <button class="btn primary" onclick="invAddForm()">➕ 새 제품</button>
      <button class="btn success" onclick="invMoveForm()">📥📤 입고·출고 등록</button>
      <button class="btn" style="border-color:var(--accent);color:var(--accent)" onclick="invStocktakeStart()">🧮 재고 실사 시작</button>
      <button class="btn" onclick="invInitFromCafe24()">⬇️ 카페24 수량을 실물 기초재고로</button>
      <button class="btn" onclick="go('stocklog')">📜 입출고 내역·수불부</button>
      ${DB.products && DB.products.length ? `<button class="btn ghost" onclick="invImportProducts()">📥 카페24 제품 전부 불러오기</button>` : ''}
    </div>
    <div id="inv-form"></div>`}
    ${rows ? `
    <div class="table-wrap inv-table-wrap" style="max-height:68vh">
      <table class="inv-table">
        <colgroup><col class="col-product"><col class="col-color"><col class="col-size"><col class="col-channel"><col class="col-qty"><col class="col-diff"><col class="col-min"><col class="col-status"><col class="col-action"></colgroup>
        <thead><tr><th>상품명</th><th>컬러 / 품목코드</th><th style="text-align:center">사이즈</th><th style="text-align:center">카페24<br>판매가능</th><th style="text-align:center">실물재고</th><th style="text-align:center">차이</th><th style="text-align:center">안전재고</th><th style="text-align:center">판매 상태</th><th style="text-align:center">관리</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>` : `<div class="muted" style="font-size:1.1rem">${filter !== 'all' ? '이 조건에 맞는 제품이 없어요. ' : q ? `'${esc(q)}'(으)로 찾은 제품이 없어요. ` : '아직 등록된 제품이 없어요. '}<button class="link-btn" onclick="window._invQ='';window._invFilter='all';renderInventory()">🔄 전체 보기</button></div>`}`;
  injectHelp();
  if (counting) invStocktakeMark();
}
// ── 재고 실사 모드 ──
function invStocktakeStart() {
  window._invCount = true;
  window._invStocktakeResult = null;
  renderInventory();
  toast('실사 시작 — 센 숫자를 실물재고 칸에 적고 [실사 확정]을 누르세요. 확정 전에는 저장되지 않아요.', 6000);
}
function invStocktakeCancel() {
  const dirty = [...document.querySelectorAll('.inv-count-input.dirty')].length;
  if (dirty && !confirm(`실사를 취소할까요? 바꾼 ${dirty}줄은 저장되지 않아요.`)) return;
  window._invCount = false;
  renderInventory();
}
// 빈칸은 "안 센 줄"로 보고 원래 수량 그대로 둔다 (0 으로 확정해 버리면 실물이 사라짐)
function invCountValue(inp) {
  const orig = Number(inp.dataset.orig) || 0;
  const raw = String(inp.value).replace(/[^0-9]/g, '');
  return raw === '' ? orig : Math.max(0, Math.floor(Number(raw)));
}
function invStocktakeMark() {
  const bar = document.getElementById('inv-count-n');
  const inputs = document.querySelectorAll('.inv-count-input');
  let n = 0;
  inputs.forEach(inp => {
    const orig = Number(inp.dataset.orig) || 0;
    const dirty = invCountValue(inp) !== orig;
    inp.classList.toggle('dirty', dirty);
    if (dirty) n++;
  });
  if (bar) bar.textContent = n;
}
async function invStocktakeConfirm() {
  // 손댄 줄(숫자를 바꿨거나 그대로라도 직접 확인한 줄)만 보낸다 — 안 센 줄을 "확인됨"으로 만들지 않기 위해
  const inputs = [...document.querySelectorAll('.inv-count-input')].filter(inp => inp.dataset.touched === '1' || inp.classList.contains('dirty'));
  if (!inputs.length) { toast('아직 실사한 줄이 없어요. 센 숫자를 적어 주세요. (그대로인 줄도 칸을 눌러 확인하면 실사한 것으로 남아요)', 6000); return; }
  // orig = 화면이 보고 있던 수량. 그 사이 출고가 있었으면 서버가 그 줄만 되돌려준다
  const rows = inputs.map(inp => ({ id: Number(inp.dataset.id), counted: invCountValue(inp), orig: Number(inp.dataset.orig) || 0 }));
  const dirtyN = inputs.filter(inp => inp.classList.contains('dirty')).length;
  const memoEl = document.getElementById('inv-count-memo');
  const memo = memoEl ? memoEl.value.trim() : '';
  if (!confirm(`실사 결과를 확정할까요?\n확인한 줄 ${rows.length}개 (수량 바뀐 줄 ${dirtyN}개)`)) return;
  const r = await api('/api/inventory/stocktake', { method: 'POST', body: JSON.stringify({ rows, memo }) });
  if (r.error && !r.ok) { toast('⚠️ ' + r.error, 5000); return; }
  DB = r.db;
  window._invCount = false;
  window._invHistCache = new Map();
  const errors = r.errors || [];
  window._invStocktakeResult = { adjusted: r.adjusted || [], unchanged: r.unchanged || 0, errors };
  renderInventory();
  const head = `✔️ 실사 확정: 조정 ${(r.adjusted || []).length}줄 · 변동 없음 ${r.unchanged || 0}줄`;
  if (errors.length) toast(`⚠️ ${head} · 반영 못 한 줄 ${errors.length}개 — 아래 결과에서 확인해 주세요.`, 9000);
  else toast(head, 7000);
}
function invStocktakeDismissResult() {
  window._invStocktakeResult = null;
  renderInventory();
}
function invStocktakeResultHtml() {
  const res = window._invStocktakeResult;
  if (!res) return '';
  const rows = res.adjusted.map(a => `<tr>
      <td>${esc(a.name)}${a.color ? ` <span class="muted">${esc(a.color)}</span>` : ''}${a.size ? ` <b>${esc(a.size)}</b>` : ''}</td>
      <td class="muted" style="font-size:0.8rem">${esc(a.sku || '')}</td>
      <td style="text-align:center">${a.before}</td>
      <td style="text-align:center">${a.after}</td>
      <td style="text-align:center"><span class="diff-badge ${a.diff > 0 ? 'pos' : 'neg'}">${a.diff > 0 ? '+' : ''}${a.diff}</span></td>
    </tr>`).join('');
  const errors = res.errors || [];
  const errRows = errors.map(e => {
    const item = (DB.inventory || []).find(i => i.id === Number(e.id));
    const label = item ? invLabel(item) : `<span class="muted">번호 ${esc(e.id)}</span>`;
    return `<tr><td>${label}</td><td>${esc(e.error || '반영하지 못했어요.')}</td></tr>`;
  }).join('');
  const failed = errors.length ? `<div class="result-box err" style="margin-top:0.7rem">
      <b>⚠️ 반영하지 못한 줄 ${errors.length}개</b> — 다시 세어 확정해 주세요.
      <div class="table-wrap" style="margin-top:0.4rem"><table><tr><th>제품</th><th>사유</th></tr>${errRows}</table></div>
    </div>` : '';
  return `<div class="card" style="border-color:${errors.length ? 'var(--out)' : 'var(--in)'};background:${errors.length ? '#fffaf6' : '#f3fbf6'}">
    <div class="step-title">✔️ 실사 결과 — 조정 ${res.adjusted.length}줄 · 변동 없음 ${res.unchanged}줄${errors.length ? ` · <span style="color:var(--out)">실패 ${errors.length}줄</span>` : ''}
      <button class="btn ghost sm" style="margin-left:auto" onclick="invStocktakeDismissResult()">닫기</button>
    </div>
    ${res.adjusted.length ? `<div class="table-wrap"><table><tr><th>제품</th><th>SKU</th><th style="text-align:center">이전</th><th style="text-align:center">이후</th><th style="text-align:center">차이</th></tr>${rows}</table></div>` : '<div class="muted">수량이 바뀐 옵션은 없어요.</div>'}
    ${failed}
  </div>`;
}
// ── 안전재고(부족 기준) 수정 ──
async function invSetMin(id) {
  const item = DB.inventory.find(i => i.id === id);
  if (!item) return;
  const cur = item.minQty != null ? item.minQty : (Number(item.cafe24SafetyInventory) > 0 ? Number(item.cafe24SafetyInventory) : 2);
  const ans = prompt(`${item.name}${item.color ? ' / ' + item.color : ''}${item.size ? ' / ' + item.size : ''}\n안전재고(부족 알림 기준)를 몇 개로 할까요?`, cur);
  if (ans === null) return;
  const raw = String(ans).trim();
  if (!/^\d+$/.test(raw)) { toast('숫자로 적어 주세요.', 4000); return; }
  const n = Math.max(0, Math.min(999, Math.floor(Number(raw))));
  const r = await api('/api/inventory/min', { method: 'POST', body: JSON.stringify({ id, minQty: n }) });
  if (r.error && !r.ok) { toast('⚠️ ' + r.error, 5000); return; }
  DB = r.db;
  renderInventory();
  toast(`✔️ 안전재고를 ${n}개로 바꿨어요.`);
}
// ── SKU 이력 패널 ──
async function invHistoryToggle(id) {
  if (window._invCount) return;
  window._invHistOpen = window._invHistOpen || new Set();
  window._invHistCache = window._invHistCache || new Map();
  if (window._invHistOpen.has(id)) { window._invHistOpen.delete(id); renderInventory(); return; }
  window._invHistOpen.add(id);
  renderInventory();
  const item = DB.inventory.find(i => i.id === id);
  if (!item) { window._invHistCache.set(id, []); renderInventory(); return; }
  const r = await api(`/api/master/stocklog?id=${encodeURIComponent(id)}&limit=30`);
  window._invHistCache.set(id, (r && r.log) || []);
  renderInventory();
}
// ── 카페24 수량을 실물 기초재고로 가져오기 ──
async function invInitFromCafe24() {
  if (!confirm('카페24 판매가능 수량을 실물재고 기초값으로 가져올까요?\n(이미 실물 수량이 입력된 옵션은 건드리지 않아요)')) return;
  const r = await api('/api/inventory/init-from-cafe24', { method: 'POST', body: JSON.stringify({}) });
  if (r.error && !r.ok) { toast('⚠️ ' + r.error, 5000); return; }
  DB = r.db;
  window._invHistCache = new Map(); // 이력 패널 캐시는 재고가 바뀌면 낡는다
  renderInventory();
  toast(`✔️ 기초재고 ${r.applied || 0}개 옵션 설정했어요.` + (r.skipped ? ` (건너뜀 ${r.skipped}개)` : ''), 6000);
}

function invAddForm() {
  $('#inv-form').innerHTML = `
    <div class="card">
      <div class="form-row"><label>제품 이름</label><input id="inv-name" placeholder="예: Margot Denim Pants"></div>
      <div class="form-row"><label>컬러 (없으면 비워두세요)</label><input id="inv-color" placeholder="예: Indigo Blue"></div>
      <div class="form-row"><label>사이즈 (없으면 비워두세요)</label><input id="inv-size" placeholder="예: M"></div>
      <div class="form-row"><label>개수</label><input id="inv-qty" type="number" value="1" min="0"></div>
      <div style="display:flex;gap:0.6rem;flex-wrap:wrap">
        <button class="btn success" onclick="invAdd()">✔️ 저장</button>
        <button class="btn ghost" onclick="renderInventory()">취소</button>
      </div>
    </div>`;
  $('#inv-name').focus();
}
async function invAdd() {
  const name = $('#inv-name').value.trim();
  if (!name) { toast('제품 이름을 적어 주세요.'); return; }
  DB.inventory.push({
    id: DB.nextId++,
    name,
    color: $('#inv-color').value.trim(),
    size: $('#inv-size').value.trim(),
    qty: Math.max(0, Number($('#inv-qty').value) || 0)
  });
  await saveDb();
  window._invHistCache = new Map();
  renderInventory();
  toast('저장했어요! ✔️');
}
// 카페24 제품 목록을 재고 항목으로 한 번에 등록 (이미 있는 건 건너뜀)
async function invImportProducts() {
  const existing = new Set(DB.inventory.map(i => lettersOnly(i.name)));
  const news = (DB.products || []).filter(p => p.name && !existing.has(lettersOnly(p.name)));
  if (!news.length) { toast('새로 넣을 제품이 없어요. (이미 다 등록됨)'); return; }
  if (!confirm(`카페24 제품 ${news.length}개를 재고 목록에 넣을까요?\n(개수는 0으로 들어가니, 실제 재고 수량을 ＋로 채워 주세요)`)) return;
  for (const p of news) {
    DB.inventory.push({ id: DB.nextId++, name: p.name, color: '', size: '', qty: 0, productNo: p.no || null });
  }
  await saveDb();
  renderInventory();
  toast(`✔️ ${news.length}개 제품을 넣었어요. 이제 실제 개수를 ＋로 채워 주세요.`, 6000);
}
// 재고 한 줄을 사이즈별 줄로 나눔 (서버가 첫 사이즈에 기존 수량을 남기고 나머지는 0개로 만듦)
async function invSplit(id) {
  const item = DB.inventory.find(i => i.id === id);
  if (!item) return;
  const ans = prompt(`'${item.name}'을(를) 사이즈별 줄로 나눠요.\n사이즈를 쉼표로 적어 주세요:`, 'S,M,L');
  if (ans === null) return;
  const r = await api('/api/inventory/split', { method: 'POST', body: JSON.stringify({ id, sizes: ans }) });
  if (r.error) { toast('⚠️ ' + r.error, 5000); return; }
  DB = r.db;
  window._invHistCache = new Map();
  renderInventory();
  toast(`✔️ ${r.made.join('/')} 사이즈 줄로 나눴어요. 각 사이즈의 실제 개수를 ＋로 채워 주세요.`, 6000);
}
async function invAdj(id, d) {
  const item = DB.inventory.find(i => i.id === id);
  if (!item) return;
  // 서버가 처리해야 입출고 내역에 남는다
  const r = await api('/api/inventory/adjust', { method: 'POST', body: JSON.stringify({ id, delta: d }) });
  if (r.error) { toast('⚠️ ' + r.error, 4000); return; }
  DB = r.db;
  window._invHistCache = new Map();
  renderInventory();
}


// ── 입출고 내역 ──
// ── 재고수불: 입출고 구분 (서버 STOCK_MOVE_REASONS와 같은 이름) ──
const STOCK_REASON = {
  '주문 출고': ['🛒', '#c0392b'], '시딩 출고': ['🎁', '#c0392b'], '교환 재발송 출고': ['🔁', '#c0392b'],
  '샘플 출고': ['🧵', '#c0392b'], '본사 출고': ['🏢', '#c0392b'], '폐기·불량': ['🗑️', '#8a6d1a'],
  '차감 (직접)': ['✏️', '#8a6d1a'], '재고 조정 (−)': ['⚖️', '#8a6d1a'], '출고': ['📤', '#c0392b'],
  '본사 입고': ['🏢', '#1e7e46'], '반품 입고': ['↩️', '#1e7e46'], '교환 회수 입고': ['🔄', '#1e7e46'],
  '입고 (직접)': ['📥', '#1e7e46'], '재고 조정 (+)': ['⚖️', '#1e7e46'], '접수 취소 복구': ['↩️', '#1e7e46'],
  '기초 재고': ['🏁', '#1e7e46']
};
const STOCK_IN_REASONS = ['본사 입고', '반품 입고', '교환 회수 입고', '입고 (직접)', '재고 조정 (+)'];
const STOCK_OUT_REASONS = ['샘플 출고', '본사 출고', '폐기·불량', '차감 (직접)', '재고 조정 (−)']; // 주문·시딩·교환 출고는 접수할 때 자동
// 옛 장부에 남아 있는 사유 이름 → 지금 쓰는 이름 (lib/stock-ledger.js 의 LEGACY_REASONS 와 같게)
const LEGACY_REASON = { '출고': '주문 출고' };
const normReason = r => {
  const s = String(r == null ? '' : r).trim();
  return LEGACY_REASON[s] || s || '기타';
};
const reasonIcon = r => (STOCK_REASON[normReason(r)] || STOCK_REASON[r] || ['•'])[0];
const invLabel = i => esc(i.name) + (i.color ? ` <span class="muted">${esc(i.color)}</span>` : '') + (i.size ? ` <b>${esc(i.size)}</b>` : '');
const stockRefLabel = e => {
  const note = e.note ? esc(e.note) : '';
  let ref = '';
  if (e.ref) {
    ref = /^(SEED|SHIP|RMA)-/.test(e.ref) || /^\d{8}-\d{7}$/.test(e.ref)
      ? `<span class="muted" style="font-size:0.85rem">${esc(e.ref)}</span>`
      : esc(e.ref);
  }
  if (ref && note) return `${ref} <span class="muted">· ${note}</span>`;
  return ref || note || '<span class="muted">-</span>';
};

// 입고·출고 등록 폼 (재고 화면) — 본사 입고, 샘플 출고, 폐기 등 사람이 하는 수불
function invMoveItemOptions(filterText) {
  const q = (filterText || '').trim();
  const rows = [...DB.inventory].sort((a, b) => (a.name + a.size).localeCompare(b.name + b.size));
  const filtered = q ? rows.filter(i => matchQ(i.name + ' ' + (i.color || '') + ' ' + (i.size || ''), q)) : rows;
  return filtered.map(i => `<option value="${i.id}">${esc(i.name)}${i.color ? ' / ' + esc(i.color) : ''}${i.size ? ' / ' + esc(i.size) : ''} (지금 ${i.qty}개)</option>`).join('')
    || `<option value="" disabled selected>일치하는 제품이 없어요</option>`;
}
function invMoveFilterItems(text) {
  const sel = $('#mv-item');
  if (!sel) return;
  sel.innerHTML = invMoveItemOptions(text);
}
function invMoveForm() {
  $('#inv-form').innerHTML = `
    <div class="card" style="border:2px solid #cfe0f5;background:#f7faff">
      <div class="step-title">📥📤 입고·출고 등록</div>
      <div class="form-row"><label>제품 검색</label><input id="mv-filter" placeholder="🔍 제품 이름·컬러·사이즈로 찾기" oninput="invMoveFilterItems(this.value)"></div>
      <div class="form-row"><label>제품 / 사이즈</label><select id="mv-item" style="font-size:1rem;padding:0.5rem;border:2px solid var(--line);border-radius:8px;max-width:100%" size="6">${invMoveItemOptions('')}</select></div>
      <div class="form-row"><label>구분</label>
        <select id="mv-reason" style="font-size:1rem;padding:0.5rem;border:2px solid var(--line);border-radius:8px" onchange="invMoveReasonPreview()">
          <optgroup label="📥 입고 (재고가 늘어요)">${STOCK_IN_REASONS.map(r => `<option value="${r}">${STOCK_REASON[r][0]} ${r}</option>`).join('')}</optgroup>
          <optgroup label="📤 출고 (재고가 줄어요)">${STOCK_OUT_REASONS.map(r => `<option value="${r}">${STOCK_REASON[r][0]} ${r}</option>`).join('')}</optgroup>
        </select>
        <div id="mv-reason-preview" style="margin-top:0.3rem"></div>
      </div>
      <div class="form-row"><label>수량</label><input id="mv-qty" type="number" value="1" min="1" style="width:6rem"></div>
      <div class="form-row"><label>메모 (선택 — 예: 9월 2차 생산분, OO매거진 협찬)</label><input id="mv-memo" maxlength="80" placeholder="어디서 왔는지 / 어디로 갔는지"></div>
      <div style="display:flex;gap:0.6rem;flex-wrap:wrap">
        <button class="btn success" onclick="invMoveSave()">✔️ 기록하기</button>
        <button class="btn ghost" onclick="$('#inv-form').innerHTML=''">취소</button>
      </div>
      <div class="hint" style="margin-top:0.6rem">주문·시딩·교환 발송은 접수할 때 자동으로 출고되니 여기서 또 빼지 마세요. 반품·교환 회수는 [교환/반품]의 [물건 도착 확인]이 자동 입고해요.</div>
    </div>`;
  invMoveReasonPreview();
  $('#mv-filter').focus();
}
function invMoveReasonPreview() {
  const box = document.getElementById('mv-reason-preview');
  if (!box) return;
  const reason = $('#mv-reason').value;
  const isIn = STOCK_IN_REASONS.includes(reason);
  box.innerHTML = `<span class="chip ${isIn ? 'done' : 'wait'}">${isIn ? '📥 입고' : '📤 출고'}</span>`;
}
async function invMoveSave() {
  const sel = $('#mv-item');
  if (!sel.value) { toast('제품을 골라 주세요.'); return; }
  const id = Number(sel.value);
  const reason = $('#mv-reason').value;
  const qty = Math.max(1, Math.floor(Number($('#mv-qty').value) || 0));
  const memo = $('#mv-memo').value.trim();
  const isIn = STOCK_IN_REASONS.includes(reason);
  const item = DB.inventory.find(i => i.id === id);
  if (!item) { toast('제품을 골라 주세요.'); return; }
  if (!isIn && qty > item.qty && !confirm(`지금 재고가 ${item.qty}개인데 ${qty}개를 빼려고 해요.\n재고는 0개까지만 줄어요. 계속할까요?`)) return;
  const r = await api('/api/inventory/adjust', { method: 'POST', body: JSON.stringify({ id, delta: isIn ? qty : -qty, reason, memo }) });
  if (r.error && !r.ok) { toast('⚠️ ' + r.error, 5000); return; }
  DB = r.db;
  window._invHistCache = new Map();
  renderInventory();
  toast(`✔️ ${reason} ${qty}개 기록했어요.` + (r.short ? ' ' + r.error : ''), 6000);
}

// ── 입출고 내역 · 수불부 ──
async function renderStockLog() {
  PAGE = 'stocklog';
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === 'inventory')); // 재고 메뉴의 하위 화면
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const ym = window._slMonth || thisYm;
  const tab = window._slTab || 'log';
  const rf = window._slReason || 'all';
  const slq = (window._slQ || '').trim();
  const shiftMonth = (s, d) => { const [y, m] = s.split('-').map(Number); const x = new Date(y, m - 1 + d, 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); };
  const tabBtn = (key, label) => `<button class="${tab === key ? 'active' : ''}" onclick="window._slTab='${key}';window._slReason='all';renderStockLog()">${label}</button>`;
  main().innerHTML = `
    <h1>📜 입출고 내역 · 수불부</h1>
    <div class="sub">재고가 바뀔 때마다 자동으로 적히는 장부예요. 발송하면 <b style="color:var(--out)">출고 −</b>, 입고·반품 도착은 <b style="color:var(--in)">입고 +</b>.</div>
    <div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;margin-bottom:0.8rem">
      <button class="btn ghost" onclick="go('inventory')">← 재고</button>
      <button class="btn sm" onclick="window._slMonth='${shiftMonth(ym, -1)}';window._slReason='all';renderStockLog()">◀</button>
      <b style="font-size:1.15rem">${esc(ym.replace('-', '년 '))}월</b>
      <button class="btn sm" ${ym >= thisYm ? 'disabled' : ''} onclick="window._slMonth='${shiftMonth(ym, 1)}';window._slReason='all';renderStockLog()">▶</button>
      ${ym !== thisYm ? `<button class="btn ghost sm" onclick="window._slMonth='';window._slReason='all';renderStockLog()">이번 달</button>` : ''}
      <span style="flex:1"></span>
      <div class="seg">${tabBtn('log', '📅 내역')}${tabBtn('ledger', '📒 수불부')}${tabBtn('stocktakes', '🧮 실사 기록')}</div>
      ${tab !== 'stocktakes' ? `<button class="btn" onclick="slExportCsv()">⬇️ 엑셀(CSV) 내려받기</button>` : ''}
    </div>
    <div id="sl-body"><div class="loading-row">불러오는 중…</div></div>`;
  injectHelp();
  const body = document.getElementById('sl-body');
  if (tab === 'stocktakes') { body.innerHTML = renderStocktakesTab(); return; }
  // 월·탭을 빨리 연달아 누를 때 늦게 도착한 응답이 화면을 덮어쓰지 않게
  const token = window._slToken = (window._slToken || 0) + 1;
  const stale = () => token !== window._slToken;
  const kpiStrip = (inSum, outSum, movedN) => `
    <div class="kpi-strip" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
      <div class="kpi"><div class="n" style="color:var(--in)">+${inSum}</div><div class="l">이달 입고</div></div>
      <div class="kpi"><div class="n" style="color:var(--out)">−${outSum}</div><div class="l">이달 출고</div></div>
      <div class="kpi"><div class="n" style="${inSum - outSum < 0 ? 'color:var(--out)' : ''}">${inSum - outSum >= 0 ? '+' : ''}${inSum - outSum}</div><div class="l">순변동</div></div>
      <div class="kpi"><div class="n">${movedN}</div><div class="l">움직인 옵션 수</div></div>
    </div>`;
  if (tab === 'ledger') {
    // 수불부는 서버가 이미 합계를 내려주므로 장부 3000건을 따로 받지 않는다
    const lr = await api(`/api/master/ledger?ym=${encodeURIComponent(ym)}`);
    if (stale()) return;
    const el = document.getElementById('sl-body');
    if (!el) return;
    if (!lr || !lr.ok) { el.innerHTML = renderLedgerTab(lr, slq); return; }
    const t = lr.totals || { inN: 0, outN: 0 };
    const movedN = (lr.rows || []).filter(row => row.inN || row.outN).length;
    el.innerHTML = kpiStrip(Number(t.inN) || 0, Number(t.outN) || 0, movedN) + renderLedgerTab(lr, slq);
    return;
  }
  const r = await api(`/api/master/stocklog?since=${encodeURIComponent(ym + '-01')}&limit=3000`);
  if (stale()) return;
  const el = document.getElementById('sl-body');
  if (!el) return;
  const inMonth = ((r && r.log) || []).filter(e => (e.date || '').startsWith(ym));
  const inSum = inMonth.filter(e => e.delta > 0).reduce((s, e) => s + e.delta, 0);
  const outSum = inMonth.filter(e => e.delta < 0).reduce((s, e) => s - e.delta, 0);
  const movedN = new Set(inMonth.map(e => e.sku || (e.name + '|' + (e.color || '') + '|' + (e.size || '')))).size;
  const byReason = new Map();
  for (const e of inMonth) { const k = normReason(e.reason); byReason.set(k, (byReason.get(k) || 0) + Math.abs(e.delta)); }
  const reasonChips = [...byReason.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => {
    const isIn = STOCK_IN_REASONS.includes(reason) || reason === '기초 재고' || reason === '접수 취소 복구';
    return `<button class="reason-chip ${isIn ? 'in' : 'out'} ${rf === reason ? 'active' : ''}" onclick="window._slReason='${jsq(reason)}';renderStockLog()">${reasonIcon(reason)} ${esc(reason)} <b>${n}</b></button>`;
  }).join(' ');
  const summaryHtml = kpiStrip(inSum, outSum, movedN) + (byReason.size ? `<div class="seg" style="margin-bottom:0.9rem">
      <button class="${rf === 'all' ? 'active' : ''}" onclick="window._slReason='all';renderStockLog()">전체</button>
      ${reasonChips}
    </div>` : '');
  const log = rf === 'all' ? inMonth : inMonth.filter(e => normReason(e.reason) === rf);
  const filteredLog = slq ? log.filter(e => matchQ(e.name + ' ' + (e.color || '') + ' ' + (e.size || '') + ' ' + (e.note || '') + ' ' + (e.ref || ''), slq)) : log;
  el.innerHTML = summaryHtml + renderLogTab(filteredLog);
}
// 검색어를 입력하는 동안 다시 그려도 포커스·커서 위치를 유지
async function slRefreshKeepFocus() {
  const active = document.activeElement;
  const pos = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  await renderStockLog();
  const el = document.querySelector('#sl-body .search-input');
  if (el) { el.focus(); if (pos != null) el.setSelectionRange(pos, pos); }
}
function renderLogTab(log) {
  const byDate = new Map();
  for (const e of log) { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); }
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
  const bodyRows = dates.map(date => {
    const rows = byDate.get(date);
    const outN = rows.filter(x => x.delta < 0).reduce((s, x) => s - x.delta, 0);
    const inN = rows.filter(x => x.delta > 0).reduce((s, x) => s + x.delta, 0);
    const lines = rows.map(e => {
      const reason = normReason(e.reason);
      return `<tr>
        <td class="muted" style="white-space:nowrap">${esc(new Date(e.ts).toTimeString().slice(0, 5))}</td>
        <td style="white-space:nowrap">${reasonIcon(e.reason)} ${esc(reason)}</td>
        <td>${invLabel(e)}</td>
        <td style="text-align:center;font-weight:800;color:${e.delta < 0 ? 'var(--out)' : 'var(--in)'}">${e.delta > 0 ? '+' : ''}${e.delta}</td>
        <td style="text-align:center">${e.left}</td>
        <td>${stockRefLabel(e)}</td>
      </tr>`;
    }).join('');
    return `<tr><td colspan="6" style="font-weight:800;background:var(--line-soft)">📅 ${esc(date)} <span class="muted" style="font-weight:400;font-size:0.9rem">— 출고 ${outN}개 · 입고 ${inN}개</span></td></tr>${lines}`;
  }).join('');
  return `
    <div class="form-row"><input class="search-input" style="margin:0" placeholder="🔍 제품 이름으로 찾기" value="${esc(window._slQ || '')}"
      oninput="window._slQ=this.value; slRefreshKeepFocus()"></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>시각</th><th>구분</th><th>제품</th><th style="text-align:center">변동</th><th style="text-align:center">남음</th><th>상대·메모</th></tr></thead>
        <tbody>${bodyRows || `<tr><td colspan="6" class="muted" style="padding:1rem">이 조건에 맞는 기록이 없어요.</td></tr>`}</tbody>
      </table>
    </div>`;
}
function ledgerBucket(byReason, reasons) {
  if (!byReason) return 0;
  return reasons.reduce((s, r) => s + Math.abs(Number(byReason[r]) || 0), 0);
}
function renderLedgerTab(lr, slq) {
  if (!lr || !lr.ok) return `<div class="card"><div class="muted">수불부를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</div></div>`;
  let rows = lr.rows || [];
  if (slq) rows = rows.filter(row => matchQ(row.name + ' ' + (row.color || '') + ' ' + (row.size || ''), slq));
  const totals = lr.totals || rows.reduce((s, row) => ({ start: s.start + row.start, inN: s.inN + row.inN, outN: s.outN + row.outN, end: s.end + row.end }), { start: 0, inN: 0, outN: 0, end: 0 });
  const line = row => {
    const inHq = ledgerBucket(row.byReason, ['본사 입고', '입고 (직접)', '기초 재고']);
    const inRet = ledgerBucket(row.byReason, ['반품 입고', '교환 회수 입고']);
    const inEtc = Math.max(0, (Number(row.inN) || 0) - inHq - inRet);
    const outOrder = ledgerBucket(row.byReason, ['주문 출고', '출고']);
    const outSeed = ledgerBucket(row.byReason, ['시딩 출고']);
    const outEtc = Math.max(0, (Number(row.outN) || 0) - outOrder - outSeed);
    return `<tr>
      <td>${esc(row.name)}${row.color ? ` <span class="muted">${esc(row.color)}</span>` : ''}${row.size ? ` <b>${esc(row.size)}</b>` : ''}</td>
      <td>${row.start}</td>
      <td style="color:var(--in);font-weight:${row.inN ? 800 : 400}">${row.inN || '-'}</td>
      <td class="sub">${inHq}/${inRet}/${inEtc}</td>
      <td style="color:var(--out);font-weight:${row.outN ? 800 : 400}">${row.outN || '-'}</td>
      <td class="sub">${outOrder}/${outSeed}/${outEtc}</td>
      <td style="font-weight:800;${row.end <= 0 ? 'color:var(--red)' : ''}">${row.end}</td>
    </tr>`;
  };
  return `
    <div class="form-row"><input class="search-input" style="margin:0" placeholder="🔍 제품 이름으로 찾기" value="${esc(slq || '')}"
      oninput="window._slQ=this.value; slRefreshKeepFocus()"></div>
    <div class="table-wrap" style="max-height:65vh">
      <table class="ledger-table">
        <thead><tr><th>제품 / 사이즈</th><th>기초</th><th>입고 +</th><th>본사/반품·교환/기타</th><th>출고 −</th><th>주문/시딩/기타</th><th>기말</th></tr></thead>
        <tbody>
          ${rows.map(line).join('') || `<tr><td colspan="7" class="muted" style="padding:1rem;text-align:left">표시할 제품이 없어요.</td></tr>`}
          <tr class="total-row"><td>합계 (${rows.length}종)</td><td>${totals.start}</td><td style="color:var(--in)">${totals.inN}</td><td></td><td style="color:var(--out)">${totals.outN}</td><td></td><td>${totals.end}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="hint" style="margin-top:0.6rem">기초 = 그 달 1일 시작 재고, 기말 = 말일 재고 (전월 기말 = 이번 달 기초). 이번 달은 기말이 지금 재고와 같아요.</div>`;
}
function renderStocktakesTab() {
  const list = [...(DB.stocktakes || [])].sort((a, b) => new Date(b.at) - new Date(a.at));
  window._slStkOpen = window._slStkOpen || new Set();
  if (!list.length) return `<div class="card"><div class="muted">아직 실사 기록이 없어요. 재고 화면에서 [🧮 재고 실사 시작]으로 실사를 해보세요.</div></div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>일시</th><th>메모</th><th style="text-align:center">조정</th><th style="text-align:center">변동 없음</th><th style="text-align:center">상세</th></tr></thead>
    <tbody>${list.map(st => {
      const key = String(st.at || '');
      const open = window._slStkOpen.has(key);
      const detail = open ? `<tr><td colspan="5"><div class="inv-hist-panel"><table>
        <tr><th>제품</th><th>SKU</th><th style="text-align:center">이전</th><th style="text-align:center">이후</th><th style="text-align:center">차이</th></tr>
        ${(st.rows || []).map(a => `<tr>
          <td>${esc(a.name)}${a.color ? ` <span class="muted">${esc(a.color)}</span>` : ''}${a.size ? ` <b>${esc(a.size)}</b>` : ''}</td>
          <td class="muted" style="font-size:0.8rem">${esc(a.sku || '')}</td>
          <td style="text-align:center">${a.before}</td>
          <td style="text-align:center">${a.after}</td>
          <td style="text-align:center"><span class="diff-badge ${a.diff > 0 ? 'pos' : 'neg'}">${a.diff > 0 ? '+' : ''}${a.diff}</span></td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty">조정된 줄이 없어요.</td></tr>'}
      </table></div></td></tr>` : '';
      return `<tr>
        <td style="white-space:nowrap">${esc(new Date(st.at).toLocaleString('ko-KR', { hour12: false }))}</td>
        <td>${esc(st.memo || '-')}</td>
        <td style="text-align:center;font-weight:800">${st.adjusted}</td>
        <td style="text-align:center">${st.unchanged}</td>
        <td style="text-align:center"><button class="btn ghost sm" onclick="window._slStkOpen.has('${jsq(key)}')?window._slStkOpen.delete('${jsq(key)}'):window._slStkOpen.add('${jsq(key)}');renderStockLog()">${open ? '접기' : '펼치기'}</button></td>
      </tr>${detail}`;
    }).join('')}</tbody>
  </table></div>`;
}
// 현재 탭·월 기준으로 CSV 내려받기 (팝업 차단·빈 탭이 안 생기게 같은 창에서 이동 → 첨부파일이라 화면은 그대로)
function slExportCsv() {
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const ym = window._slMonth || thisYm;
  const tab = window._slTab || 'log';
  if (tab === 'stocktakes') return;
  const url = tab === 'ledger' ? `/api/master/ledger.csv?ym=${encodeURIComponent(ym)}` : `/api/master/stocklog.csv?ym=${encodeURIComponent(ym)}`;
  location.href = url;
}
async function invDel(id) {
  const item = DB.inventory.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`"${item.name}"을(를) 재고 목록에서 지울까요?\n(지운 제품은 자동 등록에서도 빠져요)`)) return;
  DB.inventory = DB.inventory.filter(i => i.id !== id);
  if (item.productNo) (DB.inventoryHidden = DB.inventoryHidden || []).push(item.productNo); // 자동 재등록 방지
  await saveDb();
  window._invHistCache = new Map();
  renderInventory();
}
