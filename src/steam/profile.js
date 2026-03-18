const https = require('https');
const { maskSecret } = require('../utils/security');
const { createRustplusConfigStore } = require('../storage/rustplus-config');

function parseBase64JsonSegment(segment) {
  if (!segment || typeof segment !== 'string') return null;
  const candidates = [segment, segment.replace(/-/g, '+').replace(/_/g, '/')];
  const tried = new Set();
  for (const raw of candidates) {
    if (!raw || tried.has(raw)) continue;
    tried.add(raw);
    const padLen = (4 - (raw.length % 4)) % 4;
    const padded = raw + '='.repeat(padLen);
    try {
      return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch {
      // try next candidate
    }
  }
  return null;
}

function decodeRustplusToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  const payloadCandidates = [];
  if (parts.length >= 3) {
    // JWT format: header.payload.signature
    payloadCandidates.push(parts[1], parts[0]);
  } else if (parts.length === 2) {
    // Rust+ auth token format: payload.signature
    payloadCandidates.push(parts[0], parts[1]);
  } else {
    payloadCandidates.push(parts[0]);
  }
  for (const candidate of payloadCandidates) {
    const parsed = parseBase64JsonSegment(candidate);
    if (parsed && typeof parsed === 'object') return parsed;
  }
  return null;
}

function toIso(ts) {
  if (!ts || Number.isNaN(Number(ts))) return null;
  return new Date(Number(ts) * 1000).toISOString();
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'rust-plus/1.0 (+steam profile check)',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk.toString());
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('request timeout')));
  });
}

function extractXml(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(re);
  return match ? normalizeSteamText(match[1]) : null;
}

function decodeHtmlEntities(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function normalizeSteamText(input) {
  if (input == null) return null;
  let text = String(input).trim();

  // unwrap CDATA blocks
  const cdataMatch = text.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdataMatch) text = cdataMatch[1];

  text = decodeHtmlEntities(text);

  // keep line intent from br tags, then strip all html/xml tags
  text = text.replace(/<br\s*\/?>/gi, ' · ');
  text = text.replace(/<[^>]+>/g, '');

  // normalize spaces/newlines
  text = text.replace(/\s+/g, ' ').trim();

  return text || null;
}

async function fetchSteamProfileXml(steamId) {
  const url = `https://steamcommunity.com/profiles/${steamId}/?xml=1`;
  const { statusCode, data } = await get(url);
  if (statusCode >= 400) {
    throw new Error(`steamcommunity HTTP ${statusCode}`);
  }
  return {
    steamId64: extractXml(data, 'steamID64'),
    steamName: extractXml(data, 'steamID'),
    avatarIcon: extractXml(data, 'avatarIcon'),
    avatarMedium: extractXml(data, 'avatarMedium'),
    avatarFull: extractXml(data, 'avatarFull'),
    onlineState: extractXml(data, 'onlineState'),
    stateMessage: extractXml(data, 'stateMessage'),
    privacyState: extractXml(data, 'privacyState'),
    visibilityState: extractXml(data, 'visibilityState'),
    profileState: extractXml(data, 'profileState'),
    location: extractXml(data, 'location'),
    memberSince: extractXml(data, 'memberSince'),
  };
}

async function getSteamProfileStatus({ fetchRemote = true, configFile = '' } = {}) {
  const cfgStore = createRustplusConfigStore({ configFile });
  const cfg = cfgStore.read();
  const token = cfg.rustplus_auth_token || '';
  const decoded = decodeRustplusToken(token);

  const steamId = decoded?.steamId || null;
  const result = {
    configFile: cfgStore.filePath,
    hasLogin: Boolean(token),
    tokenMasked: token ? maskSecret(token, { visible: 6 }) : '',
    tokenMeta: decoded ? {
      steamId: decoded.steamId,
      version: decoded.version,
      issuedAt: toIso(decoded.iss),
      expiresAt: toIso(decoded.exp),
      isExpired: decoded.exp ? Date.now() >= Number(decoded.exp) * 1000 : null,
    } : null,
    avatarUrl: steamId ? `https://companion-rust.facepunch.com/api/avatar/${steamId}` : null,
    steamProfile: null,
    steamProfileError: null,
  };

  if (!steamId) {
    return result;
  }

  if (fetchRemote) {
    try {
      result.steamProfile = await fetchSteamProfileXml(steamId);
    } catch (err) {
      result.steamProfileError = err.message;
    }
  }

  return result;
}

async function logoutSteam({ configFile = '' } = {}) {
  const cfgStore = createRustplusConfigStore({ configFile });
  const cfg = cfgStore.read();
  if (!cfg || typeof cfg !== 'object') return { success: false, reason: '配置文件不可用' };
  delete cfg.rustplus_auth_token;
  delete cfg.rustplus_auth;
  await cfgStore.write(cfg);
  return { success: true };
}

module.exports = {
  getSteamProfileStatus,
  logoutSteam,
  decodeRustplusToken,
};
