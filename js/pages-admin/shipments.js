/* ================================================================
   GlobalExpress — Admin Page: Shipments (Supabase Standalone)
   File: js/shipments.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n||0).toLocaleString(); };

  var state = {
    activeTab: 'all',
    shipments: []
  };

  var pageHandler = null;
  var pageContainer = null;

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  async function loadData() {
    if (!window.supabaseClient) return;
    try {
      // We join the 'users' table to get the customer's name/email
      const { data, error } = await window.supabaseClient
        .schema('app')
        .from('shipments')
        .select('*, users ( full_name, email )')
        .order('created_at', { ascending: false });

      if (error) throw error;
      state.shipments = data || [];
    } catch (err) {
      console.error('Failed to load shipments:', err);
    }
  }

  // ================================================================
  // FILTERS & TABS
  // ================================================================
  function applyTabFilter(rows) {
    var tab = state.activeTab;
    if (tab === 'all') return rows;
    if (tab === 'active') return rows.filter(function(s) {
      return ['Pending', 'In Transit', 'On Hold'].includes(s.status);
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
    return '<div class="users-tabs-bar" style="display:flex;gap:10px;margin-bottom:20px;border-bottom:1px solid var(--border);">' +
      TABS.map(function (t) {
        var n = countForTab(t.key);
        var active = state.activeTab === t.key;
        var style = active ? 'border-bottom:2px solid var(--accent); color:var(--text);' : 'color:var(--text-3);';
        return '<button type="button" class="users-tab" ' +
          'data-shipments-tab="' + esc(t.key) + '" style="background:none;border:none;padding:10px 15px;font-weight:600;cursor:pointer;'+style+'">' + esc(t.label) +
          ' <span class="count" style="background:var(--surface-2);padding:2px 6px;border-radius:10px;font-size:11px;">' + n + '</span></button>';
      }).join('') + '</div>';
  }

  function renderHeader() {
    return '<div class="page-header" style="margin-bottom:20px;">' +
      '<div><h2>Shipments</h2><p class="page-subtitle">Manage every shipment on the platform.</p></div>' +
      '</div>';
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render() {
    return '<div class="shipments-page">' +
      renderHeader() + renderTabsBar() +
      '<div class="panel" style="padding:0;overflow-x:auto;">' +
        '<div id="shipments-table-mount"><div style="padding:40px;text-align:center;color:var(--text-3)"><i class="fas fa-circle-notch fa-spin"></i> Loading shipments...</div></div>' +
      '</div>' +
    '</div>';
  }

  async function bind(ctx) {
    var mount = document.getElementById('shipments-table-mount');
    if (!mount) return;

    // Fetch real data
    await loadData();

    var filtered = applyTabFilter(state.shipments);

    if (filtered.length === 0) {
      mount.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-3)">No shipments found in this category.</div>';
    } else {
      var rows = filtered.map(function(s) {
        var customerName = s.users ? (s.users.full_name || s.users.email) : 'Unknown';
        var statusClass = s.status === 'Delivered' ? 'Delivered' : 
                          s.status === 'Pending' ? 'Pending' : 
                          s.status === 'Cancelled' ? 'Cancelled' : 'In-Transit';

        return '<tr style="border-bottom:1px solid var(--border);">' +
          '<td style="padding:16px 20px;">' +
            '<div style="font-weight:700;font-family:monospace;font-size:13px;">'+esc(s.tracking_code)+'</div>' +
            '<div style="font-size:12px;color:var(--text-3);">'+new Date(s.created_at).toLocaleDateString()+'</div>' +
          '</td>' +
          '<td>' +
            '<div style="font-weight:600;font-size:13px;">'+esc(customerName)+'</div>' +
          '</td>' +
          '<td>' +
            '<div style="font-size:13px;">'+esc(s.origin_city)+' &rarr; '+esc(s.dest_city)+'</div>' +
          '</td>' +
          '<td><span class="pill '+statusClass+'">'+esc(s.status)+'</span></td>' +
          '<td style="font-weight:600;color:var(--text);">'+money(s.amount_paid)+'</td>' +
          '<td>' +
            '<button type="button" class="btn btn-sm btn-outline" data-shipments-action="view" data-id="'+esc(s.id)+'"><i class="fas fa-eye"></i> View</button>' +
          '</td>' +
        '</tr>';
      }).join('');

      mount.innerHTML = 
        '<table style="width:100%;border-collapse:collapse;text-align:left;">' +
          '<thead><tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">' +
            '<th style="padding:12px 20px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Tracking</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Customer</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Route</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Status</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Amount</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;"></th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>';
    }

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
      document.getElementById('content').innerHTML = render();
      bind({});
      return;
    }

    var action = e.target.closest('[data-shipments-action]');
    if (action) {
      var id = action.dataset.id;
      localStorage.setItem('ge_admin_current_shipment', id);
      if (global.Admin && global.Admin.go) {
        global.Admin.go('shipment-detail', { id: id });
      }
    }
  }

  function cleanup() {
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