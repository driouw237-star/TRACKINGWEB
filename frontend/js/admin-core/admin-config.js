/* ================================================================
   GlobalExpress — Admin Core: Config
   ================================================================
   Shared constants for the admin console. The NAV array lives in
   admin.js because the bootstrap reads it directly for the sidebar,
   but every other shared value lives here.
   ================================================================ */

(function (global) {
  'use strict';

  var AdminConfig = {
    // Route names must match PagesAdmin keys registered by
    // js/pages-admin/*.js
    ROUTES: [
      'dashboard', 'users', 'user-detail', 'user-create',
      'shipments', 'shipment-detail', 'shipment-create',
      'payments', 'payment-detail', 'payment-refund',
      'wallet', 'wallet-adjust',
      'tickets', 'ticket-detail',
      'notifications', 'audit', 'settings',
      'health', 'backup'
    ],

    // SLA targets in minutes for ticket priorities (used by tickets.js)
    SLA: {
      urgent: 60,     // 1 hour
      high:   240,    // 4 hours
      normal: 1440,   // 24 hours
      low:    4320    // 72 hours
    },

    // Alert thresholds (used by dashboard.js)
    ALERTS: {
      failedPayments24h:  1,
      stuckShipmentDays:  7,
      minWalletBalance:   0
    },

    // Currency formatting (used by money formatters)
    CURRENCY: {
      symbol: 'Fr.',
      code:   'XAF',
      locale: 'en-US'
    },

    // Pagination defaults (used by DataTable)
    PAGE_SIZE:       20,
    PAGE_SIZE_OPTS:  [10, 20, 50, 100],

    // Realtime event names the admin console subscribes to
    REALTIME_EVENTS: [
      'shipment:created', 'shipment:updated', 'shipment:deleted',
      'payment:created',  'payment:refunded',
      'wallet:changed',   'user:changed', 'user:created', 'user:deleted',
      'ticket:created',   'ticket:updated',
      'audit:created',    'settings:changed', 'session:changed'
    ]
  };

  // Expose globally for easy access in pages
  global.AdminConfig = AdminConfig;

  // Attach to the Admin namespace for namespaced access
  global.Admin = global.Admin || {};
  global.Admin.Config = AdminConfig;

})(window);