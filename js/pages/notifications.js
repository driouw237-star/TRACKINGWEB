/* ================================================================
   GlobalExpress — Customer App: Notifications (Supabase)
   File: js/pages/notifications.js
   ================================================================ */

(function (global) {
  'use strict';

  var Pages = global.Pages || {};
  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var fmtRelative = Utils.fmtRelative || function (d) {
    var ts = Date.parse(d); if (isNaN(ts)) return '—';
    var diff = Date.now() - ts, sec = Math.floor(diff/1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec/60); if (min < 60) return min + 'm ago';
    var hr = Math.floor(min/60); if (hr < 24) return hr + 'h ago';
    return Math.floor(hr/24) + 'd ago';
  };
  var toast = UI.toast || function (t, m, k) { if (global.console) console.log(t, m); };

  var state = {
    isLoading: true,
    notifications: []
  };

  var container = null;
  var handler = null;

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  async function fetchNotifications(user) {
    if (!window.supabaseClient) return;
    state.isLoading = true;

    try {
      const { data, error } = await window.supabaseClient
        .schema('app')
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      state.notifications = data || [];

    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      state.isLoading = false;
      if (container) {
        container.innerHTML = render({ user: user });
        bind({ user: user });
      }
    }
  }

  async function markAsRead(id) {
    if (!window.supabaseClient) return;
    try {
      // 1. Update the database
      const { error } = await window.supabaseClient
        .schema('app')
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      // 2. Update local state
      var notif = state.notifications.find(function(n) { return n.id === id; });
      if (notif) {
        notif.is_read = true;
        notif.read_at = new Date().toISOString();
      }

      // 3. Re-render
      document.getElementById('content').innerHTML = render({ user: global.App.state.user });
      bind({ user: global.App.state.user });
      
    } catch (err) {
      console.error('Failed to mark read:', err);
      toast('Error', 'Failed to mark as read.', 'error');
    }
  }

  async function markAllAsRead() {
    if (!window.supabaseClient) return;
    var user = global.App.state.user;
    
    try {
      const { error } = await window.supabaseClient
        .schema('app')
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('is_read', false);

      if (error) throw error;

      state.notifications.forEach(function(n) { 
        n.is_read = true; 
        n.read_at = new Date().toISOString();
      });

      document.getElementById('content').innerHTML = render({ user: user });
      bind({ user: user });
      toast('Success', 'All notifications marked as read.', 'success');

    } catch (err) {
      console.error('Failed to mark all read:', err);
      toast('Error', 'Failed to update notifications.', 'error');
    }
  }

  // ================================================================
  // RENDER
  // ================================================================
  function render(ctx) {
    var unreadCount = state.notifications.filter(function(n) { return !n.is_read; }).length;

    return `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <div>
          <h2>Notifications</h2>
          <p class="page-subtitle">Stay updated on your shipments and account.</p>
        </div>
        ${unreadCount > 0 ? `
          <button class="btn btn-outline btn-sm" id="btn-mark-all-read">
            <i class="fas fa-check-double"></i> Mark all as read
          </button>
        ` : ''}
      </div>

      <div class="panel" style="padding:0;overflow:hidden;">
        <div id="notif-list-mount">
          <div style="padding:40px;text-align:center;color:var(--text-3);">
            <i class="fas fa-circle-notch fa-spin"></i> Loading notifications...
          </div>
        </div>
      </div>
    `;
  }

  function renderList() {
    var mount = document.getElementById('notif-list-mount');
    if (!mount) return;

    if (state.isLoading) return;

    if (state.notifications.length === 0) {
      mount.innerHTML = `
        <div style="padding:60px 20px;text-align:center;">
          <div style="font-size:32px;color:var(--border);margin-bottom:12px;"><i class="fas fa-bell-slash"></i></div>
          <h4 style="margin-bottom:8px;">You're all caught up!</h4>
          <p style="color:var(--text-3);font-size:13px;">No new notifications.</p>
        </div>
      `;
      return;
    }

    var typeMap = {
      success: { bg: '#ecfdf5', fg: '#059669', icon: 'fa-circle-check' },
      warning: { bg: '#fffbeb', fg: '#d97706', icon: 'fa-triangle-exclamation' },
      error:   { bg: '#fef2f2', fg: '#dc2626', icon: 'fa-circle-xmark' },
      info:    { bg: '#eff6ff', fg: '#2563eb', icon: 'fa-circle-info' }
    };

    var html = state.notifications.map(function(n) {
      var t = typeMap[n.type] || typeMap.info;
      var isUnread = !n.is_read;
      
      return `
        <div style="display:flex;gap:16px;padding:20px;border-bottom:1px solid var(--border);${isUnread ? 'background:#f8fafc;' : ''}">
          <div style="width:40px;height:40px;border-radius:10px;flex-shrink:0;background:${t.bg};color:${t.fg};display:flex;align-items:center;justify-content:center;font-size:16px;">
            <i class="fas ${t.icon}"></i>
          </div>
          
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin-bottom:4px;">
              <div style="font-weight:${isUnread ? '800' : '600'};font-size:14.5px;color:var(--text);">${esc(n.title)}</div>
              <div style="font-size:12px;color:var(--text-3);white-space:nowrap;">${esc(fmtRelative(n.created_at))}</div>
            </div>
            <div style="font-size:13.5px;color:var(--text-2);line-height:1.5;">${esc(n.message)}</div>
            
            ${n.link ? `
              <div style="margin-top:8px;">
                <button class="btn btn-sm btn-outline" onclick="App.go('${esc(n.link)}')">View Details</button>
              </div>
            ` : ''}
          </div>

          <div style="flex-shrink:0;display:flex;align-items:flex-start;">
            ${isUnread ? `
              <button class="btn btn-sm btn-ghost" title="Mark as read" data-action="mark-read" data-id="${esc(n.id)}" style="color:var(--blue);">
                <i class="fas fa-check"></i>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    mount.innerHTML = html;
  }

  // ================================================================
  // BIND
  // ================================================================
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (state.isLoading && ctx.user) {
      fetchNotifications(ctx.user);
      return;
    }

    renderList();

    if (handler) container.removeEventListener('click', handler);
    handler = function(e) {
      // Mark single as read
      var btn = e.target.closest('[data-action="mark-read"]');
      if (btn) {
        markAsRead(btn.dataset.id);
        return;
      }

      // Mark all as read
      if (e.target.closest('#btn-mark-all-read')) {
        markAllAsRead();
        return;
      }
    };
    container.addEventListener('click', handler);
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler = null;
    state.notifications = [];
    state.isLoading = true;
  }

  Pages['notifications'] = {
    title: 'Notifications',
    subtitle: 'Stay updated',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  global.Pages = Pages;

})(window);