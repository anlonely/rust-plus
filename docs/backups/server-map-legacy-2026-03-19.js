// Legacy server map renderer backup from web/public/index.html on 2026-03-19
// Includes overlay helpers and the original renderServerMapLayer implementation.
// rustplus 风格网格渲染: 格子从 (0,0) 开始, Y 轴翻转
function buildMapGridOverlayHtml(mapContext, renderedRect, camera = state.serverMapCamera, wrapEl = null) {
  if (!state.serverMapSettings.showGrid) return '';
  const worldSize = Number(mapContext?.worldSize || mapContext?.coordinateSize || 0);
  if (!Number.isFinite(worldSize) || worldSize <= 0 || !renderedRect) return '';
  const meta = getRustGridMeta(worldSize);
  if (!meta) return '';
  const wrap = wrapEl || document.getElementById('server-map-wrap');
  const wrapWidth = Number(wrap?.clientWidth || 0);
  const wrapHeight = Number(wrap?.clientHeight || 0);
  if (!Number.isFinite(wrapWidth) || !Number.isFinite(wrapHeight) || wrapWidth <= 0 || wrapHeight <= 0) return '';
  const cellSize = meta.cellSize;
  const cols = meta.cols;
  const rows = meta.rows;
  const html = [];
  const scale = Number(camera?.scale || 1) > 0 ? Number(camera.scale) : 1;
  const baseCenter = {
    x: renderedRect.left + (renderedRect.width / 2),
    y: renderedRect.top + (renderedRect.height / 2),
  };
  const projectedCenter = projectServerMapPixel(baseCenter, wrapWidth, wrapHeight, camera);
  const surfaceWidth = renderedRect.width * scale;
  const surfaceHeight = renderedRect.height * scale;
  const cellWidth = surfaceWidth / cols;
  const cellHeight = surfaceHeight / rows;
  if (projectedCenter && cellWidth > 0 && cellHeight > 0) {
    html.push(`<div class="server-map-grid-surface" style="left:${projectedCenter.x - (surfaceWidth / 2)}px;top:${projectedCenter.y - (surfaceHeight / 2)}px;width:${surfaceWidth}px;height:${surfaceHeight}px;background-size:${cellWidth}px ${cellHeight}px;"></div>`);
  }
  if ((cols * rows) > 1400) return '';
  for (let c = 0; c < cols; c++) {
    const colLabel = toMapGridColumnLabel(c);
    for (let r = 0; r < rows; r++) {
      // 标签在格子中心
      const worldCx = (c + 0.5) * cellSize;
      const worldCy = worldSize - (r + 0.5) * cellSize;
      const basePixel = normalizedToPixel(worldToNormalized(worldCx, worldCy, mapContext), renderedRect);
      const pixel = projectServerMapPixel(basePixel, wrapWidth, wrapHeight, camera);
      if (!pixel) continue;
      html.push(`<div class="server-map-grid-cell-label" style="left:${pixel.x}px;top:${pixel.y}px;">${colLabel}${r}</div>`);
    }
  }
  return html.join('');
}

function normalizeMonumentToken(tokenRaw) {
  const token = String(tokenRaw || '').trim().toLowerCase();
  if (!token) return '';
  const last = token.split('/').pop() || token;
  return last.replace(/\.prefab$/i, '');
}

function getServerMapAssetBaseUrl() {
  return '/assets/server-map-icons/';
}

function getServerMapIconUrl(fileName = '') {
  const name = String(fileName || '').trim();
  if (!name) return '';
  return `${getServerMapAssetBaseUrl()}${encodeURIComponent(name)}`;
}

function resolveMonumentIconFile(tokenRaw) {
  const token = String(tokenRaw || '').toLowerCase();
  const normalized = normalizeMonumentToken(tokenRaw);
  if (!token || !normalized) return 'icon.png';
  const exactMap = {
    supermarket: 'supermarket.png',
    mining_outpost_display_name: 'mining_outpost.png',
    gas_station: 'oxums.png',
    fishing_village_display_name: 'fishing.png',
    large_fishing_village_display_name: 'fishing.png',
    lighthouse_display_name: 'lighthouse.png',
    excavator: 'excavator.png',
    water_treatment_plant_display_name: 'water_treatment.png',
    train_yard_display_name: 'train_yard.png',
    outpost: 'outpost.png',
    bandit_camp: 'bandit.png',
    jungle_ziggurat: 'jungle_ziggurat.png',
    junkyard_display_name: 'junkyard.png',
    dome_monument_name: 'dome.png',
    satellite_dish_display_name: 'satellite.png',
    power_plant_display_name: 'power_plant.png',
    military_tunnels_display_name: 'military_tunnels.png',
    airfield_display_name: 'airfield.png',
    launchsite: 'launchsite.png',
    sewer_display_name: 'sewer.png',
    oil_rig_small: 'small_oil_rig.png',
    large_oil_rig: 'large_oil_rig.png',
    underwater_lab: 'underwater_lab.png',
    abandonedmilitarybase: 'desert_base.png',
    ferryterminal: 'ferryterminal.png',
    harbor_display_name: 'harbour.png',
    harbor_2_display_name: 'harbour.png',
    arctic_base_a: 'arctic_base.png',
    arctic_base_b: 'arctic_base.png',
    missile_silo_monument: 'missile_silo.png',
    stables_a: 'stables.png',
    stables_b: 'stables.png',
    mining_quarry_stone_display_name: 'mining_quarry_stone.png',
    mining_quarry_sulfur_display_name: 'mining_quarry_sulfur.png',
    mining_quarry_hqm_display_name: 'mining_quarry_hqm.png',
    train_tunnel_link_display_name: 'train.png',
    train_tunnel_display_name: 'train.png',
    radtown: 'radtown.png',
  };
  if (exactMap[normalized]) return exactMap[normalized];
  if (normalized.includes('swamp')) return 'swamp.png';
  if (normalized.includes('supermarket')) return 'supermarket.png';
  if (normalized.includes('mining_outpost')) return 'mining_outpost.png';
  if (normalized.includes('gas_station') || normalized.includes('oxum')) return 'oxums.png';
  if (normalized.includes('fishing_village')) return 'fishing.png';
  if (normalized.includes('lighthouse')) return 'lighthouse.png';
  if (normalized.includes('excavator')) return 'excavator.png';
  if (normalized.includes('water_treatment') || normalized.includes('sewer')) return normalized.includes('water_treatment') ? 'water_treatment.png' : 'sewer.png';
  if (normalized.includes('train_yard')) return 'train_yard.png';
  if (normalized.includes('outpost')) return 'outpost.png';
  if (normalized.includes('bandit')) return 'bandit.png';
  if (normalized.includes('jungle_ziggurat')) return 'jungle_ziggurat.png';
  if (normalized.includes('junkyard')) return 'junkyard.png';
  if (normalized.includes('dome')) return 'dome.png';
  if (normalized.includes('satellite')) return 'satellite.png';
  if (normalized.includes('power_plant')) return 'power_plant.png';
  if (normalized.includes('military_tunnels')) return 'military_tunnels.png';
  if (normalized.includes('airfield')) return 'airfield.png';
  if (normalized.includes('launchsite') || normalized.includes('launch_site')) return 'launchsite.png';
  if (normalized.includes('oil_rig_small') || normalized.includes('small_oil_rig') || normalized.includes('oilrig_small')) return 'small_oil_rig.png';
  if (normalized.includes('large_oil_rig') || normalized.includes('oilrig_large')) return 'large_oil_rig.png';
  if (normalized.includes('underwater_lab')) return 'underwater_lab.png';
  if (normalized.includes('abandonedmilitarybase')) return 'desert_base.png';
  if (normalized.includes('ferryterminal') || normalized.includes('ferry_terminal')) return 'ferryterminal.png';
  if (normalized.includes('harbor_2') || normalized.includes('harbour_2') || normalized.includes('harbor') || normalized.includes('harbour')) return 'harbour.png';
  if (normalized.includes('arctic_base') || normalized.includes('arctic_research_base')) return 'arctic_base.png';
  if (normalized.includes('missile_silo')) return 'missile_silo.png';
  if (normalized.includes('stables')) return 'stables.png';
  if (normalized.includes('mining_quarry_stone') || normalized.includes('stone_quarry')) return 'mining_quarry_stone.png';
  if (normalized.includes('mining_quarry_sulfur') || normalized.includes('sulfur_quarry')) return 'mining_quarry_sulfur.png';
  if (normalized.includes('mining_quarry_hqm') || normalized.includes('hqm_quarry')) return 'mining_quarry_hqm.png';
  if (normalized.includes('train_tunnel') || normalized.includes('tunnel_entrance') || normalized.includes('subway') || normalized.includes('metro')) return 'train.png';
  if (normalized.includes('radtown')) return 'radtown.png';
  return 'icon.png';
}

function getOverlayMonumentIconImage(fileName = '') {
  const name = String(fileName || '').trim();
  if (!name) return null;
  const cache = state.serverMapOverlayIconCache || {};
  const hit = cache[name];
  if (hit?.state === 'loaded' && hit.img) return hit.img;
  if (hit?.state === 'loading') return null;
  const img = new Image();
  cache[name] = { state: 'loading', img };
  state.serverMapOverlayIconCache = cache;
  img.onload = () => {
    const current = state.serverMapOverlayIconCache?.[name];
    if (current) current.state = 'loaded';
    if (state.activePage === 'servermap') renderServerMapLayer();
  };
  img.onerror = () => {
    const current = state.serverMapOverlayIconCache?.[name];
    if (current) current.state = 'error';
  };
  img.src = getServerMapIconUrl(name);
  return null;
}

function drawServerMapOverlayCanvas(mapContext, renderedRect, imageRect, monuments = [], camera = state.serverMapCamera, wrapEl = null) {
  const overlayCanvas = document.getElementById('server-map-overlay-canvas');
  if (!(overlayCanvas instanceof HTMLCanvasElement)) return;
  const ctx = overlayCanvas.getContext('2d');
  if (!ctx) return;
  const canvasWidth = Number(overlayCanvas.width || 0);
  const canvasHeight = Number(overlayCanvas.height || 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  if (!state.serverMapImageUrl || !state.connected) return;
  if (!renderedRect || !imageRect || !mapContext) return;

  const wrap = wrapEl || document.getElementById('server-map-wrap');
  const wrapWidth = Number(wrap?.clientWidth || 0);
  const wrapHeight = Number(wrap?.clientHeight || 0);
  if (!Number.isFinite(wrapWidth) || !Number.isFinite(wrapHeight) || wrapWidth <= 0 || wrapHeight <= 0) return;
  const cam = camera || state.serverMapCamera;
  const dpr = clamp(Number(window.devicePixelRatio || 1), 1, 2);

  const toLocal = (basePoint) => {
    const projected = projectServerMapPixel(basePoint, wrapWidth, wrapHeight, camera);
    if (!projected) return null;
    return {
      x: (projected.x - imageRect.left) * dpr,
      y: (projected.y - imageRect.top) * dpr,
    };
  };

  if (state.serverMapSettings.showGrid) {
    const worldSize = Number(mapContext?.worldSize || mapContext?.coordinateSize || 0);
    const meta = Number.isFinite(worldSize) && worldSize > 0 ? getRustGridMeta(worldSize) : null;
    if (meta) {
      const gridSize = meta.cellSize;
      const cols = meta.cols;
      const rows = meta.rows;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = dpr;

      for (let c = 0; c <= cols; c += 1) {
        const worldX = Math.min(worldSize, c * gridSize);
        const topBase = normalizedToPixel(worldToNormalized(worldX, worldSize, mapContext), renderedRect);
        const bottomBase = normalizedToPixel(worldToNormalized(worldX, 0, mapContext), renderedRect);
        const p1 = toLocal(topBase);
        const p2 = toLocal(bottomBase);
        if (!p1 || !p2) continue;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      for (let r = 0; r <= rows; r += 1) {
        const worldY = Math.max(0, worldSize - (r * gridSize));
        const leftBase = normalizedToPixel(worldToNormalized(0, worldY, mapContext), renderedRect);
        const rightBase = normalizedToPixel(worldToNormalized(worldSize, worldY, mapContext), renderedRect);
        const p1 = toLocal(leftBase);
        const p2 = toLocal(rightBase);
        if (!p1 || !p2) continue;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      if ((cols * rows) <= 1400) {
        ctx.fillStyle = 'rgba(255,255,255,0.48)';
        ctx.font = `bold ${Math.max(12, Math.round(10 * dpr))}px ui-sans-serif, system-ui, -apple-system`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let c = 0; c < cols; c += 1) {
          const colLabel = toMapGridColumnLabel(c);
          for (let r = 0; r < rows; r += 1) {
            const worldX = Math.min(worldSize, (c + 0.5) * gridSize);
            const worldY = Math.max(0, worldSize - ((r + 0.5) * gridSize));
            const centerBase = normalizedToPixel(worldToNormalized(worldX, worldY, mapContext), renderedRect);
            const center = toLocal(centerBase);
            if (!center) continue;
            ctx.fillText(`${colLabel}${r}`, center.x, center.y);
          }
        }
      }
      ctx.restore();
    }
  }

  if (state.serverMapSettings.showMonuments) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const mon of (Array.isArray(monuments) ? monuments : [])) {
      const normalized = monumentToNormalized(mon?.x, mon?.y, mapContext);
      const basePos = normalizedToPixel(normalized, renderedRect, { clamp: false });
      const pos = toLocal(basePos);
      if (!normalized || !pos) continue;

      const iconName = resolveMonumentIconFile(mon?.token || mon?.name || mon?.label);
      const iconImg = getOverlayMonumentIconImage(iconName);
      const iconSize = Math.max(16, Math.round(20 * dpr));
      if (iconImg) {
        ctx.drawImage(iconImg, pos.x - (iconSize / 2), pos.y - (iconSize / 2), iconSize, iconSize);
      } else {
        ctx.fillStyle = '#ffb86b';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, Math.max(3, Math.floor(4 * dpr)), 0, Math.PI * 2);
        ctx.fill();
      }

      const tokenStr = String(mon?.token || '').toLowerCase();
      const isSubway = tokenStr.includes('train_tunnel') || tokenStr.includes('tunnel_entrance') || tokenStr.includes('subway') || tokenStr.includes('metro');
      if (!isSubway && mon?.label) {
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 3 * dpr;
        ctx.fillStyle = '#f6b26b';
        ctx.font = `bold ${Math.max(12, Math.round(11 * dpr))}px ui-sans-serif, system-ui, -apple-system`;
        ctx.fillText(String(mon.label), pos.x, pos.y + Math.max(12, Math.round(12 * dpr)));
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  }
}

function renderServerMapMonumentIcon(monument = {}) {
  const iconUrl = getServerMapIconUrl(resolveMonumentIconFile(monument?.token || monument?.name || monument?.label));
  return `
    <div class="server-map-monument-icon">
      <img src="${esc(iconUrl)}" alt="${esc(monument?.label || '')}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
      <div class="server-map-monument-fallback"></div>
    </div>
  `;
}

function renderServerMapVendingIcon(outOfStock = false) {
  const iconUrl = getServerMapIconUrl('vending_machine.png');
  return `
    <div class="server-map-vending-icon ${outOfStock ? 'oos' : ''}">
      <img src="${esc(iconUrl)}" alt="售货机" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
      <div class="server-map-vending-fallback"></div>
    </div>
  `;
}

function formatMonumentFallbackLabel(tokenRaw) {
  const normalized = normalizeMonumentToken(tokenRaw);
  if (!normalized) return '';
  const cleaned = normalized
    .replace(/_display_name$/i, '')
    .replace(/_monument$/i, '')
    .replace(/_a$|_b$/i, '')
    .replace(/_/g, ' ')
    .trim();
  if (!cleaned) return normalized;
  return cleaned;
}

function resolveMonumentLabel(tokenRaw) {
  const token = String(tokenRaw || '').toLowerCase();
  const normalized = normalizeMonumentToken(tokenRaw);
  if (!token || !normalized) return '';

  if (normalized.includes('train_tunnel_link')) return '';
  if (normalized.includes('module_900x900') || token.includes('/underwater-lab-base/module_')) return '';

  if (normalized === 'abandonedmilitarybase') return '废弃军事基地';
  if (normalized.includes('airfield')) return '机场';
  if (normalized.includes('abandoned_cabins')) return '废弃小屋';
  if (normalized.includes('arctic_base') || normalized.includes('arctic_research_base')) return '极地科研中心';
  if (normalized.includes('dome')) return '大铁球';
  if (normalized.includes('excavator')) return '巨型挖掘机';
  if (normalized.includes('ferryterminal') || normalized.includes('ferry_terminal')) return '渡轮码头';
  if (normalized.includes('large_fishing_village')) return '大型渔村';
  if (normalized.includes('fishing_village')) return '渔村';
  if (normalized.includes('fish_exchange')) return '鱼贩';
  if (normalized.includes('gas_station')) return '加油站';
  if (normalized.includes('harbor_2') || normalized.includes('harbour_2')) return '小型港口';
  if (normalized.includes('harbor') || normalized.includes('harbour')) return '大型港口';
  if (normalized.includes('jungle_ziggurat')) return '丛林神庙';
  if (normalized.includes('junkyard')) return '废车场';
  if (normalized.includes('large_oil_rig') || normalized.includes('oilrig_large')) return '大型石油钻井平台';
  if (normalized.includes('oil_rig_small') || normalized.includes('small_oil_rig') || normalized.includes('oilrig_small')) return '小型石油钻井平台';
  if (normalized.includes('launchsite') || normalized.includes('launch_site')) return '火箭发射基地';
  if (normalized.includes('lighthouse')) return '灯塔';
  if (normalized.includes('military_tunnels') || normalized.includes('military_tunnel')) return '军事隧道';
  if (normalized.includes('mining_outpost')) return '矿场前哨站';
  if (normalized.includes('mining_quarry_hqm') || normalized.includes('hqm_quarry')) return '高金矿场';
  if (normalized.includes('mining_quarry_stone') || normalized.includes('stone_quarry')) return '采石矿场';
  if (normalized.includes('mining_quarry_sulfur') || normalized.includes('sulfur_quarry')) return '硫磺采石场';
  if (normalized.includes('quarry')) return '采石矿场';
  if (normalized.includes('missile_silo')) return '导弹发射井';
  if (normalized.includes('outpost')) return '前哨站';
  if (normalized.includes('power_plant')) return '发电站';
  if (normalized.includes('radtown')) return '辐射镇';
  if (normalized.includes('satellite_dish')) return '雷达残骸';
  if (normalized.includes('water_treatment')) return '污水处理厂';
  if (normalized.includes('sewer')) return '污水泵站';
  if (normalized.includes('stables')) return '马厩';
  if (normalized.includes('supermarket')) return '超市';
  if (normalized.includes('train_tunnel') || normalized.includes('tunnel_entrance') || normalized.includes('subway') || normalized.includes('metro')) return '地铁入口';
  if (normalized.includes('train_yard')) return '列车站';
  if (normalized.includes('underwater_lab')) return '水下实验室';
  if (normalized.includes('large_barn') || normalized.includes('barn')) return '大型谷仓';
  if (normalized.includes('ranch')) return '牧场';
  if (normalized.includes('abandoned_boat')) return '废弃小船';
  if (normalized.includes('iceberg')) return '冰山';
  if (normalized.includes('medium_god_rock')) return '中型神石';
  if (normalized.includes('western_lighthouse')) return '西灯塔';
  if (normalized.includes('eastern_lighthouse')) return '东灯塔';
  if (normalized.includes('beached_tugboat')) return '搁浅拖船';
  if (normalized.includes('collapsed_tunnel')) return '坍塌隧道';
  if (normalized.includes('listening_station')) return '监听站';
  if (normalized.includes('security_tower')) return '警戒塔';
  if (normalized.includes('loading_dock')) return '装货码头';
  if (normalized.includes('convoy')) return '车队';
  if (normalized.includes('site_a')) return 'A区';
  if (normalized.includes('site_b')) return 'B区';
  if (normalized.includes('outpost_b3')) return '前哨站B3';
  if (normalized.includes('refinery')) return '炼油区';
  if (normalized.includes('pumping_station')) return '泵站';
  if (normalized.includes('water_well')) return '水井';
  if (normalized.includes('bandit')) return '强盗营地';
  return formatMonumentFallbackLabel(normalized);
}

function getMapResourceMonuments() {
  if (!state.serverMapSettings.showMonuments) return [];
  const list = Array.isArray(state.serverMap?.monuments) ? state.serverMap.monuments : [];
  const dedup = new Set();
  return list
    .map((m) => {
      const x = Number(m?.x);
      const y = Number(m?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const directLabel = String(m?.label || m?.name || '').trim();
      if (/discord\.gg|https?:\/\//i.test(directLabel)) return null;
      const tokenRaw = String(m?.token || m?.name || '').trim();
      const tokenTranslated = resolveMonumentLabel(tokenRaw);
      const tokenFallback = formatMonumentFallbackLabel(tokenRaw).toLowerCase();
      const shouldUseTokenLabel = !!tokenTranslated
        && tokenTranslated.toLowerCase() !== tokenFallback
        && tokenTranslated.toLowerCase() !== 'unknown';
      const directTranslated = directLabel ? resolveMonumentLabel(directLabel.replace(/\s+/g, '_')) : '';
      const label = shouldUseTokenLabel ? tokenTranslated : (directTranslated || directLabel);
      if (!label || String(label).toLowerCase() === 'monument marker') return null;
      const token = String(m?.token || m?.name || label);
      const key = `${label}:${Math.round(x)}:${Math.round(y)}`;
      if (dedup.has(key)) return null;
      dedup.add(key);
      return { x, y, token, label };
    })
    .filter(Boolean);
}

function renderServerMapLayer(teamMembers = state.serverMapView.teamMembers, vendingMarkers = state.serverMapView.vendingMarkers) {
  const subtitle = document.getElementById('server-map-subtitle');
  const mapImage = document.getElementById('server-map-image');
  const overlayCanvas = document.getElementById('server-map-overlay-canvas');
  const mapLayer = document.getElementById('server-map-layer');
  const emptyEl = document.getElementById('server-map-empty');
  const teamChip = document.getElementById('map-chip-team');
  const vendingChip = document.getElementById('map-chip-vending');
  const updatedChip = document.getElementById('map-chip-updated');
  const wrap = document.getElementById('server-map-wrap');
  if (!subtitle || !mapImage || !mapLayer || !emptyEl) return;

  state.serverMapView = {
    teamMembers: Array.isArray(teamMembers) ? teamMembers : [],
    vendingMarkers: Array.isArray(vendingMarkers) ? vendingMarkers : [],
  };
  let visibleVending = state.serverMapSettings.showVending
    ? state.serverMapView.vendingMarkers.filter((m) => !state.serverMapSettings.hideOutOfStock || !m?.outOfStock)
    : [];
  if (state._vendingSearchFilter) {
    visibleVending = visibleVending.filter((m) => {
      const orders = m?.sellOrders || [];
      return orders.some((o) => state._vendingSearchFilter.has(String(o?.itemId)));
    });
  }

  subtitle.textContent = state.connected
    ? `当前服务器：${state.currentServer?.name || '已连接'}`
    : '未连接服务器';
  teamChip.textContent = `👥 队伍: ${state.serverMapView.teamMembers.length}`;
  vendingChip.textContent = `🏪 售货机: ${visibleVending.length}/${state.serverMapView.vendingMarkers.length}`;
  updatedChip.textContent = `🕒 更新: ${formatMapUpdatedAt(state.serverMapLastAt)}`;

  if (!state.connected) {
    state.serverMapLayout = { renderedRect: null, imageRect: null, mapContext: null };
    mapLayer.innerHTML = '';
    mapImage.style.display = 'none';
    if (overlayCanvas) overlayCanvas.style.display = 'none';
    emptyEl.style.display = 'flex';
    emptyEl.textContent = '未连接服务器，无法加载地图';
    state.vendingById = {};
    state.vendingClusterById = {};
    state.selectedVendingId = '';
    state.selectedVendingGroupIds = [];
    renderVendingModal();
    state.teamClusterById = {};
    state.selectedTeamClusterId = '';
    renderTeamClusterPopover();
    renderServerMapCenterReticle();
    return;
  }
  if (!state.serverMapImageUrl) {
    state.serverMapLayout = { renderedRect: null, imageRect: null, mapContext: null };
    mapLayer.innerHTML = '';
    mapImage.style.display = 'none';
    if (overlayCanvas) overlayCanvas.style.display = 'none';
    emptyEl.style.display = 'flex';
    emptyEl.textContent = '暂无地图数据，请点击刷新地图';
    state.vendingById = {};
    state.vendingClusterById = {};
    state.selectedVendingId = '';
    state.selectedVendingGroupIds = [];
    renderVendingModal();
    state.teamClusterById = {};
    state.selectedTeamClusterId = '';
    renderTeamClusterPopover();
    renderServerMapCenterReticle();
    return;
  }

  mapImage.style.display = 'block';
  if (overlayCanvas) overlayCanvas.style.display = 'block';
  emptyEl.style.display = 'none';

  const monuments = getMapResourceMonuments();
  const mapContext = resolveMapCoordinateContext(state.serverMapView.teamMembers, visibleVending);
  const layout = syncServerMapImageLayout();
  const renderedRect = layout?.renderedRect || getMapRenderedRect();
  const imageRect = layout?.imageRect || null;
  if (!renderedRect || !Number.isFinite(mapContext?.coordinateSize) || mapContext.coordinateSize <= 0) {
    state.serverMapLayout = { renderedRect: null, imageRect: null, mapContext: null };
    mapLayer.innerHTML = '';
    state.vendingById = {};
    state.vendingClusterById = {};
    state.selectedVendingId = '';
    state.selectedVendingGroupIds = [];
    renderVendingModal();
    state.teamClusterById = {};
    state.selectedTeamClusterId = '';
    renderTeamClusterPopover();
    renderServerMapCenterReticle();
    return;
  }
  state.serverMapLayout = { renderedRect, imageRect, mapContext };
  mapLayer.style.clipPath = 'none';
  const wrapWidth = Number(wrap?.clientWidth || 0);
  const wrapHeight = Number(wrap?.clientHeight || 0);
  const camera = state.serverMapCamera;
  const points = [];
  const clusterById = {};
  drawServerMapOverlayCanvas(mapContext, renderedRect, imageRect, monuments, camera, wrap);

  const teamClusters = clusterTeamMembers(state.serverMapView.teamMembers, mapContext, renderedRect);
  for (let idx = 0; idx < teamClusters.length; idx += 1) {
    const cluster = teamClusters[idx];
    const members = Array.isArray(cluster?.members) ? cluster.members : [];
    const basePos = { x: Number(cluster?.x || 0), y: Number(cluster?.y || 0) };
    const pos = projectServerMapPixel(basePos, wrapWidth, wrapHeight, camera);
    if (!pos) continue;
    const multi = members.length > 1;
    const stateClass = multi ? getTeamClusterStateClass(members) : getTeamMemberStateClass(members[0] || {});
    const label = multi ? `${members.length}人` : String(members[0]?.name || 'Unknown');
    const detail = multi
      ? `${members.map((m) => String(m?.name || 'Unknown')).join(' / ')}`
      : `${members[0]?.isOnline ? '在线' : '离线'} · ${Number(members[0]?.x || 0).toFixed(0)},${Number(members[0]?.y || 0).toFixed(0)}`;
    const clusterId = `team_cluster_${idx}`;
    clusterById[clusterId] = { x: basePos.x, y: basePos.y, members };
    points.push(`
      <div class="server-map-point" ${multi ? `data-team-cluster-id="${clusterId}"` : ''} style="left:${pos.x}px;top:${pos.y}px;" title="${esc(detail)}">
        <div class="server-map-dot team ${stateClass}"></div>
        <div class="server-map-label player ${multi ? 'cluster' : ''}">${esc(label)}</div>
      </div>
    `);
  }

  const vendingById = {};
  const vendingClusters = clusterVendingMarkers(visibleVending, mapContext, renderedRect);
  const vendingClusterById = {};
  for (let idx = 0; idx < vendingClusters.length; idx += 1) {
    const cluster = vendingClusters[idx];
    const markers = Array.isArray(cluster?.markers) ? cluster.markers : [];
    if (!markers.length) continue;
    const ids = [];
    let anyOutOfStock = true;
    for (const marker of markers) {
      const markerId = String(marker?.id || '');
      if (markerId) {
        vendingById[markerId] = marker;
        ids.push(markerId);
      }
      if (!marker?.outOfStock) anyOutOfStock = false;
    }
    const anchorId = ids[0] || '';
    const isSelected = ids.some((id) => state.selectedVendingGroupIds.includes(id));
    const basePos = { x: Number(cluster?.x || 0), y: Number(cluster?.y || 0) };
    const pos = projectServerMapPixel(basePos, wrapWidth, wrapHeight, camera);
    if (!pos) continue;
    if (ids.length <= 1) {
      const marker = markers[0];
      const name = String(marker?.name || marker?.vendingMachineName || '售货机');
      const detail = `${marker?.outOfStock ? '售空' : '在售'} · ${Number(marker?.x || 0).toFixed(0)},${Number(marker?.y || 0).toFixed(0)}`;
      points.push(`
        <div class="server-map-point server-map-point-vending ${isSelected ? 'selected' : ''}" data-vending-id="${esc(anchorId)}" style="left:${pos.x}px;top:${pos.y}px;" title="${esc(name)} ${esc(detail)}">
          ${renderServerMapVendingIcon(!!marker?.outOfStock)}
        </div>
      `);
      continue;
    }
    const clusterId = `vending_cluster_${idx}`;
    vendingClusterById[clusterId] = { ids, anchorId, x: basePos.x, y: basePos.y };
    points.push(`
      <div class="server-map-point server-map-point-vending ${isSelected ? 'selected' : ''}" data-vending-cluster-id="${esc(clusterId)}" style="left:${pos.x}px;top:${pos.y}px;" title="${esc(`重叠售货机 x${ids.length}`)}">
        <div class="server-map-vending-cluster ${anyOutOfStock ? 'oos' : ''}">${ids.length}</div>
      </div>
    `);
  }

  state.vendingById = vendingById;
  state.vendingClusterById = vendingClusterById;
  state.teamClusterById = clusterById;
  if (state.selectedTeamClusterId && !state.teamClusterById[state.selectedTeamClusterId]) {
    state.selectedTeamClusterId = '';
  }
  if (state.selectedVendingId && !state.vendingById[state.selectedVendingId]) {
    state.selectedVendingId = '';
    state.selectedVendingGroupIds = [];
  }
  renderTeamClusterPopover();
  renderVendingModal();
  mapLayer.innerHTML = points.join('') + renderMapDebugOverlay(renderedRect, mapContext);
  renderServerMapImageCanvas();
  renderServerMapCenterReticle();
}

async function refreshServerMap(forceMapReload = false) {
  const subtitle = document.getElementById('server-map-subtitle');
  if (subtitle) {
    subtitle.textContent = state.connected
