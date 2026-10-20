/* ================================================================
   GlobalExpress — Admin Page: Settings (Enterprise Edition)
   ================================================================
   Fixes: A6, A11, A15, A16.
   Features: Professional UI, Security & Password Management,
             Notification preferences, and Maintenance mode.
   ================================================================ */

(function (global) {
  'use strict';

  var Utils  = global.Utils  || {};
  var UI     = global.UI     || {};
  var Config = global.AdminConfig || {};
  var Admin  = global.Admin  || null;

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var toast = UI.toast || function (t,m) { if (global.console) console.log(t, m); };

  var KEYS = { settings: 'ge_settings', users: 'ge_users' };

  var state = {
    settings: null,
    isDirty: false
  };

  var pageHandler = null;
  var pageContainer = null;

  function read(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  function readSettings() {
    var stored = read(KEYS.settings, {});
    
    var defaults = (Admin && Admin.DEFAULT_SETTINGS) || {
      platformName: 'GlobalExpress',
      timezone: 'UTC',
      shippingFee: 4000,
      currencyLabel: 'Fr.',
      minDeposit: 500,
      maxDeposit: 500000,
      minWithdrawal: 500,
      enableReferrals: true,
      enable2FA: false,
      enableCrypto: false,
      supportEmail: 'support@globalexpress.test',
      supportPhone: '+237 6XX XXX XXX',
      maintenanceMode: false,
      sessionTimeoutMins: 60,
      maxLoginAttempts: 5,
      emailAlertsShipments: true,
      emailAlertsTickets: true
    };

    var merged = {};
    for (var k in defaults) {
      merged[k] = stored[k] !== undefined ? stored[k] : defaults[k];
    }
    for (var j in stored) {
      if (merged[j] === undefined) merged[j] = stored[j];
    }
    return merged;
  }

  // ==== RENDER HELPERS ====

  function renderHeader() {
    return '<div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px">' +
      '<div><h2>Platform Settings</h2><p class="page-subtitle">Configure global platform behavior and security.</p></div>' +
      '<div class="page-actions" style="display:flex;gap:10px;align-items:center">' +
        '<span id="settingsDirtyBadge" style="display:none;font-size:12.5px;color:var(--amber);font-weight:600;background:#fffbeb;padding:6px 12px;border-radius:20px">' +
          '<i class="fas fa-circle-exclamation"></i> Unsaved changes' +
        '</span>' +
        '<button type="button" class="btn btn-primary btn-sm" id="settings-save-all">' +
          '<i class="fas fa-save"></i> Save All Changes</button>' +
      '</div></div>';
  }

  function renderSection(title, icon, content) {
    return '<div class="panel" style="margin-bottom:20px">' +
      '<div class="panel-header"><h3><i class="fas ' + icon + '"></i> ' + title + '</h3></div>' +
      '<div class="panel-body settings-form">' + content + '</div>' +
    '</div>';
  }

  function renderRow(label, desc, inputHtml, actionHtml) {
    return '<div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-bottom:1px solid var(--adm-border);gap:20px">' +
      '<div class="info" style="flex:1">' +
        '<h4 style="margin:0 0 4px;font-size:14px;font-weight:600">' + esc(label) + '</h4>' +
        (desc ? '<p style="margin:0;font-size:12.5px;color:var(--text-2)">' + esc(desc) + '</p>' : '') +
      '</div>' +
      '<div class="control" style="flex-shrink:0;display:flex;align-items:center;gap:10px;">' + (actionHtml || '') + inputHtml + '</div>' +
    '</div>';
  }

  function renderSwitch(id, checked) {
    return '<label class="switch" style="cursor:pointer">' +
      '<input type="checkbox" data-setting="' + id + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="track"></span>' +
    '</label>';
  }

  function renderInput(id, type, val, placeholder) {
    var inputStyle = 'padding:8px 12px;border:1px solid var(--adm-border);border-radius:8px;font-family:inherit;font-size:13.5px;width:220px;';
    if (type === 'number') {
      return '<input type="number" data-setting="' + id + '" value="' + esc(val) + '" placeholder="' + esc(placeholder||'') + '" style="' + inputStyle + '">';
    }
    return '<input type="' + (type||'text') + '" data-setting="' + id + '" value="' + esc(val) + '" placeholder="' + esc(placeholder||'') + '" style="' + inputStyle + '">';
  }

  // ==== SECTION RENDERERS ====

  function renderGeneral() {
    var s = state.settings;
    return renderRow('Platform Name', 'The public name of the application',
      renderInput('platformName', 'text', s.platformName, 'GlobalExpress')) +
    renderRow('Timezone', 'Default timezone for reporting and logs',
      renderInput('timezone', 'text', s.timezone, 'UTC')) +
    renderRow('Maintenance Mode', 'If enabled, the customer portal will be locked.',
      renderSwitch('maintenanceMode', s.maintenanceMode));
  }

  function renderSecurity() {
    var s = state.settings;
    return renderRow('Change Admin Password', 'Update the password for your admin account.',
      '',
      '<button type="button" class="btn btn-outline btn-sm" data-action="change-password"><i class="fas fa-key"></i> Change Password</button>'
    ) +
    renderRow('Two-Factor Authentication (2FA)', 'Require a 6-digit code when signing in.',
      renderSwitch('enable2FA', s.enable2FA)) +
    renderRow('Session Timeout (Minutes)', 'Automatically sign out admins after inactivity.',
      renderInput('sessionTimeoutMins', 'number', s.sessionTimeoutMins, '60')) +
    renderRow('Max Login Attempts', 'Lock the account after this many failed attempts.',
      renderInput('maxLoginAttempts', 'number', s.maxLoginAttempts, '5'));
  }

  function renderPricing() {
    var s = state.settings;
    var sym = (Config && Config.CURRENCY && Config.CURRENCY.symbol) || 'Fr.';
    return renderRow('Shipping Fee', 'Base fee for creating a shipment (in ' + sym + ')',
      renderInput('shippingFee', 'number', s.shippingFee, '4000')) +
    renderRow('Currency Label', 'Display symbol for prices',
      renderInput('currencyLabel', 'text', s.currencyLabel, 'Fr.'));
  }

  function renderLimits() {
    var s = state.settings;
    return renderRow('Min Deposit', 'Lowest allowed deposit amount',
      renderInput('minDeposit', 'number', s.minDeposit, '500')) +
    renderRow('Max Deposit', 'Highest allowed deposit amount',
      renderInput('maxDeposit', 'number', s.maxDeposit, '500000')) +
    renderRow('Min Withdrawal', 'Lowest allowed withdrawal amount',
      renderInput('minWithdrawal', 'number', s.minWithdrawal, '500'));
  }

  function renderFeatures() {
    var s = state.settings;
    return renderRow('Enable Referrals', 'Allow users to invite others',
      renderSwitch('enableReferrals', s.enableReferrals)) +
    renderRow('Enable Crypto Payments', 'Accept cryptocurrency for deposits',
      renderSwitch('enableCrypto', s.enableCrypto));
  }

  function renderNotifications() {
    var s = state.settings;
    return renderRow('Shipment Alerts', 'Email me when a new shipment is created.',
      renderSwitch('emailAlertsShipments', s.emailAlertsShipments)) +
    renderRow('Support Ticket Alerts', 'Email me when a new support ticket is opened.',
      renderSwitch('emailAlertsTickets', s.emailAlertsTickets));
  }

  function renderSupport() {
    var s = state.settings;
    return renderRow('Support Email', 'Public email for customer inquiries',
      renderInput('supportEmail', 'email', s.supportEmail, 'support@globalexpress.test')) +
    renderRow('Support Phone', 'Public phone number',
      renderInput('supportPhone', 'text', s.supportPhone, '+237 6XX XXX XXX'));
  }

  // ==== MAIN RENDER ====

  function render(ctx) {
    state.settings = readSettings();
    state.isDirty = false;

    return '<div class="settings-page" style="max-width:1200px;margin:0 auto;">' +
      renderHeader() +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:20px;align-items:start">' +
        
        // Left Column
        '<div>' +
          renderSection('General & Maintenance', 'fa-globe', renderGeneral()) +
          renderSection('Security & Access', 'fa-shield-halved', renderSecurity()) +
          renderSection('Pricing', 'fa-tag', renderPricing()) +
        '</div>' +

        // Right Column
        '<div>' +
          renderSection('Limits', 'fa-sliders', renderLimits()) +
          renderSection('Feature Flags', 'fa-toggle-on', renderFeatures()) +
          renderSection('Email Notifications', 'fa-bell', renderNotifications()) +
          renderSection('Support Details', 'fa-headset', renderSupport()) +
        '</div>' +

      '</div>' +
    '</div>';
  }

  // ==== ACTIONS ====

  function collectFormData() {
    var patch = {};
    var inputs = document.querySelectorAll('[data-setting]');
    
    inputs.forEach(function(input) {
      var key = input.dataset.setting;
      var val;
      if (input.type === 'checkbox') val = input.checked;
      else if (input.type === 'number') val = Number(input.value);
      else val = input.value;
      
      patch[key] = val;
    });

    return patch;
  }

  function markDirty() {
    if (state.isDirty) return;
    state.isDirty = true;
    var badge = document.getElementById('settingsDirtyBadge');
    if (badge) badge.style.display = 'inline-block';
  }

  function handleSave() {
    var patch = collectFormData();
    var reason = 'Updated platform settings';

    var authLib = global.AdminAuth || (global.Admin && global.Admin.Auth);
    
    var doSave = function() {
      try {
        var existing = read(KEYS.settings, {});
        var merged = Object.assign({}, existing, patch);
        write(KEYS.settings, merged);
        
        if (Admin && Admin.logAudit) Admin.logAudit('settings.updated', 'ge_settings', reason);
        if (global.Realtime && global.Realtime.notifyLocalChange) global.Realtime.notifyLocalChange('settings:changed', merged);

        toast('Success', 'Settings saved successfully.', 'success');
        
        state.isDirty = false;
        var badge = document.getElementById('settingsDirtyBadge');
        if (badge) badge.style.display = 'none';
        
        if (global.Admin && global.Admin.go) global.Admin.go('settings');
      } catch(e) {
        toast('Error', 'Failed to save settings.', 'error');
      }
    };

    if (authLib && typeof authLib.requirePassword === 'function') {
      authLib.requirePassword(reason).then(function(ok) {
        if (ok) doSave();
      });
    } else {
      if (confirm('Save these settings?')) doSave();
    }
  }

  function handleChangePassword() {
    var users = asArray(read(KEYS.users, []));
    var admin = users.find(function(u) { return u.role === 'admin'; });
    if (!admin) return toast('Error', 'Admin account not found', 'error');

    var modal = UI.openModal(
      '<div class="modal narrow">' +
        '<div class="modal-head"><h3><i class="fas fa-key"></i> Change Admin Password</h3><button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button></div>' +
        '<div class="modal-body">' +
          '<div class="field" style="margin-bottom:14px;"><label>New Password</label><input type="password" id="newPass" placeholder="Enter new password" /></div>' +
          '<div class="field"><label>Confirm Password</label><input type="password" id="confPass" placeholder="Confirm new password" /></div>' +
        '</div>' +
        '<div class="modal-foot"><button type="button" class="btn btn-outline" data-close>Cancel</button><button type="button" class="btn btn-primary" id="savePass">Update Password</button></div>' +
      '</div>'
    );
    if (!modal) return;

    modal.querySelector('#savePass').onclick = function() {
      var p1 = modal.querySelector('#newPass').value;
      var p2 = modal.querySelector('#confPass').value;
      
      if (!p1 || p1.length < 6) return toast('Error', 'Password must be at least 6 characters', 'error');
      if (p1 !== p2) return toast('Error', 'Passwords do not match', 'error');

      admin.password = p1;
      write(KEYS.users, users);
      
      if (Admin && Admin.logAudit) Admin.logAudit('admin.password_changed', 'user:' + admin.email, 'Admin changed their own password');
      UI.closeModal(modal);
      toast('Success', 'Admin password updated successfully.', 'success');
    };
  }

  function bind(ctx) {
    pageContainer = document.getElementById('content');
    if (!pageContainer) return;

    if (pageHandler) pageContainer.removeEventListener('click', pageHandler);
    if (pageContainer.__settingsInputsWired) {
      pageContainer.removeEventListener('input', markDirty);
      pageContainer.removeEventListener('change', markDirty);
    }

    pageHandler = function (e) {
      if (e.target.closest('#settings-save-all')) {
        handleSave();
      }
      if (e.target.closest('[data-action="change-password"]')) {
        handleChangePassword();
      }
    };

    pageContainer.addEventListener('click', pageHandler);
    pageContainer.addEventListener('input', markDirty);
    pageContainer.addEventListener('change', markDirty);
    pageContainer.__settingsInputsWired = true;
  }

  function cleanup() {
    if (pageContainer && pageHandler) {
      pageContainer.removeEventListener('click', pageHandler);
      pageContainer.removeEventListener('input', markDirty);
      pageContainer.removeEventListener('change', markDirty);
    }
    pageContainer = null;
    pageHandler = null;
    state.isDirty = false;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin.settings = {
    title: 'Settings',
    subtitle: 'Configure global platform behavior',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);