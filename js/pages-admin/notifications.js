/* ================================================================
   GlobalExpress — Admin Page: Notifications (Supabase)
   File: js/notifications.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var fmtRelative = Utils.fmtRelative || function(d){ return String(d); };
  var toast = UI.toast || function (t, m) { if (global.console) console.log(t, m); };

  var state = {
    activeTab: 'compose',
    history: [],
    isSending: false
  };

  var pageHandler = null;
  var pageContainer = null;

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  async function loadHistory() {
    if (!window.supabaseClient) return;
    try {
      // Fetch a sample of recent notifications to show in history
      // (Since we send one per user, we group by broadcast_id or just show recent)
      const { data, error } = await window.supabaseClient
        .schema('app')
        .from('notifications')
        .select('*')
        .eq('source', 'admin-broadcast')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      
      // Deduplicate by broadcast_id or title+message so we don't show 100 of the same broadcast
      var seen = new Set();
      var unique = [];
      (data || []).forEach(function(n) {
        var key = n.broadcast_id || (n.title + n.message);
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(n);
        }
      });
      
      state.history = unique;
    } catch (err) {
      console.error('Failed to load notification history:', err);
    }
  }

  // ================================================================
  // RENDER HELPERS
  // ================================================================
  function renderTabsBar() {
    return '<div class="users-tabs-bar" style="display:flex;gap:10px;margin-bottom:20px;border-bottom:1px solid var(--border);">' +
      '<button type="button" class="users-tab" data-notif-tab="compose" style="background:none;border:none;padding:12px 20px;font-weight:600;cursor:pointer;' + (state.activeTab === 'compose' ? 'border-bottom:2px solid var(--accent); color:var(--text);' : 'color:var(--text-3);') + '"><i class="fas fa-paper-plane"></i> Compose</button>' +
      '<button type="button" class="users-tab" data-notif-tab="history" style="background:none;border:none;padding:12px 20px;font-weight:600;cursor:pointer;' + (state.activeTab === 'history' ? 'border-bottom:2px solid var(--accent); color:var(--text);' : 'color:var(--text-3);') + '"><i class="fas fa-clock-rotate-left"></i> Sent History</button>' +
    '</div>';
  }

  function renderHeader() {
    return '<div class="page-header" style="margin-bottom:20px;">' +
      '<div><h2>Broadcast Center</h2><p class="page-subtitle">Send platform-wide notifications and alerts.</p></div>' +
      '</div>';
  }

  // ================================================================
  // COMPOSE TAB
  // ================================================================
  function renderCompose() {
    var templates = [
      { id: 'maint', title: 'Scheduled Maintenance', msg: 'We will be performing scheduled maintenance tonight from 2:00 AM to 4:00 AM UTC. Some services may be temporarily unavailable.' },
      { id: 'promo', title: 'Special Offer!', msg: 'Get 20% off your next shipment! Use code FAST20 at checkout. Valid until Sunday.' },
      { id: 'security', title: 'Security Alert', msg: 'We detected a login from a new device. If this was not you, please reset your password immediately.' }
    ];

    var templateHtml = templates.map(function(t) {
      return '<button type="button" class="btn btn-outline btn-sm" data-action="load-template" data-title="' + esc(t.title) + '" data-msg="' + esc(t.msg) + '">' + esc(t.title) + '</button>';
    }).join(' ');

    return '<div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">' +
      
      // LEFT: Form
      '<div class="panel" style="border-top:4px solid var(--accent);">' +
        '<div class="panel-header"><h3><i class="fas fa-bullhorn"></i> New Broadcast</h3></div>' +
        '<div class="panel-body">' +
          
          '<div style="margin-bottom:20px;">' +
            '<label style="font-weight:700;font-size:12.5px;color:var(--text-3);text-transform:uppercase;">Quick Templates</label>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' + templateHtml + '</div>' +
          '</div>' +

          '<div class="field" style="margin-bottom:16px;">' +
            '<label>Target Audience</label>' +
            '<select id="notifTarget" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">' +
              '<option value="all">All Users (Excluding Admins)</option>' +
              '<option value="zero-wallet">Users with Zero Wallet</option>' +
              '<option value="active-shippers">Users with Active Shipments</option>' +
            '</select>' +
          '</div>' +

          '<div class="field" style="margin-bottom:16px;">' +
            '<label>Title / Subject</label>' +
            '<input type="text" id="notifTitle" placeholder="e.g. Important Platform Update" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />' +
          '</div>' +

          '<div class="field" style="margin-bottom:16px;">' +
            '<label style="display:flex;justify-content:space-between;">' +
              '<span>Message Content</span>' +
              '<span id="charCount" style="font-weight:400;font-size:11.5px;color:var(--text-3);">0 / 160 characters</span>' +
            '</label>' +
            '<textarea id="notifMessage" rows="4" placeholder="Type your message here..." style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" oninput="document.getElementById(\'charCount\').textContent = this.value.length + \' / 160 characters\';"></textarea>' +
          '</div>' +

          '<div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">' +
            '<div class="field">' +
              '<label>Message Type</label>' +
              '<select id="notifType" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">' +
                '<option value="info">Info (Blue)</option>' +
                '<option value="success">Success (Green)</option>' +
                '<option value="warning">Warning (Amber)</option>' +
                '<option value="error">Error (Red)</option>' +
              '</select>' +
            '</div>' +
            '<div class="field">' +
              '<label>Deep Link (Optional)</label>' +
              '<select id="notifLink" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">' +
                '<option value="">None</option>' +
                '<option value="wallet">Go to Wallet</option>' +
                '<option value="shipments">View Shipments</option>' +
                '<option value="support">Contact Support</option>' +
              '</select>' +
            '</div>' +
          '</div>' +

          '<button type="button" class="btn btn-primary btn-block btn-lg" id="notifSendBtn" style="width:100%;padding:14px;font-size:16px;">' +
            '<i class="fas fa-paper-plane"></i> Send Broadcast' +
          '</button>' +
        '</div>' +
      '</div>' +

      // RIGHT: Preview
      '<div class="panel" style="position:sticky;top:24px;">' +
        '<div class="panel-header"><h3><i class="fas fa-mobile-screen"></i> Live Preview</h3></div>' +
        '<div class="panel-body" style="background:var(--surface-2);padding:24px;">' +
          
          '<div id="previewCard" style="background:#fff;border-radius:16px;padding:16px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
              '<div style="width:24px;height:24px;background:var(--brand);color:#fff;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;">GE</div>' +
              '<div style="font-size:11px;font-weight:700;color:#333;">GlobalExpress</div>' +
              '<div style="font-size:10px;color:#999;margin-left:auto;">now</div>' +
            '</div>' +
            '<div id="previewTitle" style="font-weight:700;font-size:14px;color:#111;margin-bottom:4px;">Notification Title</div>' +
            '<div id="previewMsg" style="font-size:13px;color:#555;line-height:1.4;">Your message will appear here. Start typing on the left to see the preview update in real-time.</div>' +
          '</div>' +

        '</div>' +
      '</div>' +

    '</div>';
  }

  // ================================================================
  // HISTORY TAB
  // ================================================================
  function renderHistory() {
    if (state.history.length === 0) {
      return '<div class="panel" style="padding:40px;text-align:center;color:var(--text-3)">No broadcasts sent yet.</div>';
    }

    var rows = state.history.map(function(n) {
      var typeColor = n.type === 'success' ? 'var(--green)' : 
                      n.type === 'error' ? 'var(--red)' : 
                      n.type === 'warning' ? 'var(--amber)' : 'var(--blue)';
      
      return '<tr style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:16px 20px;font-size:12px;color:var(--text-3);">'+new Date(n.created_at).toLocaleString()+'</td>' +
        '<td><div style="font-weight:600;font-size:13px;">'+esc(n.title)+'</div></td>' +
        '<td style="font-size:12.5px;color:var(--text-2);max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(n.message)+'</td>' +
        '<td><span style="font-size:11px;font-weight:700;text-transform:uppercase;color:'+typeColor+';">'+esc(n.type)+'</span></td>' +
      '</tr>';
    }).join('');

    return '<div class="panel" style="padding:0;overflow-x:auto;">' +
      '<table style="width:100%;border-collapse:collapse;text-align:left;">' +
        '<thead><tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">' +
          '<th style="padding:12px 20px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Date Sent</th>' +
          '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Subject</th>' +
          '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Message</th>' +
          '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Type</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render() {
    var content = state.activeTab === 'compose' ? renderCompose() : renderHistory();
    return '<div class="notifications-page" style="max-width:1100px;margin:0 auto;">' +
      renderHeader() + renderTabsBar() + content +
    '</div>';
  }

  // ================================================================
  // ACTIONS
  // ================================================================
  async function handleSend() {
    if (state.isSending) return;
    var sb = window.supabaseClient;
    
    var title = document.getElementById('notifTitle').value.trim();
    var message = document.getElementById('notifMessage').value.trim();
    var type = document.getElementById('notifType').value;
    var target = document.getElementById('notifTarget').value;
    var link = document.getElementById('notifLink').value.trim();

    if (!title || !message) {
      return toast('Missing Fields', 'Title and message are required.', 'error');
    }

    state.isSending = true;
    var btn = document.getElementById('notifSendBtn');
    var originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending...';
    btn.disabled = true;

    try {
      // 1. Fetch targeted users
      var query = sb.schema('app').from('users').select('id').neq('role', 'admin').neq('role', 'super_admin');
      
      if (target === 'zero-wallet') {
        query = query.eq('wallet', 0);
      } else if (target === 'active-shippers') {
        // Find users who have active shipments
        var { data: activeShips } = await sb.schema('app').from('shipments')
          .select('created_by')
          .in('status', ['Pending', 'In Transit', 'On Hold']);
        
        var activeUserIds = [...new Set((activeShips || []).map(s => s.created_by))];
        if (activeUserIds.length === 0) {
          throw new Error('No users with active shipments found.');
        }
        query = query.in('id', activeUserIds);
      }

      const { data: users, error: userErr } = await query;
      if (userErr) throw userErr;
      if (!users || users.length === 0) throw new Error('No users matched the target criteria.');

      // 2. Build the bulk insert payload
      var broadcastId = crypto.randomUUID(); // Unique ID to group this batch
      var now = new Date().toISOString();
      
      var notifications = users.map(function(u) {
        return {
          user_id: u.id,
          title: title,
          message: message,
          type: type,
          source: 'admin-broadcast',
          link: link || null,
          is_read: false,
          broadcast_id: broadcastId,
          created_at: now
        };
      });

      // 3. Insert into Supabase
      const { error: insertErr } = await sb.schema('app').from('notifications').insert(notifications);
      if (insertErr) throw insertErr;

      // 4. Log to Audit
      await sb.schema('audit').from('logs').insert({
        action: 'notification.broadcast',
        actor_type: 'admin',
        target: target,
        details: 'Broadcasted "'+title+'" to '+users.length+' users.',
        created_at: now
      });

      toast('Broadcast Sent', 'Successfully delivered to ' + users.length + ' users.', 'success');
      
      // Reset form
      document.getElementById('notifTitle').value = '';
      document.getElementById('notifMessage').value = '';
      document.getElementById('previewTitle').textContent = 'Notification Title';
      document.getElementById('previewMsg').textContent = 'Your message will appear here...';
      document.getElementById('charCount').textContent = '0 / 160 characters';

      // Refresh history
      await loadHistory();

    } catch (err) {
      console.error('Broadcast failed:', err);
      toast('Error', err.message || 'Failed to send broadcast.', 'error');
    } finally {
      state.isSending = false;
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  // ================================================================
  // BIND
  // ================================================================
  function bind() {
    pageContainer = document.getElementById('content');
    if (!pageContainer) return;
    
    // If on history tab, load data
    if (state.activeTab === 'history') {
      loadHistory().then(function() {
        document.getElementById('content').innerHTML = render();
        bind();
      });
      return;
    }

    // Wire up live preview
    var titleEl = document.getElementById('notifTitle');
    var msgEl = document.getElementById('notifMessage');
    var prevTitle = document.getElementById('previewTitle');
    var prevMsg = document.getElementById('previewMsg');
    var prevCard = document.getElementById('previewCard');

    if (titleEl && prevTitle) {
      titleEl.addEventListener('input', function() { prevTitle.textContent = titleEl.value || 'Notification Title'; });
    }
    if (msgEl && prevMsg) {
      msgEl.addEventListener('input', function() { prevMsg.textContent = msgEl.value || 'Your message will appear here...'; });
    }
    var typeEl = document.getElementById('notifType');
    if (typeEl && prevCard) {
      typeEl.addEventListener('change', function() {
        var c = typeEl.value === 'success' ? '#ecfdf5' : typeEl.value === 'error' ? '#fef2f2' : typeEl.value === 'warning' ? '#fffbeb' : '#eff6ff';
        prevCard.style.background = c;
      });
    }

    if (pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageHandler = function(e) {
      var tab = e.target.closest('[data-notif-tab]');
      if (tab) {
        state.activeTab = tab.dataset.notifTab;
        document.getElementById('content').innerHTML = render();
        bind();
        return;
      }

      var tplBtn = e.target.closest('[data-action="load-template"]');
      if (tplBtn) {
        var t = document.getElementById('notifTitle');
        var m = document.getElementById('notifMessage');
        if (t && m) {
          t.value = tplBtn.dataset.title;
          m.value = tplBtn.dataset.msg;
          t.dispatchEvent(new Event('input'));
          m.dispatchEvent(new Event('input'));
        }
        return;
      }

      if (e.target.closest('#notifSendBtn')) {
        handleSend();
        return;
      }
    };
    pageContainer.addEventListener('click', pageHandler);
  }

  function cleanup() {
    if (pageContainer && pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageContainer = null;
    pageHandler = null;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin.notifications = {
    title: 'Notifications',
    subtitle: 'Send and manage platform notifications',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);