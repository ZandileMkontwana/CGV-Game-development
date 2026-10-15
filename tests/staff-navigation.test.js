import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import PhysicsWorld from '../src/core/PhysicsWorld.js';
import NavigationGrid from '../src/core/NavigationGrid.js';
import StaffWalker from '../src/core/StaffWalker.js';

const bounds = { minX: -6, maxX: 6, minZ: -6, maxZ: 6 };
function staff(x, z, path) {
  const npc = { group: new THREE.Group(), update() {} };
  npc.group.position.set(x, 0, z);
  return new StaffWalker(npc, path, { speed: 1 });
}

test('staff route around walls during patrol and evacuation, including long frames', () => {
  const physics = new PhysicsWorld();
  const wall = physics.createBox(0, 0.15, 1.5, 3, new CANNON.Vec3(0, 1.5, 0));
  const grid = new NavigationGrid([wall], bounds, 0.4, 0.5, 1.8);
  for (const fleeing of [false, true]) {
    const walker = staff(4, 0, [{ x: 4, z: 0 }, { x: -4, z: 0 }]);
    walker.setNavigation(grid);
    if (fleeing) walker.evacuate({ x: -4, z: 0 });
    let reached = false;
    let wentAround = false;
    for (let frame = 0; frame < 1500; frame++) {
      const p = walker.npc.group.position;
      const x = p.x, z = p.z;
      walker.update(frame % 7 === 0 ? 0.2 : 1 / 60);
      assert(grid.isSegmentClear(x, z, p.x, p.z), 'Every step must clear the whole body');
      if (Math.abs(p.z) > 3.4) wentAround = true;
      if (Math.hypot(p.x + 4, p.z) < 0.08) { reached = true; break; }
    }
    assert(reached, 'Staff must reach their destination rather than stop at a wall');
    assert(wentAround);
    if (fleeing) {
      walker.update(0.1);
      assert.equal(walker.state, 'safe');
      assert.equal(walker.npc.group.visible, true, 'Evacuated staff shelter without disappearing');
    }
  }
});

test('staff wait for a sealed door and resume once its collider is removed', () => {
  const physics = new PhysicsWorld();
  const door = physics.createBox(0, 0.15, 1.5, 8, new CANNON.Vec3(0, 1.5, 0));
  const walker = staff(4, 0, [{ x: 4, z: 0 }, { x: -4, z: 0 }]);
  walker.setNavigation(new NavigationGrid([door], bounds, 0.4));
  walker.evacuate({ x: -4, z: 0 });
  for (let i = 0; i < 120; i++) walker.update(0.2);
  assert(walker.npc.group.position.x > 0.55);
  assert.equal(walker.animState.moving, false);
  walker.setNavigation(new NavigationGrid([], bounds, 0.4));
  for (let i = 0; i < 30; i++) walker.update(0.2);
  assert.equal(walker.state, 'safe');
});

test('staff clearance includes obstacles at head height and thin walls between grid nodes', () => {
  const physics = new PhysicsWorld();
  const beam = physics.createBox(0, 0.02, 0.1, 8, new CANNON.Vec3(0.25, 1.6, 0));
  const grid = new NavigationGrid([beam], bounds, 0.01, 0.5, 1.8);
  assert.equal(grid.findPath(-4, 0, 4, 0, []), false);
});

test('staff react to the alarm, sprint on release and leave a refuge when threatened', () => {
  const walker = staff(0, 0, [{ x: 0, z: 0 }, { x: 2, z: 0 }]);
  walker.setNavigation(new NavigationGrid([], bounds, 0.4));
  walker.alert();
  walker.update(0.1);
  assert.equal(walker.state, 'patrol', 'The warning precedes evacuation');
  assert.equal(walker.animState.alerted, true);
  assert.equal(walker.animState.moving, false);
  walker.evacuate({ x: 3, z: 0 });
  walker.update(0.1);
  assert.equal(walker.state, 'flee');
  assert.equal(walker.animState.speed, walker.fleeSpeed);
  for (let i = 0; i < 30; i++) walker.update(0.1);
  assert.equal(walker.state, 'safe');
  walker.reactToThreat({ x: 2, z: 0 }, { x: 5, z: 0 });
  assert.equal(walker.state, 'flee', 'Staff must not ignore a monster approaching their refuge');
  for (let i = 0; i < 20; i++) walker.update(0.1);
  assert.equal(walker.state, 'safe');
  assert(walker.npc.group.position.x > 4.9);
});

test('staff do not detect a creature through a solid wall', () => {
  const physics = new PhysicsWorld();
  const wall = physics.createBox(0, 0.15, 1.5, 6, new CANNON.Vec3(0, 1.5, 0));
  const walker = staff(2, 0, [{ x: 2, z: 0 }, { x: 4, z: 0 }]);
  walker.setNavigation(new NavigationGrid([wall], bounds, 0.4));
  walker.reactToThreat({ x: -2, z: 0 }, { x: 5, z: 0 });
  assert.equal(walker.state, 'patrol');
});
