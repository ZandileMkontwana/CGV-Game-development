/**
 * LevelKit.js — reusable modular builders for the level rebuild.
 *
 * Architecture:
 *   - LevelKit is constructed with a "host" (LevelManager). The host owns the
 *     scene, the physics world, and the cleanup registry; every kit call
 *     registers itself through the host's bookkeeping (_track / occluders),
 *     so level builds never poke the arrays directly.
 *   - Geometries are cached by dimension and materials come from
 *     LevelMaterials — both are shared for the whole session and must NOT be
 *     disposed on level teardown (the kit marks every mesh it creates with
 *     userData.kitShared so the teardown path can skip them).
 *   - Physics bodies are axis-aligned AABBs. Props may be rotated by the four
 *     cardinal faces; quarter-turns swap the half-extents handed to cannon so
 *     the collision matches the visuals.
 *
 * Everything here runs at level-load time only — nothing per frame.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { signMaterial, decalMaterial } from './LevelMaterials.js';

// ── Shared geometry cache ────────────────────────────────────────────────────
const _geoCache = new Map();
function boxGeo(w, h, d) {
  const k = `b|${w}|${h}|${d}`;
  if (!_geoCache.has(k)) _geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return _geoCache.get(k);
}
function cylGeo(rt, rb, h, seg = 14) {
  const k = `c|${rt}|${rb}|${h}|${seg}`;
  if (!_geoCache.has(k)) _geoCache.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
  return _geoCache.get(k);
}
function planeGeo(w, h) {
  const k = `p|${w}|${h}`;
  if (!_geoCache.has(k)) _geoCache.set(k, new THREE.PlaneGeometry(w, h));
  return _geoCache.get(k);
}
function sphereGeo(r, widthSegments, heightSegments) {
  const k = `s|${r}|${widthSegments}|${heightSegments}`;
  if (!_geoCache.has(k)) _geoCache.set(k, new THREE.SphereGeometry(r, widthSegments, heightSegments));
  return _geoCache.get(k);
}

/** Cosmetic-only seeded variation (crate tilts, debris scatter). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default class LevelKit {
  /**
   * @param {object} host  LevelManager (needs .scene, .physics, ._track(), .occluders)
   * @param {object} mats  theme material bundle from getThemeMaterials()
   */
  constructor(host, mats) {
    this.host = host;
    this.scene = host.scene;
    this.physics = host.physics;
    this.mats = mats;
  }

  // ── Registration core ──────────────────────────────────────────────────────

  /**
   * Add a mesh to the scene and register it for cleanup, optional physics
   * body and optional line-of-sight occlusion.
   *
   * @param {THREE.Mesh} mesh  position must already be set (body uses it)
   * @param {object} o
   *   physics  true to create an AABB body sized from the mesh dims
   *   w/h/d    explicit dims for the body when they differ from the visual
   *   rotY     Y rotation in radians (quarter turns swap body extents)
   *   occluder true to add the mesh to the monster's LOS block list
   */
  _add(mesh, o = {}) {
    if (o.rotY) mesh.rotation.y = o.rotY;
    mesh.castShadow = o.cast !== false;
    mesh.receiveShadow = o.receive !== false;
    mesh.userData.kitShared = true;
    mesh.userData.staticScenery = true;
    this.scene.add(mesh);

    let body = null;
    if (o.physics) {
      const quarter = Math.abs(Math.abs(o.rotY || 0) - Math.PI / 2) < 0.01;
      const hw = o.w !== undefined ? o.w / 2 : 0.5;
      const hh = o.h !== undefined ? o.h / 2 : 0.5;
      const hd = o.d !== undefined ? o.d / 2 : 0.5;
      body = this.physics.createBox(
        0,
        quarter ? hd : hw,
        hh,
        quarter ? hw : hd,
        new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z)
      );
      // Kit props are static. Syncing an axis-aligned body back to a mesh
      // would erase its intended rotation and retain it after level teardown.
    }
    this.host._track(mesh, body);
    if (o.occluder) this.host.occluders.push(mesh);
    return mesh;
  }

  /** Basic box primitive. Pass { physics: true, w, h, d } for collision. */
  box(mat, w, h, d, x, y, z, o = {}) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), mat);
    mesh.position.set(x, y, z);
    if (o.physics) { o.w = w; o.h = h; o.d = d; }
    return this._add(mesh, o);
  }

  /** Basic cylinder primitive (vertical by default). */
  cyl(mat, rt, rb, h, x, y, z, o = {}) {
    const mesh = new THREE.Mesh(cylGeo(rt, rb, h, o.seg || 14), mat);
    mesh.position.set(x, y, z);
    if (o.rx) mesh.rotation.x = o.rx;
    if (o.rz) mesh.rotation.z = o.rz;
    if (o.physics) { o.w = rt * 2; o.h = h; o.d = rt * 2; }
    return this._add(mesh, o);
  }

  /** Basic plane (floor/ceiling/wall decoration). Never casts shadows. */
  plane(mat, w, h, x, y, z, o = {}) {
    const mesh = new THREE.Mesh(planeGeo(w, h), mat);
    mesh.position.set(x, y, z);
    if (o.rx !== undefined) mesh.rotation.x = o.rx;
    if (o.ry !== undefined) mesh.rotation.y = o.ry;
    if (o.rz !== undefined) mesh.rotation.z = o.rz;
    if (o.cast === undefined) o.cast = false;
    return this._add(mesh, o);
  }

  /** Attach a child detail mesh (children follow the parent, not raycast). */
  _child(parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(boxGeo(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = false;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // ── Architecture ───────────────────────────────────────────────────────────

  /**
   * A wall run with panel trim: base, skirt, cornice and optional cable trays.
   * Long axis is inferred from w vs d; details protrude through both faces so
   * the wall reads correctly from either side.
   */
  wallRun(w, h, d, x, y, z, o = {}) {
    const mat = o.mat || this.mats.wall;
    const base = this.box(mat, w, h, d, x, y, z, { physics: true, occluder: h >= 1.5 });
    if (o.decor === false) return base;

    const trim = o.trimMat || this.mats.trim;
    const long = w >= d;
    const thin = long ? d : w;
    // Skirt + cornice run the full length and stick out ~6 cm each side.
    if (long) {
      this._child(base, trim, w, 0.16, thin + 0.12, 0, -h / 2 + 0.08, 0);
      this._child(base, trim, w, 0.10, thin + 0.10, 0, h / 2 - 0.05, 0);
      if (o.trays !== false) {
        this._child(base, this.mats.metalDark, w, 0.05, thin + 0.16, 0, h / 2 - 0.42, 0);
        if (o.trays === 2) {
          this._child(base, this.mats.pipe, w, 0.07, thin + 0.18, 0, h / 2 - 0.62, 0);
        }
      }
    } else {
      this._child(base, trim, thin + 0.12, 0.16, d, 0, -h / 2 + 0.08, 0);
      this._child(base, trim, thin + 0.10, 0.10, d, 0, h / 2 - 0.05, 0);
      if (o.trays !== false) {
        this._child(base, this.mats.metalDark, thin + 0.16, 0.05, d, 0, h / 2 - 0.42, 0);
        if (o.trays === 2) {
          this._child(base, this.mats.pipe, thin + 0.18, 0.07, d, 0, h / 2 - 0.62, 0);
        }
      }
    }
    return base;
  }

  /** Floor slab with a border trim and optional glowing guide lines. */
  floorSlab(w, d, x, z, o = {}) {
    const y = o.y || 0;
    const mat = o.mat || this.mats.floor;
    this.plane(mat, w, d, x, y, z, { rx: -Math.PI / 2 });
    if (o.trim !== false) {
      const t = o.trimMat || this.mats.trim;
      const e = 0.14;
      this.box(t, w, 0.04, e, x, y + 0.02, z - d / 2 + e / 2, { cast: false });
      this.box(t, w, 0.04, e, x, y + 0.02, z + d / 2 - e / 2, { cast: false });
      this.box(t, e, 0.04, d - e * 2, x - w / 2 + e / 2, y + 0.02, z, { cast: false });
      this.box(t, e, 0.04, d - e * 2, x + w / 2 - e / 2, y + 0.02, z, { cast: false });
    }
    for (const ln of o.lines || []) {
      const mat2 = ln.color === 'exit' ? this.mats.exitGreen
        : ln.color === 'emer' ? this.mats.emergencyRed
          : ln.color === 'warn' ? this.mats.beaconAmber : this.mats.accent;
      if (ln.axis === 'x') {
        this.box(mat2, ln.len || w * 0.8, 0.012, 0.08, x + (ln.off || 0), y + 0.012, z + (ln.at || 0));
      } else {
        this.box(mat2, 0.08, 0.012, ln.len || d * 0.8, x + (ln.at || 0), y + 0.012, z + (ln.off || 0));
      }
    }
    return null;
  }

  /** Ceiling slab with structural beams and hanging lamp fixtures. */
  ceilingSlab(w, d, x, y, z, o = {}) {
    this.plane(o.mat || this.mats.ceil, w, d, x, y, z, { rx: Math.PI / 2 });
    if (o.beams !== false) {
      const n = Math.max(1, Math.round(d / 4));
      for (let i = 1; i < n; i++) {
        const bz = z - d / 2 + (d / n) * i;
        this.box(this.mats.beam, w, 0.16, 0.16, x, y - 0.09, bz);
      }
    }
    for (const l of o.lamps || []) {
      this.lamp(l.x, z + l.z, { y: y - 0.12, color: l.color, light: l.light, intensity: l.intensity });
    }
    return null;
  }

  /** Ceiling lamp: housing + diffuser + optional real point light. */
  lamp(x, z, o = {}) {
    const y = o.y !== undefined ? o.y : 2.85;
    const colorName = o.color || 'cool';
    const panel = colorName === 'amber' ? this.mats.beaconAmber
      : colorName === 'red' ? this.mats.emergencyRed : this.mats.lampPanel;
    this.box(this.mats.metalDark, 1.0, 0.07, 0.30, x, y, z);
    this.box(panel, 0.86, 0.05, 0.22, x, y - 0.05, z, { cast: false });
    if (o.light !== false) {
      const c = colorName === 'amber' ? this.mats.colors.warn
        : colorName === 'red' ? this.mats.colors.emer : this.mats.colors.lampLight;
      const light = new THREE.PointLight(c, o.intensity || 0.9, 11, 2);
            light.userData.flicker = true;
      light.position.set(x, y - 0.35, z);
      this.scene.add(light);
      this.host._track(light);
    }
    return null;
  }

  /** A parallel pipe run with flanges, along 'x' or 'z'. */
  pipeRun(axis, length, x, y, z, o = {}) {
    const count = o.count || 2;
    const r = o.r || 0.07;
    const mat = o.mat || this.mats.pipe;
    const spacing = o.spacing || 0.18;
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * spacing;
      const px = axis === 'x' ? x : x + off;
      const pz = axis === 'x' ? z + off : z;
      const py = y - i * 0.02;
      const m = this.cyl(mat, r, r, length, px, py, pz, { cast: false });
      if (axis === 'x') m.rotation.z = Math.PI / 2;
      else m.rotation.x = Math.PI / 2;
      if (o.flanges !== false) {
        const n = Math.max(2, Math.round(length / 3));
        for (let f = 1; f < n; f++) {
          const t = -length / 2 + (length / n) * f;
          const fx = axis === 'x' ? x + t : px;
          const fz = axis === 'x' ? pz : z + t;
          const fl = this.cyl(mat, r * 1.5, r * 1.5, 0.06, fx, py, fz, { cast: false });
          if (axis === 'x') fl.rotation.z = Math.PI / 2;
          else fl.rotation.x = Math.PI / 2;
        }
      }
    }
    return null;
  }

  /** Ventilation duct (box) with straps and optional grille openings. */
  duct(axis, length, x, y, z, o = {}) {
    const w = o.w || 0.55;
    const h = o.h || 0.42;
    const mat = o.mat || this.mats.metalDark;
    const main = axis === 'x'
      ? this.box(mat, length, h, w, x, y, z, { cast: false })
      : this.box(mat, w, h, length, x, y, z, { cast: false });
    const n = Math.max(2, Math.round(length / 4));
    for (let i = 1; i < n; i++) {
      const t = -length / 2 + (length / n) * i;
      if (axis === 'x') this._child(main, this.mats.metal, 0.08, h + 0.06, w + 0.06, t, 0, 0);
      else this._child(main, this.mats.metal, w + 0.06, h + 0.06, 0.08, 0, 0, t);
    }
    if (o.grilles) {
      for (const g of o.grilles) {
        const m = new THREE.Mesh(planeGeo(0.75, 0.75), this.mats.grate);
        m.rotation.x = -Math.PI / 2;
        m.position.set(axis === 'x' ? x + g : x, y - h / 2 - 0.01, axis === 'x' ? z : z + g);
        this.scene.add(m);
        this.host._track(m);
      }
    }
    return null;
  }

  /** Cable tray running along 'x' or 'z' with side lips and supports. */
  cableTray(axis, length, x, y, z, o = {}) {
    const w = o.w || 0.3;
    const mat = this.mats.metalDark;
    if (axis === 'x') {
      this.box(mat, length, 0.04, w, x, y, z, { cast: false });
      this.box(mat, length, 0.07, 0.03, x, y + 0.035, z - w / 2, { cast: false });
      this.box(mat, length, 0.07, 0.03, x, y + 0.035, z + w / 2, { cast: false });
      const n = Math.max(1, Math.round(length / 5));
      for (let i = 0; i < n; i++) {
        this.box(mat, 0.06, 0.28, w + 0.06, x - length / 2 + (length / (n + 1)) * (i + 1), y - 0.12, z, { cast: false });
      }
    } else {
      this.box(mat, w, 0.04, length, x, y, z, { cast: false });
      this.box(mat, 0.03, 0.07, length, x - w / 2, y + 0.035, z, { cast: false });
      this.box(mat, 0.03, 0.07, length, x + w / 2, y + 0.035, z, { cast: false });
      const n = Math.max(1, Math.round(length / 5));
      for (let i = 0; i < n; i++) {
        this.box(mat, w + 0.06, 0.28, 0.06, x, y - 0.12, z - length / 2 + (length / (n + 1)) * (i + 1), { cast: false });
      }
    }
    return null;
  }

  /** Support column with base + cap plates. Blocks LOS when full height. */
  column(x, z, o = {}) {
    const h = o.h || 3;
    const r = o.r || 0.24;
    const mat = o.mat || this.mats.metal;
    const m = this.cyl(mat, r, r, h, x, h / 2, z, { physics: true, seg: 12, occluder: h >= 1.5 });
    this._child(m, this.mats.metalDark, r * 2.8, 0.1, r * 2.8, 0, -h / 2 + 0.05, 0);
    this._child(m, this.mats.metalDark, r * 2.6, 0.08, r * 2.6, 0, h / 2 - 0.04, 0);
    return m;
  }

  /** Simple safety railing along 'x' or 'z'. */
  railing(axis, length, x, y, z, o = {}) {
    const h = o.h || 1.1;
    const mat = o.mat || this.mats.metal;
    const posts = Math.max(2, Math.round(length / 1.6));
    for (let i = 0; i <= posts; i++) {
      const t = -length / 2 + (length / posts) * i;
      if (axis === 'x') this.box(mat, 0.06, h, 0.06, x + t, y + h / 2, z, { cast: false });
      else this.box(mat, 0.06, h, 0.06, x, y + h / 2, z + t, { cast: false });
    }
    if (axis === 'x') {
      this.box(mat, length, 0.06, 0.06, x, y + h, z, { cast: false });
      this.box(mat, length, 0.05, 0.05, x, y + h * 0.55, z, { cast: false });
    } else {
      this.box(mat, 0.06, 0.06, length, x, y + h, z, { cast: false });
      this.box(mat, 0.05, 0.05, length, x, y + h * 0.55, z, { cast: false });
    }
    return null;
  }

  /** Door frame around a wall opening (the door itself is LevelManager's). */
  doorway(w, h, x, y, z, face, o = {}) {
    const mat = o.mat || this.mats.metalDark;
    const rotY = this.faceAngle(face);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    g.userData.staticScenery = true;
    const post = (px) => {
      const m = new THREE.Mesh(boxGeo(0.16, h + 0.16, 0.26), mat);
      m.position.set(px, 0, 0);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    };
    post(-w / 2 - 0.08);
    post(w / 2 + 0.08);
    const lintel = new THREE.Mesh(boxGeo(w + 0.32, 0.16, 0.26), mat);
    lintel.position.set(0, h / 2 + 0.08, 0);
    lintel.castShadow = true; lintel.receiveShadow = true;
    g.add(lintel);
    if (o.hazard !== false) {
      const hz = new THREE.Mesh(planeGeo(w, 0.14), this.mats.hazard);
      hz.position.set(0, h / 2 - 0.1, 0.14);
      g.add(hz);
    }
    this.scene.add(g);
    this.host._track(g);
    return g;
  }

  /** Wall vent grille (visual only). */
  ventGrille(x, y, z, face, o = {}) {
    const w = o.w || 0.9;
    const h = o.h || 0.5;
    const g = new THREE.Group();
    g.userData.staticScenery = true;
    g.position.set(x, y, z);
    g.rotation.y = this.faceAngle(face);
    const frame = new THREE.Mesh(boxGeo(w, h, 0.08), this.mats.metalDark);
    frame.castShadow = false; frame.receiveShadow = true;
    g.add(frame);
    const slats = Math.max(3, Math.round(h / 0.09));
    for (let i = 0; i < slats; i++) {
      const s = new THREE.Mesh(boxGeo(w - 0.1, 0.04, 0.03), this.mats.metal);
      s.position.set(0, -h / 2 + 0.06 + i * (h - 0.12) / (slats - 1), 0.05);
      s.rotation.x = 0.5;
      g.add(s);
    }
    this.scene.add(g);
    this.host._track(g);
    return g;
  }

  /** Bank of wall-mounted screens (visual only). */
  wallScreen(x, y, z, face, o = {}) {
    const w = o.w || 2.2;
    const h = o.h || 1.2;
    const g = new THREE.Group();
    g.userData.staticScenery = true;
    g.position.set(x, y, z);
    g.rotation.y = this.faceAngle(face);
    const frame = new THREE.Mesh(boxGeo(w + 0.16, h + 0.16, 0.12), this.mats.metalDark);
    frame.castShadow = false; frame.receiveShadow = true;
    g.add(frame);
    const screen = new THREE.Mesh(planeGeo(w, h), o.alt ? this.mats.screenAlt : this.mats.screen);
    screen.position.z = 0.07;
    g.add(screen);
    // Two indicator lights on the frame.
    const dotMat = o.dotMat || this.mats.accent;
    for (const dx of [-w / 2 + 0.15, w / 2 - 0.15]) {
      const dot = new THREE.Mesh(boxGeo(0.06, 0.06, 0.03), dotMat);
      dot.position.set(dx, h / 2 + 0.05, 0.07);
      g.add(dot);
    }
    this.scene.add(g);
    this.host._track(g);
    return g;
  }

  /**
   * Mission directive board — a wall-mounted display that prints the current
   * objective in the world. Game.js redraws it via setObjective() every time
   * the HUD objective changes, so the wall always states the live goal.
   *
   * Deliberately NOT flagged staticScenery: the frozen StaticBatch proxies
   * cannot carry a canvas that changes after the level is built. Only the
   * canvas texture and its material are per-instance — the frame, bezel and
   * screen reuse the cached kit geometries and shared theme materials, so
   * dispose() only has to release the texture and material.
   *
   * @param {number} x,y,z  world position
   * @param {string} face   'n' | 'e' | 's' | 'w' — the direction it faces
   * @param {object} o  {w, h, head (heading band), tag (right-hand label),
   *                     objective (initial text)}
   * @returns {{group: THREE.Group, setObjective: Function, dispose: Function}}
   */
  goalBoard(x, y, z, face, o = {}) {
    const w = o.w || 1.7;
    const h = o.h || 1.3;
    const head = o.head || 'MISSION DIRECTIVE';
    let tag = o.tag || '';
    let objective = (o.objective || 'AWAITING DIRECTIVE').toUpperCase();

    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = this.faceAngle(face);

    const frame = new THREE.Mesh(boxGeo(w + 0.14, h + 0.14, 0.08), this.mats.metalDark);
    frame.castShadow = false;
    frame.receiveShadow = true;
    group.add(frame);

    const bezel = new THREE.Mesh(boxGeo(w + 0.02, h + 0.02, 0.03), this.mats.rubber);
    bezel.position.z = 0.04;
    bezel.castShadow = false;
    group.add(bezel);

    // Live canvas — one instance per board, redrawn on every objective change.
    const W = 512;
    const H = Math.round((W * h) / w);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, toneMapped: false,
    });
    const screen = new THREE.Mesh(planeGeo(w * 0.9, h * 0.88), material);
    screen.position.z = 0.065;
    group.add(screen);

    // Bezel status lamps.
    for (const dx of [-w * 0.4, w * 0.4]) {
      const dot = new THREE.Mesh(boxGeo(0.05, 0.05, 0.02), this.mats.accent);
      dot.position.set(dx, h / 2 + 0.055, 0.075);
      dot.castShadow = false;
      group.add(dot);
    }

    const PAD = 26;
    const HEAD_H = 46;
    const LABEL_H = 24;
    const FOOT_H = 34;
    const BODY_W = W - PAD * 2 - 14;

    const wrapSegment = (segment, size) => {
      ctx.font = `bold ${size}px monospace`;
      const lines = [];
      let line = '';
      for (const word of segment.split(' ').filter(Boolean)) {
        const probe = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(probe).width > BODY_W) {
          lines.push(line);
          line = word;
        } else {
          line = probe;
        }
      }
      if (line) lines.push(line);
      return lines;
    };

    /** Largest size whose wrapped lines still fit the space under the label. */
    const fitBody = () => {
      const segments = objective.split('/').map(s => s.trim()).filter(Boolean);
      const budget = H - HEAD_H - LABEL_H - FOOT_H - 10;
      for (let size = 30; size >= 15; size--) {
        const lines = segments.flatMap(segment => wrapSegment(segment, size));
        if (lines.length * size * 1.26 <= budget) return { size, lines };
      }
      return { size: 15, lines: segments.flatMap(segment => wrapSegment(segment, 15)) };
    };

    const draw = () => {
      ctx.fillStyle = '#060d13';
      ctx.fillRect(0, 0, W, H);
      // Faint facilities grid + bright outer border.
      ctx.strokeStyle = 'rgba(90,220,255,0.06)';
      ctx.lineWidth = 1;
      for (let gx = 32; gx < W; gx += 32) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      }
      for (let gy = 32; gy < H; gy += 32) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(120,230,255,0.55)';
      ctx.lineWidth = 3;
      ctx.strokeRect(4, 4, W - 8, H - 8);

      // Heading band + right-aligned level tag.
      ctx.fillStyle = 'rgba(18,54,74,0.92)';
      ctx.fillRect(4, 4, W - 8, HEAD_H);
      ctx.fillStyle = 'rgba(120,230,255,0.85)';
      ctx.fillRect(4, HEAD_H + 1, W - 8, 2);
      ctx.font = 'bold 22px monospace';
      ctx.fillStyle = '#eafcff';
      ctx.fillText(head.toUpperCase(), PAD, 35);
      if (tag) {
        ctx.font = '16px monospace';
        ctx.fillStyle = 'rgba(150,235,255,0.75)';
        ctx.textAlign = 'right';
        ctx.fillText(tag.toUpperCase(), W - PAD, 35);
        ctx.textAlign = 'left';
      }

      // Objective label (triangle drawn by hand — the glyph is not portable).
      const labelY = HEAD_H + LABEL_H - 6;
      ctx.fillStyle = '#ffc566';
      ctx.beginPath();
      ctx.moveTo(PAD, labelY - 16);
      ctx.lineTo(PAD + 10, labelY - 11);
      ctx.lineTo(PAD, labelY - 6);
      ctx.closePath();
      ctx.fill();
      ctx.font = 'bold 15px monospace';
      ctx.fillText('CURRENT OBJECTIVE', PAD + 16, labelY);

      // Auto-fitted objective text.
      const { size, lines } = fitBody();
      const lineH = size * 1.26;
      ctx.font = `bold ${size}px monospace`;
      ctx.fillStyle = '#eaf6ff';
      let ty = labelY + 12 + size;
      for (const line of lines) {
        ctx.fillText(line, PAD + 12, ty);
        ty += lineH;
      }
      ctx.fillStyle = 'rgba(255,180,70,0.9)';
      ctx.fillRect(PAD, labelY + 6, 3, Math.min(lines.length * lineH, H - FOOT_H - labelY - 12));

      // Footer rail.
      ctx.fillStyle = 'rgba(10,32,44,0.95)';
      ctx.fillRect(4, H - FOOT_H, W - 8, FOOT_H - 4);
      ctx.font = '13px monospace';
      ctx.fillStyle = '#7fe0b2';
      ctx.fillText('STATUS: ACTIVE DIRECTIVE', PAD, H - 15);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(150,235,255,0.7)';
      ctx.fillText('DIRECTIVE BOARD 01', W - PAD, H - 15);
      ctx.textAlign = 'left';
      texture.needsUpdate = true;
    };

    draw();
    this.scene.add(group);

    return {
      group,
      /** Publish a new objective (reason: Game.js _setObjective). */
      setObjective: (text, nextTag) => {
        objective = (text || '').toUpperCase() || 'AWAITING DIRECTIVE';
        if (nextTag) tag = nextTag;
        draw();
      },
      /** Owns only the canvas texture + material; the rest is shared kit data. */
      dispose: () => {
        this.scene.remove(group);
        texture.dispose();
        material.dispose();
      },
    };
  }

  /** Rotating fan blade assembly — pass the returned group to host._addRotatingHazard. */
  fanBlade(x, y, z, o = {}) {
    const r = o.r || 0.85;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.userData.kitShared = true;
    const hub = new THREE.Mesh(cylGeo(0.11, 0.11, 0.12, 10), this.mats.metalDark);
    g.add(hub);
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(boxGeo(r, 0.05, 0.26), this.mats.metal);
      blade.rotation.y = (Math.PI * 2 / 3) * i;
      blade.translateX(r / 2);
      blade.castShadow = true;
      g.add(blade);
    }
    this.scene.add(g);
    this.host._track(g);
    return g;
  }

  /** Valve wheel + pipe stub next to a shootable hazard target. */
  valveWheel(x, y, z, face, o = {}) {
    const r = o.r || 0.2;
    const g = new THREE.Group();
    g.userData.staticScenery = true;
    g.position.set(x, y, z);
    g.rotation.y = this.faceAngle(face);
    const wheel = new THREE.Mesh(cylGeo(r, r, 0.05, 12), this.mats.beaconAmber || this.mats.metal);
    wheel.rotation.x = Math.PI / 2;
    wheel.castShadow = false;
    g.add(wheel);
    const stub = new THREE.Mesh(cylGeo(0.05, 0.05, 0.3, 8), this.mats.pipe);
    stub.rotation.x = Math.PI / 2;
    stub.position.z = -0.14;
    g.add(stub);
    this.scene.add(g);
    this.host._track(g);
    return g;
  }

  /** Fallen ceiling panel leaning against something (visual only). */
  fallenPanel(x, y, z, o = {}) {
    const w = o.w || 2.0;
    const d = o.d || 1.4;
    const m = this.box(o.mat || this.mats.metalDark, w, 0.08, d, x, y, z, { cast: true });
    m.rotation.set(o.rx || 0.32, o.ry || 0.2, o.rz || 0);
    return m;
  }

  /** Pipe hanging torn from the ceiling (visual only). */
  hangingPipe(x, y, z, o = {}) {
    const len = o.len || 2.4;
    const m = this.cyl(this.mats.pipe, 0.07, 0.07, len, x, y, z, { cast: true });
    m.rotation.set(0, 0, o.tilt || 0.65);
    return m;
  }

  // ── Props ───────────────────────────────────────────────────────────────────

  /** Control-room desk with monitors and a keyboard. */
  consoleDesk(x, z, face, o = {}) {
    const w = o.w || 2.0;
    const d = o.d || 1.0;
    const rotY = this.faceAngle(face);
    const main = this.box(this.mats.panel, w, 0.76, d, x, 0.38, z, { physics: true, rotY });
    this._child(main, this.mats.metalDark, w + 0.06, 0.05, d + 0.06, 0, 0.38, 0);
    this._child(main, this.mats.metalDark, w - 0.2, 0.5, 0.06, 0, -0.08, d / 2 - 0.03);
    const n = o.monitors === undefined ? 2 : o.monitors;
    for (let i = 0; i < n; i++) {
      const sx = n === 1 ? 0 : (i - (n - 1) / 2) * 0.75;
      const scr = this._child(main, i % 2 ? this.mats.screenAlt : this.mats.screen, 0.62, 0.4, 0.05, sx, 0.66, -0.05);
      scr.rotation.x = -0.12;
    }
    this._child(main, this.mats.rubber, 0.5, 0.03, 0.18, 0, 0.41, d / 2 - 0.24);
    return main;
  }

  /** Laboratory workbench with instruments and lower cabinets. */
  labBench(x, z, face, o = {}) {
    const len = o.len || 2.4;
    const rotY = this.faceAngle(face);
    const main = this.box(this.mats.panel, len, 0.88, 0.75, x, 0.44, z, { physics: true, rotY });
    this._child(main, this.mats.metal, len + 0.06, 0.05, 0.8, 0, 0.44, 0);
    // Lower cabinet doors.
    const doors = Math.max(2, Math.round(len / 1.1));
    for (let i = 0; i < doors; i++) {
      const dx = -len / 2 + (len / doors) * (i + 0.5);
      this._child(main, this.mats.metalDark, len / doors - 0.08, 0.55, 0.03, dx, -0.12, 0.38);
      this._child(main, this.mats.metal, 0.06, 0.1, 0.04, dx + len / doors / 2 - 0.12, -0.12, 0.4);
    }
    // Instruments on top.
    this._child(main, this.mats.accent, 0.24, 0.2, 0.24, -len / 4, 0.56, 0.1);
    this._child(main, this.mats.metal, 0.18, 0.34, 0.18, len / 4, 0.63, -0.05);
    this._child(main, this.mats.glass, 0.16, 0.22, 0.16, len / 4 + 0.3, 0.57, 0.2);
    return main;
  }

  /** Simple lab chair (physics on the seat footprint). */
  chair(x, z, face, o = {}) {
    const rotY = this.faceAngle(face);
    const main = this.box(this.mats.rubber, 0.46, 0.08, 0.46, x, 0.46, z, { physics: true, rotY });
    this._child(main, this.mats.rubber, 0.44, 0.5, 0.07, 0, 0.33, -0.2);
    this._child(main, this.mats.metalDark, 0.08, 0.42, 0.08, 0, -0.25, 0);
    this._child(main, this.mats.metalDark, 0.5, 0.05, 0.5, 0, -0.44, 0);
    return main;
  }

  /** Row of lockers — one tall collider, detailed doors. Stealth cover. */
  lockerBank(x, z, face, o = {}) {
    const count = o.count || 3;
    const h = o.h || 2.0;
    const w = count * 0.62;
    const rotY = this.faceAngle(face);
    const main = this.box(this.mats.locker, w, h, 0.55, x, h / 2, z, { physics: true, occluder: true, rotY });
    for (let i = 0; i < count; i++) {
      const dx = -w / 2 + 0.31 + i * 0.62;
      this._child(main, this.mats.metalDark, 0.56, h - 0.1, 0.03, dx, 0, 0.28);
      this._child(main, this.mats.metal, 0.05, 0.14, 0.03, dx + 0.2, 0, 0.3);
      for (let v = 0; v < 3; v++) {
        this._child(main, this.mats.rubber, 0.3, 0.02, 0.02, dx, h / 2 - 0.2 - v * 0.05, 0.3);
      }
    }
    return main;
  }

  /** Storage cabinet with a couple of items on top. */
  cabinet(x, z, face, o = {}) {
    const h = o.h || 1.8;
    const rotY = this.faceAngle(face);
    const main = this.box(this.mats.panel, 0.9, h, 0.5, x, h / 2, z, { physics: true, occluder: h >= 1.5, rotY });
    this._child(main, this.mats.metalDark, 0.8, h - 0.12, 0.03, 0, 0, 0.26);
    this._child(main, this.mats.metal, 0.05, 0.16, 0.03, 0.32, 0, 0.28);
    this._child(main, this.mats.metal, 0.05, 0.16, 0.03, -0.32, 0, 0.28);
    this._child(main, this.mats.crate, 0.3, 0.22, 0.3, -0.2, h / 2 + 0.11, 0);
    return main;
  }

  /** Storage unit — solid collider with front framing and stacked items. */
  shelfUnit(x, z, face, o = {}) {
    const w = o.w || 1.6;
    const h = o.h || 2.0;
    const d = o.d || 0.5;
    const rotY = this.faceAngle(face);
    const main = this.box(this.mats.metalDark, w, h, d, x, h / 2, z, { physics: true, occluder: true, rotY });
    // Front framing: three shelf ledges + two item boxes reading as stored kit.
    for (const ly of [-0.3, 0, 0.3]) {
      this._child(main, this.mats.metal, w - 0.08, 0.05, 0.04, 0, ly * h, d / 2 + 0.01);
    }
    this._child(main, this.mats.crate, 0.4, 0.34, 0.06, -0.35, 0.3 * h - 0.2, d / 2 + 0.03);
    this._child(main, this.mats.locker, 0.3, 0.44, 0.06, 0.3, -0.05, d / 2 + 0.03);
    return main;
  }

  /** Single supply crate (square footprint — safe at any rotation). */
  crate(x, z, o = {}) {
    const s = o.s || 0.8;
    const rotY = o.rotY || 0;
    const main = this.box(this.mats.crate, s, s, s, x, s / 2, z, { physics: true, occluder: s >= 1.5, rotY });
    const e = s * 0.09;
    this._child(main, this.mats.metalDark, e, s + 0.01, e, s / 2 - e / 2, 0, s / 2 - e / 2);
    this._child(main, this.mats.metalDark, e, s + 0.01, e, -s / 2 + e / 2, 0, s / 2 - e / 2);
    this._child(main, this.mats.metalDark, e, s + 0.01, e, s / 2 - e / 2, 0, -s / 2 + e / 2);
    this._child(main, this.mats.metalDark, e, s + 0.01, e, -s / 2 + e / 2, 0, -s / 2 + e / 2);
    this._child(main, this.mats.metalDark, s, e, s, 0, s / 2 - e / 2, 0);
    return main;
  }

  /** Tall pallet + crate stack — a proper piece of stealth cover. */
  crateStack(x, z, o = {}) {
    const w = o.w || 1.7;
    const h = o.h || 1.7;
    const d = o.d || 0.9;
    const rotY = o.rotY || 0;
    this.box(this.mats.metalDark, w + 0.1, 0.1, d + 0.1, x, 0.05, z, { rotY });
    const main = this.box(this.mats.crate, w, h, d, x, 0.1 + h / 2, z, { physics: true, occluder: true, rotY });
    this._child(main, this.mats.metalDark, w + 0.02, 0.06, d + 0.02, 0, h / 2 - 0.05, 0);
    const top = this._child(main, this.mats.crate, w * 0.5, 0.4, d * 0.6, -w * 0.2, h / 2 + 0.2, 0);
    top.rotation.y = 0.16;
    this._child(main, this.mats.rubber, w, 0.05, 0.08, 0, 0, d / 2 + 0.01);
    return main;
  }

  /** Hazard barrel. */
  barrel(x, z, o = {}) {
    const r = 0.32;
    const h = 0.95;
    const main = this.cyl(this.mats.hazard, r, r, h, x, h / 2, z, { physics: true, seg: 12 });
    for (const ry of [-0.22, 0.22]) {
      const ring = new THREE.Mesh(cylGeo(r + 0.02, r + 0.02, 0.06, 12), this.mats.metalDark);
      ring.position.y = ry * h;
      main.add(ring);
    }
    return main;
  }

  /** Small gas canister (decorative). */
  canister(x, z, o = {}) {
    const r = 0.15;
    const h = 0.72;
    const main = this.cyl(this.mats.metal, r, r, h, x, h / 2, z, { seg: 10 });
    this._child(main, this.mats.metalDark, 0.12, 0.12, 0.12, 0, h / 2 + 0.06, 0);
    return main;
  }

  /** Server rack — tall, emissive status strips, blocks LOS. */
  serverRack(x, z, face, o = {}) {
    const h = o.h || 2.1;
    const rotY = this.faceAngle(face);
    const main = this.box(this.mats.metalDark, 0.72, h, 0.95, x, h / 2, z, { physics: true, occluder: true, rotY });
    this._child(main, this.mats.rubber, 0.6, h - 0.16, 0.03, 0, 0, 0.49);
    for (let i = 0; i < 3; i++) {
      const strip = this._child(main, i === 1 ? this.mats.accent : this.mats.screen, 0.5, 0.05, 0.03, 0, h / 2 - 0.3 - i * 0.55, 0.51);
      strip.castShadow = false;
    }
    this._child(main, this.mats.pipe, 0.08, 0.08, 0.3, -0.2, h / 2 + 0.04, 0);
    return main;
  }

  /** Crew bunk (mattress + frame) for the quarters. */
  bunk(x, z, face, o = {}) {
    const rotY = this.faceAngle(face);
    const main = this.box(this.mats.metalDark, 2.0, 0.42, 0.9, x, 0.21, z, { physics: true, rotY });
    this._child(main, this.mats.locker, 1.9, 0.2, 0.8, 0, 0.3, 0);
    this._child(main, this.mats.rubber, 0.5, 0.12, 0.6, -0.65, 0.44, 0);
    this._child(main, this.mats.metal, 0.06, 0.9, 0.9, -1.0, 0.35, 0);
    return main;
  }

  /** Containment tube — the Level 1 focal prop (glass + specimen + cables). */
  containmentTube(x, z, o = {}) {
    const r = o.r || 0.85;
    const h = o.h || 2.6;
    this.box(this.mats.metalDark, r * 3, 0.28, r * 3, x, 0.14, z, { physics: true });
    const glass = this.cyl(this.mats.tubeGlass, r, r, h, x, 0.28 + h / 2, z, { physics: true, seg: 18, cast: false });
    for (const ry of [0, h]) {
      const ring = new THREE.Mesh(cylGeo(r + 0.06, r + 0.06, 0.12, 18), this.mats.metal);
      ring.position.y = -h / 2 + ry;
      glass.add(ring);
    }
    const cap = new THREE.Mesh(cylGeo(r * 0.7, r, 0.3, 18), this.mats.metalDark);
    cap.position.y = h / 2 + 0.15;
    glass.add(cap);
    // Specimen suspended inside.
    const spec = new THREE.Mesh(cylGeo(0.3, 0.22, 1.1, 8), this.mats.specimen);
    spec.position.y = -0.1;
    glass.add(spec);
    const head = new THREE.Mesh(sphereGeo(0.26, 10, 8), this.mats.specimen);
    head.position.y = 0.55;
    glass.add(head);
    for (const s of [-0.5, 0.5]) {
      const cable = new THREE.Mesh(boxGeo(0.06, 0.5, 0.06), this.mats.rubber);
      cable.position.set(s * 0.3, -h / 2 + 0.2, r + 0.05);
      glass.add(cable);
    }
    if (o.light !== false) {
      const light = new THREE.PointLight(0x54ff8a, 0.9, 9, 2);
            light.userData.flicker = true;
      light.position.set(x, 1.6, z);
      this.scene.add(light);
      this.host._track(light);
    }
    return glass;
  }

  /** Reactor core — tall glowing cylinder with connectors. */
  reactorCore(x, z, o = {}) {
    const r = o.r || 1.5;
    const h = o.h || 3.0;
    this.box(this.mats.metalDark, r * 2.6, 0.3, r * 2.6, x, 0.15, z, { physics: true });
    const core = this.cyl(this.mats.metalDark, r, r, h, x, 0.3 + h / 2, z, { physics: true, seg: 20 });
    const glowMat = o.glowMat || this.mats.accent;
    const glow = new THREE.Mesh(cylGeo(r * 0.94, r * 0.94, h * 0.92, 20), glowMat);
    glow.castShadow = false;
    core.add(glow);
    const ring = new THREE.Mesh(cylGeo(r + 0.2, r + 0.2, 0.18, 20), this.mats.metal);
    ring.position.y = h / 2 - 0.1;
    core.add(ring);
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i + Math.PI / 4;
      const pipe = new THREE.Mesh(boxGeo(0.16, 0.16, r * 1.1), this.mats.pipe);
      pipe.position.set(Math.cos(a) * r, h / 2 - 0.5, Math.sin(a) * r);
      pipe.rotation.y = -a;
      core.add(pipe);
    }
    if (o.light !== false) {
      const light = new THREE.PointLight(this.mats.colors.accent, 1.2, 14, 2);
            light.userData.flicker = true;
      light.position.set(x, 2.2, z);
      this.scene.add(light);
      this.host._track(light);
    }
    return core;
  }

  /**
   * Containment shield ring — a circle of angled concrete shield blocks
   * around the reactor core (the biological shield), with alternating
   * hazard bands and amber position beacons. Decor only: the railing pen
   * already keeps the player out, so no colliders.
   */
  reactorContainmentRing(x, z, o = {}) {
    const r = o.r || 3.0;
    const count = o.count || 13;
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2) * (i / count);
      const seg = this.box(this.mats.concrete, 1.42, 1.1, 0.3,
        x + Math.cos(a) * r, 0.55, z + Math.sin(a) * r,
        { rotY: -a - Math.PI / 2 });
      // Chamfer cap, alternating hazard band, beacons on a few blocks.
      this._child(seg, this.mats.metalDark, 1.42, 0.07, 0.36, 0, 0.585, 0);
      if (i % 2 === 0) {
        this._child(seg, this.mats.hazard, 1.42, 0.15, 0.36, 0, -0.26, 0);
      }
      if (i % 5 === 2) {
        this._child(seg, this.mats.beaconAmber, 0.11, 0.11, 0.11, 0, 0.63, 0);
      }
    }
  }

  /**
   * Turbine housing — a horizontal rotor casing on a concrete plinth with
   * bearing pedestals, a coupling half and gland pipework off the top.
   * axis 'x' or 'z' sets the shaft direction; the plinth is the collider.
   */
  turbineHousing(x, z, axis, o = {}) {
    const alongX = axis !== 'z';
    const len = o.len || 2.9;
    const r = o.r || 0.55;
    const pw = alongX ? len + 0.5 : 1.3;
    const pd = alongX ? 1.3 : len + 0.5;
    const plinth = this.box(this.mats.concrete, pw, 0.35, pd, x, 0.175, z,
      { physics: true });
    // Bearing pedestals carry the casing above the plinth.
    for (const s of [-1, 1]) {
      this._child(plinth, this.mats.metalDark, alongX ? 0.36 : 0.8, 0.5,
        alongX ? 0.8 : 0.36,
        alongX ? s * (len / 2 - 0.4) : 0, 0.425,
        alongX ? 0 : s * (len / 2 - 0.4));
    }
    const casing = new THREE.Mesh(cylGeo(r, r, len, 16), this.mats.panel);
    casing.position.set(0, 1.05, 0);
    if (alongX) casing.rotation.z = Math.PI / 2;
    else casing.rotation.x = Math.PI / 2;
    casing.castShadow = true;
    plinth.add(casing);
    // Coupling half at one shaft end + gland stubs off the casing top.
    const coupling = new THREE.Mesh(cylGeo(r + 0.1, r + 0.1, 0.22, 16),
      this.mats.metalDark);
    coupling.position.set(alongX ? len / 2 + 0.11 : 0, 1.05,
      alongX ? 0 : len / 2 + 0.11);
    if (alongX) coupling.rotation.z = Math.PI / 2;
    else coupling.rotation.x = Math.PI / 2;
    coupling.castShadow = true;
    plinth.add(coupling);
    for (const s of [-1, 1]) {
      const gland = new THREE.Mesh(cylGeo(0.07, 0.07, 0.45, 8), this.mats.pipe);
      gland.position.set(alongX ? s * 0.5 : 0, 1.68, alongX ? 0 : s * 0.5);
      gland.castShadow = true;
      plinth.add(gland);
    }
    // Hazard band around the plinth base.
    this._child(plinth, this.mats.hazard, pw + 0.02, 0.14, pd + 0.02, 0, -0.11, 0);
    return plinth;
  }

  /**
   * Annunciator board — a grid of amber indicator tiles on a metal
   * backplate (control-room alarm fascia). The lit pattern is
   * deterministic so the level rebuilds identically.
   */
  annunciatorBoard(x, y, z, face, o = {}) {
    const cols = o.cols || 8;
    const rows = o.rows || 4;
    const board = this.box(this.mats.metalDark,
      cols * 0.16 + 0.12, rows * 0.16 + 0.12, 0.07, x, y, z,
      { rotY: this.faceAngle(face), cast: false });
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = ((r * 5 + c * 3 + ((r * c) % 4)) % 9) < 3;
        this._child(board, lit ? this.mats.beaconAmber : this.mats.panel,
          0.13, 0.13, 0.02,
          (c - (cols - 1) / 2) * 0.16, ((rows - 1) / 2 - r) * 0.16, 0.045);
      }
    }
    return board;
  }

  /**
   * Security weapons locker — an open wall cabinet with the pulse sidearm on
   * the rack. Level 2's gun pickup: Game.js hides the returned gun group and
   * dims the rack light when the player takes the weapon. The cabinet box is
   * the collider; interior details and the sidearm are visual children.
   */
  weaponsLocker(x, y, z, face, o = {}) {
    const rotY = this.faceAngle(face);
    const cabinet = this.box(this.mats.metalDark, 0.95, 1.15, 0.34, x, y, z,
      { physics: true, rotY });
    // Recessed dark interior, rack shelf, hazard foot stripe.
    this._child(cabinet, this.mats.rubber, 0.78, 0.95, 0.06, 0, 0, 0.15);
    this._child(cabinet, this.mats.metal, 0.82, 0.04, 0.22, 0, -0.28, 0.12);
    this._child(cabinet, this.mats.hazard, 0.95, 0.09, 0.02, 0, -0.53, 0.18);
    // Door swung open flat against the adjoining wall.
    this._child(cabinet, this.mats.metal, 0.44, 1.05, 0.04, 0.6, 0, 0.24, 0, -1.2);
    // The sidearm — pulse rifle silhouette propped on the rack.
    const gun = new THREE.Group();
    const part = (geo, mat, px, py, pz) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      gun.add(mesh);
      return mesh;
    };
    part(boxGeo(0.46, 0.09, 0.07), this.mats.metal, 0, 0, 0);            // receiver
    const barrel = part(cylGeo(0.026, 0.026, 0.3, 8), this.mats.metalDark, 0.36, 0.01, 0);
    barrel.rotation.z = Math.PI / 2;
    part(boxGeo(0.14, 0.12, 0.05), this.mats.metalDark, -0.27, -0.03, 0); // stock
    const grip = part(boxGeo(0.05, 0.12, 0.05), this.mats.rubber, -0.1, -0.1, 0);
    grip.rotation.x = 0.35;
    part(boxGeo(0.09, 0.05, 0.075), this.mats.accent, 0.03, 0.07, 0);     // energy cell
    gun.position.set(-0.05, -0.21, 0.09);
    gun.rotation.y = 0.06;
    cabinet.add(gun);
    // Rack light — dimmed on pickup (never visibility-toggled: recompile).
    const light = new THREE.PointLight(0x5cff8a, 0.55, 2.4, 1.8);
    light.position.set(0, 0.25, 0.42);
    cabinet.add(light);
    return { cabinet, gun, light };
  }

  /** Power generator — vents, pipes, warning label. */
  generator(x, z, face, o = {}) {
    const rotY = this.faceAngle(face);
    const main = this.box(this.mats.panel, 1.4, 1.6, 0.9, x, 0.8, z, { physics: true, occluder: true, rotY });
    this._child(main, this.mats.grate, 0.9, 0.7, 0.04, 0, 0.15, 0.46);
    this._child(main, this.mats.beaconAmber, 0.5, 0.18, 0.03, 0, -0.55, 0.46);
    this._child(main, this.mats.pipe, 0.12, 0.5, 0.12, -0.5, 0.9, 0);
    this._child(main, this.mats.pipe, 0.12, 0.5, 0.12, 0.5, 0.9, 0);
    return main;
  }

  // ── Reactor-plant equipment ────────────────────────────────────────────────

  /**
   * Coolant pump skid — motor with cooling ribs, volute and a rising
   * discharge pipe. The frame box is the collider; the cylinders are
   * visual children on top of it.
   */
  coolantPump(x, z, face, o = {}) {
    const rotY = this.faceAngle(face);
    const frame = this.box(this.mats.metalDark, 1.7, 0.5, 1.05, x, 0.25, z,
      { physics: true, rotY });
    // Motor — horizontal cylinder with cooling ribs.
    const motor = new THREE.Mesh(cylGeo(0.27, 0.27, 0.85, 12), this.mats.metal);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(-0.22, 0.5, 0);
    motor.castShadow = true;
    frame.add(motor);
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(cylGeo(0.29, 0.29, 0.05, 12), this.mats.metalDark);
      rib.rotation.z = Math.PI / 2;
      rib.position.set(-0.52 + i * 0.2, 0.5, 0);
      frame.add(rib);
    }
    // Volute + rising discharge pipe with an elbow stub.
    const volute = new THREE.Mesh(cylGeo(0.33, 0.33, 0.42, 14), this.mats.metal);
    volute.position.set(0.5, 0.6, 0);
    volute.castShadow = true;
    frame.add(volute);
    const discharge = new THREE.Mesh(cylGeo(0.08, 0.08, 0.7, 8), this.mats.pipe);
    discharge.position.set(0.5, 1.3, 0);
    discharge.castShadow = true;
    frame.add(discharge);
    const elbow = new THREE.Mesh(cylGeo(0.08, 0.08, 0.45, 8), this.mats.pipe);
    elbow.rotation.z = Math.PI / 2;
    elbow.position.set(0.72, 1.6, 0);
    frame.add(elbow);
    // Suction stub down toward the floor.
    const suction = new THREE.Mesh(cylGeo(0.11, 0.11, 0.5, 8), this.mats.pipe);
    suction.position.set(0.5, 0.07, 0);
    frame.add(suction);
    // Gauge on a stand at the frame corner + running beacon.
    this._child(frame, this.mats.metal, 0.05, 0.3, 0.05, -0.72, 0.62, 0);
    const gauge = new THREE.Mesh(cylGeo(0.08, 0.08, 0.05, 10), this.mats.metalDark);
    gauge.rotation.x = Math.PI / 2;
    gauge.position.set(-0.72, 0.82, 0);
    frame.add(gauge);
    this._child(frame, this.mats.beaconAmber, 0.08, 0.08, 0.08, 0.5, 1.7, 0);
    // Hazard band on the frame front.
    this._child(frame, this.mats.hazard, 1.5, 0.14, 0.03, 0, -0.1, 0.535);
    return frame;
  }

  /**
   * Horizontal steam generator on concrete cradles. The vessel mesh itself
   * is the LOS occluder; a hidden box inside it provides the collider.
   * @param {string} axis vessel long axis, 'x' or 'z'
   */
  steamGenerator(x, z, axis, o = {}) {
    const alongX = axis !== 'z';
    const len = o.len || 3.2;
    const r = o.r || 0.7;
    const y = 1.25 + r; // cradle top → vessel centre
    // Cradle pedestals (with colliders).
    for (const s of [-1, 1]) {
      const px = alongX ? x + s * 1.0 : x;
      const pz = alongX ? z : z + s * 1.0;
      this.box(this.mats.concrete, alongX ? 0.7 : 1.5, 1.25, alongX ? 1.5 : 0.7,
        px, 0.625, pz, { physics: true });
    }
    // Pressure vessel.
    const vessel = new THREE.Mesh(cylGeo(r, r, len, 18), this.mats.metal);
    vessel.position.set(x, y, z);
    if (alongX) vessel.rotation.z = Math.PI / 2;
    else vessel.rotation.x = Math.PI / 2;
    vessel.castShadow = true;
    vessel.receiveShadow = true;
    vessel.userData.kitShared = true;
    this.scene.add(vessel);
    this.host._track(vessel);
    if (o.occluder !== false) this.host.occluders.push(vessel);
    // Hidden collider core inside the vessel (physics only — never visible).
    this.box(this.mats.metalDark,
      alongX ? len - 0.6 : 0.9, 0.9, alongX ? 0.9 : len - 0.6,
      x, y, z, { physics: true, cast: false, receive: false });
    // Manway on the +axis end cap.
    const mw = new THREE.Mesh(cylGeo(r * 0.42, r * 0.42, 0.1, 14), this.mats.metalDark);
    mw.position.set(alongX ? x + len / 2 : x, y, alongX ? z : z + len / 2);
    if (alongX) mw.rotation.z = Math.PI / 2;
    else mw.rotation.x = Math.PI / 2;
    mw.castShadow = true;
    this.scene.add(mw);
    this.host._track(mw);
    // Flange rings around the vessel.
    for (const s of [-1, 1]) {
      const flange = new THREE.Mesh(cylGeo(r + 0.05, r + 0.05, 0.14, 18), this.mats.metalDark);
      flange.position.set(alongX ? x + s * 0.95 : x, y, alongX ? z : z + s * 0.95);
      if (alongX) flange.rotation.z = Math.PI / 2;
      else flange.rotation.x = Math.PI / 2;
      this.scene.add(flange);
      this.host._track(flange);
    }
    // Relief pipes standing on the top flank.
    for (const s of [-0.7, 0.25]) {
      const px = alongX ? x + s : x;
      const pz = alongX ? z : z + s;
      const pipe = new THREE.Mesh(cylGeo(0.08, 0.08, 0.55, 8), this.mats.pipe);
      pipe.position.set(px, y + r + 0.18, pz);
      pipe.castShadow = true;
      this.scene.add(pipe);
      this.host._track(pipe);
      const cap = new THREE.Mesh(cylGeo(0.11, 0.11, 0.06, 8), this.mats.metalDark);
      cap.position.set(px, y + r + 0.48, pz);
      this.scene.add(cap);
      this.host._track(cap);
    }
    return vessel;
  }

  /**
   * Vertical coolant tank — banded shell, domed cap, ladder cage and a
   * glowing sight glass on the +z side (face that toward walkable space).
   */
  coolantTank(x, z, o = {}) {
    const r = o.r || 0.65;
    const h = o.h || 2.4;
    // Concrete plinth (visual only — the tank body is the collider).
    this.cyl(this.mats.concrete, r + 0.12, r + 0.14, 0.22, x, 0.11, z, { cast: false, seg: 16 });
    const tank = this.cyl(this.mats.metal, r, r, h, x, 0.22 + h / 2, z,
      { physics: true, seg: 16, occluder: o.occluder !== false });
    // Domed cap + vent stub.
    const cap = new THREE.Mesh(cylGeo(r * 0.55, r, 0.2, 16), this.mats.metalDark);
    cap.position.y = h / 2 + 0.1;
    tank.add(cap);
    const vent = new THREE.Mesh(cylGeo(0.05, 0.05, 0.3, 8), this.mats.pipe);
    vent.position.y = h / 2 + 0.32;
    tank.add(vent);
    // Shell bands.
    for (const by of [-0.45, 0.1, 0.65]) {
      const band = new THREE.Mesh(cylGeo(r + 0.03, r + 0.03, 0.1, 16), this.mats.metalDark);
      band.position.y = by;
      tank.add(band);
    }
    // Sight glass — glowing level gauge on the front.
    const glass = new THREE.Mesh(boxGeo(0.09, h * 0.75, 0.05), this.mats.accent);
    glass.position.set(0, 0, r + 0.04);
    tank.add(glass);
    // Ladder cage on the +z side: rails + rungs.
    for (const s of [-1, 1]) {
      this._child(tank, this.mats.metal, 0.05, h + 0.15, 0.05, s * 0.19, h / 2, r + 0.16);
    }
    for (let i = 0; i < 6; i++) {
      this._child(tank, this.mats.metal, 0.42, 0.035, 0.035,
        0, -h * 0.35 + i * (h * 0.7 / 5), r + 0.16);
    }
    // Hazard plate near the base.
    this._child(tank, this.mats.hazard, r * 1.9, 0.16, 0.03, 0, -h / 2 + 0.28, r + 0.03);
    return tank;
  }

  /** Wall-mounted bank of pressure gauges (decor only, no collision). */
  gaugeCluster(x, y, z, face, o = {}) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = this.faceAngle(face);
    const panel = new THREE.Mesh(boxGeo(0.9, 0.55, 0.08), this.mats.metalDark);
    panel.receiveShadow = true;
    g.add(panel);
    for (let i = 0; i < 3; i++) {
      const gx = -0.28 + i * 0.28;
      const dial = new THREE.Mesh(cylGeo(0.09, 0.09, 0.06, 12), this.mats.metal);
      dial.rotation.x = Math.PI / 2;
      dial.position.set(gx, 0.06, 0.06);
      g.add(dial);
      const needle = new THREE.Mesh(boxGeo(0.015, 0.07, 0.02), this.mats.accent);
      needle.position.set(gx, 0.08, 0.1);
      needle.rotation.z = (i - 1) * 0.7; // varied readings
      g.add(needle);
    }
    const placard = new THREE.Mesh(boxGeo(0.5, 0.14, 0.02), this.mats.beaconAmber);
    placard.position.set(0, -0.2, 0.05);
    g.add(placard);
    this.scene.add(g);
    this.host._track(g);
    return g;
  }

  /**
   * Control-rod drive bank — the actuator columns that sit beside a reactor
   * core and shove the rods in and out.
   */
  controlRodDrives(x, z, o = {}) {
    const base = this.box(this.mats.metalDark, 1.15, 0.35, 1.15, x, 0.175, z, { physics: true });
    for (let i = 0; i < 4; i++) {
      const dx = -0.36 + (i % 2) * 0.72;
      const dz = -0.36 + Math.floor(i / 2) * 0.72;
      // Local y 0.85 → world 0.35..1.7: flush on the base, tops at 1.7.
      const drive = new THREE.Mesh(cylGeo(0.11, 0.11, 1.35, 10), this.mats.metal);
      drive.position.set(dx, 0.85, dz);
      drive.castShadow = true;
      base.add(drive);
      const cap = new THREE.Mesh(cylGeo(0.14, 0.14, 0.14, 10), this.mats.metalDark);
      cap.position.set(dx, 1.595, dz); // world ~1.77, atop the drive
      base.add(cap);
    }
    // Crossbeam resting on the caps + status light on the beam.
    this._child(base, this.mats.beam, 1.15, 0.1, 0.16, 0, 1.715, 0);
    this._child(base, this.mats.accent, 0.09, 0.09, 0.09, 0, 1.81, 0);
    return base;
  }

  /**
   * Spent-fuel storage rack — two rows of glowing rod bundles in a frame
   * behind a safety grille. The base is the collider; the separate back
   * panel (full height) is the LOS occluder, so hiding behind the rack
   * genuinely breaks the monster's line of sight.
   */
  fuelRack(x, z, face, o = {}) {
    const rotY = this.faceAngle(face);
    const base = this.box(this.mats.metalDark, 1.7, 0.55, 0.62, x, 0.275, z, { physics: true, rotY });
    // Fuel rods rising from the base (glowing — specimen material).
    const rodGeo = cylGeo(0.05, 0.05, 1.3, 8);
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 5; i++) {
        const rod = new THREE.Mesh(rodGeo, this.mats.specimen);
        rod.position.set(-0.62 + i * 0.31, 0.925, 0.1 - row * 0.22);
        base.add(rod);
      }
    }
    // Safety grille bars in front of the rods.
    for (let i = 0; i < 5; i++) {
      this._child(base, this.mats.metal, 0.05, 1.25, 0.04, -0.7 + i * 0.35, 0.925, 0.26);
    }
    // Side posts + top frame + header placard.
    this._child(base, this.mats.metal, 0.07, 1.35, 0.6, -0.815, 0.9, 0);
    this._child(base, this.mats.metal, 0.07, 1.35, 0.6, 0.815, 0.9, 0);
    this._child(base, this.mats.metalDark, 1.74, 0.1, 0.66, 0, 1.62, 0);
    this._child(base, this.mats.beaconAmber, 1.1, 0.16, 0.03, 0, 1.38, 0.34);
    // Back panel — full-height occluder behind the rods.
    const bx = x - Math.sin(rotY) * 0.26;
    const bz = z - Math.cos(rotY) * 0.26;
    this.box(this.mats.panel, 1.7, 1.45, 0.05, bx, 1.18, bz,
      { rotY, occluder: true, cast: false });
    return base;
  }

  /**
   * Overhead crane rail — twin beams, cross girders and a parked trolley
   * with hook and chain. No collision (it hangs above head height).
   */
  craneRail(axis, length, x, y, z, o = {}) {
    const spread = o.spread || 1.4;
    for (const s of [-1, 1]) {
      if (axis === 'x') {
        this.box(this.mats.beam, length, 0.18, 0.14, x, y, z + s * spread / 2, { cast: false });
      } else {
        this.box(this.mats.beam, 0.14, 0.18, length, x + s * spread / 2, y, z, { cast: false });
      }
    }
    const n = Math.max(2, Math.round(length / 4));
    for (let i = 0; i <= n; i++) {
      const t = -length / 2 + (length / n) * i;
      if (axis === 'x') this.box(this.mats.beam, 0.16, 0.12, spread + 0.2, x + t, y + 0.14, z, { cast: false });
      else this.box(this.mats.beam, spread + 0.2, 0.12, 0.16, x, y + 0.14, z + t, { cast: false });
    }
    // Trolley + hoist chain + hook (parked at `o.trolley` offset along the run).
    const off = o.trolley !== undefined ? o.trolley : length * 0.18;
    const tx = axis === 'x' ? x + off : x;
    const tz = axis === 'x' ? z : z + off;
    this.box(this.mats.metalDark, axis === 'x' ? 0.9 : 0.6, 0.22, axis === 'x' ? 0.6 : 0.9,
      tx, y - 0.2, tz, { cast: false });
    this.cyl(this.mats.metalDark, 0.02, 0.02, 0.8, tx, y - 0.72, tz, { cast: false, seg: 6 });
    this.box(this.mats.metal, 0.1, 0.16, 0.1, tx, y - 1.16, tz, { cast: false });
    return null;
  }

  /** Free-standing radiation monitor — pole, detector head, display. */
  radiationMonitor(x, z, o = {}) {
    const pole = this.box(this.mats.metal, 0.1, 1.5, 0.1, x, 0.75, z, { physics: true });
    this._child(pole, this.mats.metalDark, 0.34, 0.26, 0.2, 0, 0.82, 0);  // detector head
    this._child(pole, this.mats.screen, 0.2, 0.14, 0.02, 0, 0.82, 0.11);  // display
    this._child(pole, this.mats.beaconAmber, 0.08, 0.08, 0.06, 0.14, 0.82, 0.1);
    this._child(pole, this.mats.metalDark, 0.3, 0.05, 0.3, 0, -0.72, 0);  // base plate
    return pole;
  }


  /** Wall-mounted fuse box (no collision — decor only). */
  fuseBox(x, y, z, face, o = {}) {
    const rotY = this.faceAngle(face);
    const main = this.box(this.mats.metalDark, 0.45, 0.6, 0.16, x, y, z, { rotY, cast: false });
    this._child(main, this.mats.metal, 0.38, 0.5, 0.02, 0, 0, 0.09);
    this._child(main, this.mats.accent, 0.06, 0.06, 0.02, 0.12, 0.18, 0.11);
    this._child(main, this.mats.rubber, 0.05, 0.6, 0.05, -0.16, -0.55, 0.03);
    return main;
  }

  /** Fire extinguisher on a wall bracket. */
  extinguisher(x, y, z, o = {}) {
    const main = this.box(this.mats.emergencyRed, 0.16, 0.5, 0.16, x, y, z, { cast: false });
    this._child(main, this.mats.metalDark, 0.2, 0.06, 0.1, 0, 0.1, -0.06);
    return main;
  }

  /** Cluster of rubble/debris chunks with a single collider. */
  debrisPile(x, z, o = {}) {
    const s = o.s || 1.0;
    const rand = mulberry32(o.seed || 7);
    const main = this.box(this.mats.debris, s * 1.4, s * 0.5, s, x, s * 0.25, z, { physics: true });
    main.rotation.y = (rand() - 0.5) * 0.6;
    const chunks = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < chunks; i++) {
      const c = new THREE.Mesh(
        rand() > 0.6 ? cylGeo(s * 0.12, s * 0.14, s * 0.4, 7) : boxGeo(s * 0.28, s * 0.22, s * 0.3),
        rand() > 0.5 ? this.mats.debris : this.mats.concrete
      );
      c.position.set((rand() - 0.5) * s * 1.6, s * 0.12 + rand() * s * 0.2, (rand() - 0.5) * s * 1.2);
      c.rotation.set(rand() * 0.5, rand() * Math.PI, rand() * 0.4);
      c.castShadow = false;
      c.receiveShadow = true;
      main.add(c);
    }
    return main;
  }

  /** Wall sign (canvas-text). No collision. */
  sign(x, y, z, face, text, o = {}) {
    const w = o.w || 1.3;
    const h = o.h || 0.5;
    const rotY = this.faceAngle(face);
    const frame = this.box(this.mats.metalDark, w + 0.08, h + 0.08, 0.05, x, y, z, { rotY, cast: false });
    const mat = signMaterial(text, {
      fg: o.fg || '#7fe7ff', sub: o.sub || '',
      bg: o.bg || 'rgba(8,12,18,0.94)',
      w: 256, h: Math.round(256 * h / w),
    });
    const face2 = new THREE.Mesh(planeGeo(w, h), mat);
    face2.position.set(0, 0, 0.035);
    frame.add(face2);
    return frame;
  }

  /** Flat floor decal (stripes, arrows, dashes). */
  floorDecal(x, z, kind, o = {}) {
    const size = o.size || 1.0;
    const m = this.plane(decalMaterial(kind, o.color || '#e8b23a'), size, size, x, 0.012, z, {
      rx: -Math.PI / 2, rz: o.rotZ || 0,
    });
    return m;
  }

  /** Glowing floor guide line along 'x' or 'z'. */
  floorLine(x, z, len, o = {}) {
    const mat = o.color === 'exit' ? this.mats.exitGreen
      : o.color === 'warn' ? this.mats.beaconAmber
        : o.color === 'emer' ? this.mats.emergencyRed : this.mats.accent;
    if (o.axis === 'x') return this.box(mat, len, 0.012, 0.07, x, 0.012, z, { cast: false });
    return this.box(mat, 0.07, 0.012, len, x, 0.012, z, { cast: false });
  }

  /** Give any prop the four cardinal orientations: n/s/e/w = front direction. */
  faceAngle(face) {
    switch (face) {
      case 'n': return Math.PI;
      case 'e': return Math.PI / 2;
      case 'w': return -Math.PI / 2;
      default: return 0; // 's'
    }
  }
}
