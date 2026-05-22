# beats.me — Project Context

**Stack:** Vite, React, TypeScript, Tone.js, Tailwind CSS (plain — no shadcn/ui), static HTML deploy to custom domain
**No backend, no auth, no database.** All logic is client-side.

---

## Reference Docs — Read these when relevant

| File | Read when... |
|------|-------------|
| `docs/designs/sound-engine.md` | Sound engine architecture — Scheduler/Player/Engine APIs, modes, testing model |
| `docs/designs/synthwave-preset.md` | Synthwave preset design — 4-layer grid, synth drums, arp system, FX routing, **arrangement system (A/B sections, layer muting, song arc, chord progressions)** |
| `docs/designs/variation-seed.md` | Variation seed system — 16 seeds, 7 musical knobs (arp shape, stab inversion, accents, filter offsets, ghost bass density), voice palette selection, key transposition |
| `DESIGN.md` | Making any visual or UI decisions — colors, spacing, motion, cell states |

---

## Git Rules
- **Never commit or push unless explicitly asked.** Code changes and git commits are always separate steps.
- **Never push without explicit confirmation.** Even if asked to commit, do NOT push. Only push when explicitly told to.

## Development Rules

- **Never remove functionality without asking.** Debug code, helper methods, UI controls — always check with the user before deleting anything. Comment out instead of removing if unsure.
- **Plain Tailwind only** — no shadcn/ui or component libraries.
- **Sound engine is NOT a React component.** It's a plain TypeScript module. React doesn't own its lifecycle.
- **Bug fix → test required**: Any bug fix should include a test if a testing framework is set up.
- **Player tests use a full `vi.mock('tone')`** — function constructors that track created nodes. Tests verify graph wiring and gain ramps, not audio output. See `Player.test.ts`.
- **Extract shared code**: If the same logic appears in more than one place, extract it. Use good judgement on when the abstraction is worth it.
- **Don't over-abstract**: Avoid abstractions for hypothetical future use cases. Prefer clarity over cleverness.
- **useRef for playhead visuals**: Never use React `useState` for per-step playhead updates — use `useRef` + `requestAnimationFrame` to avoid jank.

## Key Architecture

- **Thin Seam**: Clean boundary between grid (React) and sound engine (Tone.js module). Engine receives full grid state + cursor + real-time events.
- **Events for engine → grid**: `onStep({ column, loopCount, chordIndex, triggered, drumProbs, sectionLabel, energy, voiceProbs })` callback for playhead sync, chord progression tracking, trigger visuals, and arrangement-driven dimming.
- **Cells are triggers, not gates**: Sound engine controls sustain/decay and handles collision with next trigger.
- **Changes take effect next loop**: Mid-loop edits apply on the next loop pass.
- **Seeded PRNG**: Same grid state = same emergent behavior. Required for share-via-URL consistency.
- **Preset system**: All musical params in `src/presets/`. `configFromPreset()` derives EngineConfig. Interpreter is data-driven via `kit[].bass`, no hardcoded instrument names.
- **Voice palettes**: `src/presets/voicePalettes.ts` — seed picks a sonic character (default/grit/glass). `applyVoicePalette()` merges partial config overrides. Stab and pad support optional `saturationWet`/`saturationOrder` for Chebyshev waveshaping.
- **Transposition**: `transposeConfig()` shifts all chords, scale, and arrangement by N semitones. Seed picks -3 to +4 (F#m–C#m), applied in `getConfigForPlayback()` after palette + arrangement.
- **Long arrangement**: `src/arrangement/` — seed-driven generator picks archetype (7 structural shapes), chord pools for each section (intro/A/B/resolution), voicing tier. `generateLongArrangement(seed, chordMap) → Arrangement`.
- **SoundEngine extra APIs**: `setMode(mode)` for runtime mode swap, `setVolume(name, value)` for per-voice volume, `ensureReady()` for lazy AudioContext init, `triggerPreview(sounds: ScheduledSound[])` for multi-sound cell click preview, `onSounds()` callback for EQ visualizer data.
- **Playback modes**: Three modes cycled via button: `short` (preset arrangement), `long` (seed-driven `generateLongArrangement()`), `loop` (infinite, strips arrangement). Mode change disposes and recreates engine.
- **Share-via-URL**: `src/lib/share.ts` — 16-byte binary payload (grid + tempo + mutes + volumes + variation + playbackMode) encoded as base64url in URL hash (`#v1:...`). `buildShareUrl()` / `decodeShareHash()`. No compression library needed.
- **Analytics**: `src/lib/analytics.ts` — PostHog (cookieless, `persistence: 'memory'`, prod-only). 8 events: page_load, play_start, play_complete, share_click, dice_roll, mode_change, session_engaged (30s), session_end. Sentry for error tracking (`src/main.tsx`, prod-only).
- **EQ Visualizer**: `src/components/EqVisualizer.tsx` — 5-band x 8-segment LED display driven by `engine.onSounds()` (not FFT). Imperative handle via `forwardRef`/`useImperativeHandle`. 60fps rAF decay loop.
- **Mute toggles**: Floating mixer panel (speaker button in bottom-right settings group) shows all channels. Top section: 4 drum rows (sparkle→pulse). Bottom section: synth layers ordered stab→pad→bass (highest to lowest frequency). Each channel has a shape icon (static label) + speaker mute toggle + volume slider. Mute saves/restores pre-mute volume.
