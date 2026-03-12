// environment.js — Load environments.json, pick one randomly from allowed types,
// return nodeMats (rocks/dirt), sprites JSON URL, and sounds config.

import { ASSETS, resolveUrl } from './config.js';

let _envCache = null;   // raw environments.json (cached after first load)

async function _getEnvData() {
  if (_envCache) return _envCache;
  const url = `${ASSETS.root}/terrain/environments/environments.json`;
  const r   = await fetch(url);
  if (!r.ok) throw new Error('[env] Failed to load environments.json: ' + url);
  _envCache = await r.json();
  return _envCache;
}

// Pick a random environment from the allowed types list.
// Returns { envId, name, nodeMats:{rocks,dirt}, spritesUrl, soundsUrl, colorsUrl, colors[] }
export async function loadEnvironment(allowedTypes) {
  const envData = await _getEnvData();
  const envs    = envData.environments;

  // Filter to allowed types (or use all if empty/null)
  const pool = (allowedTypes && allowedTypes.length)
    ? envs.filter(e => allowedTypes.includes(e.env_id))
    : envs;

  const picked = pool[Math.floor(Math.random() * pool.length)];
  if (!picked) throw new Error('[env] No matching environment for types: ' + allowedTypes);

  const a = picked.assets || {};
  const envId = picked.env_id;

  // Log raw asset paths to catch JSON misconfiguration
  console.log(`[env] ${envId} | rock_url: ${a.node_mat_rocks?.url} | dirt_url: ${a.node_mat_dirt?.url}`);

  // Build nodeMats — resolve URLs
  // Guard: if the URL doesn't contain the env_id, warn (data likely misconfigured)
  const rawRockUrl = a.node_mat_rocks?.url ?? '';
  const rawDirtUrl = a.node_mat_dirt?.url ?? '';
  const envSlug = envId.replace(/^env_/, '');
  if (rawRockUrl && !rawRockUrl.includes(envSlug)) {
    console.warn(`[env] WARNING: rock mat URL "${rawRockUrl}" doesn't match env "${envId}" — check environments.json`);
  }

  const rocks = a.node_mat_rocks ? {
    url:         resolveUrl(a.node_mat_rocks.url),
    uScale:      a.node_mat_rocks.uScale  ?? 3.0,
    vScale:      a.node_mat_rocks.vScale  ?? 3.0,
    maxSlope:    a.node_mat_rocks.maxSlope ?? 1.0,
    slopeFalloff:a.node_mat_rocks.slopeFalloff ?? 0.1,
  } : null;

  const dirt = a.node_mat_dirt ? {
    url:         resolveUrl(a.node_mat_dirt.url),
    uScale:      a.node_mat_dirt.uScale  ?? 6.0,
    vScale:      a.node_mat_dirt.vScale  ?? 6.0,
    minSlope:    a.node_mat_dirt.minSlope ?? 0.0,
    slopeFalloff:a.node_mat_dirt.slopeFalloff ?? 0.1,
  } : null;

  // Fetch colors
  let colors = {};
  if (a.colors) {
    try {
      const cr = await fetch(resolveUrl(a.colors));
      if (cr.ok) { const cj = await cr.json(); colors = cj.colors || {}; }
    } catch {}
  }
  // Fallback: use picked.colors array from master
  const colorArr = picked.colors || [];

  console.log(`[env] Loaded: ${picked.name} | rocks:${!!rocks} dirt:${!!dirt} colors:${colorArr.length}`);

  return {
    envId:      picked.env_id,
    name:       picked.name,
    nodeMats:   { rocks, dirt },
    spritesUrl: resolveUrl(a.sprites),
    soundsUrl:  resolveUrl(a.sounds),
    musicUrl:   resolveUrl(a.music),
    colorsUrl:  resolveUrl(a.colors),
    colors,         // object: { name: hex }
    colorArr,       // array:  [{ name, hex }]
  };
}

// Load sprites.json for an environment, return array of sheet defs
export async function loadSprites(spritesUrl) {
  if (!spritesUrl) return [];
  try {
    const r = await fetch(spritesUrl);
    if (!r.ok) return [];
    const j = await r.json();
    return j.spriteSheets || [];
  } catch { return []; }
}

// Load sounds.json for an environment
export async function loadSounds(soundsUrl) {
  if (!soundsUrl) return null;
  try {
    const r = await fetch(soundsUrl);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Load music.json for an environment
export async function loadMusic(musicUrl) {
  if (!musicUrl) return null;
  try {
    const r = await fetch(musicUrl);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}