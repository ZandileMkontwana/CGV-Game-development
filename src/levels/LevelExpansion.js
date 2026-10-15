import * as THREE from 'three';
import { HuntProgress, CollapseProgress, ESCAPE_CHECKPOINTS } from '../core/MissionProgress.js';

function panel(host, action, x, y, z, rotation, title, subtitle) {
  const mesh = host._shootableTarget(0.65, 0.6, x, y, z, 'terminal', rotation);
  mesh.userData.missionAction = action;
  mesh.material.color.setHex(0xffb14a);
  mesh.material.emissive.setHex(0xffb14a);
  const face = rotation === Math.PI / 2 ? 'e' : rotation === -Math.PI / 2 ? 'w' : 's';
  host._kit.sign(x, y + 0.7, z, face, title, { sub: subtitle, w: 2.2, h: 0.5, fg: '#ffce8a' });
  return mesh;
}

function completePanel(mesh) {
  if (mesh.userData.completed) return;
  mesh.userData.completed = true;
  mesh.material.color.setHex(0x75e6b1);
  mesh.material.emissive.setHex(0x46bc91);
}

function floorSignal(host, x, z, w, d, color) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.035, z);
  mesh.userData.ownsGeometry = mesh.userData.ownsMaterial = true;
  host.scene.add(mesh); host._track(mesh);
  return mesh;
}

function downloadOutline(host, area) {
  const w = area.maxX - area.minX, d = area.maxZ - area.minZ, thickness = 0.06;
  const shape = new THREE.Shape();
  shape.moveTo(-w/2,-d/2); shape.lineTo(w/2,-d/2); shape.lineTo(w/2,d/2); shape.lineTo(-w/2,d/2); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-w/2+thickness,-d/2+thickness); hole.lineTo(-w/2+thickness,d/2-thickness);
  hole.lineTo(w/2-thickness,d/2-thickness); hole.lineTo(w/2-thickness,-d/2+thickness); hole.closePath();
  shape.holes.push(hole);
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({
    color: 0x83e9f3, side: THREE.DoubleSide, toneMapped: false,
  }));
  mesh.rotation.x = -Math.PI/2;
  mesh.position.set((area.minX+area.maxX)/2,0.045,(area.minZ+area.maxZ)/2);
  mesh.visible = false;
  mesh.userData.ownsGeometry = mesh.userData.ownsMaterial = true;
  host.scene.add(mesh); host._track(mesh);
  return mesh;
}

export class HuntExpansion {
  constructor(host) {
    this.host = host;
    this.progress = new HuntProgress();
    this.notices = [];
    this._noiseTimer = 0;
    this.noise = false;
    const kit = host._kit, m = host._mats;
    this.panels = new Map();
    this.panels.set('rescue', panel(host, 'rescue', -7.96, 1.6, -24.1, Math.PI / 2,
      'MEDICAL / DISTRESS SIGNAL', 'PULSE TO RELEASE SCIENTISTS'));
    host._createDoor('l2-medical', 2.4, 2.6, -8.15, 1.3, -25.7, Math.PI / 2, m.metalDark,
      { locked: true, lockedHint: 'PULSE THE MEDICAL RESCUE RELAY' });
    // A staffed, protected refuge north of the triage ward.
    kit.floorSlab(8.3, 6, -12.15, -15.15);
    kit.ceilingSlab(8.3, 6, -12.15, 3, -15.15, { lamps: [{ x: 0, z: 0, light: true, intensity: 0.65 }] });
    kit.wallRun(8.3, 3, 0.3, -12.15, 1.5, -12.15);
    for (const x of [-16.15, -8.15]) kit.wallRun(0.3, 3, 6, x, 1.5, -15.15);
    kit.sign(-12.15, 2.2, -12.34, 'n', 'MEDICAL / SAFE REFUGE', { sub: 'ESCORT BOTH SCIENTISTS HERE', fg: '#91efb8', w: 3.2 });
    floorSignal(host, -12.15, -15, 4, 3, 0x64dc91);
    this.survivors = [-23.8, -27.2].map((z, i) => {
      const walker = host._addWalker(i ? 'coat' : 'supervisor', [{ x: -12.1, z }, { x: -12.1, z }]);
      walker.state = 'safe'; walker.pause = 0; walker.fleeSpeed = 1.8;
      return { walker, refuge: { x: -13.1 + i * 2, z: -15 }, id: i };
    });
    kit.sign(-12.15, 2.7, -18.4, 'n', 'SAFE REFUGE ↑', { sub: 'STAY NEAR BOTH SCIENTISTS', fg: '#9feac0', w: 2.3, h: 0.4 });
    this.panels.set('archive-power', panel(host, 'archive-power', 15.94, 1.55, -48.0, -Math.PI / 2,
      'ARCHIVE / POWER', 'PULSE TO RESTORE RECORDS SYSTEM'));
    this.terminal = panel(host, 'archive-download', 15.94, 1.55, -44.1, -Math.PI / 2,
      'CULTURE 09 / EVIDENCE', 'RESTORE POWER, THEN PULSE TO DOWNLOAD');
    this.panels.set('archive-download', this.terminal);
    // Match the actual room floor so both table approaches count, without
    // allowing a transfer from the server room on the other side of the wall.
    const room = host.mapFloors.find(floor => Math.abs(this.terminal.position.x - floor.x) < floor.w/2
      && Math.abs(this.terminal.position.z - floor.z) < floor.d/2);
    this.downloadArea = { minX: room.x-room.w/2+0.4, maxX: room.x+room.w/2-0.4,
      minZ: room.z-room.d/2+0.4, maxZ: room.z+room.d/2-0.4 };
    this.downloadZone = downloadOutline(host, this.downloadArea);
    kit.sign(7.94, 2.4, -41.1, 'w', 'EAST ARCHIVE →', { sub: 'POWER + DATA TRANSFER', fg: '#8ce7eb', w: 1.8, h: 0.5 });
    host._createDoor('l2-transfer', 2.6, 2.6, 0, 1.3, -58.15, 0, m.metalDark,
      { locked: true, lockedHint: 'RESCUE BOTH SCIENTISTS AND RECOVER THE RECORDS' });
  }

  get canOpenPressure() { return this.progress.rescueComplete; }
  get canWin() { return this.progress.complete; }
  activate(action, player) {
    const mesh = this.panels.get(action);
    if (!mesh || Math.hypot(player.x - mesh.position.x, player.z - mesh.position.z) > 5) return false;
    if (action === 'archive-download' && !this.progress.archivePowered) {
      this.notices.push('Archive offline. Pulse the amber power relay farther south in this room.'); return false;
    }
    if (!this.progress.activate(action)) return false;
    if (action === 'rescue') {
      this.host.openDoor('l2-medical');
      for (const survivor of this.survivors) survivor.walker.evacuate(survivor.refuge);
      this.notices.push('Two survivors located. Stay within six metres and guide them north through medical to the green refuge.');
    } else if (action === 'archive-power') {
      this.host.archiveCircuit.restore();
      this.notices.push('Archive power restored. Pulse the evidence terminal, then stay inside the glowing archive floor outline.');
    } else this.notices.push('Evidence transfer started. Stay inside the glowing archive work area; machinery noise attracts the creatures.');
    if (action !== 'archive-download') completePanel(mesh);
    return true;
  }

  update(dt, player) {
    this.host.archiveCircuit.update(dt);
    for (const survivor of this.survivors) {
      const p = survivor.walker.npc.group.position;
      if (!this.progress.released || this.progress.rescued.has(survivor.id)) continue;
      if (Math.hypot(p.x - survivor.refuge.x, p.z - survivor.refuge.z) < 0.3) {
        this.progress.rescue(survivor.id);
        this.notices.push('Scientist safe (' + this.progress.rescued.size + '/2).');
      } else if (Math.hypot(player.x - p.x, player.z - p.z) > 6) survivor.walker.pause = 0.15;
    }
    const area = this.downloadArea;
    const near = player.x >= area.minX && player.x <= area.maxX && player.z >= area.minZ && player.z <= area.maxZ;
    this.nearTerminal = near;
    if (this.progress.update(dt, near)) {
      completePanel(this.terminal);
      this.notices.push('Experiment records secured. Evacuate through core access at the green beacon.');
    }
    this.downloadZone.visible = this.progress.archivePowered && !this.progress.records;
    this.downloadZone.material.color.setHex(this.progress.downloading && !near ? 0xffb348 : 0x83e9f3);
    this._noiseTimer -= dt;
    this.noise = this.progress.downloading && this._noiseTimer <= 0;
    if (this.noise) this._noiseTimer = 2;
    if (this.progress.rescueComplete && this.host.pressureReleased) this.host.openDoor('l2-pressure');
    if (this.canWin) this.host.openDoor('l2-transfer');
    return 0;
  }

  dispose() { this.host.archiveCircuit.dispose(); }
}

export class CollapseExpansion {
  constructor(host) {
    this.host = host;
    this.progress = new CollapseProgress();
    this.notices = [];
    this.time = this._damageCooldown = 0;
    this.panels = new Map();
    this.panels.set('generator-west', panel(host, 'generator-west', -21.94, 1.6, -27.5, Math.PI / 2,
      'EMERGENCY GENERATOR / WEST', 'AVOID PUMP ARM — PULSE TO START'));
    this.panels.set('generator-east', panel(host, 'generator-east', 20.94, 1.6, -23.3, -Math.PI / 2,
      'EMERGENCY GENERATOR / EAST', 'CROSS WHEN ELECTRICAL FIELD IS DARK'));
    const kit = host._kit, m = host._mats;
    kit.sign(-13.95, 2.8, -25.7, 'e', 'EMERGENCY POWER / WEST', { sub: 'PUMP GALLERY GENERATOR', fg: '#ffd199', w: 2.6 });
    kit.sign(13.95, 2.8, -20.7, 'w', 'EMERGENCY POWER / EAST', { sub: 'OBSERVATION GENERATOR', fg: '#ffd199', w: 2.6 });
    this.arm = kit.box(m.hazard, 3.7, 0.5, 0.25, -18.0, 0.45, -25.7, { physics: true, occluder: true });
    this.arm.userData.staticScenery = false;
    this.armBody = host._disposables.find(entry => entry.mesh === this.arm).body;
    kit.column(-18, -25.7, { h: 1.2, r: 0.22 });
    this.field = floorSignal(host, 17.5, -23.15, 1.4, 9.3, 0xffb348);
    this.slabs = [];
    for (const [x, z, w, d] of [[6, -55.75, 3.8, 2.3], [-6, -79.75, 3.8, 2.3], [-10.6, -93.15, 2.3, 3.8]]) {
      const mesh = kit.box(m.wallDark, w, 0.65, d, x, 3.7, z, { physics: true, occluder: true });
      mesh.userData.staticScenery = false;
      const body = host._disposables.find(entry => entry.mesh === mesh).body;
      const warning = floorSignal(host, x, z, w + 0.4, d + 0.4, 0xffb348);
      warning.visible = false;
      this.slabs.push({ mesh, body, warning, w, d, state: 'idle', timer: 0 });
    }
  }

  get canWin() { return this.progress.complete; }
  activate(action, player) {
    const mesh = this.panels.get(action);
    if (!mesh || Math.hypot(player.x - mesh.position.x, player.z - mesh.position.z) > 4) return false;
    if (!this.progress.activate(action)) return false;
    completePanel(mesh);
    this.notices.push(this.progress.powered ? 'Both generators online. Node shields disabled; pulse cyan nodes during recovery.'
      : 'Emergency power restored (1/2). Start the other generator.');
    return true;
  }
  startEscape() {
    this.progress.startEscape();
    this.notices.push('Surface route released. Ninety seconds: follow green lights; use the east service bypass around the rubble.');
  }

  update(dt, player) {
    this.time += dt; this._damageCooldown = Math.max(0, this._damageCooldown - dt);
    let damage = 0;
    if (!this.progress.generators.has('generator-west')) {
      this.arm.rotation.y += dt * 0.9;
      this.armBody.quaternion.setFromEuler(0, this.arm.rotation.y, 0);
      this.armBody.aabbNeedsUpdate = true;
      this.host.physics.world.broadphase.dirty = true;
      const dx = player.x + 18, dz = player.z + 25.7;
      const c = Math.cos(this.arm.rotation.y), s = Math.sin(this.arm.rotation.y);
      if (Math.abs(dx * c - dz * s) < 2.1 && Math.abs(dx * s + dz * c) < 0.55) damage = 12;
    }
    const cycle = this.time % 6;
    const electric = !this.progress.generators.has('generator-east') && cycle >= 1.2 && cycle < 3.4;
    this.field.material.color.setHex(electric ? 0xff5533 : 0xffbb55);
    this.field.material.opacity = this.progress.generators.has('generator-east') ? 0.05 : electric ? 0.7 : cycle < 1.2 ? 0.3 : 0.04;
    if (electric && Math.abs(player.x - 17.5) < 1.05 && Math.abs(player.z + 23.15) < 4.8) damage = 15;
    this.progress.update(player);
    if (this.progress.escapeStarted) for (const slab of this.slabs) {
      if (slab.state === 'idle' && Math.hypot(player.x - slab.mesh.position.x, player.z - slab.mesh.position.z) < 10) {
        slab.state = 'warning'; slab.warning.visible = true;
        this.notices.push('CEILING FAILURE AHEAD — keep off the flashing amber floor.');
      }
      if (slab.state === 'warning') {
        slab.timer += dt;
        slab.warning.material.opacity = 0.3 + Math.sin(slab.timer * 13) * 0.2;
        if (slab.timer >= 1.8) { slab.state = 'falling'; slab.timer = 0; }
      } else if (slab.state === 'falling') {
        slab.timer += dt;
        slab.mesh.position.y = Math.max(0.325, 3.7 - 5 * slab.timer * slab.timer);
        slab.body.position.y = slab.mesh.position.y; slab.body.aabbNeedsUpdate = true;
        this.host.physics.world.broadphase.dirty = true;
        if (slab.mesh.position.y === 0.325) {
          slab.state = 'landed'; slab.warning.visible = false; this.host.navigationVersion++;
          if (Math.abs(player.x - slab.mesh.position.x) < slab.w / 2 + 0.4 && Math.abs(player.z - slab.mesh.position.z) < slab.d / 2 + 0.4) damage = 20;
        }
      }
    }
    if (damage && this._damageCooldown === 0) { this._damageCooldown = 1.2; return damage; }
    return 0;
  }
  dispose() {}
}

/** Connected six-metre maintenance cells; turns and a blocked central shortcut. */
export function buildEscapeRoute(host) {
  const kit = host._kit, m = host._mats, H = 4;
  const route = [[0,0], [0,1], [0,2], [1,2], [2,2], [3,2], [3,3], [4,3], [4,4], [4,5], [3,5],
    [3,6], [2,6], [1,6], [0,6], [-1,6], [-2,6], [-2,7], [-2,8], [-2,9], [-2,10]];
  const cells = [...route, [3,4]], keys = new Set(cells.map(([x,z]) => x + ',' + z));
  const guideMaterial = new THREE.MeshBasicMaterial({ color: 0x8af0bd, toneMapped: false });
  for (let i = 0; i < cells.length; i++) {
    const [cx, cz] = cells[i], x = cx * 6, z = -45.15 - cz * 6;
    kit.floorSlab(6, 6, x, z); kit.ceilingSlab(6, 6, x, H, z, { beams: false, lamps: [] });
    if (i % 3 === 0) kit.lamp(x, z, { y: 3.7, color: 'red', light: i % 9 === 0, intensity: 0.6 });
    if (i % 4 === 0) host._dissolveWalls.push(kit.box(m.wallDark, 5.5, 0.16, 2.8, x, 3.85, z));
    for (const [dx, dz] of [[1,0], [-1,0], [0,1], [0,-1]]) {
      if (keys.has((cx + dx) + ',' + (cz + dz)) || (cx === 0 && cz === 0 && dz === -1)) continue;
      kit.wallRun(dx ? 0.3 : 6.3, H, dx ? 6.3 : 0.3, x + dx * 3, H / 2, z - dz * 3);
    }
    if (i < route.length - 1) {
      const [nx, nz] = route[i + 1], gx = nx * 6, gz = -45.15 - nz * 6;
      const guide = new THREE.Mesh(new THREE.BoxGeometry(nx === cx ? 0.14 : 6, 0.02, nx === cx ? 6 : 0.14), guideMaterial);
      guide.position.set((x + gx) / 2, 0.055, (z + gz) / 2); guide.visible = false;
      guide.userData.ownsGeometry = true; guide.userData.ownsMaterial = host.escapeRoute.length === 0;
      host.scene.add(guide); host._track(guide); host.escapeRoute.push(guide);
    }
  }
  kit.box(m.wallDark, 5.8, 2.4, 4, 18, 1.2, -69.15, { physics: true, occluder: true });
  kit.sign(18, 2.7, -66.99, 's', 'ROUTE COLLAPSED', { sub: 'EAST SERVICE BYPASS →', fg: '#ffca77', w: 3.8 });
  kit.sign(24, 2.5, -72.05, 's', 'SERVICE BYPASS', { sub: 'FOLLOW GREEN FLOOR LIGHTS', fg: '#9aefb8', w: 3.4 });
  kit.sign(-12, 2.5, -107.94, 's', 'SURFACE / EMERGENCY EXIT', { sub: 'EVACUATION TRANSFER', fg: '#9aefb8', w: 3.8 });
  host._exitBeacon(-12, -105.15, { radius: 1.7 });
  host._winTriggers = [{ x: -12, z: -105.15, radius: 1.5, needMonsterDead: true }];
  host.escapeCheckpoints = ESCAPE_CHECKPOINTS;
}
