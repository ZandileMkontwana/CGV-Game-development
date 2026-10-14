export const LEVEL_BRIEFINGS = {
  1: { title: 'I — THE EXPERIMENT', objective: 'You are the engineer on shift. Restore auxiliary power in Lab A-2 using the amber relay.' },
  2: { title: 'II — THE HUNT', objective: 'Cross the crew quarters and isolate both amber pressure valves. Crouch behind solid cover; shots attract the creature. Be ready to sprint through the bypass to core access.' },
  3: { title: 'III — THE COLLAPSE', objective: 'The entity locks the surface seal. Destroy its cyan chest and shoulder nodes. Sidestep the amber charge warning, then follow the green escape route.' },
};

export const PA_ANNOUNCEMENTS = {
  dispatch: { text: 'Engineering call: auxiliary power offline in Lab A-2. Enter the laboratory and pulse the amber relay.', url: new URL('../assets/audio/pa-dispatch.wav', import.meta.url).href },
  power: { text: 'Auxiliary power restored. Resuming culture protocol.', url: new URL('../assets/audio/pa-power.wav', import.meta.url).href },
  bypass: { text: 'Emergency bypass released. Follow the green route to the control room and release the exits.', url: new URL('../assets/audio/pa-bypass.wav', import.meta.url).href },
  breach: { text: 'WARNING: Containment breach detected. Lockdown initiated.', url: new URL('../assets/audio/pa-breach.wav', import.meta.url).href },
  failsafe: { text: 'Failsafe protocol active. Structural demolition in T-minus 15 minutes.', url: new URL('../assets/audio/pa-failsafe.wav', import.meta.url).href },
  demolition: { text: 'DEMOLITION SEQUENCE ENGAGED. EVACUATE IMMEDIATELY.', url: new URL('../assets/audio/pa-demolition.wav', import.meta.url).href },
};
