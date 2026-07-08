/* =====================================================================
   TerraForge — 電力システム (Phase04: キャッシュ最適化)
   ---------------------------------------------------------------------
   毎フレームの距離計算を排除し、電力状態を「設置/撤去/移動時のみ
   再計算されるキャッシュ」に置き換える。

   PowerGrid クラス:
     - rebuild(machines): 全機械から電力状態を再計算(イベント駆動)
     - isPowered(m): キャッシュ参照のみで即座に判定(毎フレーム O(1))
     - snapshot(): UI 表示用の現在状態オブジェクトを返す

   Phase21(電柱ネットワーク)で到達判定が置換されるため、rebuild 内部の
   距離判定ロジックは private に閉じ込め、isPowered のシグネチャを安定させる。
   ===================================================================== */
import { MACHINE_DEFS } from './machineDefs.js';
import { POWER_OUTPUT, POWER_RANGE } from './constants.js';
import { bus } from './core/EventBus.js';
import { Events } from './core/events.js';

const RANGE_SQ = POWER_RANGE * POWER_RANGE;

export class PowerGrid {
  /** 圏内かつ供給可能な消費機械の "gx,gz" セット */
  #poweredSet = new Set();

  /** 総発電容量 */
  capacity = 0;
  /** 圏内の消費機械の合計消費量 */
  used = 0;
  /** 圏外にある消費機械の台数 */
  outOfRange = 0;
  /** 容量内に収まっているか (used <= capacity) */
  ok = true;

  /**
   * 全機械のリストから電力網を再構築する。
   * 設置/撤去/移動の各イベントハンドラから呼ばれる。
   * @param {Iterable} machines - state.machines.values() のような Map iterator
   */
  rebuild(machines) {
    this.#poweredSet.clear();
    let capacity = 0;
    const generators = [];

    // 1) 全 generator を列挙し capacity を集計
    for (const m of machines) {
      if (m.type === 'generator') {
        capacity += POWER_OUTPUT.generator;
        generators.push(m);
      }
    }

    // 2) 各消費機械(powerUse>0)について、いずれかの generator と
    //    dist <= POWER_RANGE なら #poweredSet に追加、used += use
    //    そうでなければ outOfRange++
    let used = 0;
    let outOfRange = 0;

    for (const m of machines) {
      const use = MACHINE_DEFS[m.type]?.powerUse ?? 0;
      if (use === 0) continue;

      let inRange = false;
      for (let i = 0; i < generators.length; i++) {
        const g = generators[i];
        const dx = m.gx - g.gx;
        const dz = m.gz - g.gz;
        if (dx * dx + dz * dz <= RANGE_SQ) {
          inRange = true;
          break;
        }
      }

      if (inRange) {
        this.#poweredSet.add(m.gx + ',' + m.gz);
        used += use;
      } else {
        outOfRange++;
      }
    }

    // 3) 状態を確定
    this.capacity = capacity;
    this.used = used;
    this.outOfRange = outOfRange;
    this.ok = used <= capacity;

    // 4) UI 更新用イベントを発火
    bus.emit(Events.POWER_CHANGED, this.snapshot());
  }

  /**
   * 指定機械が電力供給を受けているかを判定する(キャッシュ参照のみ)。
   * @param {{ type: string, gx: number, gz: number }} m
   * @returns {boolean}
   */
  isPowered(m) {
    const need = MACHINE_DEFS[m.type]?.powerUse ?? 0;
    if (need === 0) return true;
    return this.ok && this.#poweredSet.has(m.gx + ',' + m.gz);
  }

  /**
   * UI 表示用のスナップショットオブジェクトを返す。
   * @returns {{ capacity: number, used: number, outOfRange: number, ok: boolean }}
   */
  snapshot() {
    return { capacity: this.capacity, used: this.used, outOfRange: this.outOfRange, ok: this.ok };
  }
}

/* シングルトン: GameState が1インスタンス保持 */
export const powerGrid = new PowerGrid();
