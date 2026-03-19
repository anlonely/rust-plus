function byId(id) {
  return document.getElementById(id);
}

function setState(state = {}) {
  byId('st-status').textContent = state.status || 'idle';
  byId('st-steamid').textContent = state.lastSteamId || '-';
  byId('st-error').textContent = state.lastError || '-';
  byId('task-state').textContent = state.bridgeSessionId
    ? `已接管登录任务 ${state.bridgeSessionId}`
    : '由网页自动下发，无需手动输入。';
}

async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function loadConfig() {
  const storage = await chrome.storage.local.get(['rustplusBridgeConfig', 'rustplusBridgeState']);
  const config = storage.rustplusBridgeConfig || {};
  byId('server-url').value = config.serverUrl || 'https://rust.anlonely.me';
  setState(storage.rustplusBridgeState || {});

  const current = await sendMessage({ type: 'bridge:getState' }).catch(() => null);
  if (current?.success) setState(current.state || {});
}

async function start() {
  const payload = {
    serverUrl: byId('server-url').value,
    bootstrapToken: '',
  };
  const storage = await chrome.storage.local.get(['rustplusBridgeConfig']);
  payload.bootstrapToken = storage?.rustplusBridgeConfig?.bootstrapToken || storage?.rustplusBridgeConfig?.sessionCode || '';
  const result = await sendMessage({ type: 'bridge:start', payload }).catch((err) => ({ success: false, error: err.message }));
  if (!result?.success) {
    alert(result?.error || '启动失败');
  }
  setState(result?.state || {});
}

async function stop() {
  const result = await sendMessage({ type: 'bridge:stop' }).catch(() => ({ success: false }));
  setState(result?.state || {});
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'bridge:state') return;
  setState(msg.state || {});
});

byId('start-btn').addEventListener('click', () => { start(); });
byId('stop-btn').addEventListener('click', () => { stop(); });

loadConfig().catch(() => {});
