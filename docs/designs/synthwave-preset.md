# Synthwave Preset — Design Document

> The first externally-visible preset. Replaces the diagnostic "EDM Am" preset
> as the default experience. Goal: a non-musician places 10 cells and hears
> something they want to show someone.

---

## Why Synthwave

- **Forgiving of sparse grids.** Even 4 kicks sound intentional. EDM needs density; lo-fi needs specific jazzy chords; synthwave thrives on space.
- **Sonically rich from few elements.** Detuned pads + arpeggiated stabs + gated reverb snare fill a mix without needing 12 layers.
- **Character lives in the mid-range.** EDM needs sub bass you feel physically; synthwave's defining sounds (saw pads, gated snares, arps) reproduce well on laptop speakers and phone speakers.
- **The UI already looks like it.** Dark background, neon per-row colors, glowing cells — that's synthwave visual language.
- **The architecture already supports the signature sounds.** LFO-modulated pads, delay on stabs, chord progressions. The current preset just uses these features timidly.

---

## Core Design Change: 4 Compositional Layers (not 6 drum rows)

The grid stops being a drum machine and becomes a compositional tool. Rows represent layers of a mix, not individual instruments. The engine interprets each layer with increasing creative freedom from bottom to top.

### Drum Determinism Principle

**Placed cell = drum hit plays. Always. No exceptions.**

- A placed cell's primary drum sound (kick, snare, hat, cymbal) fires every time, at full velocity. No probability gating, no random skipping.
- An empty cell never generates a drum hit. Ghost bass approach tones (Scheduler-generated on empty "and" beats) are the one additive exception — they fill space naturally without replacing user-placed cells.
- **Companion sounds** (bass, stab, pad pulse) **can** be probabilistic. These are harmonic/textural layers that ride on top of the drum — they add richness when they fire and leave space when they don't. The user's intentionality lives in the drum placement; the engine's creativity lives in what it layers on top.

This is already true in the current interpreter (`interpreters.ts`): the primary sound always emits for `value > 0`, and all `probability` checks only gate companion sounds.

**Velocity humanization:** ✅ Implemented. Per-row `humanize` field (0-1) adds ±amount seeded PRNG variation to drum hit velocity. Same grid = same velocity pattern (deterministic). Kick (row 3) has no humanization — it's the anchor. Other rows: hat ±10%, sparkle ±8%, snare ±7%. Applied in the interpreter before companion sound generation.

### Quick Reference — What's On Each Row

All row numbers match code (0-indexed). Visual order is top-to-bottom (row 0 = top, row 3 = bottom).

| Row (code idx) | Name | Shape | Color | Primary Sound | Companion Sound(s) | Behavior |
|----------------|------|-------|-------|---------------|---------------------|----------|
| 0 (top) | THE SPARKLE | ◇ | cyan `#00e5ff` | Synth cymbal (inharmonic square osc, -5dB) | Arp (4-note ascending/descending from chord voicing, 16th spacing, velocity decay 0.85×) | ✅ Arp system implemented. Probability 90%, downbeats ascend, offbeats descend (×0.8 vel). Vel humanize ±8%. |
| 1 | THE RHYTHM | ◯ | green `#00ff88` | Synth hat (+6dB) | Stab (saw, 3kHz LP, dotted-8th delay 35% fb) | Stab probability-gated (65%), offbeat vel ×0.6, base vel 0.5. Vel humanize ±10%. |
| 2 | THE GROOVE | ◻ | purple `#b44dff` | Noise snare (gated reverb, +12dB) | Groove stab (square, dry, stabVoicing, 2200Hz LP, 80% prob, vel 0.50) + Bass fifth (85% prob, vel 0.5) | Downbeats = snare, offbeats = clap. Vel humanize ±7%. |
| 3 (bottom) | THE PULSE | ▽ | red `#ff4444` | Kick sweep (sine, +6dB) | Bass root (100% prob, vel 0.6, weighted approach) | Bass always fires with kick. No humanize (rock solid). |

**Global layers** (always playing, not tied to a single row):

| Sound | Shape | Oscillator | Key Params | Notes |
|-------|-------|-----------|------------|-------|
| Pad | ≋ | Fat sawtooth (5 voices, 50¢ spread) | -15dB, filter LFO 200–2500Hz, vol LFO 0.6–1.0, pan LFO ±0.3 | Breathes slowly (1 cycle = 2 loops). Ducked by implicit quarter-note + kick/snare sidechain. |
| Bass | ∿ | Sawtooth + sub | 0dB, filter env 2000→300Hz / 150ms, 50ms glide, 40% saturation, chorus 3ms/0.5Hz/20% (saw only) | Triggered by row 2 and row 3 companion slots. Per-hit filter "bwow". Sub stays dry/mono. |
| Hat Stab | ⟁ | Sawtooth | -8dB, 3kHz LP, dotted-8th delay (35% fb, 30% wet) | Triggered by row 1. Bright, echoing. Uses stabVoicing. |
| Groove Stab | ⟁ | Square | -4dB, 2200Hz LP, no delay (dry) | Triggered by row 2. Warm, punchy. Uses padVoicing (via `voicingSource: 'pad'`). Re-tuned for audibility. |
| Arp | ⟁ | Sawtooth | -2dB, 4kHz LP, dotted-8th delay (30% fb, 30% wet) | Triggered by row 0. 4-note ascending/descending arp from stabVoicing+1oct. |

### The Causality Gradient

Every row plays **on or near** where the user clicked. The gradient is how much *extra* the engine adds around that point:

| Layer | Control model | User expectation |
|-------|--------------|-----------------|
| **Row 3 (bottom)** | Literal | "I placed it, it plays there" |
| **Row 2** | Mostly literal | "It plays there, but the sound might vary" |
| **Row 1** | Suggestive | "It plays near there, and fills in around it" |
| **Row 0 (top)** | Generative | "It launches something starting there" |

**Principle:** The user must always feel causality. Moving a cell must audibly change the output. The top rows are loose, not random — output is anchored to placement, just richer.

### Row 0 — THE SPARKLE (◇)

**What the user controls:** Where melodic/textural events launch from.

**Preview on click:** Cymbal hit + 4-note arp cascade from first chord (Am). Ascending on even columns, descending on odd — matches playback behavior. Compressed timing (60ms spacing). The delay tail extends it further. One click → ~12 audible events. This is the hook.

**During playback:** ✅ Arp system implemented.
- Each cell triggers a **4-note arp sequence** starting on that beat:
  - **Notes derived from the current chord voicing**, one octave above `stabVoicing`: root+12, 5th+12, top+12, root+24 — 4 distinct pitches, sorted by pitch
  - **Direction:** ascending on downbeats (even columns), descending on offbeats (odd columns)
  - **Note spacing:** one per 16th note (0.25 beatOffset), so a 4-note arp spans 1 beat
  - **Velocity decay:** 0.85× per note (e.g., base → 0.85 → 0.72 → 0.61)
  - **Truncation:** arp notes near a chord boundary are omitted to prevent cross-chord dissonance
  - Delay effect (dotted 8th, ~30% feedback) extends the cascade further
- **Probability gate:** ✅ Implemented. 90% probability — ~1 in 10 cells plays cymbal only (no arp cascade). Creates breathing room. Cymbal drum hit always fires regardless.
- **Offbeat velocity:** ✅ Implemented. Offbeat (odd column) arps get 0.8× velocity multiplier — subtler accent than stab's 0.6×, since the arp's own decay curve already creates natural fade.
- **Velocity humanize:** ✅ Implemented. ±8% per-note variation via seeded PRNG (matches cymbal drum humanize). Applied on top of the decay curve so repeated loops shimmer slightly differently.
- Light metallic percussion hit on the placed cell (cymbal-like synth, low velocity)
- Two nearby cells: their arps may overlap — this sounds good because they're in the same chord. The overlapping creates thicker texture, not dissonance.
- **Voicing drift:** ✅ Implemented. The arp's top note (+12 from `stabDefaultTop`) follows the pad's drift state — when `padUsingAlt` is true, the top note swaps to `stabAltTop+12`. All harmonic voices (pad, stabs, arp) shift as a unit.

**Arp voice** (`stab-arp`) — separate from hat stab and groove stab, sharing the `stabGain` fader: ✅ Implemented.
- **Oscillator:** Saw wave
- **Filter:** Lowpass at 4kHz
- **Volume:** -2dB
- **Envelope:** Tight — 3ms attack, 150ms decay, 5% sustain, 150ms release
- **Delay:** Dotted 8th, 30% feedback, 30% wet

**Why this works for non-musicians:** One cell → 8+ audible notes (4 arp + delay echoes). The ratio of input to output is highest here. A user puts 3 cells in row 0 and suddenly has a melody they didn't compose but feel ownership of, because they chose *when* it happens.

### Row 1 — THE RHYTHM (◯)

**What the user controls:** Where rhythmic texture concentrates.

**Preview on click:** Hat tick + stab chord (first chord stabVoicing). The dotted-8th delay tail on the stab gives a taste of the echo effect.

**During playback:**
- Primary hit: hat sound plays on the placed cell (always — the anchor)
- **No ghost hat fills.** Ghost hats were considered but skipped — stab delay + arps already fill the rhythmic texture role, and ghost hats would violate the drums-are-1:1-with-input principle.
- **Stab layer:** ✅ Implemented. Stab triggers alongside the hat on this row (hat+stab complement each other — different frequency bands). Probability-gated via seeded PRNG (65% default), with offbeat velocity reduction (odd columns multiplied by `offbeatVelocity`, default 0.6). Moved here from the clap row in the old 6-row preset because hat occupies high frequencies while stab sits in the mid-range.
- Note: hat hits do NOT duck the pad. Pad sidechain is implicit quarter-note + kick/snare driven (see FX Routing).

### Row 2 — THE GROOVE (◻)

**What the user controls:** Where the backbeat lives.

**Preview on click:** Snare hit with gated reverb tail + groove stab chord (first chord stabVoicing). The gated reverb is the defining synthwave drum sound.

**During playback:**
- Primary hit: always plays exactly where placed
- Timbre selection based on position:
  - Downbeats (columns 0, 2, 4, ...): snare (noise burst + sine body, gated reverb)
  - Offbeats (columns 1, 3, 5, ...): clap (layered noise bursts, tight room verb)
- Bass reinforcement: fifth of current chord at 0.5 velocity (85% probability via seeded PRNG, `approachWeights: [1,0,0,0,0]`) — ✅ implemented. Originally from the 6-row preset's snare row; restored to the groove row after the 4-row migration.
- **No hits added or removed.** Grid placement = grid playback. Only the timbre varies.

**Why gated reverb:** It's the Phil Collins / synthwave signature sound. A big reverb tail (~500ms) that cuts off abruptly via a noise gate. Makes a thin snare sound massive. This single effect is probably the most genre-defining choice in the whole preset.

### Row 3 — THE PULSE (▼)

**What the user controls:** Where the kick and bass land.

**Preview on click:** Kick thud + bass note (root of first chord A2, with filter envelope "bwow" sweep).

**During playback:**
- Synthesized kick (pitch-swept sine 180Hz → 50Hz, ~80ms) — NOT a sample
- Bass: saw oscillator with filter envelope per note (cutoff sweeps 2kHz → 300Hz on each trigger)
- Sub: sine one octave below, same envelope
- On "and" columns with adjacent kick hits: diatonic approach tones via seeded PRNG (existing voice-leading system)
- **Ghost bass approach tones:** ✅ Implemented. On empty "and" beats (odd columns with no user cell) that immediately precede a downbeat kick, the Scheduler automatically emits a quiet bass note — a soft approach into the coming kick. 55% probability per eligible beat (seeded PRNG), velocity = 70% of the normal kick companion velocity. Uses the same approach tone weights as the explicit voice-leading system (same chord tones, same PRNG seed structure). This adds rhythmic motion and harmonic preparation without the user placing any cells — the bass line fills space naturally when kicks land on downbeats.
- Portamento/glide between bass notes (50ms)
- Bass velocity follows kick placement 1:1

**Mapping:** Completely literal. Cell on beat 3 = kick + bass on beat 3. No added/removed hits. Ghost approach tones are the one additive exception — they appear on empty "and" beats only, never on user-placed cells.

---

## Sound Design

### Synthesized Drums (no samples)

Every drum voice is synthesized via Tone.js. This eliminates sample management, makes every preset sonically distinct, and enables runtime parameter changes (e.g., density → darker kicks).

**Kick (`kick-sweep`):**
- Pitched sine sweep: 180Hz → 45Hz over 80ms (exponential ramp)
- Transient click: white noise burst (8ms), highpassed at 1kHz, gain 0.6
- Independent envelopes: body decays over 250ms, click decays over 5ms
- Per-hit gain nodes — overlapping kicks decay independently
- No reverb on kick (stays tight and punchy)

**Snare (`noise-snare`):**
- Body: sine at 200Hz with pitch sweep → 150Hz over 70ms, fast 100ms decay
- Noise rattle: white noise, bandpass with filter sweep 5kHz → 2kHz over 150ms, 200ms decay
- Gated reverb tail: `Tone.Reverb` (1.5s decay, 100% wet), gain held at 70% for 250ms then hard linear cut to 0 over 20ms
- Per-hit gain+filter nodes — independent envelopes, MAX_HITS=4 polyphony

**Hat (`synth-hat`):**
- 6 square wave oscillators at inharmonic ratios [2, 3, 4.16, 5.43, 6.79, 8.21] × 40Hz fundamental
- Shared filter chain: bandpass 10kHz → highpass 7kHz (Sonoport reference order)
- Per-hit gain nodes — overlapping hats decay independently (no envelope clobbering on fast 16ths)
- Exponential decay to 0.01 over 50ms
- HitPool(4) polyphony cap, auto-dispose after 200ms
- Based on Sonoport Web Audio synthesis guide (Joe Sullivan's technique)

**Cymbal (`synth-cymbal`):**
- Single persistent white noise source split to 3 filter bands:
  - Attack band: bandpass 12kHz → 8kHz sweep, 80ms decay (bright "tss" transient)
  - Body band: bandpass 5kHz → highpass 8kHz → 5kHz sweep, 0.8s decay (metallic shimmer)
  - Wash band: highpass 10kHz → 4kHz sweep, 1.8s decay (airy sizzle tail)
- Overall hit envelope: 2.0s exponential decay
- Per-hit gain+filter nodes — overlapping cymbal hits ring independently (like real cymbals)
- MAX_HITS=4 polyphony cap, auto-dispose after 2.5s
- Evolved from: 6-square-oscillator approach → FM synthesis → pure noise (to eliminate pitched artifacts)

### Bass ✅ Implemented

- **Oscillator:** Saw wave (single, not fat — bass should be focused, not wide)
- **Sub:** Sine one octave below, -3dB × 0.8 velocity scale relative to main
- **Filter envelope:** Per-note trigger, cutoff sweeps from 2kHz → 300Hz (exponential decay, ~150ms)
  - This creates the "bwow" — the defining bass character
  - Per-hit filter nodes so overlapping notes have independent sweeps
  - Configurable via `filterEnvStart`, `filterEnvEnd`, `filterEnvDecay` in BassConfig
  - Omit these fields for no envelope (debug preset stays flat)
- **Portamento:** 50ms glide between notes (glide only when previous note was within 500ms, not across rests)
  - Configurable via `glideTime` in BassConfig
- **Saturation:** Chebyshev order 3, 40% wet (generates harmonics for laptop speaker audibility)
  - Configurable via `saturationWet` in BassConfig (defaults to 0.3 if omitted)
- **Filter:** Lowpass at 500Hz (post-saturation), same as current but saturation feeds it overtones
- **Volume:** 0dB (prominent in mix — bass carries the song in synthwave)
- **Chorus:** ✅ Implemented. Subtle Juno-style chorus on the main saw osc only (sub stays dry/mono). 3ms delay, 0.5Hz LFO, 20% wet. Adds stereo width to the saw without muddying the sub. Signal chain: main osc → perHitFilter → mainHitGain → chorus → saturation. Sub osc → subGain → subHitGain → saturation (bypasses chorus). Configurable via `chorusDelayMs`, `chorusRate`, `chorusWet` in BassConfig — omit `chorusDelayMs` for no chorus.
- **Architecture:** Per-hit nodes (main osc → perHitFilter → mainHitGain → chorus → saturation, sub osc → subGain → subHitGain → saturation → staticFilter → dest), HitPool(4) polyphony cap, matching synth drum pattern

### Pad

Push hard. This is the atmosphere.

- **Oscillator:** `fatsawtooth`, **5 voices** (up from 3), **±50 cents** spread (up from ±30)
  - 5 voices at 50 cents creates an audible, lush chorus. 3 at 30 was too subtle.
- **Volume:** -15dB (up from -21dB — pad should be present, not buried)
- **Filter LFO range:** 200Hz → 2500Hz (was 400-1200Hz — much wider sweep, actually audible)
- **Volume LFO range:** 0.6 → 1.0 (was 0.75-1.0 — more dynamic breathing)
- **LFO rate:** One full cycle = 3 loops (~12s at 120bpm). Deliberately non-aligned with the beat grid so the filter peak drifts across different beats each loop — feels organic, not metronomic.
- **Attack:** 0.3s (same — slow enough to feel organic)
- **Release:** 1.2s (up from 0.8s — longer tail on chord changes)
- **Reverb:** Long hall, 2.5s decay, 25% wet (pad gets its own reverb bus — see FX routing)
- **Stereo:** ✅ Implemented. `Tone.Panner` with slow LFO for stereo drift (±0.3 range at 0.5× LFO rate). Signal chain: synth → lfoFilter → panner → pulseGain → volumeGain → dest. Configurable via `panLfoRange` (default `[-0.3, 0.3]`) and `panLfoRateMul` (default `0.5`) in PadConfig.
- **Chord crossfade:** ✅ Implemented. Chord changes use `triggerRelease` (per-note) instead of `releaseAll`, so the old chord's 1.2s release overlaps with the new chord's 0.3s attack. Natural crossfade, no gap or click.
- **Top-note drift:** ✅ Implemented. Each chord has a `padTopAlt` — the 3rd as alternate for the default 9th (e.g., Am: B3 → C4, F: G3 → A3). On each chord change, 45% chance (seeded PRNG) of using the alt. At loop midpoint (column 8), 35% chance of swapping the top note mid-loop via `shiftTopNote` (releases old, attacks new — same crossfade envelope). Creates subtle harmonic color shifts without user input. The PRNG resets on stop for deterministic replay.

### Stab / Arp

Three stab/arp flavors share one mixer fader (`stabGain`). All follow the pad's harmonic drift state — when the pad shifts its top note from 9th to 3rd, all three shift together.

**Hat stab** (`stab`) — bright, echoing, triggered from row 1 (THE RHYTHM):
- **Oscillator:** Saw wave (brighter than square for arps — more overtones to filter)
- **Voicing:** `stabVoicing` (high — A3/E4/B4), `stabTopAlt` for drift (e.g. B4→C5)
- **Envelope:** Fast attack (3ms), medium decay (200ms), low sustain (10%), medium release (300ms)
- **Filter:** Lowpass at 3kHz
- **Delay:** Dotted 8th (8n.), 35% feedback, 30% wet — the delay tail turns 4 notes into 12
- **Dynamics:** ✅ Implemented. Probability 65%, offbeat velocity ×0.6, base velocity 0.5

**Groove stab** (`stab-groove`) — warm, punchy, triggered from row 2 (THE GROOVE): ✅ Implemented.
- **Oscillator:** Square wave (warmer, more body — complements snare's noise character)
- **Voicing:** `padVoicing` (low — A2/E3/B3) via `voicingSource: 'pad'`, inherits `padTopAlt` drift. Lower register than hat stab for separation.
- **Envelope:** Fast attack (3ms), decay 0.35, sustain 0.12, release 0.25 (re-tuned from 120ms/5%/150ms — longer decay and higher sustain give more body)
- **Filter:** Lowpass at 2200Hz (raised from 900Hz — brighter for stab voicing, distinct from hat stab's 3000Hz)
- **Volume:** -4dB (re-tuned from -2dB — pulled back to avoid masking other mid-range elements)
- **Delay:** None — dry and punchy, reinforces the backbeat
- **Dynamics:** ✅ Implemented. Probability 80%, no offbeat velocity reduction, base velocity 0.50
- **Voicing drift:** ✅ Implemented. Both stabs follow the pad's `padUsingAlt` state. SoundEngine post-processes stab voicings in `tick()`, swapping the top note when the pad is in alt mode. All three harmonic voices (pad, hat stab, groove stab) shift as a unit.

**Arp voice** (`stab-arp`) — bright, cascading, triggered from row 0 (THE SPARKLE): ✅ Implemented.
- **Oscillator:** Saw wave (same as hat stab — bright, rich overtones for filtering)
- **Voicing:** One octave above `stabVoicing`: root+12, 5th+12, top+12, root+24 — 4 distinct pitches sorted by pitch
- **Envelope:** Tight — 3ms attack, 150ms decay, 5% sustain, 150ms release (shorter than hat stab for crisp articulation)
- **Filter:** Lowpass at 4kHz (brighter than hat stab's 3kHz — arp sits on top)
- **Volume:** -2dB
- **Delay:** Dotted 8th, 30% feedback, 30% wet (slightly less feedback than hat stab's 35% — tighter tail)
- **Arp behavior:** 4-note sequence per cell, 16th-note spacing (0.25 beatOffset). Ascending on downbeats, descending on offbeats. Velocity decay 0.85× per note. Truncated near chord boundaries.
- **Voicing drift:** Top note (+12 from `stabDefaultTop`) follows pad drift — swaps to `stabAltTop+12` when `padUsingAlt` is true.

**Arp note duration:** 16th note (half a sub-column). Notes are short enough to articulate individually but long enough that the delay catches them.
- **Reverb:** Plate, 1.5s decay, 20% wet (sits in the "middle" of the mix spatially)

### FX Routing (Per-Voice, Not Shared)

✅ **Implemented.** Three-bus spatial routing with gentle master compressor (-18dB, 2:1).

```
Kick       → kickGain → dryBus → masterGate → destination
Snare/Clap → snareGain → gatedReverbBus → masterGate → destination
Hat        → hatGain → dryBus → masterGate → destination
Bass       → bassGain → bassDistortion → dryBus → masterGate → destination
Pad        → padGain → hallReverb (2.5s, 25%) → masterGate → destination
Arp/Stab   → arpGain → plateReverb (1.5s, 20%) → masterGate → destination
                      → feedbackDelay → plateReverb
```

**Three spatial zones:**
1. **Dry/close:** Kick, hat, bass — tight, punchy, present (no reverb or very short room)
2. **Middle:** Arp/stab — plate reverb (1.5s) + delay, sits in the "stage middle"
3. **Far/wide:** Pad — hall reverb (2.5s), wide stereo, lives in the background

**Sidechain compression:** ✅ Implemented. Hybrid implicit quarter-note pump + kick/snare reinforcement. The engine emits pad-pulse on every step, with depth determined by what's playing:

- **Quarter note (no kick/snare):** baseline depth 0.5 — gentle breathing, always present even on empty grid
- **Kick on quarter note:** depth 0.15 — full synthwave pump (deepest)
- **Kick off quarter note:** depth 0.3 — medium pump for offbeat kicks
- **Snare hit:** depth 0.4 — light duck on backbeats
- **Multiple triggers:** deepest (lowest) depth wins

The pad pump is no longer hat-driven. Hat hits (row 1) do not duck the pad — they have their own stab companion for harmonic density. The pump lives in `SoundEngine.tick()`, not the interpreter. Recovery time scales with depth (deeper duck = longer recovery for audible pump). Configurable via `PadConfig.sidechain`.

**Master compressor:** Still present but gentler (-18dB threshold, 2:1 ratio) — more glue, less squash. The per-voice routing does the heavy lifting now.

---

## Chord Progressions (A/B Sections)

Two families of chord progressions, seed-picked from pools (see `src/arrangement/chordPools.ts`):

**A-section:** 7 cycle variants, all start Am, end G or Em. Example: `Am → F → Dm → G` (classic natural minor).

**B-section:** 6 eight-chord sequences, all bookended `C...E`. E only appears at position 7 (final). Middle chords mix diatonic Am/Dm/Em/F/G. Example: `C → Am → F → G → Am → Dm → F → E`.

### Why Two Progressions

A single 4-chord loop repeating forever gets stale. Splitting into A/B sections with different chord families creates harmonic contrast that the user *feels* without needing to understand:

- **A-section (Am→...→G/Em):** Dark and comfortable. G is diatonic (VII in A natural minor) — no leading tone, no pull. The loop just continues. This is the verse — spacious, settled.
- **B-section (C→...→E):** C major opens bright. The middle 6 chords wander through diatonic territory. E (harmonic minor V) creates the dramatic pull at the end — G# demands resolution back to Am. This is the chorus — energy, climax. E is reserved for the final position so the dominant tension only hits once, as the section-ending hook.

### The G# Problem (Applies to B-section Only)

The E chord's G# is outside the natural minor scale. The G# is baked into the E chord's voicings (`padVoicing: ['E2', 'B2', 'G#3']`, `stabVoicing: ['E3', 'B3', 'G#4']`) defined in `bChords` in `synthwave-am.ts`. No runtime scale switching is needed — the interpreter uses the chord's voicing directly.

### Voicings (Stacked 5ths)

**A-section:**
```
Am:  pad [A2, E3, B3]   arp [A3, E4, B4]     (dark, open)
F:   pad [F2, C3, G3]   arp [F3, C4, G4]     (bittersweet)
Dm:  pad [D2, A2, E3]   arp [D3, A3, E4]     (melancholy)
G:   pad [G2, D3, A3]   arp [G3, D4, A4]     (gentle resolution)
```

**B-section:**
```
C:   pad [C2, G2, D3]   arp [C3, G3, D4]     (bright, open)
F:   pad [F2, C3, G3]   arp [F3, C4, G4]     (same as A)
Dm:  pad [D2, A2, E3]   arp [D3, A3, E4]     (same as A)
E:   pad [E2, B2, G#3]  arp [E3, B3, G#4]    (tension — G# is the hook)
```

Note: F and Dm voicings are shared between sections. Only chords 1 and 4 differ. This keeps the harmonic language consistent — the sections feel related, not like two different songs.

---

## ✅ Resolved: Chord Changes vs. Delay/Arp Tails

No longer audible as of 2026-04-01. Energy automation (delay feedback scales 0.08–0.40), velocity scaling, and variation seed feedback offsets keep tails short enough that chord transitions are clean. Confirmed by ear across multiple variation seeds. Option 4 (accept short bleed) won naturally — the energy-driven feedback scaling means low-energy sections have almost no delay tail, and high-energy sections have enough harmonic density that brief bleed is masked.

---

## Arrangement System: Song Structure from One Grid

The grid loops, but the engine creates a full song arc by controlling *per-voice probabilities*, *which chord plays*, and *how intense the mix is* on each pass. The user's cells don't change; the engine reveals them over time.

### Core Model: Per-Voice Probability Per Loop

The arrangement is a flat array of steps — one entry per loop. Each step specifies per-voice probabilities, energy, and optional transition effects (risers, fills). See `src/lib/types.ts` for the `ArrangementStep` and `ResolvedVoiceProbs` types.

**Two probability modes:**
- **Drums (sparkle, rhythm, groove, pulse):** Absolute probability gated via `voiceProbKey` on each `KitRow`. `1` = hit always fires, `0.5` = 50% per hit, `0` = silent. The drum is gated independently of companions — setting a drum to 0 suppresses the drum hit but companions (stab, arp, bass) still fire from that row's cells if their multiplier > 0.
- **Synths (bass, stab, stabGroove, arp):** Multiplier on the kit-defined base probability. Stab has 65% base prob in the kit; at `stab: 0.5`, effective probability is 32.5%. At `1.0`, designed rate. At `0`, never fires.

**`'previous'`:** Copies the resolved value from the prior step. Chains through multiple steps.

### Short Arrangement (16 loops)

Hardcoded in `synthwave-am.ts`. ~65 seconds at 120 BPM.

**Structure:** INTRO (2) → A1 (4) → A2 (4) → B (4) → RESOLUTION (2) → FINAL (Am)

### Long Arrangement (21-30 loops, seed-driven)

Generated by `src/arrangement/generator.ts`. The seed (derived from grid hash + variation) picks:
- **Archetype** (1 of 7 structural shapes) — determines section order, loop counts, energy curves
- **Chord pools** — intro (6 pairs + 5 quads), A-section (7 cycles), B-section (6 sequences), resolution (4 variants)
- **Voicing tier** (1 of 6) — controls stab/arp density and companion scaling per section

**Key structural rules:**
- Intro resolves to Am (ends on E or G)
- A-sections ramp energy with increasing companion density
- Drop before B: drums mostly silent, synths stripped — contrast makes B's re-entry hit harder
- B-section plays all 8 chords including E (G#) — the emotional peak. E only at position 7
- Resolution is pad-focused with sparse drums — wind-down, not abrupt stop

### Song Ending: The Final Beat

After the last step completes, the engine plays **one beat** — pad only, no drums or bass. The ending sequence:

1. **Pad preparation:** LFOs are stopped and filter is set to a fixed warm frequency (1800Hz) so the pad sustains at a consistent brightness — no sweeping mid-note.
2. **Pad re-attack:** The final chord (Am) is triggered on the pad, even if it's the same chord name as the prior step, ensuring a fresh audible attack.
3. **Sustain hold:** The pad sustains for 2 beats (~1 second at 120 BPM) so the Am chord establishes clearly above any lingering reverb tail from the previous G chord.
4. **Exponential fade:** `player.fadeOut(3)` ramps the master gate to near-zero over 3 seconds using an exponential curve (sounds natural — loud at first, then smooth decay). No pad release — the pad continues sustaining under the fade.
5. **Cleanup:** `resetPlaybackState()` (shared by `stop()` and `finishArrangement()`) resets all playback state. `onComplete` fires to reset the App's play button.

### Transition Tools ✅ Implemented

**Risers (pitched noise sweep):** White noise + sine undertone through a sweeping bandpass filter. Sources play for 85% of sweep duration, then fade out over the remaining 15% — the dedicated riser reverb (2.5s decay, 60% wet) carries the tail across the loop boundary. `up` sweeps low→high (building tension), `down` sweeps high→low (release). PRNG varies sweep range (full 200→8kHz or narrow 400→5kHz) and bandpass Q (tight 3 = whistly, wide 1.5 = washy). Volume is energy-scaled (0.15–0.55). Fade-in over first 20% prevents a click. Routes through riserGain → dedicated riser reverb → compressor (not plateBus — independent spatial zone). The SoundEngine triggers once at `startCol` and tracks `riserStartedThisLoop` to prevent re-triggering.

**Snare fills:** Two weights driven by `fillWeight` on the ArrangementStep:

| Weight | Duration | Pattern | Vel range | Role |
|--------|----------|---------|-----------|------|
| `light` | 2 beats (4 cols) | Quarter notes (every other col) — 2 hits | 0.4→0.6 | Continuity marker (intro→A1, A1→A2) |
| `heavy` | 4 beats (8 cols) | Quarters first half → 8ths second half — 5 hits | 0.5→1.0 | Section change (drop→B, B→resolution) |

Energy scaling naturally differentiates fills at different points — a light fill at energy 0.35 (intro) hits much softer than the same light fill at energy 0.7 (A1→A2). Velocity curve (linear vs exponential) is PRNG-varied per fill. ±7% humanize jitter on all hits. Additive — skips columns where user has a snare cell. Arp fill type removed — the pad chord fade-out handles the B→A3 transition.

### Energy → Mix Parameters ✅ Implemented

The `energy` value (0-1) scales mix parameters via `Player.applyEnergy()`, called at each loop boundary:

| Parameter | energy=0.0 | energy=0.5 | energy=1.0 |
|-----------|-----------|-----------|-----------|
| Velocity multiplier | ×0.25 | ×0.63 | ×1.00 |
| Pad filter LFO range | 1000–1400 Hz | 575–2200 Hz | 150–3000 Hz |
| Delay feedback | 0.08 | 0.24 | 0.40 |
| Delay wet | 0.08 | 0.22 | 0.35 |
| Reverb wet | 0.05 | 0.18 | 0.30 |

These are applied as linear interpolation (lerp) between the low and high bounds. The preset defines the designed maximum; energy scales how close to maximum each loop gets. The velocity scale multiplies all drum and companion velocities in `Player.play()`.

### PRNG Seeding

The Arranger's PRNG is seeded from the grid hash (same grid = same arrangement). Currently PRNG only decides riser/fill timing. All voice probabilities and the chord sequence are deterministic from the preset definition.

### UI Signaling: "More Is Coming"

**Dimmed playhead on muted rows.** ✅ Implemented. `StepEvent` includes `drumProbs: [number, number, number, number]` — the per-row drum probability. Grid scales playhead glow opacity per row: `0.15 + prob × 0.85`. During intro/drop/resolution, muted drum rows show a ghost playhead (15% opacity) while active rows glow normally.

**EQ Visualizer.** ✅ Implemented. 5-band × 8-segment LED display centered below step LEDs. Driven by actual sounds via `engine.onSounds()` (fires directly from audio callback, bypassing visual ticker to avoid Tone.js lookahead race conditions). Sound-to-band mapping: sub (kick/bass), low-mid (groove/pad/stabGroove), mid (stab), hi-mid (hat), air (sparkle/arp). Pad contributes sustained baseline to low-mid band via `padProb`. Energy scales max height. VU gradient: deep navy → cyan → bright white. 60fps rAF decay loop with peak hold dots.

**One-time "keep listening..." nudge.** On the first play session, a small ephemeral toast: "keep listening..." (persisted in localStorage). Not yet implemented.

### Implementation

**`src/engine/Arranger.ts`**
- Pure class, no Tone.js dependency
- Constructor: `(arrangement: Arrangement, seed: number, numCols: number)`
- Pre-resolves all steps sequentially (handles `'previous'` chaining)
- `getContext(loopCount: number): ArrangementContext`
- Returns `{ chord, voiceProbs, energy, label, riser?, fill?, isComplete, isFinalBeat }`
- Final beat inherits last step's voice probs

**SoundEngine changes:**
- Creates `Arranger` in `start()` from config + grid hash seed
- `tick()` calls `arranger.getContext(loopCount)`
- Passes `voiceProbs` through `StepContext` to Scheduler and interpreter
- Interpreter gates drums via `rowConfig.voiceProbKey` (data-driven, not positional array), scales companion probs by multiplier
- `playFinalBeat()` stops LFOs, opens pad filter, re-attacks pad chord (pad only — no kick/bass), sustains 2 beats, then `player.fadeOut(3)` with exponential ramp
- `applyEnergy()` called at loop boundaries — scales velocity, pad filter range, delay params, reverb wet. Iterates `this.voices.values()` dynamically (not hardcoded voice lists)
- `onSounds()` callback fires from audio tick with actual sounds played + energy + padProb (for EQ visualizer, decoupled from visual ticker)
- Per-step triggered data stored in `stepTriggered` Map (keyed by column) to avoid audio/visual race conditions
- `resetPlaybackState()` shared between `stop()` and `finishArrangement()` — single teardown path
- `onComplete` callback notifies App when song ends

**Interpreter changes:**
- Drum hits gated by `voiceProbs[rowConfig.voiceProbKey]` (data-driven from kit config)
- Bass companion probability multiplied by `voiceProbs.bass`
- Hat stab probability multiplied by `voiceProbs.stab`
- Groove stab probability multiplied by `voiceProbs.stabGroove`
- Arp probability multiplied by `voiceProbs.arp`
- Stab voicings emitted as `notes: string[]` (typed array, not JSON-encoded string)
- When drum prob is 0 but companion multiplier > 0, companions still fire from cells (intro behavior)

**Preset changes:**
- `Preset` and `EngineConfig` get optional `arrangement?: Arrangement`
- `null` arrangement = flat infinite looping (debug preset unchanged)

---

## Evolution Over Time: Per-Loop Dynamics

The arrangement system handles macro structure (which loops play what). These per-loop dynamics add micro-level evolution. Each is configurable per-preset so the diagnostic preset can stay flat.

### Per-Voice Mix LFOs ✅ Implemented

Slow, independent volume modulation on each voice so the mix breathes. Rates are prime numbers so they never realign:

| Voice | LFO Rate | Notes |
|-------|----------|-------|
| Sparkle (cymbal) | 11 loops/cycle | Slow drift — periodic shimmer crests |
| Hat | 5 loops/cycle | Medium — hat density perception varies |
| Snare | 7 loops/cycle | Slightly slower than hat — not in phase |
| Bass | 4 loops/cycle | Noticeable volume swell over ~4 loops |
| Stab | 3 loops/cycle | Fastest non-drum rate — punctuates the groove |
| Kick | none | Anchor — kick stays constant |
| Pad | separate LFO | Already has its own volume LFO (0.6–1.0 range, 3 loops/cycle) |

LFOs are driven by elapsed loop count so they're deterministic. The pad already has this — the other voices follow the same pattern.

### Variation Seed System ✅ Implemented

Shipped as seed-driven variation (0-15 seeds, dice UI). Each seed produces a different combination of:
- **Per-note:** arp shape (ascending/descending/pendulum/octaveJump), stab voicing inversion (root/1st/2nd), accent pattern (flat/oneThree/twoFour/offbeats)
- **Global:** pad LFO warmth/brightness offset, delay feedback offset, stab filter cutoff multiplier, ghost bass density, delay time variant (8n/8n./4n), drum brightness offset
- **Voice palettes:** seed picks one of 3 sonic characters (default/grit/glass) — overrides pad, bass, stab, stabGroove, arp configs
- **Key transposition:** seed picks -3 to +4 semitones (F#m–C#m), applied after palette + arrangement

### Future: Density-Intensity Coupling (P2)

Grid density (% cells filled) could scale mix parameters. Deferred — the energy curve in the arrangement handles the macro intensity arc. Density coupling would add micro-level responsiveness to grid edits.

---

## Grid Dimensions

**Currently:** 6 rows × 16 columns (8 beats, each beat divided into 2 sub-columns).

**New:** 4 rows × 16 columns.

The column structure stays the same — 16 sub-columns in 8 beat pairs works well for the arp system (arp notes fall on sub-column boundaries) and the "and" beat system for bass approach tones.

**Impact on grid state and share-via-URL:**
- `DEFAULT_NUM_ROWS` → 4
- Grid hash changes (fewer rows = different hash for same patterns) — share-via-URL uses versioned format (`#v1:`), grid dimension changes would require a v2 format
- Visual: more vertical space per row, or the grid shrinks. The cells can be taller/wider. With 4 rows, even small screens can fit generous cell sizes.

**Whether to stay at 16 columns:** 16 sub-columns (8 beats) gives:
- 2 beats per chord (4 chords × 2 beats = 8 beats = 1 loop)
- Wait — current system is 1 chord per loop (16 beats = 1 loop, chord changes every loop). With 16 sub-columns at 8th note resolution, one loop = 2 bars at 4/4.

Let's keep 16 for now. It's musically useful (enough resolution for syncopation and arps) without being overwhelming (32 would be too many cells). 4×16 = 64 cells total, which is a manageable creative space.

---

## Architecture (as built)

### Key files

| File | Role |
|------|------|
| `src/lib/types.ts` | `KitRow`, `ScheduledSound` (with `notes?: string[]` for stab voicings), `ArrangementStep`, `ResolvedVoiceProbs` |
| `src/engine/constants.ts` | `STAB_GROOVE`, `STAB`, `ARP`, `PAD_DRIFT_SEED`, `GHOST_BASS_SEED`, `FILL_HUMANIZE_SEED`, `BEATS_PER_LOOP` |
| `src/engine/Player.ts` | Tone.js wrapper — synth drum factories, bass, stab/arp, pad, riser, FX routing, energy automation |
| `src/engine/SoundEngine.ts` | Orchestrator — Transport scheduling, arrangement, pad drift, visual ticker |
| `src/engine/Scheduler.ts` | Grid → sounds — interpreter dispatch, ghost bass (separate PRNG), snare fills (separate PRNG) |
| `src/engine/interpreters.ts` | Cell interpreter — drums, bass, stabs (`notes` array), arps, data-driven `voiceProbKey` gating |
| `src/engine/Arranger.ts` | Arrangement resolution — pre-resolves steps, handles `'previous'` chaining |
| `src/arrangement/` | Long arrangement generator — archetypes, chord pools, voicing tiers, section builders |
| `src/presets/synthwave-am.ts` | Synthwave preset — kit, pad, bass, stab, arrangement |
| `src/presets/voicePalettes.ts` | Voice palette system — default/grit/glass sonic characters |

### Preview System ✅ Implemented

`SoundEngine.triggerPreview(sounds: ScheduledSound[])` plays a `ScheduledSound[]` array directly. Preview sounds are built in `App.tsx` per row — drum + companion sounds with stab voicings as `notes` arrays and arp cascades with compressed timing offsets (60ms spacing). The preview uses the first chord in the progression (or current chord during playback).

---

## Tempo

**120 BPM.** Standard synthwave tempo (100-130 range). Same as current. No change needed.

Could expose a wider range in the BPM slider (80-160 instead of 60-180, step 5 instead of 20) for more granularity, but this is a polish item, not a preset design decision.

---

## Visual UI

### Arrangement Visual Indicators ✅ Implemented

Chord progression dots removed. Replaced by two arrangement-aware visuals:
- **Playhead dimming:** `drumProbs` scales glow opacity per row (0→15%, 1→100%). During intro/drop/resolution, muted drum rows show a ghost playhead.
- **EQ visualizer:** 5-band × 8-segment LED display driven by actual sounds via `onSounds()` callback (see § UI Signaling).

### Beat Pair Column Highlight

During playback each beat pair wrapper receives a white `box-shadow` glow that moves with the step LED dots, creating a subtle column highlight that reinforces rhythmic timing without overpowering the per-row cell colors.

**Implementation details:**
- Beat pair `<div>` elements carry a `data-beat` attribute (0–7 matching the 8 beat-pair columns).
- The playhead callback updates the glow via direct DOM manipulation (`element.style.boxShadow`) rather than React state, keeping the animation on `requestAnimationFrame` cadence with no re-renders.
- Glow style: `0 0 8px 2px rgba(255,255,255,0.25)` — bright enough to be readable in peripheral vision, dim enough to stay subordinate to active cell colors.
- The highlight is cleared when playback stops.

---

## Resolved Design Questions

1. **Diagnostic preset → 4 rows?** ✅ Yes — both presets use 4 rows.
2. **Row 1 ghost notes?** ❌ Skipped — ghost hats not implemented. Stab delay + arps fill the role.
3. **Arp note selection?** ✅ Uses `stabVoicing` + root+24 (4th pitch one octave above), sorted by MIDI.
4. **Density-intensity coupling?** Deferred to P2. Energy curve in arrangement handles macro intensity.
5. **E chord G# in bass?** ✅ G# is baked into E chord voicings. No runtime scale switching needed.
6. **Song ending?** ✅ Full stop with pad fadeout. Play button resets via `onComplete`.
7. **Arrangement length?** ✅ Short: 16 loops (~65s). Long: 21-30 loops (seed-driven, 7 archetypes).
8. **Intro on subsequent plays?** Intro plays every time (both short and long modes).
