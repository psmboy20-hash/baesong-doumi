
// ---------- 통계 ----------
function statsThisYm() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function statsShiftYm(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
const STATS_CHANNEL_LABEL = { cafe24: '카페24', seeding: '시딩', '29cm': '29CM', musinsa: '무신사', gsshop: 'GS샵', other: '기타 채널', exchange: '교환 재발송', direct: '직접 등록' };
function statsChannelLabel(k) { return STATS_CHANNEL_LABEL[k] || k; }
function statsCardTable(title, innerTableHtml) {
  return `<div class="card">
    <div class="step-title">${esc(title)}</div>
    <div class="table-wrap">${innerTableHtml}</div>
  </div>`;
}

// 택배비 CSV — 서버가 json 으로 에러를 주면 토스트로 알려준다
async function statsDownloadShippingCsv(ym) {
  const r = await downloadFile('/api/stats/shipping.csv?ym=' + encodeURIComponent(ym), null, '택배비_' + ym + '.csv');
  if (!r || !r.ok) toast((r && r.error) || '택배비 CSV 를 내려받지 못했어요.', 6000);
}

async function renderStats() {
  PAGE = 'stats';
  const thisYm = statsThisYm();
  const ym = window._statsYm || thisYm;
  window._statsYm = ym;

  const header = pageHeader({
    title: '통계',
    sub: '이달 판매·발송·클레임을 한눈에 봐요.',
    actions: btn({ label: '택배비 CSV', onclick: `statsDownloadShippingCsv('${ym}')`, icon: 'download' })
  });
  const monthNav = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
    ${btn({ onclick: `window._statsYm='${statsShiftYm(ym, -1)}';renderStats()`, icon: 'chevronL', size: 'sm', title: '이전 달' })}
    <b style="font-size:16px;min-width:96px;text-align:center;display:inline-block">${esc(ym.replace('-', '년 '))}월</b>
    ${btn({ onclick: `window._statsYm='${statsShiftYm(ym, 1)}';renderStats()`, icon: 'chevronR', size: 'sm', title: '다음 달', disabled: ym >= thisYm })}
    ${ym !== thisYm ? btn({ label: '이번 달', onclick: "window._statsYm='';renderStats()", kind: 'text', size: 'sm' }) : ''}
  </div>`;

  main().innerHTML = header + monthNav + `<div id="stats-body"><div class="loading-row">불러오는 중…</div></div>`;
  injectHelp();

  // 월을 빨리 연달아 넘길 때 늦게 도착한 응답이 화면을 덮어쓰지 않게
  const token = window._statsToken = (window._statsToken || 0) + 1;
  let r;
  try { r = await api(`/api/stats?ym=${encodeURIComponent(ym)}`); } catch (e) { r = null; }
  if (token !== window._statsToken) return;
  const body = document.getElementById('stats-body');
  if (!body) return;
  if (!r || r.error || !r.ok) {
    body.innerHTML = emptyState({
      icon: 'chart', title: '이달 통계가 아직 없어요',
      sub: '주문·발송 기록이 쌓이면 여기에 나타나요.'
    });
    return;
  }
  body.innerHTML = statsBodyHtml(r);
}

function statsBodyHtml(r) {
  const sales = r.sales || {};
  const shipping = r.shipping || {};
  const products = r.products || [];
  const sizes = r.sizes || [];
  const claims = r.claims || {};

  const amountKnown = sales.amount != null;
  const kpis = kpiStrip([
    { label: '주문 건수', value: sales.orders || 0, unit: '건' },
    { label: '상품 수', value: sales.units || 0, unit: '개' },
    { label: '매출', value: amountKnown ? (Number(sales.amount) || 0).toLocaleString() : '—', unit: amountKnown ? '원' : '' },
    { label: '택배비', value: (shipping.epostCost || 0).toLocaleString(), unit: '원' }
  ]);
  const amountHint = amountKnown ? '' : `<div class="hint" style="margin:-4px 0 16px">매출 금액은 9월 이후 주문부터 표시돼요.</div>`;

  // 채널별
  const byChannel = sales.byChannel || {};
  const chKeys = Object.keys(byChannel);
  const channelRows = chKeys.map(k => {
    const c = byChannel[k] || {};
    const amt = c.amount == null ? '<span class="muted">—</span>' : (Number(c.amount) || 0).toLocaleString() + '원';
    return `<tr>
      <td>${esc(statsChannelLabel(k))}</td>
      <td class="num">${c.orders || 0}</td>
      <td class="num">${c.units || 0}</td>
      <td class="num">${amt}</td>
    </tr>`;
  }).join('');
  const channelCard = statsCardTable('채널별', `<table class="tbl">
    <thead><tr><th>채널</th><th class="num">주문 건수</th><th class="num">상품 수</th><th class="num">매출</th></tr></thead>
    <tbody>${channelRows || `<tr><td colspan="4" class="muted" style="padding:16px 0">채널별 데이터가 없어요.</td></tr>`}</tbody>
  </table>`);

  // 일별 발송 막대 (라이브러리 없이 div 막대)
  const byDay = shipping.byDay || [];
  const maxParcels = Math.max(1, ...byDay.map(d => Number(d.parcels) || 0));
  const dayRows = byDay.map(d => {
    const n = Number(d.parcels) || 0;
    const pct = Math.max(2, Math.round((n / maxParcels) * 100));
    const dayLabel = String(d.date || '').slice(-2).replace(/^0/, '') + '일';
    return `<div class="stats-bar-row">
      <div class="stats-bar-label">${esc(dayLabel)}</div>
      <div class="stats-bar-track"><div class="stats-bar-fill" style="width:${n ? pct : 0}%"></div></div>
      <div class="stats-bar-n">${n}</div>
    </div>`;
  }).join('');
  const dayCard = `<div class="card">
    <div class="step-title">일별 발송 — 이달 총 ${shipping.parcels || 0}건 · 평균 택배비 ${(shipping.avgCost || 0).toLocaleString()}원</div>
    ${dayRows || '<div class="muted">발송 기록이 없어요.</div>'}
  </div>`;

  // 상품 순위 (상위 20)
  const prodRows = products.slice(0, 20).map((p, idx) => `<tr>
    <td class="num">${idx + 1}</td>
    <td>${esc(p.name || '')}</td>
    <td>${esc(p.color || '-')}</td>
    <td>${esc(p.size || '-')}</td>
    <td class="num">${p.units || 0}</td>
    <td class="num">${Number(p.share || 0).toFixed(1)}%</td>
  </tr>`).join('');
  const prodCard = statsCardTable('상품 순위 (상위 20)', `<table class="tbl">
    <thead><tr><th class="num">#</th><th>상품</th><th>컬러</th><th>사이즈</th><th class="num">수량</th><th class="num">비중</th></tr></thead>
    <tbody>${prodRows || `<tr><td colspan="6" class="muted" style="padding:16px 0">상품 데이터가 없어요.</td></tr>`}</tbody>
  </table>`);

  // 사이즈 비중
  const sizeRows = sizes.map(s => `<tr>
    <td>${esc(s.size || '-')}</td>
    <td class="num">${s.units || 0}</td>
    <td class="num">${Number(s.share || 0).toFixed(1)}%</td>
  </tr>`).join('');
  const sizeCard = statsCardTable('사이즈 비중', `<table class="tbl">
    <thead><tr><th>사이즈</th><th class="num">수량</th><th class="num">비중</th></tr></thead>
    <tbody>${sizeRows || `<tr><td colspan="3" class="muted" style="padding:16px 0">사이즈 데이터가 없어요.</td></tr>`}</tbody>
  </table>`);

  // 클레임
  const byReason = claims.byReason || [];
  const byProduct = claims.byProduct || [];
  const claimKpis = kpiStrip([
    { label: '클레임 건수', value: claims.total || 0, unit: '건' },
    { label: '교환', value: claims.exchanges || 0, unit: '건' },
    { label: '반품', value: claims.returns || 0, unit: '건' }
  ]);
  const reasonRows = byReason.map(x => `<tr><td>${esc(x.reason || '기타')}</td><td class="num">${x.n || 0}</td></tr>`).join('');
  const productRows = byProduct.map(x => `<tr><td>${esc(x.name || '')}</td><td class="num">${x.n || 0}</td></tr>`).join('');
  const claimCard = `<div class="card">
    <div class="step-title">클레임</div>
    ${claimKpis}
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:14px">
      <div style="flex:1;min-width:220px">
        <div class="sub" style="margin-bottom:6px">사유별</div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>사유</th><th class="num">건수</th></tr></thead>
        <tbody>${reasonRows || `<tr><td colspan="2" class="muted" style="padding:12px 0">사유 데이터가 없어요.</td></tr>`}</tbody></table></div>
      </div>
      <div style="flex:1;min-width:220px">
        <div class="sub" style="margin-bottom:6px">상품별</div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>상품</th><th class="num">건수</th></tr></thead>
        <tbody>${productRows || `<tr><td colspan="2" class="muted" style="padding:12px 0">상품 데이터가 없어요.</td></tr>`}</tbody></table></div>
      </div>
    </div>
  </div>`;

  return kpis + amountHint + channelCard + dayCard + prodCard + sizeCard + claimCard;
}
