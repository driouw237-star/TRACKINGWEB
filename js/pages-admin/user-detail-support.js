/* ================================================================
   GlobalExpress — Admin User Detail: SUPPORT MODULE
   File: js/user-detail-support.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var esc = Utils.esc || function(s){return String(s||'');};
  var fmtRelative = Utils.fmtRelative || function(d){
    var ts = Date.parse(d); if (isNaN(ts)) return '—';
    var diff = Date.now() - ts, sec = Math.floor(diff/1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec/60); if (min < 60) return min + 'm ago';
    var hr = Math.floor(min/60); if (hr < 24) return hr + 'h ago';
    return Math.floor(hr/24) + 'd ago';
  };

  global.UserDetailModules = global.UserDetailModules || {};

  // ================================================================
  // TAB: TICKETS
  // ================================================================
  global.UserDetailModules.renderTabTickets = function(state) {
    var tickets = state.tickets || [];
    
    if (tickets.length === 0) {
      return '<div style="padding:40px;text-align:center;color:var(--text-3)">' +
        '<h4>No support tickets</h4>' +
        '<p style="font-size:13px">This customer has not opened any support tickets.</p>' +
        '</div>';
    }

    var rows = tickets.map(function (t) {
      var statusCls = String(t.status || 'Open').replace(/\s+/g, '-');
      var priorityCls = String(t.priority || 'Normal').toLowerCase();
      
      // Adjust colors based on your CSS pill classes
      var statusPill = t.status === 'Closed' ? 'Cancelled' : 
                       t.status === 'Resolved' ? 'Delivered' : 
                       t.status === 'In Progress' ? 'In-Transit' : 'Pending';
      
      return '' +
        '<tr style="border-bottom:1px solid var(--border);">' +
          '<td style="padding:16px 20px;font-family:monospace;font-size:11.5px;color:var(--text-3);">' + esc(t.id || '—') + '</td>' +
          '<td style="font-weight:600;font-size:13px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            esc(t.subject || '—') +
          '</td>' +
          '<td style="font-weight:600;color:' + (t.priority === 'Urgent' ? 'var(--red)' : t.priority === 'High' ? 'var(--amber)' : 'var(--text-2)') + ';">' + esc(t.priority || 'Normal') + '</td>' +
          '<td><span class="pill ' + statusPill + '">' + esc(t.status || 'Open') + '</span></td>' +
          '<td style="font-size:12px;color:var(--text-3);white-space:nowrap">' + esc(fmtRelative(t.created_at)) + '</td>' +
          '<td style="font-size:12px;color:var(--text-3)">' + esc((t.replies && t.replies.length) || 0) + ' msg</td>' +
          '<td>' +
            '<button type="button" class="btn btn-sm btn-outline" data-action="open-ticket" data-id="' + esc(t.id) + '">' +
              '<i class="fas fa-eye"></i>' +
            '</button>' +
          '</td>' +
        '</tr>';
    }).join('');

    return '' +
      '<div style="margin-top:24px;overflow-x:auto;">' +
        '<table style="width:100%;border-collapse:collapse;text-align:left;">' +
          '<thead><tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">' +
            '<th style="padding:12px 20px;font-size:12px;color:var(--text-3);text-transform:uppercase;">ID</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Subject</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Priority</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Status</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Opened</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Replies</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;"></th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>';
  };

  // ================================================================
  // TAB: NOTIFICATIONS
  // ================================================================
  global.UserDetailModules.renderTabNotifications = function(state) {
    var notifs = state.notifications || [];
    var unread = notifs.filter(function (n) { return !n.is_read; }).length;

    if (notifs.length === 0) {
      return '<div style="padding:40px;text-align:center;color:var(--text-3)">' +
        '<h4>No notifications</h4>' +
        '<p style="font-size:13px">This customer has not received any notifications yet.</p>' +
        '</div>';
    }

    var header = '' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:24px;margin-bottom:16px">' +
        '<h3 style="margin:0;font-size:15px;font-weight:700">' +
          'Notifications (' + notifs.length + ')' +
          (unread > 0 ? ' — <span style="color:var(--red);font-size:12px;background:#fef2f2;padding:2px 8px;border-radius:20px">' + unread + ' unread</span>' : '') +
        '</h3>' +
        (unread > 0
              ? '<button type="button" class="btn btn-sm btn-outline" data-action="mark-all-read">' +
                '<i class="fas fa-check-double"></i> Mark all read</button>'
              : '') +
      '</div>';

    var typeMap = {
      success: { bg: '#ecfdf5', fg: '#059669', icon: 'fa-circle-check' },
      warning: { bg: '#fffbeb', fg: '#d97706', icon: 'fa-triangle-exclamation' },
      error:   { bg: '#fef2f2', fg: '#dc2626', icon: 'fa-circle-xmark' },
      info:    { bg: '#eff6ff', fg: '#2563eb', icon: 'fa-circle-info' }
    };

    var feed = notifs.map(function (n) {
      var t = typeMap[n.type] || typeMap.info;
      return '' +
        '<div style="display:flex;gap:12px;padding:14px 0;border-bottom:1px solid var(--border);' + (n.is_read ? 'opacity:.65' : '') + '">' +
          '<div style="width:34px;height:34px;border-radius:9px;flex-shrink:0;background:' + t.bg + ';color:' + t.fg + ';display:inline-flex;align-items:center;justify-content:center;font-size:13px">' +
            '<i class="fas ' + t.icon + '"></i>' +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:2px">' +
              '<div style="font-weight:700;font-size:13.5px;color:var(--text)">' + esc(n.title || '(no title)') + '</div>' +
              '<div style="font-size:11px;color:var(--text-3);white-space:nowrap">' + esc(fmtRelative(n.created_at)) + '</div>' +
            '</div>' +
            '<div style="font-size:12.5px;color:var(--text-2);line-height:1.55">' + esc(n.message || '') + '</div>' +
          '</div>' +
        '</div>';
    }).join('');

    return header + '<div>' + feed + '</div>';
  };

})(window);