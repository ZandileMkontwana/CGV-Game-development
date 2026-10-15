/**
 * LevelManager — builds and tears down the three station levels.
 *
 * Every level is composed from LevelKit builders (architecture + props) and
 * a shared LevelMaterials theme bundle:
 *   Level 1  lab        — training hub + clean research facility, cool palette
 *   Level 2  damaged    — collapsed sections, rust + amber palette
 *   Level 3  emergency  — red alert, arena + collapse escape
 *
 * Teardown rules (important):
 *   - Kit meshes and cached model roots carry userData.kitShared and are
 *     removed but NOT disposed — shared geometry/material caches stay alive.
 *   - Texture maps are never disposed here (all cached/shared).
 *   - Only per-level creations (doors, targets, decals, steam sprites,
 *     pickups) own their resources, flagged via userData.ownsGeometry /
 *     ownsMaterial.
 *
 * Public API consumed by Game.js (do not change):
 *   load(n), _teardown(), update(dt), shootables, occluders, monsterWaypoints,
 *   winTriggers ({x, z, radius, needMonsterDead?}), heatHazeZones,
 *   _dissolveWalls, _exitDoor (Mesh), fogColor/Near/Far,
 *   openDoor(id), disableVent(id), _disposables ([{mesh, body}]) —
 *   Game._startCollapseSequence looks the exit door up in _disposables.
 *
 * Added (optional for Game.js):
 *   pickups, collectPickups(x, z) — health pickups in Level 1 side rooms.
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

// ── Blender props (public/models/*.glb) ─────────────────────────────────────
// Extra hero props placed on top of the procedural LevelKit geometry.
// x / z are world metres, rotY is radians. The models face +Z at rotY 0:
//   rotY 0 = faces north (+Z)    rotY -PI/2 = faces west (-X)
//   rotY PI = faces south (-Z)   rotY  PI/2 = faces east (+X)
// collision: adds a solid box so the player cannot walk through it (box half
// size = collisionRadius). occlude: blocks the monster's line of sight and the
// third-person camera, so it works as stealth cover.
//
// NOTE: Level 1 props are listed in the ORIGINAL authoring coordinates and are
// pushed south by TRAIN_LEN when placed (see _placeProps).
const PROP_PLACEMENTS = {
  1: [
    { file: 'locker',    x: 4.6,  z: -9.0,  rotY: -Math.PI / 2, collision: true, collisionRadius: 0.3 },
    { file: 'pipe_run',  x: 0,    z: -13.5, rotY: 0 },
    { file: 'console',   x: 6.0,  z: -22.0, rotY: -Math.PI / 2, collision: true, collisionRadius: 0.5 },
  ],
  2: [
    { file: 'console',   x: -2.8, z: -7.6,  rotY: 0,             collision: true, collisionRadius: 0.5 },
    { file: 'locker',    x: 3.2,  z: -23.0, rotY: -Math.PI / 2, collision: true, collisionRadius: 0.3, occlude: true },
    { file: 'locker',    x: -3.4, z: -21.6, rotY: Math.PI / 2,  collision: true, collisionRadius: 0.3, occlude: true },
    { file: 'pipe_run',  x: 0,    z: -31.8, rotY: 0 },
    { file: 'pipe_run',  x: 0,    z: -39.0, rotY: 0 },
  ],
  3: [],
};

// ── Level 1 layout ──────────────────────────────────────────────────────────
// The training wing occupies z 0 … -TRAIN_LEN (the player still spawns at the
// same place near z 0). The original route (Reception → Control room) is
// authored with direct z values pushed south by TRAIN_LEN.
const TRAIN_LEN = 34;

// Control labels shown on the training signs — edit these to match your game.
const L1_KEYS = { move: 'WASD', look: 'MOUSE', fire: 'CLICK', jump: 'SPACE' };
// Height of the jump-room hurdles (m). Must be clearable by the player's jump.
const HURDLE_H = 0.4;

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

// ── Shared smoke particle texture (created once, kept for the session) ──────
let _smokeTexture = null;

function smokeTexture() {
  if (_smokeTexture) return _smokeTexture;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;

  const ctx = canvas.getContext('2d');

  // Soft cloud: dense in the middle, transparent at the edges.
  const gradient = ctx.createRadialGradient(
    64, 64, 2,
    64, 64, 62
  );

  gradient.addColorStop(0, 'rgba(225, 232, 238, 0.48)');
  gradient.addColorStop(0.35, 'rgba(190, 202, 212, 0.25)');
  gradient.addColorStop(0.7, 'rgba(160, 175, 188, 0.08)');
  gradient.addColorStop(1, 'rgba(140, 155, 170, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  _smokeTexture = new THREE.CanvasTexture(canvas);
  return _smokeTexture;
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

    /**
     * Power-routing nodes {id, mesh, led, lit, lights, doorIds}
     * (rebuilt each load) — the Level 1 puzzle layer.
     */
    this._powerNodes = [];

    /** Lights fading in after their node fired {light, target, ramp}. */
    this._powerLights = [];

    /** Dust-mote Points clouds with a slow drift (rebuilt each load). */
    this._dustFields = [];

    /** Meshes the dissolve shader fades during the L3 collapse. */
    this._dissolveWalls = [];

    /** Breakable pipe segments for creature-escape destruction (L1). */
    this._breakablePipes = [];

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

    /**
     * Collectible pickups for the active level (rebuilt each load):
     * {id, type:'health', amount, x, y, z, radius, taken, mesh, baseY, phase}.
     * Game.js calls collectPickups(playerX, playerZ) each frame and applies
     * the returned pickups (e.g. heal the player by p.amount).
     */
    this.pickups = [];
    this._collectedBuf = [];   // reused result array — no per-frame allocation
    this._time = 0;            // running clock for pickup bobbing

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

    this._placeProps(levelNum);

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
    this._powerNodes = [];
    this._powerLights = [];
    this._dustFields = [];
    this._dissolveWalls = [];
    this._breakablePipes = [];
    this._exitDoor = null;
    this.scriptedReveal = null;
    this.npcAnchors = {};
    this._flickerLights = [];
    this.pickups = [];
    this._collectedBuf.length = 0;
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
   * Load this level's Blender props from PROP_PLACEMENTS. Loading is async and
   * never blocks the level: a missing file just logs a warning and is skipped.
   * @param {number} levelNum
   */
  _placeProps(levelNum) {
    const list = PROP_PLACEMENTS[levelNum] || [];
    // Level 1's route is pushed south by TRAIN_LEN (see L1Z).
    const zShift = levelNum === 1 ? TRAIN_LEN : 0;
    for (const p of list) {
      this._loadModel(`models/${p.file}.glb`, p.x, 0, p.z - zShift, {
        rotY: p.rotY || 0,
        collision: !!p.collision,
        collisionRadius: p.collisionRadius || 0.5,
      }).then((model) => {
        if (!model) return; // failed, or the level was torn down meanwhile
        model.updateMatrixWorld(true);
        if (p.occlude) {
          model.traverse((child) => {
            if (child.isMesh) this.occluders.push(child);
          });
        }
      });
    }
  }

  /**
   * Sliding door that opens when its linked target is shot. Slides up (Y+)
   * and its collision body is removed once fully open. A status beacon
   * beside the frame burns sealed-red until the door opens, then flips to
   * green — colour changes only, so the light inventory never changes.
   * Pass o.needPower = [nodeIds] to require power nodes before it unlocks
   * (checked in _activatePowerNode). rotY may be PI/2 for doors in side walls.
   */
  _createDoor(id, w, h, x, y, z, rotY, mat, o = {}) {
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
    if (rotY) body.quaternion.setFromEuler(0, rotY, 0); // match the mesh yaw
    this._track(mesh, body);
    this.occluders.push(mesh); // a closed door blocks line of sight
    // Status beacon beside the frame (own material — safe to recolor).
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0xff4030, emissive: 0xff4030, emissiveIntensity: 1.0,
    });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), ledMat);
    const sideX = Math.cos(rotY) * (w / 2 + 0.28);
    const sideZ = -Math.sin(rotY) * (w / 2 + 0.28);
    led.position.set(x + sideX, y + h / 2 + 0.22, z + sideZ);
    led.rotation.y = rotY;
    led.userData.ownsGeometry = true;
    led.userData.ownsMaterial = true;
    this.scene.add(led);
    this._track(led);
    // o.noBeaconLight skips the extra PointLight (the LED still changes colour).
    let beacon = null;
    if (!o.noBeaconLight) {
      beacon = new THREE.PointLight(0xff4030, 0.45, 5, 2);
      beacon.position.set(x + sideX, y + h / 2 + 0.1, z + sideZ);
      this.scene.add(beacon);
      this._track(beacon);
    }
    this._doors.push({
      id, mesh, body,
      closedY: y,
      openY: y + h + 0.3,
      progress: 0,
      opening: false,
      needPower: o.needPower || null,
      led,
      beacon,
    });
    return mesh;
  }

  /** Trigger a door to open by its id. */
  openDoor(id) {
    const door = this._doors.find(d => d.id === id);
    if (door && !door.opening) {
      door.opening = true;
      // Status beacon flips from sealed red to open green.
      if (door.led) {
        door.led.material.color.setHex(0x5cff8a);
        door.led.material.emissive.setHex(0x5cff8a);
      }
      if (door.beacon) door.beacon.color.setHex(0x5cff8a);
    }
  }

  // ── Steam / spark vents (pre-allocated pools — zero per-frame allocs) ─────

  /**
   * Create a vent emitter. Emits from a fixed-size sprite pool; `disableVent`
   * stops new spawns while live particles fade out.
   */
  _createSteamVent(id, x, y, z, o = {}) {
    const n = o.count || 14;
    const pool = [];

    const isSmoke = o.smoke !== false;
    const texture = isSmoke ? smokeTexture() : null;

    const life = new Float32Array(n);
    const vy = new Float32Array(n);
    const vx = new Float32Array(n);
    const vz = new Float32Array(n);
    const sizes = new Float32Array(n);
    const phases = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture,
        color: o.color ?? 0xc9d2da,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });

      const s = new THREE.Sprite(mat);

      s.scale.set(0.25, 0.25, 1);
      s.position.set(x, y, z);
      s.visible = false;

      s.userData.ownsMaterial = true;

      this.scene.add(s);
      this._track(s);
      pool.push(s);
    }

    this._steamVents.push({
      id, x, y, z, pool,
      idx: 0,
      timer: 0,
      active: true,
      age: 0,
      stopAt: o.stopAt || 0,
      life,
      vy,
      vx,
      vz,
      sizes,
      phases,
      rate: o.rate ?? 0.07,
      rise: o.rise ?? 0.55,
      drift: o.drift ?? 0.12,
      lifeSpan: o.lifeSpan ?? 1.8,
      alpha: o.alpha ?? 0.32,
      isSmoke,
    });
  }

  /** Disable a steam vent by id (stops particle spawning). */
  disableVent(id) {
    const vent = this._steamVents.find(v => v.id === id);
    if (vent) vent.active = false;
  }

  /**
   * One-shot spark burst at a world point (event time, not per-frame). A
   * tiny additive sprite pool that emits for ~0.12 s and then dies out with
   * the remaining particles. Used for power-node activation feedback.
   */
  _sparkBurst(x, y, z) {
    this._createSteamVent(
      `burst-${this._levelGeneration}-${Math.random()}`,
      x, y, z,
      {
        count: 7, color: 0xffc060, rate: 0.015, rise: 1.7, drift: 0.55,
        lifeSpan: 0.35, alpha: 0.95, stopAt: 0.12, additive: true,
        smoke: false,
      }
    );
  }

  // ── Breakable pipes (creature-escape destruction) ────────────────────────

  /**
   * Register a breakable pipe run. Called during level build.
   * @param {Array} segments - from kit.breakablePipeRun()
   * @param {object} breakPoint - {x, y, z} where sparks/steam spawn
   */
  _addBreakablePipe(segments, breakPoint) {
    this._breakablePipes.push({
      segments,       // [{ mesh, position }]
      breakPoint,     // { x, y, z }
      broken: false,
      dissolveT: 0,   // 0..1 animation progress
      dissolveDuration: 0.6,
      active: false,   // is currently dissolving?
    });
  }

  /**
   * Trigger destruction of a breakable pipe by index.
   * Returns the pipe data so Game.js can swap materials and spawn effects.
   */
  _breakPipe(index) {
    const pipe = this._breakablePipes[index];
    if (!pipe || pipe.broken) return null;
    pipe.broken = true;
    pipe.active = true;
    pipe.dissolveT = 0;
    return pipe;
  }

  /** Drive dissolve animation for broken pipes. Called from update(dt). */
  _updateBreakablePipes(dt) {
    for (const pipe of this._breakablePipes) {
      if (!pipe.active) continue;
      pipe.dissolveT += dt / pipe.dissolveDuration;
      if (pipe.dissolveT >= 1) {
        pipe.dissolveT = 1;
        pipe.active = false;
      }
      // Each segment's dissolve material uniform is updated by Game.js
      // which holds the material references.
    }
  }

  // ── Power-routing nodes (Level 1 puzzle) ─────────────────────────────────

  /**
   * Place a shootable power node: a dark panel with a red standby LED and a
   * flickering red halo so it is findable in an unlit alcove. o.lights lists
   * PointLights that fade in when the node fires (see _powerLight);
   * o.doorIds lists doors unlocked once every node they need is live (doors
   * carry needPower themselves). Pass o.halo = false to skip the halo light. o.group scopes the
   * live/total counter returned by _activatePowerNode to nodes of that group.
   *
   * @param {string} id    unique node id ('l1-power-a')
   * @param {number} x     world x
   * @param {number} y     panel centre height
   * @param {number} z     world z
   * @param {number} rotY  panel facing (radians — toward the approach)
   * @param {object} o     { lights: PointLight[], doorIds: string[], halo?: boolean }
   */
  _addPowerNode(id, x, y, z, rotY = 0, o = {}) {
    const mesh = this._shootableTarget(0.55, 0.7, x, y, z, 'terminal', rotY);
    mesh.userData.powerNode = { id };
    // Offline state: dim red instead of the default terminal green.
    mesh.material.color.setHex(0xff4030);
    mesh.material.emissive.setHex(0xff4030);
    mesh.material.emissiveIntensity = 0.5;
    // Housing box behind the panel.
    const kit = this._kit;
    kit.box(kit.mats.metalDark, 0.8, 1.0, 0.16,
      x - Math.sin(rotY) * 0.1, y, z - Math.cos(rotY) * 0.1, { rotY, occluder: false });
    // Status LED above the panel (own material — recolored on activation).
    const led = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xff4030, emissive: 0xff4030, emissiveIntensity: 1.0 })
    );
    led.position.set(x + Math.cos(rotY) * 0.34, y + 0.46, z - Math.sin(rotY) * 0.34);
    led.rotation.y = rotY;
    led.userData.ownsGeometry = true;
    led.userData.ownsMaterial = true;
    this.scene.add(led);
    this._track(led);
    // A flickering red halo so the node reads in a dark alcove.
    if (o.halo !== false) {
      this._flickerLight(
        x + Math.sin(rotY) * 0.3, y + 0.2, z + Math.cos(rotY) * 0.3,
        0xff4030, 0.32, 4.5
      );
    }
    this._powerNodes.push({
      id, mesh, led, lit: false,
      lights: o.lights || [],
      doorIds: o.doorIds || [],
      group: o.group || null,
    });
    return mesh;
  }

  /**
   * A light that starts dark and fades in when the power node that lists it
   * fires. Never toggles `visible` (that would change the light inventory).
   */
  _powerLight(x, y, z, color, target = 0.9, distance = 8) {
    const light = new THREE.PointLight(color, 0, distance, 2);
    light.position.set(x, y, z);
    light.userData.powerTarget = target;
    this.scene.add(light);
    this._track(light);
    return light;
  }

  /**
   * Fire a power node (PulseTool hit). Lights the panel/LED green, starts
   * the linked lights fading in, sparks, and unlocks doors whose needPower
   * set is now fully live. Returns null when unknown or already live;
   * otherwise { live, total, unlockedDoor } for the caller's HUD/audio.
   */
  _activatePowerNode(id) {
    const node = this._powerNodes.find((n) => n.id === id);
    if (!node || node.lit) return null;
    node.lit = true;
    node.mesh.material.color.setHex(0x2bd96a);
    node.mesh.material.emissive.setHex(0x2bd96a);
    node.mesh.material.emissiveIntensity = 0.9;
    node.led.material.color.setHex(0x2bd96a);
    node.led.material.emissive.setHex(0x2bd96a);
    for (const l of node.lights) {
      this._powerLights.push({ light: l, target: l.userData.powerTarget || 0.9, ramp: 0 });
    }
    this._sparkBurst(node.mesh.position.x, node.mesh.position.y, node.mesh.position.z);
    let unlockedDoor = null;
    for (const door of this._doors) {
      if (!door.needPower || door.opening) continue;
      const ready = door.needPower.every((nid) => {
        const n2 = this._powerNodes.find((n) => n.id === nid);
        return n2 && n2.lit;
      });
      if (ready) {
        this.openDoor(door.id);
        unlockedDoor = door.id;
      }
    }
    // Event-time allocations only (a PulseTool hit, never per frame).
    let live = 0;
    let total = 0;
    for (const n of this._powerNodes) {
      if (n.group !== node.group) continue;
      total++;
      if (n.lit) live++;
    }
    return { live, total, unlockedDoor };
  }

  /** Add a rotating hazard mesh (fan blades, spinning debris). */
  _addRotatingHazard(mesh, speed) {
    this._rotatingHazards.push({ mesh, speed });
  }

  // ── Pickups ───────────────────────────────────────────────────────────────

  /**
   * Floating, spinning pickup (a glowing cross). Owns its geometry/material.
   * Nothing happens when walked over until Game.js calls collectPickups().
   *
   * @param {string} id
   * @param {'health'} type
   * @param {number} x
   * @param {number} z
   * @param {object} o  { amount = 25, y = 0.8, radius = 0.9 }
   */
  _addPickup(id, type, x, z, o = {}) {
    const amount = o.amount ?? 25;
    const y = o.y ?? 0.8;
    const color = 0x39e07a;
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 1.3, roughness: 0.4, metalness: 0.1,
    });
    // A "+" built from two bars; the horizontal bar is a child of the vertical one.
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.1), mat);
    bar.position.set(x, y, z);
    bar.userData.ownsGeometry = true;
    bar.userData.ownsMaterial = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.1), mat);
    arm.userData.ownsGeometry = true;
    bar.add(arm);
    this.scene.add(bar);
    this._track(bar);
    this._track(arm);
    const pickup = {
      id, type, amount, x, y, z,
      radius: o.radius ?? 0.9,
      taken: false,
      mesh: bar,
      baseY: y,
      phase: Math.random() * 6.283,
    };
    this.pickups.push(pickup);
    return pickup;
  }

  /**
   * Collect any pickups within reach of the player. Returns a REUSED array of
   * the pickups just collected this call (usually empty) — consume it right
   * away and do not keep a reference. Cheap enough to call every frame.
   *
   * @param {number} px player x
   * @param {number} pz player z
   */
  collectPickups(px, pz) {
    const out = this._collectedBuf;
    out.length = 0;
    for (const p of this.pickups) {
      if (p.taken) continue;
      const dx = px - p.x;
      const dz = pz - p.z;
      if (dx * dx + dz * dz <= p.radius * p.radius) {
        p.taken = true;
        p.mesh.visible = false;
        out.push(p);
      }
    }
    return out;
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

  /**
   * A side (east/west) wall at x running along z, with an open doorway gap:
   * two wall segments, a header above the opening and a thin jamb strip on
   * each side of the gap. zNorth > zSouth (levels run toward -z).
   *
   * @param {number} x          wall centre x
   * @param {number} zNorth     z of the wall's north end
   * @param {number} zSouth     z of the wall's south end
   * @param {number} gapCenter  z centre of the opening
   * @param {number} gapW       opening width along z
   * @param {number} H          wall height
   * @param {number} openH      opening height (default 2.5)
   */
  _gappedSideWall(x, zNorth, zSouth, gapCenter, gapW, H, openH = 2.5) {
    const kit = this._kit;
    const g1 = gapCenter + gapW / 2; // north edge of the opening
    const g2 = gapCenter - gapW / 2; // south edge of the opening
    kit.wallRun(0.3, H, zNorth - g1, x, H / 2, (zNorth + g1) / 2);
    kit.wallRun(0.3, H, g2 - zSouth, x, H / 2, (g2 + zSouth) / 2);
    kit.wallRun(0.3, H - openH, gapW, x, openH + (H - openH) / 2, gapCenter);
    kit.box(this._mats.metalDark, 0.36, openH, 0.12, x, openH / 2, g1 - 0.06, { physics: true });
    kit.box(this._mats.metalDark, 0.36, openH, 0.12, x, openH / 2, g2 + 0.06, { physics: true });
  }

  /**
   * A dying practical light (bare bulb / damaged fixture). Tagged with
   * userData.flicker so load() collects it into _flickerLights and the
   * update() driver stutters it — idle stretches, then bursts, faster in
   * collapse mode. Never toggle `visible` on lights: that changes the
   * renderer's light inventory and forces a full shader recompile.
   */
  _flickerLight(x, y, z, color, intensity, distance) {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.set(x, y, z);
    light.userData.flicker = true;
    this.scene.add(light);
    this._track(light);
    return light;
  }

  /**
   * Fake volumetric light shaft — an additive open-ended cone suggesting a
   * beam streaming down from a ceiling breach. Purely visual (no real light,
   * depth-write off) so it costs almost nothing.
   */
  _lightShaft(x, yBottom, z, height, color = 0xffd9a0, radius = 0.8) {
    const geo = new THREE.CylinderGeometry(0.1, radius, height, 12, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const shaft = new THREE.Mesh(geo, mat);
    shaft.position.set(x, yBottom + height / 2, z);
    shaft.renderOrder = 5;
    shaft.userData.ownsGeometry = true;
    shaft.userData.ownsMaterial = true;
    this.scene.add(shaft);
    this._track(shaft);
    return shaft;
  }

  /**
   * Drifting dust motes — a cheap Points cloud that slowly swirls around the
   * room centre. Mote positions are stored relative to the object position,
   * so rotating the object keeps the swirl in place (motes farther from the
   * centre drift faster, which reads as natural air movement).
   */
  _dustMotes(count, cx, cz, radius, yMin, yMax) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = yMin + Math.random() * (yMax - yMin);
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xcfe0ea,
      size: 0.035,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const motes = new THREE.Points(geo, mat);
    motes.position.set(cx, 0, cz);
    motes.userData.ownsGeometry = true;
    motes.userData.ownsMaterial = true;
    this.scene.add(motes);
    this._track(motes);
    this._dustFields.push(motes);
    return motes;
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
      v.age += dt;
      if (v.stopAt > 0 && v.age > v.stopAt) v.active = false;

      if (v.active) {
        v.timer += dt;

        while (v.timer >= v.rate) {
          v.timer -= v.rate;

          const i = v.idx = (v.idx + 1) % v.pool.length;
          const s = v.pool[i];

          v.life[i] = v.lifeSpan;
          v.vy[i] = v.rise * (0.7 + Math.random() * 0.6);

          v.vx[i] = (Math.random() - 0.5) * v.drift;
          v.vz[i] = (Math.random() - 0.5) * v.drift;

          v.sizes[i] = v.isSmoke
            ? 0.25 + Math.random() * 0.2
            : 0.12;

          v.phases[i] = Math.random() * Math.PI * 2;

          s.position.set(
            v.x + (Math.random() - 0.5) * v.drift,
            v.y,
            v.z + (Math.random() - 0.5) * v.drift
          );

          s.scale.set(v.sizes[i], v.sizes[i], 1);
          s.material.opacity = 0;
          s.visible = true;
        }
      }

      for (let i = 0; i < v.pool.length; i++) {
        if (v.life[i] <= 0) continue;

        v.life[i] -= dt;

        const s = v.pool[i];

        if (v.life[i] <= 0) {
          s.visible = false;
          s.material.opacity = 0;
          continue;
        }

        const age = 1 - v.life[i] / v.lifeSpan;
        const t = v.life[i] / v.lifeSpan;

        // Rise and spread sideways.
        s.position.y += v.vy[i] * dt;
        s.position.x += v.vx[i] * dt;
        s.position.z += v.vz[i] * dt;

        if (v.isSmoke) {
          // Gentle, independent sideways turbulence.
          s.position.x += Math.sin(
            age * 3 + v.phases[i]
          ) * 0.08 * dt;

          // Expand as the smoke rises.
          const size = v.sizes[i] + age * 0.65;
          s.scale.set(size, size, 1);

          // Fade in, then fade out.
          const fadeIn = Math.min(1, age * 5);
          const fadeOut = Math.min(1, t * 2.5);

          s.material.opacity =
            v.alpha * fadeIn * fadeOut;
        } else {
          // Retain a simple fading effect for sparks.
          s.material.opacity = t * v.alpha;
          s.scale.set(v.sizes[i], v.sizes[i], 1);
        }
      }
    }

    // Rotating hazards.
    for (const { mesh, speed } of this._rotatingHazards) {
      mesh.rotation.y += speed * dt;
    }

    // Dust motes: slow in-place swirl.
    for (const d of this._dustFields) {
      d.rotation.y += dt * 0.04;
    }

    // Pickups: slow spin + gentle bob until collected.
    this._time += dt;
    for (const p of this.pickups) {
      if (p.taken) continue;
      p.mesh.rotation.y += dt * 1.6;
      p.mesh.position.y = p.baseY + Math.sin(this._time * 2.2 + p.phase) * 0.06;
    }

    // Power-routed lights — fade in after their node fired, then hand off.
    for (let i = this._powerLights.length - 1; i >= 0; i--) {
      const p = this._powerLights[i];
      p.ramp = Math.min(1, p.ramp + dt * 1.6);
      p.light.intensity = p.target * p.ramp;
      if (p.ramp >= 1) this._powerLights.splice(i, 1);
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

    // Breakable pipes — dissolve animation for creature-escape destruction.
    this._updateBreakablePipes(dt);
  }

  // ── Level 1 — The Experiment (training hub + clean lab) ──────────────────
  //
  // Flow (player walks toward -z). Everything from Reception onward is authored
  // in its original coordinates and shifted by L1Z():
  //
  //   Room A (move/look/first shot) ─door─► TRAINING HUB ──┬─ west door ► JUMP ROOM
  //                                                         │   (3 hurdles → turn → relay)
  //                                                         ├─ east door ► SHOOT ROOM
  //                                                         │   (3 panels: far, high, low)
  //                                                         └─ south GATE (needs all 4
  //                                                            panels) ► Reception ► C1 ►
  //                                                            Laboratory ► … ► Control room
  //
  // Hub doors open by shooting the glowing blue panel beside them. Panels in the
  // jump/shoot rooms are power nodes (group 'train'); the gate opens when all 4
  // are live. Optional side rooms: Break Room, Equipment Nook, Lab Annex,
  // Records Vault.
  //
  _buildLevel1() {
    const H = 3;
    const kit = this._kit;
    const m = this._mats;

    this._winTriggers = [
      { x: 0, z: -96, radius: 2.0 }, // control room console
    ];
    this._monsterWaypoints = []; // L1 monster is a scripted cameo (see below)

    // Scripted reveal data (Game.js runs the beat; level just supplies it).
    // Story beat: the bitten scientist convulses and mutates into the
    // creature, which then flees into the ducts — the player witnesses it.
    this.scriptedReveal = {
      trigger: { x: 0, z: -56, radius: 2.8 },   // fires as the player enters the lab
      spawn: { x: -2.45, y: 1.4, z: -59.25 },      // the scientist's console seat
      escape: [                                          // flees toward the SE duct
        { x: 2.5, z: -61.5 },
        { x: 6.5, z: -64.8 },
      ],
      patrol: [                                          // settles into a prowl loop
        { x: 4, z: -56 },
        { x: -4, z: -55 },
        { x: 0, z: -60 },
      ],
    };
    this.npcAnchors = {
      scientist: { x: -2.45, z: -59.25, face: 'w' }, // seated, typing at the console
    };

    // Training hub first (z 0 … -TRAIN_LEN), then the real facility, then the
    // optional side rooms that branch off it.
    this._buildTrainingWing();

// ── Reception (x -5..5, z 0..-10) ─────────────────────────────────────
    kit.floorSlab(10.6, 10.45, 0, -38.93, { lines: [{ axis: 'z', len: 8, color: 'accent' }] });
    kit.ceilingSlab(10.6, 10.45, 0, H, -38.93, {
      lamps: [
        { x: -2.4, z: 2.0, light: true, intensity: 0.8 },
        { x: 2.4, z: -2.2 },
      ],
    });
    // North wall: opening to the training wing (x -1.3..1.3).
    kit.wallRun(4.0, H, 0.3, -3.3, H / 2, -33.85);
    kit.wallRun(4.0, H, 0.3, 3.3, H / 2, -33.85);
    kit.doorway(2.6, 2.6, 0, 1.3, -33.85, 's');
    kit.wallRun(0.3, H, 10.45, -5.15, H / 2, -38.93);           // west
    // East wall: opening to the Break Room (optional side room).
    this._gappedSideWall(5.15, -33.7, -44.3, -41.2, 2.4, H);
    // South wall with a door-sized arch (x -1.3..1.3).
    kit.wallRun(4.0, H, 0.3, -3.3, H / 2, -44.15);
    kit.wallRun(4.0, H, 0.3, 3.3, H / 2, -44.15);
    kit.doorway(2.6, 2.6, 0, 1.3, -44.15, 's');
    kit.sign(-3.3, 2.3, -43.97, 's', 'RECEPTION', { sub: 'SECTOR A', fg: '#7fe7ff' });
    kit.sign(3.3, 2.3, -43.97, 's', 'BREACH PROTOCOL', { sub: 'FOLLOW THE EXIT MARKERS', fg: '#7fe7ff' });
    kit.consoleDesk(-3.6, -39, 'e', { w: 1.8, monitors: 1 });
    kit.crateStack(4.0, -37.2, { w: 1.2, h: 1.2, d: 0.8, rotY: 0.3 });
    kit.crate(4.3, -38.7, { s: 0.7, rotY: 0.4 });   // moved off the Break Room doorway
    kit.fuseBox(-4.94, 1.7, -42.5, 'e');
    kit.extinguisher(-4.94, 1.2, -37);
    kit.floorDecal(3.2, -39, 'stripes', { size: 1.2 });

    // ── Corridor C1 (x -2..2, z -10..-20) ────────────────────────────────
    kit.floorSlab(4.3, 10.0, 0, -49.15, { lines: [{ axis: 'z', len: 8.5, color: 'accent' }] });
    kit.ceilingSlab(4.3, 10.0, 0, H, -49.15, {
      lamps: [
        { x: 0, z: 2.4, light: true, intensity: 0.7 },
        { x: 0, z: -2.4 },
      ],
    });
    this._gappedSideWall(-2.15, -44, -54.3, -49, 2.4, H); // west: Equipment Nook
    this._gappedSideWall(2.15, -44, -54.3, -49, 2.4, H);  // east: Records Vault (door)
    kit.pipeRun('z', 9.5, -1.95, 2.55, -49.15, { count: 2, r: 0.06 });
    kit.cableTray('z', 9.5, 1.95, 2.6, -49.15);
    kit.sign(0, 2.3, -53.97, 's', 'LAB A-2 ▸', { sub: 'BIOHAZARD LEVEL 2', fg: '#7fe7ff' });
    kit.fuseBox(-1.94, 1.6, -46.5, 'e');
    kit.ventGrille(-1.95, 2.2, -51.5, 'e', { w: 0.8, h: 0.5 });

    // ── Laboratory (x -9..9, z -20..-32) ─────────────────────────────────
    kit.floorSlab(18.6, 12.0, 0, -60.15, {
      lines: [{ axis: 'z', len: 10, color: 'accent' }],
    });
    kit.ceilingSlab(18.6, 12.0, 0, H, -60.15, {
      lamps: [
        { x: -4.5, z: 4.0, light: true, intensity: 0.9 },
        { x: 4.5, z: 4.0 },
        { x: -4.5, z: -4.0 },
        { x: 4.5, z: -4.0, light: true, intensity: 0.9 },
      ],
    });
    // North wall (corridor mouth) + south wall (door 'l1-lab').
    kit.wallRun(8.0, H, 0.3, -5.3, H / 2, -54.15);
    kit.wallRun(8.0, H, 0.3, 5.3, H / 2, -54.15);
    kit.wallRun(8.0, H, 0.3, -5.3, H / 2, -66.15);
    kit.wallRun(8.0, H, 0.3, 5.3, H / 2, -66.15);
    kit.wallRun(0.3, H, 12.3, -9.15, H / 2, -60.15);          // west
    this._gappedSideWall(9.15, -54, -66.3, -59, 2.4, H);   // east: Lab Annex
    kit.doorway(2.6, 2.6, 0, 1.3, -54.15, 's');
    // The tutorial door: shoot the conduit beside it.
    kit.doorway(2.6, 2.6, 0, 1.3, -66.15, 's');
    this._createDoor('l1-lab', 2.6, 2.6, 0, 1.3, -66.15, 0, m.metalDark);
    const l1Conduit = this._shootableTarget(0.55, 0.4, 1.7, 1.9, -65.96, 'conduit', 0);
    l1Conduit.userData.doorId = 'l1-lab';
    kit.sign(0, 2.55, -65.97, 's', 'MAINTENANCE ▸', { sub: 'PULSE TOOL REQUIRED', fg: '#ffd27f' });

    // Focal props: containment tube + scientist console + benches.
    kit.containmentTube(-5.0, -60);
    kit.consoleDesk(-3.4, -59.2, 'e', { w: 1.8, monitors: 2 });
    kit.chair(-1.55, -59.05, 'w');
    kit.labBench(5.6, -57.5, 'w', { len: 2.6 });
    kit.labBench(5.6, -61.5, 'w', { len: 2.6 });
    kit.shelfUnit(-8.2, -56, 'e', { w: 1.5 });
    kit.cabinet(-8.2, -63.2, 'e');
    kit.wallScreen(-8.93, 1.9, -60, 'e', { w: 2.4, h: 1.3 });
    kit.wallScreen(-8.93, 1.9, -57.4, 'e', { w: 1.2, h: 1.3, alt: true, dotMat: m.emergencyRed });
    kit.canister(-5.8, -64.5);
    kit.canister(-5.4, -64.2);
    kit.crate(-7.5, -64.6, { s: 0.7 });
    kit.crateStack(-7.8, -55.2, { w: 1.4, h: 1.4, d: 0.9 });
    kit.barrel(8.2, -64.5);
    kit.barrel(7.6, -64.8);
    kit.debrisPile(-8.0, -61.6, { s: 0.8, seed: 11 });
    kit.floorDecal(3.0, -59, 'dashes', { size: 2.0 });
    // Ventilation duct along the south wall — the creature escapes here.
    kit.duct('x', 18.3, 0, 2.8, -65.7, { grilles: [-6.5, 6.5] });
    kit.ventGrille(6.5, 2.6, -65.94, 's', { w: 0.9, h: 0.6 });
    // Lingering smoke leak from the damaged duct grille.
    this._createSteamVent(
      'l1-lab-leak',
      6.5, 2.15, -65.7,
      {
        count: 24, rate: 0.08, rise: 0.3, drift: 0.25,
        lifeSpan: 2.8, alpha: 0.35,
      }
    );
    // Breakable pipes along the creature's escape path (smashed during reveal).
    // Pipe 1: east wall vertical run (creature smashes as it bursts out).
    const pipe1Segs = kit.breakablePipeRun('z', 7.0, 8.5, 2.5, -60.5, { count: 2, r: 0.06 });
    this._addBreakablePipe(pipe1Segs, { x: 8.5, y: 2.5, z: -60.5 });
    // Pipe 2: crossing near the creature's flee waypoint.
    const pipe2Segs = kit.breakablePipeRun('x', 4.0, 3.0, 2.4, -62, { count: 2, r: 0.06 });
    this._addBreakablePipe(pipe2Segs, { x: 3.0, y: 2.4, z: -62 });
    // Pipe 3: south wall near the duct (final smash before escape).
    const pipe3Segs = kit.breakablePipeRun('x', 5.0, 5.0, 2.6, -65.3, { count: 2, r: 0.07 });
    this._addBreakablePipe(pipe3Segs, { x: 5.0, y: 2.6, z: -65.3 });
    // Alarm beacon near containment (the scripted beat's visual anchor).
    kit.lamp(-7.6, -61.5, { y: 2.6, color: 'red', light: false });
    this._scorchDecal(-5.0, 0, -62.4, 1.6, 0.4);
    // Red emergency spotlight on the lab ceiling — flickers when the monster emerges.
    this._labRedSpot = this._flickerLight(0, 2.9, -60, 0xff2200, 0.0, 12);
    this._labRedSpot.intensity = 0; // starts off, activated when monster appears

    // ── Maintenance C2 (x -2..2, z -32..-40) ─────────────────────────────
    kit.floorSlab(4.3, 8.0, 0, -70.15, { lines: [{ axis: 'z', len: 6.5, color: 'accent' }] });
    kit.ceilingSlab(4.3, 8.0, 0, H, -70.15, {
      lamps: [{ x: 0, z: 0, light: true, intensity: 0.7 }],
    });
    kit.wallRun(0.3, H, 8.3, -2.15, H / 2, -70.15);
    kit.wallRun(0.3, H, 8.3, 2.15, H / 2, -70.15);
    kit.pipeRun('z', 7.5, -1.95, 2.5, -70.15, { count: 3, r: 0.06 });
    kit.cableTray('z', 7.5, 1.95, 2.55, -70.15);
    kit.fuseBox(1.94, 1.6, -68, 'w');
    kit.floorDecal(0, -67.2, 'stripes', { size: 1.0 });

    // ── Reactor hall (x -10..10, z -40..-54) ─────────────────────────────
    kit.floorSlab(20.6, 14.0, 0, -81.15, { trim: true });
    kit.ceilingSlab(20.6, 14.0, 0, H, -81.15, {
      lamps: [
        { x: -6, z: 5, light: true, intensity: 0.85 },
        { x: 6, z: 5 },
        { x: -6, z: -5 },
        { x: 6, z: -5, light: true, intensity: 0.85 },
      ],
    });
    kit.wallRun(9.0, H, 0.3, -5.8, H / 2, -74.15);
    kit.wallRun(9.0, H, 0.3, 5.8, H / 2, -74.15);
    kit.wallRun(9.0, H, 0.3, -5.8, H / 2, -88.15);
    kit.wallRun(9.0, H, 0.3, 5.8, H / 2, -88.15);
    kit.wallRun(0.3, H, 14.3, -10.15, H / 2, -81.15);         // west
    kit.wallRun(0.3, H, 14.3, 10.15, H / 2, -81.15);          // east
    kit.doorway(2.6, 2.6, 0, 1.3, -74.15, 's');
    kit.doorway(2.6, 2.6, 0, 1.3, -88.15, 's');
    kit.sign(0, 2.4, -73.97, 's', 'REACTOR HALL ▸', { fg: '#ffd27f' });
    kit.sign(0, 2.5, -74.32, 'n', 'REACTOR HALL', { sub: 'AUTHORISED PERSONNEL ONLY', fg: '#ffd27f' });
    // Focal reactor core (top stays clear of the 3 m ceiling).
    kit.reactorCore(0, -81, { r: 1.5, h: 2.4 });
    for (const [cx, cz] of [[-6.5, -77.5], [6.5, -77.5], [-6.5, -84.5], [6.5, -84.5]]) {
      kit.column(cx, cz, { h: H, r: 0.26 });
    }
    kit.railing('x', 7.2, 0, 0, -77.6);
    kit.railing('x', 7.2, 0, 0, -84.4);
    kit.railing('z', 6.8, -3.6, 0, -81);
    kit.railing('z', 6.8, 3.6, 0, -81);
    kit.pipeRun('x', 20, 0, 2.55, -75.9, { count: 3 });
    kit.pipeRun('x', 20, 0, 2.55, -86.4, { count: 2 });
    kit.wallScreen(9.93, 2.0, -78, 'w', { w: 2.8, h: 1.4 });
    kit.generator(-8.3, -84.8, 'e');
    kit.generator(8.3, -77.2, 'w');
    kit.crateStack(6.5, -85.6, { w: 1.5, h: 1.5, d: 0.9, rotY: -0.2 });
    kit.barrel(-9.0, -78);
    kit.barrel(9.0, -85);
    kit.canister(-9.2, -81.4);
    kit.canister(9.2, -80.8);
    kit.floorDecal(-3.4, -78, 'stripes', { size: 1.2 });
    kit.floorDecal(3.4, -84.2, 'stripes', { size: 1.2 });
    kit.floorLine(0, -78, 7, { axis: 'x', color: 'warn' });
    this._scorchDecal(-5.5, 0, -79.2, 1.3);
    this._scorchDecal(5.0, 0, -83, 1.1);
    // Dust around the reactor core.
    this._dustMotes(60, 0, -81, 6.5, 0.4, 2.7);

    // ── Control room (x -5..5, z -54..-64) ───────────────────────────────
    kit.floorSlab(10.6, 10.0, 0, -93.15, { lines: [{ axis: 'z', len: 8, color: 'exit' }] });
    kit.ceilingSlab(10.6, 10.0, 0, H, -93.15, {
      lamps: [
        { x: -2.6, z: 2.0, light: true, intensity: 0.8 },
        { x: 2.6, z: -2.0, light: true, intensity: 0.8 },
      ],
    });
    kit.wallRun(0.3, H, 10.3, -5.15, H / 2, -93.15);
    kit.wallRun(0.3, H, 10.3, 5.15, H / 2, -93.15);
    kit.wallRun(10.6, H, 0.3, 0, H / 2, -98.15);              // south end wall
    kit.sign(0, 2.6, -88.32, 'n', 'CONTROL ROOM', { fg: '#7fe7ff' });
    kit.consoleDesk(0, -96.6, 'n', { w: 3.2, monitors: 3 });
    kit.chair(-0.7, -95.3, 'n');
    kit.chair(0.7, -95.3, 'n');
    kit.wallScreen(0, 2.2, -97.93, 's', { w: 3.4, h: 1.5 });
    kit.serverRack(-4.6, -89.8, 'e');
    kit.serverRack(4.6, -89.8, 'w');
    kit.cabinet(-4.6, -94, 'e');
    kit.shelfUnit(4.6, -94, 'w', { w: 1.4, h: 1.8 });
    kit.fuseBox(-4.94, 1.7, -92, 'e');
    kit.extinguisher(4.94, 1.2, -90);
    kit.debrisPile(-2.6, -97.2, { s: 0.7, seed: 21 });
    kit.floorDecal(0, -94.4, 'stripes', { size: 1.4, color: '#5cff8a' });

    // Optional side rooms (lore, health pickups, relay puzzle).
    this._buildLevel1SideRooms();

    // ── Fog ───────────────────────────────────────────────────────────────
    // No fog in Level 1: keep the colour (background) but push the range far
    // beyond anything visible, so Game.js's Fog setup still works.
    this.fogColor = 0x070b12;
    this.fogNear = 2000;
    this.fogFar = 4000;
  }

  // ── Level 1 training hub (z 0 … -TRAIN_LEN) ─────────────────────────────
  //
  // Mandatory: the gate to Reception stays sealed until the jump room's relay
  // and all three shoot-room panels are live (4 power nodes, group 'train').
  //
  _buildTrainingWing() {
    const H = 3;
    const kit = this._kit;
    const m = this._mats;
    const K = L1_KEYS;
    const nb = { noBeaconLight: true };

    // ── Room A: move / look / first shot (x -4..4, z 0..-8) ──────────────
    kit.floorSlab(8.6, 8.3, 0, -4.0, { lines: [{ axis: 'z', len: 6, color: 'accent' }] });
    kit.ceilingSlab(8.6, 8.3, 0, H, -4.0, {
      lamps: [
        { x: -2, z: 2, light: true, intensity: 0.8 },
        { x: 2, z: -2 },
      ],
    });
    kit.wallRun(8.6, H, 0.3, 0, H / 2, 0.15);                  // north
    kit.wallRun(0.3, H, 8.3, -4.15, H / 2, -4.15);             // west
    kit.wallRun(0.3, H, 8.3, 4.15, H / 2, -4.15);              // east
    kit.wallRun(3.0, H, 0.3, -2.8, H / 2, -8.15);              // south (door)
    kit.wallRun(3.0, H, 0.3, 2.8, H / 2, -8.15);
    kit.doorway(2.6, 2.6, 0, 1.3, -8.15, 's');
    this._createDoor('tr-a', 2.6, 2.6, 0, 1.3, -8.15, 0, m.metalDark, nb);
    const aConduit = this._shootableTarget(0.55, 0.4, 1.7, 1.9, -7.96, 'conduit', 0);
    aConduit.userData.doorId = 'tr-a';
    kit.sign(0, 2.3, -0.02, 'n', 'TRAINING WING', { sub: 'NO RISK HERE', fg: '#7fe7ff' });
    kit.sign(-2.8, 2.4, -7.97, 's', `${K.move} — MOVE`, { sub: `${K.look} — LOOK AROUND`, fg: '#7fe7ff' });
    kit.sign(2.8, 2.6, -7.97, 's', `${K.fire} — FIRE`, { sub: 'SHOOT THE GLOWING PANEL', fg: '#ffd27f' });
    kit.crate(-1.8, -2.4, { s: 0.9, rotY: 0.2 });
    kit.crate(1.8, -4.4, { s: 0.9, rotY: -0.3 });
    kit.crate(-1.4, -6.3, { s: 0.9, rotY: 0.1 });
    kit.floorDecal(0, -1.7, 'stripes', { size: 1.6, color: '#5cff8a' }); // spawn pad
    kit.floorDecal(0.4, -3.4, 'dashes', { size: 1.2 });
    kit.floorDecal(-0.2, -5.4, 'dashes', { size: 1.2 });
    kit.floorDecal(0.2, -7.2, 'dashes', { size: 1.2 });

    // ── Link corridor (x -2..2, z -8..-12) ───────────────────────────────
    kit.floorSlab(4.3, 4.0, 0, -10.15, {});
    kit.ceilingSlab(4.3, 4.0, 0, H, -10.15, { lamps: [{ x: 0, z: 0 }] });
    kit.wallRun(0.3, H, 3.7, -2.15, H / 2, -10.15);
    kit.wallRun(0.3, H, 3.7, 2.15, H / 2, -10.15);
    kit.pipeRun('z', 3.6, -1.95, 2.55, -10.15, { count: 2, r: 0.06 });

    // ── Training hub (x -9..9, z -12..-26) ───────────────────────────────
    kit.floorSlab(18.6, 14.0, 0, -19.15, { trim: true });
    kit.ceilingSlab(18.6, 14.0, 0, H, -19.15, {
      lamps: [
        { x: -4, z: 3.0, light: true, intensity: 0.9 },
        { x: 4, z: -3.0 },
      ],
    });
    kit.wallRun(8.0, H, 0.3, -5.3, H / 2, -12.15);             // north (entry gap)
    kit.wallRun(8.0, H, 0.3, 5.3, H / 2, -12.15);
    kit.doorway(2.6, 2.6, 0, 1.3, -12.15, 's');
    kit.wallRun(8.0, H, 0.3, -5.3, H / 2, -26.15);             // south (gate)
    kit.wallRun(8.0, H, 0.3, 5.3, H / 2, -26.15);
    kit.doorway(2.6, 2.6, 0, 1.3, -26.15, 's');
    this._createDoor('tr-gate', 2.6, 2.6, 0, 1.3, -26.15, 0, m.metalDark, {
      needPower: ['tr-relay-jump', 'tr-relay-1', 'tr-relay-2', 'tr-relay-3'],
      noBeaconLight: true,
    });
    this._gappedSideWall(-9.15, -12.0, -26.3, -19.15, 2.4, H);   // west: jump room
    this._gappedSideWall(9.15, -12.0, -26.3, -19.15, 2.4, H);    // east: shoot room
    this._createDoor('tr-jump', 2.4, 2.5, -9.15, 1.25, -19.15, Math.PI / 2, m.metalDark, nb);
    this._createDoor('tr-range', 2.4, 2.5, 9.15, 1.25, -19.15, Math.PI / 2, m.metalDark, nb);
    const jc = this._shootableTarget(0.55, 0.4, -8.96, 1.9, -17.2, 'conduit', Math.PI / 2);
    jc.userData.doorId = 'tr-jump';
    const rc = this._shootableTarget(0.55, 0.4, 8.96, 1.9, -17.2, 'conduit', -Math.PI / 2);
    rc.userData.doorId = 'tr-range';
    kit.sign(-5.3, 2.4, -12.32, 'n', 'TRAINING HUB', { sub: 'FINISH BOTH ROOMS', fg: '#7fe7ff' });
    kit.sign(5.3, 2.4, -12.32, 'n', 'GATE: 4 PANELS', { sub: 'THEN IT OPENS', fg: '#ffd27f' });
    kit.sign(-5.3, 2.4, -25.97, 's', 'JUMP ROOM ◂', { sub: 'WEST — SHOOT THE PANEL', fg: '#7fe7ff' });
    kit.sign(5.3, 2.4, -25.97, 's', 'SHOOT ROOM ▸', { sub: 'EAST — SHOOT THE PANEL', fg: '#7fe7ff' });
    kit.column(0, -19.15, { h: H, r: 0.45 });
    kit.crate(-5.5, -14.6, { s: 0.8, rotY: 0.3 });
    kit.crate(5.5, -24.0, { s: 0.8, rotY: -0.2 });
    kit.floorDecal(0, -22.5, 'stripes', { size: 1.4 });
    // Optional extra practice: two valves that shut off their steam vents.
    this._trainingValve('tr-valve-a', -1, -9.0, 1.2, -14.4);
    this._trainingValve('tr-valve-b', 1, 9.0, 1.2, -23.9);

    // ── Jump room (west): hurdles, then around a corner to the relay ────
    // Hall x -9.3..-19.3, z -16.15..-22.15. The hurdles span the full width,
    // and the relay is out of sight in the chamber past them.
    kit.floorSlab(9.85, 6.0, -14.225, -19.15, { lines: [{ axis: 'x', len: 7, color: 'accent' }] });
    kit.ceilingSlab(9.85, 6.0, -14.225, H, -19.15, {
      lamps: [{ x: -3, z: 0, light: true, intensity: 0.8 }],
    });
    kit.wallRun(10.0, H, 0.3, -14.3, H / 2, -16.15);           // north
    kit.wallRun(6.9, H, 0.3, -12.75, H / 2, -22.15);           // south (chamber gap)
    kit.wallRun(0.5, H, 0.3, -19.05, H / 2, -22.15);
    kit.doorway(2.6, 2.6, -17.5, 1.3, -22.15, 's');
    kit.wallRun(0.3, H, 10.8, -19.15, H / 2, -21.4);           // west end (hall + chamber)
    for (const hx of [-11.5, -13.5, -15.5]) {
      kit.box(m.metalDark, 0.4, HURDLE_H, 5.7, hx, HURDLE_H / 2, -19.15, { physics: true });
      kit.floorDecal(hx + 0.9, -19.15, 'stripes', { size: 1.0 });
    }
    kit.sign(-12.5, 2.4, -16.32, 'n', `${K.jump} — JUMP`, { sub: 'CLEAR EVERY HURDLE', fg: '#ffd27f' });
    // Chamber (x -15.3..-19.15, z -22.15..-26.65)
    kit.floorSlab(3.85, 4.5, -17.225, -24.4, {});
    kit.ceilingSlab(3.85, 4.5, -17.225, H, -24.4, { lamps: [{ x: 0, z: 0 }] });
    kit.wallRun(0.3, H, 4.5, -15.3, H / 2, -24.4);             // east
    kit.wallRun(4.15, H, 0.3, -17.225, H / 2, -26.65);         // south end
    kit.sign(-17.2, 2.6, -26.47, 's', 'SHOOT THE PANEL', { sub: 'TO COMPLETE THIS ROOM', fg: '#ffd27f' });
    this._addPowerNode('tr-relay-jump', -17.5, 1.4, -26.44, 0, { halo: false, group: 'train' });

    // ── Shoot room (east): three panels — far, high, low ─────────────────
    // x 9.3..19.3, z -14.15..-24.15.
    kit.floorSlab(9.85, 10.0, 14.225, -19.15, { lines: [{ axis: 'x', len: 8, color: 'accent' }] });
    kit.ceilingSlab(9.85, 10.0, 14.225, H, -19.15, {
      lamps: [{ x: 0, z: 0, light: true, intensity: 0.9 }],
    });
    kit.wallRun(10.0, H, 0.3, 14.3, H / 2, -14.15);            // north
    kit.wallRun(10.0, H, 0.3, 14.3, H / 2, -24.15);            // south
    kit.wallRun(0.3, H, 10.3, 19.15, H / 2, -19.15);           // east end
    kit.sign(11.5, 2.4, -14.32, 'n', `${K.fire} — FIRE`, { sub: 'SHOOT ALL 3 PANELS', fg: '#ffd27f' });
    kit.crate(12.5, -17.0, { s: 0.8, rotY: 0.3 });
    kit.crate(11.5, -22.0, { s: 0.8, rotY: -0.2 });
    kit.barrel(17.5, -15.5);
    this._addPowerNode('tr-relay-1', 18.94, 1.3, -19.15, -Math.PI / 2, { halo: false, group: 'train' }); // far
    this._addPowerNode('tr-relay-2', 14.0, 2.3, -14.34, Math.PI, { halo: false, group: 'train' });      // high
    this._addPowerNode('tr-relay-3', 13.0, 0.5, -23.96, 0, { halo: false, group: 'train' });            // low

    // ── Gate corridor (x -2..2, z -26..-34) → Reception ──────────────────
    kit.floorSlab(4.3, 7.55, 0, -29.925, {});
    kit.ceilingSlab(4.3, 7.55, 0, H, -29.925, { lamps: [{ x: 0, z: 0 }] });
    kit.wallRun(0.3, H, 7.4, -2.15, H / 2, -29.925);
    kit.wallRun(0.3, H, 7.4, 2.15, H / 2, -29.925);
    kit.pipeRun('z', 7.2, -1.95, 2.55, -29.925, { count: 2, r: 0.06 });
    kit.cableTray('z', 7.2, 1.95, 2.6, -29.925);
    kit.floorLine(0, -27.5, 2.6, { axis: 'x', color: 'exit' });
  }

  /**
   * One optional practice valve: a steam vent plus a shootable valve on a hub
   * wall. side -1 = west wall, +1 = east wall; wallIn = the wall's inner face x.
   */
  _trainingValve(id, side, wallIn, y, z) {
    const kit = this._kit;
    kit.valveWheel(wallIn - 0.1 * side, y, z, side < 0 ? 'e' : 'w');
    const target = this._shootableTarget(0.4, 0.3, wallIn - 0.06 * side, y, z, 'hazard',
      side < 0 ? Math.PI / 2 : -Math.PI / 2);
    target.userData.ventId = id;
    this._createSteamVent(id, wallIn - 1.5 * side, 0.35, z, { count: 10 });
  }

  // ── Level 1 optional side rooms ─────────────────────────────────────────
  //
  // Positions are in the original route coordinates (via L1Z). Openings were
  // cut into the route walls by _gappedSideWall in _buildLevel1.
  //
  _buildLevel1SideRooms() {
    const H = 3;
    const kit = this._kit;
    const m = this._mats;

    // ── Break Room (east of Reception; x 5.3..11.3, z -4.65..-9.75) ──────
    // Always lit. Lore + a health pickup as the "you explored" reward.
    kit.floorSlab(5.85, 5.1, 8.225, -41.2, { lines: [{ axis: 'x', len: 4, color: 'accent' }] });
    kit.ceilingSlab(5.85, 5.1, 8.225, H, -41.2, {
      lamps: [{ x: 0, z: 0, light: true, intensity: 0.6 }],
    });
    kit.wallRun(6.0, H, 0.3, 8.3, H / 2, -38.65);          // north
    kit.wallRun(6.0, H, 0.3, 8.3, H / 2, -43.75);          // south
    kit.wallRun(0.3, H, 5.4, 11.15, H / 2, -41.2);         // east end
    kit.sign(8.3, 2.4, -38.65 - 0.17, 'n', 'NOTE TO NIGHT STAFF', { sub: 'B-7 IS RESTLESS TONIGHT', fg: '#ffd27f' });
    kit.sign(8.3, 2.4, -43.75 + 0.18, 's', 'BREAK ROOM', { sub: 'VAULT POWER: RELAYS A + B', fg: '#7fe7ff' });
    kit.wallScreen(10.93, 1.9, -41.2, 'w', { w: 2.0, h: 1.2 });
    kit.labBench(7.4, -40, 'w', { len: 1.8 });
    kit.cabinet(6.6, -43.1, 'n');
    kit.shelfUnit(10.2, -43.1, 'n', { w: 1.4, h: 1.8 });
    kit.crate(6.2, -39.3, { s: 0.7, rotY: 0.3 });
    kit.barrel(10.6, -39.3);
    kit.extinguisher(10.9, 1.2, -39.1);
    this._addPickup('l1-health-lounge', 'health', 9.3, -41.6, { amount: 25 });

    // ── Equipment Nook (west of C1; x -2.3..-6.3, z -12.9..-17.1) ────────
    // Dark until Relay A is shot; the relay panel glows red so it can be found.
    const nookLight = this._powerLight(-4.2, 2.5, -49, 0xbfe6ff, 0.9, 8);
    kit.floorSlab(3.85, 4.2, -4.225, -49, {});
    kit.ceilingSlab(3.85, 4.2, -4.225, H, -49, { lamps: [{ x: 0, z: 0 }] });
    kit.wallRun(4.0, H, 0.3, -4.3, H / 2, -46.9);          // north
    kit.wallRun(4.0, H, 0.3, -4.3, H / 2, -51.1);          // south
    kit.wallRun(0.3, H, 4.5, -6.15, H / 2, -49);         // west end
    kit.sign(-4.3, 2.3, -51.1 + 0.18, 's', 'RELAY A — OFFLINE', { sub: 'SHOOT THE PANEL', fg: '#ff8f7f' });
    kit.crate(-3.5, -47.6, { s: 0.7, rotY: 0.4 });
    kit.barrel(-3.3, -50.6);
    kit.canister(-5.6, -47.5);
    kit.debrisPile(-5.5, -50.5, { s: 0.6, seed: 51 });
    this._addPowerNode('l1-relay-a', -5.94, 1.4, -49, Math.PI / 2, {
      lights: [nookLight], doorIds: ['l1-vault'], halo: false,
    });

    // ── Lab Annex (east of the Laboratory; x 9.3..14.3, z -22.7..-27.3) ──
    // Dark until Relay B is shot. Also holds a health pickup.
    const annexLight = this._powerLight(11.7, 2.5, -59, 0xbfe6ff, 0.9, 8);
    const vaultLight = this._powerLight(5.3, 2.5, -49, 0xffd9a0, 0.9, 8);
    kit.floorSlab(4.85, 4.6, 11.725, -59, {});
    kit.ceilingSlab(4.85, 4.6, 11.725, H, -59, { lamps: [{ x: 0, z: 0 }] });
    kit.wallRun(5.0, H, 0.3, 11.8, H / 2, -56.7);          // north
    kit.wallRun(5.0, H, 0.3, 11.8, H / 2, -61.3);          // south
    kit.wallRun(0.3, H, 5.0, 14.15, H / 2, -59);         // east end
    kit.sign(11.7, 2.4, -61.3 + 0.18, 's', 'RELAY B — OFFLINE', { sub: 'VAULT NEEDS BOTH RELAYS', fg: '#ff8f7f' });
    kit.shelfUnit(11.9, -60.9, 'n', { w: 1.4, h: 1.8 });
    kit.cabinet(10.3, -60.9, 'n');
    kit.crateStack(13.2, -57.6, { w: 1.2, h: 1.2, d: 0.8, rotY: 0.2 });
    kit.canister(10.0, -57.3);
    kit.barrel(10.1, -60.2);
    this._addPickup('l1-health-annex', 'health', 11.4, -58.4, { amount: 25 });
    this._addPowerNode('l1-relay-b', 13.94, 1.4, -59, -Math.PI / 2, {
      lights: [annexLight, vaultLight], doorIds: ['l1-vault'], halo: false,
    });

    // ── Records Vault (east of C1; x 2.3..8.3, z -12.45..-17.55) ─────────
    // Door opens only when Relay A and Relay B are both live.
    kit.floorSlab(6.0, 5.1, 5.3, -49, {});
    kit.ceilingSlab(6.0, 5.1, 5.3, H, -49, { lamps: [{ x: 0, z: 0 }] });
    kit.wallRun(6.0, H, 0.3, 5.3, H / 2, -46.45);          // north
    kit.wallRun(6.0, H, 0.3, 5.3, H / 2, -51.55);          // south
    kit.wallRun(0.3, H, 5.4, 8.15, H / 2, -49);          // east end
    this._createDoor('l1-vault', 2.4, 2.5, 2.15, 1.25, -49, Math.PI / 2, m.metalDark, {
      needPower: ['l1-relay-a', 'l1-relay-b'],
    });
    kit.sign(5.3, 2.3, -51.55 + 0.18, 's', 'LOG 07 — DR. MOKOENA', { sub: 'IT WAS NEVER MEANT TO WAKE', fg: '#ffd27f' });
    kit.sign(5.3, 2.3, -46.45 - 0.17, 'n', 'FINAL ENTRY', { sub: 'IF YOU READ THIS, RUN', fg: '#ff8f7f' });
    kit.serverRack(7.6, -47.4, 'w');
    kit.serverRack(7.6, -50.6, 'w');
    kit.wallScreen(7.93, 2.0, -49, 'w', { w: 2.2, h: 1.2 });
    kit.cabinet(3.4, -50.9, 'n');
    kit.shelfUnit(5.4, -50.9, 'n', { w: 1.4, h: 1.8 });
    kit.crate(3.6, -47.2, { s: 0.7, rotY: 0.2 });
    this._addPickup('l1-health-vault', 'health', 5.6, -48.6, { amount: 50 });
    this._dustMotes(30, 5.3, -49, 2.4, 0.3, 2.6);
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
    // Dying bulbs over the quarters — one right on the monster's route.
    this._flickerLight(0, 2.55, -25.5, 0xffaa66, 1.1, 7);
    this._flickerLight(-6.4, 2.55, -20.5, 0xffaa66, 0.8, 6);
    // Dusty beam through the ceiling gap the fallen panel dropped from.
    this._lightShaft(1.8, 0.45, -26.4, 2.6, 0xffd9a0, 0.9);
    this._dustMotes(80, 0, -24, 7, 0.3, 2.8);

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
      smoke: false,
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
      smoke: false,
    });
    // Flicker bulb in the rack maze's far corner + hanging dust.
    this._flickerLight(-6.5, 2.55, -50.5, 0xffaa66, 0.8, 6);
    this._dustMotes(60, 0, -46, 6.5, 0.3, 2.7);
    kit.canister(4.1, -43.2);

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
    // Dying red strobes over the arena centre and the failsafe seal — the
    // boss's patrol loop runs right beneath both.
    this._flickerLight(0, 3.3, -26.5, 0xff3311, 1.5, 10);
    this._flickerLight(0, 3.3, -40.5, 0xff4422, 1.1, 8);
    this._flickerLight(-9, 3.3, -14.5, 0xff5533, 0.9, 8);
    // Ash and dust hanging in the emergency light.
    this._dustMotes(90, 0, -26, 12, 0.4, 3.6);
    kit.barrel(6.9, -19.6);
    kit.canister(-6.6, -35.4);

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