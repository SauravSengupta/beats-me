import { describe, it, expect } from 'vitest';
import { Scheduler } from './Scheduler';
import defaultConfig from './defaultConfig';
import { createEmptyGrid } from '../lib/grid';
import type { CellInterpreter, GridState } from '../lib/types';
import { noteToMidi } from '../lib/pitch';

// Derive expected values from the preset — no hardcoded instrument names
const kit = defaultConfig.kit;
const bassKey = kit.find((r) => r.bass)?.bass?.soundKey ?? 'bass';
const stabKey = kit.find((r) => r.stab)?.stab?.soundKey ?? 'stab';
const stabGrooveKey = kit.find((r) => r.stab?.soundKey === 'stab-groove')?.stab?.soundKey ?? 'stab-groove';
const arpKey = kit.find((r) => r.arp)?.arp?.soundKey ?? 'arp';
const generatedKeys = new Set([bassKey, stabKey, stabGrooveKey, arpKey]);
const kickRow = kit.findIndex((r) => r.bass?.noteType === 'root');
const plainRow = kit.findIndex((r) => !r.bass && !r.stab && !r.arp); // row with no generated sounds
const allDrumNames = kit.map((r) => r.name);
const NUM_ROWS = kit.length;
const progression = defaultConfig.chordProgression;

// A natural minor pitch classes: A=9 B=11 C=0 D=2 E=4 F=5 G=7
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

describe('Scheduler', () => {
  const ctx = { loopCount: 0 };

  it('returns empty array for empty grid', () => {
    const s = new Scheduler(defaultConfig);
    s.setGrid(createEmptyGrid(NUM_ROWS, 16));
    expect(s.step(0, ctx)).toEqual([]);
  });

  it('returns drum + bass sounds for a kick-row cell', () => {
    const s = new Scheduler(defaultConfig);
    s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 0, 1]]));

    const sounds = s.step(0, ctx);
    const drum = sounds.find((s) => s.sound === kit[kickRow].name);
    const bass = sounds.find((s) => s.sound === bassKey);
    expect(drum).toBeDefined();
    expect(bass).toBeDefined();
    expect(bass!.note).toBe(progression[0].root);
  });

  it('returns only drum sound for rows without any generated layer', () => {
    if (plainRow < 0) return; // all rows have generated sounds in this preset
    const s = new Scheduler(defaultConfig);
    s.setGrid(gridWith(NUM_ROWS, 16, [[plainRow, 0, 1]]));

    const sounds = s.step(0, ctx);
    expect(sounds).toHaveLength(1);
    expect(sounds[0].sound).toBe(kit[plainRow].name);
  });

  it('maps all rows to correct instruments', () => {
    const s = new Scheduler(defaultConfig);
    const fills: [number, number, number][] = kit.map((_, i) => [i, 0, 1]);
    s.setGrid(gridWith(NUM_ROWS, 16, fills));

    const sounds = s.step(0, ctx);
    const drumNames = sounds.filter((s) => !generatedKeys.has(s.sound)).map((s) => s.sound);
    expect(drumNames).toEqual(allDrumNames);
  });

  it('only returns sounds for the stepped column', () => {
    // Use a minimal interpreter that emits exactly 1 sound per cell
    const oneSound: CellInterpreter = ({ row, col, value }) => {
      if (value === 0) return [];
      return [{ row, col, value, beatOffset: 0, sound: 'test', velocity: 0.7 }];
    };
    const s = new Scheduler(defaultConfig, oneSound);
    s.setGrid(gridWith(NUM_ROWS, 16, [[0, 0, 1], [0, 4, 1]]));

    expect(s.step(0, ctx)).toHaveLength(1);
    expect(s.step(1, ctx)).toHaveLength(0);
    expect(s.step(2, ctx)).toHaveLength(0);
    expect(s.step(3, ctx)).toHaveLength(0);
    expect(s.step(4, ctx)).toHaveLength(1);
  });

  it('increments tick on each step', () => {
    const s = new Scheduler(defaultConfig);
    s.setGrid(createEmptyGrid(NUM_ROWS, 16));

    expect(s.getTick()).toBe(0);
    s.step(0, ctx);
    expect(s.getTick()).toBe(1);
    s.step(1, ctx);
    expect(s.getTick()).toBe(2);
  });

  describe('bass chord progression', () => {
    it('plays root of first chord on loop 0', () => {
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 0, 1]]));
      const bass = s.step(0, { loopCount: 0 }).find((s) => s.sound === bassKey)!;
      expect(bass.note).toBe(progression[0].root);
    });

    it('plays root of second chord on loop 1', () => {
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 0, 1]]));
      const bass = s.step(0, { loopCount: 1 }).find((s) => s.sound === bassKey)!;
      expect(bass.note).toBe(progression[1].root);
    });

    it('cycles back to first chord after full progression', () => {
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 0, 1]]));
      const bass = s.step(0, { loopCount: progression.length }).find((s) => s.sound === bassKey)!;
      expect(bass.note).toBe(progression[0].root);
    });
  });

  describe('bass approach tones (kick row)', () => {
    it('plays root on downbeat even with adjacent hit', () => {
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 0, 1], [kickRow, 1, 1]]));
      s.step(0, { loopCount: 0 });
      const bass = s.step(0, { loopCount: 0 }).find((s) => s.sound === bassKey)!;
      expect(bass.note).toBe(progression[0].root);
    });

    it('plays diatonic note on "and" with adjacent hit', () => {
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 0, 1], [kickRow, 1, 1]]));
      s.step(0, { loopCount: 0 });
      const step1 = s.step(1, { loopCount: 0 });
      const bass = step1.find((s) => s.sound === bassKey)!;
      expect(bass.note).toBeDefined();
      expect(isDiatonic(bass.note!)).toBe(true);
    });

    it('plays root on isolated "and" hit', () => {
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 1, 1]]));
      const bass = s.step(1, { loopCount: 0 }).find((s) => s.sound === bassKey)!;
      expect(bass.note).toBe(progression[0].root);
    });
  });

  describe('rows without bass config', () => {
    it('never emit bass', () => {
      const s = new Scheduler(defaultConfig);
      const noBassRow = kit.findIndex((r) => !r.bass);
      s.setGrid(gridWith(NUM_ROWS, 16, [[noBassRow, 0, 1]]));

      for (let loop = 0; loop < 10; loop++) {
        const sounds = s.step(0, { loopCount: loop });
        const bass = sounds.find((snd) => snd.sound === bassKey);
        expect(bass).toBeUndefined();
      }
    });
  });

  describe('ghost bass approach tones', () => {
    it('emits ghost bass on empty "and" before a downbeat kick', () => {
      const s = new Scheduler(defaultConfig);
      // Kick on col 2 (downbeat), col 1 (and) is empty → ghost possible
      s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 2, 1]]));

      // Run col 1 many times to overcome probability gate (55%)
      let gotGhost = false;
      for (let i = 0; i < 50; i++) {
        const scheduler = new Scheduler(defaultConfig);
        scheduler.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 2, 1]]));
        const sounds = scheduler.step(1, { loopCount: 0 });
        const ghost = sounds.find((snd) => snd.sound === bassKey);
        if (ghost) {
          gotGhost = true;
          // Ghost should be quieter than normal bass
          expect(ghost.velocity).toBeLessThan(
            kit[kickRow].bass!.velocity,
          );
          expect(isDiatonic(ghost.note!)).toBe(true);
          break;
        }
      }
      expect(gotGhost).toBe(true);
    });

    it('no ghost bass when "and" has a user-placed kick', () => {
      const s = new Scheduler(defaultConfig);
      // User placed kicks on both col 1 and col 2 — interpreter handles col 1
      s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 1, 1], [kickRow, 2, 1]]));

      // Step col 1 — should get the user's kick + bass, not a ghost
      const sounds = s.step(1, { loopCount: 0 });
      const bassNotes = sounds.filter((snd) => snd.sound === bassKey);
      // Should have exactly 1 bass (from interpreter), not 2
      expect(bassNotes.length).toBeLessThanOrEqual(1);
    });

    it('no ghost bass on "and" without a following downbeat kick', () => {
      const s = new Scheduler(defaultConfig);
      // Kick on col 0 only — col 1 has no kick after it on col 2
      s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 0, 1]]));

      const sounds = s.step(1, { loopCount: 0 });
      const ghost = sounds.find((snd) => snd.sound === bassKey);
      expect(ghost).toBeUndefined();
    });
  });

  describe('determinism', () => {
    it('same grid produces same notes across runs', () => {
      const grid = gridWith(NUM_ROWS, 16, [
        [kickRow, 0, 1], [kickRow, 1, 1],
        [kickRow, 4, 1], [kickRow, 5, 1],
      ]);

      const run = () => {
        const s = new Scheduler(defaultConfig);
        s.setGrid(grid);
        const notes: (string | undefined)[] = [];
        for (let col = 0; col < 16; col++) {
          const sounds = s.step(col, { loopCount: 0 });
          const bass = sounds.find((snd) => snd.sound === bassKey);
          notes.push(bass?.note);
        }
        return notes;
      };

      expect(run()).toEqual(run());
    });
  });

  describe('voiceProbs gating', () => {
    it('silences drums when drum voiceProb is 0', () => {
      const s = new Scheduler(defaultConfig);
      // Fill all rows at col 0
      const fills: [number, number, number][] = kit.map((_, i) => [i, 0, 1]);
      s.setGrid(gridWith(NUM_ROWS, 16, fills));

      // All drum probs 0 — no drum sounds should fire
      const voiceProbs = {
        sparkle: 0, rhythm: 0, groove: 0, pulse: 0,
        pad: 1, bass: 1, stab: 1, stabGroove: 1, arp: 1,
      };
      const sounds = s.step(0, { loopCount: 0, voiceProbs });
      const drumSounds = sounds.filter((snd) => allDrumNames.includes(snd.sound));
      expect(drumSounds).toHaveLength(0);
    });

    it('allows drums when drum voiceProb is 1', () => {
      const s = new Scheduler(defaultConfig);
      const fills: [number, number, number][] = kit.map((_, i) => [i, 0, 1]);
      s.setGrid(gridWith(NUM_ROWS, 16, fills));

      const voiceProbs = {
        sparkle: 1, rhythm: 1, groove: 1, pulse: 1,
        pad: 1, bass: 1, stab: 1, stabGroove: 1, arp: 1,
      };
      const sounds = s.step(0, { loopCount: 0, voiceProbs });
      const drumSounds = sounds.filter((snd) => allDrumNames.includes(snd.sound));
      expect(drumSounds.length).toBeGreaterThan(0);
    });

    it('silences bass when bass voiceProb is 0', () => {
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 0, 1]]));

      const voiceProbs = {
        sparkle: 1, rhythm: 1, groove: 1, pulse: 1,
        pad: 1, bass: 0, stab: 1, stabGroove: 1, arp: 1,
      };
      const sounds = s.step(0, { loopCount: 0, voiceProbs });
      const bass = sounds.find((snd) => snd.sound === bassKey);
      expect(bass).toBeUndefined();
    });

    it('silences arp when arp voiceProb is 0', () => {
      const arpRow = kit.findIndex((r) => r.arp != null);
      if (arpRow < 0) return;
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[arpRow, 0, 1]]));

      const voiceProbs = {
        sparkle: 1, rhythm: 1, groove: 1, pulse: 1,
        pad: 1, bass: 1, stab: 1, stabGroove: 1, arp: 0,
      };
      const sounds = s.step(0, { loopCount: 0, voiceProbs });
      const arps = sounds.filter((snd) => snd.sound === arpKey);
      expect(arps).toHaveLength(0);
    });

    it('companions still fire when drums are muted (intro behavior)', () => {
      // During intro: drums silent but stab/arp companions should still fire from cells
      const stabRow = kit.findIndex((r) => r.stab != null);
      if (stabRow < 0) return;
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[stabRow, 0, 1]]));

      const voiceProbs = {
        sparkle: 0, rhythm: 0, groove: 0, pulse: 0,
        pad: 1, bass: 0, stab: 1, stabGroove: 1, arp: 1,
      };
      // Run multiple times since stab is probability-gated
      let gotStab = false;
      for (let i = 0; i < 30; i++) {
        const scheduler = new Scheduler(defaultConfig);
        scheduler.setGrid(gridWith(NUM_ROWS, 16, [[stabRow, 0, 1]]));
        const sounds = scheduler.step(0, { loopCount: 0, voiceProbs });
        if (sounds.some((snd) => snd.sound === stabKey || snd.sound === stabGrooveKey)) {
          gotStab = true;
          break;
        }
      }
      expect(gotStab).toBe(true);
    });

    it('without voiceProbs, all sounds play at full probability', () => {
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 0, 1]]));

      // No voiceProbs = no arrangement filtering
      const sounds = s.step(0, { loopCount: 0 });
      const drum = sounds.find((snd) => snd.sound === kit[kickRow].name);
      expect(drum).toBeDefined();
    });
  });

  describe('setConfig', () => {
    it('reconfigures the scheduler with new config', () => {
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 0, 1]]));

      const before = s.step(0, { loopCount: 0 }).find((snd) => snd.sound === bassKey)!;
      expect(before.note).toBe(progression[0].root);

      // Change config with different tempo (shouldn't affect note selection)
      s.setConfig({ ...defaultConfig, tempo: 80 });
      const after = s.step(0, { loopCount: 0 }).find((snd) => snd.sound === bassKey)!;
      expect(after.note).toBe(progression[0].root);
    });
  });

  describe('arp timing (16th note offsets)', () => {
    const arpRow = kit.findIndex((r) => r.arp != null);
    const arpKey = kit[arpRow]?.arp?.soundKey ?? 'arp';

    it('all 4 arp notes are immediate (beatOffset < 1.0)', () => {
      if (arpRow < 0) return;
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[arpRow, 0, 1]]));

      const step0 = s.step(0, ctx);
      const arps = step0.filter((snd) => snd.sound === arpKey);
      // All 4 notes at 16th spacing (0, 0.25, 0.5, 0.75) are < 1.0
      expect(arps).toHaveLength(4);
      expect(s.getPendingEvents().filter((snd) => snd.sound === arpKey)).toHaveLength(0);
    });

    it('arp beatOffsets are 0.25 apart (16th notes in quarter-note units)', () => {
      if (arpRow < 0) return;
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[arpRow, 0, 1]]));

      const step0 = s.step(0, ctx);
      const arps = step0.filter((snd) => snd.sound === arpKey);
      expect(arps.map((a) => a.beatOffset)).toEqual([0, 0.25, 0.5, 0.75]);
    });
  });

  describe('snare fill', () => {
    const snareRow = kit.findIndex((r) => r.synthType === 'noise-snare');
    const snareName = snareRow >= 0 ? kit[snareRow].name : '';
    const defaultFill = { type: 'snare' as const, startCol: 12, weight: 'heavy' as const, velCurve: 'linear' as const };

    it('generates snare hits when fill is active and col >= startCol', () => {
      if (snareRow < 0) return;
      const s = new Scheduler(defaultConfig);
      s.setGrid(createEmptyGrid(NUM_ROWS, 16));

      // No fill before startCol
      const before = s.step(11, { loopCount: 0, fill: defaultFill });
      const snaresBefore = before.filter((snd) => snd.sound === snareName);
      expect(snaresBefore).toHaveLength(0);

      // Fill at startCol — heavy fill, first half = quarters, this is even colInFill so 1 hit
      const at = s.step(12, { loopCount: 0, fill: defaultFill });
      const snaresAt = at.filter((snd) => snd.sound === snareName);
      expect(snaresAt).toHaveLength(1);
    });

    it('velocity ramps from ~0.5 to ~1.0 over fill duration (linear)', () => {
      if (snareRow < 0) return;
      const s = new Scheduler(defaultConfig);
      s.setGrid(createEmptyGrid(NUM_ROWS, 16));

      const velocities: number[] = [];
      for (let col = 12; col < 16; col++) {
        const sounds = s.step(col, { loopCount: 0, fill: defaultFill });
        const snares = sounds.filter((snd) => snd.sound === snareName);
        for (const sn of snares) velocities.push(sn.velocity);
      }

      // First hit should be near 0.5, last hit near 1.0
      expect(velocities[0]).toBeGreaterThanOrEqual(0.4); // 0.5 ± 7%
      expect(velocities[0]).toBeLessThanOrEqual(0.6);
      expect(velocities[velocities.length - 1]).toBeGreaterThanOrEqual(0.85);
      expect(velocities[velocities.length - 1]).toBeLessThanOrEqual(1.0);
    });

    it('exponential velocity curve starts quieter than linear', () => {
      if (snareRow < 0) return;

      // Compare midpoint velocity between linear and exp curves
      const getMidVel = (curve: 'linear' | 'exp') => {
        const s = new Scheduler(defaultConfig);
        s.setGrid(createEmptyGrid(NUM_ROWS, 16));
        const fill = { ...defaultFill, startCol: 0, velCurve: curve };
        // Step at midpoint (col 8 of 16)
        for (let col = 0; col < 8; col++) s.step(col, { loopCount: 0, fill });
        const sounds = s.step(8, { loopCount: 0, fill });
        return sounds.filter((snd) => snd.sound === snareName)[0]?.velocity ?? 0;
      };

      // Exp curve at midpoint: 0.5 + 0.5 * (0.5^2) = 0.625
      // Linear at midpoint: 0.5 + 0.5 * 0.5 = 0.75
      // Exp should be quieter at midpoint
      expect(getMidVel('exp')).toBeLessThan(getMidVel('linear'));
    });

    it('skips beatOffset 0 when user has a snare cell at that column', () => {
      if (snareRow < 0) return;
      const s = new Scheduler(defaultConfig);
      s.setGrid(gridWith(NUM_ROWS, 16, [[snareRow, 14, 1]]));

      const sounds = s.step(14, { loopCount: 0, fill: defaultFill });
      const snares = sounds.filter((snd) => snd.sound === snareName);

      // User cell produces its own snare (beatOffset 0), fill skips that column entirely
      const fillSnares = snares.filter((snd) => snd.value === 0); // fill marks value=0
      expect(fillSnares).toHaveLength(0);
    });

    it('does not generate fills when fill context is absent', () => {
      if (snareRow < 0) return;
      const s = new Scheduler(defaultConfig);
      s.setGrid(createEmptyGrid(NUM_ROWS, 16));

      const sounds = s.step(14, { loopCount: 0 }); // no fill
      const snares = sounds.filter((snd) => snd.sound === snareName);
      expect(snares).toHaveLength(0);
    });

    it('humanize produces velocity variation', () => {
      if (snareRow < 0) return;
      const fill = { ...defaultFill, startCol: 0 };
      const velocities: number[] = [];

      const s = new Scheduler(defaultConfig);
      s.setGrid(createEmptyGrid(NUM_ROWS, 16));
      for (let col = 0; col < 16; col++) {
        const sounds = s.step(col, { loopCount: 0, fill });
        for (const snd of sounds.filter((sn) => sn.sound === snareName)) {
          velocities.push(snd.velocity);
        }
      }

      const unique = new Set(velocities.map((v) => v.toFixed(4)));
      expect(unique.size).toBeGreaterThan(1);
    });
  });

  describe('pending events', () => {
    it('defers sounds with beatOffset >= 1.0 to future steps', () => {
      const futureInterpreter: CellInterpreter = ({ row, col, value }) => {
        if (value === 0) return [];
        return [
          { row, col, value, beatOffset: 0, sound: kit[kickRow].name, velocity: 0.8 },
          { row, col, value, beatOffset: 1.0, sound: kit[kickRow].name, velocity: 0.4 },
        ];
      };

      const s = new Scheduler(defaultConfig, futureInterpreter);
      s.setGrid(gridWith(NUM_ROWS, 16, [[kickRow, 0, 1]]));

      const step0 = s.step(0, ctx);
      expect(step0).toHaveLength(1);
      expect(step0[0].velocity).toBe(0.8);
      expect(s.getPendingEvents()).toHaveLength(1);

      const step1 = s.step(1, ctx);
      expect(step1).toHaveLength(1);
      expect(step1[0].velocity).toBe(0.4);
      expect(s.getPendingEvents()).toHaveLength(0);
    });

    it('handles multi-step pending (beatOffset 3.0 takes 3 steps)', () => {
      const futureInterpreter: CellInterpreter = ({ row, col, value }) => {
        if (value === 0) return [];
        return [
          { row, col, value, beatOffset: 3.0, sound: kit[0].name, velocity: 0.5 },
        ];
      };

      const s = new Scheduler(defaultConfig, futureInterpreter);
      s.setGrid(gridWith(NUM_ROWS, 16, [[0, 0, 1]]));

      expect(s.step(0, ctx)).toHaveLength(0); // beatOffset 3.0 → pending
      expect(s.getPendingEvents()).toHaveLength(1);

      expect(s.step(1, ctx)).toHaveLength(0); // 2.0 → still pending
      expect(s.step(2, ctx)).toHaveLength(0); // 1.0 → still pending
      expect(s.step(3, ctx)).toHaveLength(1); // 0.0 → fires
      expect(s.getPendingEvents()).toHaveLength(0);
    });
  });
});
