/** A second creature waits for the pressure door, then announces the final chase. */
export default class ServerAmbush {
  constructor(triggerZ = -39.3, reactionTime = 1) {
    this.triggerZ = triggerZ;
    this.reactionTime = reactionTime;
    this.stage = 'waiting';
    this.timer = 0;
  }

  update(dt, doorProgress, playerZ) {
    if (this.stage === 'waiting') {
      if (doorProgress >= 1 && playerZ < this.triggerZ) this.stage = 'warning';
    } else if (this.stage === 'warning') {
      this.timer += dt;
      if (this.timer >= this.reactionTime) this.stage = 'chasing';
    }
    return this.stage;
  }
}
