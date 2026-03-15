const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSteamId64 } = require('../src/utils/steam-id');

test('normalizeSteamId64: supports string/number/bigint', () => {
  assert.equal(normalizeSteamId64(' 76561198000000000 '), '76561198000000000');
  assert.equal(normalizeSteamId64(76561198000000000), '76561198000000000');
  assert.equal(normalizeSteamId64(76561198000000000n), '76561198000000000');
});

test('normalizeSteamId64: supports long-like objects (low/high)', () => {
  const value = { low: 0x89abcdef, high: 0x01234567 };
  const expected = ((BigInt(value.high >>> 0) << 32n) | BigInt(value.low >>> 0)).toString();
  assert.equal(normalizeSteamId64(value), expected);
});

test('normalizeSteamId64: supports nested value wrappers', () => {
  const nested = { value: { low: 1, high: 2 } };
  const expected = ((2n << 32n) | 1n).toString();
  assert.equal(normalizeSteamId64(nested), expected);
});

test('normalizeSteamId64: returns empty string for invalid inputs', () => {
  assert.equal(normalizeSteamId64(null), '');
  assert.equal(normalizeSteamId64(undefined), '');
  assert.equal(normalizeSteamId64({}), '');
});
