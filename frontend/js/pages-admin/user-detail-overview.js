/* ================================================================
   GlobalExpress — Admin User Detail: OVERVIEW MODULE
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var esc = Utils.esc || function(s){return String(s||'');};
  var money = Utils.money || function(n){return 'Fr. '+Number(n||0).toLocaleString();};
  var comma = Utils.comma || function(n){return Number(n||0).toLocaleString();};
  var fmtDate = Utils.fmtDate || function(d){return String(d);};
  var fmtRelative = Utils.fmtRelative || function(d){return String(d);};

  global.UserDetailModules = global.UserDetailModules || {};

  function makeStatTile(icon, color, value, label) {
    var bgMap = { green: '#ecfdf5', orange: '#fff7ed', blue: '#eff6ff', purple: '#f5f3ff', amber: '#fffbeb' };
    var fgMap = { green: 'var(--green)', orange: 'var(--accent)', blue: 'var(--blue)', purple: 'var(--purple)', amber: 'var(--amber)' };
    return '' +
      '<div style="padding:20px;background:var(--surface);border:1px solid var(--adm-border);border-radius:14px;box-shadow:0 2px 6px rgba(0,0,0,0.02)">' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
          '<div style="width:36px;height:36px;border-radius:10px;background:' + bgMap[color] + ';color:' + fgMap[color] + ';display:flex;align-items:center;justify-content:center;font-size:15px">' +
            '<i class="fas ' + icon + '"></i>' +
          '</div>' +
          '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px">' + esc(label) + '</div>' +
        '</div>' +
        '<div style="font-family:Manrope,sans-serif;font-weight:800;font-size:24px;color:var(--text)">' + value + '</div>' +
      '</div>';
  }

  global.UserDetailModules.renderTabOverview = function(state) {
    var u = state.user;
    if (!u) return '';

    var lifetimeValue = state.payments
      .filter(function (p) { return p.status === 'Paid' && p.amount > 0 && p.kind !== 'Deposit'; })
      .reduce(function (sum, p) { return sum + Number(p.amount || 0); }, 0);

    var kpis = '' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-top:8px">' +
        makeStatTile('fa-wallet', 'green', esc(money(u.wallet || 0)), 'Wallet Balance') +
        makeStatTile('fa-box', 'blue', esc(comma(state.shipments.length)), 'Shipments') +
        makeStatTile('fa-chart-line', 'purple', esc(money(lifetimeValue)), 'Lifetime Value') +
        makeStatTile('fa-receipt', 'orange', esc(comma(state.payments.length)), 'Payments') +
      '</div>';

    var activityItems = [];
    state.payments.slice(0, 3).forEach(function(p) {
      activityItems.push({ icon: 'fa-credit-card', color: p.amount >= 0 ? 'green' : 'red', title: (p.kind || 'Payment') + ' — ' + money(Math.abs(p.amount || 0)), sub: fmtRelative(p.at) });
    });
    state.shipments.slice(0, 3).forEach(function(s) {
      activityItems.push({ icon: 'fa-box', color: 'blue', title: 'Shipment ' + (s.trackingCode || '—') + ' — ' + (s.status || 'Pending'), sub: fmtRelative(s.createdAt) });
    });

    var bgMap = { green: '#ecfdf5', red: '#fef2f2', blue: '#eff6ff' };
    var fgMap = { green: 'var(--green)', red: 'var(--red)', blue: 'var(--blue)' };
    
    var activityHtml = '<div style="display:flex;flex-direction:column;gap:2px">';
    if (activityItems.length === 0) {
      activityHtml += '<div style="padding:30px;text-align:center;color:var(--text-3);font-size:13px"><i class="fas fa-inbox" style="font-size:24px;margin-bottom:10px;opacity:.5;display:block"></i>No recent activity.</div>';
    } else {
      activityItems.slice(0, 5).forEach(function(it) {
        activityHtml += '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--adm-border)">' +
          '<span style="width:36px;height:36px;border-radius:10px;background:' + bgMap[it.color] + ';color:' + fgMap[it.color] + ';display:inline-flex;align-items:center;justify-content:center;font-size:13px"><i class="fas ' + it.icon + '"></i></span>' +
          '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600;color:var(--text)">' + esc(it.title) + '</div><div style="font-size:12px;color:var(--text-3);margin-top:2px">' + esc(it.sub) + '</div></div>' +
        '</div>';
      });
    }
    activityHtml += '</div>';

    var activityCard = '<div class="panel" style="flex:1">' +
      '<div class="panel-header"><h3><i class="fas fa-clock-rotate-left"></i> Recent Activity</h3></div>' +
      '<div class="panel-body">' + activityHtml + '</div></div>';

    function kv(label, val) {
      return '<div style="padding:14px 0;border-bottom:1px solid var(--adm-border)">' +
        '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">' + esc(label) + '</div>' +
        '<div style="font-size:14px;color:var(--text);font-weight:500">' + val + '</div>' +
      '</div>';
    }

    var profileCard = '<div class="panel" style="flex:1">' +
      '<div class="panel-header"><h3><i class="fas fa-id-card"></i> Full Profile</h3></div>' +
      '<div class="panel-body">' +
        kv('Full Name', esc(u.name || '—')) +
        kv('Email Address', esc(u.email || '—')) +
        kv('Phone Number', u.phone ? esc(u.phone) : '<span style="color:var(--text-3)">Not provided</span>') +
        kv('Country', u.country ? esc(u.country) : '<span style="color:var(--text-3)">Not provided</span>') +
        kv('Referral Code', '<code class="mono" style="background:var(--surface-2);padding:2px 6px;border-radius:4px">' + esc(u.referralCode || '—') + '</code>') +
        kv('User ID', '<code class="mono" style="font-size:12px">' + esc(u.id || '—') + '</code>') +
        kv('Joined Date', esc(fmtDate(u.joined))) +
      '</div></div>';

    var layout = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px;align-items:start;margin-top:20px">' +
      activityCard + profileCard +
      '</div>';

    return kpis + layout;
  };

  global.UserDetailModules.renderTabShipments = function(state) {
    if (state.shipments.length === 0) {
      return '<div class="empty" style="padding:40px;text-align:center"><i class="fas fa-box-open" style="font-size:32px;opacity:.3;margin-bottom:12px;display:block"></i><h4>No shipments yet</h4></div>';
    }
    var rows = state.shipments.map(function (s) {
      var statusCls = String(s.status || 'Pending').replace(/\s+/g, '-');
      return '<tr>' +
        '<td><code class="mono" style="font-size:12px">' + esc(s.trackingCode || '—') + '</code></td>' +
        '<td>' + esc(s.originCity || '—') + ' <i class="fas fa-arrow-right" style="font-size:9px;color:var(--text-3);margin:0 4px"></i> ' + esc(s.destCity || '—') + '</td>' +
        '<td><span class="pill ' + esc(statusCls) + '">' + esc(s.status || 'Pending') + '</span></td>' +
        '<td class="num">' + esc(money(s.amountPaid || 0)) + '</td>' +
        '<td style="color:var(--text-3);font-size:12.5px">' + esc(fmtDate(s.createdAt)) + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="tbl-wrap"><table class="table-cards"><thead><tr><th>Code</th><th>Route</th><th>Status</th><th class="num">Amount</th><th>Date</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  };

  global.UserDetailModules.renderTabPayments = function(state) {
    if (state.payments.length === 0) {
      return '<div class="empty" style="padding:40px;text-align:center"><i class="fas fa-receipt" style="font-size:32px;opacity:.3;margin-bottom:12px;display:block"></i><h4>No payments yet</h4></div>';
    }
    var rows = state.payments.map(function (p) {
      var amt = Number(p.amount) || 0;
      var pos = amt >= 0;
      return '<tr>' +
        '<td><code class="mono" style="font-size:12px">' + esc(p.id || '—') + '</code></td>' +
        '<td>' + esc(p.kind || '—') + '</td>' +
        '<td style="font-weight:700;color:' + (pos ? 'var(--green)' : 'var(--red)') + '">' + (pos ? '+' : '') + esc(money(amt)) + '</td>' +
        '<td><span class="pill ' + esc(p.status || 'Pending') + '">' + esc(p.status || '—') + '</span></td>' +
        '<td style="color:var(--text-3);font-size:12.5px">' + esc(fmtDate(p.at)) + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="tbl-wrap"><table class="table-cards"><thead><tr><th>Ref</th><th>Kind</th><th class="num">Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  };

})(window);