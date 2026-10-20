/* GlobalExpress - pages/dashboard.js */
(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var Store = global.Store || {};

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var statusCls = Utils.statusCls || function (s) { return String(s || 'Pending').replace(/\s+/g, '-'); };

  function statCard(opts) {
    return '<div class="stat">' +
      '<div class="stat-head"><div class="stat-label">' + esc(opts.label) + '</div>' +
      '<div class="stat-icon ' + esc(opts.color) + '"><i class="fas ' + esc(opts.icon) + '"></i></div></div>' +
      '<div class="stat-value">' + esc(opts.value) + '</div>' +
      '</div>';
  }

  function qaTile(opts) {
    return '<button type="button" class="qa-btn" data-action="go" data-view="' + esc(opts.view) + '">' +
      '<div class="qa-icon"><i class="fas ' + esc(opts.icon) + '"></i></div>' +
      '<h4>' + esc(opts.title) + '</h4><p>' + esc(opts.desc) + '</p></button>';
  }

  function shipRow(s) {
    return '<tr>' +
      '<td><div class="mono">' + esc(s.trackingCode) + '</div><div class="cell-sub">' + esc(s.createdAt || '') + '</div></td>' +
      '<td style="font-size:12.5px;color:var(--text-2)">' + esc(s.originCity) + ' <i class="fas fa-arrow-right" style="font-size:9px;color:var(--accent);margin:0 4px"></i> ' + esc(s.destCity) + '</td>' +
      '<td style="font-weight:600">' + esc(s.receiverName) + '</td>' +
      '<td><span class="pill ' + esc(statusCls(s.status)) + '">' + esc(s.status) + '</span></td>' +
      '<td class="tbl-actions"><button type="button" class="btn btn-sm btn-outline" data-action="view" data-code="' + esc(s.trackingCode) + '"><i class="fas fa-eye"></i></button></td>' +
      '</tr>';
  }

  function render(ctx) {
    var user = (ctx && ctx.user) || null;
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    // Read from the Store (which was hydrated by Supabase in app.js)
    var ships = Store.get('shipments') || [];
    var total = ships.length;
    var inTransit = ships.filter(s => s.status === 'In Transit').length;
    var delivered = ships.filter(s => s.status === 'Delivered').length;
    var onHold = ships.filter(s => s.status === 'On Hold').length;
    var recent = ships.slice(0, 5);

    var heroHtml = '<div class="wallet-hero"><div class="wallet-hero-content"><div>' +
      '<div class="wallet-balance-label">Wallet Balance</div>' +
      '<div class="wallet-balance-amount"><small>Fr.</small>' + esc((user.wallet || 0).toLocaleString()) + '</div>' +
      '<div class="wallet-balance-sub">Available for shipping and services</div></div>' +
      '<div class="wallet-actions">' +
        '<button type="button" class="btn deposit" data-action="go" data-view="deposit"><i class="fas fa-plus"></i> Deposit</button>' +
        '<button type="button" class="btn" data-action="go" data-view="withdraw"><i class="fas fa-arrow-up-from-bracket"></i> Withdraw</button>' +
      '</div></div></div>';

    var statsHtml = '<div class="stats">' +
      statCard({ icon: 'fa-box', color: 'blue', value: total, label: 'Total Shipments' }) +
      statCard({ icon: 'fa-truck-fast', color: 'orange', value: inTransit, label: 'In Transit' }) +
      statCard({ icon: 'fa-circle-check', color: 'green', value: delivered, label: 'Delivered' }) +
      statCard({ icon: 'fa-pause', color: 'amber', value: onHold, label: 'On Hold' }) +
      '</div>';

    var qaHtml = '<div class="panel"><div class="panel-header"><h3><i class="fas fa-bolt"></i> Quick Actions</h3></div>' +
      '<div class="panel-body"><div class="quick-actions">' +
        qaTile({ view: 'deposit', icon: 'fa-plus', title: 'Deposit Money', desc: 'Add funds to your wallet' }) +
        qaTile({ view: 'create', icon: 'fa-truck-fast', title: 'Create Shipment', desc: 'Ship a package and get a code' }) +
        qaTile({ view: 'tracking', icon: 'fa-location-crosshairs', title: 'Track a Package', desc: 'Enter a code to see status' }) +
      '</div></div></div>';

    var recentHtml = '<div class="panel"><div class="panel-header"><h3><i class="fas fa-clock-rotate-left"></i> Recent Shipments</h3>' +
      '<button type="button" class="btn btn-sm btn-outline" data-action="go" data-view="shipments">View All</button></div>';

    if (recent.length) {
      recentHtml += '<div class="tbl-wrap"><table class="table-cards"><thead><tr><th>Code</th><th>Route</th><th>Recipient</th><th>Status</th><th></th></tr></thead><tbody>' +
        recent.map(shipRow).join('') + '</tbody></table></div>';
    } else {
      recentHtml += '<div class="empty"><div class="empty-illustration"><i class="fas fa-box-open"></i></div><h4>No shipments yet</h4>' +
        '<p>Create your first shipment to get a tracking code.</p><button type="button" class="btn btn-primary" data-action="go" data-view="create">Create Shipment</button></div>';
    }
    recentHtml += '</div>';

    return heroHtml + statsHtml + qaHtml + recentHtml;
  }

  function bind(ctx) {
    var container = document.getElementById('content');
    if (!container) return;

    container.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'go') {
        if (global.App) global.App.go(btn.dataset.view);
      } else if (action === 'view') {
        if (global.App) global.App.go('shipments', { code: btn.dataset.code });
      }
    });
  }

  var page = { title: 'Dashboard', subtitle: 'Overview of your shipping activity', render: render, bind: bind };

  if (global.App && typeof global.App.register === 'function') global.App.register('dashboard', page);
  else { global.Pages = global.Pages || {}; global.Pages.dashboard = page; }

})(window);