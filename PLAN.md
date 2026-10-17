# Containment Breach — Lab Facility
## CGV Group Project Plan

Current implementation reviewed on 15 October 2026. Status below describes the
working tree, including recent fixes; it does not certify a final submission.
Owner names record team responsibilities, rather than verified asset authorship.
The latest functional check passed 66 automated tests and the production build.
See [BUGFIX_CHECKS.md](./BUGFIX_CHECKS.md) for recent checks and
[ASSET_CREDITS.md](./ASSET_CREDITS.md) for asset evidence and unresolved attribution.

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

**Containment Breach** is a first-person / third-person 3D survival horror game set in a research lab facility. The player is an engineer sent to restore auxiliary power. The repair restarts a dangerous culture protocol, ruptures containment and exposes a scientist, transforming them into a monster. The engineer must escape the monster and the collapsing building.

### Three Levels — Each Genuinely Different

| Level | Theme | Challenge Type | Visual Identity | Custom Shader |
|---|---|---|---|---|
| **1 — The Experiment** | Clean lab, everything normal | Exploration — learn the facility, witness the breach | Cool white lighting, clean lab surfaces | — |
| **2 — The Hunt** | Damaged facility, two escaped creatures | Stealth, scientist rescue, pressure isolation and archive recovery | Amber hazard lighting, cool archive screens, green evacuation signs | **Heat shimmer** (time-driven noise overlay) |
| **3 — The Collapse** | Entity locks the surface seal | Boss fight + escape — dodge warned charges, shoot three cyan nodes, follow the released route | Red emergency lights, cool fill, cyan targets and green escape guidance | **Dissolve / noise** (time + escape progress driven) |

### Core Progression
```
Repair / Witness → Evade → Fight / Escape
```
Each level reuses the WASD movement controls but changes **what is being tested**.

### Story
An engineer answers a routine power fault in Lab A-2. Pulsing the amber relay restores power and resumes the scientist's culture experiment. Brief success turns into overload: the chamber cracks and ruptures, exposing the scientist and causing their transformation. An emergency bypass opens, and green floor lights guide the engineer to the control room. The facility's automated failsafe starts a controlled demolition to contain the threat; the remaining levels test evasion, combat and escape.

### Win Conditions
| Level | How You Win |
|---|---|
| **1** | Repair the amber relay, survive the breach and follow the emergency bypass to the control room |
| **2** | Release two scientists in medical and escort them north to refuge; isolate both pressure valves, recover experiment records from the east archive, then escape to the green core-access beacon |
| **3** | Start the west and east emergency generators, defeat the entity through three recovery openings, then cross the collapsing maintenance route and service bypass to the surface within 90 seconds |

### The Pulse Tool
The player carries an engineering pulse device — a handheld tool that fires energy bursts.
- **Level 1:** Activate terminals, open power couplings, interact with lab equipment
- **Level 2:** Override the blue entry relay, release the trapped scientists, isolate both amber pressure valves, power the archive and start the records download. Shots draw creatures to their origin; combat is reserved for Level 3.
- **Level 3:** The entity hunts before power is restored. Pulse both generators to disable its node shields, then shoot cyan nodes during recovery. One node can rupture per opening; amber charge and sweep warnings give time to dodge.

### Camera
- **First-person:** Eye-level view, maximum tension (stealth, shooting, precision)
- **Third-person:** Behind-the-player view, see the character model (exploration, awareness)
- Press **V** to toggle between views at any time
- Press **L** to toggle the flashlight; left click or **F** fires the pulse tool.
- The canvas minimap follows the player; **M** expands the whole-level map. It is a drawn plan view, not an orthographic 3D camera or security-camera feed.

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
├── audio/                 ← procedural Web Audio score, effects and alerts
├── assets/audio/          ← archived PA WAVs, unused by the current entry point
│
└── main.js                — entry point

public/
├── models/                — five Blender-exported props and a legacy Soldier GLB
├── assets/textures/       — menu-bg.png; environment textures are generated in code
└── licenses/              — installed library notices
```

### Key Design Decisions
- **1 unit = 1 metre** across the entire project
- **Corridor width:** 4m, **ceiling height:** 3m
- **Asset filenames:** lowercase, hyphen-separated, no spaces (`wall-panel-metal.png`)
- **No absolute paths** (`/assets/...`) — everything relative for LAMP server compatibility
- Release owned per-level resources on teardown; retain shared caches and persistent actors.
- Reuse vectors, geometry and particle pools in update loops to limit allocations.

### Controls

| Key | Action |
|---|---|
| W / A / S / D | Move forward / left / back / right |
| Arrow Left / Right | Turn camera left / right |
| Arrow Up / Down | Look up / down |
| Shift | Sprint (~11 m/s vs 6 m/s walk) |
| Space | Jump |
| C (hold) | Crouch |
| V | Toggle first-person / third-person camera |
| F or Left Click | Fire pulse tool |
| Right Mouse (hold) or Z (toggle) | Aim |
| L or T | Toggle flashlight |
| M | Expand/collapse map |
| U | Mute/unmute audio |
| Mouse (after click) | Free look (pointer lock) |
| Escape | Pause / Resume |

---

## 4. Rubric Alignment

### How Each Grading Category Is Addressed

Weights below match the supplied grading rubric and total **100%**. Examples in
the rubric apply as relevant; optional techniques are not all mandatory features.

| Category | Weight | Implemented evidence | Remaining work / limits |
|---|---|---|---|
| **Viewing** | 10% | Animated 3D scenes; first/third-person camera toggle; scientist player/NPC rigs; camera-mounted weapon; world props; minimap and expanded map. | Final animation/camera-clipping review. The map is a 2D canvas; no second 3D camera or picture-in-picture. |
| **Control & Playability** | 10% | Keyboard/mouse movement, sprint, jump, crouch, aim and pulse fire; Cannon gravity/collision; training; mission gates, health failure and timed escape failure. | Full human playthrough for difficulty, collision edge cases and useful vertical interaction. |
| **3D Effects** | 15% | Depth testing, multiple lights, soft shadows, smooth curved and hard-edged geometry, PBR normal/bump/roughness textures, static gradient skyboxes/environment reflections, fog, drifting smoke, bloom and tone mapping. | Renderer requests antialiasing, but the composer has no multisampling or AA pass. Glass is alpha-transparent, not refractive. No animated skybox or dynamic scene reflections. |
| **Shaders** | 10% | Custom vertex/fragment shaders for noisy heat shimmer, 3D value-noise dissolve with glowing edges, pulse/weak-point glow and screen grading/danger effects. Uniforms follow time, power, hits or collapse state as applicable. | Prepare explanations of attributes, varyings, uniforms, noise and discard. Heat shimmer is an overlay, not background refraction; no custom vertex-displacement effect. |
| **Gameplay & Experience** | 25% | Breach story, fleeing staff, two-creature hunt, scientist escort, records transfer, generator hazards, warned boss attacks and collapsing escape route; procedural music/effects and captioned PA alerts. | Human pacing, balance and listening review; replay routes/objectives are largely fixed. |
| **Polish** | 10% | Loading, menus, pause/current-level retry, briefings, higher guidance panel, map, saved volume/music/sensitivity settings, mute, victory/credits, static batching and resource cleanup. | Latest expanded levels need target Chrome/Ubuntu hardware checks. Refresh final package; verify hosting and resolve asset attribution. Debug FPS is development-only. |
| **Innovation** | 10% | Pulse tool used for repairs, rescue, records and combat; power-dependent lighting/shields; reactive staff; procedural models/textures/audio and gameplay-driven effects. Five Blender-exported prop GLBs are present. | Demonstrate original contributions. Custom Blender character/weapon GLBs, baked PBR image sets and sampled effects are absent; confirm prop authorship/source evidence. |
| **Game Trailer** | 10% | A 1:45 storyboard exists in [TRAILER_PLAN.md](./TRAILER_PLAN.md). | Capture, editing, final video of at most two minutes, upload and playback-link verification remain pending. |

---

## 5. Milestones & Timeline

### Alpha (Formative — Not for Marks)

Historical prototype milestones below; use the current tables for submission status.

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
| Talking points for each rubric category | Initial plan exists; rehearse the current implementation |
| **Playable from local dev server** | Done; department hosting is separate and unverified |

### Beta (Graded — 16 October 2026)

| Deliverable | Owner | Status |
|---|---|---|
| Full Level 1 geometry, training and breach | Mlungisi | Implemented; staff, room traversal and relay progression checked |
| Full Level 2 geometry, rescue and archive | Mlungisi | Implemented; escort routes, pressure gates and download completion checked |
| Full Level 3 arena, generators and extended escape | Mlungisi | Implemented; hazards, cover routing and escape checked |
| Blender prop models | Mlungisi | Five exports present; history/metadata recorded, authorship confirmation pending |
| Blender character and weapon models | Mlungisi | Absent; current characters and weapons are built in code |
| Monster AI system | Zandile | Implemented; collision-aware patrol, detection, pursuit and attack |
| Pulse tool | Zandile | Implemented; raycasts, energy, cooldown and mission interactions |
| Third-person camera + V toggle | Zandile | Implemented; animated coat avatar and held weapon |
| Win/lose and retry per level | Zandile | Implemented; mission gates, health failure and escape timeout |
| Level 2 stealth / second creature | Zandile + Mlungisi | Implemented; sightlines, crouch, hearing, search and ambush |
| Level 3 boss phases | Zandile + Mlungisi | Implemented; pre-power threat, shields, charges, recovery and final-phase sweep |
| PBR normal/roughness textures | Kutloano | Generated in code; no baked Blender image sets present |
| Heat shimmer | Kutloano | Implemented as animated noise overlay; background distortion remains absent |
| Dissolve shader | Kutloano | Implemented with 3D value noise, discard and animated edge glow |
| Pulse glow and trail | Kutloano | Implemented; custom glow shader and pooled soft sprite trail |
| Monster weak-point glow | Kutloano | Implemented; amber shields, cyan openings and hit feedback |
| Bump/normal surface detail | Kutloano | Normal maps on facility surfaces; bump maps on procedural creature/scientist materials |
| Skybox / reflections | Kutloano | Static generated cube backgrounds and environment-map reflections |
| HUD and map | Ronie | Implemented; health, energy, objectives, warnings, timer and M map |
| Effects, ambience and level music | Ronie | Implemented with Web Audio; final listening/balance review pending |
| PA alerts and captions | Ronie | Implemented as synthesized chimes/sirens and text; archived WAV dialogue is unused |
| Credits and license links | Ronie | Implemented in menu and ending; asset source confirmations remain pending |
| Loading and level briefings | Ronie | Implemented; initialization/model progress and fallback handling |
| Game trailer (max 2 min) | Ronie | Storyboard only; capture/edit/upload pending |
| **Department LAMP deployment** | Ronie | No verified published URL recorded; local subdirectory checks passed |

### Final (Graded — End of Teaching Term)

| Deliverable | Owner | Status |
|---|---|---|
| Final full human playthrough, visual polish and target-hardware check | All | Pending; automated checks do not replace this review |
| Devlog video | All | No deliverable recorded in repository |
| Post-processing (bloom, grade, vignette, danger pulse) | Kutloano | Implemented; dedicated antialiasing remains pending |
| Optional: local co-op mode | Zandile | Not implemented; outside the current feature set |
| Final LAMP deployment and refreshed submission ZIP | Ronie | Current CodeCrafters.zip prepared; final human playthrough, Moodle upload and published-URL verification pending |
| Individual contribution reports on Moodle | Each member | Submission status not recorded in repository |

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
- [x] Third-person camera rig + V key toggle
- [x] PulseTool.js (raycasting, energy, cooldown, fire)
- [x] MonsterAI.js (patrol, chase, attack state machine)
- [x] Level 2 stealth mechanic (detection range, chase trigger)
- [x] Level 3 boss fight logic (weak points, health, phases)
- [x] Win/lose trigger system per level
- [x] Automated integration and regression checks (see BUGFIX_CHECKS.md)
- [x] Local rendering/resource measurements (see PERFORMANCE_CHECKS.md)
- [ ] Final human playthrough and target-hardware performance profiling

### Mlungisi — Level Builder & Blender Models

- [x] Modular corridor/room geometry and prop builders
- [x] Level 1 — training, lab corridors, experiment room, control room
- [x] Level 2 — cover, patrol paths, rescue and archive
- [x] Level 3 — boss arena, generator rooms and extended collapsing escape
- [x] Project-built scientist/player rigs and procedural monster model
- [x] Five Blender-exported prop GLBs present (not a complete authored asset kit)
- [ ] Confirm prop authorship/source records; retain Blender source files if available
- [ ] Optional authored Blender character/weapon replacements (currently absent)
- [x] Scene graph hierarchy and independent animated rigs
- [x] Collision bodies for structural walls, blocking props and moving hazards
- [x] Shootable mission panels, valves, dummies and weak points

### Kutloano — Visuals & Shaders

- [x] Basic lighting presets (cool white, flickering amber, red emergency)
- [x] Heat-shimmer noise overlay with time-driven motion
- [x] Dissolve shader with 3D value noise and animated edge glow
- [x] Pulse projectile glow shader and soft sprite trail
- [x] Monster weak-point glow material and state-driven colour
- [x] Procedural PBR colour, normal and roughness maps
- [x] Character/creature bump detail and facility normal-map detail
- [x] Static generated skyboxes and environment-map reflections
- [x] Flickering/emergency lighting and lab power restoration
- [x] Shadow configuration and resource/performance safeguards
- [x] Post-processing bloom, grade, vignette and danger pulse
- [x] Textured dust and drifting, expanding smoke
- [ ] Antialiasing for the post-processing pipeline
- [ ] Optional background refraction / vertex displacement / animated skybox
- [ ] Rehearse shader explanations with visible gameplay examples

### Ronie — UI, Polish, Sound & Deployment

- [x] HUD: health, energy, objectives, warnings, timer and facility map
- [x] Procedural creature cues, footsteps and threat heartbeat
- [x] Pulse tool fire, impact and recharge audio
- [x] Level ambience and distinct procedural music
- [x] PA synthesized alerts and matching captions
- [x] Menu and ending credits with shipped library notices
- [ ] Confirm remaining asset/tutorial sources and update attribution
- [x] Loading progress and model-failure handling
- [x] Level briefing/transition overlays
- [x] Saved master/music volume, mute and mouse sensitivity options
- [ ] Game trailer (max 2 min, edited, YouTube upload)
- [ ] Devlog video (final submission only)
- [x] Relative Vite base and local production subdirectory checks
- [x] ZIP packaging script with a top-level index.html and portable paths
- [ ] Rebuild/package the final reviewed version and verify department hosting
- [ ] Final Chrome/Ubuntu path, performance and full-playthrough checks

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

Department hosting uses **Moodle archive upload**. SSH/SCP access is unavailable;
the department serves the uploaded static build and does not run npm or Vite.
See [DEPLOYMENT.md](./DEPLOYMENT.md) for the CodeCrafters walkthrough.

```powershell
# Build dist/ and package its contents with index.html at archive root.
npm run package

# Serve the production build beneath a group folder with exact-case checks.
npm run preview:deployment
# Open http://127.0.0.1:4174/group-game/ in Chrome.
```

Play through all three levels from that preview. Upload
`submission/CodeCrafters.zip` to the Moodle deployment activity, following its
exact filename convention. Use the course-provided published URL for the final
Chrome playthrough; the actual server address/group folder is not yet recorded.

### Pre-Flight Checks
- [x] Vite uses a relative base; runtime assets stay under the local group prefix
- [x] Current built assets load with exact filename case in the strict local preview
- [x] `index.html` at top level of CodeCrafters.zip; archive files match the build
- [ ] Complete human playthrough of the current production build
- [ ] Moodle archive uploaded and actual published URL verified
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
