import { describe, it, expect } from 'vitest';
import { generateLongArrangement, buildChordMap } from './generator';
import { ARCHETYPES, archetypeTotalLoops } from './archetypes';
import { INTRO_PAIRS, INTRO_QUADS, A_CYCLES, B_SEQUENCES, RES_SHORT, RES_LONG } from './chordPools';
import { Arranger } from '../engine/Arranger';
import synthwaveAm from '../presets/synthwave-am';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const chordMap = buildChordMap(synthwaveAm);

// All valid chord names across all sections
const ALL_INTRO_CHORD_NAMES = new Set([
  ...INTRO_PAIRS.flat(),
  ...INTRO_QUADS.flat(),
]);
const A_CHORD_NAMES = new Set(A_CYCLES.flat());
const B_CHORD_NAMES = new Set(B_SEQUENCES.flat());
const RES_CHORD_NAMES = new Set([...RES_SHORT.flat(), ...RES_LONG.flat()]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateLongArrangement', () => {
  it('is deterministic — same seed produces identical arrangement', () => {
    const a = generateLongArrangement(42, chordMap);
    const b = generateLongArrangement(42, chordMap);

    expect(a.steps.length).toBe(b.steps.length);
    for (let i = 0; i < a.steps.length; i++) {
      expect(a.steps[i].chord.name).toBe(b.steps[i].chord.name);
      expect(a.steps[i].energy).toBe(b.steps[i].energy);
      expect(a.steps[i].riser).toBe(b.steps[i].riser);
      expect(a.steps[i].fill).toBe(b.steps[i].fill);
    }
    expect(a.finalBeat?.name).toBe(b.finalBeat?.name);
  });

  it('different seeds can produce different arrangements', () => {
    const lengths = new Set<number>();
    for (let seed = 0; seed < 50; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      lengths.add(arr.steps.length);
    }
    // Should see at least 3 distinct lengths (from different archetypes)
    expect(lengths.size).toBeGreaterThanOrEqual(3);
  });

  it('all arrangements are within 21-30 loop range', () => {
    for (let seed = 0; seed < 100; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      expect(arr.steps.length).toBeGreaterThanOrEqual(21);
      expect(arr.steps.length).toBeLessThanOrEqual(30);
    }
  });

  it('starts with intro label', () => {
    for (let seed = 0; seed < 20; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      expect(arr.steps[0].label).toBe('intro');
    }
  });

  it('has A and B section labels', () => {
    for (let seed = 0; seed < 20; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      const labels = arr.steps.map(s => s.label).filter(Boolean);
      expect(labels).toContain('A');
      expect(labels).toContain('B');
    }
  });

  it('intro has pulse=0 and bass=0 (kick+bass reserved for A1)', () => {
    for (let seed = 0; seed < 20; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      // Find intro steps (from start until first 'A' label)
      const aIndex = arr.steps.findIndex(s => s.label === 'A');
      for (let i = 0; i < aIndex; i++) {
        const step = arr.steps[i];
        // pulse and bass must be 0 (not 'previous')
        expect(step.pulse).toBe(0);
        expect(step.bass).toBe(0);
      }
    }
  });

  it('intro chords come from valid pools', () => {
    for (let seed = 0; seed < 20; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      const aIndex = arr.steps.findIndex(s => s.label === 'A');
      for (let i = 0; i < aIndex; i++) {
        expect(ALL_INTRO_CHORD_NAMES.has(arr.steps[i].chord.name)).toBe(true);
      }
    }
  });

  it('A sections use valid chord cycle chords (including Em)', () => {
    for (let seed = 0; seed < 20; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      // Find A section range: from first 'A' label to 'B' label (skipping breakdown)
      const aStart = arr.steps.findIndex(s => s.label === 'A');
      const bStart = arr.steps.findIndex(s => s.label === 'B');
      // Between A start and B start, non-breakdown steps should use A chords
      // Breakdown uses G which is also in A_CHORD_NAMES, so this works
      for (let i = aStart; i < bStart; i++) {
        expect(A_CHORD_NAMES.has(arr.steps[i].chord.name)).toBe(true);
      }
    }
  });

  it('B section uses C/F/Dm/E chords', () => {
    for (let seed = 0; seed < 20; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      const bStart = arr.steps.findIndex(s => s.label === 'B');
      // Find where resolution starts (next 'A' label after B)
      const resStart = arr.steps.findIndex((s, i) => i > bStart && s.label === 'A');
      for (let i = bStart; i < resStart; i++) {
        expect(B_CHORD_NAMES.has(arr.steps[i].chord.name)).toBe(true);
      }
    }
  });

  it('resolution uses valid chord names', () => {
    for (let seed = 0; seed < 20; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      // Resolution is everything after the last 'A' label (which follows B)
      const bStart = arr.steps.findIndex(s => s.label === 'B');
      const resStart = arr.steps.findIndex((s, i) => i > bStart && s.label === 'A');
      for (let i = resStart; i < arr.steps.length; i++) {
        expect(RES_CHORD_NAMES.has(arr.steps[i].chord.name)).toBe(true);
      }
    }
  });

  it('multiple B-section sequences are used across seeds', () => {
    // Track the 2nd chord in B section (differs across sequences)
    const secondBChords = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      const bStart = arr.steps.findIndex(s => s.label === 'B');
      if (bStart >= 0 && bStart + 1 < arr.steps.length) {
        secondBChords.add(arr.steps[bStart + 1].chord.name);
      }
    }
    expect(secondBChords.size).toBeGreaterThanOrEqual(3);
  });

  it('multiple resolution sequences are used across 4-loop resolutions', () => {
    // Track the 2nd chord in resolution (differs across sequences)
    const secondResChords = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      const bStart = arr.steps.findIndex(s => s.label === 'B');
      const resStart = arr.steps.findIndex((s, i) => i > bStart && s.label === 'A');
      const resLen = arr.steps.length - resStart;
      if (resLen >= 4 && resStart + 1 < arr.steps.length) {
        secondResChords.add(arr.steps[resStart + 1].chord.name);
      }
    }
    // Should see at least 3 distinct 2nd chords (G, F, Dm)
    expect(secondResChords.size).toBeGreaterThanOrEqual(3);
  });

  it('has at least one riser and one fill', () => {
    for (let seed = 0; seed < 20; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      const hasRiser = arr.steps.some(s => s.riser !== undefined);
      const hasFill = arr.steps.some(s => s.fill !== undefined);
      expect(hasRiser).toBe(true);
      expect(hasFill).toBe(true);
    }
  });

  it('final beat is Am', () => {
    for (let seed = 0; seed < 20; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      expect(arr.finalBeat?.name).toBe('Am');
    }
  });

  it('is compatible with Arranger (no errors)', () => {
    for (let seed = 0; seed < 20; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      const arranger = new Arranger(arr, seed, 16);
      // Should be able to get context for every step
      for (let i = 0; i <= arr.steps.length; i++) {
        expect(() => arranger.getContext(i)).not.toThrow();
      }
    }
  });
});

describe('archetypes', () => {
  it('all archetypes produce loops in the 21-30 range', () => {
    for (const arch of ARCHETYPES) {
      const total = archetypeTotalLoops(arch);
      expect(total).toBeGreaterThanOrEqual(21);
      expect(total).toBeLessThanOrEqual(30);
    }
  });

  it('multiple A-section chord cycles are used across seeds', () => {
    const secondChords = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      const aStart = arr.steps.findIndex(s => s.label === 'A');
      // Second chord in A section reveals which cycle was picked
      if (aStart >= 0 && aStart + 1 < arr.steps.length) {
        secondChords.add(arr.steps[aStart + 1].chord.name);
      }
    }
    // Should see at least 3 distinct second chords (F, G, Dm, Em, F)
    expect(secondChords.size).toBeGreaterThanOrEqual(3);
  });

  it('all 6 archetypes are reachable across seeds', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      seen.add(arr.steps.length);
    }
    // Each archetype has a distinct total loop count (21,23,24,26,27,30)
    const expectedTotals = ARCHETYPES.map(archetypeTotalLoops);
    for (const total of expectedTotals) {
      expect(seen.has(total)).toBe(true);
    }
  });

  it('intro length is 2 or 4 (matching archetype introLoops)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const arr = generateLongArrangement(seed, chordMap);
      const aIndex = arr.steps.findIndex(s => s.label === 'A');
      expect([2, 4]).toContain(aIndex);
    }
  });
});

describe('buildChordMap', () => {
  it('includes A-section, B-section, and extended chords', () => {
    expect(chordMap['Am']).toBeDefined();
    expect(chordMap['F']).toBeDefined();
    expect(chordMap['Dm']).toBeDefined();
    expect(chordMap['G']).toBeDefined();
    expect(chordMap['C']).toBeDefined();
    expect(chordMap['E']).toBeDefined();
    expect(chordMap['Em']).toBeDefined();
  });
});
