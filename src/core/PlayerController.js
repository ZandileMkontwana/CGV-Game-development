import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import InputManager from './InputManager.js';
import { createEngineer } from './CharacterFactory.js';
import OperatorModel from './OperatorModel.js';

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
      collisionFilterGroup: 2, // ground raycast masks this out (group 1 = world)
    });
    physicsWorld.world.addBody(this.body);

    // --- Ground contact: short downward ray each frame ----------------------
    // Collide events only fire on NEW contacts, so they can't tell you when
    // you've walked off a ledge — the ray (plus a coyote window) can.
    this.grounded = false;
    this.coyoteTime = 0.12; // seconds of forgiveness after leaving an edge
    this._groundTime = -10; // last time the ray touched the floor
    this._clock = 0;
    this._rayFrom = new CANNON.Vec3();
    this._rayTo = new CANNON.Vec3();
    this._rayResult = new CANNON.RaycastResult();

    // --- Reusable vectors (avoid per-frame allocation) ---------------------
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
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

    // --- Realistic third-person operator (skinned Soldier.glb) -------------
    // Streams in async; until it's ready (or if it fails) the procedural
    // engineer doubles as the third-person body.
    this.operator = new OperatorModel();
    this.operator.group.visible = false;
    scene.add(this.operator.group);

    // Hidden by default — starts in first-person mode.
    this.playerModel.visible = false;
    scene.add(this.playerModel);
  }

  /** Reset to a spawn position. */
  spawn(x, y, z) {
    this.body.position.set(x, y, z);
    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
    this._groundTime = -10;
  }

  /**
   * Called once per frame.
   * @param {number} dt delta time in seconds
   */
  update(dt) {
    this._lastDt = dt;
    this._clock += dt;
    const keys = this.input.keys;
    const sprint = (keys['ShiftLeft'] || keys['ShiftRight']) && !this.isCrouching && !this.isAiming;
    let speed = this.moveSpeed * (sprint ? this.sprintMultiplier : 1);
    if (this.isCrouching) speed *= 0.5;   // sneaking — slower, quieter
    if (this.isAiming) speed *= 0.6;      // ADS — careful steps

    // --- Grounding: short ray from just under the sphere down to 0.2 below --
    // Starting below our own collider means the ray can never self-hit (and
    // cannon's skipBackfaces doesn't cover spheres); collisionFilterMask 1
    // additionally ignores the player body (group 2).
    this._rayFrom.set(this.body.position.x, this.body.position.y - this.playerRadius - 0.02, this.body.position.z);
    this._rayTo.set(this.body.position.x, this.body.position.y - this.playerRadius - 0.22, this.body.position.z);
    this._rayResult.reset();
    this.physicsWorld.world.raycastClosest(
      this._rayFrom, this._rayTo,
      { skipBackfaces: true, collisionFilterMask: 1 },
      this._rayResult
    );
    if (this._rayResult.hasHit) this._groundTime = this._clock;
    this.grounded = (this._clock - this._groundTime) < this.coyoteTime;

    // --- Movement direction relative to camera yaw -------------------------
    let moveX = 0;
    let moveZ = 0;

    if (keys['KeyW']) moveZ -= 1;
    if (keys['KeyS']) moveZ += 1;
    if (keys['KeyA']) moveX -= 1;
    if (keys['KeyD']) moveX += 1;

    if (this.cameraPivot && (moveX !== 0 || moveZ !== 0)) {
      // Build a direction vector in world space using the camera yaw.
      this._forward.set(0, 0, -1).applyQuaternion(this.cameraPivot.quaternion);
      this._forward.y = 0;
      this._forward.normalize();
      this._right.crossVectors(this._forward, this._up).normalize();

      const dirX = this._right.x * moveX + this._forward.x * -moveZ;
      const dirZ = this._right.z * moveX + this._forward.z * -moveZ;

      // Normalise diagonal movement → target velocity.
      const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
      const tvx = (dirX / len) * speed;
      const tvz = (dirZ / len) * speed;

      // Grounded: approach target fast (snappy, but smooths frame spikes).
      // Air: only gentle steering — no helicopter strafing mid-jump.
      const k = Math.min(1, dt * (this.grounded ? 16 : 2.5));
      this.body.velocity.x += (tvx - this.body.velocity.x) * k;
      this.body.velocity.z += (tvz - this.body.velocity.z) * k;
    } else if (this.grounded) {
      // Weighty but quick stop when keys release; airborne keeps momentum.
      const k = Math.min(1, dt * 20);
      this.body.velocity.x -= this.body.velocity.x * k;
      this.body.velocity.z -= this.body.velocity.z * k;
    }

    // --- Jump (coyote window lets an edge jump fire just after leaving) ----
    if (keys['Space'] && this.grounded) {
      this.body.velocity.y = this.jumpImpulse;
      this._groundTime = -10; // consume the coyote window — no double jumps
    }

    // --- Animation state for the character model ---------------------------
    this._charState.moving = (moveX !== 0 || moveZ !== 0);
    this._charState.sprinting = sprint;
    this._charState.grounded = this.grounded;
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
    const px = this.body.position.x;
    const py = this.body.position.y - this.playerRadius;
    const pz = this.body.position.z;
    const yaw = this.cameraPivot ? this.cameraPivot.rotation.y : 0;

    // Smooth crouch: squash the model toward the floor. The camera lowers
    // itself via the crouching state — this keeps the silhouette matching.
    const target = this.isCrouching ? 1 : 0;
    this._crouchBlend += (target - this._crouchBlend) * Math.min(1, this._lastDt * 10);

    // Procedural engineer (first-person legs + TP fallback).
    this.playerModel.position.set(px, py, pz);
    this.playerModel.rotation.y = yaw;
    this.playerModel.scale.y = 1 - this._crouchBlend * 0.32;
    this.character.update(this._lastDt, this._charState);

    // Skinned operator (third person) — same transform, subtler crouch.
    if (this.operator.ready) {
      this.operator.group.position.set(px, py, pz);
      this.operator.group.rotation.y = yaw;
      this.operator.group.scale.y = 1 - this._crouchBlend * 0.18;
      this.operator.update(this._lastDt, this._charState);
    }
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
   * FP: the soldier is hidden; the engineer's lower half stays visible so
   * you see your legs looking down, while everything above the hips hides
   * (the camera sits where the torso would be).
   * TP: the skinned soldier renders when loaded — otherwise the full
   * procedural engineer falls in.
   * @param {boolean} firstPerson
   */
  setViewMode(firstPerson) {
    this.isFirstPerson = firstPerson;
    const useOperator = !firstPerson && this.operator.ready;
    this.operator.group.visible = useOperator;
    // TP+soldier: skinned operator only. FP / fallback: procedural engineer,
    // upper body hidden in FP (camera sits inside the torso) but legs stay
    // visible so looking down shows the character, like CoD.
    this.playerModel.visible = !useOperator;
    for (const m of this._upperParts) m.visible = !firstPerson && !useOperator;
    for (const m of this._lowerParts) m.visible = !useOperator;
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
