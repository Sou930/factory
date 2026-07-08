/* =====================================================================
   TerraForge — Three.js 基本セットアップ (renderer / scene / camera)
   ===================================================================== */
import { GRID, TS } from '../constants.js';

export const canvas = document.getElementById('game-canvas');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const MAX_PIXEL_RATIO = window.matchMedia('(max-width: 700px)').matches ? 1.5 : 2;
export let basePixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
export let adaptivePixelRatio = basePixelRatio;
export const MAX_ANISOTROPY = Math.min(8, renderer.capabilities.getMaxAnisotropy());

/** 現在の描画品質設定 ('low' | 'medium' | 'high')。applyQuality で更新される */
export let currentQuality = 'high';
/** 品質ごとの pixelRatio 上限。applyQuality で basePixelRatio の上限を上書きする */
const QUALITY_MAX_PIXEL_RATIO = { low: 1.0, medium: 1.5, high: 2 };

renderer.setPixelRatio(adaptivePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10192e);
scene.fog = new THREE.Fog(0x10192e, 120, 430);

(function setupEnvironment() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx2 = c.getContext('2d');
  const sky = ctx2.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, '#8fbfff');
  sky.addColorStop(0.45, '#5f87bf');
  sky.addColorStop(0.72, '#2a3552');
  sky.addColorStop(1, '#1a1310');
  ctx2.fillStyle = sky;
  ctx2.fillRect(0, 0, c.width, c.height);
  const sunGlow = ctx2.createRadialGradient(c.width * 0.72, c.height * 0.32, 6, c.width * 0.72, c.height * 0.32, 130);
  sunGlow.addColorStop(0, 'rgba(255,244,210,0.95)');
  sunGlow.addColorStop(0.2, 'rgba(255,216,160,0.58)');
  sunGlow.addColorStop(1, 'rgba(255,190,120,0.02)');
  ctx2.fillStyle = sunGlow;
  ctx2.fillRect(0, 0, c.width, c.height);
  const envMap = new THREE.CanvasTexture(c);
  envMap.mapping = THREE.EquirectangularReflectionMapping;
  envMap.colorSpace = THREE.SRGBColorSpace;
  envMap.anisotropy = MAX_ANISOTROPY;
  envMap.generateMipmaps = true;
  envMap.minFilter = THREE.LinearMipmapLinearFilter;
  envMap.magFilter = THREE.LinearFilter;
  scene.environment = envMap;
})();

export const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 900);

export const cam = {
  yaw: Math.PI / 4, pitch: 0.9, dist: 40,
  yawT: Math.PI / 4, pitchT: 0.9, distT: 40,
  target: new THREE.Vector3(0, 0, 0)
};

export function updateCamera(dt) {
  cam.pitchT = Math.max(0.42, Math.min(1.45, cam.pitchT));
  cam.distT  = Math.max(12, Math.min(210, cam.distT));
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

scene.add(new THREE.AmbientLight(0x7789a8, 0.45));
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x2a2319, 0.56);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xfff2d8, 1.42);
sun.position.set(100, 120, 65);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.00022;
sun.shadow.normalBias = 0.02;
const scam = sun.shadow.camera;
scam.left = -145; scam.right = 145; scam.top = 145; scam.bottom = -145; scam.far = 420;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x5f7fff, 0.36);
fill.position.set(-28, 30, -32);
scene.add(fill);

export function applyRendererSize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(adaptivePixelRatio);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/**
 * 描画品質を切り替える(Phase07)。
 * 低: shadowMap無効 + pixelRatio上限1.0
 * 中: shadow 1024 + 上限1.5
 * 高: 現行(shadow 2048 + 上限2)
 * renderer再生成はせず、shadowMap.enabled 切替 + shadow.map.dispose() +
 * needsUpdate で次フレームから反映する。
 * @param {'low'|'medium'|'high'} quality
 */
export function applyQuality(quality) {
  const q = (quality === 'low' || quality === 'medium' || quality === 'high') ? quality : 'high';
  if (q === currentQuality && !applyQuality._firstApplied) {
    // 初回以外で同じ品質なら省略(初回は_firstApplied未設定なので必ず通る)
  }
  currentQuality = q;
  applyQuality._firstApplied = true;

  // shadowMap 切替
  if (q === 'low') {
    renderer.shadowMap.enabled = false;
  } else {
    renderer.shadowMap.enabled = true;
    const size = q === 'medium' ? 1024 : 2048;
    if (sun.shadow.mapSize.width !== size) {
      sun.shadow.mapSize.set(size, size);
      // 既存のシャドウマップを破棄して次フレームで再生成
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
      sun.shadow.needsUpdate = true;
    }
  }
  // 低品質時は既存シャドウマップを破棄(無効化の反映)
  if (q === 'low' && sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
    sun.shadow.needsUpdate = true;
  }

  // pixelRatio 上限を品質に応じて上書き
  const maxPr = QUALITY_MAX_PIXEL_RATIO[q];
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  const effectiveMax = mobile ? Math.min(maxPr, 1.5) : maxPr;
  basePixelRatio = Math.min(window.devicePixelRatio, effectiveMax);
  adaptivePixelRatio = Math.min(adaptivePixelRatio, basePixelRatio);
  applyRendererSize();
}

let fpsEMA = 60;
let qualityCooldown = 0;
export function updateAdaptiveQuality(rawDt) {
  const fps = 1 / Math.max(rawDt, 1 / 120);
  fpsEMA += (fps - fpsEMA) * Math.min(1, rawDt * 2.5);
  qualityCooldown -= rawDt;
  if (qualityCooldown > 0) return;
  let next = adaptivePixelRatio;
  if (fpsEMA < 50 && adaptivePixelRatio > 0.8) next = Math.max(0.8, adaptivePixelRatio - 0.1);
  else if (fpsEMA > 58 && adaptivePixelRatio < basePixelRatio) next = Math.min(basePixelRatio, adaptivePixelRatio + 0.1);
  if (Math.abs(next - adaptivePixelRatio) > 0.001) {
    adaptivePixelRatio = next;
    applyRendererSize();
  }
  qualityCooldown = 0.85;
}

/**
 * 現在のFPS指標(EMA)を返す。Phase08 デバッグパネル用。
 * @returns {number}
 */
export function getFpsEMA() { return fpsEMA; }

export function onResize() {
  const maxPr = window.matchMedia('(max-width: 700px)').matches ? 1.5 : 2;
  basePixelRatio = Math.min(window.devicePixelRatio, maxPr);
  adaptivePixelRatio = Math.min(adaptivePixelRatio, basePixelRatio);
  applyRendererSize();
}