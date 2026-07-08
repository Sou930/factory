/* =====================================================================
   TerraForge — セーブ復元ヘルパー(findNearestChest / depositIntoNearestChestOrDiscard)
   ユニットテスト (Phase06)
   ---------------------------------------------------------------------
   ロード時、移動中アイテムの行き先マスが既に埋まっている「暗黙の二重占有」を
   解消するため、最寄りチェストへ格納/破棄するロジックを検証する。
   ===================================================================== */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/* logistics.js は render/meshes.js・render/scene.js・machineDefs.js 経由で
   重いTHREE依存を引き込むため、drillNaturalStop.test.js と同様にモックする */
vi.mock('../src/render/scene.js', () => ({
  scene: { add: () => {}, remove: () => {} },
  camera: {}, cam: { target: { x: 0, z: 0 } },
  renderer: { render: () => {} },
  updateCamera: () => {}, onResize: () => {}, updateAdaptiveQuality: () => {},
}));
vi.mock('../src/render/meshes.js', () => ({
  MESH_BUILDERS: {},
  updateFilterGem: () => {}, applyFastConveyorTint: () => {},
  buildConveyorMeshShaped: () => ({}), buildFilterConveyorMeshShaped: () => ({}),
  sharedMat: () => ({}), enhanceMaterial: (m) => m,
  BELT_ARM: 0.5, BELT_W: 0.5,
}));
vi.mock('../src/world.js', () => ({
  worldX: () => 0, worldZ: () => 0, tileTopY: () => 0, yJitter: () => 0,
  inGrid: (gx, gz) => gx >= 0 && gz >= 0 && gx < 96 && gz < 96,
  key: (gx, gz) => gx + ',' + gz,
  refreshTile: () => {}, createWorld: () => {}, mulberry32: () => () => 0.5,
}));
vi.stubGlobal('THREE', {
  Vector3: class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    clone() { return new THREE.Vector3(this.x, this.y, this.z); }
  },
});

describe('セーブ復元ヘルパー: findNearestChest / depositIntoNearestChestOrDiscard', () => {
  let state, findNearestChest, depositIntoNearestChestOrDiscard;

  beforeEach(async () => {
    vi.resetModules();
    ({ state } = await import('../src/state.js'));
    ({ findNearestChest, depositIntoNearestChestOrDiscard } = await import('../src/logistics.js'));
    state.machines = new Map();
  });

  function chest(gx, gz, overrides = {}) {
    return { type: 'chest', gx, gz, storage: {}, cap: 300, ...overrides };
  }

  /* ---- ケース1: チェストが1つも無ければ null / false ---- */
  it('チェストが1つも無い場合 findNearestChest は null を返し、depositは false を返す', () => {
    expect(findNearestChest(5, 5)).toBeNull();
    expect(depositIntoNearestChestOrDiscard('iron', false, 5, 5)).toBe(false);
  });

  /* ---- ケース2: 最も近いチェストが選ばれる(マンハッタン距離) ---- */
  it('複数チェストがある場合、マンハッタン距離が最小のものが選ばれる', () => {
    const near = chest(3, 3);
    const far = chest(20, 20);
    state.machines.set('3,3', near);
    state.machines.set('20,20', far);

    const found = findNearestChest(4, 4);
    expect(found).toBe(near);
  });

  /* ---- ケース3: 格納に成功すると storage が増分される ---- */
  it('depositIntoNearestChestOrDiscard は最寄りチェストの storage を増分してtrueを返す', () => {
    const c = chest(1, 1);
    state.machines.set('1,1', c);

    const ok = depositIntoNearestChestOrDiscard('gold', true, 2, 2);

    expect(ok).toBe(true);
    expect(c.storage['gold_i']).toBe(1);
  });

  /* ---- ケース4: チェストが満杯なら格納せず false を返す(破棄扱い) ---- */
  it('最寄りチェストが満杯の場合は格納せずfalseを返す(破棄)', () => {
    const full = chest(1, 1, { storage: { iron_o: 300 }, cap: 300 });
    state.machines.set('1,1', full);

    const ok = depositIntoNearestChestOrDiscard('coal', false, 1, 1);

    expect(ok).toBe(false);
    expect(full.storage['coal_o']).toBeUndefined();
    expect(full.storage['iron_o']).toBe(300); // 既存在庫は変化しない
  });

  /* ---- 補助: 同一種の在庫は加算される ---- */
  it('同一種のアイテムを複数回格納すると加算される', () => {
    const c = chest(0, 0);
    state.machines.set('0,0', c);

    depositIntoNearestChestOrDiscard('copper', false, 0, 0);
    depositIntoNearestChestOrDiscard('copper', false, 0, 0);
    depositIntoNearestChestOrDiscard('copper', false, 0, 0);

    expect(c.storage['copper_o']).toBe(3);
  });
});
