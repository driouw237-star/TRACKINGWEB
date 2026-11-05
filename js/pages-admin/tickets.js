/* ================================================================
   GlobalExpress — Admin Page: Support Tickets (Supabase)
   File: js/tickets.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };

  var state = {
    tickets: []
  };

  var pageHandler = null;
  var pageContainer = null;

  // ================================================================
  // DATA FETCHING (SUPABASE)
  // ================================================================
  async function loadData() {
    if (!window.supabaseClient) return;
    try {
      const { data, error } = await window.supabaseClient
        .schema('app')
        .from('tickets')
        .select('*, users ( full_name, email )')
        .order('created_at', { ascending: false });

      if (error) throw error;
      state.tickets = data || [];
    } catch (err) {
      console.error('Failed to load tickets:', err);
    }
  }

  function renderHeader() {
    return '<div class="page-header" style="margin-bottom:20px;">' +
      '<div><h2>Support Center</h2><p class="page-subtitle">Manage customer inquiries.</p></div>' +
      '</div>';
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render() {
    return '<div class="tickets-page">' +
      renderHeader() +
      '<div class="panel" style="padding:0;overflow-x:auto;">' +
        '<div id="tickets-table-mount"><div style="padding:40px;text-align:center;color:var(--text-3)"><i class="fas fa-circle-notch fa-spin"></i> Loading tickets...</div></div>' +
      '</div>' +
    '</div>';
  }

  async function bind(ctx) {
    var mount = document.getElementById('tickets-table-mount');
    if (!mount) return;

    await loadData();

    if (state.tickets.length === 0) {
      mount.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-3)">No support tickets found.</div>';
    } else {
      var rows = state.tickets.map(function(t) {
        var customerName = t.users ? (t.users.full_name || t.users.email) : 'Unknown';
        
        var statusClass = t.status === 'Open' ? 'Pending' : 
                          t.status === 'Closed' ? 'Cancelled' : 'Delivered';

        var priorityColor = t.priority === 'Urgent' ? 'var(--red)' : 
                            t.priority === 'High' ? 'var(--amber)' : 'var(--text-2)';

        return '<tr style="border-bottom:1px solid var(--border);">' +
          '<td style="padding:16px 20px;">' +
            '<div style="font-weight:700;font-size:13px;max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(t.subject)+'</div>' +
            '<div style="font-size:12px;color:var(--text-3);">'+new Date(t.created_at).toLocaleString()+'</div>' +
          '</td>' +
          '<td>' +
            '<div style="font-weight:600;font-size:13px;">'+esc(customerName)+'</div>' +
          '</td>' +
          '<td style="font-weight:600;color:'+priorityColor+';">'+esc(t.priority)+'</td>' +
          '<td><span class="pill '+statusClass+'">'+esc(t.status)+'</span></td>' +
        '</tr>';
      }).join('');

      mount.innerHTML = 
        '<table style="width:100%;border-collapse:collapse;text-align:left;">' +
          '<thead><tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">' +
            '<th style="padding:12px 20px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Subject</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Customer</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Priority</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Status</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>';
    }
  }

  function cleanup() {
    if (pageContainer && pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageContainer = null;
    pageHandler = null;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin.tickets = {
    title: 'Support',
    subtitle: 'Manage customer inquiries',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);