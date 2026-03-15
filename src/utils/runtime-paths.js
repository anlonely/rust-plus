const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_APP_NAME = 'Rust 工具箱';

function isPackagedRuntime() {
  if (process.env.RUST_PLUS_FORCE_RUNTIME_DIR === '1') return true;
  if (process.defaultApp) return false;
  if (String(__dirname).includes('app.asar')) return true;
  const execPath = String(process.execPath || '');
  return execPath.endsWith('.app/Contents/MacOS/Electron') ? false : execPath.includes('.app/Contents/MacOS/');
}

function getAppName() {
  return process.env.RUST_PLUS_APP_NAME || process.env.npm_package_productName || DEFAULT_APP_NAME;
}

function getWritableBaseDir() {
  const custom = String(process.env.RUST_PLUS_DATA_DIR || '').trim();
  if (custom) return custom;
  if (!isPackagedRuntime()) return PROJECT_ROOT;

  const appName = getAppName();
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appName);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function getConfigDir() {
  return ensureDir(path.join(getWritableBaseDir(), 'config'));
}

function getLogsDir() {
  return ensureDir(path.join(getWritableBaseDir(), 'logs'));
}

module.exports = {
  PROJECT_ROOT,
  getWritableBaseDir,
  getConfigDir,
  getLogsDir,
  isPackagedRuntime,
};
