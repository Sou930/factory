/* =====================================================================
   TerraForge — DebugConsole ユニットテスト (Phase08)
   ---------------------------------------------------------------------
   指定4ケース(テスト項目):
   1. `give 10000` で所持金 +$10,000 (addMoney 直呼び、earn は呼ばれない)
   2. `place drill 48 48` で機械を配置
   3. `clearmachines` で全機械削除
   4. `setpower 999` で capacity 設定

   補助:
   - parseCommand の基本動作
   - 未知コマンドで error 応答
   - フォーマット不正で usage 表示
   - isDebugMode() が ?debug=1 を正しく判定

   重い依存(scene/world/machines/particles/save)は vi.mock で差し替える。
   テスト対象は parseCommand / execCommand の純粋ロジック。
   ===================================================================== */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/* vi.mock はファイル最上部へ巻き上げられるため、モック内で参照する
   ミュータブルな状態は vi.hoisted で巻き上げる必要がある。 */
const hoisted = vi.hoisted(() => {
  // テスト間で共有する gameState の状態
  const shared = {
    money: 500,
    stats: { earned: 0, msIndex: 0 },
    machines: new Map(),
    tiles: (() => {
      const tiles = [];
      for (let gx = 0; gx < 96; gx++) {
        tiles[gx] = [];
        for (let gz = 0; gz < 96; gz++) tiles[gx][gz] = { depth: 0, elev: 0, ore: null };
      }
      // 中央(48,48)に露出鉱石を置く(place drill 48 48 用)
      tiles[48][48].ore = { type: 'coal' };
      return tiles;
    })(),
    placeMachineMock: null,
  };
  return shared;
});

/* ---- モック: state.js (GameState シングルトン相当) ---- */
vi.mock('../src/state.js', () => {
  const gameState = {
    get money() { return hoisted.money; },
    addMoney(v) { hoisted.money += v; },
    earn(v) { hoisted.money += v; if (v > 0) hoisted.stats.earned += v; },
    stats: hoisted.stats,
    settings: {},
  };
  const state = { machines: hoisted.machines, tiles: hoisted.tiles };
  return { gameState, state };
});

/* ---- モック: constants.js (必要なものだけ) ---- */
vi.mock('../src/constants.js', () => ({
  GRID: 96,
  TS: 2,
  ORES: { coal: { name: '石炭', depth: 1 } },
  COSTS: { drill: 50, conveyor: 10, smelter: 120, seller: 80 },
}));

/* ---- モック: render/scene.js ---- */
vi.mock('../src/render/scene.js', () => ({
  renderer: { info: { render: { calls: 0 } } },
  getFpsEMA: () => 60,
}));

/* ---- モック: particles.js ---- */
vi.mock('../src/particles.js', () => ({
  doScan: vi.fn(),
  clearScan: vi.fn(),
  getParticleCount: () => 0,
}));

/* ---- モック: world.js ---- */
vi.mock('../src/world.js', () => ({
  key: (gx, gz) => gx + ',' + gz,
  inGrid: (gx, gz) => gx >= 0 && gz >= 0 && gx < 96 && gz < 96,
}));

/* ---- モック: machines.js (placeMachine/removeMachine/updateMachines) ---- */
vi.mock('../src/machines.js', () => {
  const placeMachineMock = vi.fn((type, gx, gz, dir, silent) => {
    if (hoisted.machines.has(gx + ',' + gz)) return false;
    if (type === 'drill' || type === 'drill2') {
      const t = hoisted.tiles[gx][gz];
      if (!t.ore) return false;
    }
    hoisted.machines.set(gx + ',' + gz, { type, gx, gz, dir, mesh: null, item: null });
    return true;
  });
  // テストから参照できるよう hoisted にも保持
  hoisted.placeMachineMock = placeMachineMock;
  return {
    placeMachine: placeMachineMock,
    removeMachine: vi.fn((gx, gz) => hoisted.machines.delete(gx + ',' + gz)),
    updateMachines: vi.fn(),
  };
});

/* ---- モック: save.js ---- */
vi.mock('../src/save.js', () => ({
  saveGame: vi.fn(() => true),
}));

/* ---- モック: ctx.js ---- */
vi.mock('../src/ctx.js', () => ({
  ctx: {
    itemPool: { slots: [], release: () => {} },
    toast: vi.fn(),
  },
}));

/* ---- モック: power.js (machineDefs/logistics/meshes の重い依存を回避) ---- */
vi.mock('../src/power.js', () => {
  const powerGrid = {
    capacity: 0,
    used: 0,
    outOfRange: 0,
    ok: true,
    rebuild: vi.fn(),
    isPowered: () => true,
    snapshot: function() { return { capacity: this.capacity, used: this.used, outOfRange: this.outOfRange, ok: this.ok }; },
  };
  return { powerGrid };
});

import { parseCommand, execCommand, isDebugMode } from '../src/debug/DebugConsole.js';
import { state, gameState } from '../src/state.js';
import { powerGrid } from '../src/power.js';

describe('DebugConsole.parseCommand', () => {
  it('単純なコマンドを cmd + args に分割する', () => {
    expect(parseCommand('give 10000')).toEqual({ cmd: 'give', args: ['10000'] });
    expect(parseCommand('PLACE drill 48 48')).toEqual({ cmd: 'place', args: ['drill', '48', '48'] });
    expect(parseCommand('clearmachines')).toEqual({ cmd: 'clearmachines', args: [] });
  });
  it('空文字列・空白のみは null を返す', () => {
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('   ')).toBeNull();
    expect(parseCommand(null)).toBeNull();
  });
});

describe('DebugConsole.execCommand', () => {
  beforeEach(() => {
    hoisted.money = 500;
    hoisted.stats.earned = 0;
    hoisted.stats.msIndex = 0;
    hoisted.machines.clear();
    if (hoisted.placeMachineMock) hoisted.placeMachineMock.mockClear();
  });

  /* ケース1: give 10000 で所持金 +$10,000 (addMoney 直呼び、earn は呼ばれない) */
  it('give 10000 で所持金が +10000 され、stats.earned は変わらない', () => {
    const before = gameState.money;
    const earnedBefore = gameState.stats.earned;

    const result = execCommand('give 10000');

    expect(gameState.money).toBe(before + 10000);
    // earn() を通さないので累計収益は汚染されない
    expect(gameState.stats.earned).toBe(earnedBefore);
    expect(result.kind).toBeFalsy(); // success
    expect(result.message).toContain('+10,000');
  });

  /* ケース2: place drill 48 48 で機械を配置 */
  it('place drill 48 48 でドリルを配置する', () => {
    const result = execCommand('place drill 48 48');
    expect(hoisted.placeMachineMock).toHaveBeenCalledWith('drill', 48, 48, 0, true);
    // モック placeMachine は hoisted.machines に追加する
    expect(state.machines.has('48,48')).toBe(true);
    expect(result.message).toContain('配置');
  });

  /* ケース3: clearmachines で全機械削除 */
  it('clearmachines で state.machines が空になる', () => {
    // 事前に機械を2つ登録
    state.machines.set('1,1', { type: 'conveyor', gx: 1, gz: 1, mesh: null, item: null });
    state.machines.set('2,2', { type: 'drill', gx: 2, gz: 2, mesh: null, item: null });
    expect(state.machines.size).toBe(2);

    const result = execCommand('clearmachines');

    expect(state.machines.size).toBe(0);
    expect(result.message).toContain('2');
  });

  /* ケース4: setpower 999 で capacity を設定 */
  it('setpower 999 で powerGrid.capacity が 999 になる', () => {
    const result = execCommand('setpower 999');
    expect(powerGrid.capacity).toBe(999);
    expect(result.message).toContain('999');
  });

  /* 補助1: 未知コマンドは error 応答 */
  it('未知コマンドは kind=error のメッセージを返す', () => {
    const result = execCommand('foobar 1 2 3');
    expect(result.kind).toBe('error');
    expect(result.message).toContain('foobar');
  });

  /* 補助2: フォーマット不正で usage 表示 */
  it('give の引数不足で usage を返す', () => {
    const result = execCommand('give');
    expect(result.kind).toBe('error');
    expect(result.message).toContain('usage');
  });

  /* 補助3: place の範囲外座標で error */
  it('place でグリッド範囲外の座標は error', () => {
    const result = execCommand('place drill 999 999');
    expect(result.kind).toBe('error');
  });

  /* 補助4: isDebugMode() が ?debug=1 を正しく判定 */
  it('isDebugMode() は URL の ?debug=1 を判定する', () => {
    expect(typeof isDebugMode).toBe('function');
    // jsdom では history.pushState で URL を切替可能
    window.history.pushState({}, '', '/?debug=1');
    expect(isDebugMode()).toBe(true);
    window.history.pushState({}, '', '/');
    expect(isDebugMode()).toBe(false);
  });
});
