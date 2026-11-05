/* ================================================================
   GlobalExpress — Admin Payment Detail (Supabase)
   File: js/payment-detail.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var Admin = global.Admin || null;

  var esc   = Utils.esc   || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var fmtDT = Utils.fmtDT || function (d) { return new Date(d || Date.now()).toLocaleString(); };
  var toast = UI.toast    || function (t, m) { if (global.console) console.log(t, m); };

  var state = {
    payment: null,
    customer: null,
    auditLogs: [],
    activePanel: 'details',
    isLoading: true
  };

  var handler = null;
  var container = null;
  var currentId = null;

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  function getPaymentId(ctx) {
    if (ctx && ctx.params && ctx.params.id) return String(ctx.params.id);
    return localStorage.getItem('ge_admin_current_payment');
  }

  async function loadData(id) {
    if (!window.supabaseClient) return;
    currentId = id;
    state.isLoading = true;

    try {
      // 1. Fetch the payment + user details
      const { data: payment, error: payErr } = await window.supabaseClient
        .schema('app')
        .from('payments')
        .select('*, users ( id, full_name, email, wallet )')
        .eq('id', id)
        .single();

      if (payErr) throw payErr;
      
      state.payment = payment;
      state.customer = payment.users;

      // 2. Fetch audit logs for this payment or user
      const { data: logs, error: logErr } = await window.supabaseClient
        .schema('audit')
        .from('logs')
        .select('*')
        .or(`target.eq.payment:${id},target.eq.user:${payment.user_id}`)
        .order('created_at', { ascending: false });

      if (!logErr) {
        state.auditLogs = logs || [];
      }

    } catch (err) {
      console.error('Failed to load payment details:', err);
      state.payment = null;
    } finally {
      state.isLoading = false;
      if (container) {
        container.innerHTML = render({ params: { id: currentId } });
        bind();
      }
    }
  }

  // ================================================================
  // RENDER HELPERS
  // ================================================================
  function renderHeader() {
    var p = state.payment;
    return '<div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">' +
      '<div style="display:flex;align-items:center;gap:16px;">' +
        '<button type="button" class="btn btn-outline btn-sm" data-action="go-back"><i class="fas fa-arrow-left"></i> Back</button>' +
        '<div>' +
          '<h2 style="margin:0;font-family:Manrope,sans-serif;font-weight:800;font-size:24px;display:flex;align-items:center;gap:12px;">' +
            'Transaction Details ' +
            '<span class="pill ' + esc(p.status) + '">' + esc(p.status) + '</span>' +
          '</h2>' +
          '<div style="font-size:13px;color:var(--text-3);margin-top:4px;">Reference: <code class="mono">' + esc(p.id) + '</code></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderTabs() {
    var isActive = state.activePanel === 'details';
    return '<div class="users-tabs-bar" style="border-bottom:2px solid var(--border);display:flex;margin-bottom:24px;background:var(--surface);border-radius:12px 12px 0 0;padding:0 12px;">' +
      '<button type="button" class="users-tab ' + (isActive ? 'active' : '') + '" data-panel="details" style="padding:16px 20px;border:none;background:none;cursor:pointer;font-weight:600;font-size:13.5px;color:' + (isActive ? 'var(--text)' : 'var(--text-3)') + ';border-bottom:2.5px solid ' + (isActive ? 'var(--accent)' : 'transparent') + ';margin-bottom:-2px;"><i class="fas fa-file-invoice"></i> Details & Edit</button>' +
      '<button type="button" class="users-tab ' + (!isActive ? 'active' : '') + '" data-panel="timeline" style="padding:16px 20px;border:none;background:none;cursor:pointer;font-weight:600;font-size:13.5px;color:' + (!isActive ? 'var(--text)' : 'var(--text-3)') + ';border-bottom:2.5px solid ' + (!isActive ? 'var(--accent)' : 'transparent') + ';margin-bottom:-2px;"><i class="fas fa-clock-rotate-left"></i> Audit Timeline</button>' +
    '</div>';
  }

  function renderDetailsPanel() {
    var p = state.payment;
    var u = state.customer || { full_name: 'Unknown User', email: '—', id: p.user_id, wallet: 0 };

    var isPositive = p.amount >= 0;
    var amountColor = isPositive ? 'var(--green)' : 'var(--red)';

    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">' +
      
      // LEFT: Receipt Overview
      '<div class="panel" style="border-top:4px solid var(--accent);">' +
        '<div class="panel-header"><h3><i class="fas fa-receipt"></i> Receipt Overview</h3></div>' +
        '<div class="panel-body">' +
          '<div style="text-align:center;margin-bottom:24px;padding:24px;background:var(--surface-2);border-radius:12px;border:1px solid var(--border);">' +
            '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:1px;">Total Amount</div>' +
            '<div style="font-family:Manrope,sans-serif;font-size:42px;font-weight:800;color:' + amountColor + ';margin:8px 0;">' + money(p.amount) + '</div>' +
            '<span class="pill ' + esc(p.status) + '" style="font-size:12px;padding:4px 12px;">' + esc(p.status) + '</span>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:12px;margin-bottom:24px;">' +
            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed var(--border);">' +
              '<span style="color:var(--text-3);font-size:13px;">Date & Time</span>' +
              '<span style="font-weight:600;font-size:13px;color:var(--text);">' + esc(fmtDT(p.created_at)) + '</span>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed var(--border);">' +
              '<span style="color:var(--text-3);font-size:13px;">Method</span>' +
              '<span style="font-weight:600;font-size:13px;color:var(--text);">' + esc(p.method) + '</span>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed var(--border);">' +
              '<span style="color:var(--text-3);font-size:13px;">Kind</span>' +
              '<span style="font-weight:600;font-size:13px;color:var(--text);">' + esc(p.kind) + '</span>' +
            '</div>' +
          '</div>' +
          '<div style="background:var(--surface-2);border-radius:10px;padding:16px;border:1px solid var(--border);">' +
            '<div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:12px;"><i class="fas fa-user"></i> Customer</div>' +
            '<div style="font-weight:700;font-size:14px;color:var(--text);">' + esc(u.full_name) + '</div>' +
            '<div style="font-size:12.5px;color:var(--text-2);margin-bottom:12px;">' + esc(u.email) + '</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--green);margin-bottom:12px;">Balance: ' + money(u.wallet || 0) + '</div>' +
            '<div style="display:flex;gap:8px;">' +
              '<button type="button" class="btn btn-outline btn-sm btn-block" data-action="view-user" data-id="' + esc(u.id) + '">Profile</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // RIGHT: Raw Data (View only, since money is immutable)
      '<div class="panel">' +
        '<div class="panel-header"><h3><i class="fas fa-lock"></i> Immutable Record</h3></div>' +
        '<div class="panel-body">' +
          '<p style="color:var(--text-2);font-size:13px;margin-bottom:20px;">Financial records cannot be edited or deleted. If a correction is needed, a new refund transaction must be issued.</p>' +
          
          '<div style="background:#1e293b;color:#e2e8f0;padding:16px;border-radius:10px;font-family:ui-monospace,monospace;font-size:12.5px;white-space:pre-wrap;line-height:1.6;overflow-x:auto;">' +
            JSON.stringify({
              id: p.id,
              reference: p.reference,
              user_id: p.user_id,
              amount: p.amount,
              method: p.method,
              kind: p.kind,
              status: p.status,
              created_at: p.created_at,
              metadata: p.metadata
            }, null, 2) +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderTimelinePanel() {
    if (!state.auditLogs.length) {
      return '<div class="panel"><div class="panel-body" style="text-align:center;padding:40px;">' +
        '<h3 style="margin-bottom:8px;">No Audit History</h3>' +
        '<p style="color:var(--text-2);">No changes have been recorded for this transaction.</p>' +
      '</div></div>';
    }
    return '<div class="panel"><div class="panel-header"><h3><i class="fas fa-list"></i> Action Timeline</h3></div><div class="panel-body">' +
      '<div style="position:relative;padding-left:24px;border-left:2px solid var(--border);margin-left:12px;">' +
        state.auditLogs.map(function(log) {
          return '<div style="margin-bottom:24px;position:relative;">' +
            '<div style="position:absolute;left:-33px;top:0;width:16px;height:16px;border-radius:50%;background:var(--accent);border:3px solid #fff;"></div>' +
            '<div style="font-size:12px;color:var(--text-3);font-weight:600;margin-bottom:4px;">' + esc(fmtDT(log.created_at)) + ' &middot; ' + esc(log.actor_name || 'System') + '</div>' +
            '<div style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:4px;">' + esc(log.action) + '</div>' +
            '<div style="font-size:13px;color:var(--text-2);">' + esc(log.details || '') + '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div></div>';
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render(ctx) {
    if (state.isLoading) {
      return '<div class="panel" style="padding:60px;text-align:center;color:var(--text-3)"><i class="fas fa-circle-notch fa-spin" style="font-size:24px;margin-bottom:16px"></i><p>Loading transaction...</p></div>';
    }

    if (!state.payment) {
      return '<div class="panel" style="padding:40px;text-align:center;">' +
        '<h2 style="margin-bottom:8px;">Transaction Not Found</h2>' +
        '<p style="color:var(--text-3);">The payment ID could not be located.</p>' +
        '<button type="button" class="btn btn-primary" data-action="go-back" style="margin-top:20px;">Back to Payments</button>' +
      '</div>';
    }

    var content = state.activePanel === 'timeline' ? renderTimelinePanel() : renderDetailsPanel();

    return '<div class="payment-detail-page" style="max-width:1100px;margin:0 auto;">' +
      renderHeader() + renderTabs() + '<div>' + content + '</div>' +
    '</div>';
  }

  // ================================================================
  // BIND
  // ================================================================
  function bind() {
    container = document.getElementById('content');
    if (!container) return;

    var id = getPaymentId();
    if (!state.payment && id) {
      loadData(id);
      return;
    }

    if (handler) container.removeEventListener('click', handler);

    handler = function (e) {
      var panelBtn = e.target.closest('[data-panel]');
      if (panelBtn) {
        state.activePanel = panelBtn.dataset.panel;
        container.innerHTML = render({ params: { id: currentId } });
        bind();
        return;
      }

      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      
      var action = btn.dataset.action;

      if (action === 'go-back') {
        if (global.Admin && global.Admin.go) global.Admin.go('payments');
        return;
      }
      
      if (action === 'view-user') {
        var userId = btn.dataset.id;
        localStorage.setItem('ge_admin_current_user', userId);
        if (global.Admin && global.Admin.go) global.Admin.go('user-detail', { id: userId });
        return;
      }
    };
    container.addEventListener('click', handler);
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null; 
    handler = null; 
    currentId = null;
    state.payment = null; 
    state.customer = null; 
    state.auditLogs = []; 
    state.activePanel = 'details';
    state.isLoading = true;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin['payment-detail'] = { 
    title: 'Payment Detail', 
    subtitle: 'Manage transaction', 
    render: render, 
    bind: bind, 
    cleanup: cleanup 
  };

})(window);