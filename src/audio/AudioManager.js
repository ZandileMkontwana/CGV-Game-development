/**
 * AudioManager — procedural horror soundscape built entirely with the Web
 * Audio API. Every sound is synthesised at runtime: no audio files to ship,
 * download, or case-match on the LAMP server, and fear can be modulated in
 * real time (heartbeat speed, growl proximity, ambience ducking).
 *
 * Event interface (called from Game.js — keep names stable so Person D can
 * later swap individual voices for recorded samples):
 *   play('pulseShot' | 'pulseHit' | 'pulseMiss' | 'doorOpen' | 'ventHiss' |
 *        'spark' | 'growl' | 'roar' | 'spotted' | 'attack' | 'transform' |
 *        'death' | 'alarm' | 'beep' | 'creak' | 'clang' | 'collapse' |
 *        'win' | 'gameover', opt?)
 *   setLevel(n)            switch the ambient bed (1 calm lab, 2 dark hunt,
 *                          3 alarm/collapse)
 *   update(dt, moving, sprinting, grounded, threat, chasing, monsterActive,
 *          health01)        per-frame schedulers: footsteps, heartbeat,
 *                          patrol growls, distant stingers
 *   duck(amount)           momentarily pull the ambience down for stingers
 *   stopAmbient() / stopRumble()
 *   toggleMute()           M key; shows the [ MUTED ] HUD indicator
 *
 * No per-frame allocations: update() only mutates counters and reads input.
 */

const MIN_GAIN = 0.0001;

export default class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._unlocked = false; // AudioContext may only start on a user gesture
    this._level = 1;
    this._noise = null;
    this._dist = null;      // cached waveshaper curve

    this._bed = null;       // { gain, filter, nodes[], base }
    this._rumble = null;    // { src, lfo, g } collapse loop
    this._duckTO = 0;

    // Per-frame schedulers (seconds until next event).
    this._stepTimer = 0;
    this._beatTimer = 0;
    this._growlTimer = 6;
    this._stingTimer = 10;

    // Unlock the AudioContext on the first user gesture (browser autoplay
    // policy): the Start-click or any key press is enough.
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) this.toggleMute();
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Create the context + master chain. Safe to call repeatedly. */
  unlock() {
    if (this._unlocked) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.24;
    comp.connect(this.ctx.destination);

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.65;
    this.master.connect(comp);

    // Shared 2 s white-noise buffer — every noise voice reuses it.
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noise = buf;

    if (this.ctx.state === 'suspended') this.ctx.resume();
    this._unlocked = true;
    this._startBed(this._level);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.65, t, 0.05);
    }
    const el = document.getElementById('mute-indicator');
    if (el) el.classList.toggle('visible', this.muted);
  }

  // ── One-shot dispatch ────────────────────────────────────────────────────

  /**
   * Trigger a named sound.
   * @param {string} name
   * @param {*} [opt] voice-specific option (e.g. growl proximity 0..1,
   *                  beep urgent flag)
   */
  play(name, opt) {
    if (!this._unlocked || this.muted) return;
    switch (name) {
      case 'pulseShot': this._pulseShot(); break;
      case 'pulseHit': this._spark(); this._chirp(2400, 1700, 0.07, 0.14); break;
      case 'pulseMiss': this._whoosh(); break;
      case 'spark': this._spark(); break;
      case 'doorOpen': this._door(); break;
      case 'ventHiss': this._hiss(1.0, 0.3); break;
      case 'growl': this._growl(opt === undefined ? 0.4 : opt); break;
      case 'roar': this._roar(); break;
      case 'spotted': this._sting(); break;
      case 'attack': this._impact(); break;
      case 'transform': this._transform(); break;
      case 'death': this._death(); break;
      case 'alarm': this._alarm(); break;
      case 'beep': this._beep(opt === true); break;
      case 'creak': this._creak(); break;
      case 'clang': this._clang(); break;
      case 'collapse': this._startRumble(); break;
      case 'win': this._win(); break;
      case 'gameover': this._gameOver(); break;
    }
  }

  // ── Per-frame schedulers ─────────────────────────────────────────────────

  /**
   * Drive footsteps, the tension heartbeat, patrol growls and distant
   * facility creaks. Zero allocation — counters only.
   */
  update(dt, moving, sprinting, grounded, threat, chasing, monsterActive, health01) {
    if (!this._unlocked || this.muted) return;

    // Footsteps — cadence from walk/sprint, only while grounded.
    if (moving && grounded) {
      this._stepTimer -= dt;
      if (this._stepTimer <= 0) {
        this._step(sprinting);
        this._stepTimer = sprinting ? 0.30 : 0.46;
      }
    } else {
      this._stepTimer = 0;
    }

    // Heartbeat: rises with monster proximity, the chase, and low health.
    let tension = threat;
    const hurt = (1 - (health01 === undefined ? 1 : health01)) * 0.95;
    if (hurt > tension) tension = hurt;
    if (chasing && tension < 0.55) tension = 0.55;
    if (tension > 0.12) {
      this._beatTimer -= dt;
      if (this._beatTimer <= 0) {
        const k = tension > 1 ? 1 : tension;
        this._thump(0.16 + 0.4 * k);
        this._beatTimer = 1.15 - 0.72 * k;
      }
    } else {
      this._beatTimer = 0.4;
    }

    // Occasional hunting growl while the creature stalks the corridors.
    if (monsterActive && !chasing) {
      this._growlTimer -= dt;
      if (this._growlTimer <= 0) {
        const k = threat > 1 ? 1 : threat;
        this._growl(0.15 + 0.45 * k);
        this._growlTimer = 7 + Math.random() * 9;
      }
    } else if (chasing) {
      this._growlTimer = 4;
    }

    // Distant facility noises — the building itself never feels safe.
    this._stingTimer -= dt;
    if (this._stingTimer <= 0) {
      if (Math.random() < 0.5) this._creak(); else this._clang();
      this._stingTimer = 13 + Math.random() * 15;
    }
  }

  // ── Ambient bed ──────────────────────────────────────────────────────────

  setLevel(n) {
    const changed = n !== this._level || !this._bed;
    this._level = n;
    if (this._unlocked && changed) this._startBed(n);
  }

  stopAmbient() { this._stopBed(1.2); }

  /** Momentarily pull the ambience down so stingers cut through. */
  duck(amount) {
    if (!this._bed || !this._unlocked) return;
    const g = this._bed.gain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this._bed.base * (1 - amount), t, 0.12);
    clearTimeout(this._duckTO);
    this._duckTO = setTimeout(() => {
      if (!this._bed) return;
      this._bed.gain.gain.setTargetAtTime(this._bed.base, this.ctx.currentTime, 0.5);
    }, 1100);
  }

  _startBed(level) {
    if (!this._unlocked) return;
    this._stopBed(1.2);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const filter = this._filter('lowpass', level === 2 ? 220 : level === 3 ? 260 : 380, 0.6);
    const gain = this._gain(MIN_GAIN);
    filter.connect(gain).connect(this.master);
    const bed = { gain, filter, nodes: [], base: 0.42 };

    const addOsc = (type, freq, vol, detune) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      if (detune) o.detune.value = detune;
      const g = this._gain(vol);
      o.connect(g).connect(filter);
      o.start(t);
      bed.nodes.push(o);
    };

    if (level === 1) {
      // Clean lab: steady machinery hum with a faint uneasy beating.
      addOsc('sine', 82, 0.5, -4);
      addOsc('sine', 82.7, 0.5, 4);
      addOsc('triangle', 164, 0.1, 0);
      addOsc('sawtooth', 120, 0.03, 6);
    } else if (level === 2) {
      // Damaged corridors: deeper drone + slowly moving air.
      addOsc('sine', 55, 0.5, -3);
      addOsc('sine', 55.8, 0.5, 3);
      addOsc('triangle', 110, 0.12, 0);
      const src = this._noiseSource(true);
      const bp = this._filter('bandpass', 300, 0.6);
      const ng = this._gain(0.06);
      src.connect(bp).connect(ng).connect(filter);
      src.start(t);
      bed.nodes.push(src);
      const wl = ctx.createOscillator();
      wl.frequency.value = 0.05;
      const wlg = this._gain(90);
      wl.connect(wlg).connect(bp.frequency);
      wl.start(t);
      bed.nodes.push(wl);
    } else {
      // Collapse: dissonant beat + a distant warning pulse.
      addOsc('sine', 65, 0.45, -5);
      addOsc('sine', 64.2, 0.45, 5);
      addOsc('triangle', 130, 0.1, 0);
      const pulse = ctx.createOscillator();
      pulse.type = 'triangle';
      pulse.frequency.value = 174;
      const pg = this._gain(0.05);
      pulse.connect(pg).connect(filter);
      const pl = ctx.createOscillator();
      pl.frequency.value = 1.4;
      const plg = this._gain(0.035);
      pl.connect(plg).connect(pg.gain);
      pulse.start(t);
      pl.start(t);
      bed.nodes.push(pulse, pl);
    }

    // Slow filter drift so the bed never sits still.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lg = this._gain(55);
    lfo.connect(lg).connect(filter.frequency);
    lfo.start(t);
    bed.nodes.push(lfo);

    gain.gain.setValueAtTime(MIN_GAIN, t);
    gain.gain.exponentialRampToValueAtTime(bed.base, t + 2.0);
    this._bed = bed;
  }

  _stopBed(fade) {
    const bed = this._bed;
    if (!bed) return;
    this._bed = null;
    const t = this.ctx.currentTime;
    const g = bed.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, MIN_GAIN), t);
    g.exponentialRampToValueAtTime(MIN_GAIN, t + fade);
    for (const n of bed.nodes) {
      try { n.stop(t + fade + 0.05); } catch (e) { /* already stopped */ }
    }
    setTimeout(() => { try { bed.gain.disconnect(); } catch (e) { /* noop */ } },
      (fade + 0.3) * 1000);
  }

  // ── Collapse rumble loop ─────────────────────────────────────────────────

  _startRumble() {
    if (!this._unlocked || this._rumble) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this._noiseSource(true);
    const f = this._filter('lowpass', 70, 0.8);
    const g = this._gain(MIN_GAIN);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.4;
    const lg = this._gain(0.35);
    lfo.connect(lg).connect(g.gain);
    src.connect(f).connect(g).connect(this.master);
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 2);
    src.start(t);
    lfo.start(t);
    this._rumble = { src, lfo, g };
  }

  stopRumble() {
    const r = this._rumble;
    if (!r) return;
    this._rumble = null;
    const t = this.ctx.currentTime;
    const g = r.g.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, MIN_GAIN), t);
    g.exponentialRampToValueAtTime(MIN_GAIN, t + 1.4);
    try { r.src.stop(t + 1.5); } catch (e) { /* already stopped */ }
    try { r.lfo.stop(t + 1.5); } catch (e) { /* already stopped */ }
  }

  // ── Low-level voice builders ─────────────────────────────────────────────

  _gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }

  _filter(type, freq, q) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  }

  _noiseSource(loop) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = loop === true;
    return src;
  }

  _distCurve() {
    if (this._dist) return this._dist;
    const n = 256;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 2.2);
    }
    this._dist = c;
    return c;
  }

  /** Pitched glide with a soft attack/decay envelope. */
  _chirp(f0, f1, dur, vol, type, when) {
    const t = when === undefined ? this.ctx.currentTime : when;
    const o = this.ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = this._gain(MIN_GAIN);
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Filtered noise burst: sparks, hisses, whooshes, footsteps. */
  _burst(o) {
    const t = this.ctx.currentTime;
    const src = this._noiseSource(false);
    const f = this._filter(o.type || 'bandpass', o.freq || 1000, o.q || 1);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 1), t + o.dur);
    const g = this._gain(MIN_GAIN);
    const attack = o.attack || 0.006;
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + attack);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + o.dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + o.dur + 0.02);
  }

  // ── Voices ───────────────────────────────────────────────────────────────

  _pulseShot() {
    this._chirp(1500, 320, 0.16, 0.45, 'sine');
    this._burst({ dur: 0.09, vol: 0.18, type: 'highpass', freq: 1400 });
  }

  _spark() {
    this._burst({ dur: 0.09, vol: 0.4, type: 'bandpass', freq: 3200 + Math.random() * 900, q: 6 });
  }

  _whoosh() {
    this._burst({ dur: 0.2, vol: 0.12, type: 'bandpass', freq: 500, q: 0.8, f1: 1800, attack: 0.04 });
  }

  _hiss(dur, vol) {
    this._burst({ dur, vol, type: 'highpass', freq: 2600, attack: 0.05 });
  }

  _door() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.55);
    const f = this._filter('lowpass', 320, 1);
    const g = this._gain(MIN_GAIN);
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.05);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + 0.6);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.65);
    this._burst({ dur: 0.6, vol: 0.12, type: 'lowpass', freq: 500, attack: 0.08 });
    this._clang(t + 0.55, 0.6); // the hydraulic clunk as it seats
  }

  /** Predator growl — pitch-wobbling saw through distortion. `prox` 0..1. */
  _growl(prox) {
    const t = this.ctx.currentTime;
    const dur = 1.1 + Math.random() * 0.5;
    const f0 = 70 + Math.random() * 25;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 1.25, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + dur * 0.7);
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(f0 * 0.5, t);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 7 + Math.random() * 4;
    const lfoG = this._gain(f0 * 0.09);
    lfo.connect(lfoG).connect(o.frequency);
    const f = this._filter('lowpass', 260, 0.8);
    const ws = this.ctx.createWaveShaper();
    ws.curve = this._distCurve();
    const g = this._gain(MIN_GAIN);
    const vol = 0.1 + prox * 0.4;
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.25);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + dur);
    o.connect(f);
    sub.connect(f);
    f.connect(ws).connect(g).connect(this.master);
    o.start(t); sub.start(t); lfo.start(t);
    const end = t + dur + 0.05;
    o.stop(end); sub.stop(end); lfo.stop(end);
  }

  _roar() {
    this._growl(0.85);
    this._burst({ dur: 1.4, vol: 0.4, type: 'bandpass', freq: 500, q: 0.7, f1: 180, attack: 0.05 });
    this._chirp(180, 60, 1.2, 0.3, 'sawtooth');
  }

  /** Sharp rising screech the moment the hunt begins. */
  _sting() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(1250, t + 0.28);
    const o2 = this.ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.setValueAtTime(628, t);
    o2.frequency.exponentialRampToValueAtTime(1875, t + 0.28);
    const f = this._filter('bandpass', 900, 1.2);
    const g = this._gain(MIN_GAIN);
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.015);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + 0.4);
    o.connect(f);
    o2.connect(f);
    f.connect(g).connect(this.master);
    o.start(t); o2.start(t);
    o.stop(t + 0.42); o2.stop(t + 0.42);
  }

  _impact() {
    this._chirp(130, 38, 0.28, 0.6, 'sine');
    this._burst({ dur: 0.16, vol: 0.45, type: 'lowpass', freq: 420 });
  }

  /** The mutation scream — pitch collapsing under a widening vibrato. */
  _transform() {
    const t = this.ctx.currentTime;
    const dur = 1.7;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(620, t);
    o.frequency.exponentialRampToValueAtTime(150, t + dur);
    const vib = this.ctx.createOscillator();
    vib.frequency.setValueAtTime(5, t);
    vib.frequency.linearRampToValueAtTime(18, t + dur);
    const vibG = this._gain(45);
    vib.connect(vibG).connect(o.frequency);
    const f = this._filter('bandpass', 900, 1.6);
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(500, t + dur);
    const ws = this.ctx.createWaveShaper();
    ws.curve = this._distCurve();
    const g = this._gain(MIN_GAIN);
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + 0.06);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + dur);
    o.connect(ws);
    ws.connect(f).connect(g).connect(this.master);
    o.start(t); vib.start(t);
    o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
    this._burst({ dur: 1.2, vol: 0.22, type: 'bandpass', freq: 700, q: 0.6, attack: 0.1 });
  }

  _death() {
    const t = this.ctx.currentTime;
    const dur = 2.2;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(48, t + dur);
    const f = this._filter('lowpass', 700, 0.9);
    f.frequency.exponentialRampToValueAtTime(150, t + dur);
    const g = this._gain(MIN_GAIN);
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.1);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + dur);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Two-tone klaxon, four cycles. */
  _alarm() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const w = t + i * 0.42;
      this._chirp(690, 690, 0.3, 0.16, 'square', w);
      this._chirp(520, 520, 0.18, 0.13, 'square', w + 0.21);
    }
  }

  _beep(urgent) {
    this._chirp(
      urgent ? 1180 : 860, urgent ? 1180 : 860,
      urgent ? 0.14 : 0.09, urgent ? 0.26 : 0.18, 'square'
    );
  }

  /** Distant metal groan. */
  _creak() {
    const t = this.ctx.currentTime;
    const dur = 1.6 + Math.random();
    const f0 = 150 + Math.random() * 120;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * (0.7 + Math.random() * 0.5), t + dur);
    const f = this._filter('bandpass', 700 + Math.random() * 500, 9);
    const g = this._gain(MIN_GAIN);
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.linearRampToValueAtTime(0.06, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(MIN_GAIN, t + dur);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Struck-pipe clang (inharmonic partials). */
  _clang(when, scale) {
    const t = when === undefined ? this.ctx.currentTime : when;
    const v = scale === undefined ? 1 : scale;
    const f0 = 180 + Math.random() * 220;
    const partials = [1, 2.41, 3.87];
    for (let i = 0; i < partials.length; i++) {
      const p = partials[i];
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f0 * p * (1 + (Math.random() - 0.5) * 0.02);
      const g = this._gain(MIN_GAIN);
      g.gain.setValueAtTime(MIN_GAIN, t);
      g.gain.exponentialRampToValueAtTime((0.14 / p) * v, t + 0.004);
      g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + 0.9 / p);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 1.2);
    }
    this._burst({ dur: 0.05, vol: 0.16 * v, type: 'highpass', freq: 2500 });
  }

  _step(sprint) {
    this._burst({
      dur: 0.1,
      vol: sprint ? 0.15 : 0.1,
      type: 'lowpass',
      freq: 240 + Math.random() * 120,
      attack: 0.004,
    });
    if (Math.random() < 0.4) {
      this._burst({ dur: 0.03, vol: 0.04, type: 'bandpass', freq: 2400 + Math.random() * 900, q: 2 });
    }
  }

  /** Double-thump heartbeat. */
  _thump(vol) {
    const t = this.ctx.currentTime;
    const times = [0, 0.16];
    const amps = [1, 0.55];
    for (let i = 0; i < 2; i++) {
      const off = times[i];
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(58, t + off);
      o.frequency.exponentialRampToValueAtTime(40, t + off + 0.12);
      const g = this._gain(MIN_GAIN);
      g.gain.setValueAtTime(MIN_GAIN, t + off);
      g.gain.exponentialRampToValueAtTime(vol * amps[i], t + off + 0.012);
      g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + off + 0.18);
      o.connect(g).connect(this.master);
      o.start(t + off);
      o.stop(t + off + 0.2);
    }
  }

  _win() {
    const t = this.ctx.currentTime;
    this._chirp(392, 392, 1.4, 0.14, 'sine', t);
    this._chirp(523.25, 523.25, 1.4, 0.12, 'sine', t + 0.18);
    this._chirp(659.25, 659.25, 1.6, 0.09, 'triangle', t + 0.36);
  }

  _gameOver() {
    this._chirp(110, 42, 1.8, 0.35, 'sawtooth');
    this._burst({ dur: 1.6, vol: 0.26, type: 'lowpass', freq: 200, attack: 0.02 });
  }
}
