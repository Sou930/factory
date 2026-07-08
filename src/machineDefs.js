/* =====================================================================
   TerraForge — 機械定義レジストリ
   ===================================================================== */
import { ORES, DIRS, AUTOCRAFT_RECIPES, COSTS, AUTOCRAFT_USABLE } from './constants.js';
import { DRILL_INTERVAL, DRILL2_INTERVAL, SMELT_TIME, CONVEYOR_SPEED, FAST_SPEED, SMELTER_QUEUE_MAX, CRAFTER_STOCK_PER_KIND, CRAFTER_STOCK_TOTAL, MERGER_QUEUE_MAX, CHEST_CAPACITY, CHEST_EJECT_INTERVAL } from './balance.js';
import { ctx } from './ctx.js';
import { state } from './state.js';
import { stockTotal, chestTotal, hasStock, consumeStock } from './logistics.js';
import { powerGrid } from './power.js';
import { formatMoney } from './util/format.js';

/* =====================================================================
   TerraForge — カテゴリ定義 (Phase07: ツールバー動的生成用)
   ---------------------------------------------------------------------
   Phase07 でツールバーを2段化。機械は category フィールドで
   mining/logistics/processing/power/tools に分類される。
   「掘る/盛る/撤去/向き/品目」は機械ではないため TOOL_DEFS の擬似定義として
   扱い、tools カテゴリに属させる。
   ===================================================================== */
export const CATEGORY_DEFS = [
  { id: 'mining',     label: '⛏️ 採掘' },
  { id: 'logistics',  label: '➡️ 物流' },
  { id: 'processing', label: '🏭 加工' },
  { id: 'power',      label: '⚡ 電力' },
  { id: 'tools',      label: '🔧 ツール' },
];

/**
 * 機械ではないツール(掘る/盛る/撤去/向き/品目)の擬似定義。
 * Toolbar.js がこれを含めてボタンを動的生成する。
 * data-tool 属性値 = id。input.js のイベント委譲(data-tool)を維持。
 */
export const TOOL_DEFS = [
  { id: 'dig',          label: '掘る',   icon: '⛏️', category: 'tools', costText: '無料' },
  { id: 'fill',         label: '盛る',   icon: '🧱', category: 'tools', costText: '無料' },
  { id: 'demolish',     label: '撤去',   icon: '🧨', category: 'tools', costText: '機械50%/コンベア90%返金' },
  { id: 'rotate',       label: '向き',   icon: '→',  category: 'tools', costText: '回転', isRotate: true },
  { id: 'filterCycle',  label: '品目',   icon: '⚪', category: 'tools', costText: '指定なし', isFilter: true },
];

export const MACHINE_DEFS = {
  drill: {
    id: 'drill', label: 'ドリル', icon: '🛠️', category: 'mining',
    cost: COSTS.drill, powerUse: 2, refundRate: 0.5,
    canPlace(gx, gz) { const t = state.tiles[gx][gz]; return !!(t.ore && ORES[t.ore.type].depth === t.depth); },
    canAcceptItem() { return false; },
    update(m, dt) {
      if (!powerGrid.isPowered(m)) { const warnLight = m.mesh.userData.warnLight; if (warnLight) warnLight.material.emissiveIntensity = 1.1; return; }
      const bit = m.mesh.getObjectByName('bit');
      const piston = m.mesh.userData.piston;
      const warnLight = m.mesh.userData.warnLight;
      const t = state.tiles[m.gx][m.gz];
      const hasOre = t.ore && ORES[t.ore.type].depth === t.depth;
      if (hasOre) {
        const speedMul = m.type === 'drill2' ? 1.5 : 1;
        const bob = Math.sin(state.time * 6 * speedMul);
        if (bit) { bit.rotation.y += dt * 9 * speedMul; bit.position.y = 0.42 + bob * 0.07; }
        if (piston) piston.scale.y = 1 + bob * 0.12;
        if (warnLight) warnLight.material.emissiveIntensity = 0.4 + Math.sin(state.time * 5 * speedMul) * 0.35;
        const halo = m.mesh.userData.halo;
        if (halo) halo.rotation.z += dt * 2.6;
        // 掘削中の土煙パーティクル(採掘ビットの位置から時々発生)
        m.mesh.userData.dustTimer = (m.mesh.userData.dustTimer || 0) + dt;
        if (m.mesh.userData.dustTimer > 0.35) {
          m.mesh.userData.dustTimer = 0;
          ctx.spawnParticle('dust', new THREE.Vector3(ctx.worldX(m.gx), ctx.tileTopY(m.gx, m.gz) + 0.15, ctx.worldZ(m.gz)), { life: 0.6, scale: 0.35, vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.6, (Math.random() - 0.5) * 0.6) });
        }
        m.timer += dt;
        const interval = m.type === 'drill2' ? DRILL2_INTERVAL : DRILL_INTERVAL;
        if (m.timer >= interval) {
          const outKey = ctx.key(m.gx + DIRS[m.dir].x, m.gz + DIRS[m.dir].z);
          const target = state.machines.get(outKey);
          const dummy = { oreType: t.ore.type, ingot: false };
          if (ctx.canAccept(target, dummy, m.gx, m.gz)) {
            m.timer = 0;
            const it = ctx.spawnItem(t.ore.type, false, m.gx, m.gz);
            it.pos.y += 0.35;

            ctx.sendItemTo(it, target);
            ctx.spawnParticle('dust', new THREE.Vector3(ctx.worldX(m.gx), ctx.tileTopY(m.gx, m.gz) + 0.3, ctx.worldZ(m.gz)), { life: 0.7, scale: 0.45 });
          }
        }
      } else if (warnLight) warnLight.material.emissiveIntensity *= 0.9;
    },
    serialize() {}, deserialize() {},
  },

  drill2: {
    id: 'drill2', label: 'ドリルMk2', icon: '🛠️', category: 'mining',
    cost: COSTS.drill2, powerUse: 3, refundRate: 0.5,
    canPlace(gx, gz) { const t = state.tiles[gx][gz]; return !!(t.ore && ORES[t.ore.type].depth === t.depth); },
    canAcceptItem() { return false; },
    // drill2 reuses the drill update logic above with drill2-specific speedMul
    update(m, dt) {
      if (!powerGrid.isPowered(m)) { const warnLight = m.mesh.userData.warnLight; if (warnLight) warnLight.material.emissiveIntensity = 1.1; return; }
      const bit = m.mesh.getObjectByName('bit');
      const piston = m.mesh.userData.piston;
      const warnLight = m.mesh.userData.warnLight;
      const t = state.tiles[m.gx][m.gz];
      const hasOre = t.ore && ORES[t.ore.type].depth === t.depth;
      if (hasOre) {
        const speedMul = 1.5;
        const bob = Math.sin(state.time * 6 * speedMul);
        if (bit) { bit.rotation.y += dt * 9 * speedMul; bit.position.y = 0.42 + bob * 0.07; }
        if (piston) piston.scale.y = 1 + bob * 0.12;
        if (warnLight) warnLight.material.emissiveIntensity = 0.4 + Math.sin(state.time * 5 * speedMul) * 0.35;
        const halo = m.mesh.userData.halo;
        if (halo) halo.rotation.z += dt * 2.6;
        // 掘削中の土煙パーティクル(採掘ビットの位置から時々発生)
        m.mesh.userData.dustTimer = (m.mesh.userData.dustTimer || 0) + dt;
        if (m.mesh.userData.dustTimer > 0.35) {
          m.mesh.userData.dustTimer = 0;
          ctx.spawnParticle('dust', new THREE.Vector3(ctx.worldX(m.gx), ctx.tileTopY(m.gx, m.gz) + 0.15, ctx.worldZ(m.gz)), { life: 0.6, scale: 0.35, vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.6, (Math.random() - 0.5) * 0.6) });
        }
        m.timer += dt;
        const interval = DRILL2_INTERVAL;
        if (m.timer >= interval) {
          const outKey = ctx.key(m.gx + DIRS[m.dir].x, m.gz + DIRS[m.dir].z);
          const target = state.machines.get(outKey);
          const dummy = { oreType: t.ore.type, ingot: false };
          if (ctx.canAccept(target, dummy, m.gx, m.gz)) {
            m.timer = 0;
            const it = ctx.spawnItem(t.ore.type, false, m.gx, m.gz);
            it.pos.y += 0.35;

            ctx.sendItemTo(it, target);
            ctx.spawnParticle('dust', new THREE.Vector3(ctx.worldX(m.gx), ctx.tileTopY(m.gx, m.gz) + 0.3, ctx.worldZ(m.gz)), { life: 0.7, scale: 0.45 });
          }
        }
      } else if (warnLight) warnLight.material.emissiveIntensity *= 0.9;
    },
    serialize() {}, deserialize() {},
  },

  conveyor: {
    id: 'conveyor', label: 'コンベア', icon: '➡️', category: 'logistics',
    cost: COSTS.conveyor, powerUse: 0, refundRate: 0.9,
    canPlace() { return true; },
    canAcceptItem(m) { return !m.item; },
    update(m, dt) {
      // ベルト矢印アニメ(直線: 入口→出口 / カーブ: 入口→中心、中心→出口 と流れる)
      const cyc = (state.time * 1.1) % 1;
      const shape = m.mesh.userData.beltShape || 'straight';
      const aOut = m.mesh.getObjectByName('arrowOut');
      const aIn  = m.mesh.getObjectByName('arrowIn');
      if (aOut) aOut.position.x = 0.05 + cyc * 0.8;
      if (aIn) {
        if (shape === 'straight') {
          aIn.position.x = -0.85 + cyc * 0.8;
        } else {
          const zSign = shape === 'left' ? 1 : -1;
          aIn.position.z = zSign * (0.85 - cyc * 0.8);
        }
      }
      // ローラー回転アニメ(ベルトが実際に動いているように見せる)
      const rollers = m.mesh.userData.rollers;
      const rollSpeed = 6;
      if (rollers) for (const r of rollers) {
        if (r.userData.spinAxis === 'z') r.rotation.z += dt * rollSpeed; else r.rotation.x += dt * rollSpeed;
      }
      // 滞留アイテムを次へ。フィルターは一致=正面、不一致=左右へ交互に振り分ける
      if (m.item && !m.item.moving && m.item.gx === m.gx && m.item.gz === m.gz) {
        const outDirs = [m.dir];
        const start = 0;
        for (let n = 0; n < outDirs.length; n++) {
          const idx = (start + n) % outDirs.length;
          const d = outDirs[idx];
          const nk = ctx.key(m.gx + DIRS[d].x, m.gz + DIRS[d].z);
          const next = state.machines.get(nk);
          if (ctx.canAccept(next, m.item, m.gx, m.gz)) {
            const it = m.item;
            m.item = null;
            ctx.sendItemTo(it, next, CONVEYOR_SPEED);
            break;
          }
        }
      }
    },
    serialize() {}, deserialize() {},
  },

  fastConveyor: {
    id: 'fastConveyor', label: '高速コンベア', icon: '⚡', category: 'logistics',
    cost: COSTS.fastConveyor, powerUse: 0, refundRate: 0.9,
    canPlace() { return true; },
    canAcceptItem(m) { return !m.item; },
    update(m, dt) {
      const cyc = (state.time * 1.1) % 1;
      const shape = m.mesh.userData.beltShape || 'straight';
      const aOut = m.mesh.getObjectByName('arrowOut');
      const aIn  = m.mesh.getObjectByName('arrowIn');
      if (aOut) aOut.position.x = 0.05 + cyc * 0.8;
      if (aIn) {
        if (shape === 'straight') {
          aIn.position.x = -0.85 + cyc * 0.8;
        } else {
          const zSign = shape === 'left' ? 1 : -1;
          aIn.position.z = zSign * (0.85 - cyc * 0.8);
        }
      }
      const rollers = m.mesh.userData.rollers;
      const rollSpeed = 11;
      if (rollers) for (const r of rollers) {
        if (r.userData.spinAxis === 'z') r.rotation.z += dt * rollSpeed; else r.rotation.x += dt * rollSpeed;
      }
      const gem = m.mesh.getObjectByName('filterGem');
      if (gem) gem.rotation.y += dt * 1.4;
      if (m.item && !m.item.moving && m.item.gx === m.gx && m.item.gz === m.gz) {
        const outDirs = [m.dir];
        const start = 0;
        for (let n = 0; n < outDirs.length; n++) {
          const idx = (start + n) % outDirs.length;
          const d = outDirs[idx];
          const nk = ctx.key(m.gx + DIRS[d].x, m.gz + DIRS[d].z);
          const next = state.machines.get(nk);
          if (ctx.canAccept(next, m.item, m.gx, m.gz)) {
            const it = m.item;
            m.item = null;
            ctx.sendItemTo(it, next, FAST_SPEED);
            break;
          }
        }
      }
    },
    serialize() {}, deserialize() {},
  },

  filterConveyor: {
    id: 'filterConveyor', label: 'フィルターコンベア', icon: '🎯', category: 'logistics',
    cost: COSTS.filterConveyor, powerUse: 0, refundRate: 0.9,
    canPlace() { return true; },
    canAcceptItem(m) { return !m.item; },
    update(m, dt) {
      const cyc = (state.time * 1.1) % 1;
      const shape = m.mesh.userData.beltShape || 'straight';
      const aOut = m.mesh.getObjectByName('arrowOut');
      const aIn  = m.mesh.getObjectByName('arrowIn');
      if (aOut) aOut.position.x = 0.05 + cyc * 0.8;
      if (aIn) {
        if (shape === 'straight') {
          aIn.position.x = -0.85 + cyc * 0.8;
        } else {
          const zSign = shape === 'left' ? 1 : -1;
          aIn.position.z = zSign * (0.85 - cyc * 0.8);
        }
      }
      const rollers = m.mesh.userData.rollers;
      const rollSpeed = 6;
      if (rollers) for (const r of rollers) {
        if (r.userData.spinAxis === 'z') r.rotation.z += dt * rollSpeed; else r.rotation.x += dt * rollSpeed;
      }
      const gem = m.mesh.getObjectByName('filterGem');
      if (gem) gem.rotation.y += dt * 1.4;
      // 滞留アイテムを次へ。フィルターは一致=正面、不一致=左右へ交互に振り分ける
      if (m.item && !m.item.moving && m.item.gx === m.gx && m.item.gz === m.gz) {
        const outDirs = m.type === 'filterConveyor'
          ? ((m.filter === 'any' || m.filter === m.item.oreType) ? [m.dir] : [(m.dir + 1) % 4, (m.dir + 3) % 4])
          : [m.dir];
        const start = m.type === 'filterConveyor' ? (m.rejectIndex || 0) : 0;
        for (let n = 0; n < outDirs.length; n++) {
          const idx = (start + n) % outDirs.length;
          const d = outDirs[idx];
          const nk = ctx.key(m.gx + DIRS[d].x, m.gz + DIRS[d].z);
          const next = state.machines.get(nk);
          if (ctx.canAccept(next, m.item, m.gx, m.gz)) {
            const it = m.item;
            m.item = null;
            if (m.type === 'filterConveyor' && outDirs.length > 1) m.rejectIndex = (idx + 1) % outDirs.length;
            ctx.sendItemTo(it, next, CONVEYOR_SPEED);
            break;
          }
        }
      }
    },
    serialize() {}, deserialize() {},
  },

  smelter: {
    id: 'smelter', label: '精錬炉', icon: '🔥', category: 'processing',
    cost: COSTS.smelter, powerUse: 4, refundRate: 0.5,
    canPlace() { return true; },
    canAcceptItem(m, it) { return !it.ingot && m.buffer.length + m.incoming < SMELTER_QUEUE_MAX; },
    update(m, dt) {
      if (!powerGrid.isPowered(m)) return;
      const fire = m.mesh.getObjectByName('fire');
      if (!m.processing && m.buffer.length > 0) {
        m.processing = m.buffer.shift();
        m.progress = 0;
      }
      if (m.processing) {
        m.progress += dt;
        if (fire) fire.material.color.setHSL(0.06, 1, 0.5 + Math.sin(state.time * 10) * 0.15);
        // 煙突から煙パーティクル
        m.mesh.userData.smokeTimer = (m.mesh.userData.smokeTimer || 0) + dt;
        if (m.mesh.userData.smokeTimer > 0.3) {
          m.mesh.userData.smokeTimer = 0;
          const anchor = m.mesh.userData.smokeAnchor;
          const wp = m.mesh.localToWorld(anchor.clone());
          ctx.spawnParticle('smoke', wp, { life: 1.4, scale: 0.3, vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.9, (Math.random() - 0.5) * 0.2), grow: 0.7 });
        }
        // 精錬中は炉の窓から火花が時々舞う
        if (Math.random() < dt * 2) {
          const fp = m.mesh.localToWorld(new THREE.Vector3(0, 0.35, 0.85));
          ctx.spawnParticle('spark', fp, { life: 0.4, scale: 0.14, vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random(), (Math.random() - 0.5) * 0.6 + 0.6), grow: 0.4 });
        }
        if (m.progress >= SMELT_TIME) {
          const outKey = ctx.key(m.gx + DIRS[m.dir].x, m.gz + DIRS[m.dir].z);
          const target = state.machines.get(outKey);
          const dummy = { oreType: m.processing.oreType, ingot: true };
          if (ctx.canAccept(target, dummy, m.gx, m.gz)) {
            const it = ctx.spawnItem(m.processing.oreType, true, m.gx, m.gz);
            it.pos.y += 0.6;

            ctx.sendItemTo(it, target);
            m.processing = null;
          }
        }
      } else if (fire) fire.material.color.set(0x772d10);
    },
    serialize() {}, deserialize() {},
  },

  autoCrafter: {
    id: 'autoCrafter', label: '自動工房', icon: '🏭', category: 'processing',
    cost: COSTS.autoCrafter, powerUse: 6, refundRate: 0.5,
    canPlace() { return true; },
    canAcceptItem(m, it) {
      const sk = it.oreType + (it.ingot ? '_i' : '_o');
      if (!AUTOCRAFT_USABLE.has(sk)) return false; // レシピに使わない素材は受け取らない
      // 同一素材の溢れ防止: 1種類につき最大 CRAFTER_STOCK_PER_KIND 個までストック(他の素材の保管枚を確保)
      if (((m.craftStock || {})[sk] || 0) >= CRAFTER_STOCK_PER_KIND) return false;
      return stockTotal(m.craftStock || {}) + m.incoming < CRAFTER_STOCK_TOTAL;
    },
    update(m, dt) {
      if (!powerGrid.isPowered(m)) return;
      const core = m.mesh.userData.core;
      if (core) core.rotation.y += dt * 1.7;
      if (!m.craftRecipe) {
        const preferredId = m.selectedRecipeId || 'auto';
        const recipe = preferredId === 'auto'
          ? AUTOCRAFT_RECIPES.find(r => hasStock(m.craftStock, r.inputs))
          : AUTOCRAFT_RECIPES.find(r => r.id === preferredId && hasStock(m.craftStock, r.inputs));
        if (recipe) {
          consumeStock(m.craftStock, recipe.inputs);
          m.craftRecipe = recipe;
          m.craftProgress = 0;
        }
      }
      if (m.craftRecipe) {
        m.craftProgress += dt;
        if (core) core.material.emissiveIntensity = 0.45 + Math.sin(state.time * 12) * 0.25;
        if (m.craftProgress >= m.craftRecipe.time) {
          ctx.earn(m.craftRecipe.value);
          ctx.spawnFloater('📦+' + formatMoney(m.craftRecipe.value), m.mesh.position.clone().add(new THREE.Vector3(0, 1.6, 0)), '#9fe4ff');
          if (Math.random() < 0.35) ctx.toast('🏭 ' + m.craftRecipe.name + ' を出荷! +' + formatMoney(m.craftRecipe.value), 'good');
          m.craftRecipe = null;
          m.craftProgress = 0;
        }
      } else if (core) {
        core.material.emissiveIntensity = 0.3;
      }
    },
    serialize() {}, deserialize() {},
  },

  seller: {
    id: 'seller', label: '販売機', icon: '💰', category: 'logistics',
    cost: COSTS.seller, powerUse: 0, refundRate: 0.5,
    canPlace() { return true; },
    canAcceptItem() { return true; },
    update(m, dt) {
      // コインが常にゆっくり回転しつつ、上下にホバリング
      const coin = m.mesh.userData.coin;
      if (coin) { coin.rotation.z += dt * 3; coin.position.y = 1.35 + Math.sin(state.time * 3) * 0.05; }
      const sign = m.mesh.userData.sign;
      if (sign) sign.material.emissiveIntensity = 0.3 + Math.sin(state.time * 2.4) * 0.15;
    },
    serialize() {}, deserialize() {},
  },

  splitter: {
    id: 'splitter', label: '分岐器', icon: '🔀', category: 'logistics',
    cost: COSTS.splitter, powerUse: 0, refundRate: 0.5,
    canPlace() { return true; },
    canAcceptItem(m) { return !m.item; },
    update(m, dt) {
      // ハブのキャップをゆっくり回転させ、稼働感を演出
      const cap = m.mesh.getObjectByName('cap');
      if (cap) cap.rotation.y += dt * 2.2;
      const indicators = m.mesh.userData.indicators;
      // 溜まったアイテムを 正面→左→右 の順(ラウンドロビン)で空いている方向へ流す
      if (m.item && !m.item.moving && m.item.gx === m.gx && m.item.gz === m.gz) {
        const outDirs = [m.dir, (m.dir + 1) % 4, (m.dir + 3) % 4];
        for (let n = 0; n < 3; n++) {
          const idx = (m.outIndex + n) % 3;
          const d = outDirs[idx];
          const nk = ctx.key(m.gx + DIRS[d].x, m.gz + DIRS[d].z);
          const next = state.machines.get(nk);
          if (ctx.canAccept(next, m.item, m.gx, m.gz)) {
            const it = m.item;
            m.item = null;
            ctx.sendItemTo(it, next);
            m.outIndex = (idx + 1) % 3;
            if (indicators && indicators[idx]) {
              indicators[idx].material.emissiveIntensity = 1.0;
              indicators[idx].userData.flashUntil = state.time + 0.3;
            }
            break;
          }
        }
      }
      if (indicators) for (const light of indicators) {
        if (light.userData.flashUntil && state.time > light.userData.flashUntil) { light.material.emissiveIntensity = 0.3; light.userData.flashUntil = null; }
      }
    },
    serialize() {}, deserialize() {},
  },

  merger: {
    id: 'merger', label: '合流機', icon: '🔗', category: 'logistics',
    cost: COSTS.merger, powerUse: 0, refundRate: 0.5,
    canPlace() { return true; },
    canAcceptItem(m) { return m.buffer.length + m.incoming < MERGER_QUEUE_MAX; },
    update(m, dt) {
      // 背面/左/右から集めたアイテムを、正面(dir)へ1つずつ送り出す
      const indicators = m.mesh.userData.indicators;
      if (indicators) for (const light of indicators) {
        const targetInt = m.buffer.length > 0 ? (0.15 + Math.sin(state.time * 4) * 0.1) : 0.15;
        light.material.emissiveIntensity += (targetInt - light.material.emissiveIntensity) * Math.min(1, dt * 4);
      }
      const outArrow = m.mesh.getObjectByName('outArrow');
      if (outArrow) outArrow.position.x = 1.0 + Math.sin(state.time * 6) * 0.04;
      if (m.buffer.length > 0) {
        const outKey = ctx.key(m.gx + DIRS[m.dir].x, m.gz + DIRS[m.dir].z);
        const target = state.machines.get(outKey);
        const dummy = m.buffer[0];
        if (ctx.canAccept(target, dummy, m.gx, m.gz)) {
          const entry = m.buffer.shift();
          const it = ctx.spawnItem(entry.oreType, entry.ingot, m.gx, m.gz);
          it.pos.y += entry.ingot ? 0.6 : 0.35;
          ctx.sendItemTo(it, target);
        }
      }
    },
    serialize() {}, deserialize() {},
  },

  chest: {
    id: 'chest', label: 'チェスト', icon: '📦', category: 'logistics',
    cost: COSTS.chest, powerUse: 0, refundRate: 0.5,
    canPlace() { return true; },
    canAcceptItem(m) { return chestTotal(m) + m.incoming < m.cap; },
    update(m, dt) {
      // 保管したアイテムを少しずつ正面(dir)へ自動排出(手動売却はタップで即時)
      // 蓋は在庫があるとわずかに開いた状態でカタカタ振動する演出
      const lidPivot = m.mesh.userData.lidPivot;
      if (lidPivot) {
        const hasSt = chestTotal(m) > 0;
        const targetOpen = hasSt ? 0.12 + Math.sin(state.time * 8) * 0.04 : 0;
        m.mesh.userData.lidOpen += (targetOpen - m.mesh.userData.lidOpen) * Math.min(1, dt * 6);
        lidPivot.rotation.x = -m.mesh.userData.lidOpen;
      }
      m.timer += dt;
      if (m.timer >= CHEST_EJECT_INTERVAL) {
        m.timer = 0;
        const stockKey = Object.keys(m.storage).find(k => m.storage[k] > 0);
        if (stockKey) {
          const outKey = ctx.key(m.gx + DIRS[m.dir].x, m.gz + DIRS[m.dir].z);
          const target = state.machines.get(outKey);
          const ingot = stockKey.endsWith('_i');
          const oreType = stockKey.slice(0, -2);
          const dummy = { oreType, ingot };
          if (ctx.canAccept(target, dummy, m.gx, m.gz)) {
            m.storage[stockKey]--;
            if (m.storage[stockKey] <= 0) delete m.storage[stockKey];
            const it = ctx.spawnItem(oreType, ingot, m.gx, m.gz);
            it.pos.y += ingot ? 0.6 : 0.35;

            ctx.sendItemTo(it, target, CONVEYOR_SPEED);
          }
        }
      }
    },
    serialize() {}, deserialize() {},
  },

  generator: {
    id: 'generator', label: '発電機', icon: '⚡', category: 'power',
    cost: COSTS.generator, powerUse: 0, refundRate: 0.5,
    canPlace() { return true; },
    canAcceptItem() { return false; },
    update() { /* generator just sits there */ },
    serialize() {}, deserialize() {},
  },
};