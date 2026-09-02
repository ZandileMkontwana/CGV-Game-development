import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import InputManager from './InputManager.js';
import PhysicsWorld from './PhysicsWorld.js';
import PlayerController from './PlayerController.js';
import CameraController from './CameraController.js';
import GameState from './GameState.js';
import LevelManager from '../levels/LevelManager.js';
import ShaderManager from '../shaders/ShaderManager.js';
import UIManager from '../ui/UIManager.js';
import PulseTool from './PulseTool.js';

/**
 * Game — top-level orchestrator.
 *
 * Creates the Three.js renderer, scene, and all core subsystems.
 * Runs the animation loop and delegates per-frame updates to each system.
 * Level content (Person B), shaders (Person C) and UI/sound (Person D)
 * plug into the hooks marked with TODO comments.
 */
export default class Game {
  constructor(container) {
    // --- Renderer -----------------------------------------------------------
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // --- Scene --------------------------------------------------------------
    this.scene = new THREE.Scene();
    // TODO (Person C): Set skybox / fog per level.
    this.scene.background = new THREE.Color(0x0a0a0a);
    this.scene.fog = new THREE.Fog(0x0a0a0a, 20, 80);

    // --- Subsystems ---------------------------------------------------------
    this.input = new InputManager(this.renderer.domElement);
    this.physics = new PhysicsWorld();
    this.camera = new CameraController(this.scene, this.input);
    this.player = new PlayerController(this.scene, this.physics, this.input);
    this.gameState = new GameState();
    this.levels = new LevelManager(this.scene, this.physics);
    this.shaders = new ShaderManager(this.scene);
    this.ui = new UIManager();

    // Pulse Tool — energy-based shooting device.
    this.pulseTool = new PulseTool(this.scene, this.camera.camera, this.input);

    // Wire camera yaw so movement is camera-relative.
    this.player.cameraPivot = this.camera.yawObject;

    // --- Spawn points per level (Person B can adjust these) -----------------
    this._spawnPoints = {
      1: { x: 0, y: 2, z: -7 },
      2: { x: 0, y: 2, z: 0 },
      3: { x: 0, y: 2, z: 0 },
    };

    // --- Resize handler for renderer ----------------------------------------
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // --- FPS counter --------------------------------------------------------
    this._fpsEl = document.getElementById('fps');
    this._debugKeysEl = document.getElementById('debug-keys');
    this._energyFillEl = document.getElementById('energy-bar-fill');
    this._energyWrapEl = document.getElementById('energy-bar-wrap');
    this._frameCount = 0;
    this._fpsTime = 0;

    // --- Clock --------------------------------------------------------------
    this._clock = new THREE.Clock();

    // --- Game state hooks ---------------------------------------------------
    this.gameState.onChange((newState, oldState) => {
      if (newState === 'playing' && oldState === 'menu') {
        // Fresh start — load level 1 geometry, lighting, and spawn player.
        this._loadLevel(1);
      }
      if (newState === 'playing' && oldState === 'levelTransition') {
        // Load the next level after transition.
        this._loadLevel(this.gameState.currentLevel);
      }
      if (newState === 'menu' || newState === 'gameover') {
        // Tear down level content when returning to menu.
        this.levels._teardown();
      }
    });
  }

  /** Kick off the game. */
  start() {
    // Simulate a brief load (replace with real asset loading later).
    this.gameState.setLoadingProgress(100);
    this.gameState.onLoaded();
    this._loop();
  }

  // --- Main loop ------------------------------------------------------------
  _loop = () => {
    requestAnimationFrame(this._loop);
    const dt = Math.min(this._clock.getDelta(), 0.1); // cap to avoid spiral

    // FPS counter.
    this._frameCount++;
    this._fpsTime += dt;
    if (this._fpsTime >= 0.5) {
      if (this._fpsEl) {
        this._fpsEl.textContent = Math.round(this._frameCount / this._fpsTime) + ' FPS';
      }
      this._frameCount = 0;
      this._fpsTime = 0;
    }

    // Debug: show active keys.
    if (this._debugKeysEl) {
      const activeKeys = Object.keys(this.input.keys).filter(k => this.input.keys[k]);
      this._debugKeysEl.textContent = activeKeys.length
        ? 'Keys: ' + activeKeys.join(', ')
        : 'Keys: none';
    }

    // Only update simulation while playing.
    if (this.gameState.isPlaying) {
      this.player.update(dt);
      this.camera.update(dt, this.player.eyePosition);
      this.physics.step(dt);
      this.shaders.update(dt);
      this.ui.update(dt);

      // Pulse Tool — fire, raycast, animate bolt/flash, recharge energy.
      this.pulseTool.update(dt, this.levels.shootables);

      // Update energy bar HUD.
      if (this._energyFillEl) {
        const pct = (this.pulseTool.energy / this.pulseTool.maxEnergy) * 100;
        this._energyFillEl.style.width = pct + '%';
      }
      if (this._energyWrapEl) {
        this._energyWrapEl.classList.toggle('cooldown', this.pulseTool._cooldownTimer > 0);
      }
    } else {
      // Still update camera so the menu background isn't frozen.
      this.camera.update(dt, this.player.eyePosition);
    }

    this.input.endFrame();
    this.renderer.render(this.scene, this.camera.camera);
  };

  // --- Level loading --------------------------------------------------------

  /**
   * Load a level: geometry (Person B), lighting (Person C), spawn player.
   * Called automatically on state transitions — Person B/C don't call this.
   * @param {number} levelNum 1, 2, or 3
   */
  _loadLevel(levelNum) {
    // 1. Build level geometry and physics (Person B's LevelManager).
    this.levels.load(levelNum);

    // 2. Apply level-specific lighting and shaders (Person C's ShaderManager).
    switch (levelNum) {
      case 1: this.shaders.applyLevel1Lighting(); break;
      case 2: this.shaders.applyLevel2Lighting(); break;
      case 3: this.shaders.applyLevel3Lighting(); break;
    }

    // 3. Spawn the player at the level's spawn point.
    const sp = this._spawnPoints[levelNum] || { x: 0, y: 2, z: 0 };
    this.player.spawn(sp.x, sp.y, sp.z);

    // 4. Configure the Pulse Tool for this level's targets.
    this.pulseTool.setLevel(levelNum);
  }

  /**
   * Call this from level gameplay code when the player completes the
   * current level objective (e.g. reach exit, defeat boss).
   * Advances to the next level or triggers game over.
   */
  completeLevel() {
    this.gameState.nextLevel();
  }

  /**
   * Update a level's spawn point. Call from LevelManager or during setup.
   * @param {number} levelNum
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setSpawnPoint(levelNum, x, y, z) {
    this._spawnPoints[levelNum] = { x, y, z };
  }
}
