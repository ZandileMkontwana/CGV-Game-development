# Containment Breach — Game Overview

*What the game is, and what happens at each of the three levels.*

---

## What the game is about

**Containment Breach** is a first-person / third-person 3D survival horror game
set in an underground research lab facility. It is built with Three.js and
cannon-es (physics), runs in the browser, and unfolds across three acts:

```
I · WITNESS   →   II · THE HUNT   →   III · THE COLLAPSE
```

**The story:** a scientist's experiment to grow a creature in a containment
tube went wrong. The creature broke free and bit the scientist — mutating them
into a monster. The facility's automated failsafe protocol has already sealed
the exits and armed a controlled demolition to bury the threat underground.

**You are the engineer on shift.** You carry a *Pulse Tool* — a handheld
engineering device that fires energy bursts. Over the three levels the same
tool is used to activate equipment, disable hazards, and finally fight.
Your goal: witness the transformation, survive the hunt, and escape the
collapse.

### How to play

| Input | Action |
|---|---|
| W A S D | Move |
| Mouse (after click) | Look — pointer lock |
| Left click / F | Fire the Pulse Tool |
| Shift | Sprint (~11 m/s vs 6 m/s walk) |
| Space | Jump |
| V | Toggle first-person / third-person camera |
| M | Expand / close the facility map |
| U | Mute audio |
| Esc | Pause / resume |

The HUD shows health, Pulse Tool energy, the current objective at the upper left,
prominent instructions above the crosshair, and a live minimap at the lower right.
Press M for the complete floor plan; blue marks the player, amber marks tasks and
doors, and green marks the exit. Movement stays active with the map open.
In third person you can see the
engineer character model (V key).

---

## Level 1 — The Experiment (I · WITNESS)

**Theme:** a clean research facility with cool white lighting, except for
Lab A-2, where a failed circuit leaves only amber backup guidance.

**What happens:**

1. **Tutorial walk.** You spawn in the reception corridor at the facility's
   north end. Guided hints teach movement, sprinting, jumping, the camera
   toggle and the Pulse Tool as you head deeper into the lab.
2. **The lab.** You reach the experiment room: a containment tube, benches,
   consoles — and a **scientist** waiting at an unpowered console. Ceiling
   lights, monitors and the containment glow are off. Pulse the **amber relay**
   to restore them; entering the room alone does not start the experiment.
3. **The reveal (scripted beat).** Power returns and the scientist resumes
   work. The equipment overloads, an alarm sounds, and he doubles over. Under a
   strobing red light he convulses violently — and bursts into the
   **creature** itself, swelling to full size right in front of you.
4. **The escape.** The creature lurches away toward the ceiling ducts — but it
   does not disappear. For the rest of the level it **prowls the facility on a
   patrol loop** (lab → corridor → reception → back). It can never detect or
   harm you in Level 1; it is a scripted threat you witness, not a fight.
5. **Your objective.** Shoot the **glowing conduit** to open the sealed door,
   then reach the **control room console** at the facility's south end
   (marked by a green exit beacon).

**How you win:** reach the control room.

Facility staff wear white lab coats with department badges, pockets and safety
glasses. They patrol and look around, react to the alarm, then run to refuge
when the creature is released. The third-person player also wears a lab coat.
**How you lose:** run out of health (nothing here attacks you — this level is
about exploration and witnessing the breach).

---

## Level 2 — The Hunt (II · THE HUNT)

Your pulse tool stays equipped from training, including after a retry. Left click
or F fires. All mission relays use pulses; E cannot bypass their locked doors.

1. Shoot the blue entry relay and cross the damaged corridor into crew quarters.
2. Follow the medical distress signal west. Pulse the amber rescue relay beside
   the medical doorway to release two scientists. Stay within six metres and
   escort them north through medical into the green refuge. They wait if you
   leave them behind, and navigate around walls and closed doors.
3. Shoot both amber pressure valves in maintenance. The server-room interlock
   releases once both scientists are safe and both valves are isolated.
4. Enter the archive east of the server room. Pulse its power relay, then pulse
   the evidence terminal. Stay inside the glowing floor outline around the archive
   tables during the 12-second transfer, until the HUD confirms 100%.
   Leaving pauses the transfer and preserves progress. Powered machinery makes
   noise that attracts the creatures, so use the room and racks as cover.
5. With the scientists safe and the records secured, the core-access transfer
   door opens. Evade the second creature and enter the green core-access beacon.

The map marks medical, refuge, archive and mission relays. White dots mark the
scientists; rescued staff and completed targets turn green. Killing the creatures
is optional. Losing all health ends the run; retry resets this level's objectives.

---

## Level 3 — The Collapse (III · THE COLLAPSE)

1. Restore emergency power in both side rooms: the west pump gallery and east
   observation booth. Pulse each amber generator panel from nearby. The west
   gallery has a rotating pump arm with a matching collider; the east booth has
   an electrical floor with an amber warning, a red live interval and a dark
   safe interval. Starting a generator disables that room's hazard.
2. The entity detects and attacks you before power is restored. Use cover while
   starting the generators; both must be online to disable its node shields.
   Dodge its locked amber charge
   line, then shoot a cyan chest or shoulder node during recovery. One node can
   rupture per recovery opening. Amber nodes are shielded; body shots also count
   toward a node while the shield is open.
3. Each destroyed node speeds up its attack rhythm. In the final phase it adds
   a sweeping attack: move outside the amber ring before it strikes. The HUD
   names each attack and indicates when nodes are vulnerable.
4. Defeating the entity releases the surface seal and starts a 90-second escape
   timer. Follow the green floor lights through the winding maintenance route.
   Rubble blocks the central shortcut; take the marked eastern service bypass.
5. Flashing amber floor zones warn for 1.8 seconds before ceiling slabs fall.
   Keep clear of those areas; fallen slabs retain collision and leave a clear
   side lane. Follow the transfer gallery west, then the south surface corridor
   to the green emergency-exit beacon before the countdown expires.

The expanded map includes the generators, maintenance section, bypass, transfer
and relocated surface exit. Pausing freezes mission progress, machinery and the
escape countdown. Retry resets generators, the boss, rubble warnings and progress.

---

## Win conditions at a glance

| Level | Objective | Lose condition |
|---|---|---|
| **1 — The Experiment** | Shoot the conduit, reach the control room | Health depleted |
| **2 — The Hunt** | Rescue both scientists, recover the archive records, reach core access | Health depleted |
| **3 — The Collapse** | Start both generators, destroy the 3 nodes, cross maintenance to the surface within 90 seconds | Health depleted or timer expires |

---

## Behind the scenes (one paragraph)

The current game builds its characters, weapons, environment textures and
soundscape in code. Five Blender-exported prop GLBs supplement the facility;
custom character GLBs, baked environment texture sets and sampled sound cues
are absent. PA alerts use synthesized chimes/sirens and on-screen captions;
the older speech WAVs remain unused source archives. Custom GLSL drives heat
shimmer, dissolving surfaces, energy glows and screen effects. Menu and ending
credits list the libraries and content, with unconfirmed asset sources recorded
in `ASSET_CREDITS.md`; see `CREDITS.md` for details. For the current engineering
plan, team responsibilities and rubric alignment, see `PLAN.md`.
