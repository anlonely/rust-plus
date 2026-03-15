// src/translate/client.js
// ─────────────────────────────────────────────
// P4：翻译服务（Gemini 2.5 Flash）
// 支持：RPM 限频 + 返回长度限制
// ─────────────────────────────────────────────

const https = require('https');
const logger = require('../utils/logger');
const { consumeRateLimit, RateLimitError } = require('../utils/rate-limit');

const GEMINI_MODEL = process.env.GEMINI_TRANSLATE_MODEL || 'gemini-2.5-flash';
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY
  || process.env.GOOGLE_API_KEY;
const TRANSLATE_RPM_LIMIT = Math.max(1, parseInt(process.env.FY_TRANSLATE_RPM || '15', 10) || 15);
const RATE_WINDOW_MS = 60_000;
const GEMINI_TIMEOUT_MS = Math.max(3_000, parseInt(process.env.GEMINI_TIMEOUT_MS || '15000', 10) || 15000);

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

function postJson(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) {
            reject(new Error(json?.error?.message || `Gemini HTTP ${res.statusCode}`));
            return;
          }
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(GEMINI_TIMEOUT_MS, () => req.destroy(new Error(`Gemini 请求超时（${GEMINI_TIMEOUT_MS}ms）`)));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function geminiTranslate(text, { maxChars = 80 } = {}) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 未配置');
  enforceRateLimit();

  const srcLang = detectLang(text);
  const targetLabel = srcLang === 'zh' ? '英文' : '中文';
  const safeLimit = Math.max(8, Number(maxChars) || 80);
  logger.debug(`[Translate] Gemini "${String(text).slice(0, 30)}" -> ${targetLabel}, max=${safeLimit}`);

  const prompt = [
    '你是 Rust 游戏队伍聊天翻译器。',
    `把下面文本翻译成${targetLabel}。`,
    `仅返回翻译结果，不要解释，不要加引号，最多 ${safeLimit} 个字符。`,
    `文本：${String(text || '')}`,
  ].join('\n');

  const res = await postJson(
    'generativelanguage.googleapis.com',
    `/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 192,
      },
    },
  );

  const raw = (res?.candidates || [])
    .flatMap((c) => c?.content?.parts || [])
    .map((p) => p?.text || '')
    .join(' ')
    .trim();
  if (!raw) throw new Error('翻译服务未返回内容');

  return clampChars(normalizeOneLine(raw), safeLimit);
}

async function translate(text, options = {}) {
  return geminiTranslate(text, options);
}

module.exports = { translate, geminiTranslate, detectLang, RateLimitError };
