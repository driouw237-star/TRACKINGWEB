/* ================================================================
   GlobalExpress — Tracking Timeline Renderer
   Turns an array of shipment activities into the HTML that
   tracking.css already styles (.timeline, .tl-item, etc).
   Depends on: nothing (pure string builder)
   Exposes: window.TrackingTimeline
   ================================================================ */

(function () {
  'use strict';

  // --------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------

  /**
   * Escape any user-supplied string before dropping it into HTML.
   * Every value we render (location, description, date) passes
   * through this. No exceptions.
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
   * Fallback when a field is missing/empty. We use an em dash
   * rather than the word "unknown" — less alarming, more polished.
   */
  function fallback(value, replacement) {
    if (value === null || value === undefined) return replacement;
    const s = String(value).trim();
    return s.length === 0 ? replacement : value;
  }

  /**
   * Pick an icon for a timeline event based on keywords in its
   * description. Small touch, but it makes the timeline feel
   * alive — different events look different.
   *
   * Returns a Font Awesome icon class string.
   */
  function pickIcon(description) {
    const d = String(description || '').toLowerCase();

    if (d.indexOf('delivered') !== -1)        return 'fa-circle-check';
    if (d.indexOf('out for delivery') !== -1) return 'fa-truck-fast';
    if (d.indexOf('custom') !== -1)           return 'fa-passport';
    if (d.indexOf('hold') !== -1)             return 'fa-pause';
    if (d.indexOf('cancel') !== -1)           return 'fa-xmark';
    if (d.indexOf('arriv') !== -1)            return 'fa-location-dot';
    if (d.indexOf('depart') !== -1)           return 'fa-plane-departure';
    if (d.indexOf('pick') !== -1)             return 'fa-hand';
    if (d.indexOf('process') !== -1)          return 'fa-clipboard-check';
    if (d.indexOf('transit') !== -1)          return 'fa-truck';
    if (d.indexOf('register') !== -1)         return 'fa-pen-to-square';
    if (d.indexOf('clear') !== -1)            return 'fa-shield-check';

    return 'fa-circle-dot';   // generic default
  }

  // --------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------
  const TrackingTimeline = {

    /**
     * Render an activities array as a timeline HTML string.
     *
     * @param {Array} activities - Array of {date, location, description}
     * @param {Object} [options] - Optional configuration
     * @param {string} [options.emptyMessage] - Text to show when empty
     * @param {string} [options.emptyIcon]    - Font Awesome icon for empty state
     * @param {boolean} [options.oldestFirst] - If true, reverses to oldest-first
     * @returns {string} HTML string ready to assign to innerHTML
     */
    render(activities, options) {
      const opts = options || {};
      const emptyMessage = opts.emptyMessage || 'No activity yet.';
      const emptyIcon    = opts.emptyIcon    || 'fa-clock-rotate-left';

      // Defensive: ensure activities is an array
      const list = Array.isArray(activities) ? activities.slice() : [];

      // Empty state — friendly, centered, doesn't look broken
      if (list.length === 0) {
        return `
          <div style="
            text-align: center;
            padding: 32px 20px;
            color: var(--text-3);
          ">
            <i class="fas ${esc(emptyIcon)}"
               style="font-size: 28px; opacity: 0.6; display: block; margin-bottom: 10px;"></i>
            <div style="font-size: 13px; font-weight: 500;">
              ${esc(emptyMessage)}
            </div>
          </div>`;
      }

      // Newest-first by default. Oldest-first if requested.
      const ordered = opts.oldestFirst ? list : list.slice().reverse();

      // Build each timeline item
      const items = ordered.map(function (activity, idx) {
        return TrackingTimeline._renderItem(activity, idx, ordered.length);
      }).join('');

      return `<div class="timeline">${items}</div>`;
    },

    /**
     * Render a single activity as a .tl-item block.
     * Public-ish (leading underscore) so callers can render one
     * item at a time — useful for "prepend a new activity" UX.
     *
     * @param {Object} activity - {date, location, description, lat?, lng?}
     * @param {number} index    - Position in the ordered list (0 = top)
     * @param {number} total    - Total number of items in the list
     * @returns {string} HTML string for one timeline item
     */
    _renderItem(activity, index, total) {
      const a = activity || {};

      // Escape every field. Missing values get em-dash fallbacks.
      const date        = esc(fallback(a.date, '—'));
      const location    = esc(fallback(a.location, '—'));
      const description = esc(fallback(a.description, '—'));

      // First item = the most recent = "latest". Everything else = "done".
      // (If oldestFirst was requested, the caller already reversed,
      // so index 0 is still the top item on screen — same logic.)
      const stateClass = index === 0 ? 'latest' : 'done';

      // Icon picked from description keywords
      const icon = pickIcon(a.description);

      // Optional coords → data attributes so a future "pan map on
      // click" feature can read them without re-parsing the DOM.
      const coordAttrs = (typeof a.lat === 'number' && typeof a.lng === 'number')
        ? ` data-lat="${a.lat}" data-lng="${a.lng}"`
        : '';

      // `title` attribute gives a hover tooltip for truncated text
      // on narrow screens.
      return `
        <div class="tl-item ${stateClass}"
             data-index="${index}"
             data-total="${total}"${coordAttrs}>
          <div class="tl-dot"></div>
          <div class="tl-date">
            <i class="fas ${esc(icon)}"
               style="margin-right: 6px; font-size: 10px; opacity: 0.8;"></i>
            ${date}
          </div>
          <div class="tl-loc" title="${location}">${location}</div>
          <div class="tl-desc">${description}</div>
        </div>`;
    },

    /**
     * Convenience: attach a click handler to all timeline items
     * in a container. When clicked, items with lat/lng dispatch
     * a `timeline-event-click` CustomEvent on the container with
     * {lat, lng, index} in the detail. Listeners (e.g. map.js
     * integration) can subscribe.
     *
     * This decouples the timeline from any particular consumer —
     * the timeline just emits events, and whoever cares listens.
     *
     * @param {HTMLElement|string} containerOrId
     */
    bindClicks(containerOrId) {
      const container = typeof containerOrId === 'string'
        ? document.getElementById(containerOrId)
        : containerOrId;

      if (!container) return;

      // Avoid double-binding on re-render
      if (container.__timelineBound) return;
      container.__timelineBound = true;

      container.addEventListener('click', function (e) {
        const item = e.target.closest('.tl-item');
        if (!item) return;

        const lat = parseFloat(item.getAttribute('data-lat'));
        const lng = parseFloat(item.getAttribute('data-lng'));

        // Emit an event regardless — listeners decide if they care
        container.dispatchEvent(new CustomEvent('timeline-event-click', {
          bubbles: true,
          detail: {
            index: parseInt(item.getAttribute('data-index'), 10),
            hasCoords: !isNaN(lat) && !isNaN(lng),
            lat: isNaN(lat) ? null : lat,
            lng: isNaN(lng) ? null : lng,
            element: item
          }
        }));
      });
    }
  };

  // Expose to window
  window.TrackingTimeline = TrackingTimeline;

})();