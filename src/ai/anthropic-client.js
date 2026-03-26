const http = require('http');
const https = require('https');
const { URL } = require('url');

function postJson(urlString, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = JSON.stringify(body);
    const client = url.protocol === 'http:' ? http : https;
    const req = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) {
            reject(new Error(
              json?.error?.message
              || json?.message
              || `Anthropic HTTP ${res.statusCode}`,
            ));
            return;
          }
          resolve(json);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`AI 请求超时（${timeoutMs}ms）`)));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function extractMessageText(response = {}) {
  return (Array.isArray(response?.content) ? response.content : [])
    .filter((part) => String(part?.type || '').toLowerCase() === 'text')
    .map((part) => String(part?.text || ''))
    .join(' ')
    .trim();
}

function shouldRetryAiError(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return (
    text.includes('请求超时')
    || text.includes('timeout')
    || text.includes('econnreset')
    || text.includes('socket hang up')
    || text.includes('temporary failure')
  );
}

async function requestAnthropicMessage(settings, { system, userText, maxOutputTokens = 256, temperature = 0.2, retries = 1 }) {
  const baseUrl = String(settings?.baseUrl || '').replace(/\/+$/, '');
  const authToken = String(settings?.authToken || '').trim();
  const model = String(settings?.model || '').trim();
  const timeoutMs = Math.max(3000, Number(settings?.timeoutMs) || 30000);
  if (!baseUrl) throw new Error('AI Base URL 未配置');
  if (!authToken) throw new Error('AI Token 未配置');
  if (!model) throw new Error('AI 模型未配置');
  const headers = {
    'x-api-key': authToken,
    'anthropic-version': '2023-06-01',
  };
  if (settings?.disableExperimentalBetas) {
    headers['x-claude-code-disable-experimental-betas'] = '1';
  }
  let lastError = null;
  for (let attempt = 0; attempt <= Math.max(0, Number(retries) || 0); attempt += 1) {
    try {
      return await postJson(`${baseUrl}/v1/messages`, headers, {
        model,
        system: String(system || ''),
        max_tokens: Math.max(64, Number(maxOutputTokens) || 256),
        temperature,
        messages: [
          { role: 'user', content: String(userText || '') },
        ],
      }, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetryAiError(error)) break;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  throw lastError || new Error('AI 请求失败');
}

module.exports = {
  requestAnthropicMessage,
  extractMessageText,
};
