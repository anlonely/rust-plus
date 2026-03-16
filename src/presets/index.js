// src/presets/index.js
// 本地预设：用于个人部署的一键配置

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function commandDefaults(meta = {}, trigger = {}) {
  return {
    meta: {
      doNotify: false,
      doChat: true,
      actions: [{ type: 'team_chat' }],
      ...meta,
    },
    trigger: {
      cooldownMs: 3_000,
      ...trigger,
    },
  };
}

const EVENT_RULESET_DEFENSE_BASIC = [
  {
    id: 'preset_alarm_on_notify',
    name: '警报触发通知',
    event: 'alarm_on',
    trigger: { cooldownMs: 30_000 },
    enabled: true,
    _meta: {
      message: '⚠️ 警报器触发，请注意基地安全',
      actions: [{ type: 'team_chat' }],
    },
  },
  {
    id: 'preset_player_status',
    name: '队友状态整合通知',
    event: 'player_status',
    trigger: { cooldownMs: 5_000 },
    enabled: true,
    _meta: {
      message: '{player_status_message}',
      actions: [{ type: 'team_chat' }],
    },
  },
  {
    id: 'preset_heli_status',
    name: '武装直升机整合通知',
    event: 'patrol_heli_status',
    trigger: {
      cooldownMs: 60_000,
      heliNotifyEnter: true,
      heliNotifyActive: false,
      heliNotifyLeave: true,
      heliNotifyExplode: true,
    },
    enabled: true,
    _meta: { message: '{heli_status_message}', actions: [{ type: 'team_chat' }] },
  },
  {
    id: 'preset_ch47_status',
    name: '军用运输直升机整合通知',
    event: 'ch47_status',
    trigger: {
      cooldownMs: 60_000,
      ch47NotifyEnter: true,
      ch47NotifyActive: false,
      ch47NotifyLeave: true,
    },
    enabled: true,
    _meta: { message: '{ch47_status_message}', actions: [{ type: 'team_chat' }] },
  },
  {
    id: 'preset_cargo_status',
    name: '货船事件整合通知',
    event: 'cargo_ship_status',
    trigger: {
      cooldownMs: 60_000,
      cargoNotifyEnter: true,
      cargoNotifyLeave: true,
      cargoNotifyActive: false,
      cargoNotifyDock: true,
    },
    enabled: true,
    _meta: { message: '{cargo_status_message}', actions: [{ type: 'team_chat' }] },
  },
  {
    id: 'preset_oil_status',
    name: '石油事件整合通知',
    event: 'oil_rig_status',
    trigger: {
      cooldownMs: 60_000,
      oilNotifyLargeHeavy: true,
      oilNotifySmallHeavy: true,
      oilNotifyLargeUnlock: true,
      oilNotifySmallUnlock: true,
    },
    enabled: true,
    _meta: { message: '{oil_status_message}', actions: [{ type: 'team_chat' }] },
  },
];

const EVENT_RULESET_PATROL_VENDOR = [
  {
    id: 'preset_vendor_status',
    name: '流浪商人整合通知',
    event: 'vendor_status',
    trigger: {
      cooldownMs: 120_000,
      vendorNotifyEnter: true,
      vendorNotifyMove: false,
      vendorNotifyStopped: true,
      vendorNotifyLeave: true,
    },
    enabled: true,
    _meta: { message: '{vendor_status_message}', actions: [{ type: 'team_chat' }] },
  },
  {
    id: 'preset_vending_new',
    name: '新售货机出现通知',
    event: 'vending_new',
    trigger: { cooldownMs: 10_000 },
    enabled: true,
    _meta: { message: '新售货机出现｜位置:{marker_grid} 出售:{vending_items}', actions: [{ type: 'team_chat' }] },
  },
  {
    id: 'preset_deepsea_status',
    name: '深海整合通知',
    event: 'deep_sea_status',
    trigger: {
      cooldownMs: 30_000,
      deepSeaNotifyOpen: true,
      deepSeaNotifyClose: true,
    },
    enabled: true,
    _meta: { message: '{deep_sea_status_message}', actions: [{ type: 'team_chat' }] },
  },
  {
    id: 'preset_hourly',
    name: '整点播报',
    event: 'hourly_tick',
    trigger: { cooldownMs: 0 },
    enabled: true,
    _meta: { message: '当前游戏时间{hourly_time} ｜{day_phase}｜距离{phase_target}还有{time_to_phase_real}', actions: [{ type: 'team_chat' }] },
  },
  {
    id: 'preset_day_phase_notice',
    name: '天黑天亮提醒',
    event: 'day_phase_notice',
    trigger: { cooldownMs: 30_000 },
    enabled: true,
    _meta: { message: '当前游戏时间{hourly_time} ｜{day_phase}｜距离{phase_target}还有{time_to_phase_real}', actions: [{ type: 'team_chat' }] },
  },
];

const EVENT_SYSTEM_RULESET = [...EVENT_RULESET_DEFENSE_BASIC, ...EVENT_RULESET_PATROL_VENDOR];

const COMMAND_TYPE_BY_KEYWORD = {
  ai: 'ai',
  shj: 'query_vendor',
  fwq: 'server_info',
  sh: 'deep_sea_status',
  fy: 'translate',
  dz: 'change_leader',
  fk: 'switch',
  hc: 'query_cargo',
  wz: 'query_heli',
  jk: 'cctv_codes',
  help: null,
};

const COMMAND_RULESET_CORE_DEFAULT = [
  'ai',
  'shj',
  'fwq',
  'sh',
  'fy',
  'dz',
  'fk',
  'hc',
  'wz',
  'jk',
  'help',
].map((keyword) => ({
  id: keyword,
  keyword,
  type: COMMAND_TYPE_BY_KEYWORD[keyword] || null,
  name: keyword === 'fk' ? '防空' : undefined,
  permission: keyword === 'fk' ? 'all' : undefined,
  ...commandDefaults(keyword === 'fk' ? { action: 'toggle' } : {}),
  enabled: true,
}));

const COMMAND_RULESET_SAFE_MINIMAL = [
  { id: 'ai', keyword: 'ai', type: 'ai', ...commandDefaults(), enabled: true },
  { id: 'shj', keyword: 'shj', type: 'query_vendor', ...commandDefaults(), enabled: true },
  { id: 'fwq', keyword: 'fwq', type: 'server_info', ...commandDefaults(), enabled: true },
  { id: 'sh', keyword: 'sh', type: 'deep_sea_status', ...commandDefaults(), enabled: true },
  { id: 'fy', keyword: 'fy', type: 'translate', ...commandDefaults(), enabled: true },
  { id: 'dz', keyword: 'dz', type: 'change_leader', ...commandDefaults(), enabled: false },
  { id: 'fk', keyword: 'fk', type: 'switch', name: '防空', permission: 'all', ...commandDefaults({ action: 'toggle' }), enabled: false },
  { id: 'hc', keyword: 'hc', type: 'query_cargo', ...commandDefaults(), enabled: true },
  { id: 'wz', keyword: 'wz', type: 'query_heli', ...commandDefaults(), enabled: true },
  { id: 'jk', keyword: 'jk', type: 'cctv_codes', ...commandDefaults(), enabled: true },
  { id: 'help', keyword: 'help', type: null, ...commandDefaults(), enabled: true },
];

const EVENT_PRESETS = [
  {
    id: 'event_system_default',
    name: '系统预设（事件全量）',
    description: '覆盖当前全部内置事件逻辑',
    isSystem: true,
    eventRules: EVENT_SYSTEM_RULESET,
  },
  {
    id: 'event_defense_basic',
    name: '基地安防基础',
    description: '警报、队友状态整合、货船与直升机基础通知',
    eventRules: EVENT_RULESET_DEFENSE_BASIC,
  },
  {
    id: 'event_patrol_vendor',
    name: '巡逻与商人播报',
    description: '流浪商人与持续播报相关事件',
    eventRules: EVENT_RULESET_PATROL_VENDOR,
  },
];

const COMMAND_PRESETS = [
  {
    id: 'command_system_default',
    name: '系统预设（指令全量）',
    description: '覆盖当前全部内置指令逻辑',
    isSystem: true,
    commandRules: COMMAND_RULESET_CORE_DEFAULT,
  },
  {
    id: 'command_core_default',
    name: '核心指令全开',
    description: '启用默认核心指令',
    commandRules: COMMAND_RULESET_CORE_DEFAULT,
  },
  {
    id: 'command_safe_minimal',
    name: '安全精简模式',
    description: '保留查询类指令，禁用控制类指令',
    commandRules: COMMAND_RULESET_SAFE_MINIMAL,
  },
];

function listPresets() {
  return {
    events: EVENT_PRESETS.map(({ id, name, description, isSystem }) => ({ id, name, description, isSystem: !!isSystem })),
    commands: COMMAND_PRESETS.map(({ id, name, description, isSystem }) => ({ id, name, description, isSystem: !!isSystem })),
  };
}

function getEventPreset(id) {
  const found = EVENT_PRESETS.find((p) => p.id === id) || null;
  return found ? deepClone(found) : null;
}

function getCommandPreset(id) {
  const found = COMMAND_PRESETS.find((p) => p.id === id) || null;
  return found ? deepClone(found) : null;
}

module.exports = {
  listPresets,
  getEventPreset,
  getCommandPreset,
};
