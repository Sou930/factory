/* =====================================================================
   TerraForge — ErrorReporter (Phase08)
   ---------------------------------------------------------------------
   実行時エラーをローカル(localStorage)に収集する。
   - window 'error' / 'unhandledrejection' を捕捉
   - 各レコード: {message, stack, time, gameVersion, machineCount, itemCount}
   - localStorage('terraforge_errors') に最大 MAX_RECORDS 件のリングバッファで保存
   - 通常プレイヤーには「エラーが発生しました」トーストを1回だけ表示(スパム防止)
   - デバッグパネルから一覧表示/クリア可能

   本モジュールは本番バンドルにも含まれるが、初期化(init)は任意。
   init() は window イベント購読のみで軽量。必要なのは localStorage I/O のみ。
   ===================================================================== */
import { GAME_VERSION } from '../constants-version.js';

/** localStorage キー */
const STORAGE_KEY = 'terraforge_errors';
/** リングバッファの最大件数 */
const MAX_RECORDS = 20;
/** トーストのスパム防止クールダウン(ms)。この間は2回目以降のトーストを抑制 */
const TOAST_COOLDOWN_MS = 5000;

/**
 * 依存注入コンテナ。main.js の init() 時に setContext で state/itemPool/toast
 * を注入する。これにより ErrorReporter は状態モジュールへの直接 import を
 * 持たず、本番バンドルに依存関係を膨らませない。
 * また、ロード失敗等で state が未初期化のタイミングでも例外を吐かない。
 */
const contextRef = {
  state: null,
  itemPool: null,
  toast: null,
};

/**
 * main.js から依存を注入する。
 * @param {{state?:object, itemPool?:object, toast?:(msg:string,kind?:string)=>void}} deps
 */
export function setContext(deps) {
  if (!deps) return;
  if (deps.state) contextRef.state = deps.state;
  if (deps.itemPool) contextRef.itemPool = deps.itemPool;
  if (typeof deps.toast === 'function') contextRef.toast = deps.toast;
}

/**
 * 現在の機械数とアイテム数を取得する。
 * main.js 側で setContext が呼ばれる前やロード途中でも安全に失敗できるよう、
 * 全ての参照を try/catch で囲む。
 * @returns {{machineCount:number, itemCount:number}}
 */
function collectContext() {
  let machineCount = 0;
  let itemCount = 0;
  try {
    if (contextRef.state && contextRef.state.machines) {
      machineCount = contextRef.state.machines.size;
    }
    if (contextRef.itemPool && contextRef.itemPool.slots) {
      itemCount = contextRef.itemPool.slots.reduce(
        (n, s) => n + (s && s.active ? 1 : 0), 0);
    }
  } catch (e) { /* noop */ }
  return { machineCount, itemCount };
}

/**
 * エラーオブジェクトから {message, stack} を抽出する。
 * stack が無ければ source/lineno/colno から簡易スタック文字列を作る。
 * @param {Error|{message?:string, stack?:string}} err
 * @param {{filename?:string, lineno?:number, colno?:number, message?:string}} [extra]
 * @returns {{message:string, stack:string}}
 */
function normalizeError(err, extra) {
  extra = extra || {};
  const message = (err && err.message) ? String(err.message)
    : (extra && extra.message ? String(extra.message) : 'Unknown error');
  let stack = (err && err.stack) ? String(err.stack) : '';
  if (!stack) {
    const parts = [];
    if (extra.filename) parts.push('at ' + extra.filename);
    if (extra.lineno) parts.push('line ' + extra.lineno + (extra.colno ? ':' + extra.colno : ''));
    stack = parts.length ? parts.join(' ') : '(no stack)';
  }
  return { message, stack };
}

/**
 * エラーレコードをリングバッファへ保存する。
 * 既存レコードと完全に同一(message+stack)の最新レコードが既にあれば、
 * 重複保存せずに count のみインクリメントする(同一エラーのスパム防止)。
 * @param {Error|{message?:string, stack?:string}} err
 * @param {{filename?:string, lineno?:number, colno?:number, message?:string}} [extra]
 * @returns {object} 保存されたレコード(未保存の場合は更新された既存レコード)
 */
export function capture(err, extra) {
  const { message, stack } = normalizeError(err, extra);
  const { machineCount, itemCount } = collectContext();
  const record = {
    message,
    stack,
    time: Date.now(),
    gameVersion: GAME_VERSION,
    machineCount,
    itemCount,
    count: 1,
  };

  // 直近レコードとの重複判定(同一 message+stack なら count を増やすだけ)
  const list = listRecords();
  if (list.length > 0) {
    const last = list[list.length - 1];
    if (last.message === message && last.stack === stack) {
      last.count = (last.count || 1) + 1;
      last.time = record.time;
      last.machineCount = machineCount;
      last.itemCount = itemCount;
      saveRecords(list);
      return last;
    }
  }

  list.push(record);
  while (list.length > MAX_RECORDS) list.shift();
  saveRecords(list);
  return record;
}

/**
 * 保存済みの全レコードを取得する(古い順)。
 * 読み込み失敗時は空配列を返す(ゲームは継続)。
 * @returns {object[]}
 */
export function listRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/**
 * 全レコードをクリアする。
 */
export function clear() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
}

/**
 * 内部用: レコード配列を localStorage へ保存する。
 * @param {object[]} records
 */
function saveRecords(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) { /* noop */ }
}

/* ---- トースト・スパム防止 ---- */
let lastToastAt = 0;
/**
 * 通常プレイヤー向けの「エラー発生」トーストを1回だけ出す。
 * TOAST_COOLDOWN_MS 以内の再呼出は無視する。
 */
function notifyUserOnce() {
  const now = Date.now();
  if (now - lastToastAt < TOAST_COOLDOWN_MS) return;
  lastToastAt = now;
  if (typeof contextRef.toast === 'function') {
    try {
      contextRef.toast('\u26A0\uFE0F \u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002\u30B2\u30FC\u30E0\u306F\u7D9A\u884C\u3057\u307E\u3059', 'error');
    } catch (e) { /* noop */ }
  }
}

/**
 * window の 'error' / 'unhandledrejection' リスナを登録する。
 * main.js の起動時に1回だけ呼ぶこと。本番バンドルでも安全。
 * リスナは EventBus と同様に例外を飲み、ゲームループへ影響しない。
 * @returns {() => void} 登録解除関数(テスト/リセット用)
 */
export function init() {
  const onError = (event) => {
    try {
      // event.error があればそれを使い、無ければ message+filename+lineno を使う
      const err = event.error || { message: event.message };
      capture(err, { filename: event.filename, lineno: event.lineno, colno: event.colno });
      notifyUserOnce();
    } catch (e) { /* noop */ }
  };
  const onRejection = (event) => {
    try {
      const err = (event && event.reason) instanceof Error
        ? event.reason
        : { message: 'Unhandled promise rejection: ' + String(event && event.reason) };
      capture(err);
      notifyUserOnce();
    } catch (e) { /* noop */ }
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/* テスト/リセット用: トーストクールダウンをリセット */
export function _resetToastCooldown() { lastToastAt = 0; }
