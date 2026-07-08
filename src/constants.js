/* =====================================================================
   TerraForge — 定数
   ===================================================================== */
export const GRID = 96;
export const TS = 2;
export const LH = 0.62;
export const MAX_DEPTH = 4;
export const ELEV_MAX = 3;
export const START_MONEY = 500;
/** @deprecated Phase06 以降は terraforge_v8_slotN を使用。loadLegacy() の移行元としてのみ参照される */
export const SAVE_KEY = 'terraforge_save_v7';
/** 現行セーブスキーマのバージョン。以降フェーズでセーブ項目を追加する際は必ずインクリメントし、
 * SaveManager の MIGRATIONS に対応する変換関数を追加すること */
export const SAVE_VERSION = 9;
/** v8スロットセーブの localStorage キー接頭辞。実キーは SAVE_KEY_PREFIX + slot (0,1,2) */
export const SAVE_KEY_PREFIX = 'terraforge_v8_slot';
/** 利用可能なセーブスロット数 */
export const SAVE_SLOT_COUNT = 3;
/** 旧v7セーブをマイグレーション後に退避するバックアップキー */
export const SAVE_LEGACY_BACKUP_KEY = 'terraforge_save_v7_backup';
/** 旧ミュート設定キー(v8で settings.muted に統合。移行後は削除される) */
export const LEGACY_MUTED_KEY = 'terraforge_muted';

export const ORES = {
  coal:    { name: '石炭',     depth: 1, color: 0x4b515f, ingotColor: 0x7c869c, oreValue: 1,  ingotValue: 4 },
  iron:    { name: '鉄',       depth: 1, color: 0xb8bec9, ingotColor: 0xdfe5ee, oreValue: 2,  ingotValue: 6 },
  copper:  { name: '銅',       depth: 2, color: 0xe08a3c, ingotColor: 0xffb060, oreValue: 4,  ingotValue: 14 },
  silver:  { name: '銀',       depth: 2, color: 0xd4dce8, ingotColor: 0xf2f6fc, oreValue: 6,  ingotValue: 20 },
  gold:    { name: '金',       depth: 3, color: 0xffd23e, ingotColor: 0xffe680, oreValue: 10, ingotValue: 34 },
  diamond: { name: 'ダイヤ',   depth: 3, color: 0x7de8ff, ingotColor: 0xc4f4ff, oreValue: 18, ingotValue: 60 },
  ruby:    { name: 'ルビー',   depth: 4, color: 0xe0335a, ingotColor: 0xff6b8f, oreValue: 28, ingotValue: 95 },
  mithril: { name: 'ミスリル', depth: 4, color: 0x4fe8b8, ingotColor: 0xb8ffe6, oreValue: 42, ingotValue: 145 },
};

export const COSTS = { drill: 50, drill2: 220, conveyor: 10, fastConveyor: 25, smelter: 120, autoCrafter: 320, seller: 80, splitter: 90, merger: 90, chest: 60, filterConveyor: 30, generator: 180 };
export const POWER_OUTPUT = { generator: 12 };
export const POWER_RANGE = 7;
export const POWER_USE = { drill: 2, drill2: 3, smelter: 4, autoCrafter: 6, conveyor: 0, fastConveyor: 0, filterConveyor: 0, splitter: 0, merger: 0, chest: 0, seller: 0 };
export const DIRS = [ {x:1,z:0}, {x:0,z:1}, {x:-1,z:0}, {x:0,z:-1} ];
export const DIR_ARROWS = ['\u2192','\u2193','\u2190','\u2191'];

export const CHEST_UPGRADE_RULES = [
  { from: 'drill', to: 'drill2', label: '\u30C9\u30EA\u30EBMk2', needs: { iron_i: 20, copper_i: 12, silver_i: 6 } },
  { from: 'conveyor', to: 'fastConveyor', label: '\u9AD8\u901F\u30B3\u30F3\u30D9\u30A2', needs: { iron_i: 8, copper_i: 8 } },
  { from: 'smelter', to: 'autoCrafter', label: '\u81EA\u52D5\u5DE5\u623F', needs: { gold_i: 10, diamond_i: 4, mithril_i: 2 } },
];

export const AUTOCRAFT_RECIPES = [
  { id: 'wire', name: '\u5C0E\u7DDA\u30B3\u30A4\u30EB', time: 3.0, value: 95, inputs: { copper_i: 2, iron_i: 1 } },
  { id: 'board', name: '\u5236\u5FA1\u57FA\u677F', time: 4.2, value: 220, inputs: { copper_i: 2, silver_i: 1, gold_i: 1 } },
  { id: 'unit', name: '\u6398\u524A\u30E6\u30CB\u30C3\u30C8', time: 4.8, value: 320, inputs: { iron_i: 2, coal_o: 2, mithril_i: 1 } },
  { id: 'alloy', name: '\u9AD8\u5BC6\u5EA6\u5408\u91D1', time: 5.2, value: 460, inputs: { gold_i: 1, diamond_i: 1, ruby_i: 1 } },
];

export const AUTOCRAFT_USABLE = (() => {
  const s = new Set();
  for (const r of AUTOCRAFT_RECIPES) for (const k in r.inputs) s.add(k);
  return s;
})();

export const FILTER_CYCLE = ['any', 'coal', 'iron', 'copper', 'silver', 'gold', 'diamond', 'ruby', 'mithril'];
export const FILTER_ICON  = { any: '\u26AA', coal: '\u26AB', iron: '\u2699\uFE0F', copper: '\uD83D\uDFE0', silver: '\uD83E\uDD48', gold: '\u2728', diamond: '\uD83D\uDC8E', ruby: '\uD83D\uDD34', mithril: '\uD83D\uDFE2' };
export const FILTER_LABEL = { any: '\u6307\u5B9A\u306A\u3057', coal: '\u77F3\u70AD\u306E\u307F', iron: '\u9244\u306E\u307F', copper: '\u9284\u306E\u307F', silver: '\u9280\u306E\u307F', gold: '\u91D1\u306E\u307F', diamond: '\u30C0\u30A4\u30E4\u306E\u307F', ruby: '\u30EB\u30D3\u30FC\u306E\u307F', mithril: '\u30DF\u30B9\u30EA\u30EB\u306E\u307F' };

export const MILESTONES = [
  { at: 1000,   reward: 150,  label: '\u99C6\u3051\u51FA\u3057\u63A1\u6398\u8005' },
  { at: 3000,   reward: 300,  label: '\u898B\u7FD2\u3044\u5DE5\u5834\u9577' },
  { at: 8000,   reward: 600,  label: '\u4E00\u4EBA\u524D\u306E\u5DE5\u5834\u9577' },
  { at: 20000,  reward: 1500, label: '\u30D9\u30C6\u30E9\u30F3\u5DE5\u5834\u9577' },
  { at: 50000,  reward: 3000, label: '\u63A1\u6398\u738B' },
  { at: 120000, reward: 6000, label: '\u30C6\u30E9\u30D5\u30A9\u30FC\u30B8\u30FB\u30DE\u30B9\u30BF\u30FC' },
  { at: 300000, reward: 15000, label: '\u5927\u9678\u306E\u958B\u62D3\u738B' },
  { at: 800000, reward: 40000, label: '\u4F1D\u8AAC\u306E\u30C6\u30E9\u30D5\u30A9\u30FC\u30B8\u30E3\u30FC' },
];