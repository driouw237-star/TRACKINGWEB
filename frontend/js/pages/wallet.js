/* GlobalExpress - pages/wallet.js
   Wallet page: compact hero, three stat cards (Deposited / Spent / Refunded),
   full transaction history table with search, type filter, date range, sort,
   pagination, CSV export, empty states.

   Registers itself via App.register('wallet', page).
   Reads from Store (walletTxns).
   Realtime refresh handled by app.js — this page is stateless.
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
  var TYPES = ['Deposit', 'Withdraw', 'Shipment', 'Refund'];

  // --- Module state --------------------------------------------------------

  var query  = '';
  var typeFilter = '';
  var fromDate = '';
  var toDate   = '';
  var sortKey  = 'date';
  var sortDir  = 'desc';
  var pageNum  = 1;

  var handler = null;
  var container = null;

  // --- Helpers -------------------------------------------------------------

  function currentUser(ctx) {
    return (ctx && ctx.user) || (global.App && global.App.state && global.App.state.user) || null;
  }

  function getTxns(userId) {
    var all = [];
    try { all = Store.get('walletTxns') || []; } catch (e) {}
    if (!userId) return [];
    return all.filter(function (t) { return t.userId === userId; });
  }

  function parseDate(s) {
    if (!s) return 0;
    // Try ISO first (fast path)
    var iso = Date.parse(s);
    if (!isNaN(iso)) return iso;
    // Strip the "·" separator used in fmtDT output
    var cleaned = String(s).replace('·', '').trim();
    var d = Date.parse(cleaned);
    return isNaN(d) ? 0 : d;
  }

  function startOfDay(t) {
    var d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function endOfDay(t) {
    var d = new Date(t);
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }

  function matchesQuery(t, q) {
    if (!q) return true;
    var hay = [
      t.description || '',
      t.ref || '',
      t.type || '',
      t.method || ''
    ].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function inDateRange(t, from, to) {
    if (!from && !to) return true;
    var ts = parseDate(t.at);
    if (!ts) return true;
    if (from) {
      var f = startOfDay(Date.parse(from));
      if (ts < f) return false;
    }
    if (to) {
      var e = endOfDay(Date.parse(to));
      if (ts > e) return false;
    }
    return true;
  }

  function sortTxns(list) {
    var key = sortKey;
    var dir = sortDir === 'asc' ? 1 : -1;

    var sorted = list.slice();
    sorted.sort(function (a, b) {
      var va, vb;

      if (key === 'type') {
        va = (a.type || '').toLowerCase();
        vb = (b.type || '').toLowerCase();
      } else if (key === 'amount') {
        va = Number(a.amount || 0);
        vb = Number(b.amount || 0);
      } else if (key === 'balance') {
        va = Number(a.balanceAfter || 0);
        vb = Number(b.balanceAfter || 0);
      } else { // date
        va = parseDate(a.at);
        vb = parseDate(b.at);
      }

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
    var list = getTxns(userId);
    var total = list.length;

    var q = query.trim().toLowerCase();
    if (q) list = list.filter(function (t) { return matchesQuery(t, q); });

    if (typeFilter) list = list.filter(function (t) { return t.type === typeFilter; });

    if (fromDate || toDate) list = list.filter(function (t) { return inDateRange(t, fromDate, toDate); });

    list = sortTxns(list);
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

  // --- Stat computation ----------------------------------------------------

  function computeStats(userId) {
    var list = getTxns(userId);
    var deposited = 0, spent = 0, refunded = 0, withdrawn = 0;

    list.forEach(function (t) {
      var amt = Number(t.amount || 0);
      if (t.type === 'Deposit') deposited += amt;
      else if (t.type === 'Shipment') spent += Math.abs(amt);
      else if (t.type === 'Refund') refunded += amt;
      else if (t.type === 'Withdraw') withdrawn += Math.abs(amt);
    });

    return {
      deposited: deposited,
      spent: spent,
      refunded: refunded,
      withdrawn: withdrawn,
      count: list.length
    };
  }

  // --- Card helpers --------------------------------------------------------

  function statCard(icon, color, value, label, trend, trendType) {
    var trendHtml = '';
    if (trend) {
      var arrow = trendType === 'up'   ? '<i class="fas fa-arrow-up"></i>'
                : trendType === 'down' ? '<i class="fas fa-arrow-down"></i>'
                :                        '<i class="fas fa-circle" style="font-size:6px"></i>';
      trendHtml = '<div class="stat-trend ' + esc(trendType || 'neutral') + '">'
                +   arrow + esc(trend)
                + '</div>';
    }
    return ''
      + '<div class="stat">'
      +   '<div class="stat-head">'
      +     '<div class="stat-label">' + esc(label) + '</div>'
      +     '<div class="stat-icon ' + esc(color) + '"><i class="fas ' + esc(icon) + '"></i></div>'
      +   '</div>'
      +   '<div class="stat-value">' + esc(value) + '</div>'
      +   trendHtml
      + '</div>';
  }

  // --- Sort header ---------------------------------------------------------

  function th(key, label, extra) {
    var active = (sortKey === key) ? sortDir : '';
    return '<th data-sort-key="' + esc(key) + '"'
         + (extra ? ' class="' + esc(extra) + '"' : '')
         + (active ? ' data-sort="' + esc(active) + '"' : '')
         + '>' + esc(label) + '</th>';
  }

  // --- Row -----------------------------------------------------------------

  function txnRow(t) {
    var amt = Number(t.amount || 0);
    var isPositive = amt >= 0;
    var amountClass = isPositive ? 'positive' : 'negative';
    var sign = isPositive ? '+' : '';

    return ''
      + '<tr>'
      +   '<td><span class="pill ' + esc(t.type || 'Deposit') + '">' + esc(t.type || '—') + '</span></td>'
      +   '<td style="font-size:13px">' + esc(t.description || '—')
      +     (t.ref ? '<div class="cell-sub mono">' + esc(t.ref) + '</div>' : '')
      +   '</td>'
      +   '<td class="tbl-amount ' + amountClass + '" style="text-align:right;font-weight:700">'
      +     sign + money(amt)
      +   '</td>'
      +   '<td style="text-align:right;font-size:12.5px;color:var(--text-2)">' + money(t.balanceAfter || 0) + '</td>'
      +   '<td style="font-size:12px;color:var(--text-3)">' + esc(t.at || '—') + '</td>'
      + '</tr>';
  }

  // --- Empty states --------------------------------------------------------

  function emptyNoTxns() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-receipt"></i></div>'
      +   '<h4>No transactions yet</h4>'
      +   '<p>Deposit money to start using your wallet, or create a shipment to see shipping fees appear here.</p>'
      +   '<button type="button" class="btn btn-primary" data-action="deposit">'
      +     '<i class="fas fa-plus"></i> Deposit Money'
      +   '</button>'
      + '</div>';
  }

  function emptyNoMatch() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-magnifying-glass"></i></div>'
      +   '<h4>No matching transactions</h4>'
      +   '<p>Try adjusting your search, type filter, or date range.</p>'
      +   '<button type="button" class="btn btn-outline" data-action="clear-filters">'
      +     '<i class="fas fa-rotate-left"></i> Clear filters'
      +   '</button>'
      + '</div>';
  }

  // --- Render tbody + footer ----------------------------------------------

  function renderRows(userId) {
    var result = pipeline(userId);
    var tbody = document.getElementById('txnTbody');
    if (!tbody) return;

    if (result.all === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">' + emptyNoTxns() + '</td></tr>';
    } else if (result.filtered === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">' + emptyNoMatch() + '</td></tr>';
    } else {
      tbody.innerHTML = result.slice.map(txnRow).join('');
    }

    var count = document.getElementById('txnCount');
    if (count) {
      count.textContent = (result.filtered === result.all)
        ? (result.all + ' transaction' + (result.all === 1 ? '' : 's'))
        : (result.filtered + ' of ' + result.all + ' transactions');
    }

    renderFooter(result);
  }

  function renderFooter(result) {
    var foot = document.getElementById('txnFooter');
    if (!foot) return;
    if (result.filtered === 0) { foot.innerHTML = ''; return; }

    var showing = (result.start + 1) + '–' + result.end + ' of ' + result.filtered;

    var pageBtns = '';
    var range = windowedRange(result.totalPages, pageNum, 2);
    for (var i = 0; i < range.length; i++) {
      var p = range[i];
      if (p === '…') {
        pageBtns += '<button type="button" disabled>…</button>';
      } else {
        pageBtns += '<button type="button" data-page="' + p + '"'
                  + (p === pageNum ? ' class="active"' : '')
                  + '>' + p + '</button>';
      }
    }

    foot.innerHTML = ''
      + '<div class="count">Showing <strong>' + showing + '</strong></div>'
      + '<div class="pages">'
      +   '<button type="button" data-page-prev ' + (pageNum === 1 ? 'disabled' : '') + '>'
      +     '<i class="fas fa-chevron-left"></i>'
      +   '</button>'
      +   pageBtns
      +   '<button type="button" data-page-next ' + (pageNum >= result.totalPages ? 'disabled' : '') + '>'
      +     '<i class="fas fa-chevron-right"></i>'
      +   '</button>'
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

  // --- CSV export ----------------------------------------------------------

  function csvEscape(val) {
    var s = String(val == null ? '' : val);
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function exportCSV(userId) {
    var result = pipeline(userId);
    var rows = result.slice;

    var header = ['Type', 'Description', 'Reference', 'Amount', 'Balance After', 'Date'];
    var lines = [header.join(',')];

    rows.forEach(function (t) {
      lines.push([
        csvEscape(t.type || ''),
        csvEscape(t.description || ''),
        csvEscape(t.ref || ''),
        csvEscape(Number(t.amount || 0)),
        csvEscape(Number(t.balanceAfter || 0)),
        csvEscape(t.at || '')
      ].join(','));
    });

    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'globalexpress-wallet-' + Date.now() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast('CSV downloaded', rows.length + ' transactions', 'success');
  }

  // --- Render --------------------------------------------------------------

  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    var stats = computeStats(user.id);
    var bal = user.wallet || 0;

    // Compact hero
    var heroHtml = ''
      + '<div class="wallet-hero compact">'
      +   '<div class="wallet-hero-content">'
      +     '<div>'
      +       '<div class="wallet-balance-label">Available Balance</div>'
      +       '<div class="wallet-balance-amount"><small>Fr.</small>' + esc(bal.toLocaleString()) + '</div>'
      +       '<div class="wallet-balance-sub">'
      +         'Account: <span class="mono" style="opacity:.85">' + esc(user.id) + '</span>'
      +         ' &nbsp;·&nbsp; ' + esc(stats.count) + ' transaction' + (stats.count === 1 ? '' : 's')
      +       '</div>'
      +     '</div>'
      +     '<div class="wallet-actions">'
      +       '<button type="button" class="btn deposit" data-action="deposit">'
      +         '<i class="fas fa-plus"></i> Deposit'
      +       '</button>'
      +       '<button type="button" class="btn" data-action="withdraw">'
      +         '<i class="fas fa-arrow-up-from-bracket"></i> Withdraw'
      +       '</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';

    // Stats
    var statsHtml = ''
      + '<div class="stats wallet-stats">'
      +   statCard('fa-arrow-down-to-line',      'green',  money(stats.deposited), 'Total Deposited', stats.count ? 'Lifetime' : '', 'neutral')
      +   statCard('fa-truck-fast',              'orange', money(stats.spent),     'Total Spent',     stats.spent ? 'On shipments' : '', 'neutral')
      +   statCard('fa-rotate-left',             'purple', money(stats.refunded),  'Total Refunds',   stats.refunded ? 'Returned' : '', 'neutral')
      + '</div>';

    // Panel shell
    var panelHtml = ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-list"></i> Transaction History'
      +       ' <span id="txnCount" style="font-weight:500;color:var(--text-3);font-size:13px;margin-left:6px"></span>'
      +     '</h3>'
      +     '<div class="panel-tools">'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="export"><i class="fas fa-file-csv"></i> Export CSV</button>'
      +     '</div>'
      +   '</div>'

      +   '<div class="toolbar">'
      +     '<div class="search-box">'
      +       '<i class="fas fa-search"></i>'
      +       '<input type="text" id="txnSearch" placeholder="Search description, reference, or method…" value="' + esc(query) + '" />'
      +     '</div>'
      +     '<select id="txnType" aria-label="Filter by type">'
      +       '<option value="">All types</option>'
      +       TYPES.map(function (t) {
              return '<option value="' + esc(t) + '"' + (typeFilter === t ? ' selected' : '') + '>' + esc(t) + '</option>';
            }).join('')
      +     '</select>'
      +     '<div class="date-range" style="display:flex;gap:6px;align-items:center">'
      +       '<input type="date" id="txnFrom" value="' + esc(fromDate) + '" aria-label="From date" />'
      +       '<span style="color:var(--text-3);font-size:12px">to</span>'
      +       '<input type="date" id="txnTo" value="' + esc(toDate) + '" aria-label="To date" />'
      +     '</div>'
      +   '</div>'

      +   '<div class="tbl-wrap">'
      +     '<table class="table-cards">'
      +       '<thead>'
      +         '<tr>'
      +           th('type', 'Type')
      +           '<th>Description</th>'
      +           th('amount', 'Amount', 'num')
      +           th('balance', 'Balance After', 'num')
      +           th('date', 'Date')
      +         '</tr>'
      +       '</thead>'
      +       '<tbody id="txnTbody"></tbody>'
      +     '</table>'
      +   '</div>'

      +   '<div class="tbl-footer" id="txnFooter"></div>'
      + '</div>';

    return heroHtml + statsHtml + panelHtml;
  }

  // --- Bind ----------------------------------------------------------------

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    var user = currentUser(ctx);
    if (user) renderRows(user.id);

    handler = function (e) {
      // Sort headers
      var thEl = e.target.closest && e.target.closest('[data-sort-key]');
      if (thEl) {
        var key = thEl.dataset.sortKey;
        if (key === sortKey) sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
        else { sortKey = key; sortDir = 'asc'; }
        pageNum = 1;
        rerender(user);
        return;
      }

      // Pagination
      var pageBtn = e.target.closest && e.target.closest('[data-page]');
      if (pageBtn) {
        pageNum = parseInt(pageBtn.dataset.page, 10) || 1;
        rerender(user);
        return;
      }
      if (e.target.closest && e.target.closest('[data-page-prev]')) {
        if (pageNum > 1) { pageNum--; rerender(user); }
        return;
      }
      if (e.target.closest && e.target.closest('[data-page-next]')) {
        pageNum++;
        rerender(user);
        return;
      }

      // Actions
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'deposit') {
        if (global.App && global.App.go) global.App.go('deposit');
        return;
      }
      if (action === 'withdraw') {
        if (global.App && global.App.go) global.App.go('withdraw');
        return;
      }
      if (action === 'export') {
        exportCSV(user.id);
        return;
      }
      if (action === 'clear-filters') {
        query = ''; typeFilter = ''; fromDate = ''; toDate = ''; pageNum = 1;
        var searchEl = document.getElementById('txnSearch');
        var typeEl   = document.getElementById('txnType');
        var fromEl   = document.getElementById('txnFrom');
        var toEl     = document.getElementById('txnTo');
        if (searchEl) searchEl.value = '';
        if (typeEl)   typeEl.value   = '';
        if (fromEl)   fromEl.value   = '';
        if (toEl)     toEl.value     = '';
        rerender(user);
        return;
      }
    };

    container.addEventListener('click', handler);

    // Debounced search
    var searchEl = document.getElementById('txnSearch');
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

    // Type filter
    var typeEl = document.getElementById('txnType');
    if (typeEl) {
      typeEl.addEventListener('change', function () {
        typeFilter = typeEl.value || '';
        pageNum = 1;
        rerender(user);
      });
    }

    // Date range
    var fromEl = document.getElementById('txnFrom');
    var toEl   = document.getElementById('txnTo');
    if (fromEl) {
      fromEl.addEventListener('change', function () {
        fromDate = fromEl.value || '';
        pageNum = 1;
        rerender(user);
      });
    }
    if (toEl) {
      toEl.addEventListener('change', function () {
        toDate = toEl.value || '';
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
    typeFilter = '';
    fromDate = '';
    toDate = '';
    sortKey = 'date';
    sortDir = 'desc';
    pageNum = 1;
  }

  // --- Register ------------------------------------------------------------

  var page = {
    title: 'My Wallet',
    subtitle: 'Balance and transaction history',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('wallet', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.wallet = page;
  }

})(window);