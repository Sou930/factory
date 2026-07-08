/* =====================================================================
   TerraForge — タップ処理 / 機械操作メニュー / お金・UI表示
     カメラパッド / マップパン / キーボード操作 / タッチ・慣性ドラッグ
   ===================================================================== */
import { state, gameState } from './state.js';
import { GRID, TS, LH, MAX_DEPTH, ELEV_MAX, ORES, DIRS, DIR_ARROWS, COSTS, FILTER_CYCLE, FILTER_LABEL, FILTER_ICON, POWER_RANGE, AUTOCRAFT_RECIPES } from './constants.js';
import { CHEST_CAPACITY } from './balance.js';
import { worldX, worldZ, tileTopY, yJitter, inGrid, key, refreshTile } from './world.js';
import { scene, camera, cam, canvas, updateCamera, onResize } from './render/scene.js';
import { placeMachine, canMoveMachineTo, toolLabel } from './machines.js';
import { canAccept, rebuildBeltsAround, itemValue } from './logistics.js';
import { updateParticles, updateFloaters, doScan, spawnParticle, spawnFloater, clearScan } from './particles.js';
import { powerGrid } from './power.js';
import { sfx, getMuted, setMuted } from './audio.js';
import { toast, earn, updateStatus, setStatus, openUpgradeModal, closeUpgradeModal, openRecipeModal, closeRecipeModal, updateMuteIcon, checkMilestones, addMoney, baseStatusForTool, describeConnectionPreview, countMachineType, syncToolbarToCurrentTool } from './ui.js';
import { saveGame } from './save.js';
import { tileIMesh } from './world.js';
import { ctx } from './ctx.js';
import { bus } from './core/EventBus.js';
import { Events } from './core/events.js';
import { formatMoney, vibrate } from './util/format.js';
import { commandStack, PlaceMachineCmd, RemoveMachineCmd, DigCmd, FillCmd, RotateCmd, MoveCmd, BatchCmd, SetDirCmd } from './core/CommandStack.js';

/* ---------------- タップ処理 ---------------- */
const raycaster = new THREE.Raycaster();
function pickTile(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const p = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(p, camera);
  const hits = raycaster.intersectObject(tileIMesh, false);
  if (hits.length > 0 && hits[0].instanceId !== undefined) {
    const id = hits[0].instanceId;
    return { gx: Math.floor(id / GRID), gz: id % GRID, isTile: true };
  }
  return null;
}

function cashOutChest(m) {
  let total = 0, count = 0;
  for (const k in m.storage) {
    const ingot = k.endsWith('_i');
    const oreType = k.slice(0, -2);
    const v = ingot ? ORES[oreType].ingotValue : ORES[oreType].oreValue;
    total += v * m.storage[k];
    count += m.storage[k];
  }
  if (count === 0) { toast('チェストは空っぽ', 'error'); return; }
  m.storage = {};
  // gameState.earn は milestone 判定込み。値はここでは1回の売却なので1回だけ emit
  gameState.earn(total);
  sfx('sell');
  spawnFloater('+' + formatMoney(total), m.mesh.position.clone().add(new THREE.Vector3(0, 1.4, 0)), '#7dffa8');
  toast('📦 チェストの中身を売却!(' + count + '個 → ' + formatMoney(total) + ')', 'good');
  bus.emit(Events.ITEM_SOLD, { oreType: 'chest', ingot: false, value: total, gx: m.gx, gz: m.gz });
}


const actionMenu = document.getElementById('machine-actions');
let selectedMachine = null;
let moveMachineMode = null;
function positionActionMenu(m) {
  if (!actionMenu || !m) return;
  const pos = m.mesh.position.clone().add(new THREE.Vector3(0, 1.7, 0));
  pos.project(camera);
  const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
  actionMenu.style.left = x + 'px';
  actionMenu.style.top = y + 'px';
}
function showMachineActions(m) {
  selectedMachine = m;
  positionActionMenu(m);
  const recipeBtn = actionMenu ? actionMenu.querySelector('button[data-action="recipe"]') : null;
  if (recipeBtn) recipeBtn.classList.toggle('hidden', m.type !== 'autoCrafter');
  if (actionMenu) actionMenu.classList.remove('hidden');
  updateStatus(toolLabel(m.type) + 'を選択中: 回転・移動・削除できます', 'good');
}
function hideMachineActions() {
  selectedMachine = null;
  if (actionMenu) actionMenu.classList.add('hidden');
  updateStatus();
}
if (actionMenu) actionMenu.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn || !selectedMachine) return;
  const action = btn.dataset.action;
  const m = selectedMachine;
  if (action === 'rotate') {
    const gx = m.gx, gz = m.gz;
    if (commandStack.execute(new RotateCmd(gx, gz))) {
      const mm = state.machines.get(key(gx, gz));
      if (mm) {
        sfx('rotate');
        vibrate(25);
        spawnFloater(DIR_ARROWS[mm.dir], mm.mesh.position.clone().add(new THREE.Vector3(0, 1.3, 0)), '#ffe066');
        toast(toolLabel(mm.type) + 'の向きを変更: ' + DIR_ARROWS[mm.dir], 'good');
      }
    }
    hideMachineActions();
  }
  else if (action === 'delete') {
    const gx = m.gx, gz = m.gz;
    const t = toolLabel(m.type);
    hideMachineActions();
    const cmd = new RemoveMachineCmd(gx, gz);
    if (commandStack.execute(cmd)) {
      sfx('demolish');
      const pct = Math.round((cmd.refund / (COSTS[cmd.snapshot ? cmd.snapshot.type : ''] || 1)) * 100);
      toast(t + 'を撤去(' + (isFinite(pct) ? pct : 50) + '%返金)', 'good');
    }
  }
  else if (action === 'move') { moveMachineMode = m; if (actionMenu) actionMenu.classList.add('hidden'); updateStatus('移動先の空きマスをタップしてください', 'warn'); }
  else if (action === 'recipe' && m.type === 'autoCrafter') { openRecipeModal(m); }
  else if (action === 'copy') { copyToolFrom(m); hideMachineActions(); }
  else hideMachineActions();
});

/* ---------------- スポイト(設置済み機械の種別+向きをツールへコピー) ---------------- */
function copyToolFrom(m) {
  if (!m || COSTS[m.type] === undefined) return; // 機械系ツールのみコピー対象
  state.tool = m.type;
  state.buildDir = m.dir;
  syncToolbarToCurrentTool();
  const arrow = document.getElementById('rotate-arrow');
  if (arrow) arrow.textContent = DIR_ARROWS[state.buildDir];
  updateStatus();
  toast('🧪 ' + toolLabel(m.type) + 'をコピー(向き ' + DIR_ARROWS[m.dir] + ')', 'good');
  sfx('click');
}

/* ---------------- 機械操作(長押しメニュー) ---------------- */

function onTap(clientX, clientY) {
  const hit = pickTile(clientX, clientY);
  if (!hit) return;
  const { gx, gz } = hit;
  const t = state.tiles[gx][gz];
  const existing = state.machines.get(key(gx, gz));

  if (moveMachineMode) {
    const m = moveMachineMode;
    moveMachineMode = null;
    if (!canMoveMachineTo(m, gx, gz)) { toast('移動できません: 空きマス/状態を確認してね', 'error'); updateStatus(); return; }
    const fromGx = m.gx, fromGz = m.gz;
    if (commandStack.execute(new MoveCmd(fromGx, fromGz, gx, gz))) {
      toast(toolLabel(m.type) + 'を移動しました', 'good');
      hideMachineActions();
    } else updateStatus();
    return;
  }
  hideMachineActions();

  if (state.tool === 'dig') {
    if (existing) {
      if (existing.type === 'chest') { cashOutChest(existing); return; }
      // 「掘る」ツールで機械をタップすると状態を確認できる(完成度UP)
      if (existing.type === 'drill' || existing.type === 'drill2') {
        const hasOre = t.ore && ORES[t.ore.type].depth === t.depth;
        const label = existing.type === 'drill2' ? 'ドリルMk2' : 'ドリル';
        toast(hasOre ? '🛠️ ' + label + ': ' + ORES[t.ore.type].name + 'を採掘中(無限鉱脈)' : '🛠️ ' + label + ': 露出した鉱脈がありません', hasOre ? 'good' : 'error');
        return;
      }
      if (existing.type === 'smelter') {
        toast('🔥 精錬中: ' + (existing.processing ? ORES[existing.processing.oreType].name : 'なし') + ' / 待ち ' + existing.buffer.length + '個', 'good');
        return;
      }
      if (existing.type === 'merger') { toast('🔗 合流待ち: ' + existing.buffer.length + '個', 'good'); return; }
      if (existing.type === 'autoCrafter') {
        const crafting = existing.craftRecipe ? (existing.craftRecipe.name + ' ' + Math.floor((existing.craftProgress / existing.craftRecipe.time) * 100) + '%') : '待機中';
        const recipeName = existing.selectedRecipeId && existing.selectedRecipeId !== 'auto'
          ? (AUTOCRAFT_RECIPES.find(r => r.id === existing.selectedRecipeId)?.name || existing.selectedRecipeId)
          : '自動選択';
        const powered = powerGrid.isPowered(existing);
        toast((powered ? '🏭' : '⚠️電力不足') + ' 自動工房: ' + crafting + ' / レシピ ' + recipeName + ' / 在庫 ' + ctx.stockTotal(existing.craftStock) + '個', powered ? 'good' : 'error');
        return;
      }
      if (existing.type === 'generator') { toast('⚡ 発電中: +' + POWER_RANGE + '電力 / 範囲 ' + POWER_RANGE + 'マス', 'good'); return; }
      toast('機械の下は掘れない!先に撤去してね', 'error'); return;
    }
    const exposed = t.ore && ORES[t.ore.type].depth === t.depth;
    if (exposed) {
      // 手掘りで鉱石ゲット
      const v = ORES[t.ore.type].oreValue;
      gameState.earn(v);
      sfx('ore');
      spawnFloater('+' + formatMoney(v), new THREE.Vector3(worldX(gx), tileTopY(gx, gz) + 1, worldZ(gz)), '#ffd76e');
      refreshTile(gx, gz);
      bus.emit(Events.TILE_DUG, { gx, gz, depth: t.depth, ore: t.ore && t.ore.type ? t.ore.type : null });
      return;
    }
    if (t.depth >= MAX_DEPTH) { toast('これ以上深く掘れない(岩盤)', 'error'); return; }
    const cmd = new DigCmd(gx, gz);
    if (!commandStack.execute(cmd)) return;
    sfx('dig');
    const digPos = new THREE.Vector3(worldX(gx), tileTopY(gx, gz) + 0.2, worldZ(gz));
    for (let i = 0; i < 6; i++) {
      spawnParticle('dust', digPos, { life: 0.7, scale: 0.4, vel: new THREE.Vector3((Math.random() - 0.5) * 1.4, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 1.4) });
    }
    bus.emit(Events.TILE_DUG, { gx, gz, depth: t.depth, ore: null });
    const nowExposed = t.ore && ORES[t.ore.type].depth === t.depth;
    if (nowExposed) {
      sfx('discover');
      toast('💎 ' + ORES[t.ore.type].name + '無限鉱脈を発見!ドリルを置こう!', 'good');
      spawnFloater('💎発見!', new THREE.Vector3(worldX(gx), tileTopY(gx, gz) + 1.2, worldZ(gz)), '#7de8ff');
    }
  }
  else if (state.tool === 'fill') {
    if (existing) { toast('機械の下は盛れない!先に撤去してね', 'error'); return; }
    if (t.depth <= 0) { toast('これ以上は盛れない(元の地表)', 'error'); return; }
    if (!commandStack.execute(new FillCmd(gx, gz))) return;
    sfx('dig');
    toast('🧱 土を盛って地面を1段上げた', 'good');
    bus.emit(Events.TILE_FILLED, { gx, gz, depth: t.depth });
  }
  else if (state.tool === 'demolish') {
    const t2 = toolLabel(existing ? existing.type : '');
    const cmd = new RemoveMachineCmd(gx, gz);
    if (!existing || !commandStack.execute(cmd)) { toast('ここに機械はないよ', 'error'); }
    else {
      sfx('demolish');
      const rate = COSTS[cmd.snapshot.type] ? Math.round((cmd.refund / COSTS[cmd.snapshot.type]) * 100) : 50;
      toast(t2 + 'を撤去(' + rate + '%返金)', 'good');
    }
  }
  else if (state.tool === 'filterConveyor' && existing && existing.type === 'filterConveyor') {
    const idx = FILTER_CYCLE.indexOf(existing.filter);
    existing.filter = FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length];
    ctx.updateFilterGem(existing);
    toast('フィルター設定: ' + FILTER_LABEL[existing.filter], 'good');
  }
  else if (COSTS[state.tool] !== undefined) {
    if (state.machines.has(key(gx, gz))) { toast('そこには置けないよ', 'error'); return; }
    if ((state.tool === 'drill' || state.tool === 'drill2')) {
      const exposed = t.ore && ORES[t.ore.type].depth === t.depth;
      if (!exposed) { toast('ドリルは露出した鉱石の上に設置!', 'error'); return; }
    }
    if (state.money < COSTS[state.tool]) { toast('お金が足りない… ' + formatMoney(COSTS[state.tool]) + ' 必要', 'error'); return; }
    const cmd = new PlaceMachineCmd(state.tool, gx, gz, state.buildDir);
    if (commandStack.execute(cmd)) {
      sfx('place');
      const mm = state.machines.get(key(gx, gz));
      if (state.tool === 'drill' && t.ore) toast('ドリルを設置!(' + ORES[t.ore.type].name + ' 無限鉱脈)', 'good');
      else toast(toolLabel(state.tool) + 'を設置!', 'good');
    }
  }
}

/* ---------------- ホバー/設置プレビュー ---------------- */
const highlightGeo = new THREE.PlaneGeometry(TS * 0.98, TS * 0.98);
const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
const highlightMesh = new THREE.Mesh(highlightGeo, highlightMat);
highlightMesh.rotation.x = -Math.PI / 2;
highlightMesh.visible = false;
highlightMesh.renderOrder = 10;
scene.add(highlightMesh);

function updateHighlight(clientX, clientY) {
  const hit = pickTile(clientX, clientY);
  if (!hit) { highlightMesh.visible = false; return; }
  const { gx, gz } = hit;
  highlightMesh.position.set(worldX(gx), tileTopY(gx, gz) + 0.03, worldZ(gz));
  highlightMesh.visible = true;
  let color = 0xffe066;
  if (state.tool === 'dig') color = 0x6fd8ff;
  else if (state.tool === 'fill') color = (state.tiles[gx][gz].depth > 0 && !state.machines.has(key(gx, gz))) ? 0x9bde8e : 0xff6b6b;
  else if (state.tool === 'demolish') color = state.machines.has(key(gx, gz)) ? 0xff6b6b : 0x8fa0c0;
  else if (COSTS[state.tool] !== undefined) {
    let canPlace = !state.machines.has(key(gx, gz));
    if (state.tool === 'drill' || state.tool === 'drill2') {
      const t = state.tiles[gx][gz];
      canPlace = canPlace && !!(t.ore && ORES[t.ore.type].depth === t.depth); // ドリルは露出鉱石の上のみ
    }
    color = canPlace && state.money >= COSTS[state.tool] ? 0x7dffa0 : 0xff6b6b;
  }
  highlightMesh.material.color.setHex(color);
  const preview = describeConnectionPreview(gx, gz);
  if (preview) updateStatus(preview.msg, preview.kind);
}
function hideHighlight() { highlightMesh.visible = false; updateStatus(); }

/* ---------------- カメラパッド(長押しリピート対応・目標値をなめらかに更新) ---------------- */
function holdButton(id, action, interval) {
  const el = document.getElementById(id);
  let timer = null;
  const start = e => {
    e.preventDefault();
    action();
    timer = setInterval(action, interval);
  };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('pointercancel', stop);
}
holdButton('cam-left',  () => { cam.yawT += Math.PI / 4; }, 350);
holdButton('cam-right', () => { cam.yawT -= Math.PI / 4; }, 350);
holdButton('cam-up',    () => { cam.pitchT -= 0.09; }, 90);
holdButton('cam-down',  () => { cam.pitchT += 0.09; }, 90);
holdButton('cam-zoom-in',  () => { cam.distT *= 0.92; }, 90);
holdButton('cam-zoom-out', () => { cam.distT *= 1.09; }, 90);

/* ---------------- マップ移動(パン)の基準ベクトル ---------------- */
// 画面ドラッグ用:見た目通りに「指でつまんだ地面がついてくる」動き
function panCamera(dx, dy) {
  const s = cam.dist * 0.0016;
  const sin = Math.sin(cam.yaw), cos = Math.cos(cam.yaw);
  // 「指でつまんだ地面がついてくる」動き: 上へドラッグ=画面の下側にあった土地が見えてくる
  cam.target.x -= (dx * cos + dy * sin) * s;
  cam.target.z -= (dy * cos - dx * sin) * s;
  clampTarget();
}
// キーボード(WASD)用:カメラの「前方」「右方」ベクトルを厳密に使い、上下左右の向きのズレを解消
function moveCameraRig(fwdAmt, rightAmt) {
  const sin = Math.sin(cam.yaw), cos = Math.cos(cam.yaw);
  const fx = -sin, fz = -cos; // 前方(カメラが向いている方向)
  const rx = cos,  rz = -sin; // 右方
  cam.target.x += fx * fwdAmt + rx * rightAmt;
  cam.target.z += fz * fwdAmt + rz * rightAmt;
  clampTarget();
}
function clampTarget() {
  const lim = GRID * TS * 0.62;
  cam.target.x = Math.max(-lim, Math.min(lim, cam.target.x));
  cam.target.z = Math.max(-lim, Math.min(lim, cam.target.z));
}

/* ---------------- キーボード移動(WASD)を毎フレーム滑らかに適用 ---------------- */
const keysPressed = new Set();
export function applyKeyboardPan(dt) {
  if (!keysPressed.size) return;
  let fwd = 0, right = 0;
  if (keysPressed.has('w')) fwd += 1;
  if (keysPressed.has('s')) fwd -= 1;
  if (keysPressed.has('d')) right += 1;
  if (keysPressed.has('a')) right -= 1;
  if (!fwd && !right) return;
  const len = Math.hypot(fwd, right) || 1;
  const speed = 15 * (cam.dist / 40); // ズーム量に応じて移動速度を調整(操作感向上)
  moveCameraRig((fwd / len) * speed * dt, (right / len) * speed * dt);
}

/* ---------------- ビルドドラッグ(コンベア類の連続設置・連続撤去) ---------------- */
const BUILD_TOOLS = new Set(['conveyor', 'fastConveyor', 'filterConveyor', 'demolish']);
const DRAG_THRESHOLD_PX = 8; // この距離未満のドラッグは従来のタップ扱い(パン判定もこの値に統一)

class BuildDragSession {
  constructor(tool, startGx, startGz) {
    this.tool = tool;
    this.lastGx = startGx;
    this.lastGz = startGz;
    this.lastDragKey = null;
    this.count = 0;
    this.spent = 0;
    this.stoppedForMoney = false;
    this.cmds = []; // このドラッグ操作中に実行済み(do()済み)のコマンド一覧。end()で1つのBatchCmdにまとめる
  }
  _dirFrom(gx, gz, ngx, ngz) {
    const dx = ngx - gx, dz = ngz - gz;
    for (let d = 0; d < 4; d++) if (DIRS[d].x === dx && DIRS[d].z === dz) return d;
    return null;
  }
  moveTo(gx, gz) {
    const k = gx + ',' + gz;
    if (k === this.lastDragKey) return;
    this.lastDragKey = k;
    if (this.tool === 'demolish') {
      if (state.machines.has(key(gx, gz))) {
        const before = state.money;
        const cmd = new RemoveMachineCmd(gx, gz);
        if (cmd.do(ctx)) {
          this.cmds.push(cmd);
          this.count++;
          this.spent += (state.money - before); // 返金は負のspentとして反映
          sfx('demolish');
        }
      }
    } else {
      if (state.machines.has(key(gx, gz))) { this.lastGx = gx; this.lastGz = gz; return; }
      if (this.stoppedForMoney) return;
      // 直前タイルから今のタイルへの進行方向。まだ動いていない(初回)場合はツールバーの選択向きを使う
      const dir = this._dirFrom(this.lastGx, this.lastGz, gx, gz) ?? state.buildDir;
      if (state.money < COSTS[this.tool]) {
        if (!this.stoppedForMoney) { this.stoppedForMoney = true; toast('お金が足りない… 設置を中断しました', 'error'); }
        this.lastGx = gx; this.lastGz = gz;
        return;
      }
      const before = state.money;
      const cmd = new PlaceMachineCmd(this.tool, gx, gz, dir);
      if (cmd.do(Object.assign({}, ctx, { placeMachine: (t, gx2, gz2, d2) => placeMachine(t, gx2, gz2, d2, false, true, true) }))) {
        this.cmds.push(cmd);
        this.count++;
        this.spent += (before - state.money);
        sfx('place');
        // 直前マスのコンベアの向きも進行方向へ更新(一筆書きの流れを揃える)
        const prev = state.machines.get(key(this.lastGx, this.lastGz));
        if (prev && (prev.type === 'conveyor' || prev.type === 'fastConveyor' || prev.type === 'filterConveyor')) {
          const backDir = this._dirFrom(this.lastGx, this.lastGz, gx, gz);
          if (backDir !== null && prev.dir !== backDir) {
            const scmd = new SetDirCmd(this.lastGx, this.lastGz, prev.dir, backDir);
            prev.dir = backDir;
            prev.mesh.rotation.y = -backDir * Math.PI / 2;
            rebuildBeltsAround(this.lastGx, this.lastGz);
            this.cmds.push(scmd);
          }
        }
      }
    }
    this.lastGx = gx; this.lastGz = gz;
    this._updateLiveCounter();
  }
  _updateLiveCounter() {
    if (this.count === 0) return;
    if (this.tool === 'demolish') {
      setStatus('🧨 ' + this.count + '個撤去(+' + formatMoney(this.spent) + ')', 'good');
    } else {
      setStatus('➡️ ' + this.count + '本設置(-' + formatMoney(this.spent) + ')', 'good');
    }
  }
  end() {
    if (this.cmds.length > 0) commandStack.push(new BatchCmd(this.cmds));
    updateStatus();
  }
}
let buildDragSession = null;

/* ---------------- タッチ / マウス操作(慣性ドラッグ対応) ---------------- */
let pointers = new Map();
let dragMoved = 0;
let tapStart = 0;
let pinchDist = 0;
const inertia = { active: false, vx: 0, vy: 0 };

/* ---- 長押しで設置済み機械の操作メニューを表示 ---- */
const LONG_PRESS_MS = 480;
let longPressTimer = null;
let longPressFired = false;
function clearLongPress() { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } }
function startLongPress(clientX, clientY) {
  clearLongPress();
  longPressFired = false;
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    if (dragMoved > DRAG_THRESHOLD_PX) return; // ドラッグ中なら発火しない
    const hit = pickTile(clientX, clientY);
    if (!hit) return;
    const m = state.machines.get(key(hit.gx, hit.gz));
    if (m) {
      longPressFired = true;
      showMachineActions(m);
    }
  }, LONG_PRESS_MS);
}

function tryStartBuildDrag(clientX, clientY) {
  if (!BUILD_TOOLS.has(state.tool)) return false;
  const hit = pickTile(clientX, clientY);
  if (!hit) return false;
  const { gx, gz } = hit;
  if (state.tool === 'demolish') {
    if (!state.machines.has(key(gx, gz))) return false; // 空きマスなら従来のパン
  } else {
    if (state.machines.has(key(gx, gz))) return false; // 機械の上なら従来のパン(移動操作等を阻害しない)
  }
  buildDragSession = new BuildDragSession(state.tool, gx, gz);
  return true;
}

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  inertia.active = false; // 新しい操作が始まったら慣性を止める
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (pointers.size === 1) {
    dragMoved = 0; tapStart = performance.now();
    startLongPress(e.clientX, e.clientY);
    tryStartBuildDrag(e.clientX, e.clientY); // 実際の設置/撤去はドラッグ距離が閾値を超えてから開始する
  } else {
    clearLongPress(); // 2本指以降は長押し判定をキャンセル(ピンチ操作優先)
    if (buildDragSession) { buildDragSession.end(); buildDragSession = null; } // 2本目の指でビルドドラッグを即中断してピンチへ
  }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) {
    // ドラッグ中でなければマウスホバーで設置プレビューを表示(PC操作性向上)
    if (e.pointerType === 'mouse' && pointers.size === 0) updateHighlight(e.clientX, e.clientY);
    return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  const now = performance.now();
  const dtms = Math.max(1, now - (p.t || now));
  p.x = e.clientX; p.y = e.clientY; p.t = now;
  if (pointers.size === 1) {
    dragMoved += Math.abs(dx) + Math.abs(dy);
    if (dragMoved > DRAG_THRESHOLD_PX && buildDragSession) {
      clearLongPress();
      hideHighlight();
      inertia.active = false; // ビルドドラッグ中はカメラ慣性を発動させない
      const hit = pickTile(e.clientX, e.clientY);
      if (hit) buildDragSession.moveTo(hit.gx, hit.gz);
    } else if (dragMoved > DRAG_THRESHOLD_PX) {
      clearLongPress();
      if (buildDragSession) { buildDragSession = null; } // 閾値未満で解除された場合は通常パンへフォールバック
      panCamera(dx, dy);
      hideHighlight();
      // 慣性用の速度(px/秒)を記録
      inertia.vx = dx / (dtms / 1000);
      inertia.vy = dy / (dtms / 1000);
    }
  } else if (pointers.size === 2) {
    clearLongPress();
    if (buildDragSession) { buildDragSession.end(); buildDragSession = null; }
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) cam.distT *= pinchDist / d;
    pinchDist = d;
    dragMoved = 100;
  }
});
canvas.addEventListener('pointerup', e => {
  pointers.delete(e.pointerId);
  clearLongPress();
  const wasBuildDrag = !!buildDragSession;
  if (buildDragSession) { buildDragSession.end(); buildDragSession = null; }
  if (wasBuildDrag) {
    // ビルドドラッグ中はタップ処理・慣性スクロールを発火させない
  } else if (pointers.size === 0 && longPressFired) {
    longPressFired = false; // 長押しメニューを出した場合はタップ操作を発火させない
  } else if (pointers.size === 0 && dragMoved <= DRAG_THRESHOLD_PX && performance.now() - tapStart < 400) {
    onTap(e.clientX, e.clientY);
  } else if (pointers.size === 0 && dragMoved > DRAG_THRESHOLD_PX) {
    // フリック(素早いドラッグ)で慣性スクロールを開始(操作感向上)
    const speed = Math.hypot(inertia.vx, inertia.vy);
    if (speed > 60) inertia.active = true;
  }
  pinchDist = 0;
});
canvas.addEventListener('pointercancel', e => {
  pointers.delete(e.pointerId);
  clearLongPress();
  if (buildDragSession) { buildDragSession.end(); buildDragSession = null; }
  pinchDist = 0;
});
canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && pointers.size === 0) hideHighlight(); });

export function updateInertia(dt) {
  if (!inertia.active) return;
  panCamera(inertia.vx * dt, inertia.vy * dt);
  const decay = Math.pow(0.02, dt); // 素早く減衰してスッと止まる
  inertia.vx *= decay; inertia.vy *= decay;
  if (Math.hypot(inertia.vx, inertia.vy) < 8) inertia.active = false;
}

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cam.distT *= e.deltaY > 0 ? 1.08 : 0.92;
}, { passive: false });

/* ---------------- PC数字キーホットバー / Qスポイト / X撤去 ---------------- */
// 数字キー1-9: 現在表示中のカテゴリの左からn番目のツールボタンをクリックしたのと同じ扱いにする
function selectHotbarSlot(n) {
  const root = document.getElementById('toolbar');
  if (!root) return;
  const btns = root.querySelectorAll('.toolbar-buttons .tool-btn');
  const btn = btns[n - 1];
  if (btn) btn.click();
}
// Qキー: ホバー中のマスに設置済み機械があればスポイトでツールへコピー
function spoitAtLastHover() {
  const hit = pickTile(lastMouseX, lastMouseY);
  if (!hit) return;
  const m = state.machines.get(key(hit.gx, hit.gz));
  if (!m) { toast('ここに機械はないよ', 'error'); return; }
  copyToolFrom(m);
}
let lastMouseX = 0, lastMouseY = 0;
window.addEventListener('mousemove', e => { lastMouseX = e.clientX; lastMouseY = e.clientY; });

/* キーボード(矢印=視点、WASD=移動を毎フレーム滑らかに適用) */
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'a' || k === 's' || k === 'd') keysPressed.add(k);
  if (k >= '1' && k <= '9') { selectHotbarSlot(Number(k)); return; }
  if (k === 'q') { spoitAtLastHover(); return; }
  if (k === 'x') { document.querySelector('#toolbar [data-tool="demolish"]')?.click(); return; }
  switch (e.key) {
    case 'ArrowLeft': cam.yawT += Math.PI / 4; break;
    case 'ArrowRight': cam.yawT -= Math.PI / 4; break;
    case 'ArrowUp': cam.pitchT -= 0.09; break;
    case 'ArrowDown': cam.pitchT += 0.09; break;
    case '+': case '=': cam.distT *= 0.9; break;
    case '-': cam.distT *= 1.1; break;
    case 'r': document.getElementById('btn-rotate').click(); break;
  }
});
window.addEventListener('keyup', e => keysPressed.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keysPressed.clear());

/* ---------------- アンドゥ/リドゥ (Phase10) ---------------- */
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
if (btnUndo) btnUndo.addEventListener('click', () => commandStack.undo());
if (btnRedo) btnRedo.addEventListener('click', () => commandStack.redo());
bus.on(Events.HISTORY_CHANGED, ({ canUndo, canRedo }) => {
  if (btnUndo) btnUndo.disabled = !canUndo;
  if (btnRedo) btnRedo.disabled = !canRedo;
});
// PCショートカット: Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z もリドゥ扱い)
window.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z') {
    e.preventDefault();
    if (e.shiftKey) commandStack.redo(); else commandStack.undo();
  } else if (k === 'y') {
    e.preventDefault();
    commandStack.redo();
  }
});

/* Export for main.js loop */
export function positionActionMenuIfNeeded() {
  if (selectedMachine && actionMenu && !actionMenu.classList.contains('hidden')) positionActionMenu(selectedMachine);
}