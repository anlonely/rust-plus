const { getItemById } = require('./item-catalog');

// 新售货机出现事件：默认只关注这些物品上架
const VENDING_NEW_WATCH_ITEMS = Object.freeze([
  { id: -1607980696, name: '三级工作台' },
  { id: -41896755, name: '二级工作台' },
  { id: -143481979, name: '基础蓝图碎片' },
  { id: -1896395719, name: '高级蓝图碎片' },
  { id: -1581843485, name: '硫磺' },
  { id: -1157596551, name: '硫磺矿石' },
  { id: -742865266, name: '火箭弹' },
  { id: -592016202, name: '炸药' },
  { id: -265876753, name: '火药' },
  { id: 1545779598, name: 'AK-47突击步枪' },
  { id: -2069578888, name: 'M249' },
  { id: -778367295, name: 'L96狙击步枪' },
  { id: 317398316, name: '高级金属' },
  { id: 69511070, name: '金属碎片' },
  { id: -4031221, name: '金属矿石' },
  { id: -1982036270, name: '高级金属矿石' },
]);

const VENDING_NEW_WATCH_ITEM_IDS = Object.freeze(
  VENDING_NEW_WATCH_ITEMS.map((item) => Number(item.id)).filter((id) => Number.isFinite(id))
);

const VENDING_NEW_WATCH_ITEM_NAMES = Object.freeze(
  VENDING_NEW_WATCH_ITEMS.map((item) => String(item.name || '').trim()).filter(Boolean)
);

const VENDING_NEW_WATCH_ITEM_ID_SET = new Set(VENDING_NEW_WATCH_ITEM_IDS.map((id) => String(id)));
const VENDING_NEW_WATCH_ITEM_NAME_BY_ID = new Map(
  VENDING_NEW_WATCH_ITEMS.map((item) => [String(item.id), item.name])
);

function getVendingWatchNameById(itemId) {
  const key = String(itemId);
  const fixedName = VENDING_NEW_WATCH_ITEM_NAME_BY_ID.get(key);
  if (fixedName) return fixedName;
  const item = getItemById(itemId);
  return item?.nameZh || item?.nameEn || item?.shortName || key;
}

function pickVendingWatchMatches(sellOrders = []) {
  const ids = [];
  const names = [];
  const seen = new Set();
  const orders = Array.isArray(sellOrders) ? sellOrders : [];
  for (const order of orders) {
    const soldId = Number(order?.itemId);
    if (!Number.isFinite(soldId)) continue;
    const key = String(soldId);
    if (!VENDING_NEW_WATCH_ITEM_ID_SET.has(key) || seen.has(key)) continue;
    seen.add(key);
    ids.push(key);
    names.push(getVendingWatchNameById(soldId));
  }
  return { ids, names };
}

module.exports = {
  VENDING_NEW_WATCH_ITEMS,
  VENDING_NEW_WATCH_ITEM_IDS,
  VENDING_NEW_WATCH_ITEM_NAMES,
  VENDING_NEW_WATCH_ITEM_ID_SET,
  getVendingWatchNameById,
  pickVendingWatchMatches,
};
