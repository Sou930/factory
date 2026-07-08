/* =====================================================================
   TerraForge — GameState クラス
   ---------------------------------------------------------------------
   Phase03 で導入。旧 state.js の全フィールドを1クラスに集約し、
   変更はメソッド経由のみに制限する(直接代入を排除)。
   money は getter / addMoney / earn のみ更新可。
   earn は bus.emit('money:earned', ...) と milestone 判定を発火。
   serialize / deserialize の実体は Phase06 で拡張する(骨格のみ)。
   ===================================================================== */
import { START_MONEY, MILESTONES } from '../constants.js';
import { bus } from './EventBus.js';
import { Events } from './events.js';

export class GameState {
  constructor() {
    /** 現在のツール */
    this.tool = 'dig';
    /** 設置向き (0=E,1=S,2=W,3=N) */
    this.buildDir = 0;
    /** フィルターコンベア選択中の鉱石 */
    this.selectedFilter = 'any';

    /** タイル二次元配列 (world.js が生成) */
    this.tiles = [];
    /** 機械マップ: "gx,gz" -> machine オブジェクト */
    this.machines = new Map();
    /** ライン上を流れているアイテム */
    this.items = [];
    /** フローティングテキスト(+$N 等の一時表示) */
    this.floaters = [];
    /** スキャンマーカー */
    this.scanMarkers = [];
    /** スキャン残り時間 */
    this.scanTimer = 0;

    /** ゲーム内時計(秒) */
    this.time = 0;

    /** 累計プレイ時間(秒)。ループで dt を加算し、v8セーブに保存される */
    this.playTime = 0;

    /* 電力状態は PowerGrid が管理する(Phase04)。PowerGrid.rebuild() で導出されるため、
       GameState には電力状態を保持しない */

    /** 統計情報 */
    this.stats = { earned: 0, msIndex: 0 };

    /** ワールド生成シード */
    this.seed = 0;

    /** 効果音ミュート状態(Phase06: 旧 terraforge_muted キーから settings.muted へ統合) */
    this.muted = false;

    /** 内部所持金。直接代入禁止: money getter / addMoney / earn のみ更新可 */
    this._money = START_MONEY;

    /** 前回 emit 時の所持金(値が変わった時のみ emit する) */
    this._lastEmittedMoney = START_MONEY;

    /** Phase07: 設定(音量/品質/表示)。settings オブジェクトとしてセーブv9に統合保存 */
    this.settings = {
      muted: false,
      sfxVolume: 1,
      bgmVolume: 0.7,
      quality: 'high',
      haptics: true,
      showCamPad: true,
      shortNumbers: true,
    };

    /** Phase07: UI状態(ツールバーの選択カテゴリ等)。保存不要だがメモリ上で保持 */
    this.ui = {
      selectedCategory: 'mining',
    };
  }

  /* ---------------- 所持金 ---------------- */
  /** 現在の所持金(読取専用の意図。直接代入禁止) */
  get money() { return this._money; }

  /**
   * 所持金を増減させる。
   * @param {number} v 正負どちらも可
   * @returns {number} 更新後の所持金
   */
  addMoney(v) {
    this._money += v;
    this._emitMoneyChanged();
    return this._money;
  }

  /**
   * 売上/報酬で所持金を増やす。
   * 累計収益(stats.earned)を更新し、money:earned イベントを発火。
   * その後マイルストーン到達判定を行い、到達した分だけ reward を加算 &
   * milestone:reached を発火する。
   * @param {number} v 増分(正数前提。負でも動作するが stats.earned は減らない)
   * @returns {number} 更新後の所持金
   */
  earn(v) {
    this._money += v;
    if (v > 0) this.stats.earned += v;
    bus.emit(Events.MONEY_EARNED, { amount: v, total: this._money, earned: this.stats.earned });
    this._emitMoneyChanged();
    this.checkMilestones();
    return this._money;
  }

  /** money:changed を値が変わった時のみ発火(毎フレームの重複 emit 抑制) */
  _emitMoneyChanged() {
    if (this._money !== this._lastEmittedMoney) {
      bus.emit(Events.MONEY_CHANGED, { total: this._money, last: this._lastEmittedMoney });
      this._lastEmittedMoney = this._money;
    }
  }

  /**
   * 累計収益がマイルストーン閾値を超えていれば、到達した全マイルストーンに
   * 対して reward を加算 & milestone:reached イベントを発火する。
   * @returns {Array<{milestone,index,reward}>} 到達したマイルストーン一覧
   */
  checkMilestones() {
    const reached = [];
    while (this.stats.msIndex < MILESTONES.length && this.stats.earned >= MILESTONES[this.stats.msIndex].at) {
      const ms = MILESTONES[this.stats.msIndex];
      this.stats.msIndex++;
      // ボーナス加算(無限ループ回避のため earn ではなく _money 直操作 + emit)
      this._money += ms.reward;
      const payload = { milestone: ms, index: this.stats.msIndex - 1, reward: ms.reward, total: this._money };
      bus.emit(Events.MILESTONE_REACHED, payload);
      reached.push(payload);
    }
    if (reached.length > 0) this._emitMoneyChanged();
    return reached;
  }

  /* ---------------- シリアライズ(Phase06: v8スキーマ完全対応) ---------------- */
  /**
   * セーブ用に状態をプレーンオブジェクトに変換する。
   * GameState が直接保持するフィールド(money/stats/time/tool/buildDir/
   * selectedFilter/seed/muted/playTime)のみを対象とする。
   * tiles/machines/items/camera は別モジュールが保持するため、
   * SaveManager 側で合成される(v8スキーマの meta/world/economy/settings に相当)。
   * @returns {object} JSON 保存可能なプレーンオブジェクト
   */
  serialize() {
    return {
      seed: this.seed,
      money: this._money,
      stats: { ...this.stats },
      time: this.time,
      playTime: this.playTime,
      tool: this.tool,
      buildDir: this.buildDir,
      selectedFilter: this.selectedFilter,
      muted: this.muted,
      // Phase07: settings を保存(muted は従来互換のため top-level にも保持)
      settings: { ...this.settings },
    };
  }

  /**
   * セーブデータから状態を復元する。
   * v8スキーマ(SaveManager が合成したフラット化済みオブジェクト)、
   * および後方互換のため旧フラット形式の両方を受け付ける。
   * tiles/machines/items/camera の復元は main.js / SaveManager が直接行う。
   * @param {object} data セーブデータ
   * @returns {GameState} this
   */
  deserialize(data) {
    if (!data) return this;
    if (typeof data.seed === 'number') this.seed = data.seed;
    if (typeof data.money === 'number') { this._money = data.money; this._lastEmittedMoney = data.money; }
    if (data.stats) this.stats = Object.assign(this.stats, data.stats);
    if (typeof data.time === 'number') this.time = data.time;
    if (typeof data.playTime === 'number') this.playTime = data.playTime;
    if (typeof data.tool === 'string') this.tool = data.tool;
    if (typeof data.buildDir === 'number') this.buildDir = data.buildDir;
    if (typeof data.selectedFilter === 'string') this.selectedFilter = data.selectedFilter;
    if (typeof data.muted === 'boolean') this.muted = data.muted;
    // Phase07: settings の復元(既定値にマージ。muted は従来互換で top-level 优先)
    if (data.settings && typeof data.settings === 'object') {
      this.settings = Object.assign(this.settings, data.settings);
    }
    if (typeof this.muted === 'boolean') this.settings.muted = this.muted;
    return this;
  }
}

/* シングルトン: アプリ全体で共有するゲーム状態 */
export const gameState = new GameState();
