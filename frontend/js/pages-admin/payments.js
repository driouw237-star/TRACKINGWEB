/* ================================================================
   GlobalExpress — Admin Page: Payments
   ================================================================ */

(function (global) {
  'use strict';

  var Utils     = global.Utils     || {};
  var UI        = global.UI        || {};
  var DataTable = global.DataTable || {};

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n||0).toLocaleString(); };
  var comma = Utils.comma || function (n) { return Number(n||0).toLocaleString('en-US'); };
  var fmtRelative = Utils.fmtRelative || function (d) {
    var ts = Date.parse(d); if (isNaN(ts)) return '—';
    var diff = Date.now() - ts, sec = Math.floor(diff/1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec/60); if (min < 60) return min + 'm ago';
    var hr = Math.floor(min/60); if (hr < 24) return hr + 'h ago';
    return Math.floor(hr/24) + 'd ago';
  };
  var toast = UI.toast || function (t,m) { if (global.console) console.log(t, m); };

  var KEYS = { payments:'ge_payments', users:'ge_users' };

  var state = {
    activeTab: 'all',
    dt: null,
    payments: [],
    usersMap: {}
  };

  var pageHandler = null;
  var pageContainer = null;

  function read(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  function loadData() {
    state.payments = asArray(read(KEYS.payments, []));
    var users = asArray(read(KEYS.users, []));
    var map = {};
    users.forEach(function (u) { map[u.id] = u; });
    state.usersMap = map;
  }

  function applyTabFilter(rows) {
    var tab = state.activeTab;
    if (tab === 'all') return rows;
    if (tab === 'paid') return rows.filter(function(p) { return p.status === 'Paid'; });
    if (tab === 'pending') return rows.filter(function(p) { return p.status === 'Pending'; });
    if (tab === 'failed') return rows.filter(function(p) { return p.status === 'Failed'; });
    if (tab === 'refunded') return rows.filter(function(p) { return p.status === 'Refunded' || p.kind === 'Refund'; });
    return rows;
  }

  function countForTab(tab) {
    var saved = state.activeTab;
    state.activeTab = tab;
    var n = applyTabFilter(state.payments).length;
    state.activeTab = saved;
    return n;
  }

  var TABS = [
    { key:'all', label:'All' },
    { key:'paid', label:'Paid' },
    { key:'pending', label:'Pending' },
    { key:'failed', label:'Failed' },
    { key:'refunded', label:'Refunded' }
  ];

  function renderTabsBar() {
    return '<div class="users-tabs-bar">' +
      TABS.map(function (t) {
        var n = countForTab(t.key);
        var active = state.activeTab === t.key;
        return '<button type="button" class="users-tab' + (active ? ' active' : '') + '" ' +
          'data-payments-tab="' + esc(t.key) + '">' + esc(t.label) +
          '<span class="count">' + comma(n) + '</span></button>';
      }).join('') + '</div>';
  }

  function renderHeader() {
    return '<div class="page-header">' +
      '<div><h2>Payments</h2><p class="page-subtitle">Manage every transaction on the platform.</p></div>' +
      '<div class="page-actions">' +
        '<button type="button" class="btn btn-outline btn-sm" data-payments-export>' +
          '<i class="fas fa-download"></i> Export</button>' +
      '</div></div>';
  }

  function buildColumns() {
    return [
      { key:'id', label:'Reference', sortable:true,
        render:function (p) {
          return '<code class="mono">' + esc(p.id || '—') + '</code>';
        } },
      { key:'user', label:'User', sortable:true,
        sortValue:function (p) { 
          var u = state.usersMap[p.userId]; 
          return u ? u.name : ''; 
        },
        render:function (p) {
          var u = state.usersMap[p.userId];
          if (!u) return '<span class="text-muted">Unknown</span>';
          return '<div class="cell-user">' +
            '<div class="meta"><div class="name">' + esc(u.name) + '</div><div class="email">' + esc(u.email) + '</div></div>' +
          '</div>';
        } },
      { key:'amount', label:'Amount', sortable:true, align:'right',
        sortValue:function (p) { return Number(p.amount || 0); },
        render:function (p) {
          var amt = Number(p.amount || 0);
          var isPos = amt >= 0;
          return '<span class="tbl-amount ' + (isPos?'positive':'negative') + '">' + money(amt) + '</span>';
        } },
      { key:'method', label:'Method', sortable:true, hideSm:true,
        render:function (p) { return esc(p.method || '—'); } },
      { key:'kind', label:'Kind', sortable:true, hideSm:true,
        render:function (p) {
          return '<span class="pill ' + esc(p.kind||'Deposit') + '">' + esc(p.kind||'Deposit') + '</span>';
        } },
      { key:'status', label:'Status', sortable:true,
        render:function (p) {
          return '<span class="pill ' + esc(p.status||'Pending') + '">' + esc(p.status||'Pending') + '</span>';
        } },
      { key:'at', label:'Date', sortable:true, hideSm:true,
        sortValue:function (p) { var t = p.at ? new Date(p.at).getTime() : 0; return isNaN(t) ? 0 : t; },
        render:function (p) {
          return '<span class="text-dim">' + esc(fmtRelative(p.at)) + '</span>';
        } }
    ];
  }

  function buildActionsCol() {
    return {
      label:'Actions',
      render:function (p) {
        return '<button type="button" class="btn btn-ghost btn-sm" ' +
            'data-payments-action="view" data-id="' + esc(p.id) + '" title="View">' +
            '<i class="fas fa-eye"></i></button>';
      }
    };
  }

  function buildBulkActions() {
    return [
      { key:'export', label:'Export', icon:'fa-download',
        handler:function (ids, rows) { exportPayments(rows); } }
    ];
  }

  function exportPayments(rows) {
    var list = rows || state.payments;
    try {
      var blob = new Blob([JSON.stringify(list, null, 2)], { type:'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'payments-' + new Date().toISOString().slice(0,10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Exported', list.length + ' payments', 'success');
    } catch (e) { toast('Export failed', String(e.message||e), 'error'); }
  }

  function render(ctx) {
    loadData();
    return '<div class="payments-page">' +
      renderHeader() + renderTabsBar() +
      '<div id="payments-table-mount"></div></div>';
  }

  function bind(ctx) {
    var mount = document.getElementById('payments-table-mount');
    if (!mount) return;

    if (state.dt && state.dt.destroy) { try { state.dt.destroy(); } catch (e) {} }
    state.dt = DataTable.create(mount, {
      key: 'admin-payments-' + state.activeTab,
      data: applyTabFilter(state.payments),
      rowId: function (p) { return p.id; },
      columns: buildColumns(),
      actionsCol: buildActionsCol(),
      searchKeys: ['id', 'method', 'kind'],
      filters: [
        { key:'method', label:'Method', options:[
          { value:'MTN MoMo', label:'MTN MoMo' },
          { value:'Orange Money', label:'Orange Money' },
          { value:'Card', label:'Card' },
          { value:'Crypto', label:'Crypto' },
          { value:'Wallet', label:'Wallet' }
        ] }
      ],
      pageSize: 20,
      emptyState: { icon:'fa-credit-card', title:'No payments yet', message:'When users deposit or pay for shipments, they\'ll appear here.' },
      bulkActions: buildBulkActions(),
      onRowClick: function (payment) { openPayment(payment); }
    });

    pageContainer = document.getElementById('content');
    if (!pageContainer) return;
    if (pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageHandler = onPageClick;
    pageContainer.addEventListener('click', pageHandler);
  }

  function onPageClick(e) {
    var tab = e.target.closest('[data-payments-tab]');
    if (tab) {
      state.activeTab = tab.dataset.paymentsTab;
      refresh();
      return;
    }

    if (e.target.closest('[data-payments-export]')) {
      exportPayments(state.dt ? state.dt.data : state.payments);
      return;
    }

    var action = e.target.closest('[data-payments-action]');
    if (action) {
      var kind = action.dataset.paymentsAction;
      var id = action.dataset.id;
      var payment = findPayment(id);
      if (!payment) return;
      
      if (kind === 'view') {
        openPayment(payment);
      }
    }
  }

  function findPayment(id) {
    for (var i = 0; i < state.payments.length; i++) if (state.payments[i].id === id) return state.payments[i];
    return null;
  }

  // COMPLETELY BYPASSES ROUTER: Renders manually to avoid file:/// hash crashes
  function openPayment(payment) {
    var page = global.PagesAdmin && global.PagesAdmin['payment-detail'];
    var content = document.getElementById('content');
    
    if (page && content) {
      content.innerHTML = page.render({ params: { id: payment.id } });
      page.bind({ params: { id: payment.id } });
    } else {
      // Fallback to router if page isn't loaded
      if (global.Admin && Admin.go) Admin.go('payment-detail', { id: payment.id });
    }
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
  global.PagesAdmin.payments = {
    title: 'Payments',
    subtitle: 'Manage every transaction on the platform',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);