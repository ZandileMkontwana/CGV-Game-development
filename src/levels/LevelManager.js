import * as THREE from 'three';
import * as CANNON from 'cannon-es';

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
        if (entry.mesh.geometry) entry.mesh.geometry.dispose();
        if (entry.mesh.material) {
          if (entry.mesh.material.map) entry.mesh.material.map.dispose();
          entry.mesh.material.dispose();
        }
        this.scene.remove(entry.mesh);
      }
      if (entry.body) {
        this.physics.world.removeBody(entry.body);
      }
    }
    this._disposables = [];
    this.shootables = [];
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

    // --- Materials ----------------------------------------------------------
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x778899, roughness: 0.35, metalness: 0.65,
    });
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x2a3040, roughness: 0.7, metalness: 0.3,
    });
    const ceilMat = new THREE.MeshStandardMaterial({
      color: 0xbbccdd, roughness: 0.9, metalness: 0.1,
    });
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x445566, roughness: 0.3, metalness: 0.8,
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

    // East wall.
    this._wallBox(0.2, H, 8, 2, HH, -20, wallMat);

    // West wall.
    this._wallBox(0.2, H, 8, -2, HH, -20, wallMat);

    // --- Corridor props ---

    // Ceiling pipes (visual only — placed above head height).
    this._propCylinder(0.08, 0.08, 8, 1.5, 2.7, -20, pipeMat);
    this._propCylinder(0.08, 0.08, 8, -1.5, 2.7, -20, pipeMat);
    this._propCylinder(0.06, 0.06, 8, 0.8, 2.85, -20, pipeMat);

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

    // Central reactor core (tall glowing cylinder).
    this._propCylinder(1.5, 1.5, 2.8, 0, 1.4, -30, reactorMat, 24);

    // Reactor base platform.
    this._propBox(4, 0.3, 4, 0, 0.15, -30, panelMat);

    // Reactor top ring.
    this._propCylinder(1.8, 1.8, 0.15, 0, 2.85, -30, accentMat, 24);

    // Support pillars (4 corners around reactor).
    const pillarPositions = [
      [3.5, -27], [-3.5, -27], [3.5, -33], [-3.5, -33],
    ];
    for (const [px, pz] of pillarPositions) {
      this._propCylinder(0.25, 0.25, H, px, HH, pz, wallMat, 8);
    }

    // Side machinery banks (east + west).
    this._propBox(1, 2, 3, 6.5, 1, -28, panelMat);
    this._propBox(1, 2, 3, 6.5, 1, -32, panelMat);
    this._propBox(1, 2, 3, -6.5, 1, -28, panelMat);
    this._propBox(1, 2, 3, -6.5, 1, -32, panelMat);

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
    // Control room — wall terminals (face inward toward the player).
    this._shootableTarget(0.6, 0.4, 4.85, 1.6, -10, 'terminal', Math.PI / 2);  // east wall
    this._shootableTarget(0.6, 0.4, 4.85, 1.6, -13, 'terminal', Math.PI / 2);
    this._shootableTarget(0.6, 0.4, -4.85, 1.6, -10, 'terminal', -Math.PI / 2); // west wall
    this._shootableTarget(0.6, 0.4, -4.85, 1.6, -13, 'terminal', -Math.PI / 2);

    // Corridor — ceiling conduit panels.
    this._shootableTarget(0.4, 0.3, 1.5, 2.6, -18, 'conduit');
    this._shootableTarget(0.4, 0.3, -1.5, 2.6, -22, 'conduit');

    // Reactor hall — machinery bank terminals.
    this._shootableTarget(0.8, 0.5, 5.9, 1.5, -28, 'terminal', Math.PI / 2);
    this._shootableTarget(0.8, 0.5, -5.9, 1.5, -32, 'terminal', -Math.PI / 2);
  }

  // ── Level 2: Failing station — hazards, timing ──────────────────────
  _buildLevel2() {
    // Temporary ground plane — replace with damaged corridor pieces.
    const groundGeo = new THREE.PlaneGeometry(50, 50);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x443322,
      roughness: 0.8,
      metalness: 0.3,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this._track(ground);

    // TODO (Person B): Same geometry but damaged.
    // - Broken panels, sparking conduits
    // - Coolant vent obstacles (timed jets)
    // - Rotating hazards (animated meshes)
    // - Heat-haze shader zones (coordinate with Person C)
  }

  // ── Level 3: Meltdown — chaos, boss arena ────────────────────────────
  _buildLevel3() {
    // Temporary ground plane — replace with collapsed station arena.
    const groundGeo = new THREE.PlaneGeometry(50, 50);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x331111,
      roughness: 0.9,
      metalness: 0.2,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this._track(ground);

    // TODO (Person B): Structural collapse + boss encounter.
    // - Debris, collapsed ceiling sections
    // - Boss entity (malfunctioning core or security drone)
    //   - Animated, with hit points or destruction sequence
    // - Dissolve shader targets (coordinate with Person C)
    // - Escape route geometry
  }

  /**
   * Register a mesh + optional physics body for cleanup.
   * Call this for every object you add so _teardown can dispose it.
   */
  _track(mesh, body = null) {
    this._disposables.push({ mesh, body });
  }
}
