/* ================================================================
   GlobalExpress — Admin Page: Wallet Ledger (Supabase Standalone)
   File: js/wallet.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n||0).toLocaleString(); };

  var state = {
    activeTab: 'all',
    txns: []
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
        .from('wallet_txns')
        .select('*, users ( full_name, email )')
        .order('created_at', { ascending: false });

      if (error) throw error;
      state.txns = data || [];
    } catch (err) {
      console.error('Failed to load wallet ledger:', err);
    }
  }

  // ================================================================
  // FILTERS & TABS
  // ================================================================
  function applyTabFilter(rows) {
    var tab = state.activeTab;
    if (tab === 'all') return rows;
    if (tab === 'deposits') return rows.filter(function(t) { return t.type === 'Deposit'; });
    if (tab === 'withdrawals') return rows.filter(function(t) { return t.type === 'Withdraw'; });
    if (tab === 'charges') return rows.filter(function(t) { return t.type === 'Shipment'; });
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
    { key:'charges', label:'Shipment Fees' },
    { key:'adjustments', label:'Adjustments' }
  ];

  function renderTabsBar() {
    return '<div class="users-tabs-bar" style="display:flex;gap:10px;margin-bottom:20px;border-bottom:1px solid var(--border);">' +
      TABS.map(function (t) {
        var n = countForTab(t.key);
        var active = state.activeTab === t.key;
        var style = active ? 'border-bottom:2px solid var(--accent); color:var(--text);' : 'color:var(--text-3);';
        return '<button type="button" class="users-tab" ' +
          'data-wallet-tab="' + esc(t.key) + '" style="background:none;border:none;padding:10px 15px;font-weight:600;cursor:pointer;'+style+'">' + esc(t.label) +
          ' <span class="count" style="background:var(--surface-2);padding:2px 6px;border-radius:10px;font-size:11px;">' + n + '</span></button>';
      }).join('') + '</div>';
  }

  function renderHeader() {
    return '<div class="page-header" style="margin-bottom:20px;">' +
      '<div><h2>Wallet Ledger</h2><p class="page-subtitle">Platform-wide wallet movements and liability.</p></div>' +
      '</div>';
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render() {
    return '<div class="wallet-page">' +
      renderHeader() + renderTabsBar() +
      '<div class="panel" style="padding:0;overflow-x:auto;">' +
        '<div id="wallet-table-mount"><div style="padding:40px;text-align:center;color:var(--text-3)"><i class="fas fa-circle-notch fa-spin"></i> Loading ledger...</div></div>' +
      '</div>' +
    '</div>';
  }

  async function bind(ctx) {
    var mount = document.getElementById('wallet-table-mount');
    if (!mount) return;

    // Fetch real data
    await loadData();

    var filtered = applyTabFilter(state.txns);

    if (filtered.length === 0) {
      mount.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-3)">No transactions found in this category.</div>';
    } else {
      var rows = filtered.map(function(t) {
        var customerName = t.users ? (t.users.full_name || t.users.email) : 'Unknown';
        
        var isPos = Number(t.amount) >= 0;
        var amountColor = isPos ? 'var(--green)' : 'var(--red)';
        var amountSign = isPos ? '+' : '';
        
        var typeClass = t.type === 'Deposit' ? 'Delivered' : 
                        t.type === 'Withdraw' ? 'Cancelled' : 'Pending';

        return '<tr style="border-bottom:1px solid var(--border);">' +
          '<td style="padding:16px 20px;">' +
            '<div style="font-weight:600;font-size:13px;">'+new Date(t.created_at).toLocaleString()+'</div>' +
            '<div style="font-size:11px;color:var(--text-3);font-family:monospace;">'+esc(t.reference || t.id)+'</div>' +
          '</td>' +
          '<td>' +
            '<div style="font-weight:600;font-size:13px;">'+esc(customerName)+'</div>' +
          '</td>' +
          '<td><span class="pill '+typeClass+'">'+esc(t.type)+'</span></td>' +
          '<td style="font-weight:700;color:'+amountColor+';">'+amountSign+money(t.amount)+'</td>' +
          '<td style="font-weight:600;color:var(--text);">'+money(t.balance_after)+'</td>' +
          '<td style="font-size:12px;color:var(--text-2);">'+esc(t.description || '—')+'</td>' +
        '</tr>';
      }).join('');

      mount.innerHTML = 
        '<table style="width:100%;border-collapse:collapse;text-align:left;">' +
          '<thead><tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">' +
            '<th style="padding:12px 20px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Date</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">User</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Type</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Amount</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Balance After</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Description</th>' +
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
    var tab = e.target.closest('[data-wallet-tab]');
    if (tab) {
      state.activeTab = tab.dataset.walletTab;
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
  global.PagesAdmin.wallet = {
    title: 'Wallet Ledger',
    subtitle: 'Platform-wide wallet movements and liability',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);