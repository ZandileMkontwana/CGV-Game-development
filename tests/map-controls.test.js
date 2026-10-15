import test from 'node:test';
import assert from 'node:assert/strict';
import AudioManager from '../src/audio/AudioManager.js';

test('M is available for the map while U toggles mute once per press', () => {
  const previousWindow = globalThis.window;
  const listeners = [];
  globalThis.window = { addEventListener(type, listener) { if (type === 'keydown') listeners.push(listener); } };
  try {
    const audio = new AudioManager();
    audio.unlock = () => {};
    const press = (code, repeat = false, typing = false) => {
      for (const listener of listeners) listener({ code, repeat, target: { closest: () => typing } });
    };
    press('KeyM');
    assert.equal(audio.muted, false, 'Opening the map must not mute the game');
    press('KeyU');
    assert.equal(audio.muted, true);
    press('KeyU', true);
    assert.equal(audio.muted, true, 'Holding the key cannot repeatedly toggle audio');
    press('KeyU', false, true);
    assert.equal(audio.muted, true, 'Typing into settings must not trigger gameplay shortcuts');
    press('KeyU');
    assert.equal(audio.muted, false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
