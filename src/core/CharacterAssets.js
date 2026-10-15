import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let template = null;
let pending = null;

/** One immutable rig/texture source; actors clone their own skeletons. */
export function loadCharacterTemplate(loadingManager) {
  if (!pending) {
    pending = new GLTFLoader(loadingManager).loadAsync('models/soldier.glb').then(gltf => {
      template = gltf;
      return gltf;
    }).catch(error => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

export function getCharacterTemplate() { return template; }
