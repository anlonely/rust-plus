// src/ai/client.js
// ─────────────────────────────────────────────
// P4：AI 问答客户端
// 使用与 fy 相同的 Gemini API（2.5 Flash）
// ─────────────────────────────────────────────

const https = require('https');
const logger = require('../utils/logger');
const { consumeRateLimit } = require('../utils/rate-limit');

const GEMINI_MODEL = process.env.GEMINI_AI_MODEL || process.env.GEMINI_TRANSLATE_MODEL || 'gemini-2.5-flash';
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY
  || process.env.GOOGLE_API_KEY;
const GEMINI_SHARED_RPM_LIMIT = Math.max(1, parseInt(process.env.FY_TRANSLATE_RPM || '15', 10) || 15);
const GEMINI_TIMEOUT_MS = Math.max(3_000, parseInt(process.env.GEMINI_TIMEOUT_MS || '15000', 10) || 15000);

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

async function askGemini(question, systemPrompt = '', { maxChars = 96 } = {}) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 未配置');
  consumeRateLimit('gemini_shared_ai_fy', {
    limit: GEMINI_SHARED_RPM_LIMIT,
    windowMs: 60_000,
    message: `请求过于频繁：每分钟最多 ${GEMINI_SHARED_RPM_LIMIT} 次，请稍后再试`,
  });
  const safeLimit = Math.max(8, Number(maxChars) || 96);
  const prompt = [
    systemPrompt || '你是 Rust 游戏助手。',
    `请用简洁中文回答，最多 ${safeLimit} 个字符。`,
    '不要输出 Markdown，不要分段，只返回答案正文。',
    `问题：${String(question || '')}`,
  ].join('\n');

  logger.debug(`[AI] Gemini 问答: ${String(question || '').slice(0, 50)}...`);
  const res = await postJson(
    'generativelanguage.googleapis.com',
    `/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: 256,
      },
    },
  );

  const raw = (res?.candidates || [])
    .flatMap((c) => c?.content?.parts || [])
    .map((p) => p?.text || '')
    .join(' ')
    .trim();
  if (!raw) throw new Error('AI 服务未返回内容');
  return clampChars(normalizeOneLine(raw), safeLimit);
}

async function ask(question, options = {}) {
  const SYSTEM = '你是 Rust 游戏助手，请只回答 Rust 游戏相关问题。';
  return askGemini(question, SYSTEM, options);
}

// 兼容旧导出名
const askOpenAI = askGemini;
const askClaude = askGemini;

module.exports = { ask, askGemini, askOpenAI, askClaude };
