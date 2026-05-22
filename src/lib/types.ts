import { transposeNote, transposePitchClass } from './pitch';

/** 0 = off, 1 = on */
export type CellValue = number;

/** Grid state: rows × columns of cell values */
export interface GridState {
  cells: CellValue[][];
  numRows: number;
  numCols: number;
}

/** Visual color for a row */
export interface RowColor {
  color: string;
  glowColor: string;
}

/** A chord in the progression */
export interface Chord {
  name: string;
  root: string;
  fifth: string;
  padVoicing: string[];   // pad voicing (default — top note is usually the 9th)
  /** Alternate top note for pad (e.g. the 3rd instead of 9th). Omit for no drift. */
  padTopAlt?: string;
  stabVoicing: string[];  // stab voicing (can differ from pad)
  /** Alternate top note for hat stab (e.g. the 3rd an octave up). Omit for no drift. */
  stabTopAlt?: string;
}

// ---------------------------------------------------------------------------
// Preset — the complete musical personality of a mode
// ---------------------------------------------------------------------------

/** Slow volume LFO for mix movement. Omit for static volume. */
export interface MixLfo {
  /** Minimum gain (0-1). */
  min: number;
  /** Maximum gain (0-1). */
  max: number;
  /** LFO cycle length in loops (e.g. 5 = one full cycle every 5 loops). */
  rateInLoops: number;
}

/** Bass behavior config for a single drum row */
export interface RowBassConfig {
  /** What note to play: 'root' follows chord root, 'fifth' plays the 5th */
  noteType: 'root' | 'fifth';
  /** Sound key to emit (maps to a Player voice, e.g. 'bass') */
  soundKey: string;
  /** Probability of bass firing on this row's hits (0-1) */
  probability: number;
  /** Bass velocity for hits triggered by this row */
  velocity: number;
  /**
   * Approach tone weights for "and" hits with adjacent kicks.
   * Only used when noteType is 'root'.
   * [root, 5th, stepBelow, stepAbove, 4th] — must sum to 1.
   */
  approachWeights?: [number, number, number, number, number];
}

/** Configuration for a single drum row in the kit */
export interface KitRow {
  name: string;         // instrument name e.g. 'kick'
  shape: string;        // unicode shape for UI e.g. '▼'
  sample?: string;      // path to sample e.g. '/samples/kick.wav' (omit for synth voices)
  synthType?: string;   // synthesized voice type e.g. 'kick-sweep', 'noise-snare'
  volumeDb: number;     // mix balance offset in dB
  color: RowColor;
  /** Key into ResolvedVoiceProbs for arrangement drum gating. */
  voiceProbKey?: keyof ResolvedVoiceProbs;
  /**
   * Velocity humanization amount (0-1). Applies ±amount random variation
   * to drum hit velocity using seeded PRNG. 0 or omit for no humanization.
   * Example: 0.1 = ±10% variation. Kick rows should use 0 (rock-solid anchor).
   */
  humanize?: number;
  /** Slow volume LFO for mix movement. Omit for static volume (e.g. kick). */
  mixLfo?: MixLfo;
  /** Bass behavior — omit for rows that don't trigger bass */
  bass?: RowBassConfig;
  /** Stab behavior — omit for rows that don't trigger chord stabs */
  stab?: {
    soundKey: string;
    velocity: number;
    /** Probability of stab firing (0-1). Defaults to 1. */
    probability?: number;
    /** Velocity multiplier for offbeat (odd) columns. Defaults to 1 (no change). */
    offbeatVelocity?: number;
    /** Which chord voicing to use: 'stab' (high, default) or 'pad' (low). */
    voicingSource?: 'stab' | 'pad';
  };
  /** Pad filter pulse — omit for rows that don't modulate the pad */
  padPulse?: { soundKey: string };
  /** Arp behavior — omit for rows that don't trigger arpeggios */
  arp?: {
    /** Sound key for the arp voice (maps to a Player voice, e.g. 'arp') */
    soundKey: string;
    /** Number of notes per arp sequence (e.g. 4 for root→5th→top→5th ping-pong) */
    notesPerArp: number;
    /** Starting velocity for the first arp note */
    baseVelocity: number;
    /** Velocity multiplier per subsequent note (e.g. 0.7 = each note 70% of previous) */
    velocityDecay: number;
    /** Probability of arp firing (0-1). Defaults to 1 (always fires). */
    probability?: number;
    /** Velocity humanization amount (0-1). Applied per-note via seeded PRNG. */
    humanize?: number;
    /** Velocity multiplier for offbeat (odd) columns. Defaults to 1 (no change). */
    offbeatVelocity?: number;
  };
}

/** Pad synth configuration */
export interface PadConfig {
  shape: string;        // unicode icon for mixer UI e.g. '≋'
  oscillator: string;   // e.g. 'fatsawtooth'
  spread: number;       // detuning spread in cents
  count: number;        // number of oscillator voices
  volumeDb: number;
  filterLfoRange: [number, number]; // LFO min/max Hz
  volumeLfoRange: [number, number]; // LFO min/max gain
  attack: number;       // envelope attack in seconds
  release: number;      // envelope release in seconds
  /** Stereo pan LFO range [-1, 1]. Omit for no pan movement. */
  panLfoRange?: [number, number];
  /** Pan LFO rate multiplier relative to filter/volume LFO. Defaults to 0.5 (half speed). */
  panLfoRateMul?: number;
  /** Saturation wet mix (0-1). Omit for no saturation. */
  saturationWet?: number;
  /** Chebyshev order (harmonics). Defaults to 3. */
  saturationOrder?: number;
  /**
   * Sidechain pump config. Omit for no pump.
   * The engine emits an implicit quarter-note pump at `baselineDepth`,
   * deepened when kick/snare hits land on the same step.
   */
  sidechain?: {
    /** Duck depth on quarter notes with no kick/snare (0-1). Lower = deeper. */
    baselineDepth: number;
    /** Duck depth when kick lands on a quarter note. */
    kickOnBeatDepth: number;
    /** Duck depth when kick lands off a quarter note. */
    kickOffBeatDepth: number;
    /** Duck depth when snare lands (any position). */
    snareDepth: number;
  };
}

/** Bass synth configuration */
export interface BassConfig {
  shape: string;        // unicode icon for mixer UI e.g. '∿'
  oscillator: string;   // e.g. 'triangle'
  filterCutoffHz: number; // static low-pass filter cutoff (post-saturation)
  volumeDb: number;
  /** Per-note filter envelope start frequency (Hz). Omit for no envelope. */
  filterEnvStart?: number;
  /** Per-note filter envelope end frequency (Hz). */
  filterEnvEnd?: number;
  /** Per-note filter envelope decay time (seconds). */
  filterEnvDecay?: number;
  /** Portamento glide time (seconds). 0 or omit for no glide. */
  glideTime?: number;
  /** Saturation wet mix (0-1). Defaults to 0.3 if omitted. */
  saturationWet?: number;
  /** Chorus delay time in ms (main saw only, not sub). Omit for no chorus. */
  chorusDelayMs?: number;
  /** Chorus LFO rate in Hz. Defaults to 0.5. */
  chorusRate?: number;
  /** Chorus wet mix (0-1). Defaults to 0.2. */
  chorusWet?: number;
  /** Slow volume LFO for mix movement. Omit for static volume. */
  mixLfo?: MixLfo;
}

/** Chord stab configuration (triggered by clap/cymbal rows) */
export interface StabConfig {
  shape: string;        // unicode icon for mixer UI
  oscillator: string;   // e.g. 'square'
  filterCutoffHz: number; // low-pass cutoff
  volumeDb: number;
  attack: number;       // fast attack for percussive feel
  decay: number;        // short decay
  sustain: number;      // near zero for stab
  release: number;
  /** Tempo-synced delay (e.g. '8n.'). Omit for dry stab. */
  delayTime?: string;
  /** Delay feedback (0-1). Ignored if no delayTime. */
  delayFeedback?: number;
  /** Delay wet mix (0-1). Ignored if no delayTime. */
  delayWet?: number;
  /** Slow volume LFO for mix movement. Omit for static volume. */
  mixLfo?: MixLfo;
  /** Saturation wet mix (0-1). Omit for no saturation. */
  saturationWet?: number;
  /** Chebyshev order (harmonics). Defaults to 3. */
  saturationOrder?: number;
}

// ---------------------------------------------------------------------------
// Arrangement — song structure from a single grid
// ---------------------------------------------------------------------------

/**
 * Per-voice probability value for an arrangement step.
 * - number (0-1): probability/level for this voice
 *   - Drums: absolute probability that the drum hit fires (0 = silent, 1 = always)
 *   - Synths: multiplier against the kit-defined base probability (0 = never, 1 = designed rate)
 *   - Pad: level multiplier (0 = silent, 1 = full designed level)
 * - 'previous': reuse the value from the previous step
 *
 * Future: could add { from: 'previous', add: number } to adjust relative
 * to the previous value. Deferred until needed.
 */
export type VoiceProb = number | 'previous';

/**
 * Per-voice probability map for an arrangement step.
 * Controls how likely each voice is to fire on each cell hit.
 */
export interface VoiceProbMap {
  sparkle: VoiceProb;      // row 0 drum hit (absolute probability)
  rhythm: VoiceProb;       // row 1 drum hit (absolute probability)
  groove: VoiceProb;       // row 2 drum hit (absolute probability)
  pulse: VoiceProb;        // row 3 drum hit (absolute probability)
  pad: VoiceProb;          // pad level multiplier
  bass: VoiceProb;         // bass companion probability multiplier
  stab: VoiceProb;         // hat stab companion probability multiplier
  stabGroove: VoiceProb;   // groove stab companion probability multiplier
  arp: VoiceProb;          // arp companion probability multiplier
}

/** One loop in the arrangement timeline */
export interface ArrangementStep extends VoiceProbMap {
  chord: Chord;              // which chord this loop plays
  energy: number;            // 0-1, drives mix intensity (velocity, FX, pad width)
  label?: string;            // 'intro' | 'A' | 'B' | 'final' — UI display only
  riser?: 'up' | 'down';    // pitched noise sweep this loop
  fill?: 'snare' | 'arp';   // drum fill on last beats of this loop
  fillWeight?: 'light' | 'heavy'; // light = 2-beat quarters, heavy = 4-beat quarters→8ths acceleration (default: 'heavy')
  /** Arp octave shift in semitones relative to default (+12). e.g. -12 = one octave lower. */
  arpOctaveShift?: number;
  /** Voicing register shift in semitones for pad/stab. e.g. +12 = one octave up. */
  voicingShift?: number;
}

/** Full arrangement definition — lives in the Preset */
export interface Arrangement {
  steps: ArrangementStep[];  // one entry per loop, played in order
  finalBeat?: Chord;         // optional ending beat, inherits last step's voice probs
}

/** Resolved per-voice probabilities — all 'previous' values resolved to numbers */
export interface ResolvedVoiceProbs {
  sparkle: number;
  rhythm: number;
  groove: number;
  pulse: number;
  pad: number;
  bass: number;
  stab: number;
  stabGroove: number;
  arp: number;
}

/** Resolved state for a single loop — output of the Arranger */
export interface ArrangementContext {
  stepIndex: number;         // which step we're on
  chord: Chord;              // resolved chord for this loop
  voiceProbs: ResolvedVoiceProbs; // resolved per-voice probabilities
  energy: number;            // energy level for mix params
  label?: string;            // section label for UI
  riser?: {
    type: 'up' | 'down';
    startCol: number;
    freqLow: number;    // sweep start/end frequency (Hz) — varies per riser
    freqHigh: number;
    q: number;           // bandpass Q — tight (3) = whistly, wide (1.5) = washy
  };
  fill?: {
    type: 'snare' | 'arp';
    startCol: number;
    weight: 'light' | 'heavy';
    velCurve: 'linear' | 'exp'; // velocity ramp shape
  };
  /** Arp octave shift in semitones (from ArrangementStep). */
  arpOctaveShift?: number;
  /** Voicing register shift in semitones for pad/stab (from ArrangementStep). */
  voicingShift?: number;
  isComplete: boolean;       // true after all steps + final beat
  isFinalBeat: boolean;      // true during the final beat loop
}

/** Complete musical preset — defines everything about a mode's sound */
export interface Preset {
  name: string;
  tempo: number;

  // Harmony
  scale: string[];
  chordProgression: Chord[];

  // Kit (one entry per grid row, top to bottom)
  kit: KitRow[];

  // Synth layers
  pad: PadConfig;
  bass: BassConfig;
  stab: StabConfig;
  /** Groove stab — dry, warm, lower voicing. Omit if only one stab flavor. */
  stabGroove?: StabConfig;
  /** Arp synth — saw + delay, triggered by row arp config. Omit if no arp. */
  arp?: StabConfig;

  /** Arrangement — song structure. Omit for flat infinite looping. */
  arrangement?: Arrangement;
}

// ---------------------------------------------------------------------------
// Engine config (derived from Preset for internal use)
// ---------------------------------------------------------------------------

/** Engine configuration — derived from a Preset */
export interface EngineConfig {
  tempo: number;
  maxCellValue: number;
  rowSounds: string[];
  rowColors: RowColor[];
  chordProgression: Chord[];
  scale: string[];
  kit: KitRow[];
  pad: PadConfig;
  bass: BassConfig;
  stab: StabConfig;
  stabGroove?: StabConfig;
  arp?: StabConfig;
  arrangement?: Arrangement;
  variationSeed?: number;
}

/** Derive an EngineConfig from a Preset */
export function configFromPreset(preset: Preset): EngineConfig {
  return {
    tempo: preset.tempo,
    maxCellValue: 1,
    rowSounds: preset.kit.map((r) => r.name),
    rowColors: preset.kit.map((r) => r.color),
    chordProgression: preset.chordProgression,
    scale: preset.scale,
    kit: preset.kit,
    pad: preset.pad,
    bass: preset.bass,
    stab: preset.stab,
    stabGroove: preset.stabGroove,
    arp: preset.arp,
    arrangement: preset.arrangement,
  };
}

/** Transpose a Chord by N semitones. */
function transposeChord(chord: Chord, semitones: number): Chord {
  const t = (n: string) => transposeNote(n, semitones);
  return {
    ...chord,
    name: chord.name, // keep original name for identity
    root: t(chord.root),
    fifth: t(chord.fifth),
    padVoicing: chord.padVoicing.map(t),
    ...(chord.padTopAlt ? { padTopAlt: t(chord.padTopAlt) } : {}),
    stabVoicing: chord.stabVoicing.map(t),
    ...(chord.stabTopAlt ? { stabTopAlt: t(chord.stabTopAlt) } : {}),
  };
}

/**
 * Transpose an entire EngineConfig by N semitones.
 * Shifts all note fields (chords, scale, arrangement) while preserving structure.
 * 0 semitones = no change.
 */
export function transposeConfig(config: EngineConfig, semitones: number): EngineConfig {
  if (semitones === 0) return config;
  return {
    ...config,
    scale: config.scale.map(pc => transposePitchClass(pc, semitones)),
    chordProgression: config.chordProgression.map(c => transposeChord(c, semitones)),
    arrangement: config.arrangement
      ? {
          ...config.arrangement,
          steps: config.arrangement.steps.map(step => ({
            ...step,
            chord: transposeChord(step.chord, semitones),
          })),
          finalBeat: config.arrangement.finalBeat
            ? transposeChord(config.arrangement.finalBeat, semitones)
            : undefined,
        }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Step event / sound types
// ---------------------------------------------------------------------------

/** What the engine emits on each step (engine → grid visuals) */
export interface StepEvent {
  column: number;
  loopCount: number;
  chordIndex: number;
  triggered: { row: number; value: CellValue }[];
  effects?: CellEffect[];
  /** Per-row drum probability (0 = muted, use for playhead dimming). Undefined = all full. */
  drumProbs?: [number, number, number, number];
  /** Section label for UI display (e.g. 'intro', 'A', 'B') */
  sectionLabel?: string;
  /** Current energy level from arrangement (0-1). Undefined = no arrangement. */
  energy?: number;
  /** Per-voice probabilities from arrangement. Undefined = no arrangement (all full). */
  voiceProbs?: ResolvedVoiceProbs;
}

/** Visual effects the engine can request */
export interface CellEffect {
  row: number;
  col: number;
  type: 'glow' | 'ripple' | 'pulse' | 'flash';
  intensity?: number;
  color?: string;
}

/** What the scheduler produces (scheduler → player) */
export interface ScheduledSound {
  row: number;
  col: number;
  value: CellValue;
  beatOffset: number;
  sound: string;
  velocity: number;
  duration?: number;
  /** Single note (bass, arp). */
  note?: string;
  /** Chord voicing (stab). Mutually exclusive with note for a given sound. */
  notes?: string[];
}

/** Event log entry for history-aware behavior + test replay */
export type GridEvent =
  | { type: 'set'; row: number; col: number; value: CellValue; tick: number }
  | { type: 'step'; column: number; loopCount: number; tick: number };

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Public API for the sound engine */
export interface SoundEngineAPI {
  start(): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  dispose(): void;
  updateGrid(grid: GridState): void;
  updateConfig(config: EngineConfig): void;
  setVariation(seed: number): void;
  onStep(callback: (event: StepEvent) => void): void;
  /** Register callback for when the arrangement completes (song ends). */
  onComplete(callback: () => void): void;
  getEventLog(): GridEvent[];
}

export type CellInterpreter = (
  cell: { row: number; col: number; value: CellValue },
  context: { loopCount: number; tick: number; grid: GridState; chordOverride?: Chord; voiceProbs?: ResolvedVoiceProbs; arpOctaveShift?: number; voicingShift?: number },
) => ScheduledSound[];

export interface SchedulerAPI {
  setGrid(grid: GridState): void;
  setConfig(config: EngineConfig): void;
  step(column: number, context: StepContext): ScheduledSound[];
  getPendingEvents(): ScheduledSound[];
}

/** Context passed to Scheduler.step() and interpreters */
export interface StepContext {
  loopCount: number;
  /** Override chord for this loop (from arrangement). Falls back to progression cycling if absent. */
  chordOverride?: Chord;
  /** Per-voice probabilities from the arrangement. Undefined = no arrangement (all at 100%). */
  voiceProbs?: ResolvedVoiceProbs;
  /** Active fill for this loop (from arrangement). Scheduler generates extra hits when col >= startCol. */
  fill?: { type: 'snare' | 'arp'; startCol: number; weight: 'light' | 'heavy'; velCurve: 'linear' | 'exp' };
  /** Arp octave shift in semitones (from arrangement). */
  arpOctaveShift?: number;
  /** Voicing register shift in semitones for pad/stab (from arrangement). */
  voicingShift?: number;
}

export interface PlayerAPI {
  init(config: EngineConfig): Promise<void>;
  dispose(): void;
  play(sounds: ScheduledSound[], time: number): void;
  stopAll(): void;
  startTransport(tempo: number): void;
  stopTransport(): void;
  pauseTransport(): void;
  resumeTransport(): void;
}

/** Default grid dimensions — 16 sub-columns (pairs of 2 = 8 beats) */
export const DEFAULT_NUM_ROWS = 4;
export const DEFAULT_NUM_COLS = 16;
export const DEFAULT_MAX_CELL_VALUE = 1;
