/* ================================================================
   GlobalExpress — Admin Components Library
   ================================================================
   The foundation of the entire admin console. Every page uses
   these reusable UI primitives instead of writing its own HTML
   from scratch.

   This is the way real admin UIs are built — every component is
   tested once, styled once, and reused dozens of times.

   Depends on: window.Utils, window.UI
   Exposes:    window.AdminComponents
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  // -------- Fallbacks --------
  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };

  var money = Utils.money || function (n) {
    return 'Fr. ' + Math.abs(Number(n || 0)).toLocaleString('en-US');
  };

  var comma = Utils.comma || function (n) {
    return Number(n || 0).toLocaleString('en-US');
  };

  var fmtRelative = Utils.fmtRelative || function (d) {
    var ts = Date.parse(d);
    if (isNaN(ts)) return '—';
    var diff = Date.now() - ts;
    var sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec / 60); if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60); if (hr < 24) return hr + 'h ago';
    var day = Math.floor(hr / 24); if (day < 30) return day + 'd ago';
    var mo = Math.floor(day / 30); if (mo < 12) return mo + 'mo ago';
    return Math.floor(mo / 12) + 'y ago';
  };

  var fmtDate = Utils.fmtDate || function (d) {
    try {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return '—'; }
  };

  var toast = UI.toast || function (t, m) {
    if (global.console && console.log) console.log('[toast]', t, m || '');
  };

  // ================================================================
  // §1 — AVATARS
  // ================================================================

  function initials(name) {
    var s = String(name || '?').trim();
    if (!s) return '?';
    var parts = s.split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function avatarColor(name) {
    // Deterministic color based on name hash
    var palettes = [
      'linear-gradient(135deg, #0b2545, #13315c)', // navy
      'linear-gradient(135deg, #7c3aed, #a78bfa)', // purple
      'linear-gradient(135deg, #059669, #34d399)', // green
      'linear-gradient(135deg, #d97706, #fbbf24)', // amber
      'linear-gradient(135deg, #dc2626, #f87171)', // red
      'linear-gradient(135deg, #2563eb, #60a5fa)', // blue
      'linear-gradient(135deg, #ea580c, #fb923c)', // orange
      'linear-gradient(135deg, #be185d, #f472b6)'  // pink
    ];
    var hash = 0;
    var s = String(name || '');
    for (var i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash |= 0;
    }
    return palettes[Math.abs(hash) % palettes.length];
  }

  function avatar(name, options) {
    options = options || {};
    var size = options.size || 36;
    var fontSize = Math.round(size * 0.4);
    var color = options.color || avatarColor(name);
    var text = initials(name);

    return '<span style="' +
      'display:inline-flex;' +
      'align-items:center;' +
      'justify-content:center;' +
      'width:' + size + 'px;' +
      'height:' + size + 'px;' +
      'border-radius:50%;' +
      'background:' + color + ';' +
      'color:#fff;' +
      'font-family:Manrope,sans-serif;' +
      'font-weight:800;' +
      'font-size:' + fontSize + 'px;' +
      'flex-shrink:0;' +
      'letter-spacing:-0.02em;' +
      'user-select:none' +
    '">' + esc(text) + '</span>';
  }

  function avatarGroup(users, max) {
    max = max || 3;
    var shown = users.slice(0, max);
    var extra = users.length - shown.length;

    return '<span style="display:inline-flex;align-items:center">' +
      shown.map(function (u, i) {
        return '<span style="margin-left:' + (i === 0 ? '0' : '-8px') + ';' +
          'border:2px solid #fff;border-radius:50%;position:relative;' +
          'z-index:' + (10 - i) + '">' +
          avatar(u.name || u.email, { size: 30 }) +
        '</span>';
      }).join('') +
      (extra > 0
        ? '<span style="margin-left:-8px;display:inline-flex;align-items:center;' +
          'justify-content:center;width:30px;height:30px;border-radius:50%;' +
          'background:#e2e8f0;color:#475569;font-size:10px;font-weight:700;' +
          'border:2px solid #fff">+' + extra + '</span>'
        : '') +
    '</span>';
  }

  // ================================================================
  // §2 — PILLS & BADGES
  // ================================================================

  function statusPill(status) {
    if (!status) return '';
    var cls = String(status).replace(/\s+/g, '-');
    var label = String(status);

    var colors = {
      // Shipment statuses
      'Pending':    { bg: '#fef3c7', fg: '#92400e' },
      'In-Transit': { bg: '#dbeafe', fg: '#1e40af' },
      'On-Hold':    { bg: '#fed7aa', fg: '#9a3412' },
      'Delivered':  { bg: '#d1fae5', fg: '#065f46' },
      'Cancelled':  { bg: '#fee2e2', fg: '#991b1b' },
      // Payment statuses
      'Paid':       { bg: '#d1fae5', fg: '#065f46' },
      'Unpaid':     { bg: '#fee2e2', fg: '#991b1b' },
      'Failed':     { bg: '#fee2e2', fg: '#991b1b' },
      'Refunded':   { bg: '#ede9fe', fg: '#5b21b6' },
      // Payment kinds
      'Deposit':    { bg: '#dbeafe', fg: '#1e40af' },
      'Shipment':   { bg: '#ffedd5', fg: '#9a3412' },
      'Refund':     { bg: '#ede9fe', fg: '#5b21b6' },
      'Withdrawal': { bg: '#fee2e2', fg: '#991b1b' },
      'Adjustment': { bg: '#f1f5f9', fg: '#475569' },
      'Charge':     { bg: '#ffedd5', fg: '#9a3412' },
      // Ticket statuses
      'Open':       { bg: '#dbeafe', fg: '#1e40af' },
      'Closed':     { bg: '#f1f5f9', fg: '#475569' },
      'Resolved':   { bg: '#d1fae5', fg: '#065f46' },
      'Waiting':    { bg: '#fef3c7', fg: '#92400e' }
    };
    var c = colors[cls] || colors[status] || { bg: '#f1f5f9', fg: '#475569' };

    return '<span style="' +
      'display:inline-flex;' +
      'align-items:center;' +
      'padding:3px 10px;' +
      'border-radius:999px;' +
      'background:' + c.bg + ';' +
      'color:' + c.fg + ';' +
      'font-size:11px;' +
      'font-weight:700;' +
      'letter-spacing:0.3px;' +
      'text-transform:uppercase;' +
      'white-space:nowrap;' +
      'line-height:1.5' +
    '">' + esc(label) + '</span>';
  }

  function rolePill(role) {
    var r = String(role || 'user').toLowerCase();
    var colors = {
      admin:   { bg: '#fee2e2', fg: '#991b1b', border: '#fecaca' },
      support: { bg: '#e0e7ff', fg: '#3730a3', border: '#c7d2fe' },
      finance: { bg: '#dbeafe', fg: '#1e40af', border: '#bfdbfe' },
      auditor: { bg: '#f3f4f6', fg: '#374151', border: '#e5e7eb' },
      user:    { bg: '#f1f5f9', fg: '#475569', border: '#e2e8f0' }
    };
    var labels = {
      admin: 'Admin', support: 'Support', finance: 'Finance',
      auditor: 'Auditor', user: 'Customer'
    };
    var c = colors[r] || colors.user;

    return '<span style="' +
      'display:inline-flex;' +
      'align-items:center;' +
      'padding:3px 9px;' +
      'border-radius:6px;' +
      'background:' + c.bg + ';' +
      'color:' + c.fg + ';' +
      'border:1px solid ' + c.border + ';' +
      'font-size:10.5px;' +
      'font-weight:700;' +
      'letter-spacing:0.5px;' +
      'text-transform:uppercase;' +
      'white-space:nowrap' +
    '">' + esc(labels[r] || 'Customer') + '</span>';
  }

  function priorityPill(priority) {
    var p = String(priority || 'Normal').toLowerCase();
    var colors = {
      low:    { bg: '#f1f5f9', fg: '#475569' },
      normal: { bg: '#dbeafe', fg: '#1e40af' },
      high:   { bg: '#ffedd5', fg: '#9a3412' },
      urgent: { bg: '#fee2e2', fg: '#991b1b' }
    };
    var c = colors[p] || colors.normal;

    return '<span style="' +
      'display:inline-flex;align-items:center;padding:3px 9px;' +
      'border-radius:6px;background:' + c.bg + ';color:' + c.fg + ';' +
      'font-size:10.5px;font-weight:700;letter-spacing:0.4px;' +
      'text-transform:uppercase;white-space:nowrap' +
    '">' + esc(priority || 'Normal') + '</span>';
  }

  function amountBadge(amount, options) {
    options = options || {};
    var num = Number(amount || 0);
    var positive = num >= 0;
    var sign = positive ? '+' : '-';
    var color = positive ? '#059669' : '#dc2626';
    var showSign = options.showSign !== false;

    return '<span style="' +
      'font-family:Manrope,sans-serif;' +
      'font-weight:800;' +
      'font-variant-numeric:tabular-nums;' +
      'color:' + color + ';' +
      'font-size:' + (options.size || 13) + 'px' +
    '">' +
      (showSign ? sign : '') + money(Math.abs(num)) +
    '</span>';
  }

  // ================================================================
  // §3 — KPI CARD
  // ================================================================

  function kpiCard(opts) {
    opts = opts || {};
    var trend = opts.trend || null;
    var trendHtml = '';

    if (trend) {
      var dir = trend.direction || 'flat';
      var arrows = {
        up:   '<i class="fas fa-arrow-up"></i>',
        down: '<i class="fas fa-arrow-down"></i>',
        flat: '<i class="fas fa-minus"></i>'
      };
      var colors = { up: '#059669', down: '#dc2626', flat: '#94a3b8' };
      var arrow = arrows[dir] || arrows.flat;

      trendHtml = '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px">' +
        '<span style="display:inline-flex;align-items:center;gap:4px;' +
          'color:' + colors[dir] + ';font-weight:700">' +
          arrow + ' ' + esc(String(trend.value)) +
        '</span>' +
        (trend.label ? '<span style="color:#94a3b8">' + esc(trend.label) + '</span>' : '') +
      '</div>';
    }

    var sparklineHtml = '';
    if (opts.sparkline && opts.sparkline.length > 1) {
      sparklineHtml = '<div class="kpi-card-sparkline" style="position:absolute;bottom:0;left:0;right:0;' +
        'height:48px;opacity:0.35;pointer-events:none">' +
        (global.UtilsPro && UtilsPro.generateSparkline
          ? UtilsPro.generateSparkline(opts.sparkline, { stroke: opts.sparklineColor || '#dc2626' })
          : '') +
      '</div>';
    }

    var clickable = !!opts.view;
    var tag = clickable ? 'button' : 'div';
    var attrs = clickable
      ? ' type="button" data-action="kpi-go" data-view="' + esc(opts.view) + '"'
      : '';

    return '<' + tag + attrs + ' class="kpi-card" style="' +
      'position:relative;overflow:hidden;text-align:left;' +
      'background:#fff;border:1px solid #e3e8ef;border-radius:14px;' +
      'padding:20px 22px;display:flex;flex-direction:column;gap:4px;' +
      'cursor:' + (clickable ? 'pointer' : 'default') + ';' +
      'font-family:inherit;width:100%;transition:all 0.2s ease;' +
      (clickable ? '' : 'pointer-events:none;') +
    '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">' +
        '<div style="font-size:11.5px;font-weight:700;letter-spacing:0.8px;' +
          'text-transform:uppercase;color:#94a3b8">' +
          esc(opts.label || '') +
        '</div>' +
        (opts.icon
          ? '<div style="width:38px;height:38px;border-radius:10px;' +
            'display:flex;align-items:center;justify-content:center;' +
            'font-size:16px;flex-shrink:0;background:' +
            (opts.iconBg || '#eff6ff') + ';color:' +
            (opts.iconColor || '#2563eb') + '">' +
            '<i class="fas ' + esc(opts.icon) + '"></i></div>'
          : '') +
      '</div>' +
      '<div style="font-family:Manrope,sans-serif;font-size:30px;font-weight:800;' +
        'letter-spacing:-0.03em;color:#0f172a;line-height:1.1;margin:4px 0">' +
        (opts.valueHtml || esc(opts.value || '0')) +
      '</div>' +
      trendHtml +
      (opts.comparison
        ? '<div style="font-size:11.5px;color:#94a3b8;margin-top:4px">' +
          esc(opts.comparison) + '</div>'
        : '') +
      sparklineHtml +
    '</' + tag + '>';
  }

  // ================================================================
  // §4 — INFO CARD
  // ================================================================

  function infoCard(opts) {
    opts = opts || {};
    var rows = opts.rows || [];

    return '<div style="background:#fff;border:1px solid #e3e8ef;' +
      'border-radius:12px;overflow:hidden">' +
      '<div style="padding:16px 20px;border-bottom:1px solid #eef1f5;' +
        'display:flex;align-items:center;justify-content:space-between">' +
        '<h3 style="margin:0;font-family:Manrope,sans-serif;font-size:14px;' +
          'font-weight:700;color:#0f172a;display:flex;align-items:center;gap:8px">' +
          (opts.icon ? '<i class="fas ' + esc(opts.icon) + '" style="color:#dc2626;font-size:13px"></i>' : '') +
          esc(opts.title || 'Details') +
        '</h3>' +
      '</div>' +
      '<div style="padding:4px 0">' +
        rows.map(function (r) {
          return '<div style="display:flex;justify-content:space-between;' +
            'padding:10px 20px;border-bottom:1px solid #f1f5f9;font-size:13px">' +
            '<span style="color:#64748b;font-weight:600">' + esc(r.label) + '</span>' +
            '<span style="color:#0f172a;font-weight:600;text-align:right;' +
              'max-width:60%;word-break:break-word">' +
              (r.html || esc(r.value || '—')) +
            '</span>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }

  // ================================================================
  // §5 — SECTION TITLE
  // ================================================================

  function sectionTitle(opts) {
    opts = opts || {};
    return '<div style="display:flex;align-items:center;justify-content:space-between;' +
      'padding:16px 20px;border-bottom:1px solid #eef1f5">' +
      '<h3 style="margin:0;font-family:Manrope,sans-serif;font-size:14.5px;' +
        'font-weight:700;color:#0f172a;display:flex;align-items:center;gap:9px">' +
        (opts.icon ? '<i class="fas ' + esc(opts.icon) + '" style="color:#dc2626;font-size:13.5px"></i>' : '') +
        esc(opts.title || '') +
      '</h3>' +
      (opts.actionHtml || '') +
    '</div>';
  }

  // ================================================================
  // §6 — EMPTY STATE
  // ================================================================

  function emptyState(opts) {
    opts = opts || {};
    return '<div style="text-align:center;padding:48px 24px;display:flex;' +
      'flex-direction:column;align-items:center;gap:8px">' +
      '<div style="width:72px;height:72px;border-radius:50%;background:#fafbfc;' +
        'border:1px solid #eef1f5;display:inline-flex;align-items:center;' +
        'justify-content:center;font-size:26px;color:#94a3b8;margin-bottom:8px">' +
        '<i class="fas ' + esc(opts.icon || 'fa-inbox') + '"></i>' +
      '</div>' +
      '<h4 style="margin:0;font-family:Manrope,sans-serif;font-size:15px;' +
        'font-weight:700;color:#0f172a">' +
        esc(opts.title || 'Nothing here yet') +
      '</h4>' +
      (opts.message
        ? '<p style="margin:0 0 12px;font-size:13px;color:#475569;' +
          'max-width:400px;line-height:1.55">' + esc(opts.message) + '</p>'
        : '') +
      (opts.actionHtml || '') +
    '</div>';
  }

  // ================================================================
  // §7 — TIMELINE
  // ================================================================

  function timeline(events, options) {
    options = options || {};
    if (!events || events.length === 0) {
      return emptyState({ icon: 'fa-clock', title: 'No activity', message: 'Events will appear here.' });
    }

    return '<div style="padding:16px 20px;display:flex;flex-direction:column;gap:0">' +
      events.map(function (e, i) {
        var isLast = i === events.length - 1;
        var dotColor = e.color || '#2563eb';
        return '<div style="display:flex;gap:14px;position:relative;' +
          'padding-bottom:' + (isLast ? '0' : '20px') + '">' +
          '<div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">' +
            '<div style="width:12px;height:12px;border-radius:50%;' +
              'background:' + dotColor + ';border:3px solid #fff;' +
              'box-shadow:0 0 0 1px ' + dotColor + ';z-index:2"></div>' +
            (!isLast
              ? '<div style="width:2px;flex:1;background:#e2e8f0;margin-top:4px;min-height:30px"></div>'
              : '') +
          '</div>' +
          '<div style="flex:1;min-width:0;padding-bottom:4px">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">' +
              '<div style="font-weight:600;font-size:13.5px;color:#0f172a">' +
                esc(e.title || '') +
              '</div>' +
              '<div style="font-size:11px;color:#94a3b8;white-space:nowrap">' +
                esc(e.time ? fmtRelative(e.time) : '') +
              '</div>' +
            '</div>' +
            (e.description
              ? '<div style="font-size:12.5px;color:#475569;margin-top:3px;' +
                'line-height:1.5">' + esc(e.description) + '</div>'
              : '') +
            (e.location
              ? '<div style="font-size:11.5px;color:#94a3b8;margin-top:3px">' +
                '<i class="fas fa-location-dot"></i> ' + esc(e.location) + '</div>'
              : '') +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  // ================================================================
  // §8 — ACTIVITY FEED
  // ================================================================

  function activityFeed(items, options) {
    options = options || {};
    if (!items || items.length === 0) {
      return emptyState({
        icon: 'fa-list',
        title: 'No recent activity',
        message: 'Actions will appear here.'
      });
    }

    return '<div>' +
      items.map(function (it) {
        var clickable = !!it.view;
        var tag = clickable ? 'button' : 'div';
        var attrs = clickable ? ' type="button" data-action="feed-go" data-view="' + esc(it.view) + '"' +
          (it.params ? ' data-params=\'' + JSON.stringify(it.params) + '\'' : '') : '';

        return '<' + tag + attrs + ' style="' +
          'display:flex;align-items:center;gap:12px;padding:12px 20px;' +
          'border-bottom:1px solid #f1f5f9;background:' + (clickable ? 'transparent' : 'transparent') + ';' +
          'border-left:none;border-right:none;border-top:none;' +
          'width:100%;text-align:left;font-family:inherit;' +
          'cursor:' + (clickable ? 'pointer' : 'default') + ';' +
          'transition:background-color 0.12s' +
        '" onmouseover="this.style.background=\'#fafbfc\'" ' +
           'onmouseout="this.style.background=\'transparent\'">' +
          // Avatar or icon
          (it.avatar
            ? avatar(it.avatar, { size: 36 })
            : '<div style="width:36px;height:36px;border-radius:10px;' +
              'display:flex;align-items:center;justify-content:center;' +
              'font-size:14px;flex-shrink:0;background:' +
              (it.iconBg || '#eff6ff') + ';color:' + (it.iconColor || '#2563eb') + '">' +
              '<i class="fas ' + esc(it.icon || 'fa-circle') + '"></i></div>') +
          // Content
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px;font-weight:600;color:#0f172a;' +
              'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
              esc(it.title || '') +
            '</div>' +
            (it.subtitle
              ? '<div style="font-size:11.5px;color:#94a3b8;margin-top:2px;' +
                'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
                esc(it.subtitle) + '</div>'
              : '') +
          '</div>' +
          // Meta (amount, time, etc.)
          (it.amount
            ? '<div style="flex-shrink:0">' + amountBadge(it.amount) + '</div>'
            : '') +
          (it.time
            ? '<div style="font-size:11px;color:#94a3b8;white-space:nowrap;flex-shrink:0">' +
              esc(fmtRelative(it.time)) + '</div>'
            : '') +
        '</' + tag + '>';
      }).join('') +
    '</div>';
  }

  // ================================================================
  // §9 — FORM FIELDS
  // ================================================================

  function field(opts) {
    opts = opts || {};
    var type = opts.type || 'text';
    var id = opts.id || ('fld_' + Math.random().toString(36).slice(2, 8));
    var required = opts.required ? '<span style="color:#dc2626;margin-left:2px">*</span>' : '';
    var error = opts.error
      ? '<div style="font-size:11.5px;color:#dc2626;font-weight:600;margin-top:4px">' +
        '<i class="fas fa-circle-exclamation"></i> ' + esc(opts.error) + '</div>'
      : '';

    return '<div class="field" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">' +
      (opts.label
        ? '<label for="' + esc(id) + '" style="font-size:12.5px;font-weight:600;color:#475569">' +
          esc(opts.label) + required + '</label>'
        : '') +
      (type === 'textarea'
        ? '<textarea id="' + esc(id) + '" name="' + esc(opts.name || '') + '" ' +
          'placeholder="' + esc(opts.placeholder || '') + '" ' +
          (opts.rows ? 'rows="' + opts.rows + '"' : '') +
          (opts.readonly ? ' readonly' : '') +
          ' style="width:100%;padding:10px 13px;border:1.5px solid #e3e8ef;' +
          'border-radius:9px;font-size:13.5px;font-family:inherit;outline:none;' +
          'resize:vertical;min-height:90px;line-height:1.55;' +
          (opts.error ? 'border-color:#dc2626;' : '') + '">' +
          esc(opts.value || '') +
        '</textarea>'
        : '<input type="' + esc(type) + '" id="' + esc(id) + '" name="' + esc(opts.name || '') + '" ' +
          'value="' + esc(opts.value || '') + '" ' +
          'placeholder="' + esc(opts.placeholder || '') + '" ' +
          (opts.readonly ? ' readonly' : '') +
          (opts.disabled ? ' disabled' : '') +
          ' style="width:100%;padding:10px 13px;border:1.5px solid #e3e8ef;' +
          'border-radius:9px;font-size:13.5px;font-family:inherit;outline:none;' +
          (opts.error ? 'border-color:#dc2626;' : '') + '" />') +
      (opts.hint
        ? '<div style="font-size:11.5px;color:#94a3b8;line-height:1.45">' +
          esc(opts.hint) + '</div>'
        : '') +
      error +
    '</div>';
  }

  function select(opts) {
    opts = opts || {};
    var id = opts.id || ('sel_' + Math.random().toString(36).slice(2, 8));
    var required = opts.required ? '<span style="color:#dc2626;margin-left:2px">*</span>' : '';

    return '<div class="field" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">' +
      (opts.label
        ? '<label for="' + esc(id) + '" style="font-size:12.5px;font-weight:600;color:#475569">' +
          esc(opts.label) + required + '</label>'
        : '') +
      '<select id="' + esc(id) + '" name="' + esc(opts.name || '') + '" ' +
        'style="width:100%;padding:10px 13px;border:1.5px solid #e3e8ef;' +
        'border-radius:9px;font-size:13.5px;font-family:inherit;outline:none;' +
        'background:#fff;cursor:pointer">' +
        (opts.options || []).map(function (o) {
          return '<option value="' + esc(o.value) + '"' +
            (String(o.value) === String(opts.value) ? ' selected' : '') + '>' +
            esc(o.label) +
          '</option>';
        }).join('') +
      '</select>' +
      (opts.hint
        ? '<div style="font-size:11.5px;color:#94a3b8">' + esc(opts.hint) + '</div>'
        : '') +
    '</div>';
  }

  function toggle(opts) {
    opts = opts || {};
    var id = opts.id || ('tgl_' + Math.random().toString(36).slice(2, 8));
    var checked = opts.checked ? ' checked' : '';

    return '<label for="' + esc(id) + '" style="display:inline-flex;align-items:center;gap:10px;' +
      'cursor:pointer;font-size:13.5px;color:#0f172a;user-select:none">' +
      '<span style="position:relative;width:40px;height:22px;display:inline-block">' +
        '<input type="checkbox" id="' + esc(id) + '" name="' + esc(opts.name || '') + '"' + checked +
          ' style="position:absolute;opacity:0;width:0;height:0" />' +
        '<span style="position:absolute;top:0;left:0;right:0;bottom:0;' +
          'background:' + (opts.checked ? '#dc2626' : '#cbd5e1') + ';' +
          'border-radius:999px;transition:background-color 0.18s"></span>' +
        '<span style="position:absolute;top:2px;left:' + (opts.checked ? '20px' : '2px') + ';' +
          'width:18px;height:18px;border-radius:50%;background:#fff;' +
          'box-shadow:0 1px 3px rgba(0,0,0,0.15);' +
          'transition:left 0.18s"></span>' +
      '</span>' +
      '<span>' + esc(opts.label || '') + '</span>' +
    '</label>';
  }

  function checkbox(opts) {
    opts = opts || {};
    var id = opts.id || ('chk_' + Math.random().toString(36).slice(2, 8));
    return '<label for="' + esc(id) + '" style="display:inline-flex;align-items:center;gap:8px;' +
      'cursor:pointer;font-size:13px;color:#0f172a;user-select:none">' +
      '<input type="checkbox" id="' + esc(id) + '" name="' + esc(opts.name || '') + '"' +
        (opts.checked ? ' checked' : '') +
        ' style="width:16px;height:16px;accent-color:#dc2626;cursor:pointer;margin:0" />' +
      '<span>' + esc(opts.label || '') + '</span>' +
    '</label>';
  }

  function formRow(fields, options) {
    options = options || {};
    var cols = options.cols || 2;
    return '<div style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);' +
      'gap:' + (options.gap || '14px 16px') + '">' +
      fields.map(function (f) {
        return '<div' + (f.full ? ' style="grid-column:1/-1"' : '') + '>' + f.html + '</div>';
      }).join('') +
    '</div>';
  }

  function buttonRow(buttons, options) {
    options = options || {};
    return '<div style="display:flex;gap:10px;justify-content:' +
      (options.align || 'flex-end') + ';flex-wrap:wrap;margin-top:' +
      (options.marginTop || '12px') + '">' +
      (buttons || []).map(function (b) {
        var variant = b.variant || 'outline';
        return '<button type="button" class="btn btn-' + variant + (b.size ? ' btn-' + b.size : '') + '"' +
          (b.id ? ' id="' + esc(b.id) + '"' : '') +
          (b.action ? ' data-action="' + esc(b.action) + '"' : '') +
          (b.disabled ? ' disabled' : '') + '>' +
          (b.icon ? '<i class="fas ' + esc(b.icon) + '"></i> ' : '') +
          esc(b.label) +
        '</button>';
      }).join('') +
    '</div>';
  }

  // ================================================================
  // §10 — MODALS
  // ================================================================

  function confirmModal(opts) {
    opts = opts || {};
    if (!UI.confirm) {
      return Promise.resolve(global.confirm && global.confirm(opts.message || 'Confirm?'));
    }
    return UI.confirm({
      title: opts.title || 'Are you sure?',
      message: opts.message || '',
      confirmText: opts.confirmText || 'Confirm',
      cancelText: opts.cancelText || 'Cancel',
      variant: opts.variant || 'warning'
    });
  }

  function formModal(opts) {
    return new Promise(function (resolve) {
      opts = opts || {};
      if (!UI.openModal) {
        resolve(null);
        return;
      }

      var wrap = UI.openModal(
        '<div class="modal narrow" style="max-width:' + (opts.width || '520px') + '">' +
          '<div class="modal-head">' +
            '<div>' +
              '<h3>' + (opts.icon ? '<i class="fas ' + esc(opts.icon) + '"></i> ' : '') +
                esc(opts.title || 'Form') + '</h3>' +
              (opts.subtitle
                ? '<div class="sub" style="font-size:12.5px;color:#64748b;margin-top:4px">' +
                  esc(opts.subtitle) + '</div>'
                : '') +
            '</div>' +
            '<button type="button" class="modal-close" data-form-cancel>' +
              '<i class="fas fa-times"></i></button>' +
          '</div>' +
          '<div class="modal-body">' +
            (opts.fieldsHtml || '') +
          '</div>' +
          '<div class="modal-foot">' +
            '<button type="button" class="btn btn-outline" data-form-cancel>' +
              esc(opts.cancelText || 'Cancel') + '</button>' +
            '<button type="button" class="btn btn-' + (opts.confirmVariant || 'primary') + '" ' +
              'data-form-submit>' +
              (opts.confirmIcon ? '<i class="fas ' + esc(opts.confirmIcon) + '"></i> ' : '') +
              esc(opts.confirmText || 'Save') +
            '</button>' +
          '</div>' +
        '</div>'
      );

      if (!wrap) { resolve(null); return; }

      var settled = false;
      function finish(result) {
        if (settled) return;
        settled = true;
        if (UI.closeModal) UI.closeModal(wrap);
        resolve(result);
      }

      wrap.addEventListener('click', function (e) {
        if (e.target.closest('[data-form-cancel]')) { finish(null); return; }
        if (e.target.closest('[data-form-submit]')) {
          var values = {};
          wrap.querySelectorAll('input, select, textarea').forEach(function (el) {
            if (el.name) values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
          });

          // Optional validation
          var errors = [];
          if (opts.validators) {
            Object.keys(opts.validators).forEach(function (name) {
              var validate = opts.validators[name];
              var err = validate(values[name]);
              if (err) errors.push({ name: name, message: err });
            });
          }

          if (errors.length > 0) {
            toast('Validation error', errors[0].message, 'error');
            return;
          }

          var submitResult = opts.onSubmit ? opts.onSubmit(values) : values;
          if (submitResult === false) return; // submit handler blocked

          finish(values);
        }
      });
    });
  }

  function reauthModal(reason) {
    return new Promise(function (resolve) {
      if (global.AdminAuth && global.AdminAuth.requirePassword) {
        global.AdminAuth.requirePassword(reason).then(resolve);
      } else {
        resolve(global.confirm ? global.confirm(reason || 'Confirm action?') : false);
      }
    });
  }

  // ================================================================
  // §11 — SIMPLE TABLE (lightweight for small lists)
  // ================================================================

  function simpleTable(columns, rows, options) {
    options = options || {};

    if (!rows || rows.length === 0) {
      return emptyState({
        icon: options.emptyIcon || 'fa-inbox',
        title: options.emptyTitle || 'No data',
        message: options.emptyMessage || ''
      });
    }

    return '<div style="width:100%;overflow-x:auto">' +
      '<table style="width:100%;border-collapse:collapse;font-size:13.5px">' +
        '<thead><tr>' +
          columns.map(function (c) {
            return '<th style="text-align:left;padding:11px 16px;font-size:11px;' +
              'font-weight:700;letter-spacing:0.6px;text-transform:uppercase;' +
              'color:#94a3b8;background:#fafbfc;border-bottom:1px solid #e3e8ef;' +
              'white-space:nowrap">' + esc(c.label) + '</th>';
          }).join('') +
        '</tr></thead>' +
        '<tbody>' +
          rows.map(function (row) {
            return '<tr>' +
              columns.map(function (c) {
                var val = typeof c.render === 'function' ? c.render(row) : esc(row[c.key] || '');
                return '<td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;' +
                  (c.align ? 'text-align:' + c.align + ';' : '') + '">' +
                  val + '</td>';
              }).join('') +
            '</tr>';
          }).join('') +
        '</tbody>' +
      '</table>' +
    '</div>';
  }

  // ================================================================
  // §12 — LOADERS
  // ================================================================

  function skeleton(type) {
    var styles = {
      text:   'height:14px;width:80%;border-radius:6px',
      value:  'height:32px;width:60%;border-radius:8px;margin:8px 0',
      icon:   'width:38px;height:38px;border-radius:10px',
      avatar: 'width:36px;height:36px;border-radius:50%',
      card:   'height:120px;width:100%;border-radius:12px'
    };
    var style = styles[type] || styles.text;
    return '<div style="' + style + ';background:linear-gradient(90deg,#f1f5f9 0%,#e2e8f0 50%,#f1f5f9 100%);' +
      'background-size:1000px 100%;animation:shimmer 1.5s infinite"></div>';
  }

  function spinner(size) {
    size = size || 24;
    return '<div style="display:inline-block;width:' + size + 'px;height:' + size + 'px;' +
      'border:2.5px solid #e2e8f0;border-top-color:#dc2626;border-radius:50%;' +
      'animation:spin 0.8s linear infinite"></div>';
  }

  // ================================================================
  // §13 — STAT BAR
  // ================================================================

  function statBar(opts) {
    opts = opts || {};
    var pct = opts.max > 0 ? Math.round((opts.value / opts.max) * 100) : 0;
    var color = opts.color || '#dc2626';

    return '<div>' +
      '<div style="display:flex;justify-content:space-between;font-size:12.5px;' +
        'font-weight:600;margin-bottom:6px">' +
        '<span style="color:#475569">' + esc(opts.label) + '</span>' +
        '<span style="color:#0f172a">' + comma(opts.value) + ' (' + pct + '%)</span>' +
      '</div>' +
      '<div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:' + color + ';' +
          'border-radius:4px;transition:width 0.4s ease"></div>' +
      '</div>' +
    '</div>';
  }

  // ================================================================
  // §14 — COPY BUTTON
  // ================================================================

  function copyButton(text, options) {
    options = options || {};
    var id = 'cpy_' + Math.random().toString(36).slice(2, 8);
    var label = options.label || '';

    return '<button type="button" id="' + id + '" ' +
      'style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;' +
      'background:transparent;border:1px solid transparent;border-radius:6px;' +
      'color:#475569;font-family:inherit;font-size:12px;font-weight:600;' +
      'cursor:pointer;transition:all 0.15s" ' +
      'onmouseover="this.style.background=\'#f1f5f9\'" ' +
      'onmouseout="this.style.background=\'transparent\'" ' +
      'data-copy-text="' + esc(text) + '">' +
      '<i class="fas fa-copy" style="font-size:11px"></i>' +
      (label ? ' ' + esc(label) : '') +
    '</button>';
  }

  // Global click handler for copy buttons
  if (!document.__adminCopyWired) {
    document.__adminCopyWired = true;
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-copy-text]');
      if (!btn) return;
      var text = btn.getAttribute('data-copy-text');
      if (Utils.copy) {
        Utils.copy(text).then(function (ok) {
          if (ok) toast('Copied', 'Copied to clipboard', 'success');
          else toast('Failed', 'Copy failed', 'error');
        });
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () {
          toast('Copied', 'Copied to clipboard', 'success');
        });
      }
    });
  }

  // ================================================================
  // §15 — RELATIVE TIME
  // ================================================================

  function relativeTime(date) {
    return '<span title="' + esc(fmtDate(date)) + '">' + esc(fmtRelative(date)) + '</span>';
  }

  // ================================================================
  // §16 — EXPOSE
  // ================================================================

  var AdminComponents = {
    // Avatars
    avatar: avatar,
    avatarGroup: avatarGroup,

    // Pills
    statusPill: statusPill,
    rolePill: rolePill,
    priorityPill: priorityPill,
    amountBadge: amountBadge,

    // Cards
    kpiCard: kpiCard,
    infoCard: infoCard,
    sectionTitle: sectionTitle,

    // Lists
    emptyState: emptyState,
    timeline: timeline,
    activityFeed: activityFeed,

    // Forms
    field: field,
    select: select,
    toggle: toggle,
    checkbox: checkbox,
    formRow: formRow,
    buttonRow: buttonRow,

    // Modals
    confirmModal: confirmModal,
    formModal: formModal,
    reauthModal: reauthModal,

    // Tables
    simpleTable: simpleTable,

    // Loaders
    skeleton: skeleton,
    spinner: spinner,

    // Misc
    statBar: statBar,
    copyButton: copyButton,
    relativeTime: relativeTime,

    // Internals (for advanced use)
    _initials: initials,
    _avatarColor: avatarColor
  };

  global.AdminComponents = AdminComponents;
  global.AC = AdminComponents; // shorthand

})(window);