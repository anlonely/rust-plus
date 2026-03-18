const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRemoteSteamAuthSession,
  getRemoteSteamAuthSession,
} = require('../src/steam/remote-auth');

test('remote auth session lookup is limited to the owner when provided', () => {
  const created = createRemoteSteamAuthSession({
    ownerUserId: 'user_a',
    ownerEmail: 'a@example.com',
  });

  assert.ok(created?.id);
  assert.equal(
    getRemoteSteamAuthSession(created.id, { ownerUserId: 'user_a' })?.id,
    created.id,
  );
  assert.equal(
    getRemoteSteamAuthSession(created.id, { ownerUserId: 'user_b' }),
    null,
  );
});
