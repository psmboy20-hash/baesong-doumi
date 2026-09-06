
// ---------- 주문/시딩 목록 (보내기) ----------

// 채널 송장 엑셀 대상(29CM·무신사·GS샵) — 라벨과 내보내기 버튼에서 같이 쓴다
const CHANNEL_INVOICE_LABEL = { '29cm': '29CM', musinsa: '무신사', gsshop: 'GS샵' };

// 제주·도서산간 우편번호 구간표 — 접수 화면 안내 칩 전용(접수 자체를 막지는 않는다).
// lib/postal.js 의 remoteArea()(백엔드, 서버 판정용)와 반드시 같은 구간을 쓴다 — 화면(send.js)은
// 서버 함수를 직접 import할 수 없는 바닐라 SPA 구조라 값만 그대로 복제해 둔다.
// 새 구간이 필요하면 lib/postal.js의 REMOTE_AREA_RANGES를 먼저 고치고 여기도 같이 맞출 것.
const REMOTE_ZIP_RANGES = [
  { from: 63000, to: 63644, kind: '제주' },
  { from: 40200, to: 40240, kind: '도서산간' },
  { from: 23004, to: 23010, kind: '도서산간' },
  { from: 23100, to: 23116, kind: '도서산간' },
  { from: 23120, to: 23126, kind: '도서산간' },
  { from: 23130, to: 23136, kind: '도서산간' },
  { from: 33411, to: 33413, kind: '도서산간' },
  { from: 54000, to: 54005, kind: '도서산간' },
  { from: 58760, to: 58762, kind: '도서산간' },
  { from: 58800, to: 58808, kind: '도서산간' },
  { from: 58810, to: 58816, kind: '도서산간' },
  { from: 58818, to: 58826, kind: '도서산간' },
  { from: 59106, to: 59166, kind: '도서산간' },
  { from: 53031, to: 53033, kind: '도서산간' },
  { from: 53037, to: 53040, kind: '도서산간' },
  { from: 53065, to: 53067, kind: '도서산간' }
];
function remoteArea(zip) {
  const digits = String(zip == null ? '' : zip).replace(/\D/g, '');
  if (digits.length !== 5) return null;
  const value = Number(digits);
  for (const range of REMOTE_ZIP_RANGES) {
    if (value >= range.from && value <= range.to) return { kind: range.kind };
  }
  return null;
}

// 묶음 하나(g)가 어느 세그먼트에 속하는지 분류
function sendCategory(g) {
  if (g.some(p => p.x.exchange)) return 'exchange';
  if (g.every(p => p.kind === 'seeding')) return 'seeding';
  const isCafe24 = g.every(p => p.kind === 'orders' && (!p.x.sourceChannel || p.x.sourceChannel === 'cafe24'));
  if (isCafe24) return 'cafe24';
  for (const ch of Object.keys(CHANNEL_INVOICE_LABEL)) {
    if (g.every(p => p.kind === 'orders' && p.x.sourceChannel === ch)) return ch;
  }
  return 'direct';   // 기타 채널·직접 등록·채널이 섞인 묶음
}
function sendSourceLabel(category, first) {
  if (category === 'exchange') return '교환 재발송';
  if (category === 'seeding') return seedingSourceLabel(first);
  if (category === 'cafe24') return '카페24 주문';
  // app-core.js의 shipmentSourceLabel엔 아직 없는 채널들
  if (CHANNEL_INVOICE_LABEL[category]) return CHANNEL_INVOICE_LABEL[category];
  if (first.sourceChannel === 'gsshop') return 'GS샵';
  return shipmentSourceLabel(first);
}
// 검색용 텍스트(이름·전화·주소·주문번호·상품명)
function sendSearchText(m) {
  const parts = [m.first.name, m.first.phone, m.first.addr, m.first.orderNo, m.first.insta];
  for (const p of m.g) parts.push(p.x.product);
  return parts.filter(Boolean).join(' ');
}

// 묶음(g) 하나에 필요한 화면 표시 정보를 미리 계산
function buildSendMeta(g, stockStates, mergeSuggestions) {
  const first = g[0].x;
  const groupProductQty = productQuantity(g, e => e.x);
  const spec = g.map(p => p.kind + ':' + p.x.id).join(',');
  const postalPending = g.some(p => epostOperationUnresolved(p.x));
  const shippingHold = g.some(p => p.x.shippingHold);
  const sheetCancelHold = g.some(p => p.x.sheetCancelHold);
  const hold = g.some(p => p.x.hold);
  const holdReason = (g.map(p => p.x.holdReason).find(Boolean) || '');
  const memoText = [...new Set(g.map(p => p.x.memo).filter(Boolean))].join(' / ');
  const allSel = !postalPending && !shippingHold && !sheetCancelHold && !hold && g.every(p => p.x._sel !== false);
  const category = sendCategory(g);
  const sourceLabel = sendSourceLabel(category, first);
  const noZip = !/^\d{5}$/.test(String(first.zip || '').trim()) && !matchZipInAddr(first.addr);
  const stusSet = [...new Set(g.map(p => p.x.status))];
  // 3일 넘게 그대로면: 앱 밖(우체국 창구·사이트)에서 이미 보냈는데 앱만 모르는 경우가 많다
  const staleDays = Math.max(...g.map(p => p.x.regDate ? Math.floor((Date.now() - new Date(p.x.regDate)) / 86400000) : 0));
  // 접수 시도에서 "이미 보낸 것과 같은 내용"으로 막힌 건: 확인 후 한 번 더 보내기 허용
  const dupHere = g.filter(p => (window._dupIds || new Set()).has(p.kind + ':' + p.x.id) && !p.x.resendOk);
  const mergeSuggestion = mergeSuggestions.find(s => s.entries.some(entry => g.includes(entry)));
  const mergeSpec = mergeSuggestion ? mergeSuggestion.entries.map(p => p.kind + ':' + p.x.id).join(',') : '';
  return { g, first, groupProductQty, spec, postalPending, shippingHold, sheetCancelHold, hold, holdReason, memoText, allSel, category, sourceLabel, noZip, stusSet, staleDays, dupHere, mergeSuggestion, mergeSpec, stockStates };
}

// 상단 배너 1: 연결 상태 문제가 있을 때만
function sendConnBanner() {
  const bits = [];
  if (window._VIEW) {
    bits.push(banner('info', window._C24OWNER
      ? '노트북 모드예요. 매장 컴퓨터가 꺼져 있어 주문 수집과 접수를 노트북이 대신하고 있어요.'
      : '노트북 모드예요. 매장 컴퓨터가 켜져 있어요. 시딩은 여기서 접수하고, 주문은 매장 화면에서 접수하세요.'));
  }
  const c24 = SYNC_STATUS && SYNC_STATUS.cafe24;
  if (!c24 || !c24.configured) {
    bits.push(banner('info', '카페24 자동 연동이 아직 설정되지 않았어요.', btn({ label: '설정하러 가기', kind: 'text', size: 'sm', onclick: "go('settings')" })));
  } else if (!c24.connected) {
    bits.push(banner('warn', '카페24 연결이 필요해요.', btn({ label: '설정에서 연결하기', kind: 'text', size: 'sm', onclick: "go('settings')" })));
  } else if (c24.ok === false) {
    bits.push(banner('bad', '카페24에서 주문을 가져오지 못했어요: ' + esc(c24.error || ''), btn({ label: '설정 보기', kind: 'text', size: 'sm', onclick: "go('settings')" })));
  }
  const goo = SYNC_STATUS && SYNC_STATUS.google;
  if (goo && goo.ok === false) {
    bits.push(banner('bad', '구글시트에서 시딩 신청을 가져오지 못했어요. 인터넷과 시트 공유 설정을 확인하세요.', btn({ label: '설정 보기', kind: 'text', size: 'sm', onclick: "go('settings')" })));
  }
  return bits.join('');
}
// 상단 배너 2: 우편번호 없음 · 중복 의심 · 시트 정리 필요(막는 문제) + 3일 방치(주의)
function sendIssueBanner(metas) {
  const noZip = metas.filter(m => m.noZip).length;
  const dup = metas.filter(m => m.dupHere.length).length;
  const sheetCancel = metas.filter(m => m.sheetCancelHold).length;
  const stale = metas.filter(m => m.staleDays >= 3 && !m.postalPending && !m.shippingHold && !m.sheetCancelHold && !m.noZip).length;
  let html = '';
  const blockBits = [];
  if (noZip) blockBits.push(`우편번호 없음 ${noZip}건`);
  if (dup) blockBits.push(`이미 보낸 것과 같은 내용 ${dup}건`);
  if (sheetCancel) blockBits.push(`시트 송장 정리 필요 ${sheetCancel}건`);
  if (blockBits.length) html += banner('bad', blockBits.join(' · ') + ' — 표에서 확인하고 처리해 주세요.');
  if (stale) html += banner('warn', `${stale}건은 3일 넘게 그대로예요. 우체국 창구 등에서 이미 보내셨다면 [직접 보냄으로 표시]를 눌러 정리해 주세요.`);
  return html;
}
// 상단 배너 3: 합포장 추천
function sendMergeBanner(mergeSuggestions) {
  if (!mergeSuggestions.length) return '';
  const items = mergeSuggestions.map(s => {
    const spec = s.entries.map(e => e.kind + ':' + e.x.id).join(',');
    const qty = productQuantity(s.entries, e => e.x);
    const u = s.units || { orders: s.orderNos.length, seeding: 0 };
    const what = [u.orders ? `주문 ${u.orders}건` : '', u.seeding ? `시딩 ${u.seeding}건` : ''].filter(Boolean).join(' + ');
    return `<div style="margin-top:6px">${esc(s.name)}님에게 따로 나갈 택배가 ${s.orderNos.length}건(${what}) 있어요. 상품 ${qty}개를 한 비닐에 넣어 송장 1개로 보낼 수 있어요. ${btn({ label: '한 비닐로 묶기', kind: 'secondary', size: 'sm', onclick: `packMerge('${spec}','${jsq(s.name)}')` })}</div>`;
  }).join('');
  return banner('info', `합포장 추천 ${mergeSuggestions.length}명${items}`);
}
// 상단 배너 4: 채널 엑셀 업로드에서 필수 열을 못 찾았을 때 (설정에서 매핑 필요)
// 주문을 만드는 데 꼭 있어야 하는 열 — 품목번호·배송메시지·우편번호·옵션·수량이 없다고 배너를 띄우지는 않는다
const SEND_REQUIRED_COLUMNS = ['orderNo', 'name', 'phone', 'addr', 'product'];
function sendMappingBanner() {
  const m = window._sendMappingBanner;
  if (!m || !m.unmapped || !m.unmapped.length) return '';
  const missing = m.unmapped
    .filter(key => SEND_REQUIRED_COLUMNS.includes(key))
    .map(key => (m.unmappedLabels || [])[m.unmapped.indexOf(key)] || key);
  if (!missing.length) return '';
  const chName = CHANNEL_INVOICE_LABEL[m.channel] || { cafe24: '카페24', other: '기타 채널' }[m.channel] || m.channel;
  return banner('warn', `${esc(chName)} 엑셀에서 못 찾은 열이 있어요: ${esc(missing.join(', '))}`,
    btn({ label: '설정에서 매핑', kind: 'text', size: 'sm', onclick: "go('settings')" }) +
    btn({ label: '닫기', kind: 'text', size: 'sm', onclick: 'window._sendMappingBanner=null;renderSend()' }));
}
// 헤더 버튼으로 여닫는 엑셀 업로드 카드(다른 채널 주문 + 우체국 송장)
function sendUploadCardHtml() {
  if (!window._sendUploadOpen) return '';
  return `<div class="card">
    <div class="step-title">다른 채널 주문 엑셀 넣기</div>
    <div class="hint">채널 어드민에서 받은 주문(배송) 엑셀을 그대로 넣으세요. 수령인·주소·상품·수량 열은 자동으로 알아봐요. 같은 주문번호는 두 번 들어가지 않아요.</div>
    <div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;margin:0.5rem 0">
      <label style="font-weight:700">판매채널</label>
      <select id="upload-channel" style="font-size:1rem;padding:0.4rem 0.6rem;border:1px solid var(--line-strong);border-radius:8px">
        <option value="29cm">29CM</option>
        <option value="musinsa">무신사</option>
        <option value="gsshop">GS샵</option>
        <option value="cafe24">카페24 (자동 연동이 안 될 때만)</option>
        <option value="other">기타 채널</option>
      </select>
    </div>
    <div class="dropzone" id="dz-cafe24" onclick="pickFile('orders')">여기에 주문 엑셀 파일을 끌어다 놓으세요</div>
    <div class="step-title" style="margin-top:20px">우체국 송장 엑셀 붙이기</div>
    <div class="hint">우체국 바로 접수를 썼다면 이 단계는 필요 없어요. 엑셀로 접수했을 때만, 우체국에서 받은 송장번호 엑셀을 넣으세요. 짝 맞추기 → 카페24 배송처리 → 재고 차감 → 구글시트 기록까지 한 번에 됩니다.</div>
    <div class="dropzone" id="dz-invoice" onclick="pickFile('invoice')">여기에 우체국 송장 엑셀을 끌어다 놓으세요<span class="small">또는 이 상자를 눌러서 파일을 선택하세요</span></div>
    <div id="invoice-result"></div>
  </div>`;
}
function toggleSendUpload() {
  window._sendUploadOpen = !window._sendUploadOpen;
  renderSend();
}

// 표 한 줄
function renderSendRow(m) {
  const { g, first } = m;
  const blocked = m.postalPending || m.shippingHold || m.sheetCancelHold || m.hold;

  // 상품 칸: 제품(사진+이름+옵션)마다 분리배송/재고부족 등 그 줄만의 안내
  const productsHtml = g.map(p => {
    const cell = productCell(p.x);
    let action = '';
    if (p.kind === 'orders' && p.x.orderNo) {
      const originalRows = DB.orders.filter(row => row.orderNo === p.x.orderNo && row.status !== '취소됨');
      const canSplitOrder = originalRows.length > 1 && originalRows.every(row =>
        row.status === '대기' && !row.invoice && !row.epost && !epostOperationUnresolved(row) &&
        !row.packGroupId && !row.parcelSplitId && !row.shippingHold
      );
      const stock = m.stockStates.get(p.x.id) || { state: 'unknown' };
      const shortage = stock.state === 'shortage'
        ? chipEl('bad', `재고 ${stock.available}개 · 필요 ${stock.needed}개`)
        : stock.state === 'unknown' ? chipEl('idle', '실물재고 확인 필요') : '';
      if (p.x.parcelSplitId) {
        action = p.x.shippingHold
          ? `${chipEl('processing', '분리배송 · 재고 기다림')} ${btn({ label: '재고 들어옴 · 이제 보내기', kind: 'text', size: 'sm', onclick: `releaseSplit(${p.x.id},'${jsq(p.x.name)}')` })} ${btn({ label: '원주문으로 합치기', kind: 'text', size: 'sm', onclick: `undoSplit('${jsq(p.x.orderNo)}','${jsq(p.x.name)}')` })}`
          : `${chipEl('idle', '분리배송')} ${btn({ label: '원주문으로 합치기', kind: 'text', size: 'sm', onclick: `undoSplit('${jsq(p.x.orderNo)}','${jsq(p.x.name)}')` })}`;
      } else if (canSplitOrder) {
        action = `${shortage} ${btn({ label: '이 상품만 나중에 보내기', kind: 'text', size: 'sm', onclick: `splitForLater(${p.x.id},'${jsq(p.x.name)}','${jsq(String(p.x.product || '').split('\n')[0])}')` })}`;
      }
    }
    return `<div style="margin:2px 0 6px">${cell}${action ? `<div style="margin-top:4px">${action}</div>` : ''}</div>`;
  }).join('');
  const notesHtml = [...new Set(g.map(p => shipmentMemoHtml(p.x)).filter(Boolean))].join(''); // 같은 주문의 상품마다 같은 메모가 반복되지 않게
  const staffMemoHtml = m.memoText ? `<div class="ship-note"><b>메모</b> ${esc(m.memoText)}</div>` : '';
  const packingAction = first.packGroupId
    ? `<div style="margin-top:4px">${chipEl('idle', '합포장 확정')} ${btn({ label: '묶음 풀기', kind: 'text', size: 'sm', onclick: `packUnmerge('${jsq(first.packGroupId)}','${jsq(first.name)}')` })}</div>`
    : m.mergeSuggestion
      ? `<div style="margin-top:4px">${btn({ label: `Cafe24 주문 ${m.mergeSuggestion.orderNos.length}건 합포하기`, kind: 'text', size: 'sm', onclick: `packMerge('${m.mergeSpec}','${jsq(first.name)}')` })}</div>`
      : '';

  // 주소 칸: 우편번호 없으면 입력창 + 자동조회 안내, 있으면 제주·도서산간 추가요금 칩
  const zipOk = /^\d{5}$/.test(String(first.zip || '').trim());
  const remote = zipOk ? remoteArea(first.zip) : null;
  const addrHtml = `${esc(first.addr)}${zipOk ? `<span class="sub">${esc(first.zip)}</span>` : ''}${remote ? `<div style="margin-top:4px">${chipEl('warn', '제주·도서 추가요금')}</div>` : ''}${m.noZip ? `
    <div style="margin-top:6px">
      <input id="zip-g-${g[0].kind}-${first.id}" class="zip-input" placeholder="5자리" maxlength="5">
      ${btn({ label: '저장', kind: 'text', size: 'sm', onclick: `fixZipGroup('${m.spec}','zip-g-${g[0].kind}-${first.id}')` })}
      ${first.zipLookupError
        ? `<div class="warn-text">${esc(first.zipLookupError)} ${btn({ label: '다시 찾기', kind: 'text', size: 'sm', onclick: `retryZip('${g[0].kind}',${first.id})` })}</div>`
        : `<div class="sub">주소로 자동 검색 중</div>`}
    </div>` : ''}`;

  // 상태 · 액션 칸: 막힌 사유가 있으면 그것만, 없으면 정상 상태칩 + 기본 행동들
  let statusHtml, actionHtml;
  if (m.hold) {
    statusHtml = chipEl('idle', '보류') + (m.holdReason ? `<div class="sub">${esc(m.holdReason)}</div>` : '');
    actionHtml = '';
  } else if (m.sheetCancelHold) {
    statusHtml = chipEl('wait', '시트 정리 필요') + `<div class="sub">기존 송장을 지우기 전 재발송 금지</div>`;
    actionHtml = btn({ label: '시트 정리 확인', kind: 'text', size: 'sm', onclick: `resolveLegacySheetCancel('${m.spec}','${jsq(first.name)}')` });
  } else if (m.shippingHold) {
    statusHtml = chipEl('processing', '재고 기다림') + `<div class="sub">우체국 접수에서 자동 제외</div>`;
    actionHtml = '';
  } else if (m.postalPending) {
    statusHtml = chipEl('processing', '접수 결과 확인 중') + `<div class="sub">같은 건 재접수 금지</div>`;
    actionHtml = btn({ label: '접수 결과 확인', kind: 'text', size: 'sm', onclick: 'epostRefresh()' });
  } else if (m.noZip) {
    statusHtml = chipEl('bad', '우편번호 없음');
    actionHtml = '';
  } else {
    const chips = m.stusSet.map(s => chip(s)).join(' ');
    const dupChip = m.dupHere.length ? ' ' + chipEl('bad', '중복 의심') : '';
    const staleNote = m.staleDays >= 3 ? `<div class="sub">${m.staleDays}일째 그대로</div>` : '';
    statusHtml = chips + dupChip + staleNote;
    const acts = [];
    if (m.dupHere.length) acts.push(btn({ label: '한 번 더 보내기', kind: 'text', size: 'sm', onclick: `resendOkGroup('${m.dupHere.map(p => p.kind + ':' + p.x.id).join(',')}','${jsq(first.name)}')` }));
    if (m.stusSet.includes('접수중')) acts.push(btn({ label: '엑셀 접수 취소', kind: 'text', size: 'sm', onclick: `cancelExcelGroup('${m.spec}','${jsq(first.name)}')` }));
    acts.push(btn({ label: '직접 보냄으로 표시', kind: 'text', size: 'sm', onclick: `manualShipGroup('${m.spec}','${jsq(first.name)}')` }));
    acts.push(btn({ label: '보내지 않음', kind: 'text', size: 'sm', onclick: `cancelSendGroup('${m.spec}','${jsq(first.name)}')` }));
    actionHtml = acts.join('');
  }
  // 보류/메모는 어느 상태든 항상 붙는 공통 행동
  const holdToggleBtn = btn({ label: m.hold ? '보류 해제' : '보류', kind: 'text', size: 'sm', onclick: `toggleHold('${m.spec}','${jsq(first.name)}',${m.hold ? 'false' : 'true'})` });
  const memoBtn = btn({ label: '메모', kind: 'text', size: 'sm', onclick: `openMemo('${m.spec}','${jsq(first.name)}','${jsq(String(m.memoText || '').replace(/\n/g, ' '))}')` });
  actionHtml = `<div class="btn-col">${actionHtml}${holdToggleBtn}${memoBtn}</div>`;

  return `<tr class="${m.allSel ? 'checked-row' : ''}${m.hold ? ' hold-row' : ''}">
    <td><input type="checkbox" ${m.allSel ? 'checked' : ''} ${blocked ? 'disabled' : ''} onchange="toggleSelGroup('${m.spec}',this.checked)"></td>
    <td><b>${esc(first.name)}</b>${first.insta ? `<span class="sub">${esc(first.insta)}</span>` : ''}<span class="sub">${esc(first.phone)} · ${esc(m.sourceLabel)}${first.orderNo ? ' ' + esc(first.orderNo) : ''}</span></td>
    <td style="min-width:240px;max-width:480px">${productsHtml}${packingAction}${notesHtml}${staffMemoHtml}</td>
    <td class="num">${m.groupProductQty}</td>
    <td style="max-width:420px">${addrHtml}</td>
    <td>${statusHtml}</td>
    <td class="acts">${actionHtml}</td>
  </tr>`;
}

function renderSend() {
  const notDone = x => x.status !== '발송완료' && x.status !== '취소됨';
  const pending = [
    ...DB.orders.filter(notDone).map(x => ({ kind: 'orders', x })),
    ...DB.seeding.filter(notDone).map(x => ({ kind: 'seeding', x }))
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
  const selectedGroups = groupsArr.filter(g => !g.some(p => p.x.shippingHold || p.x.sheetCancelHold || p.x.hold) && g.every(p => p.x._sel !== false));
  const selCount = selectedGroups.length;
  const selProductQty = productQuantity(selectedGroups.flat(), entry => entry.x);
  const mergeSuggestions = HamItemLines.cafe24MergeSuggestions(
    pending.filter(entry => !(entry.x && entry.x.hold)), // 보류 건은 합포장 추천에서 뺀다 (서버도 merge 를 거부함)
    DB.orders.map(x => ({ kind: 'orders', x }))
  );
  const stockStates = HamItemLines.shipmentStockStates(DB.orders.filter(notDone), DB.inventory || []);

  const metas = groupsArr.map(g => buildSendMeta(g, stockStates, mergeSuggestions));
  const catCount = key => metas.filter(m => m.category === key).length;
  const holdCount = metas.filter(m => m.hold).length;
  const filter = window._sendFilter || 'all';
  const q = (window._sendQuery || '').trim();
  const visible = metas.filter(m => (filter === 'all' || (filter === 'hold' ? m.hold : m.category === filter)) && (!q || matchQ(sendSearchText(m), q)));

  const epostConnected = !!(SYNC_STATUS && SYNC_STATUS.epost && SYNC_STATUS.epost.connected);
  const invoiceExportChannels = Object.keys(CHANNEL_INVOICE_LABEL).filter(ch =>
    DB.orders.some(x => x.sourceChannel === ch && x.status === '발송완료' && x.invoice));
  const headerActions = [
    btn({ kind: 'secondary', icon: 'refresh', label: '새로 고침', onclick: 'doSync()' }),
    btn({ kind: 'secondary', icon: 'upload', label: window._sendUploadOpen ? '엑셀 넣기 닫기' : '엑셀로 넣기', onclick: 'toggleSendUpload()' }),
    btn({ kind: 'secondary', icon: 'print', label: '오늘 쌀 목록 인쇄', onclick: "window.open('/pick.html','_blank')" }),
    btn({ kind: 'secondary', icon: 'print', label: '포장 명세 인쇄', onclick: 'printPackingSlip()' }),
    invoiceExportChannels.length ? btn({ kind: 'secondary', icon: 'download', label: '채널 송장 엑셀 만들기', onclick: 'exportChannelInvoices()' }) : '',
    epostConnected ? btn({ kind: 'secondary', icon: 'download', label: '엑셀로 접수', onclick: 'doExportAll()', title: '우체국 바로 접수가 안 될 때 엑셀 파일로 접수' }) : '',
    epostConnected
      ? btn({ kind: 'primary', label: `체크한 ${selCount}건 우체국 접수`, onclick: 'doEpostRegister()' })
      : btn({ kind: 'primary', label: `체크한 ${selCount}건 엑셀로 접수`, onclick: 'doExportAll()' })
  ].join('');

  const header = pageHeader({
    title: '보내기',
    sub: '카페24 주문과 시딩 선물을 한 번에 우체국으로 보낼 준비를 해요.',
    actions: headerActions
  });

  const connBanner = sendConnBanner();
  const mappingBanner = sendMappingBanner();
  const issueBanner = sendIssueBanner(metas);
  const mergeBanner = sendMergeBanner(mergeSuggestions);
  const uploadCard = sendUploadCardHtml();

  let body;
  if (!pending.length) {
    body = `<div class="card">${emptyState({
      icon: 'send',
      title: '지금은 보낼 것이 없어요',
      sub: '새 주문·신청이 들어오면 여기에 자동으로 나타나요.'
    })}</div>`;
  } else {
    const toolbar = `<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      ${seg([
        { key: 'all', label: '전체', count: metas.length, on: filter === 'all', onclick: "window._sendFilter='all';renderSend()" },
        { key: 'cafe24', label: '카페24', count: catCount('cafe24'), on: filter === 'cafe24', onclick: "window._sendFilter='cafe24';renderSend()" },
        { key: 'seeding', label: '시딩', count: catCount('seeding'), on: filter === 'seeding', onclick: "window._sendFilter='seeding';renderSend()" },
        { key: 'exchange', label: '교환 재발송', count: catCount('exchange'), on: filter === 'exchange', onclick: "window._sendFilter='exchange';renderSend()" },
        // 채널 세그먼트는 그 채널 건이 있을 때만 보인다 (평소엔 버튼이 늘지 않게)
        ...Object.keys(CHANNEL_INVOICE_LABEL).filter(ch => catCount(ch) > 0).map(ch => ({
          key: ch, label: CHANNEL_INVOICE_LABEL[ch], count: catCount(ch), on: filter === ch,
          onclick: "window._sendFilter='" + ch + "';renderSend()"
        })),
        { key: 'direct', label: '직접 등록', count: catCount('direct'), on: filter === 'direct', onclick: "window._sendFilter='direct';renderSend()" },
        { key: 'hold', label: '보류', count: holdCount, on: filter === 'hold', onclick: "window._sendFilter='hold';renderSend()" }
      ])}
      ${searchBox({
        id: 'send-search',
        placeholder: '이름, 상품, 전화번호로 찾기',
        value: window._sendQuery || '',
        oninput: "window._sendQuery=this.value;renderSend();var i=document.getElementById('send-search');if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length);}"
      })}
      <div style="margin-left:auto;display:flex;gap:2px">
        ${btn({ label: '전체 선택', kind: 'text', size: 'sm', onclick: 'selAll(true)' })}
        ${btn({ label: '전체 해제', kind: 'text', size: 'sm', onclick: 'selAll(false)' })}
      </div>
    </div>`;
    const rowsHtml = visible.length
      ? visible.map(renderSendRow).join('')
      : `<tr><td colspan="7">${emptyState({ title: '조건에 맞는 항목이 없어요', sub: '다른 세그먼트나 검색어를 확인해 보세요.' })}</td></tr>`;
    const table = tableWrap(`<table class="tbl">
      <thead><tr><th style="width:44px"></th><th>받는 분</th><th>상품</th><th>수량</th><th>주소</th><th>상태</th><th></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`);
    body = toolbar + table +
      `<div class="hint" style="margin-top:0.9rem">현재 선택: <b>${selCount}건</b> · 포장할 상품 <b>${selProductQty}개</b></div>
      <div id="export-result"></div>`;
  }

  main().innerHTML = header + connBanner + mappingBanner + mergeBanner + issueBanner + uploadCard + body;
  setupDropzones();
  // 우편번호 없는 건은 즉시 자동 조회 시작
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
  toast('우편번호를 저장했어요. 이제 접수할 수 있어요.');
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
  toast('[보낼 준비]로 되돌렸어요.');
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
    toast('우편번호를 자동으로 찾아 넣었어요: ' + r.zip, 5000);
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
  if (!(r && r.ok && r.zip)) toast((r && r.error) || '주소를 확인한 뒤 다시 눌러 주세요.', 6000);
}
// 전체 선택/해제 (보내기 목록)
function selAll(v) {
  const notDone = x => x.status !== '발송완료' && x.status !== '취소됨';
  for (const list of [DB.orders, DB.seeding]) {
    for (const x of list) if (notDone(x)) x._sel = (x.shippingHold || x.sheetCancelHold || x.hold) ? false : v;
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
  toast('우편번호를 저장했어요. 이제 접수할 수 있어요.');
}
async function cancelSendGroup(spec, name) {
  const items = specItems(spec);
  if (!confirm(`${name}님 건(${items.length}개)을 보내지 않기로 할까요?\n\n· 보내기 목록에서 빠져요\n· [배송 확인]에서 [다시 보내기]로 언제든 되돌릴 수 있어요`)) return;
  for (const { x } of items) { x.status = '취소됨'; x.manualCanceled = true; }
  await saveDb();
  render();
  toast('취소했어요. 마음이 바뀌면 [배송 확인]에서 [다시 보내기]를 누르세요.', 6000);
}
async function cancelExcelGroup(spec, name) {
  if (!confirm(`${name}님 건의 엑셀 접수를 취소하고 [보낼 준비]로 되돌릴까요?\n(우체국 사이트에 이미 파일을 올렸다면 거기서도 지워 주세요)`)) return;
  for (const { x } of specItems(spec)) if (x.status === '접수중') x.status = '대기';
  await saveDb();
  render();
  toast('[보낼 준비]로 되돌렸어요.');
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
// 보류/보류 해제 — 그룹(spec) 안 모든 항목에 적용. 보류 중엔 접수·합포장 추천에서 빠진다(백엔드가 걸러줌).
async function applyHoldSpec(spec, holdOn, reason) {
  let lastDb = null;
  for (const { kind, x } of specItems(spec)) {
    const r = await api('/api/hold', { method: 'POST', body: JSON.stringify({ type: kind === 'seeding' ? 'seeding' : 'order', id: x.id, hold: holdOn, reason: holdOn ? reason : undefined }) });
    if (r.error) { toast(r.error, 6000); return false; }
    if (r.db) lastDb = r.db;
  }
  if (lastDb) adoptDb(lastDb);
  return true;
}
async function toggleHold(spec, name, holdOn) {
  let reason = '';
  if (holdOn) {
    reason = prompt(`${name}님 건을 보류할까요?\n사유를 적어 주세요 (예: 주소 확인 중). 비워둬도 돼요.`);
    if (reason === null) return;
    reason = reason.trim().slice(0, 80);
  } else if (!confirm(`${name}님 건 보류를 해제할까요?\n다음 우체국 접수·합포장 추천에 다시 포함돼요.`)) {
    return;
  }
  const ok = await applyHoldSpec(spec, holdOn, reason);
  if (!ok) return;
  renderSend();
  toast(holdOn ? '보류했어요. 접수·합포장 추천에서 빠져요.' : '보류를 해제했어요.', 6000);
}
// 처음(home) 화면의 '보류 N건' 카드에서 여기로 곧장 들어올 때 씀
function openSendHold() {
  window._sendFilter = 'hold';
  go('send');
}
// 메모(우리가 적는 메모) — 고객이 남긴 배송메모(msg)와 별개
async function openMemo(spec, name, current) {
  const memo = prompt(`${name}님 메모를 적어 주세요 (최대 200자).`, current || '');
  if (memo === null) return;
  const text = memo.trim().slice(0, 200);
  let lastDb = null;
  for (const { kind, x } of specItems(spec)) {
    const r = await api('/api/memo', { method: 'POST', body: JSON.stringify({ type: kind === 'seeding' ? 'seeding' : 'order', id: x.id, memo: text }) });
    if (r.error) { toast(r.error, 6000); return; }
    if (r.db) lastDb = r.db;
  }
  if (lastDb) adoptDb(lastDb);
  render();
  toast('메모를 저장했어요.');
}
// 채널(29CM·무신사·GS샵) 송장 등록용 엑셀 — 발송완료 건이 있는 채널만 버튼에 뜬다
async function exportChannelInvoices() {
  const avail = Object.keys(CHANNEL_INVOICE_LABEL).filter(ch => DB.orders.some(x => x.sourceChannel === ch && x.status === '발송완료' && x.invoice));
  if (!avail.length) { toast('내보낼 채널 송장이 없어요.'); return; }
  let channel = avail[0];
  if (avail.length > 1) {
    const listStr = avail.map((ch, i) => `${i + 1}) ${CHANNEL_INVOICE_LABEL[ch]}`).join('\n');
    const answer = prompt(`어느 채널 송장 엑셀을 내려받을까요?\n${listStr}\n\n번호를 입력하세요.`, '1');
    if (answer === null) return;
    const idx = Number(String(answer).trim()) - 1;
    if (!avail[idx]) { toast('번호를 다시 확인해 주세요.'); return; }
    channel = avail[idx];
  }
  await downloadChannelInvoices(channel, false);
}
// 서버가 "내보냄" 표시를 남기는 POST — 파일이면 저장하고, JSON 이면 이유를 말해 준다
async function downloadChannelInvoices(channel, all) {
  const r = await downloadFile('/api/export/channel-invoices.xlsx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, all: !!all })
  }, channel + '_송장등록.xlsx');
  if (r && r.ok) { toast((CHANNEL_INVOICE_LABEL[channel] || channel) + ' 송장 엑셀을 내려받았어요.', 5000); return; }
  if (r && r.code === 'empty' && !all) {
    if (confirm('새로 내보낼 송장이 없어요.\n\n이미 내보낸 건까지 다시 만들까요?')) return downloadChannelInvoices(channel, true);
    return;
  }
  toast((r && r.error) || '송장 엑셀을 만들지 못했어요.', 6000);
}
// 체크한 건만 포장 명세(A6, 택배 1건당 1장)로 새 창에서 열기
// doExportAll/doEpostRegister와 같은 방식(HamItemLines.fullySelectedEntries)으로 묶어야
// 한 소포(같은 주문번호)의 다른 상품 줄이 보류일 때 이 상품만 빠져나가 인쇄되는 걸 막는다.
function printPackingSlip() {
  const sendable = x => x.status !== '발송완료' && x.status !== '취소됨' &&
    !x.shippingHold && !x.sheetCancelHold && !x.hold && x._sel !== false;
  const candidates = [
    ...DB.orders.filter(x => x.status !== '발송완료' && x.status !== '취소됨').map(x => ({ type: 'order', kind: 'orders', x })),
    ...DB.seeding.filter(x => x.status !== '발송완료' && x.status !== '취소됨').map(x => ({ type: 'seeding', kind: 'seeding', x }))
  ];
  const ids = HamItemLines.fullySelectedEntries(
    candidates,
    entry => pendingFulfillmentKey(entry.kind, entry.x),
    entry => sendable(entry.x)
  ).map(entry => entry.type + ':' + entry.x.id);
  if (!ids.length) { toast('체크된 건이 없어요. 표에서 먼저 체크해 주세요.'); return; }
  window.open('/packing.html?ids=' + encodeURIComponent(ids.join(',')), '_blank');
}
async function manualShipGroup(spec, name) {
  const items = specItems(spec);
  if (!confirm(`${name}님 것(${items.length}개)을 우체국 창구 등 앱 밖에서 정말 이미 보내셨나요?\n\n· [발송 완료]로 확정돼요 (재고 차감 · 카페24 배송처리 · 시트 기록까지 자동)\n· 한 번 확정하면 되돌리기 어려워요`)) return;
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
  toast(r.error ? '처리하지 못했어요: ' + r.error : `${name}님 포장 전체를 발송완료로 정리했어요.`, 7000);
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
    if (r.error) { toast(r.error, 5000); return; }
    if (r.db) adoptDb(r.db);
    if (window._dupIds) window._dupIds.delete(s);
  }
  renderSend();
  toast('확인했어요. 이제 [우체국 접수]를 누르면 한 번 더 보내져요.', 6000);
}

async function packMerge(spec, name) {
  if (!confirm(`${name}님의 서로 다른 출고를 한 비닐에 같이 넣을까요?\n\n· 송장번호는 1개만 나옵니다\n· 제품은 모두 같은 비닐에 포장해야 합니다`)) return;
  const selected = spec.split(',').filter(Boolean).map(s => {
    const [kind, id] = s.split(':');
    return { type: kind === 'seeding' ? 'seeding' : 'order', id: Number(id) };
  });
  const r = await api('/api/packing/merge', { method: 'POST', body: JSON.stringify({ selected }) });
  if (r.error) { toast(r.error, 6000); return; }
  adoptDb(r.db);
  renderSend();
  toast(`한 비닐로 묶었어요. 택배 1건에 상품 ${r.count}개가 들어갑니다.`, 6000);
}

async function packUnmerge(packGroupId, name) {
  if (!confirm(`${name}님의 합포장을 풀까요?\n각 주문·신청별로 송장이 따로 나옵니다.`)) return;
  const r = await api('/api/packing/unmerge', { method: 'POST', body: JSON.stringify({ packGroupId }) });
  if (r.error) { toast(r.error, 6000); return; }
  adoptDb(r.db);
  renderSend();
  toast('합포장을 풀었어요. 출고가 각각 따로 보입니다.', 5000);
}

async function splitForLater(id, name, product) {
  if (!confirm(`${name}님의 '${product}'만 나중에 따로 보낼까요?\n\n· 지금 보내는 상품들은 먼저 송장 1개로 나갑니다\n· 이 상품은 재고가 들어올 때까지 우체국 접수에서 빠집니다\n· 재고가 들어오면 [재고 들어옴 · 이제 보내기]를 누르면 별도 송장이 나옵니다`)) return;
  const r = await api('/api/packing/split', { method: 'POST', body: JSON.stringify({ id }) });
  if (r.error) { toast(r.error, 6000); return; }
  adoptDb(r.db);
  const item = DB.orders.find(row => row.id === id);
  if (item) item._sel = false;
  renderSend();
  toast('이 상품을 분리배송 대기로 옮겼어요. 지금 우체국 접수에서는 자동으로 빠집니다.', 6000);
}

async function releaseSplit(id, name) {
  if (!confirm(`${name}님의 분리배송 상품 재고가 실제로 들어왔나요?\n\n[확인]을 누르면 보내기 체크가 켜지고, 다음 우체국 접수 때 별도 송장이 발급됩니다.`)) return;
  const r = await api('/api/packing/split/release', { method: 'POST', body: JSON.stringify({ id }) });
  if (r.error) { toast(r.error, 6000); return; }
  adoptDb(r.db);
  const item = DB.orders.find(row => row.id === id);
  if (item) item._sel = true;
  renderSend();
  toast('별도 배송할 준비가 됐어요. 체크된 상태로 다음 우체국 접수에 포함됩니다.', 6000);
}

async function undoSplit(orderNo, name) {
  if (!confirm(`${name}님의 분리배송을 취소하고 원래 주문 한 송장으로 다시 합칠까요?\n모든 상품이 아직 접수 전일 때만 가능합니다.`)) return;
  const r = await api('/api/packing/split/undo', { method: 'POST', body: JSON.stringify({ orderNo }) });
  if (r.error) { toast(r.error, 6000); return; }
  adoptDb(r.db);
  for (const item of DB.orders.filter(row => row.orderNo === orderNo)) item._sel = true;
  renderSend();
  toast('원래 주문 한 송장으로 다시 합쳤어요.', 5000);
}


async function doExportAll() {
  const sendable = x => x.status !== '발송완료' && x.status !== '취소됨' &&
    x.status !== '접수중' && !x.shippingHold && !x.sheetCancelHold && !x.hold && !epostOperationUnresolved(x) && x._sel !== false;
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
  if (!confirm(`택배 ${parcelCount}건짜리 우체국 엑셀 파일을 내려받을까요?\n\n· 이 컴퓨터의 다운로드 폴더에 저장돼요.\n· 목록이 [엑셀 접수 중]으로 바뀌어요 (잘못 눌렀으면 [엑셀 접수 취소]로 되돌려요)`)) return;
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
    toast(error.message || '엑셀 파일을 만들지 못했어요.', 7000);
  } finally {
    busy(false);
  }
}

// 앱 밖에서 따로 보낸 건 정리 (우체국 창구, 다른 택배 등)
async function manualShip(kind, id, name) {
  if (!confirm(`${name}님 것을 우체국 창구 등 앱 밖에서 정말 이미 보내셨나요?\n\n· [발송 완료]로 확정돼요 (재고 차감 · 카페24 배송처리 · 시트 기록까지 자동)\n· 한 번 확정하면 되돌리기 어려워요`)) return;
  const inv = prompt(`${name}님 것을 앱 밖에서 이미 보내셨군요.\n\n송장번호가 있으면 입력해 주세요.\n없으면 빈칸 그대로 [확인]을 누르세요.`);
  if (inv === null) return;
  busy(true, '발송완료로 정리하는 중…');
  const r = await api('/api/manual-ship', { method: 'POST', body: JSON.stringify({ type: kind === 'seeding' ? 'seeding' : 'order', id, invoice: (inv || '').trim() }) });
  busy(false);
  if (r.error) { toast(r.error, 6000); return; }
  adoptDb(r.db);
  render();
  const extras = [];
  if (r.stock && r.stock.length) extras.push('재고 차감');
  if (r.stockMissing && r.stockMissing.length) extras.push(`재고 확인 필요 ${r.stockMissing.length}개`);
  if (r.cafe24 && r.cafe24.some(c => c.ok)) extras.push('카페24 배송처리');
  if (r.sheet && r.sheet.ok) extras.push('구글시트 기록');
  toast(`${name}님 건을 발송완료로 정리했어요.` + (extras.length ? ' (자동: ' + extras.join(' · ') + ')' : ''), 7000);
}

// 우체국 OpenAPI 바로 접수
async function doEpostRegister() {
  // '접수중'(엑셀로 이미 접수)은 제외 — 같은 사람에게 두 번 보내는 것 방지
  const sendable = x => x.status !== '발송완료' && x.status !== '취소됨' && x.status !== '접수중' &&
    !x.shippingHold && !x.sheetCancelHold && !x.hold && x._sel !== false;
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
  if (r.error) { toast(r.error, 7000); return; }
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
    html += `<div class="result-box ok"><div class="big">우체국 접수 완료. 송장번호가 나왔어요.</div>` +
      ok.map(x => `${esc(x.name)} → 송장 <b>${esc(x.regiNo)}</b>${x.price ? ' (예상요금 ' + esc(x.price) + '원)' : ''}`).join('<br>') +
      (printSel.length ? `<div style="margin-top:0.8rem">${btn({ label: '운송장 인쇄', kind: 'success', onclick: `printLabels('${printSel.join(',')}')` })}</div>` : '') +
      `<div class="muted" style="font-size:0.95rem;font-weight:400;margin-top:0.6rem">이 내용은 [우체국 접수] 화면에서 언제든 다시 볼 수 있어요.</div></div>`;
  }
  if (fail.length) {
    html += `<div class="result-box err"><div class="big">접수 못 한 건 ${fail.length}건</div>` +
      fail.map(x => `${esc(x.name)}: ${esc(x.error)}`).join('<br>') + '</div>';
  }
  const extra = [];
  if (r.cafe24 && r.cafe24.length) {
    const c = r.cafe24.filter(x => x.ok).length;
    if (c) extra.push(`카페24에도 송장 ${c}건 자동 등록 완료`);
    r.cafe24.filter(x => !x.ok).slice(0, 3).forEach(f => extra.push(`카페24 등록 못 함 (${esc(f.orderNo)}): ${esc(f.error)}`));
  }
  if (r.stock && r.stock.length) extra.push('재고 자동 차감: ' + r.stock.map(s => `${esc(s.name)} −${s.minus}`).join(', '));
  if (r.stockMissing && r.stockMissing.length) {
    extra.push('재고에서 못 찾음: ' + r.stockMissing.map(s => `${esc(s.product)}${s.option ? ' (' + esc(s.option) + ')' : ''}`).join(', ') + ' — [재고]에서 SKU를 확인해 주세요.');
  }
  if (r.sheet) extra.push(r.sheet.ok ? `구글시트에도 송장 ${r.sheet.count}건 기록 완료` : `구글시트 기록 실패: ${esc(r.sheet.error)}`);
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
    toast('파일이 너무 커요. 10MB 이하 엑셀 또는 CSV 파일을 골라 주세요.', 7000);
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
    if (r.error) { toast(r.error, 7000); return; }
    adoptDb(r.db);
    if (which === 'orders') {
      window._sendMappingBanner = (r.unmapped && r.unmapped.length)
        ? { channel: r.channel, unmapped: r.unmapped, unmappedLabels: r.unmappedLabels || [], sampleHeaders: r.sampleHeaders }
        : null;
      render();
      const chName = { cafe24: '카페24', '29cm': '29CM', musinsa: '무신사', gsshop: 'GS샵', other: '기타 채널' }[r.channel] || '';
      toast(`${chName} 주문 ${r.added}건을 새로 가져왔어요.` + (r.total - r.added > 0 ? ` (이미 있던 ${r.total - r.added}건은 건너뜀)` : ''), 6000);
    } else {
      render();
      const box = $('#invoice-result');
      let html = '';
      if (r.matched.length) {
        html += `<div class="result-box ok"><div class="big">${r.matched.length}건의 송장번호를 붙였어요.</div>` +
          r.matched.slice(0, 10).map(m => `${esc(m.name)} → ${esc(m.invoice)}`).join('<br>') +
          (r.matched.length > 10 ? `<br>… 외 ${r.matched.length - 10}건` : '') + '</div>';
      }
      if (r.unmatched.length) {
        html += `<div class="result-box warn"><div class="big">짝을 못 찾은 송장 ${r.unmatched.length}건</div>` +
          r.unmatched.slice(0, 10).map(u => `${esc(u.invoice)} (${esc(u.name || '이름 없음')}) - ${esc(u.reason)}`).join('<br>') +
          '<br><span style="font-weight:400">이미 처리됐거나 이름이 다른 경우예요. 배송 확인 화면에서 직접 확인해 주세요.</span></div>';
      }
      // 자동 후처리 결과
      const extra = [];
      if (r.cafe24 && r.cafe24.length) {
        const ok = r.cafe24.filter(c => c.ok).length;
        const fail = r.cafe24.filter(c => !c.ok);
        if (ok) extra.push(`카페24에도 송장 ${ok}건을 자동 등록하고 배송중으로 바꿨어요.`);
        for (const f of fail.slice(0, 3)) extra.push(`카페24 등록 못 함 (주문 ${esc(f.orderNo)}): ${esc(f.error)}`);
      }
      if (r.stock && r.stock.length) {
        extra.push('재고에서 자동으로 뺐어요: ' + r.stock.slice(0, 6).map(s => `${esc(s.name)} −${s.minus} (남은 ${s.left}개)`).join(', '));
      }
      if (r.stockMissing && r.stockMissing.length) {
        extra.push('재고에서 못 찾은 제품: ' + r.stockMissing.slice(0, 6).map(s => `${esc(s.product)}${s.option ? ' (' + esc(s.option) + ')' : ''}`).join(', ') + ' — [재고]에서 SKU를 확인해 주세요.');
      }
      if (r.sheet) {
        extra.push(r.sheet.ok ? `구글시트에도 송장 ${r.sheet.count}건을 자동으로 적었어요.` : `구글시트 기록 실패: ${esc(r.sheet.error)}`);
      }
      if (extra.length) html += `<div class="result-box ok" style="font-weight:400">${extra.join('<br>')}</div>`;
      if (!html) html = '<div class="result-box warn">이 파일에서 송장번호를 찾지 못했어요.</div>';
      const box2 = $('#invoice-result');
      if (box2) box2.innerHTML = html;
    }
  } catch (e) {
    busy(false);
    toast('파일을 읽지 못했어요: ' + e.message, 7000);
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
