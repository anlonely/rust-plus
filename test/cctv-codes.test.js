const test = require('node:test');
const assert = require('node:assert/strict');

const { loadCctvCodes, matchCctvEntries } = require('../src/utils/cctv-codes');

test('cctv-codes: loads local manual CCTV dataset', () => {
  const data = loadCctvCodes();
  assert.equal(Array.isArray(data.entries), true);
  assert.equal(data.entries.length, 10);
});

test('cctv-codes: fuzzy match resolves Chinese monument aliases', () => {
  const matches = matchCctvEntries('强盗');
  assert.equal(matches[0].slug, 'bandit-camp');
  assert.equal(matches[0].codes[0].id, 'CASINO');
  assert.equal(matches[0].codes[0].location, '强盗营地赌场');
  assert.equal(matches[0].codes[1].id, 'TOWNWEAPONS');
});

test('cctv-codes: cargo aliases resolve cargo ship cameras', () => {
  const matches = matchCctvEntries('货轮');
  assert.equal(matches[0].slug, 'cargo-ship');
  assert.equal(matches[0].codes[0].id, 'CARGODECK');
  assert.equal(matches[0].codes[0].location, '前甲板');
});
