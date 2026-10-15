import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import PhysicsWorld from '../src/core/PhysicsWorld.js';
import Game from '../src/core/Game.js';
import LabPower from '../src/core/LabPower.js';
import LevelManager from '../src/levels/LevelManager.js';
import LevelKit from '../src/levels/LevelKit.js';
import { HuntExpansion } from '../src/levels/LevelExpansion.js';

function archiveFixture() {
  const host = new LevelManager(new THREE.Scene(), new PhysicsWorld());
  const material = new THREE.MeshStandardMaterial();
  host._mats = new Proxy({}, { get: (_, key) => key === 'colors'
    ? { warn: 0xffaa44, emer: 0xff4433, lampLight: 0xffffff } : material });
  host._kit = new LevelKit(host, host._mats);
  host._kit.sign = () => null;
  host._kit.floorSlab(8.3, 10.3, 12.15, -45.15);
  host.archiveCircuit = new LabPower();
  const expansion = new HuntExpansion(host); host.expansion = expansion;
  expansion.progress.activate('archive-power');
  expansion.progress.activate('archive-download');
  return { host, expansion, material };
}

test('download finishes from the accessible approaches to both archive tables', () => {
  for (const player of [{ x:12.4, z:-41.7 }, { x:12.1, z:-44 }, { x:12.4, z:-46.2 }]) {
    const { host, expansion, material } = archiveFixture();
    expansion.update(10.8, player);
    assert.equal(expansion.nearTerminal, true, 'The desk approach must count as the archive work area');
    assert(expansion.progress.download >= 10.8);
    expansion.update(1.2, player);
    assert.equal(expansion.progress.records, true, 'Returning to a table must finish the final ten percent');
    assert.equal(expansion.terminal.userData.completed, true);
    assert.equal(expansion.downloadZone.visible, false);
    host._teardown(); material.dispose();
  }
});

test('leaving the archive pauses at 90%, and returning resumes through completion once', () => {
  const { host, expansion, material } = archiveFixture();
  const player = { x:12.4, z:-41.7 };
  expansion.update(10.8, player);
  for (const outside of [{x:7.7,z:-44.1},{x:16.5,z:-44.1},{x:12,z:-39.8},{x:12,z:-50.6}]) {
    expansion.update(20, outside);
    assert.equal(expansion.nearTerminal, false, 'Adjacent rooms must not count through a wall');
    assert.equal(expansion.progress.download, 10.8);
  }
  for (let i=0;i<72;i++) expansion.update(1/60, player);
  assert.equal(expansion.progress.records, true, 'Ordinary frame-sized steps must complete at twelve seconds');
  expansion.update(1,player);
  assert.equal(expansion.notices.filter(n=>n.startsWith('Experiment records secured')).length, 1);
  host._teardown(); material.dispose();
});

test('the HUD refreshes from 90 to 95 to 99 and explicitly confirms 100%', () => {
  const { host, expansion, material } = archiveFixture();
  expansion.progress.released = true;
  expansion.progress.rescue(0); expansion.progress.rescue(1);
  host._steamVents = [{id:'l2-vent-2',active:false},{id:'l2-vent-3',active:false}];
  host._doors.push({id:'l2-entry',opening:true},{id:'l2-pressure',opening:true});
  const game = Object.create(Game.prototype);
  game.levels = host; game.player = {position:{x:12.4,z:-41.7}};
  game._huntPressureWasReleased = true; game._huntBeat = '';
  let objective = '';
  game._setObjective = text => {objective=text;};
  game.ui = {showTutorial(){}};
  expansion.nearTerminal = true;
  for (const [seconds, percent] of [[10.8,90],[11.4,95],[11.9,99]]) {
    expansion.progress.download=seconds;
    game._updateHunt();
    assert(objective.includes(percent+'%'), objective);
  }
  expansion.update(0.2, game.player.position); game._updateHunt();
  assert(objective.includes('100%') && objective.includes('CORE ACCESS'), objective);
  host._doors.splice(-2); host._teardown(); material.dispose();
});
