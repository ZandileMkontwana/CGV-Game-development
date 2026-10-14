import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import OperatorModel, { createLocomotionActions } from '../src/core/OperatorModel.js';
import TwoBoneArm from '../src/core/TwoBoneArm.js';
import PulseTool from '../src/core/PulseTool.js';

test('stationary operators start and return to idle without walking clips affecting the legs', () => {
  const root = new THREE.Group();
  const leg = new THREE.Object3D();
  leg.name = 'leg';
  root.add(leg);
  const clip = (name, angle) => new THREE.AnimationClip(name, 1, [
    new THREE.NumberKeyframeTrack('leg.rotation[x]', [0, 0.5, 1], [0, angle, 0]),
  ]);
  const operator = Object.create(OperatorModel.prototype);
  operator._mixer = new THREE.AnimationMixer(root);
  operator._actions = createLocomotionActions(operator._mixer, [clip('Idle', 0), clip('Walk', 0.6), clip('Run', 1)]);
  operator._current = 'idle';
  for (let i = 0; i < 30; i++) operator.update(1 / 60, { moving: false });
  assert.equal(leg.rotation.x, 0, 'Idle must not blend in a walking or running stride');
  for (let i = 0; i < 30; i++) operator.update(1 / 60, { moving: true, sprinting: false });
  assert(leg.rotation.x > 0.3, 'Moving must produce a stride');
  // Rapid locomotion changes must not leave a previous action contributing.
  for (let i = 0; i < 12; i++) operator.update(1 / 60, { moving: true, sprinting: i % 2 === 0 });
  for (let i = 0; i < 45; i++) operator.update(1 / 60, { moving: false });
  assert.equal(leg.rotation.x, 0);
  assert.equal(operator._actions.walk.getEffectiveWeight(), 0);
  assert.equal(operator._actions.run.getEffectiveWeight(), 0);
});

test('weapon grips remain reachable under crouch scaling and turned character transforms', () => {
  for (const heightScale of [1, 0.68]) {
    const root = new THREE.Group();
    root.position.set(3, 1, -8);
    root.rotation.y = Math.PI / 2;
    root.scale.set(0.01, 0.01 * heightScale, 0.01);
    const upper = new THREE.Bone();
    const lower = new THREE.Bone();
    const hand = new THREE.Bone();
    root.add(upper);
    upper.add(lower);
    lower.add(hand);
    lower.position.y = -30;
    hand.position.y = -28;
    root.updateMatrixWorld(true);
    const target = root.localToWorld(new THREE.Vector3(15, -30, -20));
    const pole = root.localToWorld(new THREE.Vector3(30, -20, 15));
    const solver = new TwoBoneArm({ upper, lower, hand });
    solver.solve(target, pole);
    assert(hand.getWorldPosition(new THREE.Vector3()).distanceTo(target) < 1e-6);
    assert.equal(lower.position.y, -30, 'Posing must not stretch the upper arm');
    assert.equal(hand.position.y, -28, 'Posing must not stretch the forearm');
  }
});

test('pulse visuals and flash originate at the active muzzle while hits remain on the crosshair', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.y = 1;
  scene.add(camera);
  const tool = new PulseTool(scene, camera, { mouse: {}, justPressed: () => false });
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.3, 0.9, -0.7);
  scene.add(muzzle);
  const target = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial());
  target.position.set(0, 1, -5);
  scene.add(target);
  scene.updateMatrixWorld(true);
  let hit;
  tool.on('hit', object => { hit = object; });
  tool.setMuzzle(muzzle);
  tool._fire([target]);
  assert.equal(hit, target, 'An offset weapon must still hit the crosshair target');
  assert(tool._boltStart.distanceTo(muzzle.position) < 1e-6);
  assert(tool._bolt.position.distanceTo(muzzle.position) < 1e-6);
  assert(tool._muzzleLight.position.distanceTo(muzzle.position) < 1e-6);
  assert(tool._boltStart.distanceTo(camera.position) > 0.5);
  tool.setLevel(2);
  assert.equal(tool._bolt.visible, false, 'Level changes must clear a previous shot');
  assert.equal(tool._muzzleLight.intensity, 0);
  tool.dispose();
  target.geometry.dispose();
  target.material.dispose();
});
