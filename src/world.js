/* =====================================================================
   TerraForge — ワールド生成 (地形・鉱脈ノイズ)
   ===================================================================== */
import { GRID, TS, LH, MAX_DEPTH, ELEV_MAX, ORES } from './constants.js';
import { state } from './state.js';
import { scene } from './render/scene.js';
import { enhanceMaterial } from './render/meshes.js';

/* ---------------- ワールド生成 ---------------- */
export const worldX = gx => (gx - GRID / 2 + 0.5) * TS;
export const worldZ = gz => (gz - GRID / 2 + 0.5) * TS;
export const inGrid = (gx, gz) => gx >= 0 && gz >= 0 && gx < GRID && gz < GRID;
export const key = (gx, gz) => gx + ',' + gz;

const tileGeo = new THREE.BoxGeometry(TS * 0.98, 1, TS * 0.98);
tileGeo.translate(0, -0.5, 0); // 上面が原点

/* タイルは InstancedMesh 1つで描画(64x64=4096マスでも1ドローコールで軽量)。
   色は per-instance color、高さはインスタンス行列のYスケールで表現する */
const tileMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const GRASS_COLORS = [0x4c8c41, 0x5da24a, 0x6cb156, 0x7ec365]; // 標高が高いほど明るい草色
const DIRT_COLORS  = [0x8a6a42, 0x74562f, 0x5c4224, 0x453118]; // 深さ4段分
const ORE_TILE_COLORS = {
  coal: 0x3d424e, iron: 0x9aa2b0, copper: 0xa96f35,
  silver: 0xb6c0ce, gold: 0xb69a2e, diamond: 0x4fa8bd,
  ruby: 0x9c2846, mithril: 0x2f9e7e,
};

function genOreVeins(rand) {
  const veins = [];
  // マップ広大化(64→96)に合わせて鉱脈数をスケールアップ+最深部の新鉱石(ルビー・ミスリル)を追加
  const types = [
    ...Array(40).fill('coal'),
    ...Array(44).fill('iron'),
    ...Array(32).fill('copper'),
    ...Array(24).fill('silver'),
    ...Array(20).fill('gold'),
    ...Array(14).fill('diamond'),
    ...Array(9).fill('ruby'),
    ...Array(7).fill('mithril'),
  ];
  for (const t of types) {
    veins.push({ type: t, cx: 2 + Math.floor(rand() * (GRID - 4)), cz: 2 + Math.floor(rand() * (GRID - 4)), r: 1 + rand() * 2.2 });
  }
  return veins;
}

/* ---- 軽量な値ノイズ(粗い格子+バイリニア補間)による高低差の生成 ----
   O(GRID^2) の単純計算のみなので、広大マップでも生成は一瞬で終わる */
function makeNoiseGrid(r, C) {
  const g = [];
  for (let i = 0; i <= C; i++) { g[i] = []; for (let j = 0; j <= C; j++) g[i][j] = r(); }
  return g;
}
function sampleNoise(g, C, gx, gz) {
  const u = gx / (GRID - 1) * C, v = gz / (GRID - 1) * C;
  const i = Math.min(C - 1, u | 0), j = Math.min(C - 1, v | 0);
  let fu = u - i, fv = v - j;
  fu = fu * fu * (3 - 2 * fu); fv = fv * fv * (3 - 2 * fv); // smoothstep でなめらかに
  const a = g[i][j] + (g[i + 1][j] - g[i][j]) * fu;
  const b = g[i][j + 1] + (g[i + 1][j + 1] - g[i][j + 1]) * fu;
  return a + (b - a) * fv;
}
function genElevation(seed) {
  const r = mulberry32((seed ^ 0x5f356495) | 0); // 鉱脈生成とは独立した乱数列(シード再現性を維持)
  const C1 = 9, C2 = 20; // 大きなうねり + 細かい起伏 の2オクターブ(96マス用に細分化)
  const g1 = makeNoiseGrid(r, C1), g2 = makeNoiseGrid(r, C2);
  const elev = [];
  for (let gx = 0; gx < GRID; gx++) {
    elev[gx] = [];
    for (let gz = 0; gz < GRID; gz++) {
      let h = sampleNoise(g1, C1, gx, gz) * 0.72 + sampleNoise(g2, C2, gx, gz) * 0.28;
      // マップ中央はスタート地点として平坦(標高1)に寄せる
      const flat = Math.max(0, 1 - Math.hypot(gx - GRID / 2, gz - GRID / 2) / 9);
      h = h * (1 - flat) + 0.38 * flat;
      elev[gx][gz] = Math.max(0, Math.min(ELEV_MAX, Math.floor(h * (ELEV_MAX + 1))));
    }
  }
  return elev;
}

export let tileIMesh = null;               // 全タイルを1つの InstancedMesh で描画
export const _tmpObj = new THREE.Object3D();
export const _tmpCol = new THREE.Color();

export function createWorld(saved) {
  // Phase06: v8スキーマでは seed/tiles が saved.world 配下にネストされる
  const savedWorld = saved ? saved.world : null;
  const seed = savedWorld ? savedWorld.seed : (Math.random() * 1e9) | 0;
  const rand = mulberry32(seed);
  const veins = genOreVeins(rand);
  const elevMap = genElevation(seed);
  state.tiles = [];
  tileIMesh = new THREE.InstancedMesh(tileGeo, tileMat, GRID * GRID);
  tileIMesh.name = 'tiles';
  tileIMesh.castShadow = true;    // 丘が低地に影を落とす
  tileIMesh.receiveShadow = true;
  tileIMesh.frustumCulled = false; // インスタンス全体が誤ってカリングされるのを防止
  for (let gx = 0; gx < GRID; gx++) {
    state.tiles[gx] = [];
    for (let gz = 0; gz < GRID; gz++) {
      let ore = null;
      for (const v of veins) {
        const d = Math.hypot(gx - v.cx, gz - v.cz);
        if (d <= v.r) {
          const spec = ORES[v.type];
          ore = { type: v.type };
          break;
        }
      }
      state.tiles[gx][gz] = { depth: 0, elev: elevMap[gx][gz], ore, oreMesh: null };
    }
  }
  scene.add(tileIMesh);
  state.seed = seed;

  if (savedWorld) {
    for (const t of savedWorld.tiles) {
      const tile = state.tiles[t.x] && state.tiles[t.x][t.z];
      if (!tile) continue;
      tile.depth = t.d;
      if (t.noOre) tile.ore = null;
    }
  }
  for (let gx = 0; gx < GRID; gx++) for (let gz = 0; gz < GRID; gz++) refreshTile(gx, gz);
}

/* タイル上面のY座標 = (標高 - 掘削深さ) × 層の高さ */
export function tileTopY(gx, gz) { const t = state.tiles[gx][gz]; return (t.elev - t.depth) * LH; }
/* 隣接する機械同士でベルト面が完全に同一平面になりチラつく(Z-fighting)のを防ぐ極小オフセット。
   隣のマスとは必ず異なる値になる(3,5 は 7 と互いに素)ため繋ぎ目がきれいに見える */
export const yJitter = (gx, gz) => ((gx * 3 + gz * 5) % 7) * 0.003;
export const TILE_BOTTOM_Y = -(MAX_DEPTH + 1) * LH - 0.4; // 全タイル共通の底面

export function refreshTile(gx, gz) {
  const t = state.tiles[gx][gz];
  const y = tileTopY(gx, gz);
  const id = gx * GRID + gz;
  _tmpObj.position.set(worldX(gx), y, worldZ(gz));
  _tmpObj.scale.set(1, y - TILE_BOTTOM_Y, 1);
  _tmpObj.rotation.set(0, 0, 0);
  _tmpObj.updateMatrix();
  tileIMesh.setMatrixAt(id, _tmpObj.matrix);
  const exposed = t.ore && ORES[t.ore.type].depth === t.depth;
  const col = exposed ? ORE_TILE_COLORS[t.ore.type]
            : (t.depth === 0 ? GRASS_COLORS[Math.min(t.elev, GRASS_COLORS.length - 1)] : DIRT_COLORS[t.depth - 1]);
  tileIMesh.setColorAt(id, _tmpCol.setHex(col));
  tileIMesh.instanceMatrix.needsUpdate = true;
  if (tileIMesh.instanceColor) tileIMesh.instanceColor.needsUpdate = true;

  // 露出鉱石の見た目(小さな結晶群)
  if (t.oreMesh) { scene.remove(t.oreMesh); t.oreMesh = null; }
  if (exposed && !state.machines.has(key(gx, gz))) {
    const g = new THREE.Group();
    const spec = ORES[t.ore.type];
    const mat = enhanceMaterial(new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.32, metalness: 0.65, emissive: spec.color, emissiveIntensity: 0.12 }));
    const rock = new THREE.IcosahedronGeometry(0.22, 1);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(rock, mat);
      m.position.set((Math.random() - .5) * 1.1, 0.12, (Math.random() - .5) * 1.1);
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      m.scale.setScalar(0.7 + Math.random() * 0.7);
      m.castShadow = true;
      g.add(m);
    }
    g.position.set(worldX(gx), y, worldZ(gz));
    scene.add(g);
    t.oreMesh = g;
  }
}

/* 乱数(シード付き) */
export function mulberry32(a) {
  const f = function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  f.seed = a;
  return f;
}