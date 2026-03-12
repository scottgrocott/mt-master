// audio/soundtrack.js — Soundscape + music
// Key rule: ZERO Tone object creation until AFTER Tone.start() resolves.
// Tone auto-starts its Transport on import — we can't prevent that,
// but we can defer ALL node creation until the AudioContext is running.

import { getChannel, isReady } from './audio.js';

let _soundscapeNodes = [];
let _musicScheduled  = false;

// ── Soundscape ────────────────────────────────────────────────────────────────
export async function initSoundscape(soundsUrl) {
  if (!soundsUrl) { console.warn('[soundtrack] No soundsUrl'); return; }
  if (!isReady()) { console.warn('[soundtrack] Audio not ready'); return; }

  clearSoundscape();

  let json;
  try {
    const r = await fetch(soundsUrl);
    if (!r.ok) { console.warn('[soundtrack] Sounds fetch failed:', soundsUrl); return; }
    json = await r.json();
  } catch (e) { console.warn('[soundtrack] Sounds fetch error:', e.message); return; }

  const defs = json.audioConfig?.soundscape ?? [];
  console.log('[soundtrack] Building soundscape:', defs.length, 'defs');

  const envCh = getChannel('env');
  if (!envCh) { console.warn('[soundtrack] No env channel'); return; }

  for (const def of defs) {
    if (def.behavior?.triggerType !== 'continuous') continue;
    try {
      // Use Noise→Filter for all ambient — avoids Tone Signal automation
      // bugs that trigger during complex synth construction
      const noiseType  = def.synthConfig?.type ?? 'pink';
      const filterFreq = def.synthConfig?.frequency ?? 800;
      const noise  = new Tone.Noise(noiseType);
      const filter = new Tone.Filter(filterFreq, 'lowpass');
      const vol    = def.behavior?.volume ?? -30;
      noise.volume.value = vol;
      noise.connect(filter);
      filter.connect(envCh);
      noise.start();
      _soundscapeNodes.push(noise, filter);
      console.log('[soundtrack] Soundscape noise started:', def.name, '| vol:', vol);
    } catch (e) {
      console.warn('[soundtrack] Node error:', def.name, e.message);
    }
  }
}

// ── Music ─────────────────────────────────────────────────────────────────────
export async function initMusic(musicUrl) {
  if (!musicUrl) { console.warn('[soundtrack] No musicUrl'); return; }
  if (!isReady()) { console.warn('[soundtrack] Audio not ready for music'); return; }
  if (_musicScheduled) return;

  let json;
  try {
    const r = await fetch(musicUrl);
    if (!r.ok) { console.warn('[soundtrack] Music fetch failed:', musicUrl); return; }
    json = await r.json();
  } catch (e) { console.warn('[soundtrack] Music fetch error:', e.message); return; }

  const pool = json.adventure ?? json.battle ?? [];
  if (!pool.length) { console.warn('[soundtrack] No tracks in music JSON'); return; }

  const track = pool[Math.floor(Math.random() * pool.length)];
  console.log('[soundtrack] Starting track:', track.name);

  const musicCh = getChannel('music');
  if (!musicCh) return;

  // Build instruments NOW (AudioContext is running)
  const instruments = {};
  for (const def of (track.instruments ?? [])) {
    try {
      const Cls = Tone[def.type];
      if (!Cls) { console.warn('[soundtrack] Unknown synth:', def.type); continue; }
      const inst = new Cls(def.options ?? {});
      inst.volume.value = -18;
      inst.connect(musicCh);
      instruments[def.id] = inst;
    } catch (e) {
      console.warn('[soundtrack] Instrument error:', def.type, e.message);
    }
  }

  // Reset Transport cleanly
  Tone.Transport.stop();
  Tone.Transport.cancel();
  Tone.Transport.bpm.value = 110;
  Tone.Transport.loop      = true;
  Tone.Transport.loopStart = '0:0:0';
  Tone.Transport.loopEnd   = '4:0:0';

  for (const seq of (track.sequences ?? [])) {
    const inst = instruments[seq.instrumentId];
    if (!inst) continue;
    for (const ev of (seq.events ?? [])) {
      Tone.Transport.schedule(t => {
        try { inst.triggerAttackRelease(ev.note, ev.duration, t); } catch {}
      }, ev.time);
    }
  }

  Tone.Transport.start('+0.2');
  _musicScheduled = true;
  console.log('[soundtrack] Transport started');
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
export function clearSoundscape() {
  for (const n of _soundscapeNodes) {
    try { n.stop?.(); n.disconnect(); n.dispose(); } catch {}
  }
  _soundscapeNodes = [];
}

export function clearSoundtrack() {
  clearSoundscape();
  try { Tone.Transport.stop(); Tone.Transport.cancel(); } catch {}
  _musicScheduled = false;
}