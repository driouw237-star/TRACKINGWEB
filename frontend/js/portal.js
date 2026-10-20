/* ================================================================
   GlobalExpress — Customer Portal Bootstrap
   Handles login, signup, password strength, session persistence,
   and role-aware redirect (admins → admin.html, customers → app.html).
   Loaded at the end of portal.html.
   Depends on: nothing external (self-contained)
   Exposes: window.Portal (for console debugging)
   ================================================================ */

(function () {
  'use strict';

  // ================================================================
  // DEPENDENCY BINDINGS
  // Prefer shared modules when they exist; otherwise use local
  // fallbacks. This keeps portal.js working both before AND after
  // the adapter layer is built.
  // ================================================================
  const Data = window.Data || null;
  const UI   = window.UI   || null;

  // ================================================================
  // STORAGE KEYS — must match track.js, auth.js, app.js, admin.js
  // ================================================================
  const KEYS = {
    users:         'ge_users',
    session:       'ge_session',
    notifications: 'ge_notifications'
  };

  // ================================================================
  // ROUTING TARGETS
  // ================================================================
  const PORTAL_URL = 'portal.html';
  const APP_URL    = 'app.html';
  const ADMIN_URL  = 'admin.html';

  // ================================================================
  // STORAGE HELPERS — defensive against localStorage being disabled
  // ================================================================
  const store = {
    get(k, fallback) {
      try {
        const raw = localStorage.getItem(k);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
        return true;
      } catch (e) {
        return false;
      }
    }
  };

  // ================================================================
  // UTILS — same shapes as track.js, so pages feel consistent
  // ================================================================
  function esc(s) {
    if (window.Utils && typeof window.Utils.esc === 'function') {
      return window.Utils.esc(s);
    }
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;'
      })[c];
    });
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' +
      Math.random().toString(36).slice(2, 10) +
      Date.now().toString(36).slice(-4);
  }

  function fmtDate(d) {
    return (d || new Date()).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  function toast(title, msg, type) {
    if (UI && typeof UI.toast === 'function') {
      return UI.toast(title, msg, type);
    }
    const wrap = document.getElementById('toastWrap');
    if (!wrap) return;
    const icons = {
      success: 'fa-circle-check',
      error:   'fa-circle-xmark',
      info:    'fa-circle-info',
      warning: 'fa-triangle-exclamation'
    };
    const t = type || 'success';
    const el = document.createElement('div');
    el.className = 'toast ' + t;
    el.innerHTML =
      '<div class="toast-icon"><i class="fas ' + icons[t] + '"></i></div>' +
      '<div class="toast-body">' +
        '<div class="toast-title">' + esc(title) + '</div>' +
        (msg ? '<div class="toast-msg">' + esc(msg) + '</div>' : '') +
      '</div>';
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add('removing');
      setTimeout(function () { el.remove(); }, 250);
    }, 3400);
  }

  // ================================================================
  // SEED — ensure demo accounts exist so people can test the portal
  // without having to sign up first.
  //
  // Two accounts are seeded:
  //   1. demo@globalexpress.test  / demo123  (role: user)   → app.html
  //   2. admin@globalexpress.test / admin123 (role: admin)  → admin.html
  //
  // The admin account matches DEMO_ADMIN in admin.js. If admin.js
  // runs first (e.g. the user opens admin.html before portal.html),
  // this function detects the existing account and skips it.
  // ================================================================
  function seedDemoAccount() {
    const users = store.get(KEYS.users, []);

    // ---- Demo customer ----
    if (!users.some(function (u) { return u.email === 'demo@globalexpress.test'; })) {
      users.push({
        id: uid('u'),
        name: 'Demo User',
        email: 'demo@globalexpress.test',
        password: 'demo123',
        role: 'user',
        joined: fmtDate(),
        phone: '',
        country: '',
        company: '',
        wallet: 12500,
        referralCode: 'DEMO' + Math.random().toString(36).slice(2, 6).toUpperCase()
      });
    }

    // ---- Demo admin ----
    // Must match DEMO_ADMIN in admin.js exactly (id + email + password).
    if (!users.some(function (u) { return u.email === 'admin@globalexpress.test'; })) {
      users.push({
        id: 'u_admin_demo',
        name: 'Admin User',
        email: 'admin@globalexpress.test',
        password: 'admin123',
        role: 'admin',
        joined: fmtDate(),
        phone: '',
        country: 'Cameroon',
        company: 'GlobalExpress',
        wallet: 0,
        referralCode: 'ADMIN001'
      });
    }

    store.set(KEYS.users, users);
  }

  // ================================================================
  // UI HELPERS — error banner + tab switching
  // ================================================================
  function showError(msg) {
    const box = document.getElementById('authError');
    const text = document.getElementById('authErrorText');
    if (!box || !text) return;
    text.textContent = msg;
    box.classList.add('show');
  }

  function hideError() {
    const box = document.getElementById('authError');
    if (box) box.classList.remove('show');
  }

  function switchTab(tab) {
    const isLogin = tab === 'login';

    // Tabs
    document.getElementById('tabLogin')
      ?.classList.toggle('active', isLogin);
    document.getElementById('tabSignup')
      ?.classList.toggle('active', !isLogin);

    // Forms
    document.getElementById('loginForm')
      ?.classList.toggle('hidden', !isLogin);
    document.getElementById('signupForm')
      ?.classList.toggle('hidden', isLogin);

    // Headings
    const h1 = document.getElementById('authH1');
    const p  = document.getElementById('authP');
    if (h1) h1.textContent = isLogin ? 'Welcome back' : 'Create your account';
    if (p)  p.textContent  = isLogin
      ? 'Sign in to manage your shipments and wallet.'
      : 'Join millions shipping with confidence worldwide.';

    hideError();
  }

  function togglePw(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPw = input.type === 'password';
    input.type = isPw ? 'text' : 'password';
    const icon = btn.querySelector('i');
    if (icon) icon.className = isPw ? 'fas fa-eye-slash' : 'fas fa-eye';
  }

  // ================================================================
  // PASSWORD STRENGTH
  // Score 0–5 based on length + character classes. The score
  // drives both the fill width and the color of the meter.
  // ================================================================
  function checkPwStrength() {
    const input = document.getElementById('signupPassword');
    if (!input) return;
    const pw = input.value;

    let score = 0;
    if (pw.length >= 6)  score++;
    if (pw.length >= 10) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    const fill = document.getElementById('pwMeterFill');
    const text = document.getElementById('pwMeterText');
    if (!fill || !text) return;

    fill.style.width = (score / 5 * 100) + '%';

    if (pw.length === 0) {
      fill.style.width = '0%';
      text.textContent = 'Password strength';
      return;
    }

    if (score <= 1) {
      fill.style.background = 'var(--red)';
      text.textContent = 'Weak password';
    } else if (score <= 3) {
      fill.style.background = 'var(--amber)';
      text.textContent = 'Fair password';
    } else {
      fill.style.background = 'var(--green)';
      text.textContent = 'Strong password';
    }
  }

  // ================================================================
  // VALIDATION
  // ================================================================
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  }

  // ================================================================
  // SESSION MANAGEMENT
  // Writes the same { userId, at } shape that auth.js expects.
  // ================================================================
  function saveSession(user) {
    store.set(KEYS.session, {
      userId: user.id,
      at: Date.now()
    });
  }

  function pushWelcomeNotification(user) {
    const list = store.get(KEYS.notifications, []);
    list.push({
      id: uid('n'),
      userId: user.id,
      title: 'Welcome to GlobalExpress!',
      message: 'Your account is ready. Deposit money to start shipping.',
      type: 'success',
      at: fmtDate(),
      read: false
    });
    store.set(KEYS.notifications, list);
  }

  // ================================================================
  // PROCESSING OVERLAY — fake but realistic auth delay
  // ================================================================
  function showProcessing(title, msg) {
    const box = document.getElementById('processing');
    if (!box) return;
    document.getElementById('procTitle').textContent = title || 'Processing';
    document.getElementById('procMsg').textContent   = msg   || 'Please wait…';
    box.classList.add('show');
  }
  function hideProcessing() {
    const box = document.getElementById('processing');
    if (box) box.classList.remove('show');
  }

  // ================================================================
  // ROLE-AWARE REDIRECT
  // Admins go to admin.html, everyone else goes to app.html.
  // This is the missing link that was keeping admin testers stuck
  // on the customer portal.
  // ================================================================
  function redirectAfterLogin(user) {
    const isAdmin = user && user.role === 'admin';
    window.location.href = isAdmin ? ADMIN_URL : APP_URL;
  }

  // ================================================================
  // AUTH FLOWS
  // ================================================================

  /**
   * SIGN UP — validate, check for duplicate email, create user,
   * save session, redirect to the appropriate shell.
   *
   * New signups are always role: 'user' — promotion to admin
   * happens through the admin console (or by seeding).
   */
  function handleSignup(e) {
    e.preventDefault();
    hideError();

    const name      = (document.getElementById('signupName')?.value || '').trim();
    const email     = (document.getElementById('signupEmail')?.value || '').trim().toLowerCase();
    const password  = document.getElementById('signupPassword')?.value || '';
    const agreed    = !!document.getElementById('agreeTerms')?.checked;

    // Validate
    if (!name) return showError('Please enter your full name.');
    if (!isValidEmail(email)) return showError('Please enter a valid email address.');
    if (password.length < 6) return showError('Password must be at least 6 characters.');
    if (!agreed) return showError('You must agree to the Terms and Privacy Policy.');

    // Duplicate check
    const users = store.get(KEYS.users, []);
    if (users.some(function (u) { return u.email === email; })) {
      return showError('An account with that email already exists.');
    }

    // Build user record
    const firstWord = name.split(' ')[0] || 'USER';
    const user = {
      id: uid('u'),
      name: name,
      email: email,
      password: password,
      role: 'user',
      joined: fmtDate(),
      phone: '',
      country: '',
      company: '',
      wallet: 0,
      referralCode:
        firstWord.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) +
        Math.random().toString(36).slice(2, 6).toUpperCase()
    };

    // Persist
    users.push(user);
    store.set(KEYS.users, users);

    // If an adapter exists, use it (future-proofing)
    if (Data && typeof Data.signUp === 'function') {
      try { Data.signUp(user.email, user.password, user.name); } catch (e) { /* ignore */ }
    }

    // Session + welcome notification
    saveSession(user);
    pushWelcomeNotification(user);

    // Fake processing delay, then redirect
    showProcessing('Creating account', 'Setting things up…');
    setTimeout(function () {
      hideProcessing();
      toast('Welcome aboard!', 'Your account is ready.', 'success');
      redirectAfterLogin(user);
    }, 1200);
  }

  /**
   * SIGN IN — find user by email + password, save session, redirect.
   * Admins are routed to admin.html, customers to app.html.
   */
  function handleLogin(e) {
    e.preventDefault();
    hideError();

    const email    = (document.getElementById('loginEmail')?.value || '').trim().toLowerCase();
    const password = document.getElementById('loginPassword')?.value || '';

    if (!email || !password) {
      return showError('Please enter your email and password.');
    }

    const users = store.get(KEYS.users, []);
    const user = users.find(function (u) {
      return u.email === email && u.password === password;
    });

    if (!user) {
      return showError('Invalid email or password. Please try again.');
    }

    // If adapter exists, prefer it (future-proofing)
    if (Data && typeof Data.signIn === 'function') {
      try { Data.signIn(email, password); } catch (e) { /* ignore */ }
    }

    saveSession(user);

    // Fake processing delay, then redirect
    const firstName = (user.name || 'there').split(' ')[0];
    const isAdmin = user.role === 'admin';
    showProcessing(
      isAdmin ? 'Opening admin console' : 'Signing you in',
      'Welcome back, ' + firstName + '…'
    );
    setTimeout(function () {
      hideProcessing();
      toast('Welcome back, ' + firstName + '!', 'Signed in successfully.', 'success');
      redirectAfterLogin(user);
    }, isAdmin ? 700 : 1000);
  }

  // ================================================================
  // FORGOT PASSWORD
  // ================================================================
  function openForgot(e) {
    if (e) e.preventDefault();
    const root = document.getElementById('modalRoot');
    if (!root) return;

    const wrap = document.createElement('div');
    wrap.className = 'modal-bg show';
    wrap.innerHTML = `
      <div class="modal narrow">
        <div class="modal-head">
          <div>
            <h3><i class="fas fa-key"></i> Reset Password</h3>
            <div class="sub">We'll send a reset link to your email.</div>
          </div>
          <button class="modal-close" type="button" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Email Address</label>
            <input type="email" id="forgotEmail" placeholder="you@example.com" />
            <div class="hint">Demo: no email is actually sent.</div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-outline" data-action="cancel" type="button">Cancel</button>
          <button class="btn btn-primary" data-action="send" type="button">
            <i class="fas fa-paper-plane"></i> Send Reset Link
          </button>
        </div>
      </div>`;

    wrap.addEventListener('click', function (ev) {
      if (ev.target === wrap) closeModal(wrap);
    });

    // Delegated button handling inside the modal
    wrap.addEventListener('click', function (ev) {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'cancel') {
        closeModal(wrap);
      } else if (action === 'send') {
        const email = document.getElementById('forgotEmail')?.value.trim() || '';
        if (!isValidEmail(email)) {
          toast('Please enter a valid email', '', 'error');
          return;
        }
        closeModal(wrap);
        toast('Reset link sent', 'Check your inbox for ' + email, 'success');
      }
    });

    wrap.querySelector('.modal-close').addEventListener('click', function () {
      closeModal(wrap);
    });

    root.appendChild(wrap);
  }

  function closeModal(el) {
    if (!el) return;
    el.classList.remove('show');
    setTimeout(function () { el.remove(); }, 200);
  }

  // ================================================================
  // INIT
  // ================================================================
  function init() {
    seedDemoAccount();

    // Wire tabs
    document.getElementById('tabLogin')
      ?.addEventListener('click', function () { switchTab('login'); });
    document.getElementById('tabSignup')
      ?.addEventListener('click', function () { switchTab('signup'); });

    // Wire forms
    document.getElementById('loginForm')
      ?.addEventListener('submit', handleLogin);
    document.getElementById('signupForm')
      ?.addEventListener('submit', handleSignup);

    // Password strength on input
    document.getElementById('signupPassword')
      ?.addEventListener('input', checkPwStrength);

    // Password visibility toggles
    document.querySelectorAll('.pw-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const inputId = btn.previousElementSibling?.id;
        if (inputId) togglePw(inputId, btn);
      });
    });

    // Forgot password link
    document.querySelectorAll('.auth-link').forEach(function (link) {
      if (/forgot/i.test(link.textContent)) {
        link.addEventListener('click', openForgot);
      }
    });

    // Social buttons (demo — no real OAuth)
    document.querySelectorAll('.social-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toast('Not available', 'Social login is disabled in demo mode.', 'info');
      });
    });

    // If already signed in, route by role and skip the portal entirely.
    const session = store.get(KEYS.session, null);
    if (session && session.userId) {
      const users = store.get(KEYS.users, []);
      const existing = users.find(function (u) { return u.id === session.userId; });
      if (existing) {
        redirectAfterLogin(existing);
        return;
      }
      // Stale session — clear it
      store.set(KEYS.session, null);
    }

    // Default tab: login
    switchTab('login');
  }

  // Kick off when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Escape closes the modal
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-bg.show').forEach(closeModal);
    }
  });

  // ================================================================
  // PUBLIC SURFACE (for console debugging)
  // ================================================================
  window.Portal = {
    switchTab: switchTab,
    openForgot: openForgot,
    seed:       seedDemoAccount,
    getUsers:   function () { return store.get(KEYS.users, []); },
    getSession: function () { return store.get(KEYS.session, null); },

    /** Force a sign-in for console testing.
     *   Portal.signInAs('admin@globalexpress.test')
     *   Portal.signInAs('demo@globalexpress.test')
     */
    signInAs: function (email) {
      const users = store.get(KEYS.users, []);
      const u = users.find(function (x) { return x.email === email; });
      if (!u) {
        console.warn('[Portal] no user with email', email);
        return false;
      }
      saveSession(u);
      redirectAfterLogin(u);
      return true;
    }
  };

})();