/* 누솔베르 배송 도우미 - 로컬 서버
 * 카페24 주문 + 인플루언서 시딩 → 우체국(오즈뷰어) 접수 엑셀 변환/송장 매칭
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { exec } = require('child_process');
const XLSX = require('xlsx');
const seed = require('./lib/seed128');
const {
  releaseMissingEpostOperations,
  fulfillmentKey,
  expandSelectedFulfillments,
  markPrintedFulfillments,
  fulfillmentGroupConflicts,
  parcelReference,
  selectInvoiceParcelGroup,
  inventorySku,
  inventoryCountKnown,
  availableStockDeduction,
  canFuzzyMergeOrders,
  splitOrderLineForLater,
  releaseSplitOrderLine,
  undoSplitOrder,
  groupCafe24ShipmentItems,
  shipmentOperationKey,
  classifyCafe24Shipment,
  setExternalSyncState,
  clearExternalSyncState,
  sameCafe24OrderItem,
  resolvePackingMergeSelection,
  variantIdentityAmbiguous,
  returnRestockAllowed,
  sheetWriteSucceeded,
  cafe24VariantInventory,
  markMissingCafe24Variants,
  variantAllocationState,
  shouldProcessStockDeduction,
  getStockDeductions,
  recordStockDeduction,
  restoreStockDeductions,
  parseLotteDeliveryStatus,
  cafe24ReturnKey,
  stockLedgerRef,
  ensureOperationalFields,
  applyCarrierDeliveryResult,
  splitShipmentItems,
  parcelContent,
  buildReturnRestockPlan,
  selectStockMatches
} = require('./lib/operations');
const { writeJsonAtomic, appendAudit, createMutationQueue } = require('./lib/storage');
const { buildWorkbookBuffer, xlsxDownloadHeaders } = require('./lib/spreadsheet-export');
const {
  clientJson,
  mergeClientDb,
  accessCodeRequiredForIp,
  securityHeaders,
  isSecureRequest,
  readBodyLimited,
  spreadsheetFormat,
  spreadsheetReadOptions
} = require('./lib/security');
const {
  postalAddressCandidates,
  postalZipFromDocuments,
  postalLookupDue,
  zipForChangedAddress
} = require('./lib/postal');
const {
  seedKey,
  normalizeSeedingPacking,
  stableSheetRowId,
  findExactSeedingCol,
  inspectSeedingSchema,
  seedingProductFields,
  mergeSeedingRows
} = require('./lib/seeding');
const {
  cafe24ClaimStage,
  statusForFlowState,
  appendClaimEvent,
  returnLineItems,
  upsertReturnLine,
  applyCafe24ClaimSnapshot,
  buildCafe24ClaimCreate,
  buildCafe24ClaimUpdate,
  hasValidClaimLines,
  hasValidExchangeTargets,
  extractCafe24ClaimCode,
  claimOperationKey,
  isClaimPostAction,
  activeRmaConflict,
  pickupRmaConflict,
  legacyRmaMatch,
  prepareLegacyRma,
  findExchangeTarget,
  allowSingleExchangeFallback,
  cafe24PickupActive,
  findCafe24ClaimDetail,
  pickupOperationUnresolved,
  canCompleteRma,
  shouldApplyPickupProgress,
  pickupCanceledFlowState,
  shouldCancelRecoveredPickup,
  claimCancelUnresolved,
  resolveClaimCodeFromItems,
  missingCafe24ExchangeTargets,
  returnCompletionSafety
} = require('./lib/claims');

const PORT = 8899;
const ZIP_LOOKUP_VERSION = 2;
const TRUST_PROXY = process.env.HAM_TRUST_PROXY === '1';
// ── 접속 코드 게이트 (클라우드 서버용) ───────────────────────────────
const gateCrypto = require('crypto');
let _accessCode = null;
function accessCode() {
  if (_accessCode === null) {
    try { _accessCode = String(loadDb().accessCode || '').trim(); } catch (e) { _accessCode = ''; }
  }
  return _accessCode;
}
function gateHash(code) { return gateCrypto.createHash('sha256').update('ham-gate:' + code).digest('hex'); }
function clientIp(req) { return String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''); }
function reqCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}
const gateFails = new Map(); // ip → { n, until }
const GATE_HTML = `<!DOCTYPE html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>배송 도우미</title><body style="font-family:'Malgun Gothic',sans-serif;text-align:center;padding-top:14vh;background:#f7f5f0">
<div style="font-size:42px">📦</div><h2>누솔베르 배송 도우미</h2>
<p style="color:#666">접속 코드를 입력해 주세요. (한 번 입력하면 이 컴퓨터에서는 다시 묻지 않아요)</p>
<input id="c" type="tel" autocomplete="off" style="font-size:32px;text-align:center;letter-spacing:8px;width:240px;padding:10px;border:2px solid #ccc;border-radius:10px" maxlength="10" autofocus>
<br><br><button onclick="go()" style="font-size:22px;padding:10px 40px;border:0;border-radius:10px;background:#2f6f4f;color:#fff;cursor:pointer">들어가기</button>
<p id="m" style="color:#c00;height:22px"></p>
<script>
function go(){fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('c').value})}).then(r=>r.json()).then(j=>{if(j.ok)location.reload();else document.getElementById('m').textContent=j.error||'다시 시도해 주세요.';});}
document.getElementById('c').addEventListener('keydown',e=>{if(e.key==='Enter')go();});
</script></body></html>`;
async function gateCheck(req, res, url) {
  const code = accessCode();
  const ip = clientIp(req);
  if (!code && accessCodeRequiredForIp(ip)) {
    if (url.pathname.startsWith('/api/')) sendJson(res, 403, { error: '이 서버는 다른 컴퓨터 접속이 잠겨 있어요. 서버 컴퓨터에서 접속 코드를 먼저 설정해 주세요.' });
    else { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('서버 컴퓨터에서 접속 코드를 먼저 설정해 주세요.'); }
    return true;
  }
  if (!code) return false;
  if (!accessCodeRequiredForIp(ip)) return false;
  if (reqCookies(req).hamKey === gateHash(code)) return false; // 이미 코드 입력한 컴퓨터
  if (String(req.headers['x-ham-code'] || '').trim() === code) return false; // 외부 시스템(allin_v4 등)의 마스터 API 호출
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const f = gateFails.get(ip);
    if (f && f.until > Date.now()) { sendJson(res, 429, { error: '시도가 너무 많아요. 10분 뒤 다시 해주세요.' }); return true; }
    let body = {};
    try { body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}'); }
    catch (e) {
      if (e.code === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, { error: '접속 코드 요청이 너무 큽니다. 화면을 새로고침해 주세요.' });
        return true;
      }
    }
    if (String(body.code || '').trim() === code) {
      gateFails.delete(ip);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'hamKey=' + gateHash(code) + '; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax' + (isSecureRequest(req, TRUST_PROXY) ? '; Secure' : '')
      });
      res.end(JSON.stringify({ ok: true }));
      return true;
    }
    const n = (f ? f.n : 0) + 1;
    gateFails.set(ip, { n, until: n >= 5 ? Date.now() + 10 * 60 * 1000 : 0 });
    sendJson(res, 200, { error: '접속 코드가 맞지 않아요.' + (n >= 5 ? ' 10분 뒤 다시 해주세요.' : '') });
    return true;
  }
  if (url.pathname.startsWith('/api/')) { sendJson(res, 401, { error: '접속 코드가 필요해요. 화면을 새로고침해 주세요.' }); return true; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(GATE_HTML);
  return true;
}
// ─────────────────────────────────────────────────────────────────
// 보기 전용 모드: 화면만 보고 카페24/우체국/시트에 일절 접속 안 함 (노트북에서 매장 PC와 충돌 없이 확인용)
const VIEW_ONLY = !!process.env.HAM_VIEW;
const STORE_URL = process.env.HAM_STORE || 'http://100.112.253.21:8899'; // 매장 PC (Tailscale)
// 매장 서버가 살아있는지 (노트북 보기 모드에서 카페24 담당을 정하는 기준)
function storeAlive() {
  if (!VIEW_ONLY) return Promise.resolve(false); // 매장 PC 자신은 항상 담당
  return new Promise(resolve => {
    try {
      const u = new URL(STORE_URL + '/api/status');
      const r = http.get({ hostname: u.hostname, port: u.port, path: u.pathname, timeout: 2000 }, res => { resolve(res.statusCode === 200); res.resume(); });
      r.on('timeout', () => { r.destroy(); resolve(false); });
      r.on('error', () => resolve(false));
    } catch (e) { resolve(false); }
  });
}
let _storeCache = { t: 0, v: false };
async function storeAliveCached() {
  if (!VIEW_ONLY) return false;
  if (Date.now() - _storeCache.t < 60000) return _storeCache.v;
  const v = await storeAlive();
  _storeCache = { t: Date.now(), v };
  return v;
}
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const AUDIT_PATH = path.join(DATA_DIR, 'audit.ndjson');
const PUBLIC_DIR = path.join(__dirname, 'public');

// 구글시트 주소는 설정(data/db.json)에 저장 - 코드에는 두지 않는다
const SHEET_SEEDING = '02. 시딩 발송 리스트';
function sheetIdOf(db) {
  const m = String(db.settings.sheetId || '').match(/[-\w]{25,}/);
  return m ? m[0] : '';
}

// ---------- DB ----------
function defaultDb() {
  return {
    settings: {
      senderName: '누솔베르(nu.solvere)',
      senderPhone: '',
      senderZip: '',
      senderAddr: '',
      defaultContent: '의류',
      sheetId: '',
      cafe24MallId: '',
      cafe24ClientId: '',
      cafe24ClientSecret: '',
      cafe24RedirectUri: '',
      sheetWebhookUrl: '',
      sheetWebhookToken: '',
      epostApiKey: '',
      epostSecKey: '',
      epostMemberId: 'allincrew',
      epostContCd: '025', // 내용품코드: 의류/패션잡화
      kakaoRestKey: '',      // 카카오 REST API 키 (주소→우편번호 자동 변환, 선택)
      pickupDeadline: '16:00', // 기사님 수거 시각 (마감 알림 기준)
      // 우체국 계약고객시스템 > 파일등록 > "주문접수처 양식다운로드"에서 확인한 NUSOLVERE 실제 양식
      epostColumns: [
        '주문번호', '수취인명', '수취인 우편번호', '수취인 주소',
        '수취인 전화번호', '상품명', '상품모델', '배송메세지'
      ]
    },
    seeding: [],
    orders: [],
    inventory: [],
    returns: [],
    sheetSchema: null,
    cafe24Token: null,
    rev: 0,
    nextId: 1
  };
}

function loadDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    // 기본값 보강
    const def = defaultDb();
    db.settings = Object.assign(def.settings, db.settings || {});
    for (const k of ['seeding', 'orders', 'inventory', 'returns', 'inventoryHidden']) if (!Array.isArray(db[k])) db[k] = [];
    if (!db.nextId) db.nextId = 1;
    ensureOperationalFields(db);
    return db;
  } catch (e) {
    return defaultDb();
  }
}

function saveDb(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  ensureOperationalFields(db);
  // _sel(체크박스 선택)은 화면 전용 — 장부에 저장하지 않음 (저장되면 다음에 열 때 0건 선택으로 시작함)
  for (const k of ['seeding', 'orders']) {
    if (Array.isArray(db[k])) for (const x of db[k]) delete x._sel;
  }
  if (fs.existsSync(DB_PATH)) {
    const current = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (Number(current.rev || 0) > Number(db.rev || 0)) throw new Error('다른 컴퓨터에서 장부가 먼저 바뀌었어요. 화면을 새로고침하고 다시 해주세요.');
    fs.copyFileSync(DB_PATH, DB_PATH + '.bak');
  }
  db.rev = (db.rev || 0) + 1;
  writeJsonAtomic(DB_PATH, db);
}

function audit(action, values) {
  try { appendAudit(AUDIT_PATH, Object.assign({ action }, values || {})); } catch (e) { console.error('감사 로그 실패:', e.message); }
}

// ---------- 유틸 ----------
function normName(s) { return String(s || '').replace(/\s+/g, '').replace(/\(.*?\)/g, '').trim(); }
function phoneDigits(s) { return String(s || '').replace(/\D/g, ''); }
function extractZip(addr) {
  const s = String(addr || '');
  let m = s.match(/\((\d{5})\)/) || s.match(/\(우\)?\s*(\d{5})/) || s.match(/우편번호[:\s]*(\d{5})/) || s.match(/(?:^|\s)(\d{5})(?:\s|$|\))/);
  return m ? m[1] : '';
}
function cleanAddr(addr) {
  return String(addr || '')
    .replace(/\((\d{5})\)/g, '')
    .replace(/\(우\)?\s*\d{5}\)?/g, '')
    .replace(/우편번호[:\s]*\d{5}/g, '')
    .replace(/\s+/g, ' ').trim();
}
function excelDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim().replace(/\s/g, '');
  const m = s.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return String(v);
}
function today() { // 한국 로컬 날짜 (UTC를 쓰면 오전 9시 전 접수가 전날로 찍힘)
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function nowStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// 헤더 행에서 열 위치를 키워드로 찾기 (앞의 키워드가 우선)
function findCol(header, keywords) {
  for (const kw of keywords) {
    for (let i = 0; i < header.length; i++) {
      const h = String(header[i] || '').replace(/\s/g, '');
      if (!h) continue;
      if (h.includes('이메일') && !kw.includes('이메일')) continue; // '이메일 주소' 오탐 방지
      if (h.includes(kw)) return i;
    }
  }
  return -1;
}

// ---------- 구글시트 다운로드 ----------
function fetchUrl(url, redirects) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('리다이렉트가 너무 많습니다'));
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchUrl(res.headers.location, (redirects || 0) + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('구글시트 응답 오류 (' + res.statusCode + ')'));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// ---------- HTTPS JSON 요청 ----------
function httpsJson(method, urlStr, headers, body, redirects) {
  return new Promise((resolve, reject) => {
    if (Number(redirects || 0) > 6) return reject(new Error('HTTPS 리다이렉트가 너무 많습니다.'));
    const u = new URL(urlStr);
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: Object.assign({}, headers, data ? { 'Content-Length': Buffer.byteLength(data) } : {})
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const preserveMethod = res.statusCode === 307 || res.statusCode === 308;
        const nextUrl = new URL(res.headers.location, u).toString();
        return resolve(httpsJson(preserveMethod ? method : 'GET', nextUrl, headers, preserveMethod ? body : null, Number(redirects || 0) + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ---------- 카페24 연동 ----------
// 카페24 정책상 Redirect URI는 https 도메인만 허용 (localhost/IP 불가)
// → 개발자센터에 이미 등록된 쇼핑몰 대표 주소를 사용하고, code는 주소 붙여넣기/자동수집으로 받는다.
let cafe24State = ''; // OAuth state 값

function cafe24Configured(db) {
  const s = db.settings;
  return !!(s.cafe24MallId && s.cafe24ClientId && s.cafe24ClientSecret);
}
function cafe24RedirectUri(db) {
  const s = db.settings;
  return (s.cafe24RedirectUri || '').trim() || `https://${s.cafe24MallId}.cafe24.com`;
}
function cafe24AuthUrl(db) {
  const s = db.settings;
  cafe24State = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: s.cafe24ClientId,
    state: cafe24State,
    redirect_uri: cafe24RedirectUri(db),
    scope: 'mall.read_order,mall.write_order,mall.read_product'
  });
  return `https://${s.cafe24MallId}.cafe24api.com/api/v2/oauth/authorize?${p}`;
}
async function cafe24TokenRequest(db, params) {
  const s = db.settings;
  const basic = Buffer.from(s.cafe24ClientId + ':' + s.cafe24ClientSecret).toString('base64');
  const body = new URLSearchParams(params).toString();
  const r = await httpsJson('POST', `https://${s.cafe24MallId}.cafe24api.com/api/v2/oauth/token`, {
    'Authorization': 'Basic ' + basic,
    'Content-Type': 'application/x-www-form-urlencoded'
  }, body);
  if (r.status !== 200 || !r.json || !r.json.access_token) {
    throw new Error('카페24 토큰 발급 실패 (' + r.status + '): ' + (r.json && (r.json.error_description || r.json.error) || r.text.slice(0, 200)));
  }
  db.cafe24Token = {
    access_token: r.json.access_token,
    refresh_token: r.json.refresh_token,
    expires_at: r.json.expires_at || new Date(Date.now() + 110 * 60 * 1000).toISOString(),
    refresh_expires_at: r.json.refresh_token_expires_at || new Date(Date.now() + 13 * 86400 * 1000).toISOString()
  };
  saveDb(db);
}
async function cafe24ExchangeCode(db, code) {
  await cafe24TokenRequest(db, { grant_type: 'authorization_code', code, redirect_uri: cafe24RedirectUri(db) });
}
async function cafe24EnsureToken(db) {
  const t = db.cafe24Token;
  if (!t) throw new Error('카페24가 아직 연결되지 않았어요. 설정에서 [카페24 연결하기]를 눌러 주세요.');
  const now = Date.now();
  if (new Date(t.expires_at).getTime() - now > 5 * 60 * 1000) return t.access_token;
  if (new Date(t.refresh_expires_at).getTime() <= now) {
    throw new Error('카페24 연결이 만료됐어요(2주 경과). 설정에서 [카페24 연결하기]를 다시 눌러 주세요.');
  }
  await cafe24TokenRequest(db, { grant_type: 'refresh_token', refresh_token: t.refresh_token });
  return db.cafe24Token.access_token;
}

// 카페24 주문 상태코드: N10 입금전, N20 상품준비중, N21 배송준비중, N22 배송보류, N30 배송중, N40 배송완료, C/R/E 취소·반품류
function cafe24Fetch(db, token, path, method, body) {
  const s = db.settings;
  return httpsJson(method || 'GET', `https://${s.cafe24MallId}.cafe24api.com${path}`, {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  }, body);
}

// 우체국 배송사 코드 찾기 (한 번 찾으면 저장)
async function cafe24PostCarrierCode(db, token) {
  if (db.cafe24PostCarrier && db.cafe24PostCarrier.code) return db.cafe24PostCarrier.code;
  const r = await cafe24Fetch(db, token, '/api/v2/admin/carriers');
  const list = (r.json && (r.json.carriers || r.json.shippingcompanies)) || [];
  const hit = list.find(c => JSON.stringify(c).includes('우체국'));
  if (hit) {
    const code = hit.shipping_company_code || hit.carrier_code || hit.code || hit.carrier_id;
    if (code != null) {
      db.cafe24PostCarrier = { code: String(code), name: hit.carrier_name || hit.name || '우체국' };
      return db.cafe24PostCarrier.code;
    }
  }
  throw new Error('카페24에서 우체국 배송사 코드를 찾지 못했어요. 카페24 관리자 > 배송사 관리에 우체국택배가 등록돼 있는지 확인해 주세요.');
}

// 카페24 주문에 송장번호 등록 + 배송중 처리
async function cafe24RegisterShipment(db, orderNo, invoice, requestedItemCodes) {
  const token = await cafe24EnsureToken(db);
  const code = await cafe24PostCarrierCode(db, token);
  const od = await cafe24Fetch(db, token, `/api/v2/admin/orders/${orderNo}?embed=items`);
  if (od.status !== 200 || !od.json || !od.json.order) throw new Error('주문 조회 실패(' + od.status + ')');
  const items = (od.json.order.items || []).filter(it => !/^[CRE]/.test(String(it.order_status || '')));
  const activeCodes = new Set(items.map(it => String(it.order_item_code || '')).filter(Boolean));
  const itemCodes = [...new Set((requestedItemCodes || []).map(value => String(value || '').trim()).filter(Boolean))];
  if (!itemCodes.length) throw new Error('선택한 상품의 카페24 품목코드가 없어 자동 배송처리를 멈췄어요.');
  if (itemCodes.some(codeValue => !activeCodes.has(codeValue))) throw new Error('선택한 상품이 카페24의 현재 배송 가능 품목과 맞지 않아 자동 배송처리를 멈췄어요.');
  const tracking = String(invoice).replace(/\D/g, '');
  const existing = await cafe24Fetch(db, token, `/api/v2/admin/orders/${orderNo}/shipments`);
  if (existing.status !== 200 || !existing.json) {
    const error = new Error('기존 카페24 송장을 확인하지 못해 중복 방지를 위해 등록을 멈췄어요.');
    error.responseReceived = existing.status > 0;
    throw error;
  }
  const existingState = classifyCafe24Shipment(existing.json.shipments || [], tracking, itemCodes);
  if (existingState === 'exact') return { ok: true, reconciled: true };
  if (existingState === 'conflict') {
    const error = new Error('같은 송장번호가 카페24에 다른 상품 구성으로 이미 등록돼 있어 자동 처리를 멈췄어요.');
    error.responseReceived = true;
    throw error;
  }
  const body = {
    shop_no: 1,
    request: {
      tracking_no: tracking,
      shipping_company_code: code,
      status: 'shipping',
      order_item_code: itemCodes
    }
  };
  const r = await cafe24Fetch(db, token, `/api/v2/admin/orders/${orderNo}/shipments`, 'POST', body);
  if (r.status >= 200 && r.status < 300) return { ok: true };
  const msg = (r.json && r.json.error && r.json.error.message) || r.text.slice(0, 150);
  const error = new Error(msg || ('등록 실패(' + r.status + ')'));
  error.responseReceived = true;
  throw error;
}

async function cafe24DeleteShipment(db, orderNo, invoice, requestedItemCodes) {
  const token = await cafe24EnsureToken(db);
  const itemCodes = [...new Set((requestedItemCodes || []).map(value => String(value || '').trim()).filter(Boolean))];
  const lookup = await cafe24Fetch(db, token, `/api/v2/admin/orders/${orderNo}/shipments`);
  if (lookup.status !== 200 || !lookup.json) {
    const error = new Error('카페24 기존 송장을 확인하지 못해 삭제를 멈췄어요.');
    error.responseReceived = lookup.status > 0;
    throw error;
  }
  const shipments = lookup.json.shipments || [];
  const state = classifyCafe24Shipment(shipments, invoice, itemCodes);
  if (state === 'missing') return { ok: true, alreadyDeleted: true };
  if (state === 'conflict') {
    const error = new Error('같은 송장번호가 카페24에 다른 상품 구성으로 등록돼 있어 자동 삭제를 멈췄어요.');
    error.responseReceived = true;
    throw error;
  }
  const exact = shipments.filter(shipment => classifyCafe24Shipment([shipment], invoice, itemCodes) === 'exact');
  for (const shipment of exact) {
    const shippingCode = String(shipment.shipping_code || '').trim();
    if (!shippingCode) {
      const error = new Error('카페24 배송번호를 찾지 못해 송장 삭제를 멈췄어요.');
      error.responseReceived = true;
      throw error;
    }
    const result = await cafe24Fetch(db, token,
      `/api/v2/admin/orders/${orderNo}/shipments/${encodeURIComponent(shippingCode)}`, 'DELETE', { shop_no: 1 });
    if (result.status < 200 || result.status >= 300) {
      const error = new Error(result.json && result.json.error && result.json.error.message || `카페24 송장 삭제 실패(${result.status})`);
      error.responseReceived = true;
      throw error;
    }
  }
  const verify = await cafe24Fetch(db, token, `/api/v2/admin/orders/${orderNo}/shipments`);
  if (verify.status !== 200 || !verify.json ||
      classifyCafe24Shipment(verify.json.shipments || [], invoice, itemCodes) !== 'missing') {
    const error = new Error('카페24 송장 삭제 결과를 아직 확인하지 못했어요.');
    error.responseReceived = false;
    throw error;
  }
  return { ok: true };
}

async function cafe24ClaimCarrierId(db, ret) {
  if (ret.cafe24CarrierId) return ret.cafe24CarrierId;
  if (!ret.originalOrderNo) return '';
  const token = await cafe24EnsureToken(db);
  const response = await cafe24Fetch(db, token, `/api/v2/admin/orders/${encodeURIComponent(ret.originalOrderNo)}/shipments`);
  if (response.status !== 200 || !response.json) return '';
  const shipments = response.json.shipments || [];
  const hit = shipments.find(row => ['0012', '0013'].includes(String(row.shipping_company_code || ''))) ||
    shipments.find(row => /우체국/.test(String(row.shipping_company_name || '')));
  if (hit && hit.carrier_id) ret.cafe24CarrierId = String(hit.carrier_id);
  return ret.cafe24CarrierId || '';
}

async function cafe24FetchOrderPages(db, token, start, end, dateType) {
  const fmt = d => d.toISOString().slice(0, 10);
  const rows = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const params = new URLSearchParams({
      start_date: fmt(start), end_date: fmt(end), date_type: dateType,
      embed: 'items,receivers,buyer,return,exchange,cancellation',
      limit: '100', offset: String(offset)
    });
    const response = await cafe24Fetch(db, token, `/api/v2/admin/orders?${params}`);
    if (response.status === 401) throw new Error('카페24 인증이 풀렸어요. 설정에서 다시 연결해 주세요.');
    if (response.status !== 200 || !response.json) {
      const message = response.json && response.json.error && response.json.error.message;
      throw new Error('카페24 주문 조회 실패 (' + response.status + '): ' + (message || response.text.slice(0, 200)));
    }
    const orders = response.json.orders || [];
    rows.push(...orders);
    if (orders.length < 100) break;
  }
  return rows;
}

function cafe24ClaimDetail(order, item, kind) {
  const list = kind === '교환' ? order.exchange : order.return;
  return findCafe24ClaimDetail(list, item.claim_code);
}

function cafe24OptionParts(raw) {
  let color = '', size = '';
  for (const part of String(raw || '').split(/[,/]/)) {
    const kv = part.split('=');
    if (kv.length !== 2) continue;
    const key = kv[0].trim().toLowerCase();
    const value = kv.slice(1).join('=').trim();
    if (key.includes('색상') || key.includes('color')) color = value;
    else if (key.includes('사이즈') || key.includes('size')) size = value;
  }
  return { color, size };
}

async function cafe24FetchOrders(db) {
  const token = await cafe24EnsureToken(db);
  const end = new Date();
  const orderStart = new Date(end.getTime() - 13 * 86400 * 1000);
  const claimStart = new Date(end.getTime() - 89 * 86400 * 1000);
  const orderMap = new Map();
  const ranges = [
    ['order_date', orderStart],
    ['exchange_request_date', claimStart],
    ['exchange_complete_date', claimStart],
    ['return_request_date', claimStart],
    ['return_complete_date', claimStart]
  ];
  for (const [dateType, start] of ranges) {
    const orders = await cafe24FetchOrderPages(db, token, start, end, dateType);
    for (const order of orders) orderMap.set(String(order.order_id || ''), order);
  }
  const parsed = [];
  for (const o of orderMap.values()) {
      const rc = (o.receivers && o.receivers[0]) || {};
      const name = rc.name || (o.buyer && o.buyer.name) || '';
      const phone = rc.cellphone || rc.phone || '';
      const addr = [rc.address1, rc.address2].filter(Boolean).join(' ') || rc.address_full || '';
      const zip = rc.zipcode || rc.postcode || '';
      const msg = rc.shipping_message || '';
      for (const it of (o.items || [])) {
        const st = String(it.order_status || '');
        // option_value 예: "색상=Indigo Blue, 사이즈=M"
        const { color, size } = cafe24OptionParts(it.option_value);
        if (/^[CRE]/.test(st)) {
          const retKind = st[0] === 'R' ? '반품' : st[0] === 'E' ? '교환' : '';
          const detail = retKind ? cafe24ClaimDetail(o, it, retKind) : {};
          const pickup = detail.pickup || {};
          const exchangedRows = retKind === '교환' && Array.isArray(detail.exchanged_items) ? detail.exchanged_items : [];
          const exchanged = findExchangeTarget(exchangedRows, it.order_item_code, allowSingleExchangeFallback(o.items, it), it);
          const exchangeOption = cafe24OptionParts(exchanged.option_value || exchanged.options || '');
          parsed.push({
            orderNo: o.order_id || '', name: pickup.name || name, phone: pickup.cellphone || pickup.phone || phone,
            zip: String(pickup.zipcode || zip), addr: [pickup.address1, pickup.address2].filter(Boolean).join(' ') || addr, color, size,
            option: it.option_value || '', qty: Number(it.claim_quantity) || Number(it.quantity) || 1,
            productNo: it.product_no || null, variantCode: it.variant_code || '', orderItemCode: it.order_item_code || '',
            product: it.product_name || '', _canceled: true, _src: 'c24',
            _retKind: retKind,
            _claimCode: it.claim_code || detail.claim_code || '',
            _claimStatus: st,
            _claimReasonType: it.claim_reason_type || detail.claim_reason_type || '',
            _claimReason: it.claim_reason || detail.claim_reason || '',
            _returnInvoice: detail.return_invoice_no || '',
            _returnCarrierId: detail.carrier_id || '',
            _pickupRequestState: detail.pickup_request_state || '',
            _exchangeTargetResolved: retKind !== '교환' || !!String(exchanged.exchange_variant_code || exchanged.variant_code || ''),
            _exchangeVariantCode: exchanged.exchange_variant_code || exchanged.variant_code || '',
            _exchangeProduct: exchanged.product_name || '',
            _exchangeProductNo: exchanged.product_no || null,
            _exchangeColor: exchangeOption.color,
            _exchangeSize: exchangeOption.size
          });
          continue;
        }
        if (st === 'N10' || st === 'N00') continue; // 입금 전 제외
        const shipped = st === 'N30' || st === 'N40';
        parsed.push({
          orderNo: o.order_id || '',
          name,
          phone,
          zip: String(zip),
          addr,
          product: it.product_name || '',
          color, size,
          option: it.option_value || '',
          qty: Number(it.quantity) || 1,
          productNo: it.product_no || null,
          variantCode: it.variant_code || '',
          orderItemCode: it.order_item_code || '',
          orderedAt: String(o.order_date || ''),
          msg,
          courier: '',
          invoice: '',
          sentDate: shipped ? String(o.order_date || '').slice(0, 10) : '',
          _shipped: shipped,
          _src: 'c24'
        });
      }
  }
  return parsed;
}

function setClaimSyncIssue(ret, system, action, message) {
  if (!Array.isArray(ret.syncIssues)) ret.syncIssues = [];
  ret.syncIssues = ret.syncIssues.filter(row => !(row.system === system && row.action === action));
  ret.syncIssues.push({ system, action, message: String(message || ''), at: new Date().toISOString() });
  if (ret.syncIssues.length > 20) ret.syncIssues = ret.syncIssues.slice(-20);
}

function clearClaimSyncIssue(ret, system, action) {
  if (!Array.isArray(ret.syncIssues)) ret.syncIssues = [];
  ret.syncIssues = ret.syncIssues.filter(row => !(row.system === system && row.action === action));
}

function cafe24ClaimResource(ret) {
  return ret.kind === '교환' ? 'exchange' : 'return';
}

function cafe24ClaimError(response) {
  return response.json && response.json.error && response.json.error.message || response.text && response.text.slice(0, 200) || '카페24가 요청을 처리하지 못했어요.';
}

async function cafe24ResolveClaimCode(db, token, ret) {
  const response = await cafe24Fetch(db, token, `/api/v2/admin/orders/${encodeURIComponent(ret.originalOrderNo)}?embed=items,return,exchange`);
  const order = response.status === 200 && response.json && response.json.order;
  if (!order) return '';
  const itemCodes = returnLineItems(ret).map(row => String(row.orderItemCode || ''));
  const resolved = resolveClaimCodeFromItems(order.items, itemCodes);
  if (resolved.orderStatus) ret.cafe24OrderStatus = resolved.orderStatus;
  return resolved.claimCode;
}

async function cafe24WriteClaim(db, ret, action, values) {
  if (ret.sourceChannel !== 'cafe24') return { ok: true, skipped: true };
  const claimLines = returnLineItems(ret);
  if (!String(ret.originalOrderNo || '').trim() || !hasValidClaimLines(ret)) throw new Error('카페24 주문번호 또는 품목코드가 없어 자동 반영할 수 없어요.');
  if (ret.kind === '교환' && ['create', 'accept'].includes(action) && !hasValidExchangeTargets(ret)) {
    throw new Error('교환으로 보낼 제품·컬러·사이즈를 먼저 골라 주세요.');
  }
  if (!['create', 'accept'].includes(action) && !ret.cafe24ClaimCode) throw new Error('카페24 교환·반품 번호가 아직 없어요. [지금 확인하기]를 눌러 주세요.');
  if (!ret.syncOps || typeof ret.syncOps !== 'object') ret.syncOps = {};
  const key = claimOperationKey(ret, action, values);
  const old = ret.syncOps[action];
  if (old && old.key === key && old.state === 'success') return { ok: true, skipped: true, claimCode: ret.cafe24ClaimCode };
  if (old && old.key === key && ['pending', 'unknown'].includes(old.state)) {
    throw new Error('카페24 처리 결과를 확인 중이에요. 상태 확인이 끝날 때까지 같은 작업을 다시 보내지 않습니다.');
  }
  ret.syncOps[action] = { key, state: 'pending', at: new Date().toISOString() };
  saveDb(db);
  try {
    const token = await cafe24EnsureToken(db);
    const resource = cafe24ClaimResource(ret);
    const creating = isClaimPostAction(action);
    const path = creating
      ? `/api/v2/admin/orders/${encodeURIComponent(ret.originalOrderNo)}/${resource}`
      : `/api/v2/admin/orders/${encodeURIComponent(ret.originalOrderNo)}/${resource}/${encodeURIComponent(ret.cafe24ClaimCode)}`;
    const body = creating ? buildCafe24ClaimCreate(ret) : buildCafe24ClaimUpdate(ret, action, values);
    const response = await cafe24Fetch(db, token, path, creating ? 'POST' : 'PUT', body);
    if (response.status < 200 || response.status >= 300) {
      const failure = new Error(cafe24ClaimError(response));
      failure.responseReceived = true;
      throw failure;
    }
    if (action === 'create') {
      let claimCode = extractCafe24ClaimCode(ret.kind, response.json, ret.cafe24ClaimCode);
      if (!claimCode) claimCode = await cafe24ResolveClaimCode(db, token, ret);
      if (claimCode) ret.cafe24ClaimCode = claimCode;
    }
    const unresolvedCreate = action === 'create' && !ret.cafe24ClaimCode;
    ret.syncOps[action] = { key, state: unresolvedCreate ? 'unknown' : 'success', at: new Date().toISOString() };
    ret.cafe24PushedAt = ret.syncOps[action].at;
    clearClaimSyncIssue(ret, 'cafe24', action);
    if (action === 'create' && !ret.cafe24ClaimCode) {
      setClaimSyncIssue(ret, 'cafe24', 'lookup', '카페24 접수는 됐고 접수번호를 확인 중이에요. 잠시 뒤 자동으로 연결됩니다.');
    } else {
      clearClaimSyncIssue(ret, 'cafe24', 'lookup');
    }
    appendClaimEvent(ret, action, 'shipping-helper', ret.cafe24ClaimCode || ret.originalOrderNo, ret.cafe24PushedAt);
    saveDb(db);
    return { ok: true, claimCode: ret.cafe24ClaimCode || '' };
  } catch (error) {
    const unknown = !error.responseReceived;
    ret.syncOps[action] = { key, state: unknown ? 'unknown' : 'failed', at: new Date().toISOString(), error: error.message };
    setClaimSyncIssue(ret, 'cafe24', action, unknown
      ? '카페24 응답이 중간에 끊겨 접수 여부를 확인 중이에요. 중복 방지를 위해 다시 접수하지 않았습니다.'
      : error.message);
    saveDb(db);
    throw error;
  }
}

// ---------- 우체국 계약소포 OpenAPI ----------
const httpMod = require('http');
function httpGetText(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = httpMod.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: {
        'Connection': 'keep-alive',
        'Host': u.hostname,
        'User-Agent': 'Apache-HttpClient/4.5.1 (Java/1.8.0_91)'
      },
      timeout: 20000
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('우체국 응답 시간 초과')); });
    req.on('error', reject);
  });
}
function xmlVal(xml, tag) {
  const m = String(xml).match(new RegExp('<' + tag + '>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</' + tag + '>'));
  return m ? m[1].trim() : '';
}
function epostConfigured(db) {
  const s = db.settings;
  return !!(s.epostApiKey && s.epostSecKey);
}
// regData 평문: k=v&k=v (값 안의 &,=는 제거)
function epostPlain(params) {
  return Object.entries(params)
    .filter(([, v]) => v != null && String(v) !== '')
    .map(([k, v]) => k + '=' + String(v).replace(/[&=\r\n]+/g, ' ').trim())
    .join('&');
}
async function epostCall(db, msgName, params) {
  const s = db.settings;
  const enc = seed.encryptHex(s.epostSecKey, epostPlain(params));
  const url = `http://ship.epost.go.kr/${msgName}?key=${encodeURIComponent(s.epostApiKey)}&regData=${enc}`;
  const xml = await httpGetText(url);
  const errCode = xmlVal(xml, 'error_code');
  if (errCode) throw new Error(errCode + ': ' + (xmlVal(xml, 'message') || '우체국 오류'));
  return xml;
}
// 연결: 아이디 → 고객번호 → 계약승인번호 → 공급지 코드 자동 조회
async function epostConnect(db) {
  const s = db.settings;
  const custXml = await epostCall(db, 'api.GetCustNo.jparcel', { memberID: s.epostMemberId });
  const custNo = xmlVal(custXml, 'custNo');
  if (!custNo) throw new Error('고객번호를 찾지 못했어요. 인터넷우체국 아이디를 확인해 주세요.');
  const apprXml = await epostCall(db, 'api.GetApprNo.jparcel', { custNo, statusCd: '1' }); // 승인 상태 계약만
  const apprNo = xmlVal(apprXml, 'apprNo');
  if (!apprNo) throw new Error('계약 승인번호를 찾지 못했어요.');
  const offXml = await epostCall(db, 'api.GetOfficeInfo.jparcel', { custNo });
  const officeSer = xmlVal(offXml, 'officeSer');
  const officeNm = xmlVal(offXml, 'officeNm');
  if (!officeSer) throw new Error('공급지(발송지) 정보가 없어요. 계약고객시스템 > 계약소포 > 기초정보 > 공급지관리에서 등록해 주세요.');
  db.epost = { custNo, apprNo, officeSer, officeNm, connectedAt: today() };
  saveDb(db);
  return db.epost;
}
// 소포 접수 (한 그룹 = 택배 1건). testYn='Y'면 실제 접수 안 됨
async function epostInsertOrder(db, g, orderNo, testYn) {
  const s = db.settings;
  const zip = String(g.zip || '').trim() || extractZip(g.addr);
  const addr = cleanAddr(g.addr);
  const addr1 = addr.slice(0, 140);
  const addr2 = addr.length > 140 ? addr.slice(140, 420) : '.';
  const content = parcelContent(g.items.map(({ item }) => item));
  const phone = String(g.phone || '').replace(/\D/g, ''); // 숫자만 허용
  const isMobile = phone.startsWith('01');
  const params = {
    custNo: db.epost.custNo,
    apprNo: db.epost.apprNo,
    payType: '1',
    reqType: '1',
    officeSer: db.epost.officeSer,
    microYn: 'N',
    orderNo,
    ordCompNm: (s.senderName || '누솔베르').slice(0, 90),
    recNm: String(g.name).slice(0, 38),
    recZip: zip,
    recAddr1: addr1,
    recAddr2: addr2,
    contCd: s.epostContCd || '025',
    goodsNm: (content.products || s.defaultContent || '의류').slice(0, 390),
    goodsMdl: content.models.slice(0, 390),
    qty: String(content.qty),
    delivMsg: g.msgs.filter(Boolean).join(' / ').slice(0, 190),
    printYn: 'Y',      // 운송장을 앱에서 직접 인쇄 (자체 출력)
    printAreaCdYn: 'Y' // 인쇄용 집배코드 받기
  };
  if (isMobile) params.recMob = phone; else if (phone) params.recTel = phone;
  if (testYn === 'Y') params.testYn = 'Y';
  const xml = await epostCall(db, 'api.InsertOrder.jparcel', params);
  return {
    regiNo: xmlVal(xml, 'regiNo'),
    reqNo: xmlVal(xml, 'reqNo'),
    resNo: xmlVal(xml, 'resNo'),
    price: xmlVal(xml, 'price'),
    label: { // 운송장 인쇄에 필요한 정보
      vTelNo: xmlVal(xml, 'vTelNo'),
      printAreaCd: xmlVal(xml, 'printAreaCd'),
      delivAreaCd: xmlVal(xml, 'delivAreaCd'),
      courseNo: xmlVal(xml, 'courseNo'),
      arrCnpoNm: xmlVal(xml, 'arrCnpoNm'),
      delivPoNm: xmlVal(xml, 'delivPoNm'),
      regipoNm: xmlVal(xml, 'regipoNm'),
      refineZip: xmlVal(xml, 'refineZip'),
      refineAddr: xmlVal(xml, 'refineAddr')
    }
  };
}

// 교환/반품 회수 접수 (reqType=2 반품소포): 집배원이 고객 주소로 방문해 물건을 회수, 공급지로 배달
async function epostInsertReturn(db, ret, orderNo, testYn) {
  const s = db.settings;
  const zip = String(ret.zip || '').trim() || extractZip(ret.addr);
  const addr = cleanAddr(ret.addr);
  const phone = String(ret.phone || '').replace(/\D/g, '');
  const isMobile = phone.startsWith('01');
  const params = {
    custNo: db.epost.custNo,
    apprNo: db.epost.apprNo,
    payType: '1',
    reqType: '2',              // 반품소포: rec* = 반품인(고객), 도착지 = 공급지(officeSer)
    officeSer: db.epost.officeSer,
    microYn: 'N',
    orderNo,
    ordCompNm: (s.senderName || '누솔베르').slice(0, 90),
    recNm: String(ret.name).slice(0, 38),
    recZip: zip,
    recAddr1: addr.slice(0, 140),
    recAddr2: addr.length > 140 ? addr.slice(140, 420) : '.',
    contCd: s.epostContCd || '025',
    goodsNm: (ret.product || s.defaultContent || '의류').slice(0, 390),
    goodsMdl: String(ret.option || '').slice(0, 390),
    qty: String(Number(ret.qty) || 1),
    delivMsg: String(ret.reason || '').slice(0, 190),
    retReason: String(ret.reason || '').slice(0, 38),
    printYn: 'N'               // 반품 운송장은 집배원이 가지고 방문
  };
  const orig = String(ret.origInvoice || '').replace(/\D/g, '');
  if (orig.length === 13) params.retOrigRegiNo = orig;
  if (isMobile) params.recMob = phone; else if (phone) params.recTel = phone;
  if (testYn === 'Y') params.testYn = 'Y';
  const xml = await epostCall(db, 'api.InsertOrder.jparcel', params);
  return {
    regiNo: xmlVal(xml, 'regiNo'),
    reqNo: xmlVal(xml, 'reqNo'),
    resNo: xmlVal(xml, 'resNo'),
    price: xmlVal(xml, 'price')
  };
}

async function epostCancelReturnPickup(db, ret) {
  if (!ret.epost) return { ok: true, skipped: true };
  await epostCall(db, 'api.GetResCancelCmd.jparcel', {
    custNo: db.epost.custNo,
    apprNo: db.epost.apprNo,
    reqType: '2',
    reqNo: ret.epost.reqNo,
    resNo: ret.epost.resNo,
    regiNo: String(ret.invoice || '').replace(/\D/g, ''),
    reqYmd: ret.epost.reqYmd,
    delYn: 'Y'
  });
  ret.lastEpost = Object.assign({}, ret.epost, { canceledAt: new Date().toISOString() });
  delete ret.epost;
  ret.invoice = '';
  ret.needsEpostCancel = false;
  if (ret.pickupOp) ret.pickupOp.state = 'canceled';
  clearClaimSyncIssue(ret, 'epost', 'cancel');
  appendClaimEvent(ret, 'pickup_canceled', 'epost', ret.lastEpost.orderNo || '');
  return { ok: true };
}

function returnPickupNeedsSync(ret) {
  if (ret.epost && ret.epost.orderNo) {
    if (ret.epost.stus === '05') return false;
    if (ret.epost.stus === '03') {
      return !!(ret.sourceChannel === 'cafe24' && ret.cafe24ClaimCode && (!ret.syncOps || !ret.syncOps.collected || ret.syncOps.collected.state !== 'success'));
    }
    return true;
  }
  return pickupOperationUnresolved(ret);
}

async function syncReturnPickup(db, ret, pushCafe24) {
  const orderNo = ret.epost && ret.epost.orderNo || ret.pickupOp && ret.pickupOp.orderNo;
  const reqYmd = ret.epost && ret.epost.reqYmd || String(ret.pickupOp && ret.pickupOp.at || '').slice(0, 10).replace(/-/g, '') || today().replace(/-/g, '');
  const xml = await epostCall(db, 'api.GetResInfo.jparcel', {
    custNo: db.epost.custNo, reqType: '2', orderNo, reqYmd
  });
  const stus = xmlVal(xml, 'treatStusCd');
  const regiNo = xmlVal(xml, 'regiNo');
  if (!stus && !regiNo) throw new Error('아직 우체국 접수 결과가 없어요.');
  if (stus === '05') {
    ret.lastEpost = Object.assign({}, ret.epost || {}, { orderNo, canceledAt: new Date().toISOString() });
    delete ret.epost;
    ret.invoice = '';
    if (ret.pickupOp) ret.pickupOp.state = 'canceled';
    ret.needsEpostCancel = false;
    ret.flowState = pickupCanceledFlowState(ret);
    ret.status = statusForFlowState(ret.flowState);
    clearClaimSyncIssue(ret, 'epost', 'pickup');
    appendClaimEvent(ret, 'pickup_canceled', 'epost', orderNo);
    return { changed: true, status: stus };
  }
  ret.epost = {
    orderNo,
    reqNo: xmlVal(xml, 'reqNo') || ret.epost && ret.epost.reqNo || '',
    resNo: xmlVal(xml, 'resNo') || ret.epost && ret.epost.resNo || '',
    reqYmd,
    stus: stus || ret.epost && ret.epost.stus || '01',
    price: xmlVal(xml, 'price') || ret.epost && ret.epost.price || ''
  };
  if (shouldCancelRecoveredPickup(ret)) ret.needsEpostCancel = true;
  if (regiNo && regiNo !== 'TESTREGINOAPI') ret.invoice = regiNo;
  if (ret.pickupOp) ret.pickupOp.state = 'success';
  if (stus === '03') {
    if (shouldApplyPickupProgress(ret)) {
      ret.flowState = 'collected';
      ret.status = statusForFlowState(ret.flowState);
      appendClaimEvent(ret, 'collected', 'epost', ret.invoice || orderNo);
      if (pushCafe24 && ret.sourceChannel === 'cafe24' && ret.cafe24ClaimCode) {
        const carrierId = await cafe24ClaimCarrierId(db, ret);
        await cafe24WriteClaim(db, ret, 'collected', { invoice: ret.invoice || '', carrierId });
      }
    } else {
      appendClaimEvent(ret, 'pickup_found_while_canceling', 'epost', ret.invoice || orderNo);
    }
  } else if (!ret.localCompleted && !['completed', 'canceled'].includes(ret.flowState)) {
    ret.flowState = 'pickup_booked';
    ret.status = statusForFlowState(ret.flowState);
  }
  clearClaimSyncIssue(ret, 'epost', 'pickup');
  return { changed: true, status: stus };
}

// 카페24 제품 목록(품번/이미지) 가져오기 - 제품 사진 표시와 이름 매칭용
async function cafe24FetchProducts(db) {
  const token = await cafe24EnsureToken(db);
  const list = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await cafe24Fetch(db, token, `/api/v2/admin/products?limit=100&offset=${offset}&embed=variants,inventories`);
    if (r.status !== 200 || !r.json) throw new Error('제품 조회 실패(' + r.status + ')');
    const products = r.json.products || [];
    for (const p of products) {
      const productColorMatch = String(p.product_name || '').match(/\(([^()]+)\)\s*$/);
      const productColor = productColorMatch ? productColorMatch[1].trim() : '';
      const variants = (p.variants || []).map(v => {
        const stock = cafe24VariantInventory(v);
        let color = '', size = '';
        for (const option of (v.options || [])) {
          const name = String(option.name || option.option_name || '').toLowerCase();
          const value = String(option.value || option.option_value || '').trim();
          if (name.includes('색상') || name.includes('color')) color = value;
          else if (name.includes('사이즈') || name.includes('size')) size = value;
        }
        return {
          variantCode: v.variant_code || '', customVariantCode: v.custom_variant_code || '',
          color: color || productColor, size, display: v.display, selling: v.selling,
          cafe24Qty: stock.quantity, cafe24StockTracked: stock.tracked,
          cafe24SafetyInventory: stock.safetyInventory,
          cafe24InventoryControlType: stock.controlType
        };
      });
      list.push({
        no: p.product_no,
        name: p.product_name || '',
        code: p.product_code || '',
        img: p.list_image || p.small_image || p.tiny_image || p.detail_image || '',
        variants
      });
    }
    if (products.length < 100) break;
  }
  db.products = list;
  db.productsAt = today();
  db.productsStockAt = new Date().toISOString();
  db.productsSchema = 3;
  return list.length;
}

// 카페24 제품 → 재고 자동 등록 (이름 글자 비교로 중복 방지, 새 제품은 qty 0)
function syncInventoryFromProducts(db) {
  const lo = s => String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const existing = new Set(db.inventory.map(i => lo(i.name)));
  let added = markMissingCafe24Variants(db.inventory, db.products, db.productsStockAt);
  for (const p of (db.products || [])) {
    if (!p.name) continue;
    if ((db.inventoryHidden || []).includes(p.no)) continue; // 사용자가 지운 제품은 다시 안 넣음
    if (Array.isArray(p.variants) && p.variants.length) {
      const hasSizedVariants = p.variants.some(v => String(v.size || '').trim());
      for (const aggregate of db.inventory.filter(i =>
        !i.variantCode && !i.size && (String(i.productNo || '') === String(p.no) || lo(i.name) === lo(p.name)))) {
        aggregate.productNo = p.no;
        const productColorMatch = String(p.name || '').match(/\(([^()]+)\)\s*$/);
        if (!aggregate.color && productColorMatch) aggregate.color = productColorMatch[1].trim();
        const hasAggregateStock = (Number(aggregate.qty) || 0) > 0;
        aggregate.needsAllocation = hasSizedVariants && hasAggregateStock;
        aggregate.retiredAggregate = hasSizedVariants && !hasAggregateStock;
        aggregate.sku = inventorySku(aggregate);
      }
      for (const v of p.variants) {
        let inv = db.inventory.find(i => v.variantCode && i.variantCode === v.variantCode);
        const ambiguousIdentity = variantIdentityAmbiguous(p.variants, v);
        if (!inv && !ambiguousIdentity) {
          const exactCandidates = db.inventory.filter(i =>
            (!i.variantCode || String(i.variantCode) === String(v.variantCode)) &&
            String(i.productNo || '') === String(p.no) &&
            lo(i.color) === lo(v.color) &&
            String(i.size || '').trim().toUpperCase() === String(v.size || '').trim().toUpperCase());
          if (exactCandidates.length === 1) inv = exactCandidates[0];
        }
        if (!inv && !ambiguousIdentity) {
          const sameSizeVariants = p.variants.filter(candidate =>
            String(candidate.size || '').trim().toUpperCase() === String(v.size || '').trim().toUpperCase());
          const variantColors = new Set(sameSizeVariants.map(candidate => lo(candidate.color)).filter(Boolean));
          const candidates = db.inventory.filter(i => (!i.variantCode || String(i.variantCode) === String(v.variantCode)) && lo(i.name) === lo(p.name) &&
            String(i.size || '').trim().toUpperCase() === String(v.size || '').trim().toUpperCase() &&
            (!i.color || lo(i.color) === lo(v.color)));
          if (candidates.length === 1 && (candidates[0].color || variantColors.size <= 1)) inv = candidates[0];
        }
        if (inv) {
          inv.productNo = p.no;
          inv.variantCode = v.variantCode;
          if (!inv.color && v.color) inv.color = v.color;
          if (!inv.size && v.size) inv.size = v.size;
          inv.needsCount = inv.qty === null || inv.qty === undefined;
          inv.cafe24Qty = v.cafe24Qty;
          inv.cafe24StockTracked = v.cafe24StockTracked;
          inv.cafe24VariantActive = true;
          inv.cafe24Display = v.display;
          inv.cafe24Selling = v.selling;
          inv.cafe24SafetyInventory = v.cafe24SafetyInventory;
          inv.cafe24InventoryControlType = v.cafe24InventoryControlType;
          inv.cafe24StockAt = db.productsStockAt || '';
          inv.sku = inventorySku(inv);
          continue;
        }
        const item = {
          id: db.nextId++, name: p.name, color: v.color, size: v.size, qty: null,
          productNo: p.no, variantCode: v.variantCode, needsCount: true,
          cafe24Qty: v.cafe24Qty, cafe24StockTracked: v.cafe24StockTracked,
          cafe24VariantActive: true, cafe24Display: v.display, cafe24Selling: v.selling,
          cafe24SafetyInventory: v.cafe24SafetyInventory,
          cafe24InventoryControlType: v.cafe24InventoryControlType,
          cafe24StockAt: db.productsStockAt || ''
        };
        item.sku = inventorySku(item);
        db.inventory.push(item);
        added++;
      }
      existing.add(lo(p.name));
      continue;
    }
    if (existing.has(lo(p.name))) {
      // 이미 있는 재고엔 제품번호만 붙여줌 (판매페이지 링크/사진용)
      const inv = db.inventory.find(i => lo(i.name) === lo(p.name));
      if (inv && !inv.productNo) inv.productNo = p.no;
      continue;
    }
    existing.add(lo(p.name));
    const item = { id: db.nextId++, name: p.name, color: '', size: '', qty: null, productNo: p.no, needsCount: true };
    item.sku = inventorySku(item);
    db.inventory.push(item);
    added++;
  }
  return added;
}

// 주소 → 우편번호 자동 변환 (카카오 REST 키가 설정된 경우만)
async function kakaoZip(db, addr) {
  const key = (db.settings.kakaoRestKey || '').trim();
  if (!key) return '';
  for (const candidate of postalAddressCandidates(addr)) {
    const q = encodeURIComponent(candidate.query);
    const r = await httpsJson('GET', 'https://dapi.kakao.com/v2/local/search/address.json?query=' + q,
      { Authorization: 'KakaoAK ' + key }, null);
    if (r.status === 401 || r.status === 403) throw new Error('카카오 주소검색 키를 다시 확인해 주세요.');
    if (r.status !== 200) throw new Error('카카오 주소검색 응답 오류 (' + r.status + ')');
    const docs = r.json && Array.isArray(r.json.documents) ? r.json.documents : [];
    const zip = postalZipFromDocuments(docs);
    if (zip) return zip;
  }
  return '';
}
function zipLookupAddressKey(addr) {
  return gateCrypto.createHash('sha256').update(cleanAddr(addr)).digest('hex').slice(0, 16);
}
function clearZipLookupState(item) {
  delete item._zipTried;
  delete item._zipTriedAddr;
  delete item._zipLookupVersion;
  delete item.zipLookupError;
}
function markZipLookupFailure(item, message) {
  item._zipTried = today();
  item._zipTriedAddr = zipLookupAddressKey(item.addr);
  item._zipLookupVersion = ZIP_LOOKUP_VERSION;
  item.zipLookupError = message;
}
async function fillMissingZips(db) {
  if (!(db.settings.kakaoRestKey || '').trim()) return 0;
  const need = [...db.orders, ...db.seeding].filter(x =>
    (x.status === '대기' || x.status === '접수중') && x.addr &&
    !/^\d{5}$/.test(String(x.zip || '').trim()) && !extractZip(x.addr) &&
    postalLookupDue(x, today(), zipLookupAddressKey(x.addr), ZIP_LOOKUP_VERSION, false)
  ).slice(0, 5);
  let changed = 0;
  for (const it of need) {
    try {
      const z = await kakaoZip(db, it.addr);
      if (/^\d{5}$/.test(z)) {
        it.zip = z;
        clearZipLookupState(it);
      } else {
        markZipLookupFailure(it, '주소를 자동으로 찾지 못했어요. 도로명·건물번호를 확인해 주세요.');
      }
      changed++;
    } catch (e) {
      markZipLookupFailure(it, '우편번호 조회 연결에 문제가 있어요. [다시 찾기]를 눌러 주세요.');
      changed++;
    }
  }
  return changed;
}

// ---------- 설정 자동 배달 ----------
// 노트북에서 만든 sync-settings.enc(우체국 보안키로 암호화)를 풀어 빈 설정을 채움
// — 키 같은 값을 공개 저장소에 평문으로 올리지 않고도 다른 PC에 자동 전달
function applySyncedSettings(db) {
  try {
    const f = path.join(__dirname, 'sync-settings.enc');
    const sec = (db.settings.epostSecKey || '').trim();
    if (!sec || !fs.existsSync(f)) return false;
    const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (pkg.v !== 1 && pkg.v !== 2) return false;
    const crypto = require('crypto');
    const key = crypto.createHash('sha256').update(sec).digest();
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(pkg.iv, 'base64'));
    d.setAuthTag(Buffer.from(pkg.tag, 'base64'));
    const vals = JSON.parse(Buffer.concat([d.update(Buffer.from(pkg.data, 'base64')), d.final()]).toString('utf8'));
    let changed = false;
    // 새 배달분(stamp가 바뀜)이면 값 교체까지 허용, 같은 배달분이면 빈 칸만 채움
    const fresh = pkg.stamp && db._syncStamp !== pkg.stamp;
    for (const [k, v] of Object.entries(vals)) {
      if (v == null || v === '') continue;
      const cur = String(db.settings[k] || '').trim();
      if (fresh ? cur !== String(v) : !cur) { db.settings[k] = v; changed = true; }
    }
    if (fresh) { db._syncStamp = pkg.stamp; changed = true; }
    return changed;
  } catch (e) { return false; } // 보안키가 다르거나 파일이 깨졌으면 조용히 무시
}

// ---------- 자동 백업 (하루 1개, 30일 보관) ----------
const BACKUP_DIR = path.join(DATA_DIR, 'backup');
function backupDb() {
  try {
    if (!fs.existsSync(DB_PATH)) return;
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const f = path.join(BACKUP_DIR, 'db-' + today() + '.json');
    if (!fs.existsSync(f)) fs.copyFileSync(DB_PATH, f);
    const files = fs.readdirSync(BACKUP_DIR).filter(x => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort();
    while (files.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  } catch (e) { console.error('백업 실패:', e.message); }
}

// ---------- 자동 동기화 ----------
const syncStatus = {
  lastRun: null, lastOk: null,
  google: { ok: null, error: null, added: 0 },
  cafe24: { configured: false, connected: false, ok: null, error: null, added: 0 },
  reconciliation: { pending: 0, lastRun: null }
};

async function writeSheetSchemaStatus(db, schema) {
  const webhook = String(db.settings.sheetWebhookUrl || '').trim();
  if (!webhook) return { ok: false, error: '구글시트 자동기록 주소가 설정되지 않았어요.' };
  const headers = { 'Content-Type': 'application/json' };
  const token = db.settings.sheetWebhookToken || '';
  const capability = await httpsJson('POST', webhook, headers, { token, action: 'capabilities' });
  if (!(capability.status >= 200 && capability.status < 300 && capability.json && capability.json.schemaStatus === true)) {
    return { ok: false, error: '구글시트 자동기록 스크립트를 최신 버전으로 바꿔 주세요.' };
  }
  const response = await httpsJson('POST', webhook, headers, {
    token,
    action: 'schemaStatus',
    status: schema.ok ? '정상' : '확인 필요',
    level: schema.level,
    checkedAt: schema.checkedAt,
    sheetName: schema.sheetName,
    headerCount: schema.headerCount,
    message: schema.message,
    missing: schema.missing,
    duplicates: schema.duplicates
  });
  if (!(response.status >= 200 && response.status < 300 && response.json && response.json.ok && response.json.schemaStatus)) {
    return { ok: false, error: response.json && response.json.error || `시트 경고 기록 실패 (${response.status})` };
  }
  return { ok: true };
}

async function updateSheetSchema(db, rawSchema, sheetName) {
  const previous = db.sheetSchema || {};
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(rawSchema.headers || [])).digest('hex');
  const knownBefore = !!previous.fingerprint;
  const headersChanged = knownBefore && previous.fingerprint !== fingerprint ||
    previous.fingerprint === fingerprint && previous.level === 'warning';
  const level = rawSchema.ok ? (headersChanged ? 'warning' : 'ok') : 'error';
  const message = rawSchema.ok && headersChanged
    ? '시트 열 구성이 바뀌었지만 배송에 필요한 연결 열은 모두 정상입니다.'
    : rawSchema.message;
  const schema = {
    ok: rawSchema.ok,
    level,
    message,
    checkedAt: '',
    sheetName,
    headerCount: rawSchema.headerCount,
    missing: rawSchema.missing || [],
    duplicates: rawSchema.duplicates || [],
    fingerprint,
    headersChanged
  };
  const stateChanged = previous.fingerprint !== fingerprint || previous.ok !== schema.ok || previous.level !== schema.level;
  const lastAttempt = new Date(previous.notifyAttemptAt || 0).getTime();
  const retryDue = previous.notifyOk !== true && (!Number.isFinite(lastAttempt) || Date.now() - lastAttempt >= 30 * 60 * 1000);
  const checkedAt = stateChanged || retryDue ? new Date().toISOString() : previous.checkedAt || new Date().toISOString();
  schema.checkedAt = checkedAt;
  if (stateChanged || retryDue) {
    schema.notifyAttemptAt = checkedAt;
    try {
      const result = await writeSheetSchemaStatus(db, schema);
      schema.notifyOk = result.ok;
      schema.notifyError = result.error || '';
    } catch (error) {
      schema.notifyOk = false;
      schema.notifyError = error.message;
    }
  } else {
    schema.notifyAttemptAt = previous.notifyAttemptAt || '';
    schema.notifyOk = previous.notifyOk === true;
    schema.notifyError = previous.notifyError || '';
  }
  db.sheetSchema = schema;
  return JSON.stringify(previous) !== JSON.stringify(schema);
}

async function syncGoogle(db) {
  const sid = sheetIdOf(db);
  if (!sid) throw new Error('구글시트 주소가 없어요. 설정에서 시딩 구글시트 주소를 넣어 주세요.');
  const buf = await fetchUrl(`https://docs.google.com/spreadsheets/d/${sid}/export?format=xlsx`, 0);
  const wb = XLSX.read(buf, { type: 'buffer' });
  let seedRes = { added: 0, updated: 0 };
  const normalizeSheetName = value => String(value || '').replace(/\s/g, '').toLowerCase();
  const exactSeedName = wb.SheetNames.find(name => normalizeSheetName(name) === normalizeSheetName(SHEET_SEEDING));
  const seedCandidates = wb.SheetNames.filter(name => ['시딩', '발송'].every(word => normalizeSheetName(name).includes(word)));
  if (!exactSeedName && seedCandidates.length > 1) {
    throw new Error('시딩 발송 탭이 여러 개라 자동으로 고를 수 없습니다. 사용할 탭 이름을 [02. 시딩 발송 리스트]로 맞춰 주세요.');
  }
  const seedName = exactSeedName || seedCandidates[0];
  if (!seedName) throw new Error('구글시트에서 [시딩 발송 리스트] 탭을 찾지 못했습니다. 탭 이름을 확인해 주세요.');
  const schema = {};
  let parsed;
  try {
    parsed = parseSeedingSheet(wb.Sheets[seedName], schema);
  } catch (error) {
    if (schema.headers) await updateSheetSchema(db, Object.assign(schema, { ok: false, message: error.message }), seedName);
    throw error;
  }
  const sheetSchemaChanged = await updateSheetSchema(db, schema, seedName);
  seedRes = mergeSeeding(db, parsed);
  return { seeding: seedRes, orders: { added: 0, updated: 0 }, sheetSchemaChanged };
}
// 우체국 배달완료 자동 확인 (키 불필요, 회당 10건):
// 조회 페이지의 hidden input #deliveryVal 값이 "배달완료"/"수취함투함"일 때만 완료 —
// 우체국 페이지 자신이 STEP4 표시에 쓰는 것과 동일한 기준 (본문 글자 검색은 항상 있는 라벨 때문에 오탐)
async function checkDelivered(db) {
  const targets = [...db.orders, ...db.seeding].filter(x =>
    x.status === '발송완료' && !x.delivered &&
    String(x.invoice || '').replace(/\D/g, '').length === 13 &&
    (!x.courier || x.courier === '우체국')
  ).slice(0, 10);
  let found = 0;
  for (const it of targets) {
    const no = String(it.invoice).replace(/\D/g, '');
    try {
      const html = (await fetchUrl('https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=' + no, 0)).toString('utf8');
      const m = html.match(/id="deliveryVal"[^>]*value="([^"]*)"/) || html.match(/value="([^"]*)"[^>]*id="deliveryVal"/);
      const val = m ? m[1].trim() : '';
      const delivered = val === '배달완료' || val === '수취함투함';
      for (const arr of [db.orders, db.seeding]) {
        for (const o of arr) {
          if (String(o.invoice || '').replace(/\D/g, '') === no) {
            applyCarrierDeliveryResult(o, { delivered, checked: !!m }, today());
            found++;
          }
        }
      }
    } catch (e) {
      it.deliveryCheckStatus = '확인필요';
      it.deliveryCheckReason = '우체국 조회 실패';
      found++;
    }
  }
  // 롯데 송장(숫자 12자리)은 롯데글로벌로지스 조회 페이지로 실제 배달완료 확인
  const lotte = [...db.orders, ...db.seeding].filter(x =>
    x.status === '발송완료' && !x.delivered &&
    String(x.invoice || '').replace(/\D/g, '').length === 12 &&
    (!x.courier || x.courier === '롯데' || /롯데/.test(String(x.invoice)))
  ).slice(0, 10);
  for (const it of lotte) {
    const no = String(it.invoice).replace(/\D/g, '');
    try {
      const html = (await fetchUrl('https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=' + no, 0)).toString('utf8');
      const result = parseLotteDeliveryStatus(html);
      for (const arr of [db.orders, db.seeding]) {
        for (const o of arr) {
          if (String(o.invoice || '').replace(/\D/g, '') === no) {
            applyCarrierDeliveryResult(o, result, today());
            found++;
          }
        }
      }
    } catch (e) {
      it.deliveryCheckStatus = '확인필요';
      it.deliveryCheckReason = '롯데 조회 실패';
      found++;
    }
  }
  for (const arr of [db.orders, db.seeding]) {
    for (const o of arr) {
      if (o.status !== '발송완료' || o.delivered) continue;
      const courier = String(o.courier || '');
      const invoiceLength = String(o.invoice || '').replace(/\D/g, '').length;
      if (!((!courier || courier === '우체국') && invoiceLength === 13) &&
          !((!courier || courier === '롯데') && invoiceLength === 12) &&
          o.deliveryCheckStatus !== '확인필요') {
        o.deliveryCheckStatus = '확인필요';
        o.deliveryCheckReason = '택배사 자동조회 미연결';
        found++;
      }
    }
  }
  return found;
}

async function syncAll() {
  const db = loadDb();
  // 보기 모드(노트북): 구글시트·우체국·우편번호는 실시간 동기화하되,
  // 카페24만 건너뜀 (두 PC가 동시에 붙으면 토큰이 서로 뺏겨 매장 연결이 풀림)
  syncStatus.lastRun = new Date().toISOString();
  let changed = false;
  const emptyResult = () => ({ added: 0, updated: 0, canceled: 0, existing: 0, ordersAdded: 0, ordersExisting: 0 });
  const out = { seeding: emptyResult(), orders: emptyResult(), cafe24: emptyResult() };
  const beforeGoogleSchema = JSON.stringify(db.sheetSchema || null);
  try {
    const g = await syncGoogle(db);
    out.seeding = g.seeding; out.orders = g.orders;
    syncStatus.google = { ok: true, error: null, added: g.seeding.added + g.orders.added, schema: db.sheetSchema };
    if (g.sheetSchemaChanged) changed = true;
    if ([g.seeding, g.orders].some(result => ['added', 'updated', 'canceled'].some(key => Number(result[key] || 0) > 0))) changed = true;
  } catch (e) {
    syncStatus.google = { ok: false, error: e.message, added: 0, schema: db.sheetSchema };
    if (JSON.stringify(db.sheetSchema || null) !== beforeGoogleSchema) changed = true;
  }
  syncStatus.cafe24.configured = cafe24Configured(db);
  syncStatus.cafe24.connected = !!db.cafe24Token;
  // 카페24 담당: 매장 PC가 켜져 있으면 매장이, 꺼져 있으면 노트북이 이어받음 (동시 접속만 피하면 됨)
  const c24Skip = VIEW_ONLY && await storeAliveCached();
  if (!c24Skip && cafe24Configured(db) && db.cafe24Token) {
    try {
      const parsed = await cafe24FetchOrders(db);
      const r = mergeOrders(db, parsed);
      out.cafe24 = r;
      syncStatus.cafe24 = { configured: true, connected: true, ok: true, error: null, added: r.added };
      changed = true;
      for (const ret of db.returns.filter(row => row.needsEpostCancel && row.epost)) {
        try {
          await epostCancelReturnPickup(db, ret);
        } catch (error) {
          setClaimSyncIssue(ret, 'epost', 'cancel', '카페24에서는 취소됐지만 우체국 회수 취소 실패: ' + error.message);
        }
      }
      for (const ret of db.returns.filter(row => row.sourceChannel === 'cafe24' && row.syncOps && row.syncOps.create && ['pending', 'unknown'].includes(row.syncOps.create.state))) {
        try {
          const token = ret.cafe24ClaimCode ? null : await cafe24EnsureToken(db);
          const claimCode = ret.cafe24ClaimCode || await cafe24ResolveClaimCode(db, token, ret);
          if (claimCode) {
            ret.cafe24ClaimCode = claimCode;
            ret.syncOps.create.state = 'success';
            clearClaimSyncIssue(ret, 'cafe24', 'create');
            clearClaimSyncIssue(ret, 'cafe24', 'lookup');
            changed = true;
          } else {
            ret.syncOps.create.state = 'unknown';
            setClaimSyncIssue(ret, 'cafe24', 'create', '카페24 접수 여부를 계속 확인 중이에요. 중복 접수를 막기 위해 자동 재접수하지 않습니다.');
            changed = true;
          }
        } catch (error) {
          setClaimSyncIssue(ret, 'cafe24', 'lookup', '카페24 접수번호 확인 실패: ' + error.message);
          changed = true;
        }
      }
      for (const ret of db.returns.filter(row => row.sourceChannel === 'cafe24' && row.syncOps && row.syncOps.accept && ['pending', 'unknown'].includes(row.syncOps.accept.state))) {
        const stage = cafe24ClaimStage(ret.cafe24OrderStatus);
        if (!['requested', 'unknown'].includes(stage)) {
          ret.syncOps.accept.state = 'success';
          clearClaimSyncIssue(ret, 'cafe24', 'accept');
          changed = true;
        } else {
          ret.syncOps.accept.state = 'unknown';
          setClaimSyncIssue(ret, 'cafe24', 'accept', '카페24 승인 여부를 계속 확인 중이에요. 중복 승인을 막기 위해 자동 재승인하지 않습니다.');
          changed = true;
        }
      }
      for (const ret of db.returns.filter(row => row.sourceChannel === 'cafe24' && row.syncOps)) {
        const stage = cafe24ClaimStage(ret.cafe24OrderStatus);
        const resolved = {
          complete: ['completed', 'refund_pending'].includes(stage),
          cancel: stage === 'canceled',
          collected: ['collected', 'processing', 'completed', 'refund_pending'].includes(stage),
          invoice: !!ret.cafe24ReturnInvoice &&
            String(ret.cafe24ReturnInvoice).replace(/\D/g, '') === String(ret.invoice || '').replace(/\D/g, '')
        };
        for (const [action, ok] of Object.entries(resolved)) {
          const op = ret.syncOps[action];
          if (!ok || !op || !['pending', 'unknown'].includes(op.state)) continue;
          op.state = 'success';
          clearClaimSyncIssue(ret, 'cafe24', action);
          changed = true;
        }
      }
      // 카페24에서 직접 배송처리한 주문의 송장번호를 회수해 채움 (앱 밖 발송 매칭)
      const codeMap = { '0012': '우체국', '0013': '우체국', '0079': '롯데', '0006': 'CJ대한통운', '0018': '한진', '0004': '로젠' };
      const needInv = db.orders.filter(o => o.status === '발송완료' && !o.invoice && o.orderNo).slice(0, 5);
      for (const o of needInv) {
        try {
          const token2 = await cafe24EnsureToken(db);
          const r2 = await cafe24Fetch(db, token2, `/api/v2/admin/orders/${o.orderNo}/shipments`);
          const sh = r2.json && r2.json.shipments && r2.json.shipments.find(x => x.tracking_no);
          if (sh) {
            for (const oo of db.orders) {
              if (oo.orderNo === o.orderNo && !oo.invoice) {
                oo.invoice = sh.tracking_no;
                oo.courier = codeMap[String(sh.shipping_company_code)] || oo.courier || '';
                oo.cafe24Shipped = true;
              }
            }
          }
        } catch (e) { /* 다음 동기화 때 재시도 */ }
      }
    } catch (e) {
      syncStatus.cafe24 = { configured: true, connected: !!db.cafe24Token, ok: false, error: e.message, added: 0 };
    }
    const productsStockAge = Date.now() - new Date(db.productsStockAt || 0).getTime();
    if (!db.products || db.productsSchema !== 3 || !Number.isFinite(productsStockAge) || productsStockAge >= 4 * 60 * 1000) {
      try { await cafe24FetchProducts(db); changed = true; } catch (e) { /* 다음 동기화 때 재시도 */ }
    }
  }
  // 카페24 제품이 재고 목록에 전부 있도록 자동 등록 (새 제품은 수량 0으로)
  if (syncInventoryFromProducts(db) > 0) changed = true;
  // 노트북에서 보낸 설정(카카오 키 등) 자동 반영
  if (applySyncedSettings(db)) changed = true;
  // 우편번호 없는 건 자동 채우기 (카카오 키 설정 시)
  if (await fillMissingZips(db) > 0) changed = true;
  if (epostConfigured(db) && db.epost) {
    for (const ret of (db.returns || []).filter(returnPickupNeedsSync).slice(0, 30)) {
      try {
        await syncReturnPickup(db, ret, !c24Skip);
        changed = true;
      } catch (error) {
        setClaimSyncIssue(ret, 'epost', 'pickup', '우체국 회수 상태 확인 실패: ' + error.message);
        changed = true;
      }
    }
    for (const ret of (db.returns || []).filter(row => row.needsEpostCancel && row.epost)) {
      try {
        await epostCancelReturnPickup(db, ret);
        changed = true;
      } catch (error) {
        setClaimSyncIssue(ret, 'epost', 'cancel', '우체국 회수 취소 실패: ' + error.message);
        changed = true;
      }
    }
  }
  const reconciliationItems = [];
  for (const item of db.orders || []) {
    const needsCafe24 = (item.syncIssues || []).some(issue => issue.system === 'cafe24' && issue.action === 'shipment');
    if (item.status === '발송완료' && needsCafe24 && !c24Skip) reconciliationItems.push({ type: 'order', item });
  }
  for (const item of db.seeding || []) {
    const needsSheet = (item.syncIssues || []).some(issue => issue.system === 'sheet' && issue.action === 'invoice');
    if (item.status === '발송완료' && needsSheet) reconciliationItems.push({ type: 'seeding', item });
  }
  syncStatus.reconciliation = { pending: reconciliationItems.length, lastRun: new Date().toISOString() };
  if (reconciliationItems.length) {
    await postProcessShipped(db, reconciliationItems);
    changed = true;
    syncStatus.reconciliation.pending = reconciliationItems.filter(({ item }) => (item.syncIssues || []).some(issue =>
      (issue.system === 'cafe24' && issue.action === 'shipment') ||
      (issue.system === 'sheet' && issue.action === 'invoice')
    )).length;
  }
  const cancelWarnings = await retryCanceledExternalUpdates(db, !c24Skip);
  if (cancelWarnings.length) changed = true;
  backupDb(); // 하루 1개 자동 백업
  try { if (await checkDelivered(db)) changed = true; } catch (e) { /* 무시 */ }
  if (changed) saveDb(db);
  syncStatus.lastOk = syncStatus.google.ok || syncStatus.cafe24.ok ? new Date().toISOString() : syncStatus.lastOk;
  return { db, out };
}

// ---------- 시딩 시트 파싱 ----------
function parseSeedingSheet(ws, schemaOut) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) return [];
  const H = rows[0];
  const sourceIdCol = H.findIndex(value => ['column13', '시딩번호', '관리번호'].includes(String(value || '').replace(/\s/g, '').toLowerCase()));
  const col = {
    date: findCol(H, ['작성일']),
    pack: findCol(H, ['시딩형태', '타임스탬프']),
    type: findCol(H, ['시딩형태']),
    email: findCol(H, ['이메일']),
    name: findCol(H, ['성명']),
    insta: findCol(H, ['인스타그램']),
    phone: findCol(H, ['연락처']),
    addr: findCol(H, ['상세주소', '주소']),
    zip: findCol(H, ['우편번호']),
    product: findExactSeedingCol(H, ['제품명', '희망제품', '제품정보']),
    color: findExactSeedingCol(H, ['컬러', '색상']),
    size: findExactSeedingCol(H, ['사이즈', '희망사이즈', '사이즈선택']),
    selectedOption: findExactSeedingCol(H, ['상품옵션선택', '상품·옵션선택']),
    masterProduct: findExactSeedingCol(H, ['상품명자동', '상품명(자동)']),
    masterColor: findExactSeedingCol(H, ['컬러자동', '컬러(자동)']),
    masterSize: findExactSeedingCol(H, ['사이즈자동', '사이즈(자동)']),
    masterProductNo: findExactSeedingCol(H, ['상품번호자동', '상품번호(자동)']),
    variantCode: findExactSeedingCol(H, ['옵션품번자동', '옵션품번(자동)', '옵션품번']),
    request: findCol(H, ['기타요청', '전달메세지', '전달메시지']),
    sentDate: findCol(H, ['발송일']),
    invoice: findCol(H, ['송장번호']),
    stock: findCol(H, ['재고반영']),
    note: findCol(H, ['비고'])
  };
  const schema = inspectSeedingSchema(H, col, sourceIdCol);
  if (schemaOut && typeof schemaOut === 'object') Object.assign(schemaOut, schema);
  if (!schema.ok) throw new Error(schema.message + ' 시트 머리글을 확인해 주세요.');
  const out = [];
  const sourceIds = new Set();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(col.name >= 0 ? row[col.name] : '').trim();
    const phone = phoneDigits(col.phone >= 0 ? row[col.phone] : '');
    if (!name || phone.length < 9) continue; // 그룹 구분행 등 스킵
    const sourceRowId = stableSheetRowId(row[sourceIdCol]);
    if (!sourceRowId) throw new Error(`시딩 시트 ${r + 1}행의 고유번호가 비어 있어 동기화를 중지했습니다.`);
    if (sourceIds.has(sourceRowId)) throw new Error(`시딩 시트 고유번호 ${sourceRowId}가 두 번 있어 동기화를 중지했습니다.`);
    sourceIds.add(sourceRowId);
    out.push(Object.assign({
      sourceRowId,
      name: name.replace(/\s*-\s*엽서.*$/, '').trim(),
      insta: String(col.insta >= 0 ? row[col.insta] : '').trim(),
      phone: String(col.phone >= 0 ? row[col.phone] : '').trim(),
      addr: String(col.addr >= 0 ? row[col.addr] : '').trim(),
      zip: String(col.zip >= 0 ? row[col.zip] : '').replace(/\D/g, '').slice(0, 5),
      seedType: String(col.type >= 0 ? row[col.type] : '').trim(),
      packType: normalizeSeedingPacking(col.pack >= 0 ? row[col.pack] : ''),
      email: String(col.email >= 0 ? row[col.email] : '').trim(),
      request: String(col.request >= 0 ? row[col.request] : '').trim(),
      sentDate: excelDate(col.sentDate >= 0 ? row[col.sentDate] : ''),
      invoice: String(col.invoice >= 0 ? row[col.invoice] : '').trim(),
      note: String(col.note >= 0 ? row[col.note] : '').trim()
    }, seedingProductFields(row, col)));
  }
  return out;
}

// ---------- 주문 시트/카페24 엑셀 파싱 ----------
function parseOrderRows(rows) {
  // 헤더 행 찾기 (앞 10행 안에서 '수령인'류 + '주소'류가 함께 있는 행)
  let hIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const nc = findCol(rows[i], ['수령인', '받는사람', '받는분', '수취인']);
    const ac = findCol(rows[i], ['주소']);
    if (nc >= 0 && ac >= 0) { hIdx = i; break; }
  }
  if (hIdx < 0) return { error: '엑셀에서 수령인/주소 열을 찾지 못했습니다. 카페24 배송 엑셀이 맞는지 확인해 주세요.', items: [] };
  const H = rows[hIdx];
  const col = {
    orderNo: findCol(H, ['주문번호']),
    name: findCol(H, ['수령인', '받는사람', '받는분', '수취인']),
    phone: findCol(H, ['수령인휴대전화', '수취인휴대전화', '받는사람휴대전화', '수령인전화', '휴대전화', '핸드폰', '휴대폰', '연락처', '전화번호']),
    zip: findCol(H, ['수령인우편번호', '수취인우편번호', '우편번호']),
    addr: findCol(H, ['수령인주소', '수취인주소', '받는사람주소', '배송지주소', '주소']),
    product: findCol(H, ['제품명', '상품명', '품목', '주문상품']),
    color: findCol(H, ['컬러', '색상']),
    size: findCol(H, ['사이즈']),
    option: findCol(H, ['옵션']),
    qty: findCol(H, ['수량']),
    msg: findCol(H, ['배송메시지', '배송메세지', '메시지', '메세지']),
    courier: findCol(H, ['택배사', '배송사']),
    invoice: findCol(H, ['운송장', '송장번호']),
    sentDate: findCol(H, ['발송일', '배송일'])
  };
  const items = [];
  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(col.name >= 0 ? row[col.name] : '').trim();
    const phone = phoneDigits(col.phone >= 0 ? row[col.phone] : '');
    if (!name || phone.length < 9) continue;
    let product = String(col.product >= 0 ? row[col.product] : '').trim();
    const color = String(col.color >= 0 ? row[col.color] : '').trim();
    const size = String(col.size >= 0 ? row[col.size] : '').trim();
    const option = String(col.option >= 0 ? row[col.option] : '').trim();
    items.push({
      orderNo: String(col.orderNo >= 0 ? row[col.orderNo] : '').trim(),
      name,
      phone: String(col.phone >= 0 ? row[col.phone] : '').trim(),
      zip: String(col.zip >= 0 ? row[col.zip] : '').trim(),
      addr: String(col.addr >= 0 ? row[col.addr] : '').trim(),
      product, color, size, option,
      qty: Number(col.qty >= 0 ? row[col.qty] : 1) || 1,
      msg: String(col.msg >= 0 ? row[col.msg] : '').trim(),
      courier: String(col.courier >= 0 ? row[col.courier] : '').trim(),
      invoice: String(col.invoice >= 0 ? row[col.invoice] : '').trim(),
      sentDate: excelDate(col.sentDate >= 0 ? row[col.sentDate] : '')
    });
  }
  return { items };
}

// ---------- 병합(중복 방지) ----------
// 옵션(색상/사이즈)까지 키에 포함 — 같은 주문에서 같은 제품을 옵션만 다르게 산 경우를 별개 건으로 취급
function optKey(o) {
  return (String(o.color || '') + '|' + String(o.size || '') + '|' + String(o.option || ''))
    .toLowerCase().replace(/\s/g, '').slice(0, 40);
}
function orderKey(o) { return (o.orderNo || '') + '|' + String(o.orderItemCode || '') + '|' + normName(o.name) + '|' + phoneDigits(o.phone) + '|' + String(o.product || '').replace(/\s/g, '').slice(0, 40) + '|' + optKey(o); }

function mergeSeeding(db, parsed) {
  return mergeSeedingRows(db, parsed, { zipForChangedAddress, clearZipLookupState, today });
}

// 출처가 달라도 같은 주문을 알아보기 위한 느슨한 키 (이름+전화 뒷8자리+제품명 앞부분)
function fuzzyOrderKey(o) {
  return normName(o.name) + '|' + phoneDigits(o.phone).slice(-8) + '|' +
    String(o.product || '').replace(/\s/g, '').replace(/\(P[0-9A-Z]+\)/g, '').slice(0, 14) + '|' + optKey(o);
}
function mergeOrders(db, parsed) {
  // 카페24 교환(E) 신청이 있는 주문번호: 그 주문의 미발송 품목은 교환 재발송분
  const exchNos = new Set(parsed.filter(p => p._retKind === '교환' && p.orderNo).map(p => p.orderNo));
  const map = new Map(db.orders.map(o => [orderKey(o), o]));
  const byItemCode = new Map(db.orders.filter(o => o.orderItemCode).map(o => [String(o.orderItemCode), o]));
  // 느슨한 키는 아직 안 보낸 건에만 — 과거 발송완료 건이 재주문을 흡수해 누락시키는 것 방지
  const fuzzy = new Map();
  for (const o of db.orders) {
    if ((o.status === '대기' || o.status === '접수중') && !fuzzy.has(fuzzyOrderKey(o))) fuzzy.set(fuzzyOrderKey(o), o);
  }
  let added = 0, updated = 0, canceled = 0, claimsAdded = 0, claimsUpdated = 0;
  for (const p of parsed) {
    // 카페24에서 취소/반품/교환된 주문: 아직 안 보낸 건이면 취소 처리
    if (p._canceled) {
      const fuzzyMatch = fuzzy.get(fuzzyOrderKey(p));
      const keyedMatch = map.get(orderKey(p));
      const ex = byItemCode.get(String(p.orderItemCode || '')) || (keyedMatch && canFuzzyMergeOrders(keyedMatch, p) ? keyedMatch : null) ||
        (fuzzyMatch && canFuzzyMergeOrders(fuzzyMatch, p) ? fuzzyMatch : null);
      if (ex && (ex.status === '대기' || ex.status === '접수중') && !p._retKind) {
        ex.status = '취소됨';
        canceled++;
      }
      if (p._retKind) {
        if (p._exchangeVariantCode) {
          const target = (db.inventory || []).find(item => String(item.variantCode || '') === String(p._exchangeVariantCode));
          if (target) {
            p._exchangeProduct = p._exchangeProduct || target.name || '';
            p._exchangeProductNo = p._exchangeProductNo || target.productNo || null;
            p._exchangeSku = target.sku || '';
            p._exchangeColor = p._exchangeColor || target.color || '';
            p._exchangeSize = p._exchangeSize || target.size || '';
          }
        }
        const key = p._claimCode ? ['c24', p._retKind, p._claimCode].join(':') : cafe24ReturnKey(p);
        if (!Array.isArray(db.c24RetSeen)) db.c24RetSeen = [];
        if (!db.c24RetSeen.includes(key)) db.c24RetSeen.push(key);
        const legacy = legacyRmaMatch(db.returns, p);
        let ret = db.returns.find(row => p._claimCode && row.cafe24ClaimCode === p._claimCode && row.kind === p._retKind);
        if (!ret) {
          ret = db.returns.find(row => row.kind === p._retKind && row.originalOrderNo === p.orderNo &&
            !['completed', 'canceled'].includes(row.flowState) &&
            (!row.cafe24ClaimCode || row.cafe24ClaimCode === p._claimCode) &&
            returnLineItems(row).some(item => String(item.orderItemCode || '') === String(p.orderItemCode || '')));
        }
        if (!ret) {
          ret = db.returns.find(row => row.kind === p._retKind && row.originalOrderNo === p.orderNo &&
            !['completed', 'canceled'].includes(row.flowState) &&
            ((ex && Number(row.sourceId) === Number(ex.id)) || normName(row.product) === normName(p.product)) && !row.cafe24ClaimCode);
        }
        if (!ret && legacy) {
          ret = legacy;
          prepareLegacyRma(ret, p);
        }
        if (ret && legacy && ret !== legacy) {
          ret.origInvoice = ret.origInvoice || legacy.origInvoice || '';
          ret.sourceId = ret.sourceId || legacy.sourceId || null;
          ret.reason = ret.reason || legacy.reason || '';
          if (Array.isArray(legacy.events) && legacy.events.length) {
            ret.events = [...legacy.events, ...(ret.events || [])].slice(-50);
          }
          db.returns = db.returns.filter(row => row !== legacy);
        }
        if (!ret) {
          const conflict = activeRmaConflict(db.returns, {
            orderItemCode: String(p.orderItemCode || ''), sourceId: ex && ex.id || null
          });
          if (conflict) {
            conflict.flowState = 'canceled';
            conflict.status = statusForFlowState('canceled');
            if (conflict.epost || conflict.pickupOp && ['pending', 'unknown', 'success'].includes(conflict.pickupOp.state)) conflict.needsEpostCancel = true;
            appendClaimEvent(conflict, 'canceled', 'cafe24', '교환·반품 종류가 변경되어 이전 건을 종료함');
          }
        }
        if (!ret) {
          const retId = db.nextId++;
          ret = {
            id: retId, rmaNo: 'RMA-' + retId,
            kind: p._retKind,
            sourceType: 'orders', sourceChannel: 'cafe24', _src: 'c24',
            sourceId: ex && ex.id || null, originalOrderNo: p.orderNo, sku: ex && ex.sku || p.sku || '',
            name: p.name, phone: p.phone,
            zip: String(p.zip || ex && ex.zip || ''), addr: p.addr || ex && ex.addr || '',
            product: p.product, option: [p.color, p.size].filter(Boolean).join(' ') || p.option || '',
            qty: p.qty || 1,
            reason: p._claimReason || '카페24에서 ' + p._retKind + ' 신청 들어옴',
            origInvoice: ex && ex.invoice || '', exchangeProduct: p._exchangeProduct || '',
            sourceProductNo: p.productNo || null,
            exchangeProductNo: p._exchangeProductNo || null,
            exchangeVariantCode: p._exchangeVariantCode || '',
            items: [], flowState: 'requested', status: '대기', invoice: '', regDate: today(), events: [], syncIssues: []
          };
          db.returns.push(ret);
          claimsAdded++;
        } else {
          claimsUpdated++;
        }
        upsertReturnLine(ret, p, ex);
        ret.originalOrderNo = ret.originalOrderNo || p.orderNo || '';
        applyCafe24ClaimSnapshot(ret, {
          claimCode: p._claimCode,
          orderStatus: p._claimStatus,
          reasonType: p._claimReasonType,
          reason: p._claimReason,
          invoice: p._returnInvoice,
          carrierId: p._returnCarrierId,
          pickupState: p._pickupRequestState,
          name: p.name,
          phone: p.phone,
          zip: p.zip,
          addr: p.addr,
          qty: ret.qty
        });
        if (ret.cafe24ClaimCode) clearClaimSyncIssue(ret, 'cafe24', 'lookup');
        if (!missingCafe24ExchangeTargets(ret).length) clearClaimSyncIssue(ret, 'cafe24', 'exchange-target');
        ret.sourceId = ret.sourceId || ex && ex.id || null;
        ret.sourceProductNo = ret.sourceProductNo || p.productNo || null;
        ret.exchangeProductNo = ret.exchangeProductNo || p._exchangeProductNo || null;
        if (shouldCancelRecoveredPickup(ret)) ret.needsEpostCancel = true;
      }
      continue;
    }
    const shipped = !!(p.invoice || p._shipped);
    const src = p._src;
    p.sourceChannel = src === 'c24' ? 'cafe24' : (p.sourceChannel || 'direct');
    if (!p.sku && (p.variantCode || p.productNo)) p.sku = inventorySku(p);
    delete p._shipped;
    delete p._src;
    const fuzzyMatch = fuzzy.get(fuzzyOrderKey(p));
    const keyedMatch = map.get(orderKey(p));
    const ex = byItemCode.get(String(p.orderItemCode || '')) || (keyedMatch && canFuzzyMergeOrders(keyedMatch, p) ? keyedMatch : null) ||
      (fuzzyMatch && canFuzzyMergeOrders(fuzzyMatch, p) ? fuzzyMatch : null);
    if (ex) {
      let ch = false;
      if (p.invoice && !ex.invoice && p.invoice !== ex.canceledInvoice) { ex.invoice = p.invoice; ex.courier = p.courier || ex.courier; ch = true; }
      // 앱에서 접수 취소한 건은 진짜 새 송장이 생기기 전까지 발송완료로 되돌리지 않음
      if (shipped && ex.status !== '발송완료' &&
          (!ex.canceledInvoice || (p.invoice && p.invoice !== ex.canceledInvoice))) { ex.status = '발송완료'; ch = true; }
      if (shipped && !ex.sentDate && p.sentDate) { ex.sentDate = p.sentDate; ch = true; }
      if (p.orderNo && !ex.orderNo) { ex.orderNo = p.orderNo; ch = true; }
      for (const f of ['productNo', 'variantCode', 'orderItemCode', 'orderedAt', 'sku', 'sourceChannel']) {
        if (p[f] != null && String(p[f]) !== '' && String(p[f]) !== String(ex[f] ?? '')) { ex[f] = p[f]; ch = true; }
      }
      // 아직 안 보낸 건은 주소/연락처/옵션 변경을 최신으로 반영
      if (!shipped && ex.status !== '발송완료' && ex.status !== '취소됨') {
        const addressChanged = !!(p.addr && String(p.addr) !== String(ex.addr || ''));
        if (addressChanged) {
          const previousZip = ex.zip;
          ex.addr = p.addr;
          ex.zip = zipForChangedAddress(previousZip, p.zip);
          clearZipLookupState(ex);
          ch = true;
        }
        for (const f of ['phone', 'msg', 'option', 'color', 'size', 'qty']) {
          if (p[f] != null && String(p[f]) !== '' && String(p[f]) !== String(ex[f] ?? '')) { ex[f] = p[f]; ch = true; }
        }
        if (!addressChanged && /^\d{5}$/.test(String(p.zip || '').trim()) && String(p.zip) !== String(ex.zip || '')) {
          ex.zip = p.zip;
          ch = true;
        }
      }
      // 취소 철회 복구는 카페24가 다시 정상 주문으로 보내줄 때만 (시트 잔여 행/앱에서 손으로 취소한 건은 제외)
      if (!shipped && ex.status === '취소됨' && src === 'c24' && !ex.manualCanceled) { ex.status = '대기'; ch = true; }
      if (ch) updated++;
    } else {
      const item = Object.assign({}, p, {
        id: db.nextId++,
        status: shipped ? '발송완료' : '대기',
        sentDate: p.sentDate || (shipped ? today() : ''),
        regDate: today()
      });
      db.orders.push(item);
      map.set(orderKey(item), item);
      if (item.orderItemCode) byItemCode.set(String(item.orderItemCode), item);
      if (!fuzzy.has(fuzzyOrderKey(item))) fuzzy.set(fuzzyOrderKey(item), item);
      added++;
    }
  }
  // 교환 신청이 있는 주문의 미발송 품목 → 🔁 교환 재발송분으로 표시
  if (exchNos.size) {
    for (const o of db.orders) {
      if (exchNos.has(o.orderNo) && (o.status === '대기' || o.status === '접수중') && !o.exchange) o.exchange = true;
    }
  }
  return { added, updated, canceled, claimsAdded, claimsUpdated };
}

// ---------- 우체국 엑셀 생성 ----------
function buildParcelGroups(db, selected) {
  const groups = new Map();
  const pick = [];
  const dups = [];
  const conflicts = fulfillmentGroupConflicts(db, selected);
  const blockedKeys = new Set(conflicts.map(row => row.key));
  const normP = s => String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  for (const sel of selected) {
    const list = sel.type === 'seeding' ? db.seeding : db.orders;
    const item = list.find(x => x.id === sel.id);
    const itemType = sel.type === 'seeding' ? 'seeding' : 'order';
    if (item && blockedKeys.has(fulfillmentKey(itemType, item))) continue;
    // 이미 보낸 건은 서버에서도 걸러냄 (화면이 30초 묵은 상태에서 눌러도 이중 접수 방지)
    if (!(item && item.status !== '취소됨' && item.status !== '발송완료' && !item.epost)) continue;
    if (item.shippingHold) continue;
    if (item.epostOp && ['pending', 'unknown'].includes(item.epostOp.state)) continue;
    // 과거에 이미 보낸 것과 같은 내용이면 차단 — [한 번 더 보내기]로 확인한 건(resendOk)만 통과
    if (!item.resendOk) {
      let prev = null;
      if (sel.type !== 'seeding' && item.orderNo) {
        prev = db.orders.find(o => o.id !== item.id && o.status === '발송완료' && sameCafe24OrderItem(o, item));
      } else if (sel.type === 'seeding') {
        // 시딩: 같은 사람에게 100% 동일한 제품이 이미 발송됨
        prev = db.seeding.find(o => o.id !== item.id && seedKey(o) === seedKey(item) && o.status === '발송완료' &&
          String(o.product || '').trim() === String(item.product || '').trim());
      }
      if (prev) {
        dups.push({ type: sel.type, id: item.id, name: item.name, product: String(item.product || '').split('\n')[0], prevInvoice: prev.invoice || '' });
        continue;
      }
    }
    pick.push({ type: sel.type, item });
  }
  for (const { type, item } of pick) {
    const itemType = type === 'seeding' ? 'seeding' : 'order';
    const gk = fulfillmentKey(itemType, item);
    if (!groups.has(gk)) groups.set(gk, { items: [], type, name: item.name, phone: item.phone, addr: item.addr, zip: item.zip, msgs: [] });
    const g = groups.get(gk);
    g.items.push({ type, item });
    if (item.msg) g.msgs.push(item.msg);
    if (type === 'seeding' && item.request) g.msgs.push(String(item.request).trim());
  }
  return { groups, pick, dups, conflicts };
}

function buildEpostRows(db, selected) {
  // selected: [{type:'seeding'|'order', id}]
  const st = db.settings;
  const { groups, pick, conflicts } = buildParcelGroups(db, selected);
  const rows = [];
  for (const g of groups.values()) {
    const zip = String(g.zip || '').trim() || extractZip(g.addr);
    // 상품명 = 제품 이름만, 상품모델 = 옵션(컬러/사이즈)
    const parcel = parcelContent(g.items.map(({ item }) => item));
    let content = parcel.products || (st.defaultContent || '의류');
    if (content.length > 100) content = (st.defaultContent || '의류') + ' ' + parcel.rows.length + '종';
    const orderNos = [...new Set(g.items.map(({ type, item }) => parcelReference(type === 'seeding' ? 'seeding' : 'order', item)))].join(',');
    const msg = g.msgs.filter(Boolean).join(' / ').slice(0, 50);
    // 열 이름(공백 제거)별 값 - 양식이 바뀌어도 settings.epostColumns만 고치면 됨
    const val = {
      '주문번호': orderNos, '고객사용번호': orderNos, '원주문번호': orderNos,
      '수취인명': g.name, '받는분성명': g.name, '수령인': g.name, '수취인': g.name,
      '수취인우편번호': zip, '받는분우편번호': zip, '우편번호': zip,
      '수취인주소': cleanAddr(g.addr), '받는분주소': cleanAddr(g.addr), '주소': cleanAddr(g.addr),
      '수취인전화번호': g.phone, '받는분전화번호': g.phone, '전화번호': g.phone, '받는분기타연락처': '',
      '상품명': content, '내용품명': content, '내용품': content,
      '상품모델': parcel.models,
      '배송메세지': msg, '배송메시지': msg,
      '수량': 1, '신청건수': 1,
      '보내는분성명': st.senderName || '', '보내는분전화번호': st.senderPhone || '',
      '보내는분우편번호': st.senderZip || '', '보내는분주소': st.senderAddr || ''
    };
    const row = {};
    for (const c of st.epostColumns) {
      const k = String(c).replace(/\s/g, '');
      row[c] = val[k] != null ? val[k] : '';
    }
    rows.push(row);
  }
  return { rows, count: pick.length, parcels: rows.length, picked: pick, conflicts };
}

function exportEpost(db, selected) {
  const { rows, count, parcels, picked, conflicts } = buildEpostRows(db, selected);
  if (conflicts.length) return { error: conflicts[0].name + ': ' + conflicts[0].reason };
  if (!rows.length) return { error: '내보낼 항목이 없습니다.' };
  const cols = db.settings.epostColumns;
  const aoa = [cols].concat(rows.map(r => cols.map(c => r[c] != null ? r[c] : '')));
  const fname = `우체국접수_${nowStamp()}.xlsx`;
  const buffer = buildWorkbookBuffer('우체국접수', cols, aoa.slice(1));
  for (const { item } of picked) {
    if (item.status === '대기') item.status = '접수중';
  }
  return { buffer, fname, count, parcels };
}

// ---------- 송장 매칭 ----------
function looksLikeInvoice(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 10 && d.length <= 14;
}
async function matchInvoices(db, rows) {
  // rows: 우체국 결과 엑셀 (aoa). 이름 열 + 송장 열 자동 탐지
  let hIdx = -1, nameCol = -1, invCol = -1, phoneCol = -1, refCol = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const nc = findCol(rows[i], ['받는분성명', '받는분', '수취인', '수령인', '받는사람', '성명', '이름']);
    const ic = findCol(rows[i], ['등기번호', '운송장', '송장', '접수번호']);
    if (nc >= 0 && ic >= 0) {
      hIdx = i; nameCol = nc; invCol = ic;
      phoneCol = findCol(rows[i], ['전화', '연락처', '휴대']);
      refCol = findCol(rows[i], ['고객사용번호', '원주문번호', '주문번호', '오더번호']);
      break;
    }
  }
  if (hIdx < 0) {
    // 헤더 없이: 열 내용으로 추정
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const row = rows[i];
      for (let c = 0; c < row.length; c++) if (looksLikeInvoice(row[c]) && invCol < 0) invCol = c;
    }
    if (invCol < 0) return { error: '이 엑셀에서 송장번호 열을 찾지 못했습니다. 우체국에서 내려받은 접수 결과 엑셀이 맞는지 확인해 주세요.' };
    hIdx = -1;
  }
  const pendings = [];
  for (const s of db.seeding) if (!s.invoice && s.status !== '취소됨') pendings.push({ type: 'seeding', item: s });
  for (const o of db.orders) if (!o.invoice && o.status !== '취소됨') pendings.push({ type: 'order', item: o });

  const results = { matched: [], unmatched: [] };
  const start = hIdx + 1;
  for (let r = Math.max(start, 0); r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue;
    let inv = invCol >= 0 ? String(row[invCol] || '').trim() : '';
    if (!inv || !looksLikeInvoice(inv)) {
      // 행 안에서 송장 비슷한 값 찾기
      inv = '';
      for (const cell of row) if (looksLikeInvoice(cell)) { inv = String(cell).trim(); break; }
      if (!inv) continue;
    }
    const nm = nameCol >= 0 ? normName(row[nameCol]) : '';
    const ph = phoneCol >= 0 ? phoneDigits(row[phoneCol]) : '';
    const reference = refCol >= 0 ? String(row[refCol] || '').trim() : '';
    if (!nm && !ph && !reference) { results.unmatched.push({ invoice: inv, name: '', reason: '이름·주문번호 정보 없음' }); continue; }
    const selected = selectInvoiceParcelGroup(pendings.filter(p => !p.done), { name: nm, phone: ph, reference });
    if (selected.items.length) {
      for (const p of selected.items) {
        p.item.invoice = inv;
        p.item.courier = '우체국';
        p.item.status = '발송완료';
        p.item.sentDate = today();
        p.done = true;
        results.matched.push({ invoice: inv, name: p.item.name, type: p.type, id: p.item.id });
      }
    } else {
      results.unmatched.push({ invoice: inv, name: nameCol >= 0 ? String(row[nameCol] || '') : '', reason: selected.reason });
    }
  }

  // ---- 매칭 후처리: 재고 차감 / 카페24 송장 등록 / 구글시트 기록 ----
  const matchedItems = results.matched.map(m => ({
    type: m.type,
    item: (m.type === 'seeding' ? db.seeding : db.orders).find(x => x.id === m.id)
  })).filter(x => x.item);
  const post = await postProcessShipped(db, matchedItems);
  results.stock = post.stock;
  results.stockMissing = post.stockMissing;
  results.cafe24 = post.cafe24;
  results.sheet = post.sheet;
  return results;
}

// 재고 항목과 발송 제품이 같은 물건인지 (품번/특수문자 무시, 글자만 비교 + 단어 단위 느슨 매칭)
function stockMatches(inv, item) {
  const lo = s => String(s || '').toLowerCase().replace(/[^a-z가-힣]/g, '');
  const stripped = String(inv.name || '').replace(/^[A-Za-z]#?\d+_?/, '');
  const core = lo(stripped);
  const text = lo(item.product);
  if (!core || core.length < 6) return false;
  let nameOk = text.includes(core);
  if (!nameOk) {
    // 단어들이 순서 상관없이 전부 들어있으면 인정 ("Margot Denim(Indigoblue)" ↔ "Margot Denim Pants (Indigo Blue)")
    const words = stripped.split(/[^A-Za-z가-힣]+/).map(lo).filter(w => w.length >= 3);
    nameOk = words.length >= 2 && words.every(w => text.includes(w));
  }
  if (!nameOk) return false;
  if (inv.color && !text.includes(lo(inv.color)) && lo(item.color) !== lo(inv.color)) return false;
  if (inv.size && String(item.size || '').trim().toUpperCase() !== String(inv.size).trim().toUpperCase()) return false;
  return true;
}

// 여러 재고 행이 걸리면 옵션이 구체적으로 맞는 1건만 (이중 차감/유령 복구 방지)
function findStockMatches(db, item) {
  return selectStockMatches(db.inventory, item, stockMatches);
}

function prepareReturnCompletion(db, ret, restock) {
  const returnItems = ret ? returnLineItems(ret) : [];
  const restockPlan = !ret || ret.localCompleted || restock === false
    ? { rows: [], missing: [] }
    : buildReturnRestockPlan(returnItems, item => findStockMatches(db, item));
  const safety = returnCompletionSafety(ret, { restock, stockMissing: restockPlan.missing });
  return { returnItems, restockPlan, safety };
}

// 재고 변동 장부: 입고/출고/복구가 일어날 때마다 한 줄씩 남긴다 (입출고 내역 화면·마스터 API용)
function logStock(db, inv, delta, reason, ref) {
  if (!db.stockLog) db.stockLog = [];
  db.stockLog.push({
    ts: new Date().toISOString(), date: today(),
    sku: inv.sku || inventorySku(inv),
    name: inv.name, color: inv.color || '', size: inv.size || '',
    delta, left: inv.qty, reason, ref: ref || ''
  });
  if (db.stockLog.length > 3000) db.stockLog = db.stockLog.slice(-3000); // 오래된 것부터 정리
}

function restoreShipmentStock(db, item, type, reason) {
  const details = getStockDeductions(item);
  if (details.length) {
    const result = restoreStockDeductions(item, db.inventory);
    for (const row of result.rows) logStock(db, row.inv, row.qty, reason, stockLedgerRef(item, type));
    return result;
  }
  if (item.stockDeducted) {
    item.stockDeductionIncomplete = false;
    item.stockDeductions = [];
    item.stockDeductionDetails = [];
    item.legacyStockUnverified = true;
    return { restored: 0, missingSkus: ['과거 출고 기록'] };
  }
  return { restored: 0, missingSkus: [] };
}

async function writeSeedingSheetRows(db, items, clear) {
  const webhook = String(db.settings.sheetWebhookUrl || '').trim();
  if (!webhook) throw new Error('구글시트 자동기록 주소가 설정되지 않았어요.');
  const updates = (items || []).map(item => ({
    sourceRowId: item.sourceRowId || '',
    name: item.name,
    phone: item.phone,
    invoice: clear ? '' : item.invoice,
    sentDate: clear ? '' : item.sentDate
  }));
  const recipientCounts = new Map();
  for (const item of db.seeding) recipientCounts.set(seedKey(item), (recipientCounts.get(seedKey(item)) || 0) + 1);
  const needsSourceMatch = (items || []).some(item => (recipientCounts.get(seedKey(item)) || 0) > 1);
  if (needsSourceMatch) {
    const capability = await httpsJson('POST', webhook, { 'Content-Type': 'application/json' },
      { token: db.settings.sheetWebhookToken || '', action: 'capabilities' });
    if (!(capability.status >= 200 && capability.status < 300 && capability.json && capability.json.sourceRowId === true)) {
      const error = new Error('같은 사람이 여러 번 신청해 시트 행을 안전하게 고를 수 없습니다. 구글시트 자동기록 스크립트를 최신 버전으로 바꿔 주세요.');
      error.responseReceived = true;
      throw error;
    }
  }
  const result = await httpsJson('POST', webhook, { 'Content-Type': 'application/json' },
    { token: db.settings.sheetWebhookToken || '', updates });
  if (!sheetWriteSucceeded(result, updates.length)) {
    const error = new Error(result.json && result.json.error ||
      `시트 기록 확인 실패 (${result.status}, ${Number(result.json && result.json.written || 0)}/${updates.length}건)`);
    error.responseReceived = true;
    throw error;
  }
  return { ok: true, count: updates.length };
}

async function retryCanceledExternalUpdates(db, allowCafe24) {
  const warnings = [];
  const groups = new Map();
  for (const item of db.orders || []) {
    const ref = item.canceledShipment;
    if (!ref || !ref.orderNo || !ref.invoice) continue;
    const itemCodes = Array.isArray(ref.itemCodes) ? ref.itemCodes : [];
    const key = shipmentOperationKey(ref.orderNo, ref.invoice, itemCodes);
    if (!groups.has(key)) groups.set(key, { ref, items: [] });
    groups.get(key).items.push(item);
  }
  for (const [key, group] of groups) {
    if (!allowCafe24) continue;
    if (!cafe24Configured(db) || !db.cafe24Token) {
      const message = '카페24 연결이 없어 취소한 송장 삭제를 아직 반영하지 못했어요.';
      for (const item of group.items) setExternalSyncState(item, 'cafe24', 'shipment-cancel', 'failed', message, key);
      warnings.push(message);
      continue;
    }
    for (const item of group.items) setExternalSyncState(item, 'cafe24', 'shipment-cancel', 'pending', '', key);
    saveDb(db);
    try {
      await cafe24DeleteShipment(db, group.ref.orderNo, group.ref.invoice, group.ref.itemCodes || []);
      for (const item of group.items) {
        item.cafe24Shipped = false;
        clearExternalSyncState(item, 'cafe24', 'shipment-cancel', key);
        delete item.canceledShipment;
      }
    } catch (error) {
      const state = error.responseReceived ? 'failed' : 'unknown';
      const message = state === 'unknown'
        ? '카페24 응답이 끊겨 취소한 송장 삭제 여부를 확인 중이에요.'
        : error.message;
      for (const item of group.items) setExternalSyncState(item, 'cafe24', 'shipment-cancel', state, message, key);
      warnings.push(message);
    }
  }

  const sheetItems = (db.seeding || []).filter(item => item.canceledSheet && item.canceledSheet.sourceRowId);
  if (sheetItems.length) {
    const keyOf = item => String(item.canceledSheet.sourceRowId || '') + '|' + String(item.canceledSheet.invoice || '');
    for (const item of sheetItems) setExternalSyncState(item, 'sheet', 'invoice-cancel', 'pending', '', keyOf(item));
    saveDb(db);
    try {
      await writeSeedingSheetRows(db, sheetItems, true);
      for (const item of sheetItems) {
        item.sheetWritten = false;
        clearExternalSyncState(item, 'sheet', 'invoice-cancel', keyOf(item));
        delete item.canceledSheet;
      }
    } catch (error) {
      const state = error.responseReceived ? 'failed' : 'unknown';
      const message = state === 'unknown'
        ? '구글시트 응답이 끊겨 취소한 송장 삭제 여부를 확인 중이에요.'
        : error.message;
      for (const item of sheetItems) setExternalSyncState(item, 'sheet', 'invoice-cancel', state, message, keyOf(item));
      warnings.push(message);
    }
  }
  return [...new Set(warnings)];
}

// 발송 확정된 건들의 공통 후처리 (송장매칭·API접수 양쪽에서 사용)
async function postProcessShipped(db, matchedItems) {
  const results = {};

  // 1) 재고 자동 차감 (제품 이름이 재고 목록과 맞으면)
  results.stock = [];
  results.stockMissing = [];
  for (const { type, item } of matchedItems) {
    const existingDetails = getStockDeductions(item);
    if (!shouldProcessStockDeduction(item)) continue;
    if (!item.product) continue;
    const already = new Map(existingDetails.map(row => [row.sku, row.qty]));
    const planned = new Map();
    let missing = false;
    for (const stockItem of splitShipmentItems(item)) {
      const matches = findStockMatches(db, stockItem);
      if (!matches.length || !inventoryCountKnown(matches[0])) {
        results.stockMissing.push({ name: item.name, product: stockItem.product, option: [stockItem.color, stockItem.size].filter(Boolean).join(' ') });
        missing = true;
        continue;
      }
      const inv = matches[0];
      const deductionKey = inv.sku || inventorySku(inv);
      const n = Number(stockItem.qty) || 1;
      const current = planned.get(deductionKey) || { inv, qty: 0 };
      current.qty += n;
      planned.set(deductionKey, current);
    }
    for (const [sku, row] of planned) {
      const deduction = availableStockDeduction(row.inv.qty, row.qty, already.get(sku));
      if (deduction.shortage > 0) {
        results.stockMissing.push({
          name: item.name,
          product: [row.inv.name, row.inv.color, row.inv.size].filter(Boolean).join(' '),
          option: `재고 ${Math.max(0, Number(row.inv.qty) || 0)}개 · 출고 ${row.qty}개`,
          reason: '재고 수량 부족'
        });
        row.inv.needsCount = true;
        row.inv.stockIssue = '출고 수량이 현재 재고보다 많아 실사 필요';
        missing = true;
      }
      if (!deduction.deducted) continue;
      row.inv.qty = deduction.left;
      results.stock.push({ sku, name: [row.inv.name, row.inv.color, row.inv.size].filter(Boolean).join(' '), minus: deduction.deducted, left: row.inv.qty });
      logStock(db, row.inv, -deduction.deducted, '출고', stockLedgerRef(item, type));
      recordStockDeduction(item, sku, deduction.deducted);
    }
    item.stockDeducted = getStockDeductions(item).length > 0;
    item.stockDeductionIncomplete = missing;
  }

  // 2) 카페24에 송장번호 자동 등록 + 배송중 처리 (주문건만)
  results.cafe24 = [];
  if (cafe24Configured(db) && db.cafe24Token) {
    const groupedOrders = groupCafe24ShipmentItems(matchedItems);
    for (const { orderNo, invoice, items } of groupedOrders) {
      const itemCodes = [...new Set(items.map(item => String(item.orderItemCode || '').trim()).filter(Boolean))];
      const operationKey = shipmentOperationKey(orderNo, invoice, itemCodes);
      if (itemCodes.length !== items.length) {
        const message = '이 송장에 카페24 품목코드가 없는 상품이 있어 전체 자동 배송처리를 멈췄어요.';
        for (const item of items) setExternalSyncState(item, 'cafe24', 'shipment', 'failed', message, operationKey);
        results.cafe24.push({ orderNo, ok: false, error: message });
        continue;
      }
      if (items.every(item => item.syncOps && item.syncOps.cafe24Shipment &&
        item.syncOps.cafe24Shipment.key === operationKey && item.syncOps.cafe24Shipment.state === 'success')) {
        results.cafe24.push({ orderNo, ok: true, itemCount: itemCodes.length, skipped: true });
        continue;
      }
      for (const item of items) setExternalSyncState(item, 'cafe24', 'shipment', 'pending', '', operationKey);
      saveDb(db);
      try {
        await cafe24RegisterShipment(db, orderNo, invoice, itemCodes);
        const completedCodes = new Set(itemCodes);
        for (const o of db.orders) {
          if (o.orderNo !== orderNo || !completedCodes.has(String(o.orderItemCode || ''))) continue;
          o.cafe24Shipped = true;
          clearExternalSyncState(o, 'cafe24', 'shipment', operationKey);
        }
        results.cafe24.push({ orderNo, ok: true, itemCount: itemCodes.length });
      } catch (e) {
        const state = e.responseReceived ? 'failed' : 'unknown';
        const message = state === 'unknown'
          ? '카페24 응답이 중간에 끊겨 송장 등록 여부를 확인 중이에요. 중복 방지를 위해 바로 다시 등록하지 않습니다.'
          : e.message;
        for (const item of items) setExternalSyncState(item, 'cafe24', 'shipment', state, message, operationKey);
        results.cafe24.push({ orderNo, ok: false, error: e.message });
      }
    }
  }

  // 3) 구글시트에 송장 자동 기록 (시딩건만, 웹훅 설정 시)
  results.sheet = null;
  const wh = (db.settings.sheetWebhookUrl || '').trim();
  const seedWrites = matchedItems.filter(x => x.type === 'seeding' && !x.item.sheetWritten);
  if (wh && seedWrites.length) {
    try {
      const result = await writeSeedingSheetRows(db, seedWrites.map(entry => entry.item), false);
      for (const { item } of seedWrites) {
        item.sheetWritten = true;
        clearExternalSyncState(item, 'sheet', 'invoice', String(item.sourceRowId || '') + '|' + String(item.invoice || ''));
      }
      results.sheet = result;
    } catch (e) {
      const state = e.responseReceived ? 'failed' : 'unknown';
      const message = state === 'unknown'
        ? '구글시트 응답이 끊겨 기록 여부를 확인하지 못했어요. 같은 행에 다시 기록해도 중복되지 않도록 안전하게 재시도합니다.'
        : e.message;
      for (const { item } of seedWrites) {
        setExternalSyncState(item, 'sheet', 'invoice', state, message, String(item.sourceRowId || '') + '|' + String(item.invoice || ''));
      }
      results.sheet = { ok: false, error: e.message };
    }
  }

  return results;
}

// ---------- HTTP ----------
function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return readBodyLimited(req, maxBytes);
}
function sendJson(res, code, obj) {
  const body = clientJson(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0'
  });
  res.end(body);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

const mutationQueue = createMutationQueue();
const server = http.createServer((req, res) => {
  for (const [name, value] of Object.entries(securityHeaders(isSecureRequest(req, TRUST_PROXY)))) res.setHeader(name, value);
  const url = new URL(req.url, 'http://localhost');
  const handle = async () => {
    try {
    // 다른 사이트가 API를 몰래 호출하는 것 차단 — 같은 주소(same-origin)에서 온 요청만 허용
    // (localhost뿐 아니라 Tailscale 주소로 열어도 자기 자신이면 통과)
    if (req.method === 'POST') {
      const org = String(req.headers.origin || '');
      if (org) {
        const host = String(req.headers.host || '');
        const sameOrigin = org === 'http://' + host || org === 'https://' + host;
        const localhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(org);
        if (!sameOrigin && !localhost) return sendJson(res, 403, { error: '허용되지 않은 요청이에요.' });
      }
    }
    // 접속 코드 게이트 (공개 인터넷에서 온 접속만; 처리했으면 여기서 끝)
    if (await gateCheck(req, res, url)) return;
    // 보기 모드: 우체국 접수/취소/새로고침은 허용(시딩은 시트로 매장과 자동 합쳐짐),
    // 회수/업로드/따로보냄은 매장 전용, 카페24 관련은 "매장이 켜져 있을 때만" 양보
    if (VIEW_ONLY && req.method === 'POST' &&
        /^\/api\/(return|manual-ship|export|upload)/.test(url.pathname)) {
      return sendJson(res, 200, { error: '이 작업은 매장 컴퓨터에서 해주세요. (노트북 보기 모드)' });
    }
    if (VIEW_ONLY && req.method === 'POST' && /^\/api\/cafe24\//.test(url.pathname) && await storeAliveCached()) {
      return sendJson(res, 200, { error: '매장 컴퓨터가 켜져 있어요 — 카페24 연결은 매장 화면에서 해주세요.' });
    }
    if (url.pathname === '/api/db' && req.method === 'GET') {
      return sendJson(res, 200, loadDb());
    }
    if (url.pathname === '/api/db' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      // 화면이 들고 있던 DB가 낡았으면(그 사이 자동 동기화가 저장) 덮어쓰지 않고 알림
      const cur = loadDb();
      if (body.rev != null && cur.rev != null && body.rev !== cur.rev) {
        return sendJson(res, 200, { conflict: true, db: cur });
      }
      const merged = mergeClientDb(cur, body);
      saveDb(merged);
      audit('db.save', { rev: merged.rev, actor: 'client' });
      return sendJson(res, 200, { ok: true, rev: merged.rev });
    }
    if (url.pathname === '/api/sync' && req.method === 'POST') {
      const { db, out } = await syncAll();
      if (syncStatus.google.ok === false && syncStatus.cafe24.ok !== true) {
        return sendJson(res, 200, { error: '구글시트를 읽지 못했습니다. 인터넷 연결과 시트 공유 설정("링크가 있는 모든 사용자")을 확인해 주세요.' });
      }
      return sendJson(res, 200, { ok: true, seeding: out.seeding, orders: out.orders, cafe24: out.cafe24, status: syncStatus, db });
    }
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const db = loadDb();
      syncStatus.cafe24.configured = cafe24Configured(db);
      syncStatus.cafe24.connected = !!db.cafe24Token;
      syncStatus.epost = { configured: epostConfigured(db), connected: !!db.epost };
      let ver = '';
      try { ver = JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8')).version; } catch (e) { /* 무시 */ }
      return sendJson(res, 200, { rev: db.rev || 0, version: ver, viewOnly: VIEW_ONLY, c24Owner: !VIEW_ONLY || !(await storeAliveCached()), status: syncStatus });
    }
    // ── 재고/출고 마스터 API (allin_v4 등 다른 시스템이 참조하는 읽기 전용 단일 기준) ──
    // 외부 시스템은 X-Ham-Code 헤더에 접속 코드를 넣어 호출한다.
    if (url.pathname === '/api/master/inventory' && req.method === 'GET') {
      const db = loadDb();
      const items = (db.inventory || []).filter(i => !i.retiredAggregate).map(i => ({
        id: i.id, sku: i.sku || inventorySku(i), productNo: i.productNo || null,
        variantCode: i.variantCode || '', name: i.name,
        color: i.color || '', size: i.size || '',
        qty: inventoryCountKnown(i) ? Number(i.qty) : null,
        countKnown: inventoryCountKnown(i), needsAllocation: !!i.needsAllocation
      }));
      return sendJson(res, 200, { ok: true, source: 'baesong-doumi', rev: db.rev || 0, count: items.length, items });
    }
    if (url.pathname === '/api/master/products' && req.method === 'GET') {
      // 상품 정의 마스터 (SKU·컬러·사이즈 전개·단가) — allin_v4의 cafe24 상품마스터에서 가져와 저장한 것
      const db = loadDb();
      const pm = db.productMaster || { products: [], updated: null };
      return sendJson(res, 200, { ok: true, source: 'baesong-doumi', updated: pm.updated, count: (pm.products || []).length, products: pm.products || [] });
    }
    if (url.pathname === '/api/master/shipments' && req.method === 'GET') {
      const db = loadDb();
      const since = String(url.searchParams.get('since') || '').trim(); // YYYY-MM-DD (없으면 전체)
      const rows = [];
      for (const [arr, kind] of [[db.orders || [], 'order'], [db.seeding || [], 'seeding']]) {
        for (const x of arr) {
          if (x.status !== '발송완료') continue;
          const date = x.sentDate || x.regDate || '';
          if (since && date && date < since) continue;
          rows.push({
            kind, id: x.id, date, name: x.name, product: x.product || '',
            color: x.color || '', size: x.size || '', qty: Number(x.qty) || 1,
            sku: x.sku || '', sourceChannel: x.sourceChannel || (kind === 'seeding' ? 'seeding' : 'direct'),
            fulfillmentId: fulfillmentKey(kind, x), orderNo: x.orderNo || '',
            invoice: x.invoice || '', courier: x.courier || '',
            delivered: !!x.delivered, deliveredDate: x.deliveredDate || '',
            exchange: !!x.exchange
          });
        }
      }
      rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return sendJson(res, 200, { ok: true, source: 'baesong-doumi', rev: db.rev || 0, count: rows.length, since: since || null, shipments: rows });
    }
    if (url.pathname === '/api/inventory/adjust' && req.method === 'POST') {
      // 재고 수동 입고/차감 (＋/− 버튼) — 입출고 내역에 남도록 서버가 처리
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const inv = (db.inventory || []).find(i => i.id === b.id);
      if (!inv) return sendJson(res, 200, { error: '해당 재고를 찾지 못했어요.' });
      const d = Number(b.delta) || 0;
      if (!d) return sendJson(res, 200, { error: '변경할 개수가 없어요.' });
      const before = Number(inv.qty) || 0;
      inv.qty = Math.max(0, before + d);
      inv.needsCount = false;
      if (inv.variantCode && inv.productNo) {
        const variants = db.inventory.filter(i => String(i.productNo || '') === String(inv.productNo) && i.variantCode);
        for (const aggregate of db.inventory.filter(i =>
          String(i.productNo || '') === String(inv.productNo) && i.needsAllocation && !i.variantCode)) {
          const allocation = variantAllocationState(aggregate, variants);
          aggregate.allocationExpected = allocation.expected;
          aggregate.allocationTotal = allocation.total;
          if (allocation.matches) {
            aggregate.qty = 0;
            aggregate.needsAllocation = false;
            aggregate.retiredAggregate = true;
            delete aggregate.allocationExpected;
            delete aggregate.allocationTotal;
          }
        }
      }
      const applied = inv.qty - before;
      if (applied) logStock(db, inv, applied, applied > 0 ? '입고 (직접)' : '차감 (직접)', '');
      saveDb(db);
      audit('inventory.adjust', { ref: inv.sku || inventorySku(inv), count: applied, rev: db.rev });
      return sendJson(res, 200, { ok: true, db });
    }
    if (url.pathname === '/api/master/stocklog' && req.method === 'GET') {
      // 입출고 변동 장부 (allin_v4 등 외부 시스템·앱 내역 화면 공용)
      const db = loadDb();
      const since = String(url.searchParams.get('since') || '').trim();
      let rows = db.stockLog || [];
      if (since) rows = rows.filter(r => r.date >= since);
      return sendJson(res, 200, { ok: true, source: 'baesong-doumi', count: rows.length, since: since || null, log: rows.slice(-1000).reverse() });
    }
    if (url.pathname === '/api/inventory/split' && req.method === 'POST') {
      // 재고 한 줄을 사이즈별 줄로 나눔 (예: S/M/L) — 출고 차감이 사이즈까지 정확히 맞도록
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const inv = (db.inventory || []).find(i => i.id === b.id);
      if (!inv) return sendJson(res, 200, { error: '해당 재고를 찾지 못했어요.' });
      const sizes = [...new Set((Array.isArray(b.sizes) ? b.sizes : String(b.sizes || '').split(','))
        .map(s => String(s).trim().toUpperCase()).filter(Boolean))];
      if (!sizes.length) return sendJson(res, 200, { error: '사이즈를 하나 이상 적어 주세요. (예: S,M,L)' });
      if (inv.size) return sendJson(res, 200, { error: '이미 사이즈가 있는 줄이에요. 사이즈 없는 줄만 나눌 수 있어요.' });
      // 기존 줄은 첫 사이즈가 되고(수량 유지), 나머지 사이즈는 새 줄(0개)로
      inv.size = sizes[0];
      const idx = db.inventory.indexOf(inv);
      const extra = sizes.slice(1).map(sz => ({
        id: db.nextId++, name: inv.name, color: inv.color || '', size: sz, qty: 0, productNo: inv.productNo
      }));
      inv.sku = inventorySku(inv);
      for (const item of extra) item.sku = inventorySku(item);
      db.inventory.splice(idx + 1, 0, ...extra);
      saveDb(db);
      return sendJson(res, 200, { ok: true, db, made: sizes });
    }
    if (url.pathname === '/api/cafe24/authurl' && req.method === 'GET') {
      const db = loadDb();
      if (!cafe24Configured(db)) return sendJson(res, 200, { error: '먼저 설정에 카페24 쇼핑몰 아이디, Client ID, Client Secret을 저장해 주세요.' });
      return sendJson(res, 200, { ok: true, url: cafe24AuthUrl(db), redirect: cafe24RedirectUri(db) });
    }
    if (url.pathname === '/api/cafe24/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const html = (msg, ok) => `<!DOCTYPE html><html lang="ko"><meta charset="utf-8"><body style="font-family:'Malgun Gothic';font-size:24px;text-align:center;padding-top:15vh">${ok ? '✅' : '⚠️'} ${msg}<br><br><a href="http://127.0.0.1:${PORT}" style="font-size:20px">배송 도우미로 돌아가기</a></body></html>`;
      if (!code) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html('인증 코드를 받지 못했어요. 설정에서 다시 시도해 주세요.', false)); }
      if (state && cafe24State && state !== cafe24State) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html('인증 정보가 일치하지 않아요. 설정에서 다시 시도해 주세요.', false)); }
      try {
        const db = loadDb();
        await cafe24ExchangeCode(db, code);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html('카페24 연결 완료! 이 창은 닫으셔도 돼요.', true));
        mutationQueue.run(() => syncAll()).catch(() => {});
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html('연결 실패: ' + e.message, false));
      }
      return;
    }
    if (url.pathname === '/api/cafe24/code' && req.method === 'POST') {
      // 붙여넣기 방식: 리다이렉트된 전체 주소 또는 code 값
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      let code = String(body.code || '').trim();
      const m = code.match(/[?&]code=([^&\s]+)/);
      if (m) code = decodeURIComponent(m[1]);
      else if (!code || /[/:?]/.test(code)) {
        return sendJson(res, 200, { error: '붙여넣은 주소에서 코드(code=...)를 찾지 못했어요. 이동된 페이지의 주소창 전체 주소를 그대로 복사해서 붙여넣어 주세요.' });
      }
      try {
        const db = loadDb();
        if (!cafe24Configured(db)) return sendJson(res, 200, { error: '먼저 설정에 카페24 쇼핑몰 아이디, Client ID, Client Secret을 저장해 주세요.' });
        await cafe24ExchangeCode(db, code);
        mutationQueue.run(() => syncAll()).catch(() => {});
        return sendJson(res, 200, { ok: true });
      } catch (e) {
        return sendJson(res, 200, { error: e.message });
      }
    }
    if (url.pathname === '/api/epost/connect' && req.method === 'POST') {
      const db = loadDb();
      if (!epostConfigured(db)) return sendJson(res, 200, { error: '먼저 우체국 인증키와 보안키를 저장해 주세요.' });
      try {
        const info = await epostConnect(db);
        return sendJson(res, 200, { ok: true, epost: info, db: loadDb() });
      } catch (e) {
        return sendJson(res, 200, { error: '우체국 연결 실패: ' + e.message });
      }
    }
    if (url.pathname === '/api/epost/test' && req.method === 'POST') {
      const db = loadDb();
      if (!epostConfigured(db) || !db.epost) return sendJson(res, 200, { error: '먼저 [우체국 연결]을 해주세요.' });
      try {
        const g = {
          name: '테스트', phone: '010-0000-0000', zip: '07997',
          addr: db.settings.senderAddr || '서울 양천구 목동동로 창구',
          msgs: ['테스트 접수입니다'],
          items: [{ item: { product: '테스트 상품', color: '', size: '', option: '', qty: 1 } }]
        };
        const r = await epostInsertOrder(db, g, 'HAMTEST' + Date.now(), 'Y');
        return sendJson(res, 200, { ok: true, result: r });
      } catch (e) {
        return sendJson(res, 200, { error: '테스트 접수 실패: ' + e.message });
      }
    }
    if (url.pathname === '/api/epost/register' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      if (!epostConfigured(db) || !db.epost) return sendJson(res, 200, { error: '먼저 설정에서 [우체국 연결]을 해주세요.' });
      if (VIEW_ONLY && await storeAliveCached()) {
        // 매장이 켜져 있을 땐 주문 접수는 매장에 양보 (카페24 동시 접속 방지) — 시딩만 허용
        body.selected = (body.selected || []).filter(s => s.type === 'seeding');
        if (!body.selected.length) {
          return sendJson(res, 200, { error: '매장 컴퓨터가 켜져 있어요 — 주문(🛒) 접수는 매장 화면에서 해주세요. (시딩🎁은 여기서도 가능)' });
        }
      }
      const selected = expandSelectedFulfillments(db, Array.isArray(body.selected) ? body.selected : []);
      body.selected = selected;
      const out = [];
      const shippedItems = [];
      const unresolvedGroups = new Map();
      for (const sel of selected) {
        const type = sel.type === 'seeding' ? 'seeding' : 'order';
        const list = type === 'seeding' ? db.seeding : db.orders;
        const item = list.find(row => row.id === Number(sel.id));
        if (!item || !item.epostOp || !['pending', 'unknown'].includes(item.epostOp.state)) continue;
        const operationKey = String(item.epostOp.orderNo || 'missing-' + type + '-' + item.id);
        if (!unresolvedGroups.has(operationKey)) unresolvedGroups.set(operationKey, []);
        unresolvedGroups.get(operationKey).push({ type, item });
      }
      for (const entries of unresolvedGroups.values()) {
        const operation = entries[0].item.epostOp;
        try {
          if (!operation.orderNo || !operation.reqYmd) throw new Error('저장된 우체국 작업번호가 없어 자동 재접수를 막았습니다.');
          const xml = await epostCall(db, 'api.GetResInfo.jparcel', {
            custNo: db.epost.custNo, reqType: '1', orderNo: operation.orderNo, reqYmd: operation.reqYmd
          });
          const regiNo = xmlVal(xml, 'regiNo');
          const stus = xmlVal(xml, 'treatStusCd');
          if (!regiNo || regiNo === 'TESTREGINOAPI') throw new Error('우체국 접수 결과를 아직 확인하지 못했습니다.');
          for (const { type, item } of entries) {
            item.invoice = regiNo;
            item.courier = '우체국';
            item.status = '발송완료';
            item.sentDate = today();
            item.epost = {
              orderNo: operation.orderNo,
              reqNo: xmlVal(xml, 'reqNo'), resNo: xmlVal(xml, 'resNo'), reqYmd: operation.reqYmd,
              stus: stus || '01', price: xmlVal(xml, 'price'), label: null
            };
            item.epostOp.state = 'success';
            item.epostOp.resolvedAt = new Date().toISOString();
            shippedItems.push({ type, item });
          }
          out.push({ name: entries[0].item.name, ok: true, regiNo, recovered: true });
        } catch (error) {
          if (releaseMissingEpostOperations(entries, error)) continue;
          for (const { item } of entries) {
            item.epostOp.state = 'unknown';
            item.epostOp.error = error.message;
          }
          out.push({ name: entries[0].item.name, ok: false, safeStop: true, error: error.message + ' 같은 건을 다시 접수하지 않았습니다. [우체국 접수]에서 상태를 확인해 주세요.' });
        }
      }
      const { groups, dups, conflicts } = buildParcelGroups(db, body.selected || []);
      for (const conflict of conflicts) {
        out.push({ name: conflict.name, ok: false, safeStop: true, error: conflict.reason });
      }
      for (const d of dups) {
        out.push({ name: d.name, ok: false, dup: true, error: `이미 같은 내용을 보냈어요 (${d.product}${d.prevInvoice ? ' · 송장 ' + d.prevInvoice : ''}). 정말 한 번 더 보내려면 목록의 [한 번 더 보내기]를 눌러 주세요.` });
      }
      let idx = 0;
      for (const g of groups.values()) {
        idx++;
        const orderNo = 'HAM' + Date.now() + '-' + idx;
        // 접수 전 검증: 우편번호 5자리 필수
        let zipChk = String(g.zip || '').trim() || extractZip(g.addr);
        if (!/^\d{5}$/.test(zipChk)) {
          // 접수 직전 마지막 시도: 주소로 우편번호 자동 조회
          try {
            const z = await kakaoZip(db, g.addr);
            if (/^\d{5}$/.test(z)) { zipChk = z; g.zip = z; for (const { item } of g.items) item.zip = z; }
          } catch (e) { /* 아래에서 친절하게 거절 */ }
        }
        if (!/^\d{5}$/.test(zipChk)) {
          out.push({ name: g.name, ok: false, error: '주소에서 우편번호(5자리)를 찾지 못했어요. 목록의 우편번호 칸에 직접 넣어 주세요.' });
          continue;
        }
        if (String(g.phone || '').replace(/\D/g, '').length < 9) {
          out.push({ name: g.name, ok: false, error: '전화번호가 없거나 이상해요. 연락처를 고친 뒤 다시 접수해 주세요.' });
          continue;
        }
        try {
          if (body.testYn !== 'Y') {
            const operation = { state: 'pending', orderNo, reqYmd: today().replace(/-/g, ''), at: new Date().toISOString() };
            for (const { item } of g.items) item.epostOp = Object.assign({}, operation);
            saveDb(db);
          }
          const r = await epostInsertOrder(db, g, orderNo, body.testYn === 'Y' ? 'Y' : 'N');
          if (body.testYn !== 'Y' && !r.regiNo) {
            for (const { item } of g.items) item.epostOp.state = 'unknown';
            out.push({ name: g.name, ok: false, safeStop: true, error: '우체국이 송장번호를 주지 않아 결과 확인 상태로 잠갔어요. 같은 건을 다시 접수하지 않습니다.' });
            continue;
          }
          if (body.testYn !== 'Y' && r.regiNo) {
            for (const { type, item } of g.items) {
              item.invoice = r.regiNo;
              item.courier = '우체국';
              item.status = '발송완료';
              item.sentDate = today();
              item.epost = { orderNo, reqNo: r.reqNo, resNo: r.resNo, reqYmd: today().replace(/-/g, ''), stus: '02', price: r.price, label: r.label };
              item.epostOp.state = 'success';
              item.epostOp.resolvedAt = new Date().toISOString();
              delete item.resendOk; // 한 번 더 보내기 허용은 1회용
              shippedItems.push({ type, item });
            }
          }
          out.push({ name: g.name, ok: true, regiNo: r.regiNo, price: r.price });
        } catch (e) {
          if (body.testYn !== 'Y') {
            for (const { item } of g.items) {
              if (!item.epostOp) continue;
              item.epostOp.state = 'unknown';
              item.epostOp.error = e.message;
            }
          }
          out.push({ name: g.name, ok: false, safeStop: body.testYn !== 'Y', error: e.message + (body.testYn !== 'Y' ? ' 접수 결과가 불확실해 같은 건을 다시 보내지 않도록 잠갔어요.' : '') });
        }
      }
      let post = { stock: [], cafe24: [], sheet: null };
      if (shippedItems.length) post = await postProcessShipped(db, shippedItems);
      saveDb(db);
      if (shippedItems.length) audit('shipment.epost', { count: out.filter(x => x.ok && x.regiNo).length, rev: db.rev });
      return sendJson(res, 200, { ok: true, results: out, dups, stock: post.stock, stockMissing: post.stockMissing, cafe24: post.cafe24, sheet: post.sheet, db });
    }
    if (url.pathname === '/api/resend-ok' && req.method === 'POST') {
      // "이미 보낸 것과 같은 내용" 차단을 이 건에 한해 1회 풀어줌 (한 번 더 보내기)
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const list = b.type === 'seeding' ? db.seeding : db.orders;
      const item = list.find(x => x.id === b.id);
      if (!item) return sendJson(res, 200, { error: '해당 건을 찾지 못했어요.' });
      item.resendOk = true;
      saveDb(db);
      return sendJson(res, 200, { ok: true, db });
    }
    if (url.pathname === '/api/packing/merge' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const resolved = resolvePackingMergeSelection(db, b.selected || []);
      if (resolved.error) return sendJson(res, 200, { error: resolved.error });
      const picked = resolved.picked;
      const recipientKeys = new Set(picked.map(({ item }) =>
        normName(item.name) + '|' + phoneDigits(item.phone) + '|' + cleanAddr(item.addr)
      ));
      if (recipientKeys.size !== 1) return sendJson(res, 200, { error: '받는 사람·연락처·주소가 모두 같은 것만 한 비닐로 묶을 수 있어요.' });
      const packGroupId = 'PACK-' + Date.now().toString(36).toUpperCase();
      for (const { item } of picked) item.packGroupId = packGroupId;
      saveDb(db);
      audit('packing.merge', { ref: packGroupId, count: picked.length, rev: db.rev });
      return sendJson(res, 200, { ok: true, packGroupId, count: picked.length, db });
    }
    if (url.pathname === '/api/packing/unmerge' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const packGroupId = String(b.packGroupId || '').trim();
      if (!packGroupId) return sendJson(res, 200, { error: '합포장 번호가 없어요.' });
      const members = [...db.orders, ...db.seeding].filter(item => item.packGroupId === packGroupId);
      if (!members.length) return sendJson(res, 200, { error: '풀 수 있는 합포장 건을 찾지 못했어요.' });
      if (members.some(item => item.status !== '대기' || item.invoice || item.epost ||
          item.epostOp && ['pending', 'unknown'].includes(item.epostOp.state))) {
        return sendJson(res, 200, { error: '이미 엑셀 접수·우체국 접수·발송이 시작된 합포장은 바꿀 수 없어요.' });
      }
      for (const item of members) delete item.packGroupId;
      const count = members.length;
      saveDb(db);
      audit('packing.unmerge', { ref: packGroupId, count, rev: db.rev });
      return sendJson(res, 200, { ok: true, count, db });
    }
    if (url.pathname === '/api/packing/split' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const splitId = 'SPLIT-' + Date.now().toString(36).toUpperCase() + '-' + Number(b.id);
      const result = splitOrderLineForLater(db.orders, b.id, splitId);
      if (result.error) return sendJson(res, 200, result);
      saveDb(db);
      audit('packing.split', { ref: splitId, orderNo: result.orderNo, itemId: Number(b.id), rev: db.rev });
      return sendJson(res, 200, { ok: true, db, splitId, orderNo: result.orderNo });
    }
    if (url.pathname === '/api/packing/split/release' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const result = releaseSplitOrderLine(db.orders, b.id);
      if (result.error) return sendJson(res, 200, result);
      saveDb(db);
      audit('packing.split_release', { ref: result.item.parcelSplitId, orderNo: result.orderNo, itemId: Number(b.id), rev: db.rev });
      return sendJson(res, 200, { ok: true, db, orderNo: result.orderNo });
    }
    if (url.pathname === '/api/packing/split/undo' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const orderNo = String(b.orderNo || '').trim();
      const result = undoSplitOrder(db.orders, orderNo);
      if (result.error) return sendJson(res, 200, result);
      saveDb(db);
      audit('packing.split_undo', { ref: orderNo, count: result.count, rev: db.rev });
      return sendJson(res, 200, { ok: true, db, count: result.count, orderNo });
    }
    if (url.pathname === '/api/manual-ship' && req.method === 'POST') {
      // 앱 밖에서(우체국 창구, 다른 택배 등) 따로 보낸 건을 발송완료로 정리
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const list = body.type === 'seeding' ? db.seeding : db.orders;
      const item = list.find(x => x.id === body.id);
      if (!item) return sendJson(res, 200, { error: '해당 건을 찾지 못했어요.' });
      if (item.shippingHold) return sendJson(res, 200, { error: '재고 기다림 품목은 발송완료로 바꿀 수 없어요. 재고가 들어온 뒤 [재고 들어옴 · 이제 보내기]를 먼저 눌러 주세요.' });
      if (item.status === '발송완료') return sendJson(res, 200, { error: '이미 발송완료된 건이에요.' });
      const inv = String(body.invoice || '').trim();
      item.invoice = inv;
      item.courier = inv.replace(/\D/g, '').length === 13 ? '우체국' : (inv ? '기타' : '');
      item.status = '발송완료';
      item.sentDate = today();
      const post = await postProcessShipped(db, [{ type: body.type === 'seeding' ? 'seeding' : 'order', item }]);
      saveDb(db);
      audit('shipment.manual', { type: body.type === 'seeding' ? 'seeding' : 'order', count: 1, rev: db.rev });
      return sendJson(res, 200, { ok: true, db, stock: post.stock, stockMissing: post.stockMissing, cafe24: post.cafe24, sheet: post.sheet });
    }
    if (url.pathname === '/api/epost/status' && req.method === 'POST') {
      // 우체국에 접수된 건들의 처리상태(예약/운송장출력/집하 등) 새로고침
      const db = loadDb();
      if (!epostConfigured(db) || !db.epost) return sendJson(res, 200, { error: '우체국 연결이 필요해요.' });
      const recoveredItems = [];
      const recoveredOperations = new Set();
      const pendingOperations = new Map();
      for (const [type, list] of [['order', db.orders], ['seeding', db.seeding]]) {
        for (const item of list) {
          if (!item.epostOp || !['pending', 'unknown'].includes(item.epostOp.state)) continue;
          const key = String(item.epostOp.orderNo || 'missing-' + type + '-' + item.id);
          if (!pendingOperations.has(key)) pendingOperations.set(key, []);
          pendingOperations.get(key).push({ type, item });
        }
      }
      const errors = [];
      let released = 0;
      for (const entries of pendingOperations.values()) {
        const operation = entries[0].item.epostOp;
        try {
          if (!operation.orderNo || !operation.reqYmd) throw new Error('저장된 우체국 작업번호가 없어 자동 재접수를 막았습니다.');
          const xml = await epostCall(db, 'api.GetResInfo.jparcel', {
            custNo: db.epost.custNo, reqType: '1', orderNo: operation.orderNo, reqYmd: operation.reqYmd
          });
          const regiNo = xmlVal(xml, 'regiNo');
          if (!regiNo || regiNo === 'TESTREGINOAPI') throw new Error('우체국 접수 결과를 아직 확인하지 못했습니다.');
          const stus = xmlVal(xml, 'treatStusCd') || '01';
          for (const { type, item } of entries) {
            item.invoice = regiNo;
            item.courier = '우체국';
            item.status = '발송완료';
            item.sentDate = today();
            item.epost = {
              orderNo: operation.orderNo,
              reqNo: xmlVal(xml, 'reqNo'), resNo: xmlVal(xml, 'resNo'), reqYmd: operation.reqYmd,
              stus, price: xmlVal(xml, 'price'), label: null
            };
            item.epostOp.state = 'success';
            item.epostOp.resolvedAt = new Date().toISOString();
            delete item.epostOp.error;
            recoveredItems.push({ type, item });
          }
          recoveredOperations.add(operation.orderNo);
        } catch (error) {
          if (releaseMissingEpostOperations(entries, error)) {
            released++;
            continue;
          }
          for (const { item } of entries) {
            item.epostOp.state = 'unknown';
            item.epostOp.error = error.message;
          }
          errors.push(entries[0].item.name + ': ' + error.message);
        }
      }
      // 끝난 건(집하완료/취소)은 건너뛰어 호출 수를 줄임
      const targets = [...db.orders, ...db.seeding].filter(x => x.epost && x.epost.orderNo && !['03', '05'].includes(x.epost.stus));
      const done = new Set(recoveredOperations);
      let refreshed = 0;
      refreshed += recoveredOperations.size;
      for (const item of targets) {
        if (done.has(item.epost.orderNo)) continue;
        done.add(item.epost.orderNo);
        try {
          const xml = await epostCall(db, 'api.GetResInfo.jparcel', {
            custNo: db.epost.custNo, reqType: '1',
            orderNo: item.epost.orderNo, reqYmd: item.epost.reqYmd || today().replace(/-/g, '')
          });
          const stus = xmlVal(xml, 'treatStusCd');
          for (const it of targets) {
            if (it.epost.orderNo === item.epost.orderNo) {
              if (stus) it.epost.stus = stus;
              const rn = xmlVal(xml, 'regiNo');
              if (rn && rn !== 'TESTREGINOAPI') it.invoice = rn; // 취소 후 재발급 등 반영
            }
          }
          refreshed++;
        } catch (e) { errors.push(item.name + ': ' + e.message); }
      }
      for (const ret of db.returns.filter(returnPickupNeedsSync)) {
        try {
          await syncReturnPickup(db, ret, true);
          refreshed++;
        } catch (error) {
          errors.push(ret.name + '(회수): ' + error.message);
        }
      }
      const post = recoveredItems.length
        ? await postProcessShipped(db, recoveredItems)
        : { stock: [], stockMissing: [], cafe24: [], sheet: null };
      saveDb(db);
      return sendJson(res, 200, {
        ok: true, refreshed, recovered: recoveredOperations.size, released, errors: errors.slice(0, 5),
        stock: post.stock, stockMissing: post.stockMissing, cafe24: post.cafe24, sheet: post.sheet, db
      });
    }
    if (url.pathname === '/api/epost/cancel' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      if (!epostConfigured(db) || !db.epost) return sendJson(res, 200, { error: '우체국 연결이 필요해요.' });
      const list = body.type === 'seeding' ? db.seeding : db.orders;
      const item = list.find(x => x.id === body.id);
      if (!item || !item.epost) return sendJson(res, 200, { error: '취소할 접수 정보를 찾지 못했어요.' });
      try {
        await epostCall(db, 'api.GetResCancelCmd.jparcel', {
          custNo: db.epost.custNo, apprNo: db.epost.apprNo, reqType: '1',
          reqNo: item.epost.reqNo, resNo: item.epost.resNo,
          regiNo: String(item.invoice || '').replace(/\D/g, ''),
          reqYmd: item.epost.reqYmd, delYn: 'Y'
        });
      } catch (e) {
        return sendJson(res, 200, { error: '우체국 취소 실패: ' + e.message + ' (이미 집하됐으면 취소할 수 없어요)' });
      }
      const canceledItems = [];
      for (const [type, rows] of [['order', db.orders], ['seeding', db.seeding]]) {
        for (const row of rows) {
          if (row.epost && row.epost.orderNo === item.epost.orderNo) canceledItems.push({ type, item: row });
        }
      }
      const cafe24Groups = new Map();
      for (const entry of canceledItems.filter(entry => entry.type === 'order' && entry.item.cafe24Shipped)) {
        const key = String(entry.item.orderNo || '') + '|' + String(entry.item.invoice || '');
        if (!cafe24Groups.has(key)) cafe24Groups.set(key, []);
        cafe24Groups.get(key).push(entry.item);
      }
      for (const rows of cafe24Groups.values()) {
        const ref = {
          orderNo: rows[0].orderNo,
          invoice: rows[0].invoice,
          itemCodes: [...new Set(rows.map(row => String(row.orderItemCode || '').trim()).filter(Boolean))]
        };
        for (const row of rows) row.canceledShipment = ref;
      }
      for (const entry of canceledItems.filter(entry => entry.type === 'seeding' && entry.item.sheetWritten)) {
        entry.item.canceledSheet = { sourceRowId: entry.item.sourceRowId || '', invoice: entry.item.invoice || '' };
      }
      const externalWarnings = await retryCanceledExternalUpdates(db, true);
      const stockWarn = [];
      for (const { type, item: canceledItem } of canceledItems) {
        const restored = restoreShipmentStock(db, canceledItem, type, '접수 취소 복구');
        if (restored.missingSkus.length) stockWarn.push(...restored.missingSkus);
        canceledItem.canceledInvoice = String(canceledItem.invoice || '');
        canceledItem.status = '대기';
        canceledItem.invoice = '';
        canceledItem.sentDate = '';
        delete canceledItem.epost;
      }
      saveDb(db);
      const warnings = [...externalWarnings];
      if (externalWarnings.length) warnings.push('외부 연동 문제는 홈의 [연동 확인이 필요한 것]에 남겨 두었고 자동으로 다시 확인합니다.');
      if (stockWarn.includes('과거 출고 기록')) warnings.push('예전 출고 건은 어떤 SKU를 차감했는지 확실하지 않아 재고를 자동으로 늘리지 않았어요. 재고 화면에서 직접 확인해 주세요.');
      const missingStock = [...new Set(stockWarn.filter(value => value !== '과거 출고 기록'))];
      if (missingStock.length) warnings.push(`재고 ${missingStock.join(', ')}는 목록에서 찾지 못해 자동 복구하지 못했어요. 재고 화면에서 확인해 주세요.`);
      return sendJson(res, 200, {
        ok: true, db,
        warning: warnings.length ? warnings.join('\n') : null
      });
    }
    // 우편번호 즉시 조회 (화면에서 ⚠️ 뜨는 순간 자동 호출)
    if (url.pathname === '/api/zip/lookup' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const list = b.type === 'seeding' ? db.seeding : db.orders;
      const x = list.find(i => i.id === b.id);
      if (!x) return sendJson(res, 200, { error: '건을 찾지 못했어요.' });
      if (/^\d{5}$/.test(String(x.zip || '').trim())) return sendJson(res, 200, { ok: true, zip: x.zip });
      if (!(db.settings.kakaoRestKey || '').trim()) {
        x.zipLookupError = '우편번호 자동 검색이 꺼져 있어요. 설정에서 카카오 키를 확인해 주세요.';
        saveDb(db);
        return sendJson(res, 200, { error: x.zipLookupError, db });
      }
      const addressKey = zipLookupAddressKey(x.addr);
      if (!postalLookupDue(x, today(), addressKey, ZIP_LOOKUP_VERSION, b.force === true)) {
        return sendJson(res, 200, {
          error: x.zipLookupError || '오늘 확인한 주소예요. 주소를 고쳤다면 [다시 찾기]를 눌러 주세요.',
          skipped: true,
          db
        });
      }
      try {
        const z = await kakaoZip(db, x.addr);
        if (/^\d{5}$/.test(z)) {
          x.zip = z;
          clearZipLookupState(x);
          saveDb(db);
          return sendJson(res, 200, { ok: true, zip: z, db });
        }
        markZipLookupFailure(x, '주소를 자동으로 찾지 못했어요. 도로명·건물번호를 확인해 주세요.');
        saveDb(db);
        return sendJson(res, 200, { error: x.zipLookupError, db });
      } catch (e) {
        markZipLookupFailure(x, '우편번호 조회 연결에 문제가 있어요. [다시 찾기]를 눌러 주세요.');
        saveDb(db);
        return sendJson(res, 200, { error: x.zipLookupError, db });
      }
    }
    // ---------- 백업 ----------
    if (url.pathname === '/api/backup/list' && req.method === 'GET') {
      backupDb();
      let files = [];
      try {
        files = fs.readdirSync(BACKUP_DIR).filter(x => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().reverse()
          .map(f => ({ file: f, date: f.slice(3, 13), size: fs.statSync(path.join(BACKUP_DIR, f)).size }));
      } catch (e) { /* 폴더 없으면 빈 목록 */ }
      return sendJson(res, 200, { ok: true, files });
    }
    if (url.pathname === '/api/backup/restore' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      if (!/^db-\d{4}-\d{2}-\d{2}\.json$/.test(String(b.file || ''))) return sendJson(res, 200, { error: '백업 파일 이름이 이상해요.' });
      const src = path.join(BACKUP_DIR, b.file);
      if (!fs.existsSync(src)) return sendJson(res, 200, { error: '그 날짜의 백업이 없어요.' });
      // 되돌리기 직전 상태도 안전하게 보관
      if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, 'db-before-restore-' + nowStamp() + '.json'));
      writeJsonAtomic(DB_PATH, JSON.parse(fs.readFileSync(src, 'utf8')));
      const db = loadDb();
      saveDb(db); // rev를 올려 모든 화면이 새로 받게
      audit('backup.restore', { ref: b.file, rev: db.rev });
      return sendJson(res, 200, { ok: true, db });
    }
    if (url.pathname === '/api/backup/open' && req.method === 'POST') {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      exec('explorer "' + BACKUP_DIR + '"');
      return sendJson(res, 200, { ok: true });
    }
    // ---------- 교환/반품 ----------
    if (url.pathname === '/api/return/create' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      if (!String(b.name || '').trim() || !String(b.addr || '').trim()) {
        return sendJson(res, 200, { error: '이름과 주소는 꼭 적어 주세요.' });
      }
      const kind = b.kind === '교환' ? '교환' : '반품';
      const sourceChannel = b.sourceChannel || (b.sourceType === 'orders' ? 'cafe24' : b.sourceType === 'seeding' ? 'seeding' : 'direct');
      const duplicate = activeRmaConflict(db.returns, {
        orderItemCode: String(b.orderItemCode || ''), sourceId: Number(b.sourceId) || null
      });
      if (duplicate) return sendJson(res, 200, { error: `이미 진행 중인 교환·반품 건이 있어요 (${duplicate.rmaNo || 'RMA-' + duplicate.id}).` });
      const retId = db.nextId++;
      const ret = {
        id: retId, rmaNo: 'RMA-' + retId,
        kind,
        sourceType: b.sourceType || '',
        sourceChannel,
        sourceId: Number(b.sourceId) || null,
        originalOrderNo: String(b.originalOrderNo || '').trim(),
        orderItemCode: String(b.orderItemCode || '').trim(),
        variantCode: String(b.variantCode || '').trim(),
        sourceProductNo: b.sourceProductNo || null,
        sku: String(b.sku || '').trim(),
        name: String(b.name).trim(),
        phone: String(b.phone || '').trim(),
        zip: String(b.zip || '').trim(),
        addr: String(b.addr || '').trim(),
        product: String(b.product || '').trim(),
        option: String(b.option || '').trim(),
        qty: Math.max(1, Number(b.qty) || 1),
        reason: String(b.reason || '').trim(),
        origInvoice: String(b.origInvoice || '').trim(),
        exchangeProduct: String(b.exchangeProduct || '').trim(),
        exchangeSku: String(b.exchangeSku || '').trim(),
        exchangeVariantCode: String(b.exchangeVariantCode || '').trim(),
        exchangeProductNo: b.exchangeProductNo || null,
        exchangeColor: String(b.exchangeColor || '').trim(),
        exchangeSize: String(b.exchangeSize || '').trim(),
        cafe24ClaimReasonType: String(b.cafe24ClaimReasonType || 'I'),
        items: [{
          orderItemCode: String(b.orderItemCode || '').trim(),
          variantCode: String(b.variantCode || '').trim(),
          sourceProductNo: b.sourceProductNo || null,
          sku: String(b.sku || '').trim(),
          product: String(b.product || '').trim(),
          option: String(b.option || '').trim(),
          color: String(b.color || '').trim(),
          size: String(b.size || '').trim(),
          qty: Math.max(1, Number(b.qty) || 1),
          exchangeProduct: String(b.exchangeProduct || '').trim(),
          exchangeSku: String(b.exchangeSku || '').trim(),
          exchangeVariantCode: String(b.exchangeVariantCode || '').trim(),
          exchangeProductNo: b.exchangeProductNo || null,
          exchangeColor: String(b.exchangeColor || '').trim(),
          exchangeSize: String(b.exchangeSize || '').trim()
        }],
        flowState: 'requested', status: '대기', invoice: '', regDate: today(), events: [], syncIssues: []
      };
      db.returns.push(ret);
      saveDb(db);
      let warning = '';
      if (sourceChannel === 'cafe24') {
        try {
          await cafe24WriteClaim(db, ret, 'create', {});
          ret.flowState = 'accepted';
          ret.status = statusForFlowState(ret.flowState);
          if (!ret.cafe24ClaimCode) warning = '카페24 접수는 됐고 접수번호를 확인 중이에요. 잠시 뒤 자동으로 연결된 다음 회수를 신청해 주세요.';
          saveDb(db);
        } catch (error) {
          warning = '배송도우미에는 저장했지만 카페24 접수 반영을 못 했어요: ' + error.message;
        }
      }
      audit('return.create', { ref: 'RMA-' + retId, type: b.kind === '교환' ? 'exchange' : 'return', rev: db.rev });
      return sendJson(res, 200, { ok: true, db, warning });
    }
    if (url.pathname === '/api/return/pickup' && req.method === 'POST') {
      // 우체국 반품소포 접수: 집배원이 고객 집으로 방문해 회수
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      if (!epostConfigured(db) || !db.epost) return sendJson(res, 200, { error: '먼저 설정에서 [우체국 연결]을 해주세요.' });
      const ret = db.returns.find(x => x.id === b.id);
      if (!ret) return sendJson(res, 200, { error: '해당 건을 찾지 못했어요.' });
      if (['completed', 'canceled'].includes(ret.flowState)) return sendJson(res, 200, { error: '이미 끝났거나 취소된 건이에요.' });
      if (ret.epost) return sendJson(res, 200, { error: '이미 회수 신청이 되어 있어요.' });
      if (ret.pickupOp && ['pending', 'unknown'].includes(ret.pickupOp.state)) {
        return sendJson(res, 200, { error: '이전 회수 신청 결과를 확인 중이라 중복 접수하지 않았어요. [회수 진행상태 새로고침]을 눌러 주세요.' });
      }
      if (claimCancelUnresolved(ret)) {
        return sendJson(res, 200, { error: '카페24 전체 취소가 아직 끝나지 않아 새 회수를 신청하지 않았어요. [전체 취소 다시 시도]를 먼저 눌러 주세요.', db });
      }
      const otherPickup = pickupRmaConflict(db.returns, ret);
      if (otherPickup) return sendJson(res, 200, { error: `같은 주문의 다른 교환·반품(${otherPickup.rmaNo || 'RMA-' + otherPickup.id})에 이미 회수가 있어 중복 신청하지 않았어요.` });
      const zip = String(ret.zip || '').trim() || extractZip(ret.addr);
      if (!/^\d{5}$/.test(zip)) return sendJson(res, 200, { error: '고객 주소에서 우편번호(5자리)를 찾지 못했어요. 건을 지우고 우편번호를 넣어 다시 등록해 주세요.' });
      if (ret.sourceChannel === 'cafe24') {
        if (ret.externalPickupActive || cafe24PickupActive(ret.cafe24PickupState)) {
          return sendJson(res, 200, { error: '카페24에서 이미 회수 신청이 진행 중이라 우체국에 중복 접수하지 않았어요. 카페24의 회수 송장과 진행상태를 확인해 주세요.', db });
        }
        const stage = cafe24ClaimStage(ret.cafe24OrderStatus);
        if (!ret.cafe24ClaimCode) {
          const createState = ret.syncOps && ret.syncOps.create && ret.syncOps.create.state;
          if (createState !== 'failed') {
            return sendJson(res, 200, { error: '카페24 접수번호를 확인 중이라 중복 접수하지 않았어요. 잠시 뒤 [지금 확인하기]를 눌러 주세요.', db });
          }
          try {
            await cafe24WriteClaim(db, ret, 'create', {});
          } catch (error) {
            return sendJson(res, 200, { error: '카페24 교환·반품 접수를 먼저 맞추지 못해 우체국 회수를 시작하지 않았어요: ' + error.message, db });
          }
        }
        if (ret.cafe24ClaimCode && stage === 'requested') {
          const acceptState = ret.syncOps && ret.syncOps.accept && ret.syncOps.accept.state;
          if (['pending', 'unknown'].includes(acceptState)) {
            return sendJson(res, 200, { error: '카페24 승인 결과를 확인 중이라 중복 승인하지 않았어요. 잠시 뒤 [지금 확인하기]를 눌러 주세요.', db });
          }
          try {
            await cafe24WriteClaim(db, ret, 'accept', {});
          } catch (error) {
            return sendJson(res, 200, { error: '카페24 교환·반품 신청을 승인하지 못해 우체국 회수를 시작하지 않았어요: ' + error.message, db });
          }
        }
      }
      const orderNo = 'HAMR' + String(ret.id) + '-' + Date.now();
      ret.pickupOp = { key: ret.rmaNo + ':epost-pickup', state: 'pending', orderNo, at: new Date().toISOString() };
      saveDb(db);
      try {
        const r = await epostInsertReturn(db, ret, orderNo, 'N');
        ret.epost = { orderNo, reqNo: r.reqNo, resNo: r.resNo, reqYmd: today().replace(/-/g, ''), stus: '01', price: r.price };
        if (r.regiNo && r.regiNo !== 'TESTREGINOAPI') ret.invoice = r.regiNo;
        ret.pickupOp = { key: ret.rmaNo + ':epost-pickup', state: 'success', orderNo, at: new Date().toISOString() };
        ret.flowState = 'pickup_booked';
        ret.status = statusForFlowState(ret.flowState);
        appendClaimEvent(ret, 'pickup_booked', 'epost', ret.invoice || orderNo);
        saveDb(db);
        let warning = '';
        if (ret.sourceChannel === 'cafe24' && ret.cafe24ClaimCode) {
          try {
            const carrierId = await cafe24ClaimCarrierId(db, ret);
            await cafe24WriteClaim(db, ret, 'invoice', { invoice: ret.invoice || '', carrierId });
          } catch (error) {
            warning = '우체국 회수는 신청됐지만 카페24 회수 송장 반영을 못 했어요: ' + error.message;
          }
        }
        audit('return.pickup', { ref: ret.rmaNo, rev: db.rev });
        return sendJson(res, 200, { ok: true, db, regiNo: r.regiNo, price: r.price, warning });
      } catch (e) {
        ret.pickupOp.state = 'unknown';
        ret.pickupOp.error = e.message;
        setClaimSyncIssue(ret, 'epost', 'pickup', e.message);
        saveDb(db);
        return sendJson(res, 200, { error: '회수 접수 결과를 확정하지 못했어요. 중복 방지를 위해 다시 접수하지 않았습니다: ' + e.message, db });
      }
    }
    if (url.pathname === '/api/return/cancel' && req.method === 'POST') {
      // scope: 'pickup'(회수 신청만 취소, 건은 대기로) | 'entry'(건 자체를 취소됨으로) | 'delete'(목록에서 삭제)
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const ret = db.returns.find(x => x.id === b.id);
      if (!ret) return sendJson(res, 200, { error: '해당 건을 찾지 못했어요.' });
      if (pickupOperationUnresolved(ret)) {
        return sendJson(res, 200, { error: '우체국 회수 신청 결과를 아직 확인 중이라 취소하거나 지울 수 없어요. [회수 진행상태 새로고침]을 먼저 눌러 주세요.', db });
      }
      if (b.scope === 'reopen') {
        if (ret.sourceChannel === 'cafe24') return sendJson(res, 200, { error: '카페24에서 취소된 건은 카페24에서 다시 신청한 뒤 자동으로 들어오게 해주세요.' });
        ret.flowState = 'requested';
        ret.status = statusForFlowState(ret.flowState);
        ret.invoice = '';
        delete ret.epost;
        if (ret.pickupOp) ret.pickupOp.state = 'canceled';
        appendClaimEvent(ret, 'requested', 'shipping-helper', 'reopen');
        saveDb(db);
        return sendJson(res, 200, { ok: true, db });
      }
      if (b.scope === 'delete') {
        if (ret.sourceChannel === 'cafe24') return sendJson(res, 200, { error: '카페24 교환·반품 기록은 연결 이력이라 지울 수 없어요. 필요하면 [전체 취소]를 눌러 주세요.' });
        if (ret.epost) return sendJson(res, 200, { error: '회수가 진행 중이에요. 먼저 [회수만 취소]를 해주세요.' });
        db.returns = db.returns.filter(x => x.id !== b.id);
        saveDb(db);
        return sendJson(res, 200, { ok: true, db });
      }
      if (b.scope === 'entry' && ret.externalPickupActive) {
        return sendJson(res, 200, { error: '카페24에서 신청한 회수는 배송도우미가 택배사 취소번호를 갖고 있지 않아 여기서 안전하게 취소할 수 없어요. 카페24에서 회수 취소 후 교환·반품을 취소하면 5분 안에 이 화면에도 반영됩니다.' });
      }
      if (ret.epost) {
        if (!epostConfigured(db) || !db.epost) return sendJson(res, 200, { error: '우체국 연결이 필요해요.' });
        try {
          await epostCancelReturnPickup(db, ret);
        } catch (e) {
          return sendJson(res, 200, { error: '우체국 회수 취소 실패: ' + e.message + ' (반품은 운송장이 출력된 뒤에는 취소할 수 없어요. 우체국 1588-1300에 문의해 주세요)' });
        }
      }
      if (b.scope === 'entry' && ret.sourceChannel === 'cafe24' && ret.cafe24ClaimCode) {
        try {
          await cafe24WriteClaim(db, ret, 'cancel', { reason: String(b.reason || '배송도우미에서 전체 취소') });
        } catch (error) {
          ret.flowState = 'hold';
          ret.status = statusForFlowState(ret.flowState);
          saveDb(db);
          return sendJson(res, 200, { error: '우체국 회수는 취소했지만 카페24 취소 반영을 못 했어요. 다시 [전체 취소]를 눌러 주세요: ' + error.message, db });
        }
      }
      ret.flowState = b.scope === 'pickup' ? 'requested' : 'canceled';
      ret.status = statusForFlowState(ret.flowState);
      if (ret.pickupOp) ret.pickupOp.state = 'canceled';
      appendClaimEvent(ret, ret.flowState, 'shipping-helper', b.scope || 'entry');
      saveDb(db);
      audit('return.cancel', { ref: ret.rmaNo, type: b.scope || 'entry', rev: db.rev });
      return sendJson(res, 200, { ok: true, db });
    }
    if (url.pathname === '/api/return/preflight' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const ret = db.returns.find(x => x.id === b.id);
      const inspection = b.inspection === 'damaged' ? 'damaged' : 'sellable';
      const shouldRestock = returnRestockAllowed(inspection, b.restock);
      const prepared = prepareReturnCompletion(db, ret, shouldRestock);
      return sendJson(res, 200, Object.assign({ ok: true }, prepared.safety));
    }
    if (url.pathname === '/api/return/complete' && req.method === 'POST') {
      // 물건 도착 확인: 재고 복귀 + (교환이면) 재발송 건 자동 생성
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const ret = db.returns.find(x => x.id === b.id);
      const inspection = b.inspection === 'damaged' ? 'damaged' : 'sellable';
      const shouldRestock = returnRestockAllowed(inspection, b.restock);
      const prepared = prepareReturnCompletion(db, ret, shouldRestock);
      if (!prepared.safety.ready) {
        return sendJson(res, 200, Object.assign({ error: prepared.safety.message }, prepared.safety));
      }
      clearClaimSyncIssue(ret, 'cafe24', 'exchange-target');
      const out = { stock: [], resend: null };
      if (!ret.localCompleted) {
        const returnItems = prepared.returnItems;
        const restockPlan = prepared.restockPlan;
        ret.inspection = inspection;
        ret.inspectionAt = new Date().toISOString();
        if (shouldRestock) {
          for (const row of restockPlan.rows) {
            row.inv.qty = (Number(row.inv.qty) || 0) + row.qty;
            out.stock.push({ name: [row.inv.name, row.inv.color, row.inv.size].filter(Boolean).join(' '), plus: row.qty, left: row.inv.qty });
            logStock(db, row.inv, row.qty, ret.kind === '교환' ? '교환 회수 입고' : '반품 입고', stockLedgerRef(ret, 'return'));
          }
          clearClaimSyncIssue(ret, 'inventory', 'restock');
        }
        if (ret.kind === '교환' && !ret.resendId && !(ret.resendIds || []).length) {
          const resendIds = [];
          const resendProducts = [];
          for (const row of returnItems) {
            const resendId = db.nextId++;
            const product = row.exchangeProduct || row.product;
            db.orders.push({
              id: resendId,
              name: ret.name, phone: ret.phone, zip: ret.zip, addr: ret.addr,
              product,
              option: [row.exchangeColor, row.exchangeSize].filter(Boolean).join(', ') || row.option,
              color: row.exchangeColor || '', size: row.exchangeSize || '', qty: row.qty, msg: '교환 재발송',
              productNo: row.exchangeProductNo || null,
              variantCode: row.exchangeVariantCode || '',
              sku: row.exchangeSku || '',
              exchange: true, returnId: ret.id, parentOrderNo: ret.originalOrderNo || '',
              sourceChannel: 'exchange', status: '대기', invoice: '', regDate: today()
            });
            resendIds.push(resendId);
            resendProducts.push(product);
          }
          ret.resendIds = resendIds;
          ret.resendId = resendIds[0] || null;
          out.resend = { name: ret.name, product: resendProducts.join(', '), count: resendIds.length };
        }
        ret.localCompleted = true;
        ret.stockReviewNeeded = false;
        ret.flowState = ret.kind === '교환' ? 'reship_ready' : 'processing';
        ret.status = statusForFlowState(ret.flowState);
        appendClaimEvent(ret, 'received', 'shipping-helper', ret.inspection);
        saveDb(db);
      }
      let warning = '';
      const cafe24AlreadyCompleted = cafe24ClaimStage(ret.cafe24OrderStatus) === 'completed';
      if (ret.sourceChannel === 'cafe24' && ret.cafe24ClaimCode && !cafe24AlreadyCompleted) {
        try {
          await cafe24WriteClaim(db, ret, 'complete', { inspection: ret.inspection });
          ret.flowState = ret.kind === '교환' ? 'completed' : 'refund_pending';
        } catch (error) {
          warning = '실물 입고와 재고 처리는 끝났지만 카페24 완료 반영을 못 했어요: ' + error.message;
        }
      } else if (ret.sourceChannel !== 'cafe24' || cafe24AlreadyCompleted) {
        ret.flowState = 'completed';
      }
      ret.status = statusForFlowState(ret.flowState);
      ret.doneDate = today();
      appendClaimEvent(ret, ret.flowState, 'shipping-helper', ret.inspection || '');
      saveDb(db);
      audit('return.complete', { ref: ret.rmaNo, status: ret.inspection, rev: db.rev });
      return sendJson(res, 200, Object.assign({ ok: true, db, warning }, out));
    }
    if (url.pathname === '/api/cafe24/disconnect' && req.method === 'POST') {
      const db = loadDb();
      db.cafe24Token = null;
      saveDb(db);
      return sendJson(res, 200, { ok: true });
    }
    if (url.pathname === '/api/upload/cafe24' && req.method === 'POST') {
      const buf = await readBody(req, 10 * 1024 * 1024);
      let fileName = '';
      try { fileName = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch (e) { fileName = ''; }
      const format = spreadsheetFormat(buf, fileName);
      if (!format) {
        return sendJson(res, 400, { error: '엑셀(.xlsx, .xls) 또는 CSV(.csv) 파일만 올릴 수 있어요.' });
      }
      let wb;
      try { wb = XLSX.read(buf, spreadsheetReadOptions(buf, format)); }
      catch (e) { return sendJson(res, 200, { error: '엑셀 파일을 읽지 못했습니다. 파일이 맞는지 확인해 주세요.' }); }
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      const parsed = parseOrderRows(rows);
      if (parsed.error) return sendJson(res, 200, { error: parsed.error });
      const db = loadDb();
      const r = mergeOrders(db, parsed.items);
      saveDb(db);
      return sendJson(res, 200, { ok: true, added: r.added, updated: r.updated, total: parsed.items.length, db });
    }
    if (url.pathname === '/api/upload/invoice' && req.method === 'POST') {
      const buf = await readBody(req, 10 * 1024 * 1024);
      let fileName = '';
      try { fileName = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch (e) { fileName = ''; }
      const format = spreadsheetFormat(buf, fileName);
      if (!format) {
        return sendJson(res, 400, { error: '엑셀(.xlsx, .xls) 또는 CSV(.csv) 파일만 올릴 수 있어요.' });
      }
      let wb;
      try { wb = XLSX.read(buf, spreadsheetReadOptions(buf, format)); }
      catch (e) { return sendJson(res, 200, { error: '엑셀 파일을 읽지 못했습니다.' }); }
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      const db = loadDb();
      const result = await matchInvoices(db, rows);
      if (result.error) return sendJson(res, 200, { error: result.error });
      saveDb(db);
      return sendJson(res, 200, Object.assign({ ok: true, db }, result));
    }
    if (url.pathname === '/api/labels/printed' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const result = markPrintedFulfillments(db, Array.isArray(body.selected) ? body.selected : []);
      if (!result.parcels) return sendJson(res, 400, { error: '인쇄 완료로 기록할 운송장이 없어요.' });
      saveDb(db);
      audit('label.printed', { parcels: result.parcels, items: result.items, rev: db.rev });
      return sendJson(res, 200, Object.assign({ ok: true, db }, result));
    }
    if (url.pathname === '/api/export/epost' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const selected = expandSelectedFulfillments(db, Array.isArray(body.selected) ? body.selected : []);
      const r = exportEpost(db, selected);
      if (r.error) return sendJson(res, 200, r);
      saveDb(db);
      audit('epost.xlsx.download', { parcels: r.parcels, items: r.count, rev: db.rev });
      res.writeHead(200, xlsxDownloadHeaders(r.fname, r.buffer.length));
      return res.end(r.buffer);
    }
    // 정적 파일
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const fpath = path.join(PUBLIC_DIR, path.normalize(p).replace(/^([.\\/])+/, ''));
    if (fpath.startsWith(PUBLIC_DIR) && fs.existsSync(fpath) && fs.statSync(fpath).isFile()) {
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(fpath)] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, max-age=0'
      });
      return fs.createReadStream(fpath).pipe(res);
    }
    res.writeHead(404); res.end('not found');
    } catch (e) {
      console.error(e);
      if (e && e.code === 'PAYLOAD_TOO_LARGE') {
        const message = url.pathname.startsWith('/api/upload/')
          ? '엑셀 파일이 너무 큽니다. 10MB 이하 파일로 올려 주세요.'
          : '한 번에 보낸 내용이 너무 큽니다. 화면을 새로고침한 뒤 다시 시도해 주세요.';
        return sendJson(res, 413, { error: message });
      }
      sendJson(res, 500, { error: '서버 오류: ' + e.message });
    }
  };
  const mutates = req.method === 'POST' || url.pathname === '/api/cafe24/callback';
  if (mutates) mutationQueue.run(handle);
  else handle();
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log('이미 실행 중입니다. 브라우저에서 http://localhost:' + PORT + ' 를 여세요.');
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, '0.0.0.0', () => {
  // 모든 인터페이스에서 수신 (클라우드 서버·Tailscale 접속용; 공개 인터넷은 접속 코드 게이트가 지킴)
  console.log('배송 도우미 실행됨 → http://localhost:' + PORT);
  // 켜질 때 한 번 + 5분마다 자동으로 새 주문/시딩 확인
  mutationQueue.run(() => syncAll()).then(({ out }) => {
    console.log(`자동 확인: 시딩 +${out.seeding.added}, 시트주문 +${out.orders.added}, 카페24 +${out.cafe24.added}`);
  }).catch(e => console.log('자동 확인 실패:', e.message));
  setInterval(() => mutationQueue.run(() => syncAll()).catch(() => {}), 5 * 60 * 1000);
});
