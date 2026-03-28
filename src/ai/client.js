// src/ai/client.js
// ─────────────────────────────────────────────
// P4：AI 问答客户端
// 使用可配置的 Anthropic 兼容 API
// ─────────────────────────────────────────────

const logger = require('../utils/logger');
const { consumeRateLimit } = require('../utils/rate-limit');
const { getAiSettings } = require('./runtime-config');
const { requestAnthropicMessage, extractMessageText } = require('./anthropic-client');

const AI_SHARED_RPM_LIMIT = Math.max(1, parseInt(process.env.FY_TRANSLATE_RPM || '15', 10) || 15);

function normalizeOneLine(text) {
  return String(text || '')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampChars(text, maxChars) {
  const limit = Math.max(8, Number(maxChars) || 96);
  const chars = Array.from(String(text || ''));
  if (chars.length <= limit) return chars.join('');
  return `${chars.slice(0, Math.max(1, limit - 1)).join('')}…`;
}

async function askAnthropic(question, systemPrompt = '', { maxChars = 96 } = {}) {
  const settings = await getAiSettings();
  consumeRateLimit('ai_shared_rpm', {
    limit: AI_SHARED_RPM_LIMIT,
    windowMs: 60_000,
    message: `请求过于频繁：每分钟最多 ${AI_SHARED_RPM_LIMIT} 次，请稍后再试`,
  });
  const safeLimit = Math.max(8, Number(maxChars) || 96);

  logger.debug(`[AI] ${settings.model || 'unknown-model'} 问答: ${String(question || '').slice(0, 50)}...`);
  const res = await requestAnthropicMessage(settings, {
    system: systemPrompt || '你是 Rust 游戏助手。',
    userText: [
      `请用简洁中文回答，最多 ${safeLimit} 个字符。`,
      '不要输出 Markdown，不要分段，只返回答案正文。',
      `问题：${String(question || '')}`,
    ].join('\n'),
    maxOutputTokens: 256,
    temperature: 0.2,
  });
  const raw = extractMessageText(res);
  if (!raw) throw new Error('AI 服务未返回内容');
  return clampChars(normalizeOneLine(raw), safeLimit);
}

async function ask(question, options = {}) {
  const SYSTEM = '你是 Rust 游戏助手，请只回答 Rust 游戏相关问题。';
  return askAnthropic(question, SYSTEM, options);
}

module.exports = { ask, askAnthropic };
