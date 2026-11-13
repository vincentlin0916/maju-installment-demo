// 原型伺服器版：所有資料都向 MAJU 後端（server.js）取得，頁面本身不含任何計價規則。
(function () {
  const params = new URLSearchParams(location.search);
  const merchant = params.get('merchant');
  const j = async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || `伺服器回應 ${r.status}`); return d; };
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(j);
  const api = {
    members: () => fetch('/api/demo-members').then(j),
    quote: (pid, mid) => fetch('/api/quote?' + new URLSearchParams({ merchant: merchant || '', product_id: pid, member: mid })).then(j),
    createOrder: (pid, mid, buyer) => post('/api/orders', { merchant, productId: pid, member: mid, buyer }),
    cancelOrder: (orderId) => post(`/api/orders/${encodeURIComponent(orderId)}/cancel`),
    applyReview: (pid, mid, buyer) => post('/api/review-requests', { merchant, productId: pid, member: mid, buyer }),
    decideReview: (requestId, approve) => post(`/api/review-requests/${encodeURIComponent(requestId)}/${approve ? 'approve' : 'reject'}`),
  };
  MajuUI.init({
    api,
    productId: params.get('product_id'),
    memberId: params.get('member') || 'm_vip3', // 正式環境由登入 session 取得，不經由網址
    onBack: (quote) => { location.href = (quote && quote.merchant.returnUrl) || '/partner/'; },
    onMemberChange: (id) => { params.set('member', id); history.replaceState(null, '', '?' + params.toString()); },
  }).then(() => MajuUI.load());
})();
