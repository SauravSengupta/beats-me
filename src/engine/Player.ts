import * as Tone from 'tone';
import type { BassConfig, EngineConfig, MixLfo, PadConfig, PlayerAPI, ScheduledSound, StabConfig } from '../lib/types';
import type { VariationParams } from '../lib/prng';
import { STAB_GROOVE, BEATS_PER_LOOP } from './constants';

/**
 * Thin Tone.js wrapper. No music logic — just plays what it's told.
 * All sound parameters (samples, synth settings) come from the Preset
 * via EngineConfig — nothing is hardcoded here.
 */

interface Voice {
  trigger: (velocity: number, duration?: number, time?: number, note?: string, notes?: string[]) => void;
  stop?: () => void;
  dispose: () => void;
  /** Update tempo-synced parameters (e.g. delay time). Called when BPM changes. */
  setTempo?: (bpm: number) => void;
  /** Exposed delay node for energy automation (stab/arp voices only). */
  delay?: Tone.FeedbackDelay;
  /** Exposed filter node for variation-driven cutoff changes. */
  filter?: Tone.Filter;
  /** Exposed saturation node for energy-driven grit (bass only). */
  saturation?: Tone.Chebyshev;
}

/** Linear interpolation: lerp(a, b, 0) = a, lerp(a, b, 1) = b. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/** Convert 0-1 velocity + dB volume to a linear gain multiplier. */
function velToGain(vel: number, volumeDb: number): number {
  return vel * (10 ** (volumeDb / 20));
}

/** Manages per-hit node polyphony: evicts oldest when at cap, auto-disposes after timeout. */
class HitPool {
  private active: Array<{ dispose: () => void }> = [];
  private maxHits: number;

  constructor(maxHits: number) {
    this.maxHits = maxHits;
  }

  /** Add a hit. Evicts oldest if at capacity. Auto-disposes after `disposeMs`. */
  add(nodes: { dispose: () => void }, disposeMs: number): void {
    if (this.active.length >= this.maxHits) {
      const old = this.active.shift();
      old?.dispose();
    }
    this.active.push(nodes);
    setTimeout(() => {
      const idx = this.active.indexOf(nodes);
      if (idx !== -1) {
        this.active.splice(idx, 1);
        nodes.dispose();
      }
    }, disposeMs);
  }

  disposeAll(): void {
    for (const hit of this.active) hit.dispose();
    this.active.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Sample-based drum voices
// ---------------------------------------------------------------------------

function createDrumVoice(
  url: string,
  volumeDb: number,
  dest: Tone.ToneAudioNode,
): { voice: Voice; player: Tone.Player } {
  const player = new Tone.Player({ url }).connect(dest);
  return {
    player,
    voice: {
      trigger: (vel, _dur, time) => {
        if (!player.loaded) return;
        const velDb = vel > 0 ? 20 * Math.log10(vel) : -100;
        const targetVol = volumeDb + velDb;
        const t = time ?? Tone.now();
        // Schedule volume change at the same time as the start
        // to avoid the volume being set in a different audio block
        // (setting .value immediately while .start() is scheduled for
        // a future block causes a harsh transient on first play).
        player.volume.setValueAtTime(targetVol, t);
        player.start(t);
      },
      dispose: () => player.dispose(),
    },
  };
}

// ---------------------------------------------------------------------------
// Synthesized drum voices
// ---------------------------------------------------------------------------

/**
 * Synth kick: pitched sine sweep 180→45Hz + filtered noise click transient.
 * Body and click have independent envelopes. Per-hit gain nodes avoid
 * pre-scheduling envelope clobbering on overlapping hits.
 *
 * Signal flow per hit:
 *   body(sine 180→45Hz) → bodyGain(250ms decay) → hitGain → dest
 *   noise → highpass(1kHz) → clickGain(5ms decay) → hitGain → dest
 */
function createSynthKick(volumeDb: number, dest: Tone.ToneAudioNode): Voice {
  const hits = new HitPool(4);

  return {
    trigger: (vel, _dur, time) => {
      const t = time ?? Tone.now();
      const vGain = velToGain(vel, volumeDb);

      const hitGain = new Tone.Gain(vGain).connect(dest);

      // Sine body — pitch sweep with longer sub tail
      const bodyGain = new Tone.Gain(1).connect(hitGain);
      const osc = new Tone.Oscillator({ type: 'sine', frequency: 180 }).connect(bodyGain);
      osc.start(t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.08);
      osc.stop(t + 0.3);

      // Body envelope: 250ms decay for round sub
      bodyGain.gain.setValueAtTime(1.0, t);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

      // Noise click — connects directly to filter, never to unfiltered output
      const clickGain = new Tone.Gain(1).connect(hitGain);
      const clickFilter = new Tone.Filter({ frequency: 1000, type: 'highpass' }).connect(clickGain);
      const noise = new Tone.Noise('white').connect(clickFilter);
      noise.start(t);
      noise.stop(t + 0.008);

      // Click envelope: fast 5ms decay
      clickGain.gain.setValueAtTime(0.6, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.005);

      hits.add({ dispose: () => {
        osc.dispose();
        bodyGain.dispose();
        noise.dispose();
        clickFilter.dispose();
        clickGain.dispose();
        hitGain.dispose();
      }}, 400);
    },
    dispose: () => hits.disposeAll(),
  };
}

/**
 * Synth snare: pitched sine body (200→150Hz sweep) + bandpass noise rattle
 * (filter sweep 5k→2k) + gated reverb tail. Body and noise have independent
 * gain envelopes for "punch then rattle" character.
 *
 * Per-hit nodes avoid the pre-scheduling envelope bug — overlapping hits
 * decay independently through their own gain nodes.
 *
 * Signal flow per hit:
 *   body(sine 200→150Hz) → bodyGain(100ms decay) → hitGain
 *   noise → bandpass(5k→2k) → noiseGain(200ms decay) → hitGain
 *   hitGain → dest (dry)
 *   hitGain → reverb → reverbGain(gated 270ms cut) → dest
 */
function createSynthSnare(volumeDb: number, dest: Tone.ToneAudioNode, brightnessRef: { value: number }): Voice {
  const reverb = new Tone.Reverb({ decay: 1.5, wet: 1.0 });
  reverb.generate();

  const hits = new HitPool(4);

  return {
    trigger: (vel, _dur, time) => {
      const t = time ?? Tone.now();
      const vGain = velToGain(vel, volumeDb);

      // --- Per-hit nodes ---
      const hitGain = new Tone.Gain(vGain).connect(dest);

      // Gated reverb send — per-hit so envelope can't be clobbered
      const reverbGain = new Tone.Gain(0).connect(dest);
      reverb.connect(reverbGain);
      hitGain.connect(reverb);

      // Body: sine with pitch sweep for punch
      const bodyGain = new Tone.Gain(1).connect(hitGain);
      const body = new Tone.Oscillator({ type: 'sine', frequency: 200 }).connect(bodyGain);
      body.start(t);
      body.frequency.exponentialRampToValueAtTime(150, t + 0.07);
      body.stop(t + 0.15);

      // Body envelope: fast 100ms decay
      bodyGain.gain.setValueAtTime(1.0, t);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

      // Noise: bandpass with filter sweep for rattle
      // Brightness scales start/end freqs — darker at low energy, brighter at high
      const brt = brightnessRef.value;
      const bpStart = 5000 * brt;
      const bpEnd = 2000 * brt;
      const noiseGain = new Tone.Gain(1).connect(hitGain);
      const bandpass = new Tone.Filter({ frequency: bpStart, type: 'bandpass', Q: 1 }).connect(noiseGain);
      const noise = new Tone.Noise('white').connect(bandpass);
      noise.start(t);
      noise.stop(t + 0.25);

      // Noise envelope: 200ms decay, filter sweep
      noiseGain.gain.setValueAtTime(0.8, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      bandpass.frequency.setValueAtTime(bpStart, t);
      bandpass.frequency.exponentialRampToValueAtTime(bpEnd, t + 0.15);

      // Gated reverb envelope — full level, then sharp cut at 270ms
      reverbGain.gain.setValueAtTime(vGain * 0.7, t);
      reverbGain.gain.setValueAtTime(vGain * 0.7, t + 0.25);
      reverbGain.gain.linearRampToValueAtTime(0.001, t + 0.27);

      hits.add({ dispose: () => {
        body.dispose();
        bodyGain.dispose();
        noise.dispose();
        bandpass.dispose();
        noiseGain.dispose();
        hitGain.disconnect(reverb);
        hitGain.dispose();
        reverbGain.dispose();
      }}, 600);
    },
    dispose: () => {
      hits.disposeAll();
      reverb.dispose();
    },
  };
}

/**
 * Synth hat: 6 square oscillators at inharmonic ratios → bandpass 10kHz → highpass 7kHz.
 * Based on the Sonoport Web Audio synthesis guide. Short 50ms decay.
 */
function createSynthHat(volumeDb: number, dest: Tone.ToneAudioNode): Voice {
  // Shared filter chain: bandpass 10kHz → highpass 7kHz (Sonoport reference order)
  const highpass = new Tone.Filter({ frequency: 7000, type: 'highpass' }).connect(dest);
  const bandpass = new Tone.Filter({ frequency: 10000, type: 'bandpass' }).connect(highpass);

  const fundamental = 40;
  const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
  const hits = new HitPool(4);

  return {
    trigger: (vel, _dur, time) => {
      const t = time ?? Tone.now();
      const vGain = velToGain(vel, volumeDb);

      // Per-hit gain so overlapping hits decay independently
      const hitGain = new Tone.Gain(0).connect(bandpass);

      const oscs: Tone.Oscillator[] = [];
      for (const ratio of ratios) {
        const osc = new Tone.Oscillator({
          type: 'square',
          frequency: fundamental * ratio,
        }).connect(hitGain);
        osc.start(t);
        osc.stop(t + 0.08);
        oscs.push(osc);
      }

      hitGain.gain.setValueAtTime(vGain, t);
      hitGain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);

      hits.add({ dispose: () => {
        for (const osc of oscs) osc.dispose();
        hitGain.dispose();
      }}, 200);
    },
    filter: bandpass,
    dispose: () => {
      hits.disposeAll();
      highpass.dispose();
      bandpass.dispose();
    },
  };
}

/**
 * Synth cymbal: FM tone layer (metallic body) + filtered noise layer (sizzle).
 * Inspired by WAC-2016 FM percussion tutorial. Both layers have enveloped
 * filters so the spectrum evolves — bright attack, darker shimmer tail.
 *
 * Signal flow:
 *   FM tone:  modulator(sine) → carrier(sine) → bandpass(sweep 8k→3k) → toneGain(0.5s decay)
 *   Noise:    noise → highpass(sweep 9k→3k) → noiseGain(1.8s decay)
 *   Both → mixGain → dest
 */
function createSynthCymbal(volumeDb: number, dest: Tone.ToneAudioNode): Voice {
  // Persistent noise source — always running, shared across hits.
  // Each trigger creates its own per-hit gain + filter nodes so overlapping
  // hits decay independently (like real cymbals) without cancelScheduledValues
  // destroying a prior hit's envelope.
  const noise = new Tone.Noise('white');
  let started = false;

  const hits = new HitPool(4);

  return {
    trigger: (vel, _dur, time) => {
      const t = time ?? Tone.now();
      const vGain = velToGain(vel, volumeDb);

      if (!started) {
        noise.start(t);
        started = true;
      }

      // --- Per-hit nodes: independent envelope that can't be clobbered ---
      const hitGain = new Tone.Gain(0).connect(dest);

      // Attack band: bright transient
      const attackGain = new Tone.Gain(0).connect(hitGain);
      const attackBp = new Tone.Filter({ frequency: 12000, type: 'bandpass', Q: 0.8 }).connect(attackGain);
      noise.connect(attackBp);

      // Body band: metallic shimmer
      const bodyGain = new Tone.Gain(0).connect(hitGain);
      const bodyHp = new Tone.Filter({ frequency: 8000, type: 'highpass' }).connect(bodyGain);
      const bodyBp = new Tone.Filter({ frequency: 5000, type: 'bandpass', Q: 0.5 }).connect(bodyHp);
      noise.connect(bodyBp);

      // Wash band: airy sizzle tail
      const washGain = new Tone.Gain(0).connect(hitGain);
      const washHp = new Tone.Filter({ frequency: 10000, type: 'highpass' }).connect(washGain);
      noise.connect(washHp);

      // --- Envelopes ---
      // Overall hit amplitude
      hitGain.gain.setValueAtTime(vGain, t);
      hitGain.gain.exponentialRampToValueAtTime(0.001, t + 3.5);

      // Attack: fast transient, 80ms
      attackGain.gain.setValueAtTime(1.0, t);
      attackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      attackBp.frequency.setValueAtTime(12000, t);
      attackBp.frequency.exponentialRampToValueAtTime(8000, t + 0.06);

      // Body: metallic shimmer, 1.4s
      bodyGain.gain.setValueAtTime(0.8, t);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      bodyHp.frequency.setValueAtTime(8000, t);
      bodyHp.frequency.exponentialRampToValueAtTime(5000, t + 1.0);

      // Wash: airy sizzle, 3.0s
      washGain.gain.setValueAtTime(0.5, t);
      washGain.gain.exponentialRampToValueAtTime(0.001, t + 3.0);
      washHp.frequency.setValueAtTime(10000, t);
      washHp.frequency.exponentialRampToValueAtTime(4000, t + 2.5);

      // Self-cleanup after decay completes
      hits.add({ dispose: () => {
        noise.disconnect(attackBp);
        noise.disconnect(bodyBp);
        noise.disconnect(washHp);
        attackBp.dispose();
        attackGain.dispose();
        bodyBp.dispose();
        bodyHp.dispose();
        bodyGain.dispose();
        washHp.dispose();
        washGain.dispose();
        hitGain.dispose();
      }}, 4000);
    },
    dispose: () => {
      hits.disposeAll();
      if (started) noise.stop();
      noise.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Riser voice (continuous noise + sine sweep for transitions)
// ---------------------------------------------------------------------------

/**
 * Riser: white noise + sine undertone through a sweeping bandpass filter.
 * One continuous sweep per trigger — not retriggered per step.
 * 'up' sweeps 200Hz→8kHz (building tension), 'down' sweeps 8kHz→200Hz (release).
 *
 * Signal flow:
 *   noise(white) → bandpass(sweeping) → riserGain(energy-scaled) ─┐
 *   sine(undertone, sweeping pitch) → sineGain(0.3×) ─────────────┤→ dest
 *
 * Lifetime: startRiser() begins the sweep, stopRiser() kills it.
 * The sweep duration is calculated from the number of columns remaining.
 */
interface RiserParams {
  freqLow: number;
  freqHigh: number;
  q: number;
}

interface RiserVoice {
  start: (type: 'up' | 'down', durationSec: number, volume: number, params: RiserParams, time?: number) => void;
  stop: (time?: number) => void;
  dispose: () => void;
}

function createRiser(dest: Tone.ToneAudioNode): RiserVoice {
  // Persistent nodes — reused across risers
  let noise: Tone.Noise | null = null;
  let sine: Tone.Oscillator | null = null;
  let bandpass: Tone.Filter | null = null;
  let noiseGain: Tone.Gain | null = null;
  let sineGain: Tone.Gain | null = null;
  let masterGain: Tone.Gain | null = null;

  function cleanup() {
    noise?.stop();
    noise?.dispose();
    sine?.stop();
    sine?.dispose();
    bandpass?.dispose();
    noiseGain?.dispose();
    sineGain?.dispose();
    masterGain?.dispose();
    noise = null;
    sine = null;
    bandpass = null;
    noiseGain = null;
    sineGain = null;
    masterGain = null;
  }

  return {
    start: (type, durationSec, volume, params, time) => {
      // Clean up any previous riser
      cleanup();

      const t = time ?? Tone.now();
      const { freqLow, freqHigh, q } = params;
      // Sine undertone range scales proportionally to filter range
      const sineLow = 60;
      const sineHigh = Math.min(400, freqHigh * 0.05);

      const startFreq = type === 'up' ? freqLow : freqHigh;
      const endFreq = type === 'up' ? freqHigh : freqLow;
      const sineStart = type === 'up' ? sineLow : sineHigh;
      const sineEnd = type === 'up' ? sineHigh : sineLow;

      // Build signal chain
      masterGain = new Tone.Gain(0).connect(dest);

      // Noise path: white noise → bandpass → noiseGain → master
      noiseGain = new Tone.Gain(1).connect(masterGain);
      bandpass = new Tone.Filter({ frequency: startFreq, type: 'bandpass', Q: q }).connect(noiseGain);
      noise = new Tone.Noise('white').connect(bandpass);

      // Sine undertone: gives the riser a pitched center
      sineGain = new Tone.Gain(0.3).connect(masterGain);
      sine = new Tone.Oscillator({ type: 'sine', frequency: sineStart }).connect(sineGain);

      // Start sources
      noise.start(t);
      sine.start(t);

      // Sources stop at 85% of duration — the reverb tail carries the rest
      const sourceEnd = t + durationSec * 0.85;

      // Schedule filter sweep (completes at sourceEnd, not full duration)
      bandpass.frequency.setValueAtTime(startFreq, t);
      bandpass.frequency.exponentialRampToValueAtTime(endFreq, sourceEnd);

      // Schedule sine pitch sweep
      sine.frequency.setValueAtTime(sineStart, t);
      sine.frequency.exponentialRampToValueAtTime(sineEnd, sourceEnd);

      // Volume envelope: fade in 20%, hold, then fade out over final 15%
      const fadeInEnd = t + durationSec * 0.2;
      masterGain.gain.setValueAtTime(0, t);
      masterGain.gain.linearRampToValueAtTime(volume, fadeInEnd);
      masterGain.gain.setValueAtTime(volume, sourceEnd);
      masterGain.gain.exponentialRampToValueAtTime(0.001, t + durationSec);
      masterGain.gain.setValueAtTime(0, t + durationSec + 0.01);

      // Stop sources after fade completes (reverb tail continues independently)
      noise.stop(t + durationSec + 0.05);
      sine.stop(t + durationSec + 0.05);
    },

    stop: (time) => {
      const t = time ?? Tone.now();
      if (masterGain) {
        masterGain.gain.cancelScheduledValues(t);
        masterGain.gain.setValueAtTime(masterGain.gain.value, t);
        masterGain.gain.linearRampToValueAtTime(0, t + 0.05);
      }
      // Delay cleanup so ramp completes
      setTimeout(cleanup, 200);
    },

    dispose: cleanup,
  };
}

// ---------------------------------------------------------------------------
// Synth-based melodic voices
// ---------------------------------------------------------------------------

/**
 * Synth bass: saw oscillator + sine sub (one octave below), per-hit filter
 * envelope for the "bwow" sweep, optional portamento glide between notes.
 *
 * Signal flow per hit:
 *   osc(saw) ──┐
 *               ├→ hitFilter(envStart→envEnd sweep) → hitGain(amp envelope) → saturation(shared)
 *   subOsc(sine) → subGain(-3dB, 0.8×vel) ──┘                                    ↓
 *                                                              staticFilter(cutoffHz) → dest
 *
 * When filterEnvStart is omitted (e.g. debug preset), the per-hit filter is
 * skipped — oscillators connect directly to hitGain → saturation.
 */
function createBass(bassConfig: BassConfig, dest: Tone.ToneAudioNode): Voice {
  // Shared chain: saturation → static lowpass → dest
  const staticFilter = new Tone.Filter({
    frequency: bassConfig.filterCutoffHz,
    type: 'lowpass',
  }).connect(dest);

  const saturation = new Tone.Chebyshev(3).connect(staticFilter);
  (saturation as unknown as { wet: Tone.Signal<'normalRange'> }).wet.value =
    bassConfig.saturationWet ?? 0.3;

  // Optional chorus on the main saw oscillator (sub stays dry/mono)
  const hasChorus = bassConfig.chorusDelayMs != null;
  let chorus: Tone.Chorus | null = null;
  if (hasChorus) {
    chorus = new Tone.Chorus({
      delayTime: bassConfig.chorusDelayMs!,
      frequency: bassConfig.chorusRate ?? 0.5,
      depth: 1,
    }).connect(saturation);
    (chorus as unknown as { wet: Tone.Signal<'normalRange'> }).wet.value =
      bassConfig.chorusWet ?? 0.2;
    chorus.start();
  }

  const hits = new HitPool(4);
  const hasEnvelope = bassConfig.filterEnvStart != null;
  const hasGlide = (bassConfig.glideTime ?? 0) > 0;

  // Track last note for portamento
  let lastMidi = -1;
  let lastTriggerTime = -Infinity;

  // Sub level relative to main: -3dB (0.707) × 0.8 velocity scale ≈ 0.566
  const SUB_LEVEL = 0.566;

  return {
    trigger: (vel, _dur, time, note) => {
      const t = time ?? Tone.now();
      const n = note ?? 'A2';
      const midi = Tone.Frequency(n).toMidi();
      const freq = Tone.Frequency(midi, 'midi').toFrequency();
      const subFreq = Tone.Frequency(midi - 12, 'midi').toFrequency();
      const vGain = velToGain(vel, bassConfig.volumeDb);

      // Per-hit gain for main osc — routes through chorus (if enabled) then to saturation
      const mainHitGain = new Tone.Gain(0).connect(chorus ?? saturation);

      // Per-hit filter envelope (the "bwow"), or direct connect if no envelope
      let hitFilter: Tone.Filter | null = null;
      const mainOscDest = hasEnvelope
        ? (hitFilter = new Tone.Filter({
            frequency: bassConfig.filterEnvStart!,
            type: 'lowpass',
          }).connect(mainHitGain), hitFilter)
        : mainHitGain;

      // Main oscillator
      const osc = new Tone.Oscillator(
        { type: bassConfig.oscillator, frequency: freq } as Record<string, unknown>
      ).connect(mainOscDest);

      // Sub oscillator — sine one octave below, bypasses chorus (stays mono/dry)
      const subHitGain = new Tone.Gain(0).connect(saturation);
      const subGain = new Tone.Gain(SUB_LEVEL).connect(subHitGain);
      const subOsc = new Tone.Oscillator({
        type: 'sine',
        frequency: subFreq,
      }).connect(subGain);

      // Portamento: glide from previous note if recent (within 500ms)
      if (hasGlide && lastMidi > 0 && (t - lastTriggerTime) < 0.5) {
        const prevFreq = Tone.Frequency(lastMidi, 'midi').toFrequency();
        const prevSubFreq = Tone.Frequency(lastMidi - 12, 'midi').toFrequency();
        const glide = bassConfig.glideTime!;
        osc.frequency.setValueAtTime(prevFreq, t);
        osc.frequency.exponentialRampToValueAtTime(freq, t + glide);
        subOsc.frequency.setValueAtTime(prevSubFreq, t);
        subOsc.frequency.exponentialRampToValueAtTime(subFreq, t + glide);
      }

      // Start oscillators
      osc.start(t);
      subOsc.start(t);
      osc.stop(t + 0.6);
      subOsc.stop(t + 0.6);

      // Filter envelope: sweep envStart → envEnd
      if (hitFilter) {
        hitFilter.frequency.setValueAtTime(bassConfig.filterEnvStart!, t);
        hitFilter.frequency.exponentialRampToValueAtTime(
          bassConfig.filterEnvEnd!, t + bassConfig.filterEnvDecay!,
        );
      }

      // Amplitude envelope: attack 10ms, decay 200ms to sustain 0.4, release 300ms
      // Main and sub have separate gain nodes so chorus only affects main
      for (const g of [mainHitGain, subHitGain]) {
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vGain, t + 0.01);
        g.gain.exponentialRampToValueAtTime(vGain * 0.4 + 0.001, t + 0.21);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      }

      lastMidi = midi;
      lastTriggerTime = t;

      hits.add({ dispose: () => {
        osc.dispose();
        subOsc.dispose();
        subGain.dispose();
        hitFilter?.dispose();
        mainHitGain.dispose();
        subHitGain.dispose();
      }}, 700);
    },
    saturation,
    dispose: () => {
      hits.disposeAll();
      chorus?.dispose();
      saturation.dispose();
      staticFilter.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Chord stab synth (percussive chord hit + optional delay)
// ---------------------------------------------------------------------------

function createStab(stabConfig: StabConfig, dest: Tone.ToneAudioNode): Voice {
  const filter = new Tone.Filter({
    frequency: stabConfig.filterCutoffHz,
    type: 'lowpass',
  }).connect(dest);

  // Optional saturation stage between delay and filter
  let saturation: Tone.Chebyshev | null = null;
  const filterInput: Tone.ToneAudioNode = stabConfig.saturationWet != null
    ? (saturation = new Tone.Chebyshev(stabConfig.saturationOrder ?? 3).connect(filter),
       (saturation as unknown as { wet: Tone.Signal<'normalRange'> }).wet.value = stabConfig.saturationWet,
       saturation)
    : filter;

  // Delay is optional — groove stab is dry
  const hasDelay = stabConfig.delayTime != null;
  let delay: Tone.FeedbackDelay | null = null;
  if (hasDelay) {
    delay = new Tone.FeedbackDelay({
      delayTime: stabConfig.delayTime!,
      feedback: stabConfig.delayFeedback ?? 0,
      wet: stabConfig.delayWet ?? 0,
    }).connect(filterInput);
  }

  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: stabConfig.oscillator } as Record<string, unknown>,
    envelope: {
      attack: stabConfig.attack,
      decay: stabConfig.decay,
      sustain: stabConfig.sustain,
      release: stabConfig.release,
    },
  }).connect(delay ?? filterInput);
  synth.volume.value = stabConfig.volumeDb;

  return {
    trigger: (vel, _dur, time, _note, _notes) => {
      const chord = _notes ?? (_note ? [_note] : null);
      if (!chord) return;
      synth.triggerAttackRelease(chord, stabConfig.decay + stabConfig.release, time, vel);
    },
    stop: () => {
      synth.releaseAll();
      // Don't zero delay params — masterGate handles silence on stop.
      // Zeroing caused stabs to play dry if delay wasn't restored before first trigger.
    },
    setTempo: (_bpm: number) => {
      if (delay && stabConfig.delayTime) {
        // Re-apply the notation-based delay time so Tone.js resolves it at the new BPM
        delay.delayTime.value = Tone.Time(stabConfig.delayTime).toSeconds();
      }
    },
    delay: delay ?? undefined,
    filter,
    dispose: () => { synth.dispose(); delay?.dispose(); saturation?.dispose(); filter.dispose(); },
  };
}

// ---------------------------------------------------------------------------
// Pad synth (held chords with LFO movement)
// ---------------------------------------------------------------------------

class PadSynth {
  private synth: Tone.PolySynth;
  private lfoFilter: Tone.Filter;
  private saturation: Tone.Chebyshev | null = null;
  private panner: Tone.Panner | null = null;
  private pulseGain: Tone.Gain;
  private volumeGain: Tone.Gain;
  private filterLfo: Tone.LFO;
  private volumeLfo: Tone.LFO;
  private panLfo: Tone.LFO | null = null;
  private padConfig: PadConfig;
  private currentNotes: string[] = [];

  constructor(padConfig: PadConfig, dest: Tone.ToneAudioNode, tempo: number, beatsPerLoop: number) {
    this.padConfig = padConfig;
    const lfoFreq = tempo / 60 / beatsPerLoop / 3;

    this.volumeGain = new Tone.Gain(1).connect(dest);

    // Pulse gain — hat-driven volume ducking (sidechain-style pump)
    this.pulseGain = new Tone.Gain(1).connect(this.volumeGain);

    // Stereo panner (optional — only if panLfoRange is configured)
    const filterDest: Tone.ToneAudioNode = padConfig.panLfoRange
      ? (this.panner = new Tone.Panner(0).connect(this.pulseGain), this.panner)
      : this.pulseGain;

    // LFO filter — slow breathing
    this.lfoFilter = new Tone.Filter({
      frequency: (padConfig.filterLfoRange[0] + padConfig.filterLfoRange[1]) / 2,
      type: 'lowpass',
      rolloff: -24,
    }).connect(filterDest);

    // Optional saturation stage between synth and filter
    this.saturation = padConfig.saturationWet != null
      ? new Tone.Chebyshev(padConfig.saturationOrder ?? 3).connect(this.lfoFilter)
      : null;
    if (this.saturation) {
      (this.saturation as unknown as { wet: Tone.Signal<'normalRange'> }).wet.value = padConfig.saturationWet!;
    }

    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: padConfig.oscillator,
        spread: padConfig.spread,
        count: padConfig.count,
      } as Record<string, unknown>,
      envelope: {
        attack: padConfig.attack,
        decay: 0.1,
        sustain: 0.8,
        release: padConfig.release,
      },
    }).connect(this.saturation ?? this.lfoFilter);
    this.synth.volume.value = padConfig.volumeDb;

    this.filterLfo = new Tone.LFO({
      frequency: lfoFreq,
      min: padConfig.filterLfoRange[0],
      max: padConfig.filterLfoRange[1],
      phase: 90,
    }).connect(this.lfoFilter.frequency);

    this.volumeLfo = new Tone.LFO({
      frequency: lfoFreq,
      min: padConfig.volumeLfoRange[0],
      max: padConfig.volumeLfoRange[1],
      phase: 90,
    }).connect(this.volumeGain.gain);

    // Pan LFO — slower than filter/volume for subtle width drift
    if (this.panner && padConfig.panLfoRange) {
      const panRate = lfoFreq * (padConfig.panLfoRateMul ?? 0.5);
      this.panLfo = new Tone.LFO({
        frequency: panRate,
        min: padConfig.panLfoRange[0],
        max: padConfig.panLfoRange[1],
        phase: 0, // offset from filter/volume LFOs for less correlated movement
      }).connect(this.panner.pan);
    }
  }

  start(): void {
    this.filterLfo.stop();
    this.volumeLfo.stop();
    this.panLfo?.stop();
    this.filterLfo.start();
    this.volumeLfo.start();
    this.panLfo?.start();
  }

  stop(): void {
    this.stopLfos();
    if (this.currentNotes.length > 0) {
      this.synth.releaseAll();
      this.currentNotes = [];
    }
  }

  /** Stop LFOs without releasing the synth — pad continues sustaining at current values. */
  stopLfos(): void {
    this.filterLfo.stop();
    this.volumeLfo.stop();
    this.panLfo?.stop();
  }

  /** Set the pad filter LFO sweep range. Used by energy automation. */
  setFilterRange(min: number, max: number): void {
    this.filterLfo.min = min;
    this.filterLfo.max = max;
  }

  /** Set the pad filter to a fixed frequency (LFOs should be stopped first). */
  setFilterFrequency(hz: number): void {
    this.lfoFilter.frequency.value = hz;
  }

  setTempo(tempo: number, beatsPerLoop: number): void {
    const lfoFreq = tempo / 60 / beatsPerLoop / 3;
    this.filterLfo.frequency.value = lfoFreq;
    this.volumeLfo.frequency.value = lfoFreq;
    if (this.panLfo) {
      this.panLfo.frequency.value = lfoFreq * (this.padConfig.panLfoRateMul ?? 0.5);
    }
  }

  changeChord(notes: string[], time?: number): void {
    const t = time ?? Tone.now();
    if (this.currentNotes.length > 0) {
      // Crossfade: release old notes, attack new ones at the same time.
      // The pad's slow attack (0.3s) and long release (1.2s) create a natural overlap.
      this.synth.triggerRelease(this.currentNotes, t);
    }
    this.currentNotes = [...notes];
    if (notes.length > 0) {
      this.synth.triggerAttack(notes, t);
    }
  }

  /** Swap the top note of the current pad voicing (e.g. 9th → 3rd).
   *  Releases the old top note and attacks the new one for a smooth crossfade. */
  shiftTopNote(oldNote: string, newNote: string, time?: number): void {
    const t = time ?? Tone.now();
    if (!this.currentNotes.includes(oldNote)) return;
    this.synth.triggerRelease([oldNote], t);
    this.synth.triggerAttack([newNote], t);
    // Update tracked notes
    const idx = this.currentNotes.indexOf(oldNote);
    this.currentNotes[idx] = newNote;
  }

  /** Sidechain-style volume ducking on the pad.
   *  @param time - Transport time for the duck
   *  @param depth - Duck floor (0-1). Lower = deeper pump. 0.15 = full synthwave, 0.5 = gentle baseline. */
  triggerPulse(time: number, depth = 0.25): void {
    this.pulseGain.gain.cancelScheduledValues(time);
    // Duck: instantly drop volume to the depth floor
    this.pulseGain.gain.setValueAtTime(depth, time);
    // Recovery time scales with depth — deeper duck = longer recovery for audible pump
    const recoveryTau = 0.03 + (1 - depth) * 0.07; // 0.03s (gentle) to 0.10s (deep)
    this.pulseGain.gain.setTargetAtTime(
      1.0,          // full volume (resting state)
      time + 0.005, // start recovery 5ms after duck
      recoveryTau,
    );
  }

  dispose(): void {
    this.stop();
    this.synth.dispose();
    this.saturation?.dispose();
    this.lfoFilter.dispose();
    this.panner?.dispose();
    this.pulseGain.dispose();
    this.volumeGain.dispose();
    this.filterLfo.dispose();
    this.volumeLfo.dispose();
    this.panLfo?.dispose();
  }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export class Player implements PlayerAPI {
  private voices: Map<string, Voice> = new Map();
  private drumPlayers: Tone.Player[] = [];
  private pad: PadSynth | null = null;
  private riser: RiserVoice | null = null;
  private riserGain: Tone.Gain | null = null;
  private riserReverb: Tone.Reverb | null = null;
  private plateReverb: Tone.Reverb | null = null;
  private hallReverb: Tone.Reverb | null = null;
  private compressor: Tone.Compressor | null = null;
  private masterGate: Tone.Gain | null = null;
  private dryBus: Tone.Gain | null = null;
  private plateBus: Tone.Gain | null = null;
  private hallBus: Tone.Gain | null = null;
  private initialized = false;
  private gainNodes: Map<string, Tone.Gain> = new Map();
  private gainDests: Map<string, Tone.ToneAudioNode> = new Map();
  private mutedVoices: Set<string> = new Set();
  private mixLfos: Tone.LFO[] = [];
  private config: EngineConfig | null = null;
  private velocityScale = 1;
  /** Shared ref read by snare per-hit closure — updated in applyEnergy. */
  private snareBrightness = { value: 1 };

  async init(config: EngineConfig): Promise<void> {
    if (this.initialized) return;
    this.config = config;

    // Three-bus FX routing for spatial depth separation:
    //   Dry bus:  kick, hat, snare, bass — tight, punchy, up front
    //   Plate bus: stab/arp — plate reverb (1.5s) + delay, mid-depth
    //   Hall bus:  pad — hall reverb (2.5s), wide, far back
    // All buses → gentle master compressor → masterGate → destination
    this.masterGate = new Tone.Gain(0).toDestination();
    this.compressor = new Tone.Compressor({
      threshold: -18,
      ratio: 2,
      attack: 0.003,
      release: 0.1,
    }).connect(this.masterGate);

    // Dry bus — no reverb, just straight to compressor
    this.dryBus = new Tone.Gain(1).connect(this.compressor);

    // Plate bus — medium reverb for stab/arp spatial depth
    this.plateReverb = new Tone.Reverb({ decay: 1.5, wet: 0.20 }).connect(this.compressor);
    this.plateBus = new Tone.Gain(1).connect(this.plateReverb);

    // Hall bus — long reverb for pad (wide, far back)
    this.hallReverb = new Tone.Reverb({ decay: 2.5, wet: 0.25 }).connect(this.compressor);
    this.hallBus = new Tone.Gain(1).connect(this.hallReverb);

    await Promise.all([this.plateReverb.generate(), this.hallReverb.generate()]);

    // Load drum voices from kit config (sample-based or synth)
    // All drums route to dryBus (tight, punchy, no reverb)
    const loadPromises: Promise<void>[] = [];
    for (const row of config.kit) {
      const gain = new Tone.Gain(1).connect(this.dryBus);
      this.gainNodes.set(row.name, gain);
      this.gainDests.set(row.name, this.dryBus);

      if (row.synthType) {
        // Synthesized drum voice
        if (row.synthType === 'noise-snare') {
          this.voices.set(row.name, createSynthSnare(row.volumeDb, gain, this.snareBrightness));
        } else {
          const synthFactories: Record<string, (volDb: number, dest: Tone.ToneAudioNode) => Voice> = {
            'kick-sweep': createSynthKick,
            'synth-hat': createSynthHat,
            'synth-cymbal': createSynthCymbal,
          };
          const factory = synthFactories[row.synthType];
          if (factory) {
            this.voices.set(row.name, factory(row.volumeDb, gain));
          }
        }
      } else if (row.sample) {
        // Sample-based drum voice
        const { voice, player } = createDrumVoice(row.sample, row.volumeDb, gain);
        this.voices.set(row.name, voice);
        this.drumPlayers.push(player);
        loadPromises.push(
          new Promise<void>((resolve) => {
            if (player.loaded) {
              resolve();
            } else {
              player.buffer.onload = () => resolve();
            }
          }),
        );
      }
    }

    // Bass synth from config — routes to dryBus (tight, punchy)
    const bassGain = new Tone.Gain(1).connect(this.dryBus);
    this.gainNodes.set('bass', bassGain);
    this.gainDests.set('bass', this.dryBus);
    this.voices.set('bass', createBass(config.bass, bassGain));

    // Stab synths — both flavors share the same gain node (one mixer fader)
    // Route to plateBus for medium-depth plate reverb spatial zone
    const stabGain = new Tone.Gain(1).connect(this.plateBus);
    this.gainNodes.set('stab', stabGain);
    this.gainDests.set('stab', this.plateBus);
    this.voices.set('stab', createStab(config.stab, stabGain));
    if (config.stabGroove) {
      this.voices.set(STAB_GROOVE, createStab(config.stabGroove, stabGain));
    }

    // Arp synth — shares stab gain node (one mixer fader for stab+arp)
    if (config.arp) {
      this.voices.set('arp', createStab(config.arp, stabGain));
    }

    // Riser voice — dedicated reverb (2.5s, 60% wet) for tail that bridges loop boundaries.
    // Longer and wetter than plate (1.5s, 20%) so the riser lingers after sources stop.
    this.riserReverb = new Tone.Reverb({ decay: 2.5, wet: 0.6 }).connect(this.compressor);
    await this.riserReverb.generate();
    this.riserGain = new Tone.Gain(1).connect(this.riserReverb);
    this.gainNodes.set('riser', this.riserGain);
    this.gainDests.set('riser', this.riserReverb);
    this.riser = createRiser(this.riserGain);

    // Pad synth from config — routes to hallBus (wide, far back)
    const padGain = new Tone.Gain(1).connect(this.hallBus);
    this.gainNodes.set('pad', padGain);
    this.gainDests.set('pad', this.hallBus);
    this.pad = new PadSynth(config.pad, padGain, config.tempo, BEATS_PER_LOOP);

    // Per-voice mix LFOs — slow volume movement at prime-ratio rates
    const baseFreq = config.tempo / 60 / BEATS_PER_LOOP; // Hz per loop
    const attachMixLfo = (gainNode: Tone.Gain, lfo: MixLfo) => {
      const freq = baseFreq / lfo.rateInLoops;
      const mixLfo = new Tone.LFO({ frequency: freq, min: lfo.min, max: lfo.max, phase: 0 });
      mixLfo.connect(gainNode.gain);
      mixLfo.start();
      this.mixLfos.push(mixLfo);
    };

    for (const row of config.kit) {
      if (row.mixLfo) {
        const gain = this.gainNodes.get(row.name);
        if (gain) attachMixLfo(gain, row.mixLfo);
      }
    }
    if (config.bass.mixLfo) {
      const gain = this.gainNodes.get('bass');
      if (gain) attachMixLfo(gain, config.bass.mixLfo);
    }
    if (config.stab.mixLfo) {
      const gain = this.gainNodes.get('stab');
      if (gain) attachMixLfo(gain, config.stab.mixLfo);
    }

    // Wait for all samples to load
    await Promise.all(loadPromises);

    this.initialized = true;
  }

  dispose(): void {
    for (const voice of this.voices.values()) voice.dispose();
    this.voices.clear();
    this.drumPlayers = [];
    for (const gain of this.gainNodes.values()) gain.dispose();
    this.gainNodes.clear();
    for (const lfo of this.mixLfos) lfo.dispose();
    this.mixLfos = [];
    this.riser?.dispose();
    this.riser = null;
    this.riserGain?.dispose();
    this.riserGain = null;
    this.riserReverb?.dispose();
    this.riserReverb = null;
    this.pad?.dispose();
    this.pad = null;
    this.dryBus?.dispose();
    this.plateBus?.dispose();
    this.hallBus?.dispose();
    this.plateReverb?.dispose();
    this.hallReverb?.dispose();
    this.compressor?.dispose();
    this.masterGate?.dispose();
    this.dryBus = null;
    this.plateBus = null;
    this.hallBus = null;
    this.plateReverb = null;
    this.hallReverb = null;
    this.compressor = null;
    this.masterGate = null;
    this.config = null;
    this.initialized = false;
  }

  play(sounds: ScheduledSound[], time: number): void {
    if (!this.initialized || sounds.length === 0) return;
    const beatDuration = 60 / Tone.getTransport().bpm.value;
    for (const s of sounds) {
      // Pad sidechain pulse — not a voice, just modulation. velocity encodes depth (0-1).
      if (s.sound === 'pad-pulse') {
        const depth = s.velocity > 0 ? s.velocity : 0.25;
        this.pulsePadFilter(time + s.beatOffset * beatDuration, depth);
        continue;
      }
      const voice = this.voices.get(s.sound);
      if (!voice) continue;
      voice.trigger(s.velocity * this.velocityScale, s.duration, time + s.beatOffset * beatDuration, s.note, s.notes);
    }
  }

  stopAll(): void {
    // Stop drum sample playback
    for (const player of this.drumPlayers) {
      player.stop();
    }
    // Release synth voices
    for (const voice of this.voices.values()) {
      voice.stop?.();
    }
    this.pad?.stop();
    this.riser?.stop();
    // Ramp master gate to zero — kills everything including reverb tails
    if (this.masterGate) {
      const now = Tone.now();
      this.masterGate.gain.cancelScheduledValues(now);
      this.masterGate.gain.setValueAtTime(this.masterGate.gain.value, now);
      this.masterGate.gain.linearRampToValueAtTime(0, now + 0.015);
    }
  }

  /**
   * Fade out over the given duration (seconds).
   * Ramps master gate to zero — the pad continues playing through its natural
   * envelope under the fade. Does NOT call pad.stop() so a freshly attacked
   * pad chord can ring out fully.
   */
  fadeOut(duration: number): Promise<void> {
    // Pad LFOs should already be stopped by prepareFinalPad() before the final chord attack.
    // Ramp master gate to zero — catches pad, reverb tails, delay tails
    if (this.masterGate) {
      const now = Tone.now();
      this.masterGate.gain.cancelScheduledValues(now);
      this.masterGate.gain.setValueAtTime(this.masterGate.gain.value, now);
      // Exponential ramp sounds natural (matches human hearing).
      // Can't ramp to exactly 0, so ramp to near-zero then set to 0.
      this.masterGate.gain.exponentialRampToValueAtTime(0.001, now + duration);
      this.masterGate.gain.setValueAtTime(0, now + duration + 0.01);
    }
    return new Promise((resolve) => setTimeout(resolve, duration * 1000 + 50));
  }

  /** Ramp master gate up for clean start (no pop) */
  private openMasterGate(): void {
    if (this.masterGate) {
      const now = Tone.now();
      this.masterGate.gain.cancelScheduledValues(now);
      this.masterGate.gain.setValueAtTime(0, now);
      this.masterGate.gain.linearRampToValueAtTime(1, now + 0.015);
    }
  }

  startPad(): void {
    this.pad?.start();
  }

  /**
   * Apply energy level to mix parameters. Called at loop boundaries.
   * Energy 0 = intimate/quiet, energy 1 = full/loud.
   * Interpolates between designed min/max for each parameter.
   * Optional variationParams shift the ranges per seed.
   */
  applyEnergy(energy: number, vp?: VariationParams): void {
    // Velocity multiplier — scales all drum and companion velocities
    this.velocityScale = lerp(0.25, 1.0, energy);

    // Pad filter LFO range — very narrow/dark at low energy, wide/bright at high
    // Variation shifts the range: negative offset = warmer (lower freqs), positive = brighter
    const padOffset = vp?.padLfoOffset ?? 0;
    const padMinBase = lerp(1000, 150, energy);
    const padMaxBase = lerp(1400, 3000, energy);
    // Apply offset: ±400Hz on min, ±600Hz on max (scaled by offset -1..+1)
    this.pad?.setFilterRange(
      Math.max(80, padMinBase + padOffset * 400),
      Math.max(200, padMaxBase + padOffset * 600),
    );

    // Hat brightness — bandpass center sweeps 7kHz (dark) → 12kHz (bright) with energy
    // Drum brightness offset from variation seed shifts the curve ±0.15
    const drumOffset = vp?.drumBrightnessOffset ?? 0;
    const hatVoice = this.voices.get('sparkle') ?? this.voices.get('hat');
    if (hatVoice?.filter) {
      hatVoice.filter.frequency.value = lerp(7000, 12000, Math.max(0, Math.min(1, energy + drumOffset)));
    }

    // Snare brightness — per-hit bandpass frequencies scale 0.7× (dark) → 1.2× (bright)
    this.snareBrightness.value = lerp(0.7, 1.2, Math.max(0, Math.min(1, energy + drumOffset)));

    // Bass saturation wet — clean at low energy, gritty at peak
    const bassVoice = this.voices.get('bass');
    if (bassVoice?.saturation) {
      (bassVoice.saturation as unknown as { wet: Tone.Signal<'normalRange'> }).wet.value =
        lerp(0.15, 0.5, energy);
    }

    // Delay feedback + wet on stab/arp voices — almost dry at low, washy at peak
    // Variation offsets feedback ±0.1
    const fbOffset = vp?.delayFeedbackOffset ?? 0;
    const delayFeedback = Math.max(0, Math.min(0.6, lerp(0.08, 0.40, energy) + fbOffset));
    const delayWet = lerp(0.08, 0.35, energy);
    for (const voice of this.voices.values()) {
      if (voice.delay) {
        voice.delay.feedback.value = delayFeedback;
        voice.delay.wet.value = delayWet;
      }
    }

    // Reverb wet — nearly dry at low, deep at peak
    const reverbWet = lerp(0.05, 0.30, energy);
    if (this.plateReverb) this.plateReverb.wet.value = reverbWet;
    if (this.hallReverb) this.hallReverb.wet.value = reverbWet;
  }

  /** Apply stab filter cutoff multiplier from variation params. */
  applyStabFilterMul(mul: number): void {
    if (mul === 1) return;
    for (const voice of this.voices.values()) {
      if (voice.filter) {
        const base = voice.filter.frequency.value as number;
        voice.filter.frequency.value = Math.max(500, Math.min(8000, base * mul));
      }
    }
  }

  /** Apply delay time variant from variation params. Changes delay rhythm feel. */
  applyDelayTimeVariant(variant: string): void {
    const seconds = Tone.Time(variant).toSeconds();
    for (const voice of this.voices.values()) {
      if (voice.delay) {
        voice.delay.delayTime.value = seconds;
      }
    }
  }

  /** Start a riser sweep. Called once at riser startCol. */
  startRiser(type: 'up' | 'down', durationSec: number, volume: number, params: RiserParams, time?: number): void {
    this.riser?.start(type, durationSec, volume, params, time);
  }

  /** Stop any active riser (e.g. on song stop). */
  stopRiser(time?: number): void {
    this.riser?.stop(time);
  }

  /** Prepare the pad for the final sustaining chord — stop LFOs and open filter. */
  prepareFinalPad(): void {
    this.pad?.stopLfos();
    // Set filter to a warm, open position — not full brightness, but not muffled
    this.pad?.setFilterFrequency(1800);
  }

  changePadChord(notes: string[], time?: number): void {
    this.pad?.changeChord(notes, time);
  }

  shiftPadTopNote(oldNote: string, newNote: string, time?: number): void {
    this.pad?.shiftTopNote(oldNote, newNote, time);
  }

  setTempo(tempo: number): void {
    this.pad?.setTempo(tempo, BEATS_PER_LOOP);
    // Update tempo-synced parameters on all voices (delay times etc.)
    for (const voice of this.voices.values()) {
      voice.setTempo?.(tempo);
    }
  }

  /** Pulse the pad filter (triggered by hat hits) */
  pulsePadFilter(time: number, depth?: number): void {
    this.pad?.triggerPulse(time, depth);
  }

  /** Play sounds immediately for cell click preview.
   *  beatOffset is in quarter-note units (same as play()), converted using current tempo. */
  triggerPreview(sounds: ScheduledSound[]): void {
    if (!this.initialized || sounds.length === 0) return;
    this.openMasterGate();
    const now = Tone.now();
    const beatDuration = 60 / (this.config?.tempo ?? 120);
    for (const s of sounds) {
      if (s.sound === 'pad-pulse') continue; // no sidechain in preview
      const voice = this.voices.get(s.sound);
      if (!voice) continue;
      voice.trigger(s.velocity, s.duration, now + s.beatOffset * beatDuration, s.note, s.notes);
    }
  }

  setVolume(name: string, value: number): void {
    const gain = this.gainNodes.get(name);
    if (gain) {
      gain.gain.value = value;
    }
  }

  /** Mute a voice — disconnects its gain and tracks mute state */
  mute(name: string): void {
    this.mutedVoices.add(name);
    const gain = this.gainNodes.get(name);
    if (gain) gain.disconnect();
  }

  /** Unmute a voice — reconnects its gain */
  unmute(name: string): void {
    this.mutedVoices.delete(name);
    const gain = this.gainNodes.get(name);
    const dest = this.gainDests.get(name);
    if (gain && dest) {
      try { gain.connect(dest); } catch { /* already connected */ }
    }
  }

  async startTransport(tempo: number): Promise<void> {
    this.openMasterGate();
    const transport = Tone.getTransport();
    transport.bpm.value = tempo;
    transport.start();
  }

  stopTransport(): void {
    Tone.getTransport().stop();
    Tone.getTransport().position = 0;
  }

  pauseTransport(): void {
    Tone.getTransport().pause();
  }

  resumeTransport(): void {
    Tone.getTransport().start();
  }
}
