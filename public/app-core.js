/* 배송 도우미 - 화면 로직 */
let DB = null;
let PAGE = 'home';
let SYNC_STATUS = null;
const $ = sel => document.querySelector(sel);
const main = () => $('#main');
const shipmentLineItems = item => HamItemLines.splitShipmentItems(item);

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
// 파일 내려받기 공통 — 서버가 JSON(에러)로 답하면 그대로 돌려주고, 파일이면 blob 으로 저장한다.
// (location.href 로 받으면 서버가 에러 JSON 을 내려줄 때 빈 창만 뜨고 아무 말도 안 나온다)
async function downloadFile(url, opts, fallbackName) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);   // 무한 대기 방지
  busy(true, '파일을 만드는 중…');
  try {
    const res = await fetch(url, Object.assign({ signal: ctrl.signal }, opts || {}));
    if (String(res.headers.get('content-type') || '').includes('application/json')) return await res.json();
    if (!res.ok) return { error: '파일을 내려받지 못했어요. (' + res.status + ')' };
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = downloadFileName(res) || fallbackName || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
    return { ok: true };
  } catch (e) {
    return { error: e && e.name === 'AbortError'
      ? '시간이 너무 오래 걸려요. 잠시 뒤 다시 시도해 주세요.'
      : '파일을 내려받지 못했어요. 프로그램(검은 창)이 켜져 있는지 확인해 주세요.' };
  } finally {
    clearTimeout(timer);
    busy(false);
  }
}
// Content-Disposition 의 파일명 (한글 파일명은 RFC 5987 filename*)
function downloadFileName(res) {
  const cd = String(res.headers.get('content-disposition') || '');
  const star = cd.match(/filename[*]=UTF-8''([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1]); } catch (e) { /* 깨진 인코딩은 무시 */ } }
  const plain = cd.match(/filename="([^"]+)"/i);
  return plain ? plain[1] : '';
}
async function saveDb() {
  const r = await api('/api/db', { method: 'POST', body: JSON.stringify(DB) });
  if (r && r.conflict) {
    // 그 사이 자동 동기화가 저장함 — 서버 최신본을 받고 사용자에게 다시 하라고 안내
    adoptDb(r.db);
    render();
    toast('새 데이터가 들어와서 겹쳤어요. 방금 한 일을 한 번만 다시 해주세요.', 6000);
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
  if (x.epostOp && ['pending', 'unknown'].includes(x.epostOp.state) && x.epostOp.orderNo) return 'epost-op|' + x.epostOp.orderNo;
  if (x.invoice) return 'invoice|' + String(x.invoice).replace(/\D/g, '') + '|' + shipmentRecipientKey(x);
  const sentKey = HamItemLines.sentShipmentKey(x, shipmentRecipientKey(x));
  if (sentKey) return sentKey;
  if (x.status === '취소됨') return 'canceled|' + String(x.orderNo || x.regDate || x.id || '') + '|' + shipmentRecipientKey(x);
  if (x.packGroupId) return 'pending|pack|' + x.packGroupId;
  if (x.orderNo && x.parcelSplitId) return 'pending|split|' + x.orderNo + '|' + x.parcelSplitId;
  if (x.orderNo) return 'pending|order|' + x.orderNo;
  if (x.returnId) return 'pending|return|' + x.returnId;
  return 'pending|' + (x.sourceChannel || 'direct') + '|' + x.id;
}
function pendingFulfillmentKey(kind, x) {
  if (x.packGroupId) return 'pack|' + x.packGroupId;
  if (kind === 'orders' && x.orderNo && x.parcelSplitId) return 'split|' + x.orderNo + '|' + x.parcelSplitId;
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
function productQuantity(items, itemOf) {
  const pick = itemOf || (x => x);
  let total = 0;
  for (const group of shipmentGroups(items, itemOf)) {
    for (const entry of group) {
      const item = pick(entry);
      total += shipmentLineItems(item).reduce((sum, line) => sum + (Number(line.qty) || 1), 0);
    }
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
  // kind는 새 칩 어휘(warn/processing/done/idle)를 쓴다 — 재고 화면 등이 이미 쓰고 있는
  // .chip.wait(문제/빨강) 의 색 의미를 건드리지 않기 위해 '대기'는 wait 대신 warn으로 매핑한다.
  const map = { '대기': ['warn', '보낼 준비'], '접수중': ['processing', '접수 처리 중'], '발송완료': ['done', '발송 완료'], '배달완료': ['done', '배달 끝'], '취소됨': ['idle', '취소됨'] };
  const [kind, label] = map[status] || ['idle', status];
  return chipEl(kind, label);
}
// ---- 제품 매칭: 자유 텍스트(구글폼)를 카페24 실제 제품(품번+사진)과 연결 ----
function lettersOnly(s) { return String(s || '').toLowerCase().replace(/[^a-z가-힣]/g, ''); }
// 검색: 띄어쓰기로 나눈 낱말이 순서 상관없이 전부 들어 있으면 매칭 (대소문자·기호·공백 무시 — "denim margot", "w01 마고" 같은 중간 키워드도 찾음)
function matchQ(text, q) {
  const norm = v => String(v || '').toLowerCase().replace(/[_#()\[\]\/·.,\-]+/g, ' ');
  const hay = norm(text); const squashed = hay.replace(/\s+/g, '');
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  return tokens.every(t => hay.includes(t) || squashed.includes(t.replace(/\s+/g, '')));
}
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
  return `<img src="${esc(src)}" class="pimg" onmouseenter="imgPrev(event,'${jsq(src)}')" onmousemove="imgPrevMove(event)" onmouseleave="imgPrevHide()" onerror="this.style.display='none'">`;
}
function singleProductParts(x) {
  // 한 제품 = 한 블록(사진 + 이름 + 옵션×수량) — 표 한 칸에 세로로 쌓인다
  const { color, size } = parseOption(x);
  const matches = matchProducts(x.product);
  const qty = Number(x.qty) || 1;
  const qtyTag = qty > 1 ? ` <b class="pqty">×${qty}</b>` : '';
  const block = (img, nameHtml, optParts) => `
    <div class="pline">${img || '<span class="pthumb"></span>'}<div class="pmeta"><div class="pname">${nameHtml}</div><div class="sub">${optParts.length ? esc(optParts.join(', ')) : '-'}${qtyTag}</div></div></div>`;
  if (!matches.length) return { name: block('', esc(x.product), [color, size].filter(Boolean)), opt: '' };
  const single = matches.length === 1;
  const name = matches.map(p => {
    const { base, color: c } = splitColor(p.name);
    const parts = [];
    if (c) parts.push(c);
    if (single && color && (!c || normOpt(color) !== normOpt(c))) parts.push(color);
    if (size) parts.push(size);
    const nameHtml = `<span class="pname-link" onclick="window.open('${saleUrl(p.no)}','_blank')" title="판매 페이지 열기">${esc(base)}</span>`;
    return block(p.img ? prodImgTag(p.img) : '', nameHtml, parts);
  }).join('');
  return { name, opt: '' };
}
function productParts(x) {
  const lines = shipmentLineItems(x);
  if (lines.length <= 1) return singleProductParts(lines[0] || x);
  return { name: lines.map(l => singleProductParts(l).name).join(''), opt: '' };
}
function productCell(x) { return productParts(x).name; }
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
    return `<a class="track-link" target="_blank" href="${url}">배송조회</a><div class="muted" style="font-size:0.8rem">${esc(label)}</div>`;
  }
  return `<span class="muted" style="font-size:0.9rem">${esc(inv)}</span>`;
}
function seedingSourceLabel(x) {
  return /패키지/.test(String(x && x.packType || '')) ? '패키지 시딩' : '시딩';
}
function epostOperationUnresolved(x) {
  return !!(x && x.epostOp && ['pending', 'unknown'].includes(x.epostOp.state));
}
function shipmentMemoHtml(x) {
  const lines = [];
  const productNotes = HamItemLines.shipmentProductNotes(x);
  if (productNotes.length) lines.push(`<div class="ship-note important"><b>포장</b> ${esc(productNotes.join(' / '))}</div>`);
  if (x.note) lines.push(`<div class="ship-note important"><b>비고</b> ${esc(x.note)}</div>`);
  if (x.request) lines.push(`<div class="ship-note"><b>요청</b> ${esc(x.request)}</div>`);
  if (x.msg) lines.push(`<div class="ship-note"><b>배송메모</b> ${esc(x.msg)}</div>`);
  return lines.join('');
}
function shipmentSourceLabel(x) {
  if (x.exchange || x.sourceChannel === 'exchange') return '교환 재발송';
  if (x.sourceChannel === 'seeding' || x._kind === '시딩') return seedingSourceLabel(x);
  if (x.sourceChannel === 'direct') return '직접 등록';
  if (x.sourceChannel === '29cm') return '29CM';
  if (x.sourceChannel === 'musinsa') return '무신사';
  if (x.sourceChannel === 'other') return '기타 채널';
  return '주문';
}
// 구분 칸 아이콘+글자용 정규화 — shipmentSourceLabel과 같은 우선순위지만 GS샵도 구분하고 kind 키까지 같이 준다
function shipmentKindOf(x, isSeeding) {
  if (x.exchange || x.sourceChannel === 'exchange') return { kind: 'exchange', label: '교환 재발송' };
  if (isSeeding || x.sourceChannel === 'seeding' || x._kind === '시딩') return { kind: 'seeding', label: seedingSourceLabel(x) };
  if (x.sourceChannel === 'direct') return { kind: 'direct', label: '직접 등록' };
  if (x.sourceChannel === '29cm') return { kind: '29cm', label: '29CM' };
  if (x.sourceChannel === 'musinsa') return { kind: 'musinsa', label: '무신사' };
  if (x.sourceChannel === 'gsshop') return { kind: 'gsshop', label: 'GS샵' };
  if (x.sourceChannel === 'other') return { kind: 'order', label: '기타 채널' };
  return { kind: 'order', label: '주문' };
}
function kindTag(x, isSeeding) {
  const k = shipmentKindOf(x, isSeeding);
  return `<span class="kind-tag">${kindIcon(k.kind)}${esc(k.label)}</span>`;
}
function externalSyncIssues() {
  const rows = [];
  for (const item of [...(DB.orders || []), ...(DB.seeding || []), ...(DB.returns || [])]) {
    for (const issue of item.syncIssues || []) rows.push({ item, issue });
  }
  return rows;
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
  // 실사 중에는 화면을 다시 그리면 적어둔 숫자가 사라지니 먼저 물어본다
  if (window._invCount) {
    if (!confirm('실사 입력이 사라져요. 나갈까요?')) return;
    window._invCount = false;
  }
  PAGE = page;
  if (page === 'shipping') window._shipFilter = sub || 'all'; // 홈 타일에서 오면 그 단계만 보이게
  if (page === 'epost') window._epostFilter = sub || 'all';
  if (page === 'customers') window._custQ = sub || ''; // 사이드바 전역 검색 → 고객 화면 검색어
  document.querySelectorAll('.side a[data-page]').forEach(a => a.classList.toggle('on', a.dataset.page === page));
  render();
  window.scrollTo(0, 0);
}
function pendingOf(list) { return list.filter(x => x.status === '대기'); }
function processingOf(list) { return list.filter(x => x.status === '접수중'); }

// ---------- 도움말 말풍선 ----------
const HELP = {
  home: `여기는 <b>전체 요약</b> 화면이에요.<br>오늘 할 일 목록은 물건이 지금 어느 단계에 몇 건 있는지 보여줘요. 버튼을 누르면 그 화면으로 이동합니다.<br>아래엔 보낼 준비·수거 기다림·가는 중·이달 배달 끝 숫자와 연결 상태가 있어요.`,
  send: `주문과 시딩은 <b>5분마다 자동으로</b> 들어와요. 직접 입력할 필요 없어요.<br>
① 목록에서 보낼 사람이 맞는지 체크 확인<br>
② <b>[우체국 바로 접수]</b> — 송장번호가 그 자리에서 나와요. 운송장 출력은 [출고]에서<br>
③ 우체국 창구 등 <b>앱 밖에서 이미 보낸 건</b>은 그 줄의 <b>[직접 보냄으로 표시]</b>를 누르면 정리돼요<br>
④ 안 보낼 건은 <b>[보내지 않음]</b> — 마음이 바뀌면 [배송 확인]에서 <b>[다시 보내기]</b>로 되돌려요<br>
⑤ <b>우편번호 없음</b>이 뜬 줄은 5자리를 넣고 저장 — 옷 꺼낼 땐 <b>[오늘 쌀 목록 인쇄]</b>가 편해요`,
  epost: `앱으로 우체국에 접수한 택배가 지금 어느 단계인지 보여줘요.<br>
· <b>오늘 쌀 목록</b> — 아직 안 걷어간 택배를 제품별·사람별로 모아 보여줘요<br>
· <b>[운송장 출력]</b> — 라벨기로 뽑아 상자에 붙여요. 우체국 홈페이지에서 출력했다면 [출력함 표시]는 눌러도 되고 안 눌러도 돼요<br>
· <b>[진행상태 새로고침]</b> — 예약·수거가 어디까지 됐는지 우체국에 물어봐요<br>
· <b>접수 취소</b> — 기사님이 가져가기 전까지 할 수 있어요. 취소하면 [주문 확인]으로 돌아갑니다`,
  shipping: `보낸 물건 전체 기록이에요.<br>
· <b>송장번호</b>를 누르면 지금 어디쯤 가는지 우체국 페이지가 열려요<br>
· 배달이 끝나면 <b>배달 끝</b>이 자동으로 붙어요 (5분마다 확인)<br>
· 고객이 교환·반품을 원하면 그 줄의 <b>[교환/반품]</b>을 누르세요 — 정보가 자동으로 채워져요`,
  returns: `카페24·우체국·배송도우미의 교환/반품을 <b>RMA 번호 하나</b>로 연결해요.<br>
① 카페24에서 신청되거나 여기서 등록하면 같은 목록에 나타나요<br>
② <b>[우체국 회수 신청]</b> — 기사님이 송장을 들고 고객 집으로 방문해요<br>
③ <b>[물건 도착 확인]</b> — 검수·재고 복귀, 교환 재발송까지 이어져요<br>
· <b>회수만 취소</b>는 기사님 방문만 취소하고, <b>전체 취소</b>는 카페24 접수까지 함께 취소해요<br>
· 반품 환불 결제는 자동 승인하지 않으며 카페24 환불 완료 상태를 받아 최종 완료로 표시해요`,
  inventory: `남은 옷 개수예요.<br>
· 택배를 보내면 <b>자동으로 −</b>, 교환·반품으로 돌아오면 <b>자동으로 +</b> 돼요<br>
· 새 옷이 들어왔을 때만 ＋를 직접 눌러 채우세요<br>
· <span style="color:var(--bad)"><b>빨간 숫자</b></span>는 2개 이하 — 곧 떨어진다는 뜻이에요`,
  settings: `구글시트·카페24·우체국 연결과 알림·백업을 관리해요.<br>한 번 해두면 계속 유지되니 평소엔 들어올 일이 없어요.<br>무언가 "연결이 필요해요"라고 뜨면 여기서 파란 버튼만 다시 누르면 됩니다.<br>장부는 <b>하루 한 번 자동 백업</b>되고, 잘못됐을 땐 여기서 예전 날짜로 되돌릴 수 있어요.`,
  customers: `고객 이름·전화·주소·송장·주문번호로 찾아 지금까지 무엇을 보냈는지 한눈에 봐요.<br>
왼쪽에서 검색해 고객을 고르면 오른쪽에 주소·누적 건수·주문/시딩 기록·교환/반품 기록·메모가 나와요.<br>
사이드바 맨 위 검색창에 입력하고 <b>Enter</b>를 누르면 바로 이 화면에서 검색돼요.`,
  stats: `이번 달 판매·발송·상품·클레임을 한 화면에 모았어요.<br>
◀ ▶ 로 지난달과 비교하고, 상품·사이즈 순위와 클레임 사유를 확인해요.<br>
택배비는 [택배비 CSV]로 내려받아 우체국 청구서와 맞춰볼 수 있어요.`
};
function injectHelp() {
  if (document.getElementById('help-box')) return;
  const h1 = document.querySelector('#main h1');
  if (!h1 || !HELP[PAGE]) return;
  h1.insertAdjacentHTML('beforeend', ' ' + helpBtn());
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
  else if (PAGE === 'customers') renderCustomers();
  else if (PAGE === 'inventory') renderInventory();
  else if (PAGE === 'stocklog') renderStockLog(); // 페이지로 등록해야 30초 자동 새로고침에 재고 화면으로 튕기지 않는다
  else if (PAGE === 'settings') renderSettings();
  else if (PAGE === 'stats') { if (typeof renderStats === 'function') renderStats(); else renderStatsFallback(); }
  injectHelp();
  updateNavBadge();
}
// renderStats()가 아직 없을 때(F3 배포 전)의 임시 화면 — 콘솔 에러 없이 조용히 빈 상태만 보여준다
function renderStatsFallback() {
  main().innerHTML = pageHeader({ title: '통계', sub: '월별 판매·발송·상품·클레임 요약' }) +
    `<div class="card">${emptyState({ icon: 'chart', title: '통계 화면을 준비 중이에요', sub: '잠시 후 다시 열어 주세요.' })}</div>`;
}


// ---------- 동작: 불러오기 / 내보내기 / 업로드 ----------
async function doSync() {
  busy(true, '새 주문과 시딩을 가져오는 중…');
  try {
    const r = await api('/api/sync', { method: 'POST' });
    busy(false);
    if (r.error) { toast(r.error, 6000); return; }
    adoptDb(r.db);
    SYNC_STATUS = r.status || SYNC_STATUS;
    const c24added = r.cafe24 ? r.cafe24.added : 0;
    const cxl = (r.seeding.canceled || 0) + (r.orders.canceled || 0) + (r.cafe24 && r.cafe24.canceled || 0);
    const msg = `새로 가져옴: 시딩 ${r.seeding.added}건, 주문 ${r.orders.added + c24added}건` +
      (r.seeding.updated + r.orders.updated ? ` (내용 바뀐 것 ${r.seeding.updated + r.orders.updated}건)` : '') +
      (cxl ? ` / 취소 반영 ${cxl}건` : '');
    toast(msg, 5000);
    LAST_SYNC_AT = new Date();
    updateSideStatus();
    render();
  } catch (e) {
    busy(false);
    toast('인터넷 연결을 확인해 주세요.', 6000);
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
    ? '알림을 켰어요! 창을 안 보고 있어도 새 주문이 오면 알려드릴게요.'
    : '알림이 허용되지 않았어요. 주소창 왼쪽 자물쇠를 눌러 알림을 [허용]으로 바꿔 주세요.', 7000);
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
    const msg = `기사님이 ${Number(dl[0])}시에 오세요. 아직 안 보낸 것이 ${pendingN}건 있어요.`;
    toast(msg, 12000);
    notify('배송 도우미', msg);
  }
}

// ---------- 사이드바 하단 상태 줄 ----------
let LAST_SYNC_AT = null;
function timeAgo(d) {
  const sec = Math.floor((Date.now() - d) / 1000);
  if (sec < 60) return '방금 전';
  if (sec < 3600) return Math.floor(sec / 60) + '분 전';
  if (sec < 86400) return Math.floor(sec / 3600) + '시간 전';
  return Math.floor(sec / 86400) + '일 전';
}
function updateSideStatus() {
  const el = document.getElementById('side-status');
  if (!el) return;
  const mode = window._VIEW ? '보기 모드' : '누솔베르 · 클라우드';
  const when = LAST_SYNC_AT ? '마지막 확인 ' + timeAgo(LAST_SYNC_AT) : '';
  el.innerHTML = esc(mode) + (when ? '<br>' + esc(when) : '');
}

// ---------- 자동 새로고침 (30초마다 확인) ----------
async function refreshStatus(force) {
  try {
    const r = await api('/api/status');
    SYNC_STATUS = r.status;
    window._VIEW = !!r.viewOnly;
    window._C24OWNER = r.c24Owner !== false;
    if (r.version) { const v = document.getElementById('ver'); if (v) v.textContent = 'v' + r.version; }
    LAST_SYNC_AT = new Date();
    updateSideStatus();
    if (force || (DB && r.rev !== DB.rev)) {
      const before = DB ? pendingOf(DB.seeding).length + pendingOf(DB.orders).length : 0;
      const retBefore = DB ? (DB.returns || []).filter(x => ['requested', 'accepted'].includes(x.flowState)).length : 0;
      adoptDb(await api('/api/db'));
      const after = pendingOf(DB.seeding).length + pendingOf(DB.orders).length;
      const retAfter = (DB.returns || []).filter(x => ['requested', 'accepted'].includes(x.flowState)).length;
      // 입력 중인 화면(설정, 재고 추가 폼, 재고 실사 중)이나 접수 결과가 떠 있을 땐 건드리지 않음 (송장번호·인쇄 버튼·실사 입력 소실 방지)
      const typing = document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
      const formOpen = PAGE === 'settings' || document.querySelector('#inv-form input') ||
        document.querySelector('#export-result .result-box') || document.querySelector('#ret-form input') ||
        (PAGE === 'inventory' && window._invCount) ||
        (['stocklog', 'send', 'shipping', 'inventory', 'returns', 'epost', 'customers', 'stats'].includes(PAGE) && typing); // 검색어·입력 중이면 30초 재렌더가 포커스를 뺏지 않게
      if (!formOpen) render();
      if (after > before) {
        toast(`새로 들어온 것이 ${after - before}건 있어요.`, 6000);
        notify('배송 도우미', `새 주문·시딩이 ${after - before}건 들어왔어요.`);
      }
      if (retAfter > retBefore) {
        toast(`교환/반품 신청이 ${retAfter - retBefore}건 들어왔어요.`, 8000);
        notify('배송 도우미', `교환/반품 신청 ${retAfter - retBefore}건 — 확인해 주세요`);
      }
    }
  } catch (e) { /* 서버 꺼짐 등은 조용히 넘어감 */ }
}
