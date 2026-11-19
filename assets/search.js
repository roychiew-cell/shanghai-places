/* search.js: the Search page (builder U3). Loads assets/data/search-index.json once, matches a typed query against
   English and Chinese names, kinds, tags, dishes, streets and metro stations, and draws the results as row cards
   grouped as Eat and drink, See and Errands. Plain ES5 so older Android and WeChat browsers run it: no ?., no ??,
   no replaceAll, no modules, no arrow functions. Needs window.ShMatch (assets/match.js), loaded before it.

   The row card it draws is the one components.row_card makes on the server (a thumbnail or the small street plaque,
   the title with the Chinese name beside it, the meta line, the seal and its word), so a result looks like a place
   on the map list or in a Nearby list.

   Hooks (data- attributes, never style classes):
     [data-search-page]       data-root (the way back to the site root), data-index (the index file), data-total
     [data-search-input]      the field; [data-search-count] the polite count line
     [data-search-results]    where the groups go; [data-search-start] the page before a query
     #search-empty            no results (this file writes the query into it); #search-error the index did not load
     [data-search-example]    a suggestion link: fills the field and searches
     [data-search-retry]      loads the index again

   Ranking: a word found in a name scores 100 (30 more at the start of a word), in the kind, tags or dishes 40, in the
   area, street or station 20; every word has to be found somewhere. The whole phrase in a name adds 50. Ties keep the
   guide's own order.
   The address is kept up to date with history.replaceState (?q=...), other parameters are left alone.
*/
(function () {
  'use strict';
  var doc = document;
  var win = window;
  var M = win.ShMatch;
  var page = doc.querySelector('[data-search-page]');
  if (!page || !M) { return; }

  var root = page.getAttribute('data-root') || '';
  var indexUrl = page.getAttribute('data-index');
  var total = parseInt(page.getAttribute('data-total'), 10) || 0;
  var input = doc.querySelector('[data-search-input]');
  var countEl = doc.querySelector('[data-search-count]');
  var resultsEl = doc.querySelector('[data-search-results]');
  var startEl = doc.querySelector('[data-search-start]');
  var emptyEl = doc.getElementById('search-empty');
  var errorEl = doc.getElementById('search-error');
  var GROUPS = [['eat', 'Eat and drink'], ['see', 'See'], ['errands', 'Errands']];
  var LABELS = { checked: 'Checked', likely: 'Likely', thin: 'Unconfirmed' };
  var records = null;
  var loading = false;
  var typing = 0;
  var query = '';

  function $(sel, scope) { return (scope || doc).querySelector(sel); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function join(list) { return list.filter(function (x) { return x; }).join(' '); }

  /* ---- the index ----------------------------------------------------------------------------------------- */
  function prepareRecords(data) {
    records = data.places.map(function (rec, i) {
      rec._i = i;
      rec._n = M.prepare(join([rec.title_en, rec.title_zh, rec.zh]));
      rec._k = M.prepare(join([rec.kind, rec.section_label, (rec.tags || []).join(' '), rec.dishes, rec.dishes_zh]));
      rec._w = M.prepare(join([rec.district, (rec.also_districts || []).join(' '), rec.metro, rec.address_en, rec.address_zh]));
      return rec;
    });
  }

  var waiters = [];
  function load(done) {
    if (records) { done(true); return; }
    waiters.push(done);                                  // a search typed while the index is still coming waits for it
    if (loading) { return; }
    loading = true;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', indexUrl, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      loading = false;
      var ok = false;
      if (xhr.status === 200 || (xhr.status === 0 && xhr.responseText)) {
        try { prepareRecords(JSON.parse(xhr.responseText)); ok = true; } catch (e) { ok = false; }
      }
      var list = waiters;
      waiters = [];
      list.forEach(function (f) { f(ok); });
    };
    xhr.send(null);
  }

  /* ---- matching ------------------------------------------------------------------------------------------ */
  function has(prep, t) { return prep.h.indexOf(t) !== -1 || (M.hasCjk(t) && prep.c.indexOf(t) !== -1); }
  function startsWord(h, t) { return h.indexOf(t) === 0 || h.indexOf(' ' + t) !== -1; }

  function score(rec, toks, phrase) {
    var s = 0;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (has(rec._n, t)) { s += 100 + (startsWord(rec._n.h, t) ? 30 : 0); }
      else if (has(rec._k, t)) { s += 40; }
      else if (has(rec._w, t)) { s += 20; }
      else { return -1; }
    }
    if (toks.length > 1 && rec._n.h.indexOf(phrase) !== -1) { s += 50; }
    return s;
  }

  function search(toks) {
    var phrase = toks.join(' ');
    var hits = [];
    records.forEach(function (rec) {
      var s = score(rec, toks, phrase);
      if (s >= 0) { hits.push({ rec: rec, s: s }); }
    });
    hits.sort(function (a, b) { return b.s - a.s || a.rec._i - b.rec._i; });
    return hits.map(function (h) { return h.rec; });
  }

  /* ---- drawing ------------------------------------------------------------------------------------------- */
  function rowHtml(rec) {
    var thumb;
    if (rec.thumb) {
      thumb = '<img src="' + esc(root + rec.thumb) + '" width="' + esc(rec.thumb_w) + '" height="' + esc(rec.thumb_h) +
        '" alt="" loading="lazy" decoding="async">';
    } else {
      thumb = '<div class="plaque plaque--sm" aria-hidden="true">' +
        (rec.plaque ? '<span class="plaque__zh" lang="zh-Hans">' + esc(rec.plaque) + '</span>' : '') + '</div>';
    }
    var title = esc(rec.title_en) + (rec.zh ? ' <span class="zh-inline" lang="zh-Hans">' + esc(rec.zh) + '</span>' : '');
    return '<li class="rowcard" data-id="' + esc(rec.id) + '"><div class="rowcard__thumb">' + thumb + '</div><div>' +
      '<h3 class="rowcard__title"><a href="' + esc(root + rec.url) + '">' + title + '</a></h3>' +
      '<p class="rowcard__meta">' + esc(rec.meta) + '</p>' +
      '<span class="status status--' + esc(rec.status) + '"><svg class="seal seal--sm" aria-hidden="true"><use href="#seal-' + esc(rec.status) + '"/></svg>' +
      '<span class="status__label">' + esc(LABELS[rec.status] || rec.status) + '</span></span></div></li>';
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function groupHtml(id, label, list) {
    return '<section class="results-group" aria-labelledby="rg-' + id + '"><div class="section__head"><h2 id="rg-' + id + '">' +
      esc(label) + '</h2><span class="section__aside">' + plural(list.length, 'place') + '</span></div><ul class="results">' +
      list.map(rowHtml).join('') + '</ul></section>';
  }

  function show(el, on) { if (el) { el.hidden = !on; } }

  function reset() {
    resultsEl.innerHTML = '';
    show(emptyEl, false);
    show(errorEl, false);
  }

  function run(raw) {
    query = String(raw || '').replace(/^\s+|\s+$/g, '');
    writeUrl();
    var toks = M.tokens(query);
    reset();
    if (!toks.length) {
      show(startEl, true);
      countEl.textContent = '';
      return;
    }
    show(startEl, false);
    var short = toks.every(function (t) { return t.length < 2 && !M.hasCjk(t); });
    if (short) { countEl.textContent = 'Type at least two letters'; return; }
    var hits = search(toks);
    if (!hits.length) {
      M.fill(countEl, 'No places match \u201c' + query + '\u201d');
      M.fill($('p', emptyEl), 'Nothing in the ' + total + ' places matches \u201c' + query + '\u201d. Try a shorter word, or a Chinese name, or browse a list.');
      show(emptyEl, true);
      return;
    }
    M.fill(countEl, plural(hits.length, 'place') + ' ' + (hits.length === 1 ? 'matches' : 'match') + ' \u201c' + query + '\u201d');
    var html = '';
    GROUPS.forEach(function (g) {
      var list = hits.filter(function (r) { return r.group === g[0]; });
      if (list.length) { html += groupHtml(g[0], g[1], list); }
    });
    resultsEl.innerHTML = html;
  }

  /* ---- the address ---------------------------------------------------------------------------------------- */
  function parseQuery() {
    var out = {};
    var s = (win.location.search || '').replace(/^\?/, '');
    if (!s) { return out; }
    s.split('&').forEach(function (kv) {
      if (!kv) { return; }
      var i = kv.indexOf('=');
      var k = i < 0 ? kv : kv.slice(0, i);
      var v = i < 0 ? '' : kv.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* a malformed escape is ignored */ }
    });
    return out;
  }
  function writeUrl() {
    if (!win.history || !win.history.replaceState) { return; }
    var q = parseQuery();
    if (query) { q.q = query; } else { delete q.q; }
    var parts = [];
    Object.keys(q).forEach(function (k) { parts.push(encodeURIComponent(k) + (q[k] === '' ? '' : '=' + encodeURIComponent(q[k]))); });
    try { win.history.replaceState(null, '', win.location.pathname + (parts.length ? '?' + parts.join('&') : '') + (win.location.hash || '')); } catch (e) { /* a sandboxed frame */ }
  }

  /* ---- events --------------------------------------------------------------------------------------------- */
  function start(value) {
    load(function (ok) {
      if (!ok) {
        reset();
        show(startEl, false);
        countEl.textContent = '';
        show(errorEl, true);
        return;
      }
      run(value);
    });
  }

  if (input) {
    input.addEventListener('input', function () {
      win.clearTimeout(typing);
      typing = win.setTimeout(function () { start(input.value); }, 80);
    });
    if (input.form) {
      input.form.addEventListener('submit', function (e) { e.preventDefault(); win.clearTimeout(typing); start(input.value); });
    }
  }

  doc.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t.nodeType === 1 && t !== doc.body) {
      if (t.hasAttribute('data-search-example')) {
        e.preventDefault();
        input.value = t.getAttribute('data-search-example');
        start(input.value);
        return;
      }
      if (t.hasAttribute('data-search-retry')) { e.preventDefault(); start(input.value); return; }
      t = t.parentNode;
    }
  });

  var q0 = parseQuery().q || '';
  if (input) { input.value = q0; }
  start(q0);
  if (!q0 && input) { try { input.focus(); } catch (err) { /* ignore */ } }
}());
