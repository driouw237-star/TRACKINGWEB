/* GlobalExpress - pages/tracking.js
   In-app tracking page — mirrors the public tracking page layout.
   Uses the same .status-banner, .progress-card, .card, .timeline,
   .info-grid, .party-card, .map-box classes as index.html.

   Registers itself via App.register('tracking', page).
*/
(function (global) {
  'use strict';

  var Utils    = global.Utils    || {};
  var UI       = global.UI       || {};
  var Store    = global.Store    || {};

  // --- Fallbacks -----------------------------------------------------------

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var statusCls = Utils.statusCls || function (s) {
    return String(s || 'Pending').trim().replace(/\s+/g, '-');
  };

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };

  // --- Demo shipments -----------------------------------------------------

  var DEMO_SHIPMENTS = {
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
      currentLocation: 'Kiruna, Sweden',
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

  // --- Module state ------------------------------------------------------

  var currentShipment = null;
  var mapInstance = null;
  var handler = null;
  var container = null;
  var deepLinkHandled = false;

  // --- Helpers -----------------------------------------------------------

  function findShipment(code) {
    var normalized = String(code || '').trim().toUpperCase();
    if (!normalized) return null;

    // User's own shipments
    try {
      var mine = Store.get('shipments') || [];
      for (var i = 0; i < mine.length; i++) {
        if (String(mine[i].trackingCode || '').toUpperCase() === normalized) return mine[i];
      }
    } catch (e) {}

    // All shipments in localStorage
    try {
      var raw = JSON.parse(localStorage.getItem('ge_shipments') || '[]');
      for (var j = 0; j < raw.length; j++) {
        if (String(raw[j].trackingCode || '').toUpperCase() === normalized) return raw[j];
      }
    } catch (e) {}

    // Demo fallback
    if (DEMO_SHIPMENTS[normalized]) return DEMO_SHIPMENTS[normalized];
    return null;
  }

  // --- Hero + search -----------------------------------------------------

  function heroSection() {
    return ''
      + '<section class="hero" style="padding:44px 26px 100px;border-radius:16px;margin-bottom:0">'
      +   '<div class="hero-grid" aria-hidden="true"></div>'
      +   '<div class="hero-inner">'
      +     '<div class="hero-badge">'
      +       '<span class="dot" aria-hidden="true"></span>'
      +       'Live tracking · Updated in real time'
      +     '</div>'
      +     '<h1 style="font-size:34px">Where is my <span>package?</span></h1>'
      +     '<p>Enter any tracking code — yours or a public one — to see live status.</p>'
      +   '</div>'
      + '</section>';
  }

  function searchSection(prefill) {
    return ''
      + '<div class="search-wrap" style="margin-top:-60px;padding:0 22px;max-width:820px;margin-left:auto;margin-right:auto">'
      +   '<div class="search-card">'
      +     '<form class="search-form" id="tkForm" autocomplete="off" role="search">'
      +       '<div class="search-input-wrap">'
      +         '<i class="fas fa-magnifying-glass leading" aria-hidden="true"></i>'
      +         '<label for="tkCode" class="sr-only">Tracking code</label>'
      +         '<input type="text" class="search-input" id="tkCode" '
      +           'placeholder="Enter tracking code (e.g. GE-1234-5678-US)" '
      +           'autocomplete="off" spellcheck="false" autocapitalize="characters" '
      +           'value="' + esc(prefill || '') + '" />'
      +         '<button type="button" class="search-clear" id="tkClear" aria-label="Clear" title="Clear">'
      +           '<i class="fas fa-xmark"></i>'
      +         '</button>'
      +       '</div>'
      +       '<button type="submit" class="search-btn" id="tkBtn">'
      +         '<i class="fas fa-location-crosshairs" aria-hidden="true"></i> Track Package'
      +       '</button>'
      +     '</form>'
      +   '</div>'
      +   '<div class="search-hint" aria-label="Demo codes">'
      +     '<span class="hint-chip" data-demo="GE-3301-7745-US"><i class="fas fa-bolt"></i>GE-3301-7745-US</span>'
      +     '<span class="hint-chip" data-demo="GE-9102-4480-US"><i class="fas fa-bolt"></i>GE-9102-4480-US</span>'
      +   '</div>'
      + '</div>';
  }

  // --- Loading / Error / Welcome -----------------------------------------

  function loadingCard() {
    return ''
      + '<div class="loading-card" id="tkLoading" role="status" aria-live="polite" style="max-width:820px;margin:28px auto 0;padding:0 22px">'
      +   '<div class="loading-inner">'
      +     '<div class="loading-spinner" aria-hidden="true"></div>'
      +     '<div>'
      +       '<div class="loading-title">Looking up your shipment…</div>'
      +       '<div class="loading-sub">This should only take a moment.</div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function errorCard() {
    return ''
      + '<div class="error-card" id="tkError" role="alert" style="max-width:820px;margin:28px auto 0;padding:0 22px">'
      +   '<div class="error-inner">'
      +     '<div class="error-icon"><i class="fas fa-circle-exclamation"></i></div>'
      +     '<div style="flex:1">'
      +       '<div class="error-title">We couldn\'t find that tracking code</div>'
      +       '<div class="error-desc">'
      +         'Please double-check the code and try again. It usually looks like '
      +         '<strong>GE-XXXX-XXXX-US</strong>.'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function welcomeSection() {
    return ''
      + '<section class="welcome" id="tkWelcome" style="margin-top:40px">'
      +   '<div class="welcome-grid">'
      +     '<div class="feature">'
      +       '<div class="feature-icon blue"><i class="fas fa-location-crosshairs"></i></div>'
      +       '<h4>Live Location</h4>'
      +       '<p>Watch your package move in real time on an interactive map.</p>'
      +     '</div>'
      +     '<div class="feature">'
      +       '<div class="feature-icon orange"><i class="fas fa-bolt"></i></div>'
      +       '<h4>Instant Updates</h4>'
      +       '<p>Every scan, hold, and handover appears in seconds.</p>'
      +     '</div>'
      +     '<div class="feature">'
      +       '<div class="feature-icon green"><i class="fas fa-shield-halved"></i></div>'
      +       '<h4>Verified &amp; Secure</h4>'
      +       '<p>Tracking codes are unique and can\'t be guessed.</p>'
      +     '</div>'
      +   '</div>'
      + '</section>'
      + '<section class="sample-box" id="tkSample" style="margin-top:32px">'
      +   '<div class="sample-inner">'
      +     '<h4><i class="fas fa-flask" style="color:var(--accent)"></i> Try a demo tracking code</h4>'
      +     '<div class="sample-grid">'
      +       '<div class="sample-code" data-demo="GE-3301-7745-US" role="button" tabindex="0">'
      +         'GE-3301-7745-US'
      +         '<small>Dallas → Eskilstuna (In Transit)</small>'
      +       '</div>'
      +       '<div class="sample-code" data-demo="GE-9102-4480-US" role="button" tabindex="0">'
      +         'GE-9102-4480-US'
      +         '<small>Los Angeles → Tennessee (On Hold)</small>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</section>';
  }

  // --- Result: full tracking view (matches index.html) -------------------

  function resultSection(s) {
    var acts = (s.activities || []).slice().reverse();
    var cls = statusCls(s.status);

    return ''
      + '<main class="results" id="tkResults" style="margin-top:36px">'

      // Status banner
      +   '<section class="status-banner ' + esc(cls) + '">'
      +     '<div class="status-inner">'
      +       '<div class="status-left">'
      +         '<div class="status-eyebrow">Tracking Status</div>'
      +         '<div class="status-title">' + esc(s.status) + ' <span class="status-code">' + esc(s.trackingCode) + '</span></div>'
      +         '<div class="status-route">'
      +           '<span>' + esc(s.originCity || '—') + '</span>'
      +           '<span class="arrow"><i class="fas fa-arrow-right"></i></span>'
      +           '<span>' + esc(s.destCity || '—') + '</span>'
      +         '</div>'
      +       '</div>'
      +       '<div class="status-right">'
      +         '<div class="status-eta-label">Estimated Delivery</div>'
      +         '<div class="status-eta-value">' + esc(s.estimatedDelivery || 'TBD') + '</div>'
      +         '<div class="status-actions">'
      +           '<button type="button" class="status-action" data-action="print"><i class="fas fa-print"></i> Print</button>'
      +           '<button type="button" class="status-action" data-action="copy-code"><i class="fas fa-copy"></i> Copy Code</button>'
      +         '</div>'
      +       '</div>'
      +     '</div>'
      +   '</section>'

      // Progress stepper
      +   '<section class="progress-card">'
      +     '<div class="progress-title"><i class="fas fa-route"></i> Delivery Progress</div>'
      +     '<div class="steps" id="tkSteps"></div>'
      +   '</section>'

      // Result grid
      +   '<div class="result-grid">'
      +     '<div>'
      +       '<section class="card">'
      +         '<div class="card-head">'
      +           '<h3><i class="fas fa-clock-rotate-left"></i> Shipment Activity</h3>'
      +           '<span class="badge">' + acts.length + ' events</span>'
      +         '</div>'
      +         '<div class="card-body">'
      +           (acts.length
                  ? '<div class="timeline">' + acts.map(function (a, i) {
                      return ''
                        + '<div class="tl-item ' + (i === 0 ? 'latest' : 'done') + '">'
                        +   '<div class="tl-dot"></div>'
                        +   '<div class="tl-date">' + esc(a.date) + '</div>'
                        +   '<div class="tl-loc">' + esc(a.location) + '</div>'
                        +   '<div class="tl-desc">' + esc(a.description) + '</div>'
                        + '</div>';
                    }).join('') + '</div>'
                  : '<p style="color:var(--text-3);font-size:13px">No activity yet.</p>')
      +         '</div>'
      +       '</section>'

      +       '<section class="card">'
      +         '<div class="card-head"><h3><i class="fas fa-box"></i> Package Details</h3></div>'
      +         '<div class="card-body">'
      +           '<div class="info-grid">'
      +             infoBlock('Type', s.packageType)
      +             infoBlock('Weight', s.weight)
      +             infoBlock('Dimensions', s.dimensions)
      +             infoBlock('Service', s.serviceLevel)
      +             (s.contents
                    ? '<div class="info-block full"><div class="info-label">Contents</div><div class="info-value small">' + esc(s.contents) + '</div></div>'
                    : '')
      +           '</div>'
      +         '</div>'
      +       '</section>'
      +     '</div>'

      +     '<div>'
      +       '<section class="card">'
      +         '<div class="card-head">'
      +           '<h3><i class="fas fa-map-location-dot"></i> Live Map</h3>'
      +           '<span class="badge">Route overview</span>'
      +         '</div>'
      +         '<div class="card-body">'
      +           '<div class="map-box"><div id="tkMap"></div></div>'
      +           '<div class="map-legend">'
      +             '<span><span class="legend-dot" style="background:#0b2545"></span> Origin</span>'
      +             '<span><span class="legend-dot" style="background:#FF6B35"></span> Current</span>'
      +             '<span><span class="legend-dot" style="background:#059669"></span> Destination</span>'
      +           '</div>'
      +         '</div>'
      +       '</section>'

      +       '<section class="card">'
      +         '<div class="card-head"><h3><i class="fas fa-users"></i> Shipment Parties</h3></div>'
      +         '<div class="card-body">'
      +           '<div class="info-grid">'
      +             '<div class="party-card" style="grid-column:1/-1">'
      +               '<div class="party-head">'
      +                 '<div class="party-avatar sender"><i class="fas fa-store"></i></div>'
      +                 '<div>'
      +                   '<div class="party-role">Sender · Origin</div>'
      +                   '<div class="party-name">' + esc(s.senderName || '—') + '</div>'
      +                 '</div>'
      +               '</div>'
      +               (s.senderAddress ? '<div class="party-detail"><i class="fas fa-location-dot"></i><span>' + esc(s.senderAddress) + '</span></div>' : '')
      +               (s.senderEmail ? '<div class="party-detail"><i class="fas fa-envelope"></i><span>' + esc(s.senderEmail) + '</span></div>' : '')
      +             '</div>'
      +             '<div class="party-card" style="grid-column:1/-1">'
      +               '<div class="party-head">'
      +                 '<div class="party-avatar receiver"><i class="fas fa-user"></i></div>'
      +                 '<div>'
      +                   '<div class="party-role">Recipient · Destination</div>'
      +                   '<div class="party-name">' + esc(s.receiverName || '—') + '</div>'
      +                 '</div>'
      +               '</div>'
      +               (s.receiverAddress ? '<div class="party-detail"><i class="fas fa-location-dot"></i><span>' + esc(s.receiverAddress) + '</span></div>' : '')
      +               (s.receiverPhone ? '<div class="party-detail"><i class="fas fa-phone"></i><span>' + esc(s.receiverPhone) + '</span></div>' : '')
      +               (s.receiverEmail ? '<div class="party-detail"><i class="fas fa-envelope"></i><span>' + esc(s.receiverEmail) + '</span></div>' : '')
      +             '</div>'
      +           '</div>'
      +         '</div>'
      +       '</section>'
      +     '</div>'
      +   '</div>'

      // Action row
      +   '<div class="action-row">'
      +     '<button type="button" class="btn btn-outline" data-action="copy-link"><i class="fas fa-link"></i> Copy Share Link</button>'
      +     '<button type="button" class="btn btn-outline" data-action="share-whatsapp"><i class="fab fa-whatsapp"></i> Share on WhatsApp</button>'
      +     '<button type="button" class="btn btn-outline" data-action="reset"><i class="fas fa-rotate-right"></i> Track Another</button>'
      +   '</div>'

      + '</main>';
  }

  function infoBlock(label, value) {
    return ''
      + '<div class="info-block">'
      +   '<div class="info-label">' + esc(label) + '</div>'
      +   '<div class="info-value small">' + esc(value || '—') + '</div>'
      + '</div>';
  }

  // --- Progress stepper (5 stages) ---------------------------------------

  function buildSteps(status) {
    var s = String(status || '').toLowerCase();
    var stage = 0;
    if (s.indexOf('pending') >= 0) stage = 1;
    else if (s.indexOf('hold') >= 0) stage = 2;
    else if (s.indexOf('transit') >= 0) stage = 2;
    else if (s.indexOf('delivered') >= 0) stage = 4;
    else if (s.indexOf('cancel') >= 0) stage = 0;

    var defs = [
      { label: 'Order Processed',  icon: 'fa-clipboard-check' },
      { label: 'Picked Up',        icon: 'fa-box' },
      { label: 'In Transit',       icon: 'fa-truck' },
      { label: 'Out for Delivery', icon: 'fa-truck-fast' },
      { label: 'Delivered',        icon: 'fa-circle-check' }
    ];

    return defs.map(function (d, i) {
      var state = 'pending';
      if (s.indexOf('cancel') >= 0) {
        state = (i === 0) ? 'done' : 'pending';
      } else if (s.indexOf('delivered') >= 0) {
        state = 'done';
      } else {
        if (i < stage) state = 'done';
        else if (i === stage) state = 'active';
      }
      return { label: d.label, icon: d.icon, state: state };
    });
  }

  function renderSteps(s) {
    var steps = buildSteps(s.status);
    var doneCount = 0;
    var activeCount = 0;
    steps.forEach(function (st) {
      if (st.state === 'done') doneCount++;
      if (st.state === 'active') activeCount++;
    });
    var fillPct = ((doneCount + (activeCount ? 0.5 : 0)) / steps.length) * 100;

    var host = document.getElementById('tkSteps');
    if (!host) return;

    host.innerHTML = ''
      + '<div class="steps-fill" style="width:' + Math.max(0, fillPct) + '%"></div>'
      + steps.map(function (st) {
          return ''
            + '<div class="step ' + st.state + '">'
            +   '<div class="step-icon"><i class="fas ' + st.icon + '"></i></div>'
            +   '<div class="step-label">' + esc(st.label) + '</div>'
            + '</div>';
        }).join('');
  }

  // --- Map ---------------------------------------------------------------

  function mountMap(s) {
    if (typeof global.L === 'undefined') return;
    var elm = document.getElementById('tkMap');
    if (!elm) return;

    if (mapInstance) {
      try { mapInstance.remove(); } catch (e) {}
      mapInstance = null;
    }

    var map = global.L.map('tkMap', { center: [30, 0], zoom: 3, scrollWheelZoom: false });
    global.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 18
    }).addTo(map);

    var c = s.coords || {};
    var valid = function (p) {
      return p && typeof p.lat === 'number' && typeof p.lng === 'number'
          && !isNaN(p.lat) && !isNaN(p.lng) && p.lat !== 0 && p.lng !== 0;
    };
    var pin = function (color, icon) {
      return global.L.divIcon({
        html: '<div style="width:36px;height:36px;border-radius:50%;background:' + color + ';'
            + 'border:3px solid #fff;box-shadow:0 6px 16px rgba(0,0,0,.25);'
            + 'display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px">'
            + '<i class="fas ' + icon + '"></i></div>',
        className: '', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18]
      });
    };

    var markers = [];
    if (valid(c.origin))  markers.push(global.L.marker([c.origin.lat, c.origin.lng], { icon: pin('#0b2545', 'fa-store') }).addTo(map).bindPopup('<strong>Origin</strong><br>' + esc(s.originCity || '')));
    if (valid(c.current)) markers.push(global.L.marker([c.current.lat, c.current.lng], { icon: pin('#FF6B35', 'fa-truck') }).addTo(map).bindPopup('<strong>Current</strong><br>' + esc(s.currentLocation || '')));
    if (valid(c.dest))    markers.push(global.L.marker([c.dest.lat, c.dest.lng], { icon: pin('#059669', 'fa-flag-checkered') }).addTo(map).bindPopup('<strong>Destination</strong><br>' + esc(s.destCity || '')));

    var line = [];
    if (valid(c.origin)) line.push([c.origin.lat, c.origin.lng]);
    if (valid(c.current) && valid(c.origin) && (c.current.lat !== c.origin.lat || c.current.lng !== c.origin.lng)) {
      line.push([c.current.lat, c.current.lng]);
    } else if (valid(c.current) && !valid(c.origin)) {
      line.push([c.current.lat, c.current.lng]);
    }
    if (valid(c.dest)) line.push([c.dest.lat, c.dest.lng]);

    if (line.length >= 2) {
      global.L.polyline(line, { color: '#FF6B35', weight: 3, opacity: .75, dashArray: '10,8', lineCap: 'round' }).addTo(map);
    }
    if (markers.length) {
      map.fitBounds(global.L.featureGroup(markers).getBounds(), { padding: [50, 50] });
    } else {
      map.setView([20, 0], 2);
    }

    mapInstance = map;
  }

  // --- Flow --------------------------------------------------------------

  function showLoading() {
    var elm = document.getElementById('tkLoading');
    if (elm) elm.classList.add('show');
  }
  function hideLoading() {
    var elm = document.getElementById('tkLoading');
    if (elm) elm.classList.remove('show');
  }
  function showError() {
    var elm = document.getElementById('tkError');
    if (elm) elm.classList.add('show');
  }
  function hideError() {
    var elm = document.getElementById('tkError');
    if (elm) elm.classList.remove('show');
  }
  function hideWelcome() {
    var w = document.getElementById('tkWelcome');
    var sb = document.getElementById('tkSample');
    if (w) w.style.display = 'none';
    if (sb) sb.style.display = 'none';
  }

  function doTrack(code) {
    hideError();
    showLoading();

    // Give the loading spinner a moment to show
    setTimeout(function () {
      var s = findShipment(code);
      hideLoading();

      if (!s) {
        showError();
        return;
      }

      // Inject the result
      var host = document.getElementById('tkResultHost');
      if (host) host.innerHTML = resultSection(s);

      // Hide welcome
      hideWelcome();

      // Render stepper
      setTimeout(function () { renderSteps(s); }, 50);

      // Mount the map
      setTimeout(function () { mountMap(s); }, 100);

      // Update URL for deep link
      try {
        var url = new URL(location.href);
        url.searchParams.set('track', s.trackingCode);
        history.replaceState({ track: s.trackingCode }, '', url.toString());
      } catch (e) {}

      toast('Shipment found', s.trackingCode, 'success');
    }, 400);
  }

  function resetView() {
    var host = document.getElementById('tkResultHost');
    if (host) host.innerHTML = '';

    var welcome = document.getElementById('tkWelcome');
    var sample = document.getElementById('tkSample');
    if (welcome) welcome.style.display = '';
    if (sample) sample.style.display = '';

    var input = document.getElementById('tkCode');
    if (input) { input.value = ''; input.focus(); }
    var clear = document.getElementById('tkClear');
    if (clear) clear.classList.remove('visible');

    hideError();

    // Remove track= from URL
    try {
      var url = new URL(location.href);
      url.searchParams.delete('track');
      history.replaceState({}, '', url.toString());
    } catch (e) {}

    // Remove map
    if (mapInstance) {
      try { mapInstance.remove(); } catch (e) {}
      mapInstance = null;
    }
  }

  // --- Render ------------------------------------------------------------

  function render(ctx) {
    var prefill = (ctx && ctx.params && ctx.params.code) || '';
    return ''
      + heroSection()
      + searchSection(prefill)
      + loadingCard()
      + errorCard()
      + '<div id="tkResultHost"></div>'
      + welcomeSection();
  }

  // --- Bind --------------------------------------------------------------

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;
    if (handler) container.removeEventListener('click', handler);

    // Reset deep-link flag on each bind
    var deepLinkCode = ctx && ctx.params && ctx.params.code;

    // --- Search form ---
    var form = document.getElementById('tkForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = document.getElementById('tkCode');
        var code = (input && input.value || '').trim();
        if (!code) { toast('Enter a tracking code', '', 'error'); return; }
        doTrack(code);
      });
    }

    // Clear button
    var input = document.getElementById('tkCode');
    var clearBtn = document.getElementById('tkClear');
    if (input && clearBtn) {
      input.addEventListener('input', function () {
        clearBtn.classList.toggle('visible', input.value.length > 0);
      });
      clearBtn.addEventListener('click', function (e) {
        e.preventDefault();
        resetView();
      });
    }

    // --- Delegated clicks (demo chips, result actions) ---
    handler = function (e) {
      // Demo chips
      var chip = e.target.closest && e.target.closest('[data-demo]');
      if (chip) {
        e.preventDefault();
        var code = chip.dataset.demo;
        var inp = document.getElementById('tkCode');
        var clr = document.getElementById('tkClear');
        if (inp) {
          inp.value = code;
          if (clr) clr.classList.add('visible');
        }
        doTrack(code);
        return;
      }

      // Result actions
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'reset') { resetView(); return; }

      if (action === 'copy-code') {
        var s = findCurrentShipmentFromForm();
        if (s) {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(s.trackingCode).then(function () {
              toast('Code copied', s.trackingCode, 'success');
            }).catch(function () { toast('Copy failed', '', 'error'); });
          }
        }
        return;
      }

      if (action === 'copy-link') {
        var s2 = findCurrentShipmentFromForm();
        if (!s2) return;
        var url = location.origin + location.pathname + '#tracking?track=' + encodeURIComponent(s2.trackingCode);
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function () {
            toast('Link copied', '', 'success');
          }).catch(function () { toast('Copy failed', '', 'error'); });
        }
        return;
      }

      if (action === 'share-whatsapp') {
        var s3 = findCurrentShipmentFromForm();
        if (!s3) return;
        var shareUrl = location.origin + location.pathname + '#tracking?track=' + encodeURIComponent(s3.trackingCode);
        var msg = 'Track my GlobalExpress shipment ' + s3.trackingCode + ': ' + shareUrl;
        window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
        return;
      }

      if (action === 'print') {
        window.print();
        return;
      }
    };

    container.addEventListener('click', handler);

    // --- Deep link handling ---
    if (deepLinkCode && !deepLinkHandled) {
      deepLinkHandled = true;
      var inp2 = document.getElementById('tkCode');
      var clr2 = document.getElementById('tkClear');
      if (inp2) {
        inp2.value = deepLinkCode;
        if (clr2) clr2.classList.add('visible');
      }
      setTimeout(function () { doTrack(deepLinkCode); }, 200);
    } else {
      deepLinkHandled = false;
    }
  }

  function findCurrentShipmentFromForm() {
    var inp = document.getElementById('tkCode');
    if (!inp) return null;
    return findShipment(inp.value);
  }

  // --- Cleanup -----------------------------------------------------------

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    if (mapInstance) {
      try { mapInstance.remove(); } catch (e) {}
      mapInstance = null;
    }
    container = null;
    handler = null;
    currentShipment = null;
  }

  // --- Register ----------------------------------------------------------

  var page = {
    title: 'Track a Package',
    subtitle: 'Enter any tracking code to see live status',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('tracking', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.tracking = page;
  }

})(window);