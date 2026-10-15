/**
 * OperatorModel — the realistic third-person operator.
 *
 * Loads the skinned soldier.glb (three.js sample asset, bundled in
 * public/models/) and drives its Idle / Walk / Run clips through an
 * AnimationMixer, crossfading on movement-state changes.
 *
 * Falls back silently (ready stays false) if the GLB can't be fetched —
 * PlayerController then keeps showing the procedural engineer instead.
 */
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadCharacterTemplate } from './CharacterAssets.js';
import CrouchPose from './CrouchPose.js';

/** Start the locomotion mixer with exactly one contributing clip. */
export function createLocomotionActions(mixer, animations) {
  const actions = {};
  for (const [key, name] of [['idle', 'Idle'], ['walk', 'Walk'], ['run', 'Run']]) {
    const clip = THREE.AnimationClip.findByName(animations, name);
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    action.setEffectiveWeight(key === 'idle' ? 1 : 0);
    action.play();
    actions[key] = action;
  }
  return actions;
}

export default class OperatorModel {
  constructor(loadingManager) {
    this.group = new THREE.Group();
    this.ready = false;
    this._mixer = null;
    this._actions = {};
    this._current = null;

    // Relative path — vite `base: './'` keeps this correct on the LAMP server.
    loadCharacterTemplate(loadingManager).then(
      (gltf) => {
        const model = clone(gltf.scene);
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
        this._actions = createLocomotionActions(this._mixer, gltf.animations);
        this._current = 'idle';
        this.arms = {};
        for (const side of ['Right', 'Left']) {
          const findBone = suffix => model.getObjectByName(`mixamorig${side}${suffix}`);
          this.arms[side.toLowerCase()] = {
            upper: findBone('Arm'), lower: findBone('ForeArm'), hand: findBone('Hand'),
          };
        }
        const legs = {};
        for (const side of ['Right', 'Left']) {
          legs[side.toLowerCase()] = {
            upper: model.getObjectByName(`mixamorig${side}UpLeg`),
            lower: model.getObjectByName(`mixamorig${side}Leg`),
            hand: model.getObjectByName(`mixamorig${side}Foot`),
          };
        }
        this.crouchPose = new CrouchPose(this.group, model.getObjectByName('mixamorigSpine'), legs);
        this.ready = true;
      },
      () => {} // failed — PlayerController falls back to the procedural model
    );
  }

  /** Crossfade to a clip (no-op if it's already playing). */
  _play(name) {
    const next = this._actions[name];
    if (!next || this._current === name) return;
    const prev = this._actions[this._current];
    next.reset();
    next.setEffectiveWeight(1);
    next.fadeIn(0.22);
    next.play();
    if (prev) prev.fadeOut(0.22);
    this._current = name;
  }

  /**
   * @param {number} dt
   * @param {{moving:boolean, sprinting:boolean, grounded:boolean}} s
   */
  update(dt, s, crouchBlend = 0) {
    if (!this._mixer) return;
    this.crouchPose?.restore();
    if (s && s.moving) this._play(s.sprinting ? 'run' : 'walk');
    else this._play('idle');
    this._mixer.update(dt);
    this.crouchPose?.apply(crouchBlend, s?.moving);
  }
}
