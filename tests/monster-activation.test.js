import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import PhysicsWorld from '../src/core/PhysicsWorld.js';
import MonsterAI from '../src/core/MonsterAI.js';

test('inactive creatures cannot become invisible obstacles; activation restores physics without adding lights', () => {
  const physics = new PhysicsWorld();
  const scene = new THREE.Scene();
  const monster = Object.create(MonsterAI.prototype);
  monster.physicsWorld = physics;
  monster.body = new CANNON.Body({
    mass: 120, shape: new CANNON.Sphere(0.6), position: new CANNON.Vec3(0, -50, 0),
  });
  physics.world.addBody(monster.body);
  monster.model = new THREE.Group();
  monster._aura = new THREE.PointLight(0xff2a14, 7);
  monster._chargeGuide = new THREE.Group();
  monster._sweepGuide = new THREE.Group();
  scene.add(monster.model, monster._aura);
  const lights = () => {
    let count = 0;
    scene.traverseVisible(object => { if (object.isLight) count++; });
    return count;
  };
  monster.setActive(false);
  for (let i = 0; i < 60; i++) physics.step(1 / 60);
  assert.equal(monster.body.position.y, -50, 'The floor must not push a parked creature back into play');
  assert.equal(monster.body.collisionFilterMask, 0);
  assert.equal(monster.model.visible, false);
  assert.equal(monster._aura.intensity, 0);
  assert.equal(lights(), 1);

  monster.body.position.set(0, 2, 0);
  monster._aura.intensity = 4;
  monster.setActive(true);
  physics.step(1 / 60);
  assert.equal(monster.body.collisionFilterMask, -1);
  assert(monster.body.position.y < 2, 'The activated creature resumes simulation');
  assert.equal(monster.model.visible, true);
  assert.equal(monster._aura.intensity, 4, 'Activation preserves encounter-specific lighting');
  assert.equal(lights(), 1, 'Visibility must not change the renderer light inventory');
});
