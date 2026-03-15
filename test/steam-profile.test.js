const test = require('node:test');
const assert = require('node:assert/strict');

const { decodeRustplusToken } = require('../src/steam/profile');

test('decodeRustplusToken: parses Rust+ payload.signature token', () => {
  const payload = {
    steamId: '76561199886302710',
    version: 0,
    iss: 1772375440,
    exp: 1773585040,
  };
  const token = `${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}.signature`;
  const decoded = decodeRustplusToken(token);
  assert.equal(decoded?.steamId, payload.steamId);
  assert.equal(decoded?.version, payload.version);
});

test('decodeRustplusToken: parses JWT-like header.payload.signature token', () => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { steamId: '76561198000000000', exp: 1893456000 };
  const token = [
    Buffer.from(JSON.stringify(header), 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    'signature',
  ].join('.');
  const decoded = decodeRustplusToken(token);
  assert.equal(decoded?.steamId, payload.steamId);
  assert.equal(decoded?.exp, payload.exp);
});

test('decodeRustplusToken: returns null for invalid token', () => {
  assert.equal(decodeRustplusToken('invalid-token'), null);
  assert.equal(decodeRustplusToken('a.b'), null);
  assert.equal(decodeRustplusToken(''), null);
});
