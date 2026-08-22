/**
 * LevelManager — Person B's domain.
 *
 * Responsible for building and managing the three reactor-station levels.
 * Each level method should add geometry, physics bodies, and gameplay
 * elements to the provided scene and physics world.
 *
 * Conventions:
 *   - 1 unit = 1 metre
 *   - Corridor width: 4m, height: 3m
 *   - Asset filenames: lowercase, hyphen-separated, no spaces
 *   - Every mesh that collides needs a matching physics body
 */
export default class LevelManager {
  /**
   * @param {import('three').Scene} scene
   * @param {import('../core/PhysicsWorld.js').default} physics
   */
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;

    /** Currently loaded level objects — dispose before loading a new level. */
    this._disposables = [];
  }

  /**
   * Load a level by number (1, 2, or 3).
   * Tears down the previous level first.
   * @param {number} levelNum
   */
  load(levelNum) {
    this._teardown();

    switch (levelNum) {
      case 1: this._buildLevel1(); break;
      case 2: this._buildLevel2(); break;
      case 3: this._buildLevel3(); break;
      default: throw new Error(`Unknown level: ${levelNum}`);
    }
  }

  /** Dispose GPU resources and physics bodies from the current level. */
  _teardown() {
    for (const entry of this._disposables) {
      if (entry.mesh) {
        if (entry.mesh.geometry) entry.mesh.geometry.dispose();
        if (entry.mesh.material) {
          if (entry.mesh.material.map) entry.mesh.material.map.dispose();
          entry.mesh.material.dispose();
        }
        this.scene.remove(entry.mesh);
      }
      if (entry.body) {
        this.physics.world.removeBody(entry.body);
      }
    }
    this._disposables = [];
  }

  // ── Level 1: Exploration — clean, brightly-lit corridors ─────────────
  _buildLevel1() {
    // TODO (Person B): Build the pristine station.
    // - Modular corridor pieces (straight, T-junction, corner, room)
    // - Control panels, signage, doors
    // - Navigation path to establish the world
    // - Register each mesh+body with this._track(mesh, body)
  }

  // ── Level 2: Failing station — hazards, timing ──────────────────────
  _buildLevel2() {
    // TODO (Person B): Same geometry but damaged.
    // - Broken panels, sparking conduits
    // - Coolant vent obstacles (timed jets)
    // - Rotating hazards (animated meshes)
    // - Heat-haze shader zones (coordinate with Person C)
  }

  // ── Level 3: Meltdown — chaos, boss arena ────────────────────────────
  _buildLevel3() {
    // TODO (Person B): Structural collapse + boss encounter.
    // - Debris, collapsed ceiling sections
    // - Boss entity (malfunctioning core or security drone)
    //   - Animated, with hit points or destruction sequence
    // - Dissolve shader targets (coordinate with Person C)
    // - Escape route geometry
  }

  /**
   * Register a mesh + optional physics body for cleanup.
   * Call this for every object you add so _teardown can dispose it.
   */
  _track(mesh, body = null) {
    this._disposables.push({ mesh, body });
  }
}
