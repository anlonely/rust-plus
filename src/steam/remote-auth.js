const crypto = require('crypto');
const AndroidFCM = require('@liamcottle/push-receiver/src/android/fcm');
const logger = require('../utils/logger');
const { maskSecret, redactSensitiveText } = require('../utils/security');
const { createRustplusConfigStore } = require('../storage/rustplus-config');
const { getSteamProfileStatus } = require('./profile');
const SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_MIN_TTL_MS = 60 * 1000;
const SESSION_MAX_TTL_MS = 30 * 60 * 1000;
const SESSION_MAX_COUNT = 300;
const SESSION_SWEEP_INTERVAL_MS = 30 * 1000;

const REMOTE_AUTH_FCM_CONFIG = {
  apiKey: 'AIzaSyB5y2y-Tzqb4-I4Qnlsh_9naYv_TD8pCvY',
  projectId: 'rust-companion-app',
  gcmSenderId: '976529667804',
  gmsAppId: '1:976529667804:android:d6f1ddeb4403b338fea619',
  androidPackageName: 'com.facepunch.rust.companion',
  androidPackageCert: 'E28D05345FB78A7A1A63D70F4A302DBF426CA5AD',
  expoProjectId: '49451aca-a822-41e6-ad59-955718d0ff9c',
};

const sessions = new Map();
let sweepTimer = null;
const fcmProvisionPromises = new Map();

function now() {
  return Date.now();
}

function clampTtlMs(rawTtlMs) {
  const ttlMs = Number(rawTtlMs);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return SESSION_TTL_MS;
  return Math.min(SESSION_MAX_TTL_MS, Math.max(SESSION_MIN_TTL_MS, ttlMs));
}

function createSessionConfigStore(configFile = '') {
  return createRustplusConfigStore({ configFile });
}

function hasValidFcmAndExpo(config = {}) {
  return !!(
    config &&
    config.fcm_credentials &&
    config.fcm_credentials.fcm &&
    config.fcm_credentials.fcm.token &&
    config.fcm_credentials.gcm &&
    config.fcm_credentials.gcm.androidId &&
    config.fcm_credentials.gcm.securityToken &&
    config.expo_push_token
  );
}

function hasValidSteamAuthToken(config = {}) {
  return !!String(config?.rustplus_auth_token || '').trim();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }
  if (!response.ok) {
    const detail = data ? JSON.stringify(data) : text;
    throw new Error(`HTTP ${response.status}: ${detail || '请求失败'}`);
  }
  return data;
}

async function requestExpoPushToken(fcmToken) {
  const body = {
    type: 'fcm',
    deviceId: crypto.randomUUID(),
    development: false,
    appId: 'com.facepunch.rust.companion',
    deviceToken: fcmToken,
    projectId: REMOTE_AUTH_FCM_CONFIG.expoProjectId,
  };
  const json = await fetchJson('https://exp.host/--/api/v2/push/getExpoPushToken', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const expoPushToken = String(json?.data?.expoPushToken || '').trim();
  if (!expoPushToken) throw new Error('获取 Expo Push Token 失败');
  return expoPushToken;
}

async function registerWithRustCompanionApi(authToken, expoPushToken) {
  const body = {
    AuthToken: authToken,
    DeviceId: 'rustplus.js',
    PushKind: 3,
    PushToken: expoPushToken,
  };
  await fetchJson('https://companion-rust.facepunch.com:443/api/push/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function provisionFcmCredentials({ forceRefresh = false, configFile = '' } = {}) {
  const cfgStore = createSessionConfigStore(configFile);
  const current = cfgStore.read();
  const promiseKey = cfgStore.filePath;
  if (!forceRefresh && hasValidFcmAndExpo(current)) {
    return {
      reused: true,
      fcmCredentials: current.fcm_credentials,
      expoPushToken: current.expo_push_token,
    };
  }

  if (!forceRefresh && fcmProvisionPromises.has(promiseKey)) return fcmProvisionPromises.get(promiseKey);

  const run = async () => {
    logger.info('[SteamBridge] 开始生成 FCM 与 Expo 推送凭据');
    const fcmCredentials = await AndroidFCM.register(
      REMOTE_AUTH_FCM_CONFIG.apiKey,
      REMOTE_AUTH_FCM_CONFIG.projectId,
      REMOTE_AUTH_FCM_CONFIG.gcmSenderId,
      REMOTE_AUTH_FCM_CONFIG.gmsAppId,
      REMOTE_AUTH_FCM_CONFIG.androidPackageName,
      REMOTE_AUTH_FCM_CONFIG.androidPackageCert,
    );
    const fcmToken = String(fcmCredentials?.fcm?.token || '').trim();
    if (!fcmToken) throw new Error('FCM 凭据生成失败（未返回 token）');
    const expoPushToken = await requestExpoPushToken(fcmToken);
    return { reused: false, fcmCredentials, expoPushToken };
  };

  if (!forceRefresh) {
    const pending = run();
    fcmProvisionPromises.set(promiseKey, pending);
    try {
      return await pending;
    } finally {
      fcmProvisionPromises.delete(promiseKey);
    }
  }
  return run();
}

function extractRustplusAuthToken(input) {
  if (!input) return '';
  if (typeof input === 'string') {
    const raw = input.trim();
    if (!raw) return '';
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        return extractRustplusAuthToken(parsed);
      } catch (_) {
        return '';
      }
    }
    return raw;
  }
  if (typeof input === 'object') {
    const candidates = [
      input.rustplusAuthToken,
      input.authToken,
      input.token,
      input.Token,
      input?.auth?.Token,
      input?.auth?.token,
    ];
    for (const candidate of candidates) {
      const token = extractRustplusAuthToken(candidate);
      if (token) return token;
    }
  }
  return '';
}

function parseSessionCode(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const token = raw.replace(/^RPTK-/i, '').trim();
  const firstDot = token.indexOf('.');
  if (firstDot <= 0 || firstDot >= token.length - 1) return null;
  return {
    sessionId: token.slice(0, firstDot),
    sessionSecret: token.slice(firstDot + 1),
  };
}

function buildSessionCode(session) {
  return `RPTK-${session.id}.${session.secret}`;
}

function sanitizeSessionError(err) {
  const text = String(err?.message || err || '未知错误');
  return redactSensitiveText(text).slice(0, 300);
}

function createSessionId() {
  return crypto.randomBytes(10).toString('hex');
}

function createSessionSecret() {
  return crypto.randomBytes(18).toString('base64url');
}

function toIso(ts) {
  return new Date(ts).toISOString();
}

function compactSessionSteps(steps = []) {
  return steps.slice(-20).map((item) => ({
    at: item.at,
    state: item.state,
    message: item.message,
  }));
}

function toPublicSession(session, { includeCode = false } = {}) {
  if (!session) return null;
  const payload = {
    id: session.id,
    status: session.status,
    createdAt: toIso(session.createdAtMs),
    updatedAt: toIso(session.updatedAtMs),
    expiresAt: toIso(session.expiresAtMs),
    steps: compactSessionSteps(session.steps),
    error: session.error || null,
    result: session.result || null,
  };
  if (includeCode) payload.sessionCode = buildSessionCode(session);
  return payload;
}

function appendSessionStep(session, state, message) {
  session.steps.push({
    at: toIso(now()),
    state: String(state || 'progress'),
    message: String(message || '').trim(),
  });
  session.updatedAtMs = now();
}

function ensureSweepTimer() {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweepExpiredSessions, SESSION_SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

function sweepExpiredSessions() {
  const current = now();
  for (const [id, session] of sessions.entries()) {
    if (session.expiresAtMs > current) continue;
    if (session.status === 'completed') {
      if (current - session.updatedAtMs > 3 * SESSION_TTL_MS) sessions.delete(id);
      continue;
    }
    session.status = 'expired';
    appendSessionStep(session, 'expired', '会话已过期，请重新创建授权会话');
  }
  if (sessions.size <= SESSION_MAX_COUNT) return;
  const ordered = [...sessions.values()].sort((a, b) => a.updatedAtMs - b.updatedAtMs);
  const overflow = sessions.size - SESSION_MAX_COUNT;
  for (let i = 0; i < overflow; i += 1) sessions.delete(ordered[i].id);
}

function getSessionByCredential({ sessionId = '', sessionSecret = '', sessionCode = '' } = {}) {
  let sid = String(sessionId || '').trim();
  let secret = String(sessionSecret || '').trim();
  if (!sid || !secret) {
    const parsed = parseSessionCode(sessionCode);
    if (!parsed) return null;
    sid = parsed.sessionId;
    secret = parsed.sessionSecret;
  }
  if (!sid || !secret) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (session.secret !== secret) return null;
  return session;
}

function createRemoteSteamAuthSession({ ttlMs = SESSION_TTL_MS, requestedBy = 'web', ownerUserId = '', ownerEmail = '', configFile = '' } = {}) {
  ensureSweepTimer();
  sweepExpiredSessions();
  const createdAtMs = now();
  const session = {
    id: createSessionId(),
    secret: createSessionSecret(),
    createdAtMs,
    updatedAtMs: createdAtMs,
    expiresAtMs: createdAtMs + clampTtlMs(ttlMs),
    status: 'pending',
    requestedBy: String(requestedBy || 'web'),
    ownerUserId: String(ownerUserId || '').trim(),
    ownerEmail: String(ownerEmail || '').trim(),
    configFile: String(configFile || '').trim(),
    steps: [],
    error: null,
    result: null,
    processingPromise: null,
  };
  appendSessionStep(session, 'pending', '会话已创建，等待本机 Chrome 插件回传 Steam token');
  sessions.set(session.id, session);
  return toPublicSession(session, { includeCode: true });
}

function getRemoteSteamAuthSession(sessionId, { ownerUserId = '' } = {}) {
  sweepExpiredSessions();
  const session = sessions.get(String(sessionId || '').trim()) || null;
  if (!session) return null;
  if (ownerUserId && session.ownerUserId && String(session.ownerUserId) !== String(ownerUserId)) {
    return null;
  }
  return toPublicSession(session, { includeCode: false });
}

function cancelRemoteSteamAuthSession({ sessionId = '', sessionSecret = '', sessionCode = '' } = {}) {
  const session = getSessionByCredential({ sessionId, sessionSecret, sessionCode });
  if (!session) return { success: false, error: '会话不存在或校验失败' };
  if (session.status === 'completed') return { success: false, error: '会话已完成，无法取消' };
  session.status = 'cancelled';
  appendSessionStep(session, 'cancelled', '会话已取消');
  return { success: true, session: toPublicSession(session) };
}

async function completeRemoteSteamAuthSession(payload = {}) {
  const session = getSessionByCredential(payload);
  if (!session) throw new Error('会话不存在或校验失败');
  if (session.status === 'completed') {
    return { session: toPublicSession(session), steam: session.result?.steam || null };
  }
  if (session.status === 'cancelled') throw new Error('会话已取消');
  if (session.status === 'expired') throw new Error('会话已过期，请重新创建');
  if (session.expiresAtMs <= now()) {
    session.status = 'expired';
    appendSessionStep(session, 'expired', '会话已过期，请重新创建授权会话');
    throw new Error('会话已过期，请重新创建');
  }

  if (session.processingPromise) return session.processingPromise;

  const rustplusAuthToken = extractRustplusAuthToken(payload.rustplusAuthToken || payload.token || payload.auth || payload);
  if (!rustplusAuthToken) throw new Error('未检测到有效 rustplus_auth_token');
  if (!rustplusAuthToken.includes('.')) throw new Error('token 格式无效');
  const forceRefreshFcm = payload.forceRefreshFcm === true;
  const cfgStore = createSessionConfigStore(session.configFile);

  session.status = 'processing';
  session.error = null;
  appendSessionStep(session, 'processing', '已收到 token，正在初始化云端推送凭据');
  const maskedToken = maskSecret(rustplusAuthToken, { visible: 6 });
  logger.info(`[SteamBridge] 会话 ${session.id} 开始处理授权，token=${maskedToken}`);

  const work = (async () => {
    try {
      const credentialPack = await provisionFcmCredentials({
        forceRefresh: forceRefreshFcm,
        configFile: session.configFile,
      });
      appendSessionStep(session, 'processing', credentialPack.reused ? '复用已有 FCM/Expo 凭据' : '已生成 FCM/Expo 凭据');

      await registerWithRustCompanionApi(rustplusAuthToken, credentialPack.expoPushToken);
      appendSessionStep(session, 'processing', 'Rust Companion 注册成功，正在写入配置');

      await cfgStore.patch({
        fcm_credentials: credentialPack.fcmCredentials,
        expo_push_token: credentialPack.expoPushToken,
        rustplus_auth_token: rustplusAuthToken,
      });

      const steam = await getSteamProfileStatus({ fetchRemote: true, configFile: session.configFile });
      const cfg = cfgStore.read();
      session.status = 'completed';
      session.result = {
        steam,
        hasFcmCredentials: hasValidFcmAndExpo(cfg),
        hasRustplusAuthToken: hasValidSteamAuthToken(cfg),
      };
      appendSessionStep(session, 'completed', 'Steam 远程登录完成');
      logger.info(`[SteamBridge] 会话 ${session.id} 已完成，steamId=${steam?.tokenMeta?.steamId || '-'}`);
      return {
        session: toPublicSession(session),
        steam,
        hasFcmCredentials: session.result.hasFcmCredentials,
        hasRustplusAuthToken: session.result.hasRustplusAuthToken,
        ownerUserId: session.ownerUserId || '',
        ownerEmail: session.ownerEmail || '',
      };
    } catch (err) {
      const safeError = sanitizeSessionError(err);
      session.status = 'failed';
      session.error = safeError;
      appendSessionStep(session, 'failed', safeError);
      logger.error(`[SteamBridge] 会话 ${session.id} 失败: ${safeError}`);
      throw new Error(safeError);
    } finally {
      session.processingPromise = null;
    }
  })();

  session.processingPromise = work;
  return work;
}

module.exports = {
  createRemoteSteamAuthSession,
  getRemoteSteamAuthSession,
  cancelRemoteSteamAuthSession,
  completeRemoteSteamAuthSession,
  parseSessionCode,
};
