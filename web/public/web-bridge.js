(function bridgeRustApi(global) {
  const listeners = new Map();
  let ws = null;
  let reconnectTimer = null;

  function getApiToken() {
    try {
      return String(localStorage.getItem('rustPlusWebApiToken') || '').trim();
    } catch (_) {
      return '';
    }
  }

  function withAuthHeaders(base = {}) {
    const headers = { ...base };
    const token = getApiToken();
    if (token) headers['x-api-token'] = token;
    return headers;
  }

  function normalizeSafeUrl(raw) {
    const input = String(raw || '').trim();
    if (!input) return '';
    try {
      const parsed = new URL(input, location.origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      return parsed.href;
    } catch (_) {
      return '';
    }
  }

  async function requestJson(url, options = {}) {
    const opts = { ...options };
    opts.headers = withAuthHeaders(opts.headers || {});
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.reason || `${res.status} ${res.statusText}`);
    }
    return data;
  }

  async function invoke(channel, ...args) {
    const res = await fetch('/api/ipc/invoke', {
      method: 'POST',
      headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ channel, args }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.reason || `invoke failed: ${channel}`);
    }
    return data.result;
  }

  function emit(channel, payload) {
    const set = listeners.get(channel);
    if (!set || !set.size) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch (_) {}
    }
  }

  function mapWsMessage(msg = {}) {
    const type = String(msg.type || '');
    const payload = msg.payload;

    if (type === 'server:status') {
      const server = payload?.server || payload?.currentServer || null;
      const serverId = payload?.serverId || payload?.currentServerId || server?.id || null;
      emit('server:status', {
        connected: !!payload?.connected,
        name: payload?.name || server?.name || '',
        serverId,
        server,
      });
      return;
    }
    if (type === 'team:members') {
      emit('team:changed', { members: Array.isArray(payload) ? payload : (payload?.members || []) });
      return;
    }
    if (type === 'team:changed') {
      emit('team:changed', payload);
      return;
    }
    if (type === 'team:message') {
      emit('team:message', payload);
      return;
    }
    if (type === 'entity:changed') {
      emit('entity:changed', payload);
      return;
    }
    if (type === 'team:sync-status') {
      emit('team:sync-status', payload);
      return;
    }
    if (type === 'pairing:success') {
      emit('pairing:success', payload);
      return;
    }
    if (type === 'pairing:entity-candidate') {
      emit('pairing:entity-candidate', payload);
      return;
    }
    if (type === 'pairing:listener-status') {
      emit('pairing:listener-status', payload);
      return;
    }
    if (type === 'server:info') {
      emit('server:info', payload);
      return;
    }
    if (type === 'rule:auto-toggled') {
      emit('rule:auto-toggled', payload);
      return;
    }
    if (type === 'notification') {
      emit('notification', payload);
      return;
    }
    if (type === 'runtime:error') {
      emit('notification', {
        type: 'error',
        title: '运行异常',
        message: payload?.message || '未知错误',
      });
      return;
    }
  }

  function connectWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const protocols = ['rust-plus-web'];
    const token = getApiToken();
    if (token) {
      const utf8 = new TextEncoder().encode(token);
      let binary = '';
      for (let i = 0; i < utf8.length; i += 1) binary += String.fromCharCode(utf8[i]);
      const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      protocols.push(`auth.${encoded}`);
    }

    ws = new WebSocket(`${protocol}://${location.host}/ws`, protocols);
    ws.onmessage = (event) => {
      try {
        mapWsMessage(JSON.parse(event.data));
      } catch (_) {}
    };
    ws.onclose = () => {
      ws = null;
      reconnectTimer = setTimeout(connectWs, 3000);
    };
    ws.onerror = () => {};
  }

  function on(channel, callback) {
    if (!channel || typeof callback !== 'function') return;
    const set = listeners.get(channel) || new Set();
    set.add(callback);
    listeners.set(channel, set);
    connectWs();
  }

  function off(channel) {
    if (!channel) return;
    listeners.delete(channel);
  }

  global.rustAPI = {
    platform: 'web',
    init: () => invoke('app:init'),

    minimize: () => Promise.resolve(true),
    maximize: () => Promise.resolve(true),
    closeWin: () => Promise.resolve(true),
    quit: () => Promise.resolve(true),

    listServers: () => invoke('server:list'),
    removeServer: (id) => invoke('server:remove', id),
    connectServer: (cfg) => invoke('server:connect', cfg),
    getServerInfo: () => invoke('server:getInfo'),
    getTeamInfo: () => invoke('server:getTeam'),
    getTeamChat: () => invoke('server:getTeamChat'),
    getItemsByIds: (ids) => invoke('catalog:getItemsByIds', ids),
    getServerHealth: () => invoke('server:getHealth'),

    startPairing: (options) => invoke('pairing:start', options || {}),
    stopPairing: () => invoke('pairing:stop'),
    diagnosePairing: () => invoke('pairing:diagnose'),

    listDevices: (serverId) => invoke('device:list', serverId),
    registerDevice: (opts) => invoke('device:register', opts),
    updateDevice: (entityId, updates) => invoke('device:update', { entityId, updates }),
    removeDevice: (entityId) => invoke('device:remove', entityId),
    getEntityInfo: (id) => invoke('device:getInfo', id),
    setSwitch: (id, state) => invoke('device:switch', { entityId: id, state }),

    listRules: () => invoke('rules:list'),
    addRule: (rule) => invoke('rules:add', rule),
    removeRule: (id) => invoke('rules:remove', id),
    toggleRule: (id, enabled) => invoke('rules:toggle', { id, enabled }),

    listCommands: () => invoke('commands:list'),
    toggleCommand: (keyword, enabled) => invoke('commands:toggle', { keyword, enabled }),
    saveCommandRule: (rule) => invoke('commands:saveRule', rule),
    removeCommandRule: (keyword) => invoke('commands:removeRule', keyword),
    listPresets: () => invoke('presets:list'),
    applyPreset: (type, id, replaceExisting) => invoke('presets:apply', { type, id, replaceExisting }),

    listCallGroups: () => invoke('callgroup:list'),
    setCallGroup: (group) => invoke('callgroup:set', group),
    removeCallGroup: (id) => invoke('callgroup:remove', id),
    triggerCall: (groupId, message, channels) => invoke('callgroup:call', { groupId, message, channels }),

    sendChat: (message) => invoke('chat:send', message),

    openUrl: (url) => {
      try {
        const safe = normalizeSafeUrl(url);
        if (!safe) return;
        window.open(safe, '_blank', 'noopener,noreferrer');
      } catch (_) {}
    },
    getSteamStatus: () => invoke('steam:status'),
    steamBeginAuth: () => invoke('steam:beginAuth'),
    steamLogout: () => invoke('steam:logout'),
    getHelpDoc: () => invoke('docs:getHelp'),

    getMapData: () => invoke('map:getData'),
    getMapMarkers: () => invoke('map:getMarkers'),
    searchItems: (query) => invoke('catalog:search', query),

    createRemoteSteamAuthSession: (payload = {}) => requestJson('/api/steam/remote-auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }),
    getRemoteSteamAuthSession: (sessionId) => requestJson(`/api/steam/remote-auth/session/${encodeURIComponent(String(sessionId || ''))}`),
    cancelRemoteSteamAuthSession: (sessionId, payload = {}) => requestJson(`/api/steam/remote-auth/session/${encodeURIComponent(String(sessionId || ''))}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }),
    getAuthSession: () => requestJson('/api/auth/session'),
    updateAuthProfile: (payload = {}) => requestJson('/api/auth/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }),
    updateAuthPassword: (payload = {}) => requestJson('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }),
    acceptAuthGuide: () => requestJson('/api/auth/guide/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
    logoutAuth: () => requestJson('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),

    on,
    off,
  };

  connectWs();
})(window);
