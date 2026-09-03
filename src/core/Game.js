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

    // Monster AI — enemy with PATROL/CHASE/ATTACK state machine.
    this.monster = new MonsterAI(this.scene, this.physics);

    // Wire camera yaw so movement is camera-relative.
    this.player.cameraPivot = this.camera.yawObject;

    // --- Spawn points per level (Person B can adjust these) -----------------
    this._spawnPoints = {
      1: { x: 0, y: 2, z: -7 },
      2: { x: 0, y: 2, z: 5 },
      3: { x: 0, y: 2, z: -2 },
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

    // --- Stealth HUD -------------------------------------------------------
    this._stealthVignetteEl = document.getElementById('stealth-vignette');
    this._stealthWarningEl = document.getElementById('stealth-warning');
    this._stealthHiddenEl = document.getElementById('stealth-hidden');

    // --- Collapse timer (Level 3 escape sequence) -------------------------
    this._collapseTimerEl = document.getElementById('collapse-timer');
    this._collapseTimerValueEl = document.getElementById('collapse-timer-value');
    this._bossPhaseEl = document.getElementById('boss-phase');
    this._collapseTime = 0;          // seconds remaining (0 = not active)
    this._collapseActive = false;    // is the failsafe countdown running?
    this._escapeDoorOpen = false;    // has the exit door been opened?
    this._collapseDuration = 90;     // total seconds for escape sequence

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
      // console.log(`Monster: ${oldState} → ${newState}`);
    });

    this.monster.on('death', () => {
      // Monster defeated → start the failsafe collapse countdown.
      if (this.gameState.currentLevel === 3) {
        this._startCollapseSequence();
      }
    });

    this.monster.on('phaseChange', (phase) => {
      // Update boss phase HUD.
      if (this._bossPhaseEl) {
        const labels = ['', 'PHASE 2 — ENRAGED', 'PHASE 3 — CRITICAL'];
        this._bossPhaseEl.textContent = labels[phase] || '';
        this._bossPhaseEl.style.opacity = phase > 0 ? 1 : 0;
        this.camera.shake(0.3); // screen shake on phase transition
      }
    });

    // Pulse Tool hit → check for weak point targets and damage monster.
    this.pulseTool.on('hit', (target) => {
      if (target.userData.pulseType === 'weakpoint' && this.monster.isActive) {
        // Find the matching weak point mesh on the monster.
        for (const wp of this.monster.weakPoints) {
          if (wp === target) {
            this.monster.damageWeakPoint(wp);
            break;
          }
        }
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

      // Monster AI — update if active.
      if (this.monster.isActive) {
        this.monster.update(dt, this.player.position);
        this._updateStealthHUD();

        // Level 1 & 2 win check: reach the exit trigger zone.
        // (Level 3 requires the escape door to open first — handled below.)
        const lvl = this.gameState.currentLevel;
        if ((lvl === 1 || lvl === 2) && this.levels.exitTrigger) {
          const pPos = this.player.position;
          const ePos = this.levels.exitTrigger.position;
          const dx = pPos.x - ePos.x;
          const dz = pPos.z - ePos.z;
          if (Math.sqrt(dx * dx + dz * dz) < 3) {
            this.completeLevel();
          }
        }
      }

      // Collapse timer countdown (Level 3 escape sequence).
      if (this._collapseActive) {
        this._updateCollapseTimer(dt);

        // Level 3 win check: reach exit trigger after door opens.
        if (this._escapeDoorOpen && this.levels.exitTrigger) {
          const pPos = this.player.position;
          const ePos = this.levels.exitTrigger.position;
          const dx = pPos.x - ePos.x;
          const dz = pPos.z - ePos.z;
          if (Math.sqrt(dx * dx + dz * dz) < 4) {
            this.completeLevel();
          }
        }
      }

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
      // Clear stealth HUD when monster isn't active.
      this._clearStealthHUD();
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

    // 5. Configure monster for this level.
    this.playerHealth = this.playerMaxHealth;
    this._setupMonster(levelNum);

    // 6. Reset collapse / escape state.
    this._collapseActive = false;
    this._collapseTime = 0;
    this._escapeDoorOpen = false;
    if (this._collapseTimerEl) {
      this._collapseTimerEl.classList.remove('active');
    }
    if (this._bossPhaseEl) {
      this._bossPhaseEl.style.opacity = 0;
      this._bossPhaseEl.style.color = '#ff8844';
      this._bossPhaseEl.style.textShadow = '0 0 10px #f80';
    }
  }

  /**
   * Configure and spawn the monster for a given level.
   * Level 1: monster patrols the reactor hall (for testing).
   * Level 2: monster hunts the player through damaged corridors.
   * Level 3: boss fight in the arena.
   * @param {number} levelNum
   */
  _setupMonster(levelNum) {
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
        this.monster.setOccluders([]); // no LOS blocking in L1 (open hall)
        this.monster.detectionRange = 12;
        this.monster.escapeTimeout = 10;
        this.monster.chaseSpeed = 5.5;
        this.monster.attackDamage = 20;
        this.monster.setActive(true);
        break;
      case 2:
        // Stealth: monster patrols the damaged corridor.
        // Narrower detection range + higher escape timeout for stealth gameplay.
        this.monster.spawn(3, 2, -25);
        this.monster.setPatrolWaypoints([
          { x:  4, y: 0, z: -5  },
          { x:  4, y: 0, z: -20 },
          { x: -4, y: 0, z: -20 },
          { x: -4, y: 0, z: -40 },
          { x:  4, y: 0, z: -40 },
          { x:  4, y: 0, z: -5  },
        ]);
        // Pass level occluders for line-of-sight raycasting.
        this.monster.setOccluders(this.levels.occluders);
        // Tuning: harder to spot player, gives time to hide.
        this.monster.detectionRange = 10;  // narrower than L1
        this.monster.escapeTimeout = 6;    // gives up chase faster
        this.monster.chaseSpeed = 5.5;
        this.monster.attackDamage = 20;
        this.monster.setActive(true);
        break;
      case 3:
        // Boss fight in the arena — aggressive, wide detection, no escape timeout.
        this.monster.spawn(0, 2, -20);
        this.monster.setPatrolWaypoints([
          { x:  6, y: 0, z: -15 },
          { x:  6, y: 0, z: -25 },
          { x: -6, y: 0, z: -25 },
          { x: -6, y: 0, z: -15 },
        ]);
        this.monster.setOccluders(this.levels.occluders);
        this.monster.detectionRange = 25;  // arena-wide detection
        this.monster.escapeTimeout = 999;  // never gives up chase in boss fight
        this.monster.chaseSpeed = 5.0;
        this.monster.attackDamage = 25;
        this.monster.setActive(true);
        break;
    }
  }

  /**
   * Update the stealth HUD overlay: vignette, warning, hidden indicator.
   * Called every frame while monster is active. Zero allocation — reads
   * monster getters and sets CSS properties directly.
   */
  _updateStealthHUD() {
    const m = this.monster;
    const threat = m.threatLevel;      // 0..1 proximity
    const seeing = m.canSeePlayer;     // LOS to player
    const chasing = m.state === 'chase' || m.state === 'attack';

    // --- Vignette: red border pulses when monster is near ----------------
    if (this._stealthVignetteEl) {
      if (threat > 0.1) {
        const base = Math.min(threat * 0.7, 0.6);
        this._stealthVignetteEl.style.setProperty('--vignette-base', base);
        this._stealthVignetteEl.style.opacity = base;
        this._stealthVignetteEl.classList.add('pulse');
      } else {
        this._stealthVignetteEl.style.opacity = 0;
        this._stealthVignetteEl.classList.remove('pulse');
      }
    }

    // --- Warning: "! DETECTED !" flashes when monster sees + chases ------
    if (this._stealthWarningEl) {
      if (seeing && chasing) {
        this._stealthWarningEl.classList.add('active');
      } else {
        this._stealthWarningEl.classList.remove('active');
        this._stealthWarningEl.style.opacity = 0;
      }
    }

    // --- Hidden indicator: "[ HIDDEN ]" when behind cover while near ----
    if (this._stealthHiddenEl) {
      if (!seeing && threat > 0.2) {
        this._stealthHiddenEl.style.opacity = 1;
      } else {
        this._stealthHiddenEl.style.opacity = 0;
      }
    }
  }

  /** Reset all stealth HUD elements to their hidden/inactive state. */
  _clearStealthHUD() {
    if (this._stealthVignetteEl) {
      this._stealthVignetteEl.style.opacity = 0;
      this._stealthVignetteEl.classList.remove('pulse');
    }
    if (this._stealthWarningEl) {
      this._stealthWarningEl.classList.remove('active');
      this._stealthWarningEl.style.opacity = 0;
    }
    if (this._stealthHiddenEl) {
      this._stealthHiddenEl.style.opacity = 0;
    }
  }

  // --- Collapse / Escape sequence (Level 3) ───────────────────────────────

  /**
   * Start the failsafe collapse countdown.
   * Called when the monster is defeated in Level 3.
   * Opens the exit door and starts a 90s timer.
   */
  _startCollapseSequence() {
    this._collapseActive = true;
    this._collapseTime = this._collapseDuration;
    this._escapeDoorOpen = true;

    // Open the exit door (remove physics body + hide mesh).
    if (this.levels._exitDoor) {
      this.levels._exitDoor.visible = false;
      // Remove the door's physics body so player can walk through.
      const idx = this.levels._disposables.findIndex(
        d => d.mesh === this.levels._exitDoor
      );
      if (idx >= 0 && this.levels._disposables[idx].body) {
        this.physics.world.removeBody(this.levels._disposables[idx].body);
        this.levels._disposables[idx].body = null;
      }
    }

    // Show the collapse timer HUD.
    if (this._collapseTimerEl) {
      this._collapseTimerEl.classList.add('active');
    }

    // Screen shake for dramatic effect.
    this.camera.shake(0.5);

    // Hide boss phase indicator.
    if (this._bossPhaseEl) {
      this._bossPhaseEl.textContent = 'ESCAPE — RUN!';
      this._bossPhaseEl.style.opacity = 1;
      this._bossPhaseEl.style.color = '#0f0';
      this._bossPhaseEl.style.textShadow = '0 0 10px #0f0';
    }

    // Clear stealth HUD (monster is dead).
    this._clearStealthHUD();
  }

  /**
   * Tick the collapse timer. If it hits 0 → game over.
   * @param {number} dt
   */
  _updateCollapseTimer(dt) {
    this._collapseTime -= dt;

    // Update HUD.
    if (this._collapseTimerValueEl) {
      const secs = Math.max(0, Math.ceil(this._collapseTime));
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      this._collapseTimerValueEl.textContent = m + ':' + String(s).padStart(2, '0');
    }

    // Intensify screen shake as time runs out.
    if (this._collapseTime < 30 && this._collapseTime > 0) {
      const intensity = (1 - this._collapseTime / 30) * 0.15;
      this.camera.shake(intensity);
    }

    // Time's up — game over.
    if (this._collapseTime <= 0) {
      this._collapseTime = 0;
      this._collapseActive = false;
      this.gameState.gameOver();
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
}
