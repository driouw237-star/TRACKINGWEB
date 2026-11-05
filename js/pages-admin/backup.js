/* ================================================================
   GlobalExpress — Admin Page: Backup & Restore (Supabase)
   File: js/backup.js
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};
  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var toast = UI.toast || function (t, m) { if (global.console) console.log(t, m); };

  var state = {
    isExporting: false,
    isImporting: false
  };

  var pageHandler = null;
  var pageContainer = null;

  // ================================================================
  // RENDER HELPERS
  // ================================================================
  function renderHeader() {
    return '<div class="page-header" style="margin-bottom:24px;">' +
      '<div><h2>Backup & Restore</h2><p class="page-subtitle">Export and manage platform data.</p></div>' +
      '</div>';
  }

  function renderPanel(title, icon, content, danger) {
    var border = danger ? 'border:1px solid #fecaca;background:#fef2f2;' : 'border:1px solid var(--border);background:var(--surface);';
    return '' +
      '<div class="panel" style="' + border + 'margin-bottom:20px;border-radius:12px;">' +
        '<div class="panel-header" style="padding:16px 20px;border-bottom:1px solid ' + (danger ? '#fecaca' : 'var(--border)') + ';">' +
          '<h3 style="margin:0;font-size:15px;' + (danger ? 'color:#991b1b;' : 'color:var(--text);') + '"><i class="fas ' + icon + '"></i> ' + title + '</h3>' +
        '</div>' +
        '<div class="panel-body" style="padding:20px;">' + content + '</div>' +
      '</div>';
  }

  // ================================================================
  // MAIN RENDER
  // ================================================================
  function render() {
    var exportContent = '' +
      '<p style="margin-top:0;font-size:13px;color:var(--text-2);">Download a full JSON snapshot of the entire platform database.</p>' +
      '<button type="button" class="btn btn-primary" id="btn-export-all">' +
        '<i class="fas fa-download"></i> Export All Data (JSON)' +
      '</button>';

    var dangerContent = '' +
      '<p style="margin-top:0;font-size:13px;color:#991b1b;">These actions are irreversible. Proceed with extreme caution.</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
        '<button type="button" class="btn btn-danger" id="btn-purge-audit" style="background:#dc2626;color:#fff;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;">' +
          '<i class="fas fa-broom"></i> Purge Audit Logs' +
        '</button>' +
        '<button type="button" class="btn btn-danger" id="btn-wipe-db" style="background:#dc2626;color:#fff;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;">' +
          '<i class="fas fa-trash"></i> Wipe Entire Database' +
        '</button>' +
      '</div>';

    return '<div class="backup-page" style="max-width:900px;margin:0 auto;">' +
      renderHeader() +
      renderPanel('Export Data', 'fa-file-export', exportContent) +
      renderPanel('Danger Zone', 'fa-triangle-exclamation', dangerContent, true) +
    '</div>';
  }

  // ================================================================
  // ACTIONS
  // ================================================================
  async function doExportAll() {
    if (!window.supabaseClient) return;
    var btn = document.getElementById('btn-export-all');
    var originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Exporting...';
    btn.disabled = true;

    try {
      var sb = window.supabaseClient;
      var exportData = {};

      // 1. Fetch all tables from the 'app' schema
      var [usersRes, shipsRes, payRes, txnsRes, notifsRes, ticketsRes] = await Promise.all([
        sb.schema('app').from('users').select('*'),
        sb.schema('app').from('shipments').select('*'),
        sb.schema('app').from('payments').select('*'),
        sb.schema('app').from('wallet_txns').select('*'),
        sb.schema('app').from('notifications').select('*'),
        sb.schema('app').from('tickets').select('*')
      ]);

      exportData.users = usersRes.data || [];
      exportData.shipments = shipsRes.data || [];
      exportData.payments = payRes.data || [];
      exportData.wallet_txns = txnsRes.data || [];
      exportData.notifications = notifsRes.data || [];
      exportData.tickets = ticketsRes.data || [];

      // 2. Fetch audit logs
      var auditRes = await sb.schema('audit').from('logs').select('*');
      exportData.audit_logs = auditRes.data || [];

      // 3. Download the JSON file
      var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'globalexpress-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); 
      a.click(); 
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast('Exported', 'Full database backup downloaded.', 'success');

    } catch (err) {
      console.error('Export failed:', err);
      toast('Error', 'Failed to export database.', 'error');
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  async function purgeAudit() {
    var confirm = window.confirm('Are you sure you want to permanently delete all audit logs? This cannot be undone.');
    if (!confirm) return;

    try {
      // Supabase requires a filter to delete. This deletes everything older than now.
      const { error } = await window.supabaseClient
        .schema('audit')
        .from('logs')
        .delete()
        .lt('created_at', new Date().toISOString());

      if (error) throw error;
      toast('Purged', 'Audit logs have been cleared.', 'success');
      
      // Log the purge itself so there's a record
      await window.supabaseClient.schema('audit').from('logs').insert({
        action: 'admin.purged_audit_logs',
        actor_type: 'admin',
        details: 'Admin cleared the audit log history.',
        created_at: new Date().toISOString()
      });

    } catch (err) {
      console.error('Purge failed:', err);
      toast('Error', 'Failed to purge audit logs.', 'error');
    }
  }

  async function wipeDatabase() {
    var confirm = window.confirm('DANGER: This will permanently delete ALL users, shipments, and payments from Supabase. This cannot be undone. Are you absolutely sure?');
    if (!confirm) return;

    var confirm2 = window.prompt('Type "DELETE" to confirm wiping the database:');
    if (confirm2 !== 'DELETE') {
      return toast('Cancelled', 'Database wipe aborted.', 'info');
    }

    try {
      var sb = window.supabaseClient;
      toast('Wiping...', 'Deleting all platform data.', 'warning');

      // Delete in order to respect foreign key constraints
      await sb.schema('app').from('notifications').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await sb.schema('app').from('tickets').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await sb.schema('app').from('wallet_txns').delete().neq('id', 0);
      await sb.schema('app').from('payments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await sb.schema('app').from('shipments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await sb.schema('app').from('users').delete().neq('role', 'super_admin'); // Keep super admins

      toast('Wiped', 'Database cleared successfully.', 'success');
      setTimeout(function() { window.location.reload(); }, 1500);

    } catch (err) {
      console.error('Wipe failed:', err);
      toast('Error', 'Failed to wipe database.', 'error');
    }
  }

  // ================================================================
  // BIND
  // ================================================================
  function bind() {
    pageContainer = document.getElementById('content');
    if (!pageContainer) return;
    if (pageHandler) pageContainer.removeEventListener('click', pageHandler);

    pageHandler = function(e) {
      if (e.target.closest('#btn-export-all')) {
        doExportAll();
      }
      if (e.target.closest('#btn-purge-audit')) {
        purgeAudit();
      }
      if (e.target.closest('#btn-wipe-db')) {
        wipeDatabase();
      }
    };

    pageContainer.addEventListener('click', pageHandler);
  }

  function cleanup() {
    if (pageContainer && pageHandler) pageContainer.removeEventListener('click', pageHandler);
    pageContainer = null;
    pageHandler = null;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin.backup = {
    title: 'Backup & Restore',
    subtitle: 'Export and manage platform data',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);