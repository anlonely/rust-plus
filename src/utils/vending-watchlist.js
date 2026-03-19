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
  ].join('|');
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
    const quantity = Math.max(1, Number(order?.quantity) || 1);
    const label = `${getVendingItemLabel(soldId, { isBlueprint: order?.itemIsBlueprint === true })}x${quantity}`;
    ids.push(String(soldId));
    keys.push(key);
    names.push(label);
  }
  return { ids, keys, names };
}

module.exports = {
  buildVendingOrderKey,
  getVendingItemLabel,
  isVendingOrderInStock,
  pickVendingWatchMatches,
};
