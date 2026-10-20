/* GlobalExpress - pages/my-shipments.js */
(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var Store = global.Store || {};

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var statusCls = Utils.statusCls || function (s) { return String(s || 'Pending').replace(/\s+/g, '-'); };

  function render(ctx) {
    var user = (ctx && ctx.user) || null;
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    var ships = Store.get('shipments') || [];

    var rows = ships.map(function(s) {
      return '<tr>' +
        '<td><div class="mono">' + esc(s.trackingCode) + '</div><div class="cell-sub">' + esc(s.createdAt || '') + '</div></td>' +
        '<td style="font-size:12.5px;color:var(--text-2)">' + esc(s.originCity) + ' <i class="fas fa-arrow-right" style="font-size:9px;color:var(--accent);margin:0 4px"></i> ' + esc(s.destCity) + '</td>' +
        '<td><div style="font-weight:600">' + esc(s.receiverName) + '</div></td>' +
        '<td><span class="pill ' + esc(statusCls(s.status)) + '">' + esc(s.status) + '</span></td>' +
        '<td class="tbl-actions"><button type="button" class="btn btn-sm btn-outline" data-action="view" data-code="' + esc(s.trackingCode) + '"><i class="fas fa-eye"></i></button></td>' +
      '</tr>';
    }).join('');

    var tableHtml = ships.length 
      ? '<div class="tbl-wrap"><table class="table-cards"><thead><tr><th>Tracking Code</th><th>Route</th><th>Recipient</th><th>Status</th><th>Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty"><div class="empty-illustration"><i class="fas fa-box-open"></i></div><h4>No shipments yet</h4><p>Create your first shipment to get a tracking code.</p><button type="button" class="btn btn-primary" data-action="new"><i class="fas fa-plus"></i> Create Shipment</button></div>';

    return '<div class="panel">' +
      '<div class="panel-header">' +
        '<h3><i class="fas fa-box"></i> My Shipments</h3>' +
        '<div class="panel-tools"><button type="button" class="btn btn-sm btn-primary" data-action="new"><i class="fas fa-plus"></i> New Shipment</button></div>' +
      '</div>' +
      tableHtml +
    '</div>';
  }

  function bind(ctx) {
    var container = document.getElementById('content');
    if (!container) return;

    container.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      
      if (action === 'new') {
        if (global.App) global.App.go('create');
      } else if (action === 'view') {
        if (global.App) global.App.go('shipment', { code: btn.dataset.code });
      }
    });
  }

  var page = { title: 'My Shipments', subtitle: 'All shipments you have created', render: render, bind: bind };

  if (global.App && typeof global.App.register === 'function') global.App.register('shipments', page);
  else { global.Pages = global.Pages || {}; global.Pages.shipments = page; }

})(window);