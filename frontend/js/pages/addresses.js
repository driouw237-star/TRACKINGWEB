/* GlobalExpress - pages/addresses.js
   Address book page: Senders / Recipients tabs, searchable address grid,
   add/edit/delete modals, set-as-default toggle.

   Registers itself via App.register('addresses', page).
   Reads/writes Store (addresses).
   Emits realtime events via Realtime.notifyLocalChange.
*/
(function (global) {
  'use strict';

  var Utils    = global.Utils    || {};
  var UI       = global.UI       || {};
  var Store    = global.Store    || {};
  var Realtime = global.Realtime || {};

  // --- Fallbacks -----------------------------------------------------------

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var uid = Utils.uid || function (p) {
    return (p || 'id') + '_' + Math.random().toString(36).slice(2, 10);
  };
  var fmtDate = Utils.fmtDate || function (d) {
    return new Date(d || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  var openModal = UI.openModal || function () { return null; };
  var closeModal = UI.closeModal || function () {};

  // --- Constants -----------------------------------------------------------

  var TABS = [
    { key: 'sender',   label: 'Senders',    emptyIcon: 'fa-store' },
    { key: 'receiver', label: 'Recipients', emptyIcon: 'fa-user' }
  ];

  // --- Module state --------------------------------------------------------

  var activeTab = 'sender';   // 'sender' | 'receiver'
  var query = '';
  var handler = null;
  var container = null;

  // --- Helpers -------------------------------------------------------------

  function currentUser(ctx) {
    return (ctx && ctx.user) || (global.App && global.App.state && global.App.state.user) || null;
  }

  function getUserAddresses(userId, type) {
    var all = [];
    try { all = Store.get('addresses') || []; } catch (e) {}
    return all.filter(function (a) {
      if (a.userId !== userId) return false;
      if (type && a.type !== type) return false;
      return true;
    });
  }

  function matchesQuery(a, q) {
    if (!q) return true;
    var hay = [
      a.name || '',
      a.company || '',
      a.email || '',
      a.phone || '',
      a.address || '',
      a.city || ''
    ].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function countByType(userId, type) {
    return getUserAddresses(userId, type).length;
  }

  // --- Address card --------------------------------------------------------

  function addressCard(a) {
    return ''
      + '<div class="addr-card" data-id="' + esc(a.id) + '">'
      +   (a.isDefault ? '<div class="addr-default">Default</div>' : '')
      +   '<h4>' + esc(a.name || '—') + '</h4>'
      +   (a.company ? '<p style="font-weight:600;font-size:12.5px">' + esc(a.company) + '</p>' : '')
      +   '<p>' + esc(a.address || '—') + '</p>'
      +   (a.city ? '<p style="color:var(--text-3)">' + esc(a.city) + '</p>' : '')
      +   (a.email ? '<p style="margin-top:6px"><i class="fas fa-envelope" style="color:var(--text-3);font-size:11px;margin-right:6px"></i>' + esc(a.email) + '</p>' : '')
      +   (a.phone ? '<p><i class="fas fa-phone" style="color:var(--text-3);font-size:11px;margin-right:6px"></i>' + esc(a.phone) + '</p>' : '')
      +   '<div class="addr-actions">'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="edit" data-id="' + esc(a.id) + '" title="Edit"><i class="fas fa-pen"></i></button>'
      +     (a.isDefault
              ? '<button type="button" class="btn btn-sm btn-outline" data-action="unset-default" data-id="' + esc(a.id) + '" title="Remove default" style="color:var(--accent);border-color:#fed7aa"><i class="fas fa-star"></i></button>'
              : '<button type="button" class="btn btn-sm btn-outline" data-action="set-default" data-id="' + esc(a.id) + '" title="Set as default"><i class="far fa-star"></i></button>')
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="delete" data-id="' + esc(a.id) + '" title="Delete" style="color:var(--red);border-color:#fecaca;margin-left:auto"><i class="fas fa-trash"></i></button>'
      +   '</div>'
      + '</div>';
  }

  // --- Empty states --------------------------------------------------------

  function emptyState(type) {
    var isSender = type === 'sender';
    var icon = isSender ? 'fa-store' : 'fa-user';
    var label = isSender ? 'senders' : 'recipients';
    return ''
      + '<div class="empty" style="grid-column:1/-1">'
      +   '<div class="empty-illustration"><i class="fas ' + icon + '"></i></div>'
      +   '<h4>No ' + label + ' saved yet</h4>'
      +   '<p>Add a ' + (isSender ? 'sender' : 'recipient') + ' so you can reuse it on future shipments.</p>'
      +   '<button type="button" class="btn btn-primary" data-action="add">'
      +     '<i class="fas fa-plus"></i> New Address'
      +   '</button>'
      + '</div>';
  }

  function emptyNoMatch() {
    return ''
      + '<div class="empty" style="grid-column:1/-1">'
      +   '<div class="empty-illustration"><i class="fas fa-magnifying-glass"></i></div>'
      +   '<h4>No matching addresses</h4>'
      +   '<p>Try a different search term or clear the search.</p>'
      +   '<button type="button" class="btn btn-outline" data-action="clear-search">'
      +     '<i class="fas fa-rotate-left"></i> Clear search'
      +   '</button>'
      + '</div>';
  }

  // --- Grid renderer -------------------------------------------------------

  function renderGrid(userId) {
    var host = document.getElementById('addrGrid');
    if (!host) return;

    var all = getUserAddresses(userId, activeTab);
    var q = query.trim().toLowerCase();
    var filtered = q
      ? all.filter(function (a) { return matchesQuery(a, q); })
      : all;

    if (all.length === 0) {
      host.innerHTML = emptyState(activeTab);
      return;
    }
    if (filtered.length === 0) {
      host.innerHTML = emptyNoMatch();
      return;
    }

    host.innerHTML = filtered.map(addressCard).join('');
  }

  // --- Tabs ----------------------------------------------------------------

  function renderTabs(userId) {
    var host = document.getElementById('addrTabs');
    if (!host) return;
    host.innerHTML = TABS.map(function (t) {
      var count = countByType(userId, t.key);
      var isActive = activeTab === t.key;
      return ''
        + '<button type="button" class="tab' + (isActive ? ' active' : '') + '" data-tab="' + esc(t.key) + '">'
        +   esc(t.label) + ' (' + count + ')'
        + '</button>';
    }).join('');
  }

  function rerenderTabsAndGrid(userId) {
    renderTabs(userId);
    renderGrid(userId);
    updateTabCounts(userId);
  }

  function updateTabCounts(userId) {
    // Update the counts inside each tab button without re-rendering the tabs
    var tabEls = document.querySelectorAll('[data-tab]');
    tabEls.forEach(function (el) {
      var key = el.dataset.tab;
      var count = countByType(userId, key);
      var label = key === 'sender' ? 'Senders' : 'Recipients';
      el.innerHTML = label + ' (' + count + ')';
      el.classList.toggle('active', activeTab === key);
    });
  }

  // --- Add / Edit form -----------------------------------------------------

  function openForm(existing) {
    var isEdit = !!existing;
    var a = existing || {
      name: '', company: '', email: '', phone: '',
      address: '', city: '', lat: '', lng: '', type: activeTab
    };

    var modal = openModal(''
      + '<div class="modal">'
      +   '<div class="modal-head">'
      +     '<div><h3><i class="fas fa-' + (isEdit ? 'pen' : 'plus') + '"></i> '
      +       (isEdit ? 'Edit Address' : 'New Address')
      +     '</h3></div>'
      +     '<button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button>'
      +   '</div>'
      +   '<div class="modal-body">'
      +     '<div class="field" style="margin-bottom:14px">'
      +       '<label>Type <span class="req">*</span></label>'
      +       '<select id="af_type" ' + (isEdit ? '' : '') + '>'
      +         '<option value="sender"' + (a.type === 'sender' ? ' selected' : '') + '>Sender (Origin)</option>'
      +         '<option value="receiver"' + (a.type === 'receiver' ? ' selected' : '') + '>Recipient (Destination)</option>'
      +       '</select>'
      +     '</div>'
      +     '<div class="grid-2">'
      +       '<div class="field">'
      +         '<label>Full Name <span class="req">*</span></label>'
      +         '<input type="text" id="af_name" value="' + esc(a.name || '') + '" placeholder="John Smith" />'
      +       '</div>'
      +       '<div class="field">'
      +         '<label>Company</label>'
      +         '<input type="text" id="af_company" value="' + esc(a.company || '') + '" placeholder="Acme Corp" />'
      +       '</div>'
      +       '<div class="field">'
      +         '<label>Email</label>'
      +         '<input type="email" id="af_email" value="' + esc(a.email || '') + '" placeholder="john@example.com" />'
      +       '</div>'
      +       '<div class="field">'
      +         '<label>Phone</label>'
      +         '<input type="tel" id="af_phone" value="' + esc(a.phone || '') + '" placeholder="+1 555 000 0000" />'
      +       '</div>'
      +       '<div class="field" style="grid-column:1/-1">'
      +         '<label>Full Address <span class="req">*</span></label>'
      +         '<input type="text" id="af_address" value="' + esc(a.address || '') + '" placeholder="123 Main St, Apt 4" />'
      +       '</div>'
      +       '<div class="field">'
      +         '<label>City</label>'
      +         '<input type="text" id="af_city" value="' + esc(a.city || '') + '" placeholder="Dallas, TX, USA" />'
      +       '</div>'
      +       '<div class="field">'
      +         '<label>Set as default</label>'
      +         '<select id="af_default">'
      +           '<option value="no"' + (!a.isDefault ? ' selected' : '') + '>No</option>'
      +           '<option value="yes"' + (a.isDefault ? ' selected' : '') + '>Yes</option>'
      +         '</select>'
      +       '</div>'
      +       '<div class="field">'
      +         '<label>Latitude (optional)</label>'
      +         '<input type="number" step="any" id="af_lat" value="' + esc(a.lat || '') + '" placeholder="32.7767" />'
      +       '</div>'
      +       '<div class="field">'
      +         '<label>Longitude (optional)</label>'
      +         '<input type="number" step="any" id="af_lng" value="' + esc(a.lng || '') + '" placeholder="-96.7970" />'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      +   '<div class="modal-foot">'
      +     '<button type="button" class="btn btn-outline" data-close>Cancel</button>'
      +     '<button type="button" class="btn btn-primary" data-save>'
      +       '<i class="fas fa-save"></i> ' + (isEdit ? 'Save Changes' : 'Save Address')
      +     '</button>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-save]')) {
        saveForm(modal, existing);
      }
    });

    // Focus first input after a tick
    setTimeout(function () {
      var first = document.getElementById('af_name');
      if (first) first.focus();
    }, 60);
  }

  function saveForm(modal, existing) {
    var user = currentUser();
    if (!user) return;

    var type = (document.getElementById('af_type') || {}).value || 'sender';
    var name = gv('af_name');
    var address = gv('af_address');

    if (!name) { toast('Name is required', '', 'error'); return; }
    if (!address) { toast('Address is required', '', 'error'); return; }

    var wantDefault = (document.getElementById('af_default') || {}).value === 'yes';

    var all = Store.get('addresses') || [];

    if (existing) {
      // Update in place
      var idx = all.findIndex(function (x) { return x.id === existing.id; });
      if (idx === -1) { closeModal(modal); return; }

      // If type changed, we still keep the same id — the record just moves category
      all[idx].type      = type;
      all[idx].name      = name;
      all[idx].company   = gv('af_company');
      all[idx].email     = gv('af_email');
      all[idx].phone     = gv('af_phone');
      all[idx].address   = address;
      all[idx].city      = gv('af_city');
      all[idx].lat       = parseFloat(gv('af_lat')) || 0;
      all[idx].lng       = parseFloat(gv('af_lng')) || 0;
      all[idx].isDefault = wantDefault;
    } else {
      // New record
      all.push({
        id: uid('addr'),
        userId: user.id,
        type: type,
        name: name,
        company: gv('af_company'),
        email: gv('af_email'),
        phone: gv('af_phone'),
        address: address,
        city: gv('af_city'),
        lat: parseFloat(gv('af_lat')) || 0,
        lng: parseFloat(gv('af_lng')) || 0,
        isDefault: wantDefault,
        createdAt: fmtDate()
      });
    }

    // Enforce uniqueness of default within a type
    if (wantDefault) {
      var targetId = existing ? existing.id : all[all.length - 1].id;
      all.forEach(function (x) {
        if (x.userId === user.id && x.type === type && x.id !== targetId) {
          x.isDefault = false;
        }
      });
    }

    Store.set('addresses', all);
    if (Realtime.notifyLocalChange) Realtime.notifyLocalChange('address:changed');

    closeModal(modal);
    toast(existing ? 'Address updated' : 'Address saved', '', 'success');
    rerenderTabsAndGrid(user.id);
  }

  function gv(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  // --- Set default ---------------------------------------------------------

  function setDefault(id) {
    var user = currentUser();
    if (!user) return;
    var all = Store.get('addresses') || [];
    var target = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) { target = all[i]; break; }
    }
    if (!target) return;

    all.forEach(function (x) {
      if (x.userId === user.id && x.type === target.type) {
        x.isDefault = (x.id === id);
      }
    });

    Store.set('addresses', all);
    if (Realtime.notifyLocalChange) Realtime.notifyLocalChange('address:changed');
    toast('Default updated', '', 'success');
    rerenderTabsAndGrid(user.id);
  }

  function unsetDefault(id) {
    var user = currentUser();
    if (!user) return;
    var all = Store.get('addresses') || [];
    all.forEach(function (x) {
      if (x.id === id) x.isDefault = false;
    });
    Store.set('addresses', all);
    if (Realtime.notifyLocalChange) Realtime.notifyLocalChange('address:changed');
    toast('Default removed', '', 'info');
    rerenderTabsAndGrid(user.id);
  }

  // --- Delete --------------------------------------------------------------

  function confirmDelete(id) {
    var all = Store.get('addresses') || [];
    var target = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) { target = all[i]; break; }
    }
    if (!target) return;

    var modal = openModal(''
      + '<div class="modal narrow modal-confirm">'
      +   '<div class="modal-body">'
      +     '<div class="modal-icon danger"><i class="fas fa-trash"></i></div>'
      +     '<h3>Delete Address</h3>'
      +     '<p>Delete <strong>' + esc(target.name) + '</strong> from your address book? This cannot be undone.</p>'
      +   '</div>'
      +   '<div class="modal-foot">'
      +     '<button type="button" class="btn btn-outline" data-close>Cancel</button>'
      +     '<button type="button" class="btn btn-danger" data-confirm><i class="fas fa-trash"></i> Delete</button>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-confirm]')) {
        deleteAddress(id);
        closeModal(modal);
      }
    });
  }

  function deleteAddress(id) {
    var user = currentUser();
    if (!user) return;
    var all = (Store.get('addresses') || []).filter(function (a) { return a.id !== id; });
    Store.set('addresses', all);
    if (Realtime.notifyLocalChange) Realtime.notifyLocalChange('address:deleted');
    toast('Address deleted', '', 'success');
    rerenderTabsAndGrid(user.id);
  }

  // --- Render --------------------------------------------------------------

  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    // Deep-link: ?type=sender|receiver
    var deepType = (ctx && ctx.params && ctx.params.type) || '';
    if (deepType === 'sender' || deepType === 'receiver') {
      activeTab = deepType;
    }

    var senderCount = countByType(user.id, 'sender');
    var receiverCount = countByType(user.id, 'receiver');

    return ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-address-book"></i> Address Book</h3>'
      +     '<button type="button" class="btn btn-sm btn-primary" data-action="add">'
      +       '<i class="fas fa-plus"></i> New Address'
      +     '</button>'
      +   '</div>'
      +   '<div class="panel-body">'

      +     '<div class="tabs" id="addrTabs">'
      +       '<button type="button" class="tab' + (activeTab === 'sender' ? ' active' : '') + '" data-tab="sender">Senders (' + senderCount + ')</button>'
      +       '<button type="button" class="tab' + (activeTab === 'receiver' ? ' active' : '') + '" data-tab="receiver">Recipients (' + receiverCount + ')</button>'
      +     '</div>'

      +     '<div class="search-box" style="max-width:420px;margin:0 0 18px">'
      +       '<i class="fas fa-search"></i>'
      +       '<input type="text" id="addrSearch" placeholder="Search by name, company, city…" value="' + esc(query) + '" />'
      +     '</div>'

      +     '<div class="addr-grid" id="addrGrid"></div>'

      +   '</div>'
      + '</div>';
  }

  // --- Bind ----------------------------------------------------------------

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    var user = currentUser(ctx);
    if (!user) return;

    // Initial grid render
    renderGrid(user.id);

    handler = function (e) {
      // Tabs
      var tab = e.target.closest && e.target.closest('[data-tab]');
      if (tab) {
        activeTab = tab.dataset.tab;
        renderTabs(user.id);
        renderGrid(user.id);
        return;
      }

      // Action buttons
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'add') {
        openForm(null);
        return;
      }
      if (action === 'edit') {
        var id1 = btn.dataset.id;
        var a = (Store.get('addresses') || []).filter(function (x) { return x.id === id1; })[0];
        if (a) openForm(a);
        return;
      }
      if (action === 'delete') {
        confirmDelete(btn.dataset.id);
        return;
      }
      if (action === 'set-default') {
        setDefault(btn.dataset.id);
        return;
      }
      if (action === 'unset-default') {
        unsetDefault(btn.dataset.id);
        return;
      }
      if (action === 'clear-search') {
        query = '';
        var s = document.getElementById('addrSearch');
        if (s) s.value = '';
        renderGrid(user.id);
        return;
      }
    };

    container.addEventListener('click', handler);

    // Search input (debounced)
    var searchEl = document.getElementById('addrSearch');
    if (searchEl) {
      var t = null;
      searchEl.addEventListener('input', function () {
        if (t) clearTimeout(t);
        t = setTimeout(function () {
          query = searchEl.value || '';
          renderGrid(user.id);
        }, 140);
      });
    }
  }

  // --- Cleanup -------------------------------------------------------------

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler = null;
    activeTab = 'sender';
    query = '';
  }

  // --- Register ------------------------------------------------------------

  var page = {
    title: 'Address Book',
    subtitle: 'Saved senders and recipients',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('addresses', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.addresses = page;
  }

})(window);