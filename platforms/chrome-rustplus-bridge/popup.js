function byId(id) {
  return document.getElementById(id);
}

function setState(state = {}) {
  byId('st-status').textContent = state.status || 'idle';
  byId('st-steamid').textContent = state.lastSteamId || '-';
  byId('st-error').textContent = state.lastError || '-';
}

async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function loadConfig() {
  const storage = await chrome.storage.local.get(['rustplusBridgeConfig', 'rustplusBridgeState']);
  const config = storage.rustplusBridgeConfig || {};
  byId('server-url').value = config.serverUrl || 'https://rust.anlonely.me';
  byId('session-code').value = config.sessionCode || '';
  setState(storage.rustplusBridgeState || {});

  const current = await sendMessage({ type: 'bridge:getState' }).catch(() => null);
  if (current?.success) setState(current.state || {});
}

async function start() {
  const payload = {
    serverUrl: byId('server-url').value,
    sessionCode: byId('session-code').value,
  };
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
