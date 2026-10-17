export const LEVEL_BRIEFINGS = {
  1: { title: 'I — THE EXPERIMENT', objective: 'You are the engineer on shift. Restore auxiliary power in Lab A-2 using the amber relay.' },
  2: { title: 'II — THE HUNT', objective: 'Two scientists are trapped in medical, west of crew quarters. Pulse their rescue relay and escort them north to the green refuge. Isolate both pressure valves, restore power to the east archive, and pulse its evidence terminal. Stay inside the glowing archive floor outline until the download reaches 100%, then escape to core access. Left click or F fires your pulse tool.' },
  3: { title: 'III — THE COLLAPSE', objective: 'The entity is already hunting. Start both emergency generators in the west pump gallery and east observation booth to disable its node shields. Avoid the moving pump arm and live electrical floor. Dodge its amber charge line and sweep ring; cyan nodes open during recovery once power is restored. Defeat it, then follow green lights through the maintenance bypass to the surface within 90 seconds.' },
};

// Facility P.A. captions. There is NO spoken dialogue in the game — AudioManager
// renders each call as a synthesized reactor-station alert tone or klaxon siren,
// keyed by the same name (see AudioManager.playAlert). The text below is shown
// on screen as a caption so players can still read the announcement.
export const PA_ANNOUNCEMENTS = {
  dispatch: { text: 'Engineering call: auxiliary power offline in Lab A-2. Enter the laboratory and pulse the amber relay.' },
  power: { text: 'Auxiliary power restored. Resuming culture protocol.' },
  bypass: { text: 'Emergency bypass released. Follow the green route to the control room and release the exits.' },
  breach: { text: 'WARNING: Containment breach detected. Lockdown initiated.' },
  depressurize: { text: 'AUTOMATIC DEPRESSURIZATION SYSTEM ENGAGED. SECTOR B VENTING TO VACUUM.' },
  sectorIsolated: { text: 'REACTOR SECTOR IS ISOLATED. EVACUATE VIA CORE ACCESS.' },
  failsafe: { text: 'Failsafe protocol active. Structural demolition in T-minus 15 minutes.' },
  demolition: { text: 'DEMOLITION SEQUENCE ENGAGED. EVACUATE IMMEDIATELY.' },
};
