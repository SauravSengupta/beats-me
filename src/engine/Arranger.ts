import type {
  Arrangement,
  ArrangementContext,
  ArrangementStep,
  ResolvedVoiceProbs,
  VoiceProb,
} from '../lib/types';
import { createPRNG } from '../lib/prng';

const VOICE_KEYS: (keyof ResolvedVoiceProbs)[] = [
  'sparkle', 'rhythm', 'groove', 'pulse', 'pad', 'bass', 'stab', 'stabGroove', 'arp',
];

/**
 * Resolves arrangement steps into concrete playback contexts.
 *
 * Pure function of loopCount — no internal mutation after construction.
 * Same arrangement = same resolved contexts (deterministic via seeded PRNG for risers/fills).
 */
export class Arranger {
  private resolved: ArrangementContext[];
  private arrangement: Arrangement;

  constructor(arrangement: Arrangement, seed: number, numCols: number) {
    this.arrangement = arrangement;
    const rng = createPRNG(seed);

    // Resolve all steps sequentially ('previous' needs prior result)
    this.resolved = [];
    for (let i = 0; i < arrangement.steps.length; i++) {
      const prev = i > 0 ? this.resolved[i - 1] : null;
      this.resolved.push(
        this.resolveStep(arrangement.steps[i], i, rng, numCols, prev),
      );
    }
  }

  /** Get the resolved context for a given loopCount. */
  getContext(loopCount: number): ArrangementContext {
    if (loopCount < this.resolved.length) {
      return this.resolved[loopCount];
    }

    // Past the last step — final beat or complete
    const lastResolved = this.resolved[this.resolved.length - 1];

    if (loopCount === this.resolved.length && this.arrangement.finalBeat) {
      // The final beat loop — inherits last step's voice probs
      return {
        stepIndex: this.resolved.length,
        chord: this.arrangement.finalBeat,
        voiceProbs: { ...lastResolved.voiceProbs },
        energy: lastResolved.energy,
        label: 'final',
        isComplete: false,
        isFinalBeat: true,
      };
    }

    // Fully complete
    return {
      stepIndex: this.resolved.length,
      chord: this.arrangement.finalBeat ?? lastResolved.chord,
      voiceProbs: { sparkle: 0, rhythm: 0, groove: 0, pulse: 0, pad: 0, bass: 0, stab: 0, stabGroove: 0, arp: 0 },
      energy: 0,
      isComplete: true,
      isFinalBeat: false,
    };
  }

  /** Total number of loops (excluding final beat). */
  get totalSteps(): number {
    return this.arrangement.steps.length;
  }

  /** Whether this arrangement has a final beat. */
  get hasFinalBeat(): boolean {
    return !!this.arrangement.finalBeat;
  }

  // ---------------------------------------------------------------------------
  // Resolution logic
  // ---------------------------------------------------------------------------

  private resolveStep(
    step: ArrangementStep,
    index: number,
    rng: () => number,
    numCols: number,
    prev: ArrangementContext | null,
  ): ArrangementContext {
    // Resolve voice probabilities — replace 'previous' with prior values
    const voiceProbs = {} as ResolvedVoiceProbs;
    for (const key of VOICE_KEYS) {
      const val: VoiceProb = step[key];
      if (val === 'previous') {
        voiceProbs[key] = prev ? prev.voiceProbs[key] : (key === 'pad' ? 1 : 0);
      } else {
        voiceProbs[key] = val;
      }
    }

    // Resolve riser — always fires when defined, PRNG varies how it plays
    let riser: ArrangementContext['riser'];
    if (step.riser) {
      const beats = rng() < 0.65 ? 4 : 8;
      const startCol = numCols - beats * 2;
      // Sweep range: full (200→8kHz) or narrow (400→5kHz)
      const narrow = rng() < 0.35;
      const freqLow = narrow ? 400 : 200;
      const freqHigh = narrow ? 5000 : 8000;
      // Q: tight (3) = whistly resonant, wide (1.5) = washy diffuse
      const q = rng() < 0.4 ? 3 : 1.5;
      riser = { type: step.riser, startCol: Math.max(0, startCol), freqLow, freqHigh, q };
    }

    // Resolve fill — always fires when defined, PRNG varies how it plays
    let fill: ArrangementContext['fill'];
    if (step.fill) {
      const weight = step.fillWeight ?? 'heavy';
      const beats = weight === 'light' ? 2 : 4;
      const startCol = numCols - beats * 2;
      const velCurve: 'linear' | 'exp' = rng() < 0.5 ? 'exp' : 'linear';
      fill = { type: step.fill, startCol, weight, velCurve };
    }

    return {
      stepIndex: index,
      chord: step.chord,
      voiceProbs,
      energy: step.energy,
      label: step.label,
      riser,
      fill,
      arpOctaveShift: step.arpOctaveShift,
      voicingShift: step.voicingShift,
      isComplete: false,
      isFinalBeat: false,
    };
  }
}
