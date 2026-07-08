/* =====================================================================
   TerraForge — 効果音 (WebAudio) — Phase07: 音量係数導入
   ---------------------------------------------------------------------
   sfxVolume (0.0–1.0) は全beepのvolに乗算される。
   BGM音量はPhase34で実装予定だが、係数のみ保持する。
   muted(トグル) と sfxVolume(スライダー) は独立:
     muted=true なら音量に関わらず無音、muted=false かつ sfxVolume>0 で鳴る。
   ===================================================================== */
let audioCtx = null;
let _muted = localStorage.getItem('terraforge_muted') === '1';
/** SFX音量係数(0.0–1.0)。settings.sfxVolume と同期。既定1.0 */
let _sfxVolume = 1;
/** BGM音量係数(0.0–1.0)。Phase34で使用。既定0.7 */
let _bgmVolume = 0.7;
const sfxLast = {};
function beep(freq, dur, type, vol, delay, slide) {
  const t0 = audioCtx.currentTime + (delay || 0);
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol * _sfxVolume, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
export function sfx(name) {
  if (_muted || _sfxVolume <= 0) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { return; }
  const now = performance.now();
  const gap = name === 'sell' ? 100 : 40;
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
    case 'upgrade':   beep(392, 0.07, 'square', 0.12); beep(523, 0.07, 'square', 0.12, 0.07); beep(659, 0.07, 'square', 0.12, 0.14); beep(880, 0.16, 'sine', 0.15, 0.21, 120); break;
  }
}
export function getMuted() { return _muted; }
export function setMuted(v) { _muted = v; localStorage.setItem('terraforge_muted', v ? '1' : '0'); }
/** SFX音量係数(0.0–1.0)を設定 */
export function getSfxVolume() { return _sfxVolume; }
export function setSfxVolume(v) { _sfxVolume = Math.max(0, Math.min(1, v)); }
/** BGM音量係数(0.0–1.0)。Phase34で使用 */
export function getBgmVolume() { return _bgmVolume; }
export function setBgmVolume(v) { _bgmVolume = Math.max(0, Math.min(1, v)); }
