const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearModuleCache() {
  for (const mod of [
    '../src/utils/runtime-paths',
    '../src/auth/store',
  ]) {
    delete require.cache[require.resolve(mod)];
  }
}

function loadAuthStoreWithTempDir() {
  const previousDataDir = process.env.RUST_PLUS_DATA_DIR;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-plus-auth-store-'));
  process.env.RUST_PLUS_DATA_DIR = tmpRoot;
  clearModuleCache();
  const store = require('../src/auth/store');
  return {
    store,
    tmpRoot,
    restore() {
      if (previousDataDir == null) delete process.env.RUST_PLUS_DATA_DIR;
      else process.env.RUST_PLUS_DATA_DIR = previousDataDir;
      clearModuleCache();
    },
  };
}

function extractPassword(text = '') {
  const match = String(text || '').match(/password:\s*(.+)/i);
  return match ? match[1].trim() : '';
}

test('auth-store: recreates missing root credential file by rotating password', async () => {
  const { store, tmpRoot, restore } = loadAuthStoreWithTempDir();
  try {
    await store.initAuthStore();
    const firstText = await store.readRootCredentialFile();
    const firstPassword = extractPassword(firstText);

    assert.ok(firstPassword.length >= 12, 'first root password should be present');
    const firstLogin = await store.authenticateUser({
      identifier: 'root',
      password: firstPassword,
      requireRoot: true,
    });
    assert.equal(firstLogin.role, 'root');

    fs.rmSync(store.ROOT_CREDENTIAL_FILE, { force: true });
    await store.initAuthStore();

    const secondText = await store.readRootCredentialFile();
    const secondPassword = extractPassword(secondText);

    assert.ok(secondPassword.length >= 12, 'rotated root password should be recreated');
    assert.notEqual(secondPassword, firstPassword);

    await assert.rejects(() => store.authenticateUser({
      identifier: 'root',
      password: firstPassword,
      requireRoot: true,
    }), /账号或密码错误/);

    const secondLogin = await store.authenticateUser({
      identifier: 'root',
      password: secondPassword,
      requireRoot: true,
    });
    assert.equal(secondLogin.role, 'root');
  } finally {
    restore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
