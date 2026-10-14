import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import PhysicsWorld from '../src/core/PhysicsWorld.js';
import LevelManager from '../src/levels/LevelManager.js';
import LevelKit from '../src/levels/LevelKit.js';

test('tearing down a room removes its collision obstacles on the next visit', () => {
  const physics = new PhysicsWorld();
  const scene = new THREE.Scene();
  const levels = new LevelManager(scene, physics);
  const kit = new LevelKit(levels, {});
  const material = new THREE.MeshBasicMaterial();
  const player = new CANNON.Body({
    mass: 1, shape: new CANNON.Sphere(0.4), material: physics.actorMaterial,
    fixedRotation: true,
  });
  physics.world.addBody(player);
  const permanentBodies = physics.world.bodies.length;
  const walkForward = () => {
    player.position.set(0, 0.5, -2);
    player.velocity.setZero();
    player.aabbNeedsUpdate = true;
    physics.world.broadphase.dirty = true;
    for (let i = 0; i < 120; i++) {
      player.velocity.z = 3;
      physics.step(1 / 60);
    }
    return player.position.z;
  };

  kit.box(material, 1, 3, 1, 0, 1.5, 0, { physics: true });
  assert(walkForward() < 0, 'The current room obstacle should block the player');
  levels._teardown();
  assert(walkForward() > 2, 'The removed room must leave a passable route');

  for (let visit = 0; visit < 5; visit++) {
    kit.box(material, 1, 3, 1, 0, 1.5, 0, { physics: true });
    levels._teardown();
    assert.equal(physics.world.bodies.length, permanentBodies, 'Room visits must not accumulate collision bodies');
  }
  assert.equal(scene.children.length, 0);
  material.dispose();
});

test('static props keep their visual rotation as physics advances', () => {
  const physics = new PhysicsWorld();
  const levels = new LevelManager(new THREE.Scene(), physics);
  const kit = new LevelKit(levels, {});
  const material = new THREE.MeshBasicMaterial();
  const prop = kit.box(material, 3, 2, 1, 4, 1, 0, { physics: true, rotY: Math.PI / 2 });
  const intendedRotation = prop.quaternion.clone();
  for (let i = 0; i < 10; i++) physics.step(1 / 60);
  assert(prop.quaternion.equals(intendedRotation), 'Body synchronization must not erase a static prop rotation');
  levels._teardown();
  assert.equal(physics.world.bodies.length, 1, 'Only the permanent ground should remain');
  assert.equal(physics.syncPairs.length, 0);
  material.dispose();
});
