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
    this.scene.add(mesh);
    this.host._track(mesh);

    if (o.physics) {
      const quarter = Math.abs(Math.abs(o.rotY || 0) - Math.PI / 2) < 0.01;
      const hw = o.w !== undefined ? o.w / 2 : 0.5;
      const hh = o.h !== undefined ? o.h / 2 : 0.5;
      const hd = o.d !== undefined ? o.d / 2 : 0.5;
      const body = this.physics.createBox(
        0,
        quarter ? hd : hw,
        hh,
        quarter ? hw : hd,
        new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z)
      );
      this.physics.addSyncPair(body, mesh);
    }
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
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), this.mats.specimen);
    head.position.y = 0.55;
    glass.add(head);
    for (const s of [-0.5, 0.5]) {
      const cable = new THREE.Mesh(boxGeo(0.06, 0.5, 0.06), this.mats.rubber);
      cable.position.set(s * 0.3, -h / 2 + 0.2, r + 0.05);
      glass.add(cable);
    }
    if (o.light !== false) {
      const light = new THREE.PointLight(0x54ff8a, 0.9, 9, 2);
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
      light.position.set(x, 2.2, z);
      this.scene.add(light);
      this.host._track(light);
    }
    return core;
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
