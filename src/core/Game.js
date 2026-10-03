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

    // Combined PulseTool raycast list: level shootables + monster weak points.
    // Rebuilt once per level load (not per frame — zero-allocation rule).
    this._shootables = [];

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

    // --- Stealth HUD -------------------------------------------------------
    this._stealthVignetteEl = document.getElementById('stealth-vignette');
    this._stealthWarningEl = document.getElementById('stealth-warning');
    this._stealthHiddenEl = document.getElementById('stealth-hidden');

    // --- Objective HUD -----------------------------------------------------
    this._objectiveEl = document.getElementById('objective');

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
    });

    // Pulse tool hits — damage monster weak points, open doors, disable vents.
    this.pulseTool.on('hit', (target) => {
      if (target.userData.pulseType === 'weakpoint' && this.monster.isActive) {
        // Find the matching weak point mesh on the monster.
        for (const wp of this.monster.weakPoints) {
          if (wp === target) {
            this.monster.damageWeakPoint(wp);
            this.shaders.flashWeakPoint(wp); // reactive glow flash on hit
            // Remove the destroyed weak point from the raycast list so
            // later shots pass through instead of hitting an invisible mesh.
            const idx = this._shootables.indexOf(wp);
            if (idx >= 0) this._shootables.splice(idx, 1);
            break;
          }
        }
      }
      if (target.userData.doorId) {
        this.levels.openDoor(target.userData.doorId);
      }
      if (target.userData.ventId) {
        this.levels.disableVent(target.userData.ventId);
      }
    });

    this.monster.on('death', () => {
      // Monster defeated → clear the stealth HUD (frozen vignette otherwise).
      this._clearStealthHUD();

      // Drop the monster's meshes from the raycast list — they're invisible
      // now, but the raycaster doesn't skip invisible objects.
      this._shootables = this.levels.shootables.slice();

      // Kill feedback + next objective.
      this.camera.shake(0.4);
      if (this.gameState.currentLevel === 1) {
        this._setObjective('THREAT NEUTRALIZED — REACH THE REACTOR CORE');
      } else if (this.gameState.currentLevel === 2) {
        this._setObjective('THREAT NEUTRALIZED — REACH THE EMERGENCY EXIT');
      }

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
      if (newState === 'playing' && (oldState === 'gameover' || oldState === 'victory')) {
        // Retry from the end screen — the level was torn down on game over,
        // so rebuild it from level 1.
        this._loadLevel(1);
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

      // Monster AI — update BEFORE the PulseTool so this frame's raycast
      // tests against the monster's CURRENT position (MonsterAI.update
      // refreshes its world matrices at the end for exactly this reason).
      if (this.monster.isActive) {
        this.monster.update(dt, this.player.position);
        this._updateStealthHUD();
      }

      // Pulse Tool — fire, raycast, animate bolt/flash, recharge energy.
      // Raycast list includes the monster's body + weak points (see _loadLevel).
      this.pulseTool.update(dt, this._shootables);
      // Feed the bolt's current position into its fading trail (Kutloano).
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

      // Collapse timer countdown (Level 3 escape sequence).
      // (The level-3 win trigger itself is handled by _checkWinTriggers below.)
      if (this._collapseActive) {
        this._updateCollapseTimer(dt);
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
    // The collapse is driven by the real Level 3 escape timer (starts when
    // the boss dies) — don't run the ShaderManager's demo auto-driver.
    this.shaders.stopAutoCollapse();
    this.shaders.setDissolveAmount(0);

    // 5. Configure the Pulse Tool for this level's targets.
    this.pulseTool.setLevel(levelNum);

    // 6. Configure monster for this level.
    this.playerHealth = this.playerMaxHealth;
    this._setupMonster(levelNum);

    // 7. Reset collapse / escape state.
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

    // 8. Build the combined PulseTool raycast list: level targets plus the
    //    monster's body meshes (impact feedback on torso shots) and weak
    //    points (damage).
    this._shootables = this.levels.shootables
      .concat(this.monster.hitMeshes, this.monster.weakPoints);

    // 9. Show this level's objective so the player knows what to do.
    const objectives = {
      1: 'OBJECTIVE: REACH THE REACTOR CORE — CENTRE OF THE HALL',
      2: 'OBJECTIVE: SNEAK PAST THE MONSTER — REACH THE EMERGENCY EXIT (HIDE BEHIND COVER)',
      3: 'OBJECTIVE: DESTROY THE MONSTER\u2019S 3 GLOWING WEAK POINTS',
    };
    this._setObjective(objectives[levelNum] || '');
  }

  /**
   * Update the objective HUD text (top-left corner).
   * @param {string} text
   */
  _setObjective(text) {
    if (this._objectiveEl) this._objectiveEl.textContent = text;
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
        this.monster.setOccluders(this.levels.occluders); // walls/cover block LOS
        this.monster.detectionRange = 12;
        this.monster.escapeTimeout = 10;
        this.monster.chaseSpeed = 5.5;
        this.monster.attackDamage = 20;
        break;
      case 2:
        // Stealth: patrols the damaged facility between Mlungisi's waypoints.
        this.monster.spawn(0, 2, -26);
        if (waypoints.length > 0) {
          this.monster.setPatrolWaypoints(
            waypoints.map(wp => ({ x: wp.x, y: 0, z: wp.z }))
          );
        }
        // Pass level occluders (walls, lockers, tall cover) for LOS raycasts.
        this.monster.setOccluders(this.levels.occluders);
        // Tuning: harder to spot player, gives time to hide.
        this.monster.detectionRange = 10;  // narrower than L1
        this.monster.escapeTimeout = 6;    // gives up chase faster
        this.monster.chaseSpeed = 5.5;
        this.monster.attackDamage = 20;
        break;
      case 3:
        // Boss fight — arena-wide detection, never gives up the chase.
        this.monster.spawn(0, 2, -25);
        if (waypoints.length > 0) {
          this.monster.setPatrolWaypoints(
            waypoints.map(wp => ({ x: wp.x, y: 0, z: wp.z }))
          );
        }
        this.monster.setOccluders(this.levels.occluders);
        this.monster.detectionRange = 25;  // arena-wide detection
        this.monster.escapeTimeout = 999;  // never gives up chase in boss fight
        this.monster.chaseSpeed = 5.0;
        this.monster.attackDamage = 25;
        break;
    }
    this.monster.setActive(true);
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

    // Update the objective for the escape run.
    this._setObjective('ESCAPE — RUN TO THE GREEN EXIT');
  }

  /**
   * Tick the collapse timer. If it hits 0 → game over.
   * @param {number} dt
   */
  _updateCollapseTimer(dt) {
    this._collapseTime -= dt;

    // Drive Kutloano's dissolve shader from the real countdown:
    // 0 = intact at the start, 1 = fully dissolved when the timer hits 0.
    const progress = 1 - Math.max(0, this._collapseTime) / this._collapseDuration;
    this.shaders.setDissolveAmount(progress);

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
