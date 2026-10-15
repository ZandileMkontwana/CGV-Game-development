import test from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import PhysicsWorld from '../src/core/PhysicsWorld.js';
import NavigationGrid from '../src/core/NavigationGrid.js';

test('navigation finds a route around cover with room for the whole monster', () => {
  const physics = new PhysicsWorld();
  const wall = physics.createBox(0, 0.5, 1.5, 3, new CANNON.Vec3(0, 1.5, 0));
  const grid = new NavigationGrid([wall], { minX: -6, maxX: 6, minZ: -6, maxZ: 6 });
  const path = [];
  assert.equal(grid.isSegmentClear(4, 0, -4, 0), false);
  assert.equal(grid.findPath(4, 0, -4, 0, path), true);
  assert(path.some(node => Math.abs(grid.nodeZ(node)) > 3.75), 'Route must go around the end of the expanded collider');
  for (let i = 1; i < path.length; i++) {
    assert(grid.isSegmentClear(grid.nodeX(path[i - 1]), grid.nodeZ(path[i - 1]), grid.nodeX(path[i]), grid.nodeZ(path[i])));
  }
});

test('navigation does not create a route through a sealed passage', () => {
  const physics = new PhysicsWorld();
  const wall = physics.createBox(0, 0.5, 1.5, 8, new CANNON.Vec3(0, 1.5, 0));
  const grid = new NavigationGrid([wall], { minX: -6, maxX: 6, minZ: -6, maxZ: 6 });
  assert.equal(grid.findPath(4, 0, -4, 0, []), false);
});

test('planned routes remain physically passable at normal and enraged boss speeds', () => {
  for (const speed of [5, 8]) {
    const physics = new PhysicsWorld();
    const wall = physics.createBox(0, 0.5, 1.5, 3, new CANNON.Vec3(0, 1.5, 0));
    const actor = new CANNON.Body({
      mass: 120, shape: new CANNON.Sphere(0.6), material: physics.actorMaterial,
      position: new CANNON.Vec3(4, 0.65, 0), fixedRotation: true,
    });
    physics.world.addBody(actor);
    const grid = new NavigationGrid([wall], { minX: -6, maxX: 6, minZ: -6, maxZ: 6 });
    const path = [];
    assert.equal(grid.findPath(4, 0, -4, 0, path), true);
    for (const node of path) {
      let reached = false;
      for (let step = 0; step < 120; step++) {
        const dx = grid.nodeX(node) - actor.position.x;
        const dz = grid.nodeZ(node) - actor.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.1) { reached = true; break; }
        actor.velocity.x = dx / distance * speed;
        actor.velocity.z = dz / distance * speed;
        physics.step(1 / 60);
      }
      assert(reached, `Actor at speed ${speed} was blocked on its planned route`);
    }
    assert(Math.hypot(actor.position.x + 4, actor.position.z) < 0.1);
  }
});
