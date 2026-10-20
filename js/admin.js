/* ================================================================
   GlobalExpress — Admin Console Bootstrap (Supabase Edition)
   ================================================================ */

(function (global) {
  'use strict';

  var Utils    = global.Utils    || {};
  var UI       = global.UI       || {};
  var Auth     = global.Auth     || {};
  var Store    = global.Store    || {};

  var PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin = PagesAdmin;

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var toast = UI.toast || function (title, msg, type) { console.log(title, msg); };

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
    if (!state.user) return 0;
    if (key === 'users') return 0; // We'll fix this when we rewrite the dashboard
    if (key === 'shipments') return 0;
    if (key === 'tickets') return 0;
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

  function go(view, params) {
    var container = el('content');
    var page = PagesAdmin[view];
    
    state.view = view;
    var links = document.querySelectorAll('.sb-link[data-view]');
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle('active', links[i].dataset.view === view);
    }

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
      
      try { history.replaceState(null, null, '#' + view); } catch(e) {}
    } else {
      container.innerHTML = '<div class="panel"><div class="panel-body" style="text-align:center;padding:60px 24px"><h2>Page Not Found</h2><p>The page "' + esc(view) + '" is missing.</p><button class="btn btn-primary" onclick="Admin.go(\'dashboard\')">Back to Dashboard</button></div></div>';
    }
  }

  async function logAudit(action, target, details) {
    if (!window.supabaseClient || !state.user) return;
    try {
      await window.supabaseClient.schema('audit').from('logs').insert({
        actor_id: state.user.id,
        actor_name: state.user.name,
        action: action,
        target: target,
        details: details
      });
    } catch (e) { console.warn('Audit log failed', e); }
  }

  async function boot() {
    document.body.setAttribute('data-theme', 'admin');

    // 1. Verify Supabase Session & Admin Role
    var user = await Auth.resolve();

    if (!user) {
      window.location.replace('portal.html');
      return;
    }

    if (user.role !== 'admin' && user.role !== 'super_admin' && user.role !== 'support' && user.role !== 'finance' && user.role !== 'auditor') {
      window.location.replace('app.html');
      return;
    }

    state.user = user;
    state.booted = true;

    // 2. Preload Data
    await Store.reloadAll();

    // 3. Show UI
    el('app').classList.add('show');
    renderTopbar();
    renderSidebar();

    var hash = window.location.hash.replace('#', '');
    var initialView = hash || 'dashboard';
    go(initialView);
  }

  async function logout() {
    await Auth.logoutAndRedirect('portal.html');
  }

  global.Admin = {
    start: boot, go: go, logout: logout,
    logAudit: logAudit, state: state
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);