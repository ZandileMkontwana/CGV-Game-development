/**
 * WeaponViewmodel — the CoD-style first-person pulse rifle.
 *
 * A rifle mesh parented to the camera so it never clips into walls, with:
 *   - hip → ADS (aim) pose blending driven by RMB,
 *   - mouse-lag sway, walk/sprint bob, idle breathing,
 *   - recoil kick + muzzle flash on every shot,
 *   - a small fill light so the weapon stays readable in dark corridors.
 *
 * Hidden in third person (the operator's body takes over).
 */
import * as THREE from 'three';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, ...o });

/**
 * Build a tactical pulse rifle. Forward is -Z (camera convention).
 * Exported so third person can clip a scaled copy into the operator's hand.
 * @param {number} scale
 * @returns {THREE.Group}
 */
export function buildRifle(scale = 1) {
  const g = new THREE.Group();
  const gunmetal = std(0x2b2f34, { metalness: 0.78, roughness: 0.34 });
  const polymer = std(0x17191c, { roughness: 0.92, metalness: 0.05 });
  const gripMat = std(0x101214, { roughness: 0.95 });
  const accent = std(0x0a2530, { emissive: 0x2fd9ff, emissiveIntensity: 1.4, roughness: 0.3 });
  const dot = std(0x330000, { emissive: 0xff2a1a, emissiveIntensity: 3 });

  const add = (geo, mat, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    g.add(m);
    return m;
  };

  // Receiver + top rail.
  add(new THREE.BoxGeometry(0.06, 0.09, 0.34), gunmetal, 0, 0, -0.02);
  add(new THREE.BoxGeometry(0.03, 0.02, 0.4), gunmetal, 0, 0.055, -0.06);
  // Handguard + barrel + muzzle brake.
  add(new THREE.BoxGeometry(0.052, 0.06, 0.26), polymer, 0, 0.005, -0.3);
  add(new THREE.CylinderGeometry(0.013, 0.013, 0.24, 10), gunmetal, 0, 0.012, -0.5, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.02, 0.017, 0.07, 10), gunmetal, 0, 0.012, -0.63, Math.PI / 2);
  // Magazine (slight forward rake).
  const mag = add(new THREE.BoxGeometry(0.034, 0.15, 0.07), polymer, 0, -0.11, -0.04);
  mag.rotation.x = 0.22;
  // Pistol grip + trigger guard.
  const grip = add(new THREE.BoxGeometry(0.035, 0.11, 0.05), gripMat, 0, -0.09, 0.1);
  grip.rotation.x = -0.35;
  add(new THREE.BoxGeometry(0.03, 0.012, 0.09), gunmetal, 0, -0.045, 0.05);
  // Stock.
  add(new THREE.BoxGeometry(0.045, 0.07, 0.2), polymer, 0, -0.005, 0.24);
  add(new THREE.BoxGeometry(0.05, 0.11, 0.03), gripMat, 0, -0.02, 0.35);
  // Holo sight ring + red dot (ADS reference point).
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.006, 8, 18), gunmetal);
  ring.position.set(0, 0.085, -0.08);
  g.add(ring);
  const sightDot = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 6), dot);
  sightDot.position.set(0, 0.085, -0.09);
  g.add(sightDot);
  // Pulse energy cell — ties the rifle to the PulseTool lore.
  add(new THREE.BoxGeometry(0.015, 0.05, 0.12), accent, 0.038, 0.01, -0.05);
  add(new THREE.BoxGeometry(0.015, 0.05, 0.12), accent, -0.038, 0.01, -0.05);

  g.scale.setScalar(scale);
  return g;
}

export default class WeaponViewmodel {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('./InputManager.js').default} input
   */
  constructor(camera, input) {
    this.input = input;
    this.group = new THREE.Group();
    this.rifle = buildRifle(1);
    this.group.add(this.rifle);

    // Fill light so the weapon reads even in unlit corners (cheap, no shadows).
    this._fill = new THREE.PointLight(0xbfd4ff, 0.35, 2.2, 1.8);
    this._fill.position.set(0.3, 0.15, -0.1);
    this.group.add(this._fill);

    // Muzzle flash — spikes on fire, decays exponentially.
    this._flash = new THREE.PointLight(0x66ddff, 0, 3.5, 1.8);
    this._flash.position.set(0, 0.012, -0.66);
    this.group.add(this._flash);

    camera.add(this.group);

    this._hip = new THREE.Vector3(0.26, -0.24, -0.5);
    this._ads = new THREE.Vector3(0.0, -0.172, -0.34);
    this._pos = new THREE.Vector3();
    this._aimBlend = 0;
    this._kick = 0;
    this._phase = 0;
    this._swayX = 0;
    this._swayY = 0;
    this.group.visible = false;
  }

  /** Called on every shot — recoil kick + muzzle flash. */
  fire() {
    this._kick = 1;
    this._flash.intensity = 24;
  }

  setVisible(v) {
    this.group.visible = v;
  }

  /**
   * @param {number} dt
   * @param {{moving:boolean, sprinting:boolean, aiming:boolean}} s
   */
  update(dt, s) {
    // Aim blend.
    this._aimBlend += ((s.aiming ? 1 : 0) - this._aimBlend) * Math.min(1, dt * 12);

    // Mouse-lag sway — the rifle trails behind the camera turn.
    const blend = Math.min(1, dt * 9);
    this._swayX += (-(this.input.mouse.dx || 0) * 0.00045 - this._swayX) * blend;
    this._swayY += (-(this.input.mouse.dy || 0) * 0.0004 - this._swayY) * blend;

    // Bob: fast wide when sprinting, gentle when walking, breathing when still.
    if (s.moving) this._phase += dt * (s.sprinting ? 11 : 7.5);
    const bobAmt = s.moving ? (s.sprinting ? 0.013 : 0.007) : 0.0022;
    const bobScale = 1 - this._aimBlend * 0.85;
    const bobX = Math.sin(this._phase) * bobAmt * bobScale;
    const bobY = Math.abs(Math.cos(this._phase)) * bobAmt * bobScale;

    // Sprint pose: rifle lowers and cants slightly (keeps FOV-wide sprint legible).
    const sprintPose = s.sprinting && s.moving ? 1 : 0;

    this._kick *= Math.exp(-14 * dt);
    this._flash.intensity *= Math.exp(-22 * dt);

    this._pos.lerpVectors(this._hip, this._ads, this._aimBlend);
    this.group.position.set(
      this._pos.x + this._swayX * (1 - this._aimBlend) + bobX,
      this._pos.y + this._swayY * (1 - this._aimBlend) + bobY - sprintPose * 0.06,
      this._pos.z + this._kick * 0.07
    );
    this.group.rotation.set(
      this._kick * 0.06 + this._swayY * 2.2 - sprintPose * 0.5,
      this._swayX * 2.4 + sprintPose * 0.35,
      this._swayX * 1.2 + sprintPose * 0.25
    );
  }

  dispose() {
    this.rifle.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
