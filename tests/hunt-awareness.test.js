import test from 'node:test';
import assert from 'node:assert/strict';
import HuntAwareness from '../src/core/HuntAwareness.js';

test('a brief glimpse warns the player without starting an instant chase', () => {
  const awareness = new HuntAwareness();
  assert.equal(awareness.observe(0.2, true, 2, -20), false);
  assert(awareness.exposure > 0);
  awareness.observe(0.3, false, 8, -40);
  assert.equal(awareness.exposure, 0);
  assert.equal(awareness.observe(0.7, true, 2, -21), true);
});

test('moving behind cover never reveals a new position and eventually ends pursuit', () => {
  const awareness = new HuntAwareness();
  awareness.observe(1, true, 2, -21);
  assert.equal(awareness.observe(2, false, -6, -28), true);
  assert.equal(awareness.searching, true);
  assert.deepEqual([awareness.x, awareness.z], [2, -21]);
  assert.equal(awareness.observe(2.1, false, -6, -28), false);
});

test('a shot gives away its origin, while reacquiring sight refreshes the pursuit target', () => {
  const awareness = new HuntAwareness();
  awareness.hear(1, -33);
  awareness.observe(1, false, -2, -37);
  assert.deepEqual([awareness.x, awareness.z], [1, -33]);
  awareness.observe(0.8, true, -2, -38);
  assert.deepEqual([awareness.x, awareness.z], [-2, -38]);
  assert.equal(awareness.searching, false);
  awareness.reset();
  assert.equal(awareness.pursuing, false);
  assert.equal(awareness.exposure, 0);
});
