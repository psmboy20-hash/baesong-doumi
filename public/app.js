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
  if (r && r.conflict) {
    // 그 사이 자동 동기화가 저장함 — 서버 최신본을 받고 사용자에게 다시 하라고 안내
    adoptDb(r.db);
    render();
    toast('⚠️ 새 데이터가 들어와서 겹쳤어요. 방금 한 일을 한 번만 다시 해주세요.', 6000);
    return false;
  }
  if (r && r.rev != null) DB.rev = r.rev;
  return true;
}
// 서버에서 새 DB를 받아올 때 체크박스 선택 상태(_sel)를 유지
function adoptDb(newDb) {
  if (!newDb || newDb.error) return; // 서버 응답 실패 시 기존 화면 유지 (에러 객체로 갈아끼우지 않음)
  if (DB) {
    for (const key of ['orders', 'seeding']) {
      const oldSel = new Map((DB[key] || []).filter(x => x._sel === false).map(x => [x.id, false]));
      for (const it of (newDb[key] || [])) if (oldSel.has(it.id)) it._sel = false;
    }
  }
  DB = newDb;
}
// 이름 등을 onclick의 '...' 문자열 안에 넣을 때 (따옴표·역슬래시가 있어도 안 깨지게)
function jsq(s) {
  return esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function shipmentRecipientKey(x) {
  const name = String(x.name || '').replace(/\s+/g, '').replace(/\(.*?\)/g, '').trim();
  const addr = String(x.addr || '')
    .replace(/\((\d{5})\)/g, '')
    .replace(/\(우\)?\s*\d{5}\)?/g, '')
    .replace(/우편번호[:\s]*\d{5}/g, '')
    .replace(/\s+/g, ' ').trim();
  return name + '|' +
    String(x.phone || '').replace(/\D/g, '') + '|' +
    addr.slice(0, 15);
}
function shipmentKey(x) {
  if (x.epost && x.epost.orderNo) return 'epost|' + x.epost.orderNo;
  if (x.invoice) return 'invoice|' + String(x.invoice).replace(/\D/g, '') + '|' + shipmentRecipientKey(x);
  if (x.status === '발송완료') return 'sent|' + String(x.sentDate || '') + '|' + shipmentRecipientKey(x);
  if (x.status === '취소됨') return 'canceled|' + String(x.orderNo || x.regDate || x.id || '') + '|' + shipmentRecipientKey(x);
  if (x.packGroupId) return 'pending|pack|' + x.packGroupId;
  if (x.orderNo) return 'pending|order|' + x.orderNo;
  if (x.returnId) return 'pending|return|' + x.returnId;
  return 'pending|' + (x.sourceChannel || 'direct') + '|' + x.id;
}
function pendingFulfillmentKey(kind, x) {
  if (x.packGroupId) return 'pack|' + x.packGroupId;
  if (kind === 'orders' && x.orderNo) return 'order|' + x.orderNo;
  if (x.returnId) return 'return|' + x.returnId;
  return (kind === 'seeding' ? 'seeding' : 'order') + '|' + x.id;
}
function shipmentGroups(items, itemOf) {
  const groups = new Map();
  const pick = itemOf || (x => x);
  for (const entry of items) {
    const key = shipmentKey(pick(entry));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()];
}
function shipmentCount(items, itemOf) {
  return shipmentGroups(items, itemOf).length;
}
function shipmentProductKey(x) {
  const product = String(x.product || '')
    .replace(/\(P[A-Z0-9]+\)/gi, '')
    .replace(/\s+/g, '').toLowerCase();
  const color = String(x.color || '').replace(/[^a-z0-9가-힣]/gi, '').toLowerCase();
  const size = String(x.size || '').replace(/\s+/g, '').toUpperCase();
  return product + '|' + color + '|' + size;
}
function productQuantity(items, itemOf) {
  const pick = itemOf || (x => x);
  let total = 0;
  for (const group of shipmentGroups(items, itemOf)) {
    const products = new Map();
    for (const entry of group) {
      const item = pick(entry);
      const lines = String(item.product || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (lines.length > 1) {
        const key = 'multi|' + (item.id != null ? item.id : shipmentProductKey(item));
        products.set(key, Math.max(products.get(key) || 0, lines.length));
        continue;
      }
      const key = shipmentProductKey(item);
      products.set(key, Math.max(products.get(key) || 0, Number(item.qty) || 1));
    }
    total += [...products.values()].reduce((sum, qty) => sum + qty, 0);
  }
  return total;
}
function selectedShipmentCount(selected) {
  const items = selected.map(sel => {
    const list = sel.type === 'seeding' ? DB.seeding : DB.orders;
    return list.find(x => x.id === sel.id);
  }).filter(Boolean);
  return shipmentCount(items);
}
function chip(status) {
  const map = { '대기': ['wait', '보낼 준비'], '접수중': ['processing', '엑셀 접수 중 ⚠️'], '발송완료': ['done', '보냄 ✓'], '배달완료': ['done', '배달 끝 ✓✓'], '취소됨': ['wait', '취소됨 ✕'] };
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
// 색상 비교용 정규화 — 한글/영문 같은 색이면 같게 (Navy = 네이비)
const COLOR_KO = { '네이비': 'navy', '블랙': 'black', '화이트': 'white', '아이보리': 'ivory', '브라운': 'brown', '베이지': 'beige', '그레이': 'gray', '카키': 'khaki', '블루': 'blue', '스카이블루': 'skyblue', '라이트블루': 'lightblue', '인디고블루': 'indigoblue', '인디고': 'indigo', '레드': 'red', '핑크': 'pink', '그린': 'green', '옐로우': 'yellow', '퍼플': 'purple', '오렌지': 'orange', '민트': 'mint', '차콜': 'charcoal', '챠콜': 'charcoal', '크림': 'cream', '연청': 'lightblue', '진청': 'darkblue' };
function normOpt(s) {
  const t = String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  return COLOR_KO[t] || t;
}
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
    if (!mc && !ms && !color && !size) {
      const sm = raw.match(/^(.*?)(?:[\s,/]+)?(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|FREE|F)$/i);
      if (sm) {
        color = sm[1].trim();
        size = sm[2].toUpperCase();
      } else {
        color = raw;
      }
    }
  }
  return { color, size };
}
// 카페24 판매 페이지 주소
function saleUrl(no) {
  const mall = (DB && DB.settings && DB.settings.cafe24MallId) || 'solvere';
  return `https://${mall}.cafe24.com/product/detail.html?product_no=${no}`;
}
// 제품 사진 마우스오버 확대 미리보기
function imgPrev(e, src) {
  const d = $('#img-preview');
  if (!d) return;
  d.innerHTML = `<img src="${src}">`;
  d.classList.remove('hidden');
  imgPrevMove(e);
}
function imgPrevMove(e) {
  const d = $('#img-preview');
  if (!d || d.classList.contains('hidden')) return;
  d.style.left = Math.min(e.clientX + 24, innerWidth - 300) + 'px';
  d.style.top = Math.min(e.clientY + 24, innerHeight - 320) + 'px';
}
function imgPrevHide() {
  const d = $('#img-preview');
  if (d) d.classList.add('hidden');
}
function prodImgTag(src) {
  return `<img src="${esc(src)}" class="pimg" onmouseenter="imgPrev(event,'${esc(src)}')" onmousemove="imgPrevMove(event)" onmouseleave="imgPrevHide()" onerror="this.style.display='none'">`;
}
// 제품 표시를 {name: 제품명(사진 포함), opt: "색상 / 사이즈"} 로 분리
function productParts(x) {
  const { color, size } = parseOption(x);
  const matches = matchProducts(x.product);
  const qty = Number(x.qty) || 1;
  const qtyTag = qty > 1 ? ` <span style="color:var(--red);font-weight:900">×${qty}개</span>` : '';
  if (!matches.length) {
    const parts = [color, size].filter(Boolean);
    const optTxt = (parts.length ? '<b>' + esc(parts.join(', ')) + '</b>' : '') + qtyTag;
    return { name: esc(x.product), opt: optTxt };
  }
  // 제품 칸에는 이름만, 옵션 칸에는 제품마다 자기 "색상, 사이즈"가 같은 줄 높이로 나란히
  const single = matches.length === 1;
  const name = matches.map(p => {
    const { base } = splitColor(p.name);
    return `
    <div style="display:flex;align-items:center;gap:0.4rem;height:36px;margin:0.1rem 0;line-height:1.2;overflow:hidden">
      ${p.img ? prodImgTag(p.img) : ''}
      <span class="pname-link" style="white-space:nowrap" onclick="window.open('${saleUrl(p.no)}','_blank')" title="판매 페이지 열기"><b>${esc(base)}</b></span>
    </div>`;
  }).join('');
  const opt = matches.map(p => {
    const c = splitColor(p.name).color;
    const parts = [];
    if (c) parts.push(c);
    if (single && color && (!c || normOpt(color) !== normOpt(c))) parts.push(color);
    if (size) parts.push(size);
    return `<div style="display:flex;align-items:center;height:36px;margin:0.1rem 0;white-space:nowrap">${parts.length ? '<b>' + esc(parts.join(', ')) + '</b>' : '<span class="muted">-</span>'}${qtyTag}</div>`;
  }).join('');
  return { name, opt };
}
function productCell(x) {
  const { name, opt } = productParts(x);
  return name + (opt || '');
}
// 택배사별 배송조회 주소 (courier 필드나 송장 문자열에서 택배사 판별)
function trackUrl(inv, courier) {
  const digits = String(inv || '').replace(/\D/g, '');
  if (!digits) return '';
  const c = String(courier || '') + ' ' + String(inv || '');
  if (c.includes('롯데')) return 'https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=' + digits;
  if (c.includes('CJ') || c.includes('대한통운')) return 'https://trace.cjlogistics.com/next/tracking.html?wblNo=' + digits;
  if (c.includes('한진')) return 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=' + digits;
  if (c.includes('로젠')) return 'https://www.ilogen.com/web/personal/trace/' + digits;
  if (digits.length === 13) return 'https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=' + digits;
  return '';
}
// 송장번호 압축 표시: 조회 링크 + 작은 번호
function invoiceCell(inv, courier) {
  if (!inv) return '<span class="muted">아직 없음</span>';
  const url = trackUrl(inv, courier);
  if (url) {
    const label = (courier && !String(inv).includes(courier) ? courier + ' ' : '') + inv;
    return `<a class="track-link" target="_blank" href="${url}">배송조회 🔍</a><div class="muted" style="font-size:0.8rem">${esc(label)}</div>`;
  }
  return `<span class="muted" style="font-size:0.9rem">${esc(inv)}</span>`;
}
function shipmentSourceLabel(x) {
  if (x.exchange || x.sourceChannel === 'exchange') return '🔁 교환 재발송';
  if (x.sourceChannel === 'seeding' || x._kind === '시딩') return '🎁 시딩';
  if (x.sourceChannel === 'direct') return '✍ 직접 등록';
  return '🛒 주문';
}

function trackLink(inv) {
  if (!inv) return '';
  const digits = String(inv).replace(/\D/g, '');
  if (digits.length === 13) {
    return `<a class="track-link" target="_blank" href="https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${digits}">${esc(inv)}</a>`;
  }
  return esc(inv);
}
function go(page, sub) {
  PAGE = page;
  if (page === 'shipping') window._shipFilter = sub || 'all'; // 홈 타일에서 오면 그 단계만 보이게
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  render();
  window.scrollTo(0, 0);
}
function pendingOf(list) { return list.filter(x => x.status === '대기'); }
function processingOf(list) { return list.filter(x => x.status === '접수중'); }

// ---------- 도움말 말풍선 ----------
const HELP = {
  home: `여기는 <b>전체 요약</b> 화면이에요.<br>칸들은 물건이 지금 어느 단계에 몇 건 있는지 보여줘요. 칸을 누르면 그 화면으로 이동합니다.<br>아래엔 이번 달 통계(보낸 택배·택배비)와 재고 요약이 있어요.`,
  send: `주문(🛒)과 시딩(🎁)은 <b>5분마다 자동으로</b> 들어와요. 직접 입력할 필요 없어요.<br>
① 목록에서 보낼 사람이 맞는지 체크 확인<br>
② <b>[🚀 우체국 바로 접수]</b> — 송장번호가 그 자리에서 나와요. 인쇄는 [📦 우체국 접수]에서<br>
③ 우체국 창구 등 <b>앱 밖에서 이미 보낸 건</b>은 그 줄의 <b>[따로 보냈어요]</b>를 누르면 정리돼요<br>
④ 안 보낼 건은 <b>[안 보내요 ✕]</b> — 마음이 바뀌면 [🚚 배송 확인]에서 <b>[다시 보내기]</b>로 되돌려요<br>
⑤ <b>⚠️ 우편번호 없음</b>이 뜬 줄은 5자리를 넣고 [저장] — 옷 꺼낼 땐 <b>[📋 오늘 쌀 목록 인쇄]</b>가 편해요`,
  epost: `앱으로 우체국에 접수한 택배 목록이에요.<br>
· <b>[🖨 인쇄]</b> — 라벨기로 운송장을 뽑아 상자에 붙여요<br>
· <b>[🔄 새로고침]</b> — 예약·수거가 어디까지 됐는지 우체국에 물어봐요<br>
· <b>[취소]</b> — 기사님이 가져가기 전까지 할 수 있어요. 취소 버튼이 보이면 아직 가능하다는 뜻이에요. 취소하면 [보내기]로 돌아갑니다`,
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
  settings: `구글시트·카페24·우체국 연결과 알림·백업을 관리해요.<br>한 번 해두면 계속 유지되니 평소엔 들어올 일이 없어요.<br>무언가 "연결이 필요해요"라고 뜨면 여기서 🔗 로 시작하는 파란 버튼만 다시 누르면 됩니다.<br>장부는 💾 <b>하루 한 번 자동 백업</b>되고, 잘못됐을 땐 여기서 예전 날짜로 되돌릴 수 있어요.`
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
  updateNavBadge();
}

// ---------- 홈 ----------
function flowTile(icon, label, n, page, hot, sub) {
  return `
    <div class="flow-tile ${n ? (hot ? 'hot' : '') : 'zero'}" onclick="go('${page}'${sub ? `,'${sub}'` : ''})">
      <div class="f-icon">${icon}</div>
      <div class="f-num">${n}</div>
      <div class="f-label">${label}</div>
    </div>`;
}
function renderHome() {
  // 진행 흐름 보드: 물건이 지금 어느 단계에 몇 건 있는지
  const all = [...DB.orders, ...DB.seeding];
  const toSendItems = all.filter(x => x.status === '대기' || x.status === '접수중');
  const toSend = shipmentCount(toSendItems);
  // 3일 넘게 안 움직인 건 — 앱 밖에서 이미 보냈을 가능성을 먼저 물어본다
  const staleCount = shipmentCount(toSendItems.filter(x => x.regDate && (Date.now() - new Date(x.regDate)) / 86400000 >= 3));
  const waitPickup = shipmentCount(all.filter(x => x.status === '발송완료' && !x.delivered && x.epost && ['00', '01', '02'].includes(x.epost.stus || '01')));
  const problem = shipmentCount(all.filter(x => x.status === '발송완료' && !x.delivered && x.epost && x.epost.stus === '04'));
  const delivered = shipmentCount(all.filter(x => x.status === '발송완료' && x.delivered));
  const moving = shipmentCount(all.filter(x => x.status === '발송완료' && !x.delivered && !(x.epost && ['00', '01', '02', '04'].includes(x.epost.stus || '01'))));
  const retActive = (DB.returns || []).filter(x => x.status === '대기' || x.status === '회수중').length;
  // 이번 달 통계: 발송 건수 / 택배비(우체국 접수 요금, 묶음당 1회) / 배달완료
  const _d = new Date();
  const ym = _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0');
  const sentThis = all.filter(x => x.status === '발송완료' && (x.sentDate || '').startsWith(ym));
  const sentThisCount = shipmentCount(sentThis);
  const sentProductQty = productQuantity(sentThis);
  const seenNo = new Set();
  let cost = 0;
  for (const x of sentThis) {
    if (x.epost && x.epost.orderNo && !seenNo.has(x.epost.orderNo)) {
      seenNo.add(x.epost.orderNo);
      cost += Number(x.epost.price) || 0;
    }
  }
  const dlvThis = shipmentCount(sentThis.filter(x => x.delivered));
  const retThis = (DB.returns || []).filter(x => (x.regDate || '').startsWith(ym) && x.status !== '취소됨').length;
  const lowStock = DB.inventory.filter(i => i.qty <= 2).length;
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
        ${flowTile('🚚', '가는 중', moving, 'shipping', false, 'moving')}
        <div class="flow-arrow">→</div>
        ${flowTile('✅', '배달 끝', delivered, 'shipping', false, 'done')}
        <div class="flow-arrow" style="color:#e3e8f2">|</div>
        ${flowTile('🔁', '교환·반품', retActive, 'returns', true)}
        ${needPrintList().length ? `<div class="flow-arrow" style="color:#e3e8f2">|</div>${flowTile('🖨', '인쇄할 운송장', needPrintList().length, 'epost', true)}` : ''}
        ${problem ? `<div class="flow-arrow" style="color:#e3e8f2">|</div>${flowTile('⚠️', '기사님이 못 가져감', problem, 'epost', true)}` : ''}
      </div>
      <div class="hint" style="margin:0.9rem 0 0; font-size:1.05rem">
        📅 <b>이번 달(${Number(ym.slice(5))}월)</b>: 보낸 택배 <b>${sentThisCount}건</b> · 상품 <b>${sentProductQty}개</b>
        · 택배비 <b>${cost.toLocaleString()}원</b> <span class="muted" style="font-size:0.85rem">(우체국 앱 접수 기준)</span>
        · 배달완료 <b>${dlvThis}건</b>${retThis ? ` · 교환/반품 <b>${retThis}건</b>` : ''}
      </div>
      ${staleCount ? `<div class="hint" style="margin:0.6rem 0 0;font-size:1.02rem;color:#b0640f">
        ⏰ <b>택배 ${staleCount}건</b>이 3일 넘게 [보낼 준비]에 그대로 있어요 — 우체국 사이트나 창구에서 <b>직접 보내셨다면</b> 앱은 몰라요.
        <button class="link-btn" onclick="go('send')">보내기에서 [따로 보냈어요] 누르기 →</button>
      </div>` : ''}
    </div>
    ${dashGrid(all)}
    <div class="card" style="margin-top:1rem">
      <details>
        <summary style="font-size:1.05rem;font-weight:800;cursor:pointer">💡 보내는 순서 (처음이면 펼쳐 보세요)</summary>
        <div class="hint" style="font-size:1.05rem;margin-top:0.6rem">
          ① 주문·시딩은 <b>5분마다 저절로</b> 들어와요<br>
          ② [📮 보내기]에서 <b>[🚀 우체국 바로 접수]</b> — 송장번호가 즉시 발급돼요<br>
          ③ [📦 우체국 접수]에서 <b>[🖨 운송장 인쇄]</b> — 라벨기에서 뽑아 상자에 붙여요<br>
          ④ 끝! 카페24 배송처리·재고 차감·구글시트 기록은 저절로 됩니다
        </div>
      </details>
    </div>`;
}

// ---------- 대시보드 (채널별 현황 · 추이 · 재고 · 교환반품 · 입출고 · 연동) ----------
function dashGrid(all) {
  const ym = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
  // 채널 구분: 앞으로 29CM·무신사 등이 여기에 늘어난다
  const tagged = [...DB.orders, ...DB.seeding];
  const channelName = x => ({ cafe24: '카페24', seeding: '시딩', exchange: '교환 재발송', direct: '직접 등록' }[x.sourceChannel] || '직접 등록');
  const chans = ['카페24', '시딩', '교환 재발송', '직접 등록', '혼합 합포장'];
  const c24ok = SYNC_STATUS && SYNC_STATUS.cafe24 && SYNC_STATUS.cafe24.ok;
  const gooOk = SYNC_STATUS && SYNC_STATUS.google && SYNC_STATUS.google.ok;
  const epOk = SYNC_STATUS && SYNC_STATUS.epost && SYNC_STATUS.epost.connected;
  const chanDot = { '카페24': c24ok ? 'on' : 'off', '시딩': gooOk ? 'on' : 'off', '교환 재발송': 'na', '직접 등록': 'na', '혼합 합포장': 'na' };
  const channelOfGroup = group => {
    const sources = new Set(group.map(channelName));
    if (sources.has('카페24') && sources.has('직접 등록') && sources.size === 2) return '카페24';
    if (sources.has('시딩') && sources.has('직접 등록') && sources.size === 2) return '시딩';
    return sources.size === 1 ? [...sources][0] : '혼합 합포장';
  };
  const waitingGroups = shipmentGroups(tagged.filter(x => x.status === '대기' || x.status === '접수중'));
  const sentGroups = shipmentGroups(tagged.filter(x => x.status === '발송완료' && (x.sentDate || '').startsWith(ym)));
  const chanRows = chans.map(c => {
    const waiting = waitingGroups.filter(g => channelOfGroup(g) === c).flat();
    const sentItems = sentGroups.filter(g => channelOfGroup(g) === c).flat();
    const wait = shipmentCount(waiting);
    const sent = shipmentCount(sentItems);
    const sentQty = productQuantity(sentItems);
    return `<div class="chan-row">
      <span class="dot ${chanDot[c]}"></span><span class="cname">${c}</span>
      <span class="cstat">${wait ? `<b style="color:#b0640f">보낼 택배 ${wait}건</b> · ` : ''}이달 <b>택배 ${sent}건</b> · 상품 ${sentQty}개</span>
    </div>`;
  }).join('');
  // 7일 발송 추이
  const days = [...Array(7)].map((_, k) => {
    const d = new Date(Date.now() - (6 - k) * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  });
  const cnt = days.map(d => shipmentCount(all.filter(x => x.status === '발송완료' && x.sentDate === d)));
  const mx = Math.max(...cnt, 1);
  const bars = days.map((d, k) => `
    <div class="vbar ${k === 6 ? 'today' : ''}">
      <div class="v">${cnt[k] || ''}</div>
      <div class="bar" style="height:${Math.round(cnt[k] / mx * 62)}px"></div>
      <div class="d">${Number(d.slice(5, 7))}/${Number(d.slice(8))}</div>
    </div>`).join('');
  // 재고 경고: 1~2개 남은 것 우선, 그다음 0개
  const low = DB.inventory.filter(i => i.qty > 0 && i.qty <= 2).slice(0, 6);
  const zero = DB.inventory.filter(i => i.qty === 0).length;
  const lowRows = low.map(i => `<div class="mini-row"><span class="grow">${esc(i.name)}${i.size ? ` <b>${esc(i.size)}</b>` : ''}</span><b style="color:var(--red)">${i.qty}개</b></div>`).join('');
  // 교환/반품 진행 중
  const rets = (DB.returns || []).filter(x => x.status === '대기' || x.status === '회수중').slice(0, 5);
  const retRows = rets.map(x => `<div class="mini-row"><span>${x.kind === '교환' ? '🔄' : '↩️'}</span><span class="grow"><b>${esc(x.name)}</b> ${esc(productParts(x).name.replace(/<[^>]*>/g, '').slice(0, 24))}</span><span class="chip ${x.status === '회수중' ? 'processing' : 'wait'}">${x.status === '회수중' ? '회수중' : '대기'}</span></div>`).join('');
  // 최근 입출고
  const logs = (DB.stockLog || []).slice(-5).reverse();
  const logRows = logs.map(e => `<div class="mini-row"><span>${e.delta < 0 ? '📤' : '📥'}</span><span class="grow">${esc(e.name)}${e.size ? ` <b>${esc(e.size)}</b>` : ''}${e.ref ? ` <span class="muted">→ ${esc(e.ref)}</span>` : ''}</span><b style="color:${e.delta < 0 ? '#c0392b' : '#1e7e46'}">${e.delta > 0 ? '+' : ''}${e.delta}</b></div>`).join('');
  return `
  <div class="dash-grid">
    <div class="card">
      <div class="dash-title">🛒 판매 채널 <button class="link-btn more" onclick="go('send')">보내기 →</button></div>
      ${chanRows}
      <div class="chan-row soon"><span class="dot na"></span><span class="cname">29CM</span><span class="cstat muted">연결 준비 중</span></div>
      <div class="chan-row soon"><span class="dot na"></span><span class="cname">무신사</span><span class="cstat muted">연결 준비 중</span></div>
    </div>
    <div class="card">
      <div class="dash-title">📈 최근 7일 택배 발송</div>
      <div class="vbar-wrap">${bars}</div>
    </div>
    <div class="card">
      <div class="dash-title">📋 재고 경고 <button class="link-btn more" onclick="go('inventory')">재고 →</button></div>
      ${lowRows || '<div class="muted" style="font-size:0.92rem;padding:0.3rem 0">1~2개 남은 제품이 없어요.</div>'}
      ${zero ? `<div class="mini-row"><span class="grow muted">0개(수량 미입력 포함)</span><b>${zero}종</b></div>` : ''}
    </div>
    <div class="card">
      <div class="dash-title">🔁 교환/반품 진행 중 <button class="link-btn more" onclick="go('returns')">전체 →</button></div>
      ${retRows || '<div class="muted" style="font-size:0.92rem;padding:0.3rem 0">진행 중인 건이 없어요. ✓</div>'}
    </div>
    <div class="card">
      <div class="dash-title">📜 최근 입출고 <button class="link-btn more" onclick="renderStockLog()">전체 →</button></div>
      ${logRows || '<div class="muted" style="font-size:0.92rem;padding:0.3rem 0">아직 기록이 없어요.</div>'}
    </div>
    <div class="card">
      <div class="dash-title">🔌 연동 상태</div>
      <div class="chan-row"><span class="dot ${c24ok ? 'on' : 'off'}"></span><span class="cname">카페24</span><span class="cstat">${c24ok ? '정상' : '확인 필요'}</span></div>
      <div class="chan-row"><span class="dot ${gooOk ? 'on' : 'off'}"></span><span class="cname">구글시트</span><span class="cstat">${gooOk ? '정상' : '확인 필요'}</span></div>
      <div class="chan-row"><span class="dot ${epOk ? 'on' : 'off'}"></span><span class="cname">우체국</span><span class="cstat">${epOk ? '정상' : '확인 필요'}</span></div>
      <div class="chan-row"><span class="dot on"></span><span class="cname">클라우드 서버</span><span class="cstat">24시간 가동</span></div>
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
  // 엑셀로 접수 중인 건은 기본 체크 해제 (바로 접수와 겹쳐 두 번 보내는 것 방지)
  for (const p of pending) if (p.x.status === '접수중' && p.x._sel === undefined) p.x._sel = false;
  const gmap = new Map();
  for (const p of pending) {
    const key = pendingFulfillmentKey(p.kind, p.x);
    if (!gmap.has(key)) gmap.set(key, []);
    gmap.get(key).push(p);
  }
  const groupsArr = [...gmap.values()];
  const selectedGroups = groupsArr.filter(g => g.every(p => p.x._sel !== false));
  const selCount = selectedGroups.length;
  const selProductQty = productQuantity(selectedGroups.flat(), entry => entry.x);
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
    const allSel = g.every(p => p.x._sel !== false);
    const kinds = [...new Set(g.map(p => p.x.exchange ? '🔁 교환' : p.kind === 'seeding' ? '🎁 시딩' : '🛒 주문'))].join('<br>');
    const names = g.map(p => `<div style="margin:0.1rem 0">${productParts(p.x).name}</div>`).join('');
    const opts = g.map(p => `<div style="margin:0.1rem 0">${productParts(p.x).opt || '<span class="muted">-</span>'}</div>`).join('');
    const noZip = !/^\d{5}$/.test(String(first.zip || '').trim()) && !matchZipInAddr(first.addr);
    const stusSet = [...new Set(g.map(p => p.x.status))];
    // 3일 넘게 그대로면: 앱 밖(우체국 창구·사이트)에서 이미 보냈는데 앱만 모르는 경우가 많다
    const staleDays = Math.max(...g.map(p => p.x.regDate ? Math.floor((Date.now() - new Date(p.x.regDate)) / 86400000) : 0));
    const staleBadge = staleDays >= 3 ? `<span class="note-badge" title="우체국 사이트·창구에서 직접 보내셨다면 [따로 보냈어요]를 눌러 정리해 주세요">⏰ ${staleDays}일째 그대로</span><br>` : '';
    // 접수 시도에서 "이미 보낸 것과 같은 내용"으로 막힌 건: 확인 후 한 번 더 보내기 허용
    const dupHere = g.filter(p => (window._dupIds || new Set()).has(p.kind + ':' + p.x.id) && !p.x.resendOk);
    const dupBadge = dupHere.length ? `<span class="note-badge" style="background:#fdecea;color:#c0392b">🚫 이미 보낸 것과 같음</span><br><button class="link-btn" style="font-size:0.85rem" onclick="resendOkGroup('${dupHere.map(p => p.kind + ':' + p.x.id).join(',')}','${jsq(first.name)}')">🔁 한 번 더 보내기</button><br>` : '';
    const sameRecipient = groupsArr.filter(other => other !== g && shipmentRecipientKey(other[0].x) === shipmentRecipientKey(first));
    const mergeSpec = [...g, ...sameRecipient.flat()].map(p => p.kind + ':' + p.x.id).join(',');
    const packingAction = first.packGroupId
      ? `<br><span class="note-badge">합포장 확정</span> <button class="link-btn" style="font-size:0.82rem" onclick="packUnmerge('${jsq(first.packGroupId)}','${jsq(first.name)}')">묶음 풀기</button>`
      : sameRecipient.length
        ? `<br><button class="link-btn" style="font-size:0.82rem" onclick="packMerge('${mergeSpec}','${jsq(first.name)}')">📦 같은 주소 ${sameRecipient.length + 1}건 한 비닐로 묶기</button>`
        : '';
    return `
    <tr class="${allSel ? 'checked-row' : ''}">
      <td><input type="checkbox" ${allSel ? 'checked' : ''} onchange="toggleSelGroup('${spec}',this.checked)"></td>
      <td style="white-space:nowrap">${kinds}</td>
      <td><b>${esc(first.name)}</b>${first.insta ? `<br><span class="muted" style="font-size:0.85rem">${esc(first.insta)}</span>` : ''}<br><span class="note-badge">📦 택배 1건 · 상품 ${groupProductQty}개</span>${packingAction}</td>
      <td>${esc(first.phone)}</td>
      <td style="max-width:420px">${esc(first.addr)}${noZip ? `
        <div style="margin-top:0.3rem;white-space:nowrap"><span class="note-badge">⚠️ 우편번호 없음</span>
        <input id="zip-g-${g[0].kind}-${first.id}" style="width:5.5rem;font-size:0.95rem;padding:0.25rem 0.4rem;border:2px solid var(--line);border-radius:8px" placeholder="5자리" maxlength="5">
        <button class="link-btn" style="font-size:0.9rem" onclick="fixZipGroup('${spec}','zip-g-${g[0].kind}-${first.id}')">저장</button></div>` : ''}</td>
      <td style="min-width:240px;max-width:480px">${names}</td>
      <td>${opts}</td>
      <td style="white-space:nowrap">${dupBadge}${staleBadge}${stusSet.map(s => chip(s)).join(' ')}<div class="btn-col" style="margin-top:0.3rem">${stusSet.includes('접수중') ? `<button class="link-btn" style="font-size:0.85rem" onclick="cancelExcelGroup('${spec}','${jsq(first.name)}')">↩️ 엑셀 접수 취소</button>` : ''}<button class="link-btn" style="font-size:0.85rem" onclick="manualShipGroup('${spec}','${jsq(first.name)}')">따로 보냈어요</button><button class="link-btn" style="font-size:0.85rem;color:var(--red)" onclick="cancelSendGroup('${spec}','${jsq(first.name)}')">안 보내요 ✕</button></div></td>
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
        <summary style="font-size:1rem;cursor:pointer;color:#5a6478">카페24 주문 엑셀 파일로 직접 넣기 <span class="note-badge">⚠️ 자동 연동이 안 될 때만</span></summary>
        <div class="dropzone" id="dz-cafe24" onclick="pickFile('cafe24')" style="margin-top:0.8rem">
          📂 여기에 카페24 주문 엑셀 파일을 끌어다 놓으세요
        </div>
      </details>
    </div>
    <div class="card">
      <div class="step-title"><span class="step-num">2</span> 우체국 접수하기</div>
      ${pending.length ? `
      <div class="hint">보낼 목록이에요. 빼고 싶은 사람은 체크를 풀면 돼요. (기본은 전체 선택)</div>
      <div style="margin-bottom:0.5rem">
        <button class="link-btn" onclick="selAll(true)">✅ 전체 선택</button> ·
        <button class="link-btn" onclick="selAll(false)">⬜ 전체 해제</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>보내기</th><th>구분</th><th>이름</th><th>연락처</th><th>주소</th><th>제품</th><th>옵션</th><th>상태</th></tr></thead>
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
async function autoZip(kind, id) {
  window._zipAsked = window._zipAsked || new Set();
  const key = kind + ':' + id;
  if (window._zipAsked.has(key)) return;
  window._zipAsked.add(key);
  const r = await api('/api/zip/lookup', { method: 'POST', body: JSON.stringify({ type: kind, id }) });
  if (r && r.ok && r.zip) {
    if (r.db) adoptDb(r.db);
    if (PAGE === 'send') render();
    toast('✔️ 우편번호를 자동으로 찾아 넣었어요: ' + r.zip, 5000);
  }
  // 실패(주소 불명확/키 없음)면 조용히 둠 — ⚠️ 배지에서 직접 입력
}
// 전체 선택/해제 (보내기 목록)
function selAll(v) {
  const notDone = x => x.status !== '발송완료' && x.status !== '취소됨';
  for (const list of [DB.orders, DB.seeding]) {
    for (const x of list) if (notDone(x)) x._sel = v;
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
  for (const { x } of specItems(spec)) x.zip = z;
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
async function manualShipGroup(spec, name) {
  const items = specItems(spec);
  if (!confirm(`${name}님 것(${items.length}개)을 우체국 창구 등 앱 밖에서 정말 이미 보내셨나요?\n\n· [보냄 ✓]으로 확정돼요 (재고 차감 · 카페24 배송처리 · 시트 기록까지 자동)\n· 한 번 확정하면 되돌리기 어려워요`)) return;
  const inv = prompt('송장번호가 있으면 입력해 주세요.\n없으면 빈칸 그대로 [확인]을 누르세요.');
  if (inv === null) return;
  busy(true, '발송완료로 정리하는 중…');
  let err = null;
  for (const { kind, x } of items) {
    const r = await api('/api/manual-ship', { method: 'POST', body: JSON.stringify({ type: kind === 'seeding' ? 'seeding' : 'order', id: x.id, invoice: (inv || '').trim() }) });
    if (r.error) err = r.error; else adoptDb(r.db);
  }
  busy(false);
  render();
  toast(err ? '⚠️ 일부는 처리 못 했어요: ' + err : `✔️ ${name}님 건을 발송완료로 정리했어요.`, 7000);
}

function toggleSel(kind, id, checked) {
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const item = list.find(x => x.id === id);
  if (item) item._sel = checked;
  render();
}

// ---------- 우체국 접수 현황 ----------
// 우체국 처리코드 → 쉬운 말 (발송용)
const EPOST_STUS = { '00': ['processing', '접수 준비중'], '01': ['processing', '접수됨 ✓'], '02': ['processing', '접수됨 · 🖨 인쇄하세요'], '03': ['done', '기사님이 가져감 ✓'], '04': ['wait', '⚠️ 아직 못 가져감'], '05': ['wait', '취소됨 ✕'] };
// 회수(교환/반품)용 — 기사님이 고객 집으로 가는 방향
const RET_STUS = { '00': ['processing', '회수 준비중'], '01': ['processing', '기사님 방문 예정'], '02': ['processing', '기사님 방문 예정'], '03': ['done', '물건 가져옴 ✓'], '04': ['wait', '⚠️ 아직 못 가져옴'], '05': ['wait', '취소됨 ✕'] };
function renderEpost() {
  const items = [
    ...DB.orders.filter(x => x.epost).map(x => ({ kind: 'order', icon: '🛒', x })),
    ...DB.seeding.filter(x => x.epost).map(x => ({ kind: 'seeding', icon: '🎁', x }))
  ].sort((a, b) => {
    // 인쇄 안 한 것 먼저, 그 다음 최신순
    const ap = a.x.epost.label && !a.x.printed ? 0 : 1;
    const bp = b.x.epost.label && !b.x.printed ? 0 : 1;
    return ap - bp || (b.x.sentDate || '').localeCompare(a.x.sentDate || '');
  });
  const parcels = shipmentGroups(items, entry => entry.x);
  const rows = parcels.map(group => {
    const { kind, x } = group[0];
    const kinds = [...new Set(group.map(entry => entry.kind === 'seeding' ? '🎁 시딩' : '🛒 주문'))].join('<br>');
    const products = group.map(entry => `<div>${productParts(entry.x).name}</div>`).join('');
    const options = group.map(entry => `<div>${productParts(entry.x).opt || '<span class="muted">-</span>'}</div>`).join('');
    const [cls, nm] = x.delivered ? ['done', '배달완료 ✓✓'] : (EPOST_STUS[x.epost.stus] || ['processing', '확인 필요']);
    const cancelable = !x.delivered && ['00', '01', '02'].includes(x.epost.stus || '01');
    return `
    <tr>
      <td style="white-space:nowrap">${kinds}</td>
      <td><b>${esc(x.name)}</b></td>
      <td style="min-width:220px;max-width:440px">${products}</td>
      <td>${options}</td>
      <td style="max-width:150px">${x.invoice ? invoiceCell(x.invoice) : '<span class="muted">-</span>'}</td>
      <td><span class="chip ${cls}">${nm}</span></td>
      <td style="white-space:nowrap">${esc(x.sentDate || '')}</td>
      <td style="white-space:nowrap">
        ${x.epost.label
          ? (x.printed
            ? `<span class="chip done" style="font-size:0.85rem">🖨 인쇄함 ✓</span> <button class="link-btn" style="font-size:0.9rem" onclick="printLabels('${kind}:${x.id}')">다시 인쇄</button>`
            : `<button class="link-btn" style="font-weight:800" onclick="printLabels('${kind}:${x.id}')">🖨 운송장 인쇄</button>`)
          : `<button class="link-btn" onclick="epostSitePrint()" title="이 건은 우체국 사이트에서 출력">🖨 사이트에서</button>`}
        ${cancelable ? `<button class="link-btn" style="color:var(--red)" onclick="epostCancel('${kind}',${x.id},'${jsq(x.name)}')">취소</button>` : ''}
      </td>
    </tr>`;
  }).join('');
  const needP = parcels.filter(group => group[0].x.epost.label && group.some(entry => !entry.x.printed)).map(group => group[0].kind + ':' + group[0].x.id);
  const printable = parcels.filter(group => group[0].x.epost.label).map(group => group[0].kind + ':' + group[0].x.id);
  main().innerHTML = `
    <h1>📦 우체국 접수</h1>
    <div class="sub">앱에서 우체국에 접수한 택배들이에요. 순서: <b>① 접수</b> → <b>② [🖨 인쇄]로 운송장 출력</b> → <b>③ 상자에 붙이면 기사님이 수거</b></div>
    <div style="display:flex; gap:0.8rem; flex-wrap:wrap; margin-bottom:1.2rem">
      <button class="big-btn" onclick="epostRefresh()">🔄 진행상태 새로고침</button>
      ${needP.length ? `<button class="big-btn green" onclick="printLabels('${needP.join(',')}')">🖨 안 뽑은 운송장 ${needP.length}장 인쇄</button>` : ''}
      ${printable.length && printable.length !== needP.length ? `<button class="big-btn gray" onclick="printLabels('${printable.join(',')}')">전체 다시 인쇄 (${printable.length}장)</button>` : ''}
      <button class="big-btn gray" onclick="epostSitePrint()">🖨 우체국 사이트에서 출력 (오즈뷰어)</button>
    </div>
    <div class="card">
      ${parcels.length ? `
      <div class="table-wrap" style="max-height:65vh">
        <table>
          <thead><tr><th>구분</th><th>이름</th><th>제품</th><th>옵션</th><th>송장번호</th><th>진행상태</th><th>접수일</th><th>인쇄·취소</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="hint" style="margin-top:0.8rem">· 운송장은 <b>[🖨 운송장 인쇄]</b>로 라벨기에서 바로 뽑는 게 기본이에요<br>· 우체국 사이트(오즈뷰어)로 뽑으려면: <b>[🖨 우체국 사이트에서 출력]</b> → 로그인 → <b>계약소포 → 신청정보등록 → [라벨인쇄]</b> — 앱에서 접수한 건들이 거기 목록에 그대로 떠 있어요<br>· <b>[취소]</b>는 기사님이 가져가기 전까지 할 수 있어요 — 취소 버튼이 보이면 아직 가능해요. 취소하면 [보내기] 목록으로 돌아갑니다</div>
      ` : `<div class="hint" style="font-size:1.1rem">아직 앱에서 우체국에 접수한 건이 없어요.<br>[📮 보내기]에서 <b>[🚀 우체국 바로 접수]</b>를 누르면 여기에 나타납니다.</div>`}
    </div>
    <div id="epost-page-result"></div>`;
}
// 우체국 사이트(오즈뷰어)로 출력: 사이트를 열고, 앱 화면에 따라할 순서를 크게 보여줌
function epostSitePrint() {
  window.open('https://biz.epost.go.kr', '_blank');
  const box = $('#epost-page-result');
  if (box) {
    box.innerHTML = `<div class="result-box warn" style="font-weight:400; line-height:1.9">
      <div class="big">🖨 우체국 사이트에서 운송장 출력 — 이 순서대로 하세요</div>
      ① 방금 열린 우체국 화면에서 <b>로그인</b> (아이디: <b>${esc(DB.settings.epostMemberId || '')}</b>)<br>
      ② 위쪽 메뉴에서 <b>[계약소포]</b> 클릭<br>
      ③ 왼쪽 메뉴에서 <b>[소포신청] → [신청정보등록]</b> 클릭<br>
      ④ 오늘 날짜로 <b>[조회]</b> — 앱에서 접수한 건들이 목록에 보여요<br>
      ⑤ 출력할 건에 <b>체크</b> → <b>[라벨인쇄]</b> 버튼 클릭<br>
      ⑥ 오즈뷰어 창이 뜨면 <b>[인쇄]</b> — 끝!<br>
      <span class="muted" style="font-size:0.95rem">화면이 다르거나 막히면 우체국 고객센터 ☎ 1588-1300</span>
    </div>`;
    box.scrollIntoView({ behavior: 'smooth' });
  }
}
function printLabels(sel) {
  window.open('/label.html?print=1&sel=' + encodeURIComponent(sel), '_blank');
  // 인쇄 창을 연 순간 "인쇄함 ✓" 표시 (필요하면 언제든 [다시 인쇄] 가능)
  for (const part of String(sel).split(',')) {
    const [kind, id] = part.split(':');
    const list = kind === 'seeding' ? DB.seeding : DB.orders;
    const x = list.find(i => i.id === Number(id));
    if (x) {
      const key = shipmentKey(x);
      for (const item of [...DB.orders, ...DB.seeding]) {
        if (shipmentKey(item) === key) item.printed = true;
      }
    }
  }
  saveDb().then(() => render());
}
// 인쇄가 필요한(접수됐는데 아직 안 뽑은) 건 수
function needPrintList() {
  const items = [
    ...DB.orders.filter(x => x.status === '발송완료' && x.epost && x.epost.label && !x.printed && !['03', '05'].includes(x.epost.stus)).map(x => ({ kind: 'order', x })),
    ...DB.seeding.filter(x => x.status === '발송완료' && x.epost && x.epost.label && !x.printed && !['03', '05'].includes(x.epost.stus)).map(x => ({ kind: 'seeding', x }))
  ];
  return shipmentGroups(items, entry => entry.x).map(group => group[0]);
}
function updateNavBadge() {
  const n = DB ? needPrintList().length : 0;
  const btn = document.querySelector('nav button[data-page="epost"]');
  if (!btn) return;
  let b = btn.querySelector('.nav-badge');
  if (n > 0) {
    if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; btn.appendChild(b); }
    b.textContent = n;
  } else if (b) b.remove();
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
    const stusNm = x.epost && x.epost.stus ? (RET_STUS[x.epost.stus] || [])[1] || '' : '';
    let btns = '';
    if (x.status === '대기') {
      btns = (epostOn ? `<button class="link-btn" onclick="returnPickup(${x.id},'${jsq(x.name)}')">🚚 우체국 회수 신청</button>` : '<span class="muted" style="font-size:0.85rem">우체국 연결 필요</span>') +
        ` <button class="link-btn" style="color:var(--red)" onclick="returnCancel(${x.id},'delete','${jsq(x.name)}')">🗑 지우기</button>`;
    } else if (x.status === '회수중') {
      btns = `<button class="link-btn" onclick="returnComplete(${x.id},'${esc(x.name)}','${jsq(x.kind)}')">📦 물건 도착 확인</button>
        <button class="link-btn" style="color:var(--red)" onclick="returnCancel(${x.id},'pickup','${jsq(x.name)}')">회수 취소</button>`;
    } else if (x.status === '취소됨') {
      btns = `<button class="link-btn" onclick="returnReopen(${x.id},'${jsq(x.name)}')">↩️ 다시 신청하기</button>
        <button class="link-btn" style="color:var(--red)" onclick="returnCancel(${x.id},'delete','${jsq(x.name)}')">🗑 지우기</button>`;
    } else {
      btns = `<button class="link-btn" onclick="returnCancel(${x.id},'delete','${jsq(x.name)}')">🗑 지우기</button>`;
    }
    return `
    <tr>
      <td style="white-space:nowrap">${x.kind === '교환' ? '🔄 교환' : '↩️ 반품'}<br><span class="muted" style="font-size:0.78rem">${esc(x.rmaNo || 'RMA-' + x.id)}</span>${x.sourceChannel === 'cafe24' || x._src === 'c24' ? '<br><span class="note-badge">카페24 신청</span>' : ''}</td>
      <td><b>${esc(x.name)}</b><br><span class="muted" style="font-size:0.85rem">${esc(x.phone)}</span></td>
      <td style="min-width:200px;max-width:420px">${productParts(x).name}${x.kind === '교환' && x.exchangeProduct ? `<div class="muted" style="font-size:0.85rem">→ 교환으로 보낼 것: ${esc(x.exchangeProduct)}</div>` : ''}</td>
      <td>${productParts(x).opt || '<span class="muted">-</span>'}</td>
      <td style="max-width:280px">${esc(x.reason || '')}</td>
      <td style="max-width:150px">${x.invoice ? invoiceCell(x.invoice) : '<span class="muted">-</span>'}${stusNm ? `<span class="muted" style="font-size:0.85rem">${stusNm}</span>` : ''}</td>
      <td><span class="chip ${cls}">${nm}</span></td>
      <td style="white-space:nowrap"><div class="btn-col">${btns}</div></td>
    </tr>`;
  }).join('');
  main().innerHTML = `
    <h1>🔁 교환/반품</h1>
    <div class="sub">카페24에서 고객이 교환·반품을 신청하면 <b>여기 자동으로 떠요</b> (5분마다 확인). 직접 등록할 땐 보낸 것 중에서 고르면 돼요.<br>흐름: <b>① 등록/자동감지</b> → <b>② 우체국 회수 신청</b> (기사님이 고객 집 방문) → <b>③ 물건 도착 확인</b> (재고 복귀 + 교환이면 재발송 준비)</div>
    <div style="display:flex; gap:0.8rem; flex-wrap:wrap; margin-bottom:1.2rem">
      <button class="big-btn green" onclick="returnForm()">➕ 교환/반품 등록</button>
      <button class="big-btn" onclick="epostRefresh()">🔄 회수 진행상태 새로고침</button>
    </div>
    <div id="ret-form"></div>
    <div id="ret-result"></div>
    <div class="card">
      ${items.length ? `
      ${items.some(x => x.status === '대기' || x.status === '회수중') ? '' : '<div class="hint" style="font-size:1.05rem"><b>지금 처리할 일은 없어요.</b> 아래는 지난 기록이에요.</div>'}
      <div class="table-wrap" style="max-height:65vh">
        <table>
          <thead><tr><th>구분</th><th>고객</th><th>제품</th><th>옵션</th><th>사유</th><th>회수 송장</th><th>상태</th><th>처리</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="hint" style="margin-top:0.8rem">· <b>회수 신청</b>을 하면 집배원이 운송장을 갖고 고객 집에 방문해요 (별도 출력 필요 없음)<br>· 물건이 도착하면 <b>[📦 물건 도착 확인]</b> — 재고가 다시 채워지고, 교환 건은 [📮 보내기]에 재발송 건이 생겨요<br>· 카페24 주문 건은 카페24 관리자에서도 교환/반품 상태를 처리해 주세요</div>
      ` : `<div class="hint" style="font-size:1.1rem">진행 중인 교환/반품이 없어요.<br>고객이 교환·반품을 원하면 위의 <b>[➕ 교환/반품 등록]</b>을 누르거나,<br>[🚚 배송 확인]에서 해당 건의 <b>[🔁 교환/반품]</b> 버튼을 누르세요.</div>`}
    </div>`;
}
function returnForm(pre) {
  pre = pre || {};
  window._returnSource = {
    sourceType: pre.sourceType || '', sourceId: pre.sourceId || null,
    originalOrderNo: pre.originalOrderNo || '', sku: pre.sku || '', sourceChannel: pre.sourceChannel || ''
  };
  const box = $('#ret-form');
  if (!box) return;
  const shipped = [
    ...DB.orders.filter(x => x.status === '발송완료').map(x => ({ kind: 'orders', x })),
    ...DB.seeding.filter(x => x.status === '발송완료').map(x => ({ kind: 'seeding', x }))
  ].sort((a, b) => (b.x.sentDate || '').localeCompare(a.x.sentDate || '')).slice(0, 80);
  const pickOpts = shipped.map(({ kind, x }) =>
    `<option value="${kind}:${x.id}">${esc(x.name)} — ${esc(String(x.product || '').slice(0, 40))} (${esc(x.sentDate || '날짜없음')})</option>`).join('');
  box.innerHTML = `
    <div class="card">
      <div class="step-title">➕ 교환/반품 등록</div>
      <div class="form-row"><label>📦 보낸 것에서 고르기 — 고르면 아래 칸이 저절로 채워져요</label>
        <select id="ret-pick" onchange="retPick(this.value)">
          <option value="">(직접 입력할래요)</option>
          ${pickOpts}
        </select>
      </div>
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
    sourceId: window._returnSource && window._returnSource.sourceId,
    originalOrderNo: window._returnSource && window._returnSource.originalOrderNo,
    sku: window._returnSource && window._returnSource.sku,
    sourceChannel: window._returnSource && window._returnSource.sourceChannel,
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
// 폼의 "보낸 것에서 고르기" 선택 시 칸 자동 채움
function retPick(v) {
  if (!v) return;
  const [kind, id] = v.split(':');
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const x = list.find(i => i.id === Number(id));
  if (!x) return;
  window._returnSource = {
    sourceType: kind, sourceId: x.id, originalOrderNo: x.orderNo || '',
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
  if (!confirm(`${name}님 건을 보내지 않기로 할까요?\n\n· 보내기 목록에서 빠져요\n· [🚚 배송 확인]에서 [다시 보내기]로 언제든 되돌릴 수 있어요`)) return;
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const x = list.find(i => i.id === id);
  if (!x) return;
  x.status = '취소됨';
  x.manualCanceled = true; // 자동 동기화가 되살리지 않게 표시
  await saveDb();
  render();
  toast('✔️ 취소했어요. 마음이 바뀌면 [배송 확인]에서 [다시 보내기]를 누르세요.', 6000);
}
async function restoreSend(kind, id, name) {
  const list = kind === 'seeding' ? DB.seeding : DB.orders;
  const x = list.find(i => i.id === id);
  if (!x) return;
  x.status = '대기';
  x.manualCanceled = false;
  await saveDb();
  render();
  toast(`✔️ ${name}님 건을 [보내기] 목록으로 되돌렸어요.`, 5000);
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
  toast('✔️ 배달 끝으로 표시했어요.');
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
  if (r.error) { toast('⚠️ ' + r.error, 8000); return; }
  adoptDb(r.db);
  render();
  const box = $('#ret-result');
  if (box) box.innerHTML = `<div class="result-box ok"><div class="big">✅ 회수 신청 완료!</div>
    ${esc(name)}님 집으로 기사님이 갈 거예요.<br>회수 송장번호: <b>${esc(r.regiNo || '')}</b>${r.price ? ' (요금 ' + esc(r.price) + '원)' : ''}<br>
    <span style="font-weight:400">진행상황은 이 화면의 [🔄 회수 진행상태 새로고침]으로 확인해요.</span></div>`;
  toast('✔️ 회수 신청 완료!', 5000);
}
async function returnComplete(id, name, kind) {
  const extra = kind === '교환' ? '\n· 교환이라서 [📮 보내기]에 재발송 건이 새로 생겨요' : '';
  const sellable = confirm(`${name}님의 회수품을 검수해 주세요.\n\n정상 상품으로 다시 판매할 수 있나요?\n\n[확인] 정상 — 재고에 다시 넣기\n[취소] 불량/오염 — 재고에서 제외`);
  if (!sellable && !confirm(`불량/오염으로 처리할까요?\n\n· 재고에는 다시 넣지 않습니다${extra}`)) return;
  busy(true, '처리하는 중…');
  const r = await api('/api/return/complete', { method: 'POST', body: JSON.stringify({ id, restock: sellable, inspection: sellable ? 'sellable' : 'damaged' }) });
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
  const q = scope === 'delete'
    ? `${name}님의 교환/반품 기록을 완전히 지울까요?\n\n· 한 번 지우면 되돌릴 수 없어요\n· 기록만 남겨두려면 [취소]를 누르세요`
    : `${name}님의 우체국 회수 신청을 취소할까요?\n(건은 남아 있어서 다시 신청할 수 있어요)`;
  if (!confirm(q)) return;
  busy(true, '처리하는 중…');
  const r = await api('/api/return/cancel', { method: 'POST', body: JSON.stringify({ id, scope }) });
  busy(false);
  if (r.error) { toast('⚠️ ' + r.error, 8000); return; }
  adoptDb(r.db);
  render();
  toast('✔️ 처리했어요.', 4000);
}
// 우체국 쪽에서 취소된(또는 앱에서 취소한) 회수 건을 다시 신청 가능 상태로
async function returnReopen(id, name) {
  if (!confirm(`${name}님 건을 다시 [회수 신청 전] 상태로 되돌릴까요?`)) return;
  const ret = (DB.returns || []).find(x => x.id === id);
  if (!ret) return;
  ret.status = '대기';
  ret.invoice = '';
  delete ret.epost;
  await saveDb();
  render();
  toast('✔️ 되돌렸어요. [🚚 우체국 회수 신청]을 다시 누르면 됩니다.', 6000);
}

// ---------- 배송 확인 ----------
function renderShipping() {
  const all = [
    ...DB.orders.map(x => Object.assign({ _kind: '주문' }, x)),
    ...DB.seeding.map(x => Object.assign({ _kind: '시딩' }, x))
  ].sort((a, b) => (b.sentDate || b.regDate || '').localeCompare(a.sentDate || a.regDate || ''));
  // 단계 필터 (홈 타일에서 넘어오면 그 단계만)
  const f = window._shipFilter || 'all';
  const byF = x =>
    f === 'pending' ? (x.status === '대기' || x.status === '접수중') :
    f === 'moving' ? (x.status === '발송완료' && !x.delivered) :
    f === 'done' ? (x.status === '발송완료' && !!x.delivered) :
    f === 'canceled' ? x.status === '취소됨' : true;
  const cnt = k => shipmentCount(all.filter(x => (k === 'all' ? true : (
    k === 'pending' ? (x.status === '대기' || x.status === '접수중') :
    k === 'moving' ? (x.status === '발송완료' && !x.delivered) :
    k === 'done' ? (x.status === '발송완료' && !!x.delivered) : x.status === '취소됨'))));
  const TABS = [['all', '전체'], ['pending', '보낼 준비'], ['moving', '가는 중'], ['done', '배달 끝'], ['canceled', '취소됨']];
  const tabs = TABS.map(([k, nm]) =>
    `<button class="big-btn ${f === k ? '' : 'gray'}" style="font-size:1rem;padding:0.5rem 1rem" onclick="go('shipping','${k}')">${nm} ${cnt(k)}</button>`).join('');
  const base = all.filter(byF);
  const q = (window._shipQ || '').trim();
  const filtered = q ? base.filter(x => (x.name + x.phone + (x.invoice || '') + (x.product || '')).includes(q)) : base;
  const cutNote = filtered.length > 200 ? `<div class="hint" style="margin-top:0.6rem">최근 200건만 보여줘요. 더 찾으려면 위 검색창에 이름이나 송장번호를 넣어 주세요.</div>` : '';
  const emptyMsg = q
    ? `'${esc(q)}'(으)로 찾은 것이 없어요. <button class="link-btn" onclick="window._shipQ='';renderShipping()">🔄 전체 보기</button>`
    : f !== 'all'
      ? `이 단계에는 지금 아무것도 없어요. <button class="link-btn" onclick="go('shipping','all')">전체 보기</button>`
      : `아직 보낸 택배가 없어요.<br><button class="link-btn" onclick="go('send')">📮 보내기에서 첫 택배를 접수해 보세요</button>`;
  const rows = filtered.slice(0, 200).map(x => {
    const pp = productParts(x);
    return `
    <tr>
      <td style="white-space:nowrap">${shipmentSourceLabel(x)}</td>
      <td style="white-space:nowrap">${esc(x.sentDate || '')}</td>
      <td><b>${esc(x.name)}</b></td>
      <td style="min-width:240px;max-width:480px">${pp.name}</td>
      <td>${pp.opt || '<span class="muted">-</span>'}</td>
      <td>${chip(x.delivered ? '배달완료' : x.status)}${!x.delivered && x.status === '발송완료' && x.deliveryCheckStatus === '확인필요' ? '<br><span class="note-badge">택배사 확인 필요</span>' : ''}</td>
      <td style="max-width:150px">${invoiceCell(x.invoice, x.courier)}</td>
      <td style="white-space:nowrap"><div class="btn-col">${x.status === '발송완료'
        ? `<button class="link-btn" onclick="returnFormFrom('${x._kind === '시딩' ? 'seeding' : 'orders'}',${x.id})">🔁 교환/반품</button>${!x.delivered ? `<button class="link-btn" style="font-size:0.9rem" onclick="markDelivered('${x._kind === '시딩' ? 'seeding' : 'orders'}',${x.id},'${jsq(x.name)}')">✔ 배달 끝 처리</button>` : ''}`
        : x.status === '취소됨' ? `<button class="link-btn" onclick="restoreSend('${x._kind === '시딩' ? 'seeding' : 'orders'}',${x.id},'${jsq(x.name)}')">↩️ 다시 보내기</button>` : ''}</div></td>
    </tr>`;
  }).join('');
  main().innerHTML = `
    <h1>🚚 배송 확인</h1>
    <div class="sub">택배 <b>전체 내역</b>이에요 (보낼 것 · 보낸 것 · 취소한 것 모두). <b>[배송조회 🔍]</b>를 누르면 지금 어디까지 갔는지 볼 수 있어요.</div>
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem">${tabs}</div>
    <input class="search-input" placeholder="🔍 이름이나 송장번호로 찾기" value="${esc(q)}"
      oninput="window._shipQ=this.value; renderShipping(); this.focus(); this.setSelectionRange(this.value.length,this.value.length)">
    <div class="card">
      <div class="table-wrap" style="max-height:70vh">
        <table>
          <thead><tr><th>구분</th><th>보낸 날</th><th>이름</th><th>제품</th><th>옵션</th><th>상태</th><th>송장번호</th><th>교환/반품</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="8" class="muted" style="font-size:1.05rem;padding:1.5rem">${emptyMsg}</td></tr>`}</tbody>
        </table>
      </div>
      ${cutNote}
    </div>`;
  injectHelp();
}

// ---------- 재고 ----------
function renderInventory() {
  const q = (window._invQ || '').trim();
  const filter = window._invFilter || 'all'; // all | low | zero
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
  const totalQty = [...allGroups.values()].reduce((sum, g) => sum + groupTotal(g), 0);
  const zeroN = activeInventory.filter(i => !i.needsCount && !i.needsAllocation && Number(i.qty) === 0).length;
  const lowN = activeInventory.filter(i => !i.needsCount && !i.needsAllocation && i.qty > 0 && i.qty <= 2).length;
  const unknownN = activeInventory.filter(i => i.needsCount || i.needsAllocation).length;
  const prodN = allGroups.size;
  let items = q ? activeInventory.filter(i => (i.name + ' ' + (i.color || '') + ' ' + (i.size || '')).includes(q)) : activeInventory;
  if (filter === 'zero') items = items.filter(i => !i.needsCount && !i.needsAllocation && Number(i.qty) === 0);
  if (filter === 'low') items = items.filter(i => !i.needsCount && !i.needsAllocation && i.qty > 0 && i.qty <= 2);
  if (filter === 'unknown') items = items.filter(i => i.needsCount || i.needsAllocation);
  const findP = i => (DB.products || []).find(p => p.no === i.productNo) ||
    (DB.products || []).find(p => lettersOnly(p.name) === lettersOnly(i.name));
  const gmap = new Map();
  const groups = [];
  for (const i of items) {
    const k = invParts(i).name;
    if (!gmap.has(k)) { gmap.set(k, []); groups.push(gmap.get(k)); }
    gmap.get(k).push(i);
  }
  const stChip = i => i.needsAllocation
    ? `<span class="chip processing">${i.allocationTotal != null ? `배분 ${i.allocationTotal}/${i.allocationExpected}개` : '옵션별 배분 필요'}</span>`
    : i.needsCount ? '<span class="chip processing">수량 입력 필요</span>'
    : i.qty < 0 ? `<span class="chip wait">재고 ${Math.abs(i.qty)}개 부족</span>`
    : i.qty === 0 ? '<span class="chip wait">품절</span>'
    : i.qty <= 2 ? '<span class="chip processing">부족</span>'
    : '<span class="chip done">정상</span>';
  const rows = groups.map(g => {
    const sum = groupTotal(g);
    return g.map((i, idx) => {
      const p = findP(i);
      const display = invParts(i);
      const prodCell = idx === 0 ? `
      <td rowspan="${g.length}" ${g.length > 1 ? 'style="border-top:3px solid #dfe4ee"' : ''}>
        <div class="inv-prod">
          ${p && p.img ? prodImgTag(p.img).replace('class="pimg"', 'class="pimg inv-img"') : ''}
          <div>
            <div class="pname">${p ? `<span class="pname-link" onclick="window.open('${saleUrl(p.no)}','_blank')" title="판매 페이지 열기">${esc(display.name)}</span>` : esc(display.name)}</div>
            <div class="popt">전체 아소트 · 총 <b class="${sum === 0 ? 'inv-zero' : ''}">${sum}개</b></div>
          </div>
        </div>
      </td>` : '';
      return `
    <tr class="${idx === 0 ? 'g-start' : ''}">
      ${prodCell}
      <td class="color">${esc(display.color) || '<span class="muted">-</span>'}</td>
      <td class="sz">${esc(i.size) || '<span class="muted" style="font-weight:400">-</span>'}</td>
      <td class="sku">${esc(i.sku || '') || '<span class="muted">자동 생성 전</span>'}</td>
      <td class="qcell">
        <button class="qty-btn sm" onclick="invAdj(${i.id},-1)">−</button>
        <span class="qty ${i.needsCount || i.qty <= 2 ? 'low' : ''}">${i.needsCount ? '?' : i.qty}</span>
        <button class="qty-btn sm" onclick="invAdj(${i.id},1)">＋</button>
      </td>
      <td style="text-align:center;width:5rem">${stChip(i)}</td>
      <td class="acts">
        ${!i.size ? `<button class="del-btn" title="사이즈별 줄로 나누기 (예: S/M/L)" onclick="invSplit(${i.id})">📐</button>` : ''}
        <button class="del-btn" title="지우기" onclick="invDel(${i.id})">🗑️</button>
      </td>
    </tr>`;
    }).join('');
  }).join('');
  const ftab = (key, label) => `<button class="big-btn ${filter === key ? '' : 'gray'}" style="padding:0.45rem 1rem;font-size:0.95rem" onclick="window._invFilter='${key}';renderInventory()">${label}</button>`;
  main().innerHTML = `
    <h1>📋 재고</h1>
    <div class="sub">남은 옷 개수예요. 옷을 보내면 <b>−</b>, 새로 들어오면 <b>＋</b>를 눌러요.</div>
    <div class="inv-stats">
      <div class="stat"><div class="n">${prodN}</div><div class="l">제품 종류</div></div>
      <div class="stat"><div class="n" style="color:var(--blue)">${totalQty}</div><div class="l">현재 재고 (개)</div></div>
      <div class="stat ${lowN ? 'warn' : ''}"><div class="n" style="color:var(--orange)">${lowN}</div><div class="l">부족 (1~2개)</div></div>
      <div class="stat ${zeroN ? 'bad' : ''}"><div class="n" style="color:var(--red)">${zeroN}</div><div class="l">품절 (0개)</div></div>
      <div class="stat ${unknownN ? 'warn' : ''}"><div class="n" style="color:var(--orange)">${unknownN}</div><div class="l">수량 확인 필요</div></div>
    </div>
    <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center; margin-bottom:0.8rem">
      ${ftab('all', '전체')} ${ftab('low', '⚠️ 부족만')} ${ftab('zero', '🚫 품절만')} ${ftab('unknown', '🔎 수량 확인')}
      <input class="search-input" style="flex:1;min-width:200px;margin:0" placeholder="🔍 제품 이름으로 찾기" value="${esc(q)}"
        oninput="window._invQ=this.value; renderInventory(); this.focus(); this.setSelectionRange(this.value.length,this.value.length)">
    </div>
    <div style="margin-bottom:1rem; display:flex; gap:0.8rem; flex-wrap:wrap">
      <button class="big-btn" onclick="invAddForm()">➕ 새 제품 넣기</button>
      <button class="big-btn" style="background:#5a6478" onclick="renderStockLog()">📜 입출고 내역</button>
      ${DB.products && DB.products.length ? `<button class="big-btn orange" onclick="invImportProducts()">📥 카페24 제품 전부 불러오기</button>` : ''}
    </div>
    <div id="inv-form"></div>
    ${rows ? `
    <div class="table-wrap inv-table-wrap" style="max-height:68vh">
      <table class="inv-table">
        <colgroup><col class="col-product"><col class="col-color"><col class="col-size"><col class="col-sku"><col class="col-qty"><col class="col-status"><col class="col-action"></colgroup>
        <thead><tr><th>상품명</th><th>컬러</th><th style="text-align:center">사이즈</th><th>SKU</th><th style="text-align:center">현재 재고</th><th style="text-align:center">상태</th><th style="text-align:center">관리</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>` : `<div class="muted" style="font-size:1.1rem">${filter !== 'all' ? '이 조건에 맞는 제품이 없어요. ' : q ? `'${esc(q)}'(으)로 찾은 제품이 없어요. ` : '아직 등록된 제품이 없어요. '}<button class="link-btn" onclick="window._invQ='';window._invFilter='all';renderInventory()">🔄 전체 보기</button></div>`}`;
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
  renderInventory();
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

// ── 입출고 내역 ──
const STOCK_REASON = {
  '출고': ['📤', '#c0392b'], '입고 (직접)': ['📥', '#1e7e46'], '차감 (직접)': ['✏️', '#8a6d1a'],
  '접수 취소 복구': ['↩️', '#1e7e46'], '반품 입고': ['📥', '#1e7e46'], '교환 회수 입고': ['🔄', '#1e7e46']
};
async function renderStockLog() {
  const r = await api('/api/master/stocklog');
  const log = (r && r.log) || [];
  const byDate = new Map();
  for (const e of log) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const groups = [...byDate.entries()].map(([date, rows]) => {
    const outN = rows.filter(x => x.delta < 0).reduce((s, x) => s - x.delta, 0);
    const inN = rows.filter(x => x.delta > 0).reduce((s, x) => s + x.delta, 0);
    const lines = rows.map(e => {
      const [icon, color] = STOCK_REASON[e.reason] || ['•', '#555'];
      const prod = esc(e.name) + (e.size ? ` <b>${esc(e.size)}</b>` : '') + (e.color ? ` <span class="muted">${esc(e.color)}</span>` : '');
      return `<tr>
        <td style="white-space:nowrap">${icon} ${esc(e.reason)}</td>
        <td>${prod}</td>
        <td style="text-align:center;font-weight:800;color:${e.delta < 0 ? '#c0392b' : '#1e7e46'}">${e.delta > 0 ? '+' : ''}${e.delta}</td>
        <td style="text-align:center">${e.left}</td>
        <td>${e.ref ? esc(e.ref) + '님' : '<span class="muted">-</span>'}</td>
        <td class="muted" style="white-space:nowrap">${new Date(e.ts).toTimeString().slice(0, 5)}</td>
      </tr>`;
    }).join('');
    return `
    <div class="card">
      <div class="step-title">📅 ${date} <span class="muted" style="font-weight:400;font-size:0.95rem">— 출고 ${outN}개 · 입고 ${inN}개</span></div>
      <div style="overflow-x:auto"><table>
        <tr><th>구분</th><th>제품</th><th>변동</th><th>남음</th><th>누구</th><th>시각</th></tr>
        ${lines}
      </table></div>
    </div>`;
  }).join('');
  main().innerHTML = `
    <h1>📜 입출고 내역</h1>
    <div class="sub">재고가 바뀔 때마다 자동으로 적히는 장부예요. 옷을 보내면 <b style="color:#c0392b">출고 −</b>, ＋버튼·반품 도착은 <b style="color:#1e7e46">입고 +</b>.</div>
    <div style="margin-bottom:1rem"><button class="big-btn gray" onclick="go('inventory')">← 재고로 돌아가기</button></div>
    ${groups || '<div class="card"><div class="muted" style="font-size:1.1rem">아직 기록이 없어요. 이제부터 재고가 바뀔 때마다 여기에 쌓여요.</div></div>'}`;
  injectHelp();
}
async function invDel(id) {
  const item = DB.inventory.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`"${item.name}"을(를) 재고 목록에서 지울까요?\n(지운 제품은 자동 등록에서도 빠져요)`)) return;
  DB.inventory = DB.inventory.filter(i => i.id !== id);
  if (item.productNo) (DB.inventoryHidden = DB.inventoryHidden || []).push(item.productNo); // 자동 재등록 방지
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

// ---------- 동작: 불러오기 / 내보내기 / 업로드 ----------
async function doSync() {
  busy(true, '새 주문과 시딩을 가져오는 중…');
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
  const parcelCount = selectedShipmentCount(selected);
  if (!confirm(`택배 ${parcelCount}건짜리 우체국 엑셀 파일을 만들까요?\n\n· 목록이 [엑셀 접수 중]으로 바뀌어요 (잘못 눌렀으면 [↩️ 엑셀 접수 취소]로 되돌려요)\n· 파일 폴더와 우체국 사이트가 자동으로 열려요`)) return;
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
  const sendable = x => x.status !== '발송완료' && x.status !== '취소됨' && x.status !== '접수중' && x._sel !== false;
  const selected = [
    ...DB.orders.filter(sendable).map(x => ({ type: 'order', id: x.id })),
    ...DB.seeding.filter(sendable).map(x => ({ type: 'seeding', id: x.id }))
  ];
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

// ---------- 알림 (새 주문/교환반품 · 출고 마감) ----------
function notify(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      new Notification(title, { body });
    }
  } catch (e) { /* 알림 미지원 */ }
}
async function enableNotify() {
  if (!('Notification' in window)) { toast('이 브라우저는 알림을 지원하지 않아요.'); return; }
  const p = await Notification.requestPermission();
  toast(p === 'granted'
    ? '✔️ 알림을 켰어요! 창을 안 보고 있어도 새 주문이 오면 알려드릴게요.'
    : '알림이 허용되지 않았어요. 주소창 왼쪽 자물쇠 🔒를 눌러 알림을 [허용]으로 바꿔 주세요.', 7000);
  if (PAGE === 'settings') renderSettings();
}
// 출고 마감 1시간 전, 아직 안 보낸 게 있으면 하루 한 번 알림
function deadlineCheck() {
  if (!DB || !DB.settings) return;
  const dl = String(DB.settings.pickupDeadline || '16:00').split(':');
  const dlMin = Number(dl[0]) * 60 + Number(dl[1] || 0);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const pendingN = pendingOf(DB.orders).length + pendingOf(DB.seeding).length;
  const key = 'dlAlert-' + now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
  if (nowMin >= dlMin - 60 && nowMin < dlMin && pendingN > 0 && !localStorage.getItem(key)) {
    localStorage.setItem(key, '1');
    const msg = `⏰ 기사님이 ${Number(dl[0])}시에 오세요! 아직 안 보낸 것이 ${pendingN}건 있어요.`;
    toast(msg, 12000);
    notify('배송 도우미', msg);
  }
}

// ---------- 자동 새로고침 (30초마다 확인) ----------
async function refreshStatus(force) {
  try {
    const r = await api('/api/status');
    SYNC_STATUS = r.status;
    window._VIEW = !!r.viewOnly;
    window._C24OWNER = r.c24Owner !== false;
    if (r.version) { const v = document.getElementById('ver'); if (v) v.textContent = 'v' + r.version + (r.viewOnly ? ' · 👁 보기 모드' : ''); }
    if (force || (DB && r.rev !== DB.rev)) {
      const before = DB ? pendingOf(DB.seeding).length + pendingOf(DB.orders).length : 0;
      const retBefore = DB ? (DB.returns || []).filter(x => x.status === '대기').length : 0;
      adoptDb(await api('/api/db'));
      const after = pendingOf(DB.seeding).length + pendingOf(DB.orders).length;
      const retAfter = (DB.returns || []).filter(x => x.status === '대기').length;
      // 입력 중인 화면(설정, 재고 추가 폼)이나 접수 결과가 떠 있을 땐 건드리지 않음 (송장번호·인쇄 버튼 소실 방지)
      const formOpen = PAGE === 'settings' || document.querySelector('#inv-form input') ||
        document.querySelector('#export-result .result-box') || document.querySelector('#ret-form input');
      if (!formOpen) render();
      if (after > before) {
        toast(`🔔 새로 들어온 것이 ${after - before}건 있어요!`, 6000);
        notify('배송 도우미', `🔔 새 주문·시딩이 ${after - before}건 들어왔어요!`);
      }
      if (retAfter > retBefore) {
        toast(`🔁 교환/반품 신청이 ${retAfter - retBefore}건 들어왔어요!`, 8000);
        notify('배송 도우미', `🔁 교환/반품 신청 ${retAfter - retBefore}건 — 확인해 주세요`);
      }
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
  deadlineCheck();
  setInterval(deadlineCheck, 60 * 1000);
})();
