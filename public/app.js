/* 배송 도우미 - 화면 로직 */
let DB = null;
let PAGE = 'home';
let SYNC_STATUS = null;
const $ = sel => document.querySelector(sel);
const main = () => $('#main');

// ---------- 공통 ----------
function toast(msg, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms || 3500);
}
function busy(on, msg) {
  $('#overlay').classList.toggle('hidden', !on);
  if (msg) $('#overlay-msg').textContent = msg;
}
async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}
async function saveDb() {
  const r = await api('/api/db', { method: 'POST', body: JSON.stringify(DB) });
  if (r && r.rev != null) DB.rev = r.rev;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function chip(status) {
  const map = { '대기': ['wait', '보낼 준비'], '접수중': ['processing', '우체국 접수중'], '발송완료': ['done', '보냄 ✓'] };
  const [cls, label] = map[status] || ['wait', status];
  return `<span class="chip ${cls}">${label}</span>`;
}
function trackLink(inv) {
  if (!inv) return '';
  const digits = String(inv).replace(/\D/g, '');
  if (digits.length === 13) {
    return `<a class="track-link" target="_blank" href="https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${digits}">${esc(inv)}</a>`;
  }
  return esc(inv);
}
function go(page) {
  PAGE = page;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  render();
  window.scrollTo(0, 0);
}
function pendingOf(list) { return list.filter(x => x.status === '대기'); }
function processingOf(list) { return list.filter(x => x.status === '접수중'); }

// ---------- 페이지 렌더 ----------
function render() {
  if (!DB) return;
  if (PAGE === 'home') renderHome();
  else if (PAGE === 'seeding') renderList('seeding');
  else if (PAGE === 'orders') renderList('orders');
  else if (PAGE === 'shipping') renderShipping();
  else if (PAGE === 'inventory') renderInventory();
  else if (PAGE === 'settings') renderSettings();
}

// ---------- 홈 ----------
function renderHome() {
  const so = pendingOf(DB.orders).length + processingOf(DB.orders).length;
  const ss = pendingOf(DB.seeding).length + processingOf(DB.seeding).length;
  main().innerHTML = `
    <h1>안녕하세요! 👋</h1>
    <div class="sub">아래에서 하실 일을 눌러 주세요.</div>
    <div class="home-grid">
      <div class="home-card" onclick="go('orders')">
        <div class="icon">🛒</div>
        <div class="name">주문 보내기</div>
        <div class="desc">카페24 주문을 우체국으로<br>보낼 준비를 해요</div>
        <div class="badge ${so ? '' : 'zero'}">${so ? '보낼 것 ' + so + '건' : '보낼 것 없음'}</div>
      </div>
      <div class="home-card" onclick="go('seeding')">
        <div class="icon">🎁</div>
        <div class="name">시딩 보내기</div>
        <div class="desc">인플루언서 선물을 우체국으로<br>보낼 준비를 해요</div>
        <div class="badge ${ss ? '' : 'zero'}">${ss ? '보낼 것 ' + ss + '건' : '보낼 것 없음'}</div>
      </div>
      <div class="home-card" onclick="go('shipping')">
        <div class="icon">🚚</div>
        <div class="name">배송 확인</div>
        <div class="desc">보낸 물건이 잘 가고 있는지<br>확인해요</div>
      </div>
      <div class="home-card" onclick="go('inventory')">
        <div class="icon">📋</div>
        <div class="name">재고</div>
        <div class="desc">남은 옷 개수를<br>적어두고 확인해요</div>
      </div>
    </div>
    <div class="card" style="margin-top:1.5rem">
      <div class="step-title">💡 보내는 순서</div>
      <div class="hint" style="font-size:1.1rem">
        ① <b>불러오기</b> — 주문/시딩 목록을 가져와요<br>
        ② <b>우체국 엑셀 만들기</b> — 버튼 한 번이면 끝!<br>
        ③ 만들어진 파일을 <b>우체국 프로그램(오즈뷰어)</b>에서 불러와 송장을 뽑아요<br>
        ④ 우체국에서 받은 <b>송장 엑셀</b>을 이 프로그램에 끌어다 놓으면 자동으로 정리돼요
      </div>
    </div>`;
}

// ---------- 주문/시딩 목록 ----------
function renderList(kind) {
  const isSeed = kind === 'seeding';
  const list = isSeed ? DB.seeding : DB.orders;
  const pending = list.filter(x => x.status !== '발송완료');
  const title = isSeed ? '🎁 시딩 보내기' : '🛒 주문 보내기';
  const c24 = SYNC_STATUS && SYNC_STATUS.cafe24;
  const c24line = !c24 || !c24.configured
    ? '⚪ 카페24 자동 연동이 아직 설정되지 않았어요. <button class="link-btn" onclick="go(\'settings\')">설정하러 가기</button>'
    : !c24.connected
      ? '🟡 카페24 연결이 필요해요. <button class="link-btn" onclick="go(\'settings\')">설정에서 연결하기</button>'
      : c24.ok === false
        ? '🔴 카페24에서 가져오기 실패: ' + esc(c24.error || '')
        : '🟢 카페24 자동 연동 중 — 새 주문이 <b>5분마다 자동으로</b> 들어와요.';
  const loadCard = isSeed ? `
    <div class="card">
      <div class="step-title"><span class="step-num">1</span> 새 신청 확인</div>
      <div class="hint">구글시트(설문지 응답)는 <b>5분마다 자동으로</b> 확인해요. 방금 들어온 걸 바로 보고 싶으면 아래 버튼을 누르세요.</div>
      <button class="big-btn" onclick="doSync()">🔄 지금 바로 확인하기</button>
    </div>` : `
    <div class="card">
      <div class="step-title"><span class="step-num">1</span> 주문 확인</div>
      <div class="hint">${c24line}</div>
      <button class="big-btn" onclick="doSync()">🔄 지금 바로 확인하기</button>
      <details style="margin-top:1rem">
        <summary style="font-size:1rem;cursor:pointer;color:#5a6478">엑셀 파일로 직접 넣기 (자동 연동이 안 될 때)</summary>
        <div class="dropzone" id="dz-cafe24" onclick="pickFile('cafe24')" style="margin-top:0.8rem">
          📂 여기에 카페24 주문 엑셀 파일을 끌어다 놓으세요
          <span class="small">또는 이 상자를 눌러서 파일을 선택하세요</span>
        </div>
      </details>
    </div>`;

  const rows = pending.map(x => `
    <tr class="${x._sel !== false ? 'checked-row' : ''}">
      <td><input type="checkbox" ${x._sel !== false ? 'checked' : ''} onchange="toggleSel('${kind}',${x.id},this.checked)"></td>
      <td><b>${esc(x.name)}</b>${isSeed && x.insta ? `<br><span class="muted" style="font-size:0.85rem">${esc(x.insta)}</span>` : ''}</td>
      <td>${esc(x.phone)}</td>
      <td style="max-width:280px">${esc(x.addr)}</td>
      <td style="max-width:260px">${esc(x.product)}${x.size ? ' <b>(' + esc(x.size) + ')</b>' : ''}${x.color ? ' ' + esc(x.color) : ''}</td>
      <td>${chip(x.status)}</td>
    </tr>`).join('');

  main().innerHTML = `
    <h1>${title}</h1>
    <div class="sub">${isSeed ? '인플루언서에게 보낼 선물을 준비해요.' : '카페24 주문을 우체국으로 보낼 준비를 해요.'}</div>
    ${loadCard}
    <div class="card">
      <div class="step-title"><span class="step-num">2</span> 우체국 엑셀 만들기</div>
      ${pending.length ? `
      <div class="hint">보낼 사람 목록이에요. 빼고 싶은 사람은 체크를 풀면 돼요.</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>보내기</th><th>이름</th><th>연락처</th><th>주소</th><th>제품</th><th>상태</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:1rem">
        <button class="big-btn green" onclick="doExport('${kind}')">📄 선택한 사람들 우체국 엑셀 만들기</button>
      </div>
      <div id="export-result"></div>` : `
      <div class="hint" style="font-size:1.1rem">지금은 보낼 것이 없어요. 위의 <b>1번</b>에서 먼저 불러와 주세요. 😊</div>`}
    </div>
    <div class="card">
      <div class="step-title"><span class="step-num">3</span> 송장번호 붙이기</div>
      <div class="hint">우체국 프로그램에서 접수가 끝나면 <b>송장번호가 적힌 엑셀</b>을 받을 수 있어요.<br>그 파일을 아래 상자에 끌어다 놓으면 자동으로 짝을 맞춰 정리해요.</div>
      <div class="dropzone" id="dz-invoice" onclick="pickFile('invoice')">
        📥 여기에 우체국 송장 엑셀을 끌어다 놓으세요
        <span class="small">또는 이 상자를 눌러서 파일을 선택하세요</span>
      </div>
      <div id="invoice-result"></div>
    </div>`;
  setupDropzones();
}

function toggleSel(kind, id, checked) {
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const item = list.find(x => x.id === id);
  if (item) item._sel = checked;
  render();
}

// ---------- 배송 확인 ----------
function renderShipping() {
  const all = [
    ...DB.orders.map(x => Object.assign({ _kind: '주문' }, x)),
    ...DB.seeding.map(x => Object.assign({ _kind: '시딩' }, x))
  ].sort((a, b) => (b.sentDate || b.regDate || '').localeCompare(a.sentDate || a.regDate || ''));
  const q = (window._shipQ || '').trim();
  const filtered = q ? all.filter(x => (x.name + x.phone + (x.invoice || '') + (x.product || '')).includes(q)) : all;
  const rows = filtered.slice(0, 200).map(x => `
    <tr>
      <td>${x._kind === '주문' ? '🛒' : '🎁'} ${x._kind}</td>
      <td><b>${esc(x.name)}</b></td>
      <td style="max-width:240px">${esc(x.product)}</td>
      <td>${chip(x.status)}</td>
      <td>${x.invoice ? trackLink(x.invoice) : '<span class="muted">아직 없음</span>'}</td>
      <td>${esc(x.sentDate || '')}</td>
    </tr>`).join('');
  main().innerHTML = `
    <h1>🚚 배송 확인</h1>
    <div class="sub">보낸 물건들을 확인해요. <b>파란 송장번호를 누르면</b> 지금 어디까지 갔는지 볼 수 있어요.</div>
    <input class="search-input" placeholder="🔍 이름이나 송장번호로 찾기" value="${esc(q)}"
      oninput="window._shipQ=this.value; renderShipping(); this.focus(); this.setSelectionRange(this.value.length,this.value.length)">
    <div class="card">
      <div class="table-wrap" style="max-height:70vh">
        <table>
          <thead><tr><th>구분</th><th>이름</th><th>제품</th><th>상태</th><th>송장번호</th><th>보낸 날</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="muted">아직 내역이 없어요.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="step-title">📥 송장번호 붙이기</div>
      <div class="hint">우체국에서 받은 송장 엑셀을 여기에 끌어다 놓아도 돼요.</div>
      <div class="dropzone" id="dz-invoice" onclick="pickFile('invoice')">📥 여기에 송장 엑셀을 끌어다 놓으세요</div>
      <div id="invoice-result"></div>
    </div>`;
  setupDropzones();
}

// ---------- 재고 ----------
function renderInventory() {
  const q = (window._invQ || '').trim();
  const items = q ? DB.inventory.filter(i => (i.name + ' ' + (i.color || '') + ' ' + (i.size || '')).includes(q)) : DB.inventory;
  const cards = items.map(i => `
    <div class="inv-card">
      <div class="info">
        <div class="pname">${esc(i.name)}</div>
        <div class="popt">${esc([i.color, i.size].filter(Boolean).join(' / ') || ' ')}</div>
      </div>
      <button class="qty-btn" onclick="invAdj(${i.id},-1)">−</button>
      <div class="qty ${i.qty <= 2 ? 'low' : ''}">${i.qty}</div>
      <button class="qty-btn" onclick="invAdj(${i.id},1)">＋</button>
      <button class="del-btn" title="지우기" onclick="invDel(${i.id})">🗑️</button>
    </div>`).join('');
  main().innerHTML = `
    <h1>📋 재고</h1>
    <div class="sub">남은 옷 개수예요. 옷을 보내면 <b>−</b>, 새로 들어오면 <b>＋</b>를 눌러요. <span style="color:var(--red)">빨간 숫자</span>는 2개 이하!</div>
    <input class="search-input" placeholder="🔍 제품 이름으로 찾기" value="${esc(q)}"
      oninput="window._invQ=this.value; renderInventory(); this.focus(); this.setSelectionRange(this.value.length,this.value.length)">
    <div style="margin-bottom:1rem">
      <button class="big-btn" onclick="invAddForm()">➕ 새 제품 넣기</button>
    </div>
    <div id="inv-form"></div>
    <div class="inv-grid">${cards || '<div class="muted" style="font-size:1.1rem">아직 등록된 제품이 없어요. 위의 [새 제품 넣기]를 눌러 주세요.</div>'}</div>`;
}

function invAddForm() {
  $('#inv-form').innerHTML = `
    <div class="card">
      <div class="form-row"><label>제품 이름</label><input id="inv-name" placeholder="예: Margot Denim Pants"></div>
      <div class="form-row"><label>컬러 (없으면 비워두세요)</label><input id="inv-color" placeholder="예: Indigo Blue"></div>
      <div class="form-row"><label>사이즈 (없으면 비워두세요)</label><input id="inv-size" placeholder="예: M"></div>
      <div class="form-row"><label>개수</label><input id="inv-qty" type="number" value="1" min="0"></div>
      <button class="big-btn green" onclick="invAdd()">✔️ 저장</button>
      <button class="big-btn gray" onclick="renderInventory()">취소</button>
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
  renderInventory();
  toast('저장했어요! ✔️');
}
async function invAdj(id, d) {
  const item = DB.inventory.find(i => i.id === id);
  if (!item) return;
  item.qty = Math.max(0, item.qty + d);
  await saveDb();
  renderInventory();
}
async function invDel(id) {
  const item = DB.inventory.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`"${item.name}"을(를) 재고 목록에서 지울까요?`)) return;
  DB.inventory = DB.inventory.filter(i => i.id !== id);
  await saveDb();
  renderInventory();
}

// ---------- 설정 ----------
function renderSettings() {
  const s = DB.settings;
  const c24 = SYNC_STATUS && SYNC_STATUS.cafe24;
  const connected = c24 && c24.connected;
  main().innerHTML = `
    <h1>⚙️ 설정</h1>
    <div class="sub">우체국 엑셀에 들어가는 <b>보내는 분</b> 정보예요. 한 번만 적어두면 돼요.</div>
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
      <div class="step-title">📝 구글시트 송장 자동 기록 ${s.sheetWebhookUrl ? '<span class="chip done">켜짐 ✓</span>' : '<span class="chip wait">꺼짐</span>'}</div>
      <div class="hint">
        송장을 붙일 때 <b>시딩 구글시트의 송장번호 칸에도 자동으로</b> 적어줍니다.<br>
        구글시트에 스크립트를 한 번 설치해야 해요 — 방법은 프로젝트 폴더의 <b>구글시트-자동기록-설치법.md</b> 참고.
      </div>
      <div class="form-row"><label>웹 앱 주소 (스크립트 배포 후 받은 URL)</label><input id="set-whurl" value="${esc(s.sheetWebhookUrl)}" placeholder="https://script.google.com/macros/s/..../exec"></div>
      <div class="form-row"><label>비밀 암호 (스크립트에 적은 것과 같게)</label><input id="set-whtoken" value="${esc(s.sheetWebhookToken)}" placeholder="예: nusolvere123"></div>
      <button class="big-btn green" onclick="saveSettings()">✔️ 저장</button>
    </div>`;
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

// ---------- 동작: 불러오기 / 내보내기 / 업로드 ----------
async function doSync() {
  busy(true, '구글시트에서 가져오는 중…');
  try {
    const r = await api('/api/sync', { method: 'POST' });
    busy(false);
    if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
    DB = r.db;
    SYNC_STATUS = r.status || SYNC_STATUS;
    const c24added = r.cafe24 ? r.cafe24.added : 0;
    const msg = `새로 가져옴: 시딩 ${r.seeding.added}건, 주문 ${r.orders.added + c24added}건` +
      (r.seeding.updated + r.orders.updated ? ` (내용 바뀐 것 ${r.seeding.updated + r.orders.updated}건)` : '');
    toast('✔️ ' + msg, 5000);
    render();
  } catch (e) {
    busy(false);
    toast('⚠️ 인터넷 연결을 확인해 주세요.', 6000);
  }
}

async function doExport(kind) {
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const selected = list.filter(x => x.status !== '발송완료' && x._sel !== false)
    .map(x => ({ type: kind === 'seeding' ? 'seeding' : 'order', id: x.id }));
  if (!selected.length) { toast('선택된 사람이 없어요.'); return; }
  busy(true, '우체국 엑셀을 만드는 중…');
  const r = await api('/api/export/epost', { method: 'POST', body: JSON.stringify({ selected }) });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  DB = r.db;
  render();
  const box = $('#export-result');
  if (box) box.innerHTML = `
    <div class="result-box ok">
      <div class="big">✅ 다 됐어요! 택배 ${r.parcels}건짜리 엑셀을 만들었어요.</div>
      📁 파일 위치: <b>다운로드 폴더</b> → <b>${esc(r.fname)}</b><br>
      이제 <b>우체국 프로그램(오즈뷰어)</b>을 열고 이 파일을 불러와서 송장을 출력하세요.
    </div>`;
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
  busy(true, '파일을 읽는 중…');
  try {
    const buf = await file.arrayBuffer();
    const r = await api('/api/upload/' + which, { method: 'POST', body: buf });
    busy(false);
    if (r.error) { toast('⚠️ ' + r.error, 7000); return; }
    DB = r.db;
    if (which === 'cafe24') {
      render();
      toast(`✔️ 주문 ${r.added}건을 새로 가져왔어요.` + (r.total - r.added > 0 ? ` (이미 있던 ${r.total - r.added}건은 건너뜀)` : ''), 6000);
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

// ---------- 자동 새로고침 (30초마다 확인) ----------
async function refreshStatus(force) {
  try {
    const r = await api('/api/status');
    SYNC_STATUS = r.status;
    if (force || (DB && r.rev !== DB.rev)) {
      const before = DB ? pendingOf(DB.seeding).length + pendingOf(DB.orders).length : 0;
      DB = await api('/api/db');
      const after = pendingOf(DB.seeding).length + pendingOf(DB.orders).length;
      // 입력 중인 화면(설정, 재고 추가 폼)은 건드리지 않음
      const formOpen = PAGE === 'settings' || document.querySelector('#inv-form input');
      if (!formOpen) render();
      if (after > before) toast(`🔔 새로 들어온 것이 ${after - before}건 있어요!`, 6000);
    }
  } catch (e) { /* 서버 꺼짐 등은 조용히 넘어감 */ }
}

// ---------- 시작 ----------
(async function init() {
  DB = await api('/api/db');
  await refreshStatus(false);
  go('home');
  setInterval(() => refreshStatus(false), 30 * 1000);
})();
