import test from 'node:test';
import assert from 'node:assert/strict';
import LabOpening from '../src/core/LabOpening.js';

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
