/* GlobalExpress - pages/my-shipments.js
   Shipments list with full inline edit modal connected to Supabase.
*/

(function (global) {
  'use strict';

  var Pages = global.Pages || {};
  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var statusCls = Utils.statusCls || function (s) { return String(s || 'Pending').trim().replace(/\s+/g, '-'); };
  var fmtDT = Utils.fmtDT || function (d) { return new Date(d || Date.now()).toLocaleString(); };
  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  
  // Fallback if openModal isn't loaded
  var openModal = UI.openModal || function(html) {
    var div = document.createElement('div');
    div.id = 'customModal';
    div.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    div.innerHTML = '<div style="background:var(--surface);border-radius:16px;width:100%;max-width:800px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 40px rgba(0,0,0,0.2);">' + html + '</div>';
    document.body.appendChild(div);
    return div;
  };
  
  var closeModal = UI.closeModal || function(modal) {
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  };

  var STATUSES = ['Pending', 'In Transit', 'On Hold', 'Delivered', 'Cancelled'];
  var PACKAGE_TYPES = ['Standard Box', 'Envelope / Document', 'Pallet', 'Fragile Item', 'Electronics', 'Other'];
  var HANDLING_OPTIONS = ['None', 'Fragile', 'Perishable', 'Signature Required', 'Leave at Door'];
  var SERVICE_LEVELS = ['Economy — 7-10 days', 'Standard — 4-6 days', 'Express — 2-3 days', 'Overnight — next day'];

  var state = {
    shipments: [],
    isLoading: true,
    editingCode: null
  };

  var container = null;
  var handler = null;

  // ================================================================
  // DATA FETCHING
  // ================================================================
  async function fetchShipments(user) {
    if (!window.supabaseClient) return;
    state.isLoading = true;

    try {
      const { data, error } = await window.supabaseClient
        .schema('app')
        .from('shipments')
        .select('*')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      state.shipments = data || [];

    } catch (err) {
      console.error('Failed to load shipments:', err);
    } finally {
      state.isLoading = false;
      if (container) {
        container.innerHTML = render({ user: user });
        bind({ user: user });
      }
    }
  }

  // ================================================================
  // EDIT MODAL
  // ================================================================
  function openEditModal(code) {
    var s = state.shipments.find(function(x) { return x.tracking_code === code; });
    if (!s) return;

    var c = s.coords || {};
    var origin  = c.origin  || {};
    var current = c.current || {};
    var dest    = c.dest    || {};

    var modalHtml = `
      <div style="padding:24px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <h3 style="margin:0 0 4px;font-size:20px;font-weight:800;"><i class="fas fa-pen-to-square" style="color:var(--accent);margin-right:8px;"></i> Edit Shipment</h3>
          <div style="font-size:13px;color:var(--text-3);"><span style="font-family:monospace;font-weight:700;">${esc(s.tracking_code)}</span> · Created ${new Date(s.created_at).toLocaleDateString()}</div>
        </div>
        <button type="button" id="closeModalBtn" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--text-3);">&times;</button>
      </div>

      <div style="padding:24px;">
        <!-- Status & Location -->
        <h4 style="margin:0 0 16px;font-size:15px;border-bottom:1px solid var(--border);padding-bottom:8px;"><i class="fas fa-truck"></i> Status & Location</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Status</label>
            <select id="ed_status" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">
              ${STATUSES.map(v => `<option ${s.status === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
            <div style="font-size:11px;color:var(--text-3);margin-top:4px;">Changing status adds a timeline entry.</div>
          </div>
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Service Level</label>
            <select id="ed_service" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">
              ${SERVICE_LEVELS.map(v => `<option ${s.service_level === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Current Location</label>
            <input type="text" id="ed_current" value="${esc(s.current_location || '')}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />
          </div>
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Estimated Delivery</label>
            <input type="text" id="ed_eta" value="${esc(s.estimated_delivery || '')}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />
          </div>
        </div>

        <!-- Package -->
        <h4 style="margin:0 0 16px;font-size:15px;border-bottom:1px solid var(--border);padding-bottom:8px;"><i class="fas fa-box"></i> Package</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Package Type</label>
            <select id="ed_pkgtype" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">
              ${PACKAGE_TYPES.map(v => `<option ${s.package_type === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Dimensions</label>
            <input type="text" id="ed_dims" value="${esc(s.dimensions || '')}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />
          </div>
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Weight</label>
            <input type="text" id="ed_weight" value="${esc(s.weight || '')}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />
          </div>
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Special Handling</label>
            <select id="ed_handling" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">
              ${HANDLING_OPTIONS.map(v => `<option ${s.handling === v ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
          <div style="grid-column:1/-1;">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Contents Description</label>
            <input type="text" id="ed_contents" value="${esc(s.contents || '')}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />
          </div>
        </div>

        <!-- Coordinates -->
        <h4 style="margin:0 0 16px;font-size:15px;border-bottom:1px solid var(--border);padding-bottom:8px;"><i class="fas fa-map-location-dot"></i> Map Coordinates</h4>
        <p style="font-size:12.5px;color:var(--text-3);margin:0 0 16px;">Used for the live map on the tracking page. Leave blank if unknown.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Origin Latitude</label>
            <input type="number" step="any" id="ed_origin_lat" value="${origin.lat || ''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />
          </div>
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Origin Longitude</label>
            <input type="number" step="any" id="ed_origin_lng" value="${origin.lng || ''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />
          </div>
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Current Latitude</label>
            <input type="number" step="any" id="ed_current_lat" value="${current.lat || ''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />
          </div>
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Current Longitude</label>
            <input type="number" step="any" id="ed_current_lng" value="${current.lng || ''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />
          </div>
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Destination Latitude</label>
            <input type="number" step="any" id="ed_dest_lat" value="${dest.lat || ''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />
          </div>
          <div>
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Destination Longitude</label>
            <input type="number" step="any" id="ed_dest_lng" value="${dest.lng || ''}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />
          </div>
        </div>

        <!-- Timeline -->
        <h4 style="margin:0 0 16px;font-size:15px;border-bottom:1px solid var(--border);padding-bottom:8px;"><i class="fas fa-clock-rotate-left"></i> Timeline Note</h4>
        <div style="margin-bottom:24px;">
          <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Add a note (optional)</label>
          <input type="text" id="ed_note" placeholder="e.g. Departed sorting facility" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />
          <div style="font-size:11px;color:var(--text-3);margin-top:4px;">This will appear on the shipment timeline as a new event.</div>
        </div>
      </div>

      <div style="padding:20px;border-top:1px solid var(--border);background:var(--surface-2);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
        <span style="font-size:12px;color:var(--text-3);">Changes are saved to your account immediately.</span>
        <div style="display:flex;gap:10px;">
          <button type="button" id="cancelEditBtn" style="padding:10px 20px;border:1px solid var(--border);background:transparent;border-radius:8px;font-weight:600;cursor:pointer;">Cancel</button>
          <button type="button" id="saveEditBtn" style="padding:10px 20px;border:none;background:var(--accent);color:#fff;border-radius:8px;font-weight:600;cursor:pointer;"><i class="fas fa-save"></i> Save Changes</button>
        </div>
      </div>
    `;

    var modal = openModal(modalHtml);

    // Close handlers
    document.getElementById('closeModalBtn').onclick = function() { closeModal(modal); };
    document.getElementById('cancelEditBtn').onclick = function() { closeModal(modal); };

    // Save handler
    document.getElementById('saveEditBtn').onclick = async function() {
      var btn = this;
      btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving...';
      btn.disabled = true;

      var newStatus = document.getElementById('ed_status').value;
      var newCurrent = document.getElementById('ed_current').value;
      var newEta = document.getElementById('ed_eta').value;
      var newService = document.getElementById('ed_service').value;
      
      var newPkgType = document.getElementById('ed_pkgtype').value;
      var newDims = document.getElementById('ed_dims').value;
      var newWeight = document.getElementById('ed_weight').value;
      var newHandling = document.getElementById('ed_handling').value;
      var newContents = document.getElementById('ed_contents').value;

      var newCoords = {
        origin: { lat: parseFloat(document.getElementById('ed_origin_lat').value) || 0, lng: parseFloat(document.getElementById('ed_origin_lng').value) || 0 },
        current: { lat: parseFloat(document.getElementById('ed_current_lat').value) || 0, lng: parseFloat(document.getElementById('ed_current_lng').value) || 0 },
        dest: { lat: parseFloat(document.getElementById('ed_dest_lat').value) || 0, lng: parseFloat(document.getElementById('ed_dest_lng').value) || 0 }
      };

      var note = document.getElementById('ed_note').value;
      var newActivities = s.activities || [];
      if (note) newActivities.push({ date: new Date().toLocaleString(), location: newCurrent || 'Update', description: note });
      if (newStatus !== s.status) newActivities.push({ date: new Date().toLocaleString(), location: newCurrent || 'Update', description: 'Status changed to ' + newStatus });

      try {
        const { error } = await window.supabaseClient.schema('app').from('shipments').update({
          status: newStatus,
          current_location: newCurrent,
          estimated_delivery: newEta,
          service_level: newService,
          package_type: newPkgType,
          dimensions: newDims,
          weight: newWeight,
          handling: newHandling,
          contents: newContents,
          coords: newCoords,
          activities: newActivities
        }).eq('id', s.id);

        if (error) throw error;
        toast('Success', 'Shipment updated.', 'success');
        closeModal(modal);
        fetchShipments(global.App.state.user); // Reload table

      } catch (err) {
        console.error(err);
        toast('Error', 'Failed to update shipment.', 'error');
        btn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
        btn.disabled = false;
      }
    };
  }

  // ================================================================
  // RENDER
  // ================================================================
  function render(ctx) {
    return `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <div>
          <h2>My Shipments</h2>
          <p class="page-subtitle">Track, edit, and manage all your packages.</p>
        </div>
        <button class="btn btn-primary" onclick="App.go('create')"><i class="fas fa-plus"></i> New Shipment</button>
      </div>

      <div class="panel" style="padding:0;overflow-x:auto;">
        <div id="shipments-table-mount">
          <div style="padding:40px;text-align:center;color:var(--text-3);">
            <i class="fas fa-circle-notch fa-spin"></i> Loading your shipments...
          </div>
        </div>
      </div>
    `;
  }

  function renderTable() {
    var mount = document.getElementById('shipments-table-mount');
    if (!mount || state.isLoading) return;

    if (state.shipments.length === 0) {
      mount.innerHTML = `
        <div style="padding:60px 20px;text-align:center;">
          <h4 style="margin-bottom:8px;">No shipments found</h4>
          <button class="btn btn-primary" onclick="App.go('create')">Create Shipment</button>
        </div>
      `;
      return;
    }

    var rows = state.shipments.map(function(s) {
      return `
        <tr style="border-bottom:1px solid var(--border);" data-code="${esc(s.tracking_code)}">
          <td style="padding:16px 20px;">
            <div style="font-weight:700;font-family:monospace;font-size:13px;">${esc(s.tracking_code)}</div>
            <div style="font-size:12px;color:var(--text-3);">${new Date(s.created_at).toLocaleDateString()}</div>
          </td>
          <td>
            <div style="font-size:13px;">${esc(s.origin_city)} &rarr; ${esc(s.dest_city)}</div>
          </td>
          <td><span class="pill ${statusCls(s.status)}">${esc(s.status)}</span></td>
          <td style="font-weight:600;">${money(s.amount_paid)}</td>
          <td style="text-align:right;">
            <button class="btn btn-sm btn-outline" data-action="edit" data-code="${esc(s.tracking_code)}" title="Edit"><i class="fas fa-pen"></i></button>
          </td>
        </tr>
      `;
    }).join('');

    mount.innerHTML = `
      <table style="width:100%;border-collapse:collapse;text-align:left;">
        <thead>
          <tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">
            <th style="padding:12px 20px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Tracking</th>
            <th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Route</th>
            <th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Status</th>
            <th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Fee</th>
            <th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  // ================================================================
  // BIND
  // ================================================================
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (state.isLoading && ctx.user) {
      fetchShipments(ctx.user);
      return;
    }

    renderTable();

    if (handler) container.removeEventListener('click', handler);

    handler = function(e) {
      var btn = e.target.closest('[data-action="edit"]');
      if (btn) {
        openEditModal(btn.dataset.code);
      }
    };

    container.addEventListener('click', handler);
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null; handler = null; state.shipments = []; state.isLoading = true;
  }

  Pages['shipments'] = {
    title: 'My Shipments',
    subtitle: 'Manage your packages',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  global.Pages = Pages;

})(window);