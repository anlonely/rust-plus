// src/commands/parser.js  (v2 - 接入真实 AI + 翻译)
// ─────────────────────────────────────────────

const logger    = require('../utils/logger');
const { ask }   = require('../ai/client');
const { translate } = require('../translate/client');
const { buildServerInfoSnapshot } = require('../utils/server-info');
const { analyzeDeepSeaStatus, formatDurationFixedHms, formatMinutesSeconds } = require('../utils/deep-sea');
const { getDeepSeaState } = require('../storage/config');
const { markerToGrid9 } = require('../utils/map-grid');
const { normalizeSteamId64 } = require('../utils/steam-id');
const { matchItems, getItemById } = require('../utils/item-catalog');
const { matchCctvEntries } = require('../utils/cctv-codes');
const RUST_TEAM_MESSAGE_MAX_CHARS = Math.max(32, parseInt(process.env.RUST_TEAM_MESSAGE_MAX_CHARS || '128', 10) || 128);
const SHJ_GRID_X_OFFSET_RAW = Number(process.env.RUST_SHJ_GRID_X_OFFSET);
const SHJ_GRID_X_OFFSET = Number.isFinite(SHJ_GRID_X_OFFSET_RAW) ? SHJ_GRID_X_OFFSET_RAW : 0;
const SHJ_GRID_Y_OFFSET_RAW = Number(process.env.RUST_SHJ_GRID_Y_OFFSET);
const SHJ_GRID_Y_OFFSET = Number.isFinite(SHJ_GRID_Y_OFFSET_RAW) ? SHJ_GRID_Y_OFFSET_RAW : 0;

class CommandParser {
  constructor({
    leaderId = '',
    prefix = '',
    callGroupRunner = null,
    notifyDesktopRunner = null,
    notifyDiscordRunner = null,
    teamChatRunner = null,
  } = {}) {
    this.leaderId  = leaderId;
    this.prefix    = prefix;
    this._commands = {};
    this._builtinKeywords = new Set();
    this._client   = null;
    this._callGroupRunner = typeof callGroupRunner === 'function' ? callGroupRunner : null;
    this._notifyDesktopRunner = typeof notifyDesktopRunner === 'function' ? notifyDesktopRunner : null;
    this._notifyDiscordRunner = typeof notifyDiscordRunner === 'function' ? notifyDiscordRunner : null;
    this._teamChatRunner = typeof teamChatRunner === 'function' ? teamChatRunner : null;
    this._switches = new Map(); // entityId → alias
    this._cargoTrack = new Map(); // cargoId -> { x, y, at }
    this._cargoBoundaryTimer = null;
    this._cargoHarborsCache = { at: 0, mapSize: 0, items: [] };
    this._heliTrack = new Map(); // heliId -> { lastGrid, lastSeenAt }
    this._commandCooldownAt = new Map();
    this._boundTeamMessageHandler = null;
    this._registerBuiltins();
  }

  register(keyword, handler, { permission = 'all', description = '', type = null, meta = {}, trigger = null } = {}) {
    const key = keyword.toLowerCase();
    this._commands[key] = {
      handler,
      permission,
      description,
      enabled: true,
      type,
      meta: this._normalizeCommandMeta(meta),
      trigger: this._normalizeCommandTrigger(trigger),
    };
    this._builtinKeywords.add(key);
  }

  registerSwitch(entityId, alias) {
    const key = String(entityId);
    this._switches.set(key, alias || `开关_${key}`);
  }

  unregisterSwitch(entityId) {
    this._switches.delete(String(entityId));
  }

  bind(client) {
    if (this._client && this._boundTeamMessageHandler) {
      if (typeof this._client.off === 'function') {
        this._client.off('teamMessage', this._boundTeamMessageHandler);
      } else if (typeof this._client.removeListener === 'function') {
        this._client.removeListener('teamMessage', this._boundTeamMessageHandler);
      }
    }
    this._client = client;
    this._boundTeamMessageHandler = (msg) => this._onTeamMessage(msg);
    client.on('teamMessage', this._boundTeamMessageHandler);
    logger.info('[CMD] 指令监听启动: ' + Object.keys(this._commands).join(' / '));
  }

  async _onTeamMessage(msg) {
    if (!msg) return;
    const text = this._extractMessageText(msg).trim();
    const senderId = String(msg.steamId || '');
    let body = text;
    if (this.prefix) {
      if (!body.startsWith(this.prefix)) return;
      body = body.slice(this.prefix.length).trim();
    }
    const [keyword, ...args] = body.split(/\s+/);
    const cmd = this._commands[keyword?.toLowerCase()];
    if (!cmd) return;
    if (cmd.enabled === false) return;
    logger.info(`[CMD] [${keyword}] from=${senderId}`);
    if (cmd.permission === 'leader' && !(await this._isSenderLeader(senderId))) {
      await this._reply('失败: 仅队长可使用 [' + keyword + ']');
      return;
    }
    if (this._isCommandCooling(keyword, cmd)) {
      logger.debug(`[CMD] [${keyword}] ignored due to cooldown`);
      return;
    }
    this._markCommandInvoked(keyword, cmd);
    try {
      const result = await cmd.handler(args, {
        senderId,
        rawMsg: msg,
        client: this._client,
        parser: this,
        command: cmd,
        keyword: String(keyword || '').toLowerCase(),
      });
      if (result) {
        await this._dispatchCommandActions({
          keyword: String(keyword || '').toLowerCase(),
          command: cmd,
          message: result,
        });
      }
    } catch (e) {
      logger.error(`[CMD] 执行失败 [${keyword}]: ${e.message}`);
      await this._reply('失败: ' + e.message);
    }
  }

  _extractMessageText(msg = {}) {
    if (typeof msg === 'string') return msg.trim();
    if (msg?.message && typeof msg.message === 'object') {
      const inner = msg.message;
      return String(inner.message ?? inner.text ?? inner.content ?? '').trim();
    }
    return String(msg.message ?? msg.text ?? msg.content ?? '').trim();
  }

  _clockToHm(clock = '00:00') {
    const m = String(clock || '').match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) return '00小时00分';
    return `${String(m[1]).padStart(2, '0')}小时${String(m[2]).padStart(2, '0')}分`;
  }

  async _getServerSnapshot(client) {
    const [serverInfo, timeInfo] = await Promise.all([
      client.getServerInfo().catch(() => null),
      client.getTime().catch(() => null),
    ]);
    const snapshot = buildServerInfoSnapshot(serverInfo, timeInfo);
    return { serverInfo, timeInfo, snapshot };
  }

  async _getTeamMembers(client) {
    const res = await client.getTeamInfo().catch(() => null);
    const teamInfo = res?.teamInfo || res?.info?.teamInfo || res?.response?.teamInfo || res?.response || res || {};
    const membersRaw = Array.isArray(teamInfo?.members)
      ? teamInfo.members
      : (teamInfo?.members && typeof teamInfo.members === 'object' ? Object.values(teamInfo.members) : []);
    const leaderId = normalizeSteamId64(
      teamInfo?.leaderSteamId
      ?? teamInfo?.leaderSteamID
      ?? teamInfo?.teamLeaderSteamId
      ?? teamInfo?.teamLeaderSteamID
      ?? teamInfo?.leaderId
      ?? teamInfo?.teamLeaderId
      ?? teamInfo?.leader
      ?? teamInfo?.leader_id
      ?? ''
    );
    const members = membersRaw.map((m) => {
      const steamId = normalizeSteamId64(m?.steamId ?? m?.steamID ?? m?.memberId ?? m?.id ?? '');
      const rawLeaderFlag = m?.isLeader ?? m?.leader ?? false;
      return {
        steamId,
        id: m?.id ?? m?.memberId ?? steamId,
        name: m?.name ?? m?.displayName ?? m?.steamName ?? 'Unknown',
        isOnline: Boolean(m?.isOnline ?? m?.online ?? m?.connected),
        isLeader: Boolean(rawLeaderFlag),
        x: Number(m?.x),
        y: Number(m?.y),
      };
    });
    // 统一收敛为“唯一队长”，避免服务端字段异常导致全员 isLeader=true。
    if (leaderId) {
      members.forEach((m) => {
        m.isLeader = Boolean(m.steamId && m.steamId === leaderId);
      });
    } else {
      const flagged = members.filter((m) => m.isLeader && m.steamId);
      if (flagged.length === 1) {
        const onlyId = flagged[0].steamId;
        members.forEach((m) => { m.isLeader = m.steamId === onlyId; });
      } else {
        const configuredLeader = normalizeSteamId64(this.leaderId);
        if (configuredLeader) {
          members.forEach((m) => { m.isLeader = m.steamId === configuredLeader; });
        } else {
          members.forEach((m) => { m.isLeader = false; });
        }
      }
    }
    return { res, teamInfo, members };
  }

  async _isSenderLeader(senderId) {
    const normalizedSender = normalizeSteamId64(senderId);
    if (!normalizedSender) return false;
    const fallbackLeaderId = normalizeSteamId64(this.leaderId);
    if (!this._client?.connected) return normalizedSender === fallbackLeaderId;
    try {
      const { members } = await this._getTeamMembers(this._client);
      return members.some((m) => m.isLeader && normalizeSteamId64(m.steamId) === normalizedSender);
    } catch (_) {
      return normalizedSender === fallbackLeaderId;
    }
  }

  async _buildDeepSeaStatusText(client) {
    const [markersRes, timeRes, serverRes, deepSeaPersist] = await Promise.all([
      client.getMapMarkers().catch(() => null),
      client.getTime().catch(() => null),
      client.getServerInfo().catch(() => null),
      getDeepSeaState().catch(() => ({})),
    ]);
    const markers = markersRes?.mapMarkers?.markers || [];
    const mapSize = Number(
      serverRes?.info?.mapSize
      ?? serverRes?.mapSize
      ?? serverRes?.response?.info?.mapSize
    );
    const status = analyzeDeepSeaStatus({
      markers,
      timeInfo: timeRes?.time || timeRes || {},
      mapSize: Number.isFinite(mapSize) ? mapSize : null,
      lastOpenAt: deepSeaPersist.lastOpenAt,
      lastCloseAt: deepSeaPersist.lastCloseAt,
    });
    const snap = buildServerInfoSnapshot(serverRes, timeRes);
    const dayRemainSec = Number.isFinite(snap.realRemainSeconds)
      ? snap.realRemainSeconds
      : (snap.remainMinutes * 60 + snap.remainSeconds);
    const dayRemainText = formatMinutesSeconds(dayRemainSec);
    const phaseTarget = snap.phaseTargetShort || (snap.phaseTarget === '天亮' ? '天亮' : '天黑');
    if (status.isOpen) {
      const remain = formatDurationFixedHms(status.countdownSeconds ?? status.realSecondsUntilNext ?? 0);
      return `深海状态:开启. 距离关闭还有约${remain}（深海时间）. 当前${snap.phase}.距离${phaseTarget}:${dayRemainText}`;
    }
    if (!Number.isFinite(status.realSecondsUntilNext) || status.realSecondsUntilNext == null) {
      return '深海状态:关闭. 未获取到上次开启时间. 请等待深海开启提醒';
    }
    const nextText = formatDurationFixedHms(status.realSecondsUntilNext);
    return `深海状态:关闭. 距离开启还有约${nextText}（真实时间）.`;
  }

  async _reply(message) {
    if (!this._client?.connected) return;
    const lines = String(message).split('\n');
    for (const line of lines) {
      const clean = this._stripEmoji(line).trim();
      if (clean) {
        try { await this._client.sendTeamMessage(clean); }
        catch (e) { logger.error('[CMD] 发送失败: ' + e.message); }
      }
    }
  }

  _stripEmoji(text) {
    return String(text || '')
      .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, '')
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
      .replace(/[\u200D\uFE0F]/gu, '');
  }

  _normalizeCommandTrigger(trigger = {}) {
    const base = trigger && typeof trigger === 'object' && !Array.isArray(trigger)
      ? { ...trigger }
      : {};
    const cooldownRaw = Number(base.cooldownMs);
    base.cooldownMs = Number.isFinite(cooldownRaw) && cooldownRaw >= 0 ? cooldownRaw : 3_000;
    return base;
  }

  _normalizeCommandMeta(meta = {}) {
    const base = meta && typeof meta === 'object' && !Array.isArray(meta)
      ? { ...meta }
      : {};
    base.doNotify = base.doNotify === true;
    base.doDiscord = base.doDiscord === true;
    base.doChat = base.doChat !== false;
    const actions = Array.isArray(base.actions) ? base.actions : [];
    base.actions = actions.map((action) => {
      const item = action && typeof action === 'object' && !Array.isArray(action) ? { ...action } : {};
      item.type = String(item.type || '').trim().toLowerCase();
      if (item.type === 'call_group') {
        item.groupId = String(item.groupId || '').trim();
        item.channels = this._normalizeCallChannels(item.channels);
        if (item.message != null) item.message = String(item.message || '').trim();
      }
      return item;
    }).filter((action) => {
      if (!action.type) return false;
      if (action.type === 'call_group') return !!action.groupId;
      return ['notify_desktop', 'notify_discord', 'team_chat', 'send_game_message'].includes(action.type);
    });
    return base;
  }

  _getCommandActions(meta = {}) {
    const normalizedMeta = this._normalizeCommandMeta(meta);
    const existing = Array.isArray(normalizedMeta.actions) ? [...normalizedMeta.actions] : [];
    const hasType = (type) => existing.some((action) => String(action?.type || '').toLowerCase() === type);
    if (normalizedMeta.doNotify && !hasType('notify_desktop')) {
      existing.push({ type: 'notify_desktop' });
    }
    if (normalizedMeta.doDiscord && !hasType('notify_discord')) {
      existing.push({ type: 'notify_discord' });
    }
    if (normalizedMeta.doChat !== false && !hasType('team_chat') && !hasType('send_game_message')) {
      existing.push({ type: 'team_chat' });
    }
    return existing;
  }

  _isCommandCooling(keyword, cmd = {}) {
    const trigger = this._normalizeCommandTrigger(cmd?.trigger);
    if (!trigger.cooldownMs) return false;
    const key = String(keyword || '').toLowerCase();
    const lastAt = Number(this._commandCooldownAt.get(key) || 0);
    if (!lastAt) return false;
    return Date.now() - lastAt < trigger.cooldownMs;
  }

  _markCommandInvoked(keyword, cmd = {}) {
    const trigger = this._normalizeCommandTrigger(cmd?.trigger);
    if (!trigger.cooldownMs) return;
    this._commandCooldownAt.set(String(keyword || '').toLowerCase(), Date.now());
  }

  async _sendTeamChatMessage(message) {
    if (typeof this._teamChatRunner === 'function') {
      await this._teamChatRunner(message);
      return;
    }
    await this._reply(message);
  }

  async _dispatchCommandActions({ keyword, command, message }) {
    const actions = this._getCommandActions(command?.meta || {});
    if (!actions.length) {
      await this._reply(message);
      return;
    }
    for (const action of actions) {
      const type = String(action?.type || '').toLowerCase();
      if (type === 'notify_desktop') {
        if (typeof this._notifyDesktopRunner === 'function') {
          await this._notifyDesktopRunner({ title: `⌨️ ${keyword}`, message });
        }
        continue;
      }
      if (type === 'notify_discord') {
        if (typeof this._notifyDiscordRunner === 'function') {
          await this._notifyDiscordRunner({ title: `⌨️ ${keyword}`, message });
        }
        continue;
      }
      if (type === 'team_chat' || type === 'send_game_message') {
        await this._sendTeamChatMessage(message);
        continue;
      }
      if (type === 'call_group') {
        if (typeof this._callGroupRunner !== 'function') continue;
        const groupId = String(action.groupId || '').trim();
        if (!groupId) continue;
        const channels = this._normalizeCallChannels(action.channels);
        const actionMessage = String(action.message || '').trim() || String(message || '').trim();
        await this._callGroupRunner(groupId, actionMessage, { channels });
      }
    }
  }

  _safeNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  _countChars(text) {
    return Array.from(String(text || '')).length;
  }

  _chunkTokensByLine(tokens = [], prefix = '', continuationPrefix = '', separator = ' - ') {
    const maxChars = Math.max(16, RUST_TEAM_MESSAGE_MAX_CHARS);
    const lines = [];
    let currentPrefix = String(prefix || '');
    let currentBody = '';
    for (const token of tokens.map((item) => String(item || '').trim()).filter(Boolean)) {
      const candidateBody = currentBody ? `${currentBody}${separator}${token}` : token;
      const candidateLine = `${currentPrefix}${candidateBody}`;
      if (currentBody && this._countChars(candidateLine) > maxChars) {
        lines.push(`${currentPrefix}${currentBody}`);
        currentPrefix = String(continuationPrefix || prefix || '');
        currentBody = token;
        continue;
      }
      currentBody = candidateBody;
    }
    if (currentBody) {
      lines.push(`${currentPrefix}${currentBody}`);
    } else if (prefix) {
      lines.push(String(prefix));
    }
    return lines;
  }

  _buildCctvCodeLines(entry) {
    const label = String(entry?.nameZh || entry?.nameEn || '监控点');
    const tokens = (Array.isArray(entry?.codes) ? entry.codes : [])
      .map((code) => {
        const id = String(code?.id || '').trim();
        const location = String(code?.location || '').trim();
        if (!id) return '';
        return `[${id}${location ? ` - ${location}` : ''}]`;
      })
      .filter(Boolean);
    return this._chunkTokensByLine(
      tokens,
      `${label}监控代码：`,
      `${label}监控代码(续)：`,
      '  ',
    );
  }

  _normalizeSwitchAction(value) {
    const token = String(value || '').trim().toLowerCase();
    if (['on', '1', 'open', '开', '开启'].includes(token)) return 'on';
    if (['off', '0', 'close', '关', '关闭'].includes(token)) return 'off';
    if (['toggle', 'switch', '切换', '反转'].includes(token)) return 'toggle';
    return '';
  }

  _normalizeCallChannels(value) {
    const allowed = new Set(['phone', 'kook', 'discord']);
    if (!Array.isArray(value)) return [];
    return [...new Set(
      value
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => allowed.has(item)),
    )];
  }

  async _readSwitchState(client, entityId) {
    const res = await client.getEntityInfo(Number(entityId)).catch(() => null);
    const raw = res?.entityInfo?.payload?.value;
    if (raw === true || raw === 1) return true;
    if (raw === false || raw === 0) return false;
    return null;
  }

  _expandVendingQueryVariants(rawKeyword = '') {
    const raw = String(rawKeyword || '').trim();
    if (!raw) return [];
    const variants = new Set([raw]);
    const lowered = raw.toLowerCase();
    variants.add(lowered);
    variants.add(lowered.replace(/\s+/g, ' ').trim());

    const zhToEnRules = [
      [/蓝图/gu, 'blueprint'],
      [/碎片/gu, 'fragment'],
      [/高级/gu, 'advanced'],
      [/基础|初级|低级/gu, 'basic'],
      [/柴油桶|柴油燃料|柴油/gu, 'diesel'],
      [/金属碎片/gu, 'metal fragments'],
      [/骨头碎片/gu, 'bone fragments'],
    ];
    let mapped = lowered;
    for (const [pattern, replacement] of zhToEnRules) {
      mapped = mapped.replace(pattern, replacement);
    }
    mapped = mapped.replace(/\s+/g, ' ').trim();
    if (mapped) variants.add(mapped);
    if (mapped && mapped !== lowered) variants.add(mapped.replace(/\s+/g, ''));

    return [...variants].filter(Boolean);
  }

  _resolveVendingItems(rawKeyword = '') {
    const original = String(rawKeyword || '').trim();
    const { sellKeyword } = this._splitVendingQuery(original);
    const keyword = sellKeyword || original;
    const itemIds = new Set();
    const itemsById = new Map();
    const itemPriorityById = new Map();
    let seq = 0;
    const addItem = (item, priority = null) => {
      if (!item) return;
      const id = Number(item.id);
      if (!Number.isFinite(id)) return;
      const key = String(id);
      itemIds.add(key);
      if (!itemsById.has(key)) itemsById.set(key, item);
      const nextPriority = Number.isFinite(priority) ? Number(priority) : seq++;
      const prevPriority = itemPriorityById.get(key);
      if (!Number.isFinite(prevPriority) || nextPriority < prevPriority) {
        itemPriorityById.set(key, nextPriority);
      }
    };

    const inlineIdMatches = keyword.match(/itemid\s*:\s*(-?\d+)/ig) || [];
    inlineIdMatches.forEach((token) => {
      const m = token.match(/-?\d+/);
      if (!m) return;
      const id = Number(m[0]);
      if (!Number.isFinite(id)) return;
      const fallback = getItemById(id) || { id, shortName: `itemId:${id}`, nameEn: `itemId:${id}`, nameZh: '' };
      addItem(fallback, seq++);
    });

    const rawNumberTokens = keyword.match(/^-?\d+$/) ? [keyword] : [];
    rawNumberTokens.forEach((token) => {
      const id = Number(token);
      if (!Number.isFinite(id)) return;
      const fallback = getItemById(id) || { id, shortName: `itemId:${id}`, nameEn: `itemId:${id}`, nameZh: '' };
      addItem(fallback, seq++);
    });

    const variants = this._expandVendingQueryVariants(keyword);
    for (const variant of variants) {
      const matched = matchItems(variant, { limit: 120 });
      matched.forEach((item, index) => addItem(item, seq + index));
      seq += matched.length;
    }

    return {
      itemIds: [...itemIds],
      itemsById,
      itemPriorityById,
    };
  }

  _splitVendingQuery(rawKeyword = '') {
    const raw = String(rawKeyword || '').trim();
    if (!raw) return { sellKeyword: '', currencyKeyword: '' };
    const match = raw.match(/^(.+?)[/／](.+)$/);
    if (!match) {
      return { sellKeyword: raw, currencyKeyword: '' };
    }
    return {
      sellKeyword: String(match[1] || '').trim(),
      currencyKeyword: String(match[2] || '').trim(),
    };
  }

  _getVendingItemLabel(itemId, { isBlueprint = false, itemsById = null } = {}) {
    const key = String(itemId || '').trim();
    const item = itemsById?.get?.(key) || getItemById(key);
    let label = String(item?.nameZh || item?.nameEn || item?.shortName || `itemId:${key}`).trim();
    if (isBlueprint && !/蓝图|blueprint/i.test(label)) {
      label = `${label}蓝图`;
    }
    return label;
  }

  _isVendingOrderInStock(order = {}, marker = {}) {
    if (marker?.outOfStock === true) return false;
    if (order?.amountInStock == null) return true;
    const stock = Number(order.amountInStock);
    if (!Number.isFinite(stock)) return true;
    return stock > 0;
  }

  _cargoDistance(a, b) {
    const ax = this._safeNumber(a?.x);
    const ay = this._safeNumber(a?.y);
    const bx = this._safeNumber(b?.x);
    const by = this._safeNumber(b?.y);
    if (ax == null || ay == null || bx == null || by == null) return null;
    const dx = bx - ax;
    const dy = by - ay;
    return Math.hypot(dx, dy);
  }

  _pickNearestMarker(target, candidates = [], maxDistance = 500) {
    const tx = this._safeNumber(target?.x);
    const ty = this._safeNumber(target?.y);
    if (tx == null || ty == null || !Array.isArray(candidates) || !candidates.length) return null;
    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      const cx = this._safeNumber(c?.x);
      const cy = this._safeNumber(c?.y);
      if (cx == null || cy == null) continue;
      const d = Math.hypot(tx - cx, ty - cy);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return bestDist <= maxDistance ? best : null;
  }

  _findNearestCargoTrack(current, maxDistance = 80) {
    const x = this._safeNumber(current?.x);
    const y = this._safeNumber(current?.y);
    if (x == null || y == null) return null;
    let best = null;
    let bestDist = Infinity;
    for (const sample of this._cargoTrack.values()) {
      const sx = this._safeNumber(sample?.x);
      const sy = this._safeNumber(sample?.y);
      if (sx == null || sy == null) continue;
      const d = Math.hypot(x - sx, y - sy);
      if (d < bestDist) {
        bestDist = d;
        best = sample;
      }
    }
    if (best && bestDist <= maxDistance) return best;
    return null;
  }

  _classifyCargoMotion(current, previous, dtSec) {
    const markerSpeed = this._safeNumber(current?.speed);
    const distance = this._cargoDistance(previous, current);
    const derivedSpeed = (distance != null && dtSec > 0) ? (distance / dtSec) : null;
    // 停靠优先判定：低速 + 小位移时直接判停靠，避免“停靠中被识别航行”
    const lowMarkerSpeed = markerSpeed != null && markerSpeed < 0.2;
    const lowDerivedSpeed = derivedSpeed != null && derivedSpeed < 1.0;
    let stopped = false;
    if (lowMarkerSpeed && (lowDerivedSpeed || derivedSpeed == null)) {
      stopped = true;
    } else if (derivedSpeed != null) {
      stopped = derivedSpeed < 0.7;
    } else if (markerSpeed != null) {
      stopped = markerSpeed < 1.0;
    }

    // 部分服务器 marker.speed 会长期为 0，优先用位移推导速度作为展示值
    const hasUsableMarkerSpeed = markerSpeed != null && markerSpeed > 0.05;
    const displaySpeed = hasUsableMarkerSpeed
      ? markerSpeed
      : (derivedSpeed != null ? derivedSpeed : (markerSpeed != null ? markerSpeed : 0));
    return { stopped, markerSpeed, derivedSpeed, displaySpeed };
  }

  _shiftGridRightOne(gridText) {
    const m = String(gridText || '').match(/^([A-Z]+)(\d+)-(\d)$/);
    if (!m) return gridText;
    const nextSub = Math.min(9, Number(m[3]) + 2);
    return `${m[1]}${m[2]}-${nextSub}`;
  }

  _markerToQueryGrid9(marker, mapSize) {
    return markerToGrid9(marker, mapSize, {
      gridXOffset: SHJ_GRID_X_OFFSET,
      gridYOffset: SHJ_GRID_Y_OFFSET,
    });
  }

  _markerToQueryGridBase(marker, mapSize) {
    const grid = this._markerToQueryGrid9(marker, mapSize);
    return String(grid).split('-')[0] || String(grid || '-');
  }

  _isOutOfMapMarker(marker = {}, mapSize) {
    const size = Number(mapSize);
    const x = Number(marker?.x);
    const y = Number(marker?.y);
    if (!Number.isFinite(size) || size <= 0) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return x < 0 || y < 0 || x > size || y > size;
  }

  async _getHarbors(client, mapSize) {
    const now = Date.now();
    if (
      this._cargoHarborsCache.items.length
      && this._cargoHarborsCache.mapSize === mapSize
      && now - this._cargoHarborsCache.at < 10 * 60 * 1000
    ) {
      return this._cargoHarborsCache.items;
    }
    if (!Number.isFinite(mapSize) || mapSize <= 0) return [];
    try {
      const mapRes = await client.getMap();
      const monuments = mapRes?.map?.monuments
        || mapRes?.response?.map?.monuments
        || mapRes?.monuments
        || [];
      const harbors = (Array.isArray(monuments) ? monuments : []).filter((m) => {
        const token = String(m?.token || m?.name || '').toLowerCase();
        return token.includes('harbor') || token.includes('harbour') || token.includes('ferry_terminal');
      }).map((m) => {
        const token = String(m?.token || m?.name || 'harbor');
        const x = Number(m?.x);
        const y = Number(m?.y);
        const name = token.includes('harbor_1') ? '大型港口'
          : token.includes('harbor_2') ? '小型港口'
          : token.includes('ferry_terminal') ? '渡轮码头'
          : '港口';
        const grid = this._markerToQueryGridBase({ x, y }, mapSize);
        return { token, x, y, name, grid };
      }).filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y));
      this._cargoHarborsCache = { at: now, mapSize, items: harbors };
      return harbors;
    } catch (e) {
      logger.debug('[CMD] 获取港口数据失败: ' + e.message);
      return [];
    }
  }

  _nearestHarborFor(marker, harbors = []) {
    const mx = Number(marker?.x);
    const my = Number(marker?.y);
    if (!Number.isFinite(mx) || !Number.isFinite(my) || !harbors.length) return null;
    let best = null;
    let bestDist = Infinity;
    for (const h of harbors) {
      const d = Math.hypot(mx - h.x, my - h.y);
      if (d < bestDist) {
        bestDist = d;
        best = h;
      }
    }
    return best ? { ...best, distance: bestDist } : null;
  }

  async _buildCargoStatusText(client, { suppressBoundaryNotice = false } = {}) {
    const [res, snapRes] = await Promise.all([
      client.getMapMarkers(),
      this._getServerSnapshot(client).catch(() => ({ snapshot: null })),
    ]);
    const mapSize = Number(snapRes?.snapshot?.mapSize || 0);
    const harbors = await this._getHarbors(client, mapSize);
    const dockRadius = Number.isFinite(mapSize) && mapSize > 0 ? Math.max(120, mapSize / 30) : 300;
    const ships = (res?.mapMarkers?.markers || []).filter((m) => {
      if (m?.type === 5) return true;
      return String(m?.type || '').toLowerCase() === 'cargoship';
    });
    if (!ships.length) return '当前无货船';

    const now = Date.now();
    const lines = ships.map((m, idx) => {
      const id = String(m?.id || `idx_${idx}`);
      const prevSample = this._cargoTrack.get(id) || this._findNearestCargoTrack(m) || null;
      const prevAt = this._safeNumber(prevSample?.at);
      const dtSec = prevAt ? Math.max(0.2, (now - prevAt) / 1000) : 2.0;
      const motion = this._classifyCargoMotion(m, prevSample, dtSec);
      this._cargoTrack.set(id, { x: m?.x, y: m?.y, at: now });

      const speedRaw = Number(m?.speed);
      const speed = Number.isFinite(speedRaw) ? speedRaw : 0;
      const grid = this._markerToQueryGrid9(m, mapSize);
      const isBoundary = this._isOutOfMapMarker(m, mapSize);
      let stopped = motion.stopped;
      const base = this._markerToQueryGridBase(m, mapSize);
      let gridText = stopped ? `${base}-1~3` : this._shiftGridRightOne(grid);
      let speedShow = Number.isFinite(motion.displaySpeed) ? motion.displaySpeed : speed;
      if (!Number.isFinite(speedShow) || speedShow < 0) speedShow = 0;
      if (speedShow < 0.15) {
        stopped = true;
        gridText = `${base}-1~3`;
      }
      const harbor = harbors.length ? this._nearestHarborFor(m, harbors) : null;
      if (isBoundary) {
        const nearText = harbor?.grid || base || '-';
        return {
          text: `货船当前不在边界线内｜靠近位置[${nearText}]`,
          isBoundary: true,
        };
      }

      let isDockedAtHarbor = false;
      let harborName = '';
      let harborGrid = '';
      if (harbor && harbor.distance <= dockRadius) {
        isDockedAtHarbor = true;
        harborName = harbor.name || '';
        harborGrid = harbor.grid || base;
        stopped = true;
        gridText = harborGrid;
      }

      return {
        text: stopped
          ? (isDockedAtHarbor
            ? `货船停靠中 ｜${harborName} [${harborGrid}]`
            : `货船停靠中｜当前位置:${String(gridText || '-').split('-')[0] || gridText}`)
          : `货船航行中｜当前位置:${String(gridText || '-').split('-')[0] || gridText}`,
        isBoundary,
      };
    });

    const hasBoundary = lines.some((x) => x.isBoundary);
    const allBoundary = lines.length > 0 && lines.every((x) => x.isBoundary);
    if (allBoundary && suppressBoundaryNotice) {
      return '当前无货船';
    }
    if (hasBoundary && !suppressBoundaryNotice && this._cargoBoundaryTimer) {
      clearTimeout(this._cargoBoundaryTimer);
      this._cargoBoundaryTimer = null;
    }
    return lines.map((x) => x.text).join('\n') || '当前无货船';
  }

  async _buildHeliStatusText(client) {
    const [res, snapRes] = await Promise.all([
      client.getMapMarkers(),
      this._getServerSnapshot(client).catch(() => ({ snapshot: null })),
    ]);
    const mapSize = Number(snapRes?.snapshot?.mapSize || 0);
    const toGrid = (marker) => this._markerToQueryGridBase(marker, mapSize || 4500);
    const helis = (res?.mapMarkers?.markers || []).filter((m) => {
      if (m?.type === 8) return true;
      return String(m?.type || '').toLowerCase() === 'patrolhelicopter';
    });
    if (!helis.length) {
      const explosions = (res?.mapMarkers?.markers || []).filter((m) => Number(m?.type) === 2);
      if (explosions.length) {
        const grid = toGrid(explosions[0]);
        return `武装直升机已被击落｜坠落点:${grid}`;
      }
      const last = Array.from(this._heliTrack.values()).sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))[0];
      if (last?.lastGrid && Date.now() - (last.lastSeenAt || 0) < 5 * 60 * 1000) {
        return `武装直升机疑似已被击落｜最后位置:${last.lastGrid}`;
      }
      return '当前无武装直升机';
    }
    const lines = helis.map((m) => {
      const id = String(m?.id || '');
      const x = Number(m?.x);
      const y = Number(m?.y);
      const outOfBounds = Number.isFinite(mapSize) && mapSize > 0
        && Number.isFinite(x) && Number.isFinite(y)
        && (x < 0 || y < 0 || x > mapSize || y > mapSize);
      if (outOfBounds) {
        const last = this._heliTrack.get(id);
        if (last?.lastGrid) {
          return `武装直升机巡逻中｜最后出现网格:${last.lastGrid} 当前已飞出边界线。`;
        }
        return '武装直升机巡逻中｜当前已飞出边界线。';
      }
      const swappedGrid = toGrid(m);
      this._heliTrack.set(id, { lastGrid: swappedGrid, lastSeenAt: Date.now() });
      return `武装直升机巡逻中｜网格:${swappedGrid}`;
    });
    return lines.join('\n');
  }

  _registerBuiltins() {
    this.register('fwq', async (args, { client }) => {
      const { serverInfo, snapshot: s } = await this._getServerSnapshot(client);
      if (!serverInfo || serverInfo.error) return '失败: 获取服务器信息失败';
      const remain = s.realRemainText || s.remainText;
      return `${s.name} 人数:${s.players}/${s.maxPlayers}排队:[${s.queued}] 时间:${s.hhmm} ${s.phase} - 距离${s.phaseTarget}还有约${remain}`;
    }, { description: '服务器信息', type: 'server_info' });

    this.register('fk', async (args, { client, command }) => {
      const defaultAction = this._normalizeSwitchAction(command?.meta?.action || '');
      const firstAction = this._normalizeSwitchAction(args[0] || '');
      const action = firstAction || defaultAction || 'toggle';
      const ruleName = String(command?.description || command?.meta?.ruleName || '防空').trim() || '防空';

      const keyword = String((firstAction ? args.slice(1) : args).join(' ') || '').trim().toLowerCase();
      const selectedIds = Array.isArray(command?.meta?.entityIds)
        ? command.meta.entityIds.map((id) => String(id)).filter(Boolean)
        : [];
      const selectedSet = selectedIds.length ? new Set(selectedIds) : null;
      const targets = [...this._switches.entries()]
        .filter(([entityId]) => (selectedSet ? selectedSet.has(String(entityId)) : true))
        .filter(([entityId, alias]) => {
          if (!keyword) return true;
          const eid = String(entityId || '').toLowerCase();
          const aname = String(alias || '').toLowerCase();
          return eid.includes(keyword) || aname.includes(keyword);
        });
      if (!targets.length) {
        if (selectedSet && selectedSet.size) {
          return '该指令未匹配到已配对开关，请在指令规则中重新绑定开关';
        }
        if (!this._switches.size) return '暂无配对智能开关,请确认配对状态。';
        return keyword
          ? `未找到匹配开关: ${keyword}`
          : '暂无配对智能开关,请确认配对状态。';
      }

      const finalStates = [];
      const failures = [];
      for (const [entityId, alias] of targets) {
        try {
          let targetState = null;
          if (action === 'toggle') {
            const before = await this._readSwitchState(client, entityId);
            if (before == null) throw new Error('无法读取当前状态');
            targetState = !before;
          } else {
            targetState = action === 'on';
          }
          if (targetState) await client.turnSwitchOn(Number(entityId));
          else await client.turnSwitchOff(Number(entityId));
          const after = await this._readSwitchState(client, entityId);
          finalStates.push(after == null ? Boolean(targetState) : Boolean(after));
        } catch (e) {
          failures.push(`${alias || entityId}: ${e.message}`);
        }
      }

      if (!finalStates.length) {
        return `失败: ${ruleName}开关状态切换失败${failures.length ? ` (${failures.join('；')})` : ''}`;
      }

      let statusText = action === 'on' ? '开启' : '关闭';
      if (action === 'toggle') {
        const allOn = finalStates.every(Boolean);
        const allOff = finalStates.every((v) => !v);
        statusText = allOn ? '开启' : (allOff ? '关闭' : '混合');
      }
      return `${ruleName}开关状态已切换 - [${statusText}]`;
    }, { permission: 'all', description: '防空', type: 'switch', meta: { action: 'toggle', ruleName: '防空' } });

    this.register('hc', async (args, { client }) => {
      return this._buildCargoStatusText(client);
    }, { description: '货船状态', type: 'query_cargo' });

    this.register('wz', async (args, { client }) => {
      return this._buildHeliStatusText(client);
    }, { description: '武装直升机状态', type: 'query_heli' });

    this.register('sh', async (args, { client }) => this._buildDeepSeaStatusText(client), {
      description: '深海状态',
      type: 'deep_sea_status',
    });

    this.register('fy', async (args) => {
      const text = args.join(' ');
      if (!text) return '用法: fy <文字>';
      const prefix = '翻译结果: ';
      const maxChars = Math.max(8, RUST_TEAM_MESSAGE_MAX_CHARS - Array.from(prefix).length);
      try {
        return prefix + await translate(text, { maxChars });
      } catch (e) {
        if (e?.code === 'RATE_LIMIT') return e.message;
        throw e;
      }
    }, { description: '翻译', type: 'translate' });

    this.register('ai', async (args) => {
      const q = args.join(' ');
      if (!q) return '用法: ai <问题>';
      const prefix = 'AI回答: ';
      const maxChars = Math.max(8, RUST_TEAM_MESSAGE_MAX_CHARS - Array.from(prefix).length);
      try {
        return prefix + await ask(q, { maxChars });
      } catch (e) {
        if (e?.code === 'RATE_LIMIT') return e.message;
        throw e;
      }
    }, { description: 'AI 问答', type: 'ai' });

    this.register('shj', async (args, { client }) => {
      const keyword = String(args.join(' ') || '').trim();
      if (!keyword) return '用法: shj <物品名>';
      const { sellKeyword, currencyKeyword } = this._splitVendingQuery(keyword);
      const sellQuery = this._resolveVendingItems(sellKeyword);
      if (!sellQuery.itemIds.length) {
        return `未识别物品关键词[${sellKeyword}]，可尝试 shj itemId:数字`;
      }
      const currencyQuery = currencyKeyword ? this._resolveVendingItems(currencyKeyword) : null;
      if (currencyKeyword && !currencyQuery?.itemIds?.length) {
        return `未识别价格物品关键词[${currencyKeyword}]，可尝试 shj ${sellKeyword}/itemId:数字`;
      }
      const [markerRes, snapRes] = await Promise.all([
        client.getMapMarkers().catch(() => null),
        this._getServerSnapshot(client).catch(() => ({ snapshot: null })),
      ]);
      const mapSize = Number(snapRes?.snapshot?.mapSize || 0) || 4500;
      const markers = markerRes?.mapMarkers?.markers || [];
      const vendingMarkers = (Array.isArray(markers) ? markers : []).filter((m) => {
        if (Number(m?.type) === 3) return true;
        return String(m?.type || '').toLowerCase() === 'vendingmachine';
      });
      const targetItemIdSet = new Set(sellQuery.itemIds.map((id) => String(id)));
      const targetCurrencyIdSet = currencyQuery ? new Set(currencyQuery.itemIds.map((id) => String(id))) : null;
      const sulfurCurrencyIdSet = targetCurrencyIdSet ? null : new Set(this._resolveVendingItems('硫磺').itemIds.map((id) => String(id)));
      const grids = [];
      const soldItemIds = new Set();
      const seen = new Set();
      const pricedOfferByGrid = new Map();
      const alternateOfferByKey = new Map();
      const defaultOfferByGrid = new Map();
      for (const marker of vendingMarkers) {
        if (marker?.outOfStock === true) continue;
        const orders = Array.isArray(marker?.sellOrders) ? marker.sellOrders : [];
        if (!orders.length) continue;
        let markerMatched = false;
        for (const order of orders) {
          const soldId = Number(order?.itemId);
          if (!Number.isFinite(soldId)) continue;
          if (!targetItemIdSet.has(String(soldId))) continue;
          const currencyId = Number(order?.currencyId);
          if (!this._isVendingOrderInStock(order, marker)) continue;
          markerMatched = true;
          soldItemIds.add(String(soldId));
          if (targetCurrencyIdSet) {
            const grid = String(markerToGrid9(marker, mapSize, {
              gridXOffset: SHJ_GRID_X_OFFSET,
              gridYOffset: SHJ_GRID_Y_OFFSET,
            }) || '').split('-')[0] || '-';
            if (grid === '-') continue;
            const offer = {
              grid,
              soldId: String(soldId),
              currencyId: Number.isFinite(currencyId) ? String(currencyId) : '',
              quantity: Math.max(1, Number(order?.quantity) || 1),
              costPerItem: Math.max(0, Number(order?.costPerItem) || 0),
              itemIsBlueprint: order?.itemIsBlueprint === true,
              currencyIsBlueprint: order?.currencyIsBlueprint === true,
            };
            if (targetCurrencyIdSet.has(String(currencyId))) {
              const prev = pricedOfferByGrid.get(grid);
              if (!prev || offer.costPerItem < prev.costPerItem) {
                pricedOfferByGrid.set(grid, offer);
              }
            } else {
              const altKey = `${grid}|${offer.currencyId}|${offer.soldId}|${offer.itemIsBlueprint ? 1 : 0}|${offer.currencyIsBlueprint ? 1 : 0}`;
              const prev = alternateOfferByKey.get(altKey);
              if (!prev || offer.costPerItem < prev.costPerItem) {
                alternateOfferByKey.set(altKey, offer);
              }
            }
          } else {
            const grid = String(markerToGrid9(marker, mapSize, {
              gridXOffset: SHJ_GRID_X_OFFSET,
              gridYOffset: SHJ_GRID_Y_OFFSET,
            }) || '').split('-')[0] || '-';
            if (grid === '-') continue;
            const offer = {
              grid,
              soldId: String(soldId),
              currencyId: Number.isFinite(currencyId) ? String(currencyId) : '',
              quantity: Math.max(1, Number(order?.quantity) || 1),
              costPerItem: Math.max(0, Number(order?.costPerItem) || 0),
              itemIsBlueprint: order?.itemIsBlueprint === true,
              currencyIsBlueprint: order?.currencyIsBlueprint === true,
            };
            const prev = defaultOfferByGrid.get(grid);
            const isSulfur = sulfurCurrencyIdSet?.has(offer.currencyId) === true;
            const prevIsSulfur = sulfurCurrencyIdSet?.has(prev?.currencyId) === true;
            if (!prev) {
              defaultOfferByGrid.set(grid, offer);
            } else if (isSulfur && !prevIsSulfur) {
              defaultOfferByGrid.set(grid, offer);
            } else if (isSulfur === prevIsSulfur && offer.costPerItem < prev.costPerItem) {
              defaultOfferByGrid.set(grid, offer);
            }
          }
        }
        if (!markerMatched) continue;
        const grid = String(markerToGrid9(marker, mapSize, {
          gridXOffset: SHJ_GRID_X_OFFSET,
          gridYOffset: SHJ_GRID_Y_OFFSET,
        }) || '').split('-')[0] || '-';
        if (grid === '-' || seen.has(grid)) continue;
        seen.add(grid);
        grids.push(grid);
      }
      if (!grids.length) {
        return targetCurrencyIdSet
          ? `当前地图无[${sellKeyword}]使用[${currencyKeyword}]购买的售货机`
          : `当前地图无[${keyword}]出售`;
      }
      const sortedSoldItemIds = [...soldItemIds].sort((a, b) => {
        const pa = Number(sellQuery.itemPriorityById?.get(String(a)));
        const pb = Number(sellQuery.itemPriorityById?.get(String(b)));
        const da = Number.isFinite(pa) ? pa : Number.MAX_SAFE_INTEGER;
        const db = Number.isFinite(pb) ? pb : Number.MAX_SAFE_INTEGER;
        if (da !== db) return da - db;
        return Number(a) - Number(b);
      });
      const uniqueNames = sortedSoldItemIds.map((id) => {
        const item = sellQuery.itemsById.get(String(id)) || getItemById(id);
        return String(item?.nameZh || item?.nameEn || item?.shortName || id).trim();
      }).filter(Boolean);
      if (targetCurrencyIdSet) {
        const pricedOffers = [...pricedOfferByGrid.values()];
        pricedOffers.sort((a, b) => {
          if (a.costPerItem !== b.costPerItem) return a.costPerItem - b.costPerItem;
          return String(a.grid).localeCompare(String(b.grid));
        });
        const alternateOffers = [...alternateOfferByKey.values()].sort((a, b) => {
          if (a.costPerItem !== b.costPerItem) return a.costPerItem - b.costPerItem;
          return String(a.grid).localeCompare(String(b.grid));
        });
        const formatOfferDetail = (offer) => {
          const currencyLabel = this._getVendingItemLabel(offer.currencyId, {
            isBlueprint: offer.currencyIsBlueprint,
            itemsById: currencyQuery?.itemsById,
          });
          return {
            grid: String(offer.grid),
            currencyLabel,
            costPerItem: offer.costPerItem,
          };
        };
        const formatAlternateTag = (offer) => {
          const currencyLabel = this._getVendingItemLabel(offer.currencyId, {
            isBlueprint: offer.currencyIsBlueprint,
            itemsById: currencyQuery?.itemsById,
          });
          return `[${offer.grid}] - [${currencyLabel}]*${offer.costPerItem}`;
        };
        const groupOfferDetails = (offers = []) => {
          const groups = new Map();
          for (const offer of offers) {
            const detail = formatOfferDetail(offer);
            const key = `${detail.currencyLabel}|${detail.costPerItem}`;
            if (!groups.has(key)) {
              groups.set(key, {
                currencyLabel: detail.currencyLabel,
                costPerItem: detail.costPerItem,
                grids: [],
              });
            }
            groups.get(key).grids.push(detail.grid);
          }
          return [...groups.values()].map((group) => ({
            ...group,
            grids: group.grids.sort((a, b) => String(a).localeCompare(String(b))),
          })).sort((a, b) => {
            if (a.costPerItem !== b.costPerItem) return a.costPerItem - b.costPerItem;
            if (a.currencyLabel !== b.currencyLabel) return String(a.currencyLabel).localeCompare(String(b.currencyLabel));
            return String(a.grids[0] || '').localeCompare(String(b.grids[0] || ''));
          });
        };
        if (!pricedOffers.length && !alternateOffers.length) {
          return `当前地图无[${sellKeyword}]出售`;
        }
        const lines = [];
        if (pricedOffers.length) {
          const topOffers = pricedOffers.slice(0, 3);
          const tags = topOffers.map((offer) => offer.grid);
          const detailGroups = groupOfferDetails(topOffers);
          lines.push(`[${tags.join(' - ')}]正在出售[${sellKeyword}/${currencyKeyword}]`);
          lines.push(detailGroups.map((group) => {
            const gridText = group.grids.length > 1 ? `[${group.grids.join(' - ')}]` : `[${group.grids[0]}]`;
            return `${gridText}需要[${group.currencyLabel}]*${group.costPerItem}`;
          }).join(' , '));
        } else {
          lines.push(`当前地图无[${sellKeyword}]使用[${currencyKeyword}]购买`);
        }
        if (alternateOffers.length) {
          const tags = alternateOffers.slice(0, 3).map(formatAlternateTag);
          lines.push(`其他支付:${tags.join('  |  ')}`);
        }
        return lines.join('\n');
      }
      const defaultOffers = [...defaultOfferByGrid.values()].sort((a, b) => {
        const aSulfur = sulfurCurrencyIdSet?.has(a.currencyId) === true;
        const bSulfur = sulfurCurrencyIdSet?.has(b.currencyId) === true;
        if (aSulfur !== bSulfur) return aSulfur ? -1 : 1;
        if (a.costPerItem !== b.costPerItem) return a.costPerItem - b.costPerItem;
        return String(a.grid).localeCompare(String(b.grid));
      });
      const groupOffers = (offers = []) => {
        const groups = new Map();
        for (const offer of offers) {
          const currencyLabel = this._getVendingItemLabel(offer.currencyId, {
            isBlueprint: offer.currencyIsBlueprint,
          });
          const keyParts = [
            String(offer.currencyId),
            offer.currencyIsBlueprint ? '1' : '0',
            String(offer.costPerItem),
            currencyLabel,
          ];
          const key = keyParts.join('|');
          if (!groups.has(key)) {
            groups.set(key, {
              currencyLabel,
              costPerItem: offer.costPerItem,
              grids: [],
            });
          }
          groups.get(key).grids.push(String(offer.grid));
        }
        return [...groups.values()].map((group) => ({
          ...group,
          grids: group.grids.sort((a, b) => String(a).localeCompare(String(b))),
        })).sort((a, b) => {
          if (a.costPerItem !== b.costPerItem) return a.costPerItem - b.costPerItem;
          if (a.currencyLabel !== b.currencyLabel) return String(a.currencyLabel).localeCompare(String(b.currencyLabel));
          return String(a.grids[0] || '').localeCompare(String(b.grids[0] || ''));
        });
      };
      const formatGroupedNeedLine = (groups = [], { prefixSellKeyword = false } = {}) => groups.map((group) => {
        const gridText = group.grids.length > 1 ? `[${group.grids.join(' - ')}]` : group.grids[0];
        if (prefixSellKeyword) {
          return `${gridText}在出售[${keyword}]需要[${group.currencyLabel}]*${group.costPerItem}`;
        }
        return `${gridText}需要[${group.currencyLabel}]*${group.costPerItem}`;
      }).join(' , ');

      const sulfurOffers = defaultOffers.filter((offer) => sulfurCurrencyIdSet?.has(offer.currencyId) === true);
      const otherOffers = defaultOffers.filter((offer) => sulfurCurrencyIdSet?.has(offer.currencyId) !== true);
      const sulfurGroups = groupOffers(sulfurOffers);
      const otherGroups = groupOffers(otherOffers);
      const lines = [];
      const gridsText = `[${grids.join(' - ')}]`;
      const matchedText = uniqueNames.length ? ` 匹配物品:[${uniqueNames.join(' - ')}]` : '';
      lines.push(`${gridsText}正在出售[${keyword}]${matchedText}`);
      if (sulfurGroups.length) {
        lines.push(formatGroupedNeedLine(sulfurGroups));
      }
      if (otherGroups.length) {
        lines.push(`其他支付:${otherGroups.map((group) => {
          const gridText = group.grids.length > 1 ? `[${group.grids.join(' - ')}]` : `[${group.grids[0]}]`;
          return `${gridText} - [${group.currencyLabel}]*${group.costPerItem}`;
        }).join('  |  ')}`);
      }
      return lines.join('\n');
    }, { description: '查询售货机', type: 'query_vendor' });

    this.register('dz', async (args, { client, senderId }) => {
      if (!args[0]) return '用法: dz <成员名>';
      const { members } = await this._getTeamMembers(client);
      const botId = normalizeSteamId64(this._client?.config?.playerId || this.leaderId);
      const currentLeader = members.find((m) => m.isLeader) || null;
      const currentLeaderId = normalizeSteamId64(currentLeader?.steamId);
      const senderIdNorm = normalizeSteamId64(senderId);
      const senderIsLeader = members.some((m) => (
        normalizeSteamId64(m?.steamId) === senderIdNorm && m?.isLeader
      ));
      if (!(currentLeaderId && botId && currentLeaderId === botId && senderIsLeader)) {
        return '滚远点 只有ANJING是队长时候才可以用';
      }
      const targetName = args.join(' ').toLowerCase();
      const target = members.find((m) => String(m.name || '').toLowerCase() === targetName)
        || members.find((m) => String(m.name || '').toLowerCase().includes(targetName));
      if (!target?.steamId) return `失败: 未找到队员 ${args.join(' ')}`;
      await client.promoteToLeader(String(target.steamId));
      return `队长变更: 已请求转让给 ${target.name}`;
    }, { permission: 'all', description: '更改队长', type: 'change_leader' });

    this.register('jk', async (args) => {
      const keyword = String(args.join(' ') || '').trim();
      if (!keyword) return '用法: jk <地点关键词>';
      const matches = matchCctvEntries(keyword);
      if (!matches.length) return `未找到监控代码[${keyword}]`;
      return matches.flatMap((entry) => this._buildCctvCodeLines(entry)).join('\n');
    }, { description: '监控代码查询 <地点关键词>', type: 'cctv_codes' });

    this.register('help', async () => {
      const helpOverrides = {
        fwq: '服务器摘要 [人数/排队/时间/昼夜]',
        fk: '控制已配对开关 [开|关|切换] [关键词]',
        hc: '货船状态',
        wz: '武装直升机状态',
        sh: '深海状态',
        fy: '翻译 <文本>',
        ai: 'AI问答 <问题>',
        shj: '售货机查询 <物品>[/货币] 例: shj 高级蓝图/硫磺',
        jk: '监控代码查询 <地点关键词> 例: jk 强盗',
        help: '显示帮助',
      };
      return ['可用指令',
        ...Object.entries(this._commands)
        .filter(([k, v]) => k !== 'dz' && String(v?.type || '') !== 'change_leader')
        .map(([k, v]) => `- ${k}: ${helpOverrides[k] || v.description}${v.permission === 'leader' ? '（仅队长）' : ''}`),
        '文档: GUI/Web -> 帮助文档']
        .join('\n');
    }, { description: '帮助' });
  }

  getCommands() {
    return Object.entries(this._commands).map(([keyword, cmd]) => ({
      keyword,
      description: cmd.description,
      permission: cmd.permission,
      enabled: cmd.enabled !== false,
      type: cmd.type || null,
      isBuiltin: this._builtinKeywords.has(keyword),
      meta: this._normalizeCommandMeta(cmd.meta || {}),
      trigger: this._normalizeCommandTrigger(cmd.trigger),
    }));
  }

  setCommandEnabled(keyword, enabled) {
    const key = String(keyword || '').toLowerCase();
    if (!this._commands[key]) return false;
    this._commands[key].enabled = !!enabled;
    return true;
  }

  setCommandRule(rule = {}) {
    const keyword = String(rule.keyword || '').toLowerCase().trim();
    let type = String(rule.type || '').trim();
    if (!keyword) return false;

    const builtinsByType = {
      ai: 'ai',
      query_vendor: 'shj',
      server_info: 'fwq',
      translate: 'fy',
      deep_sea_status: 'sh',
      change_leader: 'dz',
      query_cargo: 'hc',
      query_heli: 'wz',
      switch: 'fk',
      cctv_codes: 'jk',
    };

    let target = keyword;
    if (!this._commands[target]) {
      target = builtinsByType[type] || keyword;
    }

    const normalizedMeta = this._normalizeCommandMeta(rule.meta || {});
    const normalizedTrigger = this._normalizeCommandTrigger(rule.trigger);
    const targetCmd = this._commands[target];
    const effectiveType = type || targetCmd?.type || null;

    if (effectiveType === 'call_group') {
      const groupId = String(normalizedMeta.groupId || '').trim();
      if (!groupId) return false;
      normalizedMeta.groupId = groupId;
      normalizedMeta.channels = this._normalizeCallChannels(normalizedMeta.channels);
      normalizedMeta.message = String(normalizedMeta.message || '').trim();

      this._commands[keyword] = {
        handler: async (args = [], { command } = {}) => {
          const meta = command?.meta || normalizedMeta;
          const gid = String(meta.groupId || '').trim();
          if (!gid) return '失败: 未配置呼叫组';
          if (typeof this._callGroupRunner !== 'function') {
            return '失败: 未配置呼叫执行器';
          }
          const custom = String(Array.isArray(args) ? args.join(' ').trim() : '').trim();
          const message = custom || String(meta.message || '').trim() || `呼叫组[${gid}]触发`;
          const channels = this._normalizeCallChannels(meta.channels);
          const result = await this._callGroupRunner(gid, message, { channels });
          if (result?.success === false) {
            return `失败: ${result.reason || result.error || '呼叫失败'}`;
          }
          return `呼叫组[${gid}]已触发`;
        },
        permission: rule.permission || 'all',
        description: rule.name || keyword,
        enabled: rule.enabled !== false,
        type: 'call_group',
        aliasOf: null,
        meta: normalizedMeta,
        trigger: normalizedTrigger,
      };
      return true;
    }

    if (!targetCmd) return false;

    const isFkCommand = keyword === 'fk' || target === 'fk';
    if (effectiveType === 'switch') {
      const action = this._normalizeSwitchAction(normalizedMeta.action || '');
      normalizedMeta.action = action || 'toggle';
      normalizedMeta.entityIds = Array.isArray(normalizedMeta.entityIds)
        ? normalizedMeta.entityIds.map((id) => String(id)).filter(Boolean)
        : [];
    }
    if (isFkCommand) {
      normalizedMeta.action = 'toggle';
      normalizedMeta.ruleName = '防空';
    }

    let handler = targetCmd.handler;
    const forcedPermission = (isFkCommand)
      ? 'all'
      : (effectiveType === 'change_leader' || target === 'dz' || keyword === 'dz')
      ? 'all'
      : (rule.permission || targetCmd.permission || 'all');
    const forcedDescription = isFkCommand ? '防空' : (rule.name || targetCmd.description || keyword);
    const next = {
      handler,
      permission: forcedPermission,
      description: forcedDescription,
      enabled: rule.enabled !== false,
      type: effectiveType,
      aliasOf: target,
      meta: normalizedMeta,
      trigger: normalizedTrigger,
    };

    this._commands[keyword] = next;
    return true;
  }

  removeCommandRule(keyword) {
    const key = String(keyword || '').toLowerCase().trim();
    if (!key || !this._commands[key]) return false;
    if (this._builtinKeywords.has(key)) {
      this._commands[key].enabled = false;
      return true;
    }
    delete this._commands[key];
    return true;
  }
}

module.exports = CommandParser;
