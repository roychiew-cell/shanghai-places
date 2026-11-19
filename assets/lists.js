/* lists.js: filters, sort, search and "Show more" for the one long category page (Chinese, 36 places) (builder U2).
   Plain ES5 so older Android and WeChat browsers run it: no ?., no ??, no replaceAll, no modules, no arrow functions.
   The server-rendered page is complete without this file: all cards are in the HTML in the data's order, and the
   filter bar stays hidden until the page's head script adds "js" to <html>. This file only hides and reorders cards.
   (Since 19 Nov 2026 every category is its own page, so there is no category filter: the page's switcher links to the others.)

   Hooks (data- attributes, never style classes):
     [data-cards]          the card grid (data-page-size = cards shown before "Show more", data-label = the category's name)
     .card[data-area data-bucket data-price data-dianping data-amap data-name data-order data-search]
     [data-filters]        the filter bar: #f-q, #f-area, #f-price, #f-sort, #more-filters
     [data-count]          the polite live region "Showing 12 of 36"
     [data-more] [data-more-btn] [data-more-text]   the "Show 12 more" block
     [data-clear]          clears every filter (the result bar button and the one in the empty state)
     [data-clear-one=key]  clears one filter (area, price or q), made by the empty state
     #empty                the empty state; this file writes its sentence and its buttons

   The state is kept in the address: ?area=Huangpu&price=200-500&sort=dianping&q=noodles
   (price is a bucket such as 100-200 or 500+, sort is dianping, amap, price, price-desc or name). An old link with ?cat=
   never reaches this page: the Eat page's own script sends it to the right category first.
*/
(function () {
  'use strict';
  var doc = document;
  var wrap = doc.querySelector('[data-cards]');
  var bar = doc.querySelector('[data-filters]');
  if (!wrap || !bar) { return; }

  var PAGE = parseInt(wrap.getAttribute('data-page-size'), 10) || 12;
  var KEYS = ['area', 'price', 'sort', 'q'];
  var WHAT = wrap.getAttribute('data-label') || 'the list';       // what the empty state calls the cards: "Nothing in Chinese costs ..."

  function $(sel, scope) { return (scope || doc).querySelector(sel); }
  function $$(sel, scope) { return Array.prototype.slice.call((scope || doc).querySelectorAll(sel)); }
  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      var m = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
      if (m && m.call(el, sel)) { return el; }
      el = el.parentNode;
    }
    return null;
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[‘’]/g, "'"); }
  function fmtCny(n) { return 'CNY ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  var qEl = $('#f-q');
  var areaEl = $('#f-area');
  var priceEl = $('#f-price');
  var sortEl = $('#f-sort');
  var countEl = $('[data-count]');
  var clearBtn = $('.result-bar [data-clear]');
  var moreBox = $('[data-more]');
  var moreBtn = $('[data-more-btn]');
  var moreText = $('[data-more-text]');
  var emptyEl = $('#empty');
  var moreFilters = $('#more-filters');
  var moreCount = $('[data-more-count]');

  function num(el, attr) {
    var v = el.getAttribute(attr);
    return (v === null || v === '') ? null : parseFloat(v);
  }

  var cards = $$('.card', wrap).map(function (el) {
    return {
      el: el,
      area: el.getAttribute('data-area') || '',
      bucket: el.getAttribute('data-bucket') || '',
      price: num(el, 'data-price'),
      dianping: num(el, 'data-dianping'),
      amap: num(el, 'data-amap'),
      name: el.getAttribute('data-name') || '',
      order: parseInt(el.getAttribute('data-order'), 10) || 0,
      hay: norm(el.getAttribute('data-search')),
      on: true
    };
  });
  var total = cards.length;

  var state = { area: '', price: '', sort: '', q: '' };
  var limit = PAGE;
  var current = [];            // the cards that match, in display order
  var composing = false;       // an input method is mid-word: wait for it

  /* ---- reading and writing the address ------------------------------------------------------- */
  function parseQuery() {
    var out = {};
    var s = (location.search || '').replace(/^\?/, '');
    if (!s) { return out; }
    s.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      try {
        var k = decodeURIComponent((i < 0 ? kv : kv.slice(0, i)).replace(/\+/g, ' '));
        var v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
        out[k] = v;
      } catch (e) { /* a malformed escape is ignored */ }
    });
    return out;
  }

  function syncUrl() {
    var parts = [];
    KEYS.forEach(function (k) { if (state[k]) { parts.push(k + '=' + encodeURIComponent(state[k])); } });
    var url = location.pathname + (parts.length ? '?' + parts.join('&') : '') + (location.hash || '');
    try { if (window.history && history.replaceState) { history.replaceState(null, '', url); } } catch (e) { /* ignore */ }
  }

  function optionValues(sel) { return $$('option', sel).map(function (o) { return o.value; }); }

  /* ---- matching and sorting ------------------------------------------------------------------- */
  function tokensOf(q) { return norm(q).split(/\s+/).filter(function (t) { return t; }); }

  function matches(c, st, skip, tokens) {
    if (st.area && skip !== 'area' && c.area !== st.area) { return false; }
    if (st.price && skip !== 'price' && c.bucket !== st.price) { return false; }
    if (st.q && skip !== 'q') {
      for (var i = 0; i < tokens.length; i++) { if (c.hay.indexOf(tokens[i]) === -1) { return false; } }
    }
    return true;
  }

  function pick(st, skip) {
    var tokens = tokensOf(st.q);
    return cards.filter(function (c) { return matches(c, st, skip, tokens); });
  }

  function byNumber(key, desc) {
    return function (a, b) {
      var x = a[key], y = b[key];
      if (x === null && y === null) { return a.order - b.order; }
      if (x === null) { return 1; }
      if (y === null) { return -1; }
      if (x === y) { return a.order - b.order; }
      return desc ? y - x : x - y;
    };
  }

  function sorter(sort) {
    if (sort === 'dianping') { return byNumber('dianping', true); }
    if (sort === 'amap') { return byNumber('amap', true); }
    if (sort === 'price') { return byNumber('price', false); }
    if (sort === 'price-desc') { return byNumber('price', true); }
    if (sort === 'name') {
      return function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : a.order - b.order); };
    }
    return function (a, b) { return a.order - b.order; };
  }

  /* ---- the empty state: say which filter is the cause, with real figures from the cards -------- */
  function optionAttr(sel, v, attr) {
    var out = v;
    $$('option', sel).forEach(function (o) { if (o.value === v) { out = o.getAttribute(attr) || o.textContent; } });
    return out;
  }
  function subject(st, skip) {
    var s = WHAT;
    if (st.area && skip !== 'area') { s += ' in ' + optionAttr(areaEl, st.area, 'data-label'); }
    if (st.q && skip !== 'q') { s += ' matching “' + st.q + '”'; }
    return s;
  }
  function priceRange(list) {
    var lo = null, hi = null;
    list.forEach(function (c) {
      if (c.price === null) { return; }
      lo = lo === null ? c.price : Math.min(lo, c.price);
      hi = hi === null ? c.price : Math.max(hi, c.price);
    });
    return [lo, hi];
  }
  function joinList(items) {
    if (items.length <= 1) { return items.join(''); }
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function emptyMessage(st) {
    var base;
    if (st.price) {
      base = pick(st, 'price');
      if (base.length) {
        var r = priceRange(base);
        var msg = 'Nothing in ' + subject(st, 'price') + ' costs ' + optionAttr(priceEl, st.price, 'data-phrase') + '.';
        if (r[0] !== null) {
          msg += r[0] === r[1] ? ' The only price there is ' + fmtCny(r[0]) + '.'
                               : ' Prices there run from ' + fmtCny(r[0]) + ' to ' + fmtCny(r[1]) + '.';
        }
        return { text: msg, key: 'price', label: 'Clear price' };
      }
    }
    if (st.area) {
      base = pick(st, 'area');
      if (base.length) {
        var counts = {}, names = [];
        base.forEach(function (c) { if (!counts[c.area]) { counts[c.area] = 0; names.push(c.area); } counts[c.area] += 1; });
        names.sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); });
        var labels = names.map(function (n) { return optionAttr(areaEl, n, 'data-label'); });
        return { text: 'Nothing in ' + subject(st, 'area') + ' is in ' + optionAttr(areaEl, st.area, 'data-label') +
                       '. The ' + base.length + (base.length === 1 ? ' place is in ' : ' places are in ') + joinList(labels) + '.',
                 key: 'area', label: 'Clear area' };
      }
    }
    if (st.q) {
      base = pick(st, 'q');
      if (base.length) {
        return { text: 'Nothing in ' + subject(st, 'q') + ' matches “' + st.q + '”. Try a dish, a street or the Chinese name.',
                 key: 'q', label: 'Clear search' };
      }
    }
    var fallback = st.q ? 'Nothing matches “' + st.q + '”. Try a dish, a street or the Chinese name.'
             : 'No place matches all of these filters. Remove one to see more.';
    return { text: fallback, key: null, label: '' };
  }

  function renderEmpty(st) {
    if (!emptyEl) { return; }
    var m = emptyMessage(st);
    var p = $('p', emptyEl);
    if (p) { p.textContent = m.text; }
    var actions = $('.state__actions', emptyEl);
    if (!actions) { return; }
    while (actions.firstChild) { actions.removeChild(actions.firstChild); }
    if (m.key) {
      var one = doc.createElement('button');
      one.type = 'button';
      one.className = 'btn btn--primary';
      one.setAttribute('data-clear-one', m.key);
      one.textContent = m.label;
      actions.appendChild(one);
    }
    var all = doc.createElement('button');
    all.type = 'button';
    all.className = 'btn btn--secondary';
    all.setAttribute('data-clear', '');
    all.textContent = 'Clear all filters';
    actions.appendChild(all);
  }

  /* ---- drawing ----------------------------------------------------------------------------------- */
  function anyFilter() { return !!(state.area || state.price || state.q); }

  function setCount(shown, matchedN) {
    if (!countEl) { return; }
    var html = 'Showing <span class="count">' + shown + '</span> of ' + (matchedN === 0 ? total : matchedN);
    if (anyFilter() && matchedN > 0) { html += ' <span class="muted">· filtered from ' + total + '</span>'; }
    countEl.innerHTML = html;
  }

  function draw(reorder) {
    var tokens = tokensOf(state.q);
    var matched = [], rest = [];
    cards.forEach(function (c) {
      c.on = matches(c, state, null, tokens);
      (c.on ? matched : rest).push(c);
    });
    matched.sort(sorter(state.sort));
    current = matched;
    if (reorder) {
      matched.concat(rest).forEach(function (c) { wrap.appendChild(c.el); });
    }
    var shown = Math.min(limit, matched.length);
    matched.forEach(function (c, i) {
      c.el.hidden = false;
      if (i >= shown) { c.el.classList.add('is-folded'); } else { c.el.classList.remove('is-folded'); }
    });
    rest.forEach(function (c) { c.el.hidden = true; c.el.classList.remove('is-folded'); });

    setCount(shown, matched.length);
    var left = matched.length - shown;
    if (moreBox) {
      moreBox.hidden = left <= 0;
      if (left > 0 && moreBtn) { moreBtn.textContent = 'Show ' + Math.min(PAGE, left) + ' more'; }
      if (moreText) { moreText.textContent = 'Showing ' + shown + ' of ' + matched.length; }
    }
    if (emptyEl) {
      emptyEl.hidden = matched.length > 0;
      if (matched.length === 0) { renderEmpty(state); }
    }

    // keep the controls in step with the state
    if (areaEl && areaEl.value !== state.area) { areaEl.value = state.area; }
    if (priceEl && priceEl.value !== state.price) { priceEl.value = state.price; }
    if (sortEl && sortEl.value !== state.sort) { sortEl.value = state.sort; }
    if (clearBtn) { clearBtn.hidden = !anyFilter(); }
    if (moreCount) {
      var n = (state.area ? 1 : 0) + (state.price ? 1 : 0) + (state.sort ? 1 : 0);
      moreCount.textContent = n ? ' · ' + n + ' set' : '';
    }
    syncUrl();
  }

  function change(reorder) { limit = PAGE; draw(reorder !== false); }

  /* ---- events -------------------------------------------------------------------------------------- */
  if (areaEl) { areaEl.addEventListener('change', function () { state.area = areaEl.value; change(); }); }
  if (priceEl) { priceEl.addEventListener('change', function () { state.price = priceEl.value; change(); }); }
  if (sortEl) { sortEl.addEventListener('change', function () { state.sort = sortEl.value; change(); }); }

  if (qEl) {
    qEl.addEventListener('compositionstart', function () { composing = true; });
    qEl.addEventListener('compositionend', function () {
      composing = false;
      state.q = qEl.value.replace(/^\s+|\s+$/g, '');
      change();
    });
    qEl.addEventListener('input', function () {
      if (composing) { return; }
      state.q = qEl.value.replace(/^\s+|\s+$/g, '');
      change();
    });
  }

  doc.addEventListener('click', function (e) {
    var one = closest(e.target, '[data-clear-one]');
    var all = closest(e.target, '[data-clear]');
    if (!one && !all) { return; }
    if (one) {
      state[one.getAttribute('data-clear-one')] = '';
      if (one.getAttribute('data-clear-one') === 'q' && qEl) { qEl.value = ''; }
    } else {
      state.area = ''; state.price = ''; state.q = '';
      if (qEl) { qEl.value = ''; }
    }
    change();
    if (countEl) {                                     // the button that was pressed is gone or hidden: put focus on the new count
      countEl.setAttribute('tabindex', '-1');
      countEl.focus();
    }
  });

  if (moreBtn) {
    moreBtn.addEventListener('click', function (e) {
      var before = Math.min(limit, current.length);
      limit += PAGE;
      draw(false);
      var first = current[before];
      var viaKeyboard = e.detail === 0;
      if (first && (viaKeyboard || before + PAGE >= current.length)) {
        var link = $('.card__title a', first.el);
        if (link) { link.focus(); }
      }
    });
  }

  /* ---- the filter disclosure: closed on a phone, always open from 1024 px ---------------------------- */
  var wide = window.matchMedia ? window.matchMedia('(min-width: 1024px)') : null;
  function openOnWide() { if (moreFilters && wide && wide.matches) { moreFilters.open = true; } }
  if (wide) {
    if (wide.addEventListener) { wide.addEventListener('change', openOnWide); }
    else if (wide.addListener) { wide.addListener(openOnWide); }
  }

  /* ---- start: read the address, validate each value against what the page offers --------------------- */
  var q0 = parseQuery();
  if (q0.area && areaEl && optionValues(areaEl).indexOf(q0.area) !== -1) { state.area = q0.area; }
  if (q0.price && priceEl && optionValues(priceEl).indexOf(q0.price) !== -1) { state.price = q0.price; }
  if (q0.sort && sortEl && optionValues(sortEl).indexOf(q0.sort) !== -1) { state.sort = q0.sort; }
  if (q0.q) { state.q = q0.q.replace(/^\s+|\s+$/g, '').slice(0, 80); }
  if (qEl) { qEl.value = state.q; }
  if (moreFilters && wide && !wide.matches && !(state.area || state.price || state.sort)) { moreFilters.open = false; }
  draw(true);
}());
