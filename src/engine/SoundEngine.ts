import * as Tone from 'tone';
import type {
  ArrangementContext,
  CellInterpreter,
  Chord,
  EngineConfig,
  GridState,
  ScheduledSound,
  SoundEngineAPI,
  StepEvent,
} from '../lib/types';
import { Scheduler } from './Scheduler';
import { Player } from './Player';
import { Arranger } from './Arranger';
import { getLoopLength, createEmptyGrid } from '../lib/grid';
import { DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS } from '../lib/types';
import { createPRNG, hashGrid, deriveVariationParams, type VariationParams } from '../lib/prng';
import { noteToMidi, midiToNote } from '../lib/pitch';
import type { Mode } from './modes';
import { PAD_DRIFT_SEED, STAB, STAB_GROOVE, ARP, BEATS_PER_LOOP } from './constants';

/** Linear interpolation: lerp(a, b, 0) = a, lerp(a, b, 1) = b. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/** Toggle sound engine debug logging. Set via SoundEngine.debug or browser console. */
let ENGINE_DEBUG = false;

// Expose on window for easy toggling from browser console:
// window.ENGINE_DEBUG = true
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'ENGINE_DEBUG', {
    get: () => ENGINE_DEBUG,
    set: (v: boolean) => { ENGINE_DEBUG = v; },
  });
}

/** How often the visual ticker checks for step changes (30fps) */
const VISUAL_FRAME_INTERVAL = 1000 / 30;

export class SoundEngine implements SoundEngineAPI {
  private scheduler: Scheduler;
  private player: Player;
  private config: EngineConfig;
  private grid: GridState;
  private stepCallbacks: ((event: StepEvent) => void)[] = [];
  private soundsCallbacks: ((sounds: { sound: string; velocity: number }[], energy: number | undefined, padProb: number | undefined) => void)[] = [];
  private loopEvent: number | null = null;
  private column = 0;
  private loopCount = 0;
  private playing = false;

  // Visual ticker state (decoupled from audio callback)
  private visualRafId: number | null = null;
  private lastVisualStep = -2;
  private lastVisualFrameTime = 0;
  // Per-step triggered data, written by audio callback, read by visual ticker.
  // Keyed by column to avoid race conditions (audio callback runs ahead).
  private stepTriggered = new Map<number, { row: number; value: number }[]>();
  // Track which chord the pad is currently playing to avoid redundant changes
  private lastPadChordName = '';
  // Pad top-note drift: tracks whether the current top note is the default (9th) or alt (3rd)
  private padUsingAlt = false;
  private padCurrentTopNote = '';  // the actual note currently sounding on top
  private padDriftRng = createPRNG(PAD_DRIFT_SEED);  // re-seeded in start() with variation

  // Arrangement system
  private arranger: Arranger | null = null;
  private currentArrangementCtx: ArrangementContext | null = null;
  private userMuted = new Set<string>();  // voice names the user explicitly muted
  private completeCallbacks: (() => void)[] = [];
  private riserStartedThisLoop = false;  // prevents re-triggering riser each step
  private variationParams: VariationParams;

  constructor(config: EngineConfig, interpret?: CellInterpreter) {
    this.config = config;
    this.grid = createEmptyGrid(DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS);
    this.scheduler = new Scheduler(config, interpret);
    this.player = new Player();
    this.variationParams = deriveVariationParams(config.variationSeed ?? 0);
  }

  /** Swap mode: replaces config + interpreter, takes effect next loop */
  setMode(mode: Mode): void {
    this.config = mode.config;
    const interpret = mode.createInterpreter(mode.config);
    this.scheduler = new Scheduler(mode.config, interpret);
    this.scheduler.setGrid(this.grid);
    Tone.getTransport().bpm.value = mode.config.tempo;
  }

  async start(mutedTracks?: Set<string>): Promise<void> {
    if (this.playing) return;

    // Resume AudioContext (browser autoplay policy)
    await Tone.start();
    await this.player.init(this.config);

    // Apply mute state after init (gain nodes now exist)
    if (mutedTracks) {
      for (const name of mutedTracks) {
        this.player.mute(name);
      }
    }

    this.column = 0;
    this.loopCount = 0;
    this.playing = true;

    // Create Arranger if arrangement is defined
    if (this.config.arrangement) {
      const variation = this.config.variationSeed ?? 0;
      const seed = (hashGrid(this.grid.cells) ^ Math.imul(variation, 0x9e3779b9)) >>> 0;
      this.arranger = new Arranger(
        this.config.arrangement,
        seed,
        this.grid.numCols,
      );
      this.currentArrangementCtx = this.arranger.getContext(0);
    } else {
      this.arranger = null;
      this.currentArrangementCtx = null;
    }

    // Re-seed pad drift with variation so different seeds produce different top-note choices
    const padDriftSeed = PAD_DRIFT_SEED ^ Math.imul(this.config.variationSeed ?? 0, 0x9e3779b9);
    this.padDriftRng = createPRNG(padDriftSeed);
    this.padUsingAlt = false;
    this.padCurrentTopNote = '';

    this.scheduleLoop();
    this.startVisualTicker();
    this.player.startPad();
    this.triggerPadChord();

    // Apply initial energy level (with variation offsets)
    // Loop mode: fixed energy 1.0 so variation params (pad LFO, delay feedback) still apply
    const initialEnergy = this.currentArrangementCtx?.energy ?? 1.0;
    this.player.applyEnergy(initialEnergy, this.variationParams);

    // Apply seed-driven variation (once, after Player.init)
    this.player.applyStabFilterMul(this.variationParams.stabFilterMul);
    this.player.applyDelayTimeVariant(this.variationParams.delayTimeVariant);

    await this.player.startTransport(this.config.tempo);
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.clearLoop();
    this.stopVisualTicker();
    this.player.stopTransport();
    this.player.stopAll();
    this.resetPlaybackState();
    this.riserStartedThisLoop = false;

    // Notify grid to clear playhead
    this.emitStep(-1);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.player.pauseTransport();
  }

  resume(): void {
    if (this.playing) return;
    this.playing = true;
    this.player.resumeTransport();
  }

  dispose(): void {
    this.stop();
    this.clearLoop();
    this.stopVisualTicker();
    this.player.dispose();
    this.stepCallbacks = [];
    this.completeCallbacks = [];
  }

  /** Ensure audio context and player are initialized (for preview before play) */
  async ensureReady(): Promise<void> {
    await Tone.start();
    await this.player.init(this.config);
  }

  /** Play sounds immediately for cell click preview */
  triggerPreview(sounds: ScheduledSound[]): void {
    // Fire and forget — ensureReady must be called first
    this.player.triggerPreview(sounds);
  }

  mute(name: string): void {
    this.userMuted.add(name);
    this.player.mute(name);
  }

  unmute(name: string): void {
    this.userMuted.delete(name);
    this.player.unmute(name);
  }

  /** Set volume for a voice (0-1 linear). Works for drums, bass, and pad. */
  setVolume(name: string, value: number): void {
    this.player.setVolume(name, value);
  }

  updateGrid(grid: GridState): void {
    this.grid = grid;
    this.scheduler.setGrid(grid);
  }

  updateConfig(config: EngineConfig): void {
    this.config = config;
    this.scheduler.setConfig(config);
    Tone.getTransport().bpm.value = config.tempo;
    this.player.setTempo(config.tempo);
  }

  /** Update variation seed — takes effect next loop when Arranger/interpreter re-seed. */
  setVariation(seed: number): void {
    this.config = { ...this.config, variationSeed: seed };
    this.variationParams = deriveVariationParams(seed);
    this.scheduler.setConfig(this.config);
  }

  onStep(callback: (event: StepEvent) => void): void {
    this.stepCallbacks.push(callback);
  }

  /** Register callback for actual sounds played per step (fires from audio callback, no visual ticker delay) */
  onSounds(callback: (sounds: { sound: string; velocity: number }[], energy: number | undefined, padProb: number | undefined) => void): void {
    this.soundsCallbacks.push(callback);
  }

  onComplete(callback: () => void): void {
    this.completeCallbacks.push(callback);
  }

  getEventLog() {
    return []; // Event log deferred — returns empty for now
  }

  // ---------------------------------------------------------------------------
  // Audio scheduling (runs on Transport clock, must stay lean)
  // ---------------------------------------------------------------------------

  private scheduleLoop(): void {
    this.clearLoop();
    const transport = Tone.getTransport();
    this.loopEvent = transport.scheduleRepeat((time) => {
      this.tick(time);
    }, '8n');
  }

  private clearLoop(): void {
    if (this.loopEvent !== null) {
      Tone.getTransport().clear(this.loopEvent);
      this.loopEvent = null;
    }
  }

  private tick(time: number): void {
    const loopLen = getLoopLength(this.grid);

    if (this.column >= loopLen) {
      this.column = 0;
      this.loopCount++;
      this.riserStartedThisLoop = false;

      // Update arrangement context for the new loop
      if (this.arranger) {
        this.currentArrangementCtx = this.arranger.getContext(this.loopCount);

        if (this.currentArrangementCtx.isFinalBeat) {
          // Final beat: play one beat of sounds, then schedule stop
          this.playFinalBeat(time);
          return;
        }

        if (this.currentArrangementCtx.isComplete) {
          // Past the end — stop immediately
          this.finishArrangement();
          return;
        }
      }

      // New loop = potential chord change → update pad with precise time
      this.triggerPadChord(time);

      // Apply energy level to mix params (velocity scale, FX, filter range)
      if (this.currentArrangementCtx) {
        this.player.applyEnergy(this.currentArrangementCtx.energy, this.variationParams);
      }
    }

    const voiceProbs = this.currentArrangementCtx?.voiceProbs;

    // Riser: trigger once at startCol, sweep continuously to end of loop
    const riserCtx = this.currentArrangementCtx?.riser;
    if (riserCtx && this.column === riserCtx.startCol && !this.riserStartedThisLoop) {
      this.riserStartedThisLoop = true;
      const colsRemaining = loopLen - riserCtx.startCol;
      const beatDuration = 60 / this.config.tempo;
      // Each column = 1 eighth note = 0.5 beats
      const durationSec = colsRemaining * 0.5 * beatDuration;
      // Volume scales with energy — quiet riser in quiet sections, loud in loud
      const energy = this.currentArrangementCtx?.energy ?? 0.5;
      const riserVolume = lerp(0.15, 0.55, energy);
      this.player.startRiser(riserCtx.type, durationSec, riserVolume, {
        freqLow: riserCtx.freqLow,
        freqHigh: riserCtx.freqHigh,
        q: riserCtx.q,
      }, time);
    }

    // Fill: pass context to Scheduler so it can generate extra hits
    let sounds = this.scheduler.step(this.column, {
      loopCount: this.loopCount,
      chordOverride: this.currentArrangementCtx?.chord,
      voiceProbs,
      fill: this.currentArrangementCtx?.fill,
      arpOctaveShift: this.currentArrangementCtx?.arpOctaveShift,
      voicingShift: this.currentArrangementCtx?.voicingShift,
    });

    // Implicit pad sidechain pump — hybrid: baseline quarter-note + kick/snare reinforcement
    const sc = this.config.pad.sidechain;
    if (sc) {
      const isQuarter = this.column % 4 === 0;
      const drumNames = new Set(sounds.map((s) => s.sound));
      const kit = this.config.kit;
      const hasKick = kit.some((r) => r.bass?.noteType === 'root' && drumNames.has(r.name));
      const hasSnare = kit.some((r) => r.bass?.noteType === 'fifth' && drumNames.has(r.name));

      // Pick the deepest (lowest) applicable depth
      let depth = Infinity;
      if (isQuarter) depth = Math.min(depth, sc.baselineDepth);
      if (hasKick) depth = Math.min(depth, isQuarter ? sc.kickOnBeatDepth : sc.kickOffBeatDepth);
      if (hasSnare) depth = Math.min(depth, sc.snareDepth);

      if (depth < Infinity) {
        sounds.push({
          row: -1, col: this.column, value: 0,
          beatOffset: 0,
          sound: 'pad-pulse',
          velocity: depth,
        });
      }
    }

    // Pad top-note drift: check at loop midpoint (column 8 of 16)
    if (this.column === BEATS_PER_LOOP) {
      this.maybeDriftPadTop(time);
    }

    // Apply pad drift to stab/arp voicings — all harmonic voices follow the pad's state
    if (this.padUsingAlt) {
      const chord = this.getCurrentChord()?.chord;
      if (chord?.padTopAlt) {
        const stabDefaultTop = chord.stabVoicing[chord.stabVoicing.length - 1];
        const stabAltTop = chord.stabTopAlt ?? stabDefaultTop;

        for (const s of sounds) {
          if ((s.sound === STAB || s.sound === STAB_GROOVE) && s.notes) {
            const defaultTop = s.sound === STAB_GROOVE
              ? chord.padVoicing[chord.padVoicing.length - 1]
              : stabDefaultTop;
            const idx = s.notes.indexOf(defaultTop);
            if (idx >= 0) {
              // Groove stab uses padTopAlt (same voicing as pad)
              // Hat stab uses stabTopAlt (same shift, octave higher)
              s.notes[idx] = s.sound === STAB_GROOVE
                ? chord.padTopAlt
                : stabAltTop;
            }
          }

          // Arp notes are individual pitches one octave above stab voicing.
          // The "top" note in the arp is stabDefaultTop+12; swap to stabAltTop+12.
          if (s.sound === ARP && s.note) {
            const arpDefaultTop = midiToNote(noteToMidi(stabDefaultTop) + 12);
            if (s.note === arpDefaultTop) {
              s.note = midiToNote(noteToMidi(stabAltTop) + 12);
            }
          }
        }
      }
    }

    // Schedule audio with precise Transport time — no DOM, no React here
    this.player.play(sounds, time);

    // Store per-step triggered data for the visual ticker (keyed by column to avoid race)
    const immediate = sounds.filter((s) => s.beatOffset < 0.01 && s.sound !== 'pad-pulse');
    this.stepTriggered.set(this.column, immediate.map((s) => ({ row: s.row, value: s.value })));

    // Fire sounds callbacks directly from audio callback (no visual ticker delay)
    if (this.soundsCallbacks.length > 0) {
      const played = immediate.map((s) => ({ sound: s.sound, velocity: s.velocity }));
      const energy = this.currentArrangementCtx?.energy;
      const padProb = this.currentArrangementCtx?.voiceProbs?.pad;
      for (const cb of this.soundsCallbacks) {
        cb(played, energy, padProb);
      }
    }

    this.column++;
  }

  // ---------------------------------------------------------------------------
  // Visual ticker (decoupled rAF loop, reads Transport.ticks, 30fps cap)
  // ---------------------------------------------------------------------------

  private startVisualTicker(): void {
    this.stopVisualTicker();
    this.lastVisualStep = -2;
    this.lastVisualFrameTime = 0;

    const tick = (now: number) => {
      if (now - this.lastVisualFrameTime >= VISUAL_FRAME_INTERVAL) {
        this.lastVisualFrameTime = now;
        const currentStep = this.getCurrentStepFromTransport();

        if (currentStep !== this.lastVisualStep) {
          this.lastVisualStep = currentStep;
          const triggered = this.stepTriggered.get(currentStep) ?? [];
          this.stepTriggered.delete(currentStep);
          this.emitStep(currentStep, this.loopCount, triggered);

          // Debug: log cycle position every other beat
          // Toggle via browser console: ENGINE_DEBUG = true
          if (ENGINE_DEBUG && currentStep % 4 === 0) {
            const beatInCycle = (this.loopCount % 2) * BEATS_PER_LOOP + Math.floor(currentStep / 2);
            const chordName = this.getCurrentChord()?.chord.name ?? '?';
            const lfoPhase = beatInCycle < 8 ? 'rising' : 'falling';
            console.log(
              `[engine] loop:${this.loopCount} step:${currentStep} cycle:${beatInCycle}/16 lfo:${lfoPhase} chord:${chordName}`
            );
          }
        }
      }
      this.visualRafId = requestAnimationFrame(tick);
    };

    this.visualRafId = requestAnimationFrame(tick);
  }

  private stopVisualTicker(): void {
    if (this.visualRafId !== null) {
      cancelAnimationFrame(this.visualRafId);
      this.visualRafId = null;
    }
    this.lastVisualStep = -2;
  }

  /** Derive current step from Transport ticks (no callback dependency) */
  private getCurrentStepFromTransport(): number {
    const transport = Tone.getTransport();
    const ticks = transport.ticks;
    // '8n' = one eighth note per sub-column
    const ticksPerStep = Tone.Ticks('8n').valueOf();
    const loopLen = getLoopLength(this.grid);
    return Math.floor(ticks / ticksPerStep) % loopLen;
  }

  private getChordIndex(): number {
    // When arrangement is active, find the chord in the progression array
    // (or return 0 if it's a B-section chord not in the A-section progression)
    if (this.currentArrangementCtx) {
      const chord = this.currentArrangementCtx.chord;
      const idx = this.config.chordProgression?.findIndex(
        (c) => c.name === chord.name,
      );
      return idx !== undefined && idx >= 0 ? idx : 0;
    }
    const progLen = this.config.chordProgression?.length || 1;
    return this.loopCount % progLen;
  }

  /** Get the current chord, either from arrangement or progression cycling. */
  private getCurrentChord(): { chord: Chord; index: number } | null {
    const progression = this.config.chordProgression;
    if (!progression || progression.length === 0) return null;

    if (this.currentArrangementCtx) {
      return { chord: this.currentArrangementCtx.chord, index: this.getChordIndex() };
    }
    const index = this.loopCount % progression.length;
    return { chord: progression[index], index };
  }

  /** Update the pad chord if the chord index has changed.
   *  Also picks whether the top note is the default (9th) or alt (3rd) via PRNG. */
  private triggerPadChord(time?: number): void {
    const current = this.getCurrentChord();
    if (!current) return;

    const { chord } = current;
    // Use chord name + voicing shift as identity (shift changes register even for same chord)
    const shift = this.currentArrangementCtx?.voicingShift ?? 0;
    const chordKey = `${chord.name}:${shift}`;
    // Track by name to handle B-section chords not in the A-progression
    if (chordKey === this.lastPadChordName) return;
    this.lastPadChordName = chordKey;
    const voicing = [...chord.padVoicing];

    // Top-note drift: ~35% chance of using the alt (3rd) instead of default (9th)
    if (chord.padTopAlt) {
      this.padUsingAlt = this.padDriftRng() < 0.45;
      if (this.padUsingAlt) {
        voicing[voicing.length - 1] = chord.padTopAlt;
      }
      this.padCurrentTopNote = voicing[voicing.length - 1];
    }

    // Apply arrangement voicing shift (e.g. +12 in B section for brighter pad)
    const shifted = shift
      ? voicing.map(n => midiToNote(noteToMidi(n) + shift))
      : voicing;

    this.player.changePadChord(shifted, time);
  }

  /** Mid-loop drift: small chance of swapping the pad top note. Called at loop midpoint. */
  private maybeDriftPadTop(time: number): void {
    const current = this.getCurrentChord();
    if (!current) return;

    const { chord } = current;
    if (!chord.padTopAlt) return;

    // ~20% chance of flipping the top note mid-loop
    if (this.padDriftRng() < 0.35) {
      const defaultTop = chord.padVoicing[chord.padVoicing.length - 1];
      const oldNote = this.padCurrentTopNote;
      const newNote = this.padUsingAlt ? defaultTop : chord.padTopAlt;

      this.player.shiftPadTopNote(oldNote, newNote, time);
      this.padUsingAlt = !this.padUsingAlt;
      this.padCurrentTopNote = newNote;
    }
  }

  private emitStep(
    column: number,
    loopCount = 0,
    triggered: { row: number; value: number }[] = [],
  ): void {
    const ctx = this.currentArrangementCtx;
    const vp = ctx?.voiceProbs;
    const event: StepEvent = {
      column,
      loopCount,
      chordIndex: this.getChordIndex(),
      triggered,
      drumProbs: vp ? [vp.sparkle, vp.rhythm, vp.groove, vp.pulse] : undefined,
      sectionLabel: ctx?.label,
      energy: ctx?.energy,
      voiceProbs: vp ? { ...vp } : undefined,
    };
    for (const cb of this.stepCallbacks) {
      cb(event);
    }
  }

  /** Reset all playback-related state to defaults. Shared by stop() and finishArrangement(). */
  private resetPlaybackState(): void {
    this.column = 0;
    this.loopCount = 0;
    this.stepTriggered.clear();
    this.lastPadChordName = '';
    this.padUsingAlt = false;
    this.padCurrentTopNote = '';
    this.padDriftRng = createPRNG(PAD_DRIFT_SEED);
    this.arranger = null;
    this.currentArrangementCtx = null;
  }

  // ---------------------------------------------------------------------------
  // Arrangement ending
  // ---------------------------------------------------------------------------

  /**
   * Play the final beat of the arrangement: pad chord re-attack only.
   * No kick or bass — let the pad fade out cleanly.
   * Then stop the scheduling loop and let tails ring out.
   */
  private playFinalBeat(time: number): void {
    const ctx = this.currentArrangementCtx!;
    const chord = ctx.chord;

    // Stop pad LFOs and open the filter for a clean, warm final chord.
    // Must happen before re-attack so the pad isn't sweeping during the sustain.
    this.player.prepareFinalPad();

    // Force pad re-attack on the final chord — even if it's the same chord name,
    // we want a fresh attack so the pad is audible and its release tail becomes the fadeout.
    const voicing = [...chord.padVoicing];
    this.player.changePadChord(voicing, time);

    // Pad-only final beat — no kick, no bass, no sidechain duck
    const finalSounds: ScheduledSound[] = [];

    this.player.play(finalSounds, time);

    // Emit visual step for column 0
    const finalImmediate = finalSounds.filter((s) => s.row >= 0);
    const finalTriggered = finalImmediate.map((s) => ({ row: s.row, value: s.value }));
    this.stepTriggered.set(0, finalTriggered);
    this.emitStep(0, this.loopCount, finalTriggered);

    // Fire sounds callbacks for final beat
    if (this.soundsCallbacks.length > 0) {
      const played = finalImmediate.map((s) => ({ sound: s.sound, velocity: s.velocity }));
      const energy = this.currentArrangementCtx?.energy;
      const padProb = this.currentArrangementCtx?.voiceProbs?.pad;
      for (const cb of this.soundsCallbacks) {
        cb(played, energy, padProb);
      }
    }

    // Stop the scheduling loop — no more ticks
    this.clearLoop();
    this.stopVisualTicker();

    // Let the pad sustain for 2 beats so Am establishes above the G reverb tail,
    // then fade out. At 120 BPM, 1 beat = 500ms, so 2 beats ≈ 1 second.
    const beatDuration = 60 / this.config.tempo;
    const sustainMs = beatDuration * 2 * 1000;
    setTimeout(() => {
      this.player.fadeOut(3).then(() => {
        this.finishArrangement();
      });
    }, sustainMs);
  }

  /** Clean up after arrangement ends. Notifies the App. */
  private finishArrangement(): void {
    if (!this.playing && !this.arranger) return; // already cleaned up (e.g. user hit stop)
    this.clearLoop();
    this.stopVisualTicker();
    this.playing = false;
    this.player.stopTransport();
    // Don't call stopAll() — fadeOut already handled audio gracefully
    this.resetPlaybackState();

    // Notify grid to clear playhead
    this.emitStep(-1);

    // Notify App that the song is done
    for (const cb of this.completeCallbacks) {
      cb();
    }
  }
}
