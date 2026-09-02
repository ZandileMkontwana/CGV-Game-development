import * as THREE from 'three';

/**
 * PulseTool — handheld energy device for shooting mechanics.
 *
 * Fires glowing energy pulses via raycasting from the camera forward
 * direction.  No bullet physics — instant hit detection.
 *
 * Energy system:
 *   - 100 max energy, 10 per shot, recharges at 5/sec
 *   - 0.5 s cooldown between shots
 *
 * Input: left-click (pointer-locked) or F key.
 *
 * Fire events (register via on()):
 *   'hit'  → (target: THREE.Object3D)  — raycast hit a shootable mesh
 *   'miss' → ()                         — raycast hit nothing shootable
 *   'fire' → ()                         — pulse was fired (for sound/HUD)
 *
 * Per-level behaviour is configured via setLevel(n):
 *   Level 1: shoot terminals / conduits to activate lights & doors
 *   Level 2: shoot hazards (sparking conduits, steam valves) to disable
 *   Level 3: shoot monster weak points, destroy drones
 *
 * Shootable meshes must have:
 *   mesh.userData.pulseTarget = true
 *   mesh.userData.pulseType   = 'terminal' | 'conduit' | 'hazard' | 'weakpoint' | ...
 *
 * TODO (Person C): Replace basic bolt/flash with custom glow shader.
 * TODO (Person D): Wire fire/hit/miss events to sound effects.
 */
export default class PulseTool {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('./InputManager.js').default} input
   */
  constructor(scene, camera, input) {
    this.scene = scene;
    this.camera = camera;
    this.input = input;

    // --- Energy system ------------------------------------------------------
    this.maxEnergy = 100;
    this.energy = 100;
    this.shotCost = 10;
    this.rechargeRate = 5; // energy per second

    // --- Cooldown -----------------------------------------------------------
    this.cooldown = 0.5; // seconds between shots
    this._cooldownTimer = 0;

    // --- Current level ------------------------------------------------------
    this._level = 1;

    // --- Event listeners ----------------------------------------------------
    this._listeners = { hit: [], miss: [], fire: [] };

    // --- Raycasting (pre-allocated — no per-frame alloc) --------------------
    this._raycaster = new THREE.Raycaster();
    this._origin = new THREE.Vector3();
    this._direction = new THREE.Vector3();

    // --- Pulse bolt visual (reusable mesh) ----------------------------------
    // A small emissive sphere that travels from camera to hit point.
    const boltGeo = new THREE.SphereGeometry(0.06, 6, 6);
    const boltMat = new THREE.MeshBasicMaterial({
      color: 0x00ddff,
      transparent: true,
      opacity: 1,
    });
    this._bolt = new THREE.Mesh(boltGeo, boltMat);
    this._bolt.visible = false;
    scene.add(this._bolt);

    // Bolt animation state.
    this._boltActive = false;
    this._boltStart = new THREE.Vector3();
    this._boltEnd = new THREE.Vector3();
    this._boltT = 0;
    this._boltSpeed = 40; // m/s travel speed

    // --- Impact flash (point light + ring, pre-allocated) -------------------
    this._impactLight = new THREE.PointLight(0x00ddff, 3, 6, 2);
    this._impactLight.visible = false;
    scene.add(this._impactLight);

    const ringGeo = new THREE.RingGeometry(0.05, 0.15, 12);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ddff,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    });
    this._impactRing = new THREE.Mesh(ringGeo, ringMat);
    this._impactRing.visible = false;
    scene.add(this._impactRing);

    this._impactTimer = 0;
    this._impactDuration = 0.3; // seconds the flash/ring stays visible

    // --- Muzzle flash (brief point light at camera) -------------------------
    this._muzzleLight = new THREE.PointLight(0x00ddff, 0, 4, 2);
    camera.add(this._muzzleLight);
    this._muzzleTimer = 0;
    this._muzzleDuration = 0.1;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Register a callback for a fire event.
   * @param {'hit'|'miss'|'fire'} event
   * @param {Function} fn
   */
  on(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event].push(fn);
    }
  }

  /**
   * Set the current level to configure per-level behaviour.
   * Called by Game._loadLevel().
   * @param {number} levelNum 1, 2, or 3
   */
  setLevel(levelNum) {
    this._level = levelNum;
    // Reset energy on level load so the player starts full.
    this.energy = this.maxEnergy;
    this._cooldownTimer = 0;
  }

  /**
   * Called every frame while playing.
   * @param {number} dt delta time in seconds
   * @param {THREE.Object3D[]} shootables list of meshes with userData.pulseTarget
   */
  update(dt, shootables) {
    // --- Recharge energy ----------------------------------------------------
    if (this.energy < this.maxEnergy) {
      this.energy = Math.min(this.maxEnergy, this.energy + this.rechargeRate * dt);
    }

    // --- Tick cooldown ------------------------------------------------------
    if (this._cooldownTimer > 0) {
      this._cooldownTimer -= dt;
    }

    // --- Detect fire input (left-click or F key) ----------------------------
    const wantsFire = this.input.mouse.clicked || this.input.justPressed('KeyF');

    if (wantsFire && this._cooldownTimer <= 0 && this.energy >= this.shotCost) {
      this._fire(shootables);
    }

    // --- Animate pulse bolt -------------------------------------------------
    if (this._boltActive) {
      this._boltT += this._boltSpeed * dt;
      const t = Math.min(this._boltT / this._boltStart.distanceTo(this._boltEnd), 1);

      this._bolt.position.lerpVectors(this._boltStart, this._boltEnd, t);

      if (t >= 1) {
        this._boltActive = false;
        this._bolt.visible = false;
      }
    }

    // --- Animate impact flash -----------------------------------------------
    if (this._impactTimer > 0) {
      this._impactTimer -= dt;
      const progress = 1 - this._impactTimer / this._impactDuration;

      // Fade out the light and expand the ring.
      this._impactLight.intensity = 3 * (1 - progress);
      this._impactRing.scale.setScalar(1 + progress * 3);
      this._impactRing.material.opacity = 1 - progress;

      if (this._impactTimer <= 0) {
        this._impactLight.visible = false;
        this._impactRing.visible = false;
      }
    }

    // --- Animate muzzle flash -----------------------------------------------
    if (this._muzzleTimer > 0) {
      this._muzzleTimer -= dt;
      const progress = 1 - this._muzzleTimer / this._muzzleDuration;
      this._muzzleLight.intensity = 4 * (1 - progress);

      if (this._muzzleTimer <= 0) {
        this._muzzleLight.intensity = 0;
      }
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Fire a pulse: cast a ray, animate the bolt, dispatch events.
   * @param {THREE.Object3D[]} shootables
   */
  _fire(shootables) {
    // Consume resources.
    this.energy -= this.shotCost;
    this._cooldownTimer = this.cooldown;

    // Build ray from camera centre.
    this.camera.getWorldPosition(this._origin);
    this.camera.getWorldDirection(this._direction);
    this._raycaster.set(this._origin, this._direction);
    this._raycaster.far = 100; // max range: 100 m

    // --- Muzzle flash -------------------------------------------------------
    this._muzzleLight.intensity = 4;
    this._muzzleTimer = this._muzzleDuration;

    // --- Raycast against shootable targets ----------------------------------
    const hits = this._raycaster.intersectObjects(shootables, false);

    if (hits.length > 0) {
      const hit = hits[0];
      const target = hit.object;

      // Animate bolt from camera to hit point.
      this._boltStart.copy(this._origin);
      this._boltEnd.copy(hit.point);
      this._boltT = 0;
      this._boltActive = true;
      this._bolt.visible = true;

      // Show impact flash at hit point.
      this._impactLight.position.copy(hit.point);
      this._impactLight.visible = true;
      this._impactLight.intensity = 3;

      this._impactRing.position.copy(hit.point);
      // Orient the ring to face the camera.
      this._impactRing.lookAt(this._origin);
      this._impactRing.scale.setScalar(1);
      this._impactRing.material.opacity = 1;
      this._impactRing.visible = true;

      this._impactTimer = this._impactDuration;

      // Dispatch events.
      this._emit('fire');
      this._emit('hit', target);
    } else {
      // Miss — bolt travels to max range in the shot direction.
      this._boltStart.copy(this._origin);
      this._boltEnd.copy(this._origin).addScaledVector(this._direction, 80);
      this._boltT = 0;
      this._boltActive = true;
      this._bolt.visible = true;

      this._emit('fire');
      this._emit('miss');
    }
  }

  /**
   * Dispatch an event to all registered listeners.
   * @param {string} event
   * @param  {...any} args
   */
  _emit(event, ...args) {
    const list = this._listeners[event];
    if (list) {
      for (let i = 0; i < list.length; i++) {
        list[i](...args);
      }
    }
  }

  /** Clean up GPU resources. */
  dispose() {
    this._bolt.geometry.dispose();
    this._bolt.material.dispose();
    this._impactRing.geometry.dispose();
    this._impactRing.material.dispose();
    this.scene.remove(this._bolt);
    this.scene.remove(this._impactLight);
    this.scene.remove(this._impactRing);
    this.camera.remove(this._muzzleLight);
  }
}
