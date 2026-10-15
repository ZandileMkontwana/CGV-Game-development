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
| M | Mute audio |
| Esc | Pause / resume |

The HUD shows health, Pulse Tool energy, the current objective (top centre),
the level indicator, and an FPS counter. In third person you can see the
engineer character model (V key).

---

## Level 1 — The Experiment (I · WITNESS)

**Theme:** clean research lab, cool white lighting. Everything still looks
normal — that is the point.

**What happens:**

1. **Tutorial walk.** You spawn in the reception corridor at the facility's
   north end. Guided hints teach movement, sprinting, jumping, the camera
   toggle and the Pulse Tool as you head deeper into the lab.
2. **The lab.** You reach the experiment room: a containment tube, benches,
   consoles — and a **scientist** seated at a console, typing.
3. **The reveal (scripted beat).** As you approach, an alarm sounds: the
   scientist stops typing and turns toward you, then doubles over. Under a
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
**How you lose:** run out of health (nothing here attacks you — this level is
about exploration and witnessing the breach).

---

## Level 2 — The Hunt (II · THE HUNT)

**Theme:** the damaged facility — flickering amber lights, rust, sparking
conduits, steam vents, and heat-haze shimmer (custom shader) over hot
machinery.

**What happens:**

1. **The hunt begins.** The monster — the mutated scientist — is now loose and
   actively **hunting you** through the damaged corridors, quarters
   (locker banks, bunks), maintenance decks and a server-room rack maze.
2. **Stealth AI.** The creature is no longer omniscient:
   - it sees a **forward vision cone** (~120°), with a short peripheral
     radius behind which you are safe;
   - **spotting takes time** — an awareness meter fills while you are in view
     (faster the closer you are), then the chase begins;
   - it **hears** you — sprinting is loud, walking is quiet, shots and hard
     landings are one-off noises it will investigate;
   - when it loses sight of you it runs to where it **last saw you**, sweeps
     its head, then gives up and returns to its patrol.
3. **Your tools.** Break line of sight behind tall cover (lockers, racks,
   crates, pillars). The HUD warns you when you are seen or hidden. Your
   Pulse Tool can **disable hazards** — shoot sparking conduits to stop the
   sparks, valves to shut off steam vents (they also stop making noise that
   draws attention).
4. **Your objective.** Sneak the length of the facility from cover to cover
   and reach the **emergency exit vestibule** at the south end (green exit
   beacon).

**How you win:** reach the emergency exit — the monster does **not** have to
be killed. Sneaking past it is the intended (and safest) solution.
**How you lose:** the monster catches you and depletes your health — it hits
hard and does not stop while it can see you.

---

## Level 3 — The Collapse (III · THE COLLAPSE)

**Theme:** red emergency lighting, alarms, ash and dust in the air. The
failsafe demolition is now executing — and the only thing between you and the
exit is the creature itself.

**What happens:**

1. **The arena.** A short entry corridor opens into the containment arena —
   a 28 × 32 m hall with cover pillars, generators, reactor cores, crate
   stacks and debris. The monster spawns centre-arena and **never stops
   hunting you** (arena-wide detection, it never gives up the chase).
2. **The boss fight.** Shoot the monster's **three glowing red weak points**
   (chest + both flanks). They pulse so you can find them in the dark. Each
   weak point you destroy **enrages** it — faster, harder-hitting, attacking
   more often:
   | Phase | Weak points destroyed | Effect |
   |---|---|---|
   | 1 | 1 | +1.5 m/s speed, +5 damage, faster attacks |
   | 2 | 2 | stacked on phase 1 |
   | 3 | 3 | death — the fight ends |
   The boss phase indicator on the HUD tracks your progress. Use the pillars
   and cover to break line of sight between engagements.
3. **The failsafe detonation.** The moment the creature dies, the countdown
   starts: **90 seconds**. The **FAILSAFE SEAL** — the arena's south exit,
   which only opens on entity death — slides open, and the escape begins.
4. **The escape run.** Sprint through the **collapsing escape corridor** into
   the exit room while the building comes down around you: the dissolve
   shader eats walls and ceiling slabs, screen shake intensifies as the timer
   runs out, countdown beeps accelerate in the final 10 seconds, and a
   structural rumble builds underneath it all.
5. **Your objective.** Reach the **emergency exit** at the far end of the exit
   room (green beacon) before the timer hits zero.

**How you win:** kill the monster, then reach the exit before the 90-second
collapse timer expires — this ends the game with the **FACILITY CLEARED**
victory screen.
**How you lose:** the timer hits zero (the building buries everything), or
the monster kills you during the fight — **GAME OVER**, with a Retry that
restarts the run.

---

## Win conditions at a glance

| Level | Objective | Lose condition |
|---|---|---|
| **1 — The Experiment** | Shoot the conduit, reach the control room | Health depleted |
| **2 — The Hunt** | Sneak past the monster to the emergency exit | Caught by the monster |
| **3 — The Collapse** | Destroy the 3 weak points, escape before the 90 s collapse timer | Timer expires, or killed in the arena |

---

## Behind the scenes (one paragraph)

The game ships with Blender-made models (characters, props), PBR texture sets
and sampled sound cues, all preloaded through an asset library at boot — and
every one of them has a **procedural fallback** built in code, so the game
runs fully even where asset files are missing. Credits for every asset and
library are listed in `CREDITS.md` and on the in-game credits screen. Level
lighting, the heat-haze and dissolve effects are custom GLSL shaders; the
monster, scientist and engineer are rigged GLB models with authored
animation clips. For the full engineering plan, team roles and rubric
alignment, see `PLAN.md`.
