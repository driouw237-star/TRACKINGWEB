/* GlobalExpress - pages-admin/dashboard.js */
(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var Admin = global.Admin || null;

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var comma = Utils.comma || function (n) { return Number(n || 0).toLocaleString('en-US'); };

  function kpiCard(label, value, icon, color) {
    return '<div class="kpi-card">' +
      '<div class="kpi-card-header">' +
        '<div class="kpi-card-label">' + esc(label) + '</div>' +
        '<div class="kpi-card-icon ' + color + '"><i class="fas ' + icon + '"></i></div>' +
      '</div>' +
      '<div class="kpi-card-value">' + value + '</div>' +
    '</div>';
  }

  function render(ctx) {
    return '<div class="dashboard-page">' +
      '<div class="page-header" style="margin-bottom:24px">' +
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
        window.supabaseClient.from('users').select('*', { count: 'exact', head: true }),
        window.supabaseClient.from('shipments').select('*', { count: 'exact', head: true }),
        window.supabaseClient.from('payments').select('amount, status, kind'),
        window.supabaseClient.from('tickets').select('id').eq('status', 'Open')
      ]);

      // Calculate Total Revenue (Paid payments, excluding withdrawals)
      const revenue = (payments || [])
        .filter(p => p.status === 'Paid' && p.kind !== 'Withdraw')
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const openTickets = (tickets || []).length;

      // 2. Render the KPIs using the Admin CSS classes
      mount.innerHTML = 
        '<div class="kpi-grid">' +
          kpiCard('Total Users', comma(totalUsers || 0), 'fa-users', 'blue') +
          kpiCard('Total Shipments', comma(totalShipments || 0), 'fa-box', 'orange') +
          kpiCard('Total Revenue', money(revenue), 'fa-coins', 'green') +
          kpiCard('Open Tickets', comma(openTickets), 'fa-headset', 'red') +
        '</div>' +

        '<div class="quick-actions-panel" style="margin-top:24px">' +
          '<div class="panel-header" style="padding:18px 22px; border-bottom:1px solid var(--border-2)"><h3><i class="fas fa-bolt"></i> Quick Actions</h3></div>' +
          '<div class="quick-actions-grid">' +
            '<button class="quick-action" data-action="go" data-view="users"><div class="quick-action-icon"><i class="fas fa-users"></i></div><div class="quick-action-content"><div class="quick-action-label">Manage Users</div></div></button>' +
            '<button class="quick-action" data-action="go" data-view="shipments"><div class="quick-action-icon"><i class="fas fa-box"></i></div><div class="quick-action-content"><div class="quick-action-label">View Shipments</div></div></button>' +
            '<button class="quick-action" data-action="go" data-view="payments"><div class="quick-action-icon"><i class="fas fa-credit-card"></i></div><div class="quick-action-content"><div class="quick-action-label">View Payments</div></div></button>' +
            '<button class="quick-action" data-action="go" data-view="tickets"><div class="quick-action-icon"><i class="fas fa-headset"></i></div><div class="quick-action-content"><div class="quick-action-label">Support Tickets</div></div></button>' +
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