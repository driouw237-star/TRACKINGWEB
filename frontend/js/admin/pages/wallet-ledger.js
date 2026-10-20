/* ================================================================
   GlobalExpress — Admin Wallet Ledger Page
   ================================================================
   Platform-wide wallet ledger: every wallet transaction from every
   user, with totals and an admin-side "adjust balance" action.

   Layout:
     - 3 KPI tiles: total credited, total debited, current liability
     - Filterable/sortable/paginated table of every wallet txn
     - "Adjust Balance" button opens a modal (user + amount + reason)
     - Wallet-type distribution mini chart

   Every wallet adjustment:
     - updates ge_users[userId].wallet
     - appends a ge_wallet_txns record
     - sends a ge_notifications entry to the customer
     - calls Admin.logAudit('wallet.adjust', ...)
     - emits wallet:changed + notification:new

   Deep-link: Admin.state.params.userId pre-applies a user filter.
   Deep-link: Admin.state.params.type pre-applies a txn type filter.

   Registers with Admin.register('wallet', page).
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

  var comma = Utils.comma || function (n) {
    return Number(n || 0).toLocaleString('en-US');
  };

  var uid = Utils.uid || function (prefix) {
    return (prefix || 'id') + '_' +
      Math.random().toString(36).slice(2, 10) +
      Date.now().toString(36).slice(-4);
  };

  var fmtDT = Utils.fmtDT || function (d) {
    return new Date(d || Date.now()).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  };

  var toast = UI.toast || function (t, m, k) {
    if (global.console) console.log('[toast]', t, m || '', k || '');
  };

  var openModal  = UI.openModal  || function () { return null; };
  var closeModal = UI.closeModal || function () {};

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
     §3 — KEYS + CONSTANTS
     ================================================================ */

  var KEYS = {
    users:         'ge_users',
    walletTxns:    'ge_wallet_txns',
    notifications: 'ge_notifications'
  };

  var PAGE_SIZE = 20;

  // Transaction types with a label + color class
  var TYPES = [
    { value: 'Deposit',  label: 'Deposit',  cls: 'green'  },
    { value: 'Withdraw', label: 'Withdraw', cls: 'red'    },
    { value: 'Shipment', label: 'Shipment', cls: 'orange' },
    { value: 'Refund',   label: 'Refund',   cls: 'purple' }
  ];

  /* ================================================================
     §4 — MODULE STATE
     ================================================================ */

  var state = {
    query:      '',
    typeFilter: '',
    userFilter: '',
    sortKey:    'date',       // user | type | amount | balance | date
    sortDir:    'desc',
    pageNum:    1
  };

  var handler         = null;
  var container       = null;
  var deepLinkHandled = false;

  /* ================================================================
     §5 — STORAGE READERS / WRITERS
     ================================================================ */

  function readTxns() {
    var list = storage.get(KEYS.walletTxns, []);
    return Array.isArray(list) ? list : [];
  }

  function writeTxns(list) {
    return storage.set(KEYS.walletTxns, list);
  }

  function readUsers() {
    var list = storage.get(KEYS.users, []);
    return Array.isArray(list) ? list : [];
  }

  function writeUsers(list) {
    return storage.set(KEYS.users, list);
  }

  function readNotifications() {
    var list = storage.get(KEYS.notifications, []);
    return Array.isArray(list) ? list : [];
  }

  function writeNotifications(list) {
    return storage.set(KEYS.notifications, list);
  }

  function userOptions() {
    var users = readUsers();
    var seen = {};
    var opts = [];
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (u && u.id && !seen[u.id]) {
        seen[u.id] = true;
        opts.push({
          id:    u.id,
          name:  u.name || u.email || u.id,
          email: u.email || '',
          role:  u.role || 'user',
          wallet: Number(u.wallet) || 0
        });
      }
    }
    // Sort alphabetically for the filter dropdown
    opts.sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name));
    });
    return opts;
  }

  /* ================================================================
     §6 — HELPERS
     ================================================================ */

  function findUserById(id) {
    if (!id) return null;
    var users = readUsers();
    for (var i = 0; i < users.length; i++) {
      if (users[i] && users[i].id === id) return users[i];
    }
    return null;
  }

  function parseDateSafe(s) {
    if (!s) return 0;
    var t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }

  function matchesQuery(t, q, userName) {
    if (!q) return true;
    var hay = [
      t.ref         || '',
      t.description || '',
      t.type        || '',
      t.method      || '',
      userName      || '',
      String(t.amount || '')
    ].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function matchesType(t, type) {
    if (!type) return true;
    return t.type === type;
  }

  function matchesUser(t, userId) {
    if (!userId) return true;
    return t.userId === userId;
  }

  function typeColorCls(type) {
    for (var i = 0; i < TYPES.length; i++) {
      if (TYPES[i].value === type) return TYPES[i].cls;
    }
    return 'default';
  }

  /* ================================================================
     §7 — AUDIT + EMIT
     ================================================================ */

  function auditAndEmit(action, target, details, extras) {
    if (Admin && typeof Admin.logAudit === 'function') {
      Admin.logAudit(action, target, details);
    }
    if (Realtime && typeof Realtime.notifyLocalChange === 'function') {
      Realtime.notifyLocalChange('wallet:changed', { target: target });
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
     §8 — PIPELINE
     ================================================================ */

  function pipeline() {
    var txns = readTxns();
    var users = readUsers();

    // Index users for fast lookup by id
    var userMap = {};
    for (var i = 0; i < users.length; i++) {
      if (users[i] && users[i].id) userMap[users[i].id] = users[i];
    }

    // Attach userName for display + query
    var enriched = txns.map(function (t) {
      var u = userMap[t.userId];
      return {
        txn:      t,
        userName: u ? (u.name || u.email || u.id) : (t.userName || 'Unknown'),
        userEmail: u ? (u.email || '') : (t.userEmail || '')
      };
    });

    var totalAll = enriched.length;

    var q = state.query.trim().toLowerCase();
    if (q) {
      enriched = enriched.filter(function (e) {
        return matchesQuery(e.txn, q, e.userName);
      });
    }

    if (state.typeFilter) {
      enriched = enriched.filter(function (e) {
        return matchesType(e.txn, state.typeFilter);
      });
    }

    if (state.userFilter) {
      enriched = enriched.filter(function (e) {
        return matchesUser(e.txn, state.userFilter);
      });
    }

    enriched.sort(compareTxns);

    var totalFiltered = enriched.length;
    var totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
    if (state.pageNum > totalPages) state.pageNum = totalPages;
    if (state.pageNum < 1) state.pageNum = 1;

    var start = (state.pageNum - 1) * PAGE_SIZE;
    var slice = enriched.slice(start, start + PAGE_SIZE);

    return {
      all:        totalAll,
      filtered:   totalFiltered,
      slice:      slice,
      start:      start,
      end:        Math.min(start + PAGE_SIZE, totalFiltered),
      totalPages: totalPages
    };
  }

  function compareTxns(a, b) {
    var key = state.sortKey;
    var dir = state.sortDir === 'asc' ? 1 : -1;

    var va, vb;
    if (key === 'user') {
      va = (a.userName || '').toLowerCase();
      vb = (b.userName || '').toLowerCase();
    } else if (key === 'type') {
      va = (a.txn.type || '').toLowerCase();
      vb = (b.txn.type || '').toLowerCase();
    } else if (key === 'amount') {
      va = Number(a.txn.amount) || 0;
      vb = Number(b.txn.amount) || 0;
    } else if (key === 'balance') {
      va = Number(a.txn.balanceAfter) || 0;
      vb = Number(b.txn.balanceAfter) || 0;
    } else {
      va = parseDateSafe(a.txn.at);
      vb = parseDateSafe(b.txn.at);
    }

    if (va < vb) return -1 * dir;
    if (va > vb) return  1 * dir;
    return 0;
  }

  /* ================================================================
     §9 — KPI COMPUTATION
     ================================================================ */

  function computeKpis() {
    var txns  = readTxns();
    var users = readUsers();

    var totalCredited = 0;
    var totalDebited  = 0;
    var creditsCount  = 0;
    var debitsCount   = 0;

    for (var i = 0; i < txns.length; i++) {
      var t = txns[i];
      if (!t) continue;
      var amt = Number(t.amount) || 0;
      if (amt >= 0) {
        totalCredited += amt;
        creditsCount++;
      } else {
        totalDebited += Math.abs(amt);
        debitsCount++;
      }
    }

    // Wallet liability = sum of every customer's wallet.
    var walletLiability = 0;
    for (var j = 0; j < users.length; j++) {
      var u = users[j];
      if (!u || u.role === 'admin') continue;
      walletLiability += Number(u.wallet) || 0;
    }

    return {
      totalCredited:   totalCredited,
      totalDebited:    totalDebited,
      creditsCount:    creditsCount,
      debitsCount:     debitsCount,
      walletLiability: walletLiability,
      totalTxns:       txns.length
    };
  }

  function typeDistribution() {
    var txns = readTxns();
    var counts = {};
    for (var i = 0; i < TYPES.length; i++) counts[TYPES[i].value] = 0;
    for (var j = 0; j < txns.length; j++) {
      var t = txns[j];
      if (!t || !t.type) continue;
      if (Object.prototype.hasOwnProperty.call(counts, t.type)) counts[t.type]++;
    }
    return TYPES.map(function (T) {
      return { key: T.value, cls: T.cls, count: counts[T.value] || 0 };
    });
  }

  /* ================================================================
     §10 — ROW RENDERING
     ================================================================ */

  function sortIndicator(key) {
    if (state.sortKey !== key) return '';
    var arrow = state.sortDir === 'asc' ? 'fa-sort-up' : 'fa-sort-down';
    return ' <i class="fas ' + arrow + '" style="font-size:9px;opacity:.9"></i>';
  }

  function th(key, label, extra) {
    return '<th data-sort-key="' + esc(key) + '"'
         + (extra ? ' class="' + esc(extra) + '"' : '')
         + ' style="cursor:pointer">'
         + esc(label)
         + sortIndicator(key)
         + '</th>';
  }

  function rowHtml(entry) {
    var t = entry.txn;
    var amt = Number(t.amount) || 0;
    var pos = amt >= 0;
    var amountCls = pos ? 'positive' : 'negative';
    var sign = pos ? '+' : '';
    var initial = (entry.userName || 'U').charAt(0).toUpperCase();

    return ''
      + '<tr>'
      +   '<td>'
      +     '<div class="cell-user" style="gap:8px">'
      +       '<div class="av" style="width:28px;height:28px;font-size:11px">'
      +         esc(initial)
      +       '</div>'
      +       '<div class="meta">'
      +         '<div class="name" style="font-size:13px">'
      +           esc(entry.userName)
      +         '</div>'
      +         (entry.userEmail
                  ? '<div class="email" style="font-size:11px">' + esc(entry.userEmail) + '</div>'
                  : '')
      +       '</div>'
      +     '</div>'
      +   '</td>'

      +   '<td>'
      +     '<span class="pill ' + esc(t.type || 'Deposit') + '">'
      +       esc(t.type || '—')
      +     '</span>'
      +   '</td>'

      +   '<td style="font-size:12.5px;color:var(--text-2)">'
      +     esc(t.description || '—')
      +     (t.ref
              ? '<div class="cell-sub mono">' + esc(t.ref) + '</div>'
              : '')
      +   '</td>'

      +   '<td class="num tbl-amount ' + amountCls + '" '
      +     'style="font-weight:700;font-variant-numeric:tabular-nums">'
      +     sign + money(amt)
      +   '</td>'

      +   '<td class="num" style="color:var(--text-2);font-size:12.5px;'
      +     'font-variant-numeric:tabular-nums">'
      +     esc(money(t.balanceAfter || 0))
      +   '</td>'

      +   '<td style="font-size:12px;color:var(--text-3);white-space:nowrap">'
      +     esc(t.at || '—')
      +   '</td>'
      + '</tr>';
  }

  /* ================================================================
     §11 — EMPTY STATES
     ================================================================ */

  function emptyNoTxns() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-wallet"></i></div>'
      +   '<h4>No wallet activity yet</h4>'
      +   '<p>Every deposit, withdrawal, and refund will be recorded here.</p>'
      + '</div>';
  }

  function emptyNoMatch() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-magnifying-glass"></i></div>'
      +   '<h4>No matching transactions</h4>'
      +   '<p>Try a different search, type, or user filter.</p>'
      +   '<button type="button" class="btn btn-outline" data-action="clear-filters">'
      +     '<i class="fas fa-rotate-left"></i> Clear filters'
      +   '</button>'
      + '</div>';
  }

  /* ================================================================
     §12 — TABLE RENDER
     ================================================================ */

  function renderRows() {
    var tbody = document.getElementById('ledgerTbody');
    if (!tbody) return;

    var result = pipeline();

    if (result.all === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">'
        + emptyNoTxns() + '</td></tr>';
    } else if (result.filtered === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">'
        + emptyNoMatch() + '</td></tr>';
    } else {
      tbody.innerHTML = result.slice.map(rowHtml).join('');
    }

    var countEl = document.getElementById('ledgerCount');
    if (countEl) {
      countEl.textContent = result.filtered === result.all
        ? result.all + ' transaction' + (result.all === 1 ? '' : 's')
        : result.filtered + ' of ' + result.all + ' transactions';
    }

    renderFooter(result);
  }

  function windowedRange(total, current, span) {
    if (total <= 7) {
      var all = [];
      for (var i = 1; i <= total; i++) all.push(i);
      return all;
    }
    var range = [];
    var start = Math.max(2, current - span);
    var end   = Math.min(total - 1, current + span);
    range.push(1);
    if (start > 2) range.push('…');
    for (var p = start; p <= end; p++) range.push(p);
    if (end < total - 1) range.push('…');
    range.push(total);
    return range;
  }

  function renderFooter(result) {
    var foot = document.getElementById('ledgerFooter');
    if (!foot) return;
    if (result.filtered === 0) { foot.innerHTML = ''; return; }

    var showing = (result.start + 1) + '–' + result.end
                + ' of ' + result.filtered;

    var pageBtns = '';
    var range = windowedRange(result.totalPages, state.pageNum, 2);
    for (var i = 0; i < range.length; i++) {
      var p = range[i];
      if (p === '…') {
        pageBtns += '<button type="button" disabled>…</button>';
      } else {
        pageBtns += '<button type="button" data-page="' + p + '"'
                  + (p === state.pageNum ? ' class="active"' : '')
                  + '>' + p + '</button>';
      }
    }

    foot.innerHTML = ''
      + '<div class="count">Showing <strong>' + showing + '</strong></div>'
      + '<div class="pages">'
      +   '<button type="button" data-page-prev '
      +     (state.pageNum === 1 ? 'disabled' : '') + '>'
      +     '<i class="fas fa-chevron-left"></i>'
      +   '</button>'
      +   pageBtns
      +   '<button type="button" data-page-next '
      +     (state.pageNum >= result.totalPages ? 'disabled' : '') + '>'
      +     '<i class="fas fa-chevron-right"></i>'
      +   '</button>'
      + '</div>';
  }

  /* ================================================================
     §13 — ADJUST BALANCE WRITE
     ================================================================ */

  function adjustBalance(userId, delta, reason) {
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
      toast('Cannot go negative', 'Result would be ' + money(newBal), 'error');
      return false;
    }

    // 1. Update user
    users[idx].wallet = newBal;
    writeUsers(users);

    // 2. Wallet txn
    var txns = readTxns();
    var txnRecord = {
      id:           uid('txn'),
      userId:       user.id,
      type:         delta >= 0 ? 'Deposit' : 'Withdraw',
      amount:       delta,
      balanceAfter: newBal,
      description:  reason || 'Admin adjustment',
      ref:          'ADJ-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      at:           fmtDT()
    };
    txns.push(txnRecord);
    writeTxns(txns);

    // 3. Notification to the customer
    var notifs = readNotifications();
    var notifRecord = {
      id:      uid('n'),
      userId:  user.id,
      title:   delta >= 0 ? 'Wallet credited' : 'Wallet debited',
      message: money(Math.abs(delta)) + ' was '
             + (delta >= 0 ? 'added to' : 'deducted from')
             + ' your wallet.' + (reason ? ' Reason: ' + reason : ''),
      type:    delta >= 0 ? 'success' : 'warning',
      at:      fmtDT(),
      read:    false
    };
    notifs.push(notifRecord);
    writeNotifications(notifs);

    auditAndEmit(
      delta >= 0 ? 'wallet.credit' : 'wallet.debit',
      'user:' + (user.email || user.id),
      (delta >= 0 ? '+' : '') + delta + ' — ' + (reason || 'adjustment'),
      [
        { name: 'wallet:changed',   payload: { userId: user.id, balance: newBal, delta: delta } },
        { name: 'notification:new', payload: notifRecord }
      ]
    );

    return {
      oldBal: oldBal,
      newBal: newBal,
      userName: user.name || user.email || user.id,
      txnRecord: txnRecord
    };
  }

  /* ================================================================
     §14 — ADJUST MODAL
     ================================================================ */

  function openAdjustModal(prefillUserId) {
    var users = userOptions();

    if (!users.length) {
      toast('No users to adjust', '', 'info');
      return;
    }

    var selectedId = prefillUserId || users[0].id;
    var selectedUser = null;
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === selectedId) { selectedUser = users[i]; break; }
    }
    if (!selectedUser) {
      selectedUser = users[0];
      selectedId = selectedUser.id;
    }

    var modal = openModal(''
      + '<div class="modal narrow">'
      +   '<div class="modal-head">'
      +     '<div>'
      +       '<h3><i class="fas fa-wallet"></i> Adjust Wallet Balance</h3>'
      +       '<div class="sub">Credits or debits a customer\'s wallet directly.</div>'
      +     '</div>'
      +     '<button type="button" class="modal-close" data-close aria-label="Close">'
      +       '<i class="fas fa-times"></i>'
      +     '</button>'
      +   '</div>'
      +   '<div class="modal-body">'

      +     '<div class="field" style="margin-bottom:14px">'
      +       '<label>User <span class="req">*</span></label>'
      +       '<select id="adjUser">'
      +         users.map(function (u) {
                return '<option value="' + esc(u.id) + '"'
                     + (u.id === selectedId ? ' selected' : '') + '>'
                     + esc(u.name)
                     + ' — ' + esc(money(u.wallet))
                     + '</option>';
              }).join('')
      +       '</select>'
      +       '<div class="hint" id="adjCurrent">'
      +         'Current balance: <strong>' + esc(money(selectedUser.wallet)) + '</strong>'
      +       '</div>'
      +     '</div>'

      +     '<div class="field" style="margin-bottom:14px">'
      +       '<label>Operation</label>'
      +       '<select id="adjOp">'
      +         '<option value="credit">Credit (add funds)</option>'
      +         '<option value="debit">Debit (deduct funds)</option>'
      +       '</select>'
      +     '</div>'

      +     '<div class="field" style="margin-bottom:14px">'
      +       '<label>Amount <span class="req">*</span></label>'
      +       '<input type="number" id="adjAmount" placeholder="e.g. 5000" '
      +         'min="1" step="1" />'
      +       '<div class="hint" id="adjPreview">'
      +         'New balance will be ' + esc(money(selectedUser.wallet))
      +       '</div>'
      +     '</div>'

      +     '<div class="field" style="margin:0">'
      +       '<label>Reason <span class="req">*</span></label>'
      +       '<input type="text" id="adjReason" '
      +         'placeholder="e.g. Goodwill credit, bonus, correction" '
      +         'maxlength="140" />'
      +       '<div class="hint">Will appear in the customer\'s notifications and the audit log.</div>'
      +     '</div>'

      +   '</div>'
      +   '<div class="modal-foot">'
      +     '<button type="button" class="btn btn-outline" data-close>Cancel</button>'
      +     '<button type="button" class="btn btn-primary" data-confirm>'
      +       '<i class="fas fa-check"></i> Apply'
      +     '</button>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    var userEl    = modal.querySelector('#adjUser');
    var opEl      = modal.querySelector('#adjOp');
    var amtEl     = modal.querySelector('#adjAmount');
    var reasonEl  = modal.querySelector('#adjReason');
    var currentEl = modal.querySelector('#adjCurrent');
    var previewEl = modal.querySelector('#adjPreview');

    function currentBalance() {
      var id = userEl ? userEl.value : selectedId;
      for (var k = 0; k < users.length; k++) {
        if (users[k].id === id) return users[k].wallet;
      }
      return 0;
    }

    function updatePreview() {
      if (!previewEl || !currentEl) return;
      var bal = currentBalance();
      var raw = parseInt(amtEl && amtEl.value, 10) || 0;
      var op  = opEl ? opEl.value : 'credit';
      var delta = op === 'debit' ? -raw : raw;
      var next = bal + delta;
      currentEl.innerHTML = 'Current balance: <strong>' + esc(money(bal)) + '</strong>';
      previewEl.textContent = 'New balance will be ' + money(Math.max(0, next))
        + (next < 0 ? ' — cannot go below zero' : '');
      previewEl.style.color = next < 0 ? 'var(--red)' : '';
    }

    if (userEl)   userEl.addEventListener('change', updatePreview);
    if (opEl)     opEl.addEventListener('change', updatePreview);
    if (amtEl)    amtEl.addEventListener('input', updatePreview);

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }

      if (e.target.closest && e.target.closest('[data-confirm]')) {
        var id  = userEl   ? userEl.value : selectedId;
        var op  = opEl     ? opEl.value : 'credit';
        var amt = parseInt(amtEl && amtEl.value, 10) || 0;
        var reason = reasonEl ? reasonEl.value.trim() : '';

        if (!id) {
          toast('Select a user', '', 'error');
          return;
        }
        if (amt <= 0) {
          toast('Enter an amount', 'Must be greater than zero.', 'error');
          return;
        }
        if (!reason) {
          toast('Reason is required', '', 'error');
          return;
        }

        var delta = op === 'debit' ? -amt : amt;
        var result = adjustBalance(id, delta, reason);
        closeModal(modal);

        if (result) {
          toast(
            op === 'credit' ? 'Wallet credited' : 'Wallet debited',
            money(amt) + ' — ' + result.userName + ' now has ' + money(result.newBal),
            'success'
          );
          renderRows();
        }
      }
    });
  }

  /* ================================================================
     §15 — CHART RENDER (type distribution)
     ================================================================ */

  function renderTypeChart() {
    var dist = typeDistribution();
    var maxCount = 1;
    for (var i = 0; i < dist.length; i++) {
      if (dist[i].count > maxCount) maxCount = dist[i].count;
    }

    return ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-chart-simple"></i> Transaction Mix</h3>'
      +     '<span style="font-size:11px;color:var(--text-3)">Lifetime counts by type</span>'
      +   '</div>'
      +   '<div class="panel-body">'
      +     '<div class="admin-chart">'
      +       dist.map(function (d) {
              var pct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
              var width = d.count > 0 ? Math.max(4, pct) : 0;
              return ''
                + '<div class="admin-chart-row">'
                +   '<span class="label">' + esc(d.key) + '</span>'
                +   '<span class="track">'
                +     '<span class="bar ' + esc(d.cls) + '" '
                +       'style="width:' + width + '%"></span>'
                +   '</span>'
                +   '<span class="count">' + esc(comma(d.count)) + '</span>'
                + '</div>';
            }).join('')
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  /* ================================================================
     §16 — MAIN RENDER
     ================================================================ */

  function render(ctx) {
    var kpis = computeKpis();
    var users = userOptions();

    var kpisHtml = ''
      + '<div class="admin-kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">'
      +   kpiTile('fa-arrow-down-to-line', 'green',  money(kpis.totalCredited),   'Total Credited',    comma(kpis.creditsCount) + ' credits')
      +   kpiTile('fa-arrow-up-from-bracket', 'red', money(kpis.totalDebited),   'Total Debited',     comma(kpis.debitsCount) + ' debits')
      +   kpiTile('fa-scale-balanced',    'blue',   money(kpis.walletLiability), 'Wallet Liability',  'Owed to customers')
      +   kpiTile('fa-receipt',           'purple', comma(kpis.totalTxns),       'Total Transactions','All time')
      + '</div>';

    var panelHtml = ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3>'
      +       '<i class="fas fa-wallet"></i> Wallet Ledger'
      +       ' <span id="ledgerCount" style="font-weight:500;color:var(--text-3);font-size:13px;margin-left:6px"></span>'
      +     '</h3>'
      +     '<div class="panel-tools">'
      +       '<button type="button" class="btn btn-sm btn-primary" data-action="adjust">'
      +         '<i class="fas fa-plus-minus"></i> Adjust Balance'
      +       '</button>'
      +     '</div>'
      +   '</div>'

      +   '<div class="toolbar">'
      +     '<div class="search-box">'
      +       '<i class="fas fa-search"></i>'
      +       '<input type="text" id="ledgerSearch" '
      +         'placeholder="Search user, ref, description…" '
      +         'value="' + esc(state.query) + '" />'
      +     '</div>'
      +     '<select id="ledgerTypeFilter" aria-label="Filter by type">'
      +       '<option value=""' + (state.typeFilter === '' ? ' selected' : '') + '>All types</option>'
      +       TYPES.map(function (t) {
            return '<option value="' + esc(t.value) + '"'
                 + (state.typeFilter === t.value ? ' selected' : '') + '>'
                 + esc(t.label) + '</option>';
          }).join('')
      +     '</select>'
      +     '<select id="ledgerUserFilter" aria-label="Filter by user">'
      +       '<option value=""' + (state.userFilter === '' ? ' selected' : '') + '>All users</option>'
      +       users.map(function (u) {
            return '<option value="' + esc(u.id) + '"'
                 + (state.userFilter === u.id ? ' selected' : '') + '>'
                 + esc(u.name) + '</option>';
          }).join('')
      +     '</select>'
      +   '</div>'

      +   '<div class="tbl-wrap">'
      +     '<table class="table-cards">'
      +       '<thead>'
      +         '<tr>'
      +           th('user',    'User')
      +           th('type',    'Type')
      +           '<th>Description</th>'
      +           th('amount',  'Amount', 'num')
      +           th('balance', 'Balance After', 'num')
      +           th('date',    'Date')
      +         '</tr>'
      +       '</thead>'
      +       '<tbody id="ledgerTbody"></tbody>'
      +     '</table>'
      +   '</div>'

      +   '<div class="tbl-footer" id="ledgerFooter"></div>'
      + '</div>';

    return kpisHtml + renderTypeChart() + panelHtml;
  }

  function kpiTile(icon, color, value, label, sub) {
    var colorMap = {
      green:  { bg: '#ecfdf5', fg: 'var(--green)'  },
      red:    { bg: '#fef2f2', fg: 'var(--red)'    },
      blue:   { bg: '#eff6ff', fg: 'var(--blue)'   },
      purple: { bg: '#f5f3ff', fg: 'var(--purple)' },
      orange: { bg: '#fff7ed', fg: 'var(--accent)' },
      amber:  { bg: '#fffbeb', fg: 'var(--amber)'  }
    };
    var c = colorMap[color] || colorMap.blue;

    return ''
      + '<div class="admin-kpi">'
      +   '<div class="kpi-head">'
      +     '<div class="kpi-label">' + esc(label) + '</div>'
      +     '<div class="kpi-icon" style="background:' + c.bg + ';color:' + c.fg + '">'
      +       '<i class="fas ' + esc(icon) + '"></i>'
      +     '</div>'
      +   '</div>'
      +   '<div class="kpi-value">' + esc(value) + '</div>'
      +   (sub ? '<div class="kpi-trend flat">' + esc(sub) + '</div>' : '')
      + '</div>';
  }

  /* ================================================================
     §17 — BIND
     ================================================================ */

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (handler) container.removeEventListener('click', handler);

    // Pre-apply deep-link filters
    if (ctx && ctx.params) {
      if (typeof ctx.params.type === 'string') {
        state.typeFilter = ctx.params.type;
        var tf = document.getElementById('ledgerTypeFilter');
        if (tf) tf.value = ctx.params.type;
      }
      if (typeof ctx.params.userId === 'string') {
        state.userFilter = ctx.params.userId;
        var uf = document.getElementById('ledgerUserFilter');
        if (uf) uf.value = ctx.params.userId;
      }
    }

    renderRows();

    // Deep-link: open adjust modal for a specific user
    var deepUserId = ctx && ctx.params && ctx.params.userId;
    var openAdjust = ctx && ctx.params && ctx.params.adjust === true;
    if (openAdjust && deepUserId && !deepLinkHandled) {
      deepLinkHandled = true;
      setTimeout(function () { openAdjustModal(deepUserId); }, 0);
    }

    handler = function (e) {
      // Sort
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
        var s1 = document.getElementById('ledgerSearch');
        var s2 = document.getElementById('ledgerTypeFilter');
        var s3 = document.getElementById('ledgerUserFilter');
        if (s1) s1.value = state.query;
        if (s2) s2.value = state.typeFilter;
        if (s3) s3.value = state.userFilter;
        attachInputListeners();
        return;
      }

      // Pagination
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

      // Actions
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;

      var action = btn.dataset.action;

      if (action === 'adjust') {
        openAdjustModal(state.userFilter || null);
        return;
      }
      if (action === 'clear-filters') {
        state.query      = '';
        state.typeFilter = '';
        state.userFilter = '';
        state.pageNum    = 1;
        var s4 = document.getElementById('ledgerSearch');
        var s5 = document.getElementById('ledgerTypeFilter');
        var s6 = document.getElementById('ledgerUserFilter');
        if (s4) s4.value = '';
        if (s5) s5.value = '';
        if (s6) s6.value = '';
        renderRows();
        return;
      }
    };

    container.addEventListener('click', handler);
    attachInputListeners();
  }

  function attachInputListeners() {
    var searchEl = document.getElementById('ledgerSearch');
    if (searchEl && !searchEl.__wired) {
      var t = null;
      searchEl.addEventListener('input', function () {
        if (t) clearTimeout(t);
        t = setTimeout(function () {
          state.query = searchEl.value || '';
          state.pageNum = 1;
          renderRows();
        }, 140);
      });
      searchEl.__wired = true;
    }

    var typeEl = document.getElementById('ledgerTypeFilter');
    if (typeEl && !typeEl.__wired) {
      typeEl.addEventListener('change', function () {
        state.typeFilter = typeEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      typeEl.__wired = true;
    }

    var userEl = document.getElementById('ledgerUserFilter');
    if (userEl && !userEl.__wired) {
      userEl.addEventListener('change', function () {
        state.userFilter = userEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      userEl.__wired = true;
    }
  }

  /* ================================================================
     §18 — CLEANUP
     ================================================================ */

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler   = null;

    state.query      = '';
    state.typeFilter = '';
    state.userFilter = '';
    state.sortKey    = 'date';
    state.sortDir    = 'desc';
    state.pageNum    = 1;

    deepLinkHandled = false;

    if (UI.closeAllModals) UI.closeAllModals();
  }

  /* ================================================================
     §19 — REGISTER
     ================================================================ */

  var page = {
    title:    'Wallet Ledger',
    subtitle: 'Every wallet transaction, platform-wide',
    render:   render,
    bind:     bind,
    cleanup:  cleanup
  };

  if (global.Admin && typeof global.Admin.register === 'function') {
    global.Admin.register('wallet', page);
  } else {
    global.PagesAdmin = global.PagesAdmin || {};
    global.PagesAdmin.wallet = page;
  }

})(window);