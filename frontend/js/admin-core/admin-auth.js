/* ================================================================
   GlobalExpress — Admin Core: Auth helpers
   ================================================================
   Role checks + password re-entry modal used by sensitive actions.
   ================================================================ */

(function (global) {
  'use strict';

  var UI = global.UI || {};
  var Auth = global.Auth || {};

  var AdminAuth = {
    /**
     * Are we signed in as an admin?
     */
    isAdmin: function () {
      if (Auth && typeof Auth.isAdmin === 'function') return Auth.isAdmin();
      return false;
    },

    /**
     * Get the current admin user, or null.
     */
    getAdmin: function () {
      if (Auth && typeof Auth.getUser === 'function') return Auth.getUser();
      return null;
    },

    /**
     * Ask the admin to re-enter their password. Returns a Promise
     * that resolves to true if correct, false otherwise.
     *
     * Usage:
     *   AdminAuth.requirePassword('Confirm wallet adjustment')
     *     .then(ok => { if (ok) { ...do the thing... } });
     */
    requirePassword: function (reason) {
      return new Promise(function (resolve) {
        var user = AdminAuth.getAdmin();
        if (!user) { resolve(false); return; }

        if (!UI.openModal) {
          // Fallback — no modal system
          resolve(global.confirm && global.confirm('Confirm your password to continue?'));
          return;
        }

        var wrap = UI.openModal(
          '<div class="modal narrow">' +
            '<div class="modal-head">' +
              '<div>' +
                '<h3><i class="fas fa-lock"></i> Confirm password</h3>' +
                '<div class="sub">' + (reason || 'This action requires re-authentication.') + '</div>' +
              '</div>' +
              '<button type="button" class="modal-close" data-auth-cancel>' +
                '<i class="fas fa-times"></i>' +
              '</button>' +
            '</div>' +
            '<div class="modal-body">' +
              '<div class="field">' +
                '<label>Password</label>' +
                '<input type="password" id="adminReauthPw" autocomplete="current-password" />' +
              '</div>' +
            '</div>' +
            '<div class="modal-foot">' +
              '<button type="button" class="btn btn-outline" data-auth-cancel>Cancel</button>' +
              '<button type="button" class="btn btn-primary" data-auth-confirm>' +
                '<i class="fas fa-check"></i> Confirm' +
              '</button>' +
            '</div>' +
          '</div>');

        var settled = false;
        function finish(result) {
          if (settled) return;
          settled = true;
          if (UI.closeModal) UI.closeModal(wrap);
          resolve(result);
        }

        wrap.addEventListener('click', function (e) {
          if (e.target.closest('[data-auth-cancel]')) finish(false);
          if (e.target.closest('[data-auth-confirm]')) {
            var input = document.getElementById('adminReauthPw');
            var pw = input ? input.value : '';
            if (pw === user.password) {
              finish(true);
            } else {
              if (UI.toast) UI.toast('Incorrect password', 'Please try again.', 'error');
              if (input) { input.value = ''; input.focus(); }
            }
          }
        });

        setTimeout(function () {
          var input = document.getElementById('adminReauthPw');
          if (input) input.focus();
        }, 60);
      });
    }
  };

  global.AdminAuth = AdminAuth;

  global.Admin = global.Admin || {};
  global.Admin.Auth = AdminAuth;

})(window);