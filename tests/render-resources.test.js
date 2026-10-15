import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import StaticBatch from '../src/levels/StaticBatch.js';
import ShaderManager from '../src/shaders/ShaderManager.js';
import PostFX from '../src/core/PostFX.js';

test('reveal materials warm up for the compositor target and restore the previous target', () => {
  for (const fail of [false, true]) {
    const previous = {};
    const buffer = {};
    let active = previous;
    const postfx = Object.create(PostFX.prototype);
    postfx._scene = new THREE.Scene();
    const hidden = new THREE.Group();
    hidden.visible = false;
    postfx._scene.add(hidden);
    const camera = {};
    postfx.composer = { readBuffer: buffer, passes: [{ camera }] };
    postfx._renderer = {
      getRenderTarget: () => active,
      setRenderTarget: value => { active = value; },
      compile(scene, view) {
        assert.equal(active, buffer, 'Screen and compositor targets require different shader programs');
        assert.equal(scene, postfx._scene);
        assert.equal(view, camera);
        assert.equal(hidden.visible, true);
        assert.equal(hidden.frustumCulled, false);
        if (fail) throw new Error('compile failed');
      },
      render() {},
    };
    if (fail) assert.throws(() => postfx.prepareScene(), /compile failed/);
    else postfx.prepareScene();
    assert.equal(active, previous);
    assert.equal(hidden.visible, false);
    assert.equal(hidden.frustumCulled, true);
  }
});

test('static scenery batching preserves transformed geometry, cover raycasts and transparent children', () => {
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const glass = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4 });
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const roots = [1, 3].map(x => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, 1, -4);
    mesh.rotation.y = Math.PI / 4;
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  });
  const child = new THREE.Mesh(geometry, glass);
  child.position.y = 2;
  roots[0].add(child);
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  geometry.computeBoundingBox();
  for (const root of roots) bounds.union(geometry.boundingBox.clone().applyMatrix4(root.matrixWorld));
  const ray = new THREE.Raycaster(new THREE.Vector3(1, 1, 0), new THREE.Vector3(0, 0, -1));
  const before = ray.intersectObjects(roots, false)[0].distance;
  const batch = new StaticBatch(scene, roots);
  assert.equal(batch.stats.sourceMeshes, 2);
  assert.equal(batch.stats.batches, 1);
  assert.equal(batch.meshes[0].castShadow, true);
  assert(bounds.min.distanceTo(batch.meshes[0].geometry.boundingBox.min) < 1e-6);
  assert(bounds.max.distanceTo(batch.meshes[0].geometry.boundingBox.max) < 1e-6);
  assert.equal(ray.intersectObjects(roots, false)[0].distance, before, 'Cover must still block line of sight');
  assert.equal(child.material, glass, 'Transparent children keep their original material');
  assert.equal(roots[0].visible, true, 'Batched parent must not hide unbatched children');
  let geometryDisposed = false;
  batch.meshes[0].geometry.addEventListener('dispose', () => { geometryDisposed = true; });
  batch.dispose();
  assert.equal(geometryDisposed, true);
  assert(roots.every(root => root.material === material));
  assert.equal(scene.children.length, 2, 'Only original scenery remains after releasing batches');
  geometry.dispose();
  material.dispose();
  glass.dispose();
});

test('moving hazards and their children stay independent of static scenery', () => {
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const geometry = new THREE.BoxGeometry();
  const fan = new THREE.Group();
  const blades = [0, 1].map(x => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.x = x;
    fan.add(mesh);
    return mesh;
  });
  scene.add(fan);
  const batch = new StaticBatch(scene, [fan], new Set([fan]));
  assert.equal(batch.stats.sourceMeshes, 0);
  fan.rotation.y = Math.PI / 2;
  scene.updateMatrixWorld(true);
  assert(blades.every(blade => blade.material === material && blade.material.visible));
  assert(Math.abs(blades[1].getWorldPosition(new THREE.Vector3()).z + 1) < 1e-6);
  batch.dispose();
  geometry.dispose();
  material.dispose();
});

test('nested scenery restores its hierarchy when batches are released', () => {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  const parent = new THREE.Mesh(geometry, material);
  parent.position.set(2, 0, 2);
  parent.rotation.y = Math.PI / 2;
  const child = new THREE.Mesh(geometry, material);
  child.position.x = 2;
  parent.add(child);
  scene.add(parent);
  scene.updateMatrixWorld(true);
  const expected = child.getWorldPosition(new THREE.Vector3());
  const batch = new StaticBatch(scene, [parent, child]);
  assert.equal(batch.stats.sourceMeshes, 2, 'Overlapping roots must not merge an object twice');
  assert(child.matrixWorld.equals(batch.sources.find(source => source.mesh === child).replacement.matrixWorld));
  batch.dispose();
  scene.updateMatrixWorld(true);
  assert.equal(parent.parent, scene);
  assert.equal(child.parent, parent);
  assert(child.getWorldPosition(new THREE.Vector3()).distanceTo(expected) < 1e-6);
  geometry.dispose();
  material.dispose();
});

test('level changes release shader effects without disposing persistent tool shaders', () => {
  const shaders = new ShaderManager(new THREE.Scene());
  const pulse = shaders.createPulseGlowMaterial();
  let pulseDisposed = false, levelDisposals = 0;
  pulse.addEventListener('dispose', () => { pulseDisposed = true; });
  for (let visit = 0; visit < 8; visit++) {
    const zone = new THREE.Mesh();
    const wall = new THREE.Mesh();
    shaders.wireLevelVisuals({ heatHazeZones: [zone], dissolveTargets: [wall] });
    zone.material.addEventListener('dispose', () => { levelDisposals++; });
    wall.material.addEventListener('dispose', () => { levelDisposals++; });
    assert.equal(shaders._activeShaders.length, 3);
    shaders.clearLevelVisuals();
    assert.deepEqual(shaders._activeShaders, [pulse]);
    assert.equal(shaders._dissolveMaterials.length, 0);
    assert.equal(pulseDisposed, false);
  }
  assert.equal(levelDisposals, 16);
  shaders.dispose();
  assert.equal(pulseDisposed, true);
});
