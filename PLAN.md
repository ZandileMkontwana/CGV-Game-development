# The Core — Reactor Station
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

**The Core** is a first-person 3D exploration/survival game set in an orbital reactor station. The player is an engineer navigating the facility as it progressively fails.

### Three Levels — Each Genuinely Different

| Level | Theme | Challenge Type | Visual Identity | Custom Shader |
|---|---|---|---|---|
| **1 — Exploration** | Pristine, fully operational station | Free exploration, learn the world | Cool white lighting, clean metallic surfaces | — |
| **2 — Failing Systems** | Station breaking down | Timing/survival — dodge coolant vents and rotating hazards | Flickering amber lights, heat distortion | **Heat-haze / ripple** (time + proximity driven) |
| **3 — Meltdown** | Reactor mid-meltdown | Boss confrontation — fight/escape a hostile core | Red emergency lighting, pulsing, screen shake | **Dissolve / noise** (game-state driven) |

### Core Progression
```
Exploration → Timing/Survival → Confrontation
```
Each level reuses the WASD movement controls but changes **what is being tested**.

---

## 3. Technical Architecture

### Folder Structure & Ownership

```
src/
├── core/                  ← Person A (engine, controls, camera, physics, game state)
│   ├── Game.js            — main loop, renderer, orchestrator
│   ├── InputManager.js    — keyboard + mouse + pointer lock
│   ├── PlayerController.js — WASD movement, sprint, jump, physics body
│   ├── CameraController.js — first-person camera, mouse look, arrow keys, screen shake
│   ├── PhysicsWorld.js    — cannon-es world, ground, body helpers
│   └── GameState.js       — menu, pause, restart, level transitions, game over
│
├── levels/                ← Person B (geometry, scene hierarchy, level content)
│   └── LevelManager.js    — builds and tears down levels, spawn points, props
│
├── shaders/               ← Person C (lighting, materials, custom GLSL)
│   └── ShaderManager.js   — per-level lighting, heat-haze shader, dissolve shader
│
├── ui/                    ← Person D (HUD, menus, sound, credits, trailer, deployment)
│   └── UIManager.js       — HUD updates, sound triggers, credits screen
│
├── assets/                ← shared (models, textures, audio — credit everything)
│   ├── models/
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
| Mouse (after click) | Free look (pointer lock) |
| Escape | Pause / Resume |

---

## 4. Rubric Alignment

### How Each Grading Category Is Addressed

| Category | Weight | Implementation |
|---|---|---|
| **Viewing** | 10% | First-person camera with mouse-look and arrow-key turning. Camera follows player through the world. Planned: minimap or picture-in-picture security camera view. |
| **Control & Playability** | 25% | Smooth WASD + mouse controls. Sprint and jump. Physics-based collisions. Three levels with distinct objectives (explore → survive → fight). Win/fail conditions per level. |
| **3D Effects** | 25% | Antialiasing, PCF soft shadow maps, multiple light sources per level, PBR metallic materials (roughness + metalness), fog (colour changes per level), ACES filmic tone mapping. Planned: bump/normal maps, skybox, reflections, procedural textures. |
| **Shaders** | 10% | Two custom GLSL shaders: (1) Heat-haze ripple — sin-wave UV distortion with `uTime` + `uIntensity` uniforms. (2) Dissolve/noise — 3D hash noise with `uDissolveAmount` + edge glow. Both are time-driven and game-state-driven. |
| **Gameplay & Experience** | 25% | Three distinct levels with escalating tension. Environmental storytelling (pristine → failing → meltdown). Lighting colour shifts tell the story. Sound design enhances immersion. |
| **Polish** | 10% | Main menu, pause menu, restart without page refresh. FPS counter. Loading screen. HUD with level indicator. Planned: options menu, sound settings, smooth transitions. |
| **Innovation** | 10% | Dynamic lighting that shifts per level. Two custom shaders integrated into gameplay (not bolted on). Environmental degradation as visual narrative. Planned: security camera second view, custom Blender models. |
| **Game Trailer** | 10% | Max 2 min YouTube video. Visual progression (clean → meltdown) makes compelling footage. Recorded after beta polish pass. |

---

## 5. Milestones & Timeline

### Alpha (Formative — Not for Marks)

**Goal:** Show your mentor a running demo that communicates the final vision. Be ready to explain each rubric category.

| Deliverable | Status |
|---|---|
| Three.js running in browser | ✅ Done |
| Player movement (WASD + arrow keys + sprint + jump) | ✅ Done |
| First-person camera with mouse look | ✅ Done |
| Physics collisions (walls, ground) | ✅ Done |
| Level 1 corridor prototype (walkable station) | ✅ Done |
| Three lighting presets (cool / amber / red) | ✅ Done |
| Both custom shaders (basic versions) | ✅ Done |
| Menu system (start, pause, restart) | ✅ Done |
| Talking points for each rubric category | ✅ Done |
| **Deployed and playable from dev server** | ✅ Done |

### Beta (Graded — ~3 weeks from brief)

| Deliverable | Owner | Status |
|---|---|---|
| Full Level 1 geometry (modular corridors, rooms, props) | Person B | Not started |
| Full Level 2 geometry (damaged corridors, hazards) | Person B | Not started |
| Full Level 3 geometry (boss arena, collapse) | Person B | Not started |
| PBR textures (diffuse, normal, roughness maps) | Person C | Not started |
| Refined heat-haze shader (proper UV distortion) | Person C | Not started |
| Refined dissolve shader (3D noise, edge glow) | Person C | Not started |
| Skybox (space through station windows) | Person C | Not started |
| Bump maps on station surfaces | Person C | Not started |
| HUD (health bar, objective text, timer) | Person D | Not started |
| Sound effects + ambient music (Howler.js) | Person D | Not started |
| Credits screen (all libraries, assets, licenses) | Person D | Not started |
| Loading screen with real asset progress | Person D | Not started |
| Level transition screens | Person D | Not started |
| Boss encounter logic (Level 3) | Person A + B | Not started |
| Win/lose conditions per level | Person A | Not started |
| Level 2 hazards (coolant vents, rotating blades) | Person A + B | Not started |
| Screen shake during Level 3 | Person A | ✅ Framework ready |
| Game trailer (max 2 min, YouTube) | Person D | Not started |
| **Deployed on LAMP server and verified** | Person D | Not started |

### Final (Graded — End of Teaching Term)

| Deliverable | Owner | Status |
|---|---|---|
| All beta items polished and bug-free | All | — |
| Devlog video | All | Not started |
| Custom Blender models (innovation) | Person B / C | Not started |
| Optional: multiplayer or networking (innovation) | TBD | Not started |
| Final LAMP deployment verified | Person D | Not started |
| Individual contribution reports on Moodle | Each member | Not started |

---

## 6. Task Assignments

### Person A — Engine & Controls
- [x] Project scaffold (Vite + Three.js + cannon-es)
- [x] InputManager (keyboard + mouse + pointer lock)
- [x] PlayerController (WASD, sprint, jump, physics body)
- [x] CameraController (FPS camera, mouse look, arrow keys, screen shake)
- [x] PhysicsWorld (cannon-es, ground plane, body helpers)
- [x] GameState (menu, pause, restart, level transitions)
- [x] Game.js orchestrator (main loop, subsystem wiring)
- [x] Level 1 prototype corridors for alpha
- [ ] Level 2 hazard mechanics (timed vents, rotating blades)
- [ ] Level 3 boss encounter (AI, health, destruction sequence)
- [ ] Win/lose trigger system per level
- [ ] Integration testing with teammates' code
- [ ] Performance profiling (Chrome DevTools)

### Person B — Level Builder
- [ ] Modular corridor pieces (straight, T-junction, corner, room)
- [ ] Level 1 — clean station corridors, control room, reactor hall
- [ ] Level 2 — damaged geometry, hazard placements, shader zone markers
- [ ] Level 3 — boss arena, collapsed sections, escape route
- [ ] Scene graph hierarchy (explainable parent-child relationships)
- [ ] Collision physics bodies for all walls/obstacles
- [ ] Props: control panels, pipes, doors, machinery
- [ ] Optional: custom Blender models for innovation marks

### Person C — Visuals & Shaders
- [x] Basic lighting presets (cool white, flickering amber, red emergency)
- [x] Basic heat-haze and dissolve shader stubs
- [ ] Refined heat-haze shader (proper sine-wave UV distortion, sampling)
- [ ] Refined dissolve shader (3D simplex noise, animated edge glow)
- [ ] PBR materials with diffuse + normal + roughness maps
- [ ] Bump maps on station walls and floors
- [ ] Skybox (space / station interior)
- [ ] Flickering light animation (sin-driven intensity per frame)
- [ ] Shadow configuration (limit casters, constrain shadow camera)
- [ ] Post-processing (bloom on reactor, vignette during meltdown)

### Person D — UI, Polish, Sound & Deployment
- [ ] HUD: health bar, objective text, level timer
- [ ] Sound effects: ambient station hum, alarms, sparks, meltdown SFX
- [ ] Music: calm (L1), tense (L2), intense (L3)
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
├── person-a/  ← engine + controls
├── person-b/  ← levels + geometry
├── person-c/  ← shaders + lighting
└── person-d/  ← UI + sound + deploy
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
- Discord/WhatsApp group for quick questions
- GitHub Issues for tracking tasks and bugs
- Daily 15-min standup (what did you do, what's next, are you blocked)
- Day 5 of each sprint: full integration session, everyone together

---

## 8. Deployment Checklist (Person D)

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
