const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isDeprecatedCommandRule,
  applyPersistedCommandRules,
} = require('../web/runtime-sync');

test('web-runtime-sync: identifies deprecated keywords/types', () => {
  assert.equal(isDeprecatedCommandRule({ keyword: 'dw' }), true);
  assert.equal(isDeprecatedCommandRule({ type: 'team_info' }), true);
  assert.equal(isDeprecatedCommandRule({ keyword: 'ai' }), false);
});

test('web-runtime-sync: applies persisted rules to parser and removes deprecated ones', async () => {
  const removed = [];
  const setRules = [];
  const toggled = [];
  const parser = {
    setCommandRule(rule) {
      setRules.push(rule);
      return true;
    },
    setCommandEnabled(keyword, enabled) {
      toggled.push({ keyword, enabled });
      return true;
    },
  };

  await applyPersistedCommandRules({
    parser,
    persistedRules: [
      { keyword: 'dw', enabled: true },
      { keyword: 'mycmd', type: 'translate', name: '翻译', enabled: true, meta: { promptPrefix: 'x' } },
      { keyword: 'fwq', enabled: false },
    ],
    removeRule: async (keyword) => {
      removed.push(keyword);
    },
  });

  assert.deepEqual(removed, ['dw']);
  assert.equal(setRules.length, 1);
  assert.equal(setRules[0].keyword, 'mycmd');
  assert.deepEqual(toggled, [{ keyword: 'fwq', enabled: false }]);
});

