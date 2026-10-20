/* GlobalExpress - pages/notifications.js
   Notifications page: full list grouped by day, filter tabs (All / Unread),
   mark-as-read on click, mark-all-as-read, realtime, empty states.

   Registers itself via App.register('notifications', page).
   Reads/writes Store (notifications).
   Emits realtime events via Realtime.notifyLocalChange.
*/
(function (global) {
  'use strict';

  var Utils    = global.Utils    || {};
  var UI       = global.UI       || {};
  var Store    = global.Store    || {};
  var Realtime = global.Realtime || {};

  // --- Fallbacks -----------------------------------------------------------

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };

  // --- Constants -----------------------------------------------------------

  // Icon + color per notification type
  var TYPE_ICON = {
    success: { icon: 'fa-circle-check',    bg: '#ecfdf5', fg: '#047857' },
    error:   { icon: 'fa-circle-xmark',    bg: '#fef2f2', fg: '#b91c1c' },
    warning: { icon: 'fa-triangle-exclamation', bg: '#fffbeb', fg: '#b45309' },
    info:    { icon: 'fa-circle-info',     bg: '#eff6ff', fg: '#1d4ed8' }
  };

  // --- Module state --------------------------------------------------------

  var filter = 'all';   // 'all' | 'unread'
  var handler = null;
  var container = null;

  // --- Helpers -------------------------------------------------------------

  function currentUser(ctx) {
    return (ctx && ctx.user) || (global.App && global.App.state && global.App.state.user) || null;
  }

  function getUserNotifications(userId) {
    var all = [];
    try { all = Store.get('notifications') || []; } catch (e) {}
    return all
      .filter(function (n) { return n.userId === userId; })
      .sort(function (a, b) { return parseDate(b.at) - parseDate(a.at); }); // newest first
  }

  function parseDate(s) {
    if (!s) return 0;
    var iso = Date.parse(s);
    if (!isNaN(iso)) return iso;
    var cleaned = String(s).replace('·', '').trim();
    var d = Date.parse(cleaned);
    return isNaN(d) ? 0 : d;
  }

  function unreadCount(list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (!list[i].read) n++;
    return n;
  }

  // --- Day grouping --------------------------------------------------------

  function dayBucket(ts) {
    if (!ts) return 'Older';

    var now = new Date();
    var d = new Date(ts);

    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var yesterdayStart = todayStart - 86400000;
    var weekStart = todayStart - 6 * 86400000;

    if (ts >= todayStart)      return 'Today';
    if (ts >= yesterdayStart)  return 'Yesterday';
    if (ts >= weekStart)       return 'Earlier this week';
    return 'Older';
  }

  function groupByDay(list) {
    var buckets = {};
    var order = [];

    list.forEach(function (n) {
      var key = dayBucket(parseDate(n.at));
      if (!buckets[key]) { buckets[key] = []; order.push(key); }
      buckets[key].push(n);
    });

    // Ensure the day order is stable regardless of insertion order
    var DAY_ORDER = ['Today', 'Yesterday', 'Earlier this week', 'Older'];
    return DAY_ORDER
      .filter(function (k) { return buckets[k] && buckets[k].length; })
      .map(function (k) { return { label: k, items: buckets[k] }; });
  }

  // --- Card renderer -------------------------------------------------------

  function cardHtml(n) {
    var meta = TYPE_ICON[n.type] || TYPE_ICON.info;
    var unreadClass = n.read ? '' : ' unread';

    return ''
      + '<div class="notif-card' + unreadClass + '" data-id="' + esc(n.id) + '" style="'
      +   'display:flex;gap:14px;padding:16px 20px;border-bottom:1px solid var(--border-2);'
      +   'cursor:pointer;transition:background-color .12s;'
      +   (n.read ? '' : 'background:#fefce8;')
      + '">'

      +   '<div style="flex-shrink:0;width:36px;height:36px;border-radius:10px;'
      +     'background:' + meta.bg + ';color:' + meta.fg + ';'
      +     'display:inline-flex;align-items:center;justify-content:center;font-size:15px">'
      +     '<i class="fas ' + esc(meta.icon) + '"></i>'
      +   '</div>'

      +   '<div style="flex:1;min-width:0">'
      +     '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">'
      +       '<div style="font-weight:600;font-size:13.5px;color:var(--text);line-height:1.35">'
      +         esc(n.title || 'Notification')
      +       '</div>'
      +       (n.read ? '' : '<span style="flex-shrink:0;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:6px"></span>')
      +     '</div>'
      +     (n.message
              ? '<div style="font-size:13px;color:var(--text-2);margin-top:3px;line-height:1.5">' + esc(n.message) + '</div>'
              : '')
      +     '<div style="font-size:11.5px;color:var(--text-3);margin-top:6px">' + esc(n.at || '') + '</div>'
      +   '</div>'

      + '</div>';
  }

  // --- Empty states --------------------------------------------------------

  function emptyAll() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-bell-slash"></i></div>'
      +   '<h4>No notifications yet</h4>'
      +   '<p>We\'ll let you know when something happens with your account, wallet, or shipments.</p>'
      + '</div>';
  }

  function emptyUnread() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-circle-check" style="color:var(--green)"></i></div>'
      +   '<h4>You\'re all caught up</h4>'
      +   '<p>There are no unread notifications.</p>'
      +   '<button type="button" class="btn btn-outline" data-action="filter-all">'
      +     '<i class="fas fa-list"></i> View all'
      +   '</button>'
      + '</div>';
  }

  // --- Render list ---------------------------------------------------------

  function renderList(userId) {
    var host = document.getElementById('notifList');
    if (!host) return;

    var all = getUserNotifications(userId);
    var list = filter === 'unread'
      ? all.filter(function (n) { return !n.read; })
      : all;

    if (all.length === 0) {
      host.innerHTML = emptyAll();
      return;
    }
    if (list.length === 0) {
      host.innerHTML = emptyUnread();
      return;
    }

    var groups = groupByDay(list);

    var html = '';
    groups.forEach(function (g) {
      html += ''
        + '<div style="padding:14px 20px 6px;font-size:11px;text-transform:uppercase;'
        +   'letter-spacing:.8px;color:var(--text-3);font-weight:700;background:var(--surface-2);'
        +   'border-bottom:1px solid var(--border-2)">'
        +   esc(g.label) + ' <span style="color:var(--text-4,#cbd5e1);font-weight:500;margin-left:4px">· ' + g.items.length + '</span>'
        + '</div>';
      html += g.items.map(cardHtml).join('');
    });

    host.innerHTML = html;
  }

  // --- Update header counts ------------------------------------------------

  function updateHeader(userId) {
    var all = getUserNotifications(userId);
    var unread = unreadCount(all);

    var headerCount = document.getElementById('notifHeaderCount');
    if (headerCount) {
      headerCount.textContent = all.length + ' total' + (unread > 0 ? ' · ' + unread + ' unread' : '');
    }

    var tabAll = document.getElementById('tabAllCount');
    var tabUnread = document.getElementById('tabUnreadCount');
    if (tabAll) tabAll.textContent = String(all.length);
    if (tabUnread) tabUnread.textContent = String(unread);

    // Toggle mark-all-read button visibility
    var markBtn = document.getElementById('markAllBtn');
    if (markBtn) {
      markBtn.disabled = unread === 0;
      markBtn.style.opacity = unread === 0 ? '.5' : '1';
    }
  }

  // --- Read / unread writes ------------------------------------------------

  function markRead(id) {
    var user = currentUser();
    if (!user) return;

    var all = Store.get('notifications') || [];
    var idx = -1;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id && all[i].userId === user.id) { idx = i; break; }
    }
    if (idx === -1 || all[idx].read) return;

    all[idx].read = true;
    Store.set('notifications', all);
    if (Realtime.notifyLocalChange) Realtime.notifyLocalChange('notification:read');

    renderList(user.id);
    updateHeader(user.id);
  }

  function markAllRead() {
    var user = currentUser();
    if (!user) return;

    var all = Store.get('notifications') || [];
    var changed = false;
    for (var i = 0; i < all.length; i++) {
      if (all[i].userId === user.id && !all[i].read) {
        all[i].read = true;
        changed = true;
      }
    }
    if (!changed) { toast('Nothing to mark', '', 'info'); return; }

    Store.set('notifications', all);
    if (Realtime.notifyLocalChange) Realtime.notifyLocalChange('notification:read');

    toast('All marked as read', '', 'success');
    renderList(user.id);
    updateHeader(user.id);
  }

  // --- Deep-link to notification target ------------------------------------

  function navigateFromNotification(n) {
    var link = n.link;
    if (!link || !link.view) return false;
    if (global.App && global.App.go) {
      try { global.App.go(link.view, link.params || {}); return true; }
      catch (e) { return false; }
    }
    return false;
  }

  // --- Render page ---------------------------------------------------------

  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    var all = getUserNotifications(user.id);
    var unread = unreadCount(all);

    return ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-bell"></i> Notifications'
      +       ' <span id="notifHeaderCount" style="font-weight:500;color:var(--text-3);font-size:13px;margin-left:8px">'
      +         esc(all.length + ' total' + (unread > 0 ? ' · ' + unread + ' unread' : ''))
      +       '</span>'
      +     '</h3>'
      +     '<button type="button" class="btn btn-sm btn-outline" id="markAllBtn" data-action="mark-all" '
      +       (unread === 0 ? 'disabled style="opacity:.5"' : '') + '>'
      +       '<i class="fas fa-check-double"></i> Mark all as read'
      +     '</button>'
      +   '</div>'

      +   '<div class="panel-body" style="padding:0">'

      +     '<div class="tabs" style="padding:0 20px;margin:0;border-bottom:1.5px solid var(--border)">'
      +       '<button type="button" class="tab' + (filter === 'all' ? ' active' : '') + '" data-filter="all">'
      +         'All <span id="tabAllCount" style="font-weight:500;color:var(--text-3);margin-left:4px">(' + all.length + ')</span>'
      +       '</button>'
      +       '<button type="button" class="tab' + (filter === 'unread' ? ' active' : '') + '" data-filter="unread">'
      +         'Unread <span id="tabUnreadCount" style="font-weight:500;color:var(--text-3);margin-left:4px">(' + unread + ')</span>'
      +       '</button>'
      +     '</div>'

      +     '<div id="notifList"></div>'

      +   '</div>'
      + '</div>';
  }

  // --- Bind ----------------------------------------------------------------

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    var user = currentUser(ctx);
    if (!user) return;

    // Initial list
    renderList(user.id);

    handler = function (e) {
      // Filter tabs
      var tab = e.target.closest && e.target.closest('[data-filter]');
      if (tab) {
        filter = tab.dataset.filter;
        // Swap active class
        document.querySelectorAll('[data-filter]').forEach(function (t) {
          t.classList.toggle('active', t.dataset.filter === filter);
        });
        renderList(user.id);
        return;
      }

      // Actions
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (btn) {
        var action = btn.dataset.action;

        if (action === 'mark-all') { markAllRead(); return; }
        if (action === 'filter-all') {
          filter = 'all';
          document.querySelectorAll('[data-filter]').forEach(function (t) {
            t.classList.toggle('active', t.dataset.filter === 'all');
          });
          renderList(user.id);
          return;
        }
      }

      // Notification card click
      var card = e.target.closest && e.target.closest('[data-id]');
      if (card && card.classList.contains('notif-card')) {
        var id = card.dataset.id;
        var notif = null;
        var all = getUserNotifications(user.id);
        for (var i = 0; i < all.length; i++) {
          if (all[i].id === id) { notif = all[i]; break; }
        }

        // Mark read first
        markRead(id);

        // Then optionally navigate
        if (notif) {
          var navigated = navigateFromNotification(notif);
          if (!navigated && !notif.link) {
            // no link — no-op, user just wanted to mark it read
          }
        }
        return;
      }
    };

    container.addEventListener('click', handler);
  }

  // --- Cleanup -------------------------------------------------------------

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler = null;
    filter = 'all';
  }

  // --- Register ------------------------------------------------------------

  var page = {
    title: 'Notifications',
    subtitle: 'All your alerts and updates',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('notifications', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.notifications = page;
  }

})(window);