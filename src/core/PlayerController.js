import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import InputManager from './InputManager.js';

/**
 * PlayerController — first-person movement and physics body.
 *
 * Movement is impulse-based through cannon-es so that collisions,
 * slopes and gravity "just work".  The controller:
 *   - reads WASD / arrow keys from InputManager,
 *   - applies horizontal impulses relative to the camera yaw,
 *   - handles jumping via ground-contact detection,
 *   - exposes the player body position for the camera to follow.
 */
export default class PlayerController {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./PhysicsWorld.js').default} physicsWorld
   * @param {InputManager} input
   */
  constructor(scene, physicsWorld, input) {
    this.input = input;
    this.physicsWorld = physicsWorld;

    // --- Configuration ------------------------------------------------------
    this.moveSpeed = 40;     // impulse strength for walking
    this.sprintMultiplier = 1.8;
    this.jumpImpulse = 7;
    this.maxSpeed = 8;       // clamp horizontal velocity (m/s)
    this.playerHeight = 1.7; // eye height above feet
    this.playerRadius = 0.4;

    // --- Physics body (capsule approximated as a sphere + cylinder) ---------
    // Using a sphere for simplicity — change to a compound shape if needed.
    this.body = new CANNON.Body({
      mass: 70,
      shape: new CANNON.Sphere(this.playerRadius),
      material: physicsWorld.defaultMaterial,
      position: new CANNON.Vec3(0, 2, 0),
      linearDamping: 0.9,   // ground friction feel
      angularDamping: 1.0,  // prevent spinning
      fixedRotation: true,  // stay upright
    });
    physicsWorld.world.addBody(this.body);

    // --- Ground contact tracking -------------------------------------------
    this.canJump = false;
    this.body.addEventListener('collide', (e) => {
      // Simple heuristic: if the contact normal points mostly up, we're grounded.
      const contact = e.contact;
      const normal = contact.ni;
      // Determine which normal points away from this body.
      const up = contact.bi === this.body ? normal : new CANNON.Vec3(-normal.x, -normal.y, -normal.z);
      if (up.y > 0.5) {
        this.canJump = true;
      }
    });

    // --- Reusable vectors (avoid per-frame allocation) ---------------------
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._impulse = new CANNON.Vec3();
    this._eyePos = new CANNON.Vec3(); // reused by eyePosition getter

    // --- Camera yaw reference (set by CameraController) --------------------
    /** @type {THREE.Object3D|null} set externally so movement is camera-relative */
    this.cameraPivot = null;
  }

  /** Reset to a spawn position. */
  spawn(x, y, z) {
    this.body.position.set(x, y, z);
    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
    this.canJump = false;
  }

  /**
   * Called once per frame.
   * @param {number} dt delta time in seconds
   */
  update(dt) {
    const keys = this.input.keys;
    const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
    const speed = this.moveSpeed * (sprint ? this.sprintMultiplier : 1);

    // --- Movement direction relative to camera yaw -------------------------
    let moveX = 0;
    let moveZ = 0;

    if (keys['KeyW'] || keys['ArrowUp'])    moveZ -= 1;
    if (keys['KeyS'] || keys['ArrowDown'])  moveZ += 1;
    if (keys['KeyA'] || keys['ArrowLeft'])  moveX -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) moveX += 1;

    if (moveX !== 0 || moveZ !== 0) {
      // Build a direction vector in world space using the camera yaw.
      if (this.cameraPivot) {
        this._forward.set(0, 0, -1).applyQuaternion(this.cameraPivot.quaternion);
        this._forward.y = 0;
        this._forward.normalize();
        this._right.crossVectors(this._forward, new THREE.Vector3(0, 1, 0)).normalize();

        const dirX = this._right.x * moveX + this._forward.x * -moveZ;
        const dirZ = this._right.z * moveX + this._forward.z * -moveZ;

        this._impulse.set(dirX * speed * dt, 0, dirZ * speed * dt);
        this.body.applyImpulse(this._impulse);
      }
    }

    // --- Jump ---------------------------------------------------------------
    if ((keys['Space']) && this.canJump) {
      this.body.velocity.y = this.jumpImpulse;
      this.canJump = false;
    }

    // --- Clamp horizontal speed --------------------------------------------
    const vx = this.body.velocity.x;
    const vz = this.body.velocity.z;
    const hSpeed = Math.sqrt(vx * vx + vz * vz);
    if (hSpeed > this.maxSpeed) {
      const scale = this.maxSpeed / hSpeed;
      this.body.velocity.x *= scale;
      this.body.velocity.z *= scale;
    }
  }

  /** World-space position of the player's feet. */
  get position() {
    return this.body.position;
  }

  /** Eye position (feet + height). Reuses an internal vector — no allocation. */
  get eyePosition() {
    this._eyePos.set(
      this.body.position.x,
      this.body.position.y + this.playerHeight,
      this.body.position.z
    );
    return this._eyePos;
  }
}
