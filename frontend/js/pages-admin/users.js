/* ================================================================
   GlobalExpress — Admin Page: Users
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

  var KEYS = { users:'ge_users', shipments:'ge_shipments', tickets:'ge_tickets' };

  var state = {
    activeTab: 'all',
    dt: null,
    users: [],
    shipmentCounts: {},
    ticketCounts: {}
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
    state.users = asArray(read(KEYS.users, []));
    var shipments = asArray(read(KEYS.shipments, []));
    var sc = {};
    shipments.forEach(function (s) { if (s && s.createdBy) sc[s.createdBy] = (sc[s.createdBy]||0)+1; });
    state.shipmentCounts = sc;
    var tickets = asArray(read(KEYS.tickets, []));
    var tc = {};
    tickets.forEach(function (t) { if (t && t.userId) tc[t.userId] = (tc[t.userId]||0)+1; });
    state.ticketCounts = tc;
  }

  function isSuspended(u) { return !!(u && u.flags && u.flags.suspended); }
  function isAdmin(u) {
    return u && ['admin','support','finance','auditor'].indexOf(u.role) !== -1;
  }
  function isActive(u) {
    if (!u) return false;
    var last = u.lastActivity || u.joined;
    if (!last) return state.shipmentCounts[u.id] > 0;
    var t = new Date(last).getTime();
    if (isNaN(t)) return state.shipmentCounts[u.id] > 0;
    return (Date.now() - t) < (90 * 86400000);
  }

  function isNew(u) {
    if (!u || !u.joined) return false;
    var t = new Date(u.joined).getTime();
    return !isNaN(t) && (Date.now() - t) < (30 * 86400000);
  }

  function applyTabFilter(rows) {
    var tab = state.activeTab;
    if (tab === 'all')          return rows;
    if (tab === 'admins')       return rows.filter(isAdmin);
    if (tab === 'suspended')    return rows.filter(isSuspended);
    if (tab === 'new')          return rows.filter(isNew);
    if (tab === 'active')       return rows.filter(function (u) { return !isAdmin(u) && !isSuspended(u) && isActive(u); });
    if (tab === 'inactive')     return rows.filter(function (u) { return !isAdmin(u) && !isSuspended(u) && !isActive(u); });
    if (tab === 'zero-wallet')  return rows.filter(function (u) { return !isAdmin(u) && (u.wallet || 0) === 0; });
    return rows;
  }

  function countForTab(tab) {
    var saved = state.activeTab;
    state.activeTab = tab;
    var n = applyTabFilter(state.users).length;
    state.activeTab = saved;
    return n;
  }

  function initials(name) {
    var s = String(name || '?').trim();
    if (!s) return '?';
    var p = s.split(/\s+/);
    return p.length === 1 ? p[0].charAt(0).toUpperCase()
      : (p[0].charAt(0) + p[p.length-1].charAt(0)).toUpperCase();
  }

  function rolePill(role) {
    var r = String(role || 'user').toLowerCase();
    var label = r === 'admin' ? 'Admin' : r === 'support' ? 'Support'
              : r === 'finance' ? 'Finance' : r === 'auditor' ? 'Auditor' : 'Customer';
    return '<span class="admin-badge role-' + esc(r) + '">' + esc(label) + '</span>';
  }

  function statusPill(u) {
    if (u && u.deletedAt) return '<span class="pill Cancelled">Deleted</span>';
    if (isSuspended(u)) return '<span class="pill Cancelled">Suspended</span>';
    if (isActive(u)) return '<span class="pill Delivered">Active</span>';
    return '<span class="pill On-Hold">Inactive</span>';
  }

  var TABS = [
    { key:'all', label:'All' },
    { key:'active', label:'Active' },
    { key:'inactive', label:'Inactive' },
    { key:'suspended', label:'Suspended' },
    { key:'admins', label:'Admins' },
    { key:'new', label:'New (30d)' },
    { key:'zero-wallet', label:'Zero Wallet' }
  ];

  function renderTabsBar() {
    return '<div class="users-tabs-bar">' +
      TABS.map(function (t) {
        var n = countForTab(t.key);
        var active = state.activeTab === t.key;
        return '<button type="button" class="users-tab' + (active ? ' active' : '') + '" ' +
          'data-users-tab="' + esc(t.key) + '">' + esc(t.label) +
          '<span class="count">' + comma(n) + '</span></button>';
      }).join('') + '</div>';
  }

  function renderHeader() {
    return '<div class="page-header">' +
      '<div><h2>Users</h2><p class="page-subtitle">Manage every user on the platform.</p></div>' +
      '<div class="page-actions">' +
        '<button type="button" class="btn btn-outline btn-sm" data-users-export>' +
          '<i class="fas fa-download"></i> Export</button>' +
        '<button type="button" class="btn btn-primary btn-sm" data-users-new>' +
          '<i class="fas fa-plus"></i> New User</button>' +
      '</div></div>';
  }

  function buildColumns() {
    return [
      { key:'name', label:'User', sortable:true,
        sortValue:function (u) { return (u.name||'').toLowerCase(); },
        render:function (u) {
          return '<div class="cell-user">' +
            '<span class="av">' + esc(initials(u.name)) + '</span>' +
            '<div class="meta">' +
              '<div class="name">' + esc(u.name || 'Unnamed') + '</div>' +
              '<div class="email">' + esc(u.email || '') + '</div>' +
            '</div></div>';
        } },
      { key:'role', label:'Role', sortable:true,
        sortValue:function (u) { return u.role || 'user'; },
        render:function (u) { return rolePill(u.role); } },
      { key:'wallet', label:'Wallet', sortable:true, align:'right',
        sortValue:function (u) { return Number(u.wallet||0); },
        render:function (u) {
          var bal = Number(u.wallet||0);
          var cls = bal > 0 ? 'positive' : 'negative';
          return '<span class="tbl-amount ' + cls + '">' + money(bal) + '</span>';
        } },
      { key:'status', label:'Status', sortable:true,
        sortValue:function (u) {
          if (u.deletedAt) return 3;
          if (isSuspended(u)) return 2;
          return isActive(u) ? 0 : 1;
        },
        render:function (u) { return statusPill(u); } }
    ];
  }

  function buildActionsCol() {
    return {
      label:'Actions',
      render:function (u) {
        return '<button type="button" class="btn btn-ghost btn-sm" ' +
            'data-users-action="view" data-user-id="' + esc(u.id) + '" title="View">' +
            '<i class="fas fa-eye"></i></button>' +
          '<button type="button" class="btn btn-ghost btn-sm" ' +
            'data-users-action="wallet" data-user-id="' + esc(u.id) + '" title="Adjust Wallet">' +
            '<i class="fas fa-wallet"></i></button>' +
          '<button type="button" class="btn btn-ghost btn-sm" ' +
            'data-users-action="more" data-user-id="' + esc(u.id) + '" title="More">' +
            '<i class="fas fa-ellipsis-vertical"></i></button>';
      }
    };
  }

  function buildBulkActions() {
    return [];
  }

  function exportUsers(rows) {
    var list = rows || state.users;
    try {
      var blob = new Blob([JSON.stringify(list, null, 2)], { type:'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'users-' + new Date().toISOString().slice(0,10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Exported', list.length + ' users', 'success');
    } catch (e) { toast('Export failed', String(e.message||e), 'error'); }
  }

  function render(ctx) {
    loadData();
    return '<div class="users-page">' +
      renderHeader() + renderTabsBar() +
      '<div id="users-table-mount"></div></div>';
  }

  function bind(ctx) {
    var mount = document.getElementById('users-table-mount');
    if (!mount) return;

    if (state.dt && state.dt.destroy) { try { state.dt.destroy(); } catch (e) {} }
    state.dt = DataTable.create(mount, {
      key: 'admin-users-' + state.activeTab,
      data: applyTabFilter(state.users),
      rowId: function (u) { return u.id; },
      columns: buildColumns(),
      actionsCol: buildActionsCol(),
      searchKeys: ['name','email'],
      pageSize: 20,
      emptyState: { icon:'fa-users', title:'No users yet', message:'When someone signs up, they\'ll appear here.' },
      bulkActions: buildBulkActions(),
      onRowClick: function (user) { openUser(user); }
    });

    pageContainer = document.getElementById('content');
    if (!pageContainer) return;
    if (pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageHandler = onPageClick;
    pageContainer.addEventListener('click', pageHandler);
  }

  function onPageClick(e) {
    var tab = e.target.closest('[data-users-tab]');
    if (tab) {
      state.activeTab = tab.dataset.usersTab;
      refresh();
      return;
    }

    if (e.target.closest('[data-users-export]')) {
      exportUsers(state.dt ? state.dt.data : state.users);
      return;
    }

    var action = e.target.closest('[data-users-action]');
    if (action) {
      var kind = action.dataset.usersAction;
      var userId = action.dataset.userId;
      var user = findUser(userId);
      if (!user) return;
      if (kind === 'view') openUser(user);
      else if (kind === 'wallet') toast('Adjust Wallet', 'Coming soon for ' + (user.name || user.email), 'info');
      else if (kind === 'more') toast('More', 'Options menu — coming soon', 'info');
    }
  }

  function findUser(id) {
    for (var i = 0; i < state.users.length; i++) if (state.users[i].id === id) return state.users[i];
    return null;
  }

  // FIX: Force render the user detail page manually so the router doesn't drop the ID.
  function openUser(user) {
    localStorage.setItem('ge_admin_current_user', user.id);
    
    // 1. Try the router first
    if (global.Admin && Admin.go) {
      try { Admin.go('user-detail', { id: user.id }); } catch (e) {}
    }
    
    // 2. Force the UI to render it immediately just in case
    setTimeout(function() {
      var page = global.PagesAdmin && global.PagesAdmin['user-detail'];
      var content = document.getElementById('content');
      if (page && content) {
        content.innerHTML = page.render({ params: { id: user.id } });
        page.bind({ params: { id: user.id } });
      }
    }, 50);
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
  global.PagesAdmin.users = {
    title: 'Users',
    subtitle: 'Manage every user on the platform',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);