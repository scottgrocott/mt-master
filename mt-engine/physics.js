// physics.js — Havok physics init + terrain trimesh collider
import { scene } from './core.js';

let _hk  = null;
let _plugin = null;
let _terrainAggregate = null;

export function safeVec3(v) {
  const x = isFinite(v?.x) ? v.x : 0;
  const y = isFinite(v?.y) ? v.y : 0;
  const z = isFinite(v?.z) ? v.z : 0;
  return new BABYLON.Vector3(x, y, z);
}

export async function initPhysics() {
  if (_plugin) return _plugin;

  // Timeout guard — if HK never resolves, fail loudly instead of hanging
  const hkTimeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('HavokPhysics WASM timed out — check CDN script in index.html')), 8000)
  );
  try {
    _hk = await Promise.race([window.HK, hkTimeout]);
  } catch(e) {
    console.error('[physics] Havok init failed:', e.message);
    throw e;
  }

  _plugin = new BABYLON.HavokPlugin(true, _hk);
  scene.enablePhysics(new BABYLON.Vector3(0, -18, 0), _plugin);
  _plugin.setTimeStep(1 / 60);
  console.log('[physics] Havok world ready');
  return _plugin;
}

export function attachTerrainCollider(terrainMesh) {
  if (_terrainAggregate) {
    _terrainAggregate.dispose();
    _terrainAggregate = null;
  }
  _terrainAggregate = new BABYLON.PhysicsAggregate(
    terrainMesh,
    BABYLON.PhysicsShapeType.MESH,
    { mass: 0, restitution: 0.1, friction: 0.8 },
    scene
  );
  console.log('[physics] Terrain collider attached (Havok trimesh)');
  return _terrainAggregate;
}

export function disposeTerrainCollider() {
  if (_terrainAggregate) { _terrainAggregate.dispose(); _terrainAggregate = null; }
}

export function resetPhysics() {
  disposeTerrainCollider();
  // Physics plugin itself is kept — only aggregates on disposable objects reset
}

export function getPlugin() { return _plugin; }