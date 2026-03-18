const { getConfigDir } = require('../utils/runtime-paths');
const { createConfigStore } = require('./create-config-store');

const defaultStore = createConfigStore({ configDir: getConfigDir() });

module.exports = {
  createConfigStore,
  ...defaultStore,
};
