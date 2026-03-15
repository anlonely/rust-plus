const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isSafeExternalUrl,
  toSafeExternalUrl,
  maskSecret,
  escapeXmlText,
  redactSensitiveText,
} = require('../src/utils/security');

test('isSafeExternalUrl: allow https and block dangerous schemes', () => {
  assert.equal(isSafeExternalUrl('https://example.com/a?b=1'), true);
  assert.equal(isSafeExternalUrl('http://example.com/a?b=1'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false);
});

test('isSafeExternalUrl: host allowlist works', () => {
  assert.equal(isSafeExternalUrl('https://api.rustplus.cn/ok', { allowedHosts: ['rustplus.cn'] }), true);
  assert.equal(isSafeExternalUrl('https://evil.example.com', { allowedHosts: ['rustplus.cn'] }), false);
});

test('toSafeExternalUrl: normalize valid https and reject invalid', () => {
  assert.equal(toSafeExternalUrl('https://example.com/path')?.startsWith('https://example.com/path'), true);
  assert.equal(toSafeExternalUrl('data:text/html,abc'), null);
});

test('maskSecret: keep head/tail and hide middle', () => {
  const masked = maskSecret('abcdef1234567890', { visible: 3 });
  assert.equal(masked.startsWith('abc'), true);
  assert.equal(masked.endsWith('890'), true);
  assert.equal(masked.includes('***'), true);
});

test('escapeXmlText: escape all xml special chars', () => {
  assert.equal(
    escapeXmlText(`A&B<'">`),
    'A&amp;B&lt;&apos;&quot;&gt;',
  );
});

test('redactSensitiveText: redact pairing and auth tokens', () => {
  const raw = `playerToken:'-1234567' rustplus_auth_token='abc.def.ghi' Authorization: Basic YWJjOjEyMw==`;
  const safe = redactSensitiveText(raw);
  assert.equal(safe.includes('-1234567'), false);
  assert.equal(safe.includes('abc.def.ghi'), false);
  assert.equal(safe.includes('YWJjOjEyMw=='), false);
});
