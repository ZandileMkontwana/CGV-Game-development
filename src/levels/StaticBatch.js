import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Merge opaque scenery by material and room-sized cells, keeping raycast proxies. */
export default class StaticBatch {
  constructor(scene, roots, excluded = new Set(), cellSize = 12) {
    this.scene = scene;
    this.meshes = [];
    this.sources = [];
    const groups = new Map();
    const visited = new Set();
    scene.updateMatrixWorld(true);
    const visit = object => {
      if (visited.has(object) || !object.visible || excluded.has(object)) return;
      visited.add(object);
      if (object.isMesh && !object.isSkinnedMesh && !object.isInstancedMesh
          && !object.userData.pulseTarget && !object.geometry.morphAttributes.position) {
        const material = object.material;
        if (material && !Array.isArray(material) && material.visible
            && !material.transparent && !material.isShaderMaterial
            && object.matrixWorld.determinant() > 0) {
          const geometry = object.geometry;
          const attributes = Object.keys(geometry.attributes).sort()
            .map(name => `${name}:${geometry.attributes[name].itemSize}`).join(',');
          const position = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
          const key = `${material.uuid}|${object.castShadow}|${object.receiveShadow}|${Math.floor(position.x / cellSize)}|${Math.floor(position.z / cellSize)}|${!!geometry.index}|${attributes}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(object);
        }
      }
      for (const child of object.children) visit(child);
    };
    for (const root of roots) visit(root);

    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const geometries = group.map(mesh => mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
      const geometry = mergeGeometries(geometries, false);
      for (const copy of geometries) copy.dispose();
      if (!geometry) continue;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const first = group[0];
      const batch = new THREE.Mesh(geometry, first.material);
      batch.name = 'static-scenery-batch';
      batch.castShadow = first.castShadow;
      batch.receiveShadow = first.receiveShadow;
      batch.matrixAutoUpdate = false;
      scene.add(batch);
      this.meshes.push(batch);
      for (const source of group) {
        // Keep the original mesh as a raycast proxy outside the render tree.
        // A frozen transform group keeps unbatched children (such as glass)
        // in place without submitting the original geometry again.
        const parent = source.parent;
        const replacement = new THREE.Group().copy(source, false);
        replacement.matrixAutoUpdate = false;
        replacement.matrixWorldAutoUpdate = false;
        for (const child of [...source.children]) replacement.add(child);
        parent.remove(source);
        parent.add(replacement);
        this.sources.push({ mesh: source, parent, replacement });
      }
    }
    this.stats = { sourceMeshes: this.sources.length, batches: this.meshes.length };
  }

  dispose() {
    // Undo nested replacements in reverse order before the level tears down.
    for (let i = this.sources.length - 1; i >= 0; i--) {
      const { mesh, parent, replacement } = this.sources[i];
      for (const child of [...replacement.children]) mesh.add(child);
      parent.remove(replacement);
      parent.add(mesh);
    }
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.sources = [];
    this.meshes = [];
  }
}
