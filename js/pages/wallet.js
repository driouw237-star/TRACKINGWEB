/* ================================================================
   GlobalExpress — Customer App: Wallet (Supabase + Mobile Optimized)
   File: js/pages/wallet.js
   ================================================================ */

(function (global) {
  'use strict';

  var Pages = global.Pages || {};
  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };

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
  // RENDER HELPERS
  // ================================================================
  function renderTransactions() {
    if (state.isLoading) {
      return '<div style="padding:40px;text-align:center;color:var(--text-3);"><i class="fas fa-circle-notch fa-spin"></i> Loading transactions...</div>';
    }

    if (state.txns.length === 0) {
      return `
        <div style="padding:60px 20px;text-align:center;">
          <div style="font-size:32px;color:var(--border);margin-bottom:12px;"><i class="fas fa-receipt"></i></div>
          <h4 style="margin-bottom:8px;">No transactions yet</h4>
          <p style="color:var(--text-3);font-size:13px;margin-bottom:16px;">Your deposits and shipping fees will appear here.</p>
          <button class="btn btn-primary" onclick="App.go('deposit')">Make a Deposit</button>
        </div>
      `;
    }

    // Desktop Table View
    var desktopRows = state.txns.map(function(t) {
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

    // Mobile Card View
    var mobileCards = state.txns.map(function(t) {
      var isPositive = Number(t.amount) >= 0;
      var amountColor = isPositive ? 'var(--green)' : 'var(--red)';
      var amountSign = isPositive ? '+' : '';
      var icon = t.type === 'Deposit' ? 'fa-arrow-down' : t.type === 'Shipment' ? 'fa-truck' : 'fa-arrow-up';
      var bg = t.type === 'Deposit' ? '#ecfdf5' : t.type === 'Shipment' ? '#eff6ff' : '#fef2f2';
      var fg = t.type === 'Deposit' ? 'var(--green)' : t.type === 'Shipment' ? 'var(--blue)' : 'var(--red)';

      return `
        <div style="padding: 16px; border-bottom: 1px solid var(--border); display: flex; gap: 14px; align-items: flex-start;">
          <div style="width: 40px; height: 40px; border-radius: 10px; background: ${bg}; color: ${fg}; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;">
            <i class="fas ${icon}"></i>
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <div>
                <div style="font-weight: 700; font-size: 14px; color: var(--text);">${esc(t.type)}</div>
                <div style="font-size: 12px; color: var(--text-3); margin-top: 2px;">${new Date(t.created_at).toLocaleDateString()}</div>
              </div>
              <div style="font-weight: 800; font-size: 15px; color: ${amountColor}; white-space: nowrap;">
                ${amountSign}${money(t.amount)}
              </div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
              <div style="font-size: 12px; color: var(--text-2); truncate;">${esc(t.description || '—')}</div>
              <div style="font-size: 11px; color: var(--text-3); font-family: monospace;">${esc(t.reference || t.id).slice(0, 12)}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <style>
        /* Responsive toggling */
        .wallet-table-desktop { display: block; }
        .wallet-table-mobile { display: none; }
        
        @media (max-width: 768px) {
          .wallet-table-desktop { display: none; }
          .wallet-table-mobile { display: block; }
        }
      </style>

      <!-- Desktop Table -->
      <div class="wallet-table-desktop" style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;text-align:left; min-width: 600px;">
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
            ${desktopRows}
          </tbody>
        </table>
      </div>

      <!-- Mobile Cards -->
      <div class="wallet-table-mobile">
        ${mobileCards}
      </div>
    `;
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render(ctx) {
    var user = ctx.user || {};
    var wallet = Number(user.wallet || 0);

    return `
      <style>
        /* Inline CSS to guarantee mobile responsiveness */
        .resp-wallet-page { max-width: 1200px; margin: 0 auto; padding: 0 16px 40px; }
        .resp-wallet-header { margin-bottom: 24px; }
        .resp-wallet-header h2 { font-size: clamp(22px, 5vw, 28px); margin-bottom: 6px; }
        .resp-wallet-header p { font-size: clamp(13px, 3.5vw, 15px); color: var(--text-2); }
        
        /* Wallet Hero */
        .resp-wallet-hero { 
          background: linear-gradient(135deg,#0b2545 0%,#13315c 60%,#1e3a8a 100%); 
          border-radius: 16px; padding: clamp(20px, 5vw, 32px); color: #fff; 
          margin-bottom: 24px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 20px;
          box-shadow: 0 12px 32px rgba(11,37,69,.2);
        }
        .resp-wallet-bal { font-size: clamp(28px, 8vw, 44px); font-family: 'Manrope', sans-serif; font-weight: 800; line-height: 1.1; }
        .resp-wallet-bal small { font-size: clamp(16px, 4vw, 20px); opacity: 0.8; font-weight: 600; margin-right: 4px; }
        .resp-wallet-actions { display: flex; gap: 12px; flex-wrap: wrap; width: 100%; sm: width: auto; }
        .resp-wallet-actions .btn { flex: 1; min-width: 120px; justify-content: center; }
        
        /* Panel */
        .resp-wallet-panel { background: #fff; border: 1px solid var(--border); border-radius: 16px; overflow: hidden; }
        .resp-wallet-panel-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border); }
        .resp-wallet-panel-head h3 { font-size: 15px; margin: 0; display: flex; align-items: center; gap: 8px; }
      </style>

      <div class="resp-wallet-page">
        <div class="resp-wallet-header">
          <h2>My Wallet</h2>
          <p>Manage your funds and view transaction history.</p>
        </div>

        <!-- Wallet Hero -->
        <div class="resp-wallet-hero">
          <div>
            <div style="font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; opacity: 0.7; font-weight: 700; margin-bottom: 8px;">Available Balance</div>
            <div class="resp-wallet-bal">
              <small>Fr.</small>${wallet.toLocaleString()}
            </div>
            <div style="font-size: 13px; opacity: 0.75; margin-top: 8px;">Safe, secure, and ready to use.</div>
          </div>
          <div class="resp-wallet-actions">
            <button class="btn" style="background:var(--accent);color:#fff;border:1px solid var(--accent);font-weight:700;" onclick="App.go('deposit')">
              <i class="fas fa-plus"></i> Deposit Money
            </button>
          </div>
        </div>

        <!-- Transaction List -->
        <div class="resp-wallet-panel">
          <div class="resp-wallet-panel-head">
            <h3><i class="fas fa-list" style="color:var(--accent);"></i> Transaction History</h3>
            <span style="font-size: 12px; font-weight: 600; color: var(--text-3);">${state.txns.length} records</span>
          </div>
          <div id="wallet-table-mount">
             ${renderTransactions()}
          </div>
        </div>
      </div>
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

    // Re-render the table once data arrives
    var mount = document.getElementById('wallet-table-mount');
    if (mount && !state.isLoading) {
      mount.innerHTML = renderTransactions();
    }

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