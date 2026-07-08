/* =====================================================================
   TerraForge — 機械ロジック / アイテム / コンベア自動接続
   ===================================================================== */
import { state, gameState } from './state.js';
import { ORES, DIRS, AUTOCRAFT_USABLE } from './constants.js';
import { CONVEYOR_SPEED, FAST_SPEED, CHEST_CAPACITY, SMELTER_QUEUE_MAX, CRAFTER_STOCK_PER_KIND, CRAFTER_STOCK_TOTAL, MERGER_QUEUE_MAX } from './balance.js';
import { worldX, worldZ, tileTopY, yJitter, inGrid, key } from './world.js';
import { buildConveyorMeshShaped, buildFilterConveyorMeshShaped, updateFilterGem, applyFastConveyorTint, sharedMat, BELT_ARM, BELT_W } from './render/meshes.js';
import { scene } from './render/scene.js';
import { MACHINE_DEFS } from './machineDefs.js';
import { ctx } from './ctx.js';
import { bus } from './core/EventBus.js';
import { Events } from './core/events.js';
import { formatMoney } from './util/format.js';

/* ---------------- アイテム(Phase05: InstancedMesh化・プール) ---------------- */
export function spawnItem(oreType, ingot, gx, gz) {
  const y = tileTopY(gx, gz) + 0.35;
  const pos = new THREE.Vector3(worldX(gx), y, worldZ(gz));
  return ctx.itemPool.acquire(oreType, ingot, gx, gz, pos);
}
export function releaseItem(it) {
  ctx.itemPool.release(it);
}
export function itemValue(it) { return it.ingot ? ORES[it.oreType].ingotValue : ORES[it.oreType].oreValue; }

/* 高さ判定: 地表レベル(標高-掘削深さ)の差が1以内なら接続可能 */
export function heightOk(gx1, gz1, gx2, gz2) {
  if (!inGrid(gx1, gz1) || !inGrid(gx2, gz2)) return false;
  const l1 = state.tiles[gx1][gz1].elev - state.tiles[gx1][gz1].depth;
  const l2 = state.tiles[gx2][gz2].elev - state.tiles[gx2][gz2].depth;
  return Math.abs(l1 - l2) <= 1;
}
export function chestTotal(m) {
  return stockTotal(m.storage);
}
export function stockTotal(stock) {
  let sum = 0;
  for (const k in stock) sum += stock[k];
  return sum;
}
export function formatStockKey(k) {
  const ingot = k.endsWith('_i');
  const oreType = k.slice(0, -2);
  return (ORES[oreType] ? ORES[oreType].name : oreType) + (ingot ? 'インゴット' : '鉱石');
}
export function hasStock(stock, needs) {
  for (const k in needs) if ((stock[k] || 0) < needs[k]) return false;
  return true;
}

/* ---------------- セーブ復元用ヘルパー(Phase06) ----------------
   ロード時、移動中だったアイテムの行き先マスが既に別のアイテムで
   埋まっている場合(「暗黙の二重占有」)に、最寄りのチェストへ格納するか、
   チェストが1つも無ければ破棄するために使う。 */
/**
 * (gx,gz) から見て最も近いチェスト機械を探す(マンハッタン距離)。
 * @param {number} gx
 * @param {number} gz
 * @returns {object|null} 最寄りのチェスト機械。存在しなければ null
 */
export function findNearestChest(gx, gz) {
  let best = null, bestDist = Infinity;
  for (const m of state.machines.values()) {
    if (m.type !== 'chest') continue;
    const d = Math.abs(m.gx - gx) + Math.abs(m.gz - gz);
    if (d < bestDist) { bestDist = d; best = m; }
  }
  return best;
}

/**
 * 復元対象のアイテム({o: oreType, i: 0|1})を、行き先が埋まっていた場合に
 * 最寄りのチェストへ格納する。チェストが無い/満杯なら破棄(何もしない)。
 * @param {string} oreType
 * @param {boolean} ingot
 * @param {number} gx 行き先だったマスの座標(最寄りチェスト探索の起点)
 * @param {number} gz
 * @returns {boolean} チェストへ格納できた場合 true
 */
export function depositIntoNearestChestOrDiscard(oreType, ingot, gx, gz) {
  const chest = findNearestChest(gx, gz);
  if (!chest) return false;
  if (chestTotal(chest) >= chest.cap) return false;
  const sk = oreType + (ingot ? '_i' : '_o');
  chest.storage[sk] = (chest.storage[sk] || 0) + 1;
  return true;
}
export function consumeStock(stock, needs) {
  for (const k in needs) {
    stock[k] = (stock[k] || 0) - needs[k];
    if (stock[k] <= 0) delete stock[k];
  }
}

/* ---------------- コンベアの自動接続(曲げ) ---------------- */
// 向きを合わせれば接続を受け取れる可能性がある機械の種類
export const ACCEPT_TYPES = new Set(['conveyor', 'fastConveyor', 'filterConveyor', 'splitter', 'merger', 'smelter', 'autoCrafter', 'seller', 'chest']);
export function isAcceptCapable(type) { return ACCEPT_TYPES.has(type); }

/* 機械がアイテムを送り出す方向の一覧(販売機は消費するだけで出力なし) */
export function outputDirsOf(m) {
  if (!m || m.dir === undefined || m.type === 'seller') return [];
  if (m.type === 'splitter' || m.type === 'filterConveyor') return [m.dir, (m.dir + 1) % 4, (m.dir + 3) % 4];
  return [m.dir];
}
export function inputDirsOf(m) {
  if (!m || m.dir === undefined) return [];
  if (m.type === 'seller') return [0, 1, 2, 3];
  if (m.type === 'splitter' || m.type === 'filterConveyor' || m.type === 'chest' || m.type === 'autoCrafter' || m.type === 'smelter') return [(m.dir + 2) % 4];
  if (m.type === 'merger') return [(m.dir + 2) % 4, (m.dir + 1) % 4, (m.dir + 3) % 4];
  return [0, 1, 2, 3].filter(d => !outputDirsOf(m).includes(d));
}
export function incomingSideDir(target, fromGx, fromGz) {
  for (let d = 0; d < 4; d++) {
    if (fromGx === target.gx + DIRS[d].x && fromGz === target.gz + DIRS[d].z) return d;
  }
  return -1;
}
/* (fromGx,fromGz) から機械 target へアイテムを送り込める配置かどうか。
   相手の入出力ポート以外への接続を禁止して誤接続を防ぐ */
export function connectionOk(target, fromGx, fromGz) {
  if (!target || !isAcceptCapable(target.type)) return false;
  if (!heightOk(fromGx, fromGz, target.gx, target.gz)) return false;
  const inSide = incomingSideDir(target, fromGx, fromGz);
  if (inSide === -1) return false;
  return inputDirsOf(target).includes(inSide);
}

/* (gx,gz) に隣接する機械の中で、出力方向がちょうどここを指しているものを探し、
   その来ている向き(0=E,1=S,2=W,3=N)を返す。無ければ -1 */
export function incomingDir(gx, gz) {
  for (let k = 0; k < 4; k++) {
    const nx = gx + DIRS[k].x, nz = gz + DIRS[k].z;
    const nb = state.machines.get(key(nx, nz));
    // 分岐器の左右出力も「流れ込み」として認識し、届かない高低差は無視する
    if (nb && outputDirsOf(nb).includes((k + 2) % 4) && heightOk(gx, gz, nx, nz)) return k;
  }
  return -1;
}

/* コンベア/フィルターコンベア設置時、周囲の接続可能な機械へ自動的に向きを合わせる(曲がる)。
   1) 既に流れ込んでくる機械があれば、まっすぐ抜ける方向を優先しつつ左右の受け入れ先も探す
   2) 流れ込みがなければ、手動で選んだ向き→周囲の受け入れ先の順で探す */
export function chooseAutoDir(gx, gz, manualDir) {
  const inK = incomingDir(gx, gz);
  const tryDirs = [];
  if (inK !== -1) {
    const straight = (inK + 2) % 4;
    tryDirs.push(straight, (straight + 1) % 4, (straight + 3) % 4);
  } else {
    tryDirs.push(manualDir);
  }
  if (!tryDirs.includes(manualDir)) tryDirs.push(manualDir);
  for (let d = 0; d < 4; d++) if (!tryDirs.includes(d)) tryDirs.push(d);

  for (const d of tryDirs) {
    if (inK !== -1 && d === inK) continue; // 来た方向へは吐き出さない
    const nx = gx + DIRS[d].x, nz = gz + DIRS[d].z;
    const nb = state.machines.get(key(nx, nz));
    if (connectionOk(nb, gx, gz)) return d;
  }
  // どこにも繋がらない場合、入力元へ吐き出す向きにだけはしない(逆流防止)
  if (inK !== -1 && manualDir === inK) return (inK + 2) % 4;
  return manualDir;
}

/* 新しい機械を (gx,gz) に置いた直後、隣接するコンベア/フィルターコンベアのうち
   現在の出力先が無効(何も繋がっていない/受け取れない)なものを、この新しい機械へ向け直す */
export function tryAutoConnectNeighbors(gx, gz) {
  for (let k = 0; k < 4; k++) {
    const nx = gx + DIRS[k].x, nz = gz + DIRS[k].z;
    if (!inGrid(nx, nz)) continue;
    const nb = state.machines.get(key(nx, nz));
    if (!nb || (nb.type !== 'conveyor' && nb.type !== 'fastConveyor' && nb.type !== 'filterConveyor')) continue;
    const dirToNew = (k + 2) % 4; // このコンベアから見て新しい機械がある向き
    const curTx = nb.gx + DIRS[nb.dir].x, curTz = nb.gz + DIRS[nb.dir].z;
    const curTarget = state.machines.get(key(curTx, curTz));
    const curValid = connectionOk(curTarget, nb.gx, nb.gz);
    if (curValid) continue; // 既に正しく接続済みなら変更しない
    const inK = incomingDir(nb.gx, nb.gz);
    if (inK === dirToNew) continue; // 入力元へ向けてしまうのは避ける
    const target = state.machines.get(key(gx, gz));
    if (connectionOk(target, nb.gx, nb.gz)) {
      nb.dir = dirToNew;
      nb.mesh.rotation.y = -nb.dir * Math.PI / 2;
    }
  }
}

/* ---------------- コンベアの繋ぎ目(直線/L字カーブ)の自動更新 ----------------
   周囲の機械の出力がどの向きから流れ込んでくるかを調べ、
   直線ベルト / L字カーブベルト のメッシュを貼り替える。設置・撤去・回転のたびに呼ぶ */
export function incomingDirsAll(gx, gz) {
  const res = [];
  for (let k = 0; k < 4; k++) {
    const nx = gx + DIRS[k].x, nz = gz + DIRS[k].z;
    const nb = state.machines.get(key(nx, nz));
    if (!nb) continue;
    // 分岐器の3方向出力も繋ぎ目として扱う。出力を持たない販売機は無視(ベルト形状の誤判定修正)
    if (outputDirsOf(nb).includes((k + 2) % 4) && heightOk(gx, gz, nx, nz)) res.push(k);
  }
  return res;
}
export function beltShapeFor(m) {
  const ins = incomingDirsAll(m.gx, m.gz);
  if (ins.length === 0 || ins.includes((m.dir + 2) % 4)) return 'straight'; // 真後ろから来ていれば直線
  if (ins.includes((m.dir + 1) % 4)) return 'left';   // ローカル+Z側から受けるカーブ
  if (ins.includes((m.dir + 3) % 4)) return 'right';  // ローカル-Z側から受けるカーブ
  return 'straight';
}

export function localArmForDir(m, globalDir) {
  const rel = (globalDir - m.dir + 4) % 4;
  if (rel === 0) return { axis: 'x', sign: 1 };
  if (rel === 1) return { axis: 'z', sign: 1 };
  if (rel === 2) return { axis: 'x', sign: -1 };
  return { axis: 'z', sign: -1 };
}
export function addGradeOverlays(m) {
  if (!m.mesh || (m.type !== 'conveyor' && m.type !== 'filterConveyor')) return;
  const old = m.mesh.getObjectByName('gradeOverlays');
  if (old) m.mesh.remove(old);
  const group = new THREE.Group();
  group.name = 'gradeOverlays';
  const mat = sharedMat('beltGrade', () => new THREE.MeshStandardMaterial({ color: 0x5f6f93, metalness: .35, roughness: .45 }));
  const dirs = [m.dir, ...incomingDirsAll(m.gx, m.gz)];
  const seen = new Set();
  for (const d of dirs) {
    if (seen.has(d)) continue; seen.add(d);
    const nx = m.gx + DIRS[d].x, nz = m.gz + DIRS[d].z;
    if (!inGrid(nx, nz) || !heightOk(m.gx, m.gz, nx, nz)) continue;
    const delta = tileTopY(nx, nz) - tileTopY(m.gx, m.gz);
    if (Math.abs(delta) < 0.01) continue;
    const arm = localArmForDir(m, d);
    const len = BELT_ARM + 0.18;
    const geo = arm.axis === 'x' ? new THREE.BoxGeometry(len, 0.08, BELT_W * 0.92) : new THREE.BoxGeometry(BELT_W * 0.92, 0.08, len);
    const ramp = new THREE.Mesh(geo, mat);
    if (arm.axis === 'x') {
      ramp.position.set(arm.sign * len / 2, 0.23 + delta / 2, 0);
      ramp.rotation.z = -arm.sign * Math.atan2(delta, len);
    } else {
      ramp.position.set(0, 0.23 + delta / 2, arm.sign * len / 2);
      ramp.rotation.x = arm.sign * Math.atan2(delta, len);
    }
    ramp.receiveShadow = true;
    group.add(ramp);
  }
  if (group.children.length) m.mesh.add(group);
}

export function rebuildBeltMesh(m) {
  if (m.type !== 'conveyor' && m.type !== 'fastConveyor' && m.type !== 'filterConveyor') return;
  const shape = m.type === 'filterConveyor' ? 'filter3' : beltShapeFor(m);
  if (m.mesh && m.mesh.userData.beltShape === shape) {
    m.mesh.rotation.y = -m.dir * Math.PI / 2; // 向きだけ変わった場合の同期
    addGradeOverlays(m);
    return;
  }
  const old = m.mesh;
  const nm = (m.type === 'conveyor' || m.type === 'fastConveyor') ? buildConveyorMeshShaped(shape) : buildFilterConveyorMeshShaped();
  nm.position.copy(old.position);
  nm.rotation.y = -m.dir * Math.PI / 2;
  scene.remove(old);
  scene.add(nm);
  m.mesh = nm;
  if (m.type === 'filterConveyor') updateFilterGem(m);
  if (m.type === 'fastConveyor') applyFastConveyorTint(m.mesh);
  addGradeOverlays(m);
}
export function rebuildBeltsAround(gx, gz) {
  const self = state.machines.get(key(gx, gz));
  if (self) rebuildBeltMesh(self);
  for (let k = 0; k < 4; k++) {
    const nb = state.machines.get(key(gx + DIRS[k].x, gz + DIRS[k].z));
    if (nb) rebuildBeltMesh(nb);
  }
}

/* 受け入れ判定(fromGx/fromGzは送り出す側のマス座標。高低差チェックに使用) */
export function canAccept(m, it, fromGx, fromGz) {
  if (!m) return false;
  if (!connectionOk(m, fromGx, fromGz)) return false; // 高低差・逆流を禁止
  const def = MACHINE_DEFS[m.type];
  if (def && def.canAcceptItem) return def.canAcceptItem(m, it, fromGx, fromGz);
  return false;
}

/* item を機械 m のセルへ送る(占有処理込み) */
export function sendItemTo(it, m, moveSpeed) {
  it.from = it.pos.clone();
  it.to = new THREE.Vector3(worldX(m.gx), tileTopY(m.gx, m.gz) + 0.35, worldZ(m.gz));
  it.t = 0;
  it.moving = true;
  it.destKey = key(m.gx, m.gz);
  it.moveSpeed = moveSpeed || CONVEYOR_SPEED;
  if (m.type === 'conveyor' || m.type === 'fastConveyor' || m.type === 'splitter' || m.type === 'filterConveyor') m.item = it; // 予約
  else if (m.type === 'smelter' || m.type === 'autoCrafter' || m.type === 'merger' || m.type === 'chest') m.incoming++;       // 到着前の予約数
}

export function arriveItem(it) {
  it.moving = false;
  const m = state.machines.get(it.destKey);
  if (!m) { releaseItem(it); return; }
  it.gx = m.gx; it.gz = m.gz;
  if ((m.type === 'smelter' || m.type === 'autoCrafter' || m.type === 'merger' || m.type === 'chest') && m.incoming > 0) m.incoming--;
  if (m.type === 'seller') {
    const v = itemValue(it);
    gameState.earn(v);
    ctx.sfx('sell');
    ctx.spawnFloater('+' + formatMoney(v), m.mesh.position.clone().add(new THREE.Vector3(0, 1.4, 0)), '#7dffa8');
    const burstPos = m.mesh.position.clone().add(new THREE.Vector3(0, 1.0, 0));
    for (let i = 0; i < 5; i++) {
      ctx.spawnParticle('spark', burstPos, { life: 0.5, scale: 0.16, vel: new THREE.Vector3((Math.random() - 0.5) * 1.6, 1.2 + Math.random(), (Math.random() - 0.5) * 1.6), grow: 0.5 });
    }
    bus.emit(Events.ITEM_SOLD, { oreType: it.oreType, ingot: !!it.ingot, value: v, gx: m.gx, gz: m.gz });
    releaseItem(it);
  } else if (m.type === 'smelter') {
    m.buffer.push({ oreType: it.oreType });
    releaseItem(it);
  } else if (m.type === 'autoCrafter') {
    const sk = it.oreType + (it.ingot ? '_i' : '_o');
    m.craftStock[sk] = (m.craftStock[sk] || 0) + 1;
    releaseItem(it);
  } else if (m.type === 'merger') {
    m.buffer.push({ oreType: it.oreType, ingot: it.ingot });
    releaseItem(it);
  } else if (m.type === 'chest') {
    const k = it.oreType + (it.ingot ? '_i' : '_o');
    m.storage[k] = (m.storage[k] || 0) + 1;
    releaseItem(it);
  }
  // conveyor / splitter / filterConveyor: そのまま滞留、updateで次へ
}