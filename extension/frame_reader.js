// ============================================================================
// Claude Exporter Pro — Frame Reader
// Runs inside standalone artifact frames (*.frame.claudeusercontent.com),
// including when they are embedded as a hidden iframe by browse.html.
// It reads the served HTML and posts it up to the parent (browse.js).
// ============================================================================

(function () {
  if (window.__claudeExporterFrameReader) return;
  window.__claudeExporterFrameReader = true;

  let sent = false;

  function post(html, method) {
    if (sent) return;
    sent = true;
    try {
      window.parent.postMessage(
        {
          __claudeExporterFrame: true,
          url: location.href,
          title: document.title || '',
          html: html,
          method: method,
        },
        '*'
      );
    } catch (e) {
      /* parent gone */
    }
  }

  async function grab() {
    if (sent) return;
    // Prefer the raw served bytes via a same-origin fetch. If the host gates
    // non-iframe requests (302 to the claude.ai wrapper), this fails and we
    // fall back to the serialized live DOM, which is fine for HTML artifacts.
    let html = null;
    let method = 'fetch';
    try {
      const r = await fetch(location.href, { credentials: 'include' });
      if (r.ok && !r.redirected) {
        const t = await r.text();
        if (t && t.length > 200) html = t;
      }
    } catch (e) {
      /* gated — fall back */
    }
    if (!html) {
      method = 'outerHTML';
      html = '<!doctype html>\n' + document.documentElement.outerHTML;
    }
    post(html, method);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    grab();
  } else {
    window.addEventListener('DOMContentLoaded', grab);
  }
  // Safety net in case content mounts late.
  window.addEventListener('load', () => setTimeout(grab, 400));
})();
