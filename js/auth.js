/* ================================================================
   GlobalExpress — Auth Helper (Supabase Edition)
   ================================================================ */

(function () {
  'use strict';

  let cachedUser = null;
  let cachedAt = 0;
  const CACHE_TTL_MS = 2000; // 2 seconds cache to prevent spamming

  const Auth = {
    // ------------------------------------------------------------
    // READ
    // ------------------------------------------------------------
    getUser() {
      if (cachedUser && (Date.now() - cachedAt) < CACHE_TTL_MS) {
        return cachedUser;
      }
      return cachedUser;
    },

    isSignedIn() {
      return !!Auth.getUser();
    },

    isAdmin() {
      const u = Auth.getUser();
      return u && (u.role === 'admin' || u.role === 'super_admin');
    },

    // ------------------------------------------------------------
    // ASYNC RESOLVER (Called by app.js and admin.js on boot)
    // ------------------------------------------------------------
    async resolve() {
      const sb = window.supabaseClient;
      if (!sb) return null;

      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        cachedUser = null;
        cachedAt = Date.now();
        return null;
      }

      // Fetch the profile from the database to get the role
      const { data: profile, error } = await sb
        .schema('app')
        .from('users')
        .select('id, email, full_name, role, status, wallet, referral_code')
        .eq('id', session.user.id)
        .single();

      if (error || !profile) {
        console.warn('[Auth] Profile fetch failed:', error);
        await sb.auth.signOut();
        cachedUser = null;
        return null;
      }

      // Map DB snake_case to our frontend camelCase
      cachedUser = {
        id: profile.id,
        email: profile.email,
        name: profile.full_name,
        role: profile.role,
        status: profile.status,
        wallet: profile.wallet || 0,
        referralCode: profile.referral_code
      };
      
      cachedAt = Date.now();
      return cachedUser;
    },

    // ------------------------------------------------------------
    // GUARDS
    // ------------------------------------------------------------
    requireLogin(options) {
      const opts = options || {};
      const user = Auth.getUser();

      if (!user) {
        window.location.replace(opts.redirect || 'portal.html');
        return null;
      }

      if (opts.role && user.role !== opts.role) {
        window.location.replace('app.html');
        return null;
      }

      return user;
    },

    redirectIfSignedIn(redirect) {
      const user = Auth.getUser();
      if (user) {
        window.location.replace(redirect || 'app.html');
        return true;
      }
      return false;
    },

    // ------------------------------------------------------------
    // WRITE
    // ------------------------------------------------------------
    async logout() {
      const sb = window.supabaseClient;
      if (sb) await sb.auth.signOut();
      cachedUser = null;
      cachedAt = 0;
    },

    async logoutAndRedirect(target) {
      await Auth.logout();
      window.location.replace(target || 'portal.html');
    },

    refresh() {
      cachedUser = null;
      cachedAt = 0;
    },

    get MAX_AGE_MS() { return 30 * 24 * 60 * 60 * 1000; },
    get PORTAL_URL() { return 'portal.html'; },
    get APP_URL()    { return 'app.html'; }
  };

  window.Auth = Auth;
})();