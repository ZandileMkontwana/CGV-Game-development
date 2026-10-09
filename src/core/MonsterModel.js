/**
 * MonsterModel — the Blender-built creature, with procedural fallback.
 *
 * Loads `public/assets/models/monster.glb` through the AssetLibrary and
 * normalises it into the exact local metric space the procedural creature
 * from CharacterFactory occupies:
 *
 *   - origin at the model root, feet at local y = -0.55, crown near +1.9,
 *   - facing +Z at yaw 0 (MonsterAI faces it with rotation.y = atan2(dx, dz)),
 *   - three weak-point spheres with the pulse-target userData contract,
 *   - body meshes tagged 'monsterBody' for impact feedback (no damage).
 *
 * Because the wrapper reproduces that space, MonsterAI needs no changes for
 * positioning, the aura light, the L1 burst-growth scale, or hit flashes
 * (the returned bodyMat facade fans `emissive`/`emissiveIntensity` writes
 * out to every material in the GLB).
 *
 * Animation clips (exact names, case-sensitive): `Patrol`, `Chase`,
 * `Attack`, `Death`, `Idle`. Missing clips degrade: a state with no clip
 * plays `Idle`, and with no clips at all the model is simply static.
 * With a `Death` clip present, MonsterAI skips its rigid topple and lets
 * the clip carry the death (see `hasDeathClip`).
 *
 * Blender weak-point anchors: empty objects or bones named exactly
 * `WeakPoint_Chest`, `WeakPoint_Right`, `WeakPoint_Left` — the glowing
 * spheres ride them through the animation. Without anchors the spheres sit
 * at the procedural offsets on the wrapper.
 *
 * If the GLB is absent (AssetLibrary got no file), this returns the
 * CharacterFactory creature unchanged — the game plays identically.
 */
import * as THREE from 'three';
import AssetLibrary from './AssetLibrary.js';
import { createMonster } from './CharacterFactory.js';

// ── Normalisation constants (mirror the procedural creature) ────────────────
const FEET_Y = -0.55;      // wrapper-local ground line of the creature
const STAND_HEIGHT = 2.45; // feet → crown, in local units
/**
 * Rotation applied to the imported scene to face +Z. Blender front-view
 * exports normally arrive facing +Z already (FACE_YAW = 0). If the creature
 * moonwalks, the export faces -Z — flip this to Math.PI.
 */
const FACE_YAW = 0;

/** MonsterAI state → clip name (see header). */
const CLIP_FOR_STATE = {
  patrol: 'Patrol',
  chase: 'Chase',
  attack: 'Attack',
  dead: 'Death',
};

/** Blender anchor names and procedural fallback offsets, index-matched. */
const WP_ANCHOR_NAMES = ['WeakPoint_Chest', 'WeakPoint_Right', 'WeakPoint_Left'];
const WP_FALLBACK_OFFSETS = [
  { x: 0, y: 1.6, z: 0.62 },   // chest (front — faces the player in chase)
  { x: 0.55, y: 0.8, z: 0 },   // right flank
  { x: -0.55, y: 0.8, z: 0 },  // left flank
];

/**
 * Build the creature: Blender GLB when the AssetLibrary has one, otherwise
 * the procedural CharacterFactory monster.
 * @returns {{group: THREE.Group, update: Function, hitMeshes: THREE.Mesh[],
 *            weakPoints: THREE.Mesh[], bodyMat: object, hasDeathClip: boolean}}
 */
export function createMonsterModel() {
  const gltf = AssetLibrary.getModel('monster');
  if (!gltf) return createMonster(); // fallback — no file, no changes

  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  // ── Normalise into the procedural creature's local space ────────────────
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const s = size.y > 0.01 ? STAND_HEIGHT / size.y : 1;
  scene.scale.setScalar(s);
  // Centre on the origin, drop the feet onto FEET_Y, face +Z.
  scene.position.set(
    -(box.min.x + box.max.x) * 0.5 * s,
    FEET_Y - box.min.y * s,
    -(box.min.z + box.max.z) * 0.5 * s
  );
  scene.rotation.y = FACE_YAW;

  // Skinned meshes deform outside their static bounds — never cull them.
  scene.traverse((o) => {
    if (o.isSkinnedMesh) o.frustumCulled = false;
  });

  const wrapper = new THREE.Group();
  wrapper.add(scene);

  // ── Animation mixer with per-state action resolution ────────────────────
  const mixer = gltf.animations && gltf.animations.length > 0
    ? new THREE.AnimationMixer(scene)
    : null;
  const actions = {};
  const findClip = (name) =>
    gltf.animations ? THREE.AnimationClip.findByName(gltf.animations, name) : null;
  const idleClip = findClip('Idle');
  for (const [state, clipName] of Object.entries(CLIP_FOR_STATE)) {
    const clip = findClip(clipName) || idleClip;
    if (clip && mixer) actions[state] = mixer.clipAction(clip);
  }
  if (mixer && idleClip) actions.idle = mixer.clipAction(idleClip);

  // Crossfade between clips like OperatorModel; only the entry clip plays.
  let current = null;
  const play = (name) => {
    const next = actions[name];
    if (!next || current === name) return;
    const prev = current ? actions[current] : null;
    next.reset().fadeIn(0.22).play();
    if (prev) prev.fadeOut(0.22);
    current = name;
  };
  play('patrol'); // park on the patrol clip (or Idle fallback)

  const hasDeathClip = !!findClip('Death');

  // ── Weak points — same mesh recipe and userData as CharacterFactory ─────
  const wpGeo = new THREE.SphereGeometry(0.28, 10, 10);
  const weakPoints = [];
  for (let i = 0; i < 3; i++) {
    const wpMat = new THREE.MeshStandardMaterial({
      color: 0xff3333,
      emissive: 0xff3333,
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.6,
    });
    const wpMesh = new THREE.Mesh(wpGeo, wpMat);
    wpMesh.userData.pulseTarget = true;
    wpMesh.userData.pulseType = 'weakpoint';
    wpMesh.userData.weakPointIndex = i;
    wpMesh.userData.destroyed = false;

    // Prefer Blender anchors (empties or bones) so the spheres ride the
    // animation; fall back to the procedural offsets on the wrapper.
    const anchor = scene.getObjectByName(WP_ANCHOR_NAMES[i]);
    if (anchor) {
      anchor.add(wpMesh);
    } else {
      const off = WP_FALLBACK_OFFSETS[i];
      wpMesh.position.set(off.x, off.y, off.z);
      wrapper.add(wpMesh);
    }
    weakPoints.push(wpMesh);
  }

  // ── Hit meshes — the largest body meshes, tagged for impact feedback ────
  const bodyMeshes = [];
  scene.traverse((o) => { if (o.isSkinnedMesh) bodyMeshes.push(o); });
  if (bodyMeshes.length === 0) scene.traverse((o) => { if (o.isMesh) bodyMeshes.push(o); });
  for (const m of bodyMeshes) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
  }
  const _size = new THREE.Vector3();
  const span = (m) => m.geometry.boundingBox.getSize(_size).length();
  bodyMeshes.sort((a, b) => span(b) - span(a));
  const hitMeshes = bodyMeshes.slice(0, 2);
  for (const m of hitMeshes) {
    m.userData.pulseTarget = true;
    m.userData.pulseType = 'monsterBody';
  }

  // ── Body material facade — fans MonsterAI's hit-flash writes to the GLB ──
  const flashMats = [];
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m && m.emissive !== undefined && !seen.has(m)) {
        seen.add(m);
        flashMats.push(m);
      }
    }
  });
  const bodyMat = {
    emissive: {
      setHex(hex) { for (const m of flashMats) m.emissive.setHex(hex); },
    },
    get emissiveIntensity() {
      return flashMats.length ? flashMats[0].emissiveIntensity : 0;
    },
    set emissiveIntensity(v) {
      for (const m of flashMats) m.emissiveIntensity = v;
    },
  };

  /**
   * Per-frame animation drive — the MonsterAI contract.
   * @param {number} dt
   * @param {'patrol'|'chase'|'attack'|'dead'} state
   * @param {object} [vel] physics velocity (unused — clips carry the motion)
   */
  const update = (dt, state) => {
    if (!mixer) return;
    play(CLIP_FOR_STATE[state] ? state : 'patrol');
    mixer.update(dt);
  };

  return { group: wrapper, update, hitMeshes, weakPoints, bodyMat, hasDeathClip };
}
