/* ================================================================
   GlobalExpress — Auth Helper (Supabase Edition)
   File: js/auth.js
   ================================================================ */

(function () {
  'use strict';

  let cachedUser = null;
  let cachedAt = 0;
  const CACHE_TTL_MS = 5000;

  const Auth = {
    getUser() {
      if (cachedUser && (Date.now() - cachedAt) < CACHE_TTL_MS) return cachedUser;
      return cachedUser;
    },

    isSignedIn() { return !!Auth.getUser(); },
    isAdmin() {
      const u = Auth.getUser();
      return u && (u.role === 'admin' || u.role === 'super_admin');
    },

    async resolve() {
      const sb = window.supabaseClient;
      if (!sb) return null;

      if (cachedUser && (Date.now() - cachedAt) < CACHE_TTL_MS) return cachedUser;

      // Wait for authReady promise from supabase.js
      if (window.authReady) {
        try { await window.authReady; } catch (e) {}
      }

      // FIX: Retry getting the session up to 3 times if it's null
      let session = null;
      let attempts = 0;
      while (!session && attempts < 3) {
        const { data, error } = await sb.auth.getSession();
        if (data && data.session) {
          session = data.session;
        } else {
          attempts++;
          // Wait 150ms before retrying
          await new Promise(r => setTimeout(r, 150));
        }
      }

      if (!session) {
        cachedUser = null;
        cachedAt = Date.now();
        return null;
      }

      // Fetch the profile from the 'app.users' table
      const { data: profile, error } = await sb
        .schema('app')
        .from('users')
        .select('id, email, full_name, role, status, wallet, referral_code')
        .eq('id', session.user.id)
        .single();

      if (error || !profile) {
        console.warn('[Auth] Profile fetch failed:', error);
        // NO FALLBACK to "User". Fail cleanly so the user is redirected to login.
        cachedUser = null;
        return null;
      }

      cachedUser = {
        id: profile.id,
        email: profile.email,
        name: profile.full_name, // This will be the REAL name
        role: profile.role,
        status: profile.status,
        wallet: profile.wallet || 0,
        referralCode: profile.referral_code
      };

      cachedAt = Date.now();
      return cachedUser;
    },

    requireLogin(options) {
      const opts = options || {};
      const user = Auth.getUser();
      if (!user) { window.location.replace(opts.redirect || 'portal.html'); return null; }
      if (opts.role && user.role !== opts.role) { window.location.replace('app.html'); return null; }
      return user;
    },

    redirectIfSignedIn(redirect) {
      const user = Auth.getUser();
      if (user) { window.location.replace(redirect || 'app.html'); return true; }
      return false;
    },

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

    refresh() { cachedUser = null; cachedAt = 0; },

    get MAX_AGE_MS() { return 30 * 24 * 60 * 60 * 1000; },
    get PORTAL_URL() { return 'portal.html'; },
    get APP_URL()    { return 'app.html'; }
  };

  window.Auth = Auth;
})();