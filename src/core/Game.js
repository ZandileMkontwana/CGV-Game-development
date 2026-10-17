import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import InputManager from './InputManager.js';
import PhysicsWorld from './PhysicsWorld.js';
import PlayerController from './PlayerController.js';
import CameraController from './CameraController.js';
import GameState from './GameState.js';
import LevelManager from '../levels/LevelManager.js';
import ShaderManager from '../shaders/ShaderManager.js';
import { updateCrt } from '../shaders/SurfaceShading.js';
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
import { ESCAPE_CHECKPOINTS } from './MissionProgress.js';
import WeaponViewmodel from './WeaponViewmodel.js';

/**
 * Game — top-level orchestrator.
 *
 * Creates the Three.js renderer, scene, and all core subsystems.
 * Runs the animation loop and delegates per-frame updates to each system.
 * Level content (Person B), shaders (Person C) and UI/sound (Person D)
 * plug into the hooks marked with TODO comments.
 */
/**
 * Reflection environment for the metal surfaces: a dark hall lit by rows of
 * fluorescent strips plus one warm warning panel. (Cube-map idea from the
 * Textures notes: PMREMGenerator bakes this scene into a prefiltered cube map
 * that every PBR material samples for reflections.) Values above 1.0 are
 * deliberate HDR highlights.
 */
function buildReactorEnvironment() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(
    new THREE.BoxGeometry(24, 9, 48),
    new THREE.MeshBasicMaterial({ color: 0x20272e, side: THREE.BackSide })
  ));
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe4f0ff).multiplyScalar(14) });
  for (let z = -20; z <= 20; z += 5) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 3), lampMat);
    lamp.position.set(0, 4.3, z);
    env.add(lamp);
  }
  const warn = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 1.2, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a2a).multiplyScalar(4) })
  );
  warn.position.set(11.8, 2.0, -6);
  env.add(warn);
  return env;
}

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
    this.scene.environment = pmrem.fromScene(buildReactorEnvironment(), 0.02).texture;
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
    this.levels.onModelPlaced = model => {
      if (this.levels.labPower) this.shaders.labPowerLighting.apply(model);
    };

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

    // The trained pulse tool remains available throughout the campaign.
    this._weaponReady = true;
    this._l2Opening = null;

    // Aim-down-sights toggle: the player can latch ADS on/off with a key
    // (Z) so they don't have to hold right-mouse. Reset on every level load.
    this._adsToggled = false;

    // Level 1 tutorial — contextual walkthrough (see _updateTutorial).
    this._tutorialEl = document.getElementById('tutorial');
    this._tutorialTextEl = document.getElementById('tutorial-text');
    this._tutorialSubEl = document.getElementById('tutorial-sub');
    // Zone/event-gated hints that guide the player through Level 1.
    // trigger: 'spawn' | 'zone' | 'event' | 'reveal' | 'door'
    // dismiss: 'walk' | 'event' | 'door' | 'zone' | 'reveal'
    this._l1Tutorial = [
      {
        text: 'WASD — MOVE   ·   SHIFT — SPRINT   ·   SPACE — JUMP',
        sub: 'MOUSE — LOOK   ·   V — TOGGLE FIRST/THIRD PERSON',
        trigger: 'spawn', dismiss: 'walk', dismissDist: 4,
      },
      {
        text: 'LEFT CLICK / F — FIRE THE PULSE TOOL',
        sub: 'HOLD RMB OR TAP Z TO SCOPE IN · ENERGY RECHARGES ON ITS OWN',
      },
      {
        text: 'GOOD — MOVE THROUGH THE DOOR',
        sub: 'FOLLOW THE CORRIDOR TO THE TRAINING HUB',
        trigger: 'door', triggerDoor: 'tr-a', dismiss: 'zone', dismissZ: -9,
      },
      {
        text: 'FINISH BOTH ROOMS TO OPEN THE GATE',
        sub: 'WEST — JUMP ROOM   ·   EAST — SHOOT ROOM',
        trigger: 'zone', triggerZ: -13, dismiss: 'zone', dismissXOut: 5,
      },
      {
        text: 'SPACE — JUMP OVER THE HURDLES',
        sub: 'SHOOT THE PANEL IN THE CHAMBER',
        trigger: 'zone', triggerXLess: -9, triggerZRange: [-16, -22],
        dismiss: 'event', dismissEvent: 'relayJump',
      },
      {
        text: 'THE GATE IS OPEN — MOVE THROUGH',
        sub: 'FOLLOW THE MARKERS TO RECEPTION',
        trigger: 'event', triggerEvent: 'allTrainingDone', dismiss: 'zone',
        dismissZ: -27,
      },
      {
        text: 'LOOK FOR THE LABORATORY',
        sub: 'SHOOT GLOWING PANELS TO INTERACT',
        trigger: 'zone', triggerZ: -37, dismiss: 'zone', dismissZ: -44,
      },
      {
        text: 'RESTORE AUXILIARY POWER IN LAB A-2',
        sub: 'PULSE THE AMBER RELAY BESIDE THE SCIENTIST',
        trigger: 'zone', triggerZ: -54, dismiss: 'reveal',
        dismissRevealPhase: 'mutate',
      },
      {
        text: 'THE CREATURE IS LOOSE — GET OUT OF THE LAB',
        sub: 'HIDE BEHIND COVER IF IT GETS CLOSE',
        trigger: 'reveal', triggerRevealPhase: 'burst', dismiss: 'zone',
        dismissZ: -66,
      },
      {
        text: 'MOVE THROUGH — FIND THE EXIT',
        sub: 'LISTEN — GROWLS MEAN IT IS NEAR',
        trigger: 'door', triggerDoor: 'l1-lab', dismiss: 'zone', dismissZ: -66,
      },
      {
        text: 'REACH THE CONTROL ROOM',
        sub: 'THE EXIT IS BEYOND THE REACTOR HALL',
        trigger: 'zone', triggerZ: -73, dismiss: 'zone', dismissZ: -88,
      },
      {
        text: 'FIND THE EXIT DOOR',
        sub: 'COMPLETE THE LEVEL',
        trigger: 'zone', triggerZ: -88, dismiss: 'zone', dismissZ: -98,
      },
    ];
    this._tut = null;         // built per Level-1 load
    this._baseObjective = ''; // restored after scripted beats change it

    // --- Pre-level briefing overlay -----------------------------------------
    this._briefingActive = false;
    this._briefingOverlay = document.getElementById('briefing-overlay');
    this._briefingLevel = document.getElementById('briefing-level');
    this._briefingTitle = document.getElementById('briefing-title');
    this._briefingNarrative = document.getElementById('briefing-narrative');
    this._briefingObjList = document.getElementById('briefing-obj-list');
    this._btnBriefingBegin = document.getElementById('btn-briefing-begin');
    this._btnBriefingBegin?.addEventListener('click', () => this._dismissBriefing());
    window.addEventListener('keydown', (e) => {
      if (this._briefingActive) this._dismissBriefing();
    });
    this._briefings = {
      1: {
        title: 'WITNESS',
        narrative: [
          'You are the engineer on shift at the containment lab.',
          'Auxiliary power is offline. The scientist is waiting for repairs in Lab A-2.',
          'Complete the training wing, then pulse the amber relay in the laboratory to restore power.',
        ],
        objectives: [
          'Complete the training rooms to unlock the gate',
          'Navigate through Reception to the Laboratory',
          'Pulse the amber relay to restore auxiliary power',
          'Witness the scientist\u2019s mutation',
          'Survive the creature\u2019s emergence',
          'Find the exit through Maintenance',
        ],
      },
      2: {
        title: 'THE HUNT',
        narrative: [
          'The facility is in ruins. The creature is loose in the damaged corridors.',
          'It knows these halls better than you \u2014 but you have the pulse tool.',
          'Two scientists are trapped in medical. Their evacuation and the experiment records are your way through lockdown.',
        ],
        objectives: [
          'Pulse the blue entry relay, then the medical rescue relay west of crew quarters',
          'Stay near both scientists and escort them north through medical to green refuge',
          'Pulse both amber pressure valves to release the server-room bypass',
          'Restore east archive power; pulse the evidence terminal and stay inside its glowing floor outline',
          'Evade the creatures and reach the green core-access beacon',
        ],
      },
      3: {
        title: 'THE COLLAPSE',
        narrative: [
          'The automated failsafe protocol has activated.',
          'Emergency generators in the west pump gallery and east observation booth must be restored.',
          'The creature is already hunting. Restore power to expose its nodes, then defeat it and escape within 90 seconds.',
        ],
        objectives: [
          'Pulse both generator panels; avoid the moving pump arm and timed electrical floor',
          'Dodge the amber charge line and sweep ring; pulse cyan nodes during recovery',
          'Destroy all three nodes, one per recovery opening, to release the surface seal',
          'Follow green lights, detour east around rubble and avoid flashing ceiling-failure zones',
          'Reach the surface beacon before the 90-second escape countdown ends',
        ],
      },
    };

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
      if (target.userData.missionAction) this.levels.expansion?.activate(target.userData.missionAction, this.player.position);
      // The creature is killable from the hunt (L2) onward. Level 1's creature
      // is a scripted cameo — shots there must not cut the reveal short.
      const monsterHit = this.gameState.currentLevel >= 2 && this.monster.isActive;
      if (monsterHit && target.userData.pulseType === 'weakpoint') {
        // A shot into an exposed culture sac ruptures it outright.
        for (const wp of this.monster.weakPoints) {
          if (wp === target && !wp.userData.destroyed) {
            if (!this.monster.damageWeakPoint(wp)) break;
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
        // Tutorial: track when the lab door opens after the reveal.
        if (this._tut && target.userData.doorId === 'l1-lab') this._tut.labDoorOpen = true;
      }
      if (target.userData.ventId) {
        if (this.levels.disableVent(target.userData.ventId)) {
          target.material.color.setHex(0x8be6bc);
          target.material.emissive.setHex(0x47cfa0);
          this.audio.play('ventHiss');
        }
      }
      // Power-routing nodes: light up, fade in the linked room lights, and
      // possibly unlock a power-gated door (feedback comes back in `res`).
      if (target.userData.powerNode) {
        const res = this.levels._activatePowerNode(target.userData.powerNode.id);
        if (res) {
          this.audio.play('spark');
          this.audio.play('beep');
          // Tutorial: track training relay activations.
          if (this._tut) {
            const nodeId = target.userData.powerNode.id;
            if (nodeId === 'tr-relay-jump') this._tut.relayJump = true;
            if (nodeId === 'tr-relay-1' || nodeId === 'tr-relay-2' || nodeId === 'tr-relay-3') {
              this._tut.relayShootCount = (this._tut.relayShootCount || 0) + 1;
              if (this._tut.relayShootCount >= 3) this._tut.relayShoot = true;
            }
            // Check if all 4 training relays are done.
            if (this._tut.relayJump && this._tut.relayShoot) this._tut.allTrainingDone = true;
          }
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
      if (stage === 'windup' || stage === 'sweepWindup') this.audio.play('bossWindup');
      if (stage === 'pursuit' && !this._bossIntroAnnounced) {
        this._bossIntroAnnounced = true;
        this.audio.play('roar');
        this.ui.showAnnouncement(this.monster.boss.armed
          ? 'Entity approaching. Dodge amber attack warnings; pulse cyan nodes during recovery.'
          : 'Entity approaching! Keep moving and use cover. Restore both generators to disable its node shields.');
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
        // Fresh gameplay entry also silences any lingering escape alarm.
        this.audio.stopEasAlarm();
        this._loadLevel(reason === 'restart' ? this.gameState.currentLevel : 1);
      }
      if (newState === 'levelTransition') {
        // Build the next level NOW, behind the black transition overlay, so
        // the level-load shader warm-up stall never shows as a frozen frame.
        this._loadLevel(this.gameState.currentLevel);
        // The suspense cue covers only the stage-switch overlay.
        this.audio.playSuspense();
        this._transitionNeedsRender = true;
      }
      // The suspense cue is a menu / stage-switch sting only — it must never
      // bleed into actual gameplay, so cut it the moment play resumes.
      if (newState === 'playing') {
        this.audio.stopSuspense(0.4);
        // The recorded emergency-intercom broadcast opens Level 3 the instant
        // gameplay begins (not during the transition). Skipped on pause-resume.
        if (this.gameState.currentLevel === 3 && oldState !== 'paused') {
          this.audio.playClipSequence(['emergencyIntercom']);
          this.ui.showAnnouncement(PA_ANNOUNCEMENTS.failsafe.text);
          this.audio.startChaos();
          this.audio.setFireEmitters(this.levels._fires);
          // The reactor finally goes critical: detonate as Level 3 opens.
          this.audio.playExplosion();
        }
      }
      if (newState === 'gameover') {
        this.audio.play('gameover');
        this.audio.stopAmbient();
        this.audio.stopRumble();
        this.audio.stopChaos();
        this.audio.stopEasAlarm();
        this.audio.stopFireEmitters();
      }
      if (newState === 'victory' || newState === 'menu') {
        if (newState === 'victory') this.audio.play('win');
        this.audio.stopAmbient();
        this.audio.stopRumble();
        // The run is over — silence the escape alarm.
        this.audio.stopEasAlarm();
        // Victory keeps the collapse chaos running under the ending; only
        // returning to the menu finally silences it.
        if (newState === 'menu') {
          this.audio.stopChaos();
          this.audio.stopFireEmitters();
        }
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
      // The ending (victory screen + credits) is a DOM overlay over the torn-
      // down level, but the collapse chaos keeps sounding underneath it.
      if (this.gameState.state === 'victory' || this.gameState.state === 'credits') {
        this.audio.updateEnding(dt);
      }
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
      // Briefing overlay blocks all gameplay input until dismissed.
      if (this._briefingActive) {
        // Still render the scene behind the overlay, but block all gameplay.
        this.shaders.update(dt);
        this.input.endFrame();
        this.postfx.render(dt);
        return;
      }
      // Stance/aim from raw input — feeds both the player (move speed) and
      // the camera (FOV zoom, shoulder tighten, pivot height).
      // ADS can be HELD on right-mouse or LATCHED with the aim-toggle key.
      if (this.input.justPressed('KeyZ')) this._adsToggled = !this._adsToggled;
      const aiming = this.input.mouse.rightDown === true || this._adsToggled;
      const crouching = this.input.keys['KeyC'] === true;
      // Scoped view: aiming an armed weapon in first person pulls the eye to the
      // optic — heavy zoom + reticle overlay, and the viewmodel is swapped out.
      const scoped = aiming && this.camera.isFirstPerson && this._weaponReady;
      this.player.setStance(crouching, aiming);
      this.player.update(dt);
      this.physics.step(dt);
      this.player.refreshMovementState();
      this.camera.update(dt, this.player.position, {
        aiming,
        scoped,
        crouching,
        moving: this.player._charState.moving,
        sprinting: this.player._charState.sprinting,
        grounded: this.player._charState.grounded,
      });
      this.shaders.update(dt);
      updateCrt(dt);
      this.ui.update(dt);
      if (this.input.justPressed('KeyM')) this.ui.map.toggle();
      this.ui.map.update(dt, this.player.position, this.camera.yawObject.rotation.y);
      this._updateExpansion(dt);
      if (!this.gameState.isPlaying) { this.input.endFrame(); return; }
      this.levels.update(dt); // animate doors, steam vents, rotating hazards
      // Keep the Web Audio listener on the camera so each fire's PannerNode
      // tracks the player's heading (fires rise left/right, fade behind).
      this.camera.camera.getWorldPosition(this._camPosVec);
      this.camera.camera.getWorldDirection(this._fwdVec);
      this.audio.updateListener(this._camPosVec, this._fwdVec);
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
      // hidden while unarmed (Level 2 before the security-locker pickup) and
      // while scoped (the optic overlay replaces the viewmodel).
      this.weapon.setVisible(this.camera.isFirstPerson && this._weaponReady && !scoped);
      this.weapon.update(dt, {
        moving: this.player._charState.moving,
        sprinting: this.player._charState.sprinting,
        aiming,
      });
      this.ui.setScoped(scoped);

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
      if (this.gameState.currentLevel === 3 && !this._collapseActive) {
        const boss = this.monster.boss;
        const needsPower = !boss.armed && ['waiting', 'pursuit', 'recover'].includes(boss.stage);
        this.ui.setBossStatus(this.monster.weakPoints, needsPower ? 'power'
          : boss.stage === 'recover' && !boss.vulnerable ? 'shielded' : boss.stage);
      }
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
    this.ui.map.setLevel(this.levels);

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
    this._resetPulseTool(levelNum);
    this._expansionBeat = '';

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
      this._scientistState.mode = 'idle';
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
      2: 'SECTOR B / PULSE THE BLUE DOOR RELAY — LMB / F TO FIRE',
      3: 'EMERGENCY POWER / START THE WEST AND EAST GENERATORS (0/2)',
    };
    this._baseObjective = objectives[levelNum] || '';
    this._setObjective(this._baseObjective);
    if (levelNum === 1) this._announce('dispatch');
    // Level 2's recorded sector briefing runs from _l2Opening; Level 3's
    // emergency-intercom broadcast is fired the moment its gameplay actually
    // begins (see the state-change handler), not under the transition overlay.

    // 10. Level 1 runs the contextual tutorial (zone/event-gated hints).
    if (levelNum === 1) {
      this._tut = {
        step: 0, timer: 0,
        startX: sp.x, startZ: sp.z,
        shown: new Set(), // track which steps have been shown
        fired: false, hit: false,
        relayJump: false, relayShoot: false, relayShootCount: 0,
        allTrainingDone: false, labDoorOpen: false,
        moved: false, doorOpened: false,
      };
      this._showTutorialStep(0);
    } else {
      this._tut = null;
      if (this._tutorialEl) this._tutorialEl.classList.remove('visible');
    }

    // 11. Show the pre-level briefing overlay (blocks input until dismissed).
    this._showBriefing(levelNum);

    // 11. Level 2 opens on the recorded sector briefing: the depressurization
    //     alert, then the reactor-isolation announcement; the isolation line
    //     replays once mid-level. The instructions then point at the security
    //     locker. Beats only advance during 'playing' so the black transition
    //     hides none of them.
    this._l2Opening = levelNum === 2 ? {
      t: 0, step: 0,
      beats: [
        { at: 0.3, run: () => {
          const starts = this.audio.playClipSequence(['depressurize', 'sectorIsolated']);
          this.ui.showAnnouncement(PA_ANNOUNCEMENTS.depressurize.text);
          // Swap the caption over when the isolation announcement begins.
          if (starts[1] != null) {
            setTimeout(() => this.ui.showAnnouncement(PA_ANNOUNCEMENTS.sectorIsolated.text),
              starts[1] * 1000);
          }
        } },
        { at: 7.5, run: () => this.ui.showTutorial({
          text: 'THE LAB A-2 CULTURE WENT WRONG — SOMETHING IS LOOSE IN SECTOR B',
          sub: 'It hunts by sight and sound. Keep your distance, stay behind solid cover.',
        }) },
        { at: 14.5, run: () => this.ui.showTutorial({
          text: 'ARM YOURSELF — SECURITY LOCKER, STAGING BAY WEST WALL',
          sub: 'Walk up to the open locker and press E to take the pulse sidearm.',
        }) },
        { at: 21.0, run: () => this.ui.showTutorial(null) },
        { at: 50.0, run: () => {
          // Mid-level: the sector announces re-isolation over the hunt.
          this.audio.playClipSequence(['sectorIsolated']);
          this.ui.showAnnouncement(PA_ANNOUNCEMENTS.sectorIsolated.text);
        } },
      ],
    } : null;
    this._rangeTutorialVisible = false;
    // Three's compile traverses hidden meshes too: prepare the scientist,
    // creature and rupture effects now rather than on the relay shot/reveal.
    this.shaders.configureLabPower(this.levels.labPower);
    this.postfx.prepareScene();
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
   * Level 2 opening — the sector briefing. The recorded depressurization alert
   * and reactor-isolation announcement play first (and the isolation line
   * replays mid-level), then the instructions point at the security locker.
   * Staged beats run while the player keeps control; cleared once all fire.
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
   * Reset ammunition and equip the trained tool on every level and retry.
   */
  _resetPulseTool(levelNum) {
    this.pulseTool.setLevel(levelNum);
    this._weaponReady = true;
    this.player.weaponStowed = false;
  }

  /** Brief crosshair hit-marker flash on landed shots (CSS-driven). */
  _flashHitMarker() {
    this.ui.flashHit();
  }

  /**
   * Door interaction — press E near a closed, unlocked door to open it
   * (no shooting required). Locked doors can show a hint, but only their
   * linked relay, puzzle or scripted event can release them.
   */
  _updateDoorInteraction() {
    const doors = this.levels._doors;
    let near = null;
    for (const door of doors) {
      if (door.opening || (door.locked && !door.lockedHint)) continue;
      const dx = this.player.position.x - door.mesh.position.x;
      const dz = this.player.position.z - door.mesh.position.z;
      if (dx * dx + dz * dz < 6.25) { // 2.5 m reach
        near = door;
        break;
      }
    }

    if (this._interactPromptEl) {
      this._interactPromptEl.classList.toggle('visible', !!near);
      const rescueBlocked = near?.id === 'l2-pressure' && this.levels.expansion?.canOpenPressure === false;
      const prompt = rescueBlocked ? 'ESCORT BOTH SCIENTISTS TO THE GREEN MEDICAL REFUGE' : near?.lockedHint || (near && near.id === 'l1-exit'
        ? '[ E ] RELEASE BYPASS DOOR' : '[ E ] OPEN DOOR');
      this._interactPromptEl.textContent = prompt;
    }

    if (near && !near.locked && this.input.justPressed('KeyE')) {
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
        this.monster.setNavigationObstacles(
          this.levels._disposables.map(entry => entry.body).filter(body => body?.world),
          this.levels.navigationBounds
        );
        this._l1NavVersion = this.levels.navigationVersion;
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
        this.monster.boss.armed = false;
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
        this.ui.showTutorial({ text: 'RESTORE EMERGENCY POWER / TWO GENERATORS', sub: 'West: pump gallery. East: observation booth. Pulse both amber panels; avoid the machinery and live floor.' });
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
      this.levels.labPower?.restore();
      this._scientistState.mode = 'type';
      this.ui.showTutorial(null);
      this._tut = null;
      this.audio.play('beep');
      this._announce('power');
      this._setObjective('AUXILIARY POWER RESTORED / CULTURE RESTARTING');
    } else if (phase === 'alarm') {
      this.levels.labPower?.emergency();
      this.levels.labEmergency = true;
      this.shaders.setLabEmergency(true);
      this._scientistState.mode = 'cower';
      this._mutateLight.position.set(reveal.spawn.x, 1.3, reveal.spawn.z);
      this._mutateLight.intensity = 2;
      this.camera.shake(0.25);
      this.audio.play('alarm');
      this.levels.alertWalkers();
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
      this.levels.evacuateWalkers(this.monster.position);
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
      // Monster stays active — it's now hunting the player through the facility.
      this.monster.model.scale.setScalar(this.monster._modelScale);
      this.monster.patrolSpeed = 2.5;
      this.monster.detectionRange = 18;   // can now detect the player
      this.monster.setPatrolWaypoints(this.levels.monsterWaypoints);
      this.monster.setOccluders(this.levels.occluders);
      this._mutateLight.intensity = 0;
      this._setObjective(this._baseObjective);
    }
  }

  /** Play the opening while leaving movement/camera control with the player. */
  _updateL1Reveal(dt) {
    const reveal = this.levels.scriptedReveal;
    const opening = this._l1Reveal;
    if (!reveal || !opening) return;
    this.levels.setWalkerThreat(this.monster.isActive && !this.monster.isDead ? this.monster.position : null);
    if (this._l1NavVersion !== this.levels.navigationVersion) {
      this.monster.setNavigationObstacles(
        this.levels._disposables.map(entry => entry.body).filter(body => body?.world),
        this.levels.navigationBounds
      );
      this._l1NavVersion = this.levels.navigationVersion;
    }
    if (!opening.entered) {
      const dx = this.player.position.x - reveal.trigger.x;
      const dz = this.player.position.z - reveal.trigger.z;
      if (dx * dx + dz * dz < reveal.trigger.radius * reveal.trigger.radius && opening.enter()) {
        this._setObjective('LAB A-2 POWER FAILURE / PULSE THE AMBER RELAY TO RESTORE LIGHTS AND EQUIPMENT');
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
    const step = this._l1Tutorial[i];
    if (!step || !this._tutorialEl) return;
    this._tutorialTextEl.textContent = step.text;
    this._tutorialSubEl.textContent = step.sub;
    this._tutorialEl.classList.add('visible');
    this._tut.shown.add(i);
  }

  /**
   * Drive the Level-1 contextual tutorial. Each step has a trigger condition
   * (zone entry, event, door state, reveal phase) and a dismiss condition.
   * Steps advance in order — the next hint only appears once the current one
   * is dismissed and the minimum display time has elapsed.
   * @param {number} dt
   */
  _updateTutorial(dt) {
    // The east room can be completed before the west room. Its lesson owns
    // the prompt while inside, independently of the corridor/jump hint order.
    const lesson = this.levels.shootingLesson;
    if (lesson) {
      lesson.update(dt, this.player.position);
      if (lesson.inside) {
        const message = lesson.message;
        if (message) {
          if (!this._tutorialEl.classList.contains('visible')
            || this._tutorialTextEl.textContent !== message.text
            || this._tutorialSubEl.textContent !== message.sub) this.ui.showTutorial(message);
        } else if (this._tutorialEl.classList.contains('visible')) this.ui.showTutorial(null);
        this._rangeTutorialVisible = !!message;
        return;
      }
      if (this._rangeTutorialVisible) {
        this.ui.showTutorial(null);
        this._rangeTutorialVisible = false;
      }
    }
    const tut = this._tut;
    if (!tut || !this._tutorialEl) return;
    tut.timer += dt;

    const px = this.player.position.x;
    const pz = this.player.position.z;

    // Skip already-completed relay steps (player may have done rooms
    // out of order). This handles the case where the player visits the shoot
    // room before the jump room or vice versa.
    while (tut.step < this._l1Tutorial.length) {
      const s = this._l1Tutorial[tut.step];
      // Skip jump room hint if already completed.
      if (s.dismissEvent === 'relayJump' && tut.relayJump) { tut.step++; tut.timer = 0; continue; }
      // Skip shoot room hint if already completed.
      if (s.dismissEvent === 'relayShoot' && tut.relayShoot) { tut.step++; tut.timer = 0; continue; }
      break;
    }

    const step = this._l1Tutorial[tut.step];
    if (!step) {
      // All steps done — hide the tutorial.
      this._tutorialEl.classList.remove('visible');
      this._tut = null;
      return;
    }

    // Check trigger condition.
    let triggerMet = false;
    if (step.trigger === 'spawn') {
      triggerMet = true;
    } else if (step.trigger === 'zone') {
      if (step.triggerZ !== undefined) {
        triggerMet = pz < step.triggerZ;
      } else if (step.triggerXLess !== undefined && step.triggerZRange) {
        triggerMet = px < step.triggerXLess && pz >= step.triggerZRange[1] && pz <= step.triggerZRange[0];
      } else if (step.triggerXMore !== undefined && step.triggerZRange) {
        triggerMet = px > step.triggerXMore && pz >= step.triggerZRange[1] && pz <= step.triggerZRange[0];
      }
    } else if (step.trigger === 'door') {
      const door = this.levels._doors.find(d => d.id === step.triggerDoor);
      triggerMet = door && door.opening;
    } else if (step.trigger === 'event') {
      triggerMet = !!tut[step.triggerEvent];
    } else if (step.trigger === 'reveal') {
      triggerMet = this._l1Reveal && this._l1Reveal.phase === step.triggerRevealPhase;
    }

    // If trigger not met yet, don't show this step (and don't advance).
    if (!triggerMet && !tut.shown.has(tut.step)) return;
    if (!triggerMet && (step.triggerXLess !== undefined || step.triggerXMore !== undefined)) {
      this._tutorialEl.classList.remove('visible');
      return;
    }

    // Show the step if it hasn't been shown yet.
    if (!tut.shown.has(tut.step) || !this._tutorialEl.classList.contains('visible')
      || this._tutorialTextEl.textContent !== step.text) {
      this._showTutorialStep(tut.step);
    }

    // Check dismiss condition.
    let dismissed = false;
    if (step.dismiss === 'walk') {
      const dx = px - tut.startX;
      const dz = pz - tut.startZ;
      dismissed = (dx * dx + dz * dz) >= (step.dismissDist * step.dismissDist);
    } else if (step.dismiss === 'event') {
      dismissed = !!tut[step.dismissEvent];
    } else if (step.dismiss === 'zone') {
      if (step.dismissZ !== undefined) {
        dismissed = pz < step.dismissZ;
      } else if (step.dismissXOut !== undefined) {
        dismissed = Math.abs(px) > step.dismissXOut;
      }
    } else if (step.dismiss === 'door') {
      const door = this.levels._doors.find(d => d.id === step.dismissDoor);
      dismissed = door && door.opening;
    } else if (step.dismiss === 'reveal') {
      dismissed = this._l1Reveal && this._l1Reveal.phase === step.dismissRevealPhase;
    }

    // Advance to next step once dismissed and minimum display time elapsed.
    if (dismissed && tut.timer > 1.6) {
      tut.step++;
      tut.timer = 0;
      this._tutorialEl.classList.remove('visible');
      if (tut.step >= this._l1Tutorial.length) this._tut = null;
    }
  }

  /**
   * Show the pre-level briefing overlay for the given level number.
   * Populates the title, narrative paragraphs, and objective list from
   * the _briefings data. Blocks player input until dismissed.
   * @param {number} levelNum
   */
  _showBriefing(levelNum) {
    const data = this._briefings[levelNum];
    if (!data || !this._briefingOverlay) return;
    this._briefingActive = true;
    if (this._briefingLevel) this._briefingLevel.textContent = `LEVEL ${levelNum}`;
    if (this._briefingTitle) this._briefingTitle.textContent = data.title;
    if (this._briefingNarrative) {
      this._briefingNarrative.innerHTML = '';
      for (const line of data.narrative) {
        const p = document.createElement('p');
        p.textContent = line;
        this._briefingNarrative.appendChild(p);
      }
    }
    if (this._briefingObjList) {
      this._briefingObjList.innerHTML = '';
      for (const obj of data.objectives) {
        const li = document.createElement('li');
        li.textContent = obj;
        this._briefingObjList.appendChild(li);
      }
    }
    this._briefingOverlay.style.display = 'flex';
  }

  /**
   * Dismiss the briefing overlay and resume player input.
   * Requests pointer lock so the player can immediately look around.
   */
  _dismissBriefing() {
    if (!this._briefingActive) return;
    this._briefingActive = false;
    if (this._briefingOverlay) this._briefingOverlay.style.display = 'none';
    this.renderer.domElement.requestPointerLock?.();
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
      const records = this.levels.expansion?.progress.records;
      this.ui.showAnnouncement('Second entity detected. Use the archive as cover and secure the records before evacuation.');
      this.ui.showTutorial({ text: records ? 'SECOND CREATURE / RELEASE C AND HOLD SHIFT TO RUN' : 'SECOND CREATURE / GET TO THE EAST ARCHIVE',
        sub: records ? 'Follow green signs to the core-access beacon.' : 'Use the racks as cover. Restore archive power and secure the experiment records.' });
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

  _updateExpansion(dt) {
    const expansion = this.levels.expansion;
    if (!expansion) return;
    const damage = expansion.update(dt, this.player.position);
    if (damage) {
      this.playerHealth = Math.max(0, this.playerHealth - damage);
      this.camera.shake(0.15); this.audio.play('attack');
      if (this.playerHealth <= 0) { this.gameState.gameOver(); return; }
    }
    while (expansion.notices.length) this.ui.showAnnouncement(expansion.notices.shift());
    if (this.gameState.currentLevel === 2) {
      if (expansion.noise) for (const monster of [this.monster, this.serverMonster]) {
        if (monster.isActive) monster.awareness?.hear(14.3, -44.1);
      }
      return;
    }
    const progress = expansion.progress, boss = this.monster.boss;
    if (!boss.armed && progress.powered) this.monster.setNavigationObstacles(
      this.levels._disposables.map(entry => entry.body).filter(body => body?.world), this.levels.navigationBounds);
    boss.armed = progress.powered;
    for (const wp of this.monster.weakPoints) {
      wp.material.uniforms.uColor.value.setHex(boss.vulnerable ? 0x65e7f4 : 0xffa24e);
      if (boss.vulnerable) wp.material.uniforms.uColor.value.multiplyScalar(0.45);
    }
    const point = ESCAPE_CHECKPOINTS[progress.checkpoint];
    const key = progress.escapeStarted ? 'escape-' + progress.checkpoint : progress.powered ? 'fight' : 'generators-' + progress.generators.size;
    if (key === this._expansionBeat) return;
    this._expansionBeat = key;
    const text = progress.escapeStarted ? 'ESCAPE / ' + (point?.label || 'ENTER THE GREEN SURFACE BEACON')
      : progress.powered ? 'SHIELDS DISABLED / DODGE ATTACKS, PULSE CYAN NODES DURING RECOVERY'
      : 'EMERGENCY POWER / START BOTH GENERATORS (' + progress.generators.size + '/2)';
    this._setObjective(text);
    this.ui.showTutorial({ text, sub: progress.escapeStarted ? 'Follow green floor lights. Avoid flashing amber areas; use the east service bypass at the rubble.'
      : progress.powered ? 'One node per recovery. Sidestep the amber line; move outside the amber ring before its sweep.'
      : 'The entity is hunting; keep moving and use cover. Pulse the west pump and east observation panels to disable its node shields.' });
  }

  /** Local goals and breathing spaces keep the hunt readable. */
  _updateHunt() {
    const z = this.player.position.z;
    const released = this.levels.pressureReleased;
    if (released && this.levels._doors.find(door => door.id === 'l2-pressure').opening && !this._huntPressureWasReleased) {
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
    const expansion = this.levels.expansion;
    if (entryOpen && expansion) {
      const p = expansion.progress;
      let key, text, sub;
      if (!p.released) {
        key = 'rescue-relay'; text = 'MEDICAL DISTRESS / PULSE THE RESCUE RELAY WEST OF CREW QUARTERS';
        sub = 'Two scientists are trapped. Look for the amber medical relay beside the west doorway.';
      } else if (!p.rescueComplete) {
        key = 'escort-' + p.rescued.size; text = 'ESCORT SCIENTISTS TO THE GREEN REFUGE (' + p.rescued.size + '/2)';
        sub = 'Stay within six metres. Lead them north through medical; they wait if you run too far ahead.';
      } else if (!released) {
        key = 'pressure-' + isolated; text = 'SURVIVORS SAFE / ISOLATE BOTH AMBER PRESSURE VALVES (' + isolated + '/2)';
        sub = 'Maintenance corridor south of crew quarters. Pulse both amber valves to release the server-room interlock.';
      } else if (released && !p.records) {
        key = !p.archivePowered ? 'archive-power' : !p.downloading ? 'archive-terminal'
          : 'download-' + p.downloadPercent + '-' + expansion.nearTerminal;
        text = !p.archivePowered ? 'RECOVER EXPERIMENT RECORDS / RESTORE POWER IN THE EAST ARCHIVE'
          : !p.downloading ? 'ARCHIVE ONLINE / PULSE THE EVIDENCE TERMINAL'
          : (expansion.nearTerminal ? 'DOWNLOADING RECORDS / ' : 'TRANSFER PAUSED / RETURN TO ARCHIVE WORK AREA / ') + p.downloadPercent + '%';
        sub = 'Stay inside the glowing floor outline around the archive tables until 100%. Machinery noise attracts creatures.';
      } else if (p.records) {
        key = 'records-secured'; text = 'RECORDS SECURED (100%) / REACH THE GREEN CORE ACCESS BEACON';
        sub = 'Both scientists are safe and the transfer door is open. Evade the creatures and follow green exit signs.';
      }
      if (key) {
        if (key !== this._huntBeat) {
          this._huntBeat = key; this._baseObjective = text; this._setObjective(text);
          this.ui.showTutorial({ text, sub });
        }
        return;
      }
    }
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
    this.levels.expansion?.startEscape();
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
    // Caption only — the recorded EAS alarm (playEasAlarm below) is the sole
    // alarm for the escape; the synthesized demolition klaxon is not used.
    this.ui.showAnnouncement(PA_ANNOUNCEMENTS.demolition.text);

    // Screen shake for dramatic effect.
    this.camera.shake(0.5);

    // Collapse ambience: sustained structural rumble + flickering lights.
    this.audio.play('collapse');
    this.audio.duck(0.65);
    // The EAS alarm loops from the countdown until the game ends.
    this.audio.playEasAlarm();
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
    const escapeProgress = (this.levels.expansion?.progress.checkpoint || 0) / ESCAPE_CHECKPOINTS.length * 0.85;
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
    if (this.levels.expansion?.canWin === false) return;
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
