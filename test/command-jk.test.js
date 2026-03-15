const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const CommandParser = require('../src/commands/parser');

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.sent = [];
  }

  async sendTeamMessage(message) {
    this.sent.push(String(message || ''));
  }
}

test('jk: fuzzy monument query returns all bandit camp CCTV codes', async () => {
  const client = new FakeClient();
  const parser = new CommandParser();
  parser.bind(client);

  await parser._onTeamMessage({
    steamId: '76561198000000000',
    message: { message: 'jk 强盗' },
  });

  assert.deepEqual(client.sent, [
    '强盗营地监控代码：[CASINO - 强盗营地赌场]  [TOWNWEAPONS - 强盗营地武器商人]',
  ]);
});

test('jk: long CCTV code groups are split on code boundaries before sending', async () => {
  const client = new FakeClient();
  const parser = new CommandParser();
  parser.bind(client);

  await parser._onTeamMessage({
    steamId: '76561198000000000',
    message: { message: 'jk 大石油' },
  });

  assert.ok(client.sent.length >= 2);
  assert.ok(client.sent.every((line) => Array.from(line).length <= 128));
  assert.ok(client.sent.some((line) => line.includes('[OILRIG2L6D - 大油井六楼D]')));
  assert.ok(client.sent.every((line) => !line.endsWith('-')));
  assert.ok(client.sent.every((line) => !line.endsWith('[')));
});

test('jk: cargo query returns cargo ship CCTV codes with locations', async () => {
  const client = new FakeClient();
  const parser = new CommandParser();
  parser.bind(client);

  await parser._onTeamMessage({
    steamId: '76561198000000000',
    message: { message: 'jk 货轮' },
  });

  assert.deepEqual(client.sent, [
    '货轮监控代码：[CARGODECK - 前甲板]  [CARGOBRIDGE - 通道]  [CARGOSTERN - 后甲板]  [CARGOHOLD1 - 舱内1]  [CARGOHOLD2 - 舱内2]',
  ]);
});
