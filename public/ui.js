/* 배송 도우미 v2 — 공용 UI 컴포넌트 (전역 함수, 모듈 번들 없음)
 * 규칙: 텍스트 파라미터는 호출자가 esc()로, onclick 문자열은 호출자가 jsq()로 이미 안전하게 만든 뒤 넘긴다.
 *       여기 함수들은 넘겨받은 문자열을 그대로 조립만 한다(다시 escape하지 않음).
 * 로드 순서: item-lines.js → ui.js → app-core.js → pages/*.js → app-init.js
 */

// ---------- 아이콘 (Lucide 스타일 선 아이콘, 24x24 기준) ----------
const ICONS = {
  home: '<path d="M3 11 12 4l9 7v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  send: '<path d="M3 7h18v12H3z"/><path d="M3 11h18"/>',
  post: '<path d="M4 4h16v16H4z"/><path d="m4 8 8 5 8-5"/>',
  truck: '<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 14-5l2 2"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5l-2-2"/><path d="M4 20v-5h5"/>',
  box: '<path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3"/><path d="M4 12h16"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3.9a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 2.4a7 7 0 0 0-1.7 1l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 1.7 1l.4 2.4h5l.4-2.4a7 7 0 0 0 1.7-1l2.3.9 2-3.4-2-1.5c.1-.3.1-.7.1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  download: '<path d="M12 3v12M6 11l6 6 6-6"/><path d="M4 20h16"/>',
  upload: '<path d="M12 21V9M6 13l6-6 6 6"/><path d="M4 20h16"/>',
  print: '<path d="M6 9V3h12v6"/><path d="M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><path d="M6 14h12v7H6z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v4h1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  history: '<path d="M3.1 13a9 9 0 1 0 2.6-6.6L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  chevronL: '<path d="m15 18-6-6 6-6"/>',
  chevronR: '<path d="m9 18 6-6-6-6"/>',
  external: '<path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M9 7V4h6v3"/>',
  split: '<path d="M6 3v6a3 3 0 0 0 3 3h6"/><path d="m14 9 3-3-3-3"/><path d="M6 21v-6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  filter: '<path d="M4 5h16"/><path d="M7 12h10"/><path d="M10 19h4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  chart: '<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>',
  cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  swap: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'
};
function icon(name, size) {
  size = size || 18;
  const body = ICONS[name] || '';
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" stroke="currentColor" fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// ---------- 구분 아이콘 (주문/시딩/교환/직접등록/채널) ----------
// kind: 'order'|'seeding'|'exchange'|'direct'|채널키('29cm'|'musinsa'|'gsshop' 등) — 채널 주문도 카트 아이콘을 쓴다.
function kindIcon(kind) {
  const map = { seeding: 'gift', exchange: 'swap', direct: 'file' };
  return icon(map[kind] || 'cart', 15);
}

// ---------- 페이지 헤더 ----------
// pageHeader({ title, sub, actions }) -- title/sub/actions는 이미 완성된(escape된) HTML 문자열
function pageHeader(opts) {
  opts = opts || {};
  return `<div class="ph">
    <div><h1>${opts.title || ''}</h1>${opts.sub ? `<p>${opts.sub}</p>` : ''}</div>
    ${opts.actions ? `<div class="act">${opts.actions}</div>` : ''}
  </div>`;
}

// ---------- 버튼 ----------
// btn({ label, onclick, kind:'secondary'|'primary'|'text'|'danger', icon, size:'md'|'sm', disabled, title })
function btn(opts) {
  opts = opts || {};
  const kind = opts.kind || 'secondary';
  const kindCls = kind === 'secondary' ? '' : kind;
  const sizeCls = opts.size === 'sm' ? 'sm' : '';
  const cls = ['btn', kindCls, sizeCls].filter(Boolean).join(' ');
  const ic = opts.icon ? icon(opts.icon, opts.size === 'sm' ? 16 : 18) : '';
  const attrs = [
    'type="button"',
    opts.onclick ? `onclick="${opts.onclick}"` : '',
    opts.disabled ? 'disabled' : '',
    opts.title ? `title="${esc(opts.title)}"` : ''
  ].filter(Boolean).join(' ');
  return `<button ${attrs} class="${cls}">${ic}${opts.label != null ? opts.label : ''}</button>`;
}

// ---------- 칩 ----------
// chipEl(kind, text) -- kind: ok|warn|bad|idle|info (레거시 wait|processing|done도 그대로 통한다)
function chipEl(kind, text) {
  return `<span class="chip ${kind}">${text}</span>`;
}

// ---------- 배너 ----------
// banner(kind, html, actionHtml) -- kind: info|warn|bad|ok
function banner(kind, html, actionHtml) {
  const ic = kind === 'ok' ? 'check' : kind === 'bad' ? 'x' : 'alert';
  return `<div class="banner ${kind}">${icon(ic, 20)}<div class="banner-body">${html}</div>${actionHtml ? `<div class="act">${actionHtml}</div>` : ''}</div>`;
}

// ---------- 숫자 요약 ----------
// kpiStrip([{label, value, unit, tone:'hot'|'ok'|'bad'|'', onclick}])
function kpiStrip(items) {
  const cells = (items || []).map(it => {
    const cls = ['stat', it.tone || ''].filter(Boolean).join(' ');
    const inner = `<div class="l">${it.label}</div><div class="n">${it.value}${it.unit ? `<small>${it.unit}</small>` : ''}</div>`;
    return it.onclick
      ? `<button type="button" class="${cls}" onclick="${it.onclick}">${inner}</button>`
      : `<div class="${cls}">${inner}</div>`;
  }).join('');
  return `<div class="stats">${cells}</div>`;
}

// ---------- 세그먼트 필터 ----------
// seg([{key, label, count, on, onclick}])
function seg(items) {
  const cells = (items || []).map(it =>
    `<button type="button" class="${it.on ? 'on' : ''}" onclick="${it.onclick}">${it.label}${it.count != null ? ` <b>${it.count}</b>` : ''}</button>`
  ).join('');
  return `<div class="seg">${cells}</div>`;
}

// ---------- 검색창 ----------
// searchBox({ id, placeholder, value, oninput })
function searchBox(opts) {
  opts = opts || {};
  const id = opts.id ? ` id="${esc(opts.id)}"` : '';
  const oninput = opts.oninput ? ` oninput="${opts.oninput}"` : '';
  return `<input${id} class="search-input" type="text" placeholder="${esc(opts.placeholder || '')}" value="${esc(opts.value || '')}"${oninput}>`;
}

// ---------- 빈 상태 ----------
// emptyState({ icon, title, sub, actionHtml })
function emptyState(opts) {
  opts = opts || {};
  return `<div class="empty-state">
    ${opts.icon ? `<div class="es-icon">${icon(opts.icon, 32)}</div>` : ''}
    ${opts.title ? `<div class="es-title">${opts.title}</div>` : ''}
    ${opts.sub ? `<div class="es-sub">${opts.sub}</div>` : ''}
    ${opts.actionHtml ? `<div class="es-act">${opts.actionHtml}</div>` : ''}
  </div>`;
}

// ---------- 표 래퍼 ----------
// tableWrap(html) -- .card.flush > .table-wrap
function tableWrap(html) {
  return `<div class="card flush"><div class="table-wrap">${html}</div></div>`;
}

// ---------- 도움말 버튼 ----------
function helpBtn() {
  return `<button type="button" class="help-btn" onclick="toggleHelp()" title="도움말" aria-label="도움말">${icon('info', 15)}</button>`;
}
