// src/events/engine.js
// ─────────────────────────────────────────────
// P2 阶段：事件逻辑引擎
//
// 支持的事件类型（对应截图中所有标签）：
//   alarm_on / alarm_off         - 警报器通电/断电
//   player_status                - 队友状态整合事件（上线/下线/重生/死亡/挂机）
//   patrol_heli_enter/leave      - 武装直升机进入/离开
//   patrol_heli_explode          - 武装直升机爆炸（击落）
//   patrol_heli_active           - 武装直升机巡逻中
//   patrol_heli_status           - 武装直升机整合事件（进入/巡逻/离开/坠落）
//   cargo_ship_enter/leave       - 货船进入/离开
//   cargo_ship_active            - 货船航行中
//   cargo_ship_at_port           - 货船停靠港口
//   cargo_ship_status            - 货船整合事件（进入/离开/航行/停靠）
//   ch47_enter/ch47_active/leave - 军用运输直升机进入/飞行/离开
//   ch47_status                  - 军用运输直升机整合事件（进入/巡逻/离开）
//   vending_new                  - 新售货机出现
//   oil_rig_*                    - 大小石油箱子与重装科学家
//   oil_rig_status               - 石油整合事件（大小石油重装/解锁）
//   vendor_appear/move/stopped   - 流浪商人出现/移动/停留
//   vendor_leave                 - 流浪商人离开
//   vendor_status                - 流浪商人整合事件（进入/移动/停留/离开）
//   hourly_tick                  - 整点报时
//   day_phase_notice             - 天黑/天亮前置提醒（5分钟/1分钟）
//   deep_sea_open/close          - 深海开启/关闭
//   deep_sea_status              - 深海整合事件（开启/关闭）
// ─────────────────────────────────────────────

const logger = require('../utils/logger');
const {
  analyzeDeepSeaStatus,
  startDeepSeaCountdown,
  stopDeepSeaCountdown,
} = require('../utils/deep-sea');
const { extractGameSecondsFromPayload, buildServerInfoSnapshot } = require('../utils/server-info');
const { markerToGrid, markerToGrid9, markerToNearestEdgeDirection } = require('../utils/map-grid');
const { normalizeSteamId64 } = require('../utils/steam-id');
const { getDeepSeaState, saveDeepSeaState } = require('../storage/config');
const { pickVendingWatchMatches } = require('../utils/vending-watchlist');
const DEEP_SEA_DEBUG = process.env.DEEP_SEA_DEBUG === '1';
const DEEP_SEA_DURATION_SECONDS = Number(process.env.DEEP_SEA_COUNTDOWN_SECONDS || 3 * 60 * 60);
const CARGO_STOP_SPEED_THRESHOLD = Number(process.env.CARGO_STOP_SPEED_THRESHOLD || 0.35); // map units/sec
const CARGO_STOP_STREAK_REQUIRED = Number(process.env.CARGO_STOP_STREAK_REQUIRED || 2);
const CARGO_LEAVE_MISSING_TICKS = Number(process.env.CARGO_LEAVE_MISSING_TICKS || 2);
const CARGO_DOCK_RADIUS_DEFAULT = Number(process.env.CARGO_DOCK_RADIUS_DEFAULT || 170);
const OIL_RIG_CRATE_RADIUS = Number(process.env.OIL_RIG_CRATE_RADIUS || 240);
const OIL_RIG_CH47_RADIUS = Number(process.env.OIL_RIG_CH47_RADIUS || 300);
const OIL_RIG_CH47_DWELL_TICKS = Number(process.env.OIL_RIG_CH47_DWELL_TICKS || 2);
const OIL_RIG_HEAVY_DEDUP_MS = Number(process.env.OIL_RIG_HEAVY_DEDUP_MS || 4 * 60 * 1000);
const OIL_RIG_UNLOCK_DEDUP_MS = Number(process.env.OIL_RIG_UNLOCK_DEDUP_MS || 8 * 60 * 1000);
const OIL_RIG_UNLOCK_FALLBACK_MS = Number(process.env.OIL_RIG_UNLOCK_FALLBACK_MS || 15 * 60 * 1000);
const OIL_RIG_UNLOCK_RETRY_MS = Number(process.env.OIL_RIG_UNLOCK_RETRY_MS || 60 * 1000);
const MAP_ANCHOR_REFRESH_MS = Number(process.env.MAP_ANCHOR_REFRESH_MS || 15 * 60 * 1000);
const MAP_ANCHOR_RETRY_MS = Number(process.env.MAP_ANCHOR_RETRY_MS || 30 * 1000);
const HELI_CRASH_CHECK_WINDOW_MS = Number(process.env.HELI_CRASH_CHECK_WINDOW_MS || 30_000);
const HELI_CRASH_DISTANCE = Number(process.env.HELI_CRASH_DISTANCE || 300);
const HELI_EDGE_MARGIN_RATIO = 0.08; // 8% of map size = near edge
const CH47_LEAVE_MISSING_TICKS = Number(process.env.CH47_LEAVE_MISSING_TICKS || 2);
const TEAM_AFK_IDLE_MS = Number(process.env.TEAM_AFK_IDLE_MS || 15 * 60 * 1000);
const VENDOR_MOVE_EPSILON = Number(process.env.VENDOR_MOVE_EPSILON || 3);
const VENDOR_STOP_STREAK_REQUIRED = Number(process.env.VENDOR_STOP_STREAK_REQUIRED || 2);
const DAY_PHASE_REMINDER_MINUTES = [5, 1];
const DEEP_SEA_REMINDER_PLAN_MS = [
  60 * 60 * 1000,        // 剩余 2H
  120 * 60 * 1000,       // 剩余 1H
  170 * 60 * 1000,       // 剩余 10 分钟
  180 * 60 * 1000,       // 倒计时结束
];
const DEEP_SEA_REMINDER_TOTAL = DEEP_SEA_REMINDER_PLAN_MS.length;

function secondsToClock(totalSeconds = 0) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function clockToHm(clock = '00:00') {
  const m = String(clock || '').match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return '00小时00分';
  const hh = Number(m[1]);
  const mm = String(m[2]).padStart(2, '0');
  if (!Number.isFinite(hh) || hh <= 0) return `${mm}分`;
  return `${hh}小时${mm}分`;
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function buildPhaseTemplateContext(snapshot = {}, overrides = {}) {
  const phaseTarget = firstNonEmptyText(overrides.phase_target, overrides.phaseTarget, snapshot.phaseTarget, '日落');
  const phaseTargetShort = firstNonEmptyText(
    overrides.phase_target_short,
    overrides.phaseTargetShort,
    snapshot.phaseTargetShort,
    phaseTarget === '天亮' ? '天亮' : '天黑',
  );
  const dayPhase = firstNonEmptyText(overrides.day_phase, overrides.dayPhase, snapshot.phase, '白天');
  const hourlyTime = firstNonEmptyText(overrides.hourly_time, overrides.hourlyTime, snapshot.hhmm, '00:00');
  const realRemainSeconds = Number(
    overrides.real_remain_seconds
    ?? overrides.realRemainSeconds
    ?? snapshot.realRemainSeconds,
  );
  const realRemainClock = firstNonEmptyText(
    overrides.time_to_phase_clock,
    overrides.timeToPhaseClock,
    Number.isFinite(realRemainSeconds) ? secondsToClock(realRemainSeconds) : '',
    snapshot.remainClock,
    '00:00',
  );
  const phaseRemainText = firstNonEmptyText(
    overrides.time_to_phase_real,
    overrides.timeToPhaseReal,
    overrides.time_to_phase,
    overrides.timeToPhase,
    snapshot.realRemainText,
    snapshot.remainText,
    '0分0秒',
  );
  const remainMinutes = Number(snapshot.remainMinutes);
  const remainSeconds = Number(snapshot.remainSeconds);
  return {
    hourly_time: hourlyTime,
    hourlyTime,
    game_time: hourlyTime,
    gameTime: hourlyTime,
    day_phase: dayPhase,
    dayPhase,
    phase_target: phaseTarget,
    phaseTarget,
    phase_target_short: phaseTargetShort,
    phaseTargetShort,
    time_to_phase: phaseRemainText,
    timeToPhase: phaseRemainText,
    time_to_phase_real: phaseRemainText,
    timeToPhaseReal: phaseRemainText,
    time_to_phase_clock: realRemainClock,
    timeToPhaseClock: realRemainClock,
    time_to_phase_hm: clockToHm(realRemainClock),
    timeToPhaseHm: clockToHm(realRemainClock),
    real_remain_seconds: Number.isFinite(realRemainSeconds) ? Math.max(0, Math.round(realRemainSeconds)) : null,
    realRemainSeconds: Number.isFinite(realRemainSeconds) ? Math.max(0, Math.round(realRemainSeconds)) : null,
    phase_remain_seconds: Number.isFinite(remainMinutes) && Number.isFinite(remainSeconds)
      ? Math.max(0, Math.floor(remainMinutes) * 60 + Math.floor(remainSeconds))
      : null,
    phaseRemainSeconds: Number.isFinite(remainMinutes) && Number.isFinite(remainSeconds)
      ? Math.max(0, Math.floor(remainMinutes) * 60 + Math.floor(remainSeconds))
      : null,
  };
}

class EventEngine {
  constructor(options = {}) {
    /** 已注册的规则列表 */
    this.rules = [];

    /** 地图标记快照（用于 diff 检测状态变化） */
    this._prevMarkers = null;

    /** 队伍成员快照 */
    this._prevTeam = null;
    this._teamState = new Map();
    this._entitySnapshots = new Map();
    this._lastTeamOnlineCount = null;
    this._onRuleEnabledChanged = typeof options.onRuleEnabledChanged === 'function'
      ? options.onRuleEnabledChanged
      : null;
    this._bindContext = typeof options.bindContext === 'function'
      ? options.bindContext
      : ((fn) => fn);
    this._getDeepSeaState = typeof options.getDeepSeaState === 'function'
      ? options.getDeepSeaState
      : getDeepSeaState;
    this._saveDeepSeaState = typeof options.saveDeepSeaState === 'function'
      ? options.saveDeepSeaState
      : saveDeepSeaState;

    this._lastHourlyGameHour = null;
    this._dayPhaseReminderState = {
      target: '',
      fired: Object.create(null),
    };
    this._deepSeaState = { initialized: false, isOpen: false };
    this._deepSeaAwaitReset = false;
    this._deepSeaReminderTimer = null;
    this._deepSeaReminderCount = 0;
    this._deepSeaCycleStartedAt = 0;
    this._mapSize = null;
    this._mapSizeFetchedAt = 0;
    this._deepSeaPersist = {
      lastOpenAt: null,
      lastCloseAt: null,
      lastDirection: null,
      lastEntryGrid: null,
      lastEntryCoord: null,
    };
    this._deepSeaStateLoaded = false;
    this._cargoPresent = false;
    this._cargoMissingTicks = 0;
    this._cargoTracks = new Map();
    this._cargoInitialized = false;
    this._cargoHarbors = [];
    this._cargoDockRadius = CARGO_DOCK_RADIUS_DEFAULT;
    this._oilRigSites = [];
    this._oilRigCrates = new Map(); // signalMarkerId -> { rig, marker, firstSeenAt, source }
    this._oilRigCh47Tracks = new Map(); // ch47Id -> { rigKey, dwellTicks, heavyEmitted, marker }
    this._oilRigPendingUnlocks = new Map(); // rigKey -> { rig, dueAt }
    this._oilRigStageFiredAt = new Map(); // `${rigKey}:${stage}` -> timestamp
    this._mapAnchorsLoadedAt = 0;
    this._mapAnchorsLoadFailedAt = 0;
    this._heliInitialized = false;
    this._heliLast = new Map(); // heliId -> marker
    this._heliDisappear = new Map(); // heliId -> { lastMarker, disappearedAt }
    this._ch47Initialized = false;
    this._ch47Last = new Map(); // ch47Id -> marker
    this._ch47Missing = new Map(); // ch47Id -> { lastMarker, missingTicks }
    this._vendorMotionState = new Map(); // vendorId -> { moving: boolean, detectedByMotion: boolean, stopCandidateTicks: number }
  }

  // ══════════════════════════════════════════
  // 规则管理
  // ══════════════════════════════════════════

  /**
   * 注册一条事件规则
   * @param {object} rule
   * @param {string}   rule.id       - 唯一 ID
   * @param {string}   rule.name     - 规则名称
   * @param {string}   rule.event    - 事件类型（如 alarm_on）
   * @param {object}   rule.trigger  - 触发条件 { entityId?, cooldownMs? }
   * @param {Function[]} rule.actions - 动作函数列表 [async () => void]
   * @param {boolean}  rule.enabled  - 是否启用
   */
  addRule(rule) {
    const existing = this.rules.findIndex(r => r.id === rule.id);
    if (existing >= 0) {
      this.rules[existing] = { ...rule, _lastFired: 0 };
    } else {
      this.rules.push({ ...rule, _lastFired: 0 });
    }
    logger.info(`[EventEngine] 规则已注册: [${rule.event}] ${rule.name}`);
  }

  removeRule(id) {
    this.rules = this.rules.filter(r => r.id !== id);
  }

  setRuleEnabled(id, enabled) {
    const rule = this.rules.find(r => r.id === id);
    if (rule) rule.enabled = enabled;
  }

  // ══════════════════════════════════════════
  // 绑定数据源
  // ══════════════════════════════════════════

  /**
   * 将 RustClient 实例绑定到引擎
   * @param {RustClient} client
   */
  bind(client) {
    // 先清理旧的客户端监听器
    if (this._client && this._boundHandlers) {
      for (const [event, handler] of this._boundHandlers) {
        if (typeof this._client.off === 'function') this._client.off(event, handler);
      }
    }

    this._client = client;

    // 保存绑定的处理器引用，以便 unbind 时移除
    this._boundEntityHandler = this._bindContext((data) => this._onEntityChanged(data));
    this._boundTeamHandler   = this._bindContext((data) => this._onTeamChanged(data));
    this._boundHandlers = [
      ['entityChanged', this._boundEntityHandler],
      ['teamChanged',   this._boundTeamHandler],
    ];

    // 监听实体状态变化（警报器/开关）
    client.on('entityChanged', this._boundEntityHandler);

    // 监听队伍变化（队友上线/下线/挂机）
    client.on('teamChanged',   this._boundTeamHandler);

    // 启动地图标记轮询（10 秒间隔）
    this._mapPollTimer = setInterval(this._bindContext(() => this._pollMapMarkers()), 10_000);
    this._loadCargoHarbors().catch((e) => {
      logger.warn('[EventEngine] 货船港口数据加载失败: ' + e.message);
    });

    logger.info('[EventEngine] 已绑定客户端，事件监听启动');
  }

  ingestTeamSnapshot(data) {
    this._onTeamChanged(data);
  }

  unbind() {
    // 移除注册在客户端上的事件监听器
    if (this._client && this._boundHandlers) {
      for (const [event, handler] of this._boundHandlers) {
        if (typeof this._client.off === 'function') this._client.off(event, handler);
      }
      this._boundHandlers = null;
    }
    this._client = null;

    if (this._mapPollTimer)  clearInterval(this._mapPollTimer);
    this._stopDeepSeaReminderTimer();
    stopDeepSeaCountdown();
    this._cargoPresent = false;
    this._cargoMissingTicks = 0;
    this._cargoTracks.clear();
    this._cargoInitialized = false;
    this._cargoHarbors = [];
    this._cargoDockRadius = CARGO_DOCK_RADIUS_DEFAULT;
    this._oilRigSites = [];
    this._oilRigCrates.clear();
    this._oilRigCh47Tracks.clear();
    this._oilRigPendingUnlocks.clear();
    this._oilRigStageFiredAt.clear();
    this._mapAnchorsLoadedAt = 0;
    this._mapAnchorsLoadFailedAt = 0;
    this._heliInitialized = false;
    this._heliLast.clear();
    this._heliDisappear.clear();
    this._ch47Initialized = false;
    this._ch47Last.clear();
    this._ch47Missing.clear();
    this._vendorMotionState.clear();
  }

  // ══════════════════════════════════════════
  // 事件处理器
  // ══════════════════════════════════════════

  /** 警报器 / 开关状态变化 */
  _onEntityChanged({ entityId, payload }) {
    const hasStoragePayload = Array.isArray(payload?.items)
      || payload?.capacity != null
      || payload?.hasProtection != null
      || payload?.protectionExpiry != null;
    if (!hasStoragePayload) {
      const isOn = payload?.value === true || payload?.value === 1;
      const eventType = isOn ? 'alarm_on' : 'alarm_off';
      logger.debug(`[EventEngine] entityChanged: id=${entityId} state=${isOn}`);
      this._fire(eventType, { entityId, isOn });
    }

    this._processStorageEvents(entityId, payload || {});
  }

  _emitPlayerStatus(status, context = {}) {
    const map = {
      online: 'player_online',
      offline: 'player_offline',
      dead: 'player_dead',
      respawn: 'player_respawn',
      afk: 'player_afk',
      afk_recover: 'player_afk_recover',
    };
    const eventType = map[String(status || '').toLowerCase()];
    if (!eventType) return;
    const payload = {
      ...context,
      playerStatus: String(status || '').toLowerCase(),
      playerStatusEvent: eventType,
    };
    // 触发整合事件（向后兼容）
    this._fire('player_status', payload);
    // 触发单项事件
    this._fire(eventType, payload);
  }

  /** 获取挂机检测阈值（从 player_afk 规则中读取 afkMinutes，默认 15 分钟） */
  getAfkThresholdMs() {
    for (const rule of this.rules) {
      if (rule.event === 'player_afk' && rule.enabled) {
        const minutes = Number(rule.trigger?.afkMinutes);
        if (Number.isFinite(minutes) && minutes > 0) {
          return minutes * 60 * 1000;
        }
      }
    }
    return TEAM_AFK_IDLE_MS;
  }

  /** 队伍变化 */
  _onTeamChanged(data) {
    const rawMembers = data?.members || data?.teamInfo?.members || [];
    const members = Array.isArray(rawMembers)
      ? rawMembers
      : (rawMembers && typeof rawMembers === 'object' ? Object.values(rawMembers) : []);
    const onlineCount = members.filter((m) => !!m?.isOnline).length;

    if (!this._prevTeam) {
      const now = Date.now();
      members.forEach((m) => {
        this._teamState.set(normalizeSteamId64(m.steamId ?? m.steamID ?? m.memberId ?? m.id), {
          x: Number(m.x || 0),
          y: Number(m.y || 0),
          lastMoveAt: now,
          afkFired: false,
          isOnline: !!m.isOnline,
          isAlive: !!m.isAlive,
        });
      });
      this._prevTeam = members;
      this._lastTeamOnlineCount = onlineCount;
      this._fire('team_online_guard', { onlineCount });
      return;
    }

    const prevById = new Map(this._prevTeam.map((m) => [normalizeSteamId64(m.steamId ?? m.steamID ?? m.memberId ?? m.id), m]));
    const POS_EPSILON = 0.25;
    const now = Date.now();

    for (const m of members) {
      const key = normalizeSteamId64(m.steamId ?? m.steamID ?? m.memberId ?? m.id);
      const prev = prevById.get(key);
      const state = this._teamState.get(key) || {
        x: Number(m.x || 0),
        y: Number(m.y || 0),
        lastMoveAt: now,
        afkFired: false,
        isOnline: !!m.isOnline,
        isAlive: !!m.isAlive,
      };

      if (prev) {
        const prevSpawnTime = Number(prev?.spawnTime || 0);
        const currSpawnTime = Number(m?.spawnTime || 0);
        const prevDeathTime = Number(prev?.deathTime || 0);
        const currDeathTime = Number(m?.deathTime || 0);
        const deathByTimestamp = currDeathTime > 0 && currDeathTime > prevDeathTime;
        const respawnByTimestamp = currSpawnTime > 0 && currSpawnTime > prevSpawnTime;

        if (!prev.isOnline && m.isOnline) {
          logger.info(`[EventEngine] 队友上线: ${m.name}`);
          this._emitPlayerStatus('online', { member: { ...m, x: Number(m.x ?? prev.x ?? 0), y: Number(m.y ?? prev.y ?? 0) } });
        }
        if (prev.isOnline && !m.isOnline) {
          logger.info(`[EventEngine] 队友下线: ${m.name}`);
          this._emitPlayerStatus('offline', { member: { ...m, x: Number(m.x ?? prev.x ?? 0), y: Number(m.y ?? prev.y ?? 0) } });
        }
        if (
          (prev.isAlive && !m.isAlive)
          || (deathByTimestamp && (!respawnByTimestamp || currDeathTime >= currSpawnTime))
        ) {
          logger.info(`[EventEngine] 队友死亡: ${m.name}`);
          this._emitPlayerStatus('dead', { member: { ...m, x: Number(m.x ?? prev.x ?? 0), y: Number(m.y ?? prev.y ?? 0) } });
        }
        if (
          (!prev.isAlive && m.isAlive)
          || (respawnByTimestamp && (!deathByTimestamp || currSpawnTime > currDeathTime))
        ) {
          logger.info(`[EventEngine] 队友重生: ${m.name}`);
          this._emitPlayerStatus('respawn', { member: { ...m, x: Number(m.x ?? prev.x ?? 0), y: Number(m.y ?? prev.y ?? 0) } });
        }
      } else if (m.isOnline) {
        logger.info(`[EventEngine] 队友上线: ${m.name}`);
        this._emitPlayerStatus('online', { member: { ...m, x: Number(m.x || 0), y: Number(m.y || 0) } });
      }

      if (!m.isOnline) {
        state.afkFired = false;
        state.lastMoveAt = now;
      } else {
        const dx = Math.abs((Number(m.x || 0)) - (state.x || 0));
        const dy = Math.abs((Number(m.y || 0)) - (state.y || 0));
        if (dx > POS_EPSILON || dy > POS_EPSILON) {
          if (state.afkFired) {
            logger.info(`[EventEngine] 队友挂机恢复: ${m.name}`);
            this._emitPlayerStatus('afk_recover', { member: m, idleMs: now - state.lastMoveAt });
          }
          state.lastMoveAt = now;
          state.afkFired = false;
        } else if (!state.afkFired && now - state.lastMoveAt >= this.getAfkThresholdMs()) {
          logger.info(`[EventEngine] 队友挂机: ${m.name}`);
          this._emitPlayerStatus('afk', { member: m, idleMs: now - state.lastMoveAt });
          state.afkFired = true;
        }
      }

      state.x = Number(m.x || 0);
      state.y = Number(m.y || 0);
      state.isOnline = !!m.isOnline;
      state.isAlive = !!m.isAlive;
      this._teamState.set(key, state);
    }

    this._prevTeam = members;
    if (this._lastTeamOnlineCount !== onlineCount) {
      this._lastTeamOnlineCount = onlineCount;
      this._fire('team_online_guard', { onlineCount });
    }
  }

  /** 地图标记轮询（检测载具/商人事件） */
  async _pollMapMarkers() {
    if (!this._client?.connected) return;
    try {
      await this._loadDeepSeaState();
      await this._ensureMapSize();
      await this._refreshMapAnchorsIfNeeded();
      const [res, timeRes] = await Promise.all([
        this._client.getMapMarkers(),
        this._client.getTime().catch(() => null),
      ]);
      const markers = res?.mapMarkers?.markers || [];
      this._diffMapMarkers(markers);
      this._flushOilRigUnlockFallbacks();
      const gameSeconds = extractGameSecondsFromPayload(timeRes, null);
      const gameTime = gameSeconds == null ? {} : { time: gameSeconds };
      await this._checkDeepSea(markers, gameTime);
      this._checkHourlyTick(timeRes || gameTime);
      this._checkDayPhaseNotice(timeRes);
      this._prevMarkers = markers;
    } catch (e) {
      logger.debug('[EventEngine] getMapMarkers 失败: ' + e.message);
    }
  }

  async _refreshMapAnchorsIfNeeded() {
    if (!this._client?.connected) return;
    const now = Date.now();
    const stale = !this._mapAnchorsLoadedAt || (now - this._mapAnchorsLoadedAt >= MAP_ANCHOR_REFRESH_MS);
    const missingOilRig = !Array.isArray(this._oilRigSites) || this._oilRigSites.length === 0;
    const retryableFail = this._mapAnchorsLoadFailedAt && (now - this._mapAnchorsLoadFailedAt >= MAP_ANCHOR_RETRY_MS);
    if (!stale && !(missingOilRig && retryableFail)) return;
    try {
      await this._loadCargoHarbors();
    } catch (_) {
      // _loadCargoHarbors 内部已记录失败时间和日志
    }
  }

  _checkHourlyTick(timeInfo = {}) {
    const gameSeconds = extractGameSecondsFromPayload(timeInfo, null);
    if (gameSeconds == null) return;
    const hour = ((Math.floor(gameSeconds / 3600) % 24) + 24) % 24;
    if (this._lastHourlyGameHour == null) {
      this._lastHourlyGameHour = hour;
      return;
    }
    if (hour === this._lastHourlyGameHour) return;
    this._lastHourlyGameHour = hour;
    if (hour % 4 !== 0) return;
    const hourlyTime = `${String(hour).padStart(2, '0')}:00`;
    const snap = buildServerInfoSnapshot(null, timeInfo);
    const phaseCtx = buildPhaseTemplateContext(snap, { hourly_time: hourlyTime });
    logger.info(`[EventEngine] 游戏4小时报时触发: ${hourlyTime}`);
    this._fire('hourly_tick', {
      time: new Date().toLocaleTimeString(),
      ...phaseCtx,
    });
  }

  _checkDayPhaseNotice(timeInfo = {}) {
    const snap = buildServerInfoSnapshot(null, timeInfo);
    const phaseTargetShort = String(
      snap?.phaseTargetShort || (snap?.phaseTarget === '天亮' ? '天亮' : '天黑'),
    ).trim();
    const realRemainSeconds = Number(snap?.realRemainSeconds);
    if (!phaseTargetShort || !Number.isFinite(realRemainSeconds)) return;

    if (this._dayPhaseReminderState.target !== phaseTargetShort) {
      this._dayPhaseReminderState = {
        target: phaseTargetShort,
        fired: Object.create(null),
      };
    }

    for (const minute of DAY_PHASE_REMINDER_MINUTES) {
      const key = String(minute);
      if (this._dayPhaseReminderState.fired[key]) continue;
      const thresholdSec = minute * 60;
      if (realRemainSeconds > thresholdSec) continue;
      this._dayPhaseReminderState.fired[key] = true;
      const phaseCtx = buildPhaseTemplateContext(snap);
      logger.info(`[EventEngine] 天黑/天亮提醒触发: 距离${phaseTargetShort}约${minute}分钟 (${snap.hhmm || '--:--'})`);
      this._fire('day_phase_notice', {
        time: new Date().toLocaleTimeString(),
        ...phaseCtx,
        phase_reminder_minute: minute,
        phaseReminderMinute: minute,
      });
    }
  }

  async _ensureMapSize() {
    const FRESH_MS = 10 * 60 * 1000;
    if (Number.isFinite(this._mapSize) && this._mapSize > 0 && Date.now() - this._mapSizeFetchedAt < FRESH_MS) {
      return;
    }
    if (!this._client?.connected) return;
    try {
      const infoRes = await this._client.getServerInfo();
      const mapSize = Number(
        infoRes?.info?.mapSize
        ?? infoRes?.mapSize
        ?? infoRes?.response?.info?.mapSize
      );
      if (Number.isFinite(mapSize) && mapSize > 0) {
        this._mapSize = mapSize;
        this._mapSizeFetchedAt = Date.now();
      }
    } catch (e) {
      if (DEEP_SEA_DEBUG) logger.debug('[DeepSeaDebug] 获取 mapSize 失败: ' + e.message);
    }
  }

  async _loadDeepSeaState() {
    if (this._deepSeaStateLoaded) return;
    try {
      this._deepSeaPersist = await this._getDeepSeaState();
    } catch (e) {
      logger.warn('[EventEngine] 深海状态加载失败: ' + e.message);
    } finally {
      this._deepSeaStateLoaded = true;
    }
  }

  async _persistDeepSeaState(patch = {}) {
    try {
      this._deepSeaPersist = await this._saveDeepSeaState({ ...this._deepSeaPersist, ...patch });
    } catch (e) {
      logger.warn('[EventEngine] 深海状态保存失败: ' + e.message);
    }
  }

  async _checkDeepSea(markers, timeInfo) {
    const status = analyzeDeepSeaStatus({
      markers,
      timeInfo,
      mapSize: this._mapSize,
      lastOpenAt: this._deepSeaPersist.lastOpenAt,
      lastCloseAt: this._deepSeaPersist.lastCloseAt,
    });
    if (DEEP_SEA_DEBUG) {
      const gameTimeRaw = Number(timeInfo?.time ?? timeInfo);
      logger.info(
        `[DeepSeaDebug] timeRaw=${Number.isFinite(gameTimeRaw) ? gameTimeRaw : '-'} ` +
        `isOpen=${status.isOpen} signal=${status.signalOpen} countdown=${status.countdownSeconds || '-'} ` +
        `dir=${status.direction || '-'} entry=${status.entryGrid || '-'} remain=${status.realRemainText} next=${status.nextTarget}`,
      );
    }
    if (!this._deepSeaState.initialized) {
      this._deepSeaState = { initialized: true, isOpen: false };
    }
    if (this._deepSeaAwaitReset) {
      if (!status.signalOpen) this._deepSeaAwaitReset = false;
      else return;
    }

    const countdownActive = status.countdownSeconds != null;
    const shouldStart = status.signalOpen && !this._deepSeaState.isOpen;
    const shouldResume = shouldStart && status.shouldResumeCountdown && countdownActive;

    if (shouldStart) {
      const resumeSeconds = shouldResume ? status.countdownSeconds : null;
      this._deepSeaState.isOpen = true;
      logger.info('[EventEngine] 深海状态变化: 开启');
      this._startDeepSeaCycle(markers, timeInfo, resumeSeconds, status);
      const payload = {
        deepSea: {
          ...status,
          realRemainText: status.realRemainText,
          realRemainClock: status.realRemainClock,
          realRemainHms: status.realRemainHms,
          countdownSeconds: resumeSeconds ?? DEEP_SEA_DURATION_SECONDS,
        },
      };
      this._fire('deep_sea_open', payload);
      this._fire('deep_sea_status', { ...payload, deepSeaStage: 'open' });
      return;
    }

    if (this._deepSeaState.isOpen && !countdownActive) {
      await this._handleDeepSeaClose(status);
    }
  }

  _stopDeepSeaReminderTimer() {
    if (!this._deepSeaReminderTimer) return;
    clearTimeout(this._deepSeaReminderTimer);
    this._deepSeaReminderTimer = null;
  }

  async _handleDeepSeaClose(status = {}) {
    this._deepSeaState.isOpen = false;
    this._deepSeaAwaitReset = true;
    const closeAt = this._deepSeaCycleStartedAt
      ? this._deepSeaCycleStartedAt + DEEP_SEA_DURATION_SECONDS * 1000
      : Date.now();
    await this._persistDeepSeaState({ lastCloseAt: new Date(closeAt).toISOString() });
    this._stopDeepSeaCycle();
    const payload = {
      deepSea: { ...status, isOpen: false },
    };
    this._fire('deep_sea_close', payload);
    this._fire('deep_sea_status', { ...payload, deepSeaStage: 'close' });
  }

  _stopDeepSeaCycle() {
    this._stopDeepSeaReminderTimer();
    this._deepSeaReminderCount = 0;
    this._deepSeaCycleStartedAt = 0;
    stopDeepSeaCountdown();
  }

  _startDeepSeaCycle(markers, timeInfo, resumeSeconds = null, detection = null) {
    this._stopDeepSeaCycle();
    const durationSec = DEEP_SEA_DURATION_SECONDS;
    const remaining = resumeSeconds != null ? Math.max(1, Math.floor(resumeSeconds)) : durationSec;
    startDeepSeaCountdown(remaining);
    const startMs = Date.now() - (durationSec - remaining) * 1000;
    this._deepSeaCycleStartedAt = startMs;
    const elapsedMs = Math.max(0, Date.now() - startMs);
    const alreadyFired = DEEP_SEA_REMINDER_PLAN_MS.filter((ms) => ms <= elapsedMs).length;
    this._deepSeaReminderCount = Math.min(alreadyFired, DEEP_SEA_REMINDER_TOTAL);
    this._persistDeepSeaState({
      lastOpenAt: new Date(startMs).toISOString(),
      lastDirection: detection?.direction ?? this._deepSeaPersist.lastDirection ?? null,
      lastEntryGrid: detection?.entryGrid ?? this._deepSeaPersist.lastEntryGrid ?? null,
      lastEntryCoord: detection?.entryCoord ?? this._deepSeaPersist.lastEntryCoord ?? null,
    });
  }

  _getCargoMarkers(markers = []) {
    return (Array.isArray(markers) ? markers : []).filter((m) => {
      if (!m) return false;
      if (m.type === 5) return true;
      return String(m.type || '').toLowerCase() === 'cargoship';
    });
  }

  _pickNearestCargoTrack(marker, maxDistance = 240) {
    const mx = Number(marker?.x);
    const my = Number(marker?.y);
    if (!Number.isFinite(mx) || !Number.isFinite(my)) return null;
    let best = null;
    let bestDist = Infinity;
    for (const track of this._cargoTracks.values()) {
      const tx = Number(track?.x);
      const ty = Number(track?.y);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
      const d = Math.hypot(mx - tx, my - ty);
      if (d < bestDist) {
        bestDist = d;
        best = track;
      }
    }
    if (best && bestDist <= maxDistance) return best;
    return null;
  }

  async _loadCargoHarbors() {
    if (!this._client?.connected) return;
    try {
      const [mapRes, infoRes] = await Promise.all([
        this._client.getMap().catch(() => null),
        this._client.getServerInfo().catch(() => null),
      ]);
      const monuments = mapRes?.map?.monuments
        || mapRes?.response?.map?.monuments
        || mapRes?.monuments
        || [];
      const allMonuments = Array.isArray(monuments) ? monuments : [];
      const harbors = allMonuments.filter((m) => {
        const token = String(m?.token || m?.name || '').toLowerCase();
        return token.includes('harbor')
          || token.includes('harbour')
          || token.includes('ferry_terminal')
          || token.includes('ferryterminal');
      }).map((m) => {
        const token = String(m?.token || m?.name || 'harbor');
        const x = Number(m?.x);
        const y = Number(m?.y);
        const name = token.includes('harbor_1') ? '大型港口'
          : token.includes('harbor_2') ? '小型港口'
          : (token.includes('ferry_terminal') || token.includes('ferryterminal')) ? '渡轮码头'
          : '港口';
        const grid = Number.isFinite(this._mapSize)
          ? markerToGrid({ x, y }, this._mapSize)
          : null;
        return { token, x, y, name, grid };
      }).filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y));

      const detectOilRigSize = (token = '') => {
        const t = String(token || '').toLowerCase();
        if (!t) return '';
        if (t.includes('large_oil_rig') || t.includes('oilrig_2') || t.includes('largerig')) return 'large';
        if (t.includes('oil_rig_small') || t.includes('small_oil_rig') || t.includes('oilrig_1') || t.includes('smallrig')) return 'small';
        if (t.includes('oil')) return 'small';
        return '';
      };
      const oilRigs = allMonuments.map((m) => {
        const token = String(m?.token || m?.name || '').toLowerCase();
        const size = detectOilRigSize(token);
        if (!size) return null;
        const x = Number(m?.x);
        const y = Number(m?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const name = size === 'large' ? '大石油' : '小石油';
        const grid = Number.isFinite(this._mapSize) ? markerToGrid({ x, y }, this._mapSize) : null;
        const key = `${size}:${Math.round(x)}:${Math.round(y)}`;
        return { token, x, y, size, name, grid, key };
      }).filter(Boolean);

      this._cargoHarbors = harbors;
      this._oilRigSites = oilRigs;
      const mapSize = Number(
        infoRes?.info?.mapSize
        ?? infoRes?.mapSize
        ?? infoRes?.response?.info?.mapSize
        ?? 0,
      );
      if (Number.isFinite(mapSize) && mapSize > 0) {
        if (!Number.isFinite(this._mapSize) || this._mapSize <= 0) this._mapSize = mapSize;
        this._cargoDockRadius = Math.max(120, mapSize / 30);
      }
      this._mapAnchorsLoadedAt = Date.now();
      this._mapAnchorsLoadFailedAt = 0;
      logger.info(`[EventEngine] 地图锚点已加载: harbors=${harbors.length} oilRigs=${oilRigs.length} dockRadius=${Math.round(this._cargoDockRadius)}`);
    } catch (e) {
      this._mapAnchorsLoadFailedAt = Date.now();
      throw e;
    }
  }

  _nearestHarbor(marker = {}) {
    const mx = Number(marker?.x);
    const my = Number(marker?.y);
    if (!Number.isFinite(mx) || !Number.isFinite(my) || !this._cargoHarbors.length) return null;
    let best = null;
    let bestDist = Infinity;
    for (const harbor of this._cargoHarbors) {
      const d = Math.hypot(mx - harbor.x, my - harbor.y);
      if (d < bestDist) {
        bestDist = d;
        best = harbor;
      }
    }
    if (!best) return null;
    const grid = best.grid || (Number.isFinite(this._mapSize) ? markerToGrid(best, this._mapSize) : null);
    return { ...best, distance: bestDist, grid };
  }

  _bootstrapCargoState(markers = []) {
    const cargoMarkers = this._getCargoMarkers(markers);
    this._cargoPresent = cargoMarkers.length > 0;
    this._cargoMissingTicks = 0;
    const tracks = new Map();
    for (const marker of cargoMarkers) {
      const id = String(marker?.id ?? `cargo_${tracks.size}`);
      tracks.set(id, {
        x: Number(marker?.x),
        y: Number(marker?.y),
        stoppedStreak: 0,
        dockedStreak: 0,
        movingStreak: 0,
        atPortFired: false,
        lastMarker: marker,
      });
    }
    this._cargoTracks = tracks;
    this._cargoInitialized = true;
  }

  _updateCargoEvents(currMarkers = []) {
    const cargoMarkers = this._getCargoMarkers(currMarkers);
    const hasCargo = cargoMarkers.length > 0;

    if (!this._cargoPresent && hasCargo) {
      this._cargoPresent = true;
      this._cargoMissingTicks = 0;
      const entryGrid = markerToGrid9(cargoMarkers[0], this._mapSize || 0);
      const payload = { marker: cargoMarkers[0], grid: entryGrid };
      this._fire('cargo_ship_enter', payload);
      this._fire('cargo_ship_status', { ...payload, cargoStage: 'enter' });
    }

    if (this._cargoPresent && !hasCargo) {
      this._cargoMissingTicks += 1;
      if (this._cargoMissingTicks >= CARGO_LEAVE_MISSING_TICKS) {
        this._cargoPresent = false;
        this._cargoMissingTicks = 0;
        const lastTrack = Array.from(this._cargoTracks.values())[0] || null;
        const lastMarker = lastTrack?.lastMarker || {};
        this._cargoTracks.clear();
        const leaveGrid = markerToGrid9(lastMarker, this._mapSize || 0);
        const payload = { marker: lastMarker, grid: leaveGrid };
        this._fire('cargo_ship_leave', payload);
        this._fire('cargo_ship_status', { ...payload, cargoStage: 'leave' });
      }
      return;
    }
    if (hasCargo) this._cargoMissingTicks = 0;

    const nextTracks = new Map();
    for (const marker of cargoMarkers) {
      const id = String(marker?.id ?? '');
      const prev = this._cargoTracks.get(id) || this._pickNearestCargoTrack(marker) || null;
      const px = Number(prev?.x);
      const py = Number(prev?.y);
      const mx = Number(marker?.x);
      const my = Number(marker?.y);
      const dist = (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(mx) && Number.isFinite(my))
        ? Math.hypot(mx - px, my - py)
        : null;
      const derivedSpeed = dist != null ? (dist / 10) : null;
      const isStopped = derivedSpeed != null ? (derivedSpeed < CARGO_STOP_SPEED_THRESHOLD) : false;
      const nearestHarbor = this._nearestHarbor(marker);
      const nearHarbor = !!(nearestHarbor && nearestHarbor.distance <= this._cargoDockRadius);
      const stoppedStreak = isStopped ? ((prev?.stoppedStreak || 0) + 1) : 0;
      const dockedStreak = (isStopped && nearHarbor) ? ((prev?.dockedStreak || 0) + 1) : 0;
      const movingStreak = isStopped ? 0 : ((prev?.movingStreak || 0) + 1);
      let atPortFired = !!prev?.atPortFired;
      const markerGrid = markerToGrid9(marker, this._mapSize || 0);

      if (!isStopped) {
        const payload = {
          marker,
          grid: markerGrid,
          speed: derivedSpeed != null ? Number(derivedSpeed.toFixed(2)) : null,
        };
        this._fire('cargo_ship_active', payload);
        this._fire('cargo_ship_status', { ...payload, cargoStage: 'active' });
      }

      const dockCondition = this._cargoHarbors.length
        ? (dockedStreak >= CARGO_STOP_STREAK_REQUIRED)
        : (stoppedStreak >= (CARGO_STOP_STREAK_REQUIRED + 1));
      if (dockCondition && !atPortFired) {
        const harborGrid = nearestHarbor?.grid || null;
        const payload = { marker, harbor: nearestHarbor || null, grid: markerGrid, harborGrid };
        this._fire('cargo_ship_at_port', payload);
        this._fire('cargo_ship_status', { ...payload, cargoStage: 'dock' });
        atPortFired = true;
      }
      if (movingStreak >= 2) atPortFired = false;

      nextTracks.set(id || `cargo_${nextTracks.size}`, {
        x: mx,
        y: my,
        stoppedStreak,
        dockedStreak,
        movingStreak,
        atPortFired,
        lastMarker: marker,
      });
    }
    this._cargoTracks = nextTracks;
  }

  _getHeliMarkers(markers = []) {
    return (Array.isArray(markers) ? markers : []).filter((m) => {
      if (!m) return false;
      if (m.type === 8) return true;
      return String(m.type || '').toLowerCase() === 'patrolhelicopter';
    });
  }

  _getExplosionMarkers(markers = []) {
    return (Array.isArray(markers) ? markers : []).filter((m) => Number(m?.type) === 2);
  }

  _getCh47Markers(markers = []) {
    return (Array.isArray(markers) ? markers : []).filter((m) => {
      if (!m) return false;
      if (Number(m.type) === 4) return true;
      const tText = String(m.type || '').toLowerCase();
      return tText === 'ch47' || tText === 'chinook';
    });
  }

  _isCrateMarker(marker = {}) {
    return this._isOilRigSignalMarker(marker);
  }

  _isOilRigSignalMarker(marker = {}) {
    const tNum = Number(marker?.type);
    const tText = String(marker?.type || '').toLowerCase();
    const name = String(marker?.name || '').toLowerCase();

    if (tNum === 6 || tText.includes('crate')) return true;
    if (name) {
      if (name.includes('crate') || name.includes('hack') || name.includes('locked')) return true;
      if (name.includes('oil') || name.includes('rig') || name.includes('heavy')) return true;
    }
    if (tNum === 7 || tText.includes('genericradius')) {
      const radius = Number(marker?.radius || 0);
      if (name) {
        return /oil|rig|crate|hack|locked|heavy|scientist/.test(name);
      }
      return Number.isFinite(radius) && radius > 0;
    }
    return false;
  }

  _isLikelyTravelingVendorName(marker = {}) {
    const token = String(marker?.name || '').toLowerCase();
    if (!token) return false;
    return (
      token.includes('traveling')
      || token.includes('travelling')
      || token.includes('wandering')
      || token.includes('traveling_vendor')
      || token.includes('流浪')
      || token.includes('移动商人')
    );
  }

  _isTravelingVendorMarker(marker = {}, prevMarker = null) {
    const tNum = Number(marker?.type);
    if (tNum === 9) return true;
    const tText = String(marker?.type || '').toLowerCase();
    if (tText === 'travelingvendor' || tText === 'traveling_vendor' || tText === 'vendor') return true;
    if (this._isLikelyTravelingVendorName(marker)) return true;
    if (tNum !== 3 || !prevMarker) return false;
    const dx = Math.abs(Number(marker?.x || 0) - Number(prevMarker?.x || 0));
    const dy = Math.abs(Number(marker?.y || 0) - Number(prevMarker?.y || 0));
    return dx > VENDOR_MOVE_EPSILON || dy > VENDOR_MOVE_EPSILON;
  }

  _findNearestOilRig(marker = {}, maxDistance = OIL_RIG_CRATE_RADIUS) {
    const mx = Number(marker?.x);
    const my = Number(marker?.y);
    if (!Number.isFinite(mx) || !Number.isFinite(my) || !this._oilRigSites.length) return null;
    let best = null;
    let bestDist = Infinity;
    for (const site of this._oilRigSites) {
      const d = Math.hypot(mx - Number(site?.x), my - Number(site?.y));
      if (d < bestDist) {
        bestDist = d;
        best = site;
      }
    }
    if (!best || bestDist > maxDistance) return null;
    return { ...best, distance: bestDist };
  }

  _oilRigKey(rig = {}) {
    if (rig?.key) return String(rig.key);
    const size = String(rig?.size || '');
    const x = Number(rig?.x);
    const y = Number(rig?.y);
    return `${size}:${Math.round(x)}:${Math.round(y)}`;
  }

  _getOilRigStageCooldownMs(stage = '') {
    const s = String(stage || '').toLowerCase();
    return s.includes('unlock') ? OIL_RIG_UNLOCK_DEDUP_MS : OIL_RIG_HEAVY_DEDUP_MS;
  }

  _buildOilRigPayload({ marker = {}, rig = null, oilStage = '', source = 'marker', inferred = false, activeMs = null } = {}) {
    const rx = Number(rig?.x);
    const ry = Number(rig?.y);
    const mx = Number(marker?.x);
    const my = Number(marker?.y);
    const refMarker = (Number.isFinite(mx) && Number.isFinite(my))
      ? marker
      : (Number.isFinite(rx) && Number.isFinite(ry) ? { x: rx, y: ry } : marker);
    const grid = markerToGrid9(refMarker, this._mapSize || 0)
      || rig?.grid
      || (Number.isFinite(rx) && Number.isFinite(ry) ? markerToGrid({ x: rx, y: ry }, this._mapSize || 0) : null);
    return {
      marker: refMarker,
      rig,
      grid,
      oilStage,
      source,
      inferred: !!inferred,
      activeMs: Number.isFinite(activeMs) ? Math.max(0, Math.round(activeMs)) : null,
    };
  }

  _emitOilRigStage({ rig = null, marker = {}, oilStage = '', source = 'marker', inferred = false, activeMs = null } = {}) {
    if (!rig) return false;
    const stage = String(oilStage || '').toLowerCase();
    if (!stage) return false;
    const rigKey = this._oilRigKey(rig);
    if (!rigKey) return false;

    const dedupeKey = `${rigKey}:${stage}`;
    const now = Date.now();
    const lastAt = Number(this._oilRigStageFiredAt.get(dedupeKey) || 0);
    const cooldownMs = this._getOilRigStageCooldownMs(stage);
    if (lastAt && now - lastAt < cooldownMs) return false;
    this._oilRigStageFiredAt.set(dedupeKey, now);

    const payload = this._buildOilRigPayload({ marker, rig, oilStage: stage, source, inferred, activeMs });
    const legacyEvent = ({
      large_heavy: 'oil_rig_large_heavy_called',
      small_heavy: 'oil_rig_small_heavy_called',
      large_unlock: 'oil_rig_large_crate_unlock',
      small_unlock: 'oil_rig_small_crate_unlock',
    })[stage];
    if (legacyEvent) this._fire(legacyEvent, payload);
    this._fire('oil_rig_status', payload);
    return true;
  }

  _armOilRigUnlockFallback(rig = {}, anchorMs = Date.now()) {
    const rigKey = this._oilRigKey(rig);
    if (!rigKey) return;
    const dueAt = Number(anchorMs || Date.now()) + OIL_RIG_UNLOCK_FALLBACK_MS;
    const prev = this._oilRigPendingUnlocks.get(rigKey);
    if (!prev || dueAt < prev.dueAt) {
      this._oilRigPendingUnlocks.set(rigKey, { rig, dueAt });
    }
  }

  _clearOilRigUnlockFallback(rig = {}) {
    const rigKey = this._oilRigKey(rig);
    if (!rigKey) return;
    this._oilRigPendingUnlocks.delete(rigKey);
  }

  _hasActiveOilRigSignalFor(rig = {}) {
    const rigKey = this._oilRigKey(rig);
    if (!rigKey) return false;
    for (const rec of this._oilRigCrates.values()) {
      if (this._oilRigKey(rec?.rig) === rigKey) return true;
    }
    return false;
  }

  _flushOilRigUnlockFallbacks() {
    if (!this._oilRigPendingUnlocks.size) return;
    const now = Date.now();
    for (const [rigKey, rec] of this._oilRigPendingUnlocks.entries()) {
      if (!rec || now < Number(rec?.dueAt || 0)) continue;
      if (this._hasActiveOilRigSignalFor(rec.rig)) {
        this._oilRigPendingUnlocks.set(rigKey, { ...rec, dueAt: now + OIL_RIG_UNLOCK_RETRY_MS });
        continue;
      }
      const stage = rec?.rig?.size === 'large' ? 'large_unlock' : 'small_unlock';
      this._emitOilRigStage({
        rig: rec.rig,
        marker: rec.rig || {},
        oilStage: stage,
        source: 'timer',
        inferred: true,
      });
      this._oilRigPendingUnlocks.delete(rigKey);
    }
  }

  _findNearbyExplosion(referenceMarker, explosions = []) {
    const rx = Number(referenceMarker?.x);
    const ry = Number(referenceMarker?.y);
    if (!Number.isFinite(rx) || !Number.isFinite(ry)) return null;
    let best = null;
    let bestDist = Infinity;
    for (const exp of explosions) {
      const ex = Number(exp?.x);
      const ey = Number(exp?.y);
      if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue;
      const d = Math.hypot(rx - ex, ry - ey);
      if (d < bestDist) {
        bestDist = d;
        best = exp;
      }
    }
    if (best && bestDist <= HELI_CRASH_DISTANCE) return { marker: best, distance: bestDist };
    return null;
  }

  _isHeliNearMapEdge(marker = {}) {
    const size = Number(this._mapSize);
    if (!Number.isFinite(size) || size <= 0) return true; // 没有地图尺寸信息时默认当作离场
    const mx = Number(marker?.x);
    const my = Number(marker?.y);
    if (!Number.isFinite(mx) || !Number.isFinite(my)) return true;
    const margin = size * HELI_EDGE_MARGIN_RATIO;
    return mx < margin || mx > size - margin || my < margin || my > size - margin;
  }

  _bootstrapHeliState(markers = []) {
    const helis = this._getHeliMarkers(markers);
    this._heliLast = new Map(helis.map((m) => [String(m.id), m]));
    this._heliDisappear.clear();
    this._heliInitialized = true;
  }

  _updateHeliEvents(currMarkers = []) {
    const now = Date.now();
    const currHelis = this._getHeliMarkers(currMarkers);
    const explosions = this._getExplosionMarkers(currMarkers);
    const currMap = new Map(currHelis.map((m) => [String(m.id), m]));

    for (const [id, marker] of currMap.entries()) {
      if (!this._heliLast.has(id)) {
        this._fire('patrol_heli_enter', { marker });
        this._fire('patrol_heli_status', { marker, heliStage: 'enter' });
      }
      this._fire('patrol_heli_active', { marker });
      this._fire('patrol_heli_status', { marker, heliStage: 'active' });
    }

    for (const [id, marker] of this._heliLast.entries()) {
      if (!currMap.has(id) && !this._heliDisappear.has(id)) {
        this._heliDisappear.set(id, {
          lastMarker: marker,
          disappearedAt: now,
        });
      }
    }

    const resolved = [];
    for (const [id, rec] of this._heliDisappear.entries()) {
      const elapsed = now - Number(rec?.disappearedAt || now);
      const nearby = this._findNearbyExplosion(rec?.lastMarker || {}, explosions);
      if (nearby) {
        const grid = markerToGrid9(nearby.marker, this._mapSize || 0) || markerToGrid9(rec?.lastMarker || {}, this._mapSize || 0);
        const payload = {
          marker: nearby.marker,
          heliLastMarker: rec?.lastMarker || {},
          crashDistance: nearby.distance,
          grid: String(grid || '').split('-')[0] || '',
        };
        this._fire('patrol_heli_explode', payload);
        this._fire('patrol_heli_status', { ...payload, heliStage: 'explode' });
        resolved.push(id);
        continue;
      }
      if (elapsed >= HELI_CRASH_CHECK_WINDOW_MS) {
        const lastMarker = rec?.lastMarker || {};
        const nearEdge = this._isHeliNearMapEdge(lastMarker);
        if (nearEdge) {
          // 在地图边缘消失 → 离开
          const payload = { marker: lastMarker };
          this._fire('patrol_heli_leave', payload);
          this._fire('patrol_heli_status', { ...payload, heliStage: 'leave' });
        } else {
          // 在地图中部消失但没有爆炸标记 → 推定坠落，使用最后已知位置
          const grid = markerToGrid9(lastMarker, this._mapSize || 0);
          const payload = {
            marker: lastMarker,
            heliLastMarker: lastMarker,
            crashDistance: 0,
            grid: String(grid || '').split('-')[0] || '',
          };
          this._fire('patrol_heli_explode', payload);
          this._fire('patrol_heli_status', { ...payload, heliStage: 'explode' });
        }
        resolved.push(id);
      }
    }
    for (const id of resolved) this._heliDisappear.delete(id);

    this._heliLast = currMap;
  }

  _bootstrapCh47State(markers = []) {
    const list = this._getCh47Markers(markers);
    this._ch47Last = new Map(list.map((m, idx) => [String(m?.id ?? `ch47_${idx}`), m]));
    this._ch47Missing.clear();
    this._ch47Initialized = true;
  }

  _updateCh47Events(currMarkers = []) {
    const curr = this._getCh47Markers(currMarkers);
    const currMap = new Map(curr.map((m, idx) => [String(m?.id ?? `ch47_${idx}`), m]));

    for (const [id, marker] of currMap.entries()) {
      if (!this._ch47Last.has(id)) {
        this._fire('ch47_enter', { marker });
        this._fire('ch47_status', { marker, ch47Stage: 'enter' });
      }
      this._fire('ch47_active', { marker });
      this._fire('ch47_status', { marker, ch47Stage: 'active' });
      this._ch47Missing.delete(id);
    }

    for (const [id, marker] of this._ch47Last.entries()) {
      if (currMap.has(id)) continue;
      const rec = this._ch47Missing.get(id) || { lastMarker: marker, missingTicks: 0 };
      rec.lastMarker = marker;
      rec.missingTicks += 1;
      if (rec.missingTicks >= CH47_LEAVE_MISSING_TICKS) {
        const payload = { marker: rec.lastMarker || marker };
        this._fire('ch47_leave', payload);
        this._fire('ch47_status', { ...payload, ch47Stage: 'leave' });
        this._ch47Missing.delete(id);
        continue;
      }
      this._ch47Missing.set(id, rec);
    }

    this._updateOilRigByCh47(currMap);
    this._ch47Last = currMap;
  }

  _updateOilRigByCh47(currMap = new Map()) {
    if (!this._oilRigSites.length) {
      this._oilRigCh47Tracks.clear();
      return;
    }
    const next = new Map();
    for (const [id, marker] of currMap.entries()) {
      const rig = this._findNearestOilRig(marker, OIL_RIG_CH47_RADIUS);
      if (!rig) continue;
      const prev = this._oilRigCh47Tracks.get(id);
      const rigKey = this._oilRigKey(rig);
      const sameRig = prev && prev.rigKey === rigKey;
      const dwellTicks = sameRig ? ((prev?.dwellTicks || 0) + 1) : 1;
      let heavyEmitted = sameRig ? !!prev?.heavyEmitted : false;

      if (dwellTicks >= OIL_RIG_CH47_DWELL_TICKS) {
        const stage = rig.size === 'large' ? 'large_heavy' : 'small_heavy';
        if (!heavyEmitted) {
          this._emitOilRigStage({
            rig,
            marker,
            oilStage: stage,
            source: 'ch47',
            inferred: true,
          });
          heavyEmitted = true;
        }
        this._armOilRigUnlockFallback(rig, Date.now());
      }

      next.set(id, { rigKey, dwellTicks, heavyEmitted, marker });
    }
    this._oilRigCh47Tracks = next;
  }

  /**
   * 对比前后地图标记，检测事件
   * Marker type 值（来自 Rust+ proto）：
   *   1 = Player      2 = Explosion    4 = CH47
   *   5 = CargoShip   6 = Crate        7 = GenericRadius
   *   8 = PatrolHeli
   */
  _diffMapMarkers(curr) {
    if (!this._prevMarkers) return;
    if (!this._cargoInitialized) this._bootstrapCargoState(this._prevMarkers);
    if (!this._heliInitialized) this._bootstrapHeliState(this._prevMarkers);
    if (!this._ch47Initialized) this._bootstrapCh47State(this._prevMarkers);

    const prevById = Object.fromEntries(this._prevMarkers.map(m => [m.id, m]));
    const currById = Object.fromEntries(curr.map(m => [m.id, m]));

    // 新出现的标记
    for (const m of curr) {
      if (!prevById[m.id]) {
        if (Number(m?.type) === 3 && !this._isTravelingVendorMarker(m, null)) {
          const matches = pickVendingWatchMatches(m?.sellOrders || [], m);
          if (matches.names.length) {
            this._fire('vending_new', {
              marker: m,
              vendingStage: 'new',
              vendingItemIds: matches.ids,
              vendingItems: matches.names,
            });
          }
        }
        if (this._isTravelingVendorMarker(m, null)) {
          this._fire('vendor_appear', { marker: m });
          this._fire('vendor_status', { marker: m, vendorStage: 'enter' });
          this._vendorMotionState.set(String(m.id), {
            moving: false,
            detectedByMotion: true,
            stopCandidateTicks: 0,
          });
        }
        if (this._isCrateMarker(m)) {
          const rig = this._findNearestOilRig(m);
          if (rig) {
            const seenAt = Date.now();
            this._oilRigCrates.set(String(m.id), {
              rig,
              marker: m,
              firstSeenAt: seenAt,
              source: 'marker',
            });
            const stage = rig.size === 'large' ? 'large_heavy' : 'small_heavy';
            this._emitOilRigStage({
              rig,
              marker: m,
              oilStage: stage,
              source: 'marker',
              inferred: false,
            });
            this._armOilRigUnlockFallback(rig, seenAt);
          }
        }
      }
    }

    // 消失的标记
    for (const m of this._prevMarkers) {
      if (!currById[m.id]) {
        if (this._isTravelingVendorMarker(m, null)) {
          this._fire('vendor_leave', { marker: m });
          this._fire('vendor_status', { marker: m, vendorStage: 'leave' });
          this._vendorMotionState.delete(String(m.id));
        }
        if (this._isCrateMarker(m)) {
          const rec = this._oilRigCrates.get(String(m.id));
          const rig = rec?.rig || this._findNearestOilRig(rec?.marker || m);
          if (rig) {
            const stage = rig.size === 'large' ? 'large_unlock' : 'small_unlock';
            this._emitOilRigStage({
              rig,
              marker: rec?.marker || m,
              oilStage: stage,
              source: rec?.source || 'marker',
              inferred: false,
              activeMs: rec?.firstSeenAt ? (Date.now() - rec.firstSeenAt) : null,
            });
            this._clearOilRigUnlockFallback(rig);
          }
          this._oilRigCrates.delete(String(m.id));
        }
      }
    }

    for (const m of curr) {
      if (!this._isCrateMarker(m)) continue;
      const rec = this._oilRigCrates.get(String(m.id));
      if (rec) rec.marker = m;
    }

    this._updateCargoEvents(curr);
    this._updateHeliEvents(curr);
    this._updateCh47Events(curr);

    // 商人状态变化
    for (const m of curr) {
      const prev = prevById[m.id];
      if (!prev) continue;
      if (Number(m?.type) === 3 && !this._isTravelingVendorMarker(m, prev)) {
        const currentMatches = pickVendingWatchMatches(m?.sellOrders || [], m);
        const previousMatches = pickVendingWatchMatches(prev?.sellOrders || [], prev);
        if (currentMatches.names.length) {
          const previousKeySet = new Set(previousMatches.keys || []);
          const addedItems = [];
          const addedIds = [];
          const addedKeys = [];
          for (let index = 0; index < currentMatches.keys.length; index += 1) {
            const key = currentMatches.keys[index];
            if (previousKeySet.has(key)) continue;
            addedKeys.push(key);
            addedIds.push(currentMatches.ids[index]);
            addedItems.push(currentMatches.names[index]);
          }
          if (addedItems.length) {
            this._fire('vending_new', {
              marker: m,
              vendingStage: 'update',
              vendingItemIds: addedIds,
              vendingItems: addedItems,
            });
          }
        }
      }
      const dx = Math.abs(Number(m?.x || 0) - Number(prev?.x || 0));
      const dy = Math.abs(Number(m?.y || 0) - Number(prev?.y || 0));
      const moving = dx > VENDOR_MOVE_EPSILON || dy > VENDOR_MOVE_EPSILON;
      let rec = this._vendorMotionState.get(String(m.id)) || {
        moving: false,
        detectedByMotion: false,
        stopCandidateTicks: 0,
      };
      if (this._isLikelyTravelingVendorName(m)) rec.detectedByMotion = true;
      const shouldTreatAsVendor = this._isTravelingVendorMarker(m, prev) || rec.detectedByMotion;
      if (!shouldTreatAsVendor) continue;
      if (moving && !rec.detectedByMotion) {
        this._fire('vendor_appear', { marker: m });
        this._fire('vendor_status', { marker: m, vendorStage: 'enter' });
        rec.detectedByMotion = true;
      }
      const wasMoving = !!rec.moving;
      if (moving && !wasMoving) {
        this._fire('vendor_move', { marker: m });
        this._fire('vendor_status', { marker: m, vendorStage: 'move' });
      }
      if (moving) {
        rec.stopCandidateTicks = 0;
      } else if (wasMoving) {
        rec.stopCandidateTicks = 1;
      } else if (rec.stopCandidateTicks > 0) {
        rec.stopCandidateTicks += 1;
      }
      if (!moving && rec.stopCandidateTicks >= VENDOR_STOP_STREAK_REQUIRED) {
        this._fire('vendor_stopped', { marker: m });
        this._fire('vendor_status', { marker: m, vendorStage: 'stopped' });
        rec.stopCandidateTicks = -1;
      }
      rec.moving = moving;
      this._vendorMotionState.set(String(m.id), rec);
    }
  }

  // ══════════════════════════════════════════
  // 规则触发
  // ══════════════════════════════════════════

  async _fire(eventType, context = {}) {
    const now = Date.now();

    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (rule.event !== eventType) continue;

      // 检查 entityId 过滤
      if (rule.trigger?.entityId && context.entityId !== rule.trigger.entityId) continue;
      if (rule.trigger?.memberName) {
        const n = String(rule.trigger.memberName).toLowerCase();
        const current = String(context.member?.name || '').toLowerCase();
        if (!current || current !== n) continue;
      }
      if (rule.trigger?.itemShortName) {
        const itemRule = String(rule.trigger.itemShortName || '').toLowerCase().trim();
        const key = String(context.itemKey || '').toLowerCase().trim();
        if (!itemRule || !key || itemRule !== key) continue;
      }
      if (eventType === 'cargo_ship_status') {
        const stage = String(context.cargoStage || '').toLowerCase();
        const stageKey = ({
          enter: 'cargoNotifyEnter',
          leave: 'cargoNotifyLeave',
          active: 'cargoNotifyActive',
          dock: 'cargoNotifyDock',
        })[stage] || '';
        if (!stageKey) continue;
        if (rule.trigger?.[stageKey] === false) continue;
      }
      if (eventType === 'oil_rig_status') {
        const stage = String(context.oilStage || '').toLowerCase();
        const stageKey = ({
          large_heavy: 'oilNotifyLargeHeavy',
          small_heavy: 'oilNotifySmallHeavy',
          large_unlock: 'oilNotifyLargeUnlock',
          small_unlock: 'oilNotifySmallUnlock',
        })[stage] || '';
        if (!stageKey) continue;
        if (rule.trigger?.[stageKey] === false) continue;
      }
      if (eventType === 'ch47_status') {
        const stage = String(context.ch47Stage || '').toLowerCase();
        const stageKey = ({
          enter: 'ch47NotifyEnter',
          active: 'ch47NotifyActive',
          leave: 'ch47NotifyLeave',
        })[stage] || '';
        if (!stageKey) continue;
        if (rule.trigger?.[stageKey] === false) continue;
      }
      if (eventType === 'patrol_heli_status') {
        const stage = String(context.heliStage || '').toLowerCase();
        const stageKey = ({
          enter: 'heliNotifyEnter',
          active: 'heliNotifyActive',
          leave: 'heliNotifyLeave',
          explode: 'heliNotifyExplode',
        })[stage] || '';
        if (!stageKey) continue;
        if (rule.trigger?.[stageKey] === false) continue;
      }
      if (eventType === 'vendor_status') {
        const stage = String(context.vendorStage || '').toLowerCase();
        const stageKey = ({
          enter: 'vendorNotifyEnter',
          move: 'vendorNotifyMove',
          stopped: 'vendorNotifyStopped',
          leave: 'vendorNotifyLeave',
        })[stage] || '';
        if (!stageKey) continue;
        if (rule.trigger?.[stageKey] === false) continue;
      }
      if (eventType === 'deep_sea_status') {
        const stage = String(context.deepSeaStage || '').toLowerCase();
        const stageKey = ({
          open: 'deepSeaNotifyOpen',
          close: 'deepSeaNotifyClose',
        })[stage] || '';
        if (!stageKey) continue;
        if (rule.trigger?.[stageKey] === false) continue;
      }
      if (rule.trigger?.threshold != null) {
        const threshold = Number(rule.trigger.threshold);
        if (Number.isFinite(threshold)) {
          const value = Number(
            context.itemQty != null ? context.itemQty
              : (context.thresholdValue != null ? context.thresholdValue : NaN),
          );
          if (!Number.isFinite(value)) continue;
          const mode = String(context.thresholdMode || rule.trigger.thresholdMode || 'gte').toLowerCase();
          if (mode === 'lte') {
            if (value > threshold) continue;
          } else if (value < threshold) {
            continue;
          }
        }
      }

      if (eventType === 'team_online_guard') {
        const onlineCount = Number(context.onlineCount);
        if (!Number.isFinite(onlineCount)) continue;
        const threshold = Number(rule.trigger?.onlineThreshold ?? 1);
        const targetRuleId = String(rule.trigger?.targetRuleId || '').trim();
        if (!targetRuleId) continue;
        if (targetRuleId === rule.id) continue;

        let shouldEnable = null;
        if (onlineCount > threshold) shouldEnable = false;
        else if (onlineCount < threshold) shouldEnable = true;
        else continue;

        const targetRule = this.rules.find((r) => r.id === targetRuleId);
        if (!targetRule) continue;
        if (!!targetRule.enabled === shouldEnable) continue;

        targetRule.enabled = shouldEnable;
        logger.info(`[EventEngine] 队伍在线人数=${onlineCount}，自动${shouldEnable ? '启用' : '禁用'}规则: ${targetRule.name || targetRule.id}`);
        if (this._onRuleEnabledChanged) {
          try {
            await this._onRuleEnabledChanged({
              ruleId: targetRule.id,
              enabled: shouldEnable,
              reason: 'team_online_guard',
              onlineCount,
              threshold,
              sourceRuleId: rule.id,
            });
          } catch (e) {
            logger.warn('[EventEngine] 自动切换规则持久化失败: ' + e.message);
          }
        }
      }

      // 检查冷却
      const cooldown = rule.trigger?.cooldownMs || 0;
      if (eventType !== 'team_online_guard' && now - (rule._lastFired || 0) < cooldown) {
        logger.debug(`[EventEngine] 规则「${rule.name}」冷却中`);
        continue;
      }

      rule._lastFired = now;
      logger.info(`[EventEngine] 触发规则: 「${rule.name}」 (${eventType})`);

      // 依次执行动作
      for (const action of rule.actions || []) {
        try {
          await action(context, this._client);
        } catch (e) {
          logger.error(`[EventEngine] 动作执行失败: ${e.message}`);
        }
      }
    }
  }

  _processStorageEvents(entityId, payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (!items.length && payload?.hasProtection == null && payload?.protectionExpiry == null) return;

    const prev = this._entitySnapshots.get(entityId) || { items: new Map(), totalQty: 0, capacity: 0 };
    const currItems = new Map();
    for (const item of items) {
      const itemId = Number(item?.itemId);
      if (!Number.isFinite(itemId)) continue;
      const qty = Number(item?.quantity || 0);
      currItems.set(`itemId:${itemId}`, Math.max(0, Math.floor(qty)));
    }
    const currTotal = Array.from(currItems.values()).reduce((a, b) => a + b, 0);
    const capacity = Number(payload?.capacity || 0);

    const allKeys = new Set([...prev.items.keys(), ...currItems.keys()]);
    for (const key of allKeys) {
      const prevQty = prev.items.get(key) || 0;
      const currQty = currItems.get(key) || 0;
      if (prevQty !== currQty) {
        this._fire('storage_item_change', {
          entityId,
          itemKey: key,
          itemQty: currQty,
          prevQty,
          delta: currQty - prevQty,
        });
      }
      if (currQty > 0) {
        this._fire('storage_item_above', {
          entityId,
          itemKey: key,
          itemQty: currQty,
          prevQty,
          thresholdValue: currQty,
        });
      }
      if (prevQty > 0 && currQty === 0) {
        this._fire('storage_item_empty', {
          entityId,
          itemKey: key,
          itemQty: 0,
          prevQty,
        });
      }
    }

    if (prev.totalQty > 0 && currTotal === 0) {
      this._fire('storage_container_empty', { entityId, totalQty: currTotal, capacity });
    }
    if (capacity > 0 && prev.totalQty < capacity && currTotal >= capacity) {
      this._fire('storage_container_full', { entityId, totalQty: currTotal, capacity });
    }

    if (payload?.hasProtection === true && payload?.protectionExpiry) {
      const nowSec = Math.floor(Date.now() / 1000);
      const leftSec = Math.max(0, Number(payload.protectionExpiry) - nowSec);
      this._fire('tc_upkeep_left', {
        entityId,
        thresholdValue: Math.floor(leftSec / 60),
        thresholdMode: 'lte',
        leftSec,
      });
    }

    this._entitySnapshots.set(entityId, {
      items: currItems,
      totalQty: currTotal,
      capacity,
    });
  }
}

module.exports = EventEngine;
