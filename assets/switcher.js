/* switcher.js: on a category page the row of sibling links (the switcher) is a single line that scrolls sideways on a phone, so the
   page's own chip can start off screen ("Live music" is the seventh). This brings it into view when the page opens. Nothing
   else: no state, no network, no animation (so nothing for a reduced-motion setting to turn off). Without scripting the row
   is simply scrolled to its start and every link still works.
   Plain ES5 so older Android and WeChat browsers run it.

   Hooks: .switcher .chips (the row), [aria-current="page"] inside it (the page's own chip). */
(function () {
  'use strict';
  var rows = document.querySelectorAll('.switcher .chips');
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var chip = row.querySelector('[aria-current="page"]');
    if (!chip || row.scrollWidth <= row.clientWidth) { continue; }
    var shift = chip.getBoundingClientRect().left - row.getBoundingClientRect().left;       // where the chip starts inside the row, as shown now
    var want = row.scrollLeft + shift - (row.clientWidth - chip.offsetWidth) / 2;           // centre it
    row.scrollLeft = Math.max(0, Math.min(want, row.scrollWidth - row.clientWidth));
  }
}());
