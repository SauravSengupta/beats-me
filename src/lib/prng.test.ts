import { describe, it, expect } from 'vitest';
import { createPRNG, weightedPick, hashGrid, deriveVariationParams } from './prng';

describe('createPRNG', () => {
  it('produces deterministic sequence from same seed', () => {
    const a = createPRNG(42);
    const b = createPRNG(42);
    for (let i = 0; i < 10; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces different sequences from different seeds', () => {
    const a = createPRNG(42);
    const b = createPRNG(99);
    const matchCount = Array.from({ length: 10 }, () => a() === b()).filter(Boolean).length;
    expect(matchCount).toBeLessThan(5);
  });

  it('returns values between 0 and 1', () => {
    const r = createPRNG(123);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('weightedPick', () => {
  it('respects weights over many picks', () => {
    const r = createPRNG(42);
    const weights = [0.5, 0.3, 0.15, 0.05];
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 1000; i++) {
      counts[weightedPick(r, weights)]++;
    }
    // First option should be picked most often
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[2]).toBeGreaterThan(counts[3]);
  });
});

describe('hashGrid', () => {
  it('produces same hash for same grid', () => {
    const grid = [[0, 1, 0], [1, 0, 1]];
    expect(hashGrid(grid)).toBe(hashGrid(grid));
  });

  it('produces different hash for different grids', () => {
    const a = [[0, 1, 0], [1, 0, 1]];
    const b = [[0, 1, 0], [1, 1, 1]];
    expect(hashGrid(a)).not.toBe(hashGrid(b));
  });
});

describe('deriveVariationParams', () => {
  it('seed 0 returns neutral defaults', () => {
    const params = deriveVariationParams(0);
    expect(params.arpShapes.every((s) => s === 'ascending')).toBe(true);
    expect(params.stabInversions).toEqual([0, 0, 0, 0]);
    expect(params.accentPattern).toBe('flat');
    expect(params.padLfoOffset).toBe(0);
    expect(params.delayFeedbackOffset).toBe(0);
    expect(params.stabFilterMul).toBe(1);
    expect(params.ghostBassDensity).toBe(1);
    expect(params.delayTimeVariant).toBe('8n.');
    expect(params.drumBrightnessOffset).toBe(0);
    expect(params.voicePalette).toBe(0);
    expect(params.transposeShift).toBe(0);
  });

  it('same seed produces same params', () => {
    const a = deriveVariationParams(5);
    const b = deriveVariationParams(5);
    expect(a.arpShapes).toEqual(b.arpShapes);
    expect(a.stabInversions).toEqual(b.stabInversions);
    expect(a.accentPattern).toBe(b.accentPattern);
    expect(a.padLfoOffset).toBe(b.padLfoOffset);
    expect(a.delayFeedbackOffset).toBe(b.delayFeedbackOffset);
    expect(a.stabFilterMul).toBe(b.stabFilterMul);
    expect(a.ghostBassDensity).toBe(b.ghostBassDensity);
    expect(a.delayTimeVariant).toBe(b.delayTimeVariant);
    expect(a.drumBrightnessOffset).toBe(b.drumBrightnessOffset);
    expect(a.voicePalette).toBe(b.voicePalette);
    expect(a.transposeShift).toBe(b.transposeShift);
  });

  it('different seeds produce different params', () => {
    const results = Array.from({ length: 15 }, (_, i) => deriveVariationParams(i + 1));
    // At least some arp shapes should differ across seeds
    const uniqueFirstArps = new Set(results.map((r) => r.arpShapes[0]));
    expect(uniqueFirstArps.size).toBeGreaterThan(1);
    // Continuous knobs should vary
    const offsets = new Set(results.map((r) => r.padLfoOffset));
    expect(offsets.size).toBeGreaterThan(1);
  });

  it('arpShapes contains 16 entries from valid palette', () => {
    const valid = new Set(['ascending', 'descending', 'pendulum', 'octaveJump']);
    for (let seed = 1; seed <= 15; seed++) {
      const params = deriveVariationParams(seed);
      expect(params.arpShapes).toHaveLength(16);
      for (const shape of params.arpShapes) {
        expect(valid.has(shape)).toBe(true);
      }
    }
  });

  it('stabInversions are 0, 1, or 2', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const params = deriveVariationParams(seed);
      expect(params.stabInversions).toHaveLength(4);
      for (const inv of params.stabInversions) {
        expect(inv).toBeGreaterThanOrEqual(0);
        expect(inv).toBeLessThanOrEqual(2);
      }
    }
  });

  it('continuous knobs are within expected ranges', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const p = deriveVariationParams(seed);
      expect(p.padLfoOffset).toBeGreaterThanOrEqual(-1);
      expect(p.padLfoOffset).toBeLessThanOrEqual(1);
      expect(p.delayFeedbackOffset).toBeGreaterThanOrEqual(-0.1);
      expect(p.delayFeedbackOffset).toBeLessThanOrEqual(0.1);
      expect(p.stabFilterMul).toBeGreaterThanOrEqual(0.8);
      expect(p.stabFilterMul).toBeLessThanOrEqual(1.2);
      expect(p.ghostBassDensity).toBeGreaterThanOrEqual(0.7);
      expect(p.ghostBassDensity).toBeLessThanOrEqual(1.3);
      expect(p.drumBrightnessOffset).toBeGreaterThanOrEqual(-0.15);
      expect(p.drumBrightnessOffset).toBeLessThanOrEqual(0.15);
    }
  });

  it('delayTimeVariant is a valid notation value', () => {
    const valid = new Set(['8n', '8n.', '4n']);
    for (let seed = 1; seed <= 15; seed++) {
      expect(valid.has(deriveVariationParams(seed).delayTimeVariant)).toBe(true);
    }
  });

  it('voicePalette is a valid index and all palettes are reachable', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      const p = deriveVariationParams(seed);
      expect(p.voicePalette).toBeGreaterThanOrEqual(0);
      expect(p.voicePalette).toBeLessThan(3); // 0 = default, 1 = grit, 2 = glass
      seen.add(p.voicePalette);
    }
    expect(seen.size).toBe(3);
  });

  it('transposeShift is within -3 to +4 range and varies across seeds', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) {
      const p = deriveVariationParams(seed);
      expect(p.transposeShift).toBeGreaterThanOrEqual(-3);
      expect(p.transposeShift).toBeLessThanOrEqual(4);
      seen.add(p.transposeShift);
    }
    // Should see at least 3 distinct shifts across 50 seeds
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('accentPattern is a valid value', () => {
    const valid = new Set(['flat', 'oneThree', 'twoFour', 'offbeats']);
    for (let seed = 1; seed <= 15; seed++) {
      expect(valid.has(deriveVariationParams(seed).accentPattern)).toBe(true);
    }
  });
});
