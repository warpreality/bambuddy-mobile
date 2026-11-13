// Injected into the MakerWorld sign-in WebView. It dismisses the "Open in Bambu Handy"
// prompt (by pressing its own cancel button) and hides the cookie banner without
// accepting anything, so sign-in is not blocked by overlays. Matching is by text, which
// survives MakerWorld's generated class names; only fixed-position overlays are touched.
export const MAKERWORLD_SIGN_IN_CLEANUP_JS = `(function () {
  if (window.__bambuddyCleanup) return;
  window.__bambuddyCleanup = true;
  var HANDY = /Bambu Handy/;
  var COOKIES = /cookie/i;
  function overlayOf(node) {
    var el = node && node.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      var style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') return el;
      el = el.parentElement;
    }
    return null;
  }
  function hide(el) { el.style.setProperty('display', 'none', 'important'); el.setAttribute('data-bambuddy-hidden', '1'); }
  function sweep() {
    if (!document.body) return;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var seen = [];
    var node;
    while ((node = walker.nextNode())) {
      var text = node.nodeValue || '';
      var handy = HANDY.test(text);
      if (!handy && !COOKIES.test(text)) continue;
      var overlay = overlayOf(node);
      if (!overlay || seen.indexOf(overlay) >= 0 || overlay.getAttribute('data-bambuddy-hidden')) continue;
      seen.push(overlay);
      if (handy) {
        var buttons = overlay.querySelectorAll('button, [role="button"], a');
        var cancel = null;
        for (var i = 0; i < buttons.length; i++) {
          if (!HANDY.test(buttons[i].textContent || '')) cancel = buttons[i];
        }
        if (cancel) { cancel.click(); continue; }
      }
      hide(overlay);
    }
    if (document.body.style.overflow === 'hidden' && !document.querySelector('[role="dialog"]:not([data-bambuddy-hidden])')) {
      document.body.style.overflow = '';
    }
  }
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; try { sweep(); } catch (e) {} }, 150);
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', schedule);
  schedule();
})(); true;`;
