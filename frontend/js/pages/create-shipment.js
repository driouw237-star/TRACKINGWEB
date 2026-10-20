/* GlobalExpress - pages/create-shipment.js
   Three-step shipment wizard: details, package, review & pay.

   Registers itself via App.register('create', page).
   Uses forms.css, dashboard.css, wallet.css, modals.css, buttons.css.
   Reads/writes Store (shipments, addresses, walletTxns, payments, users).
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
  var uid = Utils.uid || function (p) {
    return (p || 'id') + '_' + Math.random().toString(36).slice(2, 10);
  };
  var fmtDate = Utils.fmtDate || function (d) {
    return new Date(d || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  var fmtDT = Utils.fmtDT || function (d) {
    return new Date(d || Date.now()).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };
  var genTrackingCode = Utils.genTrackingCode || function () {
    var s = function (n) { return String(Math.floor(Math.random() * Math.pow(10, n))).padStart(n, '0'); };
    return 'GE-' + s(4) + '-' + s(4) + '-US';
  };

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  var openModal = UI.openModal || function () { return null; };
  var closeModal = UI.closeModal || function () {};
  var showProcessing = UI.processing || function () {};
  var hideProcessing = UI.processingDone || function () {};

  // --- Constants -----------------------------------------------------------

  var SHIPPING_FEE = 4000;
  var INSURANCE_FEE = 500;

  // --- Module state --------------------------------------------------------

  var step = 1;
  var draft = {};
  var pendingPaySource = '';
  var handler = null;
  var container = null;
  var mounted = false;   // guards async callbacks after cleanup

  // --- Helpers -------------------------------------------------------------

  function currentUser(ctx) {
    return (ctx && ctx.user) ||
           (global.App && global.App.state && global.App.state.user) ||
           null;
  }

  function getAddresses(userId, type) {
    var all = [];
    try { all = Store.get('addresses') || []; } catch (e) {}
    return all.filter(function (a) {
      return a.userId === userId && a.type === type;
    });
  }

  /**
   * Rebuild the shell AND the current step body.
   * The shell (panel + stepper + #createBody) is what carries the
   * wizard chrome. Only the step content inside #createBody changes.
   */
  function rerender(ctx) {
    if (!container) return;

    // Rebuild the shell (panel + stepper + empty #createBody)
    container.innerHTML = render(ctx);

    // Then fill #createBody with the current step content
    var body = document.getElementById('createBody');
    if (body) body.innerHTML = renderBody(ctx);

    bindLiveValidators();
  }

  // --- Step indicator ------------------------------------------------------

  function stepItem(n, label) {
    var done   = n < step;
    var active = n === step;
    var icon   = done ? '<i class="fas fa-check"></i>' : String(n);
    return ''
      + '<div class="step-item ' + (done ? 'done' : '') + (active ? ' active' : '') + '">'
      +   '<div class="step-num">' + icon + '</div>'
      +   '<span>' + esc(label) + '</span>'
      + '</div>';
  }

  function stepper() {
    return ''
      + '<div class="stepper">'
      +   stepItem(1, 'Shipment Details')
      +   stepItem(2, 'Package Info')
      +   stepItem(3, 'Review & Pay')
      + '</div>';
  }

  // --- Field helper --------------------------------------------------------

  function field(id, label, type, placeholder, required) {
    return ''
      + '<div class="field">'
      +   '<label>' + esc(label) + (required ? ' <span class="req">*</span>' : '') + '</label>'
      +   '<input type="' + esc(type || 'text') + '" id="' + esc(id) + '" placeholder="' + esc(placeholder || '') + '" />'
      + '</div>';
  }

  function value(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function num(id) {
    var v = value(id);
    return v === '' ? 0 : parseFloat(v) || 0;
  }

  function setInput(id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val;
  }

  // --- Address book modal --------------------------------------------------

  function pickAddress(type, ctx) {
    var user = currentUser(ctx);
    if (!user) return;
    var list = getAddresses(user.id, type);

    if (!list.length) {
      toast('Address book is empty', 'Save an address first.', 'info');
      return;
    }

    var rows = list.map(function (a) {
      return ''
        + '<div data-addr-id="' + esc(a.id) + '" style="padding:14px 22px;border-bottom:1px solid var(--border-2);cursor:pointer">'
        +   '<div style="font-weight:600">' + esc(a.name) + '</div>'
        +   '<div style="font-size:12.5px;color:var(--text-2)">' + esc(a.address) + '</div>'
        +   '<div style="font-size:11.5px;color:var(--text-3);margin-top:2px">'
        +     esc(a.email || '') + (a.phone ? ' · ' + esc(a.phone) : '')
        +   '</div>'
        + '</div>';
    }).join('');

    var modal = openModal(''
      + '<div class="modal">'
      +   '<div class="modal-head">'
      +     '<div><h3><i class="fas fa-address-book"></i> Pick '
      +       (type === 'sender' ? 'Sender' : 'Recipient') + '</h3></div>'
      +     '<button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button>'
      +   '</div>'
      +   '<div class="modal-body flush">'
      +     rows
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }

      var row = e.target.closest && e.target.closest('[data-addr-id]');
      if (row) {
        applyAddress(row.dataset.addrId, type);
        closeModal(modal);
      }
    });
  }

  function applyAddress(id, type) {
    var all = [];
    try { all = Store.get('addresses') || []; } catch (e) {}
    var a = all.filter(function (x) { return x.id === id; })[0];
    if (!a) return;

    if (type === 'sender') {
      setInput('c_senderName',     a.name || '');
      setInput('c_senderCompany',  a.company || '');
      setInput('c_senderEmail',    a.email || '');
      setInput('c_senderPhone',    a.phone || '');
      setInput('c_senderAddress',  a.address || '');
      setInput('c_originCity',     a.city || '');
      setInput('c_originLat',      a.lat || '');
      setInput('c_originLng',      a.lng || '');
    } else {
      setInput('c_receiverName',    a.name || '');
      setInput('c_receiverCompany', a.company || '');
      setInput('c_receiverEmail',   a.email || '');
      setInput('c_receiverPhone',   a.phone || '');
      setInput('c_receiverAddress', a.address || '');
      setInput('c_destCity',        a.city || '');
      setInput('c_destLat',         a.lat || '');
      setInput('c_destLng',         a.lng || '');
    }
    toast('Address applied', '', 'success');
  }

  // --- Step 1: Shipment Details --------------------------------------------

  function renderStep1(ctx) {
    var user = currentUser(ctx);
    var senders = user ? getAddresses(user.id, 'sender').length : 0;
    var receivers = user ? getAddresses(user.id, 'receiver').length : 0;

    return ''
      + '<div class="form-section">'
      +   '<div class="fs-title">'
      +     '<i class="fas fa-store"></i> Sender (Origin)'
      +     (senders ? '<button type="button" class="btn btn-sm btn-outline" style="margin-left:auto" data-action="pick-sender"><i class="fas fa-address-book"></i> Pick from book</button>' : '')
      +   '</div>'
      +   '<div class="grid-2">'
      +     field('c_senderName',    'Full Name', 'text', 'John Smith', true)
      +     field('c_senderCompany', 'Company (optional)', 'text', 'Acme Corp', false)
      +     field('c_senderEmail',   'Email', 'email', 'sender@example.com', true)
      +     field('c_senderPhone',   'Phone', 'tel', '+1 555 000 0000', false)
      +     '<div class="full">' + field('c_senderAddress', 'Full Address', 'text', '123 Main St, Dallas, TX, USA', true) + '</div>'
      +     '<div class="full"><label class="checkbox" style="font-weight:500;font-size:13px">'
      +       '<input type="checkbox" id="saveSender" /> <span>Save this sender to my address book</span>'
      +     '</label></div>'
      +   '</div>'
      + '</div>'

      + '<div class="form-section">'
      +   '<div class="fs-title">'
      +     '<i class="fas fa-user"></i> Recipient (Destination)'
      +     (receivers ? '<button type="button" class="btn btn-sm btn-outline" style="margin-left:auto" data-action="pick-receiver"><i class="fas fa-address-book"></i> Pick from book</button>' : '')
      +   '</div>'
      +   '<div class="grid-2">'
      +     field('c_receiverName',    'Full Name', 'text', 'Jane Doe', true)
      +     field('c_receiverCompany', 'Company (optional)', 'text', 'Globex Inc', false)
      +     field('c_receiverEmail',   'Email', 'email', 'receiver@example.com', true)
      +     field('c_receiverPhone',   'Phone', 'tel', '+46 736 554 389', false)
      +     '<div class="full">' + field('c_receiverAddress', 'Full Address', 'text', 'Granitgången 25, Eskilstuna, Sweden', true) + '</div>'
      +     '<div class="full"><label class="checkbox" style="font-weight:500;font-size:13px">'
      +       '<input type="checkbox" id="saveReceiver" /> <span>Save this recipient to my address book</span>'
      +     '</label></div>'
      +   '</div>'
      + '</div>'

      + '<div class="form-section">'
      +   '<div class="fs-title"><i class="fas fa-route"></i> Route</div>'
      +   '<div class="grid-2">'
      +     field('c_originCity', 'Origin City', 'text', 'Dallas, TX, USA', true)
      +     field('c_destCity',   'Destination City', 'text', 'Eskilstuna, Sweden', true)
      +     field('c_originLat',  'Origin Latitude', 'number', '32.7767', false)
      +     field('c_originLng',  'Origin Longitude', 'number', '-96.7970', false)
      +     field('c_destLat',    'Destination Latitude', 'number', '59.3667', false)
      +     field('c_destLng',    'Destination Longitude', 'number', '16.5077', false)
      +   '</div>'
      + '</div>'

      + '<div class="modal-foot" style="border:none;padding:20px 0 0;justify-content:space-between">'
      +   '<div></div>'
      +   '<button type="button" class="btn btn-primary btn-lg" data-action="next-step-1">'
      +     'Continue <i class="fas fa-arrow-right"></i>'
      +   '</button>'
      + '</div>';
  }

  function step1Rules() {
    return [
      { name: 'c_senderName',      label: 'Sender name',       required: true },
      { name: 'c_senderEmail',     label: 'Sender email',      required: true, rules: ['email'] },
      { name: 'c_senderAddress',   label: 'Sender address',    required: true },
      { name: 'c_receiverName',    label: 'Recipient name',    required: true },
      { name: 'c_receiverEmail',   label: 'Recipient email',   required: true, rules: ['email'] },
      { name: 'c_receiverAddress', label: 'Recipient address', required: true },
      { name: 'c_originCity',      label: 'Origin city',       required: true },
      { name: 'c_destCity',        label: 'Destination city',  required: true }
    ];
  }

  function nextFromStep1(ctx) {
    if (!V.form) return true; // no validator loaded — skip

    var body = document.getElementById('createBody') || container;
    var res = V.form(body, step1Rules());
    if (!res.valid) {
      toast('Missing information', 'Please complete the highlighted fields.', 'error');
      return false;
    }

    // Merge into draft
    draft.senderName      = value('c_senderName');
    draft.senderCompany   = value('c_senderCompany');
    draft.senderEmail     = value('c_senderEmail');
    draft.senderPhone     = value('c_senderPhone');
    draft.senderAddress   = value('c_senderAddress');
    draft.receiverName    = value('c_receiverName');
    draft.receiverCompany = value('c_receiverCompany');
    draft.receiverEmail   = value('c_receiverEmail');
    draft.receiverPhone   = value('c_receiverPhone');
    draft.receiverAddress = value('c_receiverAddress');
    draft.originCity      = value('c_originCity');
    draft.destCity        = value('c_destCity');
    draft.originLat       = num('c_originLat');
    draft.originLng       = num('c_originLng');
    draft.destLat         = num('c_destLat');
    draft.destLng         = num('c_destLng');

    // Save to address book
    var user = currentUser(ctx);
    var addresses = Store.get('addresses') || [];
    var added = false;

    if (user && document.getElementById('saveSender') && document.getElementById('saveSender').checked) {
      addresses.push({
        id: uid('addr'),
        userId: user.id,
        type: 'sender',
        name: draft.senderName,
        company: draft.senderCompany,
        email: draft.senderEmail,
        phone: draft.senderPhone,
        address: draft.senderAddress,
        city: draft.originCity,
        lat: draft.originLat,
        lng: draft.originLng,
        createdAt: fmtDate()
      });
      added = true;
    }
    if (user && document.getElementById('saveReceiver') && document.getElementById('saveReceiver').checked) {
      addresses.push({
        id: uid('addr'),
        userId: user.id,
        type: 'receiver',
        name: draft.receiverName,
        company: draft.receiverCompany,
        email: draft.receiverEmail,
        phone: draft.receiverPhone,
        address: draft.receiverAddress,
        city: draft.destCity,
        lat: draft.destLat,
        lng: draft.destLng,
        createdAt: fmtDate()
      });
      added = true;
    }

    if (added) {
      // Persist to localStorage, then refresh the store's in-memory copy
      try {
        var raw = JSON.parse(localStorage.getItem('ge_addresses') || '[]');
        addresses.forEach(function (a) {
          if (!raw.some(function (r) { return r.id === a.id; })) raw.push(a);
        });
        localStorage.setItem('ge_addresses', JSON.stringify(raw));
      } catch (e) {}
      Store.set('addresses', addresses);
      if (Realtime.notifyLocalChange) Realtime.notifyLocalChange('address:changed', { count: addresses.length });
    }

    return true;
  }

  // --- Step 2: Package Info ------------------------------------------------

  function renderStep2(ctx) {
    return ''
      + '<div class="form-section">'
      +   '<div class="fs-title"><i class="fas fa-box"></i> Package Details</div>'
      +   '<div class="grid-2">'
      +     '<div class="field">'
      +       '<label>Package Type <span class="req">*</span></label>'
      +       '<select id="c_packageType">'
      +         '<option value="">Select package type…</option>'
      +         '<option>Standard Box</option>'
      +         '<option>Envelope / Document</option>'
      +         '<option>Pallet</option>'
      +         '<option>Fragile Item</option>'
      +         '<option>Electronics</option>'
      +         '<option>Other</option>'
      +       '</select>'
      +     '</div>'
      +     '<div class="field">'
      +       '<label>Size</label>'
      +       '<select id="c_dimensions">'
      +         '<option>Small</option>'
      +         '<option selected>Medium</option>'
      +         '<option>Large</option>'
      +         '<option>Extra Large</option>'
      +       '</select>'
      +     '</div>'
      +     field('c_weight', 'Weight', 'text', 'e.g. 4.6 lbs (2.09 kg)', false)
      +     '<div class="field">'
      +       '<label>Service Level</label>'
      +       '<select id="c_serviceLevel">'
      +         '<option>Economy — 7–10 days</option>'
      +         '<option selected>Standard — 4–6 days</option>'
      +         '<option>Express — 2–3 days</option>'
      +         '<option>Overnight — next day</option>'
      +       '</select>'
      +     '</div>'
      +     '<div class="full field">'
      +       '<label>Contents Description</label>'
      +       '<textarea id="c_contents" placeholder="Describe what\'s inside…"></textarea>'
      +     '</div>'
      +   '</div>'
      + '</div>'

      + '<div class="form-section">'
      +   '<div class="fs-title"><i class="fas fa-truck-fast"></i> Delivery Preferences</div>'
      +   '<div class="grid-2">'
      +     field('c_estimatedDelivery', 'Estimated Delivery Date', 'text', 'e.g. October 5, 2026', false)
      +     '<div class="field">'
      +       '<label>Special Handling</label>'
      +       '<select id="c_handling">'
      +         '<option>None</option>'
      +         '<option>Fragile</option>'
      +         '<option>Perishable</option>'
      +         '<option>Signature Required</option>'
      +         '<option>Leave at Door</option>'
      +       '</select>'
      +     '</div>'
      +     '<div class="full"><label class="checkbox" style="font-weight:500;font-size:13px">'
      +       '<input type="checkbox" id="c_insured" />'
      +       ' <span>Add shipping insurance (+' + money(INSURANCE_FEE) + ')</span>'
      +     '</label></div>'
      +   '</div>'
      + '</div>'

      + '<div class="modal-foot" style="border:none;padding:20px 0 0;justify-content:space-between">'
      +   '<button type="button" class="btn btn-outline btn-lg" data-action="back-step-2">'
      +     '<i class="fas fa-arrow-left"></i> Back'
      +   '</button>'
      +   '<button type="button" class="btn btn-primary btn-lg" data-action="next-step-2">'
      +     'Review <i class="fas fa-arrow-right"></i>'
      +   '</button>'
      + '</div>';
  }

  function nextFromStep2(ctx) {
    var type = document.getElementById('c_packageType');
    if (!type || !type.value) {
      toast('Select package type', '', 'error');
      return false;
    }

    draft.packageType       = value('c_packageType');
    draft.dimensions        = value('c_dimensions');
    draft.weight            = value('c_weight');
    draft.serviceLevel      = value('c_serviceLevel');
    draft.contents          = value('c_contents');
    draft.estimatedDelivery = value('c_estimatedDelivery');
    draft.handling          = value('c_handling');
    var insuredEl = document.getElementById('c_insured');
    draft.insured = !!(insuredEl && insuredEl.checked);

    return true;
  }

  // --- Step 3: Review & Pay ------------------------------------------------

  function renderStep3(ctx) {
    var user = currentUser(ctx);
    var bal = (user && user.wallet) || 0;
    var ins = draft.insured ? INSURANCE_FEE : 0;
    var total = SHIPPING_FEE + ins;
    var canPayFromWallet = bal >= total;

    return ''
      + '<div class="form-section">'
      +   '<div class="fs-title"><i class="fas fa-clipboard-check"></i> Review Your Shipment</div>'
      +   '<div class="summary">'
      +     summaryRow('From', esc(draft.senderName) + ' · ' + esc(draft.originCity))
      +     summaryRow('To',   esc(draft.receiverName) + ' · ' + esc(draft.destCity))
      +     summaryRow('Package', esc(draft.packageType) + ' · ' + esc(draft.dimensions) + ' · ' + esc(draft.weight || '—'))
      +     summaryRow('Service', esc(draft.serviceLevel))
      +     summaryRow('Handling', esc(draft.handling))
      +     summaryRow('Shipping Fee', money(SHIPPING_FEE))
      +     (ins ? summaryRow('Insurance', money(ins)) : '')
      +     summaryRow('Total', money(total), true)
      +   '</div>'
      + '</div>'

      + '<div class="form-section">'
      +   '<div class="fs-title"><i class="fas fa-wallet"></i> Payment Source</div>'
      +   balanceCheck(bal, total, canPayFromWallet)
      +   (canPayFromWallet ? paySourceTiles(pendingPaySource) : '')
      + '</div>'

      + '<div class="modal-foot" style="border:none;padding:20px 0 0;justify-content:space-between">'
      +   '<button type="button" class="btn btn-outline btn-lg" data-action="back-step-3">'
      +     '<i class="fas fa-arrow-left"></i> Back'
      +   '</button>'
      +   (canPayFromWallet
            ? '<button type="button" class="btn btn-primary btn-lg" data-action="pay">'
              + '<i class="fas fa-lock"></i> Pay ' + money(total)
              + '</button>'
            : '<button type="button" class="btn btn-primary btn-lg" data-action="go-deposit">'
              + '<i class="fas fa-plus"></i> Deposit ' + money(total - bal)
              + '</button>')
      + '</div>';
  }

  function summaryRow(label, val, isTotal) {
    return ''
      + '<div class="summary-row' + (isTotal ? ' total' : '') + '">'
      +   '<span class="lbl">' + label + '</span>'
      +   '<span class="val">' + val + '</span>'
      + '</div>';
  }

  function balanceCheck(bal, total, ok) {
    return ''
      + '<div style="padding:14px 16px;border:1.5px solid ' + (ok ? '#a7f3d0' : '#fecaca') + ';'
      +     'background:' + (ok ? '#f0fdf4' : '#fef2f2') + ';border-radius:11px;'
      +     'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:12px">'
      +   '<div>'
      +     '<div style="font-size:12px;color:var(--text-3);text-transform:uppercase;letter-spacing:.5px;font-weight:700">Wallet Balance</div>'
      +     '<div style="font-family:\'Manrope\',sans-serif;font-weight:800;font-size:22px;color:' + (ok ? '#047857' : '#b91c1c') + ';margin-top:2px">' + money(bal) + '</div>'
      +   '</div>'
      +   (ok
          ? '<div style="font-size:13px;color:#047857;font-weight:600"><i class="fas fa-circle-check"></i> Sufficient balance</div>'
          : '<div style="font-size:13px;color:#b91c1c;font-weight:600"><i class="fas fa-triangle-exclamation"></i> Need ' + money(total - bal) + ' more</div>')
      + '</div>';
  }

  function paySourceTiles(selected) {
    var walletCls = selected === 'wallet' || !selected ? ' selected' : '';
    var directCls = selected === 'direct' ? ' selected' : '';
    return ''
      + '<div class="pay-tiles" style="margin-bottom:0">'
      +   '<div class="pay-tile' + walletCls + '" data-pay-src="wallet">'
      +     '<div class="pay-icon" style="background:#ecfdf5;color:var(--green)"><i class="fas fa-wallet"></i></div>'
      +     '<div class="pay-name">Pay from Wallet</div>'
      +     '<div class="pay-desc">Instant — no waiting</div>'
      +   '</div>'
      +   '<div class="pay-tile' + directCls + '" data-pay-src="direct">'
      +     '<div class="pay-icon" style="background:#fff7ed;color:var(--accent)"><i class="fas fa-credit-card"></i></div>'
      +     '<div class="pay-name">Pay Directly</div>'
      +     '<div class="pay-desc">MTN, Card, or Crypto</div>'
      +   '</div>'
      + '</div>';
  }

  // --- Payment flow --------------------------------------------------------

  function payNow(ctx) {
    var user = currentUser(ctx);
    if (!user) return;

    var ins = draft.insured ? INSURANCE_FEE : 0;
    var total = SHIPPING_FEE + ins;

    var source = pendingPaySource || 'wallet';
    if (source === 'wallet') {
      if ((user.wallet || 0) < total) {
        toast('Insufficient balance', 'Deposit more or choose another method.', 'error');
        return;
      }
      processWalletPayment(user, total);
    } else {
      openDirectPayModal(total);
    }
  }

  function processWalletPayment(user, total) {
    showProcessing('Processing Payment', 'Deducting from your wallet…');

    setTimeout(function () {
      if (!mounted) return;

      // Deduct balance
      var newWallet = (user.wallet || 0) - total;

      // Update user via Store (mutator form now also accepts objects)
      if (Store.updateUser) {
        Store.updateUser({ wallet: newWallet });
      } else {
        var users = Store.get('users') || [];
        var i = users.findIndex(function (u) { return u.id === user.id; });
        if (i !== -1) { users[i].wallet = newWallet; Store.set('users', users); }
      }

      // Wallet txn
      var txnId = uid('txn');
      var txns = Store.get('walletTxns') || [];
      txns.push({
        id: txnId,
        userId: user.id,
        type: 'Shipment',
        amount: -total,
        balanceAfter: newWallet,
        description: 'Shipping fee for new shipment',
        ref: 'SHIP-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
        at: fmtDT()
      });
      Store.set('walletTxns', txns);

      // Payment record
      var paymentId = uid('pay');
      var payments = Store.get('payments') || [];
      var payment = {
        id: paymentId,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        amount: total,
        currency: 'XAF',
        method: 'wallet',
        status: 'Paid',
        kind: 'Shipment',
        ref: 'TXN-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
        at: fmtDT()
      };
      payments.push(payment);
      Store.set('payments', payments);

      if (Realtime.notifyLocalChange) {
        Realtime.notifyLocalChange('wallet:changed', { balance: newWallet, delta: -total });
        Realtime.notifyLocalChange('payment:created', payment);
      }

      hideProcessing();
      finalizeShipment(user, total, 'wallet', paymentId);
    }, 1500);
  }

  function openDirectPayModal(total) {
    var modal = openModal(''
      + '<div class="modal">'
      +   '<div class="modal-head">'
      +     '<div><h3><i class="fas fa-credit-card"></i> Pay Directly</h3>'
      +       '<div class="sub">Total: ' + money(total) + '</div></div>'
      +     '<button type="button" class="modal-close" data-close><i class="fas fa-times"></i></button>'
      +   '</div>'
      +   '<div class="modal-body">'
      +     '<div class="grid-2">'
      +       '<div class="field">'
      +         '<label>Payment Method</label>'
      +         '<select id="dpMethod">'
      +           '<option value="mtn">MTN Mobile Money</option>'
      +           '<option value="momo">Mobile Money</option>'
      +           '<option value="card">Credit/Debit Card</option>'
      +           '<option value="crypto">Cryptocurrency</option>'
      +         '</select>'
      +       '</div>'
      +       '<div class="field">'
      +         '<label>Reference / Phone / Card</label>'
      +         '<input id="dpRef" placeholder="Phone, card, or wallet" />'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      +   '<div class="modal-foot">'
      +     '<button type="button" class="btn btn-outline" data-close>Cancel</button>'
      +     '<button type="button" class="btn btn-primary" data-confirm-pay><i class="fas fa-lock"></i> Pay ' + money(total) + '</button>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close]')) { closeModal(modal); return; }
      if (e.target === modal) { closeModal(modal); return; }
      if (e.target.closest && e.target.closest('[data-confirm-pay]')) {
        var method = (document.getElementById('dpMethod') || {}).value || 'mtn';
        var ref = (document.getElementById('dpRef') || {}).value || '';
        if (!ref.trim()) { toast('Enter payment reference', '', 'error'); return; }
        closeModal(modal);
        processDirectPayment(method, ref, total);
      }
    });
  }

  function processDirectPayment(method, ref, total) {
    showProcessing('Processing Payment', 'Confirming your transaction…');
    setTimeout(function () {
      if (!mounted) return;

      var user = currentUser();
      if (!user) { hideProcessing(); return; }

      var paymentId = uid('pay');
      var payments = Store.get('payments') || [];
      var payment = {
        id: paymentId,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        amount: total,
        currency: 'XAF',
        method: method,
        status: 'Paid',
        kind: 'Shipment',
        ref: 'TXN-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
        at: fmtDT()
      };
      payments.push(payment);
      Store.set('payments', payments);
      if (Realtime.notifyLocalChange) Realtime.notifyLocalChange('payment:created', payment);

      hideProcessing();
      finalizeShipment(user, total, method, paymentId);
    }, 1500);
  }

  function finalizeShipment(user, total, method, paymentId) {
    var code = genTrackingCode();
    var shipment = {
      trackingCode:    code,
      createdBy:       user.id,
      createdByName:   user.name,
      createdByEmail:  user.email,
      paid:            true,
      amountPaid:      total,
      paymentMethod:   method,
      paymentId:       paymentId || null,   // ← link to the payment

      // sender
      senderName:      draft.senderName,
      senderCompany:   draft.senderCompany,
      senderEmail:     draft.senderEmail,
      senderPhone:     draft.senderPhone,
      senderAddress:   draft.senderAddress,

      // receiver
      receiverName:    draft.receiverName,
      receiverCompany: draft.receiverCompany,
      receiverEmail:   draft.receiverEmail,
      receiverPhone:   draft.receiverPhone,
      receiverAddress: draft.receiverAddress,

      // route
      originCity:      draft.originCity,
      destCity:        draft.destCity,

      // package
      packageType:       draft.packageType,
      dimensions:        draft.dimensions,
      weight:            draft.weight,
      serviceLevel:      draft.serviceLevel,
      contents:          draft.contents,
      handling:          draft.handling,
      insured:           draft.insured,
      estimatedDelivery: draft.estimatedDelivery,

      // logistics
      status:          'Pending',
      currentLocation: draft.originCity,
      coords: {
        origin:  { lat: draft.originLat, lng: draft.originLng },
        current: { lat: draft.originLat, lng: draft.originLng },
        dest:    { lat: draft.destLat,   lng: draft.destLng }
      },
      activities: [{
        date: fmtDT(),
        location: draft.originCity,
        description: 'Shipment registered. Payment confirmed.'
      }],
      createdAt: fmtDate()
    };

    // Persist to localStorage, then refresh the store's in-memory copy
    try {
      var raw = JSON.parse(localStorage.getItem('ge_shipments') || '[]');
      raw.push(shipment);
      localStorage.setItem('ge_shipments', JSON.stringify(raw));
    } catch (e) {}
    var ships = Store.get('shipments') || [];
    ships.push(shipment);
    Store.set('shipments', ships);

    // Notification
    var notifId = uid('n');
    var notifs = Store.get('notifications') || [];
    var notif = {
      id: notifId,
      userId: user.id,
      title: 'Shipment created',
      message: 'Tracking code: ' + code,
      type: 'success',
      at: fmtDT(),
      read: false
    };
    notifs.push(notif);
    Store.set('notifications', notifs);

    if (Realtime.notifyLocalChange) {
      Realtime.notifyLocalChange('shipment:created', shipment);
      Realtime.notifyLocalChange('notification:new', notif);
    }

    // Refresh the sidebar badge + topbar wallet chip
    if (global.App && global.App.refreshSidebar) global.App.refreshSidebar();

    // Reset wizard
    draft = {};
    step = 1;
    pendingPaySource = '';

    showSuccessModal(code);
  }

  function showSuccessModal(code) {
    var modal = openModal(''
      + '<div class="modal narrow">'
      +   '<div class="modal-body" style="text-align:center;padding:34px 24px 20px">'
      +     '<div class="receipt-icon"><i class="fas fa-check"></i></div>'
      +     '<h3 style="font-size:19px;margin-bottom:6px">Shipment Created!</h3>'
      +     '<p style="color:var(--text-2);font-size:13.5px;margin-bottom:22px">'
      +       'Share this code or link with anyone — they can track without an account.'
      +     '</p>'
      +     '<div class="deposit-receipt">'
      +       '<div class="receipt-label">Tracking Code</div>'
      +       '<div class="receipt-balance" style="color:var(--brand)">' + esc(code) + '</div>'
      +     '</div>'
      +   '</div>'
      +   '<div class="modal-foot" style="justify-content:center;flex-direction:column;gap:10px">'
      +     '<button type="button" class="btn btn-primary btn-block" data-action="share-code" data-code="' + esc(code) + '">'
      +       '<i class="fas fa-share-nodes"></i> Share Tracking'
      +     '</button>'
      +     '<button type="button" class="btn btn-outline btn-block" data-action="view-shipments">'
      +       '<i class="fas fa-box"></i> View My Shipments'
      +     '</button>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'share-code') {
        var codeVal = btn.dataset.code;
        if (typeof global.shareShipment === 'function') {
          closeModal(modal);
          global.shareShipment(codeVal);
        } else {
          navigator.clipboard.writeText(codeVal).then(function () {
            toast('Code copied', codeVal, 'success');
          });
        }
      } else if (action === 'view-shipments') {
        closeModal(modal);
        if (global.App && global.App.go) global.App.go('shipments');
      }
    });
  }

  // --- Top-level render ----------------------------------------------------

  function renderBody(ctx) {
    if (step === 1) return renderStep1(ctx);
    if (step === 2) return renderStep2(ctx);
    return renderStep3(ctx);
  }

  function render(ctx) {
    return ''
      + '<div class="panel">'
      +   '<div class="panel-body">'
      +     stepper()
      +     '<div id="createBody"></div>'
      +   '</div>'
      + '</div>';
  }

  // --- Live validators -----------------------------------------------------

  function bindLiveValidators() {
    if (!V.attachLive) return;
    var body = document.getElementById('createBody');
    if (!body) return;
    if (step === 1) {
      V.attachLive(body, step1Rules(), { blur: true });
    }
  }

  // --- Bind ----------------------------------------------------------------

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;
    mounted = true;

    // Populate the body BEFORE wiring listeners
    var body = document.getElementById('createBody');
    if (body) {
      body.innerHTML = renderBody(ctx);
      bindLiveValidators();
    }

    handler = function (e) {
      var btn = e.target.closest ? e.target.closest('[data-action]') : null;
      var payTile = e.target.closest ? e.target.closest('[data-pay-src]') : null;

      // Payment source tiles
      if (payTile) {
        pendingPaySource = payTile.dataset.paySrc;
        var tiles = document.querySelectorAll('[data-pay-src]');
        tiles.forEach(function (t) { t.classList.remove('selected'); });
        payTile.classList.add('selected');
        return;
      }

      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'pick-sender')   { pickAddress('sender', ctx); return; }
      if (action === 'pick-receiver') { pickAddress('receiver', ctx); return; }

      if (action === 'next-step-1') {
        if (nextFromStep1(ctx)) { step = 2; rerender(ctx); }
        return;
      }
      if (action === 'back-step-2') { step = 1; rerender(ctx); return; }
      if (action === 'next-step-2') {
        if (nextFromStep2(ctx)) { step = 3; rerender(ctx); }
        return;
      }
      if (action === 'back-step-3') { step = 2; rerender(ctx); return; }
      if (action === 'pay')         { payNow(ctx); return; }
      if (action === 'go-deposit')  {
        if (global.App && global.App.go) global.App.go('deposit');
        return;
      }
    };

    container.addEventListener('click', handler);
  }

  // --- Cleanup -------------------------------------------------------------

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler = null;
    mounted = false;
    step = 1;
    draft = {};
    pendingPaySource = '';
  }

  // --- Register ------------------------------------------------------------

  var page = {
    title: 'Create Shipment',
    subtitle: 'Enter details, then pay to generate a tracking code',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('create', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.create = page;
  }

})(window);