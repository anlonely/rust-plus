// src/translate/client.js
// ─────────────────────────────────────────────
// P4：翻译服务（Gemini 2.5 Flash）
// 支持：RPM 限频 + 返回长度限制
// ─────────────────────────────────────────────

const logger = require('../utils/logger');
const { consumeRateLimit, RateLimitError } = require('../utils/rate-limit');
const { getAiSettings } = require('../ai/runtime-config');
const { requestAnthropicMessage, extractMessageText } = require('../ai/anthropic-client');

const TRANSLATE_RPM_LIMIT = Math.max(1, parseInt(process.env.FY_TRANSLATE_RPM || '15', 10) || 15);
const RATE_WINDOW_MS = 60_000;

function enforceRateLimit() {
  consumeRateLimit('gemini_shared_ai_fy', {
    limit: TRANSLATE_RPM_LIMIT,
    windowMs: RATE_WINDOW_MS,
    message: `请求过于频繁：每分钟最多 ${TRANSLATE_RPM_LIMIT} 次，请稍后再试`,
  });
}

function clampChars(text, maxChars) {
  const limit = Math.max(8, Number(maxChars) || 80);
  const chars = Array.from(String(text || '').trim());
  if (chars.length <= limit) return chars.join('');
  return `${chars.slice(0, Math.max(1, limit - 1)).join('')}…`;
}

function normalizeOneLine(text) {
  return String(text || '')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectLang(text) {
  const raw = String(text || '');
  if (!raw) return 'en';
  const chineseChars = raw.match(/[\u4e00-\u9fa5]/g)?.length || 0;
  return chineseChars / raw.length > 0.3 ? 'zh' : 'en';
}

async function anthropicTranslate(text, { maxChars = 80 } = {}) {
  const settings = await getAiSettings();
  enforceRateLimit();

  const srcLang = detectLang(text);
  const targetLabel = srcLang === 'zh' ? '英文' : '中文';
  const safeLimit = Math.max(8, Number(maxChars) || 80);
  logger.debug(`[Translate] ${settings.model || 'unknown-model'} "${String(text).slice(0, 30)}" -> ${targetLabel}, max=${safeLimit}`);

  const prompt = [
    '你是 Rust 游戏队伍聊天翻译器。',
    `把下面文本翻译成${targetLabel}。`,
    `仅返回翻译结果，不要解释，不要加引号，最多 ${safeLimit} 个字符。`,
    `文本：${String(text || '')}`,
  ].join('\n');

  const res = await requestAnthropicMessage(settings, {
    system: '你是 Rust 游戏队伍聊天翻译器。',
    userText: prompt,
    maxOutputTokens: 192,
    temperature: 0.1,
  });
  const raw = extractMessageText(res);
  if (!raw) throw new Error('翻译服务未返回内容');

  return clampChars(normalizeOneLine(raw), safeLimit);
}

async function translate(text, options = {}) {
  return anthropicTranslate(text, options);
}

module.exports = { translate, anthropicTranslate, detectLang, RateLimitError };
