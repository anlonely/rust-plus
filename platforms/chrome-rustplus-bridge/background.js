const FLOW_TIMEOUT_MS = 8 * 60 * 1000;

const runtimeState = {
  active: false,
  startedAt: 0,
  serverUrl: '',
  bootstrapToken: '',
  bridgeSessionId: '',
  ownerRef: '',
  tabId: null,
  status: 'idle',
  lastError: '',
  lastSteamId: '',
  lastResponseAt: 0,
  pausedAt: 0,
};

let timeoutTimer = null;
let defaultsLoadPromise = null;

function normalizeServerUrl(raw) {
  let input = String(raw || '').trim();
  if (!input) throw new Error('服务器地址不能为空');
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('服务器地址协议必须是 http 或 https');
  return url.origin;
}

function parseRustplusToken(input) {
  if (!input) return '';
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) return '';
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return parseRustplusToken(JSON.parse(text));
      } catch (_) {
        return '';
      }
    }
    return text;
  }
  if (typeof input === 'object') {
    const candidates = [
      input.rustplusAuthToken,
      input.authToken,
      input.Token,
      input.token,
      input.auth?.Token,
      input.auth?.token,
    ];
    for (const item of candidates) {
      const token = parseRustplusToken(item);
      if (token) return token;
    }
  }
  return '';
}

function decodeSteamId(token) {
  try {
    const split = String(token || '').split('.');
    const payload = split[0] || '';
    const decoded = JSON.parse(atob(payload));
    return String(decoded?.steamId || '');
  } catch (_) {
    return '';
  }
}

function setStatus(nextStatus, error = '') {
  runtimeState.status = nextStatus;
  runtimeState.lastError = error || '';
  notifyStateUpdate();
}

function buildRemoteLoginUrl() {
  if (!runtimeState.serverUrl || !runtimeState.bootstrapToken) {
    return 'https://companion-rust.facepunch.com/login';
  }
  const callbackUrl = new URL('/steam-bridge/callback', runtimeState.serverUrl);
  callbackUrl.searchParams.set('bootstrapToken', runtimeState.bootstrapToken);
  return `https://companion-rust.facepunch.com/login?returnUrl=${encodeURIComponent(callbackUrl.toString())}`;
}

async function loadBundledDefaults() {
  if (!defaultsLoadPromise) {
    defaultsLoadPromise = fetch(chrome.runtime.getURL('bridge-defaults.json'))
      .then((response) => {
        if (!response.ok) throw new Error(`defaults ${response.status}`);
        return response.json();
      })
      .catch(() => ({}));
  }
  return defaultsLoadPromise;
}

function isFlowExpired(config = {}) {
  const expiresAtMs = Date.parse(String(config?.expiresAt || '').trim());
  if (!Number.isFinite(expiresAtMs)) return false;
  return expiresAtMs <= Date.now();
}

async function applyBundledDefaults({ autoStart = false, force = false } = {}) {
  const defaults = await loadBundledDefaults();
  const serverUrl = String(defaults?.serverUrl || '').trim();
  const bootstrapToken = String(defaults?.bootstrapToken || defaults?.sessionCode || '').trim();
  const bridgeSessionId = String(defaults?.bridgeSessionId || '').trim();
  const ownerRef = String(defaults?.ownerRef || '').trim();

  if (!serverUrl || !bootstrapToken) return { applied: false, skipped: 'empty_defaults' };
  if (isFlowExpired(defaults)) return { applied: false, skipped: 'expired_defaults' };

  const storage = await chrome.storage.local.get(['rustplusBridgeConfig']);
  const current = storage.rustplusBridgeConfig || {};
  const shouldStore = force
    || String(current.serverUrl || '').trim() !== serverUrl
    || String(current.bootstrapToken || current.sessionCode || '').trim() !== bootstrapToken
    || String(current.bridgeSessionId || '').trim() !== bridgeSessionId
    || String(current.ownerRef || '').trim() !== ownerRef;

  if (shouldStore) {
    await chrome.storage.local.set({
      rustplusBridgeConfig: {
        ...current,
        serverUrl,
        bootstrapToken,
        bridgeSessionId,
        ownerRef,
        autoConfiguredAt: new Date().toISOString(),
      },
    });
  }

  runtimeState.bridgeSessionId = bridgeSessionId;
  runtimeState.ownerRef = ownerRef;
  notifyStateUpdate();

  if (autoStart && defaults.autoStartOnInstall !== false && !runtimeState.active) {
    await startFlow({
      serverUrl,
      bootstrapToken,
      bridgeSessionId,
      ownerRef,
    });
    return { applied: true, started: true };
  }

  return { applied: true, started: false };
}

function toPublicState() {
  return {
    active: runtimeState.active,
    startedAt: runtimeState.startedAt,
    serverUrl: runtimeState.serverUrl,
    bridgeSessionId: runtimeState.bridgeSessionId,
    ownerRef: runtimeState.ownerRef,
    tabId: runtimeState.tabId,
    status: runtimeState.status,
    lastError: runtimeState.lastError,
    lastSteamId: runtimeState.lastSteamId,
    lastResponseAt: runtimeState.lastResponseAt,
    pausedAt: runtimeState.pausedAt,
  };
}

function notifyStateUpdate() {
  const payload = { type: 'bridge:state', state: toPublicState() };
  chrome.runtime.sendMessage(payload).catch(() => {});
  chrome.storage.local.set({ rustplusBridgeState: payload.state }).catch(() => {});
}

function clearFlow() {
  runtimeState.active = false;
  runtimeState.tabId = null;
  runtimeState.startedAt = 0;
  runtimeState.bootstrapToken = '';
  runtimeState.serverUrl = '';
  runtimeState.bridgeSessionId = '';
  runtimeState.ownerRef = '';
  runtimeState.pausedAt = 0;
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }
}

function clearTimeoutTimer() {
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }
}

async function openLoginTab() {
  const tab = await chrome.tabs.create({
    url: buildRemoteLoginUrl(),
    active: true,
  });
  runtimeState.tabId = tab.id;
  runtimeState.status = 'waiting_token';
  runtimeState.lastError = '';
  runtimeState.pausedAt = 0;
  await reportFlowPhase('login_opened');
  await reportFlowPhase('waiting_token');
  notifyStateUpdate();
  clearTimeoutTimer();
  timeoutTimer = setTimeout(() => {
    if (!runtimeState.active) return;
    clearFlow();
    setStatus('timeout', '等待登录超时，请重试');
  }, FLOW_TIMEOUT_MS);
}

function isSameFlow(config = {}) {
  return runtimeState.active
    && String(runtimeState.serverUrl || '').trim() === String(config.serverUrl || '').trim()
    && String(runtimeState.bootstrapToken || '').trim() === String(config.bootstrapToken || '').trim()
    && String(runtimeState.bridgeSessionId || '').trim() === String(config.bridgeSessionId || '').trim();
}

async function completeFlowWithToken(token) {
  if (!runtimeState.active) return;
  const endpoint = `${runtimeState.serverUrl}/steam-bridge/complete`;
  const payload = {
    bootstrapToken: runtimeState.bootstrapToken,
    rustplusAuthToken: token,
    autoStartPairing: true,
  };

  await reportFlowPhase('token_received');
  setStatus('uploading');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success !== true) {
    const message = String(data?.error || `${response.status} ${response.statusText}`);
    throw new Error(message);
  }

  runtimeState.lastSteamId = decodeSteamId(token) || runtimeState.lastSteamId;
  runtimeState.lastResponseAt = Date.now();
  setStatus('completed');

  if (runtimeState.tabId != null) {
    chrome.tabs.remove(runtimeState.tabId).catch(() => {});
  }
  clearFlow();
  notifyStateUpdate();
}

async function reportFlowPhase(phase, message = '') {
  if (!runtimeState.serverUrl || !runtimeState.bootstrapToken) return;
  const endpoint = `${runtimeState.serverUrl}/steam-bridge/state`;
  await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      bootstrapToken: runtimeState.bootstrapToken,
      phase,
      message,
    }),
  }).catch(() => null);
}

async function startFlow(config = {}) {
  const serverUrl = normalizeServerUrl(config.serverUrl);
  const bootstrapToken = String(config.bootstrapToken || config.sessionCode || '').trim();
  const bridgeSessionId = String(config.bridgeSessionId || '').trim();
  const ownerRef = String(config.ownerRef || '').trim();
  const forceResume = config.forceResume === true;
  if (!bootstrapToken) throw new Error('登录任务令牌不能为空');

  const nextConfig = { serverUrl, bootstrapToken, bridgeSessionId };
  if (isSameFlow(nextConfig)) {
    if (runtimeState.tabId != null && ['opening', 'waiting_token', 'uploading'].includes(String(runtimeState.status || ''))) {
      try {
        await chrome.tabs.update(runtimeState.tabId, { active: true });
      } catch (_) {}
      return toPublicState();
    }
    if (String(runtimeState.status || '') === 'paused') {
      if (!forceResume) return toPublicState();
      runtimeState.status = 'opening';
      runtimeState.lastError = '';
      notifyStateUpdate();
      await openLoginTab();
      return toPublicState();
    }
    if (['completed', 'failed', 'timeout', 'stopped'].includes(String(runtimeState.status || '')) && forceResume) {
      clearFlow();
    } else if (String(runtimeState.status || '') !== 'idle') {
      return toPublicState();
    }
  }

  if (runtimeState.active && runtimeState.tabId != null) {
    chrome.tabs.remove(runtimeState.tabId).catch(() => {});
  }

  clearFlow();
  runtimeState.active = true;
  runtimeState.startedAt = Date.now();
  runtimeState.serverUrl = serverUrl;
  runtimeState.bootstrapToken = bootstrapToken;
  runtimeState.bridgeSessionId = bridgeSessionId;
  runtimeState.ownerRef = ownerRef;
  runtimeState.status = 'opening';
  runtimeState.lastError = '';
  notifyStateUpdate();

  await chrome.storage.local.set({
    rustplusBridgeConfig: {
      serverUrl,
      bootstrapToken,
      bridgeSessionId,
      ownerRef,
    },
  });
  await reportFlowPhase('plugin_connected');
  await openLoginTab();
  return toPublicState();
}

function stopFlow() {
  if (runtimeState.tabId != null) {
    chrome.tabs.remove(runtimeState.tabId).catch(() => {});
  }
  clearFlow();
  setStatus('stopped');
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (runtimeState.tabId == null) return;
  if (tabId !== runtimeState.tabId) return;
  if (!runtimeState.active) return;
  runtimeState.tabId = null;
  runtimeState.status = 'paused';
  runtimeState.lastError = '登录页面已关闭，等待你手动继续';
  runtimeState.pausedAt = Date.now();
  clearTimeoutTimer();
  notifyStateUpdate();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!runtimeState.active || runtimeState.tabId == null) return;
  if (tabId !== runtimeState.tabId) return;
  const currentUrl = String(changeInfo.url || tab?.url || '').trim();
  if (!currentUrl || !runtimeState.serverUrl) return;
  const callbackPrefix = `${runtimeState.serverUrl.replace(/\/+$/, '')}/steam-bridge/callback`;
  if (!currentUrl.startsWith(callbackPrefix)) return;
  runtimeState.lastResponseAt = Date.now();
  setStatus('uploading');
  chrome.tabs.remove(tabId).catch(() => {});
  clearFlow();
  notifyStateUpdate();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const type = String(msg?.type || '');

  if (type === 'bridge:start') {
    startFlow(msg?.payload || {})
      .then(() => sendResponse({ success: true, state: toPublicState() }))
      .catch((err) => {
        setStatus('failed', String(err?.message || err || '启动失败'));
        clearFlow();
        sendResponse({ success: false, error: String(err?.message || err || '启动失败'), state: toPublicState() });
      });
    return true;
  }

  if (type === 'bridge:stop') {
    stopFlow();
    sendResponse({ success: true, state: toPublicState() });
    return true;
  }

  if (type === 'bridge:resume') {
    startFlow({ ...(msg?.payload || {}), forceResume: true })
      .then(() => sendResponse({ success: true, state: toPublicState() }))
      .catch((err) => {
        sendResponse({ success: false, error: String(err?.message || err || '继续失败'), state: toPublicState() });
      });
    return true;
  }

  if (type === 'bridge:getState') {
    applyBundledDefaults({ autoStart: false })
      .then(() => sendResponse({ success: true, state: toPublicState() }))
      .catch(() => sendResponse({ success: true, state: toPublicState() }));
    return true;
  }

  if (type === 'bridge:captured-token') {
    const token = parseRustplusToken(msg?.payload);
    if (!runtimeState.active || !token) {
      sendResponse({ success: false, ignored: true });
      return true;
    }
    completeFlowWithToken(token)
      .then(() => sendResponse({ success: true, state: toPublicState() }))
      .catch((err) => {
        const message = String(err?.message || err || '回传失败');
        setStatus('failed', message);
        clearFlow();
        sendResponse({ success: false, error: message, state: toPublicState() });
      });
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  applyBundledDefaults({ autoStart: true, force: true })
    .catch(() => null)
    .finally(() => {
      notifyStateUpdate();
    });
});

chrome.runtime.onStartup.addListener(() => {
  applyBundledDefaults({ autoStart: false }).catch(() => null);
});
