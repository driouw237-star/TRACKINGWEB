/* ================================================================
   GlobalExpress — Admin Core: Audit wrapper
   ================================================================
   Thin wrapper around Admin.logAudit() so pages can call
   AdminAudit.log(...) directly.

   Also provides AdminAudit.diff() — a helper that automatically
   calculates what changed between two objects and formats it
   nicely for the audit log.

   Depends on: window.Admin (from admin.js)
   ================================================================ */

(function (global) {
  'use strict';

  var AdminAudit = {
    /**
     * Log a simple action.
     * @param {string} action  e.g. 'user.suspended'
     * @param {string} target  e.g. 'user_123' or 'jane@example.com'
     * @param {string} details e.g. 'Suspended for suspected fraud'
     */
    log: function (action, target, details) {
      if (global.Admin && typeof global.Admin.logAudit === 'function') {
        return global.Admin.logAudit(action, target, details);
      }
      return null;
    },

    /**
     * Log a change with before/after comparison.
     * Automatically figures out which fields changed and formats
     * them as "field: old -> new".
     *
     * @param {string} action e.g. 'user.edited'
     * @param {string} target e.g. 'user_123'
     * @param {Object} before The original object
     * @param {Object} after  The new object
     */
    diff: function (action, target, before, after) {
      var details = 'Changed: ';

      if (!before || !after) {
        return AdminAudit.log(action, target, 'No diff data provided');
      }

      var changes = [];
      var keys = Object.keys(after);

      keys.forEach(function (k) {
        // Skip the object key entirely (don't log that it changed)
        if (k === 'password' || k === 'id') return;

        var oldVal = before[k];
        var newVal = after[k];

        // Deep compare (using JSON.stringify for simplicity with nested objects)
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          // Format values nicely (quotes for strings, null for empty)
          var fmtOld = oldVal === undefined ? 'undefined' : JSON.stringify(oldVal);
          var fmtNew = newVal === undefined ? 'undefined' : JSON.stringify(newVal);

          changes.push(k + ': ' + fmtOld + ' → ' + fmtNew);
        }
      });

      if (changes.length === 0) {
        return AdminAudit.log(action, target, 'No visible changes detected');
      }

      details += changes.join('; ');
      return AdminAudit.log(action, target, details);
    }
  };

  // Expose globally
  global.AdminAudit = AdminAudit;

  // Attach to Admin namespace
  global.Admin = global.Admin || {};
  global.Admin.Audit = AdminAudit;

})(window);