const TARGET_IDS = ['tr-relay-1', 'tr-relay-2', 'tr-relay-3'];

/** Completion belongs to the current level visit, never to room entry. */
export default class ShootingLesson {
  constructor() {
    this.hits = new Set();
    this.inside = false;
    this._completionTime = 0;
    this.instruction = {
      text: 'RIGHT MOUSE / Z: AIM  ·  LEFT CLICK / F: FIRE',
      sub: 'HIT ALL 3 MONSTER DUMMIES (0/3) — AIM AT THEIR CYAN CHESTS',
    };
    this.success = {
      text: 'SHOOTING TRAINING COMPLETE — 3/3 DUMMIES HIT',
      sub: 'RETURN TO THE HUB. FINISH JUMP TRAINING TO RELEASE THE GATE.',
    };
  }

  get completed() { return this.hits.size === TARGET_IDS.length; }
  get message() {
    if (!this.inside) return null;
    return this.completed ? this._completionTime > 0 ? this.success : null : this.instruction;
  }

  hit(id) {
    if (!TARGET_IDS.includes(id) || this.hits.has(id)) return false;
    this.hits.add(id);
    this.instruction.sub = `HIT ALL 3 MONSTER DUMMIES (${this.hits.size}/3) — AIM AT THEIR CYAN CHESTS`;
    if (this.completed) this._completionTime = 4;
    return true;
  }

  update(dt, position) {
    this._completionTime = Math.max(0, this._completionTime - dt);
    this.inside = position.x > 9.3 && position.x < 19
      && position.z < -14.3 && position.z > -24;
  }
}
