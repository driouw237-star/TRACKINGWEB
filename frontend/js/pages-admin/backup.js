/* ================================================================
   GlobalExpress — Admin Page: Backup & Restore
   ================================================================
   Export, import, and purge platform data. Includes a Danger Zone
   for destructive actions requiring re-authentication.
   ================================================================ */

(function (global) {
  'use strict';

  var Utils  = global.Utils  || {};
  var UI     = global.UI     || {};
  var AdminAuth = global.AdminAuth || (global.Admin && global.Admin.Auth);

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  var toast = UI.toast || function (t,m) { if (global.console) console.log(t, m); };

  // The keys we manage
  var KEYS = [
    'ge_users', 'ge_shipments', 'ge_payments', 'ge_wallet_txns',
    'ge_notifications', 'ge_tickets', 'ge_audit', 'ge_settings'
  ];

  function renderHeader() {
    return '<div class="page-header">' +
      '<div><h2>Backup &amp; Restore</h2><p class="page-subtitle">Export, import, and manage platform data.</p></div>' +
    '</div>';
  }

  function renderPanel(title, icon, content, danger) {
    var border = danger ? 'border:1px solid #fecaca;background:#fef2f2;' : '';
    return '' +
      '<div class="panel" style="' + border + '">' +
        '<div class="panel-header" style="' + (danger ? 'border-bottom-color:#fecaca;' : '') + '">' +
          '<h3 style="' + (danger ? 'color:#991b1b;' : '') + '"><i class="fas ' + icon + '"></i> ' + title + '</h3>' +
        '</div>' +
        '<div class="panel-body">' + content + '</div>' +
      '</div>';
  }

  function render(ctx) {
    var exportContent = '' +
      '<p style="margin-top:0;font-size:13px;color:var(--text-2)">Download a full JSON snapshot of the entire platform database.</p>' +
      '<button type="button" class="btn btn-primary" id="btn-export-all">' +
        '<i class="fas fa-download"></i> Export All Data (JSON)' +
      '</button>';

    var importContent = '' +
      '<p style="margin-top:0;font-size:13px;color:var(--text-2)">Restore the platform from a previously exported JSON backup file.</p>' +
      '<input type="file" id="file-import" accept=".json" style="display:none">' +
      '<button type="button" class="btn btn-outline" id="btn-import">' +
        '<i class="fas fa-upload"></i> Select Backup File' +
      '</button>' +
      '<div id="import-preview" style="margin-top:14px;font-size:13px"></div>';

    var dangerContent = '' +
      '<p style="margin-top:0;font-size:13px;color:#991b1b">These actions are irreversible. Proceed with extreme caution.</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
        '<button type="button" class="btn btn-danger" id="btn-purge-audit">' +
          '<i class="fas fa-broom"></i> Purge Audit Logs' +
        '</button>' +
        '<button type="button" class="btn btn-danger" id="btn-wipe-db">' +
          '<i class="fas fa-trash"></i> Wipe Entire Database' +
        '</button>' +
      '</div>';

    return '' +
      '<div class="backup-page">' +
        renderHeader() +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:20px">' +
          renderPanel('Export Data', 'fa-file-export', exportContent) +
          renderPanel('Import Data', 'fa-file-import', importContent) +
        '</div>' +
        renderPanel('Danger Zone', 'fa-triangle-exclamation', dangerContent, true) +
      '</div>';
  }

  function doExportAll() {
    var data = {};
    KEYS.forEach(function(key) {
      try {
        var raw = localStorage.getItem(key);
        data[key] = raw ? JSON.parse(raw) : null;
      } catch(e) { data[key] = null; }
    });

    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'globalexpress-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast('Exported', 'Full database backup downloaded.', 'success');
    if (global.Admin && global.Admin.logAudit) {
      global.Admin.logAudit('backup.exported', 'platform', 'Downloaded full JSON backup');
    }
  }

  function handleFileSelect(e) {
    var file = e.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function(evt) {
      var preview = document.getElementById('import-preview');
      try {
        var parsed = JSON.parse(evt.target.result);
        var keysFound = Object.keys(parsed).length;
        preview.innerHTML = '<div style="color:var(--green);font-weight:600"><i class="fas fa-check-circle"></i> Valid backup found (' + keysFound + ' tables).</div>' +
          '<button type="button" class="btn btn-primary btn-sm" id="btn-confirm-import" style="margin-top:10px">Confirm Restore</button>';
        
        document.getElementById('btn-confirm-import').onclick = function() {
          confirmImport(parsed);
        };
      } catch(err) {
        preview.innerHTML = '<div style="color:var(--red);font-weight:600"><i class="fas fa-exclamation-circle"></i> Invalid JSON file.</div>';
      }
    };
    reader.readAsText(file);
  }

  function confirmImport(data) {
    var doImport = function() {
      try {
        Object.keys(data).forEach(function(key) {
          if (KEYS.indexOf(key) !== -1) {
            if (data[key] === null) localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify(data[key]));
          }
        });
        toast('Restored', 'Database restored from backup.', 'success');
        if (global.Admin && global.Admin.logAudit) {
          global.Admin.logAudit('backup.imported', 'platform', 'Restored database from JSON file');
        }
        setTimeout(function() { window.location.reload(); }, 1000);
      } catch(err) {
        toast('Error', 'Failed to write to localStorage (quota exceeded?).', 'error');
      }
    };

    if (AdminAuth && AdminAuth.requirePassword) {
      AdminAuth.requirePassword('Confirm database restore').then(function(ok) {
        if (ok) doImport();
      });
    } else {
      if (confirm('Restore database? This will overwrite all current data.')) doImport();
    }
  }

  function purgeAudit() {
    var doPurge = function() {
      localStorage.removeItem('ge_audit');
      toast('Purged', 'Audit logs wiped.', 'success');
      if (global.Admin && global.Admin.logAudit) {
        global.Admin.logAudit('backup.audit_purged', 'ge_audit', 'Cleared audit logs');
      }
      if (global.Router && global.Router.refresh) global.Router.refresh();
    };

    if (AdminAuth && AdminAuth.requirePassword) {
      AdminAuth.requirePassword('Purge all audit logs').then(function(ok) { if (ok) doPurge(); });
    } else {
      if (confirm('Permanently delete all audit logs?')) doPurge();
    }
  }

  function wipeDatabase() {
    var doWipe = function() {
      KEYS.forEach(function(key) {
        localStorage.removeItem(key);
      });
      toast('Wiped', 'Database cleared. Reloading...', 'success');
      setTimeout(function() { window.location.reload(); }, 1500);
    };

    if (AdminAuth && AdminAuth.requirePassword) {
      AdminAuth.requirePassword('Wipe the entire platform database').then(function(ok) { if (ok) doWipe(); });
    } else {
      if (confirm('DANGER: Permanently delete ALL users, shipments, and payments?')) doWipe();
    }
  }

  function bind(ctx) {
    var container = document.getElementById('content');
    if (!container) return;
    if (container.__backupWired) return;
    container.__backupWired = true;

    container.addEventListener('click', function (e) {
      if (e.target.closest('#btn-export-all')) {
        doExportAll();
      }
      if (e.target.closest('#btn-import')) {
        document.getElementById('file-import').click();
      }
      if (e.target.closest('#btn-purge-audit')) {
        purgeAudit();
      }
      if (e.target.closest('#btn-wipe-db')) {
        wipeDatabase();
      }
    });

    var fileInput = document.getElementById('file-import');
    if (fileInput) {
      fileInput.addEventListener('change', handleFileSelect);
    }
  }

  function cleanup() {
    var c = document.getElementById('content');
    if (c) c.__backupWired = false;
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin.backup = {
    title: 'Backup & Restore',
    subtitle: 'Export, import, and manage platform data',
    render: render,
    bind: bind,
    cleanup: cleanup
  };

})(window);