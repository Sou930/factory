/* =====================================================================
   TerraForge — ドリル「露出鉱石なし」時の自然停止 ユニットテスト (Phase06)
   ---------------------------------------------------------------------
   Phase06 セーブv8仕様の要求4:
   「ロード時の placeMachine(silent) 後に、ドリルについて『露出鉱石がない』
   場合でも設置は維持するが、update 側で自然に停止することをテストで
   保証する(現行挙動の明文化)」

   MACHINE_DEFS.drill.update() は hasOre が false の場合、アイテムを
   一切生成せず m.timer も進めない(=完全に静止する)。これを直接検証する。
   ===================================================================== */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/* render/scene.js はDOM/Canvas2Dの重い副作用(WebGLRenderer, キャンバスグラデーション等)を
   トップレベルで実行するため、drillロジックのテストには不要な依存としてモックする。
   machineDefs.js の drill.update() は scene/camera を直接使わないため、
   これらの空モックで十分に動作する。 */
vi.mock('../src/render/scene.js', () => ({
  scene: { add: () => {}, remove: () => {} },
  camera: {},
  cam: { yaw: 0, pitch: 0, dist: 40, yawT: 0, pitchT: 0, distT: 40, target: { x: 0, y: 0, z: 0 } },
  renderer: { render: () => {} },
  updateCamera: () => {},
  onResize: () => {},
  updateAdaptiveQuality: () => {},
}));
vi.mock('../src/render/meshes.js', () => ({
  MESH_BUILDERS: {},
  updateFilterGem: () => {},
  applyFastConveyorTint: () => {},
  buildConveyorMeshShaped: () => ({}),
  buildFilterConveyorMeshShaped: () => ({}),
  sharedMat: () => ({}),
  enhanceMaterial: (m) => m,
  BELT_ARM: 0.5, BELT_W: 0.5,
}));
vi.mock('../src/world.js', () => ({
  worldX: () => 0, worldZ: () => 0, tileTopY: () => 0, yJitter: () => 0,
  inGrid: (gx, gz) => gx >= 0 && gz >= 0 && gx < 96 && gz < 96,
  key: (gx, gz) => gx + ',' + gz,
  refreshTile: () => {},
  createWorld: () => {},
  mulberry32: () => () => 0.5,
}));

/* THREE はもう scene.js/world.js の重い初期化には使われないが、
   Vector3 のみ machineDefs.js の spawnItem/spawnParticle 呼び出しで参照される可能性があるため
   軽量モックを残す */
vi.stubGlobal('THREE', {
  Vector3: class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    clone() { return new THREE.Vector3(this.x, this.y, this.z); }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    addScaledVector() { return this; }
  },
});

describe('Drill natural stop (no exposed ore)', () => {
  let MACHINE_DEFS, state, ctx, powerGrid;

  beforeEach(async () => {
    vi.resetModules();
    ({ state } = await import('../src/state.js'));
    ({ ctx } = await import('../src/ctx.js'));
    ({ powerGrid } = await import('../src/power.js'));
    ({ MACHINE_DEFS } = await import('../src/machineDefs.js'));

    // ctx に update() が参照するヘルパーをダミー注入
    Object.assign(ctx, {
      worldX: () => 0, worldZ: () => 0, tileTopY: () => 0,
      key: (x, z) => x + ',' + z,
      canAccept: () => false, // 出力先なし: アイテム生成には至らせない
      sendItemTo: () => {}, spawnItem: () => ({ pos: { y: 0 } }),
      spawnParticle: () => {},
    });

    state.tiles = [[{ depth: 1, elev: 0, ore: { type: 'iron' } }]]; // iron.depth===1 で露出状態
    state.machines = new Map();
    state.time = 0;
  });

  /* ---- ケース1: 露出鉱石がある場合は timer が進行する(対照群) ---- */
  it('露出鉱石がある場合、timerが進行しアイテム生成を試みる', () => {
    const m = {
      type: 'drill', gx: 0, gz: 0, dir: 0, timer: 0,
      mesh: { userData: {}, getObjectByName: () => null },
    };
    state.machines.set('0,0', m);
    powerGrid.rebuild(state.machines.values());
    // 発電機が無いと isPowered=false になり何もしないため、電力チェックを迂回してテスト
    vi.spyOn(powerGrid, 'isPowered').mockReturnValue(true);

    MACHINE_DEFS.drill.update(m, 1.0);

    expect(m.timer).toBeGreaterThan(0);
  });

  /* ---- ケース2(本題): 露出鉱石が無くなった場合、設置は維持されるがupdateで自然停止する ---- */
  it('露出鉱石が無い場合、設置(machinesエントリ)は維持されたままtimerが進まず停止する', () => {
    // 掘削が深さを追い越した/鉱脈が尽きた状態を模す(depth !== ORES[type].depth)
    state.tiles[0][0] = { depth: 3, elev: 0, ore: { type: 'iron' } }; // iron.depth=1 なので露出していない

    const m = {
      type: 'drill', gx: 0, gz: 0, dir: 0, timer: 0,
      mesh: { userData: {}, getObjectByName: () => null },
    };
    // ロード時と同様、露出チェックをスキップして設置は維持される(placeMachine の silent 挙動を模す)
    state.machines.set('0,0', m);
    expect(state.machines.has('0,0')).toBe(true); // 設置は維持

    vi.spyOn(powerGrid, 'isPowered').mockReturnValue(true);
    MACHINE_DEFS.drill.update(m, 1.0);

    // 自然停止: timer は進まず、機械自体は撤去されない
    expect(m.timer).toBe(0);
    expect(state.machines.has('0,0')).toBe(true);

    // 複数フレーム経過させても変化しない(完全に静止する)
    MACHINE_DEFS.drill.update(m, 1.0);
    MACHINE_DEFS.drill.update(m, 1.0);
    expect(m.timer).toBe(0);
  });

  /* ---- ケース3: drill2 でも同様に自然停止する ---- */
  it('drill2でも露出鉱石が無い場合は自然停止する', () => {
    state.tiles[0][0] = { depth: 3, elev: 0, ore: { type: 'iron' } };
    const m = {
      type: 'drill2', gx: 0, gz: 0, dir: 0, timer: 0,
      mesh: { userData: {}, getObjectByName: () => null },
    };
    state.machines.set('0,0', m);
    vi.spyOn(powerGrid, 'isPowered').mockReturnValue(true);

    MACHINE_DEFS.drill2.update(m, 1.0);

    expect(m.timer).toBe(0);
    expect(state.machines.has('0,0')).toBe(true);
  });

  /* ---- ケース4: 電力が無い場合も(鉱石の有無に関わらず)静かに停止し例外を投げない ---- */
  it('電力が無い場合はwarnLight処理のみでエラーを投げず停止する', () => {
    const m = {
      type: 'drill', gx: 0, gz: 0, dir: 0, timer: 0,
      mesh: { userData: {}, getObjectByName: () => null },
    };
    state.machines.set('0,0', m);
    vi.spyOn(powerGrid, 'isPowered').mockReturnValue(false);

    expect(() => MACHINE_DEFS.drill.update(m, 1.0)).not.toThrow();
    expect(m.timer).toBe(0);
  });
});
