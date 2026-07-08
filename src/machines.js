/* =====================================================================
   TerraForge — 機械設置・削除・回転・アップグレード・更新ループ
   ===================================================================== */
import { state, gameState } from './state.js';
import { COSTS, ORES, DIRS, DIR_ARROWS, CHEST_UPGRADE_RULES, AUTOCRAFT_RECIPES, FILTER_CYCLE, FILTER_LABEL, FILTER_ICON, LH, MAX_DEPTH } from './constants.js';
import { powerGrid } from './power.js';
import { CHEST_CAPACITY, CONVEYOR_SPEED, FAST_SPEED } from './balance.js';
import { worldX, worldZ, tileTopY, yJitter, inGrid, key, refreshTile } from './world.js';
import { MESH_BUILDERS, updateFilterGem, applyFastConveyorTint, sharedMat, BELT_ARM, BELT_W } from './render/meshes.js';
import { scene, cam } from './render/scene.js';
import { canAccept, chooseAutoDir, tryAutoConnectNeighbors, rebuildBeltsAround, sendItemTo, spawnItem, releaseItem, chestTotal, stockTotal, hasStock, consumeStock, formatStockKey, rebuildBeltMesh, heightOk, connectionOk, itemValue } from './logistics.js';
import { MACHINE_DEFS } from './machineDefs.js';
import { ctx } from './ctx.js';
import { sfx } from './audio.js';
import { bus } from './core/EventBus.js';
import { Events } from './core/events.js';
import { formatMoney, vibrate } from './util/format.js';

function placeMachine(type, gx, gz, dir, silent, forceDir, quiet) {
  if (!inGrid(gx, gz) || state.machines.has(key(gx, gz))) { if (!silent) ctx.toast('そこには置けないよ', 'error'); return false; }
  const t = state.tiles[gx][gz];
  // ロード時(silent)は露出チェックをスキップ
  if ((type === 'drill' || type === 'drill2') && !silent) {
    const exposed = t.ore && ORES[t.ore.type].depth === t.depth;
    if (!exposed) { ctx.toast('ドリルは露出した鉱石の上に設置!', 'error'); return false; }
  }
  if (!silent && state.money < COSTS[type]) { ctx.toast('お金が足りない… ' + formatMoney(COSTS[type]) + ' 必要', 'error'); return false; }
  if (!silent) gameState.addMoney(-COSTS[type]);

  // 通常コンベア/フィルターコンベアは、近くの接続可能な機械へ自動で向きを合わせる(曲がる)。
  // ただしビルドドラッグ設置中(forceDir)は進行方向を最優先するため自動判定をスキップする。
  let placeDir = dir;
  if (!silent && !forceDir && (type === 'conveyor' || type === 'fastConveyor' || type === 'filterConveyor')) {
    placeDir = chooseAutoDir(gx, gz, dir);
  }

  const mesh = MESH_BUILDERS[type]();
  mesh.position.set(worldX(gx), tileTopY(gx, gz) + yJitter(gx, gz), worldZ(gz));
  mesh.rotation.y = -placeDir * Math.PI / 2;
  scene.add(mesh);
  const m = {
    type, gx, gz, dir: placeDir, mesh, timer: 0, item: null, buffer: [], progress: 0, processing: null,
    incoming: 0,                                        // この機械へ移動中のアイテム数(バッファ溢れ防止)
    outIndex: 0,                                        // 分岐器の出力ラウンドロビン用ポインタ
    rejectIndex: 0,                                     // フィルター分岐の不一致出力切替
    storage: {}, cap: CHEST_CAPACITY,                   // チェスト用の保管庫
    filter: type === 'filterConveyor' ? state.selectedFilter : undefined, // フィルターコンベア用の対象鉱石
    craftStock: {}, craftRecipe: null, craftProgress: 0, selectedRecipeId: 'auto', // 自動工房用
  };
  state.machines.set(key(gx, gz), m);
  if (type === 'filterConveyor') updateFilterGem(m);
  if (type === 'fastConveyor') applyFastConveyorTint(m.mesh);
  refreshTile(gx, gz);
  if (!silent) {
    tryAutoConnectNeighbors(gx, gz); // 周囲の行き先を見失っているコンベアをこの新しい機械へ自動接続
    if (!quiet) {
      sfx('place');
      if (type === 'drill' && t.ore) ctx.toast('ドリルを設置!(' + ORES[t.ore.type].name + ' 無限鉱脈)', 'good');
      else ctx.toast(toolLabel(type) + 'を設置!', 'good');
    }
  }
  rebuildBeltsAround(gx, gz); // 自分と周囲のコンベアの繋ぎ目(直線/カーブ)を再構築
  powerGrid.rebuild(state.machines.values());
  bus.emit(Events.MACHINE_PLACED, { type, gx, gz, dir: placeDir, machine: m, silent });
  return true;
}

function removeMachine(gx, gz, quiet) {
  const m = state.machines.get(key(gx, gz));
  if (!m) return false;
  const removedType = m.type;
  scene.remove(m.mesh);
  if (m.item) releaseItem(m.item);
  if (m.processing) m.processing = null;
  state.machines.delete(key(gx, gz));
  const def = MACHINE_DEFS[m.type];
  const refundRate = def && def.refundRate !== undefined ? def.refundRate : 0.5;
  const refund = Math.floor((COSTS[m.type] || 0) * refundRate);
  gameState.addMoney(refund);
  refreshTile(gx, gz);
  powerGrid.rebuild(state.machines.values());
  rebuildBeltsAround(gx, gz); // 撤去で入力が変わった周囲のコンベア形状を更新
  if (!quiet) {
    sfx('demolish');
    ctx.toast(toolLabel(m.type) + 'を撤去(' + Math.round(refundRate * 100) + '%返金)', 'good');
  }
  bus.emit(Events.MACHINE_REMOVED, { type: removedType, gx, gz, refund });
  return true;
}

export function toolLabel(t) {
  return {
    dig: '掘削', fill: '盛土', drill: 'ドリル', drill2: 'ドリルMk2',
    conveyor: 'コンベア', fastConveyor: '高速コンベア',
    smelter: '精錬炉', autoCrafter: '自動工房', seller: '販売機',
    demolish: '撤去', splitter: '分岐器', merger: '合流機',
    chest: 'チェスト', filterConveyor: 'フィルターコンベア', generator: '発電機'
  }[t] || t;
}

function replaceMachineType(m, newType) {
  if (!m || m.type === newType || !MESH_BUILDERS[newType]) return false;
  if (m.item || m.incoming > 0) return false;
  // 精錬炉→自動工房は処理中/待ち鉱石を在庫へ引き継げるので許可。それ以外は処理中のアップグレードを不可に
  const smelterToCrafter = m.type === 'smelter' && newType === 'autoCrafter';
  if ((m.processing || (m.buffer && m.buffer.length > 0)) && !smelterToCrafter) return false;
  const oldMesh = m.mesh;
  const nm = MESH_BUILDERS[newType]();
  nm.position.copy(oldMesh.position);
  nm.rotation.copy(oldMesh.rotation);
  scene.remove(oldMesh);
  scene.add(nm);
  m.mesh = nm;
  m.type = newType;
  m.timer = 0;
  if (newType === 'filterConveyor' && !m.filter) m.filter = state.selectedFilter;
  if (newType === 'fastConveyor') applyFastConveyorTint(m.mesh);
  if (newType === 'autoCrafter') {
    m.craftStock = m.craftStock || {};
    // 精錬炉の待ち行列・処理中の鉱石を自動工房の在庫へ引き継ぎ(素材ロス防止)
    if (m.buffer && m.buffer.length > 0) {
      for (const b of m.buffer) { const sk = b.oreType + '_o'; m.craftStock[sk] = (m.craftStock[sk] || 0) + 1; }
    }
    if (m.processing) { const sk = m.processing.oreType + '_o'; m.craftStock[sk] = (m.craftStock[sk] || 0) + 1; }
    m.buffer = [];
    m.processing = null;
    m.progress = 0;
    m.craftRecipe = null;
    m.craftProgress = 0;
    m.selectedRecipeId = m.selectedRecipeId || 'auto';
  }
  refreshTile(m.gx, m.gz);
  rebuildBeltsAround(m.gx, m.gz);
  powerGrid.rebuild(state.machines.values());
  return true;
}
export function getTotalChestStock() {
  const total = {};
  for (const m of state.machines.values()) {
    if (m.type !== 'chest') continue;
    for (const k in m.storage) total[k] = (total[k] || 0) + (m.storage[k] || 0);
  }
  return total;
}
export function consumeStockFromAllChests(needs) {
  for (const needKey in needs) {
    let remain = needs[needKey];
    if (remain <= 0) continue;
    for (const m of state.machines.values()) {
      if (m.type !== 'chest' || remain <= 0) continue;
      const has = m.storage[needKey] || 0;
      if (has <= 0) continue;
      const take = Math.min(has, remain);
      m.storage[needKey] = has - take;
      if (m.storage[needKey] <= 0) delete m.storage[needKey];
      remain -= take;
    }
  }
}
export function machineBusyForUpgrade(m) {
  return !!(m.item || m.incoming > 0 || m.processing);
}
export function applyGlobalUpgrade(rule) {
  const targets = [...state.machines.values()].filter(m => m.type === rule.from);
  if (targets.length === 0) {
    ctx.toast('アップグレード対象の ' + toolLabel(rule.from) + ' がありません', 'error');
    return false;
  }
  if (targets.some(machineBusyForUpgrade)) {
    ctx.toast('稼働中の機械があります。流れているアイテムが止まってから実行してください', 'error');
    return false;
  }
  const stock = getTotalChestStock();
  if (!hasStock(stock, rule.needs)) {
    ctx.toast('素材不足: ' + Object.entries(rule.needs).map(([k, v]) => formatStockKey(k) + ' x' + v).join(' / '), 'error');
    return false;
  }
  consumeStockFromAllChests(rule.needs);
  let upgraded = 0;
  for (const m of targets) if (replaceMachineType(m, rule.to)) upgraded++;
  if (upgraded > 0) {
    sfx('upgrade');
    ctx.toast('⬆️ ' + toolLabel(rule.from) + ' を一括で ' + toolLabel(rule.to) + ' にアップグレード! (' + upgraded + '台)', 'good');
    return true;
  }
  ctx.toast('アップグレードに失敗しました', 'error');
  return false;
}
export function countMachineType(type) {
  let n = 0;
  for (const m of state.machines.values()) if (m.type === type) n++;
  return n;
}

/* ---------------- 更新ループ ---------------- */
export function updateMachines(dt) {
  for (const m of state.machines.values()) {
    const def = MACHINE_DEFS[m.type];
    if (def && def.update) def.update(m, dt);
  }
}

export function updateItems(dt) {
  for (const it of ctx.itemPool.slots) {
    if (!it.active) continue;
    if (it.moving) {
      it.t += dt * (it.moveSpeed || CONVEYOR_SPEED);
      if (it.t >= 1) { it.pos.copy(it.to); ctx.arriveItem(it); }
      else {
        it.pos.lerpVectors(it.from, it.to, it.t);
        it.rotY += dt * 2;
      }
    }
  }
}

export function rotateMachine(m) {
  m.dir = (m.dir + 1) % 4;
  m.mesh.rotation.y = -m.dir * Math.PI / 2;
  if (m.type === 'conveyor' || m.type === 'fastConveyor' || m.type === 'filterConveyor') ctx.tryAutoConnectNeighbors(m.gx, m.gz);
  ctx.rebuildBeltsAround(m.gx, m.gz); // 回転で入出力が変わるので繋ぎ目形状を更新
  ctx.spawnFloater(DIR_ARROWS[m.dir], m.mesh.position.clone().add(new THREE.Vector3(0, 1.3, 0)), '#ffe066');
  ctx.toast(toolLabel(m.type) + 'の向きを変更: ' + DIR_ARROWS[m.dir], 'good');
  sfx('rotate');
  vibrate(25);
  bus.emit(Events.MACHINE_ROTATED, { gx: m.gx, gz: m.gz, dir: m.dir, machine: m });
}
export function moveMachineTo(m, gx, gz) {
  if (!ctx.canMoveMachineTo(m, gx, gz)) { ctx.toast('移動できません: 空きマス/状態を確認してね', 'error'); return false; }
  const ox = m.gx, oz = m.gz;
  state.machines.delete(key(ox, oz));
  m.gx = gx; m.gz = gz;
  m.mesh.position.set(worldX(gx), tileTopY(gx, gz) + yJitter(gx, gz), worldZ(gz));
  state.machines.set(key(gx, gz), m);
  refreshTile(ox, oz); refreshTile(gx, gz);
  ctx.rebuildBeltsAround(ox, oz); ctx.rebuildBeltsAround(gx, gz);
  powerGrid.rebuild(state.machines.values());
  ctx.toast(toolLabel(m.type) + 'を移動しました', 'good');
  bus.emit(Events.MACHINE_MOVED, { fromX: ox, fromZ: oz, toX: gx, toZ: gz, machine: m });
  return true;
}
export function canMoveMachineTo(m, gx, gz) {
  if (!m || !inGrid(gx, gz) || state.machines.has(key(gx, gz))) return false;
  if (m.item || m.incoming > 0 || m.processing) return false;
  if (m.type === 'drill' || m.type === 'drill2') {
    const t = state.tiles[gx][gz];
    return !!(t.ore && ORES[t.ore.type].depth === t.depth);
  }
  return true;
}

/**
 * Phase10: アンドゥ専用の返金なし撤去。
 * PlaceMachineCmd.undo(「設置をなかったことにする」)専用。
 * 通常の removeMachine と異なり返金・トースト・効果音・イベント発火を
 * 一切行わない(呼び出し元の Command 層が bus イベントを発火する)。
 * @returns {boolean} 撤去できたか(対象が存在しない場合は false)
 */
function removeMachineNoRefund(gx, gz) {
  const m = state.machines.get(key(gx, gz));
  if (!m) return false;
  scene.remove(m.mesh);
  if (m.item) releaseItem(m.item);
  if (m.processing) m.processing = null;
  state.machines.delete(key(gx, gz));
  refreshTile(gx, gz);
  powerGrid.rebuild(state.machines.values());
  rebuildBeltsAround(gx, gz);
  return true;
}

// Export for ctx injection
export { placeMachine, removeMachine, removeMachineNoRefund };