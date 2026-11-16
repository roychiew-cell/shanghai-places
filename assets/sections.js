/* sections.js: a phone-only label that follows the reader down See and Errands and says which section is on screen.
   Those pages are 20,000 to 40,000 px long on a phone and the "On this page" list is only at the top. A plain sticky list
   does not work (it would only stick inside its own short box), so this is a small fixed bar that a script shows and hides.
   Plain ES5, IntersectionObserver only (a browser without it never shows the bar), nothing without scripting: the bar is
   in the page with the hidden attribute and is hidden for assistive technology, because the page already has headings
   and the "Back to sections" links.

   Hooks (data- attributes):
     [data-section-label]   the bar; [data-section-name] the section's title, [data-section-where] "3 of 6"
     #sections              the page's "On this page" list: the bar shows once it has scrolled out of the top of the window
     .list-section          every section; the current one is the last whose top is above a quarter of the window height */
(function () {
  'use strict';
  var doc = document;
  var label = doc.querySelector('[data-section-label]');
  var jump = doc.getElementById('sections');
  if (!label || !jump || !('IntersectionObserver' in window) || !window.matchMedia) { return; }

  var nameEl = label.querySelector('[data-section-name]');
  var whereEl = label.querySelector('[data-section-where]');
  var sections = Array.prototype.slice.call(doc.querySelectorAll('.list-section'));
  var phone = window.matchMedia('(max-width: 639px)');
  var shown = -2;                         // the index shown now; -1 means the bar is hidden

  function titleOf(section) {
    var h = section.querySelector('.section__head h2');
    return h ? h.textContent.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '') : '';
  }

  function update() {
    var idx = -1;
    if (phone.matches && jump.getBoundingClientRect().bottom < 0) {
      var line = window.innerHeight * 0.25;
      for (var i = 0; i < sections.length; i++) {
        var r = sections[i].getBoundingClientRect();
        if (r.top <= line && r.bottom > 0) { idx = i; }
      }
    }
    if (idx === shown) { return; }
    shown = idx;
    if (idx < 0) { label.hidden = true; return; }
    nameEl.textContent = titleOf(sections[idx]);
    whereEl.textContent = (idx + 1) + ' of ' + sections.length;
    label.hidden = false;
  }

  var observer = new IntersectionObserver(update, { rootMargin: '0px 0px -75% 0px', threshold: [0, 1] });
  observer.observe(jump);
  sections.forEach(function (s) { observer.observe(s); });
  window.addEventListener('resize', update);
  update();
}());
