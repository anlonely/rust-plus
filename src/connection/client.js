// src/connection/client.js
// ─────────────────────────────────────────────
// P1 阶段：WebSocket 连接管理器
//
// 功能：
//   - 建立并维持与 Rust 游戏服务器的 WebSocket 连接
//   - 心跳保活（每 15 秒）
//   - 自动重连（指数退避，最多 5 次）
//   - 统一的请求/响应 Promise 封装
// ─────────────────────────────────────────────

const RustPlus = require('@liamcottle/rustplus.js');
const logger   = require('../utils/logger');

const MAX_RECONNECT      = parseInt(process.env.MAX_RECONNECT       || '20', 10);
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL  || '60', 10) * 1000;
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS   || '30000', 10);
const HEARTBEAT_FAIL_RECONNECT = parseInt(process.env.HEARTBEAT_FAIL_RECONNECT || '8', 10);
const ACTIVITY_GRACE_MS = parseInt(process.env.ACTIVITY_GRACE_MS || '90000', 10);
const DEEP_SEA_DEBUG = process.env.DEEP_SEA_DEBUG === '1';

function stripEmoji(text) {
  return String(text || '')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, '')
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/[\u200D\uFE0F]/gu, '');
}

class RustClient {
  /**
   * @param {object} serverConfig
   * @param {string} serverConfig.ip
   * @param {number} serverConfig.port
   * @param {string} serverConfig.playerId
   * @param {string|number} serverConfig.playerToken
   * @param {string} serverConfig.name
   */
  constructor(serverConfig) {
    this.config         = serverConfig;
    this.client         = null;
    this.connected      = false;
    this.reconnectCount = 0;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this._manualDisconnect = false;
    this._heartbeatFailures = 0;
    this._connecting = false;
    this._connectPromise = null;
    this._connectionSeq = 0;
    this._lastActivityAt = 0;
    this._lastConnectedAt = 0;
    this._lastDisconnectedAt = 0;
    this._lastError = '';

    /** 外部注册的事件监听器 { eventName: [callback, ...] } */
    this._listeners = {};
  }

  // ══════════════════════════════════════════
  // 连接管理
  // ══════════════════════════════════════════

  /** 建立连接 */
  async connect() {
    if (this.connected) return this;
    if (this._connectPromise) return this._connectPromise;

    const { ip, port, playerId, playerToken, name } = this.config;
    logger.info(`[Client] 正在连接服务器: ${name} (${ip}:${port})`);

    this._manualDisconnect = false;
    this._connecting = true;
    this._connectionSeq += 1;
    const seq = this._connectionSeq;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.client = new RustPlus(ip, port, playerId, playerToken);

    this._connectPromise = new Promise((resolve, reject) => {
      this.client.on('connected', () => {
        if (seq !== this._connectionSeq) return;
        this.connected      = true;
        this._connecting = false;
        this._connectPromise = null;
        this.reconnectCount = 0;
        this._heartbeatFailures = 0;
        this._lastActivityAt = Date.now();
        this._lastConnectedAt = Date.now();
        logger.info(`[Client] ✓ 已连接到 ${name}`);
        this._startHeartbeat();
        this._emit('connected');
        resolve(this);
      });

      this.client.on('disconnected', () => {
        if (seq !== this._connectionSeq) return;
        this.connected = false;
        this._connecting = false;
        this._connectPromise = null;
        this._stopHeartbeat();
        this._lastDisconnectedAt = Date.now();
        logger.warn(`[Client] 与 ${name} 断开连接`);
        this._emit('disconnected');
        if (!this._manualDisconnect) {
          this._tryReconnect();
        }
      });

      this.client.on('error', (err) => {
        if (seq !== this._connectionSeq) return;
        logger.error(`[Client] 连接错误: ${err.message}`);
        this._lastError = String(err?.message || 'unknown');
        this._emit('error', err);
        if (!this.connected) {
          this._connecting = false;
          this._connectPromise = null;
          reject(err);
        }
      });

      // 监听所有广播消息（事件引擎的数据来源）
      this.client.on('message', (msg) => {
        if (seq !== this._connectionSeq) return;
        this._lastActivityAt = Date.now();
        this._handleMessage(msg);
      });

      this.client.connect();
    });
    return this._connectPromise;
  }

  /** 主动断开 */
  disconnect() {
    this._connectionSeq += 1; // invalidate stale event handlers
    this._manualDisconnect = true;
    this._connecting = false;
    this._connectPromise = null;
    this._lastDisconnectedAt = Date.now();
    this._stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      this.client.disconnect();
      this.connected = false;
    }
    logger.info(`[Client] 已主动断开: ${this.config.name}`);
  }

  /** 自动重连（指数退避） */
  _tryReconnect() {
    if (this._manualDisconnect) return;
    if (this.connected || this._connecting) return;
    if (this.reconnectTimer) return;

    if (this.reconnectCount >= MAX_RECONNECT) {
      logger.error(`[Client] 已达最大重连次数(${MAX_RECONNECT})，放弃连接。`);
      this._emit('give_up');
      return;
    }

    const base = Math.min(Math.pow(2, this.reconnectCount) * 1000, 30000); // cap 30s
    const jitter = Math.floor(Math.random() * 500);
    const delay = base + jitter;
    this.reconnectCount++;

    logger.info(`[Client] ${delay / 1000}秒后尝试第 ${this.reconnectCount} 次重连...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.connected && !this._manualDisconnect) this.connect().catch(() => {});
    }, delay);
  }

  // ══════════════════════════════════════════
  // 心跳
  // ══════════════════════════════════════════

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      if (!this.connected || this._connecting) return;
      try {
        await this.getTime();
        this._heartbeatFailures = 0;
        this._lastActivityAt = Date.now();
      } catch {
        try {
          // 某些服务器对 getTime 响应不稳定，失败后再用 getInfo 二次探测
          await this.getServerInfo();
          this._heartbeatFailures = 0;
          this._lastActivityAt = Date.now();
          return;
        } catch {
          this._heartbeatFailures += 1;
          if (this._heartbeatFailures >= HEARTBEAT_FAIL_RECONNECT) {
            const inactiveMs = Date.now() - (this._lastActivityAt || 0);
            logger.warn(`[Client] 心跳连续失败 ${this._heartbeatFailures} 次，inactive=${inactiveMs}ms`);
            this._heartbeatFailures = 0;
            if (inactiveMs >= ACTIVITY_GRACE_MS) {
              logger.warn('[Client] 连接疑似僵死，触发受控重连');
              this._manualDisconnect = false;
              this._safeSocketResetAndReconnect();
            }
          } else {
            logger.debug(`[Client] 心跳探测失败 (${this._heartbeatFailures}/${HEARTBEAT_FAIL_RECONNECT})`);
          }
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

  _safeSocketResetAndReconnect() {
    try {
      if (this.client) this.client.disconnect();
    } catch (_) {
      // ignore
    }
    this.connected = false;
    this._connecting = false;
    this._connectPromise = null;
    this._lastDisconnectedAt = Date.now();
    this._tryReconnect();
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ══════════════════════════════════════════
  // 消息处理 & 事件分发
  // ══════════════════════════════════════════

  _handleMessage(msg) {
    if (!msg || !msg.broadcast) return;

    const bc = msg.broadcast;

    // 地图标记更新（载具、商人等）
    if (bc.teamChanged)   this._emit('teamChanged',   bc.teamChanged);
    if (bc.entityChanged) this._emit('entityChanged', bc.entityChanged);
    if (bc.teamMessage) {
      const tm = bc.teamMessage;
      const payload = tm?.message != null ? tm.message : tm;
      if (typeof payload === 'string') {
        this._emit('teamMessage', {
          message: payload,
          name: tm?.name || tm?.displayName || '',
          steamId: tm?.steamId || tm?.steamID || '',
          time: tm?.time || tm?.timestamp || Date.now(),
        });
      } else if (payload && typeof payload === 'object') {
        this._emit('teamMessage', payload);
      }
    }
    if (bc.mapEvent) {
      if (DEEP_SEA_DEBUG) {
        try {
          const raw = JSON.stringify(bc.mapEvent);
          logger.info(`[DeepSeaDebug] mapEvent=${raw.slice(0, 800)}`);
        } catch (_) {
          logger.info('[DeepSeaDebug] mapEvent=[unserializable]');
        }
      }
      this._emit('mapEvent', bc.mapEvent);
    }
  }

  /** 注册事件监听器 */
  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return this;
  }

  /** 触发事件 */
  _emit(event, ...args) {
    (this._listeners[event] || []).forEach(cb => {
      try { cb(...args); } catch (e) { logger.error(`[Client] 监听器错误: ${e.message}`); }
    });
  }

  // ══════════════════════════════════════════
  // Rust+ API 封装（Promise 化）
  // ══════════════════════════════════════════

  /** 封装 callback 风格为 Promise */
  _call(method, ...args) {
    return new Promise((resolve, reject) => {
      if (!this.connected) return reject(new Error('未连接到服务器'));
      if (!this.client || typeof this.client[method] !== 'function') {
        return reject(new Error(`不支持的方法: ${method}`));
      }
      const timeout = setTimeout(() => reject(new Error(`${method} 请求超时`)), REQUEST_TIMEOUT_MS);
      this.client[method](...args, (msg) => {
        clearTimeout(timeout);
        this._lastActivityAt = Date.now();
        if (msg.response?.error) {
          reject(new Error(msg.response.error.error || '未知错误'));
        } else {
          resolve(msg.response);
        }
      });
    });
  }

  _callRequest(request, timeoutMs = REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (!this.connected) return reject(new Error('未连接到服务器'));
      if (!this.client || typeof this.client.sendRequest !== 'function') {
        return reject(new Error('当前客户端不支持原始请求'));
      }
      const timeout = setTimeout(() => reject(new Error('请求超时')), timeoutMs);
      this.client.sendRequest(request, (msg) => {
        clearTimeout(timeout);
        this._lastActivityAt = Date.now();
        if (msg.response?.error) {
          reject(new Error(msg.response.error.error || '未知错误'));
          return;
        }
        resolve(msg.response);
      });
    });
  }

  /** 获取设备状态 */
  getEntityInfo(entityId) {
    return this._call('getEntityInfo', entityId);
  }

  /** 开启智能开关 */
  turnSwitchOn(entityId) {
    return this._call('turnSmartSwitchOn', entityId);
  }

  /** 关闭智能开关 */
  turnSwitchOff(entityId) {
    return this._call('turnSmartSwitchOff', entityId);
  }

  /** 获取服务器信息 */
  getServerInfo() {
    return this._call('getInfo');
  }

  /** 获取游戏时间 */
  getTime() {
    return this._call('getTime');
  }

  /** 获取队伍信息 */
  getTeamInfo() {
    return this._call('getTeamInfo');
  }

  /** 获取地图标记（货船/商人/油井等） */
  getMapMarkers() {
    return this._call('getMapMarkers');
  }

  /** 获取地图基础信息 */
  getMap() {
    return this._call('getMap');
  }

  /** 获取队伍聊天历史 */
  getTeamChat() {
    return this._callRequest({ getTeamChat: {} });
  }

  /** 将队长转移给指定 steamId */
  promoteToLeader(steamId) {
    const id = String(steamId || '').trim();
    if (!id) return Promise.reject(new Error('缺少目标 steamId'));
    return this._callRequest({ promoteToLeader: { steamId: id } });
  }

  getHealthStatus() {
    const now = Date.now();
    return {
      connected: this.connected,
      connecting: this._connecting,
      manualDisconnect: this._manualDisconnect,
      reconnectCount: this.reconnectCount,
      heartbeatFailures: this._heartbeatFailures,
      hasReconnectTimer: !!this.reconnectTimer,
      lastActivityAt: this._lastActivityAt || null,
      lastActivityAgoMs: this._lastActivityAt ? (now - this._lastActivityAt) : null,
      lastConnectedAt: this._lastConnectedAt || null,
      lastDisconnectedAt: this._lastDisconnectedAt || null,
      lastError: this._lastError || '',
      server: {
        name: this.config?.name || '',
        ip: this.config?.ip || '',
        port: this.config?.port || '',
      },
    };
  }

  /** 向团队聊天发送消息 */
  sendTeamMessage(message) {
    return this._call('sendTeamMessage', stripEmoji(message));
  }

  /**
   * 订阅设备状态变化广播
   * 注：必须先调用一次 getEntityInfo 才能收到后续广播
   */
  async subscribeEntity(entityId, callback) {
    await this.getEntityInfo(entityId);
    this.on('entityChanged', (data) => {
      if (data.entityId === entityId) callback(data);
    });
  }
}

module.exports = RustClient;
