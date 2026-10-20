/* GlobalExpress - pages/my-shipments.js
   Shipments list page — professional edition.

   Features:
     - Filter tabs (All / Active / Completed) with live counts
     - Search across code, recipient, cities, and status
     - Sortable columns (code, recipient, status, created, eta)
     - Pagination
     - Row click → edit modal
     - Inline copy-code button on hover
     - Bulk selection with export
     - Full-featured edit modal: status, location, package, coords, timeline
     - Deep-link support via { code } param

   Registers itself via App.register('shipments', page).
   Reads/writes Store (shipments, walletTxns, payments, notifications).
*/
(function (global) {
  'use strict';

  var Utils    = global.Utils    || {};
  var UI       = global.UI       || {};
  var Store    = global.Store    || {};
  var Realtime = global.Realtime || {};

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
  var fmtDT = Utils.fmtDT || function (d) {
    return new Date(d || Date.now()).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };
  var fmtDate = Utils.fmtDate || function (d) {
    return new Date(d || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  var uid = Utils.uid || function (p) {
    return (p || 'id') + '_' + Math.random().toString(36).slice(2, 10);
  };

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  var openModal = UI.openModal || function () { return null; };
  var closeModal = UI.closeModal || function () {};

  // --- Constants -----------------------------------------------------------

  var PAGE_SIZE = 10;
  var STATUSES = ['Pending', 'In Transit', 'On Hold', 'Delivered', 'Cancelled'];
  var ACTIVE_STATUSES   = ['Pending', 'In Transit', 'On Hold'];
  var COMPLETED_STATUSES = ['Delivered', 'Cancelled'];
  var PACKAGE_TYPES = ['Standard Box', 'Envelope / Document', 'Pallet', 'Fragile Item', 'Electronics', 'Other'];
  var HANDLING_OPTIONS = ['None', 'Fragile', 'Perishable', 'Signature Required', 'Leave at Door'];
  var SERVICE_LEVELS = ['Economy — 7–10 days', 'Standard — 4–6 days', 'Express — 2–3 days', 'Overnight — next day'];

  // --- Module state --------------------------------------------------------

  var activeTab = 'all';           // 'all' | 'active' | 'completed'
  var query     = '';
  var sortKey   = 'created';
  var sortDir   = 'desc';
  var pageNum   = 1;
  var selected  = {};              // { trackingCode: true }

  var handler = null;
  var container = null;
  var deepLinkHandled = false;

  // --- Helpers -------------------------------------------------------------

  function currentUser(ctx) {
    return (ctx && ctx.user) ||
           (global.App && global.App.state && global.App.state.user) ||
           null;
  }

  function getUserShips(userId) {
    var all = [];
    try { all = Store.get('shipments') || []; } catch (e) {}
    if (!userId) return [];
    return all.filter(function (s) { return s.createdBy === userId; });
  }

  function findShip(code) {
    if (!code) return null;
    var all = Store.get('shipments') || [];
    var codeU = String(code).toUpperCase();
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].trackingCode || '').toUpperCase() === codeU) return all[i];
    }
    return null;
  }

  function matchesQuery(s, q) {
    if (!q) return true;
    var hay = [
      s.trackingCode || '',
      s.receiverName || '',
      s.destCity || '',
      s.originCity || '',
      s.status || ''
    ].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function matchesTab(s, tab) {
    if (tab === 'all') return true;
    if (tab === 'active') return ACTIVE_STATUSES.indexOf(s.status) >= 0;
    if (tab === 'completed') return COMPLETED_STATUSES.indexOf(s.status) >= 0;
    return true;
  }

  function sortShips(list) {
    var key = sortKey;
    var dir = sortDir === 'asc' ? 1 : -1;

    var sorted = list.slice();
    sorted.sort(function (a, b) {
      var va, vb;

      if (key === 'code') {
        va = (a.trackingCode || '').toLowerCase();
        vb = (b.trackingCode || '').toLowerCase();
      } else if (key === 'recipient') {
        va = (a.receiverName || '').toLowerCase();
        vb = (b.receiverName || '').toLowerCase();
      } else if (key === 'status') {
        va = (a.status || '').toLowerCase();
        vb = (b.status || '').toLowerCase();
      } else if (key === 'eta') {
        va = Date.parse(a.estimatedDelivery || 0) || 0;
        vb = Date.parse(b.estimatedDelivery || 0) || 0;
      } else {
        va = Date.parse(a.createdAt || 0) || 0;
        vb = Date.parse(b.createdAt || 0) || 0;
      }

      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return 0;
    });

    return sorted;
  }

  function paginate(list) {
    var totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (pageNum > totalPages) pageNum = totalPages;
    if (pageNum < 1) pageNum = 1;
    var start = (pageNum - 1) * PAGE_SIZE;
    return {
      slice: list.slice(start, start + PAGE_SIZE),
      total: list.length,
      totalPages: totalPages,
      start: start,
      end: Math.min(start + PAGE_SIZE, list.length)
    };
  }

  function countByTab(userId) {
    var list = getUserShips(userId);
    var counts = { all: list.length, active: 0, completed: 0 };
    for (var i = 0; i < list.length; i++) {
      if (ACTIVE_STATUSES.indexOf(list[i].status) >= 0) counts.active++;
      if (COMPLETED_STATUSES.indexOf(list[i].status) >= 0) counts.completed++;
    }
    return counts;
  }

  function selectedCount() {
    return Object.keys(selected).length;
  }

  // --- Sortable header -----------------------------------------------------

  function th(key, label, extra, align) {
    var active = (sortKey === key);
    var indicator = '';
    if (active) {
      indicator = sortDir === 'asc'
        ? ' <i class="fas fa-sort-up" style="font-size:9px;opacity:.9"></i>'
        : ' <i class="fas fa-sort-down" style="font-size:9px;opacity:.9"></i>';
    }
    return '<th data-sort-key="' + esc(key) + '"'
         + (extra ? ' class="' + esc(extra) + '"' : '')
         + (align ? ' style="text-align:' + align + '"' : '')
         + (active ? ' data-active-sort="1"' : '')
         + '>' + esc(label) + indicator + '</th>';
  }

  // --- Row -----------------------------------------------------------------

  function shipRow(s) {
    var isSelected = !!selected[s.trackingCode];
    return ''
      + '<tr data-code="' + esc(s.trackingCode) + '"' + (isSelected ? ' class="row-selected"' : '') + '>'
      +   '<td style="width:36px" class="hide-sm">'
      +     '<label class="checkbox" style="margin:0">'
      +       '<input type="checkbox" data-row-check data-code="' + esc(s.trackingCode) + '"' + (isSelected ? ' checked' : '') + ' />'
      +     '</label>'
      +   '</td>'
      +   '<td>'
      +     '<div style="display:flex;align-items:center;gap:8px">'
      +       '<div class="mono">' + esc(s.trackingCode) + '</div>'
      +       '<button type="button" class="copy-code-btn" data-action="copy-code" data-code="' + esc(s.trackingCode) + '" title="Copy tracking code">'
      +         '<i class="fas fa-copy"></i>'
      +       '</button>'
      +     '</div>'
      +     '<div class="cell-sub">' + esc(s.createdAt || '') + '</div>'
      +   '</td>'
      +   '<td style="font-size:12.5px;color:var(--text-2)">'
      +     esc(s.originCity || '—')
      +     ' <i class="fas fa-arrow-right" style="font-size:9px;color:var(--accent);margin:0 4px"></i> '
      +     esc(s.destCity || '—')
      +   '</td>'
      +   '<td>'
      +     '<div style="font-weight:600">' + esc(s.receiverName || '—') + '</div>'
      +     (s.receiverEmail ? '<div class="cell-sub">' + esc(s.receiverEmail) + '</div>' : '')
      +   '</td>'
      +   '<td><span class="pill ' + esc(statusCls(s.status)) + '">' + esc(s.status || 'Pending') + '</span></td>'
      +   '<td style="font-size:12px;color:var(--text-3)">' + esc(s.estimatedDelivery || '—') + '</td>'
      +   '<td class="tbl-actions">'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="edit" data-code="' + esc(s.trackingCode) + '" title="Edit shipment" aria-label="Edit">'
      +       '<i class="fas fa-pen-to-square"></i>'
      +     '</button>'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="share" data-code="' + esc(s.trackingCode) + '" title="Share tracking" aria-label="Share">'
      +       '<i class="fas fa-share-nodes"></i>'
      +     '</button>'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="track" data-code="' + esc(s.trackingCode) + '" title="Track live" aria-label="Track">'
      +       '<i class="fas fa-location-crosshairs"></i>'
      +     '</button>'
      +   '</td>'
      + '</tr>';
  }

  // --- Empty states --------------------------------------------------------

  function emptyNoShipments() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-box-open"></i></div>'
      +   '<h4>No shipments yet</h4>'
      +   '<p>Create your first shipment to get a tracking code and start tracking packages live.</p>'
      +   '<button type="button" class="btn btn-primary" data-action="new">'
      +     '<i class="fas fa-plus"></i> Create Shipment'
      +   '</button>'
      + '</div>';
  }

  function emptyNoMatch() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-magnifying-glass"></i></div>'
      +   '<h4>No matching shipments</h4>'
      +   '<p>Try adjusting your search, tab, or status filter.</p>'
      +   '<button type="button" class="btn btn-outline" data-action="clear-filters">'
      +     '<i class="fas fa-rotate-left"></i> Clear filters'
      +   '</button>'
      + '</div>';
  }

  // --- Pipeline ------------------------------------------------------------

  function pipeline(userId) {
    var list = getUserShips(userId);
    var totalAll = list.length;

    if (activeTab !== 'all') {
      list = list.filter(function (s) { return matchesTab(s, activeTab); });
    }

    var q = query.trim().toLowerCase();
    if (q) list = list.filter(function (s) { return matchesQuery(s, q); });

    list = sortShips(list);
    var paged = paginate(list);

    return {
      all: totalAll,
      filtered: list.length,
      slice: paged.slice,
      start: paged.start,
      end: paged.end,
      totalPages: paged.totalPages
    };
  }

  // --- Rows renderer -------------------------------------------------------

  function renderRows(userId) {
    var tbody = document.getElementById('shipTbody');
    if (!tbody) return;
    var result = pipeline(userId);

    if (result.all === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">' + emptyNoShipments() + '</td></tr>';
    } else if (result.filtered === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">' + emptyNoMatch() + '</td></tr>';
    } else {
      tbody.innerHTML = result.slice.map(shipRow).join('');
    }

    var countEl = document.getElementById('shipCount');
    if (countEl) {
      countEl.textContent = result.filtered === result.all
        ? result.all + ' shipment' + (result.all === 1 ? '' : 's')
        : result.filtered + ' of ' + result.all + ' shipments';
    }

    // Update tabs counts
    var counts = countByTab(userId);
    var tabAll = document.getElementById('tabAllCount');
    var tabActive = document.getElementById('tabActiveCount');
    var tabCompleted = document.getElementById('tabCompletedCount');
    if (tabAll) tabAll.textContent = counts.all;
    if (tabActive) tabActive.textContent = counts.active;
    if (tabCompleted) tabCompleted.textContent = counts.completed;

    // Update bulk bar
    updateBulkBar();

    renderFooter(result);
  }

  function renderFooter(result) {
    var foot = document.getElementById('shipFooter');
    if (!foot) return;
    if (result.filtered === 0) { foot.innerHTML = ''; return; }

    var showing = (result.start + 1) + '–' + result.end + ' of ' + result.filtered;
    var pageBtns = '';
    var range = windowedRange(result.totalPages, pageNum, 2);
    for (var i = 0; i < range.length; i++) {
      var p = range[i];
      if (p === '…') {
        pageBtns += '<button type="button" disabled>…</button>';
      } else {
        pageBtns += '<button type="button" data-page="' + p + '"'
                  + (p === pageNum ? ' class="active"' : '')
                  + '>' + p + '</button>';
      }
    }

    foot.innerHTML = ''
      + '<div class="count">Showing <strong>' + showing + '</strong></div>'
      + '<div class="pages">'
      +   '<button type="button" data-page-prev ' + (pageNum === 1 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>'
      +   pageBtns
      +   '<button type="button" data-page-next ' + (pageNum >= result.totalPages ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button>'
      + '</div>';
  }

  function windowedRange(total, current, span) {
    if (total <= 7) {
      var all = [];
      for (var i = 1; i <= total; i++) all.push(i);
      return all;
    }
    var range = [];
    var start = Math.max(2, current - span);
    var end   = Math.min(total - 1, current + span);
    range.push(1);
    if (start > 2) range.push('…');
    for (var p = start; p <= end; p++) range.push(p);
    if (end < total - 1) range.push('…');
    range.push(total);
    return range;
  }

  // --- Bulk bar ------------------------------------------------------------

  function updateBulkBar() {
    var bar = document.getElementById('bulkBar');
    if (!bar) return;
    var n = selectedCount();
    if (n === 0) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    var txt = document.getElementById('bulkText');
    if (txt) txt.textContent = n + ' selected';
  }

  function clearSelection() {
    selected = {};
    updateBulkBar();
  }

  // --- Share ---------------------------------------------------------------

  function handleShare(code) {
    if (!code) return;
    if (typeof global.shareShipment === 'function') {
      global.shareShipment(code);
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(function () {
        toast('Tracking code copied', code, 'success');
      }).catch(function () {
        toast('Copy failed', 'Please copy manually: ' + code, 'error');
      });
    } else {
      toast('Copy not supported', code, 'info');
    }
  }

  // --- Copy code -----------------------------------------------------------

  function copyCode(code) {
    if (!code) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(function () {
        toast('Code copied', code, 'success');
      }).catch(function () {
        toast('Copy failed', 'Please copy manually', 'error');
      });
    } else {
      toast('Copy not supported', code, 'info');
    }
  }

  // --- Export --------------------------------------------------------------

  function exportData(userId) {
    var list = getUserShips(userId);
    var data = JSON.stringify(list, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'globalexpress-shipments-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Export downloaded', list.length + ' shipments', 'success');
  }

  // =================================================================
  // EDIT MODAL
  // =================================================================

  function openEditModal(code) {
    var s = findShip(code);
    if (!s) { toast('Shipment not found', code, 'error'); return; }

    var c = s.coords || {};
    var origin  = c.origin  || {};
    var current = c.current || {};
    var dest    = c.dest    || {};

    var modal = openModal(''
      + '<div class="modal wide">'
      +   '<div class="modal-head">'
      +     '<div>'
      +       '<h3><i class="fas fa-pen-to-square"></i> Edit Shipment</h3>'
      +       '<div class="sub"><span class="mono">' + esc(s.trackingCode) + '</span> · Created ' + esc(s.createdAt || '—') + '</div>'
      +     '</div>'
      +     '<button type="button" class="modal-close" data-close aria-label="Close"><i class="fas fa-times"></i></button>'
      +   '</div>'
      +   '<div class="modal-body">'

      // --- Status & Location ---
      +     '<div class="modal-section">'
      +       '<div class="modal-section-title"><i class="fas fa-truck-fast"></i> Status & Location</div>'
      +       '<div class="grid-2">'
      +         '<div class="field">'
      +           '<label>Status</label>'
      +           '<select id="ed_status">'
      +             STATUSES.map(function (v) {
                    return '<option value="' + esc(v) + '"' + (s.status === v ? ' selected' : '') + '>' + esc(v) + '</option>';
                  }).join('')
      +           '</select>'
      +           '<div class="hint">Changing status adds a timeline entry.</div>'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Service Level</label>'
      +           '<select id="ed_service">'
      +             SERVICE_LEVELS.map(function (v) {
                    return '<option value="' + esc(v) + '"' + (s.serviceLevel === v ? ' selected' : '') + '>' + esc(v) + '</option>';
                  }).join('')
      +           '</select>'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Current Location</label>'
      +           '<input type="text" id="ed_current" value="' + esc(s.currentLocation || '') + '" placeholder="e.g. Memphis, TN" />'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Estimated Delivery</label>'
      +           '<input type="text" id="ed_eta" value="' + esc(s.estimatedDelivery || '') + '" placeholder="e.g. Oct 5, 2026" />'
      +         '</div>'
      +       '</div>'
      +     '</div>'

      // --- Package ---
      +     '<div class="modal-section">'
      +       '<div class="modal-section-title"><i class="fas fa-box"></i> Package</div>'
      +       '<div class="grid-2">'
      +         '<div class="field">'
      +           '<label>Package Type</label>'
      +           '<select id="ed_pkgtype">'
      +             PACKAGE_TYPES.map(function (v) {
                    return '<option value="' + esc(v) + '"' + (s.packageType === v ? ' selected' : '') + '>' + esc(v) + '</option>';
                  }).join('')
      +           '</select>'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Dimensions</label>'
      +           '<input type="text" id="ed_dims" value="' + esc(s.dimensions || '') + '" placeholder="e.g. Medium" />'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Weight</label>'
      +           '<input type="text" id="ed_weight" value="' + esc(s.weight || '') + '" placeholder="e.g. 4.6 lbs" />'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Special Handling</label>'
      +           '<select id="ed_handling">'
      +             HANDLING_OPTIONS.map(function (v) {
                    return '<option value="' + esc(v) + '"' + (s.handling === v ? ' selected' : '') + '>' + esc(v) + '</option>';
                  }).join('')
      +           '</select>'
      +         '</div>'
      +         '<div class="field" style="grid-column:1/-1">'
      +           '<label>Contents Description</label>'
      +           '<input type="text" id="ed_contents" value="' + esc(s.contents || '') + '" placeholder="What is inside?" />'
      +         '</div>'
      +       '</div>'
      +     '</div>'

      // --- Coordinates ---
      +     '<div class="modal-section">'
      +       '<div class="modal-section-title"><i class="fas fa-map-location-dot"></i> Map Coordinates</div>'
      +       '<p style="font-size:12.5px;color:var(--text-3);margin:0 0 14px">Used for the live map on the tracking page. Leave blank if unknown.</p>'
      +       '<div class="grid-2">'
      +         '<div class="field">'
      +           '<label>Origin Latitude</label>'
      +           '<input type="number" step="any" id="ed_origin_lat" value="' + (origin.lat || '') + '" placeholder="32.7767" />'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Origin Longitude</label>'
      +           '<input type="number" step="any" id="ed_origin_lng" value="' + (origin.lng || '') + '" placeholder="-96.7970" />'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Current Latitude</label>'
      +           '<input type="number" step="any" id="ed_current_lat" value="' + (current.lat || '') + '" placeholder="e.g. 35.1495" />'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Current Longitude</label>'
      +           '<input type="number" step="any" id="ed_current_lng" value="' + (current.lng || '') + '" placeholder="e.g. -90.0490" />'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Destination Latitude</label>'
      +           '<input type="number" step="any" id="ed_dest_lat" value="' + (dest.lat || '') + '" placeholder="59.3667" />'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Destination Longitude</label>'
      +           '<input type="number" step="any" id="ed_dest_lng" value="' + (dest.lng || '') + '" placeholder="16.5077" />'
      +         '</div>'
      +       '</div>'
      +     '</div>'

      // --- Timeline note ---
      +     '<div class="modal-section">'
      +       '<div class="modal-section-title"><i class="fas fa-clock-rotate-left"></i> Timeline Note</div>'
      +       '<div class="field">'
      +         '<label>Add a note (optional)</label>'
      +         '<input type="text" id="ed_note" placeholder="e.g. Departed sorting facility" />'
      +         '<div class="hint">This will appear on the shipment timeline as a new event.</div>'
      +       '</div>'
      +     '</div>'

      +   '</div>'
      +   '<div class="modal-foot between">'
      +     '<div style="font-size:12.5px;color:var(--text-3)">Changes are saved to your account immediately.</div>'
      +     '<div style="display:flex;gap:10px;margin-left:auto">'
      +       '<button type="button" class="btn btn-outline" data-close>Cancel</button>'
      +       '<button type="button" class="btn btn-primary" data-save><i class="fas fa-save"></i> Save Changes</button>'
      +     '</div>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-save]')) { saveEdit(s, modal); return; }
    });
  }

  function gv(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function num(id) {
    var v = gv(id);
    return v === '' ? 0 : (parseFloat(v) || 0);
  }

  function saveEdit(s, modal) {
    var all = Store.get('shipments') || [];
    var idx = -1;
    for (var i = 0; i < all.length; i++) {
      if (all[i].trackingCode === s.trackingCode) { idx = i; break; }
    }
    if (idx === -1) { toast('Shipment not found', '', 'error'); return; }

    var prevStatus = all[idx].status;

    all[idx].status = gv('ed_status') || all[idx].status;
    all[idx].currentLocation = gv('ed_current') || all[idx].currentLocation;
    all[idx].estimatedDelivery = gv('ed_eta');
    all[idx].serviceLevel = gv('ed_service') || all[idx].serviceLevel;

    all[idx].packageType = gv('ed_pkgtype') || all[idx].packageType;
    all[idx].dimensions = gv('ed_dims');
    all[idx].weight = gv('ed_weight');
    all[idx].handling = gv('ed_handling') || all[idx].handling;
    all[idx].contents = gv('ed_contents');

    if (!all[idx].coords) all[idx].coords = {};
    if (!all[idx].coords.origin)  all[idx].coords.origin  = {};
    if (!all[idx].coords.current) all[idx].coords.current = {};
    if (!all[idx].coords.dest)    all[idx].coords.dest    = {};

    all[idx].coords.origin.lat  = num('ed_origin_lat');
    all[idx].coords.origin.lng  = num('ed_origin_lng');
    all[idx].coords.current.lat = num('ed_current_lat');
    all[idx].coords.current.lng = num('ed_current_lng');
    all[idx].coords.dest.lat    = num('ed_dest_lat');
    all[idx].coords.dest.lng    = num('ed_dest_lng');

    if (!all[idx].activities) all[idx].activities = [];
    var note = gv('ed_note');
    if (note) {
      all[idx].activities.push({
        date: fmtDT(),
        location: all[idx].currentLocation || '—',
        description: note
      });
    }
    if (all[idx].status !== prevStatus) {
      all[idx].activities.push({
        date: fmtDT(),
        location: all[idx].currentLocation || '—',
        description: 'Status changed to ' + all[idx].status
      });
    }

    // Persist
    try {
      var raw = JSON.parse(localStorage.getItem('ge_shipments') || '[]');
      for (var k = 0; k < raw.length; k++) {
        if (raw[k].trackingCode === all[idx].trackingCode) { raw[k] = all[idx]; break; }
      }
      localStorage.setItem('ge_shipments', JSON.stringify(raw));
    } catch (e) {}

    Store.set('shipments', all);

    if (Realtime.notifyLocalChange) {
      Realtime.notifyLocalChange('shipment:updated', all[idx]);
    }

    closeModal(modal);
    toast('Shipment updated', 'Changes saved successfully.', 'success');

    var user = currentUser();
    if (user) renderRows(user.id);
    if (global.App && global.App.refreshSidebar) global.App.refreshSidebar();
  }

  // --- Render --------------------------------------------------------------

  function render(ctx) {
    var user = currentUser(ctx);
    var counts = user ? countByTab(user.id) : { all: 0, active: 0, completed: 0 };

    return ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-box"></i> My Shipments <span id="shipCount" style="font-weight:500;color:var(--text-3);font-size:13px;margin-left:6px"></span></h3>'
      +     '<div class="panel-tools">'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="export"><i class="fas fa-download"></i> Export</button>'
      +       '<button type="button" class="btn btn-sm btn-primary" data-action="new"><i class="fas fa-plus"></i> New Shipment</button>'
      +     '</div>'
      +   '</div>'

      +   '<div class="toolbar" style="justify-content:space-between">'
      +     '<div class="filter-tabs" style="display:flex;gap:4px;background:var(--surface-2);padding:4px;border-radius:10px">'
      +       '<button type="button" class="filter-tab' + (activeTab === 'all' ? ' active' : '') + '" data-tab="all">'
      +         'All <span id="tabAllCount">' + counts.all + '</span>'
      +       '</button>'
      +       '<button type="button" class="filter-tab' + (activeTab === 'active' ? ' active' : '') + '" data-tab="active">'
      +         'Active <span id="tabActiveCount">' + counts.active + '</span>'
      +       '</button>'
      +       '<button type="button" class="filter-tab' + (activeTab === 'completed' ? ' active' : '') + '" data-tab="completed">'
      +         'Completed <span id="tabCompletedCount">' + counts.completed + '</span>'
      +       '</button>'
      +     '</div>'

      +     '<div class="search-box" style="max-width:320px;flex:1">'
      +       '<i class="fas fa-search"></i>'
      +       '<input type="text" id="shipSearch" placeholder="Search code, recipient, city…" value="' + esc(query) + '" />'
      +     '</div>'
      +   '</div>'

      +   '<div id="bulkBar" class="bulk-bar hidden">'
      +     '<span id="bulkText" style="font-weight:600;font-size:13px">0 selected</span>'
      +     '<div style="display:flex;gap:8px;margin-left:auto">'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="bulk-export"><i class="fas fa-download"></i> Export selected</button>'
      +       '<button type="button" class="btn btn-sm btn-ghost" data-action="bulk-clear">Clear</button>'
      +     '</div>'
      +   '</div>'

      +   '<div class="tbl-wrap">'
      +     '<table class="table-cards">'
      +       '<thead>'
      +         '<tr>'
      +           '<th class="hide-sm" style="width:36px"><input type="checkbox" id="selectAll" aria-label="Select all" /></th>'
      +           th('code', 'Tracking Code')
      +           '<th>Route</th>'
      +           th('recipient', 'Recipient')
      +           th('status', 'Status')
      +           th('eta', 'Est. Delivery')
      +           '<th class="tbl-actions">Actions</th>'
      +         '</tr>'
      +       '</thead>'
      +       '<tbody id="shipTbody"></tbody>'
      +     '</table>'
      +   '</div>'

      +   '<div class="tbl-footer" id="shipFooter"></div>'
      + '</div>';
  }

  // --- Bind ----------------------------------------------------------------

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (handler) container.removeEventListener('click', handler);

    var user = currentUser(ctx);
    if (user) renderRows(user.id);

    // Deep link
    var code = ctx && ctx.params && ctx.params.code;
    if (code && !deepLinkHandled) {
      deepLinkHandled = true;
      var s = findShip(code);
      if (s) {
        setTimeout(function () {
          if (global.App && global.App.go) {
            global.App.go('shipment', { code: code });
          }
        }, 0);
      } else {
        toast('Shipment not found', code, 'error');
      }
    }

    handler = function (e) {
      // Filter tabs
      var tab = e.target.closest && e.target.closest('[data-tab]');
      if (tab) {
        activeTab = tab.dataset.tab;
        pageNum = 1;
        var tabs = container.querySelectorAll('[data-tab]');
        for (var t = 0; t < tabs.length; t++) {
          tabs[t].classList.toggle('active', tabs[t].dataset.tab === activeTab);
        }
        if (user) renderRows(user.id);
        return;
      }

      // Sort headers
      var thEl = e.target.closest && e.target.closest('[data-sort-key]');
      if (thEl) {
        var key = thEl.dataset.sortKey;
        if (key === sortKey) sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
        else { sortKey = key; sortDir = 'asc'; }
        pageNum = 1;
        if (user) renderRows(user.id);
        return;
      }

      // Pagination
      var pageBtn = e.target.closest && e.target.closest('[data-page]');
      if (pageBtn) { pageNum = parseInt(pageBtn.dataset.page, 10) || 1; if (user) renderRows(user.id); return; }
      if (e.target.closest && e.target.closest('[data-page-prev]')) { if (pageNum > 1) { pageNum--; if (user) renderRows(user.id); } return; }
      if (e.target.closest && e.target.closest('[data-page-next]')) { pageNum++; if (user) renderRows(user.id); return; }

      // Row checkbox
      var rowCheck = e.target.closest && e.target.closest('[data-row-check]');
      if (rowCheck) {
        var code = rowCheck.dataset.code;
        if (rowCheck.checked) selected[code] = true;
        else delete selected[code];
        rowCheck.closest('tr').classList.toggle('row-selected', rowCheck.checked);
        updateBulkBar();
        return;
      }

      // Select all
      if (e.target.id === 'selectAll') {
        var checked = e.target.checked;
        if (user) {
          var all = getUserShips(user.id);
          if (checked) {
            for (var i = 0; i < all.length; i++) selected[all[i].trackingCode] = true;
          } else {
            selected = {};
          }
          renderRows(user.id);
        }
        return;
      }

      // Action buttons
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var code2 = btn.dataset.code;

      if (action === 'new') { if (global.App) global.App.go('create'); return; }
      if (action === 'export') { if (user) exportData(user.id); return; }
      if (action === 'edit') { openEditModal(code2); return; }
      if (action === 'share') { handleShare(code2); return; }
      if (action === 'track') { if (global.App) global.App.go('tracking', { code: code2 }); return; }
      if (action === 'copy-code') { copyCode(code2); return; }
      if (action === 'clear-filters') {
        query = ''; activeTab = 'all'; pageNum = 1;
        var s1 = document.getElementById('shipSearch');
        if (s1) s1.value = '';
        if (user) renderRows(user.id);
        return;
      }
      if (action === 'bulk-clear') { clearSelection(); if (user) renderRows(user.id); return; }
      if (action === 'bulk-export') {
        if (user) {
          var list = getUserShips(user.id).filter(function (sh) { return selected[sh.trackingCode]; });
          var blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'globalexpress-selected-' + Date.now() + '.json';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          toast('Export downloaded', list.length + ' shipments', 'success');
        }
        return;
      }
    };

    container.addEventListener('click', handler);

    // Row click (anywhere except buttons/checkboxes) → edit modal
    container.addEventListener('click', function (e) {
      var row = e.target.closest && e.target.closest('tr[data-code]');
      if (!row) return;
      if (e.target.closest('button')) return;
      if (e.target.closest('input')) return;
      if (e.target.closest('a')) return;
      var code = row.dataset.code;
      if (code) openEditModal(code);
    });

    // Search
    var searchEl = document.getElementById('shipSearch');
    if (searchEl) {
      var t = null;
      searchEl.addEventListener('input', function () {
        if (t) clearTimeout(t);
        t = setTimeout(function () {
          query = searchEl.value || '';
          pageNum = 1;
          if (user) renderRows(user.id);
        }, 140);
      });
    }
  }

  // --- Cleanup -------------------------------------------------------------

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    if (UI.closeAllModals) UI.closeAllModals();
    container = null;
    handler = null;
    activeTab = 'all';
    query = '';
    sortKey = 'created';
    sortDir = 'desc';
    pageNum = 1;
    selected = {};
    deepLinkHandled = false;
  }

  // --- Register ------------------------------------------------------------

  var page = {
    title: 'My Shipments',
    subtitle: 'All shipments you have created',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('shipments', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.shipments = page;
  }

})(window);