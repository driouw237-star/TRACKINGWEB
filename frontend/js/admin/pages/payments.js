/* ================================================================
   GlobalExpress — Admin Payments Page
   ================================================================
   Payments management: table, search, status filter, kind filter,
   sort, pagination, receipt modal, refund action, bulk export CSV.

   Every refund:
     - adds a refund payment record (negative amount, kind=Refund)
     - adds a wallet txn (type=Refund, positive amount)
     - credits the user's wallet
     - sends a notification to the user
     - calls Admin.logAudit('payment.refund', ...)
     - emits payment:created, wallet:changed, notification:new

   Deep-link: Admin.state.params.id opens that payment's receipt.
   Admin.state.params.userId pre-applies a user filter.
   Admin.state.params.kind pre-applies a kind filter.

   Registers with Admin.register('payments', page).
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
    payments:      'ge_payments',
    walletTxns:    'ge_wallet_txns',
    notifications: 'ge_notifications'
  };

  var PAGE_SIZE = 15;

  var STATUSES = ['Paid', 'Unpaid', 'Refunded', 'Pending'];

  var KINDS = ['Deposit', 'Shipment', 'Refund', 'Withdraw'];

  var COMPANY = {
    name:    'GlobalExpress',
    tagline: 'Ship. Track. Deliver.',
    address: '100 Logistics Way, Suite 500, Wilmington, DE 19801',
    email:   'billing@globalexpress.test',
    site:    'globalexpress.test'
  };

  /* ================================================================
     §4 — MODULE STATE
     ================================================================ */

  var state = {
    query:        '',
    statusFilter: '',
    kindFilter:   '',
    userFilter:   '',
    sortKey:      'date',      // ref | amount | status | date
    sortDir:      'desc',
    pageNum:      1,
    selected:     {}           // { paymentId: true }
  };

  var handler         = null;
  var container       = null;
  var deepLinkHandled = false;

  /* ================================================================
     §5 — STORAGE READERS / WRITERS
     ================================================================ */

  function readPayments() {
    var list = storage.get(KEYS.payments, []);
    return Array.isArray(list) ? list : [];
  }

  function writePayments(list) {
    return storage.set(KEYS.payments, list);
  }

  function readUsers() {
    var list = storage.get(KEYS.users, []);
    return Array.isArray(list) ? list : [];
  }

  function writeUsers(list) {
    return storage.set(KEYS.users, list);
  }

  function readWalletTxns() {
    var list = storage.get(KEYS.walletTxns, []);
    return Array.isArray(list) ? list : [];
  }

  function writeWalletTxns(list) {
    return storage.set(KEYS.walletTxns, list);
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
          email: u.email || ''
        });
      }
    }
    return opts;
  }

  /* ================================================================
     §6 — HELPERS
     ================================================================ */

  function findPayment(id) {
    if (!id) return null;
    var list = readPayments();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

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

  function matchesQuery(p, q) {
    if (!q) return true;
    var hay = [
      p.ref        || '',
      p.userName   || '',
      p.userEmail  || '',
      p.kind       || '',
      p.method     || '',
      p.status     || '',
      String(p.amount || '')
    ].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function matchesStatus(p, status) {
    if (!status) return true;
    return p.status === status;
  }

  function matchesKind(p, kind) {
    if (!kind) return true;
    return p.kind === kind;
  }

  function matchesUser(p, userId) {
    if (!userId) return true;
    return p.userId === userId;
  }

  function kindLabel(kind) {
    if (kind === 'Deposit')  return 'Wallet Deposit';
    if (kind === 'Shipment') return 'Shipping Fee';
    if (kind === 'Refund')   return 'Refund';
    if (kind === 'Withdraw') return 'Withdrawal';
    return kind || '—';
  }

  /* ================================================================
     §7 — AUDIT + EMIT
     ================================================================ */

  function auditAndEmit(action, target, details, extras) {
    if (Admin && typeof Admin.logAudit === 'function') {
      Admin.logAudit(action, target, details);
    }
    if (Realtime && typeof Realtime.notifyLocalChange === 'function') {
      Realtime.notifyLocalChange('payment:updated', { target: target });
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
    var list = readPayments();
    var totalAll = list.length;

    var q = state.query.trim().toLowerCase();
    if (q) list = list.filter(function (p) { return matchesQuery(p, q); });

    if (state.statusFilter) {
      list = list.filter(function (p) { return matchesStatus(p, state.statusFilter); });
    }
    if (state.kindFilter) {
      list = list.filter(function (p) { return matchesKind(p, state.kindFilter); });
    }
    if (state.userFilter) {
      list = list.filter(function (p) { return matchesUser(p, state.userFilter); });
    }

    list.sort(comparePayments);

    var totalFiltered = list.length;
    var totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
    if (state.pageNum > totalPages) state.pageNum = totalPages;
    if (state.pageNum < 1) state.pageNum = 1;

    var start = (state.pageNum - 1) * PAGE_SIZE;
    var slice = list.slice(start, start + PAGE_SIZE);

    return {
      all:        totalAll,
      filtered:   totalFiltered,
      slice:      slice,
      start:      start,
      end:        Math.min(start + PAGE_SIZE, totalFiltered),
      totalPages: totalPages
    };
  }

  function comparePayments(a, b) {
    var key = state.sortKey;
    var dir = state.sortDir === 'asc' ? 1 : -1;

    var va, vb;
    if (key === 'ref') {
      va = (a.ref || '').toLowerCase();
      vb = (b.ref || '').toLowerCase();
    } else if (key === 'amount') {
      va = Math.abs(Number(a.amount) || 0);
      vb = Math.abs(Number(b.amount) || 0);
    } else if (key === 'status') {
      va = (a.status || '').toLowerCase();
      vb = (b.status || '').toLowerCase();
    } else {
      va = parseDateSafe(a.at);
      vb = parseDateSafe(b.at);
    }

    if (va < vb) return -1 * dir;
    if (va > vb) return  1 * dir;
    return 0;
  }

  /* ================================================================
     §9 — KPI SUMMARY (small strip above the table)
     ================================================================ */

  function computeKpis() {
    var list = readPayments();
    var totalPaid   = 0;
    var totalRefund = 0;
    var paidCount   = 0;
    var refundCount = 0;

    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p) continue;
      var amt = Number(p.amount) || 0;

      if (p.status === 'Paid') {
        if (amt >= 0) { totalPaid += amt; paidCount++; }
      }
      if (p.kind === 'Refund') {
        totalRefund += Math.abs(amt);
        refundCount++;
      }
    }

    return {
      totalPaid:   totalPaid,
      totalRefund: totalRefund,
      paidCount:   paidCount,
      refundCount: refundCount,
      totalCount:  list.length
    };
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

  function rowHtml(p) {
    var isSelected = !!state.selected[p.id];
    var amt = Number(p.amount) || 0;
    var pos = amt >= 0;
    var amountCls = pos ? 'positive' : 'negative';

    return ''
      + '<tr data-id="' + esc(p.id) + '"'
      +   (isSelected ? ' class="row-selected"' : '') + '>'

      +   '<td class="hide-sm" style="width:36px">'
      +     '<label class="checkbox" style="margin:0">'
      +       '<input type="checkbox" data-row-check '
      +         'data-id="' + esc(p.id) + '"'
      +         (isSelected ? ' checked' : '') + ' />'
      +     '</label>'
      +   '</td>'

      +   '<td>'
      +     '<div class="mono" style="font-weight:600">' + esc(p.ref || '—') + '</div>'
      +     '<div class="cell-sub">' + esc(p.at || '') + '</div>'
      +   '</td>'

      +   '<td>'
      +     '<div style="font-weight:600;font-size:13px">'
      +       esc(p.userName || '—')
      +     '</div>'
      +     (p.userEmail
              ? '<div class="cell-sub">' + esc(p.userEmail) + '</div>'
              : '')
      +   '</td>'

      +   '<td>'
      +     '<div style="font-weight:600;font-size:12.5px">'
      +       esc(kindLabel(p.kind))
      +     '</div>'
      +     '<div class="cell-sub" style="text-transform:capitalize">'
      +       esc(p.method || '—')
      +     '</div>'
      +   '</td>'

      +   '<td class="num tbl-amount ' + amountCls + '" '
      +     'style="font-weight:700;font-variant-numeric:tabular-nums">'
      +     (pos ? '+' : '') + money(amt)
      +   '</td>'

      +   '<td>'
      +     '<span class="pill ' + esc(p.status || 'Paid') + '">'
      +       esc(p.status || 'Paid')
      +     '</span>'
      +   '</td>'

      +   '<td class="tbl-actions">'
      +     '<button type="button" class="btn btn-sm btn-outline" '
      +       'data-action="view" data-id="' + esc(p.id) + '" title="View receipt">'
      +       '<i class="fas fa-eye"></i>'
      +     '</button>'
      +     (canRefund(p)
              ? '<button type="button" class="btn btn-sm btn-outline" '
                + 'data-action="refund" data-id="' + esc(p.id) + '" '
                + 'title="Refund this payment" '
                + 'style="color:var(--red);border-color:#fecaca">'
                + '<i class="fas fa-rotate-left"></i>'
                + '</button>'
              : '')
      +   '</td>'

      + '</tr>';
  }

  function canRefund(p) {
    if (!p) return false;
    if (p.status === 'Refunded') return false;
    if (p.kind === 'Refund') return false;
    if (p.kind === 'Withdraw') return false;
    var amt = Number(p.amount) || 0;
    if (amt <= 0) return false;
    return true;
  }

  /* ================================================================
     §11 — EMPTY STATES
     ================================================================ */

  function emptyNoPayments() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-credit-card"></i></div>'
      +   '<h4>No payments yet</h4>'
      +   '<p>Customer deposits, shipment fees, and refunds will appear here.</p>'
      + '</div>';
  }

  function emptyNoMatch() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-magnifying-glass"></i></div>'
      +   '<h4>No matching payments</h4>'
      +   '<p>Try a different search, status, or kind filter.</p>'
      +   '<button type="button" class="btn btn-outline" data-action="clear-filters">'
      +     '<i class="fas fa-rotate-left"></i> Clear filters'
      +   '</button>'
      + '</div>';
  }

  /* ================================================================
     §12 — TABLE RENDER
     ================================================================ */

  function renderRows() {
    var tbody = document.getElementById('paymentsTbody');
    if (!tbody) return;

    var result = pipeline();

    if (result.all === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">'
        + emptyNoPayments() + '</td></tr>';
    } else if (result.filtered === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">'
        + emptyNoMatch() + '</td></tr>';
    } else {
      tbody.innerHTML = result.slice.map(rowHtml).join('');
    }

    var countEl = document.getElementById('paymentsCount');
    if (countEl) {
      countEl.textContent = result.filtered === result.all
        ? result.all + ' payment' + (result.all === 1 ? '' : 's')
        : result.filtered + ' of ' + result.all + ' payments';
    }

    renderFooter(result);
    updateBulkBar();
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
    var foot = document.getElementById('paymentsFooter');
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
     §13 — BULK BAR
     ================================================================ */

  function selectedCount() {
    return Object.keys(state.selected).length;
  }

  function updateBulkBar() {
    var bar = document.getElementById('paymentsBulkBar');
    if (!bar) return;
    var n = selectedCount();
    if (n === 0) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    var txt = document.getElementById('paymentsBulkText');
    if (txt) txt.textContent = n + ' selected';
  }

  function clearSelection() {
    state.selected = {};
    updateBulkBar();
  }

  /* ================================================================
     §14 — WRITES: REFUND
     ================================================================ */

  function refundPayment(paymentId, reason) {
    var payments = readPayments();
    var idx = -1;
    for (var i = 0; i < payments.length; i++) {
      if (payments[i] && payments[i].id === paymentId) { idx = i; break; }
    }
    if (idx === -1) { toast('Payment not found', paymentId, 'error'); return false; }

    var original = payments[idx];
    if (!canRefund(original)) {
      toast('Cannot refund', 'This payment is not refundable.', 'error');
      return false;
    }

    var refundAmount = Math.abs(Number(original.amount) || 0);
    if (refundAmount <= 0) {
      toast('Nothing to refund', 'Payment amount is zero.', 'error');
      return false;
    }

    // 1. Mark the original as Refunded
    payments[idx].status = 'Refunded';
    payments[idx].refundedAt = fmtDT();

    // 2. Append a new refund payment record
    var refundRecord = {
      id:        uid('pay'),
      userId:    original.userId,
      userName:  original.userName,
      userEmail: original.userEmail,
      amount:    -refundAmount,
      currency:  original.currency || 'XAF',
      method:    original.method || 'wallet',
      status:    'Paid',
      kind:      'Refund',
      ref:       'RFD-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      originalRef: original.ref,
      reason:    reason || '',
      at:        fmtDT()
    };
    payments.push(refundRecord);

    writePayments(payments);

    // 3. Credit the customer's wallet
    var user = findUserById(original.userId);
    var newBalance = null;
    if (user) {
      var users = readUsers();
      for (var k = 0; k < users.length; k++) {
        if (users[k] && users[k].id === user.id) {
          var old = Number(users[k].wallet) || 0;
          users[k].wallet = old + refundAmount;
          newBalance = users[k].wallet;
          break;
        }
      }
      writeUsers(users);

      // 4. Wallet txn
      var txns = readWalletTxns();
      txns.push({
        id:           uid('txn'),
        userId:       user.id,
        type:         'Refund',
        amount:       refundAmount,
        balanceAfter: newBalance,
        description:  'Refund for ' + original.ref + (reason ? ' — ' + reason : ''),
        ref:          refundRecord.ref,
        at:           fmtDT()
      });
      writeWalletTxns(txns);
    }

    // 5. Notify the customer
    var notifs = readNotifications();
    notifs.push({
      id:      uid('n'),
      userId:  original.userId,
      title:   'Payment refunded',
      message: money(refundAmount) + ' was refunded to your wallet.'
             + (reason ? ' Reason: ' + reason : ''),
      type:    'success',
      at:      fmtDT(),
      read:    false
    });
    writeNotifications(notifs);

    auditAndEmit(
      'payment.refund',
      'payment:' + original.ref,
      'Refunded ' + money(refundAmount) + ' to ' + (original.userName || original.userId)
        + (reason ? ' — ' + reason : ''),
      [
        { name: 'payment:created',   payload: refundRecord },
        { name: 'wallet:changed',    payload: { userId: original.userId, balance: newBalance, delta: refundAmount } },
        { name: 'notification:new',  payload: notifs[notifs.length - 1] }
      ]
    );

    return { refundAmount: refundAmount, newBalance: newBalance, refundRecord: refundRecord };
  }

  /* ================================================================
     §15 — EXPORT CSV
     ================================================================ */

  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function exportCSV(onlySelected) {
    var list = readPayments();

    if (onlySelected) {
      list = list.filter(function (p) { return state.selected[p.id]; });
    } else {
      var q = state.query.trim().toLowerCase();
      if (q) list = list.filter(function (p) { return matchesQuery(p, q); });
      if (state.statusFilter) list = list.filter(function (p) { return matchesStatus(p, state.statusFilter); });
      if (state.kindFilter)   list = list.filter(function (p) { return matchesKind(p, state.kindFilter); });
      if (state.userFilter)   list = list.filter(function (p) { return matchesUser(p, state.userFilter); });
    }

    var header = [
      'Ref', 'Kind', 'Method', 'Amount', 'Status',
      'User', 'Email', 'Date'
    ];
    var lines = [header.join(',')];

    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      lines.push([
        csvEscape(p.ref),
        csvEscape(p.kind),
        csvEscape(p.method),
        csvEscape(Number(p.amount) || 0),
        csvEscape(p.status),
        csvEscape(p.userName),
        csvEscape(p.userEmail),
        csvEscape(p.at)
      ].join(','));
    }

    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'globalexpress-payments-' + Date.now() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast('CSV downloaded', list.length + ' payments', 'success');
  }

  /* ================================================================
     §16 — RECEIPT MODAL
     ================================================================ */

  function receiptHtml(p, forDownload) {
    var amt = Math.abs(Number(p.amount) || 0);
    var kindText = kindLabel(p.kind);

    var styles = forDownload
      ? '<style>'
        + 'body{font-family:Inter,system-ui,sans-serif;background:#f5f7fa;color:#0f172a;padding:40px;line-height:1.55}'
        + '.wrap{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e4e8ee;border-radius:12px;padding:32px;box-shadow:0 4px 12px rgba(15,23,42,.06)}'
        + '.brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}'
        + '.logo{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#0b2545,#13315c);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:18px}'
        + '.name{font-weight:800;font-size:19px}'
        + '.tag{font-size:11px;color:#94a3b8;font-weight:600;letter-spacing:.8px;text-transform:uppercase;margin-top:2px}'
        + 'h1{font-size:22px;margin:0 0 4px}'
        + '.sub{color:#94a3b8;font-size:13px;margin-bottom:24px}'
        + '.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px 0;border-top:1px solid #eef1f5;border-bottom:1px solid #eef1f5;margin-bottom:20px}'
        + '.meta .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:#94a3b8;font-weight:700;margin-bottom:3px}'
        + '.meta .v{font-size:14px;font-weight:600;word-break:break-word}'
        + '.total{font-size:32px;font-weight:800;color:#059669;letter-spacing:-.02em}'
        + '.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px dashed #eef1f5;font-size:14px}'
        + '.row:last-child{border-bottom:none;padding-top:14px;border-top:2px solid #e4e8ee;margin-top:6px}'
        + '.row .l{color:#475569}'
        + '.row .v{font-weight:600}'
        + '.foot{margin-top:28px;padding-top:20px;border-top:1px solid #eef1f5;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6}'
        + '@media print{body{background:#fff;padding:0}.wrap{border:none;box-shadow:none;border-radius:0}}'
        + '</style>'
      : '';

    return ''
      + (forDownload
          ? '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt '
            + esc(p.ref) + '</title>' + styles + '</head><body>'
          : '')

      + '<div class="wrap">'

      +   '<div class="brand">'
      +     '<div class="logo">GE</div>'
      +     '<div>'
      +       '<div class="name">' + esc(COMPANY.name) + '</div>'
      +       '<div class="tag">' + esc(COMPANY.tagline) + '</div>'
      +     '</div>'
      +   '</div>'

      +   '<h1>Receipt</h1>'
      +   '<div class="sub">Reference <strong>' + esc(p.ref || '—') + '</strong></div>'

      +   '<div class="meta">'
      +     '<div><div class="k">Billed To</div><div class="v">'
      +       esc(p.userName || '—') + '</div></div>'
      +     '<div><div class="k">Email</div><div class="v">'
      +       esc(p.userEmail || '—') + '</div></div>'
      +     '<div><div class="k">Date</div><div class="v">'
      +       esc(p.at || '—') + '</div></div>'
      +     '<div><div class="k">Payment Method</div><div class="v" style="text-transform:capitalize">'
      +       esc(p.method || '—') + '</div></div>'
      +   '</div>'

      +   '<div style="text-align:center;padding:8px 0 18px">'
      +     '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:700;margin-bottom:6px">Total</div>'
      +     '<div class="total">' + esc(money(amt)) + '</div>'
      +   '</div>'

      +   '<div class="row"><span class="l">Description</span><span class="v">'
      +     esc(kindText) + '</span></div>'
      +   '<div class="row"><span class="l">Status</span><span class="v">'
      +     esc(p.status || 'Paid') + '</span></div>'
      +   '<div class="row"><span class="l">Currency</span><span class="v">'
      +     esc(p.currency || 'XAF') + '</span></div>'
      +   '<div class="row"><span class="l">Amount</span><span class="total" style="font-size:20px;color:#FF6B35">'
      +     esc(money(amt)) + '</span></div>'

      +   '<div class="foot">'
      +     esc(COMPANY.name) + ' · ' + esc(COMPANY.address) + '<br>'
      +     esc(COMPANY.email) + ' · ' + esc(COMPANY.site)
      +   '</div>'

      + '</div>'
      + (forDownload ? '</body></html>' : '');
  }

  function openReceiptModal(paymentId) {
    var p = findPayment(paymentId);
    if (!p) { toast('Payment not found', '', 'error'); return; }

    var refundable = canRefund(p);

    var modal = openModal(''
      + '<div class="modal wide">'
      +   '<div class="modal-head">'
      +     '<div>'
      +       '<h3><i class="fas fa-receipt"></i> Receipt</h3>'
      +       '<div class="sub">' + esc(p.ref || '—') + '</div>'
      +     '</div>'
      +     '<button type="button" class="modal-close" data-close aria-label="Close">'
      +       '<i class="fas fa-times"></i>'
      +     '</button>'
      +   '</div>'
      +   '<div class="modal-body" style="background:var(--surface-2);padding:24px">'
      +     '<div style="background:#fff;border:1px solid var(--border);'
      +       'border-radius:12px;padding:24px;max-width:640px;margin:0 auto">'
      +       receiptHtml(p, false)
      +     '</div>'
      +   '</div>'
      +   '<div class="modal-foot" style="flex-wrap:wrap">'
      +     '<button type="button" class="btn btn-outline" data-close>Close</button>'
      +     '<button type="button" class="btn btn-outline" data-action="print">'
      +       '<i class="fas fa-print"></i> Print'
      +     '</button>'
      +     '<button type="button" class="btn btn-outline" data-action="download" data-id="' + esc(p.id) + '">'
      +       '<i class="fas fa-download"></i> Download'
      +     '</button>'
      +     (refundable
              ? '<button type="button" class="btn btn-danger" style="margin-left:auto" '
                + 'data-action="refund" data-id="' + esc(p.id) + '">'
                + '<i class="fas fa-rotate-left"></i> Refund'
                + '</button>'
              : '')
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }

      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'print') {
        printReceipt(p);
        return;
      }
      if (action === 'download') {
        downloadReceipt(p);
        toast('Receipt downloaded', p.ref, 'success');
        return;
      }
      if (action === 'refund') {
        closeModal(modal);
        setTimeout(function () { openRefundModal(p.id); }, 220);
      }
    });
  }

  function printReceipt(p) {
    var w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { toast('Popup blocked', 'Allow popups to print.', 'error'); return; }
    w.document.write(receiptHtml(p, true));
    w.document.close();
    setTimeout(function () {
      try { w.focus(); w.print(); } catch (e) { /* ignore */ }
    }, 250);
  }

  function downloadReceipt(p) {
    var html = receiptHtml(p, true);
    var blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'receipt-' + (p.ref || p.id) + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ================================================================
     §17 — REFUND MODAL
     ================================================================ */

  function openRefundModal(paymentId) {
    var p = findPayment(paymentId);
    if (!p) { toast('Payment not found', '', 'error'); return; }

    if (!canRefund(p)) {
      toast('Cannot refund', 'This payment is not refundable.', 'error');
      return;
    }

    var amt = Math.abs(Number(p.amount) || 0);

    var modal = openModal(''
      + '<div class="modal narrow">'
      +   '<div class="modal-head">'
      +     '<div>'
      +       '<h3><i class="fas fa-rotate-left"></i> Refund Payment</h3>'
      +       '<div class="sub">' + esc(p.ref) + ' · ' + esc(money(amt)) + '</div>'
      +     '</div>'
      +     '<button type="button" class="modal-close" data-close aria-label="Close">'
      +       '<i class="fas fa-times"></i>'
      +     '</button>'
      +   '</div>'
      +   '<div class="modal-body">'

      +     '<div style="padding:14px 16px;background:#fef2f2;'
      +       'border:1px solid #fecaca;border-radius:10px;margin-bottom:16px">'
      +       '<div style="font-weight:600;font-size:13px;color:#991b1b;margin-bottom:4px">'
      +         '<i class="fas fa-circle-exclamation"></i> This action cannot be undone'
      +       '</div>'
      +       '<div style="font-size:12.5px;color:#991b1b;line-height:1.55">'
      +         money(amt) + ' will be credited to '
      +         '<strong>' + esc(p.userName || p.userEmail || p.userId) + '</strong>\'s wallet, '
      +         'and this payment will be marked as Refunded.'
      +       '</div>'
      +     '</div>'

      +     '<div class="field" style="margin:0">'
      +       '<label>Reason for refund <span class="req">*</span></label>'
      +       '<input type="text" id="refundReason" '
      +         'placeholder="e.g. Duplicate payment, shipment cancelled" maxlength="140" />'
      +       '<div class="hint">Visible to the customer in their notifications.</div>'
      +     '</div>'

      +   '</div>'
      +   '<div class="modal-foot">'
      +     '<button type="button" class="btn btn-outline" data-close>Cancel</button>'
      +     '<button type="button" class="btn btn-danger" data-confirm>'
      +       '<i class="fas fa-rotate-left"></i> Refund ' + money(amt)
      +     '</button>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }

      if (e.target.closest && e.target.closest('[data-confirm]')) {
        var reasonEl = document.getElementById('refundReason');
        var reason = (reasonEl && reasonEl.value || '').trim();

        if (!reason) {
          toast('Reason is required', '', 'error');
          return;
        }

        var result = refundPayment(paymentId, reason);
        closeModal(modal);

        if (result) {
          toast(
            'Refund processed',
            money(result.refundAmount) + ' credited to ' + (p.userName || p.userEmail),
            'success'
          );
          renderRows();
        }
      }
    });
  }

  /* ================================================================
     §18 — MAIN RENDER
     ================================================================ */

  function render(ctx) {
    var kpis = computeKpis();
    var users = userOptions();

    var statsHtml = ''
      + '<div class="admin-kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">'
      +   kpiTile('fa-coins',           'green',  money(kpis.totalPaid),   'Total Paid Out',   comma(kpis.paidCount) + ' payments')
      +   kpiTile('fa-rotate-left',     'red',    money(kpis.totalRefund), 'Total Refunded',   comma(kpis.refundCount) + ' refunds')
      +   kpiTile('fa-receipt',         'blue',   comma(kpis.totalCount),  'All Payments',     'Lifetime')
      +   kpiTile('fa-chart-line',      'purple', money(kpis.totalPaid - kpis.totalRefund), 'Net Revenue', 'After refunds')
      + '</div>';

    var panelHtml = ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3>'
      +       '<i class="fas fa-credit-card"></i> Payments'
      +       ' <span id="paymentsCount" style="font-weight:500;color:var(--text-3);font-size:13px;margin-left:6px"></span>'
      +     '</h3>'
      +     '<div class="panel-tools">'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="export">'
      +         '<i class="fas fa-file-csv"></i> Export CSV'
      +       '</button>'
      +     '</div>'
      +   '</div>'

      +   '<div class="toolbar">'
      +     '<div class="search-box">'
      +       '<i class="fas fa-search"></i>'
      +       '<input type="text" id="paymentsSearch" '
      +         'placeholder="Search ref, user, method…" '
      +         'value="' + esc(state.query) + '" />'
      +     '</div>'
      +     '<select id="paymentsStatusFilter" aria-label="Filter by status">'
      +       '<option value=""' + (state.statusFilter === '' ? ' selected' : '') + '>All statuses</option>'
      +       STATUSES.map(function (s) {
            return '<option value="' + esc(s) + '"'
                 + (state.statusFilter === s ? ' selected' : '') + '>'
                 + esc(s) + '</option>';
          }).join('')
      +     '</select>'
      +     '<select id="paymentsKindFilter" aria-label="Filter by kind">'
      +       '<option value=""' + (state.kindFilter === '' ? ' selected' : '') + '>All kinds</option>'
      +       KINDS.map(function (k) {
            return '<option value="' + esc(k) + '"'
                 + (state.kindFilter === k ? ' selected' : '') + '>'
                 + esc(k) + '</option>';
          }).join('')
      +     '</select>'
      +     '<select id="paymentsUserFilter" aria-label="Filter by user">'
      +       '<option value=""' + (state.userFilter === '' ? ' selected' : '') + '>All users</option>'
      +       users.map(function (u) {
            return '<option value="' + esc(u.id) + '"'
                 + (state.userFilter === u.id ? ' selected' : '') + '>'
                 + esc(u.name) + '</option>';
          }).join('')
      +     '</select>'
      +   '</div>'

      +   '<div id="paymentsBulkBar" class="bulk-bar hidden">'
      +     '<span id="paymentsBulkText" style="font-weight:600;font-size:13px">0 selected</span>'
      +     '<div style="display:flex;gap:8px;margin-left:auto">'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="bulk-export">'
      +         '<i class="fas fa-download"></i> Export selected'
      +       '</button>'
      +       '<button type="button" class="btn btn-sm btn-ghost" data-action="bulk-clear">'
      +         'Clear'
      +       '</button>'
      +     '</div>'
      +   '</div>'

      +   '<div class="tbl-wrap">'
      +     '<table class="table-cards">'
      +       '<thead>'
      +         '<tr>'
      +           '<th class="hide-sm" style="width:36px">'
      +             '<input type="checkbox" id="paymentsSelectAll" aria-label="Select all on page" />'
      +           '</th>'
      +           th('ref',    'Reference')
      +           '<th>User</th>'
      +           '<th>Description</th>'
      +           th('amount', 'Amount', 'num')
      +           th('status', 'Status')
      +           '<th class="tbl-actions">Actions</th>'
      +         '</tr>'
      +       '</thead>'
      +       '<tbody id="paymentsTbody"></tbody>'
      +     '</table>'
      +   '</div>'

      +   '<div class="tbl-footer" id="paymentsFooter"></div>'
      + '</div>';

    return statsHtml + panelHtml;
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
      +   (sub
            ? '<div class="kpi-trend flat">' + esc(sub) + '</div>'
            : '')
      + '</div>';
  }

  /* ================================================================
     §19 — BIND
     ================================================================ */

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (handler) container.removeEventListener('click', handler);

    // Pre-apply deep-link filters
    if (ctx && ctx.params) {
      if (typeof ctx.params.kind === 'string') {
        state.kindFilter = ctx.params.kind;
        var kf = document.getElementById('paymentsKindFilter');
        if (kf) kf.value = ctx.params.kind;
      }
      if (typeof ctx.params.userId === 'string') {
        state.userFilter = ctx.params.userId;
        var uf = document.getElementById('paymentsUserFilter');
        if (uf) uf.value = ctx.params.userId;
      }
      if (typeof ctx.params.status === 'string') {
        state.statusFilter = ctx.params.status;
        var sf = document.getElementById('paymentsStatusFilter');
        if (sf) sf.value = ctx.params.status;
      }
    }

    renderRows();

    // Deep-link to a specific receipt
    var deepId = ctx && ctx.params && ctx.params.id;
    if (deepId && !deepLinkHandled) {
      deepLinkHandled = true;
      setTimeout(function () {
        if (findPayment(deepId)) openReceiptModal(deepId);
        else toast('Payment not found', '', 'info');
      }, 0);
    }

    handler = function (e) {
      // Checkbox
      var rowCheck = e.target.closest && e.target.closest('[data-row-check]');
      if (rowCheck) {
        var id = rowCheck.dataset.id;
        if (rowCheck.checked) state.selected[id] = true;
        else delete state.selected[id];
        var tr = rowCheck.closest('tr');
        if (tr) tr.classList.toggle('row-selected', rowCheck.checked);
        updateBulkBar();
        return;
      }

      // Select-all
      if (e.target && e.target.id === 'paymentsSelectAll') {
        var checked = e.target.checked;
        if (checked) {
          var current = pipeline().slice;
          for (var i = 0; i < current.length; i++) {
            state.selected[current[i].id] = true;
          }
        } else {
          state.selected = {};
        }
        renderRows();
        return;
      }

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
        // Restore filter inputs
        var s1 = document.getElementById('paymentsSearch');
        var s2 = document.getElementById('paymentsStatusFilter');
        var s3 = document.getElementById('paymentsKindFilter');
        var s4 = document.getElementById('paymentsUserFilter');
        if (s1) s1.value = state.query;
        if (s2) s2.value = state.statusFilter;
        if (s3) s3.value = state.kindFilter;
        if (s4) s4.value = state.userFilter;
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
      var pid = btn.dataset.id;

      if (action === 'view')        { openReceiptModal(pid); return; }
      if (action === 'refund')      { openRefundModal(pid); return; }
      if (action === 'export')      { exportCSV(false); return; }
      if (action === 'bulk-export') { exportCSV(true); return; }
      if (action === 'bulk-clear')  { clearSelection(); renderRows(); return; }
      if (action === 'clear-filters') {
        state.query = '';
        state.statusFilter = '';
        state.kindFilter = '';
        state.userFilter = '';
        state.pageNum = 1;
        var s5 = document.getElementById('paymentsSearch');
        var s6 = document.getElementById('paymentsStatusFilter');
        var s7 = document.getElementById('paymentsKindFilter');
        var s8 = document.getElementById('paymentsUserFilter');
        if (s5) s5.value = '';
        if (s6) s6.value = '';
        if (s7) s7.value = '';
        if (s8) s8.value = '';
        renderRows();
        return;
      }

      // Row click → open receipt
      var row = e.target.closest && e.target.closest('tr[data-id]');
      if (row) {
        if (e.target.closest('button')) return;
        if (e.target.closest('input')) return;
        if (e.target.closest('a')) return;
        openReceiptModal(row.dataset.id);
        return;
      }
    };

    container.addEventListener('click', handler);
    attachInputListeners();
  }

  function attachInputListeners() {
    var searchEl = document.getElementById('paymentsSearch');
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

    var statusEl = document.getElementById('paymentsStatusFilter');
    if (statusEl && !statusEl.__wired) {
      statusEl.addEventListener('change', function () {
        state.statusFilter = statusEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      statusEl.__wired = true;
    }

    var kindEl = document.getElementById('paymentsKindFilter');
    if (kindEl && !kindEl.__wired) {
      kindEl.addEventListener('change', function () {
        state.kindFilter = kindEl.value || '';
        state.pageNum = 1;
        renderRows();
      });
      kindEl.__wired = true;
    }

    var userEl = document.getElementById('paymentsUserFilter');
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
     §20 — CLEANUP
     ================================================================ */

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler   = null;

    state.query        = '';
    state.statusFilter = '';
    state.kindFilter   = '';
    state.userFilter   = '';
    state.sortKey      = 'date';
    state.sortDir      = 'desc';
    state.pageNum      = 1;
    state.selected     = {};

    deepLinkHandled = false;

    if (UI.closeAllModals) UI.closeAllModals();
  }

  /* ================================================================
     §21 — REGISTER
     ================================================================ */

  var page = {
    title:    'Payments',
    subtitle: 'Every transaction on the platform',
    render:   render,
    bind:     bind,
    cleanup:  cleanup
  };

  if (global.Admin && typeof global.Admin.register === 'function') {
    global.Admin.register('payments', page);
  } else {
    global.PagesAdmin = global.PagesAdmin || {};
    global.PagesAdmin.payments = page;
  }

})(window);