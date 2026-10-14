/** Sight takes time to acquire; cover preserves only the last known position. */
export default class HuntAwareness {
  constructor(acquireTime = 0.65, forgetTime = 4) {
    this.acquireTime = acquireTime;
    this.forgetTime = forgetTime;
    this.reset();
  }

  reset() {
    this.exposure = 0;
    this.pursuing = false;
    this.visible = false;
    this.lostTime = 0;
    this.x = 0;
    this.z = 0;
  }

  observe(dt, visible, x, z) {
    this.visible = visible;
    if (visible) {
      this.exposure = Math.min(1, this.exposure + dt / this.acquireTime);
      this.x = x;
      this.z = z;
      this.lostTime = 0;
      if (this.exposure >= 1) this.pursuing = true;
    } else {
      this.exposure = Math.max(0, this.exposure - dt * 2);
      if (this.pursuing) {
        this.lostTime += dt;
        if (this.lostTime >= this.forgetTime) this.reset();
      }
    }
    return this.pursuing;
  }

  hear(x, z) {
    this.x = x;
    this.z = z;
    this.pursuing = true;
    this.lostTime = 0;
  }

  get searching() { return this.pursuing && (!this.visible || this.exposure < 1); }
}
