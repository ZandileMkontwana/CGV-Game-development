/**
 * SurfaceShading.js — programmable-pipeline surface shader layer.
 *
 * COMS3006A links: this is a hand-written vertex + fragment shader patch
 * (Programmable Pipeline notes) that injects into three.js' standard material:
 *   - vertex stage: passes world position + world normal down as `varying`s
 *   - fragment stage: uses them for procedural textures (Textures notes:
 *     "Procedurally Generated Textures", "Secondary / Detail maps"), and edits
 *     the diffuse colour and the roughness (shininess) that the lighting
 *     equation then uses (Lighting notes: diffuse + specular terms).
 *
 * Why world space: the level kit builds walls from boxes whose UVs always run
 * 0..1 per face, so a big wall and a small wall get the same texture stretched
 * differently and the tiling is obvious. World-space noise is independent of UVs,
 * so it breaks the repetition and gives consistent grime everywhere.
 *
 * What it adds (all procedural, no image files, deterministic):
 *   1. macro colour variation   — hides texture tiling
 *   2. fine detail noise        — a "secondary map" at ~3.5 cm scale
 *   3. grime                    — dirt near the floor, soot near the ceiling,
 *                                 vertical water-stain streaks on walls,
 *                                 patchy dirt on floors
 *   4. contact darkening        — cheap baked-AO look where wall meets floor
 *   5. wet floor puddles        — roughness drops to near-mirror so the lamps
 *                                 and the flashlight leave real specular streaks
 */
import * as THREE from 'three';

const NOISE_GLSL = /* glsl */ `
float ss_hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float ss_noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(ss_hash(i), ss_hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(ss_hash(i + vec3(0.0, 1.0, 0.0)), ss_hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(ss_hash(i + vec3(0.0, 0.0, 1.0)), ss_hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(ss_hash(i + vec3(0.0, 1.0, 1.0)), ss_hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
float ss_fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * ss_noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s / 0.875;
}
`;

const FRAG_DIFFUSE = /* glsl */ `
#include <map_fragment>
  vec3 ssP = vSsWorldPos;
  vec3 ssN = normalize(vSsWorldNormal);
  float ssFloorMask = smoothstep(0.6, 0.9, ssN.y);
  float ssCeilMask = smoothstep(0.6, 0.9, -ssN.y);
  float ssWallMask = 1.0 - max(ssFloorMask, ssCeilMask);

  // 1. Macro variation: breaks the visible texture repeat.
  float ssMacro = ss_fbm(ssP * 0.35);
  diffuseColor.rgb *= mix(1.0, 0.72 + 0.56 * ssMacro, uSsMacro);

  // 2. Fine detail (secondary map): tiny brightness grain.
  diffuseColor.rgb *= 0.94 + 0.12 * ss_noise(ssP * 28.0);

  // 3. Grime.
  float ssDirtN = ss_fbm(ssP * 1.8 + 7.0);
  float ssLow = 1.0 - smoothstep(0.0, 0.9, ssP.y);
  float ssHigh = smoothstep(2.1, 3.3, ssP.y);
  float ssStreakN = ss_noise(vec3((ssP.x + ssP.z) * 7.0, ssP.y * 0.35, 11.0));
  float ssStreak = smoothstep(0.55, 0.85, ssStreakN) * (0.3 + 0.7 * smoothstep(0.5, 3.0, ssP.y));
  float ssWallGrime = ssWallMask * (ssLow * (0.3 + 0.9 * ssDirtN) + ssHigh * (0.3 + 0.7 * ssDirtN) + ssStreak * 0.8);
  float ssFloorGrime = ssFloorMask * smoothstep(0.38, 0.8, ssDirtN) * 0.85;
  float ssCeilGrime = ssCeilMask * (0.25 + 0.75 * ssDirtN) * 0.7;
  float ssGrime = clamp(ssWallGrime + ssFloorGrime + ssCeilGrime, 0.0, 1.0) * uSsGrime;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.04, 0.035), ssGrime * 0.6);

  // 4. Contact darkening where walls meet the floor.
  diffuseColor.rgb *= 1.0 - 0.45 * uSsContact * ssWallMask * (1.0 - smoothstep(0.0, 0.45, ssP.y));

  // 5. Wet floor puddles.
  float ssPuddle = 0.0;
  if (uSsWet > 0.001) {
    float ssPuddleN = ss_fbm(ssP * 0.45 + 31.0);
    ssPuddle = smoothstep(0.52, 0.66, ssPuddleN) * ssFloorMask * uSsWet;
    diffuseColor.rgb *= 1.0 - 0.45 * ssPuddle;
  }
`;

const FRAG_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.05, ssPuddle);
  roughnessFactor = mix(roughnessFactor, min(1.0, roughnessFactor + 0.25), ssGrime * 0.5);
`;

/**
 * Patch a MeshStandardMaterial / MeshPhysicalMaterial in place.
 * @param {THREE.Material} material
 * @param {{grime?:number, wet?:number, contact?:number, macro?:number}} opts  all 0..1
 */
export function applySurfaceShading(material, opts = {}) {
  const params = {
    grime: opts.grime ?? 0.6,
    wet: opts.wet ?? 0,
    contact: opts.contact ?? 0.5,
    macro: opts.macro ?? 0.8,
  };
  material.userData.surfaceShading = params;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSsGrime = { value: params.grime };
    shader.uniforms.uSsWet = { value: params.wet };
    shader.uniforms.uSsContact = { value: params.contact };
    shader.uniforms.uSsMacro = { value: params.macro };
    material.userData.surfaceShader = shader;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vSsWorldPos;\nvarying vec3 vSsWorldNormal;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        '  vSsWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
        '  vSsWorldNormal = normalize(mat3(modelMatrix) * objectNormal);');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\n' +
        'uniform float uSsGrime;\nuniform float uSsWet;\nuniform float uSsContact;\nuniform float uSsMacro;\n' +
        'varying vec3 vSsWorldPos;\nvarying vec3 vSsWorldNormal;\n' + NOISE_GLSL)
      .replace('#include <map_fragment>', FRAG_DIFFUSE)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGHNESS);
  };
  // Same patch for every material, so they can share one compiled program
  // whenever their other settings (maps etc.) match.
  material.customProgramCacheKey = () => 'surface-shading-v1';
  material.needsUpdate = true;
  return material;
}

/** Change a patched material's look at runtime (e.g. dirtier as the reactor fails). */
export function setSurfaceShading(material, patch) {
  const params = material.userData.surfaceShading;
  if (!params) return;
  Object.assign(params, patch);
  const shader = material.userData.surfaceShader;
  if (!shader) return;
  shader.uniforms.uSsGrime.value = params.grime;
  shader.uniforms.uSsWet.value = params.wet;
  shader.uniforms.uSsContact.value = params.contact;
  shader.uniforms.uSsMacro.value = params.macro;
}
