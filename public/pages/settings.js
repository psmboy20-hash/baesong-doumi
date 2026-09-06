
// ---------- 설정 ----------
async function changeAccessCode() {
  const current = $('#set-code-cur').value.trim();
  const next = $('#set-code-new').value.trim();
  if (!next) { toast('새 코드를 적어 주세요.'); return; }
  if (!confirm(`접속 코드를 '${next}'(으)로 바꿀까요?\n\n· 다른 컴퓨터·폰은 새 코드를 한 번 다시 입력해야 해요\n· allin_v4 같은 외부 연동도 새 코드로 바꿔야 해요`)) return;
  const r = await api('/api/access-code', { method: 'POST', body: JSON.stringify({ current, next }) });
  if (r.error) { toast(r.error, 6000); return; }
  toast('접속 코드를 바꿨어요. 이 컴퓨터는 그대로 쓸 수 있어요.', 6000);
  renderSettings();
}

function renderSettings() {
  const s = DB.settings;
  const c24 = SYNC_STATUS && SYNC_STATUS.cafe24;
  const c24Connected = c24 && c24.connected;
  const epost = SYNC_STATUS && SYNC_STATUS.epost;
  const epostConnected = epost && epost.connected;
  const sheetOn = !!s.sheetWebhookUrl;
  const kakaoOn = !!s.kakaoRestKey;
  const notifyOn = 'Notification' in window && Notification.permission === 'granted';

  const header = pageHeader({
    title: '설정',
    sub: '가게 정보와 외부 연동을 관리해요. 한 번만 해두면 돼요.',
    actions: btn({ label: '설정 저장', onclick: 'saveSettings()', kind: 'primary', icon: 'check' })
  });

  const senderCard = `<div class="card">
    <div class="step-title">보내는 분 정보</div>
    <div class="hint">택배를 보낼 때 쓰는 우리 가게 정보예요.</div>
    <div class="form-row"><label for="set-name">보내는 분 이름 (가게 이름)</label><input id="set-name" value="${esc(s.senderName)}"></div>
    <div class="form-row"><label for="set-phone">보내는 분 전화번호</label><input id="set-phone" value="${esc(s.senderPhone)}" placeholder="예: 010-1234-5678"></div>
    <div class="form-row"><label for="set-zip">보내는 분 우편번호</label><input id="set-zip" value="${esc(s.senderZip)}" placeholder="예: 07997"></div>
    <div class="form-row"><label for="set-addr">보내는 분 주소</label><input id="set-addr" value="${esc(s.senderAddr)}" placeholder="예: 서울 양천구 목동로 000"></div>
    <div class="form-row"><label for="set-content">내용품명 (기본값)</label><input id="set-content" value="${esc(s.defaultContent)}"></div>
  </div>`;

  const c24ErrorHtml = c24 && c24.ok === false ? banner('bad', esc(c24.error || '')) : '';
  const connCard = `<div class="card">
    <div class="step-title">연결</div>
    <div class="hint">주문·시딩·접수를 자동으로 처리하려면 아래 서비스와 연결하세요.</div>

    <div style="padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--line)">
      <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;margin-bottom:6px">카페24 ${chipEl(c24Connected ? 'ok' : 'idle', c24Connected ? '연결됨' : '연결 안 됨')}</div>
      <div class="hint">카페24 주문을 자동으로 가져와요. <a class="track-link" target="_blank" href="https://developers.cafe24.com">카페24 개발자센터</a>의 앱에서 아래 값을 확인해 넣어 주세요. (권한: 주문 조회)</div>
      <div class="form-row"><label for="set-c24mall">쇼핑몰 아이디 (mall id)</label><input id="set-c24mall" value="${esc(s.cafe24MallId)}" placeholder="예: nusolvere"></div>
      <div class="form-row"><label for="set-c24id">Client ID</label><input id="set-c24id" value="${esc(s.cafe24ClientId)}"></div>
      <div class="form-row"><label for="set-c24secret">Client Secret</label><input id="set-c24secret" type="password" value="${esc(s.cafe24ClientSecret)}"></div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
        ${btn({ label: '카페24 연결', onclick: 'cafe24Connect()', icon: 'external' })}
        ${c24Connected ? btn({ label: '연결 끊기', onclick: 'cafe24Disconnect()', kind: 'danger', size: 'sm' }) : ''}
      </div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)">
        <div class="hint">순서: [카페24 연결] → 카페24 로그인 → [동의] → 쇼핑몰 홈으로 이동되면 주소창의 주소 전체를 복사해 아래에 붙여넣고 [연결 완료]를 누르세요.</div>
        <div class="form-row"><label for="set-c24code">이동된 페이지 주소</label><input id="set-c24code" placeholder="code=... 가 들어있는 주소를 붙여넣으세요"></div>
        ${btn({ label: '연결 완료', onclick: 'cafe24PasteCode()' })}
      </div>
      ${c24ErrorHtml}
    </div>

    <div style="padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--line)">
      <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;margin-bottom:6px">구글시트 ${chipEl(sheetOn ? 'ok' : 'idle', sheetOn ? '켜짐' : '꺼짐')}</div>
      <div class="hint">시딩 주문을 가져오고, 송장번호를 시트에 자동으로 적어줘요. 자동 기록은 시트에 스크립트를 한 번 설치해야 해요 — 프로젝트 폴더의 구글시트-자동기록-설치법.md 참고.</div>
      <div class="form-row"><label for="set-sheetid">시딩 구글시트 주소</label><input id="set-sheetid" value="${esc(s.sheetId)}" placeholder="구글시트 링크를 통째로 붙여넣으세요"></div>
      <div class="form-row"><label for="set-whurl">웹 앱 주소 (자동 기록, 선택)</label><input id="set-whurl" value="${esc(s.sheetWebhookUrl)}" placeholder="https://script.google.com/macros/s/..../exec"></div>
      <div class="form-row"><label for="set-whtoken">비밀 암호 (선택)</label><input id="set-whtoken" value="${esc(s.sheetWebhookToken)}" placeholder="비워두면 암호 검사 안 함"></div>
    </div>

    <div style="padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--line)">
      <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;margin-bottom:6px">우체국 바로 접수 ${chipEl(epostConnected ? 'ok' : 'idle', epostConnected ? '연결됨' : '연결 안 됨')}</div>
      <div class="hint">연결하면 [보내기]에서 버튼 한 번으로 우체국 접수와 송장번호 발급이 됩니다. 계약고객시스템 → 고객센터 → 오픈API신청결과 화면의 인증키와 접수용 보안키를 붙여넣으세요.</div>
      <div class="form-row"><label for="set-epkey">인증키</label><input id="set-epkey" value="${esc(s.epostApiKey)}"></div>
      <div class="form-row"><label for="set-epsec">접수용 보안키</label><input id="set-epsec" type="password" value="${esc(s.epostSecKey)}"></div>
      <div class="form-row"><label for="set-epid">인터넷우체국 아이디</label><input id="set-epid" value="${esc(s.epostMemberId)}"></div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
        ${btn({ label: '우체국 연결', onclick: 'epostConnect()', icon: 'external' })}
        ${epostConnected ? btn({ label: '테스트 접수', onclick: 'epostTest()' }) : ''}
      </div>
      ${DB.epost ? `<div class="hint" style="margin-top:8px">고객번호 ${esc(DB.epost.custNo)} · 계약승인번호 ${esc(DB.epost.apprNo)} · 공급지 ${esc(DB.epost.officeNm || DB.epost.officeSer)}</div>` : ''}
      <div id="epost-result"></div>
    </div>

    <div>
      <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;margin-bottom:6px">주소 → 우편번호 자동 변환 ${chipEl(kakaoOn ? 'ok' : 'idle', kakaoOn ? '켜짐' : '꺼짐 (선택)')}</div>
      <div class="hint">시딩 신청에 우편번호가 없으면 접수가 안 돼요. 켜두면 주소만으로 우편번호를 자동으로 찾아줍니다. <a class="track-link" target="_blank" href="https://developers.kakao.com">카카오 개발자 사이트</a>에서 무료로 REST API 키를 받아 붙여넣으세요. (없어도 목록에서 직접 5자리를 넣을 수 있어요)</div>
      <div class="form-row"><label for="set-kakao">카카오 REST API 키</label><input id="set-kakao" value="${esc(s.kakaoRestKey || '')}" placeholder="카카오에서 받은 긴 영문+숫자 키"></div>
    </div>
  </div>`;

  const backupCard = `<div class="card">
    <div class="step-title">백업</div>
    <div class="hint">장부(주문·시딩·재고·기록 전부)를 하루에 한 번 자동으로 복사해 30일치 보관해요. 크게 잘못됐을 때 예전 날짜로 되돌릴 수 있어요.</div>
    <div style="margin-bottom:12px">${btn({ label: '백업 폴더 열기', onclick: "api('/api/backup/open',{method:'POST'})" })}</div>
    <div id="backup-list" class="hint">백업 목록을 불러오는 중…</div>
  </div>`;

  const codeCard = `<div class="card">
    <div class="step-title">접속 코드</div>
    <div class="hint">다른 컴퓨터·폰에서 처음 들어올 때 묻는 코드예요. 새어나갔다 싶으면 여기서 바꾸세요. 바꾸면 다른 기기들은 새 코드를 한 번 다시 입력해야 해요.</div>
    <div class="form-row"><label for="set-code-cur">지금 코드</label><input id="set-code-cur" type="password" autocomplete="off" placeholder="현재 접속 코드"></div>
    <div class="form-row"><label for="set-code-new">새 코드 (4~10자리 숫자·영문)</label><input id="set-code-new" autocomplete="off" placeholder="예: 731205"></div>
    ${btn({ label: '코드 바꾸기', onclick: 'changeAccessCode()' })}
  </div>`;

  const notifyCard = `<div class="card">
    <div class="step-title">알림 ${chipEl(notifyOn ? 'ok' : 'idle', notifyOn ? '켜짐' : '꺼짐')}</div>
    <div class="hint">창을 안 보고 있어도 새 주문·교환반품이 오면 컴퓨터 알림으로 알려줘요. 기사님 오시기 1시간 전에 아직 안 보낸 게 있으면 알려드립니다.</div>
    <div class="form-row"><label for="set-deadline">기사님 수거 시각</label><input id="set-deadline" value="${esc(s.pickupDeadline || '16:00')}" placeholder="예: 16:00" style="max-width:140px"></div>
    ${notifyOn ? '' : `<div>${btn({ label: '알림 켜기', onclick: 'enableNotify()' })}</div>`}
  </div>`;

  const inquiryCard = `<div class="card">
    <div class="step-title">카페24 문의 수 표시</div>
    <div class="hint">문의 수 표시는 카페24 재연결 후 가능해요. 위 [카페24 연결]을 다시 눌러 게시판 조회 권한을 추가해 주세요.</div>
  </div>`;

  main().innerHTML = header + senderCard + connCard + channelStockCardHtml() + channelMappingCardHtml() + inquiryCard + backupCard + codeCard + notifyCard;
  loadBackups();
  cstkLoadLog();
}

// ---------- 채널 재고 자동 반영 ----------
// db.settings.channelStock = { enabled, cafe24, reserve, autoAfterChange } — 백엔드가 아직 없으면 undefined이니 기본값으로 채운다.
function cstkSettings() {
  return (DB.settings && DB.settings.channelStock) || { enabled: false, cafe24: true, reserve: 0, autoAfterChange: true };
}
// api()는 서버가 꺼졌을 때와 라우트가 아직 없을 때(404, JSON이 아닌 응답) 구분 없이 같은 안내를 준다.
// 이 기능은 백엔드와 같이 만들어지는 중이라 아직 없는 라우트를 "서버가 꺼졌다"고 겁주지 않고 조용히 준비 중으로 안내한다.
function cstkErrorMsg(r) {
  const generic = '프로그램(서버)와 연결이 안 돼요. 검은 창이 꺼졌는지 확인하고, 바탕화면 아이콘으로 다시 켜주세요.';
  return (r && r.error && r.error !== generic) ? r.error : '아직 준비 중이에요. 잠시 후 다시 시도해 주세요.';
}
function channelStockCardHtml() {
  const cs = cstkSettings();
  const scopeMissing = !!DB.channelStockScopeMissing;
  const statusChip = scopeMissing ? chipEl('bad', '권한 필요') : chipEl(cs.enabled ? 'ok' : 'idle', cs.enabled ? '켜짐' : '꺼짐');
  const permBanner = scopeMissing ? banner('bad', '카페24 재연결이 필요해요 (재고 수정 권한). 위 [카페24 연결]을 다시 누르고 다시 동의해 주세요.') : '';
  return `<div class="card">
    <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;margin-bottom:6px">채널 재고 자동 반영 ${statusChip}</div>
    <div class="hint">가용 수량 = 실물 − 아직 안 보낸 주문 − 예비. 실물재고가 바뀌면 카페24 판매가능 수량을 이 값으로 맞춰요.</div>
    ${permBanner}
    <div class="form-row"><label for="cs-reserve">예비 수량 (채널에 내놓지 않을 개수)</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="cs-reserve" type="text" inputmode="numeric" value="${esc(cs.reserve != null ? cs.reserve : 0)}" style="width:6rem" oninput="this.value=this.value.replace(/[^0-9]/g,'')">
        ${btn({ label: '저장', onclick: 'cstkSaveReserve()', kind: 'text', size: 'sm' })}
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0 12px">
      ${btn({ label: '미리보기', onclick: 'cstkPreview()', kind: 'secondary', icon: 'search' })}
      ${btn({ label: '지금 카페24에 반영', onclick: 'cstkPushAll()', kind: 'secondary', icon: 'upload' })}
      ${btn({ label: cs.enabled ? '자동 반영 끄기' : '자동 반영 켜기', onclick: 'cstkToggleEnabled()', kind: 'secondary' })}
    </div>
    <div id="cs-preview"></div>
    <div style="margin-top:16px;padding-top:16px;border-top:1px dashed var(--line)">
      <div class="step-title" style="margin-bottom:8px">최근 반영 기록</div>
      <div id="cs-log" class="hint">불러오는 중…</div>
    </div>
  </div>`;
}
function cstkPreviewRowHtml(row) {
  return `<tr>
    <td>${esc(row.name)}${row.color ? ` <span class="muted">${esc(row.color)}</span>` : ''}${row.size ? ` <b>${esc(row.size)}</b>` : ''}</td>
    <td class="num">${Number(row.physical) || 0}</td>
    <td class="num">${Number(row.reserved) || 0}</td>
    <td class="num">${Number(row.available) || 0}</td>
    <td class="num">${row.cafe24Qty}</td>
    <td class="num"><span class="diff-badge ${row.delta > 0 ? 'pos' : 'neg'}">${row.delta > 0 ? '+' : ''}${row.delta}</span></td>
  </tr>`;
}
async function cstkPreview() {
  const box = document.getElementById('cs-preview');
  if (box) box.innerHTML = '<div class="hint">불러오는 중…</div>';
  const r = await api('/api/channel-stock/preview');
  if (!box) return;
  if (!r || !r.ok) { box.innerHTML = `<div class="hint">${esc(cstkErrorMsg(r))}</div>`; return; }
  const rows = (r.plan && r.plan.rows) || [];
  if (!rows.length) { box.innerHTML = '<div class="hint">지금 반영할 차이가 없어요.</div>'; return; }
  box.innerHTML = `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>상품 · 사이즈</th><th class="num">실물</th><th class="num">주문 대기</th><th class="num">가용</th><th class="num">카페24</th><th class="num">차이</th></tr></thead>
      <tbody>${rows.map(cstkPreviewRowHtml).join('')}</tbody>
    </table></div>
    <div class="hint" style="margin-top:8px">${rows.length}개 옵션이 카페24와 달라요.</div>`;
}
async function cstkPushAll() {
  const r = await api('/api/channel-stock/preview');
  if (!r || !r.ok) { toast(cstkErrorMsg(r), 5000); return; }
  const rows = (r.plan && r.plan.rows) || [];
  if (!rows.length) { toast('지금 반영할 차이가 없어요.'); return; }
  if (!confirm(`카페24 판매가능 수량 ${rows.length}건을 지금 반영할까요?`)) return;
  busy(true, '카페24에 반영하는 중…');
  const pr = await api('/api/channel-stock/push', { method: 'POST', body: JSON.stringify({ all: true, trigger: 'manual' }) });
  busy(false);
  if (!pr || !pr.ok) { toast(cstkErrorMsg(pr), 6000); return; }
  if (pr.db) adoptDb(pr.db);
  const failN = (pr.failed || []).length;
  toast(`카페24에 ${pr.pushed || 0}건 반영했어요.` + (failN ? ` 실패 ${failN}건` : ''), 6000);
  cstkPreview();
  cstkLoadLog();
}
async function cstkToggleEnabled() {
  const cs = cstkSettings();
  const next = !cs.enabled;
  if (next && !confirm('자동 반영을 켤까요?\n앞으로 재고가 바뀔 때마다 카페24 판매가능 수량을 자동으로 맞춰요.')) return;
  const el = document.getElementById('cs-reserve');
  const reserve = el ? Math.max(0, Math.min(99, Math.floor(Number(el.value) || 0))) : (cs.reserve || 0);
  const r = await api('/api/channel-stock/settings', { method: 'POST', body: JSON.stringify({ enabled: next, reserve, autoAfterChange: cs.autoAfterChange !== false }) });
  if (!r || !r.ok) { toast(cstkErrorMsg(r), 6000); return; }
  adoptDb(r.db);
  renderSettings();
  toast(next ? '자동 반영을 켰어요.' : '자동 반영을 껐어요.', 5000);
}
async function cstkSaveReserve() {
  const cs = cstkSettings();
  const el = document.getElementById('cs-reserve');
  const reserve = Math.max(0, Math.min(99, Math.floor(Number(el.value) || 0)));
  const r = await api('/api/channel-stock/settings', { method: 'POST', body: JSON.stringify({ enabled: cs.enabled, reserve, autoAfterChange: cs.autoAfterChange !== false }) });
  if (!r || !r.ok) { toast(cstkErrorMsg(r), 6000); return; }
  adoptDb(r.db);
  renderSettings();
  toast(`예비 수량을 ${reserve}개로 저장했어요.`, 5000);
}
async function cstkLoadLog() {
  const box = document.getElementById('cs-log');
  const r = await api('/api/channel-stock/log?limit=10');
  if (!box) return;
  if (!r || !r.ok) { box.innerHTML = esc(cstkErrorMsg(r)); return; }
  const log = (r.log || []).slice(0, 10);
  if (!log.length) { box.innerHTML = '아직 반영 기록이 없어요.'; return; }
  const rows = log.map(e => `<tr>
      <td class="muted" style="white-space:nowrap">${esc(new Date(e.ts).toLocaleString('ko-KR', { hour12: false }))}</td>
      <td>${esc(e.name || e.sku || '')}</td>
      <td class="c">${e.from ?? '-'} → ${e.to ?? '-'}</td>
      <td class="c">${e.ok ? chipEl('ok', '성공') : chipEl('bad', '실패')}</td>
      <td class="muted">${e.error ? esc(e.error) : '-'}</td>
    </tr>`).join('');
  box.innerHTML = `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>시각</th><th>제품</th><th class="c">변경</th><th class="c">결과</th><th>비고</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// ---------- 판매 채널 엑셀 매핑 ----------
const CHANNEL_OPTIONS = [
  { key: '29cm', label: '29CM' },
  { key: 'musinsa', label: '무신사' },
  { key: 'gsshop', label: 'GS샵' }
];
const CHANNEL_FIELD_LABELS = [
  ['orderNo', '주문번호'], ['lineNo', '품목번호'], ['name', '수령인'], ['phone', '연락처'], ['zip', '우편번호'],
  ['addr', '주소'], ['product', '상품명'], ['option', '옵션'], ['qty', '수량'], ['msg', '배송메시지']
];
// 채널별 헤더 동의어(자동 추천용) — 실제 채널 엑셀 샘플이 아직 없어 스펙의 사전으로 추천하고,
// 사용자가 select에서 최종 확정한다. 새 샘플이 오면 이 사전을 갱신할 것.
const CHANNEL_FIELD_SYNONYMS = {
  '29cm': {
    orderNo: ['주문번호', '주문 번호'], lineNo: ['품목번호', '섹션번호'], name: ['수령인', '수취인', '받는분'],
    phone: ['수령인 연락처', '휴대폰', '연락처'], zip: ['우편번호'], addr: ['주소', '배송지'],
    product: ['상품명', '품목명'], option: ['옵션명', '색상/사이즈', '옵션'], qty: ['수량'],
    msg: ['배송메시지', '배송메모', '요청사항']
  },
  musinsa: {
    orderNo: ['주문번호'], lineNo: ['품목주문번호', '주문상세번호'], name: ['수취인', '수령인'],
    phone: ['휴대폰', '연락처'], zip: ['우편번호'], addr: ['주소'],
    product: ['상품명', '상품'], option: ['옵션정보', '단품명', '옵션'], qty: ['수량'],
    msg: ['배송메시지', '배송요청']
  },
  gsshop: {
    orderNo: ['발주번호', '주문번호'], lineNo: ['상세번호', '주문상세번호', '순번'], name: ['수취인', '수령인', '고객명'],
    phone: ['전화번호', '휴대폰', '연락처'], zip: ['우편번호'], addr: ['주소'],
    product: ['상품명', '상품'], option: ['단품명', '규격', '옵션'], qty: ['수량'],
    msg: ['배송요청', '배송메시지', '메모']
  }
};
function chanGuessField(headers, candidates) {
  for (const c of candidates || []) {
    const hit = headers.find(h => String(h).trim() === c);
    if (hit) return hit;
  }
  for (const c of candidates || []) {
    const hit = headers.find(h => String(h).includes(c));
    if (hit) return hit;
  }
  return '';
}
function chanState() {
  if (!window._chanState) {
    window._chanState = {
      channel: '29cm', headers: [], sample: [], mapping: {},
      invoiceHeaders: '', invoiceOrderCol: '', invoiceLineCol: '', invoiceCourierCol: '', invoiceInvoiceCol: '', courierName: '우체국택배'
    };
    chanLoadSaved(window._chanState.channel);
  }
  return window._chanState;
}
// 저장된 매핑(DB.channelMappings[channel])을 불러와 폼에 미리 채운다
function chanLoadSaved(channel) {
  const st = window._chanState;
  const saved = DB.channelMappings && DB.channelMappings[channel];
  st.mapping = {};
  st.headers = []; st.sample = [];
  st.invoiceHeaders = ''; st.invoiceOrderCol = ''; st.invoiceLineCol = ''; st.invoiceCourierCol = ''; st.invoiceInvoiceCol = ''; st.courierName = '우체국택배';
  if (saved) {
    st.mapping = Object.assign({}, saved.headers || {});
    st.headers = Object.values(st.mapping).filter(Boolean);
    const inv = saved.invoiceTemplate || {};
    st.invoiceHeaders = (inv.headers || []).join(', ');
    st.invoiceOrderCol = inv.orderNoCol || '';
    st.invoiceLineCol = inv.lineNoCol || '';
    st.invoiceCourierCol = inv.courierCol || '';
    st.invoiceInvoiceCol = inv.invoiceCol || '';
    st.courierName = inv.courierName || '우체국택배';
  }
}
function chanSetChannel(channel) {
  chanState(); // 초기화 보장
  window._chanState.channel = channel;
  chanLoadSaved(channel);
  renderSettings();
}
function chanSetField(key, value) { chanState().mapping[key] = value; }
function chanSetInvoiceField(key, value) { chanState()[key] = value; }
function chanPickFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls,.csv';
  input.onchange = () => { if (input.files[0]) chanUploadPreview(input.files[0]); };
  input.click();
}
// 엑셀 열 읽기 — send.js의 uploadFile과 같은 전송 방식(원문 바이트 + X-File-Name 헤더)을 그대로 씀
async function chanUploadPreview(file) {
  if (file.size > 10 * 1024 * 1024) { toast('파일이 너무 커요. 10MB 이하 엑셀 또는 CSV 파일을 골라 주세요.', 7000); return; }
  const st = chanState();
  busy(true, '엑셀 열을 읽는 중…');
  try {
    const buf = await file.arrayBuffer();
    const r = await api('/api/channels/preview?channel=' + encodeURIComponent(st.channel), {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
      body: buf
    });
    busy(false);
    if (!r || r.error || !r.ok) { toast((r && r.error) || '엑셀을 읽지 못했어요.', 7000); return; }
    st.headers = r.headers || [];
    st.sample = r.sample || [];
    const syn = CHANNEL_FIELD_SYNONYMS[st.channel] || {};
    for (const [key] of CHANNEL_FIELD_LABELS) {
      if (st.mapping[key] && st.headers.includes(st.mapping[key])) continue; // 저장된 값이 새 헤더에도 있으면 유지
      st.mapping[key] = chanGuessField(st.headers, syn[key]);
    }
    renderSettings();
    toast(`열 ${st.headers.length}개를 읽었어요. 자동으로 추천했으니 확인하고 저장하세요.`, 6000);
  } catch (e) {
    busy(false);
    toast('파일을 읽지 못했어요: ' + e.message, 7000);
  }
}
async function chanSaveMapping() {
  const st = chanState();
  const missing = CHANNEL_FIELD_LABELS.filter(([k]) => !st.mapping[k]);
  if (missing.length) { toast('아직 안 고른 항목이 있어요: ' + missing.map(([, label]) => label).join(', '), 7000); return; }
  const headers = {};
  for (const [k] of CHANNEL_FIELD_LABELS) headers[k] = st.mapping[k];
  const invHeadersList = st.invoiceHeaders.split(',').map(s => s.trim()).filter(Boolean);
  const invoiceTemplate = {
    headers: invHeadersList,
    orderNoCol: st.invoiceOrderCol.trim(),
    lineNoCol: st.invoiceLineCol.trim(),
    courierCol: st.invoiceCourierCol.trim(),
    invoiceCol: st.invoiceInvoiceCol.trim(),
    courierName: st.courierName.trim() || '우체국택배'
  };
  const r = await api('/api/channels/mapping', { method: 'POST', body: JSON.stringify({ channel: st.channel, headers, invoiceTemplate }) });
  if (r.error && !r.ok) { toast(r.error, 6000); return; }
  adoptDb(r.db);
  renderSettings();
  toast('채널 매핑을 저장했어요.', 5000);
}
function chanFieldSelect(id, headers, value, onchange) {
  const list = [...headers];
  if (value && !list.includes(value)) list.unshift(value);
  const opts = ['<option value="">선택 안 함</option>']
    .concat(list.map(h => `<option value="${esc(h)}"${h === value ? ' selected' : ''}>${esc(h)}</option>`));
  return `<select id="${id}" onchange="${onchange}" style="font-size:1rem;padding:0.45rem;border:2px solid var(--line);border-radius:8px;max-width:100%">${opts.join('')}</select>`;
}
function channelMappingCardHtml() {
  const st = chanState();
  const hasHeaders = st.headers.length > 0;
  const chanSelect = `<select id="chan-select" onchange="chanSetChannel(this.value)" style="font-size:1rem;padding:0.45rem;border:2px solid var(--line);border-radius:8px">
    ${CHANNEL_OPTIONS.map(c => `<option value="${c.key}"${c.key === st.channel ? ' selected' : ''}>${c.label}</option>`).join('')}
  </select>`;
  const fieldRows = CHANNEL_FIELD_LABELS.map(([key, label]) => `
    <div class="form-row"><label>${esc(label)}</label>${chanFieldSelect('chan-f-' + key, st.headers, st.mapping[key] || '', `chanSetField('${key}',this.value)`)}</div>`
  ).join('');
  const hasAnyMapping = CHANNEL_FIELD_LABELS.some(([k]) => st.mapping[k]);
  return `<div class="card">
    <div class="step-title">판매 채널 엑셀 매핑</div>
    <div class="hint">채널마다 엑셀 열 이름이 달라요. 파일을 한 번 읽어서 어느 열이 무엇인지 확인하고 저장해 두면 다음부터 자동으로 맞춰 읽어요.</div>
    <div class="form-row"><label>채널</label>${chanSelect}</div>
    <div style="margin-bottom:12px;display:flex;align-items:center;gap:10px">
      ${btn({ label: '엑셀 열 읽기', onclick: 'chanPickFile()', icon: 'upload' })}
      ${hasHeaders ? `<span class="muted">열 ${st.headers.length}개 확인함</span>` : ''}
    </div>
    ${hasHeaders || hasAnyMapping ? fieldRows : `<div class="hint">엑셀 열 읽기를 먼저 눌러 주세요. 파일을 읽으면 필수 항목 10개를 자동으로 추천해요.</div>`}
    <div style="margin:16px 0 0;padding-top:16px;border-top:1px dashed var(--line)">
      <div class="step-title" style="margin-bottom:8px">송장 등록 템플릿</div>
      <div class="hint">채널에 다시 올릴 송장 엑셀의 열 구성이에요. 헤더는 쉼표로 구분해 적어 주세요.</div>
      <div class="form-row"><label>헤더 목록</label><input id="chan-inv-headers" value="${esc(st.invoiceHeaders)}" placeholder="예: 주문번호, 품목번호, 택배사, 송장번호" oninput="chanSetInvoiceField('invoiceHeaders',this.value)"></div>
      <div class="form-row"><label>주문번호 열</label><input id="chan-inv-order" value="${esc(st.invoiceOrderCol)}" oninput="chanSetInvoiceField('invoiceOrderCol',this.value)"></div>
      <div class="form-row"><label>품목 열</label><input id="chan-inv-line" value="${esc(st.invoiceLineCol)}" oninput="chanSetInvoiceField('invoiceLineCol',this.value)"></div>
      <div class="form-row"><label>택배사 열</label><input id="chan-inv-courier" value="${esc(st.invoiceCourierCol)}" oninput="chanSetInvoiceField('invoiceCourierCol',this.value)"></div>
      <div class="form-row"><label>송장 열</label><input id="chan-inv-invoice" value="${esc(st.invoiceInvoiceCol)}" oninput="chanSetInvoiceField('invoiceInvoiceCol',this.value)"></div>
      <div class="form-row"><label>택배사 표기명</label><input id="chan-inv-courier-name" value="${esc(st.courierName)}" oninput="chanSetInvoiceField('courierName',this.value)"></div>
    </div>
    <div style="margin-top:8px">${btn({ label: '매핑 저장', onclick: 'chanSaveMapping()', kind: 'secondary', icon: 'check' })}</div>
  </div>`;
}

async function loadBackups() {
  const r = await api('/api/backup/list');
  const box = document.getElementById('backup-list');
  if (!box) return;
  if (r.error || !r.files) { box.textContent = '백업 목록을 못 불러왔어요.'; return; }
  if (!r.files.length) { box.textContent = '아직 백업이 없어요. 내일부터 자동으로 쌓여요.'; return; }
  const dateBtns = r.files.slice(0, 7).map(f =>
    btn({ label: esc(f.date), onclick: `restoreBackup('${jsq(f.file)}','${jsq(f.date)}')`, kind: 'danger', size: 'sm' })
  ).join(' ');
  box.innerHTML = `<div style="margin-bottom:8px">최근 백업 — 날짜를 누르면 그 시점으로 되돌려요</div>
    <div style="display:flex; gap:6px; flex-wrap:wrap">${dateBtns}</div>
    <div class="muted" style="font-size:0.9rem;margin-top:8px">총 ${r.files.length}개 보관 중</div>`;
}
async function restoreBackup(file, date) {
  if (!confirm(`정말 ${date} 시점의 장부로 되돌릴까요?\n\n· 그 이후에 한 모든 작업(접수·재고 변경 등)이 화면에서 사라져요\n· 되돌리기 직전 상태도 백업 폴더에 따로 저장돼요\n· 되돌린 뒤엔 [우체국 접수]에서 [진행상태 새로고침]을 꼭 눌러 주세요`)) return;
  busy(true, '되돌리는 중…');
  const r = await api('/api/backup/restore', { method: 'POST', body: JSON.stringify({ file }) });
  busy(false);
  if (r.error) { toast(r.error, 7000); return; }
  adoptDb(r.db);
  render();
  toast(`${date} 시점으로 되돌렸어요. [우체국 접수]에서 진행상태를 새로고침해 주세요.`, 10000);
}
async function saveSettings() {
  const s = DB.settings;
  s.senderName = $('#set-name').value.trim();
  s.senderPhone = $('#set-phone').value.trim();
  s.senderZip = $('#set-zip').value.trim();
  s.senderAddr = $('#set-addr').value.trim();
  s.defaultContent = $('#set-content').value.trim() || '의류';
  if ($('#set-sheetid')) s.sheetId = $('#set-sheetid').value.trim();
  if ($('#set-c24mall')) {
    s.cafe24MallId = $('#set-c24mall').value.trim();
    s.cafe24ClientId = $('#set-c24id').value.trim();
    s.cafe24ClientSecret = $('#set-c24secret').value.trim();
  }
  if ($('#set-whurl')) {
    s.sheetWebhookUrl = $('#set-whurl').value.trim();
    s.sheetWebhookToken = $('#set-whtoken').value.trim();
  }
  if ($('#set-epkey')) {
    s.epostApiKey = $('#set-epkey').value.trim();
    s.epostSecKey = $('#set-epsec').value.trim();
    s.epostMemberId = $('#set-epid').value.trim() || 'allincrew';
  }
  if ($('#set-kakao')) s.kakaoRestKey = $('#set-kakao').value.trim();
  if ($('#set-deadline')) {
    const v = $('#set-deadline').value.trim();
    if (/^\d{1,2}:\d{2}$/.test(v)) s.pickupDeadline = v;
  }
  await saveDb();
  toast('설정을 저장했어요.');
}
async function cafe24Connect() {
  await saveSettings();
  const r = await api('/api/cafe24/authurl');
  if (r.error) { toast(r.error, 6000); return; }
  window.open(r.url, '_blank');
  toast('카페24 로그인 창이 열렸어요. 로그인하고 [동의]를 눌러 주세요.', 6000);
}
async function cafe24PasteCode() {
  const v = $('#set-c24code').value.trim();
  if (!v) { toast('주소를 먼저 붙여넣어 주세요.'); return; }
  busy(true, '카페24와 연결하는 중…');
  const r = await api('/api/cafe24/code', { method: 'POST', body: JSON.stringify({ code: v }) });
  busy(false);
  if (r.error) { toast(r.error, 7000); return; }
  toast('카페24 연결을 완료했어요.', 5000);
  await refreshStatus(true);
  renderSettings();
}
async function cafe24Disconnect() {
  if (!confirm('카페24 연결을 끊을까요?')) return;
  await api('/api/cafe24/disconnect', { method: 'POST' });
  await refreshStatus(true);
  renderSettings();
  toast('연결을 끊었어요.');
}


async function epostConnect() {
  await saveSettings();
  busy(true, '우체국과 연결하는 중…');
  const r = await api('/api/epost/connect', { method: 'POST' });
  busy(false);
  const box = $('#epost-result');
  if (r.error) { if (box) box.innerHTML = banner('bad', esc(r.error)); return; }
  adoptDb(r.db);
  await refreshStatus(true);
  renderSettings();
  toast('우체국 연결을 완료했어요.', 5000);
}

async function epostTest() {
  busy(true, '테스트 접수 중… (실제 접수 아님)');
  const r = await api('/api/epost/test', { method: 'POST' });
  busy(false);
  const box = $('#epost-result');
  if (r.error) { if (box) box.innerHTML = banner('bad', esc(r.error)); return; }
  if (box) box.innerHTML = r.result && r.result.regiNo === 'TESTREGINOAPI'
    ? banner('ok', '<b>연결이 잘 돼 있어요.</b> 실제 접수는 되지 않았습니다.')
    : banner('warn', `응답이 평소와 달라요: ${esc((r.result && r.result.regiNo) || '없음')}<br><span style="font-weight:400">계속 이러면 [우체국 연결]을 다시 눌러 주세요.</span>`);
}
