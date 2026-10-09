/**
 * main.js — entry point.
 * Wires the Game class to the DOM and kicks everything off.
 *
 * Real assets (Blender models, texture sets, sampled audio) stream in BEFORE
 * the engine constructs — the loading screen's bar tracks genuine progress.
 * Missing files are fine: every consumer falls back to its procedural build,
 * and the preload promise never rejects, so the game always boots.
 */
import Game from './core/Game.js';
import AssetLibrary from './core/AssetLibrary.js';

const container = document.getElementById('game-container');
const loadingBar = document.getElementById('loading-bar');

// The Game constructor builds characters synchronously, so the asset maps
// must be populated first for them to pick up the real models. Async IIFE
// (not top-level await) keeps the build compatible with es2020 targets.
(async () => {
  await AssetLibrary.preload((settled, total) => {
    if (loadingBar) {
      loadingBar.style.width = Math.round((settled / total) * 100) + '%';
    }
  });

  const game = new Game(container);
  game.start();
})();
