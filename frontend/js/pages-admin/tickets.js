/* ================================================================
   GlobalExpress — Admin Page: Support Tickets (Pro Edition)
   ================================================================ */

(function (global) {
  'use strict';

  var Utils     = global.Utils     || {};
  var UI        = global.UI        || {};
  var DataTable = global.DataTable || {};

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var comma = Utils.comma || function (n) { return Number(n||0).toLocaleString('en-US'); };
  var fmtRelative = Utils.fmtRelative || function (d) {
    var ts = Date.parse(d); if (isNaN(ts)) return '—';
    var diff = Date.now() - ts, sec = Math.floor(diff/1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec/60); if (min < 60) return min + 'm ago';
    var hr = Math.floor(min/60); if (hr < 24) return hr + 'h ago';
    return Math.floor(hr/24) + 'd ago';
  };
  var toast = UI.toast || function (t,m) { if (global.console) console.log(t, m); };

  var KEYS = { tickets:'ge_tickets', users:'ge_users' };

  var state = {
    activeTab: 'all',
    dt: null,
    tickets: [],
    usersMap: {}
  };

  var pageHandler = null;
  var pageContainer = null;

  function read(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  function loadData() {
    state.tickets = asArray(read(KEYS.tickets, []));
    var users = asArray(read(KEYS.users, []));
    var map = {};
    users.forEach(function (u) { map[u.id] = u; });
    state.usersMap = map;
  }

  function applyTabFilter(rows) {
    var tab = state.activeTab;
    if (tab === 'all') return rows;
    if (tab === 'open') return rows.filter(function(t) { return t.status === 'Open'; });
    if (tab === 'progress') return rows.filter(function(t) { return t.status === 'In Progress'; });
    if (tab === 'resolved') return rows.filter(function(t) { return t.status === 'Resolved' || t.status === 'Closed'; });
    if (tab === 'urgent') return rows.filter(function(t) { return t.priority === 'Urgent'; });
    return rows;
  }

  function countForTab(tab) {
    var saved = state.activeTab;
    state.activeTab = tab;
    var n = applyTabFilter(state.tickets).length;
    state.activeTab = saved;
    return n;
  }

  var TABS = [
    { key:'all', label:'All Tickets' },
    { key:'open', label:'Open' },
    { key:'progress', label:'In Progress' },
    { key:'urgent', label:'Urgent' },
    { key:'resolved', label:'Resolved' }
  ];

  function renderTabsBar() {
    return '<div class="users-tabs-bar">' +
      TABS.map(function (t) {
        var n = countForTab(t.key);
        var active = state.activeTab === t.key;
        return '<button type="button" class="users-tab' + (active ? ' active' : '') + '" ' +
          'data-tickets-tab="' + esc(t.key) + '">' + esc(t.label) +
          '<span class="count">' + comma(n) + '</span></button>';
      }).join('') + '</div>';
  }

  function renderHeader() {
    return '<div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">' +
      '<div><h2>Support Center</h2><p class="page-subtitle">Manage customer inquiries and support tickets.</p></div>' +
      '<div class="page-actions">' +
        '<button type="button" class="btn btn-outline btn-sm" data-tickets-export>' +
          '<i class="fas fa-download"></i> Export Tickets</button>' +
      '</div></div>';
  }

  function priorityPill(p) {
    if (!p) return '<span class="admin-badge pri-normal">Normal</span>';
    var c = p.toLowerCase();
    var bg = c === 'urgent' ? '#fef2f2' : c === 'high' ? '#fff7ed' : '#eff6ff';
    var fg = c === 'urgent' ? '#dc2626' : c === 'high' ? '#ea580c' : '#2563eb';
    return '<span style="font-size:11px;font-weight:700;text-transform:uppercase;background:' + bg + ';color:' + fg + ';padding:4px 8px;border-radius:6px;">' + esc(p) + '</span>';
  }

  function statusPill(s) {
    if (!s) return '<span class="pill Open">Open</span>';
    if (s === 'Closed') return '<span class="pill Closed">Closed</span>';
    if (s === 'Resolved') return '<span class="pill Delivered">Resolved</span>';
    if (s === 'In Progress') return '<span class="pill In-Transit">In Progress</span>';
    return '<span class="pill ' + esc(s.replace(/\s+/g,'-')) + '">' + esc(s) + '</span>';
  }

  function renderSla(t) {
    if (t.status === 'Resolved' || t.status === 'Closed') return '<span class="text-muted" style="font-size:12px;">Met</span>';
    if (!t.createdAt) return '<span class="text-muted" style="font-size:12px;">—</span>';
    
    var created = new Date(t.createdAt).getTime();
    if (isNaN(created)) return '<span class="text-muted" style="font-size:12px;">—</span>';
    
    var slaMins = 1440; // 24h default
    if (t.priority === 'Urgent') slaMins = 60; // 1h
    else if (t.priority === 'High') slaMins = 240; // 4h

    var deadline = created + (slaMins * 60000);
    var remaining = deadline - Date.now();

    if (remaining < 0) return '<span class="pill Cancelled" style="font-size:10px;">Breached</span>';
    
    var hrsLeft = Math.floor(remaining / 3600000);
    var minsLeft = Math.floor((remaining % 3600000) / 60000);
    
    if (hrsLeft < 2) return '<span class="pill On-Hold" style="font-size:10px;">' + hrsLeft + 'h ' + minsLeft + 'm</span>';
    return '<span class="pill Delivered" style="font-size:10px;">' + hrsLeft + 'h left</span>';
  }

  function buildColumns() {
    return [
      { key:'id', label:'ID', sortable:true,
        render:function (t) { return '<code class="mono" style="font-size:11px;">' + esc(t.id || '—') + '</code>'; } },
      { key:'subject', label:'Subject & Preview', sortable:true,
        render:function (t) {
          return '<div style="font-weight:700;font-size:13px;color:var(--text);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(t.subject || 'No Subject') + '</div>' +
            '<div style="font-size:12px;color:var(--text-3);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(t.message || t.description || 'No preview available') + '</div>';
        } },
      { key:'user', label:'Customer', sortable:true,
        sortValue:function (t) { 
          var u = state.usersMap[t.userId]; 
          return u ? u.name : ''; 
        },
        render:function (t) {
          var u = state.usersMap[t.userId];
          if (!u) return '<span class="text-muted">Unknown</span>';
          return '<div class="cell-user">' +
            '<div class="meta"><div class="name">' + esc(u.name) + '</div><div class="email">' + esc(u.email) + '</div></div>' +
          '</div>';
        } },
      { key:'priority', label:'Priority', sortable:true,
        sortValue:function (t) { 
          var p = t.priority || 'Normal';
          return p === 'Urgent' ? 0 : p === 'High' ? 1 : p === 'Normal' ? 2 : 3;
        },
        render:function (t) { return priorityPill(t.priority); } },
      { key:'status', label:'Status', sortable:true,
        render:function (t) { return statusPill(t.status); } },
      { key:'sla', label:'SLA', sortable:false, align:'right',
        render:function (t) { return renderSla(t); } }
    ];
  }

  function buildActionsCol() {
    return {
      label:'',
      render:function (t) {
        return '<button type="button" class="btn btn-ghost btn-sm" ' +
            'data-tickets-action="view" data-id="' + esc(t.id) + '" title="View & Reply">' +
            '<i class="fas fa-eye"></i></button>';
      }
    };
  }

  function exportTickets(rows) {
    var list = rows || state.tickets;
    try {
      var blob = new Blob([JSON.stringify(list, null, 2)], { type:'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'tickets-' + new Date().toISOString().slice(0,10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Exported', list.length + ' tickets', 'success');
    } catch (e) { toast('Export failed', String(e.message||e), 'error'); }
  }

  function render(ctx) {
    loadData();
    return '<div class="tickets-page" style="max-width:1200px;margin:0 auto;">' +
      renderHeader() + renderTabsBar() +
      '<div id="tickets-table-mount"></div></div>';
  }

  function bind(ctx) {
    var mount = document.getElementById('tickets-table-mount');
    if (!mount) return;

    if (state.dt && state.dt.destroy) { try { state.dt.destroy(); } catch (e) {} }
    state.dt = DataTable.create(mount, {
      key: 'admin-tickets-' + state.activeTab,
      data: applyTabFilter(state.tickets),
      rowId: function (t) { return t.id; },
      columns: buildColumns(),
      actionsCol: buildActionsCol(),
      searchKeys: ['id', 'subject', 'message', 'description'],
      pageSize: 20,
      emptyState: { icon:'fa-headset', title:'No tickets yet', message:'Support requests will appear here.' },
      onRowClick: function (ticket) { openTicketModal(ticket); }
    });

    pageContainer = document.getElementById('content');
    if (!pageContainer) return;
    if (pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageHandler = onPageClick;
    pageContainer.addEventListener('click', pageHandler);
  }

  function onPageClick(e) {
    var tab = e.target.closest('[data-tickets-tab]');
    if (tab) { state.activeTab = tab.dataset.ticketsTab; refresh(); return; }

    if (e.target.closest('[data-tickets-export]')) {
      exportTickets(state.dt ? state.dt.data : state.tickets);
      return;
    }

    var action = e.target.closest('[data-tickets-action]');
    if (action) {
      var ticket = findTicket(action.dataset.id);
      if (ticket) openTicketModal(ticket);
    }
  }

  function findTicket(id) {
    for (var i = 0; i < state.tickets.length; i++) if (state.tickets[i].id === id) return state.tickets[i];
    return null;
  }

  // Professional Ticket Modal with Conversation Thread
  function openTicketModal(ticket) {
    var u = state.usersMap[ticket.userId] || { name: 'Unknown User', email: '—' };
    var isClosed = ticket.status === 'Closed' || ticket.status === 'Resolved';

    var modal = UI.openModal(
      '<div class="modal wide" style="max-width:800px;">' +
        '<div class="modal-head" style="border-bottom:1px solid var(--adm-border);padding:20px 24px;">' +
          '<div>' +
            '<h3 style="margin:0 0 4px;font-size:18px;font-weight:800;color:var(--text);">' + esc(ticket.subject) + '</h3>' +
            '<div style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-3);">' +
              '<code class="mono">' + esc(ticket.id) + '</code> &middot; ' +
              'Opened ' + esc(fmtRelative(ticket.createdAt)) + ' by ' +
              '<strong>' + esc(u.name) + '</strong>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button>' +
        '</div>' +

        '<div class="modal-body" style="background:var(--surface-2);padding:24px;max-height:500px;overflow-y:auto;">' +
          
          // Conversation Thread
          '<div style="display:flex;flex-direction:column;gap:16px;">' +
            
            // Original Message
            '<div style="display:flex;gap:12px;">' +
              '<div style="width:36px;height:36px;border-radius:50%;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;">' + esc(u.name.charAt(0)) + '</div>' +
              '<div style="background:#fff;border:1px solid var(--adm-border);border-radius:0 12px 12px 12px;padding:12px 16px;box-shadow:0 2px 4px rgba(0,0,0,0.02);">' +
                '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px;">' + esc(u.name) + ' <span style="font-weight:400;color:var(--text-3);margin-left:8px;">' + esc(fmtRelative(ticket.createdAt)) + '</span></div>' +
                '<div style="font-size:13.5px;color:var(--text-2);line-height:1.6;white-space:pre-wrap;">' + esc(ticket.message || ticket.description || 'No message content.') + '</div>' +
              '</div>' +
            '</div>' +

            // Admin Replies
            (ticket.replies || []).map(function(reply) {
              return '<div style="display:flex;gap:12px;flex-direction:row-reverse;">' +
                '<div style="width:36px;height:36px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;"><i class="fas fa-headset"></i></div>' +
                '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px 0 12px 12px;padding:12px 16px;box-shadow:0 2px 4px rgba(0,0,0,0.02);">' +
                  '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:4px;">Support Team <span style="font-weight:400;color:var(--text-3);margin-left:8px;">' + esc(fmtRelative(reply.at)) + '</span></div>' +
                  '<div style="font-size:13.5px;color:var(--text-2);line-height:1.6;white-space:pre-wrap;">' + esc(reply.message) + '</div>' +
                '</div>' +
              '</div>';
            }).join('') +

          '</div>' +

        '</div>' +

        '<div class="modal-foot" style="display:flex;justify-content:space-between;align-items:center;padding:16px 24px;background:#fff;border-top:1px solid var(--adm-border);">' +
          '<div>' +
            '<select id="tkStatus" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-weight:600;">' +
              ['Open', 'In Progress', 'Resolved', 'Closed'].map(function(s){ return '<option ' + (ticket.status === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') +
            '</select>' +
          '</div>' +
          '<div style="display:flex;gap:8px;flex:1;margin-left:16px;">' +
            '<input type="text" id="tkReply" placeholder="Type a reply..." style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:8px;" ' + (isClosed ? 'disabled' : '') + ' />' +
            '<button type="button" class="btn btn-primary" id="tkSend" ' + (isClosed ? 'disabled' : '') + '><i class="fas fa-paper-plane"></i></button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );

    if (!modal) return;

    // Wire up actions inside the modal
    modal.querySelector('#tkSend').onclick = function() {
      var replyText = modal.querySelector('#tkReply').value.trim();
      if (!replyText) return toast('Empty', 'Type a reply first.', 'error');

      var allTickets = asArray(read(KEYS.tickets, []));
      var idx = allTickets.findIndex(function(x){ return x.id === ticket.id; });
      if (idx !== -1) {
        if (!allTickets[idx].replies) allTickets[idx].replies = [];
        allTickets[idx].replies.push({ at: new Date().toISOString(), message: replyText });
        write(KEYS.tickets, allTickets);
        
        toast('Reply sent', '', 'success');
        UI.closeModal(modal);
        refresh();
      }
    };

    modal.querySelector('#tkStatus').onchange = function(e) {
      var newStatus = e.target.value;
      var allTickets = asArray(read(KEYS.tickets, []));
      var idx = allTickets.findIndex(function(x){ return x.id === ticket.id; });
      if (idx !== -1) {
        allTickets[idx].status = newStatus;
        write(KEYS.tickets, allTickets);
        toast('Status updated', 'Ticket marked as ' + newStatus, 'success');
        // Don't close modal, just let them keep reading
      }
    };
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
  global.PagesAdmin.tickets = {
    title: 'Support',
    subtitle: 'Manage customer inquiries and issues',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);