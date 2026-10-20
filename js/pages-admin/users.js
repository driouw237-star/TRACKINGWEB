/* ================================================================
   GlobalExpress — Admin Page: Users (Supabase Edition)
   ================================================================ */

(function (global) {
  'use strict';

  var Utils     = global.Utils     || {};
  var esc = Utils.esc || function (s) { return String(s == null ? '' : s); };
  var money = Utils.money || function (n) { return 'Fr. ' + Number(n||0).toLocaleString(); };
  var comma = Utils.comma || function (n) { return Number(n||0).toLocaleString('en-US'); };
  var fmtDate = Utils.fmtDate || function (d) { return new Date(d).toLocaleDateString(); };

  function render(ctx) {
    return '<div class="users-page">' +
      '<div class="page-header" style="margin-bottom: 24px;">' +
        '<div><h2>Users</h2><p class="page-subtitle">Manage every user on the platform.</p></div>' +
      '</div>' +
      '<div id="users-table-mount" class="panel"><div class="panel-body" style="text-align:center; padding:40px;"><i class="fas fa-circle-notch fa-spin" style="font-size:24px; color:var(--text-3)"></i></div></div>' +
    '</div>';
  }

  async function bind(ctx) {
    var mount = document.getElementById('users-table-mount');
    if (!mount || !window.supabaseClient) return;

    try {
      // Fetch real users from Supabase
      const { data: users, error } = await window.supabaseClient
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (!users || users.length === 0) {
        mount.innerHTML = '<div class="panel-body" style="text-align:center; padding:40px;"><h3>No users found</h3></div>';
        return;
      }

      // Build the table
      var rows = users.map(function(u) {
        var isAdmin = u.role === 'admin' || u.role === 'super_admin';
        var roleBadge = isAdmin ? '<span class="admin-badge role-admin">Admin</span>' : '<span class="admin-badge role-user">User</span>';
        
        return '<tr>' +
          '<td>' +
            '<div class="cell-user">' +
              '<span class="av">' + esc((u.full_name || 'U').charAt(0)) + '</span>' +
              '<div class="meta">' +
                '<div class="name">' + esc(u.full_name || 'Unknown') + '</div>' +
                '<div class="email">' + esc(u.email) + '</div>' +
              '</div>' +
            '</div>' +
          '</td>' +
          '<td>' + roleBadge + '</td>' +
          '<td class="num">' + money(u.wallet || 0) + '</td>' +
          '<td><span class="pill Delivered">Active</span></td>' +
          '<td style="color:var(--text-3); font-size:12px">' + fmtDate(u.created_at) + '</td>' +
        '</tr>';
      }).join('');

      mount.innerHTML = 
        '<div class="tbl-wrap">' +
          '<table class="table-cards">' +
            '<thead>' +
              '<tr>' +
                '<th>User</th>' +
                '<th>Role</th>' +
                '<th class="num">Wallet</th>' +
                '<th>Status</th>' +
                '<th>Joined</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';

    } catch (err) {
      console.error('[Users Admin]', err);
      mount.innerHTML = '<div class="panel-body" style="color:var(--red); padding:20px;">Error loading users: ' + esc(err.message) + '</div>';
    }
  }

  global.PagesAdmin = global.PagesAdmin || {};
  global.PagesAdmin.users = {
    title: 'Users',
    subtitle: 'Manage every user on the platform',
    render: render,
    bind: bind
  };

})(window);