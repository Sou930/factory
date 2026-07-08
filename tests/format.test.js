/* =====================================================================
   TerraForge — formatMoney ユニットテスト (Phase07)
   ---------------------------------------------------------------------
   指定8ケース(境界含む):
   1. 999 → "$999"
   2. 1000 → "$1K"
   3. 999999 → "$999.9K"
   4. 1000000 → "$1M"
   5. 1234567890 → "$1.2B"
   6. 負数 → "-$1.2K"
   7. 0 → "$0"
   8. OFF時(フル表示) → "$12,345,678"
   ===================================================================== */
import { describe, it, expect, beforeAll } from 'vitest';
import { formatMoney } from '../src/util/format.js';
import { gameState } from '../src/core/GameState.js';

/* THREE は util/format.js が state.js 経由で読み込むモジュールに影響しないが、
   他モジュール経由で参照される可能性があるためモックしておく */
beforeAll(() => {
  global.THREE = global.THREE || {
    Object3D: class { constructor() { this.position = { x:0, y:0, z:0 }; this.children = []; } clone() { return new THREE.Object3D(); } },
    Vector3: class { constructor(x,y,z) { this.x=x; this.y=y; this.z=z; } clone() { return new THREE.Vector3(this.x,this.y,this.z); } },
  };
});

describe('formatMoney', () => {
  /* ケース1: 999 → "$999" (省略ON) */
  it('999 は "$999" になる(省略ON)', () => {
    expect(formatMoney(999)).toBe('$999');
  });

  /* ケース2: 1000 → "$1K" (省略ON) */
  it('1000 は "$1K" になる(省略ON)', () => {
    expect(formatMoney(1000)).toBe('$1K');
  });

  /* ケース3: 999999 → "$999.9K" (省略ON) */
  it('999999 は "$999.9K" になる(省略ON)', () => {
    expect(formatMoney(999999)).toBe('$999.9K');
  });

  /* ケース4: 1000000 → "$1M" (省略ON) */
  it('1000000 は "$1M" になる(省略ON)', () => {
    expect(formatMoney(1000000)).toBe('$1M');
  });

  /* ケース5: 1234567890 → "$1.2B" (省略ON) — 仕様完了条件の例 */
  it('1234567890 は "$1.2B" になる(省略ON)', () => {
    expect(formatMoney(1234567890)).toBe('$1.2B');
  });

  /* ケース6: 負数 → "-$1.2K" (省略ON) */
  it('負数 -1234 は "-$1.2K" になる(省略ON)', () => {
    expect(formatMoney(-1234)).toBe('-$1.2K');
  });

  /* ケース7: 0 → "$0" (省略ON/OFF両方で同じ) */
  it('0 は "$0" になる(省略ON)', () => {
    expect(formatMoney(0)).toBe('$0');
  });

  /* ケース8: 省略OFF時はフル表示("$12,345,678") */
  it('省略OFF時 12345678 は "$12,345,678" のフル表示になる', () => {
    expect(formatMoney(12345678, false)).toBe('$12,345,678');
  });

  /* 補助1: 仕様完了条件の例 "$12.3M"(省略ON時) */
  it('仕様例: 12345678 は省略ON時 "$12.3M" と表示される', () => {
    expect(formatMoney(12345678, true)).toBe('$12.3M');
  });

  /* 補助2: 1034 → "$1K"(小数1桁切り捨てで .0 は削除) */
  it('1034 は "$1K" になる(切り捨て・.0削除)', () => {
    expect(formatMoney(1034)).toBe('$1K');
  });

  /* 補助3: settings.shortNumbers=false の時もOFFと同じ挙動 */
  it('settings.shortNumbers=false の時はフル表示になる', () => {
    const prev = gameState.settings.shortNumbers;
    gameState.settings.shortNumbers = false;
    try {
      expect(formatMoney(1234567)).toBe('$1,234,567');
    } finally {
      gameState.settings.shortNumbers = prev;
    }
  });

  /* 補助4: settings.shortNumbers=true(既定) の時は省略表示 */
  it('settings.shortNumbers=true(既定) の時は省略表示になる', () => {
    const prev = gameState.settings.shortNumbers;
    gameState.settings.shortNumbers = true;
    try {
      expect(formatMoney(1234567)).toBe('$1.2M');
    } finally {
      gameState.settings.shortNumbers = prev;
    }
  });
});
