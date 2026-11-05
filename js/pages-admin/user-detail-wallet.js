/* ================================================================
   GlobalExpress — Admin User Detail: WALLET MODULE (Supabase)
   File: js/user-detail-wallet.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var esc = Utils.esc || function(s){return String(s||'');};
  var money = Utils.money || function(n){return 'Fr. '+Number(n||0).toLocaleString();};
  var fmtDate = Utils.fmtDate || function(d){return new Date(d).toLocaleDateString();};
  var fmtRelative = Utils.fmtRelative || function(d){
    var ts = Date.parse(d); if (isNaN(ts)) return '—';
    var diff = Date.now() - ts, sec = Math.floor(diff/1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec/60); if (min < 60) return min + 'm ago';
    var hr = Math.floor(min/60); if (hr < 24) return hr + 'h ago';
    return Math.floor(hr/24) + 'd ago';
  };

  global.UserDetailModules = global.UserDetailModules || {};

  // ================================================================
  // TAB: WALLET LEDGER
  // ================================================================
  global.UserDetailModules.renderTabWallet = function(state) {
    var u = state.user;
    var txns = state.walletTxns || [];

    // 1. Calculate Totals
    var totalIn = 0;
    var totalOut = 0;
    txns.forEach(function(t) {
      var amt = Number(t.amount) || 0;
      if (amt > 0) totalIn += amt;
      else if (amt < 0) totalOut += Math.abs(amt);
    });

    // 2. Top Summary Cards
    var summaryHtml = 
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-top:24px;margin-bottom:24px;">' +
        '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;">' +
          '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Current Balance</div>' +
          '<div style="font-family:Manrope,sans-serif;font-weight:800;font-size:28px;color:var(--green);">' + money(u.wallet || 0) + '</div>' +
        '</div>' +
        '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;">' +
          '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Total Credited</div>' +
          '<div style="font-family:Manrope,sans-serif;font-weight:800;font-size:28px;color:var(--text);">' + money(totalIn) + '</div>' +
        '</div>' +
        '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;">' +
          '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Total Debited</div>' +
          '<div style="font-family:Manrope,sans-serif;font-weight:800;font-size:28px;color:var(--red);">' + money(totalOut) + '</div>' +
        '</div>' +
      '</div>';

    // 3. Transaction Table
    if (txns.length === 0) {
      return summaryHtml + '<div style="padding:40px;text-align:center;color:var(--text-3);background:var(--surface);border:1px solid var(--border);border-radius:12px;">No wallet transactions recorded yet.</div>';
    }

    var rows = txns.map(function(t) {
      var isPos = Number(t.amount) >= 0;
      var amountColor = isPos ? 'var(--green)' : 'var(--red)';
      var amountSign = isPos ? '+' : '';
      
      // Badge colors
      var typeClass = t.type === 'Deposit' ? 'Delivered' : 
                      t.type === 'Withdraw' ? 'Cancelled' : 
                      t.type === 'Shipment' ? 'Pending' : 'In-Transit';

      return '<tr style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:16px 20px;">' +
          '<div style="font-weight:600;font-size:13px;">' + new Date(t.created_at).toLocaleString() + '</div>' +
          '<div style="font-size:11px;color:var(--text-3);font-family:monospace;">' + esc(t.id) + '</div>' +
        '</td>' +
        '<td><span class="pill ' + typeClass + '">' + esc(t.type) + '</span></td>' +
        '<td style="font-weight:700;color:' + amountColor + ';font-size:14px;">' + amountSign + money(t.amount) + '</td>' +
        '<td style="font-weight:600;color:var(--text);">' + money(t.balance_after) + '</td>' +
        '<td style="font-size:13px;color:var(--text-2);">' + esc(t.description || '—') + '</td>' +
      '</tr>';
    }).join('');

    var tableHtml = 
      '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow-x:auto;">' +
        '<table style="width:100%;border-collapse:collapse;text-align:left;">' +
          '<thead><tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">' +
            '<th style="padding:12px 20px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Date</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Type</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Amount</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Balance After</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Description</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>';

    return summaryHtml + tableHtml;
  };

})(window);