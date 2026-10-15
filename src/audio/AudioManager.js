/**
 * AudioManager — procedural horror soundscape built entirely with the Web
 * Audio API. Effects and score are synthesized at runtime — there is NO
 * spoken dialogue. Facility P.A. calls are rendered as reactor-station
 * alert tones and sirens; their wording is shown on screen as a caption by
 * the UI layer. Fear can be modulated in real time through heartbeat speed,
 * growl proximity, and ambience ducking.
 *
 * Event interface (called from Game.js — keep names stable):
 *   play('pulseShot' | 'pulseHit' | 'pulseMiss' | 'doorOpen' | 'ventHiss' |
 *        'spark' | 'growl' | 'roar' | 'spotted' | 'attack' | 'transform' |
 *        'death' | 'alarm' | 'beep' | 'creak' | 'clang' | 'collapse' |
 *        'win' | 'gameover', opt?)
 *   playAlert(name)        synthesized P.A. cue (dispatch | power | bypass |
 *                          breach | failsafe | demolition): calm chimes for
 *                          routine calls, klaxon sirens + reactor power-down
 *                          for a lockdown.
 *   setLevel(n)            switch the ambient bed (1 calm lab, 2 dark hunt,
 *                          3 alarm/collapse)
 *   setGameState(state)    'menu' plays the thriller title theme; the
 *                          gameplay states play the level score
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
const CALM_NOTES = [329.63, 392, 493.88, 440, 392, 329.63, 293.66, 392];
const HUNT_NOTES = [220, 233.08, 220, 207.65];
const BOSS_NOTES = [130.81, 155.56, 146.83, 110];

export default class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.music = null;
    this.muted = false;
    this.volume = 0.65;
    this.musicVolume = 0.8;
    this._playing = false;
    this._paused = false;
    this._menuActive = false;
    this._contextSync = Promise.resolve();
    this._scoreTime = 0;
    this._scoreStep = 0;
    this._rechargeVoice = null;
    this._recharging = false;
    this.onSettingsChange = null;
    this._unlocked = false; // AudioContext may only start on a user gesture
    this._level = 1;
    this._mode = 'menu';    // currently built bed: 'menu' | 1 | 2 | 3 | null
    this._noise = null;
    this._dist = null;      // cached waveshaper curve
    this._footstep = null;  // { buffer, segments[] } recorded step sample
    this._doorSample = null; // { buffer, range } recorded door-open sample
    this._suspense = null;   // { buffer } level-start / menu suspense track
    this._suspenseSrc = null;
    this._suspenseWanted = false; // requested before the sample finished decoding
    this._suspenseFailed = false; // sample unavailable → use the synth fallback
    this._l1Ambience = null; // { buffer } recorded Level-1 machinery ambience loop
    this._paClips = {};      // name → { buffer } recorded P.A. announcement clips
    this._paWanted = null;   // requested clip sequence, replayed once decoded

    this._bed = null;       // { gain, filter, nodes[], base }
    this._rumble = null;    // { src, lfo, g } collapse loop
    this._duckTO = 0;

    // Per-frame schedulers (seconds until next event).
    this._stepTimer = 0;
    this._beatTimer = 0;
    this._growlTimer = 6;
    this._stingTimer = 10;
    this._mStepTimer = 0;   // creature footfalls
    this._breath = null;    // hiding-breath loop
    this._breathOn = false;
    this._breathAmp = 0;

    // Unlock the AudioContext on the first user gesture (browser autoplay
    // policy): the Start-click or any key press is enough.
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat && !e.target.closest?.('input, textarea, select')) this.toggleMute();
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Create the context + master chain. Safe to call repeatedly. */
  unlock() {
    if (this._unlocked) {
      if (!this._paused && this.ctx.state !== 'running') this._syncContextState();
      return;
    }
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
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp);

    // Background music/ambience has its own control; effects and PA voices
    // still use master directly so their volume does not change with it.
    this.music = this.ctx.createGain();
    this.music.gain.value = (this._playing || this._menuActive) ? this.musicVolume : 0;
    this.music.connect(this.master);

    // Shared 2 s white-noise buffer — every noise voice reuses it.
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noise = buf;

    this._unlocked = true;
    this._loadFootstepSample();
    this._loadDoorSample();
    this._loadSuspenseSample();
    this._loadLevel1Ambience();
    this._loadAnnouncementClips();
    this._syncContextState();
    if (this._playing) this._startBed(this._level);
    else if (this._menuActive) { this._startMenuBed(); this.playSuspense(); }
  }

  setVolume(value) {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.65));
    this._applyVolume();
  }

  setMusicVolume(value) {
    this.musicVolume = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.8));
    this._applyMusicVolume();
    this.onSettingsChange?.();
  }

  _applyMusicVolume() {
    if (!this.music) return;
    const t = this.ctx.currentTime;
    this.music.gain.cancelScheduledValues(t);
    const on = this._playing || this._menuActive;
    this.music.gain.setTargetAtTime(on ? this.musicVolume : 0, t, 0.08);
  }

  _syncContextState() {
    // Serialize rapid pause/resume requests so a pending suspend cannot
    // complete after resume and leave the entire soundscape silent.
    this._contextSync = this._contextSync.catch(() => {}).then(() => {
      if (!this.ctx || this.ctx.state === 'closed') return;
      return this._paused ? this.ctx.suspend() : this.ctx.resume();
    });
  }

  _applyVolume() {
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, t, 0.05);
    }
    this.onSettingsChange?.();
  }

  setGameState(state) {
    this._playing = ['playing', 'paused', 'levelTransition'].includes(state);
    this._paused = state === 'paused';
    this._menuActive = state === 'menu';
    this._applyMusicVolume();
    this._syncContextState();
    // Swap the title theme in for the menu and the level score for gameplay.
    if (this._unlocked) {
      if (this._menuActive) {
        this._startMenuBed();
        this.playSuspense();      // the home screen shares the same cue
      } else if (this._playing && this._mode !== this._level) {
        this._startBed(this._level);
      }
    }
  }

  setRecharge(active) {
    if (!this._unlocked) return;
    if (active && !this._rechargeVoice) {
      const oscillator = this.ctx.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = 220;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      oscillator.connect(gain).connect(this.master);
      oscillator.start();
      this._rechargeVoice = { oscillator, gain };
    }
    if (this._rechargeVoice && active !== this._recharging) {
      this._rechargeVoice.gain.gain.setTargetAtTime(active ? 0.018 : 0, this.ctx.currentTime, 0.15);
    }
    this._recharging = active;
  }

  toggleMute() {
    this.muted = !this.muted;
    this._applyVolume();
  }

  /** Advance the procedural score while gameplay is running. */
  _updateScore() {
    // Sustained notes in the midrange remain audible on smaller speakers.
    // Game time is capped during slow frames; music follows real audio time
    // so that low frame rates do not stretch the gaps between notes.
    const now = this.ctx.currentTime;
    if (now >= this._scoreTime) {
      if (this._level === 1) {
        // Calm lab: a slow, consonant major-ish motif — nothing threatening.
        const note = CALM_NOTES[this._scoreStep % CALM_NOTES.length];
        this._scoreNote(note, 2.8, 0.18);
        this._scoreNote(note * 1.5, 2.6, 0.055);
        this._scoreTime = now + 2.4;
      } else if (this._level === 2) {
        // Suspense: a minor-second cluster with an icy high shimmer.
        const note = HUNT_NOTES[this._scoreStep % HUNT_NOTES.length];
        this._scoreNote(note, 2.4, 0.12, 'triangle');
        this._scoreNote(note * 1.05946, 2.2, 0.045);
        if (this._scoreStep % 4 === 0) this._scoreNote(note * 6.28, 3.4, 0.02);
        this._scoreTime = now + 2;
      } else if (this._level === 3) {
        // Terror: driving low stabs over a distant warning pulse.
        const note = BOSS_NOTES[Math.floor(this._scoreStep / 4) % BOSS_NOTES.length];
        this._scoreNote(note, 0.45, 0.18, 'triangle');
        this._scoreNote(note * 3, 0.42, 0.12, 'triangle');
        this._chirp(140, 45, 0.18, 0.2, 'sine', undefined, this.music);
        if (this._scoreStep % 2) this._burst({ dur: 0.1, vol: 0.085, type: 'bandpass', freq: 1600, destination: this.music });
        this._scoreTime = now + 60 / 112;
      } else {
        this._scoreTime = now + 3;
      }
      this._scoreStep++;
    }
  }

  _scoreNote(frequency, duration, volume, type = 'sine') {
    const t = this.ctx.currentTime;
    const oscillator = this.ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    const gain = this._gain(MIN_GAIN);
    // Music needs a sustained envelope; the effect chirp decays too fast.
    gain.gain.setValueAtTime(MIN_GAIN, t);
    gain.gain.linearRampToValueAtTime(volume, t + Math.min(0.15, duration * 0.2));
    gain.gain.setValueAtTime(volume, t + duration * 0.65);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, t + duration);
    oscillator.connect(gain).connect(this.music || this.master);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(t);
    oscillator.stop(t + duration + 0.02);
  }

  // ── One-shot dispatch ────────────────────────────────────────────────────

  /**
   * Trigger a named sound.
   * @param {string} name
   * @param {*} [opt] Voice-specific option (growl proximity or urgent beep).
   */
  play(name, opt) {
    if (!this._unlocked || this.muted) return;
    switch (name) {
      case 'pulseShot': this._pulseShot(); break;
      case 'pulseHit': this._spark(); this._chirp(2400, 1700, 0.07, 0.14); break;
      case 'pulseMiss': this._whoosh(); break;
      case 'spark': this._spark(); break;
      case 'glassBreak':
        this._burst({ dur: 0.3, vol: 0.2, type: 'highpass', freq: 2400 });
        this._chirp(1600, 480, 0.18, 0.16, 'triangle');
        break;
      case 'doorOpen': this._door(); break;
      case 'heal':
        this._chirp(440, 880, 0.22, 0.12, 'sine');
        this._chirp(660, 1100, 0.3, 0.08, 'sine');
        break;
      case 'ventHiss': this._hiss(1.0, 0.3); break;
      case 'growl': this._growl(opt === undefined ? 0.4 : opt); break;
      case 'roar': this._roar(); break;
      case 'spotted': this._sting(); break;
      case 'bossWindup':
        this._chirp(140, 620, 0.75, 0.16, 'triangle');
        break;
      case 'jumpscare': this._jumpscare(); break;
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

  /**
   * Synthesized replacement for a spoken P.A. announcement. Routine calls use
   * calm chimes; containment events use reactor-station klaxons and the sound
   * of the reactor powering down. The caption text is shown by the UI layer.
   */
  playAlert(name) {
    if (!this._unlocked || this.muted) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'dispatch': this._chime([523.25, 659.25], 0.75, 0.08); break;
      case 'power':    this._chime([392, 523.25, 659.25], 0.42, 0.07); break;
      case 'bypass':   this._chime([440, 587.33], 0.34, 0.08); break;
      case 'breach':   this._lockdown(t); break;
      case 'failsafe': this._wail(t, 2.6, 0.2); this._beep(true, t + 0.3); break;
      case 'demolition': this._wail(t, 4.2, 0.26); this._startRumble(); break;
      default: break;
    }
  }

  // ── Per-frame schedulers ─────────────────────────────────────────────────

  /**
   * Drive footsteps, the tension heartbeat, patrol growls and distant
   * facility creaks. Zero allocation — counters only.
   */
  update(dt, moving, sprinting, grounded, threat, chasing, monsterActive, health01,
         monsterDist, hiding, monsterMoving = chasing) {
    if (!this._unlocked || this.muted) return;
    this._updateScore();

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

    // The creature's own lurching footfalls — the sound that makes players
    // freeze. Volume rises as it closes in.
    if (monsterActive && monsterMoving && monsterDist < (chasing ? 28 : 18)) {
      this._mStepTimer -= dt;
      if (this._mStepTimer <= 0) {
        const prox = 1 - monsterDist / 28;
        this._heavyStep(chasing ? 0.12 + prox * 0.5 : 0.08 + prox * 0.24);
        this._mStepTimer = chasing ? 0.34 + Math.random() * 0.14 : 0.65;
      }
    } else {
      this._mStepTimer = 0.15;
    }

    // Muffled shaking breath while hiding from a nearby creature.
    if (hiding && monsterActive) {
      const bprox = monsterDist > 20 ? 0 : 1 - monsterDist / 20;
      this.setBreathing(true, 0.35 + bprox * 0.65);
    } else {
      this.setBreathing(false, 0);
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

  /**
   * Muffled, shaky breathing while hiding. The loop is built once and then
   * just re-targeted (no node churn). `k` 0..1 scales depth and speed.
   */
  setBreathing(on, k) {
    if (!this._unlocked) return;
    if (on && !this._breath) this._buildBreath();
    if (!this._breath) return;
    const b = this._breath;
    const amp = on ? 0.05 + 0.16 * k : 0;
    if (on !== this._breathOn || Math.abs(amp - this._breathAmp) > 0.012) {
      const now = this.ctx.currentTime;
      this._breathAmp = amp;
      b.gain.gain.setTargetAtTime(amp, now, 0.3);
      b.lfoGain.gain.setTargetAtTime(amp * 0.6, now, 0.3);
      this._breathOn = on;
    }
    if (on) b.lfo.frequency.value = 0.16 + 0.22 * k; // faster as it closes in
  }

  _buildBreath() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this._noiseSource(true);
    const f = this._filter('bandpass', 480, 0.7);
    const hf = this._filter('highpass', 240, 0.5);
    const gain = this._gain(MIN_GAIN);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.2; // inhale/exhale cycle
    const lfoGain = this._gain(0);
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(hf).connect(f).connect(gain).connect(this.master);
    src.start(t);
    lfo.start(t);
    this._breath = { src, lfo, gain, lfoGain };
  }

  // ── Ambient bed ──────────────────────────────────────────────────────────

  setLevel(n) {
    clearTimeout(this._duckTO);
    this.setRecharge(false);
    this._scoreTime = 0;
    this._scoreStep = 0;
    this._stepTimer = 0;
    this._beatTimer = 0.4;
    this._growlTimer = 6;
    this._stingTimer = 10;
    const changed = n !== this._mode || !this._bed;
    this._level = n;
    if (this._unlocked && changed) this._startBed(n);
  }

  stopAmbient() {
    this._stopBed(1.2);
    this.stopSuspense(1.2);
    this.setBreathing(false, 0);
    this.setRecharge(false);
  }

  /** Momentarily pull the ambience down so stingers cut through. */
  duck(amount, duration = 1100) {
    if (!this._bed || !this._unlocked) return;
    const g = this._bed.gain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this._bed.base * (1 - amount), t, 0.12);
    clearTimeout(this._duckTO);
    this._duckTO = setTimeout(() => {
      if (!this._bed) return;
      this._bed.gain.gain.setTargetAtTime(this._bed.base, this.ctx.currentTime, 0.5);
    }, duration);
  }

  _startBed(mode) {
    if (!this._unlocked) return;
    this._stopBed(1.2);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const isMenu = mode === 'menu';
    const level = isMenu ? 0 : mode;

    // Level 1 uses the recorded industrial-machinery ambience when available —
    // a looping bed that replaces the synthesized lab hum for that level.
    if (level === 1 && this._l1Ambience) {
      const src = ctx.createBufferSource();
      src.buffer = this._l1Ambience.buffer;
      src.loop = true;
      const gain = this._gain(MIN_GAIN);
      src.connect(gain).connect(this.music || this.master);
      src.start(t);
      const bed = { gain, filter: null, nodes: [src], base: 0.5 };
      gain.gain.setValueAtTime(MIN_GAIN, t);
      gain.gain.exponentialRampToValueAtTime(bed.base, t + 2.0);
      this._mode = mode;
      this._bed = bed;
      return;
    }

    const filter = this._filter('lowpass',
      isMenu ? 560 : level === 2 ? 720 : level === 3 ? 900 : 650, 0.6);
    const gain = this._gain(MIN_GAIN);
    filter.connect(gain).connect(this.music || this.master);
    const bed = { gain, filter, nodes: [], base: isMenu ? 0.36 : 0.42 };

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
      addOsc('sine', 329.63, 0.1, 0);
    } else if (level === 2) {
      // Damaged corridors: deeper drone + slowly moving air.
      addOsc('sine', 55, 0.5, -3);
      addOsc('sine', 55.8, 0.5, 3);
      addOsc('triangle', 110, 0.12, 0);
      addOsc('triangle', 220, 0.15, -6);
      addOsc('sine', 233.08, 0.09, 6);
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
    } else if (level === 3) {
      // Collapse: dissonant beat + a distant warning pulse.
      addOsc('sine', 65, 0.45, -5);
      addOsc('sine', 64.2, 0.45, 5);
      addOsc('triangle', 130, 0.1, 0);
      addOsc('triangle', 261.63, 0.18, 0);
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
    } else {
      // Menu thriller: a low ominous drone with a slow heartbeat swell and
      // a faint tritone shimmer — dread waiting behind the title screen.
      addOsc('sine', 55, 0.5, -4);
      addOsc('sine', 55.6, 0.5, 4);
      addOsc('sawtooth', 82.5, 0.05, 0);
      addOsc('triangle', 110, 0.1, 0);
      addOsc('sine', 311.13, 0.03, 5);
      const pulse = ctx.createOscillator();
      pulse.type = 'triangle';
      pulse.frequency.value = 82;
      const pg = this._gain(0.12);
      pulse.connect(pg).connect(filter);
      const pl = ctx.createOscillator();
      pl.type = 'sine';
      pl.frequency.value = 1.0; // ~60 bpm heartbeat
      const plg = this._gain(0.11);
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
    this._mode = mode;
    this._bed = bed;
  }

  /** Swap in the menu thriller theme (no-op if it is already playing). */
  _startMenuBed() {
    if (!this._unlocked) return;
    if (this._mode === 'menu' && this._bed) return;
    this._startBed('menu');
  }

  _stopBed(fade) {
    const bed = this._bed;
    if (!bed) return;
    this._bed = null;
    this._mode = null;
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
  _chirp(f0, f1, dur, vol, type, when, destination) {
    const t = when === undefined ? this.ctx.currentTime : when;
    const o = this.ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = this._gain(MIN_GAIN);
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + dur);
    o.connect(g).connect(destination || this.master);
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
    src.connect(f).connect(g).connect(o.destination || this.master);
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

  /** The creature's footfall — a low body-thud with floor grit. */
  _heavyStep(vol) {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.18);
    const g = this._gain(MIN_GAIN);
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + 0.22);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.24);
    this._burst({ dur: 0.14, vol: vol * 0.5, type: 'lowpass', freq: 320 + Math.random() * 160, attack: 0.004 });
  }

  /** Hard first-sighting stinger: scream + scrape + sub boom. */
  _jumpscare() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.7);
    const vib = this.ctx.createOscillator();
    vib.frequency.setValueAtTime(12, t);
    vib.frequency.linearRampToValueAtTime(30, t + 0.7);
    const vg = this._gain(70);
    vib.connect(vg).connect(o.frequency);
    const ws = this.ctx.createWaveShaper();
    ws.curve = this._distCurve();
    const og = this._gain(MIN_GAIN);
    og.gain.setValueAtTime(MIN_GAIN, t);
    og.gain.exponentialRampToValueAtTime(0.5, t + 0.012);
    og.gain.exponentialRampToValueAtTime(MIN_GAIN, t + 0.85);
    o.connect(ws);
    ws.connect(og).connect(this.master);
    o.start(t); vib.start(t);
    o.stop(t + 0.9); vib.stop(t + 0.9);
    this._burst({ dur: 0.5, vol: 0.3, type: 'bandpass', freq: 5200, q: 2, f1: 900, attack: 0.01 });
    this._chirp(58, 28, 1.0, 0.55, 'sine');
  }

  _door() {
    if (this._doorSample) { this._playDoor(); return; }
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

  _beep(urgent, when) {
    this._chirp(
      urgent ? 1180 : 860, urgent ? 1180 : 860,
      urgent ? 0.14 : 0.09, urgent ? 0.26 : 0.18, 'square', when
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
    // Recorded take takes priority; falls back to the synthesized step until
    // the sample has finished decoding (or if it is missing).
    if (this._playFootstep(sprint ? 0.85 : 0.68)) return;
    const metal = this._level === 1;
    this._burst({
      dur: 0.1,
      vol: sprint ? 0.15 : 0.1,
      type: 'lowpass',
      freq: (metal ? 700 : 240) + Math.random() * 120,
      attack: 0.004,
    });
    if (metal || Math.random() < 0.4) {
      this._burst({ dur: 0.03, vol: 0.04, type: 'bandpass', freq: 2400 + Math.random() * 900, q: 2 });
    }
  }

  /**
   * Play one pre-cut footstep take from the loaded sample. A random take is
   * chosen and pitch-jittered so repeated steps never sound identical.
   * @returns {boolean} true if a recorded take played.
   */
  _playFootstep(vol) {
    const fs = this._footstep;
    if (!fs || !fs.segments.length) return false;
    const ctx = this.ctx;
    const seg = fs.segments[(Math.random() * fs.segments.length) | 0];
    const rate = 0.94 + Math.random() * 0.12;
    const src = ctx.createBufferSource();
    src.buffer = fs.buffer;
    src.playbackRate.value = rate;
    const g = this._gain(MIN_GAIN);
    const t = ctx.currentTime;
    const dur = seg.duration / rate;
    // Short fades hide any residual click at the cut edges.
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.setValueAtTime(vol, t + Math.max(0.02, dur - 0.04));
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + dur);
    src.connect(g).connect(this.master);
    src.start(t, seg.offset, seg.duration);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (e) { /* noop */ } };
    return true;
  }

  /** Fetch + decode the footstep sample, then cut it into individual takes. */
  async _loadFootstepSample() {
    if (!this.ctx || this._footstep) return;
    try {
      const res = await fetch('/assets/audio/player/footstep_hard_floor.mp3');
      if (!res.ok) return;
      const audio = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this._footstep = { buffer: audio, segments: this._extractStepSegments(audio) };
    } catch (e) { /* keep the synthesized fallback */ }
  }

  /** Split a footstep recording into single takes by scanning its RMS envelope. */
  _extractStepSegments(buffer) {
    const data = buffer.getChannelData(0);
    const rate = buffer.sampleRate;
    const win = Math.max(1, Math.floor(rate * 0.01));       // 10 ms windows
    const n = Math.min(Math.floor(data.length / win), 4000); // analyse <= 40 s
    const env = new Float32Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const base = i * win;
      for (let j = 0; j < win; j++) { const s = data[base + j]; sum += s * s; }
      const rms = Math.sqrt(sum / win);
      env[i] = rms;
      if (rms > peak) peak = rms;
    }
    const fallback = [{ offset: 0, duration: buffer.duration }];
    if (peak <= 0) return fallback;
    const hi = peak * 0.30;       // onset threshold
    const lo = peak * 0.06;       // decay threshold
    const gap = 9;                // windows below `lo` that end a take (~90 ms)
    const minSeg = 0.14;          // keep the natural tail; never clip a step
    const maxSeg = 0.5;
    const minWin = Math.ceil(minSeg * rate / win);
    const maxWin = Math.ceil(maxSeg * rate / win);
    const segs = [];
    let i = 0;
    while (i < n && segs.length < 16) {
      while (i < n && env[i] <= hi) i++;
      if (i >= n) break;
      const start = i;
      let below = 0;
      while (i < n && below <= gap) {
        if (env[i] <= lo) below++; else below = 0;
        i++;
      }
      const s = Math.max(0, start - 2);                 // 20 ms pre-roll keeps the attack
      let e = Math.min(n, i - below + 3);               // ~30 ms tail keeps the decay
      if (e - s < minWin) e = Math.min(n, s + minWin);  // never clip a step short
      if (e - s > maxWin) e = s + maxWin;
      if (e - s >= 3) {
        const offset = (s * win) / rate;
        segs.push({ offset, duration: Math.min(((e - s) * win) / rate, buffer.duration - offset) });
      }
    }
    // Drop takes that start too close together — an over-split of one step.
    for (let k = segs.length - 1; k > 0; k--) {
      if (segs[k].offset - segs[k - 1].offset < minSeg) segs.splice(k, 1);
    }
    return segs.length ? segs : fallback;
  }

  /** Fetch + decode the door sample, trimming silence from both ends. */
  async _loadDoorSample() {
    if (!this.ctx || this._doorSample) return;
    try {
      const res = await fetch('/assets/audio/environment/metal_door_open.mp3');
      if (!res.ok) return;
      const audio = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this._doorSample = { buffer: audio, range: this._trimRange(audio) };
    } catch (e) { /* keep the synthesized door */ }
  }

  /** Play the recorded door-open take, loud and pitch-jittered slightly. */
  _playDoor() {
    const ds = this._doorSample;
    if (!ds) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = ds.buffer;
    src.playbackRate.value = 0.97 + Math.random() * 0.06;
    const g = this._gain(MIN_GAIN);
    const t = ctx.currentTime;
    // The source file is a ~31 s recording; play only the door-open event.
    const playDur = Math.min(ds.range.duration, 4.0);
    const dur = playDur / src.playbackRate.value;
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.exponentialRampToValueAtTime(0.95, t + 0.02);
    g.gain.setValueAtTime(0.95, t + Math.max(0.05, dur - 0.2));
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + dur);
    src.connect(g).connect(this.master);
    src.start(t, ds.range.offset, playDur);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (e) { /* noop */ } };
  }

  /** First/last non-silent window of a recording — drops lead-in and tail. */
  _trimRange(buffer) {
    const data = buffer.getChannelData(0);
    const rate = buffer.sampleRate;
    const win = Math.max(1, Math.floor(rate * 0.01));   // 10 ms windows
    const n = Math.floor(data.length / win);
    const env = new Float32Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const base = i * win;
      for (let j = 0; j < win; j++) { const s = data[base + j]; sum += s * s; }
      const rms = Math.sqrt(sum / win);
      env[i] = rms;
      if (rms > peak) peak = rms;
    }
    if (peak <= 0) return { offset: 0, duration: buffer.duration };
    const thr = peak * 0.05;
    let a = 0; while (a < n && env[a] <= thr) a++;
    let b = n - 1; while (b > a && env[b] <= thr) b--;
    const offset = Math.max(0, ((a - 2) * win) / rate);
    const end = Math.min(buffer.duration, ((b + 3) * win) / rate);
    return { offset, duration: Math.max(0.05, end - offset) };
  }

  /** Fetch + decode the recorded P.A. announcement clips, keyed by name. */
  async _loadAnnouncementClips() {
    if (!this.ctx) return;
    const clips = {
      depressurize: '/assets/audio/announcements/depressurize.mp3',
      sectorIsolated: '/assets/audio/announcements/sector_isolated.mp3',
    };
    for (const [name, url] of Object.entries(clips)) {
      if (this._paClips[name]) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        this._paClips[name] = { buffer: await this.ctx.decodeAudioData(await res.arrayBuffer()) };
      } catch (e) { /* skip this clip */ }
    }
    // A sequence requested while the clips were still decoding plays now.
    if (this._paWanted) {
      const wanted = this._paWanted;
      this._paWanted = null;
      this.playClipSequence(wanted);
    }
  }

  /**
   * Play recorded P.A. clips back-to-back through the SFX bus. Returns each
   * clip's start offset in seconds from now so callers can sync captions.
   */
  playClipSequence(names, gap = 0.4, vol = 0.9) {
    if (!this._unlocked || this.muted) return [];
    if (!names.some((n) => this._paClips[n])) { this._paWanted = names; return []; }
    const ctx = this.ctx;
    const starts = [];
    let at = ctx.currentTime + 0.1;
    for (const name of names) {
      const clip = this._paClips[name];
      if (!clip) continue;
      const src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      const g = this._gain(MIN_GAIN);
      const dur = clip.buffer.duration;
      g.gain.setValueAtTime(MIN_GAIN, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.05);
      g.gain.setValueAtTime(vol, at + Math.max(0.1, dur - 0.15));
      g.gain.exponentialRampToValueAtTime(MIN_GAIN, at + dur);
      src.connect(g).connect(this.master);
      src.start(at);
      src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (e) { /* noop */ } };
      starts.push(at - ctx.currentTime);
      at += dur + gap;
    }
    return starts;
  }

  /** Fetch + decode the recorded Level-1 machinery ambience loop. */
  async _loadLevel1Ambience() {
    if (!this.ctx || this._l1Ambience) return;
    try {
      const res = await fetch('/assets/audio/ambience/level1_machinery.mp3');
      if (!res.ok) return;
      const audio = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this._l1Ambience = { buffer: audio };
      // Swap it in if Level 1's procedural bed is already sounding.
      if (this._mode === 1) this._startBed(1);
    } catch (e) { /* keep the procedural bed */ }
  }

  /** Fetch + decode the level-start / stage-switch suspense track. */
  async _loadSuspenseSample() {
    if (!this.ctx || this._suspense || this._suspenseFailed) return;
    try {
      const res = await fetch('/assets/audio/music/suspense_intro.mp3');
      if (!res.ok) { this._suspenseFailed = true; return; }
      const audio = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this._suspense = { buffer: audio };
      // A cue requested while the sample was still decoding starts now.
      if (this._suspenseWanted && (this._menuActive || this._playing)) {
        this._suspenseWanted = false;
        this.playSuspense();
      }
    } catch (e) { this._suspenseFailed = true; }
  }

  /**
   * Play the suspense cue at the start of a run and on each stage switch.
   * Restarts if one is already sounding and ducks the ambience beneath it.
   */
  playSuspense() {
    if (!this._unlocked || this.muted) return;
    if (!this._suspense) {
      // Still decoding — remember the intent, or fall back if it failed.
      if (this._suspenseFailed) this._playSuspenseFallback();
      else this._suspenseWanted = true;
      return;
    }
    this._suspenseWanted = false;
    this.stopSuspense(0.05);
    const sample = this._suspense;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    const g = this._gain(MIN_GAIN);
    const t = ctx.currentTime;
    const dur = sample.buffer.duration;
    g.gain.setValueAtTime(MIN_GAIN, t);
    g.gain.exponentialRampToValueAtTime(0.85, t + 0.25);
    g.gain.setValueAtTime(0.85, t + Math.max(0.5, dur - 1.5));
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + dur);
    src.connect(g).connect(this.music);
    src.start(t);
    this._suspenseSrc = src;
    this.duck(0.6, dur * 1000);
    src.onended = () => {
      try { src.disconnect(); g.disconnect(); } catch (e) { /* noop */ }
      if (this._suspenseSrc === src) this._suspenseSrc = null;
    };
  }

  /** Fade out the suspense cue (level end, menu, or a new stage switch). */
  stopSuspense(fade = 0.6) {
    const src = this._suspenseSrc;
    if (!src) return;
    this._suspenseSrc = null;
    try { src.stop(this.ctx.currentTime + Math.max(0, fade)); } catch (e) { /* already stopped */ }
  }

  /** Synth stand-in used only if the suspense sample is missing. */
  _playSuspenseFallback() {
    this._chirp(110, 82.4, 3.0, 0.22, 'sawtooth');
    this._chirp(55, 41.2, 3.4, 0.18, 'sine');
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

  // ── Facility P.A. alert voices (no spoken dialogue) ──────────────────────

  /** Soft sustained bell tone (routine P.A. chimes). */
  _alertTone(freq, when, dur, vol) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = this._gain(MIN_GAIN);
    g.gain.setValueAtTime(MIN_GAIN, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.02);
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, when + dur);
    o.connect(g).connect(this.master);
    o.start(when);
    o.stop(when + dur + 0.02);
  }

  _chime(freqs, spacing, vol) {
    const t = this.ctx.currentTime;
    for (let i = 0; i < freqs.length; i++) {
      this._alertTone(freqs[i], t + i * spacing, 1.0, vol);
    }
  }

  /** Air-raid-style wailing klaxon: a saw swept by a slow LFO. */
  _wail(when, dur, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 600;
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = 0.55;
    const lg = this._gain(240);
    lfo.connect(lg).connect(o.frequency);
    const f = this._filter('bandpass', 820, 1.5);
    const g = this._gain(MIN_GAIN);
    g.gain.setValueAtTime(MIN_GAIN, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.5);
    g.gain.setValueAtTime(vol, when + Math.max(0.6, dur - 0.6));
    g.gain.exponentialRampToValueAtTime(MIN_GAIN, when + dur);
    o.connect(f).connect(g).connect(this.master);
    o.start(when);
    lfo.start(when);
    o.stop(when + dur + 0.05);
    lfo.stop(when + dur + 0.05);
  }

  /**
   * Reactor-station lockdown: a long wailing klaxon over the reactor winding
   * down, containment doors sealing, and tripping-breaker shutdown indicators.
   */
  _lockdown(t) {
    this._wail(t, 6.2, 0.24);
    this._chirp(150, 32, 2.8, 0.5, 'sine', t);
    this._burst({ dur: 2.6, vol: 0.16, type: 'lowpass', freq: 240, attack: 0.18 });
    this._clang(t + 0.5, 0.9);
    this._clang(t + 1.7, 0.7);
    this._clang(t + 3.1, 0.8);
    for (let i = 0; i < 5; i++) this._beep(true, t + 1.3 + i * 0.55);
    this.duck(0.5, 6200);
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
