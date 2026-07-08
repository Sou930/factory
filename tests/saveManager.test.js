/* =====================================================================
   TerraForge — SaveManager ユニットテスト (Phase06)
   ---------------------------------------------------------------------
   指定4ケース+補助:
   (a) v7→v8マイグレーションで money/機械/チェスト在庫が保持される
   (b) 破損JSONでnull+イベント発火
   (c) export→importで同一データ
   (d) 未知の将来バージョンは拒否
   localStorage は vi.stubGlobal でモックする。
   ===================================================================== */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SaveManager } from '../src/save/SaveManager.js';
import { bus } from '../src/core/EventBus.js';
import { Events } from '../src/core/events.js';
import { SAVE_KEY, SAVE_KEY_PREFIX, SAVE_LEGACY_BACKUP_KEY, SAVE_VERSION } from '../src/constants.js';

/** localStorage の簡易インメモリモック */
function makeLocalStorageMock() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    _store: store,
  };
}

describe('SaveManager', () => {
  let sm;
  let ls;

  beforeEach(() => {
    ls = makeLocalStorageMock();
    vi.stubGlobal('localStorage', ls);
    bus.clear();
    sm = new SaveManager();
  });

  /* ---- ケース(a): v7→v9マイグレーションで money/機械/チェスト在庫が保持される ---- */
  it('v7セーブをloadLegacy()するとv9へ変換され、money/機械/チェスト在庫が保持される', () => {
    const v7 = {
      seed: 42,
      money: 1234,
      stats: { earned: 5000, msIndex: 2 },
      tiles: [{ x: 1, z: 2, d: 3 }],
      machines: [
        { t: 'drill', x: 0, z: 0, d: 0 },
        { t: 'chest', x: 1, z: 0, d: 0, st: { iron_i: 20, copper_o: 3 } },
      ],
      items: [{ o: 'coal', i: 0, x: 2, z: 2 }],
      muted: true,
      selectedFilter: 'gold',
      buildDir: 2,
    };
    ls.setItem(SAVE_KEY, JSON.stringify(v7));

    const migrated = sm.loadLegacy();

    expect(migrated).not.toBeNull();
    expect(migrated.version).toBe(9);
    expect(migrated.economy.money).toBe(1234);
    expect(migrated.economy.stats.earned).toBe(5000);
    expect(migrated.world.seed).toBe(42);
    expect(migrated.world.tiles).toEqual([{ x: 1, z: 2, d: 3 }]);
    // 機械(ドリル+チェスト在庫)が保持されている
    expect(migrated.machines).toHaveLength(2);
    const chest = migrated.machines.find(m => m.t === 'chest');
    expect(chest.st).toEqual({ iron_i: 20, copper_o: 3 });
    // 設定が settings 配下へ統合されている
    expect(migrated.settings.muted).toBe(true);
    expect(migrated.settings.selectedFilter).toBe('gold');
    expect(migrated.settings.buildDir).toBe(2);
    // Phase07: v9 settings 拡張フィールドがデフォルト値でマージされている
    expect(migrated.settings.sfxVolume).toBe(1);
    expect(migrated.settings.bgmVolume).toBe(0.7);
    expect(migrated.settings.quality).toBe('high');
    expect(migrated.settings.haptics).toBe(true);
    expect(migrated.settings.showCamPad).toBe(true);
    expect(migrated.settings.shortNumbers).toBe(true);
    // slot0 に保存され、旧キーはバックアップへ退避・削除されている
    expect(ls.getItem(SAVE_KEY_PREFIX + '0')).not.toBeNull();
    expect(ls.getItem(SAVE_LEGACY_BACKUP_KEY)).not.toBeNull();
    expect(ls.getItem(SAVE_KEY)).toBeNull();
  });

  /* ---- Phase07: v8→v9マイグレーションで settings にデフォルト値がマージされる ---- */
  it('v8セーブをload()するとv9へ変換され、settings にPhase07デフォルト値がマージされる', () => {
    const v8 = {
      version: 8,
      meta: { savedAt: 100, playTime: 50 },
      world: { seed: 9, tiles: [] },
      economy: { money: 300, stats: { earned: 100, msIndex: 0 } },
      machines: [],
      items: [],
      settings: { muted: true, selectedFilter: 'iron', buildDir: 1 },
      camera: null,
    };
    ls.setItem(SAVE_KEY_PREFIX + '0', JSON.stringify(v8));

    const migrated = sm.load(0);

    expect(migrated).not.toBeNull();
    expect(migrated.version).toBe(9);
    // 既存の v8 settings は保持される
    expect(migrated.settings.muted).toBe(true);
    expect(migrated.settings.selectedFilter).toBe('iron');
    expect(migrated.settings.buildDir).toBe(1);
    // Phase07 のデフォルト値がマージされる
    expect(migrated.settings.sfxVolume).toBe(1);
    expect(migrated.settings.bgmVolume).toBe(0.7);
    expect(migrated.settings.quality).toBe('high');
    expect(migrated.settings.haptics).toBe(true);
    expect(migrated.settings.showCamPad).toBe(true);
    expect(migrated.settings.shortNumbers).toBe(true);
  });

  /* ---- Phase07: v8セーブの既存拡張値は上書きされず保持される ---- */
  it('v8セーブに既にPhase07相当フィールドがあれば、それらが保持される', () => {
    const v8 = {
      version: 8,
      meta: { savedAt: 1, playTime: 0 },
      world: { seed: 1, tiles: [] },
      economy: { money: 0, stats: { earned: 0, msIndex: 0 } },
      machines: [], items: [],
      settings: { muted: false, selectedFilter: 'any', buildDir: 0, sfxVolume: 0.5, quality: 'low', haptics: false, shortNumbers: false },
      camera: null,
    };
    ls.setItem(SAVE_KEY_PREFIX + '0', JSON.stringify(v8));

    const migrated = sm.load(0);

    expect(migrated.version).toBe(9);
    expect(migrated.settings.sfxVolume).toBe(0.5);
    expect(migrated.settings.quality).toBe('low');
    expect(migrated.settings.haptics).toBe(false);
    expect(migrated.settings.shortNumbers).toBe(false);
    // 未設定のフィールドはデフォルト値でマージ
    expect(migrated.settings.bgmVolume).toBe(0.7);
    expect(migrated.settings.showCamPad).toBe(true);
  });

  /* ---- ケース(b): 破損JSONでnull+イベント発火 ---- */
  it('破損したJSONをload()するとnullを返しsave:corruptedを発火する', () => {
    ls.setItem(SAVE_KEY_PREFIX + '0', '{ this is not valid json ][');
    const events = [];
    bus.on(Events.SAVE_CORRUPTED, (p) => events.push(p));

    const result = sm.load(0);

    expect(result).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0].slot).toBe(0);
  });

  /* ---- ケース(c): export→importで同一データ ---- */
  it('exportString()→importString()で同一データが再現される', () => {
    const data = {
      version: 9,
      meta: { savedAt: 111, playTime: 222 },
      world: { seed: 7, tiles: [] },
      economy: { money: 999, stats: { earned: 10, msIndex: 0 } },
      machines: [{ t: 'conveyor', x: 3, z: 4, d: 1 }],
      items: [],
      settings: { muted: false, selectedFilter: 'any', buildDir: 0, sfxVolume: 1, bgmVolume: 0.7, quality: 'high', haptics: true, showCamPad: true, shortNumbers: true },
      camera: { yaw: 0.5, pitch: 0.9, dist: 40, tx: 0, tz: 0 },
    };
    sm.save(data, 0);

    const exported = sm.exportString(0);
    expect(typeof exported).toBe('string');
    expect(exported.length).toBeGreaterThan(0);

    // 別スロットへインポートしても内容が同一であることを確認
    const ok = sm.importString(exported, 1);
    expect(ok).toBe(true);

    const reloaded = sm.load(1);
    expect(reloaded).toEqual(data);
  });

  /* ---- ケース(d): 未知の将来バージョンは拒否 ---- */
  it('現行より新しい未知バージョンのセーブはload()で拒否されnullを返す', () => {
    const future = { version: SAVE_VERSION + 1, foo: 'bar' };
    ls.setItem(SAVE_KEY_PREFIX + '0', JSON.stringify(future));
    const events = [];
    bus.on(Events.SAVE_CORRUPTED, (p) => events.push(p));

    const result = sm.load(0);

    expect(result).toBeNull();
    expect(events).toHaveLength(1);
  });

  /* ---- 補助1: importString も未知バージョンを拒否する ---- */
  it('importString() も未知の将来バージョンは拒否してfalseを返す', () => {
    const future = { version: SAVE_VERSION + 5 };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(future))));
    const ok = sm.importString(b64, 0);
    expect(ok).toBe(false);
  });

  /* ---- 補助2: importString は不正なBase64/JSONに対してfalseを返す ---- */
  it('importString() は不正な文字列に対してfalseを返す', () => {
    expect(sm.importString('not-valid-base64-!!!', 0)).toBe(false);
  });

  /* ---- 補助3: listSlots() が各スロットのmeta情報を返す ---- */
  it('listSlots() は保存済みスロットのmeta(savedAt/money/playTime)を返す', () => {
    const data = {
      version: 9,
      meta: { savedAt: 555, playTime: 60 },
      world: { seed: 1, tiles: [] },
      economy: { money: 700, stats: { earned: 0, msIndex: 0 } },
      machines: [], items: [],
      settings: { muted: false, selectedFilter: 'any', buildDir: 0, sfxVolume: 1, bgmVolume: 0.7, quality: 'high', haptics: true, showCamPad: true, shortNumbers: true },
      camera: null,
    };
    sm.save(data, 1);

    const slots = sm.listSlots();
    expect(slots).toHaveLength(3);
    expect(slots[0].empty).toBe(true);
    expect(slots[1].empty).toBe(false);
    expect(slots[1].savedAt).toBe(555);
    expect(slots[1].money).toBe(700);
    expect(slots[1].playTime).toBe(60);
    expect(slots[2].empty).toBe(true);
  });

  /* ---- 補助3b: 旧 terraforge_muted=1 キーからミュート状態が settings.muted へ引き継がれ、旧キーは削除される ---- */
  it('loadLegacy() は旧 terraforge_muted キーからミュート状態を引き継ぎ、旧キーを削除する', () => {
    const v7 = { seed: 1, money: 500, stats: { earned: 0, msIndex: 0 }, tiles: [], machines: [], items: [] };
    ls.setItem(SAVE_KEY, JSON.stringify(v7));
    ls.setItem('terraforge_muted', '1');

    const migrated = sm.loadLegacy();

    expect(migrated.settings.muted).toBe(true);
    expect(ls.getItem('terraforge_muted')).toBeNull();
  });

  /* ---- 補助4: loadLegacy() は旧セーブが無ければnullを返す ---- */
  it('loadLegacy() は旧v7セーブが存在しなければnullを返す', () => {
    expect(sm.loadLegacy()).toBeNull();
  });

  /* ---- 補助5: save()/load() の通常ラウンドトリップ ---- */
  it('save()したデータをload()すると同一内容が返る', () => {
    const data = {
      version: 9,
      meta: { savedAt: 1, playTime: 2 },
      world: { seed: 3, tiles: [{ x: 0, z: 0, d: 1 }] },
      economy: { money: 500, stats: { earned: 0, msIndex: 0 } },
      machines: [], items: [],
      settings: { muted: false, selectedFilter: 'any', buildDir: 0, sfxVolume: 1, bgmVolume: 0.7, quality: 'high', haptics: true, showCamPad: true, shortNumbers: true },
      camera: { yaw: 0, pitch: 0, dist: 10, tx: 0, tz: 0 },
    };
    sm.save(data, 2);
    const loaded = sm.load(2);
    expect(loaded).toEqual(data);
  });
});
