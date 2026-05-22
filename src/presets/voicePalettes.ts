/**
 * Voice palettes — alternative sonic characters for the same grid.
 *
 * Each palette overrides pad, bass, stab, stabGroove, and arp configs.
 * The variation seed picks a palette; kit/chords/arrangement are unchanged.
 *
 * Palette 0 is always the default (current synthwave preset values).
 * Non-zero palettes are defined here.
 */

import type { PadConfig, BassConfig, StabConfig, EngineConfig } from '../lib/types';

export interface VoicePalette {
  name: string;
  pad: Partial<PadConfig>;
  bass: Partial<BassConfig>;
  stab: Partial<StabConfig>;
  stabGroove: Partial<StabConfig>;
  arp: Partial<StabConfig>;
}

/**
 * Grit palette — distorted, dark, shoegaze-inspired.
 * Everything is more saturated, filters are lower, decays longer, more wash.
 */
const grit: VoicePalette = {
  name: 'Grit',
  pad: {
    oscillator: 'fatsquare',
    spread: 70,                        // wider detuning = gnarlier
    count: 4,                          // fewer voices, each louder
    filterLfoRange: [150, 1200],       // darker, more muffled sweep
    volumeLfoRange: [0.5, 1.0],        // deeper breathing
    saturationWet: 0.5,
    saturationOrder: 5,                // more harmonics than default 3
  },
  bass: {
    oscillator: 'square',              // more harmonics than saw
    filterCutoffHz: 400,               // darker
    filterEnvStart: 1400,              // less dramatic sweep
    filterEnvEnd: 200,
    filterEnvDecay: 0.22,              // slower — growl hangs longer
    saturationWet: 0.75,               // cranked
    chorusDelayMs: undefined,          // no chorus — distortion IS the texture
    chorusWet: undefined,
  },
  stab: {
    oscillator: 'sawtooth',
    filterCutoffHz: 2000,              // darker than default 3000
    decay: 0.35,                       // longer — smears more
    sustain: 0.15,
    release: 0.5,
    delayFeedback: 0.50,               // more wash
    delayWet: 0.40,
    saturationWet: 0.55,
    saturationOrder: 4,
  },
  stabGroove: {
    oscillator: 'sawtooth',            // saw instead of square
    filterCutoffHz: 1600,              // darker
    decay: 0.45,                       // longer ring
    sustain: 0.15,
    release: 0.35,
    saturationWet: 0.45,
    saturationOrder: 3,
  },
  arp: {
    oscillator: 'square',              // grittier arp tone
    filterCutoffHz: 2800,              // darker than default 4000
    decay: 0.20,                       // slightly longer notes
    sustain: 0.08,
    release: 0.20,
    delayFeedback: 0.45,               // more washy trails
    delayWet: 0.40,
    saturationWet: 0.40,
    saturationOrder: 3,
  },
};

/**
 * Glass palette — crystalline, airy, minimal.
 * Triangle/sine oscillators, high filters, short tight envelopes, less delay.
 * Opposite of grit: clean, bright, spacious.
 */
const glass: VoicePalette = {
  name: 'Glass',
  pad: {
    oscillator: 'fattriangle',
    spread: 25,                        // tight detuning — clean shimmer
    count: 3,                          // fewer voices = more transparent
    filterLfoRange: [800, 4000],       // higher, brighter sweep
    volumeLfoRange: [0.7, 1.0],        // gentler breathing
    attack: 0.5,                       // slower fade in — ethereal
    release: 2.0,                      // long tail
  },
  bass: {
    oscillator: 'triangle',            // pure, round, no harmonics
    filterCutoffHz: 700,               // open — let the clean tone through
    filterEnvStart: 1200,              // subtle sweep
    filterEnvEnd: 500,
    filterEnvDecay: 0.08,              // quick — plucky, not growly
    saturationWet: 0.1,                // barely there
    chorusDelayMs: 5,                  // wider stereo, subtle
    chorusRate: 0.3,
    chorusWet: 0.3,                    // more chorus than default — airy width
  },
  stab: {
    oscillator: 'sine',                // pure tone, bell-like
    filterCutoffHz: 5000,              // bright, open
    decay: 0.12,                       // short — percussive ping
    sustain: 0.02,                     // near zero — pluck character
    release: 0.4,                      // but let the delay carry it
    delayFeedback: 0.25,               // cleaner repeats
    delayWet: 0.25,
  },
  stabGroove: {
    oscillator: 'triangle',            // soft, warm
    filterCutoffHz: 3500,              // brighter than default groove stab
    decay: 0.18,                       // tighter than default
    sustain: 0.05,
    release: 0.2,
  },
  arp: {
    oscillator: 'sine',                // pure bell tones
    filterCutoffHz: 6000,              // wide open — let harmonics ring
    decay: 0.10,                       // very short — individual pings
    sustain: 0.02,
    release: 0.12,
    delayFeedback: 0.20,               // cleaner, less wash
    delayWet: 0.25,
  },
};

/**
 * All non-default palettes. Index 0 in this array = first alternative palette.
 * The default palette (index 0 in selection) uses preset values unchanged.
 */
export const VOICE_PALETTES: VoicePalette[] = [grit, glass];

/**
 * Total palette count including the default.
 * Palette 0 = default (preset as-is), palettes 1..N = VOICE_PALETTES[0..N-1].
 */
export const PALETTE_COUNT = 1 + VOICE_PALETTES.length;

/**
 * Apply a voice palette to an EngineConfig.
 * Palette 0 = no change (default). Palette 1+ merges overrides from VOICE_PALETTES.
 * Uses undefined-aware merge: explicit `undefined` in the palette removes the field
 * (e.g. chorusDelayMs: undefined disables chorus).
 */
export function applyVoicePalette(config: EngineConfig, paletteIndex: number): EngineConfig {
  if (paletteIndex === 0 || paletteIndex > VOICE_PALETTES.length) return config;
  const palette = VOICE_PALETTES[paletteIndex - 1];

  // Merge helper: overrides from palette win, undefined values strip the key
  function merge<T extends object>(base: T, overrides: Partial<T>): T {
    const result = { ...base };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete (result as Record<string, unknown>)[key];
      } else {
        (result as Record<string, unknown>)[key] = value;
      }
    }
    return result;
  }

  return {
    ...config,
    pad: merge(config.pad, palette.pad),
    bass: merge(config.bass, palette.bass),
    stab: merge(config.stab, palette.stab),
    ...(config.stabGroove ? { stabGroove: merge(config.stabGroove, palette.stabGroove) } : {}),
    ...(config.arp ? { arp: merge(config.arp, palette.arp) } : {}),
  };
}
