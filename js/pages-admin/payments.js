/* ================================================================
   GlobalExpress — Admin Page: Payments (Supabase Standalone)
   File: js/payments.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n||0).toLocaleString(); };

  var state = {
    activeTab: 'all',
    payments: []
  };

  var pageHandler = null;
  var pageContainer = null;

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  async function loadData() {
    if (!window.supabaseClient) return;
    try {
      // Join the users table to get the customer's name/email
      const { data, error } = await window.supabaseClient
        .schema('app')
        .from('payments')
        .select('*, users ( full_name, email )')
        .order('created_at', { ascending: false });

      if (error) throw error;
      state.payments = data || [];
    } catch (err) {
      console.error('Failed to load payments:', err);
    }
  }

  // ================================================================
  // FILTERS & TABS
  // ================================================================
  function applyTabFilter(rows) {
    var tab = state.activeTab;
    if (tab === 'all') return rows;
    if (tab === 'paid') return rows.filter(function(p) { return p.status === 'Paid'; });
    if (tab === 'pending') return rows.filter(function(p) { return p.status === 'Pending'; });
    if (tab === 'failed') return rows.filter(function(p) { return p.status === 'Failed'; });
    if (tab === 'refunds') return rows.filter(function(p) { return p.kind === 'Refund'; });
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
    { key:'all', label:'All Payments' },
    { key:'paid', label:'Paid' },
    { key:'pending', label:'Pending' },
    { key:'failed', label:'Failed' },
    { key:'refunds', label:'Refunds' }
  ];

  function renderTabsBar() {
    return '<div class="users-tabs-bar" style="display:flex;gap:10px;margin-bottom:20px;border-bottom:1px solid var(--border);">' +
      TABS.map(function (t) {
        var n = countForTab(t.key);
        var active = state.activeTab === t.key;
        var style = active ? 'border-bottom:2px solid var(--accent); color:var(--text);' : 'color:var(--text-3);';
        return '<button type="button" class="users-tab" ' +
          'data-payments-tab="' + esc(t.key) + '" style="background:none;border:none;padding:10px 15px;font-weight:600;cursor:pointer;'+style+'">' + esc(t.label) +
          ' <span class="count" style="background:var(--surface-2);padding:2px 6px;border-radius:10px;font-size:11px;">' + n + '</span></button>';
      }).join('') + '</div>';
  }

  function renderHeader() {
    return '<div class="page-header" style="margin-bottom:20px;">' +
      '<div><h2>Payments</h2><p class="page-subtitle">Manage every transaction on the platform.</p></div>' +
      '</div>';
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render() {
    return '<div class="payments-page">' +
      renderHeader() + renderTabsBar() +
      '<div class="panel" style="padding:0;overflow-x:auto;">' +
        '<div id="payments-table-mount"><div style="padding:40px;text-align:center;color:var(--text-3)"><i class="fas fa-circle-notch fa-spin"></i> Loading payments...</div></div>' +
      '</div>' +
    '</div>';
  }

  async function bind(ctx) {
    var mount = document.getElementById('payments-table-mount');
    if (!mount) return;

    // Fetch real data
    await loadData();

    var filtered = applyTabFilter(state.payments);

    if (filtered.length === 0) {
      mount.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-3)">No payments found in this category.</div>';
    } else {
      var rows = filtered.map(function(p) {
        var customerName = p.users ? (p.users.full_name || p.users.email) : 'Unknown';
        
        // Determine styles
        var statusClass = p.status === 'Paid' ? 'Delivered' : 
                          p.status === 'Pending' ? 'Pending' : 'Cancelled';
        var kindClass = p.kind === 'Deposit' ? 'Delivered' : 
                        p.kind === 'Withdraw' ? 'Cancelled' : 'Pending';
        
        var amountClass = p.amount >= 0 ? 'var(--green)' : 'var(--red)';
        var amountSign = p.amount >= 0 ? '+' : '';

        return '<tr style="border-bottom:1px solid var(--border);">' +
          '<td style="padding:16px 20px;">' +
            '<div style="font-weight:700;font-family:monospace;font-size:12px;">'+esc(p.reference)+'</div>' +
            '<div style="font-size:12px;color:var(--text-3);">'+new Date(p.created_at).toLocaleString()+'</div>' +
          '</td>' +
          '<td>' +
            '<div style="font-weight:600;font-size:13px;">'+esc(customerName)+'</div>' +
          '</td>' +
          '<td><span class="pill '+kindClass+'">'+esc(p.kind)+'</span></td>' +
          '<td style="font-weight:700;color:'+amountClass+';">'+amountSign+money(p.amount)+'</td>' +
          '<td style="font-size:13px;">'+esc(p.method)+'</td>' +
          '<td><span class="pill '+statusClass+'">'+esc(p.status)+'</span></td>' +
        '</tr>';
      }).join('');

      mount.innerHTML = 
        '<table style="width:100%;border-collapse:collapse;text-align:left;">' +
          '<thead><tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">' +
            '<th style="padding:12px 20px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Reference</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">User</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Kind</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Amount</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Method</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Status</th>' +
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
    var tab = e.target.closest('[data-payments-tab]');
    if (tab) {
      state.activeTab = tab.dataset.paymentsTab;
      document.getElementById('content').innerHTML = render();
      bind({});
      return;
    }
  }

  function cleanup() {
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