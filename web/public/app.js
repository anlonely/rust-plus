const state = {
  servers: [],
  connected: false,
  currentServerId: '',
  currentServer: null,
  serverInfo: null,
  teamMembers: [],
  teamMessages: [],
  steam: null,
  events: [],
  eventRules: [],
  commandRules: [],
  callGroups: [],
  ws: null,
  apiToken: localStorage.getItem('rustPlusWebApiToken') || '',
  activePage: 'dashboard',
};

const dom = {
  apiToken: document.getElementById('api-token'),
  saveToken: document.getElementById('save-token'),
  serverList: document.getElementById('server-list'),
  connDot: document.getElementById('conn-dot'),
  connText: document.getElementById('conn-text'),
  titleServer: document.getElementById('title-server'),
  currentServerName: document.getElementById('current-server-name'),
  currentServerMeta: document.getElementById('current-server-meta'),
  connectBtn: document.getElementById('connect-btn'),
  disconnectBtn: document.getElementById('disconnect-btn'),
  syncBtn: document.getElementById('sync-btn'),
  statPlayers: document.getElementById('stat-players'),
  statQueue: document.getElementById('stat-queue'),
  statMap: document.getElementById('stat-map'),
  statTime: document.getElementById('stat-time'),
  statPhase: document.getElementById('stat-phase'),
  statRemain: document.getElementById('stat-remain'),
  teamCount: document.getElementById('team-count'),
  teamCountFull: document.getElementById('team-count-full'),
  teamMembers: document.getElementById('team-members'),
  teamMembersMini: document.getElementById('team-members-mini'),
  chatMessages: document.getElementById('chat-messages'),
  chatInput: document.getElementById('chat-input'),
  sendChat: document.getElementById('send-chat'),
  steamBlock: document.getElementById('steam-block'),
  eventFeed: document.getElementById('event-feed'),
  eventFeedMini: document.getElementById('event-feed-mini'),
  refreshServers: document.getElementById('refresh-servers'),
  refreshChat: document.getElementById('refresh-chat'),
  refreshSteam: document.getElementById('refresh-steam'),
  refreshTeamMembers: document.getElementById('refresh-team-members'),
  clearEvents: document.getElementById('clear-events'),
  clearEventsMini: document.getElementById('clear-events-mini'),

  refreshEvents: document.getElementById('refresh-events'),
  eventRuleName: document.getElementById('event-rule-name'),
  eventRuleEvent: document.getElementById('event-rule-event'),
  saveEventRule: document.getElementById('save-event-rule'),
  eventRulesList: document.getElementById('event-rules-list'),

  refreshCommands: document.getElementById('refresh-commands'),
  commandRuleKeyword: document.getElementById('command-rule-keyword'),
  commandRuleType: document.getElementById('command-rule-type'),
  saveCommandRule: document.getElementById('save-command-rule'),
  commandRulesList: document.getElementById('command-rules-list'),

  refreshCallgroups: document.getElementById('refresh-callgroups'),
  callgroupName: document.getElementById('callgroup-name'),
  callgroupCooldown: document.getElementById('callgroup-cooldown'),
  callgroupMembers: document.getElementById('callgroup-members'),
  saveCallgroup: document.getElementById('save-callgroup'),
  callgroupsList: document.getElementById('callgroups-list'),

  navItems: Array.from(document.querySelectorAll('.nav-item[data-page]')),
  pages: Array.from(document.querySelectorAll('.page')),
  navTargets: Array.from(document.querySelectorAll('[data-nav-target]')),
};

function withHeaders(base = {}) {
  const headers = { ...base };
  if (state.apiToken) headers['x-api-token'] = state.apiToken;
  return headers;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: withHeaders({
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `请求失败: ${res.status}`);
  return json;
}

function esc(text = '') {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setHtml(el, html) {
  if (!el) return;
  el.innerHTML = html;
}

function fmtCoord(member = {}) {
  const x = Number(member.x);
  const y = Number(member.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '坐标 -';
  return `${x.toFixed(0)}, ${y.toFixed(0)}`;
}

function normalizeDateTime(ts) {
  const dt = new Date(ts || Date.now());
  if (Number.isNaN(dt.getTime())) return new Date().toLocaleTimeString('zh-CN');
  return dt.toLocaleTimeString('zh-CN');
}

function addEvent(title, message = '') {
  state.events.unshift({
    ts: Date.now(),
    title,
    message: String(message || ''),
  });
  if (state.events.length > 150) state.events.pop();
  renderEvents();
}

function currentSelectedServerId() {
  return String(state.currentServerId || '').trim();
}

function requireSelectedServerId(actionName = '该操作') {
  const serverId = currentSelectedServerId();
  if (!serverId) {
    addEvent(actionName, '请先在设备配对页选择服务器');
    return '';
  }
  return serverId;
}

function navigate(pageId) {
  const target = String(pageId || 'dashboard').trim();
  state.activePage = target;
  dom.navItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.page === target);
  });
  dom.pages.forEach((page) => {
    page.classList.toggle('active', page.id === `page-${target}`);
  });

  if (target === 'events') refreshEventRules().catch((err) => addEvent('事件规则刷新失败', err.message));
  if (target === 'commands') refreshCommandRules().catch((err) => addEvent('指令规则刷新失败', err.message));
  if (target === 'callgroups') refreshCallGroups().catch((err) => addEvent('呼叫组刷新失败', err.message));
}

function renderServers() {
  if (!dom.serverList) return;
  if (!state.servers.length) {
    setHtml(dom.serverList, '<div class="muted">暂无已配对服务器，请先在桌面版完成 Pair。</div>');
    return;
  }

  const html = state.servers.map((server) => {
    const id = String(server.id || '');
    const active = id === String(state.currentServerId || '');
    const name = server.name || `${server.ip}:${server.port}`;
    return `
      <button class="server-item ${active ? 'active' : ''}" data-server-id="${esc(id)}" type="button">
        <strong>${esc(name)}</strong>
        <small>${esc(server.ip)}:${esc(server.port)} · ${esc(server.playerId || '-')}</small>
      </button>
    `;
  }).join('');

  setHtml(dom.serverList, html);
}

function renderStatus() {
  if (dom.connDot) dom.connDot.classList.toggle('online', !!state.connected);
  if (dom.connText) dom.connText.textContent = state.connected ? '已连接' : '未连接';

  const serverName = state.currentServer?.name || '未选择服务器';
  if (dom.currentServerName) dom.currentServerName.textContent = serverName;
  if (dom.titleServer) dom.titleServer.textContent = serverName;

  const snapshot = state.serverInfo || {};
  const phaseTarget = snapshot.phaseTargetShort || snapshot.phaseTarget || '-';
  const metaText = state.connected
    ? `${snapshot.name || serverName} · ${snapshot.hhmm || '--:--'} · 下阶段 ${phaseTarget}`
    : '等待连接';
  if (dom.currentServerMeta) dom.currentServerMeta.textContent = metaText;

  if (dom.statPlayers) dom.statPlayers.textContent = `${Number(snapshot.players || 0)} / ${Number(snapshot.maxPlayers || 0)}`;
  if (dom.statQueue) dom.statQueue.textContent = String(Number(snapshot.queued || 0));
  if (dom.statMap) dom.statMap.textContent = snapshot.mapSize ? String(snapshot.mapSize) : '-';
  if (dom.statTime) dom.statTime.textContent = snapshot.hhmm || '00:00';
  if (dom.statPhase) dom.statPhase.textContent = snapshot.phase || '-';
  if (dom.statRemain) dom.statRemain.textContent = snapshot.realRemainText || snapshot.remainText || '-';
}

function renderTeamMembers() {
  const members = Array.isArray(state.teamMembers) ? state.teamMembers : [];
  const count = members.length;
  if (dom.teamCount) dom.teamCount.textContent = String(count);
  if (dom.teamCountFull) dom.teamCountFull.textContent = String(count);

  if (!members.length) {
    setHtml(dom.teamMembers, '<div class="muted">暂无队伍成员数据</div>');
    setHtml(dom.teamMembersMini, '<div class="muted">暂无队伍成员数据</div>');
    return;
  }

  const rows = members.map((member) => `
    <div class="team-row">
      <div>
        <div class="name">${esc(member.name || 'Unknown')}</div>
        <div class="meta">${esc(fmtCoord(member))}</div>
      </div>
      <span class="pill ${member.isOnline ? 'ok' : 'off'}">${member.isOnline ? '在线' : '离线'}</span>
    </div>
  `).join('');

  setHtml(dom.teamMembers, rows);
  setHtml(dom.teamMembersMini, rows);
}

function renderMessages() {
  if (!dom.chatMessages) return;
  if (!state.teamMessages.length) {
    setHtml(dom.chatMessages, '<div class="muted">暂无聊天记录</div>');
    return;
  }

  const html = state.teamMessages.map((item) => `
    <div class="chat-row">
      <strong>${esc(item.name || 'Unknown')} · ${esc(normalizeDateTime(item.ts))}</strong>
      <p>${esc(item.message || '')}</p>
    </div>
  `).join('');

  setHtml(dom.chatMessages, html);
}

function sanitizeHttpUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return esc(url.toString());
  } catch (_) {
    return '';
  }
}

function renderSteam() {
  if (!dom.steamBlock) return;
  const steam = state.steam;
  if (!steam?.hasLogin) {
    setHtml(dom.steamBlock, '<div class="muted">未检测到 Steam 登录状态，请先在桌面版完成 Steam 登录。</div>');
    return;
  }

  const profile = steam.steamProfile || {};
  const steamId = String(steam.tokenMeta?.steamId || '');
  const steamName = profile.steamName || (steamId ? `Steam ${steamId.slice(-6)}` : 'Steam 已登录');
  const stateLine = profile.stateMessage || profile.onlineState || '已登录';
  const avatarUrl = sanitizeHttpUrl(profile.avatarFull || profile.avatarMedium || steam.avatarUrl || '');

  const html = `
    <div class="steam-user">
      <div class="steam-avatar">${avatarUrl ? `<img src="${avatarUrl}" alt="avatar">` : '<span>ST</span>'}</div>
      <div>
        <div class="steam-name">${esc(steamName)}</div>
        <div class="steam-state">${esc(stateLine)}</div>
      </div>
    </div>
    <div class="steam-meta">
      <div>SteamID: ${esc(steamId || '-')}</div>
      <div>Token: ${steam.tokenMeta?.isExpired ? '已过期' : '有效'}</div>
      ${steam.steamProfileError ? `<div>资料获取: ${esc(steam.steamProfileError)}</div>` : ''}
    </div>
  `;

  setHtml(dom.steamBlock, html);
}

function renderEventRows(items = []) {
  if (!items.length) return '<div class="muted">暂无运行事件</div>';
  return items.map((item) => `
    <div class="event-row">
      <strong>${esc(normalizeDateTime(item.ts))} · ${esc(item.title || '事件')}</strong>
      <p>${esc(item.message || '')}</p>
    </div>
  `).join('');
}

function renderEvents() {
  const html = renderEventRows(state.events);
  setHtml(dom.eventFeed, html);
  setHtml(dom.eventFeedMini, html);
}

function renderEventRules() {
  if (!dom.eventRulesList) return;
  if (!state.eventRules.length) {
    setHtml(dom.eventRulesList, '<div class="muted">暂无事件规则</div>');
    return;
  }
  const html = state.eventRules.map((rule) => `
    <div class="rule-row">
      <div class="rule-main">
        <strong>${esc(rule.name || '未命名规则')}</strong>
        <small>${esc(rule.event || '-')} · ${rule.enabled === false ? '已禁用' : '已启用'}</small>
      </div>
      <div class="rule-actions">
        <button class="ghost-btn" data-event-action="toggle" data-rule-id="${esc(rule.id)}" data-next-enabled="${rule.enabled === false ? '1' : '0'}" type="button">
          ${rule.enabled === false ? '启用' : '禁用'}
        </button>
        <button class="ghost-btn danger-btn" data-event-action="delete" data-rule-id="${esc(rule.id)}" type="button">删除</button>
      </div>
    </div>
  `).join('');
  setHtml(dom.eventRulesList, html);
}

function renderCommandRules() {
  if (!dom.commandRulesList) return;
  if (!state.commandRules.length) {
    setHtml(dom.commandRulesList, '<div class="muted">暂无指令规则</div>');
    return;
  }
  const html = state.commandRules.map((rule) => `
    <div class="rule-row">
      <div class="rule-main">
        <strong>${esc(rule.keyword || rule.id || '-')}</strong>
        <small>${esc(rule.type || '-')} · ${rule.enabled === false ? '已禁用' : '已启用'}</small>
      </div>
      <div class="rule-actions">
        <button class="ghost-btn" data-command-action="toggle" data-rule-id="${esc(rule.id)}" data-next-enabled="${rule.enabled === false ? '1' : '0'}" type="button">
          ${rule.enabled === false ? '启用' : '禁用'}
        </button>
        <button class="ghost-btn danger-btn" data-command-action="delete" data-rule-id="${esc(rule.id)}" type="button">删除</button>
      </div>
    </div>
  `).join('');
  setHtml(dom.commandRulesList, html);
}

function renderCallGroups() {
  if (!dom.callgroupsList) return;
  if (!state.callGroups.length) {
    setHtml(dom.callgroupsList, '<div class="muted">暂无呼叫组</div>');
    return;
  }
  const html = state.callGroups.map((group) => {
    const members = Array.isArray(group.members) ? group.members : [];
    const preview = members.slice(0, 2).map((m) => `${m.name || m.phone}(${m.phone})`).join(' · ');
    return `
      <div class="rule-row">
        <div class="rule-main">
          <strong>${esc(group.name || group.id || '未命名')}</strong>
          <small>成员 ${members.length} 人 · 冷却 ${Math.max(1, Math.round(Number(group.cooldownMs || 300000) / 1000))} 秒${preview ? ` · ${esc(preview)}` : ''}</small>
        </div>
        <div class="rule-actions">
          <button class="ghost-btn danger-btn" data-callgroup-action="delete" data-group-id="${esc(group.id)}" type="button">删除</button>
        </div>
      </div>
    `;
  }).join('');
  setHtml(dom.callgroupsList, html);
}

function applyBootstrap(payload = {}) {
  state.connected = !!payload.connected;
  state.currentServer = payload.currentServer || null;
  state.currentServerId = String(payload.currentServerId || payload.currentServer?.id || '');
  state.serverInfo = payload.serverInfo || null;
  state.teamMembers = Array.isArray(payload.teamMembers) ? payload.teamMembers : [];
  state.teamMessages = Array.isArray(payload.teamMessages) ? payload.teamMessages : [];
  state.servers = Array.isArray(payload.servers) ? payload.servers : state.servers;
  state.steam = payload.steam || state.steam;
  renderServers();
  renderStatus();
  renderTeamMembers();
  renderMessages();
  renderSteam();
}

function bindServerListClick() {
  if (!dom.serverList) return;
  dom.serverList.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-server-id]');
    if (!btn) return;
    state.currentServerId = String(btn.dataset.serverId || '');
    renderServers();
    addEvent('服务器已选中', state.currentServerId);
    if (state.activePage === 'events') refreshEventRules().catch(() => {});
    if (state.activePage === 'commands') refreshCommandRules().catch(() => {});
  });
}

function bindRuleListActions() {
  dom.eventRulesList?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-event-action]');
    if (!btn) return;
    const action = String(btn.dataset.eventAction || '');
    const ruleId = String(btn.dataset.ruleId || '');
    const serverId = requireSelectedServerId('事件规则操作');
    if (!serverId || !ruleId) return;

    if (action === 'toggle') {
      const nextEnabled = btn.dataset.nextEnabled === '1';
      await api(`/api/rules/events/${encodeURIComponent(ruleId)}/enabled`, {
        method: 'POST',
        body: JSON.stringify({ serverId, enabled: nextEnabled }),
      });
      addEvent('事件规则更新', `${ruleId} -> ${nextEnabled ? '启用' : '禁用'}`);
      await refreshEventRules();
      return;
    }

    if (action === 'delete') {
      if (!confirm(`确认删除事件规则 ${ruleId} ?`)) return;
      await api(`/api/rules/events/${encodeURIComponent(ruleId)}?serverId=${encodeURIComponent(serverId)}`, { method: 'DELETE' });
      addEvent('事件规则删除', ruleId);
      await refreshEventRules();
    }
  });

  dom.commandRulesList?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-command-action]');
    if (!btn) return;
    const action = String(btn.dataset.commandAction || '');
    const ruleId = String(btn.dataset.ruleId || '');
    const serverId = requireSelectedServerId('指令规则操作');
    if (!serverId || !ruleId) return;

    if (action === 'toggle') {
      const nextEnabled = btn.dataset.nextEnabled === '1';
      await api(`/api/rules/commands/${encodeURIComponent(ruleId)}/enabled`, {
        method: 'POST',
        body: JSON.stringify({ serverId, enabled: nextEnabled }),
      });
      addEvent('指令规则更新', `${ruleId} -> ${nextEnabled ? '启用' : '禁用'}`);
      await refreshCommandRules();
      return;
    }

    if (action === 'delete') {
      if (!confirm(`确认删除指令规则 ${ruleId} ?`)) return;
      await api(`/api/rules/commands/${encodeURIComponent(ruleId)}?serverId=${encodeURIComponent(serverId)}`, { method: 'DELETE' });
      addEvent('指令规则删除', ruleId);
      await refreshCommandRules();
    }
  });

  dom.callgroupsList?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-callgroup-action]');
    if (!btn) return;
    const action = String(btn.dataset.callgroupAction || '');
    const groupId = String(btn.dataset.groupId || '');
    if (action !== 'delete' || !groupId) return;
    if (!confirm(`确认删除呼叫组 ${groupId} ?`)) return;
    await api(`/api/callgroups/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
    addEvent('呼叫组删除', groupId);
    await refreshCallGroups();
  });
}

function handleWsMessage(message = {}) {
  const type = String(message.type || '');
  const payload = message.payload || {};

  if (type === 'bootstrap') {
    applyBootstrap(payload);
    return;
  }
  if (type === 'server:status') {
    state.connected = !!payload.connected;
    state.currentServer = payload.currentServer || state.currentServer;
    state.currentServerId = String(payload.currentServerId || state.currentServerId || '');
    renderStatus();
    addEvent('连接状态变化', state.connected ? '服务器已连接' : '服务器已断开');
    return;
  }
  if (type === 'server:info') {
    state.serverInfo = payload;
    renderStatus();
    return;
  }
  if (type === 'team:members') {
    state.teamMembers = Array.isArray(payload) ? payload : [];
    renderTeamMembers();
    return;
  }
  if (type === 'team:message') {
    if (payload && typeof payload === 'object') {
      state.teamMessages.unshift(payload);
      if (state.teamMessages.length > 120) state.teamMessages.pop();
      renderMessages();
    }
    return;
  }
  if (type === 'runtime:error') {
    addEvent('运行异常', payload.message || '未知错误');
  }
}

function connectWs() {
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsProtocols = ['rust-plus-web'];
  if (state.apiToken) {
    const utf8 = new TextEncoder().encode(state.apiToken);
    let binary = '';
    for (let i = 0; i < utf8.length; i += 1) binary += String.fromCharCode(utf8[i]);
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    wsProtocols.push(`auth.${encoded}`);
  }

  const ws = new WebSocket(`${protocol}://${location.host}/ws`, wsProtocols);
  state.ws = ws;

  ws.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      handleWsMessage(parsed);
    } catch (_) {}
  };
  ws.onopen = () => addEvent('实时通道', 'WebSocket 已连接');
  ws.onclose = () => {
    addEvent('实时通道', 'WebSocket 已断开，3秒后重连');
    state.ws = null;
    setTimeout(connectWs, 3000);
  };
}

async function refreshBootstrap() {
  const payload = await api('/api/bootstrap');
  applyBootstrap(payload);
}

async function refreshServerInfo() {
  const res = await api('/api/server/info');
  state.serverInfo = res.info || null;
  renderStatus();
}

async function refreshTeam() {
  const res = await api('/api/team/members');
  state.teamMembers = Array.isArray(res.members) ? res.members : [];
  renderTeamMembers();
}

async function refreshMessages() {
  const res = await api('/api/team/messages');
  state.teamMessages = Array.isArray(res.messages) ? res.messages : [];
  renderMessages();
}

async function refreshSteam() {
  state.steam = await api('/api/steam/status');
  renderSteam();
}

async function refreshEventRules() {
  const serverId = requireSelectedServerId('事件规则刷新');
  if (!serverId) {
    state.eventRules = [];
    renderEventRules();
    return;
  }
  const res = await api(`/api/rules/events?serverId=${encodeURIComponent(serverId)}`);
  state.eventRules = Array.isArray(res.rules) ? res.rules : [];
  renderEventRules();
}

async function refreshCommandRules() {
  const serverId = requireSelectedServerId('指令规则刷新');
  if (!serverId) {
    state.commandRules = [];
    renderCommandRules();
    return;
  }
  const res = await api(`/api/rules/commands?serverId=${encodeURIComponent(serverId)}`);
  state.commandRules = Array.isArray(res.rules) ? res.rules : [];
  renderCommandRules();
}

async function refreshCallGroups() {
  const res = await api('/api/callgroups');
  state.callGroups = Array.isArray(res.groups) ? res.groups : [];
  renderCallGroups();
}

async function connectServer() {
  const serverId = currentSelectedServerId();
  if (!serverId) {
    addEvent('连接失败', '请先在设备配对页选择服务器');
    return;
  }

  await api('/api/servers/connect', {
    method: 'POST',
    body: JSON.stringify({ serverId }),
  });

  addEvent('连接请求', `尝试连接 ${serverId}`);
  await Promise.all([refreshServerInfo(), refreshTeam(), refreshMessages()]);
}

async function disconnectServer() {
  await api('/api/servers/disconnect', { method: 'POST' });
  state.connected = false;
  renderStatus();
  addEvent('连接请求', '已断开服务器连接');
}

async function sendTeamChat() {
  const message = String(dom.chatInput?.value || '').trim();
  if (!message) return;

  await api('/api/team/messages', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });

  if (dom.chatInput) dom.chatInput.value = '';
}

async function saveEventRuleFromForm() {
  const serverId = requireSelectedServerId('保存事件规则');
  if (!serverId) return;
  const name = String(dom.eventRuleName?.value || '').trim();
  const eventName = String(dom.eventRuleEvent?.value || '').trim();
  if (!name) {
    addEvent('保存事件规则失败', '规则名称不能为空');
    return;
  }
  await api('/api/rules/events', {
    method: 'POST',
    body: JSON.stringify({
      serverId,
      name,
      event: eventName || 'alarm_on',
      enabled: true,
      trigger: {},
      _meta: {},
    }),
  });
  if (dom.eventRuleName) dom.eventRuleName.value = '';
  addEvent('事件规则保存', `${name} (${eventName})`);
  await refreshEventRules();
}

async function saveCommandRuleFromForm() {
  const serverId = requireSelectedServerId('保存指令规则');
  if (!serverId) return;
  const keyword = String(dom.commandRuleKeyword?.value || '').trim().toLowerCase();
  const type = String(dom.commandRuleType?.value || '').trim();
  if (!keyword) {
    addEvent('保存指令规则失败', '关键词不能为空');
    return;
  }
  await api('/api/rules/commands', {
    method: 'POST',
    body: JSON.stringify({
      serverId,
      keyword,
      id: keyword,
      type: type || null,
      enabled: true,
      permission: 'all',
      meta: {},
    }),
  });
  if (dom.commandRuleKeyword) dom.commandRuleKeyword.value = '';
  addEvent('指令规则保存', `${keyword} (${type || '-'})`);
  await refreshCommandRules();
}

function parseCallGroupMembers(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [left, right] = line.split(':');
      if (right == null) return { name: '', phone: left.trim() };
      return { name: left.trim(), phone: right.trim() };
    })
    .filter((member) => member.phone);
}

async function saveCallGroupFromForm() {
  const name = String(dom.callgroupName?.value || '').trim();
  if (!name) {
    addEvent('保存呼叫组失败', '呼叫组名称不能为空');
    return;
  }
  const cooldownSec = Number(dom.callgroupCooldown?.value || 300);
  const cooldownMs = Number.isFinite(cooldownSec) && cooldownSec > 0 ? Math.round(cooldownSec * 1000) : 300000;
  const members = parseCallGroupMembers(dom.callgroupMembers?.value || '');

  await api('/api/callgroups', {
    method: 'POST',
    body: JSON.stringify({
      name,
      cooldownMs,
      members,
    }),
  });

  if (dom.callgroupName) dom.callgroupName.value = '';
  if (dom.callgroupCooldown) dom.callgroupCooldown.value = '';
  if (dom.callgroupMembers) dom.callgroupMembers.value = '';
  addEvent('呼叫组保存', `${name} (${members.length}人)`);
  await refreshCallGroups();
}

function bindNavigation() {
  dom.navItems.forEach((item) => {
    item.addEventListener('click', () => {
      navigate(item.dataset.page);
    });
  });

  dom.navTargets.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = String(btn.dataset.navTarget || '').trim();
      if (target) navigate(target);
    });
  });
}

function bindActions() {
  if (dom.apiToken) dom.apiToken.value = state.apiToken;

  dom.saveToken?.addEventListener('click', async () => {
    state.apiToken = String(dom.apiToken?.value || '').trim();
    localStorage.setItem('rustPlusWebApiToken', state.apiToken);
    addEvent('配置更新', state.apiToken ? '已保存 API Token' : '已清空 API Token');
    if (state.ws) {
      try { state.ws.close(1000, 'token-updated'); } catch (_) {}
      state.ws = null;
    }
    connectWs();
    await refreshBootstrap().catch((err) => addEvent('初始化失败', err.message));
  });

  dom.connectBtn?.addEventListener('click', () => connectServer().catch((err) => addEvent('连接失败', err.message)));
  dom.disconnectBtn?.addEventListener('click', () => disconnectServer().catch((err) => addEvent('断开失败', err.message)));
  dom.syncBtn?.addEventListener('click', () => Promise.all([refreshServerInfo(), refreshTeam(), refreshMessages(), refreshSteam()]).catch((err) => addEvent('同步失败', err.message)));

  dom.refreshServers?.addEventListener('click', () => refreshBootstrap().catch((err) => addEvent('刷新失败', err.message)));
  dom.refreshChat?.addEventListener('click', () => refreshMessages().catch((err) => addEvent('聊天刷新失败', err.message)));
  dom.refreshSteam?.addEventListener('click', () => refreshSteam().catch((err) => addEvent('Steam 刷新失败', err.message)));
  dom.refreshTeamMembers?.addEventListener('click', () => refreshTeam().catch((err) => addEvent('队伍刷新失败', err.message)));

  dom.refreshEvents?.addEventListener('click', () => refreshEventRules().catch((err) => addEvent('事件规则刷新失败', err.message)));
  dom.refreshCommands?.addEventListener('click', () => refreshCommandRules().catch((err) => addEvent('指令规则刷新失败', err.message)));
  dom.refreshCallgroups?.addEventListener('click', () => refreshCallGroups().catch((err) => addEvent('呼叫组刷新失败', err.message)));
  dom.saveEventRule?.addEventListener('click', () => saveEventRuleFromForm().catch((err) => addEvent('保存事件规则失败', err.message)));
  dom.saveCommandRule?.addEventListener('click', () => saveCommandRuleFromForm().catch((err) => addEvent('保存指令规则失败', err.message)));
  dom.saveCallgroup?.addEventListener('click', () => saveCallGroupFromForm().catch((err) => addEvent('保存呼叫组失败', err.message)));

  const clearEventHandler = () => {
    state.events = [];
    renderEvents();
  };
  dom.clearEvents?.addEventListener('click', clearEventHandler);
  dom.clearEventsMini?.addEventListener('click', clearEventHandler);

  dom.sendChat?.addEventListener('click', () => sendTeamChat().catch((err) => addEvent('发言失败', err.message)));
  dom.chatInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    sendTeamChat().catch((err) => addEvent('发言失败', err.message));
  });

  bindRuleListActions();
}

async function init() {
  bindNavigation();
  bindActions();
  bindServerListClick();
  navigate('dashboard');
  renderEvents();
  renderEventRules();
  renderCommandRules();
  renderCallGroups();

  await refreshBootstrap().catch((err) => addEvent('初始化失败', err.message));
  await Promise.allSettled([
    refreshMessages(),
    refreshSteam(),
    refreshServerInfo(),
    refreshTeam(),
    refreshEventRules(),
    refreshCommandRules(),
    refreshCallGroups(),
  ]);
  connectWs();

  setInterval(() => {
    if (!state.connected) return;
    refreshServerInfo().catch(() => {});
    refreshTeam().catch(() => {});
  }, 18_000);
}

init();
