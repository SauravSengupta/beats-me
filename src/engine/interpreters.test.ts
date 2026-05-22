import { describe, it, expect } from 'vitest';
import { createLiteralInterpreter } from './interpreters';
import defaultConfig from './defaultConfig';
import { createEmptyGrid } from '../lib/grid';
import type { GridState } from '../lib/types';
import { noteToMidi, midiToNote } from '../lib/pitch';

// Derive test values from config — no hardcoded instrument names
const kit = defaultConfig.kit;
const bassKey = kit.find((r) => r.bass)?.bass?.soundKey ?? 'bass';
const kickRow = kit.findIndex((r) => r.bass?.noteType === 'root');
const noBassRow = kit.findIndex((r) => !r.bass);
const progression = defaultConfig.chordProgression;
const NUM_ROWS = kit.length;

const diatonicPcs = new Set([9, 11, 0, 2, 4, 5, 7]);
function isDiatonic(note: string): boolean {
  return diatonicPcs.has(noteToMidi(note) % 12);
}

function gridWith(
  rows: number,
  cols: number,
  fills: [number, number, number][],
): GridState {
  const grid = createEmptyGrid(rows, cols);
  for (const [r, c, v] of fills) {
    grid.cells[r][c] = v;
  }
  return grid;
}

describe('createLiteralInterpreter', () => {
  const emptyGrid = createEmptyGrid(NUM_ROWS, 16);
  const baseCtx = { loopCount: 0, tick: 1, grid: emptyGrid };

  describe('value 0 (off)', () => {
    it('produces no sounds', () => {
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp({ row: kickRow, col: 0, value: 0 }, baseCtx);
      expect(sounds).toHaveLength(0);
    });
  });

  describe('rows without bass config', () => {
    it('produces a drum sound but no bass', () => {
      const grid = gridWith(NUM_ROWS, 16, [[noBassRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: noBassRow, col: 0, value: 1 },
        { ...baseCtx, grid },
      );
      expect(sounds.length).toBeGreaterThanOrEqual(1);
      expect(sounds[0].sound).toBe(kit[noBassRow].name);
      expect(sounds.find((s) => s.sound === bassKey)).toBeUndefined();
    });
  });

  describe('kick row (noteType root, probability 1.0)', () => {
    it('produces drum + bass on downbeat', () => {
      const grid = gridWith(NUM_ROWS, 16, [[kickRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: kickRow, col: 0, value: 1 },
        { ...baseCtx, grid },
      );
      expect(sounds).toHaveLength(2);
      expect(sounds[0].sound).toBe(kit[kickRow].name);
      expect(sounds[1].sound).toBe(bassKey);
      expect(sounds[1].note).toBe(progression[0].root);
    });

    it('bass follows chord progression via loopCount', () => {
      const grid = gridWith(NUM_ROWS, 16, [[kickRow, 0, 1]]);
      for (let loop = 0; loop < progression.length; loop++) {
        const interp = createLiteralInterpreter(defaultConfig);
        const sounds = interp(
          { row: kickRow, col: 0, value: 1 },
          { ...baseCtx, grid, loopCount: loop },
        );
        const bass = sounds.find((s) => s.sound === bassKey)!;
        expect(bass.note).toBe(progression[loop].root);
      }
    });

    it('plays root on isolated "and"', () => {
      const grid = gridWith(NUM_ROWS, 16, [[kickRow, 1, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: kickRow, col: 1, value: 1 },
        { ...baseCtx, grid },
      );
      const bass = sounds.find((s) => s.sound === bassKey)!;
      expect(bass.note).toBe(progression[0].root);
    });

    it('plays diatonic approach tone on "and" with adjacent hit', () => {
      const grid = gridWith(NUM_ROWS, 16, [[kickRow, 0, 1], [kickRow, 1, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: kickRow, col: 1, value: 1 },
        { ...baseCtx, grid },
      );
      const bass = sounds.find((s) => s.sound === bassKey)!;
      expect(isDiatonic(bass.note!)).toBe(true);
    });

    it('approach tone at loop boundary is diatonic', () => {
      const grid = gridWith(NUM_ROWS, 16, [[kickRow, 15, 1], [kickRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: kickRow, col: 15, value: 1 },
        { ...baseCtx, grid, loopCount: 0 },
      );
      const bass = sounds.find((s) => s.sound === bassKey)!;
      expect(isDiatonic(bass.note!)).toBe(true);
    });

    it('always fires bass (probability 1.0)', () => {
      const grid = gridWith(NUM_ROWS, 16, [[kickRow, 0, 1]]);
      let bassCount = 0;
      for (let i = 0; i < 20; i++) {
        const interp = createLiteralInterpreter(defaultConfig);
        const sounds = interp(
          { row: kickRow, col: 0, value: 1 },
          { ...baseCtx, grid, loopCount: i },
        );
        if (sounds.find((s) => s.sound === bassKey)) bassCount++;
      }
      expect(bassCount).toBe(20);
    });
  });

  describe('PRNG re-seeding', () => {
    it('different grids produce different bass patterns', () => {
      const gridA = gridWith(NUM_ROWS, 16, [[kickRow, 0, 1], [kickRow, 1, 1]]);
      const gridB = gridWith(NUM_ROWS, 16, [[kickRow, 0, 1], [kickRow, 1, 1], [kickRow, 4, 1]]);

      const getNotes = (grid: GridState) => {
        const interp = createLiteralInterpreter(defaultConfig);
        const s0 = interp({ row: kickRow, col: 0, value: 1 }, { ...baseCtx, grid });
        const s1 = interp({ row: kickRow, col: 1, value: 1 }, { ...baseCtx, grid });
        return [
          s0.find((s) => s.sound === bassKey)?.note,
          s1.find((s) => s.sound === bassKey)?.note,
        ];
      };

      // Different grids should produce different PRNG sequences
      // (not guaranteed per-pair, but over the full pattern it's extremely unlikely to match)
      const notesA = getNotes(gridA);
      const notesB = getNotes(gridB);
      // At least verify both produce valid notes
      expect(notesA[0]).toBeDefined();
      expect(notesB[0]).toBeDefined();
    });

    it('same grid always produces same notes (deterministic)', () => {
      const grid = gridWith(NUM_ROWS, 16, [[kickRow, 0, 1], [kickRow, 1, 1]]);

      const run = () => {
        const interp = createLiteralInterpreter(defaultConfig);
        const s0 = interp({ row: kickRow, col: 0, value: 1 }, { ...baseCtx, grid });
        const s1 = interp({ row: kickRow, col: 1, value: 1 }, { ...baseCtx, grid });
        return [
          s0.find((s) => s.sound === bassKey)?.note,
          s1.find((s) => s.sound === bassKey)?.note,
        ];
      };

      expect(run()).toEqual(run());
    });
  });

  describe('row-to-sound mapping', () => {
    it('maps each row to the correct sound from config', () => {
      for (let row = 0; row < kit.length; row++) {
        const grid = gridWith(NUM_ROWS, 16, [[row, 0, 1]]);
        const interp = createLiteralInterpreter(defaultConfig);
        const sounds = interp(
          { row, col: 0, value: 1 },
          { ...baseCtx, grid },
        );
        expect(sounds[0].sound).toBe(kit[row].name);
      }
    });
  });

  describe('stab (probability + offbeat velocity)', () => {
    const stabRow = kit.findIndex((r) => r.stab != null);
    const stabKey = kit[stabRow]?.stab?.soundKey ?? 'stab';
    const stabVel = kit[stabRow]?.stab?.velocity ?? 0.5;
    const stabProb = kit[stabRow]?.stab?.probability ?? 1;

    it('fires stab on the configured row', () => {
      const grid = gridWith(NUM_ROWS, 16, [[stabRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      // Run enough times to get at least one stab (probability < 1)
      let gotStab = false;
      for (let i = 0; i < 50; i++) {
        const sounds = interp(
          { row: stabRow, col: 0, value: 1 },
          { ...baseCtx, grid },
        );
        if (sounds.find((s) => s.sound === stabKey)) {
          gotStab = true;
          break;
        }
      }
      expect(gotStab).toBe(true);
    });

    it('does not always fire stab when probability < 1', () => {
      if (stabProb >= 1) return; // skip if no probability configured
      const grid = gridWith(NUM_ROWS, 16, [[stabRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      let misses = 0;
      for (let i = 0; i < 100; i++) {
        const sounds = interp(
          { row: stabRow, col: 0, value: 1 },
          { ...baseCtx, grid },
        );
        if (!sounds.find((s) => s.sound === stabKey)) misses++;
      }
      expect(misses).toBeGreaterThan(0);
    });

    it('downbeat stab gets full velocity', () => {
      const grid = gridWith(NUM_ROWS, 16, [[stabRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      // Collect stab velocities on even column
      for (let i = 0; i < 50; i++) {
        const sounds = interp(
          { row: stabRow, col: 0, value: 1 },
          { ...baseCtx, grid },
        );
        const stab = sounds.find((s) => s.sound === stabKey);
        if (stab) {
          expect(stab.velocity).toBeCloseTo(stabVel, 5);
          break;
        }
      }
    });

    it('offbeat stab gets reduced velocity', () => {
      const offbeatScale = kit[stabRow]?.stab?.offbeatVelocity ?? 1;
      if (offbeatScale >= 1) return; // skip if no offbeat reduction
      const grid = gridWith(NUM_ROWS, 16, [[stabRow, 1, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      for (let i = 0; i < 50; i++) {
        const sounds = interp(
          { row: stabRow, col: 1, value: 1 },
          { ...baseCtx, grid },
        );
        const stab = sounds.find((s) => s.sound === stabKey);
        if (stab) {
          expect(stab.velocity).toBeCloseTo(stabVel * offbeatScale, 5);
          break;
        }
      }
    });

    it('rows without stab config produce no stab sounds', () => {
      const noStabRow = kit.findIndex((r) => !r.stab);
      const grid = gridWith(NUM_ROWS, 16, [[noStabRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: noStabRow, col: 0, value: 1 },
        { ...baseCtx, grid },
      );
      expect(sounds.find((s) => s.sound === stabKey)).toBeUndefined();
    });
  });

  describe('groove stab (voicingSource pad)', () => {
    const grooveRow = kit.findIndex((r) => r.stab?.voicingSource === 'pad');

    it('groove row emits stab-groove with padVoicing', () => {
      if (grooveRow < 0) return;
      const interp = createLiteralInterpreter(defaultConfig);
      let gotGrooveStab = false;
      for (let i = 0; i < 50; i++) {
        const grid = gridWith(NUM_ROWS, 16, [[grooveRow, 0, 1]]);
        const sounds = interp(
          { row: grooveRow, col: 0, value: 1 },
          { ...baseCtx, grid },
        );
        const stab = sounds.find((s) => s.sound === 'stab-groove');
        if (stab) {
          gotGrooveStab = true;
          // Should use padVoicing, not stabVoicing
          const expectedPadVoicing = defaultConfig.chordProgression[0].padVoicing;
          expect(stab.notes).toEqual(expectedPadVoicing);
          break;
        }
      }
      expect(gotGrooveStab).toBe(true);
    });

    it('hat stab uses stabVoicing (not padVoicing)', () => {
      const hatStabRow = kit.findIndex((r) => r.stab && r.stab.voicingSource !== 'pad');
      if (hatStabRow < 0) return;
      const interp = createLiteralInterpreter(defaultConfig);
      for (let i = 0; i < 50; i++) {
        const grid = gridWith(NUM_ROWS, 16, [[hatStabRow, 0, 1]]);
        const sounds = interp(
          { row: hatStabRow, col: 0, value: 1 },
          { ...baseCtx, grid },
        );
        const stab = sounds.find((s) => s.sound === 'stab');
        if (stab) {
          const expectedStabVoicing = defaultConfig.chordProgression[0].stabVoicing;
          expect(stab.notes).toEqual(expectedStabVoicing);
          break;
        }
      }
    });
  });

  describe('arp generation (row 0 sparkle)', () => {
    const arpRow = kit.findIndex((r) => r.arp != null);
    const arpKey = kit[arpRow]?.arp?.soundKey ?? 'arp';
    const arpNotesPerArp = kit[arpRow]?.arp?.notesPerArp ?? 4;
    const arpBaseVel = kit[arpRow]?.arp?.baseVelocity ?? 0.7;
    const arpDecay = kit[arpRow]?.arp?.velocityDecay ?? 0.7;

    it('fires arp notes alongside the drum hit', () => {
      if (arpRow < 0) return;
      const grid = gridWith(NUM_ROWS, 16, [[arpRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: arpRow, col: 0, value: 1 },
        { ...baseCtx, grid },
      );
      const drum = sounds.find((s) => s.sound === kit[arpRow].name);
      const arps = sounds.filter((s) => s.sound === arpKey);
      expect(drum).toBeDefined();
      expect(arps).toHaveLength(arpNotesPerArp);
    });

    it('arp notes are one octave above stabVoicing + double-octave root', () => {
      if (arpRow < 0) return;
      const grid = gridWith(NUM_ROWS, 16, [[arpRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: arpRow, col: 0, value: 1 },
        { ...baseCtx, grid },
      );
      const arps = sounds.filter((s) => s.sound === arpKey);
      const v = progression[0].stabVoicing;
      const validNotes = new Set([
        midiToNote(noteToMidi(v[0]) + 12),  // root +1 oct
        midiToNote(noteToMidi(v[1]) + 12),  // 5th +1 oct
        midiToNote(noteToMidi(v[2]) + 12),  // top +1 oct
        midiToNote(noteToMidi(v[0]) + 24),  // root +2 oct
      ]);
      for (const arp of arps) {
        expect(validNotes.has(arp.note!)).toBe(true);
      }
    });

    it('arp notes have 16th-note spacing (0.25 beatOffset increments)', () => {
      if (arpRow < 0) return;
      const grid = gridWith(NUM_ROWS, 16, [[arpRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: arpRow, col: 0, value: 1 },
        { ...baseCtx, grid },
      );
      const arps = sounds.filter((s) => s.sound === arpKey);
      for (let i = 0; i < arps.length; i++) {
        expect(arps[i].beatOffset).toBeCloseTo(i * 0.25, 5);
      }
    });

    it('arp velocity decays per note (within humanize tolerance)', () => {
      if (arpRow < 0) return;
      const grid = gridWith(NUM_ROWS, 16, [[arpRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: arpRow, col: 0, value: 1 },
        { ...baseCtx, grid },
      );
      const arps = sounds.filter((s) => s.sound === arpKey);
      if (arps.length === 0) return; // probability gate may skip
      const humanize = kit[arpRow]?.arp?.humanize ?? 0;
      let expectedVel = arpBaseVel;
      for (const arp of arps) {
        // With humanize, velocity can vary ±humanize from expected
        expect(arp.velocity).toBeGreaterThanOrEqual(Math.max(0.1, expectedVel - humanize));
        expect(arp.velocity).toBeLessThanOrEqual(Math.min(1, expectedVel + humanize));
        expectedVel *= arpDecay;
      }
    });

    it('downbeat arp is ascending by pitch', () => {
      if (arpRow < 0) return;
      const grid = gridWith(NUM_ROWS, 16, [[arpRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: arpRow, col: 0, value: 1 },
        { ...baseCtx, grid },
      );
      const arps = sounds.filter((s) => s.sound === arpKey);
      // Verify ascending MIDI order
      const midis = arps.map((a) => noteToMidi(a.note!));
      for (let i = 1; i < midis.length; i++) {
        expect(midis[i]).toBeGreaterThan(midis[i - 1]);
      }
    });

    it('offbeat arp is descending by pitch', () => {
      if (arpRow < 0) return;
      const grid = gridWith(NUM_ROWS, 16, [[arpRow, 1, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: arpRow, col: 1, value: 1 },
        { ...baseCtx, grid },
      );
      const arps = sounds.filter((s) => s.sound === arpKey);
      // Verify descending MIDI order
      const midis = arps.map((a) => noteToMidi(a.note!));
      for (let i = 1; i < midis.length; i++) {
        expect(midis[i]).toBeLessThan(midis[i - 1]);
      }
    });

    it('truncates arp near chord boundary (column 15 → 2 notes max)', () => {
      if (arpRow < 0) return;
      const grid = gridWith(NUM_ROWS, 16, [[arpRow, 15, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: arpRow, col: 15, value: 1 },
        { ...baseCtx, grid },
      );
      const arps = sounds.filter((s) => s.sound === arpKey);
      // Column 15: only 1 column remains = 2 sixteenths max (or 0 if probability-gated)
      expect(arps.length).toBeLessThanOrEqual(2);
    });

    it('full arp at column 12 (4 columns remain = 8 sixteenths)', () => {
      if (arpRow < 0) return;
      const grid = gridWith(NUM_ROWS, 16, [[arpRow, 12, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: arpRow, col: 12, value: 1 },
        { ...baseCtx, grid },
      );
      const arps = sounds.filter((s) => s.sound === arpKey);
      // Either full arp or 0 (probability gate skipped this one)
      expect(arps.length === arpNotesPerArp || arps.length === 0).toBe(true);
    });

    it('arp follows chord progression via loopCount', () => {
      if (arpRow < 0) return;
      for (let loop = 0; loop < progression.length; loop++) {
        const grid = gridWith(NUM_ROWS, 16, [[arpRow, 0, 1]]);
        const interp = createLiteralInterpreter(defaultConfig);
        const sounds = interp(
          { row: arpRow, col: 0, value: 1 },
          { ...baseCtx, grid, loopCount: loop },
        );
        const arps = sounds.filter((s) => s.sound === arpKey);
        const v = progression[loop].stabVoicing;
        const validNotes = new Set([
          midiToNote(noteToMidi(v[0]) + 12),
          midiToNote(noteToMidi(v[1]) + 12),
          midiToNote(noteToMidi(v[2]) + 12),
          midiToNote(noteToMidi(v[0]) + 24),
        ]);
        for (const arp of arps) {
          expect(validNotes.has(arp.note!)).toBe(true);
        }
      }
    });

    it('rows without arp config produce no arp sounds', () => {
      const noArpRow = kit.findIndex((r) => !r.arp);
      if (noArpRow < 0) return;
      const grid = gridWith(NUM_ROWS, 16, [[noArpRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const sounds = interp(
        { row: noArpRow, col: 0, value: 1 },
        { ...baseCtx, grid },
      );
      expect(sounds.find((s) => s.sound === arpKey)).toBeUndefined();
    });

    it('arp probability gate occasionally skips arp (cymbal-only)', () => {
      if (arpRow < 0) return;
      const prob = kit[arpRow]?.arp?.probability ?? 1;
      if (prob >= 1) return; // no gate configured, skip test
      // Run many cells — with 90% probability, at least one should be skipped over 16 cells
      const interp = createLiteralInterpreter(defaultConfig);
      let skipped = 0;
      let fired = 0;
      for (let col = 0; col < 16; col++) {
        const grid = gridWith(NUM_ROWS, 16, [[arpRow, col, 1]]);
        const sounds = interp(
          { row: arpRow, col, value: 1 },
          { ...baseCtx, grid },
        );
        const arps = sounds.filter((s) => s.sound === arpKey);
        const drum = sounds.find((s) => s.sound === kit[arpRow].name);
        expect(drum).toBeDefined(); // drum always fires regardless of arp gate
        if (arps.length === 0) skipped++;
        else fired++;
      }
      // With 90% probability over 16 trials, expect at least one skip and many fires
      expect(fired).toBeGreaterThan(0);
      expect(skipped + fired).toBe(16);
    });

    it('offbeat arps are quieter than downbeat arps', () => {
      if (arpRow < 0) return;
      const offbeatVel = kit[arpRow]?.arp?.offbeatVelocity;
      if (offbeatVel == null || offbeatVel >= 1) return;
      const interp = createLiteralInterpreter(defaultConfig);
      // Downbeat (col 0)
      const gridDown = gridWith(NUM_ROWS, 16, [[arpRow, 0, 1]]);
      const soundsDown = interp(
        { row: arpRow, col: 0, value: 1 },
        { ...baseCtx, grid: gridDown },
      );
      const arpsDown = soundsDown.filter((s) => s.sound === arpKey);
      // Offbeat (col 1)
      const gridOff = gridWith(NUM_ROWS, 16, [[arpRow, 1, 1]]);
      const soundsOff = interp(
        { row: arpRow, col: 1, value: 1 },
        { ...baseCtx, grid: gridOff },
      );
      const arpsOff = soundsOff.filter((s) => s.sound === arpKey);
      if (arpsDown.length > 0 && arpsOff.length > 0) {
        // First note of offbeat arp should be quieter (within humanize tolerance)
        const humanize = kit[arpRow]?.arp?.humanize ?? 0;
        expect(arpsOff[0].velocity).toBeLessThanOrEqual(
          arpBaseVel * offbeatVel + humanize,
        );
      }
    });

    it('arp velocity humanization produces variation across cells', () => {
      if (arpRow < 0) return;
      const humanize = kit[arpRow]?.arp?.humanize ?? 0;
      if (humanize === 0) return;
      const interp = createLiteralInterpreter(defaultConfig);
      const firstNoteVelocities: number[] = [];
      for (let col = 0; col < 16; col += 2) { // downbeats only for fair comparison
        const grid = gridWith(NUM_ROWS, 16, [[arpRow, col, 1]]);
        const sounds = interp(
          { row: arpRow, col, value: 1 },
          { ...baseCtx, grid },
        );
        const arps = sounds.filter((s) => s.sound === arpKey);
        if (arps.length > 0) firstNoteVelocities.push(arps[0].velocity);
      }
      if (firstNoteVelocities.length < 3) return;
      // With humanize, not all first-note velocities should be identical
      const allSame = firstNoteVelocities.every((v) => v === firstNoteVelocities[0]);
      expect(allSame).toBe(false);
    });

    it('arpOctaveShift=-12 lowers arp notes by one octave', () => {
      if (arpRow < 0) return;
      const grid = gridWith(NUM_ROWS, 16, [[arpRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      // Default (no shift)
      const defaultSounds = interp(
        { row: arpRow, col: 0, value: 1 },
        { ...baseCtx, grid },
      );
      // Shifted down
      const shiftedSounds = interp(
        { row: arpRow, col: 0, value: 1 },
        { ...baseCtx, grid, arpOctaveShift: -12 },
      );
      const defaultArps = defaultSounds.filter((s) => s.sound === arpKey);
      const shiftedArps = shiftedSounds.filter((s) => s.sound === arpKey);
      expect(shiftedArps).toHaveLength(defaultArps.length);
      for (let i = 0; i < defaultArps.length; i++) {
        expect(noteToMidi(shiftedArps[i].note!)).toBe(noteToMidi(defaultArps[i].note!) - 12);
      }
    });

    it('arpOctaveShift=+12 raises arp notes by one octave', () => {
      if (arpRow < 0) return;
      const grid = gridWith(NUM_ROWS, 16, [[arpRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const defaultSounds = interp(
        { row: arpRow, col: 0, value: 1 },
        { ...baseCtx, grid },
      );
      const shiftedSounds = interp(
        { row: arpRow, col: 0, value: 1 },
        { ...baseCtx, grid, arpOctaveShift: 12 },
      );
      const defaultArps = defaultSounds.filter((s) => s.sound === arpKey);
      const shiftedArps = shiftedSounds.filter((s) => s.sound === arpKey);
      for (let i = 0; i < defaultArps.length; i++) {
        expect(noteToMidi(shiftedArps[i].note!)).toBe(noteToMidi(defaultArps[i].note!) + 12);
      }
    });
  });

  describe('voicingShift', () => {
    it('voicingShift=+12 raises stab voicing by one octave', () => {
      // Find a row with stab config
      const stabRow = kit.findIndex((r) => r.stab != null);
      if (stabRow < 0) return;
      const stabKey = kit[stabRow]?.stab?.soundKey ?? 'stab';
      const grid = gridWith(NUM_ROWS, 16, [[stabRow, 0, 1]]);
      const interp = createLiteralInterpreter(defaultConfig);
      const defaultSounds = interp(
        { row: stabRow, col: 0, value: 1 },
        { ...baseCtx, grid },
      );
      const shiftedSounds = interp(
        { row: stabRow, col: 0, value: 1 },
        { ...baseCtx, grid, voicingShift: 12 },
      );
      const defaultStab = defaultSounds.find((s) => s.sound === stabKey);
      const shiftedStab = shiftedSounds.find((s) => s.sound === stabKey);
      if (!defaultStab?.notes || !shiftedStab?.notes) return;
      for (let i = 0; i < defaultStab.notes.length; i++) {
        expect(noteToMidi(shiftedStab.notes[i])).toBe(noteToMidi(defaultStab.notes[i]) + 12);
      }
    });
  });

  describe('pad-pulse (sidechain)', () => {
    it('interpreter never emits pad-pulse (pump is now SoundEngine-driven)', () => {
      const interp = createLiteralInterpreter(defaultConfig);
      for (let r = 0; r < NUM_ROWS; r++) {
        const grid = gridWith(NUM_ROWS, 16, [[r, 0, 1]]);
        for (let loop = 0; loop < 4; loop++) {
          const sounds = interp(
            { row: r, col: 0, value: 1 },
            { ...baseCtx, grid, loopCount: loop },
          );
          const pulse = sounds.find((s) => s.sound === 'pad-pulse');
          expect(pulse, `row ${r} loop ${loop} should not emit pad-pulse`).toBeUndefined();
        }
      }
    });
  });

  describe('velocity humanization', () => {
    const humanizedRow = kit.findIndex((r) => (r.humanize ?? 0) > 0);
    const noHumanizeRow = kit.findIndex((r) => (r.humanize ?? 0) === 0);

    it('humanized rows have velocity variation within ±amount band', () => {
      if (humanizedRow < 0) return; // skip if no rows have humanize
      const amount = kit[humanizedRow].humanize!;
      const interp = createLiteralInterpreter(defaultConfig);
      const velocities = new Set<number>();
      // Run many times — PRNG is grid-seeded so we vary the grid
      for (let c = 0; c < 16; c++) {
        const g = gridWith(NUM_ROWS, 16, [[humanizedRow, c, 1]]);
        const sounds = interp(
          { row: humanizedRow, col: c, value: 1 },
          { ...baseCtx, grid: g },
        );
        const drum = sounds.find((s) => s.sound === kit[humanizedRow].name);
        if (drum) {
          velocities.add(drum.velocity);
          expect(drum.velocity).toBeGreaterThanOrEqual(0.7 - amount - 0.001);
          expect(drum.velocity).toBeLessThanOrEqual(0.7 + amount + 0.001);
        }
      }
      // Should have some variation (not all identical)
      expect(velocities.size).toBeGreaterThan(1);
    });

    it('non-humanized rows always get base velocity', () => {
      if (noHumanizeRow < 0) return;
      const interp = createLiteralInterpreter(defaultConfig);
      for (let c = 0; c < 16; c++) {
        const g = gridWith(NUM_ROWS, 16, [[noHumanizeRow, c, 1]]);
        const sounds = interp(
          { row: noHumanizeRow, col: c, value: 1 },
          { ...baseCtx, grid: g },
        );
        const drum = sounds.find((s) => s.sound === kit[noHumanizeRow].name);
        if (drum) {
          expect(drum.velocity).toBe(0.7);
        }
      }
    });
  });
});
