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
  try {
    const res = await fetch(path, opts);
    return await res.json();
  } catch (e) {
    busy(false);
    return { error: '프로그램(서버)와 연결이 안 돼요. 검은 창이 꺼졌는지 확인하고, 바탕화면 아이콘으로 다시 켜주세요.' };
  }
}
async function saveDb() {
  const r = await api('/api/db', { method: 'POST', body: JSON.stringify(DB) });
  if (r && r.rev != null) DB.rev = r.rev;
}
// 서버에서 새 DB를 받아올 때 체크박스 선택 상태(_sel)를 유지
function adoptDb(newDb) {
  if (DB && newDb && !newDb.error) {
    for (const key of ['orders', 'seeding']) {
      const oldSel = new Map((DB[key] || []).filter(x => x._sel === false).map(x => [x.id, false]));
      for (const it of (newDb[key] || [])) if (oldSel.has(it.id)) it._sel = false;
    }
  }
  DB = newDb;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function chip(status) {
  const map = { '대기': ['wait', '보낼 준비'], '접수중': ['processing', '우체국 접수중'], '발송완료': ['done', '보냄 ✓'], '배달완료': ['done', '배달완료 ✓✓'], '취소됨': ['wait', '취소됨 ✕'] };
  const [cls, label] = map[status] || ['wait', status];
  return `<span class="chip ${cls}">${label}</span>`;
}
// ---- 제품 매칭: 자유 텍스트(구글폼)를 카페24 실제 제품(품번+사진)과 연결 ----
function lettersOnly(s) { return String(s || '').toLowerCase().replace(/[^a-z가-힣]/g, ''); }
function matchProducts(text) {
  if (!DB.products || !DB.products.length) return [];
  const t = lettersOnly(text);
  if (!t) return [];
  const hits = [];
  for (const p of DB.products) {
    const stripped = String(p.name).replace(/^[A-Za-z]#?\d+_?/, '');
    const core = lettersOnly(stripped);
    if (!core || core.length < 6) continue;
    if (t.includes(core)) { hits.push({ p, pos: t.indexOf(core), exact: 1 }); continue; }
    // 느슨한 매칭: 품번명 단어가 순서 상관없이 전부 들어있으면
    // (예: "Margot Denim(Indigoblue)" ↔ "Margot Denim Pants (Indigo Blue)")
    const words = stripped.split(/[^A-Za-z가-힣]+/).map(lettersOnly).filter(w => w.length >= 3);
    if (words.length >= 2 && words.every(w => t.includes(w))) {
      hits.push({ p, pos: t.indexOf(words[0]), exact: 0 });
    }
  }
  hits.sort((a, b) => (b.exact - a.exact) || a.pos - b.pos);
  const seen = new Set();
  return hits.filter(h => !seen.has(h.p.no) && seen.add(h.p.no)).map(h => h.p);
}
// "B#05_Tessa Pigment Pants(Brown)" → 이름 "B#05_Tessa Pigment Pants" + 색상 "Brown"
function splitColor(name) {
  const m = String(name || '').match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  return m ? { base: m[1], color: m[2] } : { base: String(name || ''), color: '' };
}
function normOpt(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, ''); }
// 옵션 표기 통일: 어디서 왔든(구글폼 size, 카페24 "색상=X, 사이즈=Y") → {color, size}
function parseOption(x) {
  let color = String(x.color || '').trim();
  let size = String(x.size || '').trim();
  const raw = String(x.option || '').trim();
  if (raw) {
    const mc = raw.match(/색상\s*=\s*([^,/]+)/);
    const ms = raw.match(/사이즈\s*=\s*([^,/]+)/);
    if (mc && !color) color = mc[1].trim();
    if (ms && !size) size = ms[1].trim();
    if (!mc && !ms && !color && !size) size = raw; // 자유 텍스트 옵션은 그대로
  }
  return { color, size };
}
// 제품 표시를 {name: 제품명(사진 포함), opt: "색상 / 사이즈"} 로 분리
function productParts(x) {
  const { color, size } = parseOption(x);
  const matches = matchProducts(x.product);
  if (!matches.length) {
    return { name: esc(x.product), opt: [color, size].filter(Boolean).join(', ') };
  }
  // 제품 칸에는 이름만 (색상은 전부 옵션 칸으로)
  const name = matches.map(p => {
    const { base } = splitColor(p.name);
    return `
    <div style="display:flex;align-items:center;gap:0.4rem;margin:0.1rem 0;line-height:1.25">
      ${p.img ? `<img src="${esc(p.img)}" style="width:30px;height:30px;object-fit:cover;border-radius:6px;flex-shrink:0" onerror="this.style.display='none'">` : ''}
      <span><b>${esc(base)}</b></span>
    </div>`;
  }).join('');
  // 옵션 = "색상(제품 순서대로), 사이즈" — 중복 색은 한 번만
  const parts = [];
  const seenC = new Set();
  for (const p of matches) {
    const c = splitColor(p.name).color;
    if (c && !seenC.has(normOpt(c))) { seenC.add(normOpt(c)); parts.push(c); }
  }
  if (color && !seenC.has(normOpt(color))) parts.push(color);
  if (size) parts.push(size);
  return { name, opt: parts.join(', ') };
}
function productCell(x) {
  const { name, opt } = productParts(x);
  return name + (opt ? `<div class="muted" style="font-size:0.85rem;line-height:1.3">옵션: ${esc(opt)}</div>` : '');
}
// 송장번호 압축 표시: 조회 링크 + 작은 번호
function invoiceCell(inv) {
  if (!inv) return '<span class="muted">아직 없음</span>';
  const digits = String(inv).replace(/\D/g, '');
  if (digits.length === 13) {
    return `<a class="track-link" target="_blank" href="https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${digits}">배송조회 🔍</a><div class="muted" style="font-size:0.8rem">${esc(inv)}</div>`;
  }
  return `<span class="muted" style="font-size:0.9rem">${esc(inv)}</span>`;
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

// ---------- 도움말 말풍선 ----------
const HELP = {
  home: `여기는 <b>전체 요약</b> 화면이에요.<br>위의 칸들은 물건이 지금 어느 단계에 몇 건 있는지 보여줘요. 칸이나 아래 카드를 누르면 그 화면으로 이동합니다.<br>아래 통계는 이번 달에 보낸 택배와 택배비 합계예요.`,
  send: `주문(🛒)과 시딩(🎁)은 <b>5분마다 자동으로</b> 들어와요. 직접 입력할 필요 없어요.<br>
① 목록에서 보낼 사람이 맞는지 체크 확인<br>
② <b>[🚀 우체국 바로 접수]</b> — 송장번호가 그 자리에서 나와요. 인쇄는 [📦 우체국 접수]에서<br>
③ 우체국 창구 등 <b>앱 밖에서 이미 보낸 건</b>은 그 줄의 <b>[따로 보냈어요]</b>를 누르면 정리돼요`,
  epost: `앱으로 우체국에 접수한 택배 목록이에요.<br>
· <b>[🖨 인쇄]</b> — 라벨기로 운송장을 뽑아 상자에 붙여요<br>
· <b>[🔄 새로고침]</b> — 예약·수거가 어디까지 됐는지 우체국에 물어봐요<br>
· <b>[취소]</b> — 기사님이 가져가기 전(예약완료)까지만 가능해요. 취소하면 [보내기]로 돌아갑니다`,
  shipping: `보낸 물건 전체 기록이에요.<br>
· <b>파란 송장번호</b>를 누르면 지금 어디쯤 가는지 우체국 페이지가 열려요<br>
· 배달이 끝나면 <b>배달완료 ✓✓</b>가 자동으로 붙어요 (5분마다 확인)<br>
· 고객이 교환·반품을 원하면 그 줄의 <b>[🔁 교환/반품]</b>을 누르세요 — 정보가 자동으로 채워져요`,
  returns: `교환·반품은 3단계예요.<br>
① <b>등록</b> — [🚚 배송 확인]에서 [🔁]를 누르면 자동으로 채워져요<br>
② <b>[🚚 우체국 회수 신청]</b> — 기사님이 운송장을 갖고 <b>고객 집으로 가서</b> 물건을 받아와요<br>
③ 물건이 도착하면 <b>[📦 물건 도착 확인]</b> — 재고가 다시 채워지고, 교환이면 [보내기]에 재발송 건이 생겨요`,
  inventory: `남은 옷 개수예요.<br>
· 택배를 보내면 <b>자동으로 −</b>, 교환·반품으로 돌아오면 <b>자동으로 +</b> 돼요<br>
· 새 옷이 들어왔을 때만 ＋를 직접 눌러 채우세요<br>
· <span style="color:var(--red)"><b>빨간 숫자</b></span>는 2개 이하 — 곧 떨어진다는 뜻이에요!`,
  settings: `구글시트·카페24·우체국 연결을 관리해요.<br>한 번 연결해두면 계속 유지되니 평소엔 들어올 일이 없어요.<br>무언가 "연결이 필요해요"라고 뜨면 여기서 해당 [연결] 버튼만 다시 누르면 됩니다.`
};
function injectHelp() {
  if (document.getElementById('help-box')) return;
  const h1 = document.querySelector('#main h1');
  if (!h1 || !HELP[PAGE]) return;
  h1.insertAdjacentHTML('beforeend', ` <button class="help-btn" onclick="toggleHelp()">❓ 도움말</button>`);
  h1.insertAdjacentHTML('afterend', `<div id="help-box" class="help-box hidden">${HELP[PAGE]}</div>`);
}
function toggleHelp() {
  const b = document.getElementById('help-box');
  if (b) b.classList.toggle('hidden');
}

// ---------- 페이지 렌더 ----------
function render() {
  if (!DB) return;
  if (PAGE === 'home') renderHome();
  else if (PAGE === 'send' || PAGE === 'seeding' || PAGE === 'orders') renderSend();
  else if (PAGE === 'epost') renderEpost();
  else if (PAGE === 'shipping') renderShipping();
  else if (PAGE === 'returns') renderReturns();
  else if (PAGE === 'inventory') renderInventory();
  else if (PAGE === 'settings') renderSettings();
  injectHelp();
}

// ---------- 홈 ----------
function flowTile(icon, label, n, page, hot) {
  return `
    <div class="flow-tile ${n ? (hot ? 'hot' : '') : 'zero'}" onclick="go('${page}')">
      <div class="f-icon">${icon}</div>
      <div class="f-num">${n}</div>
      <div class="f-label">${label}</div>
    </div>`;
}
function renderHome() {
  const total = pendingOf(DB.orders).length + processingOf(DB.orders).length +
                pendingOf(DB.seeding).length + processingOf(DB.seeding).length;
  // 진행 흐름 보드: 물건이 지금 어느 단계에 몇 건 있는지
  const all = [...DB.orders, ...DB.seeding];
  const toSend = all.filter(x => x.status === '대기' || x.status === '접수중').length;
  const waitPickup = all.filter(x => x.status === '발송완료' && !x.delivered && x.epost && ['00', '01', '02', '04'].includes(x.epost.stus || '01')).length;
  const delivered = all.filter(x => x.status === '발송완료' && x.delivered).length;
  const moving = all.filter(x => x.status === '발송완료').length - waitPickup - delivered;
  const retActive = (DB.returns || []).filter(x => x.status === '대기' || x.status === '회수중').length;
  // 이번 달 통계: 발송 건수 / 택배비(우체국 접수 요금, 묶음당 1회) / 배달완료
  const _d = new Date();
  const ym = _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0');
  const sentThis = all.filter(x => x.status === '발송완료' && (x.sentDate || '').startsWith(ym));
  const seenNo = new Set();
  let cost = 0;
  for (const x of sentThis) {
    if (x.epost && x.epost.orderNo && !seenNo.has(x.epost.orderNo)) {
      seenNo.add(x.epost.orderNo);
      cost += Number(x.epost.price) || 0;
    }
  }
  const dlvThis = sentThis.filter(x => x.delivered).length;
  const retThis = (DB.returns || []).filter(x => (x.regDate || '').startsWith(ym) && x.status !== '취소됨').length;
  main().innerHTML = `
    <h1>안녕하세요! 👋</h1>
    <div class="sub">물건이 지금 어디까지 갔는지 한눈에 보여요. 칸을 누르면 그 화면으로 가요.</div>
    <div class="card">
      <div class="step-title">📊 지금 물건 흐름</div>
      <div class="flow-row">
        ${flowTile('📮', '보낼 준비', toSend, 'send', true)}
        <div class="flow-arrow">→</div>
        ${flowTile('📦', '수거 기다림', waitPickup, 'epost', false)}
        <div class="flow-arrow">→</div>
        ${flowTile('🚚', '가는 중', moving, 'shipping', false)}
        <div class="flow-arrow">→</div>
        ${flowTile('✅', '배달완료', delivered, 'shipping', false)}
        <div class="flow-arrow" style="color:#e3e8f2">|</div>
        ${flowTile('🔁', '교환·반품', retActive, 'returns', true)}
      </div>
      <div class="hint" style="margin:0.9rem 0 0; font-size:1.05rem">
        📅 <b>이번 달(${Number(ym.slice(5))}월)</b>: 보낸 택배 <b>${sentThis.length}건</b>
        · 택배비 <b>${cost.toLocaleString()}원</b> <span class="muted" style="font-size:0.85rem">(우체국 앱 접수 기준)</span>
        · 배달완료 <b>${dlvThis}건</b>${retThis ? ` · 교환/반품 <b>${retThis}건</b>` : ''}
      </div>
    </div>
    <div class="home-grid">
      <div class="home-card" onclick="go('send')">
        <div class="icon">📮</div>
        <div class="name">보내기</div>
        <div class="desc">주문·시딩을 한 번에<br>우체국으로 보낼 준비를 해요</div>
        <div class="badge ${total ? '' : 'zero'}">${total ? '보낼 것 ' + total + '건' : '보낼 것 없음'}</div>
      </div>
      <div class="home-card" onclick="go('epost')">
        <div class="icon">📦</div>
        <div class="name">우체국 접수</div>
        <div class="desc">접수된 택배의 진행상황을 보고<br>취소도 할 수 있어요</div>
      </div>
      <div class="home-card" onclick="go('shipping')">
        <div class="icon">🚚</div>
        <div class="name">배송 확인</div>
        <div class="desc">보낸 물건이 잘 가고 있는지<br>확인해요</div>
      </div>
      <div class="home-card" onclick="go('returns')">
        <div class="icon">🔁</div>
        <div class="name">교환/반품</div>
        <div class="desc">고객 집으로 기사님을 보내<br>물건을 다시 받아와요</div>
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
        ① 주문·시딩은 <b>5분마다 저절로</b> 들어와요<br>
        ② [📮 보내기]에서 <b>[🚀 우체국 바로 접수]</b> — 송장번호가 즉시 발급돼요<br>
        ③ <b>[🖨 운송장 바로 인쇄]</b> — 라벨기에서 뽑아 상자에 붙여요<br>
        ④ 끝! 카페24 배송처리·재고 차감·구글시트 기록은 저절로 됩니다
      </div>
    </div>`;
}

// ---------- 주문/시딩 목록 ----------
function renderSend() {
  const notDone = x => x.status !== '발송완료' && x.status !== '취소됨';
  const pending = [
    ...DB.orders.filter(notDone).map(x => ({ kind: 'orders', icon: x.exchange ? '🔁' : '🛒', x })),
    ...DB.seeding.filter(notDone).map(x => ({ kind: 'seeding', icon: '🎁', x }))
  ];
  const selCount = pending.filter(p => p.x._sel !== false).length;
  const c24 = SYNC_STATUS && SYNC_STATUS.cafe24;
  const c24line = !c24 || !c24.configured
    ? '⚪ 카페24 자동 연동이 아직 설정되지 않았어요. <button class="link-btn" onclick="go(\'settings\')">설정하러 가기</button>'
    : !c24.connected
      ? '🟡 카페24 연결이 필요해요. <button class="link-btn" onclick="go(\'settings\')">설정에서 연결하기</button>'
      : c24.ok === false
        ? '🔴 카페24에서 가져오기 실패: ' + esc(c24.error || '')
        : '🟢 카페24 자동 연동 중';

  const rows = pending.map(({ kind, icon, x }) => {
    const pp = productParts(x);
    return `
    <tr class="${x._sel !== false ? 'checked-row' : ''}">
      <td><input type="checkbox" ${x._sel !== false ? 'checked' : ''} onchange="toggleSel('${kind}',${x.id},this.checked)"></td>
      <td style="white-space:nowrap">${icon} ${x.exchange ? '교환' : kind === 'seeding' ? '시딩' : '주문'}</td>
      <td><b>${esc(x.name)}</b>${x.insta ? `<br><span class="muted" style="font-size:0.85rem">${esc(x.insta)}</span>` : ''}</td>
      <td>${esc(x.phone)}</td>
      <td style="max-width:420px">${esc(x.addr)}</td>
      <td style="min-width:240px;max-width:480px">${pp.name}</td>
      <td style="white-space:nowrap"><b>${esc(pp.opt) || '<span class="muted">-</span>'}</b></td>
      <td>${chip(x.status)}<br><button class="link-btn" style="font-size:0.85rem" onclick="manualShip('${kind}',${x.id},'${esc(x.name)}')">따로 보냈어요</button></td>
    </tr>`;
  }).join('');

  main().innerHTML = `
    <h1>📮 보내기</h1>
    <div class="sub">카페24 주문(🛒)과 시딩 선물(🎁)을 한 번에 우체국으로 보낼 준비를 해요.</div>
    <div class="card">
      <div class="step-title"><span class="step-num">1</span> 새로 들어온 것 확인</div>
      <div class="hint">주문과 시딩 신청은 <b>5분마다 자동으로</b> 들어와요. 방금 들어온 걸 바로 보고 싶으면 버튼을 누르세요.<br>${c24line}</div>
      <button class="big-btn" onclick="doSync()">🔄 지금 바로 확인하기</button>
      <details style="margin-top:1rem">
        <summary style="font-size:1rem;cursor:pointer;color:#5a6478">카페24 주문 엑셀 파일로 직접 넣기 <span class="note-badge">⚠️ 자동 연동이 안 될 때만</span></summary>
        <div class="dropzone" id="dz-cafe24" onclick="pickFile('cafe24')" style="margin-top:0.8rem">
          📂 여기에 카페24 주문 엑셀 파일을 끌어다 놓으세요
        </div>
      </details>
    </div>
    <div class="card">
      <div class="step-title"><span class="step-num">2</span> 우체국 접수하기</div>
      ${pending.length ? `
      <div class="hint">보낼 목록이에요. 빼고 싶은 사람은 체크를 풀면 돼요.</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>보내기</th><th>구분</th><th>이름</th><th>연락처</th><th>주소</th><th>제품</th><th>옵션</th><th>상태</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:1rem; display:flex; gap:0.8rem; flex-wrap:wrap">
        ${SYNC_STATUS && SYNC_STATUS.epost && SYNC_STATUS.epost.connected
          ? `<button class="big-btn green" onclick="doEpostRegister()">🚀 선택한 ${selCount}건 우체국 바로 접수</button>
             <button class="big-btn gray" onclick="doExportAll()">📄 엑셀로 만들기 (예비)</button>`
          : `<button class="big-btn green" onclick="doExportAll()">📄 선택한 ${selCount}건 우체국 엑셀 만들기</button>`}
      </div>
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
}

function toggleSel(kind, id, checked) {
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const item = list.find(x => x.id === id);
  if (item) item._sel = checked;
  render();
}

// ---------- 우체국 접수 현황 ----------
const EPOST_STUS = { '00': ['processing', '신청준비'], '01': ['processing', '예약완료 ✓'], '02': ['done', '운송장 출력됨'], '03': ['done', '집하완료 (수거됨)'], '04': ['wait', '미집하'], '05': ['wait', '취소됨'] };
function renderEpost() {
  const items = [
    ...DB.orders.filter(x => x.epost).map(x => ({ kind: 'order', icon: '🛒', x })),
    ...DB.seeding.filter(x => x.epost).map(x => ({ kind: 'seeding', icon: '🎁', x }))
  ].sort((a, b) => (b.x.sentDate || '').localeCompare(a.x.sentDate || ''));
  const rows = items.map(({ kind, icon, x }) => {
    const [cls, nm] = x.delivered ? ['done', '배달완료 ✓✓'] : (EPOST_STUS[x.epost.stus] || ['processing', '확인 필요']);
    const cancelable = !x.delivered && ['00', '01', '02'].includes(x.epost.stus || '01');
    return `
    <tr>
      <td style="white-space:nowrap">${icon} ${kind === 'seeding' ? '시딩' : '주문'}</td>
      <td><b>${esc(x.name)}</b></td>
      <td style="max-width:420px">${esc(String(x.product || '').slice(0, 90))}</td>
      <td style="max-width:150px">${x.invoice ? invoiceCell(x.invoice) : '<span class="muted">-</span>'}</td>
      <td><span class="chip ${cls}">${nm}</span></td>
      <td style="white-space:nowrap">${esc(x.sentDate || '')}</td>
      <td style="white-space:nowrap">
        ${x.epost.label ? `<button class="link-btn" onclick="printLabels('${kind}:${x.id}')">🖨 인쇄</button>` : `<button class="link-btn" onclick="window.open('https://biz.epost.go.kr','_blank')" title="이 건은 우체국 사이트에서 출력">🖨 사이트에서</button>`}
        ${cancelable ? `<button class="link-btn" style="color:var(--red)" onclick="epostCancel('${kind}',${x.id},'${esc(x.name)}')">취소</button>` : ''}
      </td>
    </tr>`;
  }).join('');
  const printable = items.filter(({ x }) => x.epost.label).map(({ kind, x }) => kind + ':' + x.id);
  main().innerHTML = `
    <h1>📦 우체국 접수 현황</h1>
    <div class="sub">앱에서 우체국에 접수한 택배들이에요. 순서: <b>① 접수</b> → <b>② [🖨 인쇄]로 운송장 출력</b> → <b>③ 상자에 붙이면 기사님이 수거</b></div>
    <div style="display:flex; gap:0.8rem; flex-wrap:wrap; margin-bottom:1.2rem">
      <button class="big-btn" onclick="epostRefresh()">🔄 진행상태 새로고침</button>
      ${printable.length ? `<button class="big-btn green" onclick="printLabels('${printable.join(',')}')">🖨 운송장 전체 인쇄 (${printable.length}장)</button>` : ''}
      <button class="big-btn gray" onclick="window.open('https://biz.epost.go.kr','_blank')">우체국 사이트 열기</button>
    </div>
    <div class="card">
      ${items.length ? `
      <div class="table-wrap" style="max-height:65vh">
        <table>
          <thead><tr><th>구분</th><th>이름</th><th>제품</th><th>송장번호</th><th>진행상태</th><th>접수일</th><th>인쇄·취소</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="hint" style="margin-top:0.8rem">· 운송장은 <b>[🖨 인쇄]</b>를 눌러 라벨기로 바로 뽑아요 (안 되면 [우체국 사이트 열기]에서도 가능)<br>· 기사님이 가져가기 전("예약완료")까지는 <b>[취소]</b>가 가능해요 — 취소하면 [보내기] 목록으로 돌아갑니다</div>
      ` : `<div class="hint" style="font-size:1.1rem">아직 앱에서 우체국에 접수한 건이 없어요.<br>[📮 보내기]에서 <b>[🚀 우체국 바로 접수]</b>를 누르면 여기에 나타납니다.</div>`}
    </div>
    <div id="epost-page-result"></div>`;
}
function printLabels(sel) {
  window.open('/label.html?print=1&sel=' + encodeURIComponent(sel), '_blank');
}
async function epostRefresh() {
  busy(true, '우체국에서 진행상태를 확인하는 중…');
  const r = await api('/api/epost/status', { method: 'POST' });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  adoptDb(r.db);
  render();
  toast(`✔️ ${r.refreshed}건 상태를 새로 확인했어요.` + (r.errors && r.errors.length ? ' (일부 실패)' : ''), 5000);
}
async function epostCancel(kind, id, name) {
  if (!confirm(`${name}님의 우체국 접수를 정말 취소할까요?\n\n· 발급된 송장번호는 무효가 돼요\n· 이 건은 [보내기] 목록으로 되돌아가요\n· 뺐던 재고도 다시 채워져요`)) return;
  busy(true, '우체국 접수를 취소하는 중…');
  const r = await api('/api/epost/cancel', { method: 'POST', body: JSON.stringify({ type: kind, id }) });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 8000); return; }
  adoptDb(r.db);
  render();
  toast('✔️ 접수를 취소했어요. [보내기] 목록으로 돌아갔습니다.', 6000);
  if (r.warning) setTimeout(() => alert('⚠️ ' + r.warning), 300);
}

// ---------- 교환/반품 ----------
const RET_CHIP = { '대기': ['wait', '회수 신청 전'], '회수중': ['processing', '회수 진행중'], '완료': ['done', '완료 ✓'], '취소됨': ['wait', '취소됨 ✕'] };
function renderReturns() {
  const items = [...(DB.returns || [])].sort((a, b) => (b.regDate || '').localeCompare(a.regDate || '') || b.id - a.id);
  const epostOn = SYNC_STATUS && SYNC_STATUS.epost && SYNC_STATUS.epost.connected;
  const rows = items.map(x => {
    const [cls, nm] = RET_CHIP[x.status] || ['wait', x.status];
    const stusNm = x.epost && x.epost.stus ? (EPOST_STUS[x.epost.stus] || [])[1] || '' : '';
    let btns = '';
    if (x.status === '대기') {
      btns = (epostOn ? `<button class="link-btn" onclick="returnPickup(${x.id},'${esc(x.name)}')">🚚 우체국 회수 신청</button>` : '<span class="muted" style="font-size:0.85rem">우체국 연결 필요</span>') +
        ` <button class="link-btn" style="color:var(--red)" onclick="returnCancel(${x.id},'delete','${esc(x.name)}')">🗑 지우기</button>`;
    } else if (x.status === '회수중') {
      btns = `<button class="link-btn" onclick="returnComplete(${x.id},'${esc(x.name)}','${esc(x.kind)}')">📦 물건 도착 확인</button>
        <button class="link-btn" style="color:var(--red)" onclick="returnCancel(${x.id},'pickup','${esc(x.name)}')">회수 취소</button>`;
    } else {
      btns = `<button class="link-btn" onclick="returnCancel(${x.id},'delete','${esc(x.name)}')">🗑 지우기</button>`;
    }
    return `
    <tr>
      <td style="font-size:1.2rem">${x.kind === '교환' ? '🔄' : '↩️'}</td>
      <td><b>${esc(x.name)}</b><br><span class="muted" style="font-size:0.85rem">${esc(x.phone)}</span></td>
      <td style="max-width:420px">${esc(x.product)}${x.option ? ` <b>(${esc(x.option)})</b>` : ''}${x.kind === '교환' && x.exchangeProduct ? `<br><span style="font-size:0.85rem">→ 교환: ${esc(x.exchangeProduct)}</span>` : ''}</td>
      <td style="max-width:280px">${esc(x.reason || '')}</td>
      <td style="max-width:150px">${x.invoice ? invoiceCell(x.invoice) : '<span class="muted">-</span>'}${stusNm ? `<span class="muted" style="font-size:0.85rem">${stusNm}</span>` : ''}</td>
      <td><span class="chip ${cls}">${nm}</span></td>
      <td style="white-space:nowrap">${btns}</td>
    </tr>`;
  }).join('');
  main().innerHTML = `
    <h1>🔁 교환/반품</h1>
    <div class="sub">고객이 교환·반품을 원하면 여기서 처리해요. 흐름: <b>① 등록</b> → <b>② 우체국 회수 신청</b> (기사님이 고객 집 방문) → <b>③ 물건 도착 확인</b> (재고 복귀 + 교환이면 재발송 준비)</div>
    <div style="display:flex; gap:0.8rem; flex-wrap:wrap; margin-bottom:1.2rem">
      <button class="big-btn green" onclick="returnForm()">➕ 교환/반품 등록</button>
      <button class="big-btn" onclick="epostRefresh()">🔄 회수 진행상태 새로고침</button>
    </div>
    <div id="ret-form"></div>
    <div class="card">
      ${items.length ? `
      <div class="table-wrap" style="max-height:65vh">
        <table>
          <thead><tr><th>구분</th><th>고객</th><th>제품</th><th>사유</th><th>회수 송장</th><th>상태</th><th>처리</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="hint" style="margin-top:0.8rem">· <b>회수 신청</b>을 하면 집배원이 운송장을 갖고 고객 집에 방문해요 (별도 출력 필요 없음)<br>· 물건이 도착하면 <b>[📦 물건 도착 확인]</b> — 재고가 다시 채워지고, 교환 건은 [📮 보내기]에 재발송 건이 생겨요<br>· 카페24 주문 건은 카페24 관리자에서도 교환/반품 상태를 처리해 주세요</div>
      ` : `<div class="hint" style="font-size:1.1rem">진행 중인 교환/반품이 없어요.<br>고객이 교환·반품을 원하면 위의 <b>[➕ 교환/반품 등록]</b>을 누르거나,<br>[🚚 배송 확인]에서 해당 건의 <b>[🔁 교환/반품]</b> 버튼을 누르세요.</div>`}
    </div>`;
}
function returnForm(pre) {
  pre = pre || {};
  const box = $('#ret-form');
  if (!box) return;
  box.innerHTML = `
    <div class="card">
      <div class="step-title">➕ 교환/반품 등록</div>
      <div class="form-row"><label>구분</label>
        <div style="display:flex;gap:1.2rem;font-size:1.1rem">
          <label style="display:flex;align-items:center;gap:0.4rem"><input type="radio" name="ret-kind" value="반품" ${pre.kind === '교환' ? '' : 'checked'} onchange="document.getElementById('ret-ex-row').style.display=this.value==='교환'?'':'none'"> ↩️ 반품 (돈 돌려주기)</label>
          <label style="display:flex;align-items:center;gap:0.4rem"><input type="radio" name="ret-kind" value="교환" ${pre.kind === '교환' ? 'checked' : ''} onchange="document.getElementById('ret-ex-row').style.display=this.value==='교환'?'':'none'"> 🔄 교환 (다른 걸로 보내기)</label>
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
      <div class="form-row" id="ret-ex-row" style="${pre.kind === '교환' ? '' : 'display:none'}"><label>교환으로 새로 보낼 제품 (옵션까지)</label><input id="ret-exchange" placeholder="예: W#03_Elin Pale Blouse (Ivory M)"></div>
      <button class="big-btn green" onclick="returnSubmit(${pre.sourceType === 'seeding' ? "'seeding'" : pre.sourceType === 'orders' ? "'orders'" : "''"})">✔️ 등록</button>
      <button class="big-btn gray" onclick="document.getElementById('ret-form').innerHTML=''">취소</button>
    </div>`;
  box.scrollIntoView({ behavior: 'smooth' });
  $('#ret-name').focus();
}
async function returnSubmit(sourceType) {
  const kind = document.querySelector('input[name="ret-kind"]:checked').value;
  const body = {
    kind, sourceType,
    name: $('#ret-name').value, phone: $('#ret-phone').value,
    zip: $('#ret-zip').value, addr: $('#ret-addr').value,
    product: $('#ret-product').value, option: $('#ret-option').value,
    qty: $('#ret-qty').value, reason: $('#ret-reason').value,
    origInvoice: $('#ret-orig').value,
    exchangeProduct: kind === '교환' ? $('#ret-exchange').value : ''
  };
  busy(true, '등록하는 중…');
  const r = await api('/api/return/create', { method: 'POST', body: JSON.stringify(body) });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  adoptDb(r.db);
  render();
  toast(`✔️ ${kind} 건을 등록했어요. 이제 [🚚 우체국 회수 신청]을 누르면 기사님이 고객 집으로 가요.`, 6000);
}
// 배송 확인 화면에서 보낸 건을 바로 교환/반품으로 넘기기
function returnFormFrom(kind, id) {
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const x = list.find(i => i.id === id);
  if (!x) return;
  go('returns');
  returnForm({
    sourceType: kind,
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
  if (r.error) { toast('⚠️ ' + r.error, 8000); return; }
  adoptDb(r.db);
  render();
  toast(`✔️ 회수 신청 완료! 송장번호 ${r.regiNo}${r.price ? ' (요금 ' + r.price + '원)' : ''}`, 8000);
}
async function returnComplete(id, name, kind) {
  const extra = kind === '교환' ? '\n· 교환이라서 [📮 보내기]에 재발송 건이 새로 생겨요' : '';
  if (!confirm(`${name}님의 물건이 도착했나요?\n\n· 재고가 다시 채워져요 (제품 이름이 재고와 맞으면)${extra}`)) return;
  busy(true, '처리하는 중…');
  const r = await api('/api/return/complete', { method: 'POST', body: JSON.stringify({ id }) });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  adoptDb(r.db);
  render();
  let msg = '✔️ 완료했어요.';
  if (r.stock && r.stock.length) msg += ' 재고 +' + r.stock.map(s => s.name + '(' + s.left + '개)').join(', ');
  if (r.resend) msg += ` / 재발송 건이 [보내기]에 생겼어요: ${r.resend.product}`;
  toast(msg, 8000);
}
async function returnCancel(id, scope, name) {
  const q = scope === 'delete' ? `${name}님 건을 목록에서 지울까요?` : `${name}님의 우체국 회수 신청을 취소할까요?\n(건은 남아 있어서 다시 신청할 수 있어요)`;
  if (!confirm(q)) return;
  busy(true, '처리하는 중…');
  const r = await api('/api/return/cancel', { method: 'POST', body: JSON.stringify({ id, scope }) });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 8000); return; }
  adoptDb(r.db);
  render();
  toast('✔️ 처리했어요.', 4000);
}

// ---------- 배송 확인 ----------
function renderShipping() {
  const all = [
    ...DB.orders.map(x => Object.assign({ _kind: '주문' }, x)),
    ...DB.seeding.map(x => Object.assign({ _kind: '시딩' }, x))
  ].sort((a, b) => (b.sentDate || b.regDate || '').localeCompare(a.sentDate || a.regDate || ''));
  const q = (window._shipQ || '').trim();
  const filtered = q ? all.filter(x => (x.name + x.phone + (x.invoice || '') + (x.product || '')).includes(q)) : all;
  const rows = filtered.slice(0, 200).map(x => {
    const pp = productParts(x);
    return `
    <tr>
      <td style="white-space:nowrap">${x._kind === '주문' ? '🛒' : '🎁'} ${x._kind}</td>
      <td style="white-space:nowrap">${esc(x.sentDate || '')}</td>
      <td><b>${esc(x.name)}</b></td>
      <td style="min-width:240px;max-width:480px">${pp.name}</td>
      <td style="white-space:nowrap"><b>${esc(pp.opt) || '<span class="muted">-</span>'}</b></td>
      <td>${chip(x.delivered ? '배달완료' : x.status)}</td>
      <td style="max-width:150px">${invoiceCell(x.invoice)}</td>
      <td>${x.status === '발송완료' ? `<button class="link-btn" onclick="returnFormFrom('${x._kind === '시딩' ? 'seeding' : 'orders'}',${x.id})">🔁 교환/반품</button>` : ''}</td>
    </tr>`;
  }).join('');
  main().innerHTML = `
    <h1>🚚 배송 확인</h1>
    <div class="sub">보낸 물건들을 확인해요. <b>파란 송장번호를 누르면</b> 지금 어디까지 갔는지 볼 수 있어요.</div>
    <input class="search-input" placeholder="🔍 이름이나 송장번호로 찾기" value="${esc(q)}"
      oninput="window._shipQ=this.value; renderShipping(); this.focus(); this.setSelectionRange(this.value.length,this.value.length)">
    <div class="card">
      <div class="table-wrap" style="max-height:70vh">
        <table>
          <thead><tr><th>구분</th><th>보낸 날</th><th>이름</th><th>제품</th><th>옵션</th><th>상태</th><th>송장번호</th><th>교환/반품</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8" class="muted">아직 내역이 없어요.</td></tr>'}</tbody>
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
  injectHelp();
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
    <div style="margin-bottom:1rem; display:flex; gap:0.8rem; flex-wrap:wrap">
      <button class="big-btn" onclick="invAddForm()">➕ 새 제품 넣기</button>
      ${DB.products && DB.products.length ? `<button class="big-btn orange" onclick="invImportProducts()">📥 카페24 제품 전부 불러오기</button>` : ''}
    </div>
    <div id="inv-form"></div>
    <div class="inv-grid">${cards || '<div class="muted" style="font-size:1.1rem">아직 등록된 제품이 없어요. 위의 [새 제품 넣기]를 눌러 주세요.</div>'}</div>`;
  injectHelp();
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
// 카페24 제품 목록을 재고 항목으로 한 번에 등록 (이미 있는 건 건너뜀)
async function invImportProducts() {
  const existing = new Set(DB.inventory.map(i => lettersOnly(i.name)));
  const news = (DB.products || []).filter(p => p.name && !existing.has(lettersOnly(p.name)));
  if (!news.length) { toast('새로 넣을 제품이 없어요. (이미 다 등록됨)'); return; }
  if (!confirm(`카페24 제품 ${news.length}개를 재고 목록에 넣을까요?\n(개수는 0으로 들어가니, 실제 재고 수량을 ＋로 채워 주세요)`)) return;
  for (const p of news) {
    DB.inventory.push({ id: DB.nextId++, name: p.name, color: '', size: '', qty: 0 });
  }
  await saveDb();
  renderInventory();
  toast(`✔️ ${news.length}개 제품을 넣었어요. 이제 실제 개수를 ＋로 채워 주세요.`, 6000);
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
  if ($('#set-epkey')) {
    s.epostApiKey = $('#set-epkey').value.trim();
    s.epostSecKey = $('#set-epsec').value.trim();
    s.epostMemberId = $('#set-epid').value.trim() || 'allincrew';
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
    adoptDb(r.db);
    SYNC_STATUS = r.status || SYNC_STATUS;
    const c24added = r.cafe24 ? r.cafe24.added : 0;
    const cxl = (r.seeding.canceled || 0) + (r.orders.canceled || 0) + (r.cafe24 && r.cafe24.canceled || 0);
    const msg = `새로 가져옴: 시딩 ${r.seeding.added}건, 주문 ${r.orders.added + c24added}건` +
      (r.seeding.updated + r.orders.updated ? ` (내용 바뀐 것 ${r.seeding.updated + r.orders.updated}건)` : '') +
      (cxl ? ` / 취소 반영 ${cxl}건` : '');
    toast('✔️ ' + msg, 5000);
    render();
  } catch (e) {
    busy(false);
    toast('⚠️ 인터넷 연결을 확인해 주세요.', 6000);
  }
}

async function doExportAll() {
  const sendable = x => x.status !== '발송완료' && x.status !== '취소됨' && x._sel !== false;
  const selected = [
    ...DB.orders.filter(sendable).map(x => ({ type: 'order', id: x.id })),
    ...DB.seeding.filter(sendable).map(x => ({ type: 'seeding', id: x.id }))
  ];
  if (!selected.length) { toast('선택된 사람이 없어요.'); return; }
  busy(true, '우체국 엑셀을 만드는 중…');
  const r = await api('/api/export/epost', { method: 'POST', body: JSON.stringify({ selected }) });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 6000); return; }
  adoptDb(r.db);
  render();
  const box = $('#export-result');
  if (box) box.innerHTML = `
    <div class="result-box ok">
      <div class="big">✅ 다 됐어요! 택배 ${r.parcels}건짜리 엑셀을 만들었어요.</div>
      방금 <b>파일이 든 폴더</b>와 <b>우체국 사이트</b>가 자동으로 열렸어요.<br>
      우체국 사이트에서 <b>계약소포 → 파일등록 → [찾기]</b>를 누르고,<br>
      열린 폴더에 있는 <b>${esc(r.fname)}</b> 파일을 선택하면 됩니다.
    </div>`;
  window.scrollTo(0, document.body.scrollHeight);
}

// 앱 밖에서 따로 보낸 건 정리 (우체국 창구, 다른 택배 등)
async function manualShip(kind, id, name) {
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
  if (r.cafe24 && r.cafe24.some(c => c.ok)) extras.push('카페24 배송처리');
  if (r.sheet && r.sheet.ok) extras.push('구글시트 기록');
  toast(`✔️ ${name}님 건을 발송완료로 정리했어요.` + (extras.length ? ' (자동: ' + extras.join(' · ') + ')' : ''), 7000);
}

// 우체국 OpenAPI 바로 접수
async function doEpostRegister() {
  const sendable = x => x.status !== '발송완료' && x.status !== '취소됨' && x._sel !== false;
  const selected = [
    ...DB.orders.filter(sendable).map(x => ({ type: 'order', id: x.id })),
    ...DB.seeding.filter(sendable).map(x => ({ type: 'seeding', id: x.id }))
  ];
  if (!selected.length) { toast('선택된 사람이 없어요.'); return; }
  if (!confirm(`${selected.length}건을 우체국에 바로 접수할까요?\n(접수하면 송장번호가 발급되고 요금이 계산돼요)`)) return;
  busy(true, '우체국에 접수하는 중…');
  const r = await api('/api/epost/register', { method: 'POST', body: JSON.stringify({ selected }) });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 7000); return; }
  adoptDb(r.db);
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
      (printSel.length ? `<div style="margin-top:0.8rem"><button class="big-btn green" onclick="printLabels('${printSel.join(',')}')">🖨 운송장 바로 인쇄</button></div>` : '') +
      `</div>`;
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
  if (r.sheet) extra.push(r.sheet.ok ? `📝 구글시트에도 송장 ${r.sheet.count}건 기록 완료` : `📝 구글시트 기록 실패: ${esc(r.sheet.error)}`);
  if (extra.length) html += `<div class="result-box ok" style="font-weight:400">${extra.join('<br>')}</div>`;
  const box = $('#export-result');
  if (box) box.innerHTML = html;
  window.scrollTo(0, document.body.scrollHeight);
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
  if (box) box.innerHTML = `<div class="result-box ok">🧪 테스트 성공! 응답 송장번호: <b>${esc(r.result.regiNo)}</b><br>
    <span style="font-weight:400">TESTREGINOAPI라고 나오면 정상이에요. 실제 접수는 되지 않았습니다.</span></div>`;
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
    adoptDb(r.db);
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
      adoptDb(await api('/api/db'));
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
  if (DB && DB.error) {
    main().innerHTML = `<div class="result-box err" style="margin-top:3rem; font-size:1.2rem">⚠️ ${esc(DB.error)}<br><br>
      <button class="big-btn" onclick="location.reload()">🔄 다시 시도</button></div>`;
    return;
  }
  await refreshStatus(false);
  go('home');
  setInterval(() => refreshStatus(false), 30 * 1000);
})();

