/* ================================================================
   GlobalExpress — Admin Shipment Detail (Full Editable)
   ================================================================
   Allows Admin to view and edit EVERY aspect of a shipment:
   Status, Package Info, Sender/Recipient Details, and Coordinates.
   ================================================================ */

(function (global) {
  'use strict';

  var Utils    = global.Utils    || {};
  var UI       = global.UI       || {};
  var Admin    = global.Admin    || null;

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var statusCls = Utils.statusCls || function (s) { return String(s || 'Pending').trim().replace(/\s+/g, '-'); };
  var fmtDT = Utils.fmtDT || function (d) { return new Date(d || Date.now()).toLocaleString(); };

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  var openModal = UI.openModal || function () { return null; };
  var closeModal = UI.closeModal || function () {};

  var STATUSES = ['Pending', 'In Transit', 'On Hold', 'Delivered', 'Cancelled'];
  var PACKAGE_TYPES = ['Standard Box', 'Envelope / Document', 'Pallet', 'Fragile Item', 'Electronics', 'Other'];
  var HANDLING_OPTIONS = ['None', 'Fragile', 'Perishable', 'Signature Required', 'Leave at Door'];
  var SERVICE_LEVELS = ['Economy — 7–10 days', 'Standard — 4–6 days', 'Express — 2–3 days', 'Overnight — next day'];

  var code = null;
  var activeTab = 'details'; // details | status | package | parties | timeline
  var mapInstance = null;
  var handler = null;
  var container = null;
  var mounted = false;

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

  function findShip(c) {
    if (!c) return null;
    var all = asArray(read('ge_shipments', []));
    var up = String(c).toUpperCase();
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].id || '').toUpperCase() === up || String(all[i].trackingCode || '').toUpperCase() === up) return all[i];
    }
    return null;
  }

  function render404(c) {
    return '<div class="panel"><div class="panel-body" style="text-align:center;padding:60px 24px">'
      + '<div style="width:80px;height:80px;border-radius:50%;background:var(--surface-2);display:inline-flex;align-items:center;justify-content:center;font-size:32px;color:var(--text-3);margin-bottom:16px"><i class="fas fa-box-open"></i></div>'
      + '<h2 style="font-size:18px;margin:0 0 8px">Shipment not found</h2>'
      + '<p style="color:var(--text-2);font-size:14px;margin-bottom:20px">No shipment matches <strong>' + esc(c || '—') + '</strong>.</p>'
      + '<button type="button" class="btn btn-primary" data-action="go-shipments"><i class="fas fa-box"></i> Back to Shipments</button>'
      + '</div></div>';
  }

  function statusHero(s) {
    var cls = statusCls(s.status);
    return '<div class="status-banner ' + esc(cls) + '" style="margin-bottom:22px;background:linear-gradient(135deg,var(--adm-surface),var(--surface-2));border:1px solid var(--adm-border);border-radius:16px;padding:24px;color:var(--text)">'
      + '<div class="status-inner" style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap">'
      +   '<div style="flex:1;min-width:260px">'
      +     '<div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:800;color:var(--text-3);margin-bottom:6px">Tracking Status</div>'
      +     '<div style="font-family:\'Manrope\',sans-serif;font-size:28px;font-weight:800;color:var(--text);letter-spacing:-.02em;line-height:1.15;display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
      +       esc(s.status)
      +       '<span style="font-family:\'Monaco\',monospace;font-size:15px;font-weight:600;background:var(--surface);padding:6px 12px;border-radius:8px;letter-spacing:1.2px;border:1px solid var(--border)">' + esc(s.trackingCode) + '</span>'
      +     '</div>'
      +     '<div style="display:flex;align-items:center;gap:10px;margin-top:14px;font-size:14.5px;font-weight:600;color:var(--text-2);flex-wrap:wrap">'
      +       '<span>' + esc(s.originCity || '—') + '</span><span><i class="fas fa-arrow-right" style="font-size:10px"></i></span><span>' + esc(s.destCity || '—') + '</span>'
      +     '</div>'
      +   '</div>'
      +   '<div style="text-align:right;flex-shrink:0">'
      +     '<div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;font-weight:800;color:var(--text-3);margin-bottom:6px">Estimated Delivery</div>'
      +     '<div style="font-family:\'Manrope\',sans-serif;font-size:19px;font-weight:800;color:var(--text)">' + esc(s.estimatedDelivery || 'TBD') + '</div>'
      +     '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;flex-wrap:wrap">'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="go-shipments"><i class="fas fa-arrow-left"></i> Back</button>'
      +     '</div>'
      +   '</div>'
      + '</div></div>';
  }

  function progressBlock(s) {
    var steps = [
      { label: 'Processed', icon: 'fa-clipboard-check', state: 'done' },
      { label: 'Picked Up', icon: 'fa-box', state: 'done' },
      { label: 'In Transit', icon: 'fa-truck', state: s.status === 'In Transit' ? 'active' : (s.status === 'Pending' ? 'pending' : 'done') },
      { label: 'Delivered', icon: 'fa-circle-check', state: s.status === 'Delivered' ? 'done' : 'pending' }
    ];
    return '<div class="panel" style="margin-bottom:22px"><div class="panel-body">'
      + '<div style="font-size:14px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:10px;margin-bottom:22px"><i class="fas fa-route" style="color:var(--accent)"></i> Delivery Progress</div>'
      + '<div class="steps" style="position:relative">'
      +   steps.map(function (st) {
            return '<div class="step ' + st.state + '"><div class="step-icon"><i class="fas ' + st.icon + '"></i></div><div class="step-label">' + esc(st.label) + '</div></div>';
          }).join('')
      + '</div></div></div>';
  }

  function mapBlock() {
    return '<div class="panel" style="margin-bottom:22px">'
      + '<div class="panel-header"><h3><i class="fas fa-map-location-dot"></i> Live Map</h3></div>'
      + '<div class="panel-body"><div id="detailMap" style="width:100%;height:380px;border-radius:12px;border:1px solid var(--border);background:#e5e7eb"></div></div>'
      + '</div>';
  }

  function tabsBlock() {
    var defs = [
      { key: 'details',  label: 'Overview' },
      { key: 'status',   label: 'Update Status' },
      { key: 'package',  label: 'Package Info' },
      { key: 'parties',  label: 'Sender / Receiver' },
      { key: 'timeline', label: 'Timeline' }
    ];
    return '<div class="panel" style="margin-bottom:22px"><div class="panel-body">'
      + '<div class="tabs" style="display:flex;gap:20px;border-bottom:1.5px solid var(--border);margin-bottom:20px;overflow-x:auto;white-space:nowrap;">'
      +   defs.map(function (d) {
            return '<button type="button" class="tab' + (activeTab === d.key ? ' active' : '') + '" data-tab="' + d.key + '" style="background:none;border:none;padding:0 0 12px;font-family:inherit;font-weight:600;font-size:14px;color:' + (activeTab === d.key ? 'var(--brand)' : 'var(--text-3)') + ';border-bottom:2.5px solid ' + (activeTab === d.key ? 'var(--accent)' : 'transparent') + ';margin-bottom:-1.5px;cursor:pointer">' + esc(d.label) + '</button>';
          }).join('')
      + '</div><div id="tabPanel"></div></div></div>';
  }

  // --- Tab Renderers ---

  function renderDetailsTab(s) {
    return '<div class="form-section" style="padding:0;border:none">'
      + '<div class="summary" style="margin-bottom:16px">'
      +   summaryRow('Current Location', esc(s.currentLocation || '—'))
      +   summaryRow('Service Level', esc(s.serviceLevel || '—'))
      +   summaryRow('Amount Paid', money(s.amountPaid || 0))
      + '</div>'
      + '<div class="grid-2" style="gap:12px">'
      +   kv('Type', esc(s.packageType || '—')) + kv('Weight', esc(s.weight || '—'))
      +   kv('Insured', s.insured ? 'Yes' : 'No')
      +   (s.contents ? '<div class="kv" style="grid-column:1/-1"><div class="k">Contents</div><div class="v">' + esc(s.contents) + '</div></div>' : '')
      + '</div></div>';
  }

  function renderStatusTab(s) {
    return '<div class="grid-2" style="gap:14px">'
      + '<div class="field"><label>Status</label><select id="ed_status">'
      + STATUSES.map(function (v) { return '<option ' + (s.status === v ? 'selected' : '') + '>' + esc(v) + '</option>'; }).join('')
      + '</select></div>'
      + '<div class="field"><label>Current Location</label><input type="text" id="ed_current" value="' + esc(s.currentLocation || '') + '" placeholder="e.g. Memphis, TN" /></div>'
      + '<div class="field"><label>Estimated Delivery</label><input type="text" id="ed_eta" value="' + esc(s.estimatedDelivery || '') + '" placeholder="e.g. Oct 5, 2026" /></div>'
      + '<div class="field"><label>Add Timeline Note (Optional)</label><input type="text" id="ed_note" placeholder="e.g. Departed sorting facility" /></div>'
      + '</div>'
      + '<div style="display:flex;justify-content:flex-end;margin-top:18px;padding-top:18px;border-top:1px solid var(--border-2)">'
      + '<button type="button" class="btn btn-primary" data-action="save-status"><i class="fas fa-save"></i> Save Status</button>'
      + '</div>';
  }

  function renderPackageTab(s) {
    return '<div class="grid-2" style="gap:14px">'
      + '<div class="field"><label>Package Type</label><select id="ed_pkgtype">'
      + PACKAGE_TYPES.map(function (v) { return '<option ' + (s.packageType === v ? 'selected' : '') + '>' + esc(v) + '</option>'; }).join('')
      + '</select></div>'
      + '<div class="field"><label>Service Level</label><select id="ed_service">'
      + SERVICE_LEVELS.map(function (v) { return '<option ' + (s.serviceLevel === v ? 'selected' : '') + '>' + esc(v) + '</option>'; }).join('')
      + '</select></div>'
      + '<div class="field"><label>Weight</label><input type="text" id="ed_weight" value="' + esc(s.weight || '') + '" /></div>'
      + '<div class="field"><label>Dimensions</label><input type="text" id="ed_dims" value="' + esc(s.dimensions || '') + '" /></div>'
      + '<div class="field"><label>Handling</label><select id="ed_handling">'
      + HANDLING_OPTIONS.map(function (v) { return '<option ' + (s.handling === v ? 'selected' : '') + '>' + esc(v) + '</option>'; }).join('')
      + '</select></div>'
      + '<div class="field full" style="grid-column:1/-1"><label>Contents</label><input type="text" id="ed_contents" value="' + esc(s.contents || '') + '" /></div>'
      + '</div>'
      + '<div style="display:flex;justify-content:flex-end;margin-top:18px;padding-top:18px;border-top:1px solid var(--border-2)">'
      + '<button type="button" class="btn btn-primary" data-action="save-package"><i class="fas fa-save"></i> Save Package</button>'
      + '</div>';
  }

  function renderPartiesTab(s) {
    return '<div class="grid-2" style="gap:14px">'
      + '<div class="field full" style="grid-column:1/-1;border-bottom:1px solid var(--border-2);padding-bottom:10px"><label style="font-size:14px;color:var(--brand)"><i class="fas fa-store"></i> Sender Details</label></div>'
      + '<div class="field"><label>Name</label><input type="text" id="ed_senderName" value="' + esc(s.senderName || '') + '" /></div>'
      + '<div class="field"><label>Company</label><input type="text" id="ed_senderCompany" value="' + esc(s.senderCompany || '') + '" /></div>'
      + '<div class="field"><label>Email</label><input type="email" id="ed_senderEmail" value="' + esc(s.senderEmail || '') + '" /></div>'
      + '<div class="field"><label>Phone</label><input type="text" id="ed_senderPhone" value="' + esc(s.senderPhone || '') + '" /></div>'
      + '<div class="field full" style="grid-column:1/-1"><label>Address</label><input type="text" id="ed_senderAddress" value="' + esc(s.senderAddress || '') + '" /></div>'
      
      + '<div class="field full" style="grid-column:1/-1;border-bottom:1px solid var(--border-2);padding-bottom:10px;margin-top:16px"><label style="font-size:14px;color:var(--brand)"><i class="fas fa-user"></i> Recipient Details</label></div>'
      + '<div class="field"><label>Name</label><input type="text" id="ed_receiverName" value="' + esc(s.receiverName || '') + '" /></div>'
      + '<div class="field"><label>Company</label><input type="text" id="ed_receiverCompany" value="' + esc(s.receiverCompany || '') + '" /></div>'
      + '<div class="field"><label>Email</label><input type="email" id="ed_receiverEmail" value="' + esc(s.receiverEmail || '') + '" /></div>'
      + '<div class="field"><label>Phone</label><input type="text" id="ed_receiverPhone" value="' + esc(s.receiverPhone || '') + '" /></div>'
      + '<div class="field full" style="grid-column:1/-1"><label>Address</label><input type="text" id="ed_receiverAddress" value="' + esc(s.receiverAddress || '') + '" /></div>'
      + '</div>'
      + '<div style="display:flex;justify-content:flex-end;margin-top:18px;padding-top:18px;border-top:1px solid var(--border-2)">'
      + '<button type="button" class="btn btn-primary" data-action="save-parties"><i class="fas fa-save"></i> Save Contacts</button>'
      + '</div>';
  }

  function renderTimelineTab(s) {
    var acts = (s.activities || []).slice().reverse();
    if (!acts.length) return '<p style="color:var(--text-3);font-size:13px;text-align:center;padding:20px">No activity yet.</p>';
    return '<div class="timeline">'
      + acts.map(function (a, i) {
          return '<div class="tl-item ' + (i === 0 ? 'latest' : 'done') + '"><div class="tl-dot"></div><div class="tl-date">' + esc(a.date) + '</div><div class="tl-loc">' + esc(a.location) + '</div><div class="tl-desc">' + esc(a.description) + '</div></div>';
        }).join('')
      + '</div>';
  }

  function summaryRow(label, val) {
    return '<div class="summary-row"><span class="lbl">' + esc(label) + '</span><span class="val">' + val + '</span></div>';
  }
  function kv(label, val) {
    return '<div class="kv"><div class="k">' + esc(label) + '</div><div class="v">' + val + '</div></div>';
  }

  function renderTabPanel(s) {
    if (activeTab === 'status') return renderStatusTab(s);
    if (activeTab === 'package') return renderPackageTab(s);
    if (activeTab === 'parties') return renderPartiesTab(s);
    if (activeTab === 'timeline') return renderTimelineTab(s);
    return renderDetailsTab(s);
  }

  function rerenderTabs(s) {
    var tabs = document.querySelectorAll('[data-tab]');
    tabs.forEach(function (t) {
      var isActive = t.dataset.tab === activeTab;
      t.classList.toggle('active', isActive);
      t.style.color = isActive ? 'var(--brand)' : 'var(--text-3)';
      t.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
    });
    var panel = document.getElementById('tabPanel');
    if (panel) panel.innerHTML = renderTabPanel(s);
  }

  function senderCard(s) {
    return '<div class="panel" style="margin-bottom:22px"><div class="panel-header"><h3><i class="fas fa-store"></i> Sender</h3></div><div class="panel-body">'
      + '<div class="kv"><div class="k">Name</div><div class="v">' + esc(s.senderName || '—') + '</div></div>'
      + (s.senderAddress ? '<div class="kv"><div class="k">Address</div><div class="v">' + esc(s.senderAddress) + '</div></div>' : '')
      + '</div></div>';
  }

  function recipientCard(s) {
    return '<div class="panel" style="margin-bottom:22px"><div class="panel-header"><h3><i class="fas fa-user"></i> Recipient</h3></div><div class="panel-body">'
      + '<div class="kv"><div class="k">Name</div><div class="v">' + esc(s.receiverName || '—') + '</div></div>'
      + (s.receiverAddress ? '<div class="kv"><div class="k">Address</div><div class="v">' + esc(s.receiverAddress) + '</div></div>' : '')
      + '</div></div>';
  }

  function render(ctx) {
    var id = getShipmentId(ctx);
    if (id) code = id;
    var s = findShip(code);
    if (!s) return render404(code);

    return '<div class="shipment-detail-page">'
      + statusHero(s) + progressBlock(s)
      + '<div style="display:grid;grid-template-columns:1fr 400px;gap:22px;align-items:start">'
      +   '<div>' + mapBlock() + tabsBlock() + '</div>'
      +   '<div>' + senderCard(s) + recipientCard(s) + '</div>'
      + '</div></div>';
  }

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;
    mounted = true;

    var s = findShip(code);
    if (!s) {
      handler = function (e) {
        var btn = e.target.closest && e.target.closest('[data-action]');
        if (btn && btn.dataset.action === 'go-shipments' && global.Admin) global.Admin.go('shipments');
      };
      container.addEventListener('click', handler);
      return;
    }

    var panel = document.getElementById('tabPanel');
    if (panel) panel.innerHTML = renderTabPanel(s);

    setTimeout(function () { if (mounted) mountMap(s); }, 80);

    handler = function (e) {
      var tab = e.target.closest && e.target.closest('[data-tab]');
      if (tab) { activeTab = tab.dataset.tab; rerenderTabs(s); return; }

      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'go-shipments') { if (global.Admin) global.Admin.go('shipments'); return; }
      if (action === 'save-status') { saveEdit(s, 'status'); return; }
      if (action === 'save-package') { saveEdit(s, 'package'); return; }
      if (action === 'save-parties') { saveEdit(s, 'parties'); return; }
    };

    container.addEventListener('click', handler);
  }

  function mountMap(s) {
    if (typeof global.L === 'undefined') return;
    var el = document.getElementById('detailMap');
    if (!el) return;
    if (mapInstance) { try { mapInstance.remove(); } catch (e) {} mapInstance = null; }

    var map = L.map('detailMap', { center: [30, 0], zoom: 3, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);

    var c = s.coords || {};
    var valid = function (p) { return p && typeof p.lat === 'number' && p.lng !== 0; };
    var pin = function (color, icon) {
      return L.divIcon({
        html: '<div style="width:34px;height:34px;border-radius:50%;background:' + color + ';border:3px solid #fff;box-shadow:0 6px 16px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px"><i class="fas ' + icon + '"></i></div>',
        className: '', iconSize: [34, 34], iconAnchor: [17, 17]
      });
    };

    var markers = [];
    if (valid(c.origin)) markers.push(L.marker([c.origin.lat, c.origin.lng], { icon: pin('#0b2545', 'fa-store') }).addTo(map));
    if (valid(c.current)) markers.push(L.marker([c.current.lat, c.current.lng], { icon: pin('#FF6B35', 'fa-truck') }).addTo(map));
    if (valid(c.dest)) markers.push(L.marker([c.dest.lat, c.dest.lng], { icon: pin('#059669', 'fa-flag-checkered') }).addTo(map));

    if (markers.length) map.fitBounds(L.featureGroup(markers).getBounds(), { padding: [50, 50] });
    else map.setView([20, 0], 2);

    mapInstance = map;
  }

  function saveEdit(s, type) {
    var all = asArray(read('ge_shipments', []));
    var i = all.findIndex(function (x) { return x.trackingCode === s.trackingCode; });
    if (i === -1) { toast('Shipment not found', '', 'error'); return; }

    var prevStatus = all[i].status;

    if (type === 'status') {
      all[i].status = document.getElementById('ed_status').value;
      all[i].currentLocation = document.getElementById('ed_current').value.trim();
      all[i].estimatedDelivery = document.getElementById('ed_eta').value.trim();
      var note = document.getElementById('ed_note').value.trim();
      
      if (!all[i].activities) all[i].activities = [];
      if (note) all[i].activities.push({ date: fmtDT(), location: all[i].currentLocation, description: note });
      if (all[i].status !== prevStatus) all[i].activities.push({ date: fmtDT(), location: all[i].currentLocation, description: 'Status changed to ' + all[i].status });

    } else if (type === 'package') {
      all[i].packageType = document.getElementById('ed_pkgtype').value;
      all[i].serviceLevel = document.getElementById('ed_service').value;
      all[i].weight = document.getElementById('ed_weight').value.trim();
      all[i].dimensions = document.getElementById('ed_dims').value.trim();
      all[i].handling = document.getElementById('ed_handling').value;
      all[i].contents = document.getElementById('ed_contents').value.trim();

    } else if (type === 'parties') {
      all[i].senderName = document.getElementById('ed_senderName').value.trim();
      all[i].senderCompany = document.getElementById('ed_senderCompany').value.trim();
      all[i].senderEmail = document.getElementById('ed_senderEmail').value.trim();
      all[i].senderPhone = document.getElementById('ed_senderPhone').value.trim();
      all[i].senderAddress = document.getElementById('ed_senderAddress').value.trim();

      all[i].receiverName = document.getElementById('ed_receiverName').value.trim();
      all[i].receiverCompany = document.getElementById('ed_receiverCompany').value.trim();
      all[i].receiverEmail = document.getElementById('ed_receiverEmail').value.trim();
      all[i].receiverPhone = document.getElementById('ed_receiverPhone').value.trim();
      all[i].receiverAddress = document.getElementById('ed_receiverAddress').value.trim();
    }

    write('ge_shipments', all);

    if (Admin && Admin.logAudit) Admin.logAudit('shipment.update', 'shipment:' + s.trackingCode, 'Updated ' + type);
    toast('Shipment updated', 'Changes saved successfully.', 'success');

    activeTab = 'details';
    if (global.Admin) global.Admin.go('shipment-detail', { id: code });
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    if (mapInstance) { try { mapInstance.remove(); } catch (e) {} mapInstance = null; }
    container = null; handler = null; code = null; activeTab = 'details'; mounted = false;
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