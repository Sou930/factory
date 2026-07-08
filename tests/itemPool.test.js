/* =====================================================================
   TerraForge — ItemPool ユニットテスト (Phase05)
   ---------------------------------------------------------------------
   (a) acquire→release→再acquireで同一スロットが再利用される
   (b) activeフィルタが正しい
   (c) activeCount/size が正しく追跡される
   ===================================================================== */
import { describe, it, expect, beforeEach } from 'vitest';
import { ItemPool } from '../src/core/ItemPool.js';

/** テスト用の簡易 Vector3 (copy/clone をもつ) */
function v(x, y, z) {
  const o = { x, y, z };
  o.copy = function(p) { o.x = p.x; o.y = p.y; o.z = p.z; return o; };
  o.clone = function() { return v(o.x, o.y, o.z); };
  return o;
}

describe('ItemPool', () => {
  let pool;

  beforeEach(() => {
    pool = new ItemPool();
  });

  /* ---- ケース(a): acquire→release→再acquireで同一スロットが再利用される ---- */
  it('acquire→release→再acquireで同一スロットが再利用される', () => {
    const a = pool.acquire('coal', false, 5, 10, v(1, 2, 3));
    expect(a.oreType).toBe('coal');
    expect(a.ingot).toBe(false);
    expect(a.gx).toBe(5);
    expect(a.gz).toBe(10);
    expect(a.active).toBe(true);
    expect(pool.size).toBe(1);

    // リリース
    pool.release(a);
    expect(a.active).toBe(false);
    expect(pool.activeCount).toBe(0);
    expect(pool.size).toBe(1); // sizeは変わらない

    // 再acquire — 同一スロットが再利用される
    const b = pool.acquire('iron', true, 7, 20, v(20, 30, 40));
    expect(b).toBe(a); // 同一オブジェクト
    expect(b.oreType).toBe('iron');
    expect(b.ingot).toBe(true);
    expect(b.gx).toBe(7);
    expect(b.gz).toBe(20);
    expect(b.active).toBe(true);
    expect(pool.size).toBe(1); // スロット数は増えていない
    expect(pool.activeCount).toBe(1);
  });

  /* ---- ケース(b): activeフィルタが正しい ---- */
  it('activeフィルタが正しく動作する', () => {
    const pos = { x: 0, y: 0, z: 0, clone() { return { x: this.x, y: this.y, z: this.z }; } };

    const a = pool.acquire('coal', false, 0, 0, v(0, 0, 0));
    const b = pool.acquire('iron', false, 1, 1, v(0, 0, 0));
    const c = pool.acquire('gold', true, 2, 2, v(0, 0, 0));

    expect(pool.activeCount).toBe(3);

    // b をリリース
    pool.release(b);
    expect(pool.activeCount).toBe(2);

    // slotsを走査し、activeなものだけを取得
    const active = pool.slots.filter(s => s.active);
    expect(active).toHaveLength(2);
    expect(active[0]).toBe(a);
    expect(active[1]).toBe(c);
  });

  /* ---- ケース(c): activeCount/size が正しく追跡される ---- */
  it('activeCountとsizeが正しく追跡される', () => {
    expect(pool.size).toBe(0);
    expect(pool.activeCount).toBe(0);

    // 5個 acquire
    for (let i = 0; i < 5; i++) pool.acquire('coal', false, i, i, v(0, 0, 0));
    expect(pool.size).toBe(5);
    expect(pool.activeCount).toBe(5);

    // 3個 release
    pool.release(pool.slots[1]);
    pool.release(pool.slots[3]);
    pool.release(pool.slots[4]);
    expect(pool.size).toBe(5);
    expect(pool.activeCount).toBe(2);

    // 3個再acquire → sizeは増えない
    for (let i = 0; i < 3; i++) pool.acquire('iron', true, i, i, v(0, 0, 0));
    expect(pool.size).toBe(5); // 再利用されたので増えない
    expect(pool.activeCount).toBe(5);

    // さらに2個新規acquire
    pool.acquire('gold', false, 10, 10, v(0, 0, 0));
    pool.acquire('diamond', true, 11, 11, v(0, 0, 0));
    expect(pool.size).toBe(7); // 新規スロットが追加された
    expect(pool.activeCount).toBe(7);
  });

  /* ---- 補足: 空プールでreleaseしてもエラーにならない ---- */
  it('acquireしていない状態でreleaseしてもエラーにならない', () => {
    // 空プールで slots を直接操作して release
    const dummy = { active: false };
    expect(() => pool.release(dummy)).not.toThrow();
  });
});
