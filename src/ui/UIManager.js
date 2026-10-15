import { LEVEL_BRIEFINGS } from './content.js';
import EndingSequence from './EndingSequence.js';
import FacilityMap from './FacilityMap.js';

const SETTINGS_KEY = 'containment-breach-settings';
const clamp = (value, min, max, fallback = min) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Ronie's display layer. Gameplay and countdown rules stay in Game. */
export default class UIManager {
  constructor() {
    this.elements = {};
    for (const id of [
      'hud', 'health-bar-fill', 'health-bar-bg', 'health-value', 'pickup-notice',
      'energy-bar-fill', 'energy-bar-bg', 'energy-bar-wrap', 'energy-value',
      'objective', 'level-indicator', 'collapse-timer', 'collapse-timer-value',
      'stealth-vignette', 'stealth-warning', 'stealth-hidden', 'boss-phase', 'boss-status', 'boss-cue',
      'tutorial', 'tutorial-text', 'tutorial-sub', 'hit-marker', 'mute-indicator',
      'loading-bar', 'loading-bar-container', 'loading-status', 'asset-warning',
      'transition-text', 'transition-objective', 'pa-caption',
      'credits-dialog', 'options-dialog', 'volume-setting', 'volume-value',
      'sensitivity-setting', 'sensitivity-value', 'mute-setting',
      'music-setting', 'music-value',
    ]) this.elements[id] = document.getElementById(id);
    this.map = new FacilityMap(document.getElementById('map-panel'), document.getElementById('facility-map'));
    this.settings = this._readSettings();
    this._captionTime = 0;
    this._bindDialogs();
    this.setState('loading');
  }

  connect(audio, camera, gameState) {
    this.audio = audio;
    this.camera = camera;
    this.ending = new EndingSequence(gameState);
    audio.setVolume(this.settings.volume);
    audio.setMusicVolume(this.settings.musicVolume);
    camera.sensitivity = this.settings.sensitivity;
    audio.onSettingsChange = () => this._syncSettings();
    this._syncSettings();
  }

  _text(id, value) {
    const el = this.elements[id];
    if (el && el.textContent !== value) el.textContent = value;
  }

  _bar(prefix, value, max) {
    const percent = clamp(max > 0 ? value / max * 100 : 0, 0, 100);
    const width = `${percent.toFixed(1)}%`;
    const fill = this.elements[`${prefix}-bar-fill`];
    if (fill && fill.style.width !== width) fill.style.width = width;
    const rounded = String(Math.round(percent));
    const bar = this.elements[`${prefix}-bar-bg`];
    if (bar && bar.getAttribute('aria-valuenow') !== rounded) bar.setAttribute('aria-valuenow', rounded);
    this._text(`${prefix}-value`, `${rounded}%`);
  }

  setHealth(value, max) { this._bar('health', value, max); }

  setEnergy(value, max, cooling = false) {
    this._bar('energy', value, max);
    this.elements['energy-bar-wrap']?.classList.toggle('cooldown', cooling);
  }

  setObjective(text) { this._text('objective', text); }

  setLevel(level) {
    const briefing = LEVEL_BRIEFINGS[level];
    this._text('level-indicator', `LEVEL ${level}`);
    this._text('transition-text', briefing?.title || `LEVEL ${level}`);
    this._text('transition-objective', briefing?.objective || '');
  }

  setCountdown(seconds, active) {
    const whole = Math.ceil(clamp(seconds, 0, Number.MAX_SAFE_INTEGER));
    this._text('collapse-timer-value', `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`);
    this.elements['collapse-timer']?.classList.toggle('active', active);
  }

  setStealth(threat, seeing, chasing, mode = '', exposure = 0) {
    const vignette = this.elements['stealth-vignette'];
    const intensity = threat > 0.1 ? Math.min(threat * 0.7, 0.6) : 0;
    if (vignette) {
      vignette.style.setProperty('--vignette-base', intensity);
      vignette.style.opacity = intensity;
      vignette.classList.toggle('pulse', intensity > 0);
    }
    const warning = this.elements['stealth-warning'];
    if (warning) {
      this._text('stealth-warning', mode === 'exposed' ? `EXPOSED ${Math.round(exposure * 100)}% / GET BEHIND COVER` : '! DETECTED / BREAK LINE OF SIGHT !');
      const showWarning = mode === 'exposed' || mode === 'detected' || (!mode && seeing && chasing);
      warning.classList.toggle('active', showWarning);
      warning.classList.toggle('exposed', mode === 'exposed');
      warning.style.opacity = showWarning ? '' : '0';
    }
    this._text('stealth-hidden', mode === 'searching' ? '[ SEARCHING / MOVE BEHIND COVER ]' : '[ HIDDEN ]');
    if (this.elements['stealth-hidden']) this.elements['stealth-hidden'].style.opacity = mode === 'searching' || mode === 'hidden' || (!seeing && threat > 0.2) ? 1 : 0;
  }

  setBossPhase(phase, escaping = false) {
    const el = this.elements['boss-phase'];
    if (!el) return;
    const labels = ['', 'PHASE 2 — ENRAGED', 'PHASE 3 — CRITICAL'];
    this._text('boss-phase', escaping ? 'ESCAPE — RUN!' : labels[phase] || '');
    el.style.opacity = escaping || phase > 0 ? 1 : 0;
    el.style.color = escaping ? '#0f0' : '#ff8844';
    el.style.textShadow = escaping ? '0 0 10px #0f0' : '0 0 10px #f80';
  }

  showTutorial(step) {
    this._text('tutorial-text', step?.text || '');
    this._text('tutorial-sub', step?.sub || '');
    this.elements.tutorial?.classList.toggle('visible', !!step);
  }

  setBossStatus(weakPoints, stage = 'waiting') {
    const panel = this.elements['boss-status'];
    if (!panel) return;
    panel.hidden = !weakPoints;
    if (!weakPoints) return;
    const labels = {
      power: 'NODES SHIELDED / START BOTH GENERATORS',
      waiting: 'ENTITY NEARBY / STAY ALERT',
      pursuit: 'KEEP MOVING / USE REACTOR COVER',
      windup: 'CHARGE INCOMING / SIDESTEP',
      charge: 'MOVE OFF THE AMBER LINE',
      recover: 'RECOVERING / AIM AT A NODE',
      shielded: 'NODE SEALED / PREPARE FOR NEXT ATTACK',
      sweepWindup: 'SWEEP INCOMING / MOVE OUTSIDE AMBER RING',
      sweep: 'KEEP CLEAR OF THE SWEEP',
    };
    this._text('boss-cue', weakPoints.every(point => point.userData.destroyed) ? 'ENTITY NEUTRALIZED' : labels[stage]);
    panel.dataset.stage = stage;
    for (let i = 0; i < weakPoints.length; i++) {
      const marker = panel.querySelector(`[data-weak-node="${i}"]`);
      marker?.classList.toggle('destroyed', weakPoints[i].userData.destroyed);
    }
  }

  flashHit() {
    const el = this.elements['hit-marker'];
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  showPickup(text) {
    this._text('pickup-notice', text);
    this._pickupTime = 3;
    if (this.elements['pickup-notice']) this.elements['pickup-notice'].hidden = false;
  }

  reset() {
    this.map.clear();
    this.setBossStatus(null);
    this._pickupTime = 0;
    if (this.elements['pickup-notice']) this.elements['pickup-notice'].hidden = true;
    this.setStealth(0, false, false);
    this.setBossPhase(0);
    this.setCountdown(0, false);
    this.showTutorial(null);
    this.elements['hit-marker']?.classList.remove('flash');
    this.showAnnouncement('');
  }

  setState(state) {
    const hud = this.elements.hud;
    if (hud) {
      hud.style.display = state === 'playing' || state === 'paused' ? 'block' : 'none';
      hud.classList.toggle('paused', state === 'paused');
    }
    for (const id of ['credits-dialog', 'options-dialog']) {
      if (this.elements[id]?.open) this.elements[id].close();
    }
    if (['menu', 'gameover', 'victory', 'credits'].includes(state)) this.reset();
    this.ending?.setState(state);
  }

  setLoadingProgress(percent, status) {
    const progress = Math.round(clamp(percent, 0, 100));
    if (this.elements['loading-bar']) this.elements['loading-bar'].style.width = `${progress}%`;
    this.elements['loading-bar-container']?.setAttribute('aria-valuenow', progress);
    this._text('loading-status', status);
  }

  showAssetWarning(text) {
    this._text('asset-warning', text);
    if (this.elements['asset-warning']) this.elements['asset-warning'].hidden = !text;
  }

  showAnnouncement(text) {
    this._text('pa-caption', text ? `FACILITY PA: ${text}` : '');
    this._captionTime = text ? 10 : 0;
    if (this.elements['pa-caption']) this.elements['pa-caption'].hidden = !text;
  }

  update(dt) {
    if (this._pickupTime > 0) {
      this._pickupTime -= dt;
      if (this._pickupTime <= 0 && this.elements['pickup-notice']) this.elements['pickup-notice'].hidden = true;
    }
    if (this._captionTime <= 0) return;
    this._captionTime -= dt;
    if (this._captionTime <= 0) this.showAnnouncement('');
  }

  _bindDialogs() {
    for (const [buttonId, dialogId] of [
      ['btn-credits', 'credits-dialog'], ['btn-options', 'options-dialog'],
      ['btn-pause-options', 'options-dialog'],
    ]) {
      document.getElementById(buttonId)?.addEventListener('click', () => {
        if (dialogId === 'options-dialog') this._syncSettings();
        this.elements[dialogId]?.showModal();
      });
    }
    document.querySelectorAll('[data-close-dialog]').forEach(button => {
      button.addEventListener('click', () => button.closest('dialog')?.close());
    });
    this.elements['volume-setting']?.addEventListener('input', event => {
      this.settings.volume = clamp(Number(event.target.value) / 100, 0, 1, 0.65);
      this.audio?.setVolume(this.settings.volume);
      this._saveSettings();
      this._syncSettings();
    });
    this.elements['sensitivity-setting']?.addEventListener('input', event => {
      this.settings.sensitivity = clamp(Number(event.target.value) / 1000, 0.0005, 0.005, 0.002);
      if (this.camera) this.camera.sensitivity = this.settings.sensitivity;
      this._saveSettings();
      this._syncSettings();
    });
    this.elements['music-setting']?.addEventListener('input', event => {
      this.settings.musicVolume = clamp(Number(event.target.value) / 100, 0, 1, 0.8);
      this.audio?.setMusicVolume(this.settings.musicVolume);
      this._saveSettings();
      this._syncSettings();
    });
    this.elements['mute-setting']?.addEventListener('click', () => this.audio?.toggleMute());
  }

  _syncSettings() {
    const muted = this.audio?.muted || false;
    if (this.elements['volume-setting']) this.elements['volume-setting'].value = this.settings.volume * 100;
    if (this.elements['music-setting']) this.elements['music-setting'].value = this.settings.musicVolume * 100;
    if (this.elements['sensitivity-setting']) this.elements['sensitivity-setting'].value = this.settings.sensitivity * 1000;
    this._text('volume-value', `${Math.round(this.settings.volume * 100)}%`);
    this._text('music-value', `${Math.round(this.settings.musicVolume * 100)}%`);
    this._text('sensitivity-value', `${(this.settings.sensitivity / 0.002).toFixed(2)}×`);
    this._text('mute-setting', muted ? 'Unmute audio' : 'Mute audio');
    this.elements['mute-setting']?.setAttribute('aria-pressed', String(muted));
    this.elements['mute-indicator']?.classList.toggle('visible', muted);
  }

  _readSettings() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch { /* Storage may be unavailable. */ }
    return {
      volume: clamp(saved?.volume, 0, 1, 0.65),
      musicVolume: clamp(saved?.musicVolume, 0, 1, 0.8),
      sensitivity: clamp(saved?.sensitivity, 0.0005, 0.005, 0.002),
    };
  }

  _saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* Session settings still work. */ }
  }
}
