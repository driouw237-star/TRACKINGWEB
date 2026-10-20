/* ================================================================
   GlobalExpress — Shared Utilities
   Pure helpers used across every page. Loaded FIRST among JS
   files. No dependencies, no side effects on load.
   Depends on: nothing
   Exposes: window.Utils
   ================================================================ */

(function () {
  'use strict';

  // ================================================================
  // STRING HELPERS
  // ================================================================

  /**
   * HTML-escape any value before injecting into innerHTML.
   * Prevents XSS. Handles null/undefined gracefully.
   *
   *   Utils.esc('<script>')  →  '&lt;script&gt;'
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
   * Turn a status string into a CSS-safe class fragment.
   *   'In Transit'  →  'In-Transit'
   *   'On Hold'     →  'On-Hold'
   *   '' / null     →  'Pending'
   */
  function statusCls(s) {
    return String(s || 'Pending').trim().replace(/\s+/g, '-');
  }

  /**
   * Truncate a long string with an ellipsis. Suffix is optional.
   *   Utils.truncate('The quick brown fox', 10)  →  'The quick…'
   */
  function truncate(s, max, suffix) {
    const str = String(s == null ? '' : s);
    const n = typeof max === 'number' ? max : 40;
    const end = suffix === undefined ? '…' : suffix;
    if (str.length <= n) return str;
    return str.slice(0, n).trim() + end;
  }

  /**
   * Title-case a string. Capitalizes the first letter of each word.
   *   Utils.titleCase('in transit')  →  'In Transit'
   */
  function titleCase(s) {
    return String(s == null ? '' : s).replace(/\w\S*/g, function (t) {
      return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
    });
  }

  /**
   * Slugify a string for use as an id or filename fragment.
   *   Utils.slugify('Hello World!')  →  'hello-world'
   */
  function slugify(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // ================================================================
  // NUMBER + CURRENCY
  // ================================================================

  const CURRENCY = 'Fr.';

  /**
   * Format a number as GlobalExpress currency.
   *   Utils.money(12500)  →  'Fr. 12,500'
   *   Utils.money(-500)   →  'Fr. -500'
   */
  function money(n) {
    const num = Number(n || 0);
    const formatted = Math.abs(num).toLocaleString('en-US');
    return num < 0
      ? CURRENCY + ' -' + formatted
      : CURRENCY + ' ' + formatted;
  }

  /**
   * Format a number with thousands separators.
   *   Utils.comma(1234567)  →  '1,234,567'
   */
  function comma(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  /**
   * Clamp a number between a min and max.
   *   Utils.clamp(15, 0, 10)  →  10
   */
  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  /**
   * Format bytes into a human-readable string.
   *   Utils.formatBytes(1536)  →  '1.5 KB'
   */
  function formatBytes(bytes, decimals) {
    const b = Number(bytes) || 0;
    if (b === 0) return '0 B';
    const k = 1024;
    const dm = typeof decimals === 'number' ? decimals : 1;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(Math.abs(b)) / Math.log(k));
    const idx = clamp(i, 0, sizes.length - 1);
    return parseFloat((b / Math.pow(k, idx)).toFixed(dm)) + ' ' + sizes[idx];
  }

  // ================================================================
  // DATE + TIME
  // ================================================================

  /**
   * Short date — "Sep 16, 2026".
   */
  function fmtDate(d) {
    const date = d instanceof Date ? d : new Date(d || Date.now());
    return date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  /**
   * Short date + time — "Sep 16, 2026 3:20 PM".
   */
  function fmtDT(d) {
    const date = d instanceof Date ? d : new Date(d || Date.now());
    return date.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  }

  /**
   * Relative time — "just now", "5m ago", "3h ago", "2d ago".
   * Accepts a Date, an ISO string, or a timestamp.
   */
  function fmtRelative(d) {
    const date = d instanceof Date ? d : new Date(d || Date.now());
    const diff = Date.now() - date.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 5) return 'just now';
    if (sec < 60) return sec + 's ago';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const day = Math.floor(hr / 24);
    if (day < 30) return day + 'd ago';
    const mo = Math.floor(day / 30);
    if (mo < 12) return mo + 'mo ago';
    const yr = Math.floor(mo / 12);
    return yr + 'y ago';
  }

  /**
   * ISO-formatted date string — "2026-09-16".
   */
  function fmtISO(d) {
    const date = d instanceof Date ? d : new Date(d || Date.now());
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  // ================================================================
  // ID GENERATION
  // ================================================================

  /**
   * Generate a unique id with an optional prefix.
   *   Utils.uid('u')  →  'u_k3j9x8a2b7d4'
   */
  function uid(prefix) {
    const p = prefix || 'id';
    return p + '_' +
      Math.random().toString(36).slice(2, 10) +
      Date.now().toString(36).slice(-4);
  }

  /**
   * Generate a new tracking code in the format GE-XXXX-XXXX-US.
   * Every code is guaranteed to have 4 digits, a hyphen, 4 digits,
   * and the '-US' suffix.
   */
  function genTrackingCode() {
    const seg = function () {
      return Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0');
    };
    return 'GE-' + seg() + '-' + seg() + '-US';
  }

  /**
   * Generate a short uppercase reference, e.g. "TXN-A3F9K1".
   */
  function genRef(prefix) {
    const p = (prefix || 'REF').toUpperCase();
    return p + '-' +
      Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  // ================================================================
  // DOM HELPERS
  // ================================================================

  /**
   * querySelector shorthand. Returns null if not found.
   */
  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  /**
   * querySelectorAll shorthand. Returns an Array (not a NodeList),
   * so you can chain .map()/.filter()/.forEach() directly.
   */
  function qsa(selector, root) {
    return Array.prototype.slice.call(
      (root || document).querySelectorAll(selector)
    );
  }

  /**
   * Attach an event listener. Returns an unsubscribe function.
   *
   *   const off = Utils.on(btn, 'click', handler);
   *   off();   // remove listener
   */
  function on(el, event, handler, options) {
    if (!el || typeof el.addEventListener !== 'function') {
      return function () {};
    }
    el.addEventListener(event, handler, options);
    return function off() {
      el.removeEventListener(event, handler, options);
    };
  }

  /**
   * Attach a listener that fires at most once.
   */
  function once(el, event, handler, options) {
    if (!el || typeof el.addEventListener !== 'function') {
      return function () {};
    }
    const wrapped = function (e) {
      el.removeEventListener(event, wrapped, options);
      handler(e);
    };
    el.addEventListener(event, wrapped, options);
    return function off() {
      el.removeEventListener(event, wrapped, options);
    };
  }

  /**
   * Delegated event listener — one listener on a container that
   * fires for clicks matching a selector inside it.
   *
   *   Utils.delegate(container, 'click', '[data-action]', (e, el) => {...})
   */
  function delegate(container, event, selector, handler) {
    if (!container || typeof container.addEventListener !== 'function') {
      return function () {};
    }
    const wrapped = function (e) {
      const target = e.target.closest(selector);
      if (target && container.contains(target)) {
        handler.call(target, e, target);
      }
    };
    container.addEventListener(event, wrapped);
    return function off() {
      container.removeEventListener(event, wrapped);
    };
  }

  /**
   * Add one or more classes to an element.
   */
  function addClass(el, ...classes) {
    if (!el || !el.classList) return;
    classes.forEach(function (c) { if (c) el.classList.add(c); });
  }

  /**
   * Remove one or more classes from an element.
   */
  function removeClass(el, ...classes) {
    if (!el || !el.classList) return;
    classes.forEach(function (c) { if (c) el.classList.remove(c); });
  }

  /**
   * Toggle a class on an element. Force param optional.
   */
  function toggleClass(el, className, force) {
    if (!el || !el.classList) return;
    if (force === undefined) el.classList.toggle(className);
    else el.classList.toggle(className, !!force);
  }

  // ================================================================
  // FUNCTION CONTROL
  // ================================================================

  /**
   * Debounce — delay the function until `ms` milliseconds have
   * passed since the last call. Useful for search-as-you-type.
   *
   *   const search = Utils.debounce(fetchResults, 300);
   *   input.addEventListener('input', search);
   */
  function debounce(fn, ms) {
    const wait = typeof ms === 'number' ? ms : 250;
    let timer = null;
    function debounced() {
      const args = arguments;
      const ctx = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fn.apply(ctx, args);
      }, wait);
    }
    debounced.cancel = function () {
      if (timer) { clearTimeout(timer); timer = null; }
    };
    return debounced;
  }

  /**
   * Throttle — fire the function at most once every `ms` ms,
   * even if called more often. Useful for scroll handlers.
   */
  function throttle(fn, ms) {
    const wait = typeof ms === 'number' ? ms : 200;
    let last = 0;
    let timer = null;
    function throttled() {
      const now = Date.now();
      const args = arguments;
      const ctx = this;
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        last = now;
        fn.apply(ctx, args);
      } else if (!timer) {
        timer = setTimeout(function () {
          last = Date.now();
          timer = null;
          fn.apply(ctx, args);
        }, remaining);
      }
    }
    throttled.cancel = function () {
      if (timer) { clearTimeout(timer); timer = null; }
      last = 0;
    };
    return throttled;
  }

  /**
   * Sleep for `ms` ms. Returns a promise.
   *   await Utils.sleep(500);
   */
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  // ================================================================
  // ASYNC + DATA HELPERS
  // ================================================================

  /**
   * Deep-ish clone via JSON. Fast and safe for plain data (no
   * functions, Dates become strings). If you need to preserve
   * Date objects, use a real clone helper.
   */
  function clone(obj) {
    if (obj === null || obj === undefined) return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      return obj;
    }
  }

  /**
   * Are two values deep-equal? Primitives compared with ===,
   * objects via JSON stringify. Good enough for our data model.
   */
  function isEqual(a, b) {
    if (a === b) return true;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (e) {
      return false;
    }
  }

  /**
   * Read a query parameter from the current URL.
   *   Utils.query('track')  →  'GE-3301-7745-US'
   */
  function query(name, url) {
    try {
      const u = url ? new URL(url, location.href) : new URL(location.href);
      return u.searchParams.get(name);
    } catch (e) {
      return null;
    }
  }

  /**
   * Parse the hash part of a URL into a route name.
   *   '#' + '#/wallet' → 'wallet'
   */
  function parseHash(hash) {
    let h = String(hash || '').trim();
    if (h.startsWith('#')) h = h.slice(1);
    if (h.startsWith('/')) h = h.slice(1);
    return h;
  }

  // ================================================================
  // STORAGE HELPERS
  // Wrapped in try/catch so a disabled/full localStorage can't
  // crash the app.
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
    },
    del(k) {
      try { localStorage.removeItem(k); return true; }
      catch (e) { return false; }
    },
    clear() {
      try { localStorage.clear(); return true; }
      catch (e) { return false; }
    }
  };

  // ================================================================
  // CLIPBOARD
  // ================================================================

  /**
   * Copy text to clipboard. Returns a promise resolving to
   * true/false. Uses the modern Clipboard API when available,
   * falls back to a hidden textarea + execCommand.
   */
  function copy(text) {
    const str = String(text == null ? '' : text);
    if (!str) return Promise.resolve(false);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(str)
        .then(function () { return true; })
        .catch(function () { return legacyCopy(str); });
    }
    return Promise.resolve(legacyCopy(str));
  }

  function legacyCopy(str) {
    try {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // ================================================================
  // MISC
  // ================================================================

  /**
   * Capitalize the first letter of a string.
   */
  function capitalize(s) {
    const str = String(s == null ? '' : s);
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Read a nested value from an object safely.
   *   Utils.get(obj, 'a.b.c')  →  obj.a.b.c or undefined
   */
  function get(obj, path, fallback) {
    if (!obj || !path) return fallback;
    const parts = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return fallback;
      cur = cur[parts[i]];
    }
    return cur === undefined ? fallback : cur;
  }

  /**
   * Test whether a string is a valid email (simple RFC-ish check).
   */
  function isEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || '').trim());
  }

  /**
   * Test whether a string looks like a GlobalExpress tracking code.
   */
  function isTrackingCode(s) {
    return /^GE-\d{4}-\d{4}-US$/i.test(String(s || '').trim());
  }

  /**
   * Random integer in [min, max].
   */
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Pick a random element from an array.
   */
  function pick(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    return arr[randInt(0, arr.length - 1)];
  }

  // ================================================================
  // EXPOSURE
  // ================================================================
  const Utils = {
    // Strings
    esc:          esc,
    statusCls:    statusCls,
    truncate:     truncate,
    titleCase:    titleCase,
    slugify:      slugify,
    capitalize:   capitalize,

    // Numbers + currency
    money:        money,
    comma:        comma,
    clamp:        clamp,
    formatBytes:  formatBytes,

    // Dates
    fmtDate:      fmtDate,
    fmtDT:        fmtDT,
    fmtRelative:  fmtRelative,
    fmtISO:       fmtISO,

    // IDs
    uid:              uid,
    genTrackingCode:  genTrackingCode,
    genRef:           genRef,

    // DOM
    qs:           qs,
    qsa:          qsa,
    on:           on,
    once:         once,
    delegate:     delegate,
    addClass:     addClass,
    removeClass:  removeClass,
    toggleClass:  toggleClass,

    // Function control
    debounce:     debounce,
    throttle:     throttle,
    sleep:        sleep,

    // Async / data
    clone:        clone,
    isEqual:      isEqual,
    query:        query,
    parseHash:    parseHash,
    get:          get,

    // Storage
    storage:      storage,

    // Clipboard
    copy:         copy,

    // Validators
    isEmail:         isEmail,
    isTrackingCode:  isTrackingCode,

    // Misc
    randInt:      randInt,
    pick:         pick,

    // Constants
    CURRENCY:     CURRENCY
  };

  // ================================================================
  // Expose to window
  // ================================================================
  window.Utils = Utils;

})();