/**
 * AssetLibrary — preload and serve real game assets.
 *
 * The game ships with procedural fallbacks for every character, prop,
 * texture and sound (see CharacterFactory / LevelKit / LevelMaterials /
 * AudioManager). This module preloads the authored assets that REPLACE
 * those fallbacks when present:
 *
 *   models   → public/assets/models/*.glb        (Blender exports)
 *   textures → public/assets/textures/*.jpg      (PBR map sets per theme)
 *   audio    → public/assets/audio/*.{ogg|mp3}   (sampled cues)
 *
 * Every file in the manifest is OPTIONAL. A missing file resolves to null
 * and the consumer silently keeps its procedural build — a checkout without
 * assets is still fully playable. Loading happens once, before the engine
 * constructs (main.js awaits preload), so consumers can read the maps
 * synchronously at build time.
 *
 * Ids are stable API: 'monster', 'props/crate', 'lab_wall_col', 'roar', …
 *
 * Manifest values may list several candidate paths per id (canonical export
 * first, a teammate's drop-in folder such as public/models/ second); the
 * loader tries them in order and keeps the first that loads.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Credit roll for the menu's credits screen and CREDITS.md.
 * Updated as real files land in public/assets/.
 */
export const CREDITS = [
  { asset: 'Monster, scientist, engineer, rifle & prop models', author: 'CGV team (Blender)', license: 'Made for this project' },
  { asset: 'Environment PBR texture sets', author: 'CGV team (Blender bakes)', license: 'Made for this project' },
  { asset: 'Sampled sound cues', author: 'CGV team', license: 'Made for this project' },
  { asset: 'Soldier.glb (third-person operator fallback)', author: 'three.js examples', license: 'Three.js examples' },
  { asset: 'three.js', author: 'mrdoob & contributors', license: 'MIT' },
  { asset: 'cannon-es', author: 'pmndrs', license: 'MIT' },
  { asset: 'Vite', author: 'Evan You & Vite team', license: 'MIT' },
  { asset: 'Procedural fallback art, levels & soundscape', author: 'CGV team', license: 'Made for this project' },
];

/**
 * Manifest of optional assets. Paths are relative (vite base './') so the
 * LAMP deployment under a subdirectory keeps working. A model value may be
 * a single path or a list of candidates tried in order — the first entry is
 * the canonical export location, later entries pick up Blender drops that
 * landed under public/models/ in the meantime.
 * Texture ids carry the map role suffix: _col (albedo), _nrm, _rgh.
 */
const MANIFEST = {
  models: {
    'monster': 'assets/models/monster.glb',
    'scientist': 'assets/models/scientist.glb',
    'engineer': 'assets/models/engineer.glb',
    'pulse_rifle': 'assets/models/pulse_rifle.glb',
    'props/console_desk': ['assets/models/props/console_desk.glb', 'models/console.glb'],
    'props/chair': 'assets/models/props/chair.glb',
    'props/server_rack': 'assets/models/props/server_rack.glb',
    'props/containment_tube': ['assets/models/props/containment_tube.glb', 'models/containment_tube.glb'],
    'props/reactor_core': 'assets/models/props/reactor_core.glb',
    'props/crate': 'assets/models/props/crate.glb',
    'props/barrel': 'assets/models/props/barrel.glb',
    'props/cabinet': 'assets/models/props/cabinet.glb',
    'props/locker_bank': 'assets/models/props/locker_bank.glb',
    'props/locker': ['assets/models/props/locker.glb', 'models/locker.glb'],
    'props/lab_bench': 'assets/models/props/lab_bench.glb',
    'props/ceiling_light': ['assets/models/props/ceiling_light.glb', 'models/ceiling_light.glb'],
  },
  textures: {
    // Level 1 — clean lab
    'lab_wall_col': 'assets/textures/lab_wall_col.jpg',
    'lab_wall_nrm': 'assets/textures/lab_wall_nrm.jpg',
    'lab_wall_rgh': 'assets/textures/lab_wall_rgh.jpg',
    'lab_floor_col': 'assets/textures/lab_floor_col.jpg',
    'lab_floor_nrm': 'assets/textures/lab_floor_nrm.jpg',
    'lab_floor_rgh': 'assets/textures/lab_floor_rgh.jpg',
    'lab_trim_col': 'assets/textures/lab_trim_col.jpg',
    'lab_trim_nrm': 'assets/textures/lab_trim_nrm.jpg',
    'lab_trim_rgh': 'assets/textures/lab_trim_rgh.jpg',
    // Level 2 — damaged
    'damaged_wall_col': 'assets/textures/damaged_wall_col.jpg',
    'damaged_wall_nrm': 'assets/textures/damaged_wall_nrm.jpg',
    'damaged_wall_rgh': 'assets/textures/damaged_wall_rgh.jpg',
    'damaged_floor_col': 'assets/textures/damaged_floor_col.jpg',
    'damaged_floor_nrm': 'assets/textures/damaged_floor_nrm.jpg',
    'damaged_floor_rgh': 'assets/textures/damaged_floor_rgh.jpg',
    'damaged_trim_col': 'assets/textures/damaged_trim_col.jpg',
    'damaged_trim_nrm': 'assets/textures/damaged_trim_nrm.jpg',
    'damaged_trim_rgh': 'assets/textures/damaged_trim_rgh.jpg',
    // Level 3 — emergency / scorched
    'emergency_wall_col': 'assets/textures/emergency_wall_col.jpg',
    'emergency_wall_nrm': 'assets/textures/emergency_wall_nrm.jpg',
    'emergency_wall_rgh': 'assets/textures/emergency_wall_rgh.jpg',
    'emergency_floor_col': 'assets/textures/emergency_floor_col.jpg',
    'emergency_floor_nrm': 'assets/textures/emergency_floor_nrm.jpg',
    'emergency_floor_rgh': 'assets/textures/emergency_floor_rgh.jpg',
    'emergency_trim_col': 'assets/textures/emergency_trim_col.jpg',
    'emergency_trim_nrm': 'assets/textures/emergency_trim_nrm.jpg',
    'emergency_trim_rgh': 'assets/textures/emergency_trim_rgh.jpg',
  },
  audio: {
    'roar': 'assets/audio/roar',
    'spotted': 'assets/audio/spotted',
    'jumpscare': 'assets/audio/jumpscare',
    'attack': 'assets/audio/attack',
    'transform': 'assets/audio/transform',
    'alarm': 'assets/audio/alarm',
    'death': 'assets/audio/death',
    'door_open': 'assets/audio/door_open',
    'collapse': 'assets/audio/collapse',
    'win': 'assets/audio/win',
    'gameover': 'assets/audio/gameover',
    'growl': 'assets/audio/growl',
  },
};

/** Hard cap on preload time — after this, whatever arrived is used. */
const PRELOAD_TIMEOUT_MS = 15000;

/**
 * Load the first URL that resolves. Manifest candidates are tried in order
 * so a canonical export overrides a drop-in copy of the same prop.
 * Resolves null when every candidate fails.
 */
function loadFirst(gltfLoader, urls) {
  return new Promise((resolve) => {
    const attempt = (i) => {
      if (i >= urls.length) { resolve(null); return; }
      gltfLoader.load(urls[i], resolve, undefined, () => attempt(i + 1));
    };
    attempt(0);
  });
}

class AssetLibrary {
  constructor() {
    /** @type {Map<string, object>} id → gltf ({scene, animations, …}) */
    this._models = new Map();
    /** @type {Map<string, THREE.Texture>} id → texture */
    this._textures = new Map();
    /** @type {Map<string, ArrayBuffer>} id → raw encoded audio (decoded by AudioManager) */
    this._audio = new Map();
    this._total = 0;
    this._settled = 0;
    this._onProgress = null;
    this._donePromise = null;
  }

  /**
   * Kick off (or return the running) preload of every manifest entry.
   * Never rejects: each load resolves with null on failure, so the game
   * always boots — missing files simply keep their procedural fallbacks.
   * @param {(settled: number, total: number) => void} [onProgress]
   * @returns {Promise<void>} resolves when all entries settled (or timed out)
   */
  preload(onProgress) {
    if (this._donePromise) return this._donePromise;
    this._onProgress = onProgress || null;

    const gltfLoader = new GLTFLoader();
    const texLoader = new THREE.TextureLoader();
    const tasks = [];

    const settle = () => {
      this._settled++;
      if (this._onProgress) this._onProgress(this._settled, this._total);
    };

    // Models — store the whole gltf (scene + animations + clips).
    for (const [id, paths] of Object.entries(MANIFEST.models)) {
      this._total++;
      const urls = Array.isArray(paths) ? paths : [paths];
      tasks.push(loadFirst(gltfLoader, urls).then((gltf) => {
        if (gltf) {
          // Uniform defaults matching the procedural art's look; per-model
          // tweaks (e.g. frustumCulled=false for skinned meshes) stay with
          // the consumers.
          const lights = [];
          gltf.scene.traverse((o) => {
            if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
            else if (o.isLight) lights.push(o);
          });
          // Exported lights are stripped: every clone of a prop would add its
          // own, and gameplay lighting is owned by LevelKit/Game (flicker,
          // alarms). Removing them once here covers all clones.
          for (const l of lights) l.parent?.remove(l);
          this._models.set(id, gltf);
        }
        settle();
      }));
    }

    // Textures — colour space by suffix, repeat-wrapped for level materials.
    for (const [id, url] of Object.entries(MANIFEST.textures)) {
      this._total++;
      tasks.push(new Promise((resolve) => {
        texLoader.load(url,
          (tex) => {
            tex.colorSpace = id.endsWith('_col') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.anisotropy = 4;
            this._textures.set(id, tex);
            resolve();
          },
          undefined,
          () => resolve());
      }).then(settle));
    }

    // Audio — raw ArrayBuffers; AudioManager decodes once its context is
    // unlocked by a user gesture. Tries .ogg then .mp3.
    for (const [id, base] of Object.entries(MANIFEST.audio)) {
      this._total++;
      tasks.push(this._loadAudio(id, base).then(settle));
    }

    this._allSettled = Promise.all(tasks);
    this._donePromise = Promise.race([
      this._allSettled,
      new Promise((resolve) => setTimeout(resolve, PRELOAD_TIMEOUT_MS)),
    ]);
    return this._donePromise;
  }

  /** Fetch one cue, preferring ogg (smaller) then mp3 (wider support). */
  async _loadAudio(id, base) {
    for (const ext of ['ogg', 'mp3']) {
      try {
        const res = await fetch(`${base}.${ext}`);
        if (res.ok) {
          this._audio.set(id, await res.arrayBuffer());
          return;
        }
      } catch { /* network hiccup — try the next extension */ }
    }
  }

  // ── Accessors (synchronous — call after preload, or accept null) ─────────

  /**
   * The loaded gltf for a singleton character (monster/scientist/engineer).
   * The caller OWNS the scene from here on — it is moved, not cloned.
   * @returns {object|null} gltf with {scene, animations}
   */
  getModel(id) {
    return this._models.get(id) || null;
  }

  /**
   * A fresh clone of a prop model for independent placement. Safe for static
   * meshes; skinned characters must NOT use this (skeletons don't survive a
   * plain clone — take the singleton via getModel instead).
   * @returns {THREE.Group|null}
   */
  cloneModel(id) {
    const gltf = this._models.get(id);
    return gltf ? gltf.scene.clone(true) : null;
  }

  /** @returns {THREE.Texture|null} */
  getTexture(id) {
    return this._textures.get(id) || null;
  }

  /** @returns {ArrayBuffer|null} raw encoded audio for AudioManager */
  getAudio(id) {
    return this._audio.get(id) || null;
  }

  /** Preload stats for debug HUD / dev console. */
  get stats() {
    return {
      total: this._total,
      loaded: this._models.size + this._textures.size + this._audio.size,
      models: this._models.size,
      textures: this._textures.size,
      audio: this._audio.size,
    };
  }
}

export default new AssetLibrary(); // module singleton
