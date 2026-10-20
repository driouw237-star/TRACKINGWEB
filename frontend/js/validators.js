/* GlobalExpress - validators.js
   Field-level and form-level validation used by every form in the platform.

   Usage:
     V.email('a@b.co');
     V.email('nope');
     V.trackingCode('GE-3301-7745-US');
     V.password('abc');

     var result = V.form(formEl, [
       { name: 'email',    label: 'Email',    required: true, rules: ['email'] },
       { name: 'password', label: 'Password', required: true, rules: [['minLength', 6]] }
     ]);
     if (!result.valid) { console.log(result.errors); }

     var stop = V.attachLive(formEl, rules, { blur: true, input: true });
     stop();

   Rule shape (per field):
     {
       name:     'email',
       label:    'Email',
       required: true,
       rules:    ['email']
     }

   Reads window.Utils if present, otherwise falls back to inline helpers.
   No imports, no build step, no framework.
*/
(function (global) {
  'use strict';

  /* Fallbacks ------------------------------------------------------------- */

  var esc = (global.Utils && global.Utils.esc)
    ? global.Utils.esc
    : function (s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      };

  function trim(v) {
    return v == null ? '' : String(v).trim();
  }

  function isArray(x) {
    return Object.prototype.toString.call(x) === '[object Array]';
  }

  /* Primitive validators -------------------------------------------------- */

  var EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var TRACKING_RE = /^GE-\d{4}-\d{4}-[A-Z]{2}$/i;
  var URL_RE      = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/[^\s]*)?$/i;
  var PHONE_RE    = /^[+]?[\d\s().-]{7,20}$/;

  function required(value, label) {
    if (trim(value) === '') return (label || 'This field') + ' is required';
    return null;
  }

  function email(value, label) {
    var v = trim(value);
    if (v === '') return null;
    if (!EMAIL_RE.test(v)) return 'Enter a valid ' + ((label || 'email').toLowerCase());
    return null;
  }

  function password(value, min, label) {
    min = (min == null) ? 6 : min;
    var v = String(value == null ? '' : value);
    if (v === '') return null;
    if (v.length < min) return (label || 'Password') + ' must be at least ' + min + ' characters';
    return null;
  }

  function trackingCode(value, label) {
    var v = trim(value).toUpperCase();
    if (v === '') return null;
    if (!TRACKING_RE.test(v)) return (label || 'Tracking code') + ' must look like GE-XXXX-XXXX-US';
    return null;
  }

  function phone(value, label) {
    var v = trim(value);
    if (v === '') return null;
    if (!PHONE_RE.test(v)) return 'Enter a valid ' + ((label || 'phone number').toLowerCase());
    return null;
  }

  function number(value, opts, label) {
    opts = opts || {};
    var v = trim(value);
    if (v === '') return null;
    var n = Number(v);
    if (!isFinite(n)) return (label || 'This field') + ' must be a number';
    if (opts.min != null && n < opts.min) return (label || 'Value') + ' must be at least ' + opts.min;
    if (opts.max != null && n > opts.max) return (label || 'Value') + ' must be at most ' + opts.max;
    if (opts.integer && Math.floor(n) !== n) return (label || 'Value') + ' must be a whole number';
    return null;
  }

  function minLength(value, min, label) {
    var v = String(value == null ? '' : value);
    if (v === '') return null;
    if (v.length < min) return (label || 'This field') + ' must be at least ' + min + ' characters';
    return null;
  }

  function maxLength(value, max, label) {
    var v = String(value == null ? '' : value);
    if (v === '') return null;
    if (v.length > max) return (label || 'This field') + ' must be at most ' + max + ' characters';
    return null;
  }

  function range(value, min, max, label) {
    var v = trim(value);
    if (v === '') return null;
    var n = Number(v);
    if (!isFinite(n) || n < min || n > max) {
      return (label || 'Value') + ' must be between ' + min + ' and ' + max;
    }
    return null;
  }

  function url(value, label) {
    var v = trim(value);
    if (v === '') return null;
    if (!URL_RE.test(v)) return 'Enter a valid ' + ((label || 'URL').toLowerCase());
    return null;
  }

  function match(value, other, label) {
    if (String(value == null ? '' : value) !== String(other == null ? '' : other)) {
      return (label || 'Values') + ' do not match';
    }
    return null;
  }

  function oneOf(value, allowed, label) {
    var v = trim(value);
    if (v === '') return null;
    if (!isArray(allowed) || allowed.indexOf(v) === -1) {
      return (label || 'Value') + ' is not allowed';
    }
    return null;
  }

  /* Rule registry --------------------------------------------------------- */

  var REGISTRY = {
    required:  function (v, arg, label) { return required(v, label); },
    email:     function (v, arg, label) { return email(v, label); },
    password:  function (v, arg, label) { return password(v, arg, label); },
    tracking:  function (v, arg, label) { return trackingCode(v, label); },
    phone:     function (v, arg, label) { return phone(v, label); },
    number:    function (v, arg, label) { return number(v, arg || {}, label); },
    minLength: function (v, arg, label) { return minLength(v, arg, label); },
    maxLength: function (v, arg, label) { return maxLength(v, arg, label); },
    range:     function (v, arg, label) {
      return range(v, arg && arg[0], arg && arg[1], label);
    },
    url:       function (v, arg, label) { return url(v, label); },
    oneOf:     function (v, arg, label) { return oneOf(v, arg, label); }
  };

  /* Field resolution ------------------------------------------------------ */

  // FIX: form.elements only exists on <form> elements. When the container
  // is a <div> (as create-shipment.js passes), fall back to querySelector.
  // This prevents "Cannot read properties of undefined" errors.
  function resolveInput(form, key) {
    if (!form || !key) return null;

    // Only access form.elements when it actually exists and is an object.
    if (form.elements && typeof form.elements === 'object') {
      var byName = form.elements[key];
      if (byName) return byName;
    }

    // Fall back to querySelector — works on any Element (div, form, section).
    if (typeof form.querySelector === 'function') {
      return form.querySelector('[name="' + key + '"]')
          || form.querySelector('#' + key)
          || null;
    }

    return null;
  }

  function getValue(input) {
    if (!input) return '';
    if (input.type === 'checkbox') return !!input.checked;
    if (input.type === 'radio') {
      var group = input.form
        ? input.form.querySelectorAll('[name="' + input.name + '"]')
        : [input];
      for (var i = 0; i < group.length; i++) {
        if (group[i].checked) return group[i].value;
      }
      return '';
    }
    return input.value;
  }

  /* Error DOM helpers ----------------------------------------------------- */

  function fieldWrapper(input) {
    if (!input) return null;
    if (input.closest) {
      return input.closest('.field') || input.parentElement;
    }
    return input.parentElement;
  }

  function showFieldError(input, message) {
    if (!input) return;
    var wrap = fieldWrapper(input);
    if (!wrap) return;
    wrap.classList.add('error');

    var msg = wrap.querySelector('.field-error');
    if (!msg) {
      msg = document.createElement('div');
      msg.className = 'field-error';
      wrap.appendChild(msg);
    }
    msg.textContent = message;
    input.setAttribute('aria-invalid', 'true');
  }

  function clearFieldError(input) {
    if (!input) return;
    var wrap = fieldWrapper(input);
    if (!wrap) return;
    wrap.classList.remove('error');
    var msg = wrap.querySelector('.field-error');
    if (msg && msg.parentNode) msg.parentNode.removeChild(msg);
    input.removeAttribute('aria-invalid');
  }

  function clearFieldErrors(form) {
    if (!form || typeof form.querySelectorAll !== 'function') return;

    var wraps = form.querySelectorAll('.field.error');
    for (var i = 0; i < wraps.length; i++) wraps[i].classList.remove('error');

    var msgs = form.querySelectorAll('.field-error');
    for (var j = 0; j < msgs.length; j++) {
      if (msgs[j].parentNode) msgs[j].parentNode.removeChild(msgs[j]);
    }

    var invalid = form.querySelectorAll('[aria-invalid]');
    for (var k = 0; k < invalid.length; k++) {
      invalid[k].removeAttribute('aria-invalid');
    }
  }

  /* Rule application ------------------------------------------------------ */

  function applyRule(value, rule, label) {
    if (typeof rule === 'function') {
      var out = rule(value, label);
      return (typeof out === 'string' && out) ? out : null;
    }
    if (typeof rule === 'string') {
      var fn = REGISTRY[rule];
      return fn ? fn(value, undefined, label) : null;
    }
    if (isArray(rule)) {
      var name = rule[0];
      var args = rule.slice(1);
      var fn2 = REGISTRY[name];
      if (!fn2) return null;
      if (name === 'range') return fn2(value, args, label);
      return fn2(value, args[0], label);
    }
    return null;
  }

  /* Form runner ----------------------------------------------------------- */

  function form(formEl, rules) {
    var result = { valid: true, errors: {}, values: {} };
    if (!formEl || !isArray(rules)) return result;
    if (typeof formEl.querySelector !== 'function') return result;

    clearFieldErrors(formEl);

    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i] || {};
      var input = resolveInput(formEl, rule.name);
      var value = getValue(input);
      var label = rule.label || rule.name;

      result.values[rule.name] = value;

      if (rule.required) {
        var reqErr = required(value, label);
        if (reqErr) {
          result.errors[rule.name] = reqErr;
          if (input) showFieldError(input, reqErr);
          result.valid = false;
          continue;
        }
      }

      var isEmpty = (value === '' || value === false || value == null);
      if (!rule.required && isEmpty) continue;

      var list = isArray(rule.rules) ? rule.rules : [];
      for (var j = 0; j < list.length; j++) {
        var err = applyRule(value, list[j], label);
        if (err) {
          result.errors[rule.name] = err;
          if (input) showFieldError(input, err);
          result.valid = false;
          break;
        }
      }
    }

    if (!result.valid) {
      var firstKey = Object.keys(result.errors)[0];
      var firstInput = resolveInput(formEl, firstKey);
      if (firstInput && typeof firstInput.focus === 'function') {
        try { firstInput.focus(); } catch (e) { /* ignore */ }
      }
    }

    return result;
  }

  /* Live validation ------------------------------------------------------- */

  // FIX: attachLive no longer crashes when no inputs are found. If the
  // container has no matching inputs (e.g. the body wasn't populated yet),
  // it returns a no-op unsubscribe function instead of throwing.
  function attachLive(formEl, rules, opts) {
    opts = opts || {};
    var onBlur = !!opts.blur;
    var onInput = !!opts.input;
    var handlers = [];

    if (!formEl || !isArray(rules)) return function () {};
    if (typeof formEl.querySelector !== 'function') return function () {};

    function makeCheck(r, el) {
      return function () {
        var value = getValue(el);
        var label = r.label || r.name;

        if (r.required) {
          var reqErr = required(value, label);
          if (reqErr) return showFieldError(el, reqErr);
        }

        var isEmpty = (value === '' || value === false || value == null);
        if (!r.required && isEmpty) return clearFieldError(el);

        var list = isArray(r.rules) ? r.rules : [];
        for (var k = 0; k < list.length; k++) {
          var err = applyRule(value, list[k], label);
          if (err) return showFieldError(el, err);
        }
        clearFieldError(el);
      };
    }

    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i] || {};
      var input = resolveInput(formEl, rule.name);
      if (!input) continue;

      var check = makeCheck(rule, input);

      if (onBlur) {
        input.addEventListener('blur', check);
        (function (el, fn) {
          handlers.push(function () { el.removeEventListener('blur', fn); });
        })(input, check);
      }
      if (onInput) {
        input.addEventListener('input', check);
        (function (el, fn) {
          handlers.push(function () { el.removeEventListener('input', fn); });
        })(input, check);
      }
    }

    return function unsubscribe() {
      for (var i = 0; i < handlers.length; i++) handlers[i]();
    };
  }

  /* Password strength ----------------------------------------------------- */

  function passwordStrength(pw) {
    var v = String(pw || '');
    var s = 0;
    if (v.length >= 6) s++;
    if (v.length >= 10) s++;
    if (/[A-Z]/.test(v)) s++;
    if (/[0-9]/.test(v)) s++;
    if (/[^A-Za-z0-9]/.test(v)) s++;

    var label, color;
    if (s <= 1)      { label = 'Weak';   color = 'red'; }
    else if (s <= 3) { label = 'Fair';   color = 'amber'; }
    else             { label = 'Strong'; color = 'green'; }

    return { score: s, label: label, color: color, percent: Math.round(s / 5 * 100) };
  }

  /* Public API ------------------------------------------------------------ */

  var Validators = {
    required:      required,
    email:         email,
    password:      password,
    trackingCode:  trackingCode,
    phone:         phone,
    number:        number,
    minLength:     minLength,
    maxLength:     maxLength,
    range:         range,
    url:           url,
    match:         match,
    oneOf:         oneOf,

    form:             form,
    attachLive:       attachLive,
    showFieldError:   showFieldError,
    clearFieldError:  clearFieldError,
    clearFieldErrors: clearFieldErrors,

    passwordStrength: passwordStrength,
    resolveInput:     resolveInput,
    getValue:         getValue,

    patterns: {
      email:    EMAIL_RE,
      tracking: TRACKING_RE,
      url:      URL_RE,
      phone:    PHONE_RE
    }
  };

  global.Validators = Validators;
  global.V          = Validators;

})(window);