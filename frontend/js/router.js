/* ================================================================
   GlobalExpress — Client-Side Router
   Hash-based SPA routing for app.html. Loaded after store.js,
   before page modules and app.js.
   Depends on: window.Store (optional), window.Auth (optional)
   Exposes: window.Router
   ================================================================ */

(function () {
  'use strict';

  // ================================================================
  // DEPENDENCIES
  // ================================================================
  const Store = window.Store || null;
  const Auth  = window.Auth  || null;

  // ================================================================
  // ROUTE TABLE
  // Maps route name → { title, render, teardown, bind, cleanup }.
  // ================================================================
  const routes = {};

  // Default route when the hash is empty or unknown.
  const DEFAULT_ROUTE = 'dashboard';

  // Where the view HTML gets inserted (overridable via config).
  let CONTENT_ID = 'content';

  // The config passed to Router.start() — stored so render() can use it.
  let config = {};

  // ================================================================
  // RUNTIME STATE
  // ================================================================
  let currentRoute = null;
  let currentCleanups = [];
  let initialised = false;

  // ================================================================
  // HELPERS
  // ================================================================

  function readHash() {
    let hash = String(window.location.hash || '').trim();
    if (hash.startsWith('#')) hash = hash.slice(1);
    if (hash.startsWith('/')) hash = hash.slice(1);
    return hash || DEFAULT_ROUTE;
  }

  function setHash(routeName, replace) {
    const target = '#' + routeName;
    if (window.location.hash === target) return;
    if (replace && window.history.replaceState) {
      window.history.replaceState(null, '', target);
    } else {
      window.location.hash = routeName;
    }
  }

  function runCleanups() {
    const list = currentCleanups;
    currentCleanups = [];
    list.forEach(function (fn) {
      try { fn(); }
      catch (e) { console.warn('[Router] cleanup error:', e); }
    });
  }

  function setTitle(routeName) {
    const def = routes[routeName];
    const pageTitle = def && def.title ? def.title : 'Dashboard';
    document.title = pageTitle + ' — GlobalExpress';
  }

  /**
   * Build the context object passed to render() and bind().
   * Reads from App.state if available so params set via App.go()
   * reach the page.
   */
  function buildContext(routeName) {
    const appState = (window.App && window.App.state) ? window.App.state : {};
    return {
      user:   appState.user   || null,
      view:   routeName,
      params: appState.params || {}
    };
  }

  // ================================================================
  // PUBLIC API
  // ================================================================
  const Router = {

    // ------------------------------------------------------------
    // REGISTRATION
    // ------------------------------------------------------------

    register(name, definition) {
      if (!name || typeof name !== 'string') {
        console.warn('[Router] invalid route name:', name);
        return;
      }
      if (!definition || typeof definition.render !== 'function') {
        console.warn('[Router] route must have a render function:', name);
        return;
      }
      routes[name] = {
        title:    definition.title || name,
        render:   definition.render,
        bind:     definition.bind || null,
        cleanup:  definition.cleanup || definition.teardown || null
      };
    },

    routes() {
      return Object.keys(routes);
    },

    // ------------------------------------------------------------
    // NAVIGATION
    // ------------------------------------------------------------

    navigate(routeName, options) {
      const opts = options || {};
      if (typeof routeName !== 'string' || !routeName) {
        routeName = DEFAULT_ROUTE;
      }
      setHash(routeName, !!opts.replace);
      // If the hash didn't change (we're already on this route),
      // force a re-render so params and data refresh.
      if (currentRoute === routeName) {
        render(routeName);
      }
    },

    current() {
      return currentRoute;
    },

    // ------------------------------------------------------------
    // VIEW LIFECYCLE
    // ------------------------------------------------------------

    registerCleanup(fn) {
      if (typeof fn === 'function') {
        currentCleanups.push(fn);
      }
    },

    refresh() {
      if (currentRoute) render(currentRoute);
    },

    // ------------------------------------------------------------
    // INIT
    // ------------------------------------------------------------

    start(userConfig) {
      if (initialised) return;
      initialised = true;

      config = userConfig || {};
      if (config.container) CONTENT_ID = config.container;

      // Listen for hash changes
      window.addEventListener('hashchange', function () {
        render(readHash());
      });

      // Initial render
      const initial = readHash();
      if (!routes[initial]) {
        setHash(DEFAULT_ROUTE, true);
      }
      render(routes[initial] ? initial : DEFAULT_ROUTE);
    }
  };

  // ================================================================
  // RENDER
  // The heart of the router. Called on every route change.
  // ================================================================
  function render(routeName) {
    // Unknown route → fallback
    if (!routes[routeName]) {
      console.warn('[Router] unknown route:', routeName, '→ falling back to', DEFAULT_ROUTE);
      if (routeName !== DEFAULT_ROUTE) {
        setHash(DEFAULT_ROUTE, true);
        return render(DEFAULT_ROUTE);
      }
      // Even the default isn't registered — use renderNotFound
      const container = document.getElementById(CONTENT_ID);
      if (container && typeof config.renderNotFound === 'function') {
        container.innerHTML = config.renderNotFound();
      } else if (container) {
        container.innerHTML = '<div class="panel"><div class="panel-body">Page not found.</div></div>';
      }
      return;
    }

    const def = routes[routeName];
    const container = document.getElementById(CONTENT_ID);

    if (!container) {
      console.error('[Router] content container #' + CONTENT_ID + ' not found');
      return;
    }

    // 1. Teardown the PREVIOUS view (before we swap the DOM)
    if (currentRoute && currentRoute !== routeName) {
      const prev = routes[currentRoute];

      // Call the previous page's cleanup
      if (prev && typeof prev.cleanup === 'function') {
        try { prev.cleanup(); }
        catch (e) { console.warn('[Router] cleanup error for', currentRoute, e); }
      }

      // Fire the app-level onBeforeDestroy hook
      if (typeof config.onBeforeDestroy === 'function') {
        try { config.onBeforeDestroy(currentRoute); }
        catch (e) { console.warn('[Router] onBeforeDestroy error', e); }
      }
    }

    // 2. Run any cleanups registered via Router.registerCleanup()
    runCleanups();

    // 3. Update current route name
    currentRoute = routeName;

    // 4. Update document title
    setTitle(routeName);

    // 5. Build the context ONCE so render() and bind() see the same values
    const ctx = buildContext(routeName);

    // 6. Fire onBeforeRender (app.js updates topbar title/subtitle/sidebar)
    if (typeof config.onBeforeRender === 'function') {
      try { config.onBeforeRender(routeName, ctx); }
      catch (e) { console.warn('[Router] onBeforeRender error', e); }
    }

    // 7. Fade out, render, fade in
    container.classList.add('fading');

    try {
      // 7a. Call the page's render(ctx) — pass the context!
      const result = def.render(ctx);

      if (typeof result === 'string') {
        container.innerHTML = result;
      }
      if (typeof result === 'function') {
        Router.registerCleanup(result);
      }
    } catch (e) {
      console.error('[Router] render error for', routeName, e);
      container.innerHTML =
        '<div class="panel" style="padding:40px;text-align:center;">' +
          '<i class="fas fa-triangle-exclamation" style="font-size:32px;color:var(--red);margin-bottom:12px;"></i>' +
          '<h3 style="margin-bottom:8px;">Something went wrong</h3>' +
          '<p style="color:var(--text-2);font-size:13.5px;">We couldn\'t load this page. Please try again.</p>' +
        '</div>';
      window.requestAnimationFrame(function () {
        container.classList.remove('fading');
      });
      return;
    }

    // 8. Call the page's bind(ctx) — AFTER the HTML is in the DOM
    if (typeof def.bind === 'function') {
      try { def.bind(ctx); }
      catch (e) { console.error('[Router] bind error for', routeName, e); }
    }

    // 9. Fire onAfterRender (app.js can now query the injected DOM)
    if (typeof config.onAfterRender === 'function') {
      try { config.onAfterRender(routeName, container, ctx); }
      catch (e) { console.warn('[Router] onAfterRender error', e); }
    }

    // 10. Fade back in
    window.requestAnimationFrame(function () {
      container.classList.remove('fading');
    });

    // 11. Scroll to top
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // ================================================================
  // Expose to window
  // ================================================================
  window.Router = Router;

})();