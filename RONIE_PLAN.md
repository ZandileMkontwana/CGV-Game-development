# Ronie's work plan

Current status note — 15 October 2026: the dated progress entries below retain
the history of this work. For current completion and grading weights, use
[PLAN.md](./PLAN.md). The game now uses project-built coat rigs, current-level
retry, and synthesized PA chimes/sirens with captions. The old speech WAVs are
unused archives. A current `submission/CodeCrafters.zip` and strict production
subdirectory preview are prepared; see [DEPLOYMENT.md](./DEPLOYMENT.md).
Source confirmations, final human/Chrome-on-Ubuntu playtesting, Moodle upload,
verified department hosting and the finished trailer remain open; see
[ASSET_CREDITS.md](./ASSET_CREDITS.md).

Branch: `Ronie` (created from `main` on 14 October 2026).
Scope: UI, sound, credits, deployment, and trailer from `TASKS.md`.
Beta deadline in `PLAN.md`: 16 October 2026.

## Current progress — 14 October 2026

Implemented on `Ronie`: HUD ownership and reset behaviour, real asset loading,
credits and license links, saved volume/sensitivity options, captioned temporary
PA clips, procedural score/recharge audio, and level briefing cards. Restart
from pause now rebuilds Level 1. The Soldier model's filename is lowercase.

`npm run package` builds and creates `submission/containment-breach.zip` with
portable paths and a top-level `index.html`. Ronie has accepted the current
gameplay and audio review. Attribution, optimization, publishing and the trailer
remain before the final submission.

Automated Chrome integration checks passed, including missing-model fallback,
all level transitions, boss countdown, pause/resume, timeout/retry, and victory.
Timed gameplay/UI checks disabled per-frame rendering because software WebGL
was too slow on this host; they do not replace a normal playthrough. The
production menu, assets, options and credits also passed under `/group-game/`.
See `UI_CHECKS.md` for coverage and the remaining manual checklist.

Ronie reports that the game/UI work as intended, but the background sound for
different levels was hard to hear. The mix now uses sustained midrange notes,
distinct patterns in all three levels, and a separate saved Music & ambience
slider (default 80%). Music timing follows the audio clock, and rapid
pause/resume requests no longer risk leaving the AudioContext suspended.

Fixed a subsequent room-entry blocker: LevelKit was registering meshes for
cleanup without their collision bodies. Returning from other levels left
invisible obstacles in Level 1. Static props now register their bodies and
preserve their visual rotation; removing bodies also clears sync references.
Browser physics checks verified panel shooting, door traversal, room entry,
and the full Level 1 route to its win trigger after a pause/restart from Level 3.
`npm test` now provides five persistent collision/navigation regression tests.

Final-level movement follow-up: moved the central blocking pillar to the
perimeter, cleared the boss patrol lanes, widened the arena openings to 4 m
and escape corridor to 6 m, and moved escape rubble to the edges. The boss
now routes around static obstacles in Level 3 and requires line of sight to
attack. Physics checks passed for entering/circling the arena, the full boss
patrol, pursuit around both reactors and a pillar (including the faster phase),
and the timed escape through three corridor lanes to the victory trigger.

The final win now opens a dedicated congratulations screen. After five
seconds it automatically starts movie-style scrolling credits, using the same
attribution as the menu's Credits dialog. Players can pause/resume or skip the
roll; it finishes on a thank-you card with Play again and Main menu. Reduced
motion uses manually scrollable credits. Browser checks passed for the actual
exit trigger, automatic progression, resize, skip/replay/menu, timer cleanup,
and keyboard access. The ending stops gameplay and unnecessary 3D rendering.

Agreed next steps with Ronie:

- Gameplay and audio review: accepted by Ronie as done. This is user acceptance,
  separate from the scripted checks documented in `UI_CHECKS.md`.
- Asset attribution: Ronie will ask the relevant teammates using `ASSET_CREDITS.md`.
- Optimization: Codex's next work, with measured performance checks and preservation
  of the accepted gameplay. Use experienced game-design principles for subsequent
  improvements: clear feedback, readable spaces, fair encounters and deliberate pacing.
- Publishing and Moodle submission: Ronie will handle these after optimization.
- Trailer: deferred until the game is finished; `TRAILER_PLAN.md` provides the shot list.

Completed an optimization pass: static scenery batching reduced drawing calls
by 38–52% in three controlled scenes; level shaders now release on reload;
menus/pause avoid continuous 3D rendering; adaptive fallback keeps shadows
updating; and production hides debug displays. Nine regression tests, gameplay
flows, actual rendered frames and the production subdirectory check passed.
The build and ZIP are refreshed. Software graphics timings varied, so target
hardware FPS remains to be assessed. See `PERFORMANCE_CHECKS.md` for measurements
and verification limits. Asset attribution, publishing and trailer assignments
remain as agreed above.

Player-view follow-up: fixed the Soldier mixer starting Idle, Walk and Run at
full weight together. Locomotion now follows actual post-physics motion, so
stopping or pushing into a closed door returns to idle. Added a third-person
rifle with both arms posed to its grips, recoil and muzzle flash; it also works
with the procedural fallback. Pulse visuals now originate at the active gun's
muzzle while targeting remains aligned with the crosshair. The shoulder camera
leaves more space to see the weapon. Twelve regression tests, loaded-model and
fallback view checks, existing gameplay/UI checks and production verification
passed; build and ZIP refreshed. See `UI_CHECKS.md` for the verification scope.

Level 1 presentation and story pass: the engineer now enters Lab A-2 to restore
auxiliary power, rather than triggering the breach just by walking in. An amber
relay turns green after the repair; the chamber restarts, overloads and ruptures,
and the exposed scientist transforms. The emergency bypass opens automatically,
with green floor lights and signs guiding the route around the reactor to the
control room. Added a bespoke containment chamber, cleaner laboratory materials,
more restrained screen effects and lighting that changes with the story. Three
new captioned PA clips cover dispatch, restoration and evacuation. The monster's
weak points now follow its chest and shoulder joints, fixing the floating target
above its head while preserving the three-hit boss fight.

The opening phase tests bring `npm test` to fifteen passing checks. Chrome
integration verified a real repair shot, every phase, pause/resume, the physical
route through to Level 2, and a fresh reset without accumulated collision bodies.
Rendered frames were inspected, and the production build and submission ZIP
were refreshed. This first presentation pass establishes the direction for the
remaining levels.

Level 2 hunt pass: introduced a short sight-acquisition warning, a forward
vision arc, crouching benefits and pursuit of the last seen position. Firing
near the creature attracts it to the shot origin; staying unseen for four
seconds ends its search. Added taller locker and server-rack cover, obstacle
routing for patrol/chase, and navigation refresh when doors finish opening.
The blue entry relay leads into crew quarters; two amber pressure valves release
the server-room bypass. Local objectives, signs and evacuation captions explain
the route into core access after the surface lift fails. The creature cannot be
killed in this level; its three combat targets become available in Level 3.

Reworked damaged-sector materials and lighting to balance amber hazards against
cool archive screens. Lighting now sits inside the actual rooms rather than
around the world origin. Soft steam replaces square puffs; patrol footsteps and
a first-sighting cue with an occlusion check support the tension.

Eighteen persistent tests passed. Chrome checks completed Level 2 with live AI,
verified both valve shots and the sealed/released door, reached Level 3, and
reset without extra collision bodies. Cover sightlines, warning/search HUD,
pause, last-known-position behaviour, all nine patrol points and small-screen
warning layout passed. Level 1 opening and Level 3 movement/boss checks passed.
Rendered frames were reviewed; normal play remains the pacing/listening review.
That pass established the hunt's presentation and encounter pacing.

Crouch/recovery follow-up: replaced vertical model compression with articulated
knee bends, a lowered body and a small torso lean. The Soldier and procedural
fallback retain their proportions, planted feet and both weapon grips; moving
while crouched uses a shorter stride. Added four green first-aid cases in Level 2
and two around the Level 3 arena. Walking within 1.25 m restores up to 35 health,
once per case. Full health leaves a case available for later; a HUD notice and
sound confirm collection. Cases reset with the level and release their graphics
resources on teardown.

Made Level 2 easier to hide in: wider locker islands plus an additional cover
bank, a one-second acquisition window, 5 m crouched detection, 2.75 seconds to
end a search, slower investigation after losing sight, 4.3 m/s pursuit and
15-point attacks. Crouch movement increased from 50% to 60% of walking speed.
Nineteen regression tests passed. Real-model/fallback crouch, weapon handling,
finite/clamped healing and restart passed in Chrome. The live-AI cover route
reached Level 3, taking one 15-point hit and recovering at the maintenance
health pack. Cover sightlines, all nine patrol points and final-level movement
also passed. Rendered crouch frames were reviewed.

Level 3 presentation and encounter pass: the entity waits until arena entry,
then alternates pursuit, an amber charge warning, a locked charge and recovery.
Sidestepping avoids the locked destination; cover stops an obstructed charge.
Damage occurs during charges, with recovery after each successful node hit.
Exposed cyan chest/shoulder cores replace the hard-to-read targets inside dark
sockets. A compact HUD tracks all three nodes and warns when to dodge or aim.
Later phases increase pressure without the previous large speed/damage jumps.

Red emergency lights now occupy the arena itself, balanced by cool fill and
clearer surfaces. Protocol 09 signs and captions explain the biological surface
lock. Killing the entity releases a green route across the arena and stops its
remaining audio cues. The 90-second escape allowance remains; collapse visuals
start immediately and advance with both elapsed time and progress toward the
exit. Door removal also clears its camera occlusion. Congratulations and the
movie-style credits still follow the final escape. Flashlight toggle moved to
L, resolving its conflict with F firing; the menu lists both controls.

Twenty-one regression tests passed. Chrome verified safe entry, warning/locked
target, a real sidestep without damage, all three aimed pulse hits, node HUD,
recovery, door/route release, paused countdown and a physical escape to victory.
Separate checks verified a charge causing one 22-point hit, no warning/recovery
damage, cover protection, reset, small-screen HUD and flashlight controls.
Arena movement, patrol and pursuit around both reactors and a pillar passed;
Level 1 opening, Level 2 patrol and original UI flows passed. Rendered frames
were reviewed. Refresh the build for a normal three-level pacing/listening
review; asset attribution, publishing and trailer ownership remain as agreed.

Level 2 second-creature follow-up — 15 October 2026: a separate monster waits
inside the server room after both pressure valves release the door. Approaching
the fully open doorway triggers a roar, caption and sprint hint, with one second
to react before pursuit. The crew-quarter creature retains its original patrol.
The second creature routes around the server racks; the centre escape lane stays
clear. Both Level 2 creatures are survival threats, with combat still reserved
for Level 3. Navigation clearance is shared; each creature keeps its own path.

Twenty-three tests passed. Chrome verified real relay/valve shots, both live
creatures, normal-health sprint to Level 3, the second creature waiting/revealing,
pause during the reaction window, rack routing, real damage, safe lethal teardown
and restart without additional bodies or inactive shooting targets. The reveal
was rendered and inspected. The production build and submission ZIP are refreshed;
normal play remains the check for chase pacing and sound balance.

## Starting point before this work

These are the original source observations, retained for context.

- `src/ui/UIManager.js` is a placeholder, but `src/core/Game.js` already updates health, energy, objectives, stealth indicators, and the collapse timer.
- `src/audio/AudioManager.js` already provides procedural ambience, footsteps, heartbeat, monster sounds, pulse effects, and collapse sounds through Web Audio. Howler.js is not installed; decide whether recorded clips need it when adding audio.
- `src/core/GameState.js` already controls the main menu, pause menu, end screens, and a basic level transition overlay.
- The Credits button exists but has no click handler. No options menu was found.
- `Game.start()` immediately reports 100% loading. The operator model loads separately through `GLTFLoader`.
- `vite.config.js` already uses `base: './'`. The bundled model is named `Soldier.glb`; check naming and references before deployment.

## Task order

### 1. Establish a working build

- [x] Install dependencies if needed, run `npm run build`, and serve the production output locally with `npm run preview`.
- [ ] Check start, movement, shooting, camera toggle, pause, resume, restart, and menu return in Chrome.
- [x] Record console errors, failed asset requests, and any blockers for Ronie's work.

Done when: the production build launches and we have a clear baseline of working behaviour and problems to fix.

Build check on 14 October 2026: existing dependencies were available and `npm run build` passed. Preview is running at `http://127.0.0.1:4173/`. Vite reported a large JavaScript bundle and a menu background reference deferred to runtime; the production subdirectory check confirmed that the assets load. Automated browser checks had no unexpected runtime errors or failed requests. Normal three-level playtesting is still pending.

### 2. Finish HUD ownership and behaviour

- [x] Implement UIManager methods for health, energy, objectives, level indicator, and countdown.
- [x] Route the existing HUD updates through those methods in Game.js, keeping gameplay values and rules in the engine.
- [x] Verify damage, energy drain/recharge, objective changes, and the escape countdown through automated integration checks.
- [x] Verify HUD reset on restart and visibility during menus, pause, transitions, and end screens.

Done when: the HUD reflects gameplay correctly across all three levels and restarts.

### 3. Replace simulated loading

- [x] Connect the loading display to actual asset loading and initialization.
- [x] Handle model load failure visibly while preserving the existing fallback character.
- [x] Show the menu after required initialization finishes; verify with a deliberately delayed model request.

Done when: progress reports real loading work and startup does not hide asset failures.

### 4. Complete credits and options

- [ ] Inventory libraries and bundled assets, verify their sources/licenses, and record attribution as we add content.
- [x] Wire Credits to a readable screen with a working return button.
- [x] Add volume and mouse sensitivity settings accessible from the main and pause menus.
- [x] Connect settings to AudioManager and CameraController; save preferences locally and preserve mute behaviour.

The inventory and shipped library notices exist. Original art/model attribution and temporary voice distribution terms still need confirmation.

Done when: credits open and close correctly, settings take effect, and preferences survive a reload.

### 5. Complete sound and PA announcements

- [ ] Playtest existing sounds and identify missing cues or balance issues before adding replacements.
- [x] Add temporary spoken WAV PA clips for the breach, failsafe warning, and demolition sequence, with matching on-screen text.
- [ ] Check ambience/music for all three levels and fill the remaining pulse, environment, and footstep gaps.
- [x] Check pause, resume, restart, transition, volume, and mute through automated integration checks.
- [x] Keep new recorded audio in `src/assets/audio/` and disclose its provenance in credits.

Added a calm Level 1 melody, dissonant Level 2 tones over horror drones, Level 3 bass/beat, and pulse recharge hum. Music & ambience now has a separate volume control and a stronger midrange mix. Footstep timbre uses a per-level metal/concrete palette; actual floor-material detection is still a possible follow-up. Final listening/balance checks and any replacement voice recordings remain pending.

Done when: audio communicates danger and story events consistently without distracting from play.

### 6. Polish transitions and menu flows

- [x] Expand the existing transition overlay with level names and brief objective/story text.
- [x] Check text readability at 1280×800 and 640×480 and keyboard access to menu controls.
- [x] Verify start, pause, options, credits, retry, victory, and menu return through automated browser flows.
- [x] Add congratulations after the final escape, followed by movie-style credits and a thank-you card.

Done when: players understand the next objective and every menu flow works reliably.

### 7. Verify and package deployment

- [ ] Rebuild and play through all three levels from the production output in Chrome.
- [x] Check asset paths and filename case, including hosting from a subdirectory; resolve missing files and console errors.
- [x] Create the submission ZIP with `index.html` at the top level.
- [ ] Publish to the department server when its access details are available, then verify the published URL.
- [ ] Upload the verified submission to Moodle when access is available.

Done when: both the packaged build and hosted game work through all three levels.

### 8. Record the trailer

- [ ] Capture the experiment, chase/stealth, boss fight, and timed escape after the build is stable.
- [ ] Edit a trailer of at most two minutes using cleared music and readable titles.
- [ ] Upload to YouTube when account access is available and verify the playback link.

Done when: the trailer demonstrates the actual game and is ready to submit.

## Working approach

Complete one step at a time, checking its behaviour before moving on. Update this plan as work is verified. Keep changes focused on Ronie's scope; engine edits should support the UI and audio integration. Use small commits on `Ronie` as each step is finished.
