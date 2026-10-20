/* ================================================================
   GlobalExpress — Public Tracking Page Bootstrap (Hybrid)
   ================================================================ */
(function () {
  'use strict';

  // -------------------------------------------------------------
  // 1. DEMO FALLBACK DATA
  // -------------------------------------------------------------
  const DEMO_SHIPMENTS = {
    'GE-3301-7745-US': {
      trackingCode: 'GE-3301-7745-US',
      senderName: 'Placeholder Supplier AB', senderAddress: 'Dallas, TX, USA',
      receiverName: 'Birmand Barzenji', receiverAddress: 'Eskilstuna, Sweden',
      originCity: 'Dallas, TX, USA', destCity: 'Eskilstuna, Sweden',
      currentLocation: 'Kiruna, Sweden', status: 'In Transit',
      estimatedDelivery: 'September 24, 2026', packageType: 'Standard Box',
      weight: '4.6 lbs', dimensions: 'Medium', serviceLevel: 'Standard', contents: 'Merchandise',
      coords: { origin: { lat: 32.77, lng: -96.79 }, current: { lat: 67.85, lng: 20.22 }, dest: { lat: 59.36, lng: 16.50 } },
      activities: [{ date:'Sep 16, 2026', location:'Dallas', description:'Picked up.' }]
    },
    'GE-9102-4480-US': {
      trackingCode: 'GE-9102-4480-US',
      senderName: 'Placeholder Store', senderAddress: 'Los Angeles, CA, USA',
      receiverName: 'Logan Henderson', receiverAddress: 'Tennessee, USA',
      originCity: 'Los Angeles, CA', destCity: 'Tennessee, USA',
      currentLocation: 'Memphis, TN', status: 'On Hold',
      estimatedDelivery: 'November 2, 2026', packageType: 'Standard Box',
      weight: '1.2 lbs', dimensions: 'Small', serviceLevel: 'Economy', contents: 'Merchandise',
      coords: { origin: { lat: 34.05, lng: -118.24 }, current: { lat: 35.14, lng: -90.04 }, dest: { lat: 35.50, lng: -87.30 } },
      activities: [{ date:'Sep 26, 2026', location:'LA', description:'Received.' }]
    }
  };

  // -------------------------------------------------------------
  // 2. FETCH LOGIC (Supabase -> Demo Fallback)
  // -------------------------------------------------------------
  async function findShipment(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) return null;

    // 1. Try Supabase First
    if (window.supabaseClient) {
      try {
        const { data, error } = await window.supabaseClient
          .schema('app')
          .from('shipments')
          .select(`
            tracking_code, status, origin_city, dest_city, current_location,
            estimated_delivery, package_type, weight, dimensions, service_level,
            contents, created_at, coords, activities, sender_name, sender_address,
            receiver_name, receiver_address
          `)
          .eq('tracking_code', normalized)
          .single();

        if (data) {
          // Map DB snake_case to frontend camelCase
          return {
            trackingCode: data.tracking_code,
            status: data.status,
            originCity: data.origin_city,
            destCity: data.dest_city,
            currentLocation: data.current_location,
            estimatedDelivery: data.estimated_delivery,
            packageType: data.package_type,
            weight: data.weight,
            dimensions: data.dimensions,
            serviceLevel: data.service_level,
            contents: data.contents,
            createdAt: data.created_at,
            coords: data.coords || { origin: {}, current: {}, dest: {} },
            activities: data.activities || [],
            senderName: data.sender_name,
            senderAddress: data.sender_address,
            receiverName: data.receiver_name,
            receiverAddress: data.receiver_address
          };
        }
        
        if (error && error.code !== 'PGRST116') {
          // PGRST116 means "0 rows returned" which is normal if not found
          console.warn('[Track] Supabase lookup blocked or failed:', error.message);
        }
      } catch (err) {
        console.warn('[Track] Supabase threw an error:', err);
      }
    }

    // 2. Fallback to Demo Data
    if (DEMO_SHIPMENTS[normalized]) {
      return DEMO_SHIPMENTS[normalized];
    }

    // 3. Not found anywhere
    return null;
  }

  // -------------------------------------------------------------
  // 3. UI HANDLING
  // -------------------------------------------------------------
  function showLoading() {
    document.getElementById('loadingCard').classList.add('show');
    document.getElementById('errorCard').classList.remove('show');
    document.getElementById('results').classList.add('hidden');
    document.getElementById('welcome').classList.add('hidden');
    document.getElementById('sampleBox').classList.add('hidden');
  }

  function hideLoading() {
    document.getElementById('loadingCard').classList.remove('show');
  }

  function showError() {
    document.getElementById('errorCard').classList.add('show');
  }

  function renderResult(s) {
    document.getElementById('welcome').classList.add('hidden');
    document.getElementById('sampleBox').classList.add('hidden');
    document.getElementById('results').classList.remove('hidden');

    const statusTitle = document.getElementById('statusTitle');
    statusTitle.innerHTML = s.status + ' <span class="status-code">' + s.trackingCode + '</span>';
    
    document.getElementById('statusRoute').innerHTML = 
      '<span>' + (s.originCity || '—') + '</span>' +
      '<span class="arrow"><i class="fas fa-arrow-right"></i></span>' +
      '<span>' + (s.destCity || '—') + '</span>';

    document.getElementById('statusEta').textContent = s.estimatedDelivery || 'TBD';

    const banner = document.getElementById('statusBanner');
    banner.className = 'status-banner ' + String(s.status || 'Pending').replace(/\s+/g, '-');

    // Timeline
    const timeline = document.getElementById('timeline');
    if (s.activities && s.activities.length > 0) {
      const acts = s.activities.slice().reverse();
      timeline.innerHTML = acts.map(function(a, i) {
        return '<div class="tl-item ' + (i === 0 ? 'latest' : 'done') + '">' +
          '<div class="tl-dot"></div>' +
          '<div class="tl-date">' + (a.date || '') + '</div>' +
          '<div class="tl-loc">' + (a.location || '') + '</div>' +
          '<div class="tl-desc">' + (a.description || '') + '</div>' +
        '</div>';
      }).join('');
      document.getElementById('activityCount').textContent = acts.length + ' events';
    } else {
      timeline.innerHTML = '<p style="color:var(--text-3)">No activity recorded yet.</p>';
      document.getElementById('activityCount').textContent = '0 events';
    }

    // Package Details
    const pkgGrid = document.getElementById('packageGrid');
    pkgGrid.innerHTML = 
      '<div class="info-block"><div class="info-label">Type</div><div class="info-value small">' + (s.packageType || '—') + '</div></div>' +
      '<div class="info-block"><div class="info-label">Weight</div><div class="info-value small">' + (s.weight || '—') + '</div></div>' +
      '<div class="info-block"><div class="info-label">Dimensions</div><div class="info-value small">' + (s.dimensions || '—') + '</div></div>' +
      '<div class="info-block"><div class="info-label">Service</div><div class="info-value small">' + (s.serviceLevel || '—') + '</div></div>';

    // Parties
    const partiesGrid = document.getElementById('partiesGrid');
    partiesGrid.innerHTML = 
      '<div class="party-card" style="grid-column:1/-1">' +
        '<div class="party-head"><div class="party-avatar sender"><i class="fas fa-store"></i></div>' +
        '<div><div class="party-role">Sender</div><div class="party-name">' + (s.senderName || '—') + '</div></div></div>' +
        '<div class="party-detail"><i class="fas fa-location-dot"></i><span>' + (s.senderAddress || '—') + '</span></div>' +
      '</div>' +
      '<div class="party-card" style="grid-column:1/-1">' +
        '<div class="party-head"><div class="party-avatar receiver"><i class="fas fa-user"></i></div>' +
        '<div><div class="party-role">Recipient</div><div class="party-name">' + (s.receiverName || '—') + '</div></div></div>' +
        '<div class="party-detail"><i class="fas fa-location-dot"></i><span>' + (s.receiverAddress || '—') + '</span></div>' +
      '</div>';

    // Map
    if (window.TrackingMap && document.getElementById('trackMap')) {
      setTimeout(() => window.TrackingMap.init('trackMap', s), 80);
    }
  }

  // -------------------------------------------------------------
  // 4. INIT
  // -------------------------------------------------------------
  function init() {
    const form = document.getElementById('searchForm');
    const input = document.getElementById('trackingInput');
    const clearBtn = document.getElementById('clearBtn');

    if (!form || !input) return;

    if (clearBtn) {
      input.addEventListener('input', function () {
        clearBtn.classList.toggle('visible', input.value.length > 0);
      });
      clearBtn.addEventListener('click', function () {
        input.value = '';
        clearBtn.classList.remove('visible');
        document.getElementById('results').classList.add('hidden');
        document.getElementById('errorCard').classList.remove('show');
        document.getElementById('welcome').classList.remove('hidden');
        document.getElementById('sampleBox').classList.remove('hidden');
      });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) return;

      showLoading();
      await new Promise(r => setTimeout(r, 600)); 
      
      const shipment = await findShipment(code);
      hideLoading();

      if (shipment) {
        renderResult(shipment);
      } else {
        showError();
      }
    });

    // Demo chips
    document.querySelectorAll('.hint-chip, .sample-code').forEach(function (el) {
      el.addEventListener('click', function () {
        const match = el.textContent.match(/GE-\d{4}-\d{4}-US/);
        if (match) {
          input.value = match[0];
          if (clearBtn) clearBtn.classList.add('visible');
          form.dispatchEvent(new Event('submit'));
        }
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();