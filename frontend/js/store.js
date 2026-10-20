/* ================================================================
   GlobalExpress — Reactive Store
   In-memory state + pub/sub for the customer app and admin console.
   Loaded after auth.js, before router.js and app.js.
   Depends on: window.Auth (for user identity)
   Exposes: window.Store
   ================================================================ */

(function () {
  'use strict';

  // ================================================================
  // DEPENDENCIES
  // ================================================================
  const Auth = window.Auth || null;
  const Data = window.Data || null;

  // ================================================================
  // STORAGE KEYS
  // ================================================================
  const KEYS = {
    users:         'ge_users',
    session:       'ge_session',
    shipments:     'ge_shipments',
    payments:      'ge_payments',
    walletTxns:    'ge_wallet_txns',
    addresses:     'ge_addresses',
    notifications: 'ge_notifications',
    tickets:       'ge_tickets',
    audit:         'ge_audit'
  };

  // ================================================================
  // INTERNAL STATE
  // ================================================================
  const state = {};

  // ================================================================
  // SUBSCRIBERS
  // ================================================================
  const subscribers = new Map();
  const wildcard = new Set();

  // ================================================================
  // STORAGE HELPERS
  // ================================================================
  const storage = {
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
    }
  };

  // ================================================================
  // EVENT DISPATCH
  // ================================================================
  function notify(key, value, previous) {
    const set = subscribers.get(key);
    if (set) {
      set.forEach(function (cb) {
        try { cb(value, previous, key); }
        catch (e) { console.error('[Store] subscriber error for', key, e); }
      });
    }
    wildcard.forEach(function (cb) {
      try { cb(value, previous, key); }
      catch (e) { console.error('[Store] wildcard subscriber error', e); }
    });
  }

  // ================================================================
  // PUBLIC API
  // ================================================================
  const Store = {

    // ------------------------------------------------------------
    // READ
    // ------------------------------------------------------------
    get(key, fallback) {
      return Object.prototype.hasOwnProperty.call(state, key)
        ? state[key]
        : fallback;
    },

    has(key) {
      return Object.prototype.hasOwnProperty.call(state, key);
    },

    snapshot() {
      return Object.assign({}, state);
    },

    // ------------------------------------------------------------
    // WRITE
    // ------------------------------------------------------------
    set(key, value, options) {
      const previous = state[key];
      const hadPrevious = Object.prototype.hasOwnProperty.call(state, key);

      if (hadPrevious && Object.is(previous, value)) {
        return value;
      }

      state[key] = value;

      if (!options || !options.silent) {
        notify(key, value, hadPrevious ? previous : undefined);
      }

      return value;
    },

    unset(key) {
      if (!Object.prototype.hasOwnProperty.call(state, key)) return;
      const previous = state[key];
      delete state[key];
      notify(key, undefined, previous);
    },

    merge(obj) {
      Object.keys(obj).forEach(function (k) {
        Store.set(k, obj[k]);
      });
    },

    // ------------------------------------------------------------
    // SUBSCRIBE
    // ------------------------------------------------------------
    on(key, cb) {
      if (typeof cb !== 'function') return function () {};
      if (!subscribers.has(key)) subscribers.set(key, new Set());
      subscribers.get(key).add(cb);
      return function off() {
        const set = subscribers.get(key);
        if (set) set.delete(cb);
      };
    },

    onAny(cb) {
      if (typeof cb !== 'function') return function () {};
      wildcard.add(cb);
      return function off() { wildcard.delete(cb); };
    },

    onImmediate(key, cb) {
      if (Store.has(key)) {
        try { cb(state[key], undefined, key); }
        catch (e) { console.error('[Store] immediate callback error', e); }
      }
      return Store.on(key, cb);
    },

    // ------------------------------------------------------------
    // DOMAIN: USER
    // ------------------------------------------------------------

    /**
     * Reload the current user from storage into the store.
     */
    reloadUser() {
      if (!Auth) return null;
      Auth.refresh();
      const user = Auth.getUser();
      Store.set('user', user);
      return user;
    },

    /**
     * Persist a mutation to the current user and refresh the store.
     *
     * Accepts EITHER:
     *   - a mutator function:  Store.updateUser(u => { u.wallet += 500; })
     *   - a partial object:    Store.updateUser({ wallet: 500 })
     *
     * The function form receives a DRAFT copy (so mutating it does
     * not touch the live store until we commit). If the function
     * returns an object, that object is used as the next user.
     */
    updateUser(mutatorOrPatch) {
      if (mutatorOrPatch == null) return null;

      const user = Store.get('user') || (Auth && Auth.getUser());
      if (!user) return null;

      // Build the next user object
      let next;
      if (typeof mutatorOrPatch === 'function') {
        const draft = Object.assign({}, user);
        const result = mutatorOrPatch(draft);
        next = (result && typeof result === 'object') ? result : draft;
      } else if (typeof mutatorOrPatch === 'object') {
        next = Object.assign({}, user, mutatorOrPatch);
      } else {
        return null;
      }

      // Persist to ge_users
      const users = storage.get(KEYS.users, []);
      const idx = users.findIndex(function (u) { return u.id === next.id; });
      if (idx !== -1) {
        users[idx] = next;
        storage.set(KEYS.users, users);
      }

      // Refresh auth cache and store
      if (Auth) Auth.refresh();
      Store.set('user', next);

      return next;
    },

    getWalletBalance() {
      const u = Store.get('user') || (Auth && Auth.getUser());
      return u ? (u.wallet || 0) : 0;
    },

    // ------------------------------------------------------------
    // DOMAIN: SHIPMENTS
    // ------------------------------------------------------------
    reloadShipments() {
      const user = Store.get('user') || (Auth && Auth.getUser());
      if (!user) {
        Store.set('shipments', []);
        return [];
      }
      const all = storage.get(KEYS.shipments, []);
      const mine = all.filter(function (s) { return s.createdBy === user.id; });
      Store.set('shipments', mine);
      return mine;
    },

    // ------------------------------------------------------------
    // DOMAIN: NOTIFICATIONS
    // ------------------------------------------------------------
    reloadNotifications() {
      const user = Store.get('user') || (Auth && Auth.getUser());
      if (!user) {
        Store.set('notifications', []);
        return [];
      }
      const all = storage.get(KEYS.notifications, []);
      const mine = all.filter(function (n) { return n.userId === user.id; });
      Store.set('notifications', mine);
      return mine;
    },

    // ------------------------------------------------------------
    // DOMAIN: WALLET TRANSACTIONS
    // ------------------------------------------------------------
    reloadWalletTxns() {
      const user = Store.get('user') || (Auth && Auth.getUser());
      if (!user) {
        Store.set('walletTxns', []);
        return [];
      }
      const all = storage.get(KEYS.walletTxns, []);
      const mine = all.filter(function (t) { return t.userId === user.id; });
      Store.set('walletTxns', mine);
      return mine;
    },

    // ------------------------------------------------------------
    // DOMAIN: ADDRESSES  (NEW)
    // ------------------------------------------------------------
    reloadAddresses() {
      const user = Store.get('user') || (Auth && Auth.getUser());
      if (!user) {
        Store.set('addresses', []);
        return [];
      }
      const all = storage.get(KEYS.addresses, []);
      const mine = all.filter(function (a) { return a.userId === user.id; });
      Store.set('addresses', mine);
      return mine;
    },

    // ------------------------------------------------------------
    // DOMAIN: PAYMENTS  (NEW)
    // ------------------------------------------------------------
    reloadPayments() {
      const user = Store.get('user') || (Auth && Auth.getUser());
      if (!user) {
        Store.set('payments', []);
        return [];
      }
      const all = storage.get(KEYS.payments, []);
      const mine = all.filter(function (p) { return p.userId === user.id; });
      Store.set('payments', mine);
      return mine;
    },

    // ------------------------------------------------------------
    // DOMAIN: TICKETS  (NEW)
    // ------------------------------------------------------------
    reloadTickets() {
      const user = Store.get('user') || (Auth && Auth.getUser());
      if (!user) {
        Store.set('tickets', []);
        return [];
      }
      const all = storage.get(KEYS.tickets, []);
      const mine = all.filter(function (t) { return t.userId === user.id; });
      Store.set('tickets', mine);
      return mine;
    },

    // ------------------------------------------------------------
    // DOMAIN: SESSION
    // ------------------------------------------------------------
    reloadSession() {
      const session = storage.get(KEYS.session, null);
      Store.set('session', session);
      return session;
    },

    // ------------------------------------------------------------
    // RELOAD EVERYTHING
    // ------------------------------------------------------------
    reloadAll() {
      Store.reloadSession();
      Store.reloadUser();
      Store.reloadShipments();
      Store.reloadNotifications();
      Store.reloadWalletTxns();
      Store.reloadAddresses();
      Store.reloadPayments();
      Store.reloadTickets();
      return Store.snapshot();
    },

    // ------------------------------------------------------------
    // MAINTENANCE
    // ------------------------------------------------------------
    clear() {
      Object.keys(state).forEach(function (k) {
        const prev = state[k];
        delete state[k];
        notify(k, undefined, prev);
      });
    },

    KEYS: Object.assign({}, KEYS)
  };

  // ================================================================
  // STORAGE EVENT BRIDGE
  // ================================================================
  window.addEventListener('storage', function (e) {
    if (!e.key) return;

    const map = {};
    map[KEYS.users]         = 'user';
    map[KEYS.session]       = 'session';
    map[KEYS.shipments]     = 'shipments';
    map[KEYS.notifications] = 'notifications';
    map[KEYS.walletTxns]    = 'walletTxns';
    map[KEYS.addresses]     = 'addresses';
    map[KEYS.payments]      = 'payments';
    map[KEYS.tickets]       = 'tickets';

    const storeKey = map[e.key];
    if (!storeKey) return;

    if (Auth) Auth.refresh();

    if (storeKey === 'user' || storeKey === 'session') {
      Store.reloadSession();
      Store.reloadUser();
    } else if (storeKey === 'shipments') {
      Store.reloadShipments();
    } else if (storeKey === 'notifications') {
      Store.reloadNotifications();
    } else if (storeKey === 'walletTxns') {
      Store.reloadWalletTxns();
    } else if (storeKey === 'addresses') {
      Store.reloadAddresses();
    } else if (storeKey === 'payments') {
      Store.reloadPayments();
    } else if (storeKey === 'tickets') {
      Store.reloadTickets();
    }
  });

  // ================================================================
  // Expose to window
  // ================================================================
  window.Store = Store;

})();