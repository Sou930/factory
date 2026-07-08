/* =====================================================================
   TerraForge — レガシー状態エクスポート (Phase03 で GameState へ統合)
   ---------------------------------------------------------------------
   旧コードで `import { state } from './state.js'` している箇所の互換性
   を保つため、gameState を state として再エクスポートする。
   GameState は money を getter で持つため、state.money 読み取りは従来通り
   動作する。state.money = X のような直接代入は許容しない(代入しても
   内部の _money は変わらない)。書き込みは gameState.addMoney / earn のみ。
   段階的に各モジュールは gameState へ直接 import 切替を行う。
   ===================================================================== */
import { gameState } from './core/GameState.js';

/* 後方互換のため、gameState もそのまま再エクスポートする。
   各モジュールは `import { state, gameState } from './state.js'` で両方取得可能。
   gameState を直接 import する場合は `import { gameState } from './core/GameState.js'`
   を推奨(Phase06 以降はこちらに統合)。 */
export { gameState };

/**
 * @deprecated Phase03 以降は gameState を直接 import すること。
 * 一時的な後方互換用エイリアス。
 */
export const state = gameState;
