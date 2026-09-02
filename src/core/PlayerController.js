import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import InputManager from './InputManager.js';

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

    // --- Placeholder character model (visible in third-person only) --------
    // TODO (Person B): Replace with GLTFLoader'd engineer model.
    this.scene = scene;
    this.playerModel = new THREE.Group();

    // Body — capsule (cylinder + hemisphere caps).
    const bodyGeo = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3366aa });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 0.8; // feet to mid-torso
    bodyMesh.castShadow = true;
    this.playerModel.add(bodyMesh);

    // Head — sphere.
    const headGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xe8b87a });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    headMesh.position.y = 1.55; // sits on top of the capsule
    headMesh.castShadow = true;
    this.playerModel.add(headMesh);

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
    const keys = this.input.keys;
    const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
    const speed = this.moveSpeed * (sprint ? this.sprintMultiplier : 1);

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
  }

  /** World-space position of the player's feet. */
  get position() {
    return this.body.position;
  }

  /**
   * Sync the placeholder character model with the physics body.
   * Call once per frame from the game loop so the model tracks
   * position and yaw regardless of who is driving the update.
   */
  syncModel() {
    this.playerModel.position.set(
      this.body.position.x,
      this.body.position.y,
      this.body.position.z
    );
    // Rotate the model to face the camera yaw direction.
    if (this.cameraPivot) {
      this.playerModel.rotation.y = this.cameraPivot.rotation.y;
    }
  }

  /** Show or hide the character model (called by CameraController). */
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
