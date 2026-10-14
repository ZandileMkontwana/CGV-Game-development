import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createMonster } from './CharacterFactory.js';
import NavigationGrid from './NavigationGrid.js';

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
    this.awareness = null; // Level 2 uses delayed acquisition and last known positions.
    this.boss = null;

    // --- Runtime state ------------------------------------------------------
    this._waypoints = [];       // array of {x, y, z}
    this._waypointIndex = 0;
    this._attackTimer = 0;
    this._escapeTimer = 0;
    this._lungeTimer = 0;       // brief chase-speed burst on first spotting
    this._health = 3;          // number of remaining weak points
    this._phaseSpeedBonus = 0; // added to chase speed as weak points are destroyed
    this._phaseDamageBonus = 0;  // added to attack damage per destroyed weak point
    this._phaseAttackBonus = 0;  // subtracted from attack cooldown per destroyed WP
    this._animTime = 0;          // drives the weak point glow pulse

    // --- Death animation state ---------------------------------------------
    this._dying = false;         // true while the topple animation plays
    this._deathTimer = 0;
    this._deathDuration = 1.6;   // seconds the monster takes to fall
    this._hitFlashTimer = 0;     // body flash on weak point hit

    // --- Stealth: line-of-sight raycast ------------------------------------
    this._occluders = [];       // meshes that block line of sight (walls, props)
    this._losRaycaster = new THREE.Raycaster();
    this._losOrigin = new THREE.Vector3();
    this._losDir = new THREE.Vector3();
    this._canSeePlayer = false; // updated each frame via LOS raycast
    this._distToPlayer = Infinity; // horizontal distance to player

    // --- Event listeners ----------------------------------------------------
    this._listeners = { damage: [], death: [], attack: [], stateChange: [], spotted: [], hidden: [], phaseChange: [], bossCue: [] };

    // --- Physics body -------------------------------------------------------
    this.body = new CANNON.Body({
      mass: 120,
      shape: new CANNON.Sphere(0.6),
      material: physicsWorld.actorMaterial,
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
    this._navigation = null;
    this._path = [];
    this._pathCursor = 0;
    this._pathTimer = 0;
    this._pathTargetX = Infinity;
    this._pathTargetZ = Infinity;

    // --- Creature model (code-built via CharacterFactory) -------------------
    // The factory supplies the tagged hit meshes and the three mounted weak
    // points with the exact same userData contract as the old placeholder.
    const character = createMonster();
    this._char = character;
    this.model = character.group;
    this.hitMeshes = character.hitMeshes;
    this.weakPoints = character.weakPoints;
    this._bodyMat = character.bodyMat; // shared chitin material — hit flash

    // Scare pass: a bigger silhouette reads as a real threat, and a red aura
    // light makes the ember eyes/spine pustules loom out of the dark. The
    // model hangs its feet at local y = -0.55, so scaling pushes them to
    // -0.55*s — the origin must RISE by 0.55*(s-1) to keep feet on the floor.
    this._modelScale = 1.28;
    this.model.scale.setScalar(this._modelScale);
    this._modelYOffset = 0.55 * (this._modelScale - 1);
    const aura = new THREE.PointLight(0xff2a14, 7, 9, 1.8);
    this._aura = aura;
    aura.position.set(0, 1.7, 0.3);
    this.model.add(aura);

    this.model.visible = false;
    scene.add(this.model);
    this._chargeGuide = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 1),
      new THREE.MeshBasicMaterial({ color: 0xffcf71, transparent: true, opacity: 0.8, toneMapped: false }));
    this._chargeGuide.visible = false;
    scene.add(this._chargeGuide);
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
    this._phaseDamageBonus = 0;
    this._phaseAttackBonus = 0;
    this._dying = false;
    this._deathTimer = 0;
    this._hitFlashTimer = 0;
    this._path.length = 0;
    this._pathTimer = 0;
    this.model.rotation.x = 0; // reset any topple from a previous death
    this._lungeTimer = 0;
    this._canSeePlayer = false;
    this._distToPlayer = Infinity;
    this.awareness?.reset();
    this.boss?.reset();
    this._chargeGuide.visible = false;
    this._bodyMat.emissive.setHex(0x000000);
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
    if (!active) this._chargeGuide.visible = false;
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

    // Phase bonuses: monster gets faster, hits harder, attacks more often.
    this._phaseSpeedBonus  += this.boss ? 0.6 : 1.5;
    this._phaseDamageBonus += this.boss ? 4 : 5;
    this._phaseAttackBonus += this.boss ? 0.15 : 0.3;
    this.boss?.stagger();
    this._chargeGuide.visible = false;

    // Hit flash — the body glows red for a moment so the hit reads clearly.
    this._hitFlashTimer = 0.3;
    this._bodyMat.emissive.setHex(0xff5544);
    this._bodyMat.emissiveIntensity = 1.5;

    const phase = 3 - this._health; // 1, 2, or 3
    this._emit('phaseChange', phase);
    this._emit('damage', this._health);

    if (this._health <= 0) {
      this.state = State.DEAD;
      this.body.velocity.setZero();
      // Play the topple animation, then hide + emit 'death' from update().
      this._dying = true;
      this._deathTimer = this._deathDuration;
    }
  }

  /** Set meshes that block line-of-sight (walls, props, hiding spots). */
  setOccluders(meshes) {
    this._occluders = meshes;
  }

  /** Enable obstacle routing for a level; other levels keep their existing AI. */
  setNavigationObstacles(bodies, bounds) {
    this.setNavigationGrid(bounds ? new NavigationGrid(bodies, bounds, 0.75) : null);
  }

  get navigationGrid() { return this._navigation; }

  /** Actors share static clearance data while keeping separate pursuit paths. */
  setNavigationGrid(grid) {
    this._navigation = grid;
    this._path.length = 0;
    this._pathTimer = 0;
    this._pathTargetX = Infinity;
    this._pathTargetZ = Infinity;
  }

  /** Current health (remaining weak points). */
  get health() { return this._health; }

  /** Current boss phase (0 = full health, 1–3 = weak points destroyed). */
  get phase() { return 3 - this._health; }

  /** Whether the monster is dead. */
  get isDead() { return this.state === State.DEAD; }

  /** Horizontal distance to the player (updated each frame). */
  get distToPlayer() { return this._distToPlayer; }

  /** Whether the monster has unobstructed line of sight to the player. */
  get canSeePlayer() { return this._canSeePlayer; }

  /** Normalised threat level 0..1 (1 = monster right on top of player). */
  get threatLevel() {
    if (this._distToPlayer >= this.detectionRange) return 0;
    return 1 - this._distToPlayer / this.detectionRange;
  }

  /** World position of the monster's feet. */
  get position() { return this.body.position; }

  /**
   * Called every frame while the monster is active.
   * @param {number} dt delta time in seconds
   * @param {import('cannon-es').Vec3} playerFeetPos player body.position
   */
  update(dt, playerFeetPos, stance = null) {
    if (!this.isActive) return;

    // --- Hit flash decay (runs while alive or dying) -----------------------
    if (this._hitFlashTimer > 0) {
      this._hitFlashTimer -= dt;
      const k = Math.max(0, this._hitFlashTimer) / 0.3;
      this._bodyMat.emissiveIntensity = k * 1.5;
      if (this._hitFlashTimer <= 0) {
        this._bodyMat.emissive.setHex(0x000000);
      }
    }

    // --- Death topple animation ---------------------------------------------
    // The monster falls over and sinks, THEN hides + emits 'death'.  Without
    // this the monster just pops out of existence — reads as "nothing happened".
    if (this._dying) {
      this._chargeGuide.visible = false;
      this._deathTimer -= dt;
      const t = 1 - Math.max(0, this._deathTimer) / this._deathDuration;
      this.model.rotation.x = t * Math.PI * 0.45; // topple backward
      this.model.position.set(
        this.body.position.x,
        this.body.position.y + this._modelYOffset - t * 0.3,   // sink as it falls
        this.body.position.z
      );

      // Stealth HUD should not react to a dying monster.
      this._canSeePlayer = false;
      this._distToPlayer = Infinity;

      if (this._deathTimer <= 0) {
        this._dying = false;
        this.model.visible = false;
        this.model.rotation.x = 0; // reset for the next spawn
        // Teleport the physics body out of play — otherwise an invisible
        // sphere blocks the player's path during the escape sequence.
        this.body.position.set(0, -50, 0);
        this._emit('death');
      }

      this._char.update(dt, 'dead', this.body.velocity);
      this.model.updateMatrixWorld(true);
      return;
    }

    if (this.state === State.DEAD) return;

    this._animTime += dt;

    // Read player position once into reusable vector.
    this._playerPos.set(playerFeetPos.x, playerFeetPos.y, playerFeetPos.z);

    // Distance to player (horizontal only — ignore Y difference).
    const dx = this._playerPos.x - this.body.position.x;
    const dz = this._playerPos.z - this.body.position.z;
    const distToPlayer = Math.sqrt(dx * dx + dz * dz);
    this._distToPlayer = distToPlayer;
    if (this.boss) {
      this.boss.update(dt, this._playerPos, this.state !== State.PATROL);
      this._attackTimer = Math.max(0, this._attackTimer - dt);
    }

    // --- Line-of-sight check (no per-frame alloc) ---------------------------
    // Cast a ray from monster eye height to player eye height.
    // If an occluder mesh is in between, the monster can't see the player.
    this._losOrigin.set(
      this.body.position.x,
      this.body.position.y + (this.awareness ? 1.2 : 1.8), // hunt eyes fit the hunched model
      this.body.position.z
    );
    this._losDir.set(
      this._playerPos.x - this._losOrigin.x,
      (this._playerPos.y + (stance?.isCrouching ? 0.8 : 1.5)) - this._losOrigin.y,
      this._playerPos.z - this._losOrigin.z
    );
    const losDist = this._losDir.length();
    this._losDir.normalize();
    this._losRaycaster.set(this._losOrigin, this._losDir);
    this._losRaycaster.far = losDist;

    const losHits = this._losRaycaster.intersectObjects(this._occluders, false);
    const wasSeeing = this._canSeePlayer;
    this._canSeePlayer = losHits.length === 0; // no obstruction = visible
    if (this.awareness && distToPlayer > 2.2) {
      const forwardDot = (Math.sin(this.model.rotation.y) * dx + Math.cos(this.model.rotation.y) * dz) / distToPlayer;
      this._canSeePlayer = this._canSeePlayer && forwardDot > 0.25;
    }

    // Fire spotted/hidden events on transitions.
    if (this._canSeePlayer && !wasSeeing && distToPlayer < this.detectionRange) {
      this._emit('spotted');
    } else if (!this._canSeePlayer && wasSeeing) {
      this._emit('hidden');
    }

    // --- State transitions --------------------------------------------------
    // Player can only be detected if the monster has line of sight AND
    // is within detection range.  Hiding behind objects breaks detection.
    const range = this.awareness ? (stance?.isCrouching ? 5 : stance?._charState?.sprinting ? 12 : 10) : this.detectionRange;
    const detected = this.awareness
      ? this.awareness.observe(dt, this._canSeePlayer && distToPlayer < range, this._playerPos.x, this._playerPos.z)
      : this._canSeePlayer && distToPlayer < range && this.boss?.stage !== 'waiting';

    switch (this.state) {
      case State.PATROL:
        if (detected) {
          this._setState(State.CHASE);
          this._escapeTimer = 0;
          this._lungeTimer = this.awareness || this.boss ? 0 : 1.5;
        }
        break;

      case State.CHASE:
        if (this._canSeePlayer && distToPlayer < this.attackRange) {
          this._setState(State.ATTACK);
        } else if (this.awareness && !detected) {
          this._setState(State.PATROL);
          this._escapeTimer = 0;
        } else if (!detected) {
          // Player hidden or out of range — start escape timer.
          this._escapeTimer += dt;
          if (this._escapeTimer >= this.escapeTimeout) {
            this._setState(State.PATROL);
            this._escapeTimer = 0;
          }
        } else {
          // Player still detected — reset escape timer.
          this._escapeTimer = 0;
        }
        break;

      case State.ATTACK:
        if (!this._canSeePlayer || distToPlayer > this.attackRange * 1.5) {
          // Player moved out of melee range — resume chase.
          this._setState(State.CHASE);
          this._escapeTimer = 0;
        }
        break;
    }

    // --- State behaviour ----------------------------------------------------
    if (this.boss) {
      this._doBossMovement(dt, dx, dz, distToPlayer);
    } else switch (this.state) {
      case State.PATROL:  this._doPatrol(dt); break;
      case State.CHASE:   this._doChase(dt, dx, dz, distToPlayer); break;
      case State.ATTACK:  this._doAttack(dt); break;
    }

    // --- Sync model to physics body ----------------------------------------
    this.model.position.set(
      this.body.position.x,
      this.body.position.y + this._modelYOffset,
      this.body.position.z
    );

    // Face movement direction (or player when chasing/attacking).
    if (this.boss?.stage === 'windup') {
      this.model.rotation.y = Math.atan2(this.boss.x - this.body.position.x, this.boss.z - this.body.position.z);
    } else if (this.boss?.stage === 'charge' && this.body.velocity.x ** 2 + this.body.velocity.z ** 2 > 0.01) {
      this.model.rotation.y = Math.atan2(this.body.velocity.x, this.body.velocity.z);
    } else if (this.state === State.ATTACK) {
      this.model.rotation.y = Math.atan2(dx, dz);
    } else if (this.body.velocity.x ** 2 + this.body.velocity.z ** 2 > 0.01) {
      this.model.rotation.y = Math.atan2(this.body.velocity.x, this.body.velocity.z);
    }

    // --- Weak point glow pulse (reads as "shoot me") -----------------------
    for (let i = 0; i < this.weakPoints.length; i++) {
      const wp = this.weakPoints[i];
      if (!wp.userData.destroyed) {
        wp.material.emissiveIntensity = 0.7 + 0.5 * Math.sin(this._animTime * 4);
      }
    }

    // --- Limb animation (CharacterFactory — zero per-frame allocs) ---------
    const animationState = this.boss?.stage === 'windup' ? 'attack'
      : this.boss && ['waiting', 'recover'].includes(this.boss.stage) ? 'patrol' : this.state;
    this._char.update(dt, animationState, this.body.velocity);

    // --- Refresh world matrices NOW ---------------------------------------
    // Three.js normally updates matrixWorld during render (end of frame).
    // The PulseTool raycast runs right after this in Game._loop, so we
    // update the model's world matrices explicitly — otherwise the ray
    // tests against the monster's position from the PREVIOUS frame.
    this.model.updateMatrixWorld(true);
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
      this._moveTowards(wp.x, wp.z, this.patrolSpeed, dt);
    }
  }

  /** CHASE: run toward the player. */
  _doChase(dt, dx, dz, dist) {
    if (this.awareness) {
      if (Math.hypot(this.awareness.x - this.body.position.x, this.awareness.z - this.body.position.z) < 0.4) {
        this.body.velocity.x = 0;
        this.body.velocity.z = 0;
      } else {
        this._moveTowards(this.awareness.x, this.awareness.z,
          this.awareness.searching ? this.patrolSpeed : this.chaseSpeed, dt);
      }
      return;
    }
    this._lungeTimer = Math.max(0, this._lungeTimer - dt);
    if (dist > 0.1) {
      const lunge = this._lungeTimer > 0 ? 2.4 * (this._lungeTimer / 1.5) : 0;
      const speed = this.chaseSpeed + this._phaseSpeedBonus + lunge;
      this._moveTowards(this.body.position.x + dx, this.body.position.z + dz, speed, dt);
    }
  }

  _doBossMovement(dt, dx, dz, dist) {
    const boss = this.boss;
    const warning = boss.stage === 'windup';
    this._chargeGuide.visible = warning;
    if (warning) {
      const x = boss.x - this.body.position.x;
      const z = boss.z - this.body.position.z;
      this._chargeGuide.position.set(this.body.position.x + x * 0.5, 0.06, this.body.position.z + z * 0.5);
      this._chargeGuide.scale.z = Math.hypot(x, z);
      this._chargeGuide.rotation.y = Math.atan2(x, z);
    }
    this._aura.color.setHex(warning ? 0xffb84f : boss.stage === 'recover' ? 0x71c9dc : 0xff2a14);
    this._aura.intensity = warning ? 8 : boss.stage === 'recover' ? 3 : 5;
    if (['waiting', 'windup', 'recover'].includes(boss.stage)) {
      this.body.velocity.x = this.body.velocity.z = 0;
      return;
    }
    if (boss.stage === 'charge') {
      if (Math.hypot(boss.x - this.body.position.x, boss.z - this.body.position.z) < 0.5
          || (this._navigation && !this._navigation.isSegmentClear(this.body.position.x, this.body.position.z, boss.x, boss.z))) {
        boss.stopCharge();
        this.body.velocity.x = this.body.velocity.z = 0;
      } else {
        this._moveTowards(boss.x, boss.z, 7 + this._phaseSpeedBonus, dt);
      }
      if (boss.stage === 'charge' && this.state === State.ATTACK && this._canSeePlayer) this._doAttack(0);
    } else if (this.state === State.PATROL) {
      this._doPatrol(dt);
    } else if (dist > 3 || !this._canSeePlayer
        || (this._navigation && !this._navigation.isSegmentClear(this.body.position.x, this.body.position.z,
          this.body.position.x + dx, this.body.position.z + dz))) {
      this._moveTowards(this.body.position.x + dx, this.body.position.z + dz, this.chaseSpeed + this._phaseSpeedBonus, dt);
    } else {
      this.body.velocity.x = this.body.velocity.z = 0;
    }
  }

  _moveTowards(targetX, targetZ, speed, dt) {
    const x = this.body.position.x;
    const z = this.body.position.z;
    const navigation = this._navigation;
    this._pathTimer -= dt;
    let nextX = targetX;
    let nextZ = targetZ;
    if (navigation && !navigation.isSegmentClear(x, z, targetX, targetZ)) {
      const targetMoved = (targetX - this._pathTargetX) ** 2 + (targetZ - this._pathTargetZ) ** 2 > 1;
      if (this._pathTimer <= 0 || targetMoved) {
        navigation.findPath(x, z, targetX, targetZ, this._path);
        this._pathCursor = 0;
        this._pathTimer = 0.4;
        this._pathTargetX = targetX;
        this._pathTargetZ = targetZ;
      }
      if (!this._path.length) {
        this.body.velocity.x = 0;
        this.body.velocity.z = 0;
        return;
      }
      while (this._pathCursor < this._path.length - 1) {
        const node = this._path[this._pathCursor];
        if ((navigation.nodeX(node) - x) ** 2 + (navigation.nodeZ(node) - z) ** 2 > 0.12) break;
        this._pathCursor++;
      }
      // Smooth short stretches only where the full actor footprint fits.
      const limit = Math.min(this._path.length - 1, this._pathCursor + 8);
      for (let cursor = this._pathCursor + 1; cursor <= limit; cursor++) {
        const node = this._path[cursor];
        if (!navigation.isSegmentClear(x, z, navigation.nodeX(node), navigation.nodeZ(node))) break;
        this._pathCursor = cursor;
      }
      const node = this._path[this._pathCursor];
      nextX = navigation.nodeX(node);
      nextZ = navigation.nodeZ(node);
    }
    this._dir.set(nextX - x, 0, nextZ - z);
    if (this._dir.lengthSq() > 0.001) this._dir.normalize();
    else this._dir.set(0, 0, 0);
    this.body.velocity.x = this._dir.x * speed;
    this.body.velocity.z = this._dir.z * speed;
  }

  /** ATTACK: stop and deal damage on a cooldown. */
  _doAttack(dt) {
    if (!this.boss) this.body.velocity.x = this.body.velocity.z = 0;

    this._attackTimer -= dt;
    const cooldown = Math.max(0.5, this.attackCooldown - this._phaseAttackBonus);
    if (this._attackTimer <= 0) {
      this._attackTimer = cooldown;
      this._emit('attack', this.attackDamage + this._phaseDamageBonus);
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
    this.scene.remove(this._chargeGuide);
    this._chargeGuide.geometry.dispose();
    this._chargeGuide.material.dispose();
    this.scene.remove(this.model);
    this.physicsWorld.world.removeBody(this.body);
    // Dispose all child geometries/materials.
    this.model.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
}
