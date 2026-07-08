/* =====================================================================
   TerraForge — 動的ツールバー (Phase07: カテゴリタブ + 動的生成)
   ---------------------------------------------------------------------
   MACHINE_DEFS の category フィールド(mining/logistics/processing/power)と
   TOOL_DEFS(tools擬似定義) からツールバーを動的生成する。
   構造: 上段=カテゴリタブ、下段=選択カテゴリのボタン群。
   選択中ツール・カテゴリは gameState.ui に保持し、既存 tool 変数と同期する。
   data-tool 属性によるイベント委譲(input.js)を維持するため、
   機械ボタンは data-tool="<type>"、ツール系は既存の id を踏襲。
   ===================================================================== */
import { state, gameState } from '../state.js';
import { MACHINE_DEFS, TOOL_DEFS, CATEGORY_DEFS } from '../machineDefs.js';
import { DIRS, DIR_ARROWS, FILTER_CYCLE, FILTER_ICON, FILTER_LABEL, COSTS } from '../constants.js';
import { ctx } from '../ctx.js';
import { formatMoney } from '../util/format.js';

/** 機械の costText を生成(省略表記設定を反映) */
function machineCostText(type) {
  const def = MACHINE_DEFS[type];
  if (!def || def.cost === undefined) return '';
  return formatMoney(def.cost);
}

export class Toolbar {
  constructor(rootEl) {
    this.root = rootEl;
    if (!this.root) return;
    // クラスを付与して2段レイアウト用のコンテナ構造を構築
    this.root.innerHTML = '';
    this.tabRow = document.createElement('div');
    this.tabRow.className = 'toolbar-tabs';
    this.btnRow = document.createElement('div');
    this.btnRow.className = 'toolbar-buttons';
    this.root.appendChild(this.tabRow);
    this.root.appendChild(this.btnRow);

    this._selectedCategory = gameState.ui.selectedCategory || 'mining';
    this._buildTabs();
    this.render();
    this._bindEvents();
  }

  /** 各カテゴリタブを構築 */
  _buildTabs() {
    this.tabRow.innerHTML = '';
    for (const cat of CATEGORY_DEFS) {
      const tab = document.createElement('button');
      tab.className = 'toolbar-tab';
      tab.dataset.category = cat.id;
      tab.textContent = cat.label;
      if (cat.id === this._selectedCategory) tab.classList.add('selected');
      tab.addEventListener('click', () => this.selectCategory(cat.id));
      this.tabRow.appendChild(tab);
    }
  }

  /** カテゴリを選択し、ボタン群を再描画 */
  selectCategory(catId) {
    if (this._selectedCategory === catId) return;
    this._selectedCategory = catId;
    gameState.ui.selectedCategory = catId;
    // タブの selected を更新
    this.tabRow.querySelectorAll('.toolbar-tab').forEach(t => {
      t.classList.toggle('selected', t.dataset.category === catId);
    });
    this.render();
    if (ctx.sfx) ctx.sfx('click');
  }

  /** 選択カテゴリ内のボタン群を描画 */
  render() {
    if (!this.btnRow) return;
    this.btnRow.innerHTML = '';
    const cat = this._selectedCategory;

    // ツール系(tools)ボタン
    if (cat === 'tools') {
      for (const t of TOOL_DEFS) this._appendToolButton(t);
      return;
    }
    // 機械系ボタン: category に合致する MACHINE_DEFS を列挙
    for (const id in MACHINE_DEFS) {
      const def = MACHINE_DEFS[id];
      if (def.category !== cat) continue;
      this._appendMachineButton(def);
    }
  }

  _appendMachineButton(def) {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.dataset.tool = def.id;
    if (state.tool === def.id) btn.classList.add('selected');
    btn.innerHTML =
      '<span class="tool-icon">' + (def.icon || '') + '</span>' +
      '<span class="tool-name">' + def.label + '</span>' +
      '<span class="tool-cost">' + machineCostText(def.id) + '</span>';
    btn.addEventListener('click', () => this.selectTool(def.id));
    this.btnRow.appendChild(btn);
  }

  _appendToolButton(t) {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    if (t.isRotate) {
      btn.id = 'btn-rotate';
      btn.innerHTML =
        '<span class="tool-icon" id="rotate-arrow">' + DIR_ARROWS[state.buildDir] + '</span>' +
        '<span class="tool-name">' + t.label + '</span>' +
        '<span class="tool-cost">' + t.costText + '</span>';
      btn.addEventListener('click', () => this._onRotate());
    } else if (t.isFilter) {
      btn.id = 'btn-filter-cycle';
      btn.title = 'フィルターコンベアの対象鉱石を切替';
      btn.innerHTML =
        '<span class="tool-icon" id="filter-icon">' + FILTER_ICON[state.selectedFilter] + '</span>' +
        '<span class="tool-name">' + t.label + '</span>' +
        '<span class="tool-cost" id="filter-label">' + FILTER_LABEL[state.selectedFilter] + '</span>';
      btn.addEventListener('click', () => this._onFilterCycle());
    } else {
      btn.dataset.tool = t.id;
      if (state.tool === t.id) btn.classList.add('selected');
      btn.innerHTML =
        '<span class="tool-icon">' + t.icon + '</span>' +
        '<span class="tool-name">' + t.label + '</span>' +
        '<span class="tool-cost">' + t.costText + '</span>';
      btn.addEventListener('click', () => this.selectTool(t.id));
    }
    this.btnRow.appendChild(btn);
  }

  /** 機械/掘る/盛る/撤去ツールを選択(既存 tool 変数と同期) */
  selectTool(toolId) {
    state.tool = toolId;
    // 全ボタン(カテゴリ跨ぎ)の selected を更新
    this.root.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
      b.classList.toggle('selected', b.dataset.tool === toolId);
    });
    if (ctx.updateStatus) ctx.updateStatus();
    if (ctx.sfx) ctx.sfx('click');
  }

  _onRotate() {
    if (ctx.sfx) ctx.sfx('click');
    state.buildDir = (state.buildDir + 1) % 4;
    const arrow = document.getElementById('rotate-arrow');
    if (arrow) arrow.textContent = DIR_ARROWS[state.buildDir];
    if (ctx.updateStatus) ctx.updateStatus();
    if (ctx.toast) ctx.toast('設置向き: ' + DIR_ARROWS[state.buildDir]);
  }

  _onFilterCycle() {
    if (ctx.sfx) ctx.sfx('click');
    const idx = FILTER_CYCLE.indexOf(state.selectedFilter);
    state.selectedFilter = FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length];
    const icon = document.getElementById('filter-icon');
    const label = document.getElementById('filter-label');
    if (icon) icon.textContent = FILTER_ICON[state.selectedFilter];
    if (label) label.textContent = FILTER_LABEL[state.selectedFilter];
    if (ctx.updateStatus) ctx.updateStatus();
    if (ctx.toast) ctx.toast('設置フィルター: ' + FILTER_LABEL[state.selectedFilter]);
  }

  _bindEvents() {
    // 外部(ロード復元等)から tool が変わった際に selected を同期できるよう
    // bus 経由でも更新可能にする。ここでは最小限の委譲のみ保持。
  }

  /** 現在選択中のツールが表示中カテゴリに無い場合、そのツールのカテゴリへ切替 */
  syncToCurrentTool() {
    const t = state.tool;
    if (!t) return;
    // 機械系
    const def = MACHINE_DEFS[t];
    if (def) {
      if (this._selectedCategory !== def.category) {
        this.selectCategory(def.category);
      }
      this.root.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
        b.classList.toggle('selected', b.dataset.tool === t);
      });
      return;
    }
    // tools 系(dig/fill/demolish)
    if (TOOL_DEFS.some(td => td.id === t)) {
      if (this._selectedCategory !== 'tools') this.selectCategory('tools');
      this.root.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
        b.classList.toggle('selected', b.dataset.tool === t);
      });
    }
  }
}
