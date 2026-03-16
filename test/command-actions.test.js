const test = require('node:test');
const assert = require('node:assert/strict');

const CommandParser = require('../src/commands/parser');

test('command-parser: builtins default to team chat action with 3s cooldown', async () => {
  const teamMessages = [];
  const parser = new CommandParser({
    teamChatRunner: async (message) => {
      teamMessages.push(message);
    },
  });
  parser._client = { connected: true };

  await Promise.all([
    parser._onTeamMessage({ steamId: '1', message: 'help' }),
    parser._onTeamMessage({ steamId: '1', message: 'help' }),
  ]);

  assert.ok(teamMessages.length >= 5);
  assert.ok(teamMessages.some((message) => /^help:/.test(message)));
  const helpCount = teamMessages.filter((message) => /^help:/.test(message)).length;
  assert.equal(helpCount, 1);
});

test('command-parser: command rules dispatch desktop discord and call group actions', async () => {
  const desktop = [];
  const teamMessages = [];
  const callGroups = [];
  const parser = new CommandParser({
    notifyDesktopRunner: async (payload) => desktop.push(payload),
    teamChatRunner: async (message) => teamMessages.push(message),
    callGroupRunner: async (groupId, message, options) => {
      callGroups.push({ groupId, message, options });
      return { success: true };
    },
  });
  parser._client = { connected: true };

  const ok = parser.setCommandRule({
    keyword: 'help',
    name: '帮助',
    permission: 'all',
    meta: {
      doNotify: true,
      doChat: false,
      actions: [
        { type: 'notify_desktop' },
        { type: 'call_group', groupId: 'group_1', channels: ['discord'] },
      ],
    },
    trigger: { cooldownMs: 0 },
  });
  assert.equal(ok, true);

  await parser._onTeamMessage({ steamId: '1', message: 'help' });

  assert.equal(teamMessages.length, 0);
  assert.equal(desktop.length, 1);
  assert.equal(callGroups.length, 1);
  assert.equal(callGroups[0].groupId, 'group_1');
  assert.deepEqual(callGroups[0].options, { channels: ['discord'] });
  assert.match(String(callGroups[0].message || ''), /help:/);
});

test('command-parser: builtin command can be deleted and restored', () => {
  const parser = new CommandParser();
  assert.ok(parser.getCommands().some((item) => item.keyword === 'help'));

  assert.equal(parser.removeCommandRule('help'), true);
  assert.equal(parser.getCommands().some((item) => item.keyword === 'help'), false);

  assert.equal(parser.setCommandEnabled('help', true), true);
  assert.equal(parser.getCommands().some((item) => item.keyword === 'help'), true);
});
