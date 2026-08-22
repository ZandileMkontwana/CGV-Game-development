/**
 * UIManager — Person D's domain.
 *
 * Owns HUD elements, menus, sound, credits screen, and trailer recording.
 * The HTML/CSS for most UI already exists in index.html — this module
 * wires dynamic behaviour (health bar, objective text, sound triggers).
 *
 * Sound library recommendation: Howler.js (lightweight, works in browsers).
 */
export default class UIManager {
  constructor() {
    // TODO (Person D): Grab DOM references and set up dynamic UI.
    // - Health bar updates
    // - Objective text per level
    // - Credits screen content
    // - Sound effect triggers (ambient, alarms, meltdown)
  }

  /** Update HUD elements (called each frame while playing). */
  update(dt) {
    // TODO (Person D): Update health bar, objective text, timers, etc.
  }

  /** Play a sound effect by name. */
  playSound(name) {
    // TODO (Person D): Integrate Howler.js or Web Audio API.
  }

  /** Set the objective text shown on the HUD. */
  setObjective(text) {
    // TODO (Person D): Update objective display.
  }

  /** Show the credits screen (overlay or separate scene). */
  showCredits() {
    // TODO (Person D): Display credits with all libraries, assets, licenses.
  }
}
