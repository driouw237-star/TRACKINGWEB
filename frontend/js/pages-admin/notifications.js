/* ================================================================
   GlobalExpress — Admin Page: Notifications (Pro Edition)
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
  var fmtRelative = Utils.fmtRelative || function (d) {
    var ts = Date.parse(d); if (isNaN(ts)) return '—';
    var diff = Date.now() - ts, sec = Math.floor(diff/1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec/60); if (min < 60) return min + 'm ago';
    var hr = Math.floor(min/60); if (hr < 24) return hr + 'h ago';
    return Math.floor(hr/24) + 'd ago';
  };
  var toast = UI.toast || function (t,m) { if (global.console) console.log(t, m); };

  var KEYS = { notifications:'ge_notifications', users:'ge_users', shipments: 'ge_shipments' };

  var state = {
    activeTab: 'compose',
    dt: null,
    history: []
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

  function parseWhen(s) {
    if (!s) return 0;
    var t = Date.parse(s);
    if (!isNaN(t)) return t;
    t = Date.parse(String(s).replace('·', '').trim());
    return isNaN(t) ? 0 : t;
  }

  function loadData() {
    var all = asArray(read(KEYS.notifications, []));
    state.history = all
      .filter(function (n) { return n && n.source === 'admin-broadcast'; })
      .sort(function (a, b) { return parseWhen(b.at) - parseWhen(a.at); });
  }

  function renderTabsBar() {
    return '<div class="users-tabs-bar">' +
      '<button type="button" class="users-tab' + (state.activeTab === 'compose' ? ' active' : '') + '" data-notif-tab="compose"><i class="fas fa-paper-plane"></i> Compose Broadcast</button>' +
      '<button type="button" class="users-tab' + (state.activeTab === 'history' ? ' active' : '') + '" data-notif-tab="history"><i class="fas fa-clock-rotate-left"></i> Sent History</button>' +
    '</div>';
  }

  function renderHeader() {
    return '<div class="page-header">' +
      '<div><h2>Broadcast Center</h2><p class="page-subtitle">Send platform-wide notifications and alerts.</p></div>' +
    '</div>';
  }

  // --- Compose UI ---
  function renderCompose() {
    var templates = [
      { id: 'maint', title: 'Scheduled Maintenance', msg: 'We will be performing scheduled maintenance tonight from 2:00 AM to 4:00 AM UTC. Some services may be temporarily unavailable.' },
      { id: 'promo', title: 'Special Offer!', msg: 'Get 20% off your next shipment! Use code FAST20 at checkout. Valid until Sunday.' },
      { id: 'security', title: 'Security Alert', msg: 'We detected a login from a new device. If this was not you, please reset your password immediately.' }
    ];

    var templateHtml = templates.map(function(t) {
      return '<button type="button" class="btn btn-outline btn-sm" data-action="load-template" data-title="' + esc(t.title) + '" data-msg="' + esc(t.msg) + '">' + esc(t.title) + '</button>';
    }).join(' ');

    return '<div class="grid-2" style="gap:24px;align-items:start;">' +
      
      // LEFT: Form
      '<div class="panel" style="border-top:4px solid var(--brand);">' +
        '<div class="panel-header"><h3><i class="fas fa-bullhorn"></i> New Broadcast</h3></div>' +
        '<div class="panel-body">' +
          
          '<div style="margin-bottom:20px;">' +
            '<label style="font-weight:700;font-size:12.5px;color:var(--text-3);text-transform:uppercase;">Quick Templates</label>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' + templateHtml + '</div>' +
          '</div>' +

          '<div class="field" style="margin-bottom:16px;">' +
            '<label>Target Audience</label>' +
            '<select id="notifTarget">' +
              '<option value="all">All Users (Excluding Admins)</option>' +
              '<option value="zero-wallet">Users with Zero Wallet</option>' +
              '<option value="active-shippers">Users with Active Shipments</option>' +
            '</select>' +
          '</div>' +

          '<div class="field" style="margin-bottom:16px;">' +
            '<label>Channels</label>' +
            '<div style="display:flex;gap:16px;margin-top:8px;">' +
              '<label class="checkbox"><input type="checkbox" checked disabled /> <span>In-App (Push)</span></label>' +
              '<label class="checkbox"><input type="checkbox" id="chanEmail" /> <span>Email</span></label>' +
              '<label class="checkbox"><input type="checkbox" id="chanSms" /> <span>SMS</span></label>' +
            '</div>' +
          '</div>' +

          '<div class="field" style="margin-bottom:16px;">' +
            '<label>Title / Subject</label>' +
            '<input type="text" id="notifTitle" placeholder="e.g. Important Platform Update" />' +
          '</div>' +

          '<div class="field" style="margin-bottom:16px;">' +
            '<label style="display:flex;justify-content:space-between;">' +
              '<span>Message Content</span>' +
              '<span id="charCount" style="font-weight:400;font-size:11.5px;color:var(--text-3);">0 / 160 characters</span>' +
            '</label>' +
            '<textarea id="notifMessage" rows="4" placeholder="Type your message here..." oninput="document.getElementById(\'charCount\').textContent = this.value.length + \' / 160 characters\';"></textarea>' +
            '<div style="font-size:11.5px;color:var(--text-3);margin-top:6px;">SMS carriers will truncate messages over 160 characters.</div>' +
          '</div>' +

          '<div class="grid-2" style="gap:16px;margin-bottom:20px;">' +
            '<div class="field">' +
              '<label>Message Type</label>' +
              '<select id="notifType">' +
                '<option value="info">Info (Blue)</option>' +
                '<option value="success">Success (Green)</option>' +
                '<option value="warning">Warning (Amber)</option>' +
                '<option value="error">Error (Red)</option>' +
              '</select>' +
            '</div>' +
            '<div class="field">' +
              '<label>Deep Link (Optional)</label>' +
              '<select id="notifLink">' +
                '<option value="">None</option>' +
                '<option value="wallet">Go to Wallet</option>' +
                '<option value="shipments">View Shipments</option>' +
                '<option value="support">Contact Support</option>' +
              '</select>' +
            '</div>' +
          '</div>' +

          '<button type="button" class="btn btn-primary btn-block btn-lg" id="notifSendBtn">' +
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

  // --- History UI ---
  function buildColumns() {
    return [
      { key:'at', label:'Date Sent', sortable:true,
        sortValue:function (n) { return parseWhen(n.at); },
        render:function (n) { return '<span class="text-dim">' + esc(fmtRelative(n.at)) + '</span>'; } },
      { key:'title', label:'Subject', sortable:true,
        render:function (n) { return '<strong>' + esc(n.title || 'No Title') + '</strong>'; } },
      { key:'message', label:'Message Snippet', sortable:false,
        render:function (n) {
          var txt = n.message || '';
          if (txt.length > 60) txt = txt.slice(0, 60) + '...';
          return '<span class="text-muted">' + esc(txt) + '</span>';
        } },
      { key:'type', label:'Type', sortable:true, hideSm:true,
        render:function (n) {
          var cls = n.type || 'info';
          return '<span class="pill ' + (cls === 'success' ? 'Delivered' : cls === 'error' ? 'Cancelled' : cls === 'warning' ? 'On-Hold' : 'In-Transit') + '">' + esc(cls) + '</span>';
        } }
    ];
  }

  function buildActionsCol() {
    return {
      label:'',
      render:function (n) {
        return '<button type="button" class="btn btn-ghost btn-sm" ' +
            'data-notif-action="view" data-id="' + esc(n.id) + '" title="View Details">' +
            '<i class="fas fa-eye"></i></button>';
      }
    };
  }

  function render(ctx) {
    loadData();
    var content = state.activeTab === 'compose' ? renderCompose() : '<div id="notif-table-mount"></div>';
    
    return '<div class="notifications-page" style="max-width:1100px;margin:0 auto;">' +
      renderHeader() + renderTabsBar() + content +
    '</div>';
  }

  function bind(ctx) {
    pageContainer = document.getElementById('content');
    if (!pageContainer) return;
    
    if (pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageHandler = onPageClick;
    pageContainer.addEventListener('click', pageHandler);

    // Wire up live preview
    if (state.activeTab === 'compose') {
      var titleEl = document.getElementById('notifTitle');
      var msgEl = document.getElementById('notifMessage');
      var prevTitle = document.getElementById('previewTitle');
      var prevMsg = document.getElementById('previewMsg');
      var prevCard = document.getElementById('previewCard');

      if (titleEl && prevTitle) {
        titleEl.addEventListener('input', function() {
          prevTitle.textContent = titleEl.value || 'Notification Title';
        });
      }
      if (msgEl && prevMsg) {
        msgEl.addEventListener('input', function() {
          prevMsg.textContent = msgEl.value || 'Your message will appear here. Start typing on the left to see the preview update in real-time.';
        });
      }
      var typeEl = document.getElementById('notifType');
      if (typeEl && prevCard) {
        typeEl.addEventListener('change', function() {
          var c = typeEl.value === 'success' ? '#ecfdf5' : typeEl.value === 'error' ? '#fef2f2' : typeEl.value === 'warning' ? '#fffbeb' : '#eff6ff';
          prevCard.style.background = c;
        });
      }
    }

    if (state.activeTab === 'history') {
      var mount = document.getElementById('notif-table-mount');
      if (mount) {
        if (state.dt && state.dt.destroy) { try { state.dt.destroy(); } catch (e) {} }
        state.dt = DataTable.create(mount, {
          key: 'admin-notifications',
          data: state.history,
          rowId: function (n) { return n.id; },
          columns: buildColumns(),
          actionsCol: buildActionsCol(),
          searchKeys: ['title', 'message'],
          pageSize: 20,
          emptyState: { icon:'fa-bell-slash', title:'No broadcasts sent', message:'Your sent notifications will appear here.' }
        });
      }
    }
  }

  function onPageClick(e) {
    var tab = e.target.closest('[data-notif-tab]');
    if (tab) {
      state.activeTab = tab.dataset.notifTab;
      refresh();
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

    var action = e.target.closest('[data-notif-action]');
    if (action && action.dataset.notifAction === 'view') {
      var id = action.dataset.id;
      var notif = state.history.find(function(n) { return n.id === id; });
      if (notif) {
        UI.openModal(
          '<div class="modal narrow">' +
            '<div class="modal-head"><h3>' + esc(notif.title) + '</h3><button class="modal-close" data-close><i class="fas fa-times"></i></button></div>' +
            '<div class="modal-body">' +
              '<div style="font-size:12px;color:var(--text-3);margin-bottom:8px;">Sent ' + esc(fmtRelative(notif.at)) + '</div>' +
              '<p style="white-space:pre-wrap;font-size:14px;line-height:1.6;">' + esc(notif.message) + '</p>' +
            '</div>' +
            '<div class="modal-foot"><button class="btn btn-outline" data-close>Close</button></div>' +
          '</div>'
        );
      }
    }
  }

  function handleSend() {
    var title = document.getElementById('notifTitle').value.trim();
    var message = document.getElementById('notifMessage').value.trim();
    var type = document.getElementById('notifType').value;
    var target = document.getElementById('notifTarget').value;
    var link = document.getElementById('notifLink').value.trim();
    var sendEmail = document.getElementById('chanEmail').checked;
    var sendSms = document.getElementById('chanSms').checked;

    if (!title || !message) {
      return toast('Missing Fields', 'Title and message are required.', 'error');
    }

    var users = asArray(read(KEYS.users, []));
    var targets = users.filter(function(u) { return u.role !== 'admin'; });

    if (target === 'zero-wallet') {
      targets = targets.filter(function(u) { return !u.wallet || u.wallet === 0; });
    } else if (target === 'active-shippers') {
      var shipments = asArray(read(KEYS.shipments, []));
      var activeIds = {};
      shipments.forEach(function(s) { if (s.status !== 'Delivered' && s.status !== 'Cancelled') activeIds[s.createdBy] = true; });
      targets = targets.filter(function(u) { return activeIds[u.id]; });
    }

    if (targets.length === 0) {
      return toast('No Recipients', 'No users match the target criteria.', 'warning');
    }

    var broadcastId = 'b_' + Math.random().toString(36).slice(2, 10);

    var doSend = function () {
      var allNotifs = asArray(read(KEYS.notifications, []));
      
      var newNotifs = targets.map(function(u) {
        return {
          id: 'n_' + Math.random().toString(36).slice(2, 10),
          userId: u.id,
          title: title,
          message: message,
          type: type,
          link: link || null,
          at: new Date().toISOString(),
          read: false,
          source: 'admin-broadcast',
          broadcastId: broadcastId,
          channels: { push: true, email: sendEmail, sms: sendSms }
        };
      });

      write(KEYS.notifications, allNotifs.concat(newNotifs));
      
      if (global.Admin && global.Admin.logAudit) {
        global.Admin.logAudit('notification.broadcast', target, 'Sent to ' + targets.length + ' users');
      }

      var chanText = 'In-App' + (sendEmail ? ', Email' : '') + (sendSms ? ', SMS' : '');
      toast('Broadcast Sent', targets.length + ' user(s) via ' + chanText, 'success');
      
      // Reset form
      var t = document.getElementById('notifTitle'); if (t) t.value = '';
      var m = document.getElementById('notifMessage'); if (m) m.value = '';
      var l = document.getElementById('notifLink'); if (l) l.value = '';
      var pe = document.getElementById('previewTitle'); if (pe) pe.textContent = 'Notification Title';
      var pm = document.getElementById('previewMsg'); if (pm) pm.textContent = 'Your message will appear here...';
      var cc = document.getElementById('charCount'); if (cc) cc.textContent = '0 / 160 characters';
    };

    if (UI.confirm) {
      UI.confirm({
        title: 'Send Broadcast?',
        message: 'This will send a notification to ' + targets.length + ' user(s).',
        confirmText: 'Send Now',
        variant: 'warning'
      }).then(function(ok) { if (ok) doSend(); });
    } else if (confirm('Send broadcast to ' + targets.length + ' user(s)?')) {
      doSend();
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
  global.PagesAdmin.notifications = {
    title: 'Notifications',
    subtitle: 'Send and manage platform notifications',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);