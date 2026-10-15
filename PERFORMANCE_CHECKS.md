# Rendering and resource optimization — 14 October 2026

Implemented on branch `Ronie`, following Ronie's acceptance of the existing
gameplay and audio and the agreement to optimize before publishing.

## Changes

- Opaque static kit scenery is merged by material, shadow properties and 12 m
  spatial cells. Transparent objects, doors, shootable panels, moving fans,
  heat-haze zones and dissolving walls remain separate. Original cover meshes
  retain their world transforms for camera/monster raycasts, and collision
  bodies remain unchanged. Frozen groups preserve unbatched child transforms.
- Merged geometry is disposed and original hierarchies restored at teardown.
  Containment specimen heads now use the shared geometry cache.
- Level-specific heat/dissolve shader materials are released on reload and
  menu/game-over/victory, preserving persistent pulse/weak-point materials.
- Loading/menu/end screens perform no continuous 3D rendering. Pause keeps
  the last gameplay frame, redraws once after resize, and level transitions
  prepare one frame behind their overlay. Switching away from the browser tab
  automatically pauses active gameplay.
- Adaptive resolution excludes startup/resume warm-up and isolated large
  timing spikes. Resize no longer repeats the composer's internal resize.
  Lowest-tier shadows refresh every 0.1 s instead of freezing permanently;
  each new level forces its initial shadow map to render.
- FPS and key debug displays are removed from production; development retains them.

The batching approach follows Three.js's [geometry-merging guidance](https://threejs.org/manual/pages/optimize-lots-of-objects.html).
The installed Three.js 0.170 source was inspected for raycasting, composer
resizing and shadow-map refresh behavior.

## Measurements

Headless Chrome on Windows, 1280×720 at DPR 1, software WebGL. A/B captures used
the same code and camera positions, comparing merged scenery with the batches
released. Bloom and automatic shadow updates were enabled in both variants.
Renderer statistics accumulated the full composer/shadow pipeline, with 10
warm-up frames followed by 16 sampled native browser animation frames.

| Scene | Drawing calls before | Drawing calls after | Reduction | Triangles before / after |
| --- | ---: | ---: | ---: | ---: |
| Level 1, z = −20.5 | 563 | 277 | 50.8% | 9,549 / 10,109 |
| Level 2, z = −15 | 640 | 307 | 52.0% | 11,965 / 12,621 |
| Level 3, z = −18 | 343 | 214 | 37.6% | 8,473 / 8,629 |

Coarser bounds render slightly more triangles while substantially reducing
separate drawing calls. Cells preserve some spatial culling rather than
combining the entire facility into one mesh.

In the final A/B run, median JavaScript render-submission times were
14.9→11.1 ms, 16.1→16.0 ms and 11.7→9.9 ms for Levels 1–3 respectively.
Browser frame intervals were 17.2→33.1 ms, 33.0→16.8 ms and 16.9→16.7 ms.
Other runs varied substantially. These short software-rendered samples do
not demonstrate a reliable FPS improvement on physical graphics hardware;
the repeatable finding is reduced drawing calls. Target Chrome/Ubuntu
performance should be assessed separately before publishing.

Before shader cleanup, visits through 1→2→3→1→2→3→1 retained
17→19→30→30→32→43→43 active shaders after an initial three-level pass,
including 33 obsolete dissolve materials at the end. After cleanup, visits
return to 4 shaders in Level 1, 6 in Level 2 and 15 in Level 3, with no old
dissolve materials outside Level 3.

## Validation

- `npm test`: nine passing collision, navigation, batching and resource-lifetime
  regressions, including cover raycasts, transformed geometry, transparent
  children, moving hazards and nested-hierarchy restoration.
- Chrome gameplay/UI checks: loading/fallback, settings/audio, shooting,
  damage, pause/restart, transitions, boss countdown, retry and victory.
- Physics checks: Level 1 panel/door/room traversal after restart; final-level
  arena movement, patrol, pursuit around cover, boss defeat and timed escape.
- Ending checks: automatic congratulations-to-credits, pause/resume, resize,
  completion, skip, replay, menu return and reduced-motion keyboard scrolling.
- Idle-render checks: zero drawing calls requested during repeated menu/pause
  ticks, one redraw after paused resize, and one transition preparation frame.
- Actual rendered frames in all three levels: initial shadow map exists after
  level load in the lowest fallback tier; periodic refresh requests continue.
  Captured optimized frames were visually inspected.
- `npm run package`: production build and refreshed
  `submission/containment-breach.zip`.
- Production subdirectory check under `/group-game/`: assets, menu credits and
  license links, settings persistence, no failed requests/runtime errors,
  no development handle or debug displays.

Functional gameplay checks used controlled simulation with per-frame rendering
disabled; rendering/performance checks above used actual rendered frames. They
are separate checks and do not represent a new full human playthrough.

Build notices remain for the JavaScript bundle size and the public menu image
reference, which resolves correctly in the tested subdirectory. The optimized
JavaScript bundle recorded for this pass was 866.42 kB (231.97 kB gzip); this pass
did not reduce startup download size. Subsequent player-presentation fixes add
an animated third-person rifle; the drawing-call comparisons above describe
the earlier optimization benchmark. Asset attribution, publishing and trailer ownership remain as
agreed in `RONIE_PLAN.md`.

Later Level 2 presentation work adds locker/rack cover and relocates the four
existing lighting-preset point lights into the playable rooms. The shadow-light
count is unchanged. New cover remains part of static scenery batching; steam
uses one shared procedural texture and the existing sprite pools. Navigation
rebuilds when a door finishes opening, rather than every frame. The drawing-call
and timing comparisons above describe the earlier optimization pass and are not
new Level 2 FPS measurements.

Health-pack follow-up adds four pickups to Level 2 and two to Level 3. Their
geometry/materials/textures release on teardown; they add no point lights or
shadow maps. The crouch pose uses leg IK while the stance is active, replacing
vertical scaling. The earlier drawing-call/FPS comparisons do not include these
later presentation and recovery changes.

Level 3's later encounter pass reuses the existing lighting budget and moves
the four preset point lights into the arena. One reusable floor guide marks
charges; two owned meshes mark the released escape route and are disposed on
level teardown. Target progress/warnings are DOM updates. Twenty-one tests,
actual rendered frames, charge/cover checks and the physical escape passed.
The earlier benchmark does not include this pass; no new target-GPU FPS claim
is made.

The 15 October Level 2 chase adds one persistent creature, active only after the
pressure door releases. It shares the existing static navigation grid with the
crew-quarter creature; pursuit paths remain separate. It adds an unshadowed
local aura light and creature geometry during that encounter. Restart reuses the
actor and retains the same physics-body count. Inactive second-creature meshes
are excluded from pulse targets. Twenty-three tests and Chrome chase, rack
routing, pause and cleanup checks passed. Earlier rendering benchmarks do not
include this additional creature; no new hardware FPS measurement is claimed.
