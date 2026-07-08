/* =====================================================================
   TerraForge — 共有マテリアル / テクスチャ / 機械3Dモデル生成
   ===================================================================== */
import { TS, ORES, DIRS, POWER_RANGE } from '../constants.js';
import { scene, MAX_ANISOTROPY } from './scene.js';

/* ---- helpers ---- */
const sharedMats = {};
export function enhanceMaterial(mat) {
  if (!mat) return mat;
  if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshPhongMaterial) {
    mat.envMapIntensity = Math.max(mat.envMapIntensity || 0, 0.9);
    mat.dithering = true;
  }
  return mat;
}
export function sharedMat(key, factory) {
  if (!sharedMats[key]) sharedMats[key] = enhanceMaterial(factory());
  return sharedMats[key];
}
function makeCanvasTexture(draw, w, h) {
  const c = document.createElement('canvas');
  c.width = w || 64; c.height = h || 64;
  const ctx2 = c.getContext('2d');
  draw(ctx2, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = MAX_ANISOTROPY;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
/* 警告縞テクスチャ(ドリルの土台に使用) */
const stripeTexture = makeCanvasTexture((ctx2, w, h) => {
  ctx2.fillStyle = '#2b2f38'; ctx2.fillRect(0, 0, w, h);
  ctx2.fillStyle = '#ffcc33';
  const n = 8;
  for (let i = -1; i < n; i++) {
    ctx2.beginPath();
    ctx2.moveTo(i * (w / n), h); ctx2.lineTo(i * (w / n) + w / n / 2, 0);
    ctx2.lineTo(i * (w / n) + w / n, 0); ctx2.lineTo(i * (w / n) + w / n / 2, h);
    ctx2.closePath(); ctx2.fill();
  }
}, 64, 64);
stripeTexture.wrapS = stripeTexture.wrapT = THREE.RepeatWrapping;
stripeTexture.repeat.set(2, 1);
/* ベルトのトレッド模様(コンベア・分岐器・合流機で共有) */
export const beltTexture = makeCanvasTexture((ctx2, w, h) => {
  ctx2.fillStyle = '#242b39'; ctx2.fillRect(0, 0, w, h);
  ctx2.fillStyle = '#333d4f';
  for (let i = 0; i < h; i += 8) ctx2.fillRect(0, i, w, 4);
}, 16, 64);
beltTexture.wrapS = beltTexture.wrapT = THREE.RepeatWrapping;
beltTexture.repeat.set(1, 3);
/* 円形グラデーションのパーティクルテクスチャ */
function makeRadialTexture(inner, outer) {
  return makeCanvasTexture((ctx2, w, h) => {
    const g2 = ctx2.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g2.addColorStop(0, inner); g2.addColorStop(1, outer);
    ctx2.fillStyle = g2;
    ctx2.beginPath(); ctx2.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); ctx2.fill();
  }, 32, 32);
}
export const PARTICLE_TEX = {
  smoke: makeRadialTexture('rgba(220,220,220,0.75)', 'rgba(220,220,220,0)'),
  dust:  makeRadialTexture('rgba(150,110,70,0.8)',  'rgba(150,110,70,0)'),
  spark: makeRadialTexture('rgba(255,235,150,1)',   'rgba(255,140,30,0)'),
  fire:  makeRadialTexture('rgba(255,200,80,0.9)',  'rgba(255,60,10,0)'),
};
const particleMatCache = {};
export function particleMat(type) {
  if (!particleMatCache[type]) {
    particleMatCache[type] = new THREE.SpriteMaterial({
      map: PARTICLE_TEX[type], transparent: true, depthWrite: false,
      blending: (type === 'spark' || type === 'fire') ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
  }
  return particleMatCache[type];
}

/* ---- 共有ジオメトリ ---- */
export const GEO_DRILL_LEG    = new THREE.CylinderGeometry(0.08, 0.1, 0.3, 6);
export const GEO_DRILL_PIPE   = new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6);
export const GEO_DRILL_PISTON = new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8);
export const GEO_DRILL_LIGHT  = new THREE.SphereGeometry(0.08, 14, 14);
export const GEO_INDICATOR    = new THREE.SphereGeometry(0.1, 14, 14);

/* ---- ドリル ---- */
function buildDrillMesh(tier) {
  const g = new THREE.Group();
  const mk2 = tier === 2;
  const baseMat  = sharedMat(mk2 ? 'drill2Base' : 'drillBase',  () => new THREE.MeshStandardMaterial({ color: mk2 ? 0x2b3f5d : 0x4a5568, roughness: .6, map: stripeTexture }));
  const legMat   = sharedMat(mk2 ? 'drill2Leg' : 'drillLeg',   () => new THREE.MeshStandardMaterial({ color: mk2 ? 0x233145 : 0x333c48, roughness: .7, metalness: .3 }));
  const towerMat = sharedMat(mk2 ? 'drill2Tower' : 'drillTower', () => new THREE.MeshStandardMaterial({ color: mk2 ? 0x43a7ff : 0xd9822b, roughness: .5 }));
  const bitMat   = sharedMat('drillBit',   () => new THREE.MeshStandardMaterial({ color: 0x99a3b5, metalness: .8, roughness: .3 }));
  const pipeMat  = sharedMat('drillPipe',  () => new THREE.MeshStandardMaterial({ color: 0x1c2430, metalness: .6, roughness: .4 }));
  const outMat   = sharedMat('drillOut',   () => new THREE.MeshStandardMaterial({ color: 0x2d3748 }));
  const lightMat = sharedMat('drillLight', () => new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff3b3b, emissiveIntensity: 0 }));
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, 1.5), baseMat);
  base.position.y = 0.18; base.castShadow = true; g.add(base);
  [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(GEO_DRILL_LEG, legMat);
    leg.position.set(lx, 0.03, lz); leg.castShadow = true; g.add(leg);
  });
  [[-0.32, 0], [0.32, 0]].forEach(([px, pz]) => {
    const pipe = new THREE.Mesh(GEO_DRILL_PIPE, pipeMat);
    pipe.position.set(px, 0.85, pz); g.add(pipe);
  });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.5), towerMat);
  tower.position.y = 0.9; tower.castShadow = true; g.add(tower);
  const piston = new THREE.Mesh(GEO_DRILL_PISTON, pipeMat);
  piston.position.y = 1.55; g.add(piston);
  const bit = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.8, 6), bitMat);
  bit.rotation.x = Math.PI; bit.position.y = 0.42; bit.name = 'bit'; bit.castShadow = true; g.add(bit);
  const out = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.4), outMat);
  out.position.set(0.75, 0.5, 0); g.add(out);
  const light = new THREE.Mesh(GEO_DRILL_LIGHT, lightMat);
  light.position.set(0, 1.5, 0.3); g.add(light);
  if (mk2) {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 8, 20), sharedMat('drill2Halo', () => new THREE.MeshStandardMaterial({ color: 0x74c4ff, emissive: 0x1b5aa6, emissiveIntensity: 0.45, metalness: .4, roughness: .3 })));
    halo.position.set(0, 1.26, 0); halo.rotation.x = Math.PI / 2; g.add(halo);
    g.userData.halo = halo;
  }
  g.userData.piston = piston;
  g.userData.warnLight = light;
  g.userData.dustTimer = 0;
  return g;
}

/* ---- ベルト関連 ---- */
export const BELT_ARM = TS * 0.5;
export const BELT_W = 1.06;
const GEO_ROLLER_Z = (() => { const g2 = new THREE.CylinderGeometry(0.14, 0.14, BELT_W, 10); g2.rotateX(Math.PI / 2); return g2; })();
const GEO_ROLLER_X = (() => { const g2 = new THREE.CylinderGeometry(0.14, 0.14, BELT_W, 10); g2.rotateZ(Math.PI / 2); return g2; })();
export function beltArmMesh(axis, sign, mat) {
  const len = BELT_ARM + 0.05;
  const geo = axis === 'x' ? new THREE.BoxGeometry(len, 0.16, BELT_W) : new THREE.BoxGeometry(BELT_W, 0.16, len);
  const m = new THREE.Mesh(geo, mat);
  if (axis === 'x') m.position.set(sign * len / 2, 0.1, 0); else m.position.set(0, 0.1, sign * len / 2);
  m.receiveShadow = true;
  return m;
}
export function beltRailMesh(axis, sign, side, mat) {
  const len = BELT_ARM + 0.05;
  const geo = axis === 'x' ? new THREE.BoxGeometry(len, 0.1, 0.12) : new THREE.BoxGeometry(0.12, 0.1, len);
  const r = new THREE.Mesh(geo, mat);
  if (axis === 'x') r.position.set(sign * len / 2, 0.2, side * 0.56); else r.position.set(side * 0.56, 0.2, sign * len / 2);
  return r;
}
export function beltRollerMesh(axis, sign, mat) {
  const len = BELT_ARM + 0.05;
  const geo = axis === 'x' ? GEO_ROLLER_Z : GEO_ROLLER_X;
  const roller = new THREE.Mesh(geo, mat);
  if (axis === 'x') roller.position.set(sign * len, 0.17, 0); else roller.position.set(0, 0.17, sign * len);
  roller.castShadow = true;
  roller.userData.spinAxis = axis === 'x' ? 'z' : 'x';
  return roller;
}
export function addPortArrow(g, localDir, label, color, y) {
  const mat = sharedMat('portArrow' + label + color, () => new THREE.MeshBasicMaterial({ color }));
  const d = DIRS[localDir];
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.34, 3), mat);
  arrow.position.set(d.x * 0.82, y || 0.82, d.z * 0.82);
  if (localDir === 0) arrow.rotation.z = -Math.PI / 2;
  else if (localDir === 2) arrow.rotation.z = Math.PI / 2;
  else arrow.rotation.x = localDir === 1 ? Math.PI / 2 : -Math.PI / 2;
  arrow.name = 'port-' + label; g.add(arrow);
  return arrow;
}
export function addPortPad(g, x, z, color, name) {
  const mat = sharedMat('portPad' + name + color, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .18, roughness: .45 }));
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.34), mat);
  pad.position.set(x, 0.08, z); pad.name = 'port-' + name; g.add(pad);
  return pad;
}

/* ---- コンベア ---- */
export function buildConveyorMeshShaped(shape) {
  const g = new THREE.Group();
  const beltMat = sharedMat('beltSurface', () => new THREE.MeshStandardMaterial({ color: 0x2a3242, roughness: .8, map: beltTexture }));
  const railMat = sharedMat('beltRail', () => new THREE.MeshStandardMaterial({ color: 0x525f76, metalness: .3, roughness: .5 }));
  const rollerMat = sharedMat('beltRoller', () => new THREE.MeshStandardMaterial({ color: 0x8b95ab, metalness: .5, roughness: .35 }));
  const rollers = [];
  g.add(beltArmMesh('x', 1, beltMat));
  const rOut = beltRollerMesh('x', 1, rollerMat); g.add(rOut); rollers.push(rOut);
  if (shape === 'straight') {
    g.add(beltArmMesh('x', -1, beltMat));
    g.add(beltRailMesh('x', 1, 1, railMat));  g.add(beltRailMesh('x', 1, -1, railMat));
    g.add(beltRailMesh('x', -1, 1, railMat)); g.add(beltRailMesh('x', -1, -1, railMat));
    const rIn = beltRollerMesh('x', -1, rollerMat); g.add(rIn); rollers.push(rIn);
  } else {
    const zSign = shape === 'left' ? 1 : -1;
    g.add(beltArmMesh('z', zSign, beltMat));
    g.add(beltRailMesh('x', 1, 1, railMat)); g.add(beltRailMesh('x', 1, -1, railMat));
    g.add(beltRailMesh('z', zSign, 1, railMat)); g.add(beltRailMesh('z', zSign, -1, railMat));
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.2, 14), beltMat);
    hub.position.y = 0.11; hub.receiveShadow = true; g.add(hub);
    const rIn = beltRollerMesh('z', zSign, rollerMat); g.add(rIn); rollers.push(rIn);
  }
  const arrowMat = sharedMat('beltArrow', () => new THREE.MeshBasicMaterial({ color: 0xffc23e }));
  const aOut = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.28, 3), arrowMat);
  aOut.rotation.z = -Math.PI / 2; aOut.position.set(0.2, 0.19, 0); aOut.name = 'arrowOut'; g.add(aOut);
  const aIn = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.28, 3), arrowMat);
  aIn.name = 'arrowIn';
  if (shape === 'straight') {
    aIn.rotation.z = -Math.PI / 2; aIn.position.set(-0.55, 0.19, 0);
  } else {
    const zSign = shape === 'left' ? 1 : -1;
    aIn.rotation.x = zSign > 0 ? -Math.PI / 2 : Math.PI / 2;
    aIn.position.set(0, 0.19, zSign * 0.55);
  }
  g.add(aIn);
  g.userData.beltShape = shape;
  g.userData.rollers = rollers;
  return g;
}

/* ---- フィルターコンベア ---- */
export function buildFilterConveyorMeshShaped() {
  const g = new THREE.Group();
  const beltMat = sharedMat('beltSurface', () => new THREE.MeshStandardMaterial({ color: 0x2a3242, roughness: .8, map: beltTexture }));
  const railMat = sharedMat('beltRail', () => new THREE.MeshStandardMaterial({ color: 0x525f76, metalness: .3, roughness: .5 }));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.54, 0.18, 14), beltMat);
  hub.position.y = 0.11; hub.receiveShadow = true; g.add(hub);
  for (const arm of [{axis:'x', sign:1, label:'match'}, {axis:'z', sign:1, label:'rejectA'}, {axis:'z', sign:-1, label:'rejectB'}, {axis:'x', sign:-1, label:'input'}]) {
    g.add(beltArmMesh(arm.axis, arm.sign, beltMat));
    g.add(beltRailMesh(arm.axis, arm.sign, 1, railMat));
    g.add(beltRailMesh(arm.axis, arm.sign, -1, railMat));
  }
  addPortArrow(g, 0, 'match-out', 0x7dffa0, 0.36);
  addPortArrow(g, 1, 'reject-left', 0xffb547, 0.36);
  addPortArrow(g, 3, 'reject-right', 0xffb547, 0.36);
  addPortPad(g, -0.88, 0, 0x66d9ff, 'input');
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333, emissiveIntensity: .35, metalness: .4, roughness: .3 }));
  gem.position.set(0, 0.38, 0); gem.name = 'filterGem'; g.add(gem);
  g.userData.beltShape = 'filter3';
  return g;
}

/* ---- 精錬炉 ---- */
export function buildSmelterMesh() {
  const g = new THREE.Group();
  const bodyMat = sharedMat('smelterBody', () => new THREE.MeshStandardMaterial({ color: 0x6b3f2a, roughness: .7 }));
  const trimMat = sharedMat('smelterTrim', () => new THREE.MeshStandardMaterial({ color: 0x3d2415, roughness: .8 }));
  const chimneyMat = sharedMat('smelterChimney', () => new THREE.MeshStandardMaterial({ color: 0x3d444f, roughness: .6, metalness: .3 }));
  const grateMat = sharedMat('smelterGrate', () => new THREE.MeshStandardMaterial({ color: 0x232830, metalness: .6, roughness: .4 }));
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.6), bodyMat);
  body.position.y = 0.5; body.castShadow = true; g.add(body);
  const trimTop = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.16, 1.68), trimMat);
  trimTop.position.y = 1.0; g.add(trimTop);
  const trimBottom = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.16, 1.68), trimMat);
  trimBottom.position.y = 0.02; g.add(trimBottom);
  const fire = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.1), new THREE.MeshStandardMaterial({ color: 0xff7422, emissive: 0xff4400, emissiveIntensity: 0.15, map: PARTICLE_TEX.fire, transparent: true }));
  fire.position.set(0, 0.35, 0.81); fire.name = 'fire'; g.add(fire);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.65, 0.06), grateMat);
  frame.position.set(0, 0.35, 0.85); g.add(frame);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.8), chimneyMat);
  chimney.position.set(-0.45, 1.35, -0.45); chimney.castShadow = true; g.add(chimney);
  const chimneyRim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1), chimneyMat);
  chimneyRim.position.set(-0.45, 1.75, -0.45); g.add(chimneyRim);
  addPortArrow(g, 0, 'out', 0xffc23e, 0.38);
  addPortPad(g, -0.82, 0, 0x66d9ff, 'input');
  g.userData.smokeAnchor = new THREE.Vector3(-0.45, 1.85, -0.45);
  g.userData.smokeTimer = 0;
  return g;
}

/* ---- 販売機 ---- */
export function buildSellerMesh() {
  const g = new THREE.Group();
  const bodyMat = sharedMat('sellerBody', () => new THREE.MeshStandardMaterial({ color: 0x2f7d4f, roughness: .55 }));
  const slotMat = sharedMat('sellerSlot', () => new THREE.MeshStandardMaterial({ color: 0x123420 }));
  const signMat = sharedMat('sellerSign', () => new THREE.MeshStandardMaterial({ color: 0xffd23e, emissive: 0xaa8800, emissiveIntensity: .4 }));
  const coinMat = sharedMat('sellerCoin', () => new THREE.MeshStandardMaterial({ color: 0xffe066, metalness: .8, roughness: .25, emissive: 0x775500, emissiveIntensity: .3 }));
  const trimMat = sharedMat('sellerTrim', () => new THREE.MeshStandardMaterial({ color: 0x1c4a30, roughness: .6 }));
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.6), bodyMat);
  body.position.y = 0.45; body.castShadow = true; g.add(body);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 1.7), trimMat);
  trim.position.y = 0.05; g.add(trim);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 1.0), slotMat);
  slot.position.y = 0.92; g.add(slot);
  const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 20), signMat);
  sign.rotation.x = Math.PI / 2; sign.position.set(0, 0.85, 0.83); sign.name = 'sign'; g.add(sign);
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 16), coinMat);
  coin.position.set(0, 1.35, 0); coin.rotation.x = Math.PI / 2; g.add(coin);
  g.userData.coin = coin; g.userData.sign = sign;
  addPortPad(g, -0.72, 0, 0x7dffa0, 'input-a');
  addPortPad(g, 0.72, 0, 0x7dffa0, 'input-b');
  addPortPad(g, 0, 0.72, 0x7dffa0, 'input-c');
  addPortPad(g, 0, -0.72, 0x7dffa0, 'input-d');
  return g;
}

/* ---- 発電機 ---- */
export function buildGeneratorMesh() {
  const g = new THREE.Group();
  const baseMat = sharedMat('genBase', () => new THREE.MeshStandardMaterial({ color: 0x334155, roughness: .55, metalness: .2 }));
  const coilMat = sharedMat('genCoil', () => new THREE.MeshStandardMaterial({ color: 0xffc23e, emissive: 0xff8c00, emissiveIntensity: .35, roughness: .35 }));
  const poleMat = sharedMat('genPole', () => new THREE.MeshStandardMaterial({ color: 0x8b95ab, metalness: .6, roughness: .3 }));
  const rangeMat = sharedMat('genRange', () => new THREE.MeshBasicMaterial({ color: 0x7ec8ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.55, 1.25), baseMat);
  base.position.y = 0.28; base.castShadow = true; base.receiveShadow = true; g.add(base);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.08, 10, 20), coilMat);
  coil.position.set(0, 0.75, 0); coil.rotation.x = Math.PI / 2; coil.castShadow = true; coil.name = 'coil'; g.add(coil);
  for (const x of [-0.42, 0.42]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.65, 8), poleMat);
    pole.position.set(x, 0.78, 0); pole.castShadow = true; g.add(pole);
  }
  const range = new THREE.Mesh(new THREE.RingGeometry(POWER_RANGE * TS - 0.1, POWER_RANGE * TS + 0.1, 52), rangeMat);
  range.rotation.x = -Math.PI / 2; range.position.y = 0.04; range.name = 'range'; g.add(range);
  return g;
}

/* ---- 自動工房 ---- */
export function buildAutoCrafterMesh() {
  const g = new THREE.Group();
  const bodyMat = sharedMat('autoCrafterBody', () => new THREE.MeshStandardMaterial({ color: 0x2c3f5f, roughness: .55, metalness: .25 }));
  const trimMat = sharedMat('autoCrafterTrim', () => new THREE.MeshStandardMaterial({ color: 0x4a618b, roughness: .4, metalness: .4 }));
  const coreMat = sharedMat('autoCrafterCore', () => new THREE.MeshStandardMaterial({ color: 0x7ec8ff, emissive: 0x245a96, emissiveIntensity: .5, roughness: .25, metalness: .2 }));
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.0, 1.7), bodyMat);
  body.position.y = 0.5; body.castShadow = true; g.add(body);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 1.8), trimMat);
  trim.position.y = 1.03; g.add(trim);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), coreMat);
  core.position.y = 1.28; core.name = 'core'; g.add(core);
  addPortArrow(g, 0, 'out', 0xffc23e, 0.35);
  addPortPad(g, -0.8, 0, 0x66d9ff, 'input');
  g.userData.core = core;
  return g;
}

/* ---- 分岐器 ---- */
export function buildSplitterMesh() {
  const g = new THREE.Group();
  const hubMat = sharedMat('splitterHub', () => new THREE.MeshStandardMaterial({ color: 0x3a4a63, roughness: .6 }));
  const beltMat = sharedMat('beltSurface', () => new THREE.MeshStandardMaterial({ color: 0x2a3242, roughness: .8, map: beltTexture }));
  const capMat = sharedMat('splitterCap', () => new THREE.MeshStandardMaterial({ color: 0x54637f, metalness: .4, roughness: .5 }));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.55, 0.24, 8), hubMat);
  hub.position.y = 0.12; hub.castShadow = true; g.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 8), capMat);
  cap.position.y = 0.28; cap.name = 'cap'; g.add(cap);
  const outs = [ {x:1,z:0}, {x:0,z:1}, {x:0,z:-1} ];
  const indicators = [];
  outs.forEach(d => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.5), beltMat);
    arm.position.set(d.x * 0.55, 0.09, d.z * 0.55); arm.receiveShadow = true; g.add(arm);
    const light = new THREE.Mesh(GEO_INDICATOR, new THREE.MeshStandardMaterial({ color: 0xffc23e, emissive: 0x552e00, emissiveIntensity: .3 }));
    light.position.set(d.x * 0.95, 0.22, d.z * 0.95); g.add(light);
    indicators.push(light);
  });
  addPortArrow(g, 0, 'out-main', 0xffc23e, 0.45);
  addPortArrow(g, 1, 'out-left', 0xffc23e, 0.45);
  addPortArrow(g, 3, 'out-right', 0xffc23e, 0.45);
  addPortPad(g, -0.86, 0, 0x66d9ff, 'input');
  g.userData.indicators = indicators;
  return g;
}

/* ---- 合流機 ---- */
export function buildMergerMesh() {
  const g = new THREE.Group();
  const hubMat = sharedMat('mergerHub', () => new THREE.MeshStandardMaterial({ color: 0x4a3a63, roughness: .6 }));
  const beltMat = sharedMat('beltSurface', () => new THREE.MeshStandardMaterial({ color: 0x2a3242, roughness: .8, map: beltTexture }));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.26, 8), hubMat);
  hub.position.y = 0.13; hub.castShadow = true; g.add(hub);
  const ins = [ {x:-1,z:0}, {x:0,z:1}, {x:0,z:-1} ];
  const indicators = [];
  ins.forEach(d => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.45), beltMat);
    arm.position.set(d.x * 0.5, 0.09, d.z * 0.5); arm.receiveShadow = true; g.add(arm);
    const light = new THREE.Mesh(GEO_INDICATOR, new THREE.MeshStandardMaterial({ color: 0x9d7bff, emissive: 0x2a1a55, emissiveIntensity: .15 }));
    light.position.set(d.x * 0.85, 0.2, d.z * 0.85); light.scale.setScalar(0.7); g.add(light);
    indicators.push(light);
  });
  const outArm = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.16, 0.6), beltMat);
  outArm.position.set(0.6, 0.1, 0); g.add(outArm);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.32, 3), sharedMat('beltArrow', () => new THREE.MeshBasicMaterial({ color: 0xffc23e })));
  arrow.rotation.z = -Math.PI / 2; arrow.position.set(1.0, 0.2, 0); arrow.name = 'outArrow'; g.add(arrow);
  addPortArrow(g, 0, 'out', 0xffc23e, 0.45);
  addPortPad(g, -0.86, 0, 0x66d9ff, 'input-back');
  addPortPad(g, 0, 0.86, 0x66d9ff, 'input-left');
  addPortPad(g, 0, -0.86, 0x66d9ff, 'input-right');
  g.userData.indicators = indicators;
  return g;
}

/* ---- チェスト ---- */
export function buildChestMesh() {
  const g = new THREE.Group();
  const woodMat = sharedMat('chestWood', () => new THREE.MeshStandardMaterial({ color: 0x8a5a2e, roughness: .75 }));
  const trimMat = sharedMat('chestTrim', () => new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: .7, metalness: .1 }));
  const lockMat = sharedMat('chestLock', () => new THREE.MeshStandardMaterial({ color: 0xd8b23a, metalness: .7, roughness: .3 }));
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 1.1), woodMat);
  body.position.y = 0.35; body.castShadow = true; g.add(body);
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.7, -0.55);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.22, 1.14), trimMat);
  lid.position.set(0, 0.11, 0.57); lid.castShadow = true;
  lidPivot.add(lid); g.add(lidPivot);
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.1), lockMat);
  lock.position.set(0, 0.55, 0.56); lock.name = 'lock'; g.add(lock);
  g.userData.lidPivot = lidPivot;
  g.userData.lidOpen = 0;
  addPortArrow(g, 0, 'out', 0xffc23e, 0.9);
  addPortPad(g, -0.72, 0, 0x66d9ff, 'input');
  return g;
}

export function updateFilterGem(m) {
  const gem = m.mesh.getObjectByName('filterGem');
  if (!gem) return;
  gem.material.color.setHex(m.filter && ORES[m.filter] ? ORES[m.filter].color : 0xffffff);
}

export const MESH_BUILDERS = {
  drill: () => buildDrillMesh(1),
  drill2: () => buildDrillMesh(2),
  conveyor: () => buildConveyorMeshShaped('straight'),
  fastConveyor: () => buildConveyorMeshShaped('straight'),
  smelter: buildSmelterMesh,
  autoCrafter: buildAutoCrafterMesh,
  seller: buildSellerMesh,
  splitter: buildSplitterMesh,
  merger: buildMergerMesh,
  chest: buildChestMesh,
  filterConveyor: () => buildFilterConveyorMeshShaped(),
  generator: buildGeneratorMesh,
};

export function applyFastConveyorTint(mesh) {
  if (!mesh || mesh.userData.fastTinted) return;
  mesh.traverse(o => {
    if (o.isMesh && o.material && o.material.color) o.material = o.material.clone();
    if (o.isMesh && o.material && o.material.color) o.material.color.offsetHSL(0.06, 0.02, 0.08);
  });
  mesh.userData.fastTinted = true;
}

/* ---- アイテムジオメトリ ---- */
export const itemGeoOre = new THREE.IcosahedronGeometry(0.24, 1);
export const itemGeoIngot = new THREE.BoxGeometry(0.42, 0.2, 0.26);
const itemMats = {};
export function itemMaterial(type, ingot) {
  const k = type + (ingot ? '_i' : '');
  if (!itemMats[k]) {
    const spec = ORES[type];
    itemMats[k] = enhanceMaterial(new THREE.MeshStandardMaterial({
      color: ingot ? spec.ingotColor : spec.color,
      metalness: ingot ? 0.9 : 0.55, roughness: ingot ? 0.2 : 0.42,
      emissive: ingot ? spec.ingotColor : 0x000000, emissiveIntensity: ingot ? 0.15 : 0,
    }));
  }
  return itemMats[k];
}

/* ---- フローティングテキスト用のキャンバステクスチャ ----
   Phase03: 旧 particles.js から移動。document.createElement を UI/Render 層に
   閉じ込めるため、テキストスプライト生成もここで行う。 */
export function makeTextMaterial(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const c2d = c.getContext('2d');
  c2d.font = '800 52px "M PLUS Rounded 1c", sans-serif';
  c2d.textAlign = 'center'; c2d.textBaseline = 'middle';
  c2d.lineWidth = 10; c2d.strokeStyle = 'rgba(0,0,0,.7)';
  c2d.strokeText(text, 128, 48);
  c2d.fillStyle = color;
  c2d.fillText(text, 128, 48);
  const tex = new THREE.CanvasTexture(c);
  return new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
}
export function makeTextSprite(text, color) {
  const sp = new THREE.Sprite(makeTextMaterial(text, color));
  sp.scale.set(3.4, 1.3, 1);
  return sp;
}