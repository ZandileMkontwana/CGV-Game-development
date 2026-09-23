# Kutloano's shader work — what's in here and how to use it

## Files
- `ShaderManager.js` — lighting presets, both required shaders, weak-point
  glow, pulse-bolt glow + trail, procedural PBR wall/floor materials, and
  the update loop that keeps every uniform "alive".
- `textures.js` — generates normal/roughness/AO maps and a gradient skybox
  on a `<canvas>` at runtime. No external image assets needed, so it works
  the moment you `npm run dev` — nothing to download or place in
  `src/assets/textures/`.

## What's demo-ready right now
- All three lighting presets, with a real gradient skybox per level
  (not just a flat background colour) and organic flicker on Levels 2/3
  (layered sine + jitter + rare full drop-out — reads as failing wiring,
  not a metronome).
- Heat-haze shader: layered upward-drifting distortion with a fresnel edge
  fade, additive blending. Wired onto `LevelManager.heatHazeZones` in
  Level 2 automatically.
- Dissolve shader: 3D value-noise erosion with a two-tone glowing edge band
  (hot yellow → cool orange) and a faint pre-heat glow as the amount rises.
  Wired onto `LevelManager._dissolveWalls` in Level 3.
- Monster weak-point glow (pulsing + fresnel rim + a hit-flash that bumps
  on damage — see `Game.js`'s pulse-tool `hit` handler).
- Pulse-bolt glow shader + a small fading-trail sprite pool.

## Two things I bridged into other people's files (clearly marked `KUTLOANO:`)
I only touched `src/shaders/`, but three of these shaders are dead code
unless *something* assigns them onto meshes someone else creates, so I
added the minimum wiring in `Game.js`:
1. `_loadLevel()` now calls `this.shaders.wireLevelVisuals(...)` right after
   building each level, and I reordered it so the shader skybox/fog isn't
   immediately overwritten by `LevelManager`'s flat-colour fog.
2. The pulse-tool bolt's material and a trail pool are swapped in right
   after `PulseTool` is constructed, and the monster's weak points get
   their glow material right after `MonsterAI` is constructed.

**Please flag these two spots with Zandile before merging** — I reached
into `pulseTool._bolt` (a private field) as a stopgap; once you touch
`PulseTool.js` again, a public `setBoltMaterial()` would be cleaner.

## The building-collapse timer doesn't exist yet
Level 3's boss-fight/collapse timer is on Zandile's task list and isn't
built yet, so I added `shaders.startAutoCollapse(75)` as a fallback — it
drives `uDissolveAmount` from 0→1 over 75 seconds on its own so the
dissolve shader is visibly alive for mentor demos and the beta. Once the
real collapse timer exists, replace the `startAutoCollapse` call in
`Game.js` with `this.shaders.setDissolveAmount(t)` driven by that timer,
and delete `startAutoCollapse`/`stopAutoCollapse` from `ShaderManager.js`.

## Not done yet (flagged as later/final-only in the task list)
- PBR wall/floor materials (`createPBRWallMaterial` / `createPBRFloorMaterial`)
  exist and work, but I haven't swapped every `MeshStandardMaterial` in
  `LevelManager.js` for them — that's a lot of surface area in Mlungisi's
  file and better done together. Drop-in usage:
  ```js
  const wallMat = shaders.createPBRWallMaterial(0x8a8f96);
  const floorMat = shaders.createPBRFloorMaterial(0x555a60);
  ```
- Post-processing (bloom on energy effects, vignette during the collapse)
  — brief says final submission only, so I left it out rather than adding
  an EffectComposer nobody's asked to review yet. Happy to build it closer
  to the final deadline.
