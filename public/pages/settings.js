
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

  main().innerHTML = header + senderCard + connCard + backupCard + codeCard + notifyCard;
  loadBackups();
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
