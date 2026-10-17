import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import PhysicsWorld from '../src/core/PhysicsWorld.js';
import LevelManager from '../src/levels/LevelManager.js';
import { smokeTexture, dustTexture } from '../src/shaders/AtmosphereTextures.js';

test('smoke and dust fade to transparent on every billboard edge', () => {
  for (const map of [smokeTexture(), dustTexture()]) {
    const { data, width, height } = map.image;
    const alpha = (x, y) => data[(y * width + x) * 4 + 3];
    for (let i = 0; i < width; i++) {
      assert.equal(alpha(i, 0), 0); assert.equal(alpha(i, height - 1), 0);
      assert.equal(alpha(0, i), 0); assert.equal(alpha(width - 1, i), 0);
    }
    assert(alpha(width / 2, height / 2) > 100, 'The middle must still be visible');
    assert.equal(map.magFilter, THREE.LinearFilter, 'Close particles must retain soft edges');
  }
  const { data, width } = smokeTexture().image;
  const alpha = (x, y) => data[(y * width + x) * 4 + 3];
  const differences = Array.from({ length: 20 }, (_, i) =>
    Math.abs(alpha(36 + i, 64) - alpha(91 - i, 64)));
  assert(differences.some(d => d > 10), 'Cloud density varies independently of distance from the centre');
});

test('vent smoke rises, expands and dissipates after shutdown without replacing its pool', () => {
  const levels = new LevelManager(new THREE.Scene(), new PhysicsWorld());
  levels._flickerLights = [];
  levels._createSteamVent('test', 0, 0.3, 0, { count: 12, rate: 0.1, lifeSpan: 1 });
  const vent = levels._steamVents[0], pool = vent.pool;
  levels.update(0.1);
  const sprite = pool[vent.idx], start = sprite.position.clone(), size = sprite.scale.x;
  const opacity = sprite.material.opacity;
  assert.equal(sprite.material.map, smokeTexture());
  assert.equal(sprite.material.blending, THREE.NormalBlending, 'Smoke must not glow white');
  levels.disableVent('test');
  for (let i = 0; i < 5; i++) levels.update(0.1);
  assert(sprite.position.y > start.y, 'Smoke must travel away from its vent');
  assert(sprite.scale.x > size, 'Puffs billow as they rise');
  assert(sprite.material.opacity < opacity, 'Puffs dissipate');
  for (let i = 0; i < 6; i++) levels.update(0.1);
  assert.equal(sprite.visible, false);
  assert.equal(vent.pool, pool, 'Animation reuses the existing particle pool');
  levels._teardown();
});

test('dust uses a shared soft particle map that survives level teardown', () => {
  const levels = new LevelManager(new THREE.Scene(), new PhysicsWorld());
  const motes = levels._dustMotes(8, 0, 0, 3, 0.4, 3);
  assert.equal(motes.material.map, dustTexture());
  let disposed = false;
  dustTexture().addEventListener('dispose', () => { disposed = true; });
  levels._teardown();
  assert.equal(disposed, false, 'Reloading a level must not dispose shared particle maps');
});
