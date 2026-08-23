/* 누솔베르 배송 도우미 - 로컬 서버
 * 카페24 주문 + 인플루언서 시딩 → 우체국(오즈뷰어) 접수 엑셀 변환/송장 매칭
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { exec } = require('child_process');
const XLSX = require('xlsx');
const seed = require('./lib/seed128');

const PORT = 8899;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// 구글시트 주소는 설정(data/db.json)에 저장 - 코드에는 두지 않는다
const SHEET_SEEDING = '01.시딩 발송 리스트';
const SHEET_ORDERS = '02.주문건 발송 리스트';
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
      // 우체국 계약고객시스템 > 파일등록 > "주문접수처 양식다운로드"에서 확인한 NUSOLVERE 실제 양식
      epostColumns: [
        '주문번호', '수취인명', '수취인 우편번호', '수취인 주소',
        '수취인 전화번호', '상품명', '상품모델', '배송메세지'
      ]
    },
    seeding: [],
    orders: [],
    inventory: [],
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
    for (const k of ['seeding', 'orders', 'inventory']) if (!Array.isArray(db[k])) db[k] = [];
    if (!db.nextId) db.nextId = 1;
    return db;
  } catch (e) {
    return defaultDb();
  }
}

function saveDb(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // 백업 1개 유지
  if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, DB_PATH + '.bak');
  db.rev = (db.rev || 0) + 1;
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
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
function today() { return new Date().toISOString().slice(0, 10); }
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
function httpsJson(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: Object.assign({}, headers, data ? { 'Content-Length': Buffer.byteLength(data) } : {})
    }, res => {
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
    scope: 'mall.read_order,mall.write_order'
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
async function cafe24RegisterShipment(db, orderNo, invoice) {
  const token = await cafe24EnsureToken(db);
  const code = await cafe24PostCarrierCode(db, token);
  const od = await cafe24Fetch(db, token, `/api/v2/admin/orders/${orderNo}?embed=items`);
  if (od.status !== 200 || !od.json || !od.json.order) throw new Error('주문 조회 실패(' + od.status + ')');
  const items = (od.json.order.items || []).filter(it => !/^[CRE]/.test(String(it.order_status || '')));
  const itemCodes = items.map(it => it.order_item_code).filter(Boolean);
  if (!itemCodes.length) throw new Error('배송처리할 품목이 없어요');
  const tracking = String(invoice).replace(/\D/g, '');
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
  // 이미 배송처리된 주문 등은 참고용 메시지로
  throw new Error(msg || ('등록 실패(' + r.status + ')'));
}
async function cafe24FetchOrders(db) {
  const token = await cafe24EnsureToken(db);
  const end = new Date();
  const start = new Date(end.getTime() - 13 * 86400 * 1000); // 최근 2주
  const fmt = d => d.toISOString().slice(0, 10);
  const parsed = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const p = new URLSearchParams({
      start_date: fmt(start), end_date: fmt(end),
      embed: 'items,receivers,buyer',
      limit: '100', offset: String(offset)
    });
    const r = await cafe24Fetch(db, token, `/api/v2/admin/orders?${p}`);
    if (r.status === 401) throw new Error('카페24 인증이 풀렸어요. 설정에서 다시 연결해 주세요.');
    if (r.status !== 200 || !r.json) throw new Error('카페24 주문 조회 실패 (' + r.status + '): ' + (r.json && (r.json.error && r.json.error.message) || r.text.slice(0, 200)));
    const orders = r.json.orders || [];
    for (const o of orders) {
      const rc = (o.receivers && o.receivers[0]) || {};
      const name = rc.name || (o.buyer && o.buyer.name) || '';
      const phone = rc.cellphone || rc.phone || '';
      const addr = [rc.address1, rc.address2].filter(Boolean).join(' ') || rc.address_full || '';
      const zip = rc.zipcode || rc.postcode || '';
      const msg = rc.shipping_message || '';
      for (const it of (o.items || [])) {
        const st = String(it.order_status || '');
        if (/^[CRE]/.test(st)) {
          // 취소/반품/교환: 이미 앱에 들어와 있는 대기 건을 취소 처리하기 위해 표시만 남김
          parsed.push({
            orderNo: o.order_id || '', name, phone,
            product: it.product_name || '', _canceled: true
          });
          continue;
        }
        if (st === 'N10' || st === 'N00') continue; // 입금 전 제외
        // option_value 예: "색상=Indigo Blue, 사이즈=M"
        let color = '', size = '';
        for (const part of String(it.option_value || '').split(/[,/]/)) {
          const kv = part.split('=');
          if (kv.length === 2) {
            const k = kv[0].trim(), v = kv[1].trim();
            if (k.includes('색상') || k.toLowerCase().includes('color')) color = v;
            else if (k.includes('사이즈') || k.toLowerCase().includes('size')) size = v;
          }
        }
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
          msg,
          courier: '',
          invoice: '',
          sentDate: shipped ? String(o.order_date || '').slice(0, 10) : '',
          _shipped: shipped
        });
      }
    }
    if (orders.length < 100) break;
  }
  return parsed;
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
    .map(([k, v]) => k + '=' + String(v).replace(/[&=]/g, ' ').trim())
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
  const apprXml = await epostCall(db, 'api.GetApprNo.jparcel', { custNo });
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
  const products = g.items.map(({ item }) => String(item.product || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / ');
  const models = g.items.map(({ item }) =>
    [item.color, item.size].filter(Boolean).join(' ') || String(item.option || '').trim()
  ).filter(Boolean).join(' / ');
  const qty = g.items.reduce((a, { item }) => a + (Number(item.qty) || 1), 0);
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
    goodsNm: (products || s.defaultContent || '의류').slice(0, 390),
    goodsMdl: models.slice(0, 390),
    qty: String(qty),
    delivMsg: g.msgs.filter(Boolean).join(' / ').slice(0, 190),
    printYn: 'N' // 운송장은 계약고객시스템 운송장출력 메뉴에서 출력
  };
  if (isMobile) params.recMob = phone; else params.recTel = phone;
  if (testYn === 'Y') params.testYn = 'Y';
  const xml = await epostCall(db, 'api.InsertOrder.jparcel', params);
  return {
    regiNo: xmlVal(xml, 'regiNo'),
    reqNo: xmlVal(xml, 'reqNo'),
    resNo: xmlVal(xml, 'resNo'),
    price: xmlVal(xml, 'price')
  };
}

// ---------- 자동 동기화 ----------
const syncStatus = {
  lastRun: null, lastOk: null,
  google: { ok: null, error: null, added: 0 },
  cafe24: { configured: false, connected: false, ok: null, error: null, added: 0 }
};
async function syncGoogle(db) {
  const sid = sheetIdOf(db);
  if (!sid) throw new Error('구글시트 주소가 없어요. 설정에서 시딩 구글시트 주소를 넣어 주세요.');
  const buf = await fetchUrl(`https://docs.google.com/spreadsheets/d/${sid}/export?format=xlsx`, 0);
  const wb = XLSX.read(buf, { type: 'buffer' });
  let seedRes = { added: 0, updated: 0 }, ordRes = { added: 0, updated: 0 };
  const seedWs = wb.Sheets[SHEET_SEEDING] || wb.Sheets[wb.SheetNames.find(n => n.includes('시딩'))];
  if (seedWs) seedRes = mergeSeeding(db, parseSeedingSheet(seedWs));
  const ordWs = wb.Sheets[SHEET_ORDERS] || wb.Sheets[wb.SheetNames.find(n => n.includes('주문'))];
  if (ordWs) {
    const parsed = parseOrderRows(XLSX.utils.sheet_to_json(ordWs, { header: 1, defval: '' }));
    if (!parsed.error) ordRes = mergeOrders(db, parsed.items);
  }
  return { seeding: seedRes, orders: ordRes };
}
async function syncAll() {
  const db = loadDb();
  syncStatus.lastRun = new Date().toISOString();
  let changed = false;
  const out = { seeding: { added: 0, updated: 0 }, orders: { added: 0, updated: 0 }, cafe24: { added: 0, updated: 0 } };
  try {
    const g = await syncGoogle(db);
    out.seeding = g.seeding; out.orders = g.orders;
    syncStatus.google = { ok: true, error: null, added: g.seeding.added + g.orders.added };
    changed = true;
  } catch (e) {
    syncStatus.google = { ok: false, error: e.message, added: 0 };
  }
  syncStatus.cafe24.configured = cafe24Configured(db);
  syncStatus.cafe24.connected = !!db.cafe24Token;
  if (cafe24Configured(db) && db.cafe24Token) {
    try {
      const parsed = await cafe24FetchOrders(db);
      const r = mergeOrders(db, parsed);
      out.cafe24 = r;
      syncStatus.cafe24 = { configured: true, connected: true, ok: true, error: null, added: r.added };
      changed = true;
    } catch (e) {
      syncStatus.cafe24 = { configured: true, connected: !!db.cafe24Token, ok: false, error: e.message, added: 0 };
    }
  }
  if (changed) saveDb(db);
  syncStatus.lastOk = syncStatus.google.ok || syncStatus.cafe24.ok ? new Date().toISOString() : syncStatus.lastOk;
  return { db, out };
}

// ---------- 시딩 시트 파싱 ----------
function parseSeedingSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) return [];
  const H = rows[0];
  const col = {
    date: findCol(H, ['작성일']),
    pack: findCol(H, ['타임스탬프']), // 이 시트에선 '일반 패킹/시딩 패키지'가 들어있음
    type: findCol(H, ['시딩형태']),
    email: findCol(H, ['이메일']),
    name: findCol(H, ['성명']),
    insta: findCol(H, ['인스타그램']),
    phone: findCol(H, ['연락처']),
    addr: findCol(H, ['상세주소', '주소']),
    product: findCol(H, ['희망제품', '제품정보']),
    size: findCol(H, ['희망사이즈', '사이즈선택']),
    request: findCol(H, ['기타요청', '전달메세지', '전달메시지']),
    sentDate: findCol(H, ['발송일']),
    invoice: findCol(H, ['송장번호']),
    stock: findCol(H, ['재고반영']),
    note: findCol(H, ['비고'])
  };
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(col.name >= 0 ? row[col.name] : '').trim();
    const phone = phoneDigits(col.phone >= 0 ? row[col.phone] : '');
    if (!name || phone.length < 9) continue; // 그룹 구분행 등 스킵
    out.push({
      name: name.replace(/\s*-\s*엽서.*$/, '').trim(),
      insta: String(col.insta >= 0 ? row[col.insta] : '').trim(),
      phone: String(col.phone >= 0 ? row[col.phone] : '').trim(),
      addr: String(col.addr >= 0 ? row[col.addr] : '').trim(),
      product: String(col.product >= 0 ? row[col.product] : '').trim(),
      size: String(col.size >= 0 ? row[col.size] : '').trim(),
      seedType: String(col.type >= 0 ? row[col.type] : '').trim(),
      packType: String(col.pack >= 0 ? row[col.pack] : '').trim(),
      email: String(col.email >= 0 ? row[col.email] : '').trim(),
      request: String(col.request >= 0 ? row[col.request] : '').trim(),
      sentDate: excelDate(col.sentDate >= 0 ? row[col.sentDate] : ''),
      invoice: String(col.invoice >= 0 ? row[col.invoice] : '').trim(),
      note: String(col.note >= 0 ? row[col.note] : '').trim()
    });
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
function seedKey(s) { return normName(s.name) + '|' + phoneDigits(s.phone); }
function orderKey(o) { return (o.orderNo || '') + '|' + normName(o.name) + '|' + phoneDigits(o.phone) + '|' + String(o.product || '').replace(/\s/g, '').slice(0, 40); }

function mergeSeeding(db, parsed) {
  const map = new Map(db.seeding.map(s => [seedKey(s), s]));
  let added = 0, updated = 0;
  for (const p of parsed) {
    const k = seedKey(p);
    const ex = map.get(k);
    if (ex) {
      // 시트에 송장이 생겼으면 반영
      let ch = false;
      if (p.invoice && !ex.invoice) { ex.invoice = p.invoice; ex.status = '발송완료'; ex.sentDate = p.sentDate || ex.sentDate || today(); ch = true; }
      for (const f of ['insta', 'addr', 'product', 'size', 'request', 'note']) {
        if (p[f] && p[f] !== ex[f]) { ex[f] = p[f]; ch = true; }
      }
      if (ch) updated++;
    } else {
      const item = Object.assign({}, p, {
        id: db.nextId++,
        status: p.invoice ? '발송완료' : '대기',
        regDate: today()
      });
      db.seeding.push(item);
      map.set(k, item);
      added++;
    }
  }
  // 시트에서 지워진(또는 이름/연락처가 바뀐) 행: 아직 안 보낸 건이면 취소 처리
  // (시트를 통째로 못 읽은 경우 오작동 방지를 위해 parsed가 비어있으면 건너뜀)
  let canceled = 0;
  if (parsed.length === 0) return { added, updated, canceled };
  const liveKeys = new Set(parsed.map(seedKey));
  for (const s of db.seeding) {
    if ((s.status === '대기' || s.status === '접수중') && !liveKeys.has(seedKey(s))) {
      s.status = '취소됨';
      canceled++;
    } else if (s.status === '취소됨' && liveKeys.has(seedKey(s)) && !s.invoice) {
      s.status = '대기'; // 행이 다시 생기면 복구
    }
  }
  return { added, updated, canceled };
}

// 출처가 달라도 같은 주문을 알아보기 위한 느슨한 키 (이름+전화 뒷8자리+제품명 앞부분)
function fuzzyOrderKey(o) {
  return normName(o.name) + '|' + phoneDigits(o.phone).slice(-8) + '|' +
    String(o.product || '').replace(/\s/g, '').replace(/\(P[0-9A-Z]+\)/g, '').slice(0, 14);
}
function mergeOrders(db, parsed) {
  const map = new Map(db.orders.map(o => [orderKey(o), o]));
  const fuzzy = new Map();
  for (const o of db.orders) if (!fuzzy.has(fuzzyOrderKey(o))) fuzzy.set(fuzzyOrderKey(o), o);
  let added = 0, updated = 0, canceled = 0;
  for (const p of parsed) {
    // 카페24에서 취소/반품된 주문: 아직 안 보낸 건이면 취소 처리
    if (p._canceled) {
      const ex = map.get(orderKey(p)) || fuzzy.get(fuzzyOrderKey(p));
      if (ex && (ex.status === '대기' || ex.status === '접수중')) {
        ex.status = '취소됨';
        canceled++;
      }
      continue;
    }
    const shipped = !!(p.invoice || p._shipped);
    delete p._shipped;
    const ex = map.get(orderKey(p)) || fuzzy.get(fuzzyOrderKey(p));
    if (ex) {
      let ch = false;
      if (p.invoice && !ex.invoice) { ex.invoice = p.invoice; ex.courier = p.courier || ex.courier; ch = true; }
      if (shipped && ex.status !== '발송완료') { ex.status = '발송완료'; ch = true; }
      if (shipped && !ex.sentDate && p.sentDate) { ex.sentDate = p.sentDate; ch = true; }
      if (p.orderNo && !ex.orderNo) { ex.orderNo = p.orderNo; ch = true; }
      // 아직 안 보낸 건은 주소/연락처/옵션 변경을 최신으로 반영
      if (!shipped && ex.status !== '발송완료') {
        if (ex.status === '취소됨') { ex.status = '대기'; ch = true; } // 취소 철회된 경우
        for (const f of ['addr', 'zip', 'phone', 'msg', 'option', 'color', 'size', 'qty']) {
          if (p[f] != null && String(p[f]) !== '' && String(p[f]) !== String(ex[f] ?? '')) { ex[f] = p[f]; ch = true; }
        }
      }
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
      if (!fuzzy.has(fuzzyOrderKey(item))) fuzzy.set(fuzzyOrderKey(item), item);
      added++;
    }
  }
  return { added, updated, canceled };
}

// ---------- 우체국 엑셀 생성 ----------
// 수령인 기준으로 묶기 (주문 여러 건 → 택배 1건)
function buildParcelGroups(db, selected) {
  const groups = new Map();
  const pick = [];
  for (const sel of selected) {
    const list = sel.type === 'seeding' ? db.seeding : db.orders;
    const item = list.find(x => x.id === sel.id);
    if (item && item.status !== '취소됨') pick.push({ type: sel.type, item });
  }
  for (const { type, item } of pick) {
    const gk = normName(item.name) + '|' + phoneDigits(item.phone) + '|' + cleanAddr(item.addr).slice(0, 15);
    if (!groups.has(gk)) groups.set(gk, { items: [], type, name: item.name, phone: item.phone, addr: item.addr, zip: item.zip, msgs: [] });
    const g = groups.get(gk);
    g.items.push({ type, item });
    if (item.msg) g.msgs.push(item.msg);
    if (type === 'seeding' && item.request) g.msgs.push('');
  }
  return { groups, pick };
}

function buildEpostRows(db, selected) {
  // selected: [{type:'seeding'|'order', id}]
  const st = db.settings;
  const { groups, pick } = buildParcelGroups(db, selected);
  const rows = [];
  for (const g of groups.values()) {
    const zip = String(g.zip || '').trim() || extractZip(g.addr);
    // 상품명 = 제품 이름만, 상품모델 = 옵션(컬러/사이즈)
    const products = g.items.map(({ item }) => String(item.product || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / ');
    let content = products || (st.defaultContent || '의류');
    if (content.length > 100) content = (st.defaultContent || '의류') + ' ' + g.items.length + '종';
    const models = g.items.map(({ item }) =>
      [item.color, item.size].filter(Boolean).join(' ') || String(item.option || '').trim()
    ).filter(Boolean).join(' / ');
    const orderNos = [...new Set(g.items.map(({ item }) => item.orderNo).filter(Boolean))].join(',');
    const msg = g.msgs.filter(Boolean).join(' / ').slice(0, 50);
    // 열 이름(공백 제거)별 값 - 양식이 바뀌어도 settings.epostColumns만 고치면 됨
    const val = {
      '주문번호': orderNos, '고객사용번호': orderNos, '원주문번호': orderNos,
      '수취인명': g.name, '받는분성명': g.name, '수령인': g.name, '수취인': g.name,
      '수취인우편번호': zip, '받는분우편번호': zip, '우편번호': zip,
      '수취인주소': cleanAddr(g.addr), '받는분주소': cleanAddr(g.addr), '주소': cleanAddr(g.addr),
      '수취인전화번호': g.phone, '받는분전화번호': g.phone, '전화번호': g.phone, '받는분기타연락처': '',
      '상품명': content, '내용품명': content, '내용품': content,
      '상품모델': models,
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
  return { rows, count: pick.length, parcels: rows.length, picked: pick };
}

function exportEpost(db, selected) {
  const { rows, count, parcels, picked } = buildEpostRows(db, selected);
  if (!rows.length) return { error: '내보낼 항목이 없습니다.' };
  const cols = db.settings.epostColumns;
  const aoa = [cols].concat(rows.map(r => cols.map(c => r[c] != null ? r[c] : '')));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cols.map(c => ({ wch: c.includes('주소') ? 45 : c.includes('내용품') ? 30 : 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '우체국접수');
  const downloads = path.join(os.homedir(), 'Downloads');
  const fname = `우체국접수_${nowStamp()}.xlsx`;
  const fpath = path.join(fs.existsSync(downloads) ? downloads : __dirname, fname);
  XLSX.writeFile(wb, fpath);
  // 상태 갱신
  for (const { item } of picked) {
    if (item.status === '대기') item.status = '접수중';
  }
  // 편의: 파일이 담긴 폴더를 열고(파일 선택된 상태), 우체국 접수 사이트도 연다
  try {
    exec(`explorer /select,"${fpath}"`);
    // start는 셸 따옴표 문제로 안 열리는 경우가 있어 rundll32 방식 사용
    exec('rundll32 url.dll,FileProtocolHandler https://biz.epost.go.kr');
  } catch (e) { /* 못 열어도 치명적이지 않음 */ }
  return { path: fpath, fname, count, parcels };
}

// ---------- 송장 매칭 ----------
function looksLikeInvoice(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 10 && d.length <= 14;
}
async function matchInvoices(db, rows) {
  // rows: 우체국 결과 엑셀 (aoa). 이름 열 + 송장 열 자동 탐지
  let hIdx = -1, nameCol = -1, invCol = -1, phoneCol = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const nc = findCol(rows[i], ['받는분성명', '받는분', '수취인', '수령인', '받는사람', '성명', '이름']);
    const ic = findCol(rows[i], ['등기번호', '운송장', '송장', '접수번호']);
    if (nc >= 0 && ic >= 0) { hIdx = i; nameCol = nc; invCol = ic; phoneCol = findCol(rows[i], ['전화', '연락처', '휴대']); break; }
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
    if (!nm && !ph) { results.unmatched.push({ invoice: inv, name: '', reason: '이름 정보 없음' }); continue; }
    let cand = pendings.filter(p => !p.done && normName(p.item.name) === nm);
    if (cand.length > 1 && ph) cand = cand.filter(p => phoneDigits(p.item.phone).slice(-8) === ph.slice(-8));
    if (cand.length >= 1) {
      // 같은 사람 묶음 전체에 같은 송장 부여
      for (const p of pendings) {
        if (!p.done && normName(p.item.name) === nm &&
            (!ph || phoneDigits(p.item.phone).slice(-8) === ph.slice(-8) || cand.length === 1)) {
          p.item.invoice = inv;
          p.item.courier = '우체국';
          p.item.status = '발송완료';
          p.item.sentDate = today();
          p.done = true;
          results.matched.push({ invoice: inv, name: p.item.name, type: p.type, id: p.item.id });
        }
      }
    } else {
      results.unmatched.push({ invoice: inv, name: nameCol >= 0 ? String(row[nameCol] || '') : '', reason: '같은 이름의 대기 건 없음' });
    }
  }

  // ---- 매칭 후처리: 재고 차감 / 카페24 송장 등록 / 구글시트 기록 ----
  const matchedItems = results.matched.map(m => ({
    type: m.type,
    item: (m.type === 'seeding' ? db.seeding : db.orders).find(x => x.id === m.id)
  })).filter(x => x.item);
  const post = await postProcessShipped(db, matchedItems);
  results.stock = post.stock;
  results.cafe24 = post.cafe24;
  results.sheet = post.sheet;
  return results;
}

// 발송 확정된 건들의 공통 후처리 (송장매칭·API접수 양쪽에서 사용)
async function postProcessShipped(db, matchedItems) {
  const results = {};
  const norm = s => String(s || '').replace(/\s/g, '').toLowerCase();

  // 1) 재고 자동 차감 (제품 이름이 재고 목록과 맞으면)
  results.stock = [];
  for (const { item } of matchedItems) {
    if (item.stockDeducted) continue;
    const text = norm(item.product);
    if (!text) continue;
    let any = false;
    for (const inv of db.inventory) {
      const nm = norm(inv.name);
      if (!nm || !text.includes(nm)) continue;
      if (inv.color && !(text.includes(norm(inv.color)) || norm(item.color) === norm(inv.color))) continue;
      if (inv.size && String(item.size || '').trim().toUpperCase() !== String(inv.size).trim().toUpperCase()) continue;
      const n = Number(item.qty) || 1;
      inv.qty = Math.max(0, inv.qty - n);
      results.stock.push({ name: [inv.name, inv.color, inv.size].filter(Boolean).join(' '), minus: n, left: inv.qty });
      any = true;
    }
    if (any) item.stockDeducted = true;
  }

  // 2) 카페24에 송장번호 자동 등록 + 배송중 처리 (주문건만)
  results.cafe24 = [];
  if (cafe24Configured(db) && db.cafe24Token) {
    const done = new Set();
    for (const { type, item } of matchedItems) {
      if (type !== 'order' || !item.orderNo || item.cafe24Shipped || done.has(item.orderNo)) continue;
      done.add(item.orderNo);
      try {
        await cafe24RegisterShipment(db, item.orderNo, item.invoice);
        for (const o of db.orders) if (o.orderNo === item.orderNo) o.cafe24Shipped = true;
        results.cafe24.push({ orderNo: item.orderNo, ok: true });
      } catch (e) {
        results.cafe24.push({ orderNo: item.orderNo, ok: false, error: e.message });
      }
    }
  }

  // 3) 구글시트에 송장 자동 기록 (시딩건만, 웹훅 설정 시)
  results.sheet = null;
  const wh = (db.settings.sheetWebhookUrl || '').trim();
  const updates = matchedItems
    .filter(x => x.type === 'seeding' && !x.item.sheetWritten)
    .map(x => ({ name: x.item.name, phone: x.item.phone, invoice: x.item.invoice, sentDate: x.item.sentDate }));
  if (wh && updates.length) {
    try {
      const r = await httpsJson('POST', wh, { 'Content-Type': 'application/json' },
        { token: db.settings.sheetWebhookToken || '', updates });
      if (r.status === 200 || r.status === 302) { // Apps Script는 302로 응답하기도 함
        for (const u of matchedItems) if (u.type === 'seeding') u.item.sheetWritten = true;
        results.sheet = { ok: true, count: updates.length };
      } else {
        results.sheet = { ok: false, error: '응답 코드 ' + r.status };
      }
    } catch (e) { results.sheet = { ok: false, error: e.message }; }
  }

  return results;
}

// ---------- HTTP ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/db' && req.method === 'GET') {
      return sendJson(res, 200, loadDb());
    }
    if (url.pathname === '/api/db' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      saveDb(body);
      return sendJson(res, 200, { ok: true, rev: body.rev });
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
      return sendJson(res, 200, { rev: db.rev || 0, status: syncStatus });
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
        syncAll().catch(() => {});
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
        syncAll().catch(() => {});
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
      const { groups } = buildParcelGroups(db, body.selected || []);
      const out = [];
      const shippedItems = [];
      let idx = 0;
      for (const g of groups.values()) {
        idx++;
        const orderNo = 'HAM' + Date.now() + '-' + idx;
        try {
          const r = await epostInsertOrder(db, g, orderNo, body.testYn === 'Y' ? 'Y' : 'N');
          if (body.testYn !== 'Y' && r.regiNo) {
            for (const { type, item } of g.items) {
              item.invoice = r.regiNo;
              item.courier = '우체국';
              item.status = '발송완료';
              item.sentDate = today();
              item.epost = { orderNo, reqNo: r.reqNo, resNo: r.resNo };
              shippedItems.push({ type, item });
            }
          }
          out.push({ name: g.name, ok: true, regiNo: r.regiNo, price: r.price });
        } catch (e) {
          out.push({ name: g.name, ok: false, error: e.message });
        }
      }
      let post = { stock: [], cafe24: [], sheet: null };
      if (shippedItems.length) post = await postProcessShipped(db, shippedItems);
      saveDb(db);
      return sendJson(res, 200, { ok: true, results: out, stock: post.stock, cafe24: post.cafe24, sheet: post.sheet, db });
    }
    if (url.pathname === '/api/cafe24/disconnect' && req.method === 'POST') {
      const db = loadDb();
      db.cafe24Token = null;
      saveDb(db);
      return sendJson(res, 200, { ok: true });
    }
    if (url.pathname === '/api/upload/cafe24' && req.method === 'POST') {
      const buf = await readBody(req);
      let wb;
      try { wb = XLSX.read(buf, { type: 'buffer' }); }
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
      const buf = await readBody(req);
      let wb;
      try { wb = XLSX.read(buf, { type: 'buffer' }); }
      catch (e) { return sendJson(res, 200, { error: '엑셀 파일을 읽지 못했습니다.' }); }
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      const db = loadDb();
      const result = await matchInvoices(db, rows);
      if (result.error) return sendJson(res, 200, { error: result.error });
      saveDb(db);
      return sendJson(res, 200, Object.assign({ ok: true, db }, result));
    }
    if (url.pathname === '/api/export/epost' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const db = loadDb();
      const r = exportEpost(db, body.selected || []);
      if (r.error) return sendJson(res, 200, r);
      saveDb(db);
      return sendJson(res, 200, Object.assign({ ok: true, db }, r));
    }
    // 정적 파일
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const fpath = path.join(PUBLIC_DIR, path.normalize(p).replace(/^([.\\/])+/, ''));
    if (fpath.startsWith(PUBLIC_DIR) && fs.existsSync(fpath) && fs.statSync(fpath).isFile()) {
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(fpath)] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*'
      });
      return fs.createReadStream(fpath).pipe(res);
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: '서버 오류: ' + e.message });
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log('이미 실행 중입니다. 브라우저에서 http://localhost:' + PORT + ' 를 여세요.');
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('배송 도우미 실행됨 → http://localhost:' + PORT);
  // 켜질 때 한 번 + 5분마다 자동으로 새 주문/시딩 확인
  syncAll().then(({ out }) => {
    console.log(`자동 확인: 시딩 +${out.seeding.added}, 시트주문 +${out.orders.added}, 카페24 +${out.cafe24.added}`);
  }).catch(e => console.log('자동 확인 실패:', e.message));
  setInterval(() => syncAll().catch(() => {}), 5 * 60 * 1000);
});
