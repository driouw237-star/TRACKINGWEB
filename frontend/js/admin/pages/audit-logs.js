/* ================================================================
   GlobalExpress — Admin Audit Logs Page
   ================================================================
   Read-only audit trail: every action taken by an admin, in order.

   Renders:
     - 4 KPI tiles: total entries, last 24h, today, distinct admins
     - Filter bar: search, action filter, admin filter, date range
     - Table: when / admin / action tag / target / details
     - CSV export (respects current filters)
     - Auto-refresh on audit:created via admin.js

   READ-ONLY: never writes to ge_audit. The audit log is append-only
   and only Admin.logAudit() writes to it.

   Deep-link: Admin.state.params.action pre-applies an action filter.
   Deep-link: Admin.state.params.userId pre-applies an admin filter.

   Registers with Admin.register('audit', page).
   ================================================================ */

(function (global) {
  'use strict';

  /* ================================================================
     §1 — DEPENDENCIES
     ================================================================ */
  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  /* ================================================================
     §2 — FALLBACKS
     ================================================================ */

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var comma = Utils.comma || function (n) {
    return Number(n || 0).toLocaleString('en-US');
  };

  var fmtDT = Utils.fmtDT || function (d) {
    return new Date(d || Date.now()).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  };

  var toast = UI.toast || function (t, m, k) {
    if (global.console) console.log('[toast]', t, m || '', k || '');
  };

  var storage = (Utils.storage && typeof Utils.storage.get === 'function')
    ? Utils.storage
    : {
        get: function (k, fallback) {
          try {
            var raw = localStorage.getItem(k);
            return raw === null ? fallback : JSON.parse(raw);
          } catch (e) { return fallback; }
        }
      };

  /* ================================================================
     §3 — KEYS + CONSTANTS
     ================================================================ */

  var KEYS = {
    audit: 'ge_audit'
  };

  var PAGE_SIZE = 25;

  // Known action prefixes → a short category + tag class
  var ACTION_CATEGORIES = [
    { prefix: 'user.',     label: 'Users',     cls: 'user'     },
    { prefix: 'shipment.', label: 'Shipments', cls: 'shipment' },
    { prefix: 'payment.',  label: 'Payments',  cls: 'payment'  },
    { prefix: 'wallet.',   label: 'Wallet',    cls: 'wallet'   },
    { prefix: 'ticket.',   label: 'Tickets',   cls: 'ticket'   },
    { prefix: 'settings.', label: 'Settings',  cls: 'settings' }
  ];

  // Human-readable labels for common actions
  var ACTION_LABELS = {
    'user.promote':         'Promoted to admin',
    'user.demote':          'Demoted to user',
    'user.reset-password':  'Reset password',
    'user.suspend':         'Suspended user',
    'user.unsuspend':       'Reactivated user',
    'user.update':          'Updated user',
    'user.delete':          'Deleted user',

    'shipment.update':      'Updated shipment',
    'shipment.delete':      'Deleted shipment',
    'shipment.bulk-update': 'Bulk status update',

    'payment.refund':       'Refunded payment',

    'wallet.credit':        'Wallet credited',
    'wallet.debit':         'Wallet debited',
    'wallet.adjust':        'Wallet adjusted',

    'ticket.reply':         'Replied to ticket',
    'ticket.resolve':       'Resolved ticket',
    'ticket.escalate':      'Escalated priority',
    'ticket.status':        'Changed ticket status',

    'settings.save':        'Saved settings',
    'settings.update':      'Updated settings'
  };

  /* ================================================================
     §4 — MODULE STATE
     ================================================================ */

  var state = {
    query:        '',
    actionFilter: '',
    adminFilter:  '',
    fromDate:     '',
    toDate:       '',
    pageNum:      1
  };

  var handler         = null;
  var container       = null;
  var deepLinkHandled = false;

  /* ================================================================
     §5 — STORAGE READERS
     ================================================================ */

  function readAudit() {
    var list = storage.get(KEYS.audit, []);
    return Array.isArray(list) ? list : [];
  }

  /* ================================================================
     §6 — HELPERS
     ================================================================ */

  function parseDateSafe(s) {
    if (!s) return 0;
    var t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function endOfDay(ts) {
    var d = new Date(ts);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }

  function categoryFor(action) {
    if (!action) return { label: 'Other', cls: 'default' };
    for (var i = 0; i < ACTION_CATEGORIES.length; i++) {
      var c = ACTION_CATEGORIES[i];
      if (action.indexOf(c.prefix) === 0) return c;
    }
    return { label: 'Other', cls: 'default' };
  }

  function labelFor(action) {
    if (!action) return '—';
    if (ACTION_LABELS[action]) return ACTION_LABELS[action];
    // Fallback: title-case the tail after the dot, replace dashes
    var tail = action.indexOf('.') >= 0
      ? action.slice(action.indexOf('.') + 1)
      : action;
    return tail
      .replace(/-/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function uniqueAdmins(list) {
    var seen = {};
    var admins = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || !e.userId) continue;
      if (seen[e.userId]) continue;
      seen[e.userId] = true;
      admins.push({
        id:   e.userId,
        name: e.userName || e.userId
      });
    }
    admins.sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
    return admins;
  }

  function uniqueActions(list) {
    var seen = {};
    var actions = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i] && list[i].action;
      if (!a || seen[a]) continue;
      seen[a] = true;
      actions.push(a);
    }
    actions.sort();
    return actions;
  }

  function matchesQuery(e, q) {
    if (!q) return true;
    var hay = [
      e.action   || '',
      e.target   || '',
      e.details  || '',
      e.userName || '',
      e.userId   || ''
    ].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function matchesAction(e, action) {
    if (!action) return true;
    if (e.action === action) return true;
    // Also match category prefix, e.g. "user" matches "user.promote"
    if (e.action && e.action.indexOf(action + '.') === 0) return true;
    return false;
  }

  function matchesAdmin(e, adminId) {
    if (!adminId) return true;
    return e.userId === adminId;
  }

  function inDateRange(e, from, to) {
    if (!from && !to) return true;
    var ts = parseDateSafe(e.at);
    if (!ts) return true;
    if (from) {
      var f = startOfDay(Date.parse(from));
      if (ts < f) return false;
    }
    if (to) {
      var t = endOfDay(Date.parse(to));
      if (ts > t) return false;
    }
    return true;
  }

  /* ================================================================
     §7 — PIPELINE
     ================================================================ */

  function pipeline() {
    var list = readAudit();
    var totalAll = list.length;

    // Newest first
    list.sort(function (a, b) {
      return parseDateSafe(b.at) - parseDateSafe(a.at);
    });

    var q = state.query.trim().toLowerCase();
    if (q) list = list.filter(function (e) { return matchesQuery(e, q); });

    if (state.actionFilter) {
      list = list.filter(function (e) { return matchesAction(e, state.actionFilter); });
    }
    if (state.adminFilter) {
      list = list.filter(function (e) { return matchesAdmin(e, state.adminFilter); });
    }
    if (state.fromDate || state.toDate) {
      list = list.filter(function (e) { return inDateRange(e, state.fromDate, state.toDate); });
    }

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

  /* ================================================================
     §8 — KPI COMPUTATION
     ================================================================ */

  function computeKpis() {
    var list = readAudit();
    var now = Date.now();
    var last24 = now - (24 * 60 * 60 * 1000);
    var todayStart = startOfDay(now);

    var last24Count = 0;
    var todayCount = 0;
    var admins = {};

    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e) continue;
      var ts = parseDateSafe(e.at);
      if (ts >= last24) last24Count++;
      if (ts >= todayStart) todayCount++;
      if (e.userId) admins[e.userId] = true;
    }

    return {
      total:        list.length,
      last24:       last24Count,
      today:        todayCount,
      distinctAdmins: Object.keys(admins).length
    };
  }

  /* ================================================================
     §9 — ROW RENDERING
     ================================================================ */

  function rowHtml(e) {
    var cat = categoryFor(e.action);
    var label = labelFor(e.action);
    var initial = (e.userName || 'A').charAt(0).toUpperCase();

    return ''
      + '<tr>'
      +   '<td style="font-size:11.5px;color:var(--text-3);'
      +     'font-family:var(--font-mono);white-space:nowrap">'
      +     esc(e.at || '—')
      +   '</td>'

      +   '<td>'
      +     '<div class="cell-user" style="gap:8px">'
      +       '<div class="av" style="width:26px;height:26px;font-size:10px">'
      +         esc(initial)
      +       '</div>'
      +       '<div style="font-size:12.5px;font-weight:600;color:var(--text)">'
      +         esc(e.userName || '—')
      +       '</div>'
      +     '</div>'
      +   '</td>'

      +   '<td>'
      +     '<span class="audit-action-tag ' + esc(cat.cls) + '">'
      +       '<i class="fas fa-circle" style="font-size:5px"></i> '
      +       esc(label)
      +     '</span>'
      +   '</td>'

      +   '<td class="mono" style="font-size:12px;color:var(--text-2);'
      +     'max-width:220px;overflow:hidden;text-overflow:ellipsis;'
      +     'white-space:nowrap">'
      +     esc(e.target || '—')
      +   '</td>'

      +   '<td style="font-size:12.5px;color:var(--text-2);'
      +     'max-width:360px;overflow:hidden;text-overflow:ellipsis;'
      +     'white-space:nowrap">'
      +     esc(e.details || '—')
      +   '</td>'
      + '</tr>';
  }

  /* ================================================================
     §10 — EMPTY STATES
     ================================================================ */

  function emptyNoAudit() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-clipboard-list"></i></div>'
      +   '<h4>No audit entries yet</h4>'
      +   '<p>Admin actions will be recorded here automatically.</p>'
      + '</div>';
  }

  function emptyNoMatch() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-magnifying-glass"></i></div>'
      +   '<h4>No matching entries</h4>'
      +   '<p>Try a different search, action, admin, or date range.</p>'
      +   '<button type="button" class="btn btn-outline" data-action="clear-filters">'
      +     '<i class="fas fa-rotate-left"></i> Clear filters'
      +   '</button>'
      + '</div>';
  }

  /* ================================================================
     §11 — TABLE RENDER
     ================================================================ */

  function renderRows() {
    var tbody = document.getElementById('auditTbody');
    if (!tbody) return;

    var result = pipeline();

    if (result.all === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">'
        + emptyNoAudit() + '</td></tr>';
    } else if (result.filtered === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">'
        + emptyNoMatch() + '</td></tr>';
    } else {
      tbody.innerHTML = result.slice.map(rowHtml).join('');
    }

    var countEl = document.getElementById('auditCount');
    if (countEl) {
      countEl.textContent = result.filtered === result.all
        ? result.all + ' entr' + (result.all === 1 ? 'y' : 'ies')
        : result.filtered + ' of ' + result.all + ' entries';
    }

    renderFooter(result);
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
    var foot = document.getElementById('auditFooter');
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
     §12 — CSV EXPORT
     ================================================================ */

  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function exportCSV() {
    // Export the entire FILTERED set, not just the current page
    var list = readAudit();

    list.sort(function (a, b) {
      return parseDateSafe(b.at) - parseDateSafe(a.at);
    });

    var q = state.query.trim().toLowerCase();
    if (q) list = list.filter(function (e) { return matchesQuery(e, q); });
    if (state.actionFilter) list = list.filter(function (e) { return matchesAction(e, state.actionFilter); });
    if (state.adminFilter)  list = list.filter(function (e) { return matchesAdmin(e, state.adminFilter); });
    if (state.fromDate || state.toDate) {
      list = list.filter(function (e) { return inDateRange(e, state.fromDate, state.toDate); });
    }

    var header = ['Timestamp', 'Admin', 'Action', 'Target', 'Details'];
    var lines = [header.join(',')];

    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      lines.push([
        csvEscape(e.at),
        csvEscape(e.userName || e.userId),
        csvEscape(e.action),
        csvEscape(e.target),
        csvEscape(e.details)
      ].join(','));
    }

    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'globalexpress-audit-' + Date.now() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast('CSV downloaded', list.length + ' entr' + (list.length === 1 ? 'y' : 'ies'), 'success');
  }

  /* ================================================================
     §13 — MAIN RENDER
     ================================================================ */

  function render(ctx) {
    var kpis = computeKpis();
    var allEntries = readAudit();
    var admins  = uniqueAdmins(allEntries);
    var actions = uniqueActions(allEntries);

    var kpisHtml = ''
      + '<div class="admin-kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">'
      +   kpiTile('fa-clipboard-list', 'blue',   comma(kpis.total),           'Total Entries',    'All time')
      +   kpiTile('fa-clock',          'amber',  comma(kpis.last24),          'Last 24 Hours',    'Recent activity')
      +   kpiTile('fa-calendar-day',   'green',  comma(kpis.today),           'Today',            'Since midnight')
      +   kpiTile('fa-user-shield',    'purple', comma(kpis.distinctAdmins),  'Admins',           'With logged actions')
      + '</div>';

    var panelHtml = ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3>'
      +       '<i class="fas fa-clipboard-list"></i> Audit Log'
      +       ' <span id="auditCount" style="font-weight:500;color:var(--text-3);font-size:13px;margin-left:6px"></span>'
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
      +       '<input type="text" id="auditSearch" '
      +         'placeholder="Search action, target, admin…" '
      +         'value="' + esc(state.query) + '" />'
      +     '</div>'
      +     '<select id="auditActionFilter" aria-label="Filter by action">'
      +       '<option value=""' + (state.actionFilter === '' ? ' selected' : '') + '>All actions</option>'
      +       ACTIONS_GROUPED(actions)
      +     '</select>'
      +     '<select id="auditAdminFilter" aria-label="Filter by admin">'
      +       '<option value=""' + (state.adminFilter === '' ? ' selected' : '') + '>All admins</option>'
      +       admins.map(function (a) {
            return '<option value="' + esc(a.id) + '"'
                 + (state.adminFilter === a.id ? ' selected' : '') + '>'
                 + esc(a.name) + '</option>';
          }).join('')
      +     '</select>'
      +     '<div class="date-range" '
      +       'style="display:flex;gap:6px;align-items:center">'
      +       '<input type="date" id="auditFrom" '
      +         'value="' + esc(state.fromDate) + '" aria-label="From date" '
      +         'style="padding:8px 11px;border:1.5px solid var(--border);'
      +         'border-radius:9px;background:var(--surface);font-size:12.5px" />'
      +       '<span style="color:var(--text-3);font-size:12px">to</span>'
      +       '<input type="date" id="auditTo" '
      +         'value="' + esc(state.toDate) + '" aria-label="To date" '
      +         'style="padding:8px 11px;border:1.5px solid var(--border);'
      +         'border-radius:9px;background:var(--surface);font-size:12.5px" />'
      +     '</div>'
      +   '</div>'

      +   '<div class="tbl-wrap dense">'
      +     '<table class="table-cards">'
      +       '<thead>'
      +         '<tr>'
      +           '<th style="width:160px">When</th>'
      +           '<th style="width:170px">Admin</th>'
      +           '<th style="width:200px">Action</th>'
      +           '<th style="width:220px">Target</th>'
      +           '<th>Details</th>'
      +         '</tr>'
      +       '</thead>'
      +       '<tbody id="auditTbody"></tbody>'
      +     '</table>'
      +   '</div>'

      +   '<div class="tbl-footer" id="auditFooter"></div>'
      + '</div>';

    return kpisHtml + panelHtml;
  }

  // Group actions under their category so the dropdown reads well
  function ACTIONS_GROUPED(actions) {
    var grouped = {};
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var cat = categoryFor(a);
      if (!grouped[cat.label]) grouped[cat.label] = [];
      grouped[cat.label].push(a);
    }

    var html = '';
    var keys = Object.keys(grouped).sort();
    for (var k = 0; k < keys.length; k++) {
      var label = keys[k];
      html += '<optgroup label="' + esc(label) + '">';
      var items = grouped[label].sort();
      for (var j = 0; j < items.length; j++) {
        var act = items[j];
        html += '<option value="' + esc(act) + '"'
              + (state.actionFilter === act ? ' selected' : '') + '>'
              + esc(labelFor(act)) + '</option>';
      }
      html += '</optgroup>';
    }
    return html;
  }

  function kpiTile(icon, color, value, label, sub) {
    var colorMap = {
      green:  { bg: '#ecfdf5', fg: 'var(--green)'  },
      red:    { bg: '#fef2f2', fg: 'var(--red)'    },
      blue:   { bg: '#eff6ff', fg: 'var(--blue)'   },
      purple: { bg: '#f5f3ff', fg: 'var(--purple)' },
      orange: { bg: '#fff7ed', fg: 'var(--accent)' },
      amber:  { bg: '#fffbeb', fg: 'var(--amber)'  }
    };
    var c = colorMap[color] || colorMap.blue;

    return ''
      + '<div class="admin-kpi">'
      +   '<div class="kpi-head">'
      +     '<div class="kpi-label">' + esc(label) + '</div>'
      +     '<div class="kpi-icon" style="background:' + c.bg + ';color:' + c.fg + '">'
      +       '<i class="fas ' + esc(icon) + '"></i>'
      +     '</div>'
      +   '</div>'
      +   '<div class="kpi-value">' + esc(value) + '</div>'
      +   (sub ? '<div class="kpi-trend flat">' + esc(sub) + '</div>' : '')
      + '</div>';
  }

  /* ================================================================
     §14 — BIND
     ================================================================ */

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (handler) container.removeEventListener('click', handler);

    // Pre-apply deep-link filters
    if (ctx && ctx.params) {
      if (typeof ctx.params.action === 'string') {
        state.actionFilter = ctx.params.action;
        var af = document.getElementById('auditActionFilter');
        if (af) af.value = ctx.params.action;
      }
      if (typeof ctx.params.userId === 'string') {
        state.adminFilter = ctx.params.userId;
        var uf = document.getElementById('auditAdminFilter');
        if (uf) uf.value = ctx.params.userId;
      }
    }

    renderRows();
    deepLinkHandled = true;   // this page has no modal to deep-link to

    handler = function (e) {
      // Pagination
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

      // Actions
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;

      var action = btn.dataset.action;

      if (action === 'export') {
        exportCSV();
        return;
      }
      if (action === 'clear-filters') {
        state.query        = '';
        state.actionFilter = '';
        state.adminFilter  = '';
        state.fromDate     = '';
        state.toDate       = '';
        state.pageNum      = 1;
        container.innerHTML = render(ctx);
        renderRows();
        attachInputListeners();
        return;
      }
    };

    container.addEventListener('click', handler);
    attachInputListeners();
  }

  function attachInputListeners() {
    var searchEl = document.getElementById('auditSearch');
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

    var actionEl = document.getElementById('auditActionFilter');
    if (actionEl && !actionEl.__wired) {
      actionEl.addEventListener('change', function () {
        state.actionFilter = actionEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      actionEl.__wired = true;
    }

    var adminEl = document.getElementById('auditAdminFilter');
    if (adminEl && !adminEl.__wired) {
      adminEl.addEventListener('change', function () {
        state.adminFilter = adminEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      adminEl.__wired = true;
    }

    var fromEl = document.getElementById('auditFrom');
    if (fromEl && !fromEl.__wired) {
      fromEl.addEventListener('change', function () {
        state.fromDate = fromEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      fromEl.__wired = true;
    }

    var toEl = document.getElementById('auditTo');
    if (toEl && !toEl.__wired) {
      toEl.addEventListener('change', function () {
        state.toDate = toEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      toEl.__wired = true;
    }
  }

  /* ================================================================
     §15 — CLEANUP
     ================================================================ */

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler   = null;

    state.query        = '';
    state.actionFilter = '';
    state.adminFilter  = '';
    state.fromDate     = '';
    state.toDate       = '';
    state.pageNum      = 1;

    deepLinkHandled = false;

    if (UI.closeAllModals) UI.closeAllModals();
  }

  /* ================================================================
     §16 — REGISTER
     ================================================================ */

  var page = {
    title:    'Audit Log',
    subtitle: 'Every admin action, in order',
    render:   render,
    bind:     bind,
    cleanup:  cleanup
  };

  if (global.Admin && typeof global.Admin.register === 'function') {
    global.Admin.register('audit', page);
  } else {
    global.PagesAdmin = global.PagesAdmin || {};
    global.PagesAdmin.audit = page;
  }

})(window);