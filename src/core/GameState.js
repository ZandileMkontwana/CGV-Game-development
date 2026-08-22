/**
 * GameState — manages game lifecycle: menu, playing, paused, level transitions.
 *
 * States:
 *   'loading' → 'menu' → 'playing' → 'paused' ↔ 'playing'
 *                                       ↓
 *                                   'levelTransition' → 'playing'
 *                                       ↓
 *                                   'gameover' → 'menu'
 *
 * Other systems subscribe via `onChange(callback)` to react to state changes.
 */

const STATES = new Set([
  'loading',
  'menu',
  'playing',
  'paused',
  'levelTransition',
  'gameover',
]);

export default class GameState {
  constructor() {
    this._state = 'loading';
    this._currentLevel = 1;
    this._totalLevels = 3;
    this._listeners = [];

    // --- Wire up UI buttons -------------------------------------------------
    this._btnStart = document.getElementById('btn-start');
    this._btnCredits = document.getElementById('btn-credits');
    this._btnResume = document.getElementById('btn-resume');
    this._btnRestart = document.getElementById('btn-restart');
    this._btnMainMenu = document.getElementById('btn-main-menu');

    this._menuOverlay = document.getElementById('menu-overlay');
    this._pauseOverlay = document.getElementById('pause-overlay');
    this._loadingScreen = document.getElementById('loading-screen');
    this._loadingBar = document.getElementById('loading-bar');
    this._levelIndicator = document.getElementById('level-indicator');
    this._hud = document.getElementById('hud');

    // Button listeners.
    this._btnStart?.addEventListener('click', () => this.startGame());
    this._btnResume?.addEventListener('click', () => this.resume());
    this._btnRestart?.addEventListener('click', () => this.restart());
    this._btnMainMenu?.addEventListener('click', () => this.goToMenu());

    // ESC to pause / resume.
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this._state === 'playing') this.pause();
        else if (this._state === 'paused') this.resume();
      }
    });
  }

  // --- Public API -----------------------------------------------------------

  get state() { return this._state; }
  get currentLevel() { return this._currentLevel; }
  get isPlaying() { return this._state === 'playing'; }

  /** Register a callback: (newState, oldState) => void */
  onChange(fn) {
    this._listeners.push(fn);
  }

  /** Called when assets are done loading. */
  onLoaded() {
    this._setState('menu');
  }

  /** Update the loading bar (0–100). */
  setLoadingProgress(percent) {
    if (this._loadingBar) this._loadingBar.style.width = percent + '%';
  }

  startGame() {
    this._currentLevel = 1;
    this._updateLevelIndicator();
    this._setState('playing');
  }

  pause() {
    if (this._state !== 'playing') return;
    document.exitPointerLock?.();
    this._setState('paused');
  }

  resume() {
    if (this._state !== 'paused') return;
    this._setState('playing');
  }

  restart() {
    this._currentLevel = 1;
    this._updateLevelIndicator();
    this._setState('playing');
  }

  goToMenu() {
    document.exitPointerLock?.();
    this._setState('menu');
  }

  /** Advance to the next level. Returns false if the game is complete. */
  nextLevel() {
    if (this._currentLevel >= this._totalLevels) {
      this._setState('gameover');
      return false;
    }
    this._currentLevel++;
    this._updateLevelIndicator();
    this._setState('levelTransition');
    // Brief transition pause, then resume.
    setTimeout(() => {
      if (this._state === 'levelTransition') this._setState('playing');
    }, 1500);
    return true;
  }

  gameOver() {
    document.exitPointerLock?.();
    this._setState('gameover');
  }

  // --- Internals ------------------------------------------------------------

  _setState(newState) {
    if (!STATES.has(newState)) return;
    const old = this._state;
    this._state = newState;
    this._syncUI();
    for (const fn of this._listeners) fn(newState, old);
  }

  _syncUI() {
    // Loading screen.
    if (this._loadingScreen) {
      this._loadingScreen.style.display = this._state === 'loading' ? 'flex' : 'none';
    }

    // Main menu.
    if (this._menuOverlay) {
      const showMenu = this._state === 'menu' || this._state === 'gameover';
      this._menuOverlay.style.display = showMenu ? 'flex' : 'none';
    }

    // Pause overlay.
    if (this._pauseOverlay) {
      this._pauseOverlay.style.display = this._state === 'paused' ? 'flex' : 'none';
    }

    // HUD visible only while playing.
    if (this._hud) {
      this._hud.style.display =
        this._state === 'playing' || this._state === 'paused' ? 'block' : 'none';
    }
  }

  _updateLevelIndicator() {
    if (this._levelIndicator) {
      this._levelIndicator.textContent = `LEVEL ${this._currentLevel}`;
    }
  }
}
