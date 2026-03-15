#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const EN_ITEMS_URL = 'https://rusthelp.com/downloads/admin-item-list-public.json';
const ZH_ITEMS_PAGE_URL = 'https://rusthelp.com/zh-Hans/tools/admin/item-list';
const OUTPUT_PATH = path.resolve(__dirname, '../../config/item-catalog.json');

function decodeHtml(value = '') {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  return res.text();
}

function parseZhRows(html) {
  const rows = [];
  const re = /<h3>([^<]+)<\/h3>[\s\S]*?text-nowrap">([^<]+)<button[\s\S]*?text-nowrap">(-?\d+)<button/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const nameZh = decodeHtml(m[1]).trim();
    const shortName = decodeHtml(m[2]).trim();
    const id = Number(m[3]);
    if (!nameZh || !shortName || !Number.isFinite(id)) continue;
    rows.push({ id, shortName, nameZh });
  }
  return rows;
}

function buildCatalog(enItems, zhRows) {
  const zhById = new Map();
  const zhByShortName = new Map();
  for (const row of zhRows) {
    zhById.set(row.id, row.nameZh);
    if (!zhByShortName.has(row.shortName)) zhByShortName.set(row.shortName, row.nameZh);
  }

  const merged = [];
  let zhMatched = 0;
  for (const item of enItems) {
    const id = Number(item?.id);
    const shortName = String(item?.shortName || '').trim();
    const nameEn = String(item?.displayName || '').trim();
    if (!Number.isFinite(id) || !shortName || !nameEn) continue;
    const nameZh = zhById.get(id) || zhByShortName.get(shortName) || '';
    if (nameZh) zhMatched += 1;
    merged.push({ id, shortName, nameEn, nameZh });
  }

  return {
    meta: {
      source: {
        enItemsUrl: EN_ITEMS_URL,
        zhItemsPageUrl: ZH_ITEMS_PAGE_URL,
      },
      generatedAt: new Date().toISOString(),
      counts: {
        enItems: enItems.length,
        zhRows: zhRows.length,
        mergedItems: merged.length,
        zhMatchedItems: zhMatched,
      },
    },
    items: merged,
  };
}

async function main() {
  const [enItemsRaw, zhHtml] = await Promise.all([
    fetchJson(EN_ITEMS_URL),
    fetchText(ZH_ITEMS_PAGE_URL),
  ]);
  const enItems = Array.isArray(enItemsRaw) ? enItemsRaw : [];
  const zhRows = parseZhRows(zhHtml);
  const catalog = buildCatalog(enItems, zhRows);

  if (!catalog.items.length) throw new Error('catalog is empty');
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(catalog, null, 2), 'utf8');
  process.stdout.write(
    `item catalog written: ${OUTPUT_PATH}\n` +
    `en=${catalog.meta.counts.enItems} zh=${catalog.meta.counts.zhRows} merged=${catalog.meta.counts.mergedItems} zhMatched=${catalog.meta.counts.zhMatchedItems}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`failed: ${err.message}\n`);
  process.exit(1);
});
