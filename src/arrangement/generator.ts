/**
 * Long arrangement generator.
 *
 * Pure function: (seed, chordMap) → Arrangement.
 * Same seed always produces the same arrangement (deterministic via PRNG).
 * The seed picks an archetype (structural shape), intro chords, and voicing tier,
 * then delegates to section builders for the step-by-step details.
 */

import type { Arrangement, Chord } from '../lib/types';
import { createPRNG } from '../lib/prng';
import { ARCHETYPES } from './archetypes';
import { INTRO_PAIRS, INTRO_QUADS, A_CYCLES, B_SEQUENCES, RES_SHORT, RES_LONG } from './chordPools';
import { VOICING_TIERS } from './voicingTiers';
import { buildIntro, buildA, buildBreakdown, buildB, buildResolution } from './sectionBuilders';
import { bChords } from '../presets/synthwave-am';

/**
 * Build a chord lookup map from a chord progression + B-section chords.
 * Accepts either a Preset or EngineConfig (both have chordProgression).
 */
export function buildChordMap(source: { chordProgression: Chord[] }): Record<string, Chord> {
  const map: Record<string, Chord> = {};
  for (const chord of source.chordProgression) {
    map[chord.name] = chord;
  }
  // Add B-section chords (C, E with harmonic minor voicing)
  for (const [name, chord] of Object.entries(bChords)) {
    map[name] = chord;
  }
  return map;
}

/**
 * Generate a long arrangement from a seed and chord map.
 *
 * Algorithm:
 * 1. Pick archetype (structural shape) from seed
 * 2. Pick intro chord sequence from appropriate pool
 * 3. Pick intro voicing tier
 * 4. Build sections in order: intro → A1 → [A2] → breakdown → B → resolution
 * 5. Return Arrangement with Am final beat
 */
export function generateLongArrangement(
  seed: number,
  chordMap: Record<string, Chord>,
): Arrangement {
  const rng = createPRNG(seed * 0x9e3779b9);

  // 1. Pick archetype
  const archetype = ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)];

  // 2. Pick intro chord sequence
  const introPool = archetype.introLoops <= 2 ? INTRO_PAIRS : INTRO_QUADS;
  const introChordNames = introPool[Math.floor(rng() * introPool.length)];

  // 3. Pick voicing tier
  const tier = VOICING_TIERS[Math.floor(rng() * VOICING_TIERS.length)];

  // 4. Pick A-section chord cycle
  const aCycle = A_CYCLES[Math.floor(rng() * A_CYCLES.length)];

  // 5. Pick B-section chord sequence
  const bSequence = B_SEQUENCES[Math.floor(rng() * B_SEQUENCES.length)];

  // 6. Pick resolution chord sequence
  const resPool = archetype.resolutionLoops <= 2 ? RES_SHORT : RES_LONG;
  const resSequence = resPool[Math.floor(rng() * resPool.length)];

  // 7. Build sections
  const hasA2 = archetype.a2Loops > 0;

  const steps = [
    ...buildIntro(introChordNames, chordMap, tier, archetype.introLoops),
    ...buildA(aCycle, chordMap, archetype.a1Loops, 'build', hasA2),
    ...(hasA2 ? buildA(aCycle, chordMap, archetype.a2Loops, 'full', false) : []),
    ...buildBreakdown(chordMap, archetype.breakdownLoops),
    ...buildB(bSequence, chordMap, archetype.bLoops),
    ...buildResolution(resSequence, chordMap, archetype.resolutionLoops),
  ];

  return {
    steps,
    finalBeat: chordMap['Am'],
  };
}
