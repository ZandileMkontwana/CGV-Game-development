import * as THREE from 'three';

const LABELS = {
  standby: ['A-2 / CONTAINMENT', 'AUXILIARY POWER OFFLINE', '#ffbc68'],
  powering: ['A-2 / RESUMING CULTURE', 'AUXILIARY POWER RESTORED', '#8bf2df'],
  alarm: ['A-2 / LOAD EXCEEDED', 'CONTAINMENT FIELD UNSTABLE', '#ff9c61'],
  mutate: ['A-2 / FIELD FAILURE', 'BIOLOGICAL EXPOSURE', '#ff6865'],
  burst: ['A-2 / CONTAINMENT LOST', 'EMERGENCY BYPASS AVAILABLE', '#ff6865'],
  flee: ['A-2 / EVACUATE', 'FOLLOW GREEN LIGHTS TO CONTROL', '#8bf2b4'],
  done: ['A-2 / EVACUATE', 'FOLLOW GREEN LIGHTS TO CONTROL', '#8bf2b4'],
};

/** Bespoke opening prop: readable machinery, a suspended culture and a rupture. */
export default class LabChamber {
  constructor(scene, x, z) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    this._geometries = new Set();
    this._materials = new Set();
    const material = options => {
      const mat = new THREE.MeshStandardMaterial(options);
      this._materials.add(mat);
      return mat;
    };
    const dark = material({ color: 0x15252b, roughness: 0.55, metalness: 0.6 });
    const steel = material({ color: 0x9baeb2, roughness: 0.38, metalness: 0.65 });
    this._energy = material({ color: 0x92eee8, emissive: 0x3dcbc6, emissiveIntensity: 0.35, roughness: 0.35 });
    this._culture = material({ color: 0x365752, emissive: 0x153d33, emissiveIntensity: 0.4, roughness: 0.8 });
    const glass = material({ color: 0xb8e6ea, transparent: true, opacity: 0.11, roughness: 0.14, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const mesh = (geometry, mat, px, py, pz) => {
      this._geometries.add(geometry);
      const object = new THREE.Mesh(geometry, mat);
      object.position.set(px, py, pz);
      object.castShadow = !mat.transparent;
      object.receiveShadow = true;
      this.group.add(object);
      return object;
    };
    mesh(new THREE.BoxGeometry(2.8, 0.28, 2.8), dark, 0, 0.14, 0);
    const ring = new THREE.TorusGeometry(1.12, 0.085, 6, 32);
    for (const y of [0.4, 2.45]) {
      const object = mesh(ring, steel, 0, y, 0);
      object.rotation.x = Math.PI / 2;
    }
    const post = new THREE.BoxGeometry(0.14, 2.12, 0.14);
    for (const [px, pz] of [[-0.91, -0.91], [0.91, -0.91], [-0.91, 0.91], [0.91, 0.91]]) {
      mesh(post, dark, px, 1.42, pz);
      mesh(new THREE.BoxGeometry(0.045, 1.8, 0.03), this._energy, px, 1.42, pz + 0.08);
    }
    this._glass = mesh(new THREE.CylinderGeometry(1.02, 1.02, 2, 32, 1, true), glass, 0, 1.43, 0);
    this._rotor = mesh(new THREE.TorusGeometry(0.93, 0.025, 5, 28), this._energy, 0, 0.65, 0);
    this._rotor.rotation.x = Math.PI / 2;
    const cap = mesh(new THREE.CylinderGeometry(1.18, 1.05, 0.2, 24), dark, 0, 2.6, 0);
    cap.receiveShadow = true;

    // A recognisable biological silhouette, suspended by four instrument leads.
    const culture = new THREE.Group();
    this.group.add(culture);
    this._specimen = culture;
    const body = mesh(new THREE.SphereGeometry(0.28, 12, 10), this._culture, 0, 1.5, 0);
    body.scale.set(1, 1.6, 0.7);
    culture.attach(body);
    const head = mesh(new THREE.SphereGeometry(0.17, 10, 8), this._culture, 0, 1.98, 0.06);
    culture.attach(head);
    const limb = new THREE.CapsuleGeometry(0.075, 0.35, 3, 6);
    for (const side of [-1, 1]) {
      const arm = mesh(limb, this._culture, side * 0.31, 1.44, 0.03);
      arm.rotation.z = side * 0.55;
      culture.attach(arm);
      const leg = mesh(limb, this._culture, side * 0.14, 0.95, 0);
      culture.attach(leg);
      mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.65, 5), steel, side * 0.28, 2.15, -0.2);
    }

    this._light = new THREE.PointLight(0x8ce5dc, 3.8, 9, 2);
    this._light.position.set(0, 1.7, 0.4);
    this.group.add(this._light);
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 192;
    this._context = canvas.getContext('2d');
    this._labelTexture = new THREE.CanvasTexture(canvas);
    this._labelTexture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.MeshBasicMaterial({ map: this._labelTexture, toneMapped: false });
    this._materials.add(label);
    mesh(new THREE.BoxGeometry(2.3, 0.65, 0.08), dark, 0, 2.58, 1.1);
    mesh(new THREE.PlaneGeometry(2.2, 0.55), label, 0, 2.58, 1.15);

    const crackMaterial = new THREE.LineBasicMaterial({ color: 0xbee8ee, transparent: true, opacity: 0.85 });
    this._materials.add(crackMaterial);
    const crackGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.6, 2.2, 0.84), new THREE.Vector3(-0.15, 1.8, 1.02),
      new THREE.Vector3(-0.15, 1.8, 1.02), new THREE.Vector3(0.12, 1.35, 1.03),
      new THREE.Vector3(0.12, 1.35, 1.03), new THREE.Vector3(0.7, 1.1, 0.78),
      new THREE.Vector3(-0.15, 1.8, 1.02), new THREE.Vector3(0.45, 1.98, 0.94),
    ]);
    this._geometries.add(crackGeometry);
    this._cracks = new THREE.LineSegments(crackGeometry, crackMaterial);
    this.group.add(this._cracks);
    this._shards = [];
    const shardGeometry = new THREE.PlaneGeometry(0.32, 0.7);
    for (let i = 0; i < 5; i++) {
      const shard = mesh(shardGeometry, glass, (i - 2) * 0.32, 1.2 + i * 0.15, 1.05);
      shard.userData.baseY = shard.position.y;
      this._shards.push(shard);
    }
    this.phase = null;
    this._time = 0;
    this._ruptureTime = 0;
    this.setPhase('standby');
  }

  setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this._phaseTime = 0;
    const [title, subtitle, color] = LABELS[phase];
    const ctx = this._context;
    ctx.fillStyle = '#071318'; ctx.fillRect(0, 0, 768, 192);
    ctx.fillStyle = color; ctx.fillRect(0, 0, 8, 192);
    ctx.font = 'bold 38px monospace'; ctx.fillText(title, 28, 68);
    ctx.font = '26px monospace'; ctx.fillText(subtitle, 28, 130);
    ctx.fillStyle = '#72878b'; ctx.font = '16px monospace'; ctx.fillText('RESEARCH SYSTEMS / CULTURE 09', 28, 171);
    this._labelTexture.needsUpdate = true;
    const broken = ['mutate', 'burst', 'flee', 'done'].includes(phase);
    if (phase === 'mutate') this._ruptureTime = 0;
    this._glass.visible = !broken;
    this._cracks.visible = phase === 'alarm';
    for (const shard of this._shards) shard.visible = broken;
    const red = ['alarm', 'mutate', 'burst'].includes(phase);
    this._light.color.setHex(red ? 0xff6650 : 0x8ce5dc);
    this._energy.emissive.setHex(red ? 0xff3d22 : 0x3dcbc6);
  }

  update(dt) {
    this._time += dt;
    this._phaseTime += dt;
    const active = this.phase !== 'standby';
    this._rotor.rotation.z += dt * (active ? 1.3 : 0.12);
    this._specimen.position.y = Math.sin(this._time * 0.8) * 0.04;
    const red = ['alarm', 'mutate', 'burst'].includes(this.phase);
    this._light.intensity = red ? 5 + Math.sin(this._time * 4) * 1.2 : active ? 5 : 3.8;
    this._energy.emissiveIntensity = red ? 1.4 : active ? 1.1 : 0.35;
    if (this.phase !== 'standby' && this.phase !== 'powering' && this.phase !== 'alarm') {
      this._ruptureTime += dt;
      for (let i = 0; i < this._shards.length; i++) {
        const shard = this._shards[i];
        shard.position.y = Math.max(0.24, shard.userData.baseY - this._ruptureTime * 1.6);
        shard.position.z = 1.05 + Math.min(0.65, this._ruptureTime * 0.5);
        shard.rotation.set(0.6 + i * 0.22, i * 0.4, i * 0.5);
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const geometry of this._geometries) geometry.dispose();
    for (const material of this._materials) material.dispose();
    this._labelTexture.dispose();
  }
}
