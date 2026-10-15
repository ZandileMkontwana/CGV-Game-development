import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import InputManager from './InputManager.js';
import PhysicsWorld from './PhysicsWorld.js';
import PlayerController from './PlayerController.js';
import CameraController from './CameraController.js';
import GameState from './GameState.js';
import LevelManager from '../levels/LevelManager.js';
import ShaderManager from '../shaders/ShaderManager.js';
import { setMaxAnisotropy } from '../shaders/textures.js';
import UIManager from '../ui/UIManager.js';
import { PA_ANNOUNCEMENTS } from '../ui/content.js';
import PulseTool from './PulseTool.js';
import MonsterAI from './MonsterAI.js';
import { createScientist, faceToRotY } from './CharacterFactory.js';
import AudioManager from '../audio/AudioManager.js';
import PostFX from './PostFX.js';
import LabOpening from './LabOpening.js';
import HuntAwareness from './HuntAwareness.js';
import BossEncounter from './BossEncounter.js';
import ServerAmbush from './ServerAmbush.js';
import WeaponViewmodel from './WeaponViewmodel.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Filmic curve slightly lifted so the localized practical lamps read as
    // real bright sources instead of being flattened by the global fill.
    this.renderer.toneMappingExposure = 1.06;
    // Sharpen floor/wall detail at grazing angles (long-corridor views) —
    // applies to every procedural texture built from here on.
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    container.appendChild(this.renderer.domElement);
    if (import.meta.env.DEV) {
      window.__game = this; // dev-only debug handle
      // TEMP debug level skip: N = next level, 1/2/3 = jump straight to it.
      // Inside the DEV guard, so production builds strip this.
      window.addEventListener('keydown', (e) => {
        if (e.repeat || this.gameState.state !== 'playing') return;
        if (e.code === 'KeyN') { this.completeLevel(); return; }
        const n = { Digit1: 1, Digit2: 2, Digit3: 3 }[e.code];
        if (n) { this.gameState._currentLevel = n - 1; this.completeLevel(); }
      });
    }

    // --- Scene --------------------------------------------------------------
    this.scene = new THREE.Scene();
    // TODO (Person C): Set skybox / fog per level.
    this.scene.background = new THREE.Color(0x0a0a0a);
    this.scene.fog = new THREE.Fog(0x0a0a0a, 20, 80);

    // Image-based lighting: metals (rifle) and PBR characters render black
    // and flat without reflections. Raised from a barely-there level so the
    // high-metalness facility surfaces (panels, beams, pipes) pick up real
    // reflection sheen — the "convincing metal" look, not flat grey boxes.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    // --- Subsystems ---------------------------------------------------------
    this.ui = new UIManager();
    this._assetErrors = [];
    this.loadingManager = new THREE.LoadingManager();
    this._assetsReady = new Promise(resolve => { this.loadingManager.onLoad = resolve; });
    this.loadingManager.onProgress = (_url, loaded, total) => {
      this.ui.setLoadingProgress(loaded / total * 100, `Loaded ${loaded} of ${total} assets`);
    };
    this.loadingManager.onError = url => this._assetErrors.push(url);
    // Keep the loading batch open until all constructor work is registered.
    this.loadingManager.itemStart('initialization');
    this.ui.setLoadingProgress(0, 'Preparing the facility…');
    const menuImage = new Image();
    const menuImageUrl = './assets/textures/menu-bg.png';
    this.loadingManager.itemStart(menuImageUrl);
    menuImage.onload = () => this.loadingManager.itemEnd(menuImageUrl);
    menuImage.onerror = () => {
      this.loadingManager.itemError(menuImageUrl);
      this.loadingManager.itemEnd(menuImageUrl);
    };
    menuImage.src = menuImageUrl;

    this.input = new InputManager(this.renderer.domElement);
    this.physics = new PhysicsWorld();
    this.camera = new CameraController(this.scene, this.input);
    this.player = new PlayerController(this.scene, this.physics, this.input, this.loadingManager);
    this.gameState = new GameState();
    this.levels = new LevelManager(this.scene, this.physics);
    this.shaders = new ShaderManager(this.scene);

    // Pulse Tool — energy-based shooting device.
    this.pulseTool = new PulseTool(this.scene, this.camera.camera, this.input);

    // CoD-style first-person rifle + cinematic post-processing chain.
    this.weapon = new WeaponViewmodel(this.camera.camera, this.input);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera.camera);

    this.pulseTool._bolt.material = this.shaders.createPulseGlowMaterial();
    this._pulseTrail = this.shaders.createPulseTrail();

    // Monster AI — enemy with PATROL/CHASE/ATTACK state machine.
    this.monster = new MonsterAI(this.scene, this.physics);
    this.serverMonster = new MonsterAI(this.scene, this.physics);
    this._parkServerMonster();

    this.shaders.wireLevelVisuals({ weakPoints: this.monster.weakPoints });

    // Scientist NPC — Level 1 intro beat (seated at the lab console).
    this._scientist = createScientist();
    this._scientistState = { mode: 'type' }; // mutated per frame — no allocs
    this._scientist.group.visible = false;
    this.scene.add(this._scientist.group);

    // Red glow that bathes the scientist during the mutation beat. Kept at
    // intensity 0 (not hidden) so the lighting shader never recompiles.
    this._mutateLight = new THREE.PointLight(0xff2a1a, 0, 8, 2);
    this._mutateLight.position.set(0, -50, 0);
    this.scene.add(this._mutateLight);

    // Level 1 scripted creature reveal state (rebuilt on each level load).
    this._l1Reveal = null;

    // Level 2 opens unarmed — firing unlocks at the staging-bay security
    // locker (see _takeSidearm); the breach briefing beats live in _l2Opening.
    this._weaponReady = true;
    this._l2Opening = null;

    // Aim-down-sights toggle: the player can latch ADS on/off with a key
    // (Z) so they don't have to hold right-mouse. Reset on every level load.
    this._adsToggled = false;

    // Level 1 tutorial — controls walkthrough (see _updateTutorial).
    this._tutorialSteps = [
      {
        text: 'WASD — MOVE   ·   SHIFT — SPRINT   ·   SPACE — JUMP',
        sub: 'MOUSE — LOOK   ·   V — TOGGLE FIRST/THIRD PERSON   ·   T — TORCH',
      },
      {
        text: 'LEFT CLICK / F — FIRE THE PULSE TOOL',
        sub: 'HOLD RMB OR TAP Z TO AIM · ENERGY RECHARGES ON ITS OWN',
      },
      {
        text: 'LAB A-2 — PULSE THE AMBER RELAY BESIDE THE CHAMBER',
        sub: 'YOUR SERVICE CALL: RESTORE AUXILIARY POWER',
      },
      {
        text: 'LISTEN — GROWLS AND YOUR HEARTBEAT MEAN IT IS NEAR',
        sub: 'HIDE BEHIND COVER TO BREAK LINE OF SIGHT · M — MUTE',
      },
    ];
    this._tut = null;         // built per Level-1 load
    this._baseObjective = ''; // restored after scripted beats change it

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
      if (this.gameState.state === 'paused') this._pausedNeedsRender = true;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.gameState.isPlaying) this.gameState.pause();
    });

    // --- Player health ------------------------------------------------------
    this.playerHealth = 100;
    this.playerMaxHealth = 100;

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
    this._hitMarkerEl = document.getElementById('hit-marker');
    this._interactPromptEl = document.getElementById('interact-prompt');

    // Prod builds drop the fps / key debug readouts (main-branch behaviour).
    if (!import.meta.env.DEV) {
      this._fpsEl?.remove();
      this._debugKeysEl?.remove();
      this._fpsEl = this._debugKeysEl = null;
    }

    // --- Collapse timer (Level 3 escape sequence) -------------------------
    this._collapseTime = 0;          // seconds remaining (0 = not active)
    this._collapseActive = false;    // is the failsafe countdown running?
    this._escapeDoorOpen = false;    // has the exit door been opened?
    this._collapseDuration = 90;     // total seconds for escape sequence

    this._frameCount = 0;
    this._fpsTime = 0;

    // --- Audio ---------------------------------------------------------------
    // Procedural horror score/effects — no spoken dialogue (see AudioManager).
    this.audio = new AudioManager();
    this.ui.connect(this.audio, this.camera, this.gameState);
    this._monsterSeen = false; // one first-sighting sting per level
    this._camPosVec = new THREE.Vector3(); // reused in the sight check
    this._fwdVec = new THREE.Vector3();
    this._viewRay = new THREE.Raycaster();
    this._viewDirection = new THREE.Vector3();
    this._viewHits = [];
    this._aimPoint = new THREE.Vector3();

    // --- Clock --------------------------------------------------------------
    this._clock = new THREE.Clock();

    // --- Monster AI events --------------------------------------------------
    const receiveAttack = damage => {
      if (!this.gameState.isPlaying) return;
      this.playerHealth = Math.max(0, this.playerHealth - damage);
      this.camera.shake(0.2); // screen shake on hit
      this.audio.play('attack');
      this.audio.duck(0.55);
      if (this.playerHealth <= 0) {
        this.gameState.gameOver();
      }
    };
    this.monster.on('attack', receiveAttack);
    this.serverMonster.on('attack', receiveAttack);

    this.monster.on('stateChange', (newState, oldState) => {
      // A sharp screech the moment the hunt begins — the classic "it saw me".
      if (newState === 'chase' && oldState !== 'chase') {
        this.audio.play(this.monster.awareness?.searching ? 'growl' : 'spotted');
        this.audio.duck(0.45);
      }
    });

    // Pulse tool hits — damage monster weak points, open doors, disable vents.
    this.pulseTool.on('hit', (target) => {
      // Impact feedback for every landed shot.
      this.audio.play('pulseHit');
      this._flashHitMarker();
      // Tutorial: track the first successful hit on a shootable panel.
      if (this._tut && target.userData.pulseTarget) this._tut.hit = true;
      if (target.userData.storyAction === 'restore-lab-power') this._repairLabPower(target);
      // The creature is killable from the hunt (L2) onward. Level 1's creature
      // is a scripted cameo — shots there must not cut the reveal short.
      const monsterHit = this.gameState.currentLevel >= 2 && this.monster.isActive;
      if (monsterHit && target.userData.pulseType === 'weakpoint') {
        // A shot into an exposed culture sac ruptures it outright.
        for (const wp of this.monster.weakPoints) {
          if (wp === target && !wp.userData.destroyed) {
            this.monster.damageWeakPoint(wp);
            this.shaders.flashWeakPoint(wp); // reactive glow flash on hit
            // Remove the destroyed weak point from the raycast list so
            // later shots pass through instead of hitting an invisible mesh.
            const idx = this._shootables.indexOf(wp);
            if (idx >= 0) this._shootables.splice(idx, 1);
            break;
          }
        }
      } else if (monsterHit && target.userData.pulseType === 'monsterBody') {
        // Body shots wound it — enough of them rupture the next live node, so
        // the creature always dies even when the player can't hit a growth.
        this.audio.play('growl', 0.55);
        const ruptured = this.monster.damageBody(1);
        if (ruptured) {
          this.shaders.flashWeakPoint(ruptured);
          const idx = this._shootables.indexOf(ruptured);
          if (idx >= 0) this._shootables.splice(idx, 1);
        }
      }
      if (target.userData.doorId) {
        this.levels.openDoor(target.userData.doorId);
        this.audio.play('doorOpen');
      }
      if (target.userData.ventId) {
        if (this.levels.disableVent(target.userData.ventId)) {
          target.material.color.setHex(0x8be6bc);
          target.material.emissive.setHex(0x47cfa0);
          this.audio.play('ventHiss');
        }
      }
    });

    // Tutorial: track the first pulse the player fires.
    this.pulseTool.on('fire', () => {
      if (this._tut) this._tut.fired = true;
      if (this.gameState.currentLevel === 2 && this.monster.isActive
          && this.monster.position.distanceTo(this.player.position) < 14) {
        this.monster.awareness.hear(this.player.position.x, this.player.position.z);
      }
      if (this.gameState.currentLevel === 2 && this._serverAmbush?.stage === 'chasing'
          && this.serverMonster.position.distanceTo(this.player.position) < 14) {
        this.serverMonster.awareness.hear(this.player.position.x, this.player.position.z);
      }
      this.audio.play('pulseShot');
      if (this.camera.isFirstPerson) this.weapon.fire();
      else this.player.heldWeapon.fire();
      this.camera.recoil();
    });

    // Airy whoosh when a pulse shot hits nothing.
    this.pulseTool.on('miss', () => {
      this.audio.play('pulseMiss');
    });

    this.monster.on('death', () => {
      this.monster.setActive(false);
      // Monster defeated → clear the stealth HUD (frozen vignette otherwise).
      this._clearStealthHUD();

      // Drop the monster's meshes from the raycast list — they're invisible
      // now, but the raycaster doesn't skip invisible objects.
      this._shootables = this.levels.shootables.slice();

      // Kill feedback + next objective.
      this.camera.shake(0.4);
      this.audio.play('death');
      this.audio.duck(0.6);
      if (this.gameState.currentLevel === 1) {
        this._setObjective('THREAT NEUTRALIZED — REACH THE CONTROL ROOM');
      } else if (this.gameState.currentLevel === 2) {
        this._setObjective('THREAT NEUTRALIZED — REACH THE EMERGENCY EXIT');
        this.ui.showAnnouncement('Entity down. Sector B reads clear — continue to core access.');
      }

      // Monster defeated → start the failsafe collapse countdown.
      if (this.gameState.currentLevel === 3) {
        this._startCollapseSequence();
      }
    });

    this.monster.on('phaseChange', (phase) => {
      this.audio.play('roar');
      this.audio.duck(0.5);
      // Update boss phase HUD.
      this.ui.setBossPhase(0);
      this.camera.shake(0.3);
    });
    this.monster.on('bossCue', stage => {
      if (this.gameState.currentLevel !== 3) return;
      if (stage === 'windup') this.audio.play('bossWindup');
      if (stage === 'pursuit' && !this._bossIntroAnnounced) {
        this._bossIntroAnnounced = true;
        this.audio.play('roar');
        this.ui.showAnnouncement('Entity signature holds the surface seal. Destroy its three exposed nodes to release evacuation.');
        this.ui.showTutorial(null);
      }
    });

    // --- Game state hooks ---------------------------------------------------
    this.gameState.onChange((newState, oldState, reason) => {
      this.ui.setState(newState);
      if (newState === 'playing') this.postfx.resetFrameTiming();
      if (newState === 'playing' && (oldState === 'menu' || oldState === 'gameover'
          || oldState === 'victory' || reason === 'restart')) {
        // A restart resumes the level the player was on (death retry, pause
        // restart); entering from a menu always starts the campaign at 1.
        this._loadLevel(reason === 'restart' ? this.gameState.currentLevel : 1);
      }
      if (newState === 'levelTransition') {
        // Build the next level NOW, behind the black transition overlay, so
        // the level-load shader warm-up stall never shows as a frozen frame.
        this._loadLevel(this.gameState.currentLevel);
        this._transitionNeedsRender = true;
      }
      if (newState === 'gameover') {
        this.audio.play('gameover');
        this.audio.stopAmbient();
        this.audio.stopRumble();
      }
      if (newState === 'victory' || newState === 'menu') {
        if (newState === 'victory') this.audio.play('win');
        this.audio.stopAmbient();
        this.audio.stopRumble();
      }
      if (newState === 'menu' || newState === 'gameover' || newState === 'victory') {
        // Release the level while a menu or the ending covers the canvas.
        this.levels._teardown();
        this.shaders.clearLevelVisuals();
        this.monster.setActive(false);
        this._parkServerMonster();
        this._scientist.group.visible = false;
        this._l1Reveal = null;
        this._collapseActive = false;
      }
      this.audio.setGameState(newState);
    });
  }

  /** Kick off the game. */
  start() {
    this._loop();
    this.loadingManager.itemEnd('initialization');
    this._assetsReady.then(() => {
      this.ui.setLoadingProgress(100, 'Ready');
      if (this._assetErrors.length) {
        this.ui.showAssetWarning('Some assets could not load. The game will use available fallbacks; check your connection and reload.');
      }
      this.gameState.onLoaded();
    });
  }

  // --- Main loop ------------------------------------------------------------
  _loop = () => {
    requestAnimationFrame(this._loop);
    // try/catch keeps the frame presenting no matter what throws below —
    // an exception before postfx.render() would otherwise freeze the canvas
    // permanently while the loop keeps silently rescheduling.
    try {
      this._tick();
    } catch (err) {
      const now = performance.now();
      if (!this._lastLoopErr || now - this._lastLoopErr > 2000) {
        this._lastLoopErr = now;
        console.error('[Game] frame error:', err);
      }
    }
  };

  _tick = () => {
    const dt = Math.min(this._clock.getDelta(), 0.2); // cap to avoid spiral

    // Menus/ending use DOM, and pause retains the last rendered gameplay frame.
    // Prepare a new level once behind its transition screen, rather than
    // drawing it continuously while the player waits for the next briefing.
    if (!this.gameState.isPlaying) {
      if (this.gameState.state === 'levelTransition' && this._transitionNeedsRender) {
        this.camera.update(0, this.player.position);
        this.player.syncModel();
        this.player.setViewMode(this.camera.isFirstPerson);
        this.postfx.render(0);
        this._transitionNeedsRender = false;
      } else if (this.gameState.state === 'paused' && this._pausedNeedsRender) {
        this.postfx.render(0);
        this._pausedNeedsRender = false;
      }
      this.input.endFrame();
      return;
    }

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
      // Stance/aim from raw input — feeds both the player (move speed) and
      // the camera (FOV zoom, shoulder tighten, pivot height).
      // ADS can be HELD on right-mouse or LATCHED with the aim-toggle key.
      if (this.input.justPressed('KeyZ')) this._adsToggled = !this._adsToggled;
      const aiming = this.input.mouse.rightDown === true || this._adsToggled;
      const crouching = this.input.keys['KeyC'] === true;
      this.player.setStance(crouching, aiming);
      this.player.update(dt);
      this.physics.step(dt);
      this.player.refreshMovementState();
      this.camera.update(dt, this.player.position, {
        aiming,
        crouching,
        moving: this.player._charState.moving,
        sprinting: this.player._charState.sprinting,
        grounded: this.player._charState.grounded,
      });
      this.shaders.update(dt);
      this.ui.update(dt);
      this.levels.update(dt); // animate doors, steam vents, rotating hazards
      if (this.gameState.currentLevel === 2) this._updateServerAmbush(dt);
      this._updateHealthPacks(dt);

      // Level 1 scripted beats: mutation reveal, tutorial, scientist NPC.
      this._updateL1Reveal(dt);
      this._updateTutorial(dt);
      // Level 2 breach briefing (staged PA + instruction beats).
      this._updateL2Opening(dt);
      if (this._scientist.group.visible) {
        this._scientist.update(dt, this._scientistState);
      }

      // First-person rifle: sway/bob/ADS driven by the same stance state,
      // hidden in third person so it doesn't float beside the body. Also
      // hidden while unarmed (Level 2 before the security-locker pickup).
      this.weapon.setVisible(this.camera.isFirstPerson && this._weaponReady);
      this.weapon.update(dt, {
        moving: this.player._charState.moving,
        sprinting: this.player._charState.sprinting,
        aiming,
      });

      // Procedural soundscape: footsteps, heartbeat, growls, distant creaks,
      // the creature's own heavy footfalls, and muffled breath while hiding.
      const mon = this._selectThreatMonster();
      const cs = this.player._charState;
      const mdx = mon.position.x - this.player.position.x;
      const mdz = mon.position.z - this.player.position.z;
      const mDist = mon.isActive ? Math.sqrt(mdx * mdx + mdz * mdz) : 999;
      const chasingNow = mon.state === 'chase' || mon.state === 'attack';

      // Danger drives the PostFX red vignette pulse — the screen closes in
      // as the creature closes distance, heard or not.
      this.postfx.setDanger(mon.isActive ? Math.max(0, 1 - mDist / 13) : 0);
      const hidingNow = mon.isActive && !mon.canSeePlayer && mon.threatLevel > 0.2;
      this.audio.update(
        dt,
        cs.moving, cs.sprinting, cs.grounded,
        mon.isActive ? mon.threatLevel : 0,
        chasingNow,
        mon.isActive,
        this.playerHealth / this.playerMaxHealth,
        mDist,
        hidingNow,
        mon.body.velocity.x ** 2 + mon.body.velocity.z ** 2 > 0.1
      );

      // First time the creature crosses your view — one hard sting per level.
      if (mon.isActive && !this._monsterSeen &&
          this.gameState.currentLevel !== 1 && mDist < 24) {
        this.camera.camera.getWorldPosition(this._camPosVec);
        this.camera.camera.getWorldDirection(this._fwdVec);
        const vx = mon.position.x - this._camPosVec.x;
        const vy = mon.position.y + 0.6 - this._camPosVec.y;
        const vz = mon.position.z - this._camPosVec.z;
        const vlen = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
        const facing = (vx * this._fwdVec.x + vy * this._fwdVec.y + vz * this._fwdVec.z) / vlen;
        if (facing > 0.35) {
          this._viewDirection.set(vx, vy, vz).normalize();
          this._viewRay.set(this._camPosVec, this._viewDirection);
          this._viewRay.far = vlen;
          this._viewHits.length = 0;
          this._viewRay.intersectObjects(this.levels.occluders, false, this._viewHits);
          if (this._viewHits.length === 0) {
            this._monsterSeen = true;
            this.audio.play('jumpscare');
            this.audio.duck(0.85);
            this.camera.shake(this.gameState.currentLevel === 2 ? 0.35 : 0.9);
          }
        }
      }

      // Monster AI — update BEFORE the PulseTool so this frame's raycast
      // tests against the monster's CURRENT position (MonsterAI.update
      // refreshes its world matrices at the end for exactly this reason).
      if (this.monster.isActive) {
        if (this.gameState.currentLevel === 2 && this._huntNavVersion !== this.levels.navigationVersion) this._refreshHuntNavigation();
        this.monster.update(dt, this.player.position, this.player);
      }
      if (this.gameState.isPlaying && this.serverMonster.isActive) {
        this.serverMonster.update(dt, this.player.position, this.player);
      }
      // An attack can end the game and release the level during this update.
      if (!this.gameState.isPlaying) {
        this.input.endFrame();
        return;
      }
      this._updateStealthHUD();

      // Update the animated body and both weapon muzzles before firing.
      this.player.syncModel();
      this.player.setViewMode(this.camera.isFirstPerson);
      if (!this.camera.isFirstPerson) {
        this.pulseTool.getAimPoint(this._shootables, this._aimPoint);
        this.player.heldWeapon.update(dt, this.player, this._aimPoint);
      }
      this.pulseTool.setMuzzle(this.camera.isFirstPerson ? this.weapon.muzzle : this.player.heldWeapon.muzzle);

      // Pulse Tool — fire, raycast, animate bolt/flash, recharge energy.
      // Raycast list includes the monster's body + weak points (see _loadLevel).
      this.pulseTool.update(dt, this._shootables);
      if (this.gameState.currentLevel === 3 && !this._collapseActive) this.ui.setBossStatus(this.monster.weakPoints, this.monster.boss?.stage);
      this.audio.setRecharge(this.pulseTool.energy < this.pulseTool.maxEnergy && this.gameState.isPlaying);
      if (this.gameState.currentLevel === 2) this._updateHunt();
      // Feed the bolt's current position into its fading trail (Kutloano).
      if (this.pulseTool._boltActive) {
        this._pulseTrail.emit(this.pulseTool._bolt.position);
      }

      // Update energy bar HUD.
      this.ui.setEnergy(this.pulseTool.energy, this.pulseTool.maxEnergy, this.pulseTool._cooldownTimer > 0);

      // Collapse timer countdown (Level 3 escape sequence).
      // (The level-3 win trigger itself is handled by _checkWinTriggers below.)
      if (this._collapseActive) {
        this._updateCollapseTimer(dt);
      }

      // Check win triggers (player reached objective for this level).
      if (this.gameState.isPlaying) this._checkWinTriggers();

      // Door interaction: show the E-prompt near closed doors, open on E.
      this._updateDoorInteraction();

      // Update health bar HUD.
      this.ui.setHealth(this.playerHealth, this.playerMaxHealth);

    } else {
      // Still update camera so the menu background isn't frozen.
      this.camera.update(dt, this.player.position);
      // No rifle floating in the menu shot; no danger pulse either.
      this.weapon.setVisible(false);
      this.postfx.setDanger(0);
      // Clear stealth HUD when monster isn't active.
      this._clearStealthHUD();
      // No interact prompt outside gameplay.
      if (this._interactPromptEl) this._interactPromptEl.classList.remove('visible');
    }

    this.input.endFrame();
    this.postfx.render(dt);
    this._transitionNeedsRender = false;
  };

  // --- Level loading --------------------------------------------------------

  /**
   * Load a level: geometry (Person B), lighting (Person C), spawn player.
   * Called automatically on state transitions — Person B/C don't call this.
   * @param {number} levelNum 1, 2, or 3
   */
  _loadLevel(levelNum) {
    this.ui.reset();
    this.ui.setLevel(levelNum);
    this.shaders.clearLevelVisuals();
    this.postfx.resetFrameTiming();
    this.postfx.setLevel(levelNum);
    // 1. Build level geometry and physics (Person B's LevelManager).
    this.levels.load(levelNum);

    // 1b. Camera: clear view/aim offsets from the last level and pick up this
    //     level's occluders so the third-person camera sweeps around walls.
    this.camera.reset();
    this.camera.occluders = this.levels.occluders || [];

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

    // 5a. Level 2 opens unarmed: the sidearm waits in the staging-bay
    //     security locker (see _takeSidearm) — firing stays gated till then.
    this._weaponReady = levelNum !== 2;
    this.pulseTool.enabled = this._weaponReady;
    this.player.weaponStowed = !this._weaponReady;

    // Drop any latched ADS when a level (re)loads.
    this._adsToggled = false;

    // 5b. Switch the procedural ambience to this level's mood.
    this.audio.setLevel(levelNum);
    this.audio.stopRumble();
    this._lastBeepSec = -1;
    this._monsterSeen = false;

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
    this._mutateLight.intensity = 0; // standby until the mutation beat

    // 7. Reset collapse / escape state.
    this._collapseActive = false;
    this._collapseTime = 0;
    this._collapseVisualProgress = 0;
    this._escapeDoorOpen = false;
    this.ui.setHealth(this.playerHealth, this.playerMaxHealth);
    this.ui.setEnergy(this.pulseTool.energy, this.pulseTool.maxEnergy);

    // 8. Build the combined PulseTool raycast list: level targets plus the
    //    monster's body meshes (impact feedback on torso shots) and weak
    //    points (damage).
    for (const wp of this.monster.weakPoints) {
      // Exposed culture sacs are the efficient kill, so they are visible AND
      // shootable from the hunt (L2) onward. Level 1's cameo keeps them hidden.
      wp.visible = levelNum >= 2;
      wp.material.uniforms.uColor.value.setHex(levelNum === 3 ? 0x65e7f4 : 0xff3333);
      if (levelNum === 3) wp.material.uniforms.uColor.value.multiplyScalar(0.45);
    }
    this._shootables = this.levels.shootables.concat(this.monster.hitMeshes,
      levelNum >= 2 ? this.monster.weakPoints : []);

    // 9. Show this level's objective so the player knows what to do.
    const objectives = {
      1: 'ENGINEERING CALL: RESTORE AUXILIARY POWER IN LAB A-2 — PULSE THE AMBER RELAY',
      2: 'SECTOR B / TAKE THE PULSE SIDEARM FROM THE STAGING-BAY SECURITY LOCKER',
      3: 'SURFACE SEAL / DESTROY THREE CYAN NODES: CHEST AND BOTH SHOULDERS',
    };
    this._baseObjective = objectives[levelNum] || '';
    this._setObjective(this._baseObjective);
    if (levelNum === 1) this._announce('dispatch');
    // Level 2 opens with the 'breach' PA inside its staged briefing
    // (_l2Opening); the failsafe/demolition chain now starts at Level 3.
    if (levelNum === 3) this._announce('failsafe');

    // 10. Level 1 runs the controls tutorial (hints only — no gating).
    if (levelNum === 1) {
      this._tut = {
        step: 0, timer: 0,
        startX: sp.x, startZ: sp.z,
        moved: false, fired: false, hit: false, doorOpened: false,
      };
      this._showTutorialStep(0);
    } else {
      this._tut = null;
      if (levelNum !== 3) this.ui.showTutorial(null);
    }

    // 11. Level 2 runs the breach briefing: the PA confirms what happened in
    //     Lab A-2, then the instructions point at the security locker. Beats
    //     only advance during 'playing' so the black transition hides none.
    this._l2Opening = levelNum === 2 ? {
      t: 0, step: 0,
      beats: [
        { at: 1.2, run: () => this._announce('breach') },
        { at: 7.5, run: () => this.ui.showTutorial({
          text: 'THE LAB A-2 CULTURE WENT WRONG — SOMETHING IS LOOSE IN SECTOR B',
          sub: 'It hunts by sight and sound. Keep your distance, stay behind solid cover.',
        }) },
        { at: 14.5, run: () => this.ui.showTutorial({
          text: 'ARM YOURSELF — SECURITY LOCKER, STAGING BAY WEST WALL',
          sub: 'Walk up to the open locker and press E to take the pulse sidearm.',
        }) },
        { at: 21.0, run: () => this.ui.showTutorial(null) },
      ],
    } : null;
  }

  /**
   * Update the objective: the HUD text (top-left corner) and the in-world
   * mission directive board mounted in the level.
   * @param {string} text
   */
  _setObjective(text) {
    this.ui.setObjective(text);
    this.levels.goalBoard?.setObjective(text);
  }

  _announce(name) {
    const announcement = PA_ANNOUNCEMENTS[name];
    if (!announcement) return;
    this.ui.showAnnouncement(announcement.text);
    // No spoken dialogue — the facility "speaks" through synthesized
    // reactor-station alert tones and sirens (see AudioManager.playAlert).
    this.audio.playAlert(name);
  }

  /**
   * Level 2 opening — the breach briefing. Staged text beats run while the
   * player keeps control: the PA confirms the containment breach, then the
   * instructions point at the security locker. Cleared once all beats fire.
   */
  _updateL2Opening(dt) {
    const seq = this._l2Opening;
    if (!seq || this.gameState.state !== 'playing') return;
    seq.t += dt;
    while (seq.step < seq.beats.length && seq.t >= seq.beats[seq.step].at) {
      seq.beats[seq.step].run();
      seq.step++;
    }
    if (seq.step >= seq.beats.length) this._l2Opening = null;
  }

  /**
   * Level 2 — the player takes the pulse sidearm from the staging-bay
   * security locker. Firing, the first-person rifle and the third-person
   * held weapon all unlock here; the hunt beat machine retakes the HUD.
   */
  _takeSidearm(pickup) {
    pickup.taken = true;
    if (pickup.mesh) pickup.mesh.visible = false;
    if (pickup.light) pickup.light.intensity = 0; // dim, never hide (recompile)
    this._weaponReady = true;
    this.pulseTool.enabled = true;
    this.player.weaponStowed = false;
    this.audio.play('clang');
    this.ui.showPickup('PULSE SIDEARM ACQUIRED — LMB / F TO FIRE');
    this._huntBeat = ''; // let the hunt beat machine retake the objective
  }

  /** Brief crosshair hit-marker flash on landed shots (CSS-driven). */
  _flashHitMarker() {
    this.ui.flashHit();
  }

  /**
   * Door interaction — press E near a closed, unlocked door to open it
   * (no shooting required). Locked doors (the L3 failsafe seal) are skipped:
   * they open through the scripted boss-death flow only.
   */
  _updateDoorInteraction() {
    // Level 2: the staging-bay weapons locker shares the E-prompt.
    const pickup = this.levels.weaponPickup;
    let pickupNear = false;
    if (pickup && !pickup.taken) {
      const pdx = this.player.position.x - pickup.x;
      const pdz = this.player.position.z - pickup.z;
      pickupNear = pdx * pdx + pdz * pdz < pickup.radius * pickup.radius;
      if (pickupNear && this.input.justPressed('KeyE')) this._takeSidearm(pickup);
    }

    const doors = this.levels._doors;
    let near = null;
    for (const door of doors) {
      if (door.opening || door.locked) continue;
      const dx = this.player.position.x - door.mesh.position.x;
      const dz = this.player.position.z - door.mesh.position.z;
      if (dx * dx + dz * dz < 6.25) { // 2.5 m reach
        near = door;
        break;
      }
    }

    if (this._interactPromptEl) {
      this._interactPromptEl.classList.toggle('visible', !!near || pickupNear);
      const prompt = near && near.id === 'l1-exit'
        ? '[ E ] RELEASE BYPASS DOOR' : '[ E ] OPEN DOOR';
      this._interactPromptEl.textContent = near || !pickupNear
        ? prompt : '[ E ] TAKE PULSE SIDEARM';
    }

    if (near && this.input.justPressed('KeyE')) {
      this.levels.openDoor(near.id);
      this.audio.play('doorOpen');
      if (this._tut) this._tut.doorOpened = true;
      // Level 1 ends past the bypass door: releasing it opens the way into the
      // surface-lift lobby where the win zone sits.
      if (near.id === 'l1-exit') {
        this._setObjective('BYPASS RELEASED / STEP THROUGH TO THE SURFACE LIFT');
        this.ui.showAnnouncement('Bypass released. Surface lift lobby open — step through to transfer.');
      }
    }
  }

  /**
   * Configure and spawn the monster for a given level.
   * Level 1: scripted cameo only — the scientist mutates, creature flees.
   * Level 2: monster hunts the player through damaged corridors.
   * Level 3: boss fight in the arena.
   * @param {number} levelNum
   */
  _setupMonster(levelNum) {
    this._parkServerMonster();
    const waypoints = this.levels.monsterWaypoints;
    this.monster.awareness = null;
    this.monster.boss = null;
    this.monster._chargeGuide.visible = false;
    this.monster._aura.color.setHex(0xff2a14);
    this.monster._aura.intensity = 7;
    this.monster.patrolSpeed = 2;
    this.monster.attackCooldown = 1.5;
    this.monster.model.scale.setScalar(this.monster._modelScale);
    this.monster.setNavigationObstacles([], null);
    switch (levelNum) {
      case 1:
        // Scripted cameo only: the exposed scientist mutates into the
        // creature, which flees into the ducts (see _updateL1Reveal).
        this.monster.spawn(0, -50, 0);      // parked out of play
        this.monster.setPatrolWaypoints([]);
        this.monster.setOccluders(this.levels.occluders);
        this.monster.detectionRange = 0;    // can never detect the player
        this.monster.setActive(false);
        this._l1Reveal = new LabOpening(phase => this._onLabPhase(phase));
        return;
      case 2:
        this.monster.awareness = new HuntAwareness(1.0, 2.75);
        this._huntBeat = '';
        this._huntPressureWasReleased = false;
        // Stealth: sweeps the damaged facility between the rebuilt waypoints.
        this.monster.spawn(-4.8, 0.65, -21);
        if (waypoints.length > 0) {
          this.monster.setPatrolWaypoints(
            waypoints.map(wp => ({ x: wp.x, y: 0, z: wp.z }))
          );
        }
        // Pass level occluders (walls, lockers, tall cover) for LOS raycasts.
        this.monster.setOccluders(this.levels.occluders);
        // Tuning: harder to spot player, gives time to hide.
        this.monster.detectionRange = 10;  // narrower than L1
        this.monster.escapeTimeout = 2.75;
        this.monster.patrolSpeed = 1.65;
        this.monster.chaseSpeed = 4.3;
        this.monster.attackDamage = 15;
        this.monster.attackCooldown = 1.8;
        // It dies to aimed sac shots or a slower stream of body shots.
        this.monster.bodyShotsPerNode = 2;
        this._refreshHuntNavigation();
        break;
      case 3:
        this._bossIntroAnnounced = false;
        this.monster.boss = new BossEncounter(stage => this.monster._emit('bossCue', stage));
        // Boss fight — arena-wide detection, never gives up the chase.
        this.monster.spawn(0, 2, -25);
        if (waypoints.length > 0) {
          this.monster.setPatrolWaypoints(
            waypoints.map(wp => ({ x: wp.x, y: 0, z: wp.z }))
          );
        }
        this.monster.setOccluders(this.levels.occluders);
        this.monster.setNavigationObstacles(
          this.levels._disposables.map(entry => entry.body).filter(Boolean),
          this.levels.navigationBounds
        );
        this.monster.detectionRange = 25;  // arena-wide detection
        this.monster.escapeTimeout = 999;  // never gives up chase in boss fight
        this.monster.chaseSpeed = 4.6;
        this.monster.attackDamage = 22;
        this.monster.bodyShotsPerNode = 3; // the boss absorbs more punishment
        this.ui.showTutorial({ text: 'CHEST + BOTH SHOULDERS / SHOOT THE CYAN NODES', sub: 'An amber line warns of a charge. Sidestep it, then aim during recovery.' });
        break;
    }
    this.monster.setActive(true);
  }

  /** The player's successful repair starts the containment failure. */
  _repairLabPower(target) {
    const opening = this._l1Reveal;
    if (this.gameState.currentLevel !== 1 || !opening || opening.repaired) return;
    if (!opening.entered) {
      this._setObjective('ENTER LAB A-2 FIRST / THEN PULSE THE AMBER RELAY');
      return;
    }
    if (opening.repair()) {
      target.material.color.setHex(0x87efc5);
      target.material.emissive.setHex(0x46dfaa);
    }
  }

  _onLabPhase(phase) {
    const reveal = this.levels.scriptedReveal;
    this.levels.labChamber?.setPhase(phase);
    if (phase === 'powering') {
      this.ui.showTutorial(null);
      this._tut = null;
      this.audio.play('beep');
      this._announce('power');
      this._setObjective('POWER RESTORED / CONTAINMENT SYSTEM RESTARTING');
    } else if (phase === 'alarm') {
      this.levels.labEmergency = true;
      this.shaders.setLabEmergency(true);
      this._scientistState.mode = 'cower';
      this._mutateLight.position.set(reveal.spawn.x, 1.3, reveal.spawn.z);
      this._mutateLight.intensity = 2;
      this.camera.shake(0.25);
      this.audio.play('alarm');
      // The alarm empties the station: staff walkers bolt for the entrance.
      this.levels.evacuateWalkers();
      this._announce('breach');
      this._setObjective('CONTAINMENT FAILURE / STAY CLEAR OF THE CHAMBER');
    } else if (phase === 'mutate') {
      this._scientistState.mode = 'mutate';
      this.audio.play('glassBreak');
      this.audio.play('transform');
      this.audio.duck(0.6);
      this.camera.shake(0.45);
      this._setObjective('BIOLOGICAL EXPOSURE / GET AWAY FROM THE SCIENTIST');
    } else if (phase === 'burst') {
      this._scientist.group.visible = false;
      this.monster.spawn(reveal.spawn.x, reveal.spawn.y, reveal.spawn.z);
      for (const wp of this.monster.weakPoints) wp.visible = false;
      this.monster.setPatrolWaypoints([]);
      this.monster.setActive(true);
      this.monster.model.scale.setScalar(0.6 * this.monster._modelScale);
      this.monster.model.rotation.y = Math.atan2(this.player.position.x - reveal.spawn.x, this.player.position.z - reveal.spawn.z);
      this.audio.play('roar');
      this.audio.duck(0.65);
      this.camera.shake(0.45);
    } else if (phase === 'flee') {
      this.monster.model.scale.setScalar(this.monster._modelScale);
      this.monster.patrolSpeed = 3.2;
      this.monster.setPatrolWaypoints(reveal.escape.map(point => ({ x: point.x, y: 0, z: point.z })));
      this.levels.openDoor('l1-lab');
      for (const guide of this.levels.labRoute) guide.visible = true;
      this._baseObjective = 'REACH THE CONTROL ROOM / FOLLOW THE GREEN ROUTE AND KEEP LEFT OF THE REACTOR';
      this._setObjective(this._baseObjective);
      this._announce('bypass');
    } else if (phase === 'done') {
      this.monster.setActive(false);
      this.monster.model.scale.setScalar(this.monster._modelScale);
      this.monster.body.position.set(0, -50, 0);
      this.monster.patrolSpeed = 2;
      this._mutateLight.intensity = 0;
      this._setObjective(this._baseObjective);
    }
  }

  /** Play the opening while leaving movement/camera control with the player. */
  _updateL1Reveal(dt) {
    const reveal = this.levels.scriptedReveal;
    const opening = this._l1Reveal;
    if (!reveal || !opening) return;
    if (!opening.entered) {
      const dx = this.player.position.x - reveal.trigger.x;
      const dz = this.player.position.z - reveal.trigger.z;
      if (dx * dx + dz * dz < reveal.trigger.radius * reveal.trigger.radius && opening.enter()) {
        this._setObjective('RESTORE AUXILIARY POWER / PULSE THE AMBER RELAY BESIDE THE CHAMBER');
      }
    }
    opening.update(dt);
    this.levels.labChamber?.update(dt);
    if (['alarm', 'mutate', 'burst'].includes(opening.phase)) {
      this._mutateLight.intensity = 3 + Math.sin(opening.timer * 4) * 0.8;
      const scientist = this._scientist.group;
      const target = Math.atan2(this.player.position.x - scientist.position.x, this.player.position.z - scientist.position.z);
      scientist.rotation.y += Math.atan2(Math.sin(target - scientist.rotation.y), Math.cos(target - scientist.rotation.y)) * Math.min(1, dt * 4);
    }
    if (opening.phase === 'burst') this.monster.model.scale.setScalar(this.monster._modelScale * (0.6 + 0.4 * Math.min(1, opening.timer / 0.7)));
    if (opening.phase === 'flee') {
      this._mutateLight.intensity = Math.max(0, 2 - opening.timer);
      const end = reveal.escape[reveal.escape.length - 1];
      if (opening.timer > 1.2 && Math.hypot(this.monster.position.x - end.x, this.monster.position.z - end.z) < 1.5) opening.finishEscape();
    }
  }

  /**
   * Show a tutorial step (text + sub-line) in the bottom-centre hint.
   * @param {number} i step index
   */
  _showTutorialStep(i) {
    const step = this._tutorialSteps[i];
    if (step) this.ui.showTutorial(step);
  }

  /**
   * Drive the Level-1 controls tutorial. Steps advance in order once their
   * goal is met (walked 6 m → fired the pulse tool → hit a glowing panel),
   * with a minimum display time so hints never cascade in a single frame.
   * @param {number} dt
   */
  _updateTutorial(dt) {
    const tut = this._tut;
    if (!tut) return;
    tut.timer += dt;

    // Step 0 goal: player has walked a few metres from the spawn point.
    if (!tut.moved) {
      const dx = this.player.position.x - tut.startX;
      const dz = this.player.position.z - tut.startZ;
      if (dx * dx + dz * dz > 36) tut.moved = true;
    }

    const complete =
      (tut.step === 0 && tut.moved) ||
      (tut.step === 1 && tut.fired) ||
      (tut.step === 2 && (tut.hit || tut.doorOpened)) ||
      (tut.step === 3 && tut.timer > 6); // listen-hint lingers, then fades

    if (complete && tut.timer > 1.6) {
      tut.step++;
      tut.timer = 0;
      if (tut.step < this._tutorialSteps.length) {
        this._showTutorialStep(tut.step);
      } else {
        this.ui.showTutorial(null);
        this._tut = null;
      }
    }
  }

  /**
   * Update the stealth HUD overlay: vignette, warning, hidden indicator.
   * Called every frame while monster is active. Zero allocation — reads
   * monster getters and sets CSS properties directly.
   */
  _updateStealthHUD() {
    const m = this._selectThreatMonster();
    const threat = m.threatLevel;      // 0..1 proximity
    const seeing = m.canSeePlayer;     // LOS to player
    const chasing = m.state === 'chase' || m.state === 'attack';

    const awareness = m.awareness;
    const mode = awareness ? (chasing ? awareness.searching ? 'searching' : 'detected'
      : awareness.exposure > 0 ? 'exposed' : !seeing && threat > 0.1 ? 'hidden' : '') : '';
    this.ui.setStealth(threat, seeing, this.gameState.currentLevel === 3 ? false : chasing, mode, awareness?.exposure || 0);
  }

  _refreshHuntNavigation() {
    this.monster.setNavigationObstacles(
      this.levels._disposables.map(entry => entry.body).filter(body => body && this.physics.world.bodies.includes(body)),
      this.levels.navigationBounds
    );
    this.serverMonster.setNavigationGrid(this.monster.navigationGrid);
    this._huntNavVersion = this.levels.navigationVersion;
  }

  _parkServerMonster() {
    this._serverAmbush = null;
    this._serverAwareness = null;
    this.serverMonster.awareness = null;
    this.serverMonster.setActive(false);
    this.serverMonster.spawn(0, -50, 0);
    this.serverMonster.body.aabbNeedsUpdate = true;
    this.physics.world.broadphase.dirty = true;
    this.serverMonster.setNavigationGrid(null);
  }

  _prepareServerMonster() {
    const spawn = this.levels.serverAmbush;
    this._serverAmbush = new ServerAmbush(spawn.triggerZ);
    const monster = this.serverMonster;
    this._serverAwareness = new HuntAwareness(0.25, 5);
    monster.awareness = null;
    monster.spawn(spawn.x, spawn.y, spawn.z);
    monster.model.rotation.y = 0;
    monster.setPatrolWaypoints([]);
    monster.setOccluders(this.levels.occluders);
    monster.detectionRange = 0;
    monster.patrolSpeed = 2.2;
    monster.chaseSpeed = 5.6;
    monster.attackDamage = 16;
    monster.attackCooldown = 1.8;
    monster._aura.color.setHex(0xff984f);
    monster._aura.intensity = 4;
    for (const wp of monster.weakPoints) wp.visible = false;
    monster.setActive(true);
    this._shootables.push(...monster.hitMeshes);
  }

  _updateServerAmbush(dt) {
    const ambush = this._serverAmbush;
    if (!ambush) return;
    const door = this.levels._doors.find(entry => entry.id === 'l2-pressure');
    const before = ambush.stage;
    ambush.update(dt, door.progress, this.player.position.z);
    // Until the reveal, both perception and movement stay quiet.
    this.serverMonster.awareness = ambush.stage === 'chasing' ? this._serverAwareness : null;
    if (ambush.stage === 'warning' && before !== 'warning') {
      this.audio.play('roar');
      this.camera.shake(0.25);
      this.ui.showAnnouncement('Second entity detected in the archive. Evacuate to core access.');
      this.ui.showTutorial({ text: 'SECOND CREATURE / RELEASE C AND HOLD SHIFT TO RUN', sub: 'Follow the green signs through the server room to the escape beacon.' });
    }
    if (ambush.stage === 'chasing' && before !== 'chasing') {
      this.serverMonster.awareness = this._serverAwareness;
      this.serverMonster.awareness.hear(this.player.position.x, this.player.position.z);
      this.serverMonster.detectionRange = 14;
    }
  }

  _selectThreatMonster() {
    const primary = this.monster;
    const second = this.serverMonster;
    if (!second.isActive || this._serverAmbush?.stage !== 'chasing') return primary;
    const primaryScore = (primary.isActive ? primary.threatLevel : -1)
      + (primary.canSeePlayer && (primary.state === 'chase' || primary.state === 'attack') ? 2 : 0);
    const secondScore = second.threatLevel
      + (second.canSeePlayer && (second.state === 'chase' || second.state === 'attack') ? 2 : 0);
    return secondScore > primaryScore ? second : primary;
  }

  _updateHealthPacks(dt) {
    this.camera.camera.getWorldPosition(this._camPosVec);
    for (const pack of this.levels.healthPacks) {
      pack.update(dt, this._camPosVec);
      const restored = pack.collect(this.player.position, this.playerHealth, this.playerMaxHealth);
      if (restored > 0) {
        this.playerHealth += restored;
        this.audio.play('heal');
        this.ui.showPickup(`FIRST AID +${restored} / HEALTH ${this.playerHealth}%`);
      }
    }
  }

  /** Local goals and breathing spaces keep the hunt readable. */
  _updateHunt() {
    // Unarmed: hold the arm-up objective until the sidearm is taken.
    if (!this._weaponReady) {
      this._setObjective('SECTOR B / TAKE THE PULSE SIDEARM FROM THE STAGING-BAY SECURITY LOCKER');
      return;
    }
    const z = this.player.position.z;
    const released = this.levels.pressureReleased;
    if (released && !this._huntPressureWasReleased) {
      this._huntPressureWasReleased = true;
      this.audio.play('doorOpen');
      this.ui.showAnnouncement('Pressure isolated. Server-room bypass released. Follow green evacuation signs.');
      this._prepareServerMonster();
    }
    let isolated = 0;
    for (const vent of this.levels._steamVents) {
      if ((vent.id === 'l2-vent-2' || vent.id === 'l2-vent-3') && !vent.active) isolated++;
    }
    const entryOpen = this.levels._doors.find(door => door.id === 'l2-entry').opening;
    const ambushStarted = this._serverAmbush && this._serverAmbush.stage !== 'waiting';
    const beat = ambushStarted ? z > -52 ? 'ambush' : 'transfer'
      : !entryOpen ? 'entry' : z > -18 ? 'approach' : z > -30 ? 'quarters'
      : !released ? `pressure-${isolated}` : z > -40 ? 'bypass' : z > -52 ? 'servers' : 'transfer';
    if (beat === this._huntBeat) return;
    const goals = {
      entry: 'SECTOR B / PULSE THE BLUE DOOR RELAY',
      approach: 'CREW QUARTERS AHEAD / CROUCH WITH C AND WATCH THE PATROL',
      quarters: 'CROSS THE CREW QUARTERS / USE LOCKERS TO BREAK LINE OF SIGHT',
      'pressure-0': 'PRESSURE LOCK / ISOLATE BOTH AMBER VALVES (0/2)',
      'pressure-1': 'PRESSURE LOCK / ISOLATE THE REMAINING AMBER VALVE (1/2)',
      bypass: 'PRESSURE ISOLATED / CONTINUE THROUGH THE SERVER-ROOM BYPASS',
      servers: 'SERVER ROOM / USE THE RACKS AS COVER AND FOLLOW GREEN EXIT SIGNS',
      ambush: 'SECOND ENTITY / HOLD SHIFT AND FOLLOW THE GREEN ROUTE TO CORE ACCESS',
      transfer: 'EVACUATION TRANSFER / REACH CORE ACCESS AT THE GREEN BEACON',
    };
    this._huntBeat = beat;
    this._baseObjective = goals[beat];
    this._setObjective(this._baseObjective);
    if (beat !== 'ambush') this.ui.showTutorial(['approach', 'quarters'].includes(beat)
      ? { text: 'C: CROUCH / BREAK SIGHT BEHIND SOLID COVER', sub: 'Walk near green first-aid cases to heal. Shots attract the creature.' } : null);
    if (beat === 'servers') this.ui.showAnnouncement('Surface lift offline. Evacuation rerouted through containment. Culture archive retained.');
  }

  /** Reset all stealth HUD elements to their hidden/inactive state. */
  _clearStealthHUD() {
    this.ui.setStealth(0, false, false);
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
    this._collapseVisualProgress = 0.15;
    this.shaders.setDissolveAmount(this._collapseVisualProgress);
    this.levels.revealEscapeRoute();
    this.ui.setBossStatus(null);

    // Open the exit door (remove physics body + hide mesh).
    if (this.levels._exitDoor) {
      this.levels._exitDoor.visible = false;
      const occluderIndex = this.levels.occluders.indexOf(this.levels._exitDoor);
      if (occluderIndex >= 0) this.levels.occluders.splice(occluderIndex, 1);
      // Remove the door's physics body so player can walk through.
      const idx = this.levels._disposables.findIndex(
        d => d.mesh === this.levels._exitDoor
      );
      if (idx >= 0 && this.levels._disposables[idx].body) {
        this.physics.removeBody(this.levels._disposables[idx].body);
        this.levels._disposables[idx].body = null;
      }
    }

    // Show the collapse timer HUD.
    this.ui.setCountdown(this._collapseTime, true);
    this._announce('demolition');

    // Screen shake for dramatic effect.
    this.camera.shake(0.5);

    // Collapse ambience: sustained structural rumble + flickering lights.
    this.audio.play('collapse');
    this.audio.duck(0.65);
    this.levels.collapseMode = true; // fixtures now stutter constantly
    this._lastBeepSec = -1;

    // Hide boss phase indicator.
    this.ui.setBossPhase(0, true);

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
    const escapeProgress = THREE.MathUtils.clamp((-this.player.position.z - 40) / 17, 0, 1) * 0.85;
    this._collapseVisualProgress = Math.max(this._collapseVisualProgress, progress, escapeProgress);
    this.shaders.setDissolveAmount(this._collapseVisualProgress);

    // Update HUD.
    this.ui.setCountdown(this._collapseTime, true);

    // Intensify screen shake as time runs out.
    if (this._collapseTime < 30 && this._collapseTime > 0) {
      const intensity = (1 - this._collapseTime / 30) * 0.15;
      this.camera.shake(intensity);
    }

    // Countdown beeps in the last 10 seconds — higher and faster under 5 s.
    const secsLeft = Math.max(0, Math.ceil(this._collapseTime));
    if (secsLeft > 0 && secsLeft <= 10 && secsLeft !== this._lastBeepSec) {
      this._lastBeepSec = secsLeft;
      this.audio.play('beep', secsLeft <= 5);
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
