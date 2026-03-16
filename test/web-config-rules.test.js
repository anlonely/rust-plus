const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveScopedServerId,
  normalizeEventRuleInput,
  normalizeCommandRuleInput,
  normalizeCallGroupInput,
} = require('../src/utils/web-config-rules');

test('web-config-rules: resolveScopedServerId prefers explicit serverId', () => {
  assert.equal(resolveScopedServerId({ runtimeServerId: 'runtime_1', requestedServerId: 'req_2' }), 'req_2');
  assert.equal(resolveScopedServerId({ runtimeServerId: 'runtime_1', requestedServerId: '' }), 'runtime_1');
  assert.equal(resolveScopedServerId({ runtimeServerId: '', requestedServerId: '' }), '');
});

test('web-config-rules: normalizeEventRuleInput fills defaults', () => {
  const rule = normalizeEventRuleInput({ name: '测试事件', event: 'alarm_on' }, 'server_1');
  assert.equal(rule.serverId, 'server_1');
  assert.equal(rule.name, '测试事件');
  assert.equal(rule.event, 'alarm_on');
  assert.equal(rule.enabled, true);
  assert.deepEqual(rule.trigger, { cooldownMs: 3000 });
  assert.deepEqual(rule._meta, {
    doNotify: false,
    doChat: true,
    actions: [{ type: 'team_chat' }],
  });
  assert.ok(String(rule.id).startsWith('web_event_'));
});

test('web-config-rules: normalizeCommandRuleInput keeps keyword and defaults', () => {
  const rule = normalizeCommandRuleInput({ keyword: 'fwq', type: 'server_info' }, 'server_1');
  assert.equal(rule.serverId, 'server_1');
  assert.equal(rule.keyword, 'fwq');
  assert.equal(rule.id, 'fwq');
  assert.equal(rule.enabled, true);
  assert.equal(rule.permission, 'all');
  assert.deepEqual(rule.meta, {
    doNotify: false,
    doChat: true,
    actions: [{ type: 'team_chat' }],
  });
  assert.deepEqual(rule.trigger, {
    cooldownMs: 3000,
  });
});

test('web-config-rules: normalizeCallGroupInput supports system team chat config', () => {
  const group = normalizeCallGroupInput({
    id: '__team_chat_settings__',
    kind: 'team_chat_settings',
    intervalMs: 9000,
  });
  assert.equal(group.id, '__team_chat_settings__');
  assert.equal(group.kind, 'team_chat_settings');
  assert.equal(group.locked, true);
  assert.equal(group.intervalMs, 9000);
});

test('web-config-rules: normalizeCallGroupInput filters invalid members', () => {
  const group = normalizeCallGroupInput({
    id: 'g1',
    name: '测试组',
    members: [
      { phone: '+8613800000000', label: 'A' },
      { phone: '', label: 'B' },
    ],
    cooldownMs: 0,
  });
  assert.equal(group.id, 'g1');
  assert.equal(group.name, '测试组');
  assert.equal(group.enabled, true);
  assert.equal(group.members.length, 1);
  assert.equal(group.members[0].phone, '+8613800000000');
  assert.equal(group.cooldownMs, undefined);
});

test('web-config-rules: normalizeCallGroupInput supports phone/kook/discord channels', () => {
  const group = normalizeCallGroupInput({
    id: 'g2',
    name: '多通道组',
    enabled: false,
    phone: {
      enabled: true,
      members: [{ name: 'P1', phone: '+8613811111111' }],
    },
    kook: {
      enabled: true,
      webhookUrl: 'https://www.kookapp.cn/api/webhook/abc',
    },
    discord: {
      enabled: false,
      webhookUrl: 'https://discord.com/api/webhooks/123/456',
    },
    cooldownMs: 120000,
  });
  assert.equal(group.id, 'g2');
  assert.equal(group.name, '多通道组');
  assert.equal(group.phone.enabled, true);
  assert.equal(group.phone.members.length, 1);
  assert.equal(group.kook.enabled, true);
  assert.equal(group.kook.webhookUrl, 'https://www.kookapp.cn/api/webhook/abc');
  assert.equal(group.discord.enabled, false);
  assert.equal(group.enabled, false);
  assert.equal(group.cooldownMs, undefined);
});


test('web-config-rules: stage defaults keep active/move disabled unless explicitly true', () => {
  const cargo = normalizeEventRuleInput({ event: 'cargo_ship_status', trigger: {} }, 's1');
  const ch47 = normalizeEventRuleInput({ event: 'ch47_status', trigger: {} }, 's1');
  const heli = normalizeEventRuleInput({ event: 'patrol_heli_status', trigger: {} }, 's1');
  const vendor = normalizeEventRuleInput({ event: 'vendor_status', trigger: {} }, 's1');

  assert.equal(cargo.trigger.cargoNotifyActive, false);
  assert.equal(ch47.trigger.ch47NotifyActive, false);
  assert.equal(heli.trigger.heliNotifyActive, false);
  assert.equal(vendor.trigger.vendorNotifyMove, false);

  const enabled = normalizeEventRuleInput({
    event: 'patrol_heli_status',
    trigger: { heliNotifyActive: true },
  }, 's1');
  assert.equal(enabled.trigger.heliNotifyActive, true);
});
