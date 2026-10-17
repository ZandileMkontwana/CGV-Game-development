import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import PhysicsWorld from '../src/core/PhysicsWorld.js';
import NavigationGrid from '../src/core/NavigationGrid.js';
import Game from '../src/core/Game.js';
import LevelManager from '../src/levels/LevelManager.js';
import LevelKit from '../src/levels/LevelKit.js';
import { buildEscapeRoute, CollapseExpansion } from '../src/levels/LevelExpansion.js';
import { floorBounds } from '../src/ui/FacilityMap.js';

function escapeFixture() {
  const physics = new PhysicsWorld(), levels = new LevelManager(new THREE.Scene(), physics);
  const material = new THREE.MeshStandardMaterial();
  levels._mats = new Proxy({}, { get: (_, key) => key === 'colors'
    ? { warn: 0xffaa44, emer: 0xff4433, lampLight: 0xffffff } : material });
  levels._kit = new LevelKit(levels, levels._mats);
  levels._kit.sign = () => null; // The test exercises geometry, not canvas labels.
  levels._exitBeacon = () => null;
  buildEscapeRoute(levels);
  const expansion = new CollapseExpansion(levels); levels.expansion = expansion;
  return { levels, expansion, material };
}

test('all fallen ceiling slabs retain collision and leave a route through the service bypass', () => {
  const { levels, expansion, material } = escapeFixture();
  expansion.progress.activate('generator-west'); expansion.progress.activate('generator-east');
  expansion.startEscape();
  for (const slab of expansion.slabs) {
    const player = { x: slab.mesh.position.x, z: slab.mesh.position.z };
    expansion.update(0.01, player);
    assert.equal(slab.state, 'warning');
    assert.equal(slab.mesh.position.y, 3.7, 'The warning precedes any movement');
    expansion.update(1.8, player); expansion.update(1, player);
    assert.equal(slab.state, 'landed');
    assert.equal(slab.body.position.y, slab.mesh.position.y);
    assert.equal(slab.warning.visible, false);
    assert.equal(slab.mesh.userData.staticScenery, false, 'Moving slabs cannot be batched into the ceiling');
  }
  const grid = new NavigationGrid(levels._disposables.map(d => d.body).filter(b => b?.world),
    floorBounds(levels.mapFloors), 0.5, 0.25, 1.7);
  const path = []; grid.findPath(0, -43.5, -12, -105.15, path);
  assert(path.length > 200, 'The expanded exit must remain reachable');
  assert(Math.max(...path.map(n => grid.nodeX(n))) > 21, 'Rubble requires the eastern bypass');
  for (let i = 1; i < path.length; i++) assert(grid.isSegmentClear(grid.nodeX(path[i-1]), grid.nodeZ(path[i-1]), grid.nodeX(path[i]), grid.nodeZ(path[i])));
  levels._teardown();
  assert.equal(levels.scene.children.length, 0);
  assert.equal(levels.physics.world.bodies.length, 1, 'Only the permanent ground survives cleanup');
  material.dispose();
});

test('generator machinery matches its collider, electrical damage is timed, and activation is local', () => {
  const { levels, expansion, material } = escapeFixture();
  assert.equal(expansion.activate('generator-west', { x: 0, z: -25 }), false);
  expansion.update(0.2, { x: 0, z: 0 });
  assert(Math.abs(expansion.arm.quaternion.y - expansion.armBody.quaternion.y) < 1e-6);
  assert.equal(expansion.update(0.1, { x: 17.5, z: -23 }), 0, 'The initial amber warning is harmless');
  assert.equal(expansion.update(1.2, { x: 17.5, z: -23 }), 15);
  assert.equal(expansion.update(0.1, { x: 17.5, z: -23 }), 0, 'Damage cannot repeat every frame');
  expansion.activate('generator-east', { x: 19, z: -23.3 });
  assert.equal(expansion.update(2, { x: 17.5, z: -23 }), 0);
  expansion.activate('generator-west', { x: -19, z: -27.5 });
  const stopped = expansion.arm.rotation.y;
  expansion.update(2, { x: 0, z: 0 }); assert.equal(expansion.arm.rotation.y, stopped);
  levels._teardown(); material.dispose();
});

test('win triggers enforce mission completion and boss death', () => {
  const game = Object.create(Game.prototype);
  game.player = { position: { x: -12, z: -105.15 } };
  game.levels = { expansion: { canWin: false }, winTriggers: [{ x: -12, z: -105.15, radius: 1.5, needMonsterDead: true }] };
  game.monster = { state: 'patrol' };
  let wins = 0; game.completeLevel = () => wins++;
  game._checkWinTriggers(); assert.equal(wins, 0);
  game.levels.expansion.canWin = true;
  game._checkWinTriggers(); assert.equal(wins, 0);
  game.monster.state = 'dead'; game._checkWinTriggers(); assert.equal(wins, 1);
});

test('isolated pressure valves cannot bypass the survivor rescue gate', () => {
  const physics = new PhysicsWorld(), levels = new LevelManager(new THREE.Scene(), physics);
  const material = new THREE.MeshStandardMaterial();
  levels._kit = { box() {} };
  levels._createDoor('l2-pressure', 2.6, 2.6, 0, 1.3, -40.15, 0, material, { locked: true });
  levels.currentLevel = 2;
  levels._steamVents = [{ id:'l2-vent-2', active:true }, { id:'l2-vent-3', active:true }];
  levels.expansion = { canOpenPressure:false, dispose() {} };
  levels.disableVent('l2-vent-2'); levels.disableVent('l2-vent-3');
  assert.equal(levels.pressureReleased, true);
  assert.equal(levels._doors[0].opening, false);
  levels.expansion.canOpenPressure = true; levels.openDoor('l2-pressure');
  assert.equal(levels._doors[0].opening, true);
  levels._teardown(); material.dispose();
});
