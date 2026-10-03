/**
 * OperatorModel — the realistic third-person operator.
 *
 * Loads the skinned Soldier.glb (three.js sample asset, bundled in
 * public/models/) and drives its Idle / Walk / Run clips through an
 * AnimationMixer, crossfading on movement-state changes.
 *
 * Falls back silently (ready stays false) if the GLB can't be fetched —
 * PlayerController then keeps showing the procedural engineer instead.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export default class OperatorModel {
  constructor() {
    this.group = new THREE.Group();
    this.ready = false;
    this._mixer = null;
    this._actions = {};
    this._current = null;

    // Relative path — vite `base: './'` keeps this correct on the LAMP server.
    new GLTFLoader().load(
      'models/Soldier.glb',
      (gltf) => {
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
      },
      undefined,
      () => {} // failed — PlayerController falls back to the procedural model
    );
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
