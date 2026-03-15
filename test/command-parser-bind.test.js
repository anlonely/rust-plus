const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const CommandParser = require('../src/commands/parser');

test('command-parser: bind is idempotent on the same client', async () => {
  const parser = new CommandParser();
  const client = new EventEmitter();
  client.connected = true;
  client.sendTeamMessage = async () => {};

  parser.bind(client);
  parser.bind(client);
  parser.bind(client);

  assert.equal(client.listenerCount('teamMessage'), 1);
});

test('command-parser: rebind removes listener from previous client', async () => {
  const parser = new CommandParser();
  const clientA = new EventEmitter();
  const clientB = new EventEmitter();
  clientA.connected = true;
  clientB.connected = true;
  clientA.sendTeamMessage = async () => {};
  clientB.sendTeamMessage = async () => {};

  parser.bind(clientA);
  parser.bind(clientB);

  assert.equal(clientA.listenerCount('teamMessage'), 0);
  assert.equal(clientB.listenerCount('teamMessage'), 1);
});
