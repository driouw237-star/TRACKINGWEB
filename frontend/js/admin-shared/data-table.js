/* ================================================================
   GlobalExpress — Admin Shared: DataTable
   ================================================================
   Reusable table widget. Renders sortable, filterable, paginated
   tables with bulk selection.

   Usage:
     DataTable.create(mountEl, {
       key: 'users',
       data: [...],
       rowId: r => r.id,
       columns: [
         { key: 'name', label: 'Name', sortable: true,
           render: r => r.name }
       ],
       searchKeys: ['name', 'email'],
       filters: [{ key:'role', label:'Role',
                   options:[{value:'admin',label:'Admin'}] }],
       pageSize: 20,
       emptyState: { icon:'fa-users', title:'No users' },
       bulkActions: [{ key:'notify', label:'Notify', icon:'fa-bell',
                       handler: (ids, rows) => {...} }],
       onRowClick: r => Admin.go('user-detail', { id: r.id })
     });
   ================================================================ */

(function (global) {
  'use strict';

  var Utils = global.Utils || {};
  var UI    = global.UI    || {};

  var esc = Utils.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };

  var comma = Utils.comma || function (n) { return Number(n||0).toLocaleString('en-US'); };

  var debounce = Utils.debounce || function (fn, ms) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms || 200);
    };
  };

  function getByPath(obj, path) {
    if (!obj || !path) return undefined;
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function compareValues(a, b) {
    if (a === b) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    var na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
      return na - nb;
    }
    return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
  }

  function DataTable(mountEl, config) {
    if (!mountEl) throw new Error('[DataTable] mount element required');
    if (!config || !Array.isArray(config.columns)) throw new Error('[DataTable] config.columns required');

    this.key        = config.key || ('dt_' + Math.random().toString(36).slice(2, 8));
    this.data       = Array.isArray(config.data) ? config.data.slice() : [];
    this.columns    = config.columns;
    this.rowId      = config.rowId || function (row) { return row && row.id; };
    this.searchKeys = config.searchKeys || [];
    this.filters    = config.filters || [];
    this.pageSize   = config.pageSize || 20;
    this.pageSizes  = config.pageSizes || [10, 20, 50, 100];
    this.emptyState = config.emptyState || { icon: 'fa-inbox', title: 'Nothing here yet' };
    this.selectable = config.selectable !== false;
    this.bulkActions = config.bulkActions || [];
    this.onRowClick = config.onRowClick || null;
    this.dense      = !!config.dense;
    this.actionsCol = config.actionsCol || null;
    this.defaultSort = config.defaultSort || null;

    this.search      = '';
    this.sortKey     = this.defaultSort ? this.defaultSort.key : null;
    this.sortDir     = this.defaultSort ? this.defaultSort.dir : 'asc';
    this.filterState = {};
    this.filters.forEach(function (f) { this.filterState[f.key] = f.multi ? [] : ''; }, this);
    this.page        = 1;
    this.selected    = new Set();

    this._mount(mountEl);
    this._render();
  }

  DataTable.prototype._mount = function (mountEl) {
    var wrap = document.createElement('div');
    wrap.className = 'dt';
    wrap.dataset.dtKey = this.key;
    wrap.innerHTML =
      '<div class="dt-toolbar" data-dt-toolbar></div>' +
      '<div class="dt-bulk hidden" data-dt-bulk></div>' +
      '<div class="tbl-wrap' + (this.dense ? ' dense' : '') + '">' +
        '<table><thead data-dt-thead></thead><tbody data-dt-tbody></tbody></table>' +
      '</div>' +
      '<div class="tbl-footer" data-dt-footer></div>';
    mountEl.appendChild(wrap);

    this.root      = wrap;
    this.toolbarEl = wrap.querySelector('[data-dt-toolbar]');
    this.bulkEl    = wrap.querySelector('[data-dt-bulk]');
    this.tableEl   = wrap.querySelector('table');
    this.tbodyEl   = wrap.querySelector('[data-dt-tbody]');
    this.footerEl  = wrap.querySelector('[data-dt-footer]');
  };

  DataTable.prototype._filteredData = function () {
    var self = this;
    var rows = this.data.slice();

    if (this.search && this.searchKeys.length) {
      var q = this.search.toLowerCase().trim();
      rows = rows.filter(function (row) {
        return self.searchKeys.some(function (path) {
          var v = getByPath(row, path);
          return v != null && String(v).toLowerCase().indexOf(q) !== -1;
        });
      });
    }

    this.filters.forEach(function (f) {
      var val = self.filterState[f.key];
      if (val === '' || val == null) return;
      if (f.multi && Array.isArray(val) && val.length === 0) return;
      rows = rows.filter(function (row) {
        var raw = f.getValue ? f.getValue(row) : getByPath(row, f.key);
        if (f.multi) return val.indexOf(String(raw)) !== -1;
        return String(raw) === String(val);
      });
    });

    if (this.sortKey) {
      var col = this._colByKey(this.sortKey);
      if (col) {
        var dir = this.sortDir === 'desc' ? -1 : 1;
        rows.sort(function (a, b) {
          var av = col.sortValue ? col.sortValue(a) : getByPath(a, col.key);
          var bv = col.sortValue ? col.sortValue(b) : getByPath(b, col.key);
          return compareValues(av, bv) * dir;
        });
      }
    }

    return rows;
  };

  DataTable.prototype._colByKey = function (key) {
    for (var i = 0; i < this.columns.length; i++) {
      if (this.columns[i].key === key) return this.columns[i];
    }
    return null;
  };

  DataTable.prototype._render = function () {
    this._renderToolbar();
    this._renderBulkBar();
    this._renderHead();
    this._renderBody();
    this._renderFooter();
    this._wire();
  };

  DataTable.prototype._renderToolbar = function () {
    var self = this;
    var html = '';

    if (this.searchKeys.length) {
      html +=
        '<div class="search-box">' +
          '<i class="fas fa-magnifying-glass"></i>' +
          '<input type="text" data-dt-search placeholder="Search…" value="' + esc(this.search) + '" />' +
        '</div>';
    }

    this.filters.forEach(function (f) {
      var current = self.filterState[f.key];
      html += '<select data-dt-filter="' + esc(f.key) + '">';
      html += '<option value="">' + esc(f.label) + ': All</option>';
      f.options.forEach(function (o) {
        var val = String(o.value);
        var sel = f.multi
          ? (Array.isArray(current) && current.indexOf(val) !== -1)
          : (String(current) === val);
        html += '<option value="' + esc(val) + '"' + (sel ? ' selected' : '') + '>' + esc(o.label) + '</option>';
      });
      html += '</select>';
    });

    var anyFilter = this.search || this.filters.some(function (f) {
      var v = self.filterState[f.key];
      return f.multi ? (Array.isArray(v) && v.length) : (v !== '' && v != null);
    });
    if (anyFilter) {
      html += '<button type="button" class="btn btn-ghost btn-sm" data-dt-reset>' +
                '<i class="fas fa-xmark"></i> Reset</button>';
    }

    html += '<div style="flex:1"></div>';

    var filtered = this._filteredData();
    html += '<div style="font-size:12.5px;color:var(--text-3);font-weight:600">' +
              comma(filtered.length) + ' of ' + comma(this.data.length) +
            '</div>';

    this.toolbarEl.innerHTML = html;
  };

  DataTable.prototype._renderBulkBar = function () {
    if (!this.selectable) { this.bulkEl.classList.add('hidden'); return; }
    var n = this.selected.size;
    if (n === 0) { this.bulkEl.classList.add('hidden'); this.bulkEl.innerHTML = ''; return; }

    var buttons = '';
    this.bulkActions.forEach(function (a) {
      var cls = 'btn btn-' + (a.variant || 'outline') + ' btn-sm';
      buttons += '<button type="button" class="' + cls + '" data-dt-bulk-action="' + esc(a.key) + '">' +
                   (a.icon ? '<i class="fas ' + esc(a.icon) + '"></i> ' : '') + esc(a.label) +
                 '</button>';
    });

    this.bulkEl.innerHTML =
      '<span class="count">' + n + ' selected</span>' + buttons +
      '<div style="flex:1"></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-dt-clear-selection>' +
        '<i class="fas fa-xmark"></i> Clear</button>';
    this.bulkEl.classList.remove('hidden');
  };

  DataTable.prototype._renderHead = function () {
    var self = this;
    var thead = this.tableEl.querySelector('thead');
    var html = '<tr>';

    if (this.selectable) {
      html += '<th style="width:36px"><input type="checkbox" data-dt-select-all /></th>';
    }

    this.columns.forEach(function (col) {
      var classes = [];
      if (col.align === 'right') classes.push('num');
      if (col.hideSm) classes.push('hide-sm');

      var sortable = col.sortable !== false && !col.renderNoSort;
      var sortIcon = '';
      if (sortable) {
        if (self.sortKey === col.key) {
          sortIcon = self.sortDir === 'asc'
            ? ' <i class="fas fa-sort-up"></i>'
            : ' <i class="fas fa-sort-down"></i>';
        } else {
          sortIcon = ' <i class="fas fa-sort" style="opacity:.3"></i>';
        }
      }

      html += '<th' +
        (classes.length ? ' class="' + classes.join(' ') + '"' : '') +
        (col.width ? ' style="width:' + esc(col.width) + '"' : '') +
        (sortable ? ' data-sort-key="' + esc(col.key) + '"' : '') +
        '>' + esc(col.label) + sortIcon + '</th>';
    });

    if (this.actionsCol) {
      html += '<th class="tbl-actions">' + esc(this.actionsCol.label || 'Actions') + '</th>';
    }

    html += '</tr>';
    thead.innerHTML = html;
  };

  DataTable.prototype._pageRows = function () {
    var rows = this._filteredData();
    var start = (this.page - 1) * this.pageSize;
    return rows.slice(start, start + this.pageSize);
  };

  DataTable.prototype._renderBody = function () {
    var self = this;
    var rows = this._pageRows();

    if (rows.length === 0) { this._renderEmpty(); return; }

    var html = '';
    rows.forEach(function (row) {
      var id = self.rowId(row);
      var isSelected = self.selected.has(String(id));
      var cls = isSelected ? 'row-selected' : '';

      html += '<tr data-dt-row="' + esc(id) + '"' + (cls ? ' class="' + cls + '"' : '') + '>';

      if (self.selectable) {
        html += '<td style="width:36px"><input type="checkbox" data-dt-row-select' +
                  (isSelected ? ' checked' : '') + ' /></td>';
      }

      self.columns.forEach(function (col) {
        var cellClasses = [];
        if (col.align === 'right') cellClasses.push('num');
        if (col.hideSm) cellClasses.push('hide-sm');

        var content;
        if (typeof col.render === 'function') content = col.render(row);
        else content = esc(getByPath(row, col.key));

        html += '<td' + (cellClasses.length ? ' class="' + cellClasses.join(' ') + '"' : '') + '>' + content + '</td>';
      });

      if (self.actionsCol && typeof self.actionsCol.render === 'function') {
        html += '<td class="tbl-actions">' + self.actionsCol.render(row) + '</td>';
      }

      html += '</tr>';
    });

    this.tbodyEl.innerHTML = html;
  };

  DataTable.prototype._renderEmpty = function () {
    var colSpan = this.columns.length + (this.selectable ? 1 : 0) + (this.actionsCol ? 1 : 0);
    var es = this.emptyState;
    var isFiltered = this.search || this.filters.some(function (f) {
      var v = this.filterState[f.key];
      return f.multi ? (Array.isArray(v) && v.length) : (v !== '' && v != null);
    }, this);

    var title = isFiltered ? 'No matching results' : (es.title || 'Nothing here yet');
    var msg = isFiltered ? 'Try changing your search or filters.' : (es.message || '');
    var icon = isFiltered ? 'fa-magnifying-glass' : (es.icon || 'fa-inbox');

    this.tbodyEl.innerHTML =
      '<tr><td class="empty-cell" colspan="' + colSpan + '">' +
        '<div class="empty">' +
          '<div class="empty-illustration"><i class="fas ' + esc(icon) + '"></i></div>' +
          '<h4>' + esc(title) + '</h4>' +
          (msg ? '<p>' + esc(msg) + '</p>' : '') +
        '</div>' +
      '</td></tr>';
  };

  DataTable.prototype._renderFooter = function () {
    var filtered = this._filteredData();
    var total = filtered.length;
    var totalPages = Math.max(1, Math.ceil(total / this.pageSize));
    if (this.page > totalPages) this.page = totalPages;

    var start = total === 0 ? 0 : (this.page - 1) * this.pageSize + 1;
    var end = Math.min(this.page * this.pageSize, total);

    var pagesHtml = '';
    pagesHtml += '<button type="button" data-dt-page="prev"' + (this.page <= 1 ? ' disabled' : '') +
                 ' aria-label="Previous"><i class="fas fa-chevron-left"></i></button>';

    var maxButtons = 7;
    var from = Math.max(1, this.page - 3);
    var to = Math.min(totalPages, from + maxButtons - 1);
    if (to - from + 1 < maxButtons) from = Math.max(1, to - maxButtons + 1);

    if (from > 1) {
      pagesHtml += '<button type="button" data-dt-page="1">1</button>';
      if (from > 2) pagesHtml += '<span style="padding:0 6px;color:var(--text-3)">…</span>';
    }

    for (var p = from; p <= to; p++) {
      pagesHtml += '<button type="button" data-dt-page="' + p + '"' +
                   (p === this.page ? ' class="active"' : '') + '>' + p + '</button>';
    }

    if (to < totalPages) {
      if (to < totalPages - 1) pagesHtml += '<span style="padding:0 6px;color:var(--text-3)">…</span>';
      pagesHtml += '<button type="button" data-dt-page="' + totalPages + '">' + totalPages + '</button>';
    }

    pagesHtml += '<button type="button" data-dt-page="next"' + (this.page >= totalPages ? ' disabled' : '') +
                 ' aria-label="Next"><i class="fas fa-chevron-right"></i></button>';

    // 🟢 THE FIX IS HERE: Using an arrow function (n) => to preserve `this` context
    var sizeOptions = this.pageSizes.map((n) => {
      return '<option value="' + n + '"' + (n === this.pageSize ? ' selected' : '') + '>' +
             n + ' / page</option>';
    }).join('');

    this.footerEl.innerHTML =
      '<div style="font-size:12.5px">' +
        (total === 0 ? 'No rows' : 'Showing <strong>' + comma(start) + '–' + comma(end) + '</strong>' +
          ' of <strong>' + comma(total) + '</strong>') +
      '</div>' +
      '<div class="pages">' + pagesHtml + '</div>' +
      '<div><select data-dt-page-size style="padding:6px 10px;border:1px solid var(--adm-border);' +
        'border-radius:7px;font-size:12.5px;background:#fff">' + sizeOptions + '</select></div>';
  };

  DataTable.prototype._wire = function () {
    var self = this;
    if (this._wired) return;

    this.root.addEventListener('click', function (e) { self._onClick(e); });
    this.root.addEventListener('change', function (e) { self._onChange(e); });
    this.root.addEventListener('input', function (e) { self._onInput(e); });

    this.tbodyEl.addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-dt-row]');
      if (!tr) return;
      if (e.target.closest('input, button, a, [data-dt-no-row-click]')) return;
      if (!self.onRowClick) return;
      var id = tr.dataset.dtRow;
      var row = self.data.find(function (r) { return String(self.rowId(r)) === id; });
      if (row) self.onRowClick(row, e);
    });

    this._wired = true;
  };

  DataTable.prototype._onClick = function (e) {
    var self = this;

    if (e.target.closest('[data-dt-reset]')) {
      this.search = '';
      this.filters.forEach(function (f) { self.filterState[f.key] = f.multi ? [] : ''; });
      this.page = 1;
      this._render();
      return;
    }

    if (e.target.closest('[data-dt-clear-selection]')) {
      this.selected.clear();
      this._render();
      return;
    }

    var bulk = e.target.closest('[data-dt-bulk-action]');
    if (bulk) {
      var actionKey = bulk.dataset.dtBulkAction;
      var def = this.bulkActions.find(function (a) { return a.key === actionKey; });
      if (def && typeof def.handler === 'function') {
        var ids = Array.from(this.selected);
        var rows = this.data.filter(function (r) { return self.selected.has(String(self.rowId(r))); });
        try { def.handler(ids, rows); }
        catch (err) { console.error('[DataTable] bulk error:', err); }
      }
      return;
    }

    var pageBtn = e.target.closest('[data-dt-page]');
    if (pageBtn) {
      var val = pageBtn.dataset.dtPage;
      var filtered = this._filteredData();
      var totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
      if (val === 'prev') this.page = Math.max(1, this.page - 1);
      else if (val === 'next') this.page = Math.min(totalPages, this.page + 1);
      else this.page = Math.min(totalPages, parseInt(val, 10) || 1);
      this._renderBody(); this._renderFooter(); this._wire();
      return;
    }

    var th = e.target.closest('th[data-sort-key]');
    if (th) {
      var key = th.dataset.sortKey;
      if (this.sortKey === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      else { this.sortKey = key; this.sortDir = 'asc'; }
      this.page = 1;
      this._render();
      return;
    }
  };

  DataTable.prototype._onInput = function (e) {
    if (e.target.matches('[data-dt-search]')) {
      var self = this;
      var val = e.target.value;
      if (!this._debouncedSearch) {
        this._debouncedSearch = debounce(function (v) {
          self.search = v; self.page = 1; self._render();
        }, 200);
      }
      this._debouncedSearch(val);
    }
  };

  DataTable.prototype._onChange = function (e) {
    var self = this;

    if (e.target.matches('[data-dt-search]')) {
      this.search = e.target.value; this.page = 1; this._render(); return;
    }

    var filterKey = e.target.dataset && e.target.dataset.dtFilter;
    if (filterKey) {
      var f = this.filters.find(function (x) { return x.key === filterKey; });
      if (f) {
        if (f.multi) this.filterState[filterKey] = e.target.value ? [e.target.value] : [];
        else this.filterState[filterKey] = e.target.value;
        this.page = 1;
        this._render();
      }
      return;
    }

    if (e.target.matches('[data-dt-page-size]')) {
      this.pageSize = parseInt(e.target.value, 10) || 20;
      this.page = 1;
      this._render();
      return;
    }

    if (e.target.matches('[data-dt-row-select]')) {
      var tr = e.target.closest('tr[data-dt-row]');
      if (!tr) return;
      var id = tr.dataset.dtRow;
      if (e.target.checked) this.selected.add(id);
      else this.selected.delete(id);
      tr.classList.toggle('row-selected', e.target.checked);
      this._renderBulkBar();
      return;
    }

    if (e.target.matches('[data-dt-select-all]')) {
      var pageRows = this._pageRows();
      if (e.target.checked) pageRows.forEach(function (r) { self.selected.add(String(self.rowId(r))); });
      else pageRows.forEach(function (r) { self.selected.delete(String(self.rowId(r))); });
      this._renderBody();
      this._renderBulkBar();
      return;
    }
  };

  DataTable.prototype.refresh = function (newData) {
    if (Array.isArray(newData)) this.data = newData.slice();
    this._render();
  };

  DataTable.prototype.getSelected = function () {
    return Array.from(this.selected);
  };

  DataTable.prototype.clearSelection = function () {
    this.selected.clear();
    this._render();
  };

  DataTable.prototype.destroy = function () {
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  global.DataTable = {
    create: function (mountEl, config) { return new DataTable(mountEl, config); },
    _DataTable: DataTable
  };
  global.Admin = global.Admin || {};
  global.Admin.DataTable = global.DataTable;

})(window);