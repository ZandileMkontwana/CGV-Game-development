import test from 'node:test';
import assert from 'node:assert/strict';
import ServerAmbush from '../src/core/ServerAmbush.js';

test('the second monster cannot rush a player before the pressure door opens', () => {
  const ambush = new ServerAmbush();
  ambush.update(20, 0.9, -41);
  assert.equal(ambush.stage, 'waiting');
  ambush.update(20, 1, -35);
  assert.equal(ambush.stage, 'waiting');
  ambush.update(0.1, 1, -40);
  assert.equal(ambush.stage, 'warning');
});

test('the reveal allows a reaction window and cannot restart when the player retreats', () => {
  const ambush = new ServerAmbush();
  ambush.update(0.1, 1, -40);
  ambush.update(0.8, 1, -40);
  assert.equal(ambush.stage, 'warning');
  ambush.update(0.3, 1, -38);
  assert.equal(ambush.stage, 'chasing');
  ambush.update(10, 1, -40);
  assert.equal(ambush.stage, 'chasing');
  assert.equal(new ServerAmbush().stage, 'waiting');
});
