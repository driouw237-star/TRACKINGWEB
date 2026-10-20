/* ================================================================
   GlobalExpress — Admin User Detail: CORE CONTROLLER (Pro)
   ================================================================
   Fixes: A2, A3, A4, A7, A16, TAB state retention.
   Features: Elegant header, metric cards, sticky tabs, safe actions.
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var Admin = global.Admin || null;

  var esc   = Utils.esc   || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var toast = UI.toast    || function (t, m) { if (global.console) console.log(t, m); };
  var uid   = Utils.uid   || function (p) { return (p || 'id') + '_' + Math.random().toString(36).slice(2, 9); };

  var KEYS = {
    users: 'ge_users', shipments: 'ge_shipments', payments: 'ge_payments',
    walletTxns: 'ge_wallet_txns', notifications: 'ge_notifications',
    tickets: 'ge_tickets', notes: 'ge_admin_notes', addresses: 'ge_user_addresses', audit: 'ge_audit'
  };

  function read(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  function audit(action, target, details) {
    if (Admin && typeof Admin.logAudit === 'function') {
      try { Admin.logAudit(action, target, details); } catch (e) {}
    }
  }

  var state = {
    activeUserId: null,
    user: null,
    activeTab: 'overview',
    shipments: [],
    payments: [],
    walletTxns: [],
    addresses: [],
    tickets: [],
    notifications: [],
    notes: []
  };

  var handler = null;
  var container = null;

  function getUserId(ctx) {
    if (ctx && ctx.params && ctx.params.id) return String(ctx.params.id);
    var stored = localStorage.getItem('ge_admin_current_user');
    if (stored) return stored;

    var hash = window.location.hash || '';
    var q = hash.match(/[?&]id=([^&]+)/);
    if (q) return decodeURIComponent(q[1]);

    var path = hash.match(/\/([A-Za-z0-9_\-]+)\/?$/);
    if (path && path[1] !== 'user-detail' && path[1] !== 'users') return decodeURIComponent(path[1]);
    return null;
  }

  function parseTime(s) {
    if (!s) return 0;
    var t = Date.parse(s);
    if (!isNaN(t)) return t;
    t = Date.parse(String(s).replace('·', '').trim());
    return isNaN(t) ? 0 : t;
  }

  function loadUserData(userId) {
    state.user = asArray(read(KEYS.users, [])).find(function (u) { return u.id === userId; });
    if (!state.user) return;

    var id = state.user.id;
    state.shipments     = asArray(read(KEYS.shipments,     [])).filter(function (s) { return s.createdBy === id; });
    state.payments      = asArray(read(KEYS.payments,      [])).filter(function (p) { return p.userId    === id; });
    state.walletTxns    = asArray(read(KEYS.walletTxns,    [])).filter(function (t) { return t.userId    === id; });
    state.addresses     = asArray(read(KEYS.addresses,     [])).filter(function (a) { return a.userId    === id; });
    state.tickets       = asArray(read(KEYS.tickets,       [])).filter(function (t) { return t.userId    === id; });
    state.notifications = asArray(read(KEYS.notifications, [])).filter(function (n) { return n.userId    === id; });
    state.notes         = asArray(read(KEYS.notes,         [])).filter(function (n) { return n.userId    === id; })
      .sort(function (a, b) { return parseTime(b.at) - parseTime(a.at); });
  }

  function saveUser(patch) {
    var users = asArray(read(KEYS.users, []));
    var idx = users.findIndex(function (u) { return u.id === state.user.id; });
    if (idx === -1) return false;
    users[idx] = Object.assign({}, users[idx], patch);
    write(KEYS.users, users);
    state.user = users[idx];
    audit('user.update', 'user:' + state.user.email, 'Updated via detail');
    return true;
  }

  function rerender() {
    if (!container) return;
    container.innerHTML = render({ params: { id: state.activeUserId } });
    bind();
  }

  // --- HEADER ---
  function renderHeader() {
    var u = state.user;
    if (!u) return '';
    var isSuspended = !!(u.flags && u.flags.suspended);

    return '<div class="page-header" style="display:flex;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:16px;background:var(--surface);padding:24px;border-radius:16px;border:1px solid var(--border)">'
      + '<div style="display:flex;gap:20px;align-items:center">'
      +   '<div style="width:72px;height:72px;font-size:26px;background:linear-gradient(135deg,#0b2545,#13315c);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;box-shadow:0 4px 12px rgba(11,37,69,.2)">'
      +     esc((u.name || 'U').charAt(0).toUpperCase())
      +   '</div>'
      +   '<div>'
      +     '<h2 style="margin:0 0 4px;display:flex;align-items:center;gap:10px;font-family:\'Manrope\',sans-serif;font-size:22px;font-weight:800">'
      +       esc(u.name)
      +       ' <span class="pill ' + (isSuspended ? 'Cancelled' : 'Delivered') + '">' + (isSuspended ? 'Suspended' : 'Active') + '</span>'
      +     '</h2>'
      +     '<p style="margin:0;color:var(--text-2);font-size:14px">' + esc(u.email) + '</p>'
      +   '</div>'
      + '</div>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
      +   '<button type="button" class="btn btn-outline btn-sm" data-action="adjust-wallet"><i class="fas fa-wallet"></i> Adjust Wallet</button>'
      +   '<button type="button" class="btn btn-outline btn-sm" data-action="reset-pass"><i class="fas fa-key"></i> Reset Pass</button>'
      +   (isSuspended
            ? '<button type="button" class="btn btn-outline btn-sm" data-action="suspend" data-val="false" style="color:var(--green);border-color:var(--green)"><i class="fas fa-check"></i> Unsuspend</button>'
            : '<button type="button" class="btn btn-danger btn-sm" data-action="suspend" data-val="true"><i class="fas fa-ban"></i> Suspend</button>')
      + '</div>'
      + '</div>';
  }

  // --- TABS ---
  var TABS = [
    { key: 'overview',      label: 'Overview',      icon: 'fa-user' },
    { key: 'shipments',     label: 'Shipments',     icon: 'fa-box' },
    { key: 'payments',      label: 'Payments',      icon: 'fa-credit-card' },
    { key: 'wallet',        label: 'Wallet',        icon: 'fa-wallet' },
    { key: 'addresses',     label: 'Addresses',     icon: 'fa-location-dot' },
    { key: 'activity',      label: 'Activity',      icon: 'fa-clock' },
    { key: 'security',      label: 'Security',      icon: 'fa-shield' },
    { key: 'notes',         label: 'Admin Notes',   icon: 'fa-clipboard' }
  ];

  function renderTabs() {
    return '<div class="users-tabs-bar" style="border-bottom:2px solid var(--adm-border);display:flex;overflow-x:auto;margin-bottom:24px;background:var(--surface);border-radius:12px 12px 0 0;padding:0 12px">'
      + TABS.map(function (t) {
          var active = state.activeTab === t.key ? ' active' : '';
          return '<button type="button" class="users-tab' + active + '" data-user-tab="' + t.key + '" '
            + 'style="padding:16px 20px;border:none;background:none;cursor:pointer;white-space:nowrap;font-family:inherit;'
            + 'font-weight:600;font-size:13.5px;color:' + (state.activeTab === t.key ? 'var(--brand)' : 'var(--text-3)') + ';'
            + 'border-bottom:2.5px solid ' + (state.activeTab === t.key ? 'var(--accent)' : 'transparent') + ';'
            + 'margin-bottom:-2px;transition:color .15s">'
            + '<i class="fas ' + t.icon + '" style="margin-right:8px;opacity:.7"></i>' + esc(t.label)
            + '</button>';
        }).join('') + '</div>';
  }

  function renderContent() {
    var M = global.UserDetailModules || {};
    var map = {
      overview:      M.renderTabOverview,
      shipments:     M.renderTabShipments,
      payments:      M.renderTabPayments,
      wallet:        M.renderTabWallet,
      addresses:     M.renderTabAddresses,
      tickets:       M.renderTabTickets,
      notifications: M.renderTabNotifications,
      activity:      M.renderTabActivity,
      security:      M.renderTabSecurity,
      notes:         M.renderTabNotes
    };
    var fn = map[state.activeTab];
    if (typeof fn === 'function') {
      try { return fn(state); }
      catch (e) {
        if (global.console) console.error('[user-detail] module render failed:', state.activeTab, e);
        return '<div class="panel" style="padding:24px;text-align:center;color:var(--red)"><strong>Error rendering "' + esc(state.activeTab) + '"</strong><div style="font-size:12px;color:var(--text-3);margin-top:8px">' + esc(String(e && e.message || e)) + '</div></div>';
      }
    }
    return '<div style="padding:40px;text-align:center;color:#94a3b8">Module "' + esc(state.activeTab) + '" is not loaded.</div>';
  }

  // --- MAIN RENDER ---
  function render(ctx) {
    var userId = getUserId(ctx);
    if (userId) state.activeUserId = userId;
    else userId = state.activeUserId;

    loadUserData(userId);

    if (!state.user) {
      return '<div class="panel" style="padding:40px;text-align:center">'
        + '<h3 style="margin-bottom:8px">User not found</h3>'
        + '<p style="color:var(--text-3);font-size:13px;margin-bottom:16px">ID <code>' + esc(userId || '—') + '</code> could not be located.</p>'
        + '<button type="button" class="btn btn-primary" onclick="window.location.hash=\'#users\'">Back to Users</button>'
        + '</div>';
    }

    return '<div class="user-detail-page" style="max-width:1200px;margin:0 auto">'
      + renderHeader()
      + renderTabs()
      + '<div style="min-height:400px">' + renderContent() + '</div>'
      + '</div>';
  }

  // --- ACTIONS ---
  function handleSuspend(val) {
    var flags = Object.assign({}, state.user.flags || {}, { suspended: val });
    if (!saveUser({ flags: flags })) return;
    toast('User ' + (val ? 'suspended' : 'unsuspended'), state.user.name, val ? 'warning' : 'success');
    rerender();
  }

  function handleAdjustWallet() {
    if (typeof UI.openModal !== 'function') return toast('Modal unavailable', '', 'error');
    var bal = Number(state.user.wallet) || 0;

    var modal = UI.openModal(
      '<div class="modal narrow">'
      + '<div class="modal-head"><h3><i class="fas fa-wallet"></i> Adjust Wallet</h3><button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button></div>'
      + '<div class="modal-body">'
      +   '<div class="field" style="margin-bottom:14px"><label>Operation</label><select id="wOp"><option value="credit">Credit (add funds)</option><option value="debit">Deduct funds</option></select></div>'
      +   '<div class="field" style="margin-bottom:14px"><label>Amount</label><input type="number" id="wAmt" placeholder="e.g. 5000" min="1" /><div class="hint" id="wHint">New balance will be ' + esc(money(bal)) + '</div></div>'
      +   '<div class="field"><label>Reason (required for audit)</label><input type="text" id="wReason" placeholder="e.g. Goodwill credit" /></div>'
      + '</div>'
      + '<div class="modal-foot"><button type="button" class="btn btn-outline" data-close>Cancel</button><button type="button" class="btn btn-primary" id="wSave">Apply Adjustment</button></div>'
      + '</div>'
    );
    if (!modal) return;

    var amtEl  = modal.querySelector('#wAmt');
    var opEl   = modal.querySelector('#wOp');
    var hintEl = modal.querySelector('#wHint');

    if (amtEl && opEl && hintEl) {
      amtEl.addEventListener('input', function () {
        var raw = parseInt(amtEl.value, 10) || 0;
        var delta = opEl.value === 'debit' ? -raw : raw;
        hintEl.textContent = 'New balance will be ' + money(Math.max(0, bal + delta));
      });
    }

    modal.querySelector('#wSave').onclick = function () {
      var amt = parseInt(amtEl.value, 10) || 0;
      var op = opEl.value;
      var reason = modal.querySelector('#wReason').value.trim();
      if (!amt || !reason) return toast('Error', 'Amount and reason are required', 'error');

      var delta = op === 'debit' ? -amt : amt;
      var newBal = bal + delta;
      if (newBal < 0) return toast('Error', 'Balance cannot go negative', 'error');

      saveUser({ wallet: newBal });
      var txns = asArray(read(KEYS.walletTxns, []));
      txns.push({
        id: uid('txn'), userId: state.user.id, type: delta >= 0 ? 'Deposit' : 'Withdraw',
        amount: delta, balanceAfter: newBal, description: reason, at: new Date().toISOString()
      });
      write(KEYS.walletTxns, txns);

      audit('wallet.adjust', 'user:' + state.user.email, (delta >= 0 ? '+' : '') + delta + ' — ' + reason);
      UI.closeModal(modal);
      toast('Wallet adjusted', state.user.name, 'success');
      rerender();
    };
  }

  function handleResetPassword() {
    var tempPass = 'GX-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    saveUser({ password: tempPass, mustChangePassword: true });

    if (typeof UI.openModal !== 'function') {
      if (global.console) console.log('[GlobalExpress] Temp password for ' + state.user.email + ':', tempPass);
      return toast('Password reset', 'Check browser console for temp password.', 'success');
    }

    var modal = UI.openModal(
      '<div class="modal narrow">'
      + '<div class="modal-head"><h3><i class="fas fa-key"></i> Password Reset</h3><button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button></div>'
      + '<div class="modal-body" style="text-align:center;padding:26px 22px">'
      +   '<h4 style="margin:0 0 6px;font-size:16px">Temporary password generated</h4>'
      +   '<p style="margin:0 0 18px;font-size:13px;color:var(--text-2)">Deliver to the user via a secure channel.</p>'
      +   '<div style="padding:14px 16px;background:#f8fafc;border:1.5px dashed #cbd5e1;border-radius:10px;font-family:ui-monospace,monospace;font-size:18px;font-weight:700;letter-spacing:2px;color:#0b2545;user-select:all">' + esc(tempPass) + '</div>'
      + '</div>'
      + '<div class="modal-foot"><button type="button" class="btn btn-primary" data-close>Done</button></div>'
      + '</div>'
    );
    if (modal && typeof UI.closeModal === 'function') {
      modal.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) UI.closeModal(modal); });
    }
    if (navigator.clipboard) navigator.clipboard.writeText(tempPass).catch(function () {});
    rerender();
  }

  function bind() {
    container = document.getElementById('content');
    if (!container) return;
    if (handler) container.removeEventListener('click', handler);

    handler = function (e) {
      var tab = e.target.closest('[data-user-tab]');
      if (tab) { state.activeTab = tab.dataset.userTab; rerender(); return; }

      var btn = e.target.closest('[data-action]');
      if (!btn) return;

      var action = btn.dataset.action;
      if (action === 'suspend')       return handleSuspend(btn.dataset.val === 'true');
      if (action === 'adjust-wallet') return handleAdjustWallet();
      if (action === 'reset-pass')    return handleResetPassword();
    };

    container.addEventListener('click', handler);
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null; handler = null; state.user = null; state.activeTab = 'overview'; state.activeUserId = null;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin['user-detail'] = {
    title: 'User Detail', subtitle: 'Manage user account', render: render, bind: bind, cleanup: cleanup
  };

})(window);