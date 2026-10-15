import * as THREE from 'three';

let smoke, dust;

function smoothstep(a, b, value) {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash(x, y) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const u = smoothstep(0, 1, x - ix), v = smoothstep(0, 1, y - iy);
  const a = hash(ix, iy), b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

function texture(size, cloudy) {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1);
    const radius = Math.hypot(u * 2 - 1, v * 2 - 1);
    const cloud = cloudy ? noise(u * 5 + 7, v * 5 + 13) * 0.65
      + noise(u * 11 + 19, v * 11 + 3) * 0.25
      + noise(u * 23, v * 23) * 0.1 : 1;
    // Every edge is fully transparent: billboard corners never show up.
    const envelope = 1 - smoothstep(cloudy ? 0.12 : 0, 0.98, radius);
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(255 * envelope * (cloudy ? 0.3 + cloud * 0.7 : 1));
  }
  const result = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  result.magFilter = THREE.LinearFilter;
  result.minFilter = THREE.LinearMipmapLinearFilter;
  result.generateMipmaps = true;
  result.needsUpdate = true;
  return result;
}

// Shared across level loads; level teardown disposes materials, not these maps.
export function smokeTexture() { return smoke ??= texture(128, true); }
export function dustTexture() { return dust ??= texture(32, false); }
