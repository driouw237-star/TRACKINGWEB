/* ================================================================
   GlobalExpress — Customer App: Wallet (Supabase)
   File: js/pages/wallet.js
   ================================================================ */

(function (global) {
  'use strict';

  var Pages = global.Pages || {};
  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var fmtRelative = Utils.fmtRelative || function (d) {
    var ts = Date.parse(d); if (isNaN(ts)) return '—';
    var diff = Date.now() - ts, sec = Math.floor(diff/1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec/60); if (min < 60) return min + 'm ago';
    var hr = Math.floor(min/60); if (hr < 24) return hr + 'h ago';
    return Math.floor(hr/24) + 'd ago';
  };

  var state = {
    isLoading: true,
    txns: []
  };

  var container = null;
  var handler = null;

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  async function fetchWallet(user) {
    if (!window.supabaseClient) return;
    state.isLoading = true;

    try {
      const { data, error } = await window.supabaseClient
        .schema('app')
        .from('wallet_txns')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      state.txns = data || [];

    } catch (err) {
      console.error('Failed to load wallet transactions:', err);
    } finally {
      state.isLoading = false;
      if (container) {
        container.innerHTML = render({ user: user });
        bind({ user: user });
      }
    }
  }

  // ================================================================
  // RENDER
  // ================================================================
  function render(ctx) {
    var user = ctx.user || {};
    var wallet = Number(user.wallet || 0);

    return `
      <div class="page-header" style="margin-bottom:24px;">
        <h2>My Wallet</h2>
        <p class="page-subtitle">Manage your funds and view transaction history.</p>
      </div>

      <!-- Wallet Hero -->
      <div class="wallet-hero" style="margin-bottom:24px; padding:32px;">
        <div class="wallet-hero-content">
          <div>
            <div class="wallet-balance-label">Available Balance</div>
            <div class="wallet-balance-amount">
              <small>Fr.</small>${wallet.toLocaleString()}
            </div>
            <div class="wallet-balance-sub">Safe, secure, and ready to use.</div>
          </div>
          <div class="wallet-actions">
            <button class="btn deposit" onclick="App.go('deposit')"><i class="fas fa-plus"></i> Deposit</button>
          </div>
        </div>
      </div>

      <!-- Transaction List -->
      <div class="panel" style="padding:0;overflow-x:auto;">
        <div class="panel-header" style="padding:16px 20px;">
          <h3 style="margin:0;font-size:16px;"><i class="fas fa-list" style="color:var(--accent);margin-right:8px;"></i> Transaction History</h3>
        </div>
        <div id="wallet-table-mount">
          <div style="padding:40px;text-align:center;color:var(--text-3);">
            <i class="fas fa-circle-notch fa-spin"></i> Loading transactions...
          </div>
        </div>
      </div>
    `;
  }

  function renderTable() {
    var mount = document.getElementById('wallet-table-mount');
    if (!mount) return;

    if (state.isLoading) return;

    if (state.txns.length === 0) {
      mount.innerHTML = `
        <div style="padding:60px 20px;text-align:center;">
          <div style="font-size:32px;color:var(--border);margin-bottom:12px;"><i class="fas fa-receipt"></i></div>
          <h4 style="margin-bottom:8px;">No transactions yet</h4>
          <p style="color:var(--text-3);font-size:13px;margin-bottom:16px;">Your deposits and shipping fees will appear here.</p>
          <button class="btn btn-primary" onclick="App.go('deposit')">Make a Deposit</button>
        </div>
      `;
      return;
    }

    var rows = state.txns.map(function(t) {
      var isPositive = Number(t.amount) >= 0;
      var amountColor = isPositive ? 'var(--green)' : 'var(--red)';
      var amountSign = isPositive ? '+' : '';
      
      var typeClass = t.type === 'Deposit' ? 'Delivered' : 
                      t.type === 'Withdraw' ? 'Cancelled' : 
                      t.type === 'Shipment' ? 'Pending' : 'In-Transit';

      return `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:16px 20px;">
            <div style="font-weight:600;font-size:13px;">${new Date(t.created_at).toLocaleString()}</div>
            <div style="font-size:11px;color:var(--text-3);font-family:monospace;">${esc(t.reference || t.id)}</div>
          </td>
          <td><span class="pill ${typeClass}">${esc(t.type)}</span></td>
          <td style="font-weight:700;color:${amountColor};font-size:14px;">${amountSign}${money(t.amount)}</td>
          <td style="font-weight:600;color:var(--text);">${money(t.balance_after)}</td>
          <td style="font-size:13px;color:var(--text-2);">${esc(t.description || '—')}</td>
        </tr>
      `;
    }).join('');

    mount.innerHTML = `
      <table style="width:100%;border-collapse:collapse;text-align:left;">
        <thead>
          <tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">
            <th style="padding:12px 20px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Date</th>
            <th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Type</th>
            <th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Amount</th>
            <th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Balance After</th>
            <th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Description</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  // ================================================================
  // BIND
  // ================================================================
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (state.isLoading && ctx.user) {
      fetchWallet(ctx.user);
      return;
    }

    renderTable();

    // We don't strictly need a click handler here, but we set it up in case we add pagination later
    if (handler) container.removeEventListener('click', handler);
    handler = function(e) {};
    container.addEventListener('click', handler);
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler = null;
    state.txns = [];
    state.isLoading = true;
  }

  Pages['wallet'] = {
    title: 'My Wallet',
    subtitle: 'Manage your funds',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  global.Pages = Pages;

})(window);