// terrain/terrainMesh.js — Build BJS GroundMesh from heightmap + apply ShaderMaterial
// v1: Clean rewrite. Slope-blended dirt/rock textures. No shadow blit complexity.
// Depth fix: terrain forced opaque with needAlphaBlending/needAlphaTesting overrides.

import { scene } from '../core.js';
import { loadHeightmap, sampleHeight } from './heightmap.js';

let _mesh    = null;
let _hmData  = null;
let _worldSize = 700;
let _heightScale = 80;

export function getTerrainMesh() { return _mesh; }
export function getHeightmapData() { return _hmData; }
export function getWorldSize() { return _worldSize; }
export function getHeightScale() { return _heightScale; }

// Get world-space Y for a given XZ position
export function getTerrainY(x, z) {
  if (!_hmData) return 0;
  const u = (x + _worldSize / 2) / _worldSize;
  const v = (z + _worldSize / 2) / _worldSize;
  const h01 = sampleHeight(_hmData, u, v);
  return h01 * _heightScale;
}

// ─── Build terrain from config ────────────────────────────────────────────────
export async function buildTerrain(cfg, hmUrl, nodeMats) {
  // Dispose old
  if (_mesh) { _mesh.dispose(); _mesh = null; }

  _worldSize   = cfg.size   ?? 700;
  _heightScale = cfg.heightScale ?? 80;
  const subdiv = cfg.subdivisions ?? 128;

  // Load heightmap pixels
  _hmData = await loadHeightmap(hmUrl);

  // Create BJS GroundMesh
  _mesh = BABYLON.MeshBuilder.CreateGround('terrain', {
    width:  _worldSize,
    height: _worldSize,
    subdivisions: subdiv,
    updatable: true,
  }, scene);

  // Stamp vertex heights from heightmap
  _stampHeights(_mesh, _hmData, _worldSize, _heightScale);
  _stampSlopeAlpha(_mesh);

  _mesh.isPickable    = false;
  _mesh.checkCollisions = false;
  _mesh.renderingGroupId = 0;
  _mesh.receiveShadows   = true;

  // Apply material
  if (nodeMats) {
    _applyShaderMaterial(_mesh, nodeMats, _heightScale);
  } else {
    _applyFallbackMaterial(_mesh);
  }

  return _mesh;
}

// ─── Height stamping ──────────────────────────────────────────────────────────
function _stampHeights(mesh, hmData, worldSize, hScale) {
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const count = positions.length / 3;
  let minH = Infinity, maxH = -Infinity;

  for (let i = 0; i < count; i++) {
    const wx = positions[i * 3];
    const wz = positions[i * 3 + 2];
    const u  = (wx + worldSize / 2) / worldSize;
    const v  = (wz + worldSize / 2) / worldSize;
    const h  = sampleHeight(hmData, u, v) * hScale;
    positions[i * 3 + 1] = h;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }

  mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
  mesh.createNormals(true);
  mesh.refreshBoundingInfo();
  console.log(`[terrain] Heights stamped | min:${minH.toFixed(1)} max:${maxH.toFixed(1)} verts:${count}`);
}

// Bake slope (dot(normal,up)) into vertex colour alpha
// alpha=1 → flat (dirt), alpha=0 → steep (rock)
function _stampSlopeAlpha(mesh) {
  const normals   = mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const count     = positions.length / 3;
  const colors    = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const ny    = normals[i * 3 + 1];
    const slope = Math.max(0, Math.min(1, ny));
    colors[i * 4]     = 1;
    colors[i * 4 + 1] = 1;
    colors[i * 4 + 2] = 1;
    colors[i * 4 + 3] = slope;   // α: 1=flat/dirt, 0=steep/rock
  }
  mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors, false);
}

// ─── Shader Material (rock/dirt slope blend) ──────────────────────────────────
function _applyShaderMaterial(mesh, nodeMats, hScale) {
  const rocks = nodeMats.rocks || {};
  const dirt  = nodeMats.dirt  || {};

  const rUS  = (rocks.uScale    ?? 3.0).toFixed(2);
  const rVS  = (rocks.vScale    ?? 3.0).toFixed(2);
  const rMin = (1.0 - (rocks.maxSlope   ?? 1.0)).toFixed(3);
  const rFal = (rocks.slopeFalloff ?? 0.1).toFixed(3);

  const dUS  = (dirt.uScale    ?? 6.0).toFixed(2);
  const dVS  = (dirt.vScale    ?? 6.0).toFixed(2);
  const dMax = (1.0 - (dirt.minSlope   ?? 0.0)).toFixed(3);
  const dFal = (dirt.slopeFalloff ?? 0.1).toFixed(3);

  const key = `tShd_${rUS}_${dUS}`;

  BABYLON.Effect.ShadersStore[key + 'VertexShader'] = `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec2 uv;
    attribute vec4 color;
    uniform mat4 worldViewProjection;
    uniform mat4 world;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec4 vColor;
    void main() {
      vNormal = normalize(mat3(world) * normal);
      vUV     = uv;
      vColor  = color;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }
  `;

  BABYLON.Effect.ShadersStore[key + 'FragmentShader'] = `
    precision highp float;
    varying vec3 vNormal;
    varying vec2 vUV;
    varying vec4 vColor;
    uniform sampler2D rockTex;
    uniform sampler2D dirtTex;
    uniform float rUS; uniform float rVS;
    uniform float dUS; uniform float dVS;
    uniform float rMin; uniform float rFal;
    uniform float dMax; uniform float dFal;
    uniform vec3 uRockTint;
    uniform vec3 uDirtTint;
    void main() {
      float slope = vColor.a;          // 1=flat, 0=steep
      vec4 rock = texture2D(rockTex, vUV * vec2(rUS, rVS));
      vec4 dirt = texture2D(dirtTex, vUV * vec2(dUS, dVS));

      // Apply env color tints
      rock.rgb *= uRockTint;
      dirt.rgb *= uDirtTint;

      // Rock on steep faces
      float rBlend = smoothstep(rMin, rMin + rFal, 1.0 - slope);

      vec4 col = mix(dirt, rock, rBlend);
      gl_FragColor = col;
    }
  `;

  const greyPx = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const mat = new BABYLON.ShaderMaterial(key, scene, key, {
    attributes: ['position', 'normal', 'uv', 'color'],
    uniforms:   ['worldViewProjection', 'world', 'rUS', 'rVS', 'dUS', 'dVS', 'rMin', 'rFal', 'dMax', 'dFal', 'uRockTint', 'uDirtTint'],
    samplers:   ['rockTex', 'dirtTex'],
  });

  mat.setTexture('rockTex', new BABYLON.Texture(rocks.url || greyPx, scene));
  mat.setTexture('dirtTex', new BABYLON.Texture(dirt.url  || greyPx, scene));
  mat.setFloat('rUS', parseFloat(rUS));
  mat.setFloat('rVS', parseFloat(rVS));
  mat.setFloat('dUS', parseFloat(dUS));
  mat.setFloat('dVS', parseFloat(dVS));
  mat.setFloat('rMin', parseFloat(rMin));
  mat.setFloat('rFal', parseFloat(rFal));
  mat.setFloat('dMax', parseFloat(dMax));
  mat.setFloat('dFal', parseFloat(dFal));
  // Default tints (white = no tint). Overridden by applyTerrainTints().
  mat.setVector3('uRockTint', new BABYLON.Vector3(1, 1, 1));
  mat.setVector3('uDirtTint', new BABYLON.Vector3(1, 1, 1));
  mat.backFaceCulling = true;

  // ⚠️ CRITICAL: Force terrain into opaque render queue.
  // ShaderMaterial doesn't honour transparencyMode alone —
  // vertex colour.a (slope data) can trigger alpha-blend sorting.
  mat.transparencyMode    = BABYLON.Material.MATERIAL_OPAQUE;
  mat.needAlphaBlending   = () => false;
  mat.needAlphaTesting    = () => false;

  mesh.material = mat;
  console.log('[terrain] ShaderMaterial applied | rock:', rocks.url, '| dirt:', dirt.url);
}

function _applyFallbackMaterial(mesh) {
  const mat = new BABYLON.StandardMaterial('terrainFallback', scene);
  mat.useVertexColors  = true;
  mat.backFaceCulling  = true;
  mat.specularColor    = BABYLON.Color3.Black();
  mat.diffuseColor     = BABYLON.Color3.White();
  mesh.material = mat;
  console.log('[terrain] Fallback vertex-colour material applied');
}

// Dispose terrain (called on level reload)
// Apply env color palette as rock/dirt tints
// colorArr: [{ name, hex }, ...] — uses first two entries as rock tint, dirt tint
export function applyTerrainTints(colorArr) {
  if (!_mesh || !_mesh.material) return;
  const mat = _mesh.material;

  function hexToVec3(hex) {
    const h = hex.replace('#', '');
    return new BABYLON.Vector3(
      parseInt(h.substring(0,2),16)/255,
      parseInt(h.substring(2,4),16)/255,
      parseInt(h.substring(4,6),16)/255
    );
  }

  if (colorArr && colorArr.length >= 2) {
    const rockCol = colorArr.find(c => c.name?.toLowerCase().includes('rock'))
                  ?? colorArr.find(c => c.name?.toLowerCase().includes('stone'))
                  ?? colorArr[0];
    const dirtCol = colorArr.find(c => c.name?.toLowerCase().includes('dirt'))
                  ?? colorArr.find(c => c.name?.toLowerCase().includes('soil'))
                  ?? colorArr.find(c => c.name?.toLowerCase().includes('ground'))
                  ?? colorArr[1];
    if (rockCol?.hex) {
      mat.setVector3('uRockTint', hexToVec3(rockCol.hex));
      console.log('[terrain] Rock tint:', rockCol.name, rockCol.hex);
    }
    if (dirtCol?.hex) {
      mat.setVector3('uDirtTint', hexToVec3(dirtCol.hex));
      console.log('[terrain] Dirt tint:', dirtCol.name, dirtCol.hex);
    }
  }
}

export function disposeTerrain() {
  if (_mesh) {
    if (_mesh.material) { _mesh.material.dispose(); }
    _mesh.dispose();
    _mesh = null;
  }
  _hmData = null;
}