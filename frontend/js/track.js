/* ================================================================
   GlobalExpress — Public Tracking Page Bootstrap
   Orchestrates the search form, state transitions, and result
   rendering. Delegates all heavy lifting to the tracking/* modules
   and (once built) the adapter layer via window.Data.
   Loaded LAST — after map.js, timeline.js, progress.js.
   ================================================================ */

(function () {
  'use strict';

  // ================================================================
  // DEPENDENCY BINDINGS
  // These are resolved once at load time. If the real modules exist,
  // we use them. Otherwise we fall back to local minimal versions so
  // this file works standalone (drop-in to any HTML page).
  // ================================================================

  const Data = window.Data || null;      // future adapter layer
  const UI   = window.UI   || null;      // shared UI helpers (toasts/modals)

  const SHIPMENTS_KEY = 'ge_shipments';

  // ================================================================
  // DEMO SHIPMENTS — used when adapter and localStorage both miss
  // ================================================================
  const DEMO_SHIPMENTS = {
    'GE-3301-7745-US': {
      trackingCode: 'GE-3301-7745-US',
      senderName: 'Placeholder Supplier AB',
      senderEmail: 'noreply@example.com',
      senderAddress: 'Dallas, TX, USA',
      receiverName: 'Birmand Barzenji',
      receiverEmail: 'birmand@example.com',
      receiverPhone: '+46 736 554 389',
      receiverAddress: 'Granitgången 25, Eskilstuna, Sweden',
      originCity: 'Dallas, TX, USA',
      destCity: 'Eskilstuna, Sweden',
      currentLocation: 'Kiruna, Sweden (en route to Eskilstuna)',
      status: 'In Transit',
      estimatedDelivery: 'September 24, 2026 by end of day',
      packageType: 'Standard Box',
      dimensions: 'Medium',
      weight: '4.6 lbs (2.09 kg)',
      serviceLevel: 'Standard — 4–6 days',
      contents: 'General merchandise',
      createdAt: 'Sep 16, 2026',
      coords: {
        origin:  { lat: 32.7767, lng: -96.7970 },
        current: { lat: 67.8558, lng: 20.2253 },
        dest:    { lat: 59.3667, lng: 16.5077 }
      },
      activities: [
        { date:'Sep 16, 2026 · 09:00 AM', location:'Dallas, TX, USA',  description:'Shipment information received. Package picked up from sender.' },
        { date:'Sep 16, 2026 · 03:20 PM', location:'Dallas, TX, USA',  description:'Processed at the Dallas sorting facility.' },
        { date:'Sep 17, 2026 · 07:45 AM', location:'New York, NY, USA', description:'Arrived at international export hub.' },
        { date:'Sep 18, 2026 · 11:30 AM', location:'Cologne, Germany',  description:'Arrived at Cologne transit hub.' },
        { date:'Sep 20, 2026 · 08:15 AM', location:'Cologne, Germany',  description:'Cleared customs and departed Cologne hub.' },
        { date:'Sep 22, 2026 · 06:20 AM', location:'Kiruna, Sweden',    description:'Arrived at northern Sweden distribution centre.' },
        { date:'Sep 23, 2026 · 08:30 AM', location:'Kiruna, Sweden',    description:'In transit from Kiruna to final destination. Estimated delivery Sep 24, 2026.' }
      ],
      paid: true
    },
    'GE-9102-4480-US': {
      trackingCode: 'GE-9102-4480-US',
      senderName: 'Placeholder Store LLC',
      senderEmail: 'noreply@example.com',
      senderAddress: 'Los Angeles, CA, USA',
      receiverName: 'Logan Henderson',
      receiverEmail: 'logan@example.com',
      receiverPhone: '+00 000 000 000',
      receiverAddress: '205 Dooley Rd, Tennessee, USA',
      originCity: 'Los Angeles, CA, USA',
      destCity: 'Tennessee, USA',
      currentLocation: 'Memphis, TN, USA',
      status: 'On Hold',
      estimatedDelivery: 'November 2, 2026 by end of day',
      packageType: 'Standard Box',
      dimensions: 'Small',
      weight: '1.2 lbs (0.54 kg)',
      serviceLevel: 'Economy — 7–10 days',
      contents: 'General merchandise',
      createdAt: 'Sep 26, 2026',
      coords: {
        origin:  { lat: 34.0522, lng: -118.2437 },
        current: { lat: 35.1495, lng: -90.0490 },
        dest:    { lat: 35.5000, lng: -87.3000 }
      },
      activities: [
        { date:'Sep 26, 2026 · 09:00 AM', location:'Los Angeles, CA, USA', description:'Shipment information received.' },
        { date:'Sep 26, 2026 · 04:15 PM', location:'Los Angeles, CA, USA', description:'Processed at the Los Angeles sorting facility.' },
        { date:'Sep 27, 2026 · 07:40 AM', location:'Phoenix, AZ, USA',     description:'Arrived at regional transit hub.' },
        { date:'Sep 28, 2026 · 02:10 PM', location:'Dallas, TX, USA',      description:'Departed Dallas sorting centre.' },
        { date:'Sep 29, 2026 · 08:30 AM', location:'Memphis, TN, USA',     description:'Arrived at Memphis distribution centre. On hold pending documentation.' }
      ],
      paid: true
    }
  };

  // ================================================================
  // MODULE STATE
  // ================================================================
  let currentState    = 'welcome';   // 'welcome' | 'loading' | 'result' | 'error'
  let currentShipment = null;        // the shipment currently being displayed
  let isLoading       = false;       // guard against double-submit

  // ================================================================
  // HELPERS (with graceful fallbacks when utils.js isn't loaded)
  // ================================================================
  function esc(s) {
    if (window.Utils && typeof window.Utils.esc === 'function') {
      return window.Utils.esc(s);
    }
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;'
      })[c];
    });
  }

  function toast(msg, icon) {
    if (UI && typeof UI.toast === 'function') {
      return UI.toast(msg, icon);
    }
    const wrap = document.getElementById('toastWrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<i class="fas ' + (icon || 'fa-circle-check') + '"></i><span>' + esc(msg) + '</span>';
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add('removing');
      setTimeout(function () { el.remove(); }, 250);
    }, 2800);
  }

  // ================================================================
  // DATA LOOKUP
  // Prefer window.Data.trackShipment (adapter), then localStorage,
  // then the demo dataset. Always returns a normalized shipment or
  // null — never throws.
  // ================================================================
  async function findShipment(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) return null;

    // 1. Adapter path (future-proof)
    if (Data && typeof Data.trackShipment === 'function') {
      try {
        const result = await Data.trackShipment(normalized);
        if (result) return normalizeShipment(result);
      } catch (e) {
        console.warn('[track] adapter lookup failed:', e);
      }
    }

    // 2. localStorage path
    try {
      const raw = JSON.parse(localStorage.getItem(SHIPMENTS_KEY) || '[]');
      const hit = raw.find(function (s) {
        return (s.trackingCode || '').toUpperCase() === normalized;
      });
      if (hit) return normalizeShipment(hit);
    } catch (e) { /* ignore malformed storage */ }

    // 3. Demo fallback
    if (DEMO_SHIPMENTS[normalized]) {
      return normalizeShipment(DEMO_SHIPMENTS[normalized]);
    }

    return null;
  }

  /**
   * Normalize any shipment shape into the flat structure that the
   * renderer expects. Missing fields get safe fallbacks.
   */
  function normalizeShipment(raw) {
    if (!raw) return null;
    return {
      trackingCode:      raw.trackingCode      || '—',
      senderName:        raw.senderName        || '—',
      senderEmail:       raw.senderEmail       || '',
      senderAddress:     raw.senderAddress     || '',
      receiverName:      raw.receiverName      || '—',
      receiverEmail:     raw.receiverEmail     || '',
      receiverPhone:     raw.receiverPhone     || '',
      receiverAddress:   raw.receiverAddress   || '',
      originCity:        raw.originCity        || '—',
      destCity:          raw.destCity          || '—',
      currentLocation:   raw.currentLocation   || '—',
      status:            raw.status            || 'Pending',
      estimatedDelivery: raw.estimatedDelivery || '—',
      packageType:       raw.packageType       || '—',
      dimensions:        raw.dimensions        || '—',
      weight:            raw.weight            || '—',
      serviceLevel:      raw.serviceLevel      || '—',
      contents:          raw.contents          || '—',
      createdAt:         raw.createdAt         || '—',
      coords:            raw.coords || { origin: {}, current: {}, dest: {} },
      activities:        Array.isArray(raw.activities) ? raw.activities : [],
      paid:              raw.paid === true
    };
  }

  // ================================================================
  // STATE MACHINE
  // Exactly one pane is visible at a time.
  // ================================================================
  function setState(state) {
    currentState = state;

    const elWelcome = document.getElementById('welcome');
    const elSample  = document.getElementById('sampleBox');
    const elLoading = document.getElementById('loadingCard');
    const elError   = document.getElementById('errorCard');
    const elResults = document.getElementById('results');

    // Hide everything
    if (elWelcome) elWelcome.classList.add('hidden');
    if (elSample)  elSample.classList.add('hidden');
    if (elLoading) elLoading.classList.remove('show');
    if (elError)   elError.classList.remove('show');
    if (elResults) elResults.classList.add('hidden');

    // Show the requested one
    if (state === 'welcome') {
      if (elWelcome) elWelcome.classList.remove('hidden');
      if (elSample)  elSample.classList.remove('hidden');
    } else if (state === 'loading') {
      if (elLoading) elLoading.classList.add('show');
    } else if (state === 'error') {
      if (elError)   elError.classList.add('show');
    } else if (state === 'result') {
      if (elResults) elResults.classList.remove('hidden');
    }
  }

  function showLoading() { setState('loading'); }
  function showError()   { setState('error'); }
  function showWelcome() { setState('welcome'); }
  function showResult()  { setState('result'); }

  // ================================================================
  // RENDERING — composes the tracking/* modules
  // ================================================================
  function renderResult(shipment) {
    currentShipment = shipment;

    // 1. Status banner
    renderStatusBanner(shipment);

    // 2. Progress stepper
    const stepsEl = document.getElementById('progressSteps');
    if (stepsEl && window.TrackingProgress) {
      stepsEl.innerHTML = window.TrackingProgress.render(shipment.status);
    }

    // 3. Timeline
    const timelineEl = document.getElementById('timeline');
    if (timelineEl && window.TrackingTimeline) {
      timelineEl.innerHTML = window.TrackingTimeline.render(shipment.activities);
    }

    // 4. Package details
    renderPackageDetails(shipment);

    // 5. Parties (sender + receiver)
    renderParties(shipment);

    // 6. Bottom action row
    renderActionRow();

    // 7. Show the results pane
    showResult();

    // 8. Update URL for deep-linking (no reload)
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('track', shipment.trackingCode);
      window.history.replaceState(
        { track: shipment.trackingCode },
        '',
        url.toString()
      );
    } catch (e) { /* ignore */ }

    // 9. Update document title for share previews
    document.title = shipment.trackingCode + ' · ' + shipment.status + ' — GlobalExpress';

    // 10. Initialize the map AFTER the container is laid out.
    //     Leaflet requires a sized container; results pane must
    //     be visible before we can measure it.
    setTimeout(function () {
      if (window.TrackingMap && document.getElementById('trackMap')) {
        window.TrackingMap.init('trackMap', shipment);
      }
    }, 80);

    // 11. Scroll to top of results
    const resultsEl = document.getElementById('results');
    if (resultsEl) {
      resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderStatusBanner(s) {
    const banner = document.getElementById('statusBanner');
    if (!banner) return;

    // .status-banner.{Status-Class} drives the gradient
    const cls = String(s.status || 'Pending').trim().replace(/\s+/g, '-');
    banner.className = 'status-banner ' + cls;

    const titleEl = document.getElementById('statusTitle');
    if (titleEl) {
      titleEl.innerHTML =
        esc(s.status) +
        ' <span class="status-code">' + esc(s.trackingCode) + '</span>';
    }

    const routeEl = document.getElementById('statusRoute');
    if (routeEl) {
      routeEl.innerHTML =
        '<span>' + esc(s.originCity) + '</span>' +
        '<span class="arrow"><i class="fas fa-arrow-right"></i></span>' +
        '<span>' + esc(s.destCity) + '</span>';
    }

    const etaEl = document.getElementById('statusEta');
    if (etaEl) etaEl.textContent = s.estimatedDelivery || 'To be confirmed';

    // The two buttons inside the status banner.
    // Wired through event delegation on #results.
    const actionsEl = document.getElementById('statusActions');
    if (actionsEl) {
      actionsEl.innerHTML =
        '<button class="status-action" data-action="print" type="button">' +
          '<i class="fas fa-print"></i> Print' +
        '</button>' +
        '<button class="status-action" data-action="copy-code" type="button">' +
          '<i class="fas fa-copy"></i> Copy Code' +
        '</button>';
    }
  }

  function renderPackageDetails(s) {
    const grid = document.getElementById('packageGrid');
    if (!grid) return;

    function block(label, value) {
      return (
        '<div class="info-block">' +
          '<div class="info-label">' + esc(label) + '</div>' +
          '<div class="info-value small">' + esc(value || '—') + '</div>' +
        '</div>'
      );
    }

    grid.innerHTML =
      block('Type', s.packageType) +
      block('Weight', s.weight) +
      block('Dimensions', s.dimensions) +
      block('Service', s.serviceLevel) +
      '<div class="info-block full">' +
        '<div class="info-label">Contents</div>' +
        '<div class="info-value small">' + esc(s.contents) + '</div>' +
      '</div>';
  }

  function renderParties(s) {
    const grid = document.getElementById('partiesGrid');
    if (!grid) return;

    grid.innerHTML =
      '<div class="party-card" style="grid-column:1/-1">' +
        '<div class="party-head">' +
          '<div class="party-avatar sender"><i class="fas fa-store"></i></div>' +
          '<div>' +
            '<div class="party-role">Sender · Origin</div>' +
            '<div class="party-name">' + esc(s.senderName) + '</div>' +
          '</div>' +
        '</div>' +
        (s.senderAddress
          ? '<div class="party-detail"><i class="fas fa-location-dot"></i><span>' + esc(s.senderAddress) + '</span></div>'
          : '') +
        (s.senderEmail
          ? '<div class="party-detail"><i class="fas fa-envelope"></i><span>' + esc(s.senderEmail) + '</span></div>'
          : '') +
      '</div>' +
      '<div class="party-card" style="grid-column:1/-1">' +
        '<div class="party-head">' +
          '<div class="party-avatar receiver"><i class="fas fa-user"></i></div>' +
          '<div>' +
            '<div class="party-role">Recipient · Destination</div>' +
            '<div class="party-name">' + esc(s.receiverName) + '</div>' +
          '</div>' +
        '</div>' +
        (s.receiverAddress
          ? '<div class="party-detail"><i class="fas fa-location-dot"></i><span>' + esc(s.receiverAddress) + '</span></div>'
          : '') +
        (s.receiverPhone
          ? '<div class="party-detail"><i class="fas fa-phone"></i><span>' + esc(s.receiverPhone) + '</span></div>'
          : '') +
        (s.receiverEmail
          ? '<div class="party-detail"><i class="fas fa-envelope"></i><span>' + esc(s.receiverEmail) + '</span></div>'
          : '') +
      '</div>';
  }

  function renderActionRow() {
    const row = document.getElementById('actionRow');
    if (!row) return;

    row.innerHTML =
      '<button class="btn btn-outline" data-action="copy-link" type="button">' +
        '<i class="fas fa-link"></i> Copy Share Link' +
      '</button>' +
      '<button class="btn btn-outline" data-action="share-whatsapp" type="button">' +
        '<i class="fab fa-whatsapp"></i> Share on WhatsApp' +
      '</button>' +
      '<button class="btn btn-outline" data-action="reset" type="button">' +
        '<i class="fas fa-rotate-right"></i> Track Another' +
      '</button>' +
      '<a href="/" class="btn btn-primary">' +
        '<i class="fas fa-plus"></i> Ship Your Own Package' +
      '</a>';
  }

  // ================================================================
  // MAIN LOOKUP FLOW
  // ================================================================
  async function track(code) {
    if (isLoading) return;
    if (!code) {
      toast('Please enter a tracking code', 'fa-triangle-exclamation');
      return;
    }

    isLoading = true;
    showLoading();

    // Enforce a minimum loader duration so quick lookups don't
    // flash the spinner for a single frame (feels broken).
    const started  = Date.now();
    const result   = await findShipment(code);
    const elapsed  = Date.now() - started;
    const minDelay = 500;
    if (elapsed < minDelay) {
      await new Promise(function (r) { setTimeout(r, minDelay - elapsed); });
    }

    if (result) {
      renderResult(result);
      toast('Shipment found', 'fa-circle-check');
    } else {
      showError();
    }

    isLoading = false;
  }

  // ================================================================
  // ACTION HELPERS
  // ================================================================
  function copyText(text, okMsg) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { toast(okMsg || 'Copied', 'fa-copy'); })
        .catch(function () { toast('Copy failed', 'fa-triangle-exclamation'); });
    } else {
      toast('Copy not supported here', 'fa-triangle-exclamation');
    }
  }

  function buildShareUrl() {
    const url = new URL(window.location.href);
    if (currentShipment) {
      url.searchParams.set('track', currentShipment.trackingCode);
    }
    return url.toString();
  }

  function shareWhatsApp() {
    if (!currentShipment) return;
    const msg = 'Track my GlobalExpress shipment ' + currentShipment.trackingCode +
                ': ' + buildShareUrl();
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }

  function shareEmail() {
    if (!currentShipment) return;
    const subject = 'Track your GlobalExpress shipment ' + currentShipment.trackingCode;
    const body    = 'You can track this shipment here:\n' + buildShareUrl() +
                    '\n\nTracking code: ' + currentShipment.trackingCode;
    window.open('mailto:?subject=' + encodeURIComponent(subject) +
                '&body=' + encodeURIComponent(body));
  }

  function resetView() {
    currentShipment = null;

    const input = document.getElementById('trackingInput');
    if (input) { input.value = ''; input.focus(); }

    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) clearBtn.classList.remove('visible');

    // Remove ?track= from the URL without reloading
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('track');
      window.history.replaceState({}, '', url.toString());
    } catch (e) { /* ignore */ }

    document.title = 'Track Your Shipment — GlobalExpress';

    showWelcome();

    const wrap = document.getElementById('searchWrap');
    if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ================================================================
  // EVENT WIRING
  // ================================================================
  function wireSearch() {
    const form     = document.getElementById('searchForm');
    const input    = document.getElementById('trackingInput');
    const clearBtn = document.getElementById('clearBtn');

    if (!form || !input) return;

    // Toggle the clear (X) button as the user types
    input.addEventListener('input', function () {
      if (clearBtn) clearBtn.classList.toggle('visible', input.value.length > 0);
    });

    // Enter key or submit button
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) return;
      track(code);
    });

    // Clear resets everything
    if (clearBtn) {
      clearBtn.addEventListener('click', function (e) {
        e.preventDefault();
        resetView();
      });
    }
  }

  /**
   * Event delegation for the result pane — the buttons inside
   * #results are created dynamically by renderResult(), so we
   * can't attach listeners to them directly. One listener on the
   * container matches clicks against [data-action] elements.
   */
  function wireResultActions() {
    const results = document.getElementById('results');
    if (!results) return;

    results.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.getAttribute('data-action');

      if (action === 'copy-code') {
        if (currentShipment) {
          copyText(currentShipment.trackingCode, 'Tracking code copied');
        }
      } else if (action === 'copy-link') {
        copyText(buildShareUrl(), 'Share link copied');
      } else if (action === 'share-whatsapp') {
        shareWhatsApp();
      } else if (action === 'share-email') {
        shareEmail();
      } else if (action === 'print') {
        window.print();
      } else if (action === 'reset') {
        resetView();
      }
    });
  }

  /**
   * Demo chips (search hint + sample boxes) populate the input
   * and immediately trigger a lookup. Delegated on document so
   * newly-rendered chips work without re-wiring.
   */
  function wireDemoChips() {
    document.addEventListener('click', function (e) {
      const chip = e.target.closest('[data-demo-code]');
      if (!chip) return;
      e.preventDefault();

      const code = chip.getAttribute('data-demo-code');
      const input = document.getElementById('trackingInput');
      const clearBtn = document.getElementById('clearBtn');

      if (input) {
        input.value = code;
        if (clearBtn) clearBtn.classList.add('visible');
      }
      track(code);
    });
  }

  /**
   * Escape resets the view when a result is showing.
   */
  function wireKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && currentShipment) {
        resetView();
      }
    });
  }

  /**
   * Progressively enhance the existing HTML: scan any .hint-chip
   * and .sample-code elements for a tracking-code pattern, then
   * add data-demo-code attributes so wireDemoChips() picks them up.
   * This lets us drop track.js into the existing track.html markup
   * without editing the HTML.
   */
  function patchDemoClickTargets() {
    const CODE_RE = /GE-\d{4}-\d{4}-US/;

    document.querySelectorAll('.hint-chip, .sample-code').forEach(function (el) {
      if (el.hasAttribute('data-demo-code')) return;
      const match = el.textContent.match(CODE_RE);
      if (match) el.setAttribute('data-demo-code', match[0]);
    });
  }

  // ================================================================
  // INIT
  // ================================================================
  function init() {
    // Enhance any existing demo chips so they carry data-demo-code
    patchDemoClickTargets();

    // Wire everything
    wireSearch();
    wireResultActions();
    wireDemoChips();
    wireKeyboard();

    // Footer year
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // Deep link support — ?track=CODE or ?code=CODE
    let codeFromUrl = '';
    try {
      const params = new URLSearchParams(window.location.search);
      codeFromUrl  = params.get('track') || params.get('code') || '';
    } catch (e) { /* ignore */ }

    if (codeFromUrl) {
      const input = document.getElementById('trackingInput');
      const clearBtn = document.getElementById('clearBtn');
      if (input) {
        input.value = codeFromUrl;
        if (clearBtn) clearBtn.classList.add('visible');
      }
      track(codeFromUrl);
    } else {
      showWelcome();
    }
  }

  // Kick off — if the DOM is still parsing, wait; otherwise run now.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ================================================================
  // PUBLIC SURFACE (for tests and console debugging)
  // ================================================================
  window.TrackPage = {
    track:       track,
    reset:       resetView,
    getState:    function () { return currentState; },
    getShipment: function () { return currentShipment; }
  };

})();