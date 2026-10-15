/** The lab's failed auxiliary circuit; safety indicators use a separate supply. */
export default class LabPower {
  constructor() {
    this.state = 'offline';
    this.power = 0;
    this._time = 0;
    this._lights = [];
    this._materials = new Map();
  }

  material(source) {
    if (!this._materials.has(source)) {
      const material = source.clone();
      this._materials.set(source, { material, color: source.color.clone(), emissive: source.emissiveIntensity });
      material.color.multiplyScalar(0.06);
      if (material.emissive) material.emissiveIntensity = 0;
    }
    return this._materials.get(source).material;
  }

  addLight(light) {
    this._lights.push({ light, intensity: light.intensity });
    light.intensity = 0;
  }

  restore() {
    if (this.state !== 'offline') return;
    this.state = 'restoring';
  }

  emergency() { this.state = 'emergency'; }

  update(dt) {
    this._time += dt;
    if (this.state !== 'offline') this.power = Math.min(1, this.power + dt / 0.85);
    if (this.state === 'restoring' && this.power === 1) this.state = 'online';
    const output = this.state === 'emergency' ? this.power * (0.08 + Math.max(0, Math.sin(this._time * 7)) * 0.1) : this.power;
    for (const entry of this._lights) entry.light.intensity = entry.intensity * output;
    for (const entry of this._materials.values()) {
      entry.material.color.copy(entry.color).multiplyScalar(0.06 + output * 0.94);
      if (entry.material.emissive) entry.material.emissiveIntensity = entry.emissive * output;
    }
  }

  dispose() {
    for (const entry of this._materials.values()) entry.material.dispose();
    this._materials.clear();
    this._lights.length = 0;
  }
}
