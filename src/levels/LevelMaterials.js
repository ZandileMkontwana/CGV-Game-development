/**
 * LevelMaterials.js — procedural surface + material library for the level kit.
 *
 * Every texture here is synthesised on a <canvas> at level-load time (no
 * external image files — the project must deploy to a LAMP server with no
 * download risk). Results are cached by key, so building a level twice is
 * cheap and materials/geometries can safely be shared and kept for the
 * whole session instead of being disposed per level.
 *
 * Theme bundles:
 *   lab        — clean research facility (Level 1)
 *   damaged    — rusted, water-stained, collapsed (Level 2)
 *   emergency  — scorched, red-alert, failing (Level 3)
 *
 * All generators are deterministic (seeded) so a level looks identical on
 * every run, which makes screenshots and the trailer reproducible.
 */
import * as THREE from 'three';
import { buildPBRMaps } from '../shaders/textures.js';

// ─────────────────────────────────────────────────────────────────────────────
// Seeded drawing helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Small seeded PRNG — same implementation style as shaders/textures.js. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Per-pixel brightness noise over an existing fill. */
function fillNoise(ctx, size, rand, amount) {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

/** Bevelled panel seams: dark groove + light catch on the lower edge. */
function drawPanelSeams(ctx, size, rand, {
  stepX = 64, stepY = 128, dark = 'rgba(0,0,0,0.32)', light = 'rgba(255,255,255,0.10)',
  rivets = true,
} = {}) {
  ctx.lineWidth = 2;
  for (let x = 0; x <= size; x += stepX) {
    ctx.strokeStyle = dark;
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, size); ctx.stroke();
    ctx.strokeStyle = light;
    ctx.beginPath(); ctx.moveTo(x + 2.5, 0); ctx.lineTo(x + 2.5, size); ctx.stroke();
  }
  for (let y = 0; y <= size; y += stepY) {
    ctx.strokeStyle = dark;
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(size, y + 0.5); ctx.stroke();
    ctx.strokeStyle = light;
    ctx.beginPath(); ctx.moveTo(0, y + 2.5); ctx.lineTo(size, y + 2.5); ctx.stroke();
  }
  if (rivets) {
    for (let x = stepX; x < size; x += stepX) {
      for (let y = stepY; y < size; y += stepY) {
        const r = 2 + rand() * 1.5;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.beginPath(); ctx.arc(x - 1, y - 1, r * 0.6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

/** Vertical grime streaks (water / oil running down the surface). */
function drawStreaks(ctx, size, rand, {
  count = 10, color = 'rgba(0,0,0,0.20)', minLen = 0.25, maxLen = 0.9, maxW = 7,
} = {}) {
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const w = 2 + rand() * maxW;
    const len = size * (minLen + rand() * (maxLen - minLen));
    const y = rand() * (size - len);
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, len);
  }
}

/** Soft round blotches — rust, stains, scorch. */
function drawBlotches(ctx, size, rand, {
  count = 8, inner = 'rgba(140,80,35,0.45)', rMin = 8, rMax = 34,
} = {}) {
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = rMin + rand() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, inner);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

/** Thin light scratches. */
function drawScratches(ctx, size, rand, { count = 16, color = 'rgba(255,255,255,0.07)' } = {}) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    const x = rand() * size, y = rand() * size;
    const a = rand() * Math.PI * 2;
    const len = 12 + rand() * 60;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
}

/** Jagged crack polylines. */
function drawCracks(ctx, size, rand, { count = 5, color = 'rgba(0,0,0,0.38)' } = {}) {
  ctx.strokeStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.lineWidth = 0.8 + rand() * 1.4;
    let x = rand() * size, y = rand() * size;
    const segs = 4 + Math.floor(rand() * 5);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < segs; s++) {
      x += (rand() - 0.5) * 46;
      y += (rand() - 0.5) * 46;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** Wrap a canvas as a repeating texture with an SRGB flag for colour maps. */
function canvasTexture(canvas, repeat, srgb = true) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _textureCache = new Map();
function cached(key, make) {
  if (!_textureCache.has(key)) _textureCache.set(key, make());
  return _textureCache.get(key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Diffuse texture generators
// ─────────────────────────────────────────────────────────────────────────────

/** Painted metal wall panels — seams, rivets, streaks, optional rust/scorch. */
export function panelTexture({
  base = '#97a3b4', seamX = 64, seamY = 128, grime = 8, rust = 0,
  scorch = 0, seed = 1, repeat = [4, 2],
}) {
  return cached(`panel|${base}|${seamX}|${seamY}|${grime}|${rust}|${scorch}|${seed}|${repeat}`, () => {
    const size = 256;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const rand = mulberry32(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    fillNoise(ctx, size, rand, 14);
    drawPanelSeams(ctx, size, rand, { stepX: seamX, stepY: seamY });
    if (grime > 0) drawStreaks(ctx, size, rand, { count: grime });
    if (rust > 0) {
      drawBlotches(ctx, size, rand, {
        count: rust, inner: 'rgba(125,70,28,0.5)', rMin: 6, rMax: 26,
      });
      drawStreaks(ctx, size, rand, { count: rust * 2, color: 'rgba(90,50,20,0.22)' });
    }
    if (scorch > 0) {
      drawBlotches(ctx, size, rand, {
        count: scorch, inner: 'rgba(10,6,4,0.62)', rMin: 14, rMax: 46,
      });
    }
    drawScratches(ctx, size, rand);
    return canvasTexture(c, repeat);
  });
}

/** Square floor tiles with grout lines and wear. */
export function tileTexture({ base = '#3d4653', grout = 'rgba(0,0,0,0.45)', wear = 10, seed = 2, repeat = [8, 8] }) {
  return cached(`tile|${base}|${grout}|${wear}|${seed}|${repeat}`, () => {
    const size = 256;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const rand = mulberry32(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    // Per-tile brightness variation.
    const step = 64;
    for (let x = 0; x < size; x += step) {
      for (let y = 0; y < size; y += step) {
        const v = (rand() - 0.5) * 16;
        ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
        ctx.fillRect(x, y, step, step);
      }
    }
    fillNoise(ctx, size, rand, 10);
    ctx.strokeStyle = grout;
    ctx.lineWidth = 3;
    for (let x = 0; x <= size; x += step) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, size); ctx.stroke();
    }
    for (let y = 0; y <= size; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(size, y + 0.5); ctx.stroke();
    }
    drawScratches(ctx, size, rand, { count: wear });
    return canvasTexture(c, repeat);
  });
}

/** Concrete / cement with cracks and stains. */
export function concreteTexture({ base = '#4a4f58', cracks = 5, stains = 7, seed = 3, repeat = [6, 6] }) {
  return cached(`concrete|${base}|${cracks}|${stains}|${seed}|${repeat}`, () => {
    const size = 256;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const rand = mulberry32(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    fillNoise(ctx, size, rand, 22);
    drawBlotches(ctx, size, rand, {
      count: stains, inner: 'rgba(0,0,0,0.20)', rMin: 16, rMax: 52,
    });
    drawCracks(ctx, size, rand, { count: cracks });
    drawScratches(ctx, size, rand, { count: 8 });
    return canvasTexture(c, repeat);
  });
}

/** Metal grating — dark field with bright bars (floors, vents, catwalks). */
export function gratingTexture({ base = '#20262e', bar = '#8e9aa8', seed = 4, repeat = [4, 4] }) {
  return cached(`grating|${base}|${bar}|${seed}|${repeat}`, () => {
    const size = 256;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const rand = mulberry32(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    fillNoise(ctx, size, rand, 8);
    ctx.strokeStyle = bar;
    ctx.lineWidth = 5;
    for (let x = 8; x < size; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
    }
    ctx.lineWidth = 3;
    for (let y = 8; y < size; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
    }
    return canvasTexture(c, repeat);
  });
}

/** Console screen — dark glass with fake data rows / waveform. */
export function screenTexture({ base = '#04121a', fg = '#3fd9ff', seed = 5 }) {
  return cached(`screen|${base}|${fg}|${seed}`, () => {
    const size = 128;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const rand = mulberry32(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = fg;
    // Header bar.
    ctx.globalAlpha = 0.8;
    ctx.fillRect(6, 6, size - 12, 8);
    ctx.globalAlpha = 1;
    // Fake text rows of varying width.
    for (let y = 22; y < size - 22; y += 9) {
      const w = 20 + rand() * (size - 40);
      ctx.globalAlpha = 0.35 + rand() * 0.45;
      ctx.fillRect(8, y, w, 3);
    }
    // Waveform strip.
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let x = 8; x < size - 8; x += 2) {
      const y = size - 12 + Math.sin(x * 0.25 + seed) * 4 * rand();
      if (x === 8) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = fg;
    ctx.stroke();
    ctx.globalAlpha = 1;
    return canvasTexture(c, [1, 1]);
  });
}

/** Diagonal hazard stripes (yellow/black by default). */
export function stripeTexture({ a = '#e8b23a', b = '#141414', size = 128, band = 16 } = {}) {
  return cached(`stripe|${a}|${b}|${size}|${band}`, () => {
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = b;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 4);
    for (let x = -size * 1.5; x < size * 1.5; x += band * 2) {
      ctx.fillRect(x, -size, band, size * 2);
    }
    ctx.restore();
    return canvasTexture(c, [1, 1]);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Signage + decal materials (MeshBasic so they read in the dark)
// ─────────────────────────────────────────────────────────────────────────────

/** Emissive-looking text sign material, e.g. 'REACTOR', 'EXIT', 'A-2'. */
export function signMaterial(text, {
  bg = 'rgba(10,14,20,0.92)', fg = '#7fe7ff', sub = '', w = 256, h = 128,
} = {}) {
  return cached(`sign|${text}|${bg}|${fg}|${sub}|${w}|${h}`, () => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const main = Math.min(h * 0.42, (w * 0.86) / Math.max(4, text.length) * 1.6);
    ctx.font = `bold ${Math.round(main)}px monospace`;
    ctx.fillText(text, w / 2, sub ? h * 0.40 : h / 2);
    if (sub) {
      ctx.font = `${Math.round(main * 0.42)}px monospace`;
      ctx.globalAlpha = 0.85;
      ctx.fillText(sub, w / 2, h * 0.74);
      ctx.globalAlpha = 1;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    });
  });
}

/** Floor decal materials — hazard stripes, directions, zone marks. */
export function decalMaterial(kind, color = '#e8b23a') {
  return cached(`decal|${kind}|${color}`, () => {
    const size = 128;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    switch (kind) {
      case 'stripes': {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = 'rgba(10,10,10,0.9)';
        for (let x = -size; x < size * 2; x += 32) {
          ctx.save();
          ctx.translate(x, 0);
          ctx.transform(1, 0, -1, 1, 0, 0);
          ctx.fillRect(0, 0, 16, size);
          ctx.restore();
        }
        break;
      }
      case 'arrow': {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        for (let i = 0; i < 3; i++) {
          const x = 18 + i * 34;
          ctx.beginPath();
          ctx.moveTo(x, 24);
          ctx.lineTo(x + 26, 64);
          ctx.lineTo(x, 104);
          ctx.lineTo(x + 12, 64);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case 'dashes': {
        ctx.fillStyle = color;
        for (let y = 0; y < size; y += 32) ctx.fillRect(52, y, 24, 18);
        break;
      }
      default: {
        ctx.strokeStyle = color;
        ctx.lineWidth = 10;
        ctx.strokeRect(10, 10, size - 20, size - 20);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme bundles
// ─────────────────────────────────────────────────────────────────────────────

const THEME_CONFIG = {
  lab: {
    seed: 131,
    wall: { base: '#97a3b4', seamX: 64, seamY: 128, grime: 5, rust: 0 },
    wallDark: { base: '#5c6779', seamX: 64, seamY: 128, grime: 8, rust: 0 },
    ceil: { base: '#828e9d', seamX: 64, seamY: 64, grime: 3, rust: 0 },
    floor: { base: '#3d4653', grout: 'rgba(0,0,0,0.5)', wear: 8 },
    concrete: { base: '#565d68', cracks: 4, stains: 6 },
    grate: { base: '#1c222b', bar: '#8e9aa8' },
    screen: { base: '#04121a', fg: '#3fd9ff' },
    trim: 0x343d49, beam: 0x59636f, metal: 0x9aa6b4, metalDark: 0x4d5661,
    panel: 0x4a5563, pipe: 0x93a0ad, crate: 0x7d8a97, locker: 0x5f6c7c,
    debris: 0x565d68, rubber: 0x20252c, hazardColor: '#e8b23a',
    accent: 0x38c8ff, lamp: 0xd6ecff, lampLight: 0xaed8ff,
    exit: 0x5cff8a, warn: 0xffb340, emer: 0xff4030,
  },
  damaged: {
    seed: 233,
    wall: { base: '#6a5a48', seamX: 64, seamY: 128, grime: 12, rust: 7 },
    wallDark: { base: '#463a2e', seamX: 64, seamY: 128, grime: 14, rust: 9, scorch: 3 },
    ceil: { base: '#3f362c', seamX: 64, seamY: 64, grime: 10, rust: 5 },
    floor: { base: '#3a332b', grout: 'rgba(0,0,0,0.55)', wear: 16 },
    concrete: { base: '#4a4239', cracks: 9, stains: 12 },
    grate: { base: '#181410', bar: '#7a6a58' },
    screen: { base: '#140a04', fg: '#ffb04a' },
    trim: 0x332b22, beam: 0x453b30, metal: 0x7a6d5c, metalDark: 0x39322a,
    panel: 0x4e4437, pipe: 0x80705c, crate: 0x79644a, locker: 0x5a5f68,
    debris: 0x4a4239, rubber: 0x1a1712, hazardColor: '#d99a2b',
    accent: 0xffa62b, lamp: 0xffd9a0, lampLight: 0xffb460,
    exit: 0x5cff8a, warn: 0xffb340, emer: 0xff4030,
  },
  emergency: {
    seed: 337,
    wall: { base: '#5c3a38', seamX: 64, seamY: 128, grime: 10, rust: 6, scorch: 6 },
    wallDark: { base: '#3a2422', seamX: 64, seamY: 128, grime: 12, rust: 8, scorch: 9 },
    ceil: { base: '#33231f', seamX: 64, seamY: 64, grime: 12, rust: 5, scorch: 4 },
    floor: { base: '#33221f', grout: 'rgba(0,0,0,0.6)', wear: 18 },
    concrete: { base: '#3d2c28', cracks: 11, stains: 10 },
    grate: { base: '#150f0e', bar: '#6e524a' },
    screen: { base: '#1a0505', fg: '#ff5a3c' },
    trim: 0x2b1d1b, beam: 0x3c2825, metal: 0x7d6a64, metalDark: 0x322523,
    panel: 0x4a3330, pipe: 0x84695f, crate: 0x6e5644, locker: 0x554b4a,
    debris: 0x3d2c28, rubber: 0x171110, hazardColor: '#d97a2b',
    accent: 0xff4030, lamp: 0xffc9b8, lampLight: 0xff7a5a,
    exit: 0x5cff8a, warn: 0xffb340, emer: 0xff3020,
  },
};

const _themeCache = new Map();

/**
 * Build (or return the cached) material bundle for a theme.
 * Materials are shared across meshes and levels — do NOT dispose them on
 * level teardown; the game keeps at most three bundles alive.
 */
export function getThemeMaterials(themeName) {
  if (_themeCache.has(themeName)) return _themeCache.get(themeName);
  const t = THEME_CONFIG[themeName] || THEME_CONFIG.lab;

  const wallTex = panelTexture({ ...t.wall, seed: t.seed, repeat: [4, 2] });
  const wallDarkTex = panelTexture({ ...t.wallDark, seed: t.seed + 1, repeat: [4, 2] });
  const ceilTex = panelTexture({ ...t.ceil, seed: t.seed + 7, repeat: [5, 5] });
  const floorTex = tileTexture({ ...t.floor, seed: t.seed + 2, repeat: [7, 7] });
  const grateTex = gratingTexture({ ...t.grate, seed: t.seed + 3, repeat: [3, 3] });
  const concreteTex = concreteTexture({ ...t.concrete, seed: t.seed + 4, repeat: [4, 4] });
  const screenTex = screenTexture({ ...t.screen, seed: t.seed + 5 });
  const screenTex2 = screenTexture({ ...t.screen, seed: t.seed + 6 });

  const wallPBR = buildPBRMaps({ seed: t.seed + 10, repeat: [4, 2], bumpStrength: 1.3, roughnessBase: 0.55, roughnessVariance: 0.3 });
  const floorPBR = buildPBRMaps({ seed: t.seed + 20, repeat: [7, 7], bumpStrength: 1.8, roughnessBase: 0.7, roughnessVariance: 0.4 });
  const propPBR = buildPBRMaps({ seed: t.seed + 30, repeat: [2, 2], bumpStrength: 1.2, roughnessBase: 0.65, roughnessVariance: 0.3 });

  const std = (opts) => new THREE.MeshStandardMaterial(opts);
  const emissive = (color, intensity = 0.9, extra = {}) => std({
    color, emissive: color, emissiveIntensity: intensity,
    roughness: 0.4, metalness: 0.2, ...extra,
  });

  const mats = {
    // --- architecture ---
    wall: std({ map: wallTex, normalMap: wallPBR.normalMap, roughnessMap: wallPBR.roughnessMap, roughness: 1, metalness: 0.35, color: 0xffffff }),
    wallDark: std({ map: wallDarkTex, normalMap: wallPBR.normalMap, roughness: 1, metalness: 0.4, color: 0xffffff }),
    ceil: std({ map: ceilTex, normalMap: wallPBR.normalMap, roughness: 0.9, metalness: 0.2, color: 0xffffff }),
    floor: std({ map: floorTex, normalMap: floorPBR.normalMap, roughnessMap: floorPBR.roughnessMap, roughness: 1, metalness: 0.2, color: 0xffffff }),
    grate: std({ map: grateTex, normalMap: propPBR.normalMap, roughness: 0.7, metalness: 0.6, color: 0xffffff }),
    concrete: std({ map: concreteTex, normalMap: propPBR.normalMap, roughness: 1, metalness: 0.05, color: 0xffffff }),
    trim: std({ color: t.trim, roughness: 0.6, metalness: 0.5, normalMap: propPBR.normalMap }),
    beam: std({ color: t.beam, roughness: 0.6, metalness: 0.55, normalMap: propPBR.normalMap }),
    metal: std({ color: t.metal, roughness: 0.35, metalness: 0.8, normalMap: propPBR.normalMap }),
    metalDark: std({ color: t.metalDark, roughness: 0.5, metalness: 0.7, normalMap: propPBR.normalMap }),
    panel: std({ color: t.panel, roughness: 0.5, metalness: 0.6, normalMap: propPBR.normalMap }),
    pipe: std({ color: t.pipe, roughness: 0.45, metalness: 0.7 }),
    crate: std({ color: t.crate, roughness: 0.85, metalness: 0.1, normalMap: propPBR.normalMap }),
    locker: std({ color: t.locker, roughness: 0.55, metalness: 0.6, normalMap: propPBR.normalMap }),
    debris: std({ color: t.debris, roughness: 0.95, metalness: 0.05, normalMap: propPBR.normalMap }),
    rubber: std({ color: t.rubber, roughness: 0.9, metalness: 0.1 }),

    // --- interactive / emissive ---
    accent: emissive(t.accent, 0.7, { roughness: 0.45, metalness: 0.4 }),
    lampPanel: emissive(t.lamp, 1.0, { roughness: 0.6, metalness: 0 }),
    lampLight: t.lampLight, // colour value, not a material
    beaconAmber: emissive(t.warn, 1.0),
    emergencyRed: emissive(t.emer, 1.0),
    exitGreen: emissive(t.exit, 1.0),
    screen: std({ map: screenTex, emissiveMap: screenTex, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.25, metalness: 0.1 }),
    screenAlt: std({ map: screenTex2, emissiveMap: screenTex2, emissive: 0xffffff, emissiveIntensity: 0.65, roughness: 0.25, metalness: 0.1 }),
    hazard: std({ map: stripeTexture({ a: t.hazardColor }), emissive: 0x000000, roughness: 0.6, metalness: 0.3 }),

    // --- transparent / organic ---
    glass: std({ color: 0xbfe8ff, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.6, side: THREE.DoubleSide }),
    tubeGlass: std({ color: 0x9fd4ff, transparent: true, opacity: 0.22, roughness: 0.08, metalness: 0.4, side: THREE.DoubleSide, emissive: 0x0a2a44, emissiveIntensity: 0.4 }),
    specimen: std({ color: 0x4bd06a, emissive: 0x0f5a24, emissiveIntensity: 0.65, roughness: 0.5, metalness: 0.1 }),

    // --- colours used by the kit for lights/decals ---
    colors: {
      accent: t.accent, lampLight: t.lampLight,
      exit: t.exit, warn: t.warn, emer: t.emer,
    },
  };

  _themeCache.set(themeName, mats);
  return mats;
}
