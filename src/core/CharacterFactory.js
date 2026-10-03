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
// Procedural canvas textures — generated once, cached module-wide.
// Zero external assets; the LAMP build stays asset-free.
// ─────────────────────────────────────────────────────────────────────────────

let _skinTexCache = null;
let _coatTexCache = null;
let _bumpTexCache = null;

/** Shared grayscale noise used as a bump map (leather / fabric grain). */
function bumpTexture() {
  if (_bumpTexCache) return _bumpTexCache;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 100 + Math.floor(Math.random() * 110);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 5, 0, 6.283);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  _bumpTexCache = t;
  return t;
}

/** Mottled, veined creature hide + matching bump map. */
function skinTextures() {
  if (_skinTexCache) return _skinTexCache;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#221a1b';
  ctx.fillRect(0, 0, 256, 256);
  // Large mottling — bruises, darker hide patches, raw spots.
  for (let i = 0; i < 240; i++) {
    const r = 6 + Math.random() * 26;
    ctx.globalAlpha = 0.1 + Math.random() * 0.16;
    ctx.fillStyle = Math.random() < 0.45 ? '#120c0d' : Math.random() < 0.75 ? '#332426' : '#4a2d2a';
    ctx.beginPath();
    ctx.ellipse(
      Math.random() * 256, Math.random() * 256,
      r, r * (0.5 + Math.random() * 0.7), Math.random() * 3.14, 0, 6.283
    );
    ctx.fill();
  }
  // Veins — thin branching lines.
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = '#5c2a23';
  ctx.lineWidth = 1;
  for (let i = 0; i < 24; i++) {
    let x = Math.random() * 256;
    let y = Math.random() * 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let j = 0; j < 5; j++) {
      x += (Math.random() - 0.5) * 46;
      y += (Math.random() - 0.5) * 46;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Fine speckle for pores.
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#0d0909' : '#3d2c2b';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  }
  ctx.globalAlpha = 1;
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.repeat.set(2, 2);
  _skinTexCache = { map, bump: bumpTexture() };
  return _skinTexCache;
}

/** Lab coat with old bloodstains — the bite happened before you arrived. */
function coatTextures() {
  if (_coatTexCache) return _coatTexCache;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e6e9ee';
  ctx.fillRect(0, 0, 256, 256);
  // Fabric noise.
  for (let i = 0; i < 900; i++) {
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = Math.random() < 0.5 ? '#c8ccd4' : '#f4f6f9';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // Bruise/stain cluster around the chest area.
  for (let i = 0; i < 26; i++) {
    const r = 6 + Math.random() * 22;
    ctx.globalAlpha = 0.14 + Math.random() * 0.24;
    ctx.fillStyle = Math.random() < 0.6 ? '#571d18' : '#3d120f';
    ctx.beginPath();
    ctx.ellipse(
      70 + Math.random() * 116, 60 + Math.random() * 90,
      r, r * (0.6 + Math.random() * 0.6), Math.random() * 3.14, 0, 6.283
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  _coatTexCache = { map, bump: bumpTexture() };
  return _coatTexCache;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engineer — the player character (feet at local y = 0, ~1.8 m tall)
// ─────────────────────────────────────────────────────────────────────────────

export function createEngineer() {
  const group = new THREE.Group();

  const bump = bumpTexture();
  const suit = std(0x35506d, { roughness: 0.8, metalness: 0.15, bumpMap: bump, bumpScale: 0.012 });
  const suitDark = std(0x233240, { roughness: 0.85, metalness: 0.2, bumpMap: bump, bumpScale: 0.012 });
  const vest = std(0x5a6570, { roughness: 0.55, metalness: 0.45, bumpMap: bump, bumpScale: 0.008 });
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

  const coatTex = coatTextures();
  const coat = std(0xffffff, {
    roughness: 0.8, metalness: 0.02,
    map: coatTex.map, bumpMap: coatTex.bump, bumpScale: 0.01,
  }); // bloodstained from the bite — the player walks into the aftermath
  const coatShade = std(0xc4cad4, { roughness: 0.85, metalness: 0.02, bumpMap: coatTex.bump, bumpScale: 0.01 });
  const trousers = std(0x363d44, { roughness: 0.9 });
  const skin = std(0xbf9f82, { roughness: 0.75, metalness: 0 }); // pallid, clammy
  const hair = std(0x403429, { roughness: 0.95, metalness: 0 });
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

  // ── Animation: typing / cowering / mutating ───────────────────────────────
  let t = 0;
  let cower = 0;  // smoothed 0..1 crouch blend
  let mutate = 0; // smoothed 0..1 mutation-convulsion blend
  let badgeRed = false; // badge emissive switched red during mutation?

  /**
   * @param {number} dt
   * @param {{mode?:'type'|'cower'|'mutate'|'idle'}} s
   */
  const update = (dt, s) => {
    t += dt;
    const mode = (s && s.mode) || 'type';
    const target = mode === 'cower' ? 1 : 0;
    const mutTarget = mode === 'mutate' ? 1 : 0;
    cower += (target - cower) * Math.min(1, dt * 4.5);
    mutate += (mutTarget - mutate) * Math.min(1, dt * 6);
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

    // Mutation: violent convulsions — the spine arches, the head thrashes,
    // the arms flail, and the ID badge strobes red as the change takes hold
    // (Game.js adds the strobing red glow light around this beat).
    if (mutate > 0.002) {
      const conv = Math.sin(t * 27);
      const arch = Math.sin(t * 11);
      torso.rotation.x = 0.42 * cower + mutate * (-0.35 + 0.2 * arch) + conv * 0.08 * mutate;
      torso.position.y += mutate * (0.32 + 0.08 * Math.abs(arch)); // rears up out of the seat
      head.rotation.x = 0.24 * type + 0.55 * cower + mutate * (-0.55 + 0.25 * conv);
      head.rotation.z = conv * 0.3 * mutate;
      armL.rotation.x += mutate * (-1.9 + 0.5 * conv);
      armR.rotation.x += mutate * (-1.9 - 0.5 * conv);
      armL.rotation.z = 0.35 * cower + mutate * (0.8 + conv * 0.15);
      armR.rotation.z = -0.35 * cower - mutate * (0.8 - conv * 0.15);
      // The body swells as it changes — the silhouette stops reading human.
      torso.scale.set(1 + mutate * 0.35, 1 + mutate * 0.45, 1 + mutate * 0.35);
      head.scale.setScalar(1 + mutate * 0.3);
      armL.scale.setScalar(1 + mutate * 0.25);
      armR.scale.setScalar(1 + mutate * 0.25);
      if (!badgeRed) { badge.emissive.setHex(0xff2a1a); badgeRed = true; }
      badge.emissiveIntensity = 1.2 + Math.abs(conv) * 2.2 * mutate;
    } else {
      if (badgeRed) {
        badge.emissive.setHex(0x38c8ff);
        badge.emissiveIntensity = 0.7;
        badgeRed = false;
      }
      if (torso.scale.x !== 1) {
        torso.scale.set(1, 1, 1);
        head.scale.setScalar(1);
        armL.scale.setScalar(1);
        armR.scale.setScalar(1);
      }
    }
  };

  return { group, update };
}

// ─────────────────────────────────────────────────────────────────────────────
// Monster — hunched creature, mounted weak points
// ─────────────────────────────────────────────────────────────────────────────

export function createMonster() {
  const group = new THREE.Group(); // roughly feet at local y = -0.55 (body sphere r 0.6)

  const tex = skinTextures();
  const chitin = std(0xffffff, {
    map: tex.map, bumpMap: tex.bump, bumpScale: 0.035,
    roughness: 0.6, metalness: 0.06,
  }); // shared body material (hit flash)
  const chitinDark = std(0x6b5759, {
    map: tex.map, bumpMap: tex.bump, bumpScale: 0.03,
    roughness: 0.7, metalness: 0.08,
  });
  const sinew = std(0x9c4a3c, { map: tex.map, roughness: 0.5, metalness: 0.05 });
  const bone = std(0xc9bda2, { roughness: 0.55, metalness: 0.05 });
  const maw = std(0x2a0a08, { emissive: 0x7a1408, emissiveIntensity: 0.55, roughness: 0.4 });
  const eyeMat = std(0x1a0505, { roughness: 0.3, emissive: 0xff3a1a, emissiveIntensity: 1.6 });
  const spineGlowMat = std(0x1a0505, { roughness: 0.5, emissive: 0xff2a1a, emissiveIntensity: 0.9 });

  // Pelvis + hunched spine — organic masses instead of boxes.
  const pelvis = joint(group, 0, 0.32, 0);
  const pelvisMass = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), chitin);
  pelvisMass.scale.set(1.05, 0.75, 0.9);
  pelvisMass.castShadow = true;
  pelvisMass.receiveShadow = true;
  pelvis.add(pelvisMass);
  part(pelvis, new THREE.BoxGeometry(0.46, 0.09, 0.34), chitinDark, 0, 0.2, 0); // hip ridge

  const spine = joint(pelvis, 0, 0.22, 0);
  spine.rotation.x = 0.42; // hunch forward

  // Ribcage — the tagged body target.
  const chestMesh = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 12), chitin);
  chestMesh.position.set(0, 0.3, 0.02);
  chestMesh.scale.set(1.05, 1.12, 0.82);
  chestMesh.castShadow = true;
  chestMesh.receiveShadow = true;
  chestMesh.userData.pulseTarget = true;
  chestMesh.userData.pulseType = 'monsterBody';
  spine.add(chestMesh);

  // Exposed rib arcs across the chest.
  const ribGeo = new THREE.TorusGeometry(0.3, 0.018, 6, 14, Math.PI);
  for (let i = 0; i < 3; i++) {
    const rib = new THREE.Mesh(ribGeo, chitinDark);
    rib.position.set(0, 0.16 + i * 0.14, 0.1);
    rib.rotation.x = Math.PI / 2 - 0.18;
    rib.castShadow = true;
    spine.add(rib);
  }

  // Vertebra spikes down the back.
  const spikeGeo = new THREE.ConeGeometry(0.045, 0.3, 6);
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Mesh(spikeGeo, bone);
    sp.position.set(0, 0.1 + i * 0.13, -0.26);
    sp.rotation.x = -1.05;
    const sc = 1 - i * 0.12;
    sp.scale.set(sc, sc, sc);
    sp.castShadow = true;
    spine.add(sp);
  }

  // Spine glow: three emissive pustules along the back.
  const glowGeo = new THREE.SphereGeometry(0.045, 8, 8);
  for (let i = 0; i < 3; i++) {
    part(spine, glowGeo, spineGlowMat, 0, 0.12 + i * 0.17, -0.24 - i * 0.02);
  }

  // Head — gaunt elongated skull, hinged jaw, deep-set ember eyes.
  const neck = joint(spine, 0, 0.56, 0.2);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.24, 8), sinew);
  neckMesh.position.set(0, 0.02, -0.04);
  neckMesh.rotation.x = 0.5;
  neckMesh.castShadow = true;
  neck.add(neckMesh);

  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), chitin);
  headMesh.position.set(0, 0.06, 0.1);
  headMesh.scale.set(0.85, 0.8, 1.5);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  headMesh.userData.pulseTarget = true;
  headMesh.userData.pulseType = 'monsterBody';
  neck.add(headMesh);

  // Heavy brow — shadows the eyes into sockets.
  const brow = part(neck, new THREE.BoxGeometry(0.3, 0.06, 0.14), chitinDark, 0, 0.16, 0.16);
  brow.rotation.x = -0.25;
  const eyeGeo = new THREE.SphereGeometry(0.042, 8, 8);
  part(neck, eyeGeo, eyeMat, -0.085, 0.06, 0.3);
  part(neck, eyeGeo, eyeMat, 0.085, 0.06, 0.3);

  // Hinged jaw — creaks open in chase, gapes in attack (animated below).
  const jaw = joint(neck, 0, -0.06, 0.02);
  const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), chitinDark);
  jawMesh.position.set(0, -0.05, 0.14);
  jawMesh.scale.set(0.95, 0.45, 1.6);
  jawMesh.castShadow = true;
  jaw.add(jawMesh);
  part(jaw, new THREE.SphereGeometry(0.09, 8, 6), maw, 0, -0.01, 0.12); // throat glow
  const toothGeo = new THREE.ConeGeometry(0.016, 0.09, 5);
  for (let i = -2; i <= 2; i++) {
    // Lower fangs (on the jaw) …
    const lo = new THREE.Mesh(toothGeo, bone);
    lo.position.set(i * 0.045, 0.02, 0.3 - Math.abs(i) * 0.045);
    lo.rotation.x = 0.12;
    jaw.add(lo);
    // … and upper fangs (on the skull).
    const up = new THREE.Mesh(toothGeo, bone);
    up.position.set(i * 0.045, -0.01, 0.31 - Math.abs(i) * 0.045);
    up.rotation.x = Math.PI - 0.12;
    neck.add(up);
  }

  // Long knuckle-dragging arms — tapered limbs, exposed forearm muscle,
  // bone claws.
  const buildArm = (side) => {
    const s = side === 'l' ? -1 : 1;
    const arm = joint(spine, s * 0.4, 0.44, 0.02);
    part(arm, new THREE.SphereGeometry(0.12, 10, 8), chitin, 0, 0.02, 0);
    const plate = part(arm, new THREE.BoxGeometry(0.16, 0.1, 0.18), chitinDark, s * 0.03, 0.1, -0.02);
    plate.rotation.z = -s * 0.35;
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.062, 0.6, 8), chitin);
    upper.position.set(0, -0.3, 0);
    upper.castShadow = true;
    arm.add(upper);

    const elbow = joint(arm, 0, -0.6, 0);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 6), bone);
    spike.position.set(0, 0.04, -0.1);
    spike.rotation.x = -2.2;
    elbow.add(spike);
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.62, 8), sinew);
    fore.position.set(0, -0.31, 0);
    fore.castShadow = true;
    elbow.add(fore);

    const wrist = joint(elbow, 0, -0.64, 0);
    const palm = part(wrist, new THREE.BoxGeometry(0.11, 0.13, 0.06), chitinDark, 0, -0.06, 0.02);
    palm.rotation.x = -0.2;
    const fingers = [];
    for (let i = -1; i <= 1; i++) {
      const f = joint(wrist, i * 0.045, -0.11, 0.03);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.16, 0.026), chitin);
      seg.position.set(0, -0.08, 0);
      seg.castShadow = true;
      f.add(seg);
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.14, 5), bone);
      claw.position.set(0, -0.21, 0.01);
      claw.rotation.x = Math.PI;
      f.add(claw);
      fingers.push(f);
    }
    return { arm, elbow, fingers };
  };
  const { arm: armL, elbow: elbL, fingers: finL } = buildArm('l');
  const { arm: armR, elbow: elbR, fingers: finR } = buildArm('r');

  // Digitigrade legs — heavy thighs, springy shins, splayed toe claws.
  const buildLeg = (side) => {
    const s = side === 'l' ? -1 : 1;
    const hip = joint(pelvis, s * 0.2, -0.02, 0);
    hip.rotation.x = -0.5; // thigh forward
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.48, 8), chitin);
    thigh.position.set(0, -0.24, 0);
    thigh.castShadow = true;
    hip.add(thigh);
    const knee = joint(hip, 0, -0.48, 0);
    knee.rotation.x = 1.0; // shin back
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.44, 8), chitinDark);
    shin.position.set(0, -0.22, 0);
    shin.castShadow = true;
    knee.add(shin);
    const ankle = joint(knee, 0, -0.44, 0);
    ankle.rotation.x = -0.6;
    part(ankle, new THREE.BoxGeometry(0.15, 0.07, 0.32), chitinDark, 0, -0.03, 0.1);
    // Toe claws.
    const toeGeo = new THREE.ConeGeometry(0.025, 0.16, 5);
    for (let i = -1; i <= 1; i++) {
      const toe = new THREE.Mesh(toeGeo, bone);
      toe.position.set(i * 0.05, -0.05, 0.28);
      toe.rotation.x = Math.PI / 2 + 0.15;
      ankle.add(toe);
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
  let atk = 0;        // attack-swipe timer
  let jawOpen = 0.08; // smoothed jaw angle

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

    // Legs — big lurching strides; limp when dead.
    const legLTarget = dead ? 0.2 : -0.5 + swing * amp;
    const legRTarget = dead ? 0.2 : -0.5 - swing * amp;
    hipL.rotation.x += (legLTarget - hipL.rotation.x) * Math.min(1, dt * 6);
    hipR.rotation.x += (legRTarget - hipR.rotation.x) * Math.min(1, dt * 6);
    kneeL.rotation.x += ((dead ? 1.3 : 1.05 - swing * amp * 0.5) - kneeL.rotation.x) * Math.min(1, dt * 6);
    kneeR.rotation.x += ((dead ? 1.3 : 1.05 + swing * amp * 0.5) - kneeR.rotation.x) * Math.min(1, dt * 6);

    // Arms — the left drags low (unnatural asymmetry), both reach in chase,
    // the right arm slashes in attack.
    const drag = 0.18;
    const reach = state === 'chase' ? -0.55 : 0;
    let armRTarget = reach + swing * amp * 0.7;
    if (state === 'attack') {
      atk += dt * 7;
      const swipe = Math.max(0, Math.sin(atk)); // 0..1 wind-back-and-slash
      armRTarget = -0.4 - swipe * 1.6;
      armL.rotation.x += ((-0.2 + swing * 0.2 + drag * 0.5) - armL.rotation.x) * Math.min(1, dt * 8);
    } else {
      atk = 0;
      armL.rotation.x += ((reach + drag - swing * amp * 0.7) - armL.rotation.x) * Math.min(1, dt * 6);
    }
    if (dead) {
      armRTarget = 0.25;
      armL.rotation.x += (0.15 - armL.rotation.x) * Math.min(1, dt * 3);
    }
    armR.rotation.x += (armRTarget - armR.rotation.x) * Math.min(1, dt * 7);
    elbL.rotation.x = -0.32 - (state === 'chase' ? 0.5 : 0) + swing * 0.08;
    elbR.rotation.x = state === 'attack' ? -0.15 : -0.25 - (state === 'chase' ? 0.5 : 0) - swing * 0.08;

    // Claws flex — open when hunting, clenched in attack.
    const curl = dead ? 0.1 : state === 'attack' ? -1.1 : state === 'chase' ? -0.7 : -0.35;
    for (let i = 0; i < 3; i++) {
      finL[i].rotation.x += (curl - finL[i].rotation.x) * Math.min(1, dt * 6);
      finR[i].rotation.x += (curl - finR[i].rotation.x) * Math.min(1, dt * 6);
    }

    // Jaw — breathes slightly at idle, creaks open in chase, gapes in attack.
    const jawTarget = dead ? 0.5 : state === 'attack' ? 1.0
      : state === 'chase' ? 0.55 : 0.08 + Math.sin(t * 1.6) * 0.05;
    jawOpen += (jawTarget - jawOpen) * Math.min(1, dt * (state === 'attack' ? 14 : 5));
    jaw.rotation.x = jawOpen;

    // Body: hunch, sway, breathing; deeper hunch in chase.
    spine.rotation.x += ((dead ? 0.85 : state === 'chase' ? 0.55 : 0.42 + Math.sin(t * 1.4) * 0.03)
      - spine.rotation.x) * Math.min(1, dt * 4);
    spine.rotation.y = Math.sin(phase) * 0.07 * amp; // shoulder counter-sway
    pelvis.rotation.z = dead ? 0 : Math.sin(phase) * 0.06 * amp;
    pelvis.position.y = 0.32 + Math.abs(Math.cos(phase)) * 0.045 * Math.min(1, spd * 0.3);

    // Head: slow scanning while patrolling with sudden jerks — the twitch is
    // what reads as "not human" even when it hasn't noticed you.
    const twitch = Math.sin(t * 13.7) * Math.sin(t * 7.3);
    const jerk = state === 'patrol' && Math.abs(twitch) > 0.83;
    const headYaw = state === 'patrol' ? Math.sin(t * 0.8) * 0.35 : 0;
    const targetYaw = headYaw + (jerk ? Math.sin(t * 41) * 0.22 : 0);
    neck.rotation.y += (targetYaw - neck.rotation.y) * Math.min(1, dt * (jerk ? 18 : 3));
    neck.rotation.x = dead ? 0.5 : state === 'attack' ? 0.15 : 0;

    // Eye glow: ember flicker, surging when it hunts.
    eyeMat.emissiveIntensity = (state === 'chase' ? 2.1 + 0.6 * Math.sin(t * 9)
      : 1.1 + 0.5 * Math.sin(t * 5)) + (jerk ? 0.8 : 0);
    spineGlowMat.emissiveIntensity = 0.7 + 0.3 * Math.sin(t * 3.2 + 1.3);
  };

  return { group, update, bodyMat: chitin, hitMeshes: [chestMesh, headMesh], weakPoints };
}
