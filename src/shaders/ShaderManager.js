/**
 * ShaderManager — Person C's domain.
 *
 * Owns all custom GLSL shaders and lighting configuration.
 * Each level has its own lighting preset and active shaders.
 *
 * Custom shaders required by the rubric:
 *   1. Heat-haze / ripple  — Level 2, around overheating machinery
 *   2. Dissolve / noise    — Level 3, environment failing apart
 *
 * Both must use uniforms driven by time or game state ("alive" effects).
 *
 * Lighting progression:
 *   Level 1: cool white ambient + clean directional/point lights
 *   Level 2: flickering amber point lights (sin-driven intensity)
 *   Level 3: red emergency lighting, pulsing
 */
import * as THREE from 'three';

export default class ShaderManager {
  constructor(scene) {
    this.scene = scene;
    this._time = 0;
    this._lights = [];
    this._activeShaders = [];
  }

  // ── Lighting presets ───────────────────────────────────────────────────

  /** Level 1: clean, cool white lighting. */
  applyLevel1Lighting() {
    this._clearLights();
    // TODO (Person C): Implement cool white ambient + directional lights.
  }

  /** Level 2: flickering amber. Intensity should pulse with sin(time). */
  applyLevel2Lighting() {
    this._clearLights();
    // TODO (Person C): Implement flickering amber point lights.
  }

  /** Level 3: red emergency lighting, pulsing. */
  applyLevel3Lighting() {
    this._clearLights();
    // TODO (Person C): Implement pulsing red emergency lights.
  }

  // ── Custom shaders ─────────────────────────────────────────────────────

  /**
   * Heat-haze / ripple shader.
   * Applied to planes/zones around overheating machinery in Level 2.
   *
   * Uniforms:
   *   uTime      — elapsed time, drives the distortion wave
   *   uIntensity — 0..1, driven by game state (proximity, damage)
   */
  createHeatHazeMaterial() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.5 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;
        void main() {
          // TODO (Person C): implement sine-wave UV distortion
          float wave = sin(vUv.y * 20.0 + uTime * 3.0) * uIntensity * 0.05;
          vec2 distortedUv = vUv + vec2(wave, 0.0);
          gl_FragColor = vec4(vec3(1.0, 0.6, 0.2) * uIntensity, 0.3);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this._activeShaders.push(mat);
    return mat;
  }

  /**
   * Dissolve / noise shader.
   * Applied to meshes that break apart during the Level 3 meltdown.
   *
   * Uniforms:
   *   uTime           — elapsed time, animates the noise pattern
   *   uDissolveAmount — 0..1, driven by game state (0 = intact, 1 = gone)
   */
  createDissolveMaterial() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDissolveAmount: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPosition;
        varying vec2 vUv;
        void main() {
          vPosition = position;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uDissolveAmount;
        varying vec3 vPosition;
        varying vec2 vUv;

        // Simple 3D hash noise
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        void main() {
          float noise = hash(vPosition * 4.0 + uTime * 0.5);
          if (noise < uDissolveAmount) discard;
          // Edge glow where dissolve is happening
          float edge = smoothstep(uDissolveAmount - 0.05, uDissolveAmount, noise);
          vec3 color = mix(vec3(1.0, 0.3, 0.0), vec3(0.5, 0.5, 0.5), edge);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      transparent: true,
    });
    this._activeShaders.push(mat);
    return mat;
  }

  /**
   * Called every frame while playing.
   * Update all time-driven uniforms here.
   * @param {number} dt delta time in seconds
   */
  update(dt) {
    this._time += dt;
    // Update all active shader time uniforms.
    for (const mat of this._activeShaders) {
      if (mat.uniforms.uTime) {
        mat.uniforms.uTime.value = this._time;
      }
    }
    // TODO (Person C): Update flickering light intensities, etc.
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  _clearLights() {
    for (const light of this._lights) {
      this.scene.remove(light);
      if (light.dispose) light.dispose();
    }
    this._lights = [];
  }

  _addLight(light) {
    this.scene.add(light);
    this._lights.push(light);
    return light;
  }
}
