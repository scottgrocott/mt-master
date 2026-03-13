// scatter.js — Vegetation sprites + grass + shelter placement
// v1 depth fix: sprites in renderingGroup 1 + scene group 1 does NOT clear depth.
// This guarantees sprites depth-test against terrain (group 0) correctly.
// BUILD: 2026-03-12-v3
console.log('[scatter] v3 loaded');

import { scene }      from './core.js';
import { getTerrainY, getWorldSize } from './terrain/terrainMesh.js';
import { spreadPositions }           from './terrain/terrainBounds.js';
import { resolveUrl }                from './config.js';

// ─── Module state ──────────────────────────────────────────────────────────────
let _sprites     = [];   // all sprite billboard meshes
let _grassTiles  = [];   // ThinInstance meshes
let _shelters    = [];   // placement positions [{x,y,z}]

// ─── Init: configure depth pass for group 1 ────────────────────────────────────
// Call once after scene created. Group 0 = terrain (writes depth).
// Group 1 = sprites (reads terrain depth, must NOT clear it).
export function initScatterDepth() {
  scene.setRenderingAutoClearDepthStencil(1, false, false, false);
  console.log('[scatter] Depth pass: group 1 inherits group 0 depth buffer');
}

// ─── Clear ─────────────────────────────────────────────────────────────────────
export function clearScatter() {
  for (const m of _sprites) { if (m.material) m.material.dispose(); m.dispose(); }
  for (const m of _grassTiles) m.dispose();
  _sprites    = [];
  _grassTiles =[];
  _shelters   =[];
}

// ─── Main scatter entry point ──────────────────────────────────────────────────
// flatAreas: output of scanFlatAreas()
// sheets: spriteSheets array from environment sprites.json
// shelterCount: how many shelter positions to reserve
// Sample an atlas frame via canvas to check if it has meaningful content.
// Returns true if the frame has enough non-background pixels to be worth rendering.
async function _filterEmptyFrames(sheets) {
  const results = new Map();  // frameId -> bool
  const bgColors = new Map(); // frameId ->[r,g,b] normalized 0-1

  for (const sheet of sheets) {
    const url      = resolveUrl(sheet.url);
    const atlasW   = sheet.cellWidth  * sheet.columns;
    const atlasH   = sheet.cellHeight * sheet.rows;

    // Load image via browser
    await new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = atlasW;
        canvas.height = atlasH;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);

        for (const frame of sheet.frames) {
          try {
            const px = ctx.getImageData(frame.x, frame.y, frame.w, frame.h).data;
            const nPx = frame.w * frame.h;

            // Compute average color of frame
            let sumR=0, sumG=0, sumB=0, sumA=0;
            for (let i = 0; i < px.length; i += 4) {
              sumR += px[i]; sumG += px[i+1]; sumB += px[i+2]; sumA += px[i+3];
            }
            const avgR = sumR/nPx, avgG = sumG/nPx, avgB = sumB/nPx, avgA = sumA/nPx;

            // Compute variance — low variance = uniform/solid = empty frame
            let variance = 0;
            for (let i = 0; i < px.length; i += 4) {
              const dr = px[i]-avgR, dg = px[i+1]-avgG, db = px[i+2]-avgB;
              variance += dr*dr + dg*dg + db*db;
            }
            variance /= nPx;

            // Fully transparent frame
            if (avgA < 15) { results.set(frame.id, false); continue; }
            // Near-uniform solid color = background fill = empty
            if (variance < 800) { 
              results.set(frame.id, false); 
              continue; 
            }
            if (variance < 5000) {
              console.log('[scatter] KEPT low-var frame:', frame.id, 'var:', Math.round(variance), 'avg:', Math.round(avgR), Math.round(avgG), Math.round(avgB), 'a:', Math.round(avgA));
            }
            // Sample all 4 corners to get bg color, detect if PNG has real alpha
            const corners =[
              ctx.getImageData(frame.x,           frame.y,           1, 1).data,
              ctx.getImageData(frame.x+frame.w-1, frame.y,           1, 1).data,
              ctx.getImageData(frame.x,           frame.y+frame.h-1, 1, 1).data,
              ctx.getImageData(frame.x+frame.w-1, frame.y+frame.h-1, 1, 1).data,
            ];
            // Average corner colors for bg reference
            const bgR = corners.reduce((s,p)=>s+p[0],0)/4/255;
            const bgG = corners.reduce((s,p)=>s+p[1],0)/4/255;
            const bgB = corners.reduce((s,p)=>s+p[2],0)/4/255;
            // Has alpha if any corner is transparent
            const hasAlpha = corners.some(p => p[3] < 200);
            bgColors.set(frame.id,[bgR, bgG, bgB]);
            frame._hasAlpha = hasAlpha;
            results.set(frame.id, true);
          } catch(e) {
            results.set(frame.id, true);
            bgColors.set(frame.id,[0, 0.5, 0]); // default green
          }
        }
        resolve();
      };
      img.onerror = () => {
        // Can't load = keep all frames
        sheet.frames.forEach(f => results.set(f.id, true));
        resolve();
      };
      img.src = url;
    });
  }

  // Filter frames and attach bgColor
  let removed = 0;
  for (const sheet of sheets) {
    const before = sheet.frames.length;
    sheet.frames = sheet.frames.filter(f => results.get(f.id) !== false);
    // Attach sampled bg color to each kept frame
    for (const f of sheet.frames) {
      f._bgColor   = bgColors.get(f.id) ??[0, 0.5, 0];
      // _hasAlpha already set on frame object during canvas scan
    }
    removed += before - sheet.frames.length;
  }
  console.log('[scatter] Frame filter: removed', removed, 'empty frames');
  return sheets;
}

export async function scatterProps(flatAreas, sheets, shelterCount = 6) {
  if (!flatAreas.length || !sheets.length) {
    console.warn('[scatter] No flat areas or sprite sheets — skipping');
    return;
  }

  // Filter out empty/placeholder atlas frames before scattering
  await _filterEmptyFrames(sheets);

  // Reserve shelter positions first (spread far apart)
  _shelters = spreadPositions(flatAreas, shelterCount, 40);

  // ── Sprite material: one texture+material per INSTANCE (exact original pattern)
  // Each billboard needs its own texture object for independent UV offsets.
  // We share the underlying GPU image via a preloaded base texture, then clone.
  const _atlasCache = {}; // url -> preloaded Texture (no UV offsets)
  let _spriteMatCount = 0;

  async function _preloadAtlases(sheets) {
    const loads =[];
    for (const sheet of sheets) {
      const url = resolveUrl(sheet.url);
      if (!_atlasCache[url]) {
        const p = new Promise(resolve => {
          // Pass onLoad and onError callbacks to prevent Babylon from hanging the Promise on 404
          const t = new BABYLON.Texture(url, scene, false, true, BABYLON.Texture.NEAREST_SAMPLINGMODE, 
            () => resolve(),
            () => {
              console.warn(`[scatter] Failed to load atlas texture: ${url}`);
              resolve(); 
            }
          );
          t.hasAlpha = true;
          _atlasCache[url] = t;
        });
        loads.push(p);
      }
    }
    await Promise.all(loads);
    console.log('[scatter] Atlases preloaded:', Object.keys(_atlasCache).length);
  }

  function _getFrameMat(sheet, frame) {
    const url    = resolveUrl(sheet.url);
    const atlasW = sheet.cellWidth  * sheet.columns;
    const atlasH = sheet.cellHeight * sheet.rows;

    // Clone the preloaded atlas — clone shares the GPU texture but gets its own matrix
    const base = _atlasCache[url];
    // If the image 404'd, base might be an invalid texture, but Babylon handles it silently or uses a fallback
    const tex  = base ? base.clone() : new BABYLON.Texture(url, scene, false, true, BABYLON.Texture.NEAREST_SAMPLINGMODE);
    tex.hasAlpha = true;
    tex.uOffset  = frame.x / atlasW;
    tex.vOffset  = 1.0 - (frame.y + frame.h) / atlasH;
    tex.uScale   = frame.w / atlasW;
    tex.vScale   = frame.h / atlasH;

    const mat = new BABYLON.StandardMaterial('spr_' + (_spriteMatCount++), scene);
    mat.diffuseTexture  = tex;

    // Use Alpha Testing (cutout) to fix depth sorting and green square issues
    mat.useAlphaFromDiffuseTexture = true;
    mat.transparencyMode           = BABYLON.Material.MATERIAL_ALPHATEST;

    mat.backFaceCulling = false;
    mat.specularColor   = new BABYLON.Color3(0, 0, 0);

    return mat;
  }

  // Preload atlas images and wait until all are loaded before scattering
  await _preloadAtlases(sheets);

  const treeSheets = sheets.filter(s => s.class === 'tree');
  const vegSheets  = sheets.filter(s => s.class === 'veg' || !s.class);
  console.log('[scatter] Sheets — trees:', treeSheets.length,
    '| veg:', vegSheets.length,
    '| total frames:', sheets.reduce((n,s)=>n+s.frames.length,0));

  if (!treeSheets.length && !vegSheets.length) {
    console.warn('[scatter] No sprite sheets — skipping sprites');
    return;
  }

  // Place sprites on flat ground, avoiding shelter zones
  const worldSize = getWorldSize();
  const half      = worldSize / 2;
  const GRID_STEP = 14;
  const JITTER    = 5;

  let placed = 0;
  for (let z = -half + GRID_STEP; z < half - GRID_STEP; z += GRID_STEP) {
    for (let x = -half + GRID_STEP; x < half - GRID_STEP; x += GRID_STEP) {
      // Jitter
      const wx = x + (Math.random() - 0.5) * JITTER * 2;
      const wz = z + (Math.random() - 0.5) * JITTER * 2;
      const wy = getTerrainY(wx, wz);

      // Skip high elevation (rocky peaks)
      const elevFrac = wy / 80;
      if (elevFrac > 0.62) continue;

      // Skip near shelters
      const nearShelter = _shelters.some(s => {
        const dx = s.x - wx, dz = s.z - wz;
        return Math.sqrt(dx*dx + dz*dz) < 18;
      });
      if (nearShelter) continue;

      // Pick class — skip if that class has no sheets
      const wantTree = Math.random() < 0.35;
      const sheetPool = wantTree
        ? (treeSheets.length ? treeSheets : null)
        : (vegSheets.length  ? vegSheets  : null);
      if (!sheetPool) continue;  // that class absent, skip this slot
      // Pick randomly from ALL sheets of that class
      const sheet = sheetPool[Math.floor(Math.random() * sheetPool.length)];
      if (!sheet?.frames?.length) continue;

      const frame = sheet.frames[Math.floor(Math.random() * sheet.frames.length)];
      const heightScale = wantTree ? 1.0 : 0.6;

      _makeSprite(wx, wy, wz, sheet, frame, heightScale, _getFrameMat);
      placed++;
    }
  }

  console.log(`[scatter] Placed ${placed} sprites | shelters: ${_shelters.length} | unique mats: ${_spriteMatCount}`);
}

// ─── Sprite billboard ──────────────────────────────────────────────────────────
function _makeSprite(wx, wy, wz, sheet, frame, heightScale, getFrameMat) {
  const aspect = frame.w / frame.h;
  const h = heightScale * (1.5 + Math.random() * 1.5);  // taller for visibility
  const w = h * aspect;

  const mesh = BABYLON.MeshBuilder.CreatePlane('spr_' + frame.id, { width: w, height: h }, scene);
  mesh.position.set(wx, wy + h * 0.5, wz);
  mesh.billboardMode  = BABYLON.Mesh.BILLBOARDMODE_Y;
  mesh.isPickable     = false;
  // renderingGroupId stays 0 (default) — alpha blending requires group 0 in BJS 8

  mesh.material = getFrameMat(sheet, frame);
  _sprites.push(mesh);
}

// ─── Shelter positions ─────────────────────────────────────────────────────────
export function getShelterPositions() { return _shelters; }

// ─── Spawn Shelters (Optimized with AssetContainer) ────────────────────────────
export async function loadAndPlaceShelters(shelterUrls, shadowGenerator) {
  if (!_shelters || _shelters.length === 0) {
    console.warn('[scatter] No flat areas reserved for shelters — skipping.');
    return;
  }

  console.log(`[scatter] Spawning ${_shelters.length} shelters...`);
  const shelterCache = {}; // Cache containers to avoid multiple network loads

  const loads = _shelters.map(async (pos) => {
    const rawUrl = shelterUrls[Math.floor(Math.random() * shelterUrls.length)];
    const url = resolveUrl(rawUrl);

    const lastSlash = url.lastIndexOf('/');
    const rootUrl = url.substring(0, lastSlash + 1);
    const fileName = url.substring(lastSlash + 1);

    try {
      // 1. Load the GLTF container ONCE per shelter type
      if (!shelterCache[rawUrl]) {
        const container = await BABYLON.SceneLoader.LoadAssetContainerAsync(rootUrl, fileName, scene);
        // Clean up baked-in lights to avoid WebGL2 12-light limits
        container.lights.forEach(l => l.dispose());
        container.lights = [];
        shelterCache[rawUrl] = container;
      }

      // 2. Instantiate a zero-cost clone from the container
      const container = shelterCache[rawUrl];
      const instance = container.instantiateModelsToScene();
      const rootMesh = instance.rootNodes[0];

      // 3. Place it on the flat terrain area
      const wy = getTerrainY(pos.x, pos.z);
      rootMesh.position.set(pos.x, wy, pos.z);

      // 4. Give it a random Y rotation so they don't all face the same way
      rootMesh.rotationQuaternion = null;
      rootMesh.rotation.y = Math.random() * Math.PI * 2;

      // 5. Force world matrix propagation through full hierarchy
      rootMesh.computeWorldMatrix(true);
      const allMeshes = [rootMesh, ...rootMesh.getChildMeshes()];
      allMeshes.forEach(m => m.computeWorldMatrix(true));

      // 6. Shadows
      allMeshes.forEach(mesh => {
        if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) return;
        mesh.receiveShadows = true;
        if (shadowGenerator) shadowGenerator.addShadowCaster(mesh, true);
      });

      // 7. Single compound BOX collider around the whole shelter
      try {
        const worldBB = rootMesh.getHierarchyBoundingVectors(true);
        const sx = worldBB.max.x - worldBB.min.x;
        const sy = worldBB.max.y - worldBB.min.y;
        const sz = worldBB.max.z - worldBB.min.z;
        const cx = (worldBB.min.x + worldBB.max.x) / 2;
        const cy = (worldBB.min.y + worldBB.max.y) / 2;
        const cz = (worldBB.min.z + worldBB.max.z) / 2;
        console.log(`[scatter] Shelter BB: ${sx.toFixed(1)}x${sy.toFixed(1)}x${sz.toFixed(1)} centre Y=${cy.toFixed(1)}`);

        if (sx > 0.1 && sy > 0.1 && sz > 0.1) {
          const proxy = BABYLON.MeshBuilder.CreateBox('sh_col', {
            width: sx, height: sy, depth: sz
          }, scene);
          proxy.position.set(cx, cy, cz);
          proxy.isVisible  = false;
          proxy.isPickable = false;
          new BABYLON.PhysicsAggregate(
            proxy, BABYLON.PhysicsShapeType.BOX,
            { mass: 0, friction: 0.8, restitution: 0.0 },
            scene
          );
          console.log(`[scatter] Shelter collider created`);
        }
      } catch(e) {
        console.warn('[scatter] Shelter collider failed (shelter still visible):', e.message);
      }

      return rootMesh;
    } catch (err) {
      console.error(`[scatter] Failed to load shelter: ${fileName}`, err);
    }
  });

  await Promise.all(loads);
  console.log('[scatter] All shelters placed on flat ground.');
}

// ─── Bridge placement removed — see bridges.js ────────────────────────────────