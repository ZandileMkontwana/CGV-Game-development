import * as THREE from 'three';
import InputManager from './InputManager.js';

/**
 * CameraController — first-person / third-person camera with smooth toggle.
 *
 * Owns a THREE.PerspectiveCamera and a yaw/pitch rig:
 *   yawObject   → rotates around Y (left/right mouse)
 *   pitchObject → rotates around X (up/down mouse), child of yawObject
 *   camera      → attached to pitchObject
 *
 * The rig is exposed as `yawObject` so that PlayerController can read
 * the camera's yaw direction for movement.
 *
 * Press V to toggle between first-person (camera at eye level) and
 * third-person (camera behind and above the player, model visible).
 * The transition uses exponential smoothing for a polished feel.
 */
export default class CameraController {
  /**
   * @param {THREE.Scene} scene
   * @param {InputManager} input
   */
  constructor(scene, input) {
    this.input = input;
    this.sensitivity = 0.002;
    this.keyTurnSpeed = 2.5;  // radians/second for arrow-key turning
    this.pitchLimit = Math.PI / 2 - 0.05; // prevent flipping

    // --- Camera -------------------------------------------------------------
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );

    // --- Yaw / Pitch rig ----------------------------------------------------
    this.yawObject = new THREE.Object3D();   // rotates around Y axis
    this.pitchObject = new THREE.Object3D(); // rotates around X axis
    this.yawObject.add(this.pitchObject);
    this.pitchObject.add(this.camera);
    scene.add(this.yawObject);

    // --- First / Third person toggle state ----------------------------------
    /** @type {boolean} true = first-person, false = third-person */
    this.isFirstPerson = true;

    /** Third-person offset: how far behind and above the player the camera sits */
    this.tpDistance = 4.0;   // metres behind the player
    this.tpHeight = 1.8;    // metres above the pivot point

    /** Speed of the FP↔TP lerp transition (higher = snappier) */
    this.transitionSpeed = 6;

    /** Height offsets used when positioning the yaw pivot. */
    this.fpPivotHeight = 1.7;   // eye level — same as PlayerController.playerHeight
    this.tpPivotHeight = 1.2;   // shoulder level — frames the character nicely

    // Reusable vectors for per-frame camera offset calculation.
    // Avoids allocating new Vector3 objects every frame.
    this._targetOffset = new THREE.Vector3();
    this._currentOffset = new THREE.Vector3(0, 0, 0);
    this._pivotPos = new THREE.Vector3(); // current pivot target (lerped)

    // --- Screen shake state -------------------------------------------------
    this.shakeIntensity = 0;
    this.shakeDecay = 5; // intensity reduces per second

    // --- Resize handler -----------------------------------------------------
    this._onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._onResize);
  }

  /**
   * Toggle between first-person and third-person camera views.
   * The actual transition is interpolated smoothly each frame in update().
   */
  toggleView() {
    this.isFirstPerson = !this.isFirstPerson;
  }

  /**
   * @param {number} dt  delta time in seconds
   * @param {import('cannon-es').Vec3} feetPosition  player feet position (body.position)
   */
  update(dt, feetPosition) {
    // --- V key toggle (justPressed fires only once per keypress) -------------
    if (this.input.justPressed('KeyV')) {
      this.toggleView();
    }

    // --- Mouse look ---------------------------------------------------------
    if (this.input.mouse.locked) {
      this.yawObject.rotation.y -= this.input.mouse.dx * this.sensitivity;
      this.pitchObject.rotation.x -= this.input.mouse.dy * this.sensitivity;
      this.pitchObject.rotation.x = THREE.MathUtils.clamp(
        this.pitchObject.rotation.x,
        -this.pitchLimit,
        this.pitchLimit
      );
    }

    // --- Arrow key turning (works without pointer lock) ---------------------
    const keys = this.input.keys;
    if (keys['ArrowLeft'])  this.yawObject.rotation.y += this.keyTurnSpeed * dt;
    if (keys['ArrowRight']) this.yawObject.rotation.y -= this.keyTurnSpeed * dt;
    if (keys['ArrowUp']) {
      this.pitchObject.rotation.x += this.keyTurnSpeed * dt;
      this.pitchObject.rotation.x = Math.min(this.pitchObject.rotation.x, this.pitchLimit);
    }
    if (keys['ArrowDown']) {
      this.pitchObject.rotation.x -= this.keyTurnSpeed * dt;
      this.pitchObject.rotation.x = Math.max(this.pitchObject.rotation.x, -this.pitchLimit);
    }

    // --- Smooth FP↔TP pivot height + camera offset transition ---------------
    //
    // The yaw pivot height changes between eye level (FP) and shoulder
    // level (TP) so that the character is framed correctly in TP view.
    // The camera offset moves from (0,0,0) to (0, tpHeight, tpDistance)
    // behind and above the pivot.  Exponential smoothing gives a cinematic
    // lerp without allocating any objects per frame.
    const lerpFactor = 1 - Math.exp(-this.transitionSpeed * dt);

    const targetPivotY = this.isFirstPerson ? this.fpPivotHeight : this.tpPivotHeight;
    this._pivotPos.y += (targetPivotY - this._pivotPos.y) * lerpFactor;
    this.yawObject.position.set(
      feetPosition.x,
      feetPosition.y + this._pivotPos.y,
      feetPosition.z
    );

    if (this.isFirstPerson) {
      this._targetOffset.set(0, 0, 0);
    } else {
      this._targetOffset.set(0, this.tpHeight, this.tpDistance);
    }

    this._currentOffset.lerp(this._targetOffset, lerpFactor);
    this.camera.position.set(
      this._currentOffset.x,
      this._currentOffset.y,
      -this._currentOffset.z   // negative Z = behind the player
    );

    // --- Screen shake (first-person only — feels wrong in third-person) -----
    if (this.shakeIntensity > 0 && this.isFirstPerson) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - this.shakeDecay * dt);
    } else if (!this.isFirstPerson) {
      // Decay shake even when in TP so it's clean on switch back.
      this.shakeIntensity = Math.max(0, this.shakeIntensity - this.shakeDecay * dt);
    }
  }

  /** Trigger screen shake (e.g. explosion, boss hit). */
  shake(intensity = 0.3) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
  }

  /** Clean up the resize listener when the game is torn down. */
  dispose() {
    window.removeEventListener('resize', this._onResize);
  }
}
