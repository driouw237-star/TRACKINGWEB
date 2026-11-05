/* ================================================================
   GlobalExpress — Admin Page: Dashboard (Supabase Edition)
   File: js/dashboard.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n||0).toLocaleString(); };
  var comma = Utils.comma || function (n) { return Number(n||0).toLocaleString('en-US'); };
  var fmtRelative = Utils.fmtRelative || function (d) {
    var ts = Date.parse(d);
    if (isNaN(ts)) return String(d || '');
    var diff = Date.now() - ts, sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec / 60); if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60); if (hr < 24) return hr + 'h ago';
    return Math.floor(hr / 24) + 'd ago';
  };

  // ================================================================
  // STATE
  // ================================================================
  var state = {
    isLoading: true,
    kpis: {
      totalUsers: 0, totalCustomers: 0, totalShipments: 0, inTransit: 0,
      totalRevenue: 0, openTickets: 0, walletLiability: 0, totalPayments: 0
    },
    chartBuckets: [],
    recentUsers: [],
    recentPayments: []
  };

  var container = null;

  // ================================================================
  // DATA FETCHING (SUPABASE LIVE QUERIES)
  // ================================================================
  async function fetchData() {
    state.isLoading = true;
    var sb = window.supabaseClient;
    if (!sb) return;

    try {
      // 1. Fetch real data from the 'app' schema
      var [usersRes, shipsRes, payRes, ticketsRes] = await Promise.all([
        sb.schema('app').from('users').select('id, full_name, email, role, wallet, created_at').order('created_at', { ascending: false }),
        sb.schema('app').from('shipments').select('id, status, created_at'),
        sb.schema('app').from('payments').select('id, amount, status, kind, method, created_at, user_id').order('created_at', { ascending: false }),
        sb.schema('app').from('tickets').select('id, status')
      ]);

      var users = usersRes.data || [];
      var ships = shipsRes.data || [];
      var payments = payRes.data || [];
      var tickets = ticketsRes.data || [];

      // 2. Compute KPIs
      var customers = users.filter(function (u) { return u.role !== 'admin' && u.role !== 'super_admin'; });
      var walletLiability = customers.reduce(function (s, u) { return s + (Number(u.wallet) || 0); }, 0);
      var totalRevenue = payments.reduce(function (s, p) {
        return p.status === 'Paid' ? s + (Number(p.amount) || 0) : s;
      }, 0);
      var openTickets = tickets.filter(function (t) { return t.status !== 'Closed'; }).length;
      var inTransit = ships.filter(function (s) { return s.status === 'In Transit'; }).length;

      state.kpis = {
        totalUsers: users.length,
        totalCustomers: customers.length,
        totalShipments: ships.length,
        inTransit: inTransit,
        totalRevenue: totalRevenue,
        openTickets: openTickets,
        walletLiability: walletLiability,
        totalPayments: payments.length
      };

      // 3. Compute Chart Buckets
      var STATUS_BUCKETS = [
        { key: 'Pending',    cls: 'amber' },
        { key: 'In Transit', cls: 'blue' },
        { key: 'On Hold',    cls: 'red' },
        { key: 'Delivered',  cls: 'green' },
        { key: 'Cancelled',  cls: 'purple' }
      ];
      var counts = {};
      STATUS_BUCKETS.forEach(function (b) { counts[b.key] = 0; });
      ships.forEach(function (s) {
        if (s.status && Object.prototype.hasOwnProperty.call(counts, s.status)) counts[s.status]++;
      });
      state.chartBuckets = STATUS_BUCKETS.map(function (b) {
        return { key: b.key, cls: b.cls, count: counts[b.key] };
      });

      // 4. Recent Users
      state.recentUsers = users.slice(0, 5).map(function(u) {
        return {
          id: u.id,
          name: u.full_name || 'Unnamed',
          email: u.email || '—',
          role: u.role,
          joined: u.created_at
        };
      });

      // 5. Recent Payments
      var userMap = {};
      users.forEach(function(u) { userMap[u.id] = u.full_name || u.email; });

      state.recentPayments = payments.slice(0, 5).map(function(p) {
        return {
          id: p.id,
          userName: userMap[p.user_id] || 'Unknown',
          userEmail: '',
          kind: p.kind,
          method: p.method,
          amount: p.amount,
          at: p.created_at
        };
      });

    } catch (err) {
      console.error('[Admin Dashboard] Fetch failed:', err);
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
  function kpiTile(opts) {
    var trend = '';
    if (opts.trend) {
      var arrow = opts.trendType === 'up' ? '<i class="fas fa-arrow-up"></i>'
                : opts.trendType === 'down' ? '<i class="fas fa-arrow-down"></i>'
                : '<i class="fas fa-circle" style="font-size:5px"></i>';
      trend = '<div class="kpi-trend ' + (opts.trendType || 'flat') + '">' + arrow + ' ' + esc(opts.trend) + '</div>';
    }
    return '' +
      '<button type="button" class="admin-kpi" data-action="go" data-view="' + esc(opts.view || '') + '"' +
        ' style="text-align:left;cursor:pointer;border:1px solid var(--border);font-family:inherit">' +
        '<div class="kpi-head">' +
          '<div class="kpi-label">' + esc(opts.label) + '</div>' +
          '<div class="kpi-icon ' + esc(opts.color) + '"><i class="fas ' + esc(opts.icon) + '"></i></div>' +
        '</div>' +
        '<div class="kpi-value">' + esc(opts.value) + '</div>' +
        trend +
      '</button>';
  }

  function chartRow(bucket, maxCount) {
    var pct = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0;
    var width = bucket.count > 0 ? Math.max(4, pct) : 0;
    return '' +
      '<button type="button" class="admin-chart-row" data-action="go-shipments-status" ' +
        'data-status="' + esc(bucket.key) + '" ' +
        'style="background:none;border:none;width:100%;text-align:left;font-family:inherit;cursor:pointer;padding:0">' +
        '<span class="label">' + esc(bucket.key) + '</span>' +
        '<span class="track"><span class="bar ' + esc(bucket.cls) + '" style="width:' + width + '%"></span></span>' +
        '<span class="count">' + esc(comma(bucket.count)) + '</span>' +
      '</button>';
  }

  function renderChart() {
    var buckets = state.chartBuckets;
    var maxCount = 1;
    buckets.forEach(function (b) { if (b.count > maxCount) maxCount = b.count; });
    return '' +
      '<div class="panel">' +
        '<div class="panel-header"><h3><i class="fas fa-chart-simple"></i> Shipments by Status</h3>' +
          '<button type="button" class="btn btn-sm btn-outline" data-action="go" data-view="shipments">' +
            'View All <i class="fas fa-arrow-right"></i></button></div>' +
        '<div class="panel-body"><div class="admin-chart">' +
          buckets.map(function (b) { return chartRow(b, maxCount); }).join('') +
        '</div></div>' +
      '</div>';
  }

  function userRow(u) {
    var initial = (u.name || u.email || 'U').charAt(0).toUpperCase();
    var isAdmin = u.role === 'admin' || u.role === 'super_admin';
    return '' +
      '<button type="button" class="dashboard-row" data-action="view-user" data-id="' + esc(u.id || '') + '" ' +
        'style="background:none;border:none;width:100%;text-align:left;font-family:inherit;cursor:pointer">' +
        '<span class="cell-user">' +
          '<span class="av">' + esc(initial) + '</span>' +
          '<span class="meta">' +
            '<span class="name">' + esc(u.name || 'Unnamed') + '</span>' +
            '<span class="email">' + esc(u.email || '—') + '</span>' +
          '</span>' +
        '</span>' +
        '<span style="margin-left:auto;display:flex;align-items:center;gap:10px">' +
          (isAdmin ? '<span class="admin-badge role-admin">Admin</span>'
                   : '<span class="admin-badge role-user">User</span>') +
          '<span style="font-size:11.5px;color:var(--text-3);white-space:nowrap">' + esc(fmtRelative(u.joined)) + '</span>' +
        '</span>' +
      '</button>';
  }

  function renderRecentUsers() {
    var users = state.recentUsers;
    var body = users.length
      ? users.map(userRow).join('')
      : '<div class="empty" style="padding:30px 20px">' +
          '<div class="empty-illustration" style="width:52px;height:52px;font-size:20px"><i class="fas fa-users"></i></div>' +
          '<h4>No users yet</h4><p>New signups will appear here.</p></div>';
    return '' +
      '<div class="panel">' +
        '<div class="panel-header"><h3><i class="fas fa-user-plus"></i> Recent Signups</h3>' +
          '<button type="button" class="btn btn-sm btn-outline" data-action="go" data-view="users">' +
            'All Users <i class="fas fa-arrow-right"></i></button></div>' +
        '<div class="panel-body flush">' + body + '</div>' +
      '</div>';
  }

  function paymentRow(p) {
    var amount = Number(p.amount) || 0;
    var positive = amount >= 0;
    var amountCls = positive ? 'positive' : 'negative';
    var sign = positive ? '+' : '';
    var kindLabel = p.kind === 'Deposit' ? 'Wallet Deposit'
                  : p.kind === 'Shipment' ? 'Shipping Fee'
                  : p.kind === 'Refund' ? 'Refund'
                  : (p.kind || '—');
    return '' +
      '<button type="button" class="dashboard-row" data-action="view-payment" data-id="' + esc(p.id || '') + '" ' +
        'style="background:none;border:none;width:100%;text-align:left;font-family:inherit;cursor:pointer">' +
        '<span style="flex:1;min-width:0">' +
          '<span style="display:block;font-weight:600;font-size:13px;color:var(--text)">' + esc(kindLabel) + '</span>' +
          '<span style="display:block;font-size:11.5px;color:var(--text-3);margin-top:2px">' +
            esc(p.userName || p.userEmail || '—') + ' · ' + esc(p.method || '—') +
          '</span>' +
        '</span>' +
        '<span style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">' +
          '<span class="tbl-amount ' + amountCls + '" style="font-weight:700;font-size:13.5px">' +
            sign + money(amount) +
          '</span>' +
          '<span style="font-size:11px;color:var(--text-3)">' + esc(fmtRelative(p.at)) + '</span>' +
        '</span>' +
      '</button>';
  }

  function renderRecentPayments() {
    var payments = state.recentPayments;
    var body = payments.length
      ? payments.map(paymentRow).join('')
      : '<div class="empty" style="padding:30px 20px">' +
          '<div class="empty-illustration" style="width:52px;height:52px;font-size:20px"><i class="fas fa-credit-card"></i></div>' +
          '<h4>No payments yet</h4><p>Deposits and shipping fees will appear here.</p></div>';
    return '' +
      '<div class="panel">' +
        '<div class="panel-header"><h3><i class="fas fa-receipt"></i> Recent Payments</h3>' +
          '<button type="button" class="btn btn-sm btn-outline" data-action="go" data-view="payments">' +
            'All Payments <i class="fas fa-arrow-right"></i></button></div>' +
        '<div class="panel-body flush">' + body + '</div>' +
      '</div>';
  }

  function renderSystemHealth() {
    var services = [
      { name: 'API Gateway',      uptime: '99.98%' },
      { name: 'Payment Rails',    uptime: '99.94%' },
      { name: 'Tracking Service', uptime: '99.99%' },
      { name: 'Notifications',    uptime: '99.92%' }
    ];
    return '' +
      '<div class="panel">' +
        '<div class="panel-header"><h3><i class="fas fa-heart-pulse"></i> System Health</h3>' +
          '<span class="admin-badge" style="background:#d1fae5;color:#065f46;border:1px solid #a7f3d0">' +
            '<i class="fas fa-circle-check" style="font-size:9px;margin-right:3px"></i> All systems operational</span>' +
        '</div>' +
        '<div class="panel-body" style="padding:16px 20px">' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">' +
            services.map(function (svc) {
              return '<div style="padding:12px 14px;border:1px solid var(--border-2);border-radius:10px;background:var(--surface-2)">' +
                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
                  '<span style="width:8px;height:8px;border-radius:50%;background:var(--green)"></span>' +
                  '<span style="font-size:13px;font-weight:600">' + esc(svc.name) + '</span>' +
                '</div>' +
                '<div style="font-size:11.5px;color:var(--text-3);display:flex;justify-content:space-between">' +
                  '<span>operational</span><span>' + esc(svc.uptime) + ' uptime</span>' +
                '</div></div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderAlertBanners() {
    var openTickets = state.kpis.openTickets;
    var onHoldBucket = state.chartBuckets.find(function(b) { return b.key === 'On Hold'; });
    var onHold = onHoldBucket ? onHoldBucket.count : 0;

    var banners = [];
    if (openTickets > 0) banners.push({
      icon: 'fa-headset', color: 'blue',
      title: openTickets + ' open support ticket' + (openTickets === 1 ? '' : 's'),
      message: 'Customers are waiting for a response.',
      action: 'go', view: 'tickets', label: 'View Tickets'
    });
    if (onHold > 0) banners.push({
      icon: 'fa-triangle-exclamation', color: 'amber',
      title: onHold + ' shipment' + (onHold === 1 ? '' : 's') + ' on hold',
      message: 'These packages are paused pending documentation.',
      action: 'go-shipments-status', status: 'On Hold', label: 'View'
    });

    if (!banners.length) return '';
    return banners.map(function (b) {
      var isAmber = b.color === 'amber';
      var borderColor = isAmber ? 'var(--amber)' : 'var(--blue)';
      var iconBg = isAmber ? '#fef3c7' : '#dbeafe';
      var iconFg = isAmber ? '#d97706' : '#2563eb';
      var attrs = 'data-action="' + esc(b.action) + '"';
      if (b.view) attrs += ' data-view="' + esc(b.view) + '"';
      if (b.status) attrs += ' data-status="' + esc(b.status) + '"';
      return '<div style="display:flex;align-items:center;gap:14px;padding:14px 18px;background:var(--surface);' +
        'border:1px solid var(--border);border-left:4px solid ' + borderColor + ';border-radius:10px;margin-bottom:14px">' +
        '<div style="width:36px;height:36px;border-radius:9px;flex-shrink:0;background:' + iconBg + ';color:' + iconFg + ';' +
          'display:inline-flex;align-items:center;justify-content:center;font-size:15px">' +
          '<i class="fas ' + esc(b.icon) + '"></i></div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;font-size:13.5px">' + esc(b.title) + '</div>' +
          '<div style="font-size:12.5px;color:var(--text-2);margin-top:2px">' + esc(b.message) + '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-sm btn-outline" ' + attrs + '>' +
          esc(b.label) + ' <i class="fas fa-arrow-right"></i></button>' +
      '</div>';
    }).join('');
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render() {
    if (state.isLoading) {
      return '<div class="panel" style="padding:60px;text-align:center;color:var(--text-3)">' +
        '<div class="spinner-ring" style="margin:0 auto 16px"></div>' +
        '<p>Loading dashboard metrics…</p>' +
      '</div>';
    }

    var kpis = state.kpis;

    var kpisHtml = '<div class="admin-kpis">' +
      kpiTile({ label:'Total Users', value: comma(kpis.totalUsers), icon:'fa-users', color:'blue',
                trend: comma(kpis.totalCustomers) + ' customers', trendType:'flat', view:'users' }) +
      kpiTile({ label:'Total Shipments', value: comma(kpis.totalShipments), icon:'fa-box', color:'orange',
                trend: comma(kpis.inTransit) + ' in transit', trendType:'flat', view:'shipments' }) +
      kpiTile({ label:'Total Revenue', value: money(kpis.totalRevenue), icon:'fa-coins', color:'green',
                trend: comma(kpis.totalPayments) + ' payments', trendType:'up', view:'payments' }) +
      kpiTile({ label:'Open Tickets', value: comma(kpis.openTickets), icon:'fa-headset', color:'amber',
                trend: kpis.openTickets === 0 ? 'All clear' : 'Needs attention',
                trendType: kpis.openTickets === 0 ? 'flat' : 'down', view:'tickets' }) +
      kpiTile({ label:'Wallet Liability', value: money(kpis.walletLiability), icon:'fa-wallet', color:'purple',
                trend:'Owed to customers', trendType:'flat', view:'wallet' }) +
    '</div>';

    var qaHtml = 
      '<div class="panel" style="margin-bottom:20px;">' +
        '<div class="panel-header"><h3><i class="fas fa-bolt" style="color:var(--accent);margin-right:6px"></i> Quick Actions</h3></div>' +
        '<div class="panel-body" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;padding:20px;">' +
          '<button type="button" class="btn btn-outline" data-action="go" data-view="users" style="justify-content:flex-start;padding:16px;font-size:14px"><i class="fas fa-users" style="color:var(--accent);margin-right:10px"></i> Manage Users</button>' +
          '<button type="button" class="btn btn-outline" data-action="go" data-view="shipments" style="justify-content:flex-start;padding:16px;font-size:14px"><i class="fas fa-box" style="color:var(--accent);margin-right:10px"></i> View Shipments</button>' +
          '<button type="button" class="btn btn-outline" data-action="go" data-view="payments" style="justify-content:flex-start;padding:16px;font-size:14px"><i class="fas fa-credit-card" style="color:var(--accent);margin-right:10px"></i> View Payments</button>' +
          '<button type="button" class="btn btn-outline" data-action="go" data-view="tickets" style="justify-content:flex-start;padding:16px;font-size:14px"><i class="fas fa-headset" style="color:var(--accent);margin-right:10px"></i> Support Tickets</button>' +
        '</div>' +
      '</div>';

    var activity = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:20px;margin-bottom:20px">' +
      renderRecentUsers() + renderRecentPayments() + '</div>';

    return renderAlertBanners() + kpisHtml + qaHtml + renderChart() + activity + renderSystemHealth();
  }

  // ================================================================
  // LIFECYCLE & BIND
  // ================================================================
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;
    if (container.__dashWired) return;
    container.__dashWired = true;

    container.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'go') {
        var view = btn.dataset.view;
        if (view && global.Admin && global.Admin.go) global.Admin.go(view);
      } else if (action === 'go-shipments-status') {
        if (global.Admin && global.Admin.go) global.Admin.go('shipments', { status: btn.dataset.status });
      } else if (action === 'view-user') {
        if (global.Admin && global.Admin.go) global.Admin.go('user-detail', { id: btn.dataset.id });
      } else if (action === 'view-payment') {
        if (global.Admin && global.Admin.go) global.Admin.go('payment-detail', { id: btn.dataset.id });
      }
    });

    if (state.isLoading) {
      fetchData();
    }
  }

  function cleanup() {
    var c = document.getElementById('content');
    if (c) c.__dashWired = false;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin.dashboard = {
    title: 'Dashboard',
    subtitle: 'Platform overview — users, shipments, revenue, and health',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);