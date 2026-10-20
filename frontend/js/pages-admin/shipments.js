/* ================================================================
   GlobalExpress — Admin Page: Shipments
   ================================================================
   Global shipment list with DataTable, status filters, and bulk
   actions. Clicking a row routes to shipment-detail.
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

  var KEYS = { shipments:'ge_shipments', users:'ge_users' };

  var state = {
    activeTab: 'all',
    dt: null,
    shipments: [],
    usersMap: {}
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

  function loadData() {
    state.shipments = asArray(read(KEYS.shipments, []));
    var users = asArray(read(KEYS.users, []));
    var map = {};
    users.forEach(function (u) { map[u.id] = u; });
    state.usersMap = map;
  }

  function applyTabFilter(rows) {
    var tab = state.activeTab;
    if (tab === 'all') return rows;
    if (tab === 'active') return rows.filter(function(s) {
      return ['Pending', 'In Transit', 'On Hold'].indexOf(s.status) !== -1;
    });
    if (tab === 'delivered') return rows.filter(function(s) { return s.status === 'Delivered'; });
    if (tab === 'cancelled') return rows.filter(function(s) { return s.status === 'Cancelled'; });
    return rows;
  }

  function countForTab(tab) {
    var saved = state.activeTab;
    state.activeTab = tab;
    var n = applyTabFilter(state.shipments).length;
    state.activeTab = saved;
    return n;
  }

  var TABS = [
    { key:'all', label:'All' },
    { key:'active', label:'Active' },
    { key:'delivered', label:'Delivered' },
    { key:'cancelled', label:'Cancelled' }
  ];

  function renderTabsBar() {
    return '<div class="users-tabs-bar">' +
      TABS.map(function (t) {
        var n = countForTab(t.key);
        var active = state.activeTab === t.key;
        return '<button type="button" class="users-tab' + (active ? ' active' : '') + '" ' +
          'data-shipments-tab="' + esc(t.key) + '">' + esc(t.label) +
          '<span class="count">' + comma(n) + '</span></button>';
      }).join('') + '</div>';
  }

  function renderHeader() {
    return '<div class="page-header">' +
      '<div><h2>Shipments</h2><p class="page-subtitle">Manage every shipment on the platform.</p></div>' +
      '<div class="page-actions">' +
        '<button type="button" class="btn btn-outline btn-sm" data-shipments-export>' +
          '<i class="fas fa-download"></i> Export</button>' +
        '<button type="button" class="btn btn-primary btn-sm" data-shipments-new>' +
          '<i class="fas fa-plus"></i> Create Shipment</button>' +
      '</div></div>';
  }

  function buildColumns() {
    return [
      { key:'trackingCode', label:'Tracking Code', sortable:true,
        render:function (s) {
          return '<code class="mono">' + esc(s.trackingCode || '—') + '</code>';
        } },
      { key:'user', label:'User', sortable:true,
        sortValue:function (s) { 
          var u = state.usersMap[s.createdBy]; 
          return u ? u.name : ''; 
        },
        render:function (s) {
          var u = state.usersMap[s.createdBy];
          if (!u) return '<span class="text-muted">Unknown</span>';
          return '<div class="cell-user">' +
            '<div class="meta"><div class="name">' + esc(u.name || u.email) + '</div>' +
            '<div class="email">' + esc(u.email) + '</div></div>' +
          '</div>';
        } },
      { key:'route', label:'Route', sortable:false,
        render:function (s) {
          return esc(s.originCity || '—') + ' <i class="fas fa-arrow-right" style="font-size:9px;color:var(--text-3)"></i> ' + esc(s.destCity || '—');
        } },
      { key:'status', label:'Status', sortable:true,
        render:function (s) {
          return '<span class="pill ' + esc((s.status||'Pending').replace(/\s+/g,'-')) + '">' + esc(s.status||'Pending') + '</span>';
        } },
      { key:'created', label:'Created', sortable:true, hideSm:true,
        sortValue:function (s) { var t = s.createdAt ? new Date(s.createdAt).getTime() : 0; return isNaN(t) ? 0 : t; },
        render:function (s) {
          return '<span class="text-dim">' + esc(fmtRelative(s.createdAt)) + '</span>';
        } }
    ];
  }

  function buildActionsCol() {
    return {
      label:'Actions',
      render:function (s) {
        return '<button type="button" class="btn btn-ghost btn-sm" ' +
            'data-shipments-action="view" data-id="' + esc(s.id || s.trackingCode) + '" title="View">' +
            '<i class="fas fa-eye"></i></button>' +
          '<button type="button" class="btn btn-ghost btn-sm" ' +
            'data-shipments-action="track" data-id="' + esc(s.id || s.trackingCode) + '" title="Track">' +
            '<i class="fas fa-location-dot"></i></button>';
      }
    };
  }

  function buildBulkActions() {
    return [
      { key:'export', label:'Export', icon:'fa-download',
        handler:function (ids, rows) { exportShipments(rows); } }
    ];
  }

  function exportShipments(rows) {
    var list = rows || state.shipments;
    try {
      var blob = new Blob([JSON.stringify(list, null, 2)], { type:'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'shipments-' + new Date().toISOString().slice(0,10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Exported', list.length + ' shipments', 'success');
    } catch (e) { toast('Export failed', String(e.message||e), 'error'); }
  }

  function render(ctx) {
    loadData();
    return '<div class="shipments-page">' +
      renderHeader() + renderTabsBar() +
      '<div id="shipments-table-mount"></div></div>';
  }

  function bind(ctx) {
    var mount = document.getElementById('shipments-table-mount');
    if (!mount) return;

    if (state.dt && state.dt.destroy) { try { state.dt.destroy(); } catch (e) {} }
    state.dt = DataTable.create(mount, {
      key: 'admin-shipments-' + state.activeTab,
      data: applyTabFilter(state.shipments),
      rowId: function (s) { return s.id || s.trackingCode; },
      columns: buildColumns(),
      actionsCol: buildActionsCol(),
      searchKeys: ['trackingCode', 'originCity', 'destCity'],
      filters: [
        { key:'status', label:'Status', options:[
          { value:'Pending', label:'Pending' },
          { value:'In Transit', label:'In Transit' },
          { value:'On Hold', label:'On Hold' },
          { value:'Delivered', label:'Delivered' },
          { value:'Cancelled', label:'Cancelled' }
        ] }
      ],
      pageSize: 20,
      emptyState: { icon:'fa-box', title:'No shipments yet', message:'When users create shipments, they\'ll appear here.' },
      bulkActions: buildBulkActions(),
      onRowClick: function (shipment) { openShipment(shipment); }
    });

    pageContainer = document.getElementById('content');
    if (!pageContainer) return;
    if (pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageHandler = onPageClick;
    pageContainer.addEventListener('click', pageHandler);
  }

  function onPageClick(e) {
    var tab = e.target.closest('[data-shipments-tab]');
    if (tab) {
      state.activeTab = tab.dataset.shipmentsTab;
      refresh();
      return;
    }

    if (e.target.closest('[data-shipments-export]')) {
      exportShipments(state.dt ? state.dt.data : state.shipments);
      return;
    }

    if (e.target.closest('[data-shipments-new]')) {
      if (global.Admin && Admin.go) Admin.go('shipment-create');
      return;
    }

    var action = e.target.closest('[data-shipments-action]');
    if (action) {
      var kind = action.dataset.shipmentsAction;
      var id = action.dataset.id;
      var shipment = findShipment(id);
      if (!shipment) return;
      
      if (kind === 'view' || kind === 'track') {
        openShipment(shipment);
      }
    }
  }

  function findShipment(id) {
    for (var i = 0; i < state.shipments.length; i++) {
      if (state.shipments[i].id === id || state.shipments[i].trackingCode === id) return state.shipments[i];
    }
    return null;
  }

  // FIX: Store ID in localStorage before navigating to bypass router drops
  function openShipment(shipment) {
    localStorage.setItem('ge_admin_current_shipment', shipment.id || shipment.trackingCode);
    if (global.Admin && Admin.go) {
      try { Admin.go('shipment-detail', { id: shipment.id || shipment.trackingCode }); } catch(e) {}
    } else {
      window.location.hash = 'shipment-detail';
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
  global.PagesAdmin.shipments = {
    title: 'Shipments',
    subtitle: 'Manage every shipment on the platform',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);