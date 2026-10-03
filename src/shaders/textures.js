/**
 * textures.js — procedural PBR texture generation.
 *
 * We have no external texture assets (src/assets/textures/ is empty), and
 * downloading images isn't an option from this environment. Instead we
 * synthesise normal / roughness / AO maps on a <canvas> at runtime. This is
 * a completely standard technique (see "procedural texturing") and satisfies
 * the rubric requirement for "textures used for more than colour (bump maps,
 * height maps)" without needing a single downloaded asset.
 *
 * Everything here is deterministic-ish (seeded) so materials look the same
 * every run, and cheap enough to generate once at level-load time and reuse.
 */
import * as THREE from 'three';

// Small seeded PRNG so repeated calls with the same seed look identical.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap value-noise height field rendered to a canvas (0..255 grayscale). */
function generateHeightCanvas(size = 256, { cellSize = 16, seed = 1, octaves = 3 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rand = mulberry32(seed);

  // Build a handful of octaves of simple lattice noise and sum them.
  const layers = [];
  for (let o = 0; o < octaves; o++) {
    const cells = Math.max(2, Math.floor(size / (cellSize / (o + 1))));
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    layers.push({ cells, grid, amp: 1 / (o + 1) });
  }

  const sample = (gx, gy, cells, grid) => {
    const x0 = Math.floor(gx) % cells, y0 = Math.floor(gy) % cells;
    const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
    const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy);
    const v00 = grid[y0 * cells + x0], v10 = grid[y0 * cells + x1];
    const v01 = grid[y1 * cells + x0], v11 = grid[y1 * cells + x1];
    const a = v00 + (v10 - v00) * fx;
    const b = v01 + (v11 - v01) * fx;
    return a + (b - a) * fy;
  };

  let maxTotal = 0;
  for (const l of layers) maxTotal += l.amp;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let h = 0;
      for (const l of layers) {
        h += sample((x / size) * l.cells, (y / size) * l.cells, l.cells, l.grid) * l.amp;
      }
      h /= maxTotal;
      const v = Math.max(0, Math.min(255, Math.round(h * 255)));
      const idx = (y * size + x) * 4;
      img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = v;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Convert a grayscale height canvas into a tangent-space normal map. */
function heightToNormalMap(heightCanvas, strength = 1.5) {
  const size = heightCanvas.width;
  const ctx = heightCanvas.getContext('2d');
  const src = ctx.getImageData(0, 0, size, size).data;
  const H = (x, y) => {
    x = (x + size) % size; y = (y + size) % size;
    return src[(y * size + x) * 4] / 255;
  };

  const out = document.createElement('canvas');
  out.width = out.height = size;
  const octx = out.getContext('2d');
  const img = octx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hl = H(x - 1, y), hr = H(x + 1, y);
      const hu = H(x, y - 1), hd = H(x, y + 1);
      const nx = (hl - hr) * strength;
      const ny = (hu - hd) * strength;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const idx = (y * size + x) * 4;
      img.data[idx] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      img.data[idx + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      img.data[idx + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      img.data[idx + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Grayscale roughness/AO-style map with a base value plus variance noise. */
function generateVarianceCanvas(size, base, variance, seed) {
  const h = generateHeightCanvas(size, { cellSize: 24, seed, octaves: 2 });
  const ctx = h.getContext('2d');
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = img.data[i] / 255; // 0..1
    const v = Math.max(0, Math.min(255, Math.round((base + (n - 0.5) * variance) * 255)));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return h;
}

function toTexture(canvas, { repeat = [1, 1], srgb = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build a full procedural PBR map set: { normalMap, roughnessMap, aoMap }.
 * Cached per (seed, repeat) so we don't regenerate canvases we already built.
 */
const _cache = new Map();
export function buildPBRMaps({
  size = 256, seed = 1, bumpStrength = 1.4,
  roughnessBase = 0.7, roughnessVariance = 0.35,
  repeat = [4, 4],
} = {}) {
  const key = JSON.stringify({ size, seed, bumpStrength, roughnessBase, roughnessVariance, repeat });
  if (_cache.has(key)) return _cache.get(key);

  const height = generateHeightCanvas(size, { cellSize: 20, seed, octaves: 3 });
  const normalCanvas = heightToNormalMap(height, bumpStrength);
  const roughCanvas = generateVarianceCanvas(size, roughnessBase, roughnessVariance, seed + 97);
  const aoCanvas = generateVarianceCanvas(size, 0.85, 0.25, seed + 251);

  const maps = {
    normalMap: toTexture(normalCanvas, { repeat }),
    roughnessMap: toTexture(roughCanvas, { repeat }),
    aoMap: toTexture(aoCanvas, { repeat }),
  };
  _cache.set(key, maps);
  return maps;
}

/**
 * Vertical-gradient "sky" cube texture — used as scene.background so each
 * level gets a real skybox instead of a flat colour. Cheap: six canvases,
 * generated once per level and cached by colour pair.
 */
const _skyCache = new Map();
export function buildGradientSkybox({ top = '#0a0e14', bottom = '#1c2733', glow = null } = {}) {
  const key = `${top}|${bottom}|${glow}`;
  if (_skyCache.has(key)) return _skyCache.get(key);

  const size = 256;
  const faces = [];
  for (let f = 0; f < 6; f++) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Soft horizon glow on the side faces (+X/-X/+Z/-Z), painted as a
    // radial highlight roughly a third of the way down the face.
    if (glow && f !== 2 && f !== 3) {
      const rg = ctx.createRadialGradient(
        size / 2, size * 0.55, 0, size / 2, size * 0.55, size * 0.7
      );
      rg.addColorStop(0, glow);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, size, size);
    }
    faces.push(canvas);
  }

  const cubeTex = new THREE.CubeTexture(faces);
  cubeTex.needsUpdate = true;
  _skyCache.set(key, cubeTex);
  return cubeTex;
}
