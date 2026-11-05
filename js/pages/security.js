/* GlobalExpress - pages/security.js
   Security page connected to Supabase.
*/

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var fmtDT = Utils.fmtDT || function (d) {
    return new Date(d || Date.now()).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };
  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  var openModal = UI.openModal || function () { return null; };
  var closeModal = UI.closeModal || function () {};

  // --- Module state ---
  var activeTab = 'change';   // 'change' | 'reset'
  var resetStep = 1;          // 1 = email, 2 = OTP (Supabase sends link, not OTP), 3 = Not used in Supabase flow
  var resetEmail = '';
  var handler = null;
  var container = null;

  function currentUser(ctx) {
    return (ctx && ctx.user) || (global.App && global.App.state && global.App.state.user) || null;
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

  // --- Password strength ---
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

    return { checks: checks, passed: passed, label: label, color: color, percent: Math.round(passed / 5 * 100) };
  }

  function requirementRow(passed, text) {
    return `
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:${passed ? 'var(--green)' : 'var(--text-3)'};transition:color .15s var(--ease)">
        <i class="fas ${passed ? 'fa-circle-check' : 'fa-circle'}" style="font-size:11px"></i> 
        <span>${esc(text)}</span>
      </div>
    `;
  }

  function requirementList(result) {
    var c = result.checks;
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;margin-top:10px">
        ${requirementRow(c.length, '8+ characters')}
        ${requirementRow(c.upper,  'Uppercase letter')}
        ${requirementRow(c.lower,  'Lowercase letter')}
        ${requirementRow(c.number, 'Number')}
        ${requirementRow(c.symbol, 'Special character')}
      </div>
    `;
  }

  // --- Change Password ---
  function changeTabContent() {
    return `
      <div class="field" style="margin-bottom:14px">
        <label>Current Password <span class="req">*</span></label>
        <div class="pw-wrap">
          <input type="password" id="cpCurrent" placeholder="Enter your current password" autocomplete="current-password" />
          <button type="button" class="pw-toggle" data-action="toggle-pw" data-target="cpCurrent" aria-label="Show password"><i class="fas fa-eye"></i></button>
        </div>
      </div>
      <div class="field" style="margin-bottom:8px">
        <label>New Password <span class="req">*</span></label>
        <div class="pw-wrap">
          <input type="password" id="cpNew" placeholder="At least 8 characters" autocomplete="new-password" />
          <button type="button" class="pw-toggle" data-action="toggle-pw" data-target="cpNew" aria-label="Show password"><i class="fas fa-eye"></i></button>
        </div>
        <div class="pw-meter"><div class="pw-meter-fill" id="cpMeterFill"></div></div>
        <div class="pw-meter-text" id="cpMeterText">Password strength</div>
        <div id="cpRequirements">${requirementList(analyzePassword(''))}</div>
      </div>
      <div class="field" style="margin-bottom:18px">
        <label>Confirm New Password <span class="req">*</span></label>
        <div class="pw-wrap">
          <input type="password" id="cpConfirm" placeholder="Repeat new password" autocomplete="new-password" />
          <button type="button" class="pw-toggle" data-action="toggle-pw" data-target="cpConfirm" aria-label="Show password"><i class="fas fa-eye"></i></button>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px">
        <button type="button" class="btn btn-outline" data-action="reset-change-form">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="change-password"><i class="fas fa-shield-halved"></i> Update Password</button>
      </div>
    `;
  }

  // --- Forgot Password ---
  function resetTabContent() {
    return `
      <div style="text-align:center;margin-bottom:22px">
        <div style="width:56px;height:56px;border-radius:50%;background:#eff6ff;color:var(--blue);display:inline-flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:12px">
          <i class="fas fa-envelope"></i>
        </div>
        <h4 style="font-family:'Manrope',sans-serif;font-size:16px;font-weight:700;margin:0 0 4px;color:var(--text)">Forgot your password?</h4>
        <p style="font-size:13px;color:var(--text-2);margin:0;max-width:340px;margin-left:auto;margin-right:auto;line-height:1.55">
          Enter the email address on your account. We'll send a password reset link.
        </p>
      </div>
      <div class="field" style="margin-bottom:18px">
        <label>Email Address <span class="req">*</span></label>
        <input type="email" id="rsEmail" placeholder="you@example.com" autocomplete="email" />
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px">
        <button type="button" class="btn btn-outline" data-action="switch-tab" data-tab="change">Cancel</button>
        <button type="button" class="btn btn-primary" data-action="send-reset-link"><i class="fas fa-paper-plane"></i> Send Reset Link</button>
      </div>
    `;
  }

  // --- Main Panel ---
  function securityPanel() {
    return `
      <div class="panel">
        <div class="panel-header"><h3><i class="fas fa-shield-halved"></i> Password & Security</h3></div>
        <div class="panel-body">
          <div class="tabs" style="margin-bottom:22px">
            <button type="button" class="tab ${activeTab === 'change' ? 'active' : ''}" data-action="switch-tab" data-tab="change"><i class="fas fa-key" style="margin-right:6px"></i> Change Password</button>
            <button type="button" class="tab ${activeTab === 'reset' ? 'active' : ''}" data-action="switch-tab" data-tab="reset"><i class="fas fa-envelope" style="margin-right:6px"></i> Forgot Password</button>
          </div>
          <div id="securityTabContent">
            ${activeTab === 'change' ? changeTabContent() : resetTabContent()}
          </div>
        </div>
      </div>
    `;
  }

  // --- Sessions Panel ---
  function sessionsPanel(user) {
    var ua = (navigator && navigator.userAgent) ? navigator.userAgent : '';
    var info = parseDevice(ua);

    return `
      <div class="panel">
        <div class="panel-header">
          <h3><i class="fas fa-laptop"></i> Active Sessions</h3>
          <span class="badge" style="font-size:11px;color:var(--text-3);background:var(--surface-2);padding:3px 9px;border-radius:6px">1 active</span>
        </div>
        <div class="panel-body" style="padding:0">
          <div style="display:flex;gap:14px;align-items:flex-start;padding:18px 22px">
            <div style="width:44px;height:44px;border-radius:11px;background:#ecfdf5;color:var(--green);display:inline-flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
              <i class="fas ${esc(info.icon)}"></i>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:14px;color:var(--text);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                This device <span class="pill Delivered" style="font-size:10px">Active now</span>
              </div>
              <div style="font-size:12.5px;color:var(--text-2);margin-top:4px;line-height:1.5">
                ${esc(info.browser)} on ${esc(info.os)}
              </div>
            </div>
          </div>
          <div style="padding:14px 22px;border-top:1px solid var(--border-2);display:flex;justify-content:flex-end">
            <button type="button" class="btn btn-danger" data-action="sign-out-all"><i class="fas fa-right-from-bracket"></i> Sign out of all devices</button>
          </div>
        </div>
      </div>
    `;
  }

  function parseDevice(ua) {
    if (!ua) return { browser: 'Unknown', os: 'Unknown', icon: 'fa-question' };
    var s = String(ua);
    var browser = 'Browser', icon = 'fa-globe';
    if (s.indexOf('Edg/') >= 0) { browser = 'Edge'; icon = 'fa-edge'; }
    else if (s.indexOf('Chrome/') >= 0) { browser = 'Chrome'; icon = 'fa-chrome'; }
    else if (s.indexOf('Firefox/') >= 0) { browser = 'Firefox'; icon = 'fa-firefox'; }
    else if (s.indexOf('Safari/') >= 0) { browser = 'Safari'; icon = 'fa-safari'; }

    var os = 'Unknown OS';
    if (s.indexOf('Windows') >= 0) os = 'Windows';
    else if (s.indexOf('Mac OS') >= 0) os = 'macOS';
    else if (s.indexOf('Linux') >= 0) os = 'Linux';
    else if (s.indexOf('Android') >= 0) os = 'Android';
    else if (s.indexOf('iPhone') >= 0 || s.indexOf('iPad') >= 0) os = 'iOS';

    return { browser: browser, os: os, icon: icon };
  }

  // --- Tips Panel ---
  function tipsPanel() {
    var tips = [
      { icon: 'fa-key', title: 'Use a long passphrase', desc: 'Aim for 12+ characters.' },
      { icon: 'fa-fingerprint', title: 'Never reuse passwords', desc: 'Each account should have a unique password.' },
      { icon: 'fa-vault', title: 'Use a password manager', desc: 'Bitwarden, 1Password, etc.' },
      { icon: 'fa-envelope-circle-check', title: 'Watch for phishing', desc: 'We never ask for your password via email.' }
    ];

    return `
      <div class="panel">
        <div class="panel-header"><h3><i class="fas fa-lightbulb"></i> Security Tips</h3></div>
        <div class="panel-body" style="padding:0">
          ${tips.map(t => `
            <div style="display:flex;gap:14px;padding:14px 22px;border-bottom:1px solid var(--border-2)">
              <div style="width:36px;height:36px;border-radius:10px;background:var(--surface-2);color:var(--text-2);display:inline-flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">
                <i class="fas ${esc(t.icon)}"></i>
              </div>
              <div>
                <div style="font-weight:600;font-size:13.5px;color:var(--text)">${esc(t.title)}</div>
                <div style="font-size:12.5px;color:var(--text-2);margin-top:2px;line-height:1.5">${esc(t.desc)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // --- Actions ---
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
      fill.style.background = result.color === 'green' ? 'var(--green)' : result.color === 'amber' ? 'var(--amber)' : 'var(--red)';
      if (!pw) {
        text.textContent = 'Password strength';
        text.style.color = '';
      } else {
        text.textContent = result.label + ' password';
        text.style.color = result.color === 'green' ? 'var(--green)' : result.color === 'amber' ? 'var(--amber)' : 'var(--red)';
      }
      if (req) req.innerHTML = requirementList(result);
    });
  }

  function switchTab(tab) {
    activeTab = tab;
    document.getElementById('securityTabContent').innerHTML = tab === 'change' ? changeTabContent() : resetTabContent();
    
    // Toggle active class
    var tabs = container.querySelectorAll('[data-action="switch-tab"]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].dataset.tab === activeTab);
    }
    if (activeTab === 'change') wireMeter('cpNew', 'cpMeterFill', 'cpMeterText', 'cpRequirements');
  }

  async function changePassword(ctx) {
    if (!window.supabaseClient) return;
    var current = gv('cpCurrent');
    var newPw = gv('cpNew');
    var confirm = gv('cpConfirm');

    if (!current || !newPw || !confirm) return toast('All fields required', '', 'error');
    if (newPw.length < 8) return toast('Password too short', 'Min 8 chars.', 'error');
    if (analyzePassword(newPw).passed < 4) return toast('Password too weak', 'Meet 4 of 5 requirements.', 'error');
    if (newPw !== confirm) return toast('Passwords do not match', '', 'error');

    try {
      const { error } = await window.supabaseClient.auth.updateUser({ password: newPw });
      if (error) throw error;
      toast('Success', 'Password updated.', 'success');
      resetChangeForm();
    } catch (err) {
      toast('Error', err.message, 'error');
    }
  }

  function resetChangeForm() {
    ['cpCurrent', 'cpNew', 'cpConfirm'].forEach(id => { var el = document.getElementById(id); if (el) el.value = ''; });
    var fill = document.getElementById('cpMeterFill');
    if (fill) fill.style.width = '0%';
    var text = document.getElementById('cpMeterText');
    if (text) text.textContent = 'Password strength';
  }

  async function sendResetLink() {
    if (!window.supabaseClient) return;
    var email = gv('rsEmail').trim();
    if (!email) return toast('Email required', '', 'error');

    try {
      const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/portal.html?reset=true'
      });
      if (error) throw error;
      toast('Link sent', 'Check your email for the reset link.', 'success');
      switchTab('change');
    } catch (err) {
      toast('Error', err.message, 'error');
    }
  }

  async function performSignOutAll() {
    if (!window.supabaseClient) return;
    try {
      await window.supabaseClient.auth.signOut({ scope: 'global' });
      window.location.replace('portal.html');
    } catch (err) {
      toast('Error', 'Failed to sign out.', 'error');
    }
  }

  // --- Render ---
  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';
    activeTab = 'change';

    return `
      ${securityPanel()}
      ${sessionsPanel(user)}
      ${tipsPanel()}
    `;
  }

  // --- Bind ---
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (handler) container.removeEventListener('click', handler);
    handler = function (e) {
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'toggle-pw') { togglePw(btn.dataset.target, btn); return; }
      if (action === 'switch-tab') { switchTab(btn.dataset.tab); return; }
      if (action === 'reset-change-form') { resetChangeForm(); return; }
      if (action === 'change-password') { changePassword(ctx); return; }
      if (action === 'send-reset-link') { sendResetLink(); return; }
      if (action === 'sign-out-all') { performSignOutAll(); return; }
    };
    container.addEventListener('click', handler);

    if (activeTab === 'change') {
      wireMeter('cpNew', 'cpMeterFill', 'cpMeterText', 'cpRequirements');
    }
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null; handler = null;
    activeTab = 'change';
  }

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