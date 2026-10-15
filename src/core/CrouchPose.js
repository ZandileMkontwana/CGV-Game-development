import * as THREE from 'three';
import TwoBoneArm from './TwoBoneArm.js';

/** Lower the body and solve bent legs back to their animated foot placements. */
export default class CrouchPose {
  constructor(root, torso, legs, drop = 0.43, forwardSign = -1) {
    this.root = root;
    this.torso = torso;
    this.drop = drop;
    this.forwardSign = forwardSign;
    this._appliedDrop = 0;
    this._saved = [];
    this._legs = Object.values(legs).filter(leg => leg.upper && leg.lower && leg.hand)
      .map(leg => ({ ...leg, solver: new TwoBoneArm(leg), target: new THREE.Vector3(), rotation: new THREE.Quaternion() }));
    const joints = new Set([torso, ...this._legs.flatMap(leg => [leg.upper, leg.lower, leg.hand])]);
    for (const joint of joints) if (joint) this._saved.push({ joint, rotation: new THREE.Quaternion() });
    this._posed = false;
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._pole = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._parentRotation = new THREE.Quaternion();
    this._lean = new THREE.Quaternion();
  }

  restore() {
    if (!this._posed) return;
    this.root.position.y += this._appliedDrop;
    for (const saved of this._saved) saved.joint.quaternion.copy(saved.rotation);
    this._appliedDrop = 0;
    this._posed = false;
  }

  apply(blend, moving = false) {
    if (blend < 0.001 || !this._legs.length) return;
    this.root.updateWorldMatrix(true, true);
    this.root.getWorldPosition(this._origin);
    this._forward.set(0, 0, this.forwardSign).transformDirection(this.root.matrixWorld);
    this._right.set(1, 0, 0).transformDirection(this.root.matrixWorld);
    for (const saved of this._saved) saved.rotation.copy(saved.joint.quaternion);
    for (const leg of this._legs) {
      leg.hand.getWorldPosition(leg.target);
      leg.hand.getWorldQuaternion(leg.rotation);
      if (moving) {
        leg.target.x = THREE.MathUtils.lerp(leg.target.x, this._origin.x, blend * 0.18);
        leg.target.z = THREE.MathUtils.lerp(leg.target.z, this._origin.z, blend * 0.18);
      }
    }
    this._appliedDrop = this.drop * blend;
    this.root.position.y -= this._appliedDrop;
    this._posed = true;
    if (this.torso) {
      this.torso.parent.getWorldQuaternion(this._parentRotation).invert();
      this._right.applyQuaternion(this._parentRotation);
      this._lean.setFromAxisAngle(this._right, this.forwardSign * 0.22 * blend);
      this.torso.quaternion.premultiply(this._lean);
    }
    this.root.updateWorldMatrix(true, true);
    for (const leg of this._legs) {
      this._pole.copy(leg.target).addScaledVector(this._forward, 0.8);
      this._pole.y += 0.35;
      leg.solver.solve(leg.target, this._pole, leg.rotation);
    }
  }
}
