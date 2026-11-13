// MAJU 示範：計價、額度、逾期與繳款規則。
// 原型伺服器（server.js）與單檔示範頁共用同一份，兩邊的數字一定一致。
// 規則來源：2026-11-07 需求規劃書 + 2026-11-13 會議（取消期數、每月最低應繳、超額人工審核）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MajuCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // ==========================================================================
  // 後台可設定的參數（正式環境存資料庫，由管理後台維護並保留歷史）
  // ==========================================================================
  const SETTINGS = {
    minMonthlyPayment: 3000,   // 每月最低應繳；帳款不足此數時繳清餘額
    statementDay: 10,          // 每月出帳日（沿用 V2.6，2026-11-13 定案）
    paymentDueDay: 25,         // 每月繳款截止日（沿用 V2.6：10 日出帳、25 日截止）
    diamondRatePct: 105,       // 鑽石卡：原價 × 1.05
    vipRatePctOver50999: null, // 原價超過 50,999 的倍率（百分比）；null = 沿用每千元 +1%
    overLimitMaxExtra: 10000,  // 人工審核：最多可比等級額度多出的金額
    overLimitMinPaidPeriods: 1, // 人工審核：至少完成幾期繳款才可申請
    overdueLockDays: 7,        // 逾期達幾天：暫停新消費、一般 VIP 降一級（2026-11-13 定案）
    overdueLegalDays: 30,      // 逾期達幾天：停止所有交易並進入法律程序（2026-11-13 定案為一個月）
  };

  // 一般 VIP 等級、卡別與等級額度（每升一級 +5,000；連續 3 個月正常繳款升一級）
  const VIP_LEVELS = {
    1: { card: '綠卡', limit: 5000 },
    2: { card: '銀卡', limit: 10000 },
    3: { card: '金卡', limit: 15000 },
    4: { card: '白金卡', limit: 20000 },
    5: { card: '鈦金卡', limit: 25000 },
    6: { card: '黑金卡', limit: 30000 },
    7: { card: '紫金卡', limit: 35000 },
  };

  const nt = (n) => 'NT$ ' + Number(n).toLocaleString('zh-TW');

  // ==========================================================================
  // 示範資料
  // ==========================================================================
  function demoMembers() {
    return {
      m_vip1: { id: 'm_vip1', name: 'Maria Santos', type: 'vip', level: 1, outstanding: 0, reserved: 0, paidPeriods: 0, overdueDays: 0, kyc: 'approved' },
      m_vip3: { id: 'm_vip3', name: 'Nguyen Thi Hoa', type: 'vip', level: 3, outstanding: 4200, reserved: 0, paidPeriods: 5, overdueDays: 0, kyc: 'approved' },
      m_vip7: { id: 'm_vip7', name: 'Budi Santoso', type: 'vip', level: 7, outstanding: 0, reserved: 0, paidPeriods: 14, overdueDays: 0, kyc: 'approved' },
      m_diamond: { id: 'm_diamond', name: 'Somchai P.', type: 'diamond', deposit: 20000, outstanding: 6000, reserved: 0, paidPeriods: 3, overdueDays: 0, kyc: 'approved' },
      m_late3: { id: 'm_late3', name: 'Ana Lim', type: 'vip', level: 2, outstanding: 6500, reserved: 0, paidPeriods: 2, overdueDays: 3, kyc: 'approved' },
      // 原 VIP3，逾期達 7 天已降為 VIP2
      m_overdue: { id: 'm_overdue', name: 'Jose Reyes', type: 'vip', level: 2, outstanding: 9500, reserved: 0, paidPeriods: 4, overdueDays: 9, kyc: 'approved' },
      m_legal: { id: 'm_legal', name: 'Dewi Kartika', type: 'vip', level: 1, outstanding: 4800, reserved: 0, paidPeriods: 1, overdueDays: 35, kyc: 'approved' },
    };
  }

  // 模擬合作電商（XMART GO）的商品資料
  function demoProducts() {
    return {
      P001: { id: 'P001', name: 'AirPure 智慧空氣清淨機 Pro', brand: 'AirPure', spec: '適用 12 坪 / HEPA H13 / App 遠端控制', price: 15900, currency: 'TWD', stock: 23, hue: 200, image: 'https://picsum.photos/seed/airpure/800/800' },
      P002: { id: 'P002', name: 'NovaBook 14 吋輕薄筆電', brand: 'Nova', spec: '14" 2.8K OLED / 16GB / 512GB SSD', price: 32900, currency: 'TWD', stock: 8, hue: 260, image: 'https://picsum.photos/seed/novabook/800/800' },
      P003: { id: 'P003', name: 'ErgoChair 人體工學椅', brand: 'Ergo', spec: '網布椅背 / 4D 扶手 / 腰靠可調', price: 9800, currency: 'TWD', stock: 41, hue: 150, image: 'https://picsum.photos/seed/ergochair/800/800' },
      P004: { id: 'P004', name: 'SoundPod 真無線藍牙耳機', brand: 'SoundPod', spec: '主動降噪 / 30 小時續航', price: 1999, currency: 'TWD', stock: 120, hue: 20, image: 'https://picsum.photos/seed/soundpod/800/800' },
      P005: { id: 'P005', name: 'HydroFlask 保溫瓶 750ml', brand: 'Hydro', spec: '316 不鏽鋼 / 24 小時保冷', price: 399, currency: 'TWD', stock: 300, hue: 330, image: 'https://picsum.photos/seed/hydro/800/800' },
    };
  }

  // ==========================================================================
  // 價格引擎：一般 VIP 依原價區間倍率，鑽石卡固定 ×1.05，小數一律無條件進位
  //   1–499 ×1.05；500–999 ×1.10；1,000 起每滿 1,000 再 +0.01（50,000–50,999 = ×1.60）
  // 倍率以「百分比整數」計算，避免浮點誤差（1,500 × 1.11 用浮點會算成 1,666）。
  // ==========================================================================
  function vipRatePct(originalPrice) {
    if (originalPrice <= 499) return 105;
    if (originalPrice <= 999) return 110;
    if (originalPrice > 50999 && SETTINGS.vipRatePctOver50999) return SETTINGS.vipRatePctOver50999;
    return 110 + Math.floor(originalPrice / 1000);
  }

  function computeMajuPrice(originalPrice, member) {
    const original = Math.round(Number(originalPrice));
    const diamond = member.type === 'diamond';
    const pct = diamond ? SETTINGS.diamondRatePct : vipRatePct(original);
    const rate = pct / 100;
    return {
      price: Math.ceil((original * pct) / 100),
      rate,
      rule: `${diamond ? '鑽石卡固定倍率' : '一般 VIP 原價區間倍率'} ×${rate.toFixed(2)}`,
    };
  }

  // ==========================================================================
  // 額度：可用額度 = 等級額度（鑽石卡為已入帳保證金）− 未償還帳款 − 保留額度，最低為 0。
  // 人工審核多給的部分不另外記帳：帳款高於等級額度時可用額度就是 0，
  // 要繳到等級額度以內才會恢復。
  // ==========================================================================
  function creditOf(member) {
    const baseLimit = member.type === 'diamond' ? member.deposit : VIP_LEVELS[member.level].limit;
    const balance = member.outstanding + member.reserved;
    return {
      type: member.type,
      level: member.type === 'vip' ? member.level : null,
      card: member.type === 'diamond' ? '鑽石卡' : VIP_LEVELS[member.level].card,
      baseLimit,
      outstanding: member.outstanding,
      reserved: member.reserved,
      available: Math.max(0, baseLimit - balance),
      overBy: Math.max(0, balance - baseLimit),
      paidPeriods: member.paidPeriods || 0,
    };
  }

  // ==========================================================================
  // 帳戶狀態：KYC 與逾期分級
  // ==========================================================================
  function standing(member) {
    if (member.kyc !== 'approved') {
      return { code: 'kyc', canBuy: false, label: 'KYC 未通過', reason: '身分驗證（KYC）尚未通過，無法使用 MAJU 服務。' };
    }
    const d = member.overdueDays || 0;
    const vip = member.type === 'vip';
    if (d >= SETTINGS.overdueLegalDays) {
      return { code: 'legal', canBuy: false, label: `逾期 ${d} 天・永久停止交易`,
        reason: `帳款已逾期 ${d} 天，帳戶已停止所有交易並進入法律程序。請聯繫 MAJU 客服。` };
    }
    if (d >= SETTINGS.overdueLockDays) {
      return { code: 'locked', canBuy: false, label: `逾期 ${d} 天・暫停消費`,
        reason: `帳款已逾期 ${d} 天，已暫停新消費${vip ? '並調降一個會員等級' : ''}。繳清逾期款項並正式入帳後恢復消費${vip ? '，升級需重新累積 3 個月正常繳款' : ''}。` };
    }
    if (d > 0) {
      return { code: 'late', canBuy: true, label: `逾期 ${d} 天`,
        warning: `您有帳款已逾期 ${d} 天，請儘快繳款。逾期達 ${SETTINGS.overdueLockDays} 天將暫停新消費${vip ? '並調降會員等級' : ''}。` };
    }
    return { code: 'ok', canBuy: true, label: '' };
  }

  // ==========================================================================
  // 繳款：不分期數。每月最低應繳 3,000（帳款不足 3,000 時繳清餘額），可多繳或一次繳清。
  // ==========================================================================
  function dueDates(count, now) {
    const today = now || new Date();
    const y = today.getFullYear();
    // 出帳日之後才成立的消費歸入下個月的帳單；每張帳單在當月的繳款截止日到期
    const m = today.getMonth() + (today.getDate() >= SETTINGS.statementDay ? 1 : 0);
    const out = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(y, m + i, SETTINGS.paymentDueDay); // 本地時區，避免轉 UTC 後日期退一天
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return out;
  }

  // 以「每月只繳最低應繳」試算繳清時程
  function repaymentOf(balance, now) {
    const min = SETTINGS.minMonthlyPayment;
    const months = Math.ceil(balance / min);
    let remain = balance;
    const schedule = dueDates(months, now).map((dueDate, i) => {
      const amount = Math.min(min, remain);
      remain -= amount;
      return { period: i + 1, dueDate, amount, remaining: remain };
    });
    return {
      balance,
      minPayment: Math.min(min, balance),
      dueDay: SETTINGS.paymentDueDay,
      firstDueDate: schedule.length ? schedule[0].dueDate : null,
      estimatedMonths: months,
      schedule,
    };
  }

  // 會員自填繳款金額的檢核：最低應繳 ≤ 金額 ≤ 帳款（不能預繳超過帳款）
  function validatePayment(amount, balance) {
    const min = Math.min(SETTINGS.minMonthlyPayment, balance);
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, min, max: balance, reason: '請輸入整數金額' };
    if (n < min) return { ok: false, min, max: balance, reason: `最低應繳 ${nt(min)}` };
    if (n > balance) return { ok: false, min, max: balance, reason: `不能超過目前帳款 ${nt(balance)}` };
    return { ok: true, min, max: balance };
  }

  // ==========================================================================
  // 額度不足時：一般 VIP 可針對單筆訂單申請人工審核
  // ==========================================================================
  function overLimitOf(member, credit, majuPrice, st) {
    const shortfall = majuPrice - credit.available;
    const extra = member.outstanding + member.reserved + majuPrice - credit.baseLimit; // 成立後會比等級額度多出多少
    const base = { extra, maxExtra: SETTINGS.overLimitMaxExtra };
    if (member.type === 'diamond') {
      return { ...base, canApply: false, message: `鑽石卡額度依保證金計算，請先追加保證金至少 ${nt(shortfall)}，入帳後再進行交易。` };
    }
    if (st.code === 'late') {
      return { ...base, canApply: false, message: '帳款逾期中，繳清逾期款項後才能申請人工審核。' };
    }
    if (credit.overBy > 0) {
      // 已經用過人工審核的超額：多給的部分沒還完之前，連小額也不能再買
      return { ...base, canApply: false, message: `目前帳款已高於等級額度 ${nt(credit.overBy)}。要先把帳款繳到等級額度以內，才能再消費。` };
    }
    if ((member.paidPeriods || 0) < SETTINGS.overLimitMinPaidPeriods) {
      return { ...base, canApply: false, message: `您還沒有繳款紀錄。完成至少 ${SETTINGS.overLimitMinPaidPeriods} 期繳款後，才能申請人工審核。` };
    }
    if (extra > SETTINGS.overLimitMaxExtra) {
      return { ...base, canApply: false, message: `這筆訂單會比等級額度多 ${nt(extra)}，超過人工審核上限 ${nt(SETTINGS.overLimitMaxExtra)}，無法申請。` };
    }
    return { ...base, canApply: true,
      message: `您可以針對這一筆訂單申請人工審核，最多可比等級額度多 ${nt(SETTINGS.overLimitMaxExtra)}。核准後，要先把帳款繳到等級額度以內，才會恢復可用額度。` };
  }

  // ==========================================================================
  // 報價（查詢與下單共用；下單時重新計算，不信任前端金額）
  // 原價、倍率與計算方式放在 _calc，只留在後端與訂單快照，不回傳給顧客端。
  // ==========================================================================
  function buildQuote(merchant, product, member, now) {
    const original = Math.round(Number(product.price));
    const pricing = computeMajuPrice(original, member);
    const credit = creditOf(member);
    const st = standing(member);
    const balanceAfter = member.outstanding + member.reserved + pricing.price;
    const sufficient = pricing.price <= credit.available;

    let eligibility;
    if (!st.canBuy) eligibility = { ok: false, code: 'blocked', reason: st.reason };
    else if (sufficient) eligibility = { ok: true, warning: st.warning || null };
    else {
      eligibility = { ok: false, code: 'insufficient_credit', reason: '可用額度不足',
        shortfall: pricing.price - credit.available, overLimit: overLimitOf(member, credit, pricing.price, st) };
    }

    return {
      merchant: { id: merchant.id, name: merchant.name, returnUrl: merchant.returnUrl || null },
      product: { id: product.id, name: product.name, brand: product.brand, spec: product.spec, stock: product.stock, hue: product.hue, currency: product.currency || 'TWD' },
      member: { id: member.id, name: member.name, ...credit },
      pricing: { majuPrice: pricing.price, availableAfter: Math.max(0, credit.baseLimit - balanceAfter) },
      _calc: { originalPrice: original, rate: pricing.rate, rule: pricing.rule },
      repayment: repaymentOf(balanceAfter, now),
      eligibility,
      settings: {
        minMonthlyPayment: SETTINGS.minMonthlyPayment, statementDay: SETTINGS.statementDay, paymentDueDay: SETTINGS.paymentDueDay,
        overLimitMaxExtra: SETTINGS.overLimitMaxExtra, overdueLockDays: SETTINGS.overdueLockDays, overdueLegalDays: SETTINGS.overdueLegalDays,
      },
      fetchedAt: (now || new Date()).toISOString(),
    };
  }

  // ==========================================================================
  // 記憶體內的會員、訂單與人工審核申請（示範用）。
  // 每個方法回傳 { status, body }，伺服器直接當 HTTP 回應，單檔示範頁當模擬 API。
  // ==========================================================================
  function createStore() {
    const members = demoMembers();
    const orders = new Map();
    const requests = new Map();
    const newId = (prefix) => prefix + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 65536).toString(16).toUpperCase().padStart(4, '0');
    const err = (status, error, extra) => ({ status, body: { error, ...(extra || {}) } });

    const publicQuote = (q) => { const { _calc, ...rest } = q; return rest; };
    const publicOrder = (o) => { const { originalPrice, rate, rule, ...snapshot } = o.priceSnapshot; return { ...o, priceSnapshot: snapshot }; };
    const publicRequest = (r) => ({
      requestId: r.requestId, status: r.status, memberId: r.memberId, productName: r.product.name, majuPrice: r.majuPrice,
      levelLimit: r.levelLimit, balanceAfter: r.balanceAfter, extra: r.extra, phone: r.buyer.phone, createdAt: r.createdAt, reviewedAt: r.reviewedAt || null,
    });

    function check(merchant, product, memberId, buyer, needBuyer) {
      const member = members[memberId];
      if (!merchant) return err(400, '未知的合作商城');
      if (!member) return err(401, '請先登入 MAJU 會員');
      if (!product) return err(404, '合作商城查無此商品');
      if (needBuyer) {
        if (!buyer || !/^09\d{8}$/.test(String(buyer.phone || ''))) return err(400, '請填寫 09 開頭的 10 碼手機號碼');
        if (product.stock <= 0) return err(409, '商品已無庫存');
      }
      return { member };
    }

    function makeOrder(merchant, product, member, buyer, quote, overLimit) {
      member.reserved += quote.pricing.majuPrice; // 保留額度；取消後釋放
      const order = {
        orderId: newId('MJ'),
        channel: 'xmart_go_online',
        merchant: merchant.id,
        merchantName: merchant.name,
        memberId: member.id,
        product: { id: product.id, name: product.name, brand: product.brand, spec: product.spec, hue: product.hue },
        // 價格快照與計算紀錄：倍率日後調整不影響已成立訂單
        priceSnapshot: { originalPrice: quote._calc.originalPrice, majuPrice: quote.pricing.majuPrice, rate: quote._calc.rate, rule: quote._calc.rule, memberType: member.type, memberLevel: member.level || null },
        repayment: quote.repayment,
        overLimit: overLimit || null,
        buyer: { name: member.name, phone: buyer.phone, email: buyer.email || '' },
        creditAfter: creditOf(member),
        status: 'pending_payment',
        createdAt: new Date().toISOString(),
      };
      orders.set(order.orderId, order);
      return order;
    }

    return {
      members, orders, requests,

      listMembers() {
        return Object.values(members).map((m) => {
          const st = standing(m);
          return { id: m.id, name: m.name, card: creditOf(m).card, tag: st.label || (m.paidPeriods ? '' : '尚未繳過款') };
        });
      },

      quote(merchant, product, memberId) {
        const c = check(merchant, product, memberId);
        if (!c.member) return c;
        return { status: 200, body: publicQuote(buildQuote(merchant, product, c.member)) };
      },

      // 額度足夠：直接成立訂單並保留額度
      createOrder(merchant, product, memberId, buyer) {
        const c = check(merchant, product, memberId, buyer, true);
        if (!c.member) return c;
        const quote = buildQuote(merchant, product, c.member);
        if (!quote.eligibility.ok) return err(403, quote.eligibility.reason, { code: quote.eligibility.code });
        const order = makeOrder(merchant, product, c.member, buyer, quote, null);
        return { status: 201, body: { order: publicOrder(order), returnUrl: merchant.returnUrl || null }, log: `order ${order.orderId}: ${c.member.id} ${product.name} 原價 ${quote._calc.originalPrice} → MAJU ${quote.pricing.majuPrice}（${quote._calc.rule}）` };
      },

      cancelOrder(orderId) {
        const order = orders.get(orderId);
        if (!order) return err(404, '查無此訂單');
        const member = members[order.memberId];
        if (order.status !== 'cancelled') {
          member.reserved = Math.max(0, member.reserved - order.priceSnapshot.majuPrice);
          order.status = 'cancelled';
          order.cancelledAt = new Date().toISOString();
        }
        return { status: 200, body: { order: publicOrder(order), creditAfter: creditOf(member) } };
      },

      // 額度不足：送出單筆訂單的人工審核申請（此時不保留額度、訂單尚未成立）
      applyOverLimit(merchant, product, memberId, buyer) {
        const c = check(merchant, product, memberId, buyer, true);
        if (!c.member) return c;
        const quote = buildQuote(merchant, product, c.member);
        const e = quote.eligibility;
        if (e.ok) return err(409, '可用額度足夠，請直接確認交易');
        if (e.code !== 'insufficient_credit') return err(403, e.reason, { code: e.code });
        if (!e.overLimit.canApply) return err(403, e.overLimit.message, { code: 'over_limit_not_allowed' });
        const request = {
          requestId: newId('OL'), status: 'pending_review', memberId: c.member.id, merchant, product, quote, buyer,
          majuPrice: quote.pricing.majuPrice, levelLimit: quote.member.baseLimit, balanceAfter: quote.repayment.balance, extra: e.overLimit.extra,
          createdAt: new Date().toISOString(),
        };
        requests.set(request.requestId, request);
        return { status: 201, body: { request: publicRequest(request) } };
      },

      // 後台審核（示範用按鈕呼叫）。核准才成立訂單。
      reviewOverLimit(requestId, approve) {
        const r = requests.get(requestId);
        if (!r) return err(404, '查無此申請');
        if (r.status !== 'pending_review') return err(409, '這筆申請已經審核過了');
        const member = members[r.memberId];
        r.reviewedAt = new Date().toISOString();
        if (!approve) {
          r.status = 'rejected';
          return { status: 200, body: { request: publicRequest(r), creditAfter: creditOf(member) } };
        }
        // 核准當下重新檢查：會員狀態與超額上限
        const st = standing(member);
        const extraNow = member.outstanding + member.reserved + r.majuPrice - creditOf(member).baseLimit;
        if (!st.canBuy || st.code === 'late') { r.status = 'rejected'; return err(409, '會員目前有逾期帳款，無法核准'); }
        if (extraNow > SETTINGS.overLimitMaxExtra) { r.status = 'rejected'; return err(409, `目前帳款已變動，超過人工審核上限 ${nt(SETTINGS.overLimitMaxExtra)}，無法核准`); }
        r.status = 'approved';
        const order = makeOrder(r.merchant, r.product, member, r.buyer, r.quote, { requestId: r.requestId, extra: extraNow });
        order.repayment = repaymentOf(member.outstanding + member.reserved);
        return { status: 200, body: { request: publicRequest(r), order: publicOrder(order), returnUrl: r.merchant.returnUrl || null, creditAfter: creditOf(member) } };
      },
    };
  }

  return { SETTINGS, VIP_LEVELS, nt, demoMembers, demoProducts, vipRatePct, computeMajuPrice, creditOf, standing, repaymentOf, validatePayment, buildQuote, createStore };
});
