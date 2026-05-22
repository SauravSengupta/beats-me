import type {
  CellInterpreter,
  Chord,
  EngineConfig,
  GridState,
  ScheduledSound,
  SchedulerAPI,
  StepContext,
} from '../lib/types';
import { createEmptyGrid } from '../lib/grid';
import { DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS } from '../lib/types';
import { createLiteralInterpreter } from './interpreters';
import { createPRNG, weightedPick, deriveVariationParams } from '../lib/prng';
import { GHOST_BASS_SEED, FILL_HUMANIZE_SEED } from './constants';
import { noteToMidi, midiToNote, getApproachTones } from '../lib/pitch';

export class Scheduler implements SchedulerAPI {
  private grid: GridState;
  private config: EngineConfig;
  private interpret: CellInterpreter;
  private pending: ScheduledSound[] = [];
  private tick = 0;
  private ghostRng = createPRNG(GHOST_BASS_SEED);
  private fillRng = createPRNG(FILL_HUMANIZE_SEED);
  private ghostBassDensity = 1;

  constructor(config: EngineConfig, interpret?: CellInterpreter) {
    this.config = config;
    this.interpret = interpret ?? createLiteralInterpreter(config);
    this.grid = createEmptyGrid(DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS);
    this.ghostBassDensity = deriveVariationParams(config.variationSeed ?? 0).ghostBassDensity;
  }

  setGrid(grid: GridState): void {
    this.grid = grid;
  }

  setConfig(config: EngineConfig): void {
    this.config = config;
    this.interpret = createLiteralInterpreter(config);
    this.ghostBassDensity = deriveVariationParams(config.variationSeed ?? 0).ghostBassDensity;
  }

  step(column: number, context: StepContext): ScheduledSound[] {
    this.tick++;

    const stepContext = { loopCount: context.loopCount, tick: this.tick, grid: this.grid, chordOverride: context.chordOverride, voiceProbs: context.voiceProbs, arpOctaveShift: context.arpOctaveShift, voicingShift: context.voicingShift };
    const immediate: ScheduledSound[] = [];

    // 1. Age pending events by 1 beat, then collect any that have matured
    const stillPending: ScheduledSound[] = [];
    for (const sound of this.pending) {
      const aged = { ...sound, beatOffset: sound.beatOffset - 1.0 };
      if (aged.beatOffset < 1.0) {
        immediate.push(aged);
      } else {
        stillPending.push(aged);
      }
    }
    this.pending = stillPending;

    // 2. Interpret active cells in this column
    for (let row = 0; row < this.grid.numRows; row++) {
      const value = this.grid.cells[row]?.[column] ?? 0;
      if (value === 0) continue;

      const sounds = this.interpret({ row, col: column, value }, stepContext);
      for (const sound of sounds) {
        if (sound.beatOffset < 1.0) {
          immediate.push(sound);
        } else {
          this.pending.push(sound);
        }
      }
    }

    // 3. Snare fill — additive snare hits in the fill region
    if (context.fill?.type === 'snare' && column >= context.fill.startCol) {
      this.addSnareFill(column, context.fill.startCol, context.fill.weight, context.fill.velCurve, immediate);
    }

    // 4. Ghost bass approach tones on empty "and" beats before downbeat kicks
    // Scale ghost bass probability by arrangement's bass multiplier
    const bassProb = context.voiceProbs?.bass;
    if (bassProb === undefined || bassProb > 0) {
      this.addGhostBass(column, context.loopCount, immediate, context.chordOverride, bassProb);
    }

    return immediate;
  }

  /**
   * Ghost bass: on "and" columns (odd), if the kick row is empty here but
   * has a hit on the next downbeat, emit a quiet approach tone leading into it.
   * Probability ~55% for ghost (no user cell), always for user-placed "and" kicks
   * (those are already handled by the interpreter's getRootBassNote).
   */
  private addGhostBass(
    column: number,
    loopCount: number,
    sounds: ScheduledSound[],
    chordOverride?: Chord,
    bassMultiplier?: number,
  ): void {
    const isAnd = column % 2 === 1;
    if (!isAnd) return;

    const kit = this.config.kit;
    const progression = this.config.chordProgression;
    const scale = this.config.scale;
    if (!progression || progression.length === 0) return;

    // Find the kick row (noteType 'root')
    const kickRowIdx = kit.findIndex((r) => r.bass?.noteType === 'root');
    if (kickRowIdx < 0) return;
    const kickBass = kit[kickRowIdx].bass!;

    // Only ghost if this "and" is empty on the kick row
    const hasKickHere = this.grid.cells[kickRowIdx]?.[column] > 0;
    if (hasKickHere) return; // user placed a cell — interpreter handles it

    // Check next downbeat for a kick
    const nextCol = (column + 1) % this.grid.numCols;
    const hasKickNext = this.grid.cells[kickRowIdx]?.[nextCol] > 0;
    if (!hasKickNext) return;

    // Probability gate — 55% base chance of ghost, scaled by arrangement multiplier + variation density
    const ghostProb = 0.55 * (bassMultiplier ?? 1) * this.ghostBassDensity;
    if (this.ghostRng() > ghostProb) return;

    // Pick approach tone leading to the next downbeat's chord root
    // When arrangement is active, chordOverride provides the current chord.
    // Ghost bass at loop boundary still targets the current chord root
    // (the next loop's chord isn't known here — the arranger resolves it).
    const currentChord: Chord = chordOverride ?? progression[loopCount % progression.length];
    const nextLoop = (column + 1) >= this.grid.numCols ? loopCount + 1 : loopCount;
    const targetChord: Chord = chordOverride && nextLoop === loopCount
      ? chordOverride
      : progression[nextLoop % progression.length];

    const refMidi = noteToMidi(currentChord.root);
    const tones = getApproachTones(targetChord.root, refMidi, scale);
    const targetMidi = noteToMidi(targetChord.root);
    const options = [targetMidi, tones.fifth, tones.stepBelow, tones.stepAbove, tones.fourth];
    const weights = kickBass.approachWeights ?? [1, 0, 0, 0, 0];
    const picked = weightedPick(this.ghostRng, weights);
    const note = midiToNote(options[picked]);

    sounds.push({
      row: kickRowIdx,
      col: column,
      value: 0,
      beatOffset: 0,
      sound: kickBass.soundKey,
      velocity: kickBass.velocity * 0.7, // ghost = 70% of normal bass velocity
      note,
    });
  }

  /**
   * Snare fill: additive snare hits in the fill region.
   * Velocity ramps from 0.4 → 1.0 with ±7% humanize jitter.
   * Density and velocity curve are resolved per-fill by the Arranger.
   * Doesn't suppress user-placed cells — the fill is purely additive.
   */
  /**
   * Snare fill: additive snare hits in the fill region.
   *
   * Light (2 beats): quarter notes only (every other column), vel 0.4→0.6.
   * Heavy (4 beats): quarter notes first half, 8th notes second half, vel 0.5→1.0.
   *
   * ±7% humanize jitter on all hits. Doesn't suppress user-placed cells.
   */
  private addSnareFill(
    column: number,
    fillStartCol: number,
    weight: 'light' | 'heavy',
    velCurve: 'linear' | 'exp',
    sounds: ScheduledSound[],
  ): void {
    const kit = this.config.kit;
    const snareRowIdx = kit.findIndex((r) => r.synthType === 'noise-snare');
    if (snareRowIdx < 0) return;

    const numCols = this.grid.numCols;
    const totalFillCols = numCols - fillStartCol;
    if (totalFillCols <= 0) return;

    const colInFill = column - fillStartCol;
    const progress = colInFill / totalFillCols; // 0 = start, 1 = end

    if (weight === 'light') {
      // Quarter notes only — hit on every other column (0, 2, 4, ...)
      if (colInFill % 2 !== 0) return;

      const baseVel = velCurve === 'exp'
        ? 0.4 + 0.2 * (progress * progress)
        : 0.4 + 0.2 * progress;

      this.emitFillHit(snareRowIdx, column, 0, baseVel, sounds);
    } else {
      // Heavy: quarters first half, 8ths second half
      const midpoint = Math.floor(totalFillCols / 2);
      const inSecondHalf = colInFill >= midpoint;

      // First half: quarter notes (every other column)
      if (!inSecondHalf && colInFill % 2 !== 0) return;

      const baseVel = velCurve === 'exp'
        ? 0.5 + 0.5 * (progress * progress)
        : 0.5 + 0.5 * progress;

      // Second half gets every column (8th notes) — the acceleration
      this.emitFillHit(snareRowIdx, column, 0, baseVel, sounds);
    }
  }

  /** Emit a single fill hit with humanize jitter. Skips if user has a cell there. */
  private emitFillHit(
    snareRowIdx: number,
    column: number,
    beatOffset: number,
    baseVel: number,
    sounds: ScheduledSound[],
  ): void {
    if (beatOffset === 0 && this.grid.cells[snareRowIdx]?.[column] > 0) return;

    const humanize = this.config.kit[snareRowIdx].humanize ?? 0.07;
    const velJitter = (this.fillRng() * 2 - 1) * humanize;
    const velocity = Math.max(0.1, Math.min(1, baseVel + velJitter));

    sounds.push({
      row: snareRowIdx,
      col: column,
      value: 0,
      beatOffset,
      sound: this.config.kit[snareRowIdx].name,
      velocity,
    });
  }

  getPendingEvents(): ScheduledSound[] {
    return [...this.pending];
  }

  getTick(): number {
    return this.tick;
  }
}
