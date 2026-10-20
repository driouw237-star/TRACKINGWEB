/* GlobalExpress - pages/security.js
   Security page — professional edition.

   Features:
     - Tabs: Change Password | Forgot Password (OTP)
     - Live password strength meter with requirement checklist
     - Change password with full cross-field validation
     - OTP-based password reset (6-digit code, demo shows code in toast)
     - 3-step reset flow: enter email → verify OTP → set new password
     - Active sessions panel with device, browser, OS, started
     - 2FA preview
     - Security tips

   Registers itself via App.register('security', page).
   Reads/writes Store (users, session).
   Emits realtime events via Realtime.notifyLocalChange.
*/
(function (global) {
  'use strict';

  var Utils    = global.Utils    || {};
  var UI       = global.UI       || {};
  var V        = global.V        || {};
  var Store    = global.Store    || {};
  var Realtime = global.Realtime || {};

  // --- Fallbacks -----------------------------------------------------------

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var fmtDT = Utils.fmtDT || function (d) {
    return new Date(d || Date.now()).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };
  var uid = Utils.uid || function (p) {
    return (p || 'id') + '_' + Math.random().toString(36).slice(2, 10);
  };

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  var openModal = UI.openModal || function () { return null; };
  var closeModal = UI.closeModal || function () {};

  // --- Module state --------------------------------------------------------

  var activeTab = 'change';   // 'change' | 'reset'
  var resetStep = 1;          // 1 = enter email, 2 = enter OTP, 3 = new password
  var resetEmail = '';
  var resetOtp   = '';
  var resetAttempts = 0;
  var resetExpiresAt = 0;

  var handler = null;
  var container = null;
  var liveUnsub = null;

  // --- Helpers -------------------------------------------------------------

  function currentUser(ctx) {
    return (ctx && ctx.user) ||
           (global.App && global.App.state && global.App.state.user) ||
           null;
  }

  function gv(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '') : '';
  }

  function togglePw(id, btn) {
    var inp = document.getElementById(id);
    if (!inp) return;
    var isPw = inp.type === 'password';
    inp.type = isPw ? 'text' : 'password';
    var icon = btn.querySelector('i');
    if (icon) icon.className = isPw ? 'fas fa-eye-slash' : 'fas fa-eye';
  }

  function genOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function getUsers() {
    try { return Store.get('users') || []; } catch (e) { return []; }
  }

  function findUserByEmail(email) {
    if (!email) return null;
    var users = getUsers();
    var e = String(email).trim().toLowerCase();
    for (var i = 0; i < users.length; i++) {
      if (String(users[i].email || '').toLowerCase() === e) return users[i];
    }
    return null;
  }

  // --- Password strength with requirement checks ---------------------------

  function analyzePassword(pw) {
    pw = String(pw || '');
    var checks = {
      length:  pw.length >= 8,
      upper:   /[A-Z]/.test(pw),
      lower:   /[a-z]/.test(pw),
      number:  /[0-9]/.test(pw),
      symbol:  /[^A-Za-z0-9]/.test(pw)
    };
    var passed = 0;
    for (var k in checks) if (checks[k]) passed++;

    var label, color;
    if (passed <= 2)      { label = 'Weak';   color = 'red'; }
    else if (passed === 3) { label = 'Fair';   color = 'amber'; }
    else if (passed === 4) { label = 'Good';   color = 'green'; }
    else                   { label = 'Strong'; color = 'green'; }

    return {
      checks: checks,
      passed: passed,
      label: label,
      color: color,
      percent: Math.round(passed / 5 * 100)
    };
  }

  // --- Requirement checklist HTML ------------------------------------------

  function requirementRow(passed, text) {
    return ''
      + '<div style="display:flex;align-items:center;gap:8px;font-size:12px;'
      +   'color:' + (passed ? 'var(--green)' : 'var(--text-3)') + ';'
      +   'transition:color .15s var(--ease)">'
      +   '<i class="fas ' + (passed ? 'fa-circle-check' : 'fa-circle') + '" style="font-size:11px"></i> '
      +   '<span>' + esc(text) + '</span>'
      + '</div>';
  }

  function requirementList(result) {
    var c = result.checks;
    return ''
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;margin-top:10px">'
      +   requirementRow(c.length, '8+ characters')
      +   requirementRow(c.upper,  'Uppercase letter')
      +   requirementRow(c.lower,  'Lowercase letter')
      +   requirementRow(c.number, 'Number')
      +   requirementRow(c.symbol, 'Special character')
      + '</div>';
  }

  // =================================================================
  // TAB 1 — CHANGE PASSWORD PANEL
  // =================================================================

  function changeTabContent() {
    return ''
      + '<div class="field" style="margin-bottom:14px">'
      +   '<label>Current Password <span class="req">*</span></label>'
      +   '<div class="pw-wrap">'
      +     '<input type="password" id="cpCurrent" placeholder="Enter your current password" autocomplete="current-password" />'
      +     '<button type="button" class="pw-toggle" data-action="toggle-pw" data-target="cpCurrent" aria-label="Show password"><i class="fas fa-eye"></i></button>'
      +   '</div>'
      + '</div>'

      + '<div class="field" style="margin-bottom:8px">'
      +   '<label>New Password <span class="req">*</span></label>'
      +   '<div class="pw-wrap">'
      +     '<input type="password" id="cpNew" placeholder="At least 8 characters" autocomplete="new-password" />'
      +     '<button type="button" class="pw-toggle" data-action="toggle-pw" data-target="cpNew" aria-label="Show password"><i class="fas fa-eye"></i></button>'
      +   '</div>'
      +   '<div class="pw-meter"><div class="pw-meter-fill" id="cpMeterFill"></div></div>'
      +   '<div class="pw-meter-text" id="cpMeterText">Password strength</div>'
      +   '<div id="cpRequirements">' + requirementList(analyzePassword('')) + '</div>'
      + '</div>'

      + '<div class="field" style="margin-bottom:18px">'
      +   '<label>Confirm New Password <span class="req">*</span></label>'
      +   '<div class="pw-wrap">'
      +     '<input type="password" id="cpConfirm" placeholder="Repeat new password" autocomplete="new-password" />'
      +     '<button type="button" class="pw-toggle" data-action="toggle-pw" data-target="cpConfirm" aria-label="Show password"><i class="fas fa-eye"></i></button>'
      +   '</div>'
      + '</div>'

      + '<div style="display:flex;justify-content:flex-end;gap:10px">'
      +   '<button type="button" class="btn btn-outline" data-action="reset-change-form">Cancel</button>'
      +   '<button type="button" class="btn btn-primary" data-action="change-password">'
      +     '<i class="fas fa-shield-halved"></i> Update Password'
      +   '</button>'
      + '</div>';
  }

  // =================================================================
  // TAB 2 — FORGOT PASSWORD (OTP) PANEL — 3 STEPS
  // =================================================================

  function resetStepIndicator() {
    var steps = [
      { n: 1, label: 'Email' },
      { n: 2, label: 'Verify' },
      { n: 3, label: 'New password' }
    ];
    return ''
      + '<div class="stepper stepper-sm" style="margin-bottom:20px">'
      +   steps.map(function (s) {
            var done   = s.n < resetStep;
            var active = s.n === resetStep;
            var icon   = done ? '<i class="fas fa-check"></i>' : String(s.n);
            return ''
              + '<div class="step-item ' + (done ? 'done ' : '') + (active ? 'active' : '') + '">'
              +   '<div class="step-num">' + icon + '</div>'
              +   '<span>' + esc(s.label) + '</span>'
              + '</div>';
          }).join('')
      + '</div>';
  }

  function resetStep1() {
    return ''
      + resetStepIndicator()
      + '<div style="text-align:center;margin-bottom:22px">'
      +   '<div style="width:56px;height:56px;border-radius:50%;background:#eff6ff;color:var(--blue);display:inline-flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:12px">'
      +     '<i class="fas fa-envelope"></i>'
      +   '</div>'
      +   '<h4 style="font-family:\'Manrope\',sans-serif;font-size:16px;font-weight:700;margin:0 0 4px;color:var(--text)">Forgot your password?</h4>'
      +   '<p style="font-size:13px;color:var(--text-2);margin:0;max-width:340px;margin-left:auto;margin-right:auto;line-height:1.55">'
      +     'Enter the email address on your account. We\'ll send a 6-digit verification code.'
      +   '</p>'
      + '</div>'

      + '<div class="field" style="margin-bottom:18px">'
      +   '<label>Email Address <span class="req">*</span></label>'
      +   '<input type="email" id="rsEmail" placeholder="you@example.com" autocomplete="email" />'
      +   '<div class="hint">Demo mode: the code will be shown in a toast notification.</div>'
      + '</div>'

      + '<div style="display:flex;justify-content:flex-end;gap:10px">'
      +   '<button type="button" class="btn btn-outline" data-action="reset-reset-form">Cancel</button>'
      +   '<button type="button" class="btn btn-primary" data-action="send-otp">'
      +     '<i class="fas fa-paper-plane"></i> Send Code'
      +   '</button>'
      + '</div>';
  }

  function resetStep2() {
    return ''
      + resetStepIndicator()
      + '<div style="text-align:center;margin-bottom:22px">'
      +   '<div style="width:56px;height:56px;border-radius:50%;background:#fffbeb;color:var(--amber);display:inline-flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:12px">'
      +     '<i class="fas fa-shield-halved"></i>'
      +   '</div>'
      +   '<h4 style="font-family:\'Manrope\',sans-serif;font-size:16px;font-weight:700;margin:0 0 4px;color:var(--text)">Check your email</h4>'
      +   '<p style="font-size:13px;color:var(--text-2);margin:0 0 4px;line-height:1.55">'
      +     'We sent a 6-digit code to'
      +   '</p>'
      +   '<p style="font-size:13.5px;font-weight:600;color:var(--text);margin:0">'
      +     esc(resetEmail)
      +   '</p>'
      + '</div>'

      + '<div class="field" style="margin-bottom:14px">'
      +   '<label>Verification Code <span class="req">*</span></label>'
      +   '<input type="text" id="rsOtp" placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code" '
      +     'style="text-align:center;font-family:\'Monaco\',\'Menlo\',monospace;font-size:22px;letter-spacing:8px;font-weight:700;padding:14px" />'
      +   '<div class="hint" style="text-align:center;margin-top:8px">'
      +     'Code expires in 10 minutes. Check spam folder if not received.'
      +   '</div>'
      + '</div>'

      + '<div style="text-align:center;margin:14px 0 18px">'
      +   '<button type="button" class="btn-link" data-action="resend-otp" style="font-size:12.5px;background:none;border:none;color:var(--accent);font-weight:600;cursor:pointer;padding:0">'
      +     'Resend code'
      +   '</button>'
      + '</div>'

      + '<div style="display:flex;justify-content:space-between;gap:10px">'
      +   '<button type="button" class="btn btn-outline" data-action="otp-back">'
      +     '<i class="fas fa-arrow-left"></i> Back'
      +   '</button>'
      +   '<button type="button" class="btn btn-primary" data-action="verify-otp">'
      +     '<i class="fas fa-check"></i> Verify Code'
      +   '</button>'
      + '</div>';
  }

  function resetStep3() {
    return ''
      + resetStepIndicator()
      + '<div style="text-align:center;margin-bottom:22px">'
      +   '<div style="width:56px;height:56px;border-radius:50%;background:#ecfdf5;color:var(--green);display:inline-flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:12px">'
      +     '<i class="fas fa-key"></i>'
      +   '</div>'
      +   '<h4 style="font-family:\'Manrope\',sans-serif;font-size:16px;font-weight:700;margin:0 0 4px;color:var(--text)">Set a new password</h4>'
      +   '<p style="font-size:13px;color:var(--text-2);margin:0">Choose a strong password for your account.</p>'
      + '</div>'

      + '<div class="field" style="margin-bottom:8px">'
      +   '<label>New Password <span class="req">*</span></label>'
      +   '<div class="pw-wrap">'
      +     '<input type="password" id="rsNew" placeholder="At least 8 characters" autocomplete="new-password" />'
      +     '<button type="button" class="pw-toggle" data-action="toggle-pw" data-target="rsNew" aria-label="Show password"><i class="fas fa-eye"></i></button>'
      +   '</div>'
      +   '<div class="pw-meter"><div class="pw-meter-fill" id="rsMeterFill"></div></div>'
      +   '<div class="pw-meter-text" id="rsMeterText">Password strength</div>'
      +   '<div id="rsRequirements">' + requirementList(analyzePassword('')) + '</div>'
      + '</div>'

      + '<div class="field" style="margin-bottom:18px">'
      +   '<label>Confirm New Password <span class="req">*</span></label>'
      +   '<div class="pw-wrap">'
      +     '<input type="password" id="rsConfirm" placeholder="Repeat new password" autocomplete="new-password" />'
      +     '<button type="button" class="pw-toggle" data-action="toggle-pw" data-target="rsConfirm" aria-label="Show password"><i class="fas fa-eye"></i></button>'
      +   '</div>'
      + '</div>'

      + '<div style="display:flex;justify-content:flex-end;gap:10px">'
      +   '<button type="button" class="btn btn-outline" data-action="reset-reset-form">Cancel</button>'
      +   '<button type="button" class="btn btn-primary" data-action="set-new-password">'
      +     '<i class="fas fa-check"></i> Update Password'
      +   '</button>'
      + '</div>';
  }

  function resetTabContent() {
    if (resetStep === 1) return resetStep1();
    if (resetStep === 2) return resetStep2();
    return resetStep3();
  }

  // =================================================================
  // MAIN PANEL with TABS
  // =================================================================

  function securityPanel() {
    return ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-shield-halved"></i> Password & Security</h3>'
      +   '</div>'
      +   '<div class="panel-body">'

      // Tabs
      +     '<div class="tabs" style="margin-bottom:22px">'
      +       '<button type="button" class="tab' + (activeTab === 'change' ? ' active' : '') + '" data-action="switch-tab" data-tab="change">'
      +         '<i class="fas fa-key" style="margin-right:6px"></i> Change Password'
      +       '</button>'
      +       '<button type="button" class="tab' + (activeTab === 'reset' ? ' active' : '') + '" data-action="switch-tab" data-tab="reset">'
      +         '<i class="fas fa-envelope" style="margin-right:6px"></i> Forgot Password'
      +       '</button>'
      +     '</div>'

      // Tab content
      +     '<div id="securityTabContent">'
      +       (activeTab === 'change' ? changeTabContent() : resetTabContent())
      +     '</div>'

      +   '</div>'
      + '</div>';
  }

  // =================================================================
  // 2FA PANEL
  // =================================================================

  function twoFactorPanel() {
    return ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-mobile-screen-button"></i> Two-Factor Authentication</h3>'
      +     '<span class="pill On-Hold" style="font-size:10px">Coming soon</span>'
      +   '</div>'
      +   '<div class="panel-body">'
      +     '<p style="font-size:13.5px;color:var(--text-2);line-height:1.6;margin:0 0 16px">'
      +       'Add an extra layer of security. When enabled, you\'ll be asked for a one-time code from your phone in addition to your password.'
      +     '</p>'
      +     '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">'
      +       '<label class="switch" style="cursor:not-allowed;opacity:.55">'
      +         '<input type="checkbox" disabled />'
      +         '<span class="track"></span>'
      +         '<span>Enable 2FA</span>'
      +       '</label>'
      +       '<span style="font-size:12px;color:var(--text-3)">We\'ll let you know when this is available.</span>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  // =================================================================
  // ACTIVE SESSIONS
  // =================================================================

  function sessionsPanel(user) {
    var session = null;
    try { session = Store.get('session'); } catch (e) {}

    var startedAt = '';
    if (session && session.at) startedAt = fmtDT(session.at);
    else if (user && user.joined) startedAt = 'Since ' + user.joined;

    var ua = (navigator && navigator.userAgent) ? navigator.userAgent : '';
    var info = parseDevice(ua);

    return ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-laptop"></i> Active Sessions</h3>'
      +     '<span class="badge" style="font-size:11px;color:var(--text-3);background:var(--surface-2);padding:3px 9px;border-radius:6px">1 active</span>'
      +   '</div>'
      +   '<div class="panel-body" style="padding:0">'

      +     '<div style="display:flex;gap:14px;align-items:flex-start;padding:18px 22px">'
      +       '<div style="width:44px;height:44px;border-radius:11px;background:#ecfdf5;color:var(--green);display:inline-flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">'
      +         '<i class="fas ' + esc(info.icon) + '"></i>'
      +       '</div>'
      +       '<div style="flex:1;min-width:0">'
      +         '<div style="font-weight:600;font-size:14px;color:var(--text);display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
      +           'This device'
      +           '<span class="pill Delivered" style="font-size:10px">Active now</span>'
      +         '</div>'
      +         '<div style="font-size:12.5px;color:var(--text-2);margin-top:4px;line-height:1.5">'
      +           esc(info.browser) + ' on ' + esc(info.os) + ' · Started ' + esc(startedAt || 'recently')
      +         '</div>'
      +         '<div style="font-size:11.5px;color:var(--text-3);margin-top:2px">'
      +           'Session ID: <span class="mono">' + esc((session && session.userId) ? String(session.userId).slice(-8) : '—') + '</span>'
      +         '</div>'
      +       '</div>'
      +     '</div>'

      +     '<div style="padding:14px 22px;border-top:1px solid var(--border-2);display:flex;justify-content:flex-end">'
      +       '<button type="button" class="btn btn-danger" data-action="sign-out-all">'
      +         '<i class="fas fa-right-from-bracket"></i> Sign out of all devices'
      +       '</button>'
      +     '</div>'

      +   '</div>'
      + '</div>';
  }

  function parseDevice(ua) {
    if (!ua) return { browser: 'Unknown', os: 'Unknown', icon: 'fa-question' };
    var s = String(ua);
    var browser = 'Browser';
    var icon = 'fa-globe';
    if (s.indexOf('Edg/') >= 0)      { browser = 'Edge';    icon = 'fa-edge'; }
    else if (s.indexOf('Chrome/') >= 0) { browser = 'Chrome';  icon = 'fa-chrome'; }
    else if (s.indexOf('Firefox/') >= 0){ browser = 'Firefox'; icon = 'fa-firefox'; }
    else if (s.indexOf('Safari/') >= 0) { browser = 'Safari';  icon = 'fa-safari'; }

    var os = 'Unknown OS';
    if (s.indexOf('Windows') >= 0) os = 'Windows';
    else if (s.indexOf('Mac OS') >= 0) os = 'macOS';
    else if (s.indexOf('Linux') >= 0) os = 'Linux';
    else if (s.indexOf('Android') >= 0) os = 'Android';
    else if (s.indexOf('iPhone') >= 0 || s.indexOf('iPad') >= 0) os = 'iOS';

    return { browser: browser, os: os, icon: icon };
  }

  // =================================================================
  // SECURITY TIPS
  // =================================================================

  function tipsPanel() {
    var tips = [
      { icon: 'fa-key',                  title: 'Use a long passphrase',       desc: 'Aim for 12+ characters. Length beats complexity.' },
      { icon: 'fa-fingerprint',          title: 'Never reuse passwords',        desc: 'Each account should have a unique password.' },
      { icon: 'fa-vault',                title: 'Use a password manager',       desc: 'Bitwarden, 1Password, or your browser\'s built-in vault.' },
      { icon: 'fa-mobile-screen-button', title: 'Enable 2FA when available',    desc: 'Protects you even if your password is leaked.' },
      { icon: 'fa-envelope-circle-check',title: 'Watch for phishing emails',    desc: 'We\'ll never ask for your password via email.' }
    ];

    return ''
      + '<div class="panel">'
      +   '<div class="panel-header"><h3><i class="fas fa-lightbulb"></i> Security Tips</h3></div>'
      +   '<div class="panel-body" style="padding:0">'
      +     tips.map(function (t) {
            return ''
              + '<div style="display:flex;gap:14px;padding:14px 22px;border-bottom:1px solid var(--border-2)">'
              +   '<div style="width:36px;height:36px;border-radius:10px;background:var(--surface-2);color:var(--text-2);display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">'
              +     '<i class="fas ' + esc(t.icon) + '"></i>'
              +   '</div>'
              +   '<div>'
              +     '<div style="font-weight:600;font-size:13.5px;color:var(--text)">' + esc(t.title) + '</div>'
              +     '<div style="font-size:12.5px;color:var(--text-2);margin-top:2px;line-height:1.5">' + esc(t.desc) + '</div>'
              +   '</div>'
              + '</div>';
          }).join('')
      +   '</div>'
      + '</div>';
  }

  // =================================================================
  // LIVE METER (Change Password + Reset Step 3)
  // =================================================================

  function wireMeter(inputId, fillId, textId, reqId) {
    var input = document.getElementById(inputId);
    var fill  = document.getElementById(fillId);
    var text  = document.getElementById(textId);
    var req   = document.getElementById(reqId);
    if (!input || !fill || !text) return;

    input.addEventListener('input', function () {
      var pw = input.value || '';
      var result = analyzePassword(pw);

      fill.style.width = result.percent + '%';
      fill.style.background = result.color === 'green' ? 'var(--green)'
                            : result.color === 'amber' ? 'var(--amber)'
                            : 'var(--red)';

      if (!pw) {
        text.textContent = 'Password strength';
        text.style.color = '';
      } else {
        text.textContent = result.label + ' password';
        text.style.color = result.color === 'green' ? 'var(--green)'
                          : result.color === 'amber' ? 'var(--amber)'
                          : 'var(--red)';
      }

      if (req) req.innerHTML = requirementList(result);
    });
  }

  // =================================================================
  // SWITCH TAB / RESET STEP
  // =================================================================

  function switchTab(tab) {
    activeTab = tab;
    resetStep = 1;
    resetEmail = '';
    resetOtp = '';
    resetAttempts = 0;

    var host = document.getElementById('securityTabContent');
    if (host) host.innerHTML = (tab === 'change' ? changeTabContent() : resetTabContent());

    // Update tab active class
    var tabs = container.querySelectorAll('[data-action="switch-tab"]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].dataset.tab === activeTab);
    }

    // Re-wire meter
    if (activeTab === 'change') {
      wireMeter('cpNew', 'cpMeterFill', 'cpMeterText', 'cpRequirements');
    } else if (resetStep === 3) {
      wireMeter('rsNew', 'rsMeterFill', 'rsMeterText', 'rsRequirements');
    }
  }

  function rerenderResetStep() {
    var host = document.getElementById('securityTabContent');
    if (host) host.innerHTML = resetTabContent();

    if (resetStep === 3) {
      wireMeter('rsNew', 'rsMeterFill', 'rsMeterText', 'rsRequirements');
      var otp = document.getElementById('rsOtp');
      if (otp) otp.value = '';
    }
    if (resetStep === 2) {
      var otp2 = document.getElementById('rsOtp');
      if (otp2) setTimeout(function () { otp2.focus(); }, 100);
    }
  }

  // =================================================================
  // CHANGE PASSWORD
  // =================================================================

  function changePassword(ctx) {
    var user = currentUser(ctx);
    if (!user) return;

    var current = gv('cpCurrent');
    var newPw   = gv('cpNew');
    var confirm = gv('cpConfirm');

    if (!current || !newPw || !confirm) {
      toast('All fields are required', '', 'error');
      return;
    }
    if (newPw.length < 8) {
      toast('Password too short', 'At least 8 characters.', 'error');
      return;
    }

    var result = analyzePassword(newPw);
    if (result.passed < 4) {
      toast('Password too weak', 'Meet at least 4 of the 5 requirements.', 'error');
      return;
    }

    if (current !== user.password) {
      if (V && V.showFieldError) {
        V.showFieldError(document.getElementById('cpCurrent'), 'Current password is incorrect');
      }
      toast('Incorrect password', 'Your current password doesn\'t match.', 'error');
      return;
    }

    if (newPw === current) {
      if (V && V.showFieldError) {
        V.showFieldError(document.getElementById('cpNew'), 'Choose a different password');
      }
      toast('Choose a new password', 'New password must differ from the current one.', 'error');
      return;
    }

    if (newPw !== confirm) {
      if (V && V.showFieldError) {
        V.showFieldError(document.getElementById('cpConfirm'), 'Passwords do not match');
      }
      toast('Passwords do not match', '', 'error');
      return;
    }

    // Persist
    if (Store.updateUser) {
      Store.updateUser({ password: newPw });
    } else {
      var users = Store.get('users') || [];
      var i = users.findIndex(function (u) { return u.id === user.id; });
      if (i !== -1) { users[i].password = newPw; Store.set('users', users); }
    }

    if (Realtime.notifyLocalChange) Realtime.notifyLocalChange('user:changed');

    toast('Password updated', 'Your new password is active.', 'success');
    resetChangeForm();
  }

  function resetChangeForm() {
    ['cpCurrent', 'cpNew', 'cpConfirm'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var fill = document.getElementById('cpMeterFill');
    var text = document.getElementById('cpMeterText');
    var req  = document.getElementById('cpRequirements');
    if (fill) { fill.style.width = '0%'; fill.style.background = 'var(--red)'; }
    if (text) { text.textContent = 'Password strength'; text.style.color = ''; }
    if (req)  { req.innerHTML = requirementList(analyzePassword('')); }
    if (V && V.clearFieldErrors && container) V.clearFieldErrors(container);
  }

  // =================================================================
  // FORGOT PASSWORD (OTP) FLOW
  // =================================================================

  function sendOtp() {
    var email = gv('rsEmail').trim().toLowerCase();
    if (!email) { toast('Email required', 'Please enter your email.', 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      toast('Invalid email', 'Please enter a valid email address.', 'error');
      return;
    }

    var user = findUserByEmail(email);
    if (!user) {
      // Security best-practice: don't reveal whether the email exists.
      // But for demo UX, we'll show a soft message.
      toast('Email not found', 'No account with this email. Check the address and try again.', 'error');
      return;
    }

    // Generate OTP
    resetEmail = email;
    resetOtp = genOtp();
    resetExpiresAt = Date.now() + 10 * 60 * 1000;  // 10 minutes
    resetAttempts = 0;

    // Demo: show the code in a toast + copy to console
    console.log('[OTP] Your verification code is:', resetOtp);
    toast('Verification code sent', 'Demo code: ' + resetOtp + ' (valid 10 minutes)', 'success', 8000);

    resetStep = 2;
    rerenderResetStep();
  }

  function resendOtp() {
    if (!resetEmail) { switchTab('reset'); return; }
    resetOtp = genOtp();
    resetExpiresAt = Date.now() + 10 * 60 * 1000;
    resetAttempts = 0;

    console.log('[OTP] Resent. Your verification code is:', resetOtp);
    toast('Code resent', 'Demo code: ' + resetOtp + ' (valid 10 minutes)', 'success', 8000);
  }

  function verifyOtp() {
    if (!resetOtp || !resetExpiresAt) {
      toast('Session expired', 'Please start over.', 'error');
      switchTab('reset');
      return;
    }
    if (Date.now() > resetExpiresAt) {
      toast('Code expired', 'Please request a new code.', 'error');
      return;
    }
    if (resetAttempts >= 5) {
      toast('Too many attempts', 'Please request a new code.', 'error');
      return;
    }

    var entered = gv('rsOtp').trim();
    if (!entered) { toast('Enter the code', '', 'error'); return; }
    if (entered !== resetOtp) {
      resetAttempts++;
      toast('Incorrect code', 'Attempt ' + resetAttempts + ' of 5.', 'error');
      return;
    }

    toast('Code verified', 'Set your new password below.', 'success');
    resetStep = 3;
    rerenderResetStep();
  }

  function setNewPassword() {
    if (!resetEmail) { switchTab('reset'); return; }

    var user = findUserByEmail(resetEmail);
    if (!user) { toast('Account not found', '', 'error'); return; }

    var newPw = gv('rsNew');
    var confirm = gv('rsConfirm');

    if (!newPw || !confirm) {
      toast('Both fields required', '', 'error');
      return;
    }
    if (newPw.length < 8) {
      toast('Password too short', 'At least 8 characters.', 'error');
      return;
    }
    var result = analyzePassword(newPw);
    if (result.passed < 4) {
      toast('Password too weak', 'Meet at least 4 of the 5 requirements.', 'error');
      return;
    }
    if (newPw !== confirm) {
      toast('Passwords do not match', '', 'error');
      return;
    }

    // Update the password
    var users = Store.get('users') || [];
    var idx = -1;
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === user.id) { idx = i; break; }
    }
    if (idx === -1) { toast('Account not found', '', 'error'); return; }

    users[idx].password = newPw;
    Store.set('users', users);

    if (Realtime.notifyLocalChange) Realtime.notifyLocalChange('user:changed');

    // Reset flow state
    resetStep = 1;
    resetEmail = '';
    resetOtp = '';
    resetAttempts = 0;
    resetExpiresAt = 0;

    toast('Password updated', 'You can now sign in with your new password.', 'success');
    switchTab('change');
  }

  // =================================================================
  // SIGN OUT ALL
  // =================================================================

  function signOutAll() {
    var modal = openModal(''
      + '<div class="modal narrow modal-confirm">'
      +   '<div class="modal-body">'
      +     '<div class="modal-icon danger"><i class="fas fa-right-from-bracket"></i></div>'
      +     '<h3>Sign out of all devices</h3>'
      +     '<p>This will sign you out of every device and browser where you\'re currently logged in.</p>'
      +   '</div>'
      +   '<div class="modal-foot">'
      +     '<button type="button" class="btn btn-outline" data-close>Cancel</button>'
      +     '<button type="button" class="btn btn-danger" data-confirm>'
      +       '<i class="fas fa-right-from-bracket"></i> Sign out everywhere'
      +     '</button>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-confirm]')) {
        closeModal(modal);
        performSignOutAll();
      }
    });
  }

  function performSignOutAll() {
    try { localStorage.removeItem('ge_session'); } catch (e) {}
    try { Store.set('session', null); } catch (e) {}

    if (Realtime.notifyLocalChange) Realtime.notifyLocalChange('session:changed');

    toast('Signed out everywhere', 'You\'ll need to sign in again.', 'info');

    if (global.App && global.App.logout) {
      global.App.logout();
    } else {
      setTimeout(function () { location.reload(); }, 600);
    }
  }

  // =================================================================
  // RENDER
  // =================================================================

  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    // Reset flow state on each mount
    activeTab = 'change';
    resetStep = 1;
    resetEmail = '';
    resetOtp = '';
    resetAttempts = 0;

    return ''
      + securityPanel()
      + twoFactorPanel()
      + sessionsPanel(user)
      + tipsPanel();
  }

  // =================================================================
  // BIND
  // =================================================================

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (handler) container.removeEventListener('click', handler);

    handler = function (e) {
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      // Password visibility
      if (action === 'toggle-pw') {
        togglePw(btn.dataset.target, btn);
        return;
      }

      // Tab switch
      if (action === 'switch-tab') {
        switchTab(btn.dataset.tab);
        return;
      }

      // Change Password tab
      if (action === 'reset-change-form') { resetChangeForm(); return; }
      if (action === 'change-password')    { changePassword(ctx); return; }

      // Reset (Forgot Password) tab
      if (action === 'reset-reset-form') {
        resetStep = 1;
        resetEmail = '';
        resetOtp = '';
        resetAttempts = 0;
        rerenderResetStep();
        return;
      }
      if (action === 'send-otp')       { sendOtp(); return; }
      if (action === 'resend-otp')     { resendOtp(); return; }
      if (action === 'verify-otp')     { verifyOtp(); return; }
      if (action === 'otp-back')       { resetStep = 1; rerenderResetStep(); return; }
      if (action === 'set-new-password') { setNewPassword(); return; }

      // Sign out all
      if (action === 'sign-out-all') { signOutAll(); return; }
    };

    container.addEventListener('click', handler);

    // Wire the initial meter for the change tab
    if (activeTab === 'change') {
      wireMeter('cpNew', 'cpMeterFill', 'cpMeterText', 'cpRequirements');
    }
  }

  // =================================================================
  // CLEANUP
  // =================================================================

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    if (liveUnsub) { try { liveUnsub(); } catch (e) {} }
    liveUnsub = null;
    container = null;
    handler = null;
    activeTab = 'change';
    resetStep = 1;
    resetEmail = '';
    resetOtp = '';
    resetAttempts = 0;
  }

  // =================================================================
  // REGISTER
  // =================================================================

  var page = {
    title: 'Security',
    subtitle: 'Password and account safety',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('security', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.security = page;
  }

})(window);