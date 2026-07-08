/* =====================================================================
   TerraForge — イベント名定数
   ---------------------------------------------------------------------
   文字列リテラル散在を防ぐため、全イベント名をここに集約する。
   Phase06(セーブ), Phase10(アンドゥ), Phase15(時間制御),
   Phase31(プレステージ) でもこの一覧を拡張して利用する。
   ===================================================================== */
export const Events = {
  /** 所持金が変化した(表示更新用)。値が変わった時のみ発火 */
  MONEY_CHANGED:    'money:changed',
  /** 売上/報酬で所持金が増えた。{amount, total} */
  MONEY_EARNED:     'money:earned',
  /** 電力状態が更新された。{used, capacity, ok, outOfRange} */
  POWER_CHANGED:    'power:changed',
  /** 機械が設置された。{type, gx, gz, dir, machine} */
  MACHINE_PLACED:   'machine:placed',
  /** 機械が撤去された。{type, gx, gz, refund} */
  MACHINE_REMOVED:  'machine:removed',
  /** 機械が回転された。{gx, gz, dir, machine} */
  MACHINE_ROTATED:  'machine:rotated',
  /** 機械が移動された。{fromX, fromZ, toX, toZ, machine} */
  MACHINE_MOVED:    'machine:moved',
  /** 販売機でアイテムが売却された。{oreType, ingot, value, gx, gz} */
  ITEM_SOLD:        'item:sold',
  /** 累計収益がマイルストーン閾値を超えた。{milestone, index, reward} */
  MILESTONE_REACHED:'milestone:reached',
  /** トースト通知要求。{msg, kind} */
  TOAST_SHOW:       'toast:show',
  /** ステータスバー表示切替。{msg, kind} */
  STATUS_CHANGED:   'status:changed',
  /** タイルが掘削された。{gx, gz, depth, ore} */
  TILE_DUG:         'tile:dug',
  /** タイルが盛土で戻された。{gx, gz, depth} */
  TILE_FILLED:      'tile:filled',
  /** スキャン状態が切り替わった。{active} (btn-scan のクラス切替用) */
  SCAN_TOGGLED:     'scan:toggled',
  /** セーブデータが破損していてロードできなかった。{slot, raw} */
  SAVE_CORRUPTED:   'save:corrupted',
  /** Phase10: アンドゥ/リドゥ履歴スタックの状態が変化した。{canUndo, canRedo} */
  HISTORY_CHANGED:  'history:changed',
};
