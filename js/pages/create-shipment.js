/* GlobalExpress - pages/create-shipment.js
   Three-step shipment wizard connected to Supabase.
*/

(function (global) {
  'use strict';

  var Pages = global.Pages || {};
  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

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
      <div class="step-item ${done ? 'done' : ''} ${active ? 'active' : ''}">
        <div class="step-num">${icon}</div>
        <span>${esc(label)}</span>
      </div>
    `;
  }

  function stepper() {
    return `
      <div class="stepper" style="display:flex;justify-content:space-between;margin-bottom:30px;position:relative;">
        ${stepItem(1, 'Shipment Details')}
        ${stepItem(2, 'Package Info')}
        ${stepItem(3, 'Review & Pay')}
      </div>
    `;
  }

  function field(id, label, type, placeholder, required) {
    return `
      <div class="field" style="margin-bottom:16px;">
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">${esc(label)} ${required ? '<span style="color:var(--red)">*</span>' : ''}</label>
        <input type="${esc(type || 'text')}" id="${esc(id)}" placeholder="${esc(placeholder || '')}" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;" />
      </div>
    `;
  }

  // --- Step 1 ---
  function renderStep1() {
    return `
      <div style="margin-bottom:24px;">
        <h4 style="margin-bottom:16px;font-size:15px;border-bottom:1px solid var(--border);padding-bottom:8px;"><i class="fas fa-store"></i> Sender (Origin)</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          ${field('c_senderName', 'Full Name', 'text', 'John Smith', true)}
          ${field('c_senderEmail', 'Email', 'email', 'sender@example.com', true)}
          ${field('c_senderPhone', 'Phone', 'tel', '+237...', false)}
          <div style="grid-column:1/-1;">${field('c_senderAddress', 'Full Address', 'text', '123 Main St, Douala', true)}</div>
        </div>
      </div>

      <div style="margin-bottom:24px;">
        <h4 style="margin-bottom:16px;font-size:15px;border-bottom:1px solid var(--border);padding-bottom:8px;"><i class="fas fa-user"></i> Recipient (Destination)</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          ${field('c_receiverName', 'Full Name', 'text', 'Jane Doe', true)}
          ${field('c_receiverEmail', 'Email', 'email', 'receiver@example.com', true)}
          ${field('c_receiverPhone', 'Phone', 'tel', '+237...', false)}
          <div style="grid-column:1/-1;">${field('c_receiverAddress', 'Full Address', 'text', '456 Ave, Yaoundé', true)}</div>
        </div>
      </div>

      <div style="margin-bottom:24px;">
        <h4 style="margin-bottom:16px;font-size:15px;border-bottom:1px solid var(--border);padding-bottom:8px;"><i class="fas fa-route"></i> Route & Coordinates</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          ${field('c_originCity', 'Origin City', 'text', 'Douala', true)}
          ${field('c_destCity', 'Destination City', 'text', 'Yaoundé', true)}
          
          <!-- THESE ARE THE MAP COORDINATES YOU ASKED FOR -->
          ${field('c_originLat', 'Origin Latitude (Optional)', 'number', '4.0511', false)}
          ${field('c_originLng', 'Origin Longitude (Optional)', 'number', '9.7679', false)}
          ${field('c_destLat', 'Destination Latitude (Optional)', 'number', '3.8480', false)}
          ${field('c_destLng', 'Destination Longitude (Optional)', 'number', '11.5021', false)}
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;margin-top:24px;">
        <button type="button" class="btn btn-primary btn-lg" data-action="next-step-1">Continue <i class="fas fa-arrow-right"></i></button>
      </div>
    `;
  }

  function nextFromStep1() {
    if (!value('c_senderName') || !value('c_senderEmail') || !value('c_senderAddress') ||
        !value('c_receiverName') || !value('c_receiverEmail') || !value('c_receiverAddress') ||
        !value('c_originCity') || !value('c_destCity')) {
      toast('Missing Info', 'Please fill in all required fields.', 'error');
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
    
    // Save Coordinates
    draft.originLat = num('c_originLat');
    draft.originLng = num('c_originLng');
    draft.destLat = num('c_destLat');
    draft.destLng = num('c_destLng');

    return true;
  }

  // --- Step 2 ---
  function renderStep2() {
    return `
      <div style="margin-bottom:24px;">
        <h4 style="margin-bottom:16px;font-size:15px;border-bottom:1px solid var(--border);padding-bottom:8px;"><i class="fas fa-box"></i> Package Details</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div class="field">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Package Type *</label>
            <select id="c_packageType" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;">
              <option value="">Select...</option>
              <option>Standard Box</option>
              <option>Envelope / Document</option>
              <option>Fragile Item</option>
              <option>Electronics</option>
            </select>
          </div>
          ${field('c_weight', 'Weight', 'text', 'e.g. 2.5 kg', false)}
          <div style="grid-column:1/-1;" class="field">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Contents Description</label>
            <textarea id="c_contents" rows="3" placeholder="What is inside?" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;"></textarea>
          </div>
          <div style="grid-column:1/-1;padding:10px 0;">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
              <input type="checkbox" id="c_insured" style="width:16px;height:16px;" />
              <span>Add shipping insurance (+${money(INSURANCE_FEE)})</span>
            </label>
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;margin-top:24px;">
        <button type="button" class="btn btn-outline" data-action="back-step-2"><i class="fas fa-arrow-left"></i> Back</button>
        <button type="button" class="btn btn-primary btn-lg" data-action="next-step-2">Review <i class="fas fa-arrow-right"></i></button>
      </div>
    `;
  }

  function nextFromStep2() {
    if (!value('c_packageType')) {
      toast('Select package type', '', 'error');
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
      <div style="margin-bottom:24px;">
        <h4 style="margin-bottom:16px;font-size:15px;border-bottom:1px solid var(--border);padding-bottom:8px;"><i class="fas fa-clipboard-check"></i> Review Your Shipment</h4>
        
        <div style="background:var(--surface-2);border-radius:12px;padding:20px;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;margin-bottom:12px;"><span style="color:var(--text-3);">From</span><strong>${esc(draft.senderName)} · ${esc(draft.originCity)}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:12px;"><span style="color:var(--text-3);">To</span><strong>${esc(draft.receiverName)} · ${esc(draft.destCity)}</strong></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:12px;"><span style="color:var(--text-3);">Package</span><strong>${esc(draft.packageType)}</strong></div>
          
          <div style="border-top:1px dashed var(--border);margin:16px 0;"></div>
          
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:var(--text-3);">Shipping Fee</span><span>${money(SHIPPING_FEE)}</span></div>
          ${ins > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:var(--text-3);">Insurance</span><span>${money(ins)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:18px;font-weight:800;"><span>Total</span><span style="color:var(--accent);">${money(total)}</span></div>
        </div>
      </div>

      <div style="margin-bottom:24px;">
        <h4 style="margin-bottom:16px;font-size:15px;"><i class="fas fa-wallet"></i> Payment</h4>
        <div style="padding:16px;border-radius:12px;border:1px solid ${canPay ? '#a7f3d0' : '#fecaca'};background:${canPay ? '#f0fdf4' : '#fef2f2'};display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;">Wallet Balance</div>
            <div style="font-size:22px;font-weight:800;color:${canPay ? 'var(--green)' : 'var(--red)'};">${money(bal)}</div>
          </div>
          ${canPay 
            ? '<div style="font-size:13px;font-weight:600;color:var(--green);"><i class="fas fa-check-circle"></i> Sufficient</div>' 
            : `<div style="font-size:13px;font-weight:600;color:var(--red);"><i class="fas fa-exclamation-triangle"></i> Need ${money(total - bal)} more</div>`}
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;margin-top:24px;">
        <button type="button" class="btn btn-outline" data-action="back-step-3"><i class="fas fa-arrow-left"></i> Back</button>
        ${canPay 
          ? `<button type="button" class="btn btn-primary btn-lg" data-action="pay"><i class="fas fa-lock"></i> Pay ${money(total)}</button>`
          : `<button type="button" class="btn btn-primary btn-lg" data-action="go-deposit"><i class="fas fa-plus"></i> Deposit Now</button>`}
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
      <div class="modal narrow" style="max-width:400px;text-align:center;">
        <div class="modal-body" style="padding:34px 24px 20px">
          <div style="width:64px;height:64px;background:#ecfdf5;color:var(--green);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 16px;"><i class="fas fa-check"></i></div>
          <h3 style="font-size:20px;margin-bottom:6px;font-weight:800;">Shipment Created!</h3>
          <p style="color:var(--text-2);font-size:13.5px;margin-bottom:22px;">Your package is ready for pickup.</p>
          <div style="background:var(--surface-2);padding:16px;border-radius:12px;border:1px dashed var(--border);margin-bottom:24px;">
            <div style="font-size:11px;text-transform:uppercase;font-weight:700;color:var(--text-3);letter-spacing:1px;margin-bottom:4px;">Tracking Code</div>
            <div style="font-size:24px;font-weight:800;font-family:monospace;color:var(--accent);">${esc(code)}</div>
          </div>
        </div>
        <div class="modal-foot" style="display:flex;flex-direction:column;gap:10px;">
          <button type="button" class="btn btn-primary btn-block" onclick="navigator.clipboard.writeText('${esc(code)}'); alert('Code Copied!')"><i class="fas fa-copy"></i> Copy Code</button>
          <button type="button" class="btn btn-outline btn-block" data-action="view-shipments">View My Shipments</button>
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
      <div class="panel">
        <div class="panel-body">
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