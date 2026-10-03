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
import { createScientist, faceToRotY } from './CharacterFactory.js';

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

    // Scientist NPC — Level 1 intro beat (seated at the lab console).
    this._scientist = createScientist();
    this._scientistState = { mode: 'type' }; // mutated per frame — no allocs
    this._scientist.group.visible = false;
    this.scene.add(this._scientist.group);

    // Level 1 scripted creature reveal state (rebuilt on each level load).
    this._l1Reveal = null;

    // Combined PulseTool raycast list: level shootables + monster weak points.
    // Rebuilt once per level load (not per frame — zero-allocation rule).
    this._shootables = [];

    // Wire camera yaw so movement is camera-relative.
    this.player.cameraPivot = this.camera.yawObject;

    // --- Spawn points per level (match the rebuilt layouts) -----------------
    this._spawnPoints = {
      1: { x: 0, y: 2, z: -2 },   // L1 reception corridor (north end)
      2: { x: 0, y: 2, z: -3 },   // L2 staging bay (north end)
      3: { x: 0, y: 2, z: -2 },   // L3 entry corridor (north end)
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
      // Level 1's creature is a scripted cameo — never killable there.
      if (target.userData.pulseType === 'weakpoint' && this.monster.isActive
          && this.gameState.currentLevel !== 1) {
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
        this._setObjective('THREAT NEUTRALIZED — REACH THE CONTROL ROOM');
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
        this.monster.setActive(false);
        this._scientist.group.visible = false;
        this._l1Reveal = null;
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

      // Level 1 scripted beats: creature cameo + scientist NPC reaction.
      this._updateL1Reveal(dt);
      if (this._scientist.group.visible) {
        this._scientistState.mode =
          this._l1Reveal && this._l1Reveal.played ? 'cower' : 'type';
        this._scientist.update(dt, this._scientistState);
      }

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

    // 6b. Level 1 intro NPC — the scientist seated at the lab console.
    const npcAnchor = this.levels.npcAnchors && this.levels.npcAnchors.scientist;
    const showScientist = levelNum === 1 && !!npcAnchor;
    if (showScientist) {
      this._scientist.group.position.set(npcAnchor.x, 0, npcAnchor.z);
      this._scientist.group.rotation.y = faceToRotY(npcAnchor.face);
      this._scientistState.mode = 'type';
    }
    this._scientist.group.visible = showScientist;

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
      1: 'OBJECTIVE: REACH THE CONTROL ROOM — SHOOT THE GLOWING CONDUIT TO OPEN THE DOOR',
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
   * Level 1: scripted cameo only — bursts from the tube, flees (no fight).
   * Level 2: monster hunts the player through damaged corridors.
   * Level 3: boss fight in the arena.
   * @param {number} levelNum
   */
  _setupMonster(levelNum) {
    const waypoints = this.levels.monsterWaypoints;
    switch (levelNum) {
      case 1:
        // Scripted cameo only: the creature bursts out of the containment
        // tube and flees into the ducts (see _updateL1Reveal). Not a threat.
        this.monster.spawn(0, -50, 0);      // parked out of play
        this.monster.setPatrolWaypoints([]);
        this.monster.setOccluders(this.levels.occluders);
        this.monster.detectionRange = 0;    // can never detect the player
        this.monster.setActive(false);
        this._l1Reveal = { played: false, active: false, timer: 0 };
        return;
      case 2:
        // Stealth: sweeps the damaged facility between the rebuilt waypoints.
        this.monster.spawn(-4, 2, -21);
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
   * Level 1 scripted creature reveal — a cameo, not a fight.
   * When the player approaches the containment tube:
   *   1. the creature bursts out at scriptedReveal.spawn,
   *   2. lurches along the escape path into the ducts,
   *   3. vanishes once it reaches the end (deactivated, body parked).
   * detectionRange stays 0 the whole time, so it can never chase or attack.
   * @param {number} dt
   */
  _updateL1Reveal(dt) {
    const reveal = this.levels.scriptedReveal;
    const r = this._l1Reveal;
    if (!reveal || !r) return;

    if (!r.played) {
      // Trigger: player steps into the lab, near the containment tube.
      const dx = this.player.position.x - reveal.trigger.x;
      const dz = this.player.position.z - reveal.trigger.z;
      if (dx * dx + dz * dz < reveal.trigger.radius * reveal.trigger.radius) {
        r.played = true;
        r.active = true;
        r.timer = 0;
        // Burst out of the tube and flee along the scripted path.
        this.monster.spawn(reveal.spawn.x, reveal.spawn.y, reveal.spawn.z);
        this.monster.patrolSpeed = 3.6;   // panic-lurch, faster than patrol
        this.monster.setPatrolWaypoints(
          reveal.escape.map(p => ({ x: p.x, y: 0, z: p.z }))
        );
        this.monster.setActive(true);
        this.camera.shake(0.45);          // alarm-beat impact
      }
      return;
    }

    if (r.active) {
      r.timer += dt;
      // Deactivate once it has vanished into the ducts (or as a safety cap).
      const end = reveal.escape[reveal.escape.length - 1];
      const edx = this.monster.position.x - end.x;
      const edz = this.monster.position.z - end.z;
      if (r.timer > 1.2 && (edx * edx + edz * edz < 2.25 || r.timer > 7)) {
        r.active = false;
        this.monster.setActive(false);
        this.monster.body.position.set(0, -50, 0); // park out of play
        this.monster.patrolSpeed = 2.0;            // restore default tuning
      }
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
