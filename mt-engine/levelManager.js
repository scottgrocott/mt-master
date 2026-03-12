// levelManager.js — Level progression, win/lose detection
// Social VR fork: replace with roomManager.js

let _cfg         = null;
let _onWin       = null;
let _onLose      = null;
let _enemyCount  = 0;

export function initLevelManager(cfg, { onWin, onLose } = {}) {
  _cfg       = cfg;
  _onWin     = onWin;
  _onLose    = onLose;
  _enemyCount = 0;
  console.log('[levelManager] Ready');
}

export function setEnemyCount(n) { _enemyCount = n; }
export function onEnemyKilled()  {
  _enemyCount = Math.max(0, _enemyCount - 1);
  if (_enemyCount === 0) _onWin?.();
}

export function onPlayerDied() { _onLose?.(); }
