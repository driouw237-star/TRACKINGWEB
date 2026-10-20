/* ================================================================
   GlobalExpress — Auth Helper
   Shared session management for authenticated pages (app.html,
   admin.html, and their subviews). Loaded FIRST among JS files.
   Depends on: nothing (self-contained)
   Exposes: window.Auth
   ================================================================ */

(function () {
  'use strict';

  // ================================================================
  // STORAGE KEYS — must match portal.js and track.js
  // ================================================================
  const KEYS = {
    users:   'ge_users',
    session: 'ge_session'
  };

  // ================================================================
  // CONFIG
  // ================================================================

  // How long a session stays valid. After this, the user is
  // logged out on next page load. 30 days = a comfortable
  // "remember me" default.
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  // Where to send unauthenticated visitors. Same-folder relative
  // so it works on file:// as well as a real server.
  const PORTAL_URL = 'portal.html';

  // Where to send authenticated visitors who try to open the
  // portal again. Same-folder.
  const APP_URL = 'app.html';

  // ================================================================
  // STORAGE HELPERS — defensive against localStorage errors
  // ================================================================
  const store = {
    get(k, fallback) {
      try {
        const raw = localStorage.getItem(k);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
        return true;
      } catch (e) {
        return false;
      }
    },
    del(k) {
      try { localStorage.removeItem(k); return true; }
      catch (e) { return false; }
    }
  };

  // ================================================================
  // IN-MEMORY CACHE
  // We cache the resolved current user so repeated calls to
  // Auth.getUser() don't re-parse JSON on every invocation.
  // Cleared when the session changes (login, logout, cross-tab).
  // ================================================================
  let cachedUser = null;
  let cachedAt   = 0;
  const CACHE_TTL_MS = 2000;   // 2 seconds — enough for a burst
                               // of calls in one render pass

  function clearCache() {
    cachedUser = null;
    cachedAt   = 0;
  }

  // ================================================================
  // SESSION INTERNALS
  // ================================================================

  /**
   * Read the raw session object from localStorage.
   * Returns null if missing, malformed, or expired.
   */
  function readSession() {
    const session = store.get(KEYS.session, null);
    if (!session || typeof session !== 'object') return null;
    if (!session.userId) return null;

    // Expiry check
    if (typeof session.at === 'number' && session.at > 0) {
      const age = Date.now() - session.at;
      if (age > MAX_AGE_MS) {
        // Stale session — clean it up
        store.del(KEYS.session);
        return null;
      }
    }

    return session;
  }

  /**
   * Look up the user record referenced by the current session.
   * Returns null if the session doesn't exist or the user was
   * deleted (orphaned reference).
   */
  function readUserFromSession() {
    const session = readSession();
    if (!session) return null;

    const users = store.get(KEYS.users, []);
    if (!Array.isArray(users)) return null;

    const user = users.find(function (u) { return u.id === session.userId; });
    if (!user) {
      // Orphaned session — the user was deleted
      store.del(KEYS.session);
      return null;
    }

    return user;
  }

  /**
   * Update the session timestamp. Call this on meaningful user
   * activity to extend the "30-day" window. Optional.
   */
  function touchSession() {
    const session = readSession();
    if (!session) return;
    session.at = Date.now();
    store.set(KEYS.session, session);
    clearCache();
  }

  // ================================================================
  // PUBLIC API
  // ================================================================
  const Auth = {

    // ------------------------------------------------------------
    // READ
    // ------------------------------------------------------------

    /**
     * Get the currently signed-in user, or null.
     * Cached for CACHE_TTL_MS so rapid-fire calls are cheap.
     *
     * @returns {Object|null}
     */
    getUser() {
      // Serve from cache if fresh
      if (cachedUser && (Date.now() - cachedAt) < CACHE_TTL_MS) {
        return cachedUser;
      }

      cachedUser = readUserFromSession();
      cachedAt   = Date.now();
      return cachedUser;
    },

    /**
     * Alias for getUser(). Kept for API symmetry with the master
     * prompt's adapter interface.
     */
    getCurrentUser() {
      return Auth.getUser();
    },

    /**
     * Returns true if a valid user is signed in.
     */
    isSignedIn() {
      return Auth.getUser() !== null;
    },

    /**
     * Get the user's id, or null.
     */
    getUserId() {
      const u = Auth.getUser();
      return u ? u.id : null;
    },

    /**
     * Get the raw session object (with `at` timestamp).
     * Useful for "signed in since" displays.
     */
    getSession() {
      return readSession();
    },

    /**
     * Returns true if the current user is an administrator.
     * Always false if not signed in.
     */
    isAdmin() {
      const u = Auth.getUser();
      return u && u.role === 'admin';
    },

    // ------------------------------------------------------------
    // GUARDS
    // ------------------------------------------------------------

    /**
     * Require a signed-in user to continue. If not signed in,
     * redirect to the portal and return null. Callers should
     * check the return value:
     *
     *     const user = Auth.requireLogin();
     *     if (!user) return;   // redirected
     *
     * Optional options:
     *   { role: 'admin' }   — also require that role
     *   { redirect: 'x.html' } — custom redirect target
     *
     * @param {Object} [options]
     * @returns {Object|null}
     */
    requireLogin(options) {
      const opts = options || {};
      const user = Auth.getUser();

      if (!user) {
        // Not signed in — bounce to portal
        const target = opts.redirect || PORTAL_URL;
        window.location.replace(target);
        return null;
      }

      // Role check
      if (opts.role && user.role !== opts.role) {
        // Not allowed — send them to the right place
        if (user.role === 'admin') {
          // Admin on a customer-only page → admin console
          window.location.replace('admin.html');
        } else {
          // Non-admin on an admin-only page → customer app
          window.location.replace(APP_URL);
        }
        return null;
      }

      return user;
    },

    /**
     * If a user is already signed in, redirect them away from
     * this page. Useful for the portal itself, which shouldn't be
     * shown to signed-in users.
     *
     * @param {string} [redirect] — where to send signed-in users
     * @returns {boolean} — true if redirected, false if not signed in
     */
    redirectIfSignedIn(redirect) {
      const user = Auth.getUser();
      if (user) {
        window.location.replace(redirect || APP_URL);
        return true;
      }
      return false;
    },

    // ------------------------------------------------------------
    // WRITE
    // ------------------------------------------------------------

    /**
     * Sign out the current user. Clears the session and cache.
     * Does NOT redirect — the caller decides where to go next.
     */
    logout() {
      store.del(KEYS.session);
      clearCache();
    },

    /**
     * Sign out and immediately redirect to the portal.
     */
    logoutAndRedirect(target) {
      Auth.logout();
      window.location.replace(target || PORTAL_URL);
    },

    /**
     * Persist a new session for the given user. Used by portal.js
     * after a successful login or signup. Also callable from tests.
     *
     * @param {Object} user — full user object with an id
     */
    signInAs(user) {
      if (!user || !user.id) return false;
      store.set(KEYS.session, { userId: user.id, at: Date.now() });
      clearCache();
      return true;
    },

    /**
     * Refresh the session timestamp. Optional — call this when the
     * user does something meaningful (creates a shipment, opens a
     * page) to slide the 30-day window forward.
     */
    touch() {
      touchSession();
    },

    // ------------------------------------------------------------
    // MAINTENANCE
    // ------------------------------------------------------------

    /**
     * Clear the session cache. Call this if you've just written
     * to localStorage directly and want subsequent Auth.getUser()
     * calls to reflect the change immediately.
     */
    refresh() {
      clearCache();
    },

    // ------------------------------------------------------------
    // CONFIG EXPOSURE (read-only)
    // ------------------------------------------------------------
    get MAX_AGE_MS() { return MAX_AGE_MS; },
    get PORTAL_URL() { return PORTAL_URL; },
    get APP_URL()    { return APP_URL; }
  };

  // ================================================================
  // CROSS-TAB SYNC
  // When the user signs out (or signs in) in another tab, the
  // `storage` event fires here. We clear the cache so the next
  // Auth.getUser() re-reads from localStorage.
  // ================================================================
  window.addEventListener('storage', function (e) {
    if (!e.key) return;
    if (e.key === KEYS.session || e.key === KEYS.users) {
      clearCache();
    }
  });

  // ================================================================
  // Expose to window
  // ================================================================
  window.Auth = Auth;

})();