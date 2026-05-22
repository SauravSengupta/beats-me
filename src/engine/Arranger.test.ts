import { describe, it, expect } from 'vitest';
import { Arranger } from './Arranger';
import type { Arrangement, ArrangementStep, Chord } from '../lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Am: Chord = {
  name: 'Am', root: 'A2', fifth: 'E2',
  padVoicing: ['A2', 'E3', 'B3'], stabVoicing: ['A3', 'E4', 'B4'],
};
const F: Chord = {
  name: 'F', root: 'F2', fifth: 'C3',
  padVoicing: ['F2', 'C3', 'G3'], stabVoicing: ['F3', 'C4', 'G4'],
};
const G: Chord = {
  name: 'G', root: 'G2', fifth: 'D3',
  padVoicing: ['G2', 'D3', 'A3'], stabVoicing: ['G3', 'D4', 'A4'],
};

const FULL = { sparkle: 1, rhythm: 1, groove: 1, pulse: 1, pad: 1, bass: 1, stab: 1, stabGroove: 1, arp: 1 } as const;
const PREV = {
  sparkle: 'previous', rhythm: 'previous', groove: 'previous', pulse: 'previous',
  pad: 'previous', bass: 'previous', stab: 'previous', stabGroove: 'previous', arp: 'previous',
} as const;

function step(chord: Chord, energy: number, voices: Partial<ArrangementStep> = {}): ArrangementStep {
  return { chord, energy, ...FULL, ...voices };
}

function makeArrangement(steps: ArrangementStep[], finalBeat?: Chord): Arrangement {
  return { steps, finalBeat };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Arranger', () => {
  describe('voice probability resolution', () => {
    it('passes through numeric voice probs', () => {
      const arrangement = makeArrangement([
        step(Am, 0.5, { sparkle: 0, rhythm: 0.5, groove: 1, pulse: 1, bass: 0.7, stab: 0.3, arp: 0 }),
      ]);

      const arranger = new Arranger(arrangement, 42, 16);
      const ctx = arranger.getContext(0);

      expect(ctx.voiceProbs.sparkle).toBe(0);
      expect(ctx.voiceProbs.rhythm).toBe(0.5);
      expect(ctx.voiceProbs.groove).toBe(1);
      expect(ctx.voiceProbs.bass).toBe(0.7);
      expect(ctx.voiceProbs.stab).toBe(0.3);
      expect(ctx.voiceProbs.arp).toBe(0);
    });

    it('resolves "previous" to prior step values', () => {
      const arrangement = makeArrangement([
        step(Am, 0.5, { sparkle: 0, bass: 0.4, stab: 0.6 }),
        { chord: F, energy: 0.7, ...PREV },
      ]);

      const arranger = new Arranger(arrangement, 42, 16);
      const ctx1 = arranger.getContext(1);

      expect(ctx1.voiceProbs.sparkle).toBe(0);
      expect(ctx1.voiceProbs.bass).toBe(0.4);
      expect(ctx1.voiceProbs.stab).toBe(0.6);
      // Energy and chord are their own
      expect(ctx1.energy).toBe(0.7);
      expect(ctx1.chord.name).toBe('F');
    });

    it('chains through multiple previous steps', () => {
      const arrangement = makeArrangement([
        step(Am, 0.3, { sparkle: 0, arp: 0.2 }),
        { chord: F, energy: 0.5, ...PREV },
        { chord: G, energy: 0.7, ...PREV },
      ]);

      const arranger = new Arranger(arrangement, 42, 16);

      expect(arranger.getContext(0).voiceProbs.sparkle).toBe(0);
      expect(arranger.getContext(1).voiceProbs.sparkle).toBe(0);
      expect(arranger.getContext(2).voiceProbs.sparkle).toBe(0);
      expect(arranger.getContext(2).voiceProbs.arp).toBe(0.2);
    });

    it('previous on first step defaults to pad=1, rest=0', () => {
      const arrangement = makeArrangement([
        { chord: Am, energy: 0.3, ...PREV },
      ]);

      const arranger = new Arranger(arrangement, 42, 16);
      const ctx = arranger.getContext(0);

      expect(ctx.voiceProbs.pad).toBe(1);
      expect(ctx.voiceProbs.sparkle).toBe(0);
      expect(ctx.voiceProbs.bass).toBe(0);
    });

    it('can mix previous and explicit values', () => {
      const arrangement = makeArrangement([
        step(Am, 0.5, { bass: 0.3, stab: 0.8 }),
        step(F, 0.7, { bass: 'previous', stab: 1.0 }),  // bass inherits, stab overrides
      ]);

      const arranger = new Arranger(arrangement, 42, 16);
      const ctx1 = arranger.getContext(1);

      expect(ctx1.voiceProbs.bass).toBe(0.3);  // inherited
      expect(ctx1.voiceProbs.stab).toBe(1.0);  // overridden
    });
  });

  describe('chord resolution', () => {
    it('returns the chord from each step', () => {
      const arrangement = makeArrangement([
        step(Am, 0.3), step(F, 0.5), step(G, 0.9),
      ]);

      const arranger = new Arranger(arrangement, 42, 16);

      expect(arranger.getContext(0).chord.name).toBe('Am');
      expect(arranger.getContext(1).chord.name).toBe('F');
      expect(arranger.getContext(2).chord.name).toBe('G');
    });
  });

  describe('energy passthrough', () => {
    it('passes energy from step to context', () => {
      const arrangement = makeArrangement([
        step(Am, 0.3), step(F, 0.8),
      ]);

      const arranger = new Arranger(arrangement, 42, 16);

      expect(arranger.getContext(0).energy).toBe(0.3);
      expect(arranger.getContext(1).energy).toBe(0.8);
    });
  });

  describe('label passthrough', () => {
    it('passes label from step to context', () => {
      const arrangement = makeArrangement([
        step(Am, 0.3, { label: 'intro' }),
        step(Am, 0.5, { label: 'A' }),
      ]);

      const arranger = new Arranger(arrangement, 42, 16);

      expect(arranger.getContext(0).label).toBe('intro');
      expect(arranger.getContext(1).label).toBe('A');
    });
  });

  describe('riser and fill resolution', () => {
    it('riser always fires when defined', () => {
      const arrangement = makeArrangement([
        step(Am, 0.5, { riser: 'up' }),
      ]);

      const arranger = new Arranger(arrangement, 42, 16);
      const ctx = arranger.getContext(0);

      expect(ctx.riser).toBeDefined();
      expect(ctx.riser!.type).toBe('up');
      expect(ctx.riser!.startCol).toBeGreaterThanOrEqual(0);
      expect(ctx.riser!.startCol).toBeLessThan(16);
    });

    it('riser has variation params (freqLow, freqHigh, q)', () => {
      const arrangement = makeArrangement([
        step(Am, 0.5, { riser: 'up' }),
      ]);

      const arranger = new Arranger(arrangement, 42, 16);
      const ctx = arranger.getContext(0);

      expect(ctx.riser!.freqLow).toBeGreaterThanOrEqual(200);
      expect(ctx.riser!.freqHigh).toBeLessThanOrEqual(8000);
      expect(ctx.riser!.q).toBeGreaterThanOrEqual(1);
    });

    it('fill always fires when defined', () => {
      const arrangement = makeArrangement([
        step(Am, 0.5, { fill: 'snare' }),
      ]);

      const arranger = new Arranger(arrangement, 42, 16);
      const ctx = arranger.getContext(0);

      expect(ctx.fill).toBeDefined();
      expect(ctx.fill!.type).toBe('snare');
      expect(ctx.fill!.startCol).toBeGreaterThanOrEqual(8); // 2 beats (col 12) or 4 beats (col 8)
    });

    it('fill has velCurve variation', () => {
      const arrangement = makeArrangement([
        step(Am, 0.5, { fill: 'snare' }),
      ]);

      const arranger = new Arranger(arrangement, 42, 16);
      const ctx = arranger.getContext(0);

      expect(['linear', 'exp']).toContain(ctx.fill!.velCurve);
    });

    it('no riser/fill when fields are absent', () => {
      const arrangement = makeArrangement([step(Am, 0.5)]);

      const arranger = new Arranger(arrangement, 42, 16);
      const ctx = arranger.getContext(0);

      expect(ctx.riser).toBeUndefined();
      expect(ctx.fill).toBeUndefined();
    });
  });

  describe('completion', () => {
    it('isComplete after all steps (no final beat)', () => {
      const arrangement = makeArrangement([step(Am, 0.5)]);

      const arranger = new Arranger(arrangement, 42, 16);

      expect(arranger.getContext(0).isComplete).toBe(false);
      expect(arranger.getContext(1).isComplete).toBe(true);
    });

    it('final beat loop before completion', () => {
      const arrangement = makeArrangement([step(Am, 0.5)], Am);

      const arranger = new Arranger(arrangement, 42, 16);

      expect(arranger.getContext(0).isFinalBeat).toBe(false);

      const final = arranger.getContext(1);
      expect(final.isFinalBeat).toBe(true);
      expect(final.isComplete).toBe(false);
      expect(final.chord.name).toBe('Am');
      expect(final.label).toBe('final');

      expect(arranger.getContext(2).isComplete).toBe(true);
    });

    it('final beat inherits last step voice probs', () => {
      const arrangement = makeArrangement(
        [step(Am, 0.4, { sparkle: 0, bass: 0.5 })],
        Am,
      );

      const arranger = new Arranger(arrangement, 42, 16);
      const final = arranger.getContext(1);

      expect(final.isFinalBeat).toBe(true);
      expect(final.voiceProbs.sparkle).toBe(0);
      expect(final.voiceProbs.bass).toBe(0.5);
      expect(final.voiceProbs.pulse).toBe(1);  // inherited from FULL
    });

    it('final beat inherits through previous chain', () => {
      const arrangement = makeArrangement(
        [
          step(Am, 0.4, { pulse: 1, sparkle: 0, bass: 0.5 }),
          { chord: G, energy: 0.4, ...PREV },
        ],
        Am,
      );

      const arranger = new Arranger(arrangement, 42, 16);
      const final = arranger.getContext(2);

      expect(final.isFinalBeat).toBe(true);
      expect(final.voiceProbs.sparkle).toBe(0);
      expect(final.voiceProbs.bass).toBe(0.5);
    });
  });

  describe('PRNG determinism', () => {
    it('same seed = same riser variation', () => {
      const arrangement = makeArrangement([
        step(Am, 0.5, { riser: 'up' }),
        step(F, 0.7, { riser: 'up' }),
      ]);

      const a = new Arranger(arrangement, 123, 16);
      const b = new Arranger(arrangement, 123, 16);

      expect(a.getContext(0).riser?.startCol).toBe(b.getContext(0).riser?.startCol);
      expect(a.getContext(0).riser?.freqHigh).toBe(b.getContext(0).riser?.freqHigh);
      expect(a.getContext(0).riser?.q).toBe(b.getContext(0).riser?.q);
      expect(a.getContext(1).riser?.startCol).toBe(b.getContext(1).riser?.startCol);
    });

    it('same seed = same fill variation', () => {
      const arrangement = makeArrangement([
        step(Am, 0.5, { fill: 'snare' }),
        step(F, 0.7, { fill: 'snare' }),
      ]);

      const a = new Arranger(arrangement, 456, 16);
      const b = new Arranger(arrangement, 456, 16);

      expect(a.getContext(0).fill?.startCol).toBe(b.getContext(0).fill?.startCol);
      expect(a.getContext(0).fill?.velCurve).toBe(b.getContext(0).fill?.velCurve);
    });
  });
});
