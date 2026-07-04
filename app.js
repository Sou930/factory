/* =====================================================================
   TerraForge — Hydroneer × Factorio 風 3D工業自動化ゲーム
   Three.js / モバイル対応(タッチ・ピンチ・カメラパッド) + PC操作性強化
   分割ファイル版
   ===================================================================== */
(() => {
'use strict';

/* ---------------- 定数 ---------------- */
const GRID = 96;              // マップサイズ (GRID x GRID) ※さらに広大化(64→96)
const TS = 2;                 // タイルの一辺(world units)
const LH = 0.62;              // 1層の深さ(world units)
const MAX_DEPTH = 4;          // 掘れる最大深さ(4段目に最深部の鉱石)
const ELEV_MAX = 3;           // 地形の最大標高(段)
const START_MONEY = 500;      // 初期所持金
const SAVE_KEY = 'terraforge_save_v5'; // 無限鉱脈+電力システムでセーブ形式を更新

const ORES = {
  coal:    { name: '石炭',     depth: 1, color: 0x4b515f, ingotColor: 0x7c869c, oreValue: 1,  ingotValue: 4,   plateValue: 11,   amount: Infinity },
  iron:    { name: '鉄',       depth: 1, color: 0xb8bec9, ingotColor: 0xdfe5ee, oreValue: 2,  ingotValue: 6,   plateValue: 18,   amount: Infinity },
  copper:  { name: '銅',       depth: 2, color: 0xe08a3c, ingotColor: 0xffb060, oreValue: 4,  ingotValue: 14,  plateValue: 42,   amount: Infinity },
  silver:  { name: '銀',       depth: 2, color: 0xd4dce8, ingotColor: 0xf2f6fc, oreValue: 6,  ingotValue: 20,  plateValue: 60,   amount: Infinity },
  gold:    { name: '金',       depth: 3, color: 0xffd23e, ingotColor: 0xffe680, oreValue: 10, ingotValue: 34,  plateValue: 102,  amount: Infinity },
  diamond: { name: 'ダイヤ',   depth: 3, color: 0x7de8ff, ingotColor: 0xc4f4ff, oreValue: 18, ingotValue: 60,  plateValue: 180,  amount: Infinity },
  ruby:    { name: 'ルビー',   depth: 4, color: 0xe0335a, ingotColor: 0xff6b8f, oreValue: 28, ingotValue: 95,  plateValue: 285,  amount: Infinity },
  mithril: { name: 'ミスリル', depth: 4, color: 0x4fe8b8, ingotColor: 0xb8ffe6, oreValue: 42, ingotValue: 145, plateValue: 435,  amount: Infinity },
};

const COSTS = { drill: 50, drill2: 220, conveyor: 10, fastConveyor: 25, smelter: 120, press: 250, seller: 80, splitter: 90, merger: 90, chest: 60, filterConveyor: 30, generator: 180 };
const POWER_OUTPUT = { generator: 12 };
const POWER_USE = { drill: 2, smelter: 4, press: 5, conveyor: 0, filterConveyor: 0, splitter: 0, merger: 0, chest: 0, seller: 0 };
const DIRS = [ {x:1,z:0}, {x:0,z:1}, {x:-1,z:0}, {x:0,z:-1} ]; // E S W N
const DIR_ARROWS = ['→','↓','←','↑'];

const CONVEYOR_SPEED = 1.4;   // cells / sec(通常コンベア)
const FAST_SPEED = 2.8;       // cells / sec(高速ベルト)
const DRILL_INTERVAL = 2.4;   // sec(ドリル)
const DRILL2_INTERVAL = 1.1;  // sec(ドリルMk2 = 約2.2倍速)
const SMELT_TIME = 2.6;       // sec(精錬)
const PRESS_TIME = 3.2;       // sec(プレス加工)

/* ---------------- 状態 ---------------- */
let money = START_MONEY;
let tool = 'dig';
let buildDir = 0;
let selectedFilter = 'any';   // フィルターコンベア設置時のデフォルト対象鉱石
const FILTER_CYCLE = ['any', 'coal', 'iron', 'copper', 'silver', 'gold', 'diamond', 'ruby', 'mithril'];
const FILTER_ICON  = { any: '⚪', coal: '⚫', iron: '⚙️', copper: '🟠', silver: '🥈', gold: '✨', diamond: '💎', ruby: '🔴', mithril: '🟢' };
const FILTER_LABEL = { any: '指定なし', coal: '石炭のみ', iron: '鉄のみ', copper: '銅のみ', silver: '銀のみ', gold: '金のみ', diamond: 'ダイヤのみ', ruby: 'ルビーのみ', mithril: 'ミスリルのみ' };
let tiles = [];               // [gx][gz] = {depth, ore:{type,amount}|null, mesh, oreMesh} ※鉱脈は無限
let machines = new Map();     // "gx,gz" -> machine
let items = [];               // 流れるアイテム
let floaters = [];            // +$ 表示スプライト
let scanMarkers = [];
let scanTimer = 0;
let time = 0;
let power = { used: 0, capacity: 0, ok: true };
let powerDirty = true;

/* ---------------- 実績(マイルストーン)と累計収益 ---------------- */
let stats = { earned: 0, msIndex: 0 };
const MILESTONES = [
  { at: 1000,   reward: 150,  label: '駆け出し採掘者' },
  { at: 3000,   reward: 300,  label: '見習い工場長' },
  { at: 8000,   reward: 600,  label: '一人前の工場長' },
  { at: 20000,  reward: 1500, label: 'ベテラン工場長' },
  { at: 50000,  reward: 3000, label: '採掘王' },
  { at: 120000, reward: 6000, label: 'テラフォージ・マスター' },
  { at: 300000, reward: 15000, label: '大陸の開拓王' },
  { at: 800000, reward: 40000, label: '伝説のテラフォージャー' },
];
function checkMilestones() {
  while (stats.msIndex < MILESTONES.length && stats.earned >= MILESTONES[stats.msIndex].at) {
    const ms = MILESTONES[stats.msIndex++];
    addMoney(ms.reward);
    sfx('milestone');
    toast('🏆 実績「' + ms.label + '」達成! ボーナス $' + ms.reward, 'good');
  }
}
/* 売却などの「収益」はすべてこの関数を通す(実績の進行を記録) */
function earn(v) {
  addMoney(v);
  stats.earned += v;
  const chip = document.getElementById('money-display');
  if (chip) chip.title = '累計収益: $' + stats.earned.toLocaleString();
  checkMilestones();
}

/* ---------------- 効果音(WebAudio・外部ファイル不要) ---------------- */
let audioCtx = null;
let muted = localStorage.getItem('terraforge_muted') === '1';
const sfxLast = {};
function beep(freq, dur, type, vol, delay, slide) {
  const t0 = audioCtx.currentTime + (delay || 0);
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function sfx(name) {
  if (muted) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { return; }
  const now = performance.now();
  const gap = name === 'sell' ? 100 : 40; // 高速ラインでの連続再生スパム防止
  if (now - (sfxLast[name] || 0) < gap) return;
  sfxLast[name] = now;
  switch (name) {
    case 'dig':       beep(170, 0.09, 'triangle', 0.22, 0, -60); break;
    case 'ore':       beep(660, 0.06, 'square', 0.1); beep(880, 0.09, 'square', 0.1, 0.06); break;
    case 'place':     beep(430, 0.05, 'square', 0.12); beep(570, 0.07, 'square', 0.1, 0.05); break;
    case 'demolish':  beep(320, 0.12, 'sawtooth', 0.13, 0, -160); break;
    case 'rotate':    beep(520, 0.05, 'square', 0.1); break;
    case 'click':     beep(700, 0.03, 'square', 0.06); break;
    case 'sell':      beep(880, 0.06, 'sine', 0.14); beep(1320, 0.1, 'sine', 0.13, 0.05); break;
    case 'error':     beep(150, 0.14, 'sawtooth', 0.11); break;
    case 'discover':  beep(523, 0.08, 'sine', 0.15); beep(659, 0.08, 'sine', 0.15, 0.08); beep(784, 0.14, 'sine', 0.15, 0.16); break;
    case 'milestone': beep(523, 0.09, 'square', 0.12); beep(659, 0.09, 'square', 0.12, 0.09); beep(784, 0.09, 'square', 0.12, 0.18); beep(1046, 0.2, 'square', 0.12, 0.27); break;
  }
}

/* ---------------- Three.js 基本 ---------------- */
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const MAX_PIXEL_RATIO = window.matchMedia('(max-width: 700px)').matches ? 1.5 : 2;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10192e);
scene.fog = new THREE.Fog(0x10192e, 120, 430);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 900);

/* カメラ制御(ターゲット周回・スムーズ補間対応) */
const cam = {
  yaw: Math.PI / 4, pitch: 0.9, dist: 40,
  yawT: Math.PI / 4, pitchT: 0.9, distT: 40, // 目標値(なめらかに追従)
  target: new THREE.Vector3(0, 0, 0)
};
function updateCamera(dt) {
  cam.pitchT = Math.max(0.42, Math.min(1.45, cam.pitchT));
  cam.distT  = Math.max(12, Math.min(210, cam.distT));
  // フレームレートに依存しない指数減衰でなめらかに目標値へ追従させる(操作感向上)
  const ease = 1 - Math.pow(0.0025, dt);
  cam.yaw   += (cam.yawT   - cam.yaw)   * ease;
  cam.pitch += (cam.pitchT - cam.pitch) * ease;
  cam.dist  += (cam.distT  - cam.dist)  * ease;

  const r = cam.dist * Math.cos(cam.pitch);
  camera.position.set(
    cam.target.x + r * Math.sin(cam.yaw),
    cam.target.y + cam.dist * Math.sin(cam.pitch),
    cam.target.z + r * Math.cos(cam.yaw)
  );
  camera.lookAt(cam.target);
}

/* ライティング */
scene.add(new THREE.AmbientLight(0x8899bb, 0.85));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.25);
sun.position.set(100, 120, 65);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const scam = sun.shadow.camera;
scam.left = -145; scam.right = 145; scam.top = 145; scam.bottom = -145; scam.far = 420;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x5f7fff, 0.3);
fill.position.set(-28, 30, -32);
scene.add(fill);

/* ---------------- ワールド生成 ---------------- */
const worldX = gx => (gx - GRID / 2 + 0.5) * TS;
const worldZ = gz => (gz - GRID / 2 + 0.5) * TS;
const inGrid = (gx, gz) => gx >= 0 && gz >= 0 && gx < GRID && gz < GRID;
const key = (gx, gz) => gx + ',' + gz;

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

let tileIMesh = null;               // 全タイルを1つの InstancedMesh で描画
const _tmpObj = new THREE.Object3D();
const _tmpCol = new THREE.Color();

function createWorld(saved) {
  const seed = saved ? saved.seed : (Math.random() * 1e9) | 0;
  const rand = mulberry32(seed);
  const veins = genOreVeins(rand);
  const elevMap = genElevation(seed);
  tiles = [];
  tileIMesh = new THREE.InstancedMesh(tileGeo, tileMat, GRID * GRID);
  tileIMesh.name = 'tiles';
  tileIMesh.castShadow = true;    // 丘が低地に影を落とす
  tileIMesh.receiveShadow = true;
  tileIMesh.frustumCulled = false; // インスタンス全体が誤ってカリングされるのを防止
  for (let gx = 0; gx < GRID; gx++) {
    tiles[gx] = [];
    for (let gz = 0; gz < GRID; gz++) {
      let ore = null;
      for (const v of veins) {
        const d = Math.hypot(gx - v.cx, gz - v.cz);
        if (d <= v.r) {
          const spec = ORES[v.type];
          ore = { type: v.type, amount: Infinity };
          break;
        }
      }
      tiles[gx][gz] = { depth: 0, elev: elevMap[gx][gz], ore, oreMesh: null };
    }
  }
  scene.add(tileIMesh);
  window._seed = seed;

  if (saved) {
    for (const t of saved.tiles) {
      const tile = tiles[t.x] && tiles[t.x][t.z];
      if (!tile) continue;
      tile.depth = t.d;
      if (t.noOre) tile.ore = null;
    }
  }
  for (let gx = 0; gx < GRID; gx++) for (let gz = 0; gz < GRID; gz++) refreshTile(gx, gz);
}

/* タイル上面のY座標 = (標高 - 掘削深さ) × 層の高さ */
function tileTopY(gx, gz) { const t = tiles[gx][gz]; return (t.elev - t.depth) * LH; }
/* 隣接する機械同士でベルト面が完全に同一平面になりチラつく(Z-fighting)のを防ぐ極小オフセット。
   隣のマスとは必ず異なる値になる(3,5 は 7 と互いに素)ため繋ぎ目がきれいに見える */
const yJitter = (gx, gz) => ((gx * 3 + gz * 5) % 7) * 0.003;
const TILE_BOTTOM_Y = -(MAX_DEPTH + 1) * LH - 0.4; // 全タイル共通の底面

function refreshTile(gx, gz) {
  const t = tiles[gx][gz];
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
  if (exposed && !machines.has(key(gx, gz))) {
    const g = new THREE.Group();
    const spec = ORES[t.ore.type];
    const mat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.35, metalness: 0.6, emissive: spec.color, emissiveIntensity: 0.12 });
    const rock = new THREE.DodecahedronGeometry(0.22);
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
function mulberry32(a) {
  const f = function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  f.seed = a;
  return f;
}

/* ---------------- 共有マテリアル/テクスチャ(メモリ節約&統一感のあるビジュアル) ---------------- */
const sharedMats = {};
function sharedMat(key, factory) {
  if (!sharedMats[key]) sharedMats[key] = factory();
  return sharedMats[key];
}
function makeCanvasTexture(draw, w, h) {
  const c = document.createElement('canvas');
  c.width = w || 64; c.height = h || 64;
  const ctx = c.getContext('2d');
  draw(ctx, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
/* 警告縞テクスチャ(ドリルの土台に使用) */
const stripeTexture = makeCanvasTexture((ctx, w, h) => {
  ctx.fillStyle = '#2b2f38'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffcc33';
  const n = 8;
  for (let i = -1; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * (w / n), h); ctx.lineTo(i * (w / n) + w / n / 2, 0);
    ctx.lineTo(i * (w / n) + w / n, 0); ctx.lineTo(i * (w / n) + w / n / 2, h);
    ctx.closePath(); ctx.fill();
  }
}, 64, 64);
stripeTexture.wrapS = stripeTexture.wrapT = THREE.RepeatWrapping;
stripeTexture.repeat.set(2, 1);
/* ベルトのトレッド模様(コンベア・分岐器・合流機で共有) */
const beltTexture = makeCanvasTexture((ctx, w, h) => {
  ctx.fillStyle = '#242b39'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#333d4f';
  for (let i = 0; i < h; i += 8) ctx.fillRect(0, i, w, 4);
}, 16, 64);
beltTexture.wrapS = beltTexture.wrapT = THREE.RepeatWrapping;
beltTexture.repeat.set(1, 3);
/* 円形グラデーションのパーティクルテクスチャ(煙・土煙・火花で共有) */
function makeRadialTexture(inner, outer) {
  return makeCanvasTexture((ctx, w, h) => {
    const g2 = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g2.addColorStop(0, inner); g2.addColorStop(1, outer);
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); ctx.fill();
  }, 32, 32);
}
const PARTICLE_TEX = {
  smoke: makeRadialTexture('rgba(220,220,220,0.75)', 'rgba(220,220,220,0)'),
  dust:  makeRadialTexture('rgba(150,110,70,0.8)',  'rgba(150,110,70,0)'),
  spark: makeRadialTexture('rgba(255,235,150,1)',   'rgba(255,140,30,0)'),
  fire:  makeRadialTexture('rgba(255,200,80,0.9)',  'rgba(255,60,10,0)'),
};
const particleMatCache = {};
function particleMat(type) {
  if (!particleMatCache[type]) {
    particleMatCache[type] = new THREE.SpriteMaterial({
      map: PARTICLE_TEX[type], transparent: true, depthWrite: false,
      blending: (type === 'spark' || type === 'fire') ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
  }
  return particleMatCache[type];
}

/* ---------------- 機械の3Dモデル ---------------- */
const GEO_DRILL_LEG    = new THREE.CylinderGeometry(0.08, 0.1, 0.3, 6);
const GEO_DRILL_PIPE   = new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6);
const GEO_DRILL_PISTON = new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8);
const GEO_DRILL_LIGHT  = new THREE.SphereGeometry(0.08, 8, 8);
const GEO_INDICATOR    = new THREE.SphereGeometry(0.1, 8, 8);

function buildDrillMesh() {
  const g = new THREE.Group();
  const baseMat  = sharedMat('drillBase',  () => new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: .6, map: stripeTexture }));
  const legMat   = sharedMat('drillLeg',   () => new THREE.MeshStandardMaterial({ color: 0x333c48, roughness: .7, metalness: .3 }));
  const towerMat = sharedMat('drillTower', () => new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: .5 }));
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

  g.userData.piston = piston;
  g.userData.warnLight = light;
  g.userData.dustTimer = 0;
  return g;
}
/* ベルトは「中心→出力側(ローカル+X)」の腕と「中心→入力側」の腕の組み合わせで作る。
   入力側がまっすぐ逆(-X)なら直線ベルト、90°横(+Z/-Z)ならL字カーブベルトになる。
   ※どの向きが実際に繋がるかは実行時(rebuildBeltMesh)に周囲の機械を見て自動判定する。 */
const BELT_ARM = TS * 0.5;
const BELT_W = 1.06;
const GEO_ROLLER_Z = (() => { const g2 = new THREE.CylinderGeometry(0.14, 0.14, BELT_W, 10); g2.rotateX(Math.PI / 2); return g2; })();
const GEO_ROLLER_X = (() => { const g2 = new THREE.CylinderGeometry(0.14, 0.14, BELT_W, 10); g2.rotateZ(Math.PI / 2); return g2; })();
function beltArmMesh(axis, sign, mat) {
  const len = BELT_ARM + 0.05;
  const geo = axis === 'x' ? new THREE.BoxGeometry(len, 0.16, BELT_W) : new THREE.BoxGeometry(BELT_W, 0.16, len);
  const m = new THREE.Mesh(geo, mat);
  if (axis === 'x') m.position.set(sign * len / 2, 0.1, 0); else m.position.set(0, 0.1, sign * len / 2);
  m.receiveShadow = true;
  return m;
}
function beltRailMesh(axis, sign, side, mat) {
  const len = BELT_ARM + 0.05;
  const geo = axis === 'x' ? new THREE.BoxGeometry(len, 0.1, 0.12) : new THREE.BoxGeometry(0.12, 0.1, len);
  const r = new THREE.Mesh(geo, mat);
  if (axis === 'x') r.position.set(sign * len / 2, 0.2, side * 0.56); else r.position.set(side * 0.56, 0.2, sign * len / 2);
  return r;
}
function beltRollerMesh(axis, sign, mat) {
  const len = BELT_ARM + 0.05;
  const geo = axis === 'x' ? GEO_ROLLER_Z : GEO_ROLLER_X;
  const roller = new THREE.Mesh(geo, mat);
  if (axis === 'x') roller.position.set(sign * len, 0.17, 0); else roller.position.set(0, 0.17, sign * len);
  roller.castShadow = true;
  roller.userData.spinAxis = axis === 'x' ? 'z' : 'x';
  return roller;
}
/* shape: 'straight'(まっすぐ) | 'left'(ローカル+Z側から受けて+Xへ) | 'right'(ローカル-Z側から受けて+Xへ) */

function addPortArrow(g, localDir, label, color, y) {
  const mat = sharedMat('portArrow' + label + color, () => new THREE.MeshBasicMaterial({ color }));
  const d = DIRS[localDir];
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.34, 3), mat);
  arrow.position.set(d.x * 0.82, y || 0.82, d.z * 0.82);
  if (localDir === 0) arrow.rotation.z = -Math.PI / 2;
  else if (localDir === 2) arrow.rotation.z = Math.PI / 2;
  else arrow.rotation.x = localDir === 1 ? Math.PI / 2 : -Math.PI / 2;
  arrow.name = 'port-' + label;
  g.add(arrow);
  return arrow;
}
function addPortPad(g, x, z, color, name) {
  const mat = sharedMat('portPad' + name + color, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .18, roughness: .45 }));
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.34), mat);
  pad.position.set(x, 0.08, z);
  pad.name = 'port-' + name;
  g.add(pad);
  return pad;
}

function buildConveyorMeshShaped(shape) {
  const g = new THREE.Group();
  const beltMat = sharedMat('beltSurface', () => new THREE.MeshStandardMaterial({ color: 0x2a3242, roughness: .8, map: beltTexture }));
  const railMat = sharedMat('beltRail', () => new THREE.MeshStandardMaterial({ color: 0x525f76, metalness: .3, roughness: .5 }));
  const rollerMat = sharedMat('beltRoller', () => new THREE.MeshStandardMaterial({ color: 0x8b95ab, metalness: .5, roughness: .35 }));
  const rollers = [];
  g.add(beltArmMesh('x', 1, beltMat)); // 出力側の腕は常にある
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
    // ハブは腕よりわずかに高くして角をなめらかに繋ぐ(同一平面によるチラつき防止)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.2, 14), beltMat);
    hub.position.y = 0.11; hub.receiveShadow = true; g.add(hub);
    const rIn = beltRollerMesh('z', zSign, rollerMat); g.add(rIn); rollers.push(rIn);
  }
  const arrowMat = sharedMat('beltArrow', () => new THREE.MeshBasicMaterial({ color: 0xffc23e }));
  const aOut = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.28, 3), arrowMat);
  aOut.rotation.z = -Math.PI / 2; // 先端が出力方向(+X)を向く
  aOut.position.set(0.2, 0.19, 0); aOut.name = 'arrowOut';
  g.add(aOut);
  const aIn = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.28, 3), arrowMat);
  aIn.name = 'arrowIn';
  if (shape === 'straight') {
    aIn.rotation.z = -Math.PI / 2; // 直線: 流れと同じ +X 向き
    aIn.position.set(-0.55, 0.19, 0);
  } else {
    const zSign = shape === 'left' ? 1 : -1;
    aIn.rotation.x = zSign > 0 ? -Math.PI / 2 : Math.PI / 2; // 入口から中心へ向かう向き
    aIn.position.set(0, 0.19, zSign * 0.55);
  }
  g.add(aIn);
  g.userData.beltShape = shape;
  g.userData.rollers = rollers;
  return g;
}
function buildFilterConveyorMeshShaped() {
  const g = new THREE.Group();
  const beltMat = sharedMat('beltSurface', () => new THREE.MeshStandardMaterial({ color: 0x2a3242, roughness: .8, map: beltTexture }));
  const railMat = sharedMat('beltRail', () => new THREE.MeshStandardMaterial({ color: 0x525f76, metalness: .3, roughness: .5 }));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.54, 0.18, 14), beltMat);
  hub.position.y = 0.11; hub.receiveShadow = true; g.add(hub);
  // 正面=一致アイテム、左右=不一致アイテムの3分岐ソーター
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
  gem.position.set(0, 0.38, 0);
  gem.name = 'filterGem';
  g.add(gem);
  g.userData.beltShape = 'filter3';
  return g;
}
function buildSmelterMesh() {
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

  // 炉の窓(名前'fire'は既存の更新ロジックと互換を維持)
  const fire = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.1), new THREE.MeshStandardMaterial({ color: 0xff7422, emissive: 0xff4400, emissiveIntensity: 0.15, map: PARTICLE_TEX.fire, transparent: true }));
  fire.position.set(0, 0.35, 0.81); fire.name = 'fire'; g.add(fire);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.65, 0.06), grateMat);
  frame.position.set(0, 0.35, 0.85); g.add(frame);

  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.8), chimneyMat);
  chimney.position.set(-0.45, 1.35, -0.45); chimney.castShadow = true; g.add(chimney);
  const chimneyRim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1), chimneyMat);
  chimneyRim.position.set(-0.45, 1.75, -0.45); g.add(chimneyRim);

  g.userData.smokeAnchor = new THREE.Vector3(-0.45, 1.85, -0.45);
  g.userData.smokeTimer = 0;
  return g;
}
function buildSellerMesh() {
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

  g.userData.coin = coin;
  g.userData.sign = sign;
  addPortPad(g, -0.72, 0, 0x7dffa0, 'input-a');
  addPortPad(g, 0.72, 0, 0x7dffa0, 'input-b');
  addPortPad(g, 0, 0.72, 0x7dffa0, 'input-c');
  addPortPad(g, 0, -0.72, 0x7dffa0, 'input-d');
  return g;
}
function buildGeneratorMesh() {
  const g = new THREE.Group();
  const baseMat = sharedMat('genBase', () => new THREE.MeshStandardMaterial({ color: 0x334155, roughness: .55, metalness: .2 }));
  const coilMat = sharedMat('genCoil', () => new THREE.MeshStandardMaterial({ color: 0xffc23e, emissive: 0xff8c00, emissiveIntensity: .35, roughness: .35 }));
  const poleMat = sharedMat('genPole', () => new THREE.MeshStandardMaterial({ color: 0x8b95ab, metalness: .6, roughness: .3 }));
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.55, 1.25), baseMat);
  base.position.y = 0.28; base.castShadow = true; base.receiveShadow = true; g.add(base);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.08, 10, 20), coilMat);
  coil.position.set(0, 0.75, 0); coil.rotation.x = Math.PI / 2; coil.castShadow = true; coil.name = 'coil'; g.add(coil);
  for (const x of [-0.42, 0.42]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.65, 8), poleMat);
    pole.position.set(x, 0.78, 0); pole.castShadow = true; g.add(pole);
  }
  return g;
}

function buildSplitterMesh() {
  // 分岐器: 中心ハブ + 前・左・右の3方向へ短いベルト状の腕 + 出力インジケーター
  const g = new THREE.Group();
  const hubMat = sharedMat('splitterHub', () => new THREE.MeshStandardMaterial({ color: 0x3a4a63, roughness: .6 }));
  const beltMat = sharedMat('beltSurface', () => new THREE.MeshStandardMaterial({ color: 0x2a3242, roughness: .8, map: beltTexture }));
  const capMat = sharedMat('splitterCap', () => new THREE.MeshStandardMaterial({ color: 0x54637f, metalness: .4, roughness: .5 }));

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.55, 0.24, 8), hubMat);
  hub.position.y = 0.12; hub.castShadow = true; g.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 8), capMat);
  cap.position.y = 0.28; cap.name = 'cap'; g.add(cap);

  const outs = [ {x:1,z:0}, {x:0,z:1}, {x:0,z:-1} ]; // 正面・横・横(ローカル座標。設置時にグループごと回転)
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
function buildMergerMesh() {
  // 合流機: 中心ハブ + 背面/左/右から受け取り、正面へ1本の太い出力 + 入力インジケーター
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
function buildChestMesh() {
  const g = new THREE.Group();
  const woodMat = sharedMat('chestWood', () => new THREE.MeshStandardMaterial({ color: 0x8a5a2e, roughness: .75 }));
  const trimMat = sharedMat('chestTrim', () => new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: .7, metalness: .1 }));
  const lockMat = sharedMat('chestLock', () => new THREE.MeshStandardMaterial({ color: 0xd8b23a, metalness: .7, roughness: .3 }));

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 1.1), woodMat);
  body.position.y = 0.35; body.castShadow = true; g.add(body);

  // 蓋は奥側のヒンジを中心に開閉できるようピボット越しに取り付ける
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.7, -0.55);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.22, 1.14), trimMat);
  lid.position.set(0, 0.11, 0.57);
  lid.castShadow = true;
  lidPivot.add(lid);
  g.add(lidPivot);

  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.1), lockMat);
  lock.position.set(0, 0.55, 0.56); lock.name = 'lock'; g.add(lock);

  g.userData.lidPivot = lidPivot;
  g.userData.lidOpen = 0;
  addPortArrow(g, 0, 'out', 0xffc23e, 0.9);
  addPortPad(g, -0.72, 0, 0x66d9ff, 'input');
  return g;
}
function updateFilterGem(m) {
  const gem = m.mesh.getObjectByName('filterGem');
  if (!gem) return;
  gem.material.color.setHex(m.filter && ORES[m.filter] ? ORES[m.filter].color : 0xffffff);
}
const MESH_BUILDERS = { drill: buildDrillMesh, conveyor: () => buildConveyorMeshShaped('straight'), smelter: buildSmelterMesh, seller: buildSellerMesh, splitter: buildSplitterMesh, merger: buildMergerMesh, chest: buildChestMesh, filterConveyor: () => buildFilterConveyorMeshShaped('straight'), generator: buildGeneratorMesh };

/* ---------------- 機械ロジック ---------------- */
function placeMachine(type, gx, gz, dir, silent) {
  if (!inGrid(gx, gz) || machines.has(key(gx, gz))) { if (!silent) toast('そこには置けないよ', 'error'); return false; }
  const t = tiles[gx][gz];
  // ロード時(silent)は露出チェックをスキップ
  if (type === 'drill' && !silent) {
    const exposed = t.ore && ORES[t.ore.type].depth === t.depth;
    if (!exposed) { toast('ドリルは露出した鉱石の上に設置!', 'error'); return false; }
  }
  if (!silent && money < COSTS[type]) { toast('お金が足りない… $' + COSTS[type] + ' 必要', 'error'); return false; }
  if (!silent) addMoney(-COSTS[type]);

  // 通常コンベア/フィルターコンベアは、近くの接続可能な機械へ自動で向きを合わせる(曲がる)
  let placeDir = dir;
  if (!silent && (type === 'conveyor' || type === 'filterConveyor')) {
    placeDir = chooseAutoDir(gx, gz, dir);
  }

  const mesh = MESH_BUILDERS[type]();
  mesh.position.set(worldX(gx), tileTopY(gx, gz) + yJitter(gx, gz), worldZ(gz));
  mesh.rotation.y = -placeDir * Math.PI / 2;
  scene.add(mesh);
  const m = {
    type, gx, gz, dir: placeDir, mesh, timer: 0, item: null, buffer: [], progress: 0, processing: null,
    incoming: 0,                                        // この機械へ移動中のアイテム数(バッファ溢れ防止)
    outIndex: 0,                                        // 分岐器の出力ラウンドロビン用ポインタ
    rejectIndex: 0,                                     // フィルター分岐の不一致出力切替
    storage: {}, cap: 300,                              // チェスト用の保管庫
    filter: type === 'filterConveyor' ? selectedFilter : undefined, // フィルターコンベア用の対象鉱石
  };
  machines.set(key(gx, gz), m);
  if (type === 'filterConveyor') updateFilterGem(m);
  refreshTile(gx, gz);
  if (!silent) {
    tryAutoConnectNeighbors(gx, gz); // 周囲の行き先を見失っているコンベアをこの新しい機械へ自動接続
    sfx('place');
    if (type === 'drill' && t.ore) toast('ドリルを設置!(' + ORES[t.ore.type].name + ' 無限鉱脈)', 'good');
    else toast(toolLabel(type) + 'を設置!', 'good');
  }
  rebuildBeltsAround(gx, gz); // 自分と周囲のコンベアの繋ぎ目(直線/カーブ)を再構築
  markPowerDirty();
  updatePowerStatus(true);
  return true;
}

function removeMachine(gx, gz) {
  const m = machines.get(key(gx, gz));
  if (!m) return false;
  scene.remove(m.mesh);
  if (m.item) destroyItem(m.item);
  if (m.processing) m.processing = null;
  machines.delete(key(gx, gz));
  addMoney(Math.floor((COSTS[m.type] || 0) * 0.5));
  refreshTile(gx, gz);
  markPowerDirty();
  updatePowerStatus(true);
  rebuildBeltsAround(gx, gz); // 撤去で入力が変わった周囲のコンベア形状を更新
  sfx('demolish');
  toast(toolLabel(m.type) + 'を撤去(50%返金)', 'good');
  return true;
}

function toolLabel(t) {
  return { dig: '掘削', drill: 'ドリル', conveyor: 'コンベア', smelter: '精錬炉', seller: '販売機', demolish: '撤去', splitter: '分岐器', merger: '合流機', chest: 'チェスト', filterConveyor: 'フィルターコンベア', generator: '発電機' }[t] || t;
}

/* ---------------- アイテム ---------------- */
const itemGeoOre = new THREE.DodecahedronGeometry(0.24);
const itemGeoIngot = new THREE.BoxGeometry(0.42, 0.2, 0.26);
const itemMats = {};
function itemMaterial(type, ingot) {
  const k = type + (ingot ? '_i' : '');
  if (!itemMats[k]) {
    const spec = ORES[type];
    itemMats[k] = new THREE.MeshStandardMaterial({
      color: ingot ? spec.ingotColor : spec.color,
      metalness: ingot ? 0.9 : 0.5, roughness: ingot ? 0.25 : 0.5,
      emissive: ingot ? spec.ingotColor : 0x000000, emissiveIntensity: ingot ? 0.15 : 0,
    });
  }
  return itemMats[k];
}

function spawnItem(oreType, ingot, gx, gz) {
  const mesh = new THREE.Mesh(ingot ? itemGeoIngot : itemGeoOre, itemMaterial(oreType, ingot));
  mesh.castShadow = true;
  const y = tileTopY(gx, gz) + 0.35;
  mesh.position.set(worldX(gx), y, worldZ(gz));
  scene.add(mesh);
  return { oreType, ingot, mesh, gx, gz, moving: false, t: 0, from: null, to: null };
}
function destroyItem(it) {
  scene.remove(it.mesh);
  const i = items.indexOf(it);
  if (i >= 0) items.splice(i, 1);
}
function itemValue(it) { return it.ingot ? ORES[it.oreType].ingotValue : ORES[it.oreType].oreValue; }

/* 高さ判定: 地表レベル(標高-掘削深さ)の差が1以内なら接続可能 */
function heightOk(gx1, gz1, gx2, gz2) {
  if (!inGrid(gx1, gz1) || !inGrid(gx2, gz2)) return false;
  const l1 = tiles[gx1][gz1].elev - tiles[gx1][gz1].depth;
  const l2 = tiles[gx2][gz2].elev - tiles[gx2][gz2].depth;
  return Math.abs(l1 - l2) <= 1;
}
function chestTotal(m) {
  let sum = 0;
  for (const k in m.storage) sum += m.storage[k];
  return sum;
}

/* ---------------- コンベアの自動接続(曲げ) ---------------- */
// 向きを合わせれば接続を受け取れる可能性がある機械の種類
const ACCEPT_TYPES = new Set(['conveyor', 'filterConveyor', 'splitter', 'merger', 'smelter', 'seller', 'chest']);
function isAcceptCapable(type) { return ACCEPT_TYPES.has(type); }

/* 機械がアイテムを送り出す方向の一覧(販売機は消費するだけで出力なし) */
function outputDirsOf(m) {
  if (!m || m.dir === undefined || m.type === 'seller') return [];
  if (m.type === 'splitter' || m.type === 'filterConveyor') return [m.dir, (m.dir + 1) % 4, (m.dir + 3) % 4];
  return [m.dir];
}
/* (fromGx,fromGz) から機械 target へアイテムを送り込める配置かどうか。
   相手の出力方向からの送り込み(向かい合ったコンベアの永久往復などのバグ)を禁止 */
function connectionOk(target, fromGx, fromGz) {
  if (!target || !isAcceptCapable(target.type)) return false;
  if (!heightOk(fromGx, fromGz, target.gx, target.gz)) return false;
  if (target.type === 'seller') return true; // 販売機は全方向から受け取れる
  for (const d of outputDirsOf(target)) {
    if (fromGx === target.gx + DIRS[d].x && fromGz === target.gz + DIRS[d].z) return false;
  }
  return true;
}

/* (gx,gz) に隣接する機械の中で、出力方向がちょうどここを指しているものを探し、
   その来ている向き(0=E,1=S,2=W,3=N)を返す。無ければ -1 */
function incomingDir(gx, gz) {
  for (let k = 0; k < 4; k++) {
    const nx = gx + DIRS[k].x, nz = gz + DIRS[k].z;
    const nb = machines.get(key(nx, nz));
    // 分岐器の左右出力も「流れ込み」として認識し、届かない高低差は無視する
    if (nb && outputDirsOf(nb).includes((k + 2) % 4) && heightOk(gx, gz, nx, nz)) return k;
  }
  return -1;
}

/* コンベア/フィルターコンベア設置時、周囲の接続可能な機械へ自動的に向きを合わせる(曲がる)。
   1) 既に流れ込んでくる機械があれば、まっすぐ抜ける方向を優先しつつ左右の受け入れ先も探す
   2) 流れ込みがなければ、手動で選んだ向き→周囲の受け入れ先の順で探す */
function chooseAutoDir(gx, gz, manualDir) {
  const inK = incomingDir(gx, gz);
  const tryDirs = [];
  if (inK !== -1) {
    const straight = (inK + 2) % 4;
    tryDirs.push(straight, (straight + 1) % 4, (straight + 3) % 4);
  } else {
    tryDirs.push(manualDir);
  }
  if (!tryDirs.includes(manualDir)) tryDirs.push(manualDir);
  for (let d = 0; d < 4; d++) if (!tryDirs.includes(d)) tryDirs.push(d);

  for (const d of tryDirs) {
    if (inK !== -1 && d === inK) continue; // 来た方向へは吐き出さない
    const nx = gx + DIRS[d].x, nz = gz + DIRS[d].z;
    const nb = machines.get(key(nx, nz));
    if (connectionOk(nb, gx, gz)) return d;
  }
  // どこにも繋がらない場合、入力元へ吐き出す向きにだけはしない(逆流防止)
  if (inK !== -1 && manualDir === inK) return (inK + 2) % 4;
  return manualDir;
}

/* 新しい機械を (gx,gz) に置いた直後、隣接するコンベア/フィルターコンベアのうち
   現在の出力先が無効(何も繋がっていない/受け取れない)なものを、この新しい機械へ向け直す */
function tryAutoConnectNeighbors(gx, gz) {
  for (let k = 0; k < 4; k++) {
    const nx = gx + DIRS[k].x, nz = gz + DIRS[k].z;
    if (!inGrid(nx, nz)) continue;
    const nb = machines.get(key(nx, nz));
    if (!nb || (nb.type !== 'conveyor' && nb.type !== 'filterConveyor')) continue;
    const dirToNew = (k + 2) % 4; // このコンベアから見て新しい機械がある向き
    const curTx = nb.gx + DIRS[nb.dir].x, curTz = nb.gz + DIRS[nb.dir].z;
    const curTarget = machines.get(key(curTx, curTz));
    const curValid = connectionOk(curTarget, nb.gx, nb.gz);
    if (curValid) continue; // 既に正しく接続済みなら変更しない
    const inK = incomingDir(nb.gx, nb.gz);
    if (inK === dirToNew) continue; // 入力元へ向けてしまうのは避ける
    const target = machines.get(key(gx, gz));
    if (connectionOk(target, nb.gx, nb.gz)) {
      nb.dir = dirToNew;
      nb.mesh.rotation.y = -nb.dir * Math.PI / 2;
    }
  }
}

/* ---------------- コンベアの繋ぎ目(直線/L字カーブ)の自動更新 ----------------
   周囲の機械の出力がどの向きから流れ込んでくるかを調べ、
   直線ベルト / L字カーブベルト のメッシュを貼り替える。設置・撤去・回転のたびに呼ぶ */
function incomingDirsAll(gx, gz) {
  const res = [];
  for (let k = 0; k < 4; k++) {
    const nx = gx + DIRS[k].x, nz = gz + DIRS[k].z;
    const nb = machines.get(key(nx, nz));
    if (!nb) continue;
    // 分岐器の3方向出力も繋ぎ目として扱う。出力を持たない販売機は無視(ベルト形状の誤判定修正)
    if (outputDirsOf(nb).includes((k + 2) % 4) && heightOk(gx, gz, nx, nz)) res.push(k);
  }
  return res;
}
function beltShapeFor(m) {
  const ins = incomingDirsAll(m.gx, m.gz);
  if (ins.length === 0 || ins.includes((m.dir + 2) % 4)) return 'straight'; // 真後ろから来ていれば直線
  if (ins.includes((m.dir + 1) % 4)) return 'left';   // ローカル+Z側から受けるカーブ
  if (ins.includes((m.dir + 3) % 4)) return 'right';  // ローカル-Z側から受けるカーブ
  return 'straight';
}

function localArmForDir(m, globalDir) {
  const rel = (globalDir - m.dir + 4) % 4;
  if (rel === 0) return { axis: 'x', sign: 1 };
  if (rel === 1) return { axis: 'z', sign: 1 };
  if (rel === 2) return { axis: 'x', sign: -1 };
  return { axis: 'z', sign: -1 };
}
function addGradeOverlays(m) {
  if (!m.mesh || (m.type !== 'conveyor' && m.type !== 'filterConveyor')) return;
  const old = m.mesh.getObjectByName('gradeOverlays');
  if (old) m.mesh.remove(old);
  const group = new THREE.Group();
  group.name = 'gradeOverlays';
  const mat = sharedMat('beltGrade', () => new THREE.MeshStandardMaterial({ color: 0x5f6f93, metalness: .35, roughness: .45 }));
  const dirs = [m.dir, ...incomingDirsAll(m.gx, m.gz)];
  const seen = new Set();
  for (const d of dirs) {
    if (seen.has(d)) continue; seen.add(d);
    const nx = m.gx + DIRS[d].x, nz = m.gz + DIRS[d].z;
    if (!inGrid(nx, nz) || !heightOk(m.gx, m.gz, nx, nz)) continue;
    const delta = tileTopY(nx, nz) - tileTopY(m.gx, m.gz);
    if (Math.abs(delta) < 0.01) continue;
    const arm = localArmForDir(m, d);
    const len = BELT_ARM + 0.18;
    const geo = arm.axis === 'x' ? new THREE.BoxGeometry(len, 0.08, BELT_W * 0.92) : new THREE.BoxGeometry(BELT_W * 0.92, 0.08, len);
    const ramp = new THREE.Mesh(geo, mat);
    if (arm.axis === 'x') {
      ramp.position.set(arm.sign * len / 2, 0.23 + delta / 2, 0);
      ramp.rotation.z = -arm.sign * Math.atan2(delta, len);
    } else {
      ramp.position.set(0, 0.23 + delta / 2, arm.sign * len / 2);
      ramp.rotation.x = arm.sign * Math.atan2(delta, len);
    }
    ramp.receiveShadow = true;
    group.add(ramp);
  }
  if (group.children.length) m.mesh.add(group);
}

function rebuildBeltMesh(m) {
  if (m.type !== 'conveyor' && m.type !== 'filterConveyor') return;
  const shape = m.type === 'filterConveyor' ? 'filter3' : beltShapeFor(m);
  if (m.mesh && m.mesh.userData.beltShape === shape) {
    m.mesh.rotation.y = -m.dir * Math.PI / 2; // 向きだけ変わった場合の同期
    addGradeOverlays(m);
    return;
  }
  const old = m.mesh;
  const nm = m.type === 'conveyor' ? buildConveyorMeshShaped(shape) : buildFilterConveyorMeshShaped();
  nm.position.copy(old.position);
  nm.rotation.y = -m.dir * Math.PI / 2;
  scene.remove(old);
  scene.add(nm);
  m.mesh = nm;
  if (m.type === 'filterConveyor') updateFilterGem(m);
  addGradeOverlays(m);
}
function rebuildBeltsAround(gx, gz) {
  const self = machines.get(key(gx, gz));
  if (self) rebuildBeltMesh(self);
  for (let k = 0; k < 4; k++) {
    const nb = machines.get(key(gx + DIRS[k].x, gz + DIRS[k].z));
    if (nb) rebuildBeltMesh(nb);
  }
}

/* 受け入れ判定(fromGx/fromGzは送り出す側のマス座標。高低差チェックに使用) */
function canAccept(m, it, fromGx, fromGz) {
  if (!m) return false;
  if (!connectionOk(m, fromGx, fromGz)) return false; // 高低差・逆流を禁止
  if (m.type === 'conveyor' || m.type === 'splitter') return !m.item;
  if (m.type === 'filterConveyor') return !m.item;
  if (m.type === 'smelter') return !it.ingot && m.buffer.length + m.incoming < 2; // 移動中の分も数えて溢れ防止
  if (m.type === 'merger') return m.buffer.length + m.incoming < 4;
  if (m.type === 'chest') return chestTotal(m) + m.incoming < m.cap;
  if (m.type === 'seller') return true;
  return false;
}

/* item を機械 m のセルへ送る(占有処理込み) */
function sendItemTo(it, m) {
  it.from = it.mesh.position.clone();
  it.to = new THREE.Vector3(worldX(m.gx), tileTopY(m.gx, m.gz) + 0.35, worldZ(m.gz));
  it.t = 0;
  it.moving = true;
  it.destKey = key(m.gx, m.gz);
  if (m.type === 'conveyor' || m.type === 'splitter' || m.type === 'filterConveyor') m.item = it; // 予約
  else if (m.type === 'smelter' || m.type === 'merger' || m.type === 'chest') m.incoming++;       // 到着前の予約数
}

function arriveItem(it) {
  it.moving = false;
  const m = machines.get(it.destKey);
  if (!m) { destroyItem(it); return; }
  it.gx = m.gx; it.gz = m.gz;
  if ((m.type === 'smelter' || m.type === 'merger' || m.type === 'chest') && m.incoming > 0) m.incoming--;
  if (m.type === 'seller') {
    const v = itemValue(it);
    earn(v);
    sfx('sell');
    spawnFloater('+$' + v, m.mesh.position.clone().add(new THREE.Vector3(0, 1.4, 0)), '#7dffa8');
    const burstPos = m.mesh.position.clone().add(new THREE.Vector3(0, 1.0, 0));
    for (let i = 0; i < 5; i++) {
      spawnParticle('spark', burstPos, { life: 0.5, scale: 0.16, vel: new THREE.Vector3((Math.random() - 0.5) * 1.6, 1.2 + Math.random(), (Math.random() - 0.5) * 1.6), grow: 0.5 });
    }
    destroyItem(it);
  } else if (m.type === 'smelter') {
    m.buffer.push({ oreType: it.oreType });
    destroyItem(it);
  } else if (m.type === 'merger') {
    m.buffer.push({ oreType: it.oreType, ingot: it.ingot });
    destroyItem(it);
  } else if (m.type === 'chest') {
    const k = it.oreType + (it.ingot ? '_i' : '_o');
    m.storage[k] = (m.storage[k] || 0) + 1;
    destroyItem(it);
  }
  // conveyor / splitter / filterConveyor: そのまま滞留、updateで次へ
}

/* ---------------- パーティクル(煙・土煙・火花) ---------------- */
let particles = [];
const MAX_PARTICLES = 180;
function spawnParticle(type, pos, opts) {
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
function updateParticles(dt) {
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


function markPowerDirty() { powerDirty = true; }
function updatePowerStatus(force) {
  if (!force && !powerDirty) return;
  let capacity = 0, used = 0;
  for (const m of machines.values()) {
    capacity += POWER_OUTPUT[m.type] || 0;
    used += POWER_USE[m.type] || 0;
  }
  powerDirty = false;
  power = { used, capacity, ok: used <= capacity };
  const el = document.getElementById('power-value');
  const box = document.getElementById('power-display');
  if (el) el.textContent = used + '/' + capacity;
  if (box) {
    box.classList.toggle('power-low', !power.ok);
    box.title = power.ok ? '電力: 使用量 / 発電量' : '電力不足: ドリルと精錬炉が停止中';
  }
  updateStatus();
}
function hasPowerFor(m) {
  return (POWER_USE[m.type] || 0) === 0 || power.ok;
}

/* ---------------- 更新ループ ---------------- */
function updateMachines(dt) {
  updatePowerStatus(false);
  for (const m of machines.values()) {
    if (m.type === 'drill') {
      if (!hasPowerFor(m)) { const warnLight = m.mesh.userData.warnLight; if (warnLight) warnLight.material.emissiveIntensity = 1.1; continue; }
      const bit = m.mesh.getObjectByName('bit');
      const piston = m.mesh.userData.piston;
      const warnLight = m.mesh.userData.warnLight;
      const t = tiles[m.gx][m.gz];
      const hasOre = t.ore && ORES[t.ore.type].depth === t.depth;
      if (hasOre) {
        const bob = Math.sin(time * 6);
        if (bit) { bit.rotation.y += dt * 9; bit.position.y = 0.42 + bob * 0.07; }
        if (piston) piston.scale.y = 1 + bob * 0.12;
        if (warnLight) warnLight.material.emissiveIntensity = 0.4 + Math.sin(time * 5) * 0.35;
        // 掘削中の土煙パーティクル(採掘ビットの位置から時々発生)
        m.mesh.userData.dustTimer = (m.mesh.userData.dustTimer || 0) + dt;
        if (m.mesh.userData.dustTimer > 0.35) {
          m.mesh.userData.dustTimer = 0;
          spawnParticle('dust', new THREE.Vector3(worldX(m.gx), tileTopY(m.gx, m.gz) + 0.15, worldZ(m.gz)), { life: 0.6, scale: 0.35, vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.6, (Math.random() - 0.5) * 0.6) });
        }
        m.timer += dt;
        if (m.timer >= DRILL_INTERVAL) {
          const outKey = key(m.gx + DIRS[m.dir].x, m.gz + DIRS[m.dir].z);
          const target = machines.get(outKey);
          const dummy = { oreType: t.ore.type, ingot: false };
          if (canAccept(target, dummy, m.gx, m.gz)) {
            m.timer = 0;
            const it = spawnItem(t.ore.type, false, m.gx, m.gz);
            it.mesh.position.y += 0.35;
            items.push(it);
            sendItemTo(it, target);
            spawnParticle('dust', new THREE.Vector3(worldX(m.gx), tileTopY(m.gx, m.gz) + 0.3, worldZ(m.gz)), { life: 0.7, scale: 0.45 });
          }
        }
      } else if (warnLight) warnLight.material.emissiveIntensity *= 0.9;
    }
    else if (m.type === 'smelter') {
      if (!hasPowerFor(m)) continue;
      const fire = m.mesh.getObjectByName('fire');
      if (!m.processing && m.buffer.length > 0) {
        m.processing = m.buffer.shift();
        m.progress = 0;
      }
      if (m.processing) {
        m.progress += dt;
        if (fire) fire.material.color.setHSL(0.06, 1, 0.5 + Math.sin(time * 10) * 0.15);
        // 煙突から煙パーティクル
        m.mesh.userData.smokeTimer = (m.mesh.userData.smokeTimer || 0) + dt;
        if (m.mesh.userData.smokeTimer > 0.3) {
          m.mesh.userData.smokeTimer = 0;
          const anchor = m.mesh.userData.smokeAnchor;
          const wp = m.mesh.localToWorld(anchor.clone());
          spawnParticle('smoke', wp, { life: 1.4, scale: 0.3, vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.9, (Math.random() - 0.5) * 0.2), grow: 0.7 });
        }
        // 精錬中は炉の窓から火花が時々舞う
        if (Math.random() < dt * 2) {
          const fp = m.mesh.localToWorld(new THREE.Vector3(0, 0.35, 0.85));
          spawnParticle('spark', fp, { life: 0.4, scale: 0.14, vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random(), (Math.random() - 0.5) * 0.6 + 0.6), grow: 0.4 });
        }
        if (m.progress >= SMELT_TIME) {
          const outKey = key(m.gx + DIRS[m.dir].x, m.gz + DIRS[m.dir].z);
          const target = machines.get(outKey);
          const dummy = { oreType: m.processing.oreType, ingot: true };
          if (canAccept(target, dummy, m.gx, m.gz)) {
            const it = spawnItem(m.processing.oreType, true, m.gx, m.gz);
            it.mesh.position.y += 0.6;
            items.push(it);
            sendItemTo(it, target);
            m.processing = null;
          }
        }
      } else if (fire) fire.material.color.set(0x772d10);
    }
    else if (m.type === 'conveyor' || m.type === 'filterConveyor') {
      // ベルト矢印アニメ(直線: 入口→出口 / カーブ: 入口→中心、中心→出口 と流れる)
      const cyc = (time * 1.1) % 1;
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
      if (rollers) for (const r of rollers) {
        if (r.userData.spinAxis === 'z') r.rotation.z += dt * 6; else r.rotation.x += dt * 6;
      }
      // フィルターコンベアの宝石をゆっくり回転
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
          const nk = key(m.gx + DIRS[d].x, m.gz + DIRS[d].z);
          const next = machines.get(nk);
          if (canAccept(next, m.item, m.gx, m.gz)) {
            const it = m.item;
            m.item = null;
            if (m.type === 'filterConveyor' && outDirs.length > 1) m.rejectIndex = (idx + 1) % outDirs.length;
            sendItemTo(it, next);
            break;
          }
        }
      }
    }
    else if (m.type === 'splitter') {
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
          const nk = key(m.gx + DIRS[d].x, m.gz + DIRS[d].z);
          const next = machines.get(nk);
          if (canAccept(next, m.item, m.gx, m.gz)) {
            const it = m.item;
            m.item = null;
            sendItemTo(it, next);
            m.outIndex = (idx + 1) % 3;
            if (indicators && indicators[idx]) {
              indicators[idx].material.emissiveIntensity = 1.0;
              indicators[idx].userData.flashUntil = time + 0.3;
            }
            break;
          }
        }
      }
      if (indicators) for (const light of indicators) {
        if (light.userData.flashUntil && time > light.userData.flashUntil) { light.material.emissiveIntensity = 0.3; light.userData.flashUntil = null; }
      }
    }
    else if (m.type === 'merger') {
      // 背面/左/右から集めたアイテムを、正面(dir)へ1つずつ送り出す
      const indicators = m.mesh.userData.indicators;
      if (indicators) for (const light of indicators) {
        const targetInt = m.buffer.length > 0 ? (0.15 + Math.sin(time * 4) * 0.1) : 0.15;
        light.material.emissiveIntensity += (targetInt - light.material.emissiveIntensity) * Math.min(1, dt * 4);
      }
      const outArrow = m.mesh.getObjectByName('outArrow');
      if (outArrow) outArrow.position.x = 1.0 + Math.sin(time * 6) * 0.04;
      if (m.buffer.length > 0) {
        const outKey = key(m.gx + DIRS[m.dir].x, m.gz + DIRS[m.dir].z);
        const target = machines.get(outKey);
        const dummy = m.buffer[0];
        if (canAccept(target, dummy, m.gx, m.gz)) {
          const entry = m.buffer.shift();
          const it = spawnItem(entry.oreType, entry.ingot, m.gx, m.gz);
          it.mesh.position.y += entry.ingot ? 0.6 : 0.35;
          items.push(it);
          sendItemTo(it, target);
        }
      }
    }
    else if (m.type === 'chest') {
      // 保管したアイテムを少しずつ正面(dir)へ自動排出(手動売却はタップで即時)
      // 蓋は在庫があるとわずかに開いた状態でカタカタ振動する演出
      const lidPivot = m.mesh.userData.lidPivot;
      if (lidPivot) {
        const hasStock = chestTotal(m) > 0;
        const targetOpen = hasStock ? 0.12 + Math.sin(time * 8) * 0.04 : 0;
        m.mesh.userData.lidOpen += (targetOpen - m.mesh.userData.lidOpen) * Math.min(1, dt * 6);
        lidPivot.rotation.x = -m.mesh.userData.lidOpen;
      }
      m.timer += dt;
      if (m.timer >= 0.8) {
        m.timer = 0;
        const stockKey = Object.keys(m.storage).find(k => m.storage[k] > 0);
        if (stockKey) {
          const outKey = key(m.gx + DIRS[m.dir].x, m.gz + DIRS[m.dir].z);
          const target = machines.get(outKey);
          const ingot = stockKey.endsWith('_i');
          const oreType = stockKey.slice(0, -2);
          const dummy = { oreType, ingot };
          if (canAccept(target, dummy, m.gx, m.gz)) {
            m.storage[stockKey]--;
            if (m.storage[stockKey] <= 0) delete m.storage[stockKey];
            const it = spawnItem(oreType, ingot, m.gx, m.gz);
            it.mesh.position.y += ingot ? 0.6 : 0.35;
            items.push(it);
            sendItemTo(it, target);
          }
        }
      }
    }
    else if (m.type === 'seller') {
      // コインが常にゆっくり回転しつつ、上下にホバリング
      const coin = m.mesh.userData.coin;
      if (coin) { coin.rotation.z += dt * 3; coin.position.y = 1.35 + Math.sin(time * 3) * 0.05; }
      const sign = m.mesh.userData.sign;
      if (sign) sign.material.emissiveIntensity = 0.3 + Math.sin(time * 2.4) * 0.15;
    }
  }
}

function updateItems(dt) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.moving) {
      it.t += dt * CONVEYOR_SPEED;
      if (it.t >= 1) { it.mesh.position.copy(it.to); arriveItem(it); }
      else {
        it.mesh.position.lerpVectors(it.from, it.to, it.t);
        it.mesh.rotation.y += dt * 2;
      }
    }
  }
}

/* ---------------- フローティングテキスト ---------------- */
function makeTextMaterial(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.font = '800 52px "M PLUS Rounded 1c", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,.7)';
  ctx.strokeText(text, 128, 48);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 48);
  const tex = new THREE.CanvasTexture(c);
  return new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
}
function makeTextSprite(text, color) {
  const sp = new THREE.Sprite(makeTextMaterial(text, color));
  sp.scale.set(3.4, 1.3, 1);
  return sp;
}
function spawnFloater(text, pos, color) {
  const sp = makeTextSprite(text, color);
  sp.position.copy(pos);
  scene.add(sp);
  floaters.push({ sp, life: 1.2 });
}
function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt;
    f.sp.position.y += dt * 1.4;
    f.sp.material.opacity = Math.min(1, f.life / 0.5);
    if (f.life <= 0) { scene.remove(f.sp); f.sp.material.map.dispose(); f.sp.material.dispose(); floaters.splice(i, 1); }
  }
}

/* ---------------- スキャン(鉱脈探知) ----------------
   広大マップ対策: マテリアルを鉱石種ごとにキャッシュ共有し、
   カメラ周辺(半径15マス)のみ表示して負荷を抑える */
const SCAN_RADIUS = 15;
const scanMats = {};
function doScan() {
  clearScan();
  const cgx = Math.round(cam.target.x / TS + GRID / 2 - 0.5);
  const cgz = Math.round(cam.target.z / TS + GRID / 2 - 0.5);
  const x0 = Math.max(0, cgx - SCAN_RADIUS), x1 = Math.min(GRID - 1, cgx + SCAN_RADIUS);
  const z0 = Math.max(0, cgz - SCAN_RADIUS), z1 = Math.min(GRID - 1, cgz + SCAN_RADIUS);
  for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
    if (Math.hypot(gx - cgx, gz - cgz) > SCAN_RADIUS) continue;
    const t = tiles[gx][gz];
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
      scanMarkers.push(sp);
    }
  }
  scanTimer = 6;
  document.getElementById('btn-scan').classList.add('active');
  toast('🔍 カメラ周辺の鉱脈を探知!数字=深さ(6秒)', 'good');
}
function clearScan() {
  for (const sp of scanMarkers) scene.remove(sp); // マテリアルはキャッシュ共有なので破棄しない
  scanMarkers = [];
  document.getElementById('btn-scan').classList.remove('active');
}
function updateScan(dt) {
  if (scanTimer > 0) {
    scanTimer -= dt;
    const bounce = Math.sin(time * 4) * 0.15;
    for (const sp of scanMarkers) sp.position.y += bounce * dt;
    if (scanTimer <= 0) clearScan();
  }
}

/* ---------------- ホバー/設置プレビュー ---------------- */
const highlightGeo = new THREE.PlaneGeometry(TS * 0.98, TS * 0.98);
const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
const highlightMesh = new THREE.Mesh(highlightGeo, highlightMat);
highlightMesh.rotation.x = -Math.PI / 2;
highlightMesh.visible = false;
highlightMesh.renderOrder = 10;
scene.add(highlightMesh);

function updateHighlight(clientX, clientY) {
  const hit = pickTile(clientX, clientY);
  if (!hit) { highlightMesh.visible = false; return; }
  const { gx, gz } = hit;
  highlightMesh.position.set(worldX(gx), tileTopY(gx, gz) + 0.03, worldZ(gz));
  highlightMesh.visible = true;
  let color = 0xffe066;
  if (tool === 'dig') color = 0x6fd8ff;
  else if (tool === 'demolish') color = machines.has(key(gx, gz)) ? 0xff6b6b : 0x8fa0c0;
  else if (COSTS[tool] !== undefined) {
    let canPlace = !machines.has(key(gx, gz));
    if (tool === 'drill') {
      const t = tiles[gx][gz];
      canPlace = canPlace && !!(t.ore && ORES[t.ore.type].depth === t.depth); // ドリルは露出鉱石の上のみ
    }
    color = canPlace && money >= COSTS[tool] ? 0x7dffa0 : 0xff6b6b;
  }
  highlightMesh.material.color.setHex(color);
  const preview = describeConnectionPreview(gx, gz);
  if (preview) updateStatus(preview.msg, preview.kind);
}
function hideHighlight() { highlightMesh.visible = false; updateStatus(); }

/* ---------------- タップ処理 ---------------- */
const raycaster = new THREE.Raycaster();
function pickTile(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const p = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(p, camera);
  const hits = raycaster.intersectObject(tileIMesh, false);
  if (hits.length > 0 && hits[0].instanceId !== undefined) {
    const id = hits[0].instanceId;
    return { gx: Math.floor(id / GRID), gz: id % GRID, isTile: true };
  }
  return null;
}

function cashOutChest(m) {
  let total = 0, count = 0;
  for (const k in m.storage) {
    const ingot = k.endsWith('_i');
    const oreType = k.slice(0, -2);
    const v = ingot ? ORES[oreType].ingotValue : ORES[oreType].oreValue;
    total += v * m.storage[k];
    count += m.storage[k];
  }
  if (count === 0) { toast('チェストは空っぽ', 'error'); return; }
  m.storage = {};
  earn(total);
  sfx('sell');
  spawnFloater('+$' + total, m.mesh.position.clone().add(new THREE.Vector3(0, 1.4, 0)), '#7dffa8');
  toast('📦 チェストの中身を売却!(' + count + '個 → $' + total + ')', 'good');
}


const actionMenu = document.getElementById('machine-actions');
let selectedMachine = null;
let moveMachineMode = null;
function positionActionMenu(m) {
  if (!actionMenu || !m) return;
  const pos = m.mesh.position.clone().add(new THREE.Vector3(0, 1.7, 0));
  pos.project(camera);
  const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
  actionMenu.style.left = x + 'px';
  actionMenu.style.top = y + 'px';
}
function showMachineActions(m) {
  selectedMachine = m;
  positionActionMenu(m);
  if (actionMenu) actionMenu.classList.remove('hidden');
  updateStatus(toolLabel(m.type) + 'を選択中: 回転・移動・削除できます', 'good');
}
function hideMachineActions() {
  selectedMachine = null;
  if (actionMenu) actionMenu.classList.add('hidden');
  updateStatus();
}
function canMoveMachineTo(m, gx, gz) {
  if (!m || !inGrid(gx, gz) || machines.has(key(gx, gz))) return false;
  if (m.item || m.incoming > 0 || m.processing) return false;
  if (m.type === 'drill') {
    const t = tiles[gx][gz];
    return !!(t.ore && ORES[t.ore.type].depth === t.depth);
  }
  return true;
}
function moveMachineTo(m, gx, gz) {
  if (!canMoveMachineTo(m, gx, gz)) { toast('移動できません: 空きマス/状態を確認してね', 'error'); return false; }
  const ox = m.gx, oz = m.gz;
  machines.delete(key(ox, oz));
  m.gx = gx; m.gz = gz;
  m.mesh.position.set(worldX(gx), tileTopY(gx, gz) + yJitter(gx, gz), worldZ(gz));
  machines.set(key(gx, gz), m);
  refreshTile(ox, oz); refreshTile(gx, gz);
  rebuildBeltsAround(ox, oz); rebuildBeltsAround(gx, gz);
  markPowerDirty(); updatePowerStatus(true);
  toast(toolLabel(m.type) + 'を移動しました', 'good');
  return true;
}
if (actionMenu) actionMenu.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn || !selectedMachine) return;
  const action = btn.dataset.action;
  const m = selectedMachine;
  if (action === 'rotate') { rotateMachine(m); hideMachineActions(); }
  else if (action === 'delete') { const gx = m.gx, gz = m.gz; hideMachineActions(); removeMachine(gx, gz); }
  else if (action === 'move') { moveMachineMode = m; if (actionMenu) actionMenu.classList.add('hidden'); updateStatus('移動先の空きマスをタップしてください', 'warn'); }
  else hideMachineActions();
});

/* ---------------- 機械操作(長押しメニュー) ---------------- */
function rotateMachine(m) {
  m.dir = (m.dir + 1) % 4;
  m.mesh.rotation.y = -m.dir * Math.PI / 2;
  if (m.type === 'conveyor' || m.type === 'filterConveyor') tryAutoConnectNeighbors(m.gx, m.gz);
  rebuildBeltsAround(m.gx, m.gz); // 回転で入出力が変わるので繋ぎ目形状を更新
  spawnFloater(DIR_ARROWS[m.dir], m.mesh.position.clone().add(new THREE.Vector3(0, 1.3, 0)), '#ffe066');
  toast(toolLabel(m.type) + 'の向きを変更: ' + DIR_ARROWS[m.dir], 'good');
  sfx('rotate');
  if (navigator.vibrate) navigator.vibrate(25);
}

function onTap(clientX, clientY) {
  const hit = pickTile(clientX, clientY);
  if (!hit) return;
  const { gx, gz } = hit;
  const t = tiles[gx][gz];
  const existing = machines.get(key(gx, gz));

  if (moveMachineMode) {
    const m = moveMachineMode;
    moveMachineMode = null;
    if (moveMachineTo(m, gx, gz)) hideMachineActions(); else updateStatus();
    return;
  }
  hideMachineActions();

  if (tool === 'dig') {
    if (existing) {
      if (existing.type === 'chest') { cashOutChest(existing); return; }
      // 「掘る」ツールで機械をタップすると状態を確認できる(完成度UP)
      if (existing.type === 'drill') {
        const hasOre = t.ore && ORES[t.ore.type].depth === t.depth;
        toast(hasOre ? '🛠️ ' + ORES[t.ore.type].name + 'を採掘中(無限鉱脈)' : '🛠️ 露出した鉱脈がありません', hasOre ? 'good' : 'error');
        return;
      }
      if (existing.type === 'smelter') {
        toast('🔥 精錬中: ' + (existing.processing ? ORES[existing.processing.oreType].name : 'なし') + ' / 待ち ' + existing.buffer.length + '個', 'good');
        return;
      }
      if (existing.type === 'merger') { toast('🔗 合流待ち: ' + existing.buffer.length + '個', 'good'); return; }
      if (existing.type === 'generator') { toast('⚡ 発電中: +' + POWER_OUTPUT.generator + ' 電力', 'good'); return; }
      toast('機械の下は掘れない!先に撤去してね', 'error'); return;
    }
    const exposed = t.ore && ORES[t.ore.type].depth === t.depth;
    if (exposed) {
      // 手掘りで鉱石ゲット
      const v = ORES[t.ore.type].oreValue;
      earn(v);
      sfx('ore');
      spawnFloater('+$' + v, new THREE.Vector3(worldX(gx), tileTopY(gx, gz) + 1, worldZ(gz)), '#ffd76e');
      refreshTile(gx, gz);
      return;
    }
    if (t.depth >= MAX_DEPTH) { toast('これ以上深く掘れない(岩盤)', 'error'); return; }
    t.depth++;
    sfx('dig');
    const digPos = new THREE.Vector3(worldX(gx), tileTopY(gx, gz) + 0.2, worldZ(gz));
    for (let i = 0; i < 6; i++) {
      spawnParticle('dust', digPos, { life: 0.7, scale: 0.4, vel: new THREE.Vector3((Math.random() - 0.5) * 1.4, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 1.4) });
    }
    refreshTile(gx, gz);
    rebuildBeltsAround(gx, gz); // 掘削で隣接ベルトとの段差が変わった場合も見た目を更新
    const nowExposed = t.ore && ORES[t.ore.type].depth === t.depth;
    if (nowExposed) {
      sfx('discover');
      toast('💎 ' + ORES[t.ore.type].name + '無限鉱脈を発見!ドリルを置こう!', 'good');
      spawnFloater('💎発見!', new THREE.Vector3(worldX(gx), tileTopY(gx, gz) + 1.2, worldZ(gz)), '#7de8ff');
    }
  }
  else if (tool === 'demolish') {
    if (!removeMachine(gx, gz)) toast('ここに機械はないよ', 'error');
  }
  else if (tool === 'filterConveyor' && existing && existing.type === 'filterConveyor') {
    const idx = FILTER_CYCLE.indexOf(existing.filter);
    existing.filter = FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length];
    updateFilterGem(existing);
    toast('フィルター設定: ' + FILTER_LABEL[existing.filter], 'good');
  }
  else if (COSTS[tool] !== undefined) {
    placeMachine(tool, gx, gz, buildDir, false);
  }
}

/* ---------------- お金 / UI ---------------- */
const moneyEl = document.getElementById('money-value');
function addMoney(v) {
  money += v;
  moneyEl.textContent = money.toLocaleString();
  if (v > 0) {
    moneyEl.parentElement.style.transform = 'scale(1.12)';
    setTimeout(() => moneyEl.parentElement.style.transform = '', 120);
  }
}
function toast(msg, kind) {
  if (kind === 'error') sfx('error');
  const area = document.getElementById('toast-area');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  area.appendChild(el);
  while (area.children.length > 3) area.removeChild(area.firstChild);
  setTimeout(() => el.remove(), 2800);
}


const statusEl = document.getElementById('status-strip');
function setStatus(msg, kind) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = kind || '';
}
function toolCostText(t) {
  if (t === 'dig') return '無料';
  if (t === 'demolish') return '50%返金';
  return COSTS[t] !== undefined ? '$' + COSTS[t] : '';
}
function baseStatusForTool(t) {
  if (t === 'dig') return '⛏️ 掘る: タイルを掘削 / 機械をタップで状態確認';
  if (t === 'demolish') return '🧨 撤去: 機械を撤去して50%返金';
  if (t === 'filterConveyor') return '🎯 フィルター: 一致=正面 / 不一致=左右 / ' + FILTER_LABEL[selectedFilter];
  if (t === 'conveyor') return '➡️ コンベア: 近くの接続先へ自動接続 / ' + toolCostText(t);
  if (t === 'generator') return '⚡ 発電機: +' + POWER_OUTPUT.generator + '電力 / ' + toolCostText(t);
  if (COSTS[t] !== undefined) return toolLabel(t) + ': ' + toolCostText(t) + ' / 向き ' + DIR_ARROWS[buildDir];
  return toolLabel(t);
}
function updateStatus(msg, kind) {
  if (msg) { setStatus(msg, kind); return; }
  if (!power.ok) { setStatus('⚡ 電力不足: ' + power.used + '/' + power.capacity + '。発電機を追加するとドリル/精錬炉が再開します', 'error'); return; }
  setStatus(baseStatusForTool(tool));
}
function describeConnectionPreview(gx, gz) {
  if (tool !== 'conveyor' && tool !== 'filterConveyor') return null;
  if (machines.has(key(gx, gz))) return { msg: 'ここには既に機械があります', kind: 'error' };
  const dir = chooseAutoDir(gx, gz, buildDir);
  const nx = gx + DIRS[dir].x, nz = gz + DIRS[dir].z;
  if (!inGrid(nx, nz)) return { msg: '➡️ 接続先がマップ外です', kind: 'warn' };
  const target = machines.get(key(nx, nz));
  if (!target) return { msg: '➡️ 出力先なし。向き ' + DIR_ARROWS[dir] + ' で設置予定', kind: 'warn' };
  if (!heightOk(gx, gz, nx, nz)) return { msg: '➡️ 高低差が大きすぎて接続不可', kind: 'error' };
  if (!connectionOk(target, gx, gz)) return { msg: '➡️ ' + toolLabel(target.type) + ' はこの向きから受け取れません', kind: 'error' };
  const dh = Math.round((tileTopY(nx, nz) - tileTopY(gx, gz)) / LH);
  const slope = dh === 0 ? '' : (dh > 0 ? ' / 上り段差' : ' / 下り段差');
  return { msg: '➡️ ' + toolLabel(target.type) + 'へ接続予定 ' + DIR_ARROWS[dir] + slope, kind: 'good' };
}

/* ツールバー */
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    tool = btn.dataset.tool;
    updateStatus();
    sfx('click');
  });
});
document.getElementById('btn-rotate').addEventListener('click', () => {
  sfx('click');
  buildDir = (buildDir + 1) % 4;
  document.getElementById('rotate-arrow').textContent = DIR_ARROWS[buildDir];
  updateStatus();
  toast('設置向き: ' + DIR_ARROWS[buildDir]);
});
document.getElementById('btn-filter-cycle').addEventListener('click', () => {
  sfx('click');
  const idx = FILTER_CYCLE.indexOf(selectedFilter);
  selectedFilter = FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length];
  document.getElementById('filter-icon').textContent = FILTER_ICON[selectedFilter];
  document.getElementById('filter-label').textContent = FILTER_LABEL[selectedFilter];
  updateStatus();
  toast('設置フィルター: ' + FILTER_LABEL[selectedFilter]);
});

/* HUDボタン */
document.getElementById('btn-scan').addEventListener('click', () => scanTimer > 0 ? clearScan() : doScan());
document.getElementById('btn-save').addEventListener('click', () => { saveGame(); toast('💾 セーブしました', 'good'); });
document.getElementById('btn-help').addEventListener('click', () => document.getElementById('help-modal').classList.remove('hidden'));

/* 効果音ミュート切替(設定は保存される) */
const muteBtn = document.getElementById('btn-mute');
function updateMuteIcon() {
  muteBtn.innerHTML = '<i class="fa-solid ' + (muted ? 'fa-volume-xmark' : 'fa-volume-high') + '"></i>';
}
muteBtn.addEventListener('click', () => {
  muted = !muted;
  localStorage.setItem('terraforge_muted', muted ? '1' : '0');
  updateMuteIcon();
  if (!muted) sfx('click');
  toast(muted ? '🔇 効果音 OFF' : '🔊 効果音 ON');
});
updateMuteIcon();
document.getElementById('btn-close-help').addEventListener('click', () => document.getElementById('help-modal').classList.add('hidden'));
document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('本当に全データをリセットしますか?')) {
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  }
});

/* ---------------- カメラパッド(長押しリピート対応・目標値をなめらかに更新) ---------------- */
function holdButton(id, action, interval) {
  const el = document.getElementById(id);
  let timer = null;
  const start = e => {
    e.preventDefault();
    action();
    timer = setInterval(action, interval);
  };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('pointercancel', stop);
}
holdButton('cam-left',  () => { cam.yawT += Math.PI / 4; }, 350);
holdButton('cam-right', () => { cam.yawT -= Math.PI / 4; }, 350);
holdButton('cam-up',    () => { cam.pitchT -= 0.09; }, 90);
holdButton('cam-down',  () => { cam.pitchT += 0.09; }, 90);
holdButton('cam-zoom-in',  () => { cam.distT *= 0.92; }, 90);
holdButton('cam-zoom-out', () => { cam.distT *= 1.09; }, 90);

/* ---------------- マップ移動(パン)の基準ベクトル ---------------- */
// 画面ドラッグ用:見た目通りに「指でつまんだ地面がついてくる」動き
function panCamera(dx, dy) {
  const s = cam.dist * 0.0016;
  const sin = Math.sin(cam.yaw), cos = Math.cos(cam.yaw);
  // 「指でつまんだ地面がついてくる」動き: 上へドラッグ=画面の下側にあった土地が見えてくる
  cam.target.x -= (dx * cos + dy * sin) * s;
  cam.target.z -= (dy * cos - dx * sin) * s;
  clampTarget();
}
// キーボード(WASD)用:カメラの「前方」「右方」ベクトルを厳密に使い、上下左右の向きのズレを解消
function moveCameraRig(fwdAmt, rightAmt) {
  const sin = Math.sin(cam.yaw), cos = Math.cos(cam.yaw);
  const fx = -sin, fz = -cos; // 前方(カメラが向いている方向)
  const rx = cos,  rz = -sin; // 右方
  cam.target.x += fx * fwdAmt + rx * rightAmt;
  cam.target.z += fz * fwdAmt + rz * rightAmt;
  clampTarget();
}
function clampTarget() {
  const lim = GRID * TS * 0.62;
  cam.target.x = Math.max(-lim, Math.min(lim, cam.target.x));
  cam.target.z = Math.max(-lim, Math.min(lim, cam.target.z));
}

/* ---------------- キーボード移動(WASD)を毎フレーム滑らかに適用 ---------------- */
const keysPressed = new Set();
function applyKeyboardPan(dt) {
  if (!keysPressed.size) return;
  let fwd = 0, right = 0;
  if (keysPressed.has('w')) fwd += 1;
  if (keysPressed.has('s')) fwd -= 1;
  if (keysPressed.has('d')) right += 1;
  if (keysPressed.has('a')) right -= 1;
  if (!fwd && !right) return;
  const len = Math.hypot(fwd, right) || 1;
  const speed = 15 * (cam.dist / 40); // ズーム量に応じて移動速度を調整(操作感向上)
  moveCameraRig((fwd / len) * speed * dt, (right / len) * speed * dt);
}

/* ---------------- タッチ / マウス操作(慣性ドラッグ対応) ---------------- */
let pointers = new Map();
let dragMoved = 0;
let tapStart = 0;
let pinchDist = 0;
const inertia = { active: false, vx: 0, vy: 0 };

/* ---- 長押しで設置済み機械の操作メニューを表示 ---- */
const LONG_PRESS_MS = 480;
let longPressTimer = null;
let longPressFired = false;
function clearLongPress() { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } }
function startLongPress(clientX, clientY) {
  clearLongPress();
  longPressFired = false;
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    if (dragMoved > 6) return; // ドラッグ中なら発火しない
    const hit = pickTile(clientX, clientY);
    if (!hit) return;
    const m = machines.get(key(hit.gx, hit.gz));
    if (m) {
      longPressFired = true;
      showMachineActions(m);
    }
  }, LONG_PRESS_MS);
}

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  inertia.active = false; // 新しい操作が始まったら慣性を止める
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (pointers.size === 1) {
    dragMoved = 0; tapStart = performance.now();
    startLongPress(e.clientX, e.clientY);
  } else {
    clearLongPress(); // 2本指以降は長押し判定をキャンセル(ピンチ操作優先)
  }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) {
    // ドラッグ中でなければマウスホバーで設置プレビューを表示(PC操作性向上)
    if (e.pointerType === 'mouse' && pointers.size === 0) updateHighlight(e.clientX, e.clientY);
    return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  const now = performance.now();
  const dtms = Math.max(1, now - (p.t || now));
  p.x = e.clientX; p.y = e.clientY; p.t = now;
  if (pointers.size === 1) {
    dragMoved += Math.abs(dx) + Math.abs(dy);
    if (dragMoved > 6) {
      clearLongPress();
      panCamera(dx, dy);
      hideHighlight();
      // 慣性用の速度(px/秒)を記録
      inertia.vx = dx / (dtms / 1000);
      inertia.vy = dy / (dtms / 1000);
    }
  } else if (pointers.size === 2) {
    clearLongPress();
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) cam.distT *= pinchDist / d;
    pinchDist = d;
    dragMoved = 100;
  }
});
canvas.addEventListener('pointerup', e => {
  pointers.delete(e.pointerId);
  clearLongPress();
  if (pointers.size === 0 && longPressFired) {
    longPressFired = false; // 長押しメニューを出した場合はタップ操作を発火させない
  } else if (pointers.size === 0 && dragMoved <= 6 && performance.now() - tapStart < 400) {
    onTap(e.clientX, e.clientY);
  } else if (pointers.size === 0 && dragMoved > 6) {
    // フリック(素早いドラッグ)で慣性スクロールを開始(操作感向上)
    const speed = Math.hypot(inertia.vx, inertia.vy);
    if (speed > 60) inertia.active = true;
  }
  pinchDist = 0;
});
canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); clearLongPress(); pinchDist = 0; });
canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && pointers.size === 0) hideHighlight(); });

function updateInertia(dt) {
  if (!inertia.active) return;
  panCamera(inertia.vx * dt, inertia.vy * dt);
  const decay = Math.pow(0.02, dt); // 素早く減衰してスッと止まる
  inertia.vx *= decay; inertia.vy *= decay;
  if (Math.hypot(inertia.vx, inertia.vy) < 8) inertia.active = false;
}

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cam.distT *= e.deltaY > 0 ? 1.08 : 0.92;
}, { passive: false });

/* キーボード(矢印=視点、WASD=移動を毎フレーム滑らかに適用) */
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'a' || k === 's' || k === 'd') keysPressed.add(k);
  switch (e.key) {
    case 'ArrowLeft': cam.yawT += Math.PI / 4; break;
    case 'ArrowRight': cam.yawT -= Math.PI / 4; break;
    case 'ArrowUp': cam.pitchT -= 0.09; break;
    case 'ArrowDown': cam.pitchT += 0.09; break;
    case '+': case '=': cam.distT *= 0.9; break;
    case '-': cam.distT *= 1.1; break;
    case 'r': document.getElementById('btn-rotate').click(); break;
  }
});
window.addEventListener('keyup', e => keysPressed.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keysPressed.clear());

/* ---------------- セーブ / ロード ---------------- */
function saveGame() {
  const tileData = [];
  for (let gx = 0; gx < GRID; gx++) for (let gz = 0; gz < GRID; gz++) {
    const t = tiles[gx][gz];
    if (t.depth > 0) {
      const rec = { x: gx, z: gz, d: t.depth };
      tileData.push(rec);
    }
  }
  const machineData = [...machines.values()].map(m => {
    const rec = { t: m.type, x: m.gx, z: m.gz, d: m.dir };
    if (m.type === 'filterConveyor') rec.f = m.filter;
    if (m.type === 'chest') rec.st = m.storage;
    if (m.type === 'merger' || m.type === 'smelter') rec.buf = m.buffer;   // 精錬炉の待ち行列も保存
    if (m.type === 'smelter' && m.processing) rec.pr = m.processing;       // 精錬中のアイテムも保存
    return rec;
  });
  // ライン上を流れているアイテムも保存(リロードで消えるバグの修正)
  const itemData = items.map(it => {
    let x = it.gx, z = it.gz;
    if (it.moving && it.destKey) { const p = it.destKey.split(','); x = +p[0]; z = +p[1]; }
    return { o: it.oreType, i: it.ingot ? 1 : 0, x, z };
  });
  localStorage.setItem(SAVE_KEY, JSON.stringify({ seed: window._seed, money, stats, tiles: tileData, machines: machineData, items: itemData }));
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

/* 自動セーブ(30秒ごと+タブを閉じる/隠した時。進行が消えるのを防止) */
setInterval(saveGame, 30000);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
window.addEventListener('pagehide', saveGame);

/* ---------------- 初期化 ---------------- */
function init() {
  const saved = loadGame();
  createWorld(saved);
  if (saved) {
    money = saved.money;
    if (saved.stats) stats = Object.assign(stats, saved.stats);
    for (const md of saved.machines) {
      placeMachine(md.t, md.x, md.z, md.d, true);
      const mm = machines.get(key(md.x, md.z));
      if (mm) {
        if (md.f !== undefined) { mm.filter = md.f; updateFilterGem(mm); }
        if (md.st) mm.storage = md.st;
        if (md.buf) mm.buffer = md.buf;
        if (md.pr) mm.processing = md.pr; // 精錬炉の処理中アイテムを復元
      }
    }
    // ライン上のアイテムを復元(移動中だったものは行き先のマスに配置)
    if (saved.items) for (const d of saved.items) {
      const m = machines.get(key(d.x, d.z));
      if (!m) continue;
      const ingot = !!d.i;
      if ((m.type === 'conveyor' || m.type === 'filterConveyor' || m.type === 'splitter') && !m.item) {
        const it = spawnItem(d.o, ingot, d.x, d.z);
        items.push(it);
        m.item = it;
      } else if (m.type === 'smelter' && !ingot && m.buffer.length < 2) m.buffer.push({ oreType: d.o });
      else if (m.type === 'merger') m.buffer.push({ oreType: d.o, ingot });
      else if (m.type === 'chest') { const sk = d.o + (ingot ? '_i' : '_o'); m.storage[sk] = (m.storage[sk] || 0) + 1; }
    }
    const chip = document.getElementById('money-display');
    if (chip) chip.title = '累計収益: $' + stats.earned.toLocaleString();
    toast('📂 セーブデータを読み込みました', 'good');
  } else {
    document.getElementById('help-modal').classList.remove('hidden');
  }
  addMoney(0);
  updatePowerStatus(true);
  updateStatus();
  onResize();
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.matchMedia('(max-width: 700px)').matches ? 1.5 : 2));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

/* ---------------- メインループ ---------------- */
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  time += dt;
  updateMachines(dt);
  updateItems(dt);
  updateFloaters(dt);
  updateParticles(dt);
  updateScan(dt);
  applyKeyboardPan(dt);
  updateInertia(dt);
  updateCamera(dt);
  if (selectedMachine && actionMenu && !actionMenu.classList.contains('hidden')) positionActionMenu(selectedMachine);
  renderer.render(scene, camera);
}

init();
requestAnimationFrame(loop);

})();
