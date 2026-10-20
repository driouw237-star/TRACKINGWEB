/* GlobalExpress - pages/payment-history.js
   Payment history page: full audit view of every payment record
   (deposits, shipment fees, refunds, withdrawals). Includes search,
   kind filter, status filter, sort, pagination, CSV export.

   Registers itself via App.register('payment-history', page).
   Reads from Store (payments). Read-only page.
*/
(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var Store = global.Store || {};

  // --- Fallbacks -----------------------------------------------------------

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var money = Utils.money || function (n) {
    return 'Fr. ' + Number(n || 0).toLocaleString();
  };

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };

  // --- Constants -----------------------------------------------------------

  var PAGE_SIZE = 15;
  var KINDS = ['Deposit', 'Shipment', 'Refund', 'Withdraw'];
  var STATUSES = ['Paid', 'Unpaid', 'Refunded'];

  // --- Module state --------------------------------------------------------

  var query  = '';
  var kindFilter = '';
  var statusFilter = '';
  var sortKey = 'date';
  var sortDir = 'desc';
  var pageNum = 1;

  var handler = null;
  var container = null;

  // --- Helpers -------------------------------------------------------------

  function currentUser(ctx) {
    return (ctx && ctx.user) || (global.App && global.App.state && global.App.state.user) || null;
  }

  function getUserPayments(userId) {
    var all = [];
    try { all = Store.get('payments') || []; } catch (e) {}
    if (!userId) return [];
    return all.filter(function (p) { return p.userId === userId; });
  }

  function parseDate(s) {
    if (!s) return 0;
    var iso = Date.parse(s);
    if (!isNaN(iso)) return iso;
    var cleaned = String(s).replace('·', '').trim();
    var d = Date.parse(cleaned);
    return isNaN(d) ? 0 : d;
  }

  function matchesQuery(p, q) {
    if (!q) return true;
    var hay = [
      p.ref || '',
      p.kind || '',
      p.method || '',
      p.status || '',
      String(p.amount || '')
    ].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function sortPayments(list) {
    var key = sortKey;
    var dir = sortDir === 'asc' ? 1 : -1;

    var sorted = list.slice();
    sorted.sort(function (a, b) {
      var va, vb;
      if (key === 'ref')       { va = (a.ref || '').toLowerCase();    vb = (b.ref || '').toLowerCase(); }
      else if (key === 'amount')  { va = Math.abs(Number(a.amount || 0)); vb = Math.abs(Number(b.amount || 0)); }
      else if (key === 'status')  { va = (a.status || '').toLowerCase(); vb = (b.status || '').toLowerCase(); }
      else                     { va = parseDate(a.at);                vb = parseDate(b.at); }

      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return 0;
    });
    return sorted;
  }

  function paginate(list) {
    var totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (pageNum > totalPages) pageNum = totalPages;
    if (pageNum < 1) pageNum = 1;
    var start = (pageNum - 1) * PAGE_SIZE;
    return {
      slice: list.slice(start, start + PAGE_SIZE),
      total: list.length,
      totalPages: totalPages,
      start: start,
      end: Math.min(start + PAGE_SIZE, list.length)
    };
  }

  function pipeline(userId) {
    var list = getUserPayments(userId);
    var total = list.length;

    var q = query.trim().toLowerCase();
    if (q) list = list.filter(function (p) { return matchesQuery(p, q); });

    if (kindFilter)   list = list.filter(function (p) { return p.kind === kindFilter; });
    if (statusFilter) list = list.filter(function (p) { return p.status === statusFilter; });

    list = sortPayments(list);
    var paged = paginate(list);

    return {
      all: total,
      filtered: list.length,
      slice: paged.slice,
      start: paged.start,
      end: paged.end,
      totalPages: paged.totalPages
    };
  }

  // --- Stat helper ---------------------------------------------------------

  function statCard(icon, color, value, label) {
    return ''
      + '<div class="stat">'
      +   '<div class="stat-head">'
      +     '<div class="stat-label">' + esc(label) + '</div>'
      +     '<div class="stat-icon ' + esc(color) + '"><i class="fas ' + esc(icon) + '"></i></div>'
      +   '</div>'
      +   '<div class="stat-value">' + esc(value) + '</div>'
      + '</div>';
  }

  function computeStats(userId) {
    var list = getUserPayments(userId);
    var paid = 0, deposits = 0, shipments = 0, refunds = 0, withdraws = 0;

    list.forEach(function (p) {
      if (p.status === 'Paid') paid += Math.abs(Number(p.amount || 0));
      if (p.kind === 'Deposit')  deposits++;
      if (p.kind === 'Shipment') shipments++;
      if (p.kind === 'Refund')   refunds++;
      if (p.kind === 'Withdraw') withdraws++;
    });

    return { paid: paid, deposits: deposits, shipments: shipments, refunds: refunds, withdraws: withdraws, count: list.length };
  }

  // --- Sortable th ---------------------------------------------------------

  function th(key, label, extra) {
    var active = (sortKey === key) ? sortDir : '';
    return '<th data-sort-key="' + esc(key) + '"'
         + (extra ? ' class="' + esc(extra) + '"' : '')
         + (active ? ' data-sort="' + esc(active) + '"' : '')
         + '>' + esc(label) + '</th>';
  }

  // --- Row -----------------------------------------------------------------

  function paymentRow(p) {
    var amt = Number(p.amount || 0);
    var kindLabel = p.kind === 'Deposit' ? 'Wallet Deposit'
                  : p.kind === 'Shipment' ? 'Shipping Fee'
                  : p.kind === 'Refund'   ? 'Refund'
                  : p.kind === 'Withdraw' ? 'Withdrawal'
                  : (p.kind || '—');

    return ''
      + '<tr>'
      +   '<td class="mono">' + esc(p.ref || '—') + '</td>'
      +   '<td>'
      +     '<div style="font-weight:600;font-size:13px">' + esc(kindLabel) + '</div>'
      +     '<div class="cell-sub" style="text-transform:capitalize">' + esc(p.method || '—') + '</div>'
      +   '</td>'
      +   '<td class="num" style="font-weight:700;color:' + (amt >= 0 ? 'var(--green)' : 'var(--red)') + '">'
      +     (amt >= 0 ? '+' : '') + money(amt)
      +   '</td>'
      +   '<td><span class="pill ' + esc(p.status || 'Paid') + '">' + esc(p.status || 'Paid') + '</span></td>'
      +   '<td style="font-size:12px;color:var(--text-3)">' + esc(p.at || '—') + '</td>'
      + '</tr>';
  }

  // --- Empty states --------------------------------------------------------

  function emptyNoPayments() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-receipt"></i></div>'
      +   '<h4>No payments yet</h4>'
      +   '<p>Your payment history will appear here after your first deposit or shipment.</p>'
      +   '<button type="button" class="btn btn-primary" data-action="deposit">'
      +     '<i class="fas fa-plus"></i> Deposit Money'
      +   '</button>'
      + '</div>';
  }

  function emptyNoMatch() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-magnifying-glass"></i></div>'
      +   '<h4>No matching payments</h4>'
      +   '<p>Try adjusting your search or filters.</p>'
      +   '<button type="button" class="btn btn-outline" data-action="clear-filters">'
      +     '<i class="fas fa-rotate-left"></i> Clear filters'
      +   '</button>'
      + '</div>';
  }

  // --- Body ----------------------------------------------------------------

  function renderRows(userId) {
    var result = pipeline(userId);
    var tbody = document.getElementById('payTbody');
    if (!tbody) return;

    if (result.all === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">' + emptyNoPayments() + '</td></tr>';
    } else if (result.filtered === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">' + emptyNoMatch() + '</td></tr>';
    } else {
      tbody.innerHTML = result.slice.map(paymentRow).join('');
    }

    var count = document.getElementById('payCount');
    if (count) {
      count.textContent = (result.filtered === result.all)
        ? (result.all + ' payment' + (result.all === 1 ? '' : 's'))
        : (result.filtered + ' of ' + result.all + ' payments');
    }

    renderFooter(result);
  }

  function renderFooter(result) {
    var foot = document.getElementById('payFooter');
    if (!foot) return;
    if (result.filtered === 0) { foot.innerHTML = ''; return; }

    var showing = (result.start + 1) + '–' + result.end + ' of ' + result.filtered;
    var pageBtns = '';
    var range = windowedRange(result.totalPages, pageNum, 2);
    for (var i = 0; i < range.length; i++) {
      var p = range[i];
      if (p === '…') pageBtns += '<button type="button" disabled>…</button>';
      else pageBtns += '<button type="button" data-page="' + p + '"' + (p === pageNum ? ' class="active"' : '') + '>' + p + '</button>';
    }

    foot.innerHTML = ''
      + '<div class="count">Showing <strong>' + showing + '</strong></div>'
      + '<div class="pages">'
      +   '<button type="button" data-page-prev ' + (pageNum === 1 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>'
      +   pageBtns
      +   '<button type="button" data-page-next ' + (pageNum >= result.totalPages ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button>'
      + '</div>';
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

  function exportCSV(userId) {
    var result = pipeline(userId);
    var header = ['Reference', 'Kind', 'Method', 'Amount', 'Status', 'Date'];
    var lines = [header.join(',')];
    result.slice.forEach(function (p) {
      lines.push([
        '"' + String(p.ref || '').replace(/"/g, '""') + '"',
        '"' + String(p.kind || '').replace(/"/g, '""') + '"',
        '"' + String(p.method || '').replace(/"/g, '""') + '"',
        Number(p.amount || 0),
        p.status || '',
        '"' + String(p.at || '').replace(/"/g, '""') + '"'
      ].join(','));
    });

    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'globalexpress-payments-' + Date.now() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('CSV downloaded', result.slice.length + ' payments', 'success');
  }

  // --- Render --------------------------------------------------------------

  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    var stats = computeStats(user.id);

    return ''
      + '<div class="stats">'
      +   statCard('fa-coins',           'green',  money(stats.paid),      'Total Paid')
      +   statCard('fa-circle-plus',     'cyan',   stats.deposits,         'Deposits')
      +   statCard('fa-truck-fast',      'orange', stats.shipments,        'Shipment Fees')
      +   statCard('fa-rotate-left',     'purple', stats.refunds,          'Refunds')
      + '</div>'

      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-receipt"></i> Payment History'
      +       ' <span id="payCount" style="font-weight:500;color:var(--text-3);font-size:13px;margin-left:6px"></span>'
      +     '</h3>'
      +     '<div class="panel-tools">'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="export"><i class="fas fa-file-csv"></i> Export CSV</button>'
      +     '</div>'
      +   '</div>'

      +   '<div class="toolbar">'
      +     '<div class="search-box">'
      +       '<i class="fas fa-search"></i>'
      +       '<input type="text" id="paySearch" placeholder="Search reference, method, amount…" value="' + esc(query) + '" />'
      +     '</div>'
      +     '<select id="payKind" aria-label="Filter by kind">'
      +       '<option value="">All kinds</option>'
      +       KINDS.map(function (k) {
              return '<option value="' + esc(k) + '"' + (kindFilter === k ? ' selected' : '') + '>' + esc(k) + '</option>';
            }).join('')
      +     '</select>'
      +     '<select id="payStatus" aria-label="Filter by status">'
      +       '<option value="">All statuses</option>'
      +       STATUSES.map(function (s) {
              return '<option value="' + esc(s) + '"' + (statusFilter === s ? ' selected' : '') + '>' + esc(s) + '</option>';
            }).join('')
      +     '</select>'
      +   '</div>'

      +   '<div class="tbl-wrap">'
      +     '<table class="table-cards">'
      +       '<thead>'
      +         '<tr>'
      +           th('ref', 'Reference')
      +           '<th>Description</th>'
      +           th('amount', 'Amount', 'num')
      +           th('status', 'Status')
      +           th('date', 'Date')
      +         '</tr>'
      +       '</thead>'
      +       '<tbody id="payTbody"></tbody>'
      +     '</table>'
      +   '</div>'

      +   '<div class="tbl-footer" id="payFooter"></div>'
      + '</div>';
  }

  // --- Bind ----------------------------------------------------------------

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    var user = currentUser(ctx);
    if (user) renderRows(user.id);

    handler = function (e) {
      var thEl = e.target.closest && e.target.closest('[data-sort-key]');
      if (thEl) {
        var key = thEl.dataset.sortKey;
        if (key === sortKey) sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
        else { sortKey = key; sortDir = 'asc'; }
        pageNum = 1;
        rerender(user);
        return;
      }

      var pageBtn = e.target.closest && e.target.closest('[data-page]');
      if (pageBtn) { pageNum = parseInt(pageBtn.dataset.page, 10) || 1; rerender(user); return; }

      if (e.target.closest && e.target.closest('[data-page-prev]')) {
        if (pageNum > 1) { pageNum--; rerender(user); }
        return;
      }
      if (e.target.closest && e.target.closest('[data-page-next]')) {
        pageNum++; rerender(user);
        return;
      }

      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'deposit') {
        if (global.App && global.App.go) global.App.go('deposit');
        return;
      }
      if (action === 'export') {
        exportCSV(user.id);
        return;
      }
      if (action === 'clear-filters') {
        query = ''; kindFilter = ''; statusFilter = ''; pageNum = 1;
        var s1 = document.getElementById('paySearch');
        var s2 = document.getElementById('payKind');
        var s3 = document.getElementById('payStatus');
        if (s1) s1.value = '';
        if (s2) s2.value = '';
        if (s3) s3.value = '';
        rerender(user);
        return;
      }
    };

    container.addEventListener('click', handler);

    var searchEl = document.getElementById('paySearch');
    if (searchEl) {
      var t = null;
      searchEl.addEventListener('input', function () {
        if (t) clearTimeout(t);
        t = setTimeout(function () {
          query = searchEl.value || '';
          pageNum = 1;
          rerender(user);
        }, 140);
      });
    }

    var kindEl = document.getElementById('payKind');
    if (kindEl) {
      kindEl.addEventListener('change', function () {
        kindFilter = kindEl.value || '';
        pageNum = 1;
        rerender(user);
      });
    }

    var statusEl = document.getElementById('payStatus');
    if (statusEl) {
      statusEl.addEventListener('change', function () {
        statusFilter = statusEl.value || '';
        pageNum = 1;
        rerender(user);
      });
    }
  }

  function rerender(user) {
    if (user) renderRows(user.id);
  }

  // --- Cleanup -------------------------------------------------------------

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler = null;
    query = '';
    kindFilter = '';
    statusFilter = '';
    sortKey = 'date';
    sortDir = 'desc';
    pageNum = 1;
  }

  // --- Register ------------------------------------------------------------

  var page = {
    title: 'Payment History',
    subtitle: 'All your payments in one place',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('payment-history', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages['payment-history'] = page;
  }

})(window);