/* GlobalExpress - pages/dashboard.js
   Customer dashboard page module.

   Registers itself via App.register('dashboard', page).
   Uses classes from dashboard.css, tables.css, app.css.
   Reads data from Store (shipments, notifications).
   All realtime refresh is handled by app.js — this page is stateless.
*/
(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var Store = global.Store || {};

  // --- Fallbacks -----------------------------------------------------------

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };

  var money = Utils.money || function (n) {
    return 'Fr. ' + Number(n || 0).toLocaleString();
  };

  var statusCls = Utils.statusCls || function (s) {
    return String(s || 'Pending').trim().replace(/\s+/g, '-');
  };

  var toast = UI.toast || function (title, msg) {
    console.log('[toast]', title, msg || '');
  };

  // --- Helpers -------------------------------------------------------------

  function getShipments(userId) {
    var all = [];
    try { all = Store.get('shipments') || []; } catch (e) {}
    if (!userId) return all;
    return all.filter(function (s) { return s.createdBy === userId; });
  }

  function countStatus(ships, status) {
    var n = 0;
    for (var i = 0; i < ships.length; i++) {
      if (ships[i].status === status) n++;
    }
    return n;
  }

  function recentShips(ships, limit) {
    // Last N by createdAt (fallback to array order)
    var sorted = ships.slice().sort(function (a, b) {
      var da = Date.parse(a.createdAt || 0) || 0;
      var db = Date.parse(b.createdAt || 0) || 0;
      return db - da;
    });
    return sorted.slice(0, limit || 5);
  }

  // --- Stat card -----------------------------------------------------------

  function statCard(opts) {
    // opts: { icon, color, value, label, trend, trendType }
    var trendHtml = '';
    if (opts.trend) {
      var arrow = opts.trendType === 'up'   ? '<i class="fas fa-arrow-up"></i>'
                : opts.trendType === 'down' ? '<i class="fas fa-arrow-down"></i>'
                :                              '<i class="fas fa-circle" style="font-size:6px"></i>';
      trendHtml = '<div class="stat-trend ' + esc(opts.trendType || 'neutral') + '">'
                +   arrow + esc(opts.trend)
                + '</div>';
    }
    return ''
      + '<div class="stat">'
      +   '<div class="stat-head">'
      +     '<div class="stat-label">' + esc(opts.label) + '</div>'
      +     '<div class="stat-icon ' + esc(opts.color) + '"><i class="fas ' + esc(opts.icon) + '"></i></div>'
      +   '</div>'
      +   '<div class="stat-value">' + esc(opts.value) + '</div>'
      +   trendHtml
      + '</div>';
  }

  // --- Quick action tile ---------------------------------------------------

  function qaTile(opts) {
    return ''
      + '<button type="button" class="qa-btn" data-action="go" data-view="' + esc(opts.view) + '">'
      +   '<div class="qa-icon"><i class="fas ' + esc(opts.icon) + '"></i></div>'
      +   '<h4>' + esc(opts.title) + '</h4>'
      +   '<p>' + esc(opts.desc) + '</p>'
      + '</button>';
  }

  // --- Shipment row --------------------------------------------------------

  function shipRow(s) {
    return ''
      + '<tr>'
      +   '<td>'
      +     '<div class="mono">' + esc(s.trackingCode) + '</div>'
      +     '<div class="cell-sub">' + esc(s.createdAt || '') + '</div>'
      +   '</td>'
      +   '<td style="font-size:12.5px;color:var(--text-2)">'
      +     esc(s.originCity || '—')
      +     ' <i class="fas fa-arrow-right" style="font-size:9px;color:var(--accent);margin:0 4px"></i> '
      +     esc(s.destCity || '—')
      +   '</td>'
      +   '<td style="font-weight:600">' + esc(s.receiverName || '—') + '</td>'
      +   '<td><span class="pill ' + esc(statusCls(s.status)) + '">' + esc(s.status || 'Pending') + '</span></td>'
      +   '<td class="tbl-actions">'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="view" data-code="' + esc(s.trackingCode) + '" title="Details">'
      +       '<i class="fas fa-eye"></i>'
      +     '</button>'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="share" data-code="' + esc(s.trackingCode) + '" title="Share">'
      +       '<i class="fas fa-share-nodes"></i>'
      +     '</button>'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="track" data-code="' + esc(s.trackingCode) + '" title="Track">'
      +       '<i class="fas fa-location-crosshairs"></i>'
      +     '</button>'
      +   '</td>'
      + '</tr>';
  }

  // --- Empty state ---------------------------------------------------------

  function emptyRecent() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-box-open"></i></div>'
      +   '<h4>No shipments yet</h4>'
      +   '<p>Create your first shipment to get a tracking code.</p>'
      +   '<button type="button" class="btn btn-primary" data-action="go" data-view="create">'
      +     '<i class="fas fa-plus"></i> Create Shipment'
      +   '</button>'
      + '</div>';
  }

  // --- Render --------------------------------------------------------------

  function render(ctx) {
    var user = (ctx && ctx.user) || null;
    if (!user) {
      return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';
    }

    var ships = getShipments(user.id);
    var total     = ships.length;
    var inTransit = countStatus(ships, 'In Transit');
    var delivered = countStatus(ships, 'Delivered');
    var onHold    = countStatus(ships, 'On Hold');
    var recent    = recentShips(ships, 5);

    // Wallet hero
    var heroHtml = ''
      + '<div class="wallet-hero">'
      +   '<div class="wallet-hero-content">'
      +     '<div>'
      +       '<div class="wallet-balance-label">Wallet Balance</div>'
      +       '<div class="wallet-balance-amount"><small>Fr.</small>' + esc((user.wallet || 0).toLocaleString()) + '</div>'
      +       '<div class="wallet-balance-sub">Available for shipping and services</div>'
      +     '</div>'
      +     '<div class="wallet-actions">'
      +       '<button type="button" class="btn deposit" data-action="go" data-view="deposit">'
      +         '<i class="fas fa-plus"></i> Deposit'
      +       '</button>'
      +       '<button type="button" class="btn" data-action="go" data-view="withdraw">'
      +         '<i class="fas fa-arrow-up-from-bracket"></i> Withdraw'
      +       '</button>'
      +       '<button type="button" class="btn" data-action="go" data-view="wallet">'
      +         '<i class="fas fa-receipt"></i> History'
      +       '</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';

    // Stats grid
    var statsHtml = ''
      + '<div class="stats">'
      +   statCard({ icon: 'fa-box',         color: 'blue',   value: total,     label: 'Total Shipments', trend: 'Lifetime',         trendType: 'neutral' })
      +   statCard({ icon: 'fa-truck-fast',  color: 'orange', value: inTransit, label: 'In Transit',      trend: 'Live',             trendType: 'neutral' })
      +   statCard({ icon: 'fa-circle-check',color: 'green',  value: delivered, label: 'Delivered',       trend: 'Completed',        trendType: 'neutral' })
      +   statCard({ icon: 'fa-pause',       color: 'amber',  value: onHold,    label: 'On Hold',         trend: 'Needs attention',  trendType: 'neutral' })
      + '</div>';

    // Quick actions
    var qaHtml = ''
      + '<div class="panel">'
      +   '<div class="panel-header"><h3><i class="fas fa-bolt"></i> Quick Actions</h3></div>'
      +   '<div class="panel-body">'
      +     '<div class="quick-actions">'
      +       qaTile({ view: 'deposit', icon: 'fa-plus',              title: 'Deposit Money',    desc: 'Add funds to your wallet' })
      +       qaTile({ view: 'create',  icon: 'fa-truck-fast',        title: 'Create Shipment',  desc: 'Ship a package and get a code' })
      +       qaTile({ view: 'tracking',icon: 'fa-location-crosshairs',title: 'Track a Package', desc: 'Enter a code to see status' })
      +       qaTile({ view: 'invoices',icon: 'fa-file-invoice',      title: 'Invoices',         desc: 'Download your receipts' })
      +     '</div>'
      +   '</div>'
      + '</div>';

    // Alert banner
    var alertHtml = '';
    if (onHold > 0) {
      alertHtml = ''
        + '<div class="alert-banner warn">'
        +   '<i class="fas fa-triangle-exclamation alert-icon"></i>'
        +   '<div class="alert-body">'
        +     '<h4>' + onHold + ' shipment' + (onHold > 1 ? 's' : '') + ' on hold</h4>'
        +     '<p>These shipments need your attention.</p>'
        +   '</div>'
        +   '<button type="button" class="btn btn-sm btn-outline alert-action" data-action="go" data-view="shipments">'
        +     'View'
        +   '</button>'
        + '</div>';
    }

    // Recent shipments
    var recentHtml = ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-clock-rotate-left"></i> Recent Shipments</h3>'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="go" data-view="shipments">'
      +       'View All <i class="fas fa-arrow-right"></i>'
      +     '</button>'
      +   '</div>';

    if (recent.length) {
      recentHtml += ''
        + '<div class="tbl-wrap">'
        +   '<table>'
        +     '<thead>'
        +       '<tr>'
        +         '<th>Tracking Code</th>'
        +         '<th>Route</th>'
        +         '<th>Recipient</th>'
        +         '<th>Status</th>'
        +         '<th class="tbl-actions">Actions</th>'
        +       '</tr>'
        +     '</thead>'
        +     '<tbody>'
        +       recent.map(shipRow).join('')
        +     '</tbody>'
        +   '</table>'
        + '</div>';
    } else {
      recentHtml += emptyRecent();
    }

    recentHtml += '</div>';

    return heroHtml + statsHtml + qaHtml + alertHtml + recentHtml;
  }

  // --- Bind ----------------------------------------------------------------

  function bind(ctx) {
    var container = document.getElementById('content');
    if (!container) return;

    // Delegate clicks
    container.addEventListener('click', onClick);

    // Store the handler ref for cleanup
    page._handler = onClick;
    page._container = container;
  }

  function onClick(e) {
    var btn = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!btn) return;

    var action = btn.dataset.action;

    if (action === 'go') {
      var view = btn.dataset.view;
      if (view && global.App && global.App.go) {
        global.App.go(view);
      }
      return;
    }

    if (action === 'view') {
      var code = btn.dataset.code;
      if (code && global.App && global.App.go) {
        global.App.go('shipments', { code: code });
      }
      return;
    }

    if (action === 'share') {
      var code2 = btn.dataset.code;
      if (typeof global.shareShipment === 'function') {
        global.shareShipment(code2);
      } else {
        toast('Share', 'Share dialog coming soon.', 'info');
      }
      return;
    }

    if (action === 'track') {
      var code3 = btn.dataset.code;
      if (code3 && global.App && global.App.go) {
        global.App.go('tracking', { code: code3 });
      }
      return;
    }
  }

  // --- Cleanup -------------------------------------------------------------

  function cleanup() {
    if (page._container && page._handler) {
      page._container.removeEventListener('click', page._handler);
    }
    page._container = null;
    page._handler = null;
  }

  // --- Register ------------------------------------------------------------

  var page = {
    title: 'Dashboard',
    subtitle: 'Overview of your shipping activity',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('dashboard', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.dashboard = page;
  }

})(window);