#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.resolve(__dirname, '../../config/item-catalog.json');
const OUTPUT_DIR = path.resolve(__dirname, '../../assets/item-icons');
const CONCURRENCY = Math.max(1, Number(process.env.ITEM_ICON_CONCURRENCY || 10));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.ITEM_ICON_TIMEOUT_MS || 20000));
const RETRY = Math.max(0, Number(process.env.ITEM_ICON_RETRY || 1));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadItems() {
  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return items
    .map((item) => ({
      id: Number(item?.id),
      shortName: String(item?.shortName || '').trim(),
      iconUrl: String(item?.iconUrl || '').trim(),
    }))
    .filter((item) => Number.isFinite(item.id) && item.shortName);
}

function buildRemoteIconUrl(item) {
  if (item.iconUrl) return item.iconUrl;
  return `https://cdn.rusthelp.com/images/public/${encodeURIComponent(item.shortName)}.png`;
}

function getIconPath(itemId) {
  return path.join(OUTPUT_DIR, `${itemId}.png`);
}

function fileLooksValid(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 1024;
  } catch (_) {
    return false;
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadOne(item) {
  const iconPath = getIconPath(item.id);
  if (fileLooksValid(iconPath)) return { ok: true, skipped: true };
  const iconUrl = buildRemoteIconUrl(item);
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRY; attempt += 1) {
    try {
      const buf = await fetchWithTimeout(iconUrl, REQUEST_TIMEOUT_MS);
      const tmp = `${iconPath}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, iconPath);
      return { ok: true, skipped: false };
    } catch (e) {
      lastErr = e;
      await sleep(300 * (attempt + 1));
    }
  }
  return { ok: false, skipped: false, error: lastErr?.message || 'download_failed' };
}

async function runPool(items, workerCount) {
  let index = 0;
  const stats = {
    total: items.length,
    downloaded: 0,
    skipped: 0,
    failed: 0,
  };
  const failed = [];

  async function worker() {
    while (true) {
      const i = index;
      index += 1;
      if (i >= items.length) return;
      const item = items[i];
      const res = await downloadOne(item);
      if (res.ok && res.skipped) stats.skipped += 1;
      else if (res.ok) stats.downloaded += 1;
      else {
        stats.failed += 1;
        failed.push({
          id: item.id,
          shortName: item.shortName,
          error: res.error || 'unknown',
        });
      }
      const done = stats.downloaded + stats.skipped + stats.failed;
      if (done % 50 === 0 || done === stats.total) {
        process.stdout.write(
          `[item-icons] ${done}/${stats.total} downloaded=${stats.downloaded} skipped=${stats.skipped} failed=${stats.failed}\n`,
        );
      }
    }
  }

  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return { stats, failed };
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const items = loadItems();
  if (!items.length) throw new Error('item catalog is empty');
  process.stdout.write(
    `[item-icons] start total=${items.length} concurrency=${CONCURRENCY} timeoutMs=${REQUEST_TIMEOUT_MS} retry=${RETRY}\n`,
  );
  const { stats, failed } = await runPool(items, CONCURRENCY);
  process.stdout.write(
    `[item-icons] done total=${stats.total} downloaded=${stats.downloaded} skipped=${stats.skipped} failed=${stats.failed}\n`,
  );
  if (failed.length) {
    const failPath = path.resolve(__dirname, '../../logs/item-icons-failed.json');
    fs.mkdirSync(path.dirname(failPath), { recursive: true });
    fs.writeFileSync(failPath, JSON.stringify(failed, null, 2), 'utf8');
    process.stdout.write(`[item-icons] failed list written: ${failPath}\n`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  process.stderr.write(`[item-icons] failed: ${e.message}\n`);
  process.exit(1);
});
