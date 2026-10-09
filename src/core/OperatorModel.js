/**
 * OperatorModel — the realistic third-person operator.
 *
 * Preference chain:
 *   1. `public/assets/models/engineer.glb` (Blender export, via AssetLibrary)
 *      — clips `Idle`, `Walk`, `Run` (optional `Crouch`).
 *   2. The skinned Soldier.glb sample (bundled in public/models/) with the
 *      same clip names — loaded directly, as before.
 *   3. Neither → `ready` stays false and PlayerController keeps showing the
 *      procedural engineer.
 *
 * The engineer GLB is normalised (standing height 1.8 m, floor at local
 * y = 0, facing +Z) so the existing PlayerController mounting needs no
 * change; the Soldier path is used as-is, exactly as it always was.
 *
 * Clips crossfade on movement-state changes via an AnimationMixer.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import AssetLibrary from './AssetLibrary.js';

/** Normalisation target for the engineer export (matches Soldier scale). */
const STAND_HEIGHT = 1.8;
/**
 * Rotation applied to the imported scene to face +Z. Blender front-view
 * exports normally arrive facing +Z already. If the engineer moonwalks,
 * flip this to Math.PI.
 */
const FACE_YAW = 0;

export default class OperatorModel {
  constructor() {
    this.group = new THREE.Group();
    this.ready = false;
    this._mixer = null;
    this._actions = {};
    this._current = null;

    // 1. Blender engineer from the preloaded AssetLibrary.
    const gltf = AssetLibrary.getModel('engineer');
    if (gltf) {
      this._adopt(gltf, true);
      return;
    }

    // 2. Soldier.glb fallback — direct fetch (relative path; vite base './'
    //    keeps this correct on the LAMP server).
    new GLTFLoader().load(
      'models/Soldier.glb',
      (g) => this._adopt(g, false),
      undefined,
      () => {} // failed — PlayerController falls back to the procedural model
    );
  }

  /**
   * Take ownership of a loaded gltf: shadows, optional normalisation, mixer.
   * @param {object} gltf
   * @param {boolean} normalise engineer path only — Soldier already fits
   */
  _adopt(gltf, normalise) {
    const model = gltf.scene;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        // Skinned meshes deform away from their static bounds — disable
        // culling so limbs never pop out of view mid-animation.
        o.frustumCulled = false;
      }
    });

    if (normalise) {
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const s = size.y > 0.01 ? STAND_HEIGHT / size.y : 1;
      model.scale.multiplyScalar(s);
      // Re-scale the offset from the (pre-scaling) bounds: centre + floor.
      model.position.set(
        -(box.min.x + box.max.x) * 0.5 * s,
        -box.min.y * s,
        -(box.min.z + box.max.z) * 0.5 * s
      );
      model.rotation.y = FACE_YAW;
    }

    this.group.add(model);

    this._mixer = new THREE.AnimationMixer(model);
    const find = (name) => THREE.AnimationClip.findByName(gltf.animations, name);
    for (const [key, clip] of [['idle', find('Idle')], ['walk', find('Walk')], ['run', find('Run')]]) {
      if (clip) {
        const action = this._mixer.clipAction(clip);
        action.play();
        this._actions[key] = action;
      }
    }
    this._current = 'idle';
    this.ready = true;
  }

  /** Crossfade to a clip (no-op if it's already playing). */
  _play(name) {
    const next = this._actions[name];
    if (!next || this._current === name) return;
    const prev = this._actions[this._current];
    next.reset();
    next.fadeIn(0.22);
    next.play();
    if (prev) prev.fadeOut(0.22);
    this._current = name;
  }

  /**
   * @param {number} dt
   * @param {{moving:boolean, sprinting:boolean, grounded:boolean}} s
   */
  update(dt, s) {
    if (!this._mixer) return;
    if (s && s.moving) this._play(s.sprinting ? 'run' : 'walk');
    else this._play('idle');
    this._mixer.update(dt);
  }
}
