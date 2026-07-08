/* =====================================================================
   TerraForge — トースト・お金・ステータス・モーダル (UI層)
   ---------------------------------------------------------------------
   Phase03: UI層は bus.on(...) でイベントを購読して DOM を更新する。
   ロジック層(machines/logistics/power 等)から document.* 参照を排除する
   ため、所持金表示・電力チップ・トースト・ステータスバーの全 DOM 操作を
   このファイルに集約する。
   toast() / setStatus() は引き続き関数として外部から呼び出せるが、
   内部で bus.emit(Events.TOAST_SHOW / Events.STATUS_CHANGED) を発火し、
   DOM 操作は購読ハンドラで行う(=ロジック層からの直接的 DOM 操作を廃止)。
   ===================================================================== */
import { state, gameState } from './state.js';
import { ORES, COSTS, MILESTONES, FILTER_CYCLE, FILTER_ICON, FILTER_LABEL, CHEST_UPGRADE_RULES, AUTOCRAFT_RECIPES, DIRS, DIR_ARROWS, POWER_USE, POWER_OUTPUT, POWER_RANGE, START_MONEY, LH, SAVE_KEY, SAVE_KEY_PREFIX, SAVE_SLOT_COUNT, SAVE_LEGACY_BACKUP_KEY } from './constants.js';
import { CHEST_CAPACITY } from './balance.js';
import { ctx } from './ctx.js';
import { getMuted, setMuted } from './audio.js';
import { key } from './world.js';
import { hasStock } from './logistics.js';
import { bus } from './core/EventBus.js';
import { Events } from './core/events.js';
import { powerGrid } from './power.js';
import { formatMoney } from './util/format.js';
import { Toolbar } from './ui/Toolbar.js';
import { SettingsModal } from './ui/SettingsModal.js';

/* ---------------- DOM 参照(全てこのファイル内に閉じ込める) ---------------- */
const moneyEl = document.getElementById('money-value');
const moneyChip = document.getElementById('money-display');
const statusEl = document.getElementById('status-strip');
const powerValueEl = document.getElementById('power-value');
const powerBoxEl = document.getElementById('power-display');
const toastArea = document.getElementById('toast-area');
const upgradeModal = document.getElementById('upgrade-modal');
const upgradeTreeList = document.getElementById('upgrade-tree-list');
const upgradeStockSummary = document.getElementById('upgrade-stock-summary');
const recipeModal = document.getElementById('recipe-modal');
const recipeList = document.getElementById('recipe-list');
const recipeTargetLabel = document.getElementById('recipe-target-label');
const muteBtn = document.getElementById('btn-mute');
const exportModal = document.getElementById('export-modal');
const exportPanelTitle = document.getElementById('export-panel-title');
const exportPanelDesc = document.getElementById('export-panel-desc');
const exportTextarea = document.getElementById('export-textarea');
const btnCopyExport = document.getElementById('btn-copy-export');
const btnConfirmImport = document.getElementById('btn-confirm-import');
const recoveryModal = document.getElementById('recovery-modal');

/* ---------------- トースト ---------------- */
/**
 * トースト表示を要求する(ロジック層から呼ばれる公開API)。
 * 実際の DOM 構築は bus.on(TOAST_SHOW) 購読ハンドラで行われる。
 */
export function toast(msg, kind) {
  if (kind === 'error') ctx.sfx('error');
  bus.emit(Events.TOAST_SHOW, { msg, kind });
}

/* ---------------- お金 ---------------- */
/**
 * 所持金を増減させる(ロジック層からの公開API)。
 * 内部は gameState.addMoney に移譲。money:changed はバス経由で
 * 表示へ伝播する。
 */
export function addMoney(v) {
  gameState.addMoney(v);
}

/**
 * 売上/報酬での所持金増加(ロジック層からの公開API)。
 * gameState.earn に移譲。money:earned / milestone:reached はバス経由で
 * 表示/演出へ伝播する。
 */
export function earn(v) {
  gameState.earn(v);
}

/* ---------------- ステータス ---------------- */
/**
 * ステータスバーの表示を切り替える(ロジック層からの公開API)。
 * 実際の DOM 更新は bus.on(STATUS_CHANGED) 購読ハンドラで行われる。
 */
export function setStatus(msg, kind) {
  bus.emit(Events.STATUS_CHANGED, { msg, kind });
}

export function toolCostText(t) {
  if (t === 'dig') return '無料';
  if (t === 'demolish') return '機械50%/コンベア90%返金';
  return COSTS[t] !== undefined ? formatMoney(COSTS[t]) : '';
}
export function baseStatusForTool(t) {
  if (t === 'dig') return '⛏️ 掘る: タイルを掘削 / 機械をタップで状態確認';
  if (t === 'fill') return '🧱 盛る: 掘った地面を1段戻す';
  if (t === 'demolish') return '🧨 撤去: 機械を撤去して返金(機械50% / コンベア90%)';
  if (t === 'filterConveyor') return '🎯 フィルター: 一致=正面 / 不一致=左右 / ' + FILTER_LABEL[state.selectedFilter];
  if (t === 'conveyor') return '➡️ コンベア: 近くの接続先へ自動接続 / ' + toolCostText(t);
  if (t === 'generator') return '⚡ 発電機: +' + POWER_OUTPUT.generator + '電力 / 供給範囲 ' + POWER_RANGE + 'マス / ' + toolCostText(t);
  if (t === 'autoCrafter') return '🏭 自動工房: 複数資源を自動合成して出荷 / ' + toolCostText(t);
  if (COSTS[t] !== undefined) return ctx.toolLabel(t) + ': ' + toolCostText(t) + ' / 向き ' + DIR_ARROWS[state.buildDir];
  return ctx.toolLabel(t);
}
export function updateStatus(msg, kind) {
  if (msg) { setStatus(msg, kind); return; }
  const ps = powerGrid.snapshot();
  if (!ps.ok || ps.outOfRange > 0) {
    setStatus('⚡ 電力状態: ' + ps.used + '/' + ps.capacity + ' (圏外 ' + ps.outOfRange + '台)。発電機の増設や配置調整で改善できます', 'error');
    return;
  }
  setStatus(baseStatusForTool(state.tool));
}
export function describeConnectionPreview(gx, gz) {
  if (state.tool !== 'conveyor' && state.tool !== 'filterConveyor') return null;
  if (state.machines.has(key(gx, gz))) return { msg: 'ここには既に機械があります', kind: 'error' };
  const dir = ctx.chooseAutoDir(gx, gz, state.buildDir);
  const nx = gx + DIRS[dir].x, nz = gz + DIRS[dir].z;
  if (!ctx.inGrid(nx, nz)) return { msg: '➡️ 接続先がマップ外です', kind: 'warn' };
  const target = state.machines.get(key(nx, nz));
  if (!target) return { msg: '➡️ 出力先なし。向き ' + DIR_ARROWS[dir] + ' で設置予定', kind: 'warn' };
  if (!ctx.heightOk(gx, gz, nx, nz)) return { msg: '➡️ 高低差が大きすぎて接続不可', kind: 'error' };
  if (!ctx.connectionOk(target, gx, gz)) return { msg: '➡️ ' + ctx.toolLabel(target.type) + ' はこの向きから受け取れません', kind: 'error' };
  const dh = Math.round((ctx.tileTopY(nx, nz) - ctx.tileTopY(gx, gz)) / LH);
  const slope = dh === 0 ? '' : (dh > 0 ? ' / 上り段差' : ' / 下り段差');
  return { msg: '➡️ ' + ctx.toolLabel(target.type) + 'へ接続予定 ' + DIR_ARROWS[dir] + slope, kind: 'good' };
}

export function formatNeedsText(needs) {
  return Object.entries(needs).map(([k, v]) => ctx.formatStockKey(k) + ' x' + v).join(' / ');
}
export function countMachineType(type) {
  let n = 0;
  for (const m of state.machines.values()) if (m.type === type) n++;
  return n;
}

/* ---------------- アップグレードモーダル ---------------- */
export function renderUpgradeTree() {
  if (!upgradeTreeList) return;
  const stock = ctx.getTotalChestStock();
  const stockText = Object.keys(stock).length
    ? Object.entries(stock).sort((a, b) => b[1] - a[1]).map(([k, v]) => ctx.formatStockKey(k) + ':' + v).join(' / ')
    : '素材なし';
  if (upgradeStockSummary) upgradeStockSummary.textContent = 'チェスト合計素材: ' + stockText;
  upgradeTreeList.innerHTML = '';
  CHEST_UPGRADE_RULES.forEach(rule => {
    const card = document.createElement('div');
    card.className = 'upgrade-card';
    const own = ctx.countMachineType(rule.from);
    card.innerHTML = '<h3>' + ctx.toolLabel(rule.from) + ' → ' + ctx.toolLabel(rule.to) + '</h3>'
      + '<p>必要素材: ' + formatNeedsText(rule.needs) + '</p>'
      + '<p>対象台数: ' + own + '台</p>';
    const btn = document.createElement('button');
    btn.textContent = 'この系統を一括アップグレード';
    btn.disabled = own === 0 || !hasStock(stock, rule.needs);
    btn.addEventListener('click', () => {
      if (ctx.applyGlobalUpgrade(rule)) renderUpgradeTree();
    });
    card.appendChild(btn);
    upgradeTreeList.appendChild(card);
  });
}
export function openUpgradeModal() {
  renderUpgradeTree();
  if (upgradeModal) upgradeModal.classList.remove('hidden');
}
export function closeUpgradeModal() {
  if (upgradeModal) upgradeModal.classList.add('hidden');
}

/* ヘルプモーダル表示切替(ロジック層から document 参照を排除するため公開API化) */
export function showHelpModal() {
  const el = document.getElementById('help-modal');
  if (el) el.classList.remove('hidden');
}
export function hideHelpModal() {
  const el = document.getElementById('help-modal');
  if (el) el.classList.add('hidden');
}

/* ---------------- レシピモーダル ---------------- */
let recipeTargetMachine = null;
export function setAutoCrafterRecipe(m, recipeId) {
  if (!m || m.type !== 'autoCrafter') return;
  m.selectedRecipeId = recipeId;
  m.craftRecipe = null;
  m.craftProgress = 0;
  const label = recipeId === 'auto' ? '自動選択' : (AUTOCRAFT_RECIPES.find(r => r.id === recipeId)?.name || recipeId);
  ctx.toast('🏭 レシピ設定: ' + label, 'good');
}
function renderRecipeModal() {
  if (!recipeTargetMachine || !recipeList) return;
  const m = recipeTargetMachine;
  const current = m.selectedRecipeId || 'auto';
  if (recipeTargetLabel) recipeTargetLabel.textContent = '対象: (' + m.gx + ',' + m.gz + ') の自動工房';
  recipeList.innerHTML = '';
  const allOptions = [{ id: 'auto', name: '自動選択', time: 0, value: 0, inputs: {} }, ...AUTOCRAFT_RECIPES];
  allOptions.forEach(recipe => {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    const needs = Object.keys(recipe.inputs).length ? formatNeedsText(recipe.inputs) : '在庫に応じて自動選択';
    card.innerHTML = '<h3>' + recipe.name + '</h3><p>必要素材: ' + needs + '</p>'
      + (recipe.id === 'auto' ? '' : '<p>加工時間: ' + recipe.time + '秒 / 売価: ' + formatMoney(recipe.value) + '</p>');
    const btn = document.createElement('button');
    btn.textContent = recipe.id === current ? '選択中' : 'このレシピに設定';
    if (recipe.id === current) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      setAutoCrafterRecipe(m, recipe.id);
      renderRecipeModal();
    });
    card.appendChild(btn);
    recipeList.appendChild(card);
  });
}
export function openRecipeModal(m) {
  recipeTargetMachine = m;
  renderRecipeModal();
  if (recipeModal) recipeModal.classList.remove('hidden');
}
export function closeRecipeModal() {
  recipeTargetMachine = null;
  if (recipeModal) recipeModal.classList.add('hidden');
}

/* ---------------- ツールバー (Phase07: 動的生成) ---------------- */
let toolbar = null;
const toolbarRoot = document.getElementById('toolbar');
if (toolbarRoot) {
  toolbar = new Toolbar(toolbarRoot);
}
export function syncToolbarToCurrentTool() { if (toolbar) toolbar.syncToCurrentTool(); }

/* HUDボタン */
document.getElementById('btn-scan').addEventListener('click', () => state.scanTimer > 0 ? ctx.clearScan() : ctx.doScan());
document.getElementById('btn-save').addEventListener('click', () => { ctx.saveGame(); ctx.toast('💾 セーブしました', 'good'); });
document.getElementById('btn-upgrade').addEventListener('click', () => { ctx.sfx('click'); openUpgradeModal(); });
document.getElementById('btn-help').addEventListener('click', () => document.getElementById('help-modal').classList.remove('hidden'));

/* 設定モーダル(Phase07) */
let settingsModal = null;
const settingsModalRoot = document.getElementById('settings-modal');
if (settingsModalRoot) {
  settingsModal = new SettingsModal(settingsModalRoot);
}
const btnSettings = document.getElementById('btn-settings');
if (btnSettings) {
  btnSettings.addEventListener('click', () => {
    ctx.sfx('click');
    if (settingsModal) settingsModal.open();
  });
}
export function applySettingsFromLoad() { if (settingsModal) settingsModal.apply(); }

/* 効果音ミュート切替(設定は保存される) */
export function updateMuteIcon() {
  if (!muteBtn) return;
  muteBtn.innerHTML = '<i class="fa-solid ' + (getMuted() ? 'fa-volume-xmark' : 'fa-volume-high') + '"></i>';
}
if (muteBtn) {
  muteBtn.addEventListener('click', () => {
    setMuted(!getMuted());
    updateMuteIcon();
    if (!getMuted()) ctx.sfx('click');
    ctx.toast(getMuted() ? '🔇 効果音 OFF' : '🔊 効果音 ON');
  });
}
updateMuteIcon();
document.getElementById('btn-close-help').addEventListener('click', () => document.getElementById('help-modal').classList.add('hidden'));
document.getElementById('btn-close-upgrade').addEventListener('click', closeUpgradeModal);
document.getElementById('btn-close-recipe').addEventListener('click', closeRecipeModal);
if (upgradeModal) upgradeModal.addEventListener('click', e => { if (e.target === upgradeModal) closeUpgradeModal(); });
if (recipeModal) recipeModal.addEventListener('click', e => { if (e.target === recipeModal) closeRecipeModal(); });
document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('本当に全データをリセットしますか?')) {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(SAVE_LEGACY_BACKUP_KEY);
    for (let slot = 0; slot < SAVE_SLOT_COUNT; slot++) localStorage.removeItem(SAVE_KEY_PREFIX + slot);
    location.reload();
  }
});

/* ---------------- エクスポート/インポート・パネル (Phase06) ---------------- */
function openExportPanel(mode) {
  if (!exportModal) return;
  if (mode === 'export') {
    exportPanelTitle.textContent = '📤 エクスポート';
    exportPanelDesc.textContent = '下のテキストをコピーして保存してください。';
    exportTextarea.value = ctx.exportSave() || '';
    exportTextarea.readOnly = true;
    btnCopyExport.classList.remove('hidden');
    btnConfirmImport.classList.add('hidden');
  } else {
    exportPanelTitle.textContent = '📥 インポート';
    exportPanelDesc.textContent = 'エクスポートしたテキストを貼り付けてください。';
    exportTextarea.value = '';
    exportTextarea.readOnly = false;
    btnCopyExport.classList.add('hidden');
    btnConfirmImport.classList.remove('hidden');
  }
  exportModal.classList.remove('hidden');
}
function closeExportPanel() {
  if (exportModal) exportModal.classList.add('hidden');
}
const btnExportSave = document.getElementById('btn-export-save');
const btnImportSave = document.getElementById('btn-import-save');
const btnCloseExport = document.getElementById('btn-close-export');
if (btnExportSave) btnExportSave.addEventListener('click', () => openExportPanel('export'));
if (btnImportSave) btnImportSave.addEventListener('click', () => openExportPanel('import'));
if (btnCloseExport) btnCloseExport.addEventListener('click', closeExportPanel);
if (exportModal) exportModal.addEventListener('click', e => { if (e.target === exportModal) closeExportPanel(); });
if (btnCopyExport) btnCopyExport.addEventListener('click', () => {
  exportTextarea.select();
  navigator.clipboard?.writeText(exportTextarea.value).then(() => {
    toast('📋 クリップボードにコピーしました', 'good');
  }).catch(() => {
    document.execCommand('copy');
    toast('📋 コピーしました', 'good');
  });
});
if (btnConfirmImport) btnConfirmImport.addEventListener('click', () => {
  const str = exportTextarea.value.trim();
  if (!str) { toast('インポートするテキストを貼り付けてください', 'error'); return; }
  if (!confirm('現在のセーブデータを上書きします。よろしいですか?')) return;
  const ok = ctx.importSave(str);
  if (ok) {
    toast('📥 インポートしました。再読み込みします', 'good');
    closeExportPanel();
    setTimeout(() => location.reload(), 500);
  } else {
    toast('❌ インポートに失敗しました(形式が不正です)', 'error');
  }
});

/* ---------------- 破損セーブ・リカバリモーダル (Phase06) ---------------- */
function closeRecoveryModal() {
  if (recoveryModal) recoveryModal.classList.add('hidden');
}
const btnRecoveryBackup = document.getElementById('btn-recovery-backup');
const btnRecoveryNew = document.getElementById('btn-recovery-new');
const btnRecoveryExport = document.getElementById('btn-recovery-export');
if (btnRecoveryBackup) btnRecoveryBackup.addEventListener('click', () => {
  try {
    const backup = localStorage.getItem(SAVE_LEGACY_BACKUP_KEY);
    if (!backup) { toast('バックアップが見つかりません', 'error'); return; }
    localStorage.setItem(SAVE_KEY, backup);
    toast('🗄️ バックアップから復元しました。再読み込みします', 'good');
    closeRecoveryModal();
    setTimeout(() => location.reload(), 500);
  } catch (e) {
    toast('復元に失敗しました', 'error');
  }
});
if (btnRecoveryNew) btnRecoveryNew.addEventListener('click', () => {
  if (!confirm('新規開始しますか?破損したセーブデータは削除されます')) return;
  for (let slot = 0; slot < SAVE_SLOT_COUNT; slot++) localStorage.removeItem(SAVE_KEY_PREFIX + slot);
  localStorage.removeItem(SAVE_KEY);
  closeRecoveryModal();
  setTimeout(() => location.reload(), 200);
});
if (btnRecoveryExport) btnRecoveryExport.addEventListener('click', () => {
  closeRecoveryModal();
  openExportPanel('export');
});
bus.on(Events.SAVE_CORRUPTED, () => {
  if (recoveryModal) recoveryModal.classList.remove('hidden');
});

/* =====================================================================
   bus 購読: ここから下はロジック層からのイベントを受けて DOM を更新する
   ===================================================================== */

/* ---- トースト ---- */
bus.on(Events.TOAST_SHOW, ({ msg, kind }) => {
  if (!toastArea) return;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  toastArea.appendChild(el);
  while (toastArea.children.length > 3) toastArea.removeChild(toastArea.firstChild);
  setTimeout(() => el.remove(), 2800);
});

/* ---- 所持金表示 ---- */
export function refreshMoneyDisplay() {
  if (moneyEl) moneyEl.textContent = formatMoney(gameState.money);
}
bus.on(Events.MONEY_CHANGED, ({ total }) => {
  if (moneyEl) moneyEl.textContent = formatMoney(total);
  // 増減アニメーションは money:earned でも発火するので、ここでは最小限
});
bus.on(Events.MONEY_EARNED, ({ amount }) => {
  if (amount > 0 && moneyEl && moneyEl.parentElement) {
    moneyEl.parentElement.style.transform = 'scale(1.12)';
    setTimeout(() => { if (moneyEl.parentElement) moneyEl.parentElement.style.transform = ''; }, 120);
  }
  // 累計収益チップの title を更新(旧 earn() の副作用を再現)
  if (moneyChip) moneyChip.title = '累計収益: ' + formatMoney(gameState.stats.earned);
});

/* ---- ステータスバー ---- */
bus.on(Events.STATUS_CHANGED, ({ msg, kind }) => {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = kind || '';
});

/* ---- 電力チップ ---- */
bus.on(Events.POWER_CHANGED, ({ used, capacity, ok, outOfRange }) => {
  if (powerValueEl) powerValueEl.textContent = used + '/' + capacity;
  if (powerBoxEl) {
    powerBoxEl.classList.toggle('power-low', !ok || (outOfRange || 0) > 0);
    powerBoxEl.title = (!ok || (outOfRange || 0) > 0)
      ? ('電力不足/圏外: 使用' + used + ' / 発電' + capacity + ' / 圏外機械' + (outOfRange || 0) + '台')
      : ('電力: 使用量 / 発電量 (供給範囲 ' + POWER_RANGE + 'マス)');
  }
});

/* ---- マイルストーン到達 ---- */
bus.on(Events.MILESTONE_REACHED, ({ milestone }) => {
  ctx.sfx('milestone');
  ctx.toast('🏆 実績「' + milestone.label + '」達成! ボーナス ' + formatMoney(milestone.reward), 'good');
});

/* ---- スキャン切替(particles.js からのイベントでボタン活性状態を更新) ---- */
bus.on(Events.SCAN_TOGGLED, ({ active }) => {
  const btn = document.getElementById('btn-scan');
  if (!btn) return;
  btn.classList.toggle('active', !!active);
});

/* =====================================================================
   実績(マイルストーン)の直接呼び出し用エントリポイント
   ---------------------------------------------------------------------
   checkMilestones は gameState.earn 内で自動発火するため、通常は外部から
   呼ぶ必要はない。後方互換のため残す(ui.js を介さず main.js から呼ばれる
   旧経路のフェールセーフ)。
   ===================================================================== */
export function checkMilestones() {
  gameState.checkMilestones();
}


