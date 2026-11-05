/* GlobalExpress - pages/referrals.js
   Referrals page connected to Supabase.
*/

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };

  var REWARD = 1000; // Default reward, could be fetched from config
  var qrOpen = false;
  var rawReferrals = [];
  var isLoading = true;
  var handler = null;
  var container = null;

  function currentUser(ctx) {
    return (ctx && ctx.user) || (global.App && global.App.state && global.App.state.user) || null;
  }

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  async function fetchReferralData(user) {
    if (!window.supabaseClient) return;
    isLoading = true;

    try {
      // Fetch global reward amount
      const { data: setting } = await window.supabaseClient
        .schema('config')
        .from('settings')
        .select('value')
        .eq('key', 'referrals.bonusAmount')
        .single();
      
      if (setting && setting.value) REWARD = Number(setting.value);

      // Fetch referrals and join the referee's user data
      const { data, error } = await window.supabaseClient
        .schema('app')
        .from('referrals')
        .select(`
          id, status, signed_up_at, 
          users!referrals_referee_id_fkey ( full_name, email )
        `)
        .eq('referrer_id', user.id)
        .order('signed_up_at', { ascending: false });

      if (error) throw error;
      rawReferrals = data || [];

    } catch (err) {
      console.error('Failed to load referrals:', err);
    } finally {
      isLoading = false;
      if (container) {
        container.innerHTML = render({ user: user });
        bind({ user: user });
      }
    }
  }

  // ================================================================
  // SHARE HELPERS
  // ================================================================
  function copyToClipboard(text, label) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast((label || 'Copied'), '', 'success');
      }).catch(function () {
        toast('Copy failed', 'Please copy manually', 'error');
      });
    }
  }

  function shareWhatsApp(msg) {
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }

  function shareEmail(subject, body) {
    window.open('mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body), '_blank');
  }

  function shareSMS(msg) {
    window.open('sms:?body=' + encodeURIComponent(msg), '_blank');
  }

  function renderQrArea(url) {
    var area = document.getElementById('qrArea');
    if (!area) return;
    if (!qrOpen) { area.innerHTML = ''; return; }

    var qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(url);
    area.innerHTML = `
      <div style="text-align:center;padding:20px;background:var(--surface-2);border-radius:12px;">
        <img src="${esc(qrSrc)}" alt="QR code" width="220" height="220" style="border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);" />
        <p style="font-size:13px;color:var(--text-2);margin-top:12px;">Scan to open the signup page</p>
      </div>
    `;
  }

  // ================================================================
  // RENDER
  // ================================================================
  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    var code = user.referralCode || user.referral_code || 'LOADING...';
    var shareUrl = window.location.origin + '/portal.html?ref=' + encodeURIComponent(code);

    // Compute stats
    var converted = 0;
    var earned = 0;
    rawReferrals.forEach(function (r) {
      if (r.status === 'qualified') { converted++; earned += REWARD; }
    });

    var heroHtml = `
      <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);border-radius:16px;padding:24px;color:#fff;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:20px;box-shadow:0 8px 24px rgba(124,58,237,0.3);">
        <div>
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:700;opacity:0.85;">Referral Reward</div>
          <div style="font-size:36px;font-weight:800;margin-top:4px;">${money(REWARD)}</div>
          <div style="font-size:13px;opacity:0.85;margin-top:4px;">Per friend who makes their first deposit.</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:700;opacity:0.85;">Total Earned</div>
          <div style="font-size:32px;font-weight:800;margin-top:4px;">${money(earned)}</div>
        </div>
      </div>
    `;

    var shareHtml = `
      <div class="panel" style="margin-bottom:24px;">
        <div class="panel-header"><h3><i class="fas fa-gift"></i> Share & Earn</h3></div>
        <div class="panel-body">
          
          <div style="margin-bottom:20px;">
            <label style="display:block;font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Your Referral Code</label>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <input type="text" readonly value="${esc(code)}" style="flex:1;min-width:200px;padding:12px 14px;border:1.5px solid var(--border);border-radius:10px;background:var(--surface-2);font-family:monospace;font-weight:700;font-size:16px;letter-spacing:1.5px;color:var(--accent);" onclick="this.select()" />
              <button type="button" class="btn btn-outline" data-action="copy-code" data-value="${esc(code)}"><i class="fas fa-copy"></i> Copy Code</button>
            </div>
          </div>

          <div style="margin-bottom:24px;">
            <label style="display:block;font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Your Referral Link</label>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <input type="text" readonly value="${esc(shareUrl)}" style="flex:1;min-width:200px;padding:12px 14px;border:1.5px solid var(--border);border-radius:10px;background:var(--surface-2);font-size:13px;font-family:monospace;" onclick="this.select()" />
              <button type="button" class="btn btn-outline" data-action="copy-link" data-value="${esc(shareUrl)}"><i class="fas fa-link"></i> Copy</button>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(100px, 1fr));gap:12px;">
            <button type="button" class="btn btn-outline" data-action="share-whatsapp" style="flex-direction:column;padding:16px;height:auto;border-radius:12px;gap:8px;">
              <i class="fab fa-whatsapp" style="font-size:24px;color:#25D366;"></i>
              <span style="font-size:12px;font-weight:600;">WhatsApp</span>
            </button>
            <button type="button" class="btn btn-outline" data-action="share-email" style="flex-direction:column;padding:16px;height:auto;border-radius:12px;gap:8px;">
              <i class="fas fa-envelope" style="font-size:24px;color:var(--blue);"></i>
              <span style="font-size:12px;font-weight:600;">Email</span>
            </button>
            <button type="button" class="btn btn-outline" data-action="share-sms" style="flex-direction:column;padding:16px;height:auto;border-radius:12px;gap:8px;">
              <i class="fas fa-comment-sms" style="font-size:24px;color:var(--amber);"></i>
              <span style="font-size:12px;font-weight:600;">SMS</span>
            </button>
            <button type="button" class="btn btn-outline" data-action="toggle-qr" style="flex-direction:column;padding:16px;height:auto;border-radius:12px;gap:8px;">
              <i class="fas fa-qrcode" style="font-size:24px;color:var(--text);"></i>
              <span style="font-size:12px;font-weight:600;">QR Code</span>
            </button>
          </div>

          <div id="qrArea" style="margin-top:20px;"></div>
        </div>
      </div>
    `;

    var howHtml = `
      <div class="panel" style="margin-bottom:24px;">
        <div class="panel-header"><h3><i class="fas fa-circle-info"></i> How It Works</h3></div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;">
            ${howStep('1', 'fa-share-nodes', 'Share your link', 'Send your code to friends.')}
            ${howStep('2', 'fa-user-plus', 'They sign up', 'They create an account on GlobalExpress.')}
            ${howStep('3', 'fa-gift', 'You get paid', `Earn ${money(REWARD)} after their first deposit.`)}
          </div>
        </div>
      </div>
    `;

    var tableHtml = `
      <div class="panel">
        <div class="panel-header"><h3><i class="fas fa-users"></i> Your Referrals (${rawReferrals.length})</h3></div>
        ${isLoading ? `<div style="padding:40px;text-align:center;color:var(--text-3);"><i class="fas fa-circle-notch fa-spin"></i> Loading...</div>` :
          rawReferrals.length === 0 ? emptyReferrals() :
          `<div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;text-align:left;">
              <thead>
                <tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">
                  <th style="padding:12px 20px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Friend</th>
                  <th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Joined</th>
                  <th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Status</th>
                  <th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;text-align:right;">Reward</th>
                </tr>
              </thead>
              <tbody>
                ${rawReferrals.map(r => referralRow(r)).join('')}
              </tbody>
            </table>
          </div>`
        }
      </div>
    `;

    return heroHtml + shareHtml + howHtml + tableHtml;
  }

  function howStep(num, icon, title, desc) {
    return `
      <div style="text-align:center;">
        <div style="width:56px;height:56px;margin:0 auto 12px;border-radius:16px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 6px 18px rgba(124,58,237,.3);">
          <i class="fas ${esc(icon)}"></i>
        </div>
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px;">Step ${esc(num)}</div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px;">${esc(title)}</div>
        <div style="font-size:12.5px;color:var(--text-2);line-height:1.5;">${esc(desc)}</div>
      </div>
    `;
  }

  function referralRow(r) {
    var name = r.users ? (r.users.full_name || r.users.email) : 'Unknown Friend';
    var initial = name.charAt(0).toUpperCase();
    var isQualified = r.status === 'qualified';
    
    return `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:16px 20px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:36px;height:36px;border-radius:50%;background:var(--surface-2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;">${esc(initial)}</div>
            <div>
              <div style="font-weight:600;font-size:14px;">${esc(name)}</div>
            </div>
          </div>
        </td>
        <td style="font-size:12.5px;color:var(--text-3);">${new Date(r.signed_up_at).toLocaleDateString()}</td>
        <td>
          <span class="pill ${isQualified ? 'Delivered' : 'Pending'}">${isQualified ? 'Qualified' : 'Invited'}</span>
        </td>
        <td style="text-align:right;font-weight:700;color:${isQualified ? 'var(--green)' : 'var(--text-3)'};">
          ${isQualified ? money(REWARD) : '—'}
        </td>
      </tr>
    `;
  }

  function emptyReferrals() {
    return `
      <div style="padding:60px 20px;text-align:center;">
        <div style="font-size:32px;color:var(--border);margin-bottom:12px;"><i class="fas fa-gift"></i></div>
        <h4 style="margin-bottom:8px;">No referrals yet</h4>
        <p style="color:var(--text-3);font-size:13px;margin-bottom:16px;">Share your code with friends. When they sign up and make their first deposit, you earn ${money(REWARD)}.</p>
        <button type="button" class="btn btn-primary" data-action="share-whatsapp"><i class="fab fa-whatsapp"></i> Share on WhatsApp</button>
      </div>
    `;
  }

  // ================================================================
  // BIND
  // ================================================================
  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    var user = currentUser(ctx);
    if (isLoading && user) {
      fetchReferralData(user);
      return;
    }

    var code = user.referralCode || user.referral_code || '';
    var shareUrl = window.location.origin + '/portal.html?ref=' + encodeURIComponent(code);

    if (handler) container.removeEventListener('click', handler);
    handler = function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'copy-code') { copyToClipboard(btn.dataset.value, 'Code copied'); return; }
      if (action === 'copy-link') { copyToClipboard(btn.dataset.value, 'Link copied'); return; }

      var msg = 'Try GlobalExpress! Sign up with my code ' + code + ': ' + shareUrl;
      var subject = 'Try GlobalExpress — sign up with my code';

      if (action === 'share-whatsapp') { shareWhatsApp(msg); return; }
      if (action === 'share-email') { shareEmail(subject, msg); return; }
      if (action === 'share-sms') { shareSMS(msg); return; }
      if (action === 'toggle-qr') {
        qrOpen = !qrOpen;
        renderQrArea(shareUrl);
        return;
      }
    };
    container.addEventListener('click', handler);

    if (qrOpen) renderQrArea(shareUrl);
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null; handler = null; qrOpen = false;
    rawReferrals = []; isLoading = true;
  }

  var page = {
    title: 'Referrals',
    subtitle: 'Earn rewards for inviting friends',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('referrals', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.referrals = page;
  }

})(window);