const test = require('node:test');
const assert = require('node:assert/strict');

const CommandParser = require('../src/commands/parser');
const { markerToGrid9 } = require('../src/utils/map-grid');

test('shj: default query keeps all matched grids and groups payment methods by currency and price', async () => {
  const parser = new CommandParser();
  const mapSize = 4200;
  const markers = [
    {
      type: 3,
      x: 2705,
      y: 3905,
      outOfStock: false,
      sellOrders: [
        { itemId: -1896395719, quantity: 1, currencyId: -1581843485, costPerItem: 2000, amountInStock: 5 },
      ],
    },
    {
      type: 3,
      x: 2600,
      y: 3600,
      outOfStock: false,
      sellOrders: [
        { itemId: -1896395719, quantity: 1, currencyId: -1581843485, costPerItem: 1500, amountInStock: 5 },
      ],
    },
    {
      type: 3,
      x: 3200,
      y: 3200,
      outOfStock: false,
      sellOrders: [
        { itemId: -1896395719, quantity: 1, currencyId: 317398316, costPerItem: 3, amountInStock: 5 },
      ],
    },
    {
      type: 3,
      x: 1400,
      y: 2600,
      outOfStock: false,
      sellOrders: [
        { itemId: -1896395719, quantity: 1, currencyId: -1581843485, costPerItem: 2500, amountInStock: 5 },
      ],
    },
  ];
  const client = {
    getMapMarkers: async () => ({ mapMarkers: { markers } }),
    getServerInfo: async () => ({ info: { mapSize } }),
    getTime: async () => ({ time: {} }),
  };

  const gridA = String(markerToGrid9(markers[0], mapSize) || '').split('-')[0];
  const gridB = String(markerToGrid9(markers[1], mapSize) || '').split('-')[0];
  const gridC = String(markerToGrid9(markers[2], mapSize) || '').split('-')[0];
  const gridD = String(markerToGrid9(markers[3], mapSize) || '').split('-')[0];

  const result = await parser._commands.shj.handler(['高级蓝图碎片'], { client });
  const lines = result.split('\n');

  assert.equal(lines[0], `[${gridA} - ${gridB} - ${gridC} - ${gridD}]正在出售[高级蓝图碎片] 匹配物品:[高级蓝图碎片]`);
  assert.equal(lines[1], `${gridB}需要[硫磺]*1500 , ${gridA}需要[硫磺]*2000 , ${gridD}需要[硫磺]*2500`);
  assert.equal(lines[2], `其他支付:[${gridC}] - [高级金属]*3`);
  assert.equal(lines.length, 3);
});

test('shj: default query merges same-price sulfur grids into one bracketed segment', async () => {
  const parser = new CommandParser();
  const mapSize = 4200;
  const markers = [
    {
      type: 3,
      x: 2600,
      y: 3600,
      outOfStock: false,
      sellOrders: [
        { itemId: -1896395719, quantity: 1, currencyId: -1581843485, costPerItem: 900, amountInStock: 5 },
      ],
    },
    {
      type: 3,
      x: 2705,
      y: 3905,
      outOfStock: false,
      sellOrders: [
        { itemId: -1896395719, quantity: 1, currencyId: -1581843485, costPerItem: 900, amountInStock: 5 },
      ],
    },
    {
      type: 3,
      x: 1400,
      y: 2600,
      outOfStock: false,
      sellOrders: [
        { itemId: -1896395719, quantity: 1, currencyId: -1581843485, costPerItem: 1000, amountInStock: 5 },
      ],
    },
    {
      type: 3,
      x: 3200,
      y: 3200,
      outOfStock: false,
      sellOrders: [
        { itemId: -1896395719, quantity: 1, currencyId: 317398316, costPerItem: 40, amountInStock: 5 },
      ],
    },
  ];
  const client = {
    getMapMarkers: async () => ({ mapMarkers: { markers } }),
    getServerInfo: async () => ({ info: { mapSize } }),
    getTime: async () => ({ time: {} }),
  };

  const gridA = String(markerToGrid9(markers[0], mapSize) || '').split('-')[0];
  const gridB = String(markerToGrid9(markers[1], mapSize) || '').split('-')[0];
  const gridC = String(markerToGrid9(markers[2], mapSize) || '').split('-')[0];
  const gridD = String(markerToGrid9(markers[3], mapSize) || '').split('-')[0];

  const result = await parser._commands.shj.handler(['高级蓝图'], { client });
  const lines = result.split('\n');

  assert.equal(lines[0], `[${gridA} - ${gridB} - ${gridC} - ${gridD}]正在出售[高级蓝图] 匹配物品:[高级蓝图碎片]`);
  assert.equal(lines[1], `[${gridA} - ${gridB}]需要[硫磺]*900 , ${gridC}需要[硫磺]*1000`);
  assert.equal(lines[2], `其他支付:[${gridD}] - [高级金属]*40`);
  assert.equal(lines.length, 3);
});
