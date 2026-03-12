// scatter.js — Vegetation sprites + grass + shelter placement
// v1 depth fix: sprites in renderingGroup 1 + scene group 1 does NOT clear depth.
// This guarantees sprites depth-test against terrain (group 0) correctly.

import { scene }      from './core.js';
import { getTerrainY, getWorldSize } from './terrain/terrainMesh.js';
import { spreadPositions }           from './terrain/terrainBounds.js';
import { resolveUrl }                from './config.js';

// ─── Module state ──────────────────────────────────────────────────────────────
let _sprites     =[];    // all sprite billboard meshes
let _grassTiles  = [];    // ThinInstance meshes
let _shelters    =[];    // placement positions [{x,y,z}]

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
  const bgColors = new Map(); // frameId -> [r,g,b] normalized 0-1

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
            bgColors.set(frame.id, [bgR, bgG, bgB]);
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
          const t = new BABYLON.Texture(url, scene, false, true, BABYLON.Texture.NEAREST_SAMPLINGMODE);
          t.hasAlpha = true;
          _atlasCache[url] = t;
          if (t.isReady()) { resolve(); }
          else { t.onLoadObservable.addOnce(() => resolve()); }
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
    const tex  = base ? base.clone() : new BABYLON.Texture(url, scene, false, true, BABYLON.Texture.NEAREST_SAMPLINGMODE);
    tex.hasAlpha = true;
    tex.uOffset  = frame.x / atlasW;
    tex.vOffset  = 1.0 - (frame.y + frame.h) / atlasH;
    tex.uScale   = frame.w / atlasW;
    tex.vScale   = frame.h / atlasH;

    const mat = new BABYLON.StandardMaterial('spr_' + (_spriteMatCount++), scene);
    mat.diffuseTexture  = tex;

    //[FIX APPLIED] Use Alpha Testing (cutout) to fix depth sorting and green square issues
    mat.useAlphaFromDiffuseTexture = true;
    mat.transparencyMode           = BABYLON.Material.MATERIAL_ALPHATEST;

    mat.backFaceCulling = false;
    mat.specularColor   = new BABYLON.Color3(0, 0, 0);

    if (_spriteMatCount <= 6) {
      console.log('[scatter] SpriteMat:', frame.id,
        '| uOff:', tex.uOffset.toFixed(3), 'vOff:', tex.vOffset.toFixed(3),
        'uSc:', tex.uScale.toFixed(3), 'vSc:', tex.vScale.toFixed(3));
    }
    return mat;
  }

  // Preload atlas images and wait until all are loaded before scattering
  await _preloadAtlases(sheets);

  // Debug: log sheet inventory
  const treeSheets = sheets.filter(s => s.class === 'tree');
  const vegSheets  = sheets.filter(s => s.class === 'veg' || !s.class);
  console.log('[scatter] Sheets — trees:', treeSheets.length,
    '| veg:', vegSheets.length,
    '| total frames:', sheets.reduce((n,s)=>n+s.frames.length,0));

  // Strict: only render what exists. No cross-class fallback.
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
  
  // [FIX APPLIED] Grass function is disabled below until you have a grass texture ready. 
  // Once you add a transparent grass texture, uncomment this line!
  // _buildGrass(flatAreas);
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

// ─── Grass (ThinInstances) ─────────────────────────────────────────────────────
function _buildGrass(flatAreas) {
  if (!flatAreas.length) return;

  const GRASS_STEP = 2.2;
  const GRASS_W    = 0.5;
  const GRASS_H    = 0.6;
  const worldSize  = getWorldSize();
  const half       = worldSize / 2;

  // Sample subset of flat areas at grass density
  const positions =[];
  for (let z = -half + 6; z < half - 6; z += GRASS_STEP) {
    for (let x = -half + 6; x < half - 6; x += GRASS_STEP) {
      const wx = x + (Math.random() - 0.5) * 1.2;
      const wz = z + (Math.random() - 0.5) * 1.2;
      const wy = getTerrainY(wx, wz);
      const elev = wy / 80;
      if (elev > 0.5 || elev < 0.0) continue;
      if (Math.random() > 0.35) continue;  // thin out
      positions.push(wx, wy, wz);
    }
  }

  if (!positions.length) return;

  const proto = BABYLON.MeshBuilder.CreatePlane('gGrass', {
    width: GRASS_W, height: GRASS_H
  }, scene);
  proto.renderingGroupId = 1;  // after terrain depth pass
  proto.isPickable = false;

  const mat = new BABYLON.StandardMaterial('gGrassMat', scene);

  // [FIX APPLIED] Changed from solid opaque green to Alpha Tested texture.
  // Ensure you have a 'grass.png' file in your assets folder for this!
  const grassTex = new BABYLON.Texture(resolveUrl('grass.png'), scene);
  grassTex.hasAlpha = true;
  
  mat.diffuseTexture             = grassTex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode           = BABYLON.Material.MATERIAL_ALPHATEST;
  
  mat.backFaceCulling        = false;
  mat.specularColor          = new BABYLON.Color3(0, 0, 0);
  mat.needAlphaBlending      = () => false;
  mat.freeze();
  proto.material = mat;

  // Build matrix buffer
  const count = positions.length / 3;
  const matrices = new Float32Array(count * 16);
  const tmpMatrix = new BABYLON.Matrix();

  for (let i = 0; i < count; i++) {
    const wx = positions[i * 3];
    const wy = positions[i * 3 + 1];
    const wz = positions[i * 3 + 2];
    const rot = Math.random() * Math.PI * 2;
    BABYLON.Matrix.ComposeToRef(
      new BABYLON.Vector3(1, 1, 1),
      BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Up(), rot),
      new BABYLON.Vector3(wx, wy + GRASS_H * 0.5, wz),
      tmpMatrix
    );
    tmpMatrix.copyToArray(matrices, i * 16);
  }

  proto.thinInstanceSetBuffer('matrix', matrices, 16, true);
  proto.freezeWorldMatrix();
  _grassTiles.push(proto);

  console.log(`[scatter] Grass: ${count} blades`);
}

// ─── Shelter positions ─────────────────────────────────────────────────────────
export function getShelterPositions() { return _shelters; }