/* ================================================================
   GlobalExpress — Admin Users Page
   ================================================================
   Enterprise user management page.

   Features:
     - KPI strip (Total, Active, Suspended, Admins, New 30d, Zero Wallet)
     - Filter tabs: All | Active | Inactive | Suspended | Admins | New (30d) | Zero Wallet
     - Search: name, email, phone, referral code
     - Dropdowns: role, country
     - Sortable columns: user, role, wallet, shipments, tickets, joined
     - Pagination with windowed page numbers
     - Row actions: View, Adjust Wallet, Suspend/Unsuspend
     - Bulk actions: Send Notification, Export, Suspend, Delete
     - Create User modal
     - Adjust Wallet modal (requires re-auth)
     - Suspend modal (requires confirm + re-auth)
     - Delete modal (requires confirm + re-auth)
     - CSV / JSON export honoring current filters

   Every write:
     - updates ge_users / ge_wallet_txns / ge_notifications
     - calls Admin.logAudit(action, target, details)
     - calls Realtime.notifyLocalChange when available

   Registers with window.PagesAdmin['users'].
   ================================================================ */

(function (global) {
  'use strict';

  // ==== SECTION 1 — DEPENDENCIES ====
  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var Admin = global.Admin || null;
  var AC    = global.AdminComponents || {};

  // ==== SECTION 2 — FALLBACKS ====
  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var money = Utils.money || function (n) {
    return 'Fr. ' + Number(n || 0).toLocaleString();
  };

  var comma = Utils.comma || function (n) {
    return Number(n || 0).toLocaleString('en-US');
  };

  var fmtRelative = Utils.fmtRelative || function (d) {
    try {
      var ts = new Date(d).getTime();
      var diff = Date.now() - ts;
      var min = Math.floor(diff / 60000);
      if (min < 1) return 'just now';
      if (min < 60) return min + 'm ago';
      var hr = Math.floor(min / 60);
      if (hr < 24) return hr + 'h ago';
      var day = Math.floor(hr / 24);
      if (day < 30) return day + 'd ago';
      return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return '—'; }
  };

  var fmtDate = Utils.fmtDate || function (d) {
    try {
      return new Date(d).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
    } catch (e) { return '—'; }
  };

  var toast = UI.toast || function (t, m, k) {
    if (global.console) console.log('[toast]', t, m || '', k || '');
  };

  var uid = Utils.uid || function (prefix) {
    return (prefix || 'id') + '_' +
      Math.random().toString(36).slice(2, 10) +
      Date.now().toString(36).slice(-4);
  };

  // ==== SECTION 3 — STORAGE ====
  var KEYS = {
    users:         'ge_users',
    shipments:     'ge_shipments',
    payments:      'ge_payments',
    walletTxns:    'ge_wallet_txns',
    notifications: 'ge_notifications',
    audit:         'ge_audit'
  };

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  function readUsers() {
    var list = read(KEYS.users, []);
    return Array.isArray(list) ? list : [];
  }
  function writeUsers(list) { return write(KEYS.users, list); }
  function readShipments() {
    var list = read(KEYS.shipments, []);
    return Array.isArray(list) ? list : [];
  }
  function readTickets() {
    var list = read('ge_tickets', []);
    return Array.isArray(list) ? list : [];
  }

  // ==== SECTION 4 — CONSTANTS + STATE ====
  var PAGE_SIZE = 15;

  var TABS = [
    { key: 'all',       label: 'All' },
    { key: 'active',    label: 'Active' },
    { key: 'inactive',  label: 'Inactive' },
    { key: 'suspended', label: 'Suspended' },
    { key: 'admins',    label: 'Admins' },
    { key: 'new',       label: 'New (30d)' },
    { key: 'zero',      label: 'Zero Wallet' }
  ];

  var COUNTRIES = [
    'Cameroon', 'Nigeria', 'Ghana', 'Kenya', 'South Africa',
    'United States', 'United Kingdom', 'Canada', 'France', 'Germany',
    'China', 'India', 'Brazil', 'Other'
  ];

  var state = {
    tab:        'all',
    query:      '',
    roleFilter: '',
    country:    '',
    sortKey:    'joined',
    sortDir:    'desc',
    pageNum:    1,
    selected:   {}
  };

  var handler   = null;
  var container = null;

  // ==== SECTION 5 — DATA HELPERS ====

  function shipmentCountFor(userId) {
    var ships = readShipments();
    var n = 0;
    for (var i = 0; i < ships.length; i++) {
      if (ships[i] && ships[i].createdBy === userId) n++;
    }
    return n;
  }

  function ticketCountFor(userId) {
    var tickets = readTickets();
    var n = 0;
    for (var i = 0; i < tickets.length; i++) {
      if (tickets[i] && tickets[i].userId === userId) n++;
    }
    return n;
  }

  function parseDateSafe(s) {
    if (!s) return 0;
    var t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }

  function isSuspended(u) {
    return !!(u && u.flags && u.flags.suspended);
  }

  function isActive(u) {
    return !isSuspended(u);
  }

  function isNew30d(u) {
    if (!u || !u.joined) return false;
    var t = parseDateSafe(u.joined);
    return t && (Date.now() - t) < (30 * 86400000);
  }

  function hasZeroWallet(u) {
    return (Number(u && u.wallet) || 0) === 0;
  }

  function matchesQuery(u, q) {
    if (!q) return true;
    var hay = [
      u.name || '',
      u.email || '',
      u.phone || '',
      u.referralCode || ''
    ].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function matchesTab(u, tab) {
    if (tab === 'all')       return true;
    if (tab === 'active')    return isActive(u);
    if (tab === 'inactive')  return isActive(u) && hasZeroWallet(u);
    if (tab === 'suspended') return isSuspended(u);
    if (tab === 'admins')    return (u.role || 'user') === 'admin';
    if (tab === 'new')       return isNew30d(u);
    if (tab === 'zero')      return hasZeroWallet(u);
    return true;
  }

  function matchesRole(u, role) {
    if (!role) return true;
    return (u.role || 'user') === role;
  }

  function matchesCountry(u, country) {
    if (!country) return true;
    return (u.country || '') === country;
  }

  // ==== SECTION 6 — PIPELINE ====

  function loadUsers() {
    var users = readUsers();
    var totalAll = users.length;

    var filtered = users.filter(function (u) {
      if (!u) return false;
      if (!matchesTab(u, state.tab)) return false;
      if (!matchesQuery(u, state.query)) return false;
      if (!matchesRole(u, state.roleFilter)) return false;
      if (!matchesCountry(u, state.country)) return false;
      return true;
    });

    // Enrich with counts
    var enriched = filtered.map(function (u) {
      return {
        user: u,
        shipCount: shipmentCountFor(u.id),
        ticketCount: ticketCountFor(u.id)
      };
    });

    enriched.sort(compareRows);

    var totalFiltered = enriched.length;
    var totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
    if (state.pageNum > totalPages) state.pageNum = totalPages;
    if (state.pageNum < 1) state.pageNum = 1;

    var start = (state.pageNum - 1) * PAGE_SIZE;
    var slice = enriched.slice(start, start + PAGE_SIZE);

    return {
      all: totalAll,
      filtered: totalFiltered,
      slice: slice,
      start: start,
      end: Math.min(start + PAGE_SIZE, totalFiltered),
      totalPages: totalPages
    };
  }

  function compareRows(a, b) {
    var key = state.sortKey;
    var dir = state.sortDir === 'asc' ? 1 : -1;
    var va, vb;

    if (key === 'name') {
      va = (a.user.name || '').toLowerCase();
      vb = (b.user.name || '').toLowerCase();
    } else if (key === 'email') {
      va = (a.user.email || '').toLowerCase();
      vb = (b.user.email || '').toLowerCase();
    } else if (key === 'role') {
      va = (a.user.role || 'user').toLowerCase();
      vb = (b.user.role || 'user').toLowerCase();
    } else if (key === 'wallet') {
      va = Number(a.user.wallet) || 0;
      vb = Number(b.user.wallet) || 0;
    } else if (key === 'shipments') {
      va = a.shipCount; vb = b.shipCount;
    } else if (key === 'tickets') {
      va = a.ticketCount; vb = b.ticketCount;
    } else {
      va = parseDateSafe(a.user.joined);
      vb = parseDateSafe(b.user.joined);
    }

    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  }

  // ==== SECTION 7 — KPI COMPUTATION ====

  function computeKpis() {
    var users = readUsers();
    var total = users.length;
    var active = 0, suspended = 0, admins = 0, newCount = 0, zero = 0;
    var liability = 0;

    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (!u) continue;
      if (isSuspended(u)) suspended++; else active++;
      if ((u.role || 'user') === 'admin') admins++;
      if (isNew30d(u)) newCount++;
      if (hasZeroWallet(u)) zero++;
      if ((u.role || 'user') !== 'admin') {
        liability += Number(u.wallet) || 0;
      }
    }

    return {
      total: total,
      active: active,
      suspended: suspended,
      admins: admins,
      newCount: newCount,
      zero: zero,
      liability: liability
    };
  }

  // ==== SECTION 8 — AUDIT + EMIT ====

  function auditAndEmit(action, target, details, extras) {
    if (Admin && typeof Admin.logAudit === 'function') {
      Admin.logAudit(action, target, details);
    }
    var RT = global.Realtime;
    if (RT && typeof RT.notifyLocalChange === 'function') {
      RT.notifyLocalChange('user:changed', { action: action, target: target });
    }
    if (extras && RT && typeof RT.notifyLocalChange === 'function') {
      for (var i = 0; i < extras.length; i++) {
        var ev = extras[i];
        if (ev && ev.name) RT.notifyLocalChange(ev.name, ev.payload);
      }
    }
  }

  // ==== SECTION 9 — ROW RENDERING ====

  function sortIndicator(key) {
    if (state.sortKey !== key) return '';
    var arrow = state.sortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down';
    return ' <i class="fas ' + arrow + '" style="font-size:9px;opacity:.9"></i>';
  }

  function th(key, label, extra) {
    return '<th data-sort-key="' + esc(key) + '"'
      + (extra ? ' class="' + esc(extra) + '"' : '')
      + ' style="cursor:pointer;user-select:none">'
      + esc(label) + sortIndicator(key) + '</th>';
  }

  function rowHtml(entry) {
    var u = entry.user;
    var initial = (u.name || u.email || 'U').charAt(0).toUpperCase();
    var isSelected = !!state.selected[u.id];
    var isAdmin = (u.role || 'user') === 'admin';
    var susp = isSuspended(u);

    return ''
      + '<tr data-id="' + esc(u.id) + '"' + (isSelected ? ' class="row-selected"' : '') + '>'

      +   '<td class="hide-sm" style="width:36px">'
      +     '<label class="checkbox" style="margin:0">'
      +       '<input type="checkbox" data-row-check data-id="' + esc(u.id) + '"'
      +       (isSelected ? ' checked' : '') + ' />'
      +     '</label>'
      +   '</td>'

      +   '<td>'
      +     '<div class="cell-user">'
      +       '<div class="av">' + esc(initial) + '</div>'
      +       '<div class="meta">'
      +         '<div class="name">' + esc(u.name || 'Unnamed') + '</div>'
      +         '<div class="email">' + esc(u.email || '—') + '</div>'
      +       '</div>'
      +     '</div>'
      +   '</td>'

      +   '<td>'
      +     (AC.rolePill
              ? AC.rolePill(isAdmin ? 'admin' : 'customer')
              : '<span class="admin-badge role-' + (isAdmin ? 'admin' : 'user') + '">' + (isAdmin ? 'Admin' : 'User') + '</span>')
      +     (susp
              ? ' <span class="admin-badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a">Suspended</span>'
              : '')
      +   '</td>'

      +   '<td class="num" style="font-weight:600;font-variant-numeric:tabular-nums">'
      +     esc(money(u.wallet || 0))
      +   '</td>'

      +   '<td class="num">' + esc(comma(entry.shipCount)) + '</td>'
      +   '<td class="num">' + esc(comma(entry.ticketCount)) + '</td>'

      +   '<td class="mono" style="font-size:12px;color:var(--text-2)">'
      +     esc(u.referralCode || '—')
      +   '</td>'

      +   '<td style="font-size:12px;color:var(--text-3);white-space:nowrap" title="' + esc(u.joined || '') + '">'
      +     esc(fmtRelative(u.joined))
      +   '</td>'

      +   '<td class="tbl-actions">'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="view" data-id="' + esc(u.id) + '" title="View details">'
      +       '<i class="fas fa-eye"></i>'
      +     '</button>'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="adjust-wallet" data-id="' + esc(u.id) + '" title="Adjust wallet">'
      +       '<i class="fas fa-wallet"></i>'
      +     '</button>'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="toggle-suspend" data-id="' + esc(u.id) + '" title="' + (susp ? 'Unsuspend' : 'Suspend') + '"'
      +     (susp ? ' style="color:var(--amber);border-color:#fde68a"' : '') + '>'
      +       '<i class="fas ' + (susp ? 'fa-circle-check' : 'fa-ban') + '"></i>'
      +     '</button>'
      +   '</td>'

      + '</tr>';
  }

  // ==== SECTION 10 — EMPTY STATES ====

  function emptyNoUsers() {
    if (AC.emptyState) {
      return AC.emptyState({
        icon: 'fa-users',
        title: 'No users yet',
        message: 'New signups will appear here once people create accounts.',
        actionHtml: '<button type="button" class="btn btn-primary" data-action="create-user">'
          + '<i class="fas fa-user-plus"></i> Create First User</button>'
      });
    }
    return '<div class="empty"><div class="empty-illustration"><i class="fas fa-users"></i></div>'
      + '<h4>No users yet</h4><p>New signups will appear here.</p></div>';
  }

  function emptyNoMatch() {
    if (AC.emptyState) {
      return AC.emptyState({
        icon: 'fa-magnifying-glass',
        title: 'No matching users',
        message: 'Try a different search, tab, or clear your filters.',
        actionHtml: '<button type="button" class="btn btn-outline" data-action="clear-filters">'
          + '<i class="fas fa-rotate-left"></i> Clear filters</button>'
      });
    }
    return '<div class="empty"><div class="empty-illustration"><i class="fas fa-magnifying-glass"></i></div>'
      + '<h4>No matching users</h4><p>Try a different search.</p></div>';
  }

  // ==== SECTION 11 — TABLE RENDER ====

  function renderRows() {
    var tbody = document.getElementById('usersTbody');
    if (!tbody) return;

    var result = loadUsers();

    if (result.all === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">' + emptyNoUsers() + '</td></tr>';
    } else if (result.filtered === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">' + emptyNoMatch() + '</td></tr>';
    } else {
      tbody.innerHTML = result.slice.map(rowHtml).join('');
    }

    var countEl = document.getElementById('usersCount');
    if (countEl) {
      countEl.textContent = result.filtered === result.all
        ? result.all + ' user' + (result.all === 1 ? '' : 's')
        : result.filtered + ' of ' + result.all + ' users';
    }

    renderFooter(result);
    updateBulkBar();
    syncSelectAll();
  }

  function windowedRange(total, current, span) {
    if (total <= 7) {
      var all = []; for (var i = 1; i <= total; i++) all.push(i); return all;
    }
    var range = [];
    var start = Math.max(2, current - span);
    var end = Math.min(total - 1, current + span);
    range.push(1);
    if (start > 2) range.push('…');
    for (var p = start; p <= end; p++) range.push(p);
    if (end < total - 1) range.push('…');
    range.push(total);
    return range;
  }

  function renderFooter(result) {
    var foot = document.getElementById('usersFooter');
    if (!foot) return;
    if (result.filtered === 0) { foot.innerHTML = ''; return; }

    var showing = (result.start + 1) + '–' + result.end + ' of ' + result.filtered;

    var pageBtns = '';
    var range = windowedRange(result.totalPages, state.pageNum, 2);
    for (var i = 0; i < range.length; i++) {
      var p = range[i];
      if (p === '…') {
        pageBtns += '<button type="button" disabled>…</button>';
      } else {
        pageBtns += '<button type="button" data-page="' + p + '"'
          + (p === state.pageNum ? ' class="active"' : '') + '>' + p + '</button>';
      }
    }

    foot.innerHTML = ''
      + '<div class="count">Showing <strong>' + showing + '</strong></div>'
      + '<div class="pages">'
      +   '<button type="button" data-page-prev ' + (state.pageNum === 1 ? 'disabled' : '') + '>'
      +     '<i class="fas fa-chevron-left"></i></button>'
      +   pageBtns
      +   '<button type="button" data-page-next ' + (state.pageNum >= result.totalPages ? 'disabled' : '') + '>'
      +     '<i class="fas fa-chevron-right"></i></button>'
      + '</div>';
  }

  function syncSelectAll() {
    var all = document.getElementById('usersSelectAll');
    if (!all) return;
    var result = loadUsers();
    if (!result.slice.length) { all.checked = false; return; }
    var every = result.slice.every(function (e) { return !!state.selected[e.user.id]; });
    all.checked = every;
  }

  // ==== SECTION 12 — BULK BAR ====

  function selectedCount() { return Object.keys(state.selected).length; }

  function updateBulkBar() {
    var bar = document.getElementById('usersBulkBar');
    if (!bar) return;
    var n = selectedCount();
    if (n === 0) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    var txt = document.getElementById('usersBulkText');
    if (txt) txt.textContent = n + ' selected';
  }

  function clearSelection() {
    state.selected = {};
    updateBulkBar();
    renderRows();
  }

  // ==== SECTION 13 — WRITES ====

  function setUserSuspended(userId, nextSuspended) {
    var users = readUsers();
    var idx = -1;
    for (var i = 0; i < users.length; i++) {
      if (users[i] && users[i].id === userId) { idx = i; break; }
    }
    if (idx === -1) { toast('User not found', '', 'error'); return false; }

    var user = users[idx];
    if (!user.flags || typeof user.flags !== 'object') user.flags = {};
    user.flags.suspended = nextSuspended;
    writeUsers(users);

    auditAndEmit(
      nextSuspended ? 'user.suspend' : 'user.unsuspend',
      'user:' + (user.email || user.id),
      nextSuspended ? 'Account suspended' : 'Account reactivated'
    );

    toast(
      nextSuspended ? 'User suspended' : 'User reactivated',
      user.name || user.email,
      nextSuspended ? 'warning' : 'success'
    );
    return true;
  }

  function adjustWallet(userId, delta, reason) {
    var users = readUsers();
    var idx = -1;
    for (var i = 0; i < users.length; i++) {
      if (users[i] && users[i].id === userId) { idx = i; break; }
    }
    if (idx === -1) { toast('User not found', '', 'error'); return false; }

    var user = users[idx];
    var oldBal = Number(user.wallet) || 0;
    var newBal = oldBal + delta;
    if (newBal < 0) {
      toast('Cannot go negative', 'Result would be ' + money(newBal) + '.', 'error');
      return false;
    }

    user.wallet = newBal;
    writeUsers(users);

    var txns = read(KEYS.walletTxns, []);
    if (!Array.isArray(txns)) txns = [];
    var txn = {
      id: uid('txn'),
      userId: user.id,
      type: delta >= 0 ? 'Deposit' : 'Withdraw',
      amount: delta,
      balanceAfter: newBal,
      description: reason || 'Admin adjustment',
      reference: 'ADJ-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      at: new Date().toISOString()
    };
    txns.push(txn);
    write(KEYS.walletTxns, txns);

    var notifs = read(KEYS.notifications, []);
    if (!Array.isArray(notifs)) notifs = [];
    var notif = {
      id: uid('n'),
      userId: user.id,
      title: delta >= 0 ? 'Wallet credited' : 'Wallet debited',
      message: money(Math.abs(delta)) + ' was '
        + (delta >= 0 ? 'added to' : 'deducted from')
        + ' your wallet.' + (reason ? ' Reason: ' + reason : ''),
      type: delta >= 0 ? 'success' : 'warning',
      at: new Date().toISOString(),
      read: false
    };
    notifs.push(notif);
    write(KEYS.notifications, notifs);

    auditAndEmit(
      delta >= 0 ? 'wallet.credit' : 'wallet.debit',
      'user:' + (user.email || user.id),
      (delta >= 0 ? '+' : '') + delta + ' — ' + (reason || 'adjustment'),
      [
        { name: 'wallet:changed', payload: { userId: user.id, balance: newBal, delta: delta } },
        { name: 'notification:new', payload: notif }
      ]
    );

    return { oldBal: oldBal, newBal: newBal };
  }

  function createUser(data) {
    var users = readUsers();
    var id = uid('u');
    var referral = (data.name || 'GX').replace(/\s+/g, '').slice(0, 4).toUpperCase()
      + Math.floor(Math.random() * 9000 + 1000);

    var newUser = {
      id: id,
      name: data.name,
      email: data.email.toLowerCase(),
      password: data.password || 'GX-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      role: data.role || 'user',
      wallet: Number(data.wallet) || 0,
      phone: data.phone || '',
      company: data.company || '',
      country: data.country || '',
      joined: new Date().toISOString(),
      referralCode: referral,
      flags: { suspended: false }
    };

    // Duplicate email check
    for (var i = 0; i < users.length; i++) {
      if (users[i] && users[i].email && users[i].email.toLowerCase() === newUser.email) {
        toast('Email already exists', 'That email is already registered.', 'error');
        return null;
      }
    }

    users.push(newUser);
    writeUsers(users);

    auditAndEmit(
      'user.create',
      'user:' + newUser.email,
      'Created user ' + newUser.name + ' (' + newUser.role + ')'
    );

    toast('User created', newUser.name, 'success');
    return newUser;
  }

  function deleteUsers(ids) {
    var users = readUsers();
    var removed = 0;
    var filtered = users.filter(function (u) {
      if (ids.indexOf(u.id) !== -1) { removed++; return false; }
      return true;
    });

    if (!removed) return 0;
    writeUsers(filtered);

    auditAndEmit(
      'user.delete',
      'users:' + ids.length,
      'Bulk deleted ' + removed + ' user' + (removed === 1 ? '' : 's')
    );

    return removed;
  }

  function sendBulkNotification(ids, title, message) {
    var users = readUsers();
    var notifs = read(KEYS.notifications, []);
    if (!Array.isArray(notifs)) notifs = [];

    var sent = 0;
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (!u || ids.indexOf(u.id) === -1) continue;
      notifs.push({
        id: uid('n'),
        userId: u.id,
        title: title,
        message: message,
        type: 'info',
        at: new Date().toISOString(),
        read: false
      });
      sent++;
    }

    if (sent) {
      write(KEYS.notifications, notifs);
      auditAndEmit(
        'notification.bulk-send',
        'users:' + sent,
        'Sent "' + title + '" to ' + sent + ' user' + (sent === 1 ? '' : 's')
      );
    }

    return sent;
  }

  // ==== SECTION 14 — EXPORT ====

  function exportUsers(onlySelected, format) {
    var users = readUsers();
    var list = users;

    if (onlySelected) {
      list = users.filter(function (u) { return state.selected[u.id]; });
    } else {
      list = users.filter(function (u) {
        if (!u) return false;
        if (!matchesTab(u, state.tab)) return false;
        if (!matchesQuery(u, state.query)) return false;
        if (!matchesRole(u, state.roleFilter)) return false;
        if (!matchesCountry(u, state.country)) return false;
        return true;
      });
    }

    // Strip password
    var safe = list.map(function (u) {
      var copy = {};
      for (var k in u) {
        if (Object.prototype.hasOwnProperty.call(u, k) && k !== 'password') {
          copy[k] = u[k];
        }
      }
      return copy;
    });

    var blob, filename, mime;
    if (format === 'csv') {
      var cols = ['id','name','email','role','wallet','phone','company','country','joined','referralCode'];
      var lines = [cols.join(',')];
      for (var i = 0; i < safe.length; i++) {
        var row = safe[i];
        lines.push(cols.map(function (c) {
          var v = row[c];
          if (v == null) return '';
          var s = String(v);
          if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
            return '"' + s.replace(/"/g, '""') + '"';
          }
          return s;
        }).join(','));
      }
      blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      filename = 'globalexpress-users-' + Date.now() + '.csv';
    } else {
      blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
      filename = 'globalexpress-users-' + Date.now() + '.json';
    }

    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast('Export downloaded', safe.length + ' user' + (safe.length === 1 ? '' : 's'), 'success');
  }

  // ==== SECTION 15 — MODALS ====

  function doReauth(reason) {
    if (global.AdminAuth && typeof global.AdminAuth.requirePassword === 'function') {
      return global.AdminAuth.requirePassword(reason);
    }
    // Fallback: just confirm
    if (UI.confirm) {
      return UI.confirm({
        title: 'Confirm action',
        message: reason,
        confirmText: 'Continue',
        variant: 'warning'
      });
    }
    return Promise.resolve(true);
  }

  function openSuspendModal(userId) {
    var users = readUsers();
    var user = null;
    for (var i = 0; i < users.length; i++) if (users[i].id === userId) { user = users[i]; break; }
    if (!user) { toast('User not found', '', 'error'); return; }

    var next = !isSuspended(user);
    var verb = next ? 'Suspend' : 'Reactivate';

    doReauth(verb + ' ' + (user.name || user.email) + '?').then(function (ok) {
      if (!ok) return;
      if (setUserSuspended(userId, next)) renderRows();
    });
  }

  function openAdjustWalletModal(userId) {
    var users = readUsers();
    var user = null;
    for (var i = 0; i < users.length; i++) if (users[i].id === userId) { user = users[i]; break; }
    if (!user) { toast('User not found', '', 'error'); return; }

    var bal = Number(user.wallet) || 0;

    var modal = UI.openModal
      ? UI.openModal(
          '<div class="modal narrow">'
          + '<div class="modal-head">'
          +   '<div><h3><i class="fas fa-wallet"></i> Adjust Wallet</h3>'
          +     '<div class="sub">' + esc(user.name || user.email) + ' · Current: ' + esc(money(bal)) + '</div>'
          +   '</div>'
          +   '<button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button>'
          + '</div>'
          + '<div class="modal-body">'
          +   '<div class="field" style="margin-bottom:14px">'
          +     '<label>Operation</label>'
          +     '<select id="walletOp">'
          +       '<option value="credit">Credit (add funds)</option>'
          +       '<option value="debit">Debit (deduct funds)</option>'
          +     '</select>'
          +   '</div>'
          +   '<div class="field" style="margin-bottom:14px">'
          +     '<label>Amount <span class="req">*</span></label>'
          +     '<input type="number" id="walletAmount" placeholder="e.g. 5000" min="1" step="1" />'
          +     '<div class="hint" id="walletHint">New balance will be ' + esc(money(bal)) + '</div>'
          +   '</div>'
          +   '<div class="field" style="margin:0">'
          +     '<label>Reason <span class="req">*</span></label>'
          +     '<input type="text" id="walletReason" placeholder="e.g. Goodwill credit" maxlength="120" />'
          +     '<div class="hint">Visible in the customer\'s notification feed and audit log.</div>'
          +   '</div>'
          + '</div>'
          + '<div class="modal-foot">'
          +   '<button type="button" class="btn btn-outline" data-close>Cancel</button>'
          +   '<button type="button" class="btn btn-primary" data-confirm><i class="fas fa-check"></i> Apply</button>'
          + '</div>'
          + '</div>'
        )
      : null;

    if (!modal) return;

    var amtEl = modal.querySelector('#walletAmount');
    var opEl = modal.querySelector('#walletOp');
    var hintEl = modal.querySelector('#walletHint');

    function updateHint() {
      var raw = parseInt(amtEl && amtEl.value, 10) || 0;
      var op = opEl ? opEl.value : 'credit';
      var delta = op === 'debit' ? -raw : raw;
      var next = bal + delta;
      hintEl.textContent = 'New balance will be ' + money(Math.max(0, next))
        + (next < 0 ? ' — cannot go below zero' : '');
      hintEl.style.color = next < 0 ? 'var(--red)' : '';
    }
    if (amtEl) amtEl.addEventListener('input', updateHint);
    if (opEl) opEl.addEventListener('change', updateHint);

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { UI.closeModal(modal); return; }
      if (e.target === modal) { UI.closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-confirm]')) {
        var amount = parseInt((amtEl && amtEl.value) || '0', 10);
        var op = (opEl && opEl.value) || 'credit';
        var reasonEl = modal.querySelector('#walletReason');
        var reason = (reasonEl && reasonEl.value || '').trim();

        if (!amount || amount <= 0) { toast('Enter an amount', 'Must be greater than zero.', 'error'); return; }
        if (!reason) { toast('Reason is required', '', 'error'); return; }

        UI.closeModal(modal);

        doReauth('Adjust ' + (user.name || user.email) + '\'s wallet by ' + money(op === 'debit' ? -amount : amount) + '?')
          .then(function (ok) {
            if (!ok) return;
            var delta = op === 'debit' ? -amount : amount;
            var result = adjustWallet(userId, delta, reason);
            if (result) {
              toast(
                op === 'credit' ? 'Wallet credited' : 'Wallet debited',
                money(amount) + ' — new balance ' + money(result.newBal),
                'success'
              );
              renderRows();
            }
          });
      }
    });
  }

  function openCreateUserModal() {
    var modal = UI.openModal
      ? UI.openModal(
          '<div class="modal wide">'
          + '<div class="modal-head">'
          +   '<div><h3><i class="fas fa-user-plus"></i> Create User</h3>'
          +     '<div class="sub">Add a new account to the platform</div>'
          +   '</div>'
          +   '<button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button>'
          + '</div>'
          + '<div class="modal-body">'
          +   '<div class="grid-2">'
          +     '<div class="field"><label>Full Name <span class="req">*</span></label>'
          +       '<input type="text" id="newName" placeholder="e.g. Jane Doe" /></div>'
          +     '<div class="field"><label>Email <span class="req">*</span></label>'
          +       '<input type="email" id="newEmail" placeholder="jane@example.com" /></div>'
          +     '<div class="field"><label>Role</label>'
          +       '<select id="newRole"><option value="user">User</option><option value="admin">Admin</option></select></div>'
          +     '<div class="field"><label>Initial Wallet</label>'
          +       '<input type="number" id="newWallet" value="0" min="0" step="1" /></div>'
          +     '<div class="field"><label>Phone</label>'
          +       '<input type="text" id="newPhone" placeholder="+237 ..." /></div>'
          +     '<div class="field"><label>Company</label>'
          +       '<input type="text" id="newCompany" placeholder="Optional" /></div>'
          +     '<div class="field"><label>Country</label>'
          +       '<select id="newCountry"><option value="">Select…</option>'
          +         COUNTRIES.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('')
          +       '</select></div>'
          +     '<div class="field"><label>Password</label>'
          +       '<input type="text" id="newPassword" placeholder="Leave blank to auto-generate" /></div>'
          +   '</div>'
          + '</div>'
          + '<div class="modal-foot">'
          +   '<button type="button" class="btn btn-outline" data-close>Cancel</button>'
          +   '<button type="button" class="btn btn-primary" data-confirm><i class="fas fa-check"></i> Create User</button>'
          + '</div>'
          + '</div>'
        )
      : null;

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { UI.closeModal(modal); return; }
      if (e.target === modal) { UI.closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-confirm]')) {
        var data = {
          name: (modal.querySelector('#newName') || {}).value || '',
          email: (modal.querySelector('#newEmail') || {}).value || '',
          role: (modal.querySelector('#newRole') || {}).value || 'user',
          wallet: (modal.querySelector('#newWallet') || {}).value || 0,
          phone: (modal.querySelector('#newPhone') || {}).value || '',
          company: (modal.querySelector('#newCompany') || {}).value || '',
          country: (modal.querySelector('#newCountry') || {}).value || '',
          password: (modal.querySelector('#newPassword') || {}).value || ''
        };
        if (!data.name.trim()) { toast('Name required', '', 'error'); return; }
        if (!data.email || data.email.indexOf('@') < 0) { toast('Valid email required', '', 'error'); return; }

        var created = createUser(data);
        if (created) {
          UI.closeModal(modal);
          renderRows();
        }
      }
    });
  }

  function openBulkNotificationModal() {
    var ids = Object.keys(state.selected);
    if (!ids.length) return;

    var modal = UI.openModal
      ? UI.openModal(
          '<div class="modal narrow">'
          + '<div class="modal-head">'
          +   '<div><h3><i class="fas fa-bullhorn"></i> Send Notification</h3>'
          +     '<div class="sub">' + ids.length + ' recipient' + (ids.length === 1 ? '' : 's') + '</div>'
          +   '</div>'
          +   '<button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button>'
          + '</div>'
          + '<div class="modal-body">'
          +   '<div class="field" style="margin-bottom:14px"><label>Title <span class="req">*</span></label>'
          +     '<input type="text" id="bulkTitle" placeholder="e.g. Platform update" maxlength="80" /></div>'
          +   '<div class="field" style="margin:0"><label>Message <span class="req">*</span></label>'
          +     '<textarea id="bulkMessage" rows="4" placeholder="Write your message…"></textarea></div>'
          + '</div>'
          + '<div class="modal-foot">'
          +   '<button type="button" class="btn btn-outline" data-close>Cancel</button>'
          +   '<button type="button" class="btn btn-primary" data-confirm><i class="fas fa-paper-plane"></i> Send</button>'
          + '</div>'
          + '</div>'
        )
      : null;

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { UI.closeModal(modal); return; }
      if (e.target === modal) { UI.closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-confirm]')) {
        var title = ((modal.querySelector('#bulkTitle') || {}).value || '').trim();
        var message = ((modal.querySelector('#bulkMessage') || {}).value || '').trim();
        if (!title || !message) { toast('Title and message required', '', 'error'); return; }

        var sent = sendBulkNotification(ids, title, message);
        UI.closeModal(modal);
        if (sent) {
          toast('Notification sent', sent + ' recipient' + (sent === 1 ? '' : 's'), 'success');
          clearSelection();
        }
      }
    });
  }

  function confirmBulkDelete() {
    var ids = Object.keys(state.selected);
    if (!ids.length) return;

    var run = function () {
      var removed = deleteUsers(ids);
      if (removed) {
        toast('Users deleted', removed + ' removed', 'success');
        clearSelection();
        renderRows();
      }
    };

    if (UI.confirm) {
      UI.confirm({
        title: 'Delete ' + ids.length + ' user' + (ids.length === 1 ? '' : 's') + '?',
        message: 'This permanently removes their accounts. Shipments and payments remain for historical records.',
        confirmText: 'Delete',
        variant: 'danger'
      }).then(function (ok) {
        if (!ok) return;
        doReauth('Confirm deletion of ' + ids.length + ' user' + (ids.length === 1 ? '' : 's')).then(function (authed) {
          if (authed) run();
        });
      });
    }
  }

  // ==== SECTION 16 — MAIN RENDER ====

  function render(ctx) {
    var kpis = computeKpis();

    var kpiStrip = ''
      + '<div class="admin-kpis" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">'
      +   kpiTile('fa-users', 'blue', comma(kpis.total), 'Total Users', kpis.admins + ' admin' + (kpis.admins === 1 ? '' : 's'))
      +   kpiTile('fa-user-check', 'green', comma(kpis.active), 'Active', 'Can sign in')
      +   kpiTile('fa-user-slash', 'red', comma(kpis.suspended), 'Suspended', 'Blocked')
      +   kpiTile('fa-user-plus', 'amber', comma(kpis.newCount), 'New (30d)', 'Fresh signups')
      +   kpiTile('fa-wallet', 'purple', money(kpis.liability), 'Wallet Liability', 'Customers only')
      + '</div>';

    var tabsHtml = '<div class="users-tabs-bar" style="margin-bottom:16px;border-bottom:2px solid var(--adm-border,#e3e8ef);display:flex;gap:4px;flex-wrap:wrap">'
      + TABS.map(function (t) {
          var active = state.tab === t.key ? ' active' : '';
          return '<button type="button" class="users-tab' + active + '" data-tab="' + t.key + '">'
            + esc(t.label) + '</button>';
        }).join('')
      + '</div>';

    var filterHtml = ''
      + '<div class="toolbar" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">'
      +   '<div class="search-box" style="flex:1;min-width:240px">'
      +     '<i class="fas fa-search"></i>'
      +     '<input type="text" id="usersSearch" placeholder="Search name, email, phone, referral code…" value="' + esc(state.query) + '" />'
      +   '</div>'
      +   '<select id="usersRoleFilter" aria-label="Filter by role">'
      +     '<option value="">All roles</option>'
      +     '<option value="user"' + (state.roleFilter === 'user' ? ' selected' : '') + '>Customers</option>'
      +     '<option value="admin"' + (state.roleFilter === 'admin' ? ' selected' : '') + '>Admins</option>'
      +   '</select>'
      +   '<select id="usersCountryFilter" aria-label="Filter by country">'
      +     '<option value="">All countries</option>'
      +     COUNTRIES.map(function (c) {
            return '<option value="' + esc(c) + '"' + (state.country === c ? ' selected' : '') + '>' + esc(c) + '</option>';
          }).join('')
      +   '</select>'
      + '</div>';

    var bulkBar = ''
      + '<div id="usersBulkBar" class="bulk-bar hidden">'
      +   '<span id="usersBulkText" style="font-weight:600;font-size:13px">0 selected</span>'
      +   '<div style="display:flex;gap:8px;margin-left:auto;flex-wrap:wrap">'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="bulk-notify"><i class="fas fa-bullhorn"></i> Send Notification</button>'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="bulk-export"><i class="fas fa-download"></i> Export</button>'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="bulk-suspend" style="color:var(--amber);border-color:#fde68a"><i class="fas fa-ban"></i> Suspend</button>'
      +     '<button type="button" class="btn btn-sm btn-danger" data-action="bulk-delete"><i class="fas fa-trash"></i> Delete</button>'
      +     '<button type="button" class="btn btn-sm btn-ghost" data-action="bulk-clear">Clear</button>'
      +   '</div>'
      + '</div>';

    var panelHtml = ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-users"></i> Users <span id="usersCount" style="font-weight:500;color:var(--text-3);font-size:13px;margin-left:6px"></span></h3>'
      +     '<div class="panel-tools" style="display:flex;gap:8px">'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="export-csv"><i class="fas fa-file-csv"></i> Export CSV</button>'
      +       '<button type="button" class="btn btn-sm btn-primary" data-action="create-user"><i class="fas fa-user-plus"></i> New User</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="panel-body">'
      +     tabsHtml
      +     filterHtml
      +     bulkBar
      +     '<div class="tbl-wrap">'
      +       '<table class="table-cards">'
      +         '<thead><tr>'
      +           '<th class="hide-sm" style="width:36px"><input type="checkbox" id="usersSelectAll" aria-label="Select all on page" /></th>'
      +           th('name', 'User')
      +           th('role', 'Role')
      +           th('wallet', 'Wallet', 'num')
      +           th('shipments', 'Shipments', 'num')
      +           th('tickets', 'Tickets', 'num')
      +           '<th>Referral</th>'
      +           th('joined', 'Joined')
      +           '<th class="tbl-actions">Actions</th>'
      +         '</tr></thead>'
      +         '<tbody id="usersTbody"></tbody>'
      +       '</table>'
      +     '</div>'
      +     '<div class="tbl-footer" id="usersFooter"></div>'
      +   '</div>'
      + '</div>';

    return kpiStrip + panelHtml;
  }

  function kpiTile(icon, color, value, label, sub) {
    var map = {
      green:  { bg: '#ecfdf5', fg: 'var(--green)' },
      red:    { bg: '#fef2f2', fg: 'var(--red)' },
      blue:   { bg: '#eff6ff', fg: 'var(--blue)' },
      purple: { bg: '#f5f3ff', fg: 'var(--purple)' },
      amber:  { bg: '#fffbeb', fg: 'var(--amber)' }
    };
    var c = map[color] || map.blue;
    return ''
      + '<div class="admin-kpi">'
      +   '<div class="kpi-head">'
      +     '<div class="kpi-label">' + esc(label) + '</div>'
      +     '<div class="kpi-icon" style="background:' + c.bg + ';color:' + c.fg + '"><i class="fas ' + esc(icon) + '"></i></div>'
      +   '</div>'
      +   '<div class="kpi-value">' + esc(value) + '</div>'
      +   (sub ? '<div class="kpi-trend flat">' + esc(sub) + '</div>' : '')
      + '</div>';
  }

  // ==== SECTION 17 — BIND ====

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (handler) container.removeEventListener('click', handler);

    // Initial paint
    renderRows();

    handler = function (e) {
      // --- Checkbox ---
      var rowCheck = e.target.closest && e.target.closest('[data-row-check]');
      if (rowCheck) {
        var rid = rowCheck.dataset.id;
        if (rowCheck.checked) state.selected[rid] = true;
        else delete state.selected[rid];
        var tr = rowCheck.closest('tr');
        if (tr) tr.classList.toggle('row-selected', rowCheck.checked);
        updateBulkBar();
        syncSelectAll();
        return;
      }

      // --- Select all ---
      if (e.target && e.target.id === 'usersSelectAll') {
        var result = loadUsers();
        if (e.target.checked) {
          for (var i = 0; i < result.slice.length; i++) {
            state.selected[result.slice[i].user.id] = true;
          }
        } else {
          state.selected = {};
        }
        renderRows();
        return;
      }

      // --- Tabs ---
      var tab = e.target.closest && e.target.closest('[data-tab]');
      if (tab) {
        state.tab = tab.dataset.tab;
        state.pageNum = 1;
        // re-render tabs to update active
        var tabBar = tab.parentNode;
        if (tabBar) {
          Array.prototype.forEach.call(tabBar.children, function (b) { b.classList.remove('active'); });
          tab.classList.add('active');
        }
        renderRows();
        return;
      }

      // --- Sort ---
      var thEl = e.target.closest && e.target.closest('[data-sort-key]');
      if (thEl) {
        var key = thEl.dataset.sortKey;
        if (key === state.sortKey) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = 'asc';
        }
        state.pageNum = 1;
        container.innerHTML = render(ctx);
        renderRows();
        attachInputs();
        return;
      }

      // --- Pagination ---
      var pageBtn = e.target.closest && e.target.closest('[data-page]');
      if (pageBtn) {
        state.pageNum = parseInt(pageBtn.dataset.page, 10) || 1;
        renderRows();
        return;
      }
      if (e.target.closest && e.target.closest('[data-page-prev]')) {
        if (state.pageNum > 1) { state.pageNum--; renderRows(); }
        return;
      }
      if (e.target.closest && e.target.closest('[data-page-next]')) {
        state.pageNum++; renderRows();
        return;
      }

      // --- Actions ---
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var id = btn.dataset.id;

      if (action === 'view') {
        if (Admin && Admin.go) Admin.go('user-detail', { id: id });
        else if (global.Router && global.Router.navigate) global.Router.navigate('user-detail', { id: id });
        return;
      }
      if (action === 'adjust-wallet') { openAdjustWalletModal(id); return; }
      if (action === 'toggle-suspend') { openSuspendModal(id); return; }
      if (action === 'create-user') { openCreateUserModal(); return; }
      if (action === 'export-csv') { exportUsers(false, 'csv'); return; }
      if (action === 'export-json') { exportUsers(false, 'json'); return; }
      if (action === 'bulk-notify') { openBulkNotificationModal(); return; }
      if (action === 'bulk-export') { exportUsers(true, 'csv'); return; }
      if (action === 'bulk-clear') { clearSelection(); return; }
      if (action === 'bulk-delete') { confirmBulkDelete(); return; }
      if (action === 'bulk-suspend') {
        var ids = Object.keys(state.selected);
        if (!ids.length) return;
        doReauth('Suspend ' + ids.length + ' user' + (ids.length === 1 ? '' : 's') + '?').then(function (ok) {
          if (!ok) return;
          var okCount = 0;
          for (var j = 0; j < ids.length; j++) {
            if (setUserSuspended(ids[j], true)) okCount++;
          }
          toast('Suspended', okCount + ' user' + (okCount === 1 ? '' : 's'), 'success');
          clearSelection();
          renderRows();
        });
        return;
      }
      if (action === 'clear-filters') {
        state.query = '';
        state.roleFilter = '';
        state.country = '';
        state.pageNum = 1;
        var s = document.getElementById('usersSearch');
        var r = document.getElementById('usersRoleFilter');
        var c = document.getElementById('usersCountryFilter');
        if (s) s.value = '';
        if (r) r.value = '';
        if (c) c.value = '';
        renderRows();
        return;
      }
    };

    container.addEventListener('click', handler);
    attachInputs();
  }

  function attachInputs() {
    var searchEl = document.getElementById('usersSearch');
    if (searchEl && !searchEl.__wired) {
      var timer = null;
      searchEl.addEventListener('input', function () {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          state.query = searchEl.value || '';
          state.pageNum = 1;
          renderRows();
        }, 140);
      });
      searchEl.__wired = true;
    }

    var roleEl = document.getElementById('usersRoleFilter');
    if (roleEl && !roleEl.__wired) {
      roleEl.addEventListener('change', function () {
        state.roleFilter = roleEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      roleEl.__wired = true;
    }

    var countryEl = document.getElementById('usersCountryFilter');
    if (countryEl && !countryEl.__wired) {
      countryEl.addEventListener('change', function () {
        state.country = countryEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      countryEl.__wired = true;
    }
  }

  // ==== SECTION 18 — CLEANUP ====

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler = null;

    state.tab = 'all';
    state.query = '';
    state.roleFilter = '';
    state.country = '';
    state.sortKey = 'joined';
    state.sortDir = 'desc';
    state.pageNum = 1;
    state.selected = {};

    if (UI.closeAllModals) UI.closeAllModals();
  }

  // ==== SECTION 19 — REGISTER ====

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin['users'] = {
    title: 'Users',
    subtitle: 'Manage every account on the platform',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);