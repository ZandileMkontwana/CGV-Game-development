# Credits — Reactor Station

This project mixes self-made Blender assets with open-source libraries. Every
shipped asset is credited below and in the in-game credits panel
(menu → CREDITS, fed from `src/core/AssetLibrary.js`).

## Blender models — CGV team (made for this project)

| Asset | Files | Notes |
|---|---|---|
| Prop models | `public/models/{console,locker,containment_tube,ceiling_light,pipe_run}.glb` | Authored in Blender, GLTF-binary export |
| Character models | `public/assets/models/{monster,scientist,engineer}.glb` | Rigged, named clips + gameplay anchors |
| Pulse rifle | `public/assets/models/pulse_rifle.glb` | First-person viewmodel |
| Prop kit exports | `public/assets/models/props/*.glb` | Canonical export location for all remaining props |

## Textures — CGV team (Blender bakes, made for this project)

`public/assets/textures/{lab,damaged,emergency}_{wall,floor,trim}_{col,nrm,rgh}.jpg`
— PBR channel sets per theme. Missing channels fall back to procedural bakes.

## Audio — CGV team (made for this project)

`public/assets/audio/{roar,spotted,jumpscare,attack,transform,alarm,death,door_open,collapse,win,gameover,growl}.{ogg|mp3}`
— sampled one-shot cues. Missing cues fall back to the Web Audio synth voices.

## Open-source libraries

| Library | Author | License |
|---|---|---|
| three.js | mrdoob & contributors | MIT |
| cannon-es | pmndrs | MIT |
| Vite | Evan You & Vite team | MIT |
| Soldier.glb (third-person operator fallback) | three.js examples | MIT — bundled with three.js |

## Procedural fallback art, levels & soundscape

CGV team (made for this project) — every model, texture and sound has a
procedural fallback so a checkout without the asset files remains fully
playable.

---

## Asset drop-in guide (for the team)

The manifest lives in `src/core/AssetLibrary.js`. Every file is **optional**:
missing files silently keep the procedural build.

- **Characters / rifle** → `public/assets/models/` as `monster.glb`,
  `scientist.glb`, `engineer.glb`, `pulse_rifle.glb`.
- **Props** → `public/assets/models/props/` named per builder:
  `console_desk`, `chair`, `server_rack`, `containment_tube`, `reactor_core`,
  `crate`, `barrel`, `cabinet`, `locker_bank`, `lab_bench`.
  Prop GLBs exported to `public/models/` (console, locker, containment_tube,
  ceiling_light, pipe_run) are picked up automatically through manifest
  aliases — canonical `assets/models/props/` exports take priority.
- **Textures** → `public/assets/textures/` as `{theme}_{role}_{col|nrm|rgh}.jpg`.
- **Audio** → `public/assets/audio/` as `{cue}.ogg` (preferred) or `.mp3`.

Export rules: glTF 2.0 binary, +Y up, metres, origin at the floor/feet,
models facing front view. Character clips must keep the exact names listed in
the model files (`MonsterModel.js`, `ScientistModel.js`, `OperatorModel.js`).
