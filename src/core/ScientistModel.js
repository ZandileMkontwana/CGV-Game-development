/**
 * ScientistModel — the Blender-built lab NPC, with procedural fallback.
 *
 * Loads `public/assets/models/scientist.glb` through the AssetLibrary and
 * normalises it into the CharacterFactory scientist's local space: origin on
 * the floor beneath the seated figure, facing +Z at yaw 0 (Game.js applies
 * the world placement and `faceToRotY` orientation from the npcAnchor).
 *
 * Animation clips (exact names, case-sensitive): `Type` (typing loop),
 * `Cower` (doubles over), `Mutate` (the convulsion — Game.js drives the red
 * strobe light and timing around it). Missing clips degrade to holding the
 * first available clip; with no clips the model is a static prop.
 *
 * The update contract matches createScientist exactly:
 *   update(dt, state) where state = { mode: 'type' | 'cower' | 'mutate' }
 *
 * If the GLB is absent, this returns the CharacterFactory scientist
 * unchanged — the Level 1 reveal beat plays identically.
 */
import * as THREE from 'three';
import AssetLibrary from './AssetLibrary.js';
import { createScientist } from './CharacterFactory.js';

/** Seated height target in metres (matches the procedural scientist). */
const SEATED_HEIGHT = 1.5;
/**
 * Rotation applied to the imported scene to face +Z. Blender front-view
 * exports normally arrive facing +Z already. If the scientist shows the
 * console his back, flip this to Math.PI.
 */
const FACE_YAW = 0;

/** NPC mode → clip name (see header). */
const CLIP_FOR_MODE = {
  type: 'Type',
  cower: 'Cower',
  mutate: 'Mutate',
};

/**
 * Build the scientist: Blender GLB when the AssetLibrary has one, otherwise
 * the procedural CharacterFactory scientist.
 * @returns {{group: THREE.Group, update: Function}}
 */
export function createScientistModel() {
  const gltf = AssetLibrary.getModel('scientist');
  if (!gltf) return createScientist(); // fallback — no file, no changes

  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  // ── Normalise: floor origin, centred, facing +Z, seated scale ────────────
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const s = size.y > 0.01 ? SEATED_HEIGHT / size.y : 1;
  scene.scale.multiplyScalar(s); // multiply, not set — exports may carry a root scale
  scene.position.set(
    -(box.min.x + box.max.x) * 0.5 * s,
    -box.min.y * s,
    -(box.min.z + box.max.z) * 0.5 * s
  );
  scene.rotation.y = FACE_YAW;

  // Skinned meshes deform outside their static bounds — never cull them.
  scene.traverse((o) => {
    if (o.isSkinnedMesh) o.frustumCulled = false;
  });

  const group = new THREE.Group();
  group.add(scene);

  // ── Animation mixer with per-mode action resolution ─────────────────────
  const mixer = gltf.animations && gltf.animations.length > 0
    ? new THREE.AnimationMixer(scene)
    : null;
  const actions = {};
  if (mixer) {
    for (const [mode, clipName] of Object.entries(CLIP_FOR_MODE)) {
      const clip = THREE.AnimationClip.findByName(gltf.animations, clipName);
      if (clip) actions[mode] = mixer.clipAction(clip);
    }
  }

  // Crossfade between modes; park on the first available clip (Type).
  let current = null;
  const play = (name) => {
    const next = actions[name];
    if (!next || current === name) return;
    const prev = current ? actions[current] : null;
    next.reset().fadeIn(0.3).play();
    if (prev) prev.fadeOut(0.3);
    current = name;
  };
  play('type');

  /**
   * Per-frame animation drive — the createScientist contract.
   * @param {number} dt
   * @param {{mode: string}} state
   */
  const update = (dt, state) => {
    if (!mixer) return;
    const mode = CLIP_FOR_MODE[state.mode] ? state.mode : 'type';
    play(mode);
    mixer.update(dt);
  };

  return { group, update };
}
