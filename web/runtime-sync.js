const LEGACY_COMMAND_KEYWORDS = new Set(['dw', 'td', 'sj', 'xy', 'info']);
const LEGACY_COMMAND_TYPES = new Set(['team_info', 'team_chat_history', 'server_time', 'query_position']);

function normalizeKeyword(value) {
  return String(value || '').trim().toLowerCase();
}

function isDeprecatedCommandRule(rule = {}) {
  const keyword = normalizeKeyword(rule.keyword || rule.id);
  const type = normalizeKeyword(rule.type);
  return LEGACY_COMMAND_KEYWORDS.has(keyword) || LEGACY_COMMAND_TYPES.has(type);
}

function shouldSetRule(payload = {}) {
  if (!payload) return false;
  if (payload.type) return true;
  if (payload.name) return true;
  if (payload.permission && payload.permission !== 'all') return true;
  if (payload.meta && typeof payload.meta === 'object' && Object.keys(payload.meta).length > 0) return true;
  return false;
}

async function applyPersistedCommandRules({ parser, persistedRules = [], removeRule } = {}) {
  if (!parser) return;
  const remover = typeof removeRule === 'function' ? removeRule : async () => {};
  const rules = Array.isArray(persistedRules) ? persistedRules : [];

  for (const rule of rules) {
    const keyword = normalizeKeyword(rule.keyword || rule.id);
    if (!keyword) continue;
    if (!isDeprecatedCommandRule(rule)) continue;
    await remover(keyword);
  }

  for (const rule of rules) {
    const keyword = normalizeKeyword(rule.keyword || rule.id);
    if (!keyword) continue;
    if (isDeprecatedCommandRule(rule)) continue;
    if (rule.deleted === true) {
      parser.removeCommandRule?.(keyword);
      continue;
    }

    const payload = {
      ...rule,
      keyword,
      enabled: rule.enabled !== false,
    };

    if (shouldSetRule(payload)) {
      parser.setCommandRule(payload);
      continue;
    }
    parser.setCommandEnabled(keyword, payload.enabled);
  }
}

module.exports = {
  LEGACY_COMMAND_KEYWORDS,
  LEGACY_COMMAND_TYPES,
  isDeprecatedCommandRule,
  applyPersistedCommandRules,
};
