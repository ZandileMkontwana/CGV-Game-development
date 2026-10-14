/** Victory presentation, independent of the gameplay clock. */
export default class EndingSequence {
  constructor(gameState) {
    this.gameState = gameState;
    this.victory = document.getElementById('victory-overlay');
    this.credits = document.getElementById('end-credits-overlay');
    this.viewport = document.getElementById('credits-viewport');
    this.track = document.getElementById('credits-track');
    this.controls = document.getElementById('credits-controls');
    this.complete = document.getElementById('credits-complete');
    this.pauseButton = document.getElementById('btn-credits-pause');
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Both credit presentations use the same attribution, including license links.
    const details = document.getElementById('credits-details').cloneNode(true);
    details.removeAttribute('id');
    details.querySelectorAll('a').forEach(link => { link.tabIndex = -1; });
    document.getElementById('credits-roll-content').appendChild(details);

    document.getElementById('btn-watch-credits').addEventListener('click', () => gameState.showEndCredits());
    document.getElementById('btn-victory-menu').addEventListener('click', () => gameState.goToMenu());
    document.getElementById('btn-credits-skip').addEventListener('click', () => this.finish());
    document.getElementById('btn-credits-replay').addEventListener('click', () => gameState.restart());
    document.getElementById('btn-credits-menu').addEventListener('click', () => gameState.goToMenu());
    this.pauseButton.addEventListener('click', () => {
      if (!this.animation) return;
      if (this.animation.playState === 'paused') this.animation.play();
      else this.animation.pause();
      this._syncPauseButton();
    });
    window.addEventListener('keydown', event => {
      if (!['victory', 'credits'].includes(gameState.state)) return;
      if (event.code === 'Escape') {
        event.preventDefault();
        if (gameState.state === 'victory') gameState.showEndCredits();
        else if (this.complete.hidden) this.finish();
        else gameState.goToMenu();
      }
      // Keep keyboard focus in the visible ending screen.
      if (event.key === 'Tab') {
        const overlay = gameState.state === 'victory' ? this.victory : this.credits;
        const focusable = [...overlay.querySelectorAll('button, [tabindex="0"]')]
          .filter(element => element.getClientRects().length > 0);
        const index = focusable.indexOf(document.activeElement);
        if (index < 0 || (!event.shiftKey && index === focusable.length - 1)
            || (event.shiftKey && index === 0)) {
          event.preventDefault();
          focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus();
        }
      }
    });
    window.addEventListener('resize', () => this._refreshRoll());
    this.reducedMotion.addEventListener('change', () => this._refreshRoll());
  }

  setState(state) {
    clearTimeout(this.timer);
    this._cancelAnimation();
    this.victory.hidden = state !== 'victory';
    this.credits.hidden = state !== 'credits';
    if (state === 'victory') {
      document.getElementById('btn-watch-credits').focus({ preventScroll: true });
      this.timer = setTimeout(() => this.gameState.showEndCredits(), 5000);
    } else if (state === 'credits') {
      this.complete.hidden = true;
      this.viewport.hidden = false;
      this.controls.hidden = false;
      this.viewport.scrollTop = 0;
      this._animateRoll();
      (this.reducedMotion.matches ? document.getElementById('btn-credits-skip') : this.pauseButton)
        .focus({ preventScroll: true });
    }
  }

  _animateRoll(progress = 0, paused = false) {
    this._cancelAnimation();
    const staticCredits = this.reducedMotion.matches;
    this.credits.classList.toggle('credits-static', staticCredits);
    this.pauseButton.hidden = staticCredits;
    this.viewport.tabIndex = staticCredits ? 0 : -1;
    document.getElementById('btn-credits-skip').textContent = staticCredits ? 'Finish credits' : 'Skip credits';
    if (staticCredits) return;

    const start = this.viewport.clientHeight;
    const end = -this.track.scrollHeight;
    // A constant reading speed; longer credits receive more time.
    const duration = (start - end) / 45 * 1000;
    this.animation = this.track.animate([
      { transform: `translateY(${start}px)` },
      { transform: `translateY(${end}px)` },
    ], { duration, easing: 'linear', fill: 'both' });
    this.animation.currentTime = progress * duration;
    if (paused) this.animation.pause();
    this.animation.onfinish = () => this.finish();
    this._syncPauseButton();
  }

  _refreshRoll() {
    if (this.gameState.state !== 'credits' || !this.complete.hidden) return;
    const duration = this.animation?.effect.getTiming().duration || 1;
    const progress = Math.min(1, (this.animation?.currentTime || 0) / duration);
    const paused = this.animation?.playState === 'paused';
    this._animateRoll(progress, paused);
  }

  _syncPauseButton() {
    const paused = this.animation?.playState === 'paused';
    this.pauseButton.textContent = paused ? 'Resume credits' : 'Pause credits';
    this.pauseButton.setAttribute('aria-pressed', String(paused));
  }

  _cancelAnimation() {
    if (!this.animation) return;
    this.animation.onfinish = null;
    this.animation.cancel();
    this.animation = null;
  }

  finish() {
    if (this.gameState.state !== 'credits' || !this.complete.hidden) return;
    this._cancelAnimation();
    this.viewport.hidden = true;
    this.controls.hidden = true;
    this.complete.hidden = false;
    document.getElementById('btn-credits-menu').focus({ preventScroll: true });
  }
}
