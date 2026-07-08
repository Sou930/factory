/* =====================================================================
   TerraForge — Phase10: アンドゥ/リドゥ CommandStack ユニットテスト
   ---------------------------------------------------------------------
   src/core/CommandStack.js は world.js(→ render/scene.js → THREE.WebGLRenderer /
   document.getElementById('game-canvas'))を経由して読み込まれるため、他の
   ユニットテスト(tests/buildDrag.test.js, tests/logistics.test.js 等)と同様に、
   実際の描画チェーンを経由しない「純粋ロジックの再現」としてテストする。
   コマンドパターンの分岐・スタック管理は src/core/CommandStack.js の実装を
   忠実に再現している(do/undo/redo の戻り値・blocked条件・10件制限・
   redoスタッククリア・BatchCmdの逆順undoロジックまで一致させる)。
   GameState / EventBus / Events は実物をそのまま使う(render依存が無いため)。
   ===================================================================== */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { GameState } from '../src/core/GameState.js';
import { EventBus } from '../src/core/EventBus.js';
import { Events } from '../src/core/events.js';

beforeAll(() => {
  global.THREE = global.THREE || {
    Object3D: class { constructor() { this.position = { x: 0, y: 0, z: 0 }; this.rotation = { y: 0 }; this.children = []; } clone() { return new THREE.Object3D(); } },
    Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } clone() { return new THREE.Vector3(this.x, this.y, this.z); } addScaledVector() {} },
  };
});

/* =====================================================================
   テスト用の軽量ワールド + machines 層(src/machines.js / src/world.js の
   ロジックを、描画を除いて忠実に再現)
   ===================================================================== */
const COSTS = { conveyor: 10, fastConveyor: 25, drill: 50, chest: 60 };
const MACHINE_DEFS = {
  conveyor: { refundRate: 0.9 },
  fastConveyor: { refundRate: 0.9 },
  drill: { refundRate: 0.5 },
  chest: { refundRate: 0.5 },
};

function key(gx, gz) { return gx + ',' + gz; }

function makeWorld(gameState) {
  const state = { tiles: [], machines: new Map() };
  for (let x = 0; x < 10; x++) {
    state.tiles[x] = [];
    for (let z = 0; z < 10; z++) state.tiles[x][z] = { depth: 0, ore: null };
  }

  const rebuildCalls = [];
  function rebuildBeltsAround(gx, gz) { rebuildCalls.push(key(gx, gz)); }
  function tryAutoConnectNeighbors() {}
  function worldX(gx) { return gx; }
  function worldZ(gz) { return gz; }
  function tileTopY() { return 0; }
  function yJitter() { return 0; }

  function placeMachine(type, gx, gz, dir, silent, forceDir, quiet) {
    if (state.machines.has(key(gx, gz))) return false;
    if (!silent) {
      if (gameState.money < COSTS[type]) return false;
      gameState.addMoney(-COSTS[type]);
    }
    const m = {
      type, gx, gz, dir, mesh: new THREE.Object3D(),
      item: null, buffer: [], processing: null, incoming: 0,
      storage: {}, cap: 300, filter: undefined, craftStock: {}, selectedRecipeId: 'auto',
    };
    state.machines.set(key(gx, gz), m);
    rebuildBeltsAround(gx, gz);
    return true;
  }

  function removeMachine(gx, gz, quiet) {
    const m = state.machines.get(key(gx, gz));
    if (!m) return false;
    state.machines.delete(key(gx, gz));
    const def = MACHINE_DEFS[m.type];
    const refundRate = def && def.refundRate !== undefined ? def.refundRate : 0.5;
    const refund = Math.floor((COSTS[m.type] || 0) * refundRate);
    gameState.addMoney(refund);
    rebuildBeltsAround(gx, gz);
    return true;
  }

  function removeMachineNoRefund(gx, gz) {
    const m = state.machines.get(key(gx, gz));
    if (!m) return false;
    state.machines.delete(key(gx, gz));
    rebuildBeltsAround(gx, gz);
    return true;
  }

  const ctx = {
    placeMachine, removeMachine, removeMachineNoRefund, rebuildBeltsAround,
    tryAutoConnectNeighbors, worldX, worldZ, tileTopY, yJitter,
    COSTS, MACHINE_DEFS,
    sfx: () => {}, toast: () => {}, spawnFloater: () => {},
  };

  return { state, ctx, rebuildCalls };
}

/* =====================================================================
   src/core/CommandStack.js の実装を忠実に再現(描画非依存のロジックのみ)
   ===================================================================== */
function isMachineBusy(m) { return !!(m.item || m.incoming > 0 || m.processing); }

class Command {
  do() { return true; }
  undo() { return 'ok'; }
  redo(c) { return this.do(c); }
  get pos() { return null; }
}

function makeCommandClasses(state, gameStateRef, keyFn, refreshTile) {
  class PlaceMachineCmd extends Command {
    constructor(type, gx, gz, dir) { super(); this.type = type; this.gx = gx; this.gz = gz; this.dir = dir; }
    get pos() { return { gx: this.gx, gz: this.gz }; }
    do(c) { return c.placeMachine(this.type, this.gx, this.gz, this.dir, false, false, true); }
    undo(c) {
      const m = state.machines.get(keyFn(this.gx, this.gz));
      if (!m) return 'ok';
      if (isMachineBusy(m)) return 'blocked';
      const cost = c.COSTS ? (c.COSTS[m.type] || 0) : 0;
      c.removeMachineNoRefund(this.gx, this.gz);
      gameStateRef.addMoney(cost);
      return 'ok';
    }
    redo(c) { return this.do(c); }
  }

  class RemoveMachineCmd extends Command {
    constructor(gx, gz) { super(); this.gx = gx; this.gz = gz; this.snapshot = null; this.refund = 0; }
    get pos() { return { gx: this.gx, gz: this.gz }; }
    do(c) {
      const m = state.machines.get(keyFn(this.gx, this.gz));
      if (!m) return false;
      this.snapshot = {
        type: m.type, dir: m.dir, filter: m.filter,
        storage: { ...(m.storage || {}) },
        buffer: (m.buffer || []).map(b => ({ ...b })),
        craftStock: { ...(m.craftStock || {}) },
        selectedRecipeId: m.selectedRecipeId,
        processing: m.processing ? { ...m.processing } : null,
        cap: m.cap,
      };
      const before = gameStateRef.money;
      const ok = c.removeMachine(this.gx, this.gz, true);
      if (!ok) { this.snapshot = null; return false; }
      this.refund = gameStateRef.money - before;
      return true;
    }
    undo(c) {
      if (!this.snapshot) return 'ok';
      if (state.machines.has(keyFn(this.gx, this.gz))) return 'blocked';
      const s = this.snapshot;
      const placed = c.placeMachine(s.type, this.gx, this.gz, s.dir, true, true, true);
      if (!placed) return 'blocked';
      const m = state.machines.get(keyFn(this.gx, this.gz));
      if (m) {
        m.filter = s.filter;
        m.storage = { ...s.storage };
        m.buffer = s.buffer.map(b => ({ ...b }));
        m.craftStock = { ...s.craftStock };
        m.selectedRecipeId = s.selectedRecipeId;
        m.processing = s.processing ? { ...s.processing } : null;
        m.cap = s.cap;
      }
      gameStateRef.addMoney(-this.refund);
      return 'ok';
    }
    redo(c) {
      if (state.machines.has(keyFn(this.gx, this.gz))) return c.removeMachine(this.gx, this.gz, true);
      return false;
    }
  }

  class DigCmd extends Command {
    constructor(gx, gz) { super(); this.gx = gx; this.gz = gz; this.prevDepth = null; }
    get pos() { return { gx: this.gx, gz: this.gz }; }
    do(c) {
      const t = state.tiles[this.gx][this.gz];
      this.prevDepth = t.depth;
      t.depth++;
      c.rebuildBeltsAround(this.gx, this.gz);
      return true;
    }
    undo(c) {
      if (state.machines.has(keyFn(this.gx, this.gz))) return 'blocked';
      if (this.prevDepth === null) return 'ok';
      state.tiles[this.gx][this.gz].depth = this.prevDepth;
      c.rebuildBeltsAround(this.gx, this.gz);
      return 'ok';
    }
    redo(c) {
      if (state.machines.has(keyFn(this.gx, this.gz))) return false;
      state.tiles[this.gx][this.gz].depth++;
      c.rebuildBeltsAround(this.gx, this.gz);
      return true;
    }
  }

  class FillCmd extends Command {
    constructor(gx, gz) { super(); this.gx = gx; this.gz = gz; this.prevDepth = null; }
    get pos() { return { gx: this.gx, gz: this.gz }; }
    do(c) {
      const t = state.tiles[this.gx][this.gz];
      this.prevDepth = t.depth;
      t.depth--;
      c.rebuildBeltsAround(this.gx, this.gz);
      return true;
    }
    undo(c) {
      if (state.machines.has(keyFn(this.gx, this.gz))) return 'blocked';
      if (this.prevDepth === null) return 'ok';
      state.tiles[this.gx][this.gz].depth = this.prevDepth;
      c.rebuildBeltsAround(this.gx, this.gz);
      return 'ok';
    }
    redo(c) {
      if (state.machines.has(keyFn(this.gx, this.gz))) return false;
      state.tiles[this.gx][this.gz].depth--;
      c.rebuildBeltsAround(this.gx, this.gz);
      return true;
    }
  }

  class RotateCmd extends Command {
    constructor(gx, gz) { super(); this.gx = gx; this.gz = gz; this.prevDir = null; }
    get pos() { return { gx: this.gx, gz: this.gz }; }
    do(c) {
      const m = state.machines.get(keyFn(this.gx, this.gz));
      if (!m) return false;
      this.prevDir = m.dir;
      m.dir = (m.dir + 1) % 4;
      c.rebuildBeltsAround(this.gx, this.gz);
      return true;
    }
    undo(c) {
      const m = state.machines.get(keyFn(this.gx, this.gz));
      if (!m) return 'ok';
      if (this.prevDir === null) return 'ok';
      m.dir = this.prevDir;
      c.rebuildBeltsAround(this.gx, this.gz);
      return 'ok';
    }
    redo(c) {
      const m = state.machines.get(keyFn(this.gx, this.gz));
      if (!m) return false;
      this.prevDir = m.dir;
      m.dir = (m.dir + 1) % 4;
      c.rebuildBeltsAround(this.gx, this.gz);
      return true;
    }
  }

  class MoveCmd extends Command {
    constructor(fromGx, fromGz, toGx, toGz) {
      super();
      this.fromGx = fromGx; this.fromGz = fromGz; this.toGx = toGx; this.toGz = toGz;
      this._curGx = toGx; this._curGz = toGz;
    }
    get pos() { return { gx: this._curGx, gz: this._curGz }; }
    _relocate(c, gx, gz, ngx, ngz) {
      const m = state.machines.get(keyFn(gx, gz));
      if (!m) return false;
      if (state.machines.has(keyFn(ngx, ngz))) return false;
      state.machines.delete(keyFn(gx, gz));
      m.gx = ngx; m.gz = ngz;
      state.machines.set(keyFn(ngx, ngz), m);
      c.rebuildBeltsAround(gx, gz); c.rebuildBeltsAround(ngx, ngz);
      return true;
    }
    do(c) { return this._relocate(c, this.fromGx, this.fromGz, this.toGx, this.toGz); }
    undo(c) {
      const m = state.machines.get(keyFn(this.toGx, this.toGz));
      if (!m) return 'ok';
      if (isMachineBusy(m)) return 'blocked';
      if (state.machines.has(keyFn(this.fromGx, this.fromGz))) return 'blocked';
      this._relocate(c, this.toGx, this.toGz, this.fromGx, this.fromGz);
      this._curGx = this.fromGx; this._curGz = this.fromGz;
      return 'ok';
    }
    redo(c) {
      const ok = this._relocate(c, this.fromGx, this.fromGz, this.toGx, this.toGz);
      if (ok) { this._curGx = this.toGx; this._curGz = this.toGz; }
      return ok;
    }
  }

  class BatchCmd extends Command {
    constructor(cmds) { super(); this.cmds = cmds || []; }
    get pos() { const last = this.cmds[this.cmds.length - 1]; return last ? last.pos : null; }
    do() { return true; }
    undo(c) {
      const undone = [];
      for (let i = this.cmds.length - 1; i >= 0; i--) {
        const result = this.cmds[i].undo(c);
        if (result === 'blocked') {
          for (const uc of undone) uc.redo(c);
          return 'blocked';
        }
        undone.push(this.cmds[i]);
      }
      return 'ok';
    }
    redo(c) {
      for (const cmd of this.cmds) cmd.redo(c);
      return true;
    }
  }

  return { PlaceMachineCmd, RemoveMachineCmd, DigCmd, FillCmd, RotateCmd, MoveCmd, BatchCmd };
}

class CommandStack {
  constructor(deps, bus, Events) {
    this.ctx = deps;
    this.bus = bus;
    this.Events = Events;
    this.limit = 10;
    this._undoStack = [];
    this._redoStack = [];
  }
  get canUndo() { return this._undoStack.length > 0; }
  get canRedo() { return this._redoStack.length > 0; }
  _emitChanged() { this.bus.emit(this.Events.HISTORY_CHANGED, { canUndo: this.canUndo, canRedo: this.canRedo }); }
  execute(cmd) {
    const ok = cmd.do(this.ctx);
    if (!ok) return false;
    this._undoStack.push(cmd);
    if (this._undoStack.length > this.limit) this._undoStack.shift();
    this._redoStack = [];
    this._emitChanged();
    return true;
  }
  push(cmd) {
    this._undoStack.push(cmd);
    if (this._undoStack.length > this.limit) this._undoStack.shift();
    this._redoStack = [];
    this._emitChanged();
  }
  undo() {
    const cmd = this._undoStack[this._undoStack.length - 1];
    if (!cmd) return false;
    const result = cmd.undo(this.ctx);
    if (result === 'blocked') {
      if (this.ctx.toast) this.ctx.toast('稼働中のためアンドゥできません', 'error');
      return false;
    }
    this._undoStack.pop();
    this._redoStack.push(cmd);
    this._emitChanged();
    return true;
  }
  redo() {
    const cmd = this._redoStack.pop();
    if (!cmd) return false;
    const ok = cmd.redo(this.ctx);
    if (!ok) { this._emitChanged(); return false; }
    this._undoStack.push(cmd);
    if (this._undoStack.length > this.limit) this._undoStack.shift();
    this._emitChanged();
    return true;
  }
  clear() { this._undoStack = []; this._redoStack = []; this._emitChanged(); }
}

/* =====================================================================
   テスト本体
   ===================================================================== */
describe('CommandStack (Phase10 アンドゥ/リドゥ)', () => {
  let gameState, bus, world, cmds, stack;

  beforeEach(() => {
    gameState = new GameState();
    bus = new EventBus();
    world = makeWorld(gameState);
    cmds = makeCommandClasses(world.state, gameState, key, null);
    stack = new CommandStack(world.ctx, bus, Events);
  });

  /* ---- ケース(a): place→undoで金額復元 ---- */
  it('(a) PlaceMachineCmd: 設置→アンドゥで所持金が全額復元する', () => {
    const before = gameState.money;
    const ok = stack.execute(new cmds.PlaceMachineCmd('conveyor', 3, 3, 0));
    expect(ok).toBe(true);
    expect(gameState.money).toBe(before - COSTS.conveyor);
    expect(world.state.machines.has(key(3, 3))).toBe(true);

    const undone = stack.undo();
    expect(undone).toBe(true);
    expect(gameState.money).toBe(before); // 全額復元(撤去返金率は適用しない)
    expect(world.state.machines.has(key(3, 3))).toBe(false);
  });

  /* ---- ケース(b): remove→undoでチェスト在庫まで復元 ---- */
  it('(b) RemoveMachineCmd: 撤去→アンドゥでチェストの在庫まで完全復元する', () => {
    stack.execute(new cmds.PlaceMachineCmd('chest', 4, 4, 0));
    const chest = world.state.machines.get(key(4, 4));
    chest.storage = { iron_o: 12, gold_i: 3 };
    chest.buffer = [{ oreType: 'iron', ingot: false }];

    const beforeMoney = gameState.money;
    const removeCmd = new cmds.RemoveMachineCmd(4, 4);
    const removed = stack.execute(removeCmd);
    expect(removed).toBe(true);
    expect(world.state.machines.has(key(4, 4))).toBe(false);
    expect(gameState.money).toBe(beforeMoney + removeCmd.refund);

    const undone = stack.undo();
    expect(undone).toBe(true);
    const restored = world.state.machines.get(key(4, 4));
    expect(restored).toBeTruthy();
    expect(restored.storage).toEqual({ iron_o: 12, gold_i: 3 });
    expect(restored.buffer).toEqual([{ oreType: 'iron', ingot: false }]);
    expect(gameState.money).toBe(beforeMoney); // 返金分を差し引いて元通り
  });

  /* ---- ケース(c): 10件超で古い履歴が消える ---- */
  it('(c) 履歴が10件を超えると、古いコマンドがスタックから消える', () => {
    for (let i = 0; i < 15; i++) {
      const gx = i % 10, gz = Math.floor(i / 10);
      stack.execute(new cmds.DigCmd(gx, gz));
    }
    expect(stack._undoStack.length).toBe(10);
    // 最初の5件(i=0..4)は履歴から消え、アンドゥしても対象マスは変化しない
    // (最も古いコマンドが押し出されているので、10回undoしてもi=5以降のみ戻る)
    let undoCount = 0;
    while (stack.undo()) undoCount++;
    expect(undoCount).toBe(10);
  });

  /* ---- ケース(d): undo後の新規操作でredoが消える ---- */
  it('(d) アンドゥ後に新規操作を実行すると、redo履歴が破棄される', () => {
    stack.execute(new cmds.DigCmd(1, 1));
    stack.execute(new cmds.DigCmd(2, 2));
    stack.undo();
    expect(stack.canRedo).toBe(true);

    stack.execute(new cmds.DigCmd(5, 5)); // 新規操作
    expect(stack.canRedo).toBe(false);
    expect(stack.redo()).toBe(false);
  });

  /* ---- ケース(e): BatchCmdが逆順にundoされる ---- */
  it('(e) BatchCmd: ドラッグ設置1回分がまとめて逆順にアンドゥされる', () => {
    const before = gameState.money;
    const batchCmds = [];
    for (let i = 0; i < 12; i++) {
      const c = new cmds.PlaceMachineCmd('conveyor', i, 0, 0);
      expect(c.do(world.ctx)).toBe(true);
      batchCmds.push(c);
    }
    expect(world.state.machines.size).toBe(12);
    stack.push(new cmds.BatchCmd(batchCmds));

    const undone = stack.undo();
    expect(undone).toBe(true);
    expect(world.state.machines.size).toBe(0); // 12本すべて消える
    expect(gameState.money).toBe(before); // 全額復元(アンドゥなので撤去返金率は適用されない)

    const redone = stack.redo();
    expect(redone).toBe(true);
    expect(world.state.machines.size).toBe(12); // リドゥで12本すべて復活
  });

  /* ---- 補助: 稼働中機械はアンドゥ不能 ---- */
  it('稼働中(item保持中)の機械はアンドゥで安全に拒否される', () => {
    stack.execute(new cmds.PlaceMachineCmd('drill', 6, 6, 0));
    const m = world.state.machines.get(key(6, 6));
    m.item = { fake: true }; // 稼働中を模擬

    const toastCalls = [];
    world.ctx.toast = (msg) => toastCalls.push(msg);

    const result = stack.undo();
    expect(result).toBe(false);
    expect(world.state.machines.has(key(6, 6))).toBe(true); // 消えていない
    expect(toastCalls).toContain('稼働中のためアンドゥできません');
    expect(stack.canUndo).toBe(true); // スタックから消費されていない
  });

  /* ---- 補助: 掘削undoは、そのマスに機械が置かれていたら不可 ---- */
  it('掘削のアンドゥは、後から機械が置かれたマスでは拒否される', () => {
    const digCmd = new cmds.DigCmd(7, 7);
    stack.execute(digCmd);
    expect(world.state.tiles[7][7].depth).toBe(1);
    stack.execute(new cmds.PlaceMachineCmd('conveyor', 7, 7, 0));

    // undoスタックの先頭は PlaceMachineCmd。これをundoせずに、DigCmd自体を
    // 直接呼び出して「そのマスに機械がある間はundo不可」を検証する
    const blockedResult = digCmd.undo(world.ctx);
    expect(blockedResult).toBe('blocked');
    expect(world.state.tiles[7][7].depth).toBe(1); // depthは変化しない

    // 機械を撤去(PlaceMachineCmdをアンドゥ)すれば、DigCmdのundoは通常通り成功する
    stack.undo();
    expect(world.state.machines.has(key(7, 7))).toBe(false);
    const result = stack.undo();
    expect(result).toBe(true);
    expect(world.state.tiles[7][7].depth).toBe(0);
  });

  /* ---- 補助: history:changed イベントが execute/undo/redo で発火する ---- */
  it('execute/undo/redo で history:changed イベントが発火する', () => {
    const calls = [];
    bus.on(Events.HISTORY_CHANGED, (p) => calls.push(p));

    stack.execute(new cmds.DigCmd(0, 0));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ canUndo: true, canRedo: false });

    stack.undo();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ canUndo: false, canRedo: true });

    stack.redo();
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual({ canUndo: true, canRedo: false });
  });

  /* ---- 補助: Ctrl+Z 連打相当(スタック空)でクラッシュしない ---- */
  it('スタックが空の状態でundo/redoを連打してもクラッシュせず false を返す', () => {
    expect(stack.undo()).toBe(false);
    expect(stack.redo()).toBe(false);
    expect(stack.undo()).toBe(false);
  });

  /* ---- 補助: RotateCmdの往復 ---- */
  it('RotateCmd: 回転→アンドゥで元の向きに戻る', () => {
    stack.execute(new cmds.PlaceMachineCmd('conveyor', 2, 2, 0));
    stack.execute(new cmds.RotateCmd(2, 2));
    expect(world.state.machines.get(key(2, 2)).dir).toBe(1);
    stack.undo();
    expect(world.state.machines.get(key(2, 2)).dir).toBe(0);
  });

  /* ---- 補助: MoveCmdの往復と移動先が塞がっている場合のblocked ---- */
  it('MoveCmd: 移動→アンドゥで元の位置に戻り、元位置が塞がっていればblockedになる', () => {
    stack.execute(new cmds.PlaceMachineCmd('drill', 1, 1, 0));
    stack.execute(new cmds.MoveCmd(1, 1, 8, 8));
    expect(world.state.machines.has(key(8, 8))).toBe(true);
    expect(world.state.machines.has(key(1, 1))).toBe(false);

    // 元の位置に別の機械を置いてしまう
    world.ctx.placeMachine('chest', 1, 1, 0, true);

    const result = stack.undo();
    expect(result).toBe(false); // blocked
    expect(world.state.machines.has(key(8, 8))).toBe(true); // 移動先のまま
  });
});
