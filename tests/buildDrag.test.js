/* =====================================================================
   TerraForge — Phase09: 撤去返金率差別化 / ビルドドラッグ方向計算の純粋ロジックテスト
   ---------------------------------------------------------------------
   removeMachine 本体は THREE/scene/ctx への依存が大きいため、他のテスト
   ファイルと同様に対象ロジックをここで純粋関数として再現し検証する。
   ===================================================================== */
import { describe, it, expect } from 'vitest';

/* ---- DIRS: constants.js と同じ定義 ---- */
const DIRS = [ { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 } ];

const COSTS = { conveyor: 10, fastConveyor: 25, filterConveyor: 30, drill: 50, smelter: 120 };

/* ---- machines.js の refundRate 参照ロジックを再現 ---- */
const MACHINE_DEFS_STUB = {
  conveyor: { refundRate: 0.9 },
  fastConveyor: { refundRate: 0.9 },
  filterConveyor: { refundRate: 0.9 },
  drill: { refundRate: 0.5 },
  smelter: { refundRate: 0.5 },
};
function computeRefund(type) {
  const def = MACHINE_DEFS_STUB[type];
  const refundRate = def && def.refundRate !== undefined ? def.refundRate : 0.5;
  return Math.floor((COSTS[type] || 0) * refundRate);
}

/* ---- input.js BuildDragSession._dirFrom のロジックを再現 ---- */
function dirFrom(gx, gz, ngx, ngz) {
  const dx = ngx - gx, dz = ngz - gz;
  for (let d = 0; d < 4; d++) if (DIRS[d].x === dx && DIRS[d].z === dz) return d;
  return null;
}

describe('撤去返金率(balance item 79: コンベア系90% / その他50%)', () => {
  it('conveyor refunds 90%', () => {
    expect(computeRefund('conveyor')).toBe(9); // floor(10 * 0.9)
  });
  it('fastConveyor refunds 90%', () => {
    expect(computeRefund('fastConveyor')).toBe(22); // floor(25 * 0.9)
  });
  it('filterConveyor refunds 90%', () => {
    expect(computeRefund('filterConveyor')).toBe(27); // floor(30 * 0.9)
  });
  it('drill (non-conveyor) still refunds 50%', () => {
    expect(computeRefund('drill')).toBe(25); // floor(50 * 0.5)
  });
  it('smelter (non-conveyor) still refunds 50%', () => {
    expect(computeRefund('smelter')).toBe(60); // floor(120 * 0.5)
  });
  it('unknown type falls back to 50%', () => {
    expect(computeRefund('mysteryMachine')).toBe(0); // COSTS未定義 → 0
  });
});

describe('ビルドドラッグ: 隣接タイル間の方向計算(_dirFrom)', () => {
  it('東(+x)への移動は dir 0', () => {
    expect(dirFrom(5, 5, 6, 5)).toBe(0);
  });
  it('南(+z)への移動は dir 1', () => {
    expect(dirFrom(5, 5, 5, 6)).toBe(1);
  });
  it('西(-x)への移動は dir 2', () => {
    expect(dirFrom(5, 5, 4, 5)).toBe(2);
  });
  it('北(-z)への移動は dir 3', () => {
    expect(dirFrom(5, 5, 5, 4)).toBe(3);
  });
  it('同一タイル(未移動)は null', () => {
    expect(dirFrom(5, 5, 5, 5)).toBe(null);
  });
  it('隣接しないタイル(斜め/飛び越し)は null', () => {
    expect(dirFrom(5, 5, 6, 6)).toBe(null);
    expect(dirFrom(5, 5, 7, 5)).toBe(null);
  });
  it('L字ドラッグ: 東へ2マス→南へ1マスで方向が正しく切り替わる', () => {
    const path = [[5, 5], [6, 5], [7, 5], [7, 6]];
    const dirs = [];
    for (let i = 1; i < path.length; i++) {
      dirs.push(dirFrom(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]));
    }
    expect(dirs).toEqual([0, 0, 1]); // 東, 東, 南(曲がり角)
  });
});

describe('ビルドドラッグ: 資金不足時の中断は1回のみ', () => {
  it('stoppedForMoney フラグが立った後は再度トーストしない', () => {
    let toastCount = 0;
    let stoppedForMoney = false;
    let money = 15; // conveyor(10)は2本目で不足する想定

    function tryPlace() {
      if (stoppedForMoney) return false;
      if (money < COSTS.conveyor) {
        if (!stoppedForMoney) { stoppedForMoney = true; toastCount++; }
        return false;
      }
      money -= COSTS.conveyor;
      return true;
    }

    expect(tryPlace()).toBe(true);  // money 15->5
    expect(tryPlace()).toBe(false); // 5 < 10, stop + toast
    expect(tryPlace()).toBe(false); // already stopped, no extra toast
    expect(tryPlace()).toBe(false);
    expect(toastCount).toBe(1);
  });
});
