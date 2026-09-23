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
import MonsterAI from './MonsterAI.js';

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

    this.pulseTool._bolt.material = this.shaders.createPulseGlowMaterial();
    this._pulseTrail = this.shaders.createPulseTrail();

    // Monster AI — enemy with PATROL/CHASE/ATTACK state machine.
    this.monster = new MonsterAI(this.scene, this.physics);
    
    this.shaders.wireLevelVisuals({ weakPoints: this.monster.weakPoints });

    // Wire camera yaw so movement is camera-relative.
    this.player.cameraPivot = this.camera.yawObject;

    // --- Spawn points per level (Mlungisi sets these) -----------------------
    this._spawnPoints = {
      1: { x: 0, y: 2, z: -7 },   // control room, south end
      2: { x: 0, y: 2, z: -7 },   // damaged control room, south end
      3: { x: 0, y: 2, z: 2 },    // escape room, south of arena
    };

    // --- Resize handler for renderer ----------------------------------------
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // --- Player health ------------------------------------------------------
    this.playerHealth = 100;
    this.playerMaxHealth = 100;
    this._healthFillEl = document.getElementById('health-bar-fill');

    // --- FPS counter --------------------------------------------------------
    this._fpsEl = document.getElementById('fps');
    this._debugKeysEl = document.getElementById('debug-keys');
    this._energyFillEl = document.getElementById('energy-bar-fill');
    this._energyWrapEl = document.getElementById('energy-bar-wrap');
    this._frameCount = 0;
    this._fpsTime = 0;

    // --- Clock --------------------------------------------------------------
    this._clock = new THREE.Clock();

    // --- Monster AI events --------------------------------------------------
    this.monster.on('attack', (damage) => {
      this.playerHealth = Math.max(0, this.playerHealth - damage);
      this.camera.shake(0.2); // screen shake on hit
      if (this.playerHealth <= 0) {
        this.gameState.gameOver();
      }
    });

    this.monster.on('stateChange', (newState, oldState) => {
      // TODO (Person D): Trigger monster sound effects per state.
    });

    // Pulse tool hits — damage monster weak points, open doors, disable vents.
    this.pulseTool.on('hit', (target) => {
      if (target.userData.pulseType === 'weakpoint' && !target.userData.destroyed) {
        this.monster.damageWeakPoint(target);
        this.shaders.flashWeakPoint(target); // reactive glow flash on hit
      }
      if (target.userData.doorId) {
        this.levels.openDoor(target.userData.doorId);
      }
      if (target.userData.ventId) {
        this.levels.disableVent(target.userData.ventId);
      }
    });

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
      this.camera.update(dt, this.player.position);
      this.physics.step(dt);
      this.shaders.update(dt);
      this.ui.update(dt);
      this.levels.update(dt); // animate doors, steam vents, rotating hazards

      // Pulse Tool — fire, raycast, animate bolt/flash, recharge energy.
      // Include monster weak points as shootable targets when monster is alive.
      const allTargets = this.monster.isActive && this.monster.state !== 'dead'
        ? this.levels.shootables.concat(this.monster.weakPoints)
        : this.levels.shootables;
      this.pulseTool.update(dt, allTargets);
      //  feed the bolt's current position into its fading trail.
      if (this.pulseTool._boltActive) {
        this._pulseTrail.emit(this.pulseTool._bolt.position);
      }

      // Update energy bar HUD.
      if (this._energyFillEl) {
        const pct = (this.pulseTool.energy / this.pulseTool.maxEnergy) * 100;
        this._energyFillEl.style.width = pct + '%';
      }
      if (this._energyWrapEl) {
        this._energyWrapEl.classList.toggle('cooldown', this.pulseTool._cooldownTimer > 0);
      }

      // Monster AI — update if active.
      if (this.monster.isActive) {
        this.monster.update(dt, this.player.position);
      }

      // Check win triggers (player reached objective for this level).
      this._checkWinTriggers();

      // Update health bar HUD.
      if (this._healthFillEl) {
        const pct = (this.playerHealth / this.playerMaxHealth) * 100;
        this._healthFillEl.style.width = pct + '%';
      }

      // Sync the third-person character model every frame.
      this.player.syncModel();
      // Hide model in first-person, show in third-person.
      this.player.setModelVisible(!this.camera.isFirstPerson);
    } else {
      // Still update camera so the menu background isn't frozen.
      this.camera.update(dt, this.player.position);
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

    // 2. Spawn the player at the level's spawn point.
    const sp = this._spawnPoints[levelNum] || { x: 0, y: 2, z: 0 };
    this.player.spawn(sp.x, sp.y, sp.z);

    // 3. Apply per-level fog settings from LevelManager as a base...
    if (this.levels.fogColor != null) {
      this.scene.fog = new THREE.Fog(
        this.levels.fogColor, this.levels.fogNear, this.levels.fogFar
      );
      this.scene.background = new THREE.Color(this.levels.fogColor);
    }

    // 4. ...then apply lighting + the real skybox + shader fog on top
    //    (Person C's ShaderManager). KUTLOANO: this must run AFTER step 3,
    //    or LevelManager's flat-colour fog/background stomps the gradient
    //    skybox and FogExp2 set here.
    switch (levelNum) {
      case 1: this.shaders.applyLevel1Lighting(); break;
      case 2: this.shaders.applyLevel2Lighting(); break;
      case 3: this.shaders.applyLevel3Lighting(); break;
    }

    
    this.shaders.wireLevelVisuals({
      heatHazeZones: levelNum === 2 ? (this.levels.heatHazeZones || []) : [],
      dissolveTargets: levelNum === 3 ? (this.levels._dissolveWalls || []) : [],
    });
    this.shaders.stopAutoCollapse();
    if (levelNum === 3) this.shaders.startAutoCollapse(75);

    // 5. Configure the Pulse Tool for this level's targets.
    this.pulseTool.setLevel(levelNum);

    // 6. Configure monster for this level.
    this.playerHealth = this.playerMaxHealth;
    this._setupMonster(levelNum);
  }

  /**
   * Configure and spawn the monster for a given level.
   * Level 1: monster patrols the reactor hall (for testing).
   * Level 2: monster hunts the player through damaged corridors.
   * Level 3: boss fight in the arena.
   * @param {number} levelNum
   */
  _setupMonster(levelNum) {
    const waypoints = this.levels.monsterWaypoints;
    switch (levelNum) {
      case 1:
        // Test patrol in the reactor hall.
        this.monster.spawn(0, 2, -30);
        this.monster.setPatrolWaypoints([
          { x: 3, y: 0, z: -28 },
          { x: 3, y: 0, z: -32 },
          { x: -3, y: 0, z: -32 },
          { x: -3, y: 0, z: -28 },
        ]);
        this.monster.setActive(true);
        break;
      case 2:
        // Monster patrols through the damaged corridors and reactor hall.
        this.monster.spawn(0, 2, -26);
        if (waypoints.length > 0) {
          this.monster.setPatrolWaypoints(
            waypoints.map(wp => ({ x: wp.x, y: 0, z: wp.z }))
          );
        }
        this.monster.setActive(true);
        break;
      case 3:
        // Boss fight — monster spawns in the arena centre.
        this.monster.spawn(0, 2, -25);
        if (waypoints.length > 0) {
          this.monster.setPatrolWaypoints(
            waypoints.map(wp => ({ x: wp.x, y: 0, z: wp.z }))
          );
        }
        this.monster.setActive(true);
        break;
    }
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

  // --- Win trigger checking -------------------------------------------------

  /**
   * Check if the player has reached a win trigger zone for the current level.
   * For Level 3 the trigger only activates after the monster is defeated.
   */
  _checkWinTriggers() {
    const triggers = this.levels.winTriggers;
    if (!triggers || triggers.length === 0) return;

    const px = this.player.position.x;
    const pz = this.player.position.z;

    for (const trigger of triggers) {
      if (trigger.needMonsterDead && this.monster.state !== 'dead') continue;

      const dx = px - trigger.x;
      const dz = pz - trigger.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < trigger.radius) {
        this.completeLevel();
        return;
      }
    }
  }
}
