# Design System — beats.me

## Product Context
- **What this is:** A browser-based step sequencer where non-musicians place tiles on a grid, a playhead sweeps and triggers sounds, and invisible harmonic constraints make everything sound good
- **Who it's for:** Non-musicians, casual web users, Incredibox fans, ambient music fans
- **Space/industry:** Music toys / casual games (peers: Incredibox, Chrome Music Lab Song Maker, Sprunki)
- **Project type:** Single-page web app (Vite + React + Tailwind, deployed to custom domain)

## Aesthetic Direction
- **Direction:** Retro-Futuristic / Synth-wave — dark surfaces, neon glow accents, grid lines that feel like hardware sequencer LEDs
- **Decoration level:** Intentional — subtle glow effects on active cells, soft bloom on the playhead. Not minimal (too cold for a toy), not expressive (too noisy for a grid)
- **Mood:** The love child of Ableton's professionalism and a neon-lit arcade cabinet. Dark and atmospheric but approachable — signals "this makes real music" while the constraints ensure it actually does
- **Reference sites:** Ableton Live (dark theme authority), Incredibox (toy accessibility), Sprunki (aesthetic subversion)

## Typography
- **Display/Hero:** JetBrains Mono 700 — "beats.me" hero text in multi-colored neon, 48px. 8-letter rainbow palette (red/orange/yellow/green/cyan/muted/purple/pink), not tied to row colors.
- **UI/Labels:** System sans-serif — button text, controls
- **Data/Mono:** JetBrains Mono 400 — BPM display, shape icons, mixer labels
- **Body:** N/A — this is a toy, not a content site. Almost no body text exists.
- **Loading:** Google Fonts via `<link>` (JetBrains Mono ~25KB)
- **Scale:** 12px+ (shape icons) / 11px (button text, BPM label) / 14px (BPM value) / 64px (hero)

### CSS Variables
```css
--font-ui: 'Space Grotesk', system-ui, sans-serif;  /* available but hero uses --font-mono */
--font-mono: 'JetBrains Mono', monospace;
```

## Color
- **Approach:** Restrained — one accent (cyan) + blue-black neutrals. Color is rare and meaningful. The accent IS the product — it's the color of active cells, the glow, the life in the grid.

### Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#0a0e17` | Page background (deep blue-black, not pure black) |
| `--surface` | `#141a2a` | Grid container, elevated panels |
| `--cell-inactive` | `#2a3350` | Empty grid cells (visible but recessed) |
| `--cell-hover` | `#353f62` | Cell hover state background |
| `--cell-active` | `#00e5ff` | Filled grid cells (cyan — the signature accent) |
| `--cell-active-dim` | `rgba(0, 229, 255, 0.15)` | Active cell hover state on inactive cells |
| `--cell-glow` | `rgba(0, 229, 255, 0.4)` | Glow/bloom around triggered cells |
| `--playhead` | `rgba(255, 255, 255, 0.15)` | Playhead column background wash |
| `--playhead-line` | Not implemented | Playhead leading edge line (planned, not yet in CSS) |
| `--text` | `#c8d6e5` | Primary text (soft blue-white, not harsh white) |
| `--text-dim` | `#7a8ba0` | Secondary text, section labels |
| `--muted` | `#5a6a8a` | Row shape icons, tertiary text, borders |
| `--border` | `rgba(90, 106, 138, 0.15)` | Subtle borders on panels |

### Cell States

Cells are on/off. Each row has its own color (per-instrument identity).

| State | Background | Box-shadow | When |
|-------|-----------|------------|------|
| Inactive | `--cell-inactive` | none | Empty cell (value 0) |
| Active | Row color | `0 0 Npx` row glow (N = max(8, cellSize×0.25)) | Filled cell (value 1) |
| Muted | Row color at 30% opacity | none | Row is muted via shape toggle |

Focus ring: `ring-2 ring-white/50` (keyboard navigation).

### Row Colors (top to bottom)

| Row | Color | Hex |
|-----|-------|-----|
| sparkle (◇) | cyan | `#00e5ff` |
| rhythm (◯) | green | `#00ff88` |
| groove (◻) | purple | `#b44dff` |
| pulse (▽) | red | `#ff4444` |

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — the grid needs breathing room between cells
- **Cell gap:** 3px (the grid lines are the negative space between cells)

### Scale
| Token | Value |
|-------|-------|
| 2xs | 2px |
| xs | 4px |
| sm | 8px |
| md | 16px |
| lg | 24px |
| xl | 32px |
| 2xl | 48px |
| 3xl | 64px |

## Layout
- **Approach:** Grid-disciplined — the grid IS the product. Everything else is peripheral.
- **Grid cells:** Responsive square cells (24-64px), computed from 80% viewport width. Grouped in beat pairs.
- **Grid columns:** 16 sub-columns (pairs of 2 = 8 beats). 8px gap between beat pairs, 2px within.
- **Grid rows:** 4 (sparkle, rhythm, groove, pulse — lightest to heaviest). Each row has its own color.
- **Row shapes:** Unicode symbols per row (◇ ◯ ◻ ▽), colored to match row. Static labels (not interactive) — dim when row is muted via mixer panel. No text labels — sounds teach identity.
- **Step LEDs:** 8 dots below the grid, aligned under the left sub-column of each beat pair
- **EQ Visualizer:** 5-band × 8-segment LED display centered below step LEDs. Each band is 3 squares wide (6px × 6px squares, 2px gap vertical, 3px gap between bands). ~47px wide × 62px tall. Driven by actual sounds played (via `engine.onSounds()`, not FFT). Bands left→right: sub (kick/bass), low-mid (groove/pad/stabGroove), mid (stab), hi-mid (hat), air (sparkle/arp). VU gradient bottom→top: deep navy `#122040` → teal `#0099bb` → cyan `#00e5ff` → bright white `#eef8ff`. Peak hold dots linger 180ms then decay. 60fps rAF decay loop (levels at 4/s, peaks at 2.5/s). Energy scales max height. Pad contributes sustained baseline to low-mid band.
- **Playhead dimming:** When arrangement mutes drums on a row (`drumProbs[row] = 0`), the playhead glow on that row dims to 15% opacity. Scales linearly: `glowOpacity = 0.15 + prob × 0.85`.
- **Loop dots:** Planned but not yet implemented. Will show chord phase as 4 dots below step LEDs.
- **Controls:** Bottom bar, three zones: Left = Play (56px, cyan pulsing glow when stopped) + Share (56px, box+arrow icon); Center = metronome icon + BPM slider; Right = Clear/Reset/Volume (48px grey ghost buttons). Grid gets visual priority.
- **Mixer:** Volume sliders hidden by default, toggled via speaker icon. Opens as floating overlay panel. Per-channel: shape icon (18px) + speaker mute toggle (22px) + volume slider (90px). Top section: 4 drum rows (sparkle→pulse, top to bottom). Separator. Bottom section: synth layers ordered stab→pad→bass (highest to lowest frequency, top to bottom).
- **Hero:** "beats.me" in multi-colored neon text, 64px. 8-letter rainbow palette independent of row colors. Dot character uses muted color.
- **Cell click preview:** Toggling a cell ON plays that row's sound immediately. AudioContext initializes on first click.
- **Cell drag-painting:** Pointer drag fills/clears multiple cells based on first click direction.
- **BPM slider:** Range 60-180, step 20, updates tempo live including pad LFO rate.
- **Clear vs Reset:** Clear empties the grid. Reset restores the default starter pattern with staggered reveal.
- **Staggered reveal:** On initial load and reset, cells fill in one by one over ~1.2s in shuffled order. Starts from empty grid. Reinforces the no-tutorial philosophy — shows the user what "placing cells" looks like. No preview sounds during reveal. User can interact during the animation.
- **Responsive cell sizing:** `computeCellSize()` uses `window.innerWidth * 0.80`, minus gaps (64px) and shape column (32px), clamped 24-64px per cell.

### Border Radius
| Token | Value | Usage |
|-------|-------|-------|
| sm | 4px | Small elements, mobile cells |
| md | 3px | Grid cells |
| lg | 10px | Panels, cards |
| xl | 14px | Grid container |
| full | 999px | Pills, badges |

### Responsive
- **Desktop:** Responsive cells (up to 64px), 16 sub-columns, shape labels, controls below grid
- **Mobile:** Cells scale down (min 24px), grid scrolls horizontally if needed
- **The grid always shows all 16 sub-columns.** Cell size computed from `window.innerWidth * 0.80`.

## Motion
- **Approach:** Intentional — animations serve the musical experience, not decoration

### Rhythmic Animations (tempo-synced)
All rhythmic animations derive their timing from the BPM. At 120 BPM, one beat = 500ms.

| Animation | Duration | Easing | Notes |
|-----------|----------|--------|-------|
| Pulsing cell breathe | 2 beats (1000ms @ 120bpm) | ease-in-out | Opacity 0.35 → 1.0 → 0.35. Synced to transport. |
| Playhead sweep | 1 beat per column | linear | Perfectly synced to Tone.js transport |
| Play button glow | 2s | ease-in-out | Cyan box-shadow pulse when stopped. Invites first click. Killed on play. Respects prefers-reduced-motion. |

### Response Animations (fixed timing)
These respond to user actions or audio events and use fixed durations.

| Animation | Duration | Easing | Notes |
|-----------|----------|--------|-------|
| Cell toggle | < 50ms | ease | Must feel instant, like tapping a hardware button |
| Trigger glow bloom | 150ms | ease-out | Box-shadow expands on playhead hit |
| Trigger glow fade | 300ms | ease-out | Bloom fades back to resting active glow |
| Button hover | 150ms | ease | Border color + subtle background shift |
| Loop boundary change | 200ms | ease-out | Columns dim/undim when loop resizes |

### Motion Rules
- **No bouncing, no spring physics, no parallax** — this is a precision instrument, not a marketing site
- **Easing:** enter(ease-out), exit(ease-in), state-change(ease)
- `prefers-reduced-motion`: disable glow bloom and pulse animation, keep cell toggle and playhead

## Buttons

| Type | Style | Hover | Usage |
|------|-------|-------|-------|
| Primary | `bg: #00e5ff`, `color: #0a0e17`, weight 600 | Lighter cyan + glow shadow | Main CTA (rare — "Share Beat") |
| Accent | `border: 1px solid rgba(0,229,255,0.3)`, `color: #00e5ff` | Border brightens, subtle bg fill | Secondary actions ("Export") |
| Ghost | `border: 1px solid rgba(90,106,138,0.25)`, `color: #7a8ba0` | Border → cyan, text → cyan | Tertiary ("Reset") |

## Design Risks (deliberate departures from convention)
1. **Cyan accent instead of orange** — Ableton owns orange. Cyan reads as synth-wave/futuristic, matching the emergent complexity feeling. Cost: less "warm," more sci-fi.
2. **Deep blue-black instead of neutral gray** — Most DAWs use gray (#2a2a2a). Blue-black is more atmospheric, more "night sky." Cost: warm-toned modes (amber cells) may need adjusted backgrounds later.
3. **Space Grotesk instead of system font** — Most web sequencers use system fonts. Space Grotesk adds techy personality with ~20KB overhead. Cost: one font to load.
4. **No text on initial load** — No "tap to begin," no instructions. Just a pulsing cell. Cost: some users may not understand what to do. Gain: the "no tutorial" philosophy is the product identity.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-20 | Initial design system created | Created by /design-consultation based on competitive research (Incredibox, Chrome Music Lab, Ableton, Sprunki, muted.io) and product context from /office-hours |
| 2026-03-20 | Cyan (#00e5ff) as signature accent | Ableton owns orange; cyan reads as synth-wave and pops on blue-black background. Complementary temperature contrast. |
| 2026-03-20 | Deep blue-black (#0a0e17) background | Atmospheric, not utilitarian. Night sky feeling matches the mood of emergent generative music. |
| 2026-03-20 | Space Grotesk for UI text | Geometric, techy, distinctive. Matches the grid aesthetic. Minimal text in the app so font weight is negligible. |
| 2026-03-20 | Tempo-synced rhythmic animations | Pulsing cell and any rhythmic visuals derive timing from BPM. The whole app feels like one living instrument, not audio + disconnected animation. |
| 2026-03-20 | Preview: design-preview.html | Font + color + grid mockup preview page for visual validation |
| 2026-03-20 | Share button: text swap feedback | "Share" → "Copied!" for 2s on click. Standard clipboard feedback pattern (GitHub, Figma). |
| 2026-03-20 | Cursor: pointer on all grid cells | Universal clickable signal. Aligns with no-tutorial philosophy — invisible until hover. |
| 2026-03-20 | ~~All cyan for MVP~~ → Per-row instrument colors | Initially one accent color, then 4 behavior colors. Now per-row identity colors: timing is encoded by column position, colors identify instruments. Validated by user testing. |
| 2026-03-20 | Mobile buttons below grid | Grid is full-width, top-aligned on mobile. Share/Reset sit below. Buttons are secondary to grid interaction. |
| 2026-03-20 | Keyboard nav: arrow keys + Space | Grid cells navigable via arrow keys, Space/Enter to toggle. White focus ring (ring-white/50). Tab to Share/Reset. ARIA: role="grid", aria-pressed. |
| 2026-03-29 | Beat-pair gap 6px → 8px | Wider gap makes 4/4 grouping more visible on dark cells. 4:1 ratio (8px between pairs, 2px within). |
| 2026-03-29 | Row shapes are static labels | Muting moved to floating mixer panel (speaker icon toggle + volume slider per channel). Row shapes just indicate identity. |
| 2026-03-29 | Per-voice FX routing | Three spatial buses: dry (kick/hat/bass), plate reverb 1.5s (stab/arp), hall reverb 2.5s (pad). Gentler master compressor (-18dB, 2:1). |
| 2026-03-29 | Layout: top-aligned, no vertical centering | Removed justify-between/center — grid sits close to hero, controls below. Eliminates floating-in-void feeling. |
| 2026-03-29 | Control bar: 3-zone hierarchy | Left: Play+Share (56px cyan circles, primary). Center: metronome+BPM slider. Right: Clear/Reset/Volume (48px grey ghost, demoted). |
| 2026-03-29 | Play button pulsing glow | 2s ease-in-out cyan glow pulse when stopped. Invites first click (no-tutorial philosophy). Killed on play. Respects prefers-reduced-motion. |
| 2026-03-29 | Grid cells bigger: 80%/64px | Widened from 75%→80% viewport, cap 56→64px. Grid dominates the page. |
| 2026-03-29 | Hero 48px → 64px | Larger hero matches the bigger grid. More presence. |
| 2026-03-29 | Mixer synth order: stab→pad→bass | Frequency-ordered top to bottom (highest first), matching drum row convention above the separator. |
| 2026-03-29 | EQ visualizer: faked from step data, not FFT | We know exactly what's playing — FFT adds complexity and noise. Step-driven data gives punchy, beat-quantized visuals. |
| 2026-03-29 | EQ visualizer: VU gradient not per-voice colors | Per-voice colors (5 different hues) compete with the grid's row colors. VU gradient (blue→cyan→white) is cohesive and universally understood. Peak = white glow, not red/pink. |
| 2026-03-29 | EQ visualizer: compact centered, not full-width | Full-width bars looked like progress bars. Small squares (3 wide × 8 tall × 5 bands) echo grid cells. Centered below step LEDs reads as a piece of hardware. |
| 2026-03-29 | EQ visualizer: onSounds direct from audio callback | Routing through the visual ticker (30fps) caused race conditions with Tone.js lookahead. onSounds fires from the audio callback; rAF loop handles rendering independently. |
| 2026-03-29 | Playhead dimming per row via drumProbs | Arrangement mutes drums on specific rows. Playhead glow scales with drum probability (0→15%, 1→100%). Cells stay full brightness — they're still "placed." |
| 2026-03-29 | Staggered cell reveal on load/reset | Default cells fill in one by one (~100ms each, shuffled) over 1.2s. Signals "place cells here" without text. Aligns with no-tutorial philosophy. |
