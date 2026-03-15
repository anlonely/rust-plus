const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtimePaths = require('../src/utils/runtime-paths');

function restoreEnv(key, value) {
  if (value == null) delete process.env[key];
  else process.env[key] = value;
}

test('runtime-paths: development mode uses project directories', () => {
  const prevForce = process.env.RUST_PLUS_FORCE_RUNTIME_DIR;
  const prevDataDir = process.env.RUST_PLUS_DATA_DIR;
  delete process.env.RUST_PLUS_FORCE_RUNTIME_DIR;
  delete process.env.RUST_PLUS_DATA_DIR;

  assert.equal(runtimePaths.isPackagedRuntime(), false);
  assert.equal(runtimePaths.getConfigDir(), path.join(runtimePaths.PROJECT_ROOT, 'config'));
  assert.equal(runtimePaths.getLogsDir(), path.join(runtimePaths.PROJECT_ROOT, 'logs'));

  restoreEnv('RUST_PLUS_FORCE_RUNTIME_DIR', prevForce);
  restoreEnv('RUST_PLUS_DATA_DIR', prevDataDir);
});

test('runtime-paths: packaged mode uses writable user data override', () => {
  const prevForce = process.env.RUST_PLUS_FORCE_RUNTIME_DIR;
  const prevDataDir = process.env.RUST_PLUS_DATA_DIR;
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-plus-runtime-'));

  process.env.RUST_PLUS_FORCE_RUNTIME_DIR = '1';
  process.env.RUST_PLUS_DATA_DIR = tempBase;

  assert.equal(runtimePaths.isPackagedRuntime(), true);
  assert.equal(runtimePaths.getConfigDir(), path.join(tempBase, 'config'));
  assert.equal(runtimePaths.getLogsDir(), path.join(tempBase, 'logs'));
  assert.equal(fs.existsSync(path.join(tempBase, 'config')), true);
  assert.equal(fs.existsSync(path.join(tempBase, 'logs')), true);

  restoreEnv('RUST_PLUS_FORCE_RUNTIME_DIR', prevForce);
  restoreEnv('RUST_PLUS_DATA_DIR', prevDataDir);
});
