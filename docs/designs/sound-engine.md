# Sound Engine Architecture

## Three Layers

```
┌─────────────────────────────────────────────────────┐
│                    SoundEngine                       │
│  Orchestrator — owns transport, coordinates layers   │
│                                                      │
│  Every beat:                                         │
│    scheduler.step(column, context) → ScheduledSound[]│
│    player.play(sounds, time)       → audio           │
│    visual ticker (rAF @ 30fps)     → grid visuals    │
│                                                      │
│  ┌─────────────────┐    ┌─────────────────────────┐ │
│  │    Scheduler     │    │        Player            │ │
│  │                  │    │                          │ │
│  │  Pure logic.     │    │  Thin Tone.js wrapper.   │ │
│  │  No audio.       │    │  No music logic.         │ │
│  │  No Tone.js.     │    │  Just plays what it's    │ │
│  │  Deterministic.  │    │  told.                   │ │
│  │  Instant.        │    │                          │ │
│  │  Testable.       │    │  Testable (mocked        │ │
│  │                  │    │  Tone.js — graph          │ │
│  │  Owns: music     │    │  wiring + gain ramps).   │ │
│  │                  │    │                          │ │
│  │                  │    │  Owns: instruments,      │ │
│  │                  │    │  effects chains,          │ │
│  │  rules, pending  │    │                          │ │
│  │  future events,  │    │                          │ │
│  │  CellInterpreter │    │                          │ │
│  │  delegation.     │    │                          │ │
│  └─────────────────┘    └─────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## APIs

### SoundEngine (public API)

```ts
interface SoundEngineAPI {
  // Lifecycle
  start(): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  dispose(): void;

  // Input — engine receives grid immediately on every change.
  // It decides when and how to act on the new state.
  updateGrid(grid: GridState): void;
  updateConfig(config: EngineConfig): void;

  // Output — visual ticker emits at 30fps via rAF, decoupled from audio
  onStep(callback: (event: StepEvent) => void): void;

  // Mode + volume
  setMode(mode: Mode): void;
  setVolume(name: string, value: number): void;

  // Preview (cell click plays sound immediately)
  ensureReady(): Promise<void>;
  triggerPreview(sounds: ScheduledSound[]): void;

  // Debug / testing (event log deferred — returns empty for now)
  getEventLog(): GridEvent[];
}
```

### Scheduler (pure logic, no audio)

```ts
interface SchedulerAPI {
  setGrid(grid: GridState): void;
  setConfig(config: EngineConfig): void;
  step(column: number, context: { loopCount: number }): ScheduledSound[];
  getPendingEvents(): ScheduledSound[];
}
```

The Scheduler holds the full grid state and delegates cell interpretation to a
`CellInterpreter` function, which can be swapped per mode. The interpreter
receives the grid in its context for lookahead into neighboring columns.

### CellInterpreter (pluggable per mode)

```ts
type CellInterpreter = (
  cell: { row: number; col: number; value: CellValue },
  context: { loopCount: number; tick: number; grid: GridState },
) => ScheduledSound[];
```

The interpreter decides what each cell value means. With the 16 sub-column
grid, the default interpreter is a simple passthrough: active cell = play
sound at offset 0. More complex interpreters can produce multiple sounds
per cell for future modes.

### Player (Tone.js wrapper)

```ts
interface PlayerAPI {
  init(config: EngineConfig): Promise<void>; // create audio context, build instruments from preset
  dispose(): void;             // release audio resources
  play(sounds: ScheduledSound[], time: number): void;  // schedule at precise time
  stopAll(): void;             // silence everything immediately
  startTransport(tempo: number): void;
  stopTransport(): void;
  pauseTransport(): void;
  resumeTransport(): void;
  triggerPreview(sounds: ScheduledSound[]): void;  // play a single sound immediately (cell click)
  mute(name: string): void;    // disconnect per-voice gain (silence a voice)
  unmute(name: string): void;  // reconnect per-voice gain
  setVolume(name: string, value: number): void;  // 0-1 linear per-voice volume
}
```

The Player doesn't know about grids, cells, behaviors, or history. It receives
`ScheduledSound[]` and a precise Transport `time`, and triggers voices.

**Critical:** `time` must be the exact value from the Transport callback, not
`Tone.now()`. Using `Tone.now()` causes 30-130ms jitter. See
`docs/research/web-audio-scheduling.md` for details.

## Data Types

### StepEvent (engine → grid visuals)

```ts
interface StepEvent {
  column: number;
  loopCount: number;
  chordIndex: number;
  triggered: { row: number; value: CellValue }[];
  effects?: CellEffect[];
}
```

### ScheduledSound (scheduler → player)

```ts
interface ScheduledSound {
  row: number;
  col: number;
  value: CellValue;
  beatOffset: number;       // 0 = on beat, 0.5 = half beat later, etc.
  sound: string;            // key into the Player's voice map
  velocity: number;         // 0-1
  duration?: number;        // in beats
}
```

With the 16 sub-column grid, each active cell produces one sound at offset 0.
Future modes may produce multiple sounds per cell.

### GridEvent (event log — deferred)

```ts
type GridEvent =
  | { type: 'set'; row: number; col: number; value: CellValue; tick: number }
  | { type: 'step'; column: number; loopCount: number; tick: number }
```

The event log is designed but not yet implemented. The Scheduler tracks a `tick`
counter to support future retrofit. `SoundEngine.getEventLog()` currently
returns `[]`.

## Preset System

All musical parameters are defined in a `Preset` object (`src/presets/`).
`EngineConfig` is derived from a preset via `configFromPreset()`. Swapping
presets reconfigures the entire engine — kit, bass, pad, chord progression,
scale, and approach tone weights.

A `Preset` contains:
- `kit[]` — per-row: name, shape (unicode icon), sample path, volume, color,
  optional `bass` config (noteType, soundKey, probability, velocity, approachWeights),
  optional `stab` config (soundKey, velocity, probability, offbeatVelocity)
- `pad` — oscillator, spread, filter/volume LFO ranges, pan LFO (range + rate multiplier), envelope, shape icon
- `bass` — oscillator, filter cutoff, volume, shape icon
- `scale`, `chordProgression` — harmony

The interpreter is fully data-driven: it reads `kit[row].bass` to decide
what each row triggers. No instrument names are hardcoded in the engine.
The `soundKey` field in `RowBassConfig` connects the interpreter's output
to the Player's voice map (e.g. `soundKey: 'bass'`).

## How Modes Work

The complexity difference between modes lives entirely in the
`CellInterpreter`. The Player is always "play this sound at this velocity at
this time."

### Mode 1: Drum Sequencer (current)

16 sub-columns (pairs of 2 = 8 beats). Each row = one instrument with its
own color and unicode shape icon. Cells are on/off — timing is encoded by
column position. No text labels — shapes and colors identify instruments.

| Row | Shape | Color  | Sound  | Voice type | Bass trigger |
|-----|-------|--------|--------|-----------|-------------|
| 0   | ◇     | Cyan   | sparkle (cymbal) | `synth-cymbal` (noise 3-band) | none |
| 1   | ∙     | Magenta| rhythm (hat)     | `synth-hat` (6 square osc) | pad pulse + stab (65% prob, offbeat vel ×0.6) |
| 2   | ◻     | Yellow | groove (snare)   | `noise-snare` (noise + sine body) | 5th (85%, vel 0.5) |
| 3   | ▼     | Pink   | pulse (kick)     | `kick-sweep` (sine sweep + noise click) | root (100%) |

Transport steps at `'8n'` (eighth notes). The interpreter is a simple
passthrough: active cell = play sound at offset 0, velocity 0.7.

The synthwave preset uses fully synthesized drums (no samples). The debug
preset still uses 808 samples (`public/samples/`). Voice type is set via
`synthType` in the kit row config; sample-based voices use `sample` instead.

## Auto-Generated Layers

These layers are not controlled by the grid — they follow the chord
progression automatically.

### Bass

Synth bass (triangle + sub octave sine + Chebyshev saturation + low-pass filter) triggered
on kick hits. Plays the root of the current chord. On "and" columns with
adjacent kicks, selects a diatonic approach tone via seeded PRNG:
root (65%), 5th (13%), step below (10%), step above (7%), 4th (5%).

Voice leading at chord boundaries: approach tones resolve into the next
chord. `getChordAt()` abstraction supports future mid-pattern chord changes.

### Pad

`PolySynth` with `fatsawtooth` (3 detuned oscillators, ±30 cents spread).
Held chords that change on each loop pass. Low-passed at 800Hz with -24dB
rolloff. Filter cutoff LFO tempo-synced (one cycle = 2 loops), range 400-1200Hz.
Volume LFO in phase with filter (louder when brighter, 0.75-1.0 range).

Voicings are stacked 5ths (root-5th-9th), stored in `Chord.voicing`:
- Am: A2, E3, B3
- F: F2, C3, G3
- C: C3, G3, D4
- G: G2, D3, A3

The pad is managed directly by `SoundEngine` (not through the Scheduler).
It calls `player.changePadChord(voicing)` on chord changes.

### Chord Progression

Am → F → Dm → G, one chord per loop pass, cycles every 4 loops.
Chord index shown in a LED row below the step indicators.

### Volume Control & Mute

Per-voice `Tone.Gain` nodes allow real-time volume adjustment (0-1 linear)
for all drums, bass, and pad. Exposed via `SoundEngine.setVolume(name, value)`.

**Mixer UI:** Floating panel triggered by speaker button in the bottom control
bar. Shows all 7 channels (4 drum rows + bass/pad/stab) separated by a divider.
Each channel: shape label (static, not interactive) + speaker icon (mute toggle)
+ volume slider. Mute disconnects the per-voice gain node; slider position is
preserved so relative volumes are maintained on unmute. Row shape icons on the
grid are static labels — mute is only available through the mixer panel.

### Future Modes
- Drum Pattern Generator: one row controls the entire drum kit
- Harmonic Generator: arpeggios and melodies derived from grid patterns

## Pending Events

When a cell triggers sounds over future beats (beatOffset >= 1.0), they're
stored as pending events in the Scheduler. On each step:

1. Age all pending events by 1 beat (decrement beatOffset by 1.0)
2. Collect matured events (beatOffset < 1.0) into the immediate output
3. Interpret active cells in the current column
4. Split new sounds: beatOffset < 1.0 → immediate, >= 1.0 → pending

## Visual Ticker (decoupled from audio)

The audio callback (Transport `scheduleRepeat`) must stay lean — no DOM, no
React. Visual updates use a separate `requestAnimationFrame` loop capped at
30fps that reads `Transport.ticks` to derive the current step position. This
is the same pattern used by Drumhaus and recommended by the Tone.js wiki.

## Testing Model

### Scheduler (pure logic — no mocks needed)

```ts
const scheduler = new Scheduler(config);
scheduler.setGrid(gridWith(6, 16, [[5, 0, 1], [1, 4, 1]]));

// Step through columns and assert output
const step0 = scheduler.step(0, { loopCount: 0 });
expect(step0).toContainEqual(
  expect.objectContaining({ sound: 'kick', velocity: 0.7 })
);
```

The `CellInterpreter` can also be tested directly:

```ts
const interpret = createLiteralInterpreter(config);
const sounds = interpret(
  { row: 5, col: 0, value: 1 },
  { loopCount: 0, tick: 1, grid }
);
expect(sounds).toHaveLength(2); // kick + bass
```

### Player (mocked Tone.js — graph wiring + gain ramps)

The Player is tested by mocking the entire `tone` module with `vi.mock('tone')`.
Mock constructors (`function Gain`, `function Reverb`, etc.) assign spyable
methods to `this` and record every created node in a `createdNodes` array.

Tests verify:
- **Graph topology:** masterGate→destination, reverb→masterGate, compressor→reverb,
  per-voice gains→compressor, pad→reverb (bypasses compressor)
- **Gain ramps:** stopAll ramps to 0, startTransport ramps 0→1, no disconnect
- **Mute/unmute:** disconnect/reconnect targets the correct destination node
- **Stop→restart cycle:** gain goes 1→0→1 with no disconnects (the pop bug)

These tests catch wiring mistakes (e.g. masterGate in wrong position) but
cannot verify actual audio output — that requires a real browser.

## Tone.js Capabilities Used

**Drums (synthwave preset — synthesized, no samples):**
- **Kick** (`kick-sweep`): `Tone.Oscillator` (sine, pitch sweep 180→45Hz, 250ms decay) + `Tone.Noise` (white, highpass 1kHz, 5ms click transient). Per-hit gain nodes for overlap safety.
- **Snare** (`noise-snare`): `Tone.Oscillator` (sine 200→150Hz body, 100ms decay) + `Tone.Noise` (white, bandpass sweep 5k→2kHz, 200ms rattle) + gated `Tone.Reverb` (1.5s decay, hard cut at 270ms). Per-hit gain nodes.
- **Hat** (`synth-hat`): 6× `Tone.Oscillator` (square, inharmonic ratios of 40Hz fundamental) → per-hit Gain → shared bandpass 10kHz → highpass 7kHz. 50ms decay. Per-hit gain nodes for overlap safety (HitPool(4), auto-dispose 200ms). Based on Sonoport Web Audio synthesis guide.
- **Cymbal** (`synth-cymbal`): `Tone.Noise` (white) split to 3 filter bands — attack (bandpass 12k, 80ms), body (highpass 8k→5k, 0.8s), wash (highpass 10k→4k, 1.8s). Per-hit gain+filter nodes for polyphonic overlap (MAX_HITS=4, auto-dispose after 2.5s).

**Drums (debug preset — sample-based):** 808 samples via `Tone.Player`

**Bass:** Per-hit `Tone.Oscillator` (saw, configurable) + sub `Tone.Oscillator` (sine, -3dB × 0.8 vel, MIDI-12) → per-hit lowpass Filter (envelope sweep 2kHz→300Hz, 150ms) → per-hit Gain (amp envelope: 10ms attack, 200ms decay, 0.4 sustain, 300ms release) → shared `Tone.Chebyshev(3)` saturation (40% wet) → shared lowpass filter (500Hz) → dest. Portamento: 50ms frequency glide when previous note within 500ms. HitPool(4), auto-dispose 700ms. Filter envelope + glide are optional BassConfig fields — debug preset omits them for flat behavior.

**Pad:** `Tone.PolySynth` (fatsawtooth + tempo-synced LFOs on filter cutoff and volume). Optional `Tone.Panner` with slow LFO for stereo drift — configurable via `panLfoRange` (e.g. `[-0.3, 0.3]`) and `panLfoRateMul` (e.g. `0.5`). Signal chain: synth → lfoFilter → panner → pulseGain → volumeGain → dest.

**Effects chain:** voices → per-voice Gain → Compressor (-12dB threshold) → Reverb (0.8s decay, 12% wet) → masterGate → destination. Pad bypasses the compressor (padGain → Reverb directly). Synth kick, snare, hat, cymbal, and bass all use per-hit gain nodes that connect to the per-voice gain (which feeds the compressor). Shared utilities: `velToGain(vel, volumeDb)` converts velocity+dB to linear gain; `HitPool(maxHits)` manages per-hit polyphony with auto-dispose. The masterGate sits *after* reverb so ramping it to 0 on stop kills everything including reverb/delay tails — no disconnect/reconnect needed. On start, masterGate ramps from 0→1 over ~15ms to avoid click/pop.

**Mute:** Per-voice Gain nodes disconnected from the compressor (or reverb for pad). Mute state is applied on start via `SoundEngine.start(mutedTracks)`. UI: speaker icon toggle in the floating mixer panel (not the row shape icons, which are static labels).

**Transport:** Master clock via `scheduleRepeat('8n')`, precise `time` passed through to all voice triggers

**Debug:** `ENGINE_DEBUG` flag toggled via browser console (`window.ENGINE_DEBUG = true`). Logs loop position, chord name, and LFO cycle phase every other beat.
