/* ============================================================================
   GlobalExpress — Public Tracking Page Bootstrap
   File: js/track.js
   ============================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var toast = Utils.toast || function (t, m, k) { console.log(t, m); };

  var DEMO_SHIPMENTS = {
    'GE-3301-7745': {
      tracking_code: 'GE-3301-7745',
      sender_name: 'Placeholder Supplier AB', sender_address: 'Dallas, TX, USA',
      receiver_name: 'Birmand Barzenji', receiver_address: 'Eskilstuna, Sweden',
      origin_city: 'Dallas, TX, USA', dest_city: 'Eskilstuna, Sweden',
      current_location: 'Kiruna, Sweden', status: 'In Transit',
      estimated_delivery: 'September 24, 2026', package_type: 'Standard Box',
      weight: '4.6 lbs', dimensions: 'Medium', service_level: 'Standard', contents: 'Merchandise',
      coords: { origin: { lat: 32.77, lng: -96.79 }, current: { lat: 67.85, lng: 20.22 }, dest: { lat: 59.36, lng: 16.50 } },
      activities: [{ date: 'Sep 16, 2026', location: 'Dallas', description: 'Picked up.' }]
    },
    'GE-9102-4480': {
      tracking_code: 'GE-9102-4480',
      sender_name: 'Placeholder Store', sender_address: 'Los Angeles, CA, USA',
      receiver_name: 'Logan Henderson', receiver_address: 'Tennessee, USA',
      origin_city: 'Los Angeles, CA', dest_city: 'Tennessee, USA',
      current_location: 'Memphis, TN', status: 'On Hold',
      estimated_delivery: 'November 2, 2026', package_type: 'Standard Box',
      weight: '1.2 lbs', dimensions: 'Small', service_level: 'Economy', contents: 'Merchandise',
      coords: { origin: { lat: 34.05, lng: -118.24 }, current: { lat: 35.14, lng: -90.04 }, dest: { lat: 35.50, lng: -87.30 } },
      activities: [{ date: 'Sep 26, 2026', location: 'LA', description: 'Received.' }]
    }
  };

  async function findShipment(rawCode) {
    var code = String(rawCode || '').trim().toUpperCase();
    if (!code) return null;

    if (global.supabaseClient) {
      try {
        // We use the RPC because public users don't have RLS access to the table
        var res = await global.supabaseClient.schema('app').rpc('get_public_tracking', { p_tracking_code: code });

        if (res.error) {
          console.error('[Track] DATABASE ERROR:', res.error.message);
          console.error('If it says "function does not exist", you need to run 012_shipment_tracking_edit.sql in Supabase.');
        } else if (Array.isArray(res.data) && res.data.length > 0) {
          return res.data[0];
        } else {
          console.log('[Track] Code not found in database. Falling back to demo data.');
        }
      } catch (err) {
        console.error('[Track] RPC failed:', err);
      }
    }

    if (DEMO_SHIPMENTS[code]) return DEMO_SHIPMENTS[code];
    return null;
  }

  function showLoading() {
    ['loadingCard', 'errorCard', 'results', 'welcome', 'sampleBox'].forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (id === 'loadingCard') el.classList.add('show');
      else if (id === 'errorCard') el.classList.remove('show');
      else el.classList.add('hidden');
    });
  }

  function hideLoading() {
    var el = document.getElementById('loadingCard');
    if (el) el.classList.remove('show');
  }

  function showError(msg) {
    var el = document.getElementById('errorCard');
    if (el) {
      el.classList.add('show');
      if (msg) {
        var desc = el.querySelector('.error-desc');
        if (desc) desc.innerHTML = msg;
      }
    }
  }

  function renderResult(s) {
    ['welcome', 'sampleBox'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.getElementById('results')?.classList.remove('hidden');

    var title = document.getElementById('statusTitle');
    if (title) title.innerHTML = esc(s.status) + ' <span class="status-code">' + esc(s.tracking_code) + '</span>';
    
    var route = document.getElementById('statusRoute');
    if (route) route.innerHTML = '<span>' + esc(s.origin_city || '—') + '</span><span class="arrow"><i class="fas fa-arrow-right"></i></span><span>' + esc(s.dest_city || '—') + '</span>';

    var eta = document.getElementById('statusEta');
    if (eta) eta.textContent = s.estimated_delivery || 'TBD';

    var banner = document.getElementById('statusBanner');
    if (banner) banner.className = 'status-banner ' + String(s.status || 'Pending').replace(/\s+/g, '-');

    var timeline = document.getElementById('timeline');
    var acts = Array.isArray(s.activities) ? s.activities.slice().reverse() : [];
    if (timeline) {
      timeline.innerHTML = acts.length 
        ? acts.map((a, i) => '<div class="tl-item ' + (i === 0 ? 'latest' : 'done') + '"><div class="tl-dot"></div><div class="tl-date">' + esc(a.date) + '</div><div class="tl-loc">' + esc(a.location) + '</div><div class="tl-desc">' + esc(a.description) + '</div></div>').join('')
        : '<p style="color:var(--text-subtle)">No activity recorded.</p>';
    }
    var count = document.getElementById('activityCount');
    if (count) count.textContent = acts.length + ' events';

    var pkg = document.getElementById('packageGrid');
    if (pkg) pkg.innerHTML = '<div class="info-block"><div class="info-label">Type</div><div class="info-value small">' + esc(s.package_type || '—') + '</div></div><div class="info-block"><div class="info-label">Weight</div><div class="info-value small">' + esc(s.weight || '—') + '</div></div><div class="info-block"><div class="info-label">Dimensions</div><div class="info-value small">' + esc(s.dimensions || '—') + '</div></div><div class="info-block"><div class="info-label">Service</div><div class="info-value small">' + esc(s.service_level || '—') + '</div></div>';

    var parties = document.getElementById('partiesGrid');
    if (parties) parties.innerHTML = '<div class="party-card" style="grid-column:1/-1"><div class="party-head"><div class="party-avatar sender"><i class="fas fa-store"></i></div><div><div class="party-role">Sender</div><div class="party-name">' + esc(s.sender_name || '—') + '</div></div></div><div class="party-detail"><i class="fas fa-location-dot"></i><span>' + esc(s.sender_address || '—') + '</span></div></div><div class="party-card" style="grid-column:1/-1"><div class="party-head"><div class="party-avatar receiver"><i class="fas fa-user"></i></div><div><div class="party-role">Recipient</div><div class="party-name">' + esc(s.receiver_name || '—') + '</div></div></div><div class="party-detail"><i class="fas fa-location-dot"></i><span>' + esc(s.receiver_address || '—') + '</span></div></div>';

    if (window.TrackingMap && document.getElementById('trackMap')) {
      setTimeout(() => { try { window.TrackingMap.init('trackMap', s); } catch(e){} }, 80);
    }
  }

  function init() {
    var form = document.getElementById('searchForm');
    var input = document.getElementById('trackingInput');
    var clear = document.getElementById('clearBtn');
    if (!form || !input) return;

    if (clear) {
      input.addEventListener('input', () => clear.classList.toggle('visible', input.value.length > 0));
      clear.addEventListener('click', () => {
        input.value = ''; clear.classList.remove('visible');
        document.getElementById('results')?.classList.add('hidden');
        document.getElementById('errorCard')?.classList.remove('show');
        document.getElementById('welcome')?.classList.remove('hidden');
        document.getElementById('sampleBox')?.classList.remove('hidden');
        input.focus();
      });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var code = input.value.trim();
      if (!code) return;

      showLoading();
      var shipment = await findShipment(code);
      hideLoading();

      if (shipment) renderResult(shipment);
      else showError();
    });

    // Demo chips click handler (Regex updated for new format)
    document.querySelectorAll('.hint-chip, .sample-code').forEach(function (el) {
      el.addEventListener('click', function () {
        var match = el.textContent.match(/GE-[A-Z0-9]{4}-[A-Z0-9]{4}/);
        if (match) {
          input.value = match[0];
          if (clear) clear.classList.add('visible');
          form.dispatchEvent(new Event('submit'));
        }
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(window);