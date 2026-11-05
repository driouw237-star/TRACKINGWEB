/* ================================================================
   GlobalExpress — Customer App: Addresses (Local Storage)
   File: js/pages/addresses.js
   ================================================================ */

(function (global) {
  'use strict';

  var Pages = global.Pages || {};
  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var toast = UI.toast || function (t, m, k) { if (global.console) console.log(t, m); };

  var state = {
    addresses: []
  };

  var container = null;
  var handler = null;

  // ================================================================
  // DATA MANAGEMENT
  // ================================================================
  function loadAddresses(user) {
    try {
      var raw = localStorage.getItem('ge_addresses_' + user.id);
      state.addresses = raw ? JSON.parse(raw) : [];
    } catch (e) {
      state.addresses = [];
    }
  }

  function saveAddresses(user) {
    try {
      localStorage.setItem('ge_addresses_' + user.id, JSON.stringify(state.addresses));
    } catch (e) {
      toast('Error', 'Failed to save addresses.', 'error');
    }
  }

  // ================================================================
  // ACTIONS
  // ================================================================
  function handleAddAddress(e) {
    e.preventDefault();
    var user = global.App.state.user;
    
    var label = document.getElementById('a_label').value.trim();
    var name = document.getElementById('a_name').value.trim();
    var phone = document.getElementById('a_phone').value.trim();
    var address = document.getElementById('a_address').value.trim();

    if (!label || !name || !address) {
      return toast('Missing Fields', 'Please fill in all required fields.', 'error');
    }

    var newAddress = {
      id: Date.now().toString(),
      label: label,
      name: name,
      phone: phone,
      address: address
    };

    state.addresses.push(newAddress);
    saveAddresses(user);
    toast('Success', 'Address saved.', 'success');

    // Re-render
    document.getElementById('content').innerHTML = render({ user: user });
    bind({ user: user });
  }

  function handleDelete(id) {
    if (!confirm('Are you sure you want to delete this address?')) return;
    
    var user = global.App.state.user;
    state.addresses = state.addresses.filter(function(a) { return a.id !== id; });
    saveAddresses(user);
    toast('Deleted', 'Address removed.', 'success');

    document.getElementById('content').innerHTML = render({ user: user });
    bind({ user: user });
  }

  // ================================================================
  // RENDER
  // ================================================================
  function render(ctx) {
    return `
      <div class="page-header" style="margin-bottom:24px;">
        <h2>Address Book</h2>
        <p class="page-subtitle">Save your frequent pickup and delivery locations.</p>
      </div>

      <div style="display:grid;grid-template-columns:1fr 2fr;gap:24px;align-items:start;">
        
        <!-- ADD FORM -->
        <div class="panel">
          <div class="panel-header"><h3><i class="fas fa-plus-circle"></i> Add Address</h3></div>
          <div class="panel-body">
            <form id="address-form">
              
              <div class="field" style="margin-bottom:16px;">
                <label>Label *</label>
                <select id="a_label" required style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">
                  <option value="Home">Home</option>
                  <option value="Office">Office</option>
                  <option value="Warehouse">Warehouse</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div class="field" style="margin-bottom:16px;">
                <label>Contact Name *</label>
                <input type="text" id="a_name" placeholder="Full Name" required style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">
              </div>

              <div class="field" style="margin-bottom:16px;">
                <label>Phone Number</label>
                <input type="text" id="a_phone" placeholder="+237..." style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">
              </div>

              <div class="field" style="margin-bottom:24px;">
                <label>Full Address *</label>
                <textarea id="a_address" rows="3" placeholder="Street, City, Region" required style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;"></textarea>
              </div>

              <button type="submit" class="btn btn-primary" style="width:100%;padding:12px;">
                <i class="fas fa-save"></i> Save Address
              </button>
            </form>
          </div>
        </div>

        <!-- SAVED LIST -->
        <div class="panel">
          <div class="panel-header"><h3><i class="fas fa-address-book"></i> Saved Addresses (${state.addresses.length})</h3></div>
          <div class="panel-body flush" style="padding:0;">
            ${renderList()}
          </div>
        </div>

      </div>
    `;
  }

  function renderList() {
    if (state.addresses.length === 0) {
      return `
        <div style="padding:60px 20px;text-align:center;">
          <div style="font-size:32px;color:var(--border);margin-bottom:12px;"><i class="fas fa-location-dot"></i></div>
          <h4 style="margin-bottom:8px;">No saved addresses</h4>
          <p style="color:var(--text-3);font-size:13px;">Add your home or office to speed up checkout.</p>
        </div>
      `;
    }

    return state.addresses.map(function(a) {
      var icon = a.label === 'Home' ? 'fa-house' : a.label === 'Office' ? 'fa-building' : 'fa-location-dot';
      
      return `
        <div style="display:flex;justify-content:space-between;align-items:start;padding:20px;border-bottom:1px solid var(--border);">
          <div style="display:flex;gap:16px;">
            <div style="width:40px;height:40px;border-radius:50%;background:var(--surface-2);display:flex;align-items:center;justify-content:center;color:var(--text-2);font-size:16px;">
              <i class="fas ${icon}"></i>
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <strong style="font-size:14.5px;">${esc(a.label)}</strong>
                <span style="font-size:11px;background:var(--border);padding:2px 6px;border-radius:4px;color:var(--text-3);">${esc(a.name)}</span>
              </div>
              <div style="font-size:13px;color:var(--text-2);margin-bottom:4px;">${esc(a.address)}</div>
              ${a.phone ? `<div style="font-size:12px;color:var(--text-3);"><i class="fas fa-phone"></i> ${esc(a.phone)}</div>` : ''}
            </div>
          </div>
          <div>
            <button class="btn btn-sm btn-ghost" title="Delete" onclick="window.AddressDelete('${a.id}')" style="color:var(--red);"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      `;
    }).join('');
  }

  // ================================================================
  // BIND
  // ================================================================
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    // Load addresses on first bind
    if (state.addresses.length === 0 && ctx.user) {
      loadAddresses(ctx.user);
      // Re-render once loaded
      container.innerHTML = render(ctx);
    }

    var form = document.getElementById('address-form');
    if (form) {
      form.removeEventListener('submit', handleAddAddress);
      form.addEventListener('submit', handleAddAddress);
    }

    window.AddressDelete = handleDelete;
  }

  function cleanup() {
    var form = document.getElementById('address-form');
    if (form) form.removeEventListener('submit', handleAddAddress);
    delete window.AddressDelete;
    container = null;
  }

  Pages['addresses'] = {
    title: 'Address Book',
    subtitle: 'Save your frequent locations',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  global.Pages = Pages;

})(window);