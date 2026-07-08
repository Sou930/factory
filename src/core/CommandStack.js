/* =====================================================================
   TerraForge — アンドゥ/リドゥ コマンドスタック (Phase10)
   ---------------------------------------------------------------------
   ユーザー操作(設置・撤去・掘削・盛土・回転・移動)をコマンドパターンで
   ラップし、直近30操作までのアンドゥ/リドゥを提供する。

   設計方針:
   - do()/undo() は state/mesh の変更のみを担当し、sfx()/toast() を直接
     呼ばない(二重演出防止)。効果音・トーストは CommandStack 側が
     execute/undo/redo の結果として一括で鳴らす。
   - 「稼働中で安全にアンドゥできない」場合は undo をスキップし、
     スタックにコマンドを残したまま(=そのコマンドは消費しない)
     'blocked' を返す。呼び出し側(CommandStack.undo)がトーストを出す。
   - セーブデータにはコマンド履歴を含めない(リロードでクリアされる)。
   ===================================================================== */
import { state, gameState } from '../state.js';
import { ORES } from '../constants.js';
import { key, refreshTile } from '../world.js';
import { ctx } from '../ctx.js';
import { bus } from './EventBus.js';
import { Events } from './events.js';

/* ---------------- コマンド基底クラス ---------------- */
export class Command {
  /** @returns {boolean} 実行できたか */
  do(ctx) { return true; }
  /**
   * @returns {'ok'|'blocked'} 'blocked' の場合はスタックから消費されない
   */
  undo(ctx) { return 'ok'; }
  /** redo は do() と同じ処理を再実行する(既定実装) */
  redo(ctx) { return this.do(ctx); }
  /** UI演出用: このコマンドが対象とするグリッド座標(存在すれば) */
  get pos() { return null; }
}

/* ---------------- 機械設置 ---------------- */
export class PlaceMachineCmd extends Command {
  constructor(type, gx, gz, dir) {
    super();
    this.type = type; this.gx = gx; this.gz = gz; this.dir = dir;
  }
  get pos() { return { gx: this.gx, gz: this.gz }; }
  do(c) {
    return c.placeMachine(this.type, this.gx, this.gz, this.dir, false, false, true);
  }
  undo(c) {
    const m = state.machines.get(key(this.gx, this.gz));
    if (!m) return 'ok'; // 既に他の操作で消えている
    if (isMachineBusy(m)) return 'blocked';
    const def = c.MACHINE_DEFS ? c.MACHINE_DEFS[m.type] : undefined;
    const cost = c.COSTS ? (c.COSTS[m.type] || 0) : 0;
    c.removeMachineNoRefund(this.gx, this.gz);
    gameState.addMoney(cost); // 支払った全額を返す(アンドゥなので撤去返金率は適用しない)
    return 'ok';
  }
  redo(c) { return this.do(c); }
}

/* ---------------- 機械撤去 ---------------- */
export class RemoveMachineCmd extends Command {
  constructor(gx, gz) {
    super();
    this.gx = gx; this.gz = gz;
    this.snapshot = null; // do() 実行時に取得
    this.refund = 0;
  }
  get pos() { return { gx: this.gx, gz: this.gz }; }
  do(c) {
    const m = state.machines.get(key(this.gx, this.gz));
    if (!m) return false;
    // 撤去前に完全スナップショットを保持(undo で復元するため)
    this.snapshot = {
      type: m.type, dir: m.dir, filter: m.filter,
      storage: { ...(m.storage || {}) },
      buffer: (m.buffer || []).map(b => ({ ...b })),
      craftStock: { ...(m.craftStock || {}) },
      selectedRecipeId: m.selectedRecipeId,
      processing: m.processing ? { ...m.processing } : null,
      cap: m.cap,
    };
    const before = state.money;
    const ok = c.removeMachine(this.gx, this.gz, true);
    if (!ok) { this.snapshot = null; return false; }
    this.refund = state.money - before;
    return true;
  }
  undo(c) {
    if (!this.snapshot) return 'ok';
    if (state.machines.has(key(this.gx, this.gz))) return 'blocked'; // 既に何かが置かれている
    const s = this.snapshot;
    const placed = c.placeMachine(s.type, this.gx, this.gz, s.dir, true, true, true); // silent: コスト無課金
    if (!placed) return 'blocked';
    const m = state.machines.get(key(this.gx, this.gz));
    if (m) {
      m.filter = s.filter;
      m.storage = { ...s.storage };
      m.buffer = s.buffer.map(b => ({ ...b }));
      m.craftStock = { ...s.craftStock };
      m.selectedRecipeId = s.selectedRecipeId;
      m.processing = s.processing ? { ...s.processing } : null;
      m.cap = s.cap;
      refreshTile(this.gx, this.gz);
    }
    gameState.addMoney(-this.refund); // 撤去時に受け取った返金を差し引く
    return 'ok';
  }
  redo(c) {
    if (state.machines.has(key(this.gx, this.gz))) return c.removeMachine(this.gx, this.gz, true);
    return false;
  }
}

/* ---------------- 掘削 ---------------- */
export class DigCmd extends Command {
  constructor(gx, gz) {
    super();
    this.gx = gx; this.gz = gz;
    this.prevDepth = null;
  }
  get pos() { return { gx: this.gx, gz: this.gz }; }
  do(c) {
    const t = state.tiles[this.gx][this.gz];
    this.prevDepth = t.depth;
    t.depth++;
    refreshTile(this.gx, this.gz);
    c.rebuildBeltsAround(this.gx, this.gz);
    return true;
  }
  undo(c) {
    if (state.machines.has(key(this.gx, this.gz))) return 'blocked'; // このマスに機械が置かれていたら不可
    if (this.prevDepth === null) return 'ok';
    state.tiles[this.gx][this.gz].depth = this.prevDepth;
    refreshTile(this.gx, this.gz);
    c.rebuildBeltsAround(this.gx, this.gz);
    return 'ok';
  }
  redo(c) {
    if (state.machines.has(key(this.gx, this.gz))) return false;
    const t = state.tiles[this.gx][this.gz];
    t.depth++;
    refreshTile(this.gx, this.gz);
    c.rebuildBeltsAround(this.gx, this.gz);
    return true;
  }
}

/* ---------------- 盛土 ---------------- */
export class FillCmd extends Command {
  constructor(gx, gz) {
    super();
    this.gx = gx; this.gz = gz;
    this.prevDepth = null;
  }
  get pos() { return { gx: this.gx, gz: this.gz }; }
  do(c) {
    const t = state.tiles[this.gx][this.gz];
    this.prevDepth = t.depth;
    t.depth--;
    refreshTile(this.gx, this.gz);
    c.rebuildBeltsAround(this.gx, this.gz);
    return true;
  }
  undo(c) {
    if (state.machines.has(key(this.gx, this.gz))) return 'blocked';
    if (this.prevDepth === null) return 'ok';
    state.tiles[this.gx][this.gz].depth = this.prevDepth;
    refreshTile(this.gx, this.gz);
    c.rebuildBeltsAround(this.gx, this.gz);
    return 'ok';
  }
  redo(c) {
    if (state.machines.has(key(this.gx, this.gz))) return false;
    const t = state.tiles[this.gx][this.gz];
    t.depth--;
    refreshTile(this.gx, this.gz);
    c.rebuildBeltsAround(this.gx, this.gz);
    return true;
  }
}

/* ---------------- 内部用: 直前マスの向き強制設定(ドラッグ設置中のコンベア自動整列) ----------------
   BuildDragSession が「一筆書き」の流れを揃えるために直前マスの向きを書き換える際に使う。
   RotateCmd と異なり、+1ではなく特定の向きへ直接設定する(do/undo/redoとも同じ setDir を使う)。 */
export class SetDirCmd extends Command {
  constructor(gx, gz, fromDir, toDir) {
    super();
    this.gx = gx; this.gz = gz; this.fromDir = fromDir; this.toDir = toDir;
  }
  get pos() { return { gx: this.gx, gz: this.gz }; }
  _apply(c, dir) {
    const m = state.machines.get(key(this.gx, this.gz));
    if (!m) return false;
    m.dir = dir;
    m.mesh.rotation.y = -dir * Math.PI / 2;
    c.rebuildBeltsAround(this.gx, this.gz);
    return true;
  }
  do(c) { return this._apply(c, this.toDir); }
  undo(c) {
    const m = state.machines.get(key(this.gx, this.gz));
    if (!m) return 'ok';
    this._apply(c, this.fromDir);
    return 'ok';
  }
  redo(c) { return this._apply(c, this.toDir); }
}

/* ---------------- 回転 ---------------- */
export class RotateCmd extends Command {
  constructor(gx, gz) {
    super();
    this.gx = gx; this.gz = gz;
    this.prevDir = null;
  }
  get pos() { return { gx: this.gx, gz: this.gz }; }
  _setDir(c, m, dir) {
    m.dir = dir;
    m.mesh.rotation.y = -dir * Math.PI / 2;
    if (m.type === 'conveyor' || m.type === 'fastConveyor' || m.type === 'filterConveyor') c.tryAutoConnectNeighbors(m.gx, m.gz);
    c.rebuildBeltsAround(m.gx, m.gz);
  }
  do(c) {
    const m = state.machines.get(key(this.gx, this.gz));
    if (!m) return false;
    this.prevDir = m.dir;
    this._setDir(c, m, (m.dir + 1) % 4);
    return true;
  }
  undo(c) {
    const m = state.machines.get(key(this.gx, this.gz));
    if (!m) return 'ok';
    if (this.prevDir === null) return 'ok';
    this._setDir(c, m, this.prevDir);
    return 'ok';
  }
  redo(c) {
    const m = state.machines.get(key(this.gx, this.gz));
    if (!m) return false;
    this.prevDir = m.dir;
    this._setDir(c, m, (m.dir + 1) % 4);
    return true;
  }
}

/* ---------------- 移動 ---------------- */
export class MoveCmd extends Command {
  constructor(fromGx, fromGz, toGx, toGz) {
    super();
    this.fromGx = fromGx; this.fromGz = fromGz;
    this.toGx = toGx; this.toGz = toGz;
    this._curGx = toGx; this._curGz = toGz; // do() 実行後の現在位置(演出用)
  }
  get pos() { return { gx: this._curGx, gz: this._curGz }; }
  _relocate(c, gx, gz, ngx, ngz) {
    const m = state.machines.get(key(gx, gz));
    if (!m) return false;
    if (state.machines.has(key(ngx, ngz))) return false;
    state.machines.delete(key(gx, gz));
    m.gx = ngx; m.gz = ngz;
    m.mesh.position.set(c.worldX(ngx), c.tileTopY(ngx, ngz) + c.yJitter(ngx, ngz), c.worldZ(ngz));
    state.machines.set(key(ngx, ngz), m);
    refreshTile(gx, gz); refreshTile(ngx, ngz);
    c.rebuildBeltsAround(gx, gz); c.rebuildBeltsAround(ngx, ngz);
    return true;
  }
  do(c) {
    return this._relocate(c, this.fromGx, this.fromGz, this.toGx, this.toGz);
  }
  undo(c) {
    const m = state.machines.get(key(this.toGx, this.toGz));
    if (!m) return 'ok'; // 既に消えている
    if (isMachineBusy(m)) return 'blocked';
    if (state.machines.has(key(this.fromGx, this.fromGz))) return 'blocked'; // 元の場所が塞がっている
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

/* ---------------- バッチ(ドラッグ設置1回分) ---------------- */
export class BatchCmd extends Command {
  constructor(cmds) {
    super();
    this.cmds = cmds || [];
  }
  get pos() {
    const last = this.cmds[this.cmds.length - 1];
    return last ? last.pos : null;
  }
  do() { return true; } // BatchCmd 自体は個々のコマンドが既に do() 済みの前提でスタックに積まれる
  undo(c) {
    // 逆順にundo。途中でblockedが出たら、そこで打ち切り、実行済み分は残しておく
    // (Batch全体を「消費済み/未消費」で扱うため、一部だけundoされた状態は許容しない設計とし、
    //  1つでもblockedが出たらそこまでのundoを元に戻さず、Batch全体を再スタックに戻す)
    const undone = [];
    for (let i = this.cmds.length - 1; i >= 0; i--) {
      const result = this.cmds[i].undo(c);
      if (result === 'blocked') {
        // ここまでundoした分をやり直す(redo)。整合性維持のため。
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

/* ---------------- 稼働中判定(アンドゥ不能条件) ---------------- */
function isMachineBusy(m) {
  return !!(m.item || m.incoming > 0 || m.processing);
}

/* ---------------- コマンドスタック本体 ---------------- */
export class CommandStack {
  constructor(deps) {
    // deps: { placeMachine, removeMachine, removeMachineNoRefund, rebuildBeltsAround,
    //         tryAutoConnectNeighbors, worldX, worldZ, tileTopY, yJitter, COSTS, MACHINE_DEFS,
    //         sfx, toast, spawnFloater }
    this.ctx = deps;
    this.limit = 30;
    this._undoStack = [];
    this._redoStack = [];
  }

  get canUndo() { return this._undoStack.length > 0; }
  get canRedo() { return this._redoStack.length > 0; }

  _emitChanged() {
    bus.emit(Events.HISTORY_CHANGED, { canUndo: this.canUndo, canRedo: this.canRedo });
  }

  /**
   * コマンドを実行してスタックに積む。
   * @param {Command} cmd
   * @returns {boolean} 実行できたか
   */
  execute(cmd) {
    const ok = cmd.do(this.ctx);
    if (!ok) return false;
    this._undoStack.push(cmd);
    if (this._undoStack.length > this.limit) this._undoStack.shift();
    this._redoStack = []; // 新規操作でredo履歴は破棄
    this._emitChanged();
    return true;
  }

  /**
   * 既に実行済みのコマンド(BuildDragSession が個々に do() 済みのもの)を
   * 履歴にのみ積む場合に使う。BatchCmd 用。
   */
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
    if (this.ctx.sfx) this.ctx.sfx('rotate'); // アンドゥ演出はrotate効果音を流用
    this._spawnUndoRedoFloater(cmd, '↩️');
    this._emitChanged();
    return true;
  }

  redo() {
    const cmd = this._redoStack.pop();
    if (!cmd) return false;
    const ok = cmd.redo(this.ctx);
    if (!ok) {
      // redo できなかった場合はredoスタックへ戻さず捨てる(整合性優先)
      this._emitChanged();
      return false;
    }
    this._undoStack.push(cmd);
    if (this._undoStack.length > this.limit) this._undoStack.shift();
    if (this.ctx.sfx) this.ctx.sfx('rotate');
    this._spawnUndoRedoFloater(cmd, '↪️');
    this._emitChanged();
    return true;
  }

  /** アンドゥ/リドゥ対象位置にフローティングテキストを表示する(演出用、失敗しても無視) */
  _spawnUndoRedoFloater(cmd, text) {
    const c = this.ctx;
    if (!c.spawnFloater || !c.worldX || !c.worldZ || !c.tileTopY) return;
    const p = cmd.pos;
    if (!p) return;
    try {
      const pos = new THREE.Vector3(c.worldX(p.gx), c.tileTopY(p.gx, p.gz) + 1.3, c.worldZ(p.gz));
      c.spawnFloater(text, pos, '#7de8ff');
    } catch (e) { /* THREE 未ロード環境(テスト等)では無視 */ }
  }

  /** テスト/デバッグ用: 履歴を全クリア(セーブロード時などに使用) */
  clear() {
    this._undoStack = [];
    this._redoStack = [];
    this._emitChanged();
  }
}

/* シングルトン: main.js で ctx が埋まった後に initCommandStack() で生成される */
export let commandStack = null;
export function initCommandStack(deps) {
  commandStack = new CommandStack(deps);
  return commandStack;
}
