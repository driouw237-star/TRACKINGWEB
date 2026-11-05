/* ================================================================
   GlobalExpress — Admin Shipment Detail (Supabase)
   File: js/shipment-detail.js
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
  var fmtDT = Utils.fmtDT || function (d) { return new Date(d || Date.now()).toLocaleString(); };
  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };

  var STATUSES = ['Pending', 'In Transit', 'On Hold', 'Delivered', 'Cancelled'];
  var PACKAGE_TYPES = ['Standard Box', 'Envelope / Document', 'Pallet', 'Fragile Item', 'Electronics', 'Other'];
  var HANDLING_OPTIONS = ['None', 'Fragile', 'Perishable', 'Signature Required', 'Leave at Door'];
  var SERVICE_LEVELS = ['Economy — 7–10 days', 'Standard — 4–6 days', 'Express — 2–3 days', 'Overnight — next day'];

  var state = {
    shipment: null,
    isLoading: true,
    activeTab: 'details' // details | status | package | parties | timeline
  };
  
  var code = null;
  var mapInstance = null;
  var handler = null;
  var container = null;
  var mounted = false;

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  function getShipmentId(ctx) {
    if (ctx && ctx.params && ctx.params.id) return String(ctx.params.id);
    return localStorage.getItem('ge_admin_current_shipment');
  }

  async function loadData(id) {
    if (!window.supabaseClient) return;
    code = id;
    state.isLoading = true;

    try {
      // Fetch shipment by ID (UUID) OR tracking_code
      const { data, error } = await window.supabaseClient
        .schema('app')
        .from('shipments')
        .select('*')
        .or(`id.eq.${id},tracking_code.eq.${id}`)
        .single();

      if (error) throw error;
      state.shipment = data;

    } catch (err) {
      console.error('Failed to load shipment:', err);
      state.shipment = null;
    } finally {
      state.isLoading = false;
      if (container) {
        container.innerHTML = render({ params: { id: code } });
        bind();
      }
    }
  }

  async function saveShipment(patch) {
    if (!window.supabaseClient || !state.shipment) return false;
    
    try {
      // 1. Update the shipment row
      const { error } = await window.supabaseClient
        .schema('app')
        .from('shipments')
        .update(patch)
        .eq('id', state.shipment.id);

      if (error) throw error;

      // 2. Add to activities timeline if status changed
      if (patch.status && patch.status !== state.shipment.status) {
        var newActivity = {
          date: new Date().toISOString(),
          location: patch.current_location || state.shipment.current_location || 'System',
          description: 'Admin changed status to ' + patch.status
        };
        var newActivities = (state.shipment.activities || []).concat([newActivity]);
        
        await window.supabaseClient
          .schema('app')
          .from('shipments')
          .update({ activities: newActivities })
          .eq('id', state.shipment.id);
      }

      // 3. Log to audit
      await window.supabaseClient.schema('audit').from('logs').insert({
        action: 'shipment.update',
        actor_type: 'admin',
        target: 'shipment:' + state.shipment.tracking_code,
        details: 'Updated via admin panel. Status: ' + (patch.status || state.shipment.status)
      });

      toast('Success', 'Shipment updated.', 'success');
      return true;

    } catch (err) {
      console.error('Save failed:', err);
      toast('Error', err.message || 'Failed to update shipment.', 'error');
      return false;
    }
  }

  // ================================================================
  // RENDER HELPERS
  // ================================================================
  function render404(c) {
    return '<div class="panel"><div class="panel-body" style="text-align:center;padding:60px 24px">' +
      '<div style="width:80px;height:80px;border-radius:50%;background:var(--surface-2);display:inline-flex;align-items:center;justify-content:center;font-size:32px;color:var(--text-3);margin-bottom:16px"><i class="fas fa-box-open"></i></div>' +
      '<h2 style="font-size:18px;margin:0 0 8px">Shipment not found</h2>' +
      '<p style="color:var(--text-2);font-size:14px;margin-bottom:20px">No shipment matches <strong>' + esc(c || '—') + '</strong>.</p>' +
      '<button type="button" class="btn btn-primary" data-action="go-shipments"><i class="fas fa-box"></i> Back to Shipments</button>' +
      '</div></div>';
  }

  function statusHero(s) {
    return '<div class="status-banner" style="margin-bottom:22px;background:linear-gradient(135deg,var(--surface),var(--surface-2));border:1px solid var(--border);border-radius:16px;padding:24px;color:var(--text)">' +
      '<div style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:260px">' +
          '<div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:800;color:var(--text-3);margin-bottom:6px">Tracking Status</div>' +
          '<div style="font-family:\'Manrope\',sans-serif;font-size:28px;font-weight:800;color:var(--text);letter-spacing:-.02em;line-height:1.15;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
            esc(s.status) +
            '<span style="font-family:\'Monaco\',monospace;font-size:15px;font-weight:600;background:var(--surface-2);padding:6px 12px;border-radius:8px;letter-spacing:1.2px;border:1px solid var(--border)">' + esc(s.tracking_code) + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:10px;margin-top:14px;font-size:14.5px;font-weight:600;color:var(--text-2);flex-wrap:wrap">' +
            '<span>' + esc(s.origin_city || '—') + '</span><span><i class="fas fa-arrow-right" style="font-size:10px"></i></span><span>' + esc(s.dest_city || '—') + '</span>' +
          '</div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0">' +
          '<div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;font-weight:800;color:var(--text-3);margin-bottom:6px">Estimated Delivery</div>' +
          '<div style="font-family:\'Manrope\',sans-serif;font-size:19px;font-weight:800;color:var(--text)">' + esc(s.estimated_delivery || 'TBD') + '</div>' +
          '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;flex-wrap:wrap">' +
            '<button type="button" class="btn btn-sm btn-outline" data-action="go-shipments"><i class="fas fa-arrow-left"></i> Back</button>' +
          '</div>' +
        '</div>' +
      '</div></div>';
  }

  function tabsBlock() {
    var defs = [
      { key: 'details',  label: 'Overview' },
      { key: 'status',   label: 'Update Status' },
      { key: 'package',  label: 'Package Info' },
      { key: 'parties',  label: 'Sender / Receiver' },
      { key: 'timeline', label: 'Timeline' }
    ];
    return '<div class="panel" style="margin-bottom:22px"><div class="panel-body">' +
      '<div class="tabs" style="display:flex;gap:20px;border-bottom:1.5px solid var(--border);margin-bottom:20px;overflow-x:auto;white-space:nowrap;">' +
        defs.map(function (d) {
          var active = state.activeTab === d.key;
          return '<button type="button" class="tab' + (active ? ' active' : '') + '" data-tab="' + d.key + '" style="background:none;border:none;padding:0 0 12px;font-family:inherit;font-weight:600;font-size:14px;color:' + (active ? 'var(--text)' : 'var(--text-3)') + ';border-bottom:2.5px solid ' + (active ? 'var(--accent)' : 'transparent') + ';margin-bottom:-1.5px;cursor:pointer">' + esc(d.label) + '</button>';
        }).join('') +
      '</div><div id="tabPanel"></div></div></div>';
  }

  // --- Tab Renderers ---
  function renderDetailsTab(s) {
    return '<div style="padding:0;border:none">' +
      '<div style="margin-bottom:16px">' +
        '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-2)"><span style="color:var(--text-3)">Current Location</span><strong>' + esc(s.current_location || '—') + '</strong></div>' +
        '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-2)"><span style="color:var(--text-3)">Service Level</span><strong>' + esc(s.service_level || '—') + '</strong></div>' +
        '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-2)"><span style="color:var(--text-3)">Amount Paid</span><strong>' + money(s.amount_paid || 0) + '</strong></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<div style="padding:8px 0;border-bottom:1px solid var(--border-2)"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">Type</div><div style="font-weight:600">' + esc(s.package_type || '—') + '</div></div>' +
        '<div style="padding:8px 0;border-bottom:1px solid var(--border-2)"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">Weight</div><div style="font-weight:600">' + esc(s.weight || '—') + '</div></div>' +
        '<div style="padding:8px 0;border-bottom:1px solid var(--border-2)"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">Insured</div><div style="font-weight:600">' + (s.insured ? 'Yes' : 'No') + '</div></div>' +
        '<div style="padding:8px 0;border-bottom:1px solid var(--border-2)"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">Handling</div><div style="font-weight:600">' + esc(s.handling || 'None') + '</div></div>' +
        '<div style="grid-column:1/-1;padding:8px 0;border-bottom:1px solid var(--border-2)"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">Contents</div><div style="font-weight:600">' + esc(s.contents || '—') + '</div></div>' +
      '</div></div>';
  }

  function renderStatusTab(s) {
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      '<div class="field"><label>Status</label><select id="ed_status" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">' +
      STATUSES.map(function (v) { return '<option ' + (s.status === v ? 'selected' : '') + '>' + esc(v) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>Current Location</label><input type="text" id="ed_current" value="' + esc(s.current_location || '') + '" placeholder="e.g. Memphis, TN" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '<div class="field"><label>Estimated Delivery</label><input type="text" id="ed_eta" value="' + esc(s.estimated_delivery || '') + '" placeholder="e.g. Oct 5, 2026" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '<div class="field"><label>Add Timeline Note (Optional)</label><input type="text" id="ed_note" placeholder="e.g. Departed sorting facility" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:18px;padding-top:18px;border-top:1px solid var(--border-2)">' +
      '<button type="button" class="btn btn-primary" data-action="save-status"><i class="fas fa-save"></i> Save Status</button>' +
      '</div>';
  }

  function renderPackageTab(s) {
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      '<div class="field"><label>Package Type</label><select id="ed_pkgtype" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">' +
      PACKAGE_TYPES.map(function (v) { return '<option ' + (s.package_type === v ? 'selected' : '') + '>' + esc(v) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>Service Level</label><select id="ed_service" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">' +
      SERVICE_LEVELS.map(function (v) { return '<option ' + (s.service_level === v ? 'selected' : '') + '>' + esc(v) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>Weight</label><input type="text" id="ed_weight" value="' + esc(s.weight || '') + '" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '<div class="field"><label>Dimensions</label><input type="text" id="ed_dims" value="' + esc(s.dimensions || '') + '" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '<div class="field"><label>Handling</label><select id="ed_handling" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">' +
      HANDLING_OPTIONS.map(function (v) { return '<option ' + (s.handling === v ? 'selected' : '') + '>' + esc(v) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field" style="grid-column:1/-1"><label>Contents</label><input type="text" id="ed_contents" value="' + esc(s.contents || '') + '" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:18px;padding-top:18px;border-top:1px solid var(--border-2)">' +
      '<button type="button" class="btn btn-primary" data-action="save-package"><i class="fas fa-save"></i> Save Package</button>' +
      '</div>';
  }

  function renderPartiesTab(s) {
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      '<div style="grid-column:1/-1;border-bottom:1px solid var(--border-2);padding-bottom:10px"><label style="font-size:14px;color:var(--accent)"><i class="fas fa-store"></i> Sender Details</label></div>' +
      '<div class="field"><label>Name</label><input type="text" id="ed_senderName" value="' + esc(s.sender_name || '') + '" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '<div class="field"><label>Company</label><input type="text" id="ed_senderCompany" value="' + esc(s.sender_company || '') + '" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '<div class="field"><label>Email</label><input type="email" id="ed_senderEmail" value="' + esc(s.sender_email || '') + '" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '<div class="field"><label>Phone</label><input type="text" id="ed_senderPhone" value="' + esc(s.sender_phone || '') + '" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '<div class="field" style="grid-column:1/-1"><label>Address</label><input type="text" id="ed_senderAddress" value="' + esc(s.sender_address || '') + '" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      
      '<div style="grid-column:1/-1;border-bottom:1px solid var(--border-2);padding-bottom:10px;margin-top:16px"><label style="font-size:14px;color:var(--accent)"><i class="fas fa-user"></i> Recipient Details</label></div>' +
      '<div class="field"><label>Name</label><input type="text" id="ed_receiverName" value="' + esc(s.receiver_name || '') + '" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '<div class="field"><label>Company</label><input type="text" id="ed_receiverCompany" value="' + esc(s.receiver_company || '') + '" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '<div class="field"><label>Email</label><input type="email" id="ed_receiverEmail" value="' + esc(s.receiver_email || '') + '" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '<div class="field"><label>Phone</label><input type="text" id="ed_receiverPhone" value="' + esc(s.receiver_phone || '') + '" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '<div class="field" style="grid-column:1/-1"><label>Address</label><input type="text" id="ed_receiverAddress" value="' + esc(s.receiver_address || '') + '" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" /></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:18px;padding-top:18px;border-top:1px solid var(--border-2)">' +
      '<button type="button" class="btn btn-primary" data-action="save-parties"><i class="fas fa-save"></i> Save Contacts</button>' +
      '</div>';
  }

  function renderTimelineTab(s) {
    var acts = (s.activities || []).slice().reverse();
    if (!acts.length) return '<p style="color:var(--text-3);font-size:13px;text-align:center;padding:20px">No activity yet.</p>';
    return '<div>' +
      acts.map(function (a, i) {
        return '<div style="display:flex;gap:16px;margin-bottom:20px;">' +
          '<div style="width:12px;height:12px;border-radius:50%;background:' + (i === 0 ? 'var(--accent)' : 'var(--border)') + ';margin-top:6px;flex-shrink:0;"></div>' +
          '<div>' +
            '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;">' + esc(a.date) + '</div>' +
            '<div style="font-weight:600;font-size:14px;color:var(--text);margin-top:2px;">' + esc(a.description) + '</div>' +
            '<div style="font-size:13px;color:var(--text-2);margin-top:2px;"><i class="fas fa-location-dot"></i> ' + esc(a.location) + '</div>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function renderTabPanel(s) {
    if (state.activeTab === 'status') return renderStatusTab(s);
    if (state.activeTab === 'package') return renderPackageTab(s);
    if (state.activeTab === 'parties') return renderPartiesTab(s);
    if (state.activeTab === 'timeline') return renderTimelineTab(s);
    return renderDetailsTab(s);
  }

  function rerenderTabs(s) {
    document.getElementById('content').innerHTML = render({ params: { id: code } });
    bind();
  }

  function senderCard(s) {
    return '<div class="panel" style="margin-bottom:22px"><div class="panel-header"><h3><i class="fas fa-store"></i> Sender</h3></div><div class="panel-body">' +
      '<div style="padding:8px 0;"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">Name</div><div style="font-weight:600">' + esc(s.sender_name || '—') + '</div></div>' +
      (s.sender_address ? '<div style="padding:8px 0;border-top:1px solid var(--border-2);"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">Address</div><div style="font-weight:600">' + esc(s.sender_address) + '</div></div>' : '') +
      '</div></div>';
  }

  function recipientCard(s) {
    return '<div class="panel" style="margin-bottom:22px"><div class="panel-header"><h3><i class="fas fa-user"></i> Recipient</h3></div><div class="panel-body">' +
      '<div style="padding:8px 0;"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">Name</div><div style="font-weight:600">' + esc(s.receiver_name || '—') + '</div></div>' +
      (s.receiver_address ? '<div style="padding:8px 0;border-top:1px solid var(--border-2);"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">Address</div><div style="font-weight:600">' + esc(s.receiver_address) + '</div></div>' : '') +
      '</div></div>';
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render(ctx) {
    if (state.isLoading) {
      return '<div class="panel" style="padding:60px;text-align:center;color:var(--text-3)"><i class="fas fa-circle-notch fa-spin" style="font-size:24px;margin-bottom:16px"></i><p>Loading shipment...</p></div>';
    }

    var id = getShipmentId(ctx);
    if (id && !state.shipment) code = id;
    
    var s = state.shipment;
    if (!s) return render404(code);

    return '<div class="shipment-detail-page" style="max-width:1200px;margin:0 auto;">' +
      statusHero(s) +
      '<div style="display:grid;grid-template-columns:1fr 400px;gap:22px;align-items:start">' +
        '<div>' + tabsBlock() + '</div>' +
        '<div>' + senderCard(s) + recipientCard(s) + '</div>' +
      '</div>' +
    '</div>';
  }

  // ================================================================
  // BIND & ACTIONS
  // ================================================================
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;
    mounted = true;

    var id = getShipmentId(ctx);
    if (!state.shipment && id) {
      loadData(id);
      return;
    }

    var s = state.shipment;
    if (!s) return;

    var panel = document.getElementById('tabPanel');
    if (panel) panel.innerHTML = renderTabPanel(s);

    if (handler) container.removeEventListener('click', handler);

    handler = function (e) {
      var tab = e.target.closest && e.target.closest('[data-tab]');
      if (tab) {
        state.activeTab = tab.dataset.tab;
        rerenderTabs(s);
        return;
      }

      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'go-shipments') {
        if (global.Admin) global.Admin.go('shipments');
        return;
      }
      
      if (action === 'save-status') {
        var status = document.getElementById('ed_status').value;
        var currentLoc = document.getElementById('ed_current').value;
        var eta = document.getElementById('ed_eta').value;
        var note = document.getElementById('ed_note').value;

        saveShipment({ 
          status: status, 
          current_location: currentLoc, 
          estimated_delivery: eta 
        }).then(function(ok) {
          if (ok) {
            state.activeTab = 'details';
            loadData(s.id); // Reload fresh data
          }
        });
        return;
      }
      
      if (action === 'save-package') {
        saveShipment({
          package_type: document.getElementById('ed_pkgtype').value,
          service_level: document.getElementById('ed_service').value,
          weight: document.getElementById('ed_weight').value,
          dimensions: document.getElementById('ed_dims').value,
          handling: document.getElementById('ed_handling').value,
          contents: document.getElementById('ed_contents').value
        }).then(function(ok) {
          if (ok) {
            state.activeTab = 'details';
            loadData(s.id);
          }
        });
        return;
      }
      
      if (action === 'save-parties') {
        saveShipment({
          sender_name: document.getElementById('ed_senderName').value,
          sender_company: document.getElementById('ed_senderCompany').value,
          sender_email: document.getElementById('ed_senderEmail').value,
          sender_phone: document.getElementById('ed_senderPhone').value,
          sender_address: document.getElementById('ed_senderAddress').value,
          receiver_name: document.getElementById('ed_receiverName').value,
          receiver_company: document.getElementById('ed_receiverCompany').value,
          receiver_email: document.getElementById('ed_receiverEmail').value,
          receiver_phone: document.getElementById('ed_receiverPhone').value,
          receiver_address: document.getElementById('ed_receiverAddress').value
        }).then(function(ok) {
          if (ok) {
            state.activeTab = 'details';
            loadData(s.id);
          }
        });
        return;
      }
    };

    container.addEventListener('click', handler);
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null; handler = null; code = null; state.activeTab = 'details'; mounted = false;
    state.shipment = null;
    state.isLoading = true;
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