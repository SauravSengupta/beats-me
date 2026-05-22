/**
 * Pitch utilities for note name ↔ MIDI number conversion
 * and diatonic scale operations.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Also accept flats
const NOTE_TO_SEMITONE: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1,
  'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'Fb': 4,
  'F': 5, 'F#': 6, 'Gb': 6,
  'G': 7, 'G#': 8, 'Ab': 8,
  'A': 9, 'A#': 10, 'Bb': 10,
  'B': 11, 'Cb': 11,
};

/** Convert note name (e.g. 'A2') to MIDI number (e.g. 45) */
export function noteToMidi(note: string): number {
  const match = note.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!match) return 60; // fallback to middle C
  const name = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  const octave = parseInt(match[2], 10);
  const semitone = NOTE_TO_SEMITONE[name] ?? 0;
  return (octave + 1) * 12 + semitone;
}

/** Convert MIDI number to note name (e.g. 45 → 'A2') */
export function midiToNote(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const semitone = midi % 12;
  return `${NOTE_NAMES[semitone]}${octave}`;
}

/**
 * Find diatonic approach tones for a target root note.
 * Returns MIDI numbers for each approach type, chosen to stay
 * close to the reference pitch (minimizes bass movement).
 *
 * @param targetRoot - The note we're approaching (e.g. 'A2')
 * @param refPitch - The previous bass note MIDI, for proximity
 * @param scale - Scale note names (e.g. ['A', 'B', 'C', 'D', 'E', 'F', 'G'])
 * @returns Object with MIDI numbers for each approach type
 */
export function getApproachTones(
  targetRoot: string,
  refPitch: number,
  scale: string[],
): { fifth: number; stepBelow: number; stepAbove: number; fourth: number } {
  const targetMidi = noteToMidi(targetRoot);
  const targetPc = targetMidi % 12; // pitch class

  // Build the scale as pitch classes (semitone values 0-11)
  const scalePcs = scale.map((n) => NOTE_TO_SEMITONE[n] ?? 0);

  // Find scale degree of target
  const targetIdx = scalePcs.indexOf(targetPc);

  // Scale step below target (previous scale degree)
  const stepBelowIdx = (targetIdx - 1 + scalePcs.length) % scalePcs.length;
  const stepBelowPc = scalePcs[stepBelowIdx];

  // Scale step above target (next scale degree)
  const stepAboveIdx = (targetIdx + 1) % scalePcs.length;
  const stepAbovePc = scalePcs[stepAboveIdx];

  // 5th above target = +7 semitones
  const fifthPc = (targetPc + 7) % 12;

  // 4th below target = -5 semitones = +7 (same as 5th)
  // Actually 4th above = +5, 4th below = -7... let me do this right.
  // Perfect 4th = 5 semitones above root
  const fourthPc = (targetPc + 5) % 12;

  // For each pitch class, find the MIDI note closest to refPitch
  return {
    fifth: closestMidi(fifthPc, refPitch),
    stepBelow: closestMidi(stepBelowPc, refPitch),
    stepAbove: closestMidi(stepAbovePc, refPitch),
    fourth: closestMidi(fourthPc, refPitch),
  };
}

/**
 * Find the MIDI note with the given pitch class closest to the reference.
 * Checks the octave of ref, plus one above and below, picks the nearest.
 */
function closestMidi(pitchClass: number, refPitch: number): number {
  const refOctave = Math.floor(refPitch / 12);
  let best = -1;
  let bestDist = Infinity;
  for (let oct = refOctave - 1; oct <= refOctave + 1; oct++) {
    const midi = oct * 12 + pitchClass;
    const dist = Math.abs(midi - refPitch);
    if (dist < bestDist) {
      bestDist = dist;
      best = midi;
    }
  }
  return best;
}

/** Transpose a note name by N semitones (e.g. 'A2' + 3 → 'C3'). */
export function transposeNote(note: string, semitones: number): string {
  return midiToNote(noteToMidi(note) + semitones);
}

/** Transpose a pitch class name by N semitones (e.g. 'A' + 3 → 'C'). */
export function transposePitchClass(pc: string, semitones: number): string {
  const semi = NOTE_TO_SEMITONE[pc] ?? 0;
  return NOTE_NAMES[((semi + semitones) % 12 + 12) % 12];
}
