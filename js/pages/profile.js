/* GlobalExpress - pages/profile.js
   Profile page — Mobile-friendly & Connected to Supabase
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
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var fmtDate = Utils.fmtDate || function (d) { return new Date(d || Date.now()).toLocaleDateString(); };
  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  var openModal = UI.openModal || function () { return null; };
  var closeModal = UI.closeModal || function () {};

  var COUNTRIES = [
    'Cameroon', 'Nigeria', 'Ghana', 'Kenya', 'South Africa',
    'United States', 'United Kingdom', 'Canada', 'France', 'Germany',
    'Sweden', 'Norway', 'Netherlands', 'Belgium', 'Switzerland',
    'Italy', 'Spain', 'Portugal', 'Australia', 'India',
    'China', 'Japan', 'Brazil', 'Mexico', 'Other'
  ];

  var state = {
    user: null,
    shipments: [],
    referrals: [],
    isSaving: false
  };

  var handler = null;
  var container = null;

  function currentUser(ctx) {
    return (ctx && ctx.user) || (global.App && global.App.state && global.App.state.user) || null;
  }

  function gv(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  async function fetchProfileData(user) {
    if (!window.supabaseClient) return;
    state.user = user;

    try {
      var [shipRes, refRes] = await Promise.all([
        window.supabaseClient.schema('app').from('shipments').select('id, status').eq('created_by', user.id),
        window.supabaseClient.schema('app').from('referrals').select('id').eq('referrer_id', user.id)
      ]);
      
      state.shipments = shipRes.data || [];
      state.referrals = refRes.data || [];

      if (container) {
        container.innerHTML = render({ user: user });
        bind({ user: user });
      }
    } catch (err) {
      console.error('Failed to load profile stats:', err);
    }
  }

  function copyToClipboard(text, label) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(label || 'Copied', '', 'success');
      }).catch(function () {
        toast('Copy failed', 'Please copy manually', 'error');
      });
    }
  }

  function memberSinceLabel(joined) {
    if (!joined) return 'New member';
    var d = new Date(joined);
    if (isNaN(d.getTime())) return 'Member';
    var days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (days < 1)   return 'Joined today';
    if (days < 30)  return 'Joined ' + days + 'd ago';
    var months = Math.floor(days / 30);
    if (months < 12) return 'Joined ' + months + 'mo ago';
    return 'Joined ' + Math.floor(months / 12) + 'y ago';
  }

  function formatPhone(raw) {
    var s = String(raw || '').replace(/[^\d+]/g, '');
    if (s.indexOf('+') === 0) {
      var digits = s.slice(1);
      if (digits.length <= 3) return '+' + digits;
      return '+' + digits.replace(/(\d{3})(\d{1,3})?(\d{0,3})?(\d{0,3})?/, function (_, a, b, c, d) {
        var out = a;
        if (b) out += ' ' + b;
        if (c) out += ' ' + c;
        if (d) out += ' ' + d;
        return out;
      });
    }
    return s;
  }

  // ================================================================
  // RENDER COMPONENTS
  // ================================================================
  function heroCard(user) {
    var initial = (user.name || 'U').charAt(0).toUpperCase();
    var isAdmin = user.role === 'admin' || user.role === 'super_admin';
    var roleLabel = isAdmin ? 'Admin' : 'Customer';
    var roleCls = isAdmin ? 'Cancelled' : 'Pending';
    var since = memberSinceLabel(user.created_at || user.joined);
    var referralLink = location.origin + '/portal.html?ref=' + encodeURIComponent(user.referral_code || '');

    return `
      <div class="panel" style="overflow:hidden;margin-bottom:20px;">
        <div style="height:70px;background:linear-gradient(135deg,#0b2545 0%,#13315c 55%,#1e3a8a 100%);position:relative">
          <div style="position:absolute;inset:0;background-image:radial-gradient(circle at 80% 20%,rgba(255,107,53,.3),transparent 55%)"></div>
        </div>
        <div style="text-align:center;padding:0 20px 24px">
          <div style="width:84px;height:84px;margin:-42px auto 12px;border-radius:50%;position:relative;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Manrope',sans-serif;font-weight:800;font-size:32px;box-shadow:0 8px 24px rgba(255,107,53,.35),0 0 0 4px #fff">
            ${esc(initial)}
          </div>
          <h2 style="font-family:'Manrope',sans-serif;font-size:20px;font-weight:700;color:var(--text);margin:0 0 4px;">${esc(user.name || 'User')}</h2>
          <p style="font-size:13px;color:var(--text-2);margin:0 0 12px">${esc(user.email || '—')}</p>
          
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:16px">
            <span class="pill ${esc(roleCls)}">${esc(roleLabel)}</span>
            <span class="pill" style="background:#eff6ff;color:#1d4ed8"><i class="fas fa-clock" style="font-size:9px;margin-right:2px"></i> ${esc(since)}</span>
          </div>

          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            <button type="button" class="btn btn-sm btn-outline" data-action="copy-account-id" data-value="${esc(user.id || '')}">
              <i class="fas fa-id-badge"></i> Copy ID
            </button>
            <button type="button" class="btn btn-sm btn-outline" data-action="copy-referral-link" data-value="${esc(referralLink)}">
              <i class="fas fa-link"></i> Copy Referral
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function editPanel(user) {
    var country = user.country || '';
    var countryOptions = COUNTRIES.map(function (c) {
      return `<option value="${esc(c)}" ${country === c ? 'selected' : ''}>${esc(c)}</option>`;
    }).join('');

    var inputStyle = 'width:100%;padding:12px 14px;border:1px solid var(--border);border-radius:8px;font-size:16px;font-family:inherit;';

    return `
      <div class="panel" style="margin-bottom:20px;">
        <div class="panel-header">
          <h3><i class="fas fa-user"></i> Personal Info</h3>
        </div>
        <div class="panel-body">
          
          <div class="field" style="margin-bottom:16px;">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Full Name <span class="req">*</span></label>
            <input type="text" id="pName" value="${esc(user.name || '')}" placeholder="John Smith" style="${inputStyle}" />
          </div>

          <div class="field" style="margin-bottom:16px;">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Email Address</label>
            <input type="email" id="pEmail" value="${esc(user.email || '')}" disabled style="${inputStyle}background:var(--surface-2);color:var(--text-3);" />
          </div>

          <div class="field" style="margin-bottom:16px;">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Phone Number</label>
            <input type="tel" id="pPhone" value="${esc(user.phone || '')}" placeholder="+237 6XX XXX XXX" style="${inputStyle}" />
          </div>

          <div class="field" style="margin-bottom:16px;">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Country</label>
            <select id="pCountry" style="${inputStyle}">
              <option value="">Select country…</option>
              ${countryOptions}
            </select>
          </div>

          <div class="field" style="margin-bottom:24px;">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Company <span style="color:var(--text-3);font-weight:400">(optional)</span></label>
            <input type="text" id="pCompany" value="${esc(user.company || '')}" placeholder="Acme Corp" style="${inputStyle}" />
          </div>

          <button type="button" class="btn btn-primary" data-action="save" style="width:100%;padding:14px;font-size:15px;">
            <i class="fas fa-save"></i> Save Changes
          </button>

        </div>
      </div>
    `;
  }

  function statsPanel() {
    var ships = state.shipments;
    var total = ships.length;
    var delivered = ships.filter(function(s) { return s.status === 'Delivered'; }).length;
    var inTransit = ships.filter(function(s) { return s.status === 'In Transit'; }).length;
    var refs = state.referrals.length;

    return `
      <div class="panel" style="margin-bottom:20px;">
        <div class="panel-header"><h3><i class="fas fa-chart-line"></i> Account Stats</h3></div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            ${statTile('fa-box', 'orange', total, 'Shipments')}
            ${statTile('fa-circle-check', 'green', delivered, 'Delivered')}
            ${statTile('fa-truck-fast', 'blue', inTransit, 'In Transit')}
            ${statTile('fa-gift', 'purple', refs, 'Referrals')}
          </div>
        </div>
      </div>
    `;
  }

  function statTile(icon, color, value, label) {
    var bgMap = { blue: '#eff6ff', orange: '#fff7ed', green: '#ecfdf5', purple: '#f5f3ff' };
    var fgMap = { blue: 'var(--blue)', orange: 'var(--accent)', green: 'var(--green)', purple: 'var(--purple)' };
    
    return `
      <div style="padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="width:28px;height:28px;border-radius:8px;background:${bgMap[color]};color:${fgMap[color]};display:inline-flex;align-items:center;justify-content:center;font-size:12px">
            <i class="fas ${icon}"></i>
          </div>
          <div style="font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.4px;">${label}</div>
        </div>
        <div style="font-family:'Manrope',sans-serif;font-weight:800;font-size:22px;color:var(--text);">${value}</div>
      </div>
    `;
  }

  function dangerPanel(user) {
    return `
      <div class="panel" style="border-color:#fecaca;margin-bottom:20px;">
        <div class="panel-header" style="border-color:#fecaca;background:#fef2f2">
          <h3 style="color:#991b1b"><i class="fas fa-triangle-exclamation" style="color:#dc2626"></i> Danger Zone</h3>
        </div>
        <div class="panel-body">
          <p style="font-size:13px;color:var(--text-2);line-height:1.6;margin:0 0 16px;">
            Permanently delete your account and all associated data. This action cannot be undone.
          </p>
          <button type="button" class="btn btn-danger" data-action="delete-account" style="width:100%;padding:12px;">
            <i class="fas fa-trash"></i> Delete My Account
          </button>
        </div>
      </div>
    `;
  }

  // ================================================================
  // ACTIONS
  // ================================================================
  async function saveProfile(ctx) {
    if (state.isSaving || !window.supabaseClient) return;
    var user = currentUser(ctx);
    if (!user) return;

    var newName = gv('pName');
    if (!newName || newName.length < 2) return toast('Invalid name', 'Enter your full name.', 'error');

    var newPhone = gv('pPhone');
    var newCountry = gv('pCountry');
    var newCompany = gv('pCompany');

    state.isSaving = true;
    var btn = document.querySelector('[data-action="save"]');
    if (btn) { btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving...'; btn.disabled = true; }

    try {
      const { error } = await window.supabaseClient
        .schema('app')
        .from('users')
        .update({ full_name: newName, phone: newPhone, country: newCountry, company: newCompany })
        .eq('id', user.id);

      if (error) throw error;

      // Update local state
      user.name = newName;
      user.phone = newPhone;
      user.country = newCountry;
      user.company = newCompany;

      // Update topbar
      var nameEl = document.getElementById('userName');
      if (nameEl) nameEl.textContent = newName;
      var avEl = document.getElementById('userAvatar');
      if (avEl) avEl.textContent = newName.charAt(0).toUpperCase();

      toast('Success', 'Profile updated.', 'success');

    } catch (err) {
      console.error(err);
      toast('Error', 'Failed to update profile.', 'error');
    } finally {
      state.isSaving = false;
      if (btn) { btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; btn.disabled = false; }
    }
  }

  function openDeleteModal(user) {
    var modal = openModal(`
      <div class="modal narrow modal-confirm" style="width:90%;max-width:400px;">
        <div class="modal-body" style="padding:24px;">
          <div style="width:56px;height:56px;background:#fef2f2;color:#dc2626;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 auto 16px;">
            <i class="fas fa-triangle-exclamation"></i>
          </div>
          <h3 style="text-align:center;font-size:18px;margin-bottom:8px;">Delete Account</h3>
          <p style="text-align:center;font-size:13px;color:var(--text-2);margin-bottom:20px;">This will permanently delete <strong>${esc(user.name)}</strong> and all associated data.</p>
          
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;font-size:12px;color:#991b1b;margin-bottom:20px;">
            <strong>This will erase:</strong> Shipments, Payments, Wallet, Addresses, Tickets.
          </div>

          <div class="field">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Type <strong>DELETE</strong> to confirm</label>
            <input type="text" id="delConfirm" placeholder="DELETE" style="width:100%;padding:12px;border:1px solid var(--border);border-radius:8px;font-size:16px;text-align:center;font-weight:700;letter-spacing:2px;" />
          </div>
        </div>
        <div class="modal-foot" style="padding:16px;display:flex;flex-direction:column;gap:10px;">
          <button type="button" class="btn btn-danger" data-confirm disabled style="width:100%;padding:12px;opacity:.5;">Delete Forever</button>
          <button type="button" class="btn btn-outline" data-close style="width:100%;padding:12px;">Cancel</button>
        </div>
      </div>
    `);

    if (!modal) return;
    var input = modal.querySelector('#delConfirm');
    var btn = modal.querySelector('[data-confirm]');

    if (input) {
      input.addEventListener('input', function() {
        var match = input.value.trim() === 'DELETE';
        btn.disabled = !match;
        btn.style.opacity = match ? '1' : '.5';
      });
    }

    modal.addEventListener('click', function(e) {
      if (e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target.closest('[data-confirm]')) {
        if (btn.disabled) return;
        closeModal(modal);
        toast('Account deletion', 'Contact support to finalize deletion.', 'info');
      }
    });
  }

  // ================================================================
  // RENDER
  // ================================================================
  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    return `
      <div class="page-header" style="margin-bottom:20px;">
        <h2>My Profile</h2>
      </div>
      ${heroCard(user)}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;align-items:start;">
        <div>
          ${editPanel(user)}
          ${dangerPanel(user)}
        </div>
        <div>
          ${statsPanel()}
        </div>
      </div>
    `;
  }

  // ================================================================
  // BIND
  // ================================================================
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    var user = currentUser(ctx);
    if (user && state.shipments.length === 0) {
      fetchProfileData(user);
      return;
    }

    if (handler) container.removeEventListener('click', handler);
    handler = function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'save') saveProfile(ctx);
      if (action === 'copy-account-id') copyToClipboard(btn.dataset.value, 'ID Copied');
      if (action === 'copy-referral-link') copyToClipboard(btn.dataset.value, 'Link Copied');
      if (action === 'delete-account') openDeleteModal(user);
    };
    container.addEventListener('click', handler);

    // Phone formatting
    var phoneEl = document.getElementById('pPhone');
    if (phoneEl) {
      phoneEl.addEventListener('blur', function() {
        var formatted = formatPhone(phoneEl.value);
        if (formatted) phoneEl.value = formatted;
      });
    }
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null; handler = null;
    state.shipments = []; state.referrals = [];
  }

  var page = {
    title: 'My Profile',
    subtitle: 'Personal information',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('profile', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.profile = page;
  }

})(window);