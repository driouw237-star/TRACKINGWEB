/* ================================================================
   GlobalExpress — Admin Payment Detail
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var Admin = global.Admin || null;

  var esc   = Utils.esc   || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var fmtDT = Utils.fmtDT || function (d) { return new Date(d || Date.now()).toLocaleString(); };
  var toast = UI.toast    || function (t, m) { if (global.console) console.log(t, m); };
  var uid   = Utils.uid   || function (p) { return (p || 'id') + '_' + Math.random().toString(36).slice(2, 9); };

  var state = {
    payment: null, customer: null, auditLogs: [], activePanel: 'details'
  };

  var handler = null;
  var container = null;
  var currentId = null;

  function read(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  function getPaymentId(ctx) {
    if (ctx && ctx.params && ctx.params.id) return String(ctx.params.id);
    return localStorage.getItem('ge_admin_current_payment');
  }

  function loadData(id) {
    currentId = id;
    var payments = asArray(read('ge_payments', []));
    state.payment = payments.find(function(p) { return String(p.id) === String(id); });

    if (state.payment) {
      var users = asArray(read('ge_users', []));
      state.customer = users.find(function(u) { return String(u.id) === String(state.payment.userId); });

      var allLogs = asArray(read('ge_audit', []));
      state.auditLogs = allLogs.filter(function(l) {
        return l.target === 'payment:' + state.payment.id || l.target === 'user:' + state.payment.userId;
      }).sort(function(a, b) { return new Date(b.at).getTime() - new Date(a.at).getTime(); });
    }
  }

  function savePayment(patch) {
    if (!state.payment) return false;
    var payments = asArray(read('ge_payments', []));
    var idx = payments.findIndex(function(p) { return p.id === state.payment.id; });
    if (idx === -1) return false;

    payments[idx] = Object.assign({}, payments[idx], patch);
    write('ge_payments', payments);
    state.payment = payments[idx];

    if (Admin && Admin.logAudit) {
      Admin.logAudit('payment.update', 'payment:' + state.payment.id, 'Updated transaction details');
    }
    return true;
  }

  function rerender() {
    if (!container) return;
    container.innerHTML = render({ params: { id: currentId } });
    bind();
  }

  function renderHeader() {
    var p = state.payment;
    return '<div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">' +
      '<div style="display:flex;align-items:center;gap:16px;">' +
        '<button type="button" class="btn btn-outline btn-sm" data-action="go-back"><i class="fas fa-arrow-left"></i> Back</button>' +
        '<div>' +
          '<h2 style="margin:0;font-family:Manrope,sans-serif;font-weight:800;font-size:24px;display:flex;align-items:center;gap:12px;">' +
            'Transaction Details ' +
            '<span class="pill ' + esc(p.status) + '">' + esc(p.status) + '</span>' +
          '</h2>' +
          '<div style="font-size:13px;color:var(--text-3);margin-top:4px;">Reference: <code class="mono">' + esc(p.id) + '</code></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderTabs() {
    return '<div class="users-tabs-bar" style="border-bottom:2px solid var(--adm-border);display:flex;margin-bottom:24px;background:var(--surface);border-radius:12px 12px 0 0;padding:0 12px;">' +
      '<button type="button" class="users-tab ' + (state.activePanel === 'details' ? 'active' : '') + '" data-panel="details" style="padding:16px 20px;border:none;background:none;cursor:pointer;font-weight:600;font-size:13.5px;color:' + (state.activePanel === 'details' ? 'var(--brand)' : 'var(--text-3)') + ';border-bottom:2.5px solid ' + (state.activePanel === 'details' ? 'var(--accent)' : 'transparent') + ';margin-bottom:-2px;"><i class="fas fa-file-invoice"></i> Details & Edit</button>' +
      '<button type="button" class="users-tab ' + (state.activePanel === 'timeline' ? 'active' : '') + '" data-panel="timeline" style="padding:16px 20px;border:none;background:none;cursor:pointer;font-weight:600;font-size:13.5px;color:' + (state.activePanel === 'timeline' ? 'var(--brand)' : 'var(--text-3)') + ';border-bottom:2.5px solid ' + (state.activePanel === 'timeline' ? 'var(--accent)' : 'transparent') + ';margin-bottom:-2px;"><i class="fas fa-clock-rotate-left"></i> Audit Timeline</button>' +
    '</div>';
  }

  function renderDetailsPanel() {
    var p = state.payment;
    var u = state.customer || { name: 'Unknown User', email: '—', id: p.userId, wallet: 0 };

    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">' +
      '<div class="panel" style="border-top:4px solid var(--brand);">' +
        '<div class="panel-header"><h3><i class="fas fa-receipt"></i> Receipt Overview</h3></div>' +
        '<div class="panel-body">' +
          '<div style="text-align:center;margin-bottom:24px;padding:24px;background:var(--surface-2);border-radius:12px;border:1px solid var(--adm-border);">' +
            '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:1px;">Total Amount</div>' +
            '<div style="font-family:Manrope,sans-serif;font-size:42px;font-weight:800;color:' + (p.amount >= 0 ? 'var(--green)' : 'var(--red)') + ';margin:8px 0;">' + money(p.amount) + '</div>' +
            '<span class="pill ' + esc(p.status) + '" style="font-size:12px;padding:4px 12px;">' + esc(p.status) + '</span>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:12px;margin-bottom:24px;">' +
            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed var(--border);">' +
              '<span style="color:var(--text-3);font-size:13px;">Date & Time</span>' +
              '<span style="font-weight:600;font-size:13px;color:var(--text);">' + esc(fmtDT(p.at)) + '</span>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed var(--border);">' +
              '<span style="color:var(--text-3);font-size:13px;">Method</span>' +
              '<span style="font-weight:600;font-size:13px;color:var(--text);">' + esc(p.method) + '</span>' +
            '</div>' +
          '</div>' +
          '<div style="background:var(--surface-2);border-radius:10px;padding:16px;border:1px solid var(--border);">' +
            '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:12px;"><i class="fas fa-user"></i> Customer</div>' +
            '<div style="font-weight:700;font-size:14px;color:var(--text);">' + esc(u.name) + '</div>' +
            '<div style="font-size:12.5px;color:var(--text-2);margin-bottom:12px;">' + esc(u.email) + '</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--green);margin-bottom:12px;">Balance: ' + money(u.wallet || 0) + '</div>' +
            '<div style="display:flex;gap:8px;">' +
              '<button type="button" class="btn btn-outline btn-sm btn-block" data-action="view-user" data-id="' + esc(u.id) + '">Profile</button>' +
              '<button type="button" class="btn btn-primary btn-sm btn-block" data-action="adjust-wallet" data-id="' + esc(u.id) + '">Adjust Balance</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="panel">' +
        '<div class="panel-header"><h3><i class="fas fa-pen-to-square"></i> Edit Transaction</h3></div>' +
        '<div class="panel-body">' +
          '<div class="field" style="margin-bottom:20px;">' +
            '<label style="font-weight:700;">Transaction Amount</label>' +
            '<div style="position:relative;">' +
              '<span style="position:absolute;left:16px;top:14px;font-weight:700;color:var(--text-3);">Fr.</span>' +
              '<input type="number" id="ed_amount" value="' + esc(p.amount) + '" style="padding-left:45px;font-size:20px;font-weight:700;color:var(--brand);width:100%;height:50px;" />' +
            '</div>' +
          '</div>' +
          '<div class="grid-2" style="gap:16px;margin-bottom:20px;">' +
            '<div class="field">' +
              '<label>Status</label>' +
              '<select id="ed_status" style="height:44px;">' +
                ['Paid', 'Pending', 'Failed', 'Refunded'].map(function(s) {
                  return '<option value="' + s + '"' + (p.status === s ? ' selected' : '') + '>' + s + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="field">' +
              '<label>Method</label>' +
              '<select id="ed_method" style="height:44px;">' +
                ['Wallet', 'MTN MoMo', 'Orange Money', 'Card', 'Crypto'].map(function(s) {
                  return '<option value="' + s + '"' + (p.method === s ? ' selected' : '') + '>' + s + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-primary btn-block btn-lg" data-action="save" style="margin-top:24px;">' +
            '<i class="fas fa-save"></i> Save Transaction' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderTimelinePanel() {
    if (!state.auditLogs.length) {
      return '<div class="panel"><div class="panel-body" style="text-align:center;padding:40px;">' +
        '<h3 style="margin-bottom:8px;">No Audit History</h3>' +
        '<p style="color:var(--text-2);">No changes have been recorded yet.</p>' +
      '</div></div>';
    }
    return '<div class="panel"><div class="panel-header"><h3><i class="fas fa-list"></i> Action Timeline</h3></div><div class="panel-body">' +
      '<div style="position:relative;padding-left:24px;border-left:2px solid var(--adm-border);margin-left:12px;">' +
        state.auditLogs.map(function(log) {
          return '<div style="margin-bottom:24px;position:relative;">' +
            '<div style="position:absolute;left:-33px;top:0;width:16px;height:16px;border-radius:50%;background:var(--brand);border:3px solid #fff;"></div>' +
            '<div style="font-size:12px;color:var(--text-3);font-weight:600;margin-bottom:4px;">' + esc(fmtDT(log.at)) + ' &middot; ' + esc(log.userName) + '</div>' +
            '<div style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:4px;">' + esc(log.action) + '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div></div>';
  }

  function render(ctx) {
    var id = getPaymentId(ctx);
    loadData(id);

    if (!state.payment) {
      return '<div class="panel" style="padding:40px;text-align:center;">' +
        '<h2 style="margin-bottom:8px;">Transaction Not Found</h2>' +
        '<button type="button" class="btn btn-primary" data-action="go-back" style="margin-top:20px;">Back to Payments</button>' +
      '</div>';
    }

    var content = state.activePanel === 'timeline' ? renderTimelinePanel() : renderDetailsPanel();

    return '<div class="payment-detail-page" style="max-width:1100px;margin:0 auto;">' +
      renderHeader() + renderTabs() + '<div>' + content + '</div>' +
    '</div>';
  }

  function handleAdjustWallet(userId) {
    var users = asArray(read('ge_users', []));
    var u = users.find(function(x){ return x.id === userId; });
    if (!u) return toast('User not found', '', 'error');
    
    var bal = Number(u.wallet) || 0;
    var modal = UI.openModal(
      '<div class="modal narrow">' +
        '<div class="modal-head"><h3><i class="fas fa-wallet"></i> Adjust Balance</h3><button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button></div>' +
        '<div class="modal-body">' +
          '<div class="field" style="margin-bottom:14px;"><label>Operation</label><select id="wOp"><option value="credit">Credit (Add)</option><option value="debit">Debit (Deduct)</option></select></div>' +
          '<div class="field" style="margin-bottom:14px;"><label>Amount</label><input type="number" id="wAmt" placeholder="e.g. 5000" min="1" /><div class="hint" id="wHint">New balance: ' + esc(money(bal)) + '</div></div>' +
          '<div class="field"><label>Reason</label><input type="text" id="wReason" placeholder="Reason for audit" /></div>' +
        '</div>' +
        '<div class="modal-foot"><button type="button" class="btn btn-outline" data-close>Cancel</button><button type="button" class="btn btn-primary" id="wSave">Apply</button></div>' +
      '</div>'
    );
    if (!modal) return;

    var amtEl = modal.querySelector('#wAmt');
    var opEl = modal.querySelector('#wOp');
    var hintEl = modal.querySelector('#wHint');

    amtEl.addEventListener('input', function () {
      var raw = parseInt(amtEl.value, 10) || 0;
      var delta = opEl.value === 'debit' ? -raw : raw;
      hintEl.textContent = 'New balance: ' + money(Math.max(0, bal + delta));
    });

    modal.querySelector('#wSave').onclick = function () {
      var amt = parseInt(amtEl.value, 10) || 0;
      var op = opEl.value;
      var reason = modal.querySelector('#wReason').value.trim();
      if (!amt || !reason) return toast('Error', 'Amount and reason required', 'error');

      var delta = op === 'debit' ? -amt : amt;
      var newBal = bal + delta;
      if (newBal < 0) return toast('Error', 'Balance cannot go negative', 'error');

      u.wallet = newBal;
      write('ge_users', users);
      
      var txns = asArray(read('ge_wallet_txns', []));
      txns.push({ id: uid('txn'), userId: u.id, type: delta >= 0 ? 'Deposit' : 'Withdraw', amount: delta, balanceAfter: newBal, description: reason, at: new Date().toISOString() });
      write('ge_wallet_txns', txns);

      if (Admin && Admin.logAudit) Admin.logAudit('wallet.adjust', 'user:' + u.email, (delta >= 0 ? '+' : '') + delta + ' — ' + reason);
      UI.closeModal(modal);
      toast('Balance adjusted', '', 'success');
      rerender();
    };
  }

  function bind() {
    container = document.getElementById('content');
    if (!container) return;
    if (handler) container.removeEventListener('click', handler);

    handler = function (e) {
      var panelBtn = e.target.closest('[data-panel]');
      if (panelBtn) { state.activePanel = panelBtn.dataset.panel; rerender(); return; }

      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      
      var action = btn.dataset.action;

      if (action === 'go-back') { if (global.Admin) global.Admin.go('payments'); return; }
      if (action === 'view-user') { localStorage.setItem('ge_admin_current_user', btn.dataset.id); if (global.Admin) global.Admin.go('user-detail'); return; }
      if (action === 'adjust-wallet') { handleAdjustWallet(btn.dataset.id); return; }

      if (action === 'save') {
        var amtEl = document.getElementById('ed_amount');
        var statusEl = document.getElementById('ed_status');
        var methodEl = document.getElementById('ed_method');

        if (!amtEl || !statusEl || !methodEl) return;
        var newAmt = Number(amtEl.value);
        if (isNaN(newAmt)) return toast('Error', 'Invalid amount', 'error');

        var success = savePayment({ amount: newAmt, status: statusEl.value, method: methodEl.value });
        if (success) { toast('Success', 'Transaction updated.', 'success'); rerender(); }
        return;
      }
    };
    container.addEventListener('click', handler);
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null; handler = null; currentId = null;
    state.payment = null; state.customer = null; state.auditLogs = []; state.activePanel = 'details';
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin['payment-detail'] = { title: 'Payment Detail', subtitle: 'Manage transaction', render: render, bind: bind, cleanup: cleanup };

})(window);