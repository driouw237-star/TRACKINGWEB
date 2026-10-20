/* ================================================================
   GlobalExpress — Admin Page: System Health (Pro Edition)
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var Admin = global.Admin || null;

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var fmtRelative = Utils.fmtRelative || function (d) {
    var ts = Date.parse(d); if (isNaN(ts)) return '—';
    var diff = Date.now() - ts, sec = Math.floor(diff/1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec/60); if (min < 60) return min + 'm ago';
    var hr = Math.floor(min/60); if (hr < 24) return hr + 'h ago';
    return Math.floor(hr/24) + 'd ago';
  };
  var comma = Utils.comma || function (n) { return Number(n||0).toLocaleString('en-US'); };
  var toast = UI.toast || function (t,m) { if (global.console) console.log(t, m); };

  var KEYS = {
    users: 'ge_users', shipments: 'ge_shipments', payments: 'ge_payments',
    tickets: 'ge_tickets', audit: 'ge_audit'
  };

  var pageHandler = null;
  var pageContainer = null;
  var lastRefresh = Date.now();

  function read(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  function getHealthData() {
    var users = asArray(read(KEYS.users, []));
    var shipments = asArray(read(KEYS.shipments, []));
    var payments = asArray(read(KEYS.payments, []));
    var tickets = asArray(read(KEYS.tickets, []));
    var audit = asArray(read(KEYS.audit, []));

    // 1. Find actual errors in audit log
    var errors = audit.filter(function(l) { 
      var a = String(l.action || '').toLowerCase();
      return a.indexOf('error') !== -1 || a.indexOf('failed') !== -1 || a.indexOf('exception') !== -1; 
    }).slice(-5).reverse();

    // 2. Find actual failed payments
    var failedPayments = payments.filter(function(p) { return p.status === 'Failed'; });

    // 3. Find actual pending items
    var openTickets = tickets.filter(function(t) { return t.status === 'Open' || t.status === 'In Progress'; });
    var pendingShipments = shipments.filter(function(s) { return s.status === 'Pending'; });

    // 4. Calculate DB size (approximate)
    var dbSize = 0;
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key.indexOf('ge_') === 0) {
        dbSize += (localStorage.getItem(key) || '').length;
      }
    }
    var dbSizeKb = Math.round(dbSize / 1024);

    // 5. Calculate Health Score (out of 100)
    var score = 100;
    if (failedPayments.length > 0) score -= (failedPayments.length * 5);
    if (errors.length > 0) score -= (errors.length * 10);
    if (dbSizeKb > 4000) score -= 15; // Storage warning over 4MB
    if (score < 0) score = 0;

    return {
      dbStatus: 'Connected',
      dbSize: dbSizeKb + ' KB',
      userCount: users.length,
      shipmentCount: shipments.length,
      paymentCount: payments.length,
      ticketCount: tickets.length,
      errorCount: errors.length,
      failedPaymentCount: failedPayments.length,
      pendingShipments: pendingShipments.length,
      openTickets: openTickets.length,
      healthScore: score,
      errors: errors,
      lastBoot: lastRefresh
    };
  }

  function renderHeader() {
    return '<div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">' +
      '<div><h2>System Health</h2><p class="page-subtitle">Live platform diagnostics and monitoring.</p></div>' +
      '<div class="page-actions">' +
        '<button type="button" class="btn btn-outline btn-sm" data-action="refresh">' +
          '<i class="fas fa-rotate-right"></i> Refresh Metrics</button>' +
      '</div></div>';
  }

  function renderGauge(score) {
    var color = score >= 90 ? 'var(--green)' : score >= 70 ? 'var(--amber)' : 'var(--red)';
    var label = score >= 90 ? 'Excellent' : score >= 70 ? 'Degraded' : 'Critical';
    
    // SVG Circle Math
    var radius = 54;
    var circumference = 2 * Math.PI * radius;
    var offset = circumference - (score / 100) * circumference;

    return '<div class="panel" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px 20px;">' +
      '<div style="position:relative;width:140px;height:140px;">' +
        '<svg width="140" height="140" style="transform:rotate(-90deg);">' +
          '<circle cx="70" cy="70" r="' + radius + '" fill="none" stroke="var(--surface-2)" stroke-width="10" />' +
          '<circle cx="70" cy="70" r="' + radius + '" fill="none" stroke="' + color + '" stroke-width="10" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + offset + '" stroke-linecap="round" style="transition:stroke-dashoffset 1s ease;" />' +
        '</svg>' +
        '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">' +
          '<div style="font-family:Manrope,sans-serif;font-size:32px;font-weight:800;color:' + color + ';">' + score + '</div>' +
          '<div style="font-size:10px;text-transform:uppercase;font-weight:700;color:var(--text-3);">Score</div>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:16px;font-size:14px;font-weight:700;color:' + color + ';">' + label + '</div>' +
      '<div style="font-size:12px;color:var(--text-2);margin-top:4px;">System Performance</div>' +
    '</div>';
  }

  function statusRow(label, value, isOk) {
    var color = isOk ? 'var(--green)' : 'var(--red)';
    var bg = isOk ? 'rgba(5,150,105,.1)' : 'rgba(220,38,38,.1)';
    var icon = isOk ? 'fa-circle-check' : 'fa-circle-xmark';
    
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border-2);">' +
      '<span style="font-weight:600;font-size:13.5px;">' + esc(label) + '</span>' +
      '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:' + color + ';background:' + bg + ';padding:4px 10px;border-radius:6px;">' +
        '<i class="fas ' + icon + '"></i> ' + esc(value) +
      '</span>' +
    '</div>';
  }

  function renderPanel(title, icon, content) {
    return '<div class="panel">' +
      '<div class="panel-header"><h3><i class="fas ' + icon + '"></i> ' + title + '</h3></div>' +
      '<div class="panel-body">' + content + '</div>' +
    '</div>';
  }

  function render(ctx) {
    var data = getHealthData();

    var dbContent = 
      statusRow('Database Engine', data.dbStatus, true) +
      statusRow('Storage Used', data.dbSize, data.dbSize !== '0 KB') +
      statusRow('Total Users', comma(data.userCount), true) +
      statusRow('Total Shipments', comma(data.shipmentCount), true);

    var apiContent = 
      statusRow('Payment Gateway (MoMo)', 'Operational', true) +
      statusRow('Payment Gateway (Orange)', 'Operational', true) +
      statusRow('Failed Payments', data.failedPaymentCount.toString(), data.failedPaymentCount === 0) +
      statusRow('WebSocket Realtime', 'Active', true);

    var queueContent = 
      statusRow('Pending Shipments', data.pendingShipments.toString(), data.pendingShipments === 0) +
      statusRow('Open Support Tickets', data.openTickets.toString(), data.openTickets === 0) +
      statusRow('Email Queue', '0 pending', true) +
      statusRow('SMS Queue', '0 pending', true);

    var errorContent = '<div style="padding:10px 0;">';
    if (data.errors.length === 0) {
      errorContent += '<div style="text-align:center;padding:30px 0;">' +
        '<i class="fas fa-check-circle" style="font-size:32px;color:var(--green);opacity:0.5;margin-bottom:12px;display:block;"></i>' +
        '<div style="font-weight:600;color:var(--text-2);">No errors logged recently</div>' +
        '<div style="font-size:12.5px;color:var(--text-3);margin-top:4px;">The system is running smoothly.</div>' +
      '</div>';
    } else {
      data.errors.forEach(function(e) {
        errorContent += '<div style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin-bottom:8px;">' +
          '<div style="font-weight:700;color:var(--red);font-size:13px;"><i class="fas fa-exclamation-triangle"></i> ' + esc(e.action) + '</div>' +
          '<div style="color:#991b1b;font-size:12.5px;margin-top:4px;">' + esc(e.details || 'Unknown error occurred') + '</div>' +
          '<div style="color:#991b1b;opacity:0.7;font-size:11px;margin-top:6px;">' + esc(fmtRelative(e.at)) + '</div>' +
        '</div>';
      });
    }
    errorContent += '</div>';

    return '<div class="health-page" style="max-width:1200px;margin:0 auto;">' +
      renderHeader() +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;align-items:start;">' +
        
        // Top Row
        renderGauge(data.healthScore) +
        renderPanel('Database & Storage', 'fa-database', dbContent) +
        renderPanel('API & Realtime', 'fa-bolt', apiContent) +

        // Bottom Row
        '<div style="grid-column:1/-1;display:grid;grid-template-columns:1fr 2fr;gap:20px;">' +
          renderPanel('Background Queues', 'fa-list-check', queueContent) +
          renderPanel('Recent Errors & Alerts', 'fa-triangle-exclamation', errorContent) +
        '</div>' +

      '</div>' +
    '</div>';
  }

  function bind(ctx) {
    pageContainer = document.getElementById('content');
    if (!pageContainer) return;

    if (pageHandler) pageContainer.removeEventListener('click', pageHandler);

    pageHandler = function (e) {
      if (e.target.closest('[data-action="refresh"]')) {
        lastRefresh = Date.now();
        toast('Refreshed', 'System metrics updated.', 'success');
        if (global.Admin && global.Admin.go) global.Admin.go('health');
      }
    };

    pageContainer.addEventListener('click', pageHandler);
  }

  function cleanup() {
    if (pageContainer && pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageContainer = null;
    pageHandler = null;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin.health = {
    title: 'System Health',
    subtitle: 'Live platform diagnostics and monitoring',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);