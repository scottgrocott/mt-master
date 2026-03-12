// main.js — Metal Throne Engine v1
// Entry point: boot → load level → build world → start game loop
//
// Social VR fork notes:
//   player.js  → replace with avatar.js (3rd person, no pointer lock, WebRTC)
//   levelManager.js → replace with roomManager.js (Node socket sync)
//   Everything else (terrain, scatter, audio, enemies) is untouched.

import { engine, scene, camera }    from './core.js';
import { initPhysics, attachTerrainCollider, resetPhysics } from './physics.js';
import { initSky, getSunLight }      from './sky.js';
import { getConfig, setConfig, ASSETS, resolveUrl } from './config.js';
import { loadEnvironment, loadSprites, loadSounds, loadMusic } from './environment.js';
import { buildTerrain, getTerrainY, disposeTerrain, applyTerrainTints } from './terrain/terrainMesh.js';
import { scanFlatAreas }             from './terrain/terrainBounds.js';
import { initScatterDepth, clearScatter, scatterProps, getShelterPositions } from './scatter.js';
import { initAudio }                 from './audio/audio.js';
import { initSoundscape, initMusic, clearSoundtrack } from './audio/soundtrack.js';
import { initLook, setLookCamera }   from './look.js';
import { initInput }                 from './input.js';
import { initPlayer, clearPlayer }   from './player.js';
import { initHUD, updateHUD }        from './ui/hud.js';
import { initMinimap, updateMinimap, clearMinimap } from './minimap.js';

// ─── Audio URL cache (set during level build, read after user gesture) ─────────
let _soundsUrl = null;
let _musicUrl  = null;

// ─── Level URL ────────────────────────────────────────────────────────────────
function _getLevelUrl() {
  const params = new URLSearchParams(location.search);
  const lvl    = params.get('level') ?? '0';
  const base   = location.hostname === 'localhost'
    ? 'http://localhost:8083/mt-games/drone-wars/v1/'
    : 'https://scottgrocott.github.io/mt-games/drone-wars/v1/';
  const url = lvl.startsWith('http') ? lvl : `${base}level-${lvl}.json`;
  console.log('[main] Level URL:', url);
  return url;
}

// ─── Load level JSON ──────────────────────────────────────────────────────────
async function _loadLevel(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('[main] Failed to fetch level: ' + url);
  return r.json();
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  setStatus('INITIALIZING PHYSICS', 5);
  await initPhysics();

  setStatus('INITIALIZING SKY', 10);
  initSky();

  setStatus('SETTING UP CONTROLS', 14);
  initLook(camera, scene);
  initInput(scene);
  setLookCamera(camera);

  // Configure scene render groups for correct depth handling
  // Group 0 = opaque terrain + opaque grass
  // Group 1 = alpha-tested sprites (inherit group 0 depth, NOT cleared)
  initScatterDepth();

  setStatus('LOADING LEVEL', 18);
  const levelUrl = _getLevelUrl();
  const levelJson = await _loadLevel(levelUrl);
  setConfig(levelJson);

  await _buildLevel(levelJson);

  // HUD + minimap
  initHUD();
  initMinimap(scene, camera);

  // Top bar download buttons
  _initTopBar(levelUrl, levelJson);

  // Splash play button
  const meta = levelJson.meta || {};
  window._setSplashContent?.(meta.title || 'Metal Throne', levelJson.splash_screen || '');
  window._splashShowPlay?.();

  // Start audio on gesture
  document.addEventListener('splash-dismissed', _startAudio, { once: true });

  // Game loop
  scene.registerBeforeRender(_tick);

  console.log('[main] Boot complete');
}

// ─── Build Level ──────────────────────────────────────────────────────────────
async function _buildLevel(cfg) {
  const tc = cfg.terrain || {};

  // Pick a random heightmap from the array
  const hmDefs = tc.heightmaps || [];
  const hmDef  = hmDefs[Math.floor(Math.random() * hmDefs.length)] || {};
  const hmUrl  = resolveUrl(hmDef.url);
  const envTypes = (hmDef.environment?.types) || null;
  const shelterCount = hmDef.shelterCount ?? tc.shelterCount ?? 6;

  setStatus('LOADING ENVIRONMENT', 22);
  const env = await loadEnvironment(envTypes);

  setStatus('LOADING SPRITES', 30);
  const sheets = await loadSprites(env.spritesUrl);

  setStatus('BUILDING TERRAIN', 38);
  const terrainMesh = await buildTerrain(tc, hmUrl, env.nodeMats);
  if (env.colorArr?.length) applyTerrainTints(env.colorArr);

  setStatus('ATTACHING PHYSICS', 55);
  attachTerrainCollider(terrainMesh);

  setStatus('SCANNING TERRAIN', 60);
  const flatAreas = scanFlatAreas({ waterY: null });

  // Cache env audio URLs for post-gesture audio init
  _soundsUrl = env.soundsUrl;
  _musicUrl  = env.musicUrl;
  console.log('[main] Env audio URLs | sounds:', _soundsUrl, '| music:', _musicUrl);

  setStatus('SCATTERING PROPS', 65);
  await scatterProps(flatAreas, sheets, shelterCount);

  setStatus('SPAWNING PLAYER', 80);
  // Pick spawn: flat area closest to world center, not corner
  let spawnPos = new BABYLON.Vector3(0, 4, 0);
  if (flatAreas.length) {
    const sorted = [...flatAreas].sort((a, b) =>
      (a.x*a.x + a.z*a.z) - (b.x*b.x + b.z*b.z));
    const p = sorted[Math.floor(Math.random() * Math.min(8, sorted.length))];
    spawnPos = new BABYLON.Vector3(p.x + Math.random()*6-3, p.y + 2, p.z + Math.random()*6-3);
  }

  initPlayer(scene, camera, spawnPos);

  // Apply fog
  if (cfg.fog?.enabled) _applyFog(cfg.fog);

  setStatus('READY', 100);
}

// ─── Fog ──────────────────────────────────────────────────────────────────────
function _applyFog(fogCfg) {
  scene.fogMode    = BABYLON.Scene[fogCfg.mode] ?? BABYLON.Scene.FOGMODE_LINEAR;
  scene.fogColor   = new BABYLON.Color3(fogCfg.color?.r ?? 0.6, fogCfg.color?.g ?? 0.65, fogCfg.color?.b ?? 0.7);
  scene.fogDensity = fogCfg.density ?? 0.02;
  scene.fogStart   = fogCfg.start   ?? 160;
  scene.fogEnd     = fogCfg.end     ?? 520;
}

// ─── Audio ────────────────────────────────────────────────────────────────────
async function _startAudio() {
  const cfg = getConfig();
  console.log('[main] _startAudio | soundsUrl:', _soundsUrl, '| musicUrl:', _musicUrl);
  await initAudio(cfg.audio?.channels ?? {});
  if (_soundsUrl) {
    await initSoundscape(_soundsUrl);
  } else {
    console.warn('[main] No soundsUrl on config — soundscape skipped');
  }
  if (_musicUrl) {
    await initMusic(_musicUrl);
  } else {
    console.warn('[main] No musicUrl on config — music skipped');
  }
  console.log('[main] Audio started');
}

// ─── Game tick ────────────────────────────────────────────────────────────────
function _tick() {
  const cfg = getConfig();
  const pc  = scene.getMeshByName('playerCapsule');
  if (!pc) return;

  // HUD
  updateHUD({ health: 100, ammo: '∞', enemies: 0,
    pos: `${pc.position.x.toFixed(0)},${pc.position.y.toFixed(0)},${pc.position.z.toFixed(0)}` });

  // Minimap
  updateMinimap(camera);
}

// ─── Top bar download buttons ─────────────────────────────────────────────────
function _initTopBar(levelUrl, levelJson) {
  const bar = document.getElementById('top-bar');
  if (!bar) return;

  // Download level-0.json
  const btnLevel = document.createElement('button');
  btnLevel.textContent = '⬇ level-0.json';
  btnLevel.title = 'Download current level JSON template';
  btnLevel.addEventListener('click', () => {
    _download('level-0.json', JSON.stringify(levelJson, null, 2), 'application/json');
    window._gaEvent?.('download', { file: 'level-0.json' });
  });
  bar.appendChild(btnLevel);

  // Download index.html
  const btnIndex = document.createElement('button');
  btnIndex.textContent = '⬇ index.html';
  btnIndex.title = 'Download current game index.html template';
  btnIndex.addEventListener('click', async () => {
    const r = await fetch(location.href.split('?')[0]);
    const html = await r.text();
    _download('index.html', html, 'text/html');
    window._gaEvent?.('download', { file: 'index.html' });
  });
  bar.appendChild(btnIndex);
}

function _download(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ─── Status helper ────────────────────────────────────────────────────────────
function setStatus(msg, pct) {
  const el  = document.getElementById('load-status');
  const bar = document.getElementById('loading-bar');
  if (el)  el.textContent = msg.toUpperCase();
  if (bar) bar.style.width = (pct ?? 0) + '%';
}

// ─── Start ────────────────────────────────────────────────────────────────────
boot().catch(err => {
  console.error('[main] Boot failed:', err);
  setStatus('ERROR — SEE CONSOLE', 0);
});

// ─── Expose reload API ────────────────────────────────────────────────────────
window._reloadLevel = async () => {
  disposeTerrain();
  clearScatter();
  clearPlayer();
  clearMinimap();
  clearSoundtrack();
  resetPhysics();
  const url = _getLevelUrl();
  const j   = await _loadLevel(url);
  setConfig(j);
  await _buildLevel(j);
};