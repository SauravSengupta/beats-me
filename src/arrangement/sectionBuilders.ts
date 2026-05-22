/**
 * Section builders — produce ArrangementStep[] for each section type.
 *
 * Each builder creates steps with appropriate voice probabilities, energy
 * curves, and transition effects (risers/fills). The energy and voice prob
 * values here are starting points — tune by ear.
 */

import type { ArrangementStep, Chord } from '../lib/types';
import type { VoicingTier } from './voicingTiers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Linearly interpolate N values from start to end (inclusive). */
export function ramp(start: number, end: number, count: number): number[] {
  if (count === 1) return [start];
  return Array.from({ length: count }, (_, i) => start + (end - start) * (i / (count - 1)));
}

/** Cycle chord names into Chord objects for N loops. */
function cycleChords(names: string[], chordMap: Record<string, Chord>, loops: number): Chord[] {
  return Array.from({ length: loops }, (_, i) => chordMap[names[i % names.length]]);
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/**
 * Intro: drums per voicing tier, pad always on, no kick/bass.
 * Last loop gets up-riser + light snare fill to build into A1.
 */
export function buildIntro(
  chordNames: string[],
  chordMap: Record<string, Chord>,
  tier: VoicingTier,
  loops: number,
): ArrangementStep[] {
  const chords = cycleChords(chordNames, chordMap, loops);
  const energies = ramp(0.25, 0.35, loops);

  return chords.map((chord, i): ArrangementStep => {
    const isLast = i === loops - 1;
    // Stab/arp ramp up slightly through the intro
    const progress = loops > 1 ? i / (loops - 1) : 0;
    const stabMul = 1 + progress * 0.25;   // 1.0 → 1.25
    const arpMul = 1 + progress * 0.33;    // 1.0 → 1.33

    return {
      chord,
      energy: energies[i],
      sparkle: tier.sparkle,
      rhythm: tier.rhythm,
      groove: tier.groove,
      pulse: tier.pulse,       // always 0
      pad: tier.pad,           // always 1
      bass: tier.bass,         // always 0
      stab: Math.min(1, tier.stab * stabMul),
      stabGroove: tier.stabGroove,
      arp: Math.min(1, tier.arp * arpMul),
      arpOctaveShift: -12,     // one octave lower for intimate intro
      ...(i === 0 ? { label: 'intro' } : {}),
      ...(isLast ? { riser: 'up' as const, fill: 'snare' as const, fillWeight: 'light' as const } : {}),
    };
  });
}

/**
 * A section — two phases:
 * - 'build': full drums, synths ramp from low to full over the section
 * - 'full': everything at max, uses 'previous' after first step
 */
export function buildA(
  chordNames: string[],
  chordMap: Record<string, Chord>,
  loops: number,
  phase: 'build' | 'full',
  addFillOnLast: boolean,
): ArrangementStep[] {
  const chords = cycleChords(chordNames, chordMap, loops);

  if (phase === 'full') {
    return chords.map((chord, i): ArrangementStep => {
      if (i === 0) {
        return {
          chord, energy: 0.75, label: 'A',
          sparkle: 1, rhythm: 1, groove: 1, pulse: 1,
          pad: 1, bass: 1, stab: 1, stabGroove: 1, arp: 1,
        };
      }
      const isLast = i === loops - 1;
      const energy = ramp(0.75, 0.85, loops)[i];
      return {
        chord, energy,
        sparkle: 'previous', rhythm: 'previous', groove: 'previous', pulse: 'previous',
        pad: 'previous', bass: 'previous', stab: 'previous', stabGroove: 'previous', arp: 'previous',
        ...(isLast && addFillOnLast ? { fill: 'snare' as const, fillWeight: 'light' as const } : {}),
      };
    });
  }

  // 'build' phase — synths ramp up gradually
  const energies = ramp(0.45, 0.75, loops);
  const bassRamp = ramp(0.5, 1.0, loops);
  const stabRamp = ramp(0.3, 1.0, loops);
  const stabGrooveRamp = ramp(0.3, 1.0, loops);
  const arpRamp = ramp(0.2, 1.0, loops);

  return chords.map((chord, i): ArrangementStep => {
    const isLast = i === loops - 1;
    return {
      chord,
      energy: energies[i],
      sparkle: 1, rhythm: 1, groove: 1, pulse: 1,
      pad: 1,
      bass: bassRamp[i],
      stab: stabRamp[i],
      stabGroove: stabGrooveRamp[i],
      arp: arpRamp[i],
      ...(i === 0 ? { label: 'A' } : {}),
      ...(isLast && addFillOnLast ? { fill: 'snare' as const, fillWeight: 'light' as const } : {}),
    };
  });
}

/**
 * Breakdown — the drop before B. Mostly silent, builds tension.
 * Last loop gets up-riser + heavy snare fill.
 */
export function buildBreakdown(
  chordMap: Record<string, Chord>,
  loops: number,
): ArrangementStep[] {
  // Use G for breakdown — G→C (into B) is IV→I-like, bright contrast
  const chords = cycleChords(['G'], chordMap, loops);
  const energies = ramp(0.30, 0.35, loops);

  return chords.map((chord, i): ArrangementStep => {
    const isLast = i === loops - 1;
    return {
      chord,
      energy: energies[i],
      sparkle: 0, rhythm: 0, groove: 0, pulse: 0.5,
      pad: 1, bass: 0.3, stab: 0, stabGroove: 0, arp: 0,
      ...(isLast ? { riser: 'up' as const, fill: 'snare' as const, fillWeight: 'heavy' as const } : {}),
    };
  });
}

/**
 * B section — climax. Full everything, max energy.
 * Last loop gets down-riser + heavy snare fill.
 */
export function buildB(
  chordNames: string[],
  chordMap: Record<string, Chord>,
  loops: number,
): ArrangementStep[] {
  const chords = chordNames.map(name => chordMap[name]);
  const energies = ramp(0.85, 1.0, loops);

  return chords.map((chord, i): ArrangementStep => {
    const isLast = i === loops - 1;
    if (i === 0) {
      return {
        chord, energy: energies[i], label: 'B',
        sparkle: 1, rhythm: 1, groove: 1, pulse: 1,
        pad: 1, bass: 1, stab: 1, stabGroove: 1, arp: 1,
        arpOctaveShift: 12,    // one octave higher for climax shimmer
        voicingShift: 12,      // brighter stab/pad voicings at peak
        ...(isLast ? { riser: 'down' as const, fill: 'snare' as const, fillWeight: 'heavy' as const } : {}),
      };
    }
    return {
      chord, energy: energies[i],
      sparkle: 'previous', rhythm: 'previous', groove: 'previous', pulse: 'previous',
      pad: 'previous', bass: 'previous', stab: 'previous', stabGroove: 'previous', arp: 'previous',
      arpOctaveShift: 12,
      voicingShift: 12,
      ...(isLast ? { riser: 'down' as const, fill: 'snare' as const, fillWeight: 'heavy' as const } : {}),
    };
  });
}

/**
 * Resolution — stripped down, arriving home. Kick stays, sparse synths.
 * Uses 'previous' after first step so texture is consistent through to final beat.
 */
export function buildResolution(
  chordNames: string[],
  chordMap: Record<string, Chord>,
  loops: number,
): ArrangementStep[] {
  const chords = cycleChords(chordNames, chordMap, loops);
  const energies = ramp(0.35, 0.25, loops);

  return chords.map((chord, i): ArrangementStep => {
    if (i === 0) {
      return {
        chord, energy: energies[i], label: 'A',
        sparkle: 0, rhythm: 0, groove: 0, pulse: 1,
        pad: 1, bass: 0.5, stab: 0.3, stabGroove: 0.3, arp: 0,
        arpOctaveShift: -12,   // back down for resolution
      };
    }
    return {
      chord, energy: energies[i],
      sparkle: 'previous', rhythm: 'previous', groove: 'previous', pulse: 'previous',
      pad: 'previous', bass: 'previous', stab: 'previous', stabGroove: 'previous', arp: 'previous',
      arpOctaveShift: -12,
    };
  });
}
