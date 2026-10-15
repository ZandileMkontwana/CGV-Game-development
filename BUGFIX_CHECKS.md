# Gameplay fixes — 15 October 2026

- Staff now navigate around the actual wall, door and prop colliders. Their
  full movement segment is checked, including body clearance and head height.
  Patrol points were moved into the correct rooms after the 34 m training-wing
  extension. Door openings and asynchronously loaded props refresh navigation.
- The containment alarm interrupts patrols. Staff run toward reception or the
  control room, away from the lab, and shelter at separate positions. A sealed
  route makes them wait rather than walk through a wall or disappear.
- Removed the decorative reactor barricade and railings, which lacked collision.
  Reactor machinery formerly placed in earlier corridors now occupies the actual
  reactor hall. The green escape guides and signs were corrected too.
- Entering Lab A-2 now waits for the amber relay pulse. Repeated hits cannot
  restart the sequence. The scientist sits at the console clear of the chamber.
- Creature lighting remains in the scene while its model is hidden. Hidden
  effects are compiled and drawn once into the compositor target during level
  setup. This prepares the driver work before the relay/reveal. Visibility and
  culling flags are restored even if preparation fails. Inactive creature bodies
  sleep with collisions disabled, so they cannot obstruct players invisibly.

## Validation

- `npm test`: 31 tests, covering existing gameplay plus wall routing, evacuation,
  closed doors, long frames, thin walls, head clearance, relay-triggered opening,
  render preparation/restoration and creature activation.
- `npm run build`: production build succeeds. The existing bundle-size and
  runtime menu-background-reference notices remain.
- Automated headless Chrome: all seven staff completed their patrol loops with
  zero invalid movement segments; all reached refuge positions after the alarm.
- A real pulse raycast triggered the relay sequence. The bypass opened and the
  reveal completed. The visible light count and shader-program count stayed
  constant across the sequence. Sampled render submission took 7–19 ms after
  preparation, versus multi-second first-use stalls in the earlier checks.
  These software-WebGL samples are not target-hardware FPS measurements.
- Controlled Cannon simulation moved the player from the lab through maintenance,
  around the reactor and into the control room. Level loads 1 → 2 → 3 → 1 restored
  the original Level 1 body count (170) and all seven staff, with no browser runtime
  errors in that traversal/reload check.

Browser checks used controlled simulation and selected rendered frames; they
do not replace a full manual playthrough on the target Chrome/Ubuntu hardware.

## Level 1 staff visibility and behavior follow-up

- Expanded the level to 13 staff: two visible from the opening position, two in
  the training hub, two in reception, one in the corridor, three in the lab and
  three in the reactor/control areas. The earlier seven were all beyond training.
- Staff reuse the bundled detailed character asset with separate skeletons,
  role-colored materials, idle/walk/run clips and head scanning. The player and
  staff share an immutable source rig and textures; staff cleanup never disposes
  the shared geometry. A visible procedural fallback remains if loading fails.
- The alarm makes staff stop and look around; the creature's appearance interrupts
  their patrols and starts evacuation. Staff wait for closed doors, shelter at
  separate positions and flee farther if they see a creature approaching a refuge.
- Headless Chrome confirmed all 13 detailed models ready on level start, valid
  spawn/patrol points, completed patrol loops without invalid movement segments,
  the patrol-to-flee change at release and arrival at refuges after opening the
  training entry door. No browser runtime errors occurred. The starting view was
  rendered and visually inspected with both opening-room staff visible.
- `npm test`: 34 tests, including independent staff animation/skeleton ownership,
  cleanup, alarm response, renewed escape from a threatened refuge and wall-blocked
  perception. `npm run build` succeeds with the previously noted notices.

## Right-hand shooting room follow-up

- Replaced the east room's three wall panels with mounted monster mannequins.
  Cyan chest markers and base strips turn green after a confirmed pulse hit;
  completed targets tilt back. The dummies have static colliders and no enemy AI.
- Entering the room shows aim/fire controls and a 0/3 progress count, even when
  visiting it before the jump room. Body or chest hits count once per dummy.
  Partial progress survives leaving. Completing all three shows a short success
  message, then suppresses the shooting lesson on subsequent room entries.
- Both training rooms are still required for the hub gate. Completion resets
  alongside the targets when starting/restarting the level.
- `npm test`: 38 passing tests; `npm run build` succeeds with existing notices.
  Automated Chrome pulse raycasts verified 0→1→2→3 progress, duplicate-hit
  protection, partial-progress re-entry, three completed-room re-entries with
  the lesson hidden, gate release after the jump relay, and clean level reload.
  Ready/completed room frames were visually inspected; no runtime errors occurred.

## HUD and facility map follow-up

- Instructions now appear in a larger panel above the crosshair with a brighter
  border and readable main/subtext. Objectives, radio captions and health/energy
  use consistent inset panels, with a subtle frame around the screen perimeter.
- A lower-right minimap follows the player and heading. M expands/closes the full
  facility plan with room labels; U now toggles mute. The menu and game guide list
  both controls. The expanded map states that movement remains active.
- Floor data comes directly from level builders; walls and obstacles come from
  the current collision bodies. Doors and task markers reflect live completion.
  Each level resets the map and releases old references. Drawing is limited to
  10 Hz on a 2D canvas, adding no WebGL scene or physics bodies.
- Automated Chrome checked local/full views, M expansion, level loads 1→2→3→1,
  and HUD bounds at 1366×768, 800×600, 640×480 and 390×700. Desktop local/full map
  frames were visually inspected. No browser runtime errors occurred.
- `npm test`: 43 tests, including map projection, distance/direction, floor data
  cleanup, live doors, removed colliders, player heading and independent map/mute
  shortcuts. Production build succeeds with the existing notices.

## Visible Lab A-2 power failure

- Lab A-2 starts with its four ceiling lights, console displays, wall screens
  and containment glow off. Amber backup lighting, the relay and safety signs
  remain visible. The scientist waits until power returns before typing.
- A confirmed relay hit ramps equipment and normal lighting up over 0.85 seconds,
  followed by the existing overload and red containment emergency. Entering the
  room alone still leaves the circuit offline.
- Room-local material copies preserve powered displays elsewhere. A stable shader
  uniform suppresses facility-wide fill inside the offline lab while retaining
  point lights and the player's torch; changing power does not change shader keys.
- Corrected ceiling fixture placement to include each room's horizontal offset.
  The annex's lamp was previously placed inside the main lab and stayed lit there.
- Automated Chrome fired a real pulse at the relay, verified offline/restored/
  emergency states and visually checked matching before/after frames. All four
  lab fixtures measured zero before repair and their original intensity afterward;
  the chamber light changed from zero to five. Loading Level 2 cleared the
  circuit/dimming, and reloading Level 1 restored the blackout. No browser errors
  occurred.
- `npm test`: 47 passing tests, including circuit startup, material ownership,
  uniform updates, cleanup and room-local fixture positions. Production build
  succeeds with the existing bundle-size and menu-background notices.

## Scientist coats and Level 2 firing

- Replaced soldier-bodied staff with articulated researchers wearing white coats,
  lapels, split coat tails, pockets, pens, department badges and safety glasses.
  Faces remain visible with varied skin, hair and shirt colors. Fallen researchers
  and the third-person player use the same coat rig. Player crouching and both
  rifle grips work with the new skeleton.
- The seven materials are grouped into one skinned mesh per person. Individual
  researchers own and release their skeleton, geometry and materials; changing
  one person's pose or disposing it cannot affect another. No external assets
  or texture fetches are required for the new bodies.
- Level 2 no longer silently disables shooting until a locker pickup. The pulse
  tool is equipped and recharged at every level load/retry. Removed the pickup
  gate and updated the briefing, objective, room sign and tutorial instructions.
- Automated Chrome verified all 13 scientists, the player's coat, F firing and
  opening the blue entry relay, mouse firing, Level 2 retry with full energy,
  two coat-wearing casualties, and evacuation after reloading Level 1. No browser
  errors occurred. Staff and player frames were visually inspected.
- `npm test`: 52 passing tests, including coat ownership, independent running
  animation, planted-foot crouching, rifle grips, both firing inputs, cooldown,
  energy depletion and Level 2 retry. Production build succeeds with the existing
  bundle-size and menu-background notices.

## Level 2 pulse-operated doors

- Removed the generic E override and its button plate from both Level 2 doors.
  The entry requires its blue relay; the pressure interlock opens automatically
  when both amber valves are disabled. Approaching a closed door now shows the
  matching pulse instruction without an E prompt.
- Regression coverage checks E before and after one valve, either valve order,
  automatic release after the second valve, and removal of the fully opened
  door's collision body. `npm test`: 53 passing tests.
- Automated Chrome confirmed E is blocked at both doors, a real pulse opens
  the blue relay door, one amber valve leaves the second door sealed, and the
  second valve releases it and clears its collider. No browser errors occurred.
  Production build succeeds with the existing notices.

## Expanded hunt and collapse missions

- Level 2 adds two trapped medical-bay scientists and a new northern refuge.
  The medical pulse relay releases them; they navigate around physical cover
  and wait when the player moves farther than six metres away. Both survivors
  must arrive before the pressure interlock can release, even if both valves
  were shot earlier. The nearby hint explains either missing requirement.
- The east archive starts on backup lighting. Its power relay restores ceiling
  fixtures and the wall display. Pulsing the evidence terminal starts a 12-second
  transfer; leaving its three-metre area pauses progress without resetting it.
  The powered machinery periodically attracts active creatures. Core access and
  the Level 2 win trigger require both survivors and the recovered records.
- Level 3 adds west/east emergency generator controls. The west pump arm moves
  with its physics collider; the east electrical strip has a harmless amber
  warning, a red live interval and a dark safe interval. Each generator disables
  its local hazard. The boss hunts before power is restored; both controls are
  required to disable its node shields.
- Boss weak points are amber while shielded and cyan during recovery. One node
  can rupture per recovery opening; rejected hits retain their raycast targets.
  Later phases shorten pursuit and add a warned sweep ring with one damage
  event per sweep. The HUD explains shield, charge, sweep and vulnerable states.
- Replaced the short final corridor with connected maintenance galleries, an
  eastern service bypass around solid rubble, a west transfer gallery and a
  south surface corridor. Green lights and map labels follow the new route.
  Three ceiling slabs flash floor warnings for 1.8 seconds before falling;
  their colliders follow them and leave a passable side lane. The existing
  90-second countdown starts on boss death; the win zone moved to the surface.
- Automated Chrome raycasts verified rescue release, both scientists reaching
  refuge with zero blocked movement segments, offline archive rejection,
  power/transfer/pause/resume, both generator controls, three boss recovery
  openings, rejection of a second node in one opening and the final-phase sweep.
  A controlled Cannon traversal reached the final exit through all five route
  checkpoints with all three slabs landed and about 70 seconds remaining at
  normal movement speed. This is a route check, not a target playtime estimate.
- Staff/refuge, archive, expanded map and final exit frames were visually
  inspected. Unit tests cover mission gates, duplicate actions, partial transfer,
  reset state, boss windows, machinery collision, timed damage, all-landed route
  clearance and cleanup. Updated briefings, objectives, signs, map and game guide.
- `npm test`: 60 passing tests. Production build succeeds with the existing
  bundle-size and menu-background notices. Chrome also ran regular gameplay
  frames and level reloads 2→3→2→3→1: mission state reset, Level 2/3 physics-body
  counts returned to 130/112, and Level 1 restored its offline circuit. No browser
  runtime errors occurred. The development server remains running.

## Archive transfer stopping near the tables

- Reproduced an accessible north-table position that failed the old invisible
  three-metre circle. The HUD also reused one update key for each ten-percent
  interval, so 91–99% could keep displaying 90%.
- The transfer now accepts the archive's actual room floor with an inset from
  its walls. A cyan outline marks the valid work area after power is restored;
  it turns amber while a transfer is paused outside. Adjacent rooms still do
  not count. Leaving preserves progress, and returning to either table resumes.
- Percent changes now refresh the HUD individually. Completion snaps the timer
  to twelve seconds despite frame accumulation error, confirms records secured
  at 100%, turns the terminal green, and opens the transfer door once rescue is
  complete. Updated guidance and the game guide describe the floor outline.
- Automated Chrome used normal gameplay ticks to reach 90% beside the north
  table, pause outside, resume through 95% and 99% at both table approaches, and
  finish at 100%. The transfer door cleared its collider; no browser errors
  occurred. The outline and completion frames were visually inspected.
- `npm test`: 63 passing tests. Production build succeeds with the existing
  bundle-size and menu-background notices. The dev server remains running.

## Level 3 threat before power and smoke appearance

- Generator power now controls node vulnerability only. Arena entry wakes the
  entity before either generator is online; normal range and wall occlusion
  still govern detection. Charge/sweep warnings take priority over the power
  reminder, and guidance explains the active threat and shield requirement.
- Smoke uses a shared cloud-density texture with transparent edges, gradual
  appearance, rising and swirling motion, expansion and dissipation. Pools
  retain enough slots for each puff to finish fading. Two damaged arena pipes
  now vent smoke. Dust uses a soft circular texture rather than square points.
- Automated Chrome confirmed pursuit from eight metres to under four metres,
  a warned charge and damage with zero generators, blocked detection behind a
  wall, shielded nodes before power and vulnerable recovery after both real
  generator pulses. All dust fields were textured and each smoke plume rose.
  Arena and close smoke frames were visually inspected; no browser errors.
- `npm test`: 66 passing tests, including particle-edge transparency, drifting
  smoke lifecycle, shared-map cleanup and the unpowered attack cycle.
  Production build succeeds with the existing bundle-size/menu-background
  notices. The development server remains running.
