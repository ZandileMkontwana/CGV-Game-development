import * as THREE from 'three';
import StaffModel from './StaffModel.js';
import CrouchPose from './CrouchPose.js';

/** The same lab coat on the player, with crouching and two-handed aiming. */
export default class ResearcherOperator extends StaffModel {
  constructor() {
    super('tech');
    const body = this.group;
    body.rotation.y = Math.PI;
    this.group = new THREE.Group();
    this.group.name = 'player-scientist';
    this.group.add(body);
    const j = this.joints;
    this.arms = {
      right: { upper: j.armL, lower: j.elbL, hand: j.handL },
      left: { upper: j.armR, lower: j.elbR, hand: j.handR },
    };
    const legs = {
      right: { upper: j.legL, lower: j.kneeL, hand: j.ankleL },
      left: { upper: j.legR, lower: j.kneeR, hand: j.ankleR },
    };
    this.crouchPose = new CrouchPose(this.group, j.torso, legs);
    this._locomotion = { moving: false, fleeing: false, speed: 0 };
  }

  update(dt, state = {}, crouchBlend = 0) {
    // StaffModel invokes update once while constructing the base rig.
    if (!this._locomotion) { super.update(dt, state); return; }
    this.crouchPose.restore();
    this._locomotion.moving = !!state.moving;
    this._locomotion.fleeing = !!state.sprinting;
    this._locomotion.speed = state.sprinting ? 3.1 : 1.4;
    super.update(dt, this._locomotion);
    this.crouchPose.apply(crouchBlend, state.moving);
  }
}
