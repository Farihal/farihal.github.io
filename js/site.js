// Tabs, deep links and the copy-email button. Runs without the 3D demos.
(function () {
  'use strict';
  var REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /* ---------- Area tabs ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab')), tabBar = document.querySelector('.tabs');
  function showTab(id, focus) {
    tabs.forEach(function (t) {
      var on = t.getAttribute('aria-controls') === id;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    });
    try { localStorage.setItem('fa-area', id); } catch (e) {}
  }
  function scrollToEl(el) {
    var top = el.getBoundingClientRect().top + window.scrollY - (el.matches('[role=tabpanel]') ? 0 : 0);
    window.scrollTo({ top: Math.max(0, top - (el.matches('[role=tabpanel]') ? 0 : tabBar.offsetHeight + 8)), behavior: REDUCE ? 'auto' : 'smooth' });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { showTab(t.getAttribute('aria-controls')); });
    t.addEventListener('keydown', function (e) {
      var k = e.key, n = tabs.length, j = k === 'ArrowRight' ? (i + 1) % n : k === 'ArrowLeft' ? (i - 1 + n) % n : k === 'Home' ? 0 : k === 'End' ? n - 1 : -1;
      if (j < 0) return; e.preventDefault(); showTab(tabs[j].getAttribute('aria-controls'), true);
    });
  });
  // Links to a project or area open the right tab first
  function panelFor(el) { return el ? (el.matches('[role=tabpanel]') ? el : el.closest('[role=tabpanel]')) : null; }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a) return;
    var el = document.getElementById(a.getAttribute('href').slice(1)), pnl = panelFor(el);
    if (!pnl) return;
    e.preventDefault(); showTab(pnl.id);
    requestAnimationFrame(function () { scrollToEl(el === pnl ? tabBar : el); });
  });
  (function () {
    var h = location.hash.slice(1), el = h && document.getElementById(h), pnl = panelFor(el), saved = null;
    try { saved = localStorage.getItem('fa-area'); } catch (e) {}
    if (pnl) { showTab(pnl.id); requestAnimationFrame(function () { scrollToEl(el === pnl ? tabBar : el); }); }
    else if (saved && $(saved) && $(saved).matches('[role=tabpanel]')) showTab(saved);
  })();

  /* ---------- Email: assembled at load so simple bots scanning the page source don't find it ---------- */
  var mail = $('mail'), addr = mail.dataset.u + '@' + mail.dataset.d;
  mail.href = 'mailto:' + addr; $('mail-text').textContent = addr; mail.setAttribute('aria-label', 'Email ' + addr);
  $('copy').addEventListener('click', function () {
    var note = $('copied');
    function fallback() {
      var r = document.createRange(); r.selectNodeContents($('mail-text'));
      var s = getSelection(); s.removeAllRanges(); s.addRange(r);
      note.textContent = 'Selected. Press Ctrl+C or ⌘C to copy.';
    }
    try { navigator.clipboard.writeText(addr).then(function () { note.textContent = 'Email copied'; setTimeout(function () { note.textContent = ''; }, 2500); }, fallback); }
    catch (e) { fallback(); }
  });

})();
