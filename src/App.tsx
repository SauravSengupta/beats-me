import { useState, useCallback, useRef, useEffect } from 'react';
import Grid, { SpeakerMuteButton } from './components/Grid';
import EqVisualizer, { type EqVisualizerHandle } from './components/EqVisualizer';
import { createEmptyGrid, getDefaultCells, toggleCell, setCell } from './lib/grid';
import { DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS, type CellValue, type ScheduledSound } from './lib/types';
import { buildShareUrl, decodeShareHash } from './lib/share';
import { initAnalytics, trackPlayStart, trackPlayComplete, trackShareClick, trackDiceRoll, trackModeChange } from './lib/analytics';
import { SoundEngine } from './engine/SoundEngine';
import { modes, type Mode } from './engine/modes';
import { noteToMidi, midiToNote } from './lib/pitch';
import { generateLongArrangement, buildChordMap } from './arrangement/generator';
import { deriveVariationParams } from './lib/prng';
import { applyVoicePalette } from './presets/voicePalettes';
import { transposeConfig } from './lib/types';

// ---------------------------------------------------------------------------
// Shared style helpers
// ---------------------------------------------------------------------------

const ICON_BTN = 'w-9 h-9 sm:w-12 sm:h-12 flex items-center justify-center rounded-md border transition-colors duration-150';
const ICON_BTN_GHOST = `${ICON_BTN} border-border text-text-dim hover:border-cell-active hover:text-cell-active`;
function toggleBtnClass(isActive: boolean): string {
  return `${ICON_BTN} cursor-pointer ${
    isActive
      ? 'border-cell-active/50 text-cell-active bg-cell-active/10'
      : 'border-border text-text-dim hover:border-cell-active hover:text-cell-active'
  }`;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/** Shuffle array in place (Fisher-Yates) */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Read and clear share hash once at module load, before any React renders.
// This prevents StrictMode's double-effect from losing the hash.
const initialShareState = decodeShareHash(window.location.hash);
if (initialShareState) {
  history.replaceState(null, '', window.location.pathname);
}
initAnalytics(!!initialShareState);

function App() {
  const [mode, setMode] = useState<Mode>(modes[0]);
  const [grid, setGrid] = useState(() =>
    createEmptyGrid(DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS),
  );
  const [playing, setPlaying] = useState(false);
  const revealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [tempo, setTempo] = useState(mode.config.tempo);
  const [showMixer, setShowMixer] = useState(false);
  const [showBpmValue, setShowBpmValue] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const activeColumnRef = useRef(-1);
  const [activeColumn, setActiveColumn] = useState(-1);
  const [, setChordIndex] = useState(-1);
  const [drumProbs, setDrumProbs] = useState<[number, number, number, number] | undefined>(undefined);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const [variation, setVariation] = useState(0);
  const [diceRolling, setDiceRolling] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<'short' | 'long' | 'loop'>('short');
  const [modeLabel, setModeLabel] = useState<string | null>(null);
  const modeLabelTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const preMuteVolumes = useRef<Record<string, number>>({});

  const engineRef = useRef<SoundEngine | null>(null);
  const eqRef = useRef<EqVisualizerHandle>(null);

  /** Derive engine config with playback mode applied. Loop mode strips arrangement. */
  function getConfigForPlayback() {
    // Apply voice palette from variation seed (palette 0 = default, 1+ = alternatives)
    const vp = deriveVariationParams(variation);
    const withPalette = applyVoicePalette(mode.config, vp.voicePalette);
    const base = { ...withPalette, tempo, variationSeed: variation };
    let config;
    if (playbackMode === 'loop') {
      const { arrangement: _, ...rest } = base;
      config = rest;
    } else if (playbackMode === 'long') {
      const chordMap = buildChordMap(mode.config);
      config = { ...base, arrangement: generateLongArrangement(variation, chordMap) };
    } else {
      // 'short' = current preset arrangement
      config = base;
    }
    // Transpose after arrangement is built so all chords shift together
    return transposeConfig(config, vp.transposeShift);
  }

  function getEngine(): SoundEngine {
    if (!engineRef.current) {
      const cfg = getConfigForPlayback();
      const engine = new SoundEngine(
        cfg,
        mode.createInterpreter(cfg),
      );
      engine.onStep((event) => {
        activeColumnRef.current = event.column;
        setActiveColumn(event.column);
        setChordIndex(event.chordIndex);
        setDrumProbs(event.drumProbs);
      });
      // Feed EQ visualizer directly from audio callback (no visual ticker delay)
      engine.onSounds((soundsPlayed, energy, padProb) => {
        if (eqRef.current) {
          eqRef.current.onStep({ soundsPlayed, energy, padProb });
        }
      });
      engine.onComplete(() => {
        trackPlayComplete();
        setPlaying(false);
        setActiveColumn(-1);
        setChordIndex(-1);
        setDrumProbs(undefined);
      });
      engineRef.current = engine;
    }
    return engineRef.current;
  }

  useEffect(() => {
    engineRef.current?.updateGrid(grid);
  }, [grid]);

  useEffect(() => {
    engineRef.current?.updateConfig(getConfigForPlayback());
  }, [tempo, variation, playbackMode]);

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // Staggered reveal: animate cells appearing one by one
  const revealCells = useCallback((cells: [number, number][]) => {
    for (const t of revealTimers.current) clearTimeout(t);
    revealTimers.current = [];
    setGrid(createEmptyGrid(DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS));

    const shuffled = shuffle([...cells]);
    const totalDuration = 1200;
    const interval = shuffled.length > 0 ? Math.floor(totalDuration / shuffled.length) : 100;
    shuffled.forEach(([row, col], i) => {
      const timer = setTimeout(() => {
        setGrid((prev) => setCell(prev, row, col, 1));
      }, (i + 1) * interval);
      revealTimers.current.push(timer);
    });
  }, []);

  const revealDefaultGrid = useCallback(() => {
    revealCells(getDefaultCells(DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS));
  }, [revealCells]);

  // Apply a decoded share state (grid reveal + tempo/mutes/volumes)
  const applyShareState = useCallback((shared: ReturnType<typeof decodeShareHash>) => {
    if (!shared) return;
    // Stop playback if running
    if (engineRef.current) {
      engineRef.current.stop();
      setPlaying(false);
      setActiveColumn(-1);
      setChordIndex(-1);
      setDrumProbs(undefined);
    }
    setTempo(shared.tempo);
    setMutedTracks(shared.mutedTracks);
    setVolumes(shared.volumes);
    setVariation(shared.variationSeed ?? 0);
    setPlaybackMode(shared.playbackMode ?? 'short');
    // Apply volumes to engine
    for (const [name, vol] of Object.entries(shared.volumes)) {
      engineRef.current?.setVolume(name, vol);
    }

    const filledCells: [number, number][] = [];
    for (let r = 0; r < shared.grid.numRows; r++) {
      for (let c = 0; c < shared.grid.numCols; c++) {
        if (shared.grid.cells[r][c] > 0) filledCells.push([r, c]);
      }
    }
    revealCells(filledCells);
  }, [revealCells]);

  // On mount: apply shared URL state or reveal default grid
  // Listen for hashchange so pasting a share URL into the same tab works
  useEffect(() => {
    if (initialShareState) {
      applyShareState(initialShareState);
    } else {
      revealDefaultGrid();
    }

    const onHashChange = () => {
      const shared = decodeShareHash(window.location.hash);
      if (shared) {
        history.replaceState(null, '', window.location.pathname);
        applyShareState(shared);
      }
    };
    window.addEventListener('hashchange', onHashChange);

    return () => {
      for (const t of revealTimers.current) clearTimeout(t);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const handlePlayStop = useCallback(async () => {
    const engine = getEngine();
    if (playing) {
      engine.stop();
      setPlaying(false);
      setActiveColumn(-1);
      setChordIndex(-1);
      setDrumProbs(undefined);
    } else {
      engine.updateGrid(grid);
      await engine.start(mutedTracks);
      setPlaying(true);
      trackPlayStart();
    }
  }, [playing, grid, mutedTracks, tempo, playbackMode, variation]);

  const handleModeChange = useCallback(
    (newMode: Mode) => {
      setMode(newMode);
      engineRef.current?.setMode(newMode);
    },
    [],
  );

  /** Build multi-sound preview for a row+col click (drum + companion sounds) */
  const buildPreview = useCallback(
    (row: number, col: number): ScheduledSound[] => {
      const rowConfig = mode.config.kit[row];
      if (!rowConfig) return [];
      const chord = mode.config.chordProgression[0]; // always first chord for preview
      const sounds: ScheduledSound[] = [];
      const base = { row, col, value: 1 as CellValue };

      // 1. Drum hit (always)
      sounds.push({ ...base, beatOffset: 0, sound: rowConfig.name, velocity: 0.7 });

      // 2. Bass companion (pulse/groove rows)
      if (rowConfig.bass) {
        sounds.push({
          ...base, beatOffset: 0, sound: rowConfig.bass.soundKey,
          velocity: rowConfig.bass.velocity, note: chord.root,
        });
      }

      // 3. Stab companion (rhythm/groove rows)
      if (rowConfig.stab) {
        const voicing = rowConfig.stab.voicingSource === 'pad'
          ? chord.padVoicing : chord.stabVoicing;
        sounds.push({
          ...base, beatOffset: 0, sound: rowConfig.stab.soundKey,
          velocity: rowConfig.stab.velocity, notes: voicing,
        });
      }

      // 4. Arp cascade (sparkle row) — 4 notes at compressed 60ms spacing
      if (rowConfig.arp) {
        const voicing = chord.stabVoicing;
        const arpNotes = [
          midiToNote(noteToMidi(voicing[0]) + 12),
          midiToNote(noteToMidi(voicing[1]) + 12),
          midiToNote(noteToMidi(voicing[2]) + 12),
          midiToNote(noteToMidi(voicing[0]) + 24),
        ].sort((a, b) => noteToMidi(a) - noteToMidi(b));
        const isDownbeat = col % 2 === 0;
        const sequence = isDownbeat ? arpNotes : [...arpNotes].reverse();
        let vel = rowConfig.arp.baseVelocity;
        for (let i = 0; i < sequence.length; i++) {
          sounds.push({
            ...base, beatOffset: i * 0.25, // 16th note spacing (matches playback)
            sound: rowConfig.arp.soundKey, velocity: vel, note: sequence[i],
          });
          vel *= rowConfig.arp.velocityDecay;
        }
      }

      return sounds;
    },
    [mode],
  );

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      setGrid((prev) => {
        const next = toggleCell(prev, row, col);
        if (next.cells[row][col] > 0 && !playing) {
          const preview = buildPreview(row, col);
          if (preview.length > 0) {
            const engine = getEngine();
            engine.ensureReady().then(() => {
              engine.triggerPreview(preview);
            });
          }
        }
        return next;
      });
    },
    [mode, playing, buildPreview, tempo],
  );

  const handleCellSet = useCallback(
    (row: number, col: number, value: CellValue) => {
      setGrid((prev) => setCell(prev, row, col, value));
    },
    [],
  );

  const handleReset = useCallback(() => {
    revealDefaultGrid();
  }, [revealDefaultGrid]);

  const handleClear = useCallback(() => {
    setGrid(createEmptyGrid(DEFAULT_NUM_ROWS, DEFAULT_NUM_COLS));
  }, []);

  const showToast = useCallback((msg: string) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }, []);

  const handleShare = useCallback(async () => {
    const url = buildShareUrl({ grid, tempo, mutedTracks, volumes, variationSeed: variation, playbackMode });
    trackShareClick();
    try {
      await navigator.clipboard.writeText(url);
      showToast('Copied!');
    } catch {
      // Clipboard denied — show URL so user can copy manually
      showToast(url);
    }
  }, [grid, tempo, mutedTracks, volumes, variation, playbackMode, showToast]);

  const handlePlaybackModeCycle = useCallback(() => {
    const order: Array<'short' | 'long' | 'loop'> = ['short', 'long', 'loop'];
    const labels: Record<string, string> = { short: 'Short', long: 'Long', loop: 'Loop' };
    const idx = order.indexOf(playbackMode);
    const next = order[(idx + 1) % order.length];
    setPlaybackMode(next);
    trackModeChange(next);
    clearTimeout(modeLabelTimer.current);
    setModeLabel(labels[next]);
    modeLabelTimer.current = setTimeout(() => setModeLabel(null), 1500);

    // Dispose engine — arrangement structure changed, will be recreated on next play
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current.dispose();
      engineRef.current = null;
    }
    if (playing) {
      setPlaying(false);
      setActiveColumn(-1);
      setChordIndex(-1);
      setDrumProbs(undefined);
    }
  }, [playbackMode, playing]);

  const handleDiceRoll = useCallback(() => {
    // Pick a random seed different from the current one
    let next: number;
    do {
      next = Math.floor(Math.random() * 16);
    } while (next === variation && 16 > 1);
    setVariation(next);
    engineRef.current?.setVariation(next);
    trackDiceRoll(next);
    setDiceRolling(true);
    setTimeout(() => setDiceRolling(false), 350);
  }, [variation]);

  const handleTempoChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTempo(Number(e.target.value));
    },
    [],
  );

  const handleVolumeChange = useCallback(
    (name: string, value: number) => {
      setVolumes((prev) => ({ ...prev, [name]: value }));
      engineRef.current?.setVolume(name, value);
    },
    [],
  );

  const handleMuteToggle = useCallback(
    (name: string) => {
      setMutedTracks((prev) => {
        const next = new Set(prev);
        if (next.has(name)) {
          next.delete(name);
          engineRef.current?.unmute(name);
          const restored = preMuteVolumes.current[name] ?? 1;
          engineRef.current?.setVolume(name, restored);
        } else {
          next.add(name);
          preMuteVolumes.current[name] = volumes[name] ?? 1;
          engineRef.current?.mute(name);
        }
        return next;
      });
    },
    [volumes],
  );

  // Layer toggles
  const layerColor = 'var(--color-cell-active)';
  const layerToggles = [
    { key: 'stab', shape: mode.config.stab.shape, color: layerColor },
    { key: 'pad', shape: mode.config.pad.shape, color: layerColor },
    { key: 'bass', shape: mode.config.bass.shape, color: layerColor },
  ];

  // Hero letter colors — wider spread than just the 4 kit colors
  const heroLetters = [
    { char: 'b', color: '#ff4444' },  // red
    { char: 'e', color: '#ff8800' },  // orange
    { char: 'a', color: '#ffd000' },  // yellow
    { char: 't', color: '#00ff88' },  // green
    { char: 's', color: '#00e5ff' },  // cyan
    { char: '.', color: '#5a6a8a' },  // muted
    { char: 'm', color: '#b44dff' },  // purple
    { char: 'e', color: '#ff2d95' },  // pink
  ];

  return (
    <div className="flex flex-col items-center min-h-screen px-2 py-4 sm:p-6">
      {/* Hero */}
      <h1 className="font-mono text-[36px] sm:text-[64px] font-bold tracking-wider mt-4 sm:mt-6 mb-3 sm:mb-4">
        {heroLetters.map(({ char, color }, i) => (
          <span
            key={i}
            style={{
              color,
              textShadow: char === '.'
                ? 'none'
                : `0 0 8px ${color}88, 0 0 24px ${color}44`,
            }}
          >
            {char}
          </span>
        ))}
      </h1>

      {/* Grid + mixer */}
      <div className="relative mt-2">
        <div>
          <Grid
            grid={grid}
            rowColors={mode.config.rowColors}
            activeColumn={activeColumn}
            rowShapes={mode.config.kit.map((r) => r.shape)}
            rowNames={mode.config.kit.map((r) => r.name)}
            mutedTracks={mutedTracks}
            layerToggles={layerToggles}
            drumProbs={drumProbs}
            onCellClick={handleCellClick}
            onCellSet={handleCellSet}
          />

          {/* EQ Visualizer — compact centered display below step LEDs */}
          <div className="flex justify-center mt-3">
            <EqVisualizer
              ref={eqRef}
              playing={playing}
            />
          </div>
        </div>
      </div>

      {/* Bottom controls — primary actions left, tempo center, settings right */}
      <div className="w-full max-w-[900px] flex items-center justify-between mt-4 sm:mt-8 mb-4 sm:mb-6 px-1 sm:px-0">
        {/* Primary actions — Play, Mode, Dice, Share (cyan, prominent) */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={handlePlayStop}
            className={`w-11 h-11 sm:w-14 sm:h-14 flex items-center justify-center rounded-full border-2 transition-all duration-150 ${
              playing
                ? 'border-cell-active bg-cell-active/20 text-cell-active'
                : 'border-cell-active/40 text-cell-active hover:bg-cell-active/10 animate-play-glow'
            }`}
            aria-label={playing ? 'Stop' : 'Play'}
            title={playing ? 'Stop' : 'Play'}
          >
            {playing ? (
              <span className="w-4 h-4 bg-cell-active rounded-[2px]" />
            ) : (
              <span className="w-0 h-0 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-l-[13px] border-l-cell-active ml-1" />
            )}
          </button>
          <div className="relative">
            <button
              onClick={handlePlaybackModeCycle}
              className={`w-11 h-11 sm:w-14 sm:h-14 flex items-center justify-center rounded-full border-2 transition-colors duration-150 ${
                playbackMode === 'loop'
                  ? 'border-cell-active/50 text-cell-active bg-cell-active/10'
                  : 'border-cell-active/30 text-cell-active hover:bg-cell-active/10'
              }`}
              title={playbackMode === 'short' ? 'Short' : playbackMode === 'long' ? 'Long' : 'Loop'}
              aria-label={`Playback mode: ${playbackMode}. Tap to cycle.`}
            >
              {playbackMode === 'short' && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 18 12 8 21 18" />
                </svg>
              )}
              {playbackMode === 'long' && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2 18 7 10 12 15 17 8 22 18" />
                </svg>
              )}
              {playbackMode === 'loop' && (
                <svg width="22" height="14" viewBox="0 0 22 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 1C3.2 1 1 3.7 1 7s2.2 6 5 6c2.8 0 5-2.7 5-6S8.8 1 6 1z" />
                  <path d="M16 1c-2.8 0-5 2.7-5 6s2.2 6 5 6c2.8 0 5-2.7 5-6s-2.2-6-5-6z" />
                </svg>
              )}
            </button>
            {modeLabel && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-[#1a1e2e] border border-cell-active/30 text-cell-active px-3 py-1.5 rounded-lg font-mono text-sm shadow-lg shadow-black/40 animate-fade-in z-50">
                {modeLabel}
              </div>
            )}
          </div>
          <button
            onClick={handleDiceRoll}
            className={`w-11 h-11 sm:w-14 sm:h-14 flex items-center justify-center rounded-full border-2 transition-colors duration-150 ${
              variation > 0
                ? 'border-cell-active/40 text-cell-active'
                : 'border-cell-active/30 text-cell-active hover:bg-cell-active/10'
            }`}
            title={`Variation ${variation}`}
            aria-label={`Roll variation (current: ${variation})`}
          >
            <span className="relative flex items-center justify-center">
              <svg
                width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={diceRolling ? 'animate-dice-roll' : ''}
              >
                <rect x="2" y="2" width="20" height="20" rx="3" />
                <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
              </svg>
              {variation > 0 && (
                <span className="absolute -top-1.5 -right-2.5 font-mono text-[9px] leading-none text-cell-active/80">
                  {variation}
                </span>
              )}
            </span>
          </button>
          <div className="relative">
            <button onClick={handleShare} className="w-11 h-11 sm:w-14 sm:h-14 flex items-center justify-center rounded-full border-2 border-cell-active/30 text-cell-active hover:bg-cell-active/10 transition-colors duration-150" title="Share" aria-label="Share beat">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            </button>
            {toast && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-[#1a1e2e] border border-cell-active/30 text-cell-active px-3 py-1.5 rounded-lg font-mono text-sm shadow-lg shadow-black/40 animate-fade-in select-all z-50">
                {toast}
              </div>
            )}
          </div>
        </div>

        {/* BPM — metronome icon + slider, value shown only on drag */}
        <div className="flex items-center gap-2 relative">
          <svg
            width="24" height="24" viewBox="0 0 16 16"
            className="text-text-dim"
            fill="none" stroke="currentColor" strokeWidth="1.5"
          >
            <path d="M4 14L8 2L12 14" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="8" y1="4" x2="11" y2="7" strokeLinecap="round" />
            <line x1="3" y1="14" x2="13" y2="14" strokeLinecap="round" />
          </svg>
          <div className="relative">
            <input
              type="range"
              min={60} max={180} step={20}
              value={tempo}
              onChange={handleTempoChange}
              onPointerDown={() => setShowBpmValue(true)}
              onPointerUp={() => setShowBpmValue(false)}
              onPointerLeave={() => setShowBpmValue(false)}
              className="w-[100px] accent-cell-active cursor-pointer"
              aria-label="Tempo"
              title={`${tempo} BPM`}
            />
            {showBpmValue && (
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 font-mono text-[12px] text-cell-active bg-surface/95 px-1.5 py-0.5 rounded border border-border">
                {tempo}
              </span>
            )}
          </div>
        </div>

        {/* Settings — Clear, Reset, Volume (grey, demoted) */}
        <div className="flex items-center gap-1.5">
          <button onClick={handleClear} className={ICON_BTN_GHOST} title="Clear" aria-label="Clear grid">
            <span className="text-[20px]">✕</span>
          </button>
          <button onClick={handleReset} className={ICON_BTN_GHOST} title="Reset" aria-label="Reset to default pattern">
            <span className="text-[20px]">↺</span>
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMixer((v) => !v)}
              className={toggleBtnClass(showMixer)}
              title="Volume"
              aria-label="Toggle volume mixer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            </button>

            {/* Floating mixer panel */}
            {showMixer && (
              <div className="absolute bottom-full mb-3 right-1/2 translate-x-1/2 bg-[#1a1e2e] border border-white/10 rounded-lg p-4 shadow-lg shadow-black/40 flex flex-col gap-3 z-50 min-w-[220px]">
                {/* Drum rows */}
                {mode.config.kit.map((row, idx) => {
                  const isMuted = mutedTracks.has(row.name);
                  const color = mode.config.rowColors[idx]?.color ?? '#888';
                  return (
                    <div key={row.name} className="flex items-center gap-2">
                      <span
                        className="w-[24px] text-center shrink-0 select-none"
                        style={{
                          color: isMuted ? 'var(--color-muted)' : color,
                          fontSize: '18px',
                          opacity: isMuted ? 0.3 : 0.7,
                        }}
                      >
                        {row.shape}
                      </span>
                      <SpeakerMuteButton
                        name={row.name}
                        isMuted={isMuted}
                        color={color}
                        onToggle={handleMuteToggle}
                      />
                      <input
                        type="range"
                        min={0} max={100} step={10}
                        value={Math.round((volumes[row.name] ?? 1) * 100)}
                        onChange={(e) => handleVolumeChange(row.name, Number(e.target.value) / 100)}
                        className="w-[90px] shrink-0 accent-current cursor-pointer"
                        style={{
                          color,
                          opacity: isMuted ? 0.3 : 1,
                        }}
                        aria-label={`${row.name} volume`}
                      />
                    </div>
                  );
                })}

                {/* Separator */}
                {layerToggles.length > 0 && (
                  <div className="border-t border-white/10 my-0.5" />
                )}

                {/* Layer rows (bass, pad, stab) */}
                {layerToggles.map((layer) => {
                  const layerMuted = mutedTracks.has(layer.key);
                  return (
                    <div key={layer.key} className="flex items-center gap-2">
                      <span
                        className="w-[24px] text-center shrink-0 select-none"
                        style={{
                          color: layerMuted ? 'var(--color-muted)' : layer.color,
                          fontSize: '18px',
                          opacity: layerMuted ? 0.3 : 0.7,
                        }}
                      >
                        {layer.shape}
                      </span>
                      <SpeakerMuteButton
                        name={layer.key}
                        isMuted={layerMuted}
                        color={layer.color}
                        onToggle={handleMuteToggle}
                      />
                      <input
                        type="range"
                        min={0} max={100} step={10}
                        value={Math.round((volumes[layer.key] ?? 1) * 100)}
                        onChange={(e) => handleVolumeChange(layer.key, Number(e.target.value) / 100)}
                        className="w-[90px] shrink-0 accent-current cursor-pointer"
                        style={{
                          color: layer.color,
                          opacity: layerMuted ? 0.3 : 1,
                        }}
                        aria-label={`${layer.key} volume`}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {modes.length > 1 && modes.map((m) => (
            <button
              key={m.id}
              onClick={() => handleModeChange(m)}
              className={toggleBtnClass(m.id === mode.id)}
              title={m.label}
            >
              <span className="text-[11px]">{m.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
