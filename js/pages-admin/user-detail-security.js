/* ================================================================
   GlobalExpress — Admin User Detail: SECURITY & LOGS MODULE
   File: js/user-detail-security.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var esc = Utils.esc || function(s){return String(s||'');};
  var money = Utils.money || function(n){return 'Fr. '+Number(n||0).toLocaleString();};
  var fmtDate = Utils.fmtDate || function(d){return new Date(d).toLocaleDateString();};
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
  // TAB: ACTIVITY (Merged Timeline)
  // ================================================================
  global.UserDetailModules.renderTabActivity = function(state) {
    var items = [];

    // 1. Payments
    state.payments.forEach(function(p) {
      items.push({ 
        when: Date.parse(p.created_at || 0), 
        icon: 'fa-credit-card', 
        color: p.amount >= 0 ? 'green' : 'red',
        title: (p.kind || 'Payment') + ' — ' + money(p.amount),
        subtitle: (p.method || '—') + ' · ' + (p.status || '—') 
      });
    });

    // 2. Shipments
    state.shipments.forEach(function(s) {
      items.push({ 
        when: Date.parse(s.created_at || 0), 
        icon: 'fa-box', 
        color: 'blue',
        title: 'Shipment ' + (s.tracking_code || '—'),
        subtitle: (s.origin_city||'?') + ' → ' + (s.dest_city||'?') + ' · ' + (s.status||'Pending') 
      });
    });

    // Sort newest first
    items.sort(function(a,b) { return b.when - a.when; });

    if (items.length === 0) {
      return '<div style="padding:40px;text-align:center;color:var(--text-3)"><h4>No activity yet</h4><p>Events will appear here.</p></div>';
    }

    var colorMap = {
      green: { bg: '#ecfdf5', fg: '#059669' },
      red: { bg: '#fef2f2', fg: '#dc2626' },
      blue: { bg: '#eff6ff', fg: '#2563eb' },
      amber: { bg: '#fffbeb', fg: '#d97706' }
    };

    var html = '<div style="margin-top:24px;position:relative;padding-left:36px">' +
      '<div style="position:absolute;left:15px;top:8px;bottom:8px;width:2px;background:var(--border)"></div>';

    items.forEach(function (it) {
      var c = colorMap[it.color] || colorMap.blue;
      html += '<div style="position:relative;padding:0 0 20px 0">' +
        '<div style="position:absolute;left:-36px;top:0;width:32px;height:32px;border-radius:50%;background:' + c.bg + ';color:' + c.fg + ';display:flex;align-items:center;justify-content:center;font-size:12px;border:3px solid #fff;box-shadow:0 0 0 1px ' + c.bg + '">' +
        '<i class="fas ' + it.icon + '"></i></div>' +
        '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:2px">' +
        '<div style="font-weight:700;font-size:13px;color:var(--text)">' + esc(it.title) + '</div>' +
        '<div style="font-size:11px;color:var(--text-3);white-space:nowrap">' + esc(fmtRelative(new Date(it.when))) + '</div>' +
        '</div>' +
        (it.subtitle ? '<div style="font-size:12px;color:var(--text-2)">' + esc(it.subtitle) + '</div>' : '') +
        '</div></div>';
    });

    return html + '</div>';
  };

  // ================================================================
  // TAB: SECURITY
  // ================================================================
  global.UserDetailModules.renderTabSecurity = function(state) {
    var u = state.user;
    
    // Safety checks if the flags object doesn't exist yet
    var flags = u.flags || {};
    var has2FA = !!flags.twoFactor;

    return '' +
      '<div class="panel" style="margin-top:24px">' +
        '<div class="panel-header"><h3><i class="fas fa-shield-halved"></i> Security & Access</h3></div>' +
        '<div class="panel-body" style="padding:0 20px">' +
          // Password
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 0;border-bottom:1px solid var(--border)">' +
            '<div><div style="font-weight:600;font-size:14px;color:var(--text)">Password</div>' +
            '<div style="font-size:12.5px;color:var(--text-2);margin-top:2px">Send a password reset link to this user.</div></div>' +
            '<button type="button" class="btn btn-outline btn-sm" data-action="reset-pass"><i class="fas fa-key"></i> Reset Password</button>' +
          '</div>' +
          
          // 2FA
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 0;border-bottom:1px solid var(--border)">' +
            '<div><div style="font-weight:600;font-size:14px;color:var(--text)">Two-Factor Authentication</div>' +
            '<div style="font-size:12.5px;color:var(--text-2);margin-top:2px">Currently ' + (has2FA ? 'enabled' : 'disabled') + '.</div></div>' +
            '<button type="button" class="btn ' + (has2FA ? 'btn-outline' : 'btn-primary') + ' btn-sm" data-action="toggle-2fa"><i class="fas fa-shield-halved"></i> ' + (has2FA ? 'Disable 2FA' : 'Enable 2FA') + '</button>' +
          '</div>' +
          
          // Force Logout
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px 0;">' +
            '<div><div style="font-weight:600;font-size:14px;color:var(--text)">Force Logout</div>' +
            '<div style="font-size:12.5px;color:var(--text-2);margin-top:2px">Invalidate all sessions and force this user to sign in again.</div></div>' +
            '<button type="button" class="btn btn-danger btn-sm" data-action="force-logout"><i class="fas fa-power-off"></i> Force Logout</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  };

  // ================================================================
  // TAB: ADMIN NOTES
  // ================================================================
  global.UserDetailModules.renderTabNotes = function(state) {
    var notes = state.notes || [];
    
    var compose = '' +
      '<div class="panel" style="margin-top:24px">' +
        '<div class="panel-header"><h3><i class="fas fa-clipboard"></i> Admin Notes</h3></div>' +
        '<div class="panel-body">' +
          '<div class="field" style="margin-bottom:16px">' +
            '<label>New Note</label>' +
            '<textarea id="udNewNote" rows="3" placeholder="Only admins see this. Use for context, escalations, or warnings." style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;"></textarea>' +
          '</div>' +
          '<div style="text-align:right">' +
            '<button type="button" class="btn btn-primary btn-sm" data-action="save-note"><i class="fas fa-plus"></i> Save Note</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    if (notes.length === 0) {
      return compose + '<div style="padding:40px;text-align:center;color:var(--text-3)"><h4>No notes yet</h4><p style="font-size:13px">Add private notes to record context about this customer.</p></div>';
    }

    var feed = notes.map(function (n) {
      return '' +
        '<div style="padding:14px 16px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;margin-bottom:12px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">' +
            '<div style="font-size:12px;color:var(--text-3)"><i class="fas fa-user-shield" style="margin-right:4px"></i>' + esc(n.adminName || 'Admin') + ' · ' + esc(fmtRelative(n.at)) + '</div>' +
            '<div style="display:flex;gap:4px">' +
              '<button type="button" class="btn btn-sm btn-ghost" data-action="delete-note" data-note-id="' + esc(n.id) + '" title="Delete" style="color:var(--red)"><i class="fas fa-trash"></i></button>' +
            '</div>' +
          '</div>' +
          '<div style="font-size:13.5px;color:var(--text);line-height:1.6;white-space:pre-wrap">' + esc(n.text || '') + '</div>' +
        '</div>';
    }).join('');

    return compose + '<div style="margin-top:16px">' + feed + '</div>';
  };

})(window);