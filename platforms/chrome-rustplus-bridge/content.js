(function initRustplusBridge() {
  if (window.__rustplusBridgeContentLoaded) return;
  window.__rustplusBridgeContentLoaded = true;

  function injectCaptureScript() {
    const script = document.createElement('script');
    script.textContent = `
      (function () {
        if (window.__rustplusBridgeMainLoaded) return;
        window.__rustplusBridgeMainLoaded = true;

        var emit = function (payload) {
          try {
            window.postMessage({ source: 'rustplus-bridge-token', payload: payload }, '*');
          } catch (_) {}
        };

        var install = function () {
          try {
            var current = window.ReactNativeWebView;
            if (current && typeof current.postMessage === 'function' && current.__rustplusBridgeWrapped) {
              return;
            }
            if (current && typeof current.postMessage === 'function') {
              var original = current.postMessage.bind(current);
              current.postMessage = function (message) {
                emit(message);
                return original(message);
              };
              current.__rustplusBridgeWrapped = true;
              return;
            }
            window.ReactNativeWebView = {
              postMessage: function (message) {
                emit(message);
              },
              __rustplusBridgeWrapped: true,
            };
          } catch (_) {}
        };

        install();
        setInterval(install, 300);
      })();
    `;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }

  injectCaptureScript();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.source !== 'rustplus-bridge-token') return;
    chrome.runtime.sendMessage({
      type: 'bridge:captured-token',
      payload: data.payload,
    }).catch(() => {});
  });
})();
