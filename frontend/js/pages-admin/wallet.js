/* ================================================================
   GlobalExpress — Admin Page: Wallet Ledger (Professional)
   ================================================================
   Global wallet transaction list with KPI cards, DataTable,
   running balances, and deep filtering.
   ================================================================ */

(function (global) {
  'use strict';

  var Utils     = global.Utils     || {};
  var UI        = global.UI        || {};
  var Admin     = global.Admin     || null;
  var DataTable = global.DataTable || {};

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n||0).toLocaleString(); };
  var comma = Utils.comma || function (n) { return Number(n||0).toLocaleString('en-US'); };
  var fmtDate = Utils.fmtDate || function (d) { return new Date(d || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  var fmtRelative = Utils.fmtRelative || function (d) {
    var ts = Date.parse(d); if (isNaN(ts)) return '—';
    var diff = Date.now() - ts, sec = Math.floor(diff/1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec/60); if (min < 60) return min + 'm ago';
    var hr = Math.floor(min/60); if (hr < 24) return hr + 'h ago';
    return Math.floor(hr/24) + 'd ago';
  };
  var toast = UI.toast || function (t,m) { if (global.console) console.log(t, m); };
  var uid   = Utils.uid   || function (p) { return (p || 'id') + '_' + Math.random().toString(36).slice(2, 9); };

  var KEYS = { walletTxns:'ge_wallet_txns', users:'ge_users', payments: 'ge_payments' };

  var state = {
    activeTab: 'all',
    dt: null,
    txns: [],
    usersMap: {},
    totals: { credit: 0, debit: 0, liability: 0 }
  };

  var pageHandler = null;
  var pageContainer = null;

  function read(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  function parseWhen(s) {
    if (!s) return 0;
    var t = Date.parse(s);
    if (!isNaN(t)) return t;
    t = Date.parse(String(s).replace('·', '').trim());
    return isNaN(t) ? 0 : t;
  }

  function loadData() {
    state.txns = asArray(read(KEYS.walletTxns, []));
    var users = asArray(read(KEYS.users, []));
    
    var map = {};
    var liability = 0;
    users.forEach(function (u) { 
      map[u.id] = u; 
      if (u.role !== 'admin') liability += Number(u.wallet || 0);
    });
    state.usersMap = map;

    var credit = 0;
    var debit = 0;
    state.txns.forEach(function (t) {
      var amt = Number(t.amount || 0);
      if (amt > 0) credit += amt;
      else if (amt < 0) debit += Math.abs(amt);
    });
    
    state.totals = { credit: credit, debit: debit, liability: liability };

    // AUTO-FIX: Reconstruct running balances if missing
    var hasMissing = state.txns.some(function (t) { return typeof t.balanceAfter !== 'number'; });
    if (hasMissing) {
      // Group by user and sort by time
      var byUser = {};
      state.txns.forEach(function(t) {
        if (!byUser[t.userId]) byUser[t.userId] = [];
        byUser[t.userId].push(t);
      });

      Object.keys(byUser).forEach(function(userId) {
        var uTxns = byUser[userId].sort(function(a, b) { return parseWhen(a.at) - parseWhen(b.at); });
        var u = map[userId];
        var currentBal = u ? Number(u.wallet) || 0 : 0;
        
        // Work backwards to find starting balance
        var totalDelta = uTxns.reduce(function(s, t) { return s + (Number(t.amount) || 0); }, 0);
        var running = currentBal - totalDelta;

        uTxns.forEach(function(t) {
          running += Number(t.amount) || 0;
          if (typeof t.balanceAfter !== 'number') t.balanceAfter = running;
        });
      });
    }
  }

  function applyTabFilter(rows) {
    var tab = state.activeTab;
    if (tab === 'all') return rows;
    if (tab === 'deposits') return rows.filter(function(t) { return t.type === 'Deposit'; });
    if (tab === 'withdrawals') return rows.filter(function(t) { return t.type === 'Withdrawal'; });
    if (tab === 'charges') return rows.filter(function(t) { return t.type === 'Charge' || t.type === 'Shipment'; });
    if (tab === 'adjustments') return rows.filter(function(t) { return t.type === 'Adjustment'; });
    return rows;
  }

  function countForTab(tab) {
    var saved = state.activeTab;
    state.activeTab = tab;
    var n = applyTabFilter(state.txns).length;
    state.activeTab = saved;
    return n;
  }

  var TABS = [
    { key:'all', label:'All Transactions' },
    { key:'deposits', label:'Deposits' },
    { key:'withdrawals', label:'Withdrawals' },
    { key:'charges', label:'Charges' },
    { key:'adjustments', label:'Adjustments' }
  ];

  function renderTabsBar() {
    return '<div class="users-tabs-bar">' +
      TABS.map(function (t) {
        var n = countForTab(t.key);
        var active = state.activeTab === t.key;
        return '<button type="button" class="users-tab' + (active ? ' active' : '') + '" ' +
          'data-wallet-tab="' + esc(t.key) + '">' + esc(t.label) +
          '<span class="count">' + comma(n) + '</span></button>';
      }).join('') + '</div>';
  }

  function renderHeader() {
    return '<div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">' +
      '<div><h2>Wallet Ledger</h2><p class="page-subtitle">Platform-wide wallet movements and liability.</p></div>' +
      '<div class="page-actions" style="display:flex;gap:10px;">' +
        '<button type="button" class="btn btn-outline btn-sm" data-wallet-export>' +
          '<i class="fas fa-download"></i> Export</button>' +
        '<button type="button" class="btn btn-primary btn-sm" data-action="adjust-wallet">' +
          '<i class="fas fa-sliders"></i> Adjust Balance</button>' +
      '</div></div>';
  }

  function renderKpis() {
    return '<div class="admin-kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">' +
      '<div class="admin-kpi">' +
        '<div class="kpi-head"><div class="kpi-label">Total Liability</div><div class="kpi-icon red"><i class="fas fa-wallet"></i></div></div>' +
        '<div class="kpi-value">' + money(state.totals.liability) + '</div>' +
        '<div class="kpi-trend flat">Owed to customers</div>' +
      '</div>' +
      '<div class="admin-kpi">' +
        '<div class="kpi-head"><div class="kpi-label">Total Credited</div><div class="kpi-icon green"><i class="fas fa-arrow-down"></i></div></div>' +
        '<div class="kpi-value">' + money(state.totals.credit) + '</div>' +
        '<div class="kpi-trend flat">Lifetime deposits</div>' +
      '</div>' +
      '<div class="admin-kpi">' +
        '<div class="kpi-head"><div class="kpi-label">Total Debited</div><div class="kpi-icon orange"><i class="fas fa-arrow-up"></i></div></div>' +
        '<div class="kpi-value">' + money(state.totals.debit) + '</div>' +
        '<div class="kpi-trend flat">Charges & withdrawals</div>' +
      '</div>' +
    '</div>';
  }

  function buildColumns() {
    return [
      { key:'at', label:'Date', sortable:true,
        sortValue:function (t) { return parseWhen(t.at); },
        render:function (t) { return '<span class="text-dim" title="' + esc(fmtDate(t.at)) + '">' + esc(fmtRelative(t.at)) + '</span>'; } },
      { key:'user', label:'User', sortable:true,
        sortValue:function (t) { 
          var u = state.usersMap[t.userId]; 
          return u ? u.name : ''; 
        },
        render:function (t) {
          var u = state.usersMap[t.userId];
          if (!u) return '<span class="text-muted">Unknown</span>';
          return '<div class="cell-user">' +
            '<div class="meta"><div class="name">' + esc(u.name) + '</div><div class="email">' + esc(u.email) + '</div></div>' +
          '</div>';
        } },
      { key:'type', label:'Type', sortable:true,
        render:function (t) { return '<span class="pill ' + esc(t.type||'Adjustment') + '">' + esc(t.type||'Adjustment') + '</span>'; } },
      { key:'amount', label:'Amount', sortable:true, align:'right',
        sortValue:function (t) { return Number(t.amount || 0); },
        render:function (t) {
          var amt = Number(t.amount || 0);
          var isPos = amt >= 0;
          return '<span class="tbl-amount ' + (isPos?'positive':'negative') + '">' + (isPos?'+':'') + money(amt) + '</span>';
        } },
      { key:'balanceAfter', label:'Balance After', sortable:true, align:'right', hideSm:true,
        sortValue:function (t) { return Number(t.balanceAfter || 0); },
        render:function (t) {
          return '<span class="text-dim">' + money(t.balanceAfter || 0) + '</span>';
        } },
      { key:'description', label:'Description', sortable:false, hideSm:true,
        render:function (t) { return esc(t.description || '—'); } }
    ];
  }

  function buildActionsCol() {
    return {
      label:'',
      render:function (t) {
        return '<button type="button" class="btn btn-ghost btn-sm" ' +
            'data-wallet-action="view-txn" data-id="' + esc(t.id) + '" title="View Details">' +
            '<i class="fas fa-eye"></i></button>';
      }
    };
  }

  function exportTxns(rows) {
    var list = rows || state.txns;
    try {
      var blob = new Blob([JSON.stringify(list, null, 2)], { type:'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'wallet-txns-' + new Date().toISOString().slice(0,10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Exported', list.length + ' transactions', 'success');
    } catch (e) { toast('Export failed', String(e.message||e), 'error'); }
  }

  function render(ctx) {
    loadData();
    return '<div class="wallet-page" style="max-width:1200px;margin:0 auto;">' +
      renderHeader() + renderKpis() + renderTabsBar() +
      '<div id="wallet-table-mount"></div></div>';
  }

  function bind(ctx) {
    var mount = document.getElementById('wallet-table-mount');
    if (!mount) return;

    if (state.dt && state.dt.destroy) { try { state.dt.destroy(); } catch (e) {} }
    state.dt = DataTable.create(mount, {
      key: 'admin-wallet-' + state.activeTab,
      data: applyTabFilter(state.txns),
      rowId: function (t) { return t.id; },
      columns: buildColumns(),
      actionsCol: buildActionsCol(),
      searchKeys: ['description', 'reference', 'type'],
      pageSize: 20,
      emptyState: { icon:'fa-wallet', title:'No transactions yet', message:'Wallet movements will appear here.' },
      onRowClick: function (txn) { openTxnModal(txn); }
    });

    pageContainer = document.getElementById('content');
    if (!pageContainer) return;
    if (pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageHandler = onPageClick;
    pageContainer.addEventListener('click', pageHandler);
  }

  function onPageClick(e) {
    var tab = e.target.closest('[data-wallet-tab]');
    if (tab) { state.activeTab = tab.dataset.walletTab; refresh(); return; }

    if (e.target.closest('[data-wallet-export]')) {
      exportTxns(state.dt ? state.dt.data : state.txns);
      return;
    }

    if (e.target.closest('[data-action="adjust-wallet"]')) {
      handleAdjustWallet();
      return;
    }

    var action = e.target.closest('[data-wallet-action]');
    if (action && action.dataset.walletAction === 'view-txn') {
      var txn = state.txns.find(function(t){ return t.id === action.dataset.id; });
      if (txn) openTxnModal(txn);
    }
  }

  function openTxnModal(txn) {
    var u = state.usersMap[txn.userId] || { name: 'Unknown', email: '—' };
    var isPos = Number(txn.amount) >= 0;

    var modal = UI.openModal(
      '<div class="modal narrow">' +
        '<div class="modal-head"><h3><i class="fas fa-receipt"></i> Transaction Details</h3><button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button></div>' +
        '<div class="modal-body">' +
          '<div style="text-align:center;margin-bottom:24px;padding:20px;background:var(--surface-2);border-radius:12px;">' +
            '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;">Amount</div>' +
            '<div style="font-size:32px;font-weight:800;color:' + (isPos ? 'var(--green)' : 'var(--red)') + ';margin:8px 0;">' + (isPos ? '+' : '') + money(txn.amount) + '</div>' +
            '<span class="pill ' + esc(txn.type) + '">' + esc(txn.type) + '</span>' +
          '</div>' +
          '<div class="grid-2" style="gap:16px;">' +
            '<div class="field"><label>Date</label><div style="font-weight:600;">' + esc(fmtDate(txn.at)) + '</div></div>' +
            '<div class="field"><label>Balance After</label><div style="font-weight:600;">' + money(txn.balanceAfter) + '</div></div>' +
            '<div class="field full" style="grid-column:1/-1;"><label>User</label><div style="font-weight:600;">' + esc(u.name) + '</div><div style="font-size:12px;color:var(--text-3);">' + esc(u.email) + '</div></div>' +
            '<div class="field full" style="grid-column:1/-1;"><label>Description</label><div style="font-weight:600;">' + esc(txn.description || '—') + '</div></div>' +
            '<div class="field full" style="grid-column:1/-1;"><label>Reference</label><div><code class="mono">' + esc(txn.reference || txn.id) + '</code></div></div>' +
          '</div>' +
        '</div>' +
        '<div class="modal-foot"><button class="btn btn-primary" data-close>Close</button></div>' +
      '</div>'
    );
    if (modal && UI.closeModal) {
      modal.addEventListener('click', function(e) {
        if (e.target.closest('[data-close]')) UI.closeModal(modal);
      });
    }
  }

  function handleAdjustWallet() {
    var users = asArray(read(KEYS.users, []));
    var options = users.filter(function(u){ return u.role !== 'admin'; }).map(function(u) {
      return '<option value="' + esc(u.id) + '">' + esc(u.name) + ' (' + money(u.wallet || 0) + ')</option>';
    }).join('');

    var modal = UI.openModal(
      '<div class="modal narrow">' +
        '<div class="modal-head"><h3><i class="fas fa-wallet"></i> Adjust Balance</h3><button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button></div>' +
        '<div class="modal-body">' +
          '<div class="field" style="margin-bottom:14px;"><label>Select User</label><select id="wUser">' + options + '</select></div>' +
          '<div class="field" style="margin-bottom:14px;"><label>Operation</label><select id="wOp"><option value="credit">Credit (Add)</option><option value="debit">Debit (Deduct)</option></select></div>' +
          '<div class="field" style="margin-bottom:14px;"><label>Amount</label><input type="number" id="wAmt" placeholder="e.g. 5000" min="1" /></div>' +
          '<div class="field"><label>Reason</label><input type="text" id="wReason" placeholder="Reason for audit" /></div>' +
        '</div>' +
        '<div class="modal-foot"><button type="button" class="btn btn-outline" data-close>Cancel</button><button type="button" class="btn btn-primary" id="wSave">Apply Adjustment</button></div>' +
      '</div>'
    );
    if (!modal) return;

    modal.querySelector('#wSave').onclick = function () {
      var userId = modal.querySelector('#wUser').value;
      var op = modal.querySelector('#wOp').value;
      var amt = parseInt(modal.querySelector('#wAmt').value, 10) || 0;
      var reason = modal.querySelector('#wReason').value.trim();
      
      if (!userId || !amt || !reason) return toast('Error', 'All fields required', 'error');

      var u = users.find(function(x){ return x.id === userId; });
      if (!u) return;

      var bal = Number(u.wallet) || 0;
      var delta = op === 'debit' ? -amt : amt;
      var newBal = bal + delta;
      if (newBal < 0) return toast('Error', 'Balance cannot go negative', 'error');

      u.wallet = newBal;
      write(KEYS.users, users);

      var txns = asArray(read(KEYS.walletTxns, []));
      txns.push({ id: uid('txn'), userId: u.id, type: delta >= 0 ? 'Deposit' : 'Withdraw', amount: delta, balanceAfter: newBal, description: reason, at: new Date().toISOString() });
      write(KEYS.walletTxns, txns);

      if (Admin && Admin.logAudit) Admin.logAudit('wallet.adjust', 'user:' + u.email, (delta >= 0 ? '+' : '') + delta + ' — ' + reason);
      UI.closeModal(modal);
      toast('Balance adjusted', '', 'success');
      refresh();
    };
  }

  function refresh() {
    var content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = render({});
    bind({});
  }

  function cleanup() {
    if (state.dt && state.dt.destroy) { try { state.dt.destroy(); } catch (e) {} }
    state.dt = null;
    if (pageContainer && pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageContainer = null;
    pageHandler = null;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin.wallet = {
    title: 'Wallet Ledger',
    subtitle: 'Platform-wide wallet movements and liability',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);