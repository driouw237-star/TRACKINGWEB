/* ================================================================
   GlobalExpress — Customer App: Dashboard (Supabase)
   File: js/page-dashboard.js
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

  // ================================================================
  // STATE
  // ================================================================
  var state = {
    isLoading: true,
    shipments: [],
    stats: { total: 0, transit: 0, delivered: 0 },
    user: null
  };

  var container = null;
  var handler = null;

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  async function fetchData(user) {
    state.isLoading = true;
    state.user = user;
    
    if (!window.supabaseClient) return;

    try {
      const { data: shipments, error } = await window.supabaseClient
        .schema('app')
        .from('shipments')
        .select('*')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      state.shipments = shipments || [];
      state.stats = {
        total: state.shipments.length,
        transit: state.shipments.filter(function(s) { return s.status === 'In Transit'; }).length,
        delivered: state.shipments.filter(function(s) { return s.status === 'Delivered'; }).length
      };

    } catch (err) {
      console.error('Dashboard fetch failed:', err);
    } finally {
      state.isLoading = false;
      if (container) {
        container.innerHTML = render();
      }
    }
  }

  // ================================================================
  // RENDER HELPERS
  // ================================================================
  function renderRecentShipments() {
    if (state.isLoading) {
      return '<div style="padding:40px; text-align:center; color:var(--text-3);"><i class="fas fa-circle-notch fa-spin"></i> Loading...</div>';
    }

    if (state.shipments.length === 0) {
      return '<div class="recent-empty">' +
        '<div style="font-size:32px; color:var(--border); margin-bottom:12px;"><i class="fas fa-box-open"></i></div>' +
        '<h4>No shipments yet</h4>' +
        '<p style="color:var(--text-3); font-size:13px; margin-bottom:16px;">You haven\'t sent any packages.</p>' +
        '<button class="btn btn-primary" onclick="App.go(\'create\')">Create Shipment</button>' +
      '</div>';
    }

    var html = '<div style="overflow-x:auto;"><table style="width:100%; text-align:left; border-collapse:collapse;">';
    html += '<thead><tr style="border-bottom:1px solid var(--border); color:var(--text-3); font-size:12px; text-transform:uppercase;">' +
      '<th style="padding:12px 20px;">Tracking</th>' +
      '<th style="padding:12px;">Route</th>' +
      '<th style="padding:12px;">Status</th>' +
      '<th style="padding:12px;">Date</th>' +
    '</tr></thead><tbody>';
    
    state.shipments.slice(0, 5).forEach(function(s) {
      var pCls = s.status === 'Delivered' ? 'Delivered' : 
                 s.status === 'Pending' ? 'Pending' : 
                 s.status === 'Cancelled' ? 'Cancelled' : 'In-Transit';
      
      html += '<tr style="border-bottom:1px solid var(--border); font-size:13px;">' +
        '<td style="padding:16px 20px; font-weight:700; font-family:monospace;">' + esc(s.tracking_code) + '</td>' +
        '<td>' + esc(s.origin_city) + ' &rarr; ' + esc(s.dest_city) + '</td>' +
        '<td><span class="pill ' + pCls + '">' + esc(s.status) + '</span></td>' +
        '<td style="color:var(--text-3); font-size:12px;">' + fmtRelative(s.created_at) + '</td>' +
      '</tr>';
    });
    
    html += '</tbody></table></div>';
    return html;
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render() {
    var user = state.user || {};
    var stats = state.stats;

    return `
      <div class="dash-greet">
        <h1>Good day, ${esc(user.name || 'Customer')} 👋</h1>
        <p class="sub">Here is what's happening with your shipments today.</p>
      </div>

      <!-- Wallet Hero -->
      <div class="wallet-hero">
        <div class="wallet-hero-content">
          <div>
            <div class="wallet-balance-label">Available Balance</div>
            <div class="wallet-balance-amount">
              <small>Fr.</small>${Number(user.wallet || 0).toLocaleString()}
            </div>
            <div class="wallet-balance-sub">Safe, secure, and ready to use.</div>
          </div>
          <div class="wallet-actions">
            <button class="btn deposit" onclick="App.go('deposit')"><i class="fas fa-plus"></i> Deposit</button>
            <button class="btn" onclick="App.go('create')"><i class="fas fa-truck-fast"></i> Ship Now</button>
          </div>
        </div>
      </div>

      <!-- Stats -->
      <div class="stats">
        <div class="stat">
          <div class="stat-head">
            <div class="stat-label">Total Shipments</div>
            <div class="stat-icon blue"><i class="fas fa-box"></i></div>
          </div>
          <div class="stat-value">${stats.total}</div>
        </div>
        <div class="stat">
          <div class="stat-head">
            <div class="stat-label">In Transit</div>
            <div class="stat-icon orange"><i class="fas fa-truck"></i></div>
          </div>
          <div class="stat-value">${stats.transit}</div>
        </div>
        <div class="stat">
          <div class="stat-head">
            <div class="stat-label">Delivered</div>
            <div class="stat-icon green"><i class="fas fa-check-circle"></i></div>
          </div>
          <div class="stat-value">${stats.delivered}</div>
        </div>
      </div>

      <!-- Quick Actions -->
      <h3 style="font-size:16px; margin-bottom:12px; font-weight:700;">Quick Actions</h3>
      <div class="quick-actions" style="margin-bottom:24px;">
        <button class="qa-btn" onclick="App.go('create')">
          <div class="qa-icon"><i class="fas fa-plus"></i></div>
          <h4>New Shipment</h4>
          <p>Send a package</p>
        </button>
        <button class="qa-btn" onclick="App.go('tracking')">
          <div class="qa-icon" style="background: linear-gradient(135deg, #3b82f6, #2563eb);"><i class="fas fa-location-dot"></i></div>
          <h4>Track Package</h4>
          <p>Find your item</p>
        </button>
      </div>

      <!-- Recent Shipments -->
      <div class="recent-panel">
        <div class="panel-head">
          <h3><i class="fas fa-clock-rotate-left"></i> Recent Shipments</h3>
          <button class="btn btn-sm btn-outline" onclick="App.go('shipments')">View All</button>
        </div>
        <div class="panel-body" id="recent-list">
           ${renderRecentShipments()}
        </div>
      </div>
    `;
  }

  // ================================================================
  // LIFECYCLE & BIND
  // ================================================================
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (handler) container.removeEventListener('click', handler);

    handler = function (e) {
      // We use inline onclicks for the dashboard buttons, so we don't 
      // strictly need a click handler here unless we add more complex actions later.
    };

    container.addEventListener('click', handler);

    if (state.isLoading && ctx.user) {
      fetchData(ctx.user);
    }
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler = null;
    state.isLoading = true;
    state.shipments = [];
  }

  Pages['dashboard'] = {
    title: 'Dashboard',
    subtitle: 'Welcome back to GlobalExpress',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  global.Pages = Pages;

})(window);