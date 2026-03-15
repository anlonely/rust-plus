function isSafeExternalUrl(rawUrl, { allowHttp = false, allowedHosts = [] } = {}) {
  try {
    const url = new URL(String(rawUrl || '').trim());
    const protocol = String(url.protocol || '').toLowerCase();
    const allowedProtocols = allowHttp ? new Set(['https:', 'http:']) : new Set(['https:']);
    if (!allowedProtocols.has(protocol)) return false;
    if (url.username || url.password) return false;

    const hosts = Array.isArray(allowedHosts)
      ? allowedHosts.map((h) => String(h || '').trim().toLowerCase()).filter(Boolean)
      : [];
    if (hosts.length) {
      const hostname = String(url.hostname || '').toLowerCase();
      const ok = hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
      if (!ok) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function toSafeExternalUrl(rawUrl, options = {}) {
  if (!isSafeExternalUrl(rawUrl, options)) return null;
  try {
    return new URL(String(rawUrl || '').trim()).toString();
  } catch (_) {
    return null;
  }
}

function maskSecret(value, { visible = 4 } = {}) {
  const text = String(value || '');
  if (!text) return '';
  const keep = Math.max(0, Math.floor(Number(visible) || 0));
  if (text.length <= keep * 2 || keep === 0) {
    return '*'.repeat(Math.max(4, Math.min(16, text.length || 4)));
  }
  return `${text.slice(0, keep)}***${text.slice(-keep)}`;
}

function escapeXmlText(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function redactSensitiveText(input = '') {
  let text = String(input || '');
  if (!text) return text;

  const keyedPatterns = [
    /(playerToken["']?\s*[:=]\s*["']?)([^"',\s}]+)/ig,
    /(playerId["']?\s*[:=]\s*["']?)([^"',\s}]+)/ig,
    /(targetId["']?\s*[:=]\s*["']?)([^"',\s}]+)/ig,
    /(ip["']?\s*[:=]\s*["']?)([^"',\s}]+)/ig,
    /(rustplus_auth_token["']?\s*[:=]\s*["']?)([^"',\s}]+)/ig,
    /(expo_push_token["']?\s*[:=]\s*["']?)([^"',\s}]+)/ig,
    /(TWILIO_AUTH_TOKEN["']?\s*[:=]\s*["']?)([^"',\s}]+)/ig,
  ];
  keyedPatterns.forEach((re) => {
    text = text.replace(re, (_, prefix, secret) => `${prefix}${maskSecret(secret, { visible: 3 })}`);
  });

  text = text.replace(/(Authorization["']?\s*[:=]\s*["']?Basic\s+)([A-Za-z0-9+/=]+)/ig, (_, prefix, secret) => {
    return `${prefix}${maskSecret(secret, { visible: 3 })}`;
  });

  return text;
}

module.exports = {
  isSafeExternalUrl,
  toSafeExternalUrl,
  maskSecret,
  escapeXmlText,
  redactSensitiveText,
};
