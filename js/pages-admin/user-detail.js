/* ================================================================
   GlobalExpress — Admin User Detail (Full Page Wallet)
   File: js/user-detail.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var Admin = global.Admin || null;

  var esc   = Utils.esc   || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n || 0).toLocaleString(); };
  var fmtDT = Utils.fmtDT || function (d) { return new Date(d || Date.now()).toLocaleString(); };
  var toast = Utils.toast || function (t, m) { if (global.console) console.log('[Toast]', t, m); };

  var state = {
    user: null,
    shipments: [],
    payments: [],
    walletTxns: [],
    activeTab: 'overview', // overview | shipments | payments | wallet | adjust-wallet
    isLoading: true
  };

  var handler = null;
  var container = null;
  var currentId = null;

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  function getUserId(ctx) {
    if (ctx && ctx.params && ctx.params.id) return String(ctx.params.id);
    return localStorage.getItem('ge_admin_current_user');
  }

  async function loadData(id) {
    if (!window.supabaseClient) return;
    currentId = id;
    state.isLoading = true;
    var sb = window.supabaseClient;

    try {
      // 1. Fetch User
      const { data: user, error: userErr } = await sb
        .schema('app')
        .from('users')
        .select('*')
        .eq('id', id)
        .single();

      if (userErr) throw userErr;
      state.user = user;

      // 2. Fetch Shipments, Payments, and Wallet Txns concurrently
      var [shipRes, payRes, txnRes] = await Promise.all([
        sb.schema('app').from('shipments').select('*').eq('created_by', id).order('created_at', { ascending: false }),
        sb.schema('app').from('payments').select('*').eq('user_id', id).order('created_at', { ascending: false }),
        sb.schema('app').from('wallet_txns').select('*').eq('user_id', id).order('created_at', { ascending: false })
      ]);

      state.shipments = shipRes.data || [];
      state.payments = payRes.data || [];
      state.walletTxns = txnRes.data || [];

    } catch (err) {
      console.error('Failed to load user details:', err);
      state.user = null;
    } finally {
      state.isLoading = false;
      if (container) {
        container.innerHTML = render({ params: { id: currentId } });
        bind();
      }
    }
  }

  // ================================================================
  // ACTIONS
  // ================================================================
  async function handleAdjustWallet() {
    var amt = parseInt(document.getElementById('wAmt').value, 10) || 0;
    var op = document.getElementById('wOp').value;
    var reason = document.getElementById('wReason').value.trim();
    var bal = Number(state.user.wallet) || 0;
    
    if (!amt || !reason) {
      alert('Amount and reason are required');
      return;
    }

    var delta = op === 'debit' ? -amt : amt;
    if (bal + delta < 0) {
      alert('Balance cannot go negative');
      return;
    }

    var btn = document.getElementById('saveAdjustBtn');
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processing...';
    btn.disabled = true;

    try {
      const { data: newBal, error } = await window.supabaseClient
        .schema('app')
        .rpc('admin_adjust_wallet', {
          p_admin_id: (global.Auth && global.Auth.getUser()) ? global.Auth.getUser().id : state.user.id,
          p_target_user_id: state.user.id,
          p_amount: delta,
          p_reason: reason
        });

      if (error) throw error;

      alert('Wallet adjusted successfully! New balance: ' + money(newBal));
      
      // Switch back to overview and reload data
      state.activeTab = 'overview';
      loadData(state.user.id);

    } catch (err) {
      console.error('Adjust failed:', err);
      alert(err.message || 'Failed to adjust wallet');
      btn.innerHTML = 'Apply Adjustment';
      btn.disabled = false;
    }
  }

  async function handleSuspend() {
    var isSuspended = state.user.status === 'suspended';
    var newStatus = isSuspended ? 'active' : 'suspended';
    var actionText = isSuspended ? 'Reactivate' : 'Suspend';
    
    if (!confirm('Are you sure you want to ' + actionText + ' this user?')) return;

    try {
      const { error } = await window.supabaseClient
        .schema('app')
        .from('users')
        .update({ status: newStatus })
        .eq('id', state.user.id);

      if (error) throw error;
      
      alert('User is now ' + newStatus);
      loadData(state.user.id);

    } catch (err) {
      console.error(err);
      alert('Failed to update user status');
    }
  }

  // ================================================================
  // RENDER HELPERS
  // ================================================================
  function renderHeader() {
    var u = state.user;
    var isSuspended = u.status === 'suspended';
    var initial = (u.full_name || 'U').charAt(0).toUpperCase();

    return '<div class="page-header" style="display:flex;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:16px;background:var(--surface);padding:24px;border-radius:16px;border:1px solid var(--border)">' +
      '<div style="display:flex;gap:20px;align-items:center">' +
        '<div style="width:72px;height:72px;font-size:26px;background:linear-gradient(135deg,#0b2545,#13315c);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;box-shadow:0 4px 12px rgba(11,37,69,.2)">' + esc(initial) + '</div>' +
        '<div>' +
          '<h2 style="margin:0 0 4px;display:flex;align-items:center;gap:10px;font-size:22px;font-weight:800">' +
            esc(u.full_name || 'Unnamed') +
            ' <span class="pill ' + (isSuspended ? 'Cancelled' : 'Delivered') + '">' + (isSuspended ? 'Suspended' : 'Active') + '</span>' +
          '</h2>' +
          '<p style="margin:0;color:var(--text-2);font-size:14px">' + esc(u.email) + '</p>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<button type="button" class="btn btn-outline btn-sm" data-action="adjust-wallet"><i class="fas fa-wallet"></i> Adjust Wallet</button>' +
        (isSuspended
              ? '<button type="button" class="btn btn-outline btn-sm" data-action="suspend" style="color:var(--green);border-color:var(--green)"><i class="fas fa-check"></i> Reactivate</button>'
              : '<button type="button" class="btn btn-danger btn-sm" data-action="suspend"><i class="fas fa-ban"></i> Suspend</button>') +
      '</div>' +
    '</div>';
  }

  function renderTabsBar() {
    var tabs = [
      { key: 'overview', label: 'Overview', icon: 'fa-user' },
      { key: 'shipments', label: 'Shipments', icon: 'fa-box' },
      { key: 'payments', label: 'Payments', icon: 'fa-credit-card' },
      { key: 'wallet', label: 'Wallet Ledger', icon: 'fa-wallet' }
    ];

    return '<div class="users-tabs-bar" style="display:flex;gap:10px;margin-bottom:20px;border-bottom:1px solid var(--border);">' +
      tabs.map(function(t) {
        var active = state.activeTab === t.key;
        var style = active ? 'border-bottom:2px solid var(--accent); color:var(--text);' : 'color:var(--text-3);';
        return '<button type="button" class="users-tab" data-user-tab="' + t.key + '" style="background:none;border:none;padding:12px 20px;font-weight:600;cursor:pointer;'+style+'"><i class="fas '+t.icon+'" style="margin-right:6px;opacity:0.7;"></i> ' + t.label + '</button>';
      }).join('') +
    '</div>';
  }

  function renderTabContent() {
    var u = state.user;
    
    // --- OVERVIEW TAB ---
    if (state.activeTab === 'overview') {
      return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">' +
        '<div class="panel"><div class="panel-header"><h3>Profile Details</h3></div><div class="panel-body">' +
          '<div style="padding:8px 0;border-bottom:1px solid var(--border);"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">Role</div><div style="font-weight:600;">' + esc(u.role) + '</div></div>' +
          '<div style="padding:8px 0;border-bottom:1px solid var(--border);"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">Joined Date</div><div style="font-weight:600;">' + new Date(u.created_at).toLocaleDateString() + '</div></div>' +
          '<div style="padding:8px 0;border-bottom:1px solid var(--border);"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">Referral Code</div><div style="font-weight:600;">' + esc(u.referral_code || '—') + '</div></div>' +
          '<div style="padding:8px 0;"><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;">User ID</div><div style="font-weight:600;font-family:monospace;">' + esc(u.id) + '</div></div>' +
        '</div></div>' +
        
        '<div class="panel"><div class="panel-header"><h3>Stats</h3></div><div class="panel-body">' +
          '<div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border);"><span>Wallet Balance</span><strong style="color:var(--green);">' + money(u.wallet) + '</strong></div>' +
          '<div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border);"><span>Total Shipments</span><strong>' + state.shipments.length + '</strong></div>' +
          '<div style="display:flex;justify-content:space-between;padding:12px 0;"><span>Total Payments</span><strong>' + state.payments.length + '</strong></div>' +
        '</div></div>' +
      '</div>';
    }

    // --- SHIPMENTS TAB ---
    if (state.activeTab === 'shipments') {
      if (state.shipments.length === 0) return '<div class="panel-body" style="text-align:center;padding:40px;color:var(--text-3)">No shipments found for this user.</div>';
      return '<div class="panel" style="padding:0;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;text-align:left;">' +
        '<thead><tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">' +
          '<th style="padding:12px 20px;font-size:12px;color:var(--text-3);">Tracking</th>' +
          '<th style="padding:12px;font-size:12px;color:var(--text-3);">Route</th>' +
          '<th style="padding:12px;font-size:12px;color:var(--text-3);">Status</th>' +
          '<th style="padding:12px;font-size:12px;color:var(--text-3);">Fee</th>' +
        '</tr></thead><tbody>' +
        state.shipments.map(function(s) {
          var statusClass = s.status === 'Delivered' ? 'Delivered' : s.status === 'Pending' ? 'Pending' : 'In-Transit';
          return '<tr style="border-bottom:1px solid var(--border);">' +
            '<td style="padding:16px 20px;font-family:monospace;font-weight:600;">' + esc(s.tracking_code) + '</td>' +
            '<td>' + esc(s.origin_city) + ' &rarr; ' + esc(s.dest_city) + '</td>' +
            '<td><span class="pill ' + statusClass + '">' + esc(s.status) + '</span></td>' +
            '<td style="font-weight:600;">' + money(s.amount_paid) + '</td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>';
    }

    // --- PAYMENTS TAB ---
    if (state.activeTab === 'payments') {
      if (state.payments.length === 0) return '<div class="panel-body" style="text-align:center;padding:40px;color:var(--text-3)">No payments found for this user.</div>';
      return '<div class="panel" style="padding:0;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;text-align:left;">' +
        '<thead><tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">' +
          '<th style="padding:12px 20px;font-size:12px;color:var(--text-3);">Reference</th>' +
          '<th style="padding:12px;font-size:12px;color:var(--text-3);">Kind</th>' +
          '<th style="padding:12px;font-size:12px;color:var(--text-3);">Amount</th>' +
          '<th style="padding:12px;font-size:12px;color:var(--text-3);">Status</th>' +
        '</tr></thead><tbody>' +
        state.payments.map(function(p) {
          var isPos = p.amount >= 0;
          var statusClass = p.status === 'Paid' ? 'Delivered' : 'Pending';
          return '<tr style="border-bottom:1px solid var(--border);">' +
            '<td style="padding:16px 20px;font-family:monospace;font-size:12px;">' + esc(p.reference) + '</td>' +
            '<td>' + esc(p.kind) + '</td>' +
            '<td style="font-weight:700;color:' + (isPos ? 'var(--green)' : 'var(--red)') + ';">' + (isPos?'+':'') + money(p.amount) + '</td>' +
            '<td><span class="pill ' + statusClass + '">' + esc(p.status) + '</span></td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>';
    }

    // --- WALLET TAB ---
    if (state.activeTab === 'wallet') {
      if (state.walletTxns.length === 0) return '<div class="panel-body" style="text-align:center;padding:40px;color:var(--text-3)">No wallet transactions found.</div>';
      return '<div class="panel" style="padding:0;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;text-align:left;">' +
        '<thead><tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">' +
          '<th style="padding:12px 20px;font-size:12px;color:var(--text-3);">Date</th>' +
          '<th style="padding:12px;font-size:12px;color:var(--text-3);">Type</th>' +
          '<th style="padding:12px;font-size:12px;color:var(--text-3);">Amount</th>' +
          '<th style="padding:12px;font-size:12px;color:var(--text-3);">Balance After</th>' +
        '</tr></thead><tbody>' +
        state.walletTxns.map(function(t) {
          var isPos = t.amount >= 0;
          return '<tr style="border-bottom:1px solid var(--border);">' +
            '<td style="padding:16px 20px;font-size:12px;color:var(--text-3);">' + new Date(t.created_at).toLocaleString() + '</td>' +
            '<td>' + esc(t.type) + '</td>' +
            '<td style="font-weight:700;color:' + (isPos ? 'var(--green)' : 'var(--red)') + ';">' + (isPos?'+':'') + money(t.amount) + '</td>' +
            '<td style="font-weight:600;">' + money(t.balance_after) + '</td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>';
    }

    // --- ADJUST WALLET PAGE (NEW FULL PAGE) ---
    if (state.activeTab === 'adjust-wallet') {
      return '<div class="panel" style="max-width:600px;margin:0 auto;border-top:4px solid var(--accent);">' +
        '<div class="panel-header"><h3><i class="fas fa-wallet"></i> Adjust Balance</h3></div>' +
        '<div class="panel-body">' +
          
          '<div style="background:var(--surface-2);border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">' +
            '<div style="font-size:11px;color:var(--text-3);text-transform:uppercase;font-weight:700;">Current Balance</div>' +
            '<div style="font-size:32px;font-weight:800;color:var(--green);margin-top:4px;">' + money(u.wallet || 0) + '</div>' +
          '</div>' +

          '<div class="field" style="margin-bottom:16px;">' +
            '<label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Operation</label>' +
            '<select id="wOp" style="width:100%;padding:12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">' +
              '<option value="credit">Credit (Add funds)</option>' +
              '<option value="debit">Debit (Deduct funds)</option>' +
            '</select>' +
          '</div>' +

          '<div class="field" style="margin-bottom:16px;">' +
            '<label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Amount (XAF)</label>' +
            '<input type="number" id="wAmt" placeholder="e.g. 5000" min="1" style="width:100%;padding:12px;border:1px solid var(--border);border-radius:8px;font-size:14px;" />' +
          '</div>' +

          '<div class="field" style="margin-bottom:24px;">' +
            '<label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Reason (Required for audit)</label>' +
            '<input type="text" id="wReason" placeholder="e.g. Goodwill credit" style="width:100%;padding:12px;border:1px solid var(--border);border-radius:8px;font-size:14px;" />' +
          '</div>' +

          '<div style="display:flex;gap:10px;">' +
            '<button type="button" class="btn btn-outline" data-action="cancel-adjust" style="flex:1;padding:12px;">Cancel</button>' +
            '<button type="button" class="btn btn-primary" id="saveAdjustBtn" data-action="save-adjust" style="flex:1;padding:12px;">Apply Adjustment</button>' +
          '</div>' +

        '</div>' +
      '</div>';
    }
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render(ctx) {
    if (state.isLoading) {
      return '<div class="panel" style="padding:60px;text-align:center;color:var(--text-3)"><i class="fas fa-circle-notch fa-spin" style="font-size:24px;margin-bottom:16px"></i><p>Loading user profile...</p></div>';
    }

    if (!state.user) {
      return '<div class="panel" style="padding:40px;text-align:center;">' +
        '<h2 style="margin-bottom:8px;">User Not Found</h2>' +
        '<p style="color:var(--text-3);">The user ID could not be located.</p>' +
        '<button type="button" class="btn btn-primary" data-action="go-users" style="margin-top:20px;">Back to Users</button>' +
      '</div>';
    }

    return '<div class="user-detail-page" style="max-width:1200px;margin:0 auto">' +
      renderHeader() + renderTabsBar() +
      '<div style="min-height:400px">' + renderTabContent() + '</div>' +
    '</div>';
  }

  // ================================================================
  // BIND
  // ================================================================
  function bind() {
    container = document.getElementById('content');
    if (!container) return;

    var id = getUserId();
    if (!state.user && id) {
      loadData(id);
      return;
    }

    if (handler) container.removeEventListener('click', handler);

    handler = function (e) {
      var tab = e.target.closest('[data-user-tab]');
      if (tab) {
        state.activeTab = tab.dataset.userTab;
        container.innerHTML = render();
        bind();
        return;
      }

      var btn = e.target.closest('[data-action]');
      if (!btn) return;

      var action = btn.dataset.action;
      if (action === 'go-users') { if (global.Admin) global.Admin.go('users'); return; }
      
      // The new full-page action
      if (action === 'adjust-wallet') { 
        state.activeTab = 'adjust-wallet'; 
        container.innerHTML = render(); 
        bind(); 
        return; 
      }
      
      if (action === 'cancel-adjust') { 
        state.activeTab = 'overview'; 
        container.innerHTML = render(); 
        bind(); 
        return; 
      }
      
      if (action === 'save-adjust') { 
        handleAdjustWallet(); 
        return; 
      }
      
      if (action === 'suspend') { handleSuspend(); return; }
    };

    container.addEventListener('click', handler);
  }

  function cleanup() {
    if (container && handler) container.removeEventListener('click', handler);
    container = null; handler = null; currentId = null;
    state.user = null; state.activeTab = 'overview'; 
    state.shipments = []; state.payments = []; state.walletTxns = [];
    state.isLoading = true;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin['user-detail'] = {
    title: 'User Detail',
    subtitle: 'Manage user account',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);