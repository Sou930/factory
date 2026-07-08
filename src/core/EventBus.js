/* =====================================================================
   TerraForge — 汎用 Pub/Sub EventBus
   ---------------------------------------------------------------------
   Phase03 で導入。UI とロジックを疎結合にするための中核。
   emit 内の例外はゲームループを止めないよう try/catch で包み、
   console.error に出力する。
   ===================================================================== */
export class EventBus {
  #handlers = new Map();

  /** イベント購読。解除関数を返す */
  on(event, fn) {
    let set = this.#handlers.get(event);
    if (!set) {
      set = new Set();
      this.#handlers.set(event, set);
    }
    set.add(fn);
    return () => this.off(event, fn);
  }

  /** 1回だけ発火する購読。解除関数を返す */
  once(event, fn) {
    const wrapper = (payload) => {
      this.off(event, wrapper);
      try { fn(payload); } catch (e) { console.error('[EventBus] once handler error:', e); }
    };
    return this.on(event, wrapper);
  }

  /** 購読解除 */
  off(event, fn) {
    const set = this.#handlers.get(event);
    if (set) set.delete(fn);
  }

  /** イベント発火。各ハンドラの例外は分離される */
  emit(event, payload) {
    const set = this.#handlers.get(event);
    if (!set || set.size === 0) return;
    // 一覧をコピーして、発火中の off/on による反復不整合を防ぐ
    const handlers = [...set];
    for (const fn of handlers) {
      try {
        fn(payload);
      } catch (e) {
        // 1ハンドラの例外が他ハンドラやゲームループを止めないように分離
        console.error('[EventBus] handler error for "' + event + '":', e);
      }
    }
  }

  /** テスト/リセット用: 全ハンドラをクリア */
  clear() {
    this.#handlers.clear();
  }

  /** テスト/デバッグ用: 指定イベントの購読者数 */
  listenerCount(event) {
    return this.#handlers.get(event)?.size || 0;
  }
}

/* シングルトン: アプリ全体で共有するバス */
export const bus = new EventBus();
