/** Staff patrol and evacuation, using the level's collision clearance grid. */
export default class StaffWalker {
  constructor(npc, path, { speed = 1, pause = 0 } = {}) {
    this.npc = npc;
    this.path = path;
    this.idx = 1;
    this.speed = speed;
    this.pause = pause;
    this.state = 'patrol';
    this.fleeSpeed = 3.1;
    this.destination = null;
    this.animState = { moving: false, speed, fleeing: false };
    this._navigation = null;
    this._route = [];
    this._cursor = 0;
    this._retry = 0;
    this._planned = false;
  }

  setNavigation(grid) {
    this._navigation = grid;
    this._planned = false;
    this._retry = 0;
  }

  evacuate(destination) {
    if (this.state === 'flee') return;
    this.state = 'flee';
    this.destination = destination;
    this.pause = 0;
    this._planned = false;
    this._retry = 0;
  }

  alert() {
    this.animState.alerted = true;
    if (this.state === 'patrol') this.pause = Math.max(this.pause, 0.6);
  }

  /** A creature approaching a refuge makes staff continue to a farther room. */
  reactToThreat(threat, destination) {
    if (!threat || this.state === 'flee' || !this._navigation) return;
    const p = this.npc.group.position;
    const distance = Math.hypot(p.x - threat.x, p.z - threat.z);
    if (distance > 9 || !this._navigation.isSegmentClear(p.x, p.z, threat.x, threat.z)) return;
    if (Math.hypot(destination.x - threat.x, destination.z - threat.z) < distance + 1) return;
    this.alert();
    this.evacuate(destination);
  }

  update(dt) {
    const st = this.animState;
    st.moving = false;
    st.fleeing = this.state !== 'patrol';
    this._retry -= dt;
    if (this.pause > 0) this.pause = Math.max(0, this.pause - dt);
    else if (this.state !== 'safe' && this._navigation
      && !(this.state === 'patrol' && st.alerted)) this._move(dt);
    this.npc.update(dt, st);
  }

  _move(dt) {
    const grid = this._navigation;
    const group = this.npc.group;
    const p = group.position;
    const target = this.state === 'flee' ? this.destination : this.path[this.idx];
    if (!target) return;
    if (Math.hypot(target.x - p.x, target.z - p.z) < 0.08) {
      if (this.state === 'flee') this.state = 'safe';
      else {
        this.idx = (this.idx + 1) % this.path.length;
        this.pause = 1 + Math.random() * 2.4;
      }
      this._planned = false;
      this._retry = 0;
      return;
    }
    let x = target.x;
    let z = target.z;
    if (!grid.isSegmentClear(p.x, p.z, x, z)) {
      if (!this._planned && this._retry <= 0) {
        grid.findPath(p.x, p.z, x, z, this._route);
        this._cursor = 0;
        this._planned = true;
        this._retry = 0.75;
      }
      while (this._cursor < this._route.length) {
        const node = this._route[this._cursor];
        x = grid.nodeX(node);
        z = grid.nodeZ(node);
        if (Math.hypot(x - p.x, z - p.z) > 0.04) break;
        this._cursor++;
      }
      if (this._cursor >= this._route.length || !grid.isSegmentClear(p.x, p.z, x, z)) {
        // A sealed door or obstructed goal makes staff wait, never clip through.
        this._planned = false;
        return;
      }
    }
    const dx = x - p.x;
    const dz = z - p.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-8) return;
    const speed = this.state === 'flee' ? this.fleeSpeed : this.speed;
    const step = Math.min(speed * dt, distance);
    const nextX = p.x + dx / distance * step;
    const nextZ = p.z + dz / distance * step;
    // Sweep the entire footprint, including on long frames and at corners.
    if (!grid.isSegmentClear(p.x, p.z, nextX, nextZ)) return;
    p.x = nextX;
    p.z = nextZ;
    const yaw = Math.atan2(dx, dz) - group.rotation.y;
    group.rotation.y += Math.atan2(Math.sin(yaw), Math.cos(yaw)) * Math.min(1, dt * 8);
    this.animState.moving = true;
    this.animState.speed = speed;
  }
}
