import * as THREE from 'three';
import InputManager from './InputManager.js';

/**
 * CameraController — first-person camera driven by mouse-look.
 *
 * Owns a THREE.PerspectiveCamera and a yaw/pitch rig:
 *   yawObject   → rotates around Y (left/right mouse)
 *   pitchObject → rotates around X (up/down mouse), child of yawObject
 *   camera      → attached to pitchObject
 *
 * The rig is exposed as `yawObject` so that PlayerController can read
 * the camera's yaw direction for movement.
 */
export default class CameraController {
  /**
   * @param {THREE.Scene} scene
   * @param {InputManager} input
   */
  constructor(scene, input) {
    this.input = input;
    this.sensitivity = 0.002;
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
   * @param {number} dt  delta time in seconds
   * @param {import('cannon-es').Vec3} eyePosition  player eye position
   */
  update(dt, eyePosition) {
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

    // --- Position camera at player eyes ------------------------------------
    this.yawObject.position.set(eyePosition.x, eyePosition.y, eyePosition.z);

    // --- Screen shake -------------------------------------------------------
    if (this.shakeIntensity > 0) {
      this.camera.position.x = (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.y = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - this.shakeDecay * dt);
    } else {
      this.camera.position.x = 0;
      this.camera.position.y = 0;
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
