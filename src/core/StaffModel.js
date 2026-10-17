import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PROFILES = {
  tech: { skin: 0xa97350, hair: 0x25201c, shirt: 0x799da4, trim: 0x258891 },
  coat: { skin: 0xd4a27b, hair: 0x55483b, shirt: 0x7295ab, trim: 0x387eaa },
  supervisor: { skin: 0x875139, hair: 0x494643, shirt: 0x9095a7, trim: 0x8b638f },
  security: { skin: 0xc29171, hair: 0x312820, shirt: 0x789887, trim: 0x45836b },
};

/** Coat-wearing researchers, with a compact skinned mesh and independent joints. */
export default class StaffModel {
  constructor(role = 'tech') {
    this.role = role;
    this.group = new THREE.Group();
    this.group.name = `scientist-${role}`;
    this.ready = true;
    this._time = this._phase = this._move = this._panic = 0;
    this._disposed = false;
    this._current = 'idle';
    const profile = PROFILES[role] || PROFILES.tech;
    const material = (name, color) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
      m.name = name;
      return m;
    };
    const coat = material('lab-coat', 0xeff1ed);
    coat.side = THREE.DoubleSide;
    const seam = material('coat-seams', 0xcbd4d0);
    const shirt = material('shirt', profile.shirt);
    const trousers = material('trousers-and-shoes', 0x29343c);
    const skin = material('skin', profile.skin);
    const hair = material('hair-and-glasses', profile.hair);
    const trim = material('department-and-pen', profile.trim);
    this._materials = [coat, seam, shirt, trousers, skin, hair, trim];
    this._bones = [];
    this._limbs = [];
    this.joints = {};
    const parts = [];
    const bone = (parent, name, x, y, z) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      parent.add(b);
      this._bones.push(b);
      this.joints[name] = b;
      return b;
    };
    const part = (parent, geometry, mat, x, y, z, scale) => {
      const object = new THREE.Mesh(geometry, mat);
      object.position.set(x, y, z);
      if (scale) object.scale.set(...scale);
      parent.add(object);
      parts.push(object);
      return object;
    };
    const box = (parent, mat, w, h, d, x, y, z) => part(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
    const oval = (parent, mat, rx, ry, rz, x, y, z) => part(parent, new THREE.SphereGeometry(1, 12, 8), mat, x, y, z, [rx, ry, rz]);
    const taper = (parent, mat, top, bottom, length, x, y, z, depth = 1) =>
      part(parent, new THREE.CylinderGeometry(top, bottom, length, 12), mat, x, y, z, [1, 1, depth]);

    const pelvis = bone(this.group, 'pelvis', 0, 0.91, 0);
    oval(pelvis, trousers, 0.19, 0.13, 0.12, 0, 0, 0);
    const torso = bone(pelvis, 'torso', 0, 0.01, 0);
    taper(torso, coat, 0.23, 0.19, 0.51, 0, 0.255, 0, 0.64);
    // An open coat over a shirt, with sewn lapels rather than body armour.
    box(torso, shirt, 0.13, 0.40, 0.025, 0, 0.28, 0.145);
    for (const s of [-1, 1]) {
      const lapel = box(torso, coat, 0.065, 0.22, 0.025, s * 0.075, 0.38, 0.165);
      lapel.rotation.z = -s * 0.25;
      box(torso, seam, 0.065, 0.008, 0.013, s * 0.145, 0.07, 0.132);
      box(torso, coat, 0.075, 0.09, 0.018, s * 0.145, 0.12, 0.132);
    }
    box(torso, coat, 0.075, 0.085, 0.02, -0.135, 0.32, 0.138);
    box(torso, trim, 0.009, 0.065, 0.012, -0.14, 0.37, 0.155);
    box(torso, hair, 0.009, 0.06, 0.012, -0.12, 0.365, 0.155);
    box(torso, seam, 0.06, 0.08, 0.018, 0.135, 0.34, 0.145);
    box(torso, trim, 0.06, 0.018, 0.02, 0.135, 0.36, 0.151);
    box(torso, hair, 0.026, 0.024, 0.02, 0.12, 0.325, 0.153);
    for (const y of [0.08, 0.19, 0.29]) oval(torso, seam, 0.009, 0.009, 0.007, 0.055, y, 0.16);

    taper(torso, skin, 0.055, 0.065, 0.105, 0, 0.545, 0);
    const head = bone(torso, 'head', 0, 0.58, 0);
    oval(head, skin, 0.099, 0.132, 0.102, 0, 0.115, 0.008);
    oval(head, skin, 0.07, 0.065, 0.086, 0, 0.038, 0.025);
    oval(head, hair, 0.102, 0.068, 0.105, 0, 0.193, -0.009);
    oval(head, skin, 0.021, 0.035, 0.033, 0, 0.105, 0.103);
    for (const s of [-1, 1]) {
      oval(head, skin, 0.018, 0.034, 0.022, s * 0.101, 0.111, 0.005);
      oval(head, coat, 0.024, 0.012, 0.008, s * 0.04, 0.135, 0.099);
      oval(head, hair, 0.009, 0.011, 0.006, s * 0.04, 0.135, 0.106);
      box(head, hair, 0.045, 0.009, 0.009, s * 0.041, 0.158, 0.098);
      // Thin safety-glasses frames leave the face visible.
      box(head, hair, 0.067, 0.006, 0.008, s * 0.042, 0.152, 0.113);
      box(head, hair, 0.067, 0.005, 0.008, s * 0.042, 0.118, 0.113);
      box(head, hair, 0.005, 0.036, 0.008, s * 0.076, 0.135, 0.113);
    }
    box(head, hair, 0.025, 0.005, 0.008, 0, 0.139, 0.118);
    box(head, seam, 0.036, 0.005, 0.009, 0, 0.056, 0.101);

    for (const [side, s] of [['L', -1], ['R', 1]]) {
      const arm = bone(torso, `arm${side}`, s * 0.265, 0.435, 0);
      oval(arm, coat, 0.077, 0.095, 0.08, 0, -0.025, 0);
      taper(arm, coat, 0.068, 0.055, 0.26, 0, -0.14, 0);
      const elbow = bone(arm, `elb${side}`, 0, -0.28, 0);
      oval(elbow, coat, 0.055, 0.055, 0.055, 0, 0, 0);
      taper(elbow, coat, 0.054, 0.042, 0.235, 0, -0.12, 0);
      taper(elbow, seam, 0.043, 0.043, 0.026, 0, -0.238, 0);
      const hand = bone(elbow, `hand${side}`, 0, -0.265, 0);
      oval(hand, skin, 0.037, 0.067, 0.025, 0, -0.027, 0.012);
      oval(hand, skin, 0.019, 0.035, 0.021, -s * 0.031, -0.008, 0.022);

      const leg = bone(pelvis, `leg${side}`, s * 0.105, -0.025, 0);
      taper(leg, trousers, 0.087, 0.066, 0.39, 0, -0.195, 0, 0.9);
      const knee = bone(leg, `knee${side}`, 0, -0.39, 0);
      oval(knee, trousers, 0.067, 0.065, 0.063, 0, 0, 0);
      taper(knee, trousers, 0.063, 0.044, 0.405, 0, -0.2025, 0, 0.9);
      const ankle = bone(knee, `ankle${side}`, 0, -0.405, 0);
      oval(ankle, trousers, 0.066, 0.045, 0.129, 0, -0.04, 0.051);
      // Two halves of one open coat skirt, split at the back for running.
      const tail = bone(pelvis, `coat${side}`, s * 0.115, 0.055, 0);
      const start = s < 0 ? Math.PI + 0.04 : 0.26;
      part(tail, new THREE.CylinderGeometry(0.19, 0.245, 0.36, 10, 1, true, start, Math.PI - 0.30),
        coat, -s * 0.115, -0.18, 0, [1, 1, 0.68]);
      part(tail, new THREE.CylinderGeometry(0.243, 0.245, 0.014, 10, 1, true, start, Math.PI - 0.30),
        seam, -s * 0.115, -0.353, 0, [1, 1, 0.68]);
      this._limbs.push({ arm, elbow, leg, knee, tail, sign: -s });
    }

    // Bake attachments into one skinned mesh, grouped by seven materials.
    // Anatomy and garment details therefore do not add a draw call per part.
    this.group.updateMatrixWorld(true);
    const buckets = this._materials.map(() => []);
    for (const object of parts) {
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      const count = geometry.attributes.position.count;
      const indices = new Uint16Array(count * 4);
      const weights = new Float32Array(count * 4);
      const index = this._bones.indexOf(object.parent);
      for (let i = 0; i < count; i++) { indices[i * 4] = index; weights[i * 4] = 1; }
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      buckets[this._materials.indexOf(object.material)].push(geometry);
      object.removeFromParent();
      object.geometry.dispose();
    }
    const merged = buckets.map(bucket => mergeGeometries(bucket));
    this._geometry = mergeGeometries(merged, true);
    for (const bucket of buckets) for (const geometry of bucket) geometry.dispose();
    for (const geometry of merged) geometry.dispose();
    this._mesh = new THREE.SkinnedMesh(this._geometry, this._materials);
    this._mesh.name = 'scientist-coat-body';
    this._mesh.castShadow = this._mesh.receiveShadow = true;
    this._mesh.frustumCulled = false;
    this.group.add(this._mesh);
    this._mesh.bind(new THREE.Skeleton(this._bones));
    this.update(0, {});
  }

  update(dt, state = {}) {
    this._time += dt;
    this._current = state.moving ? state.fleeing ? 'run' : 'walk' : 'idle';
    this._move = THREE.MathUtils.damp(this._move, state.moving ? 1 : 0, 10, dt);
    this._panic = THREE.MathUtils.damp(this._panic, state.fleeing ? 1 : 0, 6, dt);
    this._phase += dt * (3.4 + (state.speed || 0) * 2.3) * this._move;
    const swing = Math.sin(this._phase) * (0.4 + this._panic * 0.35) * this._move;
    const j = this.joints;
    for (const limb of this._limbs) {
      const stride = swing * limb.sign;
      limb.leg.rotation.x = stride;
      limb.knee.rotation.x = Math.max(0, -stride) * 1.35;
      limb.arm.rotation.x = -stride * 0.8 - this._panic * 0.2;
      limb.arm.rotation.z = limb.sign * 0.06;
      limb.elbow.rotation.x = -0.16 - this._panic * 0.95;
      limb.tail.rotation.x = stride * 0.55 - this._panic * this._move * 0.1;
    }
    j.torso.rotation.x = this._move * (0.035 + this._panic * 0.17);
    j.pelvis.position.y = 0.91 + Math.abs(Math.sin(this._phase)) * 0.018 * this._move;
    j.head.rotation.y = state.fleeing ? Math.max(0, Math.sin(this._time * 1.8)) * 0.9
      : Math.sin(this._time * (state.alerted ? 2 : 0.65)) * (state.alerted ? 0.6 : 0.25);
    j.head.rotation.x = Math.sin(this._time * 1.4) * 0.012;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._mesh.skeleton.dispose();
    this._geometry.dispose();
    for (const material of this._materials) material.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
