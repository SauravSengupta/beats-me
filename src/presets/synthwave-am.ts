import type { Preset, Chord, ArrangementStep } from '../lib/types';

/**
 * Synthwave preset in A minor.
 *
 * 4 compositional layers (not 6 drum rows):
 *   Row 0 — THE SPARKLE (◇): melodic/textural events (arp — future)
 *   Row 1 — THE RHYTHM  (∙): hats + pad sidechain pump
 *   Row 2 — THE GROOVE  (◻): snare/clap backbeat
 *   Row 3 — THE PULSE   (▼): kick + bass
 *
 * A-section: Am → F → Dm → G (settled, natural minor)
 */
const synthwaveAm: Preset = {
  name: 'Synthwave Am',
  tempo: 120,

  // Harmony — A natural minor
  scale: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  chordProgression: [
    { name: 'Am', root: 'A2', fifth: 'E2', padVoicing: ['A2', 'E3', 'B3'], padTopAlt: 'C4', stabVoicing: ['A3', 'E4', 'B4'], stabTopAlt: 'C5' },
    { name: 'F',  root: 'F2', fifth: 'C3', padVoicing: ['F2', 'C3', 'G3'], padTopAlt: 'A3', stabVoicing: ['F3', 'C4', 'G4'], stabTopAlt: 'A4' },
    { name: 'Dm', root: 'D2', fifth: 'A2', padVoicing: ['D2', 'A2', 'E3'], padTopAlt: 'F3', stabVoicing: ['D3', 'A3', 'E4'], stabTopAlt: 'F4' },
    { name: 'G',  root: 'G2', fifth: 'D3', padVoicing: ['G2', 'D3', 'A3'], padTopAlt: 'B3', stabVoicing: ['G3', 'D4', 'A4'], stabTopAlt: 'B4' },
  ],

  // Kit — 4 rows, heaviest at bottom (row 3 = kick, row 0 = sparkle)
  kit: [
    // Row 0 — THE SPARKLE: synth cymbal + arp cascade
    {
      name: 'sparkle',
      shape: '◇',
      voiceProbKey: 'sparkle',
      synthType: 'synth-cymbal',
      volumeDb: -5,
      humanize: 0.08,
      color: { color: '#00e5ff', glowColor: 'rgba(0, 229, 255, 0.4)' },
      mixLfo: { min: 0.6, max: 1.0, rateInLoops: 11 },  // very slow drift
      arp: {
        soundKey: 'arp',
        notesPerArp: 4,         // root→5th→top→5th ping-pong
        baseVelocity: 0.7,
        velocityDecay: 0.85,    // 0.7 → 0.60 → 0.50 → 0.43 (stays above echo level)
        probability: 0.90,      // ~1 in 10 cells = cymbal only, no arp cascade
        humanize: 0.08,         // ±8% per-note velocity variation (matches drum humanize)
        offbeatVelocity: 0.8,   // offbeat arps slightly quieter (gentler than stab's 0.6)
      },
    },
    // Row 1 — THE RHYTHM: synth hats + pad sidechain pump + chord stab
    {
      name: 'rhythm',
      shape: '◯',
      voiceProbKey: 'rhythm',
      synthType: 'synth-hat',
      volumeDb: 6,
      humanize: 0.1,
      color: { color: '#00ff88', glowColor: 'rgba(0, 255, 136, 0.4)' },
      mixLfo: { min: 0.7, max: 1.0, rateInLoops: 5 },   // hats pull back then return
      stab: { soundKey: 'stab', velocity: 0.5, probability: 0.65, offbeatVelocity: 0.6 },
    },
    // Row 2 — THE GROOVE: synth snare with gated reverb + bass fifth + groove stab
    {
      name: 'groove',
      shape: '◻',
      voiceProbKey: 'groove',
      synthType: 'noise-snare',
      volumeDb: 12,
      humanize: 0.07,
      color: { color: '#b44dff', glowColor: 'rgba(180, 77, 255, 0.4)' },
      mixLfo: { min: 0.85, max: 1.0, rateInLoops: 7 },  // snare subtly shifts
      stab: { soundKey: 'stab-groove', velocity: 0.50, probability: 0.80 },
      bass: {
        noteType: 'fifth',
        soundKey: 'bass',
        probability: 0.85,
        velocity: 0.50,
        approachWeights: [1, 0, 0, 0, 0],
      },
    },
    // Row 3 — THE PULSE: synth kick (sine sweep) + bass
    {
      name: 'pulse',
      shape: '▽',
      voiceProbKey: 'pulse',
      synthType: 'kick-sweep',
      volumeDb: 6,
      color: { color: '#ff4444', glowColor: 'rgba(255, 68, 68, 0.4)' },
      bass: {
        noteType: 'root',
        soundKey: 'bass',
        probability: 1.0,
        velocity: 0.60,
        approachWeights: [0.65, 0.13, 0.10, 0.07, 0.05],
      },
    },
  ],

  // Pad — pushed for synthwave (wider, louder, more LFO sweep)
  pad: {
    shape: '≋',
    oscillator: 'fatsawtooth',
    spread: 50,
    count: 5,
    volumeDb: -15,
    filterLfoRange: [200, 2500],
    volumeLfoRange: [0.6, 1.0],
    panLfoRange: [-0.3, 0.3],
    panLfoRateMul: 0.5,
    attack: 0.3,
    release: 1.2,
    // Hybrid sidechain pump: implicit quarter-note baseline + kick/snare reinforcement
    sidechain: {
      baselineDepth: 0.5,     // gentle quarter-note breathing (always, even empty grid)
      kickOnBeatDepth: 0.15,  // full synthwave pump when kick on quarter note
      kickOffBeatDepth: 0.3,  // medium pump for offbeat kicks
      snareDepth: 0.4,        // light duck on snare hits
    },
  },

  // Bass — saw + sub, filter envelope "bwow" + portamento glide + chorus (saw only)
  bass: {
    shape: '∿',
    oscillator: 'sawtooth',
    filterCutoffHz: 500,
    volumeDb: 0,
    filterEnvStart: 2000,   // per-note sweep start (Hz)
    filterEnvEnd: 300,      // per-note sweep end (Hz)
    filterEnvDecay: 0.15,   // sweep time (seconds)
    glideTime: 0.05,        // portamento between recent notes (seconds)
    saturationWet: 0.4,     // stronger harmonics for laptop speakers
    chorusDelayMs: 3,       // subtle Juno-style chorus on saw osc (sub stays dry/mono)
    chorusRate: 0.5,        // slow LFO rate (Hz)
    chorusWet: 0.2,         // 20% wet — width without mud
    mixLfo: { min: 0.8, max: 1.0, rateInLoops: 4 },  // bass weight ebbs and flows
  },

  // Groove stab — warm, dry, lower voicing (reinforces snare backbeat)
  stabGroove: {
    shape: '⟁',
    oscillator: 'square',
    filterCutoffHz: 2200,     // brighter for stab voicing — distinct from hat stab's 3000
    volumeDb: -4,             // present but not competing with the snare
    attack: 0.003,
    decay: 0.35,              // rings alongside the gated snare reverb
    sustain: 0.12,            // audible body without the old blarp
    release: 0.25,
    // No delay — dry and punchy
  },

  // Arp — saw + delay, tighter envelope for individual note articulation
  arp: {
    shape: '◇',             // shares sparkle's diamond shape in mixer
    oscillator: 'sawtooth',
    filterCutoffHz: 4000,   // brighter at higher octave — let the shimmer through
    volumeDb: -5,           // pulled back — still prominent but doesn't mask stab/hat
    attack: 0.003,
    decay: 0.15,            // shorter than stab — notes need to articulate
    sustain: 0.05,          // near-zero: percussive pluck character
    release: 0.15,
    delayTime: '8n.',       // dotted-8th — turns 4 notes into ~12
    delayFeedback: 0.30,
    delayWet: 0.30,
    mixLfo: { min: 0.6, max: 1.0, rateInLoops: 11 },  // matched to sparkle drum
  },

  // Stab — brighter, more delay for synthwave arps
  stab: {
    shape: '⟁',
    oscillator: 'sawtooth',
    filterCutoffHz: 3000,
    volumeDb: -8,
    attack: 0.003,
    decay: 0.2,
    sustain: 0.1,
    release: 0.3,
    delayTime: '8n.',
    delayFeedback: 0.35,
    delayWet: 0.30,
    mixLfo: { min: 0.6, max: 1.0, rateInLoops: 3 },  // stabs trade prominence with other voices
  },
};

// ---------------------------------------------------------------------------
// B-section chords — brighter, with harmonic minor tension on E
// ---------------------------------------------------------------------------

export const bChords: Record<string, Chord> = {
  C: { name: 'C', root: 'C3', fifth: 'G3', padVoicing: ['C2', 'G2', 'D3'], padTopAlt: 'E3', stabVoicing: ['C3', 'G3', 'D4'], stabTopAlt: 'E4' },
  E: { name: 'E', root: 'E2', fifth: 'B2', padVoicing: ['E2', 'B2', 'G#3'], stabVoicing: ['E3', 'B3', 'G#4'] },
  Em: { name: 'Em', root: 'E2', fifth: 'B2', padVoicing: ['E2', 'B2', 'G3'], padTopAlt: 'D3', stabVoicing: ['E3', 'B3', 'G4'], stabTopAlt: 'D4' },
};

// ---------------------------------------------------------------------------
// Shorthand chord references
// ---------------------------------------------------------------------------

const Am = synthwaveAm.chordProgression[0];
const F  = synthwaveAm.chordProgression[1];
const Dm = synthwaveAm.chordProgression[2];
const G  = synthwaveAm.chordProgression[3];
const C_ = bChords.C;
const E_ = bChords.E;

// ---------------------------------------------------------------------------
// Arrangement helpers
// ---------------------------------------------------------------------------

/** All drums full, all synths at designed probability */
const FULL: Pick<ArrangementStep, 'sparkle' | 'rhythm' | 'groove' | 'pulse' | 'pad' | 'bass' | 'stab' | 'stabGroove' | 'arp'> = {
  sparkle: 1, rhythm: 1, groove: 1, pulse: 1,
  pad: 1, bass: 1, stab: 1, stabGroove: 1, arp: 1,
};

/** All drums silent, synths at given multiplier */
const SILENT_DRUMS = { sparkle: 0, rhythm: 0, groove: 0, pulse: 0 } as const;

/** Keep all voice probs from previous step */
const PREV = {
  sparkle: 'previous', rhythm: 'previous', groove: 'previous', pulse: 'previous',
  pad: 'previous', bass: 'previous', stab: 'previous', stabGroove: 'previous', arp: 'previous',
} as const;

// ---------------------------------------------------------------------------
// Arrangement — 16 loops + final beat ≈ 65 seconds at 120 BPM
//
// INTRO (2)  F E            — pad + sparse stabs/arps, drums silent, resolves to Am
// A1    (4)  Am F Dm G      — full drums, synth parts gradually increase
// A2    (4)  Am F Dm G      — full everything, drop before B
// B     (4)  C F Dm E       — climax, all layers max, E chord is the peak
// A3    (2)  Am G           — stripped resolution, same texture through to final
// FINAL (beat) Am           — inherits A3 texture, tails ring out
// ---------------------------------------------------------------------------

synthwaveAm.arrangement = {
  steps: [
    // ── INTRO ─────────────────────────────────────────────────────────────
    // Drums silent, pad always, sparse companion sounds from cells.
    // F→E resolves to Am on A1 — the listener is pulled into the song.

    { chord: F, energy: 0.3, label: 'intro',
      ...SILENT_DRUMS,
      pad: 1, bass: 0, stab: 0.4, stabGroove: 0, arp: 0.3 },

    { chord: E_, energy: 0.35,
      ...SILENT_DRUMS,
      pad: 1, bass: 0, stab: 0.5, stabGroove: 0, arp: 0.4,
      riser: 'up',
      fill: 'snare', fillWeight: 'light' },  // gentle nudge into A1

    // ── A1: BUILDING ──────────────────────────────────────────────────────
    // Full drums from here on. Synth companions ramp up gradually.

    { chord: Am, energy: 0.45, label: 'A',
      ...FULL, bass: 0.6, stab: 0.4, stabGroove: 0.4, arp: 0.2 },

    { chord: F, energy: 0.5,
      ...FULL, bass: 0.7, stab: 0.6, stabGroove: 0.6, arp: 0.4 },

    { chord: Dm, energy: 0.6,
      ...FULL, bass: 0.8, stab: 0.7, stabGroove: 0.7, arp: 0.6 },

    { chord: G, energy: 0.7,
      ...FULL,
      fill: 'snare', fillWeight: 'light' },  // continuity marker, not a section change

    // ── A2: COMMITTED ─────────────────────────────────────────────────────
    // Full everything for 3 loops, then drop before B.

    { chord: Am, energy: 0.7, label: 'A',
      ...FULL },

    { chord: F, energy: 0.75,
      ...PREV },

    { chord: Dm, energy: 0.8,
      ...PREV },

    // THE DROP — contrast makes the B hit harder
    { chord: G, energy: 0.35,
      ...SILENT_DRUMS, pulse: 0.5,  // kick at 50%, rest silent
      pad: 1, bass: 0.3, stab: 0, stabGroove: 0, arp: 0,
      riser: 'up',
      fill: 'snare' },

    // ── B: CLIMAX ─────────────────────────────────────────────────────────
    // Full 4 chords — C→F→Dm→E. The E chord's G# is the emotional peak.

    { chord: C_, energy: 0.9, label: 'B',
      ...FULL },

    { chord: F, energy: 0.95,
      ...PREV },

    { chord: Dm, energy: 0.95,
      ...PREV },

    // THE MOMENT — G# tension, maximum everything.
    // Down-riser + snare fill signal "this is ending" before the hard cut to resolution.
    { chord: E_, energy: 1.0,
      ...PREV,
      riser: 'down',
      fill: 'snare' },

    // ── A3: RESOLUTION ────────────────────────────────────────────────────
    // Hard contrast from B peak. Not winding down — arriving home.
    // Same texture carries through to final beat.

    { chord: Am, energy: 0.35, label: 'A',
      ...SILENT_DRUMS, pulse: 1,  // kick stays
      pad: 1, bass: 0.5, stab: 0.3, stabGroove: 0.3, arp: 0 },

    { chord: G, energy: 0.3,
      ...PREV },  // same texture → final beat inherits this
  ],
  finalBeat: Am,
};

export default synthwaveAm;
