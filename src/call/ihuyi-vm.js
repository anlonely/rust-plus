const https = require('https');
const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = Math.max(3_000, parseInt(process.env.IHUYI_VM_TIMEOUT_MS || '15000', 10) || 15000);
const DEFAULT_ENDPOINT = String(process.env.IHUYI_VM_ENDPOINT || 'https://api.ihuyi.com/vm/Submit.json').trim();

function getIhuyiConfig(overrides = {}) {
  const account = String(overrides.account || process.env.IHUYI_VM_API_ID || '').trim();
  const password = String(overrides.password || process.env.IHUYI_VM_API_KEY || '').trim();
  const endpoint = String(overrides.endpoint || DEFAULT_ENDPOINT).trim();
  const format = String(overrides.format || process.env.IHUYI_VM_FORMAT || 'json').trim().toLowerCase() || 'json';
  const templateId = String(overrides.templateId || process.env.IHUYI_VM_TEMPLATE_ID || '').trim();
  return { account, password, endpoint, format, templateId };
}

function hasIhuyiConfig(overrides = {}) {
  const cfg = getIhuyiConfig(overrides);
  return !!(cfg.account && cfg.password && cfg.endpoint);
}

function toMd5(text = '') {
  return crypto.createHash('md5').update(String(text), 'utf8').digest('hex');
}

function buildVoiceContent(message = '') {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Rust 工具箱语音通知，请及时查看。';
  return text.length > 180 ? text.slice(0, 180) : text;
}

function parseXmlValue(xml = '', tag = '') {
  const m = String(xml || '').match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m?.[1] ? String(m[1]).trim() : '';
}

function parseIhuyiResponse(raw = '', format = 'json') {
  const text = String(raw || '').trim();
  if (!text) return {};
  if (String(format).toLowerCase() === 'json') {
    try {
      return JSON.parse(text);
    } catch (_) {
      return { raw: text };
    }
  }
  return {
    code: parseXmlValue(text, 'code'),
    msg: parseXmlValue(text, 'msg'),
    mobile: parseXmlValue(text, 'mobile'),
    smsid: parseXmlValue(text, 'smsid') || parseXmlValue(text, 'voiceid'),
    raw: text,
  };
}

function isSuccessResponse(parsed = {}) {
  const code = String(parsed?.code ?? '').trim();
  return code === '2' || code === '200';
}

function submitVoiceNotice({ mobile, content, templateId = '', ...overrides } = {}) {
  const cfg = getIhuyiConfig(overrides);
  if (!cfg.account || !cfg.password || !cfg.endpoint) {
    return Promise.resolve({ skipped: true, provider: 'ihuyi-vm' });
  }

  let endpoint;
  try {
    endpoint = new URL(cfg.endpoint);
  } catch (_) {
    return Promise.reject(new Error('互亿无线语音接口地址无效'));
  }

  const body = new URLSearchParams({
    account: cfg.account,
    password: cfg.password,
    mobile: String(mobile || '').trim(),
    content: buildVoiceContent(content),
    format: cfg.format || 'json',
  });
  const effectiveTemplateId = String(templateId || cfg.templateId || '').trim();
  if (effectiveTemplateId) body.set('templateid', effectiveTemplateId);

  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: `${endpoint.pathname || '/'}${endpoint.search || ''}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Content-Length': Buffer.byteLength(body.toString()),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString(); });
      res.on('end', () => {
        const parsed = parseIhuyiResponse(data, cfg.format);
        const result = {
          provider: 'ihuyi-vm',
          statusCode: res.statusCode,
          parsed,
          raw: data,
        };
        if (res.statusCode >= 400) {
          reject(new Error(`互亿无线 HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        if (!isSuccessResponse(parsed)) {
          const code = parsed?.code != null ? String(parsed.code) : '';
          const msg = parsed?.msg ? String(parsed.msg) : '未知错误';
          reject(new Error(`互亿无线发送失败${code ? ` [${code}]` : ''}: ${msg}`));
          return;
        }
        resolve(result);
      });
    });
    req.setTimeout(DEFAULT_TIMEOUT_MS, () => req.destroy(new Error(`互亿无线请求超时（${DEFAULT_TIMEOUT_MS}ms）`)));
    req.on('error', reject);
    req.write(body.toString());
    req.end();
  });
}

module.exports = {
  DEFAULT_ENDPOINT,
  DEFAULT_TIMEOUT_MS,
  getIhuyiConfig,
  hasIhuyiConfig,
  toMd5,
  buildVoiceContent,
  parseIhuyiResponse,
  isSuccessResponse,
  submitVoiceNotice,
};
