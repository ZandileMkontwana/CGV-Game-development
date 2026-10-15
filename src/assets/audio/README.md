# Archived facility PA clips (unused)

Current status — 15 October 2026: these files remain as source archives.
`src/ui/content.js` contains text only, and `AudioManager.playAlert()` generates
Web Audio chimes/sirens. Neither imports or plays these WAVs. The current Vite
entry point does not include them in the production build.

These WAV files are temporary speech synthesized locally using Windows
System.Speech and Microsoft Zira Desktop. The original three scripts come from
TASKS.md; dispatch, power restoration and bypass dialogue support the revised
Level 1 opening. Current captions are in `src/ui/content.js`.
Regenerate them on Windows with `scripts/generate-pa.ps1`, or replace them
with team-recorded clips using the same filenames.

| Filename | Intended original trigger (archived) | Caption |
| --- | --- | --- |
| `pa-dispatch.wav` | Starting Level 1 | Engineering call: auxiliary power offline in Lab A-2. Enter the laboratory and pulse the amber relay. |
| `pa-power.wav` | Successful relay repair | Auxiliary power restored. Resuming culture protocol. |
| `pa-breach.wav` | Level 1 scientist alarm / breach scene | WARNING: Containment breach detected. Lockdown initiated. |
| `pa-bypass.wav` | Breach opens the lab exit | Emergency bypass released. Follow the green route to the control room and release the exits. |
| `pa-failsafe.wav` | Entering Level 2 | Failsafe protocol active. Structural demolition in T-minus 15 minutes. |
| `pa-demolition.wav` | Level 3 boss defeated, escape timer starts | DEMOLITION SEQUENCE ENGAGED. EVACUATE IMMEDIATELY. |

The fifteen-minute line is the story warning specified by TASKS.md. The
playable escape countdown remains the engine's existing ninety seconds,
starting after the boss dies.

Reusing these clips would require explicit loading/playback integration and
confirmation of distribution terms; their presence is not evidence of active
spoken dialogue. Provenance is recorded in the project credits.

The ambience, effects and level scores are procedural. Music & ambience has
its own saved volume setting; it does not change PA or effect loudness.
Listening/balance checks remain pending. Any future recorded speech or music
would be a new integration and attribution task, rather than shipped content.
