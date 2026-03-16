const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadConfigWithTempDir() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-plus-config-test-'));
  process.env.RUST_PLUS_DATA_DIR = tmpRoot;
  const runtimePath = require.resolve('../src/utils/runtime-paths');
  const configPath = require.resolve('../src/storage/config');
  delete require.cache[runtimePath];
  delete require.cache[configPath];
  const mod = require('../src/storage/config');
  return { mod, tmpRoot };
}

test('config: concurrent saveCommandRule writes do not lose records', async () => {
  const { mod, tmpRoot } = loadConfigWithTempDir();
  try {
    await mod.initDbs();
    const serverId = 'server_concurrency';
    await Promise.all(Array.from({ length: 20 }, (_, i) => mod.saveCommandRule({
      id: `rule_${i}`,
      keyword: `rule_${i}`,
      serverId,
      enabled: i % 2 === 0,
      meta: { doChat: true, actions: [{ type: 'team_chat' }] },
      trigger: { cooldownMs: 3000 },
    })));
    const rules = await mod.listCommandRules(serverId);
    assert.equal(rules.length, 20);
    assert.equal(new Set(rules.map((rule) => rule.id)).size, 20);
  } finally {
    delete process.env.RUST_PLUS_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
