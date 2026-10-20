/* ================================================================
   GlobalExpress — Admin Settings Page
   ================================================================
   Platform configuration: shipping fee, currency label, deposit
   and withdrawal limits, support contact info, feature flags.

   Layout:
     - 4 sections: Shipping, Wallet Limits, Support Contact, Features
     - Each section is a list of .settings-row items
     - Save button at the bottom writes ge_settings + audit log
     - Reset button restores the CURRENT persisted values (not defaults)

   Every save:
     - writes ge_settings
     - calls Admin.logAudit('settings.save', ...)
     - emits settings:changed via Realtime.notifyLocalChange
     - refreshes Admin.state.settings cache

   Registers with Admin.register('settings', page).
   ================================================================ */

(function (global) {
  'use strict';

  /* ================================================================
     §1 — DEPENDENCIES
     ================================================================ */
  var Utils    = global.Utils    || {};
  var UI       = global.UI       || {};
  var Realtime = global.Realtime || {};
  var Admin    = global.Admin    || null;

  /* ================================================================
     §2 — FALLBACKS
     ================================================================ */

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var money = Utils.money || function (n) {
    return 'Fr. ' + Number(n || 0).toLocaleString();
  };

  var toast = UI.toast || function (t, m, k) {
    if (global.console) console.log('[toast]', t, m || '', k || '');
  };

  var storage = (Utils.storage && typeof Utils.storage.get === 'function')
    ? Utils.storage
    : {
        get: function (k, fallback) {
          try {
            var raw = localStorage.getItem(k);
            return raw === null ? fallback : JSON.parse(raw);
          } catch (e) { return fallback; }
        },
        set: function (k, v) {
          try { localStorage.setItem(k, JSON.stringify(v)); return true; }
          catch (e) { return false; }
        }
      };

  /* ================================================================
     §3 — KEYS + DEFAULTS
     ================================================================ */

  var KEYS = {
    settings: 'ge_settings'
  };

  // These match DEFAULT_SETTINGS in admin.js. Keep in sync.
  var DEFAULTS = {
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

  /* ================================================================
     §4 — MODULE STATE
     ================================================================ */

  var handler   = null;
  var container = null;

  // Snapshot of the last-saved settings so "Reset" can revert.
  var savedSnapshot = null;

  /* ================================================================
     §5 — STORAGE HELPERS
     ================================================================ */

  function readSettings() {
    var stored = storage.get(KEYS.settings, null);
    if (!stored || typeof stored !== 'object') stored = {};

    var merged = {};
    for (var k in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) {
        merged[k] = Object.prototype.hasOwnProperty.call(stored, k)
          ? stored[k]
          : DEFAULTS[k];
      }
    }
    return merged;
  }

  function writeSettings(next) {
    return storage.set(KEYS.settings, next);
  }

  /* ================================================================
     §6 — AUDIT + EMIT
     ================================================================ */

  function auditAndEmit(action, target, details, extras) {
    if (Admin && typeof Admin.logAudit === 'function') {
      Admin.logAudit(action, target, details);
    }
    if (Realtime && typeof Realtime.notifyLocalChange === 'function') {
      Realtime.notifyLocalChange('settings:changed', { target: target });
    }
    if (extras && Realtime && typeof Realtime.notifyLocalChange === 'function') {
      for (var i = 0; i < extras.length; i++) {
        var ev = extras[i];
        if (ev && ev.name) {
          Realtime.notifyLocalChange(ev.name, ev.payload);
        }
      }
    }
  }

  /* ================================================================
     §7 — FORM HELPERS
     ================================================================ */

  function gvNum(id, fallback) {
    var el = document.getElementById(id);
    if (!el) return fallback;
    var n = parseInt(String(el.value || '').trim(), 10);
    return isNaN(n) ? fallback : n;
  }

  function gvStr(id, fallback) {
    var el = document.getElementById(id);
    if (!el) return fallback;
    var v = String(el.value || '').trim();
    return v === '' ? fallback : v;
  }

  function gvBool(id, fallback) {
    var el = document.getElementById(id);
    if (!el) return fallback;
    return el.checked === true;
  }

  /* ================================================================
     §8 — VALIDATION
     Returns an object { fieldId, message } or null.
     ================================================================ */

  function validate(s) {
    if (s.shippingFee < 0) {
      return { fieldId: 'setShippingFee', message: 'Shipping fee cannot be negative.' };
    }
    if (s.minDeposit < 0) {
      return { fieldId: 'setMinDeposit', message: 'Minimum deposit cannot be negative.' };
    }
    if (s.maxDeposit < s.minDeposit) {
      return { fieldId: 'setMaxDeposit', message: 'Maximum deposit must be ≥ minimum deposit.' };
    }
    if (s.minWithdrawal < 0) {
      return { fieldId: 'setMinWithdrawal', message: 'Minimum withdrawal cannot be negative.' };
    }
    if (!s.supportEmail || s.supportEmail.indexOf('@') < 0) {
      return { fieldId: 'setSupportEmail', message: 'Enter a valid support email.' };
    }
    if (!s.currencyLabel) {
      return { fieldId: 'setCurrencyLabel', message: 'Currency label is required.' };
    }
    return null;
  }

  /* ================================================================
     §9 — RENDER HELPERS
     ================================================================ */

  function settingsRow(opts) {
    // opts: { title, description, controlHtml }
    return ''
      + '<div class="settings-row">'
      +   '<div class="info">'
      +     '<h4>' + esc(opts.title) + '</h4>'
      +     (opts.description
              ? '<p>' + esc(opts.description) + '</p>'
              : '')
      +   '</div>'
      +   '<div class="control">' + opts.controlHtml + '</div>'
      + '</div>';
  }

  function numControl(id, value, min, max, step) {
    return '<input type="number" id="' + esc(id) + '" '
         + 'value="' + esc(String(value)) + '" '
         + (min != null ? 'min="' + esc(String(min)) + '" ' : '')
         + (max != null ? 'max="' + esc(String(max)) + '" ' : '')
         + (step != null ? 'step="' + esc(String(step)) + '" ' : '')
         + '/>';
  }

  function textControl(id, value, maxLength) {
    return '<input type="text" id="' + esc(id) + '" '
         + 'value="' + esc(String(value || '')) + '" '
         + (maxLength ? 'maxlength="' + maxLength + '" ' : '')
         + '/>';
  }

  function toggleControl(id, checked, label) {
    return '<label class="switch">'
         +   '<input type="checkbox" id="' + esc(id) + '"'
         +     (checked ? ' checked' : '') + ' />'
         +   '<span class="track"></span>'
         +   '<span>' + esc(checked ? 'On' : 'Off') + '</span>'
         + '</label>';
  }

  /* ================================================================
     §10 — MAIN RENDER
     ================================================================ */

  function render(ctx) {
    var s = readSettings();

    // Take a snapshot of the persisted values so "Reset" can revert.
    savedSnapshot = Object.assign({}, s);

    return ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-sliders"></i> Platform Settings</h3>'
      +     '<span style="font-size:12px;color:var(--text-3)">'
      +       'Changes apply to the entire platform'
      +     '</span>'
      +   '</div>'

      +   '<div class="settings-form">'

      // --- SHIPPING ---
      +     '<div class="settings-section">'
      +       '<h4 class="settings-section-title">'
      +         '<i class="fas fa-truck-fast"></i> Shipping'
      +       '</h4>'
      +       '<p class="settings-section-sub">'
      +         'Default rates and pricing applied to new shipments.'
      +       '</p>'

      +       settingsRow({
              title: 'Shipping Fee',
              description: 'Default fee charged for a standard shipment, in Fr.',
              controlHtml: numControl('setShippingFee', s.shippingFee, 0, null, 1)
            })

      +       settingsRow({
              title: 'Currency Label',
              description: 'Displayed next to all monetary values across the platform.',
              controlHtml: textControl('setCurrencyLabel', s.currencyLabel, 8)
            })

      +     '</div>'

      // --- WALLET LIMITS ---
      +     '<div class="settings-section">'
      +       '<h4 class="settings-section-title">'
      +         '<i class="fas fa-wallet"></i> Wallet Limits'
      +       '</h4>'
      +       '<p class="settings-section-sub">'
      +         'Minimum and maximum amounts customers can move through their wallet.'
      +       '</p>'

      +       settingsRow({
              title: 'Minimum Deposit',
              description: 'Smallest amount a customer can deposit at once.',
              controlHtml: numControl('setMinDeposit', s.minDeposit, 0, null, 1)
            })

      +       settingsRow({
              title: 'Maximum Deposit',
              description: 'Largest amount a customer can deposit at once.',
              controlHtml: numControl('setMaxDeposit', s.maxDeposit, 0, null, 1)
            })

      +       settingsRow({
              title: 'Minimum Withdrawal',
              description: 'Smallest amount a customer can withdraw.',
              controlHtml: numControl('setMinWithdrawal', s.minWithdrawal, 0, null, 1)
            })

      +     '</div>'

      // --- SUPPORT ---
      +     '<div class="settings-section">'
      +       '<h4 class="settings-section-title">'
      +         '<i class="fas fa-headset"></i> Support Contact'
      +       '</h4>'
      +       '<p class="settings-section-sub">'
      +         'Displayed on the customer support page and receipt footers.'
      +       '</p>'

      +       settingsRow({
              title: 'Support Email',
              description: 'Where customer replies and system alerts are sent.',
              controlHtml: textControl('setSupportEmail', s.supportEmail, 120)
            })

      +       settingsRow({
              title: 'Support Phone',
              description: 'Displayed on the customer support page.',
              controlHtml: textControl('setSupportPhone', s.supportPhone, 40)
            })

      +     '</div>'

      // --- FEATURES ---
      +     '<div class="settings-section">'
      +       '<h4 class="settings-section-title">'
      +         '<i class="fas fa-toggle-on"></i> Feature Flags'
      +       '</h4>'
      +       '<p class="settings-section-sub">'
      +         'Enable or disable optional platform features.'
      +       '</p>'

      +       settingsRow({
              title: 'Referrals',
              description: 'Allow customers to earn rewards for inviting friends.',
              controlHtml: toggleControl('setEnableReferrals', s.enableReferrals)
            })

      +       settingsRow({
              title: 'Two-Factor Authentication',
              description: 'Require customers to verify a one-time code at sign-in.',
              controlHtml: toggleControl('setEnable2FA', s.enable2FA)
            })

      +       settingsRow({
              title: 'Crypto Payments',
              description: 'Accept BTC, ETH, and USDT as payment methods.',
              controlHtml: toggleControl('setEnableCrypto', s.enableCrypto)
            })

      +     '</div>'

      +   '</div>'

      +   '<div class="settings-actions">'
      +     '<button type="button" class="btn btn-ghost" data-action="reset-defaults">'
      +       '<i class="fas fa-rotate-left"></i> Reset to Defaults'
      +     '</button>'
      +     '<button type="button" class="btn btn-outline" style="margin-left:auto" data-action="revert">'
      +       'Revert Changes'
      +     '</button>'
      +     '<button type="button" class="btn btn-primary" data-action="save">'
      +       '<i class="fas fa-save"></i> Save Settings'
      +     '</button>'
      +   '</div>'
      + '</div>'

      // Info card: shows whether the settings cache is in sync
      + '<div class="panel">'
      +   '<div class="panel-body" '
      +     'style="display:flex;gap:14px;align-items:flex-start">'
      +     '<div style="width:36px;height:36px;border-radius:9px;'
      +       'background:#eff6ff;color:var(--blue);flex-shrink:0;'
      +       'display:inline-flex;align-items:center;justify-content:center;'
      +       'font-size:15px">'
      +       '<i class="fas fa-circle-info"></i>'
      +     '</div>'
      +     '<div style="flex:1;min-width:0">'
      +       '<div style="font-weight:600;font-size:13.5px;color:var(--text);margin-bottom:4px">'
      +         'Where these settings are used'
      +       '</div>'
      +       '<div style="font-size:12.5px;color:var(--text-2);line-height:1.6">'
      +         'Shipping fee is charged in '
      +         '<strong>Create Shipment</strong>. Wallet limits are enforced in '
      +         '<strong>Deposit</strong> and <strong>Withdraw</strong>. Support contact '
      +         'appears on the customer <strong>Support</strong> page. Feature flags '
      +         'toggle optional flows on the customer app.'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  /* ================================================================
     §11 — FORM HELPERS: READ ALL
     ================================================================ */

  function readFormValues() {
    return {
      shippingFee:     gvNum('setShippingFee',     DEFAULTS.shippingFee),
      currencyLabel:   gvStr('setCurrencyLabel',   DEFAULTS.currencyLabel),
      minDeposit:      gvNum('setMinDeposit',      DEFAULTS.minDeposit),
      maxDeposit:      gvNum('setMaxDeposit',      DEFAULTS.maxDeposit),
      minWithdrawal:   gvNum('setMinWithdrawal',   DEFAULTS.minWithdrawal),
      supportEmail:    gvStr('setSupportEmail',    DEFAULTS.supportEmail),
      supportPhone:    gvStr('setSupportPhone',    DEFAULTS.supportPhone),
      enableReferrals: gvBool('setEnableReferrals', DEFAULTS.enableReferrals),
      enable2FA:       gvBool('setEnable2FA',       DEFAULTS.enable2FA),
      enableCrypto:    gvBool('setEnableCrypto',    DEFAULTS.enableCrypto)
    };
  }

  function writeFormValues(s) {
    setVal('setShippingFee',     s.shippingFee);
    setVal('setCurrencyLabel',   s.currencyLabel);
    setVal('setMinDeposit',      s.minDeposit);
    setVal('setMaxDeposit',      s.maxDeposit);
    setVal('setMinWithdrawal',   s.minWithdrawal);
    setVal('setSupportEmail',    s.supportEmail);
    setVal('setSupportPhone',    s.supportPhone);
    setChecked('setEnableReferrals', s.enableReferrals);
    setChecked('setEnable2FA',       s.enable2FA);
    setChecked('setEnableCrypto',    s.enableCrypto);

    // Refresh the ON/OFF labels next to each switch
    ['setEnableReferrals', 'setEnable2FA', 'setEnableCrypto'].forEach(function (id) {
      var cb = document.getElementById(id);
      if (cb && cb.parentNode) {
        var labelSpan = cb.parentNode.querySelector('span:not(.track)');
        if (labelSpan) labelSpan.textContent = cb.checked ? 'On' : 'Off';
      }
    });
  }

  function setVal(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = String(value == null ? '' : value);
  }

  function setChecked(id, value) {
    var el = document.getElementById(id);
    if (el) el.checked = !!value;
  }

  /* ================================================================
     §12 — DIFF (for the audit details)
     ================================================================ */

  function buildDiff(before, after) {
    var changes = [];
    var keys = Object.keys(DEFAULTS);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var a = before[k];
      var b = after[k];
      if (a !== b) {
        changes.push(k + ': ' + formatVal(a) + ' → ' + formatVal(b));
      }
    }
    return changes.length ? changes.join('; ') : 'No changes';
  }

  function formatVal(v) {
    if (v === true) return 'on';
    if (v === false) return 'off';
    if (v === null || v === undefined) return '—';
    return String(v);
  }

  /* ================================================================
     §13 — ACTIONS
     ================================================================ */

  function doSave() {
    var current = readSettings();          // before
    var next = readFormValues();           // after

    var err = validate(next);
    if (err) {
      toast('Check your settings', err.message, 'error');
      var field = document.getElementById(err.fieldId);
      if (field && typeof field.focus === 'function') field.focus();
      return;
    }

    var diff = buildDiff(current, next);
    if (diff === 'No changes') {
      toast('No changes', 'Everything is already saved.', 'info');
      return;
    }

    // 1. Persist
    writeSettings(next);

    // 2. Update Admin's cache so pages read the fresh values
    if (Admin) {
      if (typeof Admin.saveSettings === 'function') {
        // Admin.saveSettings also writes + emits; but we already wrote.
        // Instead, just refresh the cache via getSettings.
        Admin.state.settings = next;
      } else {
        Admin.state.settings = next;
      }
    }

    // 3. Audit + emit
    auditAndEmit(
      'settings.save',
      'platform',
      diff
    );

    // 4. Update snapshot
    savedSnapshot = Object.assign({}, next);

    toast('Settings saved', 'Changes are live across the platform.', 'success');
  }

  function doRevert() {
    if (!savedSnapshot) return;

    writeFormValues(savedSnapshot);

    // Refresh switch labels
    ['setEnableReferrals', 'setEnable2FA', 'setEnableCrypto'].forEach(function (id) {
      var cb = document.getElementById(id);
      if (cb && cb.parentNode) {
        var labelSpan = cb.parentNode.querySelector('span:not(.track)');
        if (labelSpan) labelSpan.textContent = cb.checked ? 'On' : 'Off';
      }
    });

    toast('Changes reverted', 'Form restored to the last saved values.', 'info');
  }

  function doResetDefaults() {
    var applyDefaults = function () {
      writeFormValues(DEFAULTS);

      // Refresh switch labels
      ['setEnableReferrals', 'setEnable2FA', 'setEnableCrypto'].forEach(function (id) {
        var cb = document.getElementById(id);
        if (cb && cb.parentNode) {
          var labelSpan = cb.parentNode.querySelector('span:not(.track)');
          if (labelSpan) labelSpan.textContent = cb.checked ? 'On' : 'Off';
        }
      });

      toast('Defaults restored', 'Click Save to apply them.', 'info');
    };

    if (UI.confirm) {
      UI.confirm({
        title:       'Reset to defaults?',
        message:     'This fills the form with the platform default values. You still need to click Save to persist them.',
        confirmText: 'Reset form',
        variant:     'warning'
      }).then(function (ok) { if (ok) applyDefaults(); });
    } else if (global.confirm) {
      if (global.confirm('Reset the form to defaults?')) applyDefaults();
    }
  }

  /* ================================================================
     §14 — BIND
     ================================================================ */

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (handler) container.removeEventListener('click', handler);

    handler = function (e) {
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;

      var action = btn.dataset.action;

      if (action === 'save')           { doSave(); return; }
      if (action === 'revert')         { doRevert(); return; }
      if (action === 'reset-defaults') { doResetDefaults(); return; }
    };

    container.addEventListener('click', handler);

    // Live-update toggle labels as the checkbox changes
    ['setEnableReferrals', 'setEnable2FA', 'setEnableCrypto'].forEach(function (id) {
      var cb = document.getElementById(id);
      if (!cb || cb.__wired) return;
      cb.addEventListener('change', function () {
        if (cb.parentNode) {
          var labelSpan = cb.parentNode.querySelector('span:not(.track)');
          if (labelSpan) labelSpan.textContent = cb.checked ? 'On' : 'Off';
        }
      });
      cb.__wired = true;
    });

    // Warn on navigate-away if there are unsaved changes
    // (best effort — router doesn't have a beforeunload hook)
    wireDirtyCheck();
  }

  function wireDirtyCheck() {
    // Simple: tag the page as dirty if any input changes. Not
    // enforced by the router, but shows in the browser's
    // native "leave site?" prompt during a full page reload.
    var dirty = false;
    function markDirty() { dirty = true; }

    var ids = [
      'setShippingFee', 'setCurrencyLabel',
      'setMinDeposit', 'setMaxDeposit', 'setMinWithdrawal',
      'setSupportEmail', 'setSupportPhone',
      'setEnableReferrals', 'setEnable2FA', 'setEnableCrypto'
    ];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el.__dirtyWired) return;
      el.addEventListener('input', markDirty);
      el.addEventListener('change', markDirty);
      el.__dirtyWired = true;
    });

    // The beforeunload listener is optional and non-blocking;
    // we just leave a small hint in case the admin is about to
    // lose work. The browser decides whether to show a prompt.
    if (!global.__adminSettingsBeforeUnload) {
      global.__adminSettingsBeforeUnload = true;
      global.addEventListener('beforeunload', function (ev) {
        if (!dirty) return;
        // Modern browsers ignore custom messages but showing
        // returnValue triggers the native prompt.
        ev.preventDefault();
        ev.returnValue = '';
        return '';
      });
    }
  }

  /* ================================================================
     §15 — CLEANUP
     ================================================================ */

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler   = null;
    savedSnapshot = null;

    if (UI.closeAllModals) UI.closeAllModals();
  }

  /* ================================================================
     §16 — REGISTER
     ================================================================ */

  var page = {
    title:    'Settings',
    subtitle: 'Platform configuration',
    render:   render,
    bind:     bind,
    cleanup:  cleanup
  };

  if (global.Admin && typeof global.Admin.register === 'function') {
    global.Admin.register('settings', page);
  } else {
    global.PagesAdmin = global.PagesAdmin || {};
    global.PagesAdmin.settings = page;
  }

})(window);