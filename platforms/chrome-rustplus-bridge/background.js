const FLOW_TIMEOUT_MS = 8 * 60 * 1000;

const runtimeState = {
  active: false,
  startedAt: 0,
  serverUrl: '',
  sessionCode: '',
  tabId: null,
  status: 'idle',
  lastError: '',
  lastSteamId: '',
  lastResponseAt: 0,
};

let timeoutTimer = null;

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

function toPublicState() {
  return {
    active: runtimeState.active,
    startedAt: runtimeState.startedAt,
    serverUrl: runtimeState.serverUrl,
    sessionCode: runtimeState.sessionCode,
    tabId: runtimeState.tabId,
    status: runtimeState.status,
    lastError: runtimeState.lastError,
    lastSteamId: runtimeState.lastSteamId,
    lastResponseAt: runtimeState.lastResponseAt,
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
  runtimeState.sessionCode = '';
  runtimeState.serverUrl = '';
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
    timeoutTimer = null;
  }
}

async function completeFlowWithToken(token) {
  if (!runtimeState.active) return;
  const endpoint = `${runtimeState.serverUrl}/steam-bridge/complete`;
  const payload = {
    sessionCode: runtimeState.sessionCode,
    rustplusAuthToken: token,
    autoStartPairing: true,
  };

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

async function startFlow(config = {}) {
  const serverUrl = normalizeServerUrl(config.serverUrl);
  const sessionCode = String(config.sessionCode || '').trim();
  if (!sessionCode) throw new Error('会话码不能为空');

  if (runtimeState.active && runtimeState.tabId != null) {
    chrome.tabs.remove(runtimeState.tabId).catch(() => {});
  }

  clearFlow();
  runtimeState.active = true;
  runtimeState.startedAt = Date.now();
  runtimeState.serverUrl = serverUrl;
  runtimeState.sessionCode = sessionCode;
  runtimeState.status = 'opening';
  runtimeState.lastError = '';
  notifyStateUpdate();

  await chrome.storage.local.set({
    rustplusBridgeConfig: {
      serverUrl,
      sessionCode,
    },
  });

  const tab = await chrome.tabs.create({
    url: 'https://companion-rust.facepunch.com/login',
    active: true,
  });
  runtimeState.tabId = tab.id;
  setStatus('waiting_token');

  timeoutTimer = setTimeout(() => {
    if (!runtimeState.active) return;
    clearFlow();
    setStatus('timeout', '等待登录超时，请重试');
  }, FLOW_TIMEOUT_MS);
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
  clearFlow();
  setStatus('stopped', '登录页面已关闭');
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

  if (type === 'bridge:getState') {
    sendResponse({ success: true, state: toPublicState() });
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
  notifyStateUpdate();
});
