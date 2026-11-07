// MAJU 先買後付分期購物平台 – 線上通路（XMART GO → MAJU）原型伺服器
// Node 18+，無需任何套件。對應需求規劃書：
//   第 3 章 一般 VIP 等級與額度、第 4 章 鑽石卡、第 5 章 商品定價與分期、
//   第 6.1 節 線上購物流程、第 7 章 共用額度與保留額度、第 8.1 節 每月最低應繳。
//
// 角色：
//   1. 模擬「合作電商（XMART GO）」的商品 API（/partner-api/...）
//   2. MAJU 後端：即時呼叫合作電商 API 取得商品 → 依會員類型計算 MAJU 售價、分期方案、可用額度（/api/quote）
//   3. 建立訂單並保留額度（/api/orders）
//   4. 靜態頁面：/partner/（XMART GO 示範頁）、/maju/checkout（MAJU 確認頁）

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ===========================================================================
// 後台可設定的參數（正式環境存於資料庫，由管理後台維護）
// ===========================================================================
const SETTINGS = {
  minMonthlyPayment: 3000, // 每月最低應繳金額（8.1）
  paymentDueDay: 10,       // 每月最低應繳日（8.1）
  // 各 VIP 等級可選期數（5.2：由後台設定，勿寫死）
  installmentTermsByLevel: {
    1: [3, 6, 9, 12], 2: [3, 6, 9, 12], 3: [3, 6, 9, 12], 4: [3, 6, 9, 12],
    5: [3, 6, 9, 12], 6: [3, 6, 9, 12], 7: [3, 6, 9, 12],
  },
  diamondRate: 1.05,       // 鑽石卡：原價 × 1.05（4.2）
  vipRateOver50999: null,  // 超過 NT$50,999 的倍率延伸設定；null = 沿用「每千元 +0.01」公式
};

// 一般 VIP 等級、卡別與基本購物額度（3.1）
const VIP_LEVELS = {
  1: { card: '綠卡', limit: 5000 },
  2: { card: '銀卡', limit: 10000 },
  3: { card: '金卡', limit: 15000 },
  4: { card: '白金卡', limit: 20000 },
  5: { card: '鈦金卡', limit: 25000 },
  6: { card: '黑金卡', limit: 30000 },
  7: { card: '紫金卡', limit: 35000 },
};

// ===========================================================================
// 合作電商設定
// ===========================================================================
const MERCHANTS = {
  xmart_go: {
    id: 'xmart_go',
    name: 'XMART GO',
    apiBase: `http://127.0.0.1:${PORT}/partner-api`, // 合作電商商品 API
    apiKey: 'xmart-go-partner-key',                   // MAJU 呼叫合作電商 API 的金鑰
    returnUrl: `http://localhost:${PORT}/partner/`,
  },
};

// ===========================================================================
// 模擬：已登入的 MAJU 會員（正式環境由登入 session 取得，並須 KYC 審核通過）
// ===========================================================================
const MEMBERS = {
  m_vip1: { id: 'm_vip1', name: 'Maria Santos', type: 'vip', level: 1, outstanding: 2800, reserved: 0, kyc: 'approved', status: 'active' },
  m_vip3: { id: 'm_vip3', name: 'Nguyen Thi Hoa', type: 'vip', level: 3, outstanding: 4200, reserved: 0, kyc: 'approved', status: 'active' },
  m_vip7: { id: 'm_vip7', name: 'Budi Santoso', type: 'vip', level: 7, outstanding: 0, reserved: 0, kyc: 'approved', status: 'active' },
  m_diamond: { id: 'm_diamond', name: 'Somchai P.', type: 'diamond', deposit: 20000, outstanding: 6000, reserved: 0, kyc: 'approved', status: 'active' },
  m_overdue: { id: 'm_overdue', name: 'Jose Reyes', type: 'vip', level: 2, outstanding: 9500, reserved: 0, kyc: 'approved', status: 'suspended', overdueDays: 3 },
};

// ===========================================================================
// 模擬合作電商（XMART GO）的商品資料
// ===========================================================================
const PARTNER_PRODUCTS = {
  P001: { id: 'P001', name: 'AirPure 智慧空氣清淨機 Pro', brand: 'AirPure', spec: '適用 12 坪 / HEPA H13 / App 遠端控制', price: 15900, currency: 'TWD', stock: 23, image: 'https://picsum.photos/seed/airpure/800/800' },
  P002: { id: 'P002', name: 'NovaBook 14 吋輕薄筆電', brand: 'Nova', spec: '14" 2.8K OLED / 16GB / 512GB SSD', price: 32900, currency: 'TWD', stock: 8, image: 'https://picsum.photos/seed/novabook/800/800' },
  P003: { id: 'P003', name: 'ErgoChair 人體工學椅', brand: 'Ergo', spec: '網布椅背 / 4D 扶手 / 腰靠可調', price: 9800, currency: 'TWD', stock: 41, image: 'https://picsum.photos/seed/ergochair/800/800' },
  P004: { id: 'P004', name: 'SoundPod 真無線藍牙耳機', brand: 'SoundPod', spec: '主動降噪 / 30 小時續航', price: 1999, currency: 'TWD', stock: 120, image: 'https://picsum.photos/seed/soundpod/800/800' },
  P005: { id: 'P005', name: 'HydroFlask 保溫瓶 750ml', brand: 'Hydro', spec: '316 不鏽鋼 / 24 小時保冷', price: 399, currency: 'TWD', stock: 300, image: 'https://picsum.photos/seed/hydro/800/800' },
};

const ORDERS = new Map(); // 記憶體內訂單（原型用）

// ===========================================================================
// 價格引擎（第 5 章）
// ===========================================================================
// 一般 VIP：依商品原價區間套用倍率
//   1–499 ×1.05；500–999 ×1.10；1,000–1,999 ×1.11；之後每增加 NT$1,000 倍率 +0.01（50,000–50,999 = ×1.60）
function vipRate(originalPrice) {
  if (originalPrice <= 499) return 1.05;
  if (originalPrice <= 999) return 1.10;
  if (originalPrice > 50999 && SETTINGS.vipRateOver50999) return SETTINGS.vipRateOver50999;
  const thousands = Math.floor(originalPrice / 1000);
  return Math.round((1.10 + 0.01 * thousands) * 100) / 100;
}

// 回傳 { price, rate, rule }；小數一律無條件進位（5.1 第 5 點、4.2）
function computeMajuPrice(originalPrice, member) {
  const original = Math.round(Number(originalPrice));
  if (member.type === 'diamond') {
    const rate = SETTINGS.diamondRate;
    return { price: Math.ceil(original * rate), rate, rule: `鑽石卡固定倍率 ×${rate.toFixed(2)}` };
  }
  const rate = vipRate(original);
  return { price: Math.ceil(original * rate), rate, rule: `一般 VIP 原價區間倍率 ×${rate.toFixed(2)}` };
}

// ===========================================================================
// 額度（第 7.1 節）：可用額度 = 基本購物額度 − 未償還帳款 − 待完成交易保留額度
// ===========================================================================
function creditOf(member) {
  const baseLimit = member.type === 'diamond' ? member.deposit : VIP_LEVELS[member.level].limit;
  const available = Math.max(0, baseLimit - member.outstanding - member.reserved);
  return {
    type: member.type,
    level: member.type === 'vip' ? member.level : null,
    card: member.type === 'diamond' ? '鑽石卡' : VIP_LEVELS[member.level].card,
    baseLimit,
    outstanding: member.outstanding,
    reserved: member.reserved,
    available,
  };
}

// ===========================================================================
// 分期方案（第 5.2 節）
// ===========================================================================
function nextDueDates(count) {
  const today = new Date();
  const dates = [];
  // 第一期帳單日：下一個 10 日
  let y = today.getFullYear();
  let m = today.getMonth() + (today.getDate() >= SETTINGS.paymentDueDay ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const d = new Date(y, m + i, SETTINGS.paymentDueDay); // 本地時區，避免轉 UTC 後日期退一天
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return dates;
}

function buildPlans(majuPrice, member) {
  if (member.type === 'diamond') {
    // 鑽石卡：不設固定期數，每月最低應繳 NT$3,000 繳到清償（4.3）
    const months = Math.ceil(majuPrice / SETTINGS.minMonthlyPayment);
    const dates = nextDueDates(months);
    let remain = majuPrice;
    const schedule = dates.map((dueDate, i) => {
      const amount = Math.min(SETTINGS.minMonthlyPayment, remain);
      remain -= amount;
      return { period: i + 1, dueDate, amount };
    });
    return [{ kind: 'revolving', terms: null, label: '依每月最低應繳繳款', interestRate: 0, fee: 0, perPeriod: SETTINGS.minMonthlyPayment, lastPeriod: schedule[schedule.length - 1].amount, total: majuPrice, estimatedMonths: months, schedule }];
  }
  const termsList = SETTINGS.installmentTermsByLevel[member.level] || [3];
  return termsList.map((terms) => {
    const base = Math.floor(majuPrice / terms);
    const remainder = majuPrice - base * terms; // 尾差併入最後一期
    const dates = nextDueDates(terms);
    const schedule = dates.map((dueDate, i) => ({ period: i + 1, dueDate, amount: i === terms - 1 ? base + remainder : base }));
    return { kind: 'installment', terms, label: `${terms} 期`, interestRate: 0, fee: 0, perPeriod: base, lastPeriod: base + remainder, total: majuPrice, schedule };
  });
}

// 會員是否可進行新交易（第 9 章：任何逾期立即停止新交易；KYC 未通過不得使用）
function eligibility(member) {
  if (member.kyc !== 'approved') return { ok: false, reason: '身分驗證（KYC）尚未通過，無法使用分期服務' };
  if (member.status === 'suspended') return { ok: false, reason: `帳戶已逾期 ${member.overdueDays} 天，暫停所有新交易；完成最低應繳並正式入帳後恢復` };
  if (member.status !== 'active') return { ok: false, reason: '帳戶狀態異常，請聯繫客服' };
  return { ok: true };
}

// ===========================================================================
// 即時向合作電商的 API 取得商品資料
// ===========================================================================
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

// ===========================================================================
// HTTP 工具
// ===========================================================================
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}

// 組合報價（quote 與下單共用，下單時重新計算、不信任前端金額）
function buildQuote(merchant, product, member) {
  const original = Math.round(Number(product.price));
  const pricing = computeMajuPrice(original, member);
  const credit = creditOf(member);
  const elig = eligibility(member);
  const sufficient = pricing.price <= credit.available;
  return {
    merchant: { id: merchant.id, name: merchant.name, returnUrl: merchant.returnUrl },
    product: { id: product.id, name: product.name, brand: product.brand, spec: product.spec, image: product.image, stock: product.stock, currency: product.currency || 'TWD' },
    member: { id: member.id, name: member.name, ...credit },
    // 原價、倍率與計算方式僅保存在後端訂單快照，不回傳給前端顯示
    pricing: { majuPrice: pricing.price, availableAfter: credit.available - pricing.price },
    _calc: { originalPrice: original, rate: pricing.rate, rule: pricing.rule },
    eligibility: elig.ok && !sufficient
      ? { ok: false, reason: '可用額度不足', code: 'insufficient_credit', shortfall: pricing.price - credit.available,
          action: member.type === 'diamond' ? '請先追加保證金，入帳後再進行交易' : '可針對本筆訂單申請人工超額審核（不代表永久提高額度）' }
      : elig.ok ? { ok: true } : { ok: false, reason: elig.reason, code: 'blocked' },
    settings: { minMonthlyPayment: SETTINGS.minMonthlyPayment, paymentDueDay: SETTINGS.paymentDueDay },
    plans: buildPlans(pricing.price, member),
    fetchedAt: new Date().toISOString(),
  };
}

// ===========================================================================
// 路由
// ===========================================================================
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
  if (url.pathname === '/api/demo-members' && req.method === 'GET') {
    return sendJson(res, 200, Object.values(MEMBERS).map((mm) => ({ id: mm.id, name: mm.name, card: creditOf(mm).card, status: mm.status })));
  }

  // ---- MAJU：取得商品、售價、額度與分期方案 ---------------------------------
  if (url.pathname === '/api/quote' && req.method === 'GET') {
    const merchant = MERCHANTS[url.searchParams.get('merchant')];
    const productId = url.searchParams.get('product_id');
    const member = MEMBERS[url.searchParams.get('member') || 'm_vip3']; // 正式環境：由登入 session 取得
    if (!merchant) return sendJson(res, 400, { error: '未知的合作商城' });
    if (!productId) return sendJson(res, 400, { error: '缺少商品編號' });
    if (!member) return sendJson(res, 401, { error: '請先登入 MAJU 會員' });

    let product;
    try { product = await fetchPartnerProduct(merchant, productId); }
    catch (e) { console.error('partner API error:', e.message); return sendJson(res, 502, { error: '無法取得合作商城的商品資料，請稍後再試' }); }
    if (!product) return sendJson(res, 404, { error: '合作商城查無此商品' });

    const { _calc, ...publicQuote } = buildQuote(merchant, product, member);
    return sendJson(res, 200, publicQuote);
  }

  // ---- MAJU：建立訂單並保留額度 -------------------------------------------
  if (url.pathname === '/api/orders' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const { merchant: merchantId, productId, terms, member: memberId, buyer } = body;
    const merchant = MERCHANTS[merchantId];
    const member = MEMBERS[memberId];
    if (!merchant) return sendJson(res, 400, { error: '未知的合作商城' });
    if (!member) return sendJson(res, 401, { error: '請先登入 MAJU 會員' });
    if (!buyer || !buyer.phone) return sendJson(res, 400, { error: '請填寫聯絡手機' });

    let product;
    try { product = await fetchPartnerProduct(merchant, productId); }
    catch { return sendJson(res, 502, { error: '無法取得合作商城的商品資料' }); }
    if (!product) return sendJson(res, 404, { error: '合作商城查無此商品' });
    if (product.stock <= 0) return sendJson(res, 409, { error: '商品已無庫存' });

    const quote = buildQuote(merchant, product, member);
    if (!quote.eligibility.ok) return sendJson(res, 403, { error: quote.eligibility.reason, code: quote.eligibility.code });
    const plan = member.type === 'diamond' ? quote.plans[0] : quote.plans.find((p) => p.terms === Number(terms));
    if (!plan) return sendJson(res, 400, { error: '期數不正確' });

    // 保留額度（7.1）：待付款交易保留額度，取消後釋放
    member.reserved += quote.pricing.majuPrice;

    const orderId = 'MJ' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
    const order = {
      orderId,
      channel: 'xmart_go_online',
      merchant: merchant.id,
      merchantName: merchant.name,
      memberId: member.id,
      product: { id: product.id, name: product.name, image: product.image, spec: product.spec },
      // 價格快照與計算紀錄（5.1 第 7 點）
      priceSnapshot: { originalPrice: quote._calc.originalPrice, majuPrice: quote.pricing.majuPrice, rate: quote._calc.rate, rule: quote._calc.rule, memberType: member.type, memberLevel: member.level || null },
      plan,
      buyer: { name: member.name, phone: buyer.phone, email: buyer.email || '' },
      creditAfter: creditOf(member),
      status: 'pending_payment', // 已建立並保留額度，等待付款確認
      createdAt: new Date().toISOString(),
    };
    ORDERS.set(orderId, order);
    console.log(`order ${orderId}: ${member.id} ${product.name} 原價 ${quote._calc.originalPrice} → MAJU ${quote.pricing.majuPrice}（${quote._calc.rule}）${plan.label}`);
    // 回傳給前端的訂單不含原價、倍率與計算方式
    const { originalPrice, rate, rule, ...snapshotPublic } = order.priceSnapshot;
    return sendJson(res, 201, { order: { ...order, priceSnapshot: snapshotPublic }, returnUrl: merchant.returnUrl });
  }

  // ---- MAJU：取消訂單並釋放額度 ------------------------------------------
  m = url.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
  if (m && req.method === 'POST') {
    const order = ORDERS.get(m[1]);
    if (!order) return sendJson(res, 404, { error: 'order not found' });
    if (order.status === 'cancelled') return sendJson(res, 200, order);
    const member = MEMBERS[order.memberId];
    member.reserved = Math.max(0, member.reserved - order.priceSnapshot.majuPrice);
    order.status = 'cancelled';
    order.cancelledAt = new Date().toISOString();
    return sendJson(res, 200, { order, creditAfter: creditOf(member) });
  }

  m = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (m && req.method === 'GET') {
    const order = ORDERS.get(m[1]);
    return order ? sendJson(res, 200, order) : sendJson(res, 404, { error: 'order not found' });
  }

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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
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
  console.log('MAJU 分期原型已啟動');
  console.log(`  XMART GO 示範頁:  http://localhost:${PORT}/partner/`);
  console.log(`  MAJU 確認頁:      http://localhost:${PORT}/maju/checkout?merchant=xmart_go&product_id=P001`);
});
