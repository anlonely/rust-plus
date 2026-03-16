const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeGroupConfig,
  resolveEnabledChannels,
  setGroup,
  callGroup,
  listGroups,
  removeGroup,
  getTeamChatSettings,
  TEAM_CHAT_SETTINGS_GROUP_ID,
} = require('../src/call/groups');

test('call-groups: normalizeGroupConfig keeps legacy members as phone config', () => {
  const group = normalizeGroupConfig({
    id: 'g1',
    name: 'legacy',
    members: [
      { name: 'A', phone: '+8613800000000' },
      { name: 'B', phone: '' },
    ],
  });

  assert.equal(group.id, 'g1');
  assert.equal(group.phone.enabled, true);
  assert.equal(group.phone.members.length, 1);
  assert.deepEqual(group.kook, { enabled: false, webhookUrl: '' });
  assert.deepEqual(group.discord, { enabled: false, webhookUrl: '' });
});

test('call-groups: normalizeGroupConfig supports phone/kook/discord fields', () => {
  const group = normalizeGroupConfig({
    id: 'g2',
    name: 'multi',
    phone: {
      enabled: true,
      members: [{ name: 'A', phone: '+8613800000000' }],
    },
    kook: { enabled: true, webhookUrl: 'https://www.kookapp.cn/api/webhook/abc' },
    discord: { enabled: true, webhookUrl: 'https://discord.com/api/webhooks/123/456' },
  });

  assert.equal(group.phone.enabled, true);
  assert.equal(group.phone.members.length, 1);
  assert.equal(group.enabled, true);
  assert.equal(group.kook.enabled, true);
  assert.equal(group.discord.enabled, true);
});

test('call-groups: resolveEnabledChannels filters by group config and request channels', () => {
  const group = normalizeGroupConfig({
    id: 'g3',
    name: 'route',
    members: [{ name: 'A', phone: '+8613800000000' }],
    kook: { enabled: true, webhookUrl: 'https://www.kookapp.cn/api/webhook/abc' },
    discord: { enabled: false, webhookUrl: 'https://discord.com/api/webhooks/123/456' },
  });

  assert.deepEqual(resolveEnabledChannels(group), ['phone', 'kook']);
  assert.deepEqual(resolveEnabledChannels(group, ['kook', 'discord']), ['kook']);
  assert.deepEqual(resolveEnabledChannels(group, ['discord']), []);
});

test('call-groups: disabled group should not trigger', async () => {
  setGroup('g_disabled', {
    id: 'g_disabled',
    name: 'disabled',
    enabled: false,
    phone: {
      enabled: true,
      members: [{ name: 'A', phone: '+8613800000000' }],
    },
  });

  const result = await callGroup('g_disabled', '测试');

  assert.equal(result.success, false);
  assert.equal(result.reason, '呼叫组已禁用');
});

test('call-groups: repeated calls are not throttled by cooldown anymore', async () => {
  setGroup('g_repeat', {
    id: 'g_repeat',
    name: 'repeat',
    enabled: true,
    phone: {
      enabled: true,
      members: [{ name: 'A', phone: '+8613800000000' }],
    },
  });

  const first = await callGroup('g_repeat', '第一次');
  const second = await callGroup('g_repeat', '第二次');

  assert.equal(first.success, true);
  assert.equal(second.success, true);
});

test('call-groups: system team chat settings group is always present and not removable', () => {
  const settings = getTeamChatSettings();
  assert.equal(settings.id, TEAM_CHAT_SETTINGS_GROUP_ID);
  assert.equal(settings.kind, 'team_chat_settings');
  assert.equal(listGroups().some((group) => group.id === TEAM_CHAT_SETTINGS_GROUP_ID), true);
  assert.equal(removeGroup(TEAM_CHAT_SETTINGS_GROUP_ID), false);
});
