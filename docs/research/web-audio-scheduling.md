# Web Audio Scheduling Research

Research from three open-source step sequencers, applied to beats.me.

## Sources

1. **Drumhaus** (github.com/mxfng/drumhaus) — React + Tone.js, 16-step, 8 instruments, samples, full FX chain
2. **Tone.js official step sequencer** — canonical Tone.js example + wiki docs
3. **gregjopa/step-sequencer** — raw Web Audio API, no Tone.js, manual look-ahead loop

---

## The Two Clocks Pattern (foundational concept)

All three projects implement the same core idea from Chris Wilson's "A Tale of Two Clocks":

- **JavaScript timer** (setInterval / Web Worker / rAF) — imprecise (~4-16ms jitter), wakes up the scheduler
- **Web Audio clock** (AudioContext.currentTime) — sample-accurate (1/44100s), schedules audio events

The JS timer fires periodically and looks ahead into the future. Any audio events within the look-ahead window get scheduled using the precise Web Audio clock. This decouples scheduling accuracy from JS thread jitter.

### gregjopa's raw implementation:

```js
// setInterval fires every 100ms
var intervalID = setInterval(schedulerLoop, 100);

function schedulerLoop() {
  // Look 100ms ahead of current audio time
  var nextNoteStartTime = self.AC.currentTime + 0.1; // look-ahead offset
  self.scheduleStep(freq, stepLength, nextNoteStartTime);
}
```

### Tone.js wraps this with:
- `context.updateInterval` = 30ms (how often the JS timer fires)
- `context.lookAhead` = 100ms (how far ahead events are scheduled)
- Total latency: ~130ms — fine for a sequencer (not a live instrument)
- Uses Web Workers internally to avoid main-thread timer throttling

---

## Anti-Pattern #1: Not Passing `time` (our bug)

This is the **number one cause of jank** in Tone.js sequencers.

```ts
// BAD — uses Tone.now() which has ~100ms jitter
loop callback → player.play(sounds)
                  → voice.trigger(vel, dur, Tone.now() + offset)

// GOOD — uses the precise scheduled time from Transport
loop callback(time) → player.play(sounds, time)
                        → voice.trigger(vel, dur, time + offset)
```

The `time` argument in Transport callbacks is the **exact** audio-clock time when the event should fire. Using `Tone.now()` instead gives you "whenever JS happened to run this callback" which drifts by 30-130ms.

**beats.me fixed this** — SoundEngine passes `time` from the Transport callback through to Player.play().

---

## Scheduling API Comparison

| API | How it works | Best for |
|-----|-------------|----------|
| `Transport.scheduleRepeat(cb, interval)` | Lowest level. You track step index. | Custom scheduling logic |
| `Tone.Loop(cb, interval)` | Wraps scheduleRepeat with start/stop. | Simple repeating events |
| `Tone.Sequence(cb, events, subdivision)` | Passes array values to callback. Loops. | When Tone.js owns the step data |

### What Drumhaus uses: `Tone.Sequence`

```ts
const sequence = new Sequence(
  (time, step: number) => {
    // step is 0-15, provided by the sequence
    schedulePrecomputedStep(hits, step, Time(time).toSeconds(), ...);
  },
  [0, 1, 2, 3, ..., 15],  // SEQUENCE_EVENTS
  "16n",                    // SEQUENCE_SUBDIVISION
);
sequence.start(0);
```

### What's right for beats.me: `scheduleRepeat` or `Tone.Loop`

Our Scheduler owns all the step logic (lookahead, pending events, interpreters). We don't want `Tone.Sequence` fighting for control of the step data. A bare clock tick is what we need.

---

## How Drumhaus Handles Visuals (avoid React re-renders)

Drumhaus does NOT use `Tone.Draw.schedule()` or setState in the audio callback. Instead:

### Separate rAF ticker capped at 30fps

```ts
const FRAME_INTERVAL = 1000 / 30; // 30 FPS cap

const tick = (now: number) => {
  if (now - lastFrameTime >= FRAME_INTERVAL) {
    const currentStep = getCurrentStepFromTransport(); // reads Transport.ticks
    if (currentStep !== lastStep) {
      listeners.forEach(listener => listener({ currentStep }));
    }
  }
  requestAnimationFrame(tick);
};
```

### Step position derived from Transport ticks (not callbacks)

```ts
function getCurrentStepFromTransport(): number {
  const ticks = getTransport().ticks;
  const ticksPerStep = Ticks("16n").valueOf();
  return Math.floor(ticks / ticksPerStep) % STEP_COUNT;
}
```

This is smart: the visual ticker is **completely decoupled** from the audio scheduler. The audio callback never touches React. The visual loop just reads the Transport's current tick position independently.

---

## Effects Chain Architecture

### Drumhaus (production-grade):

```
instruments → compressor (parallel: wet+dry paths)
            → low-pass filter → high-pass filter
            → phaser send (pre-filtered, keeps bass clean)
            → reverb send (pre-filtered at 250Hz, keeps kick dry)
            → saturation → presence dip EQ → high shelf EQ
            → limiter → destination
```

Key details:
- Reverb pre-filtered at 250Hz — low end stays dry (kick doesn't mud up)
- Compressor: parallel compression (wet/dry mix), 10ms attack, 50ms release
- Limiter at -1dB as a final safety net
- High shelf at 8kHz rolls off -1.5dB (tames harsh hats)
- Presence dip at 3.5kHz removes "ice pick" frequencies

### beats.me (current):

```
instruments → compressor → reverb → destination
```

Good enough for MVP but when sound quality matters, the Drumhaus chain is the reference.

---

## Timing Features Worth Knowing

### Drumhaus: Flam (15ms grace note)

```ts
const FLAM_OFFSET_SECONDS = 0.015; // 15ms before main hit
const FLAM_GRACE_VELOCITY = 0.6;   // 60% of main velocity

if (hasFlam) {
  triggerInstrumentAtTime(runtime, tune, decay, time - 0.015, vel * 0.6);
}
triggerInstrumentAtTime(runtime, tune, decay, time, vel);
```

This is similar to our pink double-beat but uses absolute seconds (15ms) instead of beat-relative offset. At 120 BPM, our 0.5 beat offset = 250ms, which is much wider — more of a "double hit" than a "flam."

### Drumhaus: Ratchet (32nd note repeat)

```ts
const RATCHET_OFFSET_BEATS = 0.125; // 1/32 note
if (hasRatchet) {
  const ratchetTime = time + 0.125 * (60 / bpm);
  triggerInstrumentAtTime(runtime, tune, decay, ratchetTime, vel);
}
```

### Drumhaus: Timing Nudge (per-voice swing)

Each voice can be nudged forward/backward in time independently, allowing per-instrument groove feel.

### Drumhaus: Precomputed Patterns

On every pattern change, Drumhaus precomputes a lookup table of which voices fire on which steps. The audio callback does a simple array lookup instead of iterating all voices × all steps.

```ts
// Precomputed: stepsByVariation[variationIndex][stepIndex] → PrecomputedHit[]
const hitsForStep = precomputedPattern.stepsByVariation[variation][step];
```

This is a good optimization if pattern computation gets expensive (which it might as our interpreters get more complex).

---

## Takeaways for beats.me

### Fixed:
1. ~~**Pass `time` from Transport callback through to Player.play()**~~ — DONE
2. ~~**Player.play() should use `time` instead of `Tone.now()`**~~ — DONE
3. ~~**Decouple visual ticker from audio callback**~~ — DONE (separate rAF loop at 30fps reading Transport.ticks)
4. ~~**Cap visual updates at 30fps**~~ — DONE (VISUAL_FRAME_INTERVAL = 1000/30)

### Worth considering later:
5. **Pre-filter reverb** — high-pass the reverb send at ~250Hz so kick/bass stays dry
6. **Add a limiter** at the end of the effects chain (-1dB brickwall)
7. **Precompute pattern lookups** if interpreter logic gets expensive
8. **Per-voice timing nudge** for groove/feel
9. **Transport swing** — Tone.js has built-in swing support via `Transport.swing` and `Transport.swingSubdivision`
