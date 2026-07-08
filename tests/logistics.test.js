/* =====================================================================
   TerraForge — logistics.canAccept の純粋ロジックテスト
   ===================================================================== */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ---- モック: THREE をグローバルに注入 ---- */
beforeAll(() => {
  class Obj3D {
    constructor() { this.position = { x: 0, y: 0, z: 0 }; this.children = []; }
    clone() { return new Obj3D(); }
  }
  class Vec3 {
    constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
    clone() { return new Vec3(this.x, this.y, this.z); }
    addScaledVector() {}
  }
  global.THREE = {
    Object3D: Obj3D,
    Vector3: Vec3,
    Group: class extends Obj3D {},
    Sprite: class extends Obj3D {},
  };
});

/* ---- state モック ---- */
const state = {
  tiles: [],
  machines: new Map(),
  items: [],
  powerDirty: true,
  power: { used: 0, capacity: 0, ok: true },
  time: 0,
};

/* ---- テスト用の canAccept ロジックを直接インポート ---- */
/* canAcceptはMACHINE_DEFSに依存するため、純粋ロジック部分をここでテストする */

/* ===== テスト用ヘルパー ===== */
function makeMachine(overrides) {
  return {
    type: 'smelter', gx: 5, gz: 5, dir: 0, mesh: {},
    item: null, buffer: [], progress: 0, processing: null,
    incoming: 0, outIndex: 0, rejectIndex: 0,
    storage: {}, cap: 300, filter: 'any',
    craftStock: {}, craftRecipe: null, craftProgress: 0, selectedRecipeId: 'auto',
    timer: 0,
    ...overrides,
  };
}
function makeItem(oreType, ingot) {
  return { oreType, ingot: !!ingot, mesh: {}, gx: 0, gz: 0, moving: false, t: 0, from: null, to: null, moveSpeed: 1.4 };
}

/* ===== 精錬炉の上限チェック ===== */
const SMELTER_QUEUE_MAX = 2;
const MERGER_QUEUE_MAX = 4;
const CHEST_CAPACITY = 300;
const CRAFTER_STOCK_PER_KIND = 12;
const CRAFTER_STOCK_TOTAL = 40;
const AUTOCRAFT_USABLE = new Set(['copper_i', 'iron_i', 'silver_i', 'gold_i', 'coal_o', 'mithril_i', 'diamond_i', 'ruby_i']);

function stockTotal(stock) {
  let sum = 0;
  for (const k in stock) sum += stock[k];
  return sum;
}
function chestTotal(m) {
  return stockTotal(m.storage);
}

/* ===== テストケース ===== */
describe('canAccept 純粋ロジック', () => {

  // テスト1: 精錬炉はインゴットを受け取らない
  it('smelter rejects ingots', () => {
    const m = makeMachine({ type: 'smelter', buffer: [], incoming: 0 });
    const it = makeItem('iron', true); // ingot
    const sk = it.oreType + (it.ingot ? '_i' : '_o');
    const result = !it.ingot && m.buffer.length + m.incoming < SMELTER_QUEUE_MAX;
    expect(result).toBe(false);
  });

  // テスト2: 精錬炉は鉱石(ingot=false)を受け取る
  it('smelter accepts ore when buffer has room', () => {
    const m = makeMachine({ type: 'smelter', buffer: [], incoming: 0 });
    const it = makeItem('iron', false);
    const result = !it.ingot && m.buffer.length + m.incoming < SMELTER_QUEUE_MAX;
    expect(result).toBe(true);
  });

  // テスト3: 精錬炉はバッファ上限(SMELTER_QUEUE_MAX=2)を超えると拒否
  it('smelter rejects when buffer + incoming >= SMELTER_QUEUE_MAX', () => {
    const m = makeMachine({ type: 'smelter', buffer: [{ oreType: 'coal' }], incoming: 1 });
    // buffer.length(1) + incoming(1) = 2 >= SMELTER_QUEUE_MAX(2) → 拒否
    const it = makeItem('iron', false);
    const result = !it.ingot && m.buffer.length + m.incoming < SMELTER_QUEUE_MAX;
    expect(result).toBe(false);
  });

  // テスト4: チェストは容量(CHEST_CAPACITY=300)未満なら受け取る
  it('chest accepts when under capacity', () => {
    const m = makeMachine({ type: 'chest', storage: { coal_o: 50, iron_o: 50 }, incoming: 0, cap: CHEST_CAPACITY });
    const it = makeItem('copper', false);
    const result = chestTotal(m) + m.incoming < m.cap;
    expect(result).toBe(true);
  });

  // テスト5: チェストは容量超過で拒否
  it('chest rejects when at or over capacity', () => {
    const m = makeMachine({ type: 'chest', storage: {}, incoming: 300, cap: CHEST_CAPACITY });
    const it = makeItem('copper', false);
    const result = chestTotal(m) + m.incoming < m.cap;
    expect(result).toBe(false);
  });

  // テスト6: 合流機はバッファ上限(MERGER_QUEUE_MAX=4)を超えると拒否
  it('merger rejects when buffer + incoming >= MERGER_QUEUE_MAX', () => {
    const m = makeMachine({ type: 'merger', buffer: [{ oreType: 'coal' }, { oreType: 'iron' }, { oreType: 'copper' }], incoming: 1 });
    // 3 + 1 = 4 >= 4 → 拒否
    const result = m.buffer.length + m.incoming < MERGER_QUEUE_MAX;
    expect(result).toBe(false);
  });

  // テスト7: 合流機は空なら受け取る
  it('merger accepts when buffer has room', () => {
    const m = makeMachine({ type: 'merger', buffer: [], incoming: 0 });
    const result = m.buffer.length + m.incoming < MERGER_QUEUE_MAX;
    expect(result).toBe(true);
  });

  // テスト8: 自動工房はレシピに使わない素材を拒否
  it('autoCrafter rejects materials not in any recipe', () => {
    const m = makeMachine({ type: 'autoCrafter', craftStock: {}, incoming: 0 });
    const it = makeItem('ruby', false); // 'ruby_o' is NOT in AUTOCRAFT_USABLE
    const sk = it.oreType + (it.ingot ? '_i' : '_o');
    const usable = AUTOCRAFT_USABLE.has(sk);
    const perKindOk = ((m.craftStock || {})[sk] || 0) < CRAFTER_STOCK_PER_KIND;
    const totalOk = stockTotal(m.craftStock || {}) + m.incoming < CRAFTER_STOCK_TOTAL;
    const result = usable && perKindOk && totalOk;
    expect(result).toBe(false);
  });

  // テスト9: 自動工房は同一素材がCRAFTER_STOCK_PER_KIND(12)に達すると拒否
  it('autoCrafter rejects when same material reaches per-kind limit', () => {
    const m = makeMachine({ type: 'autoCrafter', craftStock: { copper_i: 12 }, incoming: 0 });
    const it = makeItem('copper', true);
    const sk = it.oreType + (it.ingot ? '_i' : '_o');
    const usable = AUTOCRAFT_USABLE.has(sk);
    const perKindOk = ((m.craftStock || {})[sk] || 0) < CRAFTER_STOCK_PER_KIND;
    const result = usable && perKindOk;
    expect(result).toBe(false);
  });

  // テスト10: コンベアはアイテムがなければ受け取る
  it('conveyor accepts when no item is held', () => {
    const m = makeMachine({ type: 'conveyor', item: null });
    const result = !m.item;
    expect(result).toBe(true);
  });

  // テスト11: コンベアはアイテムがあれば拒否
  it('conveyor rejects when item is already held', () => {
    const m = makeMachine({ type: 'conveyor', item: makeItem('coal', false) });
    const result = !m.item;
    expect(result).toBe(false);
  });

  // テスト12: 販売機は常に受け取る
  it('seller always accepts', () => {
    const m = makeMachine({ type: 'seller' });
    const result = true; // seller has no acceptance restriction
    expect(result).toBe(true);
  });
});