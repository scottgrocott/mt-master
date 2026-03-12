# Metal Throne Engine v1 — Architecture

## File Map

mt-engine/
  main.js              — boot, scene lifecycle, level load/reload
  core.js              — BJS engine + scene singleton
  config.js            — CONFIG store, getConfig/setConfig
  physics.js           — Havok init, terrain trimesh, safeVec3
  sky.js               — sky dome + sun directional light
  look.js              — FPS camera, pointer lock, mobile look
  input.js             — keyboard/gamepad/touch input
  player.js            — capsule collider, WASD movement, ladder
  minimap.js           — canvas minimap
  levelManager.js      — level progression, win/lose detection
  assetRegistry.js     — global preload map (preload once, instantiate many)

  terrain/
    heightmap.js       — PNG → pixel data
    terrainMesh.js     — GroundMesh + ShaderMaterial (slope-blended rock/dirt)
    terrainBounds.js   — flat area scan for nav + shelter placement

  audio/
    audio.js           — 4-channel gain bus (music/env/enemy/sfx)
    soundtrack.js      — Tone.js music + soundscape from JSON

  ui/
    hud.js             — HP/ammo/enemies/pos HUD elements
    splash.js          — loading screen, play button, level nav

  weapons/
    basicGun.js        — kinematic bullet pool, blaster bolt VFX + audio

  enemies/
    enemyBase.js       — shared YUKA entity, health, dead flag
    drones.js
    cars.js
    forklifts.js
    boats.js
    submarines.js

  scatter.js           — sprite billboards (ALPHATEST), grass ThinInstances, shelters

## Sprite Depth Fix (v1 correct approach)

Problem: Billboard ALPHATEST sprites show through terrain hills.
Root cause: BJS sorts ALPHATEST meshes back-to-front by bounding box center,
not by actual pixel depth. A distant sprite's bbox center can be "in front of"
a near hillside in screen-space sort, so it renders on top.

v1 solution: Custom depth pre-pass via ShaderMaterial on sprites.
- Keep sprites in renderingGroup 0 (same as terrain)
- Use a custom sprite ShaderMaterial that does manual gl_fragDepth write
- OR: use BJS's depthPrePass = true on terrain + alphaIndex trick

Simplest correct fix:
  terrain.alphaIndex = 0;          // renders first in opaque pass
  sprite.alphaIndex = 1;           // renders after terrain depth is written
  sprite transparencyMode = ALPHATEST (discard < 0.3, depth write ON)
  scene.setRenderingAutoClearDepthStencil(0, false) — NOT needed

Actually the real fix: StandardMaterial with ALPHATEST DOES write depth.
The issue is BJS uses camera distance to sort within the ALPHATEST bucket.
Setting mesh.alphaIndex = -1 on terrain forces it into the opaque pre-pass.
Use: terrain.material.transparencyMode = 0 (OPAQUE) — already done.
Use: sprite.material.transparencyMode = 1 (ALPHATEST) — already done.
The missing piece: BJS puts ALPHATEST meshes in the "transparent" bucket by
default if needAlphaBlending() returns true. We override that.
Final answer: scene.setRenderingAutoClearDepthStencil(1, false, false, false)
combined with sprites in group 1 is correct. If it's not working it means
the new scatter.js isn't deployed.

## Social VR Planning

All engine modules are ES modules with clean exports.
No global state except CONFIG and scene (both in singletons).
Enemy/scatter/audio systems all have init(scene, config) + clear() APIs.
This makes it trivial to fork:
  - Replace player.js (FPS) with avatar.js (third-person + WebRTC)
  - Replace levelManager.js with roomManager.js (Node.js socket sync)
  - Keep terrain, scatter, audio, enemy systems intact
  - Add peerConnection.js for WebRTC voice chat
  - Add sharedObjects.js for synced object state (socket.io or WebTransport)

## Config / JSON conventions

- All URLs in JSON: relative paths starting with /mt-assets/... for local dev
  OR full https://scottgrocott.github.io/mt-assets/... for production
- Engine auto-detects localhost and rewrites relative asset URLs
- Enemy defs: /mt-assets/enemies/{type}s.json (array, new schema)
- Environment: /mt-assets/terrain/environments/environments.json
- Level: /mt-games/{game}/v1/level-0.json

## Enemy override (per-level)

Level JSON enemies[] array can contain full variant override objects.
If enemy entry has variantId field → it IS the variant definition.
If enemy entry has only type/enabled/maxCount → use default from enemy JSON.
Spawn picks randomly from all enabled variants of a given type.
