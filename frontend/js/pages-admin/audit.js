/* ================================================================
   GlobalExpress — Admin Page: Audit Log (Pro Edition)
   ================================================================
   Immutable list of all admin actions. Includes filters, search,
   and a detailed modal showing the exact action taken.
   ================================================================ */

(function (global) {
  'use strict';

  var Utils     = global.Utils     || {};
  var UI        = global.UI        || {};
  var DataTable = global.DataTable || {};
  var Admin     = global.Admin     || null;

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var comma = Utils.comma || function (n) { return Number(n||0).toLocaleString('en-US'); };
  var fmtDate = Utils.fmtDT || function (d) {
    try { return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }); } 
    catch (e) { return '—'; }
  };
  var fmtRelative = Utils.fmtRelative || function (d) {
    var ts = Date.parse(d); if (isNaN(ts)) return '—';
    var diff = Date.now() - ts, sec = Math.floor(diff/1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec/60); if (min < 60) return min + 'm ago';
    var hr = Math.floor(min/60); if (hr < 24) return hr + 'h ago';
    return Math.floor(hr/24) + 'd ago';
  };
  var toast = UI.toast || function (t,m) { if (global.console) console.log(t, m); };

  var KEYS = { audit:'ge_audit' };

  var state = {
    activeTab: 'all',
    activeDateFilter: 'all',
    dt: null,
    logs: []
  };

  var pageHandler = null;
  var pageContainer = null;

  function read(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  // Safe date parser for sorting
  function parseWhen(s) {
    if (!s) return 0;
    var t = Date.parse(s);
    if (!isNaN(t)) return t;
    t = Date.parse(String(s).replace('·', '').trim());
    return isNaN(t) ? 0 : t;
  }

  function loadData() {
    state.logs = asArray(read(KEYS.audit, []));
    // Strictly sort newest first
    state.logs.sort(function(a, b) {
      var diff = parseWhen(b.at) - parseWhen(a.at);
      if (diff !== 0) return diff;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
  }

  function applyFilter(rows) {
    var tab = state.activeTab;
    var dateFilter = state.activeDateFilter;
    var now = Date.now();

    return rows.filter(function(l) {
      // 1. Category Filter
      var action = String(l.action || '');
      var passesTab = true;
      if (tab === 'users') passesTab = action.indexOf('user.') === 0;
      else if (tab === 'wallet') passesTab = action.indexOf('wallet.') === 0 || action.indexOf('shipment.') === 0 || action.indexOf('payment.') === 0;
      else if (tab === 'system') passesTab = action.indexOf('settings.') === 0 || action.indexOf('backup.') === 0 || action.indexOf('notification.') === 0;

      if (!passesTab) return false;

      // 2. Date Filter
      var at = parseWhen(l.at);
      if (dateFilter === 'today') {
        var startOfToday = new Date().setHours(0,0,0,0);
        if (at < startOfToday) return false;
      } else if (dateFilter === 'yesterday') {
        var startOfToday2 = new Date().setHours(0,0,0,0);
        var startOfYesterday = startOfToday2 - 86400000;
        if (at < startOfYesterday || at >= startOfToday2) return false;
      } else if (dateFilter === 'week') {
        if (at < now - 7 * 86400000) return false;
      }

      return true;
    });
  }

  function countForTab(tab) {
    var saved = state.activeTab;
    state.activeTab = tab;
    var n = applyFilter(state.logs).length;
    state.activeTab = saved;
    return n;
  }

  var TABS = [
    { key:'all', label:'All Actions' },
    { key:'users', label:'Users' },
    { key:'wallet', label:'Wallet & Shipments' },
    { key:'system', label:'System' }
  ];

  function renderTabsBar() {
    return '<div class="users-tabs-bar" style="display:flex;justify-content:space-between;align-items:center;">' +
      '<div style="display:flex;overflow-x:auto;">' +
        TABS.map(function (t) {
          var n = countForTab(t.key);
          var active = state.activeTab === t.key;
          return '<button type="button" class="users-tab' + (active ? ' active' : '') + '" ' +
            'data-audit-tab="' + esc(t.key) + '">' + esc(t.label) +
            '<span class="count">' + comma(n) + '</span></button>';
        }).join('') +
      '</div>' +
      '<div style="padding-right:12px;">' +
        '<select id="auditDateFilter" style="padding:6px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-weight:600;background:#fff;color:var(--text);">' +
          '<option value="all"' + (state.activeDateFilter === 'all' ? ' selected' : '') + '>All Time</option>' +
          '<option value="today"' + (state.activeDateFilter === 'today' ? ' selected' : '') + '>Today</option>' +
          '<option value="yesterday"' + (state.activeDateFilter === 'yesterday' ? ' selected' : '') + '>Yesterday</option>' +
          '<option value="week"' + (state.activeDateFilter === 'week' ? ' selected' : '') + '>Last 7 Days</option>' +
        '</select>' +
      '</div>' +
    '</div>';
  }

  function renderHeader() {
    return '<div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">' +
      '<div><h2>Audit Log</h2><p class="page-subtitle">Immutable record of all admin actions and system events.</p></div>' +
      '<div class="page-actions">' +
        '<button type="button" class="btn btn-outline btn-sm" data-action="export">' +
          '<i class="fas fa-download"></i> Export CSV</button>' +
      '</div></div>';
  }

  function auditTagClass(action) {
    if (!action) return 'default';
    if (action.indexOf('user') !== -1) return 'user';
    if (action.indexOf('wallet') !== -1) return 'wallet';
    if (action.indexOf('shipment') !== -1) return 'shipment';
    if (action.indexOf('payment') !== -1) return 'payment';
    if (action.indexOf('ticket') !== -1) return 'ticket';
    return 'system';
  }

  function buildColumns() {
    return [
      { key:'at', label:'Timestamp', sortable:true,
        sortValue:function (l) { return parseWhen(l.at); },
        render:function (l) {
          return '<span class="text-dim" title="' + esc(fmtDate(l.at)) + '">' + esc(fmtRelative(l.at)) + '</span>';
        } },
      { key:'userName', label:'Admin', sortable:true,
        render:function (l) {
          return '<div class="cell-user"><div class="meta"><div class="name">' + esc(l.userName || 'System') + '</div></div></div>';
        } },
      { key:'action', label:'Action', sortable:true,
        render:function (l) {
          var cls = auditTagClass(l.action);
          return '<span class="admin-badge role-' + cls + '">' + esc(l.action || 'UNKNOWN') + '</span>';
        } },
      { key:'target', label:'Target', sortable:true, hideSm:true,
        render:function (l) {
          return '<code class="mono">' + esc(l.target || '—') + '</code>';
        } },
      { key:'details', label:'Details', sortable:false,
        render:function (l) {
          var txt = l.details || '—';
          if (txt.length > 60) txt = txt.slice(0, 60) + '...';
          return '<span class="text-muted" title="' + esc(l.details) + '">' + esc(txt) + '</span>';
        } }
    ];
  }

  function buildActionsCol() {
    return {
      label:'',
      render:function (l) {
        return '<button type="button" class="btn btn-ghost btn-sm" ' +
            'data-audit-action="view" data-id="' + esc(l.id) + '" title="View Details">' +
            '<i class="fas fa-eye"></i></button>';
      }
    };
  }

  function exportCSV(rows) {
    var list = rows || state.logs;
    var csv = 'Date,Admin,Action,Target,Details\n';
    list.forEach(function(l) {
      var row = [
        '"' + fmtDate(l.at) + '"',
        '"' + (l.userName || 'System') + '"',
        '"' + (l.action || '') + '"',
        '"' + (l.target || '') + '"',
        '"' + (l.details || '').replace(/"/g, '""') + '"'
      ].join(',');
      csv += row + '\n';
    });

    try {
      var blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'audit-log-' + new Date().toISOString().slice(0,10) + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Exported', list.length + ' entries', 'success');
    } catch (e) { toast('Export failed', String(e.message||e), 'error'); }
  }

  function render(ctx) {
    loadData();
    return '<div class="audit-page" style="max-width:1200px;margin:0 auto;">' +
      renderHeader() + renderTabsBar() +
      '<div id="audit-table-mount"></div></div>';
  }

  function bind(ctx) {
    var mount = document.getElementById('audit-table-mount');
    if (!mount) return;

    if (state.dt && state.dt.destroy) { try { state.dt.destroy(); } catch (e) {} }
    state.dt = DataTable.create(mount, {
      key: 'admin-audit-' + state.activeTab + '-' + state.activeDateFilter,
      data: applyFilter(state.logs),
      rowId: function (l) { return l.id; },
      columns: buildColumns(),
      actionsCol: buildActionsCol(),
      searchKeys: ['action', 'target', 'details', 'userName'],
      pageSize: 30,
      emptyState: { icon:'fa-clipboard-list', title:'No audit logs', message:'Admin actions will be recorded here.' },
      onRowClick: function (log) { openLogDetail(log); }
    });

    pageContainer = document.getElementById('content');
    if (!pageContainer) return;
    if (pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageHandler = onPageClick;
    pageContainer.addEventListener('click', pageHandler);

    var dateFilterEl = document.getElementById('auditDateFilter');
    if (dateFilterEl) {
      dateFilterEl.addEventListener('change', function(e) {
        state.activeDateFilter = e.target.value;
        refresh();
      });
    }
  }

  function onPageClick(e) {
    var tab = e.target.closest('[data-audit-tab]');
    if (tab) {
      state.activeTab = tab.dataset.auditTab;
      refresh();
      return;
    }

    if (e.target.closest('[data-action="export"]')) {
      exportCSV(state.dt ? state.dt.data : state.logs);
      return;
    }

    var action = e.target.closest('[data-audit-action]');
    if (action) {
      var id = action.dataset.id;
      var log = state.logs.find(function(l) { return l.id === id; });
      if (log && action.dataset.auditAction === 'view') openLogDetail(log);
    }
  }

  function openLogDetail(log) {
    if (!UI.openModal) {
      toast('Audit Details', log.details || 'No details', 'info');
      return;
    }
    
    var cls = auditTagClass(log.action);
    
    var modal = UI.openModal(
      '<div class="modal narrow" style="max-width:640px">' +
        '<div class="modal-head" style="border-bottom:1px solid var(--adm-border);">' +
          '<div>' +
            '<h3>Audit Event Detail</h3>' +
            '<div class="sub">' + esc(fmtDate(log.at)) + '</div>' +
          '</div>' +
          '<button class="modal-close" data-close><i class="fas fa-times"></i></button>' +
        '</div>' +
        '<div class="modal-body" style="padding:24px;">' +
          
          '<div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;padding:16px;background:var(--surface-2);border-radius:12px;">' +
            '<div style="width:48px;height:48px;border-radius:50%;background:#fff;border:1px solid var(--adm-border);display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--brand);">' +
              '<i class="fas fa-shield-halved"></i>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:12px;font-weight:700;color:var(--text-3);text-transform:uppercase;">Action Taken</div>' +
              '<div style="font-size:16px;font-weight:800;color:var(--text);"><span class="admin-badge role-' + cls + '">' + esc(log.action) + '</span></div>' +
            '</div>' +
          '</div>' +

          '<div class="grid-2" style="gap:16px;margin-bottom:20px;">' +
            '<div class="field"><label>Admin</label><div style="font-weight:600;">' + esc(log.userName || 'System') + '</div><div style="font-size:12px;color:var(--text-3);">' + esc(log.userId) + '</div></div>' +
            '<div class="field"><label>Target</label><div><code class="mono" style="font-size:13px;background:var(--surface-2);padding:4px 8px;border-radius:6px">' + esc(log.target) + '</code></div></div>' +
          '</div>' +

          '<div class="field" style="margin-bottom:24px;">' +
            '<label>Details / Payload</label>' +
            '<div style="background:#1e293b;color:#e2e8f0;padding:16px;border-radius:10px;font-family:ui-monospace,monospace;font-size:12.5px;white-space:pre-wrap;line-height:1.6;overflow-x:auto;">' + 
              esc(log.details || 'No extra details provided.') + 
            '</div>' +
          '</div>' +

          '<div style="font-size:11.5px;color:var(--text-3);text-align:center;"><i class="fas fa-lock"></i> This audit record is immutable and cannot be altered.</div>' +

        '</div>' +
        '<div class="modal-foot">' +
          '<button class="btn btn-outline" data-close>Close</button>' +
        '</div>' +
      '</div>'
    );

    if (modal && UI.closeModal) {
      modal.addEventListener('click', function (e) {
        if (e.target.closest('[data-close]')) UI.closeModal(modal);
      });
    }
  }

  function refresh() {
    var content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = render({});
    bind({});
  }

  function cleanup() {
    if (state.dt && state.dt.destroy) { try { state.dt.destroy(); } catch (e) {} }
    state.dt = null;
    if (pageContainer && pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageContainer = null;
    pageHandler = null;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin.audit = {
    title: 'Audit Log',
    subtitle: 'Immutable record of all admin actions',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);