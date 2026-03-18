// src/call/groups.js
// ─────────────────────────────────────────────
// 呼叫组管理：电话(互亿无线/Twilio) + KOOK + Discord
// ─────────────────────────────────────────────

const https = require('https');
const logger = require('../utils/logger');
const { escapeXmlText } = require('../utils/security');
const { hasIhuyiConfig, submitVoiceNotice } = require('./ihuyi-vm');

const TWILIO_TIMEOUT_MS = Math.max(3_000, parseInt(process.env.TWILIO_TIMEOUT_MS || '15000', 10) || 15000);
const TEAM_CHAT_SETTINGS_GROUP_ID = '__team_chat_settings__';
const DEFAULT_TEAM_CHAT_INTERVAL_MS = Math.max(1_000, parseInt(process.env.RUST_TEAM_CHAT_GLOBAL_INTERVAL_MS || '3000', 10) || 3000);

// ── Twilio 电话呼叫 ───────────────────────────
function twilioAuth() {
  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
}

function makeCall(to, message) {
  if (hasIhuyiConfig()) {
    return submitVoiceNotice({ mobile: to, content: message });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !process.env.TWILIO_AUTH_TOKEN || !from) {
    logger.warn('[Call] Twilio 未配置，跳过呼叫');
    return Promise.resolve({ skipped: true });
  }

  const safeText = escapeXmlText(message);
  const twiml = `<Response><Say language="zh-CN">${safeText}</Say><Pause length="2"/><Say language="zh-CN">${safeText}</Say></Response>`;
  const body = new URLSearchParams({ To: to, From: from, Twiml: twiml }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${sid}/Calls.json`,
      method: 'POST',
      headers: {
        Authorization: twilioAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Twilio error ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(new Error(`Twilio 返回解析失败: ${e.message}`));
        }
      });
    });
    req.setTimeout(TWILIO_TIMEOUT_MS, () => req.destroy(new Error(`Twilio 请求超时（${TWILIO_TIMEOUT_MS}ms）`)));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── 通用 Webhook 发送 ─────────────────────────
function postJson(url, payload, tag = 'Webhook') {
  let parsed;
  try {
    parsed = new URL(String(url || '').trim());
  } catch (_) {
    return Promise.reject(new Error(`${tag} 地址无效`));
  }
  const body = JSON.stringify(payload || {});
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname || '/'}${parsed.search || ''}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`${tag} HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        resolve({ statusCode: res.statusCode, data });
      });
    });
    req.setTimeout(15_000, () => req.destroy(new Error(`${tag} 请求超时`)));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendKook(webhookUrl, message) {
  return postJson(webhookUrl, {
    msg_type: 1,
    content: String(message || ''),
  }, 'KOOK');
}

function sendDiscord(webhookUrl, message) {
  return postJson(webhookUrl, {
    content: String(message || ''),
  }, 'Discord');
}

// ── 配置归一化 ───────────────────────────────
function normalizeMembers(members = []) {
  if (!Array.isArray(members)) return [];
  return members
    .map((member) => ({
      name: String(member?.name || member?.label || '').trim(),
      phone: String(member?.phone || '').trim(),
    }))
    .filter((member) => member.phone);
}

function normalizeWebhookConfig(raw = {}, fallbackUrl = '') {
  const webhookUrl = String(raw?.webhookUrl || fallbackUrl || '').trim();
  const explicitEnabled = raw && Object.prototype.hasOwnProperty.call(raw, 'enabled')
    ? !!raw.enabled
    : null;
  const enabled = explicitEnabled == null ? !!webhookUrl : explicitEnabled;
  return { enabled, webhookUrl };
}

function normalizeGroupConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  if (
    String(source.id || '').trim() === TEAM_CHAT_SETTINGS_GROUP_ID
    || String(source.kind || '').trim().toLowerCase() === 'team_chat_settings'
  ) {
    const intervalRaw = Number(source.intervalMs);
    return {
      id: TEAM_CHAT_SETTINGS_GROUP_ID,
      kind: 'team_chat_settings',
      system: true,
      locked: true,
      name: String(source.name || '').trim() || '团队聊天',
      enabled: true,
      intervalMs: Number.isFinite(intervalRaw) && intervalRaw > 0
        ? Math.max(1_000, Math.round(intervalRaw))
        : DEFAULT_TEAM_CHAT_INTERVAL_MS,
      phone: { enabled: false, members: [] },
      kook: { enabled: false, webhookUrl: '' },
      discord: { enabled: false, webhookUrl: '' },
      members: [],
    };
  }
  const members = normalizeMembers(source.members);
  const phoneMembers = normalizeMembers(source.phone?.members || members);
  const explicitPhoneEnabled = source.phone && Object.prototype.hasOwnProperty.call(source.phone, 'enabled')
    ? !!source.phone.enabled
    : null;
  const phoneEnabled = explicitPhoneEnabled == null ? phoneMembers.length > 0 : explicitPhoneEnabled;

  return {
    id: String(source.id || '').trim(),
    name: String(source.name || '').trim() || '未命名呼叫组',
    enabled: source.enabled !== false,
    phone: {
      enabled: phoneEnabled,
      members: phoneMembers,
    },
    kook: normalizeWebhookConfig(source.kook || {}, source.kookWebhookUrl),
    discord: normalizeWebhookConfig(source.discord || {}, source.discordWebhookUrl),
  };
}

function resolveEnabledChannels(group = {}, requestedChannels = []) {
  const cfg = normalizeGroupConfig(group);
  const available = [];
  if (cfg.phone.enabled && cfg.phone.members.length) available.push('phone');
  if (cfg.kook.enabled && cfg.kook.webhookUrl) available.push('kook');
  if (cfg.discord.enabled && cfg.discord.webhookUrl) available.push('discord');

  const requested = Array.isArray(requestedChannels)
    ? [...new Set(requestedChannels.map((c) => String(c || '').trim().toLowerCase()).filter(Boolean))]
    : [];
  if (!requested.length) return available;
  return available.filter((channel) => requested.includes(channel));
}

function isTeamChatSettingsGroup(value = {}) {
  const id = typeof value === 'string' ? value : value?.id;
  const kind = typeof value === 'string' ? '' : value?.kind;
  return String(id || '').trim() === TEAM_CHAT_SETTINGS_GROUP_ID
    || String(kind || '').trim().toLowerCase() === 'team_chat_settings';
}


function createGroupService() {
  // ── 内存存储 ─────────────────────────────────
  const _groups = new Map();
  
  function ensureSystemTeamChatGroup() {
    if (!_groups.has(TEAM_CHAT_SETTINGS_GROUP_ID)) {
      _groups.set(TEAM_CHAT_SETTINGS_GROUP_ID, normalizeGroupConfig({
        id: TEAM_CHAT_SETTINGS_GROUP_ID,
        kind: 'team_chat_settings',
        name: '团队聊天',
        intervalMs: DEFAULT_TEAM_CHAT_INTERVAL_MS,
      }));
    }
    return _groups.get(TEAM_CHAT_SETTINGS_GROUP_ID);
  }
  
  function setGroup(id, group = {}) {
    ensureSystemTeamChatGroup();
    const normalized = normalizeGroupConfig({ ...group, id });
    _groups.set(id, normalized);
    logger.info(`[Call] 呼叫组已设置: [${normalized.name}] phone=${normalized.phone.members.length} kook=${normalized.kook.enabled ? 'on' : 'off'} discord=${normalized.discord.enabled ? 'on' : 'off'}`);
    return _groups.get(id);
  }
  
  function listGroups() {
    const system = ensureSystemTeamChatGroup();
    return [
      system,
      ...[..._groups.values()].filter((group) => !isTeamChatSettingsGroup(group)),
    ];
  }
  
  function removeGroup(id) {
    if (isTeamChatSettingsGroup(id)) return false;
    _groups.delete(id);
    return true;
  }
  
  function getTeamChatSettings() {
    return ensureSystemTeamChatGroup();
  }
  
  function getTeamChatIntervalMs() {
    return getTeamChatSettings().intervalMs || DEFAULT_TEAM_CHAT_INTERVAL_MS;
  }
  
  async function callGroup(groupId, message, options = {}) {
    ensureSystemTeamChatGroup();
    if (isTeamChatSettingsGroup(groupId)) {
      return { success: false, reason: '系统团队聊天配置不可作为呼叫组触发' };
    }
    const group = _groups.get(groupId);
    if (!group) {
      logger.warn(`[Call] 未找到呼叫组: ${groupId}`);
      return { success: false, reason: '呼叫组不存在' };
    }
    if (group.enabled === false) {
      logger.info(`[Call] 呼叫组 [${group.name}] 已禁用`);
      return { success: false, reason: '呼叫组已禁用' };
    }
  
    const channels = resolveEnabledChannels(group, options.channels);
    if (!channels.length) {
      return { success: false, reason: '未配置可用呼叫通道' };
    }
  
    const text = String(message || '').trim() || `呼叫组[${group.name}]触发`;
    const results = [];
  
    if (channels.includes('phone')) {
      for (const member of group.phone.members) {
        try {
          const r = await makeCall(member.phone, text);
          results.push({ channel: 'phone', member: member.name, phone: member.phone, success: true, sid: r?.sid || '' });
        } catch (e) {
          results.push({ channel: 'phone', member: member.name, phone: member.phone, success: false, error: e.message });
        }
      }
    }
  
    if (channels.includes('kook')) {
      try {
        await sendKook(group.kook.webhookUrl, text);
        results.push({ channel: 'kook', success: true });
      } catch (e) {
        results.push({ channel: 'kook', success: false, error: e.message });
      }
    }
  
    if (channels.includes('discord')) {
      try {
        await sendDiscord(group.discord.webhookUrl, text);
        results.push({ channel: 'discord', success: true });
      } catch (e) {
        results.push({ channel: 'discord', success: false, error: e.message });
      }
    }
  
    const successCount = results.filter((item) => item.success).length;
    if (!successCount) {
      return { success: false, reason: '全部通道发送失败', results };
    }
    return { success: true, results };
  }

  return {
    setGroup,
    listGroups,
    removeGroup,
    callGroup,
    getTeamChatSettings,
    getTeamChatIntervalMs,
  };
}

module.exports = {
  TEAM_CHAT_SETTINGS_GROUP_ID,
  DEFAULT_TEAM_CHAT_INTERVAL_MS,
  makeCall,
  normalizeGroupConfig,
  resolveEnabledChannels,
  isTeamChatSettingsGroup,
  createGroupService,
};
