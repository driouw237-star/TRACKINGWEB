/* GlobalExpress - pages/tracking.js
   In-app tracking page connected to Supabase.
*/

(function (global) {
  'use strict';

  var Pages = global.Pages || {};
  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var statusCls = Utils.statusCls || function (s) {
    return String(s || 'Pending').trim().replace(/\s+/g, '-');
  };
  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };

  // --- Module state ---
  var currentShipment = null;
  var mapInstance = null;
  var handler = null;
  var container = null;
  var deepLinkHandled = false;

  // --- Hero + search ---
  function heroSection() {
    return `
      <section class="hero" style="padding:44px 26px 100px;border-radius:16px;margin-bottom:0;background:linear-gradient(135deg,#0b2545,#1e3a8a);color:#fff;position:relative;">
        <div style="position:relative;z-index:1;text-align:center;">
          <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,0.15);padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.5px;margin-bottom:16px;">
            <span style="width:8px;height:8px;border-radius:50%;background:#10b981;"></span> Live tracking · Updated in real time
          </div>
          <h1 style="font-size:34px;font-weight:800;margin-bottom:12px;">Where is my <span style="color:#ff6b35;">package?</span></h1>
          <p style="font-size:15px;opacity:0.85;">Enter any tracking code — yours or a public one — to see live status.</p>
        </div>
      </section>
    `;
  }

  function searchSection(prefill) {
    return `
      <div class="search-wrap" style="margin-top:-60px;padding:0 22px;max-width:820px;margin-left:auto;margin-right:auto;position:relative;z-index:2;">
        <div class="search-card" style="background:var(--surface);border-radius:16px;box-shadow:0 12px 32px rgba(0,0,0,0.15);padding:12px;">
          <form class="search-form" id="tkForm" autocomplete="off" role="search" style="display:flex;gap:10px;">
            <div class="search-input-wrap" style="flex:1;position:relative;">
              <i class="fas fa-magnifying-glass leading" style="position:absolute;left:16px;top:16px;color:var(--text-3);"></i>
              <input type="text" id="tkCode" 
                placeholder="Enter tracking code (e.g. GE-A3B7-X9K2)" 
                autocomplete="off" spellcheck="false" autocapitalize="characters" 
                value="${esc(prefill || '')}" 
                style="width:100%;padding:14px 14px 14px 44px;border:1px solid var(--border);border-radius:10px;font-size:16px;font-family:monospace;text-transform:uppercase;" />
            </div>
            <button type="submit" class="btn btn-primary" id="tkBtn" style="padding:0 24px;font-size:15px;font-weight:700;border-radius:10px;white-space:nowrap;">
              Track Package
            </button>
          </form>
        </div>
      </div>
    `;
  }

  function loadingCard() {
    return `
      <div id="tkLoading" style="display:none;max-width:820px;margin:28px auto 0;padding:0 22px;text-align:center;">
        <div style="display:inline-flex;align-items:center;gap:12px;padding:16px 24px;background:var(--surface);border:1px solid var(--border);border-radius:12px;">
          <i class="fas fa-circle-notch fa-spin" style="color:var(--accent);font-size:20px;"></i>
          <div style="text-align:left;">
            <div style="font-weight:600;font-size:14px;">Looking up your shipment…</div>
            <div style="font-size:12px;color:var(--text-3);">This should only take a moment.</div>
          </div>
        </div>
      </div>
    `;
  }

  function errorCard() {
    return `
      <div id="tkError" style="display:none;max-width:820px;margin:28px auto 0;padding:0 22px;">
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;display:flex;gap:16px;align-items:flex-start;">
          <div style="width:40px;height:40px;border-radius:50%;background:#fff;color:#dc2626;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">
            <i class="fas fa-circle-exclamation"></i>
          </div>
          <div>
            <div style="font-weight:700;font-size:15px;color:#991b1b;margin-bottom:4px;">We couldn't find that tracking code</div>
            <div style="font-size:13px;color:#b91c1c;line-height:1.5;">
              Please double-check the code and try again. It usually looks like <strong>GE-XXXX-XXXX</strong>.
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function welcomeSection() {
    return `
      <section id="tkWelcome" style="margin-top:40px;padding:0 22px;max-width:820px;margin-left:auto;margin-right:auto;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;">
          <div class="panel" style="text-align:center;padding:24px;">
            <div style="width:48px;height:48px;border-radius:12px;background:#eff6ff;color:#2563eb;display:flex;align-items:center;justify-content:center;font-size:20px;margin:0 auto 12px;"><i class="fas fa-location-crosshairs"></i></div>
            <h4 style="font-size:15px;font-weight:700;margin-bottom:6px;">Live Location</h4>
            <p style="font-size:13px;color:var(--text-2);">Watch your package move in real time on an interactive map.</p>
          </div>
          <div class="panel" style="text-align:center;padding:24px;">
            <div style="width:48px;height:48px;border-radius:12px;background:#fff7ed;color:#ea580c;display:flex;align-items:center;justify-content:center;font-size:20px;margin:0 auto 12px;"><i class="fas fa-bolt"></i></div>
            <h4 style="font-size:15px;font-weight:700;margin-bottom:6px;">Instant Updates</h4>
            <p style="font-size:13px;color:var(--text-2);">Every scan, hold, and handover appears in seconds.</p>
          </div>
          <div class="panel" style="text-align:center;padding:24px;">
            <div style="width:48px;height:48px;border-radius:12px;background:#ecfdf5;color:#059669;display:flex;align-items:center;justify-content:center;font-size:20px;margin:0 auto 12px;"><i class="fas fa-shield-halved"></i></div>
            <h4 style="font-size:15px;font-weight:700;margin-bottom:6px;">Verified &amp; Secure</h4>
            <p style="font-size:13px;color:var(--text-2);">Tracking codes are unique and can't be guessed.</p>
          </div>
        </div>
      </section>
    `;
  }

  // --- Result section ---
  function resultSection(s) {
    var acts = (s.activities || []).slice().reverse();
    var cls = statusCls(s.status);
    
    var statusColor = s.status === 'Delivered' ? '#059669' : 
                      s.status === 'Pending' ? '#d97706' : 
                      s.status === 'Cancelled' ? '#dc2626' : '#2563eb';
    var statusBg = s.status === 'Delivered' ? '#ecfdf5' : 
                   s.status === 'Pending' ? '#fffbeb' : 
                   s.status === 'Cancelled' ? '#fef2f2' : '#eff6ff';

    return `
      <main id="tkResults" style="margin-top:36px;">
        <section class="panel" style="border-top:4px solid ${statusColor};margin-bottom:20px;">
          <div style="padding:24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:20px;">
            <div>
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-3);margin-bottom:6px;">Tracking Status</div>
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <span style="font-size:24px;font-weight:800;color:var(--text);">${esc(s.status)}</span>
                <span style="background:var(--surface-2);padding:6px 12px;border-radius:8px;font-family:monospace;font-size:14px;font-weight:700;letter-spacing:1px;border:1px solid var(--border);">${esc(s.tracking_code)}</span>
              </div>
              <div style="margin-top:12px;font-size:14px;font-weight:600;color:var(--text-2);">
                ${esc(s.origin_city)} &rarr; ${esc(s.dest_city)}
              </div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-3);margin-bottom:6px;">Estimated Delivery</div>
              <div style="font-size:18px;font-weight:800;color:var(--text);">${esc(s.estimated_delivery || 'TBD')}</div>
              <button type="button" class="btn btn-sm btn-outline" data-action="copy-code" style="margin-top:12px;"><i class="fas fa-copy"></i> Copy Code</button>
            </div>
          </div>
        </section>

        <section class="panel" style="margin-bottom:20px;">
          <div class="panel-header"><h3><i class="fas fa-route"></i> Delivery Progress</h3></div>
          <div class="panel-body">
            <div id="tkSteps" style="position:relative;display:flex;justify-content:space-between;"></div>
          </div>
        </section>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;">
          
          <div>
            <section class="panel" style="margin-bottom:20px;">
              <div class="panel-header"><h3><i class="fas fa-clock-rotate-left"></i> Shipment Activity</h3></div>
              <div class="panel-body">
                ${acts.length 
                  ? `<div class="timeline">${acts.map(function (a, i) {
                      return `
                        <div style="display:flex;gap:16px;margin-bottom:20px;">
                          <div style="width:12px;height:12px;border-radius:50%;background:${i === 0 ? statusColor : 'var(--border)'};margin-top:6px;flex-shrink:0;"></div>
                          <div>
                            <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;">${esc(a.date)}</div>
                            <div style="font-weight:600;font-size:14px;color:var(--text);margin-top:2px;">${esc(a.description)}</div>
                            <div style="font-size:13px;color:var(--text-2);margin-top:2px;"><i class="fas fa-location-dot"></i> ${esc(a.location)}</div>
                          </div>
                        </div>
                      `;
                    }).join('')}</div>`
                  : '<p style="color:var(--text-3);font-size:13px;text-align:center;padding:20px;">No activity yet.</p>'}
              </div>
            </section>

            <section class="panel">
              <div class="panel-header"><h3><i class="fas fa-box"></i> Package Details</h3></div>
              <div class="panel-body">
                ${infoBlock('Type', s.package_type)}
                ${infoBlock('Weight', s.weight)}
                ${infoBlock('Service', s.service_level)}
                ${s.contents ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">Contents</div><div style="font-weight:600;">${esc(s.contents)}</div></div>` : ''}
              </div>
            </section>
          </div>

          <div>
            <section class="panel" style="margin-bottom:20px;">
              <div class="panel-header"><h3><i class="fas fa-map-location-dot"></i> Live Map</h3></div>
              <div class="panel-body" style="padding:0;">
                <div id="tkMap" style="width:100%;height:280px;border-radius:0 0 12px 12px;background:#e5e7eb;"></div>
              </div>
            </section>

            <section class="panel">
              <div class="panel-header"><h3><i class="fas fa-users"></i> Shipment Parties</h3></div>
              <div class="panel-body">
                <div style="background:var(--surface-2);border-radius:10px;padding:16px;margin-bottom:12px;">
                  <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:4px;">Sender</div>
                  <div style="font-weight:600;font-size:14px;">${esc(s.sender_name || '—')}</div>
                  ${s.sender_address ? `<div style="font-size:12px;color:var(--text-2);margin-top:2px;">${esc(s.sender_address)}</div>` : ''}
                </div>
                <div style="background:var(--surface-2);border-radius:10px;padding:16px;">
                  <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:4px;">Recipient</div>
                  <div style="font-weight:600;font-size:14px;">${esc(s.receiver_name || '—')}</div>
                  ${s.receiver_address ? `<div style="font-size:12px;color:var(--text-2);margin-top:2px;">${esc(s.receiver_address)}</div>` : ''}
                  ${s.receiver_phone ? `<div style="font-size:12px;color:var(--text-2);margin-top:2px;"><i class="fas fa-phone"></i> ${esc(s.receiver_phone)}</div>` : ''}
                </div>
              </div>
            </section>
          </div>

        </div>

        <div style="display:flex;gap:10px;margin-top:24px;flex-wrap:wrap;">
          <button type="button" class="btn btn-outline" data-action="copy-link"><i class="fas fa-link"></i> Copy Share Link</button>
          <button type="button" class="btn btn-outline" data-action="reset"><i class="fas fa-rotate-right"></i> Track Another</button>
        </div>
      </main>
    `;
  }

  function infoBlock(label, value) {
    if (!value) return '';
    return `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed var(--border);">
        <span style="color:var(--text-3);font-size:13px;">${esc(label)}</span>
        <span style="font-weight:600;font-size:13px;">${esc(value)}</span>
      </div>
    `;
  }

  // --- Progress Stepper ---
  function buildSteps(status) {
    var s = String(status || '').toLowerCase();
    var stage = 0;
    if (s.indexOf('pending') >= 0) stage = 1;
    else if (s.indexOf('hold') >= 0) stage = 2;
    else if (s.indexOf('transit') >= 0) stage = 2;
    else if (s.indexOf('delivered') >= 0) stage = 4;
    else if (s.indexOf('cancel') >= 0) stage = 0;

    var defs = [
      { label: 'Processed',  icon: 'fa-clipboard-check' },
      { label: 'Picked Up',  icon: 'fa-box' },
      { label: 'In Transit', icon: 'fa-truck' },
      { label: 'Out for Delivery', icon: 'fa-truck-fast' },
      { label: 'Delivered',  icon: 'fa-circle-check' }
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
    var fillPct = ((doneCount + (activeCount ? 0.5 : 0)) / (steps.length - 1)) * 100;

    var host = document.getElementById('tkSteps');
    if (!host) return;

    host.innerHTML = `
      <div style="position:absolute;top:20px;left:30px;right:30px;height:4px;background:var(--border);border-radius:2px;z-index:0;">
        <div style="width:${Math.max(0, fillPct)}%;height:100%;background:var(--accent);border-radius:2px;"></div>
      </div>
      ${steps.map(function (st) {
        var bg = st.state === 'done' ? 'var(--accent)' : st.state === 'active' ? 'var(--surface)' : 'var(--surface-2)';
        var color = st.state === 'done' ? '#fff' : st.state === 'active' ? 'var(--accent)' : 'var(--text-3)';
        var border = st.state === 'active' ? '2px solid var(--accent)' : '2px solid var(--border)';
        return `
          <div style="display:flex;flex-direction:column;align-items:center;z-index:1;width:60px;text-align:center;">
            <div style="width:36px;height:36px;border-radius:50%;background:${bg};color:${color};border:${border};display:flex;align-items:center;justify-content:center;font-size:14px;margin-bottom:8px;">
              <i class="fas ${st.icon}"></i>
            </div>
            <div style="font-size:10px;font-weight:600;color:${st.state === 'pending' ? 'var(--text-3)' : 'var(--text)'};">${esc(st.label)}</div>
          </div>
        `;
      }).join('')}
    `;
  }

  // --- Map Mounting ---
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
        html: '<div style="width:36px;height:36px;border-radius:50%;background:' + color + ';' +
            'border:3px solid #fff;box-shadow:0 6px 16px rgba(0,0,0,.25);' +
            'display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px">' +
            '<i class="fas ' + icon + '"></i></div>',
        className: '', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18]
      });
    };

    var markers = [];
    if (valid(c.origin))  markers.push(global.L.marker([c.origin.lat, c.origin.lng], { icon: pin('#0b2545', 'fa-store') }).addTo(map).bindPopup('<strong>Origin</strong><br>' + esc(s.origin_city || '')));
    if (valid(c.current)) markers.push(global.L.marker([c.current.lat, c.current.lng], { icon: pin('#FF6B35', 'fa-truck') }).addTo(map).bindPopup('<strong>Current</strong><br>' + esc(s.current_location || '')));
    if (valid(c.dest))    markers.push(global.L.marker([c.dest.lat, c.dest.lng], { icon: pin('#059669', 'fa-flag-checkered') }).addTo(map).bindPopup('<strong>Destination</strong><br>' + esc(s.dest_city || '')));

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

  // --- Flow ---
  async function doTrack(code) {
    if (!code || !window.supabaseClient) return;

    // Reset UI
    document.getElementById('tkError').style.display = 'none';
    document.getElementById('tkLoading').style.display = 'block';
    document.getElementById('tkWelcome').style.display = 'none';
    
    var host = document.getElementById('tkResultHost');
    if (host) host.innerHTML = '';

    try {
      // Direct database query
      const { data, error } = await window.supabaseClient
        .schema('app')
        .from('shipments')
        .select('*')
        .eq('tracking_code', code.trim().toUpperCase())
        .single();

      document.getElementById('tkLoading').style.display = 'none';

      if (error || !data) {
        document.getElementById('tkError').style.display = 'block';
        return;
      }

      currentShipment = data;

      // Inject result
      if (host) host.innerHTML = resultSection(data);

      // Render stepper
      setTimeout(function() { renderSteps(data); }, 50);

      // Mount map
      setTimeout(function() { mountMap(data); }, 100);

      // Update URL
      try {
        var url = new URL(location.href);
        url.searchParams.set('track', data.tracking_code);
        history.replaceState({ track: data.tracking_code }, '', url.toString());
      } catch (e) {}

      toast('Shipment found', data.tracking_code, 'success');

    } catch (err) {
      console.error('Tracking failed:', err);
      document.getElementById('tkLoading').style.display = 'none';
      document.getElementById('tkError').style.display = 'block';
    }
  }

  function resetView() {
    var host = document.getElementById('tkResultHost');
    if (host) host.innerHTML = '';

    var welcome = document.getElementById('tkWelcome');
    if (welcome) welcome.style.display = '';

    var input = document.getElementById('tkCode');
    if (input) { input.value = ''; input.focus(); }

    document.getElementById('tkError').style.display = 'none';

    try {
      var url = new URL(location.href);
      url.searchParams.delete('track');
      history.replaceState({}, '', url.toString());
    } catch (e) {}

    if (mapInstance) {
      try { mapInstance.remove(); } catch (e) {}
      mapInstance = null;
    }
    currentShipment = null;
  }

  // --- Render ---
  function render(ctx) {
    var prefill = (ctx && ctx.params && ctx.params.code) || '';
    return `
      ${heroSection()}
      ${searchSection(prefill)}
      ${loadingCard()}
      ${errorCard()}
      <div id="tkResultHost"></div>
      ${welcomeSection()}
    `;
  }

  // --- Bind ---
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;
    if (handler) container.removeEventListener('click', handler);

    var deepLinkCode = ctx && ctx.params && ctx.params.code;

    // Search form
    var form = document.getElementById('tkForm');
    if (form) {
      form.removeEventListener('submit', function(){}); // Prevent duplicates
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = document.getElementById('tkCode');
        var code = (input && input.value || '').trim();
        if (!code) { toast('Enter a tracking code', '', 'error'); return; }
        doTrack(code);
      });
    }

    // Delegated clicks
    handler = function (e) {
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'reset') { resetView(); return; }

      if (action === 'copy-code' && currentShipment) {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(currentShipment.tracking_code).then(function () {
            toast('Code copied', currentShipment.tracking_code, 'success');
          });
        }
        return;
      }

      if (action === 'copy-link' && currentShipment) {
        var url = location.origin + location.pathname + '#tracking?track=' + encodeURIComponent(currentShipment.tracking_code);
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function () {
            toast('Link copied', '', 'success');
          });
        }
        return;
      }
    };

    container.addEventListener('click', handler);

    // Deep link handling
    if (deepLinkCode && !deepLinkHandled) {
      deepLinkHandled = true;
      var inp2 = document.getElementById('tkCode');
      if (inp2) inp2.value = deepLinkCode;
      setTimeout(function () { doTrack(deepLinkCode); }, 200);
    } else {
      deepLinkHandled = false;
    }
  }

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

  Pages['tracking'] = {
    title: 'Track a Package',
    subtitle: 'Enter any tracking code to see live status',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  global.Pages = Pages;

})(window);