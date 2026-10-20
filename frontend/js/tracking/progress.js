/* ================================================================
   GlobalExpress — Tracking Progress Stepper
   Maps a shipment status string to a 5-step horizontal progress
   indicator. Depends on: nothing (pure string builder).
   Exposes: window.TrackingProgress
   ================================================================ */

(function () {
  'use strict';

  // --------------------------------------------------------------
  // STEP DEFINITIONS
  // The canonical five stages of a shipment's journey, in order.
  // To add/remove/reorder steps, change this array — everything
  // else in this file adapts automatically.
  // --------------------------------------------------------------
  const STEPS = [
    { key: 'processed', label: 'Order Processed',  icon: 'fa-clipboard-check' },
    { key: 'picked',    label: 'Picked Up',        icon: 'fa-box' },
    { key: 'transit',   label: 'In Transit',       icon: 'fa-truck' },
    { key: 'outford',   label: 'Out for Delivery', icon: 'fa-truck-fast' },
    { key: 'delivered', label: 'Delivered',        icon: 'fa-circle-check' }
  ];

  // --------------------------------------------------------------
  // STATUS → STAGE INDEX MAP
  // Given a status string, what step index (0-based) is the
  // shipment currently ON? The index corresponds to the step
  // that should get the `.active` (orange) treatment.
  //
  // All statuses map to an "on step N" meaning:
  //   Pending      → step 0 (Order Processed) is active
  //   In Transit   → step 2 (In Transit) is active
  //   On Hold      → step 2 (In Transit) is active but flagged
  //   Delivered    → all 5 steps done, nothing active
  //   Cancelled    → special-cased, nothing active
  // --------------------------------------------------------------
  function statusToStage(status) {
    const s = String(status || '').toLowerCase().trim();

    if (s === 'pending')    return 0;
    if (s === 'in transit') return 2;
    if (s === 'on hold')    return 2;
    if (s === 'delivered')  return STEPS.length; // beyond last = all done
    if (s === 'cancelled')  return -1;           // special: don't advance

    return 0; // Unknown status → treat as just-started
  }

  // --------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------

  /**
   * Escape user text. Step labels and icons are hardcoded (safe),
   * but if you ever decide to allow custom step labels, this is
   * already here.
   */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[c];
    });
  }

  /**
   * Compute the state ("done", "active", or "pending") for each
   * step, given the current stage index.
   *
   * @param {number} stage  - Index of the currently active step
   *                          (0-based), or STEPS.length if fully
   *                          delivered, or -1 for cancelled.
   * @returns {Array<{state: string}>}
   */
  function computeStepStates(stage) {
    return STEPS.map(function (_, i) {
      // Cancelled: only step 0 is "done" (order was processed),
      // nothing active, rest pending.
      if (stage === -1) {
        return { state: i === 0 ? 'done' : 'pending' };
      }

      // Fully delivered: every step is done, none is active.
      if (stage >= STEPS.length) {
        return { state: 'done' };
      }

      // Linear case: steps before the current stage are done,
      // the current stage is active, the rest are pending.
      if (i < stage)     return { state: 'done' };
      if (i === stage)   return { state: 'active' };
      return { state: 'pending' };
    });
  }

  /**
   * Calculate the fill width for the connecting line, as a
   * percentage of the total line width.
   *
   * The line runs from the *center* of the first step's dot to
   * the *center* of the last step's dot. So being on step 0
   * should show 0% fill (nothing to the left of the first dot),
   * and being on step 4 should show 100% fill.
   *
   * With 5 steps, there are 4 intervals between them. Being on
   * step N means the fill has traveled N of those intervals.
   *   - step 0 → 0%
   *   - step 1 → 25%
   *   - step 2 → 50%
   *   - step 3 → 75%
   *   - step 4 → 100%
   *
   * When the shipment is delivered (stage 5), we clamp to 100%.
   * When cancelled (stage -1), we show 0%.
   *
   * @param {number} stage
   * @returns {number} percentage 0-100
   */
  function computeFillPercent(stage) {
    if (stage === -1) return 0;
    if (stage >= STEPS.length) return 100;

    const intervals = STEPS.length - 1;   // 4 intervals for 5 steps
    if (intervals <= 0) return 0;

    const percent = (stage / intervals) * 100;

    // Clamp to [0, 100] — defensive
    return Math.max(0, Math.min(100, percent));
  }

  /**
   * Human-friendly label for the shipment's current status.
   * Used as an optional caption under the stepper.
   */
  function statusLabel(status) {
    const s = String(status || '').trim();
    if (!s) return 'Status unknown';

    // Capitalize each word and preserve spacing
    return s.replace(/\w\S*/g, function (t) {
      return t.charAt(0).toUpperCase() + t.substr(1).toLowerCase();
    });
  }

  // --------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------
  const TrackingProgress = {

    /**
     * Render the progress stepper for a shipment status.
     *
     * @param {string} status - Shipment status
     *        (one of: 'Pending', 'In Transit', 'On Hold',
     *                  'Delivered', 'Cancelled')
     * @param {Object} [options]
     * @param {boolean} [options.showLabels=true] - Show step labels
     * @returns {string} HTML string ready for `.innerHTML`
     */
    render(status, options) {
      const opts = options || {};
      const showLabels = opts.showLabels !== false;

      const stage = statusToStage(status);
      const states = computeStepStates(stage);
      const fillPct = computeFillPercent(stage);

      // Build each step block
      const stepsHtml = STEPS.map(function (step, i) {
        const state = states[i].state;
        return `
          <div class="step ${state}" data-step-index="${i}">
            <div class="step-icon">
              <i class="fas ${esc(step.icon)}"></i>
            </div>
            ${showLabels
              ? `<div class="step-label">${esc(step.label)}</div>`
              : ''}
          </div>`;
      }).join('');

      // Build the connecting fill bar
      const fillHtml = `<div class="steps-fill" style="width:${fillPct}%"></div>`;

      return fillHtml + stepsHtml;
    },

    /**
     * Returns a numeric progress percentage (0-100) for a given
     * status. Useful for rendering a small percentage bar elsewhere
     * (e.g., "Progress: 60%").
     *
     * @param {string} status
     * @returns {number}
     */
    percent(status) {
      const stage = statusToStage(status);
      const fill = computeFillPercent(stage);
      return Math.round(fill);
    },

    /**
     * Returns a human-readable label for the current status.
     *
     * @param {string} status
     * @returns {string}
     */
    label(status) {
      return statusLabel(status);
    },

    /**
     * Returns true if the shipment is in a terminal state —
     * nothing more will happen.
     *
     * @param {string} status
     * @returns {boolean}
     */
    isTerminal(status) {
      const s = String(status || '').toLowerCase().trim();
      return s === 'delivered' || s === 'cancelled';
    },

    /**
     * Expose the step definitions to callers who need to inspect
     * them (e.g., an admin "add activity" form that needs to pick
     * a step to set as the new status).
     */
    steps: STEPS.slice(),

    /**
     * Expose the raw stage index for a status. Mostly useful in
     * tests and debugging.
     */
    stageOf: statusToStage
  };

  // Expose to window
  window.TrackingProgress = TrackingProgress;

})();