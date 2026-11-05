/* ================================================================
   GlobalExpress — Admin Page: Audit Log (Supabase)
   File: js/audit.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };

  var state = {
    logs: []
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
        .schema('audit')
        .from('logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100); // Only fetch the latest 100 for performance

      if (error) throw error;
      state.logs = data || [];
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    }
  }

  function renderHeader() {
    return '<div class="page-header" style="margin-bottom:20px;">' +
      '<div><h2>Audit Log</h2><p class="page-subtitle">Immutable record of all admin actions and system events.</p></div>' +
      '</div>';
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render() {
    return '<div class="audit-page">' +
      renderHeader() +
      '<div class="panel" style="padding:0;overflow-x:auto;">' +
        '<div id="audit-table-mount"><div style="padding:40px;text-align:center;color:var(--text-3)"><i class="fas fa-circle-notch fa-spin"></i> Loading audit logs...</div></div>' +
      '</div>' +
    '</div>';
  }

  async function bind(ctx) {
    var mount = document.getElementById('audit-table-mount');
    if (!mount) return;

    await loadData();

    if (state.logs.length === 0) {
      mount.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-3)">No audit logs recorded yet.</div>';
    } else {
      var rows = state.logs.map(function(l) {
        var actorName = l.actor_name || 'System';
        var action = l.action || 'UNKNOWN';
        
        // Badge color based on action type
        var badgeClass = 'Pending';
        if (action.includes('user')) badgeClass = 'Delivered';
        if (action.includes('wallet') || action.includes('payment')) badgeClass = 'In-Transit';
        if (action.includes('shipment')) badgeClass = 'Pending';

        return '<tr style="border-bottom:1px solid var(--border);">' +
          '<td style="padding:16px 20px;font-size:12px;color:var(--text-3);white-space:nowrap;">' +
            new Date(l.created_at).toLocaleString() +
          '</td>' +
          '<td>' +
            '<div style="font-weight:600;font-size:13px;">'+esc(actorName)+'</div>' +
          '</td>' +
          '<td><span class="pill '+badgeClass+'">'+esc(action)+'</span></td>' +
          '<td style="font-family:monospace;font-size:12px;color:var(--text-2);">' +
            esc(l.target || '—') +
          '</td>' +
        '</tr>';
      }).join('');

      mount.innerHTML = 
        '<table style="width:100%;border-collapse:collapse;text-align:left;">' +
          '<thead><tr style="border-bottom:1px solid var(--border);background:var(--surface-2);">' +
            '<th style="padding:12px 20px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Timestamp</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Actor</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Action</th>' +
            '<th style="padding:12px;font-size:12px;color:var(--text-3);text-transform:uppercase;">Target</th>' +
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
  global.PagesAdmin.audit = {
    title: 'Audit Log',
    subtitle: 'Immutable record of all admin actions',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);