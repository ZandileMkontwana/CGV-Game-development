import { Box } from 'cannon-es';

/** Ground-level routes around static collision bodies, built once per level. */
export default class NavigationGrid {
  constructor(bodies, bounds, radius = 0.75, cellSize = 0.5, height = 1.2) {
    this.bounds = bounds;
    this.cellSize = cellSize;
    this.columns = Math.floor((bounds.maxX - bounds.minX) / cellSize) + 1;
    this.rows = Math.floor((bounds.maxZ - bounds.minZ) / cellSize) + 1;
    const count = this.columns * this.rows;
    this.blocked = new Uint8Array(count);
    this._visited = new Uint8Array(count);
    this._parent = new Int32Array(count);
    this._queue = new Int32Array(count);
    this._obstacles = [];

    for (const body of bodies) {
      if (!body || body.mass !== 0 || !body.shapes.some(shape => shape instanceof Box)) continue;
      body.updateAABB();
      const { lowerBound, upperBound } = body.aabb;
      if (upperBound.y <= 0.05 || lowerBound.y >= height) continue;
      const obstacle = {
        minX: lowerBound.x - radius, maxX: upperBound.x + radius,
        minZ: lowerBound.z - radius, maxZ: upperBound.z + radius,
      };
      this._obstacles.push(obstacle);
      const minColumn = Math.max(0, Math.ceil((obstacle.minX - bounds.minX) / cellSize));
      const maxColumn = Math.min(this.columns - 1, Math.floor((obstacle.maxX - bounds.minX) / cellSize));
      const minRow = Math.max(0, Math.ceil((obstacle.minZ - bounds.minZ) / cellSize));
      const maxRow = Math.min(this.rows - 1, Math.floor((obstacle.maxZ - bounds.minZ) / cellSize));
      for (let row = minRow; row <= maxRow; row++) {
        for (let column = minColumn; column <= maxColumn; column++) {
          this.blocked[row * this.columns + column] = 1;
        }
      }
    }
  }

  nodeX(node) { return this.bounds.minX + node % this.columns * this.cellSize; }
  nodeZ(node) { return this.bounds.minZ + Math.floor(node / this.columns) * this.cellSize; }

  /** Check the whole segment against obstacles expanded for the actor radius. */
  isSegmentClear(x0, z0, x1, z1) {
    const b = this.bounds;
    if (Math.min(x0, x1) < b.minX || Math.max(x0, x1) > b.maxX
        || Math.min(z0, z1) < b.minZ || Math.max(z0, z1) > b.maxZ) return false;
    const dx = x1 - x0;
    const dz = z1 - z0;
    for (const obstacle of this._obstacles) {
      let near = 0;
      let far = 1;
      if (Math.abs(dx) < 1e-8) {
        if (x0 < obstacle.minX || x0 > obstacle.maxX) continue;
      } else {
        const a = (obstacle.minX - x0) / dx;
        const c = (obstacle.maxX - x0) / dx;
        near = Math.max(near, Math.min(a, c));
        far = Math.min(far, Math.max(a, c));
        if (near > far) continue;
      }
      if (Math.abs(dz) < 1e-8) {
        if (z0 < obstacle.minZ || z0 > obstacle.maxZ) continue;
      } else {
        const a = (obstacle.minZ - z0) / dz;
        const c = (obstacle.maxZ - z0) / dz;
        near = Math.max(near, Math.min(a, c));
        far = Math.min(far, Math.max(a, c));
      }
      if (near <= far) return false;
    }
    return true;
  }

  _nearestNode(x, z) {
    const column = Math.max(0, Math.min(this.columns - 1, Math.round((x - this.bounds.minX) / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.round((z - this.bounds.minZ) / this.cellSize)));
    const node = row * this.columns + column;
    if (!this.blocked[node]) return node;
    // Contacts can put an actor just inside the navigation clearance margin.
    // Pick a nearby free node so it can move back out of that margin.
    for (let radius = 1; radius < Math.max(this.columns, this.rows); radius++) {
      let best = -1;
      let bestDistance = Infinity;
      for (let rz = Math.max(0, row - radius); rz <= Math.min(this.rows - 1, row + radius); rz++) {
        for (let cx = Math.max(0, column - radius); cx <= Math.min(this.columns - 1, column + radius); cx++) {
          if (Math.abs(cx - column) !== radius && Math.abs(rz - row) !== radius) continue;
          const candidate = rz * this.columns + cx;
          if (this.blocked[candidate]) continue;
          const distance = (this.nodeX(candidate) - x) ** 2 + (this.nodeZ(candidate) - z) ** 2;
          if (distance < bestDistance) { bestDistance = distance; best = candidate; }
        }
      }
      if (best !== -1) return best;
    }
    return -1;
  }

  /** Fill a reusable node list. Four neighbours prevent cutting solid corners. */
  findPath(x0, z0, x1, z1, path) {
    path.length = 0;
    const start = this._nearestNode(x0, z0);
    const goal = this._nearestNode(x1, z1);
    if (start === -1 || goal === -1) return false;
    this._visited.fill(0);
    this._parent.fill(-1);
    let head = 0;
    let tail = 1;
    this._queue[0] = start;
    this._visited[start] = 1;
    while (head < tail) {
      const current = this._queue[head++];
      if (current === goal) break;
      const column = current % this.columns;
      const row = Math.floor(current / this.columns);
      for (let direction = 0; direction < 4; direction++) {
        let next;
        if (direction === 0 && column > 0) next = current - 1;
        else if (direction === 1 && column < this.columns - 1) next = current + 1;
        else if (direction === 2 && row > 0) next = current - this.columns;
        else if (direction === 3 && row < this.rows - 1) next = current + this.columns;
        else continue;
        if (this.blocked[next] || this._visited[next]) continue;
        if (!this.isSegmentClear(this.nodeX(current), this.nodeZ(current), this.nodeX(next), this.nodeZ(next))) continue;
        this._visited[next] = 1;
        this._parent[next] = current;
        this._queue[tail++] = next;
      }
    }
    if (!this._visited[goal]) return false;
    for (let node = goal; node !== -1; node = this._parent[node]) path.push(node);
    path.reverse();
    return true;
  }
}
