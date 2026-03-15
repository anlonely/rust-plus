const test = require('node:test');
const assert = require('node:assert/strict');

const CommandParser = require('../src/commands/parser');
const { markerToGrid9 } = require('../src/utils/map-grid');

test('shj: uses dedicated x/y offsets for vending coordinate output', async () => {
  const parser = new CommandParser();
  const marker = {
    type: 3,
    x: 2705,
    y: 3905,
    outOfStock: false,
    sellOrders: [{ itemId: 317398316, amountInStock: 1 }],
  };
  const mapSize = 4200;
  const client = {
    getMapMarkers: async () => ({ mapMarkers: { markers: [marker] } }),
    getServerInfo: async () => ({ info: { mapSize } }),
    getTime: async () => ({ time: {} }),
  };

  const defaultGrid = String(markerToGrid9(marker, mapSize) || '').split('-')[0];
  const shjGrid = String(markerToGrid9(marker, mapSize, {
    gridXOffset: 0,
    gridYOffset: 0,
  }) || '').split('-')[0];
  assert.notEqual(defaultGrid, shjGrid);

  const result = await parser._commands.shj.handler(['itemId:317398316'], { client });
  assert.match(result, new RegExp(`\\[${shjGrid}\\]`));
  assert.ok(!result.includes(`[${defaultGrid}]`));
});
