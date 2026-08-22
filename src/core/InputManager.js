/**
 * InputManager — centralised keyboard and mouse input.
 *
 * Handles pointer-lock for mouse-look and tracks key state so that
 * other systems can poll `keys` and `mouse` each frame without
 * subscribing to raw DOM events themselves.
 */
export default class InputManager {
  constructor(canvas) {
    /** @type {Object<string, boolean>} currently held keys */
    this.keys = {};

    /** Mouse state (deltas reset every frame after consumption) */
    this.mouse = { dx: 0, dy: 0, locked: false };

    this._canvas = canvas;
    this._bind();
  }

  _bind() {
    // --- Keyboard -----------------------------------------------------------
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // --- Pointer lock -------------------------------------------------------
    this._canvas.addEventListener('click', () => {
      if (!this.mouse.locked) {
        this._canvas.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = document.pointerLockElement === this._canvas;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.mouse.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });

    // --- Lose focus → release all keys so nothing sticks --------------------
    window.addEventListener('blur', () => {
      this.keys = {};
    });
  }

  /** Call once per frame AFTER the consumer has read mouse.dx / mouse.dy */
  endFrame() {
    this.mouse.dx = 0;
    this.mouse.dy = 0;
  }

  /** Convenience: is any of the given key codes held? */
  any(...codes) {
    return codes.some((c) => this.keys[c]);
  }
}
