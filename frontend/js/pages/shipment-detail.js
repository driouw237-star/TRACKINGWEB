/* GlobalExpress - pages/shipment-detail.js
   Full-screen shipment detail page: status hero, Leaflet map, progress
   stepper, tabs (Details / Edit / Timeline / Payment), sender & recipient
   cards, action row (Share / Track / Cancel with refund).

   Registers itself via App.register('shipment', page).
   Reads from Store (shipments, walletTxns, payments, users).
   Requires Leaflet (loaded via CDN in app.html).
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
  var money = Utils.money || function (n) {
    return 'Fr. ' + Number(n || 0).toLocaleString();
  };
  var statusCls = Utils.statusCls || function (s) {
    return String(s || 'Pending').trim().replace(/\s+/g, '-');
  };
  var fmtDT = Utils.fmtDT || function (d) {
    return new Date(d || Date.now()).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };
  var uid = Utils.uid || function (p) {
    return (p || 'id') + '_' + Math.random().toString(36).slice(2, 10);
  };

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  var openModal = UI.openModal || function () { return null; };
  var closeModal = UI.closeModal || function () {};

  // --- Constants -----------------------------------------------------------

  var STATUSES = ['Pending', 'In Transit', 'On Hold', 'Delivered', 'Cancelled'];

  // --- Module state --------------------------------------------------------

  var code = null;
  var activeTab = 'details';   // 'details' | 'edit' | 'timeline' | 'payment'
  var mapInstance = null;
  var handler = null;
  var container = null;
  var mounted = false;

  // --- Data helpers --------------------------------------------------------

  function findShip(c) {
    if (!c) return null;
    var all = Store.get('shipments') || [];
    var up = String(c).toUpperCase();
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].trackingCode || '').toUpperCase() === up) return all[i];
    }
    return null;
  }

  function currentUser(ctx) {
    return (ctx && ctx.user) ||
           (global.App && global.App.state && global.App.state.user) ||
           null;
  }

  function findPayment(s) {
    if (!s) return null;
    var all = Store.get('payments') || [];
    // paymentId link first
    if (s.paymentId) {
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === s.paymentId) return all[i];
      }
    }
    // Fallback: match by user + amount + kind Shipment
    for (var j = all.length - 1; j >= 0; j--) {
      var p = all[j];
      if (p.userId === s.createdBy && p.kind === 'Shipment' && p.status === 'Paid' && p.amount === s.amountPaid) {
        return p;
      }
    }
    return null;
  }

  // --- 404 state -----------------------------------------------------------

  function render404(c) {
    return ''
      + '<div class="panel">'
      +   '<div class="panel-body" style="text-align:center;padding:60px 24px">'
      +     '<div style="width:80px;height:80px;border-radius:50%;background:var(--surface-2);'
      +        'display:inline-flex;align-items:center;justify-content:center;font-size:32px;'
      +        'color:var(--text-3);margin-bottom:16px">'
      +       '<i class="fas fa-box-open"></i>'
      +     '</div>'
      +     '<h2 style="font-size:18px;margin:0 0 8px">Shipment not found</h2>'
      +     '<p style="color:var(--text-2);font-size:14px;margin-bottom:20px">'
      +       'No shipment matches <strong>' + esc(c || '—') + '</strong>.'
      +       ' Check the code and try again.'
      +     '</p>'
      +     '<button type="button" class="btn btn-primary" data-action="go-shipments">'
      +       '<i class="fas fa-box"></i> Back to My Shipments'
      +     '</button>'
      +   '</div>'
      + '</div>';
  }

  // --- Status hero ---------------------------------------------------------

  function statusHero(s) {
    var cls = statusCls(s.status);
    var color = s.status === 'Delivered' ? 'var(--green)'
              : s.status === 'On Hold'   ? 'var(--amber)'
              : s.status === 'Cancelled' ? 'var(--red)'
              : 'var(--accent)';

    return ''
      + '<div class="status-banner ' + esc(cls) + '" style="margin-bottom:22px">'
      +   '<div class="status-inner" style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;position:relative;z-index:1">'
      +     '<div style="flex:1;min-width:260px">'
      +       '<div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:800;opacity:.85;margin-bottom:6px">Tracking Status</div>'
      +       '<div style="font-family:\'Manrope\',sans-serif;font-size:28px;font-weight:800;color:#fff;letter-spacing:-.02em;line-height:1.15;display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
      +         esc(s.status)
      +         '<span style="font-family:\'Monaco\',monospace;font-size:15px;font-weight:600;background:rgba(255,255,255,.15);padding:6px 12px;border-radius:8px;letter-spacing:1.2px;border:1px solid rgba(255,255,255,.2)">'
      +           esc(s.trackingCode)
      +         '</span>'
      +       '</div>'
      +       '<div style="display:flex;align-items:center;gap:10px;margin-top:14px;font-size:14.5px;font-weight:600;opacity:.95;flex-wrap:wrap;color:#fff">'
      +         '<span>' + esc(s.originCity || '—') + '</span>'
      +         '<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:rgba(255,255,255,.18);border-radius:50%;font-size:10px">'
      +           '<i class="fas fa-arrow-right"></i>'
      +         '</span>'
      +         '<span>' + esc(s.destCity || '—') + '</span>'
      +       '</div>'
      +     '</div>'
      +     '<div style="text-align:right;flex-shrink:0">'
      +       '<div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;font-weight:800;opacity:.85;margin-bottom:6px">Estimated Delivery</div>'
      +       '<div style="font-family:\'Manrope\',sans-serif;font-size:19px;font-weight:800;letter-spacing:-.01em;color:#fff">' + esc(s.estimatedDelivery || 'TBD') + '</div>'
      +       '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;flex-wrap:wrap">'
      +         '<button type="button" class="btn btn-sm" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(8px)" data-action="print"><i class="fas fa-print"></i> Print</button>'
      +         '<button type="button" class="btn btn-sm" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(8px)" data-action="share"><i class="fas fa-share-nodes"></i> Share</button>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  // --- Progress stepper ----------------------------------------------------

  function buildSteps(status) {
    var s = String(status || '').toLowerCase();
    var stage = 0;
    if (s.indexOf('pending')   >= 0) stage = 1;
    else if (s.indexOf('hold')    >= 0) stage = 2;
    else if (s.indexOf('transit') >= 0) stage = 2;
    else if (s.indexOf('delivered') >= 0) stage = 4;
    else if (s.indexOf('cancel') >= 0) stage = 0;

    var defs = [
      { label: 'Order Processed',   icon: 'fa-clipboard-check' },
      { label: 'Picked Up',         icon: 'fa-box' },
      { label: 'In Transit',        icon: 'fa-truck' },
      { label: 'Out for Delivery',  icon: 'fa-truck-fast' },
      { label: 'Delivered',         icon: 'fa-circle-check' }
    ];

    return defs.map(function (d, i) {
      var state = 'pending';
      if (s.indexOf('cancel') >= 0) {
        state = (i === 0) ? 'done' : 'pending';
      } else if (s.indexOf('delivered') >= 0) {
        state = 'done';
      } else {
        if (i < stage) state = 'done';
        else if (i === stage) state = 'active';
      }
      return { label: d.label, icon: d.icon, state: state };
    });
  }

  function progressBlock(s) {
    var steps = buildSteps(s.status);
    var doneCount = 0;
    var activeCount = 0;
    steps.forEach(function (st) {
      if (st.state === 'done') doneCount++;
      if (st.state === 'active') activeCount++;
    });
    var fillPct = ((doneCount + (activeCount ? 0.5 : 0)) / steps.length) * 100;

    return ''
      + '<div class="panel" style="margin-bottom:22px">'
      +   '<div class="panel-body">'
      +     '<div style="font-size:14px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:10px;margin-bottom:22px">'
      +       '<i class="fas fa-route" style="color:var(--accent)"></i> Delivery Progress'
      +     '</div>'
      +     '<div class="steps" style="position:relative">'
      +       '<div class="steps-fill" style="width:' + Math.max(0, fillPct) + '%"></div>'
      +       steps.map(function (st) {
              return ''
                + '<div class="step ' + st.state + '">'
                +   '<div class="step-icon"><i class="fas ' + st.icon + '"></i></div>'
                +   '<div class="step-label">' + esc(st.label) + '</div>'
                + '</div>';
            }).join('')
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  // --- Map block -----------------------------------------------------------

  function mapBlock() {
    return ''
      + '<div class="panel" style="margin-bottom:22px">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-map-location-dot"></i> Live Map</h3>'
      +     '<span class="badge" style="font-size:11px;color:var(--text-3);background:var(--surface-2);padding:3px 9px;border-radius:6px;text-transform:uppercase;letter-spacing:.5px">Route overview</span>'
      +   '</div>'
      +   '<div class="panel-body">'
      +     '<div id="detailMap" style="width:100%;height:380px;border-radius:12px;border:1px solid var(--border);background:#e5e7eb"></div>'
      +     '<div style="display:flex;gap:16px;font-size:12.5px;color:var(--text-2);margin-top:12px;flex-wrap:wrap;font-weight:500">'
      +       '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:#0b2545;box-shadow:0 0 0 3px rgba(0,0,0,.06)"></span> Origin</span>'
      +       '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:#FF6B35;box-shadow:0 0 0 3px rgba(0,0,0,.06)"></span> Current</span>'
      +       '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:#059669;box-shadow:0 0 0 3px rgba(0,0,0,.06)"></span> Destination</span>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  // --- Tabs ----------------------------------------------------------------

  function tabsBlock() {
    var defs = [
      { key: 'details',  label: 'Details' },
      { key: 'edit',     label: 'Edit' },
      { key: 'timeline', label: 'Timeline' },
      { key: 'payment',  label: 'Payment' }
    ];
    return ''
      + '<div class="panel" style="margin-bottom:22px">'
      +   '<div class="panel-body">'
      +     '<div class="tabs" style="display:flex;gap:20px;border-bottom:1.5px solid var(--border);margin-bottom:20px">'
      +       defs.map(function (d) {
              return ''
                + '<button type="button" class="tab' + (activeTab === d.key ? ' active' : '') + '" data-tab="' + d.key + '" '
                +   'style="background:none;border:none;padding:0 0 12px;font-family:inherit;font-weight:600;font-size:14px;'
                +   'color:' + (activeTab === d.key ? 'var(--brand)' : 'var(--text-3)') + ';'
                +   'border-bottom:2.5px solid ' + (activeTab === d.key ? 'var(--accent)' : 'transparent') + ';'
                +   'margin-bottom:-1.5px;cursor:pointer">'
                +   esc(d.label)
                + '</button>';
            }).join('')
      +     '</div>'
      +     '<div id="tabPanel"></div>'
      +   '</div>'
      + '</div>';
  }

  // --- Tab: Details --------------------------------------------------------

  function renderDetailsTab(s) {
    return ''
      + '<div class="form-section" style="padding:0;border:none">'
      +   '<div style="display:flex;align-items:center;gap:8px;font-family:\'Manrope\',sans-serif;font-size:13px;font-weight:700;color:var(--brand);margin-bottom:12px">'
      +     '<i class="fas fa-truck-fast" style="color:var(--accent);font-size:12.5px"></i> Route & Status'
      +   '</div>'
      +   '<div class="summary" style="margin-bottom:16px">'
      +     summaryRow('Status', '<span class="pill ' + esc(statusCls(s.status)) + '">' + esc(s.status) + '</span>')
      +     summaryRow('Current Location', esc(s.currentLocation || '—'))
      +     summaryRow('Estimated Delivery', esc(s.estimatedDelivery || '—'))
      +     summaryRow('Service Level', esc(s.serviceLevel || '—'))
      +     summaryRow('Special Handling', esc(s.handling || '—'))
      +   '</div>'

      +   '<div style="display:flex;align-items:center;gap:8px;font-family:\'Manrope\',sans-serif;font-size:13px;font-weight:700;color:var(--brand);margin:20px 0 12px">'
      +     '<i class="fas fa-box" style="color:var(--accent);font-size:12.5px"></i> Package'
      +   '</div>'
      +   '<div class="grid-2" style="gap:12px">'
      +     kv('Type', esc(s.packageType || '—'))
      +     kv('Dimensions', esc(s.dimensions || '—'))
      +     kv('Weight', esc(s.weight || '—'))
      +     kv('Insured', s.insured ? 'Yes (+' + money(500) + ')' : 'No')
      +     (s.contents
              ? '<div class="kv" style="grid-column:1/-1"><div class="k">Contents</div><div class="v">' + esc(s.contents) + '</div></div>'
              : '')
      +   '</div>'
      + '</div>';
  }

  function summaryRow(label, val) {
    return ''
      + '<div class="summary-row">'
      +   '<span class="lbl">' + esc(label) + '</span>'
      +   '<span class="val">' + val + '</span>'
      + '</div>';
  }

  function kv(label, val) {
    return ''
      + '<div class="kv">'
      +   '<div class="k">' + esc(label) + '</div>'
      +   '<div class="v">' + val + '</div>'
      + '</div>';
  }

  // --- Tab: Edit -----------------------------------------------------------

  function renderEditTab(s) {
    return ''
      + '<div class="grid-2" style="gap:14px">'
      +   '<div class="field">'
      +     '<label>Status</label>'
      +     '<select id="editStatus">'
      +       STATUSES.map(function (v) {
              return '<option ' + (s.status === v ? 'selected' : '') + '>' + esc(v) + '</option>';
            }).join('')
      +     '</select>'
      +     '<div class="hint">Change the current status of this shipment.</div>'
      +   '</div>'
      +   '<div class="field">'
      +     '<label>Current Location</label>'
      +     '<input type="text" id="editCurrent" value="' + esc(s.currentLocation || '') + '" placeholder="e.g. Memphis, TN" />'
      +   '</div>'
      +   '<div class="field">'
      +     '<label>Estimated Delivery</label>'
      +     '<input type="text" id="editEta" value="' + esc(s.estimatedDelivery || '') + '" placeholder="e.g. Oct 5, 2026" />'
      +   '</div>'
      +   '<div class="field">'
      +     '<label>Weight</label>'
      +     '<input type="text" id="editWeight" value="' + esc(s.weight || '') + '" />'
      +   '</div>'
      +   '<div class="field full" style="grid-column:1/-1">'
      +     '<label>Package Contents</label>'
      +     '<input type="text" id="editContents" value="' + esc(s.contents || '') + '" />'
      +   '</div>'
      +   '<div class="field full" style="grid-column:1/-1">'
      +     '<label>Add a Timeline Note (optional)</label>'
      +     '<input type="text" id="editNote" placeholder="e.g. Departed sorting facility" />'
      +     '<div class="hint">This will be added to the timeline as a new event.</div>'
      +   '</div>'
      + '</div>'
      + '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;padding-top:18px;border-top:1px solid var(--border-2)">'
      +   '<button type="button" class="btn btn-outline" data-action="tab-details">Cancel</button>'
      +   '<button type="button" class="btn btn-primary" data-action="save"><i class="fas fa-save"></i> Save Changes</button>'
      + '</div>';
  }

  // --- Tab: Timeline -------------------------------------------------------

  function renderTimelineTab(s) {
    var acts = (s.activities || []).slice().reverse();
    if (!acts.length) {
      return '<p style="color:var(--text-3);font-size:13px;text-align:center;padding:20px">No activity yet.</p>';
    }
    return ''
      + '<div class="timeline">'
      +   acts.map(function (a, i) {
            return ''
              + '<div class="tl-item ' + (i === 0 ? 'latest' : 'done') + '">'
              +   '<div class="tl-dot"></div>'
              +   '<div class="tl-date">' + esc(a.date) + '</div>'
              +   '<div class="tl-loc">' + esc(a.location) + '</div>'
              +   '<div class="tl-desc">' + esc(a.description) + '</div>'
              + '</div>';
          }).join('')
      + '</div>';
  }

  // --- Tab: Payment --------------------------------------------------------

  function renderPaymentTab(s) {
    var pay = findPayment(s);
    if (!pay) {
      return ''
        + '<div style="text-align:center;padding:20px;color:var(--text-3);font-size:13px">'
        +   'No payment record linked to this shipment.'
        + '</div>';
    }
    return ''
      + '<div class="summary">'
      +   summaryRow('Reference', '<span class="mono">' + esc(pay.ref) + '</span>')
      +   summaryRow('Amount', money(pay.amount))
      +   summaryRow('Method', '<span style="text-transform:capitalize">' + esc(pay.method) + '</span>')
      +   summaryRow('Status', '<span class="pill ' + esc(pay.status) + '">' + esc(pay.status) + '</span>')
      +   summaryRow('Date', esc(pay.at))
      +   summaryRow('Type', esc(pay.kind))
      + '</div>';
  }

  function renderTabPanel(s) {
    if (activeTab === 'edit')     return renderEditTab(s);
    if (activeTab === 'timeline') return renderTimelineTab(s);
    if (activeTab === 'payment')  return renderPaymentTab(s);
    return renderDetailsTab(s);
  }

  function rerenderTabs(s) {
    // Swap tab active state
    var tabs = document.querySelectorAll('[data-tab]');
    tabs.forEach(function (t) {
      var isActive = t.dataset.tab === activeTab;
      t.classList.toggle('active', isActive);
      t.style.color = isActive ? 'var(--brand)' : 'var(--text-3)';
      t.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
    });

    var panel = document.getElementById('tabPanel');
    if (panel) panel.innerHTML = renderTabPanel(s);
  }

  // --- Sidebar cards -------------------------------------------------------

  function senderCard(s) {
    return ''
      + '<div class="panel" style="margin-bottom:22px">'
      +   '<div class="panel-header"><h3><i class="fas fa-store"></i> Sender</h3></div>'
      +   '<div class="panel-body">'
      +     '<div class="kv" style="margin-bottom:10px"><div class="k">Name</div><div class="v">' + esc(s.senderName || '—') + '</div></div>'
      +     (s.senderCompany ? '<div class="kv" style="margin-bottom:10px"><div class="k">Company</div><div class="v">' + esc(s.senderCompany) + '</div></div>' : '')
      +     (s.senderEmail   ? '<div class="kv" style="margin-bottom:10px"><div class="k">Email</div><div class="v">' + esc(s.senderEmail) + '</div></div>' : '')
      +     (s.senderPhone   ? '<div class="kv" style="margin-bottom:10px"><div class="k">Phone</div><div class="v">' + esc(s.senderPhone) + '</div></div>' : '')
      +     (s.senderAddress ? '<div class="kv"><div class="k">Address</div><div class="v">' + esc(s.senderAddress) + '</div></div>' : '')
      +   '</div>'
      + '</div>';
  }

  function recipientCard(s) {
    return ''
      + '<div class="panel" style="margin-bottom:22px">'
      +   '<div class="panel-header"><h3><i class="fas fa-user"></i> Recipient</h3></div>'
      +   '<div class="panel-body">'
      +     '<div class="kv" style="margin-bottom:10px"><div class="k">Name</div><div class="v">' + esc(s.receiverName || '—') + '</div></div>'
      +     (s.receiverCompany ? '<div class="kv" style="margin-bottom:10px"><div class="k">Company</div><div class="v">' + esc(s.receiverCompany) + '</div></div>' : '')
      +     (s.receiverEmail   ? '<div class="kv" style="margin-bottom:10px"><div class="k">Email</div><div class="v">' + esc(s.receiverEmail) + '</div></div>' : '')
      +     (s.receiverPhone   ? '<div class="kv" style="margin-bottom:10px"><div class="k">Phone</div><div class="v">' + esc(s.receiverPhone) + '</div></div>' : '')
      +     (s.receiverAddress ? '<div class="kv"><div class="k">Address</div><div class="v">' + esc(s.receiverAddress) + '</div></div>' : '')
      +   '</div>'
      + '</div>';
  }

  // --- Action row ----------------------------------------------------------

  function actionRow(s) {
    var canCancel = s.status !== 'Delivered' && s.status !== 'Cancelled';
    return ''
      + '<div class="action-row" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:24px">'
      +   '<button type="button" class="btn btn-outline" data-action="share"><i class="fas fa-share-nodes"></i> Share Tracking</button>'
      +   '<button type="button" class="btn btn-outline" data-action="track"><i class="fas fa-location-crosshairs"></i> Track Live</button>'
      +   (canCancel
            ? '<button type="button" class="btn btn-danger" data-action="cancel"><i class="fas fa-xmark"></i> Cancel & Refund</button>'
            : '')
      +   '<button type="button" class="btn btn-outline" data-action="go-shipments"><i class="fas fa-arrow-left"></i> Back to List</button>'
      + '</div>';
  }

  // --- Full render ---------------------------------------------------------

  function render(ctx) {
    // Re-read the code from params on every render
    var incoming = (ctx && ctx.params && ctx.params.code) || code;
    if (incoming) code = incoming;

    var s = findShip(code);
    if (!s) return render404(code);

    return ''
      + statusHero(s)
      + progressBlock(s)
      + '<div style="display:grid;grid-template-columns:1fr 400px;gap:22px;align-items:start">'
      +   '<div>'
      +     mapBlock()
      +     tabsBlock()
      +   '</div>'
      +   '<div>'
      +     senderCard(s)
      +     recipientCard(s)
      +   '</div>'
      + '</div>'
      + actionRow(s);
  }

  // --- Bind ----------------------------------------------------------------

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;
    mounted = true;

    var s = findShip(code);
    if (!s) {
      // Fallback: only "Back to My Shipments" is available
      handler = function (e) {
        var btn = e.target.closest && e.target.closest('[data-action]');
        if (btn && btn.dataset.action === 'go-shipments' && global.App) global.App.go('shipments');
      };
      container.addEventListener('click', handler);
      return;
    }

    // Render tab panel initially
    var panel = document.getElementById('tabPanel');
    if (panel) panel.innerHTML = renderTabPanel(s);

    // Mount the map after a tick
    setTimeout(function () { if (mounted) mountMap(s); }, 80);

    // Delegated clicks
    handler = function (e) {
      var tab = e.target.closest && e.target.closest('[data-tab]');
      if (tab) {
        activeTab = tab.dataset.tab;
        rerenderTabs(s);
        return;
      }

      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'go-shipments') {
        if (global.App && global.App.go) global.App.go('shipments');
        return;
      }
      if (action === 'tab-details') {
        activeTab = 'details';
        rerenderTabs(s);
        return;
      }
      if (action === 'share') { handleShare(s); return; }
      if (action === 'track') { openTrackView(s); return; }
      if (action === 'print') { window.print(); return; }
      if (action === 'save')  { saveEdit(s); return; }
      if (action === 'cancel') { openCancelModal(s); return; }
    };

    container.addEventListener('click', handler);
  }

  // --- Map -----------------------------------------------------------------

  function mountMap(s) {
    if (typeof global.L === 'undefined') return;   // Leaflet not loaded
    var el = document.getElementById('detailMap');
    if (!el) return;

    if (mapInstance) {
      try { mapInstance.remove(); } catch (e) {}
      mapInstance = null;
    }

    var map = L.map('detailMap', { center: [30, 0], zoom: 3, zoomControl: true, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(map);

    var c = s.coords || {};
    var valid = function (p) {
      return p && typeof p.lat === 'number' && typeof p.lng === 'number'
        && !isNaN(p.lat) && !isNaN(p.lng) && p.lat !== 0 && p.lng !== 0;
    };

    var pin = function (color, icon) {
      return L.divIcon({
        html: '<div style="width:34px;height:34px;border-radius:50%;background:' + color + ';'
            + 'border:3px solid #fff;box-shadow:0 6px 16px rgba(0,0,0,.25);'
            + 'display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px">'
            + '<i class="fas ' + icon + '"></i></div>',
        className: '',
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });
    };

    var markers = [];
    if (valid(c.origin))  markers.push(L.marker([c.origin.lat, c.origin.lng],  { icon: pin('#0b2545', 'fa-store') }).addTo(map).bindPopup('<strong>Origin</strong><br>' + esc(s.originCity || '')));
    if (valid(c.current)) markers.push(L.marker([c.current.lat, c.current.lng], { icon: pin('#FF6B35', 'fa-truck') }).addTo(map).bindPopup('<strong>Current</strong><br>' + esc(s.currentLocation || '')));
    if (valid(c.dest))    markers.push(L.marker([c.dest.lat, c.dest.lng],       { icon: pin('#059669', 'fa-flag-checkered') }).addTo(map).bindPopup('<strong>Destination</strong><br>' + esc(s.destCity || '')));

    var line = [];
    if (valid(c.origin)) line.push([c.origin.lat, c.origin.lng]);
    if (valid(c.current) && valid(c.origin) && (c.current.lat !== c.origin.lat || c.current.lng !== c.origin.lng)) {
      line.push([c.current.lat, c.current.lng]);
    } else if (valid(c.current) && !valid(c.origin)) {
      line.push([c.current.lat, c.current.lng]);
    }
    if (valid(c.dest)) line.push([c.dest.lat, c.dest.lng]);

    if (line.length >= 2) {
      L.polyline(line, {
        color: '#FF6B35',
        weight: 3,
        opacity: .75,
        dashArray: '10, 8',
        lineCap: 'round'
      }).addTo(map);
    }

    if (markers.length) {
      map.fitBounds(L.featureGroup(markers).getBounds(), { padding: [60, 60] });
    } else {
      map.setView([20, 0], 2);
    }

    mapInstance = map;
  }

  // --- Share ---------------------------------------------------------------

  function handleShare(s) {
    if (!s || !s.trackingCode) return;
    if (typeof global.shareShipment === 'function') {
      global.shareShipment(s.trackingCode);
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(s.trackingCode).then(function () {
        toast('Tracking code copied', s.trackingCode, 'success');
      }).catch(function () {
        toast('Copy failed', s.trackingCode, 'error');
      });
    }
  }

  function openTrackView(s) {
    if (!s) return;
    var url = new URL(location.href);
    url.searchParams.set('track', s.trackingCode);
    window.open(url.toString(), '_blank');
  }

  // --- Save edit -----------------------------------------------------------

  function saveEdit(s) {
    var all = Store.get('shipments') || [];
    var i = all.findIndex(function (x) { return x.trackingCode === s.trackingCode; });
    if (i === -1) { toast('Shipment not found', '', 'error'); return; }

    var prevStatus = all[i].status;

    var statusEl   = document.getElementById('editStatus');
    var currentEl  = document.getElementById('editCurrent');
    var etaEl      = document.getElementById('editEta');
    var weightEl   = document.getElementById('editWeight');
    var contentsEl = document.getElementById('editContents');
    var noteEl     = document.getElementById('editNote');

    all[i].status          = statusEl ? statusEl.value : all[i].status;
    all[i].currentLocation = currentEl && currentEl.value.trim() ? currentEl.value.trim() : all[i].currentLocation;
    all[i].estimatedDelivery = etaEl ? etaEl.value.trim() : all[i].estimatedDelivery;
    all[i].weight          = weightEl ? weightEl.value.trim() : all[i].weight;
    all[i].contents        = contentsEl ? contentsEl.value.trim() : all[i].contents;

    if (!all[i].activities) all[i].activities = [];

    var note = noteEl ? noteEl.value.trim() : '';
    if (note) {
      all[i].activities.push({
        date: fmtDT(),
        location: all[i].currentLocation || '—',
        description: note
      });
    }
    if (all[i].status !== prevStatus) {
      all[i].activities.push({
        date: fmtDT(),
        location: all[i].currentLocation || '—',
        description: 'Status changed to ' + all[i].status
      });
    }

    // Persist to localStorage + store
    try {
      var raw = JSON.parse(localStorage.getItem('ge_shipments') || '[]');
      var rawIdx = raw.findIndex(function (x) { return x.trackingCode === all[i].trackingCode; });
      if (rawIdx !== -1) {
        raw[rawIdx] = all[i];
        localStorage.setItem('ge_shipments', JSON.stringify(raw));
      }
    } catch (e) {}
    Store.set('shipments', all);

    if (Realtime.notifyLocalChange) Realtime.notifyLocalChange('shipment:updated', all[i]);

    toast('Shipment updated', 'Changes saved successfully.', 'success');

    // Reset to the Details tab and re-render via the router so bind() runs again
    activeTab = 'details';
    if (global.App && global.App.go) {
      global.App.go('shipment', { code: code });
    } else {
      // Fallback: re-render manually if App is unavailable
      var content = document.getElementById('content');
      if (content) content.innerHTML = render({ params: { code: code } });
    }
  }

  // --- Cancel with refund --------------------------------------------------

  function openCancelModal(s) {
    var refund = s.amountPaid || 4000;
    var modal = openModal(''
      + '<div class="modal narrow modal-confirm">'
      +   '<div class="modal-body">'
      +     '<div class="modal-icon danger"><i class="fas fa-triangle-exclamation"></i></div>'
      +     '<h3>Cancel Shipment</h3>'
      +     '<p>Cancelling this shipment will refund <strong>' + esc(money(refund)) + '</strong> to your wallet. This cannot be undone.</p>'
      +   '</div>'
      +   '<div class="modal-foot">'
      +     '<button type="button" class="btn btn-outline" data-close>Keep Shipment</button>'
      +     '<button type="button" class="btn btn-danger" data-confirm-cancel><i class="fas fa-xmark"></i> Cancel & Refund</button>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-confirm-cancel]')) {
        closeModal(modal);
        confirmCancel(s, refund);
      }
    });
  }

  function confirmCancel(s, refund) {
    var all = Store.get('shipments') || [];
    var i = all.findIndex(function (x) { return x.trackingCode === s.trackingCode; });
    if (i === -1) return;

    all[i].status = 'Cancelled';
    if (!all[i].activities) all[i].activities = [];
    all[i].activities.push({
      date: fmtDT(),
      location: all[i].currentLocation || '—',
      description: 'Shipment cancelled by user. Refund issued.'
    });

    // Refund to wallet
    var user = currentUser();
    if (!user) return;
    var newBal = (user.wallet || 0) + refund;

    if (Store.updateUser) {
      Store.updateUser({ wallet: newBal });
    } else {
      var users = Store.get('users') || [];
      var ui = users.findIndex(function (u) { return u.id === user.id; });
      if (ui !== -1) { users[ui].wallet = newBal; Store.set('users', users); }
    }

    // Wallet txn
    var txns = Store.get('walletTxns') || [];
    txns.push({
      id: uid('txn'),
      userId: user.id,
      type: 'Refund',
      amount: refund,
      balanceAfter: newBal,
      description: 'Refund for cancelled shipment ' + s.trackingCode,
      ref: 'REF-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      at: fmtDT()
    });
    Store.set('walletTxns', txns);

    // Payment refund record
    var payments = Store.get('payments') || [];
    payments.push({
      id: uid('pay'),
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      amount: -refund,
      currency: 'XAF',
      method: 'wallet',
      status: 'Refunded',
      kind: 'Refund',
      ref: 'RFD-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      at: fmtDT()
    });
    Store.set('payments', payments);

    // Notification
    var notifs = Store.get('notifications') || [];
    notifs.push({
      id: uid('n'),
      userId: user.id,
      title: 'Shipment cancelled',
      message: money(refund) + ' refunded to your wallet.',
      type: 'warning',
      at: fmtDT(),
      read: false
    });
    Store.set('notifications', notifs);

    // Persist shipments to localStorage
    try {
      var raw = JSON.parse(localStorage.getItem('ge_shipments') || '[]');
      var rawIdx = raw.findIndex(function (x) { return x.trackingCode === all[i].trackingCode; });
      if (rawIdx !== -1) {
        raw[rawIdx] = all[i];
        localStorage.setItem('ge_shipments', JSON.stringify(raw));
      }
    } catch (e) {}
    Store.set('shipments', all);

    if (Realtime.notifyLocalChange) {
      Realtime.notifyLocalChange('shipment:updated', all[i]);
      Realtime.notifyLocalChange('wallet:changed', { balance: newBal, delta: refund });
      Realtime.notifyLocalChange('notification:new', notifs[notifs.length - 1]);
    }

    toast('Shipment cancelled', money(refund) + ' refunded to your wallet.', 'success');

    // Reset tab and re-render via the router
    activeTab = 'details';
    if (global.App && global.App.go) {
      global.App.go('shipment', { code: code });
    } else {
      var content = document.getElementById('content');
      if (content) content.innerHTML = render({ params: { code: code } });
    }
  }

  // --- Cleanup -------------------------------------------------------------

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    if (mapInstance) {
      try { mapInstance.remove(); } catch (e) {}
      mapInstance = null;
    }
    container = null;
    handler = null;
    code = null;
    activeTab = 'details';
    mounted = false;
  }

  // --- Register ------------------------------------------------------------

  var page = {
    title: 'Shipment Detail',
    subtitle: 'Full details, map, and activity',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('shipment', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.shipment = page;
  }

})(window);