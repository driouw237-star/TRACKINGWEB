/* ================================================================
   GlobalExpress — Realtime
   Domain-event bus for the customer app. Bridges raw storage
   events into named events views can subscribe to.
   Loaded after store.js, before router.js and page modules.
   Depends on: nothing (self-contained)
   Exposes: window.Realtime
   ================================================================ */

(function () {
  'use strict';

  // ================================================================
  // DEPENDENCIES (optional)
  // ================================================================
  const Store = window.Store || null;
  const Auth  = window.Auth  || null;

  // ================================================================
  // STORAGE KEYS — must match the rest of the app
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

  // Reverse map: raw storage key → short name
  const KEY_TO_NAME = {};
  Object.keys(KEYS).forEach(function (name) {
    KEY_TO_NAME[KEYS[name]] = name;
  });

  // ================================================================
  // EVENT BUS
  // Map<eventName, Set<callback>>
  // ================================================================
  const listeners = new Map();

  function addListener(eventName, cb) {
    if (typeof cb !== 'function') return function () {};
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName).add(cb);
    return function off() {
      const set = listeners.get(eventName);
      if (set) set.delete(cb);
    };
  }

  function emit(eventName, payload, meta) {
    const set = listeners.get(eventName);
    const wild = listeners.get('*');
    if (!set && !wild) return;

    const event = {
      name:    eventName,
      payload: payload,
      meta:    meta || {},
      at:      Date.now()
    };

    if (set) {
      set.forEach(function (cb) {
        try { cb(payload, event); }
        catch (e) { console.error('[Realtime] listener error for', eventName, e); }
      });
    }

    if (wild) {
      wild.forEach(function (cb) {
        try { cb(payload, event); }
        catch (e) { console.error('[Realtime] wildcard error', e); }
      });
    }
  }

  // ================================================================
  // DEBOUNCE
  // Coalesce rapid-fire events with the same name into one emit
  // per 50ms. The LATEST payload wins.
  // ================================================================
  const pendingEmits = new Map();   // Map<eventName, timeoutId>
  const payloadCache = new Map();   // Map<eventName, { payload, meta }>

  function scheduleEmit(eventName, payload, meta) {
    // Stash the latest payload for this event name
    payloadCache.set(eventName, { payload: payload, meta: meta });

    // If a timer is already pending for this name, let it fire
    if (pendingEmits.has(eventName)) return;

    pendingEmits.set(eventName, setTimeout(function () {
      const cached = payloadCache.get(eventName);
      payloadCache.delete(eventName);
      pendingEmits.delete(eventName);
      if (cached) emit(eventName, cached.payload, cached.meta);
    }, 50));
  }

  // ================================================================
  // DOMAIN-SPECIFIC DIFF LOGIC
  // Given a change to a storage key, compute what domain events
  // should fire.
  // ================================================================
  function handleStorageChange(rawKey, oldValue, newValue) {
    const name = KEY_TO_NAME[rawKey];
    if (!name) return;

    if (name === 'session') {
      if (!newValue && oldValue) {
        scheduleEmit('session:changed', { signedOut: true });
      } else if (newValue && !oldValue) {
        scheduleEmit('session:changed', { signedIn: true, session: newValue });
      } else {
        scheduleEmit('session:changed', { session: newValue });
      }
      return;
    }

    if (name === 'users')         { handleUsersChange(oldValue, newValue); return; }
    if (name === 'shipments')     { handleShipmentsChange(oldValue, newValue); return; }
    if (name === 'notifications') { handleNotificationsChange(oldValue, newValue); return; }
    if (name === 'walletTxns')    { handleWalletTxnsChange(oldValue, newValue); return; }
    if (name === 'payments')      { handlePaymentsChange(oldValue, newValue); return; }
    // addresses / tickets / audit have no diff logic — writers emit
    // explicit domain events via notifyLocalChange.
  }

  function asArray(v) { return Array.isArray(v) ? v : []; }

  function currentUserId() {
    if (Auth) {
      const u = Auth.getUser();
      return u ? u.id : null;
    }
    try {
      const s = JSON.parse(localStorage.getItem(KEYS.session) || 'null');
      return s && s.userId ? s.userId : null;
    } catch (e) { return null; }
  }

  function handleUsersChange(oldValue, newValue) {
    const uid = currentUserId();
    if (!uid) return;

    const before = asArray(oldValue).find(function (u) { return u.id === uid; });
    const after  = asArray(newValue).find(function (u) { return u.id === uid; });

    if (!before && after) {
      scheduleEmit('user:created', after);
      return;
    }
    if (before && !after) {
      scheduleEmit('user:deleted', before);
      return;
    }
    if (before && after && JSON.stringify(before) !== JSON.stringify(after)) {
      if ((before.wallet || 0) !== (after.wallet || 0)) {
        scheduleEmit('wallet:changed', {
          userId: uid,
          balance: after.wallet || 0,
          previous: before.wallet || 0,
          delta: (after.wallet || 0) - (before.wallet || 0)
        });
      }
      scheduleEmit('user:changed', after);
    }
  }

  function handleShipmentsChange(oldValue, newValue) {
    const uid = currentUserId();
    if (!uid) return;

    const before = asArray(oldValue).filter(function (s) { return s.createdBy === uid; });
    const after  = asArray(newValue).filter(function (s) { return s.createdBy === uid; });

    const beforeIds = new Set(before.map(function (s) { return s.trackingCode; }));
    const afterIds  = new Set(after.map(function (s)  { return s.trackingCode; }));

    after.forEach(function (s) {
      if (!beforeIds.has(s.trackingCode)) scheduleEmit('shipment:created', s);
    });

    before.forEach(function (s) {
      if (!afterIds.has(s.trackingCode)) scheduleEmit('shipment:deleted', s);
    });

    after.forEach(function (a) {
      const b = before.find(function (s) { return s.trackingCode === a.trackingCode; });
      if (b && JSON.stringify(a) !== JSON.stringify(b)) {
        scheduleEmit('shipment:updated', a);
      }
    });
  }

  function handleNotificationsChange(oldValue, newValue) {
    const uid = currentUserId();
    if (!uid) return;

    const before = asArray(oldValue).filter(function (n) { return n.userId === uid; });
    const after  = asArray(newValue).filter(function (n) { return n.userId === uid; });

    const beforeIds = new Set(before.map(function (n) { return n.id; }));

    after.forEach(function (n) {
      if (!beforeIds.has(n.id)) scheduleEmit('notification:new', n);
    });
  }

  function handleWalletTxnsChange(oldValue, newValue) {
    const uid = currentUserId();
    if (!uid) return;

    const before = asArray(oldValue).filter(function (t) { return t.userId === uid; });
    const after  = asArray(newValue).filter(function (t) { return t.userId === uid; });

    const beforeIds = new Set(before.map(function (t) { return t.id; }));

    after.forEach(function (t) {
      if (!beforeIds.has(t.id)) scheduleEmit('wallet:txn', t);
    });
  }

  function handlePaymentsChange(oldValue, newValue) {
    const uid = currentUserId();
    if (!uid) return;

    const before = asArray(oldValue).filter(function (p) { return p.userId === uid; });
    const after  = asArray(newValue).filter(function (p) { return p.userId === uid; });

    const beforeIds = new Set(before.map(function (p) { return p.id; }));

    after.forEach(function (p) {
      if (!beforeIds.has(p.id)) scheduleEmit('payment:new', p);
    });
  }

  // ================================================================
  // STORAGE LISTENER
  // Fires only in OTHER tabs (not the one that made the change).
  // ================================================================
  function attachStorageListener() {
    window.addEventListener('storage', function (e) {
      if (!e.key) return;
      if (!Object.prototype.hasOwnProperty.call(KEY_TO_NAME, e.key)) return;

      let oldValue = null;
      let newValue = null;
      try { oldValue = e.oldValue  ? JSON.parse(e.oldValue)  : null; } catch (x) {}
      try { newValue = e.newValue ? JSON.parse(e.newValue) : null; } catch (x) {}

      handleStorageChange(e.key, oldValue, newValue);
    });
  }

  // ================================================================
  // LOCAL BRIDGE — polymorphic
  // ================================================================
  //
  // Writers in THIS tab call this after writing to localStorage.
  // Accepts two shapes:
  //
  //   A) Raw storage key form (simulates a cross-tab storage event):
  //        Realtime.notifyLocalChange('ge_shipments', oldVal, newVal)
  //
  //   B) Domain event form (fires the event directly):
  //        Realtime.notifyLocalChange('shipment:created', payload)
  //
  // We detect by checking whether the first argument starts with 'ge_'.
  //
  function notifyLocalChange(rawKeyOrEvent, oldValueOrPayload, newValue) {
    if (typeof rawKeyOrEvent !== 'string') return;

    // Form B: domain event name (contains ':' or doesn't start with 'ge_')
    const isRawKey = rawKeyOrEvent.indexOf('ge_') === 0
                  && Object.prototype.hasOwnProperty.call(KEY_TO_NAME, rawKeyOrEvent);

    if (isRawKey) {
      // Form A — simulate a storage change
      handleStorageChange(rawKeyOrEvent, oldValueOrPayload, newValue);
      return;
    }

    // Form B — fire the domain event directly.
    // If a 2nd arg was provided, treat it as the payload.
    const eventName = rawKeyOrEvent;
    const payload   = oldValueOrPayload;
    emit(eventName, payload, { local: true });
  }

  // ================================================================
  // PUBLIC API
  // ================================================================
  const Realtime = {

    on(eventName, cb) {
      return addListener(eventName, cb);
    },

    once(eventName, cb) {
      const off = addListener(eventName, function (payload, event) {
        off();
        cb(payload, event);
      });
      return off;
    },

    onMany(eventNames, cb) {
      if (!Array.isArray(eventNames)) return function () {};
      const offs = eventNames.map(function (name) {
        return addListener(name, cb);
      });
      return function off() { offs.forEach(function (o) { o(); }); };
    },

    emit: emit,

    /**
     * Fire a domain event immediately (no debounce). Use this when
     * the caller needs synchronous delivery — e.g. tests, or a
     * "just did X, refresh now" scenario.
     */
    emitNow(eventName, payload, meta) {
      emit(eventName, payload, meta);
    },

    /**
     * Called by writers in this tab to simulate a storage event or
     * to fire a domain event directly. See the polymorphic contract
     * above.
     */
    notifyLocalChange: notifyLocalChange,

    hasListeners(eventName) {
      return (listeners.has(eventName) && listeners.get(eventName).size > 0)
          || (listeners.has('*') && listeners.get('*').size > 0);
    },

    clear(eventName) {
      if (eventName) listeners.delete(eventName);
      else listeners.clear();
    },

    eventNames() {
      return Array.from(listeners.keys());
    },

    KEYS: Object.assign({}, KEYS)
  };

  // ================================================================
  // WIRE UP
  // ================================================================
  attachStorageListener();

  // If Store exists, subscribe to its changes so views can choose
  // either API. Each Store change emits a parallel Realtime event.
  if (Store && typeof Store.onAny === 'function') {
    Store.onAny(function (value, previous, key) {
      if (key === 'user' && value) {
        if (previous && (previous.wallet || 0) !== (value.wallet || 0)) {
          scheduleEmit('wallet:changed', {
            userId: value.id,
            balance: value.wallet || 0,
            previous: previous.wallet || 0,
            delta: (value.wallet || 0) - (previous.wallet || 0)
          });
        }
        emit('user:changed', value);
      }
      if (key === 'shipments')     emit('shipments:refresh', value);
      if (key === 'notifications') emit('notifications:refresh', value);
      if (key === 'walletTxns')    emit('walletTxns:refresh', value);
    });
  }

  // ================================================================
  // Expose to window
  // ================================================================
  window.Realtime = Realtime;

})();