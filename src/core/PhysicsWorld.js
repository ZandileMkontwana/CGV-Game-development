import * as CANNON from 'cannon-es';

/**
 * PhysicsWorld — thin wrapper around cannon-es.
 *
 * Provides the simulation world, a ground plane, and helpers for
 * creating bodies.  Other systems call `step(dt)` each frame.
 */
export default class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
    });

    // Broadphase is faster than the default NaiveBroadphase.
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);

    // Default contact material — slight friction, no bounce.
    this.defaultMaterial = new CANNON.Material('default');
    const contact = new CANNON.ContactMaterial(
      this.defaultMaterial,
      this.defaultMaterial,
      { friction: 0.4, restitution: 0.1 }
    );
    this.world.addContactMaterial(contact);
    this.world.defaultContactMaterial = contact;

    // Actors (player, monster) set their velocity directly every frame —
    // ground friction then fights that target and the body crawls at a
    // fraction of its intended speed. Zero-friction contacts for actors
    // let the controllers own accel/decel themselves.
    this.actorMaterial = new CANNON.Material('actor');
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.actorMaterial, this.defaultMaterial,
      { friction: 0.0, restitution: 0.0 }
    ));

    // Static ground plane (y = 0).
    const groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
      material: this.defaultMaterial,
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(groundBody);

    /** Bodies that should be synced with Three.js meshes each frame. */
    this.syncPairs = []; // { body, mesh }
  }

  /**
   * Create a box-shaped rigid body.
   * @param {number} mass  0 = static, >0 = dynamic
   * @param {number} hx    half-extent x
   * @param {number} hy    half-extent y
   * @param {number} hz    half-extent z
   * @param {CANNON.Vec3} position
   */
  createBox(mass, hx, hy, hz, position) {
    const body = new CANNON.Body({
      mass,
      shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
      material: this.defaultMaterial,
      position,
    });
    this.world.addBody(body);
    return body;
  }

  /** Register a body↔mesh pair so `sync` copies the transform each frame. */
  addSyncPair(body, mesh) {
    this.syncPairs.push({ body, mesh });
  }

  /** Advance the simulation and copy transforms to meshes. */
  step(dt) {
    // Fixed timestep with interpolation. maxSubSteps must cover the worst
    // frame (0.2s / 60Hz = 12) or the sim falls behind real time and
    // movement looks like slow motion on low-end machines. CPU cost per
    // substep is trivial for this scene size — the GPU is the bottleneck.
    this.world.step(1 / 60, dt, 12);

    for (const { body, mesh } of this.syncPairs) {
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
    }
  }
}
