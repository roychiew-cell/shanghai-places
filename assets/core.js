/* core.js: menu and sheets, Show the driver, copy. Loaded on every page.
   Plain ES5 so older Android and WeChat browsers run it: no ?., no ??, no replaceAll, no modules.
   Hooks are data- attributes, never style classes:
     [data-open="id"]        opens the <dialog id="id"> as a sheet
     [data-close]            closes the sheet it sits in
     [data-driver-zh]        opens the Show the driver sheet with data-driver-zh (address), data-driver-name, data-driver-en
     [data-copy="text"]      copies text; a [data-label] inside shows "Copied" for two seconds
     [data-live]             the polite live region that announces "Address copied"
     [data-theme-toggle]     flips light and dark and remembers it (the button exists only when the config turns it on)
*/
(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;
  var opener = null;          // the control that started the current sheet flow; focus returns to it at the end
  var timers = [];

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

  function announce(msg) {
    var live = $('[data-live]');
    if (!live) { return; }
    live.textContent = '';
    window.setTimeout(function () { live.textContent = msg; }, 40);
  }

  /* ---- sheets (<dialog>) ------------------------------------------------------------------ */
  function afterClose() {
    // Runs when a sheet has closed. Only when no sheet is left open does the page unlock and focus go back.
    if ($$('dialog[open]').length) { return; }
    root.classList.remove('has-sheet');
    if (opener && opener.focus) { try { opener.focus(); } catch (e) { /* ignore */ } }
  }

  function openSheet(dlg, from) {
    if (!dlg) { return; }
    if (from) { opener = from; }
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) { dlg.showModal(); }
    } else {                                  // browsers without <dialog>: show it as a plain full-screen layer
      dlg.setAttribute('open', '');
      dlg.setAttribute('data-fallback', '');
    }
    root.classList.add('has-sheet');
  }

  function closeSheet(dlg) {
    if (!dlg) { return; }
    if (dlg.hasAttribute('data-fallback')) {
      dlg.removeAttribute('open');
      dlg.removeAttribute('data-fallback');
      afterClose();
    } else if (typeof dlg.close === 'function' && dlg.open) {
      dlg.close();                            // the 'close' event runs afterClose
    }
  }

  $$('dialog.sheet').forEach(function (dlg) {
    dlg.addEventListener('close', afterClose);
  });

  /* ---- Chinese addresses in chunks ------------------------------------------------------------ */
  /* zh-chunks:begin
     A Chinese address is cut into chunks that a line may break between, so a long address never breaks inside a road
     name or leaves a lone 号 on a line. The same rules as util.zh_chunks in tools/site/util.py (tools/test_site.py runs
     both on every address in the data and requires the same chunks); the text itself is never changed. */
  var ZH_UNITS = '\u7701\u5e02\u533a\u53bf\u8def\u8857\u9053\u5f04\u5df7\u53f7\u697c\u5c42\u5ba4\u5ea7\u680b\u573a\u53a6\u5fc3\u56ed';
  var ZH_OPEN = '([\uff08\u3010\u300a\u201c\u2018';
  var ZH_CLOSE = ')]\uff09\u3011\u300b\u201d\u2019';
  var ZH_STOPS = '\uff0c\uff1a\uff1b\u3001\uff0f\u3002';
  var ZH_STOPS_ASCII = ',:;/';
  var ZH_JOINERS = '-\u2014\u2013~';
  var ZH_TAILS = '\u7ebf\u53e3\u7ad9';

  function isSpace(c) { return /\s/.test(c); }
  function zhIsStop(c, nxt) {
    if (ZH_STOPS.indexOf(c) !== -1) { return true; }
    return ZH_STOPS_ASCII.indexOf(c) !== -1 && (nxt === '' || isSpace(nxt) || nxt.charCodeAt(0) > 127);
  }
  function zhSmall(ch) {
    var t = ch.replace(/^\s+|\s+$/g, '');
    if (t.length < 2) { return true; }
    for (var k = 0; k < t.length; k++) {
      if (ZH_UNITS.indexOf(t.charAt(k)) === -1 && ZH_TAILS.indexOf(t.charAt(k)) === -1) { return false; }
    }
    return true;
  }
  function zhChunks(text) {
    var s = text || '';
    var n = s.length;
    var out = [];
    var buf = '';
    var i = 0;
    while (i < n) {
      var c = s.charAt(i);
      if (ZH_OPEN.indexOf(c) !== -1 && buf) { out.push(buf); buf = ''; }
      buf += c;
      var nxt = i + 1 < n ? s.charAt(i + 1) : '';
      var nn = i + 2 < n ? s.charAt(i + 2) : '';
      var glued = nxt !== '' && (ZH_CLOSE.indexOf(nxt) !== -1 || ZH_JOINERS.indexOf(nxt) !== -1 || zhIsStop(nxt, nn));
      var brk = false;
      if (ZH_UNITS.indexOf(c) !== -1) {
        brk = nxt !== '' && !glued && ZH_UNITS.indexOf(nxt) === -1 && ZH_TAILS.indexOf(nxt) === -1;
      } else if (ZH_CLOSE.indexOf(c) !== -1 || zhIsStop(c, nxt)) {
        brk = nxt !== '' && !glued;
      }
      if (brk) {
        while (i + 1 < n && isSpace(s.charAt(i + 1))) { i += 1; buf += s.charAt(i); }
        if (i + 1 < n) { out.push(buf); buf = ''; }
      }
      i += 1;
    }
    if (buf) { out.push(buf); }
    var merged = [];
    for (var j = 0; j < out.length; j++) {
      if (merged.length && zhSmall(out[j])) { merged[merged.length - 1] += out[j]; } else { merged.push(out[j]); }
    }
    if (merged.length > 1 && zhSmall(merged[0])) { merged[1] = merged[0] + merged[1]; merged.shift(); }
    return merged;
  }
  /* zh-chunks:end */

  /* Fill an element with an address in inline-block chunks (class zh-chunk). Plain text when there is no break point. */
  function setChunks(el, text) {
    while (el.firstChild) { el.removeChild(el.firstChild); }
    var parts = zhChunks(text);
    if (parts.length < 2) { el.appendChild(doc.createTextNode(text)); return; }
    for (var k = 0; k < parts.length; k++) {
      var sp = doc.createElement('span');
      sp.className = 'zh-chunk';
      sp.appendChild(doc.createTextNode(parts[k]));
      el.appendChild(sp);
    }
  }

  /* ---- Show the driver --------------------------------------------------------------------- */
  function fillDriver(btn) {
    var dlg = $('#driver');
    if (!dlg) { return null; }
    var name = btn.getAttribute('data-driver-name') || '';
    var addr = btn.getAttribute('data-driver-zh') || '';
    var en = btn.getAttribute('data-driver-en') || '';
    var nameEl = $('[data-driver-field="name"]', dlg);
    var addrEl = $('[data-driver-field="addr"]', dlg);
    var enEl = $('[data-driver-field="en"]', dlg);
    nameEl.textContent = name;
    nameEl.hidden = !name;
    setChunks(addrEl, addr);               // the text is the same string; chunks only give a line somewhere to break
    enEl.textContent = en;
    enEl.hidden = !en;
    var text = name ? name + '，' + addr : addr;      // name, full-width comma, address
    $$('[data-driver-copy]', dlg).forEach(function (b) { b.setAttribute('data-copy', text); });
    var box = $('[data-driver-root]', dlg);
    if (box) { box.className = 'driver' + ((name + addr).length > 22 ? ' driver--long' : ''); }
    return dlg;
  }

  function openDriver(btn) {
    var inMenu = closest(btn, '#menu');
    var dlg = fillDriver(btn);
    if (!dlg) { return; }
    if (inMenu) {
      closeSheet(inMenu);                     // the header button that opened the menu stays the focus target
      openSheet(dlg, null);
    } else {
      openSheet(dlg, btn);
    }
  }

  /* ---- copy ---------------------------------------------------------------------------------- */
  function selectContents(el) {
    try {
      var range = doc.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* ignore */ }
  }

  function legacyCopy(text) {
    var ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
    doc.body.appendChild(ta);
    ta.select();
    try { ta.setSelectionRange(0, text.length); } catch (e) { /* ignore */ }
    var ok = false;
    try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
    doc.body.removeChild(ta);
    return ok;
  }

  function feedback(trigger, ok) {
    var scope = closest(trigger, '.driver, .address, .driver-card') || trigger;
    var buttons = $$('[data-copy]', scope);
    if (trigger.hasAttribute('data-copy')) { buttons.push(trigger); }
    buttons.forEach(function (b) {
      var label = $('[data-label]', b);
      if (ok) { b.setAttribute('data-state', 'done'); }
      if (label) {
        if (!label.hasAttribute('data-label-original')) { label.setAttribute('data-label-original', label.textContent); }
        label.textContent = ok ? 'Copied' : 'Press and hold to copy';
      }
    });
    announce(ok ? 'Address copied' : 'Could not copy. The address is selected: press and hold to copy it.');
    timers.forEach(function (t) { window.clearTimeout(t); });
    timers = [window.setTimeout(function () {
      buttons.forEach(function (b) {
        b.removeAttribute('data-state');
        var label = $('[data-label]', b);
        if (label && label.hasAttribute('data-label-original')) { label.textContent = label.getAttribute('data-label-original'); }
      });
    }, 2000)];
  }

  function copyText(text, trigger) {
    if (!text) { return; }
    var failed = function () {
      // The clipboard is refused (an in-app browser, an insecure page): select the text so it can be copied by hand.
      var visible = $('[data-driver-field="addr"]', closest(trigger, '.driver') || doc) || trigger;
      selectContents(closest(trigger, '.driver') ? visible.parentNode : visible);
      feedback(trigger, false);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { feedback(trigger, true); }, function () {
        if (legacyCopy(text)) { feedback(trigger, true); } else { failed(); }
      });
    } else if (legacyCopy(text)) {
      feedback(trigger, true);
    } else {
      failed();
    }
  }

  /* ---- theme toggle: only present when config features.theme_toggle is true ------------------- */
  var toggle = $('[data-theme-toggle]');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var cur = root.getAttribute('data-theme');
      if (!cur) { cur = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'; }
      var next = cur === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); sessionStorage.setItem('theme', next); } catch (e) { /* ignore */ }
      announce(next === 'dark' ? 'Dark theme' : 'Light theme');
    });
  }

  /* ---- one delegated click handler ----------------------------------------------------------- */
  doc.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || t.nodeType !== 1) { return; }
    var drv = closest(t, '[data-driver-zh]');
    if (drv) { e.preventDefault(); openDriver(drv); return; }
    var op = closest(t, '[data-open]');
    if (op) { e.preventDefault(); openSheet(doc.getElementById(op.getAttribute('data-open')), op); return; }
    var cl = closest(t, '[data-close]');
    if (cl) { closeSheet(closest(cl, 'dialog')); return; }
    var cp = closest(t, '[data-copy]');
    if (cp) { copyText(cp.getAttribute('data-copy'), cp); return; }
    if (t.tagName === 'DIALOG' && t.className.indexOf('sheet--driver') !== -1) { closeSheet(t); }   // click on the backdrop
  });

  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.keyCode !== 27) { return; }
    var open = $('dialog[data-fallback][open]');
    if (open) { closeSheet(open); }
  });

  // A page restored from the back-forward cache must not keep the scroll lock.
  window.addEventListener('pageshow', function () {
    if (!$$('dialog[open]').length) { root.classList.remove('has-sheet'); }
  });

  /* The offline copy: register sw.js, which sits at the site's root while this script sits at <root>/assets/core.js. It does
     nothing in a browser without service workers, on a file address, or when the visitor switched the copy off on the
     "Use it offline" page (localStorage sc-offline = off). */
  (function () {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) { return; }
    try { if (window.localStorage.getItem('sc-offline') === 'off') { return; } } catch (e) { /* private mode: carry on */ }
    var src = doc.currentScript && doc.currentScript.src ? doc.currentScript.src : '';
    if (!src) {
      var all = doc.getElementsByTagName('script');
      for (var i = 0; i < all.length; i++) { if (/\/assets\/core\.js/.test(all[i].src)) { src = all[i].src; break; } }
    }
    var base = src.replace(/assets\/core\.js.*$/, '');
    if (!src || base === src) { return; }
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(base + 'sw.js').catch(function () { /* no offline copy: the site works as before */ });
    });
  }());
}());
