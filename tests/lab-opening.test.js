import test from 'node:test';
import assert from 'node:assert/strict';
import LabOpening from '../src/core/LabOpening.js';
import Game from '../src/core/Game.js';
import * as THREE from 'three';

test('the live game waits for a relay hit after entering the scientist room', () => {
  const phases = [];
  const opening = new LabOpening(phase => phases.push(phase));
  const game = Object.create(Game.prototype);
  game.gameState = { currentLevel: 1 };
  game.levels = {
    scriptedReveal: { trigger: { x: 0, z: -56, radius: 2.8 } },
    navigationVersion: 0,
    setWalkerThreat() {},
  };
  game.monster = { isActive: false };
  game._l1NavVersion = 0;
  game._l1Reveal = opening;
  game.player = { position: { x: 0, z: -56 } };
  game._setObjective = () => {};
  game._updateL1Reveal(30);
  assert.equal(opening.entered, true);
  assert.equal(opening.phase, 'standby');
  assert.deepEqual(phases, []);

  const target = { material: new THREE.MeshStandardMaterial() };
  game._repairLabPower(target);
  assert.equal(opening.phase, 'powering');
  assert.equal(target.material.emissive.getHex(), 0x46dfaa);
  game._repairLabPower(target);
  assert.deepEqual(phases, ['powering'], 'Repeated pulse hits must not restart the opening');
  target.material.dispose();
});

test('entering the lab alone cannot trigger the breach; the repair is a single action', () => {
  const events = [];
  const opening = new LabOpening(phase => events.push(phase));
  assert.equal(opening.repair(), false);
  opening.enter();
  opening.update(30);
  assert.equal(opening.phase, 'standby');
  assert.equal(opening.repair(), true);
  assert.equal(opening.repair(), false);
  assert.deepEqual(events, ['powering']);
});

test('the repair has a visible success beat before overload, exposure and evacuation', () => {
  const events = [];
  const opening = new LabOpening(phase => events.push(phase));
  opening.enter();
  opening.repair();
  opening.update(2.5);
  assert.equal(opening.phase, 'powering');
  opening.update(0.2);
  assert.equal(opening.phase, 'alarm');
  opening.update(4.7);
  assert.equal(opening.phase, 'flee');
  assert.deepEqual(events, ['powering', 'alarm', 'mutate', 'burst', 'flee']);
  opening.finishEscape();
  assert.equal(opening.phase, 'done');
  opening.update(100);
  assert.equal(events.filter(phase => phase === 'done').length, 1);
});

test('evacuation has a time limit so a stuck cameo cannot block progress', () => {
  const opening = new LabOpening();
  opening.enter();
  opening.repair();
  opening.update(20);
  assert.equal(opening.phase, 'done');
  assert.equal(opening.repaired, true);
});
