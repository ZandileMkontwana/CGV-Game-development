/**
 * LevelManager — builds and tears down the three station levels.
 *
 * Every level is composed from LevelKit builders (architecture + props) and
 * a shared LevelMaterials theme bundle:
 *   Level 1  lab        — clean research facility, cool palette
 *   Level 2  damaged    — collapsed sections, rust + amber palette
 *   Level 3  emergency  — red alert, arena + collapse escape
 *
 * Teardown rules (important):
 *   - Kit meshes and cached model roots carry userData.kitShared and are
 *     removed but NOT disposed — shared geometry/material caches stay alive.
 *   - Texture maps are never disposed here (all cached/shared).
 *   - Only per-level creations (doors, targets, decals, steam sprites) own
 *     their resources, flagged via userData.ownsGeometry / ownsMaterial.
 *
 * Public API consumed by Game.js (do not change):
 *   load(n), _teardown(), update(dt), shootables, occluders, monsterWaypoints,
 *   winTriggers ({x, z, radius, needMonsterDead?}), heatHazeZones,
 *   _dissolveWalls, _exitDoor (Mesh), fogColor/Near/Far,
 *   openDoor(id), disableVent(id), _disposables ([{mesh, body}]) —
 *   Game._startCollapseSequence looks the exit door up in _disposables.
 *
 * Conventions: 1 unit = 1 m; corridors 4 m wide × 3 m tall (L3 arena 4 m
 * tall); every collider gets a matching cannon body; geometry faces use the
 * LevelKit 'n/e/s/w' convention (front direction).
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import LevelKit from './LevelKit.js';
import { getThemeMaterials } from './LevelMaterials.js';

// ── Shared scorch decal texture (created once, kept for the session) ────────
let _scorchTex = null;
function scorchTexture() {
  if (_scorchTex) return _scorchTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(12,7,3,0.8)');
  g.addColorStop(0.55, 'rgba(28,14,6,0.38)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _scorchTex = new THREE.CanvasTexture(c);
  return _scorchTex;
}

export default class LevelManager {
  /**
   * @param {import('three').Scene} scene
   * @param {import('../core/PhysicsWorld.js').default} physics
   */
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;

    /** Current level number (read by Game.js in some flows). */
    this.currentLevel = 0;

    /** {mesh, body} entries for the active level — Game.js reads this. */
    this._disposables = [];

    /** Shootable meshes for the PulseTool raycast (rebuilt each load). */
    this.shootables = [];

    /** Meshes that block monster line-of-sight (rebuilt each load). */
    this.occluders = [];

    /** Win trigger zones: {x, z, radius, needMonsterDead?} (rebuilt each load). */
    this._winTriggers = [];

    /** Monster patrol waypoints {x, z} (rebuilt each load). */
    this._monsterWaypoints = [];

    /** Heat-haze zone meshes — ShaderManager swaps in the haze material. */
    this.heatHazeZones = [];

    /** Animated sliding doors (rebuilt each load). */
    this._doors = [];

    /** Steam/spark vent emitters with pre-allocated sprite pools. */
    this._steamVents = [];

    /** Rotating hazard meshes {mesh, speed} (rebuilt each load). */
    this._rotatingHazards = [];

    /** Meshes the dissolve shader fades during the L3 collapse. */
    this._dissolveWalls = [];

    /** L3 sealed failsafe door Mesh — Game.js hides it when the boss dies. */
    this._exitDoor = null;

    /**
     * L1 scripted monster reveal (read by Game.js):
     * {trigger:{x,z,radius}, spawn:{x,y,z}, escape:[{x,z}...]}
     */
    this.scriptedReveal = null;

    /** NPC placement anchors for Game.js, e.g. {scientist:{x,z,face}}. */
    this.npcAnchors = {};

    /** Per-level fog (set by each _buildLevel, read by Game.js). */
    this.fogColor = null;
    this.fogNear = 25;
    this.fogFar = 90;

    /** GLTF loader for Blender .glb models (reused across levels). */
    this._gltfLoader = new GLTFLoader();

    /** Path → GLTF promise; shared resources live for this manager's lifetime. */
    this._modelCache = new Map();

    /** Invalidates pending model placements on every teardown, even reloads. */
    this._levelGeneration = 0;

    /** Theme material bundle + kit instance for the active level. */
    this._mats = null;
    this._kit = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Load a level by number (1, 2, or 3). Tears down the previous level first.
   * @param {number} levelNum
   */
  load(levelNum) {
    this._teardown();
    this.currentLevel = levelNum;

    const theme = levelNum === 1 ? 'lab' : levelNum === 2 ? 'damaged' : 'emergency';
    this._mats = getThemeMaterials(theme);
    this._kit = new LevelKit(this, this._mats);

    switch (levelNum) {
      case 1: this._buildLevel1(); break;
      case 2: this._buildLevel2(); break;
      case 3: this._buildLevel3(); break;
      default: throw new Error(`Unknown level: ${levelNum}`);
    }

    // Collect flicker-capable fixtures (marked in LevelKit's lamp builders)
    // for the horror-lighting driver in update(). Built once per load, so
    // the per-frame driver stays allocation-free.
    this._flickerLights = [];
    for (const d of this._disposables) {
      const l = d.mesh;
      if (l && l.isLight && l.userData.flicker) {
        this._flickerLights.push({
          light: l,
          base: l.intensity,
          timer: Math.random() * 8,
          next: 6 + Math.random() * 12,
          burst: 0,
          seed: Math.random() * 6.283,
        });
      }
    }
  }

  /** Remove the active level; keep shared kit/material caches alive. */
  _teardown() {
    ++this._levelGeneration;
    for (const entry of this._disposables) {
      if (entry.body) this.physics.world.removeBody(entry.body);
      const mesh = entry.mesh;
      if (!mesh) continue;
      this.scene.remove(mesh);
      if (mesh.userData.kitShared) continue; // shared caches — session lifetime
      if (mesh.userData.ownsGeometry && mesh.geometry) mesh.geometry.dispose();
      if (mesh.userData.ownsMaterial) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m?.dispose();
      }
    }
    this._disposables = [];
    this.shootables = [];
    this.occluders = [];
    this._winTriggers = [];
    this._monsterWaypoints = [];
    this.heatHazeZones = [];
    this._doors = [];
    this._steamVents = [];
    this._rotatingHazards = [];
    this._dissolveWalls = [];
    this._exitDoor = null;
    this.scriptedReveal = null;
    this.npcAnchors = {};
    this._flickerLights = [];
    this.collapseMode = false;
  }

  // ── Bookkeeping helpers ───────────────────────────────────────────────────

  /** Register a scene object (and optional body) for teardown. */
  _track(mesh, body) {
    this._disposables.push({ mesh, body: body || null });
    return mesh;
  }

  /**
   * Place a shootable target panel (conduit, valve). Tagged with userData so
   * Game.js's PulseTool 'hit' handler can route it: the caller sets
   * `userData.doorId` or `userData.ventId` on the returned mesh.
   *
   * @param {number} w  width
   * @param {number} h  height
   * @param {number} x  centre x
   * @param {number} y  centre y
   * @param {number} z  centre z
   * @param {string} type 'terminal' | 'conduit' | 'hazard' | 'weakpoint'
   * @param {number} rotY Y rotation (radians) — face the player
   */
  _shootableTarget(w, h, x, y, z, type, rotY = 0) {
    const colors = {
      terminal: 0x00ff88,
      conduit: 0x44aaff,
      hazard: 0xffaa00,
      weakpoint: 0xff3333,
    };
    const mat = new THREE.MeshStandardMaterial({
      color: colors[type] || 0x00ff88,
      emissive: colors[type] || 0x00ff88,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.7,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.pulseTarget = true;
    mesh.userData.pulseType = type;
    mesh.userData.ownsGeometry = true;
    mesh.userData.ownsMaterial = true;
    this.scene.add(mesh);
    this._track(mesh);
    this.shootables.push(mesh);
    return mesh;
  }

  // ── Blender model loading (.glb) ────────────────────────────────────────

  /**
   * Load an explicitly supplied asset URL and place a clone in this level.
   * Concurrent requests share a cached promise; failed requests can retry.
   * Returns null on failure or if the requesting level was torn down.
   *
   * @param {string} path   served model URL
   * @param {number} x      world x
   * @param {number} y      world y
   * @param {number} z      world z
   * @param {object} opts   optional overrides
   * @param {number} opts.scale     uniform scale (default 1)
   * @param {number} opts.rotY      Y-axis rotation in radians (default 0)
   * @param {boolean} opts.collision add a static physics body (default false)
   * @param {number} opts.collisionRadius world-space box half-extent (default 0.5)
   * @returns {Promise<THREE.Group|null>}
   */
  async _loadModel(path, x, y, z, opts = {}) {
    const generation = this._levelGeneration;
    const { scale = 1, rotY = 0, collision = false, collisionRadius = 0.5 } = opts;
    try {
      let pending = this._modelCache.get(path);
      if (!pending) {
        pending = this._gltfLoader.loadAsync(path).catch((err) => {
          if (this._modelCache.get(path) === pending) this._modelCache.delete(path);
          throw err;
        });
        this._modelCache.set(path, pending);
      }
      const gltf = await pending;
      if (generation !== this._levelGeneration) return null;

      const model = gltf.scene.clone();
      // Clones share cached geometry, materials and textures, just like kit meshes.
      model.userData.kitShared = true;
      model.position.set(x, y, z);
      model.scale.setScalar(scale);
      model.rotation.y = rotY;
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Static colliders need no sync pair (which would move the model's origin
      // to the collider centre and retain it after teardown).
      let body = null;
      if (collision) {
        body = this.physics.createBox(
          0, collisionRadius, collisionRadius, collisionRadius,
          new CANNON.Vec3(x, y + collisionRadius, z)
        );
        body.quaternion.setFromEuler(0, rotY, 0);
      }
      this.scene.add(model);
      this._track(model, body);
      return model;
    } catch (err) {
      console.warn(`[LevelManager] Model not loaded: ${path} — ${err.message || err}`);
      return null;
    }
  }

  /**
   * Sliding door that opens when its linked target is shot. Slides up (Y+)
   * and its collision body is removed once fully open.
   */
  _createDoor(id, w, h, x, y, z, rotY, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.15), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.ownsGeometry = true; // the material is theme-shared
    this.scene.add(mesh);
    const body = this.physics.createBox(
      0, w / 2, h / 2, 0.075,
      new CANNON.Vec3(x, y, z)
    );
    this._track(mesh, body);
    this.occluders.push(mesh); // a closed door blocks line of sight
    this._doors.push({
      id, mesh, body,
      closedY: y,
      openY: y + h + 0.3,
      progress: 0,
      opening: false,
    });
    return mesh;
  }

  /** Trigger a door to open by its id. */
  openDoor(id) {
    const door = this._doors.find(d => d.id === id);
    if (door && !door.opening) door.opening = true;
  }

  // ── Steam / spark vents (pre-allocated pools — zero per-frame allocs) ─────

  /**
   * Create a vent emitter. Emits from a fixed-size sprite pool; `disableVent`
   * stops new spawns while live particles fade out.
   */
  _createSteamVent(id, x, y, z, o = {}) {
    const n = o.count || 14;
    const pool = [];
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        color: o.color ?? 0xc9d2da, transparent: true, opacity: 0, depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.scale.set(0.25, 0.25, 1);
      s.position.set(x, y, z);
      s.visible = false;
      s.userData.ownsMaterial = true; // Sprite shares its geometry — do not dispose it
      this.scene.add(s);
      this._track(s);
      pool.push(s);
    }
    this._steamVents.push({
      id, x, y, z, pool, idx: 0, timer: 0,
      active: true,
      life: new Float32Array(n),
      vy: new Float32Array(n),
      rate: o.rate || 0.07,
      rise: o.rise || 0.55,
      drift: o.drift ?? 0.12,
      lifeSpan: o.lifeSpan || 1.3,
      alpha: o.alpha || 0.42,
    });
  }

  /** Disable a steam vent by id (stops particle spawning). */
  disableVent(id) {
    const vent = this._steamVents.find(v => v.id === id);
    if (vent) vent.active = false;
  }

  /** Add a rotating hazard mesh (fan blades, spinning debris). */
  _addRotatingHazard(mesh, speed) {
    this._rotatingHazards.push({ mesh, speed });
  }

  // ── Decor helpers ─────────────────────────────────────────────────────────

  /** Scorch mark on the floor (own geometry/material, disposed on teardown). */
  _scorchDecal(x, y, z, size, rotY = 0) {
    const mat = new THREE.MeshBasicMaterial({
      map: scorchTexture(), transparent: true,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.position.set(x, y + 0.012, z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rotY;
    mesh.userData.ownsGeometry = true;
    mesh.userData.ownsMaterial = true;
    this.scene.add(mesh);
    this._track(mesh);
    return mesh;
  }

  /**
   * Register a heat-haze volume. The mesh is a kit box (so teardown skips
   * its shared resources); ShaderManager.wireLevelVisuals() replaces the
   * placeholder material with the real haze shader on level load.
   */
  _hazeZone(w, h, d, x, y, z) {
    const zone = this._kit.box(this._mats.glass, w, h, d, x, y, z, {
      cast: false, receive: false,
    });
    this.heatHazeZones.push(zone);
    return zone;
  }

  /** Green landing-pad beacon that marks a level exit. */
  _exitBeacon(x, z, o = {}) {
    const r = o.radius || 1.6;
    const kit = this._kit;
    kit.floorDecal(x, z, 'stripes', { size: r * 2, color: '#5cff8a' });
    kit.box(this._mats.exitGreen, r * 2, 0.02, 0.1, x, 0.012, z + r, { cast: false });
    kit.box(this._mats.exitGreen, r * 2, 0.02, 0.1, x, 0.012, z - r, { cast: false });
    kit.box(this._mats.exitGreen, 0.1, 0.02, r * 2, x - r, 0.012, z, { cast: false });
    kit.box(this._mats.exitGreen, 0.1, 0.02, r * 2, x + r, 0.012, z, { cast: false });
    kit.box(this._mats.exitGreen, 0.12, 2.2, 0.12, x - r, 1.1, z, { cast: false });
    kit.box(this._mats.exitGreen, 0.12, 2.2, 0.12, x + r, 1.1, z, { cast: false });
  }

  // ── Per-frame update: doors, vents, rotating hazards (zero allocations) ───

  update(dt) {
    // Doors: lerp upward once triggered.
    for (const door of this._doors) {
      if (door.opening && door.progress < 1) {
        door.progress = Math.min(1, door.progress + dt * 0.8);
        const y = door.closedY + (door.openY - door.closedY) * door.progress;
        door.mesh.position.y = y;
        door.body.position.y = y;
        if (door.progress >= 1) this.physics.world.removeBody(door.body);
      }
    }

    // Steam / spark vents: recycle the sprite pool, fade by remaining life.
    for (const v of this._steamVents) {
      if (v.active) {
        v.timer += dt;
        while (v.timer >= v.rate) {
          v.timer -= v.rate;
          const i = v.idx = (v.idx + 1) % v.pool.length;
          const s = v.pool[i];
          v.life[i] = v.lifeSpan;
          v.vy[i] = v.rise * (0.7 + Math.random() * 0.6);
          s.position.set(
            v.x + (Math.random() - 0.5) * v.drift * 2, v.y,
            v.z + (Math.random() - 0.5) * v.drift * 2
          );
          s.visible = true;
        }
      }
      for (let i = 0; i < v.pool.length; i++) {
        if (v.life[i] <= 0) continue;
        v.life[i] -= dt;
        const s = v.pool[i];
        if (v.life[i] <= 0) { s.visible = false; s.material.opacity = 0; continue; }
        s.position.y += v.vy[i] * dt;
        const t = v.life[i] / v.lifeSpan;
        s.material.opacity = t * v.alpha;
        const sc = 0.25 + (1 - t) * 0.55;
        s.scale.set(sc, sc, 1);
      }
    }

    // Rotating hazards.
    for (const { mesh, speed } of this._rotatingHazards) {
      mesh.rotation.y += speed * dt;
    }

    // Flickering lights — dying fluorescents. Each fixture idles for a few
    // seconds, then stutters for a short burst. During the Level-3 collapse
    // (collapseMode) bursts come thick and fast.
    const haste = this.collapseMode ? 0.22 : 1;
    for (const f of this._flickerLights) {
      f.timer += dt;
      if (f.burst > 0) {
        f.burst -= dt;
        f.light.intensity = f.base * (Math.sin(f.timer * 74 + f.seed) > 0.1 ? 0.07 : 1.05);
        if (f.burst <= 0) f.light.intensity = f.base;
      } else if (f.timer >= f.next) {
        f.timer = 0;
        f.burst = 0.12 + Math.random() * 0.35;
        f.next = (6 + Math.random() * 12) * haste;
      }
    }
  }

  // ── Level 1 — The Experiment (clean lab) ────────────────────────────────
  //
  // Flow (player walks toward -z):
  //   Reception (0..-10)  → arch → corridor C1 (-10..-20) → Laboratory
  //   (-20..-32, scientist + containment tube + scripted reveal) → door
  //   'l1-lab' (shoot conduit) → maintenance C2 (-32..-40) → Reactor hall
  //   (-40..-54) → Control room (-54..-64) → WIN.
  //
  _buildLevel1() {
    const H = 3;
    const kit = this._kit;
    const m = this._mats;

    this._winTriggers = [
      { x: 0, z: -62, radius: 2.0 }, // control room console
    ];
    this._monsterWaypoints = []; // L1 monster is a scripted cameo (see below)

    // Scripted reveal data (Game.js runs the beat; level just supplies it).
    // Story beat: the bitten scientist convulses and mutates into the
    // creature, which then flees into the ducts — the player witnesses it.
    this.scriptedReveal = {
      trigger: { x: 0, z: -22.0, radius: 2.8 },   // fires as the player enters the lab
      spawn: { x: -2.45, y: 1.4, z: -25.25 },      // the scientist's console seat
      escape: [                                     // flees toward the SE duct
        { x: 2.5, z: -27.5 },
        { x: 6.5, z: -30.8 },
      ],
    };
    this.npcAnchors = {
      scientist: { x: -2.45, z: -25.25, face: 'w' }, // seated, typing at the console
    };

    // ── Reception (x -5..5, z 0..-10) ─────────────────────────────────────
    kit.floorSlab(10.6, 10.45, 0, -4.93, { lines: [{ axis: 'z', len: 8, color: 'accent' }] });
    kit.ceilingSlab(10.6, 10.45, 0, H, -4.93, {
      lamps: [
        { x: -2.4, z: 2.0, light: true, intensity: 0.8 },
        { x: 2.4, z: -2.2 },
      ],
    });
    kit.wallRun(10.6, H, 0.3, 0, H / 2, 0.15);                 // north end wall
    kit.wallRun(0.3, H, 10.45, -5.15, H / 2, -4.93);           // west
    kit.wallRun(0.3, H, 10.45, 5.15, H / 2, -4.93);            // east
    // South wall with a door-sized arch (x -1.3..1.3).
    kit.wallRun(4.0, H, 0.3, -3.3, H / 2, -10.15);
    kit.wallRun(4.0, H, 0.3, 3.3, H / 2, -10.15);
    kit.doorway(2.6, 2.6, 0, 1.3, -10.15, 's');
    kit.sign(0, 2.4, -0.02, 'n', 'SECTOR A — RECEPTION', { sub: 'CONTAINMENT BREACH PROTOCOL', fg: '#7fe7ff' });
    kit.consoleDesk(-3.6, -5.0, 'e', { w: 1.8, monitors: 1 });
    kit.crateStack(4.0, -3.2, { w: 1.2, h: 1.2, d: 0.8, rotY: 0.3 });
    kit.crate(4.3, -6.0, { s: 0.7, rotY: 0.4 });
    kit.fuseBox(-4.94, 1.7, -8.5, 'e');
    kit.extinguisher(-4.94, 1.2, -3.0);
    kit.floorDecal(3.2, -5.0, 'stripes', { size: 1.2 });

    // ── Corridor C1 (x -2..2, z -10..-20) ────────────────────────────────
    kit.floorSlab(4.3, 10.0, 0, -15.15, { lines: [{ axis: 'z', len: 8.5, color: 'accent' }] });
    kit.ceilingSlab(4.3, 10.0, 0, H, -15.15, {
      lamps: [
        { x: 0, z: 2.4, light: true, intensity: 0.7 },
        { x: 0, z: -2.4 },
      ],
    });
    kit.wallRun(0.3, H, 10.3, -2.15, H / 2, -15.15);
    kit.wallRun(0.3, H, 10.3, 2.15, H / 2, -15.15);
    kit.pipeRun('z', 9.5, -1.95, 2.55, -15.15, { count: 2, r: 0.06 });
    kit.cableTray('z', 9.5, 1.95, 2.6, -15.15);
    kit.sign(0, 2.3, -19.97, 's', 'LAB A-2 ▸', { sub: 'BIOHAZARD LEVEL 2', fg: '#7fe7ff' });
    kit.fuseBox(-1.94, 1.6, -12.5, 'e');
    kit.ventGrille(-1.95, 2.2, -17.5, 'e', { w: 0.8, h: 0.5 });

    // ── Laboratory (x -9..9, z -20..-32) ─────────────────────────────────
    kit.floorSlab(18.6, 12.0, 0, -26.15, {
      lines: [{ axis: 'z', len: 10, color: 'accent' }],
    });
    kit.ceilingSlab(18.6, 12.0, 0, H, -26.15, {
      lamps: [
        { x: -4.5, z: 4.0, light: true, intensity: 0.9 },
        { x: 4.5, z: 4.0 },
        { x: -4.5, z: -4.0 },
        { x: 4.5, z: -4.0, light: true, intensity: 0.9 },
      ],
    });
    // North wall (corridor mouth) + south wall (door 'l1-lab').
    kit.wallRun(8.0, H, 0.3, -5.3, H / 2, -20.15);
    kit.wallRun(8.0, H, 0.3, 5.3, H / 2, -20.15);
    kit.wallRun(8.0, H, 0.3, -5.3, H / 2, -32.15);
    kit.wallRun(8.0, H, 0.3, 5.3, H / 2, -32.15);
    kit.wallRun(0.3, H, 12.3, -9.15, H / 2, -26.15);          // west
    kit.wallRun(0.3, H, 12.3, 9.15, H / 2, -26.15);           // east
    kit.doorway(2.6, 2.6, 0, 1.3, -20.15, 's');
    // The tutorial door: shoot the conduit beside it.
    kit.doorway(2.6, 2.6, 0, 1.3, -32.15, 's');
    this._createDoor('l1-lab', 2.6, 2.6, 0, 1.3, -32.15, 0, m.metalDark);
    const l1Conduit = this._shootableTarget(0.55, 0.4, 1.7, 1.9, -31.96, 'conduit', 0);
    l1Conduit.userData.doorId = 'l1-lab';
    kit.sign(0, 2.55, -31.97, 's', 'MAINTENANCE ▸', { sub: 'PULSE TOOL REQUIRED', fg: '#ffd27f' });

    // Focal props: containment tube + scientist console + benches.
    kit.containmentTube(-5.0, -26.0);
    kit.consoleDesk(-3.4, -25.2, 'e', { w: 1.8, monitors: 2 });
    kit.chair(-1.55, -25.05, 'w');
    kit.labBench(5.6, -23.5, 'w', { len: 2.6 });
    kit.labBench(5.6, -27.5, 'w', { len: 2.6 });
    kit.shelfUnit(-8.2, -22.0, 'e', { w: 1.5 });
    kit.cabinet(-8.2, -29.2, 'e');
    kit.wallScreen(-8.93, 1.9, -26.0, 'e', { w: 2.4, h: 1.3 });
    kit.wallScreen(-8.93, 1.9, -23.4, 'e', { w: 1.2, h: 1.3, alt: true, dotMat: m.emergencyRed });
    kit.canister(-5.8, -30.5);
    kit.canister(-5.4, -30.2);
    kit.crate(-7.5, -30.6, { s: 0.7 });
    kit.crateStack(-7.8, -21.2, { w: 1.4, h: 1.4, d: 0.9 });
    kit.barrel(8.2, -30.5);
    kit.barrel(7.6, -30.8);
    kit.debrisPile(-8.0, -27.6, { s: 0.8, seed: 11 });
    kit.floorDecal(3.0, -25.0, 'dashes', { size: 2.0 });
    // Ventilation duct along the south wall — the creature escapes here.
    kit.duct('x', 18.3, 0, 2.8, -31.7, { grilles: [-6.5, 6.5] });
    kit.ventGrille(6.5, 2.6, -31.94, 's', { w: 0.9, h: 0.6 });
    // Alarm beacon near containment (the scripted beat's visual anchor).
    kit.lamp(-7.6, -27.5, { y: 2.6, color: 'red', light: false });
    this._scorchDecal(-5.0, 0, -28.4, 1.6, 0.4);

    // ── Maintenance C2 (x -2..2, z -32..-40) ─────────────────────────────
    kit.floorSlab(4.3, 8.0, 0, -36.15, { lines: [{ axis: 'z', len: 6.5, color: 'accent' }] });
    kit.ceilingSlab(4.3, 8.0, 0, H, -36.15, {
      lamps: [{ x: 0, z: 0, light: true, intensity: 0.7 }],
    });
    kit.wallRun(0.3, H, 8.3, -2.15, H / 2, -36.15);
    kit.wallRun(0.3, H, 8.3, 2.15, H / 2, -36.15);
    kit.pipeRun('z', 7.5, -1.95, 2.5, -36.15, { count: 3, r: 0.06 });
    kit.cableTray('z', 7.5, 1.95, 2.55, -36.15);
    kit.fuseBox(1.94, 1.6, -34.0, 'w');
    kit.floorDecal(0, -33.2, 'stripes', { size: 1.0 });

    // ── Reactor hall (x -10..10, z -40..-54) ─────────────────────────────
    kit.floorSlab(20.6, 14.0, 0, -47.15, { trim: true });
    kit.ceilingSlab(20.6, 14.0, 0, H, -47.15, {
      lamps: [
        { x: -6, z: 5, light: true, intensity: 0.85 },
        { x: 6, z: 5 },
        { x: -6, z: -5 },
        { x: 6, z: -5, light: true, intensity: 0.85 },
      ],
    });
    kit.wallRun(9.0, H, 0.3, -5.8, H / 2, -40.15);
    kit.wallRun(9.0, H, 0.3, 5.8, H / 2, -40.15);
    kit.wallRun(9.0, H, 0.3, -5.8, H / 2, -54.15);
    kit.wallRun(9.0, H, 0.3, 5.8, H / 2, -54.15);
    kit.wallRun(0.3, H, 14.3, -10.15, H / 2, -47.15);         // west
    kit.wallRun(0.3, H, 14.3, 10.15, H / 2, -47.15);          // east
    kit.doorway(2.6, 2.6, 0, 1.3, -40.15, 's');
    kit.doorway(2.6, 2.6, 0, 1.3, -54.15, 's');
    kit.sign(0, 2.4, -39.97, 's', 'REACTOR HALL ▸', { fg: '#ffd27f' });
    kit.sign(0, 2.5, -40.32, 'n', 'REACTOR HALL', { sub: 'AUTHORISED PERSONNEL ONLY', fg: '#ffd27f' });
    // Focal reactor core (top stays clear of the 3 m ceiling).
    kit.reactorCore(0, -47.0, { r: 1.5, h: 2.4 });
    for (const [cx, cz] of [[-6.5, -43.5], [6.5, -43.5], [-6.5, -50.5], [6.5, -50.5]]) {
      kit.column(cx, cz, { h: H, r: 0.26 });
    }
    kit.railing('x', 7.2, 0, 0, -43.6);
    kit.railing('x', 7.2, 0, 0, -50.4);
    kit.railing('z', 6.8, -3.6, 0, -47.0);
    kit.railing('z', 6.8, 3.6, 0, -47.0);
    kit.pipeRun('x', 20, 0, 2.55, -41.9, { count: 3 });
    kit.pipeRun('x', 20, 0, 2.55, -52.4, { count: 2 });
    kit.wallScreen(9.93, 2.0, -44.0, 'w', { w: 2.8, h: 1.4 });
    kit.generator(-8.3, -50.8, 'e');
    kit.generator(8.3, -43.2, 'w');
    kit.crateStack(6.5, -51.6, { w: 1.5, h: 1.5, d: 0.9, rotY: -0.2 });
    kit.barrel(-9.0, -44.0);
    kit.barrel(9.0, -51.0);
    kit.canister(-9.2, -47.4);
    kit.canister(9.2, -46.8);
    kit.floorDecal(-3.4, -44.0, 'stripes', { size: 1.2 });
    kit.floorDecal(3.4, -50.2, 'stripes', { size: 1.2 });
    kit.floorLine(0, -44.0, 7, { axis: 'x', color: 'warn' });
    this._scorchDecal(-5.5, 0, -45.2, 1.3);
    this._scorchDecal(5.0, 0, -49.0, 1.1);

    // ── Control room (x -5..5, z -54..-64) ───────────────────────────────
    kit.floorSlab(10.6, 10.0, 0, -59.15, { lines: [{ axis: 'z', len: 8, color: 'exit' }] });
    kit.ceilingSlab(10.6, 10.0, 0, H, -59.15, {
      lamps: [
        { x: -2.6, z: 2.0, light: true, intensity: 0.8 },
        { x: 2.6, z: -2.0, light: true, intensity: 0.8 },
      ],
    });
    kit.wallRun(0.3, H, 10.3, -5.15, H / 2, -59.15);
    kit.wallRun(0.3, H, 10.3, 5.15, H / 2, -59.15);
    kit.wallRun(10.6, H, 0.3, 0, H / 2, -64.15);              // south end wall
    kit.sign(0, 2.6, -54.32, 'n', 'CONTROL ROOM', { fg: '#7fe7ff' });
    kit.consoleDesk(0, -62.6, 'n', { w: 3.2, monitors: 3 });
    kit.chair(-0.7, -61.3, 'n');
    kit.chair(0.7, -61.3, 'n');
    kit.wallScreen(0, 2.2, -63.93, 's', { w: 3.4, h: 1.5 });
    kit.serverRack(-4.6, -55.8, 'e');
    kit.serverRack(4.6, -55.8, 'w');
    kit.cabinet(-4.6, -60.0, 'e');
    kit.shelfUnit(4.6, -60.0, 'w', { w: 1.4, h: 1.8 });
    kit.fuseBox(-4.94, 1.7, -58.0, 'e');
    kit.extinguisher(4.94, 1.2, -56.0);
    kit.debrisPile(-2.6, -63.2, { s: 0.7, seed: 21 });
    kit.floorDecal(0, -60.4, 'stripes', { size: 1.4, color: '#5cff8a' });

    // ── Fog ───────────────────────────────────────────────────────────────
    this.fogColor = 0x070b12;
    this.fogNear = 18;
    this.fogFar = 75;
  }

  // ── Level 2 — The Hunt (damaged facility, amber palette) ────────────────
  //
  // Flow (player walks toward -z):
  //   Staging (0..-8) → door 'l2-entry' (shoot conduit) → corridor C1 with
  //   fan (-8..-18) → Crew quarters (-18..-30; lockers/bunks = hiding cover)
  //   → Maintenance C2 (-30..-40; steam vents + heat haze + sparks) →
  //   Server room (-40..-52; rack maze) → C3 (-52..-58) → Exit vestibule
  //   (-58..-64) → WIN. Stealth-first: tall props feed the occluder list.
  //
  _buildLevel2() {
    const H = 3;
    const kit = this._kit;
    const m = this._mats;

    this._winTriggers = [
      { x: 0, z: -62.4, radius: 1.6 }, // emergency exit vestibule
    ];

    // Monster patrol: quarters → maintenance → server room (Game.js reads
    // these and maps them to {x, y: 0, z} patrol points).
    this._monsterWaypoints = [
      { x: -4, z: -21 }, { x: 4, z: -22 }, { x: 0, z: -26 },
      { x: 0, z: -31 }, { x: 0, z: -34.5 }, { x: 0, z: -38 },
      { x: 0, z: -42 }, { x: -4, z: -45.5 }, { x: 4, z: -48 },
      { x: 0, z: -49.5 },
    ];

    // ── Staging bay (x -4..4, z 0..-8) ───────────────────────────────────
    kit.floorSlab(8.6, 8.3, 0, -4.15, { lines: [{ axis: 'z', len: 6, color: 'warn' }] });
    kit.ceilingSlab(8.6, 8.3, 0, H, -4.15, {
      lamps: [
        { x: -2, z: 2, light: true, intensity: 0.7 },
        { x: 2, z: -2 },
      ],
    });
    kit.wallRun(8.6, H, 0.3, 0, H / 2, 0.15);                  // north
    kit.wallRun(0.3, H, 8.3, -4.15, H / 2, -4.15);             // west
    kit.wallRun(0.3, H, 8.3, 4.15, H / 2, -4.15);              // east
    kit.wallRun(3.0, H, 0.3, -2.8, H / 2, -8.15);              // south (door gap)
    kit.wallRun(3.0, H, 0.3, 2.8, H / 2, -8.15);
    kit.doorway(2.6, 2.6, 0, 1.3, -8.15, 's');
    this._createDoor('l2-entry', 2.6, 2.6, 0, 1.3, -8.15, 0, m.metalDark);
    const l2Conduit = this._shootableTarget(0.55, 0.4, 1.7, 1.9, -7.96, 'conduit', 0);
    l2Conduit.userData.doorId = 'l2-entry';
    kit.sign(0, 2.5, -7.97, 's', 'SECTOR B ▸', { sub: 'STRUCTURAL DAMAGE DETECTED', fg: '#ffb04a' });
    kit.sign(0, 2.3, -0.01, 'n', 'STAGING BAY', { fg: '#ffb04a' });
    kit.crateStack(-2.6, -2.2, { w: 1.6, h: 1.6, d: 1.0, rotY: 0.15 });
    kit.crate(-3.3, -4.6, { s: 0.8 });
    kit.barrel(3.2, -5.8);
    kit.barrel(2.6, -6.3);
    kit.debrisPile(2.3, -1.9, { s: 0.9, seed: 31 });
    kit.fallenPanel(-2.2, 0.3, -6.2, { rx: 0.32, ry: 0.5 });
    kit.floorDecal(-1.0, -5.0, 'dashes', { size: 1.6 });

    // ── Corridor C1 (x -2..2, z -8..-18) — fan hazard ────────────────────
    kit.floorSlab(4.3, 10.0, 0, -13.15, { lines: [{ axis: 'z', len: 8, color: 'warn' }] });
    kit.ceilingSlab(4.3, 10.0, 0, H, -13.15, {
      lamps: [
        { x: 0, z: -2, light: true, intensity: 0.6 },
        { x: 0, z: 2 },
      ],
    });
    kit.wallRun(0.3, H, 10.3, -2.15, H / 2, -13.15);
    kit.wallRun(0.3, H, 10.3, 2.15, H / 2, -13.15);
    kit.pipeRun('z', 9.5, -1.95, 2.6, -13.15, { count: 3, r: 0.06 });
    kit.cableTray('z', 9.5, 1.95, 2.5, -13.15);
    kit.floorDecal(0, -13.0, 'stripes', { size: 1.1 });
    kit.hangingPipe(1.8, 2.5, -10.5, { tilt: 0.7 });
    kit.debrisPile(-1.6, -16.4, { s: 0.8, seed: 32 });
    kit.canister(-1.8, -9.4);
    kit.fallenPanel(1.5, 0.28, -15.5, { rx: 0.4, ry: -0.6 });
    // Big ceiling fan — rotating hazard (visual, atmosphere).
    this._addRotatingHazard(kit.fanBlade(0, 2.45, -13.0, { r: 0.95 }), 5.0);

    // ── Crew quarters (x -8..8, z -18..-30) — hiding cover ───────────────
    kit.floorSlab(16.6, 12.0, 0, -24.15, { lines: [{ axis: 'z', len: 9, color: 'warn' }] });
    kit.ceilingSlab(16.6, 12.0, 0, H, -24.15, {
      lamps: [
        { x: -4, z: 3.5, light: true, intensity: 0.7 },
        { x: 4, z: 3.5 },
        { x: 4, z: -3.5, light: true, intensity: 0.7 },
        { x: -4, z: -3.5 },
      ],
    });
    kit.wallRun(7.0, H, 0.3, -4.8, H / 2, -18.15);
    kit.wallRun(7.0, H, 0.3, 4.8, H / 2, -18.15);
    kit.wallRun(7.0, H, 0.3, -4.8, H / 2, -30.15);
    kit.wallRun(7.0, H, 0.3, 4.8, H / 2, -30.15);
    kit.wallRun(0.3, H, 12.3, -8.15, H / 2, -24.15);           // west
    kit.wallRun(0.3, H, 12.3, 8.15, H / 2, -24.15);            // east
    kit.doorway(2.6, 2.6, 0, 1.3, -18.15, 's');
    kit.sign(0, 2.4, -17.97, 's', 'CREW QUARTERS ▸', { fg: '#ffd9a0' });
    kit.sign(0, 2.4, -30.32, 'n', 'MAINTENANCE ▸', { sub: 'VENT CONTROL REQUIRED', fg: '#ffb04a' });
    // Lockers = tall stealth cover (occluders) along the west wall + mid-room.
    kit.lockerBank(-7.4, -20.0, 'e');
    kit.lockerBank(-7.4, -23.6, 'e');
    kit.lockerBank(-7.4, -27.2, 'e');
    kit.lockerBank(-2.4, -29.4, 'n');
    kit.lockerBank(2.6, -19.2, 'n');
    kit.bunk(7.0, -21.0, 'w');
    kit.bunk(7.0, -24.5, 'w');
    kit.bunk(7.0, -28.0, 'w');
    kit.crateStack(-3.5, -25.5, { w: 1.7, h: 1.7, d: 0.9, rotY: 0.2 });
    kit.crateStack(4.4, -27.6, { w: 1.5, h: 1.6, d: 0.9 });
    kit.debrisPile(-5.4, -28.4, { s: 1.1, seed: 33 });
    kit.fallenPanel(1.8, 0.3, -26.4, { rx: 0.35, ry: 0.5 });
    kit.cabinet(-6.2, -29.5, 'n');
    kit.shelfUnit(6.8, -29.6, 'n', { w: 1.4, h: 1.8 });
    kit.canister(0.4, -20.6);
    kit.canister(0.8, -20.3);
    kit.barrel(5.8, -19.6);
    kit.floorDecal(-3.0, -22.0, 'dashes', { size: 1.6 });
    this._scorchDecal(0.5, 0, -24.0, 1.6);
    this._scorchDecal(-4.0, 0, -19.2, 1.1);
    // Steam vent + its shootable valve on the west wall.
    this._createSteamVent('l2-vent-1', -6.5, 0.35, -26.2);
    kit.valveWheel(-7.9, 1.2, -26.2, 'e');
    const v1 = this._shootableTarget(0.4, 0.3, -7.94, 1.2, -26.2, 'hazard', Math.PI / 2);
    v1.userData.ventId = 'l2-vent-1';

    // ── Maintenance C2 (x -2..2, z -30..-40) — hazards ───────────────────
    kit.floorSlab(4.3, 10.0, 0, -35.15, { lines: [{ axis: 'z', len: 8, color: 'warn' }] });
    kit.ceilingSlab(4.3, 10.0, 0, H, -35.15, {
      lamps: [
        { x: 0, z: 2, light: true, intensity: 0.6 },
        { x: 0, z: -2 },
      ],
    });
    kit.wallRun(0.3, H, 10.3, -2.15, H / 2, -35.15);
    kit.wallRun(0.3, H, 10.3, 2.15, H / 2, -35.15);
    kit.pipeRun('z', 9.5, -1.95, 2.55, -35.15, { count: 3, r: 0.06 });
    kit.cableTray('z', 9.5, 1.95, 2.6, -35.15);
    kit.hangingPipe(1.8, 2.4, -33.8, { tilt: 0.8 });
    kit.hangingPipe(-1.7, 2.5, -37.4, { tilt: -0.6 });
    kit.fallenPanel(-1.4, 0.3, -37.2, { rx: 0.42, ry: -0.7 });
    kit.debrisPile(1.5, -38.6, { s: 0.9, seed: 34 });
    kit.debrisPile(-1.3, -31.4, { s: 0.7, seed: 35 });
    kit.floorDecal(0, -34.0, 'stripes', { size: 1.0 });
    this._scorchDecal(0.6, 0, -36.0, 1.2);
    // Steam vents the player must shoot to clear the way (valve per vent).
    this._createSteamVent('l2-vent-2', 1.4, 0.35, -33.0);
    kit.valveWheel(1.9, 1.2, -33.0, 'w');
    const v2 = this._shootableTarget(0.4, 0.3, 1.94, 1.2, -33.0, 'hazard', -Math.PI / 2);
    v2.userData.ventId = 'l2-vent-2';
    this._createSteamVent('l2-vent-3', -1.4, 0.35, -36.6);
    kit.valveWheel(-1.9, 1.2, -36.6, 'e');
    const v3 = this._shootableTarget(0.4, 0.3, -1.94, 1.2, -36.6, 'hazard', Math.PI / 2);
    v3.userData.ventId = 'l2-vent-3';
    // Sparking conduit (falling sparks) + heat-haze zones (Kutloano's shader).
    this._createSteamVent('l2-sparks-1', 1.55, 1.9, -34.4, {
      color: 0xffcc66, rate: 0.25, rise: -0.5, lifeSpan: 0.5, count: 8, drift: 0.05, alpha: 0.8,
    });
    this._hazeZone(2.8, 2.2, 2.4, 0.9, 1.1, -33.4);
    this._hazeZone(2.8, 2.2, 2.4, -0.9, 1.1, -36.4);

    // ── Server room (x -8..8, z -40..-52) — rack maze ────────────────────
    kit.floorSlab(16.6, 12.0, 0, -46.15, { trim: true });
    kit.ceilingSlab(16.6, 12.0, 0, H, -46.15, {
      lamps: [
        { x: -4, z: 3.5, light: true, intensity: 0.7 },
        { x: 4, z: 3.5 },
        { x: 4, z: -3.5, light: true, intensity: 0.7 },
      ],
    });
    kit.wallRun(7.0, H, 0.3, -4.8, H / 2, -40.15);
    kit.wallRun(7.0, H, 0.3, 4.8, H / 2, -40.15);
    kit.wallRun(7.0, H, 0.3, -4.8, H / 2, -52.15);
    kit.wallRun(7.0, H, 0.3, 4.8, H / 2, -52.15);
    kit.wallRun(0.3, H, 12.3, -8.15, H / 2, -46.15);           // west
    kit.wallRun(0.3, H, 12.3, 8.15, H / 2, -46.15);            // east
    kit.doorway(2.6, 2.6, 0, 1.3, -40.15, 's');
    kit.sign(0, 2.4, -39.98, 's', 'SERVER ROOM ▸', { fg: '#ffb04a' });
    // Two rows of racks facing each other (all occluders → stealth cover).
    for (const rz of [-42.4, -44.6, -46.8, -49.0]) {
      kit.serverRack(-5.6, rz, 'e');
      kit.serverRack(5.6, rz, 'w');
    }
    kit.pipeRun('z', 12, 0, 2.65, -46.15, { count: 2, r: 0.07 });
    kit.wallScreen(-7.93, 2.1, -43.5, 'e', { w: 3.0, h: 1.5, alt: true });
    kit.wallScreen(7.93, 2.1, -48.5, 'w', { w: 3.0, h: 1.5 });
    kit.cabinet(-7.6, -41.2, 'e');
    kit.shelfUnit(7.6, -50.8, 'w', { w: 1.4, h: 1.8 });
    kit.debrisPile(0.8, -51.0, { s: 1.2, seed: 36 });
    kit.debrisPile(-0.6, -41.2, { s: 0.9, seed: 37 });
    kit.fallenPanel(-1.5, 0.32, -47.5, { rx: 0.5, ry: 0.9 });
    kit.canister(3.9, -51.4);
    kit.barrel(-7.2, -51.0);
    kit.barrel(7.2, -41.4);
    this._scorchDecal(3.5, 0, -45.0, 1.4);
    this._scorchDecal(-4.0, 0, -49.0, 1.2);
    this._createSteamVent('l2-sparks-2', -4.9, 2.1, -44.0, {
      color: 0xffcc66, rate: 0.3, rise: -0.55, lifeSpan: 0.45, count: 8, drift: 0.05, alpha: 0.8,
    });

    // ── C3 (x -2..2, z -52..-58) — final stretch ────────────────────────
    kit.floorSlab(4.3, 6.0, 0, -55.15, { lines: [{ axis: 'z', len: 4.5, color: 'exit' }] });
    kit.ceilingSlab(4.3, 6.0, 0, H, -55.15, { lamps: [{ x: 0, z: 0 }] });
    kit.wallRun(0.3, H, 6.3, -2.15, H / 2, -55.15);
    kit.wallRun(0.3, H, 6.3, 2.15, H / 2, -55.15);
    kit.pipeRun('z', 5.5, -1.95, 2.55, -55.15, { count: 2, r: 0.06 });
    kit.hangingPipe(1.8, 2.5, -54.0, { tilt: 0.6 });
    kit.debrisPile(-1.5, -56.6, { s: 0.8, seed: 38 });
    kit.fallenPanel(1.4, 0.28, -57.0, { rx: 0.45, ry: 0.5 });

    // ── Exit vestibule (x -4..4, z -58..-64) — WIN ──────────────────────
    kit.floorSlab(8.6, 6.0, 0, -61.15, { lines: [{ axis: 'z', len: 5, color: 'exit' }] });
    kit.ceilingSlab(8.6, 6.0, 0, H, -61.15, {
      lamps: [{ x: 0, z: 0, light: true, intensity: 0.9 }],
    });
    kit.wallRun(3.0, H, 0.3, -2.8, H / 2, -58.15);
    kit.wallRun(3.0, H, 0.3, 2.8, H / 2, -58.15);
    kit.wallRun(8.6, H, 0.3, 0, H / 2, -64.15);                // south end
    kit.wallRun(0.3, H, 6.3, -4.15, H / 2, -61.15);            // west
    kit.wallRun(0.3, H, 6.3, 4.15, H / 2, -61.15);             // east
    kit.doorway(2.6, 2.6, 0, 1.3, -58.15, 's');
    this._exitBeacon(0, -62.5, { radius: 1.7 });
    kit.sign(0, 2.4, -63.98, 's', 'EMERGENCY EXIT', { sub: 'LIFT TO SURFACE', fg: '#5cff8a' });
    kit.floorLine(0, -60.0, 6, { color: 'exit' });
    kit.crateStack(3.2, -63.0, { w: 1.2, h: 1.2, d: 0.8, rotY: -0.3 });
    kit.extinguisher(-3.94, 1.2, -59.0);

    // ── Fog ──────────────────────────────────────────────────────────────
    this.fogColor = 0x140a04;
    this.fogNear = 10;
    this.fogFar = 50;
  }

  // ── Level 3 — The Collapse (emergency, red palette) ─────────────────────
  //
  // Flow (player walks toward -z):
  //   Entry corridor (0..-10) → Containment arena (-10..-42; cover pillars,
  //   red strobes) → sealed failsafe door 'l3-exit' (z -42; Game.js hides it
  //   when the boss dies) → collapsing escape corridor (-42..-52) → exit room
  //   (-52..-58) → WIN (needMonsterDead). Arena is 4 m tall.
  //
  _buildLevel3() {
    const H = 4;
    const kit = this._kit;
    const m = this._mats;

    this._winTriggers = [
      { x: 0, z: -56.6, radius: 1.5, needMonsterDead: true },
    ];

    // Boss patrol loop around the arena cover.
    this._monsterWaypoints = [
      { x: -9, z: -17 }, { x: 9, z: -17 }, { x: 9, z: -37 },
      { x: -9, z: -37 }, { x: 0, z: -27 },
    ];

    // ── Entry corridor (x -2..2, z 0..-10) ──────────────────────────────
    kit.floorSlab(4.3, 10.0, 0, -5.15, { lines: [{ axis: 'z', len: 8, color: 'emer' }] });
    kit.ceilingSlab(4.3, 10.0, 0, H, -5.15, {
      lamps: [
        { x: 0, z: 2.2, color: 'red', light: true, intensity: 0.7 },
        { x: 0, z: -2.2 },
      ],
    });
    kit.wallRun(4.6, H, 0.3, 0, H / 2, 0.15);                 // north end
    kit.wallRun(0.3, H, 10.3, -2.15, H / 2, -5.15);
    kit.wallRun(0.3, H, 10.3, 2.15, H / 2, -5.15);
    kit.doorway(2.6, 3.4, 0, 1.7, -10.15, 's');
    kit.sign(0, 3.0, -0.01, 'n', 'CONTAINMENT ARENA ▸', { sub: 'FAILSAFE ARMED', fg: '#ff8f7f' });
    kit.hangingPipe(-1.6, 3.4, -4.0, { tilt: 0.7 });
    kit.debrisPile(1.3, -7.5, { s: 0.8, seed: 41 });
    this._scorchDecal(0.8, 0, -3.0, 1.0);

    // ── Arena (x -14..14, z -10..-42) ───────────────────────────────────
    kit.floorSlab(28.6, 32.0, 0, -26.15, { trim: true });
    kit.ceilingSlab(28.6, 32.0, 0, H, -26.15, {
      lamps: [
        { x: -8, z: 9, light: true, intensity: 0.8 },
        { x: 8, z: 9 },
        { x: -8, z: -9, color: 'red', light: true, intensity: 0.6 },
        { x: 8, z: -9, color: 'red', light: true, intensity: 0.6 },
        { x: 0, z: 0, color: 'red' },
      ],
    });
    kit.wallRun(13.0, H, 0.3, -7.8, H / 2, -10.15);           // north (entry gap)
    kit.wallRun(13.0, H, 0.3, 7.8, H / 2, -10.15);
    kit.wallRun(13.0, H, 0.3, -7.8, H / 2, -42.15);           // south (exit gap)
    kit.wallRun(13.0, H, 0.3, 7.8, H / 2, -42.15);
    kit.wallRun(0.3, H, 32.3, -14.15, H / 2, -26.15);         // west
    kit.wallRun(0.3, H, 32.3, 14.15, H / 2, -26.15);          // east
    kit.sign(0, 3.4, -10.32, 'n', 'CONTAINMENT ARENA', { sub: 'CLASS-4 ENTITY — EXTREME CAUTION', fg: '#ff8f7f' });
    // Cover pillars (full height → occluders + colliders).
    for (const [cx, cz] of [
      [-7, -14], [7, -14], [0, -20], [-11, -22], [11, -22],
      [-7, -31], [7, -31], [-11, -36], [11, -36],
    ]) {
      kit.column(cx, cz, { h: H, r: 0.3 });
    }
    // Machinery + focal props.
    kit.generator(-11.5, -30.0, 'e');
    kit.generator(11.5, -16.0, 'w');
    kit.reactorCore(-5, -25.5, { r: 0.8, h: 2.2, light: false });
    kit.reactorCore(5, -25.5, { r: 0.8, h: 2.2, light: false });
    kit.containmentTube(-3, -38.5, { r: 0.8, h: 2.4, light: false });
    kit.crateStack(-6, -27.0, { w: 1.6, h: 1.6, d: 1.0, rotY: 0.25 });
    kit.crateStack(6, -27.0, { w: 1.6, h: 1.6, d: 1.0, rotY: -0.2 });
    kit.barrel(-9.5, -27.2);
    kit.barrel(-9.0, -26.6);
    kit.barrel(9.5, -27.2);
    kit.debrisPile(3.5, -40.5, { s: 1.2, seed: 42 });
    kit.debrisPile(-4.0, -12.5, { s: 1.2, seed: 43 });
    kit.fallenPanel(2.0, 0.4, -33.0, { rx: 0.55, ry: 1.1 });
    kit.fallenPanel(-3.0, 0.4, -17.0, { rx: 0.4, ry: -0.8 });
    kit.hangingPipe(1.8, 3.2, -30.0, { tilt: 0.75, len: 2.6 });
    kit.hangingPipe(-1.6, 3.4, -21.0, { tilt: -0.7 });
    // Red emergency guide lines + hazard floor marks.
    kit.floorLine(-12.6, -26, 28, { axis: 'z', color: 'emer' });
    kit.floorLine(12.6, -26, 28, { axis: 'z', color: 'emer' });
    kit.floorDecal(0, -12.0, 'stripes', { size: 1.3 });
    kit.floorDecal(0, -40.0, 'stripes', { size: 1.3 });
    this._scorchDecal(0.5, 0, -26.0, 2.2);
    this._scorchDecal(-6.0, 0, -33.0, 1.4);
    this._scorchDecal(5.0, 0, -19.0, 1.2);
    // Wall beacon lights (visual, no extra PointLights).
    for (const [bx, bz, face] of [
      [13.94, -16, 'w'], [-13.94, -30, 'e'], [13.94, -36, 'w'], [-13.94, -14, 'e'],
    ]) {
      kit.box(m.emergencyRed, 0.22, 0.22, 0.12, bx, 2.6, bz, { rotY: kit.faceAngle(face), cast: false });
    }

    // ── Sealed failsafe door 'l3-exit' (opened by Game.js on boss death) ──
    kit.doorway(2.6, 3.4, 0, 1.7, -42.15, 's');
    this._exitDoor = this._createDoor('l3-exit', 2.6, 3.4, 0, 1.7, -42.15, 0, m.hazard);
    kit.sign(0, 3.5, -41.97, 's', 'FAILSAFE SEAL', { sub: 'OPENS ON ENTITY DEATH', fg: '#ff5a3c' });

    // ── Escape corridor (x -2..2, z -42..-52) — dissolving ──────────────
    kit.floorSlab(4.3, 10.0, 0, -47.15, { lines: [{ axis: 'z', len: 8, color: 'exit' }] });
    kit.ceilingSlab(4.3, 10.0, 0, H, -47.15, { lamps: [{ x: 0, z: 0, color: 'red' }] });
    kit.wallRun(0.3, H, 10.3, -2.15, H / 2, -47.15);
    kit.wallRun(0.3, H, 10.3, 2.15, H / 2, -47.15);
    kit.pipeRun('z', 9.5, -1.95, 2.6, -47.15, { count: 2, r: 0.06 });
    kit.debrisPile(-1.4, -46.2, { s: 0.9, seed: 44 });
    kit.debrisPile(1.4, -50.4, { s: 0.8, seed: 45 });
    kit.fallenPanel(-1.2, 0.35, -48.5, { rx: 0.5, ry: -0.4 });
    kit.hangingPipe(1.7, 3.3, -50.0, { tilt: 0.7 });
    this._scorchDecal(0.5, 0, -44.0, 1.3);

    // ── Exit room (x -4..4, z -52..-58) — WIN ────────────────────────────
    kit.floorSlab(8.6, 6.0, 0, -55.15, { lines: [{ axis: 'z', len: 5, color: 'exit' }] });
    kit.ceilingSlab(8.6, 6.0, 0, H, -55.15, {
      lamps: [{ x: 0, z: 0, color: 'red', light: true, intensity: 0.7 }],
    });
    kit.wallRun(3.0, H, 0.3, -2.8, H / 2, -52.15);
    kit.wallRun(3.0, H, 0.3, 2.8, H / 2, -52.15);
    kit.wallRun(8.6, H, 0.3, 0, H / 2, -58.15);               // south end
    kit.wallRun(0.3, H, 6.3, -4.15, H / 2, -55.15);           // west
    kit.wallRun(0.3, H, 6.3, 4.15, H / 2, -55.15);            // east
    kit.doorway(2.6, 3.4, 0, 1.7, -52.15, 's');
    this._exitBeacon(0, -57.0, { radius: 1.7 });
    kit.sign(0, 3.2, -57.98, 's', 'EMERGENCY EXIT', { sub: 'SURFACE ACCESS', fg: '#5cff8a' });
    kit.wallScreen(3.93, 2.2, -55.0, 'w', { w: 2.4, h: 1.2 });
    kit.debrisPile(2.5, -56.5, { s: 1.1, seed: 46 });
    kit.fallenPanel(-2.0, 0.4, -53.5, { rx: 0.5, ry: 0.6 });
    kit.hangingPipe(-1.8, 3.3, -55.0, { tilt: 0.6 });
    kit.extinguisher(-3.94, 1.2, -53.0);

    // ── Dissolve targets (Kutloano's shader fades these during collapse) ──
    this._dissolveWalls = [];
    const dissolveChunk = (w, h, d, x, y, z) => {
      const c = kit.box(m.wallDark, w, h, d, x, y, z, { physics: false });
      this._dissolveWalls.push(c);
    };
    // Sagging ceiling slabs along the escape corridor.
    for (const dz of [-43.5, -45.5, -47.5, -49.5, -51.5]) {
      dissolveChunk(4.0, 0.4, 1.8, 0, 3.8, dz);
    }
    // Bulging wall panels (flush with the walls).
    for (const dz of [-44.5, -49.5]) {
      dissolveChunk(0.35, 3.0, 3.0, -2.15, 1.7, dz);
      dissolveChunk(0.35, 3.0, 3.0, 2.15, 1.7, dz);
    }
    // Exit-room ceiling about to come down.
    dissolveChunk(4.0, 0.4, 2.4, 0, 3.8, -54.6);
    dissolveChunk(4.0, 0.4, 2.4, 0, 3.8, -57.0);

    // ── Fog ──────────────────────────────────────────────────────────────
    this.fogColor = 0x100202;
    this.fogNear = 8;
    this.fogFar = 42;
  }

  // ── Game.js accessors ─────────────────────────────────────────────────────

  /** Monster patrol waypoints ({x, z}) for the current level. */
  get monsterWaypoints() { return this._monsterWaypoints; }

  /** Win trigger zones ({x, z, radius, needMonsterDead?}) for this level. */
  get winTriggers() { return this._winTriggers; }
}
