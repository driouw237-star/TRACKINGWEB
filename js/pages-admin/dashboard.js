/* GlobalExpress - pages-admin/dashboard.js */
(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var Admin = global.Admin || null;

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };

  function render(ctx) {
    return '<div class="dashboard-page">' +
      '<div class="page-header">' +
        '<div><h2>Platform Overview</h2><p class="page-subtitle">Real-time metrics across the platform.</p></div>' +
      '</div>' +
      '<div id="admin-dash-mount" class="dashboard-loading"><i class="fas fa-circle-notch"></i> Loading platform data…</div>' +
    '</div>';
  }

  async function bind(ctx) {
    var mount = document.getElementById('admin-dash-mount');
    if (!mount || !window.supabaseClient) return;

    try {
      // 1. Fetch aggregated data from Supabase directly for the admin dashboard
      const [
        { count: totalUsers },
        { count: totalShipments },
        { data: payments },
        { data: tickets }
      ] = await Promise.all([
        window.supabaseClient.schema('app').from('users').select('*', { count: 'exact', head: true }),
        window.supabaseClient.schema('app').from('shipments').select('*', { count: 'exact', head: true }),
        window.supabaseClient.schema('app').from('payments').select('amount, status, kind'),
        window.supabaseClient.schema('app').from('tickets').select('id').eq('status', 'Open')
      ]);

      // Calculate Total Revenue (Paid payments, excluding withdrawals)
      const revenue = (payments || [])
        .filter(p => p.status === 'Paid' && p.kind !== 'Withdraw')
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const openTickets = (tickets || []).length;

      // 2. Render the KPIs
      mount.innerHTML = 
        '<div class="stats" style="margin-bottom:24px">' +
          '<div class="stat"><div class="stat-head"><div class="stat-label">Total Users</div><div class="stat-icon blue"><i class="fas fa-users"></i></div></div><div class="stat-value">' + (totalUsers || 0) + '</div></div>' +
          '<div class="stat"><div class="stat-head"><div class="stat-label">Total Shipments</div><div class="stat-icon orange"><i class="fas fa-box"></i></div></div><div class="stat-value">' + (totalShipments || 0) + '</div></div>' +
          '<div class="stat"><div class="stat-head"><div class="stat-label">Total Revenue</div><div class="stat-icon green"><i class="fas fa-coins"></i></div></div><div class="stat-value">' + money(revenue) + '</div></div>' +
          '<div class="stat"><div class="stat-head"><div class="stat-label">Open Tickets</div><div class="stat-icon red"><i class="fas fa-headset"></i></div></div><div class="stat-value">' + openTickets + '</div></div>' +
        '</div>' +

        '<div class="panel">' +
          '<div class="panel-header"><h3><i class="fas fa-bolt"></i> Quick Actions</h3></div>' +
          '<div class="panel-body">' +
            '<div class="quick-actions-grid">' +
              '<button class="quick-action" data-action="go" data-view="users"><i class="fas fa-users"></i> <span>Manage Users</span></button>' +
              '<button class="quick-action" data-action="go" data-view="shipments"><i class="fas fa-box"></i> <span>View Shipments</span></button>' +
              '<button class="quick-action" data-action="go" data-view="payments"><i class="fas fa-credit-card"></i> <span>View Payments</span></button>' +
              '<button class="quick-action" data-action="go" data-view="tickets"><i class="fas fa-headset"></i> <span>Support Tickets</span></button>' +
            '</div>' +
          '</div>' +
        '</div>';

      // Bind Quick Action buttons
      mount.querySelectorAll('[data-action="go"]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (global.Admin) global.Admin.go(btn.dataset.view);
        });
      });

    } catch (err) {
      console.error('[Admin Dashboard] Failed to load:', err);
      mount.innerHTML = '<div class="alert-banner danger"><i class="fas fa-circle-exclamation alert-icon"></i><div class="alert-body"><h4>Failed to load metrics</h4><p>' + esc(err.message) + '</p></div></div>';
    }
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin.dashboard = {
    title: 'Dashboard',
    subtitle: 'Platform overview',
    render: render,
    bind: bind
  };

})(window);