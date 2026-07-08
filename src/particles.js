/* =====================================================================
   TerraForge — パーティクル・フローティングテキスト・スキャン
   ===================================================================== */
import { state } from './state.js';
import { ORES, GRID, TS } from './constants.js';
import { scene, cam } from './render/scene.js';
import { particleMat, makeTextMaterial, makeTextSprite } from './render/meshes.js';
import { worldX, worldZ, tileTopY, inGrid } from './world.js';
import { bus } from './core/EventBus.js';
import { Events } from './core/events.js';

/* ---------------- パーティクル(煙・土煙・火花) ---------------- */
let particles = [];
const MAX_PARTICLES = 180;
export function spawnParticle(type, pos, opts) {
  if (particles.length >= MAX_PARTICLES) {
    const old = particles.shift();
    if (old) scene.remove(old.sp);
  }
  opts = opts || {};
  const sp = new THREE.Sprite(particleMat(type));
  sp.position.copy(pos);
  const scale = opts.scale || 0.5;
  sp.scale.set(scale, scale, 1);
  scene.add(sp);
  particles.push({
    sp, type,
    life: opts.life || 0.8,
    maxLife: opts.life || 0.8,
    vel: opts.vel || new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.0 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4),
    grow: opts.grow !== undefined ? opts.grow : 1.6,
  });
}
export function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.sp); particles.splice(i, 1); continue; }
    p.sp.position.addScaledVector(p.vel, dt);
    if (p.type === 'smoke' || p.type === 'dust') p.vel.y *= (1 - dt * 0.4); // ふわっと減速
    const k = 1 - p.life / p.maxLife;
    const s = p.sp.scale.x + p.grow * dt;
    p.sp.scale.set(s, s, 1);
    p.sp.material.opacity = Math.max(0, 1 - k) * (p.type === 'spark' ? 1 : 0.85);
  }
}

/**
 * 現在アクティブなパーティクル数を返す。Phase08 デバッグパネル用。
 * @returns {number}
 */
export function getParticleCount() { return particles.length; }

/* ---------------- フローティングテキスト ---------------- */
/* makeTextMaterial / makeTextSprite は Phase03 で render/meshes.js へ移動。
   document.createElement('canvas') をロジック層から排除するため。 */
export { makeTextMaterial, makeTextSprite } from './render/meshes.js';
export function spawnFloater(text, pos, color) {
  const sp = makeTextSprite(text, color);
  sp.position.copy(pos);
  scene.add(sp);
  state.floaters.push({ sp, life: 1.2 });
}
export function updateFloaters(dt) {
  for (let i = state.floaters.length - 1; i >= 0; i--) {
    const f = state.floaters[i];
    f.life -= dt;
    f.sp.position.y += dt * 1.4;
    f.sp.material.opacity = Math.min(1, f.life / 0.5);
    if (f.life <= 0) { scene.remove(f.sp); f.sp.material.map.dispose(); f.sp.material.dispose(); state.floaters.splice(i, 1); }
  }
}

/* ---------------- スキャン(鉱脈探知) ----------------
   広大マップ対策: マテリアルを鉱石種ごとにキャッシュ共有し、
   カメラ周辺(半径15マス)のみ表示して負荷を抑える */
export const SCAN_RADIUS = 15;
const scanMats = {};
export function doScan() {
  clearScan();
  const cgx = Math.round(cam.target.x / TS + GRID / 2 - 0.5);
  const cgz = Math.round(cam.target.z / TS + GRID / 2 - 0.5);
  const x0 = Math.max(0, cgx - SCAN_RADIUS), x1 = Math.min(GRID - 1, cgx + SCAN_RADIUS);
  const z0 = Math.max(0, cgz - SCAN_RADIUS), z1 = Math.min(GRID - 1, cgz + SCAN_RADIUS);
  for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
    if (Math.hypot(gx - cgx, gz - cgz) > SCAN_RADIUS) continue;
    const t = state.tiles[gx][gz];
    if (t.ore) {
      const type = t.ore.type;
      if (!scanMats[type]) {
        const spec = ORES[type];
        scanMats[type] = makeTextMaterial(String(spec.depth), '#' + spec.ingotColor.toString(16).padStart(6, '0'));
      }
      const sp = new THREE.Sprite(scanMats[type]);
      sp.scale.set(1.7, 0.65, 1);
      sp.position.set(worldX(gx), tileTopY(gx, gz) + 1.6, worldZ(gz));
      scene.add(sp);
      state.scanMarkers.push(sp);
    }
  }
  state.scanTimer = 6;
  bus.emit(Events.SCAN_TOGGLED, { active: true });
}
export function clearScan() {
  for (const sp of state.scanMarkers) scene.remove(sp); // マテリアルはキャッシュ共有なので破棄しない
  state.scanMarkers = [];
  bus.emit(Events.SCAN_TOGGLED, { active: false });
}
export function updateScan(dt) {
  if (state.scanTimer > 0) {
    state.scanTimer -= dt;
    const bounce = Math.sin(state.time * 4) * 0.15;
    for (const sp of state.scanMarkers) sp.position.y += bounce * dt;
    if (state.scanTimer <= 0) clearScan();
  }
}