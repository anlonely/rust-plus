const test = require('node:test');
const assert = require('node:assert/strict');

const CommandParser = require('../src/commands/parser');
const { markerToGrid9 } = require('../src/utils/map-grid');

test('shj: currency query groups same-price grids and formats alternate payments', async () => {
  const parser = new CommandParser();
  const mapSize = 4200;
  const matchedMarkerA = {
    type: 3,
    x: 2705,
    y: 3905,
    outOfStock: false,
    sellOrders: [
      { itemId: 1001, quantity: 1, currencyId: 2001, costPerItem: 900, amountInStock: 5 },
      { itemId: 1001, quantity: 1, currencyId: 3001, costPerItem: 1, amountInStock: 5 },
    ],
  };
  const matchedMarkerB = {
    type: 3,
    x: 2600,
    y: 3600,
    outOfStock: false,
    sellOrders: [
      { itemId: 1001, quantity: 1, currencyId: 2001, costPerItem: 600, amountInStock: 5 },
    ],
  };
  const matchedMarkerC = {
    type: 3,
    x: 3200,
    y: 3200,
    outOfStock: false,
    sellOrders: [
      { itemId: 1001, quantity: 1, currencyId: 2001, costPerItem: 900, amountInStock: 5 },
      { itemId: 1001, quantity: 1, currencyId: 4001, costPerItem: 30, amountInStock: 5 },
    ],
  };
  const matchedMarkerD = {
    type: 3,
    x: 1400,
    y: 2600,
    outOfStock: false,
    sellOrders: [
      { itemId: 1001, quantity: 1, currencyId: 2001, costPerItem: 1200, amountInStock: 0 },
    ],
  };
  const altMarker = {
    type: 3,
    x: 3305,
    y: 1450,
    outOfStock: false,
    sellOrders: [
      { itemId: 1001, quantity: 1, currencyId: 5001, costPerItem: 100, amountInStock: 2 },
    ],
  };
  const client = {
    getMapMarkers: async () => ({ mapMarkers: { markers: [matchedMarkerA, matchedMarkerB, matchedMarkerC, matchedMarkerD, altMarker] } }),
    getServerInfo: async () => ({ info: { mapSize } }),
    getTime: async () => ({ time: {} }),
  };

  const primaryGridA = String(markerToGrid9(matchedMarkerA, mapSize, { gridXOffset: 0, gridYOffset: 0 }) || '').split('-')[0];
  const primaryGridB = String(markerToGrid9(matchedMarkerB, mapSize, { gridXOffset: 0, gridYOffset: 0 }) || '').split('-')[0];
  const primaryGridC = String(markerToGrid9(matchedMarkerC, mapSize, { gridXOffset: 0, gridYOffset: 0 }) || '').split('-')[0];
  const primaryGridD = String(markerToGrid9(matchedMarkerD, mapSize, { gridXOffset: 0, gridYOffset: 0 }) || '').split('-')[0];
  const altGrid1 = primaryGridA;
  const altGrid2 = primaryGridC;
  const altGrid3 = String(markerToGrid9(altMarker, mapSize, { gridXOffset: 0, gridYOffset: 0 }) || '').split('-')[0];

  const result = await parser._commands.shj.handler(['itemId:1001/itemId:2001'], { client });
  const lines = result.split('\n');

  assert.equal(lines[0], `[${primaryGridB} - ${primaryGridA} - ${primaryGridC}]正在出售[itemId:1001/itemId:2001]`);
  assert.equal(lines[1], `[${primaryGridB}]需要[itemId:2001]*600 , [${primaryGridA} - ${primaryGridC}]需要[itemId:2001]*900`);
  assert.equal(lines[2], `其他支付:[${altGrid1}] - [itemId:3001]*1  |  [${altGrid2}] - [itemId:4001]*30  |  [${altGrid3}] - [itemId:5001]*100`);
  assert.equal(lines.length, 3);
  assert.ok(!result.includes(primaryGridD));
});

test('shj: filters sold-out orders from all query modes', async () => {
  const parser = new CommandParser();
  const mapSize = 4200;
  const activeMarker = {
    type: 3,
    x: 2600,
    y: 3600,
    outOfStock: false,
    sellOrders: [
      { itemId: 1001, quantity: 1, currencyId: 2001, costPerItem: 600, amountInStock: 2 },
    ],
  };
  const soldOutOrderMarker = {
    type: 3,
    x: 2705,
    y: 3905,
    outOfStock: false,
    sellOrders: [
      { itemId: 1001, quantity: 1, currencyId: 2001, costPerItem: 500, amountInStock: 0 },
    ],
  };
  const soldOutMarker = {
    type: 3,
    x: 3200,
    y: 3200,
    outOfStock: true,
    sellOrders: [
      { itemId: 1001, quantity: 1, currencyId: 2001, costPerItem: 400, amountInStock: 5 },
    ],
  };
  const client = {
    getMapMarkers: async () => ({ mapMarkers: { markers: [activeMarker, soldOutOrderMarker, soldOutMarker] } }),
    getServerInfo: async () => ({ info: { mapSize } }),
    getTime: async () => ({ time: {} }),
  };

  const activeGrid = String(markerToGrid9(activeMarker, mapSize, { gridXOffset: 0, gridYOffset: 0 }) || '').split('-')[0];
  const soldOutGrid = String(markerToGrid9(soldOutOrderMarker, mapSize, { gridXOffset: 0, gridYOffset: 0 }) || '').split('-')[0];

  const result = await parser._commands.shj.handler(['itemId:1001/itemId:2001'], { client });

  assert.match(result, new RegExp(`\\[${activeGrid}\\]正在出售\\[itemId:1001/itemId:2001\\]`));
  assert.ok(!result.includes(soldOutGrid));
});

test('shj: legacy item resolution ignores currency suffix after slash', async () => {
  const parser = new CommandParser();
  const resolved = parser._resolveVendingItems('高级蓝图/硫磺');

  assert.ok(resolved.itemIds.length > 0);
  assert.ok([...resolved.itemsById.values()].some((item) => String(item?.nameZh || '').includes('高级蓝图碎片')));
});
