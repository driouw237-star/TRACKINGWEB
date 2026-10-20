/* GlobalExpress - pages/referrals.js
   Referrals page: unique code, shareable link, share buttons (WhatsApp,
   Email, SMS, Copy, QR), how-it-works, three stat cards, referrals list.

   Registers itself via App.register('referral', page).
   Reads from Store (users, payments). Writes only user.referralCode if
   missing.
*/
(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var Store = global.Store || {};

  // --- Fallbacks -----------------------------------------------------------

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var money = Utils.money || function (n) {
    return 'Fr. ' + Number(n || 0).toLocaleString();
  };

  var toast = UI.toast || function (t, m, k) { console.log('[toast]', t, m || '', k || ''); };

  // --- Constants -----------------------------------------------------------

  var REWARD = 500;   // Fr. per converted referral

  // --- Module state --------------------------------------------------------

  var qrOpen = false;
  var handler = null;
  var container = null;

  // --- Helpers -------------------------------------------------------------

  function currentUser(ctx) {
    return (ctx && ctx.user) || (global.App && global.App.state && global.App.state.user) || null;
  }

  function getAllUsers() {
    try { return Store.get('users') || []; } catch (e) { return []; }
  }

  function getAllPayments() {
    try { return Store.get('payments') || []; } catch (e) { return []; }
  }

  // Generate a referral code if the user doesn't have one
  function ensureReferralCode(user) {
    if (!user) return '';
    if (user.referralCode) return user.referralCode;

    var prefix = (user.name || 'USER').split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'USER';
    var suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    var code = prefix + suffix;

    // Persist
    if (Store.updateUser) {
      Store.updateUser({ referralCode: code });
    } else {
      var users = Store.get('users') || [];
      var i = users.findIndex(function (u) { return u.id === user.id; });
      if (i !== -1) { users[i].referralCode = code; Store.set('users', users); }
    }
    return code;
  }

  function buildShareUrl(code) {
    try {
      var base = location.origin + location.pathname;
      return base + '?ref=' + encodeURIComponent(code);
    } catch (e) {
      return '?ref=' + encodeURIComponent(code);
    }
  }

  // Find users referred by this code
  function getReferrals(userId, code) {
    var all = getAllUsers();
    return all.filter(function (u) {
      if (u.id === userId) return false;
      if (!u.referredBy) return false;
      return String(u.referredBy).toUpperCase() === String(code).toUpperCase();
    });
  }

  // Is a referred user "converted" (made at least one paid payment)?
  function isConverted(userId) {
    var all = getAllPayments();
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (p.userId === userId && p.status === 'Paid' && Math.abs(Number(p.amount || 0)) > 0) {
        return true;
      }
    }
    return false;
  }

  // --- Share helpers -------------------------------------------------------

  function copyToClipboard(text, label) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast((label || 'Copied'), text.length > 40 ? text.slice(0, 40) + '…' : text, 'success');
      }).catch(function () {
        toast('Copy failed', 'Please copy manually', 'error');
      });
    } else {
      // Fallback for old browsers
      var el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try { document.execCommand('copy'); toast((label || 'Copied'), '', 'success'); }
      catch (e) { toast('Copy failed', '', 'error'); }
      document.body.removeChild(el);
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

  function shareUrl(url) {
    // Prefer Web Share API on mobile
    if (navigator.share) {
      navigator.share({ title: 'GlobalExpress', text: 'Sign up with my code', url: url })
        .catch(function () { /* user cancelled — silent */ });
      return;
    }
    copyToClipboard(url, 'Link copied');
  }

  // --- QR ------------------------------------------------------------------

  function renderQrArea(url) {
    var area = document.getElementById('qrArea');
    if (!area) return;

    if (!qrOpen) { area.innerHTML = ''; return; }

    var qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(url);
    area.innerHTML = ''
      + '<div class="qr-box">'
      +   '<img src="' + esc(qrSrc) + '" alt="QR code" width="220" height="220" />'
      +   '<p>Scan to open the signup page</p>'
      + '</div>';
  }

  // --- Stat helper ---------------------------------------------------------

  function statCard(icon, color, value, label, trend, trendType) {
    var trendHtml = '';
    if (trend) {
      var arrow = trendType === 'up'   ? '<i class="fas fa-arrow-up"></i>'
                : trendType === 'down' ? '<i class="fas fa-arrow-down"></i>'
                :                        '<i class="fas fa-circle" style="font-size:6px"></i>';
      trendHtml = '<div class="stat-trend ' + esc(trendType || 'neutral') + '">'
                +   arrow + esc(trend)
                + '</div>';
    }
    return ''
      + '<div class="stat">'
      +   '<div class="stat-head">'
      +     '<div class="stat-label">' + esc(label) + '</div>'
      +     '<div class="stat-icon ' + esc(color) + '"><i class="fas ' + esc(icon) + '"></i></div>'
      +   '</div>'
      +   '<div class="stat-value">' + esc(value) + '</div>'
      +   trendHtml
      + '</div>';
  }

  // --- Referral row --------------------------------------------------------

  function referralRow(u, converted) {
    var initials = (u.name || 'U').charAt(0).toUpperCase();
    return ''
      + '<tr>'
      +   '<td>'
      +     '<div class="cell-user">'
      +       '<div class="av">' + esc(initials) + '</div>'
      +       '<div class="meta">'
      +         '<div class="name">' + esc(u.name || '—') + '</div>'
      +         '<div class="email">' + esc(u.email || '') + '</div>'
      +       '</div>'
      +     '</div>'
      +   '</td>'
      +   '<td style="font-size:12.5px;color:var(--text-3)">' + esc(u.joined || u.createdAt || '—') + '</td>'
      +   '<td>'
      +     (converted
              ? '<span class="pill Delivered">Converted</span>'
              : '<span class="pill Pending">Invited</span>')
      +   '</td>'
      +   '<td style="text-align:right;font-weight:700;color:' + (converted ? 'var(--green)' : 'var(--text-3)') + '">'
      +     (converted ? money(REWARD) : '—')
      +   '</td>'
      + '</tr>';
  }

  // --- Empty state ---------------------------------------------------------

  function emptyReferrals() {
    return ''
      + '<div class="empty">'
      +   '<div class="empty-illustration"><i class="fas fa-gift"></i></div>'
      +   '<h4>No referrals yet</h4>'
      +   '<p>Share your code with friends. When they sign up and make their first payment, you earn ' + money(REWARD) + '.</p>'
      +   '<button type="button" class="btn btn-primary" data-action="share-whatsapp">'
      +     '<i class="fab fa-whatsapp"></i> Share on WhatsApp'
      +   '</button>'
      + '</div>';
  }

  // --- Render --------------------------------------------------------------

  function render(ctx) {
    var user = currentUser(ctx);
    if (!user) return '<div class="panel"><div class="panel-body">Not signed in.</div></div>';

    var code = ensureReferralCode(user);
    var shareUrl = buildShareUrl(code);
    var referrals = getReferrals(user.id, code);

    // Compute stats
    var converted = 0;
    var earned = 0;
    referrals.forEach(function (u) {
      if (isConverted(u.id)) { converted++; earned += REWARD; }
    });

    // Hero
    var heroHtml = ''
      + '<div class="amount-banner purple" style="text-align:left">'
      +   '<div style="display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;position:relative;z-index:1">'
      +     '<div>'
      +       '<div class="lbl" style="opacity:.85">Referral Reward</div>'
      +       '<div class="amt" style="margin-top:4px">' + money(REWARD) + '</div>'
      +       '<div class="sub" style="opacity:.85;margin-top:6px">Earned per friend who signs up and makes their first payment.</div>'
      +     '</div>'
      +     '<div style="text-align:right">'
      +       '<div class="lbl" style="opacity:.85">Referrals Earned</div>'
      +       '<div class="amt" style="font-size:32px;margin-top:4px">' + esc(money(earned)) + '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>';

    // Code + link + share
    var shareHtml = ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-gift"></i> Share & Earn</h3>'
      +   '</div>'
      +   '<div class="panel-body">'

      +     // Code
      +     '<div style="margin-bottom:18px">'
      +       '<div style="font-size:12px;color:var(--text-3);text-transform:uppercase;letter-spacing:.8px;font-weight:700;margin-bottom:8px">Your Referral Code</div>'
      +       '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      +         '<input type="text" readonly value="' + esc(code) + '" '
      +           'style="flex:1;min-width:200px;padding:12px 14px;border:1.5px solid var(--border);'
      +           'border-radius:10px;background:var(--surface-2);font-family:\'Monaco\',monospace;'
      +           'font-weight:700;font-size:15px;letter-spacing:1.5px;color:var(--brand)" '
      +           'onclick="this.select()" />'
      +         '<button type="button" class="btn btn-outline" data-action="copy-code" data-value="' + esc(code) + '">'
      +           '<i class="fas fa-copy"></i> Copy Code'
      +         '</button>'
      +       '</div>'
      +     '</div>'

      +     // Link
      +     '<div style="margin-bottom:20px">'
      +       '<div style="font-size:12px;color:var(--text-3);text-transform:uppercase;letter-spacing:.8px;font-weight:700;margin-bottom:8px">Your Referral Link</div>'
      +       '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      +         '<input type="text" readonly value="' + esc(shareUrl) + '" '
      +           'style="flex:1;min-width:200px;padding:11px 13px;border:1.5px solid var(--border);'
      +           'border-radius:10px;background:var(--surface-2);font-size:12.5px;font-family:\'Monaco\',monospace" '
      +           'onclick="this.select()" />'
      +         '<button type="button" class="btn btn-outline" data-action="copy-link" data-value="' + esc(shareUrl) + '">'
      +           '<i class="fas fa-link"></i> Copy'
      +         '</button>'
      +       '</div>'
      +     '</div>'

      +     // Share grid
      +     '<div class="share-grid">'
      +       '<button type="button" class="share-btn whatsapp" data-action="share-whatsapp">'
      +         '<div class="ico"><i class="fab fa-whatsapp"></i></div>'
      +         '<div class="lbl">WhatsApp</div>'
      +       '</button>'
      +       '<button type="button" class="share-btn email" data-action="share-email">'
      +         '<div class="ico"><i class="fas fa-envelope"></i></div>'
      +         '<div class="lbl">Email</div>'
      +       '</button>'
      +       '<button type="button" class="share-btn sms" data-action="share-sms">'
      +         '<div class="ico"><i class="fas fa-comment-sms"></i></div>'
      +         '<div class="lbl">SMS</div>'
      +       '</button>'
      +       '<button type="button" class="share-btn copy" data-action="copy-link" data-value="' + esc(shareUrl) + '">'
      +         '<div class="ico"><i class="fas fa-copy"></i></div>'
      +         '<div class="lbl">Copy Link</div>'
      +       '</button>'
      +       '<button type="button" class="share-btn link" data-action="native-share">'
      +         '<div class="ico"><i class="fas fa-share-nodes"></i></div>'
      +         '<div class="lbl">Share</div>'
      +       '</button>'
      +       '<button type="button" class="share-btn qr" data-action="toggle-qr">'
      +         '<div class="ico"><i class="fas fa-qrcode"></i></div>'
      +         '<div class="lbl">QR Code</div>'
      +       '</button>'
      +     '</div>'

      +     '<div id="qrArea" style="margin-top:16px"></div>'

      +   '</div>'
      + '</div>';

    // How it works
    var howHtml = ''
      + '<div class="panel">'
      +   '<div class="panel-header"><h3><i class="fas fa-circle-info"></i> How It Works</h3></div>'
      +   '<div class="panel-body">'
      +     '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">'
      +       howStep('1', 'fa-share-nodes', 'Share your link', 'Send your code or link to friends.')
      +       howStep('2', 'fa-user-plus',    'They sign up',    'They create an account on GlobalExpress.')
      +       howStep('3', 'fa-gift',         'You get paid',    'Earn ' + money(REWARD) + ' after their first payment.')
      +     '</div>'
      +   '</div>'
      + '</div>';

    function howStep(num, icon, title, desc) {
      return ''
        + '<div style="text-align:center">'
        +   '<div style="width:56px;height:56px;margin:0 auto 12px;border-radius:16px;'
        +     'background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;'
        +     'display:flex;align-items:center;justify-content:center;font-size:22px;'
        +     'box-shadow:0 6px 18px rgba(124,58,237,.3)">'
        +     '<i class="fas ' + esc(icon) + '"></i>'
        +   '</div>'
        +   '<div style="font-family:\'Manrope\',sans-serif;font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px">'
        +     'Step ' + esc(num)
        +   '</div>'
        +   '<div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px">' + esc(title) + '</div>'
        +   '<div style="font-size:12.5px;color:var(--text-2);line-height:1.5">' + esc(desc) + '</div>'
        + '</div>';
    }

    // Stats
    var statsHtml = ''
      + '<div class="stats">'
      +   statCard('fa-user-plus', 'blue',   referrals.length, 'Invited',         '', 'neutral')
      +   statCard('fa-circle-check', 'green', converted,     'Converted',       '', 'neutral')
      +   statCard('fa-coins', 'purple',     money(earned),   'Rewards Earned',  '', 'neutral')
      + '</div>';

    // Referrals table
    var tableHtml = ''
      + '<div class="panel">'
      +   '<div class="panel-header">'
      +     '<h3><i class="fas fa-users"></i> Your Referrals (' + referrals.length + ')</h3>'
      +   '</div>';

    if (referrals.length) {
      tableHtml += ''
        + '<div class="tbl-wrap">'
        +   '<table class="table-cards">'
        +     '<thead>'
        +       '<tr>'
        +         '<th>Friend</th>'
        +         '<th>Joined</th>'
        +         '<th>Status</th>'
        +         '<th class="num">Reward</th>'
        +       '</tr>'
        +     '</thead>'
        +     '<tbody>'
        +       referrals.map(function (u) {
                return referralRow(u, isConverted(u.id));
              }).join('')
        +     '</tbody>'
        +   '</table>'
        + '</div>';
    } else {
      tableHtml += emptyReferrals();
    }

    tableHtml += '</div>';

    return heroHtml + shareHtml + howHtml + statsHtml + tableHtml;
  }

  // --- Bind ----------------------------------------------------------------

  function bind(ctx) {
    container = document.getElementById('content');
    if (!container) return;

    var user = currentUser(ctx);
    if (!user) return;

    var code = user.referralCode || '';
    var shareUrl = buildShareUrl(code);

    handler = function (e) {
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;

      if (action === 'copy-code') {
        copyToClipboard(btn.dataset.value, 'Code copied');
        return;
      }
      if (action === 'copy-link') {
        copyToClipboard(btn.dataset.value, 'Link copied');
        return;
      }

      var msg = 'Try GlobalExpress! Sign up with my code ' + code + ': ' + shareUrl;
      var subject = 'Try GlobalExpress — sign up with my code';

      if (action === 'share-whatsapp') {
        shareWhatsApp(msg);
        return;
      }
      if (action === 'share-email') {
        shareEmail(subject, msg);
        return;
      }
      if (action === 'share-sms') {
        shareSMS(msg);
        return;
      }
      if (action === 'native-share') {
        shareUrl(shareUrl);
        return;
      }
      if (action === 'toggle-qr') {
        qrOpen = !qrOpen;
        renderQrArea(shareUrl);
        return;
      }
    };

    container.addEventListener('click', handler);

    // Preserve QR state if it was open (rare — but nice touch)
    if (qrOpen) renderQrArea(shareUrl);
  }

  // --- Cleanup -------------------------------------------------------------

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null;
    handler = null;
    qrOpen = false;
  }

  // --- Register ------------------------------------------------------------

  var page = {
    title: 'Referrals',
    subtitle: 'Earn rewards for inviting friends',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

  if (global.App && typeof global.App.register === 'function') {
    global.App.register('referral', page);
  } else {
    global.Pages = global.Pages || {};
    global.Pages.referral = page;
  }

})(window);