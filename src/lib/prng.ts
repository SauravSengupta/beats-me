/**
 * Simple seeded PRNG (mulberry32).
 * Deterministic: same seed always produces the same sequence.
 * Used for consistent bass approach tone selection — survives share-via-URL.
 */
import { PALETTE_COUNT } from '../presets/voicePalettes';
export function createPRNG(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick a weighted random index.
 * weights = [0.4, 0.3, 0.2, 0.1] → 40% chance of 0, 30% chance of 1, etc.
 */
export function weightedPick(random: () => number, weights: number[]): number {
  const r = random();
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (r < cumulative) return i;
  }
  return weights.length - 1;
}

// ---------------------------------------------------------------------------
// Variation params — global knobs derived once per seed
// ---------------------------------------------------------------------------

/** Arp pattern shape — determines note ordering within a 4-note arp sequence */
export type ArpShape = 'ascending' | 'descending' | 'pendulum' | 'octaveJump';

/** Accent emphasis pattern — which beats hit harder */
export type AccentPattern = 'flat' | 'oneThree' | 'twoFour' | 'offbeats';

/** Global variation parameters derived from the variation seed PRNG. */
export interface VariationParams {
  /** Arp pattern shapes: one per column position (0–15), cycled as needed */
  arpShapes: ArpShape[];
  /** Stab inversion per chord index: 0 = root position, 1 = 1st inversion, 2 = 2nd inversion */
  stabInversions: number[];
  /** Velocity accent pattern for drums */
  accentPattern: AccentPattern;
  /** Pad filter LFO range offset: -1 (warmer) to +1 (brighter) */
  padLfoOffset: number;
  /** Delay feedback offset: -0.1 to +0.1 added to energy-derived feedback */
  delayFeedbackOffset: number;
  /** Stab filter cutoff multiplier: 0.8 (darker) to 1.2 (brighter) */
  stabFilterMul: number;
  /** Ghost bass probability multiplier: 0.7 (sparse) to 1.3 (busy) */
  ghostBassDensity: number;
  /** Delay time notation variant: '8n' (8th), '8n.' (dotted-8th), '4n' (quarter) */
  delayTimeVariant: '8n' | '8n.' | '4n';
  /** Drum brightness offset: -0.15 (darker) to +0.15 (brighter), added to energy-derived brightness */
  drumBrightnessOffset: number;
  /** Voice palette index: 0 = default, 1+ = alternative sonic characters */
  voicePalette: number;
  /** Transpose shift in semitones: -3 to +4 (F#m through C#m). 0 = Am (default). */
  transposeShift: number;
}

/**
 * Derive global variation parameters from a seed.
 * Same seed always produces the same params (deterministic via PRNG).
 * Seed 0 produces neutral/default values for backward compatibility.
 */
export function deriveVariationParams(variationSeed: number): VariationParams {
  if (variationSeed === 0) {
    // Variation 0 = default behavior — neutral values everywhere
    return {
      arpShapes: Array(16).fill('ascending' as ArpShape),
      stabInversions: [0, 0, 0, 0],
      accentPattern: 'flat',
      padLfoOffset: 0,
      delayFeedbackOffset: 0,
      stabFilterMul: 1,
      ghostBassDensity: 1,
      delayTimeVariant: '8n.',
      drumBrightnessOffset: 0,
      voicePalette: 0,
      transposeShift: 0,
    };
  }

  const rng = createPRNG(variationSeed * 0x9e3779b9);

  // Arp shapes — pick per column from the palette
  const shapePalette: ArpShape[] = ['ascending', 'descending', 'pendulum', 'octaveJump'];
  const arpShapes: ArpShape[] = [];
  for (let i = 0; i < 16; i++) {
    arpShapes.push(shapePalette[Math.floor(rng() * shapePalette.length)]);
  }

  // Stab inversions — one per chord in the 4-chord progression
  const stabInversions: number[] = [];
  for (let i = 0; i < 4; i++) {
    stabInversions.push(Math.floor(rng() * 3)); // 0, 1, or 2
  }

  // Accent pattern — weighted toward 'flat' so not every seed is heavily accented
  const accentRoll = rng();
  const accentPattern: AccentPattern =
    accentRoll < 0.35 ? 'flat' :
    accentRoll < 0.55 ? 'oneThree' :
    accentRoll < 0.75 ? 'twoFour' :
    'offbeats';

  // Continuous knobs — symmetric around 0 / 1
  const padLfoOffset = (rng() * 2 - 1);                    // -1 to +1
  const delayFeedbackOffset = (rng() * 2 - 1) * 0.1;      // -0.1 to +0.1
  const stabFilterMul = 0.8 + rng() * 0.4;                 // 0.8 to 1.2
  const ghostBassDensity = 0.7 + rng() * 0.6;              // 0.7 to 1.3

  // Delay time variant — weighted toward dotted-8th (default feel)
  const delayRoll = rng();
  const delayTimeVariant: '8n' | '8n.' | '4n' =
    delayRoll < 0.25 ? '8n' :
    delayRoll < 0.75 ? '8n.' :
    '4n';

  // Drum brightness offset — shifts the energy-driven hat/snare filter curve
  const drumBrightnessOffset = (rng() * 2 - 1) * 0.15;  // -0.15 to +0.15

  // Voice palette — picks a sonic character (0 = default, 1+ = alternatives)
  const voicePalette = Math.floor(rng() * PALETTE_COUNT);

  // Transpose shift — random key within a safe bass range (-3 to +4 semitones)
  // Range: F#m(-3) Gm(-2) G#m(-1) Am(0) Bbm(+1) Bm(+2) Cm(+3) C#m(+4)
  const transposeShift = Math.floor(rng() * 8) - 3;  // -3 to +4

  return {
    arpShapes,
    stabInversions,
    accentPattern,
    padLfoOffset,
    delayFeedbackOffset,
    stabFilterMul,
    ghostBassDensity,
    delayTimeVariant,
    drumBrightnessOffset,
    voicePalette,
    transposeShift,
  };
}

/**
 * Hash a grid state into a seed number.
 * Same grid always produces the same seed.
 */
export function hashGrid(cells: number[][]): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (const row of cells) {
    for (const cell of row) {
      hash ^= cell;
      hash = Math.imul(hash, 0x01000193); // FNV prime
    }
  }
  return hash >>> 0;
}
