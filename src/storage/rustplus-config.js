const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('../utils/runtime-paths');

function createRustplusConfigStore({ configFile } = {}) {
  const filePath = String(configFile || '').trim() || path.join(getConfigDir(), 'rustplus.config.json');
  let writeQueue = Promise.resolve();

  function read() {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
      return {};
    }
  }

  async function write(nextConfig = {}) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(nextConfig || {}, null, 2), 'utf8');
    await fs.promises.rename(tmp, filePath);
    return nextConfig;
  }

  async function patch(patchData = {}) {
    const run = async () => {
      const current = read();
      const next = { ...current, ...patchData };
      await write(next);
      return next;
    };
    const pending = writeQueue.then(run, run);
    writeQueue = pending.catch(() => {});
    return pending;
  }

  return {
    filePath,
    read,
    write,
    patch,
  };
}

const defaultStore = createRustplusConfigStore();

module.exports = {
  createRustplusConfigStore,
  readRustplusConfig: defaultStore.read,
  writeRustplusConfig: defaultStore.write,
  patchRustplusConfig: defaultStore.patch,
  RUSTPLUS_CONFIG_FILE: defaultStore.filePath,
};
