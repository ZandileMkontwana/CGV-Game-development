import test from 'node:test';
import assert from 'node:assert/strict';
import BossEncounter from '../src/core/BossEncounter.js';

test('the boss waits for arena entry and gives a warning before charging', () => {
  const events = [];
  const boss = new BossEncounter(stage => events.push(stage));
  boss.update(30, { x: 0, z: -3 });
  assert.equal(boss.stage, 'waiting');
  boss.update(0.1, { x: 0, z: -13 });
  boss.update(3.3, { x: 2, z: -18 });
  assert.equal(boss.stage, 'windup');
  assert.deepEqual(events, ['pursuit', 'windup']);
  boss.update(0.8, { x: -6, z: -18 });
  assert.equal(boss.stage, 'charge');
  assert.deepEqual([boss.x, boss.z], [2, -18], 'Sidestepping must not redirect a locked charge');
});

test('charges and weak-point hits create recovery rather than uninterrupted attacks', () => {
  const boss = new BossEncounter();
  boss.wake();
  boss.update(4.1, { x: 0, z: -20 });
  assert.equal(boss.stage, 'charge');
  boss.stopCharge();
  assert.equal(boss.stage, 'recover');
  boss.update(1.3, { x: 0, z: -20 });
  assert.equal(boss.stage, 'recover');
  boss.update(0.6, { x: 0, z: -20 });
  assert.equal(boss.stage, 'pursuit');
  boss.stagger();
  assert.equal(boss.stage, 'recover');
  boss.reset();
  assert.equal(boss.stage, 'waiting');
});
