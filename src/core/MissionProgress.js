/** Progress is local to a level run; paused frames never advance these clocks. */
export class HuntProgress {
  constructor() {
    this.released = false;
    this.rescued = new Set();
    this.archivePowered = false;
    this.downloading = false;
    this.download = 0;
    this.downloadDuration = 12;
    this.records = false;
  }

  activate(action) {
    if (action === 'rescue' && !this.released) { this.released = true; return true; }
    if (action === 'archive-power' && !this.archivePowered) { this.archivePowered = true; return true; }
    if (action === 'archive-download' && this.archivePowered && !this.downloading && !this.records) {
      this.downloading = true; return true;
    }
    return false;
  }

  rescue(id) { if (this.released) this.rescued.add(id); }
  update(dt, nearTerminal) {
    if (!this.downloading || !nearTerminal || this.records) return false;
    this.download = Math.min(this.downloadDuration, this.download + dt);
    if (this.download + 1e-6 < this.downloadDuration) return false;
    this.download = this.downloadDuration;
    this.records = true; this.downloading = false;
    return true;
  }
  get rescueComplete() { return this.rescued.size >= 2; }
  get downloadPercent() { return this.records ? 100 : Math.min(99, Math.floor(this.download / this.downloadDuration * 100)); }
  get complete() { return this.rescueComplete && this.records; }
}

export const ESCAPE_CHECKPOINTS = [
  { x: 0, z: -57.15, label: 'EAST MAINTENANCE TURN' },
  { x: 24, z: -69.15, label: 'SERVICE BYPASS AROUND THE RUBBLE' },
  { x: 18, z: -81.15, label: 'WEST TRANSFER GALLERY' },
  { x: -12, z: -81.15, label: 'SOUTH SURFACE CORRIDOR' },
  { x: -12, z: -105.15, label: 'SURFACE EXIT' },
];

export class CollapseProgress {
  constructor() {
    this.generators = new Set();
    this.escapeStarted = false;
    this.checkpoint = 0;
  }
  activate(action) {
    if (!['generator-west', 'generator-east'].includes(action) || this.generators.has(action)) return false;
    this.generators.add(action); return true;
  }
  get powered() { return this.generators.size === 2; }
  startEscape() { if (this.powered) this.escapeStarted = true; }
  update(player) {
    const point = ESCAPE_CHECKPOINTS[this.checkpoint];
    if (this.escapeStarted && point && Math.hypot(player.x - point.x, player.z - point.z) < 4.5) this.checkpoint++;
  }
  get complete() { return this.escapeStarted && this.checkpoint === ESCAPE_CHECKPOINTS.length; }
}
