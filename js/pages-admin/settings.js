/* ================================================================
   GlobalExpress — Admin Page: Settings (Supabase)
   File: js/settings.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var toast = UI.toast || function (t, m) { if (global.console) console.log(t, m); };

  var state = {
    settings: {},
    isLoading: true
  };

  var pageHandler = null;
  var pageContainer = null;

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  async function loadData() {
    if (!window.supabaseClient) return;
    state.isLoading = true;
    try {
      const { data, error } = await window.supabaseClient
        .schema('config')
        .from('settings')
        .select('*');

      if (error) throw error;
      
      // Convert array of {key, value} into a single object {shippingFee: 4000, ...}
      var map = {};
      (data || []).forEach(function(row) {
        map[row.key] = row.value;
      });
      state.settings = map;

    } catch (err) {
      console.error('Failed to load settings:', err);
      toast('Error', 'Failed to load settings', 'error');
    } finally {
      state.isLoading = false;
      document.getElementById('content').innerHTML = render();
      bind();
    }
  }

  // ================================================================
  // HELPERS
  // ================================================================
  function renderRow(label, desc, settingKey, type) {
    var val = state.settings[settingKey];
    if (val === undefined || val === null) val = '';
    
    var inputStyle = 'padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13.5px;width:100%;max-width:300px;';
    var inputHtml = '';

    if (type === 'boolean') {
      var checked = val === true ? 'checked' : '';
      inputHtml = '<label class="switch" style="cursor:pointer"><input type="checkbox" data-setting="'+settingKey+'" '+checked+'><span class="track"></span></label>';
    } else if (type === 'number') {
      inputHtml = '<input type="number" data-setting="'+settingKey+'" value="'+esc(val)+'" style="'+inputStyle+'">';
    } else {
      inputHtml = '<input type="text" data-setting="'+settingKey+'" value="'+esc(val)+'" style="'+inputStyle+'">';
    }

    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-bottom:1px solid var(--border);gap:20px">' +
      '<div style="flex:1">' +
        '<div style="font-weight:600;font-size:14px;color:var(--text);">'+esc(label)+'</div>' +
        '<div style="font-size:12.5px;color:var(--text-2);margin-top:4px;">'+esc(desc)+'</div>' +
      '</div>' +
      '<div style="flex-shrink:0">' + inputHtml + '</div>' +
    '</div>';
  }

  function renderSection(title, icon, content) {
    return '<div class="panel" style="margin-bottom:20px">' +
      '<div class="panel-header"><h3><i class="fas '+icon+'"></i> '+title+'</h3></div>' +
      '<div class="panel-body" style="padding:0 20px">' + content + '</div>' +
    '</div>';
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render() {
    if (state.isLoading) {
      return '<div class="panel" style="padding:60px;text-align:center;color:var(--text-3)"><i class="fas fa-circle-notch fa-spin" style="font-size:24px;margin-bottom:16px"></i><p>Loading settings...</p></div>';
    }

    var general = 
      renderRow('Platform Name', 'The public name of the application', 'platformName', 'text') +
      renderRow('Support Email', 'Public email for customer inquiries', 'supportEmail', 'text') +
      renderRow('Support Phone', 'Public phone number', 'supportPhone', 'text') +
      renderRow('Maintenance Mode', 'If enabled, the customer app will be locked.', 'maintenanceMode', 'boolean');

    var pricing =
      renderRow('Shipping Fee', 'Base fee for creating a shipment (XAF)', 'shippingFee', 'number') +
      renderRow('Currency Label', 'Display symbol for prices', 'currencyLabel', 'text') +
      renderRow('Min Deposit', 'Lowest allowed deposit amount', 'minDeposit', 'number') +
      renderRow('Max Deposit', 'Highest allowed deposit amount', 'maxDeposit', 'number');

    var features =
      renderRow('Enable Referrals', 'Allow users to invite others', 'enableReferrals', 'boolean') +
      renderRow('Enable Crypto Payments', 'Accept cryptocurrency for deposits', 'enableCrypto', 'boolean');

    return '<div class="settings-page" style="max-width:900px;margin:0 auto;">' +
      '<div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">' +
        '<div><h2>Platform Settings</h2><p class="page-subtitle">Configure global platform behavior.</p></div>' +
        '<button type="button" class="btn btn-primary" id="btn-save-settings"><i class="fas fa-save"></i> Save Changes</button>' +
      '</div>' +
      
      renderSection('General', 'fa-globe', general) +
      renderSection('Pricing & Limits', 'fa-tag', pricing) +
      renderSection('Feature Flags', 'fa-toggle-on', features) +
      
    '</div>';
  }

  // ================================================================
  // ACTIONS
  // ================================================================
  async function handleSave() {
    var btn = document.getElementById('btn-save-settings');
    var originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving...';
    btn.disabled = true;

    try {
      var inputs = document.querySelectorAll('[data-setting]');
      var updates = [];

      inputs.forEach(function(input) {
        var key = input.dataset.setting;
        var val;
        if (input.type === 'checkbox') val = input.checked;
        else if (input.type === 'number') val = Number(input.value);
        else val = input.value;

        // Only update if changed
        if (state.settings[key] !== val) {
          updates.push({ key: key, value: val });
        }
      });

      if (updates.length === 0) {
        toast('No changes', 'Settings are already up to date.', 'info');
        return;
      }

      // Update Supabase (upsert)
      for (var i = 0; i < updates.length; i++) {
        var u = updates[i];
        const { error } = await window.supabaseClient
          .schema('config')
          .from('settings')
          .upsert({ key: u.key, value: u.value, updated_at: new Date().toISOString() });
        
        if (error) throw error;
      }

      // Update local state
      updates.forEach(function(u) { state.settings[u.key] = u.value; });
      toast('Success', 'Settings saved successfully.', 'success');

    } catch (err) {
      console.error('Save failed:', err);
      toast('Error', err.message || 'Failed to save settings.', 'error');
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  function bind() {
    pageContainer = document.getElementById('content');
    if (!pageContainer) return;
    if (pageHandler) pageContainer.removeEventListener('click', pageHandler);

    pageHandler = function(e) {
      if (e.target.closest('#btn-save-settings')) {
        handleSave();
      }
    };
    pageContainer.addEventListener('click', pageHandler);
  }

  function cleanup() {
    if (pageContainer && pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageContainer = null;
    pageHandler = null;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin.settings = {
    title: 'Settings',
    subtitle: 'Configure global platform behavior',
    render: render,
    bind: function() { loadData(); }, // Bind triggers load
    cleanup: cleanup
  };

})(window);