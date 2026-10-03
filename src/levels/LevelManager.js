import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * LevelManager — Person B's domain.
 *
 * Responsible for building and managing the three reactor-station levels.
 * Each level method should add geometry, physics bodies, and gameplay
 * elements to the provided scene and physics world.
 *
 * Conventions:
 *   - 1 unit = 1 metre
 *   - Corridor width: 4m, height: 3m
 *   - Asset filenames: lowercase, hyphen-separated, no spaces
 *   - Every mesh that collides needs a matching physics body
 */
export default class LevelManager {
  /**
   * @param {import('three').Scene} scene
   * @param {import('../core/PhysicsWorld.js').default} physics
   */
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;

    /** Currently loaded level objects — dispose before loading a new level. */
    this._disposables = [];

    /** Shootable meshes for the PulseTool raycast (rebuilt each level load). */
    this.shootables = [];

    /** Win trigger zones (rebuilt each level load). */
    this._winTriggers = [];

    /** Monster patrol waypoints (rebuilt each level load). */
    this._monsterWaypoints = [];

    /** Heat-haze zone marker meshes (rebuilt each level load). */
    this.heatHazeZones = [];

    /** Animated sliding doors (rebuilt each level load). */
    this._doors = [];

    /** Steam vent particle emitters (rebuilt each level load). */
    this._steamVents = [];

    /** Rotating hazard meshes with speed (rebuilt each level load). */
    this._rotatingHazards = [];

    /** Per-level fog settings (set by each _buildLevel, read by Game.js). */
    this.fogColor = null;
    this.fogNear = 25;
    this.fogFar = 90;

    /** GLTF loader for Blender .glb models (reused across levels). */
    this._gltfLoader = new GLTFLoader();

    /** Loaded model cache — path → cloned scene root (avoids re-fetching). */
    this._modelCache = new Map();
  }

  /**
   * Load a level by number (1, 2, or 3).
   * Tears down the previous level first.
   * @param {number} levelNum
   */
  load(levelNum) {
    this._teardown();

    switch (levelNum) {
      case 1: this._buildLevel1(); break;
      case 2: this._buildLevel2(); break;
      case 3: this._buildLevel3(); break;
      default: throw new Error(`Unknown level: ${levelNum}`);
    }
  }

  /** Dispose GPU resources and physics bodies from the current level. */
  _teardown() {
    for (const entry of this._disposables) {
      if (entry.mesh) {
        // Dispose groups (GLB models) recursively.
        if (entry.mesh.isGroup || entry.mesh.isObject3D) {
          entry.mesh.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (child.material.map) child.material.map.dispose();
              child.material.dispose();
            }
          });
        } else {
          if (entry.mesh.geometry) entry.mesh.geometry.dispose();
          if (entry.mesh.material) {
            if (entry.mesh.material.map) entry.mesh.material.map.dispose();
            entry.mesh.material.dispose();
          }
        }
        this.scene.remove(entry.mesh);
      }
      if (entry.body) {
        this.physics.world.removeBody(entry.body);
      }
    }
    this._disposables = [];
    this.shootables = [];
    this._winTriggers = [];
    this._monsterWaypoints = [];
    this.heatHazeZones = [];
    this._doors = [];
    // Dispose lingering steam particles.
    for (const v of this._steamVents) {
      for (const p of v.particles) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
      }
    }
    this._steamVents = [];
    this._rotatingHazards = [];
  }

  // ── Shared geometry helpers ──────────────────────────────────────────────

  /**
   * Place a box as a wall segment with physics collision.
   * @param {number} w  width  (x)
   * @param {number} h  height (y)
   * @param {number} d  depth  (z)
   * @param {number} x  centre x
   * @param {number} y  centre y
   * @param {number} z  centre z
   * @param {THREE.Material} mat
   */
  _wallBox(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const body = this.physics.createBox(
      0, w / 2, h / 2, d / 2,
      new CANNON.Vec3(x, y, z)
    );
    this.physics.addSyncPair(body, mesh);
    this._track(mesh, body);
    return mesh;
  }

  /**
   * Place a floor or ceiling plane (no physics — player stays on the ground).
   */
  _floorCeil(w, d, x, y, z, mat, isCeiling = false) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    mesh.rotation.x = isCeiling ? Math.PI / 2 : -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this._track(mesh);
    return mesh;
  }

  /** Place a box prop (desk, crate, pillar) with physics. */
  _propBox(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const body = this.physics.createBox(
      0, w / 2, h / 2, d / 2,
      new CANNON.Vec3(x, y, z)
    );
    this.physics.addSyncPair(body, mesh);
    this._track(mesh, body);
    return mesh;
  }

  /** Place a cylinder prop (pipe, column, reactor core). */
  _propCylinder(rTop, rBot, h, x, y, z, mat, segments = 16) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBot, h, segments), mat
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const body = this.physics.createBox(
      0, rTop, h / 2, rTop,
      new CANNON.Vec3(x, y, z)
    );
    this.physics.addSyncPair(body, mesh);
    this._track(mesh, body);
    return mesh;
  }

  /**
   * Place a shootable target panel (terminal, conduit, hazard).
   * Tagged with userData so PulseTool raycast can identify it.
   *
   * @param {number} w  width
   * @param {number} h  height
   * @param {number} x  centre x
   * @param {number} y  centre y
   * @param {number} z  centre z
   * @param {string} type  pulseType value ('terminal', 'conduit', 'hazard', 'weakpoint')
   * @param {number} rotY  Y-axis rotation (radians) — face the player
   * @returns {THREE.Mesh}
   */
  _shootableTarget(w, h, x, y, z, type, rotY = 0) {
    const colors = {
      terminal: 0x00ff88,
      conduit:  0x44aaff,
      hazard:   0xffaa00,
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
    this.scene.add(mesh);
    this._track(mesh);
    this.shootables.push(mesh);
    return mesh;
  }

  // ── Procedural textures ─────────────────────────────────────────────────

  /** Generate a brushed-metal panel texture with grid lines. */
  _createMetalTexture(baseHex = '#667788', lineHex = '#556677') {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);
    let s = 42;
    const rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const id = ctx.getImageData(0, 0, 256, 256);
    for (let i = 0; i < id.data.length; i += 4) {
      const n = (rng() - 0.5) * 16;
      id.data[i] = Math.max(0, Math.min(255, id.data[i] + n));
      id.data[i + 1] = Math.max(0, Math.min(255, id.data[i + 1] + n));
      id.data[i + 2] = Math.max(0, Math.min(255, id.data[i + 2] + n));
    }
    ctx.putImageData(id, 0, 0);
    ctx.strokeStyle = lineHex; ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, 120, 120);
    ctx.strokeRect(128, 4, 124, 120);
    ctx.strokeRect(4, 128, 120, 124);
    ctx.strokeRect(128, 128, 124, 124);
    ctx.strokeStyle = '#ffffff10'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(256, 64);
    ctx.moveTo(0, 192); ctx.lineTo(256, 192); ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  /** Generate a concrete / tile floor texture. */
  _createConcreteTexture(baseHex = '#2a3040') {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);
    let s = 73;
    const rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const id = ctx.getImageData(0, 0, 256, 256);
    for (let i = 0; i < id.data.length; i += 4) {
      const n = (rng() - 0.5) * 22;
      id.data[i] = Math.max(0, Math.min(255, id.data[i] + n));
      id.data[i + 1] = Math.max(0, Math.min(255, id.data[i + 1] + n));
      id.data[i + 2] = Math.max(0, Math.min(255, id.data[i + 2] + n));
    }
    ctx.putImageData(id, 0, 0);
    ctx.strokeStyle = '#00000020'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(128, 0); ctx.lineTo(128, 256);
    ctx.moveTo(0, 128); ctx.lineTo(256, 128); ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  /** Generate a simple noise normal map for surface detail. */
  _createNormalTexture(intensity = 10) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#8080ff';
    ctx.fillRect(0, 0, 128, 128);
    let s = 17;
    const rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const id = ctx.getImageData(0, 0, 128, 128);
    for (let i = 0; i < id.data.length; i += 4) {
      id.data[i] = 128 + Math.floor((rng() - 0.5) * intensity);
      id.data[i + 1] = 128 + Math.floor((rng() - 0.5) * intensity);
    }
    ctx.putImageData(id, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  /** Generate a radial scorch texture (reused for all decals). */
  _createScorchTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(15,8,3,0.75)');
    g.addColorStop(0.5, 'rgba(30,15,5,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  // ── Modular corridor builders ───────────────────────────────────────────
  //
  // Each helper builds a complete corridor section (floor + ceiling + walls)
  // centred on (cx, cz).  Use rotY to rotate T-junctions and corners.
  // Conventions: corridor width = 4m, height = H metres.

  /**
   * Straight corridor section along the Z axis.
   * @param {number} cx   centre x
   * @param {number} cz   centre z
   * @param {number} len  length along Z
   * @param {number} H    ceiling height
   * @param {THREE.Material} wallMat
   * @param {THREE.Material} floorMat
   * @param {THREE.Material} ceilMat
   */
  _corridorStraight(cx, cz, len, H, wallMat, floorMat, ceilMat) {
    const HH = H / 2;
    this._floorCeil(4, len, cx, 0, cz, floorMat);
    this._floorCeil(4, len, cx, H, cz, ceilMat, true);
    this._wallBox(0.2, H, len, cx + 2, HH, cz, wallMat); // east
    this._wallBox(0.2, H, len, cx - 2, HH, cz, wallMat); // west
  }

  /**
   * T-junction: main corridor along Z with a branch opening on the east (+X) side.
   * Main section is 4m wide × 4m long; the branch opening is 2.5m centred at z = cz.
   * @param {number} cx  centre x of main corridor
   * @param {number} cz  centre z of junction
   * @param {number} H   ceiling height
   */
  _corridorTJunction(cx, cz, H, wallMat, floorMat, ceilMat) {
    const HH = H / 2;
    // Floor + ceiling for the junction box (4m × 4m).
    this._floorCeil(4, 4, cx, 0, cz, floorMat);
    this._floorCeil(4, 4, cx, H, cz, ceilMat, true);
    // West wall (solid).
    this._wallBox(0.2, H, 4, cx - 2, HH, cz, wallMat);
    // East wall — gap for branch (2.5m opening centred at cz).
    this._wallBox(0.2, H, 0.75, cx + 2, HH, cz - 1.625, wallMat);
    this._wallBox(0.2, H, 0.75, cx + 2, HH, cz + 1.625, wallMat);
    // North + south walls solid.
    this._wallBox(4, H, 0.2, cx, HH, cz - 2, wallMat);
    this._wallBox(4, H, 0.2, cx, HH, cz + 2, wallMat);
  }

  /**
   * Corner section: corridor comes from south (+Z) and turns east (+X).
   * 4m × 4m box with walls on the outside of the corner (north + west).
   * @param {number} cx  centre x
   * @param {number} cz  centre z
   * @param {number} H   ceiling height
   */
  _corridorCorner(cx, cz, H, wallMat, floorMat, ceilMat) {
    const HH = H / 2;
    this._floorCeil(4, 4, cx, 0, cz, floorMat);
    this._floorCeil(4, 4, cx, H, cz, ceilMat, true);
    // North wall (outside of turn).
    this._wallBox(4, H, 0.2, cx, HH, cz - 2, wallMat);
    // West wall (outside of turn).
    this._wallBox(0.2, H, 4, cx - 2, HH, cz, wallMat);
    // South and east are open for corridor connections.
  }

  // ── Blender model loading (.glb) ────────────────────────────────────────
  //
  // Async loader with a built-in cache so each asset is fetched only once.
  // If the .glb file is not yet in src/assets/models/ the method logs a
  // warning and silently falls back to whatever placeholder geometry the
  // caller already placed — levels remain fully playable without models.

  /**
   * Load a Blender-exported .glb model and place it in the scene.
   * Returns a Promise that resolves to the THREE.Group (or null on failure).
   *
   * @param {string} path   relative path from project root, e.g. 'src/assets/models/scientist-npc.glb'
   * @param {number} x      world x
   * @param {number} y      world y
   * @param {number} z      world z
   * @param {object} opts   optional overrides
   * @param {number} opts.scale     uniform scale (default 1)
   * @param {number} opts.rotY      Y-axis rotation in radians (default 0)
   * @param {boolean} opts.collision add a static physics body (default false)
   * @param {number} opts.collisionRadius bounding-box half-extent for physics (default 0.5)
   * @returns {Promise<THREE.Group|null>}
   */
  async _loadModel(path, x, y, z, opts = {}) {
    const { scale = 1, rotY = 0, collision = false, collisionRadius = 0.5 } = opts;
    try {
      let gltf = this._modelCache.get(path);
      if (!gltf) {
        gltf = await this._gltfLoader.loadAsync(path);
        this._modelCache.set(path, gltf);
      }
      const model = gltf.scene.clone();
      model.position.set(x, y, z);
      model.scale.setScalar(scale);
      model.rotation.y = rotY;
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      this.scene.add(model);
      this._track(model);

      // Optional static physics body.
      if (collision) {
        const body = this.physics.createBox(
          0, collisionRadius, collisionRadius, collisionRadius,
          new CANNON.Vec3(x, y + collisionRadius, z)
        );
        this.physics.addSyncPair(body, model);
        this._track(model, body);
      }
      return model;
    } catch (err) {
      console.warn(`[LevelManager] Model not loaded: ${path} — ${err.message || err}`);
      return null;
    }
  }

  // ── Interactive systems ─────────────────────────────────────────────────

  /**
   * Create a sliding door that opens when its linked terminal is shot.
   * The door slides upward (Y+) and its collision body is removed when open.
   */
  _createDoor(id, w, h, x, y, z, rotY, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.15), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const body = this.physics.createBox(
      0, w / 2, h / 2, 0.075,
      new CANNON.Vec3(x, y, z)
    );
    this._track(mesh, body);
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

  /** Create a steam vent emitter at a world position. */
  _createSteamVent(id, x, y, z) {
    this._steamVents.push({ id, x, y, z, active: true, particles: [] });
  }

  /** Disable a steam vent by id (stops particle spawning). */
  disableVent(id) {
    const vent = this._steamVents.find(v => v.id === id);
    if (vent) vent.active = false;
  }

  /** Add a rotating hazard mesh (fan blade, spinning debris). */
  _addRotatingHazard(mesh, speed) {
    this._rotatingHazards.push({ mesh, speed });
  }

  /** Place a scorch decal (dark mark) on a surface. */
  _scorchDecal(x, y, z, size, rotY = 0) {
    if (!this._scorchTex) this._scorchTex = this._createScorchTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: this._scorchTex, transparent: true,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.position.set(x, y + 0.01, z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    this.scene.add(mesh);
    this._track(mesh);
    return mesh;
  }

  /** Called every frame from Game._loop — animate doors, steam, hazards. */
  update(dt) {
    // --- Doors: lerp upward once triggered ---
    for (const door of this._doors) {
      if (door.opening && door.progress < 1) {
        door.progress = Math.min(1, door.progress + dt * 0.8);
        const y = door.closedY + (door.openY - door.closedY) * door.progress;
        door.mesh.position.y = y;
        door.body.position.set(
          door.body.position.x, y, door.body.position.z
        );
        if (door.progress >= 1) {
          this.physics.world.removeBody(door.body);
        }
      }
    }
    // --- Steam vents: spawn + animate particles ---
    for (const vent of this._steamVents) {
      if (vent.active && vent.particles.length < 25 && Math.random() < 0.5) {
        if (!this._steamParticleMat) {
          this._steamParticleMat = new THREE.SpriteMaterial({
            color: 0xbbbbbb, transparent: true,
            opacity: 0.4, depthWrite: false,
          });
        }
        const sprite = new THREE.Sprite(this._steamParticleMat.clone());
        sprite.scale.set(0.25, 0.25, 1);
        sprite.position.set(
          vent.x + (Math.random() - 0.5) * 0.2,
          vent.y,
          vent.z + (Math.random() - 0.5) * 0.2
        );
        this.scene.add(sprite);
        vent.particles.push({
          mesh: sprite, life: 1.2,
          vy: 0.5 + Math.random() * 0.5,
        });
      }
      for (let i = vent.particles.length - 1; i >= 0; i--) {
        const p = vent.particles[i];
        p.life -= dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.material.opacity = Math.max(0, (p.life / 1.2) * 0.4);
        p.mesh.scale.multiplyScalar(1 + dt * 0.4);
        if (p.life <= 0) {
          this.scene.remove(p.mesh);
          p.mesh.material.dispose();
          vent.particles.splice(i, 1);
        }
      }
    }
    // --- Rotating hazards ---
    for (const { mesh, speed } of this._rotatingHazards) {
      mesh.rotation.y += speed * dt;
    }
  }

  // ── Level 1: Exploration — clean, brightly-lit corridors ─────────────
  //
  // Layout (top-down, player spawns at south end, walks north):
  //
  //   ┌────────────────────────┐
  //   │     REACTOR HALL       │  z = -24 to -36
  //   │     (16m × 12m)       │
  //   └────────┬───────────────┘
  //            │ corridor        z = -16 to -24
  //   ┌────────┴───────────────┐
  //   │    CONTROL ROOM        │  z = -6 to -16
  //   │    (10m × 10m)        │
  //   └────────────────────────┘
  //          ▲ spawn (0, 2, -7)
  //

  _buildLevel1() {
    const H = 3;     // wall/ceiling height (metres)
    const HH = H / 2; // half-height for wall box centres

    // Win triggers (checked by Game.js each frame).
    this._winTriggers = [
      { x: 0, z: -30, radius: 2.5 }, // reach the reactor core area
    ];

    // --- Procedural textures -------------------------------------------------
    const metalTex = this._createMetalTexture('#667788', '#556677');
    const floorTex = this._createConcreteTexture('#2a3040');
    floorTex.repeat.set(5, 5);
    const normalTex = this._createNormalTexture(12);
    normalTex.repeat.set(4, 4);
    const ceilTex = this._createMetalTexture('#aabbcc', '#99aabb');

    // --- Materials (PBR with procedural maps) --------------------------------
    const wallMat = new THREE.MeshStandardMaterial({
      map: metalTex, normalMap: normalTex, normalScale: new THREE.Vector2(0.4, 0.4),
      color: 0x778899, roughness: 0.35, metalness: 0.65,
    });
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex, normalMap: normalTex, normalScale: new THREE.Vector2(0.3, 0.3),
      color: 0x2a3040, roughness: 0.7, metalness: 0.3,
    });
    const ceilMat = new THREE.MeshStandardMaterial({
      map: ceilTex, color: 0xbbccdd, roughness: 0.9, metalness: 0.1,
    });
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x445566, roughness: 0.3, metalness: 0.8,
      normalMap: normalTex, normalScale: new THREE.Vector2(0.2, 0.2),
    });
    const reactorMat = new THREE.MeshStandardMaterial({
      color: 0x0066ff, emissive: 0x002244, roughness: 0.2, metalness: 0.9,
    });
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x999999, roughness: 0.4, metalness: 0.7,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x00aaff, emissive: 0x003366, roughness: 0.5, metalness: 0.6,
    });
    const lockerMat = new THREE.MeshStandardMaterial({
      color: 0x556070, roughness: 0.5, metalness: 0.7,
    });

    // ======================================================================
    // CONTROL ROOM  (x: -5 to 5, z: -6 to -16, 10m × 10m)
    // ======================================================================

    // Floor + ceiling.
    this._floorCeil(10, 10, 0, 0, -11, floorMat);
    this._floorCeil(10, 10, 0, H, -11, ceilMat, true);

    // South wall (solid — start of the station).
    this._wallBox(10, H, 0.2, 0, HH, -6, wallMat);

    // East wall (solid).
    this._wallBox(0.2, H, 10, 5, HH, -11, wallMat);

    // West wall (solid).
    this._wallBox(0.2, H, 10, -5, HH, -11, wallMat);

    // North wall — door gap 2.5m centred at x = 0.
    this._wallBox(3.75, H, 0.2, -3.125, HH, -16, wallMat); // left section
    this._wallBox(3.75, H, 0.2, 3.125, HH, -16, wallMat);  // right section
    // Sliding door (opens when terminal is shot).
    this._createDoor('l1-north', 2.5, H, 0, HH, -16, 0, panelMat);
    const l1Terminal = this._shootableTarget(0.6, 0.4, 4.85, 1.6, -10, 'terminal', Math.PI / 2);
    l1Terminal.userData.doorId = 'l1-north';

    // --- Control room props ---

    // Central console desk.
    this._propBox(3, 0.9, 1.2, 0, 0.45, -12, panelMat);

    // Console screen (angled on top of desk).
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.2, 0.05), accentMat
    );
    screen.position.set(0, 1.5, -12.3);
    screen.rotation.x = -0.2;
    this.scene.add(screen);
    this._track(screen);

    // Side control panels along east wall.
    this._propBox(0.4, 1.6, 2, 4.6, 0.8, -10, panelMat);
    this._propBox(0.4, 1.6, 2, 4.6, 0.8, -13, panelMat);

    // Side panels along west wall.
    this._propBox(0.4, 1.6, 2, -4.6, 0.8, -10, panelMat);
    this._propBox(0.4, 1.6, 2, -4.6, 0.8, -13, panelMat);

    // Corner pillars for visual depth.
    this._propBox(0.5, H, 0.5, 4.6, HH, -6.4, wallMat);
    this._propBox(0.5, H, 0.5, -4.6, HH, -6.4, wallMat);
    this._propBox(0.5, H, 0.5, 4.6, HH, -15.6, wallMat);
    this._propBox(0.5, H, 0.5, -4.6, HH, -15.6, wallMat);

    // ======================================================================
    // CORRIDOR  (x: -2 to 2, z: -16 to -24, 4m × 8m)
    // ======================================================================

    // Floor + ceiling.
    this._floorCeil(4, 8, 0, 0, -20, floorMat);
    this._floorCeil(4, 8, 0, H, -20, ceilMat, true);

    // East wall (solid).
    this._wallBox(0.2, H, 8, 2, HH, -20, wallMat);

    // West wall.
    this._wallBox(0.2, H, 8, -2, HH, -20, wallMat);

    // --- Side branch corridor (T-junction at z = -20, branches east) ---
    // Open a gap in the east wall at z = -20 for the branch.
    // Remove the solid east wall above and replace with split sections.
    // NOTE: The solid east wall was already placed above; we keep it and
    // add a branch alcove extending east from the corridor midpoint.
    // Side corridor floor + ceiling (4m long, extending east).
    this._floorCeil(4, 4, 4, 0, -20, floorMat);
    this._floorCeil(4, 4, 4, H, -20, ceilMat, true);
    // Side corridor walls (north + south of the branch).
    this._wallBox(4, H, 0.2, 4, HH, -18, wallMat); // north wall of branch
    this._wallBox(4, H, 0.2, 4, HH, -22, wallMat); // south wall of branch
    // East end wall of the branch.
    this._wallBox(0.2, H, 4, 6, HH, -20, wallMat);

    // Small storage room props in the side branch.
    this._propBox(0.6, 1.4, 0.6, 5.2, 0.7, -19, panelMat); // crate
    this._propBox(0.5, 1.8, 0.5, 5.4, 0.9, -21, lockerMat); // locker
    // Side branch ceiling pipe.
    this._propBox(4, 0.1, 0.1, 4, 2.8, -20, pipeMat);

    // --- Corridor props ---

    // Ceiling pipes (visual only — placed above head height).
    this._propCylinder(0.08, 0.08, 8, 1.5, 2.7, -20, pipeMat);
    this._propCylinder(0.08, 0.08, 8, -1.5, 2.7, -20, pipeMat);
    this._propCylinder(0.06, 0.06, 8, 0.8, 2.85, -20, pipeMat);

    // --- Blender model load hooks for lab equipment ---
    // These will replace the placeholder geometry above once the .glb files
    // are exported from Blender into src/assets/models/.
    this._loadModel('src/assets/models/lab-desk.glb', 0, 0, -12, {
      scale: 1, collision: true, collisionRadius: 0.6,
    });
    this._loadModel('src/assets/models/lab-computer.glb', -2, 0.75, -7.5, {
      scale: 0.8,
    });
    this._loadModel('src/assets/models/containment-tube.glb', -5, 0, -28, {
      scale: 1, collision: true, collisionRadius: 0.9,
    });

    // ======================================================================
    // REACTOR HALL  (x: -8 to 8, z: -24 to -36, 16m × 12m)
    // ======================================================================

    // Floor + ceiling.
    this._floorCeil(16, 12, 0, 0, -30, floorMat);
    this._floorCeil(16, 12, 0, H, -30, ceilMat, true);

    // South wall — door gap 2.5m centred at x = 0 (corridor entrance).
    this._wallBox(6.75, H, 0.2, -4.625, HH, -24, wallMat); // left
    this._wallBox(6.75, H, 0.2, 4.625, HH, -24, wallMat);  // right

    // North wall (solid — end of the station).
    this._wallBox(16, H, 0.2, 0, HH, -36, wallMat);

    // East wall (solid).
    this._wallBox(0.2, H, 12, 8, HH, -30, wallMat);

    // West wall (solid).
    this._wallBox(0.2, H, 12, -8, HH, -30, wallMat);

    // --- Reactor hall props ---

    // === EXPERIMENT ROOM — containment tube area (west side) ===
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x88ccff, transparent: true, opacity: 0.25,
      roughness: 0.05, metalness: 0.9,
    });
    const tubeFrameMat = new THREE.MeshStandardMaterial({
      color: 0x667788, roughness: 0.3, metalness: 0.8,
    });
    const specimenMat = new THREE.MeshStandardMaterial({
      color: 0x44dd66, emissive: 0x115522, emissiveIntensity: 0.5,
      roughness: 0.4, metalness: 0.3,
    });

    // Containment tube — large glass cylinder (where the creature grows).
    this._propCylinder(0.8, 0.8, 2.4, -5, 1.2, -28, glassMat, 16);
    // Tube metal frame rings (top and bottom).
    this._propCylinder(0.9, 0.9, 0.1, -5, 0.05, -28, tubeFrameMat, 16);
    this._propCylinder(0.9, 0.9, 0.1, -5, 2.45, -28, tubeFrameMat, 16);
    // Specimen inside the tube (greenish organic mass).
    this._propCylinder(0.35, 0.25, 1.2, -5, 0.9, -28, specimenMat, 8);
    // Tube base platform.
    this._propBox(2.2, 0.2, 2.2, -5, 0.1, -28, panelMat);

    // Scientist workstation next to the tube.
    this._propBox(1.5, 0.8, 0.7, -3.2, 0.4, -27, panelMat);
    // Monitor on workstation.
    const monitor = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.6, 0.05), accentMat
    );
    monitor.position.set(-3.2, 1.2, -27);
    monitor.rotation.x = -0.15;
    this.scene.add(monitor);
    this._track(monitor);

    // --- Scientist NPC placeholder (standing at the workstation) ---
    const npcGroup = new THREE.Group();
    const npcBodyMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.6 });
    const npcSkinMat = new THREE.MeshStandardMaterial({ color: 0xe0b090, roughness: 0.5 });
    // Lab coat body.
    const npcBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.9, 4, 8), npcBodyMat);
    npcBody.position.y = 0.85;
    npcBody.castShadow = true;
    npcGroup.add(npcBody);
    // Head.
    const npcHead = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), npcSkinMat);
    npcHead.position.y = 1.6;
    npcHead.castShadow = true;
    npcGroup.add(npcHead);
    // Clipboard (small box in front).
    const npcClipboard = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.28, 0.03), panelMat
    );
    npcClipboard.position.set(0.25, 1.0, 0.2);
    npcClipboard.rotation.x = -0.4;
    npcGroup.add(npcClipboard);
    npcGroup.position.set(-3.2, 0, -26);
    npcGroup.rotation.y = Math.PI * 0.7;
    this.scene.add(npcGroup);
    this._track(npcGroup);

    // Load Blender scientist-npc model when the asset is available.
    this._loadModel('src/assets/models/scientist-npc.glb', -3.2, 0, -26, {
      scale: 1, rotY: Math.PI * 0.7,
    }).then((model) => {
      // Swap: hide placeholder if the GLB loaded successfully.
      if (model) npcGroup.visible = false;
    });

    // --- Lab equipment props ---

    // Lab benches along the west wall.
    this._propBox(0.8, 0.85, 2.5, -7.2, 0.425, -26, panelMat);
    this._propBox(0.8, 0.85, 2.5, -7.2, 0.425, -34, panelMat);
    // Lab equipment on benches (small boxes = instruments).
    this._propBox(0.3, 0.25, 0.3, -7.2, 0.975, -25.5, accentMat);
    this._propBox(0.25, 0.2, 0.4, -7.2, 0.95, -26.5, pipeMat);
    this._propBox(0.35, 0.3, 0.25, -7.2, 1.0, -33.5, accentMat);

    // Computer console desks (east side of control room already has panels).
    // Additional desk with dual monitors near the south wall.
    this._propBox(1.8, 0.75, 0.8, -2, 0.375, -7.5, panelMat);
    const deskMonitor1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.45, 0.04), accentMat
    );
    deskMonitor1.position.set(-2.3, 1.15, -7.5);
    deskMonitor1.rotation.x = -0.12;
    this.scene.add(deskMonitor1);
    this._track(deskMonitor1);
    const deskMonitor2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.45, 0.04), accentMat
    );
    deskMonitor2.position.set(-1.7, 1.15, -7.5);
    deskMonitor2.rotation.x = -0.12;
    this.scene.add(deskMonitor2);
    this._track(deskMonitor2);

    // Central reactor core (tall glowing cylinder).
    this._propCylinder(1.5, 1.5, 2.8, 0, 1.4, -30, reactorMat, 24);

    // Reactor base platform.
    this._propBox(4, 0.3, 4, 0, 0.15, -30, panelMat);

    // Reactor top ring.
    this._propCylinder(1.8, 1.8, 0.15, 0, 2.85, -30, accentMat, 24);

    // Energy conduit from reactor to containment tube.
    this._propBox(3.0, 0.08, 0.08, -2.5, 0.2, -29, accentMat);
    this._propBox(0.08, 0.08, 1.5, -4.0, 0.2, -28.5, accentMat);

    // Support pillars (4 corners around reactor).
    const pillarPositions = [
      [3.5, -27], [-3.5, -27], [3.5, -33], [-3.5, -33],
    ];
    for (const [px, pz] of pillarPositions) {
      this._propCylinder(0.25, 0.25, H, px, HH, pz, wallMat, 8);
    }

    // Side machinery banks (east side).
    this._propBox(1, 2, 3, 6.5, 1, -28, panelMat);
    this._propBox(1, 2, 3, 6.5, 1, -32, panelMat);
    // East wall shelving units.
    this._propBox(0.4, 1.8, 1.5, 7.5, 0.9, -26, panelMat);
    this._propBox(0.4, 1.8, 1.5, 7.5, 0.9, -34, panelMat);

    // West side — experiment area divider (low wall).
    this._propBox(0.15, 1.2, 6, -3, 0.6, -30, wallMat);

    // Floor guide strips (glowing path lines to guide the player).
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0x00aaff, emissive: 0x003366, emissiveIntensity: 0.4,
      roughness: 0.5, metalness: 0.5,
    });
    this._propBox(0.1, 0.01, 18, 0, 0.005, -21, stripMat);
    this._propBox(6, 0.01, 0.1, -3, 0.005, -30, stripMat);

    // Overhead pipes across the reactor hall.
    this._propCylinder(0.1, 0.1, 16, 0, 2.8, -27, pipeMat);
    this._propCylinder(0.1, 0.1, 16, 0, 2.8, -33, pipeMat);
    // Rotate horizontal pipes 90° around Z so they run east-west.
    // (The last two _propCylinder calls created vertical cylinders.
    //  We need horizontal ones.  Let's fix by adding rotation.)
    // Actually CylinderGeometry is vertical by default. For horizontal
    // pipes running east-west we need to rotate the mesh.
    // Easier approach: just use box geometry for overhead pipes.
    this._propBox(16, 0.12, 0.12, 0, 2.75, -27, pipeMat);
    this._propBox(16, 0.12, 0.12, 0, 2.75, -33, pipeMat);
    this._propBox(0.12, 0.12, 12, 4, 2.85, -30, pipeMat);
    this._propBox(0.12, 0.12, 12, -4, 2.85, -30, pipeMat);

    // ======================================================================
    // PULSE TOOL TARGETS — Level 1 (terminals & conduits)
    // ======================================================================
    // Control room — wall terminals (east wall terminal already added as door trigger above).
    this._shootableTarget(0.6, 0.4, 4.85, 1.6, -13, 'terminal', Math.PI / 2);
    this._shootableTarget(0.6, 0.4, -4.85, 1.6, -10, 'terminal', -Math.PI / 2); // west wall
    this._shootableTarget(0.6, 0.4, -4.85, 1.6, -13, 'terminal', -Math.PI / 2);

    // Corridor — ceiling conduit panels.
    this._shootableTarget(0.4, 0.3, 1.5, 2.6, -18, 'conduit');
    this._shootableTarget(0.4, 0.3, -1.5, 2.6, -22, 'conduit');

    // Reactor hall — machinery bank terminals.
    this._shootableTarget(0.8, 0.5, 5.9, 1.5, -28, 'terminal', Math.PI / 2);
    this._shootableTarget(0.8, 0.5, -5.9, 1.5, -32, 'terminal', -Math.PI / 2);

    // --- Scorch decals (near reactor and machinery) ---
    this._scorchDecal(1.5, 0, -28, 1.2);
    this._scorchDecal(-1.0, 0, -32, 0.9);
    this._scorchDecal(5.5, 0, -30, 1.0);

    // --- Per-level fog settings ---
    this.fogColor = 0x0a0e14;
    this.fogNear = 25;
    this.fogFar = 90;
  }

  // ── Level 2: The Hunt — damaged facility, stealth + evasion ──────────
  //
  // Same layout as Level 1 but damaged.  Monster patrols through corridors.
  // Player hides behind lockers / crates, sneaks past, reaches emergency exit.
  //
  //   ┌────────────────────────┐
  //   │  REACTOR HALL (damaged)│  z = -24 to -36
  //   │  collapsed north end   │  ★ emergency exit north wall
  //   └────────┬───────────────┘
  //            │ corridor        z = -16 to -24
  //   ┌────────┴───────────────┐
  //   │  CONTROL ROOM (damaged)│  z = -6 to -16
  //   │  hiding spots (lockers)│  ▲ spawn (0, 2, -7)
  //   └────────────────────────┘
  //
  _buildLevel2() {
    const H = 3;
    const HH = H / 2;

    // Win triggers (checked by Game.js each frame).
    this._winTriggers = [
      { x: 0, z: -34.5, radius: 1.5 }, // emergency exit at north wall
    ];

    // --- Procedural textures (darker, dirtier) --------------------------------
    const rustTex = this._createMetalTexture('#5a4a3a', '#4a3a2a');
    const dmgFloorTex = this._createConcreteTexture('#2a2218');
    dmgFloorTex.repeat.set(5, 5);
    const dmgNormal = this._createNormalTexture(18);
    dmgNormal.repeat.set(4, 4);
    const dmgCeilTex = this._createMetalTexture('#3a3028', '#2a2018');

    // --- Materials (damaged, darker, with procedural maps) -------------------
    const wallMat = new THREE.MeshStandardMaterial({
      map: rustTex, normalMap: dmgNormal, normalScale: new THREE.Vector2(0.5, 0.5),
      color: 0x5a4a3a, roughness: 0.75, metalness: 0.4,
    });
    const floorMat = new THREE.MeshStandardMaterial({
      map: dmgFloorTex, normalMap: dmgNormal, normalScale: new THREE.Vector2(0.4, 0.4),
      color: 0x2a2218, roughness: 0.85, metalness: 0.2,
    });
    const ceilMat = new THREE.MeshStandardMaterial({
      map: dmgCeilTex, color: 0x3a3028, roughness: 0.9, metalness: 0.1,
    });
    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0x4a4035, roughness: 0.9, metalness: 0.2,
    });
    const lockerMat = new THREE.MeshStandardMaterial({
      color: 0x556070, roughness: 0.5, metalness: 0.7,
    });
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x6b5a45, roughness: 0.8, metalness: 0.15,
    });
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x887766, roughness: 0.5, metalness: 0.6,
    });
    const hazardMat = new THREE.MeshStandardMaterial({
      color: 0xff8800, emissive: 0x552200, emissiveIntensity: 0.5,
      roughness: 0.4, metalness: 0.3,
    });
    const exitMat = new THREE.MeshStandardMaterial({
      color: 0x00ff44, emissive: 0x00ff44, emissiveIntensity: 0.8,
      roughness: 0.2, metalness: 0.5,
    });
    const damagedPanelMat = new THREE.MeshStandardMaterial({
      color: 0x3d3530, roughness: 0.7, metalness: 0.5,
    });

    // ======================================================================
    // CONTROL ROOM  (same footprint as L1: x: -5 to 5, z: -6 to -16)
    // ======================================================================
    this._floorCeil(10, 10, 0, 0, -11, floorMat);
    this._floorCeil(10, 10, 0, H, -11, ceilMat, true);

    // South wall — intact.
    this._wallBox(10, H, 0.2, 0, HH, -6, wallMat);
    // East wall — gap near z = -12 (breach in the hull).
    this._wallBox(0.2, H, 4.5, 5, HH, -8.25, wallMat);
    this._wallBox(0.2, H, 2.5, 5, HH, -14.75, wallMat);
    // West wall — intact.
    this._wallBox(0.2, H, 10, -5, HH, -11, wallMat);
    // North wall — door gap 2.5m centred at x = 0.
    this._wallBox(3.75, H, 0.2, -3.125, HH, -16, wallMat);
    this._wallBox(3.75, H, 0.2, 3.125, HH, -16, wallMat);
    // Damaged sliding door (opens when conduit is shot).
    this._createDoor('l2-north', 2.5, H, 0, HH, -16, 0, damagedPanelMat);
    const l2Conduit = this._shootableTarget(0.5, 0.35, 1.85, 2.0, -16, 'conduit', Math.PI / 2);
    l2Conduit.userData.doorId = 'l2-north';

    // --- Hiding spots: lockers along west wall ---
    this._propBox(0.6, 2.0, 0.5, -4.3, 1.0, -8, lockerMat);
    this._propBox(0.6, 2.0, 0.5, -4.3, 1.0, -9.2, lockerMat);
    this._propBox(0.6, 2.0, 0.5, -4.3, 1.0, -13.5, lockerMat);

    // --- Overturned desks for cover ---
    this._propBox(1.8, 0.12, 0.9, 2.5, 0.45, -10, debrisMat);
    this._propBox(1.8, 0.12, 0.9, -1.5, 0.35, -12, debrisMat);

    // --- Scattered debris (random rotation for organic feel) ---
    const debris1 = this._propBox(0.6, 0.25, 0.4, 3.2, 0.125, -8.5, debrisMat);
    debris1.rotation.y = 0.25; debris1.rotation.z = -0.08;
    const debris2 = this._propBox(0.4, 0.18, 0.3, 1.0, 0.09, -14.2, debrisMat);
    debris2.rotation.y = -0.35;
    const debris3 = this._propBox(0.8, 0.3, 0.5, -2.8, 0.15, -7.5, debrisMat);
    debris3.rotation.y = 0.6; debris3.rotation.x = 0.05;
    const debris4 = this._propBox(0.3, 0.4, 0.3, 4.0, 0.2, -11.5, debrisMat);
    debris4.rotation.y = -0.18; debris4.rotation.z = 0.12;

    // --- Fallen ceiling panel (angled) ---
    const fallenPanel = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.08, 1.5), ceilMat
    );
    fallenPanel.position.set(3.0, 0.6, -9.0);
    fallenPanel.rotation.z = 0.35;
    fallenPanel.rotation.y = 0.2;
    fallenPanel.castShadow = true;
    this.scene.add(fallenPanel);
    this._track(fallenPanel);

    // --- Broken console (sparking) ---
    this._propBox(1.2, 0.7, 0.6, 0, 0.35, -12.5, damagedPanelMat);

    // --- Crates near east wall breach ---
    this._propBox(0.8, 0.8, 0.8, 4.0, 0.4, -11, crateMat);
    this._propBox(0.6, 0.6, 0.6, 3.5, 0.3, -12.5, crateMat);

    // Corner pillars (partially damaged — one missing).
    this._propBox(0.5, H, 0.5, -4.6, HH, -6.4, wallMat);
    this._propBox(0.5, H, 0.5, 4.6, HH, -15.6, wallMat);

    // ======================================================================
    // CORRIDOR  (x: -2 to 2, z: -16 to -24)
    // ======================================================================
    this._floorCeil(4, 8, 0, 0, -20, floorMat);
    this._floorCeil(4, 8, 0, H, -20, ceilMat, true);

    // East wall — partial collapse (gap in the middle).
    this._wallBox(0.2, H, 3.0, 2, HH, -17.5, wallMat);
    this._wallBox(0.2, H, 2.5, 2, HH, -22.75, wallMat);
    // West wall — mostly intact with a small gap.
    this._wallBox(0.2, H, 5.5, -2, HH, -18.75, wallMat);
    this._wallBox(0.2, H, 1.5, -2, HH, -23.25, wallMat);

    // --- Corridor debris (rubble from ceiling collapse) ---
    this._propBox(1.0, 0.35, 0.7, 0.5, 0.175, -19, debrisMat);
    this._propBox(0.7, 0.45, 0.5, -0.8, 0.225, -21, debrisMat);
    this._propBox(0.5, 0.2, 0.4, 1.2, 0.1, -17.5, debrisMat);

    // Ceiling pipes — some broken, dangling at angles.
    this._propCylinder(0.08, 0.08, 5, 1.5, 2.7, -18.5, pipeMat);
    const brokenPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 2.5, 8), pipeMat
    );
    brokenPipe.position.set(-1.3, 2.2, -20.5);
    brokenPipe.rotation.z = 0.6;
    brokenPipe.castShadow = true;
    this.scene.add(brokenPipe);
    this._track(brokenPipe);

    // Locker in corridor (hiding spot).
    this._propBox(0.5, 1.8, 0.5, -1.6, 0.9, -19.5, lockerMat);

    // Crate stack for cover.
    this._propBox(0.8, 0.7, 0.8, 1.5, 0.35, -22, crateMat);
    this._propBox(0.6, 0.5, 0.6, 1.5, 0.95, -22, crateMat);

    // ======================================================================
    // REACTOR HALL  (x: -8 to 8, z: -24 to -36)
    // ======================================================================
    this._floorCeil(16, 12, 0, 0, -30, floorMat);
    this._floorCeil(16, 12, 0, H, -30, ceilMat, true);

    // South wall — door gap for corridor entrance.
    this._wallBox(6.75, H, 0.2, -4.625, HH, -24, wallMat);
    this._wallBox(6.75, H, 0.2, 4.625, HH, -24, wallMat);
    // North wall — solid (emergency exit cut into it).
    this._wallBox(6.5, H, 0.2, -4.75, HH, -36, wallMat);
    this._wallBox(6.5, H, 0.2, 4.75, HH, -36, wallMat);
    // East wall — large breach (section missing).
    this._wallBox(0.2, H, 5.0, 8, HH, -26.5, wallMat);
    this._wallBox(0.2, H, 4.0, 8, HH, -34, wallMat);
    // West wall — mostly intact.
    this._wallBox(0.2, H, 12, -8, HH, -30, wallMat);

    // --- Damaged reactor core (tilted, flickering) ---
    const damagedReactor = this._propCylinder(
      1.5, 1.5, 2.8, 0, 1.4, -30,
      new THREE.MeshStandardMaterial({
        color: 0x334455, emissive: 0x112233, emissiveIntensity: 0.3,
        roughness: 0.6, metalness: 0.7,
      }), 24
    );
    damagedReactor.rotation.z = 0.08; // slightly tilted
    damagedReactor.rotation.x = 0.05;
    this._propBox(4, 0.3, 4, 0, 0.15, -30, damagedPanelMat);

    // --- Large debris piles (cover from monster, random rotation) ---
    const pile1 = this._propBox(2.0, 0.6, 1.2, 5.0, 0.3, -27, debrisMat);
    pile1.rotation.y = 0.15;
    const pile2 = this._propBox(1.5, 0.5, 1.5, -5.5, 0.25, -28, debrisMat);
    pile2.rotation.y = -0.22; pile2.rotation.z = 0.04;
    const pile3 = this._propBox(1.8, 0.8, 0.8, 3.5, 0.4, -33, debrisMat);
    pile3.rotation.y = 0.4;
    const pile4 = this._propBox(1.2, 0.4, 1.0, -4.0, 0.2, -32, debrisMat);
    pile4.rotation.y = -0.3;
    const pile5 = this._propBox(2.5, 0.7, 1.0, 0, 0.35, -26, debrisMat);
    pile5.rotation.y = 0.12;

    // --- Crates and lockers for hiding ---
    this._propBox(0.8, 1.4, 0.8, -6.5, 0.7, -26, crateMat);
    this._propBox(0.8, 1.4, 0.8, -6.5, 0.7, -34, crateMat);
    this._propBox(0.6, 2.0, 0.5, 6.5, 1.0, -30, lockerMat);

    // --- Collapsed ceiling sections (large debris on floor) ---
    this._propBox(3.0, 0.12, 2.5, 4.5, 0.06, -29, ceilMat);
    this._propBox(2.0, 0.10, 2.0, -3.0, 0.05, -31, ceilMat);

    // --- Fallen support pillars ---
    const fallenPillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 3.0, 8), wallMat
    );
    fallenPillar.position.set(3.5, 0.25, -28);
    fallenPillar.rotation.z = Math.PI / 2;
    fallenPillar.castShadow = true;
    this.scene.add(fallenPillar);
    this._track(fallenPillar);

    // Standing pillar remnants.
    this._propCylinder(0.25, 0.25, H, -3.5, HH, -27, wallMat, 8);
    this._propCylinder(0.25, 0.25, 1.5, 3.5, 0.75, -33, wallMat, 8);

    // --- Overhead pipes (some intact, some broken) ---
    this._propBox(16, 0.12, 0.12, 0, 2.75, -27, pipeMat);
    this._propBox(10, 0.12, 0.12, -3, 2.75, -33, pipeMat);
    this._propBox(0.12, 0.12, 12, -4, 2.85, -30, pipeMat);

    // ======================================================================
    // EMERGENCY EXIT — north wall, centre (glowing green marker)
    // ======================================================================
    const exitMarker = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 2.2, 0.1), exitMat
    );
    exitMarker.position.set(0, 1.1, -35.85);
    this.scene.add(exitMarker);
    this._track(exitMarker);
    // Exit frame (visual border around the door).
    this._propBox(1.8, 0.1, 0.15, 0, 2.25, -35.8, hazardMat);
    this._propBox(0.1, 2.2, 0.15, -0.85, 1.1, -35.8, hazardMat);
    this._propBox(0.1, 2.2, 0.15, 0.85, 1.1, -35.8, hazardMat);

    // ======================================================================
    // MONSTER PATROL WAYPOINTS (for Zandile's AI)
    // ======================================================================
    this._monsterWaypoints = [
      { x: 0, z: -26 },
      { x: 5, z: -27 },
      { x: 5, z: -33 },
      { x: 0, z: -34 },
      { x: -5, z: -33 },
      { x: -5, z: -27 },
      { x: 0, z: -20 },
      { x: 0, z: -10 },
    ];

    // ======================================================================
    // SHOOTABLE TARGETS
    // ======================================================================
    // Power conduits — shoot to open doors / restore power.
    this._shootableTarget(0.5, 0.35, 1.85, 2.0, -16, 'conduit', Math.PI / 2);
    this._shootableTarget(0.5, 0.35, -1.85, 2.0, -22, 'conduit', -Math.PI / 2);
    this._shootableTarget(0.6, 0.4, 4.85, 1.6, -10, 'conduit', Math.PI / 2);
    // Coolant valves — shoot to stop steam vents.
    const valve1 = this._shootableTarget(0.4, 0.3, 6.0, 1.2, -28, 'hazard', Math.PI / 2);
    valve1.userData.ventId = 'l2-vent-1';
    this._createSteamVent('l2-vent-1', 6.0, 0.3, -28);
    const valve2 = this._shootableTarget(0.4, 0.3, -6.0, 1.2, -32, 'hazard', -Math.PI / 2);
    valve2.userData.ventId = 'l2-vent-2';
    this._createSteamVent('l2-vent-2', -6.0, 0.3, -32);
    this._shootableTarget(0.4, 0.3, 0, 2.5, -26.5, 'hazard');

    // --- Blender model load hooks for Level 2 equipment ---
    this._loadModel('src/assets/models/lab-desk.glb', 0, 0, -12.5, {
      scale: 0.9, rotY: 0.3, collision: true, collisionRadius: 0.5,
    });
    this._loadModel('src/assets/models/lab-equipment.glb', 4.0, 0, -11, {
      scale: 0.7,
    });

    // ======================================================================
    // HEAT-HAZE ZONE MARKERS (for Kutloano's shader)
    // ======================================================================
    const hazeZones = [
      { x: 6.5, z: -28 },
      { x: -6.5, z: -32 },
      { x: 0, z: -30 },
    ];
    this.heatHazeZones = hazeZones.map(({ x, z }) => {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2.5),
        new THREE.MeshBasicMaterial({
          color: 0xff6600, transparent: true, opacity: 0.12,
          side: THREE.DoubleSide,
        })
      );
      plane.position.set(x, 1.5, z);
      plane.userData.heatHaze = true;
      this.scene.add(plane);
      this._track(plane);
      return plane;
    });

    // --- Rotating hazard: exposed fan blade in corridor ceiling ---
    const fanMat = new THREE.MeshStandardMaterial({
      color: 0x555555, roughness: 0.5, metalness: 0.8,
    });
    const fanBlade = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.05, 0.3), fanMat
    );
    fanBlade.position.set(0, 2.6, -20);
    fanBlade.castShadow = true;
    this.scene.add(fanBlade);
    this._track(fanBlade);
    this._addRotatingHazard(fanBlade, 3.0); // 3 rad/s

    // --- Scorch decals (near hazards and damage) ---
    this._scorchDecal(5.5, 0, -28, 1.5);
    this._scorchDecal(-5.0, 0, -32, 1.2);
    this._scorchDecal(0, 0, -26.5, 1.0);
    this._scorchDecal(3.0, 0, -9.0, 0.8);

    // --- Per-level fog settings ---
    this.fogColor = 0x120a04;
    this.fogNear = 15;
    this.fogFar = 60;
  }

  // ── Level 3: The Collapse — boss arena + timed escape ───────────────
  //
  // Boss fight in a large arena.  Defeat the monster (shoot 3 weak points),
  // then sprint through the escape corridor before the timer expires.
  //
  //   ▲ spawn (0, 2, 8)
  //   ┌────────┐
  //   │ ESCAPE │  z = -2 to 8   (corridor to exit)
  //   │ DOOR ★ │
  //   └────┬───┘
  //        │ escape corridor  z = -2 to -10
  //   ┌────┴───────────────────┐
  //   │     BOSS ARENA         │  z = -10 to -40
  //   │     (24m × 30m)        │
  //   │   monster spawns (0,-25)│
  //   └────────────────────────┘
  //
  _buildLevel3() {
    const H = 4;     // taller ceiling for boss arena drama
    const HH = H / 2;

    // Win triggers — escape door only activates after monster is dead.
    this._winTriggers = [
      { x: 0, z: 6, radius: 2.0, needMonsterDead: true },
    ];

    // --- Procedural textures (scorched, emergency) ----------------------------
    const scorchTex = this._createMetalTexture('#4a2020', '#3a1515');
    const l3FloorTex = this._createConcreteTexture('#1a0808');
    l3FloorTex.repeat.set(6, 8);
    const l3Normal = this._createNormalTexture(22);
    l3Normal.repeat.set(5, 5);
    const l3CeilTex = this._createMetalTexture('#2a1515', '#1a0a0a');

    // --- Materials (scorched, with procedural maps) --------------------------
    const wallMat = new THREE.MeshStandardMaterial({
      map: scorchTex, normalMap: l3Normal, normalScale: new THREE.Vector2(0.6, 0.6),
      color: 0x4a2020, roughness: 0.75, metalness: 0.4,
    });
    const floorMat = new THREE.MeshStandardMaterial({
      map: l3FloorTex, normalMap: l3Normal, normalScale: new THREE.Vector2(0.5, 0.5),
      color: 0x1a0808, roughness: 0.85, metalness: 0.2,
    });
    const ceilMat = new THREE.MeshStandardMaterial({
      map: l3CeilTex, color: 0x2a1515, roughness: 0.9, metalness: 0.1,
    });
    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0x3a2222, roughness: 0.9, metalness: 0.2,
    });
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x553333, roughness: 0.6, metalness: 0.5,
    });
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x887766, roughness: 0.5, metalness: 0.6,
    });
    const emergencyMat = new THREE.MeshStandardMaterial({
      color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 0.6,
      roughness: 0.3, metalness: 0.4,
    });
    const exitMat = new THREE.MeshStandardMaterial({
      color: 0x00ff44, emissive: 0x00ff44, emissiveIntensity: 0.8,
      roughness: 0.2, metalness: 0.5,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x444444, roughness: 0.4, metalness: 0.8,
    });
    const warningMat = new THREE.MeshStandardMaterial({
      color: 0xffaa00, emissive: 0x553300, emissiveIntensity: 0.5,
      roughness: 0.4, metalness: 0.3,
    });

    // ======================================================================
    // BOSS ARENA  (x: -12 to 12, z: -10 to -40, 24m × 30m)
    // ======================================================================
    this._floorCeil(24, 30, 0, 0, -25, floorMat);
    this._floorCeil(24, 30, 0, H, -25, ceilMat, true);

    // South wall — opening for escape corridor (3m gap centred at x = 0).
    this._wallBox(10.5, H, 0.2, -6.75, HH, -10, wallMat);
    this._wallBox(10.5, H, 0.2, 6.75, HH, -10, wallMat);
    // North wall (solid — back of the arena).
    this._wallBox(24, H, 0.2, 0, HH, -40, wallMat);
    // East wall (solid).
    this._wallBox(0.2, H, 30, 12, HH, -25, wallMat);
    // West wall (solid).
    this._wallBox(0.2, H, 30, -12, HH, -25, wallMat);

    // --- Cover pillars (ring of 8 around the arena) ---
    const arenaPillars = [
      [-6, -16], [6, -16], [-6, -25], [6, -25],
      [-6, -34], [6, -34], [0, -20], [0, -30],
    ];
    for (const [px, pz] of arenaPillars) {
      this._propCylinder(0.4, 0.4, H, px, HH, pz, pillarMat, 8);
    }

    // --- Fallen debris from collapsing ceiling (random rotation) ---
    const d1 = this._propBox(2.5, 0.5, 1.5, 4, 0.25, -18, debrisMat);
    d1.rotation.y = 0.35; d1.rotation.z = 0.06;
    const d2 = this._propBox(1.8, 0.6, 2.0, -7, 0.3, -22, debrisMat);
    d2.rotation.y = -0.28;
    const d3 = this._propBox(3.0, 0.4, 1.2, 8, 0.2, -30, debrisMat);
    d3.rotation.y = 0.55; d3.rotation.x = -0.04;
    const d4 = this._propBox(2.0, 0.7, 1.8, -5, 0.35, -35, debrisMat);
    d4.rotation.y = -0.4; d4.rotation.z = 0.08;
    const d5 = this._propBox(1.5, 0.3, 2.5, 3, 0.15, -37, debrisMat);
    d5.rotation.y = 0.7;
    const d6 = this._propBox(1.2, 0.5, 1.0, -9, 0.25, -15, debrisMat);
    d6.rotation.y = -0.15; d6.rotation.z = -0.1;
    const d7 = this._propBox(2.2, 0.4, 1.5, 9, 0.2, -28, debrisMat);
    d7.rotation.y = 0.22;

    // --- Collapsed ceiling sections (tagged for dissolve shader) ---
    this._dissolveWalls = [];
    const dissolvePositions = [
      { x: -8, z: -15, w: 3, d: 3 },
      { x: 8, z: -35, w: 4, d: 3 },
      { x: -4, z: -38, w: 5, d: 2 },
      { x: 10, z: -20, w: 2, d: 4 },
    ];
    for (const { x, z, w, d } of dissolvePositions) {
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.3, d), ceilMat
      );
      block.position.set(x, 0.15, z);
      block.castShadow = true;
      block.receiveShadow = true;
      block.userData.dissolveTarget = true;
      this.scene.add(block);
      this._track(block);
      this._dissolveWalls.push(block);
    }

    // --- Overhead pipes (some broken, hanging) ---
    this._propBox(24, 0.12, 0.12, 0, H - 0.15, -18, pipeMat);
    this._propBox(24, 0.12, 0.12, 0, H - 0.15, -32, pipeMat);
    this._propBox(0.12, 0.12, 30, -8, H - 0.1, -25, pipeMat);
    this._propBox(0.12, 0.12, 30, 8, H - 0.1, -25, pipeMat);
    // Broken hanging pipe.
    const hangPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 3.5, 8), pipeMat
    );
    hangPipe.position.set(5, 2.5, -22);
    hangPipe.rotation.z = 0.7;
    hangPipe.castShadow = true;
    this.scene.add(hangPipe);
    this._track(hangPipe);

    // --- Emergency lighting strips along walls ---
    this._propBox(0.08, 0.08, 28, 11.85, 0.5, -25, emergencyMat);
    this._propBox(0.08, 0.08, 28, -11.85, 0.5, -25, emergencyMat);
    this._propBox(22, 0.08, 0.08, 0, 0.5, -39.85, emergencyMat);

    // --- Warning signs near escape corridor ---
    this._propBox(0.08, 0.6, 0.4, -1.6, 2.0, -10.15, warningMat);
    this._propBox(0.08, 0.6, 0.4, 1.6, 2.0, -10.15, warningMat);

    // --- Side machinery (damaged) ---
    this._propBox(1.2, 1.8, 2.0, 10.5, 0.9, -15, metalMat);
    this._propBox(1.2, 1.8, 2.0, 10.5, 0.9, -35, metalMat);
    this._propBox(1.2, 1.5, 1.5, -10.5, 0.75, -20, metalMat);
    this._propBox(1.2, 1.5, 1.5, -10.5, 0.75, -32, metalMat);

    // ======================================================================
    // ESCAPE CORRIDOR  (x: -2 to 2, z: -10 to -2, 4m × 8m)
    // ======================================================================
    this._floorCeil(4, 8, 0, 0, -6, floorMat);
    this._floorCeil(4, 8, 0, H, -6, ceilMat, true);
    this._wallBox(0.2, H, 8, 2, HH, -6, wallMat);
    this._wallBox(0.2, H, 8, -2, HH, -6, wallMat);
    // Debris in escape corridor.
    this._propBox(0.6, 0.3, 0.5, 1.2, 0.15, -5, debrisMat);
    this._propBox(0.4, 0.25, 0.4, -0.8, 0.125, -7, debrisMat);
    // Emergency strip on floor.
    this._propBox(0.1, 0.01, 8, 0, 0.005, -6, emergencyMat);

    // ======================================================================
    // ESCAPE DOOR + EXIT ROOM  (south end of corridor, z = -2 to 4)
    // ======================================================================
    // South wall with door gap.
    this._wallBox(0.75, H, 0.2, -1.625, HH, -2, wallMat);
    this._wallBox(0.75, H, 0.2, 1.625, HH, -2, wallMat);
    // Open area beyond the door (trigger zone here).
    this._floorCeil(6, 6, 0, 0, 1, floorMat);
    this._floorCeil(6, 6, 0, H, 1, ceilMat, true);
    this._wallBox(6, H, 0.2, 0, HH, 4, wallMat);
    this._wallBox(0.2, H, 6, 3, HH, 1, wallMat);
    this._wallBox(0.2, H, 6, -3, HH, 1, wallMat);
    // Exit marker (glowing green).
    const exitMarker = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 2.5, 0.1), exitMat
    );
    exitMarker.position.set(0, 1.25, 3.9);
    this.scene.add(exitMarker);
    this._track(exitMarker);
    // Exit sign above door.
    this._propBox(1.0, 0.3, 0.08, 0, 3.2, -1.9, exitMat);

    // ======================================================================
    // MONSTER PATROL WAYPOINTS (boss arena perimeter)
    // ======================================================================
    this._monsterWaypoints = [
      { x: 0, y: 0, z: -15 },
      { x: 8, y: 0, z: -18 },
      { x: 8, y: 0, z: -32 },
      { x: 0, y: 0, z: -36 },
      { x: -8, y: 0, z: -32 },
      { x: -8, y: 0, z: -18 },
    ];

    // ======================================================================
    // SHOOTABLE TARGETS — cooling systems, corridor conduits
    // ======================================================================
    this._shootableTarget(0.5, 0.4, 11.85, 1.5, -15, 'hazard', Math.PI / 2);
    this._shootableTarget(0.5, 0.4, 11.85, 1.5, -35, 'hazard', Math.PI / 2);
    this._shootableTarget(0.5, 0.4, -11.85, 1.5, -20, 'hazard', -Math.PI / 2);
    this._shootableTarget(0.5, 0.4, -11.85, 1.5, -32, 'hazard', -Math.PI / 2);
    this._shootableTarget(0.4, 0.3, 1.85, 2.0, -6, 'conduit', Math.PI / 2);
    this._shootableTarget(0.4, 0.3, -1.85, 2.0, -4, 'conduit', -Math.PI / 2);

    // --- Blender model load hooks for Level 3 boss arena equipment ---
    this._loadModel('src/assets/models/lab-equipment.glb', 10.5, 0, -15, {
      scale: 1.1, rotY: Math.PI / 2, collision: true, collisionRadius: 0.6,
    });
    this._loadModel('src/assets/models/lab-equipment.glb', -10.5, 0, -20, {
      scale: 0.9, rotY: -Math.PI / 2, collision: true, collisionRadius: 0.6,
    });

    // ======================================================================
    // DISSOLVE SHADER ZONE MARKERS (for Kutloano)
    // ======================================================================
    const dissolveZonePositions = [
      { x: -8, z: -15 },
      { x: 8, z: -35 },
      { x: 0, z: -38 },
    ];
    this.dissolveZones = dissolveZonePositions.map(({ x, z }) => {
      const marker = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 3),
        new THREE.MeshBasicMaterial({
          color: 0xff3300, transparent: true, opacity: 0.08,
          side: THREE.DoubleSide,
        })
      );
      marker.position.set(x, 2, z);
      marker.userData.dissolveZone = true;
      this.scene.add(marker);
      this._track(marker);
      return marker;
    });

    // --- Rotating hazard: swinging debris arm in arena ---
    const swingMat = new THREE.MeshStandardMaterial({
      color: 0x665555, roughness: 0.6, metalness: 0.5,
    });
    const swingArm = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.12, 0.12), swingMat
    );
    swingArm.position.set(-6, 2.8, -25);
    swingArm.castShadow = true;
    this.scene.add(swingArm);
    this._track(swingArm);
    this._addRotatingHazard(swingArm, 1.5); // slower, menacing swing

    // --- Scorch decals (explosions and collapse damage) ---
    this._scorchDecal(3, 0, -18, 2.0);
    this._scorchDecal(-6, 0, -22, 1.8);
    this._scorchDecal(7, 0, -30, 1.5);
    this._scorchDecal(-4, 0, -35, 2.2);
    this._scorchDecal(0, 0, -38, 1.6);
    this._scorchDecal(9, 0, -15, 1.3);

    // --- Per-level fog settings ---
    this.fogColor = 0x0a0000;
    this.fogNear = 10;
    this.fogFar = 45;
  }

  /**
   * Register a mesh + optional physics body for cleanup.
   * Call this for every object you add so _teardown can dispose it.
   */
  _track(mesh, body = null) {
    this._disposables.push({ mesh, body });
  }

  // ── Public getters for cross-system integration ──────────────────────────

  /** Monster patrol waypoints for the current level (used by Game._setupMonster). */
  get monsterWaypoints() { return this._monsterWaypoints; }

  /** Win trigger zones for the current level (checked by Game.js each frame). */
  get winTriggers() { return this._winTriggers; }
}
