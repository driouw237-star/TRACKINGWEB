/* ================================================================
   GlobalExpress — Admin Console Bootstrap (Fixed Router)
   ================================================================ */

(function (global) {
  'use strict';

  var Utils    = global.Utils    || {};
  var UI       = global.UI       || {};
  var Auth     = global.Auth     || {};
  var Store    = global.Store    || {};
  var Realtime = global.Realtime || {};

  var PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin = PagesAdmin;

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  
  var toast = UI.toast || function (title, msg, type) {
    if (global.console && console.log) console.log('[' + (type || 'info') + ']', title, msg || '');
  };

  var KEYS = {
    users: 'ge_users', session: 'ge_session', shipments: 'ge_shipments',
    payments: 'ge_payments', walletTxns: 'ge_wallet_txns', notifications: 'ge_notifications',
    tickets: 'ge_tickets', audit: 'ge_audit', settings: 'ge_settings'
  };

  var DEMO_ADMIN = {
    id: 'u_admin_demo', name: 'Admin User', email: 'admin@globalexpress.test',
    password: 'admin123', role: 'admin', wallet: 0,
    joined: new Date().toISOString().slice(0, 10), referralCode: 'ADMIN001'
  };

  var ls = {
    get: function (key, fallback) {
      try { var raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
      catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    }
  };

  var state = { user: null, view: 'dashboard', params: {}, booted: false };

  function el(id) { return document.getElementById(id); }

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

  function countBadge(key) {
    try {
      if (key === 'users') return ls.get(KEYS.users, []).filter(function (u) { return u && u.role !== 'admin'; }).length;
      if (key === 'shipments') return ls.get(KEYS.shipments, []).filter(function (s) { return s && ['Pending','In Transit','On Hold'].indexOf(s.status) !== -1; }).length;
      if (key === 'tickets') return ls.get(KEYS.tickets, []).filter(function (x) { return x && x.status !== 'Closed' && x.status !== 'Resolved'; }).length;
    } catch (e) {}
    return 0;
  }

  function renderSidebar() {
    var nav = el('sbNav');
    if (!nav) return;

    var html = '';
    NAV.forEach(function (item) {
      if (item.section) { html += '<div class="sb-section">' + esc(item.section) + '</div>'; return; }
      var badgeCount = item.badge ? countBadge(item.badge) : 0;
      var badgeHtml = badgeCount > 0 ? '<span class="badge">' + badgeCount + '</span>' : '';
      var active = (state.view === item.view) ? ' active' : '';
      html += '<button type="button" class="sb-link' + active + '" data-view="' + esc(item.view) + '"><i class="fas ' + esc(item.icon) + '"></i><span>' + esc(item.label) + '</span>' + badgeHtml + '</button>';
    });

    html += '<button type="button" class="sb-link" data-action="logout" style="color:#fecaca;margin-top:12px"><i class="fas fa-right-from-bracket"></i><span>Sign Out</span></button>';
    nav.innerHTML = html;

    if (!nav.__wired) {
      nav.addEventListener('click', function (e) {
        var btn = e.target.closest('.sb-link');
        if (!btn) return;
        if (btn.dataset.action === 'logout') { logout(); return; }
        if (btn.dataset.view) { go(btn.dataset.view); }
      });
      nav.__wired = true;
    }
  }

  function renderTopbar() {
    if (!state.user) return;
    if (el('userName')) el('userName').textContent = state.user.name || 'Admin';
    if (el('userAvatar')) el('userAvatar').textContent = (state.user.name || 'A').charAt(0).toUpperCase();
  }

  // THE FIX: The custom routing function that bypasses the URL and directly injects HTML
  function go(view, params) {
    var container = el('content');
    var page = PagesAdmin[view];
    
    // 1. Update sidebar active state
    state.view = view;
    var links = document.querySelectorAll('.sb-link[data-view]');
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle('active', links[i].dataset.view === view);
    }

    // 2. Render the page directly into the DOM (No URL changes, no router crashes!)
    if (container && page && typeof page.render === 'function') {
      if (window.PagesAdmin[state.view] && window.PagesAdmin[state.view].cleanup) {
        try { window.PagesAdmin[state.view].cleanup(); } catch(e){}
      }
      
      container.innerHTML = page.render({ params: params || {} });
      
      if (typeof page.bind === 'function') {
        page.bind({ params: params || {} });
      }
      
      if (el('pageTitle')) el('pageTitle').textContent = page.title || 'Admin';
      if (el('pageSub')) el('pageSub').textContent = page.subtitle || '';
      
      // Update hash secretly so refreshing keeps you on the page
      try { history.replaceState(null, null, '#' + view); } catch(e) {}
    } else {
      container.innerHTML = '<div class="panel"><div class="panel-body" style="text-align:center;padding:60px 24px"><h2>Page Not Found</h2><p>The page "' + esc(view) + '" is missing.</p><button class="btn btn-primary" onclick="Admin.go(\'dashboard\')">Back to Dashboard</button></div></div>';
    }
  }

  function logAudit(action, target, details) {
    var user = state.user || {};
    var entry = {
      id: 'audit_' + Date.now(), at: new Date().toISOString(),
      userId: user.id || 'unknown', userName: user.name || 'Unknown Admin',
      action: String(action), target: String(target || '—'), details: String(details || '')
    };
    var all = ls.get(KEYS.audit, []);
    all.push(entry);
    ls.set(KEYS.audit, all);
  }

  function boot() {
    document.body.setAttribute('data-theme', 'admin');

    // Seed admin
    var users = ls.get(KEYS.users, []);
    var adminUser = users.find(function (u) { return u.role === 'admin'; });
    if (!adminUser) {
      adminUser = Object.assign({}, DEMO_ADMIN);
      users.push(adminUser);
      ls.set(KEYS.users, users);
    }

    state.user = adminUser;
    state.booted = true;

    // Hide Auth, Show App
    var authWrap = el('authWrap');
    if (authWrap) authWrap.classList.add('hidden');
    var appWrap = el('app');
    if (appWrap) appWrap.classList.add('show');

    renderTopbar();
    renderSidebar();

    // Figure out initial page from URL
    var hash = window.location.hash.replace('#', '');
    var initialView = hash || 'dashboard';
    
    // Initialize the router replacement
    go(initialView);
  }

  function logout() {
    ls.set(KEYS.session, null);
    window.location.href = 'portal.html';
  }

  global.Admin = {
    start: boot, go: go, logout: logout,
    logAudit: logAudit, state: state, KEYS: KEYS
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);