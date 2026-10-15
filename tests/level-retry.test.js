import test from 'node:test';
import assert from 'node:assert/strict';

// GameState wires its buttons/overlays by id during construction, so the test
// provides the smallest DOM stub that satisfies those lookups before importing.
const elements = new Map();
globalThis.document = {
  getElementById(id) {
    if (!elements.has(id)) {
      elements.set(id, { style: {}, textContent: '', hidden: false, addEventListener() {} });
    }
    return elements.get(id);
  },
  querySelector() { return null; },
  exitPointerLock() {},
};
globalThis.window = { addEventListener() {} };
// nextLevel() arms a 3s transition timer; the tests do not need it, and a
// pending timer would keep the test process alive after the assertions.
globalThis.setTimeout = () => 0;

const { default: GameState } = await import('../src/core/GameState.js');

test('retrying after death resumes the level the player died on', () => {
  const state = new GameState();
  state.onLoaded();
  state.startGame();
  assert.equal(state.currentLevel, 1, 'a fresh campaign starts at Level 1');

  state.nextLevel();
  assert.equal(state.currentLevel, 2, 'winning Level 1 advances to Level 2');
  state.gameOver();

  state.restart();
  assert.equal(state.currentLevel, 2, 'dying in Level 2 must not rewind to Level 1');
  assert.equal(state.state, 'playing');
});

test('starting a new campaign from the menu still rewinds to Level 1', () => {
  const state = new GameState();
  state.onLoaded();
  state.startGame();
  state.nextLevel();
  state.goToMenu();
  state.startGame();
  assert.equal(state.currentLevel, 1);
});
