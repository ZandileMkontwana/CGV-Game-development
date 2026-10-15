import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import PulseTool from '../src/core/PulseTool.js';
import Game from '../src/core/Game.js';
import LevelManager from '../src/levels/LevelManager.js';
import PhysicsWorld from '../src/core/PhysicsWorld.js';

for (const control of ['mouse', 'KeyF']) {
  test(`Level 2 equips the pulse tool and ${control} hits the entry relay without a pickup`, () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const input = { mouse: { clicked: control === 'mouse' }, justPressed: key => key === control };
    const tool = new PulseTool(scene, camera, input);
    const relay = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.1), new THREE.MeshBasicMaterial());
    relay.position.z = -5;
    relay.userData.doorId = 'l2-entry';
    scene.add(relay);
    scene.updateMatrixWorld(true);
    const game = Object.create(Game.prototype);
    game.pulseTool = tool;
    game.player = { weaponStowed: true };
    tool.enabled = false;
    tool.energy = 0;
    tool._cooldownTimer = 1;
    game._resetPulseTool(2);
    assert.equal(game._weaponReady, true);
    assert.equal(game.player.weaponStowed, false);
    let hit = null;
    tool.on('hit', target => { hit = target; });
    tool.update(0.016, [relay]);
    assert.equal(hit, relay);
    assert.equal(tool.energy, tool.maxEnergy - tool.shotCost);
    tool.dispose(); relay.geometry.dispose(); relay.material.dispose();
  });
}

test('firing still respects energy and cooldown, and a Level 2 retry restores it', () => {
  const tool = new PulseTool(new THREE.Scene(), new THREE.PerspectiveCamera(), { mouse: { clicked: true }, justPressed: () => false });
  const game = Object.create(Game.prototype);
  game.pulseTool = tool; game.player = {};
  let shots = 0;
  tool.on('fire', () => shots++);
  game._resetPulseTool(2);
  tool.update(0.01, []);
  tool.update(0.01, []);
  assert.equal(shots, 1);
  tool.energy = 0;
  tool.update(1, []);
  assert.equal(shots, 1);
  game._resetPulseTool(2);
  tool.update(0.01, []);
  assert.equal(shots, 2);
  tool.dispose();
});

test('the pressure interlock ignores E and opens automatically after both valves in either order', () => {
  for (const order of [['l2-vent-2', 'l2-vent-3'], ['l2-vent-3', 'l2-vent-2']]) {
    const physics = new PhysicsWorld();
    const levels = new LevelManager(new THREE.Scene(), physics);
    levels.currentLevel = 2;
    levels._flickerLights = [];
    levels._kit = { box() { assert.fail('Pulse-operated doors must not get an E button'); } };
    const material = new THREE.MeshStandardMaterial();
    levels._createDoor('l2-pressure', 2.6, 2.6, 0, 1.3, -40.15, 0, material,
      { locked: true, lockedHint: 'PULSE BOTH AMBER VALVES TO OPEN' });
    levels._steamVents = order.map(id => ({ id, active: true, pool: [], age: 0, timer: 0, rate: 1 }));
    const door = levels._doors[0];
    const game = Object.create(Game.prototype);
    game.levels = levels;
    game.player = { position: { x: 0, z: -39 } };
    game.input = { justPressed: key => key === 'KeyE' };
    game._interactPromptEl = { classList: { toggle() {} }, textContent: '' };
    game.audio = { play() { assert.fail('Pressing E must not open this door'); } };
    game._updateDoorInteraction();
    assert.equal(door.opening, false);
    assert.equal(game._interactPromptEl.textContent, 'PULSE BOTH AMBER VALVES TO OPEN');
    levels.disableVent(order[0]);
    assert.equal(levels.pressureReleased, false);
    assert.equal(door.opening, false);
    game._updateDoorInteraction();
    assert.equal(door.opening, false, 'E cannot bypass the remaining valve');
    levels.disableVent(order[1]);
    assert.equal(levels.pressureReleased, true);
    assert.equal(door.opening, true, 'The second valve releases the door without E');
    levels.update(2);
    assert.equal(door.progress, 1);
    assert.equal(door.body.world, null, 'The opened door must clear its collider');
    levels._teardown();
    material.dispose();
  }
});
