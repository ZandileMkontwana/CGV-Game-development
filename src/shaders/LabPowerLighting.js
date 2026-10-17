import { ShaderChunk } from 'three';

/** Suppress facility-wide fill inside the offline lab, preserving the torch. */
export default class LabPowerLighting {
  constructor() {
    this.power = { value: 1 };
    this._patched = new WeakSet();
  }

  apply(root) {
    root.traverse(object => {
      if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material?.isMeshStandardMaterial || this._patched.has(material)) continue;
        this._patched.add(material);
        const previous = material.onBeforeCompile;
        const key = material.customProgramCacheKey();
        const power = this.power;
        material.onBeforeCompile = function(shader, renderer) {
          previous.call(this, shader, renderer);
          shader.uniforms.uLabGridPower = power;
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLabWorldPosition;')
            .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
              vec4 labWorldPosition = vec4(transformed, 1.0);
              #ifdef USE_BATCHING
                labWorldPosition = batchingMatrix * labWorldPosition;
              #endif
              #ifdef USE_INSTANCING
                labWorldPosition = instanceMatrix * labWorldPosition;
              #endif
              vLabWorldPosition = (modelMatrix * labWorldPosition).xyz;
            `);
          const begin = ShaderChunk.lights_fragment_begin.replace(
            'getDirectionalLightInfo( directionalLight, directLight );',
            'getDirectionalLightInfo( directionalLight, directLight );\ndirectLight.color *= labGridLight;'
          );
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLabWorldPosition;\nuniform float uLabGridPower;')
            .replace('#include <lights_fragment_begin>', `
              float labInside = smoothstep(-9.5, -9.0, vLabWorldPosition.x)
                * (1.0 - smoothstep(9.0, 9.5, vLabWorldPosition.x))
                * smoothstep(-66.4, -65.9, vLabWorldPosition.z)
                * (1.0 - smoothstep(-54.4, -53.9, vLabWorldPosition.z));
              float labGridLight = mix(1.0, mix(0.015, 1.0, uLabGridPower), labInside);
              ${begin}
            `).replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
              #if defined(RE_IndirectDiffuse)
                irradiance *= labGridLight;
                iblIrradiance *= labGridLight;
              #endif
              #if defined(RE_IndirectSpecular)
                radiance *= labGridLight;
                clearcoatRadiance *= labGridLight;
              #endif
            `);
        };
        material.customProgramCacheKey = () => `${key}:lab-grid-v1`;
        material.needsUpdate = true;
      }
    });
  }
}
