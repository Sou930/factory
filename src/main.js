/* =====================================================================
   TerraForge — エントリーポイント
   ===================================================================== */
import { ctx } from './ctx.js';
import { state, gameState } from './state.js';
import { scene, camera, renderer, cam, updateCamera, onResize, updateAdaptiveQuality } from './render/scene.js';

import { worldX, worldZ, tileTopY, yJitter, inGrid, key, refreshTile, createWorld } from './world.js';
import { updateParticles, updateFloaters, doScan, clearScan, spawnParticle, spawnFloater, updateScan } from './particles.js';
import { powerGrid } from './power.js';
import { canAccept, sendItemTo, arriveItem, releaseItem, connectionOk, heightOk, chooseAutoDir, tryAutoConnectNeighbors, rebuildBeltsAround, stockTotal, chestTotal, formatStockKey, itemValue, spawnItem } from './logistics.js';
import { placeMachine, removeMachine, removeMachineNoRefund, updateMachines, updateItems, toolLabel, countMachineType, getTotalChestStock, machineBusyForUpgrade, applyGlobalUpgrade, rotateMachine, moveMachineTo, canMoveMachineTo } from './machines.js';
import { toast, addMoney, earn, updateStatus, setStatus, openUpgradeModal, closeUpgradeModal, openRecipeModal, closeRecipeModal, updateMuteIcon, checkMilestones, baseStatusForTool, describeConnectionPreview, setAutoCrafterRecipe, renderUpgradeTree, formatNeedsText, showHelpModal, syncToolbarToCurrentTool, applySettingsFromLoad, refreshMoneyDisplay } from './ui.js';
import { saveGame, loadGame, initAutoSave, applyLoadedItems, applyLoadedCamera, flattenForGameState, exportSave, importSave, listSaveSlots } from './save.js';
import { getMuted, setMuted, setSfxVolume, setBgmVolume } from './audio.js';
import { applyKeyboardPan, updateInertia, positionActionMenuIfNeeded } from './input.js';

import { AUTOCRAFT_RECIPES, COSTS } from './constants.js';
import { MACHINE_DEFS } from './machineDefs.js';
import { updateFilterGem, applyFastConveyorTint } from './render/meshes.js';
import { ItemRenderer } from './render/itemRenderer.js';
import { ItemPool } from './core/ItemPool.js';
import { sfx } from './audio.js';
import { initCommandStack, commandStack } from './core/CommandStack.js';

/* Phase08: ErrorReporter は本番バンドルに含まれるが軽量(window リスナ登録のみ)。
   依存(state/itemPool/toast)は setContext で注入する。
   DebugConsole は dynamic import で遅延ロード(?debug=1 の時のみ)。 */
import * as ErrorReporter from './debug/ErrorReporter.js';

/* ---- Populate ctx (dependency injection to avoid circular imports) ---- */

// ItemPool & ItemRenderer: 初期化して ctx に注入
const itemPool = new ItemPool();
ctx.itemPool = itemPool;
const itemRenderer = new ItemRenderer(scene, 1024);

Object.assign(ctx, {
  // world
  worldX, worldZ, tileTopY, yJitter, inGrid, key, refreshTile,
  // logistics
  canAccept, sendItemTo, releaseItem, arriveItem, connectionOk, heightOk,
  chooseAutoDir, tryAutoConnectNeighbors, rebuildBeltsAround,
  stockTotal, chestTotal, formatStockKey, itemValue, spawnItem,
  // particles
  spawnParticle, spawnFloater, doScan, clearScan,
  // power (legacy compat — only used by input.js tap info; machineDefs uses powerGrid directly)
  // No per-frame power calculation functions to inject
  // machines
  placeMachine, removeMachine, removeMachineNoRefund, toolLabel, countMachineType,
  getTotalChestStock, machineBusyForUpgrade, applyGlobalUpgrade,
  rotateMachine, moveMachineTo, canMoveMachineTo,
  // machine defs / costs (Phase10: CommandStack の undo で参照)
  COSTS, MACHINE_DEFS,
  // ui
  toast, addMoney, earn, updateStatus, setStatus, baseStatusForTool,
  describeConnectionPreview, openUpgradeModal, closeUpgradeModal,
  openRecipeModal, closeRecipeModal, setAutoCrafterRecipe,
  updateMuteIcon, checkMilestones,
  renderUpgradeTree, formatNeedsText,
  refreshMoneyDisplay,
  // meshes
  updateFilterGem, applyFastConveyorTint,
  // audio
  sfx,
  // save
  saveGame, exportSave, importSave, listSaveSlots,
});

/* Phase10: CommandStack はロジック層の関数群(ctx)に依存するため、
   ctx が完全に埋まった直後にシングルトンを生成する。 */
initCommandStack(ctx);

/* ---- Init ---- */
function init() {
  const saved = loadGame();
  createWorld(saved);
  if (saved) {
    // gameState.deserialize はフラット形状を期待するため、v8/v9のネスト構造を変換してから渡す
    gameState.deserialize(flattenForGameState(saved));
    // 効果音ミュートは v8 では settings.muted に統合(旧 terraforge_muted キーは廃止)
    if (saved.settings && typeof saved.settings.muted === 'boolean') {
      setMuted(saved.settings.muted);
      updateMuteIcon();
    }
    // Phase07: 音量・品質等の設定を各モジュールへ反映
    if (typeof saved.settings.sfxVolume === 'number') setSfxVolume(saved.settings.sfxVolume);
    if (typeof saved.settings.bgmVolume === 'number') setBgmVolume(saved.settings.bgmVolume);
    applySettingsFromLoad();
    for (const md of saved.machines) {
      placeMachine(md.t, md.x, md.z, md.d, true);
      const mm = state.machines.get(key(md.x, md.z));
      if (mm) {
        if (md.f !== undefined) { mm.filter = md.f; updateFilterGem(mm); }
        if (md.st) mm.storage = md.st;
        if (md.buf) mm.buffer = md.buf;
        if (md.pr) mm.processing = md.pr; // 精錬炉の処理中アイテムを復元
        if (md.cs) mm.craftStock = md.cs;
        mm.selectedRecipeId = md.sr || 'auto';
        if (md.cr) mm.craftRecipe = AUTOCRAFT_RECIPES.find(r => r.id === md.cr) || null;
        if (md.cp) mm.craftProgress = md.cp;
      }
    }
    // ライン上のアイテムを復元(行き先マスが既に埋まっている場合は最寄りチェストへ退避/破棄)
    applyLoadedItems(saved);
    // カメラ位置・角度・ズームを復元
    applyLoadedCamera(saved);
    toast('📂 セーブデータを読み込みました', 'good');
  } else {
    showHelpModal();
  }
  // addMoney(0) で表示を初期化(0円増減だが、money:changed は前回 emit 値との
  // 比較で発火するため、セーブロード後の初回表示もこれで保証される)
  gameState.addMoney(0);
  // ロード直後(全機械復元後)に電力網を再構築
  powerGrid.rebuild(state.machines.values());
  updateStatus();
  // Phase07: ロード復元したツールが現在のカテゴリ外かもしれないのでツールバーを同期
  syncToolbarToCurrentTool();
  // Phase10: アンドゥ/リドゥ履歴はセーブに含まれない仕様。ロード直後は必ず空にする
  commandStack.clear();
  onResize();
}

/* ---- Game loop ---- */
let lastT = performance.now();
let smoothDt = 1 / 60;
function loop(now) {
  requestAnimationFrame(loop);
  const rawDt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  smoothDt += (rawDt - smoothDt) * Math.min(1, rawDt * 9);
  const dt = Math.min(0.05, rawDt * 0.42 + smoothDt * 0.58);
  updateAdaptiveQuality(rawDt);

  state.time += dt;
  gameState.playTime += dt; // 累計プレイ時間(v8セーブに保存)
  updateMachines(dt);
  updateItems(dt);
  itemRenderer.sync(ctx.itemPool.slots);
  updateFloaters(dt);
  updateParticles(dt);
  updateScan(dt);
  applyKeyboardPan(dt);
  updateInertia(dt);
  updateCamera(dt);
  positionActionMenuIfNeeded();
  renderer.render(scene, camera);
}

/* ---- Boot ---- */
initAutoSave();
// ライフサイクルイベントによる自動セーブ(save.js から分離: document.* 参照を
// bootstrap 層に閉じ込めるため)
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
window.addEventListener('pagehide', saveGame);

/* Phase08: ErrorReporter は本番でも常に有効(window リスナのみで軽量)。
   依存注入は ctx が埋まった後で行う。init() 自体は即座に呼んで構わないが、
   state/itemPool が確定した後に setContext しないと machineCount/itemCount
   が 0 になるため、init() の直後で注入する。 */
ErrorReporter.init();
ErrorReporter.setContext({ state, itemPool: ctx.itemPool, toast });

init();
requestAnimationFrame(loop);

/* Phase08: ?debug=1 の時のみ DebugConsole を dynamic import で遅延ロード。
   本番バンドルには含まれない(別チャンクに分離)。 */
(async () => {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('debug') !== '1') return;
    const mod = await import('./debug/DebugConsole.js');
    if (mod.isDebugMode && mod.isDebugMode()) {
      new mod.DebugConsole();
      console.log('[TerraForge] Debug console enabled (?debug=1)');
    }
  } catch (e) {
    console.error('[TerraForge] Failed to load DebugConsole:', e);
  }
})();