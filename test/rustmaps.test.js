const test = require('node:test');
const assert = require('node:assert/strict');

const {
  centeredToMapCoord,
  parseRustMapsPageData,
  normalizeRustMapsMonument,
  normalizeProceduralMapSize,
  buildRustMapsUrlCandidates,
  resolveRustMapsUrl,
} = require('../src/utils/rustmaps');

test('rustmaps: parse pageData payload from html', () => {
  const html = `
    <html><body>
    <script>window.pageData = {"meta":{"status":"Success"},"data":{"size":4096,"seed":1337,"monuments":[{"type":"Outpost","coordinates":{"x":-213,"y":-445},"iconPath":"Outpost"}]}};</script>
    </body></html>
  `;
  const data = parseRustMapsPageData(html);
  assert.equal(data?.size, 4096);
  assert.equal(data?.seed, 1337);
  assert.equal(data?.monuments?.[0]?.type, 'Outpost');
});

test('rustmaps: centered coordinates convert to Rust+ map coordinates', () => {
  assert.equal(centeredToMapCoord(-213, 4096), 1835);
  assert.equal(centeredToMapCoord(-445, 4096), 1603);
});

test('rustmaps: normalize monument keeps label and converts coordinates', () => {
  const monument = normalizeRustMapsMonument({
    type: 'Outpost',
    iconPath: 'Outpost',
    coordinates: { x: -213, y: -445 },
  }, 4096);

  assert.deepEqual(monument, {
    x: 1835,
    y: 1603,
    token: 'Outpost',
    label: 'Outpost',
    type: 'Outpost',
    source: 'rustmaps',
  });
});

test('rustmaps: procedural maps resolve from size and seed', () => {
  const url = resolveRustMapsUrl({ mapSize: 3700, seed: 1879623405, serverName: 'Test', mapName: 'Procedural Map' });
  assert.equal(url, 'https://rustmaps.com/map/3700_1879623405');
});

test('rustmaps: procedural map size is normalized to rustmaps standard step', () => {
  assert.equal(normalizeProceduralMapSize(3499), 3500);
  assert.equal(normalizeProceduralMapSize(3700), 3700);
  assert.equal(normalizeProceduralMapSize(3749), 3750);
});

test('rustmaps: procedural candidate urls include normalized size first', () => {
  const urls = buildRustMapsUrlCandidates({ mapSize: 3499, seed: 1337 });
  assert.equal(urls[0], 'https://rustmaps.com/map/3500_1337');
  assert.equal(urls[1], 'https://rustmaps.com/map/3499_1337');
  assert.ok(urls.includes('https://rustmaps.com/map/3400_1337'));
});

test('rustmaps: custom Hapis hint overrides procedural url when server matches', () => {
  const url = resolveRustMapsUrl({ mapSize: 4096, seed: 1337, serverName: 'Rusty Moose |Hapis|', mapName: 'Moose Maps' });
  assert.equal(url, 'https://rustmaps.com/map/186d52787b9442b6927ec4976ed94550');
});
