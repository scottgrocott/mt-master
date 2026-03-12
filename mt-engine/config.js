// config.js — CONFIG singleton + asset URL resolver
// Relative asset URLs (starting with /mt-assets/) are rewritten to full CDN
// URLs on production, or localhost:8083 on local dev.

const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const BASE_CDN = 'https://scottgrocott.github.io';
const BASE_LOCAL = 'http://localhost:8083';

export function resolveUrl(url) {
  if (!url) return url;
  if (url.startsWith('http')) return url;           // already absolute
  if (url.startsWith('/')) {
    return (IS_LOCAL ? BASE_LOCAL : BASE_CDN) + url;
  }
  return url;
}

// Recursively resolve all string values in an object that look like URLs
export function resolveUrls(obj) {
  if (!obj) return obj;
  if (typeof obj === 'string') return resolveUrl(obj);
  if (Array.isArray(obj)) return obj.map(resolveUrls);
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = resolveUrls(obj[k]);
    return out;
  }
  return obj;
}

let _config = {};

export function getConfig() { return _config; }

export function setConfig(json) {
  _config = resolveUrls(json);
  console.log('[config] Set — terrain:', _config.terrain?.type,
    'enemies:', _config.enemies?.length ?? 0);
}

// Engine + game asset base paths (used by modules to build fetch URLs)
export const ASSETS = IS_LOCAL
  ? { root: BASE_LOCAL + '/mt-assets' }
  : { root: BASE_CDN  + '/mt-assets' };

console.log('[config] IS_LOCAL:', IS_LOCAL, '| base:', ASSETS.root);
