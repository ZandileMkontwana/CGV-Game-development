const NEXT = { pursuit: 'windup', windup: 'charge', charge: 'recover', recover: 'pursuit' };
const DURATION = { pursuit: 3.2, windup: 0.85, charge: 1.1, recover: 1.4 };

/** A readable attack rhythm with a locked charge destination and recovery. */
export default class BossEncounter {
  constructor(onStage) {
    this.onStage = onStage;
    this.reset();
  }

  reset() {
    this.stage = 'waiting';
    this.timer = 0;
    this.x = 0;
    this.z = 0;
  }

  wake() { if (this.stage === 'waiting') this._setStage('pursuit'); }

  update(dt, player, engaged = true) {
    if (this.stage === 'waiting') {
      if (player.z < -12) this.wake();
      return;
    }
    if (this.stage === 'pursuit' && !engaged) { this.timer = 0; return; }
    this.timer += dt;
    while (this.timer >= DURATION[this.stage]) {
      const remainder = this.timer - DURATION[this.stage];
      const next = NEXT[this.stage];
      if (next === 'windup') { this.x = player.x; this.z = player.z; }
      this._setStage(next);
      this.timer = remainder;
    }
  }

  stagger() { this._setStage('recover'); }
  stopCharge() { if (this.stage === 'charge') this._setStage('recover'); }

  _setStage(stage) {
    this.stage = stage;
    this.timer = 0;
    this.onStage?.(stage);
  }
}
