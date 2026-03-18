const test = require('node:test');
const assert = require('node:assert/strict');

const {
  consumePublicAuthRateLimit,
  RateLimitError,
  normalizeIdentifier,
  normalizeIp,
} = require('../src/auth/http-rate-limit');

test('normalize helpers trim and sanitize inputs', () => {
  assert.equal(normalizeIp('1.2.3.4, 5.6.7.8'), '1.2.3.4');
  assert.equal(normalizeIdentifier('  USER@Example.COM  '), 'user@example.com');
});

test('consumePublicAuthRateLimit enforces identifier bucket independently', () => {
  const action = `login-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const identifier = 'target@example.com';

  consumePublicAuthRateLimit({
    action,
    ip: '10.0.0.1',
    identifier,
    ipLimit: 10,
    identifierLimit: 2,
    ipWindowMs: 60_000,
    identifierWindowMs: 60_000,
  });
  consumePublicAuthRateLimit({
    action,
    ip: '10.0.0.2',
    identifier,
    ipLimit: 10,
    identifierLimit: 2,
    ipWindowMs: 60_000,
    identifierWindowMs: 60_000,
  });

  assert.throws(() => {
    consumePublicAuthRateLimit({
      action,
      ip: '10.0.0.3',
      identifier,
      ipLimit: 10,
      identifierLimit: 2,
      ipWindowMs: 60_000,
      identifierWindowMs: 60_000,
      message: 'too many',
    });
  }, (err) => err instanceof RateLimitError && err.message === 'too many');
});
