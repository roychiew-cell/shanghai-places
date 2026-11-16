/* match.js: how a typed query is matched against a place's text. Shared by map.js and search.js, so the map's
   search box and the Search page agree. Plain ES5 (older Android and WeChat browsers): no ?., no ??, no arrow
   functions, no modules. Loaded before the page script, exposes window.ShMatch.

   norm(text)            lower case, accents and apostrophes dropped (Jing'an and jingan match), hyphens, dots,
                         brackets and the Chinese middle dot turned into spaces, one space between words
   tokens(query)         the normalised words of a query; every word has to be found
   prepare(text)         {h, c}: the normalised text, and the same text with its spaces removed (so a Chinese name
                         typed without the space that the data keeps after a middle dot still matches)
   matches(prep, toks)   true when every token is found in prep.h (any token) or, for a token with a Chinese
                         character, in prep.c
   hasCjk(text)          true when the text holds a Chinese character
   fill(el, text)        puts the text into el, each run of Chinese inside <span lang="zh-Hans"> (a query echoed back to the
                         visitor can hold Chinese, and every Chinese run on the site carries its language)
*/
(function (root) {
  'use strict';

  var CJK = /[\u2e80-\u2fdf\u3000-\u303f\u31c0-\u31ef\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

  function norm(s) {
    s = String(s === null || s === undefined ? '' : s);
    try { s = s.normalize('NFKD'); } catch (e) { /* an old browser: carry on without */ }
    s = s.replace(/[\u0300-\u036f]/g, '')
         .replace(/[\u2018\u2019\u02bc'`\u00b4]/g, '')
         .replace(/[\-\u2010-\u2015\u00b7_\/,;:.()\[\]{}\u3001\u3002\u30fb]+/g, ' ')
         .toLowerCase();
    return s.replace(/\s+/g, ' ').replace(/^ | $/g, '');
  }

  function tokens(q) {
    var n = norm(q);
    return n ? n.split(' ') : [];
  }

  function prepare(text) {
    var h = norm(text);
    return { h: h, c: h.replace(/ /g, '') };
  }

  function hasCjk(s) { return CJK.test(String(s || '')); }

  function matches(prep, toks) {
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (prep.h.indexOf(t) !== -1) { continue; }
      if (hasCjk(t) && prep.c.indexOf(t) !== -1) { continue; }
      return false;
    }
    return true;
  }

  var CJK_RUN = /[\u2e80-\u2fdf\u3000-\u303f\u31c0-\u31ef\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]+/g;

  function fill(el, text) {
    var s = String(text === null || text === undefined ? '' : text);
    var last = 0;
    var m;
    el.textContent = '';
    CJK_RUN.lastIndex = 0;
    while ((m = CJK_RUN.exec(s)) !== null) {
      if (m.index > last) { el.appendChild(document.createTextNode(s.slice(last, m.index))); }
      var span = document.createElement('span');
      span.setAttribute('lang', 'zh-Hans');
      span.textContent = m[0];
      el.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < s.length) { el.appendChild(document.createTextNode(s.slice(last))); }
  }

  root.ShMatch = { norm: norm, tokens: tokens, prepare: prepare, matches: matches, hasCjk: hasCjk, fill: fill };
}(window));
