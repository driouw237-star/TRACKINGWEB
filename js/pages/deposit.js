/* ================================================================
   GlobalExpress — Customer App: Deposit (Responsive Supabase)
   File: js/pages/deposit.js
   ================================================================ */

(function (global) {
  'use strict';

  var Pages = global.Pages || {};
  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  // Inject bounce animation globally
  (function() {
    if (document.getElementById('ge-bounce-style')) return;
    var s = document.createElement('style');
    s.id = 'ge-bounce-style';
    s.innerHTML = `
      @keyframes geBounce {
        0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
        40% { transform: translateY(-8px); }
        60% { transform: translateY(-4px); }
      }
      .bouncy-btn {
        animation: geBounce 2s infinite;
        box-shadow: 0 0 20px rgba(250, 204, 21, 0.6);
        transition: all 0.2s ease;
      }
      .bouncy-btn:hover {
        animation: none;
        transform: scale(1.05);
        box-shadow: 0 0 30px rgba(250, 204, 21, 1);
      }
    `;
    document.head.appendChild(s);
  })();

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

    return `
      <div class="page-header" style="margin-bottom:24px;">
        <h2>Deposit Funds</h2>
        <p class="page-subtitle">Top up your wallet to send packages.</p>
      </div>

      <!-- ADVISORY NOTICE: MANUAL DEPOSITS DISABLED -->
      <div style="background:#fef2f2; border:1.5px solid #fecaca; border-radius:12px; padding:20px; margin-bottom:24px; display:flex; flex-direction:column; gap:16px; box-shadow:0 4px 12px rgba(220,38,38,0.08);">
        <div style="display:flex; align-items:flex-start; gap:14px;">
          <div style="width:40px; height:40px; border-radius:10px; background:#fff; color:#dc2626; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0;">
            <i class="fas fa-triangle-exclamation"></i>
          </div>
          <div>
            <h3 style="font-size:16px; font-weight:800; color:#991b1b; margin:0 0 4px;">Manual Deposits Not Yet Available</h3>
            <p style="font-size:13.5px; color:#b91c1c; line-height:1.6; margin:0;">
              Automated top-ups are currently disabled. Please <strong>contact the admin directly on WhatsApp</strong> to manually top up your wallet.
            </p>
          </div>
        </div>
        
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <!-- BOUNCY GET 1200 BUTTON -->
          <a href="https://wa.me/23760199083?text=Hi,%20I%20want%20to%20claim%20my%203%20Free%20Shipping%20Codes%20(1200%20value)" 
             target="_blank" 
             class="bouncy-btn"
             style="background:#facc15; color:#000; border:2px solid #fff; border-radius:8px; padding:10px 18px; font-weight:900; font-size:12px; display:inline-flex; align-items:center; gap:8px; text-decoration:none; text-transform:uppercase; letter-spacing:0.5px;">
            <i class="fas fa-gift" style="font-size:16px;"></i> Get 1200 (3 Free Codes)
          </a>
          
          <a href="https://wa.me/23760199083?text=Hi,%20I%20want%20to%20manually%20top%20up%20my%20wallet" 
             target="_blank" 
             style="background:#25D366; color:#fff; border:none; border-radius:8px; padding:10px 18px; font-weight:800; font-size:12px; display:inline-flex; align-items:center; gap:8px; text-decoration:none; text-transform:uppercase; letter-spacing:0.5px; box-shadow:0 4px 12px rgba(37,211,102,0.3);">
            <i class="fab fa-whatsapp" style="font-size:16px;"></i> Contact Admin to Top Up
          </a>
        </div>
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
                  <!-- MTN PLACEHOLDER -->
                  <button type="button" class="btn btn-outline provider-btn" data-provider="mtn" style="flex:1;min-width:120px;padding:12px;border:2px solid ${state.selectedProvider === 'mtn' ? 'var(--accent)' : 'var(--border)'};background:${state.selectedProvider === 'mtn' ? '#fff7ed' : 'transparent'};">
                    <i class="fas fa-mobile-screen" style="color:#FFCC00;"></i> MTN MoMo
                  </button>
                  <!-- ORANGE PLACEHOLDER -->
                  <button type="button" class="btn btn-outline provider-btn" data-provider="orange" style="flex:1;min-width:120px;padding:12px;border:2px solid ${state.selectedProvider === 'orange' ? 'var(--accent)' : 'var(--border)'};background:${state.selectedProvider === 'orange' ? '#fff7ed' : 'transparent'};">
                    <i class="fas fa-mobile-screen" style="color:#FF6600;"></i> Orange Money
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
            <div style="background:#fff; padding:16px; border-radius:8px; border:1px solid var(--border); margin-bottom:20px;">
              <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;">Current Balance</div>
              <div style="font-size:24px;font-weight:800;color:var(--green);">${money(user.wallet || 0)}</div>
            </div>

            <h4 style="font-size:14px; font-weight:700; margin-bottom:12px; color:var(--text);">To Top Up:</h4>
            <ol style="padding-left:20px;font-size:13.5px;color:var(--text-2);line-height:1.8;">
              <li>Click the <strong>"Contact Admin to Top Up"</strong> button above.</li>
              <li>Send the admin a message on WhatsApp.</li>
              <li>Tell them the amount you want to add and send the payment via MTN or Orange Money.</li>
              <li>The admin will manually update your wallet instantly.</li>
            </ol>
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
    
    // Instead of processing, block it and remind them to contact admin
    toast('Deposits Disabled', 'Please contact the admin on WhatsApp to top up your wallet.', 'error');
    
    // Optional: Redirect them straight to WhatsApp
    // window.open('https://wa.me/23760199083?text=Hi,%20I%20want%20to%20manually%20top%20up%20my%20wallet', '_blank');
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

    // Handle Provider Switching (Visual only for now)
    var providerBtns = document.querySelectorAll('.provider-btn');
    providerBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.selectedProvider = btn.dataset.provider;
        
        // Update UI
        providerBtns.forEach(function(b) {
          b.style.border = '2px solid var(--border)';
          b.style.background = 'transparent';
        });
        btn.style.border = '2px solid var(--accent)';
        btn.style.background = '#fff7ed';
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