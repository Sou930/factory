/* =====================================================================
   TerraForge — GAME_VERSION 定数 (Phase08)
   ---------------------------------------------------------------------
   package.json の version を vite の define 経由で注入した __GAME_VERSION__
   を再エクスポートする。テスト環境(vitest)等で define が適用されていない場合
   は 'dev' フォールバック値を使う。

   使用箇所:
   - ErrorReporter のエラーレコード gameVersion フィールド
   - SettingsModal フッターのバージョン表示
   ===================================================================== */

/** @type {string} ゲームバージョン。vite がビルド時に package.json から注入する */
export const GAME_VERSION = typeof __GAME_VERSION__ !== 'undefined'
  ? __GAME_VERSION__
  : 'dev';
