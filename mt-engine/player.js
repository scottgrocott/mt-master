// player.js — FPS kinematic player movement v2
// Uses raw x/z scalars for movement — avoids Vector3 method chain issues.

import { scene }            from './core.js';
import { keys, gamepad }    from './input.js';
import { getLookYaw }       from './look.js';
import { getTerrainY }      from './terrain/terrainMesh.js';
import { getPlugin }        from './physics.js';

let _capsule    = null;
let _camera     = null;
let _velY       = 0;
let _registered = false;

const GRAVITY  = -28;
const JUMP_V   =  9;
const SPEED    =  9;
const CAP_H    =  1.8;
const CAM_H    =  1.55;  // eye height above capsule base

export function initPlayer(sceneRef, camera, spawnPos) {
  _camera = camera;
  if (_capsule) { _capsule.dispose(); _capsule = null; }

  _capsule = BABYLON.MeshBuilder.CreateCapsule('playerCapsule',
    { radius: 0.38, height: CAP_H, tessellation: 8 }, scene);

  const sx = (spawnPos && isFinite(spawnPos.x)) ? spawnPos.x : 0;
  const sy = (spawnPos && isFinite(spawnPos.y)) ? spawnPos.y : 4;
  const sz = (spawnPos && isFinite(spawnPos.z)) ? spawnPos.z : 0;
  _capsule.position.set(sx, sy, sz);
  _capsule.isVisible  = false;
  _capsule.isPickable = false;
  _velY = 0;

  if (!_registered) {
    scene.registerBeforeRender(_tick);
    _registered = true;
  }
  console.log('[player] Spawned at', sx.toFixed(1), sy.toFixed(1), sz.toFixed(1));
}

function _tick() {
  if (!_capsule || !_camera) return;

  const dt  = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.05);
  const yaw = getLookYaw();

  // ── Build move direction as raw scalars ───────────────────────────────────
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);

  // fwd = (sinY, 0, cosY)   right = (cosY, 0, -sinY)
  let mx = 0, mz = 0;
  const gp = 0.15;
  if (keys.w || gamepad.ly < -gp) { mx += sinY; mz += cosY;  }
  if (keys.s || gamepad.ly >  gp) { mx -= sinY; mz -= cosY;  }
  if (keys.a || gamepad.lx < -gp) { mx -= cosY; mz += sinY;  }
  if (keys.d || gamepad.lx >  gp) { mx += cosY; mz -= sinY;  }

  // Normalise
  const len = Math.sqrt(mx * mx + mz * mz);
  if (len > 0) { mx = mx / len * SPEED * dt; mz = mz / len * SPEED * dt; }

  // ── Floor detection: terrain OR physics body (shelters, bridges, etc) ────────
  const pos          = _capsule.position;
  const terrainFloor = getTerrainY(pos.x + mx, pos.z + mz);

  // Raycast down — only trust it if it lands meaningfully above terrain
  // (terrain itself is a physics body so we'd always hit it otherwise)
  let physicsFloor = terrainFloor;
  const plugin = getPlugin();
  if (plugin) {
    try {
      const rayStart = new BABYLON.Vector3(pos.x + mx, pos.y + 0.5, pos.z + mz);
      const rayEnd   = new BABYLON.Vector3(pos.x + mx, terrainFloor,  pos.z + mz);
      const result   = new BABYLON.PhysicsRaycastResult();
      plugin.raycast(rayStart, rayEnd, result);
      if (result.hasHit && result.hitPointWorld.y > terrainFloor + 0.3) {
        physicsFloor = result.hitPointWorld.y;
      }
    } catch(e) { /* plugin not ready */ }
  }

  const gndY  = physicsFloor;
  const baseY = gndY + CAP_H * 0.5;
  const onGnd = pos.y <= baseY + 0.12;

  if (onGnd) {
    _velY = 0;
    pos.y = baseY;
    if (keys.space) _velY = JUMP_V;
  } else {
    _velY += GRAVITY * dt;
    const ny = pos.y + _velY * dt;
    pos.y = ny < baseY ? baseY : ny;
    if (pos.y === baseY) _velY = 0;
  }

  // ── Apply horizontal ──────────────────────────────────────────────────────
  pos.x += mx;
  pos.z += mz;

  const B = 340;
  if (pos.x < -B) pos.x = -B;
  if (pos.x >  B) pos.x =  B;
  if (pos.z < -B) pos.z = -B;
  if (pos.z >  B) pos.z =  B;

  // ── Camera ────────────────────────────────────────────────────────────────
  _camera.position.x = pos.x;
  _camera.position.y = pos.y - CAP_H * 0.5 + CAM_H;
  _camera.position.z = pos.z;
}

export function clearPlayer() {
  if (_capsule) { _capsule.dispose(); _capsule = null; }
  _camera = null;
  _velY   = 0;
}

export function getPlayerPosition() {
  if (!_capsule) return new BABYLON.Vector3(0, 0, 0);
  return new BABYLON.Vector3(_capsule.position.x, _capsule.position.y, _capsule.position.z);
}