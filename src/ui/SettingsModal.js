/* =====================================================================
   TerraForge — 設定モーダル (Phase07)
   ---------------------------------------------------------------------
   6項目の設定を管理:
   1. SFX音量スライダー(0–100) → audio.setSfxVolume(vol/100)
   2. BGM音量スライダー(0–100) → audio.setBgmVolume(Phase34まで無効表示)
   3. 描画品質セレクト(低/中/高) → scene.applyQuality()
   4. 触覚フィードバック ON/OFF
   5. カメラ操作パッド表示 ON/OFF
   6. 数値省略表記 ON/OFF
   設定は gameState.settings に保持し、セーブv9に統合保存される。
   ===================================================================== */
import { gameState } from '../state.js';
import { getMuted, setMuted, getSfxVolume, setSfxVolume, getBgmVolume, setBgmVolume } from '../audio.js';
import { applyQuality } from '../render/scene.js';
import { ctx } from '../ctx.js';
import { GAME_VERSION } from '../constants-version.js';

const QUALITY_LABELS = { low: '低', medium: '中', high: '高' };

export class SettingsModal {
  constructor(rootEl) {
    this.root = rootEl;
    if (!this.root) return;
    this._build();
    this._bindEvents();
  }

  _build() {
    this.root.innerHTML = '';
    const panel = document.createElement('div');
    panel.id = 'settings-panel';
    panel.innerHTML =
      '<h1>\u2699\uFE0F \u8A2D\u5B9A</h1>' +
      '<div id="settings-list"></div>' +
      '<div id="settings-actions">' +
        '<button id="btn-close-settings">\u9589\u3058\u308B</button>' +
      '</div>' +
      '<div id="settings-footer">TerraForge v' + GAME_VERSION + '</div>';
    this.root.appendChild(panel);
    this.list = panel.querySelector('#settings-list');
    this._renderItems();
  }

  _renderItems() {
    const s = gameState.settings;
    this.list.innerHTML = '';

    // SFX音量
    this.list.appendChild(this._row(
      '🔊 効果音の音量',
      this._slider('sfx', Math.round(getSfxVolume() * 100), 0, 100, val => {
        setSfxVolume(val / 100);
        gameState.settings.sfxVolume = val / 100;
        if (val > 0 && !getMuted()) ctx.sfx('click');
      })
    ));

    // BGM音量(Phase34まで無効表示)
    this.list.appendChild(this._row(
      '🎵 BGMの音量 <small>(準備中)</small>',
      this._slider('bgm', Math.round(getBgmVolume() * 100), 0, 100, val => {
        setBgmVolume(val / 100);
        gameState.settings.bgmVolume = val / 100;
      }, true)
    ));

    // 描画品質
    this.list.appendChild(this._row(
      '🖼️ 描画品質',
      this._select('quality', ['low', 'medium', 'high'], s.quality, QUALITY_LABELS, val => {
        gameState.settings.quality = val;
        applyQuality(val);
      })
    ));

    // 触覚フィードバック
    this.list.appendChild(this._row(
      '📳 触覚フィードバック',
      this._toggle('haptics', s.haptics, val => {
        gameState.settings.haptics = val;
      })
    ));

    // カメラ操作パッド表示
    this.list.appendChild(this._row(
      '🎮 カメラ操作パッド',
      this._toggle('showCamPad', s.showCamPad, val => {
        gameState.settings.showCamPad = val;
        const pad = document.getElementById('camera-pad');
        if (pad) pad.classList.toggle('hidden', !val);
      })
    ));

    // 数値省略表記
    this.list.appendChild(this._row(
      '🔢 数値省略表記 (1.2K/1.2M)',
      this._toggle('shortNumbers', s.shortNumbers, val => {
        gameState.settings.shortNumbers = val;
        if (ctx.refreshMoneyDisplay) ctx.refreshMoneyDisplay();
      })
    ));
  }

  _row(label, control) {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const lbl = document.createElement('div');
    lbl.className = 'settings-label';
    lbl.innerHTML = label;
    const ctl = document.createElement('div');
    ctl.className = 'settings-control';
    ctl.appendChild(control);
    row.appendChild(lbl);
    row.appendChild(ctl);
    return row;
  }

  _slider(id, val, min, max, onChange, disabled) {
    const wrap = document.createElement('div');
    wrap.className = 'slider-wrap' + (disabled ? ' disabled' : '');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.value = String(val);
    if (disabled) input.disabled = true;
    const out = document.createElement('span');
    out.className = 'slider-val';
    out.textContent = val;
    input.addEventListener('input', () => {
      out.textContent = input.value;
      onChange(parseInt(input.value, 10));
    });
    wrap.appendChild(input);
    wrap.appendChild(out);
    return wrap;
  }

  _select(id, options, current, labels, onChange) {
    const sel = document.createElement('select');
    sel.id = 'settings-' + id;
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = labels[opt] || opt;
      if (opt === current) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  _toggle(id, current, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'toggle-wrap';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!current;
    cb.addEventListener('change', () => onChange(cb.checked));
    const track = document.createElement('span');
    track.className = 'toggle-track';
    const thumb = document.createElement('span');
    thumb.className = 'toggle-thumb';
    track.appendChild(thumb);
    wrap.appendChild(cb);
    wrap.appendChild(track);
    wrap.appendChild(document.createTextNode(current ? 'ON' : 'OFF'));
    cb.addEventListener('change', () => {
      wrap.lastChild.textContent = cb.checked ? 'ON' : 'OFF';
    });
    return wrap;
  }

  _bindEvents() {
    const closeBtn = this.root.querySelector('#btn-close-settings');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    // 背景クリックで閉じる
    this.root.addEventListener('click', e => {
      if (e.target === this.root) this.close();
    });
  }

  open() {
    this._renderItems();
    this.root.classList.remove('hidden');
  }

  close() {
    this.root.classList.add('hidden');
  }

  /** ロード直後に設定を各モジュールへ反映する(apply相当) */
  apply() {
    const s = gameState.settings;
    if (typeof s.sfxVolume === 'number') setSfxVolume(s.sfxVolume);
    if (typeof s.bgmVolume === 'number') setBgmVolume(s.bgmVolume);
    if (s.quality) applyQuality(s.quality);
    if (typeof s.showCamPad === 'boolean') {
      const pad = document.getElementById('camera-pad');
      if (pad) pad.classList.toggle('hidden', !s.showCamPad);
    }
    if (typeof s.muted === 'boolean') setMuted(s.muted);
  }
}
