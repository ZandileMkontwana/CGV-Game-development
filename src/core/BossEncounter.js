const NEXT = { pursuit: 'windup', windup: 'charge', charge: 'recover', recover: 'pursuit', sweepWindup: 'sweep', sweep: 'recover' };
const DURATION = { pursuit: 3.2, windup: 0.85, charge: 1.1, recover: 1.8, sweepWindup: 1.2, sweep: 0.3 };

/** A readable attack rhythm with a locked charge destination and recovery. */
export default class BossEncounter {
  constructor(onStage) {
    this.onStage = onStage;
    this.armed = true; // Generator power enables node damage, never detection or attacks.
    this.reset();
  }

  reset() {
    this.stage = 'waiting';
    this.timer = 0;
    this.x = 0;
    this.z = 0;
    this.phase = 0;
    this.attacks = 0;
    this.wounded = false;
  }

  wake() { if (this.stage === 'waiting') this._setStage('pursuit'); }
  get vulnerable() { return this.armed && this.stage === 'recover' && !this.wounded; }

  update(dt, player, engaged = true) {
    if (this.stage === 'waiting') {
      if (player.z < -12) this.wake();
      return;
    }
    if (this.stage === 'pursuit' && !engaged) { this.timer = 0; return; }
    this.timer += dt;
    const duration = stage => stage === 'pursuit' ? 3.2 - this.phase * 0.55 : DURATION[stage];
    while (this.timer >= duration(this.stage)) {
      const remainder = this.timer - duration(this.stage);
      let next = NEXT[this.stage];
      if (next === 'windup') {
        this.attacks++;
        if (this.phase >= 2 && this.attacks % 2 === 1) next = 'sweepWindup';
        this.x = player.x; this.z = player.z;
      }
      this._setStage(next);
      this.timer = remainder;
    }
  }

  stagger() { this._setStage('recover'); this.wounded = true; }
  stopCharge() { if (this.stage === 'charge') this._setStage('recover'); }

  _setStage(stage) {
    this.stage = stage;
    this.timer = 0;
    if (stage === 'recover') this.wounded = false;
    this.onStage?.(stage);
  }
}
