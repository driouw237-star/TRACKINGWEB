/* ================================================================
   GlobalExpress — Customer App: Dashboard (Supabase + Mobile Optimized)
   File: js/pages/dashboard.js
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
        40% { transform: translateY(-10px); }
        60% { transform: translateY(-5px); }
      }
      .bouncy-btn {
        animation: geBounce 2s infinite;
        box-shadow: 0 0 20px rgba(250, 204, 21, 0.8);
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
  var fmtRelative = Utils.fmtRelative || function (d) {
    var ts = Date.parse(d); if (isNaN(ts)) return '—';
    var diff = Date.now() - ts, sec = Math.floor(diff/1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec/60); if (min < 60) return min + 'm ago';
    var hr = Math.floor(min/60); if (hr < 24) return hr + 'h ago';
    return Math.floor(hr/24) + 'd ago';
  };

  // ================================================================
  // STATE
  // ================================================================
  var state = {
    isLoading: true,
    shipments: [],
    stats: { total: 0, transit: 0, delivered: 0 },
    user: null
  };

  var container = null;
  var handler = null;

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  async function fetchData(user) {
    state.isLoading = true;
    state.user = user;
    
    if (!window.supabaseClient) return;

    try {
      const { data: shipments, error } = await window.supabaseClient
        .schema('app')
        .from('shipments')
        .select('*')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      state.shipments = shipments || [];
      state.stats = {
        total: state.shipments.length,
        transit: state.shipments.filter(function(s) { return s.status === 'In Transit'; }).length,
        delivered: state.shipments.filter(function(s) { return s.status === 'Delivered'; }).length
      };

    } catch (err) {
      console.error('Dashboard fetch failed:', err);
    } finally {
      state.isLoading = false;
      if (container) {
        container.innerHTML = render();
      }
    }
  }

  // ================================================================
  // RENDER HELPERS
  // ================================================================
  function renderRecentShipments() {
    if (state.isLoading) {
      return '<div style="padding:40px; text-align:center; color:var(--text-3);"><i class="fas fa-circle-notch fa-spin"></i> Loading...</div>';
    }

    if (state.shipments.length === 0) {
      return '<div class="recent-empty" style="padding: 40px 20px; text-align: center;">' +
        '<div style="font-size:32px; color:var(--border); margin-bottom:12px;"><i class="fas fa-box-open"></i></div>' +
        '<h4 style="margin-bottom: 8px;">No shipments yet</h4>' +
        '<p style="color:var(--text-3); font-size:13px; margin-bottom:16px;">You haven\'t sent any packages.</p>' +
        '<button class="btn btn-primary" onclick="App.go(\'create\')">Create Shipment</button>' +
      '</div>';
    }

    // Using responsive table structure
    var html = '<div style="overflow-x:auto; -webkit-overflow-scrolling: touch;">';
    html += '<table style="width:100%; min-width: 500px; text-align:left; border-collapse:collapse;">';
    html += '<thead><tr style="border-bottom:1px solid var(--border); color:var(--text-3); font-size:12px; text-transform:uppercase;">' +
      '<th style="padding:12px 20px;">Tracking</th>' +
      '<th style="padding:12px;">Route</th>' +
      '<th style="padding:12px;">Status</th>' +
      '<th style="padding:12px;">Date</th>' +
    '</tr></thead><tbody>';
    
    state.shipments.slice(0, 5).forEach(function(s) {
      var pCls = s.status === 'Delivered' ? 'Delivered' : 
                 s.status === 'Pending' ? 'Pending' : 
                 s.status === 'Cancelled' ? 'Cancelled' : 'In-Transit';
      
      html += '<tr style="border-bottom:1px solid var(--border); font-size:13px;">' +
        '<td style="padding:16px 20px; font-weight:700; font-family:monospace;">' + esc(s.tracking_code) + '</td>' +
        '<td>' + esc(s.origin_city) + ' &rarr; ' + esc(s.dest_city) + '</td>' +
        '<td><span class="pill ' + pCls + '">' + esc(s.status) + '</span></td>' +
        '<td style="color:var(--text-3); font-size:12px;">' + fmtRelative(s.created_at) + '</td>' +
      '</tr>';
    });
    
    html += '</tbody></table></div>';
    return html;
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render() {
    var user = state.user || {};
    var stats = state.stats;

    return `
      <style>
        /* Inline CSS to guarantee mobile responsiveness regardless of external files */
        .resp-dash { max-width: 1200px; margin: 0 auto; padding: 0 16px 40px; }
        .resp-greet { margin-bottom: 24px; }
        .resp-greet h1 { font-size: clamp(22px, 5vw, 28px); margin-bottom: 6px; }
        .resp-greet .sub { font-size: clamp(13px, 3.5vw, 15px); color: var(--text-2); }
        
        /* Wallet Hero */
        .resp-wallet { 
          background: linear-gradient(135deg,#0b2545 0%,#13315c 60%,#1e3a8a 100%); 
          border-radius: 16px; padding: clamp(20px, 5vw, 32px); color: #fff; 
          margin-bottom: 24px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 20px;
          box-shadow: 0 12px 32px rgba(11,37,69,.2);
        }
        .resp-wallet-bal { font-size: clamp(28px, 8vw, 44px); font-family: 'Manrope', sans-serif; font-weight: 800; line-height: 1.1; }
        .resp-wallet-bal small { font-size: clamp(16px, 4vw, 20px); opacity: 0.8; font-weight: 600; margin-right: 4px; }
        .resp-wallet-actions { display: flex; gap: 12px; flex-wrap: wrap; width: 100%; sm: width: auto; }
        .resp-wallet-actions .btn { flex: 1; min-width: 120px; justify-content: center; }
        
        /* Stats Grid */
        .resp-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-bottom: 32px; }
        .resp-stat { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
        .resp-stat-val { font-size: clamp(22px, 6vw, 28px); font-weight: 800; font-family: 'Manrope', sans-serif; color: var(--text); margin-top: 12px; }
        
        /* =======================================================
           ADVERTISEMENT / PRO BANNER STYLES (INSPIRED BY FLYER)
           ======================================================= */
        .pro-banner {
          background: #020617; /* Very dark navy/black */
          border-radius: 16px; padding: clamp(20px, 4vw, 24px);
          color: #fff; margin-bottom: 24px; border: 1px solid #1e293b;
          position: relative; overflow: hidden;
          display: flex; flex-direction: column; gap: 16px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.4);
        }
        /* Neon glowing orbs in background */
        .pro-banner::before {
          content: ''; position: absolute; top: -50%; right: -20%; width: 300px; height: 300px;
          background: radial-gradient(circle, rgba(59,130,246,0.3) 0%, transparent 70%);
          border-radius: 50%; pointer-events: none;
        }
        .pro-banner::after {
          content: ''; position: absolute; bottom: -50%; left: -10%; width: 250px; height: 250px;
          background: radial-gradient(circle, rgba(255,107,53,0.15) 0%, transparent 70%);
          border-radius: 50%; pointer-events: none;
        }
        
        .pro-banner-header { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 6px; }
        .pro-banner-eyebrow {
          font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;
          color: #38bdf8; display: flex; align-items: center; gap: 8px;
        }
        .pro-banner-eyebrow span { width: 6px; height: 6px; border-radius: 50%; background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }

        .pro-banner h3 { 
          color: #fff; font-size: clamp(20px, 4.5vw, 26px); 
          font-weight: 800; line-height: 1.1; letter-spacing: -0.02em; margin: 0;
        }
        .pro-banner h3 span {
          background: linear-gradient(90deg, #38bdf8, #818cf8);
          -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        
        /* The yellow brush stroke effect */
        .pro-banner-subtitle {
          display: inline-block; background: #facc15; color: #000;
          padding: 3px 10px; font-weight: 800; font-size: clamp(12px, 3vw, 14px);
          transform: rotate(-1deg); border-radius: 4px; margin-top: 6px; margin-bottom: 12px;
          align-self: flex-start; box-shadow: 2px 2px 0 rgba(0,0,0,0.5); font-style: italic;
        }

        .pro-banner p { color: #94a3b8; font-size: clamp(12px, 3vw, 14px); line-height: 1.5; margin-bottom: 16px; position: relative; z-index: 1; }
        .pro-banner strong { color: #fff; font-weight: 700; }

        /* Tags from the flyer */
        .pro-banner-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; position: relative; z-index: 1; }
        .pro-tag { 
          background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); 
          padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: 700; 
          color: #bae6fd; text-transform: uppercase; letter-spacing: 0.5px;
        }

        /* Action Buttons */
        .pro-actions { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; position: relative; z-index: 1; }
        .wa-btn { 
          background: #25D366; color: #fff; border: none; border-radius: 8px; 
          padding: 10px 18px; font-weight: 800; font-size: 12px; display: inline-flex; align-items: center; gap: 8px; 
          text-decoration: none; transition: all 0.2s; box-shadow: 0 4px 12px rgba(37, 211, 102, 0.3);
          text-transform: uppercase; letter-spacing: 0.5px;
        }
        .wa-btn:hover { background: #1da851; transform: translateY(-2px); color: #fff; box-shadow: 0 6px 16px rgba(37, 211, 102, 0.4); }
        
        /* =======================================================
           COMPACT DIGITAL SERVICES GRID
           ======================================================= */
        .service-hub-title {
          font-size: 16px; font-weight: 800; font-family: 'Manrope', sans-serif;
          margin: 24px 0 12px; display: flex; align-items: center; gap: 8px;
        }
        .service-hub-title span { color: var(--accent); }
        
        /* Changed to auto-fit, smaller minimum width for a tighter 3-4 column grid */
        .services-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 10px; margin-bottom: 32px;
        }
        .service-card {
          background: #0b2545; border: 1px solid #1e3a8a; border-radius: 10px;
          padding: 12px; color: #fff; display: flex; flex-direction: column; gap: 8px;
          position: relative; overflow: hidden; transition: transform 0.2s, box-shadow 0.2s;
        }
        .service-card:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(11,37,69,0.15); border-color: #3b82f6; }
        
        .service-card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        
        /* Shrunk icon */
        .service-icon {
          width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
          font-size: 14px; background: rgba(255,255,255,0.1); color: #fff;
        }
        
        /* Shrunk badge */
        .service-price {
          background: #facc15; color: #000; font-weight: 800; font-size: 10px;
          padding: 2px 8px; border-radius: 12px; white-space: nowrap;
        }
        
        .service-card h4 { margin: 0; font-size: 13px; font-weight: 700; color: #fff; line-height: 1.2; }
        .service-card p { margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.4; }
        .service-card .btn-text {
          margin-top: auto; background: none; border: none; color: #38bdf8; font-weight: 700;
          font-size: 11px; display: flex; align-items: center; gap: 4px; padding: 0; cursor: pointer;
          text-align: left;
        }
        .service-card .btn-text:hover { color: #bae6fd; text-decoration: underline; }
        
        /* Recent Panel */
        .resp-panel { background: #fff; border: 1px solid var(--border); border-radius: 16px; overflow: hidden; }
        .resp-panel-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border); }
        .resp-panel-head h3 { font-size: 15px; margin: 0; display: flex; align-items: center; gap: 8px; }
        
        /* Quick Actions */
        .resp-qa-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 32px; }
        .resp-qa-btn { 
          background: #fff; border: 1.5px solid var(--border); border-radius: 12px; padding: 16px; 
          display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; 
          cursor: pointer; transition: all 0.2s; 
        }
        .resp-qa-btn:hover { border-color: var(--accent); background: #fff7ed; transform: translateY(-2px); }
        .resp-qa-icon { width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #fff; background: var(--accent); }

        @media (max-width: 600px) {
          .services-grid { grid-template-columns: 1fr; }
        }
      </style>

      <div class="resp-dash">
        <div class="resp-greet">
          <h1>Good day, ${esc(user.name || 'Customer')} 👋</h1>
          <p class="sub">Here is what's happening with your shipments today.</p>
        </div>

        <!-- Wallet Hero -->
        <div class="resp-wallet">
          <div>
            <div style="font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; opacity: 0.7; font-weight: 700; margin-bottom: 8px;">Available Balance</div>
            <div class="resp-wallet-bal">
              <small>Fr.</small>${Number(user.wallet || 0).toLocaleString()}
            </div>
            <div style="font-size: 13px; opacity: 0.75; margin-top: 8px;">Safe, secure, and ready to use.</div>
          </div>
          <div class="resp-wallet-actions">
            <button class="btn" style="background:#fff;color:var(--brand);font-weight:700;" onclick="App.go('deposit')">
              <i class="fas fa-plus"></i> Deposit
            </button>
            <button class="btn" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);" onclick="App.go('create')">
              <i class="fas fa-truck-fast"></i> Ship Now
            </button>
          </div>
        </div>

        <!-- HIGH-CONVERTING AD BANNER (Flyer Style) -->
        <div class="pro-banner">
          <div class="pro-banner-header">
            <div class="pro-banner-eyebrow">
              <span></span> Fast • Secure • Reliable
            </div>
            <h3>Digital Services & <span>Online Solutions</span></h3>
            <div class="pro-banner-subtitle">We've got you covered!</div>
          </div>
          
          <p>Looking for reliable digital services at affordable prices? <strong>Message me to get tracking mails, websites for Kush, Pets, Cars, Bike Spare Parts</strong>, Google My Business, WhatsApp Accounts, VPNs, and more. We build high-converting platforms tailored to your business needs.</p>
          
          <div class="pro-banner-tags">
            <span class="pro-tag">Tracking Mails</span>
            <span class="pro-tag">Kush / Pets</span>
            <span class="pro-tag">Cars / Bikes</span>
            <span class="pro-tag">Spare Parts</span>
            <span class="pro-tag">E-commerce</span>
            <span class="pro-tag">Investment</span>
            <span class="pro-tag">Banking</span>
            <span class="pro-tag">All Tags Good</span>
          </div>
          
          <div class="pro-actions">
            
            <!-- BOUNCY GET 1200 BUTTON -->
            <a href="https://wa.me/23760199083?text=Hi,%20I%20want%20to%20claim%20my%203%20Free%20Shipping%20Codes%20(1200%20value)" 
               target="_blank" 
               class="bouncy-btn"
               style="background:#facc15; color:#000; border:2px solid #fff; border-radius:12px; padding:14px 24px; font-weight:900; font-size:16px; display:inline-flex; align-items:center; gap:10px; text-decoration:none; text-transform:uppercase; letter-spacing:0.5px;">
              <i class="fas fa-gift" style="font-size:20px;"></i> Get 1200 (3 Free Codes)
            </a>

            <a href="https://wa.me/23760199083" target="_blank" class="wa-btn">
              <i class="fab fa-whatsapp" style="font-size:16px;"></i> Message Me on WhatsApp
            </a>
            
            <div style="color:#cbd5e1; font-size:13px; font-weight:600; margin-left: 6px;">
              Or Call: <a href="tel:+23760199083" style="color:#fff; font-weight:700; text-decoration:underline;">601 990 83</a> / <a href="tel:+237671411728" style="color:#fff; font-weight:700; text-decoration:underline;">671 411 728</a>
            </div>
          </div>
        </div>

        <!-- Stats -->
        <div class="resp-stats">
          <div class="resp-stat">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="font-size: 12px; font-weight: 700; color: var(--text-3); text-transform: uppercase;">Total Shipments</div>
              <div style="width: 32px; height: 32px; border-radius: 8px; background: #eff6ff; color: var(--blue); display: flex; align-items: center; justify-content: center;"><i class="fas fa-box"></i></div>
            </div>
            <div class="resp-stat-val">${stats.total}</div>
          </div>
          <div class="resp-stat">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="font-size: 12px; font-weight: 700; color: var(--text-3); text-transform: uppercase;">In Transit</div>
              <div style="width: 32px; height: 32px; border-radius: 8px; background: #fff7ed; color: var(--accent); display: flex; align-items: center; justify-content: center;"><i class="fas fa-truck"></i></div>
            </div>
            <div class="resp-stat-val">${stats.transit}</div>
          </div>
          <div class="resp-stat">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="font-size: 12px; font-weight: 700; color: var(--text-3); text-transform: uppercase;">Delivered</div>
              <div style="width: 32px; height: 32px; border-radius: 8px; background: #ecfdf5; color: var(--green); display: flex; align-items: center; justify-content: center;"><i class="fas fa-check-circle"></i></div>
            </div>
            <div class="resp-stat-val">${stats.delivered}</div>
          </div>
        </div>

        <!-- COMPACT: Digital Services Grid -->
        <div class="service-hub-title">
          <i class="fas fa-bolt" style="color:var(--accent);"></i> Our Digital <span>Services</span>
        </div>
        <div class="services-grid">
          
          <!-- 1. Google My Business -->
          <div class="service-card">
            <div class="service-card-header">
              <div class="service-icon" style="color:#4285F4;"><i class="fab fa-google"></i></div>
              <div class="service-price">20K</div>
            </div>
            <h4>Google My Business</h4>
            <p>Boost your business online with Google.</p>
            <button class="btn-text" onclick="window.open('https://wa.me/23760199083?text=Hi,%20I%20am%20interested%20in%20Google%20My%20Business', '_blank')">Get Started <i class="fas fa-arrow-right"></i></button>
          </div>

          <!-- 2. Google Voice -->
          <div class="service-card">
            <div class="service-card-header">
              <div class="service-icon" style="color:#34A853;"><i class="fas fa-phone-alt"></i></div>
              <div class="service-price">7K</div>
            </div>
            <h4>Google Voice</h4>
            <p>Verification support for WhatsApp, Telegram & other platforms.</p>
            <button class="btn-text" onclick="window.open('https://wa.me/23760199083?text=Hi,%20I%20am%20interested%20in%20Google%20Voice', '_blank')">Get Started <i class="fas fa-arrow-right"></i></button>
          </div>

          <!-- 3. WhatsApp Accounts -->
          <div class="service-card">
            <div class="service-card-header">
              <div class="service-icon" style="color:#25D366;"><i class="fab fa-whatsapp"></i></div>
              <div class="service-price" style="background:#e2e8f0; color:#0f172a; font-size:9px;">All Countries 🌍</div>
            </div>
            <h4>WhatsApp Accounts</h4>
            <p>Get WhatsApp accounts from any country.</p>
            <button class="btn-text" onclick="window.open('https://wa.me/23760199083?text=Hi,%20I%20am%20interested%20in%20WhatsApp%20Accounts', '_blank')">Get Started <i class="fas fa-arrow-right"></i></button>
          </div>

          <!-- 4. Page Verification -->
          <div class="service-card">
            <div class="service-card-header">
              <div class="service-icon" style="color:#1877F2;"><i class="fab fa-facebook-f"></i></div>
            </div>
            <h4>Page Verification Services</h4>
            <p>Get your pages verified and build trust.</p>
            <button class="btn-text" onclick="window.open('https://wa.me/23760199083?text=Hi,%20I%20am%20interested%20in%20Page%20Verification', '_blank')">Get Started <i class="fas fa-arrow-right"></i></button>
          </div>

          <!-- 5. Website Development -->
          <div class="service-card">
            <div class="service-card-header">
              <div class="service-icon" style="color:#38bdf8;"><i class="fas fa-laptop-code"></i></div>
            </div>
            <h4>Website Development</h4>
            <p>Tracking & Refund websites. Message me to get websites for Kush, Pets, Cars, Bikes, Spare Parts etc.</p>
            <button class="btn-text" onclick="window.open('https://wa.me/23760199083?text=Hi,%20I%20need%20a%20website%20built', '_blank')">Message me to get website <i class="fas fa-arrow-right"></i></button>
          </div>

          <!-- 6. VPN Services -->
          <div class="service-card">
            <div class="service-card-header">
              <div class="service-icon" style="color:#818cf8;"><i class="fas fa-shield-alt"></i></div>
              <div class="service-price" style="background:#e2e8f0; color:#0f172a; font-size:9px;">Multiple Options</div>
            </div>
            <h4>VPN Services</h4>
            <p>Stay private, secure, and unrestricted.</p>
            <button class="btn-text" onclick="window.open('https://wa.me/23760199083?text=Hi,%20I%20am%20interested%20in%20VPN%20Services', '_blank')">Get Started <i class="fas fa-arrow-right"></i></button>
          </div>

          <!-- 7. Tracking Mails -->
          <div class="service-card">
            <div class="service-card-header">
              <div class="service-icon" style="color:#facc15;"><i class="fas fa-envelope-open-text"></i></div>
            </div>
            <h4>Tracking Mails</h4>
            <p>Message me to get all tracking mails set up and delivered securely.</p>
            <button class="btn-text" onclick="window.open('https://wa.me/23760199083?text=Hi,%20I%20am%20interested%20in%20Tracking%20Mails', '_blank')">Message me to get tracking mails <i class="fas fa-arrow-right"></i></button>
          </div>

          <!-- 8. eSIM (Monthly / Yearly) -->
          <div class="service-card">
            <div class="service-card-header">
              <div class="service-icon" style="color:#ec4899;"><i class="fas fa-sim-card"></i></div>
              <div class="service-price" style="background:#fce7f3; color:#9d174d; font-size:9px;">Monthly / Yearly</div>
            </div>
            <h4>eSIM Plans</h4>
            <p>Get connected instantly with flexible eSIM Monthly and Yearly data plans.</p>
            <button class="btn-text" onclick="window.open('https://wa.me/23760199083?text=Hi,%20I%20am%20interested%20in%20eSIM%20Monthly%20or%20Yearly%20plans', '_blank')">Get eSIM Plan <i class="fas fa-arrow-right"></i></button>
          </div>

        </div>

        <!-- Quick Actions -->
        <h3 style="font-size:15px; margin-bottom:12px; font-weight:700;">Quick Actions</h3>
        <div class="resp-qa-grid">
          <button class="resp-qa-btn" onclick="App.go('create')">
            <div class="resp-qa-icon"><i class="fas fa-plus"></i></div>
            <div style="font-size:13px; font-weight:700;">New Shipment</div>
          </button>
          <button class="resp-qa-btn" onclick="App.go('tracking')">
            <div class="resp-qa-icon" style="background: var(--blue);"><i class="fas fa-location-dot"></i></div>
            <div style="font-size:13px; font-weight:700;">Track Package</div>
          </button>
        </div>

        <!-- Recent Shipments -->
        <div class="resp-panel">
          <div class="resp-panel-head">
            <h3><i class="fas fa-clock-rotate-left" style="color:var(--accent);"></i> Recent Shipments</h3>
            <button class="btn btn-sm btn-outline" onclick="App.go('shipments')">View All</button>
          </div>
          <div>
             ${renderRecentShipments()}
          </div>
        </div>
      </div>
    `;
  }

  // ================================================================
  // LIFECYCLE & BIND
  // ================================================================
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    if (handler) container.removeEventListener('click', handler);

    handler = function (e) {
      // Inline onclicks handle the actions for this page
    };

    container.addEventListener('click', handler);

    if (state.isLoading && ctx.user) {
      fetchData(ctx.user);
    }
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler = null;
    state.isLoading = true;
    state.shipments = [];
  }

  Pages['dashboard'] = {
    title: 'Dashboard',
    subtitle: 'Welcome back to GlobalExpress',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  global.Pages = Pages;

})(window);