const test = require('node:test');
const assert = require('node:assert/strict');

const { listPresets, getEventPreset, getCommandPreset } = require('../src/presets');

test('presets: should expose system presets for events and commands', () => {
  const presets = listPresets();
  const systemEvent = (presets.events || []).find((p) => p.isSystem);
  const systemCommand = (presets.commands || []).find((p) => p.isSystem);

  assert.ok(systemEvent, 'missing system event preset');
  assert.ok(systemCommand, 'missing system command preset');

  const eventPreset = getEventPreset(systemEvent.id);
  const commandPreset = getCommandPreset(systemCommand.id);

  assert.ok(eventPreset, 'system event preset cannot be resolved');
  assert.ok(commandPreset, 'system command preset cannot be resolved');
  assert.ok(Array.isArray(eventPreset.eventRules) && eventPreset.eventRules.length > 0, 'system event preset must contain rules');
  assert.ok(Array.isArray(commandPreset.commandRules) && commandPreset.commandRules.length > 0, 'system command preset must contain rules');
});

test('presets: get preset should return isolated copies', () => {
  const eventA = getEventPreset('event_defense_basic');
  assert.ok(eventA, 'event_defense_basic not found');
  eventA.name = 'mutated';
  const eventB = getEventPreset('event_defense_basic');
  assert.notEqual(eventB.name, 'mutated');

  const commandA = getCommandPreset('command_core_default');
  assert.ok(commandA, 'command_core_default not found');
  commandA.name = 'mutated';
  const commandB = getCommandPreset('command_core_default');
  assert.notEqual(commandB.name, 'mutated');
});

test('presets: system preset should include individual player events', () => {
  const system = getEventPreset('event_system_default');
  assert.ok(system, 'event_system_default not found');
  const events = (system.eventRules || []).map((r) => String(r?.event || ''));

  assert.ok(events.includes('player_online'), 'system preset should include player_online');
  assert.ok(events.includes('player_offline'), 'system preset should include player_offline');
  assert.ok(events.includes('player_dead'), 'system preset should include player_dead');
  assert.ok(events.includes('player_respawn'), 'system preset should include player_respawn');
  assert.ok(events.includes('player_afk'), 'system preset should include player_afk');
  assert.ok(events.includes('player_afk_recover'), 'system preset should include player_afk_recover');
});

test('presets: defense preset should include individual player events', () => {
  const defense = getEventPreset('event_defense_basic');
  assert.ok(defense, 'event_defense_basic not found');
  const events = (defense.eventRules || []).map((r) => String(r?.event || ''));

  assert.ok(events.includes('player_online'), 'defense preset should include player_online');
  assert.ok(events.includes('player_offline'), 'defense preset should include player_offline');
  assert.ok(events.includes('player_dead'), 'defense preset should include player_dead');
  assert.ok(events.includes('player_respawn'), 'defense preset should include player_respawn');
  assert.ok(events.includes('player_afk'), 'defense preset should include player_afk');
  assert.ok(events.includes('player_afk_recover'), 'defense preset should include player_afk_recover');
});

test('presets: player_afk preset should have afkMinutes trigger', () => {
  const system = getEventPreset('event_system_default');
  assert.ok(system, 'event_system_default not found');
  const afkRule = (system.eventRules || []).find(r => r.event === 'player_afk');
  assert.ok(afkRule, 'missing player_afk preset');
  assert.equal(afkRule.trigger?.afkMinutes, 15, 'player_afk should default to 15 minutes');
});


test('presets: cargo/ch47/heli active and vendor move should default disabled', () => {
  const system = getEventPreset('event_system_default');
  assert.ok(system, 'event_system_default not found');
  const byEvent = new Map((system.eventRules || []).map((r) => [String(r?.event || ''), r]));

  const cargo = byEvent.get('cargo_ship_status');
  const ch47 = byEvent.get('ch47_status');
  const heli = byEvent.get('patrol_heli_status');
  const vendor = byEvent.get('vendor_status');

  assert.ok(cargo, 'missing cargo_ship_status preset');
  assert.ok(ch47, 'missing ch47_status preset');
  assert.ok(heli, 'missing patrol_heli_status preset');
  assert.ok(vendor, 'missing vendor_status preset');

  assert.equal(cargo.trigger?.cargoNotifyActive, false);
  assert.equal(ch47.trigger?.ch47NotifyActive, false);
  assert.equal(heli.trigger?.heliNotifyActive, false);
  assert.equal(vendor.trigger?.vendorNotifyMove, false);
});

test('presets: event defaults should send team_chat without desktop notify', () => {
  const system = getEventPreset('event_system_default');
  assert.ok(system, 'event_system_default not found');

  for (const rule of system.eventRules || []) {
    const actions = Array.isArray(rule?._meta?.actions) ? rule._meta.actions : [];
    const hasTeamChat = actions.some((a) => String(a?.type || '') === 'team_chat');
    const hasDesktop = actions.some((a) => String(a?.type || '') === 'notify_desktop');
    assert.equal(hasTeamChat, true, `missing team_chat action: ${String(rule?.id || rule?.event || '-')}`);
    assert.equal(hasDesktop, false, `should not include notify_desktop: ${String(rule?.id || rule?.event || '-')}`);
  }
});

test('presets: command system preset should include all builtins and only team chat', () => {
  const system = getCommandPreset('command_system_default');
  assert.ok(system, 'command_system_default not found');

  const keywords = new Set((system.commandRules || []).map((rule) => String(rule?.keyword || '')));
  for (const keyword of ['ai', 'shj', 'fwq', 'sh', 'fy', 'dz', 'fk', 'hc', 'wz', 'jk', 'help']) {
    assert.equal(keywords.has(keyword), true, `missing command preset: ${keyword}`);
  }

  for (const rule of system.commandRules || []) {
    assert.equal(rule.enabled, true, `command preset should default enabled: ${String(rule?.keyword || '-')}`);
    const actions = Array.isArray(rule?.meta?.actions) ? rule.meta.actions : [];
    const hasTeamChat = actions.some((a) => String(a?.type || '') === 'team_chat');
    const hasDesktop = actions.some((a) => String(a?.type || '') === 'notify_desktop');
    assert.equal(hasTeamChat, true, `missing team_chat action: ${String(rule?.keyword || '-')}`);
    assert.equal(hasDesktop, false, `should not include notify_desktop: ${String(rule?.keyword || '-')}`);
  }
});
