/* GlobalExpress - pages/profile.js
   Profile page — professional edition.

   Features:
     - Hero card with avatar, role badge, membership duration
     - Two-column layout: editable info (left) + account stats (right)
     - Profile completeness indicator
     - Editable phone with auto-format
     - Country dropdown
     - Copy-to-clipboard for account ID and referral code
     - Account statistics (shipments, wallet, referrals)
     - Danger zone with cascading delete
     - Live topbar name/avatar update on save

   Registers itself via App.register('profile', page).
   Reads/writes Store (users + cascade deletes).
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
  var money = Utils.money || function (n) {
    return 'Fr. ' + Number(n || 0).toLocaleString();
  };
  var fmtDate = Utils.fmtDate || function (d) {
    return new Date(d || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  var openModal = UI.openModal || function () { return null; };
  var closeModal = UI.closeModal || function () {};

  // --- Constants -----------------------------------------------------------

  var COUNTRIES = [
    'Cameroon', 'Nigeria', 'Ghana', 'Kenya', 'South Africa',
    'United States', 'United Kingdom', 'Canada', 'France', 'Germany',
    'Sweden', 'Norway', 'Netherlands', 'Belgium', 'Switzerland',
    'Italy', 'Spain', 'Portugal', 'Australia', 'India',
    'China', 'Japan', 'Brazil', 'Mexico', 'Other'
  ];

  // --- Module state --------------------------------------------------------

  var handler = null;
  var container = null;

  // --- Helpers -------------------------------------------------------------

  function currentUser(ctx) {
    return (ctx && ctx.user) ||
           (global.App && global.App.state && global.App.state.user) ||
           null;
  }

  function gv(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function getUserShips(userId) {
    try {
      var all = Store.get('shipments') || [];
      return all.filter(function (s) { return s.createdBy === userId; });
    } catch (e) { return []; }
  }

  function getUserPayments(userId) {
    try {
      var all = Store.get('payments') || [];
      return all.filter(function (p) { return p.userId === userId; });
    } catch (e) { return []; }
  }

  function getUserReferrals(userId, code) {
    if (!code) return [];
    try {
      var all = Store.get('users') || [];
      return all.filter(function (u) {
        return u.id !== userId &&
               u.referredBy &&
               String(u.referredBy).toUpperCase() === String(code).toUpperCase();
      });
    } catch (e) { return []; }
  }

  function copyToClipboard(text, label) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(label || 'Copied', '', 'success');
      }).catch(function () {
        toast('Copy failed', 'Please copy manually', 'error');
      });
    } else {
      var el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try { document.execCommand('copy'); toast(label || 'Copied', '', 'success'); }
      catch (e) { toast('Copy failed', '', 'error'); }
      document.body.removeChild(el);
    }
  }

  function memberSinceLabel(joined) {
    if (!joined) return 'New member';
    var d = new Date(joined);
    if (isNaN(d.getTime())) return 'Member since ' + joined;
    var days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (days < 1)   return 'Joined today';
    if (days < 30)  return 'Joined ' + days + ' day' + (days === 1 ? '' : 's') + ' ago';
    var months = Math.floor(days / 30);
    if (months < 12) return 'Joined ' + months + ' month' + (months === 1 ? '' : 's') + ' ago';
    var years = Math.floor(months / 12);
    return 'Joined ' + years + ' year' + (years === 1 ? '' : 's') + ' ago';
  }

  function formatPhone(raw) {
    // Strip everything except digits and +
    var s = String(raw || '').replace(/[^\d+]/g, '');
    // If starts with +, keep + and group
    if (s.indexOf('+') === 0) {
      // +237 6XX XXX XXX style — group every 3 digits after the +NNN prefix
      var digits = s.slice(1);
      if (digits.length <= 3) return '+' + digits;
      // Simple grouping
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

  // --- Hero card -----------------------------------------------------------

  function heroCard(user) {
    var initial = (user.name || 'U').charAt(0).toUpperCase();
    var role = user.role || 'user';
    var roleLabel = role === 'admin' ? 'Administrator' : 'Customer';
    var roleCls = role === 'admin' ? 'Cancelled' : 'Pending';
    var since = memberSinceLabel(user.joined);
    var referralLink = location.origin + location.pathname + '?ref=' + encodeURIComponent(user.referralCode || '');

    return ''
      + '<div class="panel" style="overflow:hidden">'
      +   '<div style="height:80px;background:linear-gradient(135deg,#0b2545 0%,#13315c 55%,#1e3a8a 100%);position:relative">'
      +     '<div style="position:absolute;inset:0;background-image:radial-gradient(circle at 80% 20%,rgba(255,107,53,.3),transparent 55%)"></div>'
      +   '</div>'
      +   '<div class="panel-body" style="text-align:center;padding:0 24px 24px">'
      +     '<div style="width:96px;height:96px;margin:-48px auto 14px;border-radius:50%;position:relative;'
      +       'background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;'
      +       'display:flex;align-items:center;justify-content:center;'
      +       'font-family:\'Manrope\',sans-serif;font-weight:800;font-size:36px;letter-spacing:-.02em;'
      +       'box-shadow:0 8px 24px rgba(255,107,53,.35),0 0 0 4px #fff">'
      +       esc(initial)
      +     '</div>'
      +     '<h2 style="font-family:\'Manrope\',sans-serif;font-size:22px;font-weight:700;color:var(--text);margin:0 0 4px;letter-spacing:-.01em">'
      +       esc(user.name || 'User')
      +     '</h2>'
      +     '<p style="font-size:13.5px;color:var(--text-2);margin:0 0 12px">' + esc(user.email || '—') + '</p>'
      +     '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:16px">'
      +       '<span class="pill ' + esc(roleCls) + '">' + esc(roleLabel) + '</span>'
      +       '<span class="pill" style="background:#eff6ff;color:#1d4ed8">'
      +         '<i class="fas fa-clock" style="font-size:9px;margin-right:2px"></i> ' + esc(since)
      +       '</span>'
      +     '</div>'
      +     '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="copy-account-id" data-value="' + esc(user.id || '') + '">'
      +         '<i class="fas fa-id-badge"></i> Copy Account ID'
      +       '</button>'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="copy-referral-link" data-value="' + esc(referralLink) + '">'
      +         '<i class="fas fa-link"></i> Copy Referral Link'
      +       '</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  // --- Profile completeness -------------------------------------------------

  function completenessPanel(user) {
    var fields = [
      { label: 'Full Name',      done: !!(user.name && user.name.length > 1) },
      { label: 'Email',          done: !!user.email },
      { label: 'Phone Number',   done: !!user.phone },
      { label: 'Country',        done: !!user.country },
      { label: 'Company',        done: !!user.company }
    ];
    var done = fields.filter(function (f) { return f.done; }).length;
    var total = fields.length;
    var pct = Math.round(done / total * 100);

    var barColor = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)';

    var checklist = fields.map(function (f) {
      return ''
        + '<div style="display:flex;align-items:center;gap:8px;font-size:12.5px;'
        +   'color:' + (f.done ? 'var(--green)' : 'var(--text-2)') + '">'
        +   '<i class="fas ' + (f.done ? 'fa-circle-check' : 'fa-circle') + '" style="font-size:11px;flex-shrink:0"></i>'
        +   '<span>' + esc(f.label) + '</span>'
        + '</div>';
    }).join('');

    return ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-chart-simple"></i> Profile Completeness</h3>'
      +     '<span style="font-family:\'Manrope\',sans-serif;font-weight:800;font-size:15px;color:' + barColor + '">'
      +       pct + '%'
      +     '</span>'
      +   '</div>'
      +   '<div class="panel-body">'
      +     '<div class="progress" style="margin-bottom:14px">'
      +       '<div class="progress-fill" style="width:' + pct + '%;background:' + barColor + '"></div>'
      +     '</div>'
      +     '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px">'
      +       checklist
      +     '</div>'
      +     (pct < 100
            ? '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-2);font-size:12px;color:var(--text-3);line-height:1.5">'
              + '<i class="fas fa-lightbulb" style="color:var(--amber);margin-right:4px"></i>'
              + 'Complete your profile for faster support and better communication.'
              + '</div>'
            : '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-2);font-size:12px;color:var(--green);font-weight:600;line-height:1.5">'
              + '<i class="fas fa-circle-check" style="margin-right:4px"></i>'
              + 'Your profile is complete.'
              + '</div>')
      +   '</div>'
      + '</div>';
  }

  // --- Edit panel -----------------------------------------------------------

  function editPanel(user) {
    var country = user.country || '';
    var countryOptions = COUNTRIES.map(function (c) {
      return '<option value="' + esc(c) + '"' + (country === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');

    // If the user's country isn't in the list, add it as the first option
    var countryInList = COUNTRIES.indexOf(country) >= 0;
    if (country && !countryInList) {
      countryOptions = '<option value="' + esc(country) + '" selected>' + esc(country) + '</option>' + countryOptions;
    }

    return ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-user"></i> Personal Information</h3>'
      +     '<span style="font-size:12px;color:var(--text-3)">Changes save to your account immediately</span>'
      +   '</div>'
      +   '<div class="panel-body">'

      +     '<div class="grid-2">'
      +       '<div class="field" style="grid-column:1/-1">'
      +         '<label>Full Name <span class="req">*</span></label>'
      +         '<input type="text" id="pName" value="' + esc(user.name || '') + '" placeholder="John Smith" autocomplete="name" />'
      +       '</div>'

      +       '<div class="field" style="grid-column:1/-1">'
      +         '<label>Email Address</label>'
      +         '<input type="email" id="pEmail" value="' + esc(user.email || '') + '" disabled />'
      +         '<div class="hint">'
      +           '<i class="fas fa-lock" style="font-size:10px"></i> '
      +           'Email is verified and locked. Contact support to change it.'
      +         '</div>'
      +       '</div>'

      +       '<div class="field">'
      +         '<label>Phone Number</label>'
      +         '<input type="tel" id="pPhone" value="' + esc(user.phone || '') + '" placeholder="+237 6XX XXX XXX" autocomplete="tel" />'
      +         '<div class="hint">Used for delivery notifications.</div>'
      +       '</div>'

      +       '<div class="field">'
      +         '<label>Country</label>'
      +         '<select id="pCountry">'
      +           '<option value="">Select your country…</option>'
      +           countryOptions
      +         '</select>'
      +       '</div>'

      +       '<div class="field" style="grid-column:1/-1">'
      +         '<label>Company <span style="color:var(--text-3);font-weight:500">(optional)</span></label>'
      +         '<input type="text" id="pCompany" value="' + esc(user.company || '') + '" placeholder="Acme Corp" autocomplete="organization" />'
      +       '</div>'
      +     '</div>'

      +     '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:22px;padding-top:20px;border-top:1px solid var(--border-2);flex-wrap:wrap">'
      +       '<span style="font-size:12px;color:var(--text-3);line-height:1.5">'
      +         '<i class="fas fa-info-circle" style="margin-right:4px"></i>'
      +         'Your data is encrypted and never shared.'
      +       '</span>'
      +       '<div style="display:flex;gap:8px">'
      +         '<button type="button" class="btn btn-outline" data-action="reset-form">Reset</button>'
      +         '<button type="button" class="btn btn-primary" data-action="save">'
      +           '<i class="fas fa-save"></i> Save Changes'
      +         '</button>'
      +       '</div>'
      +     '</div>'

      +   '</div>'
      + '</div>';
  }

  // --- Account statistics --------------------------------------------------

  function statsPanel(user) {
    var ships = getUserShips(user.id);
    var referrals = getUserReferrals(user.id, user.referralCode);
    var totalShipments = ships.length;
    var delivered = ships.filter(function (s) { return s.status === 'Delivered'; }).length;
    var inTransit = ships.filter(function (s) { return s.status === 'In Transit'; }).length;
    var referralCount = referrals.length;

    return ''
      + '<div class="panel">'
      +   '<div class="panel-header"><h3><i class="fas fa-chart-line"></i> Account Activity</h3></div>'
      +   '<div class="panel-body">'
      +     '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px">'

      +       statTile('fa-box', 'orange', totalShipments, 'Total Shipments')
      +       statTile('fa-circle-check', 'green', delivered, 'Delivered')
      +       statTile('fa-truck-fast', 'blue', inTransit, 'In Transit')
      +       statTile('fa-gift', 'purple', referralCount, 'Referrals')

      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function statTile(icon, color, value, label) {
    var bgMap = {
      blue:   '#eff6ff',
      orange: '#fff7ed',
      green:  '#ecfdf5',
      purple: '#f5f3ff'
    };
    var fgMap = {
      blue:   'var(--blue)',
      orange: 'var(--accent)',
      green:  'var(--green)',
      purple: 'var(--purple)'
    };
    return ''
      + '<div style="padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2)">'
      +   '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
      +     '<div style="width:32px;height:32px;border-radius:9px;background:' + bgMap[color] + ';color:' + fgMap[color] + ';display:inline-flex;align-items:center;justify-content:center;font-size:13px">'
      +       '<i class="fas ' + esc(icon) + '"></i>'
      +     '</div>'
      +     '<div style="font-size:11.5px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.4px">'
      +       esc(label)
      +     '</div>'
      +   '</div>'
      +   '<div style="font-family:\'Manrope\',sans-serif;font-weight:800;font-size:24px;color:var(--text);letter-spacing:-.02em;line-height:1">'
      +     esc(value)
      +   '</div>'
      + '</div>';
  }

  // --- Account info panel --------------------------------------------------

  function accountPanel(user) {
    var refCode = user.referralCode || '—';
    var refLink = location.origin + location.pathname + '?ref=' + encodeURIComponent(refCode);

    return ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-id-card"></i> Account</h3>'
      +   '</div>'
      +   '<div class="panel-body">'

      +     '<div style="display:flex;flex-direction:column;gap:14px">'

      +       kv('Account ID', user.id || '—', 'Copy ID', user.id)
      +       kv('Role', user.role === 'admin' ? 'Administrator' : 'Customer')
      +       kv('Member Since', user.joined || '—')
      +       kv('Referral Code', refCode, 'Copy Code', refCode)
      +       kv('Referral Link', refLink, 'Copy Link', refLink)

      +     '</div>'

      +   '</div>'
      + '</div>';
  }

  function kv(label, value, copyLabel, copyValue) {
    return ''
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:12px;border-bottom:1px solid var(--border-2)">'
      +   '<div style="min-width:0;flex:1">'
      +     '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">'
      +       esc(label)
      +     '</div>'
      +     '<div style="font-size:13.5px;font-weight:600;color:var(--text);word-break:break-all">'
      +       (label === 'Account ID' || label === 'Referral Code' || label === 'Referral Link'
                ? '<span class="mono">' + esc(value) + '</span>'
                : esc(value))
      +     '</div>'
      +   '</div>'
      +   (copyValue
            ? '<button type="button" class="btn btn-sm btn-outline" data-action="copy-generic" data-value="' + esc(copyValue) + '" data-label="' + esc(copyLabel || 'Copied') + '" style="flex-shrink:0">'
              + '<i class="fas fa-copy"></i>'
              + '</button>'
            : '')
      + '</div>';
  }

  // --- Danger zone ---------------------------------------------------------

  function dangerPanel(user) {
    return ''
      + '<div class="panel" style="border-color:#fecaca">'
      +   '<div class="panel-header" style="border-color:#fecaca;background:#fef2f2">'
      +     '<h3 style="color:#991b1b">'
      +       '<i class="fas fa-triangle-exclamation" style="color:#dc2626"></i> Danger Zone'
      +     '</h3>'
      +   '</div>'
      +   '<div class="panel-body">'
      +     '<div style="display:flex;gap:14px;align-items:flex-start">'
      +       '<div style="width:44px;height:44px;border-radius:11px;background:#fef2f2;color:#dc2626;display:inline-flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">'
      +         '<i class="fas fa-user-slash"></i>'
      +       '</div>'
      +       '<div style="flex:1;min-width:0">'
      +         '<div style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:4px">Delete Account</div>'
      +         '<p style="font-size:13px;color:var(--text-2);line-height:1.6;margin:0 0 14px">'
      +           'Permanently remove your account and all associated data — shipments, payments, wallet balance, addresses, and notifications. This action cannot be undone.'
      +         '</p>'
      +         '<button type="button" class="btn btn-danger" data-action="delete-account">'
      +           '<i class="fas fa-trash"></i> Delete My Account'
      +         '</button>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  // --- Save handler --------------------------------------------------------

  function saveProfile(ctx) {
    var user = currentUser(ctx);
    if (!user) return;

    // Validate name
    var newName = gv('pName');
    if (!newName || newName.length < 2) {
      if (V && V.showFieldError) {
        V.showFieldError(document.getElementById('pName'), 'Name must be at least 2 characters');
      }
      toast('Invalid name', 'Please enter your full name.', 'error');
      return;
    }

    var newPhone   = gv('pPhone');
    var newCountry = gv('pCountry');
    var newCompany = gv('pCompany');

    // Write via Store.updateUser
    if (Store.updateUser) {
      Store.updateUser({
        name:    newName,
        phone:   newPhone,
        country: newCountry,
        company: newCompany
      });
    } else {
      var users = Store.get('users') || [];
      var i = -1;
      for (var k = 0; k < users.length; k++) {
        if (users[k].id === user.id) { i = k; break; }
      }
      if (i !== -1) {
        users[i].name = newName;
        users[i].phone = newPhone;
        users[i].country = newCountry;
        users[i].company = newCompany;
        Store.set('users', users);
      }
    }

    if (Realtime.notifyLocalChange) Realtime.notifyLocalChange('user:changed');

    // Update topbar immediately
    var fresh = Store.reloadUser ? Store.reloadUser() : null;
    if (fresh && global.App && global.App.state) {
      global.App.state.user = fresh;
    }
    var nameEl = document.getElementById('userName');
    if (nameEl) nameEl.textContent = newName;
    var avEl = document.getElementById('userAvatar');
    if (avEl) avEl.textContent = newName.charAt(0).toUpperCase();

    toast('Profile updated', 'Your changes have been saved.', 'success');

    // Re-render the page
    var host = document.getElementById('content');
    if (host && container === host) {
      host.innerHTML = render({ user: fresh || Object.assign({}, user, {
        name: newName, phone: newPhone, country: newCountry, company: newCompany
      }) });
    }
  }

  function resetForm(ctx) {
    var user = currentUser(ctx);
    if (!user) return;
    var host = document.getElementById('content');
    if (host) host.innerHTML = render({ user: user });
    toast('Form reset', '', 'info');
  }

  // --- Delete account ------------------------------------------------------

  function openDeleteModal(user) {
    var modal = openModal(''
      + '<div class="modal narrow modal-confirm">'
      +   '<div class="modal-body">'
      +     '<div class="modal-icon danger"><i class="fas fa-triangle-exclamation"></i></div>'
      +     '<h3>Delete Account</h3>'
      +     '<p style="margin-bottom:14px">This will permanently delete <strong>' + esc(user.name || 'your account') + '</strong> and all associated data. This cannot be undone.</p>'

      +     '<div style="text-align:left;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:9px;font-size:12.5px;color:#991b1b;margin-bottom:16px;line-height:1.6">'
      +       '<strong style="display:block;margin-bottom:4px"><i class="fas fa-circle-exclamation"></i> This will erase:</strong>'
      +       'All your shipments · Payments · Wallet balance · Addresses · Notifications · Support tickets'
      +     '</div>'

      +     '<div class="field" style="text-align:left">'
      +       '<label>Type <strong>DELETE</strong> to confirm</label>'
      +       '<input type="text" id="delConfirm" placeholder="DELETE" autocomplete="off" style="text-align:center;font-weight:700;letter-spacing:2px" />'
      +     '</div>'
      +   '</div>'
      +   '<div class="modal-foot">'
      +     '<button type="button" class="btn btn-outline" data-close>Cancel</button>'
      +     '<button type="button" class="btn btn-danger" data-confirm disabled style="opacity:.5">'
      +       '<i class="fas fa-trash"></i> Delete Forever'
      +     '</button>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    var input = modal.querySelector('#delConfirm');
    var confirmBtn = modal.querySelector('[data-confirm]');

    function updateConfirmState() {
      var match = (input.value || '').trim() === 'DELETE';
      confirmBtn.disabled = !match;
      confirmBtn.style.opacity = match ? '1' : '.5';
    }

    if (input) {
      input.addEventListener('input', updateConfirmState);
      setTimeout(function () { input.focus(); }, 60);
    }

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-confirm]')) {
        if (confirmBtn.disabled) return;
        closeModal(modal);
        deleteAccount(user);
      }
    });
  }

  function deleteAccount(user) {
    if (!user) return;

    var users        = (Store.get('users')        || []).filter(function (u) { return u.id !== user.id; });
    var shipments    = (Store.get('shipments')    || []).filter(function (s) { return s.createdBy !== user.id; });
    var payments     = (Store.get('payments')     || []).filter(function (p) { return p.userId !== user.id; });
    var walletTxns   = (Store.get('walletTxns')   || []).filter(function (t) { return t.userId !== user.id; });
    var addresses    = (Store.get('addresses')    || []).filter(function (a) { return a.userId !== user.id; });
    var notifications= (Store.get('notifications')|| []).filter(function (n) { return n.userId !== user.id; });
    var tickets      = (Store.get('tickets')      || []).filter(function (t) { return t.userId !== user.id; });

    Store.set('users', users);
    Store.set('shipments', shipments);
    Store.set('payments', payments);
    Store.set('walletTxns', walletTxns);
    Store.set('addresses', addresses);
    Store.set('notifications', notifications);
    Store.set('tickets', tickets);

    if (Store.set) Store.set('session', null);
    try { localStorage.removeItem('ge_session'); } catch (e) {}

    if (Realtime.notifyLocalChange) {
      Realtime.notifyLocalChange('user:changed');
      Realtime.notifyLocalChange('session:changed');
    }

    toast('Account deleted', 'You have been signed out.', 'info');

    setTimeout(function () {
      if (global.App && global.App.state) {
        global.App.state.user = null;
      }
      try { location.reload(); } catch (e) {}
    }, 900);
  }

  // --- Render --------------------------------------------------------------

  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    return ''
      + heroCard(user)
      + '<div style="display:grid;grid-template-columns:1fr 380px;gap:20px;align-items:start" class="profile-grid">'
      +   '<div>'
      +     editPanel(user)
      +     accountPanel(user)
      +     dangerPanel(user)
      +   '</div>'
      +   '<div>'
      +     completenessPanel(user)
      +     statsPanel(user)
      +   '</div>'
      + '</div>';
  }

  // --- Bind ----------------------------------------------------------------

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;
    if (handler) container.removeEventListener('click', handler);

    handler = function (e) {
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'save') {
        saveProfile(ctx);
        return;
      }
      if (action === 'reset-form') {
        resetForm(ctx);
        return;
      }
      if (action === 'copy-ref') {
        copyToClipboard(btn.dataset.value, 'Referral code copied');
        return;
      }
      if (action === 'copy-generic') {
        copyToClipboard(btn.dataset.value, btn.dataset.label || 'Copied');
        return;
      }
      if (action === 'copy-account-id') {
        copyToClipboard(btn.dataset.value, 'Account ID copied');
        return;
      }
      if (action === 'copy-referral-link') {
        copyToClipboard(btn.dataset.value, 'Referral link copied');
        return;
      }
      if (action === 'delete-account') {
        var user = currentUser(ctx);
        if (user) openDeleteModal(user);
        return;
      }
    };

    container.addEventListener('click', handler);

    // Phone auto-format
    var phoneEl = document.getElementById('pPhone');
    if (phoneEl) {
      phoneEl.addEventListener('blur', function () {
        var formatted = formatPhone(phoneEl.value);
        if (formatted) phoneEl.value = formatted;
      });
    }
  }

  // --- Cleanup -------------------------------------------------------------

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler = null;
  }

  // --- Register ------------------------------------------------------------

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