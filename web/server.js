require('dotenv').config();

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const logger = require('../src/utils/logger');
const RustClient = require('../src/connection/client');
const EventEngine = require('../src/events/engine');
const CommandParser = require('../src/commands/parser');
const { consumeRateLimit, RateLimitError } = require('../src/utils/rate-limit');
const { notify } = require('../src/notify/service');
const {
  initDbs,
  saveServer,
  listServers,
  removeServerCascade,
  getLastServerId,
  setLastServerId,
  getServer,
  registerDevice,
  listDevices,
  updateDevice,
  removeDevice,
  listEventRules,
  saveEventRule,
  removeEventRule,
  setEventRuleEnabled,
  listCommandRules,
  saveCommandRule,
  removeCommandRule,
  listCallGroupsDb,
  saveCallGroupDb,
  removeCallGroupDb,
} = require('../src/storage/config');
const { normalizeSteamId64 } = require('../src/utils/steam-id');
const { getSteamProfileStatus, logoutSteam } = require('../src/steam/profile');
const { buildServerInfoSnapshot } = require('../src/utils/server-info');
const { getItemById, matchItems } = require('../src/utils/item-catalog');
const { normalizeServerMapPayload } = require('../src/utils/server-map-payload');
const { enrichMapDataWithRustMaps } = require('../src/utils/rustmaps');
const {
  setGroup,
  listGroups,
  removeGroup,
  callGroup,
  getTeamChatIntervalMs,
  TEAM_CHAT_SETTINGS_GROUP_ID,
} = require('../src/call/groups');
const { listPresets, getEventPreset, getCommandPreset } = require('../src/presets');
const { registerFCM, listenForPairing } = require('../src/pairing/fcm');
const { createIpcInvoker } = require('./ipc-invoke');
const { hydrateRule } = require('./event-actions');
const { applyPersistedCommandRules } = require('./runtime-sync');
const { createTeamChatDispatcher } = require('../src/utils/team-chat-dispatcher');
const {
  normalizeEventRuleInput,
  normalizeCommandRuleInput,
  normalizeCallGroupInput,
} = require('../src/utils/web-config-rules');

const PORT = Number(process.env.WEB_PORT || 3080);
const HOST = process.env.WEB_HOST || '127.0.0.1';
const API_TOKEN = String(process.env.WEB_API_TOKEN || '').trim();
const IS_LOOPBACK_HOST = ['127.0.0.1', 'localhost', '::1'].includes(String(HOST || '').trim().toLowerCase());
const REQUIRE_API_TOKEN = String(process.env.WEB_REQUIRE_API_TOKEN || (IS_LOOPBACK_HOST ? '0' : '1')) !== '0';
const AUTO_CONNECT = String(process.env.WEB_AUTO_CONNECT || '1') !== '0';
const MAX_TEAM_MESSAGES = Math.max(20, Number(process.env.WEB_MAX_TEAM_MESSAGES || 120));
const TEAM_CHAT_MAX_CHARS = Math.max(32, Number(process.env.RUST_TEAM_MESSAGE_MAX_CHARS || 128) || 128);
const TEAM_CHAT_RPM_LIMIT = Math.max(1, Number(process.env.WEB_TEAM_CHAT_RPM || 20) || 20);
const FALLBACK_TEAM_CHAT_INTERVAL_MS = 3_000;
const VERSION = '1.0.0';
const TEAMCHAT_CONNECTED_BROADCAST = '安静的Rust工具已连接 - 输入help查看全部可触发指令';
const LEGACY_PLAYER_STATUS_EVENTS = new Set([
  'player_online',
  'player_offline',
  'player_dead',
  'player_respawn',
  'player_afk',
]);
const DEFAULT_PLAYER_STATUS_MESSAGES = {
  online: '{member}已上线｜上线位置:{member_grid}',
  offline: '{member}已离线｜离线位置:{member_grid}',
  dead: '{member}已死亡｜死亡位置:{member_grid}',
  respawn: '{member}已重生｜当前位置:{member_grid}',
  afk: '{member}挂机已持续15分钟｜当前位置:{member_grid}',
};

function getGlobalTeamChatIntervalMs() {
  return Math.max(1_000, Number(getTeamChatIntervalMs()) || FALLBACK_TEAM_CHAT_INTERVAL_MS);
}

function normalizeEventRuleForServer(rule, serverId) {
  return normalizeEventRuleInput(rule, serverId, { defaultCooldownMs: getGlobalTeamChatIntervalMs() });
}

function normalizeCommandRuleForServer(rule, serverId) {
  return normalizeCommandRuleInput(rule, serverId, { defaultCooldownMs: getGlobalTeamChatIntervalMs() });
}

const app = express();

// 安全响应头：防 XSS / Clickjacking / MIME 嗅探
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!IS_LOOPBACK_HOST) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const runtime = {
  connected: false,
  currentServer: null,
  currentServerId: null,
  lastError: '',
  latestServerSnapshot: buildServerInfoSnapshot(null, null),
  teamMembers: [],
  teamMessages: [],
};

let rustClient = null;
let eventEngine = null;
let cmdParser = null;
let serverInfoTimer = null;
let fcmStopFn = null;
let pairingNoNotificationTimer = null;
const dispatchTeamChat = createTeamChatDispatcher({
  normalizeMessage: normalizeTeamMessageText,
  getIntervalMs: () => getGlobalTeamChatIntervalMs(),
  sendMessage: async (message) => {
    if (!rustClient?.connected) throw new Error('未连接服务器');
    await rustClient.sendTeamMessage(message);
  },
  onSent: (message) => {
    pushTeamMessage({ name: 'Me', message });
  },
});

function isAuthed(req) {
  if (!REQUIRE_API_TOKEN) return true;
  if (!API_TOKEN) return false;
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const headerToken = String(req.headers['x-api-token'] || '').trim();
  return bearer === API_TOKEN || headerToken === API_TOKEN;
}

function ensureAuth(req, res, next) {
  if (isAuthed(req)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function parseWebSocketAuthToken(req) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (bearer) return bearer;
  const headerToken = String(req.headers['x-api-token'] || '').trim();
  if (headerToken) return headerToken;
  const protocolHeader = String(req.headers['sec-websocket-protocol'] || '');
  if (protocolHeader) {
    const tokens = protocolHeader
      .split(',')
      .map((part) => String(part || '').trim())
      .filter(Boolean);
    const authProtocol = tokens.find((token) => token.startsWith('auth.'));
    if (authProtocol) {
      const encoded = authProtocol.slice(5);
      try {
        const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const padLen = (4 - (normalized.length % 4)) % 4;
        const padded = normalized + '='.repeat(padLen);
        const decoded = Buffer.from(padded, 'base64').toString('utf8').trim();
        if (decoded) return decoded;
      } catch (_) {
        // ignore decode failure
      }
    }
  }
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    return String(url.searchParams.get('token') || '').trim();
  } catch (_) {
    return '';
  }
}

function normalizeTeamMessageText(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const chars = Array.from(text);
  if (chars.length <= TEAM_CHAT_MAX_CHARS) return text;
  return `${chars.slice(0, Math.max(1, TEAM_CHAT_MAX_CHARS - 1)).join('')}…`;
}

function sendWs(type, payload = {}) {
  const message = JSON.stringify({ type, payload, at: Date.now() });
  for (const socket of wss.clients) {
    if (socket.readyState === socket.OPEN) socket.send(message);
  }
}

function clearInfoTimer() {
  if (serverInfoTimer) {
    clearInterval(serverInfoTimer);
    serverInfoTimer = null;
  }
}

function extractTeamInfo(res) {
  if (!res || res.error) return null;
  return res.teamInfo || res.info?.teamInfo || res.response?.teamInfo || res.response || res;
}

function extractTeamMembers(res) {
  const team = extractTeamInfo(res);
  if (!team) return [];
  const source = Array.isArray(team.members)
    ? team.members
    : (team.members && typeof team.members === 'object' ? Object.values(team.members) : []);
  return source.map((member) => ({
    steamId: normalizeSteamId64(member?.steamId ?? member?.steamID ?? member?.memberId ?? member?.id ?? ''),
    name: String(member?.name ?? member?.displayName ?? member?.steamName ?? 'Unknown'),
    isOnline: Boolean(member?.isOnline ?? member?.online ?? member?.connected),
    isAlive: Boolean(member?.isAlive ?? (Number(member?.deathTime || 0) <= 0)),
    x: Number(member?.x),
    y: Number(member?.y),
  }));
}

function extractTeamMessagePayload(msg = {}) {
  if (typeof msg === 'string') return { name: 'Unknown', message: msg };
  if (msg?.message && typeof msg.message === 'object') {
    const inner = msg.message;
    return {
      name: String(msg?.name || msg?.displayName || inner?.name || inner?.displayName || 'Unknown'),
      message: String(inner?.message ?? inner?.text ?? inner?.content ?? ''),
    };
  }
  return {
    name: String(msg?.name || msg?.displayName || 'Unknown'),
    message: String(msg?.message ?? msg?.text ?? msg?.content ?? ''),
  };
}

function pushTeamMessage(msg = {}) {
  const payload = extractTeamMessagePayload(msg);
  const record = {
    ts: new Date().toISOString(),
    name: payload.name || 'Unknown',
    message: payload.message || '',
  };
  runtime.teamMessages.unshift(record);
  if (runtime.teamMessages.length > MAX_TEAM_MESSAGES) runtime.teamMessages.pop();
  sendWs('team:message', record);
}

async function refreshServerSnapshot() {
  if (!rustClient?.connected) return runtime.latestServerSnapshot;
  try {
    const [serverRes, timeRes] = await Promise.all([
      rustClient.getServerInfo(),
      rustClient.getTime().catch(() => null),
    ]);
    runtime.latestServerSnapshot = buildServerInfoSnapshot(serverRes, timeRes);
    sendWs('server:info', runtime.latestServerSnapshot);
  } catch (err) {
    runtime.lastError = String(err?.message || err || '刷新服务器状态失败');
    sendWs('runtime:error', { message: runtime.lastError });
  }
  return runtime.latestServerSnapshot;
}

async function refreshTeamMembers() {
  if (!rustClient?.connected) return [];
  try {
    const teamRes = await rustClient.getTeamInfo();
    runtime.teamMembers = extractTeamMembers(teamRes);
    sendWs('team:members', runtime.teamMembers);
  } catch (err) {
    runtime.lastError = String(err?.message || err || '刷新队伍失败');
    sendWs('runtime:error', { message: runtime.lastError });
  }
  return runtime.teamMembers;
}

function bindClientEvents(client, serverConfig) {
  client.on('connected', async () => {
    runtime.connected = true;
    runtime.currentServer = serverConfig;
    runtime.currentServerId = serverConfig.id;
    runtime.lastError = '';
    sendWs('server:status', {
      connected: true,
      currentServer: runtime.currentServer,
      currentServerId: runtime.currentServerId,
    });
    await Promise.all([refreshServerSnapshot(), refreshTeamMembers()]);
    clearInfoTimer();
    serverInfoTimer = setInterval(() => {
      refreshServerSnapshot();
    }, 20_000);
  });

  client.on('disconnected', () => {
    runtime.connected = false;
    runtime.teamMembers = [];
    clearInfoTimer();
    sendWs('server:status', {
      connected: false,
      currentServer: runtime.currentServer,
      currentServerId: runtime.currentServerId,
    });
    sendWs('team:members', runtime.teamMembers);
  });

  client.on('teamChanged', (data) => {
    if (eventEngine?.ingestTeamSnapshot) {
      try {
        eventEngine.ingestTeamSnapshot(data?.teamInfo ? data.teamInfo : data);
      } catch (_) {}
    }
    sendWs('team:changed', data || {});
    refreshTeamMembers();
  });

  client.on('teamMessage', (data) => {
    pushTeamMessage(data);
  });

  client.on('error', (error) => {
    runtime.lastError = String(error?.message || error || '连接异常');
    const lower = runtime.lastError.toLowerCase();
    let message = runtime.lastError;
    if (lower.includes('socket hang up')) {
      message = '连接被服务器主动断开，当前服务器 Rust+ 配对可能已失效，请在游戏内 ESC -> Rust+ -> Pair with Server 重新配对。';
    } else if (lower.includes('econnrefused') || lower.includes('timed out') || lower.includes('timeout')) {
      message = '无法连接到 Rust+ 端口，请确认服务器在线、app.port 可用，或稍后重试。';
    } else if (lower.includes('not_found')) {
      message = '服务器未接受当前请求，当前配对信息可能已失效，请重新配对。';
    }
    sendWs('runtime:error', { message });
    sendWs('notification', {
      type: 'error',
      title: '服务器连接异常',
      message,
    });
  });
}

async function disconnectActiveClient() {
  clearInfoTimer();
  eventEngine?.unbind?.();
  eventEngine = null;
  cmdParser = null;
  if (!rustClient) {
    runtime.connected = false;
    runtime.teamMembers = [];
    return;
  }
  try {
    rustClient.disconnect();
  } catch (err) {
    logger.warn('[Web] disconnect 失败: ' + err.message);
  } finally {
    rustClient = null;
    runtime.connected = false;
    runtime.teamMembers = [];
  }
}

async function connectServerById(serverId) {
  const target = await getServer(serverId);
  if (!target) throw new Error('服务器不存在');

  if (runtime.currentServerId && String(runtime.currentServerId) === String(target.id) && rustClient?.connected) {
    return target;
  }

  await disconnectActiveClient();

  rustClient = new RustClient(target);
  runtime.currentServer = target;
  runtime.currentServerId = target.id;
  bindClientEvents(rustClient, target);

  await rustClient.connect();
  await bootstrapRuntimeForConnectedServer(target);
  await setLastServerId(target.id);
  return target;
}

function bootstrapPayload(servers = [], steam = null) {
  return {
    connected: runtime.connected,
    currentServer: runtime.currentServer,
    currentServerId: runtime.currentServerId,
    lastError: runtime.lastError,
    serverInfo: runtime.latestServerSnapshot,
    teamMembers: runtime.teamMembers,
    teamMessages: runtime.teamMessages,
    servers,
    steam,
  };
}

function serializeRule(rule = {}) {
  const meta = rule?._meta || {};
  const inferActions = [];
  if (meta.doNotify === true) inferActions.push('notify_desktop');
  if (meta.doChat !== false) inferActions.push('team_chat');
  const metaActions = Array.isArray(meta.actions) ? meta.actions.length : inferActions.length;
  return {
    id: rule.id,
    name: rule.name,
    event: rule.event,
    trigger: rule.trigger || {},
    enabled: !!rule.enabled,
    _meta: meta,
    actions: metaActions ? [`${metaActions}个动作`] : ((rule.actions || []).length ? [`${rule.actions.length}个动作`] : []),
  };
}

function buildPersistedCommandSnapshot(keyword, serverId) {
  const command = cmdParser?.getCommand(keyword, { includeDeleted: true });
  if (!command) return null;
  return {
    id: String(command.keyword || keyword).toLowerCase(),
    keyword: String(command.keyword || keyword).toLowerCase(),
    type: command.type || null,
    name: String(command.description || '').trim(),
    permission: command.permission || 'all',
    enabled: command.enabled !== false,
    meta: command.meta || {},
    trigger: command.trigger || { cooldownMs: getGlobalTeamChatIntervalMs() },
    serverId: serverId || null,
    deleted: false,
  };
}

async function ensureDefaultCommandRules(serverId) {
  if (!serverId || !cmdParser) return [];
  const persisted = await listCommandRules(serverId);
  if (persisted.length) return persisted;
  const preset = getCommandPreset('command_system_default');
  if (!preset?.commandRules?.length) return [];
  cmdParser.restoreBuiltinCommands?.();
  const applied = [];
  for (const rule of preset.commandRules) {
    const normalized = normalizeCommandRuleForServer({
      ...rule,
      enabled: true,
      meta: {
        ...(rule.meta || {}),
        doNotify: false,
        doChat: true,
        actions: [{ type: 'team_chat' }],
      },
    }, serverId);
    if (!normalized) continue;
    cmdParser.setCommandRule(normalized);
    const saved = await saveCommandRule({ ...normalized, deleted: false });
    applied.push(saved);
  }
  return applied;
}

function buildSystemCommandRulesFromParser(serverId) {
  if (!cmdParser) return [];
  return cmdParser.getCommands()
    .filter((command) => command?.isBuiltin)
    .map((command) => normalizeCommandRuleForServer({
      id: command.keyword,
      keyword: command.keyword,
      type: command.type || null,
      name: command.keyword === 'fk' ? '防空' : '',
      permission: command.keyword === 'fk' ? 'all' : (command.permission || 'all'),
      enabled: true,
      meta: {
        ...(command.keyword === 'fk' ? { action: 'toggle' } : {}),
        doNotify: false,
        doChat: true,
        actions: [{ type: 'team_chat' }],
      },
      trigger: { cooldownMs: getGlobalTeamChatIntervalMs() },
    }, serverId))
    .filter(Boolean);
}

function normalizeCommandListRecord(rule = {}) {
  const keyword = String(rule.keyword || rule.id || '').toLowerCase();
  return {
    keyword,
    description: rule.name || rule.description || keyword,
    permission: String(rule.permission || 'all'),
    enabled: rule.enabled !== false,
    type: rule.type || null,
    isBuiltin: false,
    meta: rule.meta || {},
    trigger: rule.trigger || { cooldownMs: getGlobalTeamChatIntervalMs() },
  };
}

async function syncCallGroupsFromDb() {
  const dbGroups = await listCallGroupsDb();
  let hasTeamChatSettings = false;
  const dbIds = new Set(dbGroups.map((g) => String(g.id || '')));
  for (const inMemory of listGroups()) {
    const gid = String(inMemory?.id || '');
    if (gid && gid !== TEAM_CHAT_SETTINGS_GROUP_ID && !dbIds.has(gid)) removeGroup(gid);
  }
  for (const group of dbGroups) {
    if (!group?.id) continue;
    setGroup(group.id, group);
    if (String(group.id) === TEAM_CHAT_SETTINGS_GROUP_ID) hasTeamChatSettings = true;
  }
  if (!hasTeamChatSettings) {
    const teamChatGroup = normalizeCallGroupInput({
      id: TEAM_CHAT_SETTINGS_GROUP_ID,
      kind: 'team_chat_settings',
      name: '团队聊天',
      intervalMs: FALLBACK_TEAM_CHAT_INTERVAL_MS,
    });
    setGroup(teamChatGroup.id, teamChatGroup);
    await saveCallGroupDb(teamChatGroup);
  }
  return dbGroups;
}

function isServerPairingPayload(data = {}) {
  const type = String(data.type || '').toLowerCase();
  if (type === 'entity') return false;
  if (data.entityId) return false;
  return !!(data.ip && data.port && data.playerId && data.playerToken);
}

function hasServerCredentials(data = {}) {
  return !!(data.ip && data.port && data.playerId && data.playerToken);
}

async function findServerForEntityPairing(data = {}) {
  if (data.ip && data.port) {
    const servers = await listServers();
    const matched = servers.find(s => String(s.ip) === String(data.ip) && String(s.port) === String(data.port));
    if (matched) return matched;
  }
  return null;
}

async function upsertServerFromPairing(data = {}, { allowTokenUpdate = true } = {}) {
  if (!hasServerCredentials(data)) return { server: null, tokenChanged: false };
  const existing = (await listServers()).find(
    s => String(s.ip) === String(data.ip)
      && String(s.port) === String(data.port)
      && String(s.playerId) === String(data.playerId),
  );
  const payload = allowTokenUpdate
    ? data
    : { ...data, playerToken: existing?.playerToken || data.playerToken };
  const server = await saveServer(payload);
  const tokenChanged = !!(allowTokenUpdate && existing && String(existing.playerToken) !== String(server.playerToken));
  return { server, tokenChanged, existed: !!existing };
}

function createRuleActionDeps() {
  return {
    mapSize: Number(runtime.latestServerSnapshot?.mapSize || 0),
    notifyDesktop: ({ title, message }) => {
      notify('desktop', { title, message });
    },
    notifyDiscord: ({ title, message }) => {
      notify('discord', { title, message });
    },
    sendWsNotification: ({ type, title, message }) => {
      sendWs('notification', { type, title, message });
    },
    sendTeamMessage: async (message) => {
      if (!rustClient?.connected) return;
      await dispatchTeamChat(message);
    },
    toggleSwitch: async ({ entityId, state }) => {
      if (!rustClient?.connected) return;
      if (state) await rustClient.turnSwitchOn(entityId);
      else await rustClient.turnSwitchOff(entityId);
    },
    callGroup: async (groupId, message, options = {}) => {
      await callGroup(groupId, message, options);
    },
  };
}

async function bootstrapRuntimeForConnectedServer(serverConfig) {
  eventEngine?.unbind?.();
  eventEngine = new EventEngine({
    onRuleEnabledChanged: ({ ruleId, enabled, reason, onlineCount, threshold }) => {
      sendWs('rule:auto-toggled', { ruleId, enabled, reason, onlineCount, threshold });
    },
  });
  cmdParser = new CommandParser({
    leaderId: serverConfig.playerId,
    callGroupRunner: (groupId, message, options = {}) => callGroup(groupId, message, options),
    notifyDesktopRunner: ({ title, message }) => {
      notify('desktop', { title, message });
      sendWs('notification', { type: 'info', title, message });
    },
    notifyDiscordRunner: ({ title, message }) => {
      notify('discord', { title, message });
    },
    teamChatRunner: async (message) => {
      if (!rustClient?.connected) return;
      await dispatchTeamChat(message);
    },
  });

  eventEngine.bind(rustClient);
  cmdParser.bind(rustClient);

  const boundDevices = await listDevices(serverConfig.id);
  for (const device of boundDevices) {
    if (String(device?.type || '').toLowerCase() === 'switch') {
      cmdParser.registerSwitch(device.entityId, device.alias);
    }
  }

  const persistedCommands = await listCommandRules(serverConfig.id);
  await applyPersistedCommandRules({
    parser: cmdParser,
    persistedRules: persistedCommands,
    removeRule: async (keyword) => removeCommandRule(keyword, serverConfig.id),
  });
  if (!(await listCommandRules(serverConfig.id)).length) {
    await ensureDefaultCommandRules(serverConfig.id);
  }

  const persistedRules = await listEventRules(serverConfig.id);
  for (const rule of persistedRules) {
    if (LEGACY_PLAYER_STATUS_EVENTS.has(String(rule?.event || ''))) {
      await removeEventRule(rule.id, serverConfig.id);
    }
  }
  let safeRules = await listEventRules(serverConfig.id);
  if (!safeRules.length) {
    const preset = getEventPreset('event_system_default');
    for (const rule of preset?.eventRules || []) {
      const normalized = normalizeEventRuleForServer(rule, serverConfig.id);
      await saveEventRule(normalized);
    }
    safeRules = await listEventRules(serverConfig.id);
  }
  let playerStatusRule = safeRules.find((rule) => String(rule?.event || '') === 'player_status');
  if (!playerStatusRule) {
    playerStatusRule = await saveEventRule({
      id: 'player_status_notify',
      name: '队友状态整合事件',
      event: 'player_status',
      serverId: serverConfig.id,
      trigger: { cooldownMs: getGlobalTeamChatIntervalMs() },
      enabled: true,
      _meta: {
        doNotify: false,
        doChat: true,
        message: '{player_status_message}',
        playerStatusMessages: { ...DEFAULT_PLAYER_STATUS_MESSAGES },
      },
    });
    safeRules = await listEventRules(serverConfig.id);
  } else {
    const merged = {
      ...playerStatusRule,
      _meta: {
        ...(playerStatusRule._meta || {}),
        message: String(playerStatusRule?._meta?.message || '').trim() || '{player_status_message}',
        playerStatusMessages: {
          ...DEFAULT_PLAYER_STATUS_MESSAGES,
          ...((playerStatusRule._meta || {}).playerStatusMessages || {}),
        },
      },
    };
    if (String(merged._meta.message || '').includes('{member}{player_status}')) {
      merged._meta.message = '{player_status_message}';
    }
    await saveEventRule(merged);
    safeRules = await listEventRules(serverConfig.id);
  }
  const actionDeps = createRuleActionDeps();
  for (const rule of safeRules) {
    eventEngine.addRule(hydrateRule(rule, actionDeps));
  }

  const connectedBroadcast = await sendTeamChatWithGuards(TEAMCHAT_CONNECTED_BROADCAST);
  if (!connectedBroadcast?.success) {
    logger.warn('[Web] 连接成功提示发送失败: ' + (connectedBroadcast?.error || 'unknown'));
  }
}

function inferDeviceTypeFromPairing(data = {}) {
  const entityType = String(data.entityType || '').toLowerCase();
  const name = String(data.entityName || data.name || '').toLowerCase();
  if (entityType.includes('alarm') || name.includes('alarm') || name.includes('警报')) return 'alarm';
  if (entityType.includes('storage') || name.includes('storage') || name.includes('箱')) return 'storage';
  return 'switch';
}

function toHttpErrorStatus(message = '') {
  const text = String(message || '');
  if (!text) return 500;
  if (text.includes('未知 IPC 通道') || text.includes('channel 不能为空')) return 400;
  return 500;
}

function toResultStatus(result = {}, fallback = 400) {
  if (Number.isFinite(Number(result?.statusCode))) return Number(result.statusCode);
  const text = String(result?.error || result?.reason || '');
  if (!text) return fallback;
  if (text.includes('不存在') || text.toLowerCase().includes('not found')) return 404;
  if (text.includes('未连接') || text.includes('缺少')) return 400;
  return fallback;
}

async function sendTeamChatWithGuards(rawMessage) {
  if (!rustClient?.connected) return { success: false, error: '未连接服务器' };
  const message = normalizeTeamMessageText(rawMessage);
  if (!message) return { success: false, error: '消息不能为空' };
  try {
    consumeRateLimit('web_team_chat_send', {
      limit: TEAM_CHAT_RPM_LIMIT,
      windowMs: 60_000,
      message: `发送过于频繁：每分钟最多 ${TEAM_CHAT_RPM_LIMIT} 条`,
    });
    await dispatchTeamChat(message);
    return { success: true };
  } catch (err) {
    if (err instanceof RateLimitError || err?.code === 'RATE_LIMIT') {
      return { success: false, error: err.message, statusCode: 429 };
    }
    return { success: false, error: String(err?.message || err || '发送失败') };
  }
}

async function buildItemCatalogMap(rawIds) {
  const list = Array.isArray(rawIds) ? rawIds : [];
  const out = {};
  const toIconUrl = (shortName = '') => {
    const token = String(shortName || '').trim();
    if (!token) return '';
    return `https://cdn.rusthelp.com/images/public/${encodeURIComponent(token)}.png`;
  };
  const toLocalIconUrl = (id) => {
    const localPath = path.join(__dirname, '../assets/item-icons', `${id}.png`);
    if (!fs.existsSync(localPath)) return '';
    return `/assets/item-icons/${id}.png`;
  };

  for (const rawId of list) {
    const id = Number(rawId);
    if (!Number.isFinite(id)) continue;
    const item = getItemById(id);
    if (!item) {
      out[String(id)] = { id, name: `itemId:${id}` };
      continue;
    }
    out[String(id)] = {
      id,
      shortName: item.shortName || '',
      nameZh: item.nameZh || '',
      nameEn: item.nameEn || '',
      name: item.nameZh || item.nameEn || item.shortName || `itemId:${id}`,
      iconLocalUrl: toLocalIconUrl(id),
      iconUrl: toIconUrl(item.shortName),
    };
  }
  return out;
}

async function resolveConnectTarget(rawCfg) {
  const cfg = (rawCfg && typeof rawCfg === 'object') ? rawCfg : {};
  const explicitId = String(cfg.id || cfg.serverId || '').trim();
  if (explicitId) {
    const found = await getServer(explicitId);
    if (found) return found;
  }

  if (hasServerCredentials(cfg)) {
    return saveServer(cfg);
  }

  if (explicitId) throw new Error('服务器不存在');
  throw new Error('连接参数不完整');
}

async function startPairingFlow(options = {}) {
  return new Promise(async (resolve) => {
    if (fcmStopFn) fcmStopFn();
    if (pairingNoNotificationTimer) {
      clearTimeout(pairingNoNotificationTimer);
      pairingNoNotificationTimer = null;
    }

    let resolved = false;
    try {
      await registerFCM({ force: !!options?.forceRegister });
    } catch (err) {
      resolve({ success: false, error: `FCM 注册失败: ${err.message}` });
      return;
    }

    try {
      fcmStopFn = listenForPairing(async (data) => {
        const serverPayload = isServerPairingPayload(data);
        let server = null;
        let tokenChanged = false;
        let existed = false;

        if (serverPayload && hasServerCredentials(data)) {
          const upsert = await upsertServerFromPairing(data, { allowTokenUpdate: serverPayload });
          server = upsert.server;
          tokenChanged = upsert.tokenChanged;
          existed = upsert.existed;
        }

        if (tokenChanged && rustClient?.connected && server?.id) {
          const sameServer = String(rustClient.config?.ip) === String(server.ip)
            && String(rustClient.config?.port) === String(server.port)
            && String(rustClient.config?.playerId) === String(server.playerId);
          if (sameServer) {
            connectServerById(server.id).catch((err) => logger.warn('[WebPairing] token 刷新重连失败: ' + err.message));
          }
        }

        if (serverPayload) {
          if (server?.id) {
            const sameAsCurrent = !!(rustClient?.connected
              && String(rustClient.config?.ip) === String(server.ip)
              && String(rustClient.config?.port) === String(server.port)
              && String(rustClient.config?.playerId) === String(server.playerId));
            if (!sameAsCurrent) {
              connectServerById(server.id).catch((err) => logger.warn('[WebPairing] 自动连接失败: ' + err.message));
            }
          }
          if (!existed && server) sendWs('pairing:success', server);
          if (!resolved) {
            resolved = true;
            resolve({ success: true, server });
          }
        } else {
          server = await findServerForEntityPairing(data);
          if (!server) {
            logger.warn('[WebPairing] 收到设备配对推送，但未找到已配对服务器，已忽略');
            return;
          }
        }

        if (data?.entityId && server?.id) {
          const entityId = Number(data.entityId);
          if (Number.isFinite(entityId)) {
            sendWs('pairing:entity-candidate', {
              entityId,
              serverId: server.id,
              alias: String(data.entityName || `设备_${entityId}`),
              type: inferDeviceTypeFromPairing(data),
              serverName: server.name,
            });
          }
        }
      }, {
        onStatus: (status) => {
          sendWs('pairing:listener-status', status);
          if (status?.type === 'notification-received' && pairingNoNotificationTimer) {
            clearTimeout(pairingNoNotificationTimer);
            pairingNoNotificationTimer = null;
          }
        },
      });

      pairingNoNotificationTimer = setTimeout(() => {
        sendWs('pairing:listener-status', {
          type: 'idle-timeout',
          message: '监听已启动但长时间未收到任何通知，可能是推送凭据失效或未触发新的游戏内配对请求',
        });
      }, 60_000);

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ success: true, pending: true });
        }
      }, 15_000);
    } catch (err) {
      resolve({ success: false, error: `配对监听失败: ${err.message}` });
    }
  });
}

async function stopPairingFlow() {
  fcmStopFn?.();
  fcmStopFn = null;
  if (pairingNoNotificationTimer) {
    clearTimeout(pairingNoNotificationTimer);
    pairingNoNotificationTimer = null;
  }
  return { success: true };
}

async function diagnosePairing() {
  const steam = await getSteamProfileStatus({ fetchRemote: false }).catch(() => null);
  const cfgFile = path.join(__dirname, '../config/rustplus.config.json');
  const logFile = path.join(__dirname, '../config/fcm-listen-last.log');
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  } catch (_) {}

  let lastFcmLogAt = null;
  try {
    const stat = fs.statSync(logFile);
    lastFcmLogAt = stat?.mtime ? stat.mtime.toISOString() : null;
  } catch (_) {}

  return {
    listenerRunning: !!fcmStopFn,
    hasFcmCredentials: !!cfg?.fcm_credentials?.fcm?.token,
    hasExpoToken: !!cfg?.expo_push_token,
    hasRustplusAuthToken: !!cfg?.rustplus_auth_token,
    steam: steam ? {
      hasLogin: !!steam.hasLogin,
      steamId: steam?.tokenMeta?.steamId || null,
      expiresAt: steam?.tokenMeta?.expiresAt || null,
      isExpired: steam?.tokenMeta?.isExpired ?? null,
    } : null,
    lastFcmLogAt,
  };
}

const invokeIpc = createIpcInvoker({
  'docs:getHelp': async () => {
    try {
      return fs.readFileSync(path.join(__dirname, '../docs/HELP.md'), 'utf8');
    } catch (err) {
      return `帮助文档读取失败: ${err.message}`;
    }
  },

  'app:init': async () => {
    await syncCallGroupsFromDb();
    const servers = await listServers();
    const connected = !!rustClient?.connected;
    const currentServer = connected
      ? (servers.find((s) => String(s.id) === String(runtime.currentServerId)) || runtime.currentServer || null)
      : null;
    return {
      version: VERSION,
      servers,
      devices: connected && currentServer?.id ? await listDevices(currentServer.id) : [],
      groups: listGroups(),
      connected,
      currentServer,
      steam: await getSteamProfileStatus({ fetchRemote: false }),
    };
  },

  'steam:status': async () => getSteamProfileStatus({ fetchRemote: true }),
  'steam:beginAuth': async () => {
    try {
      await registerFCM({ force: true });
      return { success: true, steam: await getSteamProfileStatus({ fetchRemote: false }) };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  },
  'steam:logout': async () => {
    const res = await logoutSteam();
    if (!res?.success) return { success: false, reason: res?.reason || '注销失败' };
    return { success: true, steam: await getSteamProfileStatus({ fetchRemote: false }) };
  },

  'server:list': async () => listServers(),
  'server:remove': async (args) => {
    const id = args[0];
    const result = await removeServerCascade(id);
    const ok = !!result?.removedServer;
    const last = await getLastServerId();
    if (last && String(last) === String(id)) await setLastServerId(null);
    if (ok && runtime.currentServerId && String(runtime.currentServerId) === String(id)) {
      await disconnectActiveClient();
      runtime.currentServer = null;
      runtime.currentServerId = null;
      runtime.latestServerSnapshot = buildServerInfoSnapshot(null, null);
      sendWs('server:status', { connected: false, name: '', serverId: null, server: null });
    }
    return { success: ok, ...result };
  },
  'server:connect': async (args) => {
    try {
      const target = await resolveConnectTarget(args[0]);
      await connectServerById(target.id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
  'server:disconnect': async () => {
    await disconnectActiveClient();
    runtime.currentServer = null;
    runtime.currentServerId = null;
    runtime.latestServerSnapshot = buildServerInfoSnapshot(null, null);
    sendWs('server:status', { connected: false, name: '', serverId: null, server: null });
    return { success: true };
  },
  'server:getInfo': async () => {
    if (!rustClient?.connected) return null;
    try {
      const result = await rustClient.getServerInfo();
      if (result && !result.error) {
        const timeInfo = await rustClient.getTime().catch(() => null);
        runtime.latestServerSnapshot = buildServerInfoSnapshot(result, timeInfo);
        sendWs('server:info', runtime.latestServerSnapshot);
      }
      return result;
    } catch (err) {
      if (String(err?.message || '').toLowerCase() === 'not_found') return null;
      return { error: err.message };
    }
  },
  'server:getTeam': async () => {
    if (!rustClient?.connected) return null;
    try {
      return await rustClient.getTeamInfo();
    } catch (err) {
      if (String(err?.message || '').toLowerCase() === 'not_found') return null;
      return { error: err.message };
    }
  },
  'catalog:getItemsByIds': async (args) => buildItemCatalogMap(args[0]),
  'catalog:search': async (args) => {
    const query = String(args[0] || '').trim();
    if (!query) return { items: [] };
    return { items: matchItems(query, { limit: 20 }) };
  },
  'map:getData': async () => {
    if (!rustClient?.connected) return { error: 'not_connected' };
    try {
      const [mapRes, serverRes] = await Promise.all([
        rustClient.getMap(),
        rustClient.getServerInfo().catch(() => null),
      ]);
      const rawServerInfo = serverRes?.info || serverRes || {};
      const normalized = normalizeServerMapPayload(mapRes, {
        serverInfo: rawServerInfo,
        mapSize: rawServerInfo?.mapSize || runtime.latestServerSnapshot?.mapSize,
      });
      const enriched = await enrichMapDataWithRustMaps(normalized, {
        mapSize: rawServerInfo?.mapSize || runtime.latestServerSnapshot?.mapSize,
        seed: rawServerInfo?.seed,
        serverName: rawServerInfo?.name || runtime.currentServer?.name,
        mapName: rawServerInfo?.map,
      });
      if (rawServerInfo?.seed != null) enriched.seed = rawServerInfo.seed;
      return enriched;
    } catch (err) {
      return { error: err.message };
    }
  },
  'map:getMarkers': async () => {
    if (!rustClient?.connected) return { error: 'not_connected' };
    try {
      return await rustClient.getMapMarkers();
    } catch (err) {
      return { error: err.message };
    }
  },
  'server:getHealth': async () => {
    if (!rustClient) return { connected: false, reason: 'client_not_initialized' };
    return rustClient.getHealthStatus();
  },

  'pairing:start': async (args) => startPairingFlow(args[0] || {}),
  'pairing:stop': async () => stopPairingFlow(),
  'pairing:diagnose': async () => diagnosePairing(),

  'device:list': async (args) => listDevices(args[0]),
  'device:register': async (args) => {
    const opts = args[0] || {};
    await registerDevice(opts);
    if (cmdParser && rustClient?.connected && String(opts?.serverId || '') === String(runtime.currentServerId || '')) {
      const t = String(opts?.type || '').toLowerCase();
      if (t === 'switch') cmdParser.registerSwitch(opts.entityId, opts.alias);
    }
    return { success: true };
  },
  'device:update': async (args) => {
    const payload = args[0] || {};
    const updated = await updateDevice(payload.entityId, payload.updates || {}, runtime.currentServerId || null);
    if (updated && cmdParser) {
      const t = String(updated?.type || '').toLowerCase();
      if (t === 'switch') cmdParser.registerSwitch(updated.entityId, updated.alias);
      else cmdParser.unregisterSwitch(updated.entityId);
    }
    return { success: !!updated, device: updated };
  },
  'device:remove': async (args) => {
    const success = await removeDevice(args[0], runtime.currentServerId || null);
    if (success && cmdParser) cmdParser.unregisterSwitch(args[0]);
    return { success };
  },
  'device:getInfo': async (args) => {
    if (!rustClient?.connected) return { error: '未连接' };
    try {
      return await rustClient.getEntityInfo(args[0]);
    } catch (err) {
      const msg = String(err?.message || '未知错误');
      if (msg.toLowerCase() === 'not_found') return { error: '设备不存在或未配对到当前服务器' };
      return { error: msg };
    }
  },
  'device:switch': async (args) => {
    if (!rustClient?.connected) return { error: '未连接' };
    const payload = args[0] || {};
    try {
      return payload.state
        ? await rustClient.turnSwitchOn(payload.entityId)
        : await rustClient.turnSwitchOff(payload.entityId);
    } catch (err) {
      const msg = String(err?.message || '未知错误');
      if (msg.toLowerCase() === 'not_found') return { error: '开关设备未找到（可能已失效或不在当前服务器）' };
      return { error: msg };
    }
  },

  'rules:list': async () => {
    if (!rustClient?.connected || !runtime.currentServerId) return [];
    const rules = await listEventRules(runtime.currentServerId);
    return rules.map(serializeRule);
  },
  'rules:add': async (args) => {
    if (!rustClient?.connected || !runtime.currentServerId) {
      return { success: false, error: '未连接服务器，无法新增事件规则' };
    }
    const normalized = normalizeEventRuleForServer(args[0] || {}, runtime.currentServerId);
    if (LEGACY_PLAYER_STATUS_EVENTS.has(String(normalized.event || ''))) {
      return { success: false, error: '队友单项事件已下线，请使用「队友状态整合」事件' };
    }
    eventEngine?.addRule(hydrateRule(normalized, createRuleActionDeps()));
    const saved = await saveEventRule(normalized);
    return { success: true, rule: serializeRule(hydrateRule(saved, createRuleActionDeps())) };
  },
  'rules:remove': async (args) => {
    if (!runtime.currentServerId) return { success: false, error: '未连接服务器' };
    const id = String(args[0] || '').trim();
    if (!id) return { success: false, error: '缺少规则ID' };
    const rule = (await listEventRules(runtime.currentServerId)).find((r) => String(r.id) === id);
    if (!rule) return { success: false, error: '规则不存在或不属于当前服务器' };
    eventEngine?.removeRule(id);
    await removeEventRule(id, runtime.currentServerId);
    return { success: true };
  },
  'rules:toggle': async (args) => {
    if (!runtime.currentServerId) return { success: false, error: '未连接服务器' };
    const payload = args[0] || {};
    const ruleId = String(payload.id || '').trim();
    const rule = (await listEventRules(runtime.currentServerId)).find((r) => String(r.id) === ruleId);
    if (!rule) return { success: false, error: '规则不存在或不属于当前服务器' };
    const enabled = payload.enabled !== false;
    eventEngine?.setRuleEnabled(ruleId, enabled);
    const ok = await setEventRuleEnabled(ruleId, enabled, runtime.currentServerId);
    if (!ok) return { success: false, error: '规则不存在或不属于当前服务器' };
    return { success: true };
  },

  'commands:list': async () => {
    if (!rustClient?.connected || !runtime.currentServerId) return [];
    if (cmdParser) return cmdParser.getCommands();
    const persisted = await listCommandRules(runtime.currentServerId);
    return persisted.map(normalizeCommandListRecord);
  },
  'commands:toggle': async (args) => {
    if (!cmdParser || !runtime.currentServerId) return { success: false, error: '未连接服务器或指令不存在' };
    const payload = args[0] || {};
    const key = String(payload.keyword || '').toLowerCase().trim();
    if (!key) return { success: false, error: '缺少指令关键词' };
    const ok = cmdParser.setCommandEnabled(key, payload.enabled);
    if (!ok) return { success: false, error: `指令不存在：${key}` };
    const snapshot = buildPersistedCommandSnapshot(key, runtime.currentServerId);
    if (!snapshot) return { success: false, error: `无法生成指令快照：${key}` };
    snapshot.enabled = !!payload.enabled;
    await saveCommandRule(snapshot);
    return { success: true };
  },
  'commands:saveRule': async (args) => {
    if (!runtime.currentServerId) return { success: false, error: '未连接服务器，无法保存指令规则' };
    const incoming = args[0] || {};
    const keyword = String(incoming?.keyword || '').toLowerCase().trim();
    if (!keyword) return { success: false, error: '缺少指令关键词' };
    const payload = normalizeCommandRuleForServer(incoming, runtime.currentServerId);
    if (!payload) return { success: false, error: '缺少指令关键词' };
    if (!cmdParser?.setCommandRule(payload)) {
      return { success: false, error: '指令规则创建失败（类型或关键词无效）' };
    }
    await saveCommandRule({
      ...payload,
      id: String(payload.id || keyword),
      keyword,
      serverId: runtime.currentServerId,
      deleted: false,
    });
    return { success: true };
  },
  'commands:removeRule': async (args) => {
    if (!runtime.currentServerId) return { success: false, error: '未连接服务器' };
    const key = String(args[0] || '').toLowerCase().trim();
    if (!key) return { success: false, error: '缺少指令关键词' };
    const current = cmdParser?.getCommand(key, { includeDeleted: true });
    if (!current) return { success: false, error: '指令不存在' };
    cmdParser?.removeCommandRule(key);
    if (current.isBuiltin) {
      const snapshot = buildPersistedCommandSnapshot(key, runtime.currentServerId) || {
        id: key,
        keyword: key,
        type: current.type || null,
        name: String(current.description || '').trim(),
        permission: current.permission || 'all',
        meta: current.meta || {},
        trigger: current.trigger || { cooldownMs: getGlobalTeamChatIntervalMs() },
        serverId: runtime.currentServerId,
      };
      await saveCommandRule({
        ...snapshot,
        enabled: false,
        deleted: true,
      });
    } else {
      await removeCommandRule(key, runtime.currentServerId);
    }
    return { success: true };
  },

  'presets:list': async () => listPresets(),
  'presets:apply': async (args) => {
    const payload = args[0] || {};
    const presetType = String(payload.type || '').trim();
    const presetId = String(payload.id || '').trim();
    const shouldReplace = !!payload.replaceExisting;
    if (!presetType || !presetId) return { success: false, error: '预设参数不完整' };
    if (!runtime.currentServerId || !rustClient?.connected) {
      return { success: false, error: '未连接服务器，无法应用预设' };
    }

    if (presetType === 'events') {
      const preset = getEventPreset(presetId);
      if (!preset) return { success: false, error: '事件预设不存在' };
      if (shouldReplace) {
        const existing = await listEventRules(runtime.currentServerId);
        for (const rule of existing) {
          eventEngine?.removeRule(rule.id);
          await removeEventRule(rule.id, runtime.currentServerId);
        }
      }
      for (const rule of preset.eventRules || []) {
        const normalized = normalizeEventRuleForServer({
          ...rule,
          trigger: { ...(rule.trigger || {}), cooldownMs: getGlobalTeamChatIntervalMs() },
        }, runtime.currentServerId);
        eventEngine?.addRule(hydrateRule(normalized, createRuleActionDeps()));
        await saveEventRule(normalized);
      }
      return { success: true, applied: (preset.eventRules || []).length };
    }

    if (presetType === 'commands') {
      const preset = getCommandPreset(presetId);
      if (!preset) return { success: false, error: '指令预设不存在' };
      if (shouldReplace) {
        const existing = await listCommandRules(runtime.currentServerId);
        for (const rule of existing) await removeCommandRule(rule.id || rule.keyword, runtime.currentServerId);
        if (cmdParser) {
          cmdParser.restoreBuiltinCommands?.();
          for (const command of cmdParser.getCommands()) {
            if (command.isBuiltin) cmdParser.setCommandEnabled(command.keyword, false);
            else cmdParser.removeCommandRule(command.keyword);
          }
        }
      }
      const rulesToApply = buildSystemCommandRulesFromParser(runtime.currentServerId);
      for (const rule of rulesToApply.length ? rulesToApply : (preset.commandRules || [])) {
        const normalized = normalizeCommandRuleForServer({
          ...rule,
          enabled: true,
          meta: {
            ...(rule.meta || {}),
            doNotify: false,
            doChat: true,
            actions: [{ type: 'team_chat' }],
          },
          trigger: { ...(rule.trigger || {}), cooldownMs: getGlobalTeamChatIntervalMs() },
        }, runtime.currentServerId);
        if (!normalized) continue;
        if (cmdParser) {
          if (normalized.type || normalized.name || normalized.meta) cmdParser.setCommandRule(normalized);
          else cmdParser.setCommandEnabled(normalized.keyword, normalized.enabled !== false);
        }
        await saveCommandRule({ ...normalized, deleted: false });
      }
      return { success: true, applied: (rulesToApply.length ? rulesToApply : (preset.commandRules || [])).length };
    }

    return { success: false, error: '不支持的预设类型' };
  },

  'callgroup:list': async () => {
    await syncCallGroupsFromDb();
    return listGroups();
  },
  'callgroup:set': async (args) => {
    const normalized = normalizeCallGroupInput(args[0] || {});
    setGroup(normalized.id, normalized);
    await saveCallGroupDb(normalized);
    return { success: true, group: normalized };
  },
  'callgroup:remove': async (args) => {
    if (String(args[0] || '') === TEAM_CHAT_SETTINGS_GROUP_ID) {
      return { success: false, error: '系统团队聊天配置不可删除' };
    }
    const id = String(args[0] || '').trim();
    if (!id) return { success: false, error: '缺少呼叫组ID' };
    removeGroup(id);
    await removeCallGroupDb(id);
    return { success: true };
  },
  'callgroup:call': async (args) => {
    const payload = args[0] || {};
    return callGroup(payload.groupId, payload.message, {
      channels: payload.channels,
    });
  },

  'chat:send': async (args) => sendTeamChatWithGuards(args[0]),
});

app.disable('x-powered-by');
app.use(express.json({ limit: '300kb' }));
app.use((_, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', ensureAuth);

app.get('/api/health', (_, res) => {
  res.json({ ok: true, service: 'rust-plus-web', ts: Date.now() });
});

app.get('/api/bootstrap', async (_, res) => {
  const servers = await listServers();
  const steam = await getSteamProfileStatus({ fetchRemote: false }).catch(() => null);
  res.json(bootstrapPayload(servers, steam));
});

app.get('/api/servers', async (_, res) => {
  const servers = await invokeIpc({ channel: 'server:list', args: [] });
  res.json({ servers });
});

app.post('/api/servers/connect', async (req, res) => {
  const serverId = String(req.body?.serverId || '').trim();
  if (!serverId) return res.status(400).json({ success: false, error: 'serverId 不能为空' });
  const result = await invokeIpc({ channel: 'server:connect', args: [{ id: serverId }] });
  if (!result?.success) return res.status(toResultStatus(result)).json(result);
  return res.json({ success: true, server: runtime.currentServer });
});

app.post('/api/servers/disconnect', async (_, res) => {
  const result = await invokeIpc({ channel: 'server:disconnect', args: [] });
  if (!result?.success) return res.status(toResultStatus(result)).json(result);
  return res.json(result);
});

app.get('/api/server/info', async (_, res) => {
  await invokeIpc({ channel: 'server:getInfo', args: [] });
  res.json({ connected: runtime.connected, info: runtime.latestServerSnapshot });
});

app.get('/api/team/members', async (_, res) => {
  const team = await invokeIpc({ channel: 'server:getTeam', args: [] });
  runtime.teamMembers = extractTeamMembers(team);
  res.json({ connected: runtime.connected, members: runtime.teamMembers });
});

app.get('/api/team/messages', (_, res) => {
  res.json({ messages: runtime.teamMessages });
});

app.post('/api/team/messages', async (req, res) => {
  const result = await invokeIpc({ channel: 'chat:send', args: [req.body?.message] });
  if (result?.success) return res.json(result);
  return res.status(Number(result?.statusCode || 400)).json(result);
});

app.get('/api/steam/status', async (_, res) => {
  const steam = await invokeIpc({ channel: 'steam:status', args: [] }).catch((err) => ({ error: err.message }));
  res.json(steam);
});

app.get('/api/rules/events', async (_, res) => {
  if (!runtime.currentServerId) return res.status(400).json({ error: '缺少 serverId，且当前未连接服务器' });
  const rules = await invokeIpc({ channel: 'rules:list', args: [] });
  return res.json({ serverId: runtime.currentServerId, rules });
});

app.post('/api/rules/events', async (req, res) => {
  const result = await invokeIpc({ channel: 'rules:add', args: [req.body || {}] });
  if (!result?.success) return res.status(toResultStatus(result)).json(result);
  return res.json({ ...result, serverId: runtime.currentServerId });
});

app.post('/api/rules/events/:id/enabled', async (req, res) => {
  const ruleId = String(req.params?.id || '').trim();
  if (!ruleId) return res.status(400).json({ success: false, error: 'ruleId 不能为空' });
  const result = await invokeIpc({
    channel: 'rules:toggle',
    args: [{ id: ruleId, enabled: req.body?.enabled !== false }],
  });
  if (!result?.success) return res.status(toResultStatus(result)).json(result);
  return res.json(result);
});

app.delete('/api/rules/events/:id', async (req, res) => {
  const ruleId = String(req.params?.id || '').trim();
  if (!ruleId) return res.status(400).json({ success: false, error: 'ruleId 不能为空' });
  const result = await invokeIpc({ channel: 'rules:remove', args: [ruleId] });
  if (!result?.success) return res.status(toResultStatus(result)).json(result);
  return res.json(result);
});

app.get('/api/rules/commands', async (_, res) => {
  if (!runtime.currentServerId) return res.status(400).json({ error: '缺少 serverId，且当前未连接服务器' });
  const rules = await invokeIpc({ channel: 'commands:list', args: [] });
  return res.json({ serverId: runtime.currentServerId, rules });
});

app.post('/api/rules/commands', async (req, res) => {
  const result = await invokeIpc({ channel: 'commands:saveRule', args: [req.body || {}] });
  if (!result?.success) return res.status(toResultStatus(result)).json(result);
  return res.json({ ...result, serverId: runtime.currentServerId });
});

app.post('/api/rules/commands/:id/enabled', async (req, res) => {
  const ruleId = String(req.params?.id || '').trim();
  if (!ruleId) return res.status(400).json({ success: false, error: 'ruleId 不能为空' });
  const result = await invokeIpc({
    channel: 'commands:toggle',
    args: [{ keyword: ruleId, enabled: req.body?.enabled !== false }],
  });
  if (!result?.success) return res.status(toResultStatus(result)).json(result);
  return res.json(result);
});

app.delete('/api/rules/commands/:id', async (req, res) => {
  const ruleId = String(req.params?.id || '').trim();
  if (!ruleId) return res.status(400).json({ success: false, error: 'ruleId 不能为空' });
  const result = await invokeIpc({ channel: 'commands:removeRule', args: [ruleId] });
  if (!result?.success) return res.status(toResultStatus(result)).json(result);
  return res.json(result);
});

app.get('/api/callgroups', async (_, res) => {
  const groups = await invokeIpc({ channel: 'callgroup:list', args: [] });
  return res.json({ groups });
});

app.post('/api/callgroups', async (req, res) => {
  const result = await invokeIpc({ channel: 'callgroup:set', args: [req.body || {}] });
  if (!result?.success) return res.status(toResultStatus(result)).json(result);
  return res.json(result);
});

app.delete('/api/callgroups/:id', async (req, res) => {
  const groupId = String(req.params?.id || '').trim();
  if (!groupId) return res.status(400).json({ success: false, error: 'groupId 不能为空' });
  const result = await invokeIpc({ channel: 'callgroup:remove', args: [groupId] });
  if (!result?.success) return res.status(toResultStatus(result)).json(result);
  return res.json(result);
});

app.post('/api/ipc/invoke', async (req, res) => {
  try {
    const channel = String(req.body?.channel || '').trim();
    const args = Array.isArray(req.body?.args) ? req.body.args : [];
    const result = await invokeIpc({ channel, args });
    return res.json({ result: result === undefined ? null : result });
  } catch (err) {
    const message = String(err?.message || err || 'invoke 失败');
    return res.status(toHttpErrorStatus(message)).json({ error: message });
  }
});

app.get('/api/items/search', (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.json({ items: [] });
  const results = matchItems(query, { limit: 20 });
  res.json({ items: results });
});

app.use('/assets', express.static(path.join(__dirname, '../assets'), { maxAge: '7d' }));
app.use('/docs-static', express.static(path.join(__dirname, '../docs/static'), { maxAge: '7d' }));
app.use('/', express.static(path.join(__dirname, 'public')));

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

wss.on('connection', async (socket, req) => {
  if (REQUIRE_API_TOKEN) {
    const token = parseWebSocketAuthToken(req);
    if (!API_TOKEN || token !== API_TOKEN) {
      socket.close(1008, 'Unauthorized');
      return;
    }
  }
  try {
    const servers = await listServers();
    socket.send(JSON.stringify({
      type: 'bootstrap',
      payload: bootstrapPayload(servers, null),
      at: Date.now(),
    }));
  } catch (err) {
    socket.send(JSON.stringify({
      type: 'runtime:error',
      payload: { message: String(err?.message || err || '初始化失败') },
      at: Date.now(),
    }));
  }
});

async function boot() {
  await initDbs();
  await syncCallGroupsFromDb();

  if (REQUIRE_API_TOKEN && !API_TOKEN) {
    throw new Error('WEB_API_TOKEN 未配置：当前监听地址不是本地回环地址，已强制启用鉴权。请在 .env 设置 WEB_API_TOKEN。');
  }

  if (AUTO_CONNECT) {
    const lastServerId = await getLastServerId();
    if (lastServerId) {
      try {
        await connectServerById(lastServerId);
      } catch (err) {
        logger.warn('[Web] 自动连接失败: ' + err.message);
      }
    }
  }

  server.listen(PORT, HOST, () => {
    logger.info(`[Web] Rust Plus Web running at http://${HOST}:${PORT}`);
  });
}

boot().catch((err) => {
  logger.error('[Web] 启动失败: ' + (err?.stack || err?.message || err));
  process.exit(1);
});
