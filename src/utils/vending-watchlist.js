const { getItemById } = require('./item-catalog');

function getVendingItemLabel(itemId, { isBlueprint = false } = {}) {
  const key = String(itemId || '').trim();
  const item = getItemById(key);
  let label = String(item?.nameZh || item?.nameEn || item?.shortName || key).trim();
  if (isBlueprint && !/蓝图|blueprint/i.test(label)) {
    label = `${label}蓝图`;
  }
  return label;
}

function isVendingOrderInStock(order = {}, marker = {}) {
  if (marker?.outOfStock === true) return false;
  if (order?.amountInStock == null) return true;
  const stock = Number(order.amountInStock);
  if (!Number.isFinite(stock)) return true;
  return stock > 0;
}

function buildVendingOrderKey(order = {}) {
  return [
    String(order?.itemId ?? ''),
    order?.itemIsBlueprint === true ? '1' : '0',
    String(Math.max(1, Number(order?.quantity) || 1)),
    String(order?.currencyId ?? ''),
    order?.currencyIsBlueprint === true ? '1' : '0',
    String(Math.max(0, Number(order?.costPerItem) || 0)),
  ].join('|');
}

function formatVendingOfferLabel(order = {}) {
  const soldId = Number(order?.itemId);
  const currencyId = Number(order?.currencyId);
  if (!Number.isFinite(soldId)) return '';
  const quantity = Math.max(1, Number(order?.quantity) || 1);
  const price = Math.max(0, Number(order?.costPerItem) || 0);
  const soldLabel = `${getVendingItemLabel(soldId, { isBlueprint: order?.itemIsBlueprint === true })}x${quantity}`;
  if (!Number.isFinite(currencyId)) {
    return `[${soldLabel}]`;
  }
  const currencyLabel = getVendingItemLabel(currencyId, { isBlueprint: order?.currencyIsBlueprint === true });
  return `[${soldLabel}] - [${currencyLabel}]*${price}`;
}

function countChars(text) {
  return Array.from(String(text || '')).length;
}

function packVendingOfferLines(items = [], { maxChars = 96, separator = ' ｜' } = {}) {
  const limit = Math.max(16, Number(maxChars) || 96);
  const lines = [];
  let current = '';
  for (const raw of Array.isArray(items) ? items : []) {
    const item = String(raw || '').trim();
    if (!item) continue;
    const candidate = current ? `${current}${separator}${item}` : item;
    if (current && countChars(candidate) > limit) {
      lines.push(current);
      current = item;
      continue;
    }
    current = candidate;
  }
  if (current) lines.push(current);
  return lines;
}

function pickVendingWatchMatches(sellOrders = [], marker = {}) {
  const ids = [];
  const names = [];
  const keys = [];
  const seen = new Set();
  const orders = Array.isArray(sellOrders) ? sellOrders : [];
  for (const order of orders) {
    if (!isVendingOrderInStock(order, marker)) continue;
    const soldId = Number(order?.itemId);
    if (!Number.isFinite(soldId)) continue;
    const key = buildVendingOrderKey(order);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = formatVendingOfferLabel(order);
    ids.push(String(soldId));
    keys.push(key);
    names.push(label);
  }
  return { ids, keys, names };
}

module.exports = {
  buildVendingOrderKey,
  formatVendingOfferLabel,
  getVendingItemLabel,
  isVendingOrderInStock,
  packVendingOfferLines,
  pickVendingWatchMatches,
};
