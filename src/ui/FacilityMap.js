import { Vector3 } from 'three';

const ROOM_LABELS = {
  1: [[0, -4, 'TRAINING'], [0, -19, 'HUB'], [-14, -19, 'JUMP'], [14, -19, 'RANGE'],
    [0, -39, 'RECEPTION'], [0, -60, 'LAB A-2'], [0, -81, 'REACTOR'], [0, -93, 'CONTROL']],
  2: [[0, -5, 'STAGING'], [-12, -15, 'REFUGE'], [-12, -24, 'MEDICAL'], [0, -24, 'QUARTERS'],
    [0, -34, 'PRESSURE'], [0, -46, 'SERVERS'], [12, -45, 'ARCHIVE'], [0, -59, 'CORE ACCESS']],
  3: [[0, -5, 'ENTRY'], [0, -25, 'CONTAINMENT'], [-18, -25, 'WEST POWER'], [18, -23, 'EAST POWER'],
    [0, -51, 'MAINTENANCE'], [24, -69, 'BYPASS'], [6, -81, 'TRANSFER'], [-12, -103, 'SURFACE EXIT']],
};

export function floorBounds(floors) {
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const floor of floors) {
    bounds.minX = Math.min(bounds.minX, floor.x - floor.w / 2);
    bounds.maxX = Math.max(bounds.maxX, floor.x + floor.w / 2);
    bounds.minZ = Math.min(bounds.minZ, floor.z - floor.d / 2);
    bounds.maxZ = Math.max(bounds.maxZ, floor.z + floor.d / 2);
  }
  return floors.length ? bounds : { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
}

/** Preserve metres and direction on both the local and whole-facility views. */
export function mapView(bounds, player, width, height, expanded, result = {}) {
  result.x = expanded ? (bounds.minX + bounds.maxX) / 2 : player.x;
  result.z = expanded ? (bounds.minZ + bounds.maxZ) / 2 : player.z;
  result.scale = expanded
    ? Math.min((width - 44) / (bounds.maxX - bounds.minX), (height - 44) / (bounds.maxZ - bounds.minZ))
    : Math.min(width, height) / 25;
  result.width = width;
  result.height = height;
  return result;
}

export function projectMapPoint(x, z, view, result = {}) {
  result.x = view.width / 2 + (x - view.x) * view.scale;
  result.y = view.height / 2 + (z - view.z) * view.scale;
  return result;
}

/** Canvas plan view; no extra WebGL scene, lights or shadow maps. */
export default class FacilityMap {
  constructor(panel, canvas) {
    this.panel = panel;
    this.canvas = canvas;
    this.context = canvas?.getContext('2d');
    this.expanded = false;
    this.levels = null;
    this._elapsed = 0;
    this._version = -1;
    this._obstacles = [];
    this._markers = [];
    this._point = new Vector3();
    this._screen = {};
    this._view = {};
  }

  setLevel(levels) {
    this.levels = levels;
    const staffLegend = this.panel?.querySelector('.map-staff');
    if (staffLegend) staffLegend.hidden = levels.currentLevel !== 2;
    this.bounds = floorBounds(levels.mapFloors);
    this.setExpanded(false);
    this._version = -1;
    this._elapsed = 1;
    this._markers = levels._powerNodes.map(node => ({ mesh: node.mesh, node }));
    for (const mesh of levels.shootables) {
      const data = mesh.userData;
      if (data.powerNode || !(data.doorId || data.ventId || data.storyAction || data.missionAction)) continue;
      this._markers.push({ mesh,
        door: levels._doors.find(door => door.id === data.doorId),
        vent: levels._steamVents.find(vent => vent.id === data.ventId),
        relay: data.storyAction === 'restore-lab-power',
      });
    }
    if (this.panel) this.panel.hidden = false;
  }

  clear() {
    this.levels = null;
    this._obstacles.length = this._markers.length = 0;
    this.setExpanded(false);
    if (this.panel) this.panel.hidden = true;
  }

  setExpanded(expanded) {
    this.expanded = expanded;
    this.panel?.classList.toggle('expanded', expanded);
    this.panel?.closest('#hud')?.classList.toggle('map-expanded', expanded);
    const key = this.panel?.querySelector('.map-key');
    if (key) key.textContent = expanded ? 'M · CLOSE' : 'M · EXPAND';
    this._elapsed = 1;
  }

  toggle() { if (this.levels) this.setExpanded(!this.expanded); }

  update(dt, player, yaw) {
    if (!this.levels || !this.context) return;
    this._elapsed += dt;
    if (this._elapsed < 0.1) return;
    this._elapsed = 0;
    if (this._version !== this.levels.navigationVersion) this._cacheObstacles();
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
    }
    const ctx = this.context;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const view = mapView(this.bounds, player, width, height, this.expanded, this._view);
    ctx.fillStyle = '#071319';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#10262f';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y < height; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    ctx.fillStyle = '#1b3945';
    ctx.strokeStyle = '#547884';
    for (const floor of this.levels.mapFloors) this._rectangle(floor.x - floor.w / 2, floor.z - floor.d / 2, floor.w, floor.d);
    for (const obstacle of this._obstacles) {
      if (!obstacle.body.world) continue;
      ctx.fillStyle = obstacle.wall ? '#08171e' : '#29434d';
      ctx.strokeStyle = obstacle.wall ? '#7897a1' : '#3b5965';
      this._rectangle(obstacle.x, obstacle.z, obstacle.w, obstacle.d);
    }
    for (const door of this.levels._doors) {
      door.body.updateAABB();
      const b = door.body.aabb;
      ctx.fillStyle = door.progress >= 1 ? '#69dca4' : '#e6a959';
      ctx.strokeStyle = ctx.fillStyle;
      this._rectangle(b.lowerBound.x, b.lowerBound.z, Math.max(0.18, b.upperBound.x - b.lowerBound.x), Math.max(0.18, b.upperBound.z - b.lowerBound.z));
    }
    if (this.expanded) {
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#c9dce0';
      for (const [x, z, label] of ROOM_LABELS[this.levels.currentLevel] || []) {
        const p = projectMapPoint(x, z, view, this._screen);
        ctx.fillText(label, p.x, p.y);
      }
    }
    for (const marker of this._markers) {
      const point = marker.mesh.getWorldPosition(this._point);
      const done = marker.node?.lit || marker.door?.opening || (marker.vent && !marker.vent.active)
        || marker.mesh.userData.completed || (marker.relay && marker.mesh.material.color.g > marker.mesh.material.color.r);
      this._dot(point.x, point.z, done ? '#75d7a3' : '#ffbd69', 3);
    }
    for (const survivor of this.levels.expansion?.survivors || []) {
      const point = survivor.walker.npc.group.position;
      this._dot(point.x, point.z, this.levels.expansion.progress.rescued.has(survivor.id) ? '#75d7a3' : '#ffffff', 3);
    }
    for (const exit of this.levels.winTriggers) this._dot(exit.x, exit.z, '#74edb0', 5, true);
    const p = projectMapPoint(player.x, player.z, view, this._screen);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-yaw);
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath();
    ctx.fillStyle = '#8aeeff'; ctx.fill();
    ctx.strokeStyle = '#052932'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#8aa7b0'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
    ctx.fillText('N ↑', 10, 16);
  }

  _cacheObstacles() {
    const doors = new Set(this.levels._doors.map(door => door.body));
    this._obstacles.length = 0;
    for (const { body } of this.levels._disposables) {
      if (!body?.world || body.mass !== 0 || doors.has(body)) continue;
      body.updateAABB();
      const b = body.aabb;
      if (b.upperBound.y <= 0.1 || b.lowerBound.y >= 1.8) continue;
      this._obstacles.push({ body, x: b.lowerBound.x, z: b.lowerBound.z,
        w: b.upperBound.x - b.lowerBound.x, d: b.upperBound.z - b.lowerBound.z,
        wall: b.upperBound.y - b.lowerBound.y > 2,
      });
    }
    this._version = this.levels.navigationVersion;
  }

  _rectangle(x, z, width, depth) {
    const p = projectMapPoint(x, z, this._view, this._screen);
    const w = width * this._view.scale, h = depth * this._view.scale;
    this.context.fillRect(p.x, p.y, w, h);
    this.context.strokeRect(p.x, p.y, w, h);
  }

  _dot(x, z, color, radius, exit = false) {
    const p = projectMapPoint(x, z, this._view, this._screen);
    const ctx = this.context;
    ctx.fillStyle = color;
    if (exit) ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
    else { ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill(); }
  }
}
