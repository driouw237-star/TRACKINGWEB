/* ================================================================
   GlobalExpress — Admin Shipments Page
   ================================================================
   Shipment management: table, search, status filter, user filter,
   sort, pagination, edit modal, delete, bulk status update,
   bulk export CSV.

   Every write:
     - updates ge_shipments
     - calls Admin.logAudit(action, target, details)
     - emits shipment:updated / shipment:deleted via
       Realtime.notifyLocalChange

   Deep-link: Admin.state.params.code opens that shipment's edit
   modal automatically once per page visit.
   Admin.state.params.status pre-applies a status filter.
   Admin.state.params.userId pre-applies a user filter.

   Registers with Admin.register('shipments', page).
   ================================================================ */

(function (global) {
  'use strict';

  /* ================================================================
     §1 — DEPENDENCIES
     ================================================================ */
  var Utils    = global.Utils    || {};
  var UI       = global.UI       || {};
  var Realtime = global.Realtime || {};
  var Admin    = global.Admin    || null;

  /* ================================================================
     §2 — FALLBACKS
     ================================================================ */

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var money = Utils.money || function (n) {
    return 'Fr. ' + Number(n || 0).toLocaleString();
  };

  var comma = Utils.comma || function (n) {
    return Number(n || 0).toLocaleString('en-US');
  };

  var uid = Utils.uid || function (prefix) {
    return (prefix || 'id') + '_' +
      Math.random().toString(36).slice(2, 10) +
      Date.now().toString(36).slice(-4);
  };

  var fmtDT = Utils.fmtDT || function (d) {
    return new Date(d || Date.now()).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  };

  var fmtDate = Utils.fmtDate || function (d) {
    return new Date(d || Date.now()).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  };

  var statusCls = Utils.statusCls || function (s) {
    return String(s || 'Pending').trim().replace(/\s+/g, '-');
  };

  var toast = UI.toast || function (t, m, k) {
    if (global.console) console.log('[toast]', t, m || '', k || '');
  };

  var openModal  = UI.openModal  || function () { return null; };
  var closeModal = UI.closeModal || function () {};

  var storage = (Utils.storage && typeof Utils.storage.get === 'function')
    ? Utils.storage
    : {
        get: function (k, fallback) {
          try {
            var raw = localStorage.getItem(k);
            return raw === null ? fallback : JSON.parse(raw);
          } catch (e) { return fallback; }
        },
        set: function (k, v) {
          try { localStorage.setItem(k, JSON.stringify(v)); return true; }
          catch (e) { return false; }
        }
      };

  /* ================================================================
     §3 — STORAGE KEYS + CONSTANTS
     ================================================================ */

  var KEYS = {
    users:         'ge_users',
    shipments:     'ge_shipments',
    notifications: 'ge_notifications'
  };

  var PAGE_SIZE = 15;

  var STATUSES = ['Pending', 'In Transit', 'On Hold', 'Delivered', 'Cancelled'];

  var PACKAGE_TYPES = [
    'Standard Box', 'Envelope / Document', 'Pallet',
    'Fragile Item', 'Electronics', 'Other'
  ];

  var HANDLING_OPTIONS = [
    'None', 'Fragile', 'Perishable',
    'Signature Required', 'Leave at Door'
  ];

  var SERVICE_LEVELS = [
    'Economy — 7–10 days',
    'Standard — 4–6 days',
    'Express — 2–3 days',
    'Overnight — next day'
  ];

  /* ================================================================
     §4 — MODULE STATE
     ================================================================ */

  var state = {
    query:       '',
    statusFilter:'',
    userFilter:  '',
    sortKey:     'created',   // code | user | status | created | amount
    sortDir:     'desc',
    pageNum:     1,
    selected:    {}           // { trackingCode: true }
  };

  var handler         = null;
  var container       = null;
  var deepLinkHandled = false;

  /* ================================================================
     §5 — STORAGE READERS / WRITERS
     ================================================================ */

  function readShipments() {
    var list = storage.get(KEYS.shipments, []);
    return Array.isArray(list) ? list : [];
  }

  function writeShipments(list) {
    return storage.set(KEYS.shipments, list);
  }

  function readUsers() {
    var list = storage.get(KEYS.users, []);
    return Array.isArray(list) ? list : [];
  }

  function userOptions() {
    // Unique list of { id, name, email } for the filter dropdown.
    var users = readUsers();
    var opts = [];
    for (var i = 0; i < users.length; i++) {
      if (users[i] && users[i].id) {
        opts.push({
          id:    users[i].id,
          name:  users[i].name || users[i].email || users[i].id,
          email: users[i].email || ''
        });
      }
    }
    return opts;
  }

  /* ================================================================
     §6 — HELPERS
     ================================================================ */

  function findShipment(code) {
    if (!code) return null;
    var list = readShipments();
    var up = String(code).toUpperCase();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].trackingCode || '').toUpperCase() === up) {
        return list[i];
      }
    }
    return null;
  }

  function parseDateSafe(s) {
    if (!s) return 0;
    var t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }

  function matchesQuery(s, q) {
    if (!q) return true;
    var hay = [
      s.trackingCode  || '',
      s.receiverName  || '',
      s.senderName    || '',
      s.originCity    || '',
      s.destCity      || '',
      s.currentLocation || '',
      s.createdByEmail || '',
      s.createdByName || ''
    ].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function matchesStatus(s, status) {
    if (!status) return true;
    return s.status === status;
  }

  function matchesUser(s, userId) {
    if (!userId) return true;
    return s.createdBy === userId;
  }

  /* ================================================================
     §7 — AUDIT + EMIT
     ================================================================ */

  function auditAndEmit(action, target, details, extras) {
    if (Admin && typeof Admin.logAudit === 'function') {
      Admin.logAudit(action, target, details);
    }
    if (Realtime && typeof Realtime.notifyLocalChange === 'function') {
      Realtime.notifyLocalChange(action, { target: target });
    }
    if (extras && Realtime && typeof Realtime.notifyLocalChange === 'function') {
      for (var i = 0; i < extras.length; i++) {
        var ev = extras[i];
        if (ev && ev.name) {
          Realtime.notifyLocalChange(ev.name, ev.payload);
        }
      }
    }
  }

  /* ================================================================
     §8 — PIPELINE
     ================================================================ */

  function pipeline() {
    var list = readShipments();
    var totalAll = list.length;

    var q = state.query.trim().toLowerCase();
    if (q) list = list.filter(function (s) { return matchesQuery(s, q); });

    if (state.statusFilter) {
      list = list.filter(function (s) { return matchesStatus(s, state.statusFilter); });
    }

    if (state.userFilter) {
      list = list.filter(function (s) { return matchesUser(s, state.userFilter); });
    }

    list.sort(compareShips);

    var totalFiltered = list.length;
    var totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
    if (state.pageNum > totalPages) state.pageNum = totalPages;
    if (state.pageNum < 1) state.pageNum = 1;

    var start = (state.pageNum - 1) * PAGE_SIZE;
    var slice = list.slice(start, start + PAGE_SIZE);

    return {
      all:        totalAll,
      filtered:   totalFiltered,
      slice:      slice,
      start:      start,
      end:        Math.min(start + PAGE_SIZE, totalFiltered),
      totalPages: totalPages
    };
  }

  function compareShips(a, b) {
    var key = state.sortKey;
    var dir = state.sortDir === 'asc' ? 1 : -1;

    var va, vb;
    if (key === 'code') {
      va = (a.trackingCode || '').toLowerCase();
      vb = (b.trackingCode || '').toLowerCase();
    } else if (key === 'user') {
      va = (a.createdByName || a.createdByEmail || '').toLowerCase();
      vb = (b.createdByName || b.createdByEmail || '').toLowerCase();
    } else if (key === 'status') {
      va = (a.status || '').toLowerCase();
      vb = (b.status || '').toLowerCase();
    } else if (key === 'amount') {
      va = Number(a.amountPaid) || 0;
      vb = Number(b.amountPaid) || 0;
    } else {
      // created
      va = parseDateSafe(a.createdAt);
      vb = parseDateSafe(b.createdAt);
    }

    if (va < vb) return -1 * dir;
    if (va > vb) return  1 * dir;
    return 0;
  }

  /* ================================================================
     §9 — ROW RENDERING
     ================================================================ */

  function sortIndicator(key) {
    if (state.sortKey !== key) return '';
    var arrow = state.sortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down';
    return ' <i class="fas ' + arrow + '" style="font-size:9px;opacity:.9"></i>';
  }

  function th(key, label, extra) {
    return '<th data-sort-key="' + esc(key) + '"'
         + (extra ? ' class="' + esc(extra) + '"' : '')
         + ' style="cursor:pointer">'
         + esc(label)
         + sortIndicator(key)
         + '</th>';
  }

  function rowHtml(s) {
    var isSelected = !!state.selected[s.trackingCode];
    var statusClass = statusCls(s.status);

    return ''
      + '<tr data-code="' + esc(s.trackingCode) + '"'
      +   (isSelected ? ' class="row-selected"' : '') + '>'

      +   '<td class="hide-sm" style="width:36px">'
      +     '<label class="checkbox" style="margin:0">'
      +       '<input type="checkbox" data-row-check '
      +         'data-code="' + esc(s.trackingCode) + '"'
      +         (isSelected ? ' checked' : '') + ' />'
      +     '</label>'
      +   '</td>'

      +   '<td>'
      +     '<div class="mono" style="font-weight:600">' + esc(s.trackingCode || '—') + '</div>'
      +     '<div class="cell-sub">' + esc(s.createdAt || '') + '</div>'
      +   '</td>'

      +   '<td>'
      +     '<div style="font-weight:600;font-size:13px">'
      +       esc(s.createdByName || '—')
      +     '</div>'
      +     (s.createdByEmail
              ? '<div class="cell-sub">' + esc(s.createdByEmail) + '</div>'
              : '')
      +   '</td>'

      +   '<td style="font-size:12.5px;color:var(--text-2)">'
      +     esc(s.originCity || '—')
      +     ' <i class="fas fa-arrow-right" style="font-size:9px;color:var(--accent);margin:0 4px"></i> '
      +     esc(s.destCity || '—')
      +   '</td>'

      +   '<td><span class="pill ' + esc(statusClass) + '">'
      +     esc(s.status || 'Pending')
      +   '</span></td>'

      +   '<td class="num" style="font-weight:600;font-variant-numeric:tabular-nums">'
      +     esc(money(s.amountPaid || 0))
      +   '</td>'

      +   '<td class="tbl-actions">'
      +     '<button type="button" class="btn btn-sm btn-outline" '
      +       'data-action="edit" data-code="' + esc(s.trackingCode) + '" title="Edit shipment">'
      +       '<i class="fas fa-pen-to-square"></i>'
      +     '</button>'
      +     '<button type="button" class="btn btn-sm btn-outline" '
      +       'data-action="delete" data-code="' + esc(s.trackingCode) + '" '
      +       'title="Delete shipment" '
      +       'style="color:var(--red);border-color:#fecaca">'
      +       '<i class="fas fa-trash"></i>'
      +     '</button>'
      +   '</td>'

      + '</tr>';
  }

  /* ================================================================
     §10 — EMPTY STATES
     ================================================================ */

  function emptyNoShipments() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-box-open"></i></div>'
      +   '<h4>No shipments yet</h4>'
      +   '<p>Shipments created by customers will appear here.</p>'
      + '</div>';
  }

  function emptyNoMatch() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-magnifying-glass"></i></div>'
      +   '<h4>No matching shipments</h4>'
      +   '<p>Try a different search, status, or user filter.</p>'
      +   '<button type="button" class="btn btn-outline" data-action="clear-filters">'
      +     '<i class="fas fa-rotate-left"></i> Clear filters'
      +   '</button>'
      + '</div>';
  }

  /* ================================================================
     §11 — TABLE RENDER
     ================================================================ */

  function renderRows() {
    var tbody = document.getElementById('shipsTbody');
    if (!tbody) return;

    var result = pipeline();

    if (result.all === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">'
        + emptyNoShipments() + '</td></tr>';
    } else if (result.filtered === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">'
        + emptyNoMatch() + '</td></tr>';
    } else {
      tbody.innerHTML = result.slice.map(rowHtml).join('');
    }

    var countEl = document.getElementById('shipsCount');
    if (countEl) {
      countEl.textContent = result.filtered === result.all
        ? result.all + ' shipment' + (result.all === 1 ? '' : 's')
        : result.filtered + ' of ' + result.all + ' shipments';
    }

    renderFooter(result);
    updateBulkBar();
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

  function renderFooter(result) {
    var foot = document.getElementById('shipsFooter');
    if (!foot) return;
    if (result.filtered === 0) { foot.innerHTML = ''; return; }

    var showing = (result.start + 1) + '–' + result.end
                + ' of ' + result.filtered;

    var pageBtns = '';
    var range = windowedRange(result.totalPages, state.pageNum, 2);
    for (var i = 0; i < range.length; i++) {
      var p = range[i];
      if (p === '…') {
        pageBtns += '<button type="button" disabled>…</button>';
      } else {
        pageBtns += '<button type="button" data-page="' + p + '"'
                  + (p === state.pageNum ? ' class="active"' : '')
                  + '>' + p + '</button>';
      }
    }

    foot.innerHTML = ''
      + '<div class="count">Showing <strong>' + showing + '</strong></div>'
      + '<div class="pages">'
      +   '<button type="button" data-page-prev '
      +     (state.pageNum === 1 ? 'disabled' : '') + '>'
      +     '<i class="fas fa-chevron-left"></i>'
      +   '</button>'
      +   pageBtns
      +   '<button type="button" data-page-next '
      +     (state.pageNum >= result.totalPages ? 'disabled' : '') + '>'
      +     '<i class="fas fa-chevron-right"></i>'
      +   '</button>'
      + '</div>';
  }

  /* ================================================================
     §12 — BULK BAR
     ================================================================ */

  function selectedCount() {
    return Object.keys(state.selected).length;
  }

  function updateBulkBar() {
    var bar = document.getElementById('shipsBulkBar');
    if (!bar) return;
    var n = selectedCount();
    if (n === 0) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    var txt = document.getElementById('shipsBulkText');
    if (txt) txt.textContent = n + ' selected';
  }

  function clearSelection() {
    state.selected = {};
    updateBulkBar();
  }

  /* ================================================================
     §13 — WRITES
     ================================================================ */

  function updateShipment(code, patch) {
    var list = readShipments();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].trackingCode === code) { idx = i; break; }
    }
    if (idx === -1) { toast('Shipment not found', code, 'error'); return false; }

    var before = list[idx];
    var prevStatus = before.status;

    // Apply patch
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) {
        list[idx][k] = patch[k];
      }
    }

    // Timeline entries
    if (!Array.isArray(list[idx].activities)) list[idx].activities = [];
    var now = fmtDT();

    if (patch.currentLocation && patch.currentLocation !== before.currentLocation) {
      list[idx].activities.push({
        date:        now,
        location:    patch.currentLocation,
        description: 'Location updated by admin.'
      });
    }

    if (patch.status && patch.status !== prevStatus) {
      list[idx].activities.push({
        date:        now,
        location:    list[idx].currentLocation || '—',
        description: 'Status changed to ' + patch.status + ' by admin.'
      });
    }

    if (patch.note) {
      list[idx].activities.push({
        date:        now,
        location:    list[idx].currentLocation || '—',
        description: patch.note
      });
      delete list[idx].note;
    }

    writeShipments(list);

    auditAndEmit(
      'shipment.update',
      'shipment:' + code,
      buildChangeSummary(before, list[idx]),
      [{ name: 'shipment:updated', payload: list[idx] }]
    );

    return list[idx];
  }

  function buildChangeSummary(before, after) {
    var changes = [];
    var keys = ['status', 'currentLocation', 'estimatedDelivery',
                'packageType', 'dimensions', 'weight', 'handling',
                'serviceLevel', 'contents'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (before[k] !== after[k]) {
        changes.push(k + ': ' + (before[k] || '—') + ' → ' + (after[k] || '—'));
      }
    }
    return changes.length ? changes.join('; ') : 'No changes';
  }

  function deleteShipment(code) {
    var list = readShipments();
    var target = null;
    var filtered = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].trackingCode === code) {
        target = list[i];
      } else {
        filtered.push(list[i]);
      }
    }
    if (!target) { toast('Shipment not found', code, 'error'); return false; }

    writeShipments(filtered);

    // Notify the owner
    var notifs = storage.get(KEYS.notifications, []);
    if (!Array.isArray(notifs)) notifs = [];
    notifs.push({
      id:      uid('n'),
      userId:  target.createdBy,
      title:   'Shipment removed',
      message: 'Shipment ' + code + ' was removed by an administrator.',
      type:    'warning',
      at:      fmtDT(),
      read:    false
    });
    storage.set(KEYS.notifications, notifs);

    auditAndEmit(
      'shipment.delete',
      'shipment:' + code,
      'Deleted — route ' + (target.originCity || '?') + ' → ' + (target.destCity || '?'),
      [
        { name: 'shipment:deleted', payload: target },
        { name: 'notification:new', payload: notifs[notifs.length - 1] }
      ]
    );

    return true;
  }

  function bulkUpdateStatus(newStatus) {
    var codes = Object.keys(state.selected);
    if (!codes.length) return 0;

    var list = readShipments();
    var changed = 0;
    var now = fmtDT();

    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s) continue;
      if (codes.indexOf(s.trackingCode) === -1) continue;

      if (s.status !== newStatus) {
        var prev = s.status;
        s.status = newStatus;
        if (!Array.isArray(s.activities)) s.activities = [];
        s.activities.push({
          date:        now,
          location:    s.currentLocation || '—',
          description: 'Status changed to ' + newStatus + ' by admin (bulk).'
        });
        changed++;
      }
    }

    if (changed > 0) {
      writeShipments(list);
      auditAndEmit(
        'shipment.bulk-update',
        'shipments:' + codes.length,
        'Status → ' + newStatus + ' (' + changed + ' changed)'
      );
      if (Realtime && Realtime.notifyLocalChange) {
        Realtime.notifyLocalChange('shipment:updated', { bulk: true });
      }
    }

    return changed;
  }

  /* ================================================================
     §14 — EXPORT CSV
     ================================================================ */

  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function exportCSV(onlySelected) {
    var list = readShipments();

    if (onlySelected) {
      list = list.filter(function (s) {
        return state.selected[s.trackingCode];
      });
    } else {
      var q = state.query.trim().toLowerCase();
      if (q) list = list.filter(function (s) { return matchesQuery(s, q); });
      if (state.statusFilter) list = list.filter(function (s) { return matchesStatus(s, state.statusFilter); });
      if (state.userFilter)   list = list.filter(function (s) { return matchesUser(s, state.userFilter); });
    }

    var header = [
      'Tracking Code', 'Created By', 'Created By Email',
      'Status', 'Origin', 'Destination', 'Current Location',
      'Sender', 'Receiver', 'Amount Paid', 'Created At'
    ];
    var lines = [header.join(',')];

    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      lines.push([
        csvEscape(s.trackingCode),
        csvEscape(s.createdByName),
        csvEscape(s.createdByEmail),
        csvEscape(s.status),
        csvEscape(s.originCity),
        csvEscape(s.destCity),
        csvEscape(s.currentLocation),
        csvEscape(s.senderName),
        csvEscape(s.receiverName),
        csvEscape(s.amountPaid || 0),
        csvEscape(s.createdAt)
      ].join(','));
    }

    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'globalexpress-shipments-' + Date.now() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast('CSV downloaded', list.length + ' shipments', 'success');
  }

  /* ================================================================
     §15 — EDIT MODAL
     ================================================================ */

  function openEditModal(code) {
    var s = findShipment(code);
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
      +       '<div class="sub">'
      +         '<span class="mono">' + esc(s.trackingCode) + '</span>'
      +         ' · ' + esc(s.createdByName || '—')
      +       '</div>'
      +     '</div>'
      +     '<button type="button" class="modal-close" data-close aria-label="Close">'
      +       '<i class="fas fa-times"></i>'
      +     '</button>'
      +   '</div>'

      +   '<div class="modal-body">'

      // Status & routing
      +     '<div class="modal-section">'
      +       '<div class="modal-section-title"><i class="fas fa-truck-fast"></i> Status & Routing</div>'
      +       '<div class="grid-2">'

      +         '<div class="field">'
      +           '<label>Status</label>'
      +           '<select id="ed_status">'
      +             STATUSES.map(function (v) {
                    return '<option value="' + esc(v) + '"'
                         + (s.status === v ? ' selected' : '') + '>'
                         + esc(v) + '</option>';
                  }).join('')
      +           '</select>'
      +         '</div>'

      +         '<div class="field">'
      +           '<label>Service Level</label>'
      +           '<select id="ed_service">'
      +             SERVICE_LEVELS.map(function (v) {
                    return '<option value="' + esc(v) + '"'
                         + (s.serviceLevel === v ? ' selected' : '') + '>'
                         + esc(v) + '</option>';
                  }).join('')
      +           '</select>'
      +         '</div>'

      +         '<div class="field">'
      +           '<label>Current Location</label>'
      +           '<input type="text" id="ed_current" value="' + esc(s.currentLocation || '') + '" '
      +             'placeholder="e.g. Memphis, TN" />'
      +         '</div>'

      +         '<div class="field">'
      +           '<label>Estimated Delivery</label>'
      +           '<input type="text" id="ed_eta" value="' + esc(s.estimatedDelivery || '') + '" '
      +             'placeholder="e.g. Oct 5, 2026" />'
      +         '</div>'

      +       '</div>'
      +     '</div>'

      // Package
      +     '<div class="modal-section">'
      +       '<div class="modal-section-title"><i class="fas fa-box"></i> Package</div>'
      +       '<div class="grid-2">'

      +         '<div class="field">'
      +           '<label>Package Type</label>'
      +           '<select id="ed_pkgtype">'
      +             PACKAGE_TYPES.map(function (v) {
                    return '<option value="' + esc(v) + '"'
                         + (s.packageType === v ? ' selected' : '') + '>'
                         + esc(v) + '</option>';
                  }).join('')
      +           '</select>'
      +         '</div>'

      +         '<div class="field">'
      +           '<label>Dimensions</label>'
      +           '<input type="text" id="ed_dims" value="' + esc(s.dimensions || '') + '" '
      +             'placeholder="e.g. Medium" />'
      +         '</div>'

      +         '<div class="field">'
      +           '<label>Weight</label>'
      +           '<input type="text" id="ed_weight" value="' + esc(s.weight || '') + '" '
      +             'placeholder="e.g. 4.6 lbs" />'
      +         '</div>'

      +         '<div class="field">'
      +           '<label>Special Handling</label>'
      +           '<select id="ed_handling">'
      +             HANDLING_OPTIONS.map(function (v) {
                    return '<option value="' + esc(v) + '"'
                         + (s.handling === v ? ' selected' : '') + '>'
                         + esc(v) + '</option>';
                  }).join('')
      +           '</select>'
      +         '</div>'

      +         '<div class="field" style="grid-column:1/-1">'
      +           '<label>Contents</label>'
      +           '<input type="text" id="ed_contents" value="' + esc(s.contents || '') + '" '
      +             'placeholder="What is inside?" />'
      +         '</div>'

      +       '</div>'
      +     '</div>'

      // Coordinates
      +     '<div class="modal-section">'
      +       '<div class="modal-section-title"><i class="fas fa-map-location-dot"></i> Map Coordinates</div>'
      +       '<p style="font-size:12.5px;color:var(--text-3);margin:0 0 14px">'
      +         'Used for the live map on the tracking page.'
      +       '</p>'
      +       '<div class="grid-2">'

      +         '<div class="field">'
      +           '<label>Origin Lat</label>'
      +           '<input type="number" step="any" id="ed_origin_lat" value="' + (origin.lat || '') + '" placeholder="32.7767" />'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Origin Lng</label>'
      +           '<input type="number" step="any" id="ed_origin_lng" value="' + (origin.lng || '') + '" placeholder="-96.7970" />'
      +         '</div>'

      +         '<div class="field">'
      +           '<label>Current Lat</label>'
      +           '<input type="number" step="any" id="ed_current_lat" value="' + (current.lat || '') + '" placeholder="35.1495" />'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Current Lng</label>'
      +           '<input type="number" step="any" id="ed_current_lng" value="' + (current.lng || '') + '" placeholder="-90.0490" />'
      +         '</div>'

      +         '<div class="field">'
      +           '<label>Destination Lat</label>'
      +           '<input type="number" step="any" id="ed_dest_lat" value="' + (dest.lat || '') + '" placeholder="59.3667" />'
      +         '</div>'
      +         '<div class="field">'
      +           '<label>Destination Lng</label>'
      +           '<input type="number" step="any" id="ed_dest_lng" value="' + (dest.lng || '') + '" placeholder="16.5077" />'
      +         '</div>'

      +       '</div>'
      +     '</div>'

      // Note
      +     '<div class="modal-section">'
      +       '<div class="modal-section-title"><i class="fas fa-note-sticky"></i> Timeline Note</div>'
      +       '<div class="field" style="margin:0">'
      +         '<label>Add a note (optional)</label>'
      +         '<input type="text" id="ed_note" placeholder="e.g. Departed sorting facility" />'
      +         '<div class="hint">Will appear on the shipment timeline as a new event.</div>'
      +       '</div>'
      +     '</div>'

      +   '</div>'

      +   '<div class="modal-foot between" style="flex-wrap:wrap">'
      +     '<div style="font-size:12.5px;color:var(--text-3)">'
      +       'Changes take effect immediately.'
      +     '</div>'
      +     '<div style="display:flex;gap:10px;margin-left:auto">'
      +       '<button type="button" class="btn btn-outline" data-close>Cancel</button>'
      +       '<button type="button" class="btn btn-primary" data-save>'
      +         '<i class="fas fa-save"></i> Save Changes'
      +       '</button>'
      +     '</div>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) {
        closeModal(modal);
        return;
      }
      if (e.target === modal) { closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-save]')) {
        saveEdit(code, modal);
      }
    });
  }

  function gv(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function nv(id) {
    var v = gv(id);
    return v === '' ? 0 : (parseFloat(v) || 0);
  }

  function saveEdit(code, modal) {
    var patch = {
      status:            gv('ed_status'),
      serviceLevel:      gv('ed_service'),
      currentLocation:   gv('ed_current'),
      estimatedDelivery: gv('ed_eta'),
      packageType:       gv('ed_pkgtype'),
      dimensions:        gv('ed_dims'),
      weight:            gv('ed_weight'),
      handling:          gv('ed_handling'),
      contents:          gv('ed_contents'),
      note:              gv('ed_note'),
      coords: {
        origin:  { lat: nv('ed_origin_lat'),  lng: nv('ed_origin_lng') },
        current: { lat: nv('ed_current_lat'), lng: nv('ed_current_lng') },
        dest:    { lat: nv('ed_dest_lat'),    lng: nv('ed_dest_lng') }
      }
    };

    var result = updateShipment(code, patch);
    closeModal(modal);

    if (result) {
      toast('Shipment updated', code, 'success');
      renderRows();
    }
  }

  /* ================================================================
     §16 — DELETE CONFIRM
     ================================================================ */

  function confirmDelete(code) {
    var s = findShipment(code);
    if (!s) return;

    var doIt = function () {
      if (deleteShipment(code)) {
        toast('Shipment deleted', code, 'success');
        delete state.selected[code];
        renderRows();
      }
    };

    if (UI.confirm) {
      UI.confirm({
        title:       'Delete this shipment?',
        message:     'Shipment ' + code + ' will be permanently removed. The customer will be notified.',
        confirmText: 'Delete',
        variant:     'danger'
      }).then(function (ok) { if (ok) doIt(); });
    } else if (global.confirm) {
      if (global.confirm('Delete ' + code + '?')) doIt();
    }
  }

  /* ================================================================
     §17 — BULK STATUS UPDATE MODAL
     ================================================================ */

  function openBulkStatusModal() {
    var n = selectedCount();
    if (n === 0) return;

    var modal = openModal(''
      + '<div class="modal narrow">'
      +   '<div class="modal-head">'
      +     '<div><h3><i class="fas fa-layer-group"></i> Bulk Status Update</h3>'
      +       '<div class="sub">' + n + ' shipment' + (n === 1 ? '' : 's') + ' selected</div></div>'
      +     '<button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button>'
      +   '</div>'
      +   '<div class="modal-body">'
      +     '<div class="field" style="margin:0">'
      +       '<label>New Status</label>'
      +       '<select id="bulkStatus">'
      +         STATUSES.map(function (s) {
                return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
              }).join('')
      +       '</select>'
      +       '<div class="hint">Each shipment gets a timeline entry noting the bulk change.</div>'
      +     '</div>'
      +   '</div>'
      +   '<div class="modal-foot">'
      +     '<button type="button" class="btn btn-outline" data-close>Cancel</button>'
      +     '<button type="button" class="btn btn-primary" data-confirm>'
      +       '<i class="fas fa-check"></i> Apply to ' + n
      +     '</button>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-confirm]')) {
        var sel = document.getElementById('bulkStatus');
        var newStatus = sel ? sel.value : '';
        var changed = bulkUpdateStatus(newStatus);
        closeModal(modal);
        if (changed > 0) {
          toast('Bulk update applied', changed + ' shipment'
            + (changed === 1 ? '' : 's') + ' → ' + newStatus, 'success');
          clearSelection();
          renderRows();
        } else {
          toast('No changes', 'Selected shipments already had that status.', 'info');
        }
      }
    });
  }

  /* ================================================================
     §18 — MAIN RENDER
     ================================================================ */

  function render(ctx) {
    var users = userOptions();

    return ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3>'
      +       '<i class="fas fa-box"></i> Shipments'
      +       ' <span id="shipsCount" style="font-weight:500;color:var(--text-3);font-size:13px;margin-left:6px"></span>'
      +     '</h3>'
      +     '<div class="panel-tools">'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="export">'
      +         '<i class="fas fa-file-csv"></i> Export CSV'
      +       '</button>'
      +     '</div>'
      +   '</div>'

      +   '<div class="toolbar">'
      +     '<div class="search-box">'
      +       '<i class="fas fa-search"></i>'
      +       '<input type="text" id="shipsSearch" '
      +         'placeholder="Search code, recipient, city, user…" '
      +         'value="' + esc(state.query) + '" />'
      +     '</div>'
      +     '<select id="shipsStatusFilter" aria-label="Filter by status">'
      +       '<option value=""' + (state.statusFilter === '' ? ' selected' : '') + '>All statuses</option>'
      +       STATUSES.map(function (s) {
            return '<option value="' + esc(s) + '"'
                 + (state.statusFilter === s ? ' selected' : '') + '>'
                 + esc(s) + '</option>';
          }).join('')
      +     '</select>'
      +     '<select id="shipsUserFilter" aria-label="Filter by user">'
      +       '<option value=""' + (state.userFilter === '' ? ' selected' : '') + '>All users</option>'
      +       users.map(function (u) {
            return '<option value="' + esc(u.id) + '"'
                 + (state.userFilter === u.id ? ' selected' : '') + '>'
                 + esc(u.name) + '</option>';
          }).join('')
      +     '</select>'
      +   '</div>'

      +   '<div id="shipsBulkBar" class="bulk-bar hidden">'
      +     '<span id="shipsBulkText" style="font-weight:600;font-size:13px">0 selected</span>'
      +     '<div style="display:flex;gap:8px;margin-left:auto">'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="bulk-status">'
      +         '<i class="fas fa-layer-group"></i> Update Status'
      +       '</button>'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="bulk-export">'
      +         '<i class="fas fa-download"></i> Export selected'
      +       '</button>'
      +       '<button type="button" class="btn btn-sm btn-ghost" data-action="bulk-clear">'
      +         'Clear'
      +       '</button>'
      +     '</div>'
      +   '</div>'

      +   '<div class="tbl-wrap">'
      +     '<table class="table-cards">'
      +       '<thead>'
      +         '<tr>'
      +           '<th class="hide-sm" style="width:36px">'
      +             '<input type="checkbox" id="shipsSelectAll" aria-label="Select all on page" />'
      +           '</th>'
      +           th('code',   'Tracking Code')
      +           th('user',   'User')
      +           '<th>Route</th>'
      +           th('status', 'Status')
      +           th('amount', 'Amount', 'num')
      +           '<th class="tbl-actions">Actions</th>'
      +         '</tr>'
      +       '</thead>'
      +       '<tbody id="shipsTbody"></tbody>'
      +     '</table>'
      +   '</div>'

      +   '<div class="tbl-footer" id="shipsFooter"></div>'
      + '</div>';
  }

  /* ================================================================
     §19 — BIND
     ================================================================ */

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (handler) container.removeEventListener('click', handler);

    // Apply pre-filters from deep-link params
    if (ctx && ctx.params) {
      if (typeof ctx.params.status === 'string') {
        state.statusFilter = ctx.params.status;
        // Reflect in the select if it exists yet
        var sel = document.getElementById('shipsStatusFilter');
        if (sel) sel.value = ctx.params.status;
      }
      if (typeof ctx.params.userId === 'string') {
        state.userFilter = ctx.params.userId;
        var usel = document.getElementById('shipsUserFilter');
        if (usel) usel.value = ctx.params.userId;
      }
    }

    renderRows();

    // Deep link to a specific shipment
    var deepCode = ctx && ctx.params && ctx.params.code;
    if (deepCode && !deepLinkHandled) {
      deepLinkHandled = true;
      setTimeout(function () {
        if (findShipment(deepCode)) openEditModal(deepCode);
        else toast('Shipment not found', deepCode, 'info');
      }, 0);
    }

    handler = function (e) {
      // 1. Checkbox
      var rowCheck = e.target.closest && e.target.closest('[data-row-check]');
      if (rowCheck) {
        var code = rowCheck.dataset.code;
        if (rowCheck.checked) state.selected[code] = true;
        else delete state.selected[code];
        var tr = rowCheck.closest('tr');
        if (tr) tr.classList.toggle('row-selected', rowCheck.checked);
        updateBulkBar();
        return;
      }

      // 2. Select-all
      if (e.target && e.target.id === 'shipsSelectAll') {
        var checked = e.target.checked;
        if (checked) {
          var current = pipeline().slice;
          for (var i = 0; i < current.length; i++) {
            state.selected[current[i].trackingCode] = true;
          }
        } else {
          state.selected = {};
        }
        renderRows();
        return;
      }

      // 3. Sort
      var thEl = e.target.closest && e.target.closest('[data-sort-key]');
      if (thEl) {
        var key = thEl.dataset.sortKey;
        if (key === state.sortKey) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = 'asc';
        }
        state.pageNum = 1;
        container.innerHTML = render(ctx);
        renderRows();
        // Re-apply filter inputs
        var s1 = document.getElementById('shipsSearch');
        var s2 = document.getElementById('shipsStatusFilter');
        var s3 = document.getElementById('shipsUserFilter');
        if (s1) s1.value = state.query;
        if (s2) s2.value = state.statusFilter;
        if (s3) s3.value = state.userFilter;
        attachInputListeners();
        return;
      }

      // 4. Pagination
      var pageBtn = e.target.closest && e.target.closest('[data-page]');
      if (pageBtn) {
        state.pageNum = parseInt(pageBtn.dataset.page, 10) || 1;
        renderRows();
        return;
      }
      if (e.target.closest && e.target.closest('[data-page-prev]')) {
        if (state.pageNum > 1) { state.pageNum--; renderRows(); }
        return;
      }
      if (e.target.closest && e.target.closest('[data-page-next]')) {
        state.pageNum++; renderRows();
        return;
      }

      // 5. Actions
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;

      var action = btn.dataset.action;
      var code2  = btn.dataset.code;

      if (action === 'edit')         { openEditModal(code2); return; }
      if (action === 'delete')       { confirmDelete(code2); return; }
      if (action === 'export')       { exportCSV(false); return; }
      if (action === 'bulk-export')  { exportCSV(true); return; }
      if (action === 'bulk-status')  { openBulkStatusModal(); return; }
      if (action === 'bulk-clear')   { clearSelection(); renderRows(); return; }
      if (action === 'clear-filters') {
        state.query = '';
        state.statusFilter = '';
        state.userFilter = '';
        state.pageNum = 1;
        var s4 = document.getElementById('shipsSearch');
        var s5 = document.getElementById('shipsStatusFilter');
        var s6 = document.getElementById('shipsUserFilter');
        if (s4) s4.value = '';
        if (s5) s5.value = '';
        if (s6) s6.value = '';
        renderRows();
        return;
      }
    };

    container.addEventListener('click', handler);
    attachInputListeners();
  }

  function attachInputListeners() {
    var searchEl = document.getElementById('shipsSearch');
    if (searchEl && !searchEl.__wired) {
      var t = null;
      searchEl.addEventListener('input', function () {
        if (t) clearTimeout(t);
        t = setTimeout(function () {
          state.query = searchEl.value || '';
          state.pageNum = 1;
          renderRows();
        }, 140);
      });
      searchEl.__wired = true;
    }

    var statusEl = document.getElementById('shipsStatusFilter');
    if (statusEl && !statusEl.__wired) {
      statusEl.addEventListener('change', function () {
        state.statusFilter = statusEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      statusEl.__wired = true;
    }

    var userEl = document.getElementById('shipsUserFilter');
    if (userEl && !userEl.__wired) {
      userEl.addEventListener('change', function () {
        state.userFilter = userEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      userEl.__wired = true;
    }
  }

  /* ================================================================
     §20 — CLEANUP
     ================================================================ */

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler   = null;

    state.query        = '';
    state.statusFilter = '';
    state.userFilter   = '';
    state.sortKey      = 'created';
    state.sortDir      = 'desc';
    state.pageNum      = 1;
    state.selected     = {};

    deepLinkHandled = false;

    if (UI.closeAllModals) UI.closeAllModals();
  }

  /* ================================================================
     §21 — REGISTER
     ================================================================ */

  var page = {
    title:    'Shipments',
    subtitle: 'Manage every shipment on the platform',
    render:   render,
    bind:     bind,
    cleanup:  cleanup
  };

  if (global.Admin && typeof global.Admin.register === 'function') {
    global.Admin.register('shipments', page);
  } else {
    global.PagesAdmin = global.PagesAdmin || {};
    global.PagesAdmin.shipments = page;
  }

})(window);