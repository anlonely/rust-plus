const test = require('node:test');
const assert = require('node:assert/strict');

const CommandParser = require('../src/commands/parser');

function createClient({ markers = [], monuments = [] } = {}) {
  return {
    async getMapMarkers() {
      return { mapMarkers: { markers } };
    },
    async getMap() {
      return { map: { monuments } };
    },
  };
}

test('wz: uses the same base-grid offsets as shj', async () => {
  const parser = new CommandParser();
  parser._getServerSnapshot = async () => ({ snapshot: { mapSize: 4200 } });
  const client = createClient({
    markers: [{ id: 'heli-1', type: 8, x: 200, y: 3900 }],
  });

  const text = await parser._buildHeliStatusText(client);

  assert.equal(text, '武装直升机巡逻中｜网格:B2');
});

test('hc: uses the same base-grid offsets as shj', async () => {
  const parser = new CommandParser();
  parser._getServerSnapshot = async () => ({ snapshot: { mapSize: 4200 } });
  const client = createClient({
    markers: [{ id: 'cargo-1', type: 5, x: 200, y: 3900, speed: 1 }],
  });

  const text = await parser._buildCargoStatusText(client);

  assert.equal(text, '货船航行中｜当前位置:B2');
});
