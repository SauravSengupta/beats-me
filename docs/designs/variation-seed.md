# Variation & Playback Modes — Design Document

> Two related features that expand what users can do without adding complexity:
>
> 1. **Variation seed** — explore different interpretations of the same grid,
>    lock one in for sharing. Same grid + same seed = same output.
> 2. **Playback modes** — jam (infinite loop) vs. song (arranged arc), with
>    abstract song length control for the song mode.

---

## Motivation

User feedback: "I like the determinism but I'm also excited about a little more
variability that maybe can be buried to avoid ruining the approachability."

The current system derives a single PRNG seed from the grid state (`hashGrid`).
Same grid always sounds identical. This feature adds a **variation number** that
shifts the seed, producing a different but equally deterministic arrangement.

---

## Core Mechanic

### Seed Composition

Currently (`interpreters.ts:116-119`):

```ts
const gridHash = hashGrid(grid.cells);
random = createPRNG(gridHash);
```

With variation seed:

```ts
const gridHash = hashGrid(grid.cells);
random = createPRNG(gridHash ^ (variationSeed * 0x9e3779b9));
```

The golden ratio constant (`0x9e3779b9`) ensures even adjacent seed numbers
produce widely different PRNG sequences. Variation 0 should produce the same
hash as today (XOR with 0 = identity) for backward compatibility.

### What Varies Per Seed

**Does NOT change** (drum determinism principle):
- Whether a drum hit fires for a filled cell (always fires)
- Grid layout / cell positions
- Tempo, mutes, volumes
- Arrangement structure (section order, loop count)

**Changes with seed:**

| Element | Current behavior | With variation seed |
|---------|-----------------|---------------------|
| Companion sound probability | Seeded from grid hash | Seeded from grid hash ⊕ variation |
| Velocity humanization offsets | Same every time | Different pattern per seed |
| Arp direction (asc/desc) | Even col = asc, odd = desc | Seed-dependent pattern |
| Bass approach tone choice | Weighted pick from grid hash | Different weighted picks |
| Stab/groove stab firing | 65%/80% probability | Same probabilities, different rolls |
| Fill placement | Fixed at loops 1,5,9,13 | Could vary which loops get fills |
| Riser filter range/Q | PRNG-varied | Different PRNG = different sweep |

### Implemented: Seed-Dependent Variation

All variation is derived via `deriveVariationParams(seed)` in `src/lib/prng.ts`.
Seed 0 returns neutral defaults (backward compatible). Seeds 1–15 produce
audibly distinct interpretations.

**Per-note variation (interpreter PRNG):**

1. **Arp pattern shape** — Per-column choice from: ascending, descending,
   pendulum (wave-shaped 0→2→1→3), octave-jump (wide leaps 0→3→1→2).
   Applied via `applyArpShape()` in `interpreters.ts`.

2. **Stab voicing inversion** — Per-chord-index choice: root position (0),
   1st inversion (1), or 2nd inversion (2). Applied via `invertVoicing()`
   in `interpreters.ts`.

3. **Accent pattern** — Drum velocity multiplier per column. Four patterns:
   flat (1.0), oneThree (beats 1&3 louder), twoFour (beats 2&4 louder),
   offbeats (odd columns louder). Applied via `getAccentMul()`.

**Global variation (derived once per seed, applied to Player/Scheduler):**

4. **Pad filter LFO range** — `padLfoOffset` (-1 to +1) shifts the LFO
   sweep range ±400/600Hz. Negative = warmer, positive = brighter.
   Applied in `Player.applyEnergy()`.

5. **Delay feedback** — `delayFeedbackOffset` (-0.1 to +0.1) added to the
   energy-derived feedback value. More feedback = more rhythmic echo buildup.
   Applied in `Player.applyEnergy()`.

6. **Stab filter cutoff** — `stabFilterMul` (0.8 to 1.2) multiplied against
   the stab voice filter frequency. Darker or brighter stabs.
   Applied via `Player.applyStabFilterMul()` after init.

7. **Ghost bass density** — `ghostBassDensity` (0.7 to 1.3) multiplied against
   the base 55% ghost probability. Sparser or busier bassline.
   Applied in `Scheduler.addGhostBass()`.

**Tried and removed:**

- **Rhythm displacement** — Shifting companion sounds by ±1 sixteenth note.
  Sounded like the engine glitched rather than a musical variation.
  Removed — companion sounds always land on beatOffset 0 with their drum.

**Not yet implemented (candidates for future expansion):**

- Fill density / fill position variation
- Chord voicing register shifts
- Drum filter sweeps (needs new audio node plumbing)

---

## UI

### Dice Control

- **Icon:** Dice (🎲) or similar — placed in the bottom settings group near
  the existing tempo/share controls
- **Tap/click:** Randomize to a new variation number (0–15)
- **Drag or scroll:** Cycle through specific numbers
- **Display:** Shows current variation number (small, next to dice)
- **Default:** Variation 0 (backward compatible — sounds identical to today)

### Interaction Model

The dice should feel low-commitment:
- Tapping while playing immediately applies the new seed (next loop boundary
  or next step, TBD — try both by ear)
- No confirmation needed — it's a "re-roll," not a destructive action
- The number is visible so users can go back to a seed they liked

### Discoverability

Buried enough for casual users (it's just another small icon in the settings
area) but discoverable for anyone exploring the controls. No onboarding
tooltip needed — the dice icon is self-explanatory.

---

## Share URL Encoding

### Available Bits

Current v1 format (16 bytes):
- Byte 9: `Mutes[7:6] | Reserved[5:0]` — **6 reserved bits**
- Byte 13: `Vol bass[7:4] | Reserved[3:0]` — **4 reserved bits**
- Bytes 14-15: fully reserved — **16 bits**

### Proposal

Use **4 bits from byte 13's low nibble** for variation seed (0–15):

```
Byte 13: Vol bass[7:4] | Variation[3:0]
```

This stays within the v1 format. Existing URLs have these bits as 0, which
decodes to variation 0 — backward compatible.

### Tempo Expansion (Related)

The same user requested finer BPM control (especially 120–130 for house music).
Currently tempo uses 3 bits (7 values, step 20). Options:

1. **Use byte 9's reserved bits** for extended tempo: 6 bits = 64 values.
   E.g., `60 + index * 2` = 60–186 BPM in 2 BPM steps. 
2. **Separate concern:** Tempo expansion can use different reserved bits than
   the variation seed. Both fit in v1.

If we do both: byte 9 becomes `Mutes[7:6] | TempoBits[5:0]`, byte 13 low
nibble becomes variation. Still v1 compatible (old URLs decode tempo from
byte 8's 3 bits as before; new decoder checks byte 9 for extended precision).

---

## Implementation (Done)

### Engine Changes

1. `variationSeed?: number` added to `EngineConfig` (`src/lib/types.ts`)
2. `deriveVariationParams(seed)` in `src/lib/prng.ts` — derives all params
   from a seeded PRNG. Returns `VariationParams` struct.
3. `interpreters.ts` — mixes variation into grid hash PRNG, applies arp shape,
   stab inversion, and accent pattern per-note
4. `SoundEngine.setVariation(n)` — updates config, re-derives params,
   pushes to Scheduler
5. `Player.applyEnergy(energy, vp?)` — uses variation params for pad LFO
   offset and delay feedback offset
6. `Player.applyStabFilterMul(mul)` — applies stab filter cutoff variation
7. `Scheduler` — stores `ghostBassDensity` from variation params, applies
   to ghost bass probability gate

### React Changes

1. `variation` state (0–15) + `diceRolling` animation state
2. Dice button in settings group with bounce animation (CSS keyframe)
3. `handleDiceRoll` — randomizes, calls `setVariation`, fires analytics
4. Wired into engine constructor, `updateConfig` effect, share encode/decode

### Share URL Changes

1. Byte 13 low nibble encodes variation (0–15)
2. Decode falls back to 0 for old URLs
3. `ShareState.variationSeed` + `DecodedShareState.variationSeed`

### Analytics

1. `dice_roll` event with `{ variation: number }` property

---

---

## Playback Modes

### The Two Modes

| | Jam Mode (∞) | Song Mode (▶) |
|---|---|---|
| **Loop behavior** | Repeats forever | Arranged arc with intro → build → climax → resolution |
| **Arrangement** | No Arranger — flat energy, all voices at full probability | Full Arranger with sections, energy curves, fills, risers |
| **Editing** | Changes apply next loop, infinite exploration | Same, but song restarts or continues from current section |
| **End state** | Never ends — user hits stop | Final beat → fade → stop |
| **Variation seed** | Still works (shifts companion sound choices) but less critical since user is tweaking live | Primary value — deterministic output for sharing |
| **Best for** | Live jamming, exploring, performing, first-time users | Listening to a "song," sharing a finished piece |

### Architecture Fit

The Arranger is already optional. `SoundEngine` checks `if (this.arranger)`
before using arrangement context. Jam mode = no Arranger, no termination.
The engine already supports this path implicitly — it just needs to be
surfaced as a user choice.

In jam mode:
- Energy stays flat (e.g., 0.7 — full but not climactic)
- All voice probabilities = 1 (everything the user placed is audible)
- No fills, no risers, no chord progression cycling
- Pad plays the tonic chord continuously
- The variation seed still feeds into the interpreter PRNG, so companion
  sounds (stabs, arps, bass approach tones) still vary per seed

### Song Length Control

User feedback wants longer arrangements (32-bar intros, verses, builds,
choruses, breakdowns, drops, outros) but does NOT want dedicated controls
for intro length, verse count, etc. The control should be abstract.

**Current arrangement:** 16 loops + final beat ≈ 65 seconds at 120 BPM.
Structure: Intro (2) → A1 build (4) → A2 full (4) → B climax (4) → A3
resolution (2) → final beat.

**Decided approach: energy/length selector + dice for variation within**

The length selector and variation seed are **orthogonal controls**:

- **Length selector** → picks the arrangement template (section count,
  duration, energy shape). This is "what kind of song."
- **Variation seed (dice)** → picks companion sound choices, arp shapes,
  fill placements, voicing inversions *within* that template. This is
  "which rendition of that song."

The user picks a song length/complexity and expects that to stay stable.
The dice gives them different interpretations within that structure. Rolling
the dice should never change the macro structure or duration — the surprise
lives in the musical details, not the song form.

### The Selector: Energy-Curve Spectrum

Framed as energy shapes, not quality tiers. Jam mode (infinite loop) is the
left end of the spectrum, not a separate toggle.

| Name | Energy shape | Loops | @120 BPM | Structure |
|------|-------------|-------|----------|-----------|
| **Loop** | Flat line (∞) | Infinite | — | No arrangement. Flat energy, all voices full. User jams live. |
| **Wave** | One hill | ~16 | ~65s | Current arrangement: Intro → Build → Full → Climax → Resolution. |
| **Arc** | Hill + plateau | ~32 | ~130s | Extended: longer intro, verse/chorus distinction, sustained peak, breakdown, outro. |
| **Journey** | Multiple hills | ~48-64 | ~4-5 min | Full song: 32-bar intro, verses, builds, choruses, breakdown, drop, outro. House-scale structure. |

**Loop** has no Arranger — engine runs with flat defaults. **Wave/Arc/Journey**
each have a distinct arrangement template defined in the preset.

### Seed-Dependent Structural Variation (Within a Length)

The variation seed can influence *some* structural details within a length
template, as long as the overall duration and energy shape stay consistent:

| What can vary per seed | What stays fixed |
|------------------------|-----------------|
| Fill positions (loop 1,5,9,13 vs. 2,6,10,14) | Total loop count |
| Which loops get light vs. heavy fills | Section order (intro before verse, etc.) |
| Riser sweep parameters (range, Q) | Energy envelope shape |
| Whether breakdown is 2 or 4 loops (Arc/Journey) | Overall duration (±1 loop max) |
| Chord substitutions within the key (e.g., Dm vs. F in a slot) | Key / tonic |

This means two people sharing the same grid + same length but different seeds
get recognizably the same song with different flavor — like two DJs playing
the same track.

### Considered and Rejected

- **Named lengths (Short/Medium/Long/Epic):** "Short" sounds lesser. Energy
  shapes are choices, not quality tiers.
- **Continuous slider:** Hard to know what you get at 0.6. Discrete options
  are better for structure.
- **Grid density drives length:** Zero UI but removes user agency. A user
  might want a long ambient piece with a sparse grid.
- **Dice picks the arrangement template:** Confusing — user expects a
  certain duration. Seed should vary interpretation, not structure.

### Song Length × Share URL

Song length needs to encode in the share URL so a shared link plays the
same duration. 2 bits = 4 options (Loop/Wave/Arc/Journey).

Proposed: use **2 bits from byte 14** for song length. Combined with the
variation seed (4 bits in byte 13) and tempo expansion (6 bits in byte 9),
all three new features fit within v1 reserved space:

```
Byte 9:  Mutes[7:6] | ExtendedTempo[5:0]     (was: Mutes[7:6] | Reserved[5:0])
Byte 13: Vol bass[7:4] | Variation[3:0]        (was: Vol bass[7:4] | Reserved[3:0])
Byte 14: SongLength[7:6] | Reserved[5:0]       (was: fully reserved)
```

Old URLs have all these bits as 0 → decodes as: original tempo, variation 0,
song length 0 (= Wave, the current default). Backward compatible.

### Open Questions — Playback Modes

- **Naming:** Loop / Wave / Arc / Journey are working names. Need to
  ear-test whether these feel right in the UI, or if simpler labels
  (icons only? abstract symbols?) work better.
- **Does Loop mode need energy variation?** Flat energy is simplest, but a
  slow sinusoidal breathe (in/out over ~8 loops) could keep it from feeling
  static. Try both by ear.
- **Chord progression in Loop mode?** Options: (a) tonic only (simple, safe),
  (b) cycle through A-section chords on repeat (adds harmonic movement
  without arrangement), (c) seed-dependent chord cycling rate. Leaning (b).
- **Transition while playing?** Switching length mid-session → restart from
  intro (safest). Switching to/from Loop → immediate (no arrangement to
  interrupt).
- **Arc and Journey arrangement templates:** Need to be composed. Wave
  (current 16-loop arrangement) exists. Arc and Journey are new musical
  design work — compose by ear, not by formula.
- **UI placement:** Selector near the play button? In the settings area?
  As a segmented control or discrete buttons? Needs to feel like a
  first-class choice without overwhelming the simple "place cells, hit play"
  flow for new users.

---

## Open Questions — Variation Seed

- **When does a new seed take effect?** Next loop boundary (clean) vs. next
  step (immediate)? Try both, decide by ear.
- **Should the dice auto-roll on first play?** If variation 0 is always the
  default, every shared URL that doesn't set a seed sounds the same as
  "no variation." That's fine for backward compat, but we could randomize
  on first play to encourage exploration. Risky — might confuse users who
  expect determinism.
- **16 seeds enough?** 4 bits = 16 variations. For a casual tool this is
  probably plenty. If we need more, byte 14 has 8 more bits available.
- **Interaction with future presets:** Each preset's interpreter already owns
  its PRNG usage. Variation seed naturally works per-preset since it feeds
  into the same `createPRNG` call. No special handling needed.
