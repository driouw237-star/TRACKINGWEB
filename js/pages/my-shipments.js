/* GlobalExpress - pages/my-shipments.js
   My Shipments (Supabase-backed, rich UI, full-page edit overlay,
   animated copy, working share).

   Replaces all prior my-shipments.js files.
   Requires: window.supabaseClient, window.App, window.Utils, window.UI
*/
(function (global) {
  'use strict';

  var Pages = global.Pages || {};
  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  // ---------- Fallbacks ----------
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

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  var openModal = UI.openModal || function () { return null; };
  var closeModal = UI.closeModal || function () {};

  // ---------- Constants ----------
  var PAGE_SIZE = 10;
  var STATUSES = ['Pending', 'In Transit', 'On Hold', 'Delivered', 'Cancelled'];
  var ACTIVE_STATUSES    = ['Pending', 'In Transit', 'On Hold'];
  var COMPLETED_STATUSES = ['Delivered', 'Cancelled'];
  var PACKAGE_TYPES    = ['Standard Box', 'Envelope / Document', 'Pallet', 'Fragile Item', 'Electronics', 'Other'];
  var HANDLING_OPTIONS = ['None', 'Fragile', 'Perishable', 'Signature Required', 'Leave at Door'];
  var SERVICE_LEVELS   = ['Economy — 7–10 days', 'Standard — 4–6 days', 'Express — 2–3 days', 'Overnight — next day'];

  // ---------- Module state ----------
  var activeTab = 'all';
  var query     = '';
  var sortKey   = 'created';
  var sortDir   = 'desc';
  var pageNum   = 1;
  var selected  = {};

  var state = {
    isLoading: true,
    shipments: [],
    error: null
  };

  var container = null;
  var handler   = null;
  var deepLinkHandled = false;

  // ================================================================
  // SUPABASE
  // ================================================================
  function sb() { return global.supabaseClient || null; }

  function normalize(row) {
    return {
      id:                row.id,
      trackingCode:      row.tracking_code,
      status:            row.status || 'Pending',
      createdAt:         row.created_at ? fmtDate(row.created_at) : '—',
      createdAtRaw:      row.created_at,
      originCity:        row.origin_city || '',
      destCity:          row.dest_city || '',
      currentLocation:   row.current_location || '',
      estimatedDelivery: row.estimated_delivery || '',
      serviceLevel:      row.service_level || '',
      packageType:       row.package_type || '',
      dimensions:        row.dimensions || '',
      weight:            row.weight || '',
      handling:          row.handling || 'None',
      contents:          row.contents || '',
      insured:           !!row.insured,
      amountPaid:        row.amount_paid || 0,
      paymentId:         row.payment_id || null,
      createdBy:         row.created_by || null,
      receiverName:      row.receiver_name || '',
      receiverEmail:     row.receiver_email || '',
      receiverCompany:   row.receiver_company || '',
      receiverPhone:     row.receiver_phone || '',
      receiverAddress:   row.receiver_address || '',
      senderName:        row.sender_name || '',
      senderEmail:       row.sender_email || '',
      senderCompany:     row.sender_company || '',
      senderPhone:       row.sender_phone || '',
      senderAddress:     row.sender_address || '',
      coords:            row.coords || {},
      activities:        Array.isArray(row.activities) ? row.activities.slice() : []
    };
  }

  async function fetchShipments(user) {
    var client = sb();
    if (!client || !user) {
      state.isLoading = false;
      state.error = 'Supabase not configured';
      renderTable();
      return;
    }

    state.isLoading = true;
    state.error = null;
    renderTable();

    try {
      var res = await client
        .schema('app')
        .from('shipments')
        .select('*')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });

      if (res.error) throw res.error;
      state.shipments = (res.data || []).map(normalize);
    } catch (err) {
      console.error('Failed to load shipments:', err);
      state.error = err.message || 'Failed to load shipments';
      state.shipments = [];
    } finally {
      state.isLoading = false;
      renderTable();
      refreshTabCounts();
    }
  }

  function getUserShips() { return state.shipments.slice(); }

  function findShip(code) {
    if (!code) return null;
    var up = String(code).toUpperCase();
    for (var i = 0; i < state.shipments.length; i++) {
      if (String(state.shipments[i].trackingCode || '').toUpperCase() === up) {
        return state.shipments[i];
      }
    }
    return null;
  }

  function currentUser(ctx) {
    return (ctx && ctx.user) ||
           (global.App && global.App.state && global.App.state.user) ||
           null;
  }

  // ================================================================
  // FILTERS / SORT / PAGINATE
  // ================================================================
  function matchesQuery(s, q) {
    if (!q) return true;
    var hay = [
      s.trackingCode, s.receiverName, s.destCity, s.originCity, s.status
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
      if (key === 'code')           { va = (a.trackingCode || '').toLowerCase();  vb = (b.trackingCode || '').toLowerCase(); }
      else if (key === 'recipient') { va = (a.receiverName || '').toLowerCase(); vb = (b.receiverName || '').toLowerCase(); }
      else if (key === 'status')    { va = (a.status || '').toLowerCase();       vb = (b.status || '').toLowerCase(); }
      else if (key === 'eta')       { va = Date.parse(a.estimatedDelivery || 0) || 0; vb = Date.parse(b.estimatedDelivery || 0) || 0; }
      else                          { va = Date.parse(a.createdAtRaw || 0) || 0;    vb = Date.parse(b.createdAtRaw || 0) || 0; }
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

  function countByTab() {
    var list = state.shipments;
    var counts = { all: list.length, active: 0, completed: 0 };
    for (var i = 0; i < list.length; i++) {
      if (ACTIVE_STATUSES.indexOf(list[i].status) >= 0) counts.active++;
      if (COMPLETED_STATUSES.indexOf(list[i].status) >= 0) counts.completed++;
    }
    return counts;
  }

  function selectedCount() { return Object.keys(selected).length; }

  function pipeline() {
    var list = getUserShips();
    var totalAll = list.length;
    if (activeTab !== 'all') list = list.filter(function (s) { return matchesTab(s, activeTab); });
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

  // ================================================================
  // RENDER — page shell
  // ================================================================
  function render(ctx) {
    var counts = countByTab();

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
      +       '<button type="button" class="filter-tab' + (activeTab === 'all' ? ' active' : '') + '" data-tab="all">All <span id="tabAllCount">' + counts.all + '</span></button>'
      +       '<button type="button" class="filter-tab' + (activeTab === 'active' ? ' active' : '') + '" data-tab="active">Active <span id="tabActiveCount">' + counts.active + '</span></button>'
      +       '<button type="button" class="filter-tab' + (activeTab === 'completed' ? ' active' : '') + '" data-tab="completed">Completed <span id="tabCompletedCount">' + counts.completed + '</span></button>'
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

  function th(key, label, extra, align) {
    var active = (sortKey === key);
    var indicator = active
      ? (sortDir === 'asc'
          ? ' <i class="fas fa-sort-up" style="font-size:9px;opacity:.9"></i>'
          : ' <i class="fas fa-sort-down" style="font-size:9px;opacity:.9"></i>')
      : '';
    return '<th data-sort-key="' + esc(key) + '"'
         + (extra ? ' class="' + esc(extra) + '"' : '')
         + (align ? ' style="text-align:' + align + '"' : '')
         + (active ? ' data-active-sort="1"' : '')
         + '>' + esc(label) + indicator + '</th>';
  }

  // ================================================================
  // ROW
  // ================================================================
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
      +       '<button type="button" class="copy-code-btn" data-action="copy" data-code="' + esc(s.trackingCode) + '" title="Copy tracking code" aria-label="Copy tracking code">'
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

  // ================================================================
  // EMPTY STATES
  // ================================================================
  function emptyNoShipments() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-box-open"></i></div>'
      +   '<h4>No shipments yet</h4>'
      +   '<p>Create your first shipment to get a tracking code and start tracking packages live.</p>'
      +   '<button type="button" class="btn btn-primary" data-action="new"><i class="fas fa-plus"></i> Create Shipment</button>'
      + '</div>';
  }
  function emptyNoMatch() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-magnifying-glass"></i></div>'
      +   '<h4>No matching shipments</h4>'
      +   '<p>Try adjusting your search, tab, or status filter.</p>'
      +   '<button type="button" class="btn btn-outline" data-action="clear-filters"><i class="fas fa-rotate-left"></i> Clear filters</button>'
      + '</div>';
  }
  function emptyError() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-triangle-exclamation"></i></div>'
      +   '<h4>Could not load shipments</h4>'
      +   '<p>' + esc(state.error || 'Please try again.') + '</p>'
      +   '<button type="button" class="btn btn-outline" data-action="retry"><i class="fas fa-rotate"></i> Retry</button>'
      + '</div>';
  }

  // ================================================================
  // TABLE
  // ================================================================
  function renderTable() {
    var tbody = document.getElementById('shipTbody');
    if (!tbody) return;

    if (state.isLoading) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">'
        + '<div style="padding:40px;text-align:center;color:var(--text-3)">'
        + '<i class="fas fa-circle-notch fa-spin"></i> Loading your shipments…'
        + '</div></td></tr>';
      return;
    }
    if (state.error) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">' + emptyError() + '</td></tr>';
      return;
    }

    var result = pipeline();
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

    refreshTabCounts();
    updateBulkBar();
    renderFooter(result);
  }

  function refreshTabCounts() {
    var counts = countByTab();
    var a = document.getElementById('tabAllCount');
    var b = document.getElementById('tabActiveCount');
    var c = document.getElementById('tabCompletedCount');
    if (a) a.textContent = counts.all;
    if (b) b.textContent = counts.active;
    if (c) c.textContent = counts.completed;
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
      if (p === '…') pageBtns += '<button type="button" disabled>…</button>';
      else pageBtns += '<button type="button" data-page="' + p + '"' + (p === pageNum ? ' class="active"' : '') + '>' + p + '</button>';
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
      var all = []; for (var i = 1; i <= total; i++) all.push(i); return all;
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

  // ================================================================
  // BULK BAR
  // ================================================================
  function updateBulkBar() {
    var bar = document.getElementById('bulkBar');
    if (!bar) return;
    var n = selectedCount();
    bar.classList.toggle('hidden', n === 0);
    var txt = document.getElementById('bulkText');
    if (txt) txt.textContent = n + ' selected';
  }
  function clearSelection() { selected = {}; updateBulkBar(); }

  // ================================================================
  // COPY (animated) + SHARE
  // ================================================================
  function copyWithAnimation(btn, text) {
    if (!text || !btn) return;
    var icon = btn.querySelector('i');
    var originalClass = icon ? icon.className : 'fas fa-copy';

    btn.classList.add('copying');
    if (icon) icon.className = 'fas fa-circle-notch fa-spin';
    btn.setAttribute('aria-busy', 'true');

    function done(ok) {
      btn.classList.remove('copying');
      btn.setAttribute('aria-busy', 'false');
      if (icon) {
        icon.className = ok ? 'fas fa-check' : 'fas fa-xmark';
        setTimeout(function () {
          if (icon && icon.parentNode) icon.className = originalClass;
        }, 1200);
      }
      if (ok) {
        btn.classList.add('copied');
        setTimeout(function () { btn.classList.remove('copied'); }, 1200);
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        done(true);
        toast('Copied', 'Tracking code copied', 'success');
      }).catch(function () {
        var ok = fallbackCopyText(text);
        done(ok);
        toast(ok ? 'Copied' : 'Copy failed', ok ? 'Tracking code copied' : 'Please copy manually', ok ? 'success' : 'error');
      });
    } else {
      var ok = fallbackCopyText(text);
      done(ok);
      toast(ok ? 'Copied' : 'Copy failed', ok ? 'Tracking code copied' : 'Please copy manually', ok ? 'success' : 'error');
    }
  }

  function fallbackCopyText(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function shareShipment(btn, code) {
    if (!code) return;
    var link = '';
    try {
      var u = new URL(window.location.href);
      u.searchParams.set('code', code);
      link = u.toString();
    } catch (e) { link = code; }

    if (navigator.share) {
      navigator.share({ title: 'GlobalExpress Tracking', text: 'Track ' + code, url: link })
        .catch(function () { copyWithAnimation(btn, link); });
    } else {
      copyWithAnimation(btn, link);
    }
  }

  // ================================================================
  // EXPORT
  // ================================================================
  function exportData(rows, filename) {
    var blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Export downloaded', rows.length + ' shipments', 'success');
  }

  // ================================================================
  // FULL-PAGE EDIT OVERLAY
  // ================================================================
  function coordField(id, label, value) {
    var v = (value === 0 || value) ? value : '';
    return '<div class="eo-field">'
         +   '<label>' + esc(label) + '</label>'
         +   '<input type="number" step="any" id="' + id + '" value="' + (v === '' ? '' : esc(v)) + '" />'
         + '</div>';
  }

  function openEditModal(code) {
    if (!code) { toast('Edit failed', 'Missing tracking code', 'error'); return; }

    var s = findShip(code);
    if (!s) { toast('Shipment not found', code, 'error'); return; }

    var existing = document.getElementById('editOverlay');
    if (existing) existing.remove();

    var c = s.coords || {};
    var origin  = c.origin  || {};
    var current = c.current || {};
    var dest    = c.dest    || {};

    var overlay = document.createElement('div');
    overlay.id = 'editOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'editOverlayTitle');

    overlay.innerHTML = `
      <style>
        #editOverlay { position:fixed; inset:0; z-index:9999; display:flex; justify-content:flex-end; }
        #editOverlay .eo-backdrop {
          position:absolute; inset:0; background:rgba(11,37,69,.55);
          backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
          animation:eoFade .25s ease;
        }
        #editOverlay .eo-panel {
          position:relative; width:min(720px,100%); height:100%;
          background:var(--bg,#f5f7fa); box-shadow:-24px 0 64px rgba(15,23,42,.25);
          display:flex; flex-direction:column;
          animation:eoSlide .35s cubic-bezier(.4,0,.2,1);
        }
        @keyframes eoFade  { from { opacity:0 } to { opacity:1 } }
        @keyframes eoSlide { from { transform:translateX(40px); opacity:0 } to { transform:none; opacity:1 } }
        #editOverlay .eo-head {
          padding:20px 28px; background:#fff; border-bottom:1px solid var(--border,#e4e8ee);
          display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-shrink:0;
        }
        #editOverlay .eo-head h3 { margin:0 0 4px; font-size:20px; font-weight:800; color:var(--text,#0f172a); }
        #editOverlay .eo-head .sub { font-size:13px; color:var(--text-3,#94a3b8); }
        #editOverlay .eo-head .mono { font-family:Monaco,Menlo,Consolas,monospace; font-weight:700; color:var(--text,#0f172a); }
        #editOverlay .eo-close {
          width:40px; height:40px; border-radius:10px; background:var(--surface-2,#fafbfc);
          border:none; color:var(--text-2,#475569); font-size:16px; cursor:pointer;
          display:flex; align-items:center; justify-content:center; transition:all .18s ease;
        }
        #editOverlay .eo-close:hover { background:#fef2f2; color:#dc2626; }
        #editOverlay .eo-body { padding:28px; overflow-y:auto; flex:1; }
        #editOverlay .eo-section { margin-bottom:26px; }
        #editOverlay .eo-section h4 {
          margin:0 0 14px; font-size:13px; font-weight:800;
          text-transform:uppercase; letter-spacing:.6px; color:var(--brand,#0b2545);
          display:flex; align-items:center; gap:8px;
          padding-bottom:10px; border-bottom:1px solid var(--border,#e4e8ee);
        }
        #editOverlay .eo-section h4 i { color:var(--accent,#FF6B35); }
        #editOverlay .eo-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
        #editOverlay .eo-field { display:flex; flex-direction:column; gap:6px; }
        #editOverlay .eo-field.full { grid-column:1/-1; }
        #editOverlay .eo-field label { font-size:12.5px; font-weight:600; color:var(--text,#0f172a); }
        #editOverlay .eo-field input,
        #editOverlay .eo-field select {
          padding:10px 12px; border:1px solid var(--border,#e4e8ee);
          border-radius:8px; font-size:14px; background:#fff; color:var(--text,#0f172a);
          font-family:inherit; transition:border-color .15s ease;
        }
        #editOverlay .eo-field input:focus,
        #editOverlay .eo-field select:focus { border-color:var(--accent,#FF6B35); outline:none; }
        #editOverlay .eo-hint { font-size:11px; color:var(--text-3,#94a3b8); margin-top:2px; }
        #editOverlay .eo-foot {
          padding:16px 28px; background:#fff; border-top:1px solid var(--border,#e4e8ee);
          display:flex; justify-content:space-between; align-items:center; gap:16px; flex-shrink:0;
        }
        #editOverlay .eo-foot-note { font-size:12px; color:var(--text-3,#94a3b8); }
        #editOverlay .eo-foot-btns { display:flex; gap:10px; }
        #editOverlay .eo-btn {
          padding:10px 20px; border-radius:8px; font-weight:600; font-size:14px;
          cursor:pointer; font-family:inherit; transition:all .18s ease;
        }
        #editOverlay .eo-btn.cancel { background:#fff; border:1px solid var(--border,#e4e8ee); color:var(--text-2,#475569); }
        #editOverlay .eo-btn.cancel:hover { background:var(--surface-2,#fafbfc); }
        #editOverlay .eo-btn.save {
          background:var(--accent,#FF6B35); border:none; color:#fff;
          box-shadow:0 4px 12px rgba(255,107,53,.3);
          display:inline-flex; align-items:center; gap:8px;
        }
        #editOverlay .eo-btn.save:hover { background:#e55627; transform:translateY(-1px); }
        #editOverlay .eo-btn.save:disabled { opacity:.7; cursor:not-allowed; transform:none; }
        @media (max-width:600px) {
          #editOverlay .eo-grid { grid-template-columns:1fr; }
          #editOverlay .eo-head { padding:16px 18px; }
          #editOverlay .eo-body { padding:20px 18px; }
          #editOverlay .eo-foot { padding:14px 18px; flex-direction:column; align-items:stretch; }
          #editOverlay .eo-foot-btns { justify-content:stretch; }
          #editOverlay .eo-btn { flex:1; justify-content:center; }
        }
      </style>

      <div class="eo-backdrop" data-close></div>
      <div class="eo-panel">
        <div class="eo-head">
          <div>
            <h3 id="editOverlayTitle"><i class="fas fa-pen-to-square" style="color:var(--accent);margin-right:8px"></i> Edit Shipment</h3>
            <div class="sub"><span class="mono">${esc(s.trackingCode)}</span> · Created ${esc(s.createdAt)}</div>
          </div>
          <button type="button" class="eo-close" data-close aria-label="Close"><i class="fas fa-xmark"></i></button>
        </div>

        <div class="eo-body">
          <div class="eo-section">
            <h4><i class="fas fa-truck-fast"></i> Status &amp; Location</h4>
            <div class="eo-grid">
              <div class="eo-field">
                <label>Status</label>
                <select id="ed_status">
                  ${STATUSES.map(v => `<option value="${esc(v)}" ${s.status===v?'selected':''}>${esc(v)}</option>`).join('')}
                </select>
                <div class="eo-hint">Changing status adds a timeline entry.</div>
              </div>
              <div class="eo-field">
                <label>Service Level</label>
                <select id="ed_service">
                  ${SERVICE_LEVELS.map(v => `<option value="${esc(v)}" ${s.serviceLevel===v?'selected':''}>${esc(v)}</option>`).join('')}
                </select>
              </div>
              <div class="eo-field">
                <label>Current Location</label>
                <input type="text" id="ed_current" value="${esc(s.currentLocation)}" placeholder="e.g. Memphis, TN" />
              </div>
              <div class="eo-field">
                <label>Estimated Delivery</label>
                <input type="text" id="ed_eta" value="${esc(s.estimatedDelivery)}" placeholder="e.g. Oct 5, 2026" />
              </div>
            </div>
          </div>

          <div class="eo-section">
            <h4><i class="fas fa-box"></i> Package</h4>
            <div class="eo-grid">
              <div class="eo-field">
                <label>Package Type</label>
                <select id="ed_pkgtype">
                  ${PACKAGE_TYPES.map(v => `<option value="${esc(v)}" ${s.packageType===v?'selected':''}>${esc(v)}</option>`).join('')}
                </select>
              </div>
              <div class="eo-field">
                <label>Dimensions</label>
                <input type="text" id="ed_dims" value="${esc(s.dimensions)}" placeholder="e.g. 30 × 20 × 15 cm" />
              </div>
              <div class="eo-field">
                <label>Weight</label>
                <input type="text" id="ed_weight" value="${esc(s.weight)}" placeholder="e.g. 2.4 kg" />
              </div>
              <div class="eo-field">
                <label>Special Handling</label>
                <select id="ed_handling">
                  ${HANDLING_OPTIONS.map(v => `<option value="${esc(v)}" ${s.handling===v?'selected':''}>${esc(v)}</option>`).join('')}
                </select>
              </div>
              <div class="eo-field full">
                <label>Contents Description</label>
                <input type="text" id="ed_contents" value="${esc(s.contents)}" placeholder="What is inside?" />
              </div>
            </div>
          </div>

          <div class="eo-section">
            <h4><i class="fas fa-map-location-dot"></i> Map Coordinates</h4>
            <p style="font-size:12.5px;color:var(--text-3);margin:0 0 14px">Used for the live map. Leave blank if unknown (blank = null, not 0,0).</p>
            <div class="eo-grid">
              ${coordField('ed_origin_lat','Origin Latitude',origin.lat)}
              ${coordField('ed_origin_lng','Origin Longitude',origin.lng)}
              ${coordField('ed_current_lat','Current Latitude',current.lat)}
              ${coordField('ed_current_lng','Current Longitude',current.lng)}
              ${coordField('ed_dest_lat','Destination Latitude',dest.lat)}
              ${coordField('ed_dest_lng','Destination Longitude',dest.lng)}
            </div>
          </div>

          <div class="eo-section">
            <h4><i class="fas fa-clock-rotate-left"></i> Timeline Note</h4>
            <div class="eo-field">
              <label>Add a note (optional)</label>
              <input type="text" id="ed_note" placeholder="e.g. Departed sorting facility" />
              <div class="eo-hint">This will appear on the shipment timeline as a new event.</div>
            </div>
          </div>
        </div>

        <div class="eo-foot">
          <div class="eo-foot-note">Changes save to Supabase immediately.</div>
          <div class="eo-foot-btns">
            <button type="button" class="eo-btn cancel" data-close>Cancel</button>
            <button type="button" class="eo-btn save" data-save><i class="fas fa-save"></i> Save Changes</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    function close() {
      overlay.style.transition = 'opacity .2s ease';
      overlay.style.opacity = '0';
      setTimeout(function () {
        if (overlay.parentNode) overlay.remove();
        document.body.style.overflow = '';
      }, 200);
    }

    overlay.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) { close(); return; }
      if (e.target === overlay) { close(); return; }
      if (e.target.closest('[data-save]')) { saveEditOverlay(s, overlay, close); return; }
    });

    function onKey(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(); }
    }
    document.addEventListener('keydown', onKey);

    setTimeout(function () {
      var first = overlay.querySelector('#ed_status');
      if (first) first.focus();
    }, 350);
  }

  async function saveEditOverlay(s, overlay, closeFn) {
    var client = sb();
    if (!client) { toast('Edit failed', 'Supabase not configured', 'error'); return; }

    var btn = overlay.querySelector('[data-save]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving…'; }

    function gv(id) {
      var el = overlay.querySelector('#' + id);
      return el ? String(el.value || '').trim() : '';
    }
    function numOrNull(id) {
      var v = gv(id);
      if (v === '') return null;
      var n = parseFloat(v);
      return isNaN(n) ? null : n;
    }

    var nextStatus   = gv('ed_status') || s.status;
    var nextCurrent  = gv('ed_current') || s.currentLocation;
    var nextEta      = gv('ed_eta');
    var nextService  = gv('ed_service') || s.serviceLevel;
    var nextPkgType  = gv('ed_pkgtype') || s.packageType;
    var nextDims     = gv('ed_dims');
    var nextWeight   = gv('ed_weight');
    var nextHandling = gv('ed_handling') || s.handling;
    var nextContents = gv('ed_contents');
    var note         = gv('ed_note');

    var nextCoords = {
      origin:  { lat: numOrNull('ed_origin_lat'),  lng: numOrNull('ed_origin_lng') },
      current: { lat: numOrNull('ed_current_lat'), lng: numOrNull('ed_current_lng') },
      dest:    { lat: numOrNull('ed_dest_lat'),    lng: numOrNull('ed_dest_lng') }
    };

    var nextActivities = (s.activities || []).slice();
    if (note) nextActivities.push({ date: fmtDT(), location: nextCurrent || '—', description: note });
    if (nextStatus !== s.status) nextActivities.push({ date: fmtDT(), location: nextCurrent || '—', description: 'Status changed to ' + nextStatus });

    try {
      var res = await client.schema('app').from('shipments').update({
        status: nextStatus,
        current_location: nextCurrent,
        estimated_delivery: nextEta,
        service_level: nextService,
        package_type: nextPkgType,
        dimensions: nextDims,
        weight: nextWeight,
        handling: nextHandling,
        contents: nextContents,
        coords: nextCoords,
        activities: nextActivities
      }).eq('id', s.id);

      if (res.error) throw res.error;

      s.status             = nextStatus;
      s.currentLocation    = nextCurrent;
      s.estimatedDelivery  = nextEta;
      s.serviceLevel       = nextService;
      s.packageType        = nextPkgType;
      s.dimensions         = nextDims;
      s.weight             = nextWeight;
      s.handling           = nextHandling;
      s.contents           = nextContents;
      s.coords             = nextCoords;
      s.activities         = nextActivities;

      closeFn();
      toast('Shipment updated', 'Changes saved successfully.', 'success');
      renderTable();
    } catch (err) {
      console.error(err);
      toast('Update failed', err.message || 'Please try again.', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
    }
  }

  // ================================================================
  // COPY ANIMATION CSS (injected once)
  // ================================================================
  function injectCopyCss() {
    if (document.getElementById('geCopyCss')) return;
    var style = document.createElement('style');
    style.id = 'geCopyCss';
    style.textContent = `
      .copy-code-btn {
        position: relative;
        width: 26px; height: 26px; border-radius: 6px;
        background: transparent; border: none;
        color: var(--text-3, #94a3b8); font-size: 11px;
        display: inline-flex; align-items: center; justify-content: center;
        cursor: pointer; opacity: 0;
        transition: opacity .18s ease, background .18s ease, color .18s ease, transform .18s ease;
      }
      tr:hover .copy-code-btn,
      .copy-code-btn:focus-visible { opacity: 1; }
      .copy-code-btn:hover { background: var(--surface-2, #fafbfc); color: var(--accent, #FF6B35); }
      .copy-code-btn.copying { background: rgba(255,107,53,.12); color: var(--accent, #FF6B35); }
      .copy-code-btn.copied  { background: rgba(5,150,105,.12); color: var(--green, #059669); transform: scale(1.12); }
      .copy-code-btn.copied::after {
        content: '';
        position: absolute; inset: -4px;
        border-radius: 8px;
        border: 2px solid var(--green, #059669);
        opacity: 0;
        animation: geCopyRing .8s ease-out forwards;
      }
      @keyframes geCopyRing {
        0%   { opacity: 1; transform: scale(.9); }
        100% { opacity: 0; transform: scale(1.4); }
      }
    `;
    document.head.appendChild(style);
  }

  // ================================================================
  // BIND
  // ================================================================
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    injectCopyCss();

    var user = currentUser(ctx);
    if (user) fetchShipments(user);

    var code = ctx && ctx.params && ctx.params.code;
    if (code && !deepLinkHandled) {
      deepLinkHandled = true;
      setTimeout(function () {
        if (findShip(code)) {
          if (global.App && global.App.go) global.App.go('shipment', { code: code });
        } else {
          toast('Shipment not found', code, 'error');
        }
      }, 300);
    }

    if (handler) container.removeEventListener('click', handler);

    handler = function (e) {
      // Tabs
      var tab = e.target.closest && e.target.closest('[data-tab]');
      if (tab) {
        activeTab = tab.dataset.tab;
        pageNum = 1;
        var tabs = container.querySelectorAll('[data-tab]');
        for (var t = 0; t < tabs.length; t++) {
          tabs[t].classList.toggle('active', tabs[t].dataset.tab === activeTab);
        }
        renderTable();
        return;
      }

      // Sort
      var thEl = e.target.closest && e.target.closest('[data-sort-key]');
      if (thEl) {
        var key = thEl.dataset.sortKey;
        if (key === sortKey) sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
        else { sortKey = key; sortDir = 'asc'; }
        pageNum = 1;
        var theadRow = container.querySelector('.table-cards thead tr');
        if (theadRow) {
          theadRow.innerHTML = ''
            + '<th class="hide-sm" style="width:36px"><input type="checkbox" id="selectAll" aria-label="Select all" /></th>'
            + th('code', 'Tracking Code')
            + '<th>Route</th>'
            + th('recipient', 'Recipient')
            + th('status', 'Status')
            + th('eta', 'Est. Delivery')
            + '<th class="tbl-actions">Actions</th>';
        }
        renderTable();
        return;
      }

      // Pagination
      var pageBtn = e.target.closest && e.target.closest('[data-page]');
      if (pageBtn) { pageNum = parseInt(pageBtn.dataset.page, 10) || 1; renderTable(); return; }
      if (e.target.closest && e.target.closest('[data-page-prev]')) { if (pageNum > 1) { pageNum--; renderTable(); } return; }
      if (e.target.closest && e.target.closest('[data-page-next]')) { pageNum++; renderTable(); return; }

      // Row checkbox
      var rowCheck = e.target.closest && e.target.closest('[data-row-check]');
      if (rowCheck) {
        var c1 = rowCheck.dataset.code;
        if (rowCheck.checked) selected[c1] = true;
        else delete selected[c1];
        rowCheck.closest('tr').classList.toggle('row-selected', rowCheck.checked);
        updateBulkBar();
        return;
      }

      // Select all (current page)
      if (e.target.id === 'selectAll') {
        var checked = e.target.checked;
        var pageRows = container.querySelectorAll('#shipTbody tr[data-code]');
        for (var i = 0; i < pageRows.length; i++) {
          var cc = pageRows[i].dataset.code;
          var cb = pageRows[i].querySelector('[data-row-check]');
          if (cb) cb.checked = checked;
          if (checked) selected[cc] = true; else delete selected[cc];
          pageRows[i].classList.toggle('row-selected', checked);
        }
        updateBulkBar();
        return;
      }

      // Actions
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var code2  = btn.dataset.code;

      if (action === 'new')         { if (global.App) global.App.go('create'); return; }
      if (action === 'export')      { exportData(getUserShips(), 'globalexpress-shipments-' + Date.now() + '.json'); return; }
      if (action === 'edit')        { openEditModal(code2); return; }
      if (action === 'share')       { shareShipment(btn, code2); return; }
      if (action === 'copy')        { copyWithAnimation(btn, code2); return; }
      if (action === 'track')       { if (global.App) global.App.go('tracking', { code: code2 }); return; }
      if (action === 'retry')       { var u = currentUser(ctx); if (u) fetchShipments(u); return; }
      if (action === 'clear-filters') {
        query = ''; activeTab = 'all'; pageNum = 1;
        var s1 = document.getElementById('shipSearch');
        if (s1) s1.value = '';
        container.innerHTML = render({});
        bind({});
        return;
      }
      if (action === 'bulk-clear')  { clearSelection(); renderTable(); return; }
      if (action === 'bulk-export') {
        var rows = getUserShips().filter(function (sh) { return selected[sh.trackingCode]; });
        exportData(rows, 'globalexpress-selected-' + Date.now() + '.json');
        return;
      }
    };

    container.addEventListener('click', handler);

    // Row click → edit (skip buttons/inputs/links)
    container.addEventListener('click', function (e) {
      var row = e.target.closest && e.target.closest('tr[data-code]');
      if (!row) return;
      if (e.target.closest('button')) return;
      if (e.target.closest('input')) return;
      if (e.target.closest('a')) return;
      var c = row.dataset.code;
      if (c) openEditModal(c);
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
          renderTable();
        }, 140);
      });
    }
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    if (UI.closeAllModals) UI.closeAllModals();
    var ov = document.getElementById('editOverlay');
    if (ov) ov.remove();
    document.body.style.overflow = '';
    container = null;
    handler = null;
    activeTab = 'all';
    query = '';
    sortKey = 'created';
    sortDir = 'desc';
    pageNum = 1;
    selected = {};
    deepLinkHandled = false;
    state.shipments = [];
    state.isLoading = true;
    state.error = null;
  }

  // ================================================================
  // REGISTER
  // ================================================================
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