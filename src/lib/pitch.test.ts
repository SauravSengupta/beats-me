import { describe, it, expect } from 'vitest';
import { noteToMidi, midiToNote, getApproachTones, transposeNote, transposePitchClass } from './pitch';
import { transposeConfig, configFromPreset } from './types';
import synthwaveAm from '../presets/synthwave-am';

describe('noteToMidi', () => {
  it('converts standard notes', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A2')).toBe(45);
    expect(noteToMidi('E2')).toBe(40);
    expect(noteToMidi('F2')).toBe(41);
    expect(noteToMidi('G2')).toBe(43);
  });

  it('handles sharps and flats', () => {
    expect(noteToMidi('C#4')).toBe(61);
    expect(noteToMidi('Db4')).toBe(61);
    expect(noteToMidi('Bb3')).toBe(58);
  });
});

describe('midiToNote', () => {
  it('converts MIDI to note names', () => {
    expect(midiToNote(60)).toBe('C4');
    expect(midiToNote(45)).toBe('A2');
    expect(midiToNote(40)).toBe('E2');
  });

  it('round-trips with noteToMidi', () => {
    for (const note of ['A2', 'C3', 'F2', 'G2', 'E2', 'D3']) {
      expect(midiToNote(noteToMidi(note))).toBe(note);
    }
  });
});

describe('getApproachTones', () => {
  const aMinorScale = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

  it('returns diatonic approach tones for A', () => {
    const refMidi = noteToMidi('A2');
    const tones = getApproachTones('A2', refMidi, aMinorScale);

    // 5th of A = E, closest to A2(45) → E2(40) or E3(52), E2 is closer
    expect(midiToNote(tones.fifth)).toBe('E2');

    // Scale step below A = G
    expect(midiToNote(tones.stepBelow)).toMatch(/G/);

    // Scale step above A = B
    expect(midiToNote(tones.stepAbove)).toMatch(/B/);

    // 4th of A = D
    expect(midiToNote(tones.fourth)).toMatch(/D/);
  });

  it('picks closest octave to reference pitch', () => {
    // Reference is C3 (MIDI 48), approaching F2 (MIDI 41)
    const tones = getApproachTones('F2', noteToMidi('C3'), aMinorScale);

    // 5th of F = C, closest to C3 → C3 (48)
    expect(tones.fifth).toBe(noteToMidi('C3'));
  });

  it('handles root not in scale gracefully', () => {
    // F# is not in A natural minor — indexOf returns -1
    // stepBelow/stepAbove should still return valid MIDI numbers
    const tones = getApproachTones('F#2', noteToMidi('A2'), aMinorScale);
    expect(tones.fifth).toBeGreaterThan(0);
    expect(tones.stepBelow).toBeGreaterThan(0);
    expect(tones.stepAbove).toBeGreaterThan(0);
    expect(tones.fourth).toBeGreaterThan(0);
  });

  it('handles invalid note input with fallback', () => {
    // Invalid input returns MIDI 60 (middle C)
    expect(noteToMidi('xyz')).toBe(60);
    expect(noteToMidi('')).toBe(60);
  });

  it('handles lowercase note input', () => {
    expect(noteToMidi('a2')).toBe(noteToMidi('A2'));
    expect(noteToMidi('c#3')).toBe(noteToMidi('C#3'));
  });
});

describe('transposeNote', () => {
  it('transposes up by semitones', () => {
    expect(transposeNote('A2', 3)).toBe('C3');
    expect(transposeNote('A2', 7)).toBe('E3');
  });

  it('transposes down by semitones', () => {
    expect(transposeNote('A2', -3)).toBe('F#2');
    expect(transposeNote('C3', -1)).toBe('B2');
  });

  it('0 semitones = no change', () => {
    expect(transposeNote('A2', 0)).toBe('A2');
  });
});

describe('transposePitchClass', () => {
  it('transposes pitch classes', () => {
    expect(transposePitchClass('A', 3)).toBe('C');
    expect(transposePitchClass('A', -3)).toBe('F#');
    expect(transposePitchClass('C', 7)).toBe('G');
  });

  it('wraps around correctly', () => {
    expect(transposePitchClass('B', 1)).toBe('C');
    expect(transposePitchClass('C', -1)).toBe('B');
  });
});

describe('transposeConfig', () => {
  const config = configFromPreset(synthwaveAm);

  it('0 semitones returns config unchanged', () => {
    const result = transposeConfig(config, 0);
    expect(result).toBe(config); // same reference
  });

  it('transposes chord roots by the shift amount', () => {
    const shifted = transposeConfig(config, 3); // Am → Cm
    // Am root was A2, +3 = C3
    const amChord = config.chordProgression.find(c => c.name === 'Am')!;
    const shiftedAm = shifted.chordProgression.find(c => c.name === 'Am')!;
    expect(noteToMidi(shiftedAm.root)).toBe(noteToMidi(amChord.root) + 3);
  });

  it('transposes all voicing notes', () => {
    const shifted = transposeConfig(config, -2);
    for (let i = 0; i < config.chordProgression.length; i++) {
      const orig = config.chordProgression[i];
      const trans = shifted.chordProgression[i];
      for (let j = 0; j < orig.padVoicing.length; j++) {
        expect(noteToMidi(trans.padVoicing[j])).toBe(noteToMidi(orig.padVoicing[j]) - 2);
      }
      for (let j = 0; j < orig.stabVoicing.length; j++) {
        expect(noteToMidi(trans.stabVoicing[j])).toBe(noteToMidi(orig.stabVoicing[j]) - 2);
      }
    }
  });

  it('transposes the scale', () => {
    const shifted = transposeConfig(config, 3);
    // A natural minor → C natural minor: C D Eb F G Ab Bb
    expect(shifted.scale).toContain('C');
    expect(shifted.scale).toContain('D');
    expect(shifted.scale).not.toContain('A');
  });

  it('transposes arrangement chords when present', () => {
    if (!config.arrangement) return;
    const shifted = transposeConfig(config, 4);
    for (let i = 0; i < config.arrangement.steps.length; i++) {
      const origRoot = config.arrangement.steps[i].chord.root;
      const transRoot = shifted.arrangement!.steps[i].chord.root;
      expect(noteToMidi(transRoot)).toBe(noteToMidi(origRoot) + 4);
    }
  });

  it('preserves chord names (identity) after transpose', () => {
    const shifted = transposeConfig(config, 3);
    const origNames = config.chordProgression.map(c => c.name);
    const shiftedNames = shifted.chordProgression.map(c => c.name);
    expect(shiftedNames).toEqual(origNames);
  });
});
