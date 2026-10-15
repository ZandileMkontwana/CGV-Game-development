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
import { applySurfaceShading, applyCrtShading } from '../shaders/SurfaceShading.js';

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

/**
 * Console screen layouts — each screen paints real facility text driven by its
 * seed, so every wall reads differently but the level rebuilds identically.
 * A theme picks its own layout pool (a clean lab shows telemetry + the culture
 * protocol; a damaged sector shows breach logs + alert boards).
 */
const SCREEN_LAYOUTS = ['telemetry', 'culture', 'alarm', 'log'];

/**
 * Console screen — a readable facility UI: real labels, live-looking numbers,
 * chemical formulae and status chips. `kinds` selects the layout pool; the
 * seed both picks the layout and drives every value.
 */
export function screenTexture({
  base = '#04121a', fg = '#3fd9ff', seed = 5, kinds = SCREEN_LAYOUTS,
}) {
  return cached(`screen|${base}|${fg}|${seed}|${kinds.join(',')}`, () => {
    const W = 512, H = 256;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const rand = mulberry32(seed);
    const layout = kinds[seed % kinds.length] || 'telemetry';

    // Screen glass: base wash + faint scanlines.
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.028)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

    const OK = '#5cff8a', WARN = '#ffb340', BAD = '#ff4030';
    const dim = 'rgba(255,255,255,0.6)';
    const num = (min, max, dec = 1) => (min + rand() * (max - min)).toFixed(dec);
    const stamp = () => `18:${String(40 + Math.floor(rand() * 19)).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`;
    const label = (str, x, y, color = dim, size = 12, weight = '') => {
      ctx.font = `${weight}${size}px monospace`;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(str, x, y);
    };
    const right = (str, x, y, color = dim, size = 12, weight = '') => {
      ctx.font = `${weight}${size}px monospace`;
      ctx.fillStyle = color;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(str, x, y);
    };
    const chip = (x, y, text, color) => {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x, y, 62, 14);
      ctx.globalAlpha = 1;
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = base;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, x + 31, y + 11);
    };
    // Chemical formula renderer — a digit run following a letter or ')' is
    // drawn smaller and lowered (a subscript), so formulae need no special
    // glyphs and survive any monospace font's coverage.
    const formula = (str, x, y, color = 'rgba(235,245,255,0.8)', size = 13) => {
      let cx = x;
      let prev = '';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      for (let i = 0; i < str.length;) {
        const ch = str[i];
        if (/\d/.test(ch) && /[A-Za-z)]/.test(prev)) {
          let j = i;
          while (j < str.length && /\d/.test(str[j])) j++;
          const run = str.slice(i, j);
          const px = Math.round(size * 0.68);
          ctx.font = `${px}px monospace`;
          ctx.fillStyle = color;
          ctx.fillText(run, cx, y + 3);
          cx += ctx.measureText(run).width;
          i = j;
        } else {
          ctx.font = `${size}px monospace`;
          ctx.fillStyle = color;
          ctx.fillText(ch, cx, y);
          cx += ctx.measureText(ch).width;
          prev = ch;
          i++;
        }
      }
    };

    // Header band + footer status rail, shared by every layout.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, W, 26);
    ctx.fillRect(0, H - 20, W, 20);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = fg;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 26.5); ctx.lineTo(W, 26.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H - 20.5); ctx.lineTo(W, H - 20.5); ctx.stroke();
    ctx.globalAlpha = 1;
    const titles = {
      telemetry: 'REACTOR TELEMETRY — SECTOR B',
      culture: 'CULTURE BAY A-2 — GROWTH PROTOCOL',
      alarm: '!! CONTAINMENT ALERT !!',
      log: 'MAINTENANCE LOG — STATION NET',
    };
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = layout === 'alarm' ? BAD : fg;
    ctx.textAlign = 'left';
    ctx.fillText(titles[layout], 10, 18);
    right(`${stamp()}  NODE 12`, W - 10, 18, fg, 12);
    label('STATION NET · LINK 98% · TAP 04', 10, H - 7, 'rgba(255,255,255,0.45)', 11);

    if (layout === 'telemetry') {
      const rows = [
        ['CORE TEMP', `${num(782, 846, 0)} °C`, OK],
        ['COOLANT ΔP', `${num(2.1, 2.9, 2)} MPa`, OK],
        ['NEUTRON FLUX', `${num(2.8, 3.6, 1)}e13 n/cm²s`, OK],
        ['ROD DEPTH', `${num(52, 74, 0)} %`, WARN],
        ['AUX BUS', rand() > 0.35 ? 'OFFLINE' : 'STANDBY', BAD],
        ['SHIELD INTEGRITY', `${num(88, 99.4, 1)} %`, OK],
      ];
      let y = 46;
      for (const [name, value, color] of rows) {
        label(name, 12, y, 'rgba(255,255,255,0.6)', 13);
        label(value, 240, y, color, 13, 'bold ');
        chip(W - 76, y - 11, color === OK ? 'NOMINAL' : color === WARN ? 'CAUTION' : 'FAULT', color);
        y += 27;
      }
      // Bus-load bargraph along the bottom.
      label('BUS LOAD', 12, 228, 'rgba(255,255,255,0.5)', 11);
      for (let i = 0; i < 12; i++) {
        const hgt = 5 + rand() * 22;
        ctx.fillStyle = i > 8 ? WARN : fg;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(96 + i * 24, 232 - hgt, 15, hgt);
      }
      ctx.globalAlpha = 1;
    } else if (layout === 'culture') {
      let y = 48;
      label('GROWTH MEDIUM  A-2 / 09 — MODIFIED HANKS', 12, y, WARN, 12, 'bold ');
      y += 22;
      formula('C6H12O6 + 6O2 → 6CO2 + 6H2O', 14, y); y += 22;
      formula('NaCl + H2SO4 → NaHSO4 + HCl', 14, y); y += 22;
      formula('CaCO3 + 2HCl → CaCl2 + H2O + CO2', 14, y); y += 22;
      formula('2NaHCO3 → Na2CO3 + H2O + CO2', 14, y);
      // Assay readouts on the right.
      const assay = [
        ['pH', num(6.8, 7.6, 2), fg],
        ['TEMP', `${num(36.5, 37.6, 1)} °C`, fg],
        ['O₂', `${num(20.4, 21.4, 1)} %`, fg],
        ['CO₂', `${num(4.6, 5.4, 1)} %`, fg],
        ['VIABILITY', `${num(96.5, 99.4, 1)} %`, OK],
      ];
      let ay = 48;
      for (const [name, value, color] of assay) {
        right(name, 372, ay, 'rgba(255,255,255,0.6)', 13);
        right(value, 500, ay, color, 13, 'bold ');
        ay += 24;
      }
      // Optical-density growth trace.
      ctx.strokeStyle = fg;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let k = 0; k <= 130; k += 5) {
        const gy = 208 - Math.min(1, k / 130) ** 2 * 34 - rand() * 3;
        if (k === 0) ctx.moveTo(W - 148, gy); else ctx.lineTo(W - 148 + k, gy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      label('OPTICAL DENSITY OD600', W - 148, 226, 'rgba(255,255,255,0.5)', 11);
    } else if (layout === 'alarm') {
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = BAD;
      ctx.fillRect(0, 32, W, 30);
      ctx.globalAlpha = 1;
      ctx.font = 'bold 15px monospace';
      ctx.fillStyle = BAD;
      ctx.textAlign = 'left';
      ctx.fillText('CONTAINMENT BREACH — SEAL 09 / LAB A-2', 14, 53);
      const rows = [
        ['TANK PRESSURE', `${num(112, 128, 0)} % NOMINAL`, BAD],
        ['SEAL INTEGRITY', `${num(24, 46, 0)} %`, BAD],
        ['BIO-SIGNATURE', 'MULTIPLE · MOVING', BAD],
        ['CULTURE STOCK', 'VIABLE — UNRESTRAINED', WARN],
        ['BULKHEADS 04 / 07', 'SEALED BY OPERATOR', OK],
      ];
      let y = 86;
      for (const [name, value, color] of rows) {
        label(name, 14, y, 'rgba(255,255,255,0.6)', 13);
        right(value, 498, y, color, 13, 'bold ');
        y += 29;
      }
      ctx.font = 'bold 14px monospace';
      ctx.fillStyle = WARN;
      ctx.textAlign = 'left';
      ctx.fillText('>> EVACUATE SECTOR B — DO NOT OPEN SEAL 09', 14, 232);
    } else {
      const entries = [
        ['AUX PWR BUS — BREAKER TRIP K-7', WARN],
        ['RELAY K-7 OVERCURRENT · RESET FAILED', WARN],
        ['CULTURE TANK 09 — PRESSURE RISE', BAD],
        ['SEAL 09 SENSOR — NO SIGNAL', BAD],
        ['DUCT SENSOR 12 — MOTION 2.4 m/s', BAD],
        ['BULKHEAD 04 — SEALED BY OPERATOR', OK],
        ['ROBOTICS BAY — OFFLINE FOR SERVICE', dim],
        ['SHIFT HANDOVER — INCOMPLETE', dim],
      ];
      let y = 46;
      for (const [msg, color] of entries) {
        label(stamp(), 11, y, 'rgba(255,255,255,0.45)', 11);
        ctx.fillStyle = color;
        ctx.fillRect(74, y - 8, 7, 7);
        label(msg, 90, y, color === dim ? dim : 'rgba(235,245,255,0.82)', 12);
        y += 23;
      }
      ctx.fillStyle = fg;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(90, y - 12, 8, 13);
      ctx.globalAlpha = 1;
    }

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
    wall: { base: '#aebcbd', seamX: 128, seamY: 256, grime: 2, rust: 0 },
    wallDark: { base: '#3e535b', seamX: 128, seamY: 256, grime: 3, rust: 0 },
    ceil: { base: '#263b44', seamX: 128, seamY: 128, grime: 1, rust: 0 },
    floor: { base: '#34494e', grout: 'rgba(0,0,0,0.2)', wear: 2 },
    concrete: { base: '#565d68', cracks: 4, stains: 6 },
    grate: { base: '#1c222b', bar: '#8e9aa8' },
    screen: { base: '#04121a', fg: '#3fd9ff' },
    screenKinds: ['telemetry', 'culture'],
    trim: 0x343d49, beam: 0x59636f, metal: 0x9aa6b4, metalDark: 0x4d5661,
    panel: 0x4a5563, pipe: 0x93a0ad, crate: 0x7d8a97, locker: 0x5f6c7c,
    debris: 0x565d68, rubber: 0x20252c, hazardColor: '#e8b23a',
    accent: 0x38c8ff, lamp: 0xd6ecff, lampLight: 0xaed8ff,
    exit: 0x5cff8a, warn: 0xffb340, emer: 0xff4030,
  },
  damaged: {
    seed: 233,
    wall: { base: '#626d6d', seamX: 128, seamY: 256, grime: 9, rust: 8 },
    wallDark: { base: '#283b42', seamX: 128, seamY: 256, grime: 12, rust: 8, scorch: 5 },
    ceil: { base: '#202d33', seamX: 128, seamY: 128, grime: 9, rust: 6, scorch: 2 },
    floor: { base: '#263b41', grout: 'rgba(0,0,0,0.3)', wear: 14 },
    concrete: { base: '#4a4239', cracks: 12, stains: 15 },
    grate: { base: '#181410', bar: '#7a6a58' },
    screen: { base: '#07151d', fg: '#71c9dc' },
    screenKinds: ['log', 'alarm'],
    trim: 0x332b22, beam: 0x453b30, metal: 0x7a6d5c, metalDark: 0x39322a,
    panel: 0x4e4437, pipe: 0x80705c, crate: 0x79644a, locker: 0x5a5f68,
    debris: 0x4a4239, rubber: 0x1a1712, hazardColor: '#d99a2b',
    accent: 0x71c9dc, lamp: 0xffd9a0, lampLight: 0xffb460,
    exit: 0x5cff8a, warn: 0xffb340, emer: 0xff4030,
  },
  emergency: {
    seed: 337,
    wall: { base: '#515c61', seamX: 128, seamY: 256, grime: 9, rust: 5, scorch: 6 },
    wallDark: { base: '#28353b', seamX: 128, seamY: 256, grime: 11, rust: 7, scorch: 9 },
    ceil: { base: '#202a30', seamX: 128, seamY: 128, grime: 10, rust: 5, scorch: 4 },
    floor: { base: '#29353a', grout: 'rgba(0,0,0,0.35)', wear: 14 },
    concrete: { base: '#3d2c28', cracks: 11, stains: 10 },
    grate: { base: '#150f0e', bar: '#6e524a' },
    screen: { base: '#1a0505', fg: '#ff5a3c' },
    screenKinds: ['alarm', 'telemetry'],
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
  const floorRepeat = themeName === 'lab' ? [3, 3] : [7, 7];
  const floorTex = tileTexture({ ...t.floor, seed: t.seed + 2, repeat: floorRepeat });
  const grateTex = gratingTexture({ ...t.grate, seed: t.seed + 3, repeat: [3, 3] });
  const concreteTex = concreteTexture({ ...t.concrete, seed: t.seed + 4, repeat: [4, 4] });
  const screenTex = screenTexture({ ...t.screen, seed: t.seed + 5, kinds: t.screenKinds });
  const screenTex2 = screenTexture({ ...t.screen, seed: t.seed + 6, kinds: t.screenKinds });

  // Surface relief: stronger bump + more roughness variance makes the panel
  // seams, rivets and floor grout catch the practical lights (Alien: Isolation
  // style depth) instead of reading as smooth, flat grey boxes.
  const wallPBR = buildPBRMaps({ seed: t.seed + 10, repeat: [4, 2], bumpStrength: themeName === 'lab' ? 0.95 : 1.3, roughnessBase: 0.55, roughnessVariance: themeName === 'lab' ? 0.42 : 0.3 });
  const floorPBR = buildPBRMaps({ seed: t.seed + 20, repeat: floorRepeat, bumpStrength: themeName === 'lab' ? 1.05 : 1.8, roughnessBase: themeName === 'lab' ? 0.82 : 0.7, roughnessVariance: themeName === 'lab' ? 0.22 : 0.4 });
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

  // Procedural grime / wetness / macro variation (see SurfaceShading.js).
  // Clean lab -> grimy, wet damaged corridors -> burnt emergency level.
  const surface = ({
    lab:       { grime: 0.35, wet: 0.0,  contact: 0.45, macro: 0.7 },
    damaged:   { grime: 0.85, wet: 0.55, contact: 0.6,  macro: 0.9 },
    emergency: { grime: 0.95, wet: 0.35, contact: 0.6,  macro: 0.9 },
  })[themeName] || { grime: 0.5, wet: 0, contact: 0.5, macro: 0.8 };
  for (const key of ['wall', 'wallDark', 'ceil', 'floor', 'concrete']) {
    applySurfaceShading(mats[key], surface);
  }
  for (const key of ['trim', 'beam', 'metal', 'metalDark', 'panel', 'pipe', 'locker', 'crate', 'debris']) {
    applySurfaceShading(mats[key], { grime: surface.grime * 0.6, wet: 0, contact: 0, macro: 0.35 });
  }

  // Animated CRT look on every terminal screen.
  applyCrtShading(mats.screen);
  applyCrtShading(mats.screenAlt);

  _themeCache.set(themeName, mats);
  return mats;
}
