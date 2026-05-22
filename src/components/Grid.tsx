import { useRef, useCallback, useMemo, useEffect } from 'react';
import type { GridState, RowColor, CellValue } from '../lib/types';

/** Layer mute toggle (bass, pad, stab, etc.) */
export interface LayerToggle {
  key: string;
  shape: string;
  color: string;
}

interface GridProps {
  grid: GridState;
  rowColors: RowColor[];
  activeColumn: number;
  rowShapes: string[];
  rowNames: string[];
  mutedTracks: Set<string>;
  layerToggles: LayerToggle[];
  /** Per-row drum probability for playhead dimming (0 = silent, 1 = full). Undefined = all full. */
  drumProbs?: [number, number, number, number];
  onCellClick: (row: number, col: number) => void;
  onCellSet: (row: number, col: number, value: CellValue) => void;
}

function numBeats(numCols: number): number {
  return Math.floor(numCols / 2);
}

/** Compute cell size to fill available viewport width, clamped 16-64px */
export function computeCellSize(numCols: number): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
  const isMobile = vw < 600;
  const numBeatsVal = Math.floor(numCols / 2);
  // First pass: assume 8px beat gaps to get raw size, then adjust if small
  const pairGaps = numBeatsVal * 2;  // 2px gap within pairs
  const labelWidth = isMobile ? 20 : 32;
  const padding = isMobile ? 16 : 48;
  const targetWidth = vw - padding;
  // Try with 8px gaps first
  const available8 = targetWidth - (numBeatsVal * 8) - pairGaps - labelWidth;
  const raw8 = Math.floor(available8 / numCols);
  // If cells would be < 24px, use 4px gaps instead
  if (raw8 < 24) {
    const available4 = targetWidth - (numBeatsVal * 4) - pairGaps - labelWidth;
    const raw4 = Math.floor(available4 / numCols);
    return Math.max(16, Math.min(64, raw4));
  }
  return Math.max(16, Math.min(64, raw8));
}

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

/** Style for an indicator dot (step LEDs, chord dots) */
function dotStyle(isActive: boolean, inactiveOpacity = 0.4): React.CSSProperties {
  return {
    backgroundColor: isActive ? 'var(--color-cell-active)' : 'var(--color-muted)',
    boxShadow: isActive
      ? '0 0 8px var(--color-cell-glow), 0 0 16px var(--color-cell-glow)'
      : 'none',
    opacity: isActive ? 1 : inactiveOpacity,
  };
}

/** Speaker icon mute toggle — Windows/macOS mixer style */
export function SpeakerMuteButton({
  name,
  isMuted,
  color,
  onToggle,
}: {
  name: string;
  isMuted: boolean;
  color: string;
  onToggle: (name: string) => void;
}) {
  const strokeColor = isMuted ? 'var(--color-muted)' : color;
  return (
    <button
      className="cursor-pointer shrink-0 transition-opacity duration-150 hover:opacity-100"
      style={{ opacity: isMuted ? 0.4 : 0.8 }}
      onClick={() => onToggle(name)}
      aria-label={`${isMuted ? 'Unmute' : 'Mute'} ${name}`}
      title={isMuted ? 'Unmute' : 'Mute'}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={strokeColor} stroke="none" />
        {isMuted ? (
          <>
            <line x1="16" y1="9" x2="22" y2="15" />
            <line x1="22" y1="9" x2="16" y2="15" />
          </>
        ) : (
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        )}
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Grid component
// ---------------------------------------------------------------------------

export default function Grid({
  grid,
  rowColors,
  activeColumn,
  rowShapes,
  rowNames,
  mutedTracks,
  layerToggles: _layerToggles,
  drumProbs,
  onCellClick,
  onCellSet,
}: GridProps) {
  const isDragging = useRef(false);
  const dragTarget = useRef<CellValue | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellSize = useMemo(() => computeCellSize(grid.numCols), [grid.numCols]);

  // Column highlight — glow around the whole beat pair wrapper.
  // Moves per beat pair to match step LED dots.
  // Direct DOM manipulation to avoid re-renders (per CLAUDE.md).
  // drumProbs dims the glow on rows where drums are silent/quiet.
  const prevBeatRef = useRef(-1);
  const drumProbsRef = useRef(drumProbs);
  drumProbsRef.current = drumProbs;

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const currentBeat = activeColumn >= 0 ? Math.floor(activeColumn / 2) : -1;
    if (currentBeat === prevBeatRef.current) return;

    // Clear previous beat pair wrappers
    if (prevBeatRef.current >= 0) {
      const prevWrappers = el.querySelectorAll<HTMLElement>(`[data-beat="${prevBeatRef.current}"]`);
      for (const wrapper of prevWrappers) {
        wrapper.style.removeProperty('box-shadow');
      }
    }

    // Highlight current beat pair wrappers (one per row) with per-row dimming
    if (currentBeat >= 0) {
      const wrappers = el.querySelectorAll<HTMLElement>(`[data-beat="${currentBeat}"]`);
      const probs = drumProbsRef.current;
      for (const wrapper of wrappers) {
        const rowAttr = wrapper.getAttribute('data-beat-row');
        const rowIdx = rowAttr !== null ? parseInt(rowAttr, 10) : -1;
        const prob = probs && rowIdx >= 0 ? probs[rowIdx] ?? 1 : 1;

        // Scale glow opacity by drum probability: 0 → 15%, 1 → 100%
        const glowOpacity = 0.15 + prob * 0.85;
        const a1 = (0.4 * glowOpacity).toFixed(2);
        const a2 = (0.15 * glowOpacity).toFixed(2);
        const a3 = (0.1 * glowOpacity).toFixed(2);
        wrapper.style.boxShadow = `0 0 12px rgba(255, 255, 255, ${a1}), 0 0 24px rgba(255, 255, 255, ${a2}), inset 0 0 8px rgba(255, 255, 255, ${a3})`;
      }
    }

    prevBeatRef.current = currentBeat;
  }, [activeColumn]);

  const handlePointerDown = useCallback(
    (row: number, col: number) => {
      isDragging.current = true;
      const current = grid.cells[row][col];
      const next = current === 0 ? 1 : 0;
      dragTarget.current = next;
      onCellClick(row, col);
    },
    [grid, onCellClick],
  );

  const handlePointerEnter = useCallback(
    (row: number, col: number, e: React.PointerEvent) => {
      if (!isDragging.current && (e.buttons & 1) !== 0 && dragTarget.current !== null) {
        isDragging.current = true;
      }
      if (!isDragging.current) return;
      const current = grid.cells[row][col];
      const target = dragTarget.current;
      if (target !== null && current !== target) {
        onCellSet(row, col, target);
      }
    },
    [grid, onCellSet],
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
    dragTarget.current = null;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, row: number, col: number) => {
      let nextRow = row;
      let nextCol = col;

      switch (e.key) {
        case 'ArrowUp':
          nextRow = Math.max(0, row - 1);
          break;
        case 'ArrowDown':
          nextRow = Math.min(grid.numRows - 1, row + 1);
          break;
        case 'ArrowLeft':
          nextCol = Math.max(0, col - 1);
          break;
        case 'ArrowRight':
          nextCol = Math.min(grid.numCols - 1, col + 1);
          break;
        case ' ':
        case 'Enter':
          e.preventDefault();
          onCellClick(row, col);
          return;
        default:
          return;
      }

      e.preventDefault();
      const target = gridRef.current?.querySelector(
        `[data-row="${nextRow}"][data-col="${nextCol}"]`,
      ) as HTMLElement | null;
      target?.focus();
    },
    [grid.numRows, grid.numCols, onCellClick],
  );

  const beats = numBeats(grid.numCols);
  const beatGap = cellSize < 24 ? 4 : 8;
  const pairWidth = cellSize * 2 + 2;
  const ledPadding = Math.floor((cellSize - 8) / 2);

  return (
    <div
      ref={gridRef}
      className="select-none touch-none"
      role="grid"
      aria-label="Step sequencer grid"
      onPointerUp={handlePointerUp}
      onPointerLeave={() => { isDragging.current = false; }}
    >
      {grid.cells.map((row, rowIdx) => {
        const rowColor = rowColors[rowIdx];
        const rowName = rowNames[rowIdx];
        const isMuted = mutedTracks.has(rowName);
        return (
          <div key={rowIdx} className="flex items-center mb-[2px]" role="row">
            {/* Row shape label — static identifier, not interactive */}
            <span
              className="w-[16px] sm:w-[24px] text-center shrink-0 mr-1 sm:mr-1.5 select-none"
              style={{
                color: isMuted ? 'var(--color-muted)' : (rowColor?.color ?? 'var(--color-muted)'),
                fontSize: `${Math.max(12, cellSize * 0.4)}px`,
                opacity: isMuted ? 0.3 : 0.7,
              }}
            >
              {rowShapes[rowIdx]}
            </span>
            <div className="flex" style={{ gap: `${beatGap}px` }}>
              {Array.from({ length: beats }, (_, beatIdx) => {
                const col0 = beatIdx * 2;
                const col1 = beatIdx * 2 + 1;
                return (
                  <div key={beatIdx} className="flex gap-[2px] shrink-0 rounded-[4px]" data-beat={beatIdx} data-beat-row={rowIdx}>
                    {[col0, col1].map((colIdx) => {
                      const value = row[colIdx];
                      const isActive = value > 0;
                      return (
                        <button
                          key={colIdx}
                          role="gridcell"
                          aria-pressed={isActive}
                          aria-label={`Row ${rowIdx + 1}, step ${colIdx + 1}`}
                          data-row={rowIdx}
                          data-col={colIdx}
                          tabIndex={rowIdx === 0 && colIdx === 0 ? 0 : -1}
                          className="shrink-0 rounded-[3px] cursor-pointer transition-[background-color] duration-[50ms] ease focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-1 focus:ring-offset-bg"
                          style={{
                            width: `${cellSize}px`,
                            height: `${cellSize}px`,
                            backgroundColor: isActive && rowColor
                              ? rowColor.color
                              : 'var(--color-cell-inactive)',
                            boxShadow: isActive && rowColor && !isMuted
                              ? `0 0 ${Math.max(8, cellSize * 0.25)}px ${rowColor.glowColor}`
                              : 'none',
                            opacity: isMuted ? 0.3 : 1,
                          }}
                          onPointerDown={() => handlePointerDown(rowIdx, colIdx)}
                          onPointerEnter={(e) => handlePointerEnter(rowIdx, colIdx, e)}
                          onKeyDown={(e) => handleKeyDown(e, rowIdx, colIdx)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Step indicator LEDs */}
      <div className="flex items-center mt-2">
        <span className="w-[16px] sm:w-[24px] mr-1 sm:mr-1.5 shrink-0" />
        <div className="flex" style={{ gap: `${beatGap}px` }}>
          {Array.from({ length: beats }, (_, beatIdx) => {
            const col0 = beatIdx * 2;
            const col1 = beatIdx * 2 + 1;
            const isActive = activeColumn === col0 || activeColumn === col1;
            return (
              <div
                key={beatIdx}
                className="flex justify-start shrink-0"
                style={{ width: `${pairWidth}px`, paddingLeft: `${ledPadding}px` }}
              >
                <div className="w-2 h-2 rounded-full transition-all duration-75" style={dotStyle(isActive)} />
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
