/* GlobalExpress - pages/deposit.js
   Deposit money page: amount picker, payment method tiles, method-specific
   forms, trust chips, validation, processing overlay, success modal.

   Registers itself via App.register('deposit', page).
   Writes: ge_users.wallet, ge_walletTxns, ge_payments, ge_notifications.
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
  var fmtDT = Utils.fmtDT || function (d) {
    return new Date(d || Date.now()).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  var openModal = UI.openModal || function () { return null; };
  var closeModal = UI.closeModal || function () {};
  var showProcessing = UI.processing || function () {};
  var hideProcessing = UI.processingDone || function () {};

  // --- Constants -----------------------------------------------------------

  var QUICK_AMOUNTS = [1000, 2000, 5000, 10000, 25000, 50000];
  var MIN_AMOUNT = 500;
  var MAX_AMOUNT = 500000;

  // --- Module state --------------------------------------------------------

  var amount = 0;
  var method = '';
  var handler = null;
  var container = null;

  // --- Helpers -------------------------------------------------------------

  function currentUser(ctx) {
    return (ctx && ctx.user) ||
           (global.App && global.App.state && global.App.state.user) ||
           null;
  }

  function isValidAmount(v) {
    var n = Number(v);
    return isFinite(n) && n >= MIN_AMOUNT && n <= MAX_AMOUNT;
  }

  function isQuickAmount(v) {
    return QUICK_AMOUNTS.indexOf(Number(v)) !== -1;
  }

  function gv(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  // --- Method tiles --------------------------------------------------------

  function payTile(opts) {
    var selected = method === opts.id ? ' selected' : '';
    return ''
      + '<div class="pay-tile' + selected + '" data-method="' + esc(opts.id) + '">'
      +   '<div class="pay-icon ' + esc(opts.cls) + '"><i class="fas ' + esc(opts.icon) + '"></i></div>'
      +   '<div class="pay-name">' + esc(opts.name) + '</div>'
      +   '<div class="pay-desc">' + esc(opts.desc) + '</div>'
      + '</div>';
  }

  function payTiles() {
    return ''
      + '<div class="pay-tiles">'
      +   payTile({ id: 'mtn',    name: 'MTN Mobile Money',     desc: 'Fast & secure',           icon: 'fa-mobile-screen-button', cls: 'mtn' })
      +   payTile({ id: 'momo',   name: 'Mobile Money',         desc: 'Orange, Airtel, etc.',    icon: 'fa-wallet',               cls: 'momo' })
      +   payTile({ id: 'card',   name: 'Credit / Debit Card',  desc: 'Visa, Mastercard, Amex',  icon: 'fa-credit-card',          cls: 'card' })
      +   payTile({ id: 'crypto', name: 'Cryptocurrency',       desc: 'BTC, ETH, USDT',          icon: 'fa-bitcoin-sign',         cls: 'crypto' })
      + '</div>';
  }

  // --- Method-specific forms ----------------------------------------------

  function renderMethodForm() {
    if (!method) {
      return '<p style="text-align:center;color:var(--text-3);font-size:13.5px;padding:20px">Select a payment method above to continue.</p>';
    }

    if (method === 'mtn' || method === 'momo') {
      var label = method === 'mtn' ? 'MTN Mobile Money' : 'Mobile Money';
      return ''
        + '<div style="height:1px;background:var(--border);margin:18px 0"></div>'
        + '<h4 style="font-size:14.5px;margin-bottom:14px;display:flex;align-items:center;gap:8px">'
        +   '<i class="fas fa-mobile-screen-button" style="color:var(--accent)"></i> ' + esc(label) + ' Details'
        + '</h4>'
        + '<div class="grid-2">'
        +   '<div class="field">'
        +     '<label>Phone Number <span class="req">*</span></label>'
        +     '<input type="tel" id="depPhone" placeholder="+237 6XX XXX XXX" />'
        +   '</div>'
        +   '<div class="field">'
        +     '<label>Account Name <span class="req">*</span></label>'
        +     '<input type="text" id="depName" placeholder="Name on the account" />'
        +   '</div>'
        + '</div>'
        + '<p class="hint" style="margin-top:10px">You will receive a prompt on your phone to confirm.</p>';
    }

    if (method === 'card') {
      return ''
        + '<div style="height:1px;background:var(--border);margin:18px 0"></div>'
        + '<h4 style="font-size:14.5px;margin-bottom:14px;display:flex;align-items:center;gap:8px">'
        +   '<i class="fas fa-credit-card" style="color:var(--accent)"></i> Card Details'
        + '</h4>'
        + '<div class="grid-2">'
        +   '<div class="field" style="grid-column:1/-1">'
        +     '<label>Card Number <span class="req">*</span></label>'
        +     '<input type="text" id="depCard" placeholder="1234 5678 9012 3456" maxlength="19" />'
        +   '</div>'
        +   '<div class="field">'
        +     '<label>Expiry <span class="req">*</span></label>'
        +     '<input type="text" id="depExpiry" placeholder="12/28" maxlength="5" />'
        +   '</div>'
        +   '<div class="field">'
        +     '<label>CVC <span class="req">*</span></label>'
        +     '<input type="text" id="depCvc" placeholder="123" maxlength="4" />'
        +   '</div>'
        +   '<div class="field" style="grid-column:1/-1">'
        +     '<label>Name on Card <span class="req">*</span></label>'
        +     '<input type="text" id="depCardName" placeholder="John Smith" />'
        +   '</div>'
        + '</div>';
    }

    if (method === 'crypto') {
      return ''
        + '<div style="height:1px;background:var(--border);margin:18px 0"></div>'
        + '<h4 style="font-size:14.5px;margin-bottom:14px;display:flex;align-items:center;gap:8px">'
        +   '<i class="fas fa-bitcoin-sign" style="color:var(--accent)"></i> Crypto Payment'
        + '</h4>'
        + '<div class="grid-2">'
        +   '<div class="field">'
        +     '<label>Network</label>'
        +     '<select id="depNetwork">'
        +       '<option>Bitcoin (BTC)</option>'
        +       '<option>Ethereum (ETH)</option>'
        +       '<option>USDT (TRC20)</option>'
        +       '<option>USDT (ERC20)</option>'
        +     '</select>'
        +   '</div>'
        +   '<div class="field">'
        +     '<label>Your Wallet Address <span class="req">*</span></label>'
        +     '<input type="text" id="depWallet" placeholder="Your wallet address" />'
        +   '</div>'
        + '</div>'
        + '<div class="method-note" style="margin-top:14px">'
        +   '<strong>Demo mode:</strong> No real crypto transfer occurs.'
        + '</div>';
    }

    return '';
  }

  // --- Body ----------------------------------------------------------------

  function renderForm(user) {
    return ''
      + '<div class="amount-banner">'
      +   '<div class="lbl">Current Wallet Balance</div>'
      +   '<div class="amt"><small>Fr.</small>' + esc((user.wallet || 0).toLocaleString()) + '</div>'
      + '</div>'

      + '<div class="panel">'
      +   '<div class="panel-header"><h3><i class="fas fa-circle-plus"></i> How much do you want to deposit?</h3></div>'
      +   '<div class="panel-body">'
      +     '<div class="quick-amounts">'
      +       QUICK_AMOUNTS.map(function (a) {
              return ''
                + '<div class="quick-amount' + (amount === a ? ' selected' : '') + '" data-amount="' + a + '">'
                +   '<div class="amt">' + a.toLocaleString() + '</div>'
                +   '<div class="lbl">Fr.</div>'
                + '</div>';
            }).join('')
      +     '</div>'
      +     '<div class="field" style="margin-top:14px">'
      +       '<label>Or enter a custom amount</label>'
      +       '<input type="number" id="customAmount" placeholder="e.g. 7500"'
      +         (amount && !isQuickAmount(amount) ? ' value="' + esc(amount) + '"' : '')
      +       ' />'
      +       '<div class="hint">Minimum: ' + money(MIN_AMOUNT) + ' · Maximum: ' + money(MAX_AMOUNT) + '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>'

      + '<div class="panel">'
      +   '<div class="panel-header"><h3><i class="fas fa-credit-card"></i> Payment Method</h3></div>'
      +   '<div class="panel-body">'
      +     payTiles()
      +     '<div id="depFormArea">' + renderMethodForm() + '</div>'
      +   '</div>'
      + '</div>'

      + '<div class="panel">'
      +   '<div class="panel-body dep-foot" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;align-items:center">'
      +     '<button type="button" class="btn btn-ghost" data-action="go-dashboard"><i class="fas fa-arrow-left"></i> Back</button>'
      +     '<button type="button" class="btn btn-primary btn-lg" id="depBtn" disabled>'
      +       '<i class="fas fa-lock"></i> Deposit'
      +     '</button>'
      +   '</div>'
      + '</div>'

      + '<div class="trust-chips">'
      +   '<span class="trust-chip ssl"><i class="fas fa-lock"></i> SSL Secured</span>'
      +   '<span class="trust-chip pci"><i class="fas fa-shield-halved"></i> PCI Compliant</span>'
      +   '<span class="trust-chip instant"><i class="fas fa-circle-check"></i> Instant Credit</span>'
      + '</div>';
  }

  // --- Update button -------------------------------------------------------

  function updateButton() {
    var btn = document.getElementById('depBtn');
    if (!btn) return;
    var valid = isValidAmount(amount) && !!method;
    btn.disabled = !valid;
    // Only show the amount when one has been picked — otherwise the button
    // says "Deposit Fr. 0" which is confusing.
    btn.innerHTML = amount
      ? '<i class="fas fa-lock"></i> Deposit ' + money(amount)
      : '<i class="fas fa-lock"></i> Deposit';
  }

  // --- Method validation ---------------------------------------------------

  function validateMethodFields() {
    if (method === 'mtn' || method === 'momo') {
      if (!gv('depPhone')) return 'Phone number is required';
      if (!gv('depName'))  return 'Account name is required';
    } else if (method === 'card') {
      if (!gv('depCard'))     return 'Card number is required';
      if (!gv('depExpiry'))   return 'Expiry is required';
      if (!gv('depCvc'))      return 'CVC is required';
      if (!gv('depCardName')) return 'Name on card is required';
    } else if (method === 'crypto') {
      if (!gv('depWallet')) return 'Wallet address is required';
    } else {
      return 'Select a payment method';
    }
    return null;
  }

  // --- Deposit flow --------------------------------------------------------

  function processDeposit(ctx) {
    if (!isValidAmount(amount)) {
      toast('Invalid amount', 'Minimum: ' + money(MIN_AMOUNT) + ' · Maximum: ' + money(MAX_AMOUNT), 'error');
      return;
    }

    var fieldErr = validateMethodFields();
    if (fieldErr) { toast('Missing information', fieldErr, 'error'); return; }

    showProcessing('Processing Deposit', 'Confirming your transaction…');

    setTimeout(function () {
      var procMsg = document.getElementById('procMsg');
      if (procMsg) procMsg.textContent = 'Adding funds to your wallet…';

      setTimeout(function () {
        hideProcessing();
        completeDeposit(ctx);
      }, 1400);
    }, 1600);
  }

  function completeDeposit(ctx) {
    var user = currentUser(ctx);
    if (!user) return;

    var deposit = Number(amount);
    var newBal = (user.wallet || 0) + deposit;

    // 1. Update user wallet via Store (mutator form OR object form)
    if (Store.updateUser) {
      Store.updateUser({ wallet: newBal });
    } else {
      var users = Store.get('users') || [];
      var i = users.findIndex(function (u) { return u.id === user.id; });
      if (i !== -1) { users[i].wallet = newBal; Store.set('users', users); }
    }

    // 2. Refresh local App state so the topbar picks up the change
    if (global.App && global.App.state) {
      var fresh = Store.get('user');
      if (fresh) global.App.state.user = fresh;
    }

    // 3. Wallet txn
    var txns = Store.get('walletTxns') || [];
    txns.push({
      id: uid('txn'),
      userId: user.id,
      type: 'Deposit',
      amount: deposit,
      balanceAfter: newBal,
      description: 'Deposit via ' + method.toUpperCase(),
      method: method,
      ref: 'DEP-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      at: fmtDT()
    });
    Store.set('walletTxns', txns);

    // 4. Payment record
    var payments = Store.get('payments') || [];
    payments.push({
      id: uid('pay'),
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      amount: deposit,
      currency: 'XAF',
      method: method,
      status: 'Paid',
      kind: 'Deposit',
      ref: 'TXN-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      at: fmtDT()
    });
    Store.set('payments', payments);

    // 5. Notification
    var notifs = Store.get('notifications') || [];
    notifs.push({
      id: uid('n'),
      userId: user.id,
      title: 'Deposit successful',
      message: money(deposit) + ' added to your wallet.',
      type: 'success',
      at: fmtDT(),
      read: false
    });
    Store.set('notifications', notifs);

    // 6. Realtime events
    if (Realtime.notifyLocalChange) {
      Realtime.notifyLocalChange('wallet:changed', { balance: newBal, delta: deposit });
      Realtime.notifyLocalChange('payment:created', { id: user.id, amount: deposit });
      Realtime.notifyLocalChange('notification:new', { userId: user.id, title: 'Deposit successful' });
    }

    var completedAmount = deposit;

    // Reset local state
    amount = 0;
    method = '';

    // Refresh topbar wallet chip
    if (global.App && global.App.refreshSidebar) global.App.refreshSidebar();

    // Re-render the deposit form so it starts fresh (optional — keeps
    // the page consistent with the "money moved" reality)
    // (We leave the page as-is so the success modal has context.)

    showSuccessModal(completedAmount, newBal);
    toast('Deposit successful', money(completedAmount) + ' added to your wallet.', 'success');
  }

  function showSuccessModal(deposited, newBal) {
    var modal = openModal(''
      + '<div class="modal narrow">'
      +   '<div class="modal-body" style="text-align:center;padding:34px 24px 20px">'
      +     '<div class="receipt-icon"><i class="fas fa-check"></i></div>'
      +     '<h3 style="font-size:19px;margin-bottom:6px">Deposit Successful!</h3>'
      +     '<p style="color:var(--text-2);font-size:13.5px;margin-bottom:20px">Your wallet has been topped up.</p>'
      +     '<div class="deposit-receipt">'
      +       '<div class="receipt-label">New Balance</div>'
      +       '<div class="receipt-balance">' + money(newBal) + '</div>'
      +       '<div class="receipt-sub">' + money(deposited) + ' added</div>'
      +     '</div>'
      +   '</div>'
      +   '<div class="modal-foot" style="justify-content:center">'
      +     '<button type="button" class="btn btn-outline" data-action="go-wallet">View Wallet</button>'
      +     '<button type="button" class="btn btn-primary" data-action="go-create">Ship Now</button>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target === modal) { closeModal(modal); return; }
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'go-wallet') {
        closeModal(modal);
        if (global.App) global.App.go('wallet');
      } else if (btn.dataset.action === 'go-create') {
        closeModal(modal);
        if (global.App) global.App.go('create');
      }
    });
  }

  // --- Top-level render ----------------------------------------------------

  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';
    return renderForm(user);
  }

  // --- Bind ----------------------------------------------------------------

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    // Remove any previous handler (idempotent bind)
    if (handler) container.removeEventListener('click', handler);

    // Seed UI state
    updateButton();

    handler = function (e) {
      // Quick amount tiles
      var quick = e.target.closest && e.target.closest('[data-amount]');
      if (quick) {
        amount = Number(quick.dataset.amount) || 0;

        // Update selection classes on all quick amount tiles
        var allQuick = container.querySelectorAll('[data-amount]');
        for (var i = 0; i < allQuick.length; i++) {
          allQuick[i].classList.toggle('selected', Number(allQuick[i].dataset.amount) === amount);
        }

        // Sync the custom amount input
        var custom = document.getElementById('customAmount');
        if (custom) custom.value = amount;

        updateButton();
        return;
      }

      // Method tiles
      var tile = e.target.closest && e.target.closest('[data-method]');
      if (tile) {
        var newMethod = tile.dataset.method;
        // Clicking the same method again deselects it (toggle behavior)
        method = (method === newMethod) ? '' : newMethod;

        var allMethods = container.querySelectorAll('[data-method]');
        for (var j = 0; j < allMethods.length; j++) {
          allMethods[j].classList.toggle('selected', allMethods[j].dataset.method === method);
        }

        var area = document.getElementById('depFormArea');
        if (area) area.innerHTML = renderMethodForm();

        updateButton();
        return;
      }

      // Action buttons
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (btn && btn.dataset.action === 'go-dashboard') {
        if (global.App) global.App.go('dashboard');
        return;
      }

      // Deposit button
      var depBtn = e.target.closest && e.target.closest('#depBtn');
      if (depBtn && !depBtn.disabled) {
        processDeposit(ctx);
        return;
      }
    };

    container.addEventListener('click', handler);

    // Custom amount input
    var customInput = document.getElementById('customAmount');
    if (customInput) {
      customInput.addEventListener('input', function () {
        var raw = customInput.value;
        amount = raw === '' ? 0 : Number(raw) || 0;

        // Deselect quick tiles if the value isn't a quick amount
        var allQuick = container.querySelectorAll('[data-amount]');
        for (var i = 0; i < allQuick.length; i++) {
          allQuick[i].classList.toggle('selected', Number(allQuick[i].dataset.amount) === amount);
        }

        updateButton();
      });
    }
  }

  // --- Cleanup -------------------------------------------------------------

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler = null;
    amount = 0;
    method = '';
  }

  // --- Register ------------------------------------------------------------

  var page = {
    title: 'Deposit Money',
    subtitle: 'Add funds to your wallet',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('deposit', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.deposit = page;
  }

})(window);