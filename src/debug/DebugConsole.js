/* =====================================================================
   TerraForge — DebugConsole (Phase08)
   ---------------------------------------------------------------------
   開発/QA用デバッグパネル。URLに ?debug=1 がある時のみ有効化し、画面左下に
   🐞 ボタンを表示、タップでパネル開閉する。

   パネル内容:
     - FPS(fpsEMA)・ドローコール(renderer.info.render.calls)・アイテム数・
       機械数・パーティクル数 のライブ表示(0.5秒間隔更新)
     - ボタン: 「+$10K」「+$1M」「全鉱脈スキャン」「時間+60秒」
              「セーブダンプ」「ベンチ配置」
     - コマンド入力欄: give 10000 / place drill 48 48 / clearmachines / setpower 999

   注意:
     - チートで得た金は earn() ではなく addMoney 直呼びで、マイルストーン実績を
       汚染しない。
     - 「時間+60秒」は dt=1.0 で updateMachines を60回空回しする(クランプ仕様
       (0.05s)を迂回する専用パスは updateMachines 側に足さない)。
     - このモジュールは dynamic import で遅延ロードされるため、?debug=1 無しの
       本番アクセスではバンドルに含まれず、痕跡も残らない。
   ===================================================================== */
import { state, gameState } from '../state.js';
import { GRID, ORES, COSTS } from '../constants.js';
import { placeMachine, removeMachine, updateMachines } from '../machines.js';
import { doScan, clearScan, getParticleCount } from '../particles.js';
import { renderer, getFpsEMA } from '../render/scene.js';
import { key, inGrid } from '../world.js';
import { saveGame } from '../save.js';
import { GAME_VERSION } from '../constants-version.js';
import { powerGrid } from '../power.js';
import { ctx } from '../ctx.js';
import * as ErrorReporter from './ErrorReporter.js';

/** ?debug=1 が付与されているか */
export function isDebugMode() {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get('debug') === '1';
  } catch (e) { return false; }
}

/**
 * コマンド文字列をパースして実行する。純粋な関数としてテスト可能にするため、
 * パーサー自体は parseCommand(str) -> {cmd, args} 形式で分離。
 * @param {string} input
 * @returns {{cmd:string, args:string[]}|null}
 */
export function parseCommand(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  // クォートは未対応(簡易トークナイズ)
  const parts = trimmed.split(/\s+/);
  if (parts.length === 0) return null;
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1) };
}

/**
 * DebugConsole クラス。?debug=1 の時に main.js から動的 import で生成される。
 * 依存は state/gameState/machines/particles/scene/save を直接 import する。
 * テスト時は new せずに parseCommand と execCommand を直接呼べる。
 */
export class DebugConsole {
  constructor() {
    this.panelEl = null;
    this.buttonEl = null;
    this.statsEl = null;
    this.inputEl = null;
    this.errorListEl = null;
    this._statsTimer = null;
    this._errorListVisible = false;
    this._build();
  }

  /* ---------------- 構築 ---------------- */
  _build() {
    // 🐞 ボタン(左下)
    this.buttonEl = document.createElement('button');
    this.buttonEl.id = 'debug-toggle';
    this.buttonEl.type = 'button';
    this.buttonEl.setAttribute('aria-label', 'デバッグパネル');
    this.buttonEl.title = 'デバッグパネル (?debug=1)';
    this.buttonEl.textContent = '\uD83D\uDC1E'; // 🐞
    this.buttonEl.addEventListener('click', () => this.toggle());
    document.body.appendChild(this.buttonEl);

    // パネル本体
    this.panelEl = document.createElement('div');
    this.panelEl.id = 'debug-panel';
    this.panelEl.classList.add('hidden');
    this.panelEl.innerHTML =
      '<div id="debug-header">' +
        '<span>\uD83D\uDC1E Debug Console <small>v' + GAME_VERSION + '</small></span>' +
        '<button id="debug-close" type="button" aria-label="閉じる">\u00D7</button>' +
      '</div>' +
      '<div id="debug-stats"></div>' +
      '<div id="debug-buttons"></div>' +
      '<div id="debug-cmd-row">' +
        '<input id="debug-cmd" type="text" placeholder="give 10000 / place drill 48 48 / clearmachines / setpower 999" spellcheck="false" autocomplete="off">' +
        '<button id="debug-cmd-run" type="button">実行</button>' +
      '</div>' +
      '<div id="debug-error-section">' +
        '<div id="debug-error-header">' +
          '<span>\u26A0\uFE0F \u30A8\u30E9\u30FC\u30ED\u30B0</span>' +
          '<button id="debug-error-toggle" type="button">\u8868\u793A</button>' +
          '<button id="debug-error-clear" type="button">\u30AF\u30EA\u30A2</button>' +
        '</div>' +
        '<pre id="debug-error-list" class="hidden"></pre>' +
      '</div>';
    document.body.appendChild(this.panelEl);

    this.statsEl = this.panelEl.querySelector('#debug-stats');
    this.inputEl = this.panelEl.querySelector('#debug-cmd');
    this.errorListEl = this.panelEl.querySelector('#debug-error-list');

    this._buildButtons();
    this._bindEvents();
    this._updateStats();
  }

  _buildButtons() {
    const container = this.panelEl.querySelector('#debug-buttons');
    const defs = [
      { id: 'give10k',  label: '+$10K',   act: () => this._cheatMoney(10000) },
      { id: 'give1m',   label: '+$1M',    act: () => this._cheatMoney(1000000) },
      { id: 'scan',     label: '\uD83D\uDD1D \u5168\u9271\u8108\u30B9\u30AD\u30E3\u30F3', act: () => { doScan(); this._toast('\uD83D\uDD1D \u5168\u9271\u8108\u30B9\u30AD\u30E3\u30F3\u3092\u5B9F\u884C'); } },
      { id: 'time60',   label: '\u23F1 \u6642\u9593+60\u79D2', act: () => this._advanceTime(60) },
      { id: 'dump',     label: '\uD83D\uDCBE \u30BB\u30FC\u30D6\u30C0\u30F3\u30D7', act: () => this._dumpSave() },
      { id: 'bench',    label: '\uD83C\uDFAF \u30D9\u30F3\u30C1\u914D\u7F6E', act: () => this._placeBench() },
    ];
    for (const d of defs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'debug-btn-' + d.id;
      btn.textContent = d.label;
      btn.addEventListener('click', () => {
        try { d.act(); } catch (e) {
          console.error('[DebugConsole] button action failed:', e);
          this._toast('\u274C ' + d.label + ' \u304C\u5931\u6557: ' + (e && e.message), 'error');
        }
      });
      container.appendChild(btn);
    }
  }

  _bindEvents() {
    this.panelEl.querySelector('#debug-close').addEventListener('click', () => this.close());
    this.panelEl.querySelector('#debug-cmd-run').addEventListener('click', () => this._runCommand());
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._runCommand(); }
    });
    this.panelEl.querySelector('#debug-error-toggle').addEventListener('click', () => this._toggleErrorList());
    this.panelEl.querySelector('#debug-error-clear').addEventListener('click', () => {
      ErrorReporter.clear();
      this._renderErrorList();
      this._toast('\u2705 \u30A8\u30E9\u30FC\u30ED\u30B0\u3092\u30AF\u30EA\u30A2');
    });
  }

  /* ---------------- 表示制御 ---------------- */
  show() { if (this.panelEl) this.panelEl.classList.remove('hidden'); this._startStatsTimer(); }
  close() { if (this.panelEl) this.panelEl.classList.add('hidden'); this._stopStatsTimer(); }
  toggle() { if (this.panelEl.classList.contains('hidden')) this.show(); else this.close(); }

  _startStatsTimer() {
    if (this._statsTimer) return;
    this._statsTimer = setInterval(() => this._updateStats(), 500);
  }
  _stopStatsTimer() {
    if (this._statsTimer) { clearInterval(this._statsTimer); this._statsTimer = null; }
  }

  /* ---------------- ライブ統計 ---------------- */
  _updateStats() {
    if (!this.statsEl) return;
    const fps = getFpsEMA();
    const drawCalls = (renderer.info && renderer.info.render) ? renderer.info.render.calls : -1;
    const machineCount = state.machines.size;
    const itemCount = (ctx.itemPool && ctx.itemPool.slots)
      ? ctx.itemPool.slots.reduce((n, s) => n + (s && s.active ? 1 : 0), 0) : 0;
    const particleCount = getParticleCount();
    const errCount = ErrorReporter.listRecords().length;
    const lines = [
      ['FPS', fps.toFixed(1)],
      ['Draw calls', String(drawCalls)],
      ['Machines', String(machineCount)],
      ['Items', String(itemCount)],
      ['Particles', String(particleCount)],
      ['Errors', String(errCount)],
    ];
    this.statsEl.innerHTML = lines.map(([k, v]) =>
      '<div class="debug-stat"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'
    ).join('');
  }

  /* ---------------- チート ---------------- */
  /**
   * 所持金を増やす。earn() ではなく addMoney 直呼びで、マイルストーン実績を汚染しない。
   * @param {number} v
   */
  _cheatMoney(v) {
    gameState.addMoney(v);
    this._toast('\uD83D\uDCB0 +' + v.toLocaleString() + ' (addMoney)');
  }

  /**
   * updateMachines を dt=1.0 で N回 空回しする。クランプ(0.05s)は main ループ側の
   * 仕様なので、ここでは dt=1.0 を直接渡す(本来のクランプ仕様を迂回する専用パスは
   * updateMachines 側に足さず、ラッパー側でループする)。
   * @param {number} seconds
   */
  _advanceTime(seconds) {
    const n = Math.max(0, Math.floor(seconds));
    for (let i = 0; i < n; i++) updateMachines(1.0);
    this._toast('\u23F1 \u6642\u9593\u3092' + n + '\u79D2\u9032\u3081\u307E\u3057\u305F');
  }

  /**
   * 現在のセーブデータをコンソールにJSON出力する。
   */
  _dumpSave() {
    const data = saveGame();
    // saveGame() は保存も行うため、純粋なダンプ用に現在状態を構築し直すこともできるが、
    // 保存の副作用は無害なのでそのままコンソールへ出力する
    // (注: saveGame は boolean を返すため、localStorage から直接読み直す)
    try {
      const slot = 0; // アクティブスロット(簡易)
      const raw = localStorage.getItem('terraforge_v8_slot' + slot);
      const parsed = raw ? JSON.parse(raw) : null;
      console.log('[DebugConsole] Save dump:', parsed);
      this._toast('\uD83D\uDCBE \u30BB\u30FC\u30D6\u30C0\u30F3\u30D7\u3092\u30B3\u30F3\u30BD\u30FC\u30EB\u3078\u51FA\u529B');
    } catch (e) {
      console.log('[DebugConsole] Save dump (failed to read localStorage):', e);
      this._toast('\u274C \u30BB\u30FC\u30D6\u30C0\u30F3\u30D7\u5931\u6557', 'error');
    }
  }

  /**
   * ベンチ配置: ドリル25台 + コンベア100本 + 精錬炉10台 + 販売機5台 を
   * 中央エリアに自動設置する。ドリルは露出鉱石タイルを全体から探して設置。
   * その他は中央(48,48)周辺の空きマスに順に設置。
   */
  _placeBench() {
    let placed = { drill: 0, conveyor: 0, smelter: 0, seller: 0 };
    const tried = new Set();

    // 1) ドリル25台: 全体から露出鉱石を探す
    outer: for (let gx = 0; gx < GRID; gx++) {
      for (let gz = 0; gz < GRID; gz++) {
        if (placed.drill >= 25) break outer;
        if (state.machines.has(key(gx, gz))) continue;
        const t = state.tiles[gx][gz];
        if (!t.ore) continue;
        if (ORES[t.ore.type].depth !== t.depth) continue;
        if (placeMachine('drill', gx, gz, 0, true)) placed.drill++;
      }
    }

    // 2) 中央エリアの空きマスを列挙(中央(48,48)から外向きにらせん走査)
    const center = Math.floor(GRID / 2);
    const centerTiles = [];
    const maxRadius = 30;
    for (let r = 0; r <= maxRadius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // 外周のみ
          const gx = center + dx, gz = center + dz;
          if (!inGrid(gx, gz)) continue;
          if (state.machines.has(key(gx, gz))) continue;
          if (tried.has(key(gx, gz))) continue;
          centerTiles.push([gx, gz]);
        }
      }
      if (centerTiles.length >= 200) break;
    }

    // 3) smelter 10台 → seller 5台 → conveyor 100本 を中央エリアに設置
    let idx = 0;
    const tryPlace = (type, n) => {
      for (let i = 0; i < n && idx < centerTiles.length; i++) {
        // 別のマシンに上書きしないよう都度チェック
        let [gx, gz] = centerTiles[idx];
        while (idx < centerTiles.length && state.machines.has(key(gx, gz))) {
          idx++;
          if (idx < centerTiles.length) [gx, gz] = centerTiles[idx];
        }
        if (idx >= centerTiles.length) break;
        if (placeMachine(type, gx, gz, 0, true)) placed[type]++;
        idx++;
      }
    };
    tryPlace('smelter', 10);
    tryPlace('seller', 5);
    tryPlace('conveyor', 100);

    this._toast(
      '\uD83C\uDFAF \u30D9\u30F3\u30C1: drill\u00D7' + placed.drill +
      ' / conveyor\u00D7' + placed.conveyor +
      ' / smelter\u00D7' + placed.smelter +
      ' / seller\u00D7' + placed.seller
    );
  }

  /* ---------------- コマンド実行 ---------------- */
  _runCommand() {
    const input = this.inputEl.value;
    if (!input.trim()) return;
    try {
      const result = execCommand(input);
      this._toast(result.message, result.kind || 'good');
    } catch (e) {
      console.error('[DebugConsole] command failed:', e);
      this._toast('\u274C ' + (e && e.message), 'error');
    }
    this.inputEl.value = '';
  }

  /* ---------------- エラーログ ---------------- */
  _toggleErrorList() {
    this._errorListVisible = !this._errorListVisible;
    if (this._errorListVisible) {
      this._renderErrorList();
      this.errorListEl.classList.remove('hidden');
      this.panelEl.querySelector('#debug-error-toggle').textContent = '\u96A0\u3059';
    } else {
      this.errorListEl.classList.add('hidden');
      this.panelEl.querySelector('#debug-error-toggle').textContent = '\u8868\u793A';
    }
  }

  _renderErrorList() {
    const records = ErrorReporter.listRecords();
    if (records.length === 0) {
      this.errorListEl.textContent = '(\u30A8\u30E9\u30FC\u306A\u3057)';
      return;
    }
    const lines = records.slice().reverse().map((r, i) => {
      const date = new Date(r.time);
      const time = date.toLocaleTimeString();
      return '[' + (records.length - i) + '] ' + time +
        ' v' + r.gameVersion +
        ' mc=' + r.machineCount + ' ic=' + r.itemCount +
        (r.count > 1 ? ' x' + r.count : '') +
        '\n  ' + r.message +
        '\n  ' + r.stack.split('\n').slice(0, 3).join('\n  ');
    });
    this.errorListEl.textContent = lines.join('\n\n');
  }

  /* ---------------- 補助 ---------------- */
  _toast(msg, kind) {
    if (typeof ctx.toast === 'function') ctx.toast(msg, kind);
    else console.log('[DebugConsole]', msg);
  }
}

/**
 * コマンド文字列を実行する。パース→分岐→実行。
 * 純粋な関数(依存はモジュール直import)で、テスト可能。
 * @param {string} input
 * @returns {{message:string, kind?:string}}
 */
export function execCommand(input) {
  const parsed = parseCommand(input);
  if (!parsed) return { message: '\u7A7A\u30B3\u30DE\u30F3\u30C9', kind: 'error' };
  const { cmd, args } = parsed;

  switch (cmd) {
    case 'give': {
      const v = Number(args[0]);
      if (!isFinite(v) || args.length < 1) {
        return { message: 'usage: give <amount>', kind: 'error' };
      }
      // earn() ではなく addMoney 直呼びでマイルストーンを汚染しない
      gameState.addMoney(v);
      return { message: '\uD83D\uDCB0 +' + v.toLocaleString() + ' (addMoney)' };
    }
    case 'place': {
      // place <type> <gx> <gz> [dir]
      const type = args[0];
      const gx = Number(args[1]);
      const gz = Number(args[2]);
      const dir = args[3] !== undefined ? Number(args[3]) : 0;
      if (!type || !isFinite(gx) || !isFinite(gz)) {
        return { message: 'usage: place <type> <gx> <gz> [dir]', kind: 'error' };
      }
      if (!inGrid(gx, gz)) {
        return { message: '\u7BC4\u56F2\u5916: (' + gx + ',' + gz + ')', kind: 'error' };
      }
      const ok = placeMachine(type, gx, gz, dir, true);
      return ok
        ? { message: '\u2705 ' + type + ' \u3092 (' + gx + ',' + gz + ') \u306B\u914D\u7F6E' }
        : { message: '\u274C ' + type + ' \u306F (' + gx + ',' + gz + ') \u306B\u914D\u7F6E\u3067\u304D\u307E\u305B\u3093', kind: 'error' };
    }
    case 'clearmachines': {
      const before = state.machines.size;
      // イテレータを破壊しないようキー一覧を先に取得
      const keys = [...state.machines.keys()];
      for (const k of keys) {
        const [gxStr, gzStr] = k.split(',');
        const gx = +gxStr, gz = +gzStr;
        // removeMachine は内部で state.machines.delete するので安全
        // silent フラグが無いためトーストが出るが、debug なので許容
        const m = state.machines.get(k);
        if (m) {
          // 直接破棄(removeMachine だと toast/sfx が各機械で発火して重い)
          if (m.mesh && m.mesh.parent) m.mesh.parent.remove(m.mesh);
          if (m.item) { /* release は logistics 経由 */ ctx.itemPool && ctx.itemPool.release(m.item); }
          state.machines.delete(k);
        }
      }
      // 電力網を再構築
      powerGrid.rebuild(state.machines.values());
      return { message: '\u2705 ' + before + ' \u53F0\u3092\u524A\u9664' };
    }
    case 'setpower': {
      // テスト用: PowerGrid.capacity を強制設定する(本来は発電機を増やすべきだが、
      // デバッグ用途なのでキャッシュを直接いじる)
      const v = Number(args[0]);
      if (!isFinite(v)) {
        return { message: 'usage: setpower <capacity>', kind: 'error' };
      }
      powerGrid.capacity = v;
      powerGrid.ok = powerGrid.used <= v;
      // UI 更新イベントを発火
      const snap = powerGrid.snapshot();
      // power:changed は powerGrid.rebuild 内で発火されるので、
      // ここでは cheap に bus を経由せず state 変更のみ
      return { message: '\u26A1 capacity = ' + v + ' / used = ' + snap.used };
    }
    default:
      return { message: '\u672A\u77E5\u30B3\u30DE\u30F3\u30C9: ' + cmd + ' (give/place/clearmachines/setpower)', kind: 'error' };
  }
}
