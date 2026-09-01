# Containment Breach — Lab Facility
## CGV Group Project Plan

---

## 1. Project Overview

| | |
|---|---|
| **Course** | Computer Graphics and Visualisation (COMS3025A / COMS3ee6A) |
| **Institution** | University of the Witwatersrand |
| **Team size** | 4 students |
| **Tech stack** | Three.js + Cannon-es (physics) + Vite, all in JavaScript |
| **Target** | Chrome on Ubuntu, hosted on the department LAMP server |
| **Repository** | https://github.com/ZandileMkontwana/CGV-Game-development |

---

## 2. Game Concept

**Containment Breach** is a first-person / third-person 3D survival horror game set in a research lab facility. A scientist's experiment to grow a creature goes wrong — the creature breaks free, bites the scientist, and mutates them into a monster. The player is an engineer trying to escape the monster and the collapsing building.

### Three Levels — Each Genuinely Different

| Level | Theme | Challenge Type | Visual Identity | Custom Shader |
|---|---|---|---|---|
| **1 — The Experiment** | Clean lab, everything normal | Exploration — learn the facility, witness the breach | Cool white lighting, clean lab surfaces | — |
| **2 — The Hunt** | Damaged facility, monster prowling | Stealth + evasion — avoid the monster, navigate damaged corridors | Flickering amber lights, heat distortion | **Heat-haze / ripple** (time + proximity driven) |
| **3 — The Collapse** | Building self-destructing, monster enraged | Boss fight + timed escape — defeat the monster, run for the exit | Red emergency lighting, pulsing, screen shake | **Dissolve / noise** (game-state driven) |

### Core Progression
```
Witness → Evade → Fight / Escape
```
Each level reuses the WASD movement controls but changes **what is being tested**.

### Story
A scientist is working in a research lab on an experiment to grow a creature in a containment tube. Something goes wrong — the creature breaks free and bites the scientist, mutating them into a monster. The facility's automated failsafe protocol activates, starting a controlled demolition to contain the threat. The player (an engineer) must escape the monster and the collapsing building.

### Win Conditions
| Level | How You Win |
|---|---|
| **1** | Reach the emergency control room before lockdown doors seal you in |
| **2** | Sneak past the patrolling monster and reach the emergency exit |
| **3** | Defeat the monster (shoot weak points), then sprint through the collapsing building to the exit |

### The Pulse Tool
The player carries an engineering pulse device — a handheld tool that fires energy bursts.
- **Level 1:** Activate terminals, open power couplings, interact with lab equipment
- **Level 2:** Disable malfunctioning hazards (shoot conduits to stop sparks, valves to stop steam)
- **Level 3:** Weapon — shoot the monster's glowing weak points, destroy security drones

### Camera
- **First-person:** Eye-level view, maximum tension (stealth, shooting, precision)
- **Third-person:** Behind-the-player view, see the character model (exploration, awareness)
- Press **V** to toggle between views at any time

---

## 3. Technical Architecture

### Folder Structure & Ownership

```
src/
├── core/                  ← Zandile (engine, controls, camera, physics, game state)
│   ├── Game.js            — main loop, renderer, orchestrator
│   ├── InputManager.js    — keyboard + mouse + pointer lock
│   ├── PlayerController.js — WASD movement, sprint, jump, physics body
│   ├── CameraController.js — FPS + third-person camera toggle, mouse look, screen shake
│   ├── PhysicsWorld.js    — cannon-es world, ground, body helpers
│   ├── GameState.js       — menu, pause, restart, level transitions, game over
│   ├── PulseTool.js       — raycasting, energy system, fire/cooldown logic
│   └── MonsterAI.js       — patrol, chase, attack state machine
│
├── levels/                ← Mlungisi (geometry, scene hierarchy, level content)
│   └── LevelManager.js    — builds and tears down levels, spawn points, props
│
├── shaders/               ← Kutloano (lighting, materials, custom GLSL)
│   └── ShaderManager.js   — per-level lighting, heat-haze shader, dissolve shader
│
├── ui/                    ← Ronie (HUD, menus, sound, credits, trailer, deployment)
│   └── UIManager.js       — HUD updates, sound triggers, credits screen
│
├── assets/                ← shared (models, textures, audio — credit everything)
│   ├── models/            — Blender exports (.glb)
│   ├── textures/
│   └── audio/
│
└── main.js                — entry point
```

### Key Design Decisions
- **1 unit = 1 metre** across the entire project
- **Corridor width:** 4m, **ceiling height:** 3m
- **Asset filenames:** lowercase, hyphen-separated, no spaces (`wall-panel-metal.png`)
- **No absolute paths** (`/assets/...`) — everything relative for LAMP server compatibility
- **Dispose everything** on level teardown to prevent GPU memory leaks
- **No per-frame allocations** — reuse vectors, materials, geometries

### Controls

| Key | Action |
|---|---|
| W / A / S / D | Move forward / left / back / right |
| Arrow Left / Right | Turn camera left / right |
| Arrow Up / Down | Look up / down |
| Shift | Sprint (~11 m/s vs 6 m/s walk) |
| Space | Jump |
| V | Toggle first-person / third-person camera |
| F or Left Click | Fire pulse tool |
| Mouse (after click) | Free look (pointer lock) |
| Escape | Pause / Resume |

---

## 4. Rubric Alignment

### How Each Grading Category Is Addressed

| Category | Weight | Implementation |
|---|---|---|
| **Viewing** | 10% | First-person + third-person camera toggle (V key). Camera follows player through the world. Animated character model visible in third person. Planned: minimap or security camera view. |
| **Control & Playability** | 25% | Smooth WASD + mouse controls. Sprint, jump, and shoot (pulse tool). Physics-based collisions. Three levels with distinct objectives (explore → evade → fight/escape). Monster AI creates dynamic encounters. Win/fail conditions per level. |
| **3D Effects** | 25% | Antialiasing, PCF soft shadow maps, multiple light sources per level, PBR metallic materials (roughness + metalness), fog (colour changes per level), ACES filmic tone mapping. Planned: bump/normal maps, skybox, reflections, procedural textures. |
| **Shaders** | 10% | Three custom GLSL shaders: (1) Heat-haze ripple — sin-wave UV distortion. (2) Dissolve/noise — 3D hash noise + edge glow. (3) Pulse projectile glow — energy bolt shader with trail. All time-driven and game-state-driven. |
| **Gameplay & Experience** | 25% | Three distinct levels with escalating tension. Story-driven (experiment gone wrong → monster hunt → building collapse). Monster AI creates dynamic stealth/chase encounters. Environmental storytelling through terminal logs and PA announcements. Sound design enhances immersion. |
| **Polish** | 10% | Main menu, pause menu, restart without page refresh. FPS counter. Loading screen. HUD with health, energy, objective, level indicator. Planned: options menu, sound settings, smooth transitions. |
| **Innovation** | 10% | Custom Blender models (player character, monster, scientist NPC, lab equipment). First/third-person toggle. Monster AI with patrol/chase/attack states. Pulse tool that evolves per level. Dynamic lighting shifts. Three custom shaders. |
| **Game Trailer** | 10% | Max 2 min YouTube video. Story progression (normal lab → monster hunt → collapse) makes compelling footage. Chase sequences and boss fight are trailer highlights. |

---

## 5. Milestones & Timeline

### Alpha (Formative — Not for Marks)

**Goal:** Show your mentor a running demo that communicates the final vision. Be ready to explain each rubric category.

| Deliverable | Status |
|---|---|
| Three.js running in browser | Done |
| Player movement (WASD + arrow keys + sprint + jump) | Done |
| First-person camera with mouse look | Done |
| Physics collisions (walls, ground) | Done |
| Level 1 corridor prototype (walkable station) | Done |
| Three lighting presets (cool / amber / red) | Done |
| Both custom shaders (basic versions) | Done |
| Menu system (start, pause, restart) | Done |
| Talking points for each rubric category | Done |
| **Deployed and playable from dev server** | Done |

### Beta (Graded — 16 October 2026)

| Deliverable | Owner | Status |
|---|---|---|
| Full Level 1 geometry (lab corridors, experiment room, control room) | Mlungisi | Not started |
| Full Level 2 geometry (damaged corridors, hiding spots, monster patrol paths) | Mlungisi | Not started |
| Full Level 3 geometry (boss arena, collapsing sections, escape route) | Mlungisi | Not started |
| Blender models: player character, monster, scientist NPC, lab equipment | Mlungisi | Not started |
| Monster AI system (patrol, chase, attack states) | Zandile | Not started |
| Pulse tool (raycasting, energy, cooldown, fire) | Zandile | Not started |
| Third-person camera rig + V key toggle | Zandile | Not started |
| Win/lose conditions per level | Zandile | Not started |
| Level 2 stealth mechanic (detection range, chase trigger) | Zandile + Mlungisi | Not started |
| Level 3 boss fight logic (weak points, health, phases) | Zandile + Mlungisi | Not started |
| PBR textures (diffuse, normal, roughness maps) | Kutloano | Not started |
| Refined heat-haze shader (proper UV distortion) | Kutloano | Not started |
| Refined dissolve shader (3D noise, edge glow) | Kutloano | Not started |
| Pulse projectile glow shader (energy bolt + trail) | Kutloano | Not started |
| Monster weak-point glow effects | Kutloano | Not started |
| Bump maps on lab surfaces | Kutloano | Not started |
| Skybox (lab interior / exterior) | Kutloano | Not started |
| HUD (health bar, energy bar, objective text, timer) | Ronie | Not started |
| Sound effects: monster (growls, footsteps, screams), lab ambience, pulse fire, collapse | Ronie | Not started |
| Music: calm (L1), tense/horror (L2), intense (L3) | Ronie | Not started |
| PA announcement system (countdown, warnings) | Ronie | Not started |
| Credits screen (all libraries, assets, licenses) | Ronie | Not started |
| Loading screen with real asset progress | Ronie | Not started |
| Game trailer (max 2 min, YouTube) | Ronie | Not started |
| **Deployed on LAMP server and verified** | Ronie | Not started |

### Final (Graded — End of Teaching Term)

| Deliverable | Owner | Status |
|---|---|---|
| All beta items polished and bug-free | All | — |
| Devlog video | All | Not started |
| Post-processing (bloom on reactor, vignette during collapse) | Kutloano | Not started |
| Optional: local co-op mode (shared keyboard) | Zandile | Not started |
| Final LAMP deployment verified | Ronie | Not started |
| Individual contribution reports on Moodle | Each member | Not started |

---

## 6. Task Assignments

### Zandile — Engine & Controls
- [x] Project scaffold (Vite + Three.js + cannon-es)
- [x] InputManager (keyboard + mouse + pointer lock)
- [x] PlayerController (WASD, sprint, jump, physics body)
- [x] CameraController (FPS camera, mouse look, arrow keys, screen shake)
- [x] PhysicsWorld (cannon-es, ground plane, body helpers)
- [x] GameState (menu, pause, restart, level transitions)
- [x] Game.js orchestrator (main loop, subsystem wiring)
- [x] Level 1 prototype corridors for alpha
- [ ] Third-person camera rig + V key toggle
- [ ] PulseTool.js (raycasting, energy, cooldown, fire)
- [ ] MonsterAI.js (patrol, chase, attack state machine)
- [ ] Level 2 stealth mechanic (detection range, chase trigger)
- [ ] Level 3 boss fight logic (weak points, health, phases)
- [ ] Win/lose trigger system per level
- [ ] Integration testing with teammates' code
- [ ] Performance profiling (Chrome DevTools)

### Mlungisi — Level Builder & Blender Models
- [ ] Modular corridor pieces (straight, T-junction, corner, room)
- [ ] Level 1 — clean lab corridors, experiment room, control room
- [ ] Level 2 — damaged corridors, hiding spots, monster patrol paths
- [ ] Level 3 — boss arena, collapsing sections, escape route
- [ ] Blender: player character model (engineer)
- [ ] Blender: monster model (mutated scientist)
- [ ] Blender: scientist NPC model (pre-mutation)
- [ ] Blender: lab equipment (containment tube, computers, consoles)
- [ ] Scene graph hierarchy (explainable parent-child relationships)
- [ ] Collision physics bodies for all walls/obstacles
- [ ] Shootable target markers (conduits, valves, boss weak points)

### Kutloano — Visuals & Shaders
- [x] Basic lighting presets (cool white, flickering amber, red emergency)
- [x] Basic heat-haze and dissolve shader stubs
- [ ] Refined heat-haze shader (proper sine-wave UV distortion, sampling)
- [ ] Refined dissolve shader (3D simplex noise, animated edge glow)
- [ ] Pulse projectile glow shader (energy bolt + trail)
- [ ] Monster weak-point glow material (emissive, pulsing)
- [ ] PBR materials with diffuse + normal + roughness maps
- [ ] Bump maps on lab walls and floors
- [ ] Skybox (lab interior / exterior)
- [ ] Flickering light animation (sin-driven intensity per frame)
- [ ] Shadow configuration (limit casters, constrain shadow camera)
- [ ] Post-processing (bloom, vignette during collapse) — final only

### Ronie — UI, Polish, Sound & Deployment
- [ ] HUD: health bar, energy bar, objective text, level timer
- [ ] Sound: monster (growls, footsteps, screams, heartbeat when near)
- [ ] Sound: pulse tool (fire, impact, recharge)
- [ ] Sound: ambience (lab hum L1, alarms L2, collapse L3)
- [ ] Music: calm (L1), tense/horror (L2), intense (L3)
- [ ] PA announcement system (failsafe countdown, warnings)
- [ ] Credits screen (all libraries, assets, tutorials, licenses)
- [ ] Loading screen with real progress tracking
- [ ] Level transition overlay screens
- [ ] Options menu (volume, sensitivity)
- [ ] Game trailer (max 2 min, edited, YouTube upload)
- [ ] Devlog video (final submission only)
- [ ] Vite build configuration verification (`base: './'`)
- [ ] LAMP server deployment (build → zip → upload → verify)
- [ ] Case-sensitivity and path testing on Linux

---

## 7. Collaboration Workflow

### Git Branching
```
main           ← always deployable
├── Zandile/  ← engine + controls
├── Mlungisi/  ← levels + geometry
├── Kutloano/  ← shaders + lighting
└── Ronie/  ← UI + sound + deploy
```
- Each person works on their own branch
- Merge into `main` via pull requests (at least one other person glances at it)
- Merge into `main` **daily** — integration issues caught early
- No pushing directly to `main`

### Conventions
- **Units:** 1 unit = 1 metre. Corridor: 4m wide, 3m tall.
- **Asset filenames:** all lowercase, hyphen-separated (`corridor-straight.glb`)
- **No `console.log` in main** — remove before merging
- **Credit as you go** — every downloaded asset goes into the credits doc immediately
- **File formats:** `.glb` for models, `.jpg` for textures (`.png` only if transparency needed)

### Communication
- WhatsApp group for quick questions
- GitHub Issues for tracking tasks and bugs

---

## 8. Deployment Checklist (Ronie)

```bash
# 1. Verify vite config has relative base
cat vite.config.js  # base: './'

# 2. Build
npm run build

# 3. Test the BUILD locally (not the dev server!)
npx serve dist

# 4. Play through ALL 3 levels in Chrome, check console for 404s

# 5. Zip the dist/ contents (index.html at top level)
cd dist && zip -r ../submission.zip . && cd ..

# 6. Upload to Moodle

# 7. Open published URL and play through in Chrome
#    (first upload often reveals path/case issues)
```

### Pre-Flight Checks
- [ ] No absolute paths (`/`) anywhere in code or markup
- [ ] Asset filenames match case used in code exactly
- [ ] `index.html` at top level of zip archive
- [ ] Frame rate acceptable on lab hardware
- [ ] Memory does not climb across three levels
- [ ] Trailer uploaded to YouTube, link submitted
- [ ] Devlog video submitted (final only)
- [ ] Every member submitted individual contribution report on Moodle

---

## 9. Performance Guidelines

From the project brief — these will be assessed:

- **Budget for lab hardware**, not your dev laptop
- **Textures:** scale down to smallest acceptable size, prefer power-of-two, compress PNGs to JPEGs
- **Triangle count:** reuse geometries and materials across objects
- **Create nothing per frame** — allocate vectors, materials, geometries once and reuse
- **Dispose what you remove** — call `.dispose()` on geometries, materials, textures when tearing down a level
- **Shadows:** limit which lights cast them, keep shadow map resolution sensible
- **Total download:** prefer `.glb` over `.gltf` + loose files, consider Draco compression
- **Loading screen:** prevents slow first load from looking like a crash
- **Profile rather than guess** — use Chrome DevTools Performance panel

---

## 10. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Lab hardware is slow | Lag → marks lost under Gameplay and Polish | Profile early, limit shadow casters, compress textures |
| LAMP server paths break | Blank screen on submission | Deploy early and often, all paths relative |
| Case-sensitive Linux filenames | Textures silently fail to load | Keep all filenames lowercase, verify in code |
| Memory leak across 3 levels | Tab crashes during marking | Dispose all GPU resources on level teardown |
| Scope creep | Not enough time to polish | Get all 3 levels playable at beta, polish after |
| Teammate unavailable | Their module is empty | Each person documents their API, others can step in |
| First deployment the night before | Discover all path issues at worst time | Deploy an empty scene to LAMP in week 1 |
