import * as THREE from 'three';

/** A finite first-aid pickup. Full-health players leave it for later. */
export default class HealthPack {
  constructor(scene, x, z, amount = 35) {
    this.scene = scene;
    this.x = x;
    this.z = z;
    this.amount = amount;
    this.collected = false;
    this._time = 0;
    this.group = new THREE.Group();
    this.group.position.set(x, 0.15, z);
    this._geometries = new Set();
    this._materials = new Set();
    const casing = new THREE.MeshStandardMaterial({ color: 0xd4e9df, roughness: 0.65, metalness: 0.15 });
    const green = new THREE.MeshBasicMaterial({ color: 0x73e6a6, toneMapped: false });
    const dark = new THREE.MeshStandardMaterial({ color: 0x162b28, roughness: 0.8 });
    for (const material of [casing, green, dark]) this._materials.add(material);
    const box = (material, w, h, d, y, zOffset = 0) => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      this._geometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, y, zOffset);
      mesh.castShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    box(casing, 0.58, 0.32, 0.4, 0.16);
    box(dark, 0.3, 0.06, 0.14, 0.36);
    box(green, 0.1, 0.23, 0.025, 0.16, 0.213);
    box(green, 0.28, 0.08, 0.025, 0.16, 0.215);
    box(green, 0.1, 0.025, 0.28, 0.33);
    box(green, 0.28, 0.025, 0.1, 0.33);
    const canvas = document.createElement('canvas');
    canvas.width = 384; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#081c16'; ctx.fillRect(0, 0, 384, 96);
    ctx.strokeStyle = '#75e8a8'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, 380, 92);
    ctx.fillStyle = '#b9f3ce'; ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'center'; ctx.fillText(`+${amount} HEALTH`, 192, 58);
    this._texture = new THREE.CanvasTexture(canvas);
    this._texture.colorSpace = THREE.SRGBColorSpace;
    const labelMaterial = new THREE.MeshBasicMaterial({ map: this._texture, side: THREE.DoubleSide, toneMapped: false });
    this._materials.add(labelMaterial);
    const labelGeometry = new THREE.PlaneGeometry(0.95, 0.24);
    this._geometries.add(labelGeometry);
    this._label = new THREE.Mesh(labelGeometry, labelMaterial);
    this._label.position.y = 0.83;
    this.group.add(this._label);
    scene.add(this.group);
  }

  update(dt, cameraPosition) {
    if (this.collected) return;
    this._time += dt;
    this._label.position.y = 0.83 + Math.sin(this._time * 2) * 0.035;
    this._label.lookAt(cameraPosition);
  }

  collect(position, health, maxHealth) {
    if (this.collected || health >= maxHealth || Math.abs(position.y - 0.4) > 1.6
        || (position.x - this.x) ** 2 + (position.z - this.z) ** 2 > 1.25 ** 2) return 0;
    this.collected = true;
    this.group.visible = false;
    return Math.min(this.amount, maxHealth - health);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const geometry of this._geometries) geometry.dispose();
    for (const material of this._materials) material.dispose();
    this._texture.dispose();
  }
}
