/* map.js: the Map page (builder U3). Leaflet over OpenStreetMap tiles; the pins are drawn from the server-rendered
   rows of the list column, so the page is complete without scripting and this file only adds the map.
   Plain ES5 so older Android and WeChat browsers run it: no ?., no ??, no replaceAll, no modules, no arrow functions.
   Needs window.L (assets/vendor/leaflet/leaflet.js) and window.ShMatch (assets/match.js), both loaded before it.

   The rows: <li class="rowcard" data-id data-group data-section data-lat data-lon data-glyph [data-approx="1"]
   [data-pinnote] [data-note] data-search data-title data-dz data-dn data-de>.
   Hooks (data- attributes, never style classes):
     [data-map-canvas] [data-map-view]      the map section and the Leaflet container
     [data-map-loading] [data-map-error]    the loading label and the error frame; [data-map-retry] [data-map-showlist]
     [data-map-card]                        the selected place's card (built here from its row)
     [data-map-zoom="in|out"]               the zoom buttons; [data-map-skip] the link that jumps over the list to the map
     [data-layer="eat|see|errands"]         the layer chips: filters (aria-pressed); none pressed shows every place
     [data-view="list|map"]                 the phone's List and Map buttons
     [data-map-q]                           the search box; [data-map-count] the polite "N places shown"
     [data-map-list] [data-map-listbox]     the rows and their scroll box; #map-empty the empty state
     [data-map-clear-q] [data-map-reset]    its two buttons

   Query string, read at load and kept up to date with history.replaceState:
     ?layer=eat,see   the pressed layer chips (none: all)       ?place=<id>   select that place
     ?q=<text>        the search box                          ?view=list    the phone's List view

   Pins: 28 px ink discs with a glyph, the selected one cinnabar; a pin whose position is only a street, an area or
   a borrowed point has a dashed ring. Clusters are made here by distance in screen pixels (no plugin): up to
   zoom CLUSTER_MAX, a click zooms to the cluster's members. Pins are not tab stops: the list is the keyboard and
   screen reader path (a row selects its pin), 131 tab stops on a map would be a trap.
   The map never asks for the visitor's location.
*/
(function () {
  'use strict';
  var doc = document;
  var win = window;
  var M = win.ShMatch;
  var page = doc.getElementById('main');
  var canvas = doc.querySelector('[data-map-canvas]');
  var viewEl = doc.querySelector('[data-map-view]');
  var listBox = doc.querySelector('[data-map-listbox]');
  var listEl = doc.querySelector('[data-map-list]');
  if (!page || !canvas || !viewEl || !listEl || !M) { return; }

  var TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_WAIT = 8000;            // ms without a tile before the error frame shows (DESIGN 5.10)
  var TILE_FAILS = 6;              // or this many failed tiles before the first good one
  var CLUSTER_PX = 34;             // pins closer than this (screen pixels) share a cluster
  var CLUSTER_MAX = 17;            // from the next zoom up, every place is its own pin
  var SPREAD_PX = 28;              // at that zoom, pins closer than this are fanned out on a small circle
  var OUTLIER_KM = 20;             // a place further than this from the middle of the shown ones does not set the first view
  var PLACE_ZOOM = 16;
  var VALID_LAYERS = ['eat', 'see', 'errands'];

  var loadingEl = doc.querySelector('[data-map-loading]');
  var cardEl = doc.querySelector('[data-map-card]');
  var errorEl = doc.querySelector('[data-map-error]');
  var countEl = doc.querySelector('[data-map-count]');
  var qEl = doc.querySelector('[data-map-q]');
  var emptyEl = doc.getElementById('map-empty');
  var liveEl = doc.querySelector('[data-live]');
  var chips = [].slice.call(doc.querySelectorAll('[data-layer]'));
  var viewBtns = [].slice.call(doc.querySelectorAll('[data-view]'));
  var zoomBtns = [].slice.call(doc.querySelectorAll('[data-map-zoom]'));
  var skipEl = doc.querySelector('[data-map-skip]');
  var calm = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function $(sel, scope) { return (scope || doc).querySelector(sel); }
  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      var m = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
      if (m && m.call(el, sel)) { return el; }
      el = el.parentNode;
    }
    return null;
  }
  function announce(msg) {
    if (!liveEl) { return; }
    liveEl.textContent = '';
    win.setTimeout(function () { liveEl.textContent = msg; }, 40);
  }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) { e.className = cls; }
    if (text) { e.textContent = text; }
    return e;
  }

  /* ---- the rows --------------------------------------------------------------------------------------------- */
  var rows = [];
  var byId = {};
  [].forEach.call(listEl.children, function (li) {
    var lat = parseFloat(li.getAttribute('data-lat'));
    var lon = parseFloat(li.getAttribute('data-lon'));
    if (!isFinite(lat) || !isFinite(lon)) { return; }
    var r = {
      id: li.getAttribute('data-id'), group: li.getAttribute('data-group'), section: li.getAttribute('data-section'),
      lat: lat, lon: lon, glyph: li.getAttribute('data-glyph') || 'pin', approx: li.getAttribute('data-approx') === '1',
      pinnote: li.getAttribute('data-pinnote') || '', note: li.getAttribute('data-note') || '',
      title: li.getAttribute('data-title') || '', prep: M.prepare(li.getAttribute('data-search') || ''),
      el: li, on: true, idx: rows.length
    };
    rows.push(r);
    byId[r.id] = r;
  });
  var total = rows.length;

  /* ---- state ------------------------------------------------------------------------------------------------ */
  var pressed = { eat: false, see: false, errands: false };      // the layer chips; none pressed means every layer
  var query = '';
  var toks = [];
  var selected = null;
  var visible = rows.slice();
  var map = null;
  var tiles = null;
  var group = null;
  var begun = false;
  var errored = false;
  var loaded = 0;
  var failed = 0;
  var timer = 0;
  var typing = 0;
  var wantFit = true;
  var waitStart = null;            // page clock (ms) when the tiles were asked for, and when the error frame showed: for the QA scripts
  var errorAt = null;
  function clock() { return (win.performance && win.performance.now) ? win.performance.now() : new Date().getTime(); }

  /* ---- the address ------------------------------------------------------------------------------------------ */
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
    var on = pressedLayers();
    if (!on.length || on.length === VALID_LAYERS.length) { delete q.layer; } else { q.layer = on.join(','); }
    if (selected) { q.place = selected.id; } else { delete q.place; }
    if (query) { q.q = query; } else { delete q.q; }
    if (page.classList.contains('is-list')) { q.view = 'list'; } else { delete q.view; }
    var parts = [];
    Object.keys(q).forEach(function (k) { parts.push(encodeURIComponent(k) + (q[k] === '' ? '' : '=' + encodeURIComponent(q[k]).replace(/%2C/g, ','))); });
    var url = win.location.pathname + (parts.length ? '?' + parts.join('&') : '') + (win.location.hash || '');
    try { win.history.replaceState(null, '', url); } catch (e) { /* a sandboxed frame: the address stays as it is */ }
  }

  /* ---- the filters ------------------------------------------------------------------------------------------ */
  function pressedLayers() { return VALID_LAYERS.filter(function (g) { return pressed[g]; }); }
  function layerOn(g) { return !pressedLayers().length || pressed[g]; }
  function matchRow(r) { return layerOn(r.group) && M.matches(r.prep, toks); }

  function syncChips() {
    chips.forEach(function (c) { c.setAttribute('aria-pressed', pressed[c.getAttribute('data-layer')] ? 'true' : 'false'); });
  }

  function layerNames() {
    return pressedLayers().map(function (g) {
      for (var i = 0; i < chips.length; i++) {
        if (chips[i].getAttribute('data-layer') === g) { return chips[i].firstChild.nodeValue.replace(/\s+$/, ''); }
      }
      return g;
    });
  }

  function updateEmpty() {
    if (!emptyEl) { return; }
    var none = !visible.length;
    emptyEl.hidden = !none;
    if (!none) { return; }
    var h = $('h2', emptyEl);
    var p = $('p', emptyEl);
    var clearQ = $('[data-map-clear-q]', emptyEl);
    var reset = $('[data-map-reset]', emptyEl);
    var names = layerNames();
    h.textContent = 'No places match';
    M.fill(p, 'Nothing in ' + (names.length ? names.join(' or ') : 'the guide') + ' matches \u201c' + query + '\u201d. Try a shorter word, or a Chinese name.');
    clearQ.hidden = !query;
    reset.hidden = !names.length;
  }

  function applyFilters(o) {
    o = o || {};
    visible = [];
    rows.forEach(function (r) {
      r.on = !!matchRow(r);
      r.el.hidden = !r.on;
      if (r.on) { visible.push(r); }
    });
    if (countEl) {
      countEl.textContent = visible.length === total ? total + ' places shown' : visible.length + ' of ' + total + ' places shown';
    }
    syncChips();
    updateEmpty();
    if (selected && !selected.on) { clearSelection(true); }
    if (map) {
      redraw();
      if (o.fit && mapVisible()) { fitVisible(o.animate !== false && !calm); } else if (o.fit) { wantFit = true; }
    }
    if (listBox && !o.keepScroll) { listBox.scrollTop = 0; }
    if (!o.noUrl) { writeUrl(); }
  }

  /* ---- the map ---------------------------------------------------------------------------------------------- */
  function mapVisible() { return !!map && canvas.getClientRects().length > 0 && viewEl.clientWidth > 0; }
  function latlng(r) { return [r.lat, r.lon]; }

  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; });
    var n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function dropOutliers(pts) {
    if (pts.length < 4) { return pts; }
    var mlat = median(pts.map(function (p) { return p[0]; }));
    var mlon = median(pts.map(function (p) { return p[1]; }));
    var k = Math.cos(mlat * Math.PI / 180);
    var keep = pts.filter(function (p) {
      var dy = (p[0] - mlat) * 111.2;
      var dx = (p[1] - mlon) * 111.2 * k;
      return Math.sqrt(dx * dx + dy * dy) <= OUTLIER_KM;
    });
    return keep.length ? keep : pts;
  }
  function fitVisible(animate) {
    if (!map || !visible.length) { return; }
    var pts = dropOutliers(visible.map(latlng));
    if (pts.length === 1) { map.setView(pts[0], PLACE_ZOOM, { animate: animate }); return; }
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: PLACE_ZOOM, animate: animate });
  }

  function cardRoom() {
    // How much of the map's bottom the selected card covers, so a pin can be kept above it.
    if (!cardEl || cardEl.hidden) { return 0; }
    return cardEl.offsetHeight + 56;
  }
  function centerFor(r, z) {
    // The map centre that puts the place in the middle of the part of the map the card does not cover.
    var p = map.project(latlng(r), z);
    return map.unproject(L.point(p.x, p.y + cardRoom() / 2), z);
  }

  function pinIcon(r, sel) {
    var cls = 'mk' + (r.group ? ' mk--g-' + r.group : '') + (sel ? ' mk--sel' : '') + (r.approx ? ' mk--approx' : '');
    return L.divIcon({
      className: cls, iconSize: [44, 44], iconAnchor: [22, 22],
      html: '<svg class="i" aria-hidden="true"><use href="#i-' + r.glyph + '"/></svg>'
    });
  }
  function clusterIcon(n) {
    return L.divIcon({ className: 'mk mk--cluster', iconSize: [44, 44], iconAnchor: [22, 22], html: '<span class="mk__num num">' + n + '</span>' });
  }
  function hide(marker) {
    marker.on('add', function () {
      var e = marker.getElement();
      if (e) { e.setAttribute('aria-hidden', 'true'); }
    });
  }

  function clusters(list, z) {
    var out = [];
    list.forEach(function (r) {
      var p = map.project(latlng(r), z);
      var hit = null;
      for (var i = 0; i < out.length; i++) {
        var dx = out[i].x - p.x;
        var dy = out[i].y - p.y;
        if (dx * dx + dy * dy <= CLUSTER_PX * CLUSTER_PX) { hit = out[i]; break; }
      }
      if (hit) {
        hit.members.push(r);
        hit.sx += p.x;
        hit.sy += p.y;
        hit.x = hit.sx / hit.members.length;
        hit.y = hit.sy / hit.members.length;
      } else {
        out.push({ x: p.x, y: p.y, sx: p.x, sy: p.y, members: [r] });
      }
    });
    return out;
  }

  function spread(list, z) {
    // Pins that would sit on top of each other at the deepest zoom are fanned out on a small circle around their middle.
    var pts = list.map(function (r) { var p = map.project(latlng(r), z); return { r: r, x: p.x, y: p.y }; });
    var used = {};
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      if (used[i]) { continue; }
      used[i] = true;
      var g = [pts[i]];
      for (var j = i + 1; j < pts.length; j++) {
        var dx = pts[i].x - pts[j].x;
        var dy = pts[i].y - pts[j].y;
        if (!used[j] && Math.sqrt(dx * dx + dy * dy) < SPREAD_PX) { used[j] = true; g.push(pts[j]); }
      }
      if (g.length === 1) { out.push({ r: g[0].r, ll: latlng(g[0].r) }); continue; }
      var cx = 0;
      var cy = 0;
      g.forEach(function (q) { cx += q.x; cy += q.y; });
      cx /= g.length;
      cy /= g.length;
      var rad = 17 + (g.length > 2 ? (g.length - 2) * 5 : 0);
      g.forEach(function (q, k) {
        var a = -Math.PI / 2 + 2 * Math.PI * k / g.length;
        var ll = map.unproject(L.point(cx + rad * Math.cos(a), cy + rad * Math.sin(a)), z);
        out.push({ r: q.r, ll: [ll.lat, ll.lng] });
      });
    }
    return out;
  }

  function addPin(r, ll, sel) {
    var m = L.marker(ll, { icon: pinIcon(r, sel), keyboard: false, title: r.title || undefined, zIndexOffset: sel ? 1000 : 0 });
    hide(m);
    m.on('click', function () { select(r.id, { fromPin: true }); });
    group.addLayer(m);
  }

  function redraw() {
    if (!map || !group) { return; }
    group.clearLayers();
    var z = map.getZoom();
    var rest = selected ? visible.filter(function (r) { return r !== selected; }) : visible;
    if (z <= CLUSTER_MAX) {
      clusters(rest, z).forEach(function (c) {
        if (c.members.length === 1) { addPin(c.members[0], latlng(c.members[0]), false); return; }
        var ll = map.unproject(L.point(c.x, c.y), z);
        var m = L.marker(ll, { icon: clusterIcon(c.members.length), keyboard: false, title: c.members.length + ' places here. Click to zoom in.' });
        hide(m);
        m.on('click', function () { zoomToCluster(c); });
        group.addLayer(m);
      });
      if (selected) { addPin(selected, latlng(selected), true); }
    } else {
      spread(visible, z).forEach(function (s) { addPin(s.r, s.ll, s.r === selected); });
    }
  }

  function zoomToCluster(c) {
    var b = L.latLngBounds(c.members.map(latlng));
    var cap = CLUSTER_MAX + 1;                         // deep enough for every member to be its own pin
    var z = Math.min(map.getBoundsZoom(b, false, L.point(48, 48)), cap);
    if (z <= map.getZoom()) { z = Math.min(map.getZoom() + 2, cap); }
    map.setView(b.getCenter(), z, { animate: !calm });
  }

  function syncZoomButtons() {
    zoomBtns.forEach(function (b) {
      var out = b.getAttribute('data-map-zoom') === 'out';
      b.disabled = out ? map.getZoom() <= map.getMinZoom() : map.getZoom() >= map.getMaxZoom();
    });
  }

  /* ---- tiles: loading, the error frame, retry ---------------------------------------------------------------- */
  function showLoading(on) { if (loadingEl) { loadingEl.hidden = !on; } }
  function showError() {
    errored = true;
    errorAt = clock();
    window.clearTimeout(timer);
    showLoading(false);
    page.classList.add('has-error');
    if (errorEl) { errorEl.hidden = false; }
  }
  function clearError() {
    errored = false;
    page.classList.remove('has-error');
    if (errorEl) { errorEl.hidden = true; }
  }
  function startWait() {
    waitStart = clock();
    errorAt = null;
    loaded = 0;
    failed = 0;
    window.clearTimeout(timer);
    showLoading(true);
    timer = window.setTimeout(function () { if (!loaded) { showError(); } }, TILE_WAIT);
  }
  function retry() {
    clearError();
    startWait();
    if (tiles) { tiles.redraw(); }
  }

  function begin() {
    // The first moment the map is on screen: give it a size, a view and its tiles.
    if (begun || !map || !mapVisible()) { return; }
    begun = true;
    map.invalidateSize({ animate: false });
    tiles = L.tileLayer(TILE_URL, { maxZoom: 19, minZoom: 9, keepBuffer: 2 });
    tiles.on('tileload', function () {
      loaded++;
      if (loaded === 1) {
        window.clearTimeout(timer);
        showLoading(false);
        if (errored) { clearError(); }
      }
    });
    tiles.on('tileerror', function () {
      failed++;
      if (!loaded && failed >= TILE_FAILS && !errored) { showError(); }
    });
    var q = parseQuery();
    var first = q.place && byId[q.place] && byId[q.place].on ? byId[q.place] : null;
    if (first) {
      selected = first;
      renderCard(first);
      markRow(first);
      map.setView(centerFor(first, PLACE_ZOOM), PLACE_ZOOM, { animate: false });
    } else {
      fitVisible(false);
    }
    tiles.addTo(map);
    redraw();
    syncZoomButtons();
    startWait();
    wantFit = false;
  }

  function buildMap() {
    if (typeof L === 'undefined' || !L.map) { libraryFailed(); return; }
    var lats = rows.map(function (r) { return r.lat; });
    var lons = rows.map(function (r) { return r.lon; });
    var pad = 0.25;
    var bounds = L.latLngBounds([[Math.min.apply(null, lats) - pad, Math.min.apply(null, lons) - pad],
                                 [Math.max.apply(null, lats) + pad, Math.max.apply(null, lons) + pad]]);
    map = L.map(viewEl, {
      zoomControl: false, attributionControl: false, minZoom: 9, maxZoom: 19, zoomSnap: 1, zoomDelta: 1,
      maxBounds: bounds, maxBoundsViscosity: 0.6, inertia: !calm, zoomAnimation: !calm, fadeAnimation: !calm,
      markerZoomAnimation: !calm
    });
    map.setView([31.2255, 121.46], 12, { animate: false });
    group = L.layerGroup().addTo(map);
    map.on('zoomend', function () { redraw(); syncZoomButtons(); });
    map.on('click', function () { if (selected) { clearSelection(false); } });
  }

  function libraryFailed() {
    showLoading(false);
    if (skipEl) { skipEl.hidden = true; }
    showError();
    var retryBtn = $('[data-map-retry]');
    if (retryBtn) { retryBtn.hidden = true; }          // there is nothing to retry: the script itself did not load
  }

  /* ---- selecting a place ------------------------------------------------------------------------------------- */
  function markRow(r) {
    rows.forEach(function (x) {
      if (x === r) { x.el.setAttribute('aria-current', 'true'); } else { x.el.removeAttribute('aria-current'); }
    });
  }

  function renderCard(r) {
    var src = r.el;
    var row = el('div', 'rowcard');
    row.innerHTML = src.innerHTML;
    var a = $('.rowcard__title a', row);
    if (a) {                                           // in the card the title is plain text: the buttons are the links
      while (a.firstChild) { a.parentNode.insertBefore(a.firstChild, a); }
      a.parentNode.removeChild(a);
    }
    var openHref = $('.rowcard__title a', src) ? $('.rowcard__title a', src).getAttribute('href') : '';
    var status = $('.status', row);
    var label = status ? $('.status__label', status) : null;
    if (label && r.note) {                             // the site's status line: the word, then what was or was not read under it
      var text = el('span', 'status__text');
      status.insertBefore(text, label);
      text.appendChild(label);
      text.appendChild(el('span', 'status__note', r.note));
    }
    var parts = [row];
    if (r.pinnote) {
      var n = el('p', 'map-card__pinnote');
      if (r.approx) {                                  // the dashed ring of the pin, so the note and the pin read together
        var key = el('span', 'map-card__key');
        key.setAttribute('aria-hidden', 'true');
        n.appendChild(key);
      }
      n.appendChild(doc.createTextNode(r.pinnote));
      parts.push(n);
    }
    var actions = el('div', 'map-card__actions');
    var open = el('a', 'btn btn--primary btn--sm', 'Open');
    open.setAttribute('href', openHref);
    actions.appendChild(open);
    var drv = el('button', 'btn btn--secondary btn--sm');
    drv.type = 'button';
    drv.setAttribute('data-driver-zh', src.getAttribute('data-dz') || '');
    drv.setAttribute('data-driver-en', src.getAttribute('data-de') || '');
    drv.setAttribute('data-driver-name', src.getAttribute('data-dn') || '');
    drv.setAttribute('aria-haspopup', 'dialog');
    drv.setAttribute('aria-label', 'Show the driver: ' + r.title);
    drv.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-car"/></svg>Show the driver';
    actions.appendChild(drv);
    var amapHref = src.getAttribute('data-amap');
    if (amapHref) {                                   // a plain link: the Amap app on a phone that has it, its website otherwise
      var am = el('a', 'btn btn--secondary btn--sm');
      am.setAttribute('href', amapHref);
      am.setAttribute('target', '_blank');
      am.setAttribute('rel', 'noopener noreferrer');
      am.setAttribute('aria-label', 'Open in Amap: ' + r.title);
      am.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-external"/></svg>Amap';
      actions.appendChild(am);
    }
    parts.push(actions);
    cardEl.innerHTML = '';
    parts.forEach(function (p) { cardEl.appendChild(p); });
    cardEl.setAttribute('aria-label', 'Selected place: ' + r.title);
    cardEl.hidden = false;
  }

  function select(id, o) {
    o = o || {};
    var r = byId[id];
    if (!r || !r.on) { return; }
    selected = r;
    renderCard(r);
    markRow(r);
    if (map && mapVisible()) {
      var z = map.getZoom();
      var ll = latlng(r);
      redraw();                                        // the selected pin leaves its cluster and turns cinnabar
      if (o.fromList && (z < PLACE_ZOOM - 2 || !map.getBounds().contains(ll))) {
        var nz = Math.max(z, PLACE_ZOOM);
        map.setView(centerFor(r, nz), nz, { animate: !calm });
      } else {
        map.panInside(ll, { paddingTopLeft: [24, 24], paddingBottomRight: [24, cardRoom()], animate: !calm });
      }
    }
    if (o.fromPin && r.el.scrollIntoView) {
      try { r.el.scrollIntoView({ block: 'nearest' }); } catch (e) { r.el.scrollIntoView(); }
    }
    if (o.focusCard) { cardEl.focus(); }
    announce('Selected ' + r.title + '. Open the page or show the driver.');
    writeUrl();
  }

  function clearSelection(quiet) {
    if (!selected) { return; }
    var r = selected;
    selected = null;
    cardEl.hidden = true;
    cardEl.innerHTML = '';
    markRow(null);
    if (map) { redraw(); }
    if (!quiet) { announce('Selection cleared'); }
    writeUrl();
    return r;
  }

  /* ---- the phone's List and Map views ------------------------------------------------------------------------ */
  function showView(name, o) {
    o = o || {};
    var list = name === 'list';
    page.classList.toggle('is-list', list);
    viewBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-view') === name ? 'true' : 'false'); });
    if (!list && map) {
      if (!begun) { begin(); } else { map.invalidateSize({ animate: false }); }
      if (wantFit) { fitVisible(false); wantFit = false; }
    }
    if (!o.noUrl) { writeUrl(); }
  }

  /* ---- events ------------------------------------------------------------------------------------------------ */
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      var g = c.getAttribute('data-layer');
      pressed[g] = !pressed[g];
      applyFilters({ fit: true });
    });
  });

  viewBtns.forEach(function (b) {
    b.addEventListener('click', function () { showView(b.getAttribute('data-view')); });
  });

  if (qEl) {
    qEl.addEventListener('input', function () {
      window.clearTimeout(typing);
      typing = window.setTimeout(function () {
        query = qEl.value.replace(/^\s+|\s+$/g, '');
        toks = M.tokens(query);
        applyFilters({ fit: true });
      }, 120);
    });
    qEl.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.keyCode === 13)) { e.preventDefault(); }
    });
  }

  listEl.addEventListener('click', function (e) {
    var li = closest(e.target, 'li.rowcard');
    if (!li || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
    if (!mapVisible()) { return; }                       // the phone's List view: the link opens the place page
    e.preventDefault();
    select(li.getAttribute('data-id'), { fromList: true, focusCard: e.detail === 0 });
  });

  if (skipEl) {
    skipEl.addEventListener('click', function (e) {
      e.preventDefault();                              // no #map-view in the address
      viewEl.focus();
    });
  }

  zoomBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      if (!map) { return; }
      if (b.getAttribute('data-map-zoom') === 'in') { map.zoomIn(1); } else { map.zoomOut(1); }
    });
  });

  doc.addEventListener('click', function (e) {
    var t = e.target;
    if (closest(t, '[data-map-retry]')) { retry(); return; }
    if (closest(t, '[data-map-showlist]')) {
      if (win.matchMedia && win.matchMedia('(min-width: 1024px)').matches) {
        if (listBox) { listBox.setAttribute('tabindex', '-1'); listBox.focus(); }
      } else {
        showView('list');
      }
      return;
    }
    if (closest(t, '[data-map-clear-q]')) {
      if (qEl) { qEl.value = ''; }
      query = '';
      toks = [];
      applyFilters({ fit: true });
      if (qEl) { qEl.focus(); }
      return;
    }
    if (closest(t, '[data-map-reset]')) {
      VALID_LAYERS.forEach(function (g) { pressed[g] = false; });
      applyFilters({ fit: true });
    }
  });

  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.keyCode !== 27) { return; }
    if (doc.querySelector('dialog[open]') || !selected) { return; }
    var r = selected;
    var inCard = cardEl && cardEl.contains(doc.activeElement);
    clearSelection(false);
    if (inCard) {
      var link = $('.rowcard__title a', r.el);
      if (link && r.on && r.el.getClientRects().length) { link.focus(); }
    }
  });

  // A window resized from the phone's List view up to the desktop layout shows the map without a click on Map.
  win.addEventListener('resize', function () { if (!begun) { begin(); } });

  /* ---- start ------------------------------------------------------------------------------------------------- */
  var q0 = parseQuery();
  if (q0.layer) {
    var asked = q0.layer.toLowerCase().split(',').filter(function (g) { return VALID_LAYERS.indexOf(g) !== -1; });
    asked.forEach(function (g) { pressed[g] = true; });    // an unknown value is ignored; none valid means every layer
  }
  if (q0.q) {
    query = q0.q.replace(/^\s+|\s+$/g, '');
    toks = M.tokens(query);
    if (qEl) { qEl.value = query; }
  }
  if (q0.place && byId[q0.place] && !layerOn(byId[q0.place].group)) { pressed[byId[q0.place].group] = true; }   // a shared place link always shows its place
  if (q0.place && byId[q0.place] && query && !M.matches(byId[q0.place].prep, toks)) { query = ''; toks = []; if (qEl) { qEl.value = ''; } }

  buildMap();
  applyFilters({ noUrl: true, keepScroll: true });
  if (q0.view === 'list') { showView('list', { noUrl: true }); } else { begin(); }
  if (q0.place && byId[q0.place] && !selected) {          // the map is not on screen (the phone's List view): the card and the row still show it
    selected = byId[q0.place];
    renderCard(selected);
    markRow(selected);
  }
  if (selected && selected.el.scrollIntoView && listBox) {
    try { selected.el.scrollIntoView({ block: 'nearest' }); } catch (err) { /* no smooth or option support: leave the list where it is */ }
  }

  win.shMap = {
    map: function () { return map; },
    state: function () {
      return { layers: pressedLayers(), query: query, selected: selected && selected.id, shown: visible.length, errored: errored, begun: begun,
               waitedMs: errorAt !== null && waitStart !== null ? Math.round(errorAt - waitStart) : null };
    }
  };
}());
