// electron/preload.js
// ─────────────────────────────────────────────
// 安全桥接：渲染进程 ↔ 主进程 IPC
// 通过 contextBridge 暴露受限 API
// ─────────────────────────────────────────────

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rustAPI', {

  // ── 应用初始化 ──────────────────────────
  init: ()                    => ipcRenderer.invoke('app:init'),

  // ── 窗口控制 ────────────────────────────
  minimize: ()                => ipcRenderer.send('win:minimize'),
  maximize: ()                => ipcRenderer.send('win:maximize'),
  closeWin: ()                => ipcRenderer.send('win:close'),
  quit:     ()                => ipcRenderer.send('win:quit'),

  // ── 服务器管理 ──────────────────────────
  listServers:    ()          => ipcRenderer.invoke('server:list'),
  removeServer:   (id)        => ipcRenderer.invoke('server:remove', id),
  connectServer:  (cfg)       => ipcRenderer.invoke('server:connect', cfg),
  getServerInfo:  ()          => ipcRenderer.invoke('server:getInfo'),
  getTeamInfo:    ()          => ipcRenderer.invoke('server:getTeam'),
  getItemsByIds:  (ids)       => ipcRenderer.invoke('catalog:getItemsByIds', ids),
  getServerHealth:()          => ipcRenderer.invoke('server:getHealth'),

  // ── 地图 ──────────────────────────────────
  getMapData:     ()          => ipcRenderer.invoke('map:getData'),
  getMapMarkers:  ()          => ipcRenderer.invoke('map:getMarkers'),
  searchItems:    (query)     => ipcRenderer.invoke('catalog:search', query),

  // ── 配对 ────────────────────────────────
  startPairing:   (options)   => ipcRenderer.invoke('pairing:start', options || {}),
  stopPairing:    ()          => ipcRenderer.send('pairing:stop'),
  diagnosePairing:()          => ipcRenderer.invoke('pairing:diagnose'),

  // ── 设备管理 ────────────────────────────
  listDevices:    (serverId)  => ipcRenderer.invoke('device:list', serverId),
  registerDevice: (opts)      => ipcRenderer.invoke('device:register', opts),
  updateDevice:   (entityId, updates) => ipcRenderer.invoke('device:update', { entityId, updates }),
  removeDevice:   (entityId)  => ipcRenderer.invoke('device:remove', entityId),
  getEntityInfo:  (id)        => ipcRenderer.invoke('device:getInfo', id),
  setSwitch:      (id, state) => ipcRenderer.invoke('device:switch', { entityId: id, state }),

  // ── 事件规则 ────────────────────────────
  listRules:      ()          => ipcRenderer.invoke('rules:list'),
  addRule:        (rule)      => ipcRenderer.invoke('rules:add', rule),
  removeRule:     (id)        => ipcRenderer.invoke('rules:remove', id),
  toggleRule:     (id, en)    => ipcRenderer.invoke('rules:toggle', { id, enabled: en }),

  // ── 指令管理 ────────────────────────────
  listCommands:   ()          => ipcRenderer.invoke('commands:list'),
  toggleCommand:  (keyword, enabled) => ipcRenderer.invoke('commands:toggle', { keyword, enabled }),
  saveCommandRule:(rule)      => ipcRenderer.invoke('commands:saveRule', rule),
  removeCommandRule:(keyword) => ipcRenderer.invoke('commands:removeRule', keyword),
  listPresets:    ()          => ipcRenderer.invoke('presets:list'),
  applyPreset:    (type, id, replaceExisting) => ipcRenderer.invoke('presets:apply', { type, id, replaceExisting }),

  // ── 呼叫组 ──────────────────────────────
  listCallGroups: ()          => ipcRenderer.invoke('callgroup:list'),
  setCallGroup:   (g)         => ipcRenderer.invoke('callgroup:set', g),
  removeCallGroup:(id)        => ipcRenderer.invoke('callgroup:remove', id),
  triggerCall:    (gid, msg, channels)  => ipcRenderer.invoke('callgroup:call', { groupId: gid, message: msg, channels }),

  // ── 团队聊天 ────────────────────────────
  sendChat:       (msg)       => ipcRenderer.invoke('chat:send', msg),

  // ── 外部链接 ────────────────────────────
  openUrl:        (url)       => ipcRenderer.send('open:url', url),
  getSteamStatus: ()          => ipcRenderer.invoke('steam:status'),
  steamBeginAuth: ()          => ipcRenderer.invoke('steam:beginAuth'),
  steamLogout:    ()          => ipcRenderer.invoke('steam:logout'),
  getHelpDoc:     ()          => ipcRenderer.invoke('docs:getHelp'),

  // ── 事件监听（主进程 → 渲染进程）────────
  on: (channel, callback) => {
    const validChannels = [
      'server:status', 'entity:changed', 'team:changed',
      'team:message', 'team:sync-status', 'pairing:success', 'pairing:entity-candidate', 'pairing:listener-status', 'rule:auto-toggled', 'notification',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => callback(data));
    }
  },
  off: (channel) => ipcRenderer.removeAllListeners(channel),
});
