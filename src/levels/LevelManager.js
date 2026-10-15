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
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import LevelKit from './LevelKit.js';
import StaticBatch from './StaticBatch.js';
import LabChamber from './LabChamber.js';
import HealthPack from './HealthPack.js';
import { getThemeMaterials } from './LevelMaterials.js';
import { createWorker } from '../core/CharacterFactory.js';

// ── Shared scorch decal texture (created once, kept for the session) ────────
let _scorchTex = null;
let _steamTex = null;
function steamTexture() {
  if (_steamTex) return _steamTex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.42)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  _steamTex = new THREE.CanvasTexture(canvas);
  return _steamTex;
}
let _fireTex = null;
function fireTexture() {
  if (_fireTex) return _fireTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  // Broad outer glow: a hot core cooling to deep orange at the edge.
  let g = x.createRadialGradient(64, 64, 1, 64, 64, 63);
  g.addColorStop(0, 'rgba(255,244,214,0.98)');
  g.addColorStop(0.28, 'rgba(255,196,110,0.72)');
  g.addColorStop(0.62, 'rgba(255,132,44,0.28)');
  g.addColorStop(1, 'rgba(180,50,10,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  // Off-centre white-hot core so the flame is not a symmetric disc.
  x.globalCompositeOperation = 'lighter';
  g = x.createRadialGradient(60, 72, 1, 60, 72, 30);
  g.addColorStop(0, 'rgba(255,255,244,0.95)');
  g.addColorStop(0.5, 'rgba(255,222,150,0.45)');
  g.addColorStop(1, 'rgba(255,180,90,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  // A few warm lobes break the smooth falloff into an organic silhouette.
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 10 + Math.random() * 34;
    const px = 64 + Math.cos(a) * r, py = 60 + Math.sin(a) * r * 0.8;
    const rr = 8 + Math.random() * 20;
    const lg = x.createRadialGradient(px, py, 0, px, py, rr);
    lg.addColorStop(0, 'rgba(255,168,70,0.22)');
    lg.addColorStop(1, 'rgba(255,168,70,0)');
    x.fillStyle = lg;
    x.fillRect(0, 0, S, S);
  }
  x.globalCompositeOperation = 'source-over';
  _fireTex = new THREE.CanvasTexture(c);
  return _fireTex;
}
let _smokeTex = null;
function smokeTexture() {
  if (_smokeTex) return _smokeTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  // A billowy puff built from overlapping soft blobs, so smoke reads as a
  // roiling cloud rather than a single hard disc.
  const blobs = [
    [64, 58, 48], [46, 70, 34], [84, 68, 33], [64, 42, 30],
    [54, 90, 26], [80, 92, 24], [40, 50, 22], [90, 52, 22],
  ];
  for (const [bx, by, br] of blobs) {
    const g = x.createRadialGradient(bx, by, 0, bx, by, br);
    g.addColorStop(0, 'rgba(255,255,255,0.34)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.13)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
  }
  _smokeTex = new THREE.CanvasTexture(c);
  return _smokeTex;
}
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
let _sootTex = null;
function sootTexture() {
  if (_sootTex) return _sootTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  // Soot plume: dense blotches near the base thinning upward, so it reads as
  // a fire that blackened the surface above it rather than a flat circle.
  for (let i = 0; i < 60; i++) {
    const bx = 64 + (Math.random() - 0.5) * 74;
    const by = S - Math.random() * S;
    const br = 6 + Math.random() * 26;
    const g = x.createRadialGradient(bx, by, 0, bx, by, br);
    const a = 0.10 + 0.30 * Math.random() * (1 - (by / S) * 0.7);
    g.addColorStop(0, `rgba(10,7,5,${a.toFixed(3)})`);
    g.addColorStop(1, 'rgba(10,7,5,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
  }
  // Vertical smears add streaking detail.
  for (let i = 0; i < 22; i++) {
    const bx = 64 + (Math.random() - 0.5) * 84;
    const g = x.createLinearGradient(0, S, 0, 0);
    g.addColorStop(0, 'rgba(8,5,3,0.28)');
    g.addColorStop(1, 'rgba(8,5,3,0)');
    x.fillStyle = g;
    x.fillRect(bx - 1.5, 0, 3, S);
  }
  _sootTex = new THREE.CanvasTexture(c);
  return _sootTex;
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
    this.navigationBounds = null;
    this.navigationVersion = 0;
    this.healthPacks = [];
    this.escapeRoute = [];

    /** L2 staging-bay sidearm pickup {x, z, radius, mesh, light, taken}. */
    this.weaponPickup = null;

    /** Static fallen-worker figures (L2 storytelling) — traverse-disposed. */
    this._casualties = [];
    this.serverAmbush = null;

    /**
     * Live mission-directive board (rebuilt per level): Game.js mirrors every
     * objective change onto it so the level goal is also written in the world.
     * It owns a canvas texture, so teardown must call its dispose().
     */
    this.goalBoard = null;

    /** Heat-haze zone meshes — ShaderManager swaps in the haze material. */
    this.heatHazeZones = [];

    /** Animated sliding doors (rebuilt each load). */
    this._doors = [];

    /** Steam/spark vent emitters with pre-allocated sprite pools. */
    this._steamVents = [];

    /** Fire + smoke emitters {id, x, y, z, flames, smoke, light...} (rebuilt each load). */
    this._fires = [];

    /** Rotating hazard meshes {mesh, speed} (rebuilt each load). */
    this._rotatingHazards = [];

    /** Dust-mote Points clouds with a slow drift (rebuilt each load). */
    this._dustFields = [];

    /** Meshes the dissolve shader fades during the L3 collapse. */
    this._dissolveWalls = [];

    /**
     * Walking staff NPCs (Level 1 pre-breach ambience): CharacterFactory
     * workers on patrol loops. Game.js calls evacuateWalkers() when the
     * mutation alarm sounds; teardown disposes their per-instance
     * geometries/materials (worker models are built fresh per level).
     */
    this._walkers = [];

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

    /**
     * Realistic human crowd model (three.js sample soldier.glb). Loaded once,
     * then SkeletonUtils-cloned per NPC so every figure has its own skeleton
     * and Walk/Run animation. Null until ready — walkers fall back to the
     * procedural workers meanwhile (or permanently, if the fetch fails).
     */
    this._humanTemplate = null;
    this._loadHumanTemplate();

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

    const excluded = new Set([
      ...this._rotatingHazards.map(entry => entry.mesh),
      ...this._doors.map(entry => entry.mesh),
      ...this._dissolveWalls,
      ...this.heatHazeZones,
      ...this.shootables,
    ]);
    // The sidearm pickup must stay a real, hideable mesh — once merged into
    // a static batch it would keep rendering after the player takes it.
    if (this.weaponPickup?.mesh) {
      this.weaponPickup.mesh.traverse(object => excluded.add(object));
    }
    const roots = this._disposables.map(entry => entry.mesh)
      .filter(mesh => mesh?.userData.staticScenery);
    this._staticBatch = new StaticBatch(this.scene, roots, excluded);
    this.batchStats = this._staticBatch.stats;

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
    for (const pack of this.healthPacks) pack.dispose();
    this.healthPacks = [];
    this.escapeRoute = [];
    this.weaponPickup = null;
    // Casualties own their geometries/materials like walkers — traverse-dispose.
    for (const figure of this._casualties) {
      this.scene.remove(figure);
      figure.traverse((child) => {
        if (!child.isMesh) return;
        if (child.geometry) child.geometry.dispose();
        const mat = child.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
    }
    this._casualties = [];
    this.serverAmbush = null;
    this.labChamber?.dispose();
    this.labChamber = null;
    this.goalBoard?.dispose();
    this.goalBoard = null;
    this.labEmergency = false;
    this.labRoute = [];
    this._staticBatch?.dispose();
    this._staticBatch = null;
    for (const entry of this._disposables) {
      if (entry.body) this.physics.removeBody(entry.body);
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
    this.navigationBounds = null;
    this.heatHazeZones = [];
    this._doors = [];
    this._steamVents = [];
    this._fires = [];
    this._rotatingHazards = [];
    this._dustFields = [];
    this._dissolveWalls = [];
    this._exitDoor = null;
    this.scriptedReveal = null;
    this.npcAnchors = {};
    this._flickerLights = [];
    this.collapseMode = false;

    // Procedural worker NPCs own their geometries/materials (built fresh per
    // level) — traverse-dispose them. Shared cached textures (bump map)
    // survive material.dispose() by design. Human crowd clones (soldier.glb)
    // instead carry kitShared: keep their shared geometry/material caches and
    // dispose only the per-instance tinted material clone.
    for (const w of this._walkers) {
      this.scene.remove(w.npc.group);
      w.npc.dispose?.();
      w.npc.group.traverse((child) => {
        if (!child.isMesh) return;
        if (child.userData.kitShared) {
          if (child.userData.ownsMaterial && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const m of mats) m?.dispose();
          }
          return;
        }
        if (child.geometry) child.geometry.dispose();
        const mat = child.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
    }
    this._walkers = [];
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
   * Sliding door that opens when triggered (E at the panel, or by shooting
   * its linked target). Slides up (Y+) and its collision body is removed
   * once fully open.
   *
   * opts.locked — true for scripted doors (the L3 failsafe seal): no button
   * panel is placed and E interaction ignores them; Game.js opens these.
   */
  _createDoor(id, w, h, x, y, z, rotY, mat, opts = {}) {
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
      locked: !!opts.locked,
    });
    // Glowing button plate beside the frame — the E-interaction affordance
    // (proud of the wall face the player approaches from). All doors are
    // rotY 0 on a south-facing wall, so a fixed offset works.
    if (!opts.locked) {
      this._kit.box(this._mats.accent, 0.18, 0.26, 0.07,
        x - w / 2 - 0.45, 1.15, z + 0.19, { cast: false });
    }
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
        map: steamTexture(), blending: o.rise < 0 ? THREE.AdditiveBlending : THREE.NormalBlending,
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

  /**
   * Fire + smoke emitter. Additive flames sit at the base while a separate
   * pool of dark smoke sprites billows up and away; an optional flicker
   * PointLight throws the burning glow onto nearby geometry.
   */
  _createFire(id, x, y, z, o = {}) {
    const nf = o.flames === undefined ? 10 : o.flames;
    const ns = o.smoke === undefined ? 12 : o.smoke;
    const flames = [];
    for (let i = 0; i < nf; i++) {
      const mat = new THREE.SpriteMaterial({
        map: fireTexture(), color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Sprite(mat);
      s.scale.set(0.4, 0.4, 1);
      s.position.set(x, y, z);
      s.visible = false;
      s.userData.ownsMaterial = true; // Sprite shares its geometry — do not dispose it
      this.scene.add(s);
      this._track(s);
      flames.push(s);
    }
    const smoke = [];
    for (let i = 0; i < ns; i++) {
      const mat = new THREE.SpriteMaterial({
        map: smokeTexture(), color: 0x2b2b2c, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.NormalBlending,
      });
      const s = new THREE.Sprite(mat);
      s.scale.set(0.7, 0.7, 1);
      s.position.set(x, y, z);
      s.visible = false;
      s.userData.ownsMaterial = true;
      this.scene.add(s);
      this._track(s);
      smoke.push(s);
    }
    const ne = o.embers === undefined ? 8 : o.embers;
    const embers = [];
    for (let i = 0; i < ne; i++) {
      const mat = new THREE.SpriteMaterial({
        map: fireTexture(), color: 0xffb24a, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Sprite(mat);
      s.scale.set(0.05, 0.05, 1);
      s.position.set(x, y, z);
      s.visible = false;
      s.userData.ownsMaterial = true;
      this.scene.add(s);
      this._track(s);
      embers.push(s);
    }
    if (o.light !== false) {
      this._flickerLight(x, y + 0.7, z, o.color ?? 0xff7020, o.intensity ?? 1.1, o.range ?? 10);
    }
    this._fires.push({
      id, x, y, z, flames, smoke, embers,
      fIdx: 0, sIdx: 0, eIdx: 0, ft: 0, st: 0, et: 0, t: Math.random() * 10,
      fRate: o.fRate || 0.07, sRate: o.sRate || 0.17, eRate: o.eRate || 0.05,
      rise: o.rise || 2.1, scale: o.scale || 1,
      fLife: new Float32Array(nf), fVy: new Float32Array(nf), fMax: new Float32Array(nf),
      sLife: new Float32Array(ns), sVy: new Float32Array(ns), sMax: new Float32Array(ns),
      eLife: new Float32Array(ne), eVy: new Float32Array(ne), eMax: new Float32Array(ne),
    });
  }

  /** Disable a steam vent by id (stops particle spawning). */
  disableVent(id) {
    const vent = this._steamVents.find(v => v.id === id);
    if (!vent || !vent.active) return false;
    vent.active = false;
    if (this.currentLevel === 2 && this.pressureReleased) this.openDoor('l2-pressure');
    return true;
  }

  get pressureReleased() {
    let count = 0;
    for (const vent of this._steamVents) {
      if ((vent.id === 'l2-vent-2' || vent.id === 'l2-vent-3') && !vent.active) count++;
    }
    return count === 2;
  }

  revealEscapeRoute() {
    for (const guide of this.escapeRoute) guide.visible = true;
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
   * Soot stain on a ceiling above a fire (own geometry/material, disposed on
   * teardown). rotZ spins the plume within the ceiling plane.
   */
  _ceilingSoot(x, y, z, size, rotZ = 0) {
    const mat = new THREE.MeshBasicMaterial({
      map: sootTexture(), transparent: true, opacity: 0.9,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(Math.PI / 2, 0, rotZ); // face downward
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
        door.body.aabbNeedsUpdate = true;
        this.physics.world.broadphase.dirty = true;
        if (door.progress >= 1) {
          this.physics.removeBody(door.body);
          this.navigationVersion++;
        }
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
        const sc = v.rise < 0 ? 0.06 + (1 - t) * 0.06 : 0.25 + (1 - t) * 0.55;
        s.scale.set(sc, sc, 1);
      }
    }

    // Fire + smoke: flames rise and cool to red; smoke billows and fades;
    // embers pop off the base and flicker as they climb. A slow per-fire
    // turbulence term sways the whole column so it never looks like a jet.
    for (const f of this._fires) {
      const sc = f.scale;
      f.t += dt;
      const turb = Math.min(dt, 0.05);
      f.ft += dt;
      while (f.flames.length && f.ft >= f.fRate) {
        f.ft -= f.fRate;
        const i = f.fIdx = (f.fIdx + 1) % f.flames.length;
        const s = f.flames[i];
        f.fLife[i] = f.fMax[i] = 0.5 + Math.random() * 0.35;
        f.fVy[i] = f.rise * (0.8 + Math.random() * 0.5);
        s.position.set(f.x + (Math.random() - 0.5) * 0.5 * sc, f.y + Math.random() * 0.15, f.z + (Math.random() - 0.5) * 0.5 * sc);
        s.visible = true;
      }
      f.st += dt;
      while (f.smoke.length && f.st >= f.sRate) {
        f.st -= f.sRate;
        const i = f.sIdx = (f.sIdx + 1) % f.smoke.length;
        const s = f.smoke[i];
        f.sLife[i] = f.sMax[i] = 1.4 + Math.random() * 1.1;
        f.sVy[i] = f.rise * (0.4 + Math.random() * 0.3);
        s.position.set(f.x + (Math.random() - 0.5) * 0.7 * sc, f.y + 0.5 * sc, f.z + (Math.random() - 0.5) * 0.7 * sc);
        s.visible = true;
      }
      f.et += dt;
      while (f.embers.length && f.et >= f.eRate) {
        f.et -= f.eRate;
        const i = f.eIdx = (f.eIdx + 1) % f.embers.length;
        const s = f.embers[i];
        f.eLife[i] = f.eMax[i] = 0.7 + Math.random() * 0.9;
        f.eVy[i] = (1.6 + Math.random() * 1.8) * sc;
        s.position.set(f.x + (Math.random() - 0.5) * 0.5 * sc, f.y + 0.1, f.z + (Math.random() - 0.5) * 0.5 * sc);
        s.visible = true;
      }
      for (let i = 0; i < f.flames.length; i++) {
        if (f.fLife[i] <= 0) continue;
        f.fLife[i] -= dt;
        const s = f.flames[i];
        if (f.fLife[i] <= 0) { s.visible = false; s.material.opacity = 0; continue; }
        s.position.y += f.fVy[i] * dt;
        s.position.x += Math.sin(f.t * 1.8 + i) * turb * sc * 0.6;
        s.position.z += Math.cos(f.t * 1.4 + i * 1.3) * turb * sc * 0.6;
        const t = f.fLife[i] / f.fMax[i];
        s.material.opacity = t * 0.55;
        s.material.color.setRGB(0.85 + 0.15 * t, 0.18 + 0.62 * t, 0.03 + 0.25 * t * t);
        const p = (0.24 + (1 - t) * 0.4) * sc;
        s.scale.set(p, p, 1);
      }
      for (let i = 0; i < f.smoke.length; i++) {
        if (f.sLife[i] <= 0) continue;
        f.sLife[i] -= dt;
        const s = f.smoke[i];
        if (f.sLife[i] <= 0) { s.visible = false; s.material.opacity = 0; continue; }
        s.position.y += f.sVy[i] * dt;
        s.position.x += Math.sin(f.t * 0.9 + i * 0.7) * turb * sc * 1.1;
        s.position.z += Math.cos(f.t * 0.7 + i * 1.1) * turb * sc * 1.1;
        const t = f.sLife[i] / f.sMax[i];
        s.material.opacity = t * (1 - t) * 2.4;
        const p = (0.7 + (1 - t) * 1.5) * sc;
        s.scale.set(p, p, 1);
      }
      for (let i = 0; i < f.embers.length; i++) {
        if (f.eLife[i] <= 0) continue;
        f.eLife[i] -= dt;
        const s = f.embers[i];
        if (f.eLife[i] <= 0) { s.visible = false; s.material.opacity = 0; continue; }
        s.position.y += f.eVy[i] * dt;
        s.position.x += Math.sin(f.t * 6 + i) * turb * sc * 0.5;
        const t = f.eLife[i] / f.eMax[i];
        s.material.opacity = t * (0.55 + 0.4 * Math.sin(f.t * 40 + i));
        const p = (0.03 + (1 - t) * 0.05) * sc;
        s.scale.set(p, p, 1);
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

    // Walking staff NPCs (patrol loops; flee once the alarm sounds).
    this._updateWalkers(dt);

    // Flickering lights — dying fluorescents. Each fixture idles for a few
    // seconds, then stutters for a short burst. During the Level-3 collapse
    // (collapseMode) bursts come thick and fast.
    const haste = this.collapseMode ? 0.22 : 1;
    for (const f of this._flickerLights) {
      if (this.currentLevel === 1 && !this.labEmergency) {
        f.light.intensity = f.base;
        continue;
      }
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

  // ── Walking staff NPCs ─────────────────────────────────────────────────────

  /**
   * Spawn a worker NPC on a patrol loop. Paths must stay on walkable floor
   * (walkers have no physics — they are ambience, not obstacles). After the
   * loop's last point they cycle back to the first, so a two-point path
   * reads as pacing and a 4-point ring as a proper patrol.
   *
   * @param {'tech'|'coat'|'supervisor'|'security'} variant
   * @param {{x:number,z:number}[]} path  patrol loop, ≥2 points
   * @param {{speed?:number, human?:boolean, npc?:object}} [o]  human:false or an
   *        explicit npc overrides the default realistic human figure
   */
  _addWalker(variant, path, o = {}) {
    // Realistic human (soldier.glb clone) by default, procedural worker as the
    // fallback while the template is still loading or if it failed entirely.
    const npc = o.npc
      || (o.human === false ? createWorker(variant) : (this._createHumanNpc() || createWorker(variant)));
    npc.group.position.set(path[0].x, 0, path[0].z);
    this.scene.add(npc.group);
    const walker = {
      npc,
      path,
      idx: 1,                       // next waypoint index
      speed: o.speed || 0.85 + Math.random() * 0.35,
      pause: Math.random() * 1.5,   // idle before the first leg
      state: 'patrol',              // 'patrol' | 'flee' | 'gone'
      fleeRoute: null,
      fleeSpeed: 3.1,
      // Reused per frame — the zero-allocation rule.
      animState: { moving: false, speed: 1, fleeing: false },
    };
    this._walkers.push(walker);
    return walker;
  }

  /**
   * A panicked staff member fleeing continuously through a chaos area. Unlike
   * evacuateWalkers() the loop never ends, so Level 3 always reads as a crowd
   * running for their lives. Reuses the worker's `fleeing` animation (forward
   * lean, pumping arms, glances back over the shoulder).
   */
  _addPanicRunner(path, o = {}) {
    const w = this._addWalker(o.variant || 'tech', path, {
      speed: o.speed || 3.4 + Math.random() * 1.3,
      human: o.human,
    });
    w.state = 'flee';
    w.fleeRoute = path;
    w.fleeSpeed = w.speed;
    w.loopFlee = true;          // cycle the route forever instead of leaving
    w.pause = Math.random() * 1.6;
    w.idx = path.length > 1 ? 1 : 0;
    // Crowd NPCs are ambience — drop their shadow casting to keep the already
    // heavy Level-3 frame budget in check.
    w.npc.group.traverse((c) => { if (c.isMesh) c.castShadow = false; });
    return w;
  }

  /** Fetch the realistic human model once; failure falls back to workers. */
  _loadHumanTemplate() {
    this._gltfLoader.loadAsync('models/soldier.glb')
      .then((gltf) => {
        this._humanTemplate = { scene: gltf.scene, animations: gltf.animations || [] };
      })
      .catch(() => {
        console.warn('[LevelManager] soldier.glb unavailable — crowd uses procedural workers');
      });
  }

  /**
   * Build one realistic human NPC by SkeletonUtils-cloning the loaded
   * soldier.glb template, so each figure gets its own skeleton and Walk/Run
   * animation blend. Returns the same { group, update } shape as
   * createWorker() (plus dispose()), or null while the template is still
   * loading / if it failed — callers then fall back to the procedural worker.
   */
  _createHumanNpc() {
    const tpl = this._humanTemplate;
    if (!tpl) return null;

    const model = SkeletonUtils.clone(tpl.scene);
    // soldier.glb is authored facing -Z; the walker yaw convention faces +Z.
    model.rotation.y = Math.PI;
    model.scale.setScalar(0.94 + Math.random() * 0.12);
    const tint = new THREE.Color().setHSL(
      Math.random(), 0.16 + Math.random() * 0.18, 0.44 + Math.random() * 0.15);
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = false;      // crowd ambience — spare the frame budget
      child.receiveShadow = true;
      child.frustumCulled = false;   // skinned bounds — never pop out of view
      // Geometry + textures stay in the shared soldier.glb cache; only the
      // material is cloned per instance so each figure can be tinted.
      child.userData.kitShared = true;
      const src = child.material;
      if (!src) return;
      const cloneOne = (m) => { const c = m.clone(); if (c.color) c.color.multiply(tint); return c; };
      child.material = Array.isArray(src) ? src.map(cloneOne) : cloneOne(src);
      child.userData.ownsMaterial = true;
    });

    const mixer = new THREE.AnimationMixer(model);
    const actions = [];
    for (const name of ['Walk', 'Run']) {
      const clip = THREE.AnimationClip.findByName(tpl.animations, name);
      if (!clip) continue;
      const action = mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(0);
      if (name === 'Run') action.time = Math.random() * clip.duration;
      actions.push({ action, run: name === 'Run' });
    }

    const group = new THREE.Group();
    group.add(model);

    return {
      group,
      update(dt, st) {
        if (!actions.length) return;
        const moving = !!(st && st.moving);
        const running = moving && (st.fleeing || (st.speed || 0) > 2.2);
        const only = actions.length === 1;
        for (const a of actions) {
          // Run drives the panic crowd, Walk the idle patrol — blend so a
          // state change never snaps the pose.
          const want = only ? 1 : (running ? (a.run ? 1 : 0) : (a.run ? 0 : 1));
          const w = a.action.getEffectiveWeight();
          a.action.setEffectiveWeight(w + (want - w) * Math.min(1, dt * 7));
        }
        // Hold the pose during a walker's brief pause rather than moonwalking.
        mixer.update(moving ? dt : 0);
      },
      dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); },
    };
  }

  /**
   * Place a fallen worker — static storytelling scenery (the breach's human
   * cost). The joint pose is set once by part name (update() is never
   * called) and the figure is laid on its back, then spun to place it.
   * Ownership matches walkers: per-instance geometry/materials,
   * traverse-disposed in teardown.
   */
  _addCasualty(variant, x, z, rotY = 0, o = {}) {
    const npc = createWorker(variant);
    const g = npc.group;
    const pose = o.pose || {
      torso: [0.04, 0, 0], head: [0.18, 0.55, 0],
      armL: [-0.5, 0, 1.05], elbL: [-0.65, 0, 0],
      armR: [0.35, 0, -0.85], elbR: [-0.55, 0, 0],
      legL: [0.22, 0, 0.26], kneeL: [-0.45, 0, 0],
      legR: [-0.06, 0, -0.32], kneeR: [0.3, 0, 0],
    };
    g.traverse((child) => {
      const p = pose[child.name];
      if (p) child.rotation.set(p[0], p[1], p[2]);
    });
    g.position.set(x, o.y ?? 0.16, z);
    g.rotation.set(0, rotY, Math.PI / 2);
    this.scene.add(g);
    this._track(g);
    this._casualties.push(g);
    return g;
  }

  /**
   * Send every walker running for the level entrance (Game.js calls this
   * when the Level-1 mutation alarm sounds). Staff south of the lab arch
   * route through the corridor mouth first; the rest run straight up the
   * x=0 centre line, which is clear all the way to the entrance.
   */
  evacuateWalkers() {
    for (const w of this._walkers) {
      if (w.state === 'gone') continue;
      w.state = 'flee';
      w.pause = 0;
      w.idx = 0;
      w.fleeRoute = w.npc.group.position.z < -20
        ? [{ x: 0, z: -19.8 }, { x: 0, z: -0.6 }]
        : [{ x: 0, z: -0.6 }];
    }
  }

  /** Advance walkers along their route (patrol pause, flee run). */
  _updateWalkers(dt) {
    for (const w of this._walkers) {
      if (w.state === 'gone') continue;
      const st = w.animState;
      st.moving = false;
      st.fleeing = w.state === 'flee';

      if (w.pause > 0) {
        w.pause -= dt;
      } else {
        const route = w.state === 'flee' ? w.fleeRoute : w.path;
        const target = route[w.idx];
        if (target) {
          const g = w.npc.group;
          const dx = target.x - g.position.x;
          const dz = target.z - g.position.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const spd = w.state === 'flee' ? w.fleeSpeed : w.speed;
          if (dist < 0.25) {
            w.idx++;
            if (w.state === 'flee') {
              if (w.idx >= route.length) {
                if (w.loopFlee) {
                  w.idx = 0;                 // keep the crowd panicking forever
                } else {
                  // Reached the entrance — staff have left the level.
                  w.state = 'gone';
                  g.visible = false;
                }
              }
            } else if (w.idx >= route.length) {
              w.idx = 0;                        // loop the patrol
              w.pause = 1 + Math.random() * 2.4; // look around a moment
            }
          } else {
            const step = Math.min(spd * dt, dist);
            g.position.x += (dx / dist) * step;
            g.position.z += (dz / dist) * step;
            st.moving = true;
            st.speed = spd;
            // Face the direction of travel (shortest-arc turn).
            const targetYaw = Math.atan2(dx, dz);
            let d = targetYaw - g.rotation.y;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            g.rotation.y += d * Math.min(1, dt * 8);
          }
        }
      }
      w.npc.update(dt, st);
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
      { x: 0, z: -68.4, radius: 1.7 }, // surface-lift lobby, past the bypass door
    ];
    this._monsterWaypoints = []; // L1 monster is a scripted cameo (see below)

    // Scripted reveal data (Game.js runs the beat; level just supplies it).
    // Repair restores power, ruptures containment and exposes the scientist.
    // Game runs the transformation and emergency bypass sequence.
    this.scriptedReveal = {
      trigger: { x: 0, z: -22.0, radius: 2.8 },   // entering reveals the repair objective
      spawn: { x: -5.6, y: 0.65, z: -25.2 },
      escape: [                                     // flees toward the SE duct
        { x: -5.6, z: -23.4 },
        { x: -1.5, z: -23.4 },
        { x: 3.4, z: -27.5 },
        { x: 6.5, z: -30.8 },
      ],
    };
    this.npcAnchors = {
      scientist: { x: -5.6, z: -25.2, face: 'w' },
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
    kit.sign(0, 2.4, -0.02, 'n', 'SECTOR A / ENGINEERING', { sub: 'SERVICE CALL 09 — LAB A-2', fg: '#bde9e7', w: 3.4 });
    kit.sign(0, 2.45, -9.97, 's', 'LAB A-2 / AUXILIARY POWER', { sub: 'MAINTENANCE REQUEST — FOLLOW BLUE LINE', fg: '#ffc57c', w: 3.0 });
    kit.consoleDesk(-3.6, -5.0, 'e', { w: 1.8, monitors: 1 });
    kit.crateStack(4.0, -3.2, { w: 1.2, h: 1.2, d: 0.8, rotY: 0.3 });
    kit.crate(4.3, -6.0, { s: 0.7, rotY: 0.4 });
    kit.fuseBox(-4.94, 1.7, -8.5, 'e');
    kit.extinguisher(-4.94, 1.2, -3.0);
    kit.floorDecal(3.2, -5.0, 'stripes', { size: 1.2 });
    // Station status board greeting the arriving shift engineer.
    kit.wallScreen(4.93, 1.9, -4.6, 'w', { w: 2.2, h: 1.2 });
    // Mission directive board beside the reception's south exit: the in-world
    // copy of the objective, so the goal is readable on the wall, not only HUD.
    this.goalBoard = kit.goalBoard(-3.2, 1.95, -9.94, 's', {
      tag: 'SECTOR A / LEVEL 01',
    });

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
    kit.sign(0, 2.3, -19.97, 's', 'A-2 / CULTURE RESEARCH', { sub: 'AUXILIARY POWER OFFLINE', fg: '#ffc57c', w: 2.4 });
    kit.fuseBox(-1.94, 1.6, -12.5, 'e');
    kit.ventGrille(-1.95, 2.2, -17.5, 'e', { w: 0.8, h: 0.5 });
    kit.gaugeCluster(-1.96, 1.6, -14.2, 'e');

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
    const l1Conduit = this._shootableTarget(0.65, 0.45, -1.1, 1.3, -24.7, 'conduit', 0);
    l1Conduit.material.color.setHex(0xffb65b);
    l1Conduit.material.emissive.setHex(0xff9839);
    l1Conduit.userData.storyAction = 'restore-lab-power';
    kit.box(m.metalDark, 0.85, 1.6, 0.38, -1.1, 0.8, -24.88, { physics: true });
    kit.sign(-1.1, 1.92, -24.67, 's', 'AMBER RELAY', { sub: 'PULSE TO RESTORE POWER', fg: '#ffc57c', w: 1.45, h: 0.45 });
    kit.sign(0, 2.55, -31.97, 's', 'CONTROL ROOM ▸', { sub: 'EMERGENCY BYPASS — SEALED', fg: '#a9e9c4', w: 2.4 });

    // Focal props: containment tube + scientist console + benches.
    this.labChamber = new LabChamber(this.scene, -3.6, -26.2);
    const chamberBody = this.physics.createBox(0, 1.15, 1.4, 1.15, new CANNON.Vec3(-3.6, 1.4, -26.2));
    this._track(null, chamberBody);
    kit.consoleDesk(-6.8, -25.2, 'e', { w: 1.8, monitors: 2 });
    kit.chair(-5.6, -25.2, 'w');
    kit.sign(-3.6, 2.7, -31.94, 's', '09 / CONTAINMENT BAY', { sub: 'AUTOMATIC CULTURE RESUMPTION ENABLED', fg: '#bde9e7', w: 3.8, h: 0.5 });
    kit.floorDecal(-3.6, -26.2, 'stripes', { size: 3.5, color: '#d5a04f' });
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
    kit.floorDecal(3.0, -25.0, 'dashes', { size: 2.0 });
    // Ventilation duct along the south wall — the creature escapes here.
    kit.duct('x', 18.3, 0, 2.8, -31.7, { grilles: [-6.5, 6.5] });
    kit.ventGrille(6.5, 2.6, -31.94, 's', { w: 0.9, h: 0.6 });
    // Alarm beacon near containment (the scripted beat's visual anchor).
    kit.lamp(-7.6, -27.5, { y: 2.6, color: 'red', light: false });
    kit.sign(-8.95, 2.35, -28.4, 'e', 'BIO-CONTAINMENT', { sub: 'AUTHORISED STAFF ONLY', fg: '#ffd27f', w: 2.0 });
    // Dust hanging in the lab's overhead light.
    this._dustMotes(70, 0, -26, 6.5, 0.3, 2.7);

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
    kit.valveWheel(1.95, 1.6, -37.8, 'w');

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
    // Dust around the reactor core.
    this._dustMotes(60, 0, -47, 6.5, 0.4, 2.7);

    // ── Reactor-plant equipment (the working station) ────────────────────
    // Overhead crane rail spanning the hall above the core.
    kit.craneRail('x', 16, 0, 2.72, -47.0, { trolley: -4.5 });
    // Coolant pumps flanking the hall (feed / return loops).
    kit.coolantPump(-8.2, -45.4, 'e');
    kit.coolantPump(8.0, -50.8, 'w');
    // Steam generator on the east wall.
    kit.steamGenerator(7.3, -47.6, 'z');
    // Coolant tank on the west wall.
    kit.coolantTank(-8.8, -48.6);
    // Control-rod drive bank beside the core, inside the shield ring.
    kit.controlRodDrives(2.2, -47.0);
    // Spent-fuel transfer rack in the south-west corner.
    kit.fuelRack(-6.9, -52.6, 'n');
    // Instrumentation: wall gauge banks + radiation monitors.
    kit.gaugeCluster(-9.96, 1.7, -44.5, 'e');
    kit.gaugeCluster(9.96, 1.7, -49.5, 'w');
    kit.radiationMonitor(-3.9, -41.4);
    kit.radiationMonitor(3.9, -53.0);

    // ── Reactor hall dressing — shield ring, turbine line, coolant loop ──
    // Concrete biological-shield ring standing inside the railing pen.
    kit.reactorContainmentRing(0, -47.0, { r: 3.0, count: 13 });
    // Turbine line in the north-west bay (plinth is the collider).
    kit.turbineHousing(-7.4, -42.2, 'z');
    // Coolant cross-feeds dropping between the overhead runs + isolation.
    kit.pipeRun('z', 2.8, -6.4, 2.45, -43.7, { count: 2, r: 0.09 });
    kit.pipeRun('z', 2.8, 6.4, 2.45, -50.5, { count: 2, r: 0.09 });
    kit.valveWheel(-9.85, 1.6, -43.6, 'e');
    kit.valveWheel(9.85, 1.6, -51.6, 'w');
    // Hazard striping + warning signage at the hall thresholds and walls.
    kit.floorDecal(-1.9, -40.9, 'stripes', { size: 1.0 });
    kit.floorDecal(1.9, -40.9, 'stripes', { size: 1.0 });
    kit.sign(-9.98, 2.3, -47.0, 'e', 'CAUTION / RADIATION AREA', { sub: 'DOSIMETERS REQUIRED', fg: '#ffd27f', w: 2.4 });
    kit.sign(9.98, 2.3, -47.0, 'w', 'HIGH VOLTAGE / COOLANT LOOP', { sub: 'ISOLATE BEFORE WORK', fg: '#ffd27f', w: 2.6 });
    // Ambient steam: turbine gland + coolant pump discharge.
    this._createSteamVent('l1-steam-1', -7.4, 2.05, -41.7, { count: 10, rate: 0.16, rise: 0.4, alpha: 0.3, lifeSpan: 1.1, drift: 0.08 });
    this._createSteamVent('l1-steam-2', 8.0, 1.7, -50.6, { count: 8, rate: 0.22, rise: 0.35, alpha: 0.26, lifeSpan: 1.0, drift: 0.08 });

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
    kit.wallRun(3.65, H, 0.3, -3.325, H / 2, -64.15);        // south wall, bypass gap
    kit.wallRun(3.65, H, 0.3, 3.325, H / 2, -64.15);
    kit.doorway(3.0, 2.8, 0, 1.4, -64.15, 's');
    kit.sign(0, 2.6, -54.32, 'n', 'CONTROL ROOM', { fg: '#7fe7ff' });
    // Consoles sit off the exit lane: two banks on the west side.
    kit.consoleDesk(-2.8, -62.6, 'e', { w: 2.6, monitors: 2 });
    kit.chair(-1.75, -61.5, 'e');
    kit.chair(-1.75, -63.4, 'e');
    kit.consoleDesk(-2.8, -57.4, 'e', { w: 2.0, monitors: 1 });
    kit.chair(-1.75, -57.4, 'e');
    kit.wallScreen(4.93, 2.1, -62.6, 'w', { w: 2.8, h: 1.3 });
    kit.serverRack(-4.6, -55.8, 'e');
    kit.serverRack(4.6, -55.8, 'w');
    kit.cabinet(-4.6, -60.0, 'e');
    kit.shelfUnit(4.6, -60.0, 'w', { w: 1.4, h: 1.8 });
    kit.fuseBox(-4.94, 1.7, -58.0, 'e');
    kit.extinguisher(4.94, 1.2, -56.0);
    kit.debrisPile(-4.2, -63.4, { s: 0.7, seed: 21 });
    kit.floorDecal(0, -60.4, 'stripes', { size: 1.4, color: '#5cff8a' });
    kit.floorDecal(0, -63.1, 'dashes', { size: 1.2 });
    // Annunciator fascias flanking the exit door + side instrumentation.
    kit.annunciatorBoard(-2.9, 2.15, -63.95, 's');
    kit.annunciatorBoard(2.9, 2.15, -63.95, 's');
    kit.gaugeCluster(-4.94, 1.9, -61.6, 'e');
    kit.gaugeCluster(4.94, 1.9, -56.8, 'w');

    // ── Bypass airlock door 'l1-exit' — the level's final passage ────────
    // The run ends here: the player presses E at the door to release it, then
    // walks through into the surface-lift lobby where the win zone sits.
    this._createDoor('l1-exit', 3.0, 2.8, 0, 1.4, -64.15, 0, m.hazard);
    kit.sign(0, 2.75, -63.97, 's', 'BYPASS AIRLOCK ▸', { sub: 'PRESS  E  TO RELEASE / SURFACE LIFT BEYOND', fg: '#ffd08a', w: 3.2, h: 0.6 });
    kit.floorLine(0, -63.4, 1.5, { color: 'exit' });

    // ── Surface-lift lobby (x -5..5, z -64..-71) — WIN ───────────────────
    kit.floorSlab(10.6, 6.7, 0, -67.5, { lines: [{ axis: 'z', len: 5.4, color: 'exit' }] });
    kit.ceilingSlab(10.6, 6.7, 0, H, -67.5, {
      lamps: [
        { x: -2.6, z: -1.5, light: true, intensity: 0.85 },
        { x: 2.6, z: 1.5, light: true, intensity: 0.85 },
      ],
    });
    kit.wallRun(0.3, H, 6.8, -5.15, H / 2, -67.6);
    kit.wallRun(0.3, H, 6.8, 5.15, H / 2, -67.6);
    kit.wallRun(10.6, H, 0.3, 0, H / 2, -70.95);             // south end
    // The lift itself: heavy hazard-striped doors in the end wall.
    kit.box(m.metalDark, 5.2, 3.4, 0.22, 0, 1.7, -70.78, { cast: false });
    kit.box(m.hazard, 2.5, 3.0, 0.06, -1.28, 1.5, -70.65, { cast: false });
    kit.box(m.hazard, 2.5, 3.0, 0.06, 1.28, 1.5, -70.65, { cast: false });
    kit.box(m.accent, 0.1, 2.6, 0.09, 0, 1.5, -70.62, { cast: false });
    kit.sign(0, 3.35, -70.6, 's', 'SURFACE LIFT / 01', { sub: 'TRANSFER TO SUB-LEVEL 2 LOCKOUT', fg: '#8bebbd', w: 3.2, h: 0.7 });
    this._exitBeacon(0, -68.4, { radius: 1.7 });
    // Housekeeping around the lift: pallets, pipework, fire point, boards.
    kit.crateStack(3.6, -69.6, { w: 1.4, h: 1.4, d: 0.9, rotY: -0.25 });
    kit.crate(-4.0, -66.2, { s: 0.8, rotY: 0.3 });
    kit.barrel(-4.4, -68.6);
    kit.barrel(-3.8, -69.0);
    kit.canister(4.2, -65.6);
    kit.fallenPanel(2.4, 0.3, -66.4, { rx: 0.35, ry: 0.7 });
    kit.debrisPile(-2.2, -70.0, { s: 0.9, seed: 22 });
    kit.pipeRun('z', 6.2, -4.9, 2.55, -67.6, { count: 3, r: 0.07 });
    kit.cableTray('z', 6.2, 4.9, 2.5, -67.6);
    kit.gaugeCluster(-4.94, 1.9, -68.8, 'e');
    kit.fuseBox(4.94, 1.7, -66.8, 'w');
    kit.extinguisher(4.94, 1.2, -69.0);
    kit.annunciatorBoard(-4.94, 2.15, -66.2, 'e');
    kit.floorDecal(0, -65.6, 'stripes', { size: 1.3, color: '#5cff8a' });
    kit.floorLine(0, -69.6, 2.4, { color: 'exit' });
    this._createSteamVent('l1-steam-3', 4.2, 2.05, -69.8, { count: 8, rate: 0.2, rise: 0.35, alpha: 0.24, lifeSpan: 1.0, drift: 0.08 });
    this._flickerLight(-2.8, 2.55, -66.4, 0xaad4ff, 0.9, 7);
    this._dustMotes(45, 0, -67.5, 4.5, 0.3, 2.7);

    // ── Walking staff — the station is alive before the breach ───────────
    // Patrol loops stay on walkable floor, clear of props and doorways;
    // evacuateWalkers() (Game.js, mutation alarm) sends them all running.
    // Reception: escort pacing the waiting area.
    this._addWalker('coat', [
      { x: 2.4, z: -7.2 }, { x: -1.6, z: -7.2 },
      { x: -1.6, z: -2.6 }, { x: 2.4, z: -2.6 },
    ]);
    // Reception: security guard walking the entrance lane by the desk.
    this._addWalker('security', [
      { x: -1.9, z: -2.0 }, { x: -1.9, z: -6.4 },
      { x: 0.9, z: -6.4 }, { x: 0.9, z: -2.0 },
    ]);
    // Corridor C1: tech shuttling between reception and the lab.
    this._addWalker('tech', [{ x: 0.7, z: -11.5 }, { x: 0.7, z: -18.5 }]);
    // Laboratory: researcher on rounds past the benches.
    this._addWalker('coat', [
      { x: 3.2, z: -22.5 }, { x: 3.2, z: -29.5 },
      { x: -0.5, z: -29.5 }, { x: -0.5, z: -22.5 },
    ]);
    // Reactor hall: supervisor inspecting the coolant loop (ring route).
    this._addWalker('supervisor', [
      { x: -5.2, z: -42.8 }, { x: 5.2, z: -42.8 },
      { x: 5.2, z: -52.2 }, { x: -5.2, z: -52.2 },
    ], { speed: 0.95 });
    // Reactor hall: tech walking the west pipe run.
    this._addWalker('tech', [{ x: -5.8, z: -43.2 }, { x: -5.8, z: -51.8 }]);
    // Control room: operator pacing between the consoles.
    this._addWalker('tech', [
      { x: 2.2, z: -56.5 }, { x: 2.2, z: -59.5 },
      { x: -2.2, z: -59.5 }, { x: -2.2, z: -56.5 },
    ]);

    // Green evacuation-route guides, revealed once the creature flees.
    const routeMaterial = new THREE.MeshBasicMaterial({ color: 0x80edb5, toneMapped: false });
    this.labRoute = [];
    for (const [x, z, length, horizontal] of [[0.5, -28.3, 5.8], [0.5, -36.2, 7],
      [-1.85, -40.5, 4.7, true], [-4.2, -46.5, 12], [-2.1, -52.4, 4.2, true], [0, -53.8, 3], [0, -59.3, 8]]) {
      const guide = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? length : 0.09, 0.025, horizontal ? 0.09 : length), routeMaterial);
      guide.position.set(x, 0.035, z);
      guide.visible = false;
      guide.userData.ownsGeometry = true;
      guide.userData.ownsMaterial = this.labRoute.length === 0;
      this.scene.add(guide);
      this._track(guide);
      this.labRoute.push(guide);
    }
    kit.sign(-3.8, 2.0, -40.34, 's', 'CONTROL ROOM ◂', { sub: 'KEEP LEFT OF REACTOR', fg: '#9cebc1', w: 2.2 });
    kit.sign(0, 2.35, -53.97, 's', 'CONTROL / EVACUATION', { sub: 'EMERGENCY EXIT RELEASE', fg: '#9cebc1', w: 2.6 });

    // ── Fog ───────────────────────────────────────────────────────────────
    this.fogColor = 0x070b12;
    this.fogNear = 18;
    this.fogFar = 75;
  }

  // ── Level 2 — The Hunt (damaged facility, amber palette) ────────────────
  //
  // Flow (player walks toward -z):
  //   Staging (0..-8; security sidearm locker = the L2 gun pickup) → door
  //   'l2-entry' (shoot conduit) → corridor C1 with fan (-8..-18; a fallen
  //   scientist marks the breach's first victim) → Crew quarters (-18..-30;
  //   lockers/bunks = hiding cover, a security casualty by the scorch) →
  //   → Maintenance C2 (-30..-40; steam vents + heat haze + sparks) →
  //   Server room (-40..-52; rack maze) → C3 (-52..-58) → Exit vestibule
  //   (-58..-64) → WIN. Stealth-first: tall props feed the occluder list.
  //
  _buildLevel2() {
    const H = 3;
    const kit = this._kit;
    const m = this._mats;
    this.serverAmbush = { x: 2.6, y: 0.65, z: -43, triggerZ: -39.3 };
    this.navigationBounds = { minX: -16, maxX: 16, minZ: -63, maxZ: -1 };

    this._winTriggers = [
      { x: 0, z: -62.4, radius: 1.6 }, // emergency exit vestibule
    ];

    // Monster patrol: quarters → maintenance → server room (Game.js reads
    // these and maps them to {x, y: 0, z} patrol points).
    this._monsterWaypoints = [
      { x: -4.8, z: -21 }, { x: 4.8, z: -23.6 },
      { x: 0, z: -28 }, { x: -4.8, z: -27.4 },
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
    kit.sign(1.7, 2.35, -7.88, 's', 'DOOR OVERRIDE', { sub: 'PULSE BLUE RELAY', fg: '#8ce7eb', w: 1.5, h: 0.4 });
    kit.sign(-4.0, 1.75, -4.2, 'e', 'EVACUATION / SECTOR B', { sub: 'CREW > PRESSURE LOCK > CORE ACCESS', fg: '#b2ebcf', w: 3.0, h: 0.65 });
    kit.sign(0, 2.5, -7.97, 's', 'SECTOR B ▸', { sub: 'STRUCTURAL DAMAGE DETECTED', fg: '#ffb04a' });
    kit.sign(0, 2.3, -0.01, 'n', 'STAGING BAY', { fg: '#ffb04a' });
    kit.crateStack(-2.6, -2.2, { w: 1.6, h: 1.6, d: 1.0, rotY: 0.15 });
    kit.crate(-3.3, -4.6, { s: 0.8 });
    kit.barrel(3.2, -5.8);
    kit.barrel(2.6, -6.3);
    kit.debrisPile(2.3, -1.9, { s: 0.9, seed: 31 });
    kit.fallenPanel(-2.2, 0.3, -6.2, { rx: 0.32, ry: 0.5 });
    kit.floorDecal(-1.0, -5.0, 'dashes', { size: 1.6 });
    // Security weapons locker — the pulse sidearm pickup. Game.js gates
    // firing on levels.weaponPickup until the player takes it (E prompt).
    const locker = kit.weaponsLocker(-3.82, 1.35, -5.8, 'e');
    this.weaponPickup = {
      x: -3.4, z: -5.8, radius: 1.6,
      mesh: locker.gun, light: locker.light, taken: false,
    };
    kit.sign(-3.98, 2.12, -5.8, 'e', 'SECURITY / SIDEARM LOCKER', { sub: 'SIGNED OUT UNDER LOCKDOWN ORDER 6-11', fg: '#8bebbd', w: 1.9, h: 0.45 });
    // Mission directive board on the staging-bay east wall, facing the spawn.
    this.goalBoard = kit.goalBoard(4.02, 1.85, -4.0, 'w', {
      head: 'SECTOR DIRECTIVE', tag: 'SECTOR B / LEVEL 02',
    });
    this._flickerLight(-3.4, 2.55, -7.4, 0xff3520, 0.9, 7); // red lockdown wash
    this._dustMotes(40, 0, -4, 4, 0.35, 2.6);

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
    kit.fuseBox(1.97, 1.7, -15.0, 'w');
    kit.noticeBoard(-1.93, 1.6, -16.6, 'e', { seed: 67, w: 1.0, h: 0.7 });
    kit.gaugeCluster(-1.96, 1.7, -11.6, 'e');
    kit.fallenPanel(1.5, 0.28, -15.5, { rx: 0.4, ry: -0.6 });
    // The breach's human cost — an evacuating scientist who didn't make it.
    this._scorchDecal(-1.05, 0, -15.5, 2.0);
    this._addCasualty('coat', -1.05, -15.5, Math.PI * 0.62);
    this._dustMotes(50, 0, -13, 4.5, 0.3, 2.6);
    // Big ceiling fan — rotating hazard (visual, atmosphere).
    this._addRotatingHazard(kit.fanBlade(0, 2.45, -13.0, { r: 0.95 }), 5.0);
    kit.sign(0, 2.45, -17.9, 's', 'KEEP LOW / USE COVER', { sub: 'C: CROUCH   /   SHOTS ATTRACT THE CREATURE', fg: '#a5e5dc', w: 2.5, h: 0.6 });

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
    kit.wallRun(0.3, H, 6.5, -8.15, H / 2, -21.25);            // west (medical-bay door)
    kit.wallRun(0.3, H, 3.4, -8.15, H / 2, -28.6);
    kit.doorway(2.4, 2.6, -8.15, 1.3, -25.7, 'w');
    kit.wallRun(0.3, H, 12.3, 8.15, H / 2, -24.15);            // east
    kit.doorway(2.6, 2.6, 0, 1.3, -18.15, 's');
    kit.sign(0, 2.4, -17.97, 's', 'CREW QUARTERS ▸', { fg: '#ffd9a0' });
    kit.sign(0, 2.4, -30.32, 'n', 'MAINTENANCE ▸', { sub: 'VENT CONTROL REQUIRED', fg: '#ffb04a' });
    // Lockers = tall stealth cover (occluders) along the west wall + mid-room.
    kit.lockerBank(-7.4, -20.0, 'e');
    kit.lockerBank(-7.4, -23.6, 'e');
    kit.lockerBank(-7.4, -28.8, 'e');
    kit.lockerBank(-2.4, -29.4, 'n');
    kit.lockerBank(2.6, -19.2, 'n');
    kit.lockerBank(-2.7, -22.5, 'n', { count: 5, h: 2.35 });
    kit.lockerBank(2.7, -26.7, 'n', { count: 5, h: 2.35 });
    kit.lockerBank(-5.2, -24.4, 'e', { count: 3, h: 2.35 });
    kit.sign(-2.7, 2.1, -22.18, 's', 'CREW STORAGE / 01', { sub: 'SOLID COVER', fg: '#80cdd2', w: 1.9, h: 0.4 });
    kit.sign(2.7, 2.1, -26.38, 's', 'CREW STORAGE / 02', { sub: 'SOLID COVER', fg: '#80cdd2', w: 1.9, h: 0.4 });
    kit.bunk(7.0, -21.0, 'w');
    kit.bunk(7.0, -24.5, 'w');
    kit.bunk(7.0, -28.0, 'w');
    kit.crateStack(-3.5, -25.5, { w: 1.7, h: 1.7, d: 0.9, rotY: 0.2 });
    kit.crateStack(4.4, -27.6, { w: 1.5, h: 1.6, d: 0.9 });
    kit.debrisPile(-5.4, -28.4, { s: 1.1, seed: 33 });
    kit.fallenPanel(1.8, 0.3, -26.4, { rx: 0.35, ry: 0.5 });
    kit.cabinet(-6.2, -29.5, 'n');
    kit.shelfUnit(6.8, -29.6, 'n', { w: 1.4, h: 1.8 });
    kit.canister(6.4, -20.6);
    kit.canister(6.8, -20.3);
    kit.barrel(5.8, -19.6);
    kit.floorDecal(-3.0, -22.0, 'dashes', { size: 1.6 });
    this._scorchDecal(0.5, 0, -24.0, 1.6);
    this._scorchDecal(-4.0, 0, -19.2, 1.1);
    // A security officer made their stand by the lockers — and lost.
    this._addCasualty('security', 1.35, -23.6, -Math.PI * 0.35, { y: 0.17 });
    // Steam vent + its shootable valve on the west wall.
    this._createSteamVent('l2-vent-1', -6.5, 0.35, -26.2);
    kit.valveWheel(-7.9, 1.2, -26.2, 'e');
    const v1 = this._shootableTarget(0.4, 0.3, -7.94, 1.2, -26.2, 'hazard', Math.PI / 2);
    v1.userData.ventId = 'l2-vent-1';
    // Dying bulbs over the quarters — one right on the monster's route.
    this._flickerLight(0, 2.55, -25.5, 0xffaa66, 1.1, 7);
    this._flickerLight(-6.4, 2.55, -20.5, 0xffaa66, 0.8, 6);
    this._flickerLight(3.5, 2.5, -19.6, 0xff3520, 0.7, 6);  // red wash at the mouth
    // Dusty beam through the ceiling gap the fallen panel dropped from.
    // Dust catches the practical lighting without a solid-looking cone.
    this._dustMotes(80, 0, -24, 7, 0.3, 2.8);

    // ── Medical bay (x -16..-8, z -18..-30) ──────────────────────────────
    // Overflow triage ward off the crew quarters. Only the west/north/south
    // walls are new — the east side reuses the split quarters wall above
    // (the 2.4 m doorway at z -25.7).
    kit.floorSlab(8.3, 12.3, -12.15, -24.15, { lines: [{ axis: 'z', len: 9, color: 'warn', at: -1.8 }] });
    kit.ceilingSlab(8.3, 12.3, -12.15, H, -24.15, {
      lamps: [
        { x: -2.6, z: 3.6, light: true, intensity: 0.6 },
        { x: 2.6, z: 3.6 },
        { x: 2.6, z: -3.6, light: true, intensity: 0.6 },
      ],
    });
    kit.wallRun(0.3, H, 12.3, -16.15, H / 2, -24.15);         // west outer
    kit.wallRun(8.3, H, 0.3, -12.15, H / 2, -18.15);          // north
    kit.wallRun(8.3, H, 0.3, -12.15, H / 2, -30.15);          // south
    kit.sign(-15.9, 2.2, -24.0, 'e', 'MEDICAL BAY / TRIAGE', { sub: 'ISOLATION PROTOCOL IN EFFECT', fg: '#9feac0', w: 2.8, h: 0.6 });
    // Cots along the west wall; prep bench and storage on the far side.
    kit.medCot(-14.4, -21.0, 'e');
    kit.medCot(-14.4, -24.6, 'e');
    kit.medCot(-14.4, -28.0, 'e');
    kit.labBench(-10.8, -19.9, 's', { len: 2.4 });
    kit.cabinet(-15.5, -29.7, 'n');
    kit.shelfUnit(-9.6, -29.8, 'n', { w: 1.4, h: 1.9 });
    kit.shelfUnit(-11.3, -29.8, 'n', { w: 1.4, h: 1.9 });
    kit.wallScreen(-15.93, 2.0, -22.4, 'e', { w: 2.4, h: 1.2, alt: true });
    kit.noticeBoard(-15.9, 1.7, -26.2, 'e', { seed: 61, w: 1.3, h: 0.8 });
    kit.gaugeCluster(-15.96, 1.7, -28.4, 'e');
    kit.fuseBox(-12.4, 1.8, -18.34, 'n');
    kit.chair(-9.7, -21.0, 'e');
    kit.crate(-12.6, -29.2, { s: 0.7 });
    kit.debrisPile(-9.4, -19.5, { s: 0.7, seed: 62 });
    kit.extinguisher(-15.93, 1.2, -18.7);
    kit.floorDecal(-11.6, -24.0, 'dashes', { size: 1.6 });
    this.healthPacks.push(new HealthPack(this.scene, -10.4, -22.4));
    this._scorchDecal(-12.8, 0, -21.6, 1.2);
    this._createSteamVent('l2-vent-4', -9.2, 0.35, -22.4, { count: 8, rate: 0.16, alpha: 0.3 });
    this._flickerLight(-9.6, 2.55, -25.2, 0x9fffd0, 0.8, 6);
    this._dustMotes(40, -12.2, -24, 4.6, 0.3, 2.6);

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
    kit.sign(1.92, 1.9, -33.0, 'w', 'PRESSURE / 01', { sub: 'PULSE AMBER VALVE', fg: '#ffd199', w: 1.3, h: 0.5 });
    this._createSteamVent('l2-vent-3', -1.4, 0.35, -36.6);
    kit.valveWheel(-1.9, 1.2, -36.6, 'e');
    const v3 = this._shootableTarget(0.4, 0.3, -1.94, 1.2, -36.6, 'hazard', Math.PI / 2);
    v3.userData.ventId = 'l2-vent-3';
    kit.sign(-1.92, 1.9, -36.6, 'e', 'PRESSURE / 02', { sub: 'PULSE AMBER VALVE', fg: '#ffd199', w: 1.3, h: 0.5 });
    kit.doorway(2.6, 2.6, 0, 1.3, -40.15, 's');
    this._createDoor('l2-pressure', 2.6, 2.6, 0, 1.3, -40.15, 0, m.metalDark);
    kit.sign(0, 2.45, -39.96, 's', 'PRESSURE INTERLOCK', { sub: 'ISOLATE BOTH AMBER VALVES TO RELEASE', fg: '#ffc179', w: 2.5, h: 0.55 });
    // Sparking conduit (falling sparks) + heat-haze zones (Kutloano's shader).
    this._createSteamVent('l2-sparks-1', 1.55, 1.9, -34.4, {
      color: 0xffcc66, rate: 0.25, rise: -0.5, lifeSpan: 0.5, count: 8, drift: 0.05, alpha: 0.8,
    });
    this._hazeZone(2.8, 2.2, 2.4, 0.9, 1.1, -33.4);
    this._hazeZone(2.8, 2.2, 2.4, -0.9, 1.1, -36.4);
    // Vented steam carries the haze into the quarters and server room.
    this._hazeZone(2.2, 2.0, 2.2, -5.0, 1.0, -26.2);
    this._hazeZone(2.6, 2.2, 2.6, -4.4, 1.1, -44.0);

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
    kit.wallRun(0.3, H, 6.1, -8.15, H / 2, -43.05);            // west (supply door)
    kit.wallRun(0.3, H, 3.8, -8.15, H / 2, -50.4);
    kit.doorway(2.4, 2.6, -8.15, 1.3, -47.3, 'w');
    kit.wallRun(0.3, H, 2.1, 8.15, H / 2, -41.05);             // east (shift-office door)
    kit.wallRun(0.3, H, 7.8, 8.15, H / 2, -48.4);
    kit.doorway(2.4, 2.6, 8.15, 1.3, -43.3, 'e');
    kit.doorway(2.6, 2.6, 0, 1.3, -40.15, 's');
    kit.sign(0, 2.4, -39.98, 's', 'SERVER ROOM ▸', { fg: '#ffb04a' });
    kit.sign(0, 2.4, -51.97, 's', 'CORE ACCESS >', { sub: 'EVACUATION TRANSFER', fg: '#a4eac1', w: 2.2, h: 0.55 });
    // Two rows of racks facing each other (all occluders → stealth cover).
    for (const rz of [-42.4, -44.6, -46.8, -49.0]) {
      kit.serverRack(-5.6, rz, 'e');
      kit.serverRack(5.6, rz, 'w');
    }
    for (const x of [-3.1, -2.1]) kit.serverRack(x, -44.0, 'n', { h: 2.35 });
    for (const x of [2.1, 3.1]) kit.serverRack(x, -48.0, 'n', { h: 2.35 });
    kit.sign(-2.6, 2.05, -43.45, 's', 'ARCHIVE / 09', { sub: 'CULTURE RETENTION ACTIVE', fg: '#82d2dc', w: 1.6, h: 0.45 });
    kit.sign(2.6, 2.05, -47.45, 's', 'CORE ACCESS', { sub: 'FOLLOW EVACUATION SIGNS', fg: '#b2ebcf', w: 1.6, h: 0.45 });
    kit.floorLine(-1.5, -44.5, 3.6, { color: 'exit' });
    kit.floorLine(1.5, -49.5, 3.4, { color: 'exit' });
    kit.pipeRun('z', 12, 0, 2.65, -46.15, { count: 2, r: 0.07 });
    kit.wallScreen(-7.93, 2.1, -43.5, 'e', { w: 3.0, h: 1.5, alt: true });
    kit.wallScreen(7.93, 2.1, -48.5, 'w', { w: 3.0, h: 1.5 });
    kit.cabinet(-7.6, -41.2, 'e');
    kit.shelfUnit(7.6, -50.8, 'w', { w: 1.4, h: 1.8 });
    kit.debrisPile(6.8, -51.0, { s: 0.8, seed: 36 });
    kit.debrisPile(-6.8, -41.2, { s: 0.7, seed: 37 });
    kit.fallenPanel(-1.5, 0.32, -47.5, { rx: 0.5, ry: 0.9 });
    kit.canister(3.9, -51.4);
    kit.barrel(-7.2, -51.0);
    kit.barrel(7.2, -41.4);
    this._scorchDecal(3.5, 0, -45.0, 1.4);
    this._scorchDecal(-4.0, 0, -49.0, 1.2);
    this._createSteamVent('l2-sparks-2', -4.9, 2.1, -44.0, {
      color: 0xffcc66, rate: 0.3, rise: -0.55, lifeSpan: 0.45, count: 8, drift: 0.05, alpha: 0.8,
    });
    // Flicker bulb in the rack maze's far corner + hanging dust.
    this._flickerLight(-6.5, 2.55, -50.5, 0xffaa66, 0.8, 6);
    this._dustMotes(60, 0, -46, 6.5, 0.3, 2.7);
    kit.canister(4.1, -43.2);

    // ── Supply store (x -16..-8, z -42..-52) ─────────────────────────────
    // Locked-down stores off the server room's west flank.
    kit.floorSlab(8.3, 10.3, -12.15, -47.15, { lines: [{ axis: 'z', len: 7, color: 'warn', at: 1.7 }] });
    kit.ceilingSlab(8.3, 10.3, -12.15, H, -47.15, {
      lamps: [
        { x: -2.6, z: 3.0, light: true, intensity: 0.6 },
        { x: 2.6, z: -3.0 },
      ],
    });
    kit.wallRun(0.3, H, 10.3, -16.15, H / 2, -47.15);         // west outer
    kit.wallRun(8.3, H, 0.3, -12.15, H / 2, -42.15);          // north
    kit.wallRun(8.3, H, 0.3, -12.15, H / 2, -52.15);          // south
    kit.sign(-15.9, 2.2, -47.3, 'e', 'SUPPLY / STORES', { sub: 'RESTRICTED - AUTHORISED ONLY', fg: '#e8c98a', w: 2.6, h: 0.55 });
    kit.storageRack(-15.3, -44.2, 'e');
    kit.storageRack(-15.3, -46.8, 'e');
    kit.storageRack(-15.3, -49.4, 'e');
    kit.shelfUnit(-10.4, -42.4, 'n', { w: 1.6, h: 2.0 });
    kit.shelfUnit(-12.2, -42.4, 'n', { w: 1.6, h: 2.0 });
    kit.crateStack(-11.4, -50.6, { w: 1.6, h: 1.6, d: 0.9, rotY: 0.2 });
    kit.crate(-9.6, -49.6, { s: 0.8 });
    kit.crate(-10.4, -50.3, { s: 0.7 });
    kit.barrel(-15.4, -51.2);
    kit.barrel(-14.7, -51.4);
    kit.canister(-13.3, -51.3);
    kit.debrisPile(-13.4, -49.0, { s: 0.8, seed: 63 });
    kit.wallScreen(-15.93, 2.0, -45.2, 'e', { w: 2.2, h: 1.1 });
    kit.gaugeCluster(-15.96, 1.7, -50.6, 'e');
    kit.floorDecal(-12.0, -46.4, 'dashes', { size: 1.6 });
    this._scorchDecal(-11.6, 0, -48.0, 1.1);
    this._flickerLight(-12.6, 2.55, -48.2, 0xffcc88, 0.7, 6);
    this._dustMotes(35, -12.2, -47, 4, 0.3, 2.6);

    // ── Shift office (x 8..16, z -40..-50) ──────────────────────────────
    // The control desk that ran Sector B before the breach - now abandoned.
    kit.floorSlab(8.3, 10.3, 12.15, -45.15, { lines: [{ axis: 'z', len: 7, color: 'warn', at: -1.7 }] });
    kit.ceilingSlab(8.3, 10.3, 12.15, H, -45.15, {
      lamps: [
        { x: -2.6, z: 3.0, light: true, intensity: 0.65 },
        { x: 2.6, z: -3.0, light: true, intensity: 0.65 },
      ],
    });
    kit.wallRun(0.3, H, 10.3, 16.15, H / 2, -45.15);          // east outer
    kit.wallRun(8.3, H, 0.3, 12.15, H / 2, -40.15);           // north
    kit.wallRun(8.3, H, 0.3, 12.15, H / 2, -50.15);           // south
    kit.sign(15.9, 2.2, -44.2, 'w', 'SHIFT OFFICE / CONTROL', { sub: 'LOG ARCHIVE', fg: '#cfe0ea', w: 2.6, h: 0.55 });
    kit.officeDesk(14.4, -42.4, 'w');
    kit.officeDesk(14.4, -45.0, 'w', { alt: true });
    kit.chair(13.4, -42.4, 'w');
    kit.chair(13.4, -45.0, 'w');
    kit.lockerBank(12.0, -49.7, 'n', { count: 3, h: 2.05 });
    kit.cabinet(8.35, -49.5, 'e');
    kit.shelfUnit(11.2, -49.6, 'n', { w: 1.4, h: 1.9 });
    kit.wallScreen(15.93, 2.05, -46.4, 'w', { w: 2.6, h: 1.4, alt: true });
    kit.noticeBoard(15.9, 1.7, -42.8, 'w', { seed: 64, w: 1.4, h: 0.9 });
    kit.gaugeCluster(15.96, 1.7, -47.8, 'w');
    kit.fuseBox(12.4, 1.8, -40.34, 'n');
    kit.floorDecal(12.0, -44.0, 'stripes', { size: 1.4 });
    kit.canister(15.3, -41.2);
    kit.debrisPile(13.6, -49.0, { s: 0.8, seed: 65 });
    this._scorchDecal(11.0, 0, -44.5, 1.2);
    this._flickerLight(15.2, 2.55, -44.0, 0xffddaa, 0.8, 6);
    this._dustMotes(40, 12.2, -45, 4.2, 0.3, 2.6);

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
    kit.sign(0, 2.4, -63.98, 's', 'EVACUATION / CORE ACCESS', { sub: 'SURFACE LIFT OFFLINE / USE CONTAINMENT TRANSFER', fg: '#8bebbd', w: 3.4 });
    kit.floorLine(0, -60.0, 6, { color: 'exit' });
    kit.crateStack(3.2, -63.0, { w: 1.2, h: 1.2, d: 0.8, rotY: -0.3 });
    kit.extinguisher(-3.94, 1.2, -59.0);

    // ── Reactor-plant equipment (abandoned mid-shift by the evacuees) ────
    // The machinery stayed when the staff left — it just runs unattended.
    kit.radiationMonitor(-3.4, -6.8);               // staging bay, by the sector door
    kit.gaugeCluster(1.96, 1.6, -11.6, 'w');        // C1 east wall
    kit.coolantPump(4.9, -24.8, 'w');               // quarters — coolant feed pump
    kit.gaugeCluster(2.5, 1.7, -29.96, 's');        // quarters south wall
    kit.radiationMonitor(-3.0, -41.6);              // server room threshold
    kit.gaugeCluster(7.96, 1.7, -45.5, 'w');        // server room east wall
    kit.pipeManifold(6.0, 1.9, -51.94, 's', { len: 1.8, valves: 3 });
    kit.noticeBoard(-2.6, 1.75, -51.94, 's', { seed: 66, w: 1.2, h: 0.8 });
    kit.pipeManifold(3.9, 1.9, -1.9, 'w', { len: 1.6, valves: 3 });

    // Med-kits tucked along the evacuation route (restore 35 health).
    for (const [x, z] of [[-4.3, -23.8], [1.2, -38.8], [-2.6, -45.5], [1.2, -55.5]]) {
      this.healthPacks.push(new HealthPack(this.scene, x, z));
    }
    kit.sign(-5.2, 2.05, -24.03, 's', 'FIRST AID / COVER', { sub: 'GREEN CASE RESTORES 35 HEALTH', fg: '#9feac0', w: 1.9, h: 0.45 });

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
    for (const x of [-10, 10]) this.healthPacks.push(new HealthPack(this.scene, x, -18.5));

    this._winTriggers = [
      { x: 0, z: -56.6, radius: 1.5, needMonsterDead: true },
    ];

    // Boss patrol loop around the arena cover.
    this._monsterWaypoints = [
      { x: -8.5, z: -16 }, { x: 8.5, z: -16 },
      { x: 8.5, z: -35 }, { x: -8.5, z: -35 },
    ];
    this.navigationBounds = { minX: -22, maxX: 21, minZ: -58.5, maxZ: 0.5 };

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
    kit.doorway(4.0, 3.4, 0, 1.7, -10.15, 's');
    kit.sign(0, 2.95, -9.96, 's', 'SURFACE SEAL / ENTITY LOCK', { sub: 'CHEST + SHOULDERS / PULSE CYAN NODES', fg: '#92e1e8', w: 3.6, h: 0.6 });
    kit.sign(0, 3.0, -0.01, 'n', 'CONTAINMENT ARENA ▸', { sub: 'FAILSAFE ARMED', fg: '#ff8f7f' });
    kit.hangingPipe(-1.6, 3.4, -4.0, { tilt: 0.7 });
    kit.debrisPile(1.3, -7.5, { s: 0.8, seed: 41 });
    this._scorchDecal(0.8, 0, -3.0, 1.0);
    // Mission directive board on the entry-corridor east wall.
    this.goalBoard = kit.goalBoard(2.02, 2.1, -5.6, 'w', {
      head: 'FAILSAFE DIRECTIVE', tag: 'CONTAINMENT / LEVEL 03',
    });

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
    kit.wallRun(12.3, H, 0.3, -8.15, H / 2, -10.15);          // north (4 m entry gap)
    kit.wallRun(12.3, H, 0.3, 8.15, H / 2, -10.15);
    kit.wallRun(12.3, H, 0.3, -8.15, H / 2, -42.15);          // south (4 m exit gap)
    kit.wallRun(12.3, H, 0.3, 8.15, H / 2, -42.15);
    kit.wallRun(0.3, H, 14.0, -14.15, H / 2, -17.0);          // west (pump-gallery door)
    kit.wallRun(0.3, H, 14.9, -14.15, H / 2, -34.85);
    kit.doorway(3.4, 3.2, -14.15, 1.6, -25.7, 'w');
    kit.wallRun(0.3, H, 9.2, 14.15, H / 2, -14.6);            // east (observation door)
    kit.wallRun(0.3, H, 20.1, 14.15, H / 2, -32.25);
    kit.doorway(3.0, 3.2, 14.15, 1.6, -20.7, 'e');
    kit.sign(0, 3.4, -10.32, 'n', 'CONTAINMENT ARENA', { sub: 'CLASS-4 ENTITY — EXTREME CAUTION', fg: '#ff8f7f' });
    // Cover pillars (full height → occluders + colliders).
    for (const [cx, cz] of [
      [-7, -14], [7, -14], [-12, -18], [-11, -22], [11, -22],
      [-7, -31], [7, -31], [-11, -36], [11, -36],
    ]) {
      kit.column(cx, cz, { h: H, r: 0.3 });
    }
    // Machinery + focal props.
    kit.generator(-11.5, -30.0, 'e');
    kit.sign(-13.94, 2.7, -33, 'e', 'PROTOCOL 09 / CULTURE RETAINED', { sub: 'ENTITY SIGNATURE CONTROLS SURFACE SEAL', fg: '#e5ad87', w: 3.2, h: 0.75 });
    kit.generator(11.5, -16.0, 'w');
    kit.reactorCore(-5, -25.5, { r: 0.8, h: 2.2, light: false });
    kit.reactorCore(5, -25.5, { r: 0.8, h: 2.2, light: false });
    kit.containmentTube(-3, -39.3, { r: 0.8, h: 2.4, light: false });
    kit.crateStack(-6, -27.0, { w: 1.6, h: 1.6, d: 1.0, rotY: 0.25 });
    kit.crateStack(6, -27.0, { w: 1.6, h: 1.6, d: 1.0, rotY: -0.2 });
    kit.barrel(-10.5, -27.2);
    kit.barrel(-10.0, -26.6);
    kit.barrel(10.5, -27.2);
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
    // Sparse emergency equipment: the arena was part-stripped when the
    // failsafe armed, but the instrumentation never got switched off.
    kit.coolantTank(-12.9, -11.4, { h: 2.6 });      // NW corner reserve
    kit.pipeRun('x', 26, 0, 3.6, -11.1, { count: 2, r: 0.08 });
    kit.annunciatorBoard(-13.94, 2.6, -38.0, 'e', { cols: 5, rows: 3 });
    kit.crateStack(9.5, -12.5, { w: 1.4, h: 1.4, d: 0.9, rotY: -0.2 });
    kit.barrel(9.8, -33.5);
    kit.radiationMonitor(2.6, -12.5);               // threshold monitor
    kit.radiationMonitor(-2.6, -40.0);              // by the failsafe seal
    kit.gaugeCluster(-13.96, 2.0, -20.0, 'e');      // west wall
    kit.gaugeCluster(13.96, 2.0, -32.0, 'w');       // east wall

    // ── Coolant pump gallery (x -22..-14, z -18..-32) ────────────────────
    // The high-pressure loop that fed the arena's cooling — west of the
    // arena, through the 3.4 m doorway at z -25.7.
    kit.floorSlab(8.3, 14.3, -18.15, -25.15, { trim: true, lines: [{ axis: 'z', len: 10, color: 'emer', at: 1.9 }] });
    kit.ceilingSlab(8.3, 14.3, -18.15, H, -25.15, {
      lamps: [
        { x: -2.5, z: 5.0, light: true, intensity: 0.7 },
        { x: -2.5, z: -5.0, light: true, intensity: 0.7 },
      ],
    });
    kit.wallRun(0.3, H, 14.3, -22.15, H / 2, -25.15);          // west outer
    kit.wallRun(8.3, H, 0.3, -18.15, H / 2, -18.15);           // north
    kit.wallRun(8.3, H, 0.3, -18.15, H / 2, -32.15);           // south
    kit.sign(-21.9, 2.7, -25.2, 'e', 'COOLANT PUMP GALLERY', { sub: 'HIGH-PRESSURE LOOP', fg: '#8ce7eb', w: 2.8, h: 0.6 });
    kit.coolantPump(-20.2, -20.5, 'e');
    kit.coolantPump(-20.2, -25.7, 'e');
    kit.coolantPump(-20.2, -30.0, 'e');
    kit.coolantTank(-16.2, -19.6, { h: 2.6 });
    kit.coolantTank(-16.2, -30.6, { h: 2.4 });
    kit.pipeManifold(-21.9, 1.9, -23.2, 'e', { len: 2.0, valves: 3 });
    kit.pipeManifold(-21.9, 1.9, -28.2, 'e', { len: 2.0, valves: 3 });
    kit.pipeRun('z', 13, -21.6, 3.1, -25.15, { count: 3, r: 0.08 });
    kit.gaugeCluster(-21.96, 2.0, -21.0, 'e');
    kit.gaugeCluster(-21.96, 2.0, -31.0, 'e');
    kit.barrel(-16.7, -22.6);
    kit.debrisPile(-18.8, -28.2, { s: 0.9, seed: 68 });
    kit.floorDecal(-18.0, -25.0, 'stripes', { size: 1.3 });
    this._scorchDecal(-19.5, 0, -23.0, 1.3);
    this._createSteamVent('l3-vent-1', -17.4, 0.35, -26.5, { count: 10, rate: 0.18, alpha: 0.32 });
    this._flickerLight(-19.0, 3.3, -25.5, 0xff5533, 1.0, 8);
    this._dustMotes(50, -18.2, -25, 5.0, 0.4, 3.4);

    // ── Observation booth (x 14..21, z -18..-28) ────────────────────────
    // The remote console that armed the failsafe — east of the arena,
    // through the 3.0 m doorway at z -20.7. No glass window: a bank of
    // wall screens shows the arena feed instead.
    kit.floorSlab(7.3, 10.3, 17.65, -23.15, { trim: true, lines: [{ axis: 'z', len: 7, color: 'emer', at: -1.7 }] });
    kit.ceilingSlab(7.3, 10.3, 17.65, H, -23.15, {
      lamps: [{ x: 0, z: 3.0, light: true, intensity: 0.7 }],
    });
    kit.wallRun(0.3, H, 10.3, 21.15, H / 2, -23.15);           // east outer
    kit.wallRun(7.3, H, 0.3, 17.65, H / 2, -18.15);            // north
    kit.wallRun(7.3, H, 0.3, 17.65, H / 2, -28.15);            // south
    kit.sign(20.9, 2.7, -23.2, 'w', 'OBSERVATION / CONTROL', { sub: 'ARENA FEED / FAILSAFE REMOTE', fg: '#cfe0ea', w: 2.8, h: 0.6 });
    kit.consoleDesk(19.6, -20.5, 'w', { w: 2.2, monitors: 3 });
    kit.consoleDesk(19.6, -25.7, 'w', { w: 2.2, monitors: 3 });
    kit.chair(18.4, -20.5, 'w');
    kit.chair(18.4, -25.7, 'w');
    kit.wallScreen(15.85, 2.2, -19.4, 'w', { w: 2.4, h: 1.4 });
    kit.wallScreen(15.85, 2.2, -26.8, 'w', { w: 2.4, h: 1.4, alt: true });
    kit.annunciatorBoard(15.9, 1.55, -23.0, 'w', { cols: 6, rows: 3 });
    kit.gaugeCluster(15.96, 1.7, -24.6, 'w');
    kit.cabinet(20.6, -27.6, 'w');
    kit.noticeBoard(20.9, 1.75, -19.0, 'w', { seed: 69, w: 1.2, h: 0.8 });
    kit.floorDecal(17.5, -23.0, 'stripes', { size: 1.3 });
    kit.canister(16.4, -27.6);
    this._scorchDecal(19.5, 0, -23.5, 1.1);
    this._flickerLight(16.5, 3.3, -21.5, 0xff7777, 0.9, 7);
    this._dustMotes(45, 17.6, -23, 4.5, 0.4, 3.4);

    // ── Sealed failsafe door 'l3-exit' (opened by Game.js on boss death) ──
    kit.doorway(4.0, 3.4, 0, 1.7, -42.15, 's');
    this._exitDoor = this._createDoor('l3-exit', 4.0, 3.4, 0, 1.7, -42.15, 0, m.hazard);
    kit.sign(0, 3.5, -41.97, 's', 'SURFACE EXIT / BIOLOGICAL LOCK', { sub: 'NEUTRALIZE ENTITY TO RELEASE EVACUATION', fg: '#ffad87', w: 3.6, h: 0.6 });

    // ── Escape corridor (x -3..3, z -42..-52) — clear sprint lane ───────
    kit.floorSlab(6.3, 10.0, 0, -47.15, { lines: [{ axis: 'z', len: 8, color: 'exit' }] });
    kit.ceilingSlab(6.3, 10.0, 0, H, -47.15, { lamps: [{ x: 0, z: 0, color: 'red' }] });
    kit.wallRun(0.3, H, 10.3, -3.15, H / 2, -47.15);
    kit.wallRun(0.3, H, 10.3, 3.15, H / 2, -47.15);
    kit.pipeRun('z', 9.5, -2.95, 2.6, -47.15, { count: 2, r: 0.06 });
    kit.debrisPile(-2.4, -46.2, { s: 0.9, seed: 44 });
    kit.debrisPile(2.4, -50.4, { s: 0.8, seed: 45 });
    kit.fallenPanel(-2.2, 0.35, -48.5, { rx: 0.5, ry: -0.4 });
    kit.hangingPipe(2.7, 3.3, -50.0, { tilt: 0.7 });
    this._scorchDecal(0.5, 0, -44.0, 1.3);
    kit.gaugeCluster(2.94, 1.7, -46.0, 'w');
    kit.fuseBox(-2.94, 1.7, -48.0, 'e');

    // ── Exit room (x -4..4, z -52..-58) — WIN ────────────────────────────
    kit.floorSlab(8.6, 6.0, 0, -55.15, { lines: [{ axis: 'z', len: 5, color: 'exit' }] });
    kit.ceilingSlab(8.6, 6.0, 0, H, -55.15, {
      lamps: [{ x: 0, z: 0, color: 'red', light: true, intensity: 0.7 }],
    });
    kit.wallRun(2.3, H, 0.3, -3.15, H / 2, -52.15);
    kit.wallRun(2.3, H, 0.3, 3.15, H / 2, -52.15);
    kit.wallRun(8.6, H, 0.3, 0, H / 2, -58.15);               // south end
    kit.wallRun(0.3, H, 6.3, -4.15, H / 2, -55.15);           // west
    kit.wallRun(0.3, H, 6.3, 4.15, H / 2, -55.15);            // east
    kit.doorway(4.0, 3.4, 0, 1.7, -52.15, 's');
    this._exitBeacon(0, -57.0, { radius: 1.7 });
    kit.sign(0, 3.2, -57.98, 's', 'EMERGENCY EXIT', { sub: 'SURFACE ACCESS', fg: '#5cff8a' });
    kit.wallScreen(3.93, 2.2, -55.0, 'w', { w: 2.4, h: 1.2 });
    kit.debrisPile(2.5, -56.5, { s: 1.1, seed: 46 });
    kit.fallenPanel(-2.0, 0.4, -53.5, { rx: 0.5, ry: 0.6 });
    kit.hangingPipe(-1.8, 3.3, -55.0, { tilt: 0.6 });
    kit.extinguisher(-3.94, 1.2, -53.0);
    kit.pipeManifold(-3.9, 1.9, -53.6, 'e', { len: 1.4, valves: 2 });
    const routeMaterial = new THREE.MeshBasicMaterial({ color: 0x8af0bd, toneMapped: false });
    for (const [z, length] of [[-26, 30], [-49, 16]]) {
      const guide = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, length), routeMaterial);
      guide.position.set(0, 0.04, z);
      guide.visible = false;
      guide.userData.ownsGeometry = true;
      guide.userData.ownsMaterial = this.escapeRoute.length === 0;
      this.scene.add(guide);
      this._track(guide);
      this.escapeRoute.push(guide);
    }

    // ── Dissolve targets (Kutloano's shader fades these during collapse) ──
    this._dissolveWalls = [];
    const dissolveChunk = (w, h, d, x, y, z) => {
      const c = kit.box(m.wallDark, w, h, d, x, y, z, { physics: false });
      this._dissolveWalls.push(c);
    };
    // Sagging ceiling slabs along the escape corridor.
    for (const dz of [-43.5, -45.5, -47.5, -49.5, -51.5]) {
      dissolveChunk(6.0, 0.4, 1.8, 0, 3.8, dz);
    }
    // Bulging wall panels (flush with the walls).
    for (const dz of [-44.5, -49.5]) {
      dissolveChunk(0.35, 3.0, 3.0, -3.15, 1.7, dz);
      dissolveChunk(0.35, 3.0, 3.0, 3.15, 1.7, dz);
    }
    // Exit-room ceiling about to come down.
    dissolveChunk(4.0, 0.4, 2.4, 0, 3.8, -54.6);
    dissolveChunk(4.0, 0.4, 2.4, 0, 3.8, -57.0);

    // ── Burning wreckage — the arena and its side rooms are on fire ──────
    this._createFire('l3-fire-arena', 0.5, 0.2, -26.0, { scale: 1.5, flames: 14, smoke: 24, intensity: 1.5, range: 14 });
    this._createFire('l3-fire-arena2', -6.0, 0.2, -33.0, { scale: 1.1, intensity: 1.2 });
    this._createFire('l3-fire-gen', -11.5, 0.2, -30.6, { scale: 1.3, intensity: 1.2, light: false });
    this._createFire('l3-fire-entry', 0.9, 0.2, -3.0, { scale: 0.9, light: false });
    this._createFire('l3-fire-arena3', 5.0, 0.2, -19.0, { scale: 1.0, light: false });
    this._createFire('l3-fire-gallery', -19.5, 0.2, -23.0, { scale: 1.0, light: false });
    this._createFire('l3-fire-escape', 0.5, 0.2, -44.0, { scale: 1.0, light: false });
    // Thick smoke columns billowing up where there are no flames.
    this._createFire('l3-smoke-arena', 3.2, 0.5, -30.0, { flames: 0, smoke: 22, scale: 2.0, sRate: 0.11, light: false });
    this._createFire('l3-smoke-escape', -1.6, 0.5, -48.0, { flames: 0, smoke: 16, scale: 1.6, sRate: 0.14, light: false });

    // ── Fire damage — scorch on the floor and soot blackening the ceiling
    //    above each blaze, so the burning rooms read as burned. ───────────
    const fireDamage = [
      { x: 0.5, z: -26.0, s: 3.4, cy: 3.9 },
      { x: -6.0, z: -33.0, s: 2.6, cy: 3.9 },
      { x: -11.5, z: -30.6, s: 2.4, cy: 3.9 },
      { x: 0.9, z: -3.0, s: 1.8, cy: 2.9 },
      { x: 5.0, z: -19.0, s: 2.2, cy: 3.9 },
      { x: -19.5, z: -23.0, s: 2.2, cy: 3.9 },
      { x: 0.5, z: -44.0, s: 2.2, cy: 2.9 },
      { x: 3.2, z: -30.0, s: 3.0, cy: 3.9 },
      { x: -1.6, z: -48.0, s: 2.4, cy: 2.9 },
    ];
    for (const d of fireDamage) {
      this._scorchDecal(d.x, 0, d.z, d.s, Math.random() * Math.PI);
      this._ceilingSoot(d.x, d.cy, d.z, d.s * 0.9, Math.random() * Math.PI);
    }

    // ── Panicked crowd — staff fleeing through the burning arena ─────────
    const panicRoutes = [
      [{ x: 1.5, z: -12.5 }, { x: 1.0, z: -40.5 }],
      [{ x: -3.5, z: -13.5 }, { x: -3.0, z: -39.5 }],
      [{ x: 4.0, z: -15.0 }, { x: 3.2, z: -38.0 }],
      [{ x: -5.5, z: -16.5 }, { x: 5.5, z: -35.5 }, { x: 5.0, z: -18.0 }],
      [{ x: 0.0, z: -13.0 }, { x: -8.0, z: -20.0 }, { x: -8.5, z: -30.0 }],
      [{ x: 2.5, z: -35.0 }, { x: -1.5, z: -13.5 }],
    ];
    panicRoutes.forEach((route, i) => {
      this._addPanicRunner(route, { variant: i % 2 ? 'coat' : 'security', speed: 3.6 + (i % 3) * 0.4 });
    });

    // ── Fog ──────────────────────────────────────────────────────────────
    this.fogColor = 0x10131a;
    this.fogNear = 12;
    this.fogFar = 58;
  }

  // ── Game.js accessors ─────────────────────────────────────────────────────

  /** Monster patrol waypoints ({x, z}) for the current level. */
  get monsterWaypoints() { return this._monsterWaypoints; }

  /** Win trigger zones ({x, z, radius, needMonsterDead?}) for this level. */
  get winTriggers() { return this._winTriggers; }
}
