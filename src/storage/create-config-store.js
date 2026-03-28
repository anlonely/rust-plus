// src/storage/config.js
// ─────────────────────────────────────────────
// 配置持久化模块
// 管理服务器配对信息、设备列表、规则配置
// ─────────────────────────────────────────────

const path     = require('path');
const fs       = require('fs');
const fsp      = require('fs').promises;
const logger   = require('../utils/logger');
const { DEFAULT_AI_SETTINGS, normalizeAiSettings, isMaskedSecret } = require('../ai/runtime-config');
class JsonDb {
  constructor(filePath, defaults) {
    this.filePath = filePath;
    this.defaults = defaults;
    this.data = JSON.parse(JSON.stringify(defaults));
    this._queue = Promise.resolve();
  }

  async read() {
    try {
      const raw = await fsp.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.data = JSON.parse(JSON.stringify(this.defaults));
        return;
      }
      throw err;
    }
  }

  async write() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fsp.rename(tmp, this.filePath);
  }

  async withLock(task) {
    const run = this._queue.then(() => task(), () => task());
    this._queue = run.catch(() => {});
    return run;
  }
}


function createConfigStore({ configDir } = {}) {
  const CONFIG_DIR = String(configDir || '').trim();
  if (!CONFIG_DIR) throw new Error('configDir 不能为空');

  // ── 数据库初始化 ──────────────────────────────
  const serversDb = new JsonDb(path.join(CONFIG_DIR, 'servers.json'), { servers: [] });
  const devicesDb = new JsonDb(path.join(CONFIG_DIR, 'devices.json'), { devices: [] });
  const rulesDb   = new JsonDb(path.join(CONFIG_DIR, 'rules.json'), { eventRules: [], commandRules: [], callGroups: [], appState: {} });
  
  function serverKey(server = {}) {
    const ip = String(server.ip || '').trim();
    const port = String(parseInt(server.port, 10) || '').trim();
    const playerId = String(server.playerId || '').trim();
    return `${ip}:${port}:${playerId}`;
  }
  
  function normalizeServersAndDevices(servers = [], devices = []) {
    const map = new Map();
    const canonicalServers = [];
    const idRemap = new Map();
  
    for (const server of servers) {
      const key = serverKey(server);
      if (!key || key === '::') continue;
  
      if (!map.has(key)) {
        const normalized = {
          ...server,
          port: parseInt(server.port, 10),
        };
        map.set(key, normalized);
        canonicalServers.push(normalized);
        idRemap.set(server.id, normalized.id);
        continue;
      }
  
      const canonical = map.get(key);
      idRemap.set(server.id, canonical.id);
      // 保留最新 token / lastSeen，避免丢失有效凭据
      if (server.playerToken) canonical.playerToken = server.playerToken;
      if (server.lastSeen && (!canonical.lastSeen || new Date(server.lastSeen) > new Date(canonical.lastSeen))) {
        canonical.lastSeen = server.lastSeen;
      }
    }
  
    const normalizedDevices = [];
    const deviceMap = new Map();
    for (const dev of devices) {
      const remapped = idRemap.get(dev.serverId);
      const next = remapped ? { ...dev, serverId: remapped } : dev;
      if (!canonicalServers.find((s) => String(s.id) === String(next.serverId))) {
        continue; // 丢弃不属于任何已存在服务器的孤儿设备
      }
      const key = `${String(next.serverId || '')}:${String(next.entityId || '')}`;
      if (!deviceMap.has(key)) {
        deviceMap.set(key, next);
        normalizedDevices.push(next);
        continue;
      }
      const canonical = deviceMap.get(key);
      canonical.alias = next.alias || canonical.alias;
      canonical.type = next.type || canonical.type;
      canonical.lastState = next.lastState != null ? next.lastState : canonical.lastState;
      if (next.updatedAt) canonical.updatedAt = next.updatedAt;
      if (next.lastUpdate) canonical.lastUpdate = next.lastUpdate;
    }
  
    return { servers: canonicalServers, devices: normalizedDevices };
  }
  
  async function initDbs() {
    await serversDb.read();
    await devicesDb.read();
    await rulesDb.read();
  
    // 初始化默认结构
    serversDb.data ||= { servers: [] };
    devicesDb.data ||= { devices: [] };
    rulesDb.data   ||= { eventRules: [], commandRules: [], callGroups: [], appState: {} };
    rulesDb.data.appState ||= {};
  
    const normalized = normalizeServersAndDevices(
      serversDb.data.servers || [],
      devicesDb.data.devices || [],
    );
    serversDb.data.servers = normalized.servers;
    devicesDb.data.devices = normalized.devices;
  
    await serversDb.write();
    await devicesDb.write();
    await rulesDb.write();
  }
  
  // ════════════════════════════════════════════
  // 服务器配对管理
  // ════════════════════════════════════════════
  
  /** 保存一个配对好的服务器 */
  async function saveServer(pairingData) {
    await serversDb.read();
    const servers = serversDb.data.servers;
  
    // 如果已存在（相同 IP + Port + PlayerId），更新而非重复添加
    const incomingPort = parseInt(pairingData.port, 10);
    const incomingPlayerId = String(pairingData.playerId || '');
    const idx = servers.findIndex(
      s => String(s.ip) === String(pairingData.ip)
        && parseInt(s.port, 10) === incomingPort
        && String(s.playerId || '') === incomingPlayerId
    );
  
    const record = {
      id:          `server_${Date.now()}`,
      name:        pairingData.name || `${pairingData.ip}:${pairingData.port}`,
      ip:          pairingData.ip,
      port:        incomingPort,
      playerId:    pairingData.playerId,
      playerToken: pairingData.playerToken,   // 生产环境建议加密
      url:         pairingData.url || '',
      addedAt:     new Date().toISOString(),
      lastSeen:    new Date().toISOString(),
      ...( idx >= 0 ? { id: servers[idx].id } : {} ),
    };
  
    if (idx >= 0) {
      servers[idx] = record;
      logger.info(`[Config] 服务器已更新: ${record.name}`);
    } else {
      servers.push(record);
      logger.info(`[Config] 新服务器已保存: ${record.name}`);
    }
  
    await serversDb.write();
    return record;
  }
  
  /** 获取所有服务器 */
  async function listServers() {
    await serversDb.read();
    return serversDb.data.servers;
  }
  
  /** 根据 ID 获取服务器 */
  async function getServer(serverId) {
    await serversDb.read();
    return serversDb.data.servers.find(s => s.id === serverId) || null;
  }
  
  /** 获取第一个（默认）服务器 */
  async function getDefaultServer() {
    await serversDb.read();
    return serversDb.data.servers[0] || null;
  }
  
  /** 删除服务器 */
  async function removeServer(serverId) {
    const result = await removeServerCascade(serverId);
    return !!result.removedServer;
  }
  
  async function removeServerCascade(serverId) {
    const sid = String(serverId || '').trim();
    if (!sid) {
      return {
        removedServer: false,
        removedDevices: 0,
        removedEventRules: 0,
        removedCommandRules: 0,
      };
    }
  
    await serversDb.read();
    await devicesDb.read();
    await rulesDb.read();
  
    const serverBefore = serversDb.data.servers.length;
    serversDb.data.servers = serversDb.data.servers.filter((s) => String(s.id) !== sid);
    const removedServer = serversDb.data.servers.length < serverBefore;
  
    const devicesBefore = devicesDb.data.devices.length;
    devicesDb.data.devices = devicesDb.data.devices.filter((d) => String(d.serverId || '') !== sid);
    const removedDevices = Math.max(0, devicesBefore - devicesDb.data.devices.length);
  
    const eventBefore = (rulesDb.data.eventRules || []).length;
    rulesDb.data.eventRules = (rulesDb.data.eventRules || []).filter((r) => String(r.serverId || '') !== sid);
    const removedEventRules = Math.max(0, eventBefore - rulesDb.data.eventRules.length);
  
    const commandBefore = (rulesDb.data.commandRules || []).length;
    rulesDb.data.commandRules = (rulesDb.data.commandRules || []).filter((r) => String(r.serverId || '') !== sid);
    const removedCommandRules = Math.max(0, commandBefore - rulesDb.data.commandRules.length);
  
    await serversDb.write();
    await devicesDb.write();
    await rulesDb.write();
  
    return {
      removedServer,
      removedDevices,
      removedEventRules,
      removedCommandRules,
    };
  }
  
  async function getLastServerId() {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      return rulesDb.data?.appState?.lastServerId || null;
    });
  }
  
  async function setLastServerId(serverId) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      rulesDb.data.appState ||= {};
      rulesDb.data.appState.lastServerId = serverId || null;
      await rulesDb.write();
    });
  }
  
  async function getDeepSeaState() {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const ds = rulesDb.data?.appState?.deepSea || {};
      return {
        lastOpenAt: ds.lastOpenAt || null,
        lastCloseAt: ds.lastCloseAt || null,
        lastDirection: ds.lastDirection || null,
        lastEntryGrid: ds.lastEntryGrid || null,
        lastEntryCoord: ds.lastEntryCoord || null,
        updatedAt: ds.updatedAt || null,
      };
    });
  }
  
  async function saveDeepSeaState(patch = {}) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      rulesDb.data.appState ||= {};
      const base = rulesDb.data.appState.deepSea || {};
      const next = { ...base, ...patch, updatedAt: new Date().toISOString() };
      rulesDb.data.appState.deepSea = next;
      await rulesDb.write();
      return next;
    });
  }

  async function getAiSettings() {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const raw = rulesDb.data?.appState?.aiSettings || {};
      return normalizeAiSettings(raw);
    });
  }

  async function updateAiSettings(patch = {}) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      rulesDb.data.appState ||= {};
      const current = normalizeAiSettings(rulesDb.data.appState.aiSettings || {});
      const mergedPatch = patch && typeof patch === 'object' ? { ...patch } : {};
      if (isMaskedSecret(mergedPatch.authToken) && current.authToken) {
        mergedPatch.authToken = current.authToken;
      }
      const next = normalizeAiSettings({
        ...current,
        ...mergedPatch,
      });
      rulesDb.data.appState.aiSettings = next;
      await rulesDb.write();
      return next;
    });
  }
  
  // ════════════════════════════════════════════
  // 设备管理
  // ════════════════════════════════════════════
  
  /**
   * 注册一个绑定的设备（智能开关 / 警报器）
   * @param {object} opts
   * @param {number}  opts.entityId  - Rust+ Entity ID
   * @param {string}  opts.serverId  - 所属服务器 ID
   * @param {string}  opts.alias     - 用户自定义别名
   * @param {string}  opts.type      - 'switch' | 'alarm' | 'storage'
   */
  async function registerDevice({ entityId, serverId, alias, type }) {
    await devicesDb.read();
    const devices = devicesDb.data.devices;
  
    const existing = devices.find(
      d => String(d.entityId) === String(entityId) && String(d.serverId) === String(serverId)
    );
  
    if (existing) {
      existing.alias     = alias || existing.alias;
      existing.updatedAt = new Date().toISOString();
      logger.info(`[Config] 设备已更新: [${alias}] entityId=${entityId}`);
    } else {
      devices.push({
        entityId,
        serverId,
        alias:     alias || `设备_${entityId}`,
        type:      type  || 'switch',
        lastState: null,
        addedAt:   new Date().toISOString(),
      });
      logger.info(`[Config] 设备已注册: [${alias}] entityId=${entityId} type=${type}`);
    }
  
    await devicesDb.write();
  }
  
  /** 获取指定服务器下的所有设备 */
  async function listDevices(serverId) {
    await devicesDb.read();
    return devicesDb.data.devices.filter(d => !serverId || d.serverId === serverId);
  }
  
  /** 更新设备最后状态 */
  async function updateDeviceState(entityId, state) {
    await devicesDb.read();
    const dev = devicesDb.data.devices.find(d => d.entityId === entityId);
    if (dev) {
      dev.lastState  = state;
      dev.lastUpdate = new Date().toISOString();
      await devicesDb.write();
    }
  }
  
  async function updateDevice(entityId, updates = {}, serverId = null) {
    await devicesDb.read();
    const dev = devicesDb.data.devices.find((d) => {
      if (String(d.entityId) !== String(entityId)) return false;
      if (serverId == null) return true;
      return String(d.serverId || '') === String(serverId);
    });
    if (!dev) return null;
    if (typeof updates.alias === 'string' && updates.alias.trim()) {
      dev.alias = updates.alias.trim();
    }
    if (typeof updates.type === 'string' && updates.type.trim()) {
      dev.type = updates.type.trim();
    }
    dev.updatedAt = new Date().toISOString();
    await devicesDb.write();
    return dev;
  }
  
  async function removeDevice(entityId, serverId = null) {
    await devicesDb.read();
    const before = devicesDb.data.devices.length;
    devicesDb.data.devices = devicesDb.data.devices.filter((d) => {
      if (String(d.entityId) !== String(entityId)) return true;
      if (serverId == null) return false;
      return String(d.serverId || '') !== String(serverId);
    });
    await devicesDb.write();
    return devicesDb.data.devices.length < before;
  }
  
  // ════════════════════════════════════════════
  // 事件规则 / 指令 / 呼叫组
  // ════════════════════════════════════════════
  
  async function listEventRules(serverId = null) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const rules = rulesDb.data.eventRules || [];
      if (!serverId) return rules;
      return rules.filter((r) => String(r.serverId || '') === String(serverId));
    });
  }
  
  async function saveEventRule(rule) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const rules = rulesDb.data.eventRules || [];
      const serverId = rule.serverId || null;
      const idx = rules.findIndex(r => r.id === rule.id && (r.serverId || null) === serverId);
      const record = {
        ...rule,
        updatedAt: new Date().toISOString(),
        createdAt: idx >= 0 ? rules[idx].createdAt : new Date().toISOString(),
      };
      if (idx >= 0) rules[idx] = record;
      else rules.push(record);
      rulesDb.data.eventRules = rules;
      await rulesDb.write();
      return record;
    });
  }
  
  async function removeEventRule(ruleId, serverId = null) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const before = rulesDb.data.eventRules.length;
      rulesDb.data.eventRules = rulesDb.data.eventRules.filter(r => {
        if (r.id !== ruleId) return true;
        if (serverId == null) return false;
        return String(r.serverId || '') !== String(serverId);
      });
      await rulesDb.write();
      return rulesDb.data.eventRules.length < before;
    });
  }
  
  async function setEventRuleEnabled(ruleId, enabled, serverId = null) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const rule = (rulesDb.data.eventRules || []).find(r =>
        r.id === ruleId && (serverId == null || String(r.serverId || '') === String(serverId))
      );
      if (!rule) return false;
      rule.enabled = !!enabled;
      rule.updatedAt = new Date().toISOString();
      await rulesDb.write();
      return true;
    });
  }

  async function replaceEventRules(serverId, nextRules = []) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const sid = String(serverId || '').trim();
      const preserved = (rulesDb.data.eventRules || []).filter((rule) => String(rule.serverId || '') !== sid);
      const now = new Date().toISOString();
      const normalized = nextRules.map((rule) => ({
        ...rule,
        serverId: sid,
        updatedAt: now,
        createdAt: rule?.createdAt || now,
      }));
      rulesDb.data.eventRules = preserved.concat(normalized);
      await rulesDb.write();
      return normalized;
    });
  }
  
  async function listCommandRules(serverId = null) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const rules = rulesDb.data.commandRules || [];
      if (!serverId) return rules;
      return rules.filter((r) => String(r.serverId || '') === String(serverId));
    });
  }
  
  async function saveCommandRule(rule) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const rules = rulesDb.data.commandRules || [];
      const serverId = rule.serverId || null;
      const idx = rules.findIndex(r => r.id === rule.id && (r.serverId || null) === serverId);
      const record = {
        ...rule,
        updatedAt: new Date().toISOString(),
        createdAt: idx >= 0 ? rules[idx].createdAt : new Date().toISOString(),
      };
      if (idx >= 0) rules[idx] = record;
      else rules.push(record);
      rulesDb.data.commandRules = rules;
      await rulesDb.write();
      return record;
    });
  }
  
  async function removeCommandRule(ruleId, serverId = null) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const before = rulesDb.data.commandRules.length;
      rulesDb.data.commandRules = rulesDb.data.commandRules.filter(r => {
        if (r.id !== ruleId) return true;
        if (serverId == null) return false;
        return String(r.serverId || '') !== String(serverId);
      });
      await rulesDb.write();
      return rulesDb.data.commandRules.length < before;
    });
  }

  async function replaceCommandRules(serverId, nextRules = []) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const sid = String(serverId || '').trim();
      const preserved = (rulesDb.data.commandRules || []).filter((rule) => String(rule.serverId || '') !== sid);
      const now = new Date().toISOString();
      const normalized = nextRules.map((rule) => ({
        ...rule,
        serverId: sid,
        updatedAt: now,
        createdAt: rule?.createdAt || now,
      }));
      rulesDb.data.commandRules = preserved.concat(normalized);
      await rulesDb.write();
      return normalized;
    });
  }
  
  async function listCallGroupsDb() {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      return rulesDb.data.callGroups || [];
    });
  }
  
  async function saveCallGroupDb(group) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const groups = rulesDb.data.callGroups || [];
      const idx = groups.findIndex(g => g.id === group.id);
      const record = {
        ...group,
        updatedAt: new Date().toISOString(),
        createdAt: idx >= 0 ? groups[idx].createdAt : new Date().toISOString(),
      };
      if (idx >= 0) groups[idx] = record;
      else groups.push(record);
      rulesDb.data.callGroups = groups;
      await rulesDb.write();
      return record;
    });
  }
  
  async function removeCallGroupDb(groupId) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const before = rulesDb.data.callGroups.length;
      rulesDb.data.callGroups = rulesDb.data.callGroups.filter(g => g.id !== groupId);
      await rulesDb.write();
      return rulesDb.data.callGroups.length < before;
    });
  }
  
  async function replaceAllRulesData(nextData = {}) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      rulesDb.data.eventRules = Array.isArray(nextData.eventRules) ? nextData.eventRules : [];
      rulesDb.data.commandRules = Array.isArray(nextData.commandRules) ? nextData.commandRules : [];
      rulesDb.data.callGroups = Array.isArray(nextData.callGroups) ? nextData.callGroups : [];
      rulesDb.data.appState = nextData.appState || rulesDb.data.appState || {};
      await rulesDb.write();
    });
  }

  async function getCallControlState() {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      const raw = rulesDb.data?.appState?.callControl || {};
      return {
        phoneEnabled: raw.phoneEnabled !== false,
        updatedAt: raw.updatedAt || null,
      };
    });
  }

  async function updateCallControlState(patch = {}) {
    return rulesDb.withLock(async () => {
      await rulesDb.read();
      rulesDb.data.appState ||= {};
      const current = rulesDb.data.appState.callControl || {};
      const next = {
        phoneEnabled: patch.phoneEnabled !== false,
        updatedAt: new Date().toISOString(),
      };
      rulesDb.data.appState.callControl = {
        ...current,
        ...next,
      };
      await rulesDb.write();
      return {
        phoneEnabled: rulesDb.data.appState.callControl.phoneEnabled !== false,
        updatedAt: rulesDb.data.appState.callControl.updatedAt || null,
      };
    });
  }

  return {
    initDbs,
    saveServer,
    listServers,
    getServer,
    getDefaultServer,
    removeServer,
    removeServerCascade,
    getLastServerId,
    setLastServerId,
    registerDevice,
    listDevices,
    updateDeviceState,
    updateDevice,
    removeDevice,
    listEventRules,
    saveEventRule,
    removeEventRule,
    setEventRuleEnabled,
    replaceEventRules,
    listCommandRules,
    saveCommandRule,
    removeCommandRule,
    replaceCommandRules,
    listCallGroupsDb,
    saveCallGroupDb,
    removeCallGroupDb,
    replaceAllRulesData,
    getCallControlState,
    updateCallControlState,
    getDeepSeaState,
    saveDeepSeaState,
    getAiSettings,
    updateAiSettings,
  };
}

module.exports = {
  createConfigStore,
};
