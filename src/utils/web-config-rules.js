const { normalizeGroupConfig } = require('../call/groups');

function safeObject(input) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input : {};
}

function resolveScopedServerId({ runtimeServerId, requestedServerId } = {}) {
  const requested = String(requestedServerId || '').trim();
  if (requested) return requested;
  return String(runtimeServerId || '').trim();
}

function normalizeRuleActions(actions = [], meta = {}) {
  if (Array.isArray(actions) && actions.length) {
    return actions
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => ({
        ...item,
        type: String(item.type || '').trim().toLowerCase(),
        ...(String(item.type || '').trim().toLowerCase() === 'call_group'
          ? {
              groupId: String(item.groupId || '').trim(),
              channels: Array.isArray(item.channels)
                ? item.channels.map((channel) => String(channel || '').trim().toLowerCase()).filter(Boolean)
                : [],
              ...(item.message != null ? { message: String(item.message || '').trim() } : {}),
            }
          : {}),
      }))
      .filter((item) => {
        if (!item.type) return false;
        if (item.type === 'call_group') return !!item.groupId;
        return ['notify_desktop', 'team_chat', 'send_game_message'].includes(item.type);
      });
  }

  return [
    ...(meta.doNotify ? [{ type: 'notify_desktop' }] : []),
    ...(meta.doChat !== false ? [{ type: 'team_chat' }] : []),
  ];
}

function normalizeCooldownMs(rawValue, fallbackMs = 3_000) {
  const raw = Number(rawValue);
  if (Number.isFinite(raw) && raw >= 0) return Math.round(raw);
  const fallback = Number(fallbackMs);
  if (Number.isFinite(fallback) && fallback >= 0) return Math.round(fallback);
  return 3_000;
}

function normalizeEventRuleInput(raw = {}, serverId = '', options = {}) {
  const input = safeObject(raw);
  const event = String(input.event || '').trim() || 'alarm_on';
  const trigger = safeObject(input.trigger);
  const meta = safeObject(input._meta);
  meta.doNotify = meta.doNotify === true;
  meta.doChat = meta.doChat !== false;
  meta.actions = normalizeRuleActions(meta.actions, meta);
  trigger.cooldownMs = normalizeCooldownMs(trigger.cooldownMs, options.defaultCooldownMs);

  if (event === 'cargo_ship_status') {
    trigger.cargoNotifyEnter = trigger.cargoNotifyEnter !== false;
    trigger.cargoNotifyLeave = trigger.cargoNotifyLeave !== false;
    trigger.cargoNotifyActive = trigger.cargoNotifyActive === true;
    trigger.cargoNotifyDock = trigger.cargoNotifyDock !== false;
  }
  if (event === 'ch47_status') {
    trigger.ch47NotifyEnter = trigger.ch47NotifyEnter !== false;
    trigger.ch47NotifyActive = trigger.ch47NotifyActive === true;
    trigger.ch47NotifyLeave = trigger.ch47NotifyLeave !== false;
  }
  if (event === 'patrol_heli_status') {
    trigger.heliNotifyEnter = trigger.heliNotifyEnter !== false;
    trigger.heliNotifyActive = trigger.heliNotifyActive === true;
    trigger.heliNotifyLeave = trigger.heliNotifyLeave !== false;
    trigger.heliNotifyExplode = trigger.heliNotifyExplode !== false;
  }
  if (event === 'vendor_status') {
    trigger.vendorNotifyEnter = trigger.vendorNotifyEnter !== false;
    trigger.vendorNotifyMove = trigger.vendorNotifyMove === true;
    trigger.vendorNotifyStopped = trigger.vendorNotifyStopped !== false;
    trigger.vendorNotifyLeave = trigger.vendorNotifyLeave !== false;
  }

  return {
    id: String(input.id || '').trim() || `web_event_${Date.now()}`,
    name: String(input.name || '').trim() || 'Web 事件规则',
    event,
    serverId: String(serverId || '').trim() || null,
    trigger,
    enabled: input.enabled !== false,
    _meta: meta,
  };
}

function normalizeCommandRuleInput(raw = {}, serverId = '', options = {}) {
  const input = safeObject(raw);
  const keyword = String(input.keyword || '').trim().toLowerCase();
  if (!keyword) return null;
  const trigger = safeObject(input.trigger);
  const meta = safeObject(input.meta);
  meta.doNotify = meta.doNotify === true;
  meta.doChat = meta.doChat !== false;
  meta.actions = normalizeRuleActions(meta.actions, meta);
  trigger.cooldownMs = normalizeCooldownMs(trigger.cooldownMs, options.defaultCooldownMs);

  return {
    id: String(input.id || '').trim() || keyword,
    keyword,
    type: input.type == null ? null : String(input.type || '').trim() || null,
    name: String(input.name || '').trim(),
    permission: String(input.permission || '').trim() === 'leader' ? 'leader' : 'all',
    enabled: input.enabled !== false,
    meta,
    trigger,
    serverId: String(serverId || '').trim() || null,
  };
}

function normalizeCallGroupInput(raw = {}) {
  const input = safeObject(raw);
  const normalized = normalizeGroupConfig(input);
  const id = String(normalized.id || '').trim() || `group_${Date.now()}`;
  const explicitName = String(input.name || '').trim();
  return {
    ...normalized,
    id,
    name: explicitName || normalized.name || `呼叫组_${id.slice(-4)}`,
    enabled: normalized.enabled !== false,
    // 兼容旧前端字段（只读展示），统一映射到电话成员。
    members: Array.isArray(normalized.phone?.members) ? [...normalized.phone.members] : [],
  };
}

module.exports = {
  resolveScopedServerId,
  normalizeEventRuleInput,
  normalizeCommandRuleInput,
  normalizeCallGroupInput,
};
