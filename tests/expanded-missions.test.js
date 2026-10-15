import test from 'node:test';
import assert from 'node:assert/strict';
import { HuntProgress, CollapseProgress, ESCAPE_CHECKPOINTS } from '../src/core/MissionProgress.js';
import BossEncounter from '../src/core/BossEncounter.js';

test('rescue and records are both required, duplicate rescues cannot replace the second survivor', () => {
  const mission = new HuntProgress();
  mission.rescue(0);
  assert.equal(mission.rescued.size, 0);
  assert.equal(mission.activate('archive-download'), false);
  mission.activate('rescue'); mission.rescue(0); mission.rescue(0);
  assert.equal(mission.rescueComplete, false);
  mission.rescue(1);
  assert.equal(mission.complete, false);
  mission.activate('archive-power'); mission.activate('archive-download');
  mission.update(5, true); mission.update(100, false);
  assert.equal(mission.download, 5, 'Leaving pauses transfer without losing partial progress');
  assert.equal(mission.records, false);
  assert.equal(mission.update(7, true), true);
  assert.equal(mission.complete, true);
  assert.equal(mission.update(1, true), false, 'Completion is a single event');
  assert.equal(new HuntProgress().complete, false, 'A retry starts a fresh mission');
});

test('generators work in either order and the escape requires a continuous sequence of route checkpoints', () => {
  for (const order of [['generator-west', 'generator-east'], ['generator-east', 'generator-west']]) {
    const mission = new CollapseProgress();
    mission.startEscape(); assert.equal(mission.escapeStarted, false);
    mission.activate(order[0]); mission.activate(order[0]);
    assert.equal(mission.powered, false);
    mission.activate(order[1]); assert.equal(mission.powered, true);
    mission.startEscape();
    mission.update(ESCAPE_CHECKPOINTS.at(-1)); assert.equal(mission.complete, false);
    for (const point of ESCAPE_CHECKPOINTS) mission.update(point);
    assert.equal(mission.complete, true);
    assert.equal(new CollapseProgress().generators.size, 0);
  }
});

test('the unpowered boss hunts and attacks, but generators are required for node damage', () => {
  const boss = new BossEncounter(); boss.armed = false;
  boss.update(60, { x: 0, z: -3 });
  assert.equal(boss.stage, 'waiting'); assert.equal(boss.vulnerable, false);
  boss.update(0.1, { x: 0, z: -25 });
  assert.equal(boss.stage, 'pursuit');
  boss.update(1, { x: 0, z: -25 }, false);
  assert.equal(boss.timer, 0, 'Use normal detection before starting an attack');
  boss.update(3.3, { x: 2, z: -25 });
  assert.equal(boss.stage, 'windup');
  boss.update(0.8, { x: -4, z: -25 });
  assert.equal(boss.stage, 'charge');
  assert.equal(boss.x, 2, 'The unpowered charge also locks its destination');
  boss.stopCharge();
  assert.equal(boss.vulnerable, false, 'Recovery cannot expose unpowered nodes');
  boss.armed = true;
  assert.equal(boss.vulnerable, true);
  boss.stagger(); assert.equal(boss.vulnerable, false);
  boss.phase = 2; boss.attacks = 2;
  boss.update(1.9, { x: 0, z: -25 }); boss.update(2.2, { x: 0, z: -25 });
  assert.equal(boss.stage, 'sweepWindup');
  assert.equal(boss.vulnerable, false);
  boss.update(1.2, { x: 0, z: -25 }); assert.equal(boss.stage, 'sweep');
  boss.update(0.3, { x: 0, z: -25 }); assert.equal(boss.vulnerable, true);
});
