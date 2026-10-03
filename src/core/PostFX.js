/**
 * PostFX — cinematic render pipeline.
 *
 * Replaces the plain renderer.render() call with an EffectComposer chain:
 *   RenderPass → UnrealBloomPass (emissive glow) → OutputPass (tonemap/sRGB)
 *   → cinematic grade pass (vignette, film grain, chromatic aberration,
 *   danger pulse).
 *
 * `setDanger(0..1)` — Game feeds monster proximity into it every frame; the
 * screen edges close in and throb red as the creature closes distance.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.55 },
    uDanger: { value: 0 },
    uGrain: { value: 0.045 },
    uAberration: { value: 0.0016 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uDanger;
    uniform float uGrain;
    uniform float uAberration;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // Chromatic aberration — colour fringing grows toward the frame edge.
      float ab = uAberration * (0.4 + r2 * 2.4);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab).b;

      // Cold cinematic grade — slight desaturation, cool shadows, contrast.
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(luma), 0.12);
      col *= vec3(0.96, 1.0, 1.05);
      col = pow(max(col, 0.0), vec3(1.05));

      // Danger: red pulse creeping in from the screen edges.
      float pulse = 0.5 + 0.5 * sin(uTime * 6.0);
      vec3 dangerCol = vec3(0.55, 0.02, 0.02) * uDanger * (0.55 + 0.45 * pulse);
      col = mix(col, dangerCol, uDanger * 0.42 * smoothstep(0.03, 0.5, r2));

      // Vignette — deepens as danger rises.
      float vig = smoothstep(0.95, 0.25, r2 * (1.45 + uDanger * 1.5));
      col *= mix(1.0, vig, uVignette);

      // Animated film grain.
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 17.0) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export default class PostFX {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(renderer, scene, camera) {
    this._renderer = renderer;
    this._dangerTarget = 0;
    this._time = 0;

    this.composer = new EffectComposer(renderer);
    // Cap the post pipeline below the canvas DPR — bloom + grade at full
    // retina resolution is the single biggest frame-time cost.
    this._maxPixelRatio = Math.min(renderer.getPixelRatio(), 1.5);
    this.composer.setPixelRatio(this._maxPixelRatio);
    this.composer.setSize(window.innerWidth, window.innerHeight);

    this.composer.addPass(new RenderPass(scene, camera));

    // Subtle bloom — makes emissive weak points, eyes, tool tips and lamps
    // physically glow instead of looking like flat coloured pixels.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.32, 0.5, 0.72
    );
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this._onResize = () => {
      this.composer.setPixelRatio(this._maxPixelRatio);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', this._onResize);
  }

  /** 0..1 — monster proximity horror. Smoothed internally. */
  setDanger(v) {
    this._dangerTarget = THREE.MathUtils.clamp(v, 0, 1);
  }

  /** Called every frame; `dt` also drives the composer's internal timers. */
  render(dt) {
    this._time += dt;
    const u = this.grade.uniforms;
    u.uTime.value = this._time;
    u.uDanger.value += (this._dangerTarget - u.uDanger.value) * Math.min(1, dt * 3);
    this.composer.render(dt);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.composer.dispose();
  }
}
