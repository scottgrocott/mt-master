// ui/hud.js — Update DOM HUD elements

export function initHUD() {
  // Elements already in index.html — nothing to create
}

export function updateHUD({ health, ammo, enemies, pos, status } = {}) {
  _set('hud-health',  health  ?? '');
  _set('hud-ammo',    ammo    ?? '');
  _set('hud-enemies', enemies ?? '');
  _set('hud-pos',     pos     ?? '');
  _set('hud-status',  status  ?? '');
}

function _set(id, val) {
  const el = document.getElementById(id);
  if (el && el.textContent !== String(val)) el.textContent = String(val);
}
