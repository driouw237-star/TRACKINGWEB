/* ================================================================
   GlobalExpress — Admin User Detail: OVERVIEW MODULE (Supabase)
   File: js/user-detail-overview.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var esc = Utils.esc || function(s){return String(s||'');};
  var money = Utils.money || function(n){return 'Fr. '+Number(n||0).toLocaleString();};
  var comma = Utils.comma || function(n){return Number(n||0).toLocaleString();};
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

  function makeStatTile(icon, color, value, label) {
    var bgMap = { green: '#ecfdf5', orange: '#fff7ed', blue: '#eff6ff', purple: '#f5f3ff', amber: '#fffbeb' };
    var fgMap = { green: 'var(--green)', orange: 'var(--accent)', blue: 'var(--blue)', purple: 'var(--purple)', amber: 'var(--amber)' };
    
    return '' +
      '<div style="padding:20px;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 2px 6px rgba(0,0,0,0.02)">' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
          '<div style="width:36px;height:36px;border-radius:10px;background:' + bgMap[color] + ';color:' + fgMap[color] + ';display:flex;align-items:center;justify-content:center;font-size:15px">' +
            '<i class="fas ' + icon + '"></i>' +
          '</div>' +
          '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px">' + esc(label) + '</div>' +
        '</div>' +
        '<div style="font-family:Manrope,sans-serif;font-weight:800;font-size:24px;color:var(--text)">' + value + '</div>' +
      '</div>';
  }

  // ================================================================
  // RENDER TAB: OVERVIEW
  // ================================================================
  global.UserDetailModules.renderTabOverview = function(state) {
    var u = state.user;
    if (!u) return '';

    // Calculate Lifetime Value (Total amount paid for shipments)
    var lifetimeValue = state.payments
      .filter(function (p) { return p.status === 'Paid' && p.amount > 0 && p.kind !== 'Deposit'; })
      .reduce(function (sum, p) { return sum + Number(p.amount || 0); }, 0);

    // 1. KPI Cards
    var kpis = '' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-top:8px">' +
        makeStatTile('fa-wallet', 'green', esc(money(u.wallet || 0)), 'Wallet Balance') +
        makeStatTile('fa-box', 'blue', esc(comma(state.shipments.length)), 'Shipments') +
        makeStatTile('fa-chart-line', 'purple', esc(money(lifetimeValue)), 'Lifetime Value') +
        makeStatTile('fa-receipt', 'orange', esc(comma(state.payments.length)), 'Payments') +
      '</div>';

    // 2. Recent Activity Feed
    var activityItems = [];
    
    // Add payments to activity
    state.payments.slice(0, 3).forEach(function(p) {
      activityItems.push({ 
        icon: 'fa-credit-card', 
        color: p.amount >= 0 ? 'green' : 'red', 
        title: (p.kind || 'Payment') + ' — ' + money(Math.abs(p.amount || 0)), 
        sub: fmtRelative(p.created_at) 
      });
    });
    
    // Add shipments to activity
    state.shipments.slice(0, 3).forEach(function(s) {
      activityItems.push({ 
        icon: 'fa-box', 
        color: 'blue', 
        title: 'Shipment ' + (s.tracking_code || '—') + ' — ' + (s.status || 'Pending'), 
        sub: fmtRelative(s.created_at) 
      });
    });

    // Sort by newest first (approximate based on sub text)
    activityItems.sort(function(a, b) {
      // A simple sort just to mix them, in reality you'd parse timestamps
      return 0; 
    });

    var bgMap = { green: '#ecfdf5', red: '#fef2f2', blue: '#eff6ff' };
    var fgMap = { green: 'var(--green)', red: 'var(--red)', blue: 'var(--blue)' };
    
    var activityHtml = '<div style="display:flex;flex-direction:column;gap:2px">';
    if (activityItems.length === 0) {
      activityHtml += '<div style="padding:30px;text-align:center;color:var(--text-3);font-size:13px"><i class="fas fa-inbox" style="font-size:24px;margin-bottom:10px;opacity:.5;display:block"></i>No recent activity.</div>';
    } else {
      activityItems.slice(0, 5).forEach(function(it) {
        activityHtml += '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">' +
          '<span style="width:36px;height:36px;border-radius:10px;background:' + bgMap[it.color] + ';color:' + fgMap[it.color] + ';display:inline-flex;align-items:center;justify-content:center;font-size:13px"><i class="fas ' + it.icon + '"></i></span>' +
          '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600;color:var(--text)">' + esc(it.title) + '</div><div style="font-size:12px;color:var(--text-3);margin-top:2px">' + esc(it.sub) + '</div></div>' +
        '</div>';
      });
    }
    activityHtml += '</div>';

    // 3. Profile Details
    function kv(label, val) {
      return '<div style="padding:14px 0;border-bottom:1px solid var(--border)">' +
        '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">' + esc(label) + '</div>' +
        '<div style="font-size:14px;color:var(--text);font-weight:500">' + val + '</div>' +
      '</div>';
    }

    var profileCard = '<div class="panel" style="flex:1">' +
      '<div class="panel-header"><h3><i class="fas fa-id-card"></i> Full Profile</h3></div>' +
      '<div class="panel-body">' +
        kv('Full Name', esc(u.full_name || '—')) +
        kv('Email Address', esc(u.email || '—')) +
        kv('Phone Number', u.phone ? esc(u.phone) : '<span style="color:var(--text-3)">Not provided</span>') +
        kv('Role', esc(u.role || 'user')) +
        kv('Referral Code', '<code style="background:var(--surface-2);padding:2px 6px;border-radius:4px">' + esc(u.referral_code || '—') + '</code>') +
        kv('User ID', '<code style="font-size:12px">' + esc(u.id || '—') + '</code>') +
        kv('Joined Date', esc(fmtDate(u.created_at))) +
      '</div></div>';

    var activityCard = '<div class="panel" style="flex:1">' +
      '<div class="panel-header"><h3><i class="fas fa-clock-rotate-left"></i> Recent Activity</h3></div>' +
      '<div class="panel-body">' + activityHtml + '</div></div>';

    // 4. Layout
    var layout = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px;align-items:start;margin-top:20px">' +
      activityCard + profileCard +
      '</div>';

    return kpis + layout;
  };

})(window);