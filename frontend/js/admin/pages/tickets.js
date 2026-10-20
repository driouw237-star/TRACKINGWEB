/* ================================================================
   GlobalExpress — Admin Tickets Page
   ================================================================
   Support ticket management: table, search, status/priority
   filters, sort, pagination, detail thread modal, reply as
   support, mark resolved, escalate priority.

   Every write:
     - updates ge_tickets
     - calls Admin.logAudit(action, target, details)
     - emits ticket:updated via Realtime.notifyLocalChange

   Deep-link: Admin.state.params.id opens that ticket's detail.
   Admin.state.params.status pre-applies a status filter.
   Admin.state.params.priority pre-applies a priority filter.

   Registers with Admin.register('tickets', page).
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

  var fmtRelative = Utils.fmtRelative || function (d) {
    var ts = Date.parse(d);
    if (isNaN(ts)) return String(d || '');
    var diff = Date.now() - ts;
    var sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    var day = Math.floor(hr / 24);
    if (day < 30) return day + 'd ago';
    var mo = Math.floor(day / 30);
    if (mo < 12) return mo + 'mo ago';
    return Math.floor(mo / 12) + 'y ago';
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
     §3 — KEYS + CONSTANTS
     ================================================================ */

  var KEYS = {
    tickets:       'ge_tickets',
    users:         'ge_users',
    notifications: 'ge_notifications'
  };

  var PAGE_SIZE = 15;

  var STATUSES = ['Open', 'Pending', 'Closed'];

  var PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

  // Priority → pill class
  var PRIORITY_PILL = {
    Low:    'Pending',
    Normal: 'In-Transit',
    High:   'On-Hold',
    Urgent: 'Cancelled'
  };

  /* ================================================================
     §4 — MODULE STATE
     ================================================================ */

  var state = {
    query:         '',
    statusFilter:  '',
    priorityFilter:'',
    sortKey:       'at',        // subject | user | priority | status | replies | at
    sortDir:       'desc',
    pageNum:       1
  };

  var handler         = null;
  var container       = null;
  var deepLinkHandled = false;

  /* ================================================================
     §5 — STORAGE READERS / WRITERS
     ================================================================ */

  function readTickets() {
    var list = storage.get(KEYS.tickets, []);
    return Array.isArray(list) ? list : [];
  }

  function writeTickets(list) {
    return storage.set(KEYS.tickets, list);
  }

  function readNotifications() {
    var list = storage.get(KEYS.notifications, []);
    return Array.isArray(list) ? list : [];
  }

  function writeNotifications(list) {
    return storage.set(KEYS.notifications, list);
  }

  /* ================================================================
     §6 — HELPERS
     ================================================================ */

  function findTicket(id) {
    if (!id) return null;
    var list = readTickets();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function parseDateSafe(s) {
    if (!s) return 0;
    var t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }

  function replyCount(t) {
    return Array.isArray(t.replies) ? t.replies.length : 0;
  }

  function matchesQuery(t, q) {
    if (!q) return true;
    var hay = [
      t.subject    || '',
      t.message    || '',
      t.category   || '',
      t.status     || '',
      t.priority   || '',
      t.userEmail  || '',
      t.userName   || ''
    ].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function matchesStatus(t, status) {
    if (!status) return true;
    return t.status === status;
  }

  function matchesPriority(t, priority) {
    if (!priority) return true;
    return t.priority === priority;
  }

  function priorityPillClass(priority) {
    return PRIORITY_PILL[priority] || 'Pending';
  }

  function statusPillClass(status) {
    if (status === 'Closed')  return 'Closed';
    if (status === 'Pending') return 'Pending';
    return 'Open';
  }

  /* ================================================================
     §7 — AUDIT + EMIT
     ================================================================ */

  function auditAndEmit(action, target, details, extras) {
    if (Admin && typeof Admin.logAudit === 'function') {
      Admin.logAudit(action, target, details);
    }
    if (Realtime && typeof Realtime.notifyLocalChange === 'function') {
      Realtime.notifyLocalChange('ticket:updated', { target: target });
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
    var list = readTickets();
    var totalAll = list.length;

    var q = state.query.trim().toLowerCase();
    if (q) list = list.filter(function (t) { return matchesQuery(t, q); });

    if (state.statusFilter) {
      list = list.filter(function (t) { return matchesStatus(t, state.statusFilter); });
    }
    if (state.priorityFilter) {
      list = list.filter(function (t) { return matchesPriority(t, state.priorityFilter); });
    }

    list.sort(compareTickets);

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

  function compareTickets(a, b) {
    var key = state.sortKey;
    var dir = state.sortDir === 'asc' ? 1 : -1;

    var va, vb;
    if (key === 'subject') {
      va = (a.subject || '').toLowerCase();
      vb = (b.subject || '').toLowerCase();
    } else if (key === 'user') {
      va = (a.userName || a.userEmail || '').toLowerCase();
      vb = (b.userName || b.userEmail || '').toLowerCase();
    } else if (key === 'priority') {
      var order = { Low: 0, Normal: 1, High: 2, Urgent: 3 };
      va = order[a.priority] != null ? order[a.priority] : 1;
      vb = order[b.priority] != null ? order[b.priority] : 1;
    } else if (key === 'status') {
      va = (a.status || '').toLowerCase();
      vb = (b.status || '').toLowerCase();
    } else if (key === 'replies') {
      va = replyCount(a);
      vb = replyCount(b);
    } else {
      va = parseDateSafe(a.at);
      vb = parseDateSafe(b.at);
    }

    if (va < vb) return -1 * dir;
    if (va > vb) return  1 * dir;
    return 0;
  }

  /* ================================================================
     §9 — KPI COMPUTATION
     ================================================================ */

  function computeKpis() {
    var list = readTickets();
    var open    = 0;
    var pending = 0;
    var closed  = 0;
    var urgent  = 0;
    var high    = 0;

    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t) continue;
      if (t.status === 'Open')    open++;
      if (t.status === 'Pending') pending++;
      if (t.status === 'Closed')  closed++;
      if (t.priority === 'Urgent') urgent++;
      if (t.priority === 'High')   high++;
    }

    return {
      open:    open,
      pending: pending,
      closed:  closed,
      urgent:  urgent,
      high:    high,
      total:   list.length
    };
  }

  /* ================================================================
     §10 — ROW RENDERING
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

  function rowHtml(t) {
    var replies = replyCount(t);
    var initial = (t.userName || t.userEmail || 'U').charAt(0).toUpperCase();
    var priClass = priorityPillClass(t.priority);
    var stClass  = statusPillClass(t.status);

    return ''
      + '<tr data-id="' + esc(t.id) + '" style="cursor:pointer">'

      +   '<td>'
      +     '<div style="font-weight:600;font-size:13.5px;color:var(--text);line-height:1.35">'
      +       esc(t.subject || '—')
      +     '</div>'
      +     '<div class="cell-sub">'
      +       esc(t.category || 'Other')
      +       (replies > 0
                ? ' · ' + replies + ' repl' + (replies === 1 ? 'y' : 'ies')
                : '')
      +     '</div>'
      +   '</td>'

      +   '<td>'
      +     '<div class="cell-user" style="gap:8px">'
      +       '<div class="av" style="width:28px;height:28px;font-size:11px">'
      +         esc(initial)
      +       '</div>'
      +       '<div class="meta">'
      +         '<div class="name" style="font-size:12.5px">'
      +           esc(t.userName || '—')
      +         '</div>'
      +         (t.userEmail
                  ? '<div class="email" style="font-size:11px">' + esc(t.userEmail) + '</div>'
                  : '')
      +       '</div>'
      +     '</div>'
      +   '</td>'

      +   '<td>'
      +     '<span class="pill ' + esc(priClass) + '">'
      +       esc(t.priority || 'Normal')
      +     '</span>'
      +   '</td>'

      +   '<td>'
      +     '<span class="pill ' + esc(stClass) + '">'
      +       esc(t.status || 'Open')
      +     '</span>'
      +   '</td>'

      +   '<td style="font-size:12px;color:var(--text-3);white-space:nowrap">'
      +     esc(fmtRelative(t.at))
      +   '</td>'

      +   '<td class="tbl-actions">'
      +     '<button type="button" class="btn btn-sm btn-outline" '
      +       'data-action="view" data-id="' + esc(t.id) + '" title="View thread">'
      +       '<i class="fas fa-eye"></i>'
      +     '</button>'
      +   '</td>'

      + '</tr>';
  }

  /* ================================================================
     §11 — EMPTY STATES
     ================================================================ */

  function emptyNoTickets() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-ticket"></i></div>'
      +   '<h4>No tickets yet</h4>'
      +   '<p>Customer support requests will appear here.</p>'
      + '</div>';
  }

  function emptyNoMatch() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-magnifying-glass"></i></div>'
      +   '<h4>No matching tickets</h4>'
      +   '<p>Try a different search, status, or priority filter.</p>'
      +   '<button type="button" class="btn btn-outline" data-action="clear-filters">'
      +     '<i class="fas fa-rotate-left"></i> Clear filters'
      +   '</button>'
      + '</div>';
  }

  /* ================================================================
     §12 — TABLE RENDER
     ================================================================ */

  function renderRows() {
    var tbody = document.getElementById('ticketsTbody');
    if (!tbody) return;

    var result = pipeline();

    if (result.all === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">'
        + emptyNoTickets() + '</td></tr>';
    } else if (result.filtered === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">'
        + emptyNoMatch() + '</td></tr>';
    } else {
      tbody.innerHTML = result.slice.map(rowHtml).join('');
    }

    var countEl = document.getElementById('ticketsCount');
    if (countEl) {
      countEl.textContent = result.filtered === result.all
        ? result.all + ' ticket' + (result.all === 1 ? '' : 's')
        : result.filtered + ' of ' + result.all + ' tickets';
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
    var foot = document.getElementById('ticketsFooter');
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
     §13 — WRITES
     ================================================================ */

  function appendReply(ticketId, message) {
    var list = readTickets();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === ticketId) { idx = i; break; }
    }
    if (idx === -1) { toast('Ticket not found', '', 'error'); return false; }

    var ticket = list[idx];
    if (!Array.isArray(ticket.replies)) ticket.replies = [];

    var adminUser = (Admin && Admin.state && Admin.state.user) || {};
    var reply = {
      id:      uid('rp'),
      from:    'admin',
      by:      adminUser.email || 'support@globalexpress.test',
      author:  adminUser.name  || 'Support Team',
      message: String(message || '').trim(),
      at:      fmtDT()
    };
    ticket.replies.push(reply);

    // A reply from support moves an Open ticket into Pending.
    if (ticket.status === 'Open') {
      ticket.status = 'Pending';
    }

    writeTickets(list);

    // Notify the customer
    var notifs = readNotifications();
    notifs.push({
      id:      uid('n'),
      userId:  ticket.userId,
      title:   'Support replied',
      message: 'Your ticket "' + (ticket.subject || '') + '" got a reply.',
      type:    'info',
      at:      fmtDT(),
      read:    false
    });
    writeNotifications(notifs);

    auditAndEmit(
      'ticket.reply',
      'ticket:' + ticketId,
      'Reply by ' + (adminUser.name || 'Admin'),
      [{ name: 'notification:new', payload: notifs[notifs.length - 1] }]
    );

    return reply;
  }

  function setStatus(ticketId, newStatus) {
    var list = readTickets();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === ticketId) { idx = i; break; }
    }
    if (idx === -1) { toast('Ticket not found', '', 'error'); return false; }

    var prev = list[idx].status;
    if (prev === newStatus) return false;

    list[idx].status = newStatus;
    writeTickets(list);

    auditAndEmit(
      'ticket.' + (newStatus === 'Closed' ? 'resolve' : 'status'),
      'ticket:' + ticketId,
      'Status: ' + prev + ' → ' + newStatus
    );

    return true;
  }

  function setPriority(ticketId, newPriority) {
    var list = readTickets();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === ticketId) { idx = i; break; }
    }
    if (idx === -1) { toast('Ticket not found', '', 'error'); return false; }

    var prev = list[idx].priority;
    if (prev === newPriority) return false;

    list[idx].priority = newPriority;
    writeTickets(list);

    auditAndEmit(
      'ticket.escalate',
      'ticket:' + ticketId,
      'Priority: ' + (prev || 'Normal') + ' → ' + newPriority
    );

    return true;
  }

  /* ================================================================
     §14 — DETAIL MODAL
     ================================================================ */

  function openDetailModal(ticketId) {
    var t = findTicket(ticketId);
    if (!t) { toast('Ticket not found', '', 'error'); return; }

    var replies = Array.isArray(t.replies) ? t.replies : [];
    var isClosed = t.status === 'Closed';

    var modal = openModal(''
      + '<div class="modal wide">'
      +   '<div class="modal-head">'
      +     '<div style="flex:1;min-width:0">'
      +       '<h3 style="margin:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
      +         esc(t.subject || 'Ticket')
      +         '<span class="pill ' + esc(statusPillClass(t.status)) + '">'
      +           esc(t.status || 'Open')
      +         '</span>'
      +         '<span class="pill ' + esc(priorityPillClass(t.priority)) + '">'
      +           esc(t.priority || 'Normal')
      +         '</span>'
      +       '</h3>'
      +       '<div class="sub" style="margin:6px 0 0">'
      +         esc(t.category || 'Other')
      +         ' · From ' + esc(t.userName || t.userEmail || '—')
      +         ' · Opened ' + esc(t.at || '—')
      +       '</div>'
      +     '</div>'
      +     '<button type="button" class="modal-close" data-close aria-label="Close">'
      +       '<i class="fas fa-times"></i>'
      +     '</button>'
      +   '</div>'

      +   '<div class="modal-body" style="background:var(--surface-2)">'
      +     '<div style="max-width:720px;margin:0 auto;display:flex;'
      +       'flex-direction:column;gap:18px">'

      // Original message
      +       buildMessageBubble({
              author:  t.userName || t.userEmail || 'Customer',
              from:    'user',
              at:      t.at,
              text:    t.message || '(empty)'
            })

      // Replies
      +       replies.map(function (r) {
                var isAdmin = r.from === 'admin' || r.by === 'admin';
                return buildMessageBubble({
                  author: isAdmin ? (r.author || 'Support Team')
                                  : (t.userName || t.userEmail || 'Customer'),
                  from:   isAdmin ? 'admin' : 'user',
                  at:     r.at,
                  text:   r.message || '(empty)'
                });
              }).join('')

      // Reply box
      +       (isClosed
                ? '<div style="padding:16px;border:1px solid var(--border);'
                  + 'border-radius:10px;background:#fff;text-align:center;'
                  + 'font-size:13px;color:var(--text-3)">'
                  + '<i class="fas fa-lock"></i> This ticket is closed.'
                  + '</div>'
                : '<div class="panel" style="margin:0">'
                  + '<div class="panel-header" style="padding:12px 16px">'
                  +   '<h3 style="font-size:13px">'
                  +     '<i class="fas fa-reply"></i> Reply as Support'
                  +   '</h3>'
                  + '</div>'
                  + '<div class="panel-body" style="padding:14px">'
                  +   '<textarea id="replyText" '
                  +     'placeholder="Type your reply…" '
                  +     'style="width:100%;min-height:100px;padding:12px;'
                  +     'border:1.5px solid var(--border);border-radius:10px;'
                  +     'font-family:inherit;font-size:13.5px;resize:vertical;'
                  +     'outline:none"></textarea>'
                  +   '<div style="display:flex;justify-content:space-between;'
                  +     'align-items:center;margin-top:12px;flex-wrap:wrap;gap:10px">'
                  +     '<span style="font-size:11.5px;color:var(--text-3)">'
                  +       'Signed as '
                  +       '<strong>' + esc((Admin && Admin.state && Admin.state.user && Admin.state.user.name) || 'Support Team') + '</strong>'
                  +     '</span>'
                  +     '<button type="button" class="btn btn-primary" '
                  +       'data-action="send-reply" data-id="' + esc(t.id) + '">'
                  +       '<i class="fas fa-paper-plane"></i> Send Reply'
                  +     '</button>'
                  +   '</div>'
                  + '</div>'
                  + '</div>')

      +     '</div>'
      +   '</div>'

      +   '<div class="modal-foot" style="flex-wrap:wrap;gap:8px">'
      +     (!isClosed
              ? '<button type="button" class="btn btn-outline" '
                + 'data-action="resolve" data-id="' + esc(t.id) + '">'
                + '<i class="fas fa-check"></i> Mark as Resolved'
                + '</button>'
              : '<button type="button" class="btn btn-outline" '
                + 'data-action="reopen" data-id="' + esc(t.id) + '">'
                + '<i class="fas fa-rotate-left"></i> Reopen'
                + '</button>')
      +     '<select data-action="set-priority" data-id="' + esc(t.id) + '" '
      +       'style="padding:9px 12px;border:1.5px solid var(--border);'
      +       'border-radius:9px;background:var(--surface);font-size:13px">'
      +       PRIORITIES.map(function (p) {
                return '<option value="' + esc(p) + '"'
                     + (t.priority === p ? ' selected' : '') + '>'
                     + esc(p) + '</option>';
              }).join('')
      +     '</select>'
      +     '<button type="button" class="btn btn-ghost" style="margin-left:auto" data-close>'
      +       'Close'
      +     '</button>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    // Auto-focus the reply box for open tickets
    if (!isClosed) {
      setTimeout(function () {
        var ta = modal.querySelector('#replyText');
        if (ta) ta.focus();
      }, 60);
    }

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) {
        closeModal(modal);
        renderRows();
        return;
      }
      if (e.target === modal) {
        closeModal(modal);
        renderRows();
        return;
      }

      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;

      var action = btn.dataset.action;
      var id = btn.dataset.id;

      if (action === 'send-reply') {
        var ta = modal.querySelector('#replyText');
        var text = ta ? ta.value.trim() : '';
        if (!text) {
          toast('Write a reply first', '', 'error');
          return;
        }
        appendReply(id, text);
        toast('Reply sent', 'The customer has been notified.', 'success');
        closeModal(modal);
        setTimeout(function () { openDetailModal(id); }, 220);
        return;
      }

      if (action === 'resolve') {
        if (setStatus(id, 'Closed')) {
          toast('Ticket resolved', 'Marked as Closed.', 'success');
        }
        closeModal(modal);
        renderRows();
        return;
      }

      if (action === 'reopen') {
        if (setStatus(id, 'Open')) {
          toast('Ticket reopened', '', 'info');
        }
        closeModal(modal);
        renderRows();
        return;
      }
    });

    // Priority select
    modal.addEventListener('change', function (e) {
      var sel = e.target.closest && e.target.closest('[data-action="set-priority"]');
      if (!sel) return;
      var id = sel.dataset.id;
      var newPriority = sel.value;
      if (setPriority(id, newPriority)) {
        toast('Priority updated', newPriority, 'success');
        renderRows();
      }
    });
  }

  function buildMessageBubble(opts) {
    var isUser = opts.from === 'user';
    var alignment = isUser ? 'flex-end' : 'flex-start';
    var bg = isUser ? 'var(--accent)' : '#fff';
    var color = isUser ? '#fff' : 'var(--text)';
    var border = isUser ? 'none' : '1px solid var(--border)';
    var radius = isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px';
    var authorColor = isUser ? 'rgba(255,255,255,.9)' : 'var(--text-3)';
    var timeColor = isUser ? 'rgba(255,255,255,.75)' : 'var(--text-3)';

    return ''
      + '<div style="display:flex;flex-direction:column;align-items:' + alignment + '">'
      +   '<div style="font-size:11px;font-weight:600;color:' + authorColor + ';margin-bottom:4px">'
      +     esc(opts.author)
      +   '</div>'
      +   '<div style="max-width:min(560px,90%);padding:12px 16px;'
      +     'border-radius:' + radius + ';'
      +     'background:' + bg + ';color:' + color + ';border:' + border + ';'
      +     'font-size:13.5px;line-height:1.55;'
      +     'box-shadow:0 1px 3px rgba(15,23,42,.05);'
      +     'white-space:pre-wrap;word-wrap:break-word">'
      +     esc(opts.text)
      +   '</div>'
      +   '<div style="font-size:10.5px;color:' + timeColor + ';margin-top:4px">'
      +     esc(opts.at || '')
      +   '</div>'
      + '</div>';
  }

  /* ================================================================
     §15 — MAIN RENDER
     ================================================================ */

  function render(ctx) {
    var kpis = computeKpis();

    var kpisHtml = ''
      + '<div class="admin-kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">'
      +   kpiTile('fa-envelope-open',    'blue',   comma(kpis.open),    'Open',     'Awaiting first reply')
      +   kpiTile('fa-hourglass-half',   'amber',  comma(kpis.pending), 'Pending',  'Replied, awaiting customer')
      +   kpiTile('fa-circle-check',     'green',  comma(kpis.closed),  'Closed',   'Resolved')
      +   kpiTile('fa-fire',             'red',    comma(kpis.urgent + kpis.high), 'High Priority', kpis.urgent + ' urgent · ' + kpis.high + ' high')
      + '</div>';

    var panelHtml = ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3>'
      +       '<i class="fas fa-headset"></i> Support Tickets'
      +       ' <span id="ticketsCount" style="font-weight:500;color:var(--text-3);font-size:13px;margin-left:6px"></span>'
      +     '</h3>'
      +   '</div>'

      +   '<div class="toolbar">'
      +     '<div class="search-box">'
      +       '<i class="fas fa-search"></i>'
      +       '<input type="text" id="ticketsSearch" '
      +         'placeholder="Search subject, customer, category…" '
      +         'value="' + esc(state.query) + '" />'
      +     '</div>'
      +     '<select id="ticketsStatusFilter" aria-label="Filter by status">'
      +       '<option value=""' + (state.statusFilter === '' ? ' selected' : '') + '>All statuses</option>'
      +       STATUSES.map(function (s) {
            return '<option value="' + esc(s) + '"'
                 + (state.statusFilter === s ? ' selected' : '') + '>'
                 + esc(s) + '</option>';
          }).join('')
      +     '</select>'
      +     '<select id="ticketsPriorityFilter" aria-label="Filter by priority">'
      +       '<option value=""' + (state.priorityFilter === '' ? ' selected' : '') + '>All priorities</option>'
      +       PRIORITIES.map(function (p) {
            return '<option value="' + esc(p) + '"'
                 + (state.priorityFilter === p ? ' selected' : '') + '>'
                 + esc(p) + '</option>';
          }).join('')
      +     '</select>'
      +   '</div>'

      +   '<div class="tbl-wrap">'
      +     '<table class="table-cards">'
      +       '<thead>'
      +         '<tr>'
      +           th('subject',  'Subject')
      +           th('user',     'Customer')
      +           th('priority', 'Priority')
      +           th('status',   'Status')
      +           th('at',       'Opened')
      +           '<th class="tbl-actions">Actions</th>'
      +         '</tr>'
      +       '</thead>'
      +       '<tbody id="ticketsTbody"></tbody>'
      +     '</table>'
      +   '</div>'

      +   '<div class="tbl-footer" id="ticketsFooter"></div>'
      + '</div>';

    return kpisHtml + panelHtml;
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
     §16 — BIND
     ================================================================ */

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (handler) container.removeEventListener('click', handler);

    // Pre-apply deep-link filters
    if (ctx && ctx.params) {
      if (typeof ctx.params.status === 'string') {
        state.statusFilter = ctx.params.status;
        var sf = document.getElementById('ticketsStatusFilter');
        if (sf) sf.value = ctx.params.status;
      }
      if (typeof ctx.params.priority === 'string') {
        state.priorityFilter = ctx.params.priority;
        var pf = document.getElementById('ticketsPriorityFilter');
        if (pf) pf.value = ctx.params.priority;
      }
    }

    renderRows();

    // Deep-link: open a specific ticket
    var deepId = ctx && ctx.params && ctx.params.id;
    if (deepId && !deepLinkHandled) {
      deepLinkHandled = true;
      setTimeout(function () {
        if (findTicket(deepId)) openDetailModal(deepId);
        else toast('Ticket not found', '', 'info');
      }, 0);
    }

    handler = function (e) {
      // Sort
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
        var s1 = document.getElementById('ticketsSearch');
        var s2 = document.getElementById('ticketsStatusFilter');
        var s3 = document.getElementById('ticketsPriorityFilter');
        if (s1) s1.value = state.query;
        if (s2) s2.value = state.statusFilter;
        if (s3) s3.value = state.priorityFilter;
        attachInputListeners();
        return;
      }

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
      if (btn) {
        var action = btn.dataset.action;
        var id = btn.dataset.id;

        if (action === 'view') {
          openDetailModal(id);
          return;
        }
        if (action === 'clear-filters') {
          state.query          = '';
          state.statusFilter   = '';
          state.priorityFilter = '';
          state.pageNum        = 1;
          var s4 = document.getElementById('ticketsSearch');
          var s5 = document.getElementById('ticketsStatusFilter');
          var s6 = document.getElementById('ticketsPriorityFilter');
          if (s4) s4.value = '';
          if (s5) s5.value = '';
          if (s6) s6.value = '';
          renderRows();
          return;
        }
      }

      // Row click → open detail
      var row = e.target.closest && e.target.closest('tr[data-id]');
      if (row) {
        if (e.target.closest('button')) return;
        if (e.target.closest('input')) return;
        if (e.target.closest('a')) return;
        openDetailModal(row.dataset.id);
        return;
      }
    };

    container.addEventListener('click', handler);
    attachInputListeners();
  }

  function attachInputListeners() {
    var searchEl = document.getElementById('ticketsSearch');
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

    var statusEl = document.getElementById('ticketsStatusFilter');
    if (statusEl && !statusEl.__wired) {
      statusEl.addEventListener('change', function () {
        state.statusFilter = statusEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      statusEl.__wired = true;
    }

    var priorityEl = document.getElementById('ticketsPriorityFilter');
    if (priorityEl && !priorityEl.__wired) {
      priorityEl.addEventListener('change', function () {
        state.priorityFilter = priorityEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      priorityEl.__wired = true;
    }
  }

  /* ================================================================
     §17 — CLEANUP
     ================================================================ */

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler   = null;

    state.query          = '';
    state.statusFilter   = '';
    state.priorityFilter = '';
    state.sortKey        = 'at';
    state.sortDir        = 'desc';
    state.pageNum        = 1;

    deepLinkHandled = false;

    if (UI.closeAllModals) UI.closeAllModals();
  }

  /* ================================================================
     §18 — REGISTER
     ================================================================ */

  var page = {
    title:    'Support Tickets',
    subtitle: 'Customer questions and issues',
    render:   render,
    bind:     bind,
    cleanup:  cleanup
  };

  if (global.Admin && typeof global.Admin.register === 'function') {
    global.Admin.register('tickets', page);
  } else {
    global.PagesAdmin = global.PagesAdmin || {};
    global.PagesAdmin.tickets = page;
  }

})(window);