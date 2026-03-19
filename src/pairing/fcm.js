// src/pairing/fcm.js
// ─────────────────────────────────────────────
// P0 阶段：FCM 推送监听 · 接收服务器配对通知
//
// 原理：
//   Facepunch 的配套服务器通过 Google FCM 向客户端
//   推送配对信息。我们借助 @liamcottle/rustplus.js
//   内置的 FCM 工具完成注册 & 监听。
// ─────────────────────────────────────────────

const { spawn } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const logger = require('../utils/logger');
const { redactSensitiveText } = require('../utils/security');
const { getConfigDir } = require('../utils/runtime-paths');
const { createRustplusConfigStore } = require('../storage/rustplus-config');

const CONFIG_DIR = getConfigDir();
const PAIRING_MAX_AGE_MS = 3 * 60 * 1000;
let activeRegisterProc = null;
let activeRegisterClosePromise = null;
let registerRunSequence = 0;

function resolveRustplusCli() {
  try {
    return require.resolve('@liamcottle/rustplus.js/cli/index.js');
  } catch (_) {
    return path.join(__dirname, '../../node_modules/@liamcottle/rustplus.js/cli/index.js');
  }
}

const RUSTPLUS_CLI = resolveRustplusCli();

function hasFcmCredentials(config) {
  return !!(config && config.fcm_credentials && config.rustplus_auth_token && config.expo_push_token);
}

function resolveRustplusConfigFile(configFile = '') {
  return createRustplusConfigStore({ configFile }).filePath;
}

function getFcmListenLastLogFile(configFile = '') {
  const resolved = resolveRustplusConfigFile(configFile);
  return path.join(path.dirname(resolved), 'fcm-listen-last.log');
}

function getFcmListenerStateFile(configFile = '') {
  const resolved = resolveRustplusConfigFile(configFile);
  return path.join(path.dirname(resolved), 'fcm-listener-state.json');
}

function readRustplusConfig(configFile = '') {
  return createRustplusConfigStore({ configFile }).read();
}

function rustplusArgs(command, configFile = '') {
  return [RUSTPLUS_CLI, '--config-file', resolveRustplusConfigFile(configFile), command];
}

function parsePairingPayload(input) {
  if (!input || typeof input !== 'object') return null;
  const payload = {
    ip: input.ip,
    port: input.port,
    playerId: input.playerId,
    playerToken: input.playerToken,
    name: input.name,
    url: input.url,
    type: input.type,
    entityId: input.entityId,
    entityType: input.entityType,
    entityName: input.entityName,
  };
  const hasServerPair = !!(payload.ip && payload.port && payload.playerId && payload.playerToken);
  const hasEntityPair = !!(payload.entityId && payload.playerId);
  if (!hasServerPair && !hasEntityPair) return null;
  return payload;
}

function parsePairingByFields(text) {
  const source = String(text || '').replace(/\\"/g, '"');
  const keys = ['ip', 'port', 'playerId', 'playerToken', 'name', 'entityId', 'entityType', 'entityName', 'type'];
  const out = {};

  for (const key of keys) {
    const patterns = [
      new RegExp(`["']${key}["']\\s*[:=]\\s*["']([^"']+)["']`, 'i'),
      new RegExp(`\\b${key}\\b\\s*[:=]\\s*["']([^"']+)["']`, 'i'),
      new RegExp(`\\b${key}\\b\\s*[:=]\\s*([^,\\s}\\]]+)`, 'i'),
    ];
    for (const re of patterns) {
      const m = source.match(re);
      if (m && m[1] != null) {
        out[key] = String(m[1]).replace(/^['"]|['"]$/g, '').trim();
        break;
      }
    }
  }

  if (!out.type && !out.entityId) return null;
  return parsePairingPayload(out);
}

function parseBodyJsonCandidates(text) {
  const candidates = [];
  const patterns = [
    /["']body["']\s*[:=]\s*[`'"](\{[\s\S]*?\})[`'"]/gi,
    /body:\s*[`'"](\{[\s\S]*?\})[`'"]/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1]) candidates.push(m[1]);
    }
  }
  return candidates;
}

function extractLatestSentEpochSec(text) {
  let latest = null;
  const patterns = [
    /sent:\s*'(\d+)'/g,
    /sent:\s*"(\d+)"/g,
    /["']sent["']\s*[:=]\s*["']?(\d+)["']?/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      latest = Number(m[1]);
    }
  }
  return Number.isFinite(latest) ? latest : null;
}

function normalizeSentToEpochMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // seconds
  if (n < 1e11) return n * 1000;
  // milliseconds
  if (n < 1e14) return n;
  // microseconds
  if (n < 1e17) return Math.floor(n / 1000);
  // nanoseconds
  return Math.floor(n / 1e6);
}

function extractPersistentId(text) {
  const source = String(text || '');
  let m = source.match(/persistentId:\s*'([^']+)'/);
  if (m) return m[1];
  m = source.match(/persistentId:\s*"([^"]+)"/);
  if (m) return m[1];
  m = source.match(/["']persistentId["']\s*:\s*["']([^"']+)["']/);
  return m ? m[1] : null;
}

function readListenerState(configFile = '') {
  const stateFile = getFcmListenerStateFile(configFile);
  try {
    const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return {
      processedPersistentIds: Array.isArray(data?.processedPersistentIds) ? data.processedPersistentIds : [],
      lastProcessedSentAtMs: Number.isFinite(Number(data?.lastProcessedSentAtMs)) ? Number(data.lastProcessedSentAtMs) : 0,
      updatedAt: data?.updatedAt || null,
    };
  } catch (_) {
    return { processedPersistentIds: [], lastProcessedSentAtMs: 0, updatedAt: null };
  }
}

function writeListenerState(next = {}, configFile = '') {
  const stateFile = getFcmListenerStateFile(configFile);
  const ids = Array.isArray(next.processedPersistentIds) ? next.processedPersistentIds.slice(-200) : [];
  const payload = {
    processedPersistentIds: ids,
    lastProcessedSentAtMs: Number.isFinite(Number(next.lastProcessedSentAtMs)) ? Number(next.lastProcessedSentAtMs) : 0,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(stateFile, JSON.stringify(payload, null, 2), 'utf8');
  } catch (_) {
    // ignore
  }
}

function appendListenRaw(text, configFile = '') {
  const logFile = getFcmListenLastLogFile(configFile);
  try {
    const safeText = redactSensitiveText(text);
    const line = `[${new Date().toISOString()}] ${safeText}\n`;
    fs.appendFileSync(logFile, line, 'utf8');
    const stat = fs.statSync(logFile);
    if (stat.size > 2 * 1024 * 1024) {
      const buf = fs.readFileSync(logFile, 'utf8');
      fs.writeFileSync(logFile, buf.slice(-800 * 1024), 'utf8');
    }
  } catch (_) {
    // ignore log write errors
  }
}

function extractPairingFromText(text) {
  if (!text) return null;
  const sentEpochSec = extractLatestSentEpochSec(text);
  const withMeta = (payload) => {
    if (!payload) return null;
    if (sentEpochSec) payload._sentEpochSec = sentEpochSec;
    return payload;
  };

  // 1) 优先解析 body 内嵌 JSON（从最新一条往前）
  const bodyCandidates = parseBodyJsonCandidates(text);
  for (let i = bodyCandidates.length - 1; i >= 0; i -= 1) {
    const candidate = bodyCandidates[i];
    try {
      const unescaped = candidate
        .replace(/\\"/g, '"')
        .replace(/\\\\n/g, '\n')
        .replace(/\\\\/g, '\\');
      const payload = parsePairingPayload(JSON.parse(unescaped));
      if (payload) return withMeta(payload);
    } catch (_) {
      // ignore
    }
  }

  // 2) 直接 JSON 行
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed);
      const direct = parsePairingPayload(parsed);
      if (direct) return withMeta(direct);
      if (parsed && parsed.body) {
        const inner = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
        const nested = parsePairingPayload(inner);
        if (nested) return withMeta(nested);
      }
    } catch (_) {
      // ignore
    }
  }

  // 3) 通用键值扫描（兼容 util.inspect / 嵌套 Data 输出）
  const byFields = parsePairingByFields(text);
  if (byFields) return withMeta(byFields);

  // 4) util.inspect 风格: ip: 'x', port: '28017', playerId: '...', playerToken: '-...'
  const kv = text.match(
    /ip:\s*'([^']+)'.*?port:\s*'?(\\?\d+)'?.*?playerId:\s*'([^']+)'.*?playerToken:\s*'([^']+)'(?:.*?name:\s*'([^']+)')?/s
  );
  if (kv) {
    return withMeta({
      ip: kv[1],
      port: String(kv[2]).replace('\\', ''),
      playerId: kv[3],
      playerToken: kv[4],
      name: kv[5] || undefined,
    });
  }

  return null;
}

function hasCompleteNotification(text) {
  const raw = String(text || '');
  if (!raw.includes('Notification Received')) return false;
  if (raw.includes("persistentId: '")) return true;
  if (raw.includes('"persistentId"')) return true;
  return false;
}

function splitCompleteNotifications(buffer) {
  const raw = String(buffer || '');
  const items = [];
  let cursor = 0;

  while (cursor < raw.length) {
    const start = raw.indexOf('Notification Received', cursor);
    if (start === -1) break;

    const nextStart = raw.indexOf('Notification Received', start + 1);
    if (nextStart === -1) {
      const tail = raw.slice(start);
      if (hasCompleteNotification(tail)) {
        items.push(tail);
        cursor = raw.length;
      } else {
        cursor = start;
      }
      break;
    }

    const chunk = raw.slice(start, nextStart);
    if (hasCompleteNotification(chunk)) {
      items.push(chunk);
      cursor = nextStart;
      continue;
    }

    cursor = nextStart;
  }

  return {
    items,
    rest: cursor >= raw.length ? '' : raw.slice(cursor),
  };
}

/**
 * 步骤 1：注册 FCM（仅首次运行需要）
 * 会打开浏览器让用户完成 Steam 登录
 * 完成后凭据自动保存到本地
 */
async function registerFCM({ force = false, configFile = '', onStatus = null } = {}) {
  const runId = ++registerRunSequence;
  const existing = readRustplusConfig(configFile);
  const resolvedConfigFile = resolveRustplusConfigFile(configFile);
  const emitStatus = (payload = {}) => {
    if (runId !== registerRunSequence) return;
    if (typeof onStatus === 'function') {
      onStatus(payload);
    }
  };
  if (!force && hasFcmCredentials(existing)) {
    logger.info('[FCM] 已检测到本地凭据，跳过注册。');
    emitStatus({ type: 'already-ready', configFile: resolvedConfigFile });
    return;
  }

  logger.info('[FCM] 开始 FCM 注册...');
  logger.info('[FCM] 即将打开授权窗口，请完成 Steam 登录。');
  emitStatus({ type: 'starting', configFile: resolvedConfigFile });

  try {
    if (force && activeRegisterProc) {
      logger.info('[FCM] 检测到已有授权流程，正在重启登录窗口...');
      try {
        activeRegisterProc.__restartRequested = true;
        activeRegisterProc.kill('SIGTERM');
      } catch (_) {
        // ignore
      }
      await Promise.race([
        activeRegisterClosePromise?.catch(() => null),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }

    await new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, rustplusArgs('fcm-register', resolvedConfigFile), {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
        },
      });
      activeRegisterProc = proc;
      emitStatus({ type: 'browser-opened', configFile: resolvedConfigFile });
      let seenBrowserHint = false;
      const handleOutput = (chunk, source = 'stdout') => {
        const text = String(chunk || '');
        if (!text) return;
        appendListenRaw(`[fcm-register:${source}] ${text}`, resolvedConfigFile);
        if (seenBrowserHint) return;
        const normalized = text.toLowerCase();
        if (normalized.includes('open') || normalized.includes('browser') || normalized.includes('steam')) {
          seenBrowserHint = true;
          emitStatus({ type: 'waiting-login', configFile: resolvedConfigFile });
        }
      };
      proc.stdout?.on('data', (chunk) => handleOutput(chunk, 'stdout'));
      proc.stderr?.on('data', (chunk) => handleOutput(chunk, 'stderr'));

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error('FCM 注册超时（15分钟）'));
      }, 900_000);
      activeRegisterClosePromise = new Promise((closeResolve) => {
        proc.once('close', () => closeResolve());
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        if (activeRegisterProc === proc) {
          activeRegisterProc = null;
          activeRegisterClosePromise = null;
        }
        reject(err);
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (activeRegisterProc === proc) {
          activeRegisterProc = null;
          activeRegisterClosePromise = null;
        }
        if (code === 0) resolve();
        else if (proc.__restartRequested) reject(new Error('FCM 注册已重启'));
        else reject(new Error(`fcm-register 退出码: ${code}`));
      });
    });

    if (runId !== registerRunSequence) {
      const staleError = new Error('FCM 注册已被更新的授权流程接管');
      staleError.code = 'FCM_REGISTER_STALE';
      throw staleError;
    }

    const updated = readRustplusConfig(resolvedConfigFile);
    if (!hasFcmCredentials(updated)) {
      throw new Error(`注册流程结束，但未写入凭据文件: ${resolvedConfigFile}`);
    }
    logger.info(`[FCM] FCM 注册成功，凭据已写入: ${resolvedConfigFile}`);
    emitStatus({ type: 'credentials-ready', configFile: resolvedConfigFile });
  } catch (err) {
    if (err?.code === 'FCM_REGISTER_STALE') {
      logger.info('[FCM] 旧授权流程已作废，忽略其退出结果。');
      return;
    }
    logger.error('[FCM] 注册失败: ' + err.message);
    emitStatus({ type: 'failed', configFile: resolvedConfigFile, message: err.message });
    throw err;
  }
}

/**
 * 步骤 2：监听 FCM 配对推送
 *
 * 当用户在游戏内按 ESC → Rust+ → Pair with Server 后，
 * Facepunch 会推送以下数据：
 * {
 *   ip:          "123.45.67.89",
 *   port:        "28017",
 *   playerId:    "76561198xxxxxxxxx",
 *   playerToken: "-1234567890",
 *   name:        "My Rust Server"
 * }
 *
 * @param {Function} onPairing - 收到配对数据时的回调 (data) => void
 * @param {Object} options
 * @param {Function} options.onStatus - 监听状态回调 ({ type, ...meta }) => void
 * @returns {Function} stopListening - 调用此函数停止监听
 */
function listenForPairing(onPairing, options = {}) {
  const resolvedConfigFile = resolveRustplusConfigFile(options.configFile);
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  if (!hasFcmCredentials(readRustplusConfig(resolvedConfigFile))) {
    throw new Error(`FCM 凭据缺失，请先完成 Steam 登录注册（${resolvedConfigFile}）`);
  }

  logger.info('[FCM] 开始监听配对推送...');
  logger.info('[FCM] 请在游戏中按 ESC → Rust+ → Pair with Server');
  logger.info('[FCM] 等待推送通知（Ctrl+C 退出）...');
  const seen = new Set();
  const seenPersistentIds = new Set();
  const persisted = readListenerState(resolvedConfigFile);
  const persistedIds = new Set(persisted.processedPersistentIds || []);
  let lastProcessedSentAtMs = persisted.lastProcessedSentAtMs || 0;
  const listenStartedAtMs = Date.now();
  let proc = null;
  let buffer = '';
  let stopped = false;
  let restarting = false;
  let restartCount = 0;
  let restartTimer = null;

  const scheduleRestart = (reason = 'unknown') => {
    if (stopped || restarting) return;
    restarting = true;
    const delay = Math.min(10_000, 1000 + (Math.min(restartCount, 10) * 1000));
    restartCount += 1;
    logger.warn(`[FCM] 监听进程异常退出，${delay}ms 后自动重启（#${restartCount}，原因: ${reason}）`);
    onStatus({ type: 'restarting', restartCount, delayMs: delay, reason });
    restartTimer = setTimeout(() => {
      restarting = false;
      spawnListener();
    }, delay);
  };

  const spawnListener = () => {
    if (stopped) return;
    buffer = '';
    proc = spawn(process.execPath, rustplusArgs('fcm-listen', resolvedConfigFile), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    onStatus({ type: 'listening', restartCount });

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      logger.debug('[FCM RAW] ' + redactSensitiveText(text).trim());
      appendListenRaw(text, resolvedConfigFile);
      if (text.includes('Notification Received')) {
        logger.info('[FCM] 收到推送通知，正在解析配对数据...');
        onStatus({ type: 'notification-received', at: new Date().toISOString() });
      }

      buffer += text;
      if (buffer.length > 200_000) {
        buffer = buffer.slice(-200_000);
      }

      const { items, rest } = splitCompleteNotifications(buffer);
      buffer = rest;

      for (const item of items) {
        const pid = extractPersistentId(item);
        if (pid && seenPersistentIds.has(pid)) continue;
        if (pid && persistedIds.has(pid)) continue;
        if (pid) seenPersistentIds.add(pid);

        const payload = extractPairingFromText(item);
        if (!payload) continue;
        const key = `${payload.type || 'server'}:${payload.ip || ''}:${payload.port || ''}:${payload.playerId || ''}:${payload.entityId || ''}:${payload.playerToken || ''}`;
        if (seen.has(key)) continue;

        if (!payload._sentEpochSec) {
          seen.add(key);
          if (pid) persistedIds.add(pid);
          writeListenerState({
            processedPersistentIds: Array.from(persistedIds),
            lastProcessedSentAtMs,
          }, resolvedConfigFile);
          logger.info(`[FCM] 丢弃缺少 sent 时间戳的配对推送，避免历史误触发: type=${payload.type || 'server'}`);
          continue;
        }

        const sentAtMs = payload._sentEpochSec ? normalizeSentToEpochMs(payload._sentEpochSec) : Date.now();
        if (!sentAtMs) {
          seen.add(key);
          if (pid) persistedIds.add(pid);
          writeListenerState({
            processedPersistentIds: Array.from(persistedIds),
            lastProcessedSentAtMs,
          }, resolvedConfigFile);
          logger.info(`[FCM] 丢弃 sent 时间戳非法的配对推送: type=${payload.type || 'server'} sent=${payload._sentEpochSec}`);
          continue;
        }
        if (lastProcessedSentAtMs > 0 && sentAtMs <= lastProcessedSentAtMs) {
          seen.add(key);
          if (pid) persistedIds.add(pid);
          writeListenerState({
            processedPersistentIds: Array.from(persistedIds),
            lastProcessedSentAtMs,
          }, resolvedConfigFile);
          logger.info(`[FCM] 丢弃已处理历史配对推送: type=${payload.type || 'server'} sentAt=${sentAtMs}`);
          continue;
        }
        // 只处理「开始监听之后」产生的配对消息，避免消费 FCM 历史积压导致误配对/误连接。
        if (payload._sentEpochSec && sentAtMs < (listenStartedAtMs - 2000)) {
          seen.add(key);
          if (pid) persistedIds.add(pid);
          writeListenerState({
            processedPersistentIds: Array.from(persistedIds),
            lastProcessedSentAtMs,
          }, resolvedConfigFile);
          logger.info(`[FCM] 丢弃监听前历史配对推送: type=${payload.type || 'server'} sentAt=${sentAtMs}`);
          continue;
        }
        const ageMs = Date.now() - sentAtMs;
        if (ageMs > PAIRING_MAX_AGE_MS) {
          seen.add(key);
          if (pid) persistedIds.add(pid);
          writeListenerState({
            processedPersistentIds: Array.from(persistedIds),
            lastProcessedSentAtMs,
          }, resolvedConfigFile);
          logger.info(`[FCM] 丢弃历史配对推送（超过3分钟）: type=${payload.type || 'server'} ageMs=${ageMs}`);
          continue;
        }

        seen.add(key);
        if (pid) persistedIds.add(pid);
        lastProcessedSentAtMs = Math.max(lastProcessedSentAtMs, sentAtMs);
        writeListenerState({
          processedPersistentIds: Array.from(persistedIds),
          lastProcessedSentAtMs,
        }, resolvedConfigFile);
        const playerIdSafe = payload.playerId ? `***${String(payload.playerId).slice(-6)}` : '-';
        logger.info(`[FCM] 收到配对数据！type=${payload.type || 'server'} entityId=${payload.entityId || '-'} ${payload.ip || '-'}:${payload.port || '-'} playerId=${playerIdSafe}`);
        onStatus({ type: 'pairing-payload', pairingType: payload.type || 'server' });
        onPairing(payload);
      }
    });

    proc.stderr.on('data', (chunk) => {
      logger.debug('[FCM ERR] ' + chunk.toString().trim());
    });

    proc.on('error', (err) => {
      logger.warn('[FCM] 监听进程异常: ' + err.message);
      onStatus({ type: 'error', message: err.message });
    });

    proc.on('close', (code, signal) => {
      logger.info(`[FCM] 监听进程退出，code=${code}${signal ? ` signal=${signal}` : ''}`);
      onStatus({ type: 'closed', code, signal: signal || null });
      if (stopped) return;
      scheduleRestart(`exit:${code ?? 'null'}`);
    });
  };

  spawnListener();

  return () => {
    stopped = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (proc && !proc.killed) proc.kill('SIGTERM');
    onStatus({ type: 'stopped' });
    logger.info('[FCM] 已停止监听。');
  };
}

module.exports = { registerFCM, listenForPairing };
