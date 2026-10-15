import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import FacilityMap, { floorBounds, mapView, projectMapPoint } from '../src/ui/FacilityMap.js';
import LevelManager from '../src/levels/LevelManager.js';
import LevelKit from '../src/levels/LevelKit.js';
import PhysicsWorld from '../src/core/PhysicsWorld.js';

test('the full map fits every room without distorting distance or reversing direction', () => {
  const bounds = floorBounds([{ x: 0, z: -5, w: 8, d: 10 }, { x: 12, z: -90, w: 14, d: 20 }]);
  for (const [width, height] of [[600, 650], [280, 400]]) {
    const view = mapView(bounds, { x: 0, z: -2 }, width, height, true);
    const a = projectMapPoint(bounds.minX, bounds.minZ, view);
    const b = projectMapPoint(bounds.maxX, bounds.maxZ, view);
    assert(a.x >= 21 && a.y >= 21);
    assert(b.x <= width - 21 && b.y <= height - 21);
    assert(projectMapPoint(0, -10, view).y < projectMapPoint(0, 0, view).y);
    const origin = projectMapPoint(0, 0, view);
    const east = projectMapPoint(5, 0, view);
    const south = projectMapPoint(0, 5, view);
    assert(Math.abs((east.x - origin.x) - (south.y - origin.y)) < 1e-9);
  }
});

test('the minimap follows the player while the whole-level map stays fixed', () => {
  const bounds = { minX: -20, maxX: 20, minZ: -100, maxZ: 0 };
  for (const position of [{ x: 0, z: -2 }, { x: 17, z: -23 }, { x: -8, z: -91 }]) {
    const local = mapView(bounds, position, 210, 180, false);
    assert.deepEqual(projectMapPoint(position.x, position.z, local), { x: 105, y: 90 });
    const full = mapView(bounds, position, 600, 650, true);
    assert.equal(full.x, 0);
    assert.equal(full.z, -50);
  }
});

test('map floors come from the level builders and are cleared on teardown', () => {
  const levels = new LevelManager(new THREE.Scene(), new PhysicsWorld());
  const material = new THREE.MeshBasicMaterial();
  const kit = new LevelKit(levels, { floor: material });
  kit.floorSlab(10, 8, 4, -12, { trim: false });
  assert.deepEqual(levels.mapFloors, [{ w: 10, d: 8, x: 4, z: -12 }]);
  assert.deepEqual(floorBounds(levels.mapFloors), { minX: -1, maxX: 9, minZ: -16, maxZ: -8 });
  levels._teardown();
  assert.deepEqual(levels.mapFloors, []);
  material.dispose();
});

test('the map follows door state, removed obstacles and camera heading without adding physics bodies', () => {
  const physics = new PhysicsWorld();
  const wall = physics.createBox(0, 0.15, 1.5, 3, new CANNON.Vec3(3, 1.5, -5));
  const doorBody = physics.createBox(0, 1.3, 1.3, 0.1, new CANNON.Vec3(0, 1.3, -8));
  const strokes = [], rotations = [];
  const context = new Proxy({ strokeRect() { strokes.push(this.strokeStyle); }, rotate(angle) { rotations.push(angle); } }, {
    get(target, key) { return key in target ? target[key] : () => {}; },
  });
  const canvas = { getContext: () => context, clientWidth: 210, clientHeight: 180, width: 210, height: 180 };
  const map = new FacilityMap(null, canvas);
  const door = { body: doorBody, progress: 0 };
  const levels = { currentLevel: 1, navigationVersion: 0, mapFloors: [{ x: 0, z: -5, w: 12, d: 20 }],
    _powerNodes: [], shootables: [], _doors: [door], _steamVents: [],
    _disposables: [{ body: wall }, { body: doorBody }], winTriggers: [],
  };
  const before = physics.world.bodies.length;
  map.setLevel(levels);
  map.update(0.1, { x: 0, z: -2 }, -Math.PI / 2);
  assert(strokes.includes('#e6a959'), 'A closed door is shown as amber');
  assert.equal(rotations.at(-1), Math.PI / 2, 'Facing east turns the player arrow right');
  assert.equal(map._obstacles.length, 1, 'Door state is drawn separately from static walls');
  strokes.length = 0;
  door.progress = 1;
  physics.removeBody(wall);
  map.update(0.1, { x: 0, z: -2 }, 0);
  assert(strokes.includes('#69dca4'));
  assert(!strokes.includes('#7897a1'), 'Removed walls cannot remain on the map');
  assert.equal(physics.world.bodies.length, before - 1);
  map.toggle();
  assert.equal(map.expanded, true);
  map.clear();
  assert.equal(map.expanded, false);
  assert.equal(map.levels, null);
});
