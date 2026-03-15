const test = require('node:test');
const assert = require('node:assert/strict');

const EventEngine = require('../src/events/engine');

function vendorMarker({ id = 'vendor_1', x = 0, y = 0 } = {}) {
  return {
    id,
    type: 9,
    x,
    y,
    name: 'Traveling Vendor',
  };
}

test('event-engine: vendor_stopped waits for stable stationary streak before firing', () => {
  const engine = new EventEngine();
  const fired = [];
  engine._fire = (event, context) => fired.push({ event, context });

  // Tick 0: baseline
  engine._prevMarkers = [vendorMarker({ x: 100, y: 100 })];

  // Tick 1: moving
  const tick1 = [vendorMarker({ x: 120, y: 100 })];
  engine._diffMapMarkers(tick1);
  engine._prevMarkers = tick1;

  // Tick 2: first stationary tick (do not emit stopped yet)
  const tick2 = [vendorMarker({ x: 121, y: 100 })];
  engine._diffMapMarkers(tick2);
  engine._prevMarkers = tick2;
  assert.equal(fired.filter((item) => item.event === 'vendor_stopped').length, 0);

  // Tick 3: second stationary tick (emit stopped on stabilized position)
  const tick3 = [vendorMarker({ x: 121.2, y: 100 })];
  engine._diffMapMarkers(tick3);
  engine._prevMarkers = tick3;

  const stopped = fired.filter((item) => item.event === 'vendor_stopped');
  const statusStopped = fired.filter((item) => (
    item.event === 'vendor_status' && String(item.context?.vendorStage || '') === 'stopped'
  ));
  assert.equal(stopped.length, 1);
  assert.equal(statusStopped.length, 1);
  assert.equal(Number(stopped[0].context?.marker?.x), 121.2);
});
