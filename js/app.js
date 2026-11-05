/* GlobalExpress - app.js
   Customer application bootstrap connected to Supabase.
*/

(function (global) {
  'use strict';

  var Utils    = global.Utils    || {};
  var UI       = global.UI       || {};
  var Auth     = global.Auth     || {};
  var Router   = global.Router   || {};

  var Pages = global.Pages || {};

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'XAF ' + Number(n || 0).toLocaleString(); };
  var toast = UI.toast || function (title, msg, type) { console.log('[' + (type || 'info') + ']', title, msg || ''); };

  var state = {
    user: null,
    view: 'dashboard',
    params: {},
    booted: false,
    badgeCounts: { shipments: 0, notifications: 0 }
  };

  function el(id) { return document.getElementById(id); }

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
    if (document.__sidebarEscWired) return;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSidebar();
    });
    document.__sidebarEscWired = true;
  }

  var NAV = [
    { section: 'Main' },
    { view: 'dashboard',  icon: 'fa-gauge-high',            label: 'Dashboard' },
    { view: 'wallet',     icon: 'fa-wallet',                label: 'My Wallet' },
    { view: 'deposit',    icon: 'fa-circle-plus',           label: 'Deposit' },
    { view: 'create',     icon: 'fa-truck-fast',            label: 'Create Shipment' },
    { view: 'shipments',  icon: 'fa-box',                   label: 'My Shipments', badge: 'shipments' },
    { section: 'Tools' },
    { view: 'tracking',        icon: 'fa-location-crosshairs', label: 'Track a Package' },
    { view: 'payment-history', icon: 'fa-receipt',             label: 'Payment History' },
    { view: 'invoices',        icon: 'fa-file-invoice',        label: 'Invoices' },
    { view: 'addresses',       icon: 'fa-address-book',        label: 'Address Book' },
    { view: 'referrals',       icon: 'fa-gift',                label: 'Referrals' },
    { section: 'Account' },
    { view: 'notifications', icon: 'fa-bell',           label: 'Notifications', badge: 'notifications' },
    { view: 'support',       icon: 'fa-headset',        label: 'Support' },
    { view: 'profile',       icon: 'fa-user',           label: 'My Profile' },
    { view: 'security',      icon: 'fa-shield-halved',  label: 'Security' }
  ];

  var HIDDEN_ROUTES = ['shipment'];

  function renderSidebar() {
    var nav = el('sbNav');
    if (!nav) return;
    var html = '';
    for (var i = 0; i < NAV.length; i++) {
      var item = NAV[i];
      if (item.section) { html += '<div class="sb-section">' + esc(item.section) + '</div>'; continue; }
      if (HIDDEN_ROUTES.indexOf(item.view) !== -1) continue;
      var badgeCount = item.badge ? (state.badgeCounts[item.badge] || 0) : 0;
      var badgeHtml = badgeCount > 0 ? '<span class="badge">' + badgeCount + '</span>' : '';
      var active = (state.view === item.view) ? ' active' : '';
      html += '<button type="button" class="sb-link' + active + '" data-view="' + esc(item.view) + '"><i class="fas ' + esc(item.icon) + '"></i> <span>' + esc(item.label) + '</span>' + badgeHtml + '</button>';
    }
    html += '<button type="button" class="sb-link" data-action="logout" style="color:#fecaca"><i class="fas fa-right-from-bracket"></i> <span>Sign Out</span></button>';
    nav.innerHTML = html;
    if (!nav.__wired) {
      nav.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.sb-link') : null;
        if (!btn) return;
        if (btn.dataset.action === 'logout') { closeSidebar(); App.logout(); return; }
        if (btn.dataset.view) { closeSidebar(); App.go(btn.dataset.view); }
      });
      nav.__wired = true;
    }
  }

  function refreshSidebar() { if (state.booted) renderSidebar(); }

  async function fetchLiveUserData() {
    if (!state.user || !window.supabaseClient) return;
    try {
      const { data: freshUser } = await window.supabaseClient.schema('app').from('users').select('wallet').eq('id', state.user.id).single();
      if (freshUser) state.user.wallet = freshUser.wallet;
      var [shipsRes, notifsRes] = await Promise.all([
        window.supabaseClient.schema('app').from('shipments').select('id', { count: 'exact', head: true }).eq('created_by', state.user.id),
        window.supabaseClient.schema('app').from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', state.user.id).eq('is_read', false)
      ]);
      state.badgeCounts.shipments = shipsRes.count || 0;
      state.badgeCounts.notifications = notifsRes.count || 0;
      renderTopbar(); refreshSidebar(); updateNotifDot();
    } catch (err) { console.warn('Failed to fetch live user data:', err); }
  }

  function renderTopbar() {
    var user = state.user;
    if (!user) return;
    var bal = el('topWalletBal'); if (bal) bal.textContent = money(user.wallet || 0);
    var walletChip = el('walletChip');
    if (walletChip && !walletChip.__wired) { walletChip.addEventListener('click', function () { App.go('wallet'); }); walletChip.__wired = true; }
    var depBtn = el('depositBtn');
    if (depBtn && !depBtn.__wired) { depBtn.addEventListener('click', function () { App.go('deposit'); }); depBtn.__wired = true; }
    var notifBtn = el('notifBtn');
    if (notifBtn && !notifBtn.__wired) { notifBtn.addEventListener('click', function () { App.go('notifications'); }); notifBtn.__wired = true; }
    var userChip = el('userChip');
    if (userChip && !userChip.__wired) { userChip.addEventListener('click', function () { showAccountMenu(); }); userChip.__wired = true; }
    var menuBtn = el('menuBtn');
    if (menuBtn && !menuBtn.__wired) {
      menuBtn.addEventListener('click', function () {
        var sb = el('sidebar');
        if (!sb) return;
        if (sb.classList.contains('open')) closeSidebar(); else openSidebar();
      });
      menuBtn.__wired = true;
    }
    var closeBtn = el('sidebarClose');
    if (closeBtn && !closeBtn.__wired) { closeBtn.addEventListener('click', closeSidebar); closeBtn.__wired = true; }
    var name = el('userName');
    if (name) name.textContent = user.name || 'User';
    var avatar = el('userAvatar');
    if (avatar) avatar.textContent = (user.name || 'U').charAt(0).toUpperCase();
    updateNotifDot();
  }

  function updateNotifDot() {
    var dot = el('notifDot');
    if (!dot) return;
    dot.classList.toggle('hidden', (state.badgeCounts.notifications || 0) === 0);
  }

  function showAccountMenu() {
    var user = state.user;
    if (!user) return;
    if (UI.openModal) {
      UI.openModal(''
        + '<div class="modal narrow"><div class="modal-body" style="text-align:center;padding:28px 24px 20px">'
        +     '<div class="user-avatar" style="width:72px;height:72px;font-size:28px;margin:0 auto 14px">' + esc((user.name || 'U').charAt(0).toUpperCase()) + '</div>'
        +     '<h3 style="margin:0 0 4px">' + esc(user.name || 'User') + '</h3>'
        +     '<p style="color:var(--text-2);font-size:13.5px">' + esc(user.email || '') + '</p>'
        +     '<span class="pill Pending" style="margin-top:10px">Customer</span>'
        +     '<div style="margin-top:16px;padding:14px;background:#ecfdf5;border:1.5px solid #a7f3d0;border-radius:11px"><div style="font-size:11px;color:#047857;text-transform:uppercase;letter-spacing:.5px;font-weight:700">Wallet Balance</div><div style="font-family:Manrope,sans-serif;font-weight:800;font-size:20px;color:#065f46;margin-top:2px">' + money(user.wallet || 0) + '</div></div></div>'
        +   '<div class="modal-foot" style="flex-direction:column;gap:8px">'
        +     '<button type="button" class="btn btn-outline btn-block" data-action="go-profile"><i class="fas fa-user"></i> My Profile</button>'
        +     '<button type="button" class="btn btn-outline btn-block" data-action="go-security"><i class="fas fa-shield-halved"></i> Security</button>'
        +     '<button type="button" class="btn btn-danger btn-block" data-action="logout"><i class="fas fa-right-from-bracket"></i> Sign Out</button>'
        +   '</div></div>');
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

  function showAuth() {
    var auth = el('authWrap'); var app = el('app');
    if (auth) auth.classList.remove('hidden');
    if (app) app.classList.remove('show');
    state.booted = false;
  }

  function showApp() {
    var auth = el('authWrap'); var app = el('app');
    if (auth) auth.classList.add('hidden');
    if (app) app.classList.add('show');
    state.booted = true;
  }

  function login(user) {
    if (!user || !user.id) { showAuth(); return; }
    state.user = user;
    showApp();
    wireAccountMenu();
    wireSidebarEsc();
    fetchLiveUserData();
    startRouter();
  }

  function logout() {
    if (window.supabaseClient) window.supabaseClient.auth.signOut();
    state.user = null;
    closeSidebar();
    window.location.replace('portal.html');
  }

  function startRouter() {
    if (!Router || typeof Router.register !== 'function') return console.error('[app] Router module not loaded');
    var names = Object.keys(Pages || {});
    for (var i = 0; i < names.length; i++) {
      var name = names[i]; var page = Pages[name];
      if (page && typeof page.render === 'function') { try { Router.register(name, page); } catch (err) {} }
    }
    Router.start({
      container: 'content',
      defaultView: 'dashboard',
      onBeforeRender: function (view) {
        state.view = view; closeSidebar();
        var page = Pages[view]; var title = el('pageTitle'); var sub = el('pageSub');
        if (title) title.textContent = (page && page.title) || 'Page';
        if (sub) sub.textContent = (page && page.subtitle) || '';
        var links = document.querySelectorAll('.sb-link[data-view]');
        for (var i = 0; i < links.length; i++) links[i].classList.toggle('active', links[i].dataset.view === view);
        document.title = ((page && page.title) || 'GlobalExpress') + ' — GlobalExpress';
        fetchLiveUserData();
      },
      onAfterRender: function (view, container) {
        var heading = container.querySelector('h1, h2');
        if (heading) { heading.setAttribute('tabindex', '-1'); try { heading.focus({ preventScroll: true }); } catch (e) {} }
      },
      onBeforeDestroy: function (view) {
        var page = Pages[view];
        if (page && typeof page.cleanup === 'function') { try { page.cleanup(); } catch (e) {} }
      },
      renderNotFound: function () {
        return '<div class="panel"><div class="panel-body" style="text-align:center;padding:60px 24px"><h2 style="font-size:18px;margin:0 0 8px">Page not found</h2><button class="btn btn-primary" onclick="App.go(\'dashboard\')">Back to Dashboard</button></div></div>';
      }
    });
  }

  function go(view, params) {
    closeSidebar(); state.view = view; state.params = params || {};
    if (Router && Router.navigate) Router.navigate(view, { replace: false });
    else location.hash = '#/' + view;
  }

  // =========================================================================
  // THE FIX: Boot sequence resolves Auth FIRST, THEN checks ?track=
  // =========================================================================
  async function boot() {
    // 1. Wait for supabase.js to signal the session is fully loaded
    if (window.authReady) {
      try { await window.authReady; } catch (e) {}
    }

    // 2. Resolve the user BEFORE checking for ?track=
    var user = await Auth.resolve();

    // 3. Check for a public tracking code in the URL
    var params = new URLSearchParams(location.search);
    var trackCode = params.get('track') || params.get('code');

    if (user) {
      // --- LOGGED IN ---
      state.user = user;
      showApp();
      wireAccountMenu();
      wireSidebarEsc();
      fetchLiveUserData();
      startRouter();

      // If we have a tracking code, go to the tracking page
      if (trackCode) {
        go('tracking', { code: trackCode });
      }
      return;
    }

    // --- NOT LOGGED IN ---
    if (trackCode) {
      // Anonymous user with a tracking code — show the app shell (empty) + tracking view
      showApp();
      wireAccountMenu();
      wireSidebarEsc();
      renderSidebar();
      renderTopbar();

      var title = el('pageTitle');
      var sub   = el('pageSub');
      if (title) title.textContent = 'Track Package';
      if (sub)   sub.textContent   = 'Tracking: ' + trackCode;

      startRouter();
      go('tracking', { code: trackCode });
      return;
    }

    // No user and no tracking code — show the sign-in prompt
    var auth = el('authWrap');
    if (auth) auth.classList.remove('hidden');
  }

  var App = {
    start: boot, go: go, logout: logout, refreshSidebar: refreshSidebar,
    openSidebar: openSidebar, closeSidebar: closeSidebar, refreshUser: fetchLiveUserData,
    register: function (name, page) {
      if (!name || !page) return;
      Pages[name] = page; global.Pages = Pages;
      if (Router && typeof Router.register === 'function') { try { Router.register(name, page); } catch (e) {} }
    },
    pages: Pages, state: state
  };

  global.App = App;
  global.Pages = Pages;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window);