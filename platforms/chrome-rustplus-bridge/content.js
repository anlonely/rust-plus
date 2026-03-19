(function initRustplusBridgeContent() {
  if (window.__rustplusBridgeContentLoaded) return;
  window.__rustplusBridgeContentLoaded = true;

  const SCRIPT_ID = 'rustplus-bridge-page-hook';
  const SOURCE = 'rustplus-bridge-token';

  function injectPageHook() {
    if (document.getElementById(SCRIPT_ID)) return;
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = chrome.runtime.getURL('page-hook.js');
    script.async = false;
    (document.documentElement || document.head || document.body).appendChild(script);
  }

  function forwardToken(payload) {
    chrome.runtime.sendMessage({
      type: 'bridge:captured-token',
      payload,
    }).catch(() => {});
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.source !== SOURCE) return;
    if (!data.payload) return;
    forwardToken(data.payload);
  });

  injectPageHook();
})();
