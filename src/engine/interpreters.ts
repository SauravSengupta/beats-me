import type { CellInterpreter, Chord, EngineConfig, GridState, ScheduledSound } from '../lib/types';
import { noteToMidi, midiToNote, getApproachTones } from '../lib/pitch';
import { createPRNG, weightedPick, hashGrid, deriveVariationParams, type ArpShape, type VariationParams } from '../lib/prng';
import { STAB_GROOVE } from './constants';

/**
 * Resolve which chord is active at a given column/loop position.
 * When chordOverride is provided (from arrangement system), use it directly.
 * Otherwise fall back to progression cycling (one chord per loop pass).
 */
function getChordAt(
  _col: number,
  loopCount: number,
  progression: Chord[],
  chordOverride?: Chord,
): Chord {
  if (chordOverride) return chordOverride;
  return progression[loopCount % progression.length];
}

/**
 * Get the closest 5th (above or below) to the chord root.
 */
function getClosestFifth(chord: Chord, scale: string[]): string {
  const rootMidi = noteToMidi(chord.root);
  const tones = getApproachTones(chord.root, rootMidi, scale);
  return midiToNote(tones.fifth);
}

/**
 * Determine the bass note for a 'root' type row (kick) using seeded PRNG
 * for diatonic approach tone selection on "and" columns.
 */
function getRootBassNote(
  row: number,
  col: number,
  grid: GridState,
  loopCount: number,
  progression: Chord[],
  scale: string[],
  weights: [number, number, number, number, number],
  random: () => number,
  chordOverride?: Chord,
): string {
  const currentChord = getChordAt(col, loopCount, progression, chordOverride);
  const isAnd = col % 2 === 1;

  if (!isAnd) {
    return currentChord.root;
  }

  // "And" column — check adjacent downbeats for voice leading
  const nextDownbeat = col + 1;
  const prevDownbeat = col - 1;

  const nextCol = nextDownbeat % grid.numCols;
  const nextLoop = nextDownbeat >= grid.numCols ? loopCount + 1 : loopCount;
  const nextHasHit = grid.cells[row][nextCol] > 0;

  const prevCol = (prevDownbeat + grid.numCols) % grid.numCols;
  const prevLoop = prevDownbeat < 0 ? loopCount - 1 : loopCount;
  const prevHasHit = grid.cells[row][prevCol] > 0;

  let targetChord: Chord;
  let refChord: Chord;

  if (nextHasHit) {
    // For next loop boundary, we don't know the arrangement's next chord — use progression fallback
    targetChord = nextLoop !== loopCount
      ? getChordAt(nextCol, nextLoop, progression)
      : getChordAt(nextCol, nextLoop, progression, chordOverride);
    refChord = currentChord;
  } else if (prevHasHit) {
    targetChord = prevLoop !== loopCount
      ? getChordAt(prevCol, prevLoop, progression)
      : getChordAt(prevCol, prevLoop, progression, chordOverride);
    refChord = currentChord;
  } else {
    return currentChord.root;
  }

  const refMidi = noteToMidi(refChord.root);
  const tones = getApproachTones(targetChord.root, refMidi, scale);

  const targetMidi = noteToMidi(targetChord.root);
  const options = [targetMidi, tones.fifth, tones.stepBelow, tones.stepAbove, tones.fourth];
  const picked = weightedPick(random, weights);

  return midiToNote(options[picked]);
}

/**
 * Apply an arp shape to a sorted array of 4 notes.
 * Input notes are always sorted low→high. Shape determines the playback order.
 */
function applyArpShape(sortedNotes: string[], shape: ArpShape, isDownbeat: boolean): string[] {
  switch (shape) {
    case 'ascending':
      return isDownbeat ? sortedNotes : [...sortedNotes].reverse();
    case 'descending':
      return isDownbeat ? [...sortedNotes].reverse() : sortedNotes;
    case 'pendulum':
      // up-down: 0,1,2,3,2,1 — truncated to 4 notes: 0,1,2,3 on downbeat, 3,2,1,0 wouldn't work
      // Instead: low→high→mid-high→mid-low for a wave shape
      return isDownbeat
        ? [sortedNotes[0], sortedNotes[2], sortedNotes[1], sortedNotes[3]]
        : [sortedNotes[3], sortedNotes[1], sortedNotes[2], sortedNotes[0]];
    case 'octaveJump':
      // Alternating low/high register: 0,3,1,2 — creates wide leaps
      return isDownbeat
        ? [sortedNotes[0], sortedNotes[3], sortedNotes[1], sortedNotes[2]]
        : [sortedNotes[2], sortedNotes[1], sortedNotes[3], sortedNotes[0]];
  }
}

/**
 * Invert a 3-note voicing.
 * 0 = root position (unchanged), 1 = 1st inversion (bottom note up octave),
 * 2 = 2nd inversion (bottom two notes up octave).
 */
function invertVoicing(voicing: string[], inversion: number): string[] {
  if (inversion === 0) return voicing;
  const notes = [...voicing];
  for (let i = 0; i < inversion; i++) {
    const lowest = notes.shift()!;
    notes.push(midiToNote(noteToMidi(lowest) + 12));
  }
  return notes;
}

/**
 * Get accent velocity multiplier for a column based on the accent pattern.
 * Returns a multiplier (0.85–1.15) to apply to drum velocity.
 */
function getAccentMul(col: number, pattern: VariationParams['accentPattern']): number {
  switch (pattern) {
    case 'flat': return 1;
    case 'oneThree': return (col % 8 === 0 || col % 8 === 4) ? 1.12 : 0.88;
    case 'twoFour': return (col % 8 === 2 || col % 8 === 6) ? 1.12 : 0.88;
    case 'offbeats': return (col % 2 === 1) ? 1.10 : 0.90;
  }
}

/**
 * Data-driven drum sequencer interpreter.
 *
 * Each kit row can optionally trigger bass notes. The bass behavior
 * (note type, probability, velocity, approach weights) is defined
 * per-row in the Preset's kit config — no hardcoded row names.
 */
export function createLiteralInterpreter(config: EngineConfig): CellInterpreter {
  const progression = config.chordProgression;
  const scale = config.scale;
  const kit = config.kit;

  let lastGridHash = -1;
  let lastVariation = config.variationSeed ?? 0;
  let random = createPRNG(0);
  let vParams = deriveVariationParams(lastVariation);

  return ({ row, col, value }, { grid, loopCount, chordOverride, voiceProbs, arpOctaveShift, voicingShift }): ScheduledSound[] => {
    if (value === 0) return [];

    const rowConfig = kit[row];
    if (!rowConfig) return [];

    // Ensure PRNG is seeded from grid state + variation seed (before any random() calls)
    const gridHash = hashGrid(grid.cells);
    const variation = config.variationSeed ?? 0;
    const combinedHash = (gridHash ^ Math.imul(variation, 0x9e3779b9)) >>> 0;
    if (gridHash !== lastGridHash || variation !== lastVariation) {
      lastGridHash = gridHash;
      if (variation !== lastVariation) {
        vParams = deriveVariationParams(variation);
      }
      lastVariation = variation;
      random = createPRNG(combinedHash);
    }

    // Velocity humanization: ±amount variation via seeded PRNG (kick stays locked)
    const baseVelocity = 0.7;
    const humanize = rowConfig.humanize ?? 0;
    const accentMul = getAccentMul(col, vParams.accentPattern);
    const drumVelocity = humanize > 0
      ? Math.max(0.1, Math.min(1, (baseVelocity + (random() * 2 - 1) * humanize) * accentMul))
      : Math.max(0.1, Math.min(1, baseVelocity * accentMul));

    const sounds: ScheduledSound[] = [];

    // Drum hit: gated by absolute probability from arrangement (1 = always, 0 = silent)
    const drumProbKey = rowConfig.voiceProbKey;
    const drumProb = (voiceProbs && drumProbKey) ? voiceProbs[drumProbKey] ?? 1 : 1;
    if (drumProb >= 1 || random() < drumProb) {
      sounds.push({
        row, col, value,
        beatOffset: 0,
        sound: rowConfig.name,
        velocity: drumVelocity,
      });
    }

    if (progression.length === 0) return sounds;

    // Synth companion multiplier from arrangement (1 = designed rate, 0 = never)
    const bassMultiplier = voiceProbs?.bass ?? 1;
    const arpMultiplier = voiceProbs?.arp ?? 1;

    // Bass generation (kick/snare/tom rows)
    if (rowConfig.bass && bassMultiplier > 0) {
      const rowBass = rowConfig.bass;
      if (random() < rowBass.probability * bassMultiplier) {
        let note: string;
        if (rowBass.noteType === 'root') {
          const weights = rowBass.approachWeights ?? [1, 0, 0, 0, 0];
          note = getRootBassNote(row, col, grid, loopCount, progression, scale, weights, random, chordOverride);
        } else {
          const chord = getChordAt(col, loopCount, progression, chordOverride);
          note = getClosestFifth(chord, scale);
        }
        sounds.push({
          row, col, value,
          beatOffset: 0,
          sound: rowBass.soundKey,
          velocity: rowBass.velocity,
          note,
        });
      }
    }

    // Chord stab generation — use stabGroove multiplier for groove stab, stab for hat stab
    const isGrooveStab = rowConfig.stab?.soundKey === STAB_GROOVE;
    const stabMultiplier = isGrooveStab ? (voiceProbs?.stabGroove ?? 1) : (voiceProbs?.stab ?? 1);
    if (rowConfig.stab && stabMultiplier > 0) {
      const stabProb = (rowConfig.stab.probability ?? 1) * stabMultiplier;
      if (random() < stabProb) {
        const chord = getChordAt(col, loopCount, progression, chordOverride);
        const chordIdx = progression.indexOf(chord) >= 0 ? progression.indexOf(chord) : loopCount % progression.length;
        const isOffbeat = col % 2 === 1;
        const velScale = isOffbeat ? (rowConfig.stab.offbeatVelocity ?? 1) : 1;
        // Voicing source: 'pad' uses padVoicing (lower), 'stab' (default) uses stabVoicing (higher)
        const rawVoicing = rowConfig.stab.voicingSource === 'pad'
          ? chord.padVoicing : chord.stabVoicing;
        // Apply arrangement voicing shift (e.g. +12 in B section for brighter register)
        const shiftedVoicing = voicingShift
          ? rawVoicing.map(n => midiToNote(noteToMidi(n) + voicingShift))
          : rawVoicing;
        // Apply seed-dependent inversion (root position, 1st, or 2nd)
        const inversion = vParams.stabInversions[chordIdx % vParams.stabInversions.length];
        const voicing = invertVoicing(shiftedVoicing, inversion);
        sounds.push({
          row, col, value,
          beatOffset: 0,
          sound: rowConfig.stab.soundKey,
          velocity: rowConfig.stab.velocity * velScale,
          notes: voicing,
        });
      }
    }

    // Arp generation (row 0 sparkle → cascading melodic notes)
    if (rowConfig.arp && progression.length > 0 && arpMultiplier > 0) {
      const arpCfg = rowConfig.arp;

      // Probability gate — skip arp if PRNG says no (scaled by arrangement multiplier)
      const arpProb = (arpCfg.probability ?? 1) * arpMultiplier;
      if (arpProb < 1 && random() > arpProb) {
        // No arp this hit — just the cymbal drum sound (already emitted above)
      } else {
        const chord = getChordAt(col, loopCount, progression, chordOverride);
        const voicing = chord.stabVoicing; // arp uses stab register (high)

        // Build 4 distinct pitches above the stab voicing, sorted by MIDI.
        // Default is +12 (one octave up); arpOctaveShift adjusts this per section.
        // e.g. intro = -12 → same register as stabs, B = +12 → extra shimmer.
        const arpShift = 12 + (arpOctaveShift ?? 0);
        const arpNotes = [
          midiToNote(noteToMidi(voicing[0]) + arpShift),
          midiToNote(noteToMidi(voicing[1]) + arpShift),
          midiToNote(noteToMidi(voicing[2]) + arpShift),
          midiToNote(noteToMidi(voicing[0]) + arpShift + 12),  // 4th pitch one octave above
        ].sort((a, b) => noteToMidi(a) - noteToMidi(b));

        const isDownbeat = col % 2 === 0;
        const arpShape = vParams.arpShapes[col % vParams.arpShapes.length];
        const sequence = applyArpShape(arpNotes, arpShape, isDownbeat);

        // Truncate near chord boundary — each note is a 16th (0.25 beatOffset).
        // beatOffset is in quarter-note units (beatDuration = 60/bpm = quarter note).
        // One 16th = 0.25 of a quarter note. One sub-column = 0.5 (one 8th note).
        // So a 4-note arp spans 0.75 beatOffset ≈ 2 sub-columns.
        const remaining16ths = (grid.numCols - col) * 2;
        const noteCount = Math.min(arpCfg.notesPerArp, remaining16ths, sequence.length);

        // Offbeat velocity reduction — offbeat arps are slightly quieter
        const offbeatScale = (!isDownbeat && arpCfg.offbeatVelocity != null)
          ? arpCfg.offbeatVelocity
          : 1;

        // Per-note velocity humanization
        const arpHumanize = arpCfg.humanize ?? 0;

        let vel = arpCfg.baseVelocity * offbeatScale;
        for (let i = 0; i < noteCount; i++) {
          const humanized = arpHumanize > 0
            ? Math.max(0.1, Math.min(1, vel + (random() * 2 - 1) * arpHumanize))
            : vel;
          sounds.push({
            row, col, value,
            beatOffset: i * 0.25, // 16th note spacing in quarter-note units
            sound: arpCfg.soundKey,
            velocity: humanized,
            note: sequence[i],
          });
          vel *= arpCfg.velocityDecay;
        }
      }
    }

    // Note: pad sidechain pump is now handled by SoundEngine (implicit quarter-note pump
    // with kick/snare reinforcement). The interpreter no longer emits pad-pulse sounds.

    return sounds;
  };
}
