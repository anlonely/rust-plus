(function initRustplusBridgePageHook() {
  if (window.__rustplusBridgePageHookLoaded) return;
  window.__rustplusBridgePageHookLoaded = true;

  const SOURCE = 'rustplus-bridge-token';
  let lastToken = '';

  function emitToken(token, meta = {}) {
    const value = String(token || '').trim();
    if (!value || value === lastToken) return;
    lastToken = value;
    try {
      window.postMessage({
        source: SOURCE,
        payload: {
          rustplusAuthToken: value,
          meta,
        },
      }, '*');
    } catch (_) {}
  }

  function looksLikeToken(value) {
    const text = String(value || '').trim();
    return !!text && text.includes('.') && text.length > 20;
  }

  function pickToken(input) {
    if (!input) return '';
    if (typeof input === 'string') {
      const text = input.trim();
      if (!text) return '';
      if (looksLikeToken(text)) return text;
      if (text.startsWith('{') || text.startsWith('[')) {
        try {
          return pickToken(JSON.parse(text));
        } catch (_) {
          return '';
        }
      }
      return '';
    }
    if (typeof input === 'object') {
      const candidates = [
        input.rustplusAuthToken,
        input.rustplus_auth_token,
        input.authToken,
        input.Token,
        input.token,
        input.auth && (input.auth.Token || input.auth.token),
      ];
      for (const candidate of candidates) {
        const token = pickToken(candidate);
        if (token) return token;
      }
    }
    return '';
  }

  function scanStorage(storage, label) {
    if (!storage) return;
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        const raw = storage.getItem(key);
        const token = pickToken(raw) || (/(rust|auth|token)/i.test(String(key || '')) ? pickToken({ token: raw }) : '');
        if (token) {
          emitToken(token, { source: label, key: String(key || '') });
          return;
        }
      }
    } catch (_) {}
  }

  function scanCookies() {
    try {
      const raw = String(document.cookie || '');
      const parts = raw.split(';');
      for (const part of parts) {
        const [name, ...rest] = part.split('=');
        if (!/(rust|auth|token)/i.test(String(name || ''))) continue;
        const value = decodeURIComponent(rest.join('=') || '');
        const token = pickToken(value) || (looksLikeToken(value) ? value.trim() : '');
        if (token) {
          emitToken(token, { source: 'cookie', key: String(name || '').trim() });
          return;
        }
      }
    } catch (_) {}
  }

  function installReactNativeWebViewHook() {
    try {
      const current = window.ReactNativeWebView;
      if (current && current.__rustplusBridgeWrapped) return;
      if (current && typeof current.postMessage === 'function') {
        const original = current.postMessage.bind(current);
        current.postMessage = function patchedPostMessage(message) {
          const token = pickToken(message);
          if (token) emitToken(token, { source: 'rn-webview' });
          return original(message);
        };
        current.__rustplusBridgeWrapped = true;
        return;
      }
      window.ReactNativeWebView = {
        postMessage(message) {
          const token = pickToken(message);
          if (token) emitToken(token, { source: 'rn-webview-stub' });
        },
        __rustplusBridgeWrapped: true,
      };
    } catch (_) {}
  }

  function scanAll() {
    installReactNativeWebViewHook();
    scanStorage(window.localStorage, 'localStorage');
    scanStorage(window.sessionStorage, 'sessionStorage');
    scanCookies();
  }

  installReactNativeWebViewHook();
  scanAll();
  setInterval(scanAll, 500);
  window.addEventListener('storage', scanAll);
  window.addEventListener('focus', scanAll);
})();
