/* GlobalExpress - pages/invoices.js
   Invoices & receipts page: summary hero, three stat cards, invoice list
   with search, kind filter, status filter, sort, pagination, printable
   receipt modal, HTML download, CSV export.

   Registers itself via App.register('invoices', page).
   Reads from Store (payments). Read-only page — no writes.
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
  var openModal = UI.openModal || function () { return null; };
  var closeModal = UI.closeModal || function () {};

  // --- Constants -----------------------------------------------------------

  var PAGE_SIZE = 15;
  var KINDS = ['Deposit', 'Shipment', 'Refund'];
  var STATUSES = ['Paid', 'Unpaid', 'Refunded'];

  var COMPANY = {
    name: 'GlobalExpress',
    tagline: 'Ship. Track. Deliver.',
    address: '100 Logistics Way, Suite 500, Wilmington, DE 19801',
    email: 'billing@globalexpress.test',
    site: 'globalexpress.test'
  };

  // --- Module state --------------------------------------------------------

  var query     = '';
  var kindFilter   = '';
  var statusFilter = '';
  var sortKey  = 'date';
  var sortDir  = 'desc';
  var pageNum  = 1;

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
      if (key === 'ref') {
        va = (a.ref || '').toLowerCase();
        vb = (b.ref || '').toLowerCase();
      } else if (key === 'amount') {
        va = Math.abs(Number(a.amount || 0));
        vb = Math.abs(Number(b.amount || 0));
      } else if (key === 'status') {
        va = (a.status || '').toLowerCase();
        vb = (b.status || '').toLowerCase();
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

  // --- Stats ---------------------------------------------------------------

  function computeStats(userId) {
    var list = getUserPayments(userId);
    var totalPaid = 0;
    var depositsCount = 0;
    var shipmentsCount = 0;
    var refundsCount = 0;

    list.forEach(function (p) {
      if (p.status === 'Paid') totalPaid += Math.abs(Number(p.amount || 0));
      if (p.kind === 'Deposit')  depositsCount++;
      if (p.kind === 'Shipment') shipmentsCount++;
      if (p.kind === 'Refund')   refundsCount++;
    });

    return {
      totalPaid: totalPaid,
      deposits: depositsCount,
      shipments: shipmentsCount,
      refunds: refundsCount,
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

  function invoiceRow(p) {
    var amt = Math.abs(Number(p.amount || 0));
    return ''
      + '<tr data-id="' + esc(p.id) + '" style="cursor:pointer">'
      +   '<td class="mono">' + esc(p.ref || '—') + '</td>'
      +   '<td>'
      +     '<div style="font-weight:600;font-size:13px">'
      +       (p.kind === 'Deposit' ? 'Wallet Deposit'
              : p.kind === 'Refund' ? 'Refund'
              : 'Shipping Fee')
      +     '</div>'
      +     '<div class="cell-sub" style="text-transform:capitalize">' + esc(p.method || '—') + '</div>'
      +   '</td>'
      +   '<td class="num tbl-amount ' + (Number(p.amount) >= 0 ? 'positive' : 'negative') + '" style="font-weight:700">'
      +     (Number(p.amount) >= 0 ? '+' : '-') + money(amt)
      +   '</td>'
      +   '<td><span class="pill ' + esc(p.status || 'Paid') + '">' + esc(p.status || 'Paid') + '</span></td>'
      +   '<td style="font-size:12px;color:var(--text-3)">' + esc(p.at || '—') + '</td>'
      +   '<td class="tbl-actions">'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="view" data-id="' + esc(p.id) + '" title="View receipt">'
      +       '<i class="fas fa-eye"></i>'
      +     '</button>'
      +     '<button type="button" class="btn btn-sm btn-outline" data-action="download" data-id="' + esc(p.id) + '" title="Download">'
      +       '<i class="fas fa-download"></i>'
      +     '</button>'
      +   '</td>'
      + '</tr>';
  }

  // --- Empty states --------------------------------------------------------

  function emptyNoInvoices() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-file-invoice"></i></div>'
      +   '<h4>No invoices yet</h4>'
      +   '<p>Your invoices and receipts will appear here after you deposit money or pay for a shipment.</p>'
      +   '<button type="button" class="btn btn-primary" data-action="deposit">'
      +     '<i class="fas fa-plus"></i> Deposit Money'
      +   '</button>'
      + '</div>';
  }

  function emptyNoMatch() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-magnifying-glass"></i></div>'
      +   '<h4>No matching invoices</h4>'
      +   '<p>Try adjusting your search or filters.</p>'
      +   '<button type="button" class="btn btn-outline" data-action="clear-filters">'
      +     '<i class="fas fa-rotate-left"></i> Clear filters'
      +   '</button>'
      + '</div>';
  }

  // --- Render tbody + footer ----------------------------------------------

  function renderRows(userId) {
    var result = pipeline(userId);
    var tbody = document.getElementById('invTbody');
    if (!tbody) return;

    if (result.all === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">' + emptyNoInvoices() + '</td></tr>';
    } else if (result.filtered === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">' + emptyNoMatch() + '</td></tr>';
    } else {
      tbody.innerHTML = result.slice.map(invoiceRow).join('');
    }

    var count = document.getElementById('invCount');
    if (count) {
      count.textContent = (result.filtered === result.all)
        ? (result.all + ' invoice' + (result.all === 1 ? '' : 's'))
        : (result.filtered + ' of ' + result.all + ' invoices');
    }

    renderFooter(result);
  }

  function renderFooter(result) {
    var foot = document.getElementById('invFooter');
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

  // --- Receipt modal -------------------------------------------------------

  function findPayment(id) {
    var all = Store.get('payments') || [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  function receiptHtml(p, forDownload) {
    var amt = Math.abs(Number(p.amount || 0));
    var kindLabel = p.kind === 'Deposit' ? 'Wallet Deposit'
                  : p.kind === 'Refund'  ? 'Refund'
                  : 'Shipping Fee';

    var styles = forDownload
      ? '<style>'
        + 'body{font-family:Inter,system-ui,sans-serif;background:#f5f7fa;color:#0f172a;padding:40px;line-height:1.55}'
        + '.wrap{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e4e8ee;border-radius:12px;padding:32px;box-shadow:0 4px 12px rgba(15,23,42,.06)}'
        + '.brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}'
        + '.logo{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#0b2545,#13315c);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:18px}'
        + '.name{font-weight:800;font-size:19px;letter-spacing:-.02em}'
        + '.tag{font-size:11px;color:#94a3b8;font-weight:600;letter-spacing:.8px;text-transform:uppercase;margin-top:2px}'
        + 'h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}'
        + '.sub{color:#94a3b8;font-size:13px;margin-bottom:24px}'
        + '.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px 0;border-top:1px solid #eef1f5;border-bottom:1px solid #eef1f5;margin-bottom:20px}'
        + '.meta .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:#94a3b8;font-weight:700;margin-bottom:3px}'
        + '.meta .v{font-size:14px;font-weight:600;word-break:break-word}'
        + '.total{font-size:32px;font-family:Manrope,Inter,sans-serif;font-weight:800;color:#059669;letter-spacing:-.02em}'
        + '.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px dashed #eef1f5;font-size:14px}'
        + '.row:last-child{border-bottom:none;padding-top:14px;border-top:2px solid #e4e8ee;margin-top:6px}'
        + '.row .l{color:#475569}'
        + '.row .v{font-weight:600}'
        + '.amount{font-size:20px;font-family:Manrope,Inter,sans-serif;font-weight:800;color:#FF6B35}'
        + '.foot{margin-top:28px;padding-top:20px;border-top:1px solid #eef1f5;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6}'
        + '@media print{body{background:#fff;padding:0}.wrap{border:none;box-shadow:none;border-radius:0}}'
        + '</style>'
      : '';

    return ''
      + (forDownload ? '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ' + esc(p.ref) + '</title>' + styles + '</head><body>' : '')
      + '<div class="wrap">'

      +   '<div class="brand">'
      +     '<div class="logo">GE</div>'
      +     '<div>'
      +       '<div class="name">' + esc(COMPANY.name) + '</div>'
      +       '<div class="tag">' + esc(COMPANY.tagline) + '</div>'
      +     '</div>'
      +   '</div>'

      +   '<h1>Receipt</h1>'
      +   '<div class="sub">Reference <strong>' + esc(p.ref) + '</strong></div>'

      +   '<div class="meta">'
      +     '<div><div class="k">Billed To</div><div class="v">' + esc(p.userName || '—') + '</div></div>'
      +     '<div><div class="k">Email</div><div class="v">' + esc(p.userEmail || '—') + '</div></div>'
      +     '<div><div class="k">Date</div><div class="v">' + esc(p.at || '—') + '</div></div>'
      +     '<div><div class="k">Payment Method</div><div class="v" style="text-transform:capitalize">' + esc(p.method || '—') + '</div></div>'
      +   '</div>'

      +   '<div style="text-align:center;padding:8px 0 18px">'
      +     '<div class="k" style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:700;margin-bottom:6px">Total</div>'
      +     '<div class="total">' + esc(money(amt)) + '</div>'
      +   '</div>'

      +   '<div class="row"><span class="l">Description</span><span class="v">' + esc(kindLabel) + '</span></div>'
      +   '<div class="row"><span class="l">Status</span><span class="v">' + esc(p.status || 'Paid') + '</span></div>'
      +   '<div class="row"><span class="l">Currency</span><span class="v">' + esc(p.currency || 'XAF') + '</span></div>'
      +   '<div class="row"><span class="l">Amount</span><span class="amount">' + esc(money(amt)) + '</span></div>'

      +   '<div class="foot">'
      +     esc(COMPANY.name) + ' · ' + esc(COMPANY.address) + '<br>'
      +     esc(COMPANY.email) + ' · ' + esc(COMPANY.site)
      +   '</div>'

      + '</div>'
      + (forDownload ? '</body></html>' : '');
  }

  function openReceipt(id) {
    var p = findPayment(id);
    if (!p) { toast('Invoice not found', '', 'error'); return; }

    var modal = openModal(''
      + '<div class="modal wide">'
      +   '<div class="modal-head">'
      +     '<div><h3><i class="fas fa-receipt"></i> Receipt</h3>'
      +       '<div class="sub">' + esc(p.ref) + '</div></div>'
      +     '<button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button>'
      +   '</div>'
      +   '<div class="modal-body" style="background:var(--surface-2);padding:24px">'
      +     '<div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:24px;max-width:640px;margin:0 auto">'
      +       receiptHtml(p, false)
      +     '</div>'
      +   '</div>'
      +   '<div class="modal-foot">'
      +     '<button type="button" class="btn btn-outline" data-close>Close</button>'
      +     '<button type="button" class="btn btn-outline" data-action="print"><i class="fas fa-print"></i> Print</button>'
      +     '<button type="button" class="btn btn-primary" data-action="download" data-id="' + esc(p.id) + '">'
      +       '<i class="fas fa-download"></i> Download'
      +     '</button>'
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
    });
  }

  function printReceipt(p) {
    var w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { toast('Popup blocked', 'Allow popups to print', 'error'); return; }
    w.document.write(receiptHtml(p, true));
    w.document.close();
    setTimeout(function () {
      try { w.focus(); w.print(); } catch (e) {}
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

    var header = ['Reference', 'Description', 'Method', 'Amount', 'Status', 'Date'];
    var lines = [header.join(',')];

    rows.forEach(function (p) {
      var kind = p.kind === 'Deposit' ? 'Wallet Deposit'
               : p.kind === 'Refund'  ? 'Refund'
               : 'Shipping Fee';
      lines.push([
        csvEscape(p.ref || ''),
        csvEscape(kind),
        csvEscape(p.method || ''),
        csvEscape(Number(p.amount || 0)),
        csvEscape(p.status || ''),
        csvEscape(p.at || '')
      ].join(','));
    });

    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'globalexpress-invoices-' + Date.now() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast('CSV downloaded', rows.length + ' invoices', 'success');
  }

  // --- Render --------------------------------------------------------------

  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    var stats = computeStats(user.id);

    var heroHtml = ''
      + '<div class="panel" style="background:linear-gradient(135deg,#0b2545 0%,#13315c 60%,#1e3a8a 100%);color:#fff;border:none;overflow:hidden;position:relative">'
      +   '<div style="position:absolute;inset:0;background-image:radial-gradient(circle at 80% 20%,rgba(255,107,53,.22),transparent 55%);pointer-events:none"></div>'
      +   '<div class="panel-body" style="position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;padding:26px 28px">'
      +     '<div>'
      +       '<div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;opacity:.75;margin-bottom:6px">Total Paid · Lifetime</div>'
      +       '<div style="font-family:\'Manrope\',sans-serif;font-weight:800;font-size:36px;letter-spacing:-.03em;line-height:1.05">' + esc(money(stats.totalPaid)) + '</div>'
      +       '<div style="font-size:13px;opacity:.75;margin-top:6px">Across ' + esc(stats.count) + ' transaction' + (stats.count === 1 ? '' : 's') + '</div>'
      +     '</div>'
      +     '<div style="display:flex;gap:10px;flex-wrap:wrap">'
      +       '<button type="button" class="btn btn-sm" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.24);backdrop-filter:blur(8px)" data-action="export">'
      +         '<i class="fas fa-file-csv"></i> Export CSV'
      +       '</button>'
      +       '<button type="button" class="btn btn-sm" style="background:var(--accent);color:#fff;border:1px solid var(--accent)" data-action="download-all">'
      +         '<i class="fas fa-download"></i> Download All'
      +       '</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';

    var statsHtml = ''
      + '<div class="stats">'
      +   statCard('fa-arrow-down-to-line', 'green',  money(stats.totalPaid), 'Total Paid',        '', 'neutral')
      +   statCard('fa-circle-plus',        'cyan',   stats.deposits,        'Deposit Receipts',  '', 'neutral')
      +   statCard('fa-truck-fast',         'orange', stats.shipments,       'Shipment Invoices', '', 'neutral')
      + '</div>';

    var panelHtml = ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-file-invoice"></i> All Invoices'
      +       ' <span id="invCount" style="font-weight:500;color:var(--text-3);font-size:13px;margin-left:6px"></span>'
      +     '</h3>'
      +     '<div class="panel-tools">'
      +       '<button type="button" class="btn btn-sm btn-outline" data-action="export"><i class="fas fa-file-csv"></i> Export</button>'
      +     '</div>'
      +   '</div>'

      +   '<div class="toolbar">'
      +     '<div class="search-box">'
      +       '<i class="fas fa-search"></i>'
      +       '<input type="text" id="invSearch" placeholder="Search reference, method, or amount…" value="' + esc(query) + '" />'
      +     '</div>'
      +     '<select id="invKind" aria-label="Filter by type">'
      +       '<option value="">All types</option>'
      +       KINDS.map(function (k) {
              return '<option value="' + esc(k) + '"' + (kindFilter === k ? ' selected' : '') + '>' + esc(k) + '</option>';
            }).join('')
      +     '</select>'
      +     '<select id="invStatus" aria-label="Filter by status">'
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
      +           '<th class="tbl-actions">Actions</th>'
      +         '</tr>'
      +       '</thead>'
      +       '<tbody id="invTbody"></tbody>'
      +     '</table>'
      +   '</div>'

      +   '<div class="tbl-footer" id="invFooter"></div>'
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
      if (btn) {
        var action = btn.dataset.action;

        if (action === 'deposit') {
          if (global.App) global.App.go('deposit');
          return;
        }
        if (action === 'export') {
          if (user) exportCSV(user.id);
          return;
        }
        if (action === 'download-all') {
          if (user) downloadAll(user);
          return;
        }
        if (action === 'view') {
          openReceipt(btn.dataset.id);
          return;
        }
        if (action === 'download') {
          var p = findPayment(btn.dataset.id);
          if (p) {
            downloadReceipt(p);
            toast('Receipt downloaded', p.ref, 'success');
          }
          return;
        }
        if (action === 'clear-filters') {
          query = ''; kindFilter = ''; statusFilter = ''; pageNum = 1;
          var s1 = document.getElementById('invSearch');
          var s2 = document.getElementById('invKind');
          var s3 = document.getElementById('invStatus');
          if (s1) s1.value = '';
          if (s2) s2.value = '';
          if (s3) s3.value = '';
          rerender(user);
          return;
        }
        return;
      }

      // Row click → open receipt
      var row = e.target.closest && e.target.closest('tr[data-id]');
      if (row && !e.target.closest('[data-action]')) {
        openReceipt(row.dataset.id);
        return;
      }
    };

    container.addEventListener('click', handler);

    // Debounced search
    var searchEl = document.getElementById('invSearch');
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

    // Kind filter
    var kindEl = document.getElementById('invKind');
    if (kindEl) {
      kindEl.addEventListener('change', function () {
        kindFilter = kindEl.value || '';
        pageNum = 1;
        rerender(user);
      });
    }

    // Status filter
    var statusEl = document.getElementById('invStatus');
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

  function downloadAll(user) {
    var list = getUserPayments(user.id);
    if (!list.length) { toast('No invoices to download', '', 'info'); return; }

    var html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
      + '<title>GlobalExpress — All Receipts</title>'
      + '<style>'
      + 'body{font-family:Inter,system-ui,sans-serif;background:#f5f7fa;color:#0f172a;padding:40px;line-height:1.55;margin:0}'
      + 'h1{font-family:Manrope,Inter,sans-serif;font-weight:800;font-size:26px;letter-spacing:-.02em;margin:0 0 6px}'
      + 'p.sub{color:#94a3b8;font-size:13px;margin:0 0 24px}'
      + '.r{background:#fff;border:1px solid #e4e8ee;border-radius:12px;padding:24px;margin-bottom:20px;page-break-inside:avoid}'
      + '.brand{display:flex;align-items:center;gap:12px;margin-bottom:16px}'
      + '.logo{width:40px;height:40px;border-radius:11px;background:linear-gradient(135deg,#0b2545,#13315c);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:16px}'
      + '.name{font-weight:800;font-size:16px}'
      + '.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px 0;border-top:1px solid #eef1f5;border-bottom:1px solid #eef1f5;margin-bottom:14px}'
      + '.meta .k{font-size:10.5px;text-transform:uppercase;color:#94a3b8;font-weight:700}'
      + '.meta .v{font-size:13.5px;font-weight:600;margin-top:3px}'
      + '.total{font-size:26px;font-family:Manrope,Inter,sans-serif;font-weight:800;color:#059669;letter-spacing:-.02em}'
      + '.foot{margin-top:20px;padding-top:14px;border-top:1px solid #eef1f5;font-size:11px;color:#94a3b8;text-align:center}'
      + '@media print{body{background:#fff;padding:0}.r{border:none;box-shadow:none;padding:0;margin-bottom:32px;page-break-after:always}}'
      + '</style></head><body>'
      + '<h1>All Receipts</h1>'
      + '<p class="sub">' + esc(user.name || '') + ' · ' + esc(user.email || '') + ' · ' + list.length + ' invoice' + (list.length === 1 ? '' : 's') + '</p>';

    list.forEach(function (p) {
      var amt = Math.abs(Number(p.amount || 0));
      var kindLabel = p.kind === 'Deposit' ? 'Wallet Deposit'
                    : p.kind === 'Refund' ? 'Refund' : 'Shipping Fee';
      html += ''
        + '<div class="r">'
        +   '<div class="brand"><div class="logo">GE</div><div><div class="name">GlobalExpress</div><div style="font-size:11px;color:#94a3b8;letter-spacing:.6px;text-transform:uppercase;font-weight:600;margin-top:2px">Receipt · ' + esc(p.ref) + '</div></div></div>'
        +   '<div class="meta">'
        +     '<div><div class="k">Date</div><div class="v">' + esc(p.at || '—') + '</div></div>'
        +     '<div><div class="k">Method</div><div class="v" style="text-transform:capitalize">' + esc(p.method || '—') + '</div></div>'
        +     '<div><div class="k">Description</div><div class="v">' + esc(kindLabel) + '</div></div>'
        +     '<div><div class="k">Status</div><div class="v">' + esc(p.status || 'Paid') + '</div></div>'
        +   '</div>'
        +   '<div class="total">' + esc(money(amt)) + '</div>'
        +   '<div class="foot">GlobalExpress · billing@globalexpress.test · globalexpress.test</div>'
        + '</div>';
    });

    html += '</body></html>';

    var blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'globalexpress-receipts-' + Date.now() + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast('All receipts downloaded', list.length + ' invoice' + (list.length === 1 ? '' : 's'), 'success');
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
    title: 'Invoices & Receipts',
    subtitle: 'Download your payment records',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('invoices', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.invoices = page;
  }

})(window);