import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import InputManager from './InputManager.js';
import { createEngineer } from './CharacterFactory.js';

/**
 * PlayerController — first/third-person movement and physics body.
 *
 * Movement is impulse-based through cannon-es so that collisions,
 * slopes and gravity "just work".  The controller:
 *   - reads WASD / arrow keys from InputManager,
 *   - applies horizontal impulses relative to the camera yaw,
 *   - handles jumping via ground-contact detection,
 *   - exposes the player body position for the camera to follow,
 *   - manages a placeholder character model (hidden in first-person).
 *
 * TODO (Person B): Replace the placeholder capsule/sphere model with
 * the real Blender engineer GLB once the asset is available.
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
    this.moveSpeed = 6;        // m/s walk speed
    this.sprintMultiplier = 1.8;
    this.jumpImpulse = 7;
    this.playerHeight = 1.7;   // eye height above feet
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
    this._contactNormal = new CANNON.Vec3(); // reusable for collision checks
    this.body.addEventListener('collide', (e) => {
      const contact = e.contact;
      // Get the world-space normal pointing FROM other body TOWARDS this body.
      if (contact.bi === this.body) {
        // ni points from bi (this) to bj (other) — we want the opposite.
        this._contactNormal.set(-contact.ni.x, -contact.ni.y, -contact.ni.z);
      } else {
        // ni points from bi (other) to bj (this) — already correct.
        this._contactNormal.copy(contact.ni);
      }
      if (this._contactNormal.y > 0.5) {
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

    // --- Character model (code-built engineer via CharacterFactory) --------
    // Swappable to a Blender .glb behind the same { group, update } API.
    this.scene = scene;
    this.character = createEngineer();
    this.playerModel = this.character.group;

    // Animation inputs — filled by update(), consumed by syncModel().
    this._lastDt = 0.016;
    this._charState = { moving: false, sprinting: false, grounded: true };

    // --- Stance / aim state (drives camera + speed) ------------------------
    this.isCrouching = false;
    this.isAiming = false;
    this._crouchBlend = 0; // smoothed 0..1 for the model squash

    // Hidden upper body in first-person (legs stay visible when looking down).
    // The engineer builds everything above the hips under one joint at y 0.9,
    // while legs (y 0.78) and pelvis (0.82) sit directly on the group — so a
    // simple height split cleanly separates "body above camera" from "legs".
    this._upperParts = [];
    this._lowerParts = [];
    this.playerModel.updateMatrixWorld(true);
    for (const child of this.playerModel.children) {
      const bucket = child.position.y > 0.85 ? this._upperParts : this._lowerParts;
      child.traverse((o) => { if (o.isMesh) bucket.push(o); });
    }
    this.isFirstPerson = true;

    // Hidden by default — starts in first-person mode.
    this.playerModel.visible = false;
    scene.add(this.playerModel);
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
    this._lastDt = dt;
    const keys = this.input.keys;
    const sprint = (keys['ShiftLeft'] || keys['ShiftRight']) && !this.isCrouching && !this.isAiming;
    let speed = this.moveSpeed * (sprint ? this.sprintMultiplier : 1);
    if (this.isCrouching) speed *= 0.5;   // sneaking — slower, quieter
    if (this.isAiming) speed *= 0.6;      // ADS — careful steps

    // --- Movement direction relative to camera yaw -------------------------
    let moveX = 0;
    let moveZ = 0;

    if (keys['KeyW']) moveZ -= 1;
    if (keys['KeyS']) moveZ += 1;
    if (keys['KeyA']) moveX -= 1;
    if (keys['KeyD']) moveX += 1;

    if (this.cameraPivot) {
      if (moveX !== 0 || moveZ !== 0) {
        // Build a direction vector in world space using the camera yaw.
        this._forward.set(0, 0, -1).applyQuaternion(this.cameraPivot.quaternion);
        this._forward.y = 0;
        this._forward.normalize();
        this._right.crossVectors(this._forward, new THREE.Vector3(0, 1, 0)).normalize();

        const dirX = this._right.x * moveX + this._forward.x * -moveZ;
        const dirZ = this._right.z * moveX + this._forward.z * -moveZ;

        // Normalise diagonal movement.
        const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
        if (len > 0) {
          // Direct velocity control — responsive and predictable.
          this.body.velocity.x = (dirX / len) * speed;
          this.body.velocity.z = (dirZ / len) * speed;
        }
      } else {
        // Stop horizontal movement when no keys are held.
        this.body.velocity.x = 0;
        this.body.velocity.z = 0;
      }
    }

    // --- Jump ---------------------------------------------------------------
    if ((keys['Space']) && this.canJump) {
      this.body.velocity.y = this.jumpImpulse;
      this.canJump = false;
    }

    // --- Animation state for the character model ---------------------------
    this._charState.moving = (moveX !== 0 || moveZ !== 0);
    this._charState.sprinting = sprint;
    this._charState.grounded = this.canJump;
  }

  /** World-space position of the player's feet. */
  get position() {
    return this.body.position;
  }

  /**
   * Sync the character model with the physics body.
   * Call once per frame from the game loop so the model tracks
   * position and yaw regardless of who is driving the update.
   */
  syncModel() {
    // The physics body is a sphere centred on the torso — offset by its
    // radius so the character's feet (built at local y = 0) touch the floor.
    this.playerModel.position.set(
      this.body.position.x,
      this.body.position.y - this.playerRadius,
      this.body.position.z
    );
    // Rotate the model to face the camera yaw direction.
    if (this.cameraPivot) {
      this.playerModel.rotation.y = this.cameraPivot.rotation.y;
    }

    // Smooth crouch: squash the model toward the floor. The camera lowers
    // itself via the crouching state — this keeps the silhouette matching.
    const target = this.isCrouching ? 0.68 : 1;
    this._crouchBlend += (target - this._crouchBlend) * Math.min(1, this._lastDt * 10);
    this.playerModel.scale.y = this._crouchBlend;

    // Drive the limb animation from the movement state captured in update().
    this.character.update(this._lastDt, this._charState);
  }

  /**
   * Set stance/aim flags for this frame (called by Game with input state).
   * @param {boolean} crouching
   * @param {boolean} aiming
   */
  setStance(crouching, aiming) {
    this.isCrouching = crouching;
    this.isAiming = aiming;
  }

  /**
   * Switch between first- and third-person body rendering.
   * FP: hide everything above the hips (torso/head/arms/backpack) so the
   * camera never sits inside geometry — legs remain visible looking down.
   * TP: the full operator silhouette is rendered.
   * @param {boolean} firstPerson
   */
  setViewMode(firstPerson) {
    this.isFirstPerson = firstPerson;
    this.playerModel.visible = true;
    for (const m of this._upperParts) m.visible = !firstPerson;
    for (const m of this._lowerParts) m.visible = true;
  }

  /** Show or hide the character model entirely (cutscenes, spawning). */
  setModelVisible(visible) {
    this.playerModel.visible = visible;
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
