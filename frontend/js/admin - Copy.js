/* ================================================================
   GlobalExpress — Admin Console Bootstrap
   ================================================================
   The admin console's equivalent of app.js. Loads LAST, after
   every page module, and drives the router, sidebar, topbar,
   realtime subscriptions, and audit logging.

   Responsibilities:
     1. Enforce role === 'admin' (redirects non-admins)
     2. Seed the demo admin + default settings on first load
     3. Render the admin sidebar
     4. Wire the topbar (name, role, bell, account chip)
     5. Register every page from window.PagesAdmin with the router
     6. Start the router with defaultView='dashboard'
     7. Subscribe to realtime events and re-render the current view
     8. Expose Admin.go, Admin.logAudit, Admin.getSettings

   Depends on (loaded before this file):
     window.Utils, window.UI, window.Auth, window.Store,
     window.Realtime, window.Router
   Exposes:
     window.Admin, window.PagesAdmin
   ================================================================ */

(function (global) {
  'use strict';

  /* ================================================================
     §1 — DEPENDENCIES
     ================================================================ */
  var Utils    = global.Utils    || {};
  var UI       = global.UI       || {};
  var Auth     = global.Auth     || {};
  var Store    = global.Store    || {};
  var Realtime = global.Realtime || {};
  var Router   = global.Router   || {};

  var PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin = PagesAdmin;

  /* ================================================================
     §2 — FALLBACKS
     ================================================================ */

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var uid = Utils.uid || function (prefix) {
    return (prefix || 'id') + '_' +
      Math.random().toString(36).slice(2, 10) +
      Date.now().toString(36).slice(-4);
  };

  var toast = UI.toast || function (title, msg, type) {
    if (global.console && console.log) {
      console.log('[' + (type || 'info') + ']', title, msg || '');
    }
  };

  /* ================================================================
     §3 — CONSTANTS
     ================================================================ */

  var PORTAL_URL = 'portal.html';
  var APP_URL    = 'app.html';

  var KEYS = {
    users:         'ge_users',
    session:       'ge_session',
    shipments:     'ge_shipments',
    payments:      'ge_payments',
    walletTxns:    'ge_wallet_txns',
    notifications: 'ge_notifications',
    tickets:       'ge_tickets',
    audit:         'ge_audit',
    settings:      'ge_settings'
  };

  var DEFAULT_SETTINGS = {
    shippingFee:      4000,
    currencyLabel:    'Fr.',
    minDeposit:       500,
    maxDeposit:       500000,
    minWithdrawal:    500,
    supportEmail:     'support@globalexpress.test',
    supportPhone:     '+237 6XX XXX XXX',
    enableReferrals:  true,
    enable2FA:        false,
    enableCrypto:     true
  };

  var DEMO_ADMIN = {
    id:           'u_admin_demo',
    name:         'Admin User',
    email:        'admin@globalexpress.test',
    password:     'admin123',
    role:         'admin',
    wallet:       0,
    joined:       new Date().toISOString().slice(0, 10),
    phone:        '',
    country:      'Cameroon',
    company:      'GlobalExpress',
    referralCode: 'ADMIN001'
  };

  /* ================================================================
     §4 — SAFE STORAGE
     ================================================================ */

  var ls = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
    del: function (key) {
      try { localStorage.removeItem(key); return true; }
      catch (e) { return false; }
    }
  };

  /* ================================================================
     §5 — MODULE STATE
     ================================================================ */

  var state = {
    user:     null,
    view:     'dashboard',
    params:   {},
    settings: null,
    booted:   false
  };

  function el(id) { return document.getElementById(id); }

  /* ================================================================
     §6 — SIDEBAR NAVIGATION
     ================================================================ */

  var NAV = [
    { section: 'Overview' },
    { view: 'dashboard', icon: 'fa-gauge-high', label: 'Dashboard' },

    { section: 'Management' },
    { view: 'users',     icon: 'fa-users',       label: 'Users',         badge: 'users' },
    { view: 'shipments', icon: 'fa-box',         label: 'Shipments',     badge: 'shipments' },
    { view: 'payments',  icon: 'fa-credit-card', label: 'Payments' },
    { view: 'wallet',    icon: 'fa-wallet',      label: 'Wallet Ledger' },
    { view: 'tickets',   icon: 'fa-headset',     label: 'Support',       badge: 'tickets' },

    { section: 'System' },
    { view: 'notifications', icon: 'fa-bullhorn',       label: 'Notifications' },
    { view: 'audit',         icon: 'fa-clipboard-list', label: 'Audit Log' },
    { view: 'settings',      icon: 'fa-sliders',        label: 'Settings' },
    { view: 'health',        icon: 'fa-heart-pulse',    label: 'System Health' },
    { view: 'backup',        icon: 'fa-database',       label: 'Backup' }
  ];

  /* ================================================================
     §7 — BADGE COUNTS
     ================================================================ */

  function countBadge(key) {
    try {
      if (key === 'users') {
        var users = ls.get(KEYS.users, []);
        if (!Array.isArray(users)) return 0;
        return users.filter(function (u) { return u && u.role !== 'admin'; }).length;
      }
      if (key === 'shipments') {
        var ships = ls.get(KEYS.shipments, []);
        if (!Array.isArray(ships)) return 0;
        return ships.filter(function (s) {
          return s && ['Pending','In Transit','On Hold'].indexOf(s.status) !== -1;
        }).length;
      }
      if (key === 'tickets') {
        var t = ls.get(KEYS.tickets, []);
        if (!Array.isArray(t)) return 0;
        return t.filter(function (x) {
          return x && x.status !== 'Closed' && x.status !== 'Resolved';
        }).length;
      }
    } catch (e) { /* ignore */ }
    return 0;
  }

  /* ================================================================
     §8 — SIDEBAR RENDER
     ================================================================ */

  function renderSidebar() {
    var nav = el('sbNav');
    if (!nav) return;

    var html = '';
    for (var i = 0; i < NAV.length; i++) {
      var item = NAV[i];
      if (item.section) {
        html += '<div class="sb-section">' + esc(item.section) + '</div>';
        continue;
      }
      var badgeCount = item.badge ? countBadge(item.badge) : 0;
      var badgeHtml = badgeCount > 0 ? '<span class="badge">' + badgeCount + '</span>' : '';
      var active = (state.view === item.view) ? ' active' : '';

      html += '<button type="button" class="sb-link' + active + '"'
            +   ' data-view="' + esc(item.view) + '">'
            +   '<i class="fas ' + esc(item.icon) + '"></i>'
            +   '<span>' + esc(item.label) + '</span>'
            +   badgeHtml
            + '</button>';
    }

    html += '<button type="button" class="sb-link" data-action="logout" '
          +   'style="color:#fecaca;margin-top:12px">'
          +   '<i class="fas fa-right-from-bracket"></i>'
          +   '<span>Sign Out</span>'
          + '</button>';

    nav.innerHTML = html;

    if (!nav.__wired) {
      nav.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.sb-link') : null;
        if (!btn) return;
        var view   = btn.dataset.view;
        var action = btn.dataset.action;
        if (action === 'logout') { closeSidebar(); logout(); return; }
        if (view) { closeSidebar(); go(view); }
      });
      nav.__wired = true;
    }
  }

  function refreshSidebar() {
    if (!state.booted) return;
    renderSidebar();
  }

  /* ================================================================
     §9 — TOPBAR
     ================================================================ */

  function renderTopbar() {
    var user = state.user;
    if (!user) return;

    var nameEl = el('userName');
    if (nameEl) nameEl.textContent = user.name || 'Admin';

    var avatarEl = el('userAvatar');
    if (avatarEl) avatarEl.textContent = (user.name || 'A').charAt(0).toUpperCase();

    var roleEl = el('userRole');
    if (roleEl) roleEl.textContent = 'Admin';

    var menuBtn = el('menuBtn');
    if (menuBtn && !menuBtn.__wired) {
      menuBtn.addEventListener('click', function () {
        var sb = el('sidebar');
        if (!sb) return;
        if (sb.classList.contains('open')) closeSidebar();
        else openSidebar();
      });
      menuBtn.__wired = true;
    }

    var closeBtn = el('sidebarClose');
    if (closeBtn && !closeBtn.__wired) {
      closeBtn.addEventListener('click', closeSidebar);
      closeBtn.__wired = true;
    }

    var userChip = el('userChip');
    if (userChip && !userChip.__wired) {
      userChip.addEventListener('click', showAccountMenu);
      userChip.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showAccountMenu(); }
      });
      userChip.__wired = true;
    }

    var notifBtn = el('notifBtn');
    if (notifBtn && !notifBtn.__wired) {
      notifBtn.addEventListener('click', function () { go('tickets'); });
      notifBtn.__wired = true;
    }

    updateNotifDot();
  }

  function updateNotifDot() {
    var dot = el('notifDot');
    if (!dot) return;
    var n = countBadge('tickets');
    dot.classList.toggle('hidden', n === 0);
  }

  /* ================================================================
     §10 — ACCOUNT MENU
     ================================================================ */

  function showAccountMenu() {
    var user = state.user;
    if (!user) return;

    if (!UI.openModal) {
      if (global.confirm && global.confirm('Sign out?')) logout();
      return;
    }

    UI.openModal(''
      + '<div class="modal narrow">'
      +   '<div class="modal-body" style="text-align:center;padding:28px 24px 20px">'
      +     '<div style="width:72px;height:72px;border-radius:50%;margin:0 auto 14px;'
      +       'background:linear-gradient(135deg,#0b2545,#13315c);color:#fff;'
      +       'display:flex;align-items:center;justify-content:center;'
      +       'font-family:Manrope,sans-serif;font-weight:800;font-size:28px">'
      +       esc((user.name || 'A').charAt(0).toUpperCase())
      +     '</div>'
      +     '<h3 style="margin:0 0 4px">' + esc(user.name || 'Admin') + '</h3>'
      +     '<p style="color:var(--text-2);font-size:13.5px;margin:0 0 10px">'
      +       esc(user.email || '')
      +     '</p>'
      +     '<span class="admin-badge role-admin">Administrator</span>'
      +   '</div>'
      +   '<div class="modal-foot stack">'
      +     '<button type="button" class="btn btn-outline btn-block" data-action="go-settings">'
      +       '<i class="fas fa-sliders"></i> Platform Settings'
      +     '</button>'
      +     '<button type="button" class="btn btn-outline btn-block" data-action="go-audit">'
      +       '<i class="fas fa-clipboard-list"></i> My Activity'
      +     '</button>'
      +     '<button type="button" class="btn btn-danger btn-block" data-action="logout">'
      +       '<i class="fas fa-right-from-bracket"></i> Sign Out'
      +     '</button>'
      +   '</div>'
      + '</div>');

    wireAccountMenuActions();
  }

  function wireAccountMenuActions() {
    var rootEl = el('modalRoot');
    if (!rootEl || rootEl.__adminAccountWired) return;

    rootEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'go-settings') { if (UI.closeAllModals) UI.closeAllModals(); go('settings'); }
      if (action === 'go-audit')    { if (UI.closeAllModals) UI.closeAllModals(); go('audit'); }
      if (action === 'logout')      { if (UI.closeAllModals) UI.closeAllModals(); logout(); }
    });

    rootEl.__adminAccountWired = true;
  }

  /* ================================================================
     §11 — SIDEBAR OPEN / CLOSE (mobile)
     ================================================================ */

  function openSidebar() {
    var sb = el('sidebar');
    if (!sb) return;
    sb.classList.add('open');

    var backdrop = el('sidebarBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'sidebarBackdrop';
      backdrop.className = 'sidebar-backdrop';
      backdrop.addEventListener('click', closeSidebar);
      document.body.appendChild(backdrop);
    }
    void backdrop.offsetWidth;
    backdrop.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    var sb = el('sidebar');
    if (sb) sb.classList.remove('open');

    var backdrop = el('sidebarBackdrop');
    if (backdrop) {
      backdrop.classList.remove('show');
      setTimeout(function () {
        if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      }, 220);
    }
    document.body.style.overflow = '';
  }

  function wireSidebarEsc() {
    if (document.__adminSidebarEscWired) return;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSidebar();
    });
    document.__adminSidebarEscWired = true;
  }

  /* ================================================================
     §12 — ROUTER
     ================================================================ */

  function startRouter() {
    if (!Router || typeof Router.register !== 'function') {
      console.error('[admin] Router module not available — check script order');
      return;
    }

    var names = Object.keys(PagesAdmin);
    var registered = 0;

    if (global.console && console.group) console.group('[admin] Registering admin pages');

    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var page = PagesAdmin[name];
      var hasRender = page && typeof page.render === 'function';

      if (global.console && console.log) {
        console.log('  ' + name +
          '  render:' + hasRender +
          '  bind:' + (page && typeof page.bind === 'function') +
          '  title:' + (page && page.title || '(none)'));
      }

      if (hasRender) {
        try { Router.register(name, page); registered++; }
        catch (err) { console.error('[admin] failed to register "' + name + '":', err); }
      }
    }

    if (global.console && console.groupEnd) console.groupEnd();
    if (global.console && console.log) {
      console.log('[admin] registered ' + registered + ' of ' + names.length + ' pages');
    }

    Router.start({
      container:   'content',
      defaultView: 'dashboard',

      onBeforeRender: function (view) {
        state.view = view;
        closeSidebar();

        var page  = PagesAdmin[view];
        var title = el('pageTitle');
        var sub   = el('pageSub');
        if (title) title.textContent = (page && page.title) || 'Admin';
        if (sub)   sub.textContent   = (page && page.subtitle) || '';

        var links = document.querySelectorAll('.sb-link[data-view]');
        for (var i = 0; i < links.length; i++) {
          links[i].classList.toggle('active', links[i].dataset.view === view);
        }
        document.title = ((page && page.title) || 'Admin') + ' — GlobalExpress Admin';
      },

      onAfterRender: function (view, container) {
        var heading = container.querySelector('h1, h2');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          try { heading.focus({ preventScroll: true }); } catch (e) {}
        }
      },

      onBeforeDestroy: function (view) {
        var page = PagesAdmin[view];
        if (page && typeof page.cleanup === 'function') {
          try { page.cleanup(); } catch (e) {}
        }
      },

      renderNotFound: function () {
        return ''
          + '<div class="panel">'
          +   '<div class="panel-body" style="text-align:center;padding:60px 24px">'
          +     '<div style="width:80px;height:80px;border-radius:50%;'
          +       'background:var(--surface-2);display:inline-flex;'
          +       'align-items:center;justify-content:center;'
          +       'font-size:32px;color:var(--text-3);margin-bottom:16px">'
          +       '<i class="fas fa-compass"></i>'
          +     '</div>'
          +     '<h2 style="font-size:18px;margin:0 0 8px">Admin page not found</h2>'
          +     '<p style="color:var(--text-2);font-size:14px;margin-bottom:20px">'
          +       'This admin page doesn\'t exist or hasn\'t been built yet.'
          +     '</p>'
          +     '<button class="btn btn-primary" onclick="Admin.go(\'dashboard\')">'
          +       '<i class="fas fa-gauge-high"></i> Back to Dashboard'
          +     '</button>'
          +   '</div>'
          + '</div>';
      }
    });
  }

  function go(view, params) {
    closeSidebar();
    state.view = view;
    state.params = params || {};
    if (Router && Router.navigate) Router.navigate(view, { replace: false });
    else location.hash = '#/' + view;
  }

  function rerenderCurrentView() {
    if (Router && Router.refresh) Router.refresh();
    else go(state.view, state.params);
  }

  /* ================================================================
     §13 — AUDIT LOGGING
     ================================================================ */

  function logAudit(action, target, details) {
    if (!action) return null;
    var user = state.user || {};
    var entry = {
      id:       uid('audit'),
      at:       new Date().toISOString(),
      userId:   user.id   || 'unknown',
      userName: user.name || 'Unknown Admin',
      action:   String(action),
      target:   String(target || '—'),
      details:  String(details || '')
    };

    try {
      var all = ls.get(KEYS.audit, []);
      if (!Array.isArray(all)) all = [];
      all.push(entry);
      if (all.length > 5000) all = all.slice(all.length - 5000);
      ls.set(KEYS.audit, all);
    } catch (e) {
      console.error('[admin] logAudit failed', e);
    }

    if (Realtime && typeof Realtime.notifyLocalChange === 'function') {
      try { Realtime.notifyLocalChange('audit:created', entry); } catch (e) {}
    }
    return entry;
  }

  /* ================================================================
     §14 — SETTINGS
     ================================================================ */

  function getSettings() {
    if (state.settings) return state.settings;
    var stored = ls.get(KEYS.settings, null);
    if (!stored || typeof stored !== 'object') stored = {};

    var merged = {};
    for (var k in DEFAULT_SETTINGS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) {
        merged[k] = Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : DEFAULT_SETTINGS[k];
      }
    }
    state.settings = merged;
    return merged;
  }

  function saveSettings(patch) {
    var current = getSettings();
    var next = {};
    for (var k in current) {
      if (Object.prototype.hasOwnProperty.call(current, k)) next[k] = current[k];
    }
    if (patch && typeof patch === 'object') {
      for (var p in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, p)) next[p] = patch[p];
      }
    }
    ls.set(KEYS.settings, next);
    state.settings = next;

    if (Realtime && typeof Realtime.notifyLocalChange === 'function') {
      try { Realtime.notifyLocalChange('settings:changed', next); } catch (e) {}
    }
    return next;
  }

  /* ================================================================
     §15 — SEED
     ================================================================ */

  function seed() {
    // Demo admin
    try {
      var users = ls.get(KEYS.users, []);
      if (!Array.isArray(users)) users = [];

      var hasAdmin = false;
      for (var i = 0; i < users.length; i++) {
        if (users[i] && users[i].email === DEMO_ADMIN.email) { hasAdmin = true; break; }
      }

      if (!hasAdmin) {
        var newAdmin = {};
        for (var k in DEMO_ADMIN) {
          if (Object.prototype.hasOwnProperty.call(DEMO_ADMIN, k)) newAdmin[k] = DEMO_ADMIN[k];
        }
        newAdmin.joined = new Date().toISOString().slice(0, 10);
        users.push(newAdmin);
        ls.set(KEYS.users, users);
        if (global.console) console.log('[admin] seeded demo admin:', DEMO_ADMIN.email);
      }
    } catch (e) { console.error('[admin] seed admin failed', e); }

    // Default settings
    try {
      var existing = ls.get(KEYS.settings, null);
      if (!existing || typeof existing !== 'object') {
        ls.set(KEYS.settings, Object.assign({}, DEFAULT_SETTINGS));
        state.settings = Object.assign({}, DEFAULT_SETTINGS);
        if (global.console) console.log('[admin] seeded default settings');
      }
    } catch (e) { console.error('[admin] seed settings failed', e); }
  }

  /* ================================================================
     §16 — REALTIME
     ================================================================ */

  function wireRealtime() {
    if (!Realtime || typeof Realtime.on !== 'function') return;

    Realtime.on('shipment:created', onDomainChange);
    Realtime.on('shipment:updated', onDomainChange);
    Realtime.on('shipment:deleted', onDomainChange);
    Realtime.on('payment:created',  onDomainChange);
    Realtime.on('payment:refunded', onDomainChange);
    Realtime.on('wallet:changed',   onDomainChange);
    Realtime.on('user:changed',     onUserChange);
    Realtime.on('user:created',     onDomainChange);
    Realtime.on('user:deleted',     onDomainChange);
    Realtime.on('ticket:created',   onDomainChange);
    Realtime.on('ticket:updated',   onDomainChange);

    Realtime.on('audit:created', function () {
      if (state.view === 'audit') rerenderCurrentView();
    });

    Realtime.on('settings:changed', function (next) {
      state.settings = next || null;
      if (state.view === 'settings') rerenderCurrentView();
    });

    Realtime.on('session:changed', onSessionChange);
  }

  function onDomainChange() {
    if (!state.booted) return;
    refreshSidebar();
    updateNotifDot();
    var rerenderOn = ['dashboard','users','shipments','payments','wallet','tickets','audit'];
    if (rerenderOn.indexOf(state.view) !== -1) rerenderCurrentView();
  }

  function onUserChange() {
    if (!state.booted) return;
    if (Auth && typeof Auth.refresh === 'function') Auth.refresh();
    var fresh = Auth && Auth.getUser ? Auth.getUser() : null;
    if (!fresh) {
      state.user = null;
      showAuthGate();
      toast('Signed out', 'Your admin session ended.', 'info');
      return;
    }
    if (fresh.role !== 'admin') { window.location.replace(APP_URL); return; }
    state.user = fresh;
    renderTopbar();
    refreshSidebar();
    onDomainChange();
  }

  function onSessionChange() {
    var currentUser = null;
    try { currentUser = Auth && Auth.getUser ? Auth.getUser() : null; } catch (e) {}

    if (!currentUser && state.user) {
      state.user = null;
      showAuthGate();
      toast('Signed out', 'Your session ended in another tab.', 'info');
    } else if (currentUser && !state.user) {
      if (currentUser.role === 'admin') bootForUser(currentUser);
      else window.location.replace(APP_URL);
    }
  }

  /* ================================================================
     §17 — AUTH GATE
     ================================================================ */

  function showAuthGate() {
    var auth = el('authWrap');
    var app  = el('app');
    if (auth) auth.classList.remove('hidden');
    if (app)  app.classList.remove('show');
    state.booted = false;
  }

  function showApp() {
    var auth = el('authWrap');
    var app  = el('app');
    if (auth) auth.classList.add('hidden');
    if (app)  app.classList.add('show');
    state.booted = true;
  }

  /* ================================================================
     §18 — BOOT
     ================================================================ */

  function boot() {
    if (document.body) document.body.setAttribute('data-theme', 'admin');
    seed();

    var user = null;
    if (Auth && typeof Auth.requireLogin === 'function') {
      user = Auth.requireLogin({ role: 'admin' });
      if (!user) return;
    } else {
      user = readUserFromStorage();
      if (!user) { window.location.replace(PORTAL_URL); return; }
      if (user.role !== 'admin') { window.location.replace(APP_URL); return; }
    }

    bootForUser(user);
  }

  function readUserFromStorage() {
    var session = ls.get(KEYS.session, null);
    if (!session || !session.userId) return null;
    var users = ls.get(KEYS.users, []);
    if (!Array.isArray(users)) return null;
    for (var i = 0; i < users.length; i++) {
      if (users[i] && users[i].id === session.userId) return users[i];
    }
    return null;
  }

  function bootForUser(user) {
    if (!user || !user.id) { showAuthGate(); return; }
    state.user = user;
    getSettings();

    if (Store && typeof Store.reloadAll === 'function') {
      try { Store.reloadAll(); } catch (e) {}
    }

    showApp();
    wireAccountMenuActions();
    wireSidebarEsc();
    renderTopbar();
    renderSidebar();
    startRouter();
    wireRealtime();
  }

  /* ================================================================
     §19 — LOGOUT
     ================================================================ */

  function logout() {
    if (Auth && typeof Auth.logoutAndRedirect === 'function') {
      Auth.logoutAndRedirect(PORTAL_URL);
      return;
    }
    try { ls.del(KEYS.session); } catch (e) {}
    try { if (Store && Store.set) Store.set('session', null); } catch (e) {}
    state.user = null;
    closeSidebar();
    window.location.replace(PORTAL_URL);
  }

  /* ================================================================
     §20 — PUBLIC API
     ================================================================ */

  var Admin = {
    start:  boot,
    go:     go,
    logout: logout,
    refreshSidebar: refreshSidebar,
    openSidebar:    openSidebar,
    closeSidebar:   closeSidebar,
    logAudit:       logAudit,
    getSettings:    getSettings,
    saveSettings:   saveSettings,

    register: function (name, page) {
      if (!name || !page) return;
      PagesAdmin[name] = page;
      global.PagesAdmin = PagesAdmin;
      if (Router && typeof Router.register === 'function' && state.booted) {
        try { Router.register(name, page); } catch (e) {}
      }
    },

    state:  state,
    pages:  PagesAdmin,
    KEYS:   KEYS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,

    _seed: seed,
    _getSettings: getSettings,
    _saveSettings: saveSettings,
    _countBadge: countBadge
  };

  global.Admin = Admin;
  global.PagesAdmin = PagesAdmin;

  /* ================================================================
     §21 — AUTO-BOOT
     ================================================================ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);