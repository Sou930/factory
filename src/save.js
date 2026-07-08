/* =====================================================================
   TerraForge — セーブ・ロード / 自動セーブ (Phase06: v8スキーマ)
   ---------------------------------------------------------------------
   実際の永続化(localStorage I/O・バージョン検証・マイグレーション・
   スロット管理・エクスポート/インポート)は src/save/SaveManager.js に
   委譲する。本ファイルは以下の「組み立て/分解」だけを担当する:
     - saveGame(): tiles/machines/items/camera/settings を集めて
       v8スキーマのプレーンオブジェクトを作り、SaveManager.save() へ渡す
     - loadGame(): SaveManager.load() (無ければ loadLegacy()) の結果を
       返す(main.js が createWorld/機械復元/アイテム復元に使う)
     - applyLoadedItems(): アイテム復元(行き先マス二重占有の解消込み)
     - applyLoadedCamera(): カメラ状態の復元

   money は gameState.money getter 経由で読み取る(直接代入禁止)。
   ===================================================================== */
import { state, gameState } from './state.js';
import { GRID } from './constants.js';
import { spawnItem, depositIntoNearestChestOrDiscard } from './logistics.js';
import { key } from './world.js';
import { cam } from './render/scene.js';
import { getMuted, getSfxVolume, getBgmVolume } from './audio.js';
import { ctx } from './ctx.js';
import { saveManager } from './save/SaveManager.js';

/** 現在プレイ中のスロット(将来スロット切替UIが選択する。既定は0) */
let activeSlot = 0;
export function getActiveSlot() { return activeSlot; }
export function setActiveSlot(slot) { activeSlot = slot; }

/**
 * 現在の状態から v8スキーマのプレーンオブジェクトを組み立てる。
 * @returns {object}
 */
function buildSaveData() {
  const tileData = [];
  for (let gx = 0; gx < GRID; gx++) for (let gz = 0; gz < GRID; gz++) {
    const t = state.tiles[gx][gz];
    if (t.depth > 0) tileData.push({ x: gx, z: gz, d: t.depth });
  }
  const machineData = [...state.machines.values()].map(m => {
    const rec = { t: m.type, x: m.gx, z: m.gz, d: m.dir };
    if (m.type === 'filterConveyor') rec.f = m.filter;
    if (m.type === 'chest') rec.st = m.storage;
    if (m.type === 'merger' || m.type === 'smelter') rec.buf = m.buffer;
    if (m.type === 'smelter' && m.processing) rec.pr = m.processing;
    if (m.type === 'autoCrafter') {
      rec.cs = m.craftStock;
      rec.sr = m.selectedRecipeId || 'auto';
      if (m.craftRecipe) rec.cr = m.craftRecipe.id;
      if (m.craftProgress) rec.cp = m.craftProgress;
    }
    return rec;
  });
  // ライン上を流れているアイテムも保存。移動中は行き先マスの座標(x,z)、
  // 静止中は現在座標を保存し、mv フラグで移動中だったかを区別する
  // (ロード時、行き先が既に埋まっていれば最寄りチェストへ格納/破棄するため)
  const itemData = ctx.itemPool.slots.filter(it => it.active).map(it => {
    let x = it.gx, z = it.gz, mv = 0;
    if (it.moving && it.destKey) {
      const p = it.destKey.split(',');
      x = +p[0]; z = +p[1];
      mv = 1;
    }
    return { o: it.oreType, i: it.ingot ? 1 : 0, x, z, mv };
  });

  const gsData = gameState.serialize();
  return {
    version: 9,
    meta: {
      savedAt: Date.now(),
      playTime: gameState.playTime,
    },
    world: {
      seed: state.seed,
      tiles: tileData,
    },
    economy: {
      money: gameState.money,
      stats: { ...state.stats },
    },
    machines: machineData,
    items: itemData,
    settings: {
      muted: getMuted(),
      selectedFilter: gsData.selectedFilter,
      buildDir: gsData.buildDir,
      // Phase07: 音量・品質・表示設定を統合保存
      sfxVolume: getSfxVolume(),
      bgmVolume: getBgmVolume(),
      quality: (gameState.settings && gameState.settings.quality) || 'high',
      haptics: (gameState.settings && gameState.settings.haptics) || false,
      showCamPad: (gameState.settings && gameState.settings.showCamPad) || true,
      shortNumbers: (gameState.settings && gameState.settings.shortNumbers) || true,
    },
    camera: {
      yaw: cam.yawT, pitch: cam.pitchT, dist: cam.distT,
      tx: cam.target.x, tz: cam.target.z,
    },
  };
}

/** 現在の状態をアクティブスロットへセーブする */
export function saveGame() {
  const data = buildSaveData();
  return saveManager.save(data, activeSlot);
}

/**
 * アクティブスロットからロードする。無ければ旧v7からの自動移行を試みる。
 * @returns {object|null} v8スキーマのセーブデータ、無ければ null
 */
export function loadGame() {
  const fromSlot = saveManager.load(activeSlot);
  if (fromSlot) return fromSlot;
  // スロットが空の場合のみ、旧v7セーブからの初回移行を試みる
  return saveManager.loadLegacy();
}

/**
 * ロードしたセーブデータのアイテムをワールドへ復元する。
 * 行き先マスの機械が既に埋まっている(暗黙の二重占有)場合は、
 * 最寄りのチェストへ格納し、チェストが無ければ破棄する。
 * @param {object} saved v8スキーマのセーブデータ(items配列を含む)
 */
export function applyLoadedItems(saved) {
  if (!saved || !saved.items) return;
  for (const d of saved.items) {
    const m = state.machines.get(key(d.x, d.z));
    if (!m) continue;
    const ingot = !!d.i;
    if (m.type === 'conveyor' || m.type === 'fastConveyor' || m.type === 'filterConveyor' || m.type === 'splitter') {
      if (!m.item) {
        const it = spawnItem(d.o, ingot, d.x, d.z);
        m.item = it;
      } else {
        // 行き先マスが既に占有されている: 最寄りチェストへ退避、無ければ破棄
        depositIntoNearestChestOrDiscard(d.o, ingot, d.x, d.z);
      }
    } else if (m.type === 'smelter' && !ingot && m.buffer.length < 2) m.buffer.push({ oreType: d.o });
    else if (m.type === 'merger') m.buffer.push({ oreType: d.o, ingot });
    else if (m.type === 'chest') { const sk = d.o + (ingot ? '_i' : '_o'); m.storage[sk] = (m.storage[sk] || 0) + 1; }
    else if (m.type === 'autoCrafter') { const sk = d.o + (ingot ? '_i' : '_o'); m.craftStock[sk] = (m.craftStock[sk] || 0) + 1; }
    else {
      // 上記いずれにも該当しない(受け入れ不可の機械種別など): 最寄りチェストへ退避、無ければ破棄
      depositIntoNearestChestOrDiscard(d.o, ingot, d.x, d.z);
    }
  }
}

/**
 * ロードしたセーブデータのカメラ状態を復元する。
 * @param {object} saved v8スキーマのセーブデータ(camera を含む)
 */
export function applyLoadedCamera(saved) {
  if (!saved || !saved.camera) return;
  const c = saved.camera;
  if (typeof c.yaw === 'number') { cam.yaw = c.yaw; cam.yawT = c.yaw; }
  if (typeof c.pitch === 'number') { cam.pitch = c.pitch; cam.pitchT = c.pitch; }
  if (typeof c.dist === 'number') { cam.dist = c.dist; cam.distT = c.dist; }
  if (typeof c.tx === 'number') cam.target.x = c.tx;
  if (typeof c.tz === 'number') cam.target.z = c.tz;
}

/**
 * v8スキーマ(ネスト構造)を GameState.deserialize が期待するフラット形状へ変換する。
 * @param {object} saved v8スキーマのセーブデータ
 * @returns {object} {seed, money, stats, time, playTime, tool, buildDir, selectedFilter, muted}
 */
export function flattenForGameState(saved) {
  if (!saved) return null;
  const settings = saved.settings || {};
  const economy = saved.economy || {};
  const world = saved.world || {};
  const meta = saved.meta || {};
  return {
    seed: world.seed,
    money: economy.money,
    stats: economy.stats,
    playTime: meta.playTime,
    buildDir: settings.buildDir,
    selectedFilter: settings.selectedFilter,
    muted: settings.muted,
    // Phase07: settings オブジェクトをそのまま GameState.deserialize へ渡す
    settings: {
      muted: settings.muted || false,
      selectedFilter: settings.selectedFilter || 'any',
      buildDir: settings.buildDir || 0,
      sfxVolume: typeof settings.sfxVolume === 'number' ? settings.sfxVolume : 1,
      bgmVolume: typeof settings.bgmVolume === 'number' ? settings.bgmVolume : 0.7,
      quality: settings.quality === 'low' || settings.quality === 'medium' || settings.quality === 'high'
        ? settings.quality : 'high',
      haptics: typeof settings.haptics === 'boolean' ? settings.haptics : true,
      showCamPad: typeof settings.showCamPad === 'boolean' ? settings.showCamPad : true,
      shortNumbers: typeof settings.shortNumbers === 'boolean' ? settings.shortNumbers : true,
    },
  };
}

/** スロット一覧を返す(スロット選択UI用) */
export function listSaveSlots() {
  return saveManager.listSlots();
}

/** アクティブスロットをエクスポート文字列にする */
export function exportSave() {
  return saveManager.exportString(activeSlot);
}

/** エクスポート文字列をアクティブスロットへインポートする */
export function importSave(str) {
  return saveManager.importString(str, activeSlot);
}

/* 自動セーブ(30秒ごと+タブを閉じる/隠した時。進行が消えるのを防止)
   requestIdleCallback があればそちらでシリアライズし(未対応環境は setTimeout 0)、
   メインスレッドのフレーム落ちを避ける。間隔は30秒を維持。
   Phase03: document.addEventListener は UI/Bootstrap 層(main.js)で行い、
   saveGame 関数自体は純粋な状態シリアライズに専念させる */
function idleSave() {
  const run = () => saveGame();
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run);
  else setTimeout(run, 0);
}
export function initAutoSave() {
  setInterval(idleSave, 30000);
  // visibilitychange / pagehide の購読は main.js 側で実施し、
  // ここではタイマー駆動のみ登録する
}
