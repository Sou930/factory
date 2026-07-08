/* =====================================================================
   TerraForge — SaveManager (Phase06: バージョニング・マイグレーション・スロット)
   ---------------------------------------------------------------------
   セーブデータにスキーマバージョンを導入し、旧バージョンからの自動移行、
   複数スロット、エクスポート/インポート、破損通知を提供する。

   【注意】以降の全フェーズでセーブ項目を追加する際は、必ず
   constants.js の SAVE_VERSION をインクリメントし、本ファイルの
   MIGRATIONS に対応する変換関数を追加すること。マイグレーション関数は
   純関数にし、必ずテストを書く(tests/saveManager.test.js を参照)。
   ===================================================================== */
import { SAVE_VERSION, SAVE_KEY, SAVE_KEY_PREFIX, SAVE_SLOT_COUNT, SAVE_LEGACY_BACKUP_KEY, LEGACY_MUTED_KEY } from '../constants.js';
import { bus } from '../core/EventBus.js';
import { Events } from '../core/events.js';

/**
 * v7 (旧フラット形式) → v8 (構造化スキーマ) への変換。
 * v7データ形状: {seed, money, stats, tiles, machines, items, time?, tool?,
 *                buildDir?, selectedFilter?}
 * 純関数: 引数を変更せず、新しいオブジェクトを返す。
 * @param {object} old v7形式のセーブデータ
 * @returns {object} v8形式のセーブデータ
 */
function migrate_7_to_8(old) {
  return {
    version: 8,
    meta: {
      savedAt: old.savedAt || Date.now(),
      playTime: old.playTime || 0,
    },
    world: {
      seed: old.seed || 0,
      tiles: old.tiles || [],
    },
    economy: {
      money: typeof old.money === 'number' ? old.money : 0,
      stats: old.stats ? { ...old.stats } : { earned: 0, msIndex: 0 },
    },
    machines: old.machines || [],
    items: old.items || [],
    settings: {
      muted: old.muted || false,
      selectedFilter: old.selectedFilter || 'any',
      buildDir: old.buildDir || 0,
    },
    camera: old.camera || null,
  };
}

/**
 * v8 → v9 (Phase07: settings 拡張) への変換。
 * 既存 settings に Phase07 のデフォルト値(sfxVolume/bgmVolume/quality/haptics/
 * showCamPad/shortNumbers)をマージする。純関数。
 * @param {object} old v8形式のセーブデータ
 * @returns {object} v9形式のセーブデータ
 */
function migrate_8_to_9(old) {
  const prevSettings = old.settings || {};
  return {
    ...old,
    version: 9,
    settings: {
      muted: prevSettings.muted || false,
      selectedFilter: prevSettings.selectedFilter || 'any',
      buildDir: prevSettings.buildDir || 0,
      sfxVolume: typeof prevSettings.sfxVolume === 'number' ? prevSettings.sfxVolume : 1,
      bgmVolume: typeof prevSettings.bgmVolume === 'number' ? prevSettings.bgmVolume : 0.7,
      quality: prevSettings.quality === 'low' || prevSettings.quality === 'medium' || prevSettings.quality === 'high'
        ? prevSettings.quality : 'high',
      haptics: typeof prevSettings.haptics === 'boolean' ? prevSettings.haptics : true,
      showCamPad: typeof prevSettings.showCamPad === 'boolean' ? prevSettings.showCamPad : true,
      shortNumbers: typeof prevSettings.shortNumbers === 'boolean' ? prevSettings.shortNumbers : true,
    },
  };
}

/** バージョン番号 → そのバージョンから次バージョンへの変換関数 */
const MIGRATIONS = {
  7: migrate_7_to_8,
  8: migrate_8_to_9,
};

function saveKeyFor(slot) {
  return SAVE_KEY_PREFIX + slot;
}

/** Unicode安全な Base64 エンコード/デコード */
function toBase64(json) {
  return btoa(unescape(encodeURIComponent(json)));
}
function fromBase64(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

export class SaveManager {
  /**
   * 現在の状態をスロットへ保存する。
   * @param {object} data v8スキーマの完全なセーブデータ(version含む)
   * @param {number} slot 0〜(SAVE_SLOT_COUNT-1)
   */
  save(data, slot = 0) {
    try {
      const payload = { ...data, version: SAVE_VERSION };
      localStorage.setItem(saveKeyFor(slot), JSON.stringify(payload));
      return true;
    } catch (e) {
      console.error('[SaveManager] save failed:', e);
      return false;
    }
  }

  /**
   * スロットからロードする。
   * JSON parse失敗時は save:corrupted を発火して null を返す。
   * バージョンが古ければ MIGRATIONS を順次適用してから返す。
   * 未知の(現行より新しい)バージョンは拒否して null を返す。
   * @param {number} slot
   * @returns {object|null}
   */
  load(slot = 0) {
    let raw;
    try {
      raw = localStorage.getItem(saveKeyFor(slot));
    } catch (e) {
      return null;
    }
    if (!raw) return null;
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      bus.emit(Events.SAVE_CORRUPTED, { slot, raw });
      return null;
    }
    return this._migrateToCurrent(data, slot);
  }

  /**
   * バージョンを現行まで順次移行する。未知の将来バージョンは拒否。
   * @param {object} data
   * @param {number} [slot]
   * @returns {object|null}
   */
  _migrateToCurrent(data, slot) {
    if (!data || typeof data.version !== 'number') {
      bus.emit(Events.SAVE_CORRUPTED, { slot });
      return null;
    }
    if (data.version > SAVE_VERSION) {
      // 未知の将来バージョン: このクライアントでは読めないため拒否
      bus.emit(Events.SAVE_CORRUPTED, { slot });
      return null;
    }
    let cur = data;
    while (cur.version < SAVE_VERSION) {
      const migrate = MIGRATIONS[cur.version];
      if (!migrate) {
        bus.emit(Events.SAVE_CORRUPTED, { slot });
        return null;
      }
      cur = migrate(cur);
    }
    return cur;
  }

  /**
   * 旧v7セーブ('terraforge_save_v7')が存在すれば移行する。
   * 移行後は slot0 に保存し、旧キーは terraforge_save_v7_backup にリネームする
   * (削除ではなくバックアップとして残す)。
   * @returns {object|null} 移行後のv8データ。旧セーブが無ければ null
   */
  loadLegacy() {
    let raw;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;
    let old;
    try {
      old = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    // v7セーブには version フィールドが無いので付与してから移行パイプラインへ
    const withVersion = { version: 7, ...old };
    const migrated = this._migrateToCurrent(withVersion);
    if (!migrated) return null;
    // 旧 terraforge_muted キー(v7セーブJSONの外側、別localStorageキー)から
    // ミュート設定を settings.muted へ統合する(v7セーブ内に muted が無い場合のみ)
    if (typeof old.muted !== 'boolean') {
      let legacyMuted = null;
      try { legacyMuted = localStorage.getItem(LEGACY_MUTED_KEY); } catch (e) { /* noop */ }
      if (legacyMuted !== null) migrated.settings.muted = legacyMuted === '1';
    }
    this.save(migrated, 0);
    try {
      localStorage.setItem(SAVE_LEGACY_BACKUP_KEY, raw);
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(LEGACY_MUTED_KEY); // 統合済みのため旧キーは削除
    } catch (e) { /* ベストエフォート: バックアップ失敗してもマイグレーション自体は成功扱い */ }
    return migrated;
  }

  /**
   * 指定スロットの内容をエクスポート文字列(Base64)にする。
   * @param {number} slot
   * @returns {string|null} エクスポート文字列。スロットが空なら null
   */
  exportString(slot = 0) {
    let raw;
    try {
      raw = localStorage.getItem(saveKeyFor(slot));
    } catch (e) {
      return null;
    }
    if (!raw) return null;
    try {
      return toBase64(raw);
    } catch (e) {
      console.error('[SaveManager] export failed:', e);
      return null;
    }
  }

  /**
   * エクスポート文字列からスロットへインポートする。
   * バージョン検証・JSON検証に失敗した場合は false を返す(トーストはUI層が表示)。
   * @param {string} str
   * @param {number} slot
   * @returns {boolean}
   */
  importString(str, slot = 0) {
    let json;
    try {
      json = fromBase64(str.trim());
    } catch (e) {
      return false;
    }
    let data;
    try {
      data = JSON.parse(json);
    } catch (e) {
      return false;
    }
    const migrated = this._migrateToCurrent(data);
    if (!migrated) return false;
    return this.save(migrated, slot);
  }

  /**
   * 各スロットのメタ情報一覧を返す(スロット選択UI用)。
   * @returns {Array<{slot:number, empty:boolean, savedAt?:number, money?:number, playTime?:number}>}
   */
  listSlots() {
    const out = [];
    for (let slot = 0; slot < SAVE_SLOT_COUNT; slot++) {
      let raw;
      try {
        raw = localStorage.getItem(saveKeyFor(slot));
      } catch (e) {
        raw = null;
      }
      if (!raw) { out.push({ slot, empty: true }); continue; }
      try {
        const data = JSON.parse(raw);
        out.push({
          slot,
          empty: false,
          savedAt: data.meta ? data.meta.savedAt : undefined,
          money: data.economy ? data.economy.money : undefined,
          playTime: data.meta ? data.meta.playTime : undefined,
        });
      } catch (e) {
        out.push({ slot, empty: false, corrupted: true });
      }
    }
    return out;
  }
}

/* シングルトン: アプリ全体で共有するセーブマネージャ */
export const saveManager = new SaveManager();
