/**
 * ShaderManager — Kutloano's domain.
 *
 * Owns all custom GLSL shaders, lighting configuration, procedural PBR
 * materials and the skybox. Every shader material this file hands out
 * registers itself so `update(dt)` can drive its time/game-state uniforms —
 * that's what makes them "alive" rather than static, per the rubric.
 *
 * Public API other people's files plug into:
 *   applyLevel1/2/3Lighting()        — lighting + fog + skybox per level
 *   createHeatHazeMaterial()         — Level 2, shimmer over hazards
 *   createDissolveMaterial()         — Level 3, crumbling geometry
 *   createWeakPointGlowMaterial()    — monster weak points (MonsterAI.js)
 *   createPulseGlowMaterial()        — pulse-tool bolt (PulseTool.js)
 *   createPulseTrail(scene)          — fading trail behind the bolt
 *   createPBRWallMaterial(color)     — procedural bump/roughness walls
 *   createPBRFloorMaterial(color)    — procedural bump/roughness floors
 *   wireLevelVisuals(opts)           — swap placeholder meshes -> real shaders
 *   setDissolveAmount(v)             — 0..1, drives every dissolve material
 *   startAutoCollapse(duration)      — demo/fallback collapse driver
 *   update(dt)                       — call every frame while playing
 */
import * as THREE from 'three';
import { buildPBRMaps, buildGradientSkybox } from './textures.js';

export default class ShaderManager {
  constructor(scene) {
    this.scene = scene;
    this._time = 0;
    this._lights = [];
    this._activeShaders = [];
    this._flickerLights = []; // lights whose intensity pulses each frame
    this._dissolveMaterials = [];
    this._autoCollapse = null; // { t, duration } while active
    this._pulseTrails = [];
  }

  // ── Lighting presets ───────────────────────────────────────────────────

  /** Level 1: clean, cool white lighting — pristine station. */
  applyLevel1Lighting() {
    this._clearLights();
    this._flickerLights = [];

    // Soft sky/ground fill so unlit surfaces are never pure black.
    this._addLight(new THREE.HemisphereLight(0xbdd6ff, 0x1a1f26, 0.35));

    // Cool white ambient — well-lit, no harsh shadows.
    this._addLight(new THREE.AmbientLight(0xddeeff, 0.35));

    // Main directional light (overhead fluorescents feel).
    const main = new THREE.DirectionalLight(0xffffff, 1.1);
    main.position.set(5, 15, 5);
    this._configureShadow(main, { mapSize: 1024, area: 25, bias: -0.0005 });
    this._addLight(main);

    // Fill light from the opposite side — no shadow, just softens contrast.
    const fill = new THREE.DirectionalLight(0xccddff, 0.3);
    fill.position.set(-8, 10, -8);
    this._addLight(fill);

    // Subtle rim/back light so character silhouettes read against the wall.
    const rim = new THREE.DirectionalLight(0xffffff, 0.2);
    rim.position.set(0, 6, -12);
    this._addLight(rim);

    this.scene.background = buildGradientSkybox({ top: '#274056', bottom: '#0a0e14' });
    this.scene.fog = new THREE.Fog(0x0a0e14, 25, 90);
  }

  /** Level 2: flickering amber — station failing, lights unstable. */
  applyLevel2Lighting() {
    this._clearLights();
    this._flickerLights = [];

    this._addLight(new THREE.HemisphereLight(0x554422, 0x0a0602, 0.25));

    // Dim amber ambient.
    this._addLight(new THREE.AmbientLight(0x553311, 0.25));

    // Flickering point lights (simulating failing fixtures). Only one casts
    // a shadow — four shadow-casting point lights would tank frame rate.
    const positions = [
      [6, 4, 0], [-6, 4, 0], [0, 4, 8], [0, 4, -8],
    ];
    positions.forEach(([x, y, z], i) => {
      const light = new THREE.PointLight(0xffaa44, 1.3, 20, 2);
      light.position.set(x, y, z);
      if (i === 0) this._configureShadow(light, { mapSize: 512, bias: -0.001 });
      this._addLight(light);
      // Layered flicker: a slow base pulse plus a fast jitter plus rare
      // total "stutter" drop-outs — reads as failing wiring, not a metronome.
      this._flickerLights.push({
        light, baseIntensity: 1.3,
        speed: 1.5 + Math.random() * 1.5,
        jitterSpeed: 9 + Math.random() * 6,
        seed: Math.random() * 100,
      });
    });

    // Warm directional fill.
    const fill = new THREE.DirectionalLight(0xff8833, 0.35);
    fill.position.set(3, 10, 5);
    this._addLight(fill);

    this.scene.background = buildGradientSkybox({ top: '#241608', bottom: '#120a04', glow: 'rgba(255,140,40,0.35)' });
    this.scene.fog = new THREE.Fog(0x120a04, 15, 60);
  }

  /** Level 3: red emergency lighting — meltdown, pulsing, heavy fog. */
  applyLevel3Lighting() {
    this._clearLights();
    this._flickerLights = [];

    this._addLight(new THREE.HemisphereLight(0x662211, 0x050000, 0.3));

    // Dark red ambient.
    this._addLight(new THREE.AmbientLight(0x330000, 0.35));

    // Pulsing red point lights — heartbeat-like, in sync-ish but not
    // identical, so the room feels alive rather than strobing uniformly.
    const positions = [
      [5, 5, 5], [-5, 5, -5], [5, 5, -5], [-5, 5, 5],
    ];
    positions.forEach(([x, y, z], i) => {
      const light = new THREE.PointLight(0xff2200, 1.6, 18, 2);
      light.position.set(x, y, z);
      this._addLight(light);
      this._flickerLights.push({
        light, baseIntensity: 1.6,
        speed: 1.2 + i * 0.15,
        jitterSpeed: 0,
        seed: i * 30,
      });
    });

    // Harsh directional from above (emergency spotlights). Only shadow
    // caster in this scene — collapse geometry has enough draw calls already.
    const spot = new THREE.DirectionalLight(0xff1100, 0.85);
    spot.position.set(0, 15, 0);
    this._configureShadow(spot, { mapSize: 1024, area: 22, bias: -0.0006 });
    this._addLight(spot);

    this.scene.background = buildGradientSkybox({ top: '#1a0000', bottom: '#0a0000', glow: 'rgba(255,60,0,0.4)' });
    this.scene.fog = new THREE.FogExp2(0x0a0000, 0.045); // exponential — thick, claustrophobic
  }

  // ── Custom shaders ─────────────────────────────────────────────────────

  /**
   * Heat-haze / ripple shader — Level 2, around overheating machinery.
   *
   * Layered sine distortion (two frequencies, drifting upward like real
   * heat) plus a fresnel-style edge fade so the plane doesn't read as a
   * hard rectangle, and additive blending so it looks like shimmer rather
   * than a coloured pane of glass.
   *
   * Uniforms:
   *   uTime      — elapsed time, drives the distortion wave
   *   uIntensity — 0..1, driven by game state (proximity/damage)
   */
  createHeatHazeMaterial() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.5 },
        uColor: { value: new THREE.Color(0xff8a33) },
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
        uniform vec3 uColor;
        varying vec2 vUv;

        void main() {
          // Heat rises: distortion drifts upward and gets faster near the top.
          float rise = uTime * (0.6 + uIntensity * 0.6);
          float wave1 = sin(vUv.y * 18.0 + rise * 3.0) * 0.035;
          float wave2 = sin(vUv.y * 7.0 - rise * 5.0 + vUv.x * 4.0) * 0.02;
          float shimmer = (wave1 + wave2) * uIntensity;

          // Fresnel-ish edge fade so the quad blends into its surroundings
          // instead of showing a hard rectangular border.
          float edgeX = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
          float edgeY = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
          float edge = edgeX * edgeY;

          float flicker = 0.85 + 0.15 * sin(uTime * 11.0 + vUv.x * 20.0);
          float alpha = clamp(abs(shimmer) * 6.0, 0.0, 1.0) * edge * uIntensity * flicker;

          gl_FragColor = vec4(uColor, alpha * 0.6);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this._activeShaders.push(mat);
    return mat;
  }

  /**
   * Dissolve / noise shader — Level 3, environment crumbling apart.
   *
   * 3D value noise (cheaper than simplex, still organic — no blocky hash
   * artefacts) eats the mesh away from uDissolveAmount upward, with a
   * two-tone glowing edge band so it reads as "burning away" rather than a
   * flat cutout.
   *
   * Uniforms:
   *   uTime           — elapsed time, animates the noise pattern
   *   uDissolveAmount — 0..1, driven by game state (0 = intact, 1 = gone)
   */
  createDissolveMaterial(baseColor = 0x555555) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDissolveAmount: { value: 0 },
        uBaseColor: { value: new THREE.Color(baseColor) },
        uEdgeColorHot: { value: new THREE.Color(0xffee88) },
        uEdgeColorCool: { value: new THREE.Color(0xff5500) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        varying vec3 vNormal;
        void main() {
          vPos = position;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uDissolveAmount;
        uniform vec3 uBaseColor;
        uniform vec3 uEdgeColorHot;
        uniform vec3 uEdgeColorCool;
        varying vec3 vPos;
        varying vec3 vNormal;

        // Value noise: hash lattice corners, trilinear-interpolate.
        float hash3(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yxz + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        float noise3(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float n000 = hash3(i + vec3(0,0,0));
          float n100 = hash3(i + vec3(1,0,0));
          float n010 = hash3(i + vec3(0,1,0));
          float n110 = hash3(i + vec3(1,1,0));
          float n001 = hash3(i + vec3(0,0,1));
          float n101 = hash3(i + vec3(1,0,1));
          float n011 = hash3(i + vec3(0,1,1));
          float n111 = hash3(i + vec3(1,1,1));
          float nx00 = mix(n000, n100, f.x);
          float nx10 = mix(n010, n110, f.x);
          float nx01 = mix(n001, n101, f.x);
          float nx11 = mix(n011, n111, f.x);
          float nxy0 = mix(nx00, nx10, f.y);
          float nxy1 = mix(nx01, nx11, f.y);
          return mix(nxy0, nxy1, f.z);
        }

        void main() {
          float n = noise3(vPos * 3.2 + vec3(0.0, uTime * 0.15, 0.0))
                  + 0.5 * noise3(vPos * 7.0 - vec3(0.0, uTime * 0.3, 0.0));
          n /= 1.5;

          if (n < uDissolveAmount) discard;

          // Soft glowing edge band just above the dissolve threshold.
          float edge = smoothstep(uDissolveAmount, uDissolveAmount + 0.10, n);
          float band = 1.0 - edge; // 1 right at the cut line, fading out

          vec3 edgeColor = mix(uEdgeColorHot, uEdgeColorCool, smoothstep(0.0, 1.0, band));
          // Faint overall pre-heat glow as the amount climbs, even off-edge.
          vec3 preheat = uBaseColor + uEdgeColorCool * (uDissolveAmount * 0.15);

          vec3 color = mix(preheat, edgeColor, band);
          float rim = pow(1.0 - abs(vNormal.z), 2.0) * 0.15;
          color += rim;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
      transparent: false,
      side: THREE.DoubleSide,
    });
    this._activeShaders.push(mat);
    this._dissolveMaterials.push(mat);
    return mat;
  }

  /**
   * Monster weak-point glow material — emissive, pulsing, so the player can
   * spot the shootable point from a distance. Call `.flashHit(mat)` (static
   * helper below, or just bump uHitFlash yourself) when a weak point takes
   * damage for a satisfying reactive flash.
   */
  createWeakPointGlowMaterial(color = 0xff3333) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uHitFlash: { value: 0 }, // bump to 1.0 on hit; decays each frame
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uHitFlash;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float pulse = 0.6 + 0.4 * sin(uTime * 4.0);
          float fresnel = pow(1.0 - max(dot(normalize(vNormal), vViewDir), 0.0), 2.0);
          vec3 color = uColor * (0.7 + pulse * 0.6 + fresnel * 0.8);
          color += uColor * uHitFlash * 2.0;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    // Decay the hit-flash uniform each frame alongside uTime.
    mat.userData.decayHitFlash = true;
    this._activeShaders.push(mat);
    return mat;
  }

  /**
   * Pulse-tool projectile glow — bright core with a fresnel rim so the bolt
   * reads clearly at range. Pair with `createPulseTrail()` for the fading
   * trail behind it.
   */
  createPulseGlowMaterial(color = 0x00ddff) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float fresnel = pow(1.0 - max(dot(normalize(vNormal), vViewDir), 0.0), 1.5);
          float core = 1.4 + 0.3 * sin(uTime * 20.0);
          vec3 color = uColor * core + vec3(1.0) * fresnel * 0.9;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._activeShaders.push(mat);
    return mat;
  }

  /**
   * A small pool of fading billboard sprites that trace the bolt's recent
   * path — the "fading trail behind it" the brief asks for. Usage from
   * PulseTool.js: call `trail.emit(bolt.position)` once per frame while a
   * bolt is active; `update(dt)` (already called every frame below) ages
   * and fades them automatically.
   */
  createPulseTrail(color = 0x00ddff, poolSize = 14) {
    const geo = new THREE.SphereGeometry(0.045, 6, 6);
    const trail = {
      _pool: [],
      _next: 0,
      emit: (position) => {
        const s = trail._pool[trail._next];
        s.mesh.position.copy(position);
        s.mesh.visible = true;
        s.life = 1;
        trail._next = (trail._next + 1) % trail._pool.length;
      },
    };
    for (let i = 0; i < poolSize; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      trail._pool.push({ mesh, life: 0 });
    }
    this._pulseTrails.push(trail);
    return trail;
  }

  // ── PBR wall/floor materials (procedural, no external textures) ────────

  /** Wall material with a generated normal + roughness + AO map baked in. */
  createPBRWallMaterial(color = 0x8a8f96, opts = {}) {
    const maps = buildPBRMaps({ seed: 11, bumpStrength: 1.2, roughnessBase: 0.75, repeat: [4, 2], ...opts });
    return new THREE.MeshStandardMaterial({
      color, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
      aoMap: maps.aoMap, roughness: 1.0, metalness: 0.15,
    });
  }

  /** Floor material — coarser bump, higher roughness variance (grime/wear). */
  createPBRFloorMaterial(color = 0x555a60, opts = {}) {
    const maps = buildPBRMaps({ seed: 42, bumpStrength: 1.8, roughnessBase: 0.65, roughnessVariance: 0.45, repeat: [6, 6], ...opts });
    return new THREE.MeshStandardMaterial({
      color, normalMap: maps.normalMap, roughnessMap: maps.roughnessMap,
      aoMap: maps.aoMap, roughness: 1.0, metalness: 0.05,
    });
  }

  // ── Integration: swap placeholder meshes for real shader materials ─────

  /**
   * Called once after a level's geometry is built (from Game.js._loadLevel,
   * after `this.levels.buildLevelN()`). Replaces LevelManager's placeholder
   * MeshBasicMaterial zone markers with the real shaders, and wires the
   * monster's weak-point materials if a monster is passed in.
   *
   * @param {object} opts
   * @param {THREE.Mesh[]} [opts.heatHazeZones]  from LevelManager.heatHazeZones
   * @param {THREE.Mesh[]} [opts.dissolveTargets] from LevelManager._dissolveWalls
   * @param {THREE.Mesh[]} [opts.weakPoints]      from MonsterAI.weakPoints
   */
  wireLevelVisuals({ heatHazeZones = [], dissolveTargets = [], weakPoints = [] } = {}) {
    for (const zone of heatHazeZones) {
      zone.material = this.createHeatHazeMaterial();
      zone.material.uniforms.uIntensity.value = 0.6;
    }
    for (const wall of dissolveTargets) {
      wall.material = this.createDissolveMaterial(wall.material.color ? wall.material.color.getHex() : 0x555555);
    }
    for (const wp of weakPoints) {
      wp.material = this.createWeakPointGlowMaterial(0xff3333);
      wp.userData.glowMaterial = wp.material; // so MonsterAI can flash it on hit
    }
  }

  /** Set every dissolve material's progress at once (0 = intact, 1 = gone). */
  setDissolveAmount(v) {
    for (const mat of this._dissolveMaterials) {
      mat.uniforms.uDissolveAmount.value = v;
    }
  }

  /**
   * Fallback/demo driver: if nobody has wired a real collapse timer yet
   * (Zandile's Level 3 boss-fight timer), call this once on level load so
   * the dissolve shader still visibly "does something" during mentor demos
   * and the beta. Once the real timer exists, stop calling this and drive
   * `setDissolveAmount()` from game state instead.
   */
  startAutoCollapse(duration = 60) {
    this._autoCollapse = { t: 0, duration };
  }
  stopAutoCollapse() {
    this._autoCollapse = null;
  }

  /** Bump a weak point's hit-flash uniform — call from the 'hit' handler. */
  flashWeakPoint(mesh) {
    if (mesh?.material?.uniforms?.uHitFlash) {
      mesh.material.uniforms.uHitFlash.value = 1.0;
    }
  }

  /**
   * Called every frame while playing.
   * Update all time-driven uniforms here.
   * @param {number} dt delta time in seconds
   */
  update(dt) {
    this._time += dt;

    for (const mat of this._activeShaders) {
      if (mat.uniforms.uTime) mat.uniforms.uTime.value = this._time;
      if (mat.userData.decayHitFlash && mat.uniforms.uHitFlash) {
        mat.uniforms.uHitFlash.value = Math.max(0, mat.uniforms.uHitFlash.value - dt * 2.5);
      }
    }

    // Organic flicker: base sine + fast jitter + rare full drop-out.
    for (const f of this._flickerLights) {
      const base = 0.5 + 0.5 * Math.sin(this._time * f.speed + f.seed);
      const jitter = f.jitterSpeed
        ? 0.15 * Math.sin(this._time * f.jitterSpeed + f.seed * 3.0)
        : 0;
      const stutter = f.jitterSpeed && Math.sin(this._time * 0.7 + f.seed) > 0.965 ? 0.15 : 1.0;
      f.light.intensity = f.baseIntensity * Math.max(0, base + jitter) * stutter;
    }

    if (this._autoCollapse) {
      this._autoCollapse.t += dt;
      const v = Math.min(1, this._autoCollapse.t / this._autoCollapse.duration);
      this.setDissolveAmount(v);
      if (v >= 1) this._autoCollapse = null;
    }

    for (const trail of this._pulseTrails) {
      for (const seg of trail._pool) {
        if (seg.life <= 0) continue;
        seg.life -= dt * 2.2;
        if (seg.life <= 0) {
          seg.mesh.visible = false;
          seg.mesh.material.opacity = 0;
        } else {
          seg.mesh.material.opacity = seg.life * 0.8;
          seg.mesh.scale.setScalar(0.5 + seg.life * 0.5);
        }
      }
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

  _configureShadow(light, { mapSize = 1024, near = 0.5, far = 50, area = 25, bias = -0.0005 } = {}) {
    light.castShadow = true;
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.camera.near = near;
    light.shadow.camera.far = far;
    light.shadow.camera.left = -area;
    light.shadow.camera.right = area;
    light.shadow.camera.top = area;
    light.shadow.camera.bottom = -area;
    light.shadow.bias = bias;
  }

  /** Free GPU resources for every shader material this manager created. */
  dispose() {
    for (const mat of this._activeShaders) mat.dispose();
    this._activeShaders = [];
    this._dissolveMaterials = [];
    for (const trail of this._pulseTrails) {
      for (const seg of trail._pool) {
        seg.mesh.geometry.dispose();
        seg.mesh.material.dispose();
        this.scene.remove(seg.mesh);
      }
    }
    this._pulseTrails = [];
    this._clearLights();
  }
}
