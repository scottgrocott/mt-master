// input.js — Keyboard / gamepad input state
// Usage: import { keys, gamepad } from './input.js';

export const keys = {
  w: false, a: false, s: false, d: false,
  space: false, shift: false, e: false, f: false, q: false,
};

export const gamepad = {
  lx: 0, ly: 0, rx: 0, ry: 0,
  fire: false, jump: false,
};

let _shootCallback     = null;
let _freecamCallback   = null;

export function initInput(scene) {
  window.addEventListener('keydown', e => _onKey(e, true));
  window.addEventListener('keyup',   e => _onKey(e, false));
  // Debug: log first keypress to confirm input is wired
  window.addEventListener('keydown', e => {
    if (!window._inputLogged) {
      console.log('[input] First key received:', e.key, '| keys.w=', keys.w, 'keys.s=', keys.s);
      window._inputLogged = true;
    }
  }, { once: false });

  // Prevent default for WASD / space in pointer lock
  window.addEventListener('keydown', e => {
    if (['w','a','s','d',' ','arrowup','arrowdown','arrowleft','arrowright'].includes(e.key.toLowerCase())) {
      if (document.pointerLockElement) e.preventDefault();
    }
  });

  // Mouse click = shoot
  scene.getEngine().getRenderingCanvas().addEventListener('mousedown', e => {
    if (e.button === 0 && document.pointerLockElement) _shootCallback?.();
  });

  // Gamepad polling
  scene.registerBeforeRender(_pollGamepad);
}

function _onKey(e, down) {
  switch (e.key.toLowerCase()) {
    case 'w': case 'arrowup':    keys.w      = down; break;
    case 'a': case 'arrowleft':  keys.a      = down; break;
    case 's': case 'arrowdown':  keys.s      = down; break;
    case 'd': case 'arrowright': keys.d      = down; break;
    case ' ':                    keys.space  = down; break;
    case 'shift':                keys.shift  = down; break;
    case 'e':                    keys.e      = down; break;
    case 'f':                    keys.f      = down; break;
    case 'q':                    keys.q      = down; break;
    case 'v':          if (down) _freecamCallback?.(); break;
  }
}

function _pollGamepad() {
  const pads = navigator.getGamepads?.();
  if (!pads) return;
  const gp = pads[0];
  if (!gp) return;
  gamepad.lx = gp.axes[0] ?? 0;
  gamepad.ly = gp.axes[1] ?? 0;
  gamepad.rx = gp.axes[2] ?? 0;
  gamepad.ry = gp.axes[3] ?? 0;
  const firePrev = gamepad.fire;
  gamepad.fire = (gp.buttons[7]?.pressed || gp.buttons[0]?.pressed) ?? false;
  if (gamepad.fire && !firePrev) _shootCallback?.();
}

export function registerShootCallback(fn)   { _shootCallback   = fn; }
export function registerFreecamCallback(fn) { _freecamCallback = fn; }