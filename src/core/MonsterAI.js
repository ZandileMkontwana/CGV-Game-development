import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * MonsterAI — mutated scientist enemy with PATROL → CHASE → ATTACK states.
 *
 * State machine:
 *   PATROL  — walks between waypoints at slow speed, scans for player
 *   CHASE   — triggered when player enters detection range, runs toward player
 *   ATTACK  — when close enough to player, deals damage on a cooldown
 *   Returns to PATROL if player stays out of range for `escapeTimeout` seconds.
 *
 * Health: 3 weak points (glowing spheres).  Each destroyed weak point
 * can trigger behaviour changes (faster, more aggressive) for the boss fight.
 *
 * Placeholder model: dark-red capsule body + sphere head + 3 red weak-point
 * nodes.  TODO (Person B): Replace with Blender monster GLB.
 *
 * Zero per-frame allocation: all vectors are pre-allocated in the constructor.
 */

/** @enum {string} */
const State = {
  PATROL: 'patrol',
  CHASE:  'chase',
  ATTACK: 'attack',
  DEAD:   'dead',
};

export default class MonsterAI {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./PhysicsWorld.js').default} physicsWorld
   */
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;

    // --- State machine ------------------------------------------------------
    this.state = State.PATROL;
    this.isActive = false; // not active until set via setActive()

    // --- Configuration ------------------------------------------------------
    this.patrolSpeed = 2.0;   // m/s while patrolling
    this.chaseSpeed = 5.5;    // m/s while chasing
    this.detectionRange = 12; // metres — player spotted within this radius
    this.attackRange = 2.0;   // metres — close enough to attack
    this.attackDamage = 20;   // damage per attack hit
    this.attackCooldown = 1.5; // seconds between attacks
    this.escapeTimeout = 10;  // seconds out of range before returning to PATROL

    // --- Runtime state ------------------------------------------------------
    this._waypoints = [];       // array of {x, y, z}
    this._waypointIndex = 0;
    this._attackTimer = 0;
    this._escapeTimer = 0;
    this._health = 3;          // number of remaining weak points
    this._phaseSpeedBonus = 0; // added to chase speed as weak points are destroyed

    // --- Event listeners ----------------------------------------------------
    this._listeners = { damage: [], death: [], attack: [], stateChange: [] };

    // --- Physics body -------------------------------------------------------
    this.body = new CANNON.Body({
      mass: 120,
      shape: new CANNON.Sphere(0.6),
      material: physicsWorld.defaultMaterial,
      position: new CANNON.Vec3(0, 2, 0),
      linearDamping: 0.9,
      angularDamping: 1.0,
      fixedRotation: true,
    });
    physicsWorld.world.addBody(this.body);

    // --- Pre-allocated vectors (no per-frame alloc) -------------------------
    this._dir = new THREE.Vector3();
    this._toPlayer = new THREE.Vector3();
    this._playerPos = new THREE.Vector3();

    // --- Placeholder model --------------------------------------------------
    this.model = new THREE.Group();

    // Body — tall capsule.
    const bodyGeo = new THREE.CapsuleGeometry(0.45, 1.2, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x661122, roughness: 0.6, metalness: 0.3,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 1.1;
    bodyMesh.castShadow = true;
    this.model.add(bodyMesh);

    // Head — sphere, slightly elongated.
    const headGeo = new THREE.SphereGeometry(0.35, 8, 8);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x553344, roughness: 0.5, metalness: 0.4,
    });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.position.y = 2.1;
    headMesh.castShadow = true;
    this.model.add(headMesh);

    // Eyes — two small emissive red spheres.
    const eyeGeo = new THREE.SphereGeometry(0.06, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.12, 2.15, 0.28);
    this.model.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.12, 2.15, 0.28);
    this.model.add(eyeR);

    // --- Weak points (3 glowing nodes — shootable) -------------------------
    this.weakPoints = [];
    const wpGeo = new THREE.SphereGeometry(0.15, 8, 8);
    const wpOffsets = [
      { x: 0,    y: 1.6, z: 0.5 },   // chest (front)
      { x: 0.4,  y: 0.8, z: 0 },     // right side
      { x: -0.4, y: 0.8, z: 0 },     // left side
    ];
    for (let i = 0; i < 3; i++) {
      const wpMat = new THREE.MeshStandardMaterial({
        color: 0xff3333,
        emissive: 0xff3333,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.6,
      });
      const wpMesh = new THREE.Mesh(wpGeo, wpMat);
      const off = wpOffsets[i];
      wpMesh.position.set(off.x, off.y, off.z);
      wpMesh.userData.pulseTarget = true;
      wpMesh.userData.pulseType = 'weakpoint';
      wpMesh.userData.weakPointIndex = i;
      wpMesh.userData.destroyed = false;
      this.model.add(wpMesh);
      this.weakPoints.push(wpMesh);
    }

    this.model.visible = false;
    scene.add(this.model);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Register an event callback.
   * @param {'damage'|'death'|'attack'|'stateChange'} event
   * @param {Function} fn
   */
  on(event, fn) {
    if (this._listeners[event]) this._listeners[event].push(fn);
  }

  /** Place the monster at a world position. */
  spawn(x, y, z) {
    this.body.position.set(x, y, z);
    this.body.velocity.setZero();
    this.state = State.PATROL;
    this._waypointIndex = 0;
    this._attackTimer = 0;
    this._escapeTimer = 0;
    this._health = 3;
    this._phaseSpeedBonus = 0;
    // Reset weak points.
    for (const wp of this.weakPoints) {
      wp.userData.destroyed = false;
      wp.visible = true;
    }
  }

  /** Activate or deactivate the monster (e.g. per-level). */
  setActive(active) {
    this.isActive = active;
    this.model.visible = active;
  }

  /** Set the patrol route (array of {x, y, z}). */
  setPatrolWaypoints(waypoints) {
    this._waypoints = waypoints;
    this._waypointIndex = 0;
  }

  /**
   * Call when the PulseTool hits a weak point.
   * @param {THREE.Mesh} wpMesh the weak point mesh that was hit
   */
  damageWeakPoint(wpMesh) {
    if (wpMesh.userData.destroyed) return;
    wpMesh.userData.destroyed = true;
    wpMesh.visible = false;
    this._health--;
    this._phaseSpeedBonus += 1.5; // faster with each weak point destroyed
    this._emit('damage', this._health);
    if (this._health <= 0) {
      this.state = State.DEAD;
      this.body.velocity.setZero();
      this.model.visible = false;
      this._emit('death');
    }
  }

  /** Current health (remaining weak points). */
  get health() { return this._health; }

  /** World position of the monster's feet. */
  get position() { return this.body.position; }

  /**
   * Called every frame while the monster is active.
   * @param {number} dt delta time in seconds
   * @param {import('cannon-es').Vec3} playerFeetPos player body.position
   */
  update(dt, playerFeetPos) {
    if (!this.isActive || this.state === State.DEAD) return;

    // Read player position once into reusable vector.
    this._playerPos.set(playerFeetPos.x, playerFeetPos.y, playerFeetPos.z);

    // Distance to player (horizontal only — ignore Y difference).
    const dx = this._playerPos.x - this.body.position.x;
    const dz = this._playerPos.z - this.body.position.z;
    const distToPlayer = Math.sqrt(dx * dx + dz * dz);

    // --- State transitions --------------------------------------------------
    switch (this.state) {
      case State.PATROL:
        if (distToPlayer < this.detectionRange) {
          this._setState(State.CHASE);
          this._escapeTimer = 0;
        }
        break;

      case State.CHASE:
        if (distToPlayer < this.attackRange) {
          this._setState(State.ATTACK);
        } else if (distToPlayer > this.detectionRange) {
          // Player escaped detection range — start escape timer.
          this._escapeTimer += dt;
          if (this._escapeTimer >= this.escapeTimeout) {
            this._setState(State.PATROL);
            this._escapeTimer = 0;
          }
        } else {
          // Player still in range — reset escape timer.
          this._escapeTimer = 0;
        }
        break;

      case State.ATTACK:
        if (distToPlayer > this.attackRange * 1.5) {
          // Player moved out of melee range — resume chase.
          this._setState(State.CHASE);
          this._escapeTimer = 0;
        }
        break;
    }

    // --- State behaviour ----------------------------------------------------
    switch (this.state) {
      case State.PATROL:  this._doPatrol(dt); break;
      case State.CHASE:   this._doChase(dt, dx, dz, distToPlayer); break;
      case State.ATTACK:  this._doAttack(dt); break;
    }

    // --- Sync model to physics body ----------------------------------------
    this.model.position.set(
      this.body.position.x,
      this.body.position.y,
      this.body.position.z
    );

    // Face movement direction (or player when chasing/attacking).
    if (this.state === State.CHASE || this.state === State.ATTACK) {
      this.model.rotation.y = Math.atan2(dx, dz);
    } else if (this._waypoints.length > 0) {
      const wp = this._waypoints[this._waypointIndex];
      const wdx = wp.x - this.body.position.x;
      const wdz = wp.z - this.body.position.z;
      this.model.rotation.y = Math.atan2(wdx, wdz);
    }
  }

  // ── State behaviours ──────────────────────────────────────────────────────

  /** PATROL: walk toward the current waypoint, advance when close. */
  _doPatrol(dt) {
    if (this._waypoints.length === 0) {
      this.body.velocity.x = 0;
      this.body.velocity.z = 0;
      return;
    }

    const wp = this._waypoints[this._waypointIndex];
    this._dir.set(
      wp.x - this.body.position.x,
      0,
      wp.z - this.body.position.z
    );
    const dist = this._dir.length();

    if (dist < 0.5) {
      // Reached waypoint — advance to next.
      this._waypointIndex = (this._waypointIndex + 1) % this._waypoints.length;
      this.body.velocity.x = 0;
      this.body.velocity.z = 0;
    } else {
      this._dir.normalize();
      this.body.velocity.x = this._dir.x * this.patrolSpeed;
      this.body.velocity.z = this._dir.z * this.patrolSpeed;
    }
  }

  /** CHASE: run toward the player. */
  _doChase(dt, dx, dz, dist) {
    if (dist > 0.1) {
      this._dir.set(dx, 0, dz).normalize();
      const speed = this.chaseSpeed + this._phaseSpeedBonus;
      this.body.velocity.x = this._dir.x * speed;
      this.body.velocity.z = this._dir.z * speed;
    }
  }

  /** ATTACK: stop and deal damage on a cooldown. */
  _doAttack(dt) {
    this.body.velocity.x = 0;
    this.body.velocity.z = 0;

    this._attackTimer -= dt;
    if (this._attackTimer <= 0) {
      this._attackTimer = this.attackCooldown;
      this._emit('attack', this.attackDamage);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Transition to a new state and emit an event. */
  _setState(newState) {
    const old = this.state;
    this.state = newState;
    this._emit('stateChange', newState, old);
  }

  /** Emit an event to all registered listeners. */
  _emit(event, ...args) {
    const list = this._listeners[event];
    if (list) {
      for (let i = 0; i < list.length; i++) list[i](...args);
    }
  }

  /** Clean up GPU resources and physics body. */
  dispose() {
    this.scene.remove(this.model);
    this.physicsWorld.world.removeBody(this.body);
    // Dispose all child geometries/materials.
    this.model.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
}
