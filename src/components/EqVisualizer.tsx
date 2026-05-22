import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';

// ---------------------------------------------------------------------------
// EQ Band mapping — sound names → frequency band index
// ---------------------------------------------------------------------------

import { STAB_GROOVE } from '../engine/constants';

/** Map each sound name to its EQ band (0=sub … 4=air) and relative weight */
const SOUND_TO_BAND: Record<string, { band: number; weight: number }> = {
  'pulse':          { band: 0, weight: 1.0 },   // sub — kick
  'bass':           { band: 0, weight: 0.8 },   // sub — bass synth
  'groove':         { band: 1, weight: 1.0 },   // low-mid — tom
  [STAB_GROOVE]:    { band: 1, weight: 0.7 },   // low-mid — groove stab
  'stab':           { band: 2, weight: 0.9 },   // mid — hat stab
  'rhythm':         { band: 3, weight: 1.0 },   // hi-mid — hat
  'sparkle':        { band: 4, weight: 1.0 },   // air — sparkle
  'arp':            { band: 4, weight: 0.8 },   // air — arp
};

const NUM_BANDS = 5;
const NUM_SEGMENTS = 8;

// ---------------------------------------------------------------------------
// VU color gradient — bottom (cool) to top (blinding white)
// 8 segments: deep blue → teal → cyan → bright white
// ---------------------------------------------------------------------------

const SEGMENT_COLORS = [
  '#1a5a8a',  // muted blue
  '#0080b0',  // blue-teal
  '#009acc',  // teal
  '#00b8dd',  // bright teal
  '#00d4f0',  // light teal
  '#00e5ff',  // cyan — the signature accent
  '#aaeeff',  // light cyan
  '#eef8ff',  // bright white
];

const SEGMENT_GLOW = [
  '0 0 2px rgba(26, 90, 138, 0.3)',
  '0 0 2px rgba(0, 128, 176, 0.3)',
  '0 0 3px rgba(0, 154, 204, 0.3)',
  '0 0 3px rgba(0, 184, 221, 0.3)',
  '0 0 4px rgba(0, 212, 240, 0.4)',
  '0 0 5px rgba(0, 229, 255, 0.5)',
  '0 0 6px rgba(170, 238, 255, 0.4)',
  '0 0 8px rgba(238, 248, 255, 0.6), 0 0 16px rgba(0, 229, 255, 0.3)',
];

const SEG_OFF_COLOR = '#1c2438'; // matches --cell-inactive

// ---------------------------------------------------------------------------
// Segment size — small squares echoing the grid cells
// ---------------------------------------------------------------------------

const SEG_SIZE = 8;   // px — square segments
const SEG_GAP = 2;    // px between segments
const BAND_GAP = 3;   // px between band groups
const BAND_WIDTH = 3; // squares per band column

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EqStepData {
  /** Actual sounds scheduled this step (from engine) */
  soundsPlayed: { sound: string; velocity: number }[];
  /** Global energy 0-1 (undefined = 1) */
  energy?: number;
  /** Pad voice probability — pad is sustained, needs special handling */
  padProb?: number;
}

export interface EqVisualizerHandle {
  onStep: (data: EqStepData) => void;
}

interface EqVisualizerProps {
  /** Whether the sequencer is playing */
  playing: boolean;
}

const PEAK_HOLD_MS = 180;     // how long peak dot stays before dropping
const LEVEL_DECAY_PER_S = 4;  // levels/sec — how fast columns fall (higher = snappier)
const PEAK_DECAY_PER_S = 2.5; // levels/sec — how fast peak dot falls

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const EqVisualizer = forwardRef<EqVisualizerHandle, EqVisualizerProps>(
  function EqVisualizer({ playing }, ref) {
    const levelsRef = useRef<number[]>(new Array(NUM_BANDS).fill(0));
    const peaksRef = useRef<number[]>(new Array(NUM_BANDS).fill(0));
    const containerRef = useRef<HTMLDivElement>(null);
    const lastRenderRef = useRef<number[]>(new Array(NUM_BANDS * NUM_SEGMENTS).fill(-1));

    // Direct DOM rendering — no React re-renders
    const renderBands = useCallback(() => {
      const container = containerRef.current;
      if (!container) return;

      for (let b = 0; b < NUM_BANDS; b++) {
        const level = levelsRef.current[b];
        const peak = peaksRef.current[b];
        // Stretch so level 0.85+ lights all segments (top segment was unreachable)
        const litCount = Math.min(NUM_SEGMENTS, Math.ceil(level * (NUM_SEGMENTS + 0.5)));
        const peakSeg = Math.min(NUM_SEGMENTS - 1, Math.round(peak * (NUM_SEGMENTS - 1)));

        for (let s = 0; s < NUM_SEGMENTS; s++) {
          const idx = b * NUM_SEGMENTS + s;
          const isLit = s < litCount;
          const isPeak = s === peakSeg && peak > 0.05 && !isLit;

          // Change detection: avoid redundant style writes
          const stateKey = (isLit ? 1 : 0) + (isPeak ? 2 : 0);
          if (lastRenderRef.current[idx] === stateKey) continue;
          lastRenderRef.current[idx] = stateKey;

          // Update all squares in this segment (BAND_WIDTH per segment)
          const squares = container.querySelectorAll<HTMLElement>(`[data-seg="${b}-${s}"]`);
          for (const sq of squares) {
            if (isLit) {
              sq.style.backgroundColor = SEGMENT_COLORS[s];
              sq.style.boxShadow = SEGMENT_GLOW[s];
              sq.style.opacity = '1';
            } else if (isPeak) {
              sq.style.backgroundColor = SEGMENT_COLORS[s];
              sq.style.boxShadow = SEGMENT_GLOW[s];
              sq.style.opacity = '0.8';
            } else {
              sq.style.backgroundColor = SEG_OFF_COLOR;
              sq.style.boxShadow = 'none';
              sq.style.opacity = '1';
            }
          }
        }
      }
    }, []);

    const peakTimestampRef = useRef<number[]>(new Array(NUM_BANDS).fill(0));

    // onStep: compute levels from actual sounds played, jump up instantly
    const onStep = useCallback((data: EqStepData) => {
      const { soundsPlayed, energy, padProb } = data;
      const energyMul = energy ?? 1;

      // Accumulate contributions per band from actual sounds
      const bandLevels = new Array(NUM_BANDS).fill(0);

      for (const { sound, velocity } of soundsPlayed) {
        const mapping = SOUND_TO_BAND[sound];
        if (mapping) {
          bandLevels[mapping.band] += velocity * mapping.weight;
        }
      }

      // Pad is sustained — contributes to low-mid (band 1) based on prob, not triggers
      if (padProb !== undefined && padProb > 0) {
        bandLevels[1] += padProb * 0.35;
      }

      for (let b = 0; b < NUM_BANDS; b++) {
        const level = Math.min(1, bandLevels[b]) * energyMul;

        // Only jump up — rAF loop handles decay
        if (level > levelsRef.current[b]) {
          levelsRef.current[b] = level;
        }

        // Peak hold: set new peak + timestamp
        if (level >= peaksRef.current[b]) {
          peaksRef.current[b] = level;
          peakTimestampRef.current[b] = performance.now();
        }
      }
    }, []);

    // Expose imperative handle
    useImperativeHandle(ref, () => ({ onStep }), [onStep]);

    // Continuous rAF loop: smooth decay + render at 60fps
    const rafRef = useRef<number | null>(null);
    const lastFrameRef = useRef(0);

    useEffect(() => {
      if (!playing) {
        // Decay to zero when stopped
        const decayOut = () => {
          let anyActive = false;
          const now = performance.now();
          const dt = Math.min(0.05, (now - (lastFrameRef.current || now)) / 1000);
          lastFrameRef.current = now;

          for (let b = 0; b < NUM_BANDS; b++) {
            if (levelsRef.current[b] > 0.001) {
              levelsRef.current[b] = Math.max(0, levelsRef.current[b] - LEVEL_DECAY_PER_S * dt);
              anyActive = true;
            } else {
              levelsRef.current[b] = 0;
            }
            if (peaksRef.current[b] > 0.001) {
              peaksRef.current[b] = Math.max(0, peaksRef.current[b] - PEAK_DECAY_PER_S * dt);
              anyActive = true;
            } else {
              peaksRef.current[b] = 0;
            }
          }
          lastRenderRef.current.fill(-1);
          renderBands();
          if (anyActive) {
            rafRef.current = requestAnimationFrame(decayOut);
          }
        };
        lastFrameRef.current = performance.now();
        rafRef.current = requestAnimationFrame(decayOut);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
      }

      // Playing: continuous decay + render loop
      const tick = (now: number) => {
        const dt = Math.min(0.05, (now - (lastFrameRef.current || now)) / 1000);
        lastFrameRef.current = now;

        for (let b = 0; b < NUM_BANDS; b++) {
          // Smooth level decay
          if (levelsRef.current[b] > 0) {
            levelsRef.current[b] = Math.max(0, levelsRef.current[b] - LEVEL_DECAY_PER_S * dt);
          }

          // Peak: hold for PEAK_HOLD_MS, then decay
          const peakAge = now - peakTimestampRef.current[b];
          if (peakAge > PEAK_HOLD_MS && peaksRef.current[b] > 0) {
            peaksRef.current[b] = Math.max(
              levelsRef.current[b],
              peaksRef.current[b] - PEAK_DECAY_PER_S * dt,
            );
          }
        }

        lastRenderRef.current.fill(-1);
        renderBands();
        rafRef.current = requestAnimationFrame(tick);
      };

      lastFrameRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [playing, renderBands]);

    // Total dimensions
    const bandPxWidth = BAND_WIDTH * SEG_SIZE + (BAND_WIDTH - 1) * SEG_GAP;
    const totalWidth = NUM_BANDS * bandPxWidth + (NUM_BANDS - 1) * BAND_GAP;
    const totalHeight = NUM_SEGMENTS * SEG_SIZE + (NUM_SEGMENTS - 1) * SEG_GAP;

    return (
      <div
        ref={containerRef}
        className="flex items-end justify-center"
        style={{
          width: `${totalWidth}px`,
          height: `${totalHeight}px`,
          gap: `${BAND_GAP}px`,
        }}
        aria-hidden="true"
      >
        {Array.from({ length: NUM_BANDS }, (_, b) => (
          <div
            key={b}
            className="flex flex-col-reverse"
            style={{ gap: `${SEG_GAP}px` }}
          >
            {Array.from({ length: NUM_SEGMENTS }, (_, s) => (
              <div
                key={s}
                className="flex"
                style={{ gap: `${SEG_GAP}px` }}
              >
                {Array.from({ length: BAND_WIDTH }, (_, sq) => (
                  <div
                    key={sq}
                    data-seg={`${b}-${s}`}
                    className="rounded-[1px]"
                    style={{
                      width: `${SEG_SIZE}px`,
                      height: `${SEG_SIZE}px`,
                      backgroundColor: SEG_OFF_COLOR,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  },
);

export default EqVisualizer;
