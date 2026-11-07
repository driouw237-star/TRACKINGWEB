/* GlobalExpress - pages/create-shipment.js
   Three-step shipment wizard connected to Supabase. (Improved UI)
*/

(function (global) {
  'use strict';

  var Pages = global.Pages || {};
  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  // Inject bounce animation globally (same as dashboard)
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
      /* Clean form styles */
      .clean-form .form-section {
        background: #fff;
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 20px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.02);
      }
      .clean-form .section-title {
        font-size: 15px;
        font-weight: 800;
        color: var(--brand);
        margin-bottom: 16px;
        display: flex;
        align-items: center;
        gap: 8px;
        border-bottom: 1px solid var(--border-2);
        padding-bottom: 10px;
      }
      .clean-form .section-title i {
        color: var(--accent);
      }
      .clean-form .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin-bottom: 16px;
      }
      .clean-form .form-row.full {
        grid-template-columns: 1fr;
      }
      .clean-form .field label {
        display: block;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--text-2);
        margin-bottom: 6px;
      }
      .clean-form .field input,
      .clean-form .field select,
      .clean-form .field textarea {
        width: 100%;
        padding: 11px 14px;
        border: 1px solid var(--border);
        border-radius: 8px;
        font-size: 14px;
        color: var(--text);
        background: var(--surface-2);
        transition: all 0.2s ease;
      }
      .clean-form .field input:focus,
      .clean-form .field select:focus,
      .clean-form .field textarea:focus {
        border-color: var(--accent);
        background: #fff;
        outline: none;
        box-shadow: 0 0 0 3px rgba(255,107,53,.12);
      }
      .clean-form .field textarea {
        resize: vertical;
        min-height: 80px;
      }
      @media (max-width: 600px) {
        .clean-form .form-row {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(s);
  })();

  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };

  var SHIPPING_FEE = 4000;
  var INSURANCE_FEE = 500;

  var step = 1;
  var draft = {};
  var container = null;
  var handler = null;
  var mounted = false;

  function currentUser(ctx) {
    return (ctx && ctx.user) || (global.App && global.App.state && global.App.state.user) || null;
  }

  function value(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function num(id) {
    var v = value(id);
    return v === '' ? 0 : parseFloat(v) || 0;
  }

  function rerender(ctx) {
    if (!container) return;
    container.innerHTML = render(ctx);
    var body = document.getElementById('createBody');
    if (body) body.innerHTML = renderBody(ctx);
  }

  // --- Stepper UI ---
  function stepItem(n, label) {
    var done = n < step;
    var active = n === step;
    var icon = done ? '<i class="fas fa-check"></i>' : String(n);
    return `
      <div style="display:flex;align-items:center;gap:8px;opacity:${active ? '1' : done ? '0.8' : '0.4'};">
        <div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;
          background:${active ? 'var(--accent)' : done ? 'var(--green)' : 'var(--border)'};color:${active || done ? '#fff' : 'var(--text-3)'};">
          ${icon}
        </div>
        <span style="font-size:13px;font-weight:700;color:${active ? 'var(--text)' : 'var(--text-3)'};">${esc(label)}</span>
      </div>
    `;
  }

  function stepper() {
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding:16px;background:#fff;border-radius:12px;border:1px solid var(--border);box-shadow:0 2px 8px rgba(0,0,0,0.02);">
        ${stepItem(1, 'Details')}
        ${stepItem(2, 'Package')}
        ${stepItem(3, 'Review & Pay')}
      </div>
    `;
  }

  // --- Step 1 ---
  function renderStep1() {
    return `
      <div class="clean-form">
        <!-- PROMO BANNER -->
        <div style="background:#020617;border-radius:12px;padding:16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div style="color:#fff;">
            <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;color:#38bdf8;text-transform:uppercase;margin-bottom:4px;">Limited Offer</div>
            <div style="font-size:15px;font-weight:700;">Get 3 Free Shipping Codes (1200 Value)</div>
          </div>
          <a href="https://wa.me/237670199083?text=Hi%20I%20want%20to%20claim%20my%203%20Free%20Shipping%20Codes%201200%20value" 
             target="_blank" 
             class="bouncy-btn"
             style="background:#facc15; color:#000; border:2px solid #fff; border-radius:10px; padding:10px 18px; font-weight:900; font-size:13px; display:inline-flex; align-items:center; gap:8px; text-decoration:none; text-transform:uppercase;">
            <i class="fas fa-gift" style="font-size:16px;"></i> Claim Now
          </a>
        </div>

        <div class="form-section">
          <div class="section-title"><i class="fas fa-store"></i> Sender (Origin)</div>
          <div class="form-row">
            <div class="field"><label>Full Name *</label><input type="text" id="c_senderName" placeholder="John Smith" /></div>
            <div class="field"><label>Email *</label><input type="email" id="c_senderEmail" placeholder="sender@example.com" /></div>
          </div>
          <div class="form-row full">
            <div class="field"><label>Phone</label><input type="tel" id="c_senderPhone" placeholder="+237..." /></div>
          </div>
          <div class="form-row full">
            <div class="field"><label>Full Address *</label><input type="text" id="c_senderAddress" placeholder="123 Main St, Douala" /></div>
          </div>
        </div>

        <div class="form-section">
          <div class="section-title"><i class="fas fa-user"></i> Recipient (Destination)</div>
          <div class="form-row">
            <div class="field"><label>Full Name *</label><input type="text" id="c_receiverName" placeholder="Jane Doe" /></div>
            <div class="field"><label>Email *</label><input type="email" id="c_receiverEmail" placeholder="receiver@example.com" /></div>
          </div>
          <div class="form-row full">
            <div class="field"><label>Phone</label><input type="tel" id="c_receiverPhone" placeholder="+237..." /></div>
          </div>
          <div class="form-row full">
            <div class="field"><label>Full Address *</label><input type="text" id="c_receiverAddress" placeholder="456 Ave, Yaoundé" /></div>
          </div>
        </div>

        <div class="form-section">
          <div class="section-title"><i class="fas fa-route"></i> Route & Coordinates</div>
          <div class="form-row">
            <div class="field"><label>Origin City *</label><input type="text" id="c_originCity" placeholder="Douala" /></div>
            <div class="field"><label>Destination City *</label><input type="text" id="c_destCity" placeholder="Yaoundé" /></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Origin Latitude (Optional)</label><input type="number" step="any" id="c_originLat" placeholder="4.0511" /></div>
            <div class="field"><label>Origin Longitude (Optional)</label><input type="number" step="any" id="c_originLng" placeholder="9.7679" /></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Dest. Latitude (Optional)</label><input type="number" step="any" id="c_destLat" placeholder="3.8480" /></div>
            <div class="field"><label>Dest. Longitude (Optional)</label><input type="number" step="any" id="c_destLng" placeholder="11.5021" /></div>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:24px;">
          <button type="button" class="btn btn-primary btn-lg" data-action="next-step-1" style="padding:14px 32px;font-size:15px;">Continue <i class="fas fa-arrow-right"></i></button>
        </div>
      </div>
    `;
  }

  function nextFromStep1() {
    if (!value('c_senderName') || !value('c_senderEmail') || !value('c_senderAddress') ||
        !value('c_receiverName') || !value('c_receiverEmail') || !value('c_receiverAddress') ||
        !value('c_originCity') || !value('c_destCity')) {
      toast('Missing Info', 'Please fill in all required (*) fields.', 'error');
      return false;
    }

    draft.senderName = value('c_senderName');
    draft.senderEmail = value('c_senderEmail');
    draft.senderPhone = value('c_senderPhone');
    draft.senderAddress = value('c_senderAddress');

    draft.receiverName = value('c_receiverName');
    draft.receiverEmail = value('c_receiverEmail');
    draft.receiverPhone = value('c_receiverPhone');
    draft.receiverAddress = value('c_receiverAddress');

    draft.originCity = value('c_originCity');
    draft.destCity = value('c_destCity');
    
    draft.originLat = num('c_originLat');
    draft.originLng = num('c_originLng');
    draft.destLat = num('c_destLat');
    draft.destLng = num('c_destLng');

    return true;
  }

  // --- Step 2 ---
  function renderStep2() {
    return `
      <div class="clean-form">
        <div class="form-section">
          <div class="section-title"><i class="fas fa-box"></i> Package Details</div>
          <div class="form-row">
            <div class="field">
              <label>Package Type *</label>
              <select id="c_packageType">
                <option value="">Select type...</option>
                <option>Standard Box</option>
                <option>Envelope / Document</option>
                <option>Fragile Item</option>
                <option>Electronics</option>
                <option>Pallet / Freight</option>
              </select>
            </div>
            <div class="field">
              <label>Weight</label>
              <input type="text" id="c_weight" placeholder="e.g. 2.5 kg" />
            </div>
          </div>
          <div class="form-row full">
            <div class="field">
              <label>Contents Description</label>
              <textarea id="c_contents" rows="3" placeholder="Briefly describe what is inside the package..."></textarea>
            </div>
          </div>
        </div>

        <div class="form-section" style="background:#f0fdf4;border-color:#bbf7d0;">
          <label style="display:flex;align-items:flex-start;gap:12px;cursor:pointer;margin:0;">
            <input type="checkbox" id="c_insured" style="width:20px;height:20px;margin-top:2px;accent-color:var(--green);" />
            <div>
              <div style="font-weight:700;font-size:14px;color:#166534;">Add Shipping Insurance</div>
              <div style="font-size:13px;color:#15803d;margin-top:2px;">Protect your package against loss or damage for just <strong>${money(INSURANCE_FEE)}</strong>.</div>
            </div>
          </label>
        </div>

        <div style="display:flex;justify-content:space-between;margin-top:24px;">
          <button type="button" class="btn btn-outline" data-action="back-step-2" style="padding:14px 24px;"><i class="fas fa-arrow-left"></i> Back</button>
          <button type="button" class="btn btn-primary" data-action="next-step-2" style="padding:14px 32px;">Review Order <i class="fas fa-arrow-right"></i></button>
        </div>
      </div>
    `;
  }

  function nextFromStep2() {
    if (!value('c_packageType')) {
      toast('Select package type', 'Please choose what you are sending.', 'error');
      return false;
    }
    draft.packageType = value('c_packageType');
    draft.weight = value('c_weight') || 'N/A';
    draft.contents = value('c_contents') || 'N/A';
    draft.insured = document.getElementById('c_insured').checked;
    return true;
  }

  // --- Step 3 ---
  function renderStep3(ctx) {
    var user = currentUser(ctx);
    var bal = (user && user.wallet) || 0;
    var ins = draft.insured ? INSURANCE_FEE : 0;
    var total = SHIPPING_FEE + ins;
    var canPay = bal >= total;

    return `
      <div class="clean-form">
        <div class="form-section">
          <div class="section-title"><i class="fas fa-clipboard-check"></i> Review Your Shipment</div>
          
          <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border-2);">
            <span style="color:var(--text-3);font-size:13px;">From (Sender)</span>
            <div style="text-align:right;">
              <strong style="display:block;color:var(--text);">${esc(draft.senderName)}</strong>
              <span style="font-size:12px;color:var(--text-2);">${esc(draft.originCity)}</span>
            </div>
          </div>
          
          <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border-2);">
            <span style="color:var(--text-3);font-size:13px;">To (Recipient)</span>
            <div style="text-align:right;">
              <strong style="display:block;color:var(--text);">${esc(draft.receiverName)}</strong>
              <span style="font-size:12px;color:var(--text-2);">${esc(draft.destCity)}</span>
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border-2);">
            <span style="color:var(--text-3);font-size:13px;">Package</span>
            <strong style="color:var(--text);">${esc(draft.packageType)}</strong>
          </div>
          
          <div style="display:flex;justify-content:space-between;padding:12px 0;">
            <span style="color:var(--text-3);font-size:13px;">Shipping Fee</span>
            <span style="color:var(--text);font-weight:600;">${money(SHIPPING_FEE)}</span>
          </div>
          
          ${ins > 0 ? `
          <div style="display:flex;justify-content:space-between;padding:0 0 12px 0;">
            <span style="color:var(--text-3);font-size:13px;">Insurance</span>
            <span style="color:var(--text);font-weight:600;">${money(ins)}</span>
          </div>` : ''}
          
          <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:16px;border-top:2px solid var(--border);font-size:18px;font-weight:800;">
            <span>Total</span>
            <span style="color:var(--accent);">${money(total)}</span>
          </div>
        </div>

        <div class="form-section" style="border-color:${canPay ? '#bbf7d0' : '#fecaca'};background:${canPay ? '#f0fdf4' : '#fef2f2'};">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
            <div>
              <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.5px;">Your Wallet Balance</div>
              <div style="font-size:24px;font-weight:800;color:${canPay ? 'var(--green)' : 'var(--red)'};">${money(bal)}</div>
            </div>
            ${canPay 
              ? '<div style="font-size:13px;font-weight:700;color:var(--green);"><i class="fas fa-check-circle"></i> Sufficient Funds</div>' 
              : `<div style="font-size:13px;font-weight:700;color:var(--red);"><i class="fas fa-exclamation-triangle"></i> Need ${money(total - bal)} more</div>`}
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;margin-top:24px;gap:12px;flex-wrap:wrap;">
          <button type="button" class="btn btn-outline" data-action="back-step-3" style="flex:1;padding:14px 24px;"><i class="fas fa-arrow-left"></i> Back</button>
          ${canPay 
            ? `<button type="button" class="btn btn-primary" data-action="pay" style="flex:2;padding:14px 24px;font-size:16px;"><i class="fas fa-lock"></i> Pay ${money(total)}</button>`
            : `<button type="button" class="btn btn-primary" data-action="go-deposit" style="flex:2;padding:14px 24px;font-size:16px;"><i class="fas fa-plus"></i> Deposit Now</button>`}
        </div>
      </div>
    `;
  }

  async function payNow(ctx) {
    var user = currentUser(ctx);
    if (!user || !window.supabaseClient) return;

    var ins = draft.insured ? INSURANCE_FEE : 0;
    var total = SHIPPING_FEE + ins;
    
    if (user.wallet < total) {
      return toast('Insufficient Funds', 'Please deposit more money.', 'error');
    }

    var btn = document.querySelector('[data-action="pay"]');
    if (btn) {
      btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processing...';
      btn.disabled = true;
    }

    try {
      const { data: shipmentId, error } = await window.supabaseClient
        .schema('app')
        .rpc('create_shipment', {
          p_user_id: user.id,
          p_origin_city: draft.originCity,
          p_dest_city: draft.destCity,
          p_package_type: draft.packageType,
          p_weight: draft.weight,
          p_contents: draft.contents,
          p_service_level: 'Standard',
          p_sender_name: draft.senderName,
          p_sender_address: draft.senderAddress,
          p_receiver_name: draft.receiverName,
          p_receiver_address: draft.receiverAddress,
          p_amount_paid: total,
          p_coords: {
            origin: { lat: draft.originLat, lng: draft.originLng },
            dest: { lat: draft.destLat, lng: draft.destLng },
            current: { lat: draft.originLat, lng: draft.originLng }
          }
        });

      if (error) throw error;

      const { data: shipment } = await window.supabaseClient
        .schema('app')
        .from('shipments')
        .select('tracking_code')
        .eq('id', shipmentId)
        .single();

      user.wallet = user.wallet - total;
      showSuccessModal(shipment.tracking_code);

    } catch (err) {
      console.error('Create failed:', err);
      toast('Error', err.message || 'Failed to create shipment.', 'error');
      if (btn) { btn.innerHTML = `<i class="fas fa-lock"></i> Pay ${money(total)}`; btn.disabled = false; }
    }
  }

  function showSuccessModal(code) {
    if (!UI.openModal) {
      alert('Shipment created! Tracking code: ' + code);
      if (global.App) global.App.go('shipments');
      return;
    }

    var modal = UI.openModal(`
      <div class="modal narrow" style="max-width:420px;text-align:center;border-radius:16px;overflow:hidden;">
        <div class="modal-body" style="padding:40px 24px 24px">
          <div style="width:72px;height:72px;background:#ecfdf5;color:var(--green);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 20px;"><i class="fas fa-check"></i></div>
          <h3 style="font-size:24px;margin-bottom:8px;font-weight:800;color:var(--text);">Shipment Created!</h3>
          <p style="color:var(--text-2);font-size:14px;margin-bottom:24px;">Your package is ready for pickup and tracking.</p>
          
          <div style="background:var(--surface-2);padding:20px;border-radius:12px;border:2px dashed var(--accent);margin-bottom:24px;">
            <div style="font-size:11px;text-transform:uppercase;font-weight:800;color:var(--text-3);letter-spacing:1px;margin-bottom:6px;">Tracking Code</div>
            <div style="font-size:26px;font-weight:800;font-family:monospace;color:var(--brand);letter-spacing:1px;">${esc(code)}</div>
          </div>
        </div>
        <div class="modal-foot" style="display:flex;flex-direction:column;gap:12px;padding:0 24px 24px;">
          <button type="button" class="btn btn-primary btn-block" onclick="navigator.clipboard.writeText('${esc(code)}'); alert('Code Copied!')" style="padding:14px;font-size:15px;border-radius:10px;"><i class="fas fa-copy"></i> Copy Code</button>
          <button type="button" class="btn btn-outline btn-block" data-action="view-shipments" style="padding:14px;font-size:15px;border-radius:10px;">View My Shipments</button>
        </div>
      </div>
    `);

    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target.closest('[data-action="view-shipments"]')) {
          UI.closeModal(modal);
          global.App.go('shipments');
        }
      });
    }
  }

  // --- Main Render ---
  function renderBody(ctx) {
    if (step === 1) return renderStep1(ctx);
    if (step === 2) return renderStep2();
    return renderStep3(ctx);
  }

  function render(ctx) {
    return `
      <div class="panel" style="background:var(--bg);border:none;box-shadow:none;">
        <div class="panel-body" style="padding:0;">
          ${stepper()}
          <div id="createBody"></div>
        </div>
      </div>
    `;
  }

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;
    mounted = true;

    var body = document.getElementById('createBody');
    if (body) body.innerHTML = renderBody(ctx);

    handler = function (e) {
      var btn = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'next-step-1') {
        if (nextFromStep1()) { step = 2; rerender(ctx); }
        return;
      }
      if (action === 'back-step-2') { step = 1; rerender(ctx); return; }
      if (action === 'next-step-2') {
        if (nextFromStep2()) { step = 3; rerender(ctx); }
        return;
      }
      if (action === 'back-step-3') { step = 2; rerender(ctx); return; }
      if (action === 'pay') { payNow(ctx); return; }
      if (action === 'go-deposit') { global.App.go('deposit'); return; }
    };

    container.addEventListener('click', handler);
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null; handler = null; mounted = false; step = 1; draft = {};
  }

  Pages['create'] = {
    title: 'Create Shipment',
    subtitle: 'Enter details, then pay to generate a tracking code',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  global.Pages = Pages;

})(window);