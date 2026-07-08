/* =====================================================================
   TerraForge — PowerGrid ユニットテスト (Phase04)
   ---------------------------------------------------------------------
   キャッシュ最適化された電力システムの動作検証。
   (a) 発電機なし→全消費機械停止
   (b) 範囲7ちょうどの機械は圏内
   (c) 容量超過で ok=false
   (d) 撤去後のrebuildで正しく減算
   (e) 電力不要機械は常に isPowered=true
   (f) rebuild が power:changed イベントを発火する
   ===================================================================== */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/* machineDefs.js は THREE/scene.js 等の重い依存があるためモックする。
   PowerGrid は MACHINE_DEFS[type].powerUse を参照するだけなので、
   このモックで十分。 */
vi.mock('../src/machineDefs.js', () => ({
  MACHINE_DEFS: {
    drill:        { powerUse: 2 },
    drill2:       { powerUse: 3 },
    smelter:      { powerUse: 4 },
    autoCrafter:  { powerUse: 6 },
    conveyor:     { powerUse: 0 },
    fastConveyor: { powerUse: 0 },
    filterConveyor: { powerUse: 0 },
    splitter:     { powerUse: 0 },
    merger:       { powerUse: 0 },
    chest:        { powerUse: 0 },
    seller:       { powerUse: 0 },
    generator:    { powerUse: 0 },
  },
}));

import { PowerGrid } from '../src/power.js';
import { bus } from '../src/core/EventBus.js';
import { Events } from '../src/core/events.js';

/** テスト用のダミー機械オブジェクトを作成 */
function machine(type, gx, gz) {
  return { type, gx, gz };
}

describe('PowerGrid', () => {
  let grid;

  beforeEach(() => {
    grid = new PowerGrid();
    bus.clear();
  });

  /* ---- ケース(a): 発電機なし→全消費機械停止 ---- */
  it('発電機がない場合、全消費機械は isPowered=false となる', () => {
    const machines = [
      machine('drill', 10, 10),
      machine('smelter', 12, 10),
    ];
    grid.rebuild(machines);

    expect(grid.capacity).toBe(0);
    expect(grid.outOfRange).toBe(2); // 両方圏外
    expect(grid.used).toBe(0);
    expect(grid.ok).toBe(true); // used(0) <= capacity(0) なので true
    expect(grid.isPowered(machines[0])).toBe(false);
    expect(grid.isPowered(machines[1])).toBe(false);
  });

  /* ---- ケース(b): 範囲7ちょうどの機械は圏内 ---- */
  it('範囲7ちょうど(距離=7)の機械は圏内として判定される', () => {
    // POWER_RANGE = 7, なので dx*dx + dz*dz <= 49
    // 距離7: dx=7, dz=0 → 49 <= 49 → 圏内
    const machines = [
      machine('generator', 0, 0),
      machine('drill', 7, 0),     // dx=7, dz=0 → 49 <= 49 → 圏内
      machine('drill', 8, 0),     // dx=8, dz=0 → 64 > 49 → 圏外
    ];
    grid.rebuild(machines);

    expect(grid.snapshot().capacity).toBe(12); // POWER_OUTPUT.generator = 12
    expect(grid.snapshot().outOfRange).toBe(1);
    expect(grid.snapshot().used).toBe(2); // drill の powerUse = 2
    expect(grid.snapshot().ok).toBe(true);
    expect(grid.isPowered(machines[0])).toBe(true);  // generator (powerUse=0)
    expect(grid.isPowered(machines[1])).toBe(true);  // drill at (7,0) — 圏内
    expect(grid.isPowered(machines[2])).toBe(false); // drill at (8,0) — 圏外
  });

  /* ---- 斜め方向の距離判定: dx=5, dz=5 → 50 > 49 → 圏外 ---- */
  it('斜め距離がルート50の機械は圏外となる(dx=5,dz=5→50>49)', () => {
    const machines = [
      machine('generator', 0, 0),
      machine('drill', 5, 5), // 25+25=50 > 49 → 圏外
    ];
    grid.rebuild(machines);

    expect(grid.snapshot().outOfRange).toBe(1);
    expect(grid.isPowered(machines[1])).toBe(false);
  });

  /* ---- ケース(c): 容量超過で ok=false ---- */
  it('消費量が容量を超えると ok=false となり圏内機械も停止する', () => {
    // generator: capacity=12, smelter(4) + autoCrafter(6) = 10 → ok
    // さらに drill(2) を追加 → used=12 → ok (used <= capacity)
    // さらに drill2(3) を追加 → used=15 → ok=false
    const machines = [
      machine('generator', 0, 0),
      machine('smelter', 1, 0),      // powerUse=4
      machine('autoCrafter', 2, 0),  // powerUse=6
      machine('drill', 3, 0),        // powerUse=2
    ];
    grid.rebuild(machines);

    // used = 4 + 6 + 2 = 12, capacity = 12
    expect(grid.snapshot().used).toBe(12);
    expect(grid.snapshot().capacity).toBe(12);
    expect(grid.snapshot().ok).toBe(true);

    // 容量超過させる: drill2 (powerUse=3) を追加
    const extra = machine('drill2', 4, 0);
    machines.push(extra);
    grid.rebuild(machines);

    // used = 4 + 6 + 2 + 3 = 15 > 12
    expect(grid.snapshot().used).toBe(15);
    expect(grid.snapshot().capacity).toBe(12);
    expect(grid.snapshot().ok).toBe(false);
    // ok=false なので、全ての消費機械が isPowered=false
    expect(grid.isPowered(machines[1])).toBe(false);
    expect(grid.isPowered(machines[2])).toBe(false);
    expect(grid.isPowered(machines[3])).toBe(false);
    expect(grid.isPowered(machines[4])).toBe(false);
  });

  /* ---- ケース(d): 撤去後のrebuildで正しく減算 ---- */
  it('発電機撤去後のrebuildで容量・供給が正しく減算される', () => {
    const gen = machine('generator', 0, 0);
    const drill = machine('drill', 3, 0);
    const machines = [gen, drill];
    grid.rebuild(machines);

    expect(grid.snapshot().capacity).toBe(12);
    expect(grid.snapshot().used).toBe(2);
    expect(grid.isPowered(drill)).toBe(true);

    // 発電機を撤去
    const remaining = [drill];
    grid.rebuild(remaining);

    expect(grid.snapshot().capacity).toBe(0);
    expect(grid.snapshot().used).toBe(0);
    expect(grid.snapshot().outOfRange).toBe(1);
    expect(grid.snapshot().ok).toBe(true);
    expect(grid.isPowered(drill)).toBe(false);
  });

  /* ---- ケース(e): 電力不要機械は常に isPowered=true ---- */
  it('電力不要機械(powerUse=0)は常に isPowered=true', () => {
    const machines = [
      machine('conveyor', 10, 10),
      machine('seller', 20, 20),
    ];
    grid.rebuild(machines);

    expect(grid.isPowered(machines[0])).toBe(true);
    expect(grid.isPowered(machines[1])).toBe(true);
  });

  /* ---- ケース(f): rebuild が power:changed イベントを発火する ---- */
  it('rebuild() は power:changed イベントを発火する', () => {
    const calls = [];
    bus.on(Events.POWER_CHANGED, (p) => calls.push(p));

    const machines = [
      machine('generator', 0, 0),
      machine('drill', 3, 0),
    ];
    grid.rebuild(machines);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      capacity: 12,
      used: 2,
      outOfRange: 0,
      ok: true,
    });
  });

  /* ---- 補足: snapshot() は独立したオブジェクトを返す ---- */
  it('snapshot() は新しいオブジェクトを返す(内部状態の安全なコピー)', () => {
    const machines = [machine('generator', 0, 0)];
    grid.rebuild(machines);

    const s1 = grid.snapshot();
    const s2 = grid.snapshot();
    expect(s1).not.toBe(s2); // 異なるオブジェクト
    expect(s1).toEqual(s2);   // 同じ内容
  });

  /* ---- 補足: 空の machines で rebuild してもエラーにならない ---- */
  it('空の機械リストで rebuild() してもエラーにならない', () => {
    expect(() => grid.rebuild([])).not.toThrow();
    expect(grid.snapshot()).toMatchObject({
      capacity: 0, used: 0, outOfRange: 0, ok: true,
    });
  });
});
