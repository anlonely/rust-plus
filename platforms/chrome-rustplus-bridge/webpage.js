(function initRustplusWebPageBridge() {
  if (window.__rustplusWebPageBridgeLoaded) return;
  window.__rustplusWebPageBridgeLoaded = true;

  const SOURCE = 'rustplus-web-bridge';

  function postToPage(type, payload = {}) {
    try {
      window.postMessage({ source: SOURCE, type, payload }, location.origin);
    } catch (_) {}
  }

  function forwardToBackground(message) {
    return chrome.runtime.sendMessage(message);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== location.origin) return;
    const data = event.data || {};
    if (data.source !== SOURCE) return;

    const type = String(data.type || '').trim();
    if (!type) return;

    if (type === 'bridge:probe') {
      postToPage('bridge:ready', {
        origin: location.origin,
        href: location.href,
      });
      return;
    }

    if (type === 'bridge:start' || type === 'bridge:resume' || type === 'bridge:stop' || type === 'bridge:getState') {
      forwardToBackground({ type, payload: data.payload || {} })
        .then((response) => {
          postToPage(`${type}:response`, {
            requestId: data.requestId || '',
            response,
          });
        })
        .catch((err) => {
          postToPage(`${type}:response`, {
            requestId: data.requestId || '',
            error: String(err?.message || err || 'bridge error'),
          });
        });
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'bridge:state') return;
    postToPage('bridge:state', { state: msg.state || {} });
  });

  forwardToBackground({ type: 'bridge:getState' })
    .then((response) => {
      if (response?.success) {
        postToPage('bridge:state', { state: response.state || {} });
      }
    })
    .catch(() => {})
    .finally(() => {
      postToPage('bridge:ready', {
        origin: location.origin,
        href: location.href,
      });
    });
})();
