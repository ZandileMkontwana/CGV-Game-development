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
    this._flickerLights = []; // lights whose intensity pulses each frame
  }

  // ── Lighting presets ───────────────────────────────────────────────────

  /** Level 1: clean, cool white lighting — pristine station. */
  applyLevel1Lighting() {
    this._clearLights();
    this._flickerLights = [];

    // Cool white ambient — well-lit, no harsh shadows.
    this._addLight(new THREE.AmbientLight(0xddeeff, 0.5));

    // Main directional light (overhead fluorescents feel).
    const main = new THREE.DirectionalLight(0xffffff, 1.0);
    main.position.set(5, 15, 5);
    main.castShadow = true;
    main.shadow.mapSize.set(1024, 1024);
    main.shadow.camera.near = 0.5;
    main.shadow.camera.far = 50;
    main.shadow.camera.left = -25;
    main.shadow.camera.right = 25;
    main.shadow.camera.top = 25;
    main.shadow.camera.bottom = -25;
    this._addLight(main);

    // Fill light from the opposite side.
    const fill = new THREE.DirectionalLight(0xccddff, 0.3);
    fill.position.set(-8, 10, -8);
    this._addLight(fill);

    // Update fog and background to match cool station palette.
    this.scene.background = new THREE.Color(0x0a0e14);
    this.scene.fog = new THREE.Fog(0x0a0e14, 25, 90);
  }

  /** Level 2: flickering amber — station failing, lights unstable. */
  applyLevel2Lighting() {
    this._clearLights();
    this._flickerLights = [];

    // Dim amber ambient.
    this._addLight(new THREE.AmbientLight(0x553311, 0.3));

    // Flickering point lights (simulating failing fixtures).
    const positions = [
      [6, 4, 0], [-6, 4, 0], [0, 4, 8], [0, 4, -8],
    ];
    for (const [x, y, z] of positions) {
      const light = new THREE.PointLight(0xffaa44, 1.2, 20, 2);
      light.position.set(x, y, z);
      light.castShadow = false; // keep perf in check
      this._addLight(light);
      this._flickerLights.push({ light, baseIntensity: 1.2, speed: 2 + Math.random() * 3 });
    }

    // Warm directional fill.
    const fill = new THREE.DirectionalLight(0xff8833, 0.4);
    fill.position.set(3, 10, 5);
    this._addLight(fill);

    this.scene.background = new THREE.Color(0x120a04);
    this.scene.fog = new THREE.Fog(0x120a04, 15, 60);
  }

  /** Level 3: red emergency lighting — meltdown, pulsing. */
  applyLevel3Lighting() {
    this._clearLights();
    this._flickerLights = [];

    // Dark red ambient.
    this._addLight(new THREE.AmbientLight(0x330000, 0.4));

    // Pulsing red point lights.
    const positions = [
      [5, 5, 5], [-5, 5, -5], [5, 5, -5], [-5, 5, 5],
    ];
    for (const [x, y, z] of positions) {
      const light = new THREE.PointLight(0xff2200, 1.5, 18, 2);
      light.position.set(x, y, z);
      this._addLight(light);
      this._flickerLights.push({ light, baseIntensity: 1.5, speed: 1.5 + Math.random() * 2 });
    }

    // Harsh directional from above (emergency spotlights).
    const spot = new THREE.DirectionalLight(0xff1100, 0.8);
    spot.position.set(0, 15, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    this._addLight(spot);

    this.scene.background = new THREE.Color(0x0a0000);
    this.scene.fog = new THREE.Fog(0x0a0000, 10, 45);
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
    // Pulse flicker lights each frame (Level 2 + 3).
    for (const { light, baseIntensity, speed } of this._flickerLights) {
      light.intensity = baseIntensity * (0.5 + 0.5 * Math.sin(this._time * speed));
    }
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
