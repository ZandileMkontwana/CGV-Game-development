export const LEVEL_BRIEFINGS = {
  1: { title: 'I — THE EXPERIMENT', objective: 'You are the engineer on shift. Restore auxiliary power in Lab A-2 using the amber relay.' },
  2: { title: 'II — THE HUNT', objective: 'The Lab A-2 culture went wrong — something is loose in Sector B and the staff never made it out. Take the pulse sidearm from the staging-bay security locker, pulse the blue door relay, and follow the evacuation route to core access.' },
  3: { title: 'III — THE COLLAPSE', objective: 'The entity locks the surface seal. Destroy its cyan chest and shoulder nodes. Sidestep the amber charge warning, then follow the green escape route.' },
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
  failsafe: { text: 'Failsafe protocol active. Structural demolition in T-minus 15 minutes.' },
  demolition: { text: 'DEMOLITION SEQUENCE ENGAGED. EVACUATE IMMEDIATELY.' },
};
