/* offline.js: the "Use it offline" page. Talks to the service worker (sw.js): shows what is saved, saves every photograph on
   request, and switches the offline copy off or on. Plain ES5. Nothing here sends anything anywhere.
   The choice to switch the copy off is remembered in this browser (localStorage 'sc-offline' = 'off'), where core.js reads it. */
(function () {
  'use strict';
  var doc = document;
  var box = doc.querySelector('[data-offline]');
  if (!box) { return; }
  var KEY = 'sc-offline';
  var elPages = doc.querySelector('[data-offline-pages]');
  var elPhotos = doc.querySelector('[data-offline-photos]');
  var bar = doc.querySelector('.offline__bar');
  var fill = doc.querySelector('[data-offline-fill]');
  var note = doc.querySelector('[data-offline-note]');
  var btnSave = doc.querySelector('[data-offline-save]');
  var btnRemove = doc.querySelector('[data-offline-remove]');
  var saving = false;
  var asked = false;
  var lastStatus = null;

  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function getOff() { try { return window.localStorage.getItem(KEY) === 'off'; } catch (e) { return false; } }
  function setOff(on) {
    try { if (on) { window.localStorage.setItem(KEY, 'off'); } else { window.localStorage.removeItem(KEY); } } catch (e) { /* private mode */ }
  }

  box.hidden = false;
  if (!('serviceWorker' in navigator) || !window.caches || !/^https?:$/.test(location.protocol)) {
    elPages.textContent = 'Not available in this browser';
    elPhotos.textContent = 'Not available in this browser';
    btnSave.hidden = true;
    btnRemove.hidden = true;
    note.textContent = 'This browser cannot keep an offline copy. The pages work as usual while you are online.';
    return;
  }

  function post(msg) {
    return navigator.serviceWorker.ready.then(function (reg) {
      var w = navigator.serviceWorker.controller || reg.active;
      if (w) { w.postMessage(msg); }
    });
  }

  function show(s) {
    lastStatus = s;
    if (getOff()) {
      elPages.textContent = 'Switched off on this device';
      elPhotos.textContent = 'Switched off on this device';
      btnSave.hidden = true;
      btnRemove.textContent = 'Switch the offline copy on';
      return;
    }
    btnRemove.textContent = 'Remove the offline copy';
    elPages.textContent = !s.core ? 'Not saved yet: they save by themselves once the page has loaded; check again in a minute'
      : (s.missing ? 'Saved, except ' + fmt(s.missing) + ' pages that are being fetched again; check again in a minute' : 'Saved on this device');
    if (s.core && !asked) {                              // ask the browser not to clear the copy (silent in most browsers)
      asked = true;
      if (navigator.storage && navigator.storage.persist) { navigator.storage.persist(); }
    }
    var rest = s.photos > 0 && s.photos < s.photosTotal;
    elPhotos.textContent = s.photos >= s.photosTotal ? 'All ' + fmt(s.photosTotal) + ' saved'
      : fmt(s.photos) + ' of ' + fmt(s.photosTotal) + ' saved';
    btnSave.hidden = !s.core || s.photos >= s.photosTotal;
    btnSave.textContent = (rest ? 'Save the rest of the photographs' : 'Save all photographs') +
      ' (about ' + Math.round((rest ? s.photoBytesLeft : s.photoBytes) / 1e6) + ' MB)';
  }

  function ask() { post({ type: 'status' }); }

  navigator.serviceWorker.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'status') {
      show(d);
    } else if (d.type === 'photos-progress') {
      bar.hidden = false;
      fill.style.width = Math.round(100 * d.done / d.total) + '%';
      note.textContent = 'Saving photographs: ' + fmt(d.done) + ' of ' + fmt(d.total) + (d.failed ? ' (' + fmt(d.failed) + ' could not be saved yet)' : '');
    } else if (d.type === 'photos-done') {
      saving = false;
      btnSave.disabled = false;
      fill.style.width = '100%';
      note.textContent = d.failed ? 'Done, except ' + fmt(d.failed) + ' photographs that could not be saved. Press the button again to retry them.'
        : 'All photographs are saved on this device.';
      ask();
    } else if (d.type === 'removed') {
      note.textContent = 'The offline copy was removed from this device.';
      bar.hidden = true;
      ask();
    }
  });

  btnSave.addEventListener('click', function () {
    if (saving) { return; }
    saving = true;
    btnSave.disabled = true;
    bar.hidden = false;
    fill.style.width = '0';
    note.textContent = 'Saving photographs. Keep this page open.';
    if (navigator.storage && navigator.storage.persist) { navigator.storage.persist(); }      // ask the browser not to clear the copy
    post({ type: 'save-photos' });
  });

  btnRemove.addEventListener('click', function () {
    if (getOff()) {                                      // switch on again
      setOff(false);
      note.textContent = 'Switched on. The pages are being saved; check the status in a minute.';
      navigator.serviceWorker.register(location.href.replace(/offline\/.*$/, '') + 'sw.js').then(function () { window.setTimeout(ask, 2500); })
        .catch(function () { note.textContent = 'The offline copy could not be switched on in this browser.'; });
      return;
    }
    setOff(true);
    post({ type: 'remove-all' });
    window.setTimeout(function () {
      var base = location.href.replace(/offline\/.*$/, '');         // only this site's own worker: others on the same host stay
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        regs.forEach(function (r) { if (r.scope === base) { r.unregister(); } });
      });
      show(lastStatus || { core: false, photos: 0, photosTotal: 0, photoBytes: 0 });
    }, 800);
  });

  show({ core: false, photos: 0, photosTotal: 0, photoBytes: 0 });
  elPages.textContent = 'Checking';
  elPhotos.textContent = 'Checking';
  if (getOff()) { show(lastStatus); return; }
  ask();
  window.setTimeout(ask, 2500);
  window.setTimeout(ask, 7000);
}());
