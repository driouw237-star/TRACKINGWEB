/* ================================================================
   GlobalExpress — Admin Dashboard Page
   ================================================================
   The first real page of the admin console. Self-registers into
   window.PagesAdmin.dashboard. Renders 6 KPIs, 3 charts, 4 activity
   lists, and 6 quick actions.

   Reads from localStorage keys:
     ge_users, ge_shipments, ge_payments, ge_tickets,
     ge_wallet_txns, ge_audit

   Depends on (loaded before this file):
     window.Utils, window.UI, window.Admin, window.Router

   Exposes: window.PagesAdmin.dashboard
   ================================================================ */

(function (global) {
  'use strict';

  /* ================================================================
     §1 — DEPENDENCY BINDINGS (with fallbacks)
     ================================================================ */

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var money = Utils.money || function (n) {
    var num = Number(n || 0);
    return 'Fr. ' + Math.abs(num).toLocaleString('en-US');
  };

  var comma = Utils.comma || function (n) {
    return Number(n || 0).toLocaleString('en-US');
  };

  var fmtRelative = Utils.fmtRelative || function (d) {
    try {
      var date = d instanceof Date ? d : new Date(d);
      var diff = Date.now() - date.getTime();
      var min = Math.floor(diff / 60000);
      if (min < 1) return 'just now';
      if (min < 60) return min + 'm ago';
      var hr = Math.floor(min / 60);
      if (hr < 24) return hr + 'h ago';
      var day = Math.floor(hr / 24);
      if (day < 30) return day + 'd ago';
      return date.toLocaleDateString();
    } catch (e) { return '—'; }
  };

  var fmtDate = Utils.fmtDate || function (d) {
    try {
      return new Date(d).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
    } catch (e) { return '—'; }
  };

  /* ================================================================
     §2 — STORAGE HELPERS
     ================================================================ */

  var KEYS = {
    users:         'ge_users',
    shipments:     'ge_shipments',
    payments:      'ge_payments',
    walletTxns:    'ge_wallet_txns',
    notifications: 'ge_notifications',
    tickets:       'ge_tickets',
    audit:         'ge_audit'
  };

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function asArray(v) { return Array.isArray(v) ? v : []; }

  /* ================================================================
     §3 — DATA AGGREGATION
     ================================================================
     Reads everything from localStorage and computes the numbers the
     dashboard renders. Pure — never mutates. Called once per render.
     ================================================================ */

  function computeStats() {
    var users         = asArray(read(KEYS.users, []));
    var shipments     = asArray(read(KEYS.shipments, []));
    var payments      = asArray(read(KEYS.payments, []));
    var walletTxns    = asArray(read(KEYS.walletTxns, []));
    var tickets       = asArray(read(KEYS.tickets, []));
    var audit         = asArray(read(KEYS.audit, []));

    var now = Date.now();
    var ONE_DAY = 86400000;
    var SEVEN_DAYS = 7 * ONE_DAY;
    var THIRTY_DAYS = 30 * ONE_DAY;

    // --- Users ---------------------------------------------------
    var nonAdminUsers = users.filter(function (u) { return u && u.role !== 'admin'; });
    var totalUsers    = nonAdminUsers.length;

    var newUsersWeek = nonAdminUsers.filter(function (u) {
      if (!u.joined) return false;
      var t = new Date(u.joined).getTime();
      return !isNaN(t) && (now - t) < SEVEN_DAYS;
    }).length;

    var usersWithBalance = nonAdminUsers.filter(function (u) {
      return (u.wallet || 0) > 0;
    }).length;

    // --- Shipments -----------------------------------------------
    var activeShipments = shipments.filter(function (s) {
      return s && ['Pending', 'In Transit', 'On Hold'].indexOf(s.status) !== -1;
    }).length;

    var deliveredToday = shipments.filter(function (s) {
      if (!s || s.status !== 'Delivered') return false;
      var t = s.deliveredAt ? new Date(s.deliveredAt).getTime() : 0;
      return t && (now - t) < ONE_DAY;
    }).length;

    // Status breakdown
    var statusCounts = {};
    shipments.forEach(function (s) {
      var st = (s && s.status) || 'Pending';
      statusCounts[st] = (statusCounts[st] || 0) + 1;
    });

    // --- Revenue / Payments --------------------------------------
    var paidShipmentPayments = payments.filter(function (p) {
      return p && p.status === 'Paid' && p.kind === 'Shipment';
    });

    var totalRevenue = paidShipmentPayments.reduce(function (sum, p) {
      return sum + Number(p.amount || 0);
    }, 0);

    var revenueThisMonth = paidShipmentPayments.filter(function (p) {
      var t = p.at ? new Date(p.at).getTime() : (p.date ? new Date(p.date).getTime() : 0);
      return t && (now - t) < THIRTY_DAYS;
    }).reduce(function (sum, p) { return sum + Number(p.amount || 0); }, 0);

    // Method breakdown
    var methodCounts = {};
    payments.forEach(function (p) {
      var m = (p && p.method) || 'Wallet';
      methodCounts[m] = (methodCounts[m] || 0) + 1;
    });

    // --- Wallet liability ----------------------------------------
    var walletLiability = nonAdminUsers.reduce(function (sum, u) {
      return sum + Number(u.wallet || 0);
    }, 0);

    // Wallet movement (last 30 days)
    var credits30 = 0, debits30 = 0;
    walletTxns.forEach(function (t) {
      if (!t) return;
      var tTime = t.at ? new Date(t.at).getTime()
                : (t.date ? new Date(t.date).getTime() : 0);
      if (!tTime || (now - tTime) > THIRTY_DAYS) return;
      var amt = Number(t.amount || 0);
      if (amt > 0) credits30 += amt;
      else if (amt < 0) debits30 += Math.abs(amt);
    });

    // --- Tickets -------------------------------------------------
    var openTickets = tickets.filter(function (t) {
      return t && t.status !== 'Closed' && t.status !== 'Resolved';
    });
    var urgentTickets = openTickets.filter(function (t) {
      return t.priority === 'Urgent' || t.priority === 'High';
    }).length;

    // --- System alerts -------------------------------------------
    // Failed payments in last 24h + stuck shipments
    var failedPayments24h = payments.filter(function (p) {
      if (!p || p.status !== 'Failed') return false;
      var t = p.at ? new Date(p.at).getTime() : 0;
      return t && (now - t) < ONE_DAY;
    }).length;

    var stuckShipments = shipments.filter(function (s) {
      if (!s || s.status !== 'In Transit') return false;
      var t = s.createdAt ? new Date(s.createdAt).getTime()
            : (s.created ? new Date(s.created).getTime() : 0);
      return t && (now - t) > (7 * ONE_DAY);
    }).length;

    var systemAlerts = failedPayments24h + stuckShipments;

    return {
      // Users
      totalUsers:        totalUsers,
      newUsersWeek:      newUsersWeek,
      usersWithBalance:  usersWithBalance,
      recentUsers:       nonAdminUsers.slice().sort(function (a, b) {
        return new Date(b.joined || 0).getTime() - new Date(a.joined || 0).getTime();
      }).slice(0, 5),

      // Shipments
      totalShipments:    shipments.length,
      activeShipments:   activeShipments,
      deliveredToday:    deliveredToday,
      statusCounts:      statusCounts,
      stuckShipments:    stuckShipments,

      // Revenue
      totalRevenue:      totalRevenue,
      revenueThisMonth:  revenueThisMonth,
      paidCount:         paidShipmentPayments.length,

      // Wallet
      walletLiability:   walletLiability,
      credits30:         credits30,
      debits30:          debits30,
      netFlow30:         credits30 - debits30,

      // Payments
      totalPayments:     payments.length,
      methodCounts:      methodCounts,
      recentPayments:    payments.slice().sort(function (a, b) {
        var at = a.at ? new Date(a.at).getTime() : (a.date ? new Date(a.date).getTime() : 0);
        var bt = b.at ? new Date(b.at).getTime() : (b.date ? new Date(b.date).getTime() : 0);
        return bt - at;
      }).slice(0, 10),

      // Tickets
      openTicketsCount:  openTickets.length,
      urgentTickets:     urgentTickets,

      // Audit
      recentAudit:       audit.slice(-10).reverse(),

      // Alerts
      systemAlerts:      systemAlerts,
      failedPayments24h: failedPayments24h
    };
  }

  /* ================================================================
     §4 — RENDER HELPERS
     ================================================================ */

  function initials(name) {
    var s = String(name || '?').trim();
    if (!s) return '?';
    var parts = s.split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function trendArrow(delta, suffix) {
    if (!delta && delta !== 0) return '<span class="kpi-trend flat">—</span>';
    if (delta > 0) {
      return '<span class="kpi-trend up">' +
        '<i class="fas fa-arrow-up"></i> ' + comma(delta) + (suffix || '') +
      '</span>';
    }
    return '<span class="kpi-trend down">' +
      '<i class="fas fa-arrow-down"></i> ' + comma(Math.abs(delta)) + (suffix || '') +
    '</span>';
  }

  function kpiCard(opts) {
    var iconClass = opts.iconClass || 'blue';
    return '' +
      '<div class="admin-kpi">' +
        '<div class="kpi-head">' +
          '<div class="kpi-label">' + esc(opts.label) + '</div>' +
          '<div class="kpi-icon ' + iconClass + '">' +
            '<i class="fas ' + esc(opts.icon || 'fa-chart-line') + '"></i>' +
          '</div>' +
        '</div>' +
        '<div class="kpi-value">' + opts.value + '</div>' +
        (opts.foot ? '<div>' + opts.foot + '</div>' : '') +
      '</div>';
  }

  function statusPill(status) {
    var cls = String(status || 'Pending').replace(/\s+/g, '-');
    return '<span class="pill ' + esc(cls) + '">' + esc(status || 'Pending') + '</span>';
  }

  function methodIcon(method) {
    var m = String(method || '').toLowerCase();
    if (m.indexOf('mtn') !== -1)    return 'fa-mobile-screen';
    if (m.indexOf('orange') !== -1) return 'fa-mobile-screen';
    if (m.indexOf('card') !== -1)   return 'fa-credit-card';
    if (m.indexOf('crypto') !== -1) return 'fa-bitcoin-sign';
    if (m.indexOf('wallet') !== -1) return 'fa-wallet';
    return 'fa-circle-dollar-to-slot';
  }

  /* ================================================================
     §5 — CHARTS (pure CSS + inline SVG)
     ================================================================ */

  function renderStatusChart(statusCounts) {
    var order = ['Pending', 'In Transit', 'On Hold', 'Delivered', 'Cancelled'];
    var colors = {
      'Pending':    'amber',
      'In Transit': 'blue',
      'On Hold':    'amber',
      'Delivered':  'green',
      'Cancelled':  'purple'
    };

    var total = order.reduce(function (sum, k) {
      return sum + (statusCounts[k] || 0);
    }, 0);

    if (total === 0) {
      return '' +
        '<div class="empty" style="padding:28px 12px">' +
          '<div class="empty-illustration" style="width:52px;height:52px;font-size:20px">' +
            '<i class="fas fa-chart-simple"></i>' +
          '</div>' +
          '<p style="margin:0;font-size:12.5px">No shipments yet.</p>' +
        '</div>';
    }

    return '<div class="admin-chart">' +
      order.map(function (label) {
        var count = statusCounts[label] || 0;
        var pct = total ? Math.round((count / total) * 100) : 0;
        var color = colors[label] || '';
        return '' +
          '<div class="admin-chart-row">' +
            '<div class="label">' + esc(label) + '</div>' +
            '<div class="track">' +
              '<div class="bar ' + color + '" style="width:' + pct + '%"></div>' +
            '</div>' +
            '<div class="count">' + comma(count) + '</div>' +
          '</div>';
      }).join('') +
    '</div>';
  }

  function renderMethodChart(methodCounts) {
    var order = ['MTN MoMo', 'Orange Money', 'Card', 'Crypto', 'Wallet'];
    var palette = ['#fbbf24', '#f97316', '#2563eb', '#7c3aed', '#059669'];

    // Map loosely: normalise keys and pick the closest bucket
    var buckets = { 'MTN MoMo': 0, 'Orange Money': 0, 'Card': 0, 'Crypto': 0, 'Wallet': 0 };
    Object.keys(methodCounts || {}).forEach(function (k) {
      var lower = k.toLowerCase();
      var n = methodCounts[k];
      if (lower.indexOf('mtn') !== -1) buckets['MTN MoMo'] += n;
      else if (lower.indexOf('orange') !== -1) buckets['Orange Money'] += n;
      else if (lower.indexOf('card') !== -1 || lower.indexOf('stripe') !== -1) buckets['Card'] += n;
      else if (lower.indexOf('crypto') !== -1 || lower.indexOf('btc') !== -1) buckets['Crypto'] += n;
      else buckets['Wallet'] += n;
    });

    var total = Object.keys(buckets).reduce(function (s, k) { return s + buckets[k]; }, 0);

    if (total === 0) {
      return '' +
        '<div class="empty" style="padding:28px 12px">' +
          '<div class="empty-illustration" style="width:52px;height:52px;font-size:20px">' +
            '<i class="fas fa-credit-card"></i>' +
          '</div>' +
          '<p style="margin:0;font-size:12.5px">No payments yet.</p>' +
        '</div>';
    }

    // Build the conic-gradient ring
    var stops = [];
    var cursor = 0;
    order.forEach(function (label, i) {
      var pct = (buckets[label] / total) * 100;
      if (pct <= 0) return;
      stops.push(palette[i] + ' ' + cursor + '% ' + (cursor + pct) + '%');
      cursor += pct;
    });

    return '' +
      '<div class="admin-donut">' +
        '<div class="ring" style="background:conic-gradient(' + stops.join(',') + ')"></div>' +
        '<div class="legend">' +
          order.map(function (label, i) {
            var n = buckets[label];
            if (!n) return '';
            return '' +
              '<div class="legend-row">' +
                '<span class="legend-dot" style="background:' + palette[i] + '"></span>' +
                '<span class="name">' + esc(label) + '</span>' +
                '<span class="val">' + comma(n) + '</span>' +
              '</div>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  function renderWalletChart(stats) {
    var credits = stats.credits30;
    var debits  = stats.debits30;
    var max = Math.max(credits, debits, 1);

    function bar(label, value, color) {
      var pct = Math.round((value / max) * 100);
      return '' +
        '<div class="admin-chart-row">' +
          '<div class="label">' + esc(label) + '</div>' +
          '<div class="track">' +
            '<div class="bar ' + color + '" style="width:' + pct + '%"></div>' +
          '</div>' +
          '<div class="count">' + money(value).replace('Fr. ', '') + '</div>' +
        '</div>';
    }

    return '' +
      '<div class="admin-chart">' +
        bar('Credits', credits, 'green') +
        bar('Debits',  debits,  '') +
        '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-2,#eef1f5);display:flex;justify-content:space-between;align-items:center">' +
          '<span style="font-size:12px;color:var(--text-3,#94a3b8);font-weight:600">Net (30d)</span>' +
          '<span style="font-family:Manrope,sans-serif;font-weight:800;font-size:15px;color:' +
            (stats.netFlow30 >= 0 ? 'var(--green,#059669)' : 'var(--red,#dc2626)') + '">' +
            (stats.netFlow30 >= 0 ? '+' : '−') + money(Math.abs(stats.netFlow30)).replace('Fr. ', 'Fr. ') +
          '</span>' +
        '</div>' +
      '</div>';
  }

  /* ================================================================
     §6 — ACTIVITY LISTS
     ================================================================ */

  function renderRecentUsers(users) {
    if (!users || users.length === 0) {
      return emptyRow('fa-user-plus', 'No users yet.');
    }
    return users.map(function (u) {
      var initial = initials(u.name);
      return '' +
        '<div class="dashboard-row" data-user-id="' + esc(u.id) + '" style="cursor:pointer">' +
          '<div class="cell-user" style="flex:1;min-width:0">' +
            '<span class="av">' + esc(initial) + '</span>' +
            '<div class="meta" style="min-width:0">' +
              '<div class="name">' + esc(u.name || 'Unnamed') + '</div>' +
              '<div class="email">' + esc(u.email || '') + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="font-size:11.5px;color:var(--text-3,#94a3b8);white-space:nowrap">' +
            esc(u.joined ? fmtRelative(u.joined) : '—') +
          '</div>' +
        '</div>';
    }).join('');
  }

  function renderRecentPayments(payments) {
    if (!payments || payments.length === 0) {
      return emptyRow('fa-receipt', 'No payments yet.');
    }
    return payments.map(function (p) {
      var amt = Number(p.amount || 0);
      var sign = amt >= 0 ? '+' : '−';
      var color = amt >= 0 ? 'var(--green,#059669)' : 'var(--red,#dc2626)';
      return '' +
        '<div class="dashboard-row" data-payment-id="' + esc(p.id || '') + '" style="cursor:pointer">' +
          '<div style="width:32px;height:32px;border-radius:9px;background:var(--surface-2,#fafbfc);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text-2,#475569);font-size:13px">' +
            '<i class="fas ' + methodIcon(p.method) + '"></i>' +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:600;font-size:13px;color:var(--text,#0f172a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
              esc(p.userName || p.userEmail || p.description || 'Payment') +
            '</div>' +
            '<div style="font-size:11.5px;color:var(--text-3,#94a3b8);margin-top:1px">' +
              esc(p.method || 'Wallet') + ' · ' +
              esc(p.at ? fmtRelative(p.at) : (p.date ? fmtRelative(p.date) : '—')) +
            '</div>' +
          '</div>' +
          '<div style="font-family:Manrope,sans-serif;font-weight:800;font-size:13px;color:' + color + ';white-space:nowrap">' +
            sign + money(Math.abs(amt)).replace('Fr. ', 'Fr. ') +
          '</div>' +
        '</div>';
    }).join('');
  }

  function renderRecentAudit(rows) {
    if (!rows || rows.length === 0) {
      return emptyRow('fa-clipboard-list', 'No admin activity yet.');
    }
    return rows.map(function (r) {
      var actionClass = auditTagClass(r.action);
      return '' +
        '<div class="dashboard-row" data-audit-id="' + esc(r.id || '') + '" style="cursor:pointer">' +
          '<span class="audit-action-tag ' + esc(actionClass) + '" style="flex-shrink:0">' +
            esc(shortAction(r.action)) +
          '</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:12.5px;font-weight:600;color:var(--text,#0f172a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
              esc(r.userName || 'Admin') +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-3,#94a3b8);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
              esc(r.target || '—') +
            '</div>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--text-3,#94a3b8);white-space:nowrap">' +
            esc(r.at ? fmtRelative(r.at) : '—') +
          '</div>' +
        '</div>';
    }).join('');
  }

  function emptyRow(icon, msg) {
    return '' +
      '<div style="text-align:center;padding:22px 12px;color:var(--text-3,#94a3b8);font-size:12.5px">' +
        '<i class="fas ' + icon + '" style="font-size:18px;opacity:.5;display:block;margin-bottom:6px"></i>' +
        esc(msg) +
      '</div>';
  }

  function shortAction(action) {
    if (!action) return 'ACTION';
    var s = String(action);
    // Take the part after the dot, e.g. "user.role_changed" → "ROLE CHANGED"
    var parts = s.split('.');
    var tail = parts.length > 1 ? parts[1] : parts[0];
    return tail.replace(/_/g, ' ').toUpperCase().slice(0, 20);
  }

  function auditTagClass(action) {
    if (!action) return 'default';
    var s = String(action).toLowerCase();
    if (s.indexOf('user') !== -1 && s.indexOf('create') !== -1) return 'user-create';
    if (s.indexOf('user') !== -1 && s.indexOf('delete') !== -1) return 'user-delete';
    if (s.indexOf('user') !== -1) return 'user-update';
    if (s.indexOf('shipment') !== -1) return 'shipment';
    if (s.indexOf('payment') !== -1) return 'payment';
    if (s.indexOf('wallet') !== -1) return 'wallet';
    if (s.indexOf('ticket') !== -1) return 'ticket';
    if (s.indexOf('settings') !== -1) return 'settings';
    return 'default';
  }

  function renderSystemHealth(stats) {
    var ok = stats.systemAlerts === 0;
    var alertsClass = ok ? 'green' : 'red';

    function row(label, value, tone) {
      return '' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-2,#eef1f5);font-size:12.5px">' +
          '<span style="color:var(--text-2,#475569);font-weight:600">' + esc(label) + '</span>' +
          '<span style="color:' + (tone === 'red' ? 'var(--red,#dc2626)' : tone === 'amber' ? 'var(--amber,#d97706)' : 'var(--green,#059669)') + ';font-weight:700">' +
            esc(value) +
          '</span>' +
        '</div>';
    }

    return '' +
      '<div style="display:flex;flex-direction:column;gap:2px">' +
        row('Database', 'Connected', 'green') +
        row('Realtime', 'Active', 'green') +
        row('Alerts (24h)', String(stats.systemAlerts), stats.systemAlerts > 0 ? 'red' : 'green') +
        row('Failed payments', String(stats.failedPayments24h), stats.failedPayments24h > 0 ? 'amber' : 'green') +
        row('Stuck shipments', String(stats.stuckShipments), stats.stuckShipments > 0 ? 'amber' : 'green') +
      '</div>';
  }

  /* ================================================================
     §7 — QUICK ACTIONS
     ================================================================ */

  var QUICK_ACTIONS = [
    { view: 'notifications', icon: 'fa-bullhorn',      label: 'Send Notification' },
    { view: 'shipments',     icon: 'fa-plus',          label: 'Create Shipment',   params: { action: 'new' } },
    { view: 'wallet',        icon: 'fa-sliders',       label: 'Adjust Wallet',     params: { action: 'adjust' } },
    { view: 'backup',        icon: 'fa-download',      label: 'Export Data' },
    { view: 'audit',         icon: 'fa-broom',         label: 'Audit Log' },
    { view: 'settings',      icon: 'fa-gear',          label: 'Settings' }
  ];

  function renderQuickActions() {
    return QUICK_ACTIONS.map(function (a) {
      return '' +
        '<button type="button" class="quick-action" data-view="' + esc(a.view) + '" data-params=\'' +
          JSON.stringify(a.params || {}) + '\'>' +
          '<i class="fas ' + esc(a.icon) + '"></i>' +
          '<span>' + esc(a.label) + '</span>' +
        '</button>';
    }).join('');
  }

  /* ================================================================
     §8 — MAIN RENDER
     ================================================================ */

  function render(ctx) {
    var s = computeStats();

    // ============ KPI ROW ============
    var usersFoot = s.newUsersWeek > 0
      ? '<span class="kpi-trend up"><i class="fas fa-arrow-up"></i> ' +
          comma(s.newUsersWeek) + ' this week</span>'
      : '<span class="kpi-trend flat">No new this week</span>';

    var shipmentsFoot = s.deliveredToday > 0
      ? '<span class="kpi-trend up"><i class="fas fa-check"></i> ' +
          comma(s.deliveredToday) + ' delivered today</span>'
      : '<span class="kpi-trend flat">' + comma(s.totalShipments) + ' total</span>';

    var revenueFoot = s.revenueThisMonth > 0
      ? '<span class="kpi-trend up"><i class="fas fa-arrow-up"></i> ' +
          money(s.revenueThisMonth) + ' (30d)</span>'
      : '<span class="kpi-trend flat">' + comma(s.paidCount) + ' paid</span>';

    var walletFoot = s.usersWithBalance > 0
      ? '<span class="kpi-trend flat">' + comma(s.usersWithBalance) + ' users hold balance</span>'
      : '<span class="kpi-trend flat">No balances</span>';

    var ticketsFoot = s.urgentTickets > 0
      ? '<span class="kpi-trend down"><i class="fas fa-exclamation"></i> ' +
          comma(s.urgentTickets) + ' urgent</span>'
      : '<span class="kpi-trend flat">' + comma(s.openTicketsCount) + ' open</span>';

    var alertsFoot = s.systemAlerts > 0
      ? '<span class="kpi-trend down"><i class="fas fa-triangle-exclamation"></i> ' +
          comma(s.systemAlerts) + ' alerts</span>'
      : '<span class="kpi-trend up"><i class="fas fa-check"></i> All systems healthy</span>';

    var kpis = '' +
      kpiCard({
        label: 'Total Users',
        icon: 'fa-users', iconClass: 'blue',
        value: comma(s.totalUsers),
        foot: usersFoot
      }) +
      kpiCard({
        label: 'Active Shipments',
        icon: 'fa-box', iconClass: 'orange',
        value: comma(s.activeShipments),
        foot: shipmentsFoot
      }) +
      kpiCard({
        label: 'Total Revenue',
        icon: 'fa-sack-dollar', iconClass: 'green',
        value: money(s.totalRevenue).replace('Fr. ', 'Fr. '),
        foot: revenueFoot
      }) +
      kpiCard({
        label: 'Wallet Liability',
        icon: 'fa-wallet', iconClass: 'red',
        value: money(s.walletLiability).replace('Fr. ', 'Fr. '),
        foot: walletFoot
      }) +
      kpiCard({
        label: 'Open Tickets',
        icon: 'fa-headset', iconClass: 'amber',
        value: comma(s.openTicketsCount),
        foot: ticketsFoot
      }) +
      kpiCard({
        label: 'System Alerts',
        icon: 'fa-shield-halved', iconClass: s.systemAlerts > 0 ? 'red' : 'green',
        value: comma(s.systemAlerts),
        foot: alertsFoot
      });

    // ============ CHARTS ROW ============
    var chartsRow = '' +
      '<div class="dashboard-grid">' +

        // Left column (60%)
        '<div class="dashboard-col-main">' +

          '<div class="panel">' +
            '<div class="panel-header">' +
              '<h3><i class="fas fa-chart-simple"></i> Shipments by Status</h3>' +
              '<button class="btn btn-ghost btn-sm" data-view="shipments">View all <i class="fas fa-arrow-right"></i></button>' +
            '</div>' +
            '<div class="panel-body">' + renderStatusChart(s.statusCounts) + '</div>' +
          '</div>' +

          '<div class="panel">' +
            '<div class="panel-header">' +
              '<h3><i class="fas fa-credit-card"></i> Payments by Method</h3>' +
              '<button class="btn btn-ghost btn-sm" data-view="payments">View all <i class="fas fa-arrow-right"></i></button>' +
            '</div>' +
            '<div class="panel-body">' + renderMethodChart(s.methodCounts) + '</div>' +
          '</div>' +

          '<div class="panel">' +
            '<div class="panel-header">' +
              '<h3><i class="fas fa-arrow-right-arrow-left"></i> Wallet Movement (30d)</h3>' +
            '</div>' +
            '<div class="panel-body">' + renderWalletChart(s) + '</div>' +
          '</div>' +

        '</div>' +

        // Right column (40%)
        '<div class="dashboard-col-side">' +

          '<div class="panel">' +
            '<div class="panel-header">' +
              '<h3><i class="fas fa-user-plus"></i> Recent Signups</h3>' +
              '<button class="btn btn-ghost btn-sm" data-view="users">View all</button>' +
            '</div>' +
            '<div class="panel-body flush">' + renderRecentUsers(s.recentUsers) + '</div>' +
          '</div>' +

          '<div class="panel">' +
            '<div class="panel-header">' +
              '<h3><i class="fas fa-receipt"></i> Recent Payments</h3>' +
              '<button class="btn btn-ghost btn-sm" data-view="payments">View all</button>' +
            '</div>' +
            '<div class="panel-body flush">' + renderRecentPayments(s.recentPayments) + '</div>' +
          '</div>' +

          '<div class="panel">' +
            '<div class="panel-header">' +
              '<h3><i class="fas fa-clipboard-list"></i> Recent Admin Activity</h3>' +
              '<button class="btn btn-ghost btn-sm" data-view="audit">View all</button>' +
            '</div>' +
            '<div class="panel-body flush">' + renderRecentAudit(s.recentAudit) + '</div>' +
          '</div>' +

          '<div class="panel">' +
            '<div class="panel-header">' +
              '<h3><i class="fas fa-heart-pulse"></i> System Health</h3>' +
            '</div>' +
            '<div class="panel-body">' + renderSystemHealth(s) + '</div>' +
          '</div>' +

        '</div>' +

      '</div>';

    // ============ QUICK ACTIONS ROW ============
    var quickRow = '' +
      '<div class="panel">' +
        '<div class="panel-header">' +
          '<h3><i class="fas fa-bolt"></i> Quick Actions</h3>' +
        '</div>' +
        '<div class="panel-body">' +
          '<div class="quick-actions-grid">' + renderQuickActions() + '</div>' +
        '</div>' +
      '</div>';

    return '' +
      '<div class="admin-kpis">' + kpis + '</div>' +
      chartsRow +
      quickRow;
  }

  /* ================================================================
     §9 — BIND (wire delegated clicks)
     ================================================================ */

  function bind(ctx) {
    var root = document.getElementById('content');
    if (!root) return;

    if (root.__dashWired) return;
    root.__dashWired = true;

    root.addEventListener('click', function (e) {
      var navBtn = e.target.closest('[data-view]');
      if (navBtn) {
        var view = navBtn.dataset.view;
        var params = {};
        try {
          var raw = navBtn.dataset.params;
          if (raw) params = JSON.parse(raw);
        } catch (err) { /* ignore */ }

        if (global.Admin && typeof Admin.go === 'function') {
          Admin.go(view, params);
        } else if (global.Router && Router.navigate) {
          Router.navigate(view);
        }
        return;
      }
    });
  }

  function cleanup() {
    var root = document.getElementById('content');
    if (root) root.__dashWired = false;
  }

  /* ================================================================
     §10 — REGISTER
     ================================================================ */

  global.PagesAdmin = global.PagesAdmin || {};

  global.PagesAdmin.dashboard = {
    title:    'Dashboard',
    subtitle: 'Platform overview',
    render:   render,
    bind:     bind,
    cleanup:  cleanup
  };

})(window);