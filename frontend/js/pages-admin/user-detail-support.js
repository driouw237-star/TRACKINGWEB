/* ================================================================
   GlobalExpress — Admin User Detail: SUPPORT MODULE
   ================================================================
   Handles rendering for:
     - Tickets Tab (List of support tickets opened by this user)
     - Notifications Tab (Feed of messages sent to this user)
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var esc = Utils.esc || function(s){return String(s||'');};
  var fmtRelative = Utils.fmtRelative || function(d){return String(d);};

  global.UserDetailModules = global.UserDetailModules || {};

  // ==== TAB: TICKETS ====
  global.UserDetailModules.renderTabTickets = function(state) {
    var tickets = state.tickets || [];
    
    if (tickets.length === 0) {
      return '<div class="empty" style="padding:40px;text-align:center">'
        + '<h4>No support tickets</h4>'
        + '<p style="color:var(--text-3);font-size:13px">This customer has not opened any support tickets.</p>'
        + '</div>';
    }

    var rows = tickets.map(function (t) {
      var statusCls = String(t.status || 'Open').replace(/\s+/g, '-');
      var priorityCls = String(t.priority || 'Normal').toLowerCase();
      return ''
        + '<tr>'
        +   '<td><code class="mono" style="font-size:11.5px">' + esc(t.id || '—') + '</code></td>'
        +   '<td style="font-weight:600;font-size:13px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
        +     esc(t.subject || '—')
        +   '</td>'
        +   '<td><span class="pill ' + esc(priorityCls) + '">' + esc(t.priority || 'Normal') + '</span></td>'
        +   '<td><span class="pill ' + esc(statusCls) + '">' + esc(t.status || 'Open') + '</span></td>'
        +   '<td style="font-size:12px;color:var(--text-3);white-space:nowrap">' + esc(fmtRelative(t.createdAt)) + '</td>'
        +   '<td style="font-size:12px;color:var(--text-3)">' + esc((t.messages && t.messages.length) || 0) + ' msg</td>'
        +   '<td class="tbl-actions">'
        +     '<button type="button" class="btn btn-sm btn-outline" data-action="open-ticket" data-id="' + esc(t.id) + '">'
        +       '<i class="fas fa-eye"></i>'
        +     '</button>'
        +   '</td>'
        + '</tr>';
    }).join('');

    return ''
      + '<div class="tbl-wrap" style="margin-top:24px">'
      +   '<table class="table-cards">'
      +     '<thead><tr>'
      +       '<th>ID</th>'
      +       '<th>Subject</th>'
      +       '<th>Priority</th>'
      +       '<th>Status</th>'
      +       '<th>Opened</th>'
      +       '<th>Replies</th>'
      +       '<th class="tbl-actions">Actions</th>'
      +     '</tr></thead>'
      +     '<tbody>' + rows + '</tbody>'
      +   '</table>'
      + '</div>';
  };

  // ==== TAB: NOTIFICATIONS ====
  global.UserDetailModules.renderTabNotifications = function(state) {
    var notifs = state.notifications || [];
    var unread = notifs.filter(function (n) { return !n.read; }).length;

    if (notifs.length === 0) {
      return '<div class="empty" style="padding:40px;text-align:center">'
        + '<h4>No notifications</h4>'
        + '<p style="color:var(--text-3);font-size:13px">This customer has not received any notifications yet.</p>'
        + '</div>';
    }

    var header = ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:24px;margin-bottom:16px">'
      +   '<h3 style="margin:0;font-size:15px;font-weight:700">'
      +     'Notifications (' + notifs.length + ')'
      +     (unread > 0 ? ' — <span style="color:var(--red);font-size:12px;background:#fef2f2;padding:2px 8px;border-radius:20px">' + unread + ' unread</span>' : '')
      +   '</h3>'
      +   (unread > 0
              ? '<button type="button" class="btn btn-sm btn-outline" data-action="mark-all-read">'
                + '<i class="fas fa-check-double"></i> Mark all read</button>'
              : '')
      + '</div>';

    var typeMap = {
      success: { bg: '#ecfdf5', fg: '#059669', icon: 'fa-circle-check' },
      warning: { bg: '#fffbeb', fg: '#d97706', icon: 'fa-triangle-exclamation' },
      error:   { bg: '#fef2f2', fg: '#dc2626', icon: 'fa-circle-xmark' },
      info:    { bg: '#eff6ff', fg: '#2563eb', icon: 'fa-circle-info' }
    };

    var feed = notifs.map(function (n) {
      var t = typeMap[n.type] || typeMap.info;
      return ''
        + '<div style="display:flex;gap:12px;padding:14px 0;border-bottom:1px solid var(--adm-border);' + (n.read ? 'opacity:.65' : '') + '">'
        +   '<div style="width:34px;height:34px;border-radius:9px;flex-shrink:0;background:' + t.bg + ';color:' + t.fg + ';display:inline-flex;align-items:center;justify-content:center;font-size:13px">'
        +     '<i class="fas ' + t.icon + '"></i>'
        +   '</div>'
        +   '<div style="flex:1;min-width:0">'
        +     '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:2px">'
        +       '<div style="font-weight:700;font-size:13.5px;color:var(--text)">' + esc(n.title || '(no title)') + '</div>'
        +       '<div style="font-size:11px;color:var(--text-3);white-space:nowrap">' + esc(fmtRelative(n.at)) + '</div>'
        +     '</div>'
        +     '<div style="font-size:12.5px;color:var(--text-2);line-height:1.55">' + esc(n.message || '') + '</div>'
        +   '</div>'
        +   (!n.read
              ? '<button type="button" class="btn btn-sm btn-ghost" title="Mark as read" data-action="mark-read" data-id="' + esc(n.id) + '" style="color:var(--blue);flex-shrink:0">'
                + '<i class="fas fa-check"></i></button>'
              : '')
        + '</div>';
    }).join('');

    return header + '<div>' + feed + '</div>';
  };

})(window);