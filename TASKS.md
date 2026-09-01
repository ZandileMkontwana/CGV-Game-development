# Team Tasks — Containment Breach

> Read this alongside [PLAN.md](./PLAN.md) for the full project context.

---

## Zandile — Engine & Controls

**Your folder:** `src/core/`
**Your branch:** `Zandile`

### Already Done
- [x] Project scaffold (Vite + Three.js + cannon-es)
- [x] InputManager (keyboard + mouse + pointer lock)
- [x] PlayerController (WASD, sprint, jump, physics body)
- [x] CameraController (FPS camera, mouse look, arrow keys, screen shake)
- [x] PhysicsWorld (cannon-es, ground plane, body helpers)
- [x] GameState (menu, pause, restart, level transitions)
- [x] Game.js orchestrator (main loop, subsystem wiring)
- [x] Level 1 prototype corridors for alpha
- [x] Lighting presets integrated into game loop

### Next Tasks (Priority Order)

**1. Third-Person Camera + V Key Toggle**
- Add a third-person camera behind and above the player
- Press **V** to switch between first-person and third-person
- Hide the character model in first-person view
- Smooth transition between views
- Big rubric hit under **Viewing (10%)**

**2. Pulse Tool — `src/core/PulseTool.js`**
- Left click or **F** key to fire
- Raycast from camera forward to detect hits on shootable meshes
- Energy system: 100 max, 10 per shot, recharges at 5/sec
- Cooldown between shots: 0.5 seconds
- Fire events: `onHit(target)`, `onMiss()`, `onFire()` — for sound and effects
- Per-level behaviour:
  - Level 1: shoot terminals/conduits to activate lights and doors
  - Level 2: shoot hazards (sparking conduits, steam valves) to disable them
  - Level 3: shoot monster weak points, destroy drones

**3. Monster AI — `src/core/MonsterAI.js`**
- Three states: **PATROL → CHASE → ATTACK**
- PATROL: monster walks between waypoints (Mlungisi provides waypoint positions)
- CHASE: triggered when player enters detection range, monster runs toward player
- ATTACK: when close enough, monster damages player
- Returns to PATROL if player escapes detection for 10 seconds
- Monster health: 3 weak points (Kutloano adds glow material)
- Boss fight phases: each weak point destroyed changes monster behaviour

**4. Level 2 Stealth Mechanic**
- Monster detection range (sphere or cone check from monster to player)
- Visual/audio warning when monster is near (heartbeat gets louder — coordinate with Ronie)
- Chase trigger when player is spotted
- Player can hide behind objects to break line of sight

**5. Level 3 Boss Fight**
- Monster has 3 glowing weak points (shoot to damage)
- Phases: behaviour changes as weak points are destroyed (faster, more aggressive)
- Building collapse timer (coordinate with Kutloano — dissolve shader intensifies)
- When monster defeated → escape sequence begins (timed run to exit)

**6. Win/Lose System**
- Level 1 win: reach control room trigger zone
- Level 2 win: reach emergency exit without being caught
- Level 3 win: defeat monster + reach escape door before timer runs out
- Lose: health reaches 0 or escape timer runs out
- Call `game.completeLevel()` on win, `game.gameOver()` on lose

**7. Integration Testing**
- You integrate Mlungisi's levels and Kutloano's shaders into Game.js
- You wire Ronie's UI into the game loop
- You do final integration testing before each submission
- Performance profiling with Chrome DevTools

---

## Mlungisi — Level Builder & Blender Models

**Your folder:** `src/levels/`
**Your branch:** `Mlungisi`

### How to Work
- Run `npm run dev` to test your changes
- Use the helpers in LevelManager: `_wallBox()`, `_floorCeil()`, `_propBox()`, `_propCylinder()`
- Conventions: **1 unit = 1 metre**, corridors 4m wide, ceilings 3m tall
- Register every mesh with `this._track(mesh, body)` so cleanup works on level teardown
- Asset filenames: lowercase, hyphen-separated, no spaces

### Blender Models (export as `.glb`, keep low-poly)
- [ ] Player character (engineer) — visible in third-person view
- [ ] Monster (mutated scientist) — appears in Level 2 and 3
- [ ] Scientist NPC (pre-mutation) — appears in Level 1 experiment scene
- [ ] Lab equipment — containment tube, computers, consoles, desks

### Level Geometry (build in `LevelManager.js`)

**Level 1 — The Experiment (clean lab)**
- [ ] Lab corridors connecting rooms (modular pieces: straight, T-junction, corner)
- [ ] Experiment room with containment tube area (where the scientist works)
- [ ] Control room with terminal desks
- [ ] Clean, undamaged surfaces
- [ ] Player spawn point in a starting corridor

**Level 2 — The Hunt (damaged facility)**
- [ ] Same corridor layout but damaged (broken walls, debris, holes in ceiling)
- [ ] Hiding spots: lockers, under desks, behind crates — player hides from monster
- [ ] Mark monster patrol path waypoints (array of positions for Zandile's AI)
- [ ] Shader zone markers where Kutloano's heat-haze effect should appear
- [ ] Shootable target meshes: power conduits, coolant valves

**Level 3 — The Collapse (building falling apart)**
- [ ] Boss arena: large open room for monster fight
- [ ] Collapsing ceiling sections, fallen debris blocking paths
- [ ] Escape route from boss arena to the exit door
- [ ] Geometry tagged for Kutloano's dissolve shader (walls that crumble)
- [ ] Shootable targets: boss weak point anchors, cooling systems

**Shootable Targets (mark these meshes for Zandile's pulse tool)**
- Power conduits on walls — shoot to open doors
- Coolant valves — shoot to stop steam vents temporarily
- Boss weak points — glowing nodes on the monster (Kutloano adds glow material)

### Deadlines
- Start Level 1 geometry ASAP — Zandile needs it to integrate with the engine
- Blender models can come later — we'll use box placeholders first
- All 3 levels rough by mid-October for beta

---

## Kutloano — Visuals & Shaders

**Your folder:** `src/shaders/`
**Your branch:** `Kutloano`

### How to Work
- Run `npm run dev` to test your changes
- The ShaderManager already has basic lighting and shader stubs — you refine them
- All shaders use `ShaderMaterial` with custom GLSL
- Shaders must use uniforms driven by time or game state ("alive" effects — rubric requirement)

### Lighting Presets (basics exist, needs polish)
- [ ] **Level 1:** Cool white ambient + directional — clean, bright lab feel
- [ ] **Level 2:** Flickering amber point lights — sin-driven intensity pulsing, horror atmosphere
- [ ] **Level 3:** Red emergency lighting — pulsing, intense, with deep fog
- [ ] Each preset also sets `scene.background` and `scene.fog` to match the mood

### Three Custom Shaders (10% of the grade — this is the big marks earner)

**1. Heat-Haze / Ripple (Level 2)**
- [ ] Applied to planes/zones around overheating machinery
- [ ] Uniforms: `uTime` (drives animation), `uIntensity` (proximity/damage)
- [ ] Effect: sine-wave UV distortion that warps the view behind it
- [ ] Must look "alive" — animated, not static
- [ ] The stub exists in `createHeatHazeMaterial()` — refine it

**2. Dissolve / Noise (Level 3)**
- [ ] Applied to meshes that crumble during the building collapse
- [ ] Uniforms: `uTime` (animates noise), `uDissolveAmount` (0 = intact, 1 = gone)
- [ ] Effect: 3D noise pattern eats away the mesh, glowing edge where it dissolves
- [ ] Game state drives `uDissolveAmount` as the building collapses
- [ ] The stub exists in `createDissolveMaterial()` — refine it

**3. Pulse Projectile Glow (new — for the pulse tool)**
- [ ] Applied to the energy bolt when the player fires
- [ ] Effect: bright glowing bolt with a fading trail behind it
- [ ] Should be visible from distance
- [ ] Coordinate with Zandile — they build the PulseTool.js, you provide the material

### Additional Visual Tasks
- [ ] Monster weak-point glow material (emissive, pulsing — so player sees where to shoot)
- [ ] PBR materials for lab surfaces (metallic walls, rough floors)
- [ ] Bump/normal maps on walls and floors (adds depth without extra geometry)
- [ ] Skybox (lab interior or exterior through windows)
- [ ] Shadow configuration: limit which lights cast shadows, keep resolution sensible
- [ ] Post-processing for final only: bloom on energy effects, vignette during collapse

### Deadlines
- Refine the two main shaders first (heat-haze + dissolve)
- Pulse glow shader after Zandile builds the pulse tool
- Lighting polish and textures for beta (mid-October)

---

## Ronie — UI, Sound & Deployment

**Your folder:** `src/ui/`
**Your branch:** `Ronie`

### How to Work
- Run `npm run dev` to test your changes
- The HTML for menus/HUD already exists in `index.html` — you wire up the dynamic behaviour
- Sound library: **Howler.js** (lightweight, works in browsers) — add to `package.json`
- Keep all audio files in `src/assets/audio/`

### HUD (update every frame while playing)
- [ ] **Health bar** — player takes damage from monster and environmental hazards
- [ ] **Energy bar** — pulse tool recharges over time, drains when firing (Zandile provides the value)
- [ ] **Objective text** — changes per level:
  - Level 1: "Reach the control room"
  - Level 2: "Avoid the monster — reach the emergency exit"
  - Level 3: "Defeat the monster — escape the building"
- [ ] **Failsafe countdown timer** — shows time remaining before building demolition
- [ ] **Level indicator** — already exists, keep it

### Sound Effects
- [ ] **Monster:** growls, heavy footsteps, screams when it spots the player
- [ ] **Heartbeat** — gets louder as monster gets closer (big atmosphere win)
- [ ] **Pulse tool:** fire sound, impact sound, recharge hum
- [ ] **Lab ambience:** machinery hum (L1), alarms + electrical buzzing (L2), rumbling (L3)
- [ ] **Footsteps** — different on metal vs concrete floors
- [ ] **Environment:** door opening, glass breaking, alarms, explosions

### Music
- [ ] **Level 1:** Calm, ambient, almost peaceful
- [ ] **Level 2:** Tense, horror — low drones, occasional stingers
- [ ] **Level 3:** Intense, action — driving beat, orchestral hits

### PA Announcement System
- [ ] Level 1 end: *"WARNING: Containment breach detected. Lockdown initiated."*
- [ ] Level 2: *"Failsafe protocol active. Structural demolition in T-minus 15 minutes."*
- [ ] Level 3: *"DEMOLITION SEQUENCE ENGAGED. EVACUATE IMMEDIATELY."*
- [ ] Play as audio clips triggered by game state changes

### Other UI
- [ ] **Credits screen** — list EVERY library, asset, tutorial, sound with licenses
- [ ] **Loading screen** with real progress bar (not just 100% instantly)
- [ ] **Level transition overlay screens** — brief text/card between levels
- [ ] **Options menu** — volume slider, mouse sensitivity

### Deployment (games that don't load get zero marks)
- [ ] Verify `vite.config.js` has `base: './'`
- [ ] Run `npm run build` to produce `dist/` folder
- [ ] Test the **BUILD** locally with `npx serve dist` (NOT the dev server)
- [ ] Play through ALL 3 levels in Chrome, check console for 404 errors
- [ ] Zip the `dist/` contents with `index.html` at the top level
- [ ] Upload to Moodle
- [ ] Open the published URL and play through in Chrome
- [ ] **NO** absolute paths (`/`) anywhere in the code
- [ ] All asset filenames lowercase, case matches code exactly

### Game Trailer
- [ ] Max 2 minutes, upload to YouTube
- [ ] Show all 3 levels, the monster, the chase, the boss fight
- [ ] Professional editing, music, pacing
- [ ] Must demonstrate the game in action

### Deadlines
- Sound effects can be added incrementally — start with ambience
- HUD should work before beta (mid-October)
- Trailer recorded after the game is polished
- **Deploy early and often** — get an empty scene on the LAMP server ASAP

---

## Quick Reference

| Question | Answer |
|---|---|
| How do I start? | `npm install` then `npm run dev` |
| Where do I work? | Your branch + your folder (see above) |
| How do I share my work? | Merge to `main` via pull request, at least daily |
| What are the units? | 1 unit = 1 metre. Corridors: 4m wide, 3m tall |
| How do I name files? | Lowercase, hyphen-separated, no spaces |
| When is beta? | 16 October 2026 |
| Where is the full plan? | [PLAN.md](./PLAN.md) |
