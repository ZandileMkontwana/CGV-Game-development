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

    /** Occluder meshes that block monster line-of-sight (rebuilt each level load). */
    this.occluders = [];

    /** Exit trigger zone mesh (set by level builder, null if none). */
    this.exitTrigger = null;
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
    this.occluders = [];
    this.exitTrigger = null;
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

  // ── Level 2: Failing station — stealth, hazards, timing ─────────────
  _buildLevel2() {
    const W = 10;    // corridor half-width (x = -W to W = 20m wide)
    const H = 3.2;   // ceiling height
    const Z0 = 10;   // south wall
    const Z1 = -55;  // north wall (exit end)
    const len = Z0 - Z1; // 65m corridor

    // --- Materials --------------------------------------------------------
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x554433, roughness: 0.85, metalness: 0.2,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x665544, roughness: 0.7, metalness: 0.3,
    });
    const ceilMat = new THREE.MeshStandardMaterial({
      color: 0x443322, roughness: 0.9, metalness: 0.1,
    });
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x7a6a52, roughness: 0.6, metalness: 0.4,
    });
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x888888, roughness: 0.5, metalness: 0.6,
    });

    // --- Floor + ceiling --------------------------------------------------
    this._floorCeil(W * 2, len, 0, 0, (Z0 + Z1) / 2, floorMat);
    this._floorCeil(W * 2, len, 0, H, (Z0 + Z1) / 2, ceilMat, true);

    // --- Walls (east + west + north + south) ------------------------------
    this._wallBox(0.5, H, len,  W, H / 2, (Z0 + Z1) / 2, wallMat);  // east
    this._wallBox(0.5, H, len, -W, H / 2, (Z0 + Z1) / 2, wallMat);  // west
    this._wallBox(W * 2, H, 0.5, 0, H / 2, Z1, wallMat);             // north
    this._wallBox(W * 2, H, 0.5, 0, H / 2, Z0, wallMat);             // south

    // --- Hiding crates (occluders — block monster LOS) --------------------
    // Placed along the corridor so the player can duck behind them.
    const cratePositions = [
      { x:  4, z:  2 }, { x: -3, z: -4 },
      { x:  5, z: -12 }, { x: -4, z: -18 },
      { x:  3, z: -24 }, { x: -5, z: -30 },
      { x:  6, z: -36 }, { x: -3, z: -42 },
      { x:  4, z: -48 },
    ];
    for (const cp of cratePositions) {
      const m = this._propBox(1.6, 2.0, 1.6, cp.x, 1.0, cp.z, crateMat);
      this.occluders.push(m);
    }

    // --- Structural pillars (also occlude LOS) ----------------------------
    const pillarPositions = [
      { x: 0, z: -8 }, { x: 0, z: -22 }, { x: 0, z: -38 },
    ];
    for (const pp of pillarPositions) {
      const m = this._propCylinder(0.5, 0.5, H, pp.x, H / 2, pp.z, pillarMat, 8);
      this.occluders.push(m);
    }

    // Also add walls themselves as occluders so monster can't see through them.
    // We only need the east/west wall meshes — already pushed by _wallBox
    // via _track().  We'll collect all wall meshes via a second pass after
    // building so we include them in occluders.
    // (The corridor walls already block LOS via physics; we just add the
    //  crate/pillar meshes above as the key gameplay occluders.)

    // --- Ambient hazard props (non-interactive visual detail) -----------
    // Broken ceiling panels, fallen debris.
    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0x554433, roughness: 0.9, metalness: 0.1,
    });
    this._propBox(2, 0.2, 3, 2, 0.1, -15, debrisMat);
    this._propBox(3, 0.3, 2, -4, 0.15, -35, debrisMat);
    this._propBox(1.5, 0.15, 2.5, 6, 0.08, -45, debrisMat);

    // --- Lighting (dim, flickering — coordinate with Person C) -----------
    // Sparse point lights for stealth atmosphere.
    const dimLight = new THREE.PointLight(0xffaa55, 0.6, 15, 1.5);
    dimLight.position.set(0, 2.8, 0);
    this.scene.add(dimLight);
    this._track(dimLight);

    const dimLight2 = new THREE.PointLight(0xffaa55, 0.4, 15, 1.5);
    dimLight2.position.set(0, 2.8, -25);
    this.scene.add(dimLight2);
    this._track(dimLight2);

    const dimLight3 = new THREE.PointLight(0xffaa55, 0.4, 15, 1.5);
    dimLight3.position.set(0, 2.8, -50);
    this.scene.add(dimLight3);
    this._track(dimLight3);

    // --- Exit trigger zone (invisible box at north end) -------------------
    const exitGeo = new THREE.BoxGeometry(W * 2 - 2, H, 1);
    const exitMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88, transparent: true, opacity: 0.08,
    });
    this.exitTrigger = new THREE.Mesh(exitGeo, exitMat);
    this.exitTrigger.position.set(0, H / 2, Z1 + 1);
    this.scene.add(this.exitTrigger);
    this._track(this.exitTrigger);

    // --- Shootable hazard targets (Level 2 pulse tool) --------------------
    // Conduit panels on walls — shoot to disable hazards.
    this._shootableTarget(0.5, 0.4,  9.7, 1.8, -10, 'hazard', Math.PI / 2);
    this._shootableTarget(0.5, 0.4, -9.7, 1.8, -20, 'hazard', -Math.PI / 2);
    this._shootableTarget(0.5, 0.4,  9.7, 1.8, -35, 'hazard', Math.PI / 2);
    this._shootableTarget(0.5, 0.4, -9.7, 1.8, -45, 'hazard', -Math.PI / 2);
  }

  // ── Level 3: Meltdown — boss arena + escape sequence ──────────────────
  _buildLevel3() {
    const AW = 15;   // arena half-width  (30m wide)
    const AD = 15;   // arena half-depth  (30m deep)
    const H  = 4.0;  // ceiling height
    const CX = 0;    // arena centre x
    const CZ = -20;   // arena centre z

    // --- Materials --------------------------------------------------------
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x331111, roughness: 0.85, metalness: 0.2,
    });
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x553333, roughness: 0.6, metalness: 0.4,
    });
    const ceilMat = new THREE.MeshStandardMaterial({
      color: 0x221111, roughness: 0.9, metalness: 0.1,
    });
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x888888, roughness: 0.5, metalness: 0.6,
    });
    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0x443322, roughness: 0.9, metalness: 0.1,
    });
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x666666, roughness: 0.4, metalness: 0.8,
    });

    // --- Arena floor + ceiling -------------------------------------------
    this._floorCeil(AW * 2, AD * 2, CX, 0, CZ, floorMat);
    this._floorCeil(AW * 2, AD * 2, CX, H, CZ, ceilMat, true);

    // --- Arena walls (4 sides, with gap for exit on north wall) ----------
    // South wall (with entry corridor gap).
    this._wallBox(AW - 3, H, 0.5, CX - (AW + 3) / 2, H / 2, CZ + AD, wallMat);
    this._wallBox(AW - 3, H, 0.5, CX + (AW + 3) / 2, H / 2, CZ + AD, wallMat);
    // East wall.
    this._wallBox(0.5, H, AD * 2, CX + AW, H / 2, CZ, wallMat);
    // West wall.
    this._wallBox(0.5, H, AD * 2, CX - AW, H / 2, CZ, wallMat);
    // North wall (with exit door gap in the centre).
    this._wallBox(AW - 2, H, 0.5, CX - (AW + 2) / 2, H / 2, CZ - AD, wallMat);
    this._wallBox(AW - 2, H, 0.5, CX + (AW + 2) / 2, H / 2, CZ - AD, wallMat);

    // --- Exit door (sealed until monster is defeated) --------------------
    this._exitDoor = this._propBox(4, H, 0.4, CX, H / 2, CZ - AD, doorMat);

    // --- Entry corridor (south of arena) ---------------------------------
    const corrW = 3;
    const corrLen = 12;
    const corrZ0 = CZ + AD;
    const corrZ1 = corrZ0 + corrLen;
    this._floorCeil(corrW * 2, corrLen, CX, 0, corrZ0 + corrLen / 2, floorMat);
    this._floorCeil(corrW * 2, corrLen, CX, H, corrZ0 + corrLen / 2, ceilMat, true);
    this._wallBox(0.5, H, corrLen, CX + corrW, H / 2, corrZ0 + corrLen / 2, wallMat);
    this._wallBox(0.5, H, corrLen, CX - corrW, H / 2, corrZ0 + corrLen / 2, wallMat);
    this._wallBox(corrW * 2, H, 0.5, CX, H / 2, corrZ1, wallMat); // back wall

    // --- Structural pillars (cover during boss fight) --------------------
    const pillarPositions = [
      { x: -6, z: CZ - 4 }, { x:  6, z: CZ - 4 },
      { x: -6, z: CZ + 4 }, { x:  6, z: CZ + 4 },
      { x:  0, z: CZ - 8 }, { x:  0, z: CZ + 8 },
    ];
    for (const pp of pillarPositions) {
      const m = this._propCylinder(0.6, 0.6, H, pp.x, H / 2, pp.z, pillarMat, 8);
      this.occluders.push(m);
    }

    // --- Debris (fallen ceiling panels, destroyed lab equipment) ---------
    this._propBox(3, 0.3, 2, -8, 0.15, CZ + 2, debrisMat);
    this._propBox(2, 0.2, 4, 7, 0.1, CZ - 6, debrisMat);
    this._propBox(1.5, 0.25, 3, -3, 0.12, CZ + 7, debrisMat);
    this._propBox(2.5, 0.2, 1.5, 10, 0.1, CZ - 10, debrisMat);

    // --- Red emergency lighting (failsafe protocol active) ---------------
    const redLight1 = new THREE.PointLight(0xff2200, 0.8, 25, 1.5);
    redLight1.position.set(CX, H - 0.2, CZ);
    this.scene.add(redLight1);
    this._track(redLight1);

    const redLight2 = new THREE.PointLight(0xff3300, 0.5, 20, 1.5);
    redLight2.position.set(-10, H - 0.2, CZ - 5);
    this.scene.add(redLight2);
    this._track(redLight2);

    const redLight3 = new THREE.PointLight(0xff3300, 0.5, 20, 1.5);
    redLight3.position.set(10, H - 0.2, CZ + 5);
    this.scene.add(redLight3);
    this._track(redLight3);

    // --- Exit trigger zone (behind the sealed door) -----------------------
    const exitGeo = new THREE.BoxGeometry(4, H, 2);
    const exitMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88, transparent: true, opacity: 0.08,
    });
    this.exitTrigger = new THREE.Mesh(exitGeo, exitMat);
    this.exitTrigger.position.set(CX, H / 2, CZ - AD - 2);
    this.scene.add(this.exitTrigger);
    this._track(this.exitTrigger);

    // --- Shootable weak-point targets (boss fight — on arena walls) ------
    this._shootableTarget(0.8, 0.6,  AW - 0.3, 2.0, CZ, 'weakpoint', Math.PI / 2);
    this._shootableTarget(0.8, 0.6, -AW + 0.3, 2.0, CZ, 'weakpoint', -Math.PI / 2);
    this._shootableTarget(0.8, 0.6, CX, 2.0, CZ - AD + 0.3, 'weakpoint');
  }

  /**
   * Register a mesh + optional physics body for cleanup.
   * Call this for every object you add so _teardown can dispose it.
   */
  _track(mesh, body = null) {
    this._disposables.push({ mesh, body });
  }
}
