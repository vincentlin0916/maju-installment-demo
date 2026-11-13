// ============================================================================
// 單檔示範頁：沒有伺服器，以頁面內的 MajuCore 模擬 MAJU 後端與合作電商商品 API。
// ============================================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => 'NT$ ' + Number(n).toLocaleString('zh-TW');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tileStyle = (p) => `background: linear-gradient(135deg, hsl(${p.hue} 60% 55%), hsl(${p.hue + 40} 55% 35%))`;

  const MERCHANT = { id: 'xmart_go', name: 'XMART GO' };
  const PARTNER_PRODUCTS = MajuCore.demoProducts();
  const store = MajuCore.createStore();

  // 模擬：MAJU 後端即時呼叫合作電商商品 API（含網路延遲）
  const fetchPartnerProduct = (id) => new Promise((resolve) => setTimeout(() => resolve(PARTNER_PRODUCTS[id] || null), 700));
  const unwrap = (r) => { if (r.status >= 400) throw new Error(r.body.error); return r.body; };
  const api = {
    members: async () => store.listMembers(),
    quote: async (pid, mid) => unwrap(store.quote(MERCHANT, await fetchPartnerProduct(pid), mid)),
    // 下單與申請都重新向合作商城取價並重算，不信任畫面上的金額
    createOrder: async (pid, mid, buyer) => unwrap(store.createOrder(MERCHANT, await fetchPartnerProduct(pid), mid, buyer)),
    cancelOrder: async (orderId) => unwrap(store.cancelOrder(orderId)),
    applyOverLimit: async (pid, mid, buyer) => unwrap(store.applyOverLimit(MERCHANT, await fetchPartnerProduct(pid), mid, buyer)),
    reviewOverLimit: async (requestId, approve) => unwrap(store.reviewOverLimit(requestId, approve)),
  };

  let productId = null;
  function route() {
    const checkout = location.hash === '#checkout' && productId;
    $('shopView').hidden = !!checkout;
    $('majuView').hidden = !checkout;
    if (checkout) MajuUI.load(productId);
    window.scrollTo(0, 0);
  }
  function goShop() { if (location.hash === '#shop') route(); else location.hash = '#shop'; }
  function goCheckout(id) { productId = id; if (location.hash === '#checkout') route(); else location.hash = '#checkout'; }
  window.addEventListener('hashchange', route);

  function renderShop() {
    const grid = $('grid');
    grid.innerHTML = '';
    for (const p of Object.values(PARTNER_PRODUCTS)) {
      const el = document.createElement('article');
      el.className = 'pcard';
      el.innerHTML = `
        <div class="tile" style="${tileStyle(p)}">${esc(p.brand)}</div>
        <div class="pbody">
          <div class="brand">${esc(p.brand)} <span class="tag">庫存 ${p.stock}</span></div>
          <div class="name">${esc(p.name)}</div>
          <div class="spec">${esc(p.spec)}</div>
          <div class="price">${fmt(p.price)}<small>一次付清</small></div>
          <div class="actions">
            <button class="btn btn-shop" type="button" data-buy="${p.id}">立即購買</button>
            <button class="btn btn-maju" type="button" data-maju="${p.id}">MAJU 分期付款<b>0 利率・每月最低繳 NT$3,000・免信用卡</b></button>
          </div>
          <div class="toast" data-toast="${p.id}"></div>
        </div>`;
      grid.appendChild(el);
    }
    grid.addEventListener('click', (e) => {
      const buy = e.target.closest('[data-buy]');
      const maju = e.target.closest('[data-maju]');
      if (buy) { const t = grid.querySelector(`[data-toast="${buy.dataset.buy}"]`); t.textContent = '這裡走 XMART GO 自己的結帳流程（示範未實作）'; setTimeout(() => { t.textContent = ''; }, 2500); }
      if (maju) goCheckout(maju.dataset.maju);
    });
  }

  renderShop();
  MajuUI.init({ api, memberId: 'm_vip3', onBack: goShop });
  route();
})();
