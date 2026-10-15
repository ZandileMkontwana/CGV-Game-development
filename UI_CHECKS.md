# Ronie's UI validation

Checked on 14 October 2026 with local Chrome and temporary Playwright tooling.
No browser-test dependency was added to the game.

## Passed

- Production build and `npm run package`.
- Actual loading waits for a deliberately delayed model request; all six PA WAVs decode.
- Missing operator model shows an asset warning and keeps the procedural fallback playable.
- Credits open, Back/Escape close them, and the shipped license links load.
- Main-menu and pause-menu options connect volume, mute and mouse sensitivity to the game. Volume/sensitivity survive reload.
- Escape closes a pause-menu dialog without resuming the game underneath.
- Pulse key input drains energy and starts the recharge hum; energy recharges. Monster attack events update health and its accessibility value.
- Health, energy, level, objective, stealth warning and countdown displays update; pause/resume preserve gameplay values.
- Restarting from Level 2 while paused rebuilds Level 1, restores health/energy and clears old timer/phase/tutorial state.
- Level briefing cards show the correct objective and hide the HUD during transitions.
- Boss weak-point destruction starts the escape timer and demolition PA. Pause freezes both timer and AudioContext; timeout reaches Game Over; retry resets.
- Victory hides the HUD and retry rebuilds Level 1.
- Options fit a 640×480 viewport; menu/options visuals inspected at 1280×800.
- Production build loads under `/group-game/`, with no failed asset/license requests or unexpected runtime errors. No development debug handle is shipped.
- ZIP contains top-level `index.html` and forward-slash asset entries for extraction on Ubuntu.

## Background audio follow-up

Ronie reported that the gameplay/UI work but the level backgrounds were hard
to hear. The revised score has sustained midrange notes, stronger harmonics,
and a distinct pattern in each level. A separate saved Music & ambience
slider controls the score/ambient bed without changing effects or PA volume.
Score timing uses the audio clock rather than capped game delta time; audio
state changes are serialized to handle rapid pause/resume.

Offline Chrome renders of each profile's opening pattern, measured through a
180 Hz high-pass filter to approximate limited bass reproduction, showed about
6.8 dB, 9.9 dB and 4.2 dB more signal than the previous mix for Levels 1–3.
Those rendered samples did not clip. This is a signal comparison, not a
listening test on Ronie's speakers or a full-mix peak guarantee.

Live browser checks verified a nonzero background signal in each level,
independent music/master controls, stored preference migration/persistence,
and a running AudioContext after repeated rapid pause/resume. Ronie should
listen to the refreshed build to confirm the balance on the actual device.

The timed engine/UI checks ran against the actual game with per-frame rendering
disabled after startup because headless software WebGL was too slow. Level
progression and boss/damage events were triggered programmatically where
needed. These checks cover integration and state handling, not a normal
movement/stealth/combat playthrough or subjective audio quality.

## Room-entry collision follow-up

Ronie reported getting stuck in Level 1 after shooting a panel. Investigation
found that LevelKit registered visual meshes but omitted their collision bodies
from level cleanup. After visiting Levels 2 and 3, an invisible Level 3 column
blocked the Level 1 laboratory entrance. The panel-linked door itself opened
and was passable in the isolated door check.

Before the fix, teardown left 62 bodies instead of the 3 permanent bodies,
and returning to Level 1 accumulated 233 bodies. The player stopped at the
invisible column around z = -19.3. After the fix, teardown leaves 3 bodies,
Level 1 consistently has 63 bodies, and the laboratory passage is clear.

Kit props now track their collision bodies and avoid unnecessary static-body
sync that erased visual rotations. Body removal clears sync references;
moving doors mark their collision bounds dirty before the next physics step.

`npm test` passes two persistent regression checks for obstacle removal and
static prop rotation. Browser checks used an actual panel raycast and player
controller/physics simulation to cross the opened door on a fresh load and
after restarting from Level 3. A waypoint-driven route through Level 1 reached
the control-room win trigger and advanced to Level 2. Rendering was disabled
for those physics checks; Ronie should refresh the production preview and
confirm the previously blocked route during normal play.

## Final-level geometry and boss movement follow-up

Ronie reported a blocked arena/corridor and a monster that could not move.
Fresh-level physics checks reproduced the main approach stopping at the
central pillar (z ≈ -19.3), and a chasing boss stopping at a reactor more
than five metres from the player. In the isolated baseline check, the escape
door opened after boss defeat and the centre corridor route reached victory.

Changes:

- Moved the central pillar to the arena edge and adjusted props/patrol waypoints to leave connected movement lanes.
- Widened arena entry/exit openings from 2.6 m to 4 m, the escape corridor from 4 m to 6 m, and the exit-room doorway to match. Updated floors, ceilings, wall segments and dissolve panels together.
- Moved escape rubble and loose panels to the edges, keeping a clear central sprint lane.
- Added a Level 3 navigation grid from actual static collider bounds, expanded for the boss's footprint. Patrol/chase routes replan around cover; attack requires line of sight.

`npm test` passes five collision/navigation checks, including blocked routes,
valid clearance and physical traversal at normal/enraged speeds. Browser
checks passed for the actual player controller entering and circling the
arena, all four patrol waypoints, and the boss reaching attack range around
both reactors and a pillar. The faster phase also reached its target.

The seal blocked traversal before boss defeat. After weak-point destruction
and the death animation, the body was removed and the player passed through
the centre and both adjacent corridor lanes. The centre escape had about
87 seconds remaining on the 90-second countdown and reached victory.
These were controlled physics/AI checks with rendering disabled, not a
recorded normal playthrough. Build/package and existing UI/end-screen checks
also passed; refresh the preview to review the revised layout during play.

## Congratulations and movie-style ending credits

Winning the final level now shows a separate congratulations card, then starts
the credit roll automatically after five seconds. It reuses the menu credit
content, preserving team roles, library notices and the disclosed attribution
gaps. Pause/resume and Skip credits remain available; the final thank-you card
offers Play again and Main menu. Escape advances/skips the ending, then returns
to the menu from the thank-you card. Reduced motion displays static credits in
a keyboard-scrollable viewport with a Finish credits button.

Automated Chrome checks passed for:

- The actual final exit trigger opening congratulations, with gameplay HUD and game-over overlay hidden.
- Automatic progression after five seconds, and immediate Watch credits.
- Shared team/asset content, upward animation, pause/resume and preserved position after viewport resize.
- The animation finish handler opening the thank-you card; Play again rebuilding Level 1.
- Skip, menu return and the original menu Credits dialog remaining functional.
- Leaving congratulations cancelling its timer, without reopening credits later.
- Reduced-motion manual keyboard scrolling and Escape navigation.
- Screenshots reviewed at 1280×800 and 640×480, with no runtime errors or failed asset requests.

Gameplay rendering was disabled for scripted trigger checks on this software
WebGL host. The actual ending uses DOM animation and stops 3D rendering while
visible. The animation was advanced to its completion for the finish-handler
check; a full real-time credit roll remains part of manual review.

## Optimization follow-up

Ronie accepted the gameplay and audio review as done. A subsequent optimization
pass passed nine regression tests, the existing UI/audio and gameplay checks,
the cinematic ending checks, and production subdirectory verification. Menus
and pause avoid continuous scene rendering; actual rendered checks verified
shadow-map creation and periodic updates at the lowest fallback tier. Captured
frames were reviewed. `PERFORMANCE_CHECKS.md` records drawing-call reductions
and the limits of software-graphics timings; target hardware performance
remains a separate review before publishing.

## Player idle animation and third-person weapon follow-up

Ronie reported that the legs continued walking while stationary after switching
views, and that the third-person body had no gun. Inspection reproduced Idle,
Walk and Run all contributing at full weight immediately after model loading.
The loaded Soldier model had no weapon, and PulseTool animated shots from the
camera origin.

Changes:

- Initialize only Idle at full weight; crossfade locomotion after actual
  post-physics movement checks. A blocked movement key no longer animates a walk.
- Add a visible third-person copy of the existing project-built rifle. Arm
  posing keeps wrists at its grips while turning, aiming and crouching; the
  procedural engineer fallback also carries it and faces the movement direction.
- Use each view's weapon muzzle for the pulse origin and flash, preserving
  camera/crosshair hit targeting. Clear old pulse effects on level changes.
- Move body animation/weapon synchronization before firing and slightly widen
  the shoulder camera offset to show the held weapon.

`npm test` passes twelve regression tests. New checks cover startup/return to
idle after rapid locomotion changes, arm reach under crouch scaling, and
offset-muzzle visuals with unchanged crosshair hits. Chrome checks loaded the
actual Soldier asset, verified idle/walk/run/stop weights, pushed into a closed
door, switched using V, and checked first-person/third-person/fallback visibility
and muzzle positions. Turning/aiming/crouching grip checks passed; third-person
and side-view rendered screenshots were inspected.

Existing loading/settings/audio/pause/restart/boss-countdown/victory checks and
final-level physics checks also passed. The production subdirectory check and
refreshed build/ZIP passed. Scripted gameplay checks used fixed simulation steps
with continuous rendering disabled; screenshot checks rendered actual frames.
Review the revised player presentation during normal play after refreshing.

## Level 1 repair and containment opening

The opening now waits for a repair shot on the amber relay beside the chamber.
Walking into the lab only updates the objective. Repair briefly restores power,
then the chamber overloads, cracks and ruptures; the scientist transforms and the
emergency bypass releases. Green floor lights continue through the left reactor
lane to the control room. Updated the menu story, briefing, chamber labels and
three new PA captions to match. Laboratory materials have less surface noise;
Level 1 uses lighter grain and colour fringing than the later levels.

Fifteen persistent regression tests passed, including single-use repair, ordered
story phases and an evacuation timeout. A Chrome integration check walked from
reception into the lab using the actual player physics, fired the tool at the
relay, verified each phase, paused the overload and resumed it, and walked the
green route into Level 2. Restart restored the sealed door, hidden route and
standby chamber without increasing collision-body count. Actual frames of the
reception, chamber and breach were rendered and inspected. Gameplay simulation
used fixed steps with continuous rendering disabled on the software WebGL host.
The monster's three targets now follow its animated chest and shoulders. Actual
pulse raycasts from the creature's front destroyed all three and reduced boss
health from three to zero. Final-level movement, pursuit and escape checks still
passed. Review the timing, sounds and visual focus during a normal fresh
playthrough.

## Level 2 hunt, pressure lock and evacuation

The blue entry relay leads into crew quarters with two additional tall locker
islands. The creature has a forward sight arc, a 0.65-second acquisition warning,
and a smaller detection range while the player crouches. Behind cover it follows
the last seen position and searches for four seconds; shots within 14 metres
give away their origin. Its weak points are unavailable in Level 2. Both amber
valves in maintenance must be isolated to release the server-room pressure door.
The server room has two rack islands and green evacuation signs leading toward
core access. Captions explain the unavailable surface lift and the retained
culture archive. These new facility status messages are captions; the existing
six spoken PA clips remain in use.

Lighting now follows room coordinates, with amber pressure hazards and cool
archive screens. Soft particles replace square steam puffs and small additive
sparks replace large bright blocks. Moving patrols have footstep cues. The
first-sighting sting checks camera line of sight before playing.

Eighteen regression tests passed. Chrome integration checked:

- A complete physics walkthrough with live AI, real blue-relay and amber-valve
  shots, a door that stays sealed after one valve, and transfer into Level 3.
  The tested route took one 18-point hit before escaping; it used normal health.
- The released door leaving both collision and navigation, with every one of
  the extended nine patrol waypoints reachable around the new cover.
- Actual locker sightlines, acquisition warning, an unchanged last-seen target
  after hiding, search timeout, pause/resume and an indestructible Level 2 threat.
- Restart restoring active vents, sealed pressure door and the same body count.
- No premature sting through the sealed entry door and a fitting warning at
  640 x 480. Actual crew-quarter and pressure-corridor frames were reviewed.
- Existing menu/loading/settings/audio flows, the Level 1 opening and actual
  boss raycasts, plus Level 3 movement/pursuit/escape.

Simulation checks used fixed steps with continuous rendering disabled; visual
checks rendered actual frames. Review pacing, footstep audibility and pressure
valve targeting during normal play. The new route was not timed on target GPU
hardware.

## Articulated crouch, first aid and easier hiding

The crouch no longer changes either character model's vertical scale. A pose
overlay lowers the body, leans the torso and solves bent legs toward the animated
foot placements. Both gun grips follow the lower stance. Loaded-model checks
measured about 46 cm of head-height reduction, unit model scale, planted-foot
errors below 0.0001 m and grip errors below 0.0001 m. Standing restored the
original height; fallback crouch and first-person/third-person weapon switching
passed. Shoulder and side-view frames were rendered and inspected.

Four Level 2 health packs sit by crew cover, the maintenance lock, server cover
and the final corridor. Two more sit at opposite sides of the Level 3 arena.
Green cases automatically restore up to 35 health within 1.25 m, once per case;
full-health players do not consume them. Chrome checks walked to a case with
50 health, received 35, verified the collection notice and hidden case, and
confirmed no repeat healing. Another case remained at 100 health, then healed
90 to 100 without exceeding the cap. Restart restored all four Level 2 cases.

Level 2 now uses a 1-second sight-acquisition window, 5 m crouched detection,
2.75-second search timeout, slower investigation after losing sight, 4.3 m/s
pursuit and 15-point attacks. Locker islands are wider and an additional bank
provides cover. Crouch movement is 60% of normal walking speed. The physical
route using crew cover reached Level 3 with live AI: one 15-point hit was healed
by the maintenance case. Going straight into the creature can still block a
player; the revised path uses cover to avoid that contact. All nine patrol
waypoints and the existing final-level movement/escape checks passed.

An attack ending the game now stops the current simulation update before it
can access the torn-down level. A lethal Level 2 attack reached Game Over and
disposed its health packs without a runtime exception. `npm test` passes
nineteen checks, including a crouch regression covering metre- and centimetre-
scale rigs, limb lengths, planted feet, unchanged proportions and restoration.

Simulation checks used fixed steps with continuous rendering disabled. Review
the revised crouch and recovery balance during normal play after refreshing.

## Level 3 boss rhythm, target clarity and final escape

The creature waits until the player enters the arena (or damages a node).
Combat alternates pursuit, a 0.85-second amber wind-up, a charge toward the
locked destination and 1.4 seconds of recovery. The warning line marks the
charge path; sidestepping does not move the destination. A blocked path ends
the charge. Normal pursuit stops at a readable distance once it has a clear
route. Hits on the three exposed cyan nodes interrupt the creature and enter
recovery. The HUD tracks chest/right/left nodes and provides charge/aim cues.
The first charge deals 22 damage; subsequent nodes increase damage/speed modestly.

Changed lighting/materials to separate red warnings, cyan targets and green
evacuation guidance. The dark socket no longer encloses the shoulder nodes;
compact shader cores preserve forgiving hit spheres. Added signs and facility
captions explaining the biological surface seal. These new captions are not
additional spoken PA assets. Defeat lights the route across the arena, removes
the seal from physics and camera occlusion, and stops creature cues. Collapse
starts visibly and advances with time and exit progress. The countdown still
starts at 90 seconds. Flashlight now uses L; F remains a firing key.

Twenty-one persistent tests passed. Chrome integration verified:

- Waiting safely in the entry, walking into the arena, seeing a warning before
  damage and sidestepping the actual locked charge at normal health.
- A recovery opportunity, three aimed pulse raycasts removing the three nodes,
  HUD completion, the released door/green route and hidden combat panel.
- Pausing/freezing the countdown, moving through the arena and corridor,
  increasing collapse effects and reaching the actual victory trigger.
- A stationary player receiving exactly one 22-point charge hit, with no damage
  during warning or recovery; reactor cover ending a charge without damage.
- Fresh reset restoring three nodes, hidden guides/route and waiting state;
  fitting HUD at 640 x 480; F firing retaining the flashlight and L toggling it.
- Existing arena circulation, every patrol point, pursuit around both reactors
  and a pillar in initial/later phases, and three escape lanes.
- Level 1 opening/actual boss targeting, Level 2 patrol and UI/audio/menu flows.

Entry, warning, recovery, exposed targets and the released escape route were
rendered and inspected. Gameplay checks used fixed steps with continuous
rendering disabled on software WebGL; they do not establish target hardware FPS
or replace a normal human playthrough. The build and ZIP are refreshed for that
review.

## Level 2 second creature — 15 October 2026

Both pressure valves now release a separate creature waiting on the right inside
the server room. It remains still until the door is fully open and the player
approaches the threshold. A roar, facility caption and Shift sprint hint give a
one-second reaction window before pursuit. The original crew-quarter patrol is
preserved. The second creature uses cover-aware pursuit at 5.6 m/s, below player
sprint speed, with 16-point attacks. It has no killable targets in this level.

Twenty-three persistent tests passed. Chrome checks verified:

- A complete physical route with both live creatures, actual entry/valve shots,
  a sealed door after one valve and a sprint to the Level 3 transition. Normal
  health took a 15-point hit near maintenance and recovered at the existing case.
- A separate creature waiting behind the released door, a warning at the
  threshold, no movement during the reaction window and frozen pause timing.
- Pursuit around server-rack cover and actual attacks when the player stays;
  a lethal hit reaching Game Over safely and both restart/transition cleanup.
- Shared navigation clearance with separate actor paths, unchanged body count
  after reload and no inactive second-creature meshes in the pulse target list.

The actual reveal frame was rendered and inspected. Simulation used fixed steps
with continuous software WebGL rendering disabled. These checks do not measure
target hardware FPS or replace a normal playthrough. Build and ZIP are refreshed.

## Review checklist

The gameplay/audio checks below were accepted by Ronie. Keep them available
when reviewing later changes; asset attribution and hosted-build checks remain
outstanding as agreed.

Open `http://127.0.0.1:4173/` while the preview is running. To start it again:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

- Play through all three levels with normal movement, mouse look, camera toggle, shooting, hiding and escape.
- Listen for clear PA speech over ambience; check master volume and mute.
- Check footsteps, monster proximity heartbeat, shots, recharge and collapse sounds for useful volume balance.
- Try pause, Options, resume, restart, game over, retry, victory and menu return.
- After the final escape, watch congratulations and the full credits, then try Play again; also check Pause credits and Skip credits.
- Watch for overlapping HUD text at your usual screen size.
- Keep Chrome's Console open and report red errors or missing requests.
- Confirm the menu art/model attribution and final audio provenance before submission.
- Verify the department-hosted build separately after upload.

Build warnings remain for bundle size and the public menu background reference.
The latter resolves correctly at runtime in the tested production subdirectory.
Initial performance measurements are documented in `PERFORMANCE_CHECKS.md`;
target hardware graphics performance remains to be assessed.
