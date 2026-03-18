const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearModuleCache() {
  for (const mod of [
    '../src/utils/runtime-paths',
    '../src/storage/create-config-store',
    '../src/storage/config',
    '../src/auth/user-workspace',
  ]) {
    delete require.cache[require.resolve(mod)];
  }
}

function loadModulesWithTempDir() {
  const previousDataDir = process.env.RUST_PLUS_DATA_DIR;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-plus-web-workspace-'));
  process.env.RUST_PLUS_DATA_DIR = tmpRoot;
  clearModuleCache();
  const config = require('../src/storage/config');
  const workspace = require('../src/auth/user-workspace');
  return {
    config,
    workspace,
    tmpRoot,
    restore() {
      if (previousDataDir == null) delete process.env.RUST_PLUS_DATA_DIR;
      else process.env.RUST_PLUS_DATA_DIR = previousDataDir;
      clearModuleCache();
    },
  };
}

test('web workspaces isolate per-user config stores and cleanup data independently', async () => {
  const { config, workspace, tmpRoot, restore } = loadModulesWithTempDir();
  try {
    const userA = 'user:a@example.com';
    const userB = 'user:b@example.com';
    const storeA = config.createConfigStore({ configDir: workspace.getWebUserConfigDir(userA) });
    const storeB = config.createConfigStore({ configDir: workspace.getWebUserConfigDir(userB) });

    await storeA.initDbs();
    await storeB.initDbs();

    const savedA = await storeA.saveServer({
      name: 'Server A',
      ip: '1.2.3.4',
      port: 28082,
      playerId: 'steam-a',
      playerToken: 'token-a',
    });
    await storeA.saveCommandRule({
      id: 'cmd_a',
      keyword: 'help',
      serverId: savedA.id,
      enabled: true,
      meta: { doChat: true, actions: [{ type: 'team_chat' }] },
      trigger: { cooldownMs: 3000 },
    });

    assert.equal((await storeA.listServers()).length, 1);
    assert.equal((await storeA.listCommandRules(savedA.id)).length, 1);
    assert.equal((await storeB.listServers()).length, 0);
    assert.equal((await storeB.listCommandRules()).length, 0);

    fs.mkdirSync(path.dirname(workspace.getWebUserRustplusConfigFile(userA)), { recursive: true });
    fs.writeFileSync(workspace.getWebUserRustplusConfigFile(userA), '{"token":"abc"}', 'utf8');
    assert.equal(fs.existsSync(workspace.getWebUserRustplusConfigFile(userA)), true);

    await workspace.removeWebUserWorkspace(userA);

    assert.equal(fs.existsSync(workspace.getWebUserConfigDir(userA)), false);
    assert.equal(fs.existsSync(workspace.getWebUserConfigDir(userB)), true);
    assert.equal((await storeB.listServers()).length, 0);
  } finally {
    restore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
