// terrain/terrainBounds.js — Flat area scanner for waypoint nav + shelter placement
import { getHeightmapData, getTerrainY, getWorldSize, getHeightScale } from './terrainMesh.js';

// Returns array of {x, y, z} world positions that are:
//   - Below maxElevationFrac of total height
//   - Slope < maxSlope (0=steep, 1=flat)
//   - Not within waterY (if provided)
export function scanFlatAreas({ stepSize = 12, maxElevationFrac = 0.55, maxSlope = 0.7, waterY = null } = {}) {
  const hmData    = getHeightmapData();
  const worldSize = getWorldSize();
  const hScale    = getHeightScale();
  if (!hmData) return [];

  const results = [];
  const half    = worldSize / 2;

  for (let z = -half + stepSize; z < half - stepSize; z += stepSize) {
    for (let x = -half + stepSize; x < half - stepSize; x += stepSize) {
      const y = getTerrainY(x, z);
      if (y / hScale > maxElevationFrac) continue;
      if (waterY !== null && y <= waterY + 0.5) continue;

      // Approximate slope by sampling neighbours
      const dy = Math.abs(getTerrainY(x + stepSize, z) - y) +
                 Math.abs(getTerrainY(x - stepSize, z) - y) +
                 Math.abs(getTerrainY(x, z + stepSize) - y) +
                 Math.abs(getTerrainY(x, z - stepSize) - y);
      const slope = dy / (4 * stepSize);
      if (slope > (1 - maxSlope) * 0.4) continue;

      results.push({ x, y, z });
    }
  }
  console.log(`[terrainBounds] ${results.length} flat positions (step=${stepSize})`);
  return results;
}

// Return a random flat position at least minDist from origin
export function randomFlatPosition(flatAreas, minDist = 30) {
  if (!flatAreas.length) return new BABYLON.Vector3(0, 2, 0);
  const valid = flatAreas.filter(p => Math.sqrt(p.x * p.x + p.z * p.z) >= minDist);
  const arr   = valid.length ? valid : flatAreas;
  const p     = arr[Math.floor(Math.random() * arr.length)];
  return new BABYLON.Vector3(p.x, p.y + 0.5, p.z);
}

// Return N positions spread far apart (for shelter / structure placement)
export function spreadPositions(flatAreas, count, minSep = 40) {
  const results = [];
  const pool    = [...flatAreas].sort(() => Math.random() - 0.5);
  for (const p of pool) {
    if (results.length >= count) break;
    const ok = results.every(r => {
      const dx = r.x - p.x, dz = r.z - p.z;
      return Math.sqrt(dx * dx + dz * dz) >= minSep;
    });
    if (ok) results.push(p);
  }
  return results;
}
