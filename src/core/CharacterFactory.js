/**
 * CharacterFactory.js — procedural articulated character models.
 *
 * All three characters in the game are code-built here (no external assets —
 * keeps the LAMP deployment risk at zero).  Every builder returns the same
 * shape:
 *
 *     { group, update(dt, state) }
 *
 * and is animated purely by rotating pre-built joint Groups — no skinning,
 * no per-frame allocations (only numbers are computed in update()).
 * Swapping to `.glb` models later means replacing the builders behind this
 * exact API.
 *
 * Builders:
 *   createEngineer()  — the player character (helmet, visor, backpack, tool)
 *   createScientist() — seated NPC for the Level 1 intro beat
 *   createMonster()   — hunched creature with mounted weak points
 *
 * The monster builder additionally returns:
 *   bodyMat      — the single shared material MonsterAI flashes on hit
 *   hitMeshes    — torso/head meshes tagged 'monsterBody' (impact feedback)
 *   weakPoints   — the 3 shootable spheres (userData tagged as before)
 */
import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Small shared construction helpers (used at build time only)
// ─────────────────────────────────────────────────────────────────────────────

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2, ...opts });
}

/** Box mesh parented into `parent` at a local offset. */
function part(parent, geo, mat, x, y, z) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Empty joint Group — limbs/attachments rotate around these pivots. */
function joint(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** Map a LevelKit-style face ('n'|'e'|'s'|'w') to a Y rotation. */
export function faceToRotY(face) {
  switch (face) {
    case 'n': return Math.PI;
    case 'e': return Math.PI / 2;
    case 'w': return -Math.PI / 2;
    default: return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Engineer — the player character (feet at local y = 0, ~1.8 m tall)
// ─────────────────────────────────────────────────────────────────────────────

export function createEngineer() {
  const group = new THREE.Group();

  const suit = std(0x37506b, { roughness: 0.8, metalness: 0.15 });
  const suitDark = std(0x263546, { roughness: 0.85, metalness: 0.2 });
  const vest = std(0x59636f, { roughness: 0.55, metalness: 0.45 });
  const boot = std(0x1d232b, { roughness: 0.9, metalness: 0.1 });
  const helmetMat = std(0xcfd6de, { roughness: 0.35, metalness: 0.55 });
  const visorMat = std(0x0d2b3a, { roughness: 0.15, metalness: 0.6, emissive: 0x2fd9ff, emissiveIntensity: 0.8 });
  const accentMat = std(0x223344, { roughness: 0.4, metalness: 0.3, emissive: 0x38c8ff, emissiveIntensity: 0.7 });
  const skin = std(0xd8a97c, { roughness: 0.9, metalness: 0 });

  // Pelvis.
  part(group, new THREE.BoxGeometry(0.34, 0.16, 0.24), suitDark, 0, 0.82, 0);

  // Torso (bobs while moving).
  const torso = joint(group, 0, 0.9, 0);
  part(torso, new THREE.BoxGeometry(0.44, 0.5, 0.26), suit, 0, 0.26, 0);
  part(torso, new THREE.BoxGeometry(0.46, 0.3, 0.3), vest, 0, 0.3, 0);      // chest rig
  part(torso, new THREE.BoxGeometry(0.4, 0.05, 0.28), accentMat, 0, 0.1, 0); // waist light band
  part(torso, new THREE.BoxGeometry(0.34, 0.04, 0.05), accentMat, 0, 0.44, 0.145); // chest stripe

  // Backpack with two tanks (survivor silhouette from behind).
  part(torso, new THREE.BoxGeometry(0.36, 0.42, 0.16), suitDark, 0, 0.26, -0.22);
  const tankGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.34, 10);
  part(torso, tankGeo, vest, -0.09, 0.26, -0.32);
  part(torso, tankGeo, vest, 0.09, 0.26, -0.32);

  // Head + helmet + visor.
  const head = joint(torso, 0, 0.58, 0);
  part(head, new THREE.BoxGeometry(0.2, 0.2, 0.2), skin, 0, 0.08, 0.02);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), helmetMat);
  dome.position.set(0, 0.14, 0);
  dome.castShadow = true;
  head.add(dome);
  part(head, new THREE.BoxGeometry(0.24, 0.09, 0.07), visorMat, 0, 0.14, 0.16);
  part(head, new THREE.BoxGeometry(0.26, 0.05, 0.2), vest, 0, 0.03, 0.0);   // chin strap band

  // Arms — shoulder pivots, elbow children, hands.
  const buildArm = (side) => {
    const s = side === 'l' ? -1 : 1;
    const arm = joint(torso, s * 0.3, 0.46, 0);
    part(arm, new THREE.SphereGeometry(0.085, 8, 8), vest, 0, 0, 0);        // shoulder pad
    part(arm, new THREE.BoxGeometry(0.12, 0.3, 0.12), suit, 0, -0.16, 0);
    const elbow = joint(arm, 0, -0.31, 0);
    part(elbow, new THREE.BoxGeometry(0.11, 0.28, 0.11), suitDark, 0, -0.14, 0);
    part(elbow, new THREE.BoxGeometry(0.09, 0.1, 0.09), skin, 0, -0.3, 0);  // hand
    return { arm, elbow };
  };
  const { arm: armL, elbow: elbL } = buildArm('l');
  const { arm: armR, elbow: elbR } = buildArm('r');

  // Pulse-tool prop held in the right hand (emissive tip).
  const tool = new THREE.Group();
  tool.position.set(0, -0.32, 0.08);
  const toolBody = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 8), vest);
  toolBody.rotation.x = Math.PI / 2;
  toolBody.castShadow = true;
  tool.add(toolBody);
  const toolTip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), accentMat);
  toolTip.position.z = 0.17;
  tool.add(toolTip);
  elbR.add(tool);

  // Legs — hip pivots, knee children, boots.
  const buildLeg = (side) => {
    const s = side === 'l' ? -1 : 1;
    const leg = joint(group, s * 0.12, 0.78, 0);
    part(leg, new THREE.BoxGeometry(0.15, 0.34, 0.16), suit, 0, -0.17, 0);
    const knee = joint(leg, 0, -0.34, 0);
    part(knee, new THREE.BoxGeometry(0.13, 0.32, 0.14), suitDark, 0, -0.16, 0);
    part(knee, new THREE.BoxGeometry(0.14, 0.09, 0.26), boot, 0, -0.36, 0.05);
    return { leg, knee };
  };
  const { leg: legL, knee: kneeL } = buildLeg('l');
  const { leg: legR, knee: kneeR } = buildLeg('r');

  // ── Animation state (closure — no per-frame allocation) ───────────────────
  const TORSO_BASE_Y = 0.9;
  let t = 0;       // total time (idle sway)
  let phase = 0;   // stride phase
  let blend = 0;   // smoothed 0..1 move blend

  /**
   * @param {number} dt
   * @param {{moving:boolean, sprinting:boolean, grounded:boolean}} s
   */
  const update = (dt, s) => {
    t += dt;
    const target = s && s.moving ? (s.sprinting ? 1 : 0.65) : 0;
    blend += (target - blend) * Math.min(1, dt * 9);
    if (blend > 0.02) phase += dt * (6 + blend * 6);

    const swing = Math.sin(phase) * (0.5 + blend * 0.45) * blend;

    if (s && !s.grounded) {
      // Airborne pose — legs tucked, arms slightly raised.
      legL.rotation.x = -0.5; legR.rotation.x = 0.35;
      kneeL.rotation.x = 0.7; kneeR.rotation.x = 0.25;
      armL.rotation.x = -0.4; armR.rotation.x = -0.25;
    } else {
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      kneeL.rotation.x = Math.max(0, -swing) * 1.1;
      kneeR.rotation.x = Math.max(0, swing) * 1.1;
      armL.rotation.x = -swing * 0.8;
      armR.rotation.x = swing * 0.8;
    }

    // Idle sway + breathing (fades out as the walk blend rises).
    const idle = 1 - blend;
    armL.rotation.z = 0.07 + Math.sin(t * 1.8) * 0.02 * idle;
    armR.rotation.z = -0.07 - Math.sin(t * 1.8) * 0.02 * idle;
    elbL.rotation.x = -0.25 - blend * 0.25; // slight natural elbow bend, more when running
    elbR.rotation.x = -0.25 - blend * 0.25;
    torso.rotation.x = blend * 0.14 + Math.sin(t * 2.1) * 0.012 * idle;
    torso.position.y = TORSO_BASE_Y + Math.abs(Math.cos(phase)) * 0.035 * blend;
    head.rotation.y = Math.sin(t * 0.55) * 0.16 * idle;
  };

  return { group, update };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scientist — seated NPC for the Level 1 scripted beat (hunched while typing)
// ─────────────────────────────────────────────────────────────────────────────

export function createScientist() {
  const group = new THREE.Group();

  const coat = std(0xe4e8ee, { roughness: 0.85, metalness: 0.02 });
  const coatShade = std(0xc9cfd8, { roughness: 0.85, metalness: 0.02 });
  const trousers = std(0x3a4148, { roughness: 0.9 });
  const skin = std(0xd8a97c, { roughness: 0.9, metalness: 0 });
  const hair = std(0x4a3b2e, { roughness: 0.95, metalness: 0 });
  const shoe = std(0x22262c, { roughness: 0.9 });
  const badge = std(0x223344, { roughness: 0.4, metalness: 0.3, emissive: 0x38c8ff, emissiveIntensity: 0.7 });

  // Seated pose: hips at ~0.72, thighs forward, calves down to the floor.
  const hips = joint(group, 0, 0.72, 0);
  part(hips, new THREE.BoxGeometry(0.32, 0.18, 0.26), trousers, 0, 0, 0);

  // Torso (up through the open lab coat).
  const torso = joint(hips, 0, 0.06, -0.02);
  part(torso, new THREE.BoxGeometry(0.38, 0.46, 0.24), coat, 0, 0.24, 0);
  part(torso, new THREE.BoxGeometry(0.4, 0.2, 0.26), coatShade, 0, 0.02, 0); // coat hem
  part(torso, new THREE.BoxGeometry(0.1, 0.12, 0.02), badge, -0.12, 0.3, 0.13); // ID badge

  // Head — slightly bowed while typing.
  const head = joint(torso, 0, 0.5, 0.02);
  part(head, new THREE.BoxGeometry(0.2, 0.22, 0.2), skin, 0, 0.1, 0);
  part(head, new THREE.BoxGeometry(0.22, 0.09, 0.22), hair, 0, 0.19, -0.01);
  part(head, new THREE.BoxGeometry(0.24, 0.04, 0.05), skin, 0, 0.13, 0.11); // glasses band

  // Arms bent forward over the console.
  const buildArm = (side) => {
    const s = side === 'l' ? -1 : 1;
    const arm = joint(torso, s * 0.24, 0.4, 0);
    part(arm, new THREE.BoxGeometry(0.1, 0.24, 0.1), coat, 0, -0.12, 0);
    const elbow = joint(arm, 0, -0.24, 0);
    part(elbow, new THREE.BoxGeometry(0.09, 0.22, 0.09), coat, 0, -0.11, 0);
    part(elbow, new THREE.BoxGeometry(0.08, 0.08, 0.08), skin, 0, -0.24, 0);
    return { arm, elbow };
  };
  const { arm: armL, elbow: elbL } = buildArm('l');
  const { arm: armR, elbow: elbR } = buildArm('r');

  // Legs drawn back under the desk.
  const buildLeg = (side) => {
    const s = side === 'l' ? -1 : 1;
    const hip = joint(hips, s * 0.11, -0.06, 0);
    hip.rotation.x = -1.35; // thigh forward, near horizontal
    part(hip, new THREE.BoxGeometry(0.14, 0.42, 0.15), trousers, 0, -0.21, 0);
    const knee = joint(hip, 0, -0.42, 0);
    knee.rotation.x = 1.35; // calf straight down
    part(knee, new THREE.BoxGeometry(0.12, 0.5, 0.13), trousers, 0, -0.25, 0);
    part(knee, new THREE.BoxGeometry(0.13, 0.08, 0.24), shoe, 0, -0.52, 0.05);
    return { hip, knee };
  };
  buildLeg('l');
  buildLeg('r');

  // ── Animation: typing / cowering ──────────────────────────────────────────
  let t = 0;
  let cower = 0; // smoothed 0..1 crouch blend

  /**
   * @param {number} dt
   * @param {{mode?:'type'|'cower'|'idle'}} s
   */
  const update = (dt, s) => {
    t += dt;
    const mode = (s && s.mode) || 'type';
    const target = mode === 'cower' ? 1 : 0;
    cower += (target - cower) * Math.min(1, dt * 4.5);
    const type = 1 - cower;

    // Typing pose: elbows bent, hands tapping on the console.
    const tap = Math.sin(t * 7) * 0.06;
    elbL.rotation.x = -1.15 * type + tap * type;
    elbR.rotation.x = -1.15 * type - tap * type;
    armL.rotation.x = -0.85 * type;
    armR.rotation.x = -0.85 * type;
    head.rotation.x = 0.24 * type + 0.55 * cower + Math.sin(t * 0.5) * 0.04 * type;

    // Cower: hunch down, arms thrown up over the head, slight shiver.
    const shiver = Math.sin(t * 22) * 0.02 * cower;
    torso.rotation.x = 0.42 * cower + shiver;
    armL.rotation.x += (-2.3 + 0.85) * cower; // overwrite toward "arms up" target
    armR.rotation.x += (-2.3 + 0.85) * cower;
    elbL.rotation.x += (-1.7 + 1.15) * cower;
    elbR.rotation.x += (-1.7 + 1.15) * cower;
    armL.rotation.z = 0.35 * cower;
    armR.rotation.z = -0.35 * cower;
    torso.position.y = 0.06 - 0.06 * cower;
  };

  return { group, update };
}

// ─────────────────────────────────────────────────────────────────────────────
// Monster — hunched creature, mounted weak points
// ─────────────────────────────────────────────────────────────────────────────

export function createMonster() {
  const group = new THREE.Group(); // roughly feet at local y = -0.55 (body sphere r 0.6)

  const chitin = std(0x241d20, { roughness: 0.72, metalness: 0.35 }); // shared body material (hit flash)
  const chitinDark = std(0x161215, { roughness: 0.8, metalness: 0.3 });
  const sinew = std(0x3a2e33, { roughness: 0.65, metalness: 0.15 });
  const eyeMat = std(0x1a0505, { roughness: 0.3, emissive: 0xff5522, emissiveIntensity: 1.4 });
  const spineGlowMat = std(0x1a0505, { roughness: 0.5, emissive: 0xff2a1a, emissiveIntensity: 0.9 });

  // Pelvis + hunched spine.
  const pelvis = joint(group, 0, 0.32, 0);
  part(pelvis, new THREE.BoxGeometry(0.42, 0.3, 0.36), chitin, 0, 0, 0);
  part(pelvis, new THREE.BoxGeometry(0.46, 0.12, 0.4), chitinDark, 0, 0.18, 0); // hip ridge

  const spine = joint(pelvis, 0, 0.22, 0);
  spine.rotation.x = 0.42; // hunch forward
  const chestMesh = part(spine, new THREE.BoxGeometry(0.62, 0.5, 0.42), chitin, 0, 0.28, 0.04);
  chestMesh.userData.pulseTarget = true;
  chestMesh.userData.pulseType = 'monsterBody';
  part(spine, new THREE.BoxGeometry(0.7, 0.14, 0.46), chitinDark, 0, 0.52, 0.0); // shoulder crest
  // Spine glow: three emissive nodes along the back.
  for (let i = 0; i < 3; i++) {
    part(spine, new THREE.BoxGeometry(0.07, 0.07, 0.07), spineGlowMat, 0, 0.12 + i * 0.17, -0.22 - i * 0.02);
  }

  // Head — long skull, jaw, glowing eyes.
  const neck = joint(spine, 0, 0.56, 0.24);
  const headMesh = part(neck, new THREE.BoxGeometry(0.34, 0.3, 0.5), chitin, 0, 0.02, 0.08);
  headMesh.userData.pulseTarget = true;
  headMesh.userData.pulseType = 'monsterBody';
  part(neck, new THREE.BoxGeometry(0.26, 0.1, 0.34), chitinDark, 0, -0.14, 0.12); // jaw
  part(neck, new THREE.BoxGeometry(0.3, 0.08, 0.16), chitinDark, 0, 0.16, 0.16);  // brow
  const eyeGeo = new THREE.SphereGeometry(0.055, 8, 8);
  part(neck, eyeGeo, eyeMat, -0.1, 0.04, 0.31);
  part(neck, eyeGeo, eyeMat, 0.1, 0.04, 0.31);

  // Long clawed arms — reach past the knees.
  const buildArm = (side) => {
    const s = side === 'l' ? -1 : 1;
    const arm = joint(spine, s * 0.42, 0.44, 0.02);
    part(arm, new THREE.SphereGeometry(0.12, 8, 8), chitinDark, 0, 0, 0);
    part(arm, new THREE.BoxGeometry(0.15, 0.55, 0.15), chitin, 0, -0.28, 0);
    const elbow = joint(arm, 0, -0.56, 0);
    part(elbow, new THREE.BoxGeometry(0.13, 0.58, 0.13), sinew, 0, -0.29, 0);
    const wrist = joint(elbow, 0, -0.6, 0);
    // Three claw fingers.
    for (let i = -1; i <= 1; i++) {
      const claw = part(wrist, new THREE.BoxGeometry(0.035, 0.3, 0.035), chitinDark, i * 0.06, -0.15, i * 0.02);
      claw.rotation.z = i * 0.22;
    }
    return { arm, elbow, wrist };
  };
  const { arm: armL, elbow: elbL } = buildArm('l');
  const { arm: armR, elbow: elbR } = buildArm('r');

  // Digitigrade legs.
  const buildLeg = (side) => {
    const s = side === 'l' ? -1 : 1;
    const hip = joint(pelvis, s * 0.2, -0.04, 0);
    hip.rotation.x = -0.5; // thigh forward
    part(hip, new THREE.BoxGeometry(0.17, 0.42, 0.19), chitin, 0, -0.2, 0);
    const knee = joint(hip, 0, -0.42, 0);
    knee.rotation.x = 1.05; // shin back
    part(knee, new THREE.BoxGeometry(0.13, 0.4, 0.14), sinew, 0, -0.19, 0);
    const ankle = joint(knee, 0, -0.4, 0);
    ankle.rotation.x = -0.65;
    part(ankle, new THREE.BoxGeometry(0.15, 0.09, 0.3), chitinDark, 0, -0.05, 0.12);
    // Toe claws.
    for (let i = -1; i <= 1; i++) {
      part(ankle, new THREE.BoxGeometry(0.03, 0.05, 0.14), chitinDark, i * 0.05, -0.08, 0.28);
    }
    return { hip, knee };
  };
  const { hip: hipL, knee: kneeL } = buildLeg('l');
  const { hip: hipR, knee: kneeR } = buildLeg('r');

  // ── Weak points — mounted in chitin sockets, same offsets as before ──────
  // (Gameplay-critical: PulseTool raycasts these exact spheres.)
  const wpGeo = new THREE.SphereGeometry(0.28, 10, 10);
  const socketGeo = new THREE.SphereGeometry(0.32, 8, 8);
  const wpOffsets = [
    { x: 0, y: 1.6, z: 0.62 },   // chest (front — faces the player in chase)
    { x: 0.55, y: 0.8, z: 0 },   // right side
    { x: -0.55, y: 0.8, z: 0 },  // left side
  ];
  const weakPoints = [];
  for (let i = 0; i < 3; i++) {
    const off = wpOffsets[i];
    // Dark chitin socket so the glowing node reads as physically mounted.
    part(group, socketGeo, chitinDark, off.x * 0.86, off.y, off.z * 0.86);
    const wpMat = new THREE.MeshStandardMaterial({
      color: 0xff3333,
      emissive: 0xff3333,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.6,
    });
    const wpMesh = new THREE.Mesh(wpGeo, wpMat);
    wpMesh.position.set(off.x, off.y, off.z);
    wpMesh.userData.pulseTarget = true;
    wpMesh.userData.pulseType = 'weakpoint';
    wpMesh.userData.weakPointIndex = i;
    wpMesh.userData.destroyed = false;
    group.add(wpMesh);
    weakPoints.push(wpMesh);
  }

  // ── Animation state ───────────────────────────────────────────────────────
  let t = 0;
  let phase = 0;
  let atk = 0; // attack-swipe timer

  /**
   * @param {number} dt
   * @param {'patrol'|'chase'|'attack'|'dead'} state
   * @param {{x:number,z:number}} [vel] physics velocity (for stride speed)
   */
  const update = (dt, state, vel) => {
    t += dt;
    const spd = vel ? Math.sqrt(vel.x * vel.x + vel.z * vel.z) : 0;
    phase += dt * (1.7 + spd * 1.5);
    const swing = Math.sin(phase);
    const amp = state === 'chase' ? 0.75 : state === 'attack' ? 0.35 : 0.45;
    const dead = state === 'dead';

    // Legs — big slow strides; limp when dead.
    const legLTarget = dead ? 0.2 : -0.5 + swing * amp;
    const legRTarget = dead ? 0.2 : -0.5 - swing * amp;
    hipL.rotation.x += (legLTarget - hipL.rotation.x) * Math.min(1, dt * 6);
    hipR.rotation.x += (legRTarget - hipR.rotation.x) * Math.min(1, dt * 6);
    kneeL.rotation.x += ((dead ? 1.3 : 1.05 - swing * amp * 0.5) - kneeL.rotation.x) * Math.min(1, dt * 6);
    kneeR.rotation.x += ((dead ? 1.3 : 1.05 + swing * amp * 0.5) - kneeR.rotation.x) * Math.min(1, dt * 6);

    // Arms — hang and swing; reaching forward in chase; swipe in attack.
    const reach = state === 'chase' ? -0.55 : 0;
    let armRTarget = reach + swing * amp * 0.7;
    if (state === 'attack') {
      atk += dt * 7;
      const swipe = Math.max(0, Math.sin(atk)); // 0..1 wind-back-and-slash
      armRTarget = -0.4 - swipe * 1.6;
      armL.rotation.x += ((-0.2 + swing * 0.2) - armL.rotation.x) * Math.min(1, dt * 8);
    } else {
      atk = 0;
      armL.rotation.x += ((reach - swing * amp * 0.7) - armL.rotation.x) * Math.min(1, dt * 6);
    }
    if (dead) { armRTarget = 0.25; }
    armR.rotation.x += (armRTarget - armR.rotation.x) * Math.min(1, dt * 7);
    elbL.rotation.x = -0.25 - (state === 'chase' ? 0.5 : 0) + swing * 0.08;
    elbR.rotation.x = state === 'attack' ? -0.15 : -0.25 - (state === 'chase' ? 0.5 : 0) - swing * 0.08;

    // Body: hunch, sway, breathing; deeper hunch in chase.
    spine.rotation.x += ((dead ? 0.85 : state === 'chase' ? 0.55 : 0.42 + Math.sin(t * 1.4) * 0.03)
      - spine.rotation.x) * Math.min(1, dt * 4);
    pelvis.rotation.z = dead ? 0 : Math.sin(phase) * 0.06 * amp;
    pelvis.position.y = 0.32 + Math.abs(Math.cos(phase)) * 0.045 * Math.min(1, spd * 0.3);

    // Head: slow scan while patrolling, locked on while chasing.
    const headYaw = state === 'patrol' ? Math.sin(t * 0.8) * 0.35 : 0;
    neck.rotation.y += (headYaw - neck.rotation.y) * Math.min(1, dt * 3);
    neck.rotation.x = dead ? 0.5 : state === 'attack' ? 0.15 : 0;

    // Eye glow pulse ("it sees you" read) — cheap sin, no allocations.
    eyeMat.emissiveIntensity = 1.1 + 0.5 * Math.sin(t * 5);
    spineGlowMat.emissiveIntensity = 0.7 + 0.3 * Math.sin(t * 3.2 + 1.3);
  };

  return { group, update, bodyMat: chitin, hitMeshes: [chestMesh, headMesh], weakPoints };
}
