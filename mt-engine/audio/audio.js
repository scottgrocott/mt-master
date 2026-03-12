// audio/audio.js — 4-channel Tone.js gain bus
// Tone.start() called only after user gesture (splash-dismissed event).

let _channels = {};
let _ready    = false;

export async function initAudio(channelCfg = {}) {
  if (_ready) return _channels;

  // Tone.start() resumes the AudioContext — must be called in user gesture chain
  await Tone.start();
  console.log('[audio] AudioContext state:', Tone.context.state);

  const defaults = {
    music: { volume: -6,  muted: false },
    env:   { volume: -8,  muted: false },
    enemy: { volume: -12, muted: false },
    sfx:   { volume: -4,  muted: false },
  };

  for (const [name, def] of Object.entries(defaults)) {
    const cfg  = channelCfg[name] ?? def;
    const vol  = cfg.muted ? -Infinity : (cfg.volume ?? def.volume);
    const gain = new Tone.Volume(vol).toDestination();
    _channels[name] = { node: gain, volume: cfg.volume ?? def.volume, muted: cfg.muted ?? false };
  }

  _ready = true;

  window._mtAudio = {
    mute:     (ch) => { if (_channels[ch]) { _channels[ch].node.mute = true; } },
    unmute:   (ch) => { if (_channels[ch]) { _channels[ch].node.mute = false; } },
    volume:   (ch, db) => { if (_channels[ch]) { _channels[ch].node.volume.value = db; } },
    channels: _channels,
    ready:    () => _ready,
  };

  console.log('[audio] Ready — channels:', Object.keys(_channels).join(', '));
  return _channels;
}

export function getChannel(name) { return _channels[name]?.node ?? null; }
export function isReady() { return _ready; }
