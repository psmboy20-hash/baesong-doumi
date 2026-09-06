
// ---------- 설정 ----------
async function changeAccessCode() {
  const current = $('#set-code-cur').value.trim();
  const next = $('#set-code-new').value.trim();
  if (!next) { toast('새 코드를 적어 주세요.'); return; }
  if (!confirm(`접속 코드를 '${next}'(으)로 바꿀까요?\n\n· 다른 컴퓨터·폰은 새 코드를 한 번 다시 입력해야 해요\n· allin_v4 같은 외부 연동도 새 코드로 바꿔야 해요`)) return;
  const r = await api('/api/access-code', { method: 'POST', body: JSON.stringify({ current, next }) });
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  toast('✔️ 접속 코드를 바꿨어요. 이 컴퓨터는 그대로 쓸 수 있어요.', 6000);
  renderSettings();
}
function renderSettings() {
  const s = DB.settings;
  const c24 = SYNC_STATUS && SYNC_STATUS.cafe24;
  const connected = c24 && c24.connected;
  main().innerHTML = `
    <h1>⚙️ 설정</h1>
    <div class="sub">택배를 보낼 때 쓰는 <b>보내는 분(우리 가게)</b> 정보와 연결 관리예요. 한 번만 해두면 돼요.</div>
    <div class="card">
      <div class="form-row"><label>보내는 분 이름 (가게 이름)</label><input id="set-name" value="${esc(s.senderName)}"></div>
      <div class="form-row"><label>보내는 분 전화번호</label><input id="set-phone" value="${esc(s.senderPhone)}" placeholder="예: 010-1234-5678"></div>
      <div class="form-row"><label>보내는 분 우편번호</label><input id="set-zip" value="${esc(s.senderZip)}" placeholder="예: 07997"></div>
      <div class="form-row"><label>보내는 분 주소</label><input id="set-addr" value="${esc(s.senderAddr)}" placeholder="예: 서울 양천구 목동로 000"></div>
      <div class="form-row"><label>내용품명 (기본값)</label><input id="set-content" value="${esc(s.defaultContent)}"></div>
      <div class="form-row"><label>시딩 구글시트 주소</label><input id="set-sheetid" value="${esc(s.sheetId)}" placeholder="구글시트 링크를 통째로 붙여넣으세요"></div>
      <button class="big-btn green" onclick="saveSettings()">✔️ 저장</button>
    </div>
    <div class="card">
      <div class="step-title">🛒 카페24 자동 연동 ${connected ? '<span class="chip done">연결됨 ✓</span>' : '<span class="chip wait">연결 안 됨</span>'}</div>
      <div class="hint">
        카페24 주문을 자동으로 가져오려면 처음 한 번 연결이 필요해요.<br>
        <a class="track-link" target="_blank" href="https://developers.cafe24.com">카페24 개발자센터</a>의 앱에서 아래 값을 확인해 넣어 주세요. (권한: <b>주문 조회</b>)
      </div>
      <div class="form-row"><label>쇼핑몰 아이디 (mall id)</label><input id="set-c24mall" value="${esc(s.cafe24MallId)}" placeholder="예: nusolvere"></div>
      <div class="form-row"><label>Client ID</label><input id="set-c24id" value="${esc(s.cafe24ClientId)}"></div>
      <div class="form-row"><label>Client Secret</label><input id="set-c24secret" type="password" value="${esc(s.cafe24ClientSecret)}"></div>
      <div style="display:flex; gap:0.8rem; flex-wrap:wrap">
        <button class="big-btn green" onclick="saveSettings()">✔️ 저장</button>
        <button class="big-btn" onclick="cafe24Connect()">🔗 카페24 연결하기</button>
        ${connected ? '<button class="big-btn gray" onclick="cafe24Disconnect()">연결 끊기</button>' : ''}
      </div>
      <div class="card" style="margin-top:1rem; background:#eef4fd">
        <div class="hint" style="margin-bottom:0.6rem">
          <b>연결 순서:</b> [카페24 연결하기] → 카페24 로그인 → [동의] →
          쇼핑몰 홈으로 이동되면 <b>주소창의 주소 전체를 복사</b> → 아래에 붙여넣고 [연결 완료] 누르기
        </div>
        <div class="form-row"><input id="set-c24code" placeholder="이동된 페이지의 주소를 여기에 붙여넣으세요 (code=... 가 들어있는 주소)"></div>
        <button class="big-btn green" onclick="cafe24PasteCode()">✅ 연결 완료</button>
      </div>
      ${c24 && c24.ok === false ? `<div class="result-box err" style="margin-top:1rem">⚠️ ${esc(c24.error || '')}</div>` : ''}
    </div>
    <div class="card">
      <div class="step-title">📮 우체국 바로 접수 (OpenAPI) ${SYNC_STATUS && SYNC_STATUS.epost && SYNC_STATUS.epost.connected ? '<span class="chip done">연결됨 ✓</span>' : '<span class="chip wait">연결 안 됨</span>'}</div>
      <div class="hint">
        연결하면 엑셀 업로드 없이 <b>[보내기]에서 버튼 한 번으로 우체국 접수 + 송장번호 자동 발급</b>이 됩니다.<br>
        계약고객시스템 → 고객센터 → 오픈API신청결과 화면의 <b>인증키</b>와 <b>접수용 보안키</b>를 붙여넣으세요.
      </div>
      <div class="form-row"><label>인증키</label><input id="set-epkey" value="${esc(s.epostApiKey)}"></div>
      <div class="form-row"><label>접수용 보안키</label><input id="set-epsec" type="password" value="${esc(s.epostSecKey)}"></div>
      <div class="form-row"><label>인터넷우체국 아이디</label><input id="set-epid" value="${esc(s.epostMemberId)}"></div>
      <div style="display:flex; gap:0.8rem; flex-wrap:wrap">
        <button class="big-btn green" onclick="saveSettings()">✔️ 저장</button>
        <button class="big-btn" onclick="epostConnect()">🔗 우체국 연결</button>
        ${SYNC_STATUS && SYNC_STATUS.epost && SYNC_STATUS.epost.connected ? '<button class="big-btn orange" onclick="epostTest()">🧪 테스트 접수 해보기</button>' : ''}
      </div>
      ${DB.epost ? `<div class="hint" style="margin-top:0.8rem">고객번호 ${esc(DB.epost.custNo)} · 계약승인번호 ${esc(DB.epost.apprNo)} · 공급지 ${esc(DB.epost.officeNm || DB.epost.officeSer)}</div>` : ''}
      <div id="epost-result"></div>
    </div>
    <div class="card">
      <div class="step-title">🔐 접속 코드</div>
      <div class="hint">다른 컴퓨터·폰에서 처음 들어올 때 묻는 코드예요. 새어나갔다 싶으면 여기서 바꾸세요. (바꾸면 다른 기기들은 새 코드를 한 번 다시 입력해야 해요)</div>
      <div class="form-row"><label>지금 코드</label><input id="set-code-cur" type="password" autocomplete="off" placeholder="현재 접속 코드"></div>
      <div class="form-row"><label>새 코드 (4~10자리 숫자·영문)</label><input id="set-code-new" autocomplete="off" placeholder="예: 731205"></div>
      <button class="big-btn" onclick="changeAccessCode()">🔐 코드 바꾸기</button>
    </div>
    <div class="card">
      <div class="step-title">📝 구글시트 송장 자동 기록 ${s.sheetWebhookUrl ? '<span class="chip done">켜짐 ✓</span>' : '<span class="chip wait">꺼짐</span>'}</div>
      <div class="hint">
        송장을 붙일 때 <b>시딩 구글시트의 송장번호 칸에도 자동으로</b> 적어줍니다.<br>
        구글시트에 스크립트를 한 번 설치해야 해요 — 방법은 프로젝트 폴더의 <b>구글시트-자동기록-설치법.md</b> 참고.
      </div>
      <div class="form-row"><label>웹 앱 주소 (스크립트 배포 후 받은 URL)</label><input id="set-whurl" value="${esc(s.sheetWebhookUrl)}" placeholder="https://script.google.com/macros/s/..../exec"></div>
      <div class="form-row"><label>비밀 암호 (스크립트에 적은 것과 같게, 비워도 됨)</label><input id="set-whtoken" value="${esc(s.sheetWebhookToken)}" placeholder="비워두면 암호 검사 안 함"></div>
      <button class="big-btn green" onclick="saveSettings()">✔️ 저장</button>
    </div>
    <div class="card">
      <div class="step-title">🔔 알림 ${'Notification' in window && Notification.permission === 'granted' ? '<span class="chip done">켜짐 ✓</span>' : '<span class="chip wait">꺼짐</span>'}</div>
      <div class="hint">창을 안 보고 있어도 <b>새 주문·교환반품이 오면 컴퓨터 알림</b>으로 알려줘요.<br>그리고 기사님 오시기 <b>1시간 전</b>에 아직 안 보낸 게 있으면 알려드립니다.</div>
      <div class="form-row"><label>기사님 수거 시각</label><input id="set-deadline" value="${esc(s.pickupDeadline || '16:00')}" placeholder="예: 16:00" style="max-width:140px"></div>
      <div style="display:flex; gap:0.8rem; flex-wrap:wrap">
        <button class="big-btn green" onclick="saveSettings()">✔️ 저장</button>
        ${'Notification' in window && Notification.permission === 'granted' ? '' : '<button class="big-btn" onclick="enableNotify()">🔔 알림 켜기</button>'}
      </div>
    </div>
    <div class="card">
      <div class="step-title">📮 주소 → 우편번호 자동 변환 <span class="chip ${s.kakaoRestKey ? 'done' : 'wait'}">${s.kakaoRestKey ? '켜짐 ✓' : '꺼짐 (선택)'}</span></div>
      <div class="hint">시딩 신청에 우편번호가 없으면 접수가 안 돼요. 이걸 켜면 <b>주소만으로 우편번호를 자동으로</b> 찾아줍니다.<br>
      <a class="track-link" target="_blank" href="https://developers.kakao.com">카카오 개발자 사이트</a>에서 무료로 <b>REST API 키</b>를 받아 붙여넣으세요. (없어도 목록에서 직접 5자리를 넣을 수 있어요)</div>
      <div class="form-row"><label>카카오 REST API 키</label><input id="set-kakao" value="${esc(s.kakaoRestKey || '')}" placeholder="카카오에서 받은 긴 영문+숫자 키"></div>
      <button class="big-btn green" onclick="saveSettings()">✔️ 저장</button>
    </div>
    <div class="card">
      <div class="step-title">💾 자동 백업</div>
      <div class="hint">장부(주문·시딩·재고·기록 전부)를 <b>하루에 한 번 자동으로</b> 복사해 30일치 보관해요.<br>뭔가 크게 잘못됐을 때 예전 날짜로 되돌릴 수 있어요.</div>
      <div style="display:flex; gap:0.8rem; flex-wrap:wrap; margin-bottom:0.8rem">
        <button class="big-btn gray" onclick="api('/api/backup/open',{method:'POST'})">📂 백업 폴더 열기</button>
      </div>
      <div id="backup-list" class="hint">백업 목록을 불러오는 중…</div>
    </div>`;
  loadBackups();
}
async function loadBackups() {
  const r = await api('/api/backup/list');
  const box = document.getElementById('backup-list');
  if (!box) return;
  if (r.error || !r.files) { box.textContent = '백업 목록을 못 불러왔어요.'; return; }
  if (!r.files.length) { box.textContent = '아직 백업이 없어요. 내일부터 자동으로 쌓여요.'; return; }
  box.innerHTML = '최근 백업: ' + r.files.slice(0, 7).map(f =>
    `<button class="link-btn" onclick="restoreBackup('${f.file}','${f.date}')">${f.date}</button>`).join(' · ') +
    `<div class="muted" style="font-size:0.9rem;margin-top:0.4rem">날짜를 누르면 그 시점으로 되돌려요 (총 ${r.files.length}개 보관 중)</div>`;
}
async function restoreBackup(file, date) {
  if (!confirm(`정말 ${date} 시점의 장부로 되돌릴까요?\n\n· 그 이후에 한 모든 작업(접수·재고 변경 등)이 화면에서 사라져요\n· 되돌리기 직전 상태도 백업 폴더에 따로 저장돼요\n· 되돌린 뒤엔 [📦 우체국 접수]에서 [🔄 진행상태 새로고침]을 꼭 눌러 주세요`)) return;
  busy(true, '되돌리는 중…');
  const r = await api('/api/backup/restore', { method: 'POST', body: JSON.stringify({ file }) });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 7000); return; }
  adoptDb(r.db);
  render();
  toast(`✔️ ${date} 시점으로 되돌렸어요. [📦 우체국 접수]에서 진행상태를 새로고침해 주세요.`, 10000);
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
  toast('저장했어요! ✔️');
}
async function cafe24Connect() {
  await saveSettings();
  const r = await api('/api/cafe24/authurl');
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  window.open(r.url, '_blank');
  toast('카페24 로그인 창이 열렸어요. 로그인하고 [동의]를 눌러 주세요.', 6000);
}
async function cafe24PasteCode() {
  const v = $('#set-c24code').value.trim();
  if (!v) { toast('주소를 먼저 붙여넣어 주세요.'); return; }
  busy(true, '카페24와 연결하는 중…');
  const r = await api('/api/cafe24/code', { method: 'POST', body: JSON.stringify({ code: v }) });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 7000); return; }
  toast('✅ 카페24 연결 완료!', 5000);
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
  if (r.error) { if (box) box.innerHTML = `<div class="result-box err">⚠️ ${esc(r.error)}</div>`; return; }
  adoptDb(r.db);
  await refreshStatus(true);
  renderSettings();
  toast('✅ 우체국 연결 완료!', 5000);
}

async function epostTest() {
  busy(true, '테스트 접수 중… (실제 접수 아님)');
  const r = await api('/api/epost/test', { method: 'POST' });
  busy(false);
  const box = $('#epost-result');
  if (r.error) { if (box) box.innerHTML = `<div class="result-box err">⚠️ ${esc(r.error)}</div>`; return; }
  if (box) box.innerHTML = r.result && r.result.regiNo === 'TESTREGINOAPI'
    ? `<div class="result-box ok">🧪 <b>연결이 잘 돼 있어요!</b> (실제 접수는 되지 않았습니다)</div>`
    : `<div class="result-box warn">🧪 응답이 평소와 달라요: ${esc((r.result && r.result.regiNo) || '없음')}<br><span style="font-weight:400">계속 이러면 [🔗 우체국 연결]을 다시 눌러 주세요.</span></div>`;
}
