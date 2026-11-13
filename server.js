// MAJU 先買後付 – 線上通路（XMART GO → MAJU）原型伺服器
// Node 18+，無需任何套件。
//
// 角色：
//   1. 模擬「合作電商（XMART GO）」的商品 API（/partner-api/...）
//   2. MAJU 後端：即時呼叫合作電商 API 取得商品 → 依會員計算 MAJU 售價、額度與繳款試算（/api/quote）
//   3. 額度足夠：建立訂單並保留額度（/api/orders）
//      額度不足：單筆訂單人工審核申請（/api/over-limit-requests）
//   4. 靜態頁面：/partner/（XMART GO 示範頁）、/maju/checkout（MAJU 確認頁）
//
// 計價、額度、逾期與繳款規則都在 lib/core.js（不放在 public/，顧客端拿不到計算方式）。

const http = require('http');
const fs = require('fs');
const path = require('path');
const core = require('./lib/core');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// 合作電商設定（正式環境放資料庫，由後台「廠商管理」維護）
const MERCHANTS = {
  xmart_go: {
    id: 'xmart_go',
    name: 'XMART GO',
    apiBase: `http://127.0.0.1:${PORT}/partner-api`, // 合作電商商品 API
    apiKey: 'xmart-go-partner-key',                   // MAJU 呼叫合作電商 API 的金鑰
    returnUrl: `http://localhost:${PORT}/partner/`,
  },
};

const PARTNER_PRODUCTS = core.demoProducts(); // 模擬合作電商的商品資料
const store = core.createStore();             // 記憶體內的會員、訂單與人工審核申請

// 即時向合作電商的 API 取得商品資料
async function fetchPartnerProduct(merchant, productId) {
  const url = `${merchant.apiBase}/products/${encodeURIComponent(productId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(url, { headers: { 'X-API-Key': merchant.apiKey, Accept: 'application/json' }, signal: controller.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`partner API responded ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function send(res, result) {
  if (result.log) console.log(result.log);
  sendJson(res, result.status, result.body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}

// 下單與申請共用：讀取請求、向合作電商重新取商品（不信任前端金額）
async function loadPurchase(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { sendJson(res, 400, { error: e.message }); return null; }
  const merchant = MERCHANTS[body.merchant];
  if (!merchant) { sendJson(res, 400, { error: '未知的合作商城' }); return null; }
  let product;
  try { product = await fetchPartnerProduct(merchant, body.productId); }
  catch (e) { console.error('partner API error:', e.message); sendJson(res, 502, { error: '無法取得合作商城的商品資料，請稍後再試' }); return null; }
  return { merchant, product, memberId: body.member, buyer: body.buyer };
}

async function handleApi(req, res, url) {
  // ---- 模擬：合作電商（XMART GO）的商品 API --------------------------------
  let m = url.pathname.match(/^\/partner-api\/products\/([^/]+)$/);
  if (m && req.method === 'GET') {
    if (req.headers['x-api-key'] !== MERCHANTS.xmart_go.apiKey) return sendJson(res, 401, { error: 'invalid api key' });
    const p = PARTNER_PRODUCTS[m[1]];
    if (!p) return sendJson(res, 404, { error: 'product not found' });
    await new Promise((r) => setTimeout(r, 400)); // 模擬網路延遲，讓「即時讀取」狀態看得到
    return sendJson(res, 200, p);
  }
  if (url.pathname === '/partner-api/products' && req.method === 'GET') return sendJson(res, 200, Object.values(PARTNER_PRODUCTS));

  // ---- MAJU：示範會員清單（僅供原型切換會員） -------------------------------
  if (url.pathname === '/api/demo-members' && req.method === 'GET') return sendJson(res, 200, store.listMembers());

  // ---- MAJU：取得商品、售價、額度與繳款試算 ---------------------------------
  if (url.pathname === '/api/quote' && req.method === 'GET') {
    const merchant = MERCHANTS[url.searchParams.get('merchant')];
    const productId = url.searchParams.get('product_id');
    const memberId = url.searchParams.get('member') || 'm_vip3'; // 正式環境：由登入 session 取得
    if (!merchant) return sendJson(res, 400, { error: '未知的合作商城' });
    if (!productId) return sendJson(res, 400, { error: '缺少商品編號' });
    let product;
    try { product = await fetchPartnerProduct(merchant, productId); }
    catch (e) { console.error('partner API error:', e.message); return sendJson(res, 502, { error: '無法取得合作商城的商品資料，請稍後再試' }); }
    return send(res, store.quote(merchant, product, memberId));
  }

  // ---- MAJU：額度足夠，建立訂單並保留額度 -----------------------------------
  if (url.pathname === '/api/orders' && req.method === 'POST') {
    const p = await loadPurchase(req, res);
    if (!p) return;
    return send(res, store.createOrder(p.merchant, p.product, p.memberId, p.buyer));
  }

  // ---- MAJU：取消訂單並釋放額度 ------------------------------------------
  m = url.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
  if (m && req.method === 'POST') return send(res, store.cancelOrder(m[1]));

  // ---- MAJU：額度不足，單筆訂單人工審核申請 ---------------------------------
  if (url.pathname === '/api/over-limit-requests' && req.method === 'POST') {
    const p = await loadPurchase(req, res);
    if (!p) return;
    return send(res, store.applyOverLimit(p.merchant, p.product, p.memberId, p.buyer));
  }
  // 後台審核結果（原型以示範按鈕呼叫；正式環境在管理後台，需員工登入與權限）
  m = url.pathname.match(/^\/api\/over-limit-requests\/([^/]+)\/(approve|reject)$/);
  if (m && req.method === 'POST') return send(res, store.reviewOverLimit(m[1], m[2] === 'approve'));

  return sendJson(res, 404, { error: 'not found' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/partner/';
  if (rel.endsWith('/')) rel += 'index.html';
  if (rel === '/maju/checkout') rel = '/maju/checkout.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/partner-api/')) {
    try { await handleApi(req, res, url); } catch (e) { console.error(e); sendJson(res, 500, { error: 'internal error' }); }
    return;
  }
  serveStatic(res, url.pathname);
}).listen(PORT, () => {
  console.log('MAJU 先買後付原型已啟動');
  console.log(`  XMART GO 示範頁:  http://localhost:${PORT}/partner/`);
  console.log(`  MAJU 確認頁:      http://localhost:${PORT}/maju/checkout?merchant=xmart_go&product_id=P001`);
});
