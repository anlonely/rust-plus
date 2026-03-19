const { markerToGrid9, markerToNearestEdgeDirection } = require('../src/utils/map-grid');

const DEFAULT_CARGO_STAGE_MESSAGES = {
  enter: '货船进入地图｜当前位置:{cargo_grid}',
  leave: '货船已离开地图｜最后位置:{cargo_grid}',
  active: '货船航行中｜当前位置:{cargo_grid}',
  dock: '货船已停靠 ｜{cargo_harbor} [{cargo_harbor_grid}]',
};

const LEGACY_DEFAULT_VENDING_NEW_MESSAGE = '新售货机出现｜位置:{marker_grid} 出售:{vending_items}';
const DEFAULT_VENDING_NEW_MESSAGE = '{vending_status_label}｜{marker_grid}｜上架：{vending_items}';
const DEFAULT_CH47_STAGE_MESSAGES = {
  enter: '军用运输直升机进入地图｜当前位置:{marker_grid}',
  active: '军用运输直升机巡逻中｜当前位置:{marker_grid}',
  leave: '军用运输直升机已离开地图｜最后位置:{marker_grid}',
};
const DEFAULT_OIL_STAGE_MESSAGES = {
  large_heavy: '大石油重装已呼叫｜方向：{oil_direction}',
  small_heavy: '小石油重装已呼叫｜方向：{oil_direction}',
  large_unlock: '大石油箱子已解锁｜方向：{oil_direction}',
  small_unlock: '小石油箱子已解锁｜方向：{oil_direction}',
};
const LEGACY_DEFAULT_OIL_STAGE_MESSAGES = {
  large_heavy: '大石油重装已呼叫｜位置:{oil_grid}',
  small_heavy: '小石油重装已呼叫｜位置:{oil_grid}',
  large_unlock: '大石油箱子已解锁｜位置:{oil_grid}',
  small_unlock: '小石油箱子已解锁｜位置:{oil_grid}',
};

function toSafeText(value) {
  if (value == null) return '';
  return String(value);
}

function renderMessageTemplate(template, context = {}, { mapSize = 0 } = {}) {
  const markerGridDetail = markerToGrid9(context.marker || {}, mapSize || 0);
  const markerGrid = String(markerGridDetail || '').split('-')[0] || markerGridDetail || '';
  const memberGridDetail = markerToGrid9(context.member || {}, mapSize || 0);
  const memberGrid = String(memberGridDetail || '').split('-')[0] || memberGridDetail || '';
  const oilGrid = toSafeText(String((context.grid || markerGridDetail || '')).split('-')[0] || context.grid || markerGridDetail || '');
  const oilRefMarker = (() => {
    const rx = Number(context.rig?.x);
    const ry = Number(context.rig?.y);
    if (Number.isFinite(rx) && Number.isFinite(ry)) return { x: rx, y: ry };
    const mx = Number(context.marker?.x);
    const my = Number(context.marker?.y);
    if (Number.isFinite(mx) && Number.isFinite(my)) return { x: mx, y: my };
    return {};
  })();
  const oilDirection = markerToNearestEdgeDirection(oilRefMarker, mapSize || 0) || '-';
  const cargoGrid = toSafeText(String((context.grid || markerGridDetail || '')).split('-')[0] || context.grid || markerGridDetail || '');
  const cargoHarbor = toSafeText(context.harbor?.name || '');
  const cargoHarborGrid = toSafeText(String((context.harborGrid || context.harbor?.grid || '')).split('-')[0] || context.harborGrid || context.harbor?.grid || '');
  const cargoStage = String(context.cargoStage || '').toLowerCase();
  const ch47Stage = String(context.ch47Stage || '').toLowerCase();
  const cargoStatusMessage = (() => {
    if (cargoStage === 'dock') return `货船已停靠 ｜${cargoHarbor || '-'} [${cargoHarborGrid || '-'}]`;
    if (cargoStage === 'enter') return `货船进入地图｜当前位置:${cargoGrid || '-'}`;
    if (cargoStage === 'leave') return `货船已离开地图｜最后位置:${cargoGrid || '-'}`;
    if (cargoStage === 'active') return `货船航行中｜当前位置:${cargoGrid || '-'}`;
    return '';
  })();
  const ch47StatusMessage = (() => {
    if (ch47Stage === 'enter') return `军用运输直升机进入地图｜当前位置:${markerGrid || '-'}`;
    if (ch47Stage === 'active') return `军用运输直升机巡逻中｜当前位置:${markerGrid || '-'}`;
    if (ch47Stage === 'leave') return `军用运输直升机已离开地图｜最后位置:${markerGrid || '-'}`;
    return '';
  })();
  const oilStage = String(context.oilStage || '').toLowerCase();
  const oilStatusMessage = (() => {
    if (oilStage === 'large_heavy') return `大石油重装已呼叫｜方向：${oilDirection}`;
    if (oilStage === 'small_heavy') return `小石油重装已呼叫｜方向：${oilDirection}`;
    if (oilStage === 'large_unlock') return `大石油箱子已解锁｜方向：${oilDirection}`;
    if (oilStage === 'small_unlock') return `小石油箱子已解锁｜方向：${oilDirection}`;
    return '';
  })();
  const afkDuration = (() => {
    const ms = Number(context.idleMs || 0);
    if (!ms || ms <= 0) return '';
    const totalMin = Math.floor(ms / 60000);
    if (totalMin < 1) return '';
    return `${totalMin}分钟`;
  })();
  const playerStatusKey = String(context.playerStatus || '').toLowerCase();
  const playerStatusText = ({
    online: '已上线', offline: '已下线', dead: '已死亡',
    respawn: '已重生', afk: '挂机', afk_recover: '已恢复活动',
  })[playerStatusKey] || '';
  const playerStatusMessage = (() => {
    const name = toSafeText(context.member?.name || '队友');
    const grid = toSafeText(memberGrid || '-');
    const msgs = {
      online: `${name}已上线｜上线位置:${grid}`,
      offline: `${name}已离线｜离线位置:${grid}`,
      dead: `${name}已死亡｜死亡位置:${grid}`,
      respawn: `${name}已重生｜当前位置:${grid}`,
      afk: `${name}已挂机${afkDuration || '15分钟'}｜当前位置:${grid}`,
      afk_recover: `${name}已恢复活动｜当前位置:${grid}`,
    };
    return msgs[playerStatusKey] || '';
  })();
  const deepSeaStage = String(context.deepSeaStage || '').toLowerCase();
  const deepSeaStatusMessage = (() => {
    if (deepSeaStage === 'open') return '深海已开启';
    if (deepSeaStage === 'close') return '深海已关闭';
    return '';
  })();
  const vendorStage = String(context.vendorStage || '').toLowerCase();
  const vendorStatusMessage = (() => {
    const grid = toSafeText(markerGrid || '-');
    const label = ({
      enter: '流浪商人进入地图',
      move: '流浪商人移动中',
      stopped: '流浪商人已停留',
      leave: '流浪商人已离开地图',
    })[vendorStage] || '';
    if (!label) return '';
    if (vendorStage === 'leave') return `${label}｜最后位置:${grid}`;
    return `${label}｜当前位置:${grid}`;
  })();
  const vendingItems = Array.isArray(context.vendingItems)
    ? context.vendingItems.map((item) => toSafeText(item)).filter(Boolean).join(' / ')
    : toSafeText(context.vendingItems || '');
  const vendingStage = String(context.vendingStage || '').toLowerCase();
  const vendingStatusLabel = vendingStage === 'update' ? '售货机上新' : '发现新售货机';
  const vars = {
    member: toSafeText(context.member?.name || ''),
    member_grid: toSafeText(memberGrid),
    member_status: playerStatusText,
    marker_grid: toSafeText(markerGrid),
    afk_duration: afkDuration,
    player_status: playerStatusText,
    player_status_message: playerStatusMessage,
    oil_grid: oilGrid,
    oil_direction: oilDirection,
    oil_status_message: oilStatusMessage,
    cargo_grid: cargoGrid,
    cargo_harbor: cargoHarbor,
    cargo_harbor_grid: cargoHarborGrid,
    cargo_status_message: cargoStatusMessage,
    ch47_status_message: ch47StatusMessage,
    vendor_status_message: vendorStatusMessage,
    deep_sea_status_message: deepSeaStatusMessage,
    vending_items: vendingItems,
    vending_status_label: vendingStatusLabel,
    event: toSafeText(context.event || ''),
  };
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    if (vars[key] != null && vars[key] !== '') return vars[key];
    const direct = context[key];
    if (direct == null) return `{${key}}`;
    return toSafeText(direct);
  }).trim();
}

function makeActionContext(meta = {}, eventType = '', deps = {}) {
  const resolveTemplate = (ctx = {}, baseTemplate = '') => {
    if (eventType === 'cargo_ship_status') {
      const stage = String(ctx?.cargoStage || '').toLowerCase();
      return String(meta?.cargoMessages?.[stage] || DEFAULT_CARGO_STAGE_MESSAGES[stage] || baseTemplate || '').trim();
    }
    if (eventType === 'ch47_status') {
      const stage = String(ctx?.ch47Stage || '').toLowerCase();
      return String(meta?.ch47Messages?.[stage] || DEFAULT_CH47_STAGE_MESSAGES[stage] || baseTemplate || '').trim();
    }
    if (eventType === 'oil_rig_status') {
      const stage = String(ctx?.oilStage || '').toLowerCase();
      const stageTemplate = String(meta?.oilMessages?.[stage] || '').trim();
      if (!stageTemplate) return String(DEFAULT_OIL_STAGE_MESSAGES[stage] || baseTemplate || '').trim();
      if (stageTemplate === LEGACY_DEFAULT_OIL_STAGE_MESSAGES[stage] || stageTemplate.includes('{oil_grid}')) {
        return String(DEFAULT_OIL_STAGE_MESSAGES[stage] || baseTemplate || '').trim();
      }
      return stageTemplate;
    }
    if (eventType === 'player_status') {
      const stage = String(ctx?.playerStatus || '').toLowerCase();
      const stageTemplate = String(meta?.playerStatusMessages?.[stage] || '').trim();
      return stageTemplate || baseTemplate;
    }
    if (eventType === 'vending_new') {
      const template = String(baseTemplate || '').trim();
      if (!template || template === LEGACY_DEFAULT_VENDING_NEW_MESSAGE) {
        return DEFAULT_VENDING_NEW_MESSAGE;
      }
      return template;
    }
    return String(baseTemplate || '').trim();
  };
  const render = (ctx = {}, baseTemplate = '') => {
    const template = resolveTemplate(ctx, baseTemplate || meta.message || `事件触发: ${eventType}`);
    const resolvedMapSize = typeof deps.mapSize === 'function'
      ? Number(deps.mapSize() || 0)
      : Number(deps.mapSize || 0);
    return renderMessageTemplate(template, { ...ctx, event: eventType }, { mapSize: resolvedMapSize || 0 });
  };
  return { render };
}

function buildActionsFromMeta(meta = {}, eventType = '', deps = {}) {
  const actions = [];
  const actionCtx = makeActionContext(meta, eventType, deps);
  const actionDefs = Array.isArray(meta.actions) ? meta.actions : [];

  for (const action of actionDefs) {
    const type = String(action?.type || '').trim();
    if (!type) continue;

    if (type === 'notify_desktop') {
      actions.push(async (context = {}) => {
        const message = actionCtx.render(context, meta.message);
        deps.notifyDesktop?.({ title: `🔔 ${eventType}`, message });
        deps.sendWsNotification?.({ type: 'info', title: `🔔 ${eventType}`, message });
      });
      continue;
    }
    if (type === 'team_chat' || type === 'send_game_message') {
      actions.push(async (context = {}) => {
        const message = actionCtx.render(context, action.message || meta.message);
        if (message) await deps.sendTeamMessage?.(message);
      });
      continue;
    }
    if (type === 'switch_control') {
      actions.push(async () => {
        const entityId = Number(action.entityId);
        if (!Number.isFinite(entityId)) return;
        const state = action.state === 'on' || action.state === true;
        await deps.toggleSwitch?.({ entityId, state });
      });
      continue;
    }
    if (type === 'call_group') {
      actions.push(async (context = {}) => {
        const groupId = String(action.groupId || '').trim();
        if (!groupId) return;
        const message = actionCtx.render(context, action.message || meta.message);
        const channels = Array.isArray(action.channels)
          ? action.channels.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
          : [];
        await deps.callGroup?.(groupId, message, { channels });
      });
      continue;
    }
  }

  if (actions.length) return actions;

  if (meta.doNotify === true) {
    actions.push(async (context = {}) => {
      const message = actionCtx.render(context, meta.message);
      deps.notifyDesktop?.({ title: `🔔 ${eventType}`, message });
      deps.sendWsNotification?.({ type: 'info', title: `🔔 ${eventType}`, message });
    });
  }
  if (meta.doChat !== false) {
    actions.push(async (context = {}) => {
      const message = actionCtx.render(context, meta.message);
      if (message) await deps.sendTeamMessage?.(message);
    });
  }

  return actions;
}

function hydrateRule(rule = {}, deps = {}) {
  return {
    ...rule,
    trigger: rule.trigger || {},
    _meta: rule._meta || {},
    actions: buildActionsFromMeta(rule._meta || {}, rule.event, deps),
  };
}

module.exports = {
  renderMessageTemplate,
  buildActionsFromMeta,
  hydrateRule,
};
