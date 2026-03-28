require('dotenv').config();

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const archiver = require('archiver');
const express = require('express');
const { WebSocketServer } = require('ws');

const logger = require('../src/utils/logger');
const RustClient = require('../src/connection/client');
const EventEngine = require('../src/events/engine');
const CommandParser = require('../src/commands/parser');
const { consumeRateLimit, RateLimitError } = require('../src/utils/rate-limit');
const { notify } = require('../src/notify/service');
const configStoreModule = require('../src/storage/config');
const { normalizeSteamId64 } = require('../src/utils/steam-id');
const steamProfileModule = require('../src/steam/profile');
const {
  initAuthStore,
  registerUser,
  authenticateUser,
  createSession,
  getPublicSession,
  destroySession,
  updateOwnProfile,
  changeOwnPassword,
  acceptGuide,
  setUserSteamBinding,
  listUsersForAdmin,
  adminCreateUser,
  adminUpdateUser,
  adminDeleteUser,
  getEmailProviderConfig,
  updateEmailProviderConfig,
  sendVerificationCodeStub,
  readRootCredentialFile,
} = require('../src/auth/store');
const {
  SERVICE_CONTEXT_ID,
  getWebUserConfigDir,
  getWebUserRustplusConfigFile,
  removeWebUserWorkspace,
  clearWebUserRustplusConfig,
} = require('../src/auth/user-workspace');
const {
  consumePublicAuthRateLimit,
  RateLimitError: AuthRateLimitError,
} = require('../src/auth/http-rate-limit');
const remoteAuthModule = require('../src/steam/remote-auth');
const { buildServerInfoSnapshot } = require('../src/utils/server-info');
const { getItemById, matchItems } = require('../src/utils/item-catalog');
const { normalizeServerMapPayload } = require('../src/utils/server-map-payload');
const { enrichMapDataWithRustMaps } = require('../src/utils/rustmaps');
const callGroupsModule = require('../src/call/groups');
const { listPresets, getEventPreset, getCommandPreset } = require('../src/presets');
const fcmModule = require('../src/pairing/fcm');
const { createIpcInvoker } = require('./ipc-invoke');
const { hydrateRule } = require('./event-actions');
const { applyPersistedCommandRules } = require('./runtime-sync');
const { createTeamChatDispatcher } = require('../src/utils/team-chat-dispatcher');
const { withRetry, ensureAll } = require('../src/utils/broadcast-subscription');
const { createRustplusConfigStore } = require('../src/storage/rustplus-config');
const { setAiSettingsProvider, maskAiSettingsForDisplay } = require('../src/ai/runtime-config');
const {
  normalizeErrorText,
  isRustProtocolCompatibilityError,
  getRustProtocolCompatibilityMessage,
} = require('../src/connection/protocol-compat');
const {
  normalizeEventRuleInput,
  normalizeCommandRuleInput,
  normalizeCallGroupInput,
} = require('../src/utils/web-config-rules');

const PORT = Number(process.env.WEB_PORT || 3080);
const HOST = process.env.WEB_HOST || '127.0.0.1';
const API_TOKEN = String(process.env.WEB_API_TOKEN || '').trim();
const PUBLIC_WEB_URL = String(process.env.WEB_PUBLIC_URL || '').trim().replace(/\/+$/, '');
const IS_LOOPBACK_HOST = ['127.0.0.1', 'localhost', '::1'].includes(String(HOST || '').trim().toLowerCase());
const REQUIRE_API_TOKEN = String(process.env.WEB_REQUIRE_API_TOKEN || '1') !== '0';
const AUTO_CONNECT = String(process.env.WEB_AUTO_CONNECT || '1') !== '0';
const MAX_TEAM_MESSAGES = Math.max(20, Number(process.env.WEB_MAX_TEAM_MESSAGES || 120));
const TEAM_CHAT_MAX_CHARS = Math.max(32, Number(process.env.RUST_TEAM_MESSAGE_MAX_CHARS || 128) || 128);
const TEAM_CHAT_RPM_LIMIT = Math.max(1, Number(process.env.WEB_TEAM_CHAT_RPM || 20) || 20);
const FALLBACK_TEAM_CHAT_INTERVAL_MS = 3_000;
const VERSION = '1.0.0';
const WEB_SESSION_COOKIE = 'rustplus_web_sid';
const BRIDGE_ALLOWED_ORIGIN_SCHEMES = ['chrome-extension://'];
const SECURITY_AUDIT_WINDOW_MS = 10 * 60_000;
const SECURITY_AUDIT_ALERT_COOLDOWN_MS = 10 * 60_000;
const TEAMCHAT_CONNECTED_BROADCAST = '安静的Rust工具已连接 - 输入help查看全部可触发指令';
const INDIVIDUAL_PLAYER_EVENTS = new Set([
  'player_online',
  'player_offline',
  'player_dead',
  'player_respawn',
  'player_afk',
  'player_afk_recover',
]);
const DEFAULT_PLAYER_STATUS_MESSAGES = {
  online: '{member}已上线｜上线位置:{member_grid}',
  offline: '{member}已离线｜离线位置:{member_grid}',
  dead: '{member}已死亡｜死亡位置:{member_grid}',
  respawn: '{member}已重生｜当前位置:{member_grid}',
  afk: '{member}已挂机{afk_duration}｜当前位置:{member_grid}',
  afk_recover: '{member}已恢复活动｜当前位置:{member_grid}',
};
const securityAuditBuckets = new Map();

function hashAuditValue(raw = '', size = 12) {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex').slice(0, size);
}

function normalizeAuditIdentifier(raw = '') {
  return String(raw || '').trim().toLowerCase().slice(0, 254);
}

function normalizeAuditReason(raw = '') {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'unknown';
}

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
app.set('trust proxy', 1);

function getRequestOrigin(req) {
  if (PUBLIC_WEB_URL) return PUBLIC_WEB_URL;
  const protocol = String(req.protocol || 'http').replace(/:$/, '');
  const host = String(req.get('host') || '').trim();
  if (!host) return '';
  return `${protocol}://${host}`;
}

function escHtml(input = '') {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBridgePackageUrl(req, sessionId) {
  const origin = getRequestOrigin(req);
  const sid = encodeURIComponent(String(sessionId || '').trim());
  return `${origin}/api/steam/remote-auth/session/${sid}/bridge-package`;
}

function streamBridgePackage(res, payload = {}) {
  const extensionDir = path.join(__dirname, '../platforms/chrome-rustplus-bridge');
  const defaults = {
    serverUrl: String(payload.serverUrl || '').trim(),
    bootstrapToken: String(payload.bootstrapToken || '').trim(),
    bridgeSessionId: String(payload.bridgeSessionId || '').trim(),
    ownerRef: String(payload.ownerRef || '').trim(),
    createdAt: new Date().toISOString(),
    expiresAt: String(payload.expiresAt || '').trim(),
    autoStartOnInstall: payload.autoStartOnInstall !== false,
  };
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    try {
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: String(err?.message || err || '打包失败') });
      } else {
        res.destroy(err);
      }
    } catch (_) {}
  });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename=\"chrome-rustplus-bridge-${defaults.bridgeSessionId || 'bundle'}.zip\"`);
  archive.pipe(res);
  archive.directory(extensionDir, false, (entry) => {
    if (entry.name === 'bridge-defaults.json') return false;
    return entry;
  });
  archive.append(`${JSON.stringify(defaults, null, 2)}\n`, { name: 'bridge-defaults.json' });
  archive.finalize().catch(() => null);
}

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
const TEAM_CHAT_SETTINGS_GROUP_ID = callGroupsModule.TEAM_CHAT_SETTINGS_GROUP_ID;
const webContextStorage = new AsyncLocalStorage();
const webUserContexts = new Map();

function buildInitialRuntime() {
  return {
    connected: false,
    currentServer: null,
    currentServerId: null,
    lastError: '',
    latestServerSnapshot: buildServerInfoSnapshot(null, null),
    teamMembers: [],
    teamMessages: [],
  };
}

function withUserContext(ctx, fn) {
  return webContextStorage.run(ctx, fn);
}

function bindUserContext(ctx, fn) {
  return (...args) => webContextStorage.run(ctx, () => fn(...args));
}

function createWebUserContext(user = {}) {
  const userId = String(user?.id || '').trim();
  const email = String(user?.email || '').trim();
  const configDir = getWebUserConfigDir(userId || SERVICE_CONTEXT_ID);
  const store = configStoreModule.createConfigStore({ configDir });
  const rustplusConfigStore = createRustplusConfigStore({
    configFile: getWebUserRustplusConfigFile(userId || SERVICE_CONTEXT_ID),
  });
  const callGroupsService = callGroupsModule.createGroupService({
    getCallControlState: () => callGroupsModule.getCallControlState(),
  });
  const ctx = {
    key: userId || SERVICE_CONTEXT_ID,
    userId,
    email,
    configDir,
    store,
    rustplusConfigStore,
    rustplusConfigFile: rustplusConfigStore.filePath,
    callGroupsService,
    runtime: buildInitialRuntime(),
    rustClient: null,
    eventEngine: null,
    cmdParser: null,
    serverInfoTimer: null,
    fcmStopFn: null,
    teamChatPollTimer: null,
    pairingNoNotificationTimer: null,
    compatibilityWarningShown: false,
    teamCompatibilityCooldownUntil: 0,
    mapCompatibilityCooldownUntil: 0,
    teamChatSeenKeys: new Set(),
    teamChatSeenOrder: [],
    sockets: new Set(),
    dispatchTeamChat: null,
  };
  ctx.dispatchTeamChat = createTeamChatDispatcher({
    normalizeMessage: normalizeTeamMessageText,
    splitMessage: splitTeamMessageText,
    getIntervalMs: () => getGlobalTeamChatIntervalMs(),
    sendMessage: async (message) => {
      if (!ctx.rustClient?.connected) throw new Error('未连接服务器');
      await ctx.rustClient.sendTeamMessage(message);
    },
    onSent: (message) => {
      withUserContext(ctx, () => pushTeamMessage({ name: 'Me', message }));
    },
  });
  return ctx;
}

function ensureWebUserContext(user = {}) {
  const key = String(user?.id || '').trim() || SERVICE_CONTEXT_ID;
  let ctx = webUserContexts.get(key);
  if (!ctx) {
    ctx = createWebUserContext(user);
    webUserContexts.set(key, ctx);
  }
  ctx.userId = String(user?.id || '').trim();
  ctx.email = String(user?.email || '').trim();
  return ctx;
}

function currentContext() {
  return webContextStorage.getStore() || ensureWebUserContext({ id: SERVICE_CONTEXT_ID, email: 'service@local' });
}

const runtime = new Proxy({}, {
  get(_target, prop) {
    return currentContext().runtime[prop];
  },
  set(_target, prop, value) {
    currentContext().runtime[prop] = value;
    return true;
  },
});

const runtimeState = {
  get rustClient() {
    return currentContext().rustClient;
  },
  set rustClient(value) {
    currentContext().rustClient = value;
  },
  get eventEngine() {
    return currentContext().eventEngine;
  },
  set eventEngine(value) {
    currentContext().eventEngine = value;
  },
  get cmdParser() {
    return currentContext().cmdParser;
  },
  set cmdParser(value) {
    currentContext().cmdParser = value;
  },
  get serverInfoTimer() {
    return currentContext().serverInfoTimer;
  },
  set serverInfoTimer(value) {
    currentContext().serverInfoTimer = value;
  },
  get fcmStopFn() {
    return currentContext().fcmStopFn;
  },
  set fcmStopFn(value) {
    currentContext().fcmStopFn = value;
  },
  get pairingNoNotificationTimer() {
    return currentContext().pairingNoNotificationTimer;
  },
  set pairingNoNotificationTimer(value) {
    currentContext().pairingNoNotificationTimer = value;
  },
  get teamChatPollTimer() {
    return currentContext().teamChatPollTimer;
  },
  set teamChatPollTimer(value) {
    currentContext().teamChatPollTimer = value;
  },
  get compatibilityWarningShown() {
    return currentContext().compatibilityWarningShown;
  },
  set compatibilityWarningShown(value) {
    currentContext().compatibilityWarningShown = !!value;
  },
  get teamCompatibilityCooldownUntil() {
    return Number(currentContext().teamCompatibilityCooldownUntil || 0);
  },
  set teamCompatibilityCooldownUntil(value) {
    currentContext().teamCompatibilityCooldownUntil = Number(value || 0);
  },
  get mapCompatibilityCooldownUntil() {
    return Number(currentContext().mapCompatibilityCooldownUntil || 0);
  },
  set mapCompatibilityCooldownUntil(value) {
    currentContext().mapCompatibilityCooldownUntil = Number(value || 0);
  },
  get teamChatSeenKeys() {
    return currentContext().teamChatSeenKeys;
  },
  set teamChatSeenKeys(value) {
    currentContext().teamChatSeenKeys = value instanceof Set ? value : new Set();
  },
  get teamChatSeenOrder() {
    return currentContext().teamChatSeenOrder;
  },
  set teamChatSeenOrder(value) {
    currentContext().teamChatSeenOrder = Array.isArray(value) ? value : [];
  },
};

function getConfigStore() {
  return currentContext().store;
}

function listServers(...args) { return getConfigStore().listServers(...args); }
function saveServer(...args) { return getConfigStore().saveServer(...args); }
function removeServerCascade(...args) { return getConfigStore().removeServerCascade(...args); }
function getLastServerId(...args) { return getConfigStore().getLastServerId(...args); }
function setLastServerId(...args) { return getConfigStore().setLastServerId(...args); }
function getServer(...args) { return getConfigStore().getServer(...args); }
function registerDevice(...args) { return getConfigStore().registerDevice(...args); }
function listDevices(...args) { return getConfigStore().listDevices(...args); }
function updateDevice(...args) { return getConfigStore().updateDevice(...args); }
function removeDevice(...args) { return getConfigStore().removeDevice(...args); }
function listEventRules(...args) { return getConfigStore().listEventRules(...args); }
function saveEventRule(...args) { return getConfigStore().saveEventRule(...args); }
function removeEventRule(...args) { return getConfigStore().removeEventRule(...args); }
function setEventRuleEnabled(...args) { return getConfigStore().setEventRuleEnabled(...args); }
function replaceEventRules(...args) { return getConfigStore().replaceEventRules(...args); }
function listCommandRules(...args) { return getConfigStore().listCommandRules(...args); }
function saveCommandRule(...args) { return getConfigStore().saveCommandRule(...args); }
function removeCommandRule(...args) { return getConfigStore().removeCommandRule(...args); }
function replaceCommandRules(...args) { return getConfigStore().replaceCommandRules(...args); }
function listCallGroupsDb(...args) { return getConfigStore().listCallGroupsDb(...args); }
function saveCallGroupDb(...args) { return getConfigStore().saveCallGroupDb(...args); }
function removeCallGroupDb(...args) { return getConfigStore().removeCallGroupDb(...args); }
function getAiSettings(...args) { return getConfigStore().getAiSettings(...args); }
function updateAiSettings(...args) { return getConfigStore().updateAiSettings(...args); }

function setGroup(...args) { return currentContext().callGroupsService.setGroup(...args); }
function listGroups(...args) { return currentContext().callGroupsService.listGroups(...args); }
function removeGroup(...args) { return currentContext().callGroupsService.removeGroup(...args); }
function callGroup(...args) { return currentContext().callGroupsService.callGroup(...args); }
function getTeamChatIntervalMs(...args) { return currentContext().callGroupsService.getTeamChatIntervalMs(...args); }
function getCallControlState(...args) { return callGroupsModule.getCallControlState(...args); }
function updateCallControlState(...args) { return callGroupsModule.updateCallControlState(...args); }

function getSteamProfileStatus(options = {}) {
  return steamProfileModule.getSteamProfileStatus({
    ...options,
    configFile: options?.configFile || currentContext().rustplusConfigFile,
  });
}

function logoutSteam(options = {}) {
  return steamProfileModule.logoutSteam({
    ...options,
    configFile: options?.configFile || currentContext().rustplusConfigFile,
  });
}

function registerFCM(options = {}) {
  return fcmModule.registerFCM({
    ...options,
    configFile: options?.configFile || currentContext().rustplusConfigFile,
  });
}

setAiSettingsProvider(() => {
  try {
    return getAiSettings();
  } catch (_) {
    return null;
  }
});

function listenForPairing(onPairing, options = {}) {
  const ctx = currentContext();
  return fcmModule.listenForPairing(bindUserContext(ctx, onPairing), {
    ...options,
    configFile: options?.configFile || ctx.rustplusConfigFile,
    onStatus: typeof options?.onStatus === 'function'
      ? bindUserContext(ctx, options.onStatus)
      : undefined,
  });
}

function createRemoteSteamAuthSession(options = {}) {
  return remoteAuthModule.createRemoteSteamAuthSession({
    ...options,
    configFile: options?.configFile || currentContext().rustplusConfigFile,
  });
}

function getRemoteSteamAuthSession(...args) {
  return remoteAuthModule.getRemoteSteamAuthSession(...args);
}

function getRemoteSteamAuthSessionBootstrap(...args) {
  return remoteAuthModule.getRemoteSteamAuthSessionBootstrap(...args);
}

function cancelRemoteSteamAuthSession(...args) {
  return remoteAuthModule.cancelRemoteSteamAuthSession(...args);
}

function updateRemoteSteamAuthSessionPhase(...args) {
  return remoteAuthModule.updateRemoteSteamAuthSessionPhase(...args);
}

function completeRemoteSteamAuthSession(...args) {
  return remoteAuthModule.completeRemoteSteamAuthSession(...args);
}

function dispatchTeamChat(...args) {
  return currentContext().dispatchTeamChat(...args);
}

function parseCookies(raw = '') {
  const out = {};
  String(raw || '')
    .split(';')
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .forEach((entry) => {
      const idx = entry.indexOf('=');
      if (idx <= 0) return;
      const key = entry.slice(0, idx).trim();
      const value = entry.slice(idx + 1).trim();
      out[key] = decodeURIComponent(value);
    });
  return out;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Number(options.maxAge) || 0)}`);
  if (options.secure === true) parts.push('Secure');
  return parts.join('; ');
}

function shouldUseSecureCookie(req) {
  if (req.secure === true) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https';
}

function getRequestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
  const fallback = String(req.ip || req.socket?.remoteAddress || '').trim();
  return forwarded || fallback || 'unknown';
}

function hashRateLimitKey(raw = '') {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex').slice(0, 24);
}

function applyBridgeRateLimit(req, {
  action = 'bridge',
  tokenHint = '',
  ipLimit = 60,
  tokenLimit = 60,
  windowMs = 60_000,
  message = '桥接请求过于频繁，请稍后再试',
} = {}) {
  const remoteIp = getRequestIp(req);
  consumeRateLimit(`bridge:${String(action || 'bridge')}:ip:${remoteIp}`, {
    limit: ipLimit,
    windowMs,
    message,
  });
  const normalizedHint = String(tokenHint || '').trim();
  if (normalizedHint) {
    consumeRateLimit(`bridge:${String(action || 'bridge')}:token:${hashRateLimitKey(normalizedHint)}`, {
      limit: tokenLimit,
      windowMs,
      message,
    });
  }
}

function isAllowedBridgeRequestOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  const requestOrigin = getRequestOrigin(req);
  if (requestOrigin && origin === requestOrigin) return true;
  return BRIDGE_ALLOWED_ORIGIN_SCHEMES.some((scheme) => origin.startsWith(scheme));
}

function validateBridgeRequestOrigin(req, res) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  if (!isAllowedBridgeRequestOrigin(req)) {
    res.status(403).json({ success: false, error: '不受信任的桥接来源' });
    return false;
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', origin);
  return true;
}

function applyPublicAuthRateLimit(req, options = {}) {
  return consumePublicAuthRateLimit({
    ...options,
    ip: getRequestIp(req),
  });
}

function applyUserActionRateLimit(req, {
  action = 'user-action',
  userLimit = 20,
  ipLimit = 40,
  windowMs = 60_000,
  message = '请求过于频繁，请稍后再试',
} = {}) {
  const remoteIp = getRequestIp(req);
  consumeRateLimit(`api:${String(action || 'user-action')}:ip:${remoteIp}`, {
    limit: ipLimit,
    windowMs,
    message,
  });
  const userId = String(req.auth?.user?.id || '').trim();
  if (userId) {
    consumeRateLimit(`api:${String(action || 'user-action')}:user:${userId}`, {
      limit: userLimit,
      windowMs,
      message,
    });
  }
}

function recordSecurityAuditFailure(req, {
  scope = 'auth',
  action = 'unknown',
  identifier = '',
  reason = '',
  threshold = 5,
  windowMs = SECURITY_AUDIT_WINDOW_MS,
  alertCooldownMs = SECURITY_AUDIT_ALERT_COOLDOWN_MS,
} = {}) {
  const remoteIp = getRequestIp(req);
  const identifierHash = normalizeAuditIdentifier(identifier)
    ? hashAuditValue(normalizeAuditIdentifier(identifier))
    : '-';
  const bucketKey = `${scope}:${action}:ip:${remoteIp}:ident:${identifierHash}`;
  const now = Date.now();
  const bucket = securityAuditBuckets.get(bucketKey) || { hits: [], lastAlertAt: 0 };
  bucket.hits = bucket.hits.filter((ts) => now - ts < windowMs);
  bucket.hits.push(now);
  securityAuditBuckets.set(bucketKey, bucket);

  const safeReason = normalizeAuditReason(reason);
  logger.warn(`[SecurityAudit] scope=${scope} action=${action} ip=${remoteIp} ident=${identifierHash} count=${bucket.hits.length} reason=${safeReason}`);
  if (bucket.hits.length >= Math.max(1, Number(threshold) || 1) && now - Number(bucket.lastAlertAt || 0) >= alertCooldownMs) {
    bucket.lastAlertAt = now;
    logger.error(`[SecurityAlert] scope=${scope} action=${action} ip=${remoteIp} ident=${identifierHash} count=${bucket.hits.length} windowMs=${windowMs} reason=${safeReason}`);
  }
}

function auditRouteFailure(req, {
  scope = 'auth',
  action = 'unknown',
  identifier = '',
  err,
  threshold = 5,
  windowMs,
  alertCooldownMs,
} = {}) {
  recordSecurityAuditFailure(req, {
    scope,
    action,
    identifier,
    reason: err?.message || err || 'unknown',
    threshold,
    windowMs,
    alertCooldownMs,
  });
}

function matchesSameOriginUrl(rawUrl = '', expectedOrigin = '') {
  const input = String(rawUrl || '').trim();
  if (!input) return false;
  try {
    return new URL(input).origin === expectedOrigin;
  } catch (_) {
    return false;
  }
}

function ensureTrustedWriteRequest(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase())) return next();
  if (req.auth?.viaApiToken) return next();
  const expectedOrigin = getRequestOrigin(req);
  const origin = String(req.headers.origin || '').trim();
  const referer = String(req.headers.referer || '').trim();
  if (origin && expectedOrigin && origin !== expectedOrigin) {
    recordSecurityAuditFailure(req, {
      scope: 'request',
      action: 'cross-origin-write',
      identifier: req.path,
      reason: `origin=${origin}`,
      threshold: 3,
      windowMs: 5 * 60_000,
      alertCooldownMs: 5 * 60_000,
    });
    return res.status(403).json({ error: '不受信任的请求来源' });
  }
  if (!origin && referer && expectedOrigin && !matchesSameOriginUrl(referer, expectedOrigin)) {
    recordSecurityAuditFailure(req, {
      scope: 'request',
      action: 'cross-origin-write',
      identifier: req.path,
      reason: `referer=${referer}`,
      threshold: 3,
      windowMs: 5 * 60_000,
      alertCooldownMs: 5 * 60_000,
    });
    return res.status(403).json({ error: '不受信任的请求来源' });
  }
  return next();
}

function authResponseStatus(err) {
  return err instanceof AuthRateLimitError ? 429 : 400;
}

function writeResponseStatus(err) {
  return err instanceof AuthRateLimitError || err instanceof RateLimitError ? 429 : 400;
}

async function hydrateAuthContext(req, _res, next) {
  req.auth = {
    viaApiToken: false,
    sessionToken: '',
    user: null,
  };
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const headerToken = String(req.headers['x-api-token'] || '').trim();
  if (API_TOKEN && (bearer === API_TOKEN || headerToken === API_TOKEN)) {
    req.auth.viaApiToken = true;
  }
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionToken = String(cookies[WEB_SESSION_COOKIE] || '').trim();
  req.auth.sessionToken = sessionToken;
  if (!sessionToken) return next();
  req.auth.user = (await getPublicSession(sessionToken).catch(() => null))?.user || null;
  return next();
}

function isAuthed(req) {
  if (req.auth?.viaApiToken) return true;
  if (req.auth?.user) return true;
  return !REQUIRE_API_TOKEN;
}

function isRootAuthed(req) {
  return String(req.auth?.user?.role || '') === 'root';
}

function ensureAuth(req, res, next) {
  if (isAuthed(req)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function ensureUserAuth(req, res, next) {
  if (req.auth?.user) return next();
  return res.status(401).json({ error: '需要先登录账号' });
}

function ensureRoot(req, res, next) {
  if (isRootAuthed(req)) return next();
  return res.status(403).json({ error: '需要 root 权限' });
}

function ensurePageAuth(req, res, next) {
  if (req.auth?.user) return next();
  return res.redirect('/auth');
}

function parseWebSocketAuthToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionToken = String(cookies[WEB_SESSION_COOKIE] || '').trim();
  if (sessionToken) return sessionToken;
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

function setAuthSessionCookie(req, res, token, maxAgeMs) {
  res.setHeader('Set-Cookie', serializeCookie(WEB_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: shouldUseSecureCookie(req),
    maxAge: Math.floor((Number(maxAgeMs) || 0) / 1000),
    path: '/',
  }));
}

function clearAuthSessionCookie(req, res) {
  res.setHeader('Set-Cookie', serializeCookie(WEB_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'Strict',
    secure: shouldUseSecureCookie(req),
    maxAge: 0,
    path: '/',
  }));
}

function normalizeTeamMessageText(raw) {
  return String(raw || '').trim();
}

function splitTeamMessageText(raw) {
  const text = normalizeTeamMessageText(raw);
  if (!text) return [];
  const limit = Math.max(1, TEAM_CHAT_MAX_CHARS);
  const lines = text.split(/\r?\n+/).map((line) => String(line || '').trim()).filter(Boolean);
  if (!lines.length) return [];
  const chunks = [];
  for (const line of lines) {
    const chars = Array.from(line);
    if (!chars.length) continue;
    for (let start = 0; start < chars.length; start += limit) {
      const part = chars.slice(start, start + limit).join('').trim();
      if (part) chunks.push(part);
    }
  }
  return chunks;
}

function sendWs(type, payload = {}) {
  const message = JSON.stringify({ type, payload, at: Date.now() });
  for (const socket of currentContext().sockets) {
    if (socket.readyState === socket.OPEN) socket.send(message);
  }
}

function clearInfoTimer() {
  if (runtimeState.serverInfoTimer) {
    clearInterval(runtimeState.serverInfoTimer);
    runtimeState.serverInfoTimer = null;
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

function normalizeTeamChatMessage(msg = {}) {
  if (typeof msg === 'string') {
    return { steamId: '', time: 0, name: '', message: String(msg) };
  }
  const root = (msg && typeof msg === 'object') ? msg : {};
  const inner = (root.message && typeof root.message === 'object') ? root.message : null;
  const source = inner || root;
  const text = inner
    ? source?.message ?? source?.text ?? source?.content ?? ''
    : root?.message ?? root?.text ?? root?.content ?? '';
  const rawTime = Number(source?.time ?? source?.timestamp ?? root?.time ?? root?.timestamp ?? 0);
  return {
    steamId: String(source?.steamId ?? source?.steamID ?? root?.steamId ?? root?.steamID ?? ''),
    time: Number.isFinite(rawTime) ? rawTime : 0,
    name: String(source?.name ?? source?.displayName ?? root?.name ?? root?.displayName ?? ''),
    message: String(text ?? ''),
  };
}

function buildTeamChatSeenKey(msg = {}) {
  const normalized = normalizeTeamChatMessage(msg);
  if (!normalized.message) return '';
  if (!normalized.time || !Number.isFinite(normalized.time)) return '';
  return `${normalized.steamId}|${normalized.time}|${normalized.name}|${normalized.message}`;
}

function rememberTeamChatKey(key) {
  if (!key || runtimeState.teamChatSeenKeys.has(key)) return false;
  runtimeState.teamChatSeenKeys.add(key);
  runtimeState.teamChatSeenOrder.push(key);
  if (runtimeState.teamChatSeenOrder.length > 500) {
    const old = runtimeState.teamChatSeenOrder.shift();
    if (old) runtimeState.teamChatSeenKeys.delete(old);
  }
  return true;
}

async function ingestTeamChatMessage(msg) {
  pushTeamMessage(msg);
  if (runtimeState.cmdParser?.ingestTeamMessage) {
    try {
      await runtimeState.cmdParser.ingestTeamMessage(msg);
    } catch (err) {
      logger.debug('[WebConnect] 轮询队聊注入指令解析失败: ' + err.message);
    }
  }
}

async function bootstrapTeamChatCache() {
  if (!runtimeState.rustClient?.connected) return;
  try {
    const chat = await runtimeState.rustClient.getTeamChat();
    const list = chat?.teamChat?.messages || [];
    for (const msg of list) {
      const key = buildTeamChatSeenKey(msg);
      if (key) rememberTeamChatKey(key);
    }
  } catch (_) {
    // ignore
  }
}

function stopTeamChatPolling() {
  if (runtimeState.teamChatPollTimer) {
    clearInterval(runtimeState.teamChatPollTimer);
    runtimeState.teamChatPollTimer = null;
  }
}

function startTeamChatPolling() {
  stopTeamChatPolling();
  runtimeState.teamChatPollTimer = setInterval(bindUserContext(currentContext(), async () => {
    if (!runtimeState.rustClient?.connected) return;
    try {
      const chat = await runtimeState.rustClient.getTeamChat();
      const list = chat?.teamChat?.messages || [];
      sendWs('team:sync-status', {
        mode: runtimeState.compatibilityWarningShown ? 'compatibility' : 'polling',
        lastPollAt: Date.now(),
      });
      for (const msg of list) {
        const key = buildTeamChatSeenKey(msg);
        if (key && !rememberTeamChatKey(key)) continue;
        await ingestTeamChatMessage(msg);
      }
    } catch (_) {
      // ignore; do not spam logs on servers that limit getTeamChat
    }
  }), getGlobalTeamChatIntervalMs());
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
  if (!runtimeState.rustClient?.connected) return runtime.latestServerSnapshot;
  try {
    const [serverRes, timeRes] = await Promise.all([
      runtimeState.rustClient.getServerInfo(),
      runtimeState.rustClient.getTime().catch(() => null),
    ]);
    runtime.latestServerSnapshot = buildServerInfoSnapshot(serverRes, timeRes);
    sendWs('server:info', runtime.latestServerSnapshot);
  } catch (err) {
    runtime.lastError = String(err?.message || err || '刷新服务器状态失败');
    if (!isNonFatalRustProtocolError(runtime.lastError)) {
      sendWs('runtime:error', { message: runtime.lastError });
    }
  }
  return runtime.latestServerSnapshot;
}

async function refreshTeamMembers() {
  if (!runtimeState.rustClient?.connected) return [];
  if (runtimeState.teamCompatibilityCooldownUntil > Date.now()) {
    sendWs('team:members', runtime.teamMembers);
    return runtime.teamMembers;
  }
  try {
    const teamRes = await runtimeState.rustClient.getTeamInfo();
    runtime.teamMembers = extractTeamMembers(teamRes);
    sendWs('team:members', runtime.teamMembers);
  } catch (err) {
    runtime.lastError = String(err?.message || err || '刷新队伍失败');
    if (isNonFatalRustProtocolError(runtime.lastError)) {
      markCompatibilityCooldown('team', runtime.lastError);
      sendWs('team:members', runtime.teamMembers);
      return runtime.teamMembers;
    }
    if (!isNonFatalRustProtocolError(runtime.lastError)) {
      sendWs('runtime:error', { message: runtime.lastError });
    }
  }
  return runtime.teamMembers;
}

function isNonFatalRustProtocolError(message = '') {
  return isRustProtocolCompatibilityError(message);
}

function markCompatibilityCooldown(kind, reason = '') {
  const until = Date.now() + 30_000;
  if (kind === 'team') runtimeState.teamCompatibilityCooldownUntil = until;
  if (kind === 'map') runtimeState.mapCompatibilityCooldownUntil = until;
  if (reason) logger.warn(`[WebConnect] ${kind} 接口进入兼容降级窗口: ${reason}`);
}

function bindClientEvents(client, serverConfig) {
  const ctx = currentContext();
  client.on('connected', bindUserContext(ctx, async () => {
    runtime.connected = true;
    runtime.currentServer = serverConfig;
    runtime.currentServerId = serverConfig.id;
    runtime.lastError = '';
    runtimeState.teamCompatibilityCooldownUntil = 0;
    runtimeState.mapCompatibilityCooldownUntil = 0;
    sendWs('server:status', {
      connected: true,
      currentServer: runtime.currentServer,
      currentServerId: runtime.currentServerId,
    });
    await Promise.all([refreshServerSnapshot(), refreshTeamMembers(), bootstrapTeamChatCache()]);
    startTeamChatPolling();
    clearInfoTimer();
    runtimeState.serverInfoTimer = setInterval(bindUserContext(ctx, () => {
      refreshServerSnapshot();
    }), 20_000);
  }));

  client.on('disconnected', bindUserContext(ctx, () => {
    runtime.connected = false;
    runtime.teamMembers = [];
    runtimeState.teamCompatibilityCooldownUntil = 0;
    runtimeState.mapCompatibilityCooldownUntil = 0;
    runtimeState.teamChatSeenKeys = new Set();
    runtimeState.teamChatSeenOrder = [];
    stopTeamChatPolling();
    clearInfoTimer();
    sendWs('server:status', {
      connected: false,
      currentServer: runtime.currentServer,
      currentServerId: runtime.currentServerId,
    });
    sendWs('team:members', runtime.teamMembers);
  }));

  client.on('teamChanged', bindUserContext(ctx, (data) => {
    if (runtimeState.eventEngine?.ingestTeamSnapshot) {
      try {
        runtimeState.eventEngine.ingestTeamSnapshot(data?.teamInfo ? data.teamInfo : data);
      } catch (_) {}
    }
    sendWs('team:changed', data || {});
    refreshTeamMembers();
  }));

  client.on('teamMessage', bindUserContext(ctx, (data) => {
    const key = buildTeamChatSeenKey(data);
    if (key && !rememberTeamChatKey(key)) return;
    ingestTeamChatMessage(data).catch(() => null);
  }));

  client.on('error', bindUserContext(ctx, (error) => {
    runtime.lastError = normalizeErrorText(error) || '连接异常';
    const lower = runtime.lastError.toLowerCase();
    if (isNonFatalRustProtocolError(runtime.lastError)) {
      if (!runtimeState.compatibilityWarningShown) {
        runtimeState.compatibilityWarningShown = true;
        sendWs('notification', {
          type: 'warning',
          title: '服务器兼容性受限',
          message: getRustProtocolCompatibilityMessage(),
        });
      }
      logger.warn('[WebConnect] 已忽略非致命协议错误: ' + runtime.lastError);
      return;
    }
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
  }));
}

async function disconnectActiveClient() {
  clearInfoTimer();
  stopTeamChatPolling();
  runtimeState.eventEngine?.unbind?.();
  runtimeState.eventEngine = null;
  runtimeState.cmdParser = null;
  if (!runtimeState.rustClient) {
    runtime.connected = false;
    runtime.teamMembers = [];
    runtimeState.teamChatSeenKeys = new Set();
    runtimeState.teamChatSeenOrder = [];
    return;
  }
  try {
    runtimeState.rustClient.disconnect();
  } catch (err) {
    logger.warn('[Web] disconnect 失败: ' + err.message);
  } finally {
    runtimeState.rustClient = null;
    runtime.connected = false;
    runtime.teamMembers = [];
    runtimeState.teamChatSeenKeys = new Set();
    runtimeState.teamChatSeenOrder = [];
  }
}

async function probeConnectedServer({ timeoutMs = 10_000 } = {}) {
  if (!runtimeState.rustClient?.connected) {
    throw new Error('服务器连接尚未建立');
  }

  const withTimeout = (promise, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), timeoutMs)),
  ]);

  const probes = [
    { label: 'server_info', run: () => runtimeState.rustClient.getServerInfo() },
    { label: 'server_time', run: () => runtimeState.rustClient.getTime() },
  ];

  const failures = [];
  for (const probe of probes) {
    try {
      await withTimeout(probe.run(), `${probe.label}_timeout`);
      return true;
    } catch (err) {
      failures.push(String(err?.message || err || probe.label));
    }
  }

  throw new Error(`服务器已建立连接但未返回可用数据：${failures.join(' | ')}`);
}

async function shutdownWebUserContext(userId, options = {}) {
  const key = String(userId || '').trim();
  if (!key || key === SERVICE_CONTEXT_ID) return false;
  const ctx = webUserContexts.get(key);
  if (ctx) {
    try {
      await withUserContext(ctx, async () => {
        await stopPairingFlow().catch(() => null);
        await disconnectActiveClient().catch(() => null);
        runtime.connected = false;
        runtime.currentServer = null;
        runtime.currentServerId = null;
        runtime.lastError = '';
        runtime.latestServerSnapshot = buildServerInfoSnapshot(null, null);
        runtime.teamMembers = [];
        runtime.teamMessages = [];
      });
    } finally {
      for (const socket of [...ctx.sockets]) {
        try {
          if (options.terminateSockets !== false && typeof socket.close === 'function') {
            socket.close(4001, 'account_state_changed');
          }
        } catch (_) {}
        try {
          if (options.terminateSockets !== false && typeof socket.terminate === 'function') {
            socket.terminate();
          }
        } catch (_) {}
      }
      ctx.sockets.clear();
      webUserContexts.delete(key);
    }
  }

  if (options.clearRustplusConfig === true) {
    await clearWebUserRustplusConfig(key).catch(() => null);
  }
  if (options.purgeWorkspace === true) {
    await removeWebUserWorkspace(key).catch(() => null);
  }
  return true;
}

async function connectServerById(serverId) {
  const target = await getServer(serverId);
  if (!target) throw new Error('服务器不存在');

  if (runtime.currentServerId && String(runtime.currentServerId) === String(target.id) && runtimeState.rustClient?.connected) {
    return target;
  }

  await disconnectActiveClient();

  runtimeState.rustClient = new RustClient(target);
  runtimeState.compatibilityWarningShown = false;
  runtime.currentServer = target;
  runtime.currentServerId = target.id;
  bindClientEvents(runtimeState.rustClient, target);

  try {
    await runtimeState.rustClient.connect();
    await probeConnectedServer();
    await bootstrapRuntimeForConnectedServer(target);
    await setLastServerId(target.id);
    return target;
  } catch (err) {
    const message = String(err?.message || err || '连接失败');
    logger.warn('[WebConnect] 连接验证失败: ' + message);
    await disconnectActiveClient().catch(() => null);
    runtime.currentServer = null;
    runtime.currentServerId = null;
    runtime.connected = false;
    runtime.latestServerSnapshot = buildServerInfoSnapshot(null, null);
    runtime.lastError = message;
    sendWs('server:status', { connected: false, currentServer: null, currentServerId: null });
    throw new Error(message);
  }
}

function bootstrapPayload(servers = [], steam = null, currentUser = null) {
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
    currentUser,
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
  const command = runtimeState.cmdParser?.getCommand(keyword, { includeDeleted: true });
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
  if (!serverId || !runtimeState.cmdParser) return [];
  const persisted = await listCommandRules(serverId);
  if (persisted.length) return persisted;
  const preset = getCommandPreset('command_system_default');
  if (!preset?.commandRules?.length) return [];
  runtimeState.cmdParser.restoreBuiltinCommands?.();
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
    runtimeState.cmdParser.setCommandRule(normalized);
    const saved = await saveCommandRule({ ...normalized, deleted: false });
    applied.push(saved);
  }
  return applied;
}

function buildSystemCommandRulesFromParser(serverId) {
  if (!runtimeState.cmdParser) return [];
  return runtimeState.cmdParser.getCommands()
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
    mapSize: () => Number(runtime.latestServerSnapshot?.mapSize || 0),
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
      if (!runtimeState.rustClient?.connected) return;
      await dispatchTeamChat(message);
    },
    toggleSwitch: async ({ entityId, state }) => {
      if (!runtimeState.rustClient?.connected) return;
      if (state) await runtimeState.rustClient.turnSwitchOn(entityId);
      else await runtimeState.rustClient.turnSwitchOff(entityId);
    },
    callGroup: async (groupId, message, options = {}) => {
      await callGroup(groupId, message, options);
    },
  };
}

async function bootstrapRuntimeForConnectedServer(serverConfig) {
  const ctx = currentContext();
  runtimeState.eventEngine?.unbind?.();
  runtimeState.eventEngine = new EventEngine({
    onRuleEnabledChanged: ({ ruleId, enabled, reason, onlineCount, threshold }) => {
      sendWs('rule:auto-toggled', { ruleId, enabled, reason, onlineCount, threshold });
    },
    bindContext: (fn) => bindUserContext(ctx, fn),
    getDeepSeaState: () => getConfigStore().getDeepSeaState(),
    saveDeepSeaState: (patch) => getConfigStore().saveDeepSeaState(patch),
  });
  runtimeState.cmdParser = new CommandParser({
    leaderId: serverConfig.playerId,
    bindContext: (fn) => bindUserContext(ctx, fn),
    callGroupRunner: (groupId, message, options = {}) => callGroup(groupId, message, options),
    notifyDesktopRunner: ({ title, message }) => {
      notify('desktop', { title, message });
      sendWs('notification', { type: 'info', title, message });
    },
    notifyDiscordRunner: ({ title, message }) => {
      notify('discord', { title, message });
    },
    teamChatRunner: async (message) => {
      if (!runtimeState.rustClient?.connected) return;
      await dispatchTeamChat(message);
    },
    deepSeaStateGetter: () => getConfigStore().getDeepSeaState(),
  });

  runtimeState.eventEngine.bind(runtimeState.rustClient);
  runtimeState.cmdParser.bind(runtimeState.rustClient);

  const boundDevices = await listDevices(serverConfig.id);
  await ensureRuntimeDeviceBroadcastSubscriptions(serverConfig.id, 'startup');
  for (const device of boundDevices) {
    if (String(device?.type || '').toLowerCase() === 'switch') {
      runtimeState.cmdParser.registerSwitch(device.entityId, device.alias);
    }
  }

  const persistedCommands = await listCommandRules(serverConfig.id);
  await applyPersistedCommandRules({
    parser: runtimeState.cmdParser,
    persistedRules: persistedCommands,
    removeRule: async (keyword) => removeCommandRule(keyword, serverConfig.id),
  });
  if (!(await listCommandRules(serverConfig.id)).length) {
    await ensureDefaultCommandRules(serverConfig.id);
  }

  const persistedRules = await listEventRules(serverConfig.id);
  let safeRules = await listEventRules(serverConfig.id);
  if (!safeRules.length) {
    const preset = getEventPreset('event_system_default');
    for (const rule of preset?.eventRules || []) {
      const normalized = normalizeEventRuleForServer(rule, serverConfig.id);
      await saveEventRule(normalized);
    }
    safeRules = await listEventRules(serverConfig.id);
  }
  const actionDeps = createRuleActionDeps();
  for (const rule of safeRules) {
    runtimeState.eventEngine.addRule(hydrateRule(rule, actionDeps));
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
  if (!runtimeState.rustClient?.connected) return { success: false, error: '未连接服务器' };
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

async function subscribeRuntimeEntityBroadcast(entityId, source = 'manual') {
  if (!runtimeState.rustClient?.connected) return false;
  const id = Number(entityId);
  if (!Number.isFinite(id)) return false;
  try {
    await runtimeState.rustClient.getEntityInfo(id);
    return true;
  } catch (err) {
    logger.debug(`[Web] 订阅设备广播失败(${source}) entityId=${id}: ${err?.message || err}`);
    return false;
  }
}

const subscribeRuntimeEntityBroadcastWithRetry = (entityId, source = 'manual', options = {}) =>
  withRetry(subscribeRuntimeEntityBroadcast, entityId, source, options);

async function ensureRuntimeDeviceBroadcastSubscriptions(serverId, source = 'startup') {
  if (!runtimeState.rustClient?.connected) return;
  await ensureAll(listDevices, subscribeRuntimeEntityBroadcast, serverId, source, logger);
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
  const ctx = currentContext();
  return new Promise(async (resolve) => {
    if (runtimeState.fcmStopFn) runtimeState.fcmStopFn();
    if (runtimeState.pairingNoNotificationTimer) {
      clearTimeout(runtimeState.pairingNoNotificationTimer);
      runtimeState.pairingNoNotificationTimer = null;
    }

    let resolved = false;
    try {
      await registerFCM({ force: !!options?.forceRegister });
    } catch (err) {
      resolve({ success: false, error: `FCM 注册失败: ${err.message}` });
      return;
    }

    try {
      runtimeState.fcmStopFn = listenForPairing(async (data) => {
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

        if (tokenChanged && runtimeState.rustClient?.connected && server?.id) {
          const sameServer = String(runtimeState.rustClient.config?.ip) === String(server.ip)
            && String(runtimeState.rustClient.config?.port) === String(server.port)
            && String(runtimeState.rustClient.config?.playerId) === String(server.playerId);
          if (sameServer) {
            connectServerById(server.id).catch((err) => logger.warn('[WebPairing] token 刷新重连失败: ' + err.message));
          }
        }

        if (serverPayload) {
          if (server?.id) {
            const sameAsCurrent = !!(runtimeState.rustClient?.connected
              && String(runtimeState.rustClient.config?.ip) === String(server.ip)
              && String(runtimeState.rustClient.config?.port) === String(server.port)
              && String(runtimeState.rustClient.config?.playerId) === String(server.playerId));
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
          if (status?.type === 'notification-received' && runtimeState.pairingNoNotificationTimer) {
            clearTimeout(runtimeState.pairingNoNotificationTimer);
            runtimeState.pairingNoNotificationTimer = null;
          }
        },
      });

      runtimeState.pairingNoNotificationTimer = setTimeout(bindUserContext(ctx, () => {
        sendWs('pairing:listener-status', {
          type: 'idle-timeout',
          message: '监听已启动但长时间未收到任何通知，可能是推送凭据失效或未触发新的游戏内配对请求',
        });
      }), 60_000);

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
  runtimeState.fcmStopFn?.();
  runtimeState.fcmStopFn = null;
  if (runtimeState.pairingNoNotificationTimer) {
    clearTimeout(runtimeState.pairingNoNotificationTimer);
    runtimeState.pairingNoNotificationTimer = null;
  }
  return { success: true };
}

async function diagnosePairing() {
  const steam = await getSteamProfileStatus({ fetchRemote: false }).catch(() => null);
  const cfgFile = currentContext().rustplusConfigFile;
  const logFile = path.join(path.dirname(cfgFile), 'fcm-listen-last.log');
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
    listenerRunning: !!runtimeState.fcmStopFn,
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
    const connected = !!runtimeState.rustClient?.connected;
    const currentServer = connected
      ? (servers.find((s) => String(s.id) === String(runtime.currentServerId)) || runtime.currentServer || null)
      : null;
    return {
      version: VERSION,
      servers,
      devices: connected && currentServer?.id ? await listDevices(currentServer.id) : [],
      groups: listGroups(),
      aiSettings: maskAiSettingsForDisplay(await getAiSettings()),
      connected,
      currentServer,
      currentServerId: connected ? String(runtime.currentServerId || currentServer?.id || '') : '',
      serverInfo: runtime.latestServerSnapshot,
      teamMembers: Array.isArray(runtime.teamMembers) ? runtime.teamMembers : [],
      teamMessages: Array.isArray(runtime.teamMessages) ? runtime.teamMessages : [],
      lastError: runtime.lastError || '',
      steam: await getSteamProfileStatus({ fetchRemote: false }),
    };
  },

  'steam:status': async () => getSteamProfileStatus({ fetchRemote: true }),
  'settings:ai:get': async () => maskAiSettingsForDisplay(await getAiSettings()),
  'settings:ai:set': async (args) => {
    try {
      const next = await updateAiSettings(args[0] || {});
      return { success: true, settings: maskAiSettingsForDisplay(next) };
    } catch (err) {
      return { success: false, error: err?.message || '保存 AI 设置失败' };
    }
  },
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
    if (currentContext().userId) {
      await setUserSteamBinding(currentContext().userId, null).catch(() => null);
      await shutdownWebUserContext(currentContext().userId, {
        terminateSockets: false,
        clearRustplusConfig: true,
      }).catch(() => null);
    }
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
    if (!runtimeState.rustClient?.connected) return null;
    try {
      const result = await runtimeState.rustClient.getServerInfo();
      if (result && !result.error) {
        const timeInfo = await runtimeState.rustClient.getTime().catch(() => null);
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
    if (!runtimeState.rustClient?.connected) return null;
    if (runtimeState.teamCompatibilityCooldownUntil > Date.now()) {
      return { members: runtime.teamMembers, degraded: true };
    }
    try {
      return await runtimeState.rustClient.getTeamInfo();
    } catch (err) {
      if (isNonFatalRustProtocolError(err?.message || err)) {
        markCompatibilityCooldown('team', err?.message || err);
        return { members: runtime.teamMembers, degraded: true };
      }
      if (String(err?.message || '').toLowerCase() === 'not_found') return null;
      return { error: err.message };
    }
  },
  'server:getTeamChat': async () => {
    if (!runtimeState.rustClient?.connected) return null;
    try {
      return await runtimeState.rustClient.getTeamChat();
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
    if (!runtimeState.rustClient?.connected) return { error: 'not_connected' };
    try {
      const [mapRes, serverRes] = await Promise.all([
        runtimeState.rustClient.getMap(),
        runtimeState.rustClient.getServerInfo().catch(() => null),
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
    if (!runtimeState.rustClient?.connected) return { error: 'not_connected' };
    if (runtimeState.mapCompatibilityCooldownUntil > Date.now()) {
      return { markers: [], degraded: true };
    }
    try {
      return await runtimeState.rustClient.getMapMarkers();
    } catch (err) {
      if (isNonFatalRustProtocolError(err?.message || err)) {
        markCompatibilityCooldown('map', err?.message || err);
        return { markers: [], degraded: true };
      }
      return { error: err.message };
    }
  },
  'server:getHealth': async () => {
    if (!runtimeState.rustClient) return { connected: false, reason: 'client_not_initialized' };
    return runtimeState.rustClient.getHealthStatus();
  },

  'pairing:start': async (args) => startPairingFlow(args[0] || {}),
  'pairing:stop': async () => stopPairingFlow(),
  'pairing:diagnose': async () => diagnosePairing(),

  'device:list': async (args) => listDevices(args[0]),
  'device:register': async (args) => {
    const opts = args[0] || {};
    await registerDevice(opts);
    if (runtimeState.cmdParser && runtimeState.rustClient?.connected && String(opts?.serverId || '') === String(runtime.currentServerId || '')) {
      await subscribeRuntimeEntityBroadcastWithRetry(opts?.entityId, 'device-register');
      const t = String(opts?.type || '').toLowerCase();
      if (t === 'switch') runtimeState.cmdParser.registerSwitch(opts.entityId, opts.alias);
    }
    return { success: true };
  },
  'device:update': async (args) => {
    const payload = args[0] || {};
    const updated = await updateDevice(payload.entityId, payload.updates || {}, runtime.currentServerId || null);
    if (updated && runtimeState.cmdParser) {
      await subscribeRuntimeEntityBroadcastWithRetry(updated.entityId, 'device-update');
      const t = String(updated?.type || '').toLowerCase();
      if (t === 'switch') runtimeState.cmdParser.registerSwitch(updated.entityId, updated.alias);
      else runtimeState.cmdParser.unregisterSwitch(updated.entityId);
    }
    return { success: !!updated, device: updated };
  },
  'device:remove': async (args) => {
    const success = await removeDevice(args[0], runtime.currentServerId || null);
    if (success && runtimeState.cmdParser) runtimeState.cmdParser.unregisterSwitch(args[0]);
    return { success };
  },
  'device:getInfo': async (args) => {
    if (!runtimeState.rustClient?.connected) return { error: '未连接' };
    try {
      return await runtimeState.rustClient.getEntityInfo(args[0]);
    } catch (err) {
      const msg = String(err?.message || '未知错误');
      if (msg.toLowerCase() === 'not_found') return { error: '设备不存在或未配对到当前服务器' };
      return { error: msg };
    }
  },
  'device:switch': async (args) => {
    if (!runtimeState.rustClient?.connected) return { error: '未连接' };
    const payload = args[0] || {};
    try {
      return payload.state
        ? await runtimeState.rustClient.turnSwitchOn(payload.entityId)
        : await runtimeState.rustClient.turnSwitchOff(payload.entityId);
    } catch (err) {
      const msg = String(err?.message || '未知错误');
      if (msg.toLowerCase() === 'not_found') return { error: '开关设备未找到（可能已失效或不在当前服务器）' };
      return { error: msg };
    }
  },

  'rules:list': async () => {
    if (!runtimeState.rustClient?.connected || !runtime.currentServerId) return [];
    const rules = await listEventRules(runtime.currentServerId);
    return rules.map(serializeRule);
  },
  'rules:add': async (args) => {
    if (!runtimeState.rustClient?.connected || !runtime.currentServerId) {
      return { success: false, error: '未连接服务器，无法新增事件规则' };
    }
    const normalized = normalizeEventRuleForServer(args[0] || {}, runtime.currentServerId);
    runtimeState.eventEngine?.addRule(hydrateRule(normalized, createRuleActionDeps()));
    const saved = await saveEventRule(normalized);
    return { success: true, rule: serializeRule(hydrateRule(saved, createRuleActionDeps())) };
  },
  'rules:remove': async (args) => {
    if (!runtime.currentServerId) return { success: false, error: '未连接服务器' };
    const id = String(args[0] || '').trim();
    if (!id) return { success: false, error: '缺少规则ID' };
    const rule = (await listEventRules(runtime.currentServerId)).find((r) => String(r.id) === id);
    if (!rule) return { success: false, error: '规则不存在或不属于当前服务器' };
    runtimeState.eventEngine?.removeRule(id);
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
    runtimeState.eventEngine?.setRuleEnabled(ruleId, enabled);
    const ok = await setEventRuleEnabled(ruleId, enabled, runtime.currentServerId);
    if (!ok) return { success: false, error: '规则不存在或不属于当前服务器' };
    return { success: true };
  },

  'commands:list': async () => {
    if (!runtimeState.rustClient?.connected || !runtime.currentServerId) return [];
    if (runtimeState.cmdParser) return runtimeState.cmdParser.getCommands();
    const persisted = await listCommandRules(runtime.currentServerId);
    return persisted.map(normalizeCommandListRecord);
  },
  'commands:toggle': async (args) => {
    if (!runtimeState.cmdParser || !runtime.currentServerId) return { success: false, error: '未连接服务器或指令不存在' };
    const payload = args[0] || {};
    const key = String(payload.keyword || '').toLowerCase().trim();
    if (!key) return { success: false, error: '缺少指令关键词' };
    const ok = runtimeState.cmdParser.setCommandEnabled(key, payload.enabled);
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
    if (!runtimeState.cmdParser?.setCommandRule(payload)) {
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
    const current = runtimeState.cmdParser?.getCommand(key, { includeDeleted: true });
    if (!current) return { success: false, error: '指令不存在' };
    runtimeState.cmdParser?.removeCommandRule(key);
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
    if (!runtime.currentServerId || !runtimeState.rustClient?.connected) {
      return { success: false, error: '未连接服务器，无法应用预设' };
    }

    if (presetType === 'events') {
      const preset = getEventPreset(presetId);
      if (!preset) return { success: false, error: '事件预设不存在' };
      const nextRules = [];
      if (shouldReplace) {
        const existing = await listEventRules(runtime.currentServerId);
        for (const rule of existing) {
          runtimeState.eventEngine?.removeRule(rule.id);
        }
      }
      for (const rule of preset.eventRules || []) {
        const normalized = normalizeEventRuleForServer({
          ...rule,
          trigger: { ...(rule.trigger || {}), cooldownMs: getGlobalTeamChatIntervalMs() },
        }, runtime.currentServerId);
        runtimeState.eventEngine?.addRule(hydrateRule(normalized, createRuleActionDeps()));
        nextRules.push(normalized);
      }
      if (shouldReplace) {
        await replaceEventRules(runtime.currentServerId, nextRules);
      } else {
        await Promise.all(nextRules.map((rule) => saveEventRule(rule)));
      }
      return { success: true, applied: (preset.eventRules || []).length };
    }

    if (presetType === 'commands') {
      const preset = getCommandPreset(presetId);
      if (!preset) return { success: false, error: '指令预设不存在' };
      if (shouldReplace) {
        await replaceCommandRules(runtime.currentServerId, []);
        if (runtimeState.cmdParser) {
          runtimeState.cmdParser.restoreBuiltinCommands?.();
          for (const command of runtimeState.cmdParser.getCommands()) {
            if (command.isBuiltin) runtimeState.cmdParser.setCommandEnabled(command.keyword, false);
            else runtimeState.cmdParser.removeCommandRule(command.keyword);
          }
        }
      }
      const rulesToApply = buildSystemCommandRulesFromParser(runtime.currentServerId);
      const nextRules = [];
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
        if (runtimeState.cmdParser) {
          if (normalized.type || normalized.name || normalized.meta) runtimeState.cmdParser.setCommandRule(normalized);
          else runtimeState.cmdParser.setCommandEnabled(normalized.keyword, normalized.enabled !== false);
        }
        nextRules.push({ ...normalized, deleted: false });
      }
      if (shouldReplace) {
        await replaceCommandRules(runtime.currentServerId, nextRules);
      } else {
        await Promise.all(nextRules.map((rule) => saveCommandRule(rule)));
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
app.use(express.json({ limit: '1mb' }));
app.use(hydrateAuthContext);
app.use((req, _res, next) => {
  const scopedUser = req.auth?.user || (req.auth?.viaApiToken ? { id: SERVICE_CONTEXT_ID, email: 'service@local' } : null);
  if (!scopedUser) return next();
  return withUserContext(ensureWebUserContext(scopedUser), () => next());
});
app.use((_, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', ensureTrustedWriteRequest);

app.use('/steam-bridge', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    if (!validateBridgeRequestOrigin(req, res)) return;
    res.status(204).end();
    return;
  }
  if (!validateBridgeRequestOrigin(req, res)) return;
  next();
});

app.get('/api/auth/session', async (req, res) => {
  const payload = req.auth?.user
    ? { authenticated: true, user: req.auth.user }
    : { authenticated: false, user: null };
  res.json(payload);
});

app.post('/api/auth/register', async (req, res) => {
  try {
    applyPublicAuthRateLimit(req, {
      action: 'register',
      identifier: req.body?.email,
      ipLimit: 8,
      identifierLimit: 4,
      message: '注册尝试过于频繁，请 10 分钟后再试',
    });
    const created = await registerUser(req.body || {});
    const session = await createSession(created.id, { kind: 'user' });
    setAuthSessionCookie(req, res, session.token, session.expiresAtMs - Date.now());
    return res.json({ success: true, user: session.user });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'auth',
      action: 'register-failed',
      identifier: req.body?.email,
      err,
      threshold: 4,
    });
    return res.status(authResponseStatus(err)).json({ success: false, error: String(err?.message || err || '注册失败') });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    applyPublicAuthRateLimit(req, {
      action: 'login',
      identifier: req.body?.email || req.body?.identifier || req.body?.username,
      ipLimit: 20,
      identifierLimit: 8,
      message: '登录尝试过于频繁，请稍后再试',
    });
    const user = await authenticateUser({
      identifier: req.body?.email || req.body?.identifier || req.body?.username,
      password: req.body?.password,
      requireRoot: false,
    });
    const session = await createSession(user.id, { kind: 'user' });
    setAuthSessionCookie(req, res, session.token, session.expiresAtMs - Date.now());
    return res.json({ success: true, user: session.user });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'auth',
      action: 'login-failed',
      identifier: req.body?.email || req.body?.identifier || req.body?.username,
      err,
      threshold: 5,
    });
    return res.status(authResponseStatus(err)).json({ success: false, error: String(err?.message || err || '登录失败') });
  }
});

app.post('/api/auth/admin/login', async (req, res) => {
  try {
    applyPublicAuthRateLimit(req, {
      action: 'admin-login',
      identifier: req.body?.email || req.body?.identifier || req.body?.username,
      ipLimit: 10,
      identifierLimit: 5,
      message: '管理后台登录尝试过于频繁，请稍后再试',
    });
    const user = await authenticateUser({
      identifier: req.body?.email || req.body?.identifier || req.body?.username,
      password: req.body?.password,
      requireRoot: true,
    });
    const session = await createSession(user.id, { kind: 'admin' });
    setAuthSessionCookie(req, res, session.token, session.expiresAtMs - Date.now());
    return res.json({ success: true, user: session.user });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'auth',
      action: 'admin-login-failed',
      identifier: req.body?.email || req.body?.identifier || req.body?.username,
      err,
      threshold: 3,
    });
    return res.status(authResponseStatus(err)).json({ success: false, error: String(err?.message || err || '登录失败') });
  }
});

app.post('/api/auth/logout', (req, res) => {
  try {
    applyUserActionRateLimit(req, {
      action: 'auth-logout',
      userLimit: 20,
      ipLimit: 30,
      windowMs: 10 * 60_000,
    });
    if (req.auth?.sessionToken) destroySession(req.auth.sessionToken);
    clearAuthSessionCookie(req, res);
    return res.json({ success: true });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'account',
      action: 'logout-failed',
      identifier: req.auth?.user?.id || req.auth?.sessionToken,
      err,
      threshold: 6,
    });
    return res.status(writeResponseStatus(err)).json({ success: false, error: String(err?.message || err || '退出失败') });
  }
});

app.post('/api/auth/email/send-code', async (req, res) => {
  try {
    applyPublicAuthRateLimit(req, {
      action: 'email-code',
      identifier: req.body?.email,
      ipLimit: 6,
      identifierLimit: 3,
      message: '验证码请求过于频繁，请稍后再试',
    });
    const result = await sendVerificationCodeStub(req.body?.email || '');
    return res.json(result);
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'auth',
      action: 'email-code-failed',
      identifier: req.body?.email,
      err,
      threshold: 3,
    });
    return res.status(authResponseStatus(err)).json({ success: false, error: String(err?.message || err || '发送失败') });
  }
});

app.use('/api', ensureAuth);

app.get('/api/auth/root-credential', ensureRoot, async (req, res) => {
  try {
    applyUserActionRateLimit(req, {
      action: 'auth-root-credential',
      userLimit: 6,
      ipLimit: 10,
      windowMs: 10 * 60_000,
      message: '敏感凭据读取过于频繁，请稍后再试',
    });
    const text = await readRootCredentialFile();
    return res.json({ success: true, text });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'admin',
      action: 'root-credential-read-failed',
      identifier: req.auth?.user?.id,
      err,
      threshold: 3,
    });
    return res.status(writeResponseStatus(err)).json({ success: false, error: String(err?.message || err || '读取失败') });
  }
});

app.post('/api/auth/profile', async (req, res) => {
  try {
    applyUserActionRateLimit(req, {
      action: 'auth-profile',
      userLimit: 12,
      ipLimit: 20,
      windowMs: 10 * 60_000,
      message: '资料更新过于频繁，请稍后再试',
    });
    const user = await updateOwnProfile(req.auth.user.id, req.body || {});
    req.auth.user = user;
    return res.json({ success: true, user });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'account',
      action: 'profile-update-failed',
      identifier: req.auth?.user?.id,
      err,
      threshold: 5,
    });
    return res.status(writeResponseStatus(err)).json({ success: false, error: String(err?.message || err || '更新失败') });
  }
});

app.post('/api/auth/password', async (req, res) => {
  try {
    applyUserActionRateLimit(req, {
      action: 'auth-password',
      userLimit: 6,
      ipLimit: 12,
      windowMs: 30 * 60_000,
      message: '密码修改过于频繁，请稍后再试',
    });
    await changeOwnPassword(req.auth.user.id, {
      currentPassword: req.body?.currentPassword,
      nextPassword: req.body?.nextPassword,
    });
    if (req.auth?.sessionToken) destroySession(req.auth.sessionToken);
    clearAuthSessionCookie(req, res);
    return res.json({ success: true });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'account',
      action: 'password-change-failed',
      identifier: req.auth?.user?.id,
      err,
      threshold: 3,
    });
    return res.status(writeResponseStatus(err)).json({ success: false, error: String(err?.message || err || '修改失败') });
  }
});

app.post('/api/auth/guide/accept', async (req, res) => {
  try {
    applyUserActionRateLimit(req, {
      action: 'auth-guide',
      userLimit: 10,
      ipLimit: 20,
      windowMs: 10 * 60_000,
    });
    const user = await acceptGuide(req.auth.user.id);
    req.auth.user = user;
    return res.json({ success: true, user });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'account',
      action: 'guide-accept-failed',
      identifier: req.auth?.user?.id,
      err,
      threshold: 6,
    });
    return res.status(writeResponseStatus(err)).json({ success: false, error: String(err?.message || err || '确认失败') });
  }
});

app.get('/api/admin/users', ensureRoot, async (req, res) => {
  try {
    applyUserActionRateLimit(req, {
      action: 'admin-user-list',
      userLimit: 60,
      ipLimit: 100,
      windowMs: 5 * 60_000,
      message: '用户列表读取过于频繁，请稍后再试',
    });
    return res.json({ users: await listUsersForAdmin() });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'admin',
      action: 'user-list-failed',
      identifier: req.auth?.user?.id,
      err,
      threshold: 4,
    });
    return res.status(writeResponseStatus(err)).json({ success: false, error: String(err?.message || err || '读取失败') });
  }
});

app.post('/api/admin/users', ensureRoot, async (req, res) => {
  try {
    applyUserActionRateLimit(req, {
      action: 'admin-user-create',
      userLimit: 20,
      ipLimit: 30,
      windowMs: 10 * 60_000,
      message: '创建账号过于频繁，请稍后再试',
    });
    const user = await adminCreateUser(req.body || {});
    return res.json({ success: true, user });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'admin',
      action: 'user-create-failed',
      identifier: req.body?.email,
      err,
      threshold: 4,
    });
    return res.status(writeResponseStatus(err)).json({ success: false, error: String(err?.message || err || '创建失败') });
  }
});

app.post('/api/admin/users/:id', ensureRoot, async (req, res) => {
  try {
    applyUserActionRateLimit(req, {
      action: 'admin-user-update',
      userLimit: 40,
      ipLimit: 60,
      windowMs: 10 * 60_000,
      message: '账号更新过于频繁，请稍后再试',
    });
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ success: false, error: '缺少用户ID' });
    const user = await adminUpdateUser(userId, req.body || {});
    const shouldClearSteam = req.body?.clearSteamBinding === true;
    const shouldShutdown = user?.disabled === true || shouldClearSteam;
    if (shouldShutdown) {
      await shutdownWebUserContext(userId, {
        terminateSockets: true,
        clearRustplusConfig: shouldClearSteam,
      }).catch((err) => logger.warn('[Admin] 关闭用户上下文失败: ' + err.message));
    }
    return res.json({ success: true, user });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'admin',
      action: 'user-update-failed',
      identifier: req.params?.id || req.body?.email,
      err,
      threshold: 5,
    });
    return res.status(writeResponseStatus(err)).json({ success: false, error: String(err?.message || err || '更新失败') });
  }
});

app.delete('/api/admin/users/:id', ensureRoot, async (req, res) => {
  try {
    applyUserActionRateLimit(req, {
      action: 'admin-user-delete',
      userLimit: 10,
      ipLimit: 20,
      windowMs: 10 * 60_000,
      message: '账号删除操作过于频繁，请稍后再试',
    });
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ success: false, error: '缺少用户ID' });
    await adminDeleteUser(userId);
    await shutdownWebUserContext(userId, {
      terminateSockets: true,
      clearRustplusConfig: true,
      purgeWorkspace: true,
    }).catch((err) => logger.warn('[Admin] 删除用户工作区失败: ' + err.message));
    return res.json({ success: true });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'admin',
      action: 'user-delete-failed',
      identifier: req.params?.id,
      err,
      threshold: 3,
    });
    return res.status(writeResponseStatus(err)).json({ success: false, error: String(err?.message || err || '删除失败') });
  }
});

app.get('/api/admin/email-provider', ensureRoot, async (req, res) => {
  try {
    applyUserActionRateLimit(req, {
      action: 'admin-email-provider-read',
      userLimit: 30,
      ipLimit: 50,
      windowMs: 5 * 60_000,
      message: '邮箱配置读取过于频繁，请稍后再试',
    });
    return res.json({ success: true, config: await getEmailProviderConfig() });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'admin',
      action: 'email-provider-read-failed',
      identifier: req.auth?.user?.id,
      err,
      threshold: 4,
    });
    return res.status(writeResponseStatus(err)).json({ success: false, error: String(err?.message || err || '读取失败') });
  }
});

app.post('/api/admin/email-provider', ensureRoot, async (req, res) => {
  try {
    applyUserActionRateLimit(req, {
      action: 'admin-email-provider',
      userLimit: 10,
      ipLimit: 20,
      windowMs: 10 * 60_000,
      message: '邮箱配置操作过于频繁，请稍后再试',
    });
    const config = await updateEmailProviderConfig(req.body || {});
    return res.json({ success: true, config });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'admin',
      action: 'email-provider-update-failed',
      identifier: req.auth?.user?.id,
      err,
      threshold: 3,
    });
    return res.status(writeResponseStatus(err)).json({ success: false, error: String(err?.message || err || '更新失败') });
  }
});

app.get('/api/admin/call-control', ensureRoot, async (req, res) => {
  try {
    applyUserActionRateLimit(req, {
      action: 'admin-call-control-read',
      userLimit: 30,
      ipLimit: 50,
      windowMs: 5 * 60_000,
      message: '呼叫总控读取过于频繁，请稍后再试',
    });
    return res.json({ success: true, config: await getCallControlState() });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'admin',
      action: 'call-control-read-failed',
      identifier: req.auth?.user?.id,
      err,
      threshold: 4,
    });
    return res.status(writeResponseStatus(err)).json({ success: false, error: String(err?.message || err || '读取失败') });
  }
});

app.post('/api/admin/call-control', ensureRoot, async (req, res) => {
  try {
    applyUserActionRateLimit(req, {
      action: 'admin-call-control',
      userLimit: 10,
      ipLimit: 20,
      windowMs: 10 * 60_000,
      message: '呼叫总控操作过于频繁，请稍后再试',
    });
    const config = await updateCallControlState(req.body || {});
    return res.json({ success: true, config });
  } catch (err) {
    auditRouteFailure(req, {
      scope: 'admin',
      action: 'call-control-update-failed',
      identifier: req.auth?.user?.id,
      err,
      threshold: 3,
    });
    return res.status(writeResponseStatus(err)).json({ success: false, error: String(err?.message || err || '更新失败') });
  }
});

app.get('/api/health', (_, res) => {
  res.json({ ok: true, service: 'rust-plus-web', ts: Date.now() });
});

app.get('/api/bootstrap', async (req, res) => {
  const servers = await listServers();
  const steam = await getSteamProfileStatus({ fetchRemote: false }).catch(() => null);
  res.json(bootstrapPayload(servers, steam, req.auth?.user || null));
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

app.get('/api/team/messages', async (_, res) => {
  if (runtime.connected && runtimeState.rustClient?.connected) {
    try {
      const history = await invokeIpc({ channel: 'server:getTeamChat', args: [] });
      const messages = Array.isArray(history?.teamChat?.messages)
        ? history.teamChat.messages
        : Array.isArray(history?.messages)
          ? history.messages
          : [];
      if (messages.length) return res.json({ messages });
    } catch (_) {}
  }
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

app.post('/api/steam/remote-auth/session', ensureUserAuth, async (req, res) => {
  try {
    applyBridgeRateLimit(req, {
      action: 'remote-auth-create',
      tokenHint: req.auth?.user?.id || '',
      ipLimit: 12,
      tokenLimit: 8,
      windowMs: 10 * 60_000,
      message: '创建 Steam 登录任务过于频繁，请稍后再试',
    });
    const payload = req.body || {};
    const created = createRemoteSteamAuthSession({
      ttlMs: payload.ttlMs,
      requestedBy: 'web',
      ownerUserId: req.auth?.user?.id || '',
      ownerEmail: req.auth?.user?.email || '',
    });
    return res.json({
      success: true,
      session: created,
      serverUrl: getRequestOrigin(req),
      bridgeSessionId: String(created?.id || ''),
      bridgePackageUrl: buildBridgePackageUrl(req, created?.id || ''),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err?.message || err || '创建会话失败') });
  }
});

app.get('/api/steam/remote-auth/session/:id', ensureUserAuth, (req, res) => {
  const sessionId = String(req.params?.id || '').trim();
  if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId 不能为空' });
  const session = getRemoteSteamAuthSession(sessionId, {
    ownerUserId: req.auth?.user?.id || '',
  });
  if (!session) return res.status(404).json({ success: false, error: '会话不存在' });
  return res.json({ success: true, session });
});

app.post('/api/steam/remote-auth/session/:id/cancel', ensureUserAuth, (req, res) => {
  const sessionId = String(req.params?.id || '').trim();
  if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId 不能为空' });
  const body = req.body || {};
  const result = cancelRemoteSteamAuthSession({
    sessionId,
    ownerUserId: req.auth?.user?.id || '',
    bootstrapToken: body.bootstrapToken,
    sessionCode: body.sessionCode,
    sessionSecret: body.sessionSecret,
  });
  if (!result.success) return res.status(400).json(result);
  return res.json(result);
});

app.get('/api/steam/remote-auth/session/:id/bridge-package', ensureUserAuth, (req, res) => {
  const sessionId = String(req.params?.id || '').trim();
  if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId 不能为空' });
  const bootstrap = getRemoteSteamAuthSessionBootstrap(sessionId, {
    ownerUserId: req.auth?.user?.id || '',
  });
  if (!bootstrap?.session?.bootstrapToken) {
    return res.status(404).json({ success: false, error: '会话不存在或无权限访问' });
  }
  return streamBridgePackage(res, {
    serverUrl: getRequestOrigin(req),
    bootstrapToken: bootstrap.session.bootstrapToken,
    bridgeSessionId: bootstrap.session.id,
    ownerRef: bootstrap.ownerUserId || '',
    expiresAt: bootstrap.session.expiresAt || '',
    autoStartOnInstall: true,
  });
});

function renderSteamBridgeCallbackPage({ success = false, message = '', detail = '' } = {}) {
  const title = success ? 'Steam 登录已完成' : 'Steam 登录失败';
  const safeTitle = escHtml(title);
  const safeMessage = escHtml(String(message || '').trim() || (success ? '云端已接收 Rust+ 登录信息。' : '未能完成 Steam 登录回传。'));
  const safeDetail = detail ? `<p style="color:#8b98b1;font-size:13px;line-height:1.6;margin:12px 0 0;">${escHtml(detail)}</p>` : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at top, rgba(196, 112, 67, 0.18), transparent 38%),
        linear-gradient(180deg, #10151d 0%, #0b0f14 100%);
      color: #f3f4f6;
      font-family: "Segoe UI", "PingFang SC", sans-serif;
    }
    .panel {
      width: min(92vw, 480px);
      padding: 28px 24px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px;
      background: rgba(16, 21, 29, 0.92);
      box-shadow: 0 20px 60px rgba(0,0,0,0.38);
    }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { margin: 0; line-height: 1.7; color: #d6d8dd; }
  </style>
</head>
<body>
  <main class="panel">
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    ${safeDetail}
  </main>
</body>
</html>`;
}

app.get('/steam-bridge/ping', (_, res) => {
  res.json({ ok: true, service: 'steam-bridge', ts: Date.now() });
});

app.get('/steam-bridge/callback', async (req, res) => {
  const bootstrapToken = String(req.query?.bootstrapToken || '').trim();
  const rustplusAuthToken = String(req.query?.token || '').trim();
  if (!bootstrapToken || !rustplusAuthToken) {
    return res.status(400).send(renderSteamBridgeCallbackPage({
      success: false,
      message: '回传参数缺失，无法完成 Steam 登录同步。',
      detail: '请返回工具箱重新发起 Steam 登录。',
    }));
  }

  try {
    const result = await completeRemoteSteamAuthSession({
      bootstrapToken,
      rustplusAuthToken,
      autoStartPairing: true,
    });
    if (result?.ownerUserId && result?.steam) {
      await setUserSteamBinding(result.ownerUserId, result.steam).catch(() => null);
    }
    if (result?.ownerUserId) {
      const ownerCtx = ensureWebUserContext({
        id: result.ownerUserId,
        email: result.ownerEmail || '',
      });
      await withUserContext(ownerCtx, () => startPairingFlow({ forceRegister: false })).catch((err) => {
        logger.warn('[SteamBridge] callback 自动启动配对监听失败: ' + (err?.message || err));
      });
    }
    return res.send(renderSteamBridgeCallbackPage({
      success: true,
      message: 'Rust+ 登录信息已经回传到工具箱，页面状态会自动同步。',
      detail: '你现在可以返回工具箱查看云端同步结果。',
    }));
  } catch (err) {
    const message = String(err?.message || err || 'Steam 登录回传失败');
    logger.warn('[SteamBridge] callback 处理失败: ' + message);
    return res.status(400).send(renderSteamBridgeCallbackPage({
      success: false,
      message: '云端未能完成登录信息同步。',
      detail: message,
    }));
  }
});

app.post('/steam-bridge/state', (req, res) => {
  try {
    applyBridgeRateLimit(req, {
      action: 'bridge-state',
      tokenHint: req.body?.bootstrapToken,
      ipLimit: 90,
      tokenLimit: 90,
      windowMs: 60_000,
    });
    const result = updateRemoteSteamAuthSessionPhase(req.body || {});
    if (!result?.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: String(err?.message || err || '更新远程授权状态失败'),
    });
  }
});

app.post('/steam-bridge/complete', async (req, res) => {
  try {
    const body = req.body || {};
    applyBridgeRateLimit(req, {
      action: 'bridge-complete',
      tokenHint: body.bootstrapToken || body.sessionCode || body.sessionId,
      ipLimit: 20,
      tokenLimit: 8,
      windowMs: 10 * 60_000,
      message: '登录回传过于频繁，请稍后再试',
    });
    const result = await completeRemoteSteamAuthSession(body);
    if (result?.ownerUserId && result?.steam) {
      await setUserSteamBinding(result.ownerUserId, result.steam).catch(() => null);
    }
    let pairing = { success: false, skipped: true, reason: 'not_requested' };
    if (body.autoStartPairing !== false && result?.ownerUserId) {
      const ownerCtx = ensureWebUserContext({
        id: result.ownerUserId,
        email: result.ownerEmail || '',
      });
      pairing = await withUserContext(ownerCtx, () => startPairingFlow({ forceRegister: false })).catch((err) => ({
        success: false,
        error: `自动启动配对监听失败: ${err?.message || err}`,
      }));
    }
    return res.json({
      success: true,
      steam: result.steam || null,
      session: result.session || null,
      pairing,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: String(err?.message || err || '回传失败'),
    });
  }
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
app.use('/', express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/auth', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/auth.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.get('/', ensurePageAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('*', (req, res) => {
  if (req.path === '/auth') {
    res.sendFile(path.join(__dirname, 'public/auth.html'));
    return;
  }
  if (req.path === '/admin') {
    res.sendFile(path.join(__dirname, 'public/admin.html'));
    return;
  }
  if (path.extname(req.path)) {
    res.status(404).end();
    return;
  }
  if (!req.auth?.user) {
    res.redirect('/auth');
    return;
  }
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

wss.on('connection', async (socket, req) => {
  const token = parseWebSocketAuthToken(req);
  let currentUser = null;
  let authorized = !REQUIRE_API_TOKEN;
  if (API_TOKEN && token === API_TOKEN) {
    currentUser = { id: SERVICE_CONTEXT_ID, email: 'service@local' };
    authorized = true;
  }
  if (!authorized && token) {
    const session = await getPublicSession(token).catch(() => null);
    if (session?.authenticated && session.user) {
      currentUser = session.user;
      authorized = true;
    }
  }
  if (!authorized) {
    socket.close(1008, 'Unauthorized');
    return;
  }
  const scopedUser = currentUser || { id: SERVICE_CONTEXT_ID, email: 'service@local' };
  const ctx = ensureWebUserContext(scopedUser);
  ctx.sockets.add(socket);
  socket.on('close', bindUserContext(ctx, () => {
    ctx.sockets.delete(socket);
  }));
  await withUserContext(ctx, async () => {
    try {
      const servers = await listServers();
      socket.send(JSON.stringify({
        type: 'bootstrap',
        payload: bootstrapPayload(servers, null, currentUser),
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
});

async function boot() {
  await initAuthStore();
  await withUserContext(ensureWebUserContext({ id: SERVICE_CONTEXT_ID, email: 'service@local' }), async () => {
    await getConfigStore().initDbs();
    await syncCallGroupsFromDb();
  });

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
