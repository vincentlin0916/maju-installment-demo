// MAJU 確認頁的畫面邏輯。原型伺服器版與單檔示範頁共用。
// 這裡只負責顯示：售價、額度、資格與繳款試算都由 api 回傳，前端不自行計價。
// api 介面（皆為 async，失敗時 throw Error）：
//   members() / quote(productId, memberId) / createOrder(productId, memberId, buyer) / cancelOrder(orderId)
//   applyOverLimit(productId, memberId, buyer) / reviewOverLimit(requestId, approve)
(function (root) {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => 'NT$ ' + Number(n).toLocaleString('zh-TW');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tileStyle = (p) => `background: linear-gradient(135deg, hsl(${p.hue} 60% 55%), hsl(${p.hue + 40} 55% 35%))`;
  const VIEWS = ['loadingView', 'errorView', 'checkoutView', 'pendingView', 'doneView'];

  let api = null;
  let opts = {};
  const state = { productId: null, memberId: null, quote: null, order: null, request: null, loadSeq: 0 };

  function show(view) { for (const id of VIEWS) $(id).hidden = id !== view; }
  function fail(msg) { $('errorView').innerHTML = `<b>無法載入頁面</b><br>${esc(msg)}`; show('errorView'); }
  function scheduleRows(r) { return r.schedule.map((s) => `<tr><td>第 ${s.period} 個月</td><td>${s.dueDate}</td><td>${fmt(s.amount)}</td></tr>`).join(''); }
  const limitName = (m) => (m.type === 'diamond' ? '保證金額度' : '等級額度');

  async function renderMemberSelect() {
    const sel = $('memberSel');
    let list;
    try { list = await api.members(); } catch { return; }
    sel.innerHTML = '';
    for (const m of list) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = `${m.name}（${m.card}${m.tag ? '・' + m.tag : ''}）`;
      if (m.id === state.memberId) o.selected = true;
      sel.appendChild(o);
    }
  }

  function renderMember() {
    const q = state.quote, m = q.member, price = q.pricing.majuPrice;
    $('cardChip').classList.toggle('diamond', m.type === 'diamond');
    $('cardLvl').textContent = m.type === 'diamond' ? '保證金會員' : `VIP${m.level}`;
    $('cardName').textContent = m.card + '　' + m.name;
    $('limitLabel').textContent = m.type === 'diamond' ? '保證金額度（已入帳）' : '等級額度';
    $('cLimit').textContent = fmt(m.baseLimit);
    $('cOut').textContent = fmt(m.outstanding);
    $('cRes').textContent = fmt(m.reserved);
    $('cAvail').textContent = fmt(m.available);
    const pct = (v) => Math.min(100, (v / m.baseLimit) * 100) + '%';
    $('barUsed').style.width = pct(m.outstanding);
    $('barRes').style.width = pct(m.reserved);
    $('barThis').style.width = pct(Math.min(price, m.available));

    const e = q.eligibility, b = $('blocked');
    b.hidden = e.ok && !e.warning;
    if (e.ok && e.warning) b.innerHTML = `<b>帳款逾期提醒</b>${esc(e.warning)}`;
    else if (!e.ok && e.code === 'insufficient_credit') {
      b.innerHTML = `<b>可用額度不足</b>MAJU 商城售價 ${fmt(price)}，可用額度 ${fmt(m.available)}，差額 ${fmt(e.shortfall)}。${esc(e.overLimit.message)}`;
    } else if (!e.ok) b.innerHTML = `<b>目前無法進行新交易</b>${esc(e.reason)}`;
  }

  function renderProduct() {
    const q = state.quote, p = q.product;
    $('pTile').style.cssText = tileStyle(p);
    $('pTile').textContent = p.brand;
    $('pBrand').textContent = p.brand;
    $('pName').textContent = p.name;
    $('pSpec').textContent = p.spec;
    $('mName').textContent = q.merchant.name;
    $('fetchedAt').textContent = '取得時間 ' + new Date(q.fetchedAt).toLocaleTimeString('zh-TW');
    $('majuPrice').textContent = fmt(q.pricing.majuPrice);
  }

  function renderPay() {
    const q = state.quote, r = q.repayment, s = q.settings, vip = q.member.type === 'vip';
    $('payTitle').textContent = `每月最低應繳 ${fmt(s.minMonthlyPayment)}，繳到清償為止`;
    $('payDesc').textContent = `每月 ${s.statementDay} 日出帳，${s.paymentDueDay} 日前單筆至少繳 ${fmt(s.minMonthlyPayment)}；帳款不到 ${fmt(s.minMonthlyPayment)} 時，繳清餘額即可。可以多繳或一次繳清，繳多少就恢復多少可用額度。${vip ? '' : '保證金不會自動抵扣帳款。'}`;
    $('pBalance').textContent = fmt(r.balance);
    $('pMin').textContent = fmt(r.minPayment);
    $('pMonths').textContent = `約 ${r.estimatedMonths} 個月繳清`;
    $('pFirst').textContent = r.firstDueDate;
    $('minNotice').textContent = `提醒：逾期達 ${s.overdueLockDays} 天將暫停新消費${vip ? '並調降會員等級' : ''}；逾期達 ${s.overdueLegalDays} 天將停止所有交易並依法追償。`;
  }

  function renderSummary() {
    const q = state.quote, r = q.repayment, e = q.eligibility;
    $('sName').textContent = q.product.name;
    $('sPrice').textContent = fmt(q.pricing.majuPrice);
    $('sMin').textContent = fmt(q.settings.minMonthlyPayment);
    $('sMonths').textContent = `約 ${r.estimatedMonths} 個月繳清`;
    $('sBalance').textContent = fmt(r.balance);
    $('sAfter').textContent = fmt(q.pricing.availableAfter);
    $('sTotal').textContent = fmt(q.pricing.majuPrice);
    $('schedule').innerHTML = scheduleRows(r);
    const btn = $('submitBtn');
    if (e.ok) { btn.disabled = false; btn.dataset.mode = 'order'; btn.textContent = '確認交易'; }
    else if (e.code === 'insufficient_credit' && e.overLimit.canApply) { btn.disabled = false; btn.dataset.mode = 'apply'; btn.textContent = '申請人工審核'; }
    else { btn.disabled = true; btn.dataset.mode = ''; btn.textContent = e.code === 'insufficient_credit' ? '額度不足，無法交易' : '暫停新交易'; }
  }

  async function load(productId, memberId) {
    if (productId) state.productId = productId;
    if (memberId) state.memberId = memberId;
    const seq = ++state.loadSeq;
    show('loadingView');
    $('submitErr').textContent = ''; $('cancelMsg').textContent = ''; $('reqMsg').textContent = '';
    $('memberSel').value = state.memberId;
    if (!state.productId) return fail('缺少合作商城代號或商品編號，請從合作商城的「MAJU 分期付款」按鈕進入。');
    let q;
    try { q = await api.quote(state.productId, state.memberId); }
    catch (e) { if (seq === state.loadSeq) fail(e.message); return; }
    if (seq !== state.loadSeq) return; // 載入途中又切換了會員或商品
    state.quote = q;
    renderMember(); renderProduct(); renderPay(); renderSummary();
    show('checkoutView');
  }

  function readBuyer() {
    const phone = $('phone').value.trim();
    if (!/^09\d{8}$/.test(phone)) { $('phoneErr').textContent = '請輸入 09 開頭的 10 碼手機號碼'; $('phone').focus(); return null; }
    $('phoneErr').textContent = '';
    return { phone, email: $('email').value.trim() };
  }

  async function submit() {
    const btn = $('submitBtn'), mode = btn.dataset.mode;
    if (!mode || btn.disabled) return;
    const buyer = readBuyer();
    if (!buyer) return;
    $('submitErr').textContent = '';
    btn.disabled = true;
    btn.textContent = mode === 'apply' ? '送出申請中…' : '建立訂單中…';
    try {
      if (mode === 'apply') {
        const { request } = await api.applyOverLimit(state.productId, state.memberId, buyer);
        state.request = request;
        renderPending();
        show('pendingView');
      } else {
        const data = await api.createOrder(state.productId, state.memberId, buyer);
        state.order = data.order;
        renderDone();
        show('doneView');
      }
      window.scrollTo(0, 0);
    } catch (e) {
      $('submitErr').textContent = e.message;
    } finally {
      renderSummary(); // 還原按鈕狀態
    }
  }

  function renderPending() {
    const r = state.request;
    $('reqTitle').textContent = '已送出人工審核申請';
    $('reqId').textContent = r.requestId;
    $('reqSummary').textContent = `${r.productName}　MAJU 商城售價 ${fmt(r.majuPrice)}。成立後帳款 ${fmt(r.balanceAfter)}，其中等級額度 ${fmt(r.levelLimit)}、申請臨時額度 ${fmt(r.extra)}。`;
    $('reqNote').textContent = `訂單尚未成立，額度也還沒有保留。審核結果會以簡訊通知 ${r.phone}。核准後，多出的 ${fmt(r.extra)} 是臨時額度，要先償還：每月至少繳 ${fmt(state.quote.settings.minMonthlyPayment)}，約 ${r.payoffMonths} 個月還到等級額度以內。`;
    $('approveBtn').hidden = false; $('rejectBtn').hidden = false;
    $('reqMsg').textContent = '';
  }

  async function review(approve) {
    const r = state.request;
    if (!r) return;
    $('approveBtn').disabled = true; $('rejectBtn').disabled = true;
    try {
      const data = await api.reviewOverLimit(r.requestId, approve);
      if (approve) {
        state.order = data.order;
        renderDone();
        show('doneView');
        window.scrollTo(0, 0);
      } else {
        $('reqTitle').textContent = '人工審核未通過';
        $('reqMsg').textContent = '申請已駁回，訂單沒有成立，額度不受影響。';
        $('approveBtn').hidden = true; $('rejectBtn').hidden = true;
      }
    } catch (e) {
      $('reqMsg').textContent = e.message;
      $('approveBtn').hidden = true; $('rejectBtn').hidden = true;
    } finally {
      $('approveBtn').disabled = false; $('rejectBtn').disabled = false;
    }
  }

  function renderDone() {
    const o = state.order, c = o.creditAfter, r = o.repayment;
    const balance = c.outstanding + c.reserved;
    $('doneTitle').textContent = o.overLimit ? '人工審核已核准，訂單已建立' : '訂單已建立，額度已保留';
    $('doneOrderId').textContent = o.orderId;
    $('doneSummary').textContent = `${o.product.name}　MAJU 商城售價 ${fmt(o.priceSnapshot.majuPrice)}。每月最低應繳 ${fmt(r.minPayment)}，只繳最低應繳約 ${r.estimatedMonths} 個月繳清。`;
    $('doneCredit').textContent = (balance > c.baseLimit
      ? `目前帳款 ${fmt(balance)}，其中 ${fmt(balance - c.baseLimit)} 是臨時額度，不能循環使用。請每月至少繳 ${fmt(r.minPayment)}，約 ${Math.ceil((balance - c.baseLimit) / r.minPayment)} 個月還到${limitName(c)} ${fmt(c.baseLimit)} 以內；在那之前可用額度為 ${fmt(0)}，之後繳多少就恢復多少。`
      : `已保留額度 ${fmt(o.priceSnapshot.majuPrice)}，目前剩餘可用額度 ${fmt(c.available)}。`)
      + `帳單通知會發送至 ${o.buyer.phone}。`;
    $('doneSchedule').innerHTML = scheduleRows(r);
    // 繳款試算：最低應繳 ≤ 金額 ≤ 帳款
    const min = Math.min(r.minPayment, balance);
    $('calcBox').hidden = false;
    $('payAmt').value = String(min);
    $('payRange').textContent = `可輸入 ${fmt(min)} 到 ${fmt(balance)}。不能超過帳款，也就是不能預繳。`;
    $('payOut').textContent = ''; $('payOut').classList.remove('bad');
    $('cancelBtn').hidden = false;
    $('cancelMsg').textContent = '';
  }

  function calcPayment() {
    const o = state.order;
    if (!o) return;
    const c = o.creditAfter, balance = c.outstanding + c.reserved, min = Math.min(o.repayment.minPayment, balance);
    const out = $('payOut');
    const raw = $('payAmt').value.trim().replace(/,/g, '');
    const amt = /^\d+$/.test(raw) ? Number(raw) : NaN;
    out.classList.toggle('bad', !(amt >= min && amt <= balance));
    if (!Number.isInteger(amt)) { out.textContent = '請輸入整數金額。'; return; }
    if (amt < min) { out.textContent = `最低應繳是 ${fmt(min)}。`; return; }
    if (amt > balance) { out.textContent = `不能超過目前帳款 ${fmt(balance)}。`; return; }
    const after = balance - amt, avail = Math.max(0, c.baseLimit - after);
    out.textContent = after === 0
      ? `繳款後帳款 ${fmt(0)}，全部繳清。可用額度恢復為 ${fmt(avail)}。`
      : after > c.baseLimit
        ? `繳款後帳款 ${fmt(after)}，臨時額度還剩 ${fmt(after - c.baseLimit)} 沒還清，可用額度還是 ${fmt(0)}。`
        : balance > c.baseLimit
          ? `繳款後帳款 ${fmt(after)}，臨時額度已還清，恢復為可循環額度。可用額度 ${fmt(avail)}。`
          : `繳款後帳款 ${fmt(after)}，可用額度 ${fmt(avail)}。`;
  }

  async function cancelOrder() {
    const o = state.order;
    if (!o) return;
    try {
      const data = await api.cancelOrder(o.orderId);
      $('cancelMsg').textContent = `訂單 ${o.orderId} 已取消，額度已釋放。目前可用額度 ${fmt(data.creditAfter.available)}。`;
      $('cancelBtn').hidden = true;
      $('calcBox').hidden = true;
    } catch (e) { $('cancelMsg').textContent = e.message; }
  }

  function back() { if (opts.onBack) opts.onBack(state.quote); }

  function init(options) {
    opts = options || {};
    api = opts.api;
    state.productId = opts.productId || null;
    state.memberId = opts.memberId || 'm_vip3';
    $('submitBtn').addEventListener('click', submit);
    $('buyerForm').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    $('backBtn').addEventListener('click', back);
    $('doneBackBtn').addEventListener('click', back);
    $('reqBackBtn').addEventListener('click', back);
    $('cancelBtn').addEventListener('click', cancelOrder);
    $('approveBtn').addEventListener('click', () => review(true));
    $('rejectBtn').addEventListener('click', () => review(false));
    $('payCalcBtn').addEventListener('click', calcPayment);
    $('payAmt').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); calcPayment(); } });
    $('memberSel').addEventListener('change', () => {
      state.memberId = $('memberSel').value;
      if (opts.onMemberChange) opts.onMemberChange(state.memberId);
      load();
    });
    return renderMemberSelect();
  }

  root.MajuUI = { init, load };
})(typeof self !== 'undefined' ? self : this);
