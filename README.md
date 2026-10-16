# Containment Breach — Getting Started

Containment Breach is a browser-based, first-person / third-person 3D survival horror game set in an underground research facility. You play the engineer called to restore power in Lab A-2, then survive the breach, rescue scientists, recover evidence, and escape the facility's collapse.

Built for the University of the Witwatersrand Computer Graphics and Visualisation group project (COMS3025A / COMS3ee6A) by **CodeCrafters**. The deployment target is **Chrome on Ubuntu**, served as a static website on the department LAMP server.

The npm package is named `reactor-station`; the game's display name is **Containment Breach**.

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Playing the game](#playing-the-game)
- [Controls](#controls)
- [Level objectives](#level-objectives)
- [Commands](#commands)
- [Production build and preview](#production-build-and-preview)
- [Packaging and deployment](#packaging-and-deployment)
- [Project structure](#project-structure)
- [Development workflow](#development-workflow)
- [Testing and release checks](#testing-and-release-checks)
- [Troubleshooting](#troubleshooting)
- [Current limitations and asset status](#current-limitations-and-asset-status)
- [Team, credits, and documentation](#team-credits-and-documentation)

## Requirements

| Requirement | Details |
| --- | --- |
| Node.js and npm | Node **22.x** is the documented setup baseline. Local verification used Node **22.23.2** and npm **10.9.8**. No Node version is pinned in this repository. |
| Git | Needed to clone the repository; alternatively, download and extract its source ZIP. |
| Browser | Desktop Chrome with **WebGL 2** available and hardware acceleration enabled. Target-hardware performance still requires verification. |
| Input | Keyboard and mouse. The current controls are designed for desktop play. |
| Internet | Required to clone and install npm dependencies. Runtime assets are served locally with the game. |
| Windows PowerShell | Required only for the supplied `npm run package` command, which invokes `powershell` and `npm.cmd`. |

Development, tests, and the Vite build can run on Windows, macOS, or Linux with suitable Node/npm installations. The supplied packaging script is Windows-specific.

There is no backend, database, login, API key, or required `.env` configuration. Node/npm are development tools; people opening a deployed game need only their browser.

## Quick start

Run these commands in a terminal:

```sh
git clone https://github.com/ZandileMkontwana/CGV-Game-development.git
cd CGV-Game-development
npm ci
npm run dev
```

If you already have this project, open a terminal in its root instead of cloning again. On this Windows workspace:

```powershell
cd C:\CGV-Game-development
npm ci
npm run dev
```

`npm ci` installs the exact dependency versions in `package-lock.json` and replaces an existing `node_modules/` installation. Use it for a fresh checkout or after pulling dependency changes.

Vite opens the browser automatically. The usual address is **http://localhost:5173/**; use the URL printed in your terminal if that port is occupied. Keep the terminal running while playing. Press **Ctrl+C** to stop the server.

Do not double-click `index.html`: the game must be served over HTTP/HTTPS so its modules and assets load correctly.

## Playing the game

1. Wait for initialization, then select **Start Game**.
2. Read the level briefing and select **Begin** (or use its keyboard continuation).
3. Click inside the game to capture the mouse for looking around. After resuming from pause, click inside again if necessary.
4. Follow the training prompts, objective text, signs, and glowing mission targets. The Pulse Tool activates equipment as well as firing at combat targets.
5. Use **M** to inspect the facility map and **Esc** to pause.

The HUD shows health, Pulse Tool energy, objectives, and a minimap. The expanded map shows the current level, mission targets, and escape guidance. Movement and threats continue while the map is open; pause separately when needed.

Pulse energy recharges between shots. Green first-aid cases in Levels 2 and 3 restore up to **35 health** when approached while injured; each case is usable once per level attempt.

**Options**, available from the main and pause menus, controls master volume, music/ambience volume, mouse sensitivity, and mute. Preferences are saved in browser local storage under `containment-breach-settings` when storage is available. Settings belong to the current browser and site origin; changing ports can give you a separate set of preferences. There is no persistent campaign save.

**Restart** and **Retry** reset the current level's objectives and encounters. Returning to the main menu and selecting **Start Game** starts at Level 1. Pausing freezes mission progress and the escape countdown; switching away from the browser tab also pauses active gameplay.

Completing the final escape opens a congratulations screen followed by scrolling credits. The ending offers credit controls, replay, and return to the main menu.

## Controls

| Input | Action |
| --- | --- |
| **W / A / S / D** | Move forward / left / backward / right |
| **Mouse** | Look around after clicking inside the game to capture the pointer |
| **Arrow keys** | Turn left/right and look up/down |
| **Left mouse button / F** | Fire the Pulse Tool |
| **Right mouse button** | Hold to aim |
| **Z** | Toggle aiming |
| **Shift** | Sprint; unavailable while crouching or aiming |
| **C** | Hold to crouch |
| **Space** | Jump |
| **E** | Open a nearby unlocked door; mission locks require their objectives or pulse relays |
| **V** | Toggle first-person / third-person camera |
| **T / L** | Toggle flashlight |
| **M** | Expand / close the facility map |
| **U** | Mute / unmute audio |
| **Esc** | Pause / resume gameplay; also releases the captured pointer when pausing |

Audio starts after user interaction because browsers restrict automatic audio playback. PA announcements use on-screen captions with synthesized alert sounds.

## Level objectives

This section contains progression spoilers. For the longer walkthrough, see [GAME.md](./GAME.md).

### Level 1 — The Experiment / I · Witness

- Complete the movement and shooting training, following the room prompts.
- Enter Lab A-2 and pulse the **amber auxiliary-power relay** to restart the equipment.
- Witness the containment failure and scientist transformation.
- Follow the released emergency bypass and green guidance to the **control room**. Pulse any marked conduit required along the route.

The Level 1 creature is a scripted threat and does not attack the player.

### Level 2 — The Hunt / II · The Hunt

- Pulse the **blue entry relay**, then cross into crew quarters.
- Find medical, pulse the **amber rescue relay**, and escort **both scientists** north into the green refuge. Stay within approximately **six metres** so they keep following.
- Pulse **both amber pressure valves** in maintenance. The server-room interlock requires the scientists to be safe as well as both valves isolated.
- Enter the archive east of the server room. Pulse its **power relay**, then its **evidence terminal**.
- Remain inside the glowing archive work area for the **12-second download**, until the HUD confirms **100%**. Leaving pauses the transfer while retaining progress.
- Evade the creatures and enter the green **core-access beacon** after the rescue and evidence objectives release the transfer door.

There are two creatures, including a server-room ambush. Use cover, crouching, and escape routes; firing attracts attention. Level 2 creatures cannot be killed, and **E** cannot bypass mission locks.

### Level 3 — The Collapse / III · The Collapse

- Pulse both emergency generator panels: **west pump gallery** and **east observation booth**. Watch the moving machinery and timed electrical floor; activating a generator disables its room's hazard.
- Avoid the entity while restoring power. Both generators must be active before its node shields can open.
- Dodge the warned charge, then shoot a **cyan chest or shoulder node during recovery**. Amber nodes are shielded. Destroy all **three nodes**, with one node available per recovery opening, and avoid the later sweeping attack.
- Defeating the entity releases the surface seal and starts a **90-second escape timer**.
- Follow the green route through maintenance, take the **eastern service bypass** around central rubble, and reach the surface exit. Avoid flashing amber ceiling-collapse warnings.

Health depletion causes failure. In Level 3, running out of escape time also causes failure. Retry restarts the level, including generators and the boss encounter.

## Commands

Run these from the repository root:

| Command | Purpose |
| --- | --- |
| `npm ci` | Install dependencies from the committed lockfile |
| `npm run dev` | Start Vite's development server with automatic browser opening |
| `npm test` | Run the regression suite through Node's built-in test runner |
| `npm run build` | Generate the production website in `dist/` |
| `npm run preview` | Serve the existing `dist/` build through Vite, usually on port **4173** |
| `npm run preview:deployment` | Serve `dist/` at **http://127.0.0.1:4174/group-game/** with strict deployment-style asset checks |
| `npm run package` | Build and create `submission/CodeCrafters.zip` using Windows PowerShell |

Preview commands do **not** rebuild the game. Run `npm run build` again after source changes. The repository has no configured lint or separate end-to-end browser-test command.

To select another development port:

```sh
npm run dev -- --port 5175
```

## Production build and preview

```sh
npm run build
npm run preview
```

Open the URL printed by Vite, usually **http://localhost:4173/**. This checks the bundled game rather than the development version.

Also check the game under a subdirectory before deployment:

```sh
npm run preview:deployment
```

Open **http://127.0.0.1:4174/group-game/**. This server serves only `dist/`, enforces exact filename case even on Windows, and rejects asset requests outside `/group-game/`. It catches errors that may only appear on the Linux department server.

To change its port in PowerShell:

```powershell
$env:DEPLOYMENT_PREVIEW_PORT = '4175'
npm run preview:deployment
```

Then open **http://127.0.0.1:4175/group-game/**. `DEPLOYMENT_PREVIEW_PORT` is optional and applies only to this preview script. Stop any preview you started with **Ctrl+C**.

## Packaging and deployment

On Windows, from the repository root:

```powershell
npm run package
```

This rebuilds `dist/` and creates or replaces **`submission/CodeCrafters.zip`**. An optional archive filename can be supplied directly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1 -ArchiveName CodeCrafters-review.zip
```

Archive filenames must end in `.zip` and contain no spaces or directory components. On macOS/Linux, run `npm run build`, then archive the **contents** of `dist/` with your ZIP tool; the supplied `npm run package` script requires Windows.

The archive must have `index.html` at its root, alongside `assets/`, `models/`, `licenses/`, and `favicon.svg`. Do not wrap these files in an extra `dist/` folder or include `node_modules/` and the source tree.

The department deployment workflow uses the course's **Moodle game deployment/archive activity**. Upload the built ZIP using that activity's filename and size requirements, save/finalize the submission as required, then verify the published game link. Node, npm, and Vite do not run on the department server.

The final published URL is not recorded in this repository. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full upload procedure and published-site checklist. Rebuild and repackage after any game change before uploading again.

## Project structure

```text
CGV-Game-development/
├── index.html                 # Page shell, menus, HUD markup, menu credits
├── package.json               # npm scripts and direct dependencies
├── package-lock.json          # Exact dependency resolution
├── vite.config.js             # Vite configuration; relative deployment base
├── src/
│   ├── main.js                # Entry point; creates and starts Game
│   ├── core/                  # Game loop, input, camera, physics, AI, missions
│   ├── levels/                # Facility geometry, props, hazards, level lifecycle
│   ├── shaders/               # Materials, lighting, textures, custom GLSL effects
│   ├── ui/                    # HUD, map, options, briefings, ending, styles
│   ├── audio/                 # Procedural Web Audio music, ambience, effects
│   └── assets/audio/          # Archived PA WAVs; unused by current gameplay
├── public/
│   ├── models/                # Facility prop GLBs and legacy soldier.glb
│   ├── assets/textures/       # Menu background image
│   ├── licenses/              # Shipped dependency notices
│   └── favicon.svg
├── scripts/                   # Packaging, deployment preview, archived PA generator
├── tests/                     # Node regression tests (*.test.js)
├── dist/                      # Generated production website; ignored by Git
└── submission/                # Generated deployment archives; ignored by Git
```

The runtime libraries are **Three.js** (`^0.170.0`) for rendering and **cannon-es** (`^0.20.0`) for physics. **Vite** (`^6.0.0`) handles development and production bundling. The lockfile determines the installed versions; UI and gameplay use JavaScript ES modules without a separate UI framework.

## Development workflow

1. Work in `src/`, `public/`, or the page/configuration files; use `npm run dev` for feedback.
2. For gameplay changes, run `npm test` and manually exercise the affected level, including pause and retry.
3. Build and inspect the production version before packaging. Development-only shortcuts can hide progression problems.
4. Check the strict subdirectory preview, then package when preparing a submission.

Useful entry points are `src/core/Game.js` for orchestration, `GameState.js` for lifecycle/retry, `PlayerController.js` and `CameraController.js` for movement/view, `src/levels/LevelManager.js` for level construction, `src/ui/UIManager.js` for display/options, and `src/audio/AudioManager.js` for sound.

The development server exposes `window.__game` in DevTools and enables **N** for next level and **1 / 2 / 3** for direct level selection during play. Production builds remove these shortcuts and debug displays.

Keep `vite.config.js`'s **`base: './'`** and use relative runtime asset URLs such as `models/locker.glb`. Public files are served without the `public/` prefix. Match filename case exactly, use lowercase names consistently, and keep new runtime assets in the build. Record asset sources and update credits when adding content.

Generated `node_modules/`, `dist/`, `submission/`, and ZIP archives are ignored by Git. Update and commit `package-lock.json` whenever intentionally changing npm dependencies.

## Testing and release checks

```sh
npm test
npm run build
```

On **16 October 2026**, the existing suite passed **66 tests**, and the production build succeeded using the Node/npm versions above. Tests cover areas including mission gates, archive download, retries, shooting, collision/navigation, boss logic, staff behaviour, map controls, and resource cleanup. These are regression checks; they do not certify a complete rendered playthrough.

The build currently reports a large JavaScript chunk and a menu-background reference deferred to runtime. Check that the image loads in the served production build; successful bundling alone does not verify runtime assets.

Before release:

- Play all three levels from the production build with normal health and no debug shortcuts.
- Check both camera views, aiming/shooting, crouching, the map, audio/options, pause/resume, death/retry, and the ending.
- Confirm scientist escort, archive **100%**, both generators, all three boss nodes, and the timed escape.
- Open browser DevTools (**F12**) and inspect Console and Network for errors or missing assets.
- Repeat the asset checks under `/group-game/` and verify performance on the intended Chrome/Ubuntu hardware.
- After upload, repeat the published-site checks and confirm the link works on another machine.

Detailed evidence and remaining manual checks are in [BUGFIX_CHECKS.md](./BUGFIX_CHECKS.md), [UI_CHECKS.md](./UI_CHECKS.md), and [PERFORMANCE_CHECKS.md](./PERFORMANCE_CHECKS.md).

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `node`, `npm`, or `git` is not recognized | Install the missing tool, reopen your terminal so PATH updates apply, and check `node --version`, `npm --version`, or `git --version`. |
| PowerShell blocks `npm.ps1` | Use `npm.cmd ci`, `npm.cmd run dev`, and the corresponding `npm.cmd` commands. This avoids changing the machine's execution policy. |
| `ENOENT` / cannot find `package.json` | Change into the repository root before running npm commands. |
| `vite` or another dependency is missing | Run `npm ci` from the root; ensure development dependencies are included. |
| `npm ci` reports a lockfile mismatch | Restore the matching committed package files. If you intentionally changed dependencies, run `npm install` and review/commit the updated lockfile. |
| Native Rollup/esbuild dependency errors after copying the project | Run `npm ci` on this machine instead of reusing `node_modules/` from another OS. |
| Port already in use | Use Vite's printed alternate URL or pass `--port`; for the strict deployment preview, set `DEPLOYMENT_PREVIEW_PORT`. |
| Blank screen when opening the HTML file | Use `npm run dev` or build and serve with a preview command. Avoid `file://` URLs. |
| Blank screen over HTTP | Inspect Console/Network. Confirm WebGL 2 availability and browser hardware acceleration, and check for missing JavaScript or asset requests. |
| Mouse does not look around | Select Begin, then click inside the game. Resume first if paused; click again to reacquire the pointer. Arrow keys also control the camera. |
| No audio or quiet ambience | Interact with Start/Begin, press U if muted, and check the browser/OS volume plus both volume sliders in Options. Spoken PA dialogue is not part of current playback. |
| Door remains locked | Follow the objective and pulse its marked relay. Level 2 gates also require rescue, pressure isolation, and archive completion; E only opens unlocked doors. |
| Archive download appears stuck | Return inside the glowing archive work area and remain until the HUD confirms 100%; leaving pauses progress. |
| Boss takes no damage | Start both generators, dodge its attack, then fire at cyan nodes during recovery. Amber nodes remain shielded. |
| Missing files after deployment | Check exact filename case, relative paths, archive contents, and `index.html` at the archive root. Test `/group-game/`, not the strict preview's server root. |
| Preview shows old gameplay | Rebuild `dist/`. For an uploaded game, repackage/reupload and hard-reload with Ctrl+Shift+R. |
| `npm run package` fails on macOS/Linux | Build normally and ZIP the contents of `dist/`, or use the supplied packaging script on Windows. |
| Low frame rate | Confirm hardware acceleration and the active GPU, close other GPU-heavy apps, and try a smaller browser window. See the performance notes; target-hardware FPS is not yet certified. |

When reporting a bug, include your OS/browser, game level, exact reproduction steps, whether you used development or production, and relevant Console/Network errors.

## Current limitations and asset status

- Full human production playthrough, target-hardware performance verification, Moodle publication, and the final hosted URL remain release checks; automated results do not establish these outcomes.
- Characters, weapons, environment textures, and the soundscape are largely generated in code. Five Blender-exported prop GLBs are used in the facility.
- `public/models/soldier.glb` remains as a legacy asset; current staff/player presentation uses project-built lab-coat rigs. Its presence does not mean it is the current player model.
- Optional entries in `src/core/AssetLibrary.js` do not establish that those files exist or load at startup. Custom character/weapon GLBs, authored PBR texture sets, recorded OGG/MP3 cues, and `.blend` source files are absent.
- PA WAVs under `src/assets/audio/` are source archives. Current gameplay uses synthesized chimes/sirens and captions. `scripts/generate-pa.ps1` is an optional Windows speech-generation utility, not a setup step.
- Some prop, legacy-model, and menu-image source/attribution details still need confirmation. See [ASSET_CREDITS.md](./ASSET_CREDITS.md) before describing asset authorship or redistribution terms.

## Team, credits, and documentation

| Team member | Responsibility |
| --- | --- |
| Zandile | Engine and controls |
| Mlungisi | Levels and models |
| Kutloano | Visuals and shaders |
| Ronie | UI, sound, and deployment |

These responsibilities do not establish authorship of every asset. [CREDITS.md](./CREDITS.md) records the current inventory and dependency credits. Library notices ship in [public/licenses/](./public/licenses/). No project-wide license file is present; dependency licenses do not license the entire game or its assets.

| Document | Purpose |
| --- | --- |
| [GAME.md](./GAME.md) | Story, controls, and detailed gameplay overview |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Packaging, Moodle deployment, and hosted verification |
| [PLAN.md](./PLAN.md) | Architecture, group responsibilities, and project plan |
| [TASKS.md](./TASKS.md) | Team task breakdown |
| [RONIE_PLAN.md](./RONIE_PLAN.md) | UI/audio/deployment work history and remaining tasks |
| [BUGFIX_CHECKS.md](./BUGFIX_CHECKS.md) | Regression and gameplay verification records |
| [UI_CHECKS.md](./UI_CHECKS.md) | UI, input, presentation, and browser check records |
| [PERFORMANCE_CHECKS.md](./PERFORMANCE_CHECKS.md) | Optimization measurements and verification limits |
| [ASSET_CREDITS.md](./ASSET_CREDITS.md) | Asset evidence and unresolved attribution |
| [CREDITS.md](./CREDITS.md) | Team, libraries, tools, and content credits |
| [TRAILER_PLAN.md](./TRAILER_PLAN.md) | Trailer shot list and preparation |
| [Audio README](./src/assets/audio/README.md) | Archived PA clips and their provenance |

Some planning documents retain historical observations. For onboarding, use this README's checked commands and the current source; consult the linked records for the scope and date of earlier checks.
