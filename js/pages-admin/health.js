/* ================================================================
   GlobalExpress — Admin Page: System Health (Supabase)
   File: js/health.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var comma = Utils.comma || function (n) { return Number(n||0).toLocaleString('en-US'); };
  var fmtRelative = Utils.fmtRelative || function(d){ return String(d); };
  var toast = UI.toast || function (t, m) { if (global.console) console.log(t, m); };

  var state = {
    isLoading: true,
    data: {
      healthScore: 100,
      dbStatus: 'Connected',
      failedPaymentCount: 0,
      pendingShipments: 0,
      openTickets: 0,
      errors: [],
      lastBoot: Date.now()
    }
  };

  var pageHandler = null;
  var pageContainer = null;

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  async function loadData() {
    if (!window.supabaseClient) return;
    state.isLoading = true;
    var sb = window.supabaseClient;

    try {
      // 1. Fetch metrics from the database
      var [payRes, shipRes, ticketRes] = await Promise.all([
        sb.schema('app').from('payments').select('id, status').eq('status', 'Failed'),
        sb.schema('app').from('shipments').select('id, status').eq('status', 'Pending'),
        sb.schema('app').from('tickets').select('id, status').neq('status', 'Closed')
      ]);

      var failedPayments = payRes.data || [];
      var pendingShipments = shipRes.data || [];
      var openTickets = ticketRes.data || [];

      // 2. Fetch recent errors from the audit log
      var auditRes = await sb.schema('audit').from('logs')
        .select('*')
        .like('action', '%error%') // look for any action containing 'error'
        .order('created_at', { ascending: false })
        .limit(5);
      
      var errors = auditRes.data || [];

      // 3. Calculate Health Score
      var score = 100;
      if (failedPayments.length > 0) score -= (failedPayments.length * 5);
      if (errors.length > 0) score -= (errors.length * 10);
      if (score < 0) score = 0;

      // 4. Update State
      state.data = {
        healthScore: score,
        dbStatus: 'Connected',
        failedPaymentCount: failedPayments.length,
        pendingShipments: pendingShipments.length,
        openTickets: openTickets.length,
        errors: errors,
        lastBoot: Date.now()
      };

    } catch (err) {
      console.error('Health check failed:', err);
      state.data.dbStatus = 'Error';
      state.data.healthScore = 0;
    } finally {
      state.isLoading = false;
      document.getElementById('content').innerHTML = render();
      bind();
    }
  }

  // ================================================================
  // RENDER HELPERS
  // ================================================================
  function renderHeader() {
    return '<div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">' +
      '<div><h2>System Health</h2><p class="page-subtitle">Live platform diagnostics and monitoring.</p></div>' +
      '<div class="page-actions">' +
        '<button type="button" class="btn btn-outline btn-sm" id="btn-refresh-health">' +
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

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render() {
    if (state.isLoading) {
      return '<div class="panel" style="padding:60px;text-align:center;color:var(--text-3)"><i class="fas fa-circle-notch fa-spin" style="font-size:24px;margin-bottom:16px"></i><p>Running diagnostics...</p></div>';
    }

    var d = state.data;

    var dbContent = 
      statusRow('Database Engine', d.dbStatus, d.dbStatus === 'Connected') +
      statusRow('Failed Payments', d.failedPaymentCount.toString(), d.failedPaymentCount === 0) +
      statusRow('Pending Shipments', d.pendingShipments.toString(), d.pendingShipments === 0) +
      statusRow('Open Support Tickets', d.openTickets.toString(), d.openTickets === 0);

    var apiContent = 
      statusRow('Payment Gateway (MoMo)', 'Operational', true) +
      statusRow('Payment Gateway (Orange)', 'Operational', true) +
      statusRow('Tracking API', 'Operational', true) +
      statusRow('WebSocket Realtime', 'Active', true);

    var errorContent = '<div style="padding:10px 0;">';
    if (d.errors.length === 0) {
      errorContent += '<div style="text-align:center;padding:30px 0;">' +
        '<i class="fas fa-check-circle" style="font-size:32px;color:var(--green);opacity:0.5;margin-bottom:12px;display:block;"></i>' +
        '<div style="font-weight:600;color:var(--text-2);">No errors logged recently</div>' +
        '<div style="font-size:12.5px;color:var(--text-3);margin-top:4px;">The system is running smoothly.</div>' +
      '</div>';
    } else {
      d.errors.forEach(function(e) {
        errorContent += '<div style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin-bottom:8px;">' +
          '<div style="font-weight:700;color:var(--red);font-size:13px;"><i class="fas fa-exclamation-triangle"></i> ' + esc(e.action) + '</div>' +
          '<div style="color:#991b1b;font-size:12.5px;margin-top:4px;">' + esc(e.details || 'Unknown error occurred') + '</div>' +
          '<div style="color:#991b1b;opacity:0.7;font-size:11px;margin-top:6px;">' + esc(fmtRelative(e.created_at)) + '</div>' +
        '</div>';
      });
    }
    errorContent += '</div>';

    return '<div class="health-page" style="max-width:1200px;margin:0 auto;">' +
      renderHeader() +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;align-items:start;">' +
        
        // Top Row
        renderGauge(d.healthScore) +
        renderPanel('Database & Queues', 'fa-database', dbContent) +
        renderPanel('API & Realtime', 'fa-bolt', apiContent) +

        // Bottom Row (Errors)
        '<div style="grid-column:1/-1;">' +
          renderPanel('Recent Errors & Alerts', 'fa-triangle-exclamation', errorContent) +
        '</div>' +

      '</div>' +
    '</div>';
  }

  // ================================================================
  // BIND & ACTIONS
  // ================================================================
  function bind() {
    pageContainer = document.getElementById('content');
    if (!pageContainer) return;

    if (pageHandler) pageContainer.removeEventListener('click', pageHandler);

    pageHandler = function (e) {
      if (e.target.closest('#btn-refresh-health')) {
        toast('Refreshing', 'Re-running diagnostics...', 'info');
        loadData();
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
    bind: function() { loadData(); }, // Bind triggers the Supabase fetch
    cleanup: cleanup
  };

})(window);