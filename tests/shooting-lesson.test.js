import test from 'node:test';
import assert from 'node:assert/strict';
import ShootingLesson from '../src/core/ShootingLesson.js';
import Game from '../src/core/Game.js';
import LevelManager from '../src/levels/LevelManager.js';
import PhysicsWorld from '../src/core/PhysicsWorld.js';
import * as THREE from 'three';

const room = { x: 11, z: -19 };
const hub = { x: 5, z: -19 };

test('shooting instructions follow room entry and partial progress survives leaving', () => {
  const lesson = new ShootingLesson();
  lesson.update(0.1, hub);
  assert.equal(lesson.message, null);
  lesson.update(0.1, room);
  assert.match(lesson.message.text, /AIM.*FIRE/);
  assert.match(lesson.message.sub, /0\/3/);
  assert.equal(lesson.hit('tr-relay-1'), true);
  assert.equal(lesson.hit('tr-relay-1'), false);
  assert.equal(lesson.hit('tr-relay-jump'), false);
  assert.match(lesson.message.sub, /1\/3/);
  lesson.update(0.1, hub);
  lesson.update(0.1, room);
  assert.match(lesson.message.sub, /1\/3/);
});

test('completion is shown once and re-entering cannot restart the lesson', () => {
  const lesson = new ShootingLesson();
  lesson.update(0, room);
  for (let i = 1; i <= 3; i++) lesson.hit(`tr-relay-${i}`);
  assert.equal(lesson.completed, true);
  assert.match(lesson.message.text, /COMPLETE/);
  lesson.update(4.1, room);
  assert.equal(lesson.message, null);
  for (let visit = 0; visit < 5; visit++) {
    lesson.update(0.1, hub);
    lesson.update(0.1, room);
    lesson.hit('tr-relay-2');
    assert.equal(lesson.message, null);
    assert.equal(lesson.hits.size, 3);
  }
  assert.equal(new ShootingLesson().completed, false, 'A fresh level starts fresh targets');
});

test('the room lesson takes priority over unfinished jump hints and stays hidden after completion', () => {
  const game = Object.create(Game.prototype);
  const lesson = new ShootingLesson();
  game.levels = { shootingLesson: lesson };
  game.player = { position: room };
  const classes = new Set();
  game._tutorialEl = { classList: {
    contains: value => classes.has(value),
    add: value => classes.add(value),
    remove: value => classes.delete(value),
  } };
  game._tutorialTextEl = { textContent: '' };
  game._tutorialSubEl = { textContent: '' };
  let writes = 0;
  game.ui = { showTutorial(message) {
    writes++;
    game._tutorialTextEl.textContent = message?.text ?? '';
    game._tutorialSubEl.textContent = message?.sub ?? '';
    if (message) classes.add('visible'); else classes.delete('visible');
  } };
  game._tut = { timer: 0, step: 0, shown: new Set() };
  game._l1Tutorial = [{ text: 'JUMP', trigger: 'zone', triggerXLess: -9, triggerZRange: [-16, -22] }];
  game._updateTutorial(0.1);
  assert.match(game._tutorialTextEl.textContent, /FIRE/);
  game._updateTutorial(0.1);
  assert.equal(writes, 1, 'An unchanged hint must not be republished each frame');
  for (let i = 1; i <= 3; i++) lesson.hit(`tr-relay-${i}`);
  game._updateTutorial(0.1);
  assert.match(game._tutorialTextEl.textContent, /COMPLETE/);
  game._updateTutorial(4.1);
  game.player.position = hub;
  game._updateTutorial(0.1);
  game.player.position = room;
  game._updateTutorial(0.1);
  assert.equal(classes.has('visible'), false);
});

test('dummy hits count once and the training gate still requires both rooms', () => {
  const levels = new LevelManager(new THREE.Scene(), new PhysicsWorld());
  levels.shootingLesson = new ShootingLesson();
  levels._sparkBurst = () => {};
  let confirmations = 0;
  const node = (id, dummy = false) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const led = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    return { id, mesh, led, lit: false, lights: [], group: 'train',
      dummy: dummy ? { confirmHit() { confirmations++; } } : null };
  };
  levels._powerNodes = [node('tr-relay-jump'), ...[1, 2, 3].map(i => node(`tr-relay-${i}`, true))];
  levels._doors = [{ id: 'tr-gate', needPower: levels._powerNodes.map(n => n.id), opening: false }];
  for (let i = 1; i <= 3; i++) levels._activatePowerNode(`tr-relay-${i}`);
  assert.equal(levels.shootingLesson.completed, true);
  assert.equal(levels._doors[0].opening, false);
  assert.equal(levels._activatePowerNode('tr-relay-1'), null);
  assert.equal(confirmations, 3);
  levels._activatePowerNode('tr-relay-jump');
  assert.equal(levels._doors[0].opening, true);
  assert.match(levels.shootingLesson.success.sub, /OPEN GATE/);
  for (const entry of levels._powerNodes) {
    for (const mesh of [entry.mesh, entry.led]) { mesh.geometry.dispose(); mesh.material.dispose(); }
  }
});
