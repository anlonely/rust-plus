require('dotenv').config();
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const path   = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const logger = require('../src/utils/logger');
const {
  initDbs,
  saveServer,
  listServers,
  listDevices,
  registerDevice,
  updateDevice,
  removeDevice,
  removeServerCascade,
  getLastServerId,
  setLastServerId,
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
const { registerFCM, listenForPairing } = require('../src/pairing/fcm');
const RustClient           = require('../src/connection/client');
const EventEngine          = require('../src/events/engine');
const CommandParser        = require('../src/commands/parser');
const { notify }           = require('../src/notify/service');
const {
  setGroup,
  listGroups,
  removeGroup,
  callGroup,
  getTeamChatIntervalMs,
  TEAM_CHAT_SETTINGS_GROUP_ID,
} = require('../src/call/groups');
const { listPresets, getEventPreset, getCommandPreset } = require('../src/presets');
const { getSteamProfileStatus, logoutSteam } = require('../src/steam/profile');
const { formatServerInfoText, buildServerInfoSnapshot } = require('../src/utils/server-info');
const { markerToGrid9, markerToNearestEdgeDirection } = require('../src/utils/map-grid');
const { toSafeExternalUrl } = require('../src/utils/security');
const { consumeRateLimit, RateLimitError } = require('../src/utils/rate-limit');
const { createTeamChatDispatcher } = require('../src/utils/team-chat-dispatcher');
const { getItemById, matchItems } = require('../src/utils/item-catalog');
const { normalizeServerMapPayload } = require('../src/utils/server-map-payload');
const { enrichMapDataWithRustMaps } = require('../src/utils/rustmaps');
const { getConfigDir } = require('../src/utils/runtime-paths');
const { normalizeEventRuleInput, normalizeCommandRuleInput, normalizeCallGroupInput } = require('../src/utils/web-config-rules');
const {
  VENDING_NEW_WATCH_ITEM_IDS,
  VENDING_NEW_WATCH_ITEM_NAMES,
} = require('../src/utils/vending-watchlist');
const TEAM_CHAT_MAX_CHARS = Math.max(32, Number(process.env.RUST_TEAM_MESSAGE_MAX_CHARS || 128) || 128);
const TEAM_CHAT_RPM_LIMIT = Math.max(1, Number(process.env.GUI_TEAM_CHAT_RPM || 20) || 20);
const FALLBACK_TEAM_CHAT_INTERVAL_MS = 3_000;

let mainWindow = null;
let tray = null;
let rustClient = null;
let eventEngine = null;
let cmdParser = null;
let fcmStopFn = null;
let latestServerInfoText = '未知服务器 人数:0/0排队:[0] 时间:00:00 白天 - 距离日落还有约0分0秒';
let latestServerInfo = buildServerInfoSnapshot(null, null);
let serverInfoRefreshTimer = null;
let teamInfoPollTimer = null;
let teamChatPollTimer = null;
let teamChatSeenKeys = new Set();
let teamChatSeenOrder = [];
let lastTeamBroadcastAt = 0;
let lastTeamPollAt = 0;
let teamSyncStatusTimer = null;
let activeServerId = null;
let pairingNoNotificationTimer = null;
const VERSION = '1.0.0';
const LEGACY_CARGO_STAGE_BY_EVENT = {
  cargo_ship_enter: 'enter',
  cargo_ship_leave: 'leave',
  cargo_ship_active: 'active',
  cargo_ship_at_port: 'dock',
};
const LEGACY_OIL_STAGE_BY_EVENT = {
  oil_rig_large_heavy_called: 'large_heavy',
  oil_rig_small_heavy_called: 'small_heavy',
  oil_rig_large_crate_unlock: 'large_unlock',
  oil_rig_small_crate_unlock: 'small_unlock',
};
const LEGACY_CH47_STAGE_BY_EVENT = {
  ch47_enter: 'enter',
  ch47_active: 'active',
  ch47_leave: 'leave',
};
const LEGACY_HELI_STAGE_BY_EVENT = {
  patrol_heli_enter: 'enter',
  patrol_heli_active: 'active',
  patrol_heli_leave: 'leave',
  patrol_heli_explode: 'explode',
};
const LEGACY_VENDOR_STAGE_BY_EVENT = {
  vendor_appear: 'enter',
  vendor_move: 'move',
  vendor_stopped: 'stopped',
  vendor_leave: 'leave',
};
const LEGACY_DEEPSEA_STAGE_BY_EVENT = {
  deep_sea_open: 'open',
  deep_sea_close: 'close',
};
const DEFAULT_CARGO_STAGE_MESSAGES = {
  enter: '货船进入地图｜当前位置:{cargo_grid}',
  leave: '货船已离开地图｜最后位置:{cargo_grid}',
  active: '货船航行中｜当前位置:{cargo_grid}',
  dock: '货船已停靠 ｜{cargo_harbor} [{cargo_harbor_grid}]',
};
const DEFAULT_OIL_STAGE_MESSAGES = {
  large_heavy: '大石油重装已呼叫｜方向：{oil_direction}',
  small_heavy: '小石油重装已呼叫｜方向：{oil_direction}',
  large_unlock: '大石油箱子已解锁｜方向：{oil_direction}',
  small_unlock: '小石油箱子已解锁｜方向：{oil_direction}',
};
const LEGACY_DEFAULT_OIL_STAGE_MESSAGES = {
  large_heavy: '大石油重装已呼叫｜位置:{oil_grid}',
  small_heavy: '小石油重装已呼叫｜位置:{oil_grid}',
  large_unlock: '大石油箱子已解锁｜位置:{oil_grid}',
  small_unlock: '小石油箱子已解锁｜位置:{oil_grid}',
};
const DEFAULT_CH47_STAGE_MESSAGES = {
  enter: '军用运输直升机进入地图｜当前位置:{marker_grid}',
  active: '军用运输直升机巡逻中｜当前位置:{marker_grid}',
  leave: '军用运输直升机已离开地图｜最后位置:{marker_grid}',
};
const DEFAULT_HELI_STAGE_MESSAGES = {
  enter: '武直进入地图｜当前位置:{marker_grid}',
  active: '武直巡逻中｜当前位置:{marker_grid}',
  leave: '武直已离开地图｜最后位置:{marker_grid}',
  explode: '武直已被击落｜坠落位置:{marker_grid}',
};
const DEFAULT_VENDOR_STAGE_MESSAGES = {
  enter: '流浪商人进入地图｜当前位置:{marker_grid}',
  move: '流浪商人移动中｜当前位置:{marker_grid}',
  stopped: '流浪商人停留｜停留位置:{marker_grid}',
  leave: '流浪商人离开地图｜最后位置:{marker_grid}',
};
const LEGACY_DEEPSEA_OPEN_MESSAGE = '深海已开启｜位于地图[{deep_sea_direction}]方向深处';
const NEW_DEEPSEA_OPEN_MESSAGE = '｜ 深海已开启｜';
const DEFAULT_DEEPSEA_STAGE_MESSAGES = {
  open: NEW_DEEPSEA_OPEN_MESSAGE,
  close: '深海已关闭',
};
const DEFAULT_PLAYER_STATUS_MESSAGES = {
  online: '{member}已上线｜上线位置:{member_grid}',
  offline: '{member}已离线｜离线位置:{member_grid}',
  dead: '{member}已死亡｜死亡位置:{member_grid}',
  respawn: '{member}已重生｜当前位置:{member_grid}',
  afk: '{member}挂机已持续15分钟｜当前位置:{member_grid}',
};
const LEGACY_PLAYER_STATUS_EVENTS = new Set([
  'player_online',
  'player_offline',
  'player_dead',
  'player_respawn',
  'player_afk',
]);
const DEFAULT_VENDING_NEW_MESSAGE = '发现 {vending_items}上架售货机 | 坐标:[{marker_grid}]';
const TEAMCHAT_CONNECTED_BROADCAST = '安静的Rust工具已连接 - 输入help查看全部可触发指令';

function getGlobalTeamChatIntervalMs() {
  return Math.max(1_000, Number(getTeamChatIntervalMs()) || FALLBACK_TEAM_CHAT_INTERVAL_MS);
}

function normalizeEventRuleForServer(rule, serverId) {
  return normalizeEventRuleInput(rule, serverId, { defaultCooldownMs: getGlobalTeamChatIntervalMs() });
}

function normalizeCommandRuleForServer(rule, serverId) {
  return normalizeCommandRuleInput(rule, serverId, { defaultCooldownMs: getGlobalTeamChatIntervalMs() });
}

const dispatchTeamChat = createTeamChatDispatcher({
  normalizeMessage: normalizeTeamMessageText,
  getIntervalMs: () => getGlobalTeamChatIntervalMs(),
  sendMessage: async (message) => {
    if (!rustClient?.connected) throw new Error('未连接');
    await rustClient.sendTeamMessage(message);
  },
});

function normalizeVendingNewTrigger(trigger = {}) {
  const next = { ...(trigger || {}) };
  const ids = Array.isArray(next.vendingWatchItemIds)
    ? next.vendingWatchItemIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    : [];
  const names = Array.isArray(next.vendingWatchItemNames)
    ? next.vendingWatchItemNames.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  next.vendingWatchItemIds = ids.length ? ids : [...VENDING_NEW_WATCH_ITEM_IDS];
  next.vendingWatchItemNames = names.length ? names : [...VENDING_NEW_WATCH_ITEM_NAMES];
  return next;
}

function sanitizeServerInfoText(text) {
  return String(text || '').replace(/^【/, '').replace(/】$/, '').trim();
}

function clockToHm(clock = '00:00') {
  const m = String(clock || '').match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return '00小时00分';
  const hh = Number(m[1]);
  const mm = String(m[2]).padStart(2, '0');
  if (!Number.isFinite(hh) || hh <= 0) return `${mm}分`;
  return `${hh}小时${mm}分`;
}

function secondsToClock(totalSeconds = 0) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeDeepSeaStageMessages(messages = {}) {
  const merged = {
    ...DEFAULT_DEEPSEA_STAGE_MESSAGES,
    ...(messages || {}),
  };
  const open = String(merged.open || '').trim();
  if (!open || open === LEGACY_DEEPSEA_OPEN_MESSAGE) {
    merged.open = NEW_DEEPSEA_OPEN_MESSAGE;
  }
  const close = String(merged.close || '').trim();
  if (!close) merged.close = DEFAULT_DEEPSEA_STAGE_MESSAGES.close;
  return merged;
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function normalizeTeamMessageText(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const chars = Array.from(text);
  if (chars.length <= TEAM_CHAT_MAX_CHARS) return text;
  return `${chars.slice(0, Math.max(1, TEAM_CHAT_MAX_CHARS - 1)).join('')}…`;
}

async function sendTeamChatWithGuards(rawMessage) {
  if (!rustClient?.connected) return { error: '未连接' };
  const message = normalizeTeamMessageText(rawMessage);
  if (!message) return { error: '消息不能为空' };
  try {
    consumeRateLimit('gui_team_chat_send', {
      limit: TEAM_CHAT_RPM_LIMIT,
      windowMs: 60_000,
      message: `发送过于频繁：每分钟最多 ${TEAM_CHAT_RPM_LIMIT} 条`,
    });
    await dispatchTeamChat(message);
    return { success: true };
  } catch (e) {
    if (e instanceof RateLimitError || e?.code === 'RATE_LIMIT') {
      return { error: e.message, code: 'RATE_LIMIT' };
    }
    return { error: String(e?.message || e || '发送失败') };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 760,
    minHeight: 520,
    frame: false,
    backgroundColor: '#0f1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
  mainWindow.once('ready-to-show', () => { mainWindow.show(); });
  if (process.env.NODE_ENV === 'development') mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, '../assets/tray.png');
    const img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) return;

    tray = new Tray(img);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Rust 工具箱', enabled: false },
      { type: 'separator' },
      { label: '显示主窗口', click: () => mainWindow?.show() },
      { label: '重新连接', click: () => autoConnect() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]));
    tray.setToolTip('Rust 工具箱');
    tray.on('double-click', () => mainWindow?.show());
  } catch (e) {
    logger.debug('[Main] 托盘图标未找到: ' + e.message);
  }
}

function buildActionsFromMeta(meta, eventType) {
  const actions = [];
  const msg = meta.message || `事件触发: ${eventType}`;
  const metaActions = Array.isArray(meta.actions) ? meta.actions : [];
  const resolveTemplate = (baseTemplate, context = {}) => {
    if (eventType === 'cargo_ship_status') {
      const stage = String(context?.cargoStage || '').toLowerCase();
      const stageTemplate = String(meta?.cargoMessages?.[stage] || '').trim();
      return stageTemplate || baseTemplate;
    }
    if (eventType === 'oil_rig_status') {
      const stage = String(context?.oilStage || '').toLowerCase();
      const stageTemplate = String(meta?.oilMessages?.[stage] || '').trim();
      if (!stageTemplate) return DEFAULT_OIL_STAGE_MESSAGES[stage] || baseTemplate;
      if (stageTemplate === LEGACY_DEFAULT_OIL_STAGE_MESSAGES[stage] || stageTemplate.includes('{oil_grid}')) {
        return DEFAULT_OIL_STAGE_MESSAGES[stage] || baseTemplate;
      }
      return stageTemplate || baseTemplate;
    }
    if (eventType === 'ch47_status') {
      const stage = String(context?.ch47Stage || '').toLowerCase();
      const stageTemplate = String(meta?.ch47Messages?.[stage] || '').trim();
      return stageTemplate || baseTemplate;
    }
    if (eventType === 'patrol_heli_status') {
      const stage = String(context?.heliStage || '').toLowerCase();
      const stageTemplate = String(meta?.heliMessages?.[stage] || '').trim();
      return stageTemplate || baseTemplate;
    }
    if (eventType === 'vendor_status') {
      const stage = String(context?.vendorStage || '').toLowerCase();
      const stageTemplate = String(meta?.vendorMessages?.[stage] || '').trim();
      return stageTemplate || baseTemplate;
    }
    if (eventType === 'deep_sea_status') {
      const stage = String(context?.deepSeaStage || '').toLowerCase();
      const stageTemplate = String(meta?.deepSeaMessages?.[stage] || '').trim();
      return stageTemplate || baseTemplate;
    }
    if (eventType === 'player_status') {
      const stage = String(context?.playerStatus || '').toLowerCase();
      const stageTemplate = String(meta?.playerStatusMessages?.[stage] || '').trim();
      return stageTemplate || baseTemplate;
    }
    return baseTemplate;
  };

  const builtActions = metaActions.map((action) => {
    const type = action?.type;
    if (type === 'notify_desktop') {
      return async (context) => {
        const message = renderMessageTemplate(resolveTemplate(msg, context), eventType, context);
        notify('desktop', { title: `🔔 ${eventType}`, message });
        sendToRenderer('notification', { type: 'info', title: `🔔 ${eventType}`, message });
      };
    }
    if (type === 'team_chat' || type === 'send_game_message') {
      return async (context) => {
        if (!rustClient?.connected) return;
        const message = renderMessageTemplate(resolveTemplate(action.message || msg, context), eventType, context);
        await dispatchTeamChat(message);
      };
    }
    if (type === 'switch_control') {
      return async () => {
        if (!rustClient?.connected) return;
        const entityId = Number(action.entityId);
        if (!Number.isFinite(entityId)) return;
        const state = action.state === 'on' || action.state === true;
        if (state) await rustClient.turnSwitchOn(entityId);
        else await rustClient.turnSwitchOff(entityId);
      };
    }
    if (type === 'call_group') {
      return async (context) => {
        const groupId = String(action.groupId || '').trim();
        if (!groupId) return;
        const message = renderMessageTemplate(resolveTemplate(action.message || msg, context), eventType, context);
        const channels = Array.isArray(action.channels)
          ? action.channels.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
          : [];
        await callGroup(groupId, message, { channels });
      };
    }
    return null;
  }).filter(Boolean);

  if (builtActions.length) return builtActions;

  if (meta.doNotify === true) {
    actions.push(async (context) => {
      const message = renderMessageTemplate(resolveTemplate(msg, context), eventType, context);
      notify('desktop', { title: `🔔 ${eventType}`, message });
      sendToRenderer('notification', { type: 'info', title: `🔔 ${eventType}`, message });
    });
  }
  if (meta.doChat !== false) {
    actions.push(async (context) => {
      if (!rustClient?.connected) return;
      const message = renderMessageTemplate(resolveTemplate(msg, context), eventType, context);
      await dispatchTeamChat(message);
    });
  }

  return actions;
}

function renderMessageTemplate(template, eventType, context = {}) {
  const time = new Date().toLocaleTimeString('zh-CN');
  const memberName = context.member?.name || '';
  const markerId = context.marker?.id || '';
  const markerGridDetail = markerToGrid9(context.marker || {}, latestServerInfo.mapSize || 0);
  const markerGrid = String(markerGridDetail || '').split('-')[0] || markerGridDetail;
  const memberGridDetail = markerToGrid9(context.member || {}, latestServerInfo.mapSize || 0);
  const memberGrid = String(memberGridDetail || '').split('-')[0] || memberGridDetail;
  const cargoGrid = String((context.grid || markerGridDetail || '')).split('-')[0] || (context.grid || markerGridDetail || '');
  const cargoHarbor = context.harbor?.name || '';
  const cargoHarborGrid = String((context.harborGrid || context.harbor?.grid || '')).split('-')[0] || (context.harborGrid || context.harbor?.grid || '');
  const cargoSpeed = Number(context.speed);
  const cargoStage = String(context.cargoStage || '').toLowerCase();
  const cargoStatusText = ({
    enter: '进入',
    leave: '离开',
    active: '航行',
    dock: '停靠',
  })[cargoStage] || '';
  const cargoStatusMessage = (() => {
    if (cargoStage === 'dock') {
      return `货船已停靠 ｜${cargoHarbor || '-'} [${cargoHarborGrid || '-'}]`;
    }
    if (cargoStage === 'enter') return `货船进入地图｜当前位置:${cargoGrid || '-'}`;
    if (cargoStage === 'leave') return `货船已离开地图｜最后位置:${cargoGrid || '-'}`;
    if (cargoStage === 'active') {
      return `货船航行中｜当前位置:${cargoGrid || '-'}`;
    }
    return '';
  })();
  const oilRigName = context.rig?.name || '';
  const oilGrid = String((context.grid || markerGridDetail || '')).split('-')[0] || (context.grid || markerGridDetail || '');
  const oilRefMarker = (() => {
    const rx = Number(context.rig?.x);
    const ry = Number(context.rig?.y);
    if (Number.isFinite(rx) && Number.isFinite(ry)) return { x: rx, y: ry };
    const mx = Number(context.marker?.x);
    const my = Number(context.marker?.y);
    if (Number.isFinite(mx) && Number.isFinite(my)) return { x: mx, y: my };
    return {};
  })();
  const oilDirection = markerToNearestEdgeDirection(oilRefMarker, latestServerInfo.mapSize || 0) || '-';
  const oilStage = String(context.oilStage || '').toLowerCase();
  const oilStatusText = ({
    large_heavy: '大石油重装',
    small_heavy: '小石油重装',
    large_unlock: '大石油解锁',
    small_unlock: '小石油解锁',
  })[oilStage] || '';
  const oilStatusMessage = (() => {
    if (oilStage === 'large_heavy') return `大石油重装已呼叫｜方向：${oilDirection}`;
    if (oilStage === 'small_heavy') return `小石油重装已呼叫｜方向：${oilDirection}`;
    if (oilStage === 'large_unlock') return `大石油箱子已解锁｜方向：${oilDirection}`;
    if (oilStage === 'small_unlock') return `小石油箱子已解锁｜方向：${oilDirection}`;
    return '';
  })();
  const ch47Stage = String(context.ch47Stage || '').toLowerCase();
  const ch47StatusText = ({
    enter: '进入',
    active: '航行',
    leave: '离开',
  })[ch47Stage] || '';
  const ch47StatusMessage = (() => {
    if (ch47Stage === 'enter') return `军用运输直升机进入地图｜当前位置:${markerGrid || '-'}`;
    if (ch47Stage === 'active') return `军用运输直升机巡逻中｜当前位置:${markerGrid || '-'}`;
    if (ch47Stage === 'leave') return `军用运输直升机已离开地图｜最后位置:${markerGrid || '-'}`;
    return '';
  })();
  const heliStage = String(context.heliStage || '').toLowerCase();
  const heliStatusText = ({
    enter: '进入',
    active: '航行',
    leave: '离开',
    explode: '坠落',
  })[heliStage] || '';
  const heliStatusMessage = (() => {
    if (heliStage === 'enter') return `武直进入地图｜当前位置:${markerGrid || '-'}`;
    if (heliStage === 'active') return `武直巡逻中｜当前位置:${markerGrid || '-'}`;
    if (heliStage === 'leave') return `武直已离开地图｜最后位置:${markerGrid || '-'}`;
    if (heliStage === 'explode') return `武直已被击落｜坠落位置:${markerGrid || '-'}`;
    return '';
  })();
  const vendorStage = String(context.vendorStage || '').toLowerCase();
  const vendorStatusText = ({
    enter: '进入',
    move: '移动',
    stopped: '停留',
    leave: '离开',
  })[vendorStage] || '';
  const vendorStatusMessage = (() => {
    if (vendorStage === 'enter') return `流浪商人进入地图｜当前位置:${markerGrid || '-'}`;
    if (vendorStage === 'move') return `流浪商人移动中｜当前位置:${markerGrid || '-'}`;
    if (vendorStage === 'stopped') return `流浪商人停留｜停留位置:${markerGrid || '-'}`;
    if (vendorStage === 'leave') return `流浪商人离开地图｜最后位置:${markerGrid || '-'}`;
    return '';
  })();
  const vendingItemsArray = Array.isArray(context.vendingItems)
    ? context.vendingItems.map((name) => String(name || '').trim()).filter(Boolean)
    : [];
  const vendingItems = vendingItemsArray.length
    ? vendingItemsArray.map((name) => `[${name}]`).join('')
    : '[未知物品]';
  const vendingItemIds = Array.isArray(context.vendingItemIds)
    ? context.vendingItemIds.map((id) => String(id)).filter(Boolean).join(',')
    : '';
  const deepSeaStage = String(context.deepSeaStage || '').toLowerCase();
  const deepSeaStatusText = ({
    open: '开启',
    close: '关闭',
  })[deepSeaStage] || '';
  const phaseReminderMinute = Number(context.phase_reminder_minute ?? context.phaseReminderMinute);
  const deepSeaStatusMessage = (() => {
    if (deepSeaStage === 'open') {
      return NEW_DEEPSEA_OPEN_MESSAGE;
    }
    if (deepSeaStage === 'close') return '深海已关闭';
    return '';
  })();
  const contextRealRemainSeconds = Number(context.real_remain_seconds ?? context.realRemainSeconds);
  const resolvedDayPhase = firstNonEmptyText(context.day_phase, context.dayPhase, latestServerInfo.phase, '白天');
  const resolvedPhaseTarget = firstNonEmptyText(context.phase_target, context.phaseTarget, latestServerInfo.phaseTarget, '日落');
  const resolvedPhaseTargetShort = firstNonEmptyText(
    context.phase_target_short,
    context.phaseTargetShort,
    latestServerInfo.phaseTargetShort,
    resolvedPhaseTarget === '天亮' ? '天亮' : '天黑',
  );
  const resolvedPhaseRemain = firstNonEmptyText(
    context.time_to_phase_real,
    context.timeToPhaseReal,
    context.time_to_phase,
    context.timeToPhase,
    latestServerInfo.realRemainText,
    latestServerInfo.remainText,
    '0分0秒',
  );
  const realPhaseClock = firstNonEmptyText(
    context.time_to_phase_clock,
    context.timeToPhaseClock,
    Number.isFinite(contextRealRemainSeconds) ? secondsToClock(contextRealRemainSeconds) : '',
    Number.isFinite(latestServerInfo.realRemainSeconds) ? secondsToClock(latestServerInfo.realRemainSeconds) : '',
    latestServerInfo.remainClock,
    '00:00',
  );
  const memberStatusTextByEvent = {
    player_offline: '已下线',
    player_respawn: '已重生',
    player_dead: '已死亡',
    player_online: '已上线',
    player_afk: '挂机',
  };
  const memberStatusText = (
    eventType === 'player_status'
      ? ({
        online: '已上线',
        offline: '已下线',
        dead: '已死亡',
        respawn: '已重生',
        afk: '挂机',
      })[String(context.playerStatus || '').toLowerCase()] || ''
      : memberStatusTextByEvent[eventType]
  ) || '';
  const playerStatusKey = (
    eventType === 'player_status'
      ? String(context.playerStatus || '').toLowerCase()
      : ({
        player_online: 'online',
        player_offline: 'offline',
        player_dead: 'dead',
        player_respawn: 'respawn',
        player_afk: 'afk',
      })[eventType] || ''
  );
  const playerStatusMessage = (() => {
    const name = memberName || '队友';
    const grid = memberGrid || '-';
    if (playerStatusKey === 'online') return `${name}已上线｜上线位置:${grid}`;
    if (playerStatusKey === 'offline') return `${name}已离线｜离线位置:${grid}`;
    if (playerStatusKey === 'dead') return `${name}已死亡｜死亡位置:${grid}`;
    if (playerStatusKey === 'respawn') return `${name}已重生｜当前位置:${grid}`;
    if (playerStatusKey === 'afk') return `${name}挂机已持续15分钟｜当前位置:${grid}`;
    return '';
  })();
  const vars = {
    '{event}': eventType,
    '{time}': time,
    '{server_info}': latestServerInfoText,
    '{server_name}': latestServerInfo.name || '未知服务器',
    '{server_players}': String(latestServerInfo.players ?? 0),
    '{server_max_players}': String(latestServerInfo.maxPlayers ?? 0),
    '{server_queue}': String(latestServerInfo.queued ?? 0),
    '{server_map_size}': String(latestServerInfo.mapSize ?? 0),
    '{game_time}': context.game_time || context.gameTime || latestServerInfo.hhmm || '00:00',
    '{hourly_time}': context.hourly_time || context.hourlyTime || latestServerInfo.hhmm || '00:00',
    '{day_phase}': resolvedDayPhase,
    '{phase_target}': resolvedPhaseTarget,
    '{phase_target_short}': resolvedPhaseTargetShort,
    '{phase_reminder_minute}': Number.isFinite(phaseReminderMinute) ? String(Math.max(0, Math.floor(phaseReminderMinute))) : '',
    '{time_to_phase}': resolvedPhaseRemain,
    '{time_to_phase_real}': resolvedPhaseRemain,
    '{time_to_phase_clock}': realPhaseClock,
    '{time_to_phase_hm}': clockToHm(realPhaseClock),
    '{deep_sea_status}': context.deepSea?.isOpen ? '已开启' : '未开启',
    '{deep_sea_next}': context.deepSea?.nextTarget || '',
    '{deep_sea_remain}': context.deepSea?.realRemainText || '',
    '{deep_sea_remain_clock}': context.deepSea?.realRemainClock || '',
    '{deep_sea_remain_hms}': context.deepSea?.realRemainHms || '',
    '{deep_sea_direction}': context.deepSea?.direction || '',
    '{deep_sea_entry}': context.deepSea?.entryGrid || '',
    '{deep_sea_entry_coord}': context.deepSea?.entryCoord || '',
    '{deep_sea_extra}': context.extraNote || '',
    '{deep_sea_message}': (() => {
      const idx = Number(context.reminderIndex || 0);
      if (context.isLast) return '深海已关闭.';
      if (idx === 1) return '深海提醒：距离深海关闭还有2小时.';
      if (idx === 2) return '深海提醒：距离深海关闭还有1小时.';
      if (idx === 3) return '深海提醒：距离深海关闭还有10分钟. 还有5分钟出现辐射 请注意！！！';
      return `深海时间提醒:距离关闭还有${context.deepSea?.realRemainHms || '00分00秒'}.`;
    })(),
    '{deep_sea_hits}': Array.isArray(context.deepSea?.matchedNames) ? context.deepSea.matchedNames.join(' / ') : '',
    '{entityId}': context.entityId != null ? String(context.entityId) : '',
    '{member}': memberName,
    '{player_status}': memberStatusText,
    '{player_status_message}': playerStatusMessage,
    '{member_status}': memberStatusText,
    '{member_grid}': memberGrid,
    '{marker_id}': markerId ? String(markerId) : '',
    '{marker_grid}': markerGrid,
    '{cargo_grid}': cargoGrid,
    '{cargo_stage}': cargoStatusText,
    '{cargo_status_text}': cargoStatusText,
    '{cargo_status_message}': cargoStatusMessage,
    '{cargo_speed}': Number.isFinite(cargoSpeed) ? `${cargoSpeed.toFixed(2)}u/s` : '',
    '{cargo_harbor}': cargoHarbor,
    '{cargo_harbor_grid}': cargoHarborGrid,
    '{oil_rig}': oilRigName,
    '{oil_grid}': oilGrid,
    '{oil_direction}': oilDirection,
    '{oil_stage}': oilStage,
    '{oil_stage_text}': oilStatusText,
    '{oil_status_message}': oilStatusMessage,
    '{ch47_stage}': ch47Stage,
    '{ch47_stage_text}': ch47StatusText,
    '{ch47_status_message}': ch47StatusMessage,
    '{heli_stage}': heliStage,
    '{heli_stage_text}': heliStatusText,
    '{heli_status_message}': heliStatusMessage,
    '{vendor_stage}': vendorStage,
    '{vendor_stage_text}': vendorStatusText,
    '{vendor_status_message}': vendorStatusMessage,
    '{vending_items}': vendingItems,
    '{vending_item_ids}': vendingItemIds,
    '{deep_sea_stage}': deepSeaStage,
    '{deep_sea_stage_text}': deepSeaStatusText,
    '{deep_sea_status_message}': deepSeaStatusMessage,
    '{item_key}': context.itemKey != null ? String(context.itemKey) : '',
    '{item_qty}': context.itemQty != null ? String(context.itemQty) : '',
    '{item_delta}': context.delta != null ? String(context.delta) : '',
  };
  return String(template || '')
    .replace(/\{[a-zA-Z0-9_]+\}/g, (token) => (vars[token] != null ? vars[token] : token))
    .trim();
}

async function refreshLatestServerInfoText() {
  if (!rustClient?.connected) return;
  try {
    const [serverInfo, timeInfo] = await Promise.all([
      rustClient.getServerInfo().catch(() => null),
      rustClient.getTime().catch(() => null),
    ]);
    if (serverInfo && !serverInfo.error) {
      latestServerInfoText = sanitizeServerInfoText(formatServerInfoText(serverInfo, timeInfo));
      latestServerInfo = buildServerInfoSnapshot(serverInfo, timeInfo);
    }
  } catch (_) {
    // ignore
  }
}

function stopTeamSyncPolling() {
  if (teamInfoPollTimer) {
    clearInterval(teamInfoPollTimer);
    teamInfoPollTimer = null;
  }
  if (teamChatPollTimer) {
    clearInterval(teamChatPollTimer);
    teamChatPollTimer = null;
  }
  if (teamSyncStatusTimer) {
    clearInterval(teamSyncStatusTimer);
    teamSyncStatusTimer = null;
  }
}

function emitTeamSyncStatus(mode = 'offline') {
  sendToRenderer('team:sync-status', {
    mode,
    lastBroadcastAt: lastTeamBroadcastAt || null,
    lastPollAt: lastTeamPollAt || null,
  });
}

function normalizeTeamChatMessage(msg = {}) {
  if (typeof msg === 'string') {
    return {
      steamId: '',
      time: 0,
      name: '',
      message: String(msg),
    };
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

function startTeamSyncStatusTimer() {
  if (teamSyncStatusTimer) clearInterval(teamSyncStatusTimer);
  teamSyncStatusTimer = setInterval(() => {
    if (!rustClient?.connected) {
      emitTeamSyncStatus('offline');
      return;
    }
    const now = Date.now();
    const hasBroadcast = lastTeamBroadcastAt && (now - lastTeamBroadcastAt) <= 90_000;
    const hasPoll = lastTeamPollAt && (now - lastTeamPollAt) <= 20_000;
    const mode = hasBroadcast && hasPoll ? 'hybrid'
      : (hasBroadcast ? 'broadcast' : (hasPoll ? 'polling' : 'stale'));
    emitTeamSyncStatus(mode);
  }, 5_000);
}

function rememberTeamChatKey(key) {
  if (!key || teamChatSeenKeys.has(key)) return false;
  teamChatSeenKeys.add(key);
  teamChatSeenOrder.push(key);
  if (teamChatSeenOrder.length > 500) {
    const old = teamChatSeenOrder.shift();
    if (old) teamChatSeenKeys.delete(old);
  }
  return true;
}

async function bootstrapTeamChatCache() {
  try {
    const chat = await rustClient.getTeamChat();
    const list = chat?.teamChat?.messages || [];
    for (const msg of list) {
      const key = buildTeamChatSeenKey(msg);
      if (key) rememberTeamChatKey(key);
    }
    logger.info(`[Main] 队伍聊天缓存已初始化 (${list.length} 条)`);
  } catch (e) {
    logger.debug('[Main] 初始化队伍聊天缓存失败: ' + e.message);
  }
}

function startTeamSyncPolling() {
  stopTeamSyncPolling();
  teamInfoPollTimer = setInterval(async () => {
    if (!rustClient?.connected) return;
    try {
      const team = await rustClient.getTeamInfo();
      if (team) {
        lastTeamPollAt = Date.now();
        if (eventEngine?.ingestTeamSnapshot) {
          try { eventEngine.ingestTeamSnapshot(team?.teamInfo ? team.teamInfo : team); } catch (_) {}
        }
        sendToRenderer('team:changed', team);
      }
    } catch (_) {
      // ignore; broadcast path may still work
    }
  }, 10_000);

  teamChatPollTimer = setInterval(async () => {
    if (!rustClient?.connected) return;
    try {
      const chat = await rustClient.getTeamChat();
      const list = chat?.teamChat?.messages || [];
      for (const msg of list) {
        const key = buildTeamChatSeenKey(msg);
        if (key && !rememberTeamChatKey(key)) continue;
        lastTeamPollAt = Date.now();
        sendToRenderer('team:message', msg);
      }
    } catch (_) {
      // ignore; do not spam logs on servers that limit getTeamChat
    }
  }, 6_000);
}

function hydrateRule(rule) {
  return {
    ...rule,
    trigger: rule.trigger || {},
    _meta: rule._meta || {},
    actions: buildActionsFromMeta(rule._meta || {}, rule.event),
  };
}

function buildSystemEventTemplates(serverId) {
  const globalCooldownMs = getGlobalTeamChatIntervalMs();
  const chatMeta = (message) => ({
    doNotify: false,
    doChat: true,
    message,
  });
  return [
    {
      id: 'vending_new_notify',
      name: '新售货机出现事件',
      event: 'vending_new',
      trigger: normalizeVendingNewTrigger({ cooldownMs: globalCooldownMs }),
      enabled: true,
      serverId,
      _meta: chatMeta(DEFAULT_VENDING_NEW_MESSAGE),
    },
    { id: 'hourly', name: '整点报时', event: 'hourly_tick', trigger: {}, enabled: true, serverId, _meta: chatMeta('当前游戏时间{hourly_time} ｜{day_phase}｜距离{phase_target}还有{time_to_phase_real}') },
    {
      id: 'day_phase_notice',
      name: '天黑天亮提醒',
      event: 'day_phase_notice',
      trigger: { cooldownMs: globalCooldownMs },
      enabled: true,
      serverId,
      _meta: chatMeta('当前游戏时间{hourly_time} ｜{day_phase}｜距离{phase_target}还有{time_to_phase_real}'),
    },
    {
      id: 'ch47_status_notify',
      name: '军用运输直升机事件整合',
      event: 'ch47_status',
      trigger: {
        cooldownMs: globalCooldownMs,
        ch47NotifyEnter: true,
        ch47NotifyActive: false,
        ch47NotifyLeave: true,
      },
      enabled: true,
      serverId,
      _meta: {
        ...chatMeta('{ch47_status_message}'),
        ch47Messages: { ...DEFAULT_CH47_STAGE_MESSAGES },
      },
    },
    {
      id: 'patrol_heli_status_notify',
      name: '武装直升机事件整合',
      event: 'patrol_heli_status',
      trigger: {
        cooldownMs: globalCooldownMs,
        heliNotifyEnter: true,
        heliNotifyActive: false,
        heliNotifyLeave: true,
        heliNotifyExplode: true,
      },
      enabled: true,
      serverId,
      _meta: {
        ...chatMeta('{heli_status_message}'),
        heliMessages: { ...DEFAULT_HELI_STAGE_MESSAGES },
      },
    },
    {
      id: 'vendor_status_notify',
      name: '流浪商人事件整合',
      event: 'vendor_status',
      trigger: {
        cooldownMs: globalCooldownMs,
        vendorNotifyEnter: true,
        vendorNotifyMove: false,
        vendorNotifyStopped: true,
        vendorNotifyLeave: true,
      },
      enabled: true,
      serverId,
      _meta: {
        ...chatMeta('{vendor_status_message}'),
        vendorMessages: { ...DEFAULT_VENDOR_STAGE_MESSAGES },
      },
    },
    {
      id: 'deepsea_status_notify',
      name: '深海整合',
      event: 'deep_sea_status',
      trigger: {
        cooldownMs: globalCooldownMs,
        deepSeaNotifyOpen: true,
        deepSeaNotifyClose: true,
      },
      enabled: true,
      serverId,
      _meta: {
        ...chatMeta('{deep_sea_status_message}'),
        deepSeaMessages: { ...DEFAULT_DEEPSEA_STAGE_MESSAGES },
      },
    },
    {
      id: 'cargo_status_notify',
      name: '货船事件整合',
      event: 'cargo_ship_status',
      trigger: {
        cooldownMs: globalCooldownMs,
        cargoNotifyEnter: true,
        cargoNotifyLeave: true,
        cargoNotifyActive: false,
        cargoNotifyDock: true,
      },
      enabled: true,
      serverId,
      _meta: {
        ...chatMeta('{cargo_status_message}'),
        cargoMessages: { ...DEFAULT_CARGO_STAGE_MESSAGES },
      },
    },
    {
      id: 'oil_status_notify',
      name: '石油事件整合',
      event: 'oil_rig_status',
      trigger: {
        cooldownMs: globalCooldownMs,
        oilNotifyLargeHeavy: true,
        oilNotifySmallHeavy: true,
        oilNotifyLargeUnlock: true,
        oilNotifySmallUnlock: true,
      },
      enabled: true,
      serverId,
      _meta: {
        ...chatMeta('{oil_status_message}'),
        oilMessages: { ...DEFAULT_OIL_STAGE_MESSAGES },
      },
    },
    {
      id: 'player_status_notify',
      name: '队友状态整合事件',
      event: 'player_status',
      trigger: { cooldownMs: globalCooldownMs },
      enabled: true,
      serverId,
      _meta: {
        ...chatMeta('{player_status_message}'),
        playerStatusMessages: { ...DEFAULT_PLAYER_STATUS_MESSAGES },
      },
    },
  ];
}

function collectLegacyStageMeta(rules = [], stageByEvent = {}, defaultMessages = {}, defaultEnabled = {}) {
  const legacy = (Array.isArray(rules) ? rules : []).filter((r) => {
    const eventType = String(r?.event || '');
    return !!stageByEvent[eventType];
  });
  if (!legacy.length) return null;
  const messages = { ...defaultMessages };
  const stageEnabled = { ...defaultEnabled };
  let seedMeta = null;
  for (const rule of legacy) {
    const stage = stageByEvent[String(rule?.event || '')];
    if (!stage) continue;
    const text = String(rule?._meta?.message || '').trim();
    if (text) messages[stage] = text;
    stageEnabled[stage] = rule?.enabled !== false;
    if (!seedMeta && rule?._meta && typeof rule._meta === 'object') seedMeta = rule._meta;
  }
  return {
    ruleIds: legacy.map((r) => String(r.id || '')).filter(Boolean),
    messages,
    stageEnabled,
    seedMeta: seedMeta || {},
  };
}

function collectLegacyCargoMeta(rules = []) {
  return collectLegacyStageMeta(
    rules,
    LEGACY_CARGO_STAGE_BY_EVENT,
    DEFAULT_CARGO_STAGE_MESSAGES,
    { enter: true, leave: true, active: true, dock: true },
  );
}

function collectLegacyOilMeta(rules = []) {
  return collectLegacyStageMeta(
    rules,
    LEGACY_OIL_STAGE_BY_EVENT,
    DEFAULT_OIL_STAGE_MESSAGES,
    { large_heavy: true, small_heavy: true, large_unlock: true, small_unlock: true },
  );
}

function collectLegacyCh47Meta(rules = []) {
  return collectLegacyStageMeta(
    rules,
    LEGACY_CH47_STAGE_BY_EVENT,
    DEFAULT_CH47_STAGE_MESSAGES,
    { enter: true, active: true, leave: true },
  );
}

function collectLegacyHeliMeta(rules = []) {
  return collectLegacyStageMeta(
    rules,
    LEGACY_HELI_STAGE_BY_EVENT,
    DEFAULT_HELI_STAGE_MESSAGES,
    { enter: true, active: true, leave: true, explode: true },
  );
}

function collectLegacyVendorMeta(rules = []) {
  return collectLegacyStageMeta(
    rules,
    LEGACY_VENDOR_STAGE_BY_EVENT,
    DEFAULT_VENDOR_STAGE_MESSAGES,
    { enter: true, move: true, stopped: true, leave: true },
  );
}

function collectLegacyDeepSeaMeta(rules = []) {
  return collectLegacyStageMeta(
    rules,
    LEGACY_DEEPSEA_STAGE_BY_EVENT,
    DEFAULT_DEEPSEA_STAGE_MESSAGES,
    { open: true, close: true },
  );
}

async function registerPersistedRules(serverId) {
  if (!serverId) return;
  const snapshotBefore = await listEventRules(serverId);
  const legacyCargo = collectLegacyCargoMeta(snapshotBefore);
  const legacyOil = collectLegacyOilMeta(snapshotBefore);
  const legacyCh47 = collectLegacyCh47Meta(snapshotBefore);
  const legacyHeli = collectLegacyHeliMeta(snapshotBefore);
  const legacyVendor = collectLegacyVendorMeta(snapshotBefore);
  const legacyDeepSea = collectLegacyDeepSeaMeta(snapshotBefore);
  const deprecatedRuleIds = new Set([
    'alarm_notify',
    'heli_notify',
    'cargo_notify',
    'vendor_notify',
    'player_online_notify',
    'player_offline_notify',
    'player_respawn_notify',
    'player_dead_notify',
    'player_afk_notify',
    'cargo_enter_notify',
    'cargo_active_notify',
    'cargo_dock_notify',
    'cargo_leave_notify',
    'oil_rig_large_crate_unlock_notify',
    'oil_rig_small_crate_unlock_notify',
    'oil_rig_large_heavy_called_notify',
    'oil_rig_small_heavy_called_notify',
    'ch47_enter_notify',
    'ch47_active_notify',
    'ch47_leave_notify',
    'heli_enter_notify',
    'patrol_heli_active_notify',
    'heli_leave_notify',
    'heli_explode_notify',
    'vendor_appear_notify',
    'vendor_move_notify',
    'vendor_stopped_notify',
    'deepsea_open_notify',
    'deepsea_close_notify',
    'deepsea_halfhour_notify',
  ]);
  const current = snapshotBefore;
  for (const rule of current) {
    const ruleEvent = String(rule?.event || '');
    if (ruleEvent === 'deep_sea_reminder') {
      await removeEventRule(rule.id, serverId);
      continue;
    }
    if (LEGACY_PLAYER_STATUS_EVENTS.has(ruleEvent)) {
      await removeEventRule(rule.id, serverId);
      continue;
    }
    if (deprecatedRuleIds.has(rule.id)) {
      await removeEventRule(rule.id, serverId);
    }
  }
  if (legacyCargo?.ruleIds?.length) {
    for (const id of legacyCargo.ruleIds) {
      await removeEventRule(id, serverId);
    }
  }
  if (legacyOil?.ruleIds?.length) {
    for (const id of legacyOil.ruleIds) {
      await removeEventRule(id, serverId);
    }
  }
  if (legacyCh47?.ruleIds?.length) {
    for (const id of legacyCh47.ruleIds) {
      await removeEventRule(id, serverId);
    }
  }
  if (legacyHeli?.ruleIds?.length) {
    for (const id of legacyHeli.ruleIds) {
      await removeEventRule(id, serverId);
    }
  }
  if (legacyVendor?.ruleIds?.length) {
    for (const id of legacyVendor.ruleIds) {
      await removeEventRule(id, serverId);
    }
  }
  if (legacyDeepSea?.ruleIds?.length) {
    for (const id of legacyDeepSea.ruleIds) {
      await removeEventRule(id, serverId);
    }
  }

  let persisted = await listEventRules(serverId);
  if (!persisted.length) {
    await registerDefaultRules(serverId);
    return;
  }
  const templates = buildSystemEventTemplates(serverId);
  const templateById = new Map(templates.map((r) => [String(r.id), r]));

  for (const rule of persisted) {
    const tpl = templateById.get(String(rule?.id || ''));
    if (!tpl) continue;
    const currentMsg = String(rule?._meta?.message || '').trim();
    const shouldReplaceMessage = (
      !currentMsg
      || (rule.id === 'hourly' && currentMsg.includes('整点报时'))
      || (rule.id === 'hourly' && currentMsg.includes('状态:{day_phase}'))
      || (rule.id === 'player_status_notify' && currentMsg.includes('{member}{player_status}'))
    );
    if (!shouldReplaceMessage) continue;
    const next = {
      ...rule,
      _meta: {
        ...rule._meta,
        message: tpl?._meta?.message || currentMsg,
        ...(String(rule?.event || '') === 'player_status'
          ? {
              playerStatusMessages: {
                ...DEFAULT_PLAYER_STATUS_MESSAGES,
                ...(rule?._meta?.playerStatusMessages || {}),
              },
            }
          : {}),
      },
    };
    await saveEventRule(next);
  }

  persisted = await listEventRules(serverId);
  const eventSet = new Set(persisted.map((r) => String(r?.event || '')).filter(Boolean));
  for (const tpl of templates) {
    const eventType = String(tpl?.event || '');
    if (!eventType || eventSet.has(eventType)) continue;
    await saveEventRule(tpl);
    persisted.push(tpl);
    eventSet.add(eventType);
  }

  const vendingNewRule = persisted.find((r) => String(r.id || '') === 'vending_new_notify')
    || persisted.find((r) => String(r.event || '') === 'vending_new');
  if (vendingNewRule) {
    const currentMsg = String(vendingNewRule?._meta?.message || '').trim();
    const shouldReplaceMessage = !currentMsg || currentMsg.includes('发现新售货机');
    await saveEventRule({
      ...vendingNewRule,
      trigger: normalizeVendingNewTrigger(vendingNewRule.trigger || {}),
      _meta: {
        ...(vendingNewRule._meta || {}),
        message: shouldReplaceMessage ? DEFAULT_VENDING_NEW_MESSAGE : currentMsg,
      },
      serverId,
    });
    persisted = await listEventRules(serverId);
  }

  const cargoStatusRule = persisted.find((r) => String(r.id || '') === 'cargo_status_notify')
    || persisted.find((r) => String(r.event || '') === 'cargo_ship_status');
  if (cargoStatusRule) {
    const trigger = {
      ...(cargoStatusRule.trigger || {}),
      cargoNotifyEnter: legacyCargo ? !!legacyCargo.stageEnabled.enter : (cargoStatusRule.trigger?.cargoNotifyEnter !== false),
      cargoNotifyLeave: legacyCargo ? !!legacyCargo.stageEnabled.leave : (cargoStatusRule.trigger?.cargoNotifyLeave !== false),
      cargoNotifyActive: legacyCargo ? !!legacyCargo.stageEnabled.active : (cargoStatusRule.trigger?.cargoNotifyActive === true),
      cargoNotifyDock: legacyCargo ? !!legacyCargo.stageEnabled.dock : (cargoStatusRule.trigger?.cargoNotifyDock !== false),
    };
    const mergedMeta = {
      ...(cargoStatusRule._meta || {}),
      ...(legacyCargo?.seedMeta || {}),
      message: '{cargo_status_message}',
      cargoMessages: {
        ...DEFAULT_CARGO_STAGE_MESSAGES,
        ...(cargoStatusRule._meta?.cargoMessages || {}),
        ...(legacyCargo?.messages || {}),
      },
    };
    await saveEventRule({
      ...cargoStatusRule,
      trigger,
      _meta: mergedMeta,
      serverId,
    });
    persisted = await listEventRules(serverId);
  }

  const oilStatusRule = persisted.find((r) => String(r.id || '') === 'oil_status_notify')
    || persisted.find((r) => String(r.event || '') === 'oil_rig_status');
  if (oilStatusRule) {
    const trigger = {
      ...(oilStatusRule.trigger || {}),
      oilNotifyLargeHeavy: legacyOil ? !!legacyOil.stageEnabled.large_heavy : (oilStatusRule.trigger?.oilNotifyLargeHeavy !== false),
      oilNotifySmallHeavy: legacyOil ? !!legacyOil.stageEnabled.small_heavy : (oilStatusRule.trigger?.oilNotifySmallHeavy !== false),
      oilNotifyLargeUnlock: legacyOil ? !!legacyOil.stageEnabled.large_unlock : (oilStatusRule.trigger?.oilNotifyLargeUnlock !== false),
      oilNotifySmallUnlock: legacyOil ? !!legacyOil.stageEnabled.small_unlock : (oilStatusRule.trigger?.oilNotifySmallUnlock !== false),
    };
    const mergedMeta = {
      ...(oilStatusRule._meta || {}),
      ...(legacyOil?.seedMeta || {}),
      message: '{oil_status_message}',
      oilMessages: {
        ...DEFAULT_OIL_STAGE_MESSAGES,
        ...(oilStatusRule._meta?.oilMessages || {}),
      },
    };
    await saveEventRule({
      ...oilStatusRule,
      trigger,
      _meta: mergedMeta,
      serverId,
    });
    persisted = await listEventRules(serverId);
  }

  const ch47StatusRule = persisted.find((r) => String(r.id || '') === 'ch47_status_notify')
    || persisted.find((r) => String(r.event || '') === 'ch47_status');
  if (ch47StatusRule) {
    const trigger = {
      ...(ch47StatusRule.trigger || {}),
      ch47NotifyEnter: legacyCh47 ? !!legacyCh47.stageEnabled.enter : (ch47StatusRule.trigger?.ch47NotifyEnter !== false),
      ch47NotifyActive: legacyCh47 ? !!legacyCh47.stageEnabled.active : (ch47StatusRule.trigger?.ch47NotifyActive === true),
      ch47NotifyLeave: legacyCh47 ? !!legacyCh47.stageEnabled.leave : (ch47StatusRule.trigger?.ch47NotifyLeave !== false),
    };
    const mergedMeta = {
      ...(ch47StatusRule._meta || {}),
      ...(legacyCh47?.seedMeta || {}),
      message: '{ch47_status_message}',
      ch47Messages: {
        ...DEFAULT_CH47_STAGE_MESSAGES,
        ...(ch47StatusRule._meta?.ch47Messages || {}),
      },
    };
    await saveEventRule({
      ...ch47StatusRule,
      trigger,
      _meta: mergedMeta,
      serverId,
    });
    persisted = await listEventRules(serverId);
  }

  const heliStatusRule = persisted.find((r) => String(r.id || '') === 'patrol_heli_status_notify')
    || persisted.find((r) => String(r.event || '') === 'patrol_heli_status');
  if (heliStatusRule) {
    const trigger = {
      ...(heliStatusRule.trigger || {}),
      heliNotifyEnter: legacyHeli ? !!legacyHeli.stageEnabled.enter : (heliStatusRule.trigger?.heliNotifyEnter !== false),
      heliNotifyActive: legacyHeli ? !!legacyHeli.stageEnabled.active : (heliStatusRule.trigger?.heliNotifyActive === true),
      heliNotifyLeave: legacyHeli ? !!legacyHeli.stageEnabled.leave : (heliStatusRule.trigger?.heliNotifyLeave !== false),
      heliNotifyExplode: legacyHeli ? !!legacyHeli.stageEnabled.explode : (heliStatusRule.trigger?.heliNotifyExplode !== false),
    };
    const mergedMeta = {
      ...(heliStatusRule._meta || {}),
      ...(legacyHeli?.seedMeta || {}),
      message: '{heli_status_message}',
      heliMessages: {
        ...DEFAULT_HELI_STAGE_MESSAGES,
        ...(heliStatusRule._meta?.heliMessages || {}),
      },
    };
    await saveEventRule({
      ...heliStatusRule,
      trigger,
      _meta: mergedMeta,
      serverId,
    });
    persisted = await listEventRules(serverId);
  }

  const vendorStatusRule = persisted.find((r) => String(r.id || '') === 'vendor_status_notify')
    || persisted.find((r) => String(r.event || '') === 'vendor_status');
  if (vendorStatusRule) {
    const trigger = {
      ...(vendorStatusRule.trigger || {}),
      vendorNotifyEnter: legacyVendor ? !!legacyVendor.stageEnabled.enter : (vendorStatusRule.trigger?.vendorNotifyEnter !== false),
      vendorNotifyMove: legacyVendor ? !!legacyVendor.stageEnabled.move : (vendorStatusRule.trigger?.vendorNotifyMove === true),
      vendorNotifyStopped: legacyVendor ? !!legacyVendor.stageEnabled.stopped : (vendorStatusRule.trigger?.vendorNotifyStopped !== false),
      vendorNotifyLeave: legacyVendor ? !!legacyVendor.stageEnabled.leave : (vendorStatusRule.trigger?.vendorNotifyLeave !== false),
    };
    const mergedMeta = {
      ...(vendorStatusRule._meta || {}),
      ...(legacyVendor?.seedMeta || {}),
      message: '{vendor_status_message}',
      vendorMessages: {
        ...DEFAULT_VENDOR_STAGE_MESSAGES,
        ...(vendorStatusRule._meta?.vendorMessages || {}),
      },
    };
    await saveEventRule({
      ...vendorStatusRule,
      trigger,
      _meta: mergedMeta,
      serverId,
    });
    persisted = await listEventRules(serverId);
  }

  const deepSeaStatusRule = persisted.find((r) => String(r.id || '') === 'deepsea_status_notify')
    || persisted.find((r) => String(r.event || '') === 'deep_sea_status');
  if (deepSeaStatusRule) {
    const trigger = {
      ...(deepSeaStatusRule.trigger || {}),
      deepSeaNotifyOpen: legacyDeepSea ? !!legacyDeepSea.stageEnabled.open : (deepSeaStatusRule.trigger?.deepSeaNotifyOpen !== false),
      deepSeaNotifyClose: legacyDeepSea ? !!legacyDeepSea.stageEnabled.close : (deepSeaStatusRule.trigger?.deepSeaNotifyClose !== false),
    };
    const mergedMeta = {
      ...(deepSeaStatusRule._meta || {}),
      ...(legacyDeepSea?.seedMeta || {}),
      message: '{deep_sea_status_message}',
      deepSeaMessages: normalizeDeepSeaStageMessages({
        ...(legacyDeepSea?.seedMeta?.deepSeaMessages || {}),
        ...(deepSeaStatusRule._meta?.deepSeaMessages || {}),
      }),
    };
    await saveEventRule({
      ...deepSeaStatusRule,
      trigger,
      _meta: mergedMeta,
      serverId,
    });
    persisted = await listEventRules(serverId);
  }

  const playerStatusRule = persisted.find((r) => String(r.id || '') === 'player_status_notify')
    || persisted.find((r) => String(r.event || '') === 'player_status');
  if (playerStatusRule) {
    const mergedMeta = {
      ...(playerStatusRule._meta || {}),
      message: String(playerStatusRule?._meta?.message || '').trim() || '{player_status_message}',
      playerStatusMessages: {
        ...DEFAULT_PLAYER_STATUS_MESSAGES,
        ...(playerStatusRule?._meta?.playerStatusMessages || {}),
      },
    };
    if (String(mergedMeta.message || '').includes('{member}{player_status}')) {
      mergedMeta.message = '{player_status_message}';
    }
    await saveEventRule({
      ...playerStatusRule,
      _meta: mergedMeta,
      serverId,
    });
    persisted = await listEventRules(serverId);
  }

  persisted.forEach(rule => {
    eventEngine.addRule(hydrateRule(rule));
  });
  logger.info(`[Main] 已加载持久化事件规则 ${persisted.length} 条`);
}

async function restoreCallGroups() {
  const groups = await listCallGroupsDb();
  let hasTeamChatSettings = false;
  groups.forEach(g => {
    setGroup(g.id, g);
    if (String(g?.id || '') === TEAM_CHAT_SETTINGS_GROUP_ID) hasTeamChatSettings = true;
  });
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
  logger.info(`[Main] 已恢复呼叫组 ${groups.length} 个`);
}

function formatRustConnectionErrorMessage(error) {
  const raw = String(error?.message || error || '未知错误').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('socket hang up')) {
    return '连接被服务器主动断开，当前服务器 Rust+ 配对可能已失效，请在游戏内 ESC -> Rust+ -> Pair with Server 重新配对。';
  }
  if (lower.includes('econnrefused') || lower.includes('timed out') || lower.includes('timeout')) {
    return '无法连接到 Rust+ 端口，请确认服务器在线、app.port 可用，或稍后重试。';
  }
  if (lower.includes('not_found')) {
    return '服务器未接受当前请求，当前配对信息可能已失效，请重新配对。';
  }
  return raw || '未知错误';
}

let _startServicesSeq = 0;

async function startServices(serverConfig, options = {}) {
  const seq = ++_startServicesSeq;

  if (rustClient) {
    eventEngine?.unbind();
    rustClient.removeAllListeners();
    rustClient.disconnect();
  }
  if (serverInfoRefreshTimer) {
    clearInterval(serverInfoRefreshTimer);
    serverInfoRefreshTimer = null;
  }
  stopTeamSyncPolling();

  rustClient = new RustClient(serverConfig);
  teamChatSeenKeys = new Set();
  teamChatSeenOrder = [];
  activeServerId = serverConfig.id || null;
  const shouldBroadcastOnConnected = !!options?.sendConnectBroadcast;
  let connectedBroadcastSent = false;
  eventEngine = new EventEngine({
    onRuleEnabledChanged: async ({ ruleId, enabled, reason, onlineCount, threshold }) => {
      if (!activeServerId) return;
      await setEventRuleEnabled(ruleId, enabled, activeServerId);
      sendToRenderer('rule:auto-toggled', { ruleId, enabled, reason, onlineCount, threshold });
    },
  });
  cmdParser = new CommandParser({
    leaderId: serverConfig.playerId,
    callGroupRunner: (groupId, message, options = {}) => callGroup(groupId, message, options),
    notifyDesktopRunner: ({ title, message }) => {
      notify('desktop', { title, message });
      sendToRenderer('notification', { type: 'info', title, message });
    },
    notifyDiscordRunner: ({ title, message }) => {
      notify('discord', { title, message });
    },
    teamChatRunner: async (message) => {
      if (!rustClient?.connected) return;
      await dispatchTeamChat(message);
    },
  });

  rustClient.on('connected', () => sendToRenderer('server:status', {
    connected: true,
    name: serverConfig.name,
    serverId: serverConfig.id || null,
    server: serverConfig,
  }));
  rustClient.on('connected', async () => {
    if (!shouldBroadcastOnConnected) return;
    if (connectedBroadcastSent) return;
    connectedBroadcastSent = true;
    try {
      await dispatchTeamChat(TEAMCHAT_CONNECTED_BROADCAST);
    } catch (e) {
      logger.warn('[Main] 连接成功提示发送失败: ' + e.message);
    }
  });
  rustClient.on('disconnected', () => {
    lastTeamBroadcastAt = 0;
    lastTeamPollAt = 0;
    stopTeamSyncPolling();
    emitTeamSyncStatus('offline');
    sendToRenderer('server:status', {
      connected: false,
      name: serverConfig.name,
      serverId: null,
      server: null,
    });
  });
  rustClient.on('error', (error) => {
    const message = formatRustConnectionErrorMessage(error);
    sendToRenderer('notification', {
      type: 'error',
      title: '服务器连接异常',
      message,
    });
  });
  rustClient.on('entityChanged', (data) => sendToRenderer('entity:changed', data));
  rustClient.on('teamChanged', (data) => {
    lastTeamBroadcastAt = Date.now();
    sendToRenderer('team:changed', data);
  });
  rustClient.on('teamMessage', (data) => {
    lastTeamBroadcastAt = Date.now();
    const key = buildTeamChatSeenKey(data);
    if (key && !rememberTeamChatKey(key)) return;
    sendToRenderer('team:message', data);
  });

  await rustClient.connect();
  if (seq !== _startServicesSeq) {
    logger.warn('[Main] startServices 被更新的调用取代，中止当前初始化');
    return;
  }
  eventEngine.bind(rustClient);
  cmdParser.bind(rustClient);
  const boundDevices = await listDevices(activeServerId);
  await Promise.all(boundDevices.map((d) => subscribeEntityBroadcast(d.entityId, 'startup')));
  boundDevices.forEach((d) => {
    const t = String(d?.type || '').toLowerCase();
    if (t === 'switch') {
      cmdParser.registerSwitch(d.entityId, d.alias);
    }
  });
  const persistedCommands = await listCommandRules(activeServerId);
  for (const rule of persistedCommands) {
    const key = String(rule?.keyword || '').toLowerCase();
    const type = String(rule?.type || '').toLowerCase();
    if (['dw', 'td', 'sj', 'xy', 'info'].includes(key) || type === 'team_info' || type === 'team_chat_history' || type === 'server_time' || type === 'query_position') {
      await removeCommandRule(key || rule?.id, activeServerId);
    }
  }
  let activePersistedCommands = await listCommandRules(activeServerId);
  if (!activePersistedCommands.length) {
    activePersistedCommands = await ensureDefaultCommandRules(activeServerId);
  }
  activePersistedCommands.forEach((rule) => {
    if (!rule?.keyword) return;
    const fixedRule = { ...rule };
    const key = String(fixedRule.keyword || '').toLowerCase();
    if (['dw', 'td', 'sj', 'xy', 'info'].includes(key) || fixedRule.type === 'team_info' || fixedRule.type === 'team_chat_history' || fixedRule.type === 'server_time' || fixedRule.type === 'query_position') {
      return;
    }
    if (fixedRule.deleted === true) {
      cmdParser.removeCommandRule(key);
      return;
    }
    if (rule.type || rule.name || rule.permission || rule.meta) {
      cmdParser.setCommandRule(fixedRule);
      return;
    }
    cmdParser.setCommandEnabled(fixedRule.keyword, fixedRule.enabled !== false);
  });

  if (seq !== _startServicesSeq) return;
  await registerPersistedRules(serverConfig.id);
  await setLastServerId(serverConfig.id || null);
  await refreshLatestServerInfoText();
  await bootstrapTeamChatCache();
  if (seq !== _startServicesSeq) return;
  startTeamSyncPolling();
  startTeamSyncStatusTimer();
  emitTeamSyncStatus('polling');
  serverInfoRefreshTimer = setInterval(() => {
    refreshLatestServerInfoText().catch(() => {});
  }, 30_000);

  logger.info('[Main] 后端服务已启动');
}

async function autoConnect() {
  const lastServerId = await getLastServerId();
  if (!lastServerId) {
    logger.info('[Main] 未设置最近连接服务器，跳过自动连接');
    return;
  }
  const servers = await listServers();
  const server = servers.find((s) => s.id === lastServerId) || null;
  if (!server) {
    logger.warn('[Main] 最近连接服务器不存在，跳过自动连接');
    await setLastServerId(null);
    return;
  }
  startServices(server).catch(e => {
    logger.warn('[Main] 自动连接失败: ' + e.message);
    sendToRenderer('server:status', { connected: false, name: server?.name || '', serverId: null, server: null });
  });
}

async function registerDefaultRules(serverId) {
  const preset = getEventPreset('event_system_default');
  const defaults = (preset?.eventRules || []).map((rule) => normalizeEventRuleForServer(rule, serverId));

  for (const rule of defaults) {
    await saveEventRule(rule);
    eventEngine.addRule(hydrateRule(rule));
  }
  logger.info(`[Main] 默认事件规则已加载（${defaults.length}条）`);
}

function sendToRenderer(channel, data) {
  mainWindow?.webContents?.send(channel, data);
}

async function subscribeEntityBroadcast(entityId, source = 'manual') {
  if (!rustClient?.connected) return false;
  const id = Number(entityId);
  if (!Number.isFinite(id)) return false;
  try {
    await rustClient.getEntityInfo(id);
    return true;
  } catch (e) {
    logger.debug(`[Main] 订阅设备广播失败(${source}) entityId=${id}: ${e.message}`);
    return false;
  }
}

function inferDeviceTypeFromPairing(data = {}) {
  const entityType = String(data.entityType || '').toLowerCase();
  const name = String(data.entityName || data.name || '').toLowerCase();
  if (entityType.includes('alarm') || name.includes('alarm') || name.includes('警报')) return 'alarm';
  if (entityType.includes('storage') || name.includes('storage') || name.includes('箱')) return 'storage';
  return 'switch';
}

function isServerPairingPayload(data = {}) {
  const type = String(data.type || '').toLowerCase();
  if (type === 'entity') return false;
  if (data.entityId) return false;
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

function hasServerCredentials(data = {}) {
  return !!(data.ip && data.port && data.playerId && data.playerToken);
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

function serializeRule(rule) {
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

function setupIPC() {
  ipcMain.on('win:minimize', () => mainWindow?.minimize());
  ipcMain.on('win:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
  ipcMain.on('win:close', () => {
    if (process.platform === 'darwin') mainWindow?.hide();
    else mainWindow?.hide();
  });
  ipcMain.on('win:quit', () => app.quit());
  ipcMain.on('open:url', (_, rawUrl) => {
    const safeUrl = toSafeExternalUrl(rawUrl, { allowHttp: false });
    if (!safeUrl) {
      logger.warn(`[Main] 已拦截不安全外链: ${String(rawUrl || '').slice(0, 200)}`);
      return;
    }
    shell.openExternal(safeUrl).catch((e) => {
      logger.warn('[Main] 打开外链失败: ' + e.message);
    });
  });

  ipcMain.handle('docs:getHelp', async () => {
    try {
      const file = path.join(__dirname, '../docs/HELP.md');
      return fs.readFileSync(file, 'utf8');
    } catch (e) {
      return `帮助文档读取失败: ${e.message}`;
    }
  });

  ipcMain.handle('app:init', async () => {
    await initDbs();
    const servers = await listServers();
    const connected = !!(rustClient?.connected);
    const currentServer = connected ? (servers.find((s) => s.id === activeServerId) || null) : null;
    return {
      version: VERSION,
      servers,
      devices: connected && currentServer?.id ? await listDevices(currentServer.id) : [],
      groups: listGroups(),
      connected,
      currentServer,
      steam: await getSteamProfileStatus({ fetchRemote: false }),
    };
  });

  ipcMain.handle('steam:status', async () => {
    return getSteamProfileStatus({ fetchRemote: true });
  });
  ipcMain.handle('steam:beginAuth', async () => {
    try {
      await registerFCM({ force: true });
      return { success: true, steam: await getSteamProfileStatus({ fetchRemote: false }) };
    } catch (e) {
      return { success: false, reason: e.message };
    }
  });
  ipcMain.handle('steam:logout', async () => {
    const res = await logoutSteam();
    if (!res?.success) return { success: false, reason: res?.reason || '注销失败' };
    return { success: true, steam: await getSteamProfileStatus({ fetchRemote: false }) };
  });

  ipcMain.handle('server:list', async () => listServers());
  ipcMain.handle('server:remove', async (_, id) => {
    const result = await removeServerCascade(id);
    const ok = !!result?.removedServer;
    const last = await getLastServerId();
    if (last && String(last) === String(id)) await setLastServerId(null);
    if (ok && activeServerId && String(activeServerId) === String(id)) {
      eventEngine?.unbind();
      rustClient?.disconnect();
      stopTeamSyncPolling();
      activeServerId = null;
      latestServerInfo = buildServerInfoSnapshot(null, null);
      latestServerInfoText = sanitizeServerInfoText(formatServerInfoText(null, null));
      sendToRenderer('server:status', { connected: false, name: '', serverId: null, server: null });
    }
    return { success: ok, ...result };
  });
  ipcMain.handle('server:connect', async (_, cfg) => {
    try {
      await startServices(cfg, { sendConnectBroadcast: true });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('pairing:start', async (_, options = {}) => new Promise(async (resolve) => {
    if (fcmStopFn) fcmStopFn();
    if (pairingNoNotificationTimer) {
      clearTimeout(pairingNoNotificationTimer);
      pairingNoNotificationTimer = null;
    }
    let resolved = false;
    try {
      const forceRegister = !!options?.forceRegister;
      if (forceRegister) logger.info('[FCM] 强制重新注册凭据...');
      await registerFCM({ force: forceRegister });
    } catch (e) {
      resolve({ success: false, error: `FCM 注册失败: ${e.message}` });
      return;
    }
    try {
      fcmStopFn = listenForPairing(async data => {
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

        let alreadyReconnecting = false;
        if (tokenChanged && rustClient?.connected && server) {
          const sameServer = String(rustClient.config?.ip) === String(server.ip)
            && String(rustClient.config?.port) === String(server.port)
            && String(rustClient.config?.playerId) === String(server.playerId);
          if (sameServer) {
            alreadyReconnecting = true;
            logger.info('[Pairing] 检测到服务器 token 刷新，正在重建连接...');
            startServices(server).catch((e) => logger.warn('[Pairing] token 刷新重连失败: ' + e.message));
          }
        }

        if (serverPayload) {
          if (server && !alreadyReconnecting) {
            const sameAsCurrent = !!(rustClient?.connected
              && String(rustClient.config?.ip) === String(server.ip)
              && String(rustClient.config?.port) === String(server.port)
              && String(rustClient.config?.playerId) === String(server.playerId));
            if (sameAsCurrent) {
              logger.info('[Pairing] 已连接到该配对服务器，跳过自动连接。');
            } else {
              logger.info(`[Pairing] 配对成功后自动连接服务器: ${server.name}`);
              startServices(server).catch((e) => logger.warn('[Pairing] 自动连接失败: ' + e.message));
            }
          }
          if (!existed && server) {
            sendToRenderer('pairing:success', server);
          }
          if (!resolved) {
            resolved = true;
            resolve({ success: true, server });
          }
        } else {
          server = await findServerForEntityPairing(data);
          if (!server) {
            logger.warn('[Pairing] 收到设备配对推送，但未找到已配对服务器，已忽略');
            return;
          }
        }

        if (data?.entityId && server?.id) {
          const entityId = Number(data.entityId);
          if (Number.isFinite(entityId)) {
            const type = inferDeviceTypeFromPairing(data);
            const alias = String(data.entityName || `设备_${entityId}`);
            sendToRenderer('pairing:entity-candidate', {
              entityId,
              serverId: server.id,
              alias,
              type,
              serverName: server.name,
            });
          }
        }
      }, {
        onStatus: (status) => {
          sendToRenderer('pairing:listener-status', status);
          if (status?.type === 'notification-received' && pairingNoNotificationTimer) {
            clearTimeout(pairingNoNotificationTimer);
            pairingNoNotificationTimer = null;
          }
          if (status?.type === 'restarting') {
            logger.warn(`[Pairing] 监听已断开，${status.delayMs}ms 后自动重试（第${status.restartCount}次）`);
          }
        },
      });
      pairingNoNotificationTimer = setTimeout(() => {
        sendToRenderer('pairing:listener-status', {
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
    } catch (e) {
      resolve({ success: false, error: `配对监听失败: ${e.message}` });
    }
  }));

  ipcMain.on('pairing:stop', () => {
    fcmStopFn?.();
    fcmStopFn = null;
    if (pairingNoNotificationTimer) {
      clearTimeout(pairingNoNotificationTimer);
      pairingNoNotificationTimer = null;
    }
  });

  ipcMain.handle('pairing:diagnose', async () => {
    const steam = await getSteamProfileStatus({ fetchRemote: false });
    const cfgDir = getConfigDir();
    const cfgFile = path.join(cfgDir, 'rustplus.config.json');
    const logFile = path.join(cfgDir, 'fcm-listen-last.log');
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
  });

  ipcMain.handle('device:list', async (_, id) => listDevices(id));
  ipcMain.handle('device:listCurrent', async () => {
    if (!rustClient?.connected || !activeServerId) return [];
    return listDevices(activeServerId);
  });
  ipcMain.handle('device:register', async (_, opts) => {
    await registerDevice(opts);
    if (cmdParser && rustClient?.connected && String(opts?.serverId || '') === String(activeServerId || '')) {
      await subscribeEntityBroadcast(opts?.entityId, 'device-register');
      const t = String(opts?.type || '').toLowerCase();
      if (t === 'switch') {
        cmdParser.registerSwitch(opts.entityId, opts.alias);
      }
    }
    return { success: true };
  });
  ipcMain.handle('device:update', async (_, { entityId, updates }) => {
    const updated = await updateDevice(entityId, updates || {}, activeServerId || null);
    if (updated && cmdParser) {
      await subscribeEntityBroadcast(updated.entityId, 'device-update');
      const t = String(updated?.type || '').toLowerCase();
      if (t === 'switch') {
        cmdParser.registerSwitch(updated.entityId, updated.alias);
      } else {
        cmdParser.unregisterSwitch(updated.entityId);
      }
    }
    return { success: !!updated, device: updated };
  });
  ipcMain.handle('device:remove', async (_, entityId) => {
    const success = await removeDevice(entityId, activeServerId || null);
    if (success && cmdParser) cmdParser.unregisterSwitch(entityId);
    return { success };
  });
  ipcMain.handle('device:getInfo', async (_, id) => {
    if (!rustClient?.connected) return { error: '未连接' };
    try {
      return await rustClient.getEntityInfo(id);
    } catch (e) {
      const msg = String(e?.message || '未知错误');
      if (msg.toLowerCase() === 'not_found') return { error: '设备不存在或未配对到当前服务器' };
      return { error: msg };
    }
  });
  ipcMain.handle('device:switch', async (_, { entityId, state }) => {
    if (!rustClient?.connected) return { error: '未连接' };
    try {
      return state ? await rustClient.turnSwitchOn(entityId) : await rustClient.turnSwitchOff(entityId);
    } catch (e) {
      const msg = String(e?.message || '未知错误');
      if (msg.toLowerCase() === 'not_found') return { error: '开关设备未找到（可能已失效或不在当前服务器）' };
      return { error: msg };
    }
  });

  ipcMain.handle('server:getInfo', async () => {
    if (!rustClient?.connected) return null;
    try {
      const result = await rustClient.getServerInfo();
      if (result && !result.error) {
        const timeInfo = await rustClient.getTime().catch(() => null);
        latestServerInfoText = sanitizeServerInfoText(formatServerInfoText(result, timeInfo));
        latestServerInfo = buildServerInfoSnapshot(result, timeInfo);
      }
      return result;
    } catch (e) {
      if (String(e?.message || '').toLowerCase() === 'not_found') return null;
      logger.warn('[Main] getServerInfo 失败: ' + e.message);
      return { error: e.message };
    }
  });
  ipcMain.handle('server:getTeam', async () => {
    if (!rustClient?.connected) return null;
    try {
      return await rustClient.getTeamInfo();
    } catch (e) {
      if (String(e?.message || '').toLowerCase() === 'not_found') return null;
      logger.warn('[Main] getTeamInfo 失败: ' + e.message);
      return { error: e.message };
    }
  });
  ipcMain.handle('catalog:getItemsByIds', async (_, ids) => {
    const list = Array.isArray(ids) ? ids : [];
    const out = {};
    const toIconUrl = (shortName = '') => {
      const token = String(shortName || '').trim();
      if (!token) return '';
      return `https://cdn.rusthelp.com/images/public/${encodeURIComponent(token)}.png`;
    };
    const toLocalIconUrl = (id) => {
      const localPath = path.join(__dirname, '../assets/item-icons', `${id}.png`);
      if (!fs.existsSync(localPath)) return '';
      try {
        return pathToFileURL(localPath).href;
      } catch (_) {
        return '';
      }
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
  });
  ipcMain.handle('server:getHealth', async () => {
    if (!rustClient) return { connected: false, reason: 'client_not_initialized' };
    return rustClient.getHealthStatus();
  });

  // ── 地图 API ──────────────────────────────
  ipcMain.handle('map:getData', async () => {
    if (!rustClient?.connected) return { error: 'not_connected' };
    try {
      const [mapRes, serverRes] = await Promise.all([
        rustClient.getMap(),
        rustClient.getServerInfo().catch(() => null),
      ]);
      const rawServerInfo = serverRes?.info || serverRes || {};
      const normalized = normalizeServerMapPayload(mapRes, {
        serverInfo: rawServerInfo,
        mapSize: rawServerInfo?.mapSize || latestServerInfo?.mapSize,
      });
      return await enrichMapDataWithRustMaps(normalized, {
        mapSize: rawServerInfo?.mapSize || latestServerInfo?.mapSize,
        seed: rawServerInfo?.seed,
        serverName: rawServerInfo?.name || activeServerId || rustClient?.config?.name,
        mapName: rawServerInfo?.map,
      });
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('map:getMarkers', async () => {
    if (!rustClient?.connected) return { error: 'not_connected' };
    try {
      return await rustClient.getMapMarkers();
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('catalog:search', async (_, query) => {
    const q = String(query || '').trim();
    if (!q) return { items: [] };
    return { items: matchItems(q, { limit: 20 }) };
  });

  ipcMain.handle('rules:list', async () => {
    if (!rustClient?.connected || !activeServerId) return [];
    const rules = await listEventRules(activeServerId);
    return rules.map(serializeRule);
  });

  ipcMain.handle('rules:add', async (_, rule) => {
    if (!rustClient?.connected || !activeServerId) {
      return { success: false, error: '未连接服务器，无法新增事件规则' };
    }
    const normalized = normalizeEventRuleForServer({
      ...rule,
      id: rule.id || `rule_${Date.now()}`,
      name: rule.name || '未命名规则',
    }, activeServerId);
    if (LEGACY_PLAYER_STATUS_EVENTS.has(String(normalized.event || ''))) {
      return { success: false, error: '队友单项事件已下线，请使用「队友状态整合」事件' };
    }
    if (normalized.event === 'vending_new') {
      normalized.trigger = normalizeVendingNewTrigger(normalized.trigger || {});
      normalized._meta = {
        ...normalized._meta,
        message: String(normalized._meta.message || '').trim() || DEFAULT_VENDING_NEW_MESSAGE,
      };
    }
    if (normalized.event === 'cargo_ship_status') {
      normalized.trigger = {
        ...(normalized.trigger || {}),
        cargoNotifyEnter: normalized.trigger?.cargoNotifyEnter !== false,
        cargoNotifyLeave: normalized.trigger?.cargoNotifyLeave !== false,
        cargoNotifyActive: normalized.trigger?.cargoNotifyActive === true,
        cargoNotifyDock: normalized.trigger?.cargoNotifyDock !== false,
      };
      normalized._meta = {
        ...normalized._meta,
        message: String(normalized._meta.message || '').trim() || '{cargo_status_message}',
        cargoMessages: {
          ...DEFAULT_CARGO_STAGE_MESSAGES,
          ...(normalized._meta.cargoMessages || {}),
        },
      };
    }
    if (normalized.event === 'oil_rig_status') {
      normalized._meta = {
        ...normalized._meta,
        message: String(normalized._meta.message || '').trim() || '{oil_status_message}',
        oilMessages: {
          ...DEFAULT_OIL_STAGE_MESSAGES,
          ...(normalized._meta.oilMessages || {}),
        },
      };
    }
    if (normalized.event === 'ch47_status') {
      normalized.trigger = {
        ...(normalized.trigger || {}),
        ch47NotifyEnter: normalized.trigger?.ch47NotifyEnter !== false,
        ch47NotifyActive: normalized.trigger?.ch47NotifyActive === true,
        ch47NotifyLeave: normalized.trigger?.ch47NotifyLeave !== false,
      };
      normalized._meta = {
        ...normalized._meta,
        message: String(normalized._meta.message || '').trim() || '{ch47_status_message}',
        ch47Messages: {
          ...DEFAULT_CH47_STAGE_MESSAGES,
          ...(normalized._meta.ch47Messages || {}),
        },
      };
    }
    if (normalized.event === 'patrol_heli_status') {
      normalized.trigger = {
        ...(normalized.trigger || {}),
        heliNotifyEnter: normalized.trigger?.heliNotifyEnter !== false,
        heliNotifyActive: normalized.trigger?.heliNotifyActive === true,
        heliNotifyLeave: normalized.trigger?.heliNotifyLeave !== false,
        heliNotifyExplode: normalized.trigger?.heliNotifyExplode !== false,
      };
      normalized._meta = {
        ...normalized._meta,
        message: String(normalized._meta.message || '').trim() || '{heli_status_message}',
        heliMessages: {
          ...DEFAULT_HELI_STAGE_MESSAGES,
          ...(normalized._meta.heliMessages || {}),
        },
      };
    }
    if (normalized.event === 'vendor_status') {
      normalized.trigger = {
        ...(normalized.trigger || {}),
        vendorNotifyEnter: normalized.trigger?.vendorNotifyEnter !== false,
        vendorNotifyMove: normalized.trigger?.vendorNotifyMove === true,
        vendorNotifyStopped: normalized.trigger?.vendorNotifyStopped !== false,
        vendorNotifyLeave: normalized.trigger?.vendorNotifyLeave !== false,
      };
      normalized._meta = {
        ...normalized._meta,
        message: String(normalized._meta.message || '').trim() || '{vendor_status_message}',
        vendorMessages: {
          ...DEFAULT_VENDOR_STAGE_MESSAGES,
          ...(normalized._meta.vendorMessages || {}),
        },
      };
    }
    if (normalized.event === 'deep_sea_status') {
      normalized._meta = {
        ...normalized._meta,
        message: String(normalized._meta.message || '').trim() || '{deep_sea_status_message}',
        deepSeaMessages: normalizeDeepSeaStageMessages(normalized._meta.deepSeaMessages || {}),
      };
    }
    if (normalized.event === 'player_status') {
      normalized._meta = {
        ...normalized._meta,
        message: String(normalized._meta.message || '').trim() || '{player_status_message}',
        playerStatusMessages: {
          ...DEFAULT_PLAYER_STATUS_MESSAGES,
          ...(normalized._meta.playerStatusMessages || {}),
        },
      };
    }

    const hydrated = hydrateRule(normalized);
    eventEngine?.addRule(hydrated);
    const saved = await saveEventRule(normalized);
    return { success: true, rule: serializeRule(hydrateRule(saved)) };
  });

  ipcMain.handle('rules:remove', async (_, id) => {
    if (!activeServerId) return { success: false, error: '未连接服务器' };
    const rule = (await listEventRules(activeServerId)).find((r) => r.id === id);
    if (!rule) return { success: false, error: '规则不存在或不属于当前服务器' };
    eventEngine?.removeRule(id);
    await removeEventRule(id, activeServerId);
    return { success: true };
  });

  ipcMain.handle('rules:toggle', async (_, { id, enabled }) => {
    if (!activeServerId) return { success: false, error: '未连接服务器' };
    const rule = (await listEventRules(activeServerId)).find((r) => r.id === id);
    if (!rule) return { success: false, error: '规则不存在或不属于当前服务器' };
    eventEngine?.setRuleEnabled(id, enabled);
    await setEventRuleEnabled(id, enabled, activeServerId);
    return { success: true };
  });

  ipcMain.handle('commands:list', async () => {
    if (!rustClient?.connected || !activeServerId) return [];
    if (cmdParser) {
      return cmdParser.getCommands();
    }
    return [];
  });
  ipcMain.handle('commands:toggle', async (_, { keyword, enabled }) => {
    if (!cmdParser || !keyword || !activeServerId) return { success: false, error: '未连接服务器或指令不存在' };
    const key = String(keyword).toLowerCase().trim();
    const ok = cmdParser.setCommandEnabled(key, enabled);
    if (!ok) return { success: false, error: `指令不存在：${key}` };
    const snapshot = buildPersistedCommandSnapshot(key, activeServerId);
    if (!snapshot) return { success: false, error: `无法生成指令快照：${key}` };
    snapshot.enabled = !!enabled;
    await saveCommandRule(snapshot);
    return { success: true };
  });
  ipcMain.handle('commands:saveRule', async (_, rule) => {
    if (!activeServerId) return { success: false, error: '未连接服务器，无法保存指令规则' };
    const payload = normalizeCommandRuleForServer(rule, activeServerId);
    if (!payload) return { success: false, error: '缺少指令关键词' };
    if (!cmdParser?.setCommandRule(payload)) {
      return { success: false, error: '指令规则创建失败（类型或关键词无效）' };
    }
    await saveCommandRule({ ...payload, deleted: false });
    return { success: true };
  });
  ipcMain.handle('commands:removeRule', async (_, keyword) => {
    if (!activeServerId) return { success: false, error: '未连接服务器' };
    const key = String(keyword || '').toLowerCase().trim();
    if (!key) return { success: false };
    const current = cmdParser?.getCommand(key, { includeDeleted: true });
    if (!current) return { success: false, error: '指令不存在' };
    cmdParser?.removeCommandRule(key);
    if (current.isBuiltin) {
      const snapshot = buildPersistedCommandSnapshot(key, activeServerId) || {
        id: key,
        keyword: key,
        type: current.type || null,
        name: String(current.description || '').trim(),
        permission: current.permission || 'all',
        meta: current.meta || {},
        trigger: current.trigger || { cooldownMs: getGlobalTeamChatIntervalMs() },
        serverId: activeServerId,
      };
      await saveCommandRule({
        ...snapshot,
        enabled: false,
        deleted: true,
      });
    } else {
      await removeCommandRule(key, activeServerId);
    }
    return { success: true };
  });

  ipcMain.handle('presets:list', async () => listPresets());
  ipcMain.handle('presets:apply', async (_, { type, id, replaceExisting }) => {
    const presetType = String(type || '').trim();
    const presetId = String(id || '').trim();
    const shouldReplace = !!replaceExisting;
    if (!presetType || !presetId) {
      return { success: false, error: '预设参数不完整' };
    }

    if (presetType === 'events') {
      if (!rustClient?.connected || !activeServerId) {
        return { success: false, error: '未连接服务器，无法应用事件预设' };
      }
      const preset = getEventPreset(presetId);
      if (!preset) return { success: false, error: '事件预设不存在' };

      if (shouldReplace) {
        const existingRules = await listEventRules(activeServerId);
        for (const rule of existingRules) {
          eventEngine?.removeRule(rule.id);
          await removeEventRule(rule.id, activeServerId);
        }
      }

      for (const rule of preset.eventRules || []) {
        const normalized = normalizeEventRuleForServer({
          id: rule.id || `preset_rule_${Date.now()}`,
          name: rule.name || '预设规则',
          event: rule.event,
          serverId: activeServerId,
          trigger: { ...(rule.trigger || {}), cooldownMs: getGlobalTeamChatIntervalMs() },
          enabled: rule.enabled !== false,
          _meta: rule._meta || {},
        }, activeServerId);
        eventEngine?.addRule(hydrateRule(normalized));
        await saveEventRule(normalized);
      }
      return { success: true, applied: (preset.eventRules || []).length };
    }

    if (presetType === 'commands') {
      if (!rustClient?.connected || !activeServerId) {
        return { success: false, error: '未连接服务器，无法应用指令预设' };
      }
      const preset = getCommandPreset(presetId);
      if (!preset) return { success: false, error: '指令预设不存在' };

      if (shouldReplace) {
        const persisted = await listCommandRules(activeServerId);
        for (const item of persisted) await removeCommandRule(item.id, activeServerId);
        if (cmdParser) {
          cmdParser.restoreBuiltinCommands?.();
          for (const command of cmdParser.getCommands()) {
            if (command.isBuiltin) cmdParser.setCommandEnabled(command.keyword, false);
            else cmdParser.removeCommandRule(command.keyword);
          }
        }
      }

      const rulesToApply = buildSystemCommandRulesFromParser(activeServerId);
      for (const rule of rulesToApply.length ? rulesToApply : (preset.commandRules || [])) {
        const keyword = String(rule.keyword || '').toLowerCase();
        if (!keyword) continue;
        const payload = normalizeCommandRuleForServer({
          ...rule,
          id: String(rule.id || keyword),
          keyword,
          enabled: true,
          meta: {
            ...(rule.meta || {}),
            doNotify: false,
            doChat: true,
            actions: [{ type: 'team_chat' }],
          },
          trigger: { ...(rule.trigger || {}), cooldownMs: getGlobalTeamChatIntervalMs() },
        }, activeServerId);
        if (!payload) continue;
        if (cmdParser) {
          if (payload.type || payload.name || payload.meta) cmdParser.setCommandRule(payload);
          else cmdParser.setCommandEnabled(keyword, true);
        }
        await saveCommandRule({ ...payload, deleted: false });
      }
      return { success: true, applied: (rulesToApply.length ? rulesToApply : (preset.commandRules || [])).length };
    }

    return { success: false, error: '不支持的预设类型' };
  });

  ipcMain.handle('callgroup:list', async () => listGroups());

  ipcMain.handle('callgroup:set', async (_, payload = {}) => {
    const groupId = String(payload.id || '').trim() || `group_${Date.now()}`;
    const normalized = normalizeCallGroupInput({ ...payload, id: groupId });
    setGroup(groupId, normalized);
    await saveCallGroupDb(normalized);
    return { success: true, group: normalized };
  });

  ipcMain.handle('callgroup:remove', async (_, id) => {
    if (String(id || '') === TEAM_CHAT_SETTINGS_GROUP_ID) {
      return { success: false, error: '系统团队聊天配置不可删除' };
    }
    removeGroup(id);
    await removeCallGroupDb(id);
    return { success: true };
  });

  ipcMain.handle('callgroup:call', async (_, { groupId, message, channels } = {}) => (
    callGroup(groupId, message, { channels })
  ));

  ipcMain.handle('chat:send', async (_, msg) => sendTeamChatWithGuards(msg));

  logger.info('[Main] IPC 处理器已注册');
}

app.whenReady().then(async () => {
  await initDbs();
  await restoreCallGroups();
  createWindow();
  createTray();
  setupIPC();
  logger.info('[Main] 启动时已禁用自动连接，等待用户手动连接服务器');

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.rust.toolbox');
  }
});

app.on('before-quit', () => {
  eventEngine?.unbind();
  rustClient?.disconnect();
  stopTeamSyncPolling();
  fcmStopFn?.();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow?.show();
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

process.on('uncaughtException', (err) => {
  logger.error('[Main] 未捕获异常: ' + (err?.stack || err?.message || String(err)));
});

process.on('unhandledRejection', (reason) => {
  logger.error('[Main] 未处理 Promise 拒绝: ' + (reason?.stack || reason?.message || String(reason)));
});
