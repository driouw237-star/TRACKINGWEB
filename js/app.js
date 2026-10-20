/* GlobalExpress - app.js
   Customer application bootstrap.

   Responsibilities:
     - Resolve session → real user record
     - Populate Store from localStorage (reloadAll)
     - Render sidebar with live badge counts
     - Mount topbar (wallet chip, notification dot, user avatar)
     - Wire topbar buttons (deposit, notifications, account)
     - Register every page with the router
     - Subscribe to realtime events
     - Handle public ?track=CODE entry
     - Cross-tab session sync
     - Manage mobile sidebar open/close with backdrop

   Must be loaded LAST, after every page module.
*/
(function (global) {
  'use strict';

  var Utils    = global.Utils    || {};
  var UI       = global.UI       || {};
  var V        = global.V        || {};
  var Auth     = global.Auth     || {};
  var Store    = global.Store    || {};
  var Realtime = global.Realtime || {};
  var Router   = global.Router   || {};

  var Pages = global.Pages || {};

  // --- Fallbacks -----------------------------------------------------------

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var money = Utils.money || function (n) {
    return 'Fr. ' + Number(n || 0).toLocaleString();
  };

  var toast = UI.toast || function (title, msg, type) {
    console.log('[' + (type || 'info') + ']', title, msg || '');
  };

  // --- State ---------------------------------------------------------------

  var state = {
    user: null,
    view: 'dashboard',
    params: {},
    booted: false
  };

  function el(id) { return document.getElementById(id); }

  // -------------------------------------------------------------------------
  // SIDEBAR OPEN / CLOSE with backdrop
  // -------------------------------------------------------------------------

  function isMobileSidebar() {
    return window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
  }

  function openSidebar() {
    var sb = el('sidebar');
    if (!sb) return;
    sb.classList.add('open');

    // Create backdrop if not already present
    var backdrop = el('sidebarBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'sidebarBackdrop';
      backdrop.className = 'sidebar-backdrop';
      backdrop.addEventListener('click', closeSidebar);
      document.body.appendChild(backdrop);
    }
    // Force reflow so the transition kicks in
    void backdrop.offsetWidth;
    backdrop.classList.add('show');

    // Prevent body scroll while sidebar is open
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    var sb = el('sidebar');
    if (sb) sb.classList.remove('open');

    var backdrop = el('sidebarBackdrop');
    if (backdrop) {
      backdrop.classList.remove('show');
      // Remove node after the transition ends
      setTimeout(function () {
        if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      }, 220);
    }

    // Restore body scroll
    document.body.style.overflow = '';
  }

  // Wire ESC key to close the sidebar (once)
  function wireSidebarEsc() {
    if (document.__sidebarEscWired) return;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSidebar();
    });
    document.__sidebarEscWired = true;
  }

  // -------------------------------------------------------------------------
  // USER RESOLUTION
  // -------------------------------------------------------------------------

  function resolveUser() {
    // 1) Preferred: Auth module has already resolved a full user
    if (Auth && typeof Auth.getUser === 'function') {
      var u = Auth.getUser();
      if (u && u.id && u.email) return u;
    }

    // 2) Fallback: read session, look up in ge_users
    var session = null;
    try {
      session = JSON.parse(localStorage.getItem('ge_session') || 'null');
    } catch (e) { session = null; }
    if (!session) return null;

    // 2a) Session might already be a full user (legacy)
    if (session.id && session.email) return session;

    // 2b) Session is { userId, at } — look up the user
    if (session.userId) {
      var users = [];
      try {
        users = JSON.parse(localStorage.getItem('ge_users') || '[]');
      } catch (e) { users = []; }
      for (var i = 0; i < users.length; i++) {
        if (users[i].id === session.userId) return users[i];
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // SIDEBAR NAV CONFIG
  // -------------------------------------------------------------------------

  var NAV = [
    { section: 'Main' },
    { view: 'dashboard',  icon: 'fa-gauge-high',            label: 'Dashboard' },
    { view: 'wallet',     icon: 'fa-wallet',                label: 'My Wallet' },
    { view: 'deposit',    icon: 'fa-circle-plus',           label: 'Deposit' },
    { view: 'withdraw',   icon: 'fa-arrow-up-from-bracket', label: 'Withdraw' },
    { view: 'create',     icon: 'fa-truck-fast',            label: 'Create Shipment' },
    { view: 'shipments',  icon: 'fa-box',                   label: 'My Shipments', badge: 'shipments' },

    { section: 'Tools' },
    { view: 'tracking',        icon: 'fa-location-crosshairs', label: 'Track a Package' },
    { view: 'payment-history', icon: 'fa-receipt',             label: 'Payment History' },
    { view: 'invoices',        icon: 'fa-file-invoice',        label: 'Invoices' },
    { view: 'addresses',       icon: 'fa-address-book',        label: 'Address Book' },
    { view: 'referral',        icon: 'fa-gift',                label: 'Referrals' },

    { section: 'Account' },
    { view: 'notifications', icon: 'fa-bell',           label: 'Notifications', badge: 'notifications' },
    { view: 'support',       icon: 'fa-headset',        label: 'Support' },
    { view: 'profile',       icon: 'fa-user',           label: 'My Profile' },
    { view: 'security',      icon: 'fa-shield-halved',  label: 'Security' }
  ];

  // Routes registered with the router but hidden from the sidebar.
  var HIDDEN_ROUTES = ['shipment'];

  function countBadge(key) {
    if (!state.user || !state.user.id) return 0;
    try {
      if (key === 'shipments') {
        var ships = (Store.get && Store.get('shipments')) || [];
        return ships.length;
      }
      if (key === 'notifications') {
        var notifs = (Store.get && Store.get('notifications')) || [];
        return notifs.filter(function (n) { return !n.read; }).length;
      }
    } catch (e) {}
    return 0;
  }

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
      if (HIDDEN_ROUTES.indexOf(item.view) !== -1) continue;

      var badgeCount = item.badge ? countBadge(item.badge) : 0;
      var badgeHtml = badgeCount > 0 ? '<span class="badge">' + badgeCount + '</span>' : '';
      var active = (state.view === item.view) ? ' active' : '';

      html += '<button type="button" class="sb-link' + active + '" data-view="' + esc(item.view) + '">'
            +   '<i class="fas ' + esc(item.icon) + '"></i> '
            +   '<span>' + esc(item.label) + '</span>'
            +   badgeHtml
            + '</button>';
    }

    html += '<button type="button" class="sb-link" data-action="logout" style="color:#fecaca">'
          +   '<i class="fas fa-right-from-bracket"></i> <span>Sign Out</span>'
          + '</button>';

    nav.innerHTML = html;

    if (!nav.__wired) {
      nav.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.sb-link') : null;
        if (!btn) return;
        var view = btn.dataset.view;
        var action = btn.dataset.action;
        if (action === 'logout') {
          closeSidebar();
          App.logout();
          return;
        }
        if (view) {
          closeSidebar();
          App.go(view);
        }
      });
      nav.__wired = true;
    }
  }

  function refreshSidebar() {
    if (!state.booted) return;
    renderSidebar();
  }

  // -------------------------------------------------------------------------
  // TOPBAR
  // -------------------------------------------------------------------------

  function renderTopbar() {
    var user = state.user;
    if (!user) return;

    // Wallet chip balance
    var bal = el('topWalletBal');
    if (bal) bal.textContent = money(user.wallet || 0);

    // Wallet chip click → wallet page
    var walletChip = el('walletChip');
    if (walletChip && !walletChip.__wired) {
      walletChip.addEventListener('click', function () { App.go('wallet'); });
      walletChip.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); App.go('wallet'); }
      });
      walletChip.__wired = true;
    }

    // Deposit button → deposit page
    var depBtn = el('depositBtn');
    if (depBtn && !depBtn.__wired) {
      depBtn.addEventListener('click', function () { App.go('deposit'); });
      depBtn.__wired = true;
    }

    // Notification bell → notifications page
    var notifBtn = el('notifBtn');
    if (notifBtn && !notifBtn.__wired) {
      notifBtn.addEventListener('click', function () { App.go('notifications'); });
      notifBtn.__wired = true;
    }

    // User chip → account modal
    var userChip = el('userChip');
    if (userChip && !userChip.__wired) {
      userChip.addEventListener('click', function () { showAccountMenu(); });
      userChip.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showAccountMenu(); }
      });
      userChip.__wired = true;
    }

    // Menu button (mobile) — toggles sidebar with backdrop
    var menuBtn = el('menuBtn');
    if (menuBtn && !menuBtn.__wired) {
      menuBtn.addEventListener('click', function () {
        var sb = el('sidebar');
        if (!sb) return;
        var isOpen = sb.classList.contains('open');
        if (isOpen) closeSidebar();
        else openSidebar();
      });
      menuBtn.__wired = true;
    }

    // Sidebar close button (mobile)
    var closeBtn = el('sidebarClose');
    if (closeBtn && !closeBtn.__wired) {
      closeBtn.addEventListener('click', closeSidebar);
      closeBtn.__wired = true;
    }

    // User name + avatar
    var name = el('userName');
    if (name) name.textContent = user.name || 'User';

    var avatar = el('userAvatar');
    if (avatar) avatar.textContent = (user.name || 'U').charAt(0).toUpperCase();

    updateNotifDot();
  }

  function updateNotifDot() {
    var dot = el('notifDot');
    if (!dot) return;
    var n = countBadge('notifications');
    // Single source of truth — the .hidden class. CSS handles display.
    dot.classList.toggle('hidden', n === 0);
  }

  // --- Account menu --------------------------------------------------------

  function showAccountMenu() {
    var user = state.user;
    if (!user) return;

    if (UI.openModal) {
      UI.openModal(''
        + '<div class="modal narrow">'
        +   '<div class="modal-body" style="text-align:center;padding:28px 24px 20px">'
        +     '<div class="user-avatar" style="width:72px;height:72px;font-size:28px;margin:0 auto 14px">'
        +       esc((user.name || 'U').charAt(0).toUpperCase())
        +     '</div>'
        +     '<h3 style="margin:0 0 4px">' + esc(user.name || 'User') + '</h3>'
        +     '<p style="color:var(--text-2);font-size:13.5px">' + esc(user.email || '') + '</p>'
        +     '<span class="pill Pending" style="margin-top:10px">Customer</span>'
        +     '<div style="margin-top:16px;padding:14px;background:#ecfdf5;border:1.5px solid #a7f3d0;border-radius:11px">'
        +       '<div style="font-size:11px;color:#047857;text-transform:uppercase;letter-spacing:.5px;font-weight:700">Wallet Balance</div>'
        +       '<div style="font-family:Manrope,sans-serif;font-weight:800;font-size:20px;color:#065f46;margin-top:2px">'
        +         money(user.wallet || 0)
        +       '</div>'
        +     '</div>'
        +   '</div>'
        +   '<div class="modal-foot" style="flex-direction:column;gap:8px">'
        +     '<button type="button" class="btn btn-outline btn-block" data-action="go-profile"><i class="fas fa-user"></i> My Profile</button>'
        +     '<button type="button" class="btn btn-outline btn-block" data-action="go-security"><i class="fas fa-shield-halved"></i> Security</button>'
        +     '<button type="button" class="btn btn-danger btn-block" data-action="logout"><i class="fas fa-right-from-bracket"></i> Sign Out</button>'
        +   '</div>'
        + '</div>');
    } else {
      if (global.confirm && global.confirm('Sign out?')) App.logout();
    }
  }

  function wireAccountMenu() {
    var rootEl = el('modalRoot');
    if (!rootEl || rootEl.__accountWired) return;
    rootEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'go-profile')  { if (UI.closeAllModals) UI.closeAllModals(); App.go('profile'); }
      if (action === 'go-security') { if (UI.closeAllModals) UI.closeAllModals(); App.go('security'); }
      if (action === 'logout')      { if (UI.closeAllModals) UI.closeAllModals(); App.logout(); }
    });
    rootEl.__accountWired = true;
  }

  // -------------------------------------------------------------------------
  // SHOW / HIDE
  // -------------------------------------------------------------------------

  function showAuth() {
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

  function login(user) {
    if (!user || !user.id) {
      showAuth();
      return;
    }
    state.user = user;

    // Populate the Store from localStorage for the current user.
    if (Store && Store.reloadAll) {
      try { Store.reloadAll(); } catch (e) { console.error('[app] Store.reloadAll failed', e); }
    }

    // Re-read the resolved user from the store (in case it changed).
    var fresh = (Store && Store.get) ? Store.get('user') : null;
    if (fresh) state.user = fresh;

    showApp();
    wireAccountMenu();
    wireSidebarEsc();
    renderTopbar();
    renderSidebar();
    startRouter();
    wireRealtime();
    // Do NOT call go() here — Router.start() already rendered the
    // initial route via its own render() pass.
  }

  function logout() {
    if (Auth && typeof Auth.logoutAndRedirect === 'function') {
      Auth.logoutAndRedirect('portal.html');
      return;
    }
    try { if (Store && Store.set) Store.set('session', null); } catch (e) {}
    try { localStorage.removeItem('ge_session'); } catch (e) {}
    state.user = null;
    closeSidebar();
    showAuth();
  }

  // -------------------------------------------------------------------------
  // ROUTER
  // -------------------------------------------------------------------------

  function startRouter() {
    if (!Router) { console.error('[app] Router module not loaded'); return; }
    if (typeof Router.register !== 'function') {
      console.error('[app] Router.register is not a function — check router.js');
      return;
    }

    var names = Object.keys(Pages || {});
    var registered = 0;

    console.group('[app] Registering pages');
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var page = Pages[name];
      var hasRender = page && typeof page.render === 'function';
      var hasBind   = page && typeof page.bind === 'function';
      console.log('  ' + name + '  render:' + hasRender + '  bind:' + hasBind + '  title:' + (page && page.title || '(none)'));
      if (hasRender) {
        try { Router.register(name, page); registered++; }
        catch (err) { console.error('[app] failed to register "' + name + '":', err); }
      }
    }
    console.groupEnd();
    console.log('[app] registered ' + registered + ' of ' + names.length + ' pages');

    Router.start({
      container: 'content',
      defaultView: 'dashboard',

      onBeforeRender: function (view) {
        state.view = view;
        // Close the mobile sidebar on any route change
        closeSidebar();

        var page  = Pages[view];
        var title = el('pageTitle');
        var sub   = el('pageSub');
        if (title) title.textContent = (page && page.title) || 'Page';
        if (sub)   sub.textContent   = (page && page.subtitle) || '';
        var links = document.querySelectorAll('.sb-link[data-view]');
        for (var i = 0; i < links.length; i++) {
          links[i].classList.toggle('active', links[i].dataset.view === view);
        }
        document.title = ((page && page.title) || 'GlobalExpress') + ' — GlobalExpress';
      },

      onAfterRender: function (view, container) {
        // Focus management only. The router already called page.bind(ctx)
        // — calling it again here would double-bind every page.
        var heading = container.querySelector('h1, h2');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          try { heading.focus({ preventScroll: true }); } catch (e) {}
        }
      },

      onBeforeDestroy: function (view) {
        var page = Pages[view];
        if (page && typeof page.cleanup === 'function') {
          try { page.cleanup(); } catch (e) {}
        }
      },

      renderNotFound: function () {
        return ''
          + '<div class="panel">'
          +   '<div class="panel-body" style="text-align:center;padding:60px 24px">'
          +     '<div style="width:80px;height:80px;border-radius:50%;background:var(--surface-2);display:inline-flex;align-items:center;justify-content:center;font-size:32px;color:var(--text-3);margin-bottom:16px">'
          +       '<i class="fas fa-compass"></i>'
          +     '</div>'
          +     '<h2 style="font-size:18px;margin:0 0 8px">Page not found</h2>'
          +     '<p style="color:var(--text-2);font-size:14px;margin-bottom:20px">The page you were looking for doesn\'t exist or hasn\'t been built yet.</p>'
          +     '<button class="btn btn-primary" onclick="App.go(\'dashboard\')"><i class="fas fa-gauge-high"></i> Back to Dashboard</button>'
          +   '</div>'
          + '</div>';
      }
    });
  }

  function go(view, params) {
    // Always close the mobile sidebar on navigation
    closeSidebar();

    state.view = view;
    state.params = params || {};
    if (Router && Router.navigate) {
      Router.navigate(view, { replace: false });
    } else {
      location.hash = '#/' + view;
    }
  }

  // -------------------------------------------------------------------------
  // REALTIME
  // -------------------------------------------------------------------------

  function wireRealtime() {
    if (!Realtime || !Realtime.on) return;

    Realtime.on('shipment:created', onShipmentChange);
    Realtime.on('shipment:updated', onShipmentChange);
    Realtime.on('shipment:deleted', onShipmentChange);

    Realtime.on('wallet:changed', function () {
      if (state.user) {
        if (Store.reloadUser) {
          var u = Store.reloadUser();
          if (u) state.user = u;
        }
        renderTopbar();
      }
      if (state.view === 'wallet' || state.view === 'dashboard') {
        rerenderCurrentView();
      }
    });

    Realtime.on('notification:new', function () {
      updateNotifDot();
      refreshSidebar();
      if (state.view === 'notifications') rerenderCurrentView();
    });

    Realtime.on('session:changed', function () {
      var currentUser = resolveUser();
      if (!currentUser && state.user) {
        state.user = null;
        showAuth();
        toast('Signed out', 'Your session ended in another tab.', 'info');
      } else if (currentUser && !state.user) {
        login(currentUser);
      }
    });

    Realtime.on('user:changed', function () {
      if (Store.reloadUser) {
        var u = Store.reloadUser();
        if (u) { state.user = u; renderTopbar(); }
      }
    });
  }

  function onShipmentChange() {
    if (Store.reloadShipments) Store.reloadShipments();
    refreshSidebar();
    if (state.view === 'shipments' || state.view === 'dashboard') {
      rerenderCurrentView();
    }
  }

  function rerenderCurrentView() {
    if (Router && Router.refresh) Router.refresh();
    else go(state.view, state.params);
  }

  // -------------------------------------------------------------------------
  // PUBLIC ?track=CODE entry
  // -------------------------------------------------------------------------

  function checkPublicTrack() {
    try {
      var params = new URLSearchParams(location.search);
      var code = params.get('track') || params.get('code');
      if (!code) return false;

      showApp();
      wireAccountMenu();
      wireSidebarEsc();
      renderSidebar();
      renderTopbar();

      var title = el('pageTitle');
      var sub   = el('pageSub');
      if (title) title.textContent = 'Track Package';
      if (sub)   sub.textContent   = 'Tracking: ' + code;

      startRouter();
      wireRealtime();
      go('tracking', { code: code });
      return true;
    } catch (e) {
      console.error('[app] checkPublicTrack error', e);
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // BOOT
  // -------------------------------------------------------------------------

  async function boot() {
    // 1. Public tracking entry — no auth required
    if (checkPublicTrack()) return;

    // 2. Resolve the current user via Supabase
    var user = await Auth.resolve();

    if (!user) {
      var auth = el('authWrap');
      if (auth) auth.classList.remove('hidden');
      return;
    }

    // 3. Signed in — mount the app
    login(user);
  }

  // -------------------------------------------------------------------------
  // EXPOSE
  // -------------------------------------------------------------------------

  var App = {
    start: boot,
    go: go,
    logout: logout,
    refreshSidebar: refreshSidebar,
    openSidebar: openSidebar,
    closeSidebar: closeSidebar,

    register: function (name, page) {
      if (!name || !page) return;
      Pages[name] = page;
      global.Pages = Pages;
      // If the router is already started, register immediately too.
      if (Router && typeof Router.register === 'function') {
        try { Router.register(name, page); } catch (e) {}
      }
    },

    pages: Pages,
    state: state
  };

  global.App = App;
  global.Pages = Pages;

  // Auto-boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);