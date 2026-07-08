/* =====================================================================
   TerraForge — 数値フォーマット & 触覚ユーティリティ (Phase07)
   ---------------------------------------------------------------------
   formatMoney(v): 数値省略表記設定(settings.shortNumbers)に応じて
     $1234 → "$1.2K" / $1234567 → "$1.2M" / $1234567890 → "$1.2B"
     (小数1桁・切り捨て)。OFF時は "$1,234" のフル表示。
     所持金HUD・トースト・フローティングテキストの金額表示は全てこれ経由。
   vibrate(pattern): 触覚フィードバック設定(settings.haptics)でラップ。
   ===================================================================== */
import { gameState } from '../state.js';

const ABBREV_UNITS = [
  { div: 1e9, suffix: 'B' },
  { div: 1e6, suffix: 'M' },
  { div: 1e3, suffix: 'K' },
];

/**
 * 設定に応じて金額を文字列表記にする。
 * @param {number} v 金額
 * @param {boolean} [short] 省略表記を強制指定(テスト用)。省略時は settings.shortNumbers を参照。
 * @returns {string} "$1.2K" / "$12,345,678" 等
 */
export function formatMoney(v, short) {
  const useShort = typeof short === 'boolean'
    ? short
    : !!(gameState.settings && gameState.settings.shortNumbers !== false);
  const neg = v < 0;
  const n = Math.floor(Math.abs(v));

  if (!useShort) {
    return (neg ? '-$' : '$') + n.toLocaleString();
  }
  if (n === 0) return '$0';

  for (const u of ABBREV_UNITS) {
    if (n >= u.div) {
      // 小数1桁で切り捨て(1034 → 1.0K, 1234 → 1.2K)
      const scaled = Math.floor((n / u.div) * 10) / 10;
      let str = scaled.toFixed(1);
      // 末尾の ".0" は整形上削除("$1.0K"→"$1K")
      if (str.endsWith('.0')) str = str.slice(0, -2);
      return (neg ? '-$' : '$') + str + u.suffix;
    }
  }
  return (neg ? '-$' : '$') + n;
}

/**
 * 触覚フィードバック設定を反映した navigator.vibrate ラッパー。
 * settings.haptics が false の場合は呼び出さない。
 * @param {number|number[]} pattern 振動パターン
 */
export function vibrate(pattern) {
  try {
    if (gameState.settings && gameState.settings.haptics &&
        typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch (e) { /* noop */ }
}
