import * as THREE from 'three';
import { createMonster } from '../core/CharacterFactory.js';

/** A bolted-down monster mannequin. It has targets, no AI or damage behavior. */
export default class TrainingDummy {
  constructor(id) {
    this.group = new THREE.Group();
    this.group.name = `training-dummy-${id}`;
    this.id = id;
    this.hit = false;
    this._geometries = new Set();
    this._materials = new Set();
    const character = createMonster();
    this._figure = character.group;
    this._figure.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this._figure);
    const scale = 2 / (bounds.max.y - bounds.min.y);
    this._figure.scale.setScalar(scale);
    this._figure.position.y = 0.16 - bounds.min.y * scale;
    this._figure.rotation.y = -Math.PI / 2;
    this._hinge = new THREE.Group();
    this._hinge.add(this._figure);
    this.group.add(this._hinge);
    this._figure.traverse(object => {
      if (!object.isMesh) return;
      object.userData = {};
      this._geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (this._materials.has(material)) continue;
        this._materials.add(material);
        material.map = null;
        material.bumpMap = null;
        material.color.setHex(0x536878);
        material.emissive?.setHex(0x000000);
        material.roughness = 0.65;
        material.metalness = 0.3;
      }
    });
    // Cyan chest marker teaches the same aiming cue as later weak points.
    this.target = character.weakPoints[0];
    for (const point of character.weakPoints) point.visible = point === this.target;
    this.target.material.color.setHex(0x74ebff);
    this.target.material.emissive.setHex(0x26c4ff);
    this.target.material.emissiveIntensity = 1.4;
    this.targets = [...character.hitMeshes, this.target];
    for (const target of this.targets) {
      target.userData.pulseTarget = true;
      target.userData.pulseType = 'trainingDummy';
      target.userData.powerNode = { id };
      target.userData.trainingDummyId = id;
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0x273743, roughness: 0.75, metalness: 0.5 });
    const status = new THREE.MeshStandardMaterial({ color: 0x36ceff, emissive: 0x159ac9, emissiveIntensity: 0.8 });
    this._materials.add(steel);
    this._materials.add(status);
    const part = (geometry, material, x, y, z) => {
      this._geometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    part(new THREE.BoxGeometry(1.15, 0.16, 1.3), steel, 0, 0.08, 0);
    part(new THREE.BoxGeometry(0.12, 1.45, 0.12), steel, 0.3, 0.88, 0);
    this.led = part(new THREE.BoxGeometry(0.04, 0.1, 1.05), status, -0.58, 0.2, 0);
  }

  confirmHit() {
    if (this.hit) return;
    this.hit = true;
    for (const mesh of [this.target, this.led]) {
      mesh.material.color.setHex(0x69ef9c);
      mesh.material.emissive.setHex(0x24c965);
    }
  }

  update(dt) {
    const tilt = this.hit ? -0.28 : 0;
    this._hinge.rotation.z += (tilt - this._hinge.rotation.z) * Math.min(1, dt * 8);
    this.group.updateMatrixWorld(true);
  }

  dispose() {
    for (const geometry of this._geometries) geometry.dispose();
    for (const material of this._materials) material.dispose();
    this.group.removeFromParent();
  }
}
