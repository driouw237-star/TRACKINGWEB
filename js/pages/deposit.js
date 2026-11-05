/* ================================================================
   GlobalExpress — Customer App: Deposit (Responsive Supabase)
   File: js/pages/deposit.js
   ================================================================ */

(function (global) {
  'use strict';

  var Pages = global.Pages || {};
  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var toast = UI.toast || function (t, m, k) { if (global.console) console.log(t, m); };

  var state = {
    isSubmitting: false,
    selectedProvider: 'mtn'
  };

  var container = null;
  var handler = null;

  // ================================================================
  // RENDER
  // ================================================================
  function render(ctx) {
    var user = ctx.user || {};

    // Notice the CSS Grid: minmax(320px, 1fr) means it will stack on mobile
    return `
      <div class="page-header" style="margin-bottom:24px;">
        <h2>Deposit Funds</h2>
        <p class="page-subtitle">Top up your wallet to send packages.</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:24px;align-items:start;">
        
        <!-- FORM -->
        <div class="panel">
          <div class="panel-header"><h3><i class="fas fa-wallet"></i> Add Money</h3></div>
          <div class="panel-body">
            <form id="deposit-form">
              
              <div class="field" style="margin-bottom:20px;">
                <label>Select Provider</label>
                <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;">
                  <button type="button" class="btn btn-outline provider-btn" data-provider="mtn" style="flex:1;min-width:120px;padding:12px;border:2px solid ${state.selectedProvider === 'mtn' ? 'var(--accent)' : 'var(--border)'};">
                    <i class="fas fa-mobile-screen"></i> MTN MoMo
                  </button>
                  <button type="button" class="btn btn-outline provider-btn" data-provider="orange" style="flex:1;min-width:120px;padding:12px;border:2px solid ${state.selectedProvider === 'orange' ? 'var(--accent)' : 'var(--border)'};">
                    <i class="fas fa-mobile-screen"></i> Orange Money
                  </button>
                </div>
              </div>

              <div class="field" style="margin-bottom:20px;">
                <label>Amount (XAF)</label>
                <div style="position:relative;">
                  <span style="position:absolute;left:16px;top:14px;font-weight:700;color:var(--text-3);">Fr.</span>
                  <input type="number" id="deposit_amount" placeholder="e.g. 5000" min="500" required style="width:100%;padding:14px 14px 14px 45px;border:1px solid var(--border);border-radius:8px;font-size:18px;font-weight:700;color:var(--text);">
                </div>
                <div style="font-size:12px;color:var(--text-3);margin-top:6px;">Minimum deposit: 500 XAF</div>
              </div>

              <div class="field" style="margin-bottom:20px;">
                <label>Phone Number</label>
                <input type="text" id="deposit_phone" placeholder="e.g. +237 670 000 000" required style="width:100%;padding:14px;border:1px solid var(--border);border-radius:8px;">
              </div>

              <button type="submit" id="btn-deposit" class="btn btn-primary btn-block" style="width:100%;padding:14px;font-size:16px;margin-top:10px;">
                ${state.isSubmitting ? '<i class="fas fa-circle-notch fa-spin"></i> Processing...' : '<i class="fas fa-arrow-down"></i> Confirm Deposit'}
              </button>
            </form>
          </div>
        </div>

        <!-- INFO -->
        <div class="panel" style="background:var(--surface-2);">
          <div class="panel-header"><h3><i class="fas fa-circle-info"></i> How it works</h3></div>
          <div class="panel-body">
            <ol style="padding-left:20px;font-size:13.5px;color:var(--text-2);line-height:1.8;">
              <li>Enter the amount you want to add.</li>
              <li>Click "Confirm Deposit".</li>
              <li>You will receive a prompt on your phone to approve the payment.</li>
              <li>Once approved, the money is instantly added to your GlobalExpress wallet.</li>
            </ol>
            
            <div style="margin-top:20px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;">
              <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;">Current Balance</div>
              <div style="font-size:20px;font-weight:800;color:var(--green);">${money(user.wallet || 0)}</div>
            </div>
          </div>
        </div>

      </div>
    `;
  }

  // ================================================================
  // ACTIONS
  // ================================================================
  async function handleDeposit(e) {
    e.preventDefault();
    if (state.isSubmitting || !window.supabaseClient) return;

    var user = global.App.state.user;
    var amount = Number(document.getElementById('deposit_amount').value);
    var phone = document.getElementById('deposit_phone').value.trim();

    if (!amount || amount < 500) {
      return toast('Invalid Amount', 'Minimum deposit is 500 XAF.', 'error');
    }

    state.isSubmitting = true;
    var btn = document.getElementById('btn-deposit');
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processing...';
    btn.disabled = true;

    try {
      // 1. Create a pending deposit record in the database
      const { data: deposit, error } = await window.supabaseClient
        .schema('app')
        .from('deposits')
        .insert({
          user_id: user.id,
          provider: state.selectedProvider,
          amount: amount,
          net_amount: amount,
          payer_phone: phone,
          status: 'pending',
          reference: 'DEP-' + Math.random().toString(36).substring(2, 10).toUpperCase()
        })
        .select()
        .single();

      if (error) throw error;

      // 2. Simulate API call and confirm
      toast('Simulating Payment...', 'Please wait.', 'info');
      
      setTimeout(async function() {
        const { error: rpcErr } = await window.supabaseClient.schema('app').rpc('confirm_deposit', {
          p_deposit_id: deposit.id,
          p_provider_reference: 'SIMULATED_' + Date.now()
        });

        if (rpcErr) {
          toast('Error', 'Failed to confirm payment.', 'error');
          state.isSubmitting = false;
          btn.innerHTML = '<i class="fas fa-arrow-down"></i> Confirm Deposit';
          btn.disabled = false;
          return;
        }

        toast('Success!', money(amount) + ' added to your wallet.', 'success');
        
        // Refresh user data
        var updatedUser = await global.Auth.resolve();
        global.App.state.user = updatedUser;
        
        setTimeout(function() {
          global.App.go('wallet');
        }, 1000);

      }, 2000);

    } catch (err) {
      console.error('Deposit failed:', err);
      toast('Error', err.message || 'Failed to create deposit.', 'error');
      state.isSubmitting = false;
      btn.innerHTML = '<i class="fas fa-arrow-down"></i> Confirm Deposit';
      btn.disabled = false;
    }
  }

  // ================================================================
  // LIFECYCLE
  // ================================================================
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    var form = document.getElementById('deposit-form');
    if (form) {
      form.removeEventListener('submit', handleDeposit);
      form.addEventListener('submit', handleDeposit);
    }

    // Handle Provider Switching
    var providerBtns = document.querySelectorAll('.provider-btn');
    providerBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.selectedProvider = btn.dataset.provider;
        
        // Update UI
        providerBtns.forEach(function(b) {
          b.style.border = '2px solid var(--border)';
        });
        btn.style.border = '2px solid var(--accent)';
      });
    });
  }

  function cleanup() {
    var form = document.getElementById('deposit-form');
    if (form) form.removeEventListener('submit', handleDeposit);
    container = null;
  }

  Pages['deposit'] = {
    title: 'Deposit',
    subtitle: 'Add money to your wallet',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  global.Pages = Pages;

})(window);