import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import CrouchPose from '../src/core/CrouchPose.js';

test('crouching bends the knees without shortening limbs or moving planted feet', () => {
  for (const units of [1, 100]) {
    const root = new THREE.Group();
    root.position.set(2, 0.1, -8);
    root.rotation.y = Math.PI / 3;
    const rig = new THREE.Group();
    rig.scale.setScalar(1 / units);
    root.add(rig);
    const torso = new THREE.Group();
    torso.position.y = units;
    rig.add(torso);
    const upper = new THREE.Bone();
    const lower = new THREE.Bone();
    const foot = new THREE.Bone();
    upper.position.set(0.12 * units, 0.8 * units, 0);
    lower.position.y = -0.4 * units;
    foot.position.y = -0.4 * units;
    rig.add(upper); upper.add(lower); lower.add(foot);
    root.updateMatrixWorld(true);
    const planted = foot.getWorldPosition(new THREE.Vector3());
    const initialUpper = upper.quaternion.clone();
    const initialFootRotation = foot.getWorldQuaternion(new THREE.Quaternion());
    const pose = new CrouchPose(root, torso, { left: { upper, lower, hand: foot } }, 0.3);
    pose.apply(1);
    root.updateMatrixWorld(true);
    assert(foot.getWorldPosition(new THREE.Vector3()).distanceTo(planted) < 1e-5);
    const hipPosition = upper.getWorldPosition(new THREE.Vector3());
    const kneePosition = lower.getWorldPosition(new THREE.Vector3());
    assert(Math.abs(hipPosition.distanceTo(kneePosition) - 0.4) < 1e-6);
    assert(Math.abs(kneePosition.distanceTo(planted) - 0.4) < 1e-6);
    assert(upper.quaternion.angleTo(initialUpper) > 0.6, 'A visible knee bend is required');
    assert(foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(initialFootRotation) < 1e-6);
    assert.equal(root.scale.y, 1);
    assert(Math.abs(root.position.y + 0.2) < 1e-6);
    pose.restore();
    root.updateMatrixWorld(true);
    assert(Math.abs(root.position.y - 0.1) < 1e-6);
    assert(upper.quaternion.angleTo(initialUpper) < 1e-6);
    assert(foot.getWorldPosition(new THREE.Vector3()).distanceTo(planted) < 1e-6);
    pose.restore();
    assert(Math.abs(root.position.y - 0.1) < 1e-6, 'Restoring twice must not raise the body twice');
  }
});
