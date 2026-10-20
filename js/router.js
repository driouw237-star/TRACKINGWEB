/* ================================================================
   GlobalExpress — Client-Side Router
   ================================================================ */
(function () {
  'use strict';

  const routes = {};
  const DEFAULT_ROUTE = 'dashboard';
  let CONTENT_ID = 'content';
  let config = {};
  let currentRoute = null;

  function readHash() {
    let hash = String(window.location.hash || '').trim();
    if (hash.startsWith('#')) hash = hash.slice(1);
    if (hash.startsWith('/')) hash = hash.slice(1);
    return hash || DEFAULT_ROUTE;
  }

  const Router = {
    register(name, definition) {
      routes[name] = {
        title: definition.title || name,
        render: definition.render,
        bind: definition.bind || null,
        cleanup: definition.cleanup || null
      };
    },
    
    start(userConfig) {
      config = userConfig || {};
      if (config.container) CONTENT_ID = config.container;

      window.addEventListener('hashchange', function () {
        render(readHash());
      });

      const initial = readHash();
      render(routes[initial] ? initial : DEFAULT_ROUTE);
    },
    
    navigate(routeName) {
      window.location.hash = routeName;
      if (currentRoute === routeName) render(routeName);
    },
    
    refresh() {
      if (currentRoute) render(currentRoute);
    }
  };

  function render(routeName) {
    if (!routes[routeName]) {
      if (routeName !== DEFAULT_ROUTE) {
        window.location.hash = DEFAULT_ROUTE;
        return render(DEFAULT_ROUTE);
      }
      document.getElementById(CONTENT_ID).innerHTML = '<div class="panel"><div class="panel-body">Page not found.</div></div>';
      return;
    }

    const def = routes[routeName];
    const container = document.getElementById(CONTENT_ID);
    if (!container) return;

    if (currentRoute && routes[currentRoute] && routes[currentRoute].cleanup) {
      try { routes[currentRoute].cleanup(); } catch (e) {}
    }

    currentRoute = routeName;
    document.title = (def.title || 'App') + ' — GlobalExpress';

    const appState = (window.App && window.App.state) ? window.App.state : {};
    const ctx = {
      user: appState.user || null,
      view: routeName,
      params: appState.params || {}
    };

    if (config.onBeforeRender) config.onBeforeRender(routeName, ctx);

    container.innerHTML = def.render(ctx);

    if (typeof def.bind === 'function') {
      try { def.bind(ctx); } catch (e) { console.error(e); }
    }

    if (config.onAfterRender) config.onAfterRender(routeName, container);
  }

  window.Router = Router;
})();