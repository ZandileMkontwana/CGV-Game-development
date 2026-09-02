/**
 * InputManager — centralised keyboard and mouse input.
 *
 * Handles pointer-lock for mouse-look and tracks key state so that
 * other systems can poll `keys` and `mouse` each frame without
 * subscribing to raw DOM events themselves.
 *
 * `justPressed` returns true only on the frame a key first goes down,
 * which is needed for toggle-style actions (e.g. V key camera toggle).
 */
export default class InputManager {
  constructor(canvas) {
    /** @type {Object<string, boolean>} currently held keys */
    this.keys = {};

    /** @private keys that transitioned from up→down this frame */
    this._pressedThisFrame = {};

    /** Mouse state (deltas reset every frame after consumption) */
    this.mouse = { dx: 0, dy: 0, locked: false };

    this._canvas = canvas;
    this._bind();
  }

  _bind() {
    // --- Keyboard -----------------------------------------------------------
    window.addEventListener('keydown', (e) => {
      if (!this.keys[e.code]) {
        // First keydown event for this key — mark as just pressed.
        this._pressedThisFrame[e.code] = true;
      }
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
      this._pressedThisFrame = {};
    });
  }

  /** True only on the first frame a key goes down (not while held). */
  justPressed(code) {
    return !!this._pressedThisFrame[code];
  }

  /** Call once per frame AFTER the consumer has read mouse.dx / mouse.dy */
  endFrame() {
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this._pressedThisFrame = {};
  }

  /** Convenience: is any of the given key codes held? */
  any(...codes) {
    return codes.some((c) => this.keys[c]);
  }
}
