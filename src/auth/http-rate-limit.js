const { consumeRateLimit, RateLimitError } = require('../utils/rate-limit');

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

function normalizeIp(raw) {
  return String(raw || '').split(',')[0].trim() || 'unknown';
}

function normalizeIdentifier(raw) {
  return String(raw || '').trim().toLowerCase().slice(0, 200);
}

function consumePublicAuthRateLimit({
  action = 'auth',
  ip = '',
  identifier = '',
  ipLimit = 20,
  identifierLimit = 10,
  ipWindowMs = DEFAULT_WINDOW_MS,
  identifierWindowMs = DEFAULT_WINDOW_MS,
  message = '请求过于频繁，请稍后再试',
} = {}) {
  const scope = String(action || 'auth').trim().toLowerCase() || 'auth';
  const remoteIp = normalizeIp(ip);
  const normalizedIdentifier = normalizeIdentifier(identifier);

  consumeRateLimit(`web:${scope}:ip:${remoteIp}`, {
    limit: ipLimit,
    windowMs: ipWindowMs,
    message,
  });

  if (normalizedIdentifier) {
    consumeRateLimit(`web:${scope}:identifier:${normalizedIdentifier}`, {
      limit: identifierLimit,
      windowMs: identifierWindowMs,
      message,
    });
  }

  return {
    action: scope,
    ip: remoteIp,
    identifier: normalizedIdentifier,
  };
}

module.exports = {
  DEFAULT_WINDOW_MS,
  RateLimitError,
  normalizeIdentifier,
  normalizeIp,
  consumePublicAuthRateLimit,
};
