/* ================================================================
   GlobalExpress — Admin Shipment Detail
   ================================================================
   Full view of a shipment. Allows changing status, updating location,
   and viewing sender/recipient info.
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var Admin = global.Admin || null;

  var esc   = Utils.esc   || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var fmtDT = Utils.fmtDT || function (d) { return new Date(d || Date.now()).toLocaleString(); };
  var toast = UI.toast    || function (t, m) { if (global.console) console.log(t, m); };

  var KEYS = { shipments: 'ge_shipments', users: 'ge_users' };

  var state = { shipment: null, user: null };
  var handler = null;
  var container = null;

  function read(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  function getShipmentId(ctx) {
    if (ctx && ctx.params && ctx.params.id) return String(ctx.params.id);
    return localStorage.getItem('ge_admin_current_shipment');
  }

  function loadData(shipmentId) {
    var shipments = asArray(read(KEYS.shipments, []));
    state.shipment = shipments.find(function(s) { 
      return s.id === shipmentId || s.trackingCode === shipmentId; 
    });

    if (state.shipment) {
      var users = asArray(read(KEYS.users, []));
      state.user = users.find(function(u) { return u.id === state.shipment.createdBy; });
    }
  }

  function saveShipment(patch) {
    var shipments = asArray(read(KEYS.shipments, []));
    var idx = shipments.findIndex(function(s) { return s.id === state.shipment.id || s.trackingCode === state.shipment.trackingCode; });
    if (idx === -1) return false;
    
    shipments[idx] = Object.assign({}, shipments[idx], patch);
    
    // Add to activity timeline
    if (!shipments[idx].activities) shipments[idx].activities = [];
    if (patch.status && patch.status !== state.shipment.status) {
      shipments[idx].activities.push({
        date: new Date().toISOString(),
        location: patch.currentLocation || state.shipment.currentLocation || 'System',
        description: 'Admin changed status to ' + patch.status
      });
    }

    write(KEYS.shipments, shipments);
    state.shipment = shipments[idx];
    
    if (Admin && Admin.logAudit) Admin.logAudit('shipment.update', 'shipment:' + state.shipment.trackingCode, 'Status changed to ' + (patch.status || state.shipment.status));
    return true;
  }

  function rerender() {
    if (!container) return;
    container.innerHTML = render();
    bind();
  }

  // ==== Renderers ====
  function renderHeader() {
    var s = state.shipment;
    return '<div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;margin-bottom:24px">'
      + '<div>'
      +   '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">'
      +     '<button type="button" class="btn btn-outline btn-sm" data-action="go-shipments"><i class="fas fa-arrow-left"></i> Back</button>'
      +     '<h2 style="margin:0;font-family:Manrope,sans-serif;font-weight:800;font-size:24px">' + esc(s.trackingCode) + '</h2>'
      +     '<span class="pill ' + esc((s.status||'Pending').replace(/\s+/g,'-')) + '">' + esc(s.status) + '</span>'
      +   '</div>'
      +   '<p style="margin:0;color:var(--text-2);font-size:14px">Created ' + esc(fmtDT(s.createdAt)) + '</p>'
      + '</div>'
      + '<div style="display:flex;gap:8px">'
      +   '<button type="button" class="btn btn-primary btn-sm" data-action="edit-shipment"><i class="fas fa-pen"></i> Update Status</button>'
      + '</div>'
      + '</div>';
  }

  function renderMap() {
    return '<div class="panel" style="margin-bottom:20px">'
      + '<div class="panel-header"><h3><i class="fas fa-map-location-dot"></i> Route</h3></div>'
      + '<div class="panel-body">'
      +   '<div style="display:flex;justify-content:space-between;align-items:center;padding:20px;background:var(--surface-2);border-radius:12px">'
      +     '<div style="text-align:center"><div style="font-size:12px;color:var(--text-3);margin-bottom:4px">Origin</div><div style="font-weight:700">' + esc(state.shipment.originCity) + '</div></div>'
      +     '<div style="flex:1;margin:0 20px;position:relative;height:2px;background:var(--border)">'
      +       '<div style="position:absolute;top:-4px;left:50%;transform:translateX(-50%);width:10px;height:10px;border-radius:50%;background:var(--accent)"></div>'
      +     '</div>'
      +     '<div style="text-align:center"><div style="font-size:12px;color:var(--text-3);margin-bottom:4px">Destination</div><div style="font-weight:700">' + esc(state.shipment.destCity) + '</div></div>'
      +   '</div>'
      + '</div></div>';
  }

  function renderDetails() {
    var s = state.shipment;
    var u = state.user;
    
    var customerHtml = '<div class="empty">Customer not found.</div>';
    if (u) {
      customerHtml = 
        '<div class="kv"><div class="k">Name</div><div class="v">' + esc(u.name || '—') + '</div></div>' +
        '<div class="kv"><div class="k">Email</div><div class="v">' + esc(u.email || '—') + '</div></div>' +
        '<div class="kv"><div class="k">Wallet Balance</div><div class="v" style="color:var(--green);font-weight:700">' + esc(money(u.wallet || 0)) + '</div></div>' +
        '<div style="margin-top:16px"><button type="button" class="btn btn-outline btn-sm btn-block" data-action="view-user" data-user-id="' + esc(u.id) + '"><i class="fas fa-user-shield"></i> View Customer Profile</button></div>';
    }

    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">'
      + '<div class="panel">'
      +   '<div class="panel-header"><h3><i class="fas fa-box"></i> Package Info</h3></div>'
      +   '<div class="panel-body">'
      +     '<div class="kv"><div class="k">Type</div><div class="v">' + esc(s.packageType || '—') + '</div></div>'
      +     '<div class="kv"><div class="k">Weight</div><div class="v">' + esc(s.weight || '—') + '</div></div>'
      +     '<div class="kv"><div class="k">Service</div><div class="v">' + esc(s.serviceLevel || '—') + '</div></div>'
      +     '<div class="kv"><div class="k">Estimated Delivery</div><div class="v">' + esc(s.estimatedDelivery || '—') + '</div></div>'
      +   '</div>'
      + '</div>'
      + '<div class="panel">'
      +   '<div class="panel-header"><h3><i class="fas fa-user"></i> Customer</h3></div>'
      +   '<div class="panel-body">' + customerHtml + '</div>'
      + '</div>'
      + '</div>';
  }

  function renderTimeline() {
    var acts = (state.shipment.activities || []).slice().reverse();
    var html = '<div class="panel"><div class="panel-header"><h3><i class="fas fa-clock-rotate-left"></i> Shipment Timeline</h3></div><div class="panel-body">';
    if (!acts.length) {
      html += '<p class="text-muted">No activity yet.</p>';
    } else {
      acts.forEach(function(a) {
        html += '<div style="padding:12px 0;border-bottom:1px solid var(--border-2);display:flex;gap:12px">'
          + '<div style="width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:6px;flex-shrink:0"></div>'
          + '<div>'
          +   '<div style="font-weight:600;font-size:13.5px">' + esc(a.description) + '</div>'
          +   '<div style="font-size:12px;color:var(--text-3);margin-top:2px">' + esc(a.location) + ' &middot; ' + esc(fmtDT(a.date)) + '</div>'
          + '</div>'
          + '</div>';
      });
    }
    html += '</div></div>';
    return html;
  }

  function render(ctx) {
    var id = getShipmentId(ctx);
    loadData(id);

    if (!state.shipment) {
      return '<div class="panel" style="padding:40px;text-align:center">'
        + '<h3>Shipment not found</h3>'
        + '<p class="text-muted">The tracking code could not be located.</p>'
        + '<button type="button" class="btn btn-primary" data-action="go-shipments">Back to Shipments</button>'
        + '</div>';
    }

    return '<div class="shipment-detail-page">'
      + renderHeader()
      + renderMap()
      + renderDetails()
      + renderTimeline()
      + '</div>';
  }

  // ==== Actions ====
  function handleUpdateStatus() {
    if (!UI.openModal) {
      var newStatus = prompt('Enter new status (Pending, In Transit, On Hold, Delivered, Cancelled):', state.shipment.status);
      if (newStatus) {
        saveShipment({ status: newStatus });
        toast('Status updated', '', 'success');
        rerender();
      }
      return;
    }

    var statusOptions = ['Pending', 'In Transit', 'On Hold', 'Delivered', 'Cancelled'].map(function(s) {
      return '<option value="' + s + '"' + (state.shipment.status === s ? ' selected' : '') + '>' + s + '</option>';
    }).join('');

    var modal = UI.openModal(
      '<div class="modal narrow">' +
      '<div class="modal-head"><h3>Update Shipment</h3><button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button></div>' +
      '<div class="modal-body">' +
        '<div class="field" style="margin-bottom:14px"><label>Status</label>' +
          '<select id="sdStatus">' + statusOptions + '</select>' +
        '</div>' +
        '<div class="field" style="margin-bottom:14px"><label>Current Location</label>' +
          '<input type="text" id="sdLocation" value="' + esc(state.shipment.currentLocation || '') + '" placeholder="e.g. Memphis, TN" />' +
        '</div>' +
      '</div>' +
      '<div class="modal-foot">' +
        '<button type="button" class="btn btn-outline" data-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="sdSave">Save Changes</button>' +
      '</div>' +
      '</div>'
    );
    
    if (!modal) return;

    var saveBtn = modal.querySelector('#sdSave');
    if (saveBtn) saveBtn.onclick = function() {
      var status = modal.querySelector('#sdStatus').value;
      var loc = modal.querySelector('#sdLocation').value.trim();
      saveShipment({ status: status, currentLocation: loc });
      UI.closeModal(modal);
      toast('Shipment updated', '', 'success');
      rerender();
    };
  }

  function bind() {
    container = document.getElementById('content');
    if (!container) return;
    if (handler) container.removeEventListener('click', handler);

    handler = function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      
      var action = btn.dataset.action;
      
      if (action === 'edit-shipment') {
        handleUpdateStatus();
      } else if (action === 'go-shipments') {
        if (global.Admin && Admin.go) Admin.go('shipments');
      } else if (action === 'view-user') {
        var userId = btn.dataset.userId;
        if (userId) {
          localStorage.setItem('ge_admin_current_user', userId);
          if (global.Admin && Admin.go) Admin.go('user-detail');
        }
      }
    };
    container.addEventListener('click', handler);
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null; handler = null;
    state.shipment = null; state.user = null;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin['shipment-detail'] = {
    title: 'Shipment Detail',
    subtitle: 'Manage package and status',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);