/* detail.js: the place pages (builder U2). Plain ES5, no dependencies. Two small jobs.

   1. The photograph gallery. Every photograph is already in the page as a <figure data-slide="n"> (only the first is
      shown) with its own credit line; the thumbnails are links to the full pictures, so without this file they open the
      picture itself. With it, a thumbnail shows its figure in the lead position. Arrow keys move between thumbnails
      and the polite live region [data-live] (core.js) announces "Photo 3 of 10".
      Hooks: [data-gallery] the block, [data-slide] a figure, [data-thumb] a thumbnail link (aria-current = shown).

   2. The sticky aside. From 1024 px the address and facts stay in view beside the body, but only when they fit in the
      window: a taller aside would hide its last rows, so it then stays in the page's flow and scrolls with it.
      The page is correct without this file (the aside is simply not sticky).
      Hook: .d-aside, which gets the class is-sticky when it fits.
*/
(function () {
  'use strict';
  var doc = document;

  function announce(msg) {
    var live = doc.querySelector('[data-live]');
    if (!live) { return; }
    live.textContent = '';
    window.setTimeout(function () { live.textContent = msg; }, 40);
  }

  /* ---- gallery -------------------------------------------------------------------------------- */
  var box = doc.querySelector('[data-gallery]');
  if (box) {
    var figs = Array.prototype.slice.call(box.querySelectorAll('[data-slide]'));
    var thumbs = Array.prototype.slice.call(box.querySelectorAll('[data-thumb]'));
    if (thumbs.length > 1 && figs.length === thumbs.length) {
      var show = function (i) {
        figs.forEach(function (f, j) { f.hidden = j !== i; });
        thumbs.forEach(function (t, j) {
          if (j === i) { t.setAttribute('aria-current', 'true'); } else { t.removeAttribute('aria-current'); }
        });
        announce('Photo ' + (i + 1) + ' of ' + figs.length);
      };
      thumbs.forEach(function (t, i) {
        t.addEventListener('click', function (e) {
          e.preventDefault();
          show(i);
        });
        t.addEventListener('keydown', function (e) {
          var k = e.key || '';
          var to = -1;
          if (k === 'ArrowRight' || k === 'Right') { to = Math.min(thumbs.length - 1, i + 1); }
          if (k === 'ArrowLeft' || k === 'Left') { to = Math.max(0, i - 1); }
          if (to > -1 && to !== i) {
            e.preventDefault();
            thumbs[to].focus();
            show(to);
          }
        });
      });
    }
  }

  /* ---- sticky aside --------------------------------------------------------------------------- */
  var aside = doc.querySelector('.d-aside');
  if (aside && window.matchMedia) {
    var wide = window.matchMedia('(min-width: 1024px)');
    var pending = false;
    var fit = function () {
      pending = false;
      aside.classList.remove('is-sticky');
      var room = (window.innerHeight || doc.documentElement.clientHeight) - 48;     // the sticky offset on both sides
      if (wide.matches && aside.offsetHeight <= room) { aside.classList.add('is-sticky'); }
    };
    var later = function () {
      if (pending) { return; }
      pending = true;
      if (window.requestAnimationFrame) { window.requestAnimationFrame(fit); } else { window.setTimeout(fit, 50); }
    };
    fit();
    window.addEventListener('resize', later);
    window.addEventListener('orientationchange', later);
    window.addEventListener('load', later);                 // photographs and fonts can change the heights
  }
}());
