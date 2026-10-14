const PHASES = [
  ['powering', 2.6], ['alarm', 1.8], ['mutate', 2.2],
  ['burst', 0.7], ['flee', 9],
];

/** Player-triggered opening; advances on gameplay time, so pause freezes it. */
export default class LabOpening {
  constructor(onPhase) {
    this.phase = 'standby';
    this.timer = 0;
    this.entered = false;
    this.repaired = false;
    this.onPhase = onPhase;
  }

  enter() {
    if (this.entered) return false;
    this.entered = true;
    return true;
  }

  repair() {
    if (!this.entered || this.repaired) return false;
    this.repaired = true;
    this._setPhase('powering');
    return true;
  }

  update(dt) {
    if (this.phase === 'standby' || this.phase === 'done') return;
    this.timer += dt;
    let index = PHASES.findIndex(([phase]) => phase === this.phase);
    while (index >= 0 && this.timer + 1e-8 >= PHASES[index][1]) {
      const remainder = Math.max(0, this.timer - PHASES[index][1]);
      this._setPhase(PHASES[index + 1]?.[0] || 'done');
      this.timer = remainder;
      index++;
      if (index >= PHASES.length) break;
    }
  }

  finishEscape() {
    if (this.phase === 'flee') this._setPhase('done');
  }

  _setPhase(phase) {
    this.phase = phase;
    this.timer = 0;
    this.onPhase?.(phase);
  }
}
