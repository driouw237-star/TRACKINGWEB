/* ================================================================
   GlobalExpress — Reactive Store (Supabase Edition)
   ================================================================ */

(function () {
  'use strict';

  const state = {};
  const subscribers = new Map();
  const wildcard = new Set();

  function notify(key, value, previous) {
    const set = subscribers.get(key);
    if (set) set.forEach(cb => cb(value, previous, key));
    wildcard.forEach(cb => cb(value, previous, key));
  }

  const Store = {
    get(key, fallback) {
      return state[key] !== undefined ? state[key] : fallback;
    },

    set(key, value) {
      const previous = state[key];
      state[key] = value;
      notify(key, value, previous);
      return value;
    },

    on(key, cb) {
      if (!subscribers.has(key)) subscribers.set(key, new Set());
      subscribers.get(key).add(cb);
      return () => subscribers.get(key).delete(cb);
    },

    onAny(cb) {
      wildcard.add(cb);
      return () => wildcard.delete(cb);
    },

    async reloadUser() {
      if (!window.Auth) return null;
      const user = await window.Auth.resolve();
      Store.set('user', user);
      return user;
    },

    async reloadShipments() {
      const user = Store.get('user');
      if (!user || !window.supabaseClient) { Store.set('shipments', []); return []; }

      const { data, error } = await window.supabaseClient
        .from('shipments') // No schema() needed
        .select('*')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });

      if (error) { console.error('[Store] shipments load failed', error); return []; }

      const mapped = data.map(r => ({
        id: r.id,
        trackingCode: r.tracking_code,
        createdBy: r.created_by,
        status: r.status,
        originCity: r.origin_city,
        destCity: r.dest_city,
        currentLocation: r.current_location,
        estimatedDelivery: r.estimated_delivery,
        packageType: r.package_type,
        weight: r.weight,
        dimensions: r.dimensions,
        contents: r.contents,
        serviceLevel: r.service_level,
        handling: r.handling,
        amountPaid: r.amount_paid,
        insured: r.insured,
        senderName: r.sender_name,
        senderEmail: r.sender_email,
        senderPhone: r.sender_phone,
        senderAddress: r.sender_address,
        receiverName: r.receiver_name,
        receiverEmail: r.receiver_email,
        receiverPhone: r.receiver_phone,
        receiverAddress: r.receiver_address,
        coords: r.coords,
        activities: r.activities,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));

      Store.set('shipments', mapped);
      return mapped;
    },

    async reloadPayments() {
      const user = Store.get('user');
      if (!user || !window.supabaseClient) { Store.set('payments', []); return []; }

      const { data, error } = await window.supabaseClient
        .from('payments')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) return [];

      const mapped = data.map(r => ({
        id: r.id,
        userId: r.user_id,
        amount: r.amount,
        method: r.method,
        kind: r.kind,
        status: r.status,
        ref: r.reference,
        at: r.created_at
      }));

      Store.set('payments', mapped);
      return mapped;
    },

    async reloadWalletTxns() {
      const user = Store.get('user');
      if (!user || !window.supabaseClient) { Store.set('walletTxns', []); return []; }

      const { data, error } = await window.supabaseClient
        .from('wallet_txns')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) return [];

      const mapped = data.map(r => ({
        id: r.id,
        userId: r.user_id,
        type: r.type,
        amount: r.amount,
        balanceAfter: r.balance_after,
        description: r.description,
        ref: r.reference,
        at: r.created_at
      }));

      Store.set('walletTxns', mapped);
      return mapped;
    },

    async reloadNotifications() {
      const user = Store.get('user');
      if (!user || !window.supabaseClient) { Store.set('notifications', []); return []; }

      const { data, error } = await window.supabaseClient
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) return [];

      const mapped = data.map(r => ({
        id: r.id,
        userId: r.user_id,
        title: r.title,
        message: r.message,
        type: r.type,
        read: r.read,
        at: r.created_at
      }));

      Store.set('notifications', mapped);
      return mapped;
    },

    async reloadAll() {
      await Store.reloadUser();
      await Promise.all([
        Store.reloadShipments(),
        Store.reloadPayments(),
        Store.reloadWalletTxns(),
        Store.reloadNotifications()
      ]);
      return Store.snapshot();
    },

    snapshot() {
      return Object.assign({}, state);
    }
  };

  window.Store = Store;
})();