/* GlobalExpress - pages/withdraw.js
   Withdraw money page: amount banner, amount input, withdraw all link,
   percent tiles (25/50/75/100) + fixed amount tiles, destination tiles,
   destination-specific form, warnings, validation, processing overlay,
   success modal, realtime emission.

   Registers itself via App.register('withdraw', page).
   Writes: ge_users.wallet, ge_walletTxns, ge_payments, ge_notifications.
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
  var uid = Utils.uid || function (p) {
    return (p || 'id') + '_' + Math.random().toString(36).slice(2, 10);
  };
  var fmtDT = Utils.fmtDT || function (d) {
    return new Date(d || Date.now()).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  };

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };
  var openModal  = UI.openModal  || function () { return null; };
  var closeModal = UI.closeModal || function () {};
  var showProcessing = UI.processing     || function () {};
  var hideProcessing = UI.processingDone || function () {};

  // --- Constants -----------------------------------------------------------

  var MIN_AMOUNT = 500;
  var LOW_BALANCE_THRESHOLD = 500;
  var PERCENTAGES = [25, 50, 75, 100];
  var FIXED = [500, 1000, 2500, 5000];
  var DESTINATIONS = [
    { key: 'mtn',  name: 'MTN Mobile Money', desc: 'Fast & secure',       icon: 'fa-mobile-screen-button' },
    { key: 'momo', name: 'Mobile Money',     desc: 'Orange, Airtel, etc.', icon: 'fa-wallet' },
    { key: 'bank', name: 'Bank Transfer',    desc: '1–3 business days',   icon: 'fa-building-columns' }
  ];

  // --- Module state --------------------------------------------------------

  var amount = 0;
  var destination = '';
  var processing = false;
  var handler = null;
  var container = null;
  var ctxRef = null;

  // --- Helpers -------------------------------------------------------------

  function currentUser(ctx) {
    return (ctx && ctx.user) ||
           (ctxRef && ctxRef.user) ||
           (global.App && global.App.state && global.App.state.user) ||
           null;
  }

  function getEl(id) { return document.getElementById(id); }

  function readValue(id) {
    var el = getEl(id);
    return el ? String(el.value || '').trim() : '';
  }

  function balance(ctx) {
    var user = currentUser(ctx);
    return (user && user.wallet) || 0;
  }

  // --- Tile renderers ------------------------------------------------------

  function renderPercentTiles(ctx) {
    var bal = balance(ctx);
    return PERCENTAGES.map(function (p) {
      var amt = Math.floor(bal * p / 100);
      var disabled = (amt < MIN_AMOUNT);
      var selected = (amount === amt && amt > 0) ? ' selected' : '';
      return ''
        + '<div class="quick-amount' + selected + (disabled ? ' disabled' : '') + '"'
        +      (disabled ? '' : ' data-percent="' + p + '"')
        +      (disabled ? ' style="opacity:.45;cursor:not-allowed"' : '')
        + '>'
        +   '<div class="amt">' + p + '%</div>'
        +   '<div class="lbl">' + amt.toLocaleString() + ' Fr.</div>'
        + '</div>';
    }).join('');
  }

  function renderFixedTiles(ctx) {
    var bal = balance(ctx);
    return FIXED.map(function (a) {
      var disabled = (a > bal);
      var selected = (amount === a) ? ' selected' : '';
      return ''
        + '<div class="quick-amount' + selected + (disabled ? ' disabled' : '') + '"'
        +      (disabled ? '' : ' data-fixed="' + a + '"')
        +      (disabled ? ' style="opacity:.45;cursor:not-allowed"' : '')
        + '>'
        +   '<div class="amt">' + a.toLocaleString() + '</div>'
        +   '<div class="lbl">Fr.</div>'
        + '</div>';
    }).join('');
  }

  function renderDestinationTiles() {
    return DESTINATIONS.map(function (d) {
      var sel = (destination === d.key) ? ' selected' : '';
      return ''
        + '<div class="pay-tile' + sel + '" data-dest="' + esc(d.key) + '">'
        +   '<div class="pay-icon ' + esc(d.key) + '"><i class="fas ' + esc(d.icon) + '"></i></div>'
        +   '<div class="pay-name">' + esc(d.name) + '</div>'
        +   '<div class="pay-desc">' + esc(d.desc) + '</div>'
        + '</div>';
    }).join('');
  }

  // --- Destination form ----------------------------------------------------

  function renderDestinationForm() {
    if (!destination) {
      return '<p style="text-align:center;color:var(--text-3);font-size:13.5px;padding:20px">Choose a destination above to continue.</p>';
    }

    if (destination === 'mtn' || destination === 'momo') {
      var label = destination === 'mtn' ? 'MTN Mobile Money' : 'Mobile Money';
      return ''
        + '<div style="height:1px;background:var(--border);margin:18px 0"></div>'
        + '<h4 style="font-size:14.5px;margin:0 0 14px;display:flex;align-items:center;gap:8px">'
        +   '<i class="fas fa-mobile-screen-button" style="color:var(--accent)"></i> ' + esc(label) + ' Details'
        + '</h4>'
        + '<div class="grid-2">'
        +   '<div class="field">'
        +     '<label>Phone Number <span class="req">*</span></label>'
        +     '<input type="tel" id="wdPhone" placeholder="+237 6XX XXX XXX" />'
        +   '</div>'
        +   '<div class="field">'
        +     '<label>Account Name <span class="req">*</span></label>'
        +     '<input type="text" id="wdName" placeholder="Name on the account" />'
        +   '</div>'
        + '</div>'
        + '<p class="hint" style="margin-top:10px">Funds are usually credited within a few minutes.</p>';
    }

    if (destination === 'bank') {
      return ''
        + '<div style="height:1px;background:var(--border);margin:18px 0"></div>'
        + '<h4 style="font-size:14.5px;margin:0 0 14px;display:flex;align-items:center;gap:8px">'
        +   '<i class="fas fa-building-columns" style="color:var(--accent)"></i> Bank Account'
        + '</h4>'
        + '<div class="grid-2">'
        +   '<div class="field" style="grid-column:1/-1">'
        +     '<label>Account Holder <span class="req">*</span></label>'
        +     '<input type="text" id="wdHolder" placeholder="Full name on the account" />'
        +   '</div>'
        +   '<div class="field" style="grid-column:1/-1">'
        +     '<label>IBAN / Account Number <span class="req">*</span></label>'
        +     '<input type="text" id="wdIban" placeholder="e.g. DE89 3704 0044 0532 0130 00" maxlength="42" />'
        +   '</div>'
        +   '<div class="field" style="grid-column:1/-1">'
        +     '<label>Bank Name <span class="req">*</span></label>'
        +     '<input type="text" id="wdBank" placeholder="e.g. Deutsche Bank" />'
        +   '</div>'
        + '</div>'
        + '<div class="method-note" style="margin-top:14px">'
        +   '<strong>Note:</strong> Bank transfers typically take 1–3 business days. Demo mode — no real transfer occurs.'
        + '</div>';
    }

    return '';
  }

  // --- Warnings ------------------------------------------------------------

  function renderWarnings(ctx) {
    var bal = balance(ctx);

    if (amount > bal) {
      return ''
        + '<div class="withdraw-warn" style="background:#fef2f2;border-left-color:var(--red);color:#991b1b">'
        +   '<i class="fas fa-circle-exclamation"></i> '
        +   '<strong>Insufficient balance.</strong> You can withdraw up to ' + esc(money(bal)) + '.'
        + '</div>';
    }

    if (amount > 0 && (bal - amount) < LOW_BALANCE_THRESHOLD) {
      return ''
        + '<div class="withdraw-warn">'
        +   '<i class="fas fa-circle-info"></i> After this withdrawal you\'ll have '
        +   esc(money(bal - amount)) + ' left in your wallet.'
        + '</div>';
    }

    return '';
  }

  // --- Button state --------------------------------------------------------

  function submitButtonLabel() {
    if (!amount || !destination || amount < MIN_AMOUNT) {
      return '<i class="fas fa-arrow-up-from-bracket"></i> Withdraw';
    }
    return '<i class="fas fa-arrow-up-from-bracket"></i> Withdraw ' + money(amount);
  }

  function isReady(ctx) {
    var bal = balance(ctx);
    return amount >= MIN_AMOUNT
        && amount <= bal
        && !!destination
        && !processing;
  }

  function updateButton(ctx) {
    var btn = getEl('wdBtn');
    if (!btn) return;
    btn.disabled = !isReady(ctx);
    btn.innerHTML = submitButtonLabel();
  }

  function updateWarnings(ctx) {
    var host = getEl('wdWarnings');
    if (host) host.innerHTML = renderWarnings(ctx);
  }

  function updateTileSelection() {
    // Percent tiles
    var pctTiles = document.querySelectorAll('[data-percent]');
    for (var i = 0; i < pctTiles.length; i++) {
      var p = parseInt(pctTiles[i].dataset.percent, 10);
      var expected = Math.floor(balance(ctxRef) * p / 100);
      pctTiles[i].classList.toggle('selected', expected === amount && expected > 0);
    }
    // Fixed tiles
    var fixedTiles = document.querySelectorAll('[data-fixed]');
    for (var j = 0; j < fixedTiles.length; j++) {
      var v = parseInt(fixedTiles[j].dataset.fixed, 10);
      fixedTiles[j].classList.toggle('selected', v === amount);
    }
  }

  // --- Validation ----------------------------------------------------------

  function validateDestinationFields() {
    if (destination === 'mtn' || destination === 'momo') {
      if (!readValue('wdPhone')) return 'Phone number is required.';
      if (readValue('wdPhone').length < 6) return 'Enter a valid phone number.';
      if (!readValue('wdName'))  return 'Account name is required.';
    } else if (destination === 'bank') {
      if (!readValue('wdHolder')) return 'Account holder is required.';
      if (!readValue('wdIban'))   return 'IBAN / Account number is required.';
      if (readValue('wdIban').replace(/\s+/g, '').length < 8) return 'Enter a valid IBAN / account number.';
      if (!readValue('wdBank'))   return 'Bank name is required.';
    } else {
      return 'Please choose a destination.';
    }
    return null;
  }

  function validate(ctx) {
    var bal = balance(ctx);

    if (!amount || amount < MIN_AMOUNT) return 'Minimum withdrawal is ' + money(MIN_AMOUNT) + '.';
    if (amount > bal)                   return 'Insufficient balance.';
    if (!destination)                   return 'Please choose a destination.';

    return validateDestinationFields();
  }

  // --- Actions -------------------------------------------------------------

  function setAmount(v, ctx) {
    amount = Math.max(0, Math.floor(Number(v) || 0));
    var input = getEl('wdAmount');
    if (input && String(amount) !== input.value) input.value = String(amount);
    updateTileSelection();
    updateWarnings(ctx);
    updateButton(ctx);
  }

  function onAmountInput(value, ctx) {
    amount = value === '' ? 0 : Math.max(0, Math.floor(Number(value) || 0));
    updateTileSelection();
    updateWarnings(ctx);
    updateButton(ctx);
  }

  function pickPercent(p, ctx) {
    var bal = balance(ctx);
    var amt = Math.floor(bal * p / 100);
    if (amt < MIN_AMOUNT) {
      toast('Too low', 'This percentage is below ' + money(MIN_AMOUNT) + '.', 'error');
      return;
    }
    setAmount(amt, ctx);
  }

  function pickFixed(v, ctx) {
    var bal = balance(ctx);
    if (v > bal) {
      toast('Insufficient balance', 'You only have ' + money(bal) + '.', 'error');
      return;
    }
    setAmount(v, ctx);
  }

  function withdrawAll(ctx) {
    var bal = balance(ctx);
    if (bal < MIN_AMOUNT) {
      toast('Too low to withdraw', 'Minimum is ' + money(MIN_AMOUNT) + '.', 'error');
      return;
    }
    setAmount(bal, ctx);
    var input = getEl('wdAmount');
    if (input) input.focus();
  }

  function selectDestination(key, ctx) {
    destination = key;
    var tiles = document.querySelectorAll('[data-dest]');
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].classList.toggle('selected', tiles[i].dataset.dest === key);
    }
    var area = getEl('wdFormArea');
    if (area) area.innerHTML = renderDestinationForm();

    // Auto-clean IBAN/account number
    var ibanEl = getEl('wdIban');
    if (ibanEl) {
      ibanEl.addEventListener('input', function () {
        this.value = this.value.replace(/[^A-Za-z0-9 \-]/g, '').toUpperCase().slice(0, 42);
      });
    }

    updateButton(ctx);
  }

  // --- Withdraw ------------------------------------------------------------

  function processWithdrawal(ctx) {
    if (processing) return;

    var err = validate(ctx);
    if (err) {
      toast('Check your details', err, 'error');
      return;
    }

    processing = true;
    updateButton(ctx);

    showProcessing('Processing Withdrawal', 'Sending funds…');

    setTimeout(function () {
      hideProcessing();
      completeWithdrawal(ctx);
    }, 1800);
  }

  function completeWithdrawal(ctx) {
    var user = currentUser(ctx);
    if (!user) { processing = false; return; }

    var withdrawn = amount;
    var destUsed = destination;
    var newBal = Math.max(0, (user.wallet || 0) - withdrawn);

    // 1. Update user wallet
    if (Store.updateUser) {
      Store.updateUser({ wallet: newBal });
    } else {
      var users = Store.get('users') || [];
      var ui = users.findIndex(function (u) { return u.id === user.id; });
      if (ui !== -1) { users[ui].wallet = newBal; Store.set('users', users); }
    }

    // 2. Wallet txn (negative amount)
    var txns = Store.get('walletTxns') || [];
    txns.push({
      id: uid('txn'),
      userId: user.id,
      type: 'Withdraw',
      amount: -withdrawn,
      balanceAfter: newBal,
      description: 'Withdrawal via ' + destUsed.toUpperCase(),
      method: destUsed,
      ref: 'WD-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      at: fmtDT()
    });
    Store.set('walletTxns', txns);

    // 3. Payment record
    var payments = Store.get('payments') || [];
    payments.push({
      id: uid('pay'),
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      amount: -withdrawn,
      currency: 'XAF',
      method: destUsed,
      status: 'Paid',
      kind: 'Withdraw',
      ref: 'TXN-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      at: fmtDT()
    });
    Store.set('payments', payments);

    // 4. Notification
    var notifs = Store.get('notifications') || [];
    notifs.push({
      id: uid('n'),
      userId: user.id,
      title: 'Withdrawal processed',
      message: money(withdrawn) + ' is on its way to your account.',
      type: 'success',
      at: fmtDT(),
      read: false
    });
    Store.set('notifications', notifs);

    // 5. Realtime
    if (Realtime.notifyLocalChange) {
      Realtime.notifyLocalChange('wallet:changed');
      Realtime.notifyLocalChange('payment:created');
      Realtime.notifyLocalChange('notification:new');
    }

    if (global.App && global.App.refreshSidebar) global.App.refreshSidebar();

    var completedAmount = withdrawn;
    amount = 0;
    destination = '';
    processing = false;

    showSuccessModal(completedAmount, newBal);
    toast('Withdrawal successful', money(completedAmount) + ' is on its way.', 'success');
  }

  function showSuccessModal(withdrawn, newBal) {
    var modal = openModal(''
      + '<div class="modal narrow">'
      +   '<div class="modal-body" style="text-align:center;padding:34px 24px 20px">'
      +     '<div class="receipt-icon" style="background:#eff6ff;color:var(--blue)">'
      +       '<i class="fas fa-arrow-up-from-bracket"></i>'
      +     '</div>'
      +     '<h3 style="font-size:19px;margin-bottom:6px">Withdrawal Processed</h3>'
      +     '<p style="color:var(--text-2);font-size:13.5px;margin-bottom:20px">'
      +       'Funds have been sent to your account.'
      +     '</p>'
      +     '<div class="deposit-receipt" style="border-color:var(--blue)">'
      +       '<div class="receipt-label">Amount Sent</div>'
      +       '<div class="receipt-balance" style="color:var(--blue)">' + esc(money(withdrawn)) + '</div>'
      +       '<div class="receipt-sub">New balance: ' + esc(money(newBal)) + '</div>'
      +     '</div>'
      +   '</div>'
      +   '<div class="modal-foot" style="justify-content:center">'
      +     '<button type="button" class="btn btn-outline" data-action="go-wallet">Back to Wallet</button>'
      +     '<button type="button" class="btn btn-primary" data-action="go-deposit">Deposit More</button>'
      +   '</div>'
      + '</div>');

    if (!modal) return;

    modal.addEventListener('click', function (e) {
      if (e.target === modal) { closeModal(modal); return; }
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      closeModal(modal);
      if (btn.dataset.action === 'go-wallet')  { if (global.App) global.App.go('wallet'); }
      if (btn.dataset.action === 'go-deposit') { if (global.App) global.App.go('deposit'); }
    });
  }

  // --- Render --------------------------------------------------------------

  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    var bal = user.wallet || 0;

    return ''
      + '<div class="amount-banner">'
      +   '<div class="lbl">Available Balance</div>'
      +   '<div class="amt"><small>Fr.</small>' + esc(bal.toLocaleString()) + '</div>'
      + '</div>'

      + '<div class="panel">'
      +   '<div class="panel-header"><h3><i class="fas fa-arrow-up-from-bracket"></i> How much do you want to withdraw?</h3></div>'
      +   '<div class="panel-body">'
      +     '<div class="field" style="margin-bottom:14px">'
      +       '<label>Amount <span class="req">*</span></label>'
      +       '<input type="number" id="wdAmount" placeholder="e.g. 5000" min="' + MIN_AMOUNT + '" max="' + bal + '" value="' + (amount || '') + '" />'
      +       (bal >= MIN_AMOUNT
              ? '<button type="button" class="max-amount" data-action="withdraw-all"><i class="fas fa-bolt"></i> Withdraw all (' + esc(money(bal)) + ')</button>'
              : '')
      +       '<div class="hint">Minimum: ' + money(MIN_AMOUNT) + ' · Maximum: ' + esc(money(bal)) + '</div>'
      +     '</div>'

      +     (bal >= MIN_AMOUNT
              ? '<div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3);margin-bottom:8px">Percent of balance</div>'
              +   '<div class="quick-amounts" id="pctTiles">' + renderPercentTiles(ctx) + '</div>'
              +   '<div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3);margin:14px 0 8px">Fixed amounts</div>'
              +   '<div class="quick-amounts" id="fixedTiles">' + renderFixedTiles(ctx) + '</div>'
              : '<div class="method-note"><strong>Low balance:</strong> You need at least ' + money(MIN_AMOUNT) + ' to withdraw.</div>')

      +     '<div id="wdWarnings" style="margin-top:14px">' + renderWarnings(ctx) + '</div>'
      +   '</div>'
      + '</div>'

      + '<div class="panel">'
      +   '<div class="panel-header"><h3><i class="fas fa-building-columns"></i> Withdraw To</h3></div>'
      +   '<div class="panel-body">'
      +     '<div class="pay-tiles" id="destTiles">' + renderDestinationTiles() + '</div>'
      +     '<div id="wdFormArea">' + renderDestinationForm() + '</div>'
      +   '</div>'
      + '</div>'

      + '<div class="panel">'
      +   '<div class="panel-body" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;align-items:center">'
      +     '<button type="button" class="btn btn-ghost" data-action="back"><i class="fas fa-arrow-left"></i> Back</button>'
      +     '<button type="button" class="btn btn-secondary btn-lg" id="wdBtn" data-action="submit" disabled><i class="fas fa-arrow-up-from-bracket"></i> Withdraw</button>'
      +   '</div>'
      + '</div>'

      + '<div class="trust-chips">'
      +   '<span class="trust-chip ssl"><i class="fas fa-lock"></i> SSL Secured</span>'
      +   '<span class="trust-chip pci"><i class="fas fa-shield-halved"></i> Verified Processing</span>'
      +   '<span class="trust-chip instant"><i class="fas fa-clock"></i> 1–3 Business Days</span>'
      + '</div>';
  }

  // --- Bind ----------------------------------------------------------------

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    ctxRef = ctx;
    processing = false;
    updateButton(ctx);

    handler = function (e) {
      // Withdraw all link
      if (e.target.closest && e.target.closest('[data-action="withdraw-all"]')) {
        withdrawAll(ctx);
        return;
      }

      // Percent tiles
      var pctTile = e.target.closest && e.target.closest('[data-percent]');
      if (pctTile) {
        pickPercent(parseInt(pctTile.dataset.percent, 10) || 0, ctx);
        return;
      }

      // Fixed tiles
      var fixedTile = e.target.closest && e.target.closest('[data-fixed]');
      if (fixedTile) {
        pickFixed(parseInt(fixedTile.dataset.fixed, 10) || 0, ctx);
        return;
      }

      // Destination tiles
      var destTile = e.target.closest && e.target.closest('[data-dest]');
      if (destTile) {
        selectDestination(destTile.dataset.dest, ctx);
        return;
      }

      // Action buttons
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'back') {
        if (global.App && global.App.go) global.App.go('wallet');
        return;
      }
      if (action === 'submit') {
        processWithdrawal(ctx);
        return;
      }
    };

    container.addEventListener('click', handler);

    // Amount input
    var amtInput = getEl('wdAmount');
    if (amtInput) {
      amtInput.addEventListener('input', function () {
        onAmountInput(amtInput.value, ctx);
      });
    }
  }

  // --- Cleanup -------------------------------------------------------------

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler = null;
    ctxRef = null;
    amount = 0;
    destination = '';
    processing = false;
  }

  // --- Register ------------------------------------------------------------

  var page = {
    title: 'Withdraw Money',
    subtitle: 'Transfer funds out of your wallet',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('withdraw', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.withdraw = page;
  }

})(window);