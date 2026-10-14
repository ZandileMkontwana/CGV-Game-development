import * as THREE from 'three';

/** Pose a shoulder/elbow/wrist chain toward a grip, preserving limb lengths. */
export default class TwoBoneArm {
  constructor({ upper, lower, hand }) {
    this.upper = upper;
    this.lower = lower;
    this.hand = hand;
    this.valid = !!(upper && lower && hand);
    this._shoulder = new THREE.Vector3();
    this._elbow = new THREE.Vector3();
    this._wrist = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._bend = new THREE.Vector3();
    this._desiredElbow = new THREE.Vector3();
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._rotation = new THREE.Quaternion();
    this._parentRotation = new THREE.Quaternion();
    this._baseMatrix = new THREE.Matrix4();
    this._baseInverse = new THREE.Matrix4();
    this._parentInverse = new THREE.Matrix4();
    this._target = new THREE.Vector3();
    this._pole = new THREE.Vector3();
  }

  solve(target, pole, handRotation) {
    if (!this.valid) return;
    this.upper.updateWorldMatrix(true, true);
    this._baseMatrix.copy(this.upper.parent.matrixWorld);
    this._baseInverse.copy(this._baseMatrix).invert();
    this.upper.getWorldPosition(this._shoulder);
    this.lower.getWorldPosition(this._elbow);
    this.hand.getWorldPosition(this._wrist);
    // Solve in the shoulder parent's coordinates so crouch scaling and the
    // centimetre-based GLB skeleton do not change the limb-length constraints.
    this._shoulder.applyMatrix4(this._baseInverse);
    this._elbow.applyMatrix4(this._baseInverse);
    this._wrist.applyMatrix4(this._baseInverse);
    this._target.copy(target).applyMatrix4(this._baseInverse);
    this._pole.copy(pole).applyMatrix4(this._baseInverse);
    const upperLength = this._shoulder.distanceTo(this._elbow);
    const lowerLength = this._elbow.distanceTo(this._wrist);
    if (upperLength < 1e-5 || lowerLength < 1e-5) return;

    this._direction.subVectors(this._target, this._shoulder);
    const distance = this._direction.length();
    if (distance < 1e-5) return;
    this._direction.divideScalar(distance);
    const reach = THREE.MathUtils.clamp(distance, Math.abs(upperLength - lowerLength) + 1e-5, upperLength + lowerLength - 1e-5);
    const along = (upperLength * upperLength + reach * reach - lowerLength * lowerLength) / (2 * reach);
    const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
    this._bend.subVectors(this._pole, this._shoulder);
    this._bend.addScaledVector(this._direction, -this._bend.dot(this._direction));
    if (this._bend.lengthSq() < 1e-8) {
      this._bend.set(0, 1, 0).addScaledVector(this._direction, -this._direction.y);
      if (this._bend.lengthSq() < 1e-8) this._bend.set(1, 0, 0);
    }
    this._bend.normalize();
    this._desiredElbow.copy(this._shoulder).addScaledVector(this._direction, along).addScaledVector(this._bend, height);
    this._desiredElbow.applyMatrix4(this._baseMatrix);
    this._rotate(this.upper, this.lower, this._desiredElbow);
    this.upper.updateWorldMatrix(false, true);
    this._rotate(this.lower, this.hand, target);
    this.lower.updateWorldMatrix(false, true);
    if (handRotation) {
      this.hand.parent.getWorldQuaternion(this._parentRotation).invert();
      this.hand.quaternion.copy(this._parentRotation).multiply(handRotation);
      this.hand.updateWorldMatrix(false, true);
    }
  }

  _rotate(bone, child, target) {
    this._parentInverse.copy(bone.parent.matrixWorld).invert();
    child.getWorldPosition(this._from).applyMatrix4(this._parentInverse).sub(bone.position).normalize();
    this._to.copy(target).applyMatrix4(this._parentInverse).sub(bone.position).normalize();
    this._rotation.setFromUnitVectors(this._from, this._to);
    bone.quaternion.premultiply(this._rotation);
  }
}
