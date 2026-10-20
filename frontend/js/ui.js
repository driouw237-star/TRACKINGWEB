/* ================================================================
   GlobalExpress — UI Primitives
   ================================================================
   Provides toasts, modals, confirm dialogs, processing overlay,
   and empty-state HTML strings. Every page module depends on this.

   Depends on DOM nodes:
     #toastWrap   — toast container (bottom-right)
     #modalRoot   — where modal backdrops are appended
     #processing  — full-screen spinner overlay

   Depends on CSS:
     toasts.css   (.toast, .toast.success, .removing)
     modals.css   (.modal-bg, .modal-bg.show)

   Optional dependency:
     window.Utils.esc  — falls back to a local esc() if absent.

   Public API: window.UI = { ... }
   ================================================================ */

(function (global) {
  'use strict';

  /* ================================================================
     §1 — Fallback utilities
     ================================================================
     If utils.js already loaded, use its esc(). Otherwise, define a
     local one so this file works standalone (e.g. in unit tests).
     ================================================================ */

  function localEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[c];
    });
  }

  function esc(s) {
    if (global.Utils && typeof global.Utils.esc === 'function') {
      return global.Utils.esc(s);
    }
    return localEsc(s);
  }

  /* ================================================================
     §2 — Constants
     ================================================================
     Timing values are named constants so they can be tweaked in one
     place. They MUST match the animation durations in toasts.css and
     modals.css, or the elements will be removed mid-animation.
     ================================================================ */

  var TOAST_DURATION = 3400;  // ms before a toast starts leaving
  var TOAST_EXIT_MS  = 250;   // must match .toast.removing animation
  var MODAL_EXIT_MS  = 200;   // must match .modal-bg exit animation

  var TOAST_ICONS = {
    success: 'fa-circle-check',
    error:   'fa-circle-xmark',
    info:    'fa-circle-info',
    warning: 'fa-triangle-exclamation'
  };

  var CONFIRM_ICONS = {
    danger:  'fa-triangle-exclamation',
    warning: 'fa-triangle-exclamation',
    info:    'fa-circle-question'
  };

  var CONFIRM_COLORS = {
    danger:  'var(--red)',
    warning: 'var(--amber)',
    info:    'var(--accent)'
  };

  /* ================================================================
     §3 — Helpers
     ================================================================
     Small private utilities. Kept inside the IIFE so they don't
     leak into the global scope.
     ================================================================ */

  function root(id) {
    return document.getElementById(id);
  }

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  /* ================================================================
     §4 — Toasts
     ================================================================
     Non-blocking notifications. Each toast:
       - is appended to #toastWrap
       - auto-dismisses after TOAST_DURATION
       - adds .removing for the exit animation
       - removes itself after TOAST_EXIT_MS
     ================================================================ */

  function toast(title, message, type) {
    var wrap = root('toastWrap');
    if (!wrap) {
      if (global.console && console.warn) {
        console.warn('[UI.toast] #toastWrap not found. Title:', title);
      }
      return null;
    }

    type = type || 'success';
    var icon = TOAST_ICONS[type] || TOAST_ICONS.info;

    var node = el('div', 'toast ' + type);
    node.innerHTML =
      '<div class="toast-icon">' +
        '<i class="fas ' + icon + '"></i>' +
      '</div>' +
      '<div class="toast-body">' +
        '<div class="toast-title">' + esc(title) + '</div>' +
        (message ? '<div class="toast-msg">' + esc(message) + '</div>' : '') +
      '</div>';

    wrap.appendChild(node);

    // Auto-dismiss. Stash the timer on the node so manual dismissal
    // can cancel it — otherwise dismissToast + auto-dismiss race.
    var timer = setTimeout(function () {
      dismissToast(node);
    }, TOAST_DURATION);
    node._uiTimer = timer;

    return node;
  }

  function dismissToast(node) {
    if (!node) return;
    if (node._uiRemoving) return;
    node._uiRemoving = true;

    if (node._uiTimer) {
      clearTimeout(node._uiTimer);
      node._uiTimer = null;
    }

    node.classList.add('removing');
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, TOAST_EXIT_MS);
  }

  function clearToasts() {
    var wrap = root('toastWrap');
    if (!wrap) return;
    var nodes = wrap.querySelectorAll('.toast');
    for (var i = 0; i < nodes.length; i++) {
      dismissToast(nodes[i]);
    }
  }

  /* ================================================================
     §5 — Modals
     ================================================================
     openModal(htmlString) appends a .modal-bg.show to #modalRoot and
     returns the backdrop element. closeModal(el) removes .show, waits
     MODAL_EXIT_MS, then removes the node.
     ================================================================ */

  function openModal(html) {
    var mount = root('modalRoot');
    if (!mount) {
      if (global.console && console.warn) {
        console.warn('[UI.openModal] #modalRoot not found.');
      }
      return null;
    }

    var wrap = el('div', 'modal-bg show', html);

    // Click on the backdrop (not the modal) closes it.
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) closeModal(wrap);
    });

    mount.appendChild(wrap);

    // Focus the first focusable element inside the modal for a11y.
    // Deferred one frame so the element is laid out first.
    setTimeout(function () {
      var focusable = wrap.querySelector(
        'input:not([type="hidden"]), select, textarea, button:not(.modal-close), [href]'
      );
      if (focusable && typeof focusable.focus === 'function') {
        focusable.focus();
      }
    }, 30);

    return wrap;
  }

  function closeModal(wrap) {
    if (!wrap) return;
    if (wrap._uiClosing) return;
    wrap._uiClosing = true;

    wrap.classList.remove('show');
    setTimeout(function () {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }, MODAL_EXIT_MS);
  }

  function closeAllModals() {
    var nodes = document.querySelectorAll('.modal-bg.show');
    for (var i = 0; i < nodes.length; i++) {
      closeModal(nodes[i]);
    }
  }

  /* ================================================================
     §6 — Confirm dialog (Promise-based)
     ================================================================
     Returns a Promise<boolean>:
       - resolves true  → user clicked confirm
       - resolves false → user clicked cancel, backdrop, or Escape

     Options:
       title       — bold headline (required)
       message     — body text (optional)
       confirmText — label of the confirm button (default "Confirm")
       cancelText  — label of the cancel button (default "Cancel")
       variant     — 'danger' | 'warning' | 'info'  (default 'info')
     ================================================================ */

  function confirmDialog(options) {
    options = options || {};
    var title       = options.title       || 'Are you sure?';
    var message     = options.message     || '';
    var confirmText = options.confirmText || 'Confirm';
    var cancelText  = options.cancelText  || 'Cancel';
    var variant     = options.variant     || 'info';

    var icon  = CONFIRM_ICONS[variant]  || CONFIRM_ICONS.info;
    var color = CONFIRM_COLORS[variant] || CONFIRM_COLORS.info;

    var btnClass = (variant === 'danger')  ? 'btn btn-danger'
                 : (variant === 'warning') ? 'btn btn-primary'
                 :                           'btn btn-primary';

    return new Promise(function (resolve) {
      var settled = false;

      function finish(result) {
        if (settled) return;
        settled = true;
        resolve(result);
      }

      var wrap = openModal(
        '<div class="modal narrow">' +
          '<div class="modal-head">' +
            '<div>' +
              '<h3><i class="fas ' + icon + '" style="color:' + color + '"></i> ' +
                esc(title) +
              '</h3>' +
              (message ? '<div class="sub">' + esc(message) + '</div>' : '') +
            '</div>' +
            '<button class="modal-close" data-ui-cancel>' +
              '<i class="fas fa-times"></i>' +
            '</button>' +
          '</div>' +
          '<div class="modal-body" style="text-align:center;padding:30px 24px">' +
            '<i class="fas ' + icon + '" style="font-size:44px;color:' + color + ';margin-bottom:14px"></i>' +
            (message
              ? '<p style="font-size:14.5px;color:var(--text-2)">' + esc(message) + '</p>'
              : '<p style="font-size:14.5px;color:var(--text-2)">' + esc(title) + '</p>') +
          '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-outline" data-ui-cancel>' + esc(cancelText) + '</button>' +
            '<button class="' + btnClass + '" data-ui-confirm>' +
              '<i class="fas fa-check"></i> ' + esc(confirmText) +
            '</button>' +
          '</div>' +
        '</div>'
      );

      if (!wrap) { finish(false); return; }

      var cancels = wrap.querySelectorAll('[data-ui-cancel]');
      for (var i = 0; i < cancels.length; i++) {
        cancels[i].addEventListener('click', function () {
          finish(false);
          closeModal(wrap);
        });
      }

      var okBtn = wrap.querySelector('[data-ui-confirm]');
      if (okBtn) {
        okBtn.addEventListener('click', function () {
          finish(true);
          closeModal(wrap);
        });
      }

      // If the modal is closed another way (backdrop click, Escape),
      // we need to resolve false. Watch for the node being removed.
      var observer = new MutationObserver(function () {
        if (!document.body.contains(wrap)) {
          observer.disconnect();
          finish(false);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  /* ================================================================
     §7 — Processing overlay
     ================================================================
     A full-screen spinner with a title and message. Used during
     deposits, withdrawals, shipment creation, etc.
     ================================================================ */

  function processing(title, message) {
    var overlay = root('processing');
    if (!overlay) {
      if (global.console && console.warn) {
        console.warn('[UI.processing] #processing not found.');
      }
      return;
    }

    var tEl = document.getElementById('procTitle');
    var mEl = document.getElementById('procMsg');
    if (tEl) tEl.textContent = title   || 'Processing';
    if (mEl) mEl.textContent = message || 'Please wait…';

    overlay.classList.add('show');
  }

  function processingDone() {
    var overlay = root('processing');
    if (overlay) overlay.classList.remove('show');
  }

  /* ================================================================
     §8 — Empty state HTML builder
     ================================================================
     Returns a STRING (not a node). Page modules inline it directly
     into their render() template literals.
     ================================================================ */

  function emptyState(icon, title, message, actionHtml) {
    return (
      '<div class="empty">' +
        '<div class="empty-illustration">' +
          '<i class="fas ' + esc(icon || 'fa-inbox') + '"></i>' +
        '</div>' +
        '<h4>' + esc(title || 'Nothing here yet') + '</h4>' +
        '<p>' + esc(message || '') + '</p>' +
        (actionHtml ? actionHtml : '') +
      '</div>'
    );
  }

  /* ================================================================
     §9 — Global keyboard shortcut
     ================================================================
     Escape closes every open modal. Registered once, at load time,
     so individual modals don't each need their own listener.
     ================================================================ */

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAllModals();
  });

  /* ================================================================
     §10 — Public API
     ================================================================
     Everything exposed here is what page modules call. Anything not
     on this object is private to the IIFE.
     ================================================================ */

  var UI = {
    // Toasts
    toast:          toast,
    dismissToast:   dismissToast,
    clearToasts:    clearToasts,

    // Modals
    openModal:      openModal,
    closeModal:     closeModal,
    closeAllModals: closeAllModals,

    // Confirm dialog (Promise<boolean>)
    confirm:        confirmDialog,

    // Processing overlay
    processing:     processing,
    processingDone: processingDone,

    // Empty state (returns HTML string)
    emptyState:     emptyState
  };

  global.UI = UI;

})(window);