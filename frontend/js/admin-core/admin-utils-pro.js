/* ================================================================
   GlobalExpress — Admin Utils Pro
   ================================================================
   Advanced helpers for the professional dashboard.
   - Number animation (count-up)
   - Sparkline SVG generator
   - Date period comparison
   - Grouping utilities
   ================================================================ */

(function (global) {
  'use strict';

  var UtilsPro = {

    /* ============================================================
       NUMBER ANIMATION (COUNT-UP)
       ============================================================ */
    animateNumber: function (el, start, end, duration, formatter) {
      if (!el) return;
      duration = duration || 800;
      formatter = formatter || function (v) { return Math.round(v).toLocaleString(); };
      var startTime = null;
      var difference = end - start;

      function step(timestamp) {
        if (!startTime) startTime = timestamp;
        var progress = Math.min((timestamp - startTime) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        var value = start + (difference * eased);
        el.textContent = formatter(value);
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    },

    /* ============================================================
       SPARKLINE SVG GENERATOR
       ============================================================ */
    generateSparkline: function (values, options) {
      options = options || {};
      var w = options.width || 120;
      var h = options.height || 32;
      var stroke = options.stroke || '#059669';
      var fill = options.fill || 'rgba(5, 150, 105, 0.1)';

      if (!values || values.length < 2) {
        return '<svg viewBox="0 0 ' + w + ' ' + h + '"></svg>';
      }

      var max = Math.max.apply(null, values);
      var min = Math.min.apply(null, values);
      var range = max - min || 1;
      var step = w / (values.length - 1);

      var points = values.map(function (v, i) {
        var x = i * step;
        var y = h - ((v - min) / range) * (h - 4) - 2;
        return x.toFixed(2) + ',' + y.toFixed(2);
      });

      var linePath = 'M' + points.join(' L');
      var areaPath = linePath + ' L' + w + ',' + h + ' L0,' + h + ' Z';

      return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="width:100%;height:100%;display:block">' +
        '<path d="' + areaPath + '" fill="' + fill + '"/>' +
        '<path d="' + linePath + '" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
    },

    /* ============================================================
       DATE HELPERS
       ============================================================ */
    getDateRange: function (period) {
      var now = new Date();
      now.setHours(23, 59, 59, 999);
      var start = new Date(now);
      start.setHours(0, 0, 0, 0);

      var days = 1;
      if (period === '7') days = 7;
      else if (period === '30') days = 30;
      else if (period === '90') days = 90;
      else if (period === 'all') {
        start.setTime(0);
        return { start: start.getTime(), end: now.getTime(), days: 'all' };
      }

      start.setDate(start.getDate() - (days - 1));
      return { start: start.getTime(), end: now.getTime(), days: days };
    },

    getPreviousRange: function (period) {
      var current = this.getDateRange(period);
      if (current.days === 'all') return null;
      var length = current.end - current.start;
      return {
        start: current.start - length - 1,
        end: current.start - 1,
        days: current.days
      };
    },

    /* ============================================================
       GROUP BY DAY
       ============================================================ */
    groupByDay: function (items, dateField, days) {
      var range = this.getDateRange(String(days));
      var dayMs = 24 * 60 * 60 * 1000;
      var buckets = {};

      for (var i = 0; i < range.days; i++) {
        var d = new Date(range.start + (i * dayMs));
        var key = d.toISOString().slice(0, 10);
        buckets[key] = 0;
      }

      items.forEach(function (item) {
        if (!item || !item[dateField]) return;
        var t = new Date(item[dateField]);
        var key = t.toISOString().slice(0, 10);
        if (buckets[key] !== undefined) buckets[key]++;
      });

      return Object.keys(buckets).sort().map(function (k) {
        return { date: k, count: buckets[k] };
      });
    },

    /* ============================================================
       FORMAT HELPERS
       ============================================================ */
    formatCompact: function (n) {
      n = Number(n) || 0;
      if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
      if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
      return n.toString();
    },

    percentChange: function (current, previous) {
      if (!previous || previous === 0) return { value: current > 0 ? 100 : 0, direction: current > 0 ? 'up' : 'flat' };
      var change = ((current - previous) / previous) * 100;
      return {
        value: Math.abs(change).toFixed(1),
        direction: change > 0.1 ? 'up' : change < -0.1 ? 'down' : 'flat'
      };
    },

    /* ============================================================
       HAPTIC / ACCESSIBILITY
       ============================================================ */
    vibrate: function (ms) {
      if (navigator.vibrate) navigator.vibrate(ms || 20);
    }
  };

  global.UtilsPro = UtilsPro;

})(window);