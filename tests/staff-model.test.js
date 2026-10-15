import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import StaffModel from '../src/core/StaffModel.js';
import ResearcherOperator from '../src/core/ResearcherOperator.js';
import HeldWeapon from '../src/core/HeldWeapon.js';

test('every staff role has a complete coat rig with a visible face and compact geometry', () => {
  for (const role of ['tech', 'coat', 'supervisor', 'security']) {
    const staff = new StaffModel(role);
    const mesh = staff._mesh;
    staff.group.updateMatrixWorld(true);
    mesh.skeleton.update();
    const bounds = new THREE.Box3().setFromObject(staff.group);
    const height = bounds.max.y - bounds.min.y;
    assert(height > 1.7 && height < 1.85);
    assert(bounds.min.y >= -0.01, 'Feet must start on the floor');
    assert(mesh.isSkinnedMesh);
    assert.equal(mesh.geometry.groups.length, 7, 'Details are merged by material');
    assert(mesh.material.some(m => m.name === 'lab-coat' && m.color.r > 0.8));
    assert(mesh.material.some(m => m.name === 'skin'));
    assert(mesh.material.every(m => m.map === null), 'No soldier texture is retained');
    assert(staff.joints.coatL && staff.joints.coatR && staff.joints.head);
    staff.dispose();
  }
});

test('researchers animate and release their rigs independently during patrol and escape', () => {
  const first = new StaffModel('tech');
  const second = new StaffModel('supervisor');
  assert.notEqual(first._mesh.skeleton, second._mesh.skeleton);
  assert.notEqual(first.joints.head, second.joints.head);
  assert.notEqual(first._materials[0], second._materials[0]);
  for (let i = 0; i < 50; i++) {
    first.update(1 / 60, { moving: true, fleeing: true, speed: 3.1 });
    second.update(1 / 60, { moving: false });
  }
  assert.equal(first._current, 'run');
  assert.equal(second._current, 'idle');
  assert(Math.abs(first.joints.legL.rotation.x) > 0.1);
  assert(Math.abs(first.joints.coatL.rotation.x) > 0.1);
  assert.equal(second.joints.legL.rotation.x, 0);
  assert.equal(first.joints.kneeL.position.y, -0.39, 'Animation cannot stretch limbs');
  let released = 0, peerReleased = 0;
  first._geometry.addEventListener('dispose', () => released++);
  second._geometry.addEventListener('dispose', () => peerReleased++);
  first.dispose();
  first.dispose();
  assert.equal(released, 1);
  assert.equal(peerReleased, 0);
  second.update(0.2, { moving: true, speed: 1.4 });
  assert.equal(second._current, 'walk');
  second.dispose();
});

test('the player coat supports planted-foot crouching and both rifle grips at different headings', () => {
  for (const yaw of [0, Math.PI / 2]) {
    const actor = new ResearcherOperator();
    const j = actor.joints;
    actor.group.rotation.y = yaw;
    actor.group.updateMatrixWorld(true);
    const planted = j.ankleL.getWorldPosition(new THREE.Vector3());
    actor.update(0.1, { moving: false }, 1);
    assert(j.ankleL.getWorldPosition(new THREE.Vector3()).distanceTo(planted) < 1e-5);
    assert(Math.hypot(j.kneeL.rotation.x, j.kneeL.rotation.y, j.kneeL.rotation.z) > 0.2);
    const weapon = new HeldWeapon(new THREE.Scene());
    const player = { operator: actor, _crouchBlend: 1, cameraPivot: actor.group,
      position: { x: 0, y: 0.4, z: 0 }, playerRadius: 0.4 };
    weapon.update(0.016, player, new THREE.Vector3(-Math.sin(yaw) * 8, 1, -Math.cos(yaw) * 8));
    for (const side of ['right', 'left']) {
      const target = weapon[side === 'right' ? '_rightGrip' : '_leftGrip'].clone().applyMatrix4(weapon.group.matrixWorld);
      assert(actor.arms[side].hand.getWorldPosition(new THREE.Vector3()).distanceTo(target) < 1e-4);
    }
    actor.dispose();
  }
});
